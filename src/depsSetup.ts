// Per-repo persistent runtime cache for the Doc Detective action.
//
// Every run of the action executes `npx doc-detective`, and Doc Detective keeps
// its heavy runtime (webdriverio, Appium + drivers, sharp, ffmpeg, browsers,
// geckodriver) out of `dependencies` and installs it at first use into
// DOC_DETECTIVE_CACHE_DIR — wiped per job on hosted runners. Result: every CI
// run pays the full download/install warm-up. This module points that cache dir
// at a stable path and restores/saves it across runs via @actions/cache, so
// after the first run in a repo the deps are restored instead of reinstalled.
//
// Mirrors the WDA-cache pattern in iosSetup.ts: the version-resolution + key
// halves are pure (unit-testable); the cache restore/save shell out to
// @actions/cache and are injected for tests. A stale (prefix) restore is safe —
// Doc Detective's own version skip-filter reinstalls only out-of-range deps.

import path from "path";
import { execSync } from "child_process";
import { sanitizeKeySegment } from "./cacheKeys.ts";

// Bump to invalidate every cached deps tree (e.g. after a cache-shape change
// that the doc-detective version wouldn't catch).
const CACHE_VERSION = "v1";

// Matches an exact semver (major.minor.patch, ignoring any pre-release/build
// suffix) — an already-pinned `version` input that needs no registry lookup.
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+/;

/**
 * Resolve the action's `version` input to an exact version for a deterministic
 * cache key:
 *   - Exact semver (`2.15.0`, `2.15.0-beta.1`) → use as-is.
 *   - A dist-tag (`latest`, `staging-…`) → resolve via
 *     `npm view doc-detective@<tag> version`; "unknown" on any error (the key
 *     still works, it's just coarser and won't be an exact hit).
 *   - Empty (local dog-food / `npm link` mode) → "local".
 * The command runner is injected so it's unit-testable (mirrors
 * detectXcuitestDriverVersion in iosSetup.ts).
 */
export async function resolveDdVersion(
  versionInput: string,
  run: (command: string) => string = (c) => execSync(c).toString()
): Promise<string> {
  const value = (versionInput || "").trim();
  if (value === "") return "local";
  if (EXACT_SEMVER_RE.test(value)) return value;
  try {
    return run(`npm view doc-detective@${value} version`).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Exact cache key from the runner platform/arch + node major + resolved
 * doc-detective version: `dd-deps-v1-<platform>-<arch>-node<major>-<ddVersion>`.
 * Keying on the exact doc-detective version makes a new release a non-exact
 * (prefix) hit rather than a stale exact hit: the old tree still warms the
 * install, and the healed tree is saved under the new key.
 */
export function depsCacheKey({
  platform,
  arch,
  nodeMajor,
  ddVersion,
}: {
  platform: string;
  arch: string;
  nodeMajor: string | number;
  ddVersion: string;
}): string {
  return `${depsCacheKeyPrefix({ platform, arch, nodeMajor })}${sanitizeKeySegment(
    ddVersion
  )}`;
}

/**
 * The exact key minus the trailing `-<ddVersion>` — passed as a restore-keys
 * fallback so a stale-version cache can still seed the run (Doc Detective's own
 * version skip-filter reinstalls only out-of-range deps).
 */
export function depsCacheKeyPrefix({
  platform,
  arch,
  nodeMajor,
}: {
  platform: string;
  arch: string;
  nodeMajor: string | number;
}): string {
  return `dd-deps-${CACHE_VERSION}-${sanitizeKeySegment(
    platform
  )}-${sanitizeKeySegment(arch)}-node${sanitizeKeySegment(
    String(nodeMajor)
  )}-`;
}

/**
 * The Doc Detective cache-dir subpaths worth persisting: the installed runtime
 * node_modules, the downloaded browsers, and the record of what's installed.
 * Deliberately excludes `<cacheDir>/android-sdk` and `<cacheDir>/jre` (multi-GB;
 * Linux runners ship a preinstalled SDK that Doc Detective finds first).
 */
export function depsCachePaths(cacheDir: string): string[] {
  return [
    path.join(cacheDir, "runtime"),
    path.join(cacheDir, "browsers"),
    path.join(cacheDir, "installed.json"),
  ];
}

export interface DepsCacheDeps {
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
 * Restore the deps cache before the run. Returns the exact key and whether the
 * restore was an exact hit — the caller passes that back to `saveDepsCache` so
 * an unchanged cache isn't needlessly re-uploaded. Restore failures are
 * non-fatal (Doc Detective just installs the deps itself).
 */
export async function restoreDepsCache({
  cacheDir,
  key,
  prefix,
  deps,
}: {
  cacheDir: string;
  key: string;
  prefix: string;
  deps: DepsCacheDeps;
}): Promise<{ key: string; exactHit: boolean }> {
  const paths = depsCachePaths(cacheDir);
  try {
    const restoredKey = await deps.restoreCache(paths, key, [prefix]);
    const exactHit = restoredKey === key;
    deps.info(
      exactHit
        ? `Restored the Doc Detective runtime cache (${key}); dependency install is skipped.`
        : restoredKey
          ? `Restored an older Doc Detective runtime cache (${restoredKey}); it warms the install and is re-cached as ${key}.`
          : `No Doc Detective runtime cache yet (key ${key}); the first run installs dependencies and caches them.`
    );
    return { key, exactHit };
  } catch (error) {
    // A cache-service error isn't a definitive miss — Doc Detective just
    // installs cold — so warn rather than claim "no cache yet". Report
    // exactHit=false so the run still attempts to save afterward.
    deps.warning(
      `Doc Detective runtime cache restore failed (continuing; dependencies will install): ${
        (error as Error)?.message ?? error
      }`
    );
    return { key, exactHit: false };
  }
}

/**
 * Save the deps cache after the run, unless the restore was already an exact
 * hit. Best-effort — a save failure (e.g. a concurrent run saved the same key)
 * is a warning, not a run failure.
 */
export async function saveDepsCache({
  cacheDir,
  key,
  exactHit,
  deps,
}: {
  cacheDir: string;
  key: string;
  exactHit: boolean;
  deps: DepsCacheDeps;
}): Promise<void> {
  if (exactHit) return;
  try {
    await deps.saveCache(depsCachePaths(cacheDir), key);
    deps.info(`Saved the Doc Detective runtime cache (${key}).`);
  } catch (error) {
    deps.warning(
      `Doc Detective runtime cache save failed (non-fatal): ${
        (error as Error)?.message ?? error
      }`
    );
  }
}
