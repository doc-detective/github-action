import type { getOctokit } from "@actions/github";
import type { Git } from "./git.ts";

type Octokit = ReturnType<typeof getOctokit>;

/**
 * The pull request's base: the base branch on `pull_request` events, else the
 * branch that triggered the run. `git rev-parse HEAD` can't say, since a
 * `pull_request` checkout is a detached merge commit.
 */
export function prBase(env: Record<string, string | undefined>): string {
  return env.GITHUB_BASE_REF || env.GITHUB_REF_NAME || "";
}

/**
 * Commit the checkout's changes to `branch`, force-push it, and update its open
 * pull request, or open one. Each run replaces the branch, so one pull request
 * carries the latest changes instead of one per run.
 */
export async function openPullRequest({
  git,
  octokit,
  owner,
  repo,
  branch,
  base,
  title,
  body,
  actor,
  labels,
  assignees,
  reviewers,
  error,
}: {
  git: Git;
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
  base: string;
  title: string;
  body: string;
  actor: string;
  labels: string[];
  assignees: string[];
  reviewers: string[];
  error: (message: string) => void;
}): Promise<{ url: string; updated: boolean }> {
  if (!base) {
    throw new Error(
      "Couldn't tell which branch the pull request targets: `GITHUB_BASE_REF` and `GITHUB_REF_NAME` are both empty."
    );
  }
  await git(["checkout", "-B", branch]);
  await git(["add", "-A"]);
  await git([
    "-c",
    `user.name=${actor}`,
    "-c",
    `user.email=${actor}@users.noreply.github.com`,
    "commit",
    "-m",
    "Doc Detective results",
  ]);
  await git(["push", "--force", "origin", branch]);

  const { data: open } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    head: `${owner}:${branch}`,
    base,
  });
  if (open[0]) {
    // Labels, assignees, and reviewers are set once, when the pull request
    // opens, so later runs don't undo a reviewer's edits or re-request reviews.
    const { data } = await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: open[0].number,
      title,
      body,
    });
    return { url: data.html_url, updated: true };
  }

  const { data: pr } = await octokit.rest.pulls.create({ owner, repo, title, body, head: branch, base });
  // Each one on its own, so a failure doesn't skip the rest.
  const decorate = async (what: string, call: () => Promise<unknown>) => {
    try {
      await call();
    } catch (e) {
      error(
        (e as { status?: number }).status === 403
          ? `Couldn't ${what}: the token lacks permission. Give the job \`pull-requests: write\`, and allow GitHub Actions to create pull requests in the repository settings.`
          : `Couldn't ${what}: ${(e as Error).message}`
      );
    }
  };
  if (labels.length)
    await decorate("label the pull request", () =>
      octokit.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels })
    );
  if (assignees.length)
    await decorate("assign the pull request", () =>
      octokit.rest.issues.addAssignees({ owner, repo, issue_number: pr.number, assignees })
    );
  if (reviewers.length)
    await decorate("request reviewers", () =>
      octokit.rest.pulls.requestReviewers({ owner, repo, pull_number: pr.number, reviewers })
    );
  return { url: pr.html_url, updated: false };
}
