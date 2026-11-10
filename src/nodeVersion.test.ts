import test from "node:test";
import assert from "node:assert/strict";
import { nodeVersionWarning } from "./nodeVersion.ts";

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
