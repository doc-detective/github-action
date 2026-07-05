// Android emulator support for the Doc Detective action.
//
// Running Android tests needs hardware acceleration. On GitHub's hosted Linux
// runners `/dev/kvm` exists but is `root:kvm 0660` and the runner user isn't in
// the `kvm` group, so Doc Detective's capability probe fails and every android
// context SKIPs. Enabling KVM is a one-time udev step that needs sudo — which
// Doc Detective won't do itself, but this action can. So when a run targets
// Android on Linux, we grant KVM access up front and the emulator "just works".
//
// The detection half is pure (regex over spec text) so it's unit-testable; the
// KVM half shells out and is injected for tests.

import fs from "fs";
import path from "path";

// Matches an `android` value on a `platform`/`platforms` field in a resolved
// spec or config — `"platform": "android"`, `"platforms": "android"`, and the
// array forms `"platforms": ["android", ...]` / `["chrome", "android"]`.
export const ANDROID_PLATFORM_RE =
  /["']platforms?["']\s*:\s*(?:\[[^\]]*?)?["']android["']/i;

/** True if the given text requests the `android` target platform. */
export function textRequestsAndroid(text: string): boolean {
  return ANDROID_PLATFORM_RE.test(text);
}

// File extensions worth scanning for Doc Detective specs (JSON specs, and specs
// embedded in Markdown/MDX). Kept small so the walk stays cheap.
const SCANNABLE = new Set([".json", ".md", ".mdx", ".markdown", ".yaml", ".yml"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".github"]);

export interface ScanDeps {
  readFileSync: (p: string, enc: "utf8") => string;
  readdirSync: (p: string) => Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  existsSync: (p: string) => boolean;
}

const realScanDeps: ScanDeps = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
  existsSync: (p) => fs.existsSync(p),
};

/**
 * Walk the given roots (files or directories) and return true as soon as any
 * scannable file requests the `android` platform. Bounded by `maxDepth` and the
 * skip-list so it stays cheap on a large repo. A false positive here is
 * harmless (KVM gets enabled but unused); a false negative just falls back to a
 * capability SKIP — so the scan errs toward matching.
 */
export function scanForAndroid(
  roots: string[],
  deps: ScanDeps = realScanDeps,
  maxDepth = 6
): boolean {
  const seen = new Set<string>();
  const walk = (target: string, depth: number): boolean => {
    if (depth > maxDepth || seen.has(target) || !deps.existsSync(target)) return false;
    seen.add(target);
    let entries: ReturnType<ScanDeps["readdirSync"]>;
    try {
      entries = deps.readdirSync(target);
    } catch {
      // Not a directory (or unreadable) — treat as a file.
      return scanFile(target, deps);
    }
    for (const entry of entries) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (walk(child, depth + 1)) return true;
      } else if (entry.isFile() && scanFile(child, deps)) {
        return true;
      }
    }
    return false;
  };
  return roots.some((root) => walk(root, 0));
}

function scanFile(file: string, deps: ScanDeps): boolean {
  if (!SCANNABLE.has(path.extname(file).toLowerCase())) return false;
  try {
    return textRequestsAndroid(deps.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Resolve whether Android setup should run, from the `android` input
 * ("auto" | "true" | "false") and the host. KVM setup is Linux-only — on hosted
 * macOS/Windows the emulator can't be accelerated, so there's nothing to do.
 */
export function shouldSetUpAndroid({
  androidInput,
  platform,
  roots,
  scan = scanForAndroid,
}: {
  androidInput: string;
  platform: NodeJS.Platform;
  roots: string[];
  scan?: (roots: string[]) => boolean;
}): { setUp: boolean; reason: string } {
  const value = (androidInput || "auto").trim().toLowerCase();
  if (value === "false") return { setUp: false, reason: "android input is false" };
  if (platform !== "linux") {
    return {
      setUp: false,
      reason:
        value === "true"
          ? "android requested, but KVM setup only applies to Linux runners (hosted macOS/Windows can't accelerate the emulator)"
          : "not a Linux runner",
    };
  }
  if (value === "true") return { setUp: true, reason: "android input is true" };
  // auto
  return scan(roots)
    ? { setUp: true, reason: "auto-detected an android platform in your specs" }
    : { setUp: false, reason: "no android platform detected in specs" };
}

export interface KvmDeps {
  existsSync: (p: string) => boolean;
  exec: (command: string, args: string[]) => Promise<number>;
  info: (m: string) => void;
  warning: (m: string) => void;
}

/**
 * Grant the runner user read/write access to /dev/kvm via a udev rule, so the
 * Android emulator can accelerate. Best-effort: needs passwordless sudo (hosted
 * runners have it); a failure downgrades to a warning and the context will just
 * SKIP rather than failing the run.
 */
export async function enableLinuxKvm(deps: KvmDeps): Promise<boolean> {
  if (!deps.existsSync("/dev/kvm")) {
    deps.warning(
      "Android setup requested but /dev/kvm is not present on this runner — the Android emulator can't be accelerated here, so Android contexts will SKIP."
    );
    return false;
  }
  const rule =
    'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"';
  try {
    await deps.exec("bash", [
      "-c",
      `echo '${rule}' | sudo tee /etc/udev/rules.d/99-kvm4all.rules && sudo udevadm trigger --name-match=kvm`,
    ]);
    deps.info("Enabled KVM access for the Android emulator.");
    return true;
  } catch (error) {
    deps.warning(
      `Couldn't enable KVM (this needs passwordless sudo, available on hosted runners): ${
        (error as Error)?.message ?? error
      }. Android contexts will SKIP.`
    );
    return false;
  }
}
