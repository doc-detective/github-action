import fs from "fs";
import path from "path";

/** What CLI 5 writes under `outputDir`: the run folder and its reports. */
const RUN_ARTIFACTS = [".doc-detective/", "junit.xml", "doc-detective-summary.md", "testResults-*"];

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

/**
 * Keep the run's artifacts out of `git status`, so they don't open a pull
 * request or show up as changes in later steps, through the checkout's
 * `info/exclude`. Unlike `.gitignore`, it's local and never committed. Returns
 * false, changing nothing, outside a checkout. Throws when the file can't be
 * written, such as in a read-only `.git`.
 */
export async function excludeRunArtifacts(git: Git, cwd: string): Promise<boolean> {
  let file: string;
  try {
    // Relative to `cwd` at a checkout's root, and absolute elsewhere.
    file = path.resolve(cwd, (await git(["rev-parse", "--git-path", "info/exclude"])).trim());
  } catch {
    return false;
  }
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = RUN_ARTIFACTS.filter((pattern) => !lines.has(pattern));
  if (missing.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const separator = current && !current.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(file, `${separator}# Doc Detective run artifacts\n${missing.join("\n")}\n`);
  }
  return true;
}
