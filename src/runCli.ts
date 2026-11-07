import fs from "fs";
import { loadResults } from "./loadResults.ts";

type Exec = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    ignoreReturnCode: boolean;
    listeners: {
      stdout: (data: Buffer) => void;
      stderr: (data: Buffer) => void;
    };
  }
) => Promise<number>;

/**
 * Run the CLI and read its results, whatever it exits with. The caller decides
 * what the exit code means, after the results, issue, and PR steps have run.
 *
 * The output file is deleted first, so a crashed run can't pass off an earlier
 * run's results as its own. A missing or unreadable file throws: the run crashed.
 */
export async function runCli({
  exec,
  command,
  args = [],
  outputPath,
  cwd,
}: {
  exec: Exec;
  command: string;
  args?: string[];
  outputPath: string;
  cwd: string;
}): Promise<{ exitCode: number; results: any }> {
  fs.rmSync(outputPath, { force: true });

  // CLI 5 logs to stderr, so a crash's diagnostics are there, not on stdout.
  let cliOutput = "";
  const capture = (data: Buffer) => {
    cliOutput += data.toString();
  };
  const exitCode = await exec(command, args, {
    cwd,
    ignoreReturnCode: true,
    listeners: { stdout: capture, stderr: capture },
  });

  try {
    return { exitCode, results: loadResults(outputPath, cliOutput) };
  } catch (error) {
    throw new Error(
      `Doc Detective exited with code ${exitCode}. ${(error as Error).message}`
    );
  }
}
