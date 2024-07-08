#!/usr/bin/env node

const { runTests, runCoverage } = require("doc-detective-core");
const { setArgs, setConfig, setMeta } = require("./utils");
const { argv } = require("node:process");
const core = require("@actions/core");
const path = require("path");
const fs = require("fs");

// Run
setMeta();
  // Get the inputs
  const dd = `doc-detective@${version}`;
  const command = core.getInput("command");
  const config = core.getInput("config");
  const input = core.getInput("input");
  const output = core.getInput("output");
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

  // Run command
  let results = {};
  if (command === "runCoverage") {
    results = await runCoverage(config);
  } else if (command === "runTests") {
    results = await runTests(config);
  } else {
    core.error(`${command} isn't a recognized command.`);
    process.exit(1);
  }

  // Set outputs
  core.setOutput("results", JSON.stringify(results, null, 2));

}
