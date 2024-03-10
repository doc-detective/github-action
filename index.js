const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');

try {
    const version = core.getInput('version');
    const dd = `doc-detective@${version}`;
    const command = core.getInput('command');
    const config = core.getInput('config');
    const input = core.getInput('input');
    const output = core.getInput('output');

    let compiledCommand = `${dd} ${command}`;
    if (config) {
        compiledCommand += ` --config ${config}`;
    }
    if (input) {
        compiledCommand += ` --input ${input}`;
    }
    if (output) {
        compiledCommand += ` --output ${output}`;
    }

    // Run Doc Detective
    core.info(`Running Doc Detective with command: ${compiledCommand}`);
    execSync(`npx ${dd}`, { stdio: 'inherit' });

    // Your logic here, using your globally installable NPM package
    core.setOutput('results', '');
} catch (error) {
    core.setFailed(error.message);
}
