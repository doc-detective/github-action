import semver from "semver";

// `engines.node` of doc-detective 5.2.1 and later. 5.0.0 to 5.2.0 took any
// Node.js from 24.15.0, and the check uses this one range for every CLI 5. So
// a `version` pinned to 5.0.0 through 5.2.0 gets a false warning on a Node.js
// that pin supports, such as 24.15 through 24.22.0.
const CLI_NODE_RANGE = "^24.22.1 || >=26.12.1";

/**
 * A warning when the job's `node`, which `npx` runs Doc Detective with, is
 * outside the range CLI 5 supports. The action itself runs on its own Node.js,
 * so this checks `node --version` output, not `process.version`. Unreadable
 * output gets none.
 */
export function nodeVersionWarning(version: string): string | undefined {
  const shown = version.trim();
  const parsed = semver.coerce(shown);
  if (!parsed || semver.satisfies(parsed, CLI_NODE_RANGE)) return undefined;
  return `Doc Detective 5.2.1 and later need Node.js 24.22.1 or later on the 24 line, or Node.js 26.12.1 or later, but this job runs ${shown}. Add \`actions/setup-node\` with \`node-version: 24\` or \`node-version: 26\`.`;
}

const COMPARATOR =
  /^(<=|>=|<|>|=|\^|~>?)?v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-[\w.-]+)?(?:\+[\w.-]+)?$/i;

/** True if this comparator alone keeps a range below 5.0.0. */
function capsBelowFive([, op = "", major, minor = "0", patch = "0"]: RegExpMatchArray): boolean {
  if (op === ">" || op === ">=") return false;
  if (!/^\d+$/.test(major)) return false;
  if (Number(major) < 5) return true;
  // `<5` and `<5.0.0` exclude 5.0.0. `<5.1` doesn't.
  return op === "<" && Number(major) === 5 && Number(minor) === 0 && Number(patch) === 0;
}

/**
 * Whether the `version` input can install CLI 5 or later, so the Node.js
 * preflight applies: `latest`, or a version or npm range that reaches 5. An
 * empty version (a linked CLI) and other dist-tags can't be told offline, so
 * they get no preflight. The range check is v1.7's version guard.
 */
export function canInstallCli5(version: string): boolean {
  if (version === "latest") return true;
  if (version === "") return false;
  const alternatives = version.split("||").map((range) =>
    range
      .trim()
      // `a - b` is bounded by b.
      .replace(/^\S+\s+-\s+(\S+)$/, "<=$1")
      // `>= 4` is `>=4`.
      .replace(/([<>=^~]+)\s+/g, "$1")
      .split(/\s+/)
      .map((comparator) => comparator.match(COMPARATOR))
  );
  // A value that isn't a version or range is a dist-tag.
  if (alternatives.flat().includes(null)) return false;
  return alternatives.some((comparators) => !comparators.some((c) => capsBelowFive(c!)));
}
