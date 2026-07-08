import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { parseHtmlReportPath, renderMarkdownSummary } from "./report.ts";

test("parseHtmlReportPath extracts the path from multi-line CLI output", () => {
  const runDir = path.join("/tmp", "run-x");
  const stdout = [
    `See detailed results at ${path.join("/tmp", "doc-detective-output.json")}`,
    `See per-run results at ${path.join(runDir, "testResults.json")}`,
    `See per-run HTML report at ${path.join(runDir, "testResults.html")}`,
  ].join("\n\n");

  assert.equal(
    parseHtmlReportPath(stdout),
    path.join(runDir, "testResults.html")
  );
});

test("parseHtmlReportPath tolerates trailing whitespace", () => {
  const stdout = "See per-run HTML report at /tmp/run/testResults.html   \n";
  assert.equal(parseHtmlReportPath(stdout), "/tmp/run/testResults.html");
});

test("parseHtmlReportPath returns undefined when the line is absent", () => {
  assert.equal(parseHtmlReportPath("See detailed results at /tmp/out.json"), undefined);
  assert.equal(parseHtmlReportPath(""), undefined);
});

test("renderMarkdownSummary renders a Passed heading and table", () => {
  const md = renderMarkdownSummary({ summary: { specs: { pass: 1, fail: 0 } } });
  assert.match(md, /✅ Passed/);
  assert.match(md, /\| Category \| Pass \| Fail \|/);
  assert.match(md, /\| Specs \| 1 \| 0 \|/);
});

test("renderMarkdownSummary renders a Failed heading when fail > 0", () => {
  const md = renderMarkdownSummary({ summary: { specs: { pass: 2, fail: 1 } } });
  assert.match(md, /❌ Failed/);
});

test("renderMarkdownSummary includes every bucket and extra numeric fields", () => {
  const md = renderMarkdownSummary({
    summary: {
      specs: { pass: 1, fail: 0 },
      tests: { pass: 3, fail: 0, skipped: 1 },
    },
  });
  assert.match(md, /\| Skipped \|/);
  assert.match(md, /\| Specs \|/);
  assert.match(md, /\| Tests \|/);
});

test("renderMarkdownSummary does not throw on missing or empty summary", () => {
  assert.match(renderMarkdownSummary({}), /No summary available/);
  assert.match(renderMarkdownSummary(undefined), /No summary available/);
  assert.match(renderMarkdownSummary({ summary: {} }), /No summary available/);
});
