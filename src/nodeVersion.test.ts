import test from "node:test";
import assert from "node:assert/strict";
import { canInstallCli5, nodeVersionWarning } from "./nodeVersion.ts";

test("warns when the job's Node.js is older than 24.15", () => {
  assert.equal(
    nodeVersionWarning("v22.11.0\n"),
    "Doc Detective 5 needs Node.js 24.15 or later, but this job runs v22.11.0. Add `actions/setup-node` with `node-version: 24`."
  );
  assert.match(nodeVersionWarning("v24.14.1") ?? "", /runs v24\.14\.1\./);
});

test("stays quiet on 24.15 or later", () => {
  for (const version of ["v24.15.0", "v24.15.0\n", "v24.20.1", "v25.0.0", "v26.1.2"]) {
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
