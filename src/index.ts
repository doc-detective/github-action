import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import * as github from "@actions/github";
import os from "os";
import path from "path";
import fs from "fs";
import { buildCliArgs, runCli } from "./runCli.ts";
import { excludeRunArtifacts, makeGit, type Git } from "./git.ts";
import { canInstallCli5, nodeVersionWarning } from "./nodeVersion.ts";
import { changedFiles, openPullRequest, prBase } from "./pullRequest.ts";
import { decideOutcome, parseExitOnFail } from "./outcome.ts";
import { buildIssueBody, readRunSummary } from "./issueBody.ts";
import { fileIssue } from "./issue.ts";
import { shouldSetUpAndroid, enableLinuxKvm } from "./androidSetup.ts";
import { DEFAULT_ISSUE_PROMPT, getAliasedInput } from "./actionInputs.ts";
import { parseIntegrations, buildIntegrationsAccordion } from "./integrations.ts";
import {
  cacheKey,
  cachePaths,
  defaultCacheRoot,
  exactVersion,
  isExactVersion,
} from "./runtimeCache.ts";
import * as cache from "@actions/cache";

const meta = { dist_interface: "github-actions" };
process.env["DOC_DETECTIVE_META"] = JSON.stringify(meta);

const repoOwner = github.context.repo.owner;
const repoName = github.context.repo.repo;
const runId = process.env.GITHUB_RUN_ID;
const runURL = `https://github.com/${repoOwner}/${repoName}/actions/runs/${runId}`;

main();

