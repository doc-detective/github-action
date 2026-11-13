/**
 * A warning when the job's `node`, which `npx` runs Doc Detective with, is older
 * than CLI 5 needs. The action itself runs on its own Node.js, so this checks
 * `node --version` output, not `process.version`. Unreadable output gets none.
 */
export function nodeVersionWarning(version: string): string | undefined {
  const shown = version.trim();
  const match = shown.match(/^v?(\d+)\.(\d+)/);
  if (!match) return undefined;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (major > 24 || (major === 24 && minor >= 15)) return undefined;
  return `Doc Detective 5 needs Node.js 24.15 or later, but this job runs ${shown}. Add \`actions/setup-node\` with \`node-version: 24\`.`;
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
