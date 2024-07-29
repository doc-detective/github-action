# Doc Detective as a GitHub Action

:octocat: The official GitHub Action for [Doc Detective](https://github.com/doc-detective/doc-detective). Keep your docs accurate with ease.

## Usage

Create a YAML file in your `.github/workflows` directory with the following content:

```yaml
name: doc-detective
on: [pull_request]

jobs:
  runTests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: doc-detective/github-action@v1
```

The action outputs the results of the command as a JSON-formatted string that you can use this in subsequent steps in the same job. See [`results`](#results).

**Note:** On Ubuntu, this action only supports headless mode. Firefox and Chrome contexts automatically fall back to headless mode when necessary. If your tests doesn't work in headless mode (like if you need the 'startRecording' action), use macOS or Windows.

## File structure

This action runs in the current working directory of the workflow. If you want to change the directory, you can do so by adding a `working-directory` key to the `github-action` step:

```yaml
- uses: doc-detective/github-action@v1
  working-directory: path/to/your/directory
```

Just like the main project, this action looks for a `.doc-detective.json` file in the current directory for the configuration if it isn't specified in the `config` input.

All paths are relative to the current working directory.

## Inputs

You can customize the action with the following optional inputs:

To add an input, edit your workflow file to include the `with` key to the `uses` block. For example:

```yaml
- uses: doc-detective/github-action@v1
  with:
    version: latest
```

### `version` (default: latest)

Specify the version of Doc Detective to use. This can be a specific version number or an NPM tag (like `latest`).

```yaml
- uses: doc-detective/github-action@v1
  with:
    version: 2.15.0
```

### `command` (default: `runTests`)

The command to run. Valid values are "runTests" and "runCoverage".

```yaml
- uses: doc-detective/github-action@v1
  with:
    command: runCoverage
```

### `config`

The path to the configuration file.

```yaml
- uses: doc-detective/github-action@v1
  with:
    config: path/to/your/config.json
```

### `input`

Path to the input file or directory. Overrides the "input" field in the config file.

```yaml
- uses: doc-detective/github-action@v1
  with:
    input: path/to/your/tests
```

### `exit_on_fail` (default: `false`)

Exit with a non-zero code if one or more tests fails. Only valid if `command` is "runTests".

```yaml
- uses: doc-detective/github-action@v1
  with:
    exit_on_fail: true
```

### `create_issue_on_fail` (default: `false`)

Create a GitHub issue if one or more tests fails. Only valid if `command` is "runTests".

```yaml
- uses: doc-detective/github-action@v1
  with:
    create_issue_on_fail: true
```

This input requires the workflow or job to have `write` access for the `issues` scope. You can set the necessary permissions in the workflow file like this:

```yaml
name: doc-detective
on: [pull_request]

jobs:
  runTests:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: doc-detective/github-action@v1
        with:
          create_issue_on_fail: true
```

### `issue_title` (default: `Doc Detective Failure`)

The title of the created GitHub issue. Only valid if `create_issue_on_fail` is set to `true`.

```yaml
- uses: doc-detective/github-action@v1
  with:
    create_issue_on_fail: true
    issue_title: Doc Detective found issues in the documentation
```

### `issue_body` (default: `Doc Detective run failed with the following results:$RESULTS`)

he body of the created GitHub issue. Use the `$RESULTS` variable to insert the results object. Only valid if `create_issue_on_fail` is set to `true`.

```yaml
- uses: doc-detective/github-action@v1
  with:
    create_issue_on_fail: true
    issue_body: |
      Doc Detective found issues in the documentation. Review and fix the issues.

      Results:
      $RESULTS
```

### `issue_labels` (default: `doc-detective`)

Comma-separated list of labels to apply to the GitHub issue. Only valid if `create_issue_on_fail` is set to `true`.

```yaml
- uses: doc-detective/github-action@v1
  with:
    create_issue_on_fail: true
    issue_labels: doc-detective,documentation
```

### `issue_assignees`

Comma-separated list of GitHub usernames to assign to the GitHub issue. Only valid if `create_issue_on_fail` is set to `true`.
  
```yaml
- uses: doc-detective/github-action@v1
  with:
    create_issue_on_fail: true
    issue_assignees: octocat,monalisa
```

### `token` (default: `${{ github.token }}`)

The GitHub token to use for creating issues. Defaults to the token already available to the GitHub Action workflow. Only set this if you want to override the default token.

```yaml
- uses: doc-detective/github-action@v1
  with:
    create_issue_on_fail: true
    token: ${{ secrets.MY_GITHUB_TOKEN }}
```

## Outputs

The action sets the following outputs:

### `results`

JSON-formatted results of the command. This can be used in subsequent steps in the same job.

```yaml
- uses: doc-detective/github-action@v1
  id: doc-detective
- run: echo "${{ steps.doc-detective.outputs.results }}"
```
