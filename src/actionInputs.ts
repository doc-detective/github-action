/**
 * Applied here, not in action.yml: the runner fills action.yml defaults in
 * before the action starts, so a defaulted `issue_prompt` would always look set
 * and hide a value given under its deprecated alias, `prompt`.
 */
export const DEFAULT_ISSUE_PROMPT =
  "Investigate potential causes of the failures reported in this Doc Detective test output and suggest fixes.";

/**
 * Reads an input that was renamed, falling back to its deprecated old name with
 * a warning. Setting both is an error.
 */
export function getAliasedInput(
  name: string,
  alias: string,
  io: { getInput: (name: string) => string; warning: (message: string) => void },
): string {
  const value = io.getInput(name);
  const old = io.getInput(alias);
  if (value && old) throw new Error(`Set \`${name}\` or \`${alias}\`, not both.`);
  if (old) io.warning(`The \`${alias}\` input is deprecated. Rename it to \`${name}\`.`);
  return value || old;
}
