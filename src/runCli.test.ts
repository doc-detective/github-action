import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { runCli } from "./runCli.ts";

function tmpPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gha-cli-"));
  return path.join(dir, "doc-detective-output.json");
}

const passing = { summary: { specs: { fail: 0, pass: 1 } } };

test("loads results after a non-zero exit, without rejecting", async () => {
  const outputPath = tmpPath();
  const out = await runCli({
    exec: async () => {
      fs.writeFileSync(outputPath, JSON.stringify(passing));
      return 1;
    },
    command: "npx doc-detective",
    outputPath,
    cwd: ".",
  });
  assert.equal(out.exitCode, 1);
  assert.deepEqual(out.results, passing);
});

test("runs with ignoreReturnCode and the requested working directory", async () => {
  const outputPath = tmpPath();
  let seen: any;
  await runCli({
    exec: async (_command, _args, options) => {
      seen = options;
      fs.writeFileSync(outputPath, "{}");
      return 0;
    },
    command: "npx doc-detective",
    outputPath,
    cwd: "docs",
  });
  assert.equal(seen.ignoreReturnCode, true);
  assert.equal(seen.cwd, "docs");
});

test("deletes a stale output file, so a crash can't reuse old results", async () => {
  const outputPath = tmpPath();
  fs.writeFileSync(outputPath, JSON.stringify(passing));
  await assert.rejects(
    runCli({
      exec: async () => {
        assert.equal(fs.existsSync(outputPath), false);
        return 2;
      },
      command: "npx doc-detective",
      outputPath,
      cwd: ".",
    }),
    /exited with code 2.*did not write results/s
  );
});

test("a crash reports the CLI's stdout and stderr, since logs go to stderr", async () => {
  await assert.rejects(
    runCli({
      exec: async (_command, _args, options) => {
        options.listeners.stdout(Buffer.from("from stdout\n"));
        options.listeners.stderr(Buffer.from("from stderr\n"));
        return 1;
      },
      command: "npx doc-detective",
      outputPath: tmpPath(),
      cwd: ".",
    }),
    /from stdout\nfrom stderr/
  );
});

test("a missing results file fails even when the CLI exits 0", async () => {
  await assert.rejects(
    runCli({
      exec: async () => 0,
      command: "npx doc-detective",
      outputPath: tmpPath(),
      cwd: ".",
    }),
    /exited with code 0.*did not write results/s
  );
});
