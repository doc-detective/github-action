const core = require("@actions/core");
const {exec} = require("@actions/exec");
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
  const commandOutput = exec(compiledCommand);
//   let commandOutputData = "";
//   commandOutput.stdout.on("data", (data) => {
//     commandOutputData += data.toString();
//     // Monitor stdout here and perform any necessary actions
//     core.info(data.toString());
//   });
//   commandOutput.stderr.on("data", (data) => {
//     // Handle stderr data if needed
//     core.error(data.toString());
//   });
//   commandOutput.on("error", (error) => {
//     // Handle error if needed
//   });
//   commandOutput.on("exit", (code) => {
//     // Handle exit code if needed
//   });

  // Set outputs
  core.setOutput("results", commandOutput);
} catch (error) {
  core.setFailed(error.message);
}
