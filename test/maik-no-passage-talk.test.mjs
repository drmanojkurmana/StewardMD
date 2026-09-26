/* maik-no-passage-talk.test.mjs - MaiK Cloud never talks to the doctor about its retrieved material.
 *
 * Owner, 2026-09-26: "wont the user think we are using rag or sending rag? why is agent tell the
 * passage yu sent is irrelavant? and let agent answer only." The retrieved Knowledge Base text is now
 * framed as the model's own private notes, and the final text is scrubbed on every /explain exit
 * (whole answer, whole answer over SSE, live stream, cache hit). Drives the real onRequest(). */
import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const { KNOWLEDGE_SYS, RAG_SYS, TUTOR_SYS, ABSTAIN_RULE, onRequest } = M;

test("no prompt tells the model it was PROVIDED material, or to say when it used its own knowledge", () => {
  for (const [name, p] of Object.entries({ KNOWLEDGE_SYS, RAG_SYS, TUTOR_SYS, ABSTAIN_RULE })) {
    assert.doesNotMatch(p, /RETRIEVED STEWARDMD KNOWLEDGE|provided knowledge|supplied StewardMD|Cite the provided sources|and say so when you do|retrieved text looks thin/i, name);
  }
});

test("the knowledge is framed as the assistant's own private notes, set aside silently when off-topic", () => {
  assert.match(KNOWLEDGE_SYS, /your own private notes/);
  assert.match(KNOWLEDGE_SYS, /cannot see them and never sent them/);
  assert.match(KNOWLEDGE_SYS, /silently set them aside/);
  assert.match(KNOWLEDGE_SYS, /never tell the clinician it was irrelevant/);
  assert.match(KNOWLEDGE_SYS, /NEVER mention your notes/);
  assert.match(KNOWLEDGE_SYS, /never blame missing notes or sources/, "abstention is about the medicine");
  assert.match(RAG_SYS, /They are private: the clinician cannot see them/);
  assert.match(TUTOR_SYS, /your reference notes \(the student never sees them\)/);
  assert.match(ABSTAIN_RULE, /about the medicine and never about your notes/);
  // the safety rules the fix must not have dropped
  for (const rule of ["verify locally", "DOSING", "high-alert", "STAY ON TOPIC", "Never use patient identifiers"]) assert.ok(KNOWLEDGE_SYS.includes(rule), "dropped: " + rule);
});

/* ---- the real handler, stubbed upstream ---- */
const Q = "RA factor positive with raised CRP and ESR, what next?";
const OFFTOPIC = { question: Q, grounding: [{ diseaseId: "f12", name: "Factor XII deficiency", knowledge: [{ section: "overview", text: "Prolonged aPTT without bleeding, found incidentally.", source: { ref: "Harrison 22e" } }], provenance: ["Harrison 22e"] }], sources: [{ n: 1, title: "Standard internal-medicine reference" }] };
const META = "**You're asking about next steps after a positive RF.**\n" +
  "- Order ANA and anti-CCP [1].\n" +
  "- The provided StewardMD knowledge focuses on Factor XII deficiency [1]. This is not directly relevant to the patient's presentation.\n" +
  "@@REFINE: joint symptoms | age | sicca symptoms@@";
const CLEAN = "**You're asking about next steps after a positive RF.**\n- Order ANA and anti-CCP [1].\n@@REFINE: joint symptoms | age | sicca symptoms@@";

function fakeKv() {
  const m = new Map();
  return {
    _m: m,
    get: async (k, type) => { if (!m.has(k)) return null; const raw = m.get(k); const t = typeof type === "string" ? type : (type && type.type); if (t === "json") { try { return JSON.parse(raw); } catch (e) { return null; } } return raw; },
    put: async (k, v) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { m.delete(k); },
    list: async (o) => ({ keys: [...m.keys()].filter((k) => !(o && o.prefix) || k.startsWith(o.prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
// bytes > 0: the network read boundaries fall mid-frame (every `bytes` bytes) instead of per frame.
function upstreamSse(text, bytes) {
  const frames = text.match(/.{1,11}/gs).map((t) => "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) + "\r\n\r\n");
  const reads = bytes ? frames.join("").match(new RegExp("[\\s\\S]{1," + bytes + "}", "g")) : frames;
  return new ReadableStream({ start(c) { const e = new TextEncoder(); reads.forEach((f) => c.enqueue(e.encode(f))); c.close(); } });
}
let READ_BYTES = 0;
async function explain(env, body, { stream = false, answer = META } = {}) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    u = String(u && u.url ? u.url : u);
    if (u.indexOf("streamGenerateContent") >= 0) { sent.push(JSON.parse(init.body)); return new Response(upstreamSse(answer, READ_BYTES), { status: 200, headers: { "content-type": "text/event-stream" } }); }
    if (u.indexOf("generateContent") >= 0) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] }, finishReason: "STOP" }] })); }
    return new Response("{}");
  };
  const waits = [];
  try {
    const headers = { "Content-Type": "application/json" };
    if (stream) headers.Accept = "text/event-stream";
    const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/explain" + (stream ? "?stream=1" : ""), { method: "POST", headers, body: JSON.stringify(body) }), env: Object.assign({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k" }, env), params: { path: ["explain"] }, waitUntil: (p) => waits.push(p) });
    const raw = await r.text();
    await Promise.allSettled(waits);
    const text = stream ? raw.split("\n").filter((l) => l.indexOf("data:") === 0).map((l) => { try { return JSON.parse(l.slice(5)).delta || ""; } catch (e) { return ""; } }).join("") : JSON.parse(raw).text;
    return { text, sent };
  } finally { globalThis.fetch = real; }
}

