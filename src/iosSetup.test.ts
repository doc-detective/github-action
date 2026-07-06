import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  textRequestsIos,
  scanForIos,
  shouldCacheWda,
  wdaCacheKey,
  wdaCacheKeyPrefix,
  detectXcodeVersion,
  detectXcuitestDriverVersion,
  restoreWdaCache,
  saveWdaCache,
  type WdaCacheDeps,
} from "./iosSetup.ts";

test("textRequestsIos matches the platform field forms", () => {
  assert.equal(textRequestsIos('{"platform": "ios"}'), true);
  assert.equal(textRequestsIos('{"platforms": "ios"}'), true);
  assert.equal(textRequestsIos('{"platforms":["safari","ios"]}'), true);
  assert.equal(textRequestsIos('{"platforms": ["ios"]}'), true);
  assert.equal(textRequestsIos("{'platform': 'ios'}"), true);
});

test("textRequestsIos ignores prose and other platforms", () => {
  assert.equal(textRequestsIos("This guide covers iOS devices."), false);
  assert.equal(textRequestsIos('{"platforms": "android"}'), false);
  assert.equal(textRequestsIos('{"name": "ios-notes.md"}'), false);
});

function tmpTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gha-ios-"));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

test("scanForIos finds an ios spec in a directory and skips node_modules", () => {
  const withSpec = tmpTree({
    "docs/guide.md": "# Guide\nNo platforms here.",
    "tests/mobile.spec.json": '{"tests":[{"platforms":["ios"]}]}',
  });
  const specOnlyInNodeModules = tmpTree({
    "docs/guide.md": "# Guide",
    "node_modules/pkg/x.json": '{"platforms":"ios"}',
  });
  try {
    assert.equal(scanForIos([withSpec]), true);
    assert.equal(scanForIos([path.join(withSpec, "docs")]), false);
    // node_modules is skipped during the walk, so a spec that lives only there
    // isn't found when scanning from the parent.
    assert.equal(scanForIos([specOnlyInNodeModules]), false);
  } finally {
    fs.rmSync(withSpec, { recursive: true, force: true });
    fs.rmSync(specOnlyInNodeModules, { recursive: true, force: true });
  }
});

test("shouldCacheWda: false input and non-macOS never cache", () => {
  assert.deepEqual(
    shouldCacheWda({ iosInput: "false", platform: "darwin", roots: [] }),
    { setUp: false, reason: "ios input is false" }
  );
  assert.equal(
    shouldCacheWda({ iosInput: "true", platform: "linux", roots: [] }).setUp,
    false
  );
  assert.equal(
    shouldCacheWda({ iosInput: "auto", platform: "win32", roots: [] }).setUp,
    false
  );
});

test("shouldCacheWda: true always caches on macOS; auto scans", () => {
  assert.equal(
    shouldCacheWda({ iosInput: "true", platform: "darwin", roots: [] }).setUp,
    true
  );
  assert.equal(
    shouldCacheWda({
      iosInput: "auto",
      platform: "darwin",
      roots: [],
      scan: () => true,
    }).setUp,
    true
  );
  assert.equal(
    shouldCacheWda({
      iosInput: "auto",
      platform: "darwin",
      roots: [],
      scan: () => false,
    }).setUp,
    false
  );
});

test("wdaCacheKey folds the Xcode and XCUITest driver versions into a stable key", () => {
  assert.equal(
    wdaCacheKey("Xcode 26.5", "9.2.1", "darwin"),
    "dd-wda-v2-darwin-Xcode-26.5-xcuitest-9.2.1"
  );
  assert.equal(
    wdaCacheKey("", "", "darwin"),
    "dd-wda-v2-darwin-unknown-xcuitest-unknown"
  );
});

test("wdaCacheKeyPrefix is the key minus the driver version, for restore-keys fallback", () => {
  const prefix = wdaCacheKeyPrefix("Xcode 26.5", "darwin");
  assert.equal(prefix, "dd-wda-v2-darwin-Xcode-26.5-xcuitest-");
  assert.ok(wdaCacheKey("Xcode 26.5", "9.2.1", "darwin").startsWith(prefix));
});

