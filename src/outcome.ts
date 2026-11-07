/** An empty `exit_on_fail` means false on v1, with a heads-up about v2's default. */
export function resolveExitOnFail(input: string): {
  exitOnFail: boolean;
  notice?: string;
} {
  if (input === "") {
    return {
      exitOnFail: false,
      notice:
        'exit_on_fail isn\'t set, so failing tests don\'t fail this job unless the CLI exits non-zero. doc-detective/github-action@v2 defaults exit_on_fail to "true". Set it explicitly to choose now.',
    };
  }
  return { exitOnFail: input === "true" };
}

/**
 * Why the job should fail, or null if it shouldn't. CLI 4 exits 0 by default
 * even when a spec fails, so `exit_on_fail` has to read the results. A non-zero
 * exit fails the job whatever the input says.
 */
export function failureMessage({
  exitCode,
  exitOnFail,
  failedSpecs,
}: {
  exitCode: number;
  exitOnFail: boolean;
  failedSpecs: number;
}): string | null {
  if (exitOnFail && failedSpecs > 0) return "Doc Detective found failing tests.";
  if (exitCode !== 0) return `Doc Detective exited with code ${exitCode}.`;
  return null;
}
