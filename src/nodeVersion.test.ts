import test from "node:test";
import assert from "node:assert/strict";
import { canInstallCli5, nodeVersionWarning } from "./nodeVersion.ts";

test("warns when the job's Node.js is outside the range Doc Detective 5.2.1 and later support", () => {
  assert.equal(
    nodeVersionWarning("v22.11.0\n"),
    "Doc Detective 5.2.1 and later need Node.js 24.22.1 or later on the 24 line, or Node.js 26.12.1 or later, but this job runs v22.11.0. Add `actions/setup-node` with `node-version: 24` or `node-version: 26`."
  );
  // Below 24.22.1, all of 25, and 26 before 26.12.1.
  for (const version of ["v24.15.0", "v24.22.0", "v25.0.0", "v25.9.1", "v26.0.0", "v26.12.0"]) {
    assert.ok(nodeVersionWarning(version)?.includes(`runs ${version}.`), version);
  }
});

test("stays quiet on a supported Node.js", () => {
  for (const version of ["v24.22.1", "v24.22.1\n", "v24.30.0", "v26.12.1", "v26.13.1", "v27.0.0", "v28.1.0"]) {
    assert.equal(nodeVersionWarning(version), undefined, version);
  }
});

test("stays quiet when the version can't be read", () => {
  for (const version of ["", "not a version"]) {
    assert.equal(nodeVersionWarning(version), undefined, version);
  }
});

test("the preflight runs for latest and versions or ranges that can install CLI 5", () => {
  for (const version of ["latest", "5", "5.0.0", "v5", "^5", "5.x", ">=4", "4 || 5", "*", "v5-rc", "6"]) {
    assert.equal(canInstallCli5(version), true, version);
  }
});

test("the preflight skips versions and ranges that stay on CLI 4", () => {
  for (const version of ["4", "4.x", "^4", "~4.2", "4.41.5", "v4", "<5", ">=4 <5"]) {
    assert.equal(canInstallCli5(version), false, version);
  }
});

test("the preflight skips an empty version and dist-tags it can't resolve", () => {
  for (const version of ["", "next", "my-feature"]) {
    assert.equal(canInstallCli5(version), false, version);
  }
});
