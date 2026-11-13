/** `exit_on_fail` is on unless it's explicitly false. */
export function parseExitOnFail(input: string): boolean {
  return input.trim().toLowerCase() !== "false";
}

/**
 * Whether the job should fail, given the CLI's exit code: 0 passed, 1 a spec
 * failed, 2 nothing valid was tested or the CLI couldn't proceed. Any other code,
 * such as an interrupt, means the run didn't finish, so it fails too.
 */
export function decideOutcome({
  exitCode,
  exitOnFail,
}: {
  exitCode: number;
  exitOnFail: boolean;
}): { fail: boolean; reason: string } {
  if (exitCode === 0) return { fail: false, reason: "Doc Detective passed." };
  if (exitCode === 1) {
    return exitOnFail
      ? { fail: true, reason: "Doc Detective found failing tests." }
      : {
          fail: false,
          reason: "Doc Detective found failing tests, but exit_on_fail is false.",
        };
  }
  if (exitCode === 2) {
    return {
      fail: true,
      reason:
        "Doc Detective exited with code 2: nothing valid was tested, or it couldn't proceed. See the log for details.",
    };
  }
  return { fail: true, reason: `Doc Detective exited with code ${exitCode}.` };
}
