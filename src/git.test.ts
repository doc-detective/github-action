import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { excludeRunArtifacts, makeGit } from "./git.ts";

test("runs git in the working directory and returns stdout", async () => {
  const calls: unknown[] = [];
  const git = makeGit(async (command, args, options) => {
    calls.push([command, args, options]);
    return { exitCode: 0, stdout: " M docs/a.md\n", stderr: "" };
  }, "docs dir");
  assert.equal(await git(["status", "--porcelain"]), " M docs/a.md\n");
  assert.deepEqual(calls, [
    ["git", ["status", "--porcelain"], { cwd: "docs dir", silent: true, ignoreReturnCode: true }],
  ]);
});

test("a failing git command throws with git's stderr", async () => {
  const git = makeGit(
    async () => ({ exitCode: 128, stdout: "", stderr: "fatal: not a git repository\n" }),
    "."
  );
  await assert.rejects(git(["status"]), /`git status` failed: fatal: not a git repository$/);
});

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dd-gha-git-"));
}

test("excludeRunArtifacts adds the run artifacts to the file git names", async () => {
  const cwd = tmpDir();
  const git = async (args: string[]) => {
    assert.deepEqual(args, ["rev-parse", "--git-path", "info/exclude"]);
    return ".git/info/exclude\n";
  };
  assert.equal(await excludeRunArtifacts(git, cwd), true);
  assert.equal(
    fs.readFileSync(path.join(cwd, ".git", "info", "exclude"), "utf8"),
    "# Doc Detective run artifacts\n.doc-detective/\njunit.xml\ndoc-detective-summary.md\ntestResults-*\n"
  );
});

test("excludeRunArtifacts keeps existing lines and adds each pattern once", async () => {
  const cwd = tmpDir();
  const file = path.join(cwd, "exclude");
  fs.writeFileSync(file, "# mine\r\njunit.xml");
  const git = async () => file;
  await excludeRunArtifacts(git, cwd);
  await excludeRunArtifacts(git, cwd);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    "# mine\r\njunit.xml\n# Doc Detective run artifacts\n.doc-detective/\ndoc-detective-summary.md\ntestResults-*\n"
  );
});

test("excludeRunArtifacts skips a directory outside a checkout", async () => {
  const git = async () => {
    throw new Error("`git rev-parse` failed: fatal: not a git repository");
  };
  assert.equal(await excludeRunArtifacts(git, tmpDir()), false);
});

test("excludeRunArtifacts throws when it can't write the file, so the caller can warn", async () => {
  // A directory where the file should be stands in for a read-only .git.
  const git = async () => tmpDir();
  await assert.rejects(excludeRunArtifacts(git, tmpDir()), /EISDIR/);
});
