import test from "node:test";
import assert from "node:assert/strict";
import { decideOutcome, parseExitOnFail } from "./outcome.ts";

test("decideOutcome maps each exit code against exit_on_fail", () => {
  const table: [number, boolean, boolean, RegExp][] = [
    [0, true, false, /passed/],
    [0, false, false, /passed/],
    [1, true, true, /failing tests/],
    [1, false, false, /exit_on_fail is false/],
    [2, true, true, /nothing valid was tested/],
    [2, false, true, /nothing valid was tested/],
    // Anything off the contract, such as an interrupt, fails closed.
    [130, true, true, /exited with code 130/],
    [130, false, true, /exited with code 130/],
    [-1, false, true, /exited with code -1/],
  ];
  for (const [exitCode, exitOnFail, fail, reason] of table) {
    const outcome = decideOutcome({ exitCode, exitOnFail });
    const label = `exit ${exitCode}, exit_on_fail ${exitOnFail}`;
    assert.equal(outcome.fail, fail, label);
    assert.match(outcome.reason, reason, label);
  }
});

test("exit_on_fail is on unless it's explicitly false", () => {
  for (const input of ["true", "", "TRUE", "yes"]) {
    assert.equal(parseExitOnFail(input), true, input);
  }
  for (const input of ["false", "False", "FALSE"]) {
    assert.equal(parseExitOnFail(input), false, input);
  }
});
