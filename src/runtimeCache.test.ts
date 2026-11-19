import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  cacheKey,
  cacheKeyPrefix,
  cachePaths,
  defaultCacheRoot,
  exactVersion,
  iosCacheKeyPrefix,
  iosCachePath,
  iosRestoreKeys,
  iosSaveKey,
  isExactVersion,
  resolveCacheRoot,
  shouldCacheIos,
  versionTag,
  otherNpxDirs,
  wdaFingerprint,
  wdaKeys,
  wdaSlotHash,
} from "./runtimeCache.ts";

test("exactVersion takes the highest match from npm view --json", () => {
  assert.equal(exactVersion('"5.0.0"'), "5.0.0");
  assert.equal(exactVersion('["5.0.0", "5.0.1", "5.1.0"]'), "5.1.0");
  // A backport published after a newer minor comes last.
  assert.equal(exactVersion('["5.0.0", "5.1.0", "5.0.2"]'), "5.1.0");
  assert.equal(exactVersion(""), undefined);
  assert.equal(exactVersion("[]"), undefined);
  assert.equal(exactVersion("npm error 404"), undefined);
});

test("isExactVersion accepts only versions npm can't re-resolve", () => {
  for (const v of ["5.0.0", "5.1.0-rc.2", "5.0.0+build.7"]) assert.ok(isExactVersion(v), v);
  for (const v of ["5", "5.0", "^5.0.0", "latest", "", "5.0.0 || 6"]) assert.ok(!isExactVersion(v), v);
});

test("defaultCacheRoot matches the CLI's lookup order", () => {
  const home = path.join("h");
  const none = () => false;
  assert.equal(defaultCacheRoot({ env: {}, home, platform: "linux", exists: none }), path.join(home, ".cache", "doc-detective"));
  assert.equal(
    defaultCacheRoot({ env: { XDG_CACHE_HOME: "x" }, home, platform: "linux", exists: none }),
    path.join("x", "doc-detective")
  );
  assert.equal(
    defaultCacheRoot({ env: { LOCALAPPDATA: "l" }, home, platform: "win32", exists: none }),
    path.join("l", "doc-detective")
  );
  assert.equal(
    defaultCacheRoot({ env: { XDG_CACHE_HOME: "x" }, home, platform: "linux", exists: () => true }),
    path.join(home, ".doc-detective")
  );
});

test("cachePaths leaves out the Android SDK, JRE, and WDA builds", () => {
  assert.deepEqual(
    cachePaths("r"),
    ["runtime", "browsers", "chromedriver-mobile", "installed.json"].map((p) => path.join("r", p))
  );
});

test("cacheKeyPrefix changes with OS, CPU, and Node major only", () => {
  const base = { platform: "linux", arch: "x64", nodeVersion: "v24.15.0\n" };
  const prefix = cacheKeyPrefix(base);
  assert.equal(prefix, "doc-detective-runtime-linux-x64-node24-");
  assert.equal(cacheKeyPrefix({ ...base, nodeVersion: "v24.16.1" }), prefix);
  for (const change of [{ platform: "win32" }, { arch: "arm64" }, { nodeVersion: "v25.0.0" }]) {
    assert.notEqual(cacheKeyPrefix({ ...base, ...change }), prefix, JSON.stringify(change));
  }
});

test("cacheKey changes only when an installed version or the CLI version does", () => {
  const record = (chrome: string, at: string) =>
    JSON.stringify({
      npmPackages: { sharp: { installedVersion: "0.34.0", installedAt: at } },
      browsers: { chrome: { installedVersion: chrome, installedAt: at, latestCheckedAt: at } },
    });
  const key = cacheKey("p-", "5.2.1", record("140.0", "2026-11-01"));
  assert.match(key, /^p-5\.2\.1-[0-9a-f]{12}$/);
  assert.equal(cacheKey("p-", "5.2.1", record("140.0", "2026-11-14")), key, "timestamps don't count");
  assert.notEqual(cacheKey("p-", "5.2.1", record("141.0", "2026-11-01")), key);
  assert.notEqual(cacheKey("p-", "5.2.2", record("140.0", "2026-11-01")), key);
  assert.equal(cacheKey("p-", "5.2.1", "not json"), cacheKey("p-", "5.2.1", undefined));
});

