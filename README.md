# Doc Detective as a GitHub Action

:octocat: The official GitHub Action for [Doc Detective](https://github.com/doc-detective/doc-detective). Keep your docs accurate with ease.

## Usage

Create a YAML file in your `.github/workflows` directory with the following content:

```yaml
name: doc-detective
on: [pull_request]

jobs:
  doc-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: doc-detective/github-action@v2
```

Doc Detective 5 needs Node.js 24.15 or later, and `npx` runs it on the job's Node.js, so set that up with `actions/setup-node`. When `version` is `latest`, or a version or range that can install 5, and the job's Node.js is older, the action logs a warning and runs anyway.

The action outputs the results of the command as a JSON-formatted string that you can use this in subsequent steps in the same job. See [`results`](#results).

**Note:** On Linux runners, Chrome and Firefox contexts run headless when there's no display. Doc Detective records headless Chrome, but not headless Firefox. To run headed or record Firefox, install Xvfb, or use a macOS or Windows runner.

## Upgrade from v1

`@v2` runs Doc Detective 5, which needs Node.js 24.15 or later. Add `actions/setup-node` with `node-version: 24` before the action, as in [Usage](#usage). `@v2` also makes these breaking changes:

- `exit_on_fail` defaults to `true`, so a failing test now fails the job. Set it to `false` to keep the old behavior.
- `version` defaults to `5`.
- The default [`issue_body`](#issue_body) holds the run's Markdown summary (`$SUMMARY`) instead of the results JSON. To keep the JSON, set `issue_body` to `A Doc Detective run ($RUN_URL) failed with the following results:$RESULTS`.
- [`create_issue_on_fail`](#create_issue_on_fail) updates the open issue with the same title and first label instead of opening a new issue on every failing run.
- [`create_pr_on_change`](#create_pr_on_change) force-pushes one branch, `doc-detective-changes` by default, and updates its open pull request instead of opening a new branch and pull request on every run. The pull request targets `GITHUB_BASE_REF`, else `GITHUB_REF_NAME`, instead of the checked-out branch. Its `git` commands run in [`working_directory`](#working_directory).
- Doc Detective's run folder and reports go under the `outputDir` in your config, instead of the runner's temp directory. The action keeps them out of git. See [Run files](#run-files).
- The `ios` input is gone. See [Speed up iOS tests](#speed-up-ios-tests).
- The undocumented `issueUrl` output is gone. Use [`issue_url`](#issue_url).
- `integrations` is renamed [`issue_mentions`](#issue_mentions), and `prompt` is renamed [`issue_prompt`](#issue_prompt). The old names still work and log a deprecation warning. Setting both the old and the new name fails the job.
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

### `working_directory` (default: `.`)

The working directory for the action, relative to the root of the repository. The default, `.`, is the repository root. The action runs Doc Detective and its `git` commands here, and resolves `config` and `input` against it. A directory inside a different checkout, such as a second repository checked out to a subfolder, gets its pull request from that checkout.

```yaml
- uses: doc-detective/github-action@v2
  with:
    working_directory: path/to/your/directory
```

### `config`

The path to the configuration file. Relative to `working_directory`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    config: path/to/your/config.json
```

### `input`

Path to the input file or directory. Overrides the `input` field in the config file. Relative to `working_directory`.

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
  doc-tests:
    runs-on: macos-latest
    env:
      DOC_DETECTIVE_CACHE_DIR: ${{ github.workspace }}/.dd-cache
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
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

Open or update a pull request if any files in the repo change, such as if screenshots or command results get updated. Commits, branches, and pull requests are created with the credentials of the workflow run that triggered the action.

The action commits the changes to [`pr_branch`](#pr_branch) and force-pushes it. If that branch already has an open pull request, the action updates its title and body. Otherwise it opens one, with [`pr_labels`](#pr_labels), [`pr_assignees`](#pr_assignees), and [`pr_reviewers`](#pr_reviewers). Those three apply only when the pull request opens. The pull request targets the base branch of the pull request that triggered the run (`GITHUB_BASE_REF`), or else the branch that triggered it (`GITHUB_REF_NAME`).

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
  doc-tests:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: doc-detective/github-action@v2
        with:
          create_pr_on_change: true
```

### `pr_branch` (default: `doc-detective-changes`)

The branch for the pull request. Each run resets it to the checked-out commit plus that run's changes, and force-pushes it, so one pull request carries the latest changes. Don't commit to this branch by hand, because the next run overwrites it. Only valid if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_branch: docs-screenshots
```

### `pr_paths`

Comma-separated list of paths to commit to the pull request, relative to [`working_directory`](#working_directory). Only changes under these paths open a pull request, and other changes stay out of it. Only valid if `create_pr_on_change` is `true`.

By default, the pull request includes every changed file in the checkout. That includes screenshots Doc Detective captured, which can show unreleased UI or customer data. Review what your tests capture before you turn on `create_pr_on_change`, or set `pr_paths` to the folders you mean to update.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_paths: docs/images,docs/snippets
```

### `pr_title` (default: `Doc Detective Changes`)

The title of the created pull request. Only valid if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_title: Doc Detective found changes
```

### `pr_body`

The body of the created pull request. `$RUN_URL` inserts the URL of the workflow run that created the pull request. Only valid if `create_pr_on_change` is `true`.

The default body is:

```text
A Doc Detective run ($RUN_URL) updated files.

DISCLAIMER: This pull request doesn't reflect whether Doc Detective tests passed or failed, only that files in the repository changed. Review the changes to make sure they're accurate.
```

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_pr_on_change: true
    pr_body: |
      Doc Detective updated files in run $RUN_URL.

      Review the changes before you merge.
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

Unlike the CLI's `exitOnFail: false`, this never turns exit `2` (nothing tested) green.

```yaml
- uses: doc-detective/github-action@v2
  with:
    exit_on_fail: false
```

### `create_issue_on_fail` (default: `false`)

File a GitHub issue if one or more tests fails.

If an open issue already has the same [`issue_title`](#issue_title) and the first label in [`issue_labels`](#issue_labels), the action replaces that issue's body with the latest run instead of opening another issue. A failing scheduled run keeps one issue current. Close the issue once it's fixed, and the next failure opens a new one. With no `issue_labels`, the title alone has to match.

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
  doc-tests:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
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

<a id="issue_body"></a>

### `issue_body`

The body of the created GitHub issue. Only valid if `create_issue_on_fail` is set to `true`. The action replaces these tokens:

| Token | Replaced with |
|---|---|
| `$SUMMARY` | The Markdown summary Doc Detective wrote to the run folder, `testResults.md`. If the run has no summary, a line that points to the workflow run |
| `$RESULTS` | The results object, as JSON |
| `$RUN_URL` | The URL of the workflow run that created the issue |
| `$PROMPT` | The [`issue_prompt`](#issue_prompt) text |

The default body is:

```text
A Doc Detective run ($RUN_URL) failed:

$SUMMARY
```

GitHub limits issue bodies to 65,536 characters. If the body would be longer, `$SUMMARY` and `$RESULTS` get cut to fit, and a note links to the workflow run. If `issue_body` and `issue_prompt` leave no room for them, the action logs an error and doesn't create the issue.

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

### `issue_mentions`

Comma-separated list of tools to mention in the created GitHub issue. Each one gets a mention or command, with [`issue_prompt`](#issue_prompt) where the tool takes one, in a collapsible "AI issue mentions" section appended to the issue body. Only valid if `create_issue_on_fail` is set to `true`.

Supported values: `doc-sentinel`, `promptless`, `dosu`, `claude`, `opencode`, `copilot`, `cursor`. The action ignores other values with a warning.

`copilot` assigns the issue to Copilot instead of adding a mention.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_issue_on_fail: true
    issue_mentions: claude,copilot
```

<a id="issue_prompt"></a>

### `issue_prompt` (default: `Investigate potential causes of the failures reported in this Doc Detective test output and suggest fixes.`)

The text that follows each mention from [`issue_mentions`](#issue_mentions). For example, if `issue_mentions` is `claude`, the issue includes `@claude <issue_prompt>`. `$PROMPT` inserts it in [`issue_body`](#issue_body). Only valid if `create_issue_on_fail` is set to `true`.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_issue_on_fail: true
    issue_mentions: claude
    issue_prompt: Investigate the Doc Detective test failures and suggest fixes for the documentation.
```

### `integrations`

Deprecated: use [`issue_mentions`](#issue_mentions). The action still reads it and logs a warning. Setting both fails the job.

### `prompt`

Deprecated: use [`issue_prompt`](#issue_prompt). The action still reads it and logs a warning. Setting both fails the job.

### `token` (default: `${{ github.token }}`)

The GitHub token to use for creating issues. Defaults to the token already available to the GitHub Action workflow. Only set this if you want to override the default token.

```yaml
- uses: doc-detective/github-action@v2
  with:
    create_issue_on_fail: true
    token: ${{ secrets.MY_GITHUB_TOKEN }}
```

## Run files

The action writes the results file, which sets the [`results`](#results) output, to the runner's temp directory (`RUNNER_TEMP`).

Doc Detective writes the rest under the `outputDir` in your config, which defaults to the working directory. That's the run folder, `.doc-detective/runs/<runId>/`, with the run's summary and automatic screenshots, and reports such as `junit.xml` and `doc-detective-summary.md`. A `screenshot` step saves where the step says, so it compares against the image in your repository, and an updated image reaches the `create_pr_on_change` pull request.

To keep run artifacts out of `git status` and pull requests, the action adds these patterns to the checkout's `.git/info/exclude`, which git reads but never commits: `.doc-detective/`, `junit.xml`, `doc-detective-summary.md`, and `testResults-*`. Outside a git checkout, it skips this step.

To keep the run folder after the job, upload it in a later step:

```yaml
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: doc-detective-run
    path: .doc-detective/runs/
```

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

URL of the created or updated pull request. Only set if `create_pr_on_change` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  id: doc-detective
  with:
    create_pr_on_change: true
- run: echo "${{ steps.doc-detective.outputs.pull_request_url }}"
```

### `issue_url`

URL of the created or updated GitHub issue. Only set if `create_issue_on_fail` is `true`.

```yaml
- uses: doc-detective/github-action@v2
  id: doc-detective
  with:
    create_issue_on_fail: true
- run: echo "${{ steps.doc-detective.outputs.issue_url }}"
```