async function main(): Promise<void> {
  try {
    // Post warning if running on Linux
    if (os.platform() === "linux") {
      core.warning(
        "On Linux runners, Chrome and Firefox contexts run headless when there's no display. Doc Detective records headless Chrome, but not headless Firefox. To run headed or record Firefox, install Xvfb, or use a macOS or Windows runner."
      );
    }
    // Get the inputs
    const version = core.getInput("version");
    const exitOnFail = parseExitOnFail(core.getInput("exit_on_fail"));
    const cwd = core.getInput("working_directory");
    const config = core.getInput("config");
    const input = core.getInput("input");
    // Read the renamed inputs up front, so setting both names fails before the run.
    // (Passing `core` itself would keep all of @actions/core in the bundle.)
    const io = { getInput: core.getInput, warning: core.warning };
    const issueMentions = getAliasedInput("issue_mentions", "integrations", io);
    const issuePrompt = getAliasedInput("issue_prompt", "prompt", io) || DEFAULT_ISSUE_PROMPT;

    // Android emulator support: on Linux, grant KVM access so the emulator can
    // accelerate. Driven by the `android` input ("auto" | "true" | "false");
    // "auto" scans the specs and sets up KVM only when an android platform is
    // present. Everything else (SDK, emulator, image, driver) Doc Detective
    // bootstraps itself at test time.
    const androidInput = core.getInput("android");
    const scanRoots = [input, config, cwd]
      .filter((p) => p && p.length > 0)
      .map((p) => path.resolve(cwd || ".", p));
    const androidDecision = shouldSetUpAndroid({
      androidInput,
      platform: os.platform(),
      roots: scanRoots.length ? scanRoots : [path.resolve(cwd || ".")],
    });
    core.info(
      `Android setup: ${androidDecision.setUp ? "enabled" : "skipped"} (${androidDecision.reason}).`
    );
    if (androidDecision.setUp) {
      await enableLinuxKvm({
        existsSync: (p) => fs.existsSync(p),
        exec: (command, args) => exec(command, args),
        info: (m) => core.info(m),
        warning: (m) => core.warning(m),
      });
    }

    // npx runs Doc Detective on the job's Node.js, not the action's. Only CLI 5
    // needs 24.15, so the check skips a version that stays on 4.
    const node = await getExecOutput("node", ["--version"], {
      cwd,
      silent: true,
      ignoreReturnCode: true,
    }).catch(() => undefined);
    if (canInstallCli5(version)) {
      const nodeWarning = node && nodeVersionWarning(node.stdout);
      if (nodeWarning) core.warning(nodeWarning);
    }

    const runtime =
      core.getInput("cache").trim().toLowerCase() === "false"
        ? { version }
        : await restoreRuntimeCache(version, cwd, node?.stdout ?? "");

    const outputPath = path.resolve(
      process.env.RUNNER_TEMP || os.tmpdir(),
      "doc-detective-output.json"
    );
    const args = buildCliArgs({ version: runtime.version, config, input, outputPath });

    // Git runs in working_directory, like Doc Detective. The run folder and
    // reports land under the config's outputDir, so keep them out of git.
    const git = makeGit(getExecOutput, cwd);
    await excludeRunArtifacts(git, cwd).catch((error) =>
      core.warning(
        `Couldn't keep the run artifacts out of git, so they can show up in \`git status\` and pull requests. ${(error as Error).message}`
      )
    );

    // Run Doc Detective
    core.info(`Running Doc Detective: npx ${args.join(" ")}`);
    core.info(`Working directory: ${cwd}`);

    // Read results from the file we passed via `--output`, not from stdout, and
    // whatever the exit code, so the results, issue, and PR steps still run
    // before a non-zero exit fails the job.
    const { exitCode, results } = await runCli({
      exec,
      command: "npx",
      args,
      outputPath,
      cwd,
    });
    core.setOutput("results", results);
    await saveRuntimeCache(runtime.save);

    // Create a pull request if there are changed files
    if (core.getInput("create_pr_on_change") == "true") {
      core.info("Checking for changed files.");
      const prPaths = listInput("pr_paths");
      let status = "";
      try {
        status = await changedFiles(git, prPaths);
      } catch (error) {
        core.warning(
          `Couldn't check ${path.resolve(cwd)} for changed files, so the action opens no pull request. ${(error as Error).message}`
        );
      }

      if (status.trim()) {
        core.info(`Changed files:\n${status}`);
        try {
          const pr = await createPullRequest(git, prPaths);
          core.setOutput("pull_request_url", pr.url);
          core.info(`Pull request ${pr.updated ? "updated" : "created"}: ${pr.url}`);
        } catch (error) {
          core.error(`Error creating or updating the pull request: ${(error as Error).message}`);
        }
      }
    }

    // Create an issue if there are failing tests
    if (results?.summary?.specs?.fail > 0) {
      if (core.getInput("create_issue_on_fail") == "true") {
        // Create an issue if there are failing tests
        try {
          const issue = await createIssue(
            JSON.stringify(results, null, 2),
            readRunSummary(results.runDir, runURL),
            issueMentions,
            issuePrompt
          );
          core.setOutput("issue_url", issue.url);
          core.info(`Issue ${issue.updated ? "updated" : "created"}: ${issue.url}`);
        } catch (error) {
          core.error(`Error creating or updating the issue: ${(error as Error).message}`);
        }
      }
    }

    const failedSpecs = results?.summary?.specs?.fail ?? 0;
    if (exitCode === 0 && failedSpecs > 0) {
      core.warning(
        `Doc Detective exited 0 although ${failedSpecs} spec(s) failed, so this job passes. Either your config sets exitOnFail: false, or the version input runs a CLI older than 5.`
      );
    }

    const outcome = decideOutcome({ exitCode, exitOnFail });
    if (outcome.fail) core.setFailed(outcome.reason);
    else core.info(outcome.reason);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

async function createIssue(results: string, summary: string, mentions: string, prompt: string) {
  const token = core.getInput("token");
  const title = core.getInput("issue_title");
  const integrations = parseIntegrations(mentions);
  const integrationsAccordion = buildIntegrationsAccordion(integrations, prompt);
  const body = buildIssueBody({
    template: core.getInput("issue_body"),
    summary,
    results,
    runUrl: runURL,
    prompt,
    suffix: integrationsAccordion,
  });
  const labelsList = core.getInput("issue_labels").split(",").map((s) => s.trim()).filter(Boolean);
  const assigneesList = core.getInput("issue_assignees").split(",").map((s) => s.trim()).filter(Boolean);
  if (integrations.includes("copilot") && !assigneesList.includes("copilot-swe-agent")) {
    assigneesList.push("copilot-swe-agent");
  }

  return fileIssue({
    octokit: github.getOctokit(token),
    owner: repoOwner,
    repo: repoName,
    title,
    body,
    labels: labelsList,
    assignees: assigneesList,
    warning: core.warning,
  });
}

/**
 * Restore the doc-detective package npx installs, and the runtime and browsers
 * Doc Detective installs on first use. Returns
 * the exact version to run, so what runs matches the key, and the cache to save
 * after the run on a miss. Any failure warns and runs uncached.
 */
async function restoreRuntimeCache(
  version: string,
  cwd: string,
  nodeVersion: string
): Promise<{ version: string; save?: { key: string; paths: string[] } }> {
  // A linked CLI has no version to key on.
  if (!version) return { version };
  if (process.env.DOC_DETECTIVE_CACHE_DIR) {
    core.info("DOC_DETECTIVE_CACHE_DIR is set, so the action leaves caching the Doc Detective runtime to you.");
    return { version };
  }
  if (!cache.isFeatureAvailable()) {
    core.info("The Actions cache isn't available here, so Doc Detective installs its runtime uncached.");
    return { version };
  }
  try {
    const exact = isExactVersion(version)
      ? version
      : exactVersion(
          (await getExecOutput("npm", ["view", `doc-detective@${version}`, "version", "--json"], { cwd, silent: true })).stdout
        );
    if (!exact) throw new Error(`npm found no doc-detective version matching "${version}".`);
    const key = cacheKey({
      version: exact,
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion,
      now: Date.now(),
    });
    // npx installs doc-detective itself under `<npm cache>/_npx`.
    const npmCache = (await getExecOutput("npm", ["config", "get", "cache"], { cwd, silent: true })).stdout.trim();
    const paths = [...cachePaths(defaultCacheRoot()), path.join(npmCache, "_npx")];
    const restored = await cache.restoreCache(paths, key);
    core.info(
      restored
        ? `Restored doc-detective and its runtime from the cache (${key}).`
        : `No cached doc-detective and runtime for ${key}, so this run installs and caches them.`
    );
    return { version: exact, save: restored ? undefined : { key, paths } };
  } catch (error) {
    core.warning(`Couldn't restore the Doc Detective runtime cache, so this run installs it. ${(error as Error).message}`);
    return { version };
  }
}

/** Cache what this run installed. Any failure warns. */
async function saveRuntimeCache(save?: { key: string; paths: string[] }): Promise<void> {
  if (!save) return;
  // A config `cacheDir` puts the runtime somewhere else, leaving nothing here.
  if (!save.paths.some((p) => fs.existsSync(p))) {
    core.info("Doc Detective installed nothing in its default cache folder, so there's nothing to cache.");
    return;
  }
  try {
    if ((await cache.saveCache(save.paths, save.key)) !== -1) {
      core.info(`Cached doc-detective and its runtime (${save.key}).`);
    }
  } catch (error) {
    core.warning(`Couldn't cache the Doc Detective runtime. ${(error as Error).message}`);
  }
}

/** A comma-separated input, as a list. */
function listInput(name: string): string[] {
  return core.getInput(name).split(",").map((s) => s.trim()).filter(Boolean);
}

function createPullRequest(git: Git, paths: string[]) {
  return openPullRequest({
    git,
    octokit: github.getOctokit(core.getInput("token")),
    owner: repoOwner,
    repo: repoName,
    branch: core.getInput("pr_branch") || "doc-detective-changes",
    base: prBase(process.env),
    paths,
    title: core.getInput("pr_title"),
    body: core.getInput("pr_body").replace("$RUN_URL", runURL),
    actor: process.env.GITHUB_ACTOR ?? "",
    labels: listInput("pr_labels"),
    assignees: listInput("pr_assignees"),
    reviewers: listInput("pr_reviewers"),
    error: core.error,
  });
}
