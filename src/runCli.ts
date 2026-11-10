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
 * The `npx` arguments, as an array so paths with spaces stay one argument. An
 * empty `version` means whatever doc-detective already resolves from the working
 * directory, such as a local build exposed with `npm link`. Pinning any
 * `doc-detective@<tag>` makes npx ignore that build.
 */
export function buildCliArgs({
  version,
  config,
  input,
  outputPath,
}: {
  version: string;
  config: string;
  input: string;
  outputPath: string;
}): string[] {
  return [
    version ? `doc-detective@${version}` : "doc-detective",
    ...(config ? ["--config", config] : []),
    ...(input ? ["--input", input] : []),
    "--output",
    outputPath,
    // No `--output-dir`: the config's `outputDir` places the run folder and
    // reports, so `screenshot` baselines compare across runs. The action keeps
    // them out of git through `info/exclude` instead.
  ];
}

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
  args,
  outputPath,
  cwd,
}: {
  exec: Exec;
  command: string;
  args: string[];
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
