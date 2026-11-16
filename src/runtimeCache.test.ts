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
  isExactVersion,
  resolveCacheRoot,
  otherNpxDirs,
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
  assert.deepEqual(cachePaths("r"), [path.join("r", "runtime"), path.join("r", "browsers"), path.join("r", "installed.json")]);
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
