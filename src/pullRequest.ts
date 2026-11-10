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
  try {
    if (labels.length)
      await octokit.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels });
    if (assignees.length)
      await octokit.rest.issues.addAssignees({ owner, repo, issue_number: pr.number, assignees });
    if (reviewers.length)
      await octokit.rest.pulls.requestReviewers({ owner, repo, pull_number: pr.number, reviewers });
  } catch (e) {
    error(
      (e as { status?: number }).status === 403
        ? "Doc Detective doesn't have permissions to label or assign the pull request. Give the job `pull-requests: write`, and allow GitHub Actions to create pull requests in the repository settings."
        : `Couldn't label the pull request or assign people to it: ${(e as Error).message}`
    );
  }
  return { url: pr.html_url, updated: false };
}
