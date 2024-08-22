const core = require("@actions/core");
const { exec } = require("@actions/exec");
const github = require("@actions/github");
const os = require("os");
const path = require("path");

const meta = { dist_interface: "github-actions" };
process.env["DOC_DETECTIVE_META"] = JSON.stringify(meta);

const repoOwner = github.context.repo.owner;
const repoName = github.context.repo.repo;
const runId = process.env.GITHUB_RUN_ID;

const runURL = `https://github.com/${repoOwner}/${repoName}/actions/runs/${runId}`;

main();

async function main() {
  try {
    // Post warning if running on Linux
    if (os.platform() === "linux") {
      core.warning(
        "On Ubuntu runners, this action only supports headless mode. Firefox and Chrome contexts automatically fall back to headless mode when necessary. If your tests doesn't work in headless mode (like if you need the 'startRecording' action), use macOS or Windows runners."
      );
    }

    // Get the inputs
    const version = core.getInput("version");
    const dd = `doc-detective@${version}`;
    const command = core.getInput("command");
    const config = core.getInput("config");
    const input = core.getInput("input");

    // Compile command
    let compiledCommand = `npx ${dd} ${command}`;
    if (config) compiledCommand += ` --config ${config}`;
    if (input) compiledCommand += ` --input ${input}`;
    const outputPath = path.resolve(
      process.env.RUNNER_TEMP,
      "doc-detective-output.json"
    );
    compiledCommand += ` --output ${outputPath}`;

    // Run Doc Detective
    core.info(`Running Doc Detective: ${compiledCommand}`);
    let commandOutputData = "";
    const options = {}; // Full options: https://github.com/actions/toolkit/blob/d9347d4ab99fd507c0b9104b2cf79fb44fcc827d/packages/exec/src/interfaces.ts#L5
    options.listeners = {
      stdout: (data) => {
        commandOutputData += data.toString();
      },
    };
    await exec(compiledCommand, [], options);
    const outputFiles = commandOutputData.split("See results at ");
    const outputFile = outputFiles[outputFiles.length - 1].trim();
    // If output file is not found, throw an error
    if (!outputFile) {
      throw new Error(
        `Output file not found.\nOutput file: ${outputFile}\nCWD: ${process.cwd()}\nstdout: ${
          coverateResults.stdout
        }`
      );
    }

    // Set outputs
    const results = require(outputFile);
    core.setOutput("results", results);


    // Check if there are new or changed files with git
    let changedFiles = [];
    try {
      const diff = await exec("git diff --name-only");
      changedFiles = diff.split("\n").filter((f) => f);
    } catch (error) {
      core.warning("Error getting changed files with git: " + error.message);
    }
    core.setOutput("changedFiles", changedFiles);
    if (changedFiles.length > 0) {
      if (core.getInput("create_pr_on_change") == "true") {
        // Create a pull request if there are changed files
        try {
          const pr = await createPullRequest(JSON.stringify(changedFiles, null, 2));
          core.info(`Pull Request: ${JSON.stringify(pr)}`);
        } catch (error) {
          core.error(`Error creating pull request: ${error.message}`);
        }
      }
    }

    // Create an issue if there are failing tests
    if (command === "runTests" && results.summary.specs.fail > 0) {
      if (core.getInput("create_issue_on_fail") == "true") {
        // Create an issue if there are failing tests
        try {
          const issue = await createIssue(JSON.stringify(results, null, 2));
          core.info(`Issue: ${JSON.stringify(issue)}`);
        } catch (error) {
          core.error(`Error creating issue: ${error.message}`);
        }
      }
      if (core.getInput("exit_on_fail") == "true") {
        // Fail the action if there are failing tests
        core.setFailed("Doc Detective found failing tests.");
      }
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function createIssue(results) {
  const token = core.getInput("token");
  const title = core.getInput("issue_title");
  const body = core
    .getInput("issue_body")
    .replace("$RUN_URL", runURL)
    .replace("$RESULTS", `\n\n\`\`\`json\n${results}\n\`\`\``);
  const labels = core.getInput("issue_labels");
  const assignees = core.getInput("issue_assignees");

  const octokit = github.getOctokit(token);

  const issue = await octokit.rest.issues.create({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    title,
    body,
    labels: labels.split(","),
    assignees: assignees.split(","),
  });

  core.info(`Issue created: ${issue.data.html_url}`);
  core.setOutput("issueUrl", issue.data.html_url);
  return issue;
}

async function createPullRequest(changedFiles){
  const token = core.getInput("token");
  const title = core.getInput("pr_title");
  const body = core
    .getInput("pr_body")
    .replace("$RUN_URL", runURL)
    .replace("$CHANGED_FILES", `\n\n\`\`\`json\n${changedFiles}\n\`\`\``);
  const labels = core.getInput("pr_labels");
  const assignees = core.getInput("pr_assignees");
  const base = await exec("git rev-parse --abbrev-ref HEAD");
  const head = core.getInput("pr_branch") || `doc-detective-${Date.now()}`;

  const octokit = github.getOctokit(token);

  // Create new branch
  await exec(`git checkout -b ${head}`);

  // Commit changes
  await exec("git add .");
  await exec("git commit -m 'Doc Detective results'");
  await exec(`git push origin ${head}`);

  // Create pull request
  const pr = await octokit.rest.pulls.create({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    title,
    body,
    head,
    base,
    labels: labels.split(","),
    assignees: assignees.split(","),
  });

}