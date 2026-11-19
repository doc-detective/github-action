import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { parseEnv } from "util";
import semver from "semver";
import { parse as parseYaml } from "yaml";
import { scanForIos } from "./scanSpecs.ts";

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
 * What the runtime entry caches: the npm runtime, the browsers, and the record
 * of what's installed. Not the multi-gigabyte Android SDK, JRE, and emulators.
 * WebDriverAgent builds get an entry of their own, at `iosCachePath`.
 */
export function cachePaths(root: string): string[] {
  return ["runtime", "browsers", "installed.json"].map((p) => path.join(root, p));
}

/**
 * The cache root the CLI will use, by its precedence: DOC_DETECTIVE_CACHE_DIR
 * (from the environment, then `.env` in `cwd`),
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
  // The CLI loads `.env` from `cwd` without overriding the environment.
  try {
    env = { ...parseEnv(read(path.join(cwd, ".env"))), ...env };
  } catch {
    // No `.env`.
  }
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The CLI version as it goes in the key. CLIs before 5.3.0 never replace an
 * installed browser, so their caches also rotate weekly, and restore only
 * from the same week, to keep cached browsers at most a week behind.
 */
export function versionTag(version: string, now: number): { tag: string; refreshesBrowsers: boolean } {
  const refreshesBrowsers = !semver.valid(version) || semver.gte(version, "5.3.0");
  return { tag: refreshesBrowsers ? version : `${version}-w${Math.floor(now / WEEK_MS)}`, refreshesBrowsers };
}

const shortHash = (lines: string[]) => crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12);

/**
 * The key to save under: the prefix, the CLI version, and a hash of every
 * `installedVersion` and every `ios.wdaKeys` item in `installed.json`. It
 * changes only when the run installed or updated something, so an unchanged
 * cache never re-uploads, and an updated browser always saves a new entry. A
 * new WebDriverAgent build saves one too, because this entry holds the record
 * that lists it.
 */
export function cacheKey(prefix: string, version: string, installedJson: string | undefined): string {
  let lines: string[] = [];
  try {
    lines = [
      ...installedVersions(JSON.parse(installedJson ?? "null")),
      ...(wdaKeys(installedJson) ?? []).map((key) => `/ios/wdaKeys@${key}`),
    ].sort();
  } catch {
    // An unreadable record hashes like a missing one.
  }
  return `${prefix}${version}-${shortHash(lines)}`;
}

/** `path@version` for every `installedVersion` in the record, at any depth. */
function installedVersions(node: unknown, at = ""): string[] {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([k, v]) =>
    k === "installedVersion" && typeof v === "string" ? [`${at}@${v}`] : installedVersions(v, `${at}/${k}`)
  );
}

/**
 * `ios.wdaKeys` from `installed.json`, sorted: one key per WebDriverAgent
 * build the CLI recorded. Undefined when the record has no iOS slot.
 */
export function wdaKeys(installedJson: string | undefined): string[] | undefined {
  try {
    const keys = JSON.parse(installedJson ?? "null")?.ios?.wdaKeys;
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string").sort() : undefined;
  } catch {
    return undefined;
  }
}

/** Where the CLI keeps its WebDriverAgent builds: the iOS entry's one path. */
export function iosCachePath(root: string): string {
  return path.join(root, "ios", "wda");
}

/** The part of the iOS key that must match for an entry to restore at all: OS and CPU. */
export function iosCacheKeyPrefix({ platform, arch }: { platform: string; arch: string }): string {
  return `doc-detective-ios-${platform}-${arch}-`;
}

/** A hash of the set of WebDriverAgent builds. */
export function wdaSlotHash(keys: string[]): string {
  return shortHash([...keys].sort());
}

type Stat = (file: string) => { size: number; mtimeMs: number };

/**
 * A hash of what the builds hold, from the `products.json` the CLI writes last
 * in each build: its path, size, and modification time in whole seconds. Only
 * that file, because the CLI touches the `last-used` stamp beside it on every
 * run. `builds` counts the finished builds. With none, the hash is of an empty
 * list.
 */
export function wdaFingerprint(root: string, keys: string[], stat: Stat = fs.statSync): { hash: string; builds: number } {
  const lines = keys.flatMap((key) => {
    try {
      const { size, mtimeMs } = stat(path.join(iosCachePath(root), key, "products.json"));
      return [`ios/wda/${key}/products.json ${size} ${Math.floor(mtimeMs / 1000)}`];
    } catch {
      // No finished build under this key.
      return [];
    }
  });
  return { hash: shortHash(lines.sort()), builds: lines.length };
}

/**
 * True when this run restores and saves the WebDriverAgent build: the cache is
 * on and available, the CLI comes from npm, the runner is macOS, and a spec
 * asks for an iOS context.
 */
export function shouldCacheIos({
  cacheOn,
  version,
  available,
  platform,
  roots,
  scan = scanForIos,
}: {
  cacheOn: boolean;
  version: string;
  available: boolean;
  platform: string;
  roots: string[];
  scan?: (roots: string[]) => boolean;
}): boolean {
  return cacheOn && Boolean(version) && available && platform === "darwin" && scan(roots);
}

/**
 * What to restore the iOS entry by. No entry's key equals the primary key, so
 * the cache takes the newest entry for the recorded set of builds, then the
 * newest for the platform. Without a record of builds, only the latter.
 */
export function iosRestoreKeys(prefix: string, installedJson: string | undefined): { primaryKey: string; restoreKeys: string[] } {
  const keys = wdaKeys(installedJson);
  if (!keys) return { primaryKey: prefix, restoreKeys: [prefix] };
  const slot = `${prefix}${wdaSlotHash(keys)}-`;
  return { primaryKey: slot, restoreKeys: [slot, prefix] };
}

/**
 * The key to save the iOS entry under: the prefix, the slot hash, and the
 * fingerprint. Undefined when there's nothing to save: no recorded build, no
 * finished build, or the same key the run restored.
 */
export function iosSaveKey({
  prefix,
  root,
  installedJson,
  restoredKey,
  stat,
}: {
  prefix: string;
  root: string;
  installedJson: string | undefined;
  restoredKey?: string;
  stat?: Stat;
}): string | undefined {
  const keys = wdaKeys(installedJson);
  if (!keys) return undefined;
  const { hash, builds } = wdaFingerprint(root, keys, stat);
  if (!builds) return undefined;
  const key = `${prefix}${wdaSlotHash(keys)}-${hash}`;
  return key === restoredKey ? undefined : key;
}

/**
 * Folders under `_npx` that don't hold doc-detective `version`: other
 * releases, and anything else the job ran with `npx`, which may be a private
 * package. Moved out of the way while saving, so the cache holds only the
 * doc-detective this run used.
 */
export function otherNpxDirs(npxRoot: string, version: string): string[] {
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
        return true;
      }
    });
}
