import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDdVersion,
  depsCacheKey,
  depsCacheKeyPrefix,
  depsCachePaths,
  restoreDepsCache,
  saveDepsCache,
  type DepsCacheDeps,
} from "./depsSetup.ts";

test("resolveDdVersion passes an exact semver through without a registry lookup", async () => {
  let called = false;
  const run = () => {
    called = true;
    return "";
  };
  assert.equal(await resolveDdVersion("2.15.0", run), "2.15.0");
  assert.equal(await resolveDdVersion("2.15.0-beta.1", run), "2.15.0-beta.1");
  assert.equal(called, false);
});

test("resolveDdVersion resolves a dist-tag via npm view", async () => {
  assert.equal(
    await resolveDdVersion("latest", (command) => {
      assert.equal(command, "npm view doc-detective@latest version");
      return "2.15.0\n";
    }),
    "2.15.0"
  );
  assert.equal(
    await resolveDdVersion("staging-2.16.0", (command) => {
      assert.equal(command, "npm view doc-detective@staging-2.16.0 version");
      return "  2.16.0-staging  \n";
    }),
    "2.16.0-staging"
  );
});

test("resolveDdVersion returns 'local' for an empty input", async () => {
  let called = false;
  const run = () => {
    called = true;
    return "";
  };
  assert.equal(await resolveDdVersion("", run), "local");
  assert.equal(await resolveDdVersion("   ", run), "local");
  assert.equal(called, false);
});

test("resolveDdVersion returns 'unknown' when npm view fails or is empty", async () => {
  assert.equal(
    await resolveDdVersion("latest", () => {
      throw new Error("registry unreachable");
    }),
    "unknown"
  );
  assert.equal(
    await resolveDdVersion("latest", () => "   \n"),
    "unknown"
  );
});

test("depsCacheKey folds platform/arch/node/version into a stable key", () => {
  assert.equal(
    depsCacheKey({
      platform: "linux",
      arch: "x64",
      nodeMajor: "24",
      ddVersion: "2.15.0",
    }),
    "dd-deps-v1-linux-x64-node24-2.15.0"
  );
  assert.equal(
    depsCacheKey({
      platform: "darwin",
      arch: "arm64",
      nodeMajor: 22,
      ddVersion: "local",
    }),
    "dd-deps-v1-darwin-arm64-node22-local"
  );
});

test("depsCacheKey sanitizes odd segments to the cache-safe charset", () => {
  assert.equal(
    depsCacheKey({
      platform: "linux",
      arch: "x64",
      nodeMajor: "24",
      ddVersion: "2.15.0+build.5",
    }),
    "dd-deps-v1-linux-x64-node24-2.15.0-build.5"
  );
  assert.equal(
    depsCacheKey({
      platform: "win, 32",
      arch: "x 64",
      nodeMajor: "24",
      ddVersion: "",
    }),
    "dd-deps-v1-win-32-x-64-node24-unknown"
  );
});

test("depsCacheKeyPrefix is the key minus the version, for restore-keys fallback", () => {
  const args = { platform: "linux", arch: "x64", nodeMajor: "24" };
  const prefix = depsCacheKeyPrefix(args);
  assert.equal(prefix, "dd-deps-v1-linux-x64-node24-");
  assert.ok(
    depsCacheKey({ ...args, ddVersion: "2.15.0" }).startsWith(prefix)
  );
});

test("depsCachePaths targets runtime/browsers/installed.json but not android-sdk/jre", () => {
  const paths = depsCachePaths("/cache");
  const joined = paths.join("|");
  assert.ok(paths.some((p) => p.endsWith("runtime")));
  assert.ok(paths.some((p) => p.endsWith("browsers")));
  assert.ok(paths.some((p) => p.endsWith("installed.json")));
  assert.ok(!joined.includes("android-sdk"));
  assert.ok(!joined.includes("jre"));
});

function recordingDeps(
  overrides: Partial<DepsCacheDeps> = {}
): {
  deps: DepsCacheDeps;
  calls: { save: string[]; info: string[]; warning: string[] };
} {
  const calls = {
    save: [] as string[],
    info: [] as string[],
    warning: [] as string[],
  };
  return {
    calls,
    deps: {
      restoreCache: async () => undefined,
      saveCache: async (_paths, key) => {
        calls.save.push(key);
        return 1;
      },
      info: (m) => calls.info.push(m),
      warning: (m) => calls.warning.push(m),
      ...overrides,
    },
  };
}

test("restoreDepsCache reports an exact hit vs a cold cache", async () => {
  const key = "dd-deps-v1-linux-x64-node24-2.15.0";
  const prefix = "dd-deps-v1-linux-x64-node24-";

  const hit = recordingDeps({ restoreCache: async () => key });
  const r1 = await restoreDepsCache({
    cacheDir: "/cache",
    key,
    prefix,
    deps: hit.deps,
  });
  assert.equal(r1.exactHit, true);
  assert.equal(r1.key, key);

  const cold = recordingDeps({ restoreCache: async () => undefined });
  const r2 = await restoreDepsCache({
    cacheDir: "/cache",
    key,
    prefix,
    deps: cold.deps,
  });
  assert.equal(r2.exactHit, false);
});

test("restoreDepsCache treats a prefix hit as non-exact and passes the prefix as a restore-key", async () => {
  const key = "dd-deps-v1-linux-x64-node24-2.15.0";
  const prefix = "dd-deps-v1-linux-x64-node24-";
  const staleKey = "dd-deps-v1-linux-x64-node24-2.14.0";
  let restoreKeysSeen: string[] | undefined;
  const stale = recordingDeps({
    restoreCache: async (_paths, _key, restoreKeys) => {
      restoreKeysSeen = restoreKeys;
      return staleKey;
    },
  });
  const r = await restoreDepsCache({
    cacheDir: "/cache",
    key,
    prefix,
    deps: stale.deps,
  });
  assert.equal(r.exactHit, false);
  assert.equal(r.key, key);
  assert.deepEqual(restoreKeysSeen, [prefix]);
});

test("restoreDepsCache warns but doesn't throw when the cache service errors", async () => {
  const { deps, calls } = recordingDeps({
    restoreCache: async () => {
      throw new Error("cache service down");
    },
  });
  const r = await restoreDepsCache({
    cacheDir: "/cache",
    key: "k",
    prefix: "p",
    deps,
  });
  assert.equal(r.exactHit, false);
  assert.equal(calls.warning.length, 1);
});

test("saveDepsCache skips an exact hit and saves otherwise", async () => {
  const hit = recordingDeps();
  await saveDepsCache({
    cacheDir: "/cache",
    key: "k",
    exactHit: true,
    deps: hit.deps,
  });
  assert.deepEqual(hit.calls.save, []);

  const miss = recordingDeps();
  await saveDepsCache({
    cacheDir: "/cache",
    key: "k",
    exactHit: false,
    deps: miss.deps,
  });
  assert.deepEqual(miss.calls.save, ["k"]);
});

test("saveDepsCache swallows a save failure as a warning", async () => {
  const { deps, calls } = recordingDeps({
    saveCache: async () => {
      throw new Error("already exists");
    },
  });
  await saveDepsCache({
    cacheDir: "/cache",
    key: "k",
    exactHit: false,
    deps,
  });
  assert.equal(calls.warning.length, 1);
});
