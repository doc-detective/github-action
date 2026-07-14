// iOS support for the Doc Detective action.
//
// RETIRED: the WebDriverAgent (WDA) build cache this module used to manage
// (github-action#74) is gone. Doc Detective v4.28+ prebuilds and manages WDA
// products itself — `doc-detective install ios --yes` compiles WDA once into
// the Doc Detective cache, keyed by Xcode version × XCUITest driver version,
// and test sessions consume the products automatically and read-only. The
// action-side derivedData cache was redundant next to that (running both
// double-built WDA on cold runs), and its driver-blind key was the
// stale-cache failure mode doc-detective's ADR 01033/01059 record. The `ios`
// input is now a deprecated no-op; what remains here is the spec detection
// that decides whether to surface a migration notice on runs that would have
// used the cache.

import { scanSpecs, realScanDeps, type ScanDeps } from "./scanSpecs.ts";

// Matches an `ios` value on a `platform`/`platforms` field — mirrors the
// android matcher: `"platform": "ios"`, `"platforms": "ios"`, and the array
// forms `"platforms": ["ios", ...]` / `["safari", "ios"]`.
export const IOS_PLATFORM_RE =
  /["']platforms?["']\s*:\s*(?:\[[^\]]*?)?["']ios["']/i;

/** True if the given text requests the `ios` target platform. */
export function textRequestsIos(text: string): boolean {
  return IOS_PLATFORM_RE.test(text);
}

/** Walk `roots` and return true as soon as any spec requests the `ios` platform. */
export function scanForIos(
  roots: string[],
  deps: ScanDeps = realScanDeps,
  maxDepth = 6
): boolean {
  return scanSpecs(roots, textRequestsIos, deps, maxDepth);
}

/**
 * Decide whether to surface the WDA-cache retirement notice: exactly the
 * runs the retired cache would have covered (macOS + `ios` input true, or
 * auto with an ios platform detected in the specs) get pointed at
 * `doc-detective install ios`; everything else stays silent.
 */
export function shouldNoticeRetiredWdaCache({
  iosInput,
  platform,
  roots,
  scan = scanForIos,
}: {
  iosInput: string;
  platform: NodeJS.Platform;
  roots: string[];
  scan?: (roots: string[]) => boolean;
}): { notify: boolean; reason: string } {
  const value = (iosInput || "auto").trim().toLowerCase();
  if (value === "false") return { notify: false, reason: "ios input is false" };
  if (platform !== "darwin") {
    return { notify: false, reason: "not a macOS runner" };
  }
  if (value === "true") return { notify: true, reason: "ios input is true" };
  // auto
  return scan(roots)
    ? { notify: true, reason: "auto-detected an ios platform in your specs" }
    : { notify: false, reason: "no ios platform detected in specs" };
}

/** The migration notice shown once per run in place of the retired cache. */
export const WDA_CACHE_RETIREMENT_NOTICE =
  "The `ios` WebDriverAgent build cache was retired: Doc Detective v4.28+ prebuilds and manages WDA itself, keyed by your Xcode and driver versions. Upgrade to v4.28+ if necessary, then run `npx doc-detective install ios --yes` with a persisted cache directory before this action — see https://doc-detective.com/docs/ci/github-action#speed-up-ios-tests-on-macos. The `ios` input is now a no-op; iOS tests still work and build WebDriverAgent in-session when no prebuilt products exist.";
