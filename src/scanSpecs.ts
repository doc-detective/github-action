// Shared spec-scanner for the Doc Detective action's platform auto-detection.
// Walks the given roots (files or directories) and returns true as soon as any
// scannable file matches the supplied text matcher. Bounded by `maxDepth` and a
// skip-list so it stays cheap on a large repo. A false positive is harmless
// (the corresponding setup runs but is unused); a false negative just falls
// back to a capability SKIP — so callers err toward matching.

import fs from "fs";
import path from "path";

// File extensions worth scanning for Doc Detective specs (JSON specs, and specs
// embedded in Markdown/MDX/YAML). Kept small so the walk stays cheap.
const SCANNABLE = new Set([".json", ".md", ".mdx", ".markdown", ".yaml", ".yml"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".github"]);

export interface ScanDeps {
  readFileSync: (p: string, enc: "utf8") => string;
  readdirSync: (
    p: string
  ) => Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  existsSync: (p: string) => boolean;
}

export const realScanDeps: ScanDeps = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
  existsSync: (p) => fs.existsSync(p),
};

/**
 * Walk `roots` (files or directories) and return true as soon as any scannable
 * file's text satisfies `matches`.
 */
export function scanSpecs(
  roots: string[],
  matches: (text: string) => boolean,
  deps: ScanDeps = realScanDeps,
  maxDepth = 6
): boolean {
  const seen = new Set<string>();
  const scanFile = (file: string): boolean => {
    if (!SCANNABLE.has(path.extname(file).toLowerCase())) return false;
    try {
      return matches(deps.readFileSync(file, "utf8"));
    } catch {
      return false;
    }
  };
  const walk = (target: string, depth: number): boolean => {
    if (depth > maxDepth || seen.has(target) || !deps.existsSync(target))
      return false;
    seen.add(target);
    let entries: ReturnType<ScanDeps["readdirSync"]>;
    try {
      entries = deps.readdirSync(target);
    } catch {
      // Not a directory (or unreadable) — treat as a file.
      return scanFile(target);
    }
    for (const entry of entries) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (walk(child, depth + 1)) return true;
      } else if (entry.isFile() && scanFile(child)) {
        return true;
      }
    }
    return false;
  };
  return roots.some((root) => walk(root, 0));
}
