// Action v1 runs CLI 4. CLI 5 changes the exit codes and logging this release
// was written for, so v1 refuses any `version` that can resolve to it.

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
 * Whether a version or npm range can resolve to CLI 5 or later, or null if the
 * value isn't a version or range at all, which makes it a dist-tag.
 * ponytail: handles npm range syntax, not exotic prerelease bounds. `<5.0.0-rc.1` refuses.
 */
function canReachFive(version: string): boolean | null {
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
  if (alternatives.flat().includes(null)) return null;
  return alternatives.some(
    (comparators) => !comparators.some((c) => capsBelowFive(c as RegExpMatchArray))
  );
}

export function checkVersion(version: string): {
  refusal?: string;
  warning?: string;
} {
  if (version === "") return {};
  const reaches = version === "latest" ? true : canReachFive(version);
  if (reaches === true) {
    return {
      refusal: `doc-detective/github-action@v1 supports Doc Detective 4 and earlier, but version "${version}" can install 5 or later. Use doc-detective/github-action@v2 for Doc Detective 5, or set version to 4.`,
    };
  }
  if (reaches === null) {
    return {
      warning: `Can't tell which Doc Detective version the "${version}" tag installs. doc-detective/github-action@v1 supports 4 and earlier. Use doc-detective/github-action@v2 for 5.`,
    };
  }
  return {};
}
