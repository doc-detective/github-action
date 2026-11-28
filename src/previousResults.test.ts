import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MIN_COMPARE_VERSION,
  comparisonArgs,
  compareSupportWarnings,
  parseCompareTo,
  parseFailOn,
  previousResultsPath,
  restorePreviousResults,
  resultsKeyPrefix,
  resultsSaveKey,
  saveResults,
} from "./previousResults.ts";

const base = { platform: "linux", config: "c.json", input: "docs", cwd: "." };

test("resultsKeyPrefix keys on OS, job, inputs, and branch", () => {
  const prefix = resultsKeyPrefix({ ...base, env: { GITHUB_JOB: "docs", GITHUB_REF_NAME: "main" } });
  assert.match(prefix, /^doc-detective-results-linux-docs-[0-9a-f]{12}-main-$/);
  // Different inputs, different prefix.
  assert.notEqual(prefix, resultsKeyPrefix({ ...base, input: "other", env: { GITHUB_JOB: "docs", GITHUB_REF_NAME: "main" } }));
});

test("resultsKeyPrefix uses the base branch on pull requests", () => {
  const prefix = resultsKeyPrefix({
    ...base,
    env: { GITHUB_JOB: "docs", GITHUB_BASE_REF: "main", GITHUB_REF_NAME: "12/merge" },
  });
  assert.match(prefix, /-main-$/);
});

test("resultsSaveKey adds the run ID, attempt, and step, so two invocations in one job don't collide", () => {
  const env = { GITHUB_RUN_ID: "7", GITHUB_RUN_ATTEMPT: "2" };
  assert.equal(resultsSaveKey("p-", { ...env, GITHUB_ACTION: "dd" }), "p-7-2-dd");
  assert.notEqual(
    resultsSaveKey("p-", { ...env, GITHUB_ACTION: "__doc-detective_github-action" }),
    resultsSaveKey("p-", { ...env, GITHUB_ACTION: "__doc-detective_github-action_2" })
  );
});

test("parseFailOn accepts any and new, and rejects the rest", () => {
  assert.equal(parseFailOn(""), "any");
  assert.equal(parseFailOn(" New "), "new");
  assert.equal(parseFailOn("any"), "any");
  assert.throws(() => parseFailOn("all"), /`fail_on`.*`any` or `new`.*`all`/);
});

test("parseCompareTo defaults to previous and rejects fail_on new without a comparison", () => {
  assert.equal(parseCompareTo("", "any"), "previous");
  assert.equal(parseCompareTo("FALSE", "any"), "false");
  assert.equal(parseCompareTo("out/results.json", "new"), "out/results.json");
  assert.throws(() => parseCompareTo("false", "new"), /`fail_on: new`/);
});

test("comparisonArgs for each compare_to and fail_on value", () => {
  assert.deepEqual(comparisonArgs({ compareTo: "previous", failOn: "any" }), []);
  assert.deepEqual(comparisonArgs({ compareTo: "previous", failOn: "any", restored: "/t/r.json" }), [
    "--compare-to",
    "/t/r.json",
  ]);
  assert.deepEqual(comparisonArgs({ compareTo: "out/r.json", failOn: "new" }), [
    "--compare-to",
    "out/r.json",
    "--fail-on",
    "new",
  ]);
  assert.deepEqual(comparisonArgs({ compareTo: "false", failOn: "any" }), ["--no-compare-to"]);
});

test("compareSupportWarnings warns only for an exact version below the minimum", () => {
  assert.deepEqual(compareSupportWarnings(MIN_COMPARE_VERSION, "new"), []);
  assert.deepEqual(compareSupportWarnings("5.9.0-run-comparison.1", "any"), []);
  assert.deepEqual(compareSupportWarnings("6.0.0", "any"), []);
  // Not exact: a range, a tag, or a linked CLI. Assume support.
  for (const v of ["5", "latest", ""]) assert.deepEqual(compareSupportWarnings(v, "new"), [], v);
  const old = compareSupportWarnings("5.6.0", "any");
  assert.equal(old.length, 1);
  assert.match(old[0], /^Couldn't compare with the previous run: Doc Detective 5\.6\.0 doesn't support `compare_to`\. Set `version` to 5.9.0 or later\.$/);
  assert.equal(compareSupportWarnings("5.6.0", "new").length, 2);
});

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dd-prev-"));
}

test("restorePreviousResults returns the file on a hit and undefined on a miss", async () => {
  const dir = tmp();
  try {
    const file = previousResultsPath(dir);
    const calls: any[] = [];
    const hit = { restoreCache: async (...a: any[]) => (calls.push(a), "k-1-1"), saveCache: async () => 0 };
    const warnings: string[] = [];
    assert.equal(await restorePreviousResults({ cache: hit, file, prefix: "k-", warning: (m) => warnings.push(m) }), file);
    assert.deepEqual(calls[0], [[file], "k-", ["k-"]]);
    const miss = { restoreCache: async () => undefined, saveCache: async () => 0 };
    assert.equal(await restorePreviousResults({ cache: miss, file, prefix: "k-", warning: (m) => warnings.push(m) }), undefined);
    assert.deepEqual(warnings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("restorePreviousResults warns and continues on a cache error", async () => {
  const warnings: string[] = [];
  const broken = { restoreCache: async () => { throw new Error("Cache service responded with 503"); }, saveCache: async () => 0 };
  assert.equal(await restorePreviousResults({ cache: broken, file: "/x", prefix: "k-", warning: (m) => warnings.push(m) }), undefined);
  assert.deepEqual(warnings, [
    "Couldn't restore the previous results: Cache service responded with 503. Failures won't be marked new or already failing.",
  ]);
});

test("saveResults copies the output and saves it, except on pull request events", async () => {
  const dir = tmp();
  try {
    const output = path.join(dir, "out.json");
    fs.writeFileSync(output, '{"summary":{}}');
    const file = previousResultsPath(dir);
    const saved: any[] = [];
    const cache = { restoreCache: async () => undefined, saveCache: async (...a: any[]) => (saved.push(a), 1) };
    const warning = (m: string) => assert.fail(m);
    for (const event of ["pull_request", "pull_request_target"]) {
      assert.equal(await saveResults({ cache, output, file, key: "k-1-1", event, warning }), false);
    }
    assert.equal(saved.length, 0);
    assert.equal(await saveResults({ cache, output, file, key: "k-1-1", event: "push", warning }), true);
    assert.deepEqual(saved, [[[file], "k-1-1"]]);
    assert.equal(fs.readFileSync(file, "utf8"), '{"summary":{}}');
    // No results, nothing to save.
    assert.equal(await saveResults({ cache, output: path.join(dir, "none.json"), file, key: "k", event: "push", warning }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saveResults warns on a cache error", async () => {
  const dir = tmp();
  try {
    const output = path.join(dir, "out.json");
    fs.writeFileSync(output, "{}");
    const warnings: string[] = [];
    const cache = { restoreCache: async () => undefined, saveCache: async () => { throw new Error("Unable to reserve cache"); } };
    await saveResults({ cache, output, file: previousResultsPath(dir), key: "k", event: "push", warning: (m) => warnings.push(m) });
    assert.deepEqual(warnings, ["Couldn't save this run's results for the next comparison: Unable to reserve cache."]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
