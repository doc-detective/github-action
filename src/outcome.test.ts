import test from "node:test";
import assert from "node:assert/strict";
import { failureMessage, resolveExitOnFail } from "./outcome.ts";

test("failureMessage covers exit codes against exit_on_fail and failed specs", () => {
  const table: [number, boolean, number, RegExp | null][] = [
    [0, false, 0, null],
    [0, true, 0, null],
    // CLI 4's default: a failed spec still exits 0, so only exit_on_fail fails it.
    [0, false, 2, null],
    [0, true, 2, /found failing tests/],
    // A non-zero exit fails the job whatever the input says.
    [1, false, 0, /exited with code 1/],
    [1, true, 0, /exited with code 1/],
    [1, false, 2, /exited with code 1/],
    [1, true, 2, /found failing tests/],
    [2, false, 0, /exited with code 2/],
    [130, false, 0, /exited with code 130/],
  ];
  for (const [exitCode, exitOnFail, failedSpecs, expected] of table) {
    const message = failureMessage({ exitCode, exitOnFail, failedSpecs });
    const label = `exit ${exitCode}, exit_on_fail ${exitOnFail}, ${failedSpecs} failed`;
    if (expected) assert.match(message ?? "", expected, label);
    else assert.equal(message, null, label);
  }
});

test("an unset exit_on_fail is false, with a notice about the v2 default", () => {
  const { exitOnFail, notice } = resolveExitOnFail("");
  assert.equal(exitOnFail, false);
  assert.match(notice ?? "", /v2.*true/);
});

test("an explicit exit_on_fail stays quiet", () => {
  assert.deepEqual(resolveExitOnFail("true"), { exitOnFail: true });
  assert.deepEqual(resolveExitOnFail("false"), { exitOnFail: false });
});
