import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import semver from "semver";
import { parse as parseYaml } from "yaml";

/**
 * The highest version `npm view doc-detective@<spec> version --json` printed: a
 * string for one match, an array for a range, in publish order rather than
 * version order. Undefined if none.
 */
export function exactVersion(npmViewJson: string): string | undefined {
  try {
    const parsed = JSON.parse(npmViewJson);
    const version = Array.isArray(parsed) ? semver.rsort(parsed.filter((v) => semver.valid(v)))[0] : parsed;
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
// Copied from the CLI, so if the CLI changes its default, the action caches an
// empty folder: a miss, never a failure.
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

/**
 * The cache root the CLI will use, by its precedence: DOC_DETECTIVE_CACHE_DIR,
 * then `cacheDir` from DOC_DETECTIVE_CONFIG, then from the project config (the
 * `config` input, or `.doc-detective.json|yaml|yml` in `cwd`), then the
 * default. Mirrors `setConfig` in doc-detective's `src/utils.ts`: env values
 * resolve against `cwd`, a config file's against its folder unless it sets
 * `relativePathBase: "cwd"`. Skips the user-level config and remote configs.
 */
export function resolveCacheRoot({
  cwd,
  config = "",
  env = process.env,
  read = (file: string) => fs.readFileSync(file, "utf8"),
  exists = fs.existsSync,
}: {
  cwd: string;
  config?: string;
  env?: NodeJS.ProcessEnv;
  read?: (file: string) => string;
  exists?: (p: string) => boolean;
}): string {
  const fromEnv = env.DOC_DETECTIVE_CACHE_DIR?.trim();
  if (fromEnv) return path.resolve(cwd, fromEnv);
  const fromEnvConfig = cacheDirOf(() => env.DOC_DETECTIVE_CONFIG ?? "");
  if (fromEnvConfig) return path.resolve(cwd, fromEnvConfig.cacheDir);
  if (!/^https?:\/\//.test(config)) {
    const file = config
      ? path.resolve(cwd, config)
      : [".doc-detective.json", ".doc-detective.yaml", ".doc-detective.yml"].map((n) => path.join(cwd, n)).find(exists);
    const fromFile = file ? cacheDirOf(() => read(file)) : undefined;
    if (file && fromFile) {
      return path.resolve(fromFile.relativePathBase === "cwd" ? cwd : path.dirname(file), fromFile.cacheDir);
    }
  }
  return defaultCacheRoot({ env, exists });
}

/** `cacheDir` and `relativePathBase` from JSON or YAML text, if it sets a `cacheDir`. */
function cacheDirOf(text: () => string): { cacheDir: string; relativePathBase?: unknown } | undefined {
  try {
    const parsed = parseYaml(text());
    const cacheDir = typeof parsed?.cacheDir === "string" ? parsed.cacheDir.trim() : "";
    return cacheDir ? { cacheDir, relativePathBase: parsed.relativePathBase } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The part of the key that must match for a cache to restore at all: OS, CPU,
 * and Node.js major (sharp is a native module).
 */
export function cacheKeyPrefix({
  platform,
  arch,
  nodeVersion,
}: {
  platform: string;
  arch: string;
  nodeVersion: string;
}): string {
  const nodeMajor = nodeVersion.trim().match(/^v?(\d+)/)?.[1] ?? "unknown";
  return `doc-detective-runtime-${platform}-${arch}-node${nodeMajor}-`;
}

/**
 * The key to save under: the prefix, the CLI version, and a hash of every
 * `installedVersion` in `installed.json`. It changes only when the run
 * installed or updated something, so an unchanged cache never re-uploads, and
 * an updated browser always saves a new entry.
 */
export function cacheKey(prefix: string, version: string, installedJson: string | undefined): string {
  let lines: string[] = [];
  try {
    lines = installedVersions(JSON.parse(installedJson ?? "null")).sort();
  } catch {
    // An unreadable record hashes like a missing one.
  }
  const hash = crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12);
  return `${prefix}${version}-${hash}`;
}

/** `path@version` for every `installedVersion` in the record, at any depth. */
function installedVersions(node: unknown, at = ""): string[] {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([k, v]) =>
    k === "installedVersion" && typeof v === "string" ? [`${at}@${v}`] : installedVersions(v, `${at}/${k}`)
  );
}

/**
 * Folders under `_npx` holding a doc-detective other than `version`. Pruned
 * before saving so a cache carried across CLI releases doesn't keep every one.
 */
export function staleNpxDirs(npxRoot: string, version: string): string[] {
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(npxRoot);
  } catch {
    return [];
  }
  return dirs
    .map((d) => path.join(npxRoot, d))
    .filter((dir) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "node_modules", "doc-detective", "package.json"), "utf8"));
        return pkg.version !== version;
      } catch {
        return false;
      }
    });
}
