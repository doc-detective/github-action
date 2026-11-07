import test from "node:test";
import assert from "node:assert/strict";
import { buildIssueBody, ISSUE_BODY_LIMIT } from "./issueBody.ts";

const runUrl = "https://github.com/o/r/actions/runs/1";
const base = { runUrl, prompt: "look", suffix: "" };

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
  assert.match(body, /truncated/);
  assert.equal(body.split(runUrl).length - 1, 2);
  assert.ok(body.endsWith("\n\nSUFFIX"));
  assert.match(body, /x\n```/);
});

test("a body exactly at the limit isn't truncated", () => {
  const overhead = "\n\n```json\n\n```".length;
  const results = "x".repeat(ISSUE_BODY_LIMIT - overhead);
  const body = buildIssueBody({ ...base, template: "$RESULTS", results });
  assert.equal(body.length, ISSUE_BODY_LIMIT);
  assert.doesNotMatch(body, /truncated/);
});

test("shares the cap across repeated $RESULTS tokens", () => {
  const body = buildIssueBody({
    ...base,
    template: "$RESULTS and $RESULTS",
    results: "x".repeat(ISSUE_BODY_LIMIT),
  });
  assert.ok(body.length <= ISSUE_BODY_LIMIT, `length ${body.length}`);
  assert.equal(body.split("truncated").length - 1, 2);
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

test("still fits when the template alone is too long", () => {
  const body = buildIssueBody({
    ...base,
    template: "y".repeat(ISSUE_BODY_LIMIT) + "$RESULTS",
    results: "x".repeat(100),
  });
  assert.ok(body.length <= ISSUE_BODY_LIMIT);
});
