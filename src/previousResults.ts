import crypto from "crypto";
import fs from "fs";
import path from "path";
import semver from "semver";
import { isExactVersion } from "./runtimeCache.ts";
import { prBase } from "./pullRequest.ts";

/** The first Doc Detective version with `--compare-to` and `--fail-on`. */
export const MIN_COMPARE_VERSION = "5.9.0";

type Env = Record<string, string | undefined>;
type Cache = {
  restoreCache: (paths: string[], primaryKey: string, restoreKeys?: string[]) => Promise<string | undefined>;
  saveCache: (paths: string[], key: string) => Promise<number>;
};

/** An error's message, without a trailing period: callers end the sentence. (index.ts's `cause` adds one instead.) */
const cause = (error: unknown) => String((error as Error)?.message ?? error).replace(/\.?\s*$/, "");

/** `fail_on`: `any` (the default) or `new`. */
export function parseFailOn(value: string): "any" | "new" {
  const v = value.trim().toLowerCase() || "any";
  if (v === "any" || v === "new") return v;
  throw new Error(`Couldn't read \`fail_on\`: set it to \`any\` or \`new\`, not \`${value.trim()}\`.`);
}

/** `compare_to`: `previous` (the default), `false`, or a path. */
export function parseCompareTo(value: string, failOn: "any" | "new"): string {
  const v = value.trim() || "previous";
  const lower = v.toLowerCase();
  const compareTo = lower === "previous" || lower === "false" ? lower : v;
  if (compareTo === "false" && failOn === "new") {
    throw new Error("Couldn't apply `fail_on: new`: it needs a comparison, but `compare_to` is `false`. Set `compare_to` to `previous` or a path, or `fail_on` to `any`.");
  }
  return compareTo;
}

/**
 * Cache keys for this job's results: one OS, job, set of inputs, and branch
 * (the base branch on pull requests). Matrix legs with identical inputs share
 * a prefix, and the newest entry wins.
 */
export function resultsKeyPrefix({
  platform,
  config,
  input,
  cwd,
  env,
}: {
  platform: string;
  config: string;
  input: string;
  cwd: string;
  env: Env;
}): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify([config, input, cwd])).digest("hex").slice(0, 12);
  return `doc-detective-results-${platform}-${env.GITHUB_JOB ?? ""}-${hash}-${prBase(env)}-`;
}

export function resultsSaveKey(prefix: string, env: Env): string {
  // GITHUB_ACTION is the step's ID, unique per invocation in a job; caches are immutable.
  return `${prefix}${env.GITHUB_RUN_ID ?? ""}-${env.GITHUB_RUN_ATTEMPT ?? ""}-${env.GITHUB_ACTION ?? ""}`;
}

/** Where the previous results live, the same path at save and restore. */
export function previousResultsPath(runnerTemp: string): string {
  return path.join(runnerTemp, "doc-detective-previous", "testResults.json");
}

/**
 * Warnings when `version` resolves to an exact CLI version that predates run
 * comparison; empty means compare. A range, a tag, or an empty `version` (a
 * linked CLI) can't be checked without npm, so the action assumes support. With
 * `cache` on, index.ts has already resolved a range or tag to an exact version.
 */
export function compareSupportWarnings(version: string, failOn: "any" | "new"): string[] {
  // coerce drops a prerelease tag, so 5.9.0-rc.1 counts as 5.9.0.
  if (!isExactVersion(version) || !semver.lt(semver.coerce(version)!, MIN_COMPARE_VERSION)) return [];
  return [
    `Couldn't compare with the previous run: Doc Detective ${version} doesn't support \`compare_to\`. Set \`version\` to ${MIN_COMPARE_VERSION} or later.`,
    ...(failOn === "new" ? [`Ignoring \`fail_on: new\`, so any failure fails the run. Set \`version\` to ${MIN_COMPARE_VERSION} or later.`] : []),
  ];
}

/** CLI arguments for `compare_to` and `fail_on`. `--fail-on` only when `new`, so the default works on any CLI. */
export function comparisonArgs({
  compareTo,
  failOn,
  restored,
}: {
  compareTo: string;
  failOn: "any" | "new";
  restored?: string;
}): string[] {
  const target = compareTo === "previous" ? restored : compareTo === "false" ? undefined : compareTo;
  return [
    ...(compareTo === "false" ? ["--no-compare-to"] : target ? ["--compare-to", target] : []),
    ...(failOn === "new" ? ["--fail-on", "new"] : []),
  ];
}

/** Restore the newest results for `prefix` to `file`. Returns `file` on a hit. Any error warns. */
export async function restorePreviousResults({
  cache,
  file,
  prefix,
  warning,
}: {
  cache: Cache;
  file: string;
  prefix: string;
  warning: (message: string) => void;
}): Promise<string | undefined> {
  try {
    return (await cache.restoreCache([file], prefix, [prefix])) ? file : undefined;
  } catch (error) {
    warning(`Couldn't restore the previous results: ${cause(error)}. Failures won't be marked new or already failing.`);
    return undefined;
  }
}

/**
 * Save this run's results for the next run's comparison. Skips pull request
 * events: their cache entries are scoped to the pull request's ref, so later
 * runs on other refs can't read them. Returns whether it saved. Any error warns.
 */
export async function saveResults({
  cache,
  output,
  file,
  key,
  event,
  warning,
}: {
  cache: Cache;
  output: string;
  file: string;
  key: string;
  event: string;
  warning: (message: string) => void;
}): Promise<boolean> {
  if (event === "pull_request" || event === "pull_request_target" || !fs.existsSync(output)) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(output, file);
    return (await cache.saveCache([file], key)) !== -1;
  } catch (error) {
    warning(`Couldn't save this run's results for the next comparison: ${cause(error)}.`);
    return false;
  }
}
