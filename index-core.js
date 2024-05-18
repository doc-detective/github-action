#!/usr/bin/env node

const { runTests, runCoverage } = require("doc-detective-core");
const { setArgs, setConfig, outputResults, setMeta } = require("./utils");
const { argv } = require("node:process");
const path = require("path");
const fs = require("fs");

// Run
setMeta();
main(argv);

// Run
async function main(argv) {
  // Find index of `doc-detective` or `run` in argv
  const index = argv.findIndex(
    (arg) => arg.endsWith("doc-detective") || arg.endsWith("index.js")
  );
  // `command` is the next argument after `doc-detective` or `src/index.js`
  let command = argv[index + 1];
  // Set args
  argv = setArgs(argv);
  // Get .doc-detective.json config, if it exists
  const configPath = path.resolve(process.cwd(), ".doc-detective.json");
  let config = {};
  if (fs.existsSync(configPath)) {
    config = require(configPath);
  }
  // Set config
  config = setConfig(config, argv);
  command = command || config.defaultCommand;
  }

  // Run command
  let results = {};
  let outputDir;
  let outputReportType;
  if (command === "runCoverage") {
    outputDir = config?.runCoverage?.output || config.output;
    outputReportType = "coverageResults";
    results = await runCoverage(config);
  } else if (command === "runTests") {
    outputDir = config?.runTests?.output || config.output;
    outputReportType = "testResults";
    results = await runTests(config);
  } else {
    console.error(`Sorry, that's not a recognized command. Please try again.`);
    process.exit(1);
  }
  // Output results
  const outputPath = path.resolve(
    outputDir,
    `${outputReportType}-${Date.now()}.json`
  );
  await outputResults(config, outputPath, results);

try {
    const version = core.getInput('version');
    const dd = `doc-detective@${version}`;
    const command = core.getInput('command');
    const config = core.getInput('config');
    const input = core.getInput('input');
    const output = core.getInput('output');

    let compiledCommand = `npx doc-detective ${command}`;
    if (config) {
        compiledCommand += ` --config ${config}`;
    }
    if (input) {
        compiledCommand += ` --input ${input}`;
    }
    if (output) {
        compiledCommand += ` --output ${output}`;
    }

    // Install Doc Detective
    core.info(`Installing Doc Detective: npm install -g ${dd}`);
    const installOutput = execSync(`npm install -g ${dd}`, { encoding: 'utf-8' });

    // Run Doc Detective
    core.info(`Running Doc Detective: ${compiledCommand}`);
    const commandOutput = execSync(compiledCommand, { encoding: 'utf-8' });

    // Set outputs
    core.setOutput('results', commandOutput);

} catch (error) {
    core.setFailed(error.message);
}
