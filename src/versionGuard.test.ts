import test from "node:test";
import assert from "node:assert/strict";
import { checkVersion } from "./versionGuard.ts";

test("accepts versions and ranges that stay below CLI 5", () => {
  for (const version of [
    "4",
    "4.41.5",
    "v4",
    "4.x",
    "4.*",
    "^4",
    "^4.2.0",
    "~4.2",
    "=4.1.0",
    "2.15.0",
    "4.0.0-rc.1",
    "<5",
    "<5.0.0",
    "<=4.9",
    "< 5",
    ">=4 <5",
    ">=4.1.0 <5.0.0",
    "3 - 4",
    "3 || 4",
  ]) {
    assert.deepEqual(checkVersion(version), {}, version);
  }
});

test("empty keeps meaning the locally linked CLI", () => {
  assert.deepEqual(checkVersion(""), {});
});

test("refuses anything that can resolve to CLI 5 or later, pointing to @v2", () => {
  for (const version of [
    "latest",
    "5",
    "5.0.0",
    "v5",
    "5.0.0-rc.1",
    // Matches 5.0.0 prereleases below rc.1, such as 5.0.0-beta.1.
    "<5.0.0-rc.1",
    "v5-rc",
    "5.x",
    "6",
    "10.1.0",
    "^5",
    "~5.1",
    ">=4",
    ">4",
    ">= 4",
    ">=5",
    "<=5",
    "<5.1",
    "*",
    "x",
    "4 || 5",
    "4 - 5",
    ">=4 <6",
  ]) {
    const { refusal } = checkVersion(version);
    assert.match(refusal ?? "", /@v2/, version);
    assert.ok(refusal?.includes(version), version);
  }
});

test("warns about a dist-tag it can't resolve, without refusing it", () => {
  for (const version of ["next", "my-feature"]) {
    const check = checkVersion(version);
    assert.equal(check.refusal, undefined, version);
    assert.match(check.warning ?? "", /@v2/, version);
  }
});
