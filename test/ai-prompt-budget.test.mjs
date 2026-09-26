/* ai-prompt-budget.test.mjs - an oversized grounded package keeps the question, the treatment dosing,
 * stewardship and the SOURCES list; history is what gets trimmed, oldest turns first (T35). */
import { test } from "node:test";
import assert from "node:assert/strict";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));

async function prompt(pkg, env) {
  let sent = "";
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u).indexOf("generateContent") >= 0) { sent = JSON.stringify(JSON.parse(init.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })); }
    return new Response("{}");
  };
  try {
    const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pkg) }), env: Object.assign({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k" }, env || {}), params: { path: ["explain"] }, waitUntil: () => {} });
    await r.text();
  } finally { globalThis.fetch = real; }
  return sent;
}
const big = {
  question: "empiric antibiotic for ventilator associated pneumonia",
  history: Array.from({ length: 6 }, (_, i) => ({ q: "OLDTURN" + i + " " + "q".repeat(250), a: "ANSWER" + i + " " + "a".repeat(1150) })),
  earlier: ["sepsis", "shock"],
  grounding: [{ name: "VAP", diseaseId: "vap", knowledge: [{ section: "tx", text: "VAP grounding " + "k".repeat(280) }] }],
  treatment: { precedence: ["ICMR"], default: { tier: "ICMR", line: "Piperacillin-tazobactam first line", dosing: [{ drug: "piperacillin-tazobactam", dose: "4.5 g", route: "IV", freq: "q6h" }] } },
  refs: { stewardship: [{ deescalation: "DEESCALATE when cultures return" }] },
  sources: [{ n: 1, title: "IDSA HAP/VAP 2016" }],
};

test("over budget: question, dosing, stewardship and SOURCES survive; history is trimmed oldest-first", async () => {
  const p = await prompt(big, { MAIK_MAX_INPUT_TOKENS: "1000" });     // 4,000-char budget, package ~9k
  for (const must of ["empiric antibiotic for ventilator associated pneumonia", "4.5 g", "DEESCALATE", "IDSA HAP/VAP 2016", "VAP grounding"]) assert.ok(p.indexOf(must) >= 0, must + " was cut");
  assert.ok(p.indexOf("OLDTURN0") < 0, "the oldest turn goes first");
  assert.ok(p.indexOf("EARLIER IN THIS CONVERSATION") < 0, "earlier topics are the first thing dropped");
});

test("under budget: everything is kept, KB and treatment come before the conversation", async () => {
  const p = await prompt(big);
  assert.ok(p.indexOf("OLDTURN0") >= 0 && p.indexOf("EARLIER IN THIS CONVERSATION") >= 0);
  assert.ok(p.indexOf("=== YOUR REFERENCE NOTES") >= 0, "the KB section is present (renamed 2026-09-26)");
  assert.ok(p.indexOf("=== YOUR REFERENCE NOTES") < p.indexOf("=== RECENT CONVERSATION"));
  assert.ok(p.indexOf("=== TREATMENT RESOLUTION") < p.indexOf("=== RECENT CONVERSATION"));
  assert.ok(p.indexOf("=== SOURCES") < p.indexOf("=== RECENT CONVERSATION"));
});
