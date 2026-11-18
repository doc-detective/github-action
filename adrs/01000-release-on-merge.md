---
status: accepted
date: 2026-11-18
decision-makers: hawkeyexl
---

# Release on merge with semantic-release

## Context and Problem Statement

Releases of this Action are cut by hand. A maintainer creates a GitHub release, then moves the
floating `v2` tag that workflows reference as `doc-detective/github-action@v2`. Nothing prompts
either step.

Default-on caching merged to `main` on 2026-11-16 (#101, #102, #104) and never reached users,
because nobody cut a release. `v2` and `v2.0.0` both stayed at `d4754e9`. The workflow meant to
move the floating tags, `.github/workflows/publish.yml`, is disabled and has never run. If it ran,
it would delete the release that triggered it. The `latest` tag still points at a v1 release
(`v1.5.0`, `9221317`), so `@latest` users run v1.

How do merged changes reach `@v2` users without a person remembering to release them?

## Decision Drivers

* A merged `feat:` or `fix:` reaches `@v2` users with no manual step.
* `main` requires pull requests, so a release can't push commits to it.
* `dist/index.js` is committed in pull requests and checked by CI, so a release has nothing to build.
* The floating tags (`v2`, `latest`) always point at the newest stable release.
* The `uses: doc-detective/github-action@v2` path keeps working.

## Considered Options

* **A. Keep hand-cut releases, and fix and re-enable `publish.yml`.**
* **B. Run semantic-release on every push to `main`** (chosen).
* **C. Fold the Action into `doc-detective/doc-detective` now.**

## Decision Outcome

Chosen option: **B**, because it removes the manual step that failed, and it needs no change to
how users reference the Action.

Behavior decided:

1. **Trigger.** semantic-release runs on every push to `main`.
2. **Release.** A `feat:`, `fix:`, or breaking commit since the last release cuts a release. That
   means a `vX.Y.Z` tag and a GitHub release with generated notes. A breaking commit has `!` after
   its type or a `BREAKING CHANGE:` footer, and cuts a major release whatever its type. A commit
   that `git revert` writes cuts a patch release, because it changes what ships. When the commit it
   reverts is in the same release, neither counts. Other commit types cut nothing.
3. **Floating tags.** After a stable release, the workflow force-moves two tags to it. `latest`
   tracks the newest stable release overall. Each major tag tracks the newest stable release in its
   own major, so `v2.1.0` moves `v2` and `latest`, and a later `v3.0.0` moves `v3` and `latest` and
   leaves `v2` alone. The tags only move forward. A run whose commit isn't the newest release, such
   as a re-run of an old run, leaves them alone. So does a run with no stable release at `HEAD`.
4. **Recovery.** A run on `main` whose commit has a version tag but no published GitHub release
   creates the release with GitHub's generated notes, then moves the tags. A draft or prerelease
   doesn't count as published. Re-running a run that failed partway finishes it. The tags don't
   move until the published release exists.
5. **No commits.** The release pushes tags and a GitHub release only. It pushes no commit, writes
   no changelog file, and doesn't touch `package.json`.
6. **Commit gate.** commitlint checks every pull request's commits against Conventional Commits,
   because commit types now decide releases. No author is exempt, Dependabot included.

`publish.yml` is deleted.

### Consequences

* Good: a merged `feat:` or `fix:` is released and on `@v2` within one workflow run.
* Good: `latest` tracks the newest stable release again.
* Bad: commit types matter. A non-conventional or mistyped commit cuts no release, and a wrong type
  cuts the wrong version. Pull requests merge with merge commits, so every commit in a pull request
  counts.
* Bad: `@latest` users move from v1 to v2 behavior at the next release.
* Neutral: the `version` field in `package.json` isn't maintained. Tags are the version.

### Confirmation

The first run after this change merges cuts `v2.1.0` from the commits on `main` since `v2.0.0`, and
moves `v2` and `latest` to it. A semantic-release dry run against the change's branch reports
`2.1.0` as the next version.

## Pros and Cons of the Options

### A. Keep hand-cut releases, and fix and re-enable `publish.yml`

* Good: no new dependency, and commit types stay free-form.
* Bad: a release still waits on a person, which is the step that failed.
* Bad: `publish.yml` needs a rewrite, not a switch. As written it deletes the triggering release.

### B. semantic-release on merge

* Good: no manual step. The version follows from the commits.
* Good: the same tooling as `doc-detective/doc-detective` and `doc-detective/agent-tools`.
* Bad: adds dev dependencies and a commit-message gate on pull requests.

### C. Fold the Action into `doc-detective/doc-detective` now

* Good: one repository, one release pipeline, and the Action ships in lockstep with the CLI.
* Bad: without a mirror repository, the Action shares the CLI's tag space, so `@v2` can't mean an
  Action version.
* Bad: the fold changes the `uses:` path. That's a breaking change, and it missed the v5 window.

Deferred to the next major.
