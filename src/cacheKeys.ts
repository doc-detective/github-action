// Shared cache-key helpers for the Doc Detective action.
//
// actions/cache keys forbid commas and behave best on a conservative charset;
// npm versions can carry +build metadata and version lines can have spaces.
// Collapse runs of anything outside [A-Za-z0-9._-] to a single "-".
export function sanitizeKeySegment(value: string): string {
  return (
    (value || "unknown").trim().replace(/[^A-Za-z0-9._-]+/g, "-") || "unknown"
  );
}
