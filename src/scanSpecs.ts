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

/**
 * Matches `name` as a value of a `platform` or `platforms` key, in JSON or
 * YAML: `"platforms": "ios"`, `"platforms": ["mac", "ios"]`, `platforms: ios`,
 * `platforms: [mac, ios]`, and a block list with a `- ios` item. The name has
 * to be the whole value, so `ios` doesn't match `kiosk` or `ios-simulator`.
 */
export function platformRe(name: string): RegExp {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const value = String.raw`["']?${literal}["']?(?![\w-])`;
  // The rest of a line, then any blank or comment-only lines, then `- `.
  const item = String.raw`(?:[ \t]*(?:#[^\r\n]*)?\r?\n)+[ \t]*-[ \t]*`;
  return new RegExp(
    String.raw`(?<![\w-])["']?platforms?["']?\s*:` +
      // A scalar, or an item of an inline list.
      String.raw`(?:\s*(?:\[[^\]]*?(?<![\w-]))?${value}` +
      // An item of a block list.
      String.raw`|(?:${item}["']?[\w-]+["']?)*?${item}${value})`,
    "i"
  );
}

/**
 * Where to look for specs: `input` and `config`, resolved against
 * `working_directory`, and `working_directory` itself. With an empty
 * `working_directory`, only what the inputs name, or the workspace when they
 * name nothing.
 */
export function scanRoots({ input, config, cwd }: { input: string; config: string; cwd: string }): string[] {
  const base = path.resolve(cwd || ".");
  const named = [input, config].filter(Boolean).map((p) => path.resolve(base, p));
  return cwd || !named.length ? [...named, base] : named;
}

export const IOS_PLATFORM_RE = platformRe("ios");

/** True if the given text requests the `ios` target platform. */
export function textRequestsIos(text: string): boolean {
  return IOS_PLATFORM_RE.test(text);
}

/** True as soon as any scannable file under `roots` requests the `ios` platform. */
export function scanForIos(roots: string[], deps: ScanDeps = realScanDeps, maxDepth = 6): boolean {
  return scanSpecs(roots, textRequestsIos, deps, maxDepth);
}
