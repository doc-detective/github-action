// A semantic-release plugin that stops an accidental major release (ADR 01001).
// Every commit in a merged pull request reaches main, so one stray `!` or
// `BREAKING CHANGE:` footer would cut the next major and create its floating
// tag. This reads the release type semantic-release computed, so it covers
// every route a breaking commit can take. It runs before anything is tagged.

export function verifyRelease(_pluginConfig, { nextRelease, env }) {
  const allowed = (env.ALLOW_MAJOR_RELEASE || "").trim().toLowerCase() === "true";
  if (nextRelease.type !== "major" || allowed) return;
  throw new Error(
    `Couldn't release ${nextRelease.version}, because a major release needs the \`ALLOW_MAJOR_RELEASE\` repository variable set to \`true\`. ` +
      "If the breaking change is intended, set the variable, re-run this workflow, then delete the variable. " +
      "If it isn't, revert the commit that has the `!` or the `BREAKING CHANGE:` footer."
  );
}
