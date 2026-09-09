/* test/wardsynq-maik-gemini.test.mjs — TASK 8.10: the Gemini provider, and the secret it holds.
 *
 * NO NETWORK, NO KEY. Every test here injects a fake transport and a fake key, because the
 * properties under test are properties of the ADAPTER, not of Google: that the credential travels in
 * a header and never in a URL, that it cannot escape into an error message, a refusal, or a clinical
 * record, that PHI approval still gates the provider, and that a blocked answer is a refusal a human
 * can act on rather than silence a clinician would read as "nothing to report".
 *
 * The real Gemini call is test/run-maik-real-eval.mjs, which is a different question with a
 * different answer.
 *
 * node --test test/wardsynq-maik-gemini.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { TASK, MODELS, PROVIDERS, route, invoke, maikStatus, scrubSecret, geminiKey } from "../functions/_wardsynq/maik-gateway.js";

const KEY = "AIzaSy-TEST-KEY-not-a-real-credential-000000";
const envWithKey = { GEMINI_API_KEY: KEY };
const on = (over) => ({ enabled: true, phiApproved: ["gemini"], ...(over || {}) });

/** A transport that records exactly what the adapter sent, and answers as the API does. */
function transport(reply, opts) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers || {}, body: JSON.parse(init.body) });
    const o = opts || {};
    if (o.status && o.status >= 400) return { ok: false, status: o.status, json: async () => reply };
    return { ok: true, status: 200, json: async () => reply };
  };
  return { seen, fetchImpl };
}
const answer = (text, over) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  modelVersion: "gemini-3.6-flash-002",
  usageMetadata: { promptTokenCount: 412, candidatesTokenCount: 88, totalTokenCount: 500 },
  ...(over || {}),
});

/* ---- 1: the credential ---------------------------------------------------------------------------- */

test("1. the key travels in a header and NEVER in the URL", async () => {
  const t = transport(answer("A summary."));
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p", config: on(), env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, true, JSON.stringify(r));
  const call = t.seen[0];
  assert.ok(!call.url.includes(KEY), "a URL carrying a credential lands in proxy logs and history");
  assert.ok(!call.url.includes("key="), "no key query parameter at all");
  assert.equal(call.headers["x-goog-api-key"], KEY, "and it is sent the way that keeps it out of logs");
  assert.ok(!JSON.stringify(call.body).includes(KEY), "nor is it in the request body");
});

test("2. the key cannot escape through an API error message", async () => {
  /* The nastiest realistic case: the provider echoes the request, key and all, back in its error. */
  const t = transport({ error: { status: "INVALID_ARGUMENT", message: `API key not valid: ${KEY} was rejected` } }, { status: 400 });
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p", config: on(), env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(KEY), "the refusal must not carry the credential anywhere");
  assert.match(r.detail, /\[redacted\]/, "and it is visibly redacted rather than silently dropped");
  // The error CLASS survives, because that is what an operator needs to fix it.
  assert.match(r.detail, /INVALID_ARGUMENT/);
});

test("3. scrubSecret removes the secret and refuses to pretend on a too-short one", () => {
  assert.equal(scrubSecret(`before ${KEY} after`, KEY), "before [redacted] after");
  // A short "secret" would match everywhere and redact the whole message into uselessness.
  assert.equal(scrubSecret("abc", "ab"), "abc");
  assert.equal(scrubSecret("", KEY), "");
});

test("4. the key is read from the environment and never from the org configuration", () => {
  assert.equal(geminiKey(envWithKey), KEY);
  assert.equal(geminiKey({}), (typeof process !== "undefined" && process.env.GEMINI_API_KEY) || null);
  // A key placed in the hospital's config record must not be honoured: that is a credential in a
  // clinical database, readable by everything that can read the org.
  assert.equal(geminiKey({ config: { geminiApiKey: "sneaky" } }), (typeof process !== "undefined" && process.env.GEMINI_API_KEY) || null);
});

