/* ai-prompt-coherence.test.mjs - the cloud prompts no longer contradict themselves (T20), the system
 * prompt travels as systemInstruction on both transports, dead provider code is gone (T43) and
 * /health says configured vs last-success (T51). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const M = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const { KNOWLEDGE_SYS, RAG_SYS, ABSTAIN_RULE, onRequest } = M;
const SRC = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

test("/health (runs first, before any success in this isolate): configured is not healthy; real auth mode", async () => {
  const h = await (await onRequest({ request: new Request("https://stewardmd.in/api/ai/health", { headers: { Origin: "https://stewardmd.in" } }), env: { VERTEX_API_KEY: "v", GEMINI_API_KEY: "d" }, params: { path: ["health"] }, waitUntil: () => {} })).json();
  assert.equal(h.vertex_configured, true);
  assert.notEqual(h.vertex_status, "healthy");
  assert.equal(h.authentication, "API key (Vertex express mode)");
  assert.ok("vertex_last_success" in h && "developer_last_success" in h);
});

test("the contradictory pairs are gone from KNOWLEDGE_SYS and RAG_SYS", () => {
  for (const p of [KNOWLEDGE_SYS, RAG_SYS]) {
    assert.ok(!(/SAY SO/.test(p) && /do NOT refuse or hedge/i.test(p)), "abstain 'SAY SO' vs 'do NOT refuse or hedge'");
    assert.doesNotMatch(p, /End with ONE natural follow-up offer|end with ONE natural follow-up offer/, "the offer is not 'the end' when @@REFINE must be last");
  }
  assert.doesNotMatch(SRC, /SAY SO plainly/, "the old abstain suffix is gone from the handler too");
  assert.doesNotMatch(RAG_SYS, /Vertex|Google|Gemini/, "no provider name");
  assert.match(RAG_SYS, /unless a LENGTH instruction/, "fixed bullet count yields to LENGTH");
  assert.ok(KNOWLEDGE_SYS.indexOf(ABSTAIN_RULE) > 0 && KNOWLEDGE_SYS.split(ABSTAIN_RULE).length === 2, "abstain rule stated once");
  const iOffer = KNOWLEDGE_SYS.indexOf("follow-up offer"), iRefine = KNOWLEDGE_SYS.indexOf("@@REFINE:");
  assert.ok(iOffer > 0 && iRefine > iOffer, "the ending order is offer, then @@REFINE last");
});

test("KNOWLEDGE_SYS is meaningfully shorter (was 9,310 chars)", () => {
  assert.ok(KNOWLEDGE_SYS.length < 9310 * 0.9, "length " + KNOWLEDGE_SYS.length);
  for (const rule of ["TWO-TIER", "@@MORE@@", "@@REFINE:", "In India", "DOSING", "high-alert", "STAY ON TOPIC", "deliver it now", "Never use patient identifiers", "PIPE TABLE", "I can only help with medical and clinical questions"]) assert.ok(KNOWLEDGE_SYS.includes(rule), "dropped: " + rule);
});

async function explainBody(env, body) {
  let sent = null, url = "";
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u).indexOf("generateContent") >= 0) { sent = JSON.parse(init.body); url = String(u); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })); }
    return new Response("{}");
  };
  try {
    const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, params: { path: ["explain"] }, waitUntil: () => {} });
    await r.text();
  } finally { globalThis.fetch = real; }
  return { sent, url };
}
const Q = { question: "management of community acquired pneumonia", grounding: [{ text: "x" }] };

for (const [name, env, host] of [["developer", { AI_PROVIDER: "developer", GEMINI_API_KEY: "k" }, "generativelanguage"], ["vertex express", { VERTEX_API_KEY: "v" }, "aiplatform"]]) {
  test("the system prompt goes through systemInstruction (" + name + ")", async () => {
    const { sent, url } = await explainBody(Object.assign({ MAIK_ABSTAIN: "1" }, env), Q);
    assert.ok(url.indexOf(host) >= 0);
    const sys = sent.systemInstruction.parts[0].text;
    assert.ok(sys.startsWith(KNOWLEDGE_SYS), "static prompt first");
    assert.match(sys, /CITE-OR-ABSTAIN/, "per-request suffix after it");
    assert.ok(sent.contents[0].parts[0].text.indexOf("You are MaiK") < 0, "not glued onto the user text");
  });
}

test("tier 2 with depth=detailed expands on the question, no generic outline, no conflicting @@MORE@@", async () => {
  const { sent } = await explainBody({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k" }, Object.assign({ tier: 2, priorLead: "Amoxicillin.", depth: "detailed" }, Q));
  const sys = sent.systemInstruction.parts[0].text;
  assert.doesNotMatch(sys, /LENGTH: DETAILED/);
  assert.doesNotMatch(sys, /pathophysiology, presentation/);
  assert.match(sys, /overrides the TWO-TIER instruction/);
});

test("dead code is gone (Azure provider + breaker, webSearch plumbing, maxOutputTokens report)", () => {
  assert.doesNotMatch(SRC, /azure|Azure/);
  assert.doesNotMatch(SRC, /webSearch/);
  assert.doesNotMatch(readFileSync(new URL("../functions/_usage.js", import.meta.url), "utf8"), /maxOutputTokens/);
});

