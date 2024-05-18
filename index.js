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
    core.info(`Installing Doc Detective: npm install ${dd}`);
    const installOutput = execSync(`npm install ${dd}`, { encoding: 'utf-8' });

    // Run Doc Detective
    core.info(`Running Doc Detective: ${compiledCommand}`);
    const commandOutput = execSync(compiledCommand, { encoding: 'utf-8', stdio: 'inherit'});

    // Set outputs
    core.setOutput('results', commandOutput);

} catch (error) {
    core.setFailed(error.message);
}
