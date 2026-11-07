import * as core from "@actions/core";

const INTEGRATION_MAP: Record<string, string> = {
  "doc-sentinel": "\n/cc @reem-sab",
  "promptless": "\n@promptless $PROMPT",
  "dosu": "\n@dosu $PROMPT",
  "claude": "\n@claude $PROMPT",
  "opencode": "\n/opencode $PROMPT",
  "cursor": "\n@cursor $PROMPT",
};

// All valid integration names (INTEGRATION_MAP keys + special-case integrations)
const VALID_INTEGRATIONS = new Set([...Object.keys(INTEGRATION_MAP), "copilot"]);

export function parseIntegrations(
  integrationsInput: string,
  warn: (message: string) => void = core.warning
): string[] {
  if (!integrationsInput || !integrationsInput.trim()) return [];

  const requested = integrationsInput.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  const valid: string[] = [];

  for (const name of requested) {
    if (VALID_INTEGRATIONS.has(name)) {
      valid.push(name);
    } else {
      warn(`Unknown issue_mentions value "${name}". Supported values: ${[...VALID_INTEGRATIONS].join(", ")}`);
    }
  }

  return valid;
}

export function buildIntegrationsAccordion(integrations: string[], prompt: string): string {
  const accordionEntries = integrations
    .filter((name) => name !== "copilot")
    .map((name) => INTEGRATION_MAP[name].replace("$PROMPT", () => prompt))
    .filter(Boolean);

  if (accordionEntries.length === 0) return "";

  return `\n\n<details>\n<summary>AI issue mentions</summary>\n${accordionEntries.join("\n")}\n</details>`;
}
