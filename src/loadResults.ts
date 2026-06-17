import fs from "fs";

/**
 * Load Doc Detective results from the file the action passed via `--output`.
 *
 * Reads that file directly rather than scraping the results path back out of
 * stdout. Log wording is human-facing and free to change: doc-detective 4.10.0
 * added a "See per-run HTML report at ..." line *after* the JSON results line,
 * and the old `stdout.split("results at ").pop()` parse folded that trailing
 * line into the path and broke the release smoke test
 * (https://github.com/doc-detective/doc-detective/pull/346). The output path is
 * a contract this action sets itself, so it is the reliable source of truth.
 *
 * @param outputPath - Absolute path passed to Doc Detective's `--output`.
 * @param stdout - Captured stdout, surfaced in errors for debugging.
 * @returns The parsed results object.
 * @throws if the path is empty, the file is absent/unreadable, or not valid JSON.
 */
export function loadResults(outputPath: string, stdout = ""): any {
  if (!outputPath) {
    throw new Error(
      "No output path was provided to load Doc Detective results from."
    );
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `Doc Detective did not write results to ${outputPath}. The run may have ` +
        `exited before writing output, or a custom config disabled the JSON ` +
        `reporter.\nstdout:\n${stdout}`
    );
  }
  let raw: string;
  try {
    raw = fs.readFileSync(outputPath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read Doc Detective results at ${outputPath}: ${(error as Error).message}\nstdout:\n${stdout}`
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse Doc Detective results at ${outputPath}: ${(error as Error).message}\nstdout:\n${stdout}`
    );
  }
}
