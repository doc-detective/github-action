import * as core from "@actions/core";
import { exec } from "@actions/exec";
import * as github from "@actions/github";
import os from "os";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { loadResults } from "./loadResults.ts";
import {
  confineToRoot,
  errorMessage,
  parseHtmlReportPath,
  renderMarkdownSummary,
  reportArtifactName,
  writeJobSummary,
  uploadReportArtifact,
} from "./report.ts";
import { shouldSetUpAndroid, enableLinuxKvm } from "./androidSetup.ts";
import {
  shouldCacheWda,
  detectXcodeVersion,
  detectXcuitestDriverVersion,
  restoreWdaCache,
  saveWdaCache,
  type WdaCacheDeps,
} from "./iosSetup.ts";
import * as cache from "@actions/cache";

const meta = { dist_interface: "github-actions" };
process.env["DOC_DETECTIVE_META"] = JSON.stringify(meta);

const INTEGRATION_MAP: Record<string, string> = {
  "doc-sentinel": "\n/cc @reem-sab",
  "promptless": "\n@promptless $PROMPT",
  "dosu": "\n@dosu $PROMPT",
  "claude": "\n@claude $PROMPT",
  "opencode": "\n/opencode $PROMPT",
  "cursor": "\n@cursor $PROMPT",
};

// All valid integration names (INTEGRATION_MAP keys + special-case integrations)
const VALID_INTEGRATIONS = new Set([...Object.keys(INTEGRATION_MAP), "copilot"]);

function parseIntegrations(integrationsInput: string): string[] {
  if (!integrationsInput || !integrationsInput.trim()) return [];

  const requested = integrationsInput.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  const valid: string[] = [];

  for (const name of requested) {
    if (VALID_INTEGRATIONS.has(name)) {
      valid.push(name);
    } else {
      core.warning(
        `Unknown integration "${name}". Supported integrations: ${[...VALID_INTEGRATIONS].join(", ")}`
      );
    }
  }

  return valid;
}

