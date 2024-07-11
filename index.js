const core = require("@actions/core");
const { exec } = require("@actions/exec");
const github = require("@actions/github");

process.env["DOC_DETECTIVE_META"] = JSON.stringify({dist_interface: "github-actions"});
main();

async function main() {
  try {
    // Get the inputs
    // DEBUG
    // const version = core.getInput("version");
    const version = "dev";
    // END DEBUG
    const dd = `doc-detective@${version}`;
    const command = core.getInput("command");
    const config = core.getInput("config");
    const input = core.getInput("input");

    // Compile command
    let compiledCommand = `npx ${dd} ${command}`;
    if (config) compiledCommand += ` --config ${config}`;
    if (input) compiledCommand += ` --input ${input}`;
    compiledCommand += ` --output /tmp/doc-detective-output.json`;

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
    const outputFiles = commandOutputData.split("See results at ");
    const outputFile = outputFiles[outputFiles.length - 1].trim();
    // If output file is not found, throw an error 
    if (!outputFile) {
      throw new Error(`Output file not found.\nOutput file: ${outputFile}\nCWD: ${process.cwd()}\nstdout: ${coverateResults.stdout}`);
    }
    const results = require(outputFile);

    // Set outputs
    core.setOutput("results", results);
  } catch (error) {
    core.setFailed(error.message);
  }
}