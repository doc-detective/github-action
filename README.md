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
      - uses: doc-detective/github-action@v2
```

The action outputs the results of the command as a JSON-formatted string that you can use this in subsequent steps in the same job. See [`results`](#results).

**Note:** On Ubuntu, this action only supports headless mode. Firefox and Chrome contexts automatically fall back to headless mode when necessary. If your tests doesn't work in headless mode (like if you need the 'startRecording' action), use macOS or Windows.

## Upgrade from v1

`@v2` runs Doc Detective 5. It makes these breaking changes:

- `exit_on_fail` defaults to `true`, so a failing test now fails the job. Set it to `false` to keep the old behavior.
- `version` defaults to `5`.
- The `ios` input is gone. See [Speed up iOS tests](#speed-up-ios-tests).
- The undocumented `issueUrl` output is gone. Use [`issue_url`](#issue_url).
- CLI 2's `runTests` subcommand is no longer added for `2.x` versions.

## Inputs

You can customize the action with the following optional inputs.

To add an input, edit your workflow file to include the `with` key to the `uses` block. For example:

```yaml
- uses: doc-detective/github-action@v2
  with:
    version: 5
```

### `version` (default: `5`)

Specify the version of Doc Detective to use. This can be a specific version number, range, or NPM tag.

`@v2` of this action expects Doc Detective 5, which exits non-zero when a test fails. If you set an older version, a failing test exits 0, so the job stays green and the action logs a warning. Use `doc-detective/github-action@v1` for Doc Detective 4.

Set `version` to an empty string (`""`) to run whatever `doc-detective` already resolves in the working directory, such as a local build exposed with `npm link`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    version: 5.0.0
```

### `working_directory` (default: Repository root)

The working directory for the action, relative to the root of the repository. This is where the action looks for the configuration file and where it runs the command.

```yaml
- uses: doc-detective/github-action@v2
  with:
    working_directory: path/to/your/directory
```

### `config`

The path to the configuration file.

```yaml
- uses: doc-detective/github-action@v2
  with:
    config: path/to/your/config.json
```

### `input`

Path to the input file or directory. Overrides the "input" field in the config file.

```yaml
- uses: doc-detective/github-action@v2
  with:
    input: path/to/your/tests
```

### `android` (default: `auto`)

Enable Android emulator support on Linux runners by granting KVM access (the emulator needs hardware acceleration). `auto` scans your specs and only sets up KVM when an `android` platform is present; `true` always sets it up; `false` never does. No effect on macOS/Windows runners. Doc Detective bootstraps the SDK, emulator, system image, AVD, and driver itself at test time.

```yaml
- uses: doc-detective/github-action@v2
  with:
    android: auto
```

### Speed up iOS tests

Doc Detective prebuilds and manages the WebDriverAgent (WDA) build itself. For fast iOS runs, persist the Doc Detective cache and prebuild before the action:

```yaml
jobs:
  runTests:
    runs-on: macos-latest
    env:
      DOC_DETECTIVE_CACHE_DIR: ${{ github.workspace }}/.dd-cache
    steps:
      - uses: actions/checkout@v4
      # Rotating key + restore-keys: an exact cache hit never re-uploads, so a
      # static key would strand WDA products built for a NEW Xcode/driver
      # toolchain. The run-scoped key always saves; restore-keys pulls the
      # newest previous entry.
      - uses: actions/cache@v4
        with:
          path: .dd-cache
          key: dd-cache-${{ runner.os }}-${{ github.run_id }}
          restore-keys: |
            dd-cache-${{ runner.os }}-
      - run: npx doc-detective install ios --yes
      - uses: doc-detective/github-action@v2
```

Without the prebuild, iOS tests still work — the first XCUITest session builds WebDriverAgent in-session (~10 min on a cold runner). The managed prebuild requires Doc Detective v4.28 or later.

### `create_pr_on_change` (default: `false`)

Create a pull request if any files in the repo change, such as if screenshots or command results get updated. Commits, branches, and pull requests are created with the credentials of the workflow run that triggered the action.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
```

You need to manually allow GitHub Actions to create pull requests for your repo. From your repository, go to **Settings** > **Actions** > **General** and select **Allow GitHub Actions to create and approve pull requests**. Despite the setting name, Doc Detective will never approve pull requests. If your repo belongs to an organization, an organization owner must allow this setting.

This input also requires the workflow or job to have `write` access for the`contents` scope to create a branch and `write` access for the `pull-requests` scope to create a pull request. You can set the necessary permissions in the workflow file like this:

```yaml
name: doc-detective
on:
  schedule:
    - cron: '0 0 * * *'

jobs:
  runTests:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
      - uses: doc-detective/github-action@v2
        with:
          create_pr_on_change: true