function buildIntegrationsAccordion(integrations: string[], prompt: string): string {
  const accordionEntries = integrations
    .filter((name) => name !== "copilot")
    .map((name) => INTEGRATION_MAP[name].replace("$PROMPT", prompt))
    .filter(Boolean);

  if (accordionEntries.length === 0) return "";

  return `\n\n<details>\n<summary>Integrations</summary>\n${accordionEntries.join("\n")}\n</details>`;
}

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
    // An empty `version` means "use whatever doc-detective is already resolvable
    // from the working directory" — e.g. a locally-built checkout exposed via
    // `npm link`, so a repo can dog-food the action against its own build under
    // review rather than the published package. Pinning `doc-detective@<tag>`
    // (even `@latest`) makes npx resolve from the registry and ignore a linked
    // local build, so omit the `@version` suffix entirely when version is blank.
    const dd = version ? `doc-detective@${version}` : "doc-detective";
    const cwd = core.getInput("working_directory");
    const config = core.getInput("config");
    const input = core.getInput("input");

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

    // iOS WebDriverAgent build cache: on macOS, point Doc Detective's WDA build
    // at a stable derivedDataPath and restore/save it across runs so the ~10-min
    // cold WDA compile only happens once. Driven by the `ios` input
    // ("auto" | "true" | "false"); "auto" scans the specs. Everything else (the
    // XCUITest driver, the simulator) Doc Detective bootstraps itself.
    const iosInput = core.getInput("ios");
    const wdaDecision = shouldCacheWda({
      iosInput,
      platform: os.platform(),
      roots: scanRoots.length ? scanRoots : [path.resolve(cwd || ".")],
    });
    core.info(
      `WebDriverAgent cache: ${wdaDecision.setUp ? "enabled" : "skipped"} (${wdaDecision.reason}).`
    );
    let wdaCache:
      | { derivedDataPath: string; key: string; exactHit: boolean; deps: WdaCacheDeps }
      | undefined;
    if (wdaDecision.setUp) {
      const derivedDataPath = path.join(
        process.env.RUNNER_TEMP || os.tmpdir(),
        "dd-wda-derived"
      );
      // Doc Detective reads this and passes it to the XCUITest driver as
      // appium:derivedDataPath, so WDA's Xcode build products land where we
      // cache them.
      process.env.DOC_DETECTIVE_IOS_WDA_DERIVED_DATA_PATH = derivedDataPath;
      const wdaDeps: WdaCacheDeps = {
        restoreCache: (paths, key, restoreKeys) =>
          cache.restoreCache(paths, key, restoreKeys),
        saveCache: (paths, key) => cache.saveCache(paths, key),
        info: (m) => core.info(m),
        warning: (m) => core.warning(m),
      };
      const { key, exactHit } = await restoreWdaCache({
        derivedDataPath,
        xcodeVersion: detectXcodeVersion(),
        driverVersion: detectXcuitestDriverVersion(),
        deps: wdaDeps,
      });
      wdaCache = { derivedDataPath, key, exactHit, deps: wdaDeps };
    }

    // Compile command
    let compiledCommand = `npx ${dd}`;
    // If v2, add the 'runTests' command
    if (version.startsWith("2")) {
      compiledCommand += " runTests";
    }
    // Add the options
    if (config) compiledCommand += ` --config ${config}`;
    if (input) compiledCommand += ` --input ${input}`;
    const outputPath = path.resolve(
      process.env.RUNNER_TEMP || os.tmpdir(),
      "doc-detective-output.json"
    );
    compiledCommand += ` --output ${outputPath}`;

    // Run Doc Detective
    core.info(`Running Doc Detective: ${compiledCommand}`);
    core.info(`Working directory: ${cwd}`);

    let commandOutputData = "";
    const options: Parameters<typeof exec>[2] = {
      cwd,
      listeners: {
        stdout: (data: Buffer) => {
          commandOutputData += data.toString();
        },
      },
    };
    await exec(compiledCommand, [], options);

    // Persist the WebDriverAgent build for the next run (no-op on an exact hit;
    // any failure is a warning, not a run failure).
    if (wdaCache) {
      await saveWdaCache(wdaCache);
    }

    // Read results from the file we passed via `--output`, not from stdout.
    // Doc Detective's log text is human-facing and free to change (e.g. extra
    // "See per-run ..." lines), and scraping the path back out of it coupled
    // this action to that format and broke it. See doc-detective#346.
    const results = loadResults(outputPath, commandOutputData);
    core.setOutput("results", results);

    // Attach the reports to the run: a Markdown summary (derived from the JSON)
    // on the job summary page, plus a downloadable artifact bundling the JSON,
    // the Markdown, and — when Doc Detective emits one — the HTML report. This
    // runs regardless of pass/fail (so reports are attached even before an
    // `exit_on_fail` failure) and is best effort: any failure here is a
    // warning, never a run failure.
    try {
      const stagingDir = path.resolve(
        process.env.RUNNER_TEMP || os.tmpdir(),
        "doc-detective-report"
      );
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.mkdirSync(stagingDir, { recursive: true });

      const artifactFiles: string[] = [];

      // JSON results (always available — we just read them above).
      const stagedJson = path.join(stagingDir, "doc-detective-results.json");
      fs.copyFileSync(outputPath, stagedJson);
      artifactFiles.push(stagedJson);

      // Markdown summary, derived from the JSON.
      const markdown = renderMarkdownSummary(results);
      const stagedMarkdown = path.join(stagingDir, "doc-detective-summary.md");
      fs.writeFileSync(stagedMarkdown, markdown);
      artifactFiles.push(stagedMarkdown);
      await writeJobSummary(markdown);

      // HTML report, if Doc Detective produced one (4.10.0+). The path comes
      // from parsing stdout, which reflects the specs/content under test, so
      // confine it to the runner temp root (the same root passed to
      // `--output`) before treating it as trustworthy — otherwise a crafted
      // log line from an untrusted repo could smuggle an arbitrary
      // runner-filesystem path into the uploaded artifact.
      const htmlPath = parseHtmlReportPath(commandOutputData);
      const confinedHtmlPath = htmlPath
        ? confineToRoot(htmlPath, path.resolve(process.env.RUNNER_TEMP || os.tmpdir()))
        : undefined;
      if (confinedHtmlPath) {
        const stagedHtml = path.join(stagingDir, path.basename(confinedHtmlPath));
        fs.copyFileSync(confinedHtmlPath, stagedHtml);
        artifactFiles.push(stagedHtml);
      } else if (htmlPath) {
        // Doc Detective announced a report path, but it wasn't found or
        // doesn't resolve inside the runner temp root — unexpected, so
        // surface it (without treating it as trustworthy).
        core.warning(
          `Doc Detective reported an HTML report at ${htmlPath}, but it wasn't found under the runner temp directory; the artifact will omit it.`
        );
      } else {
        // No HTML report announced at all (older Doc Detective, or the HTML
        // reporter disabled). This is the common case, so keep it quiet.
        core.debug("No HTML report was reported; the artifact will omit it.");
      }

      await uploadReportArtifact(
        reportArtifactName("doc-detective-report"),
        artifactFiles,
        stagingDir
      );
    } catch (error) {
      core.warning(`Failed to attach reports to the run: ${errorMessage(error)}`);
    }

    // Create a pull request if there are changed files
    if (core.getInput("create_pr_on_change") == "true") {
      core.info("Checking for changed files.");
      // Check if git is available
      let hasGit = false;
      try {
        const gitVersionCheck = execSync("git --version");
        if (gitVersionCheck.toString()) hasGit = true;
      } catch {
        core.warning("Git isn't available. Skipping change checking.");
      }

      if (hasGit) {
        let changedFiles = false;
        let status = "";

        // Check if there are changed files
        try {
          const statusResponse = execSync("git status");
          status = statusResponse.toString();
          if (!status.includes("working tree clean")) changedFiles = true;
          if (status.includes("not a git repository")) {
            core.warning(
              `${process.cwd()} isn't a git repository. Skipping change checking.`
            );
          }
        } catch (error) {
          core.warning(`Error checking for changed files: ${(error as Error).message}`);
        }

        if (changedFiles) {
          core.info("Changed files found.");
          core.info(`Git status: ${status}`);

          // Create a pull request if there are changed files
          try {
            const pr = await createPullRequest();
            core.setOutput("pull_request_url", pr.data.html_url);
            core.info(`Pull Request: ${JSON.stringify(pr)}`);
          } catch (error) {
            core.error(`Error creating pull request: ${(error as Error).message}`);
          }
        }
      }
    }

    // Create an issue if there are failing tests
    if (results?.summary?.specs?.fail > 0) {
      if (core.getInput("create_issue_on_fail") == "true") {
        // Create an issue if there are failing tests
        try {
          const issue = await createIssue(JSON.stringify(results, null, 2));
          core.setOutput("issue_url", issue.data.html_url);
          core.info(`Issue: ${JSON.stringify(issue)}`);
        } catch (error) {
          core.error(`Error creating issue: ${(error as Error).message}`);
        }
      }
      if (core.getInput("exit_on_fail") == "true") {
        // Fail the action if there are failing tests
        core.setFailed("Doc Detective found failing tests.");
      }
    }
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

