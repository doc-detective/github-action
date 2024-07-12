const core = require("@actions/core");
const { exec } = require("@actions/exec");
const github = require("@actions/github");
const axios = require("axios");

const meta = { dist_interface: "github-actions" };
process.env["DOC_DETECTIVE_META"] = JSON.stringify(meta);
main();

async function createIssue(results) {
  const token = core.getInput("token");
  const title = "Failure in Doc Detective run";
  const body = `Doc Detective run failed with the following results:\n${results}`;
  const labels = "doc-detective";
  const assignees = "";

  const issueUrl = `https://api.github.com/repos/${github.context.repo.owner}/${github.context.repo.repo}/issues`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const data = {
    title,
    body,
    labels: labels.split(","),
    assignees: assignees.split(","),
  };

  try {
    const response = await axios.post(issueUrl, data, { headers });
    const issue = response.data;
    core.info(`Issue created: ${issue.html_url}`);
    core.setOutput("issueUrl", issue.html_url);
    return issue;
  } catch (error) {
    core.error(`Error creating issue: ${error.message}`);
    throw error;
  }
};

async function main() {
  // try {
  //   // Get the inputs
  //   const version = core.getInput("version");
  //   const dd = `doc-detective@${version}`;
  //   const command = core.getInput("command");
  //   const config = core.getInput("config");
  //   const input = core.getInput("input");

  //   // Compile command
  //   let compiledCommand = `npx ${dd} ${command}`;
  //   if (config) compiledCommand += ` --config ${config}`;
  //   if (input) compiledCommand += ` --input ${input}`;
  //   compiledCommand += ` --output /tmp/doc-detective-output.json`;

  //   // Run Doc Detective
  //   core.info(`Running Doc Detective: ${compiledCommand}`);
  //   let commandOutputData = "";
  //   const options = {}; // Full options: https://github.com/actions/toolkit/blob/d9347d4ab99fd507c0b9104b2cf79fb44fcc827d/packages/exec/src/interfaces.ts#L5
  //   options.listeners = {
  //     stdout: (data) => {
  //       commandOutputData += data.toString();
  //     },
  //   };
  //   await exec(compiledCommand, [], options);
  //   const outputFiles = commandOutputData.split("See results at ");
  //   const outputFile = outputFiles[outputFiles.length - 1].trim();
  //   // If output file is not found, throw an error
  //   if (!outputFile) {
  //     throw new Error(
  //       `Output file not found.\nOutput file: ${outputFile}\nCWD: ${process.cwd()}\nstdout: ${
  //         coverateResults.stdout
  //       }`
  //     );
  //   }

  //   // Set outputs
  //   const results = require(outputFile);
  //   core.setOutput("results", results);

  //   if (command === "runTests" && results.summary.specs.fail > 0) {
  //     if (core.getInput("createIssueOnFail") == "true") {
  //       // Create an issue if there are failing tests
        try {
          const issue = await createIssue(results);
          core.info(`Issue: ${JSON.stringify(issue)}`);
        } catch (error) {
          core.error(`Error creating issue: ${error.message}`);
        }
  //     }
  //     if (core.getInput("exitOnFail") == "true") {
  //       // Fail the action if there are failing tests
  //       core.setFailed("Doc Detective found failing tests.");
  //     }
  //   }
  // } catch (error) {
  //   core.setFailed(error.message);
  // }
}
