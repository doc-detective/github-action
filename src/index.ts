import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import * as github from "@actions/github";
import os from "os";
import path from "path";
import fs from "fs";
import { buildCliArgs, runCli } from "./runCli.ts";
import { makeGit, type Git } from "./git.ts";
import { changedFiles, openPullRequest, prBase } from "./pullRequest.ts";
import { decideOutcome, parseExitOnFail } from "./outcome.ts";
import { buildIssueBody, readRunSummary } from "./issueBody.ts";
import { fileIssue } from "./issue.ts";
import { shouldSetUpAndroid, enableLinuxKvm } from "./androidSetup.ts";
import { DEFAULT_ISSUE_PROMPT, getAliasedInput } from "./actionInputs.ts";
import { parseIntegrations, buildIntegrationsAccordion } from "./integrations.ts";

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
        "On Ubuntu runners, this action only supports headless mode. Firefox and Chrome contexts automatically fall back to headless mode when necessary. If your tests doesn't work in headless mode (like if you need the 'record' step), use macOS or Windows runners."
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

    const outputPath = path.resolve(
      process.env.RUNNER_TEMP || os.tmpdir(),
      "doc-detective-output.json"
    );
    const args = buildCliArgs({ version, config, input, outputPath });

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

    // Create a pull request if there are changed files
    if (core.getInput("create_pr_on_change") == "true") {
      core.info("Checking for changed files.");
      // Git runs in working_directory, like Doc Detective.
      const git = makeGit(getExecOutput, cwd);
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
