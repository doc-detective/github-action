import test from "node:test";
import assert from "node:assert/strict";
import { makeGit } from "./git.ts";

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
