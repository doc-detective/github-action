import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import * as github from "@actions/github";
import os from "os";
import path from "path";
import fs from "fs";
import { buildCliArgs, runCli } from "./runCli.ts";
import { makeGit, type Git } from "./git.ts";
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
      let status = "";
      try {
        status = await git(["status", "--porcelain"]);
      } catch (error) {
        core.warning(
          `Couldn't check ${path.resolve(cwd)} for changed files, so the action opens no pull request. ${(error as Error).message}`
        );
      }

      if (status.trim()) {
        core.info(`Changed files:\n${status}`);
        try {
          const pr = await createPullRequest(git);
          core.setOutput("pull_request_url", pr.data.html_url);
          core.info(`Pull Request: ${JSON.stringify(pr)}`);
        } catch (error) {
          core.error(`Error creating pull request: ${(error as Error).message}`);
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

async function createPullRequest(git: Git) {
  const token = core.getInput("token");
  const title = core.getInput("pr_title");
  const body = core.getInput("pr_body").replace("$RUN_URL", runURL);
  const labels = core.getInput("pr_labels");
  const reviewers = core.getInput("pr_reviewers");
  const assignees = core.getInput("pr_assignees");
  const base = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const head = core.getInput("pr_branch") || `doc-detective-${Date.now()}`;

  const octokit = github.getOctokit(token);

  // Infer user email and name
  const userName = process.env.GITHUB_ACTOR;
  const userEmail = `${userName}@users.noreply.github.com`;

  // Configure git with user email and name
  await git(["config", "--global", "user.email", userEmail]);
  await git(["config", "--global", "user.name", userName ?? ""]);

  // Create new branch
  core.info(`Creating branch: ${head}`);
  await git(["checkout", "-b", head]);

  // Commit every change in the checkout, wherever working_directory points.
  await git(["add", "-A"]);
  await git(["commit", "-m", "Doc Detective results"]);
  await git(["push", "origin", head]);

  // Create pull request
  const pr = await octokit.rest.pulls.create({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    title,
    body,
    head,
    base,
  });

  try {
    // Add labels, reviewers, and assignees
    core.info(`Adding labels.`);
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/labels",
      {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: pr.data.number,
        labels: labels.split(",").map((s) => s.trim()).filter(Boolean),
      }
    );
    core.info(`Adding assignees.`);
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/assignees",
      {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: pr.data.number,
        assignees: assignees.split(",").map((s) => s.trim()).filter(Boolean),
      }
    );
    core.info(`Adding reviewers.`);
    await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
      {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: pr.data.number,
        reviewers: reviewers.split(",").map((s) => s.trim()).filter(Boolean),
      }
    );
  } catch (error) {
    if ((error as { status?: number }).status === 403) {
      core.error(
        "Doc Detective doesn't have permissions to create pull requests. Make sure the workflow or job has write permissions for pull requests and that you've allowed GitHub Actions to create pull requests."
      );
    } else {
      core.error(error as Error);
    }
  }

  return pr;
}
