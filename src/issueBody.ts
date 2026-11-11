/** GitHub rejects an issue body longer than this. */
export const ISSUE_BODY_LIMIT = 65536;

const fence = (results: string) => `\n\n\`\`\`json\n${results}\n\`\`\``;

/**
 * Render the issue body, cutting `$RESULTS` to fit GitHub's limit. Tokens are
 * filled in one pass with a replacer function, so `$PROMPT` or `$&` inside the
 * results stays literal and can't grow the body after it was measured.
 */
export function buildIssueBody({
  template,
  results,
  runUrl,
  prompt,
  suffix,
}: {
  template: string;
  results: string;
  runUrl: string;
  prompt: string;
  suffix: string;
}): string {
  const render = (filled: string) =>
    template.replace(/\$(RUN_URL|PROMPT|RESULTS)/g, (_, token) =>
      token === "RUN_URL" ? runUrl : token === "PROMPT" ? prompt : filled
    ) + suffix;

  const full = render(fence(results));
  if (full.length <= ISSUE_BODY_LIMIT) return full;

  const note = `\n\nResults truncated to fit GitHub's issue size limit. See the [workflow run](${runUrl}) for details.`;
  const tokens = template.match(/\$RESULTS/g)?.length ?? 0;
  const room =
    Math.floor((ISSUE_BODY_LIMIT - render("").length) / Math.max(tokens, 1)) -
    fence("").length -
    note.length;
  let cut = results.slice(0, Math.max(room, 0));
  // Don't leave half a surrogate pair at the cut.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  // Every `$RESULTS` slot gets the cut results and the note, so each reads on its own.
  return render(fence(cut) + note).slice(0, ISSUE_BODY_LIMIT);
}
