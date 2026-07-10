import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import {
  errorMessage,
  parseHtmlReportPath,
  renderMarkdownSummary,
  reportArtifactName,
} from "./report.ts";

test("errorMessage uses Error.message and stringifies non-Errors", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain string"), "plain string");
  assert.equal(errorMessage(undefined), "undefined");
  assert.equal(errorMessage({ code: 1 }), "[object Object]");
});

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

test("parseHtmlReportPath ignores the phrase mid-line instead of at the start", () => {
  // Anchored to the start of the line (with the full "See ..." prefix) so
  // unrelated stdout that happens to mention the phrase can't be misread as
  // the report path.
  assert.equal(
    parseHtmlReportPath('Test log: "per-run HTML report at /tmp/decoy.html" was expected but not found'),
    undefined
  );
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

test("renderMarkdownSummary escapes pipes/newlines in bucket and field names", () => {
  const md = renderMarkdownSummary({
    summary: { "a|b": { "p|q": 1, fail: 0 } },
  });
  // The literal pipe must be escaped so it doesn't start a new table column.
  assert.match(md, /A\\\|b/);
  assert.match(md, /P\\\|q/);
});

test("renderMarkdownSummary reports 'No tests were run' for a null result", () => {
  // Doc Detective writes `null` to the output file when it resolves no tests.
  const md = renderMarkdownSummary(null);
  assert.match(md, /No tests were run/);
  assert.doesNotMatch(md, /No summary available/);
});

test("reportArtifactName suffixes with job, runner OS, and step discriminator", () => {
  assert.equal(
    reportArtifactName("doc-detective-report", {
      GITHUB_JOB: "pass",
      RUNNER_OS: "Linux",
      GITHUB_ACTION: "__self",
    }),
    "doc-detective-report-pass-Linux-__self"
  );
});

test("reportArtifactName distinguishes multiple invocations in one job", () => {
  // Same job + OS, different step discriminators must yield different names so
  // artifact/artifact v4 doesn't reject the second upload.
  const base = { GITHUB_JOB: "ci", RUNNER_OS: "Linux" };
  const first = reportArtifactName("doc-detective-report", { ...base, GITHUB_ACTION: "__self" });
  const second = reportArtifactName("doc-detective-report", { ...base, GITHUB_ACTION: "__self_2" });
  assert.notEqual(first, second);
});

test("reportArtifactName falls back to the base name and sanitizes", () => {
  assert.equal(reportArtifactName("doc-detective-report", {}), "doc-detective-report");
  // Disallowed characters in env values are replaced so the upload can't fail.
  assert.equal(
    reportArtifactName("doc-detective-report", { GITHUB_JOB: "a/b:c" }),
    "doc-detective-report-a-b-c"
  );
});

test("renderMarkdownSummary handles buckets with no numeric fields", () => {
  // Object buckets that carry no counts must not produce a malformed table
  // (empty headers / all-"—" rows) — they degrade to "No summary available".
  assert.match(renderMarkdownSummary({ summary: { specs: {} } }), /No summary available/);
  assert.match(
    renderMarkdownSummary({ summary: { meta: { name: "run" } } }),
    /No summary available/
  );
  // A metadata-only bucket alongside a real one is dropped, not rendered.
  const md = renderMarkdownSummary({
    summary: { specs: { pass: 1, fail: 0 }, meta: { name: "run" } },
  });
  assert.match(md, /\| Specs \| 1 \| 0 \|/);
  assert.doesNotMatch(md, /Meta/);
});