async function createIssue(results: string) {
  const token = core.getInput("token");
  const title = core.getInput("issue_title");
  const prompt = core.getInput("prompt");
  const integrations = parseIntegrations(core.getInput("integrations"));
  const integrationsAccordion = buildIntegrationsAccordion(integrations, prompt);
  const body = core
    .getInput("issue_body")
    .replaceAll("$RUN_URL", runURL)
    .replaceAll("$RESULTS", `\n\n\`\`\`json\n${results}\n\`\`\``)
    .replaceAll("$PROMPT", prompt)
    + integrationsAccordion;
  const labelsList = core.getInput("issue_labels").split(",").map((s) => s.trim()).filter(Boolean);
  const assigneesList = core.getInput("issue_assignees").split(",").map((s) => s.trim()).filter(Boolean);
  if (integrations.includes("copilot") && !assigneesList.includes("copilot-swe-agent")) {
    assigneesList.push("copilot-swe-agent");
  }

  const octokit = github.getOctokit(token);

  // Try creating the issue; if assignees cause a 422, retry without them
  let issue;
  try {
    issue = await octokit.rest.issues.create({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      title,
      body,
      labels: labelsList,
      assignees: assigneesList,
    });
  } catch (error) {
    if ((error as { status?: number }).status === 422) {
      core.warning(`Issue creation failed with assignees (${assigneesList.join(", ")}). Retrying without assignees.`);
      issue = await octokit.rest.issues.create({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        title,
        body,
        labels: labelsList,
      });
    } else {
      throw error;
    }
  }

  core.info(`Issue created: ${issue.data.html_url}`);
  core.setOutput("issueUrl", issue.data.html_url);
  return issue;
}

async function createPullRequest() {
  const token = core.getInput("token");
  const title = core.getInput("pr_title");
  const body = core.getInput("pr_body").replace("$RUN_URL", runURL);
  const labels = core.getInput("pr_labels");
  const reviewers = core.getInput("pr_reviewers");
  const assignees = core.getInput("pr_assignees");
  const base = execSync("git rev-parse --abbrev-ref HEAD")
    .toString()
    .replace("\n", "");
  const head = core.getInput("pr_branch") || `doc-detective-${Date.now()}`;

  const octokit = github.getOctokit(token);

  // Infer user email and name
  const userName = process.env.GITHUB_ACTOR;
  const userEmail = `${userName}@users.noreply.github.com`;

  // Configure git with user email and name
  await exec(`git config --global user.email "${userEmail}"`);
  await exec(`git config --global user.name "${userName}"`);

  // Create new branch
  core.info(`Creating branch: ${head}`);
  await exec(`git checkout -b ${head}`);

  // Commit changes
  await exec("git add .");
  await exec(`git commit -m "Doc Detective results"`);
  await exec(`git push origin ${head}`);

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
