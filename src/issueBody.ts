import fs from "fs";
import path from "path";

/** GitHub rejects an issue body longer than this. */
export const ISSUE_BODY_LIMIT = 65536;

const fence = (results: string) => `\n\n\`\`\`json\n${results}\n\`\`\``;

/**
 * The run's Markdown summary, `<runDir>/testResults.md`, which CLI 5 writes to
 * the run folder. `runDir` comes from the results file. Without a run folder or
 * a summary in it, a pointer to the workflow run stands in.
 */
export function readRunSummary(runDir: unknown, runUrl: string): string {
  if (typeof runDir === "string" && runDir) {
    try {
      return fs.readFileSync(path.join(runDir, "testResults.md"), "utf8").trimEnd();
    } catch {
      // No summary in the run folder.
    }
  }
  return `Doc Detective wrote no summary for this run. See the [workflow run](${runUrl}).`;
}

/**
 * Render the issue body, cutting `$SUMMARY` and `$RESULTS` to fit GitHub's
 * limit. Tokens are filled in one pass with a replacer function, so `$PROMPT` or
 * `$&` inside the summary or results stays literal and can't grow the body after
 * it was measured.
 */
export function buildIssueBody({
  template,
  summary,
  results,
  runUrl,
  prompt,
  suffix,
}: {
  template: string;
  summary: string;
  results: string;
  runUrl: string;
  prompt: string;
  suffix: string;
}): string {
  const render = (filledSummary: string, filledResults: string) =>
    template.replace(/\$(RUN_URL|PROMPT|RESULTS|SUMMARY)/g, (_, token) =>
      token === "RUN_URL"
        ? runUrl
        : token === "PROMPT"
          ? prompt
          : token === "SUMMARY"
            ? filledSummary
            : filledResults
    ) + suffix;

  const full = render(summary, fence(results));
  if (full.length <= ISSUE_BODY_LIMIT) return full;

  // Every $SUMMARY and $RESULTS gets an equal share of the room that's left.
  const note = `\n\nTruncated to fit GitHub's issue size limit. See the [workflow run](${runUrl}) for details.`;
  const tokens = template.match(/\$(RESULTS|SUMMARY)/g)?.length ?? 0;
  const summaryRoom =
    Math.floor((ISSUE_BODY_LIMIT - render("", "").length) / Math.max(tokens, 1)) - note.length;
  // Only $RESULTS sits in a JSON fence.
  const resultsRoom = summaryRoom - fence("").length;
  if ((/\$RESULTS/.test(template) ? resultsRoom : summaryRoom) < 0) {
    throw new Error(
      `The issue_body and issue_prompt inputs leave no room for the summary or results within GitHub's ${ISSUE_BODY_LIMIT}-character limit. Shorten them.`
    );
  }
  const cut = (text: string, room: number) => {
    let kept = text.slice(0, room);
    // Don't leave half a surrogate pair at the cut.
    if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
    return kept;
  };
  const fitSummary = () => {
    if (summary.length <= summaryRoom) return summary;
    const kept = cut(summary, summaryRoom);
    // End Markdown on a whole line, so a half table row doesn't swallow the note.
    const lineEnd = kept.lastIndexOf("\n");
    return (lineEnd > 0 ? kept.slice(0, lineEnd) : kept) + note;
  };
  const fitResults = () =>
    results.length <= resultsRoom ? fence(results) : fence(cut(results, resultsRoom)) + note;
  return render(fitSummary(), fitResults());
}
