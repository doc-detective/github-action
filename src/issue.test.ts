import test from "node:test";
import assert from "node:assert/strict";
import { fileIssue } from "./issue.ts";

function mockOctokit(openIssues: any[], { failCreateWithAssignees = false } = {}) {
  const calls: Record<string, any[]> = { list: [], create: [], update: [] };
  const octokit = {
    paginate: async (_route: unknown, params: any) => {
      calls.list.push(params);
      return openIssues;
    },
    rest: {
      issues: {
        listForRepo: {},
        create: async (params: any) => {
          calls.create.push(params);
          if (failCreateWithAssignees && params.assignees) throw Object.assign(new Error("bad"), { status: 422 });
          return { data: { html_url: "https://github.com/o/r/issues/9" } };
        },
        update: async (params: any) => {
          calls.update.push(params);
          return { data: { html_url: `https://github.com/o/r/issues/${params.issue_number}` } };
        },
      },
    },
  };
  return { octokit, calls };
}

const base = {
  owner: "o",
  repo: "r",
  title: "Doc Detective Failure",
  body: "new body",
  labels: ["doc-detective", "docs"],
  assignees: ["octocat"],
  warning: () => {},
};

test("updates the open issue with the same title and first label", async () => {
  const { octokit, calls } = mockOctokit([
    { number: 3, title: "Something else" },
    { number: 7, title: "Doc Detective Failure" },
  ]);
  const out = await fileIssue({ ...base, octokit: octokit as any });
  assert.deepEqual(out, { url: "https://github.com/o/r/issues/7", updated: true });
  assert.equal(calls.list[0].labels, "doc-detective");
  assert.equal(calls.list[0].state, "open");
  assert.deepEqual(calls.update, [{ owner: "o", repo: "r", issue_number: 7, body: "new body" }]);
  assert.equal(calls.create.length, 0);
});

test("skips pull requests with the same title, and creates an issue", async () => {
  const { octokit, calls } = mockOctokit([
    { number: 5, title: "Doc Detective Failure", pull_request: { url: "x" } },
  ]);
  const out = await fileIssue({ ...base, octokit: octokit as any });
  assert.deepEqual(out, { url: "https://github.com/o/r/issues/9", updated: false });
  assert.equal(calls.update.length, 0);
  assert.deepEqual(calls.create, [
    {
      owner: "o",
      repo: "r",
      title: "Doc Detective Failure",
      body: "new body",
      labels: ["doc-detective", "docs"],
      assignees: ["octocat"],
    },
  ]);
});

test("without labels, matches on the title alone", async () => {
  const { octokit, calls } = mockOctokit([{ number: 2, title: "Doc Detective Failure" }]);
  const out = await fileIssue({ ...base, labels: [], octokit: octokit as any });
  assert.equal(out.updated, true);
  assert.equal("labels" in calls.list[0], false);
});

test("retries without assignees when GitHub rejects them", async () => {
  const warnings: string[] = [];
  const { octokit, calls } = mockOctokit([], { failCreateWithAssignees: true });
  const out = await fileIssue({ ...base, octokit: octokit as any, warning: (m) => warnings.push(m) });
  assert.equal(out.updated, false);
  assert.equal(calls.create.length, 2);
  assert.equal("assignees" in calls.create[1], false);
  assert.equal(warnings.length, 1);
});
