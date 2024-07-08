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
      stderr: (data) => {
        // core.info(data.toString());
        commandOutputData += data.toString();
      },
    };
    const commandOutput = await exec(compiledCommand, [], options);
    console.log("Command output:"); 
    console.log(commandOutput);
    console.log("\nCommand output data:");
    console.log(commandOutputData);

    // Set outputs
    core.setOutput("results", commandOutputData);
  } catch (error) {
    core.setFailed(error.message);
  }
}