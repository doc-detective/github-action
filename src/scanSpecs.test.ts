import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { platformRe, scanForIos, textRequestsIos } from "./scanSpecs.ts";
import { textRequestsAndroid } from "./androidSetup.ts";

// Every form, for both platforms: the two matchers are one pattern.
const requests: [string, (text: string) => boolean][] = [
  ["android", textRequestsAndroid],
  ["ios", textRequestsIos],
];

test("platform matchers accept the JSON forms", () => {
  for (const [name, matches] of requests) {
    for (const text of [
      `{"platform": "${name}"}`,
      `{"platforms": "${name}"}`,
      `{"platforms":["chrome","${name}"]}`,
      `{"platforms": ["${name}"]}`,
      `{"platforms": [\n  "linux",\n  "${name}"\n]}`,
      `{'platform': '${name}'}`,
      `<!-- test {"runOn":[{"platforms":["${name}"]}]} -->`,
    ]) {
      assert.equal(matches(text), true, text);
    }
  }
});

test("platform matchers accept inline YAML", () => {
  for (const [name, matches] of requests) {
    for (const text of [
      `platforms: ${name}`,
      `platform: ${name}`,
      `platforms: "${name}"`,
      `platforms: [${name}]`,
      `platforms: [mac, ${name}]`,
      `  - platforms: ['${name}', "mac"]`,
      `runOn: [{ platforms: ${name} }]`,
    ]) {
      assert.equal(matches(text), true, text);
    }
  }
});

test("platform matchers accept YAML block lists", () => {
  for (const [name, matches] of requests) {
    for (const text of [
      `platforms:\n  - ${name}\n`,
      `runOn:\n  - platforms:\n      - mac\n      - "${name}"\n    browsers: safari\n`,
      `platforms:\r\n- linux\r\n- ${name}\r\n`,
    ]) {
      assert.equal(matches(text), true, text);
    }
  }
});

test("platform matchers reject other words, values, and keys", () => {
  for (const [name, matches] of requests) {
    for (const text of [
      `This guide covers ${name} devices.`,
      `{"platforms": "linux"}`,
      `{"name": "${name}-notes.md"}`,
      `{"platforms": ["x${name}"]}`,
      `{"platforms": "${name}x"}`,
      `platforms: ${name}-simulator`,
      `platforms: [k${name}k, mac]`,
      `platforms: [mac, windows]\nname: ${name}`,
      `platforms:\n  - mac\n  - windows\ndevices:\n  - ${name}\n`,
      `platforms:\n  - my-${name}\n`,
      `myplatforms: ${name}`,
      `platform: linux # not ${name}`,
    ]) {
      assert.equal(matches(text), false, text);
    }
  }
  assert.equal(textRequestsIos("platforms: adios"), false);
  assert.equal(textRequestsIos('{"platforms": ["kiosk"]}'), false);
  assert.equal(textRequestsIos('{"platforms": "android"}'), false);
  assert.equal(textRequestsAndroid("platforms: [ios]"), false);
});

test("platformRe builds one matcher per platform name", () => {
  assert.ok(platformRe("ios").test("platforms: ios"));
  assert.ok(!platformRe("ios").test("platforms: android"));
  // The name is literal text, not a pattern.
  assert.ok(platformRe("a.b").test("platforms: a.b"));
  assert.ok(!platformRe("a.b").test("platforms: axb"));
});

test("scanForIos finds an ios spec in JSON or YAML, and skips node_modules", () => {
  const tree = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gha-ios-"));
    for (const [rel, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), contents);
    }
    return root;
  };
  const json = tree({ "docs/guide.md": "# Guide", "specs/app.spec.json": '{"tests":[{"runOn":[{"platforms":"ios"}]}]}' });
  const yaml = tree({ "specs/app.spec.yaml": "tests:\n  - runOn:\n      - platforms:\n          - ios\n" });
  const none = tree({
    "specs/web.spec.json": '{"tests":[{"runOn":[{"platforms":"mac"}]}]}',
    "node_modules/pkg/thing.json": '{"platforms":"ios"}',
  });
  try {
    assert.equal(scanForIos([json]), true);
    assert.equal(scanForIos([yaml]), true);
    assert.equal(scanForIos([none]), false);
  } finally {
    for (const root of [json, yaml, none]) fs.rmSync(root, { recursive: true, force: true });
  }
});
