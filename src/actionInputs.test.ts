import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { DEFAULT_ISSUE_PROMPT, getAliasedInput } from "./actionInputs.ts";

const root = path.join(import.meta.dirname, "..");
const action = parse(fs.readFileSync(path.join(root, "action.yml"), "utf8"));
const inputs: Record<string, { description: string; default?: string }> = action.inputs;

// The `### \`name\`` sections under `## Inputs`, with their `(default: …)`.
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const inputsPart = readme.split(/^## Inputs$/m)[1].split(/^## /m)[0];
const sections = new Map(
  inputsPart
    .split(/^(?=### )/m)
    .map((s) => s.match(/^### `(\w+)`(?: \(default: `(.*)`\))?\n([\s\S]*)/))
    .filter((m) => m !== null)
    .map(([, name, def, body]) => [name, { def, body }]),
);

test("every action.yml input has a README section", () => {
  for (const name of Object.keys(inputs)) {
    assert.ok(sections.has(name), `README has no section for \`${name}\``);
  }
});

test("every README input section names a real input", () => {
  for (const name of sections.keys()) {
    assert.ok(name in inputs, `README documents \`${name}\`, which action.yml doesn't declare`);
  }
});

test("each README default equals the action.yml default", () => {
  for (const [name, { description, default: def = "" }] of Object.entries(inputs)) {
    const section = sections.get(name);
    if (!section) continue;
    if (def.includes("\n")) {
      // Too long for a heading: the section quotes it in full.
      assert.equal(section.def, undefined, `\`${name}\` heading`);
      assert.ok(section.body.includes(def.trimEnd()), `README \`${name}\` doesn't quote its default`);
    } else if (def) {
      assert.equal(section.def, def, `README \`${name}\` default`);
    } else if (section.def) {
      // Applied in code, so action.yml states it in the description instead.
      assert.ok(
        description.includes(`Defaults to \`${section.def}\``),
        `action.yml \`${name}\` description doesn't state the README default`,
      );
    }
  }
});

test("the issue_prompt default in code matches the docs", () => {
  assert.equal(sections.get("issue_prompt")?.def, DEFAULT_ISSUE_PROMPT);
});

test("deprecated inputs point at their replacements", () => {
  assert.equal(inputs.integrations.description, "Deprecated: use `issue_mentions`.");
  assert.equal(inputs.prompt.description, "Deprecated: use `issue_prompt`.");
});

function reader(values: Record<string, string>) {
  const warnings: string[] = [];
  return {
    warnings,
    io: { getInput: (n: string) => values[n] ?? "", warning: (m: string) => warnings.push(m) },
  };
}

test("an aliased input reads the new name without a warning", () => {
  const { warnings, io } = reader({ issue_mentions: "claude" });
  assert.equal(getAliasedInput("issue_mentions", "integrations", io), "claude");
  assert.deepEqual(warnings, []);
});

test("an aliased input falls back to the deprecated name and warns", () => {
  const { warnings, io } = reader({ integrations: "claude" });
  assert.equal(getAliasedInput("issue_mentions", "integrations", io), "claude");
  assert.deepEqual(warnings, [
    "The `integrations` input is deprecated. Rename it to `issue_mentions`.",
  ]);
});

test("an aliased input set under both names fails, naming both", () => {
  const { io } = reader({ issue_prompt: "a", prompt: "b" });
  assert.throws(() => getAliasedInput("issue_prompt", "prompt", io), {
    message: "Set `issue_prompt` or `prompt`, not both.",
  });
});

test("an aliased input set under neither name is empty", () => {
  const { warnings, io } = reader({});
  assert.equal(getAliasedInput("issue_prompt", "prompt", io), "");
  assert.deepEqual(warnings, []);
});
