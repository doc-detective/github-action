const core = require("@actions/core");
const { exec } = require("@actions/exec");
const github = require("@actions/github");

process.env["DOC_DETECTIVE_META"] = JSON.stringify({dist_interface: "github-actions"});
main();

async function main() {
  try {
    // Get the inputs
    const version = core.getInput("version");
    const dd = `doc-detective@${version}`;
    const command = core.getInput("command");
    const config = core.getInput("config");
    const input = core.getInput("input");
    const output = core.getInput("output");

    // Compile command
    let compiledCommand = `npx ${dd} ${command}`;
    if (config) compiledCommand += ` --config ${config}`;
    if (input) compiledCommand += ` --input ${input}`;
    if (output) compiledCommand += ` --output ${output}`;

    // Run Doc Detective
    core.info(`Running Doc Detective: ${compiledCommand}`);
    let commandOutputData = "";
    const options = {};   // Full options: https://github.com/actions/toolkit/blob/d9347d4ab99fd507c0b9104b2cf79fb44fcc827d/packages/exec/src/interfaces.ts#L5
    options.listeners = {
      stdout: (data) => {
        core.info(data.toString());
        commandOutputData += data.toString();
      },
    };
    await exec(compiledCommand, [], options);
    // Capture content between RESULTS and the next blank line
    const resultsStart = commandOutputData.indexOf("{\n  \"summary");
    const resultsEnd = commandOutputData.indexOf("\n\n", resultsStart);
    const resultsString = commandOutputData.substring(resultsStart, resultsEnd).trim();
    const results = JSON.parse(resultsString);

    // Set outputs
    core.setOutput("results", results);
  } catch (error) {
    core.setFailed(error.message);
  }
}