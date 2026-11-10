import test from "node:test";
import assert from "node:assert/strict";
import { openPullRequest, prBase } from "./pullRequest.ts";

function mocks(openPrs: any[]) {
  const gitCalls: string[][] = [];
  const calls: Record<string, any[]> = {
    list: [],
    create: [],
    update: [],
    labels: [],
    assignees: [],
    reviewers: [],
  };
  const record = (name: string, data: any = {}) => async (params: any) => {
    calls[name].push(params);
    return { data };
  };
  const octokit = {
    rest: {
      pulls: {
        list: async (params: any) => {
          calls.list.push(params);
          return { data: openPrs };
        },
        create: record("create", { number: 12, html_url: "https://github.com/o/r/pull/12" }),
        update: async (params: any) => {
          calls.update.push(params);
          return { data: { html_url: `https://github.com/o/r/pull/${params.pull_number}` } };
        },
        requestReviewers: record("reviewers"),
      },
      issues: { addLabels: record("labels"), addAssignees: record("assignees") },
    },
  };
  const git = async (args: string[]) => {
    gitCalls.push(args);
    return "";
  };
  return { octokit: octokit as any, git, gitCalls, calls };
}

const base = {
  owner: "o",
  repo: "r",
  branch: "doc-detective-changes",
  base: "main",
  title: "Doc Detective Changes",
  body: "run body",
  actor: "octocat",
  labels: ["doc-detective"],
  assignees: [],
  reviewers: ["monalisa"],
  error: () => {},
};

test("the base is the pull request's base branch, else the triggering ref", () => {
  assert.equal(prBase({ GITHUB_BASE_REF: "main", GITHUB_REF_NAME: "42/merge" }), "main");
  assert.equal(prBase({ GITHUB_BASE_REF: "", GITHUB_REF_NAME: "release" }), "release");
  assert.equal(prBase({}), "");
});

test("resets the branch to this checkout, commits, and force-pushes it", async () => {
  const m = mocks([]);
  await openPullRequest({ ...base, octokit: m.octokit, git: m.git });
  assert.deepEqual(m.gitCalls, [
    ["checkout", "-B", "doc-detective-changes"],
    ["add", "-A"],
    [
      "-c",
      "user.name=octocat",
      "-c",
      "user.email=octocat@users.noreply.github.com",
      "commit",
      "-m",
      "Doc Detective results",
    ],
    ["push", "--force", "origin", "doc-detective-changes"],
  ]);
});

test("opens a pull request when the branch has none open", async () => {
  const m = mocks([]);
  const out = await openPullRequest({ ...base, octokit: m.octokit, git: m.git });
  assert.deepEqual(out, { url: "https://github.com/o/r/pull/12", updated: false });
  assert.deepEqual(m.calls.list, [
    { owner: "o", repo: "r", state: "open", head: "o:doc-detective-changes", base: "main" },
  ]);
  assert.deepEqual(m.calls.create, [
    {
      owner: "o",
      repo: "r",
      title: "Doc Detective Changes",
      body: "run body",
      head: "doc-detective-changes",
      base: "main",
    },
  ]);
  assert.deepEqual(m.calls.labels, [
    { owner: "o", repo: "r", issue_number: 12, labels: ["doc-detective"] },
  ]);
  assert.equal(m.calls.assignees.length, 0, "no assignees, no request");
  assert.deepEqual(m.calls.reviewers, [
    { owner: "o", repo: "r", pull_number: 12, reviewers: ["monalisa"] },
  ]);
});

// Labels, assignees, and reviewers are set once, when the pull request opens.
test("updates the branch's open pull request instead of opening another", async () => {
  const m = mocks([{ number: 4 }]);
  const out = await openPullRequest({ ...base, octokit: m.octokit, git: m.git });
  assert.deepEqual(out, { url: "https://github.com/o/r/pull/4", updated: true });
  assert.deepEqual(m.calls.update, [
    { owner: "o", repo: "r", pull_number: 4, title: "Doc Detective Changes", body: "run body" },
  ]);
  assert.equal(m.calls.create.length, 0);
  assert.equal(m.calls.labels.length + m.calls.reviewers.length, 0);
});

test("a 403 adding labels logs the permissions fix and keeps the pull request", async () => {
  const errors: string[] = [];
  const m = mocks([]);
  m.octokit.rest.issues.addLabels = async () => {
    throw Object.assign(new Error("forbidden"), { status: 403 });
  };
  const out = await openPullRequest({
    ...base,
    octokit: m.octokit,
    git: m.git,
    error: (message: string) => errors.push(message),
  });
  assert.equal(out.url, "https://github.com/o/r/pull/12");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Couldn't label the pull request: .*`pull-requests: write`/);
  assert.equal(m.calls.reviewers.length, 1, "a labels failure doesn't skip reviewers");
});

test("refuses an empty base before touching git", async () => {
  const m = mocks([]);
  await assert.rejects(
    openPullRequest({ ...base, base: "", octokit: m.octokit, git: m.git }),
    /^Error: Couldn't tell which branch the pull request targets: `GITHUB_BASE_REF` and `GITHUB_REF_NAME` are both empty\.$/
  );
  assert.equal(m.gitCalls.length, 0);
});
