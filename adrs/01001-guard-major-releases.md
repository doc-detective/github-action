---
status: accepted
date: 2026-11-19
decision-makers: hawkeyexl
---

# Guard major releases behind a repository variable

## Context and Problem Statement

[ADR 01000](01000-release-on-merge.md) releases on every push to `main`, and a breaking commit cuts
a major release whatever its type. Pull requests merge with merge commits, so every commit in a pull
request counts. commitlint checks that a commit is well formed. It can't tell an intended breaking
change from a stray `!` or a `BREAKING CHANGE:` footer copied into a commit body.

One such commit would cut `v3.0.0`, create the `v3` tag, and move `latest` to it. Workflows on
`@latest` would get a major they didn't choose, and `@v2` would stop receiving releases. A published
tag and release can be deleted, but anyone who ran the action in between already used it.

How does a major release happen only when a maintainer means it?

## Decision Drivers

* A major release is a maintainer's decision, not a side effect of one commit message.
* The check covers every route a breaking commit can take to `main`.
* A refused release publishes nothing: no tag, no GitHub release, no moved floating tag.
* The same control as `doc-detective/doc-detective`, so maintainers learn one procedure.

## Considered Options

* **A. Leave majors unguarded.**
* **B. Fail a major release unless the `ALLOW_MAJOR_RELEASE` repository variable is `true`**
  (chosen).
* **C. Reject breaking commits in commitlint.**

## Decision Outcome

Chosen option: **B**, because it reads the release type semantic-release computed, which is the
only place that sees every commit the way the release does.

Behavior decided, amending item 2 of ADR 01000:

1. **Guard.** `scripts/verify-major-release.mjs` is a semantic-release plugin with a `verifyRelease`
   step. It fails a `major` release unless `ALLOW_MAJOR_RELEASE` is `true`, in any case and with
   surrounding whitespace ignored. Any other value, or no value, refuses. Minor and patch releases
   pass.
2. **Variable.** `ALLOW_MAJOR_RELEASE` is a repository variable. `release.yml` passes it to the
   release step from `vars.ALLOW_MAJOR_RELEASE`. Unset is the normal, locked state.
3. **Refusal.** A refused release fails the workflow run before semantic-release creates a tag, so
   nothing is published and no floating tag moves. The run's log says why and names both ways out.
   Every later push to `main` fails the same way until one of them is taken, so no release is cut
   in the meantime.
4. **Intended major.** A maintainer sets the variable to `true`, re-runs the failed run, then
   deletes the variable.
5. **Stray breaking commit.** A maintainer reverts the commit on `main`. A commit and its revert in
   the same release don't count, so the next release is whatever the other commits call for.

### Consequences

* Good: a stray `!` or `BREAKING CHANGE:` footer can't create `v3` or move `latest`.
* Good: the guard is one file with no new dependency.
* Bad: an intended major takes two extra manual steps, setting the variable and deleting it.
* Bad: a variable left at `true` turns the guard off. Nothing reminds a maintainer to delete it.
* Bad: while a breaking commit waits on `main`, the `fix:` and `feat:` commits merged after it
  aren't released either.

### Confirmation

`scripts/verify-major-release.test.mjs` runs with `npm test`. It checks that a major fails with the
variable unset or set to anything but `true`, that it passes with `true`, that minor and patch
releases pass, and that `.releaserc.json` loads the plugin and `release.yml` passes the variable.

## Pros and Cons of the Options

### A. Leave majors unguarded

* Good: nothing to build or remember.
* Bad: one commit message can move every `@latest` user to a new major.

### B. Fail a major release unless `ALLOW_MAJOR_RELEASE` is `true`

* Good: covers every route, because it reads the computed release type.
* Good: matches `doc-detective/doc-detective`, which runs the same check through
  `@semantic-release/exec`. A local plugin does it here without adding that dependency.
* Bad: the manual steps and the leftover-variable risk listed under Consequences.

### C. Reject breaking commits in commitlint

* Good: fails in the pull request, before the merge.
* Bad: an intended breaking change then has no way through without editing the lint config.
* Bad: commitlint only sees pull request commits. A commit pushed to `main` another way skips it.
