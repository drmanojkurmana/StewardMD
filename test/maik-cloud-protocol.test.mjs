/* MaiK Cloud gets the matching StewardMD clinical protocol for a treatment question (2026-10-02).
 * The same matcher MaiK Lite uses (maik-local.js protocolFor) picks it from kb/clinical-protocols/
 * index.json; home.js puts it on the package as pkg.protocol; the server prompt carries it once. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const INDEX = JSON.parse(readFileSync(new URL("../kb/clinical-protocols/index.json", import.meta.url), "utf8"));
const win = {
  Capacitor: { isNativePlatform: () => false, Plugins: {} },
  SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"),
  SMD_MAIK_PROTOCOLS: INDEX,
  SMD_MAIK_MODELS: { PACKS: {} },
};
new Function("window", SRC)(win);
const L = win.SMD_MAIK_LOCAL;
const { renderGroundedPrompt } = await import("../functions/api/ai/[[path]].js");

const pkg = (question, grounded) => ({ question, topicMatch: { matched: true, grounded, topic: grounded },
  grounding: [{ diseaseId: "x", name: grounded, knowledge: [] }] });

test("a treatment question gets its protocol once the list is loaded; a definition question does not", async () => {
  assert.equal(L.protocolForQuestion(pkg("how to manage septic shock", "Septic Shock")), null, "not loaded yet: nothing, and the load starts");
  await L.loadProtocols();
  const p = L.protocolForQuestion(pkg("how to manage septic shock", "Septic Shock"));
  assert.ok(p && /sepsis/i.test(p.title), JSON.stringify(p));
  assert.match(p.summary, /crystalloid|noradrenaline/i);
  assert.ok(p.summary.length <= 700);
  assert.equal(L.protocolForQuestion(pkg("what is septic shock", "Septic Shock")), null);
});

test("the server prompt carries the protocol summary under its own heading", () => {
  const out = renderGroundedPrompt({ question: "how to manage septic shock", grounding: [], protocol: { id: "sepsis-septic-shock", title: "Sepsis and septic shock: initial management", summary: "Cultures, antimicrobials within 1 hour, 30 mL/kg crystalloid, noradrenaline to a MAP of 65 mmHg." } }, 16000);
  assert.match(out, /STEWARDMD CLINICAL PROTOCOL: Sepsis and septic shock/);
  assert.match(out, /noradrenaline to a MAP of 65/);
  assert.doesNotMatch(renderGroundedPrompt({ question: "x", grounding: [] }, 16000), /CLINICAL PROTOCOL/);
});
