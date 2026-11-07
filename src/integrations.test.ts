import test from "node:test";
import assert from "node:assert/strict";
import { parseIntegrations, buildIntegrationsAccordion } from "./integrations.ts";

test("parseIntegrations keeps known names and warns on the rest", () => {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  assert.deepEqual(parseIntegrations(" Claude, bogus,,copilot ", warn), ["claude", "copilot"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"bogus"/);
});

test("parseIntegrations returns nothing for an empty or all-unknown value", () => {
  const warn = () => {};
  assert.deepEqual(parseIntegrations("", warn), []);
  assert.deepEqual(parseIntegrations("   ", warn), []);
  assert.deepEqual(parseIntegrations("nope", warn), []);
});

test("buildIntegrationsAccordion fills the prompt and leaves out copilot", () => {
  const html = buildIntegrationsAccordion(["claude", "copilot", "dosu"], "Fix it");
  assert.match(html, /<summary>AI issue mentions<\/summary>/);
  assert.match(html, /@claude Fix it/);
  assert.match(html, /@dosu Fix it/);
  assert.doesNotMatch(html, /copilot/i);
});

test("buildIntegrationsAccordion is empty with only copilot or nothing", () => {
  assert.equal(buildIntegrationsAccordion(["copilot"], "x"), "");
  assert.equal(buildIntegrationsAccordion([], "x"), "");
});