test("resolveCacheRoot follows the CLI's precedence and anchors", () => {
  const cwd = path.resolve("work");
  const files: Record<string, string> = {
    [path.join(cwd, ".doc-detective.yaml")]: "cacheDir: from-yaml\n",
    [path.join(cwd, "cfg", "dd.json")]: JSON.stringify({ cacheDir: "../from-json" }),
    [path.join(cwd, "cfg", "cwd.json")]: JSON.stringify({ cacheDir: "from-cwd", relativePathBase: "cwd" }),
    [path.join(cwd, "cfg", "none.json")]: "{}",
  };
  const opts = { cwd, read: (f: string) => files[f], exists: (f: string) => f in files, env: {} };
  assert.equal(resolveCacheRoot(opts), path.join(cwd, "from-yaml"));
  assert.equal(resolveCacheRoot({ ...opts, config: "cfg/dd.json" }), path.join(cwd, "from-json"));
  assert.equal(resolveCacheRoot({ ...opts, config: "cfg/cwd.json" }), path.join(cwd, "from-cwd"));
  assert.equal(
    resolveCacheRoot({ ...opts, env: { DOC_DETECTIVE_CONFIG: '{"cacheDir":"env-config"}' } }),
    path.join(cwd, "env-config")
  );
  assert.equal(
    resolveCacheRoot({ ...opts, env: { DOC_DETECTIVE_CACHE_DIR: " /abs/dd ", DOC_DETECTIVE_CONFIG: '{"cacheDir":"x"}' } }),
    path.resolve(cwd, "/abs/dd")
  );
  const withDotenv = { ...opts, read: (f: string) => (f === path.join(cwd, ".env") ? "DOC_DETECTIVE_CACHE_DIR=.dd\n" : files[f]) };
  assert.equal(resolveCacheRoot(withDotenv), path.join(cwd, ".dd"));
  assert.equal(
    resolveCacheRoot({ ...withDotenv, env: { DOC_DETECTIVE_CACHE_DIR: "/env-wins" } }),
    path.resolve(cwd, "/env-wins")
  );
  const fallback = { ...opts, env: { XDG_CACHE_HOME: "/xdg" } };
  assert.equal(resolveCacheRoot({ ...fallback, config: "cfg/none.json" }), path.join("/xdg", "doc-detective"));
  assert.equal(resolveCacheRoot({ ...fallback, config: "https://example.com/dd.json" }), path.join("/xdg", "doc-detective"));
  assert.equal(resolveCacheRoot({ ...fallback, config: "missing.json" }), path.join("/xdg", "doc-detective"));
});

