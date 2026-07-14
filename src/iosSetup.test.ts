import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  textRequestsIos,
  scanForIos,
  shouldNoticeRetiredWdaCache,
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

test("shouldNoticeRetiredWdaCache: false input and non-macOS stay silent", () => {
  assert.deepEqual(
    shouldNoticeRetiredWdaCache({ iosInput: "false", platform: "darwin", roots: [] }),
    { notify: false, reason: "ios input is false" }
  );
  assert.equal(
    shouldNoticeRetiredWdaCache({ iosInput: "true", platform: "linux", roots: [] })
      .notify,
    false
  );
  assert.equal(
    shouldNoticeRetiredWdaCache({ iosInput: "auto", platform: "win32", roots: [] })
      .notify,
    false
  );
});

test("shouldNoticeRetiredWdaCache: true always notifies on macOS; auto scans", () => {
  assert.equal(
    shouldNoticeRetiredWdaCache({ iosInput: "true", platform: "darwin", roots: [] })
      .notify,
    true
  );
  assert.equal(
    shouldNoticeRetiredWdaCache({
      iosInput: "auto",
      platform: "darwin",
      roots: [],
      scan: () => true,
    }).notify,
    true
  );
  assert.equal(
    shouldNoticeRetiredWdaCache({
      iosInput: "auto",
      platform: "darwin",
      roots: [],
      scan: () => false,
    }).notify,
    false
  );
});
