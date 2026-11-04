const COMPARATOR =
  /^(<=|>=|<|>|=|\^|~>?)?v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-[\w.-]+)?(?:\+[\w.-]+)?$/i;

/** True if this comparator alone keeps a range below 5.0.0. */
function capsBelowFive(match: RegExpMatchArray): boolean {
  const [, op = "", major, minor = "0", patch = "0"] = match;
  if (op === ">" || op === ">=") return false;
  if (!/^\d+$/.test(major)) return false;
  if (Number(major) < 5) return true;
  // `<5` and `<5.0.0` exclude 5.0.0. `<5.1` doesn't.
  return op === "<" && Number(major) === 5 && Number(minor) === 0 && Number(patch) === 0;
}

/**
 * Whether the `version` input runs a CLI with `--output-dir`, which arrived in 5.
 * CLI 4's strict parser rejects the flag, so only a version or range that stays
 * below 5 goes without it. An empty version, meaning the linked build, has it.
 * So does a dist-tag, which can't be resolved without a registry call.
 */
export function supportsOutputDir(version: string): boolean {
  if (version === "") return true;
  const alternatives = version
    .split("||")
    .map((range) =>
      range
        .trim()
        // `a - b` is bounded by b.
        .replace(/^\S+\s+-\s+(\S+)$/, "<=$1")
        // `>= 4` is `>=4`.
        .replace(/([<>=^~]+)\s+/g, "$1")
        .split(/\s+/)
        .map((comparator) => comparator.match(COMPARATOR))
    );
  if (alternatives.flat().includes(null)) return true;
  return alternatives.some(
    (comparators) => !comparators.some((c) => capsBelowFive(c as RegExpMatchArray))
  );
}
