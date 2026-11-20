import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { verifyRelease } from "./verify-major-release.mjs";

const root = path.join(import.meta.dirname, "..");
const major = { type: "major", version: "3.0.0" };

test("refuses a major release unless ALLOW_MAJOR_RELEASE is true", () => {
  for (const env of [{}, { ALLOW_MAJOR_RELEASE: "" }, { ALLOW_MAJOR_RELEASE: "false" }, { ALLOW_MAJOR_RELEASE: "1" }]) {
    assert.throws(
      () => verifyRelease({}, { nextRelease: major, env }),
      {
        message:
          "Couldn't release 3.0.0, because a major release needs the `ALLOW_MAJOR_RELEASE` repository variable set to `true`. " +
          "If the breaking change is intended, set the variable, re-run this workflow, then delete the variable. " +
          "If it isn't, revert the commit that has the `!` or the `BREAKING CHANGE:` footer.",
      },
      JSON.stringify(env)
    );
  }
});

test("allows a major release with ALLOW_MAJOR_RELEASE=true, in any case and trimmed", () => {
  for (const allow of ["true", "TRUE", " True\n"]) {
    assert.doesNotThrow(() => verifyRelease({}, { nextRelease: major, env: { ALLOW_MAJOR_RELEASE: allow } }), allow);
  }
});

test("allows minor and patch releases with the variable unset", () => {
  for (const type of ["minor", "patch"]) {
    assert.doesNotThrow(() => verifyRelease({}, { nextRelease: { type, version: "2.3.0" }, env: {} }), type);
  }
});

test("semantic-release loads the guard, and the release step passes it the repository variable", () => {
  const { plugins } = JSON.parse(fs.readFileSync(path.join(root, ".releaserc.json"), "utf8"));
  assert.ok(plugins.includes("./scripts/verify-major-release.mjs"));
  const workflow = parse(fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"));
  const release = workflow.jobs.release.steps.find((step) => step.run === "npx semantic-release");
  assert.equal(release.env.ALLOW_MAJOR_RELEASE, "${{ vars.ALLOW_MAJOR_RELEASE }}");
});
