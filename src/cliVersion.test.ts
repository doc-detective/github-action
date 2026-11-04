import test from "node:test";
import assert from "node:assert/strict";
import { supportsOutputDir } from "./cliVersion.ts";

test("versions and ranges that resolve below CLI 5 have no --output-dir", () => {
  for (const version of [
    "4",
    "4.41.5",
    "v4",
    "4.x",
    "4.*",
    "^4",
    "~4.2",
    "=4.1.0",
    "2.15.0",
    "4.0.0-rc.1",
    "<5",
    "<5.0.0",
    "<=4.9",
    "< 5",
    ">=4 <5",
    "3 - 4",
    "3 || 4",
  ]) {
    assert.equal(supportsOutputDir(version), false, version);
  }
});

test("versions and ranges that can resolve to CLI 5 or later have it", () => {
  for (const version of [
    "5",
    "5.0.0",
    "v5",
    "5.0.0-rc.1",
    "v5-rc",
    "5.x",
    "6",
    "10.1.0",
    "^5",
    ">=4",
    ">= 4",
    "<=5",
    "<5.1",
    "*",
    "x",
    "4 || 5",
    "4 - 5",
  ]) {
    assert.equal(supportsOutputDir(version), true, version);
  }
});

test("an empty version, meaning the linked build, has it", () => {
  assert.equal(supportsOutputDir(""), true);
});

test("dist-tags have it, since they can't be resolved offline", () => {
  for (const version of ["latest", "next", "my-feature"]) {
    assert.equal(supportsOutputDir(version), true, version);
  }
});
