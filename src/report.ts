import * as core from "@actions/core";
import { DefaultArtifactClient } from "@actions/artifact";
import * as fs from "fs";
import * as path from "path";

/**
 * Format a caught value for a log message. A thrown non-`Error` (string, plain
 * object, etc.) has no `.message`, so `(error as Error).message` would log
 * "undefined"; fall back to `String(error)` to keep the warning informative.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extract the per-run HTML report path from captured Doc Detective stdout.
 *
 * Doc Detective 4.10.0+ announces the report on its own line, e.g.
 * `See per-run HTML report at /path/to/testResults.html`. We anchor the match
 * to that whole line (`^`/`$` in multiline mode, with the full "See ..."
 * prefix) rather than the brittle `split(...).pop()` approach that folded
 * trailing lines into the path and broke the JSON parse (see
 * doc-detective#346) — and rather than an unanchored substring match, which
 * could misfire on unrelated stdout that happens to contain the phrase.
 *
 * @param stdout - Captured stdout from the Doc Detective run.
 * @returns The trimmed HTML report path, or undefined when absent (older
 *   Doc Detective, v2, or the HTML reporter disabled).
 */
export function parseHtmlReportPath(stdout: string): string | undefined {
  if (!stdout) return undefined;
  const match = stdout.match(/^See per-run HTML report at\s+(.+?)\s*$/m);
  const captured = match?.[1]?.trim();
  return captured ? captured : undefined;
}

/**
 * Confine a candidate path to a trusted root before it's trusted for a copy
 * or upload. `parseHtmlReportPath` reads its input from captured stdout,
 * which reflects the specs/content under test (e.g. shell-step output) — an
 * untrusted repo could print a crafted "See per-run HTML report at ..." line
 * to smuggle an arbitrary runner-filesystem path (secrets, other jobs'
 * files) into the uploaded artifact. Real Doc Detective HTML reports live
 * under `<root>/.doc-detective/runs/<id>/`, so requiring containment inside
 * `root` (the same temp root passed to `--output`) costs nothing in the
 * legitimate case.
 *
 * Resolves symlinks on both sides before comparing (mirrors the confinement
 * check Doc Detective's own runFolderReporter uses), so a candidate that is —
 * or sits under — a symlink pointing outside `root` can't slip past a plain
 * string-prefix check.
 *
 * @param candidatePath - Path to confine (typically from `parseHtmlReportPath`).
 * @param root - Trusted root directory the path must resolve inside.
 * @returns The resolved real path if it exists and is confined to `root`;
 *   otherwise `undefined`.
 */
export function confineToRoot(candidatePath: string, root: string): string | undefined {
  try {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(candidatePath);
    if (realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep)) {
      return realCandidate;
    }
  } catch {
    // candidatePath or root doesn't exist / isn't accessible — not confined.
  }
  return undefined;
}

// Column ordering for the summary table: the well-known buckets first, then
// any other numeric fields Doc Detective happens to include, alphabetically.
const PREFERRED_FIELDS = ["pass", "fail", "skipped", "warning"];

function collectFields(buckets: Array<[string, Record<string, unknown>]>): string[] {
  const seen = new Set<string>();
  for (const [, value] of buckets) {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "number") seen.add(k);
    }
  }
  const preferred = PREFERRED_FIELDS.filter((f) => seen.has(f));
  const rest = [...seen].filter((f) => !PREFERRED_FIELDS.includes(f)).sort();
  return [...preferred, ...rest];
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Keep a Markdown table cell well-formed even for unexpected keys: escape the
// pipe that would start a new column and flatten any line breaks.
function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Render a Markdown summary of Doc Detective results, derived from the JSON
 * results object alone. Defensive about shape: the only documented contract is
 * `results.summary.specs.{pass,fail}`, so every field access is guarded and a
 * missing summary yields a short note instead of throwing.
 *
 * @param results - The parsed Doc Detective results object.
 * @returns Markdown suitable for a GitHub Actions job summary.
 */