test("otherNpxDirs lists everything but this doc-detective version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npx-"));
  const add = (dir: string, name: string, version: string) => {
    const pkg = path.join(root, dir, "node_modules", name);
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ version }));
  };
  add("a", "doc-detective", "5.2.1");
  add("b", "doc-detective", "5.2.0");
  add("c", "cowsay", "1.0.0");
  assert.deepEqual(otherNpxDirs(root, "5.2.1").sort(), [path.join(root, "b"), path.join(root, "c")]);
  assert.deepEqual(otherNpxDirs(path.join(root, "missing"), "5.2.1"), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("versionTag rotates weekly only for CLIs that don't refresh browsers", () => {
  const now = Date.UTC(2026, 10, 16);
  assert.deepEqual(versionTag("5.3.0", now), { tag: "5.3.0", refreshesBrowsers: true });
  assert.deepEqual(versionTag("6.0.0-beta.1", now).refreshesBrowsers, true);
  const old = versionTag("5.2.1", now);
  assert.match(old.tag, /^5\.2\.1-w\d+$/);
  assert.equal(old.refreshesBrowsers, false);
  assert.equal(versionTag("5.2.1", now + 60_000).tag, old.tag);
  assert.notEqual(versionTag("5.2.1", now + 7 * 24 * 60 * 60 * 1000).tag, old.tag);
});

// A record as the CLI writes it, without and with a WebDriverAgent build.
const installedRecord = (ios?: { wdaKeys: string[] }) =>
  JSON.stringify({
    npmPackages: { sharp: { installedVersion: "0.34.0", installedAt: "2026-11-01" } },
    browsers: { chrome: { installedVersion: "140.0", installedAt: "2026-11-01", latestCheckedAt: "2026-11-01" } },
    android: { systemImages: ["android-36;google_apis;x86_64"], avds: ["dd"] },
    ...(ios ? { ios } : {}),
  });

test("cacheKey stays the same for a record without WebDriverAgent builds", () => {
  // Pinned: a changed value here invalidates every runtime cache already saved.
  assert.equal(cacheKey("p-", "5.5.0", installedRecord()), "p-5.5.0-4bae1c9b9125");
  assert.equal(cacheKey("p-", "5.5.0", undefined), "p-5.5.0-e3b0c44298fc");
  assert.equal(cacheKey("p-", "5.5.0", installedRecord({ wdaKeys: [] })), "p-5.5.0-4bae1c9b9125");
});

test("cacheKey changes with the set of WebDriverAgent builds", () => {
  const none = cacheKey("p-", "5.5.0", installedRecord());
  const one = cacheKey("p-", "5.5.0", installedRecord({ wdaKeys: ["a"] }));
  const two = cacheKey("p-", "5.5.0", installedRecord({ wdaKeys: ["a", "b"] }));
  assert.match(one, /^p-5\.5\.0-[0-9a-f]{12}$/);
  assert.equal(new Set([none, one, two]).size, 3);
  assert.equal(cacheKey("p-", "5.5.0", installedRecord({ wdaKeys: ["b", "a"] })), two, "order doesn't count");
});

test("wdaKeys reads ios.wdaKeys, sorted, or nothing without the slot", () => {
  assert.deepEqual(wdaKeys(installedRecord({ wdaKeys: ["b", "a"] })), ["a", "b"]);
  assert.deepEqual(wdaKeys(installedRecord({ wdaKeys: [] })), []);
  assert.deepEqual(wdaKeys(JSON.stringify({ ios: { wdaKeys: ["a", 7, null] } })), ["a"]);
  for (const json of [installedRecord(), undefined, "not json", "null", '{"ios":{}}', '{"ios":{"wdaKeys":"a"}}']) {
    assert.equal(wdaKeys(json), undefined, String(json));
  }
});

test("wdaSlotHash covers the set of keys, in any order", () => {
  assert.match(wdaSlotHash(["a", "b"]), /^[0-9a-f]{12}$/);
  assert.equal(wdaSlotHash(["b", "a"]), wdaSlotHash(["a", "b"]));
  assert.notEqual(wdaSlotHash(["a"]), wdaSlotHash(["a", "b"]));
  assert.notEqual(wdaSlotHash(["ab"]), wdaSlotHash(["a", "b"]));
});

// A `stat` over a fixed set of files, keyed by path under the cache root "r".
const statOf = (files: Record<string, { size: number; mtimeMs: number }>) => (file: string) => {
  const found = files[path.relative("r", file).split(path.sep).join("/")];
  if (!found) throw new Error("ENOENT");
  return found;
};

test("wdaFingerprint covers the path, size, and modification time of each products.json", () => {
  const a = { size: 120, mtimeMs: 1_763_000_000_000 };
  const files = { "ios/wda/a/products.json": a, "ios/wda/b/products.json": { size: 90, mtimeMs: 1_763_000_100_000 } };
  const base = wdaFingerprint("r", ["a", "b"], statOf(files));
  assert.match(base.hash, /^[0-9a-f]{12}$/);
  assert.equal(base.builds, 2);
  assert.deepEqual(wdaFingerprint("r", ["b", "a"], statOf(files)), base, "order doesn't count");
  const changed = (file: { size: number; mtimeMs: number }) =>
    wdaFingerprint("r", ["a", "b"], statOf({ ...files, "ios/wda/a/products.json": file })).hash;
  assert.notEqual(changed({ ...a, size: 121 }), base.hash);
  assert.notEqual(changed({ ...a, mtimeMs: a.mtimeMs + 1000 }), base.hash);
  // Whole seconds: a restore that drops the fraction doesn't change the key.
  assert.equal(changed({ ...a, mtimeMs: a.mtimeMs + 0.5 }), base.hash);
  // A key with no marker file doesn't count.
  assert.deepEqual(wdaFingerprint("r", ["a", "b", "gone"], statOf(files)), base);
  assert.notEqual(wdaFingerprint("r", ["a"], statOf(files)).hash, base.hash);
});

test("wdaFingerprint hashes an empty list when no products.json exists", () => {
  const empty = { hash: "e3b0c44298fc", builds: 0 };
  assert.deepEqual(wdaFingerprint("r", [], statOf({})), empty);
  assert.deepEqual(wdaFingerprint("r", ["a"], statOf({})), empty);
});

test("wdaFingerprint ignores the last-used stamp beside products.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wda-"));
  try {
    const dir = path.join(root, "ios", "wda", "a");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "products.json"), "{}");
    fs.utimesSync(path.join(dir, "products.json"), 1_763_000_000, 1_763_000_000);
    const before = wdaFingerprint(root, ["a"]);
    assert.equal(before.builds, 1);
    fs.writeFileSync(path.join(dir, "last-used"), "now");
    fs.utimesSync(path.join(dir, "last-used"), 1_763_000_500, 1_763_000_500);
    assert.deepEqual(wdaFingerprint(root, ["a"]), before);
    fs.utimesSync(path.join(dir, "products.json"), 1_763_000_900, 1_763_000_900);
    assert.notEqual(wdaFingerprint(root, ["a"]).hash, before.hash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the iOS entry has its own path and key prefix", () => {
  assert.equal(iosCachePath("r"), path.join("r", "ios", "wda"));
  assert.equal(iosCacheKeyPrefix({ platform: "darwin", arch: "arm64" }), "doc-detective-ios-darwin-arm64-");
});

