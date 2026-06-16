import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { loadResults } from "./loadResults.ts";

function tmpOutput(contents?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gha-"));
  const outputPath = path.join(dir, "doc-detective-output.json");
  if (contents !== undefined) fs.writeFileSync(outputPath, contents);
  return outputPath;
}

test("loads results from the --output file, ignoring trailing stdout lines", () => {
  const results = { summary: { specs: { fail: 0, pass: 1 } } };
  const outputPath = tmpOutput(JSON.stringify(results));
  const runDir = path.join(path.dirname(outputPath), "run-x");

  // Reproduce the multi-line CLI output that broke the old stdout parser: the
  // JSON "results at" line is followed by an HTML "report at" line, so
  // `split("results at ").pop()` captured "<json>\n\nSee per-run HTML report
  // at <html>" instead of a path. See doc-detective#346.
  const stdout = [
    `See detailed results at ${outputPath}`,
    `See per-run results at ${path.join(runDir, "testResults.json")}`,
    `See per-run HTML report at ${path.join(runDir, "testResults.html")}`,
  ].join("\n\n");

  assert.deepEqual(loadResults(outputPath, stdout), results);
});

test("throws a clear error when the output file is missing", () => {
  const outputPath = tmpOutput(); // file not written
  assert.throws(
    () => loadResults(outputPath, "some stdout"),
    /did not write results/
  );
});

test("throws a clear error when the output file isn't valid JSON", () => {
  const outputPath = tmpOutput("{ not json");
  assert.throws(() => loadResults(outputPath), /Failed to parse/);
});

test("throws when no output path is provided", () => {
  assert.throws(() => loadResults(""), /No output path/);
});