export function renderMarkdownSummary(results: any): string {
  // Doc Detective's `runTests` returns `null` (which its JSON reporter writes
  // verbatim to the output file) only when it couldn't resolve any tests, so a
  // null result specifically means nothing ran.
  if (results === null) {
    return "## Doc Detective results\n\nNo tests were run.";
  }
  const summary = results?.summary;
  if (!summary || typeof summary !== "object") {
    return "## Doc Detective results\n\nNo summary available.";
  }

  // Buckets are the object-valued entries of `summary` (specs, tests, steps…).
  let buckets = Object.entries(summary).filter(
    ([, v]) => v && typeof v === "object"
  ) as Array<[string, Record<string, unknown>]>;

  // Fall back to treating `summary` itself as a single bucket if it only holds
  // flat numeric counts.
  if (buckets.length === 0) {
    const hasNumbers = Object.values(summary).some((v) => typeof v === "number");
    if (hasNumbers) buckets = [["summary", summary as Record<string, unknown>]];
  }

  // Keep only buckets that carry at least one numeric count. This drops
  // metadata-only objects (e.g. `{ specs: {} }` or `{ meta: { name: "x" } }`)
  // that would otherwise render as an all-"—" row under empty headers.
  buckets = buckets.filter(([, v]) =>
    Object.values(v).some((x) => typeof x === "number")
  );

  const fields = collectFields(buckets);
  if (buckets.length === 0 || fields.length === 0) {
    return "## Doc Detective results\n\nNo summary available.";
  }

  const totalFail = buckets.reduce((acc, [, v]) => {
    const fail = v["fail"];
    return acc + (typeof fail === "number" ? fail : 0);
  }, 0);
  const heading = totalFail > 0
    ? "## Doc Detective results: ❌ Failed"
    : "## Doc Detective results: ✅ Passed";

  const lines = [heading, ""];
  lines.push(`| Category | ${fields.map((f) => escapeCell(titleCase(f))).join(" | ")} |`);
  lines.push(`| --- | ${fields.map(() => "---").join(" | ")} |`);
  for (const [name, value] of buckets) {
    const cells = fields.map((f) => {
      const cell = value[f];
      return typeof cell === "number" ? String(cell) : "—";
    });
    lines.push(`| ${escapeCell(titleCase(name))} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

/**
 * Write the Markdown summary to the GitHub Actions job summary page. Best
 * effort: any failure is a warning, never a run failure.
 */
export async function writeJobSummary(markdown: string): Promise<void> {
  try {
    await core.summary.addRaw(markdown).addEOL().write();
  } catch (error) {
    core.warning(`Failed to write job summary: ${errorMessage(error)}`);
  }
}

// Characters GitHub disallows in artifact names.
const ARTIFACT_NAME_DISALLOWED = /["<>|*?:\r\n\\/]/g;

/**
 * Build a per-invocation artifact name by suffixing the base with the job, the
 * runner OS, and the step discriminator. The `@actions/artifact` upload service
 * scopes artifacts per run and rejects duplicate names, so any workflow that
 * invokes the action more than once would otherwise produce colliding names and
 * silently drop all but the first upload.
 * - `GITHUB_JOB` + `RUNNER_OS` distinguish matrix jobs (as this repo's own tests
 *   run).
 * - `GITHUB_ACTION` distinguishes multiple invocations *within one job* — GitHub
 *   makes it unique per step (`__self`, `__self_2`, …), so two "Run Doc
 *   Detective" steps in the same job get distinct artifacts.
 * Absent env vars are skipped, so this degrades to the bare base name off
 * GitHub Actions.
 *
 * @param base - Base artifact name.
 * @param env - Environment to read `GITHUB_JOB` / `RUNNER_OS` / `GITHUB_ACTION` from.
 */
export function reportArtifactName(
  base: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const parts = [base, env.GITHUB_JOB, env.RUNNER_OS, env.GITHUB_ACTION].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0
  );
  return parts.join("-").replace(ARTIFACT_NAME_DISALLOWED, "-");
}

/**
 * Upload the report files as a workflow artifact so they're downloadable from
 * the run. Best effort: any failure is a warning, never a run failure.
 *
 * @param name - Artifact name.
 * @param files - Absolute paths to the files to include.
 * @param rootDirectory - Common ancestor of `files`; determines artifact layout.
 */
export async function uploadReportArtifact(
  name: string,
  files: string[],
  rootDirectory: string
): Promise<void> {
  if (files.length === 0) return;
  try {
    const client = new DefaultArtifactClient();
    const { id } = await client.uploadArtifact(name, files, rootDirectory);
    core.info(`Uploaded "${name}" artifact (id: ${id ?? "unknown"}).`);
  } catch (error) {
    core.warning(`Failed to upload report artifact: ${errorMessage(error)}`);
  }
}
