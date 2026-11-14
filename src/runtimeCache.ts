import fs from "fs";
import os from "os";
import path from "path";

/**
 * The exact version `npm view doc-detective@<spec> version --json` printed: a
 * string for one match, an array (ascending) for a range. Undefined if none.
 */
export function exactVersion(npmViewJson: string): string | undefined {
  try {
    const parsed = JSON.parse(npmViewJson);
    const version = Array.isArray(parsed) ? parsed.at(-1) : parsed;
    return typeof version === "string" && version ? version : undefined;
  } catch {
    return undefined;
  }
}

/** True for a version npm can't resolve to anything else, like `5.0.0`. */
export function isExactVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/.test(version);
}

/**
 * Where CLI 5 keeps its runtime when neither `--cache-dir`,
 * DOC_DETECTIVE_CACHE_DIR, nor the config's `cacheDir` says otherwise. Mirrors
 * `defaultCacheRoot` in doc-detective's `src/runtime/cacheDir.ts`.
 */
// ponytail: copied from the CLI, so a CLI change to its default means the action
// caches an empty folder (a miss, never a failure). Ask the CLI if that happens.
export function defaultCacheRoot({
  env = process.env,
  home = os.homedir(),
  platform = process.platform,
  exists = fs.existsSync,
}: {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: string;
  exists?: (p: string) => boolean;
} = {}): string {
  const legacy = path.join(home, ".doc-detective");
  if (exists(legacy)) return legacy;
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, "doc-detective");
  if (platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "doc-detective");
  return path.join(home, ".cache", "doc-detective");
}

/**
 * What the action caches: the npm runtime, the browsers, and the record of
 * both. Not the multi-gigabyte Android SDK, JRE, or WebDriverAgent builds.
 */
export function cachePaths(root: string): string[] {
  return ["runtime", "browsers", "installed.json"].map((p) => path.join(root, p));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One key per CLI version, OS, CPU, Node.js major (sharp is a native module),
 * and week. CLI 5 never replaces a browser it already installed, so the week
 * caps how far the cached Chrome and Firefox fall behind their stable channel.
 */
export function cacheKey({
  version,
  platform,
  arch,
  nodeVersion,
  now,
}: {
  version: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  now: number;
}): string {
  const nodeMajor = nodeVersion.trim().match(/^v?(\d+)/)?.[1] ?? "unknown";
  const week = Math.floor(now / WEEK_MS);
  return `doc-detective-runtime-${version}-${platform}-${arch}-node${nodeMajor}-w${week}`;
}