/* ---- 5: the governance boundaries are unchanged ---------------------------------------------------- */

test("5. PHI still cannot reach Gemini unless this hospital approved that provider", async () => {
  const t = transport(answer("should never be produced"));
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p",
    config: { enabled: true, phiApproved: [] }, env: envWithKey, context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.code, "no_phi_approved_model");
  assert.equal(t.seen.length, 0, "and nothing was sent");
});

test("6. a caller cannot name Gemini to get around approval, because callers name TASKS", async () => {
  const t = transport(answer("x"));
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prefer: "gemini-flash", prompt: "p",
    config: { enabled: true, phiApproved: [] }, env: envWithKey, context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.code, "no_phi_approved_model");
  assert.equal(t.seen.length, 0);
});

test("7. a hospital's own hardware still outranks the cloud when both are approved", () => {
  const cfg = on({ phiApproved: ["gemini", "local-openai"], localBaseUrl: "https://hospital.internal/v1", localModel: "ward-7b" });
  const d = route({ task: TASK.SUMMARISE, phi: true, config: cfg, env: envWithKey, context: { patientId: "p" } });
  assert.equal(d.ok, true);
  assert.equal(d.model.provider, "local-openai", "privacy ranks before latency, and that must not change");
});

test("8. gemini-pro is opt-in by name, so two models from one provider are never silently swapped", () => {
  const cfg = on();
  const auto = route({ task: TASK.SUMMARISE, phi: true, config: cfg, env: envWithKey, context: { patientId: "p" } });
  assert.equal(auto.model.id, "gemini-flash");
  const named = route({ task: TASK.SUMMARISE, phi: true, prefer: "gemini-pro", config: cfg, env: envWithKey, context: { patientId: "p" } });
  assert.equal(named.model.id, "gemini-pro");
});

test("9. with no key in the environment, Gemini is simply not a candidate", () => {
  const d = route({ task: TASK.SUMMARISE, phi: true, config: on(), env: {}, context: { patientId: "p" } });
  // Either nothing can run, or something else was configured - but never Gemini.
  if (d.ok) assert.notEqual(d.model.provider, "gemini");
  else assert.ok(["no_model", "no_phi_approved_model"].includes(d.code), d.code);
});

test("10. a hospital may narrow the registry to exclude Gemini, and cannot widen it", () => {
  const narrowed = route({ task: TASK.SUMMARISE, phi: true, env: envWithKey, context: { patientId: "p" },
    config: on({ models: ["hospital-local"] }) });
  assert.equal(narrowed.ok, false, "Gemini was excluded by configuration and nothing replaced it");
  const invented = route({ task: TASK.SUMMARISE, phi: true, prefer: "gemini-ultra-9", env: envWithKey,
    context: { patientId: "p" }, config: on({ models: ["gemini-ultra-9"] }) });
  assert.equal(invented.ok, false, "a model the registry does not declare cannot be reached by naming it");
});

/* ---- 11: what a blocked or truncated answer must look like ------------------------------------------ */

test("11. a safety-blocked PROMPT is a refusal that says so, never an empty answer", async () => {
  const t = transport({ promptFeedback: { blockReason: "SAFETY" } });
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p", config: on(), env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.detail, /blocked the PROMPT/);
  assert.match(r.detail, /SAFETY/);
  assert.match(r.detail, /Nothing was generated/);
});

test("12. a truncated or filtered answer says which, so silence is never read as 'nothing to report'", async () => {
  const t = transport({ candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] });
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p", config: on(), env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.detail, /MAX_TOKENS/);
  assert.match(r.detail, /cut off or filtered, not empty of findings/);
});

test("13. rate limiting and permission errors keep their API error class for diagnosis", async () => {
  for (const [status, cls] of [[429, "RESOURCE_EXHAUSTED"], [403, "PERMISSION_DENIED"]]) {
    const t = transport({ error: { status: cls, message: "quota" } }, { status });
    const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p", config: on(), env: envWithKey,
      context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.detail, new RegExp(cls));
  }
});

