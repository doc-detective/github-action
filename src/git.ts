type GetExecOutput = (
  command: string,
  args: string[],
  options: { cwd: string; silent: boolean; ignoreReturnCode: boolean }
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export type Git = (args: string[]) => Promise<string>;

/**
 * Run git in the `working_directory` input, quietly, and return its stdout. A
 * non-zero exit throws with git's stderr, so callers can log why.
 */
export function makeGit(getExecOutput: GetExecOutput, cwd: string): Git {
  return async (args) => {
    const { exitCode, stdout, stderr } = await getExecOutput("git", args, {
      cwd,
      silent: true,
      ignoreReturnCode: true,
    });
    if (exitCode !== 0) throw new Error(`\`git ${args.join(" ")}\` failed: ${stderr.trim()}`);
    return stdout;
  };
}