test("shouldCacheIos needs the cache on, a version, macOS, and an iOS context", () => {
  const yes = { cacheOn: true, version: "5", available: true, platform: "darwin", roots: ["/x"], scan: () => true };
  assert.equal(shouldCacheIos(yes), true);
  for (const change of [{ cacheOn: false }, { version: "" }, { available: false }, { platform: "linux" }, { platform: "win32" }, { scan: () => false }]) {
    assert.equal(shouldCacheIos({ ...yes, ...change }), false, Object.keys(change)[0]);
  }
  // The scan only runs when everything cheaper already says yes.
  const scan = () => assert.fail("scanned");
  for (const change of [{ cacheOn: false }, { version: "" }, { available: false }, { platform: "linux" }]) {
    assert.equal(shouldCacheIos({ ...yes, scan, ...change }), false);
  }
  const roots: string[][] = [];
  shouldCacheIos({ ...yes, scan: (r) => roots.push(r) > 0 });
  assert.deepEqual(roots, [["/x"]]);
});

test("iosRestoreKeys prefers the recorded set of builds, then any entry for the platform", () => {
  const prefix = "doc-detective-ios-darwin-arm64-";
  const slot = `${prefix}${wdaSlotHash(["a", "b"])}-`;
  assert.deepEqual(iosRestoreKeys(prefix, installedRecord({ wdaKeys: ["b", "a"] })), {
    primaryKey: slot,
    restoreKeys: [slot, prefix],
  });
  // Cold: no record, or a record with no iOS slot.
  for (const json of [undefined, installedRecord(), "not json"]) {
    assert.deepEqual(iosRestoreKeys(prefix, json), { primaryKey: prefix, restoreKeys: [prefix] });
  }
  // A slot with no builds is still a slot: its hash is of an empty list, and the platform prefix backs it up.
  const empty = `${prefix}e3b0c44298fc-`;
  assert.deepEqual(iosRestoreKeys(prefix, installedRecord({ wdaKeys: [] })), { primaryKey: empty, restoreKeys: [empty, prefix] });
});

test("iosSaveKey names the entry to save, or nothing when nothing changed", () => {
  const prefix = "doc-detective-ios-darwin-arm64-";
  const files = { "ios/wda/a/products.json": { size: 120, mtimeMs: 1_763_000_000_000 } };
  const base = { prefix, root: "r", installedJson: installedRecord({ wdaKeys: ["a"] }), stat: statOf(files) };
  const key = iosSaveKey(base);
  assert.match(key ?? "", /^doc-detective-ios-darwin-arm64-[0-9a-f]{12}-[0-9a-f]{12}$/);
  assert.equal(key, `${prefix}${wdaSlotHash(["a"])}-${wdaFingerprint("r", ["a"], statOf(files)).hash}`);
  // It starts with the key the next run restores by.
  assert.ok(key?.startsWith(iosRestoreKeys(prefix, base.installedJson).primaryKey));
  // Restored and unchanged: nothing to save.
  assert.equal(iosSaveKey({ ...base, restoredKey: key }), undefined);
  // Restored from another set of builds, or rebuilt under the same key: save.
  assert.equal(iosSaveKey({ ...base, restoredKey: `${prefix}000000000000-000000000000` }), key);
  const rebuilt = statOf({ "ios/wda/a/products.json": { size: 120, mtimeMs: 1_763_000_900_000 } });
  assert.notEqual(iosSaveKey({ ...base, restoredKey: key, stat: rebuilt }), undefined);
  // No iOS slot, or no finished build: nothing to save.
  assert.equal(iosSaveKey({ ...base, installedJson: installedRecord() }), undefined);
  assert.equal(iosSaveKey({ ...base, installedJson: undefined }), undefined);
  assert.equal(iosSaveKey({ ...base, stat: statOf({}) }), undefined);
  assert.equal(iosSaveKey({ ...base, installedJson: installedRecord({ wdaKeys: [] }) }), undefined);
});