```

### `pr_branch` (default: `doc-detective-{DATE}`)

The name of the branch to create for the pull request. Only valid if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_branch: doc-detective-changes
```

### `pr_title` (default: `Doc Detective Changes`)

The title of the created pull request. Only valid if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_title: Doc Detective found changes
```

### `pr_body` (default: See example)

The body of the created pull request. `$RUN_URL` inserts the URL of the workflow run that created the pull request. Only valid if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_body: |
      A Doc Detective run ($RUN_URL) updated files.
~~~~
      DISCLAIMER: This pull request doesn't reflect whether Doc Detective tests passed for failed, only that files in the repository changed. Review the changes to make sure they're accurate.
```

### `pr_labels` (default: `doc-detective`)

Comma-separated list of labels to apply to the pull request. Only valid if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_labels: doc-detective,for-review
```

### `pr_assignees`

Comma-separated list of GitHub usernames to assign to the pull request. Only valid if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_assignees: octocat,monalisa
```

### `pr_reviewers`

Comma-separated list of GitHub usernames to request a review from. Only valid if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_reviewers: octocat,monalisa
```

### `exit_on_fail` (default: `true`)

Fail the job if one or more tests fails. Set it to `false` to keep the job green when a test fails.

| Doc Detective exit code | Meaning | Job |
|---|---|---|
| `0` | Tests passed | Passes |
| `1` | A spec failed | Fails, unless `exit_on_fail` is `false` |
| `2` | Nothing valid was tested, or Doc Detective couldn't proceed | Always fails |

Any other exit code, or a run that doesn't write a results file, also fails the job. The results output, issue, and pull request steps run first whenever Doc Detective writes results.

If your config sets `exitOnFail: false`, Doc Detective exits `0` when a test fails. The job stays green, and the action logs a warning.
```yaml
- uses: doc-detective/github-action@v2
  with:
    exit_on_fail: false
```

### `create_issue_on_fail` (default: `false`)

Create a GitHub issue if one or more tests fails.

```yaml
- uses: doc-detective/github-action@v2
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
      - uses: doc-detective/github-action@v2
        with:
          create_issue_on_fail: true
```

### `issue_title` (default: `Doc Detective Failure`)

The title of the created GitHub issue. Only valid if `create_issue_on_fail` is set to `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_issue_on_fail: true
    issue_title: Doc Detective found issues in the documentation
```

### `issue_body` (default: `Doc Detective run failed with the following results:$RESULTS`)

The body of the created GitHub issue. Use the `$RESULTS` variable to insert the results object. Only valid if `create_issue_on_fail` is set to `true`.

GitHub limits issue bodies to 65,536 characters. If the body would be longer, `$RESULTS` gets cut to fit, and a note links to the workflow run.

```yaml
- uses: doc-detective/github-action@v2
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
- uses: doc-detective/github-action@v2
  with:
    create_issue_on_fail: true
    issue_labels: doc-detective,documentation
```

### `issue_assignees`

Comma-separated list of GitHub usernames to assign to the GitHub issue. Only valid if `create_issue_on_fail` is set to `true`.
  
```yaml
- uses: doc-detective/github-action@v2
  with:
    create_issue_on_fail: true
    issue_assignees: octocat,monalisa
```

### `token` (default: `${{ github.token }}`)

The GitHub token to use for creating issues. Defaults to the token already available to the GitHub Action workflow. Only set this if you want to override the default token.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_issue_on_fail: true
    token: ${{ secrets.MY_GITHUB_TOKEN }}
```

## Run files

The action writes the results file and Doc Detective's run folder (`.doc-detective/runs`) to the runner's temp directory (`RUNNER_TEMP`), so they stay out of your repository and out of `create_pr_on_change` pull requests. This overrides any `outputDir` in your config, and reports from reporters such as `junit` and `markdown` go there too. To keep those files, upload them from `${{ runner.temp }}` in a later step.

The action passes `--output-dir` to do this, and leaves it out when `version` stays below 5, because Doc Detective 4 rejects the flag. An empty `version` always gets it, so a locally linked CLI needs to be version 5 or later.

## Outputs

The action sets the following outputs:

### `results`

JSON-formatted results of the command. This can be used in subsequent steps in the same job.

```yaml
- uses: doc-detective/github-action@v2
  id: doc-detective
- run: echo "${{ steps.doc-detective.outputs.results }}"
```

### `pull_request_url`

URL of the created pull request. Only set if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  id: doc-detective
  with:
    create_pr_on_change: true
- run: echo "${{ steps.doc-detective.outputs.pull_request_url }}"
```

### `issue_url`

URL of the created GitHub issue. Only set if `create_issue_on_fail` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  id: doc-detective
  with:
    create_issue_on_fail: true
- run: echo "${{ steps.doc-detective.outputs.issue_url }}"
```