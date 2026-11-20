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
  cacheKeyPrefix,
  cachePaths,
  exactVersion,
  iosCacheKeyPrefix,
  iosCachePath,
  iosRestoreKeys,
  iosSaveKey,
  isExactVersion,
  resolveCacheRoot,
  shouldCacheIos,
  versionTag,
  otherNpxDirs,
} from "./runtimeCache.ts";
import { scanRoots } from "./scanSpecs.ts";
import {
  comparisonArgs,
  compareSupportWarnings,
  parseCompareTo,
  parseFailOn,
  previousResultsPath,
  restorePreviousResults,
  resultsKeyPrefix,
  resultsSaveKey,
  saveResults,
} from "./previousResults.ts";
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
    const failOn = parseFailOn(core.getInput("fail_on"));
    const compareTo = parseCompareTo(core.getInput("compare_to"), failOn);

    // Android emulator support: on Linux, grant KVM access so the emulator can
    // accelerate. Driven by the `android` input ("auto" | "true" | "false");
    // "auto" scans the specs and sets up KVM only when an android platform is
    // present. Everything else (SDK, emulator, image, driver) Doc Detective
    // bootstraps itself at test time.
    const androidInput = core.getInput("android");
    const roots = scanRoots({ input, config, cwd });
    const androidDecision = shouldSetUpAndroid({
      androidInput,
      platform: os.platform(),
      roots,
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
    // has this Node.js range, so the check skips a version that stays on 4.
    const node = await getExecOutput("node", ["--version"], {
      cwd,
      silent: true,
      ignoreReturnCode: true,
    }).catch(() => undefined);
    if (canInstallCli5(version)) {
      const nodeWarning = node && nodeVersionWarning(node.stdout);
      if (nodeWarning) core.warning(nodeWarning);
    }

    const cacheOn = core.getInput("cache").trim().toLowerCase() !== "false";
    const runtime = cacheOn ? await restoreRuntimeCache(version, cwd, config, node?.stdout ?? "") : { version };
    // After the runtime entry, which holds the record of WebDriverAgent builds.
    const ios = shouldCacheIos({ cacheOn, version, available: cache.isFeatureAvailable(), platform: os.platform(), roots })
      ? await restoreIosCache(resolveCacheRoot({ cwd, config }))
      : undefined;

    const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
    const outputPath = path.resolve(runnerTemp, "doc-detective-output.json");

    // Compare with the previous results, unless `version` is too old to.
    const compareWarnings = compareSupportWarnings(runtime.version, failOn);
    for (const message of compareWarnings) core.warning(message);
    const compare = compareWarnings.length === 0;
    const previous = {
      cache,
      file: previousResultsPath(runnerTemp),
      prefix: resultsKeyPrefix({ platform: os.platform(), config, input, cwd, env: process.env }),
      warning: core.warning,
    };
    const cacheResults = compareTo !== "false" && cache.isFeatureAvailable();
    const restored =
      compare && compareTo === "previous" && cacheResults ? await restorePreviousResults(previous) : undefined;
    if (restored) core.info("Comparing with the previous results from the cache.");
    const args = [
      ...buildCliArgs({ version: runtime.version, config, input, outputPath }),
      ...(compare ? comparisonArgs({ compareTo, failOn, restored }) : []),
    ];

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
    core.setOutput("comparison", results?.comparison ? JSON.stringify(results.comparison) : "");
    if (cacheResults) {
      await saveResults({
        ...previous,
        output: outputPath,
        key: resultsSaveKey(previous.prefix, process.env),
        event: process.env.GITHUB_EVENT_NAME ?? "",
      });
    }
    await saveRuntimeCache(runtime.save);
    await saveIosCache(ios);

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
    // Only when a comparison ran and found nothing new; `exitOnFail: false` also exits 0.
    if (exitCode === 0 && failedSpecs > 0 && failOn === "new" && results?.comparison?.summary?.new === 0) {
      core.info(`${failedSpecs} spec(s) failed, but every failure was already failing, so this job passes. \`fail_on\` is \`new\`.`);
    } else if (exitCode === 0 && failedSpecs > 0) {
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

type CacheSave = { prefix: string; version: string; tag: string; root: string; npxRoot: string; paths: string[]; restoredKey?: string };

/**
 * Restore the doc-detective package npx installs, and the runtime and browsers
 * Doc Detective installs on first use, from the newest cache for this OS, CPU,
 * and Node.js major, preferring one for this CLI version. Returns the exact
 * version to run, so the `_npx` folder matches, and what to save after the
 * run. Any failure warns and runs uncached.
 */
async function restoreRuntimeCache(
  version: string,
  cwd: string,
  config: string,
  nodeVersion: string
): Promise<{ version: string; save?: CacheSave }> {
  // A linked CLI has no version to key on.
  if (!version) return { version };
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
    const prefix = cacheKeyPrefix({ platform: os.platform(), arch: os.arch(), nodeVersion });
    const root = resolveCacheRoot({ cwd, config });
    // npx installs doc-detective itself under `<npm cache>/_npx`.
    const npmCache = (await getExecOutput("npm", ["config", "get", "cache"], { cwd, silent: true })).stdout.trim();
    const npxRoot = path.join(npmCache, "_npx");
    const paths = [...cachePaths(root), npxRoot];
    const { tag, refreshesBrowsers } = versionTag(exact, Date.now());
    // A CLI that refreshes browsers can start from any version's cache.
    const restoreKeys = refreshesBrowsers ? [`${prefix}${tag}-`, prefix] : [`${prefix}${tag}-`];
    const restoredKey = await cache.restoreCache(paths, `${prefix}${tag}-`, restoreKeys);
    core.info(
      restoredKey
        ? `Restored doc-detective and its runtime from the cache (${restoredKey}).`
        : `No cached doc-detective and runtime, so this run installs and caches them.`
    );
    return { version: exact, save: { prefix, version: exact, tag, root, npxRoot, paths, restoredKey } };
  } catch (error) {
    core.warning(`Couldn't restore the Doc Detective runtime cache, so this run installs it. ${(error as Error).message}`);
    return { version };
  }
}

/**
 * Cache what this run installed or updated, under a key that hashes what
 * `installed.json` records. Skips when that matches what was restored. Any
 * failure warns.
 */
async function saveRuntimeCache(save?: CacheSave): Promise<void> {
  if (!save) return;
  try {
    // The CLI writes installed.json once it installs something. Without it, a
    // run that failed early would cache `_npx` alone and look like a hit later.
    const installed = path.join(save.root, "installed.json");
    if (!fs.existsSync(installed)) return;
    const key = cacheKey(save.prefix, save.tag, fs.readFileSync(installed, "utf8"));
    if (key === save.restoredKey) return;
    // Keep everything else npx installed out of the cache, then put it back.
    const aside = `${save.npxRoot}-aside`;
    const moved: [string, string][] = [];
    try {
      // A run killed mid-save can leave folders here; they'd block the renames.
      fs.rmSync(aside, { recursive: true, force: true });
      fs.mkdirSync(aside, { recursive: true });
      for (const dir of otherNpxDirs(save.npxRoot, save.version)) {
        const to = path.join(aside, path.basename(dir));
        fs.renameSync(dir, to);
        moved.push([to, dir]);
      }
      if ((await cache.saveCache(save.paths, key)) !== -1) {
        core.info(`Cached doc-detective and its runtime (${key}).`);
      }
    } finally {
      for (const [from, to] of moved) fs.renameSync(from, to);
    }
  } catch (error) {
    core.warning(`Couldn't cache the Doc Detective runtime. ${(error as Error).message}`);
  }
}

type IosCache = { root: string; prefix: string; restoredKey?: string };

/** `installed.json` in the cache folder `root`, if the CLI has written one. */
function readInstalled(root: string): string | undefined {
  try {
    return fs.readFileSync(path.join(root, "installed.json"), "utf8");
  } catch {
    return undefined;
  }
}

/** An error's message, as a sentence. */
function cause(error: unknown): string {
  return String((error as Error)?.message ?? error).replace(/\.?\s*$/, ".");
}

/**
 * Restore the WebDriverAgent builds from the newest cache for this OS and CPU,
 * preferring one for the builds `installed.json` records. Returns what to
 * compare against after the run. Any failure warns and saves nothing.
 */
async function restoreIosCache(root: string): Promise<IosCache | undefined> {
  try {
    const prefix = iosCacheKeyPrefix({ platform: os.platform(), arch: os.arch() });
    const { primaryKey, restoreKeys } = iosRestoreKeys(prefix, readInstalled(root));
    const restoredKey = await cache.restoreCache([iosCachePath(root)], primaryKey, restoreKeys);
    core.info(
      restoredKey
        ? `Restored the WebDriverAgent build from the cache (${restoredKey}).`
        : `No cached WebDriverAgent build, so this run builds and caches it.`
    );
    return { root, prefix, restoredKey };
  } catch (error) {
    core.warning(`Couldn't restore the WebDriverAgent cache, so this run builds it. ${cause(error)}`);
    return undefined;
  }
}

/**
 * Cache the WebDriverAgent builds when the run built one, or the set of builds
 * changed. Skips when the key matches what was restored. Any failure warns.
 */
async function saveIosCache(ios?: IosCache): Promise<void> {
  if (!ios) return;
  try {
    const key = iosSaveKey({ ...ios, installedJson: readInstalled(ios.root) });
    if (key && (await cache.saveCache([iosCachePath(ios.root)], key)) !== -1) {
      core.info(`Cached the WebDriverAgent build (${key}).`);
    }
  } catch (error) {
    core.warning(`Couldn't cache the WebDriverAgent build. ${cause(error)}`);
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
