import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { cacheKey, cachePaths, defaultCacheRoot, exactVersion, isExactVersion } from "./runtimeCache.ts";

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

test("cacheKey changes with version, OS, CPU, Node major, and week only", () => {
  const base = { version: "5.0.0", platform: "linux", arch: "x64", nodeVersion: "v24.15.0\n", now: Date.UTC(2026, 10, 14) };
  const key = cacheKey(base);
  assert.match(key, /^doc-detective-runtime-5\.0\.0-linux-x64-node24-w\d+$/);
  assert.equal(cacheKey({ ...base, nodeVersion: "v24.16.1" }), key);
  assert.equal(cacheKey({ ...base, now: base.now + 60_000 }), key);
  for (const change of [
    { version: "5.0.1" },
    { platform: "win32" },
    { arch: "arm64" },
    { nodeVersion: "v25.0.0" },
    { now: base.now + 7 * 24 * 60 * 60 * 1000 },
  ]) {
    assert.notEqual(cacheKey({ ...base, ...change }), key, JSON.stringify(change));
  }
});
