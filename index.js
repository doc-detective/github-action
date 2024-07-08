const core = require("@actions/core");
const { exec } = require("@actions/exec");
const github = require("@actions/github");

try {
  // Get the inputs
  const version = core.getInput("version");
  const dd = `doc-detective@${version}`;
  const command = core.getInput("command");
  const config = core.getInput("config");
  const input = core.getInput("input");
  const output = core.getInput("output");

  // Install command
  let installCommand = `npm install --global ${dd}`;

  // Compile command
  let compiledCommand = `npx doc-detective ${command}`;
  if (config) compiledCommand += ` --config ${config}`;
  if (input) compiledCommand += ` --input ${input}`;
  if (output) compiledCommand += ` --output ${output}`;

  // Install Doc Detective
  //   core.info(`Installing Doc Detective: ${installCommand}`);
  //   const installOutput = exec(installCommand);
  //   installOutput.catch((error) => {
  //     core.setFailed(`Failed to install Doc Detective: ${error.message}`);
  //   });
  //   installOutput.then(() => {
  //     core.info(`Doc Detective installed successfully`);
  //   });

  // Run Doc Detective
  core.info(`Running Doc Detective: ${compiledCommand}`);
  let commandOutputData = "";
  const options = {};   // Full options: https://github.com/actions/toolkit/blob/d9347d4ab99fd507c0b9104b2cf79fb44fcc827d/packages/exec/src/interfaces.ts#L5
  options.listeners = {
    stdout: (data: Buffer) => {
      commandOutputData += data.toString();
    },
    stderr: (data: Buffer) => {
      commandOutputData += data.toString();
    },
  };
  const commandOutput = exec(compiledCommand, options);

  // Set outputs
  core.setOutput("results", commandOutputData);
} catch (error) {
  core.setFailed(error.message);
}
