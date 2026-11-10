import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildIssueBody, ISSUE_BODY_LIMIT, readRunSummary } from "./issueBody.ts";

const runUrl = "https://github.com/o/r/actions/runs/1";
const base = { runUrl, prompt: "look", suffix: "", summary: "" };

test("readRunSummary reads testResults.md from the run folder", () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gha-run-"));
  fs.writeFileSync(path.join(runDir, "testResults.md"), "## Failed\n\n| a | b |\n");
  assert.equal(readRunSummary(runDir, runUrl), "## Failed\n\n| a | b |");
});

test("readRunSummary points to the run when there's no summary", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gha-run-"));
  for (const runDir of [undefined, "", 42, empty]) {
    assert.equal(
      readRunSummary(runDir, runUrl),
      `Doc Detective wrote no summary for this run. See the [workflow run](${runUrl}).`
    );
  }
});

test("fills $SUMMARY as Markdown, without a fence", () => {
  const body = buildIssueBody({
    ...base,
    template: "Run $RUN_URL failed:\n\n$SUMMARY",
    summary: "## Failed\n\n- a",
    results: "{}",
  });
  assert.equal(body, `Run ${runUrl} failed:\n\n## Failed\n\n- a`);
});

test("doesn't reinterpret tokens inside the summary", () => {
  const summary = "$RESULTS $PROMPT $& $'";
  const body = buildIssueBody({ ...base, template: "$SUMMARY", summary, results: "{}" });
  assert.equal(body, summary);
});

test("cuts an oversized summary at a line break, and links to the run", () => {
  const summary = ("| row | FAIL |\n").repeat(ISSUE_BODY_LIMIT / 10);
  const body = buildIssueBody({ ...base, template: "Failed:\n\n$SUMMARY", summary, results: "{}" });
  assert.ok(body.length <= ISSUE_BODY_LIMIT, `length ${body.length}`);
  assert.ok(body.length > ISSUE_BODY_LIMIT - 500, `length ${body.length}`);
  assert.match(body, /\| row \| FAIL \|\n\nTruncated/);
  assert.ok(body.includes(`[workflow run](${runUrl})`));
});

test("shares the cap between $SUMMARY and $RESULTS, and cuts only what's over", () => {
  const body = buildIssueBody({
    ...base,
    template: "$SUMMARY\n$RESULTS",
    summary: "short summary",
    results: "x".repeat(ISSUE_BODY_LIMIT),
  });
  assert.ok(body.length <= ISSUE_BODY_LIMIT, `length ${body.length}`);
  assert.ok(body.startsWith("short summary\n"));
  assert.equal(body.split("Truncated").length - 1, 1);
});

test("fills the tokens and leaves results that fit alone", () => {
  const body = buildIssueBody({
    ...base,
    template: "Run $RUN_URL, $PROMPT:$RESULTS",
    results: '{"a":1}',
  });
  assert.equal(body, `Run ${runUrl}, look:\n\n\`\`\`json\n{"a":1}\n\`\`\``);
});

test("doesn't reinterpret tokens or $ patterns inside the results", () => {
  const results = "$PROMPT $RUN_URL $& $'";
  const body = buildIssueBody({ ...base, template: "$RESULTS", results });
  assert.ok(body.includes(results));
});

test("caps oversized results to the limit, and links to the run", () => {
  const body = buildIssueBody({
    ...base,
    template: "Run $RUN_URL:$RESULTS",
    suffix: "\n\nSUFFIX",
    results: "x".repeat(ISSUE_BODY_LIMIT * 2),
  });
  assert.ok(body.length <= ISSUE_BODY_LIMIT, `length ${body.length}`);
  assert.ok(body.length > ISSUE_BODY_LIMIT - 500, `length ${body.length}`);
  assert.match(body, /Truncated/);
  assert.equal(body.split(runUrl).length - 1, 2);
  assert.ok(body.endsWith("\n\nSUFFIX"));
  assert.match(body, /x\n```/);
});

test("a body exactly at the limit isn't truncated", () => {
  const overhead = "\n\n```json\n\n```".length;
  const results = "x".repeat(ISSUE_BODY_LIMIT - overhead);
  const body = buildIssueBody({ ...base, template: "$RESULTS", results });
  assert.equal(body.length, ISSUE_BODY_LIMIT);
  assert.doesNotMatch(body, /Truncated/);
});

test("shares the cap across repeated $RESULTS tokens", () => {
  const body = buildIssueBody({
    ...base,
    template: "$RESULTS and $RESULTS",
    results: "x".repeat(ISSUE_BODY_LIMIT),
  });
  assert.ok(body.length <= ISSUE_BODY_LIMIT, `length ${body.length}`);
  assert.equal(body.split("Truncated").length - 1, 2);
});

test("doesn't split a surrogate pair at the cut", () => {
  for (const pad of ["", "y"]) {
    const body = buildIssueBody({
      ...base,
      template: pad + "$RESULTS",
      results: "\u{1F600}".repeat(ISSUE_BODY_LIMIT),
    });
    assert.ok(body.length <= ISSUE_BODY_LIMIT);
    assert.doesNotMatch(body, /\p{Cs}/u);
  }
});

test("refuses a template or suffix that leaves no room for the results", () => {
  const big = "y".repeat(ISSUE_BODY_LIMIT);
  const results = "x".repeat(100);
  for (const input of [
    { template: big + "$RESULTS", suffix: "" },
    { template: "$RESULTS", suffix: big },
    { template: big + "y", suffix: "" },
  ]) {
    assert.throws(
      () => buildIssueBody({ ...base, ...input, results }),
      /issue_body.*65536/
    );
  }
});

test("keeps the note, link, and suffix when results only just lose all their room", () => {
  const note = `\n\nTruncated to fit GitHub's issue size limit. See the [workflow run](${runUrl}) for details.`;
  const overhead = "\n\n```json\n\n```".length + note.length;
  const body = buildIssueBody({
    ...base,
    template: "y".repeat(ISSUE_BODY_LIMIT - overhead - "SUFFIX".length) + "$RESULTS",
    suffix: "SUFFIX",
    results: "x".repeat(1000),
  });
  assert.equal(body.length, ISSUE_BODY_LIMIT);
  assert.ok(body.includes(runUrl));
  assert.ok(body.endsWith("SUFFIX"));
});
