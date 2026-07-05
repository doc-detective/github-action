import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  textRequestsAndroid,
  scanForAndroid,
  shouldSetUpAndroid,
  enableLinuxKvm,
} from "./androidSetup.ts";

test("textRequestsAndroid matches the platform field forms", () => {
  assert.equal(textRequestsAndroid('{"platform": "android"}'), true);
  assert.equal(textRequestsAndroid('{"platforms": "android"}'), true);
  assert.equal(textRequestsAndroid('{"platforms":["chrome","android"]}'), true);
  assert.equal(textRequestsAndroid('{"platforms": ["android"]}'), true);
  assert.equal(textRequestsAndroid("{'platform': 'android'}"), true);
});

test("textRequestsAndroid ignores prose and other platforms", () => {
  assert.equal(textRequestsAndroid("This guide covers Android devices."), false);
  assert.equal(textRequestsAndroid('{"platforms": "linux"}'), false);
  assert.equal(textRequestsAndroid('{"name": "android-notes.md"}'), false);
});

function tmpTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gha-android-"));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

test("scanForAndroid finds an android spec under a directory", () => {
  const root = tmpTree({
    "docs/guide.md": "# Guide\nNothing special.",
    "specs/app.spec.json": '{"tests":[{"runOn":[{"platforms":"android"}]}]}',
  });
  assert.equal(scanForAndroid([root]), true);
});

test("scanForAndroid returns false with no android and skips node_modules", () => {
  const root = tmpTree({
    "specs/web.spec.json": '{"tests":[{"runOn":[{"platforms":"chrome"}]}]}',
    // A dependency that mentions android must NOT trigger a match.
    "node_modules/pkg/thing.json": '{"platforms":"android"}',
  });
  assert.equal(scanForAndroid([root]), false);
});

test("shouldSetUpAndroid honors the input and host", () => {
  const roots = ["/x"];
  // Explicit false always wins.
  assert.equal(
    shouldSetUpAndroid({ androidInput: "false", platform: "linux", roots, scan: () => true }).setUp,
    false
  );
  // Non-linux never sets up (nothing to accelerate on hosted mac/win).
  assert.equal(
    shouldSetUpAndroid({ androidInput: "true", platform: "darwin", roots, scan: () => true }).setUp,
    false
  );
  // Explicit true on linux.
  assert.equal(
    shouldSetUpAndroid({ androidInput: "true", platform: "linux", roots, scan: () => false }).setUp,
    true
  );
  // auto + detected.
  assert.equal(
    shouldSetUpAndroid({ androidInput: "auto", platform: "linux", roots, scan: () => true }).setUp,
    true
  );
  // auto + not detected.
  assert.equal(
    shouldSetUpAndroid({ androidInput: "auto", platform: "linux", roots, scan: () => false }).setUp,
    false
  );
  // Empty input defaults to auto.
  assert.equal(
    shouldSetUpAndroid({ androidInput: "", platform: "linux", roots, scan: () => true }).setUp,
    true
  );
});

test("enableLinuxKvm warns and no-ops when /dev/kvm is absent", async () => {
  const warnings: string[] = [];
  let execCalls = 0;
  const ok = await enableLinuxKvm({
    existsSync: () => false,
    exec: async () => {
      execCalls++;
      return 0;
    },
    info: () => {},
    warning: (m) => warnings.push(m),
  });
  assert.equal(ok, false);
  assert.equal(execCalls, 0);
  assert.match(warnings[0], /dev\/kvm is not present/);
});

test("enableLinuxKvm runs the udev step when /dev/kvm exists", async () => {
  const infos: string[] = [];
  let ran: { command: string; args: string[] } | undefined;
  const ok = await enableLinuxKvm({
    existsSync: () => true,
    exec: async (command, args) => {
      ran = { command, args };
      return 0;
    },
    info: (m) => infos.push(m),
    warning: () => {},
  });
  assert.equal(ok, true);
  assert.equal(ran?.command, "bash");
  assert.match(ran?.args.join(" ") ?? "", /udevadm trigger --name-match=kvm/);
  assert.match(infos[0], /Enabled KVM/);
});

test("enableLinuxKvm downgrades a sudo failure to a warning", async () => {
  const warnings: string[] = [];
  const ok = await enableLinuxKvm({
    existsSync: () => true,
    exec: async () => {
      throw new Error("sudo: a password is required");
    },
    info: () => {},
    warning: (m) => warnings.push(m),
  });
  assert.equal(ok, false);
  assert.match(warnings[0], /passwordless sudo/);
});