/* ---- 14: what is recorded about an answer ---------------------------------------------------------- */

test("14. the SERVED model version and the token usage are what get reported back", async () => {
  const t = transport(answer("A grounded summary."));
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p", config: on(), env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.model.provider, "gemini");
  assert.equal(r.model.model, "gemini-3.6-flash");
  assert.equal(r.model.version, "gemini-3.6-flash-002", "the served version, not the pointer that was asked for");
  assert.equal(r.generated, true);
  assert.deepEqual(r.usage, { in: 412, out: 88, total: 500, thoughts: null, trafficType: null },
    "AI Studio reports no reasoning-token count or traffic type, and null says so rather than zero");
  assert.ok(Number.isFinite(r.latencyMs));
  assert.equal(r.routedTo, "gemini-flash");
});

test("15. the adapter receives the governed prompt and adds nothing of its own to it", async () => {
  const t = transport(answer("ok"));
  await invoke({ task: TASK.SUMMARISE, phi: true, system: "SYS", prompt: "GOVERNED PROMPT",
    config: on(), env: envWithKey, context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  const body = t.seen[0].body;
  assert.equal(body.contents[0].parts[0].text, "GOVERNED PROMPT", "verbatim: the fence is built upstream");
  assert.equal(body.systemInstruction.parts[0].text, "SYS");
  assert.equal(body.generationConfig.temperature, 0, "an evaluation and a clinical read both need determinism");
});

/* ---- 16: the configuration report ------------------------------------------------------------------- */

test("16. maikStatus reports configuration WITHOUT the secret or any fingerprint of it", () => {
  const st = maikStatus(envWithKey, on());
  const blob = JSON.stringify(st);
  assert.ok(!blob.includes(KEY), "the key itself must never appear");
  assert.ok(!blob.includes(KEY.slice(0, 8)), "nor any prefix of it");
  assert.ok(!/[a-f0-9]{16,}/i.test(blob), "nor a hash that could be compared offline");

  const gem = st.providers.find((p) => p.provider === "gemini");
  assert.equal(gem.configured, true);
  assert.equal(gem.credentialSource, "GEMINI_API_KEY (environment binding)");

  // Absent key: the report says what to set, and still leaks nothing.
  const off = maikStatus({}, on());
  const offGem = off.providers.find((p) => p.provider === "gemini");
  if (!geminiKey({})) {
    assert.equal(offGem.configured, false);
    assert.match(offGem.detail, /no GEMINI_API_KEY is set/);
  }
});

test("17. maikStatus separates 'reachable' from 'may receive patient data'", () => {
  const st = maikStatus(envWithKey, { enabled: true, phiApproved: [] });
  const flash = st.models.find((m) => m.id === "gemini-flash");
  assert.equal(flash.available, true, "a key is present, so it can be reached");
  assert.equal(flash.phiApproved, false, "and it still may not receive patient data");
  assert.match(st.note, /configuration is not approval|Whether patient data may be sent/i);
  // The deterministic assembler is the one thing PHI-safe by construction, and says so.
  assert.equal(st.models.find((m) => m.id === "wardsynq-deterministic").phiApproved, true);
});

test("18. the registry declares Gemini as CLOUD, which is what makes the ranking honest", () => {
  const ids = MODELS.filter((m) => m.provider === "gemini");
  assert.equal(ids.length, 2);
  for (const m of ids) assert.equal(m.locality, "cloud", "somebody else's computer, and ranked accordingly");
  assert.ok(PROVIDERS.gemini && typeof PROVIDERS.gemini.generate === "function");
});


/* ---- 19: Vertex AI is a SEPARATE provider, not a flag on the one above ------------------------------ */

test("19. Vertex and AI Studio are different providers, and approving one does not approve the other", async () => {
  const t = transport(answer("x"));
  /* A hospital that named "gemini" has approved AI Studio. Vertex bills a different account, under a
   * different agreement, and must not be reachable on the strength of that approval. */
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prefer: "vertex-flash", prompt: "p",
    config: { enabled: true, phiApproved: ["gemini"] }, env: envWithKey, context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.code, "no_phi_approved_model");
  assert.equal(t.seen.length, 0, "and nothing was sent");
});

test("20. the Vertex adapter uses the express publisher path: no project, no region, no OAuth", async () => {
  const t = transport(answer("A summary."));
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p",
    config: { enabled: true, phiApproved: ["vertex"], models: ["vertex-flash"] }, env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.equal(r.ok, true, JSON.stringify(r));
  const call = t.seen[0];
  assert.match(call.url, /^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/gemini-3\.6-flash:generateContent$/);
  assert.ok(!/\/projects\//.test(call.url), "the project-path endpoint needs an OAuth bearer token, which this adapter does not have");
  assert.ok(!/locations/.test(call.url), "express mode is not regionally pinned");
  assert.equal(call.headers["x-goog-api-key"], KEY);
  assert.ok(!call.headers.Authorization, "no bearer token: this path is deliberately not the ADC path");
  assert.equal(r.model.provider, "vertex");
  assert.equal(r.routedTo, "vertex-flash");
});

test("21. Vertex's own usage fields survive, because reasoning tokens are billed and invisible", async () => {
  const t = transport(answer("x", { usageMetadata: {
    promptTokenCount: 500, candidatesTokenCount: 20, totalTokenCount: 620,
    thoughtsTokenCount: 100, trafficType: "ON_DEMAND" } }));
  const r = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p",
    config: { enabled: true, phiApproved: ["vertex"], models: ["vertex-flash"] }, env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.deepEqual(r.usage, { in: 500, out: 20, total: 620, thoughts: 100, trafficType: "ON_DEMAND" });
  /* The point of keeping `thoughts`: 20 output tokens looks cheap and 100 reasoning tokens is the
   * actual bill, so a cost figure taken from output length alone would be wrong by 5x here. */
  assert.ok(r.usage.total > r.usage.in + r.usage.out, "the total exceeds in+out precisely because of reasoning tokens");
});

test("22. an error names WHICH Google surface refused, because two separate services can both refuse", async () => {
  const t = transport({ error: { status: "RESOURCE_EXHAUSTED", message: "credits depleted" } }, { status: 429 });
  const vertex = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p",
    config: { enabled: true, phiApproved: ["vertex"], models: ["vertex-flash"] }, env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.match(vertex.detail, /Vertex AI express mode/);
  assert.match(vertex.detail, /aiplatform\.googleapis\.com/);

  const studio = await invoke({ task: TASK.SUMMARISE, phi: true, prompt: "p",
    config: { enabled: true, phiApproved: ["gemini"], models: ["gemini-flash"] }, env: envWithKey,
    context: { patientId: "pat-1" }, fetchImpl: t.fetchImpl });
  assert.match(studio.detail, /AI Studio/);
  assert.match(studio.detail, /generativelanguage\.googleapis\.com/);
});

test("23. maikStatus distinguishes the two surfaces and still exposes no secret", () => {
  const st = maikStatus(envWithKey, { enabled: true, phiApproved: ["vertex"] });
  const blob = JSON.stringify(st);
  assert.ok(!blob.includes(KEY) && !blob.includes(KEY.slice(0, 8)));
  const v = st.providers.find((p) => p.provider === "vertex");
  const g = st.providers.find((p) => p.provider === "gemini");
  assert.match(v.surface, /aiplatform\.googleapis\.com/);
  assert.match(g.surface, /generativelanguage\.googleapis\.com/);
  assert.match(v.detail, /no service account, no ADC and no region/);
  // Approval is per provider, and the report shows that the unapproved one is still unapproved.
  assert.equal(st.models.find((m) => m.id === "vertex-flash").phiApproved, true);
  assert.equal(st.models.find((m) => m.id === "gemini-flash").phiApproved, false);
});