test("user turn: the KB block is headed as private notes; empty engine/patient/notes headers are gone", async () => {
  const { sent } = await explain({ MAIK_ABSTAIN: "1" }, OFFTOPIC);
  const user = sent[0].contents[0].parts[0].text, sys = sent[0].systemInstruction.parts[0].text;
  assert.match(user, /=== YOUR REFERENCE NOTES \(private StewardMD Knowledge Base notes; the clinician cannot see them/);
  assert.doesNotMatch(user, /RETRIEVED STEWARDMD KNOWLEDGE|PRIMARY SOURCE|retrieved chunks/);
  assert.doesNotMatch(user, /DETERMINISTIC ENGINE OUTPUT|PATIENT \(de-identified\)/, "no differential, no patient: no empty headers");
  assert.match(sys, /CITE-OR-ABSTAIN: mark each claim that rests on your notes/);
  assert.doesNotMatch(sys, /supplied StewardMD knowledge/);
  const none = await explain({}, { question: Q, grounding: [], retrieved: [], topicMatch: { matched: false, mode: "none" } });
  assert.doesNotMatch(none.sent[0].contents[0].parts[0].text, /REFERENCE NOTES/, "nothing retrieved: no notes header to talk about");
});

test("a case with a differential still gets the engine and patient blocks", async () => {
  const { sent } = await explain({}, Object.assign({}, OFFTOPIC, { reasoning: { differential: [{ name: "Rheumatoid arthritis", class: "non_infective", confidence: 60 }] }, patientCase: { age: 50 } }));
  const user = sent[0].contents[0].parts[0].text;
  assert.match(user, /=== DETERMINISTIC ENGINE OUTPUT/);
  assert.match(user, /=== PATIENT \(de-identified\) ===\nage 50/);
});

test("whole answer (JSON): the meta sentence and its 'This is not relevant' follow-on are removed", async () => {
  const { text } = await explain({}, OFFTOPIC);
  assert.equal(text, CLEAN);
});

test("whole answer over SSE (stream=1, live streaming off): scrubbed", async () => {
  const { text } = await explain({}, OFFTOPIC, { stream: true });
  assert.equal(text, CLEAN);
});

test("live stream (MAIK_LIVE_STREAM=1): scrubbed across chunk boundaries, and the cache stores the clean text", async () => {
  const kv = fakeKv();
  const { text, sent } = await explain({ MAIK_LIVE_STREAM: "1", MAIK_ANSWER_CACHE: "1", MAIK_KV: kv }, OFFTOPIC, { stream: true });
  assert.ok(sent.length === 1 && sent[0].contents, "went through the live upstream");
  assert.equal(text, CLEAN);
  const cached = [...kv._m.entries()].filter(([k]) => k.startsWith("maik:ans:"));
  assert.equal(cached.length, 1, "one answer cached");
  assert.equal(JSON.parse(cached[0][1]).text, CLEAN);
});

test("live stream: network reads that end mid-frame still reach the end (a pull that sends nothing used to hang)", async () => {
  READ_BYTES = 7;
  try {
    const { text } = await explain({ MAIK_LIVE_STREAM: "1" }, OFFTOPIC, { stream: true });
    assert.equal(text, CLEAN);
  } finally { READ_BYTES = 0; }
});

test("cache hit: an answer cached BEFORE the fix is scrubbed on the way out", async () => {
  const kv = fakeKv();
  await explain({ MAIK_ANSWER_CACHE: "1", MAIK_KV: kv }, OFFTOPIC);
  const key = [...kv._m.keys()].find((k) => k.startsWith("maik:ans:"));
  assert.ok(key, "first call cached");
  kv._m.set(key, JSON.stringify({ text: META, ts: Date.now() }));   // what an old entry looks like
  const hit = await explain({ MAIK_ANSWER_CACHE: "1", MAIK_KV: kv }, OFFTOPIC, { answer: "SHOULD NOT BE CALLED" });
  assert.equal(hit.sent.length, 0, "served from cache");
  assert.equal(hit.text, CLEAN);
});

/* The Knowledge Base text goes out once (2026-09-26). With smd_maik_brain on, the client cuts ranked
 * claims out of the same grounding notes the prompt already carries, and both used to be sent. */
test("send once: a claim made only of the notes is not repeated above them; a guideline claim still is", async () => {
  const note = OFFTOPIC.grounding[0].knowledge[0].text;
  const kbClaim = { text: note, tier: 1, sources: [{ source: "kb", tier: 1, ref: "StewardMD KB · Factor XII deficiency" }] };
  const glClaim = { text: "Line 1: tranexamic acid 1 g IV", tier: 3, sources: [{ source: "guideline", tier: 3, ref: "ISTH (2020)" }] };
  const both = await explain({}, Object.assign({}, OFFTOPIC, { evidenceBundle: { claims: [kbClaim, glClaim] } }));
  const user = both.sent[0].contents[0].parts[0].text;
  assert.equal(user.split(note).length - 1, 1, "the note text appears exactly once");
  assert.match(user, /RANKED REFERENCE NOTES[^\n]*\n1\. \[tier 3\] Line 1: tranexamic acid 1 g IV\n\n/, "the claim the notes do not carry is still ranked, alone");
  const kbOnly = await explain({}, Object.assign({}, OFFTOPIC, { evidenceBundle: { claims: [kbClaim] } }));
  const u2 = kbOnly.sent[0].contents[0].parts[0].text;
  assert.doesNotMatch(u2, /RANKED REFERENCE NOTES/, "only notes text: no ranked block at all");
  const plain = await explain({}, OFFTOPIC);
  assert.equal(u2, plain.sent[0].contents[0].parts[0].text, "the same prompt a client without the brain flag sends");
});
