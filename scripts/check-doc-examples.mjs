// Validates the Doc Detective specs, tests, steps, and configs in README.md's
// fenced ```json/```yaml blocks and in artifacts/*.{json,yaml,yml} against
// doc-detective-common's schemas. Fences marked `invalid` are skipped. The
// artifacts' Markdown files, including the intentionally failing
// doc-content-inline-tests-fail.md, aren't read.
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import * as common from "doc-detective-common";

const { schemas, validate } = common;
const stepActions =
  common.stepActions ??
  schemas.step_v3.oneOf.flatMap((o) => (o.allOf ?? []).flatMap((a) => a.required ?? []));
const configKeys = new Set(Object.keys(schemas.config_v3.properties));
const isObject = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const isStep = (o) => isObject(o) && Object.keys(o).filter((k) => stepActions.includes(k)).length === 1;

function schemaKeyFor(o) {
  if (!isObject(o)) return null;
  if ("tests" in o) return "spec_v3";
  if (Array.isArray(o.steps) && o.steps.some(isStep)) return "test_v3";
  if (isStep(o)) return "step_v3";
  const keys = Object.keys(o);
  return keys.length && keys.every((k) => configKeys.has(k)) ? "config_v3" : null;
}

const root = path.join(import.meta.dirname, "..");
const blocks = [];
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
for (const m of readme.matchAll(/^```(?:json|ya?ml)([^\n]*)\n([\s\S]*?)^```/gm)) {
  const line = readme.slice(0, m.index).split("\n").length;
  blocks.push({ where: `README.md:${line}`, invalid: /\binvalid\b/.test(m[1]), source: m[2] });
}
for (const name of fs.readdirSync(path.join(root, "artifacts")).filter((n) => /\.(json|ya?ml)$/.test(n))) {
  blocks.push({ where: `artifacts/${name}`, source: fs.readFileSync(path.join(root, "artifacts", name), "utf8") });
}

let checked = 0;
let skipped = 0;
const failures = [];
for (const { where, invalid, source } of blocks) {
  let object;
  try {
    object = parse(source); // YAML is a superset of JSON.
  } catch {}
  const schemaKey = invalid ? null : schemaKeyFor(object);
  if (!schemaKey) {
    skipped++;
    continue;
  }
  checked++;
  const result = validate({ schemaKey, object });
  if (!result.valid) failures.push(`${where} (${schemaKey}): ${result.errors}`);
}

console.log(`Doc examples: ${checked} checked, ${skipped} skipped, ${failures.length} failed.`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exit(1);
