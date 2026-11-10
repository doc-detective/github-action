import type { getOctokit } from "@actions/github";

type Octokit = ReturnType<typeof getOctokit>;

/**
 * Update the open issue with this title and first label, so a failing schedule
 * keeps one issue current instead of opening one per run. Otherwise create it.
 * The issues API lists pull requests too, so those are skipped.
 */
export async function fileIssue({
  octokit,
  owner,
  repo,
  title,
  body,
  labels,
  assignees,
  warning,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  warning: (message: string) => void;
}): Promise<{ url: string; updated: boolean }> {
  const open = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: "open",
    per_page: 100,
    ...(labels[0] ? { labels: labels[0] } : {}),
  });
  const existing = open.find((issue) => !issue.pull_request && issue.title === title);
  if (existing) {
    const { data } = await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      body,
    });
    return { url: data.html_url, updated: true };
  }

  const create = (withAssignees: boolean) =>
    octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
      ...(withAssignees ? { assignees } : {}),
    });
  try {
    return { url: (await create(true)).data.html_url, updated: false };
  } catch (error) {
    if ((error as { status?: number }).status !== 422) throw error;
    warning(
      `Couldn't create the issue with assignees (${assignees.join(", ")}). Retrying without assignees.`
    );
    return { url: (await create(false)).data.html_url, updated: false };
  }
}