test("detectXcodeVersion reads the first line and tolerates failure", () => {
  assert.equal(
    detectXcodeVersion(() => "Xcode 26.5\nBuild version 17F42\n"),
    "Xcode 26.5"
  );
  assert.equal(
    detectXcodeVersion(() => {
      throw new Error("xcodebuild missing");
    }),
    "unknown"
  );
});

test("detectXcuitestDriverVersion trims npm's output and tolerates failure", () => {
  assert.equal(detectXcuitestDriverVersion(() => "9.2.1\n"), "9.2.1");
  assert.equal(detectXcuitestDriverVersion(() => "  \n"), "unknown");
  assert.equal(
    detectXcuitestDriverVersion(() => {
      throw new Error("registry unreachable");
    }),
    "unknown"
  );
});

function recordingDeps(
  overrides: Partial<WdaCacheDeps> = {}
): { deps: WdaCacheDeps; calls: { save: string[]; info: string[]; warning: string[] } } {
  const calls = { save: [] as string[], info: [] as string[], warning: [] as string[] };
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

test("restoreWdaCache reports an exact hit vs a cold cache", async () => {
  const hitKey = wdaCacheKey("Xcode 26.5", "9.2.1");
  const hit = recordingDeps({ restoreCache: async () => hitKey });
  const r1 = await restoreWdaCache({
    derivedDataPath: "/tmp/wda",
    xcodeVersion: "Xcode 26.5",
    driverVersion: "9.2.1",
    deps: hit.deps,
  });
  assert.equal(r1.exactHit, true);
  assert.equal(r1.key, hitKey);

  const cold = recordingDeps({ restoreCache: async () => undefined });
  const r2 = await restoreWdaCache({
    derivedDataPath: "/tmp/wda",
    xcodeVersion: "Xcode 26.5",
    driverVersion: "9.2.1",
    deps: cold.deps,
  });
  assert.equal(r2.exactHit, false);
});

test("restoreWdaCache falls back to an older driver's build via restore-keys and reports a non-exact hit", async () => {
  // A prefix restore (same Xcode, older xcuitest driver) still warms the
  // incremental build, but must NOT count as exact — the post-run save then
  // re-caches the healed build under the new driver's key.
  const staleKey = wdaCacheKey("Xcode 26.5", "9.1.0");
  let restoreKeysSeen: string[] | undefined;
  const stale = recordingDeps({
    restoreCache: async (_paths, _key, restoreKeys) => {
      restoreKeysSeen = restoreKeys;
      return staleKey;
    },
  });
  const r = await restoreWdaCache({
    derivedDataPath: "/tmp/wda",
    xcodeVersion: "Xcode 26.5",
    driverVersion: "9.2.1",
    deps: stale.deps,
  });
  assert.equal(r.exactHit, false);
  assert.equal(r.key, wdaCacheKey("Xcode 26.5", "9.2.1"));
  assert.deepEqual(restoreKeysSeen, [wdaCacheKeyPrefix("Xcode 26.5")]);
});

test("restoreWdaCache warns but doesn't throw when the cache service errors", async () => {
  const { deps, calls } = recordingDeps({
    restoreCache: async () => {
      throw new Error("cache service down");
    },
  });
  const r = await restoreWdaCache({
    derivedDataPath: "/tmp/wda",
    xcodeVersion: "Xcode 26.5",
    driverVersion: "9.2.1",
    deps,
  });
  assert.equal(r.exactHit, false);
  assert.equal(calls.warning.length, 1);
});

test("saveWdaCache skips an exact hit and saves otherwise", async () => {
  const hit = recordingDeps();
  await saveWdaCache({
    derivedDataPath: "/tmp/wda",
    key: "k",
    exactHit: true,
    deps: hit.deps,
  });
  assert.deepEqual(hit.calls.save, []);

  const miss = recordingDeps();
  await saveWdaCache({
    derivedDataPath: "/tmp/wda",
    key: "k",
    exactHit: false,
    deps: miss.deps,
  });
  assert.deepEqual(miss.calls.save, ["k"]);
});

test("saveWdaCache swallows a save failure as a warning", async () => {
  const { deps, calls } = recordingDeps({
    saveCache: async () => {
      throw new Error("already exists");
    },
  });
  await saveWdaCache({
    derivedDataPath: "/tmp/wda",
    key: "k",
    exactHit: false,
    deps,
  });
  assert.equal(calls.warning.length, 1);
});
