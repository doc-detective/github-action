// iOS WebDriverAgent build-cache support for the Doc Detective action.
//
// The first XCUITest session in a run compiles WebDriverAgent (WDA) from source
// via `xcodebuild` — ~10 minutes on a cold, ephemeral macOS runner, and the
// dominant cost of any iOS run. Doc Detective writes WDA's build products to
// `appium:derivedDataPath` when DOC_DETECTIVE_IOS_WDA_DERIVED_DATA_PATH is set;
// this action sets that env var to a stable path and caches it across runs, so
// after the first run WDA is restored and the build becomes near-instant. The
// XCUITest driver validates the installed WDA and rebuilds on a version
// mismatch, so a stale cache self-heals.
//
// The detection + decision + key halves are pure (unit-testable); the cache
// restore/save shell out to @actions/cache and are injected for tests.

import os from "os";
import { execSync } from "child_process";
import { scanSpecs, realScanDeps, type ScanDeps } from "./scanSpecs.ts";
import { sanitizeKeySegment } from "./cacheKeys.ts";

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
 * Resolve whether the WebDriverAgent build cache should be set up, from the
 * `ios` input ("auto" | "true" | "false") and the host. iOS simulators +
 * XCUITest are macOS-only, so there's nothing to cache off macOS. `auto` scans
 * the specs and only caches when an ios platform is present (so a non-iOS macOS
 * run doesn't pay the cache round-trip).
 */
export function shouldCacheWda({
  iosInput,
  platform,
  roots,
  scan = scanForIos,
}: {
  iosInput: string;
  platform: NodeJS.Platform;
  roots: string[];
  scan?: (roots: string[]) => boolean;
}): { setUp: boolean; reason: string } {
  const value = (iosInput || "auto").trim().toLowerCase();
  if (value === "false") return { setUp: false, reason: "ios input is false" };
  if (platform !== "darwin") {
    return {
      setUp: false,
      reason:
        value === "true"
          ? "ios requested, but the WebDriverAgent cache only applies to macOS runners (iOS simulators are macOS-only)"
          : "not a macOS runner",
    };
  }
  if (value === "true") return { setUp: true, reason: "ios input is true" };
  // auto
  return scan(roots)
    ? { setUp: true, reason: "auto-detected an ios platform in your specs" }
    : { setUp: false, reason: "no ios platform detected in specs" };
}

// Bump to invalidate every cached WDA build (e.g. after a WDA-shape change
// that neither the Xcode nor the driver version would catch).
const CACHE_VERSION = "v2";

/**
 * Exact cache key from the runner OS + Xcode version + XCUITest driver
 * version. The driver version matters because WDA's source ships inside
 * appium-xcuitest-driver, which Doc Detective JIT-installs at its latest
 * version: a cache built for an older driver is stale, and (v1 lesson) a
 * *stale exact hit* is the worst case — the driver rebuilds WDA nearly from
 * scratch every run, and the exact hit suppresses the post-run save, so the
 * cache never heals until the Xcode image moves. Keying on the driver version
 * makes a driver release a non-exact (prefix) hit instead: the old build
 * still warms the compile, and the healed build is saved under the new key.
 */
export function wdaCacheKey(
  xcodeVersion: string,
  driverVersion: string,
  platform: NodeJS.Platform = os.platform()
): string {
  return `${wdaCacheKeyPrefix(xcodeVersion, platform)}${sanitizeKeySegment(driverVersion)}`;
}

/**
 * The exact key minus the driver version — passed as a restore-keys fallback
 * so an older driver's build still restores for an incremental rebuild.
 */
export function wdaCacheKeyPrefix(
  xcodeVersion: string,
  platform: NodeJS.Platform = os.platform()
): string {
  return `dd-wda-${CACHE_VERSION}-${platform}-${sanitizeKeySegment(xcodeVersion)}-xcuitest-`;
}

/** Read the Xcode version line (e.g. "Xcode 26.5"); "unknown" if unavailable. */
export function detectXcodeVersion(
  run: (command: string) => string = (c) => execSync(c).toString()
): string {
  try {
    return run("xcodebuild -version").split(/\r?\n/)[0].trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Resolve the appium-xcuitest-driver version Doc Detective will JIT-install
 * (it installs the latest, so the registry's `latest` is the right predictor).
 * "unknown" on any failure — the key still works, it's just coarser.
 */
export function detectXcuitestDriverVersion(
  run: (command: string) => string = (c) => execSync(c).toString()
): string {
  try {
    return run("npm view appium-xcuitest-driver version").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export interface WdaCacheDeps {
  restoreCache: (
    paths: string[],
    key: string,
    restoreKeys?: string[]
  ) => Promise<string | undefined>;
  saveCache: (paths: string[], key: string) => Promise<number>;
  info: (m: string) => void;
  warning: (m: string) => void;
}

/**
 * Restore the WDA build cache before the run. Returns the exact key and whether
 * the restore was an exact hit — the caller passes that back to `saveWdaCache`
 * so an unchanged cache isn't needlessly re-uploaded. Restore failures are
 * non-fatal (WDA just builds cold).
 */
export async function restoreWdaCache({
  derivedDataPath,
  xcodeVersion,
  driverVersion,
  deps,
}: {
  derivedDataPath: string;
  xcodeVersion: string;
  driverVersion: string;
  deps: WdaCacheDeps;
}): Promise<{ key: string; exactHit: boolean }> {
  const key = wdaCacheKey(xcodeVersion, driverVersion);
  const prefix = wdaCacheKeyPrefix(xcodeVersion);
  try {
    const restoredKey = await deps.restoreCache([derivedDataPath], key, [
      prefix,
    ]);
    const exactHit = restoredKey === key;
    deps.info(
      exactHit
        ? `Restored the WebDriverAgent build cache (${key}); the WDA build will be incremental.`
        : restoredKey
          ? `Restored an older WebDriverAgent build (${restoredKey}); the build warms from it and is re-cached as ${key}.`
          : `No WebDriverAgent build cache yet (key ${key}); the first run compiles WDA (~10 min) and caches it.`
    );
    return { key, exactHit };
  } catch (error) {
    // A cache-service error isn't a definitive miss — WDA just builds cold — so
    // warn rather than claim "no cache yet". Report exactHit=false so the run
    // still attempts to save the freshly-built WDA afterward (a transient blip
    // shouldn't cost the next run its warm start); a save that also fails is a
    // best-effort warning.
    deps.warning(
      `WebDriverAgent cache restore failed (continuing; WDA will build): ${
        (error as Error)?.message ?? error
      }`
    );
    return { key, exactHit: false };
  }
}

/**
 * Save the WDA build cache after the run, unless the restore was already an
 * exact hit. Best-effort — a save failure (e.g. a concurrent run saved the same
 * key) is a warning, not a run failure.
 */
export async function saveWdaCache({
  derivedDataPath,
  key,
  exactHit,
  deps,
}: {
  derivedDataPath: string;
  key: string;
  exactHit: boolean;
  deps: WdaCacheDeps;
}): Promise<void> {
  if (exactHit) return;
  try {
    await deps.saveCache([derivedDataPath], key);
    deps.info(`Saved the WebDriverAgent build cache (${key}).`);
  } catch (error) {
    deps.warning(
      `WebDriverAgent cache save failed (non-fatal): ${
        (error as Error)?.message ?? error
      }`
    );
  }
}
