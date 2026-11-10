/**
 * A warning when the job's `node`, which `npx` runs Doc Detective with, is older
 * than CLI 5 needs. The action itself runs on its own Node.js, so this checks
 * `node --version` output, not `process.version`. Unreadable output gets none.
 */
export function nodeVersionWarning(version: string): string | undefined {
  const shown = version.trim();
  const match = shown.match(/^v?(\d+)\.(\d+)/);
  if (!match) return undefined;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (major > 24 || (major === 24 && minor >= 15)) return undefined;
  return `Doc Detective 5 needs Node.js 24.15 or later, but this job runs ${shown}. Add \`actions/setup-node\` with \`node-version: 24\`.`;
}
