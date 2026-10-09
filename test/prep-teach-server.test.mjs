/* prep-teach-server.test.mjs - POST /api/ai/prep-teach (PrepNucleus "Ask MaiK online"), pure helpers plus the real
 * /api/ai router with a mocked Vertex generateContent, in-memory KV and D1. Never calls a real provider.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-teach-server.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const CLAIMS = {};
for (const u of ["a", "b", "c", "d", "e"]) CLAIMS["tok-" + u] = { sub: "u-" + u, email: u + "@example.com", email_verified: true };
const realAuth = await import("../functions/_fbauth.js");
const claimsOf = (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null;
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => claimsOf(req), cfAccessEmail: async () => "", identify: async (req) => { const c = claimsOf(req); return c ? "fb:" + c.sub : null; } } });

const { onRequest } = await import("../functions/api/ai/[[path]].js");
const T = await import("../functions/api/ai/_prep-teach.js");
const { istDay } = await import("../functions/_counters.js");
const { inrToMt } = await import("../functions/_credits.js");
const PURE = createRequire(import.meta.url)("../prep-teacher.js");
const DAY = istDay(Date.now());

function fakeKv() {
  const m = new Map();
  return {
    m,
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
function fakeD1() {
  const counters = new Map(), cost = new Map();
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (/INSERT INTO ai_counters/.test(sql)) { const k = args[0] + "|" + args[1]; counters.set(k, (counters.get(k) || 0) + Number(args[2])); }
      else if (/INSERT INTO ai_cost_daily/.test(sql)) cost.set(args[0], (cost.get(args[0]) || 0) + Number(args[1]));
      return { success: true };
    },
    first: async () => (/FROM ai_cost_daily/.test(sql) ? (cost.has(args[0]) ? { cost_paise: cost.get(args[0]) } : null) : null),
    all: async () => ({ results: [] }),
  });
  return { counters, cost, prepare: (sql) => stmt(sql, []), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

let calls = [], reply = () => "Option B is correct because the grounding says so. Option A is wrong.";
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.indexOf("generateContent") >= 0) {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const r = await reply(body, init);
    if (r && typeof r === "object") return new Response(JSON.stringify(r));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: r }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 120, thoughtsTokenCount: 0 } }));
  }
  return new Response("{}");
};
process.on("exit", () => { globalThis.fetch = realFetch; });

const envFor = (extra) => Object.assign({ VERTEX_API_KEY: "vk-test", GEMINI_API_KEY: "dev-test", AI_PROVIDER: "developer", MAIK_KV: fakeKv(), UPDATES_DB: fakeD1(), MAIK_ENFORCE_CAPS: "1", MAIK_RATE_LIMIT_SECONDS: "0.001" }, extra || {});
async function post(env, body, opts) {
  const o = opts || {};
  const headers = { "Content-Type": "application/json" };
  if (o.token !== null) headers.Authorization = "Bearer " + (o.token || "tok-a"); else headers.Origin = "https://stewardmd.in";
  const req = new Request("https://stewardmd.in/api/ai/prep-teach", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const waits = [];
  const r = await onRequest({ request: req, env, params: { path: ["prep-teach"] }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  await new Promise((res) => setTimeout(res, 5));
  return { status: r.status, json: await r.json(), replay: r.headers.get("X-Prep-Replay") };
}
const GROUND = "Question: Which drug is first line?\nA. X\nB. Y\nCorrect answer: B. Y\nExplanation: Y is first line for this condition.";
const mcq = (extra) => Object.assign({ kind: "mcq", ground: GROUND, key: 1, chosen: 0 }, extra || {});
const noAI = (o) => assert.equal(/\bAI\b/.test(JSON.stringify(o)), false, JSON.stringify(o));
const recs = (env) => [...env.MAIK_KV.m.entries()].filter(([k]) => k.startsWith("aiu:mod:") && k.includes(":prep_tutor:"));

/* ---- pure helpers ---- */
test("readTeachRequest: valid mcq and step pass", () => {
  const a = T.readTeachRequest(mcq({ idem: "idem0001" }));
  assert.equal(a.ok, true); assert.deepEqual([a.req.kind, a.req.key, a.req.chosen, a.req.idem], ["mcq", 1, 0, "idem0001"]);
  assert.equal(T.readTeachRequest(mcq({ chosen: -1 })).ok, true);
  const s = T.readTeachRequest({ kind: "step", ground: "Lesson: A\nStep: B", title: "Heart" });
  assert.equal(s.ok, true); assert.equal(s.req.title, "Heart");
});

test("readTeachRequest: bad input names the field", () => {
  const cases = [
    [{ kind: "essay", ground: GROUND }, "kind"], [{ ground: GROUND }, "kind"],
    [mcq({ ground: "   " }), "ground"], [mcq({ ground: undefined }), "ground"], [mcq({ ground: 5 }), "ground"],
    [mcq({ ground: "x".repeat(3601) }), "ground"],
    [mcq({ key: 5 }), "key"], [mcq({ key: -1 }), "key"], [mcq({ key: "1" }), "key"], [mcq({ key: undefined }), "key"],
    [mcq({ chosen: 5 }), "chosen"], [mcq({ chosen: -2 }), "chosen"], [mcq({ chosen: 1.5 }), "chosen"],
    [mcq({ idem: "short" }), "idem"],
    [{ kind: "step", ground: GROUND, title: "t".repeat(201) }, "title"], [{ kind: "step", ground: GROUND, title: 7 }, "title"],
  ];
  for (const [b, reason] of cases) { const r = T.readTeachRequest(b); assert.equal(r.ok, false, reason); assert.equal(r.status, 400); assert.equal(r.reason, reason); }
  assert.equal(T.readTeachRequest(mcq({ ground: "x".repeat(3600) })).ok, true);
  assert.equal(T.readTeachRequest(null).ok, false);
});

test("readTeachRequest: ground and title are scrubbed", () => {
  const r = T.readTeachRequest({ kind: "step", ground: "Call me on 9876543210 or mail doc@example.com now", title: "Mail doc@example.com" });
  assert.equal(r.ok, true);
  assert.equal(/9876543210|doc@example\.com/.test(r.req.ground + r.req.title), false, r.req.ground);
});

test("buildTeachPrompt: wrong vs right task, step task, system prompts equal the client's", () => {
  assert.equal(T.TEACH_SYSTEM, PURE.SYSTEM);
  assert.equal(T.STEP_SYSTEM, PURE.STEP_SYSTEM);
  const w = T.buildTeachPrompt(T.readTeachRequest(mcq({ key: 2, chosen: 0 })).req);
  assert.equal(w.user, "GROUNDING:\n" + GROUND + "\n\nTASK: The student chose A. Explain why A is wrong and why C is the correct answer, using only the grounding.");
  assert.equal(w.system, PURE.SYSTEM);
  for (const chosen of [-1, 2]) {
    const r = T.buildTeachPrompt(T.readTeachRequest(mcq({ key: 2, chosen })).req);
    assert.ok(r.user.endsWith("TASK: Explain why C is the correct answer and why the other options are not, using only the grounding."));
  }
  const s = T.buildTeachPrompt(T.readTeachRequest({ kind: "step", ground: "Lesson: A\nStep: B" }).req);
  assert.equal(s.user, "GROUNDING:\nLesson: A\nStep: B\n\nTASK: Explain this step again in simpler words, using only the grounding.");
  assert.equal(s.system, PURE.STEP_SYSTEM);
  assert.equal(T.TEACH_LIMITS.ground, 3600);
});

/* ---- handler through the real router ---- */
test("guest: 401 sign-in, model not called (router level, Origin stewardmd.in, no auth)", async () => {
  const env = envFor(); calls = [];
  const r = await post(env, mcq(), { token: null });
  assert.equal(r.status, 401); assert.equal(r.json.reason, "sign-in");
  assert.equal(calls.length, 0); noAI(r.json);
});

test("200: text, usage.mt, wallet, one record with feature prep:teach and cost > 0", async () => {
  const env = envFor(); calls = [];
  const r = await post(env, mcq());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.text, /Option B/);
  assert.deepEqual([r.json.usage.inTok, r.json.usage.outTok], [700, 120]);
  assert.ok(r.json.usage.inr > 0); assert.equal(r.json.usage.mt, inrToMt(r.json.usage.inr)); assert.ok(r.json.usage.mt > 0);
  assert.deepEqual(r.json.wallet, { balanceMt: 0, costCapOn: false });
  assert.equal(calls.length, 1);
  const c = calls[0].body;
  assert.equal(c.systemInstruction.parts[0].text, PURE.SYSTEM);
  assert.match(c.contents[0].parts[0].text, /^GROUNDING:\n/);
  assert.equal(recs(env).length, 1); assert.equal(recs(env)[0][1], "1");
  const doc = JSON.parse(env.MAIK_KV.m.get("aiu:doc:em:a@example.com:" + DAY));
  assert.ok(doc.cost > 0, "recorded cost is what the wallet debits");
  assert.ok(env.UPDATES_DB.cost.get(DAY) > 0, "project breaker fed");
  assert.equal(env.MAIK_KV.m.get("maik:u:fb:u-a:" + DAY), undefined, "MaiK token allowance not charged by recordUsage");
  for (const [k, v] of env.MAIK_KV.m) assert.equal(/Which drug is first line/.test(v), false, "student text stored in " + k);
  noAI(r.json);
});

test("step kind uses the step system prompt", async () => {
  const env = envFor(); calls = [];
  const r = await post(env, { kind: "step", ground: "Lesson: Heart\nStep: The SA node paces the heart.", title: "Heart" }, { token: "tok-b" });
  assert.equal(r.status, 200);
  assert.equal(calls[0].body.systemInstruction.parts[0].text, PURE.STEP_SYSTEM);
});

test("ai-cost-cap: after the free MaiK Tokens are spent the next ask is 429 with the sheet fields and no model call", async () => {
  const env = envFor({ AI_COST_CAP_ON: "1", AI_DAILY_COST_CAP_INR: "0.0001" }); calls = [];
  const first = await post(env, mcq(), { token: "tok-c" });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.wallet.costCapOn, true);
  const n = calls.length;
  const r = await post(env, mcq(), { token: "tok-c" });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, "quota"); assert.equal(r.json.reason, "ai-cost-cap");
  assert.equal(typeof r.json.creditsMt, "number"); assert.equal(r.json.creditsMt, 0);
  assert.ok(r.json.resetAt > Date.now()); assert.ok(r.json.usedMt > 0); assert.ok(r.json.capMt >= 0);
  assert.equal(calls.length, n, "model not called");
  assert.equal(recs(env)[0][1], "1", "the refused ask was not recorded");
  noAI(r.json);
});

test("prepaid balance keeps asking working past the free allowance, and the wallet reports it", async () => {
  const env = envFor({ AI_COST_CAP_ON: "1", AI_DAILY_COST_CAP_INR: "0.0001" }); calls = [];
  env.MAIK_KV.m.set("maik:credit:em:d@example.com", JSON.stringify({ balance: 50, day: "", chargedToday: 0 }));
  await post(env, mcq(), { token: "tok-d" });
  const r = await post(env, mcq(), { token: "tok-d" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.wallet.balanceMt > 0 && r.json.wallet.balanceMt < inrToMt(50));
});

test("provider failure: 502 ai-failed/provider, no usage cost, one record with status failed", async () => {
  const env = envFor({ VERTEX_API_KEY: "" }); calls = [];
  const r = await post(env, mcq(), { token: "tok-e" });
  assert.equal(r.status, 502); assert.deepEqual([r.json.error, r.json.reason], ["ai-failed", "provider"]);
  assert.equal(recs(env).length, 1);
  const doc = JSON.parse(env.MAIK_KV.m.get("aiu:doc:em:e@example.com:" + DAY));
  assert.equal(doc.fail, 1);
  noAI(r.json);
});

test("empty model text: 502 ai-failed/empty, still recorded once as failed", async () => {
  const env = envFor(); calls = []; const old = reply; reply = () => "   ";
  const r = await post(env, mcq());
  reply = old;
  assert.equal(r.status, 502); assert.deepEqual([r.json.error, r.json.reason], ["ai-failed", "empty"]);
  assert.equal(recs(env)[0][1], "1");
  assert.equal(JSON.parse(env.MAIK_KV.m.get("aiu:doc:em:a@example.com:" + DAY)).fail, 1);
});

test("timeout: 504 ai-timeout", async () => {
  const env = envFor({ MAIK_AI_TIMEOUT_MS: "2000", MAIK_AI_DEADLINE_MS: "2500" }); const old = reply;
  reply = (b, init) => new Promise((res, rej) => { init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
  const r = await post(env, mcq());
  reply = old;
  assert.equal(r.status, 504); assert.equal(r.json.error, "ai-timeout");
});

test("bad input 400 and oversize 413 never reach the model", async () => {
  const env = envFor(); calls = [];
  assert.equal((await post(env, mcq({ key: 9 }))).json.reason, "key");
  assert.equal((await post(env, mcq({ ground: "x".repeat(3601) }))).status, 400);
  const big = await post(env, mcq({ pad: "x".repeat(17 * 1024) }));
  assert.equal(big.status, 413); assert.equal(big.json.error, "too-large");
  assert.equal(calls.length, 0);
});

test("idempotent replay: same idem and body returns the sealed answer free, with X-Prep-Replay", async () => {
  const env = envFor(); calls = [];
  const b = mcq({ idem: "idem-replay-1" });
  const one = await post(env, b), two = await post(env, b);
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.equal(two.replay, "1"); assert.equal(two.json.text, one.json.text);
  assert.equal(calls.length, 1); assert.equal(recs(env)[0][1], "1");
  assert.equal(/Option B/.test([...env.MAIK_KV.m.values()].filter((v, i) => [...env.MAIK_KV.m.keys()][i].startsWith("prep:teach:idem:")).join("")), false, "sealed");
});

test("emergency pause: 503 paused with MaiK wording, no model call", async () => {
  const env = envFor(); calls = [];
  env.MAIK_KV.m.set("ai:emergency", JSON.stringify({ mode: "pause" }));
  // The router caches the emergency mode per isolate, so use a fresh router instance for this one.
  const fresh = await import("../functions/api/ai/[[path]].js?pause");
  const req = new Request("https://stewardmd.in/api/ai/prep-teach", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer tok-a" }, body: JSON.stringify(mcq()) });
  const res = await fresh.onRequest({ request: req, env, params: { path: ["prep-teach"] }, waitUntil: () => {} });
  const r = { status: res.status, json: await res.json() };
  assert.equal(r.status, 503); assert.equal(r.json.reason, "paused");
  assert.equal(r.json.message, "Ask MaiK online is paused for a short while. The stored explanation is above.");
  assert.equal(calls.length, 0); noAI(r.json);
});

/* ---- chat follow-ups (Ask MaiK as a short chat, owner 2026-10-09 evening) ---- */
const chat = (extra) => Object.assign({ kind: "chat", base: "mcq", ground: GROUND, turn: 2, messages: [{ r: "u", t: "Why is A wrong?" }, { r: "m", t: "Y is first line." }, { r: "u", t: "And X?" }] }, extra || {});
const msgs = (n, len) => Array.from({ length: n }, (_, i) => ({ r: i % 2 ? "m" : "u", t: "x".repeat(len || 10) })).concat([{ r: "u", t: "last?" }]);

test("readTeachRequest chat: valid, scrubbed, summary kept", () => {
  const r = T.readTeachRequest(chat({ summary: "Earlier: asked about X.", idem: "ck-chat-0001" }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.req.kind, r.req.base, r.req.turn, r.req.messages.length, r.req.summary], ["chat", "mcq", 2, 3, "Earlier: asked about X."]);
  const s = T.readTeachRequest(chat({ base: "step", messages: [{ r: "u", t: "Call 9876543210 or doc@example.com?" }], summary: "mail doc@example.com" }));
  assert.equal(s.ok, true);
  assert.equal(/9876543210|doc@example\.com/.test(JSON.stringify(s.req)), false, JSON.stringify(s.req));
});

test("readTeachRequest chat: the messages array and its size limits", () => {
  const L = T.CHAT_LIMITS;
  assert.deepEqual([L.msgs, L.user, L.model, L.total, L.summary, L.turns], [8, 400, 1200, 4000, 800, 10]);
  const cases = [
    [chat({ base: "essay" }), "base", 400], [chat({ base: undefined }), "base", 400],
    [chat({ turn: 0 }), "turn", 400], [chat({ turn: "2" }), "turn", 400], [chat({ turn: undefined }), "turn", 400],
    [chat({ turn: 11 }), "turns", 400],
    [chat({ messages: [] }), "messages", 400], [chat({ messages: "x" }), "messages", 400], [chat({ messages: undefined }), "messages", 400],
    [chat({ messages: msgs(8) }), "messages", 413],
    [chat({ messages: [{ r: "u", t: "x".repeat(401) }] }), "message", 413],
    [chat({ messages: [{ r: "m", t: "x".repeat(1201) }, { r: "u", t: "q" }] }), "message", 413],
    [chat({ messages: [{ r: "u", t: "x".repeat(400) }, { r: "m", t: "x".repeat(1200) }, { r: "u", t: "x".repeat(400) }, { r: "m", t: "x".repeat(1200) }, { r: "u", t: "x".repeat(400) }, { r: "m", t: "x".repeat(1200) }, { r: "u", t: "q" }] }), "messages", 413],
    [chat({ messages: [{ r: "u", t: "q" }, { r: "m", t: "a" }] }), "messages", 400],
    [chat({ messages: [{ r: "x", t: "q" }] }), "messages", 400], [chat({ messages: [{ r: "u", t: 5 }] }), "messages", 400], [chat({ messages: [null] }), "messages", 400],
    [chat({ messages: [{ r: "u", t: "   " }] }), "messages", 400],
    [chat({ summary: "s".repeat(801) }), "summary", 413], [chat({ summary: 5 }), "summary", 400],
    [chat({ ground: "" }), "ground", 400],
  ];
  for (const [b, reason, status] of cases) { const r = T.readTeachRequest(b); assert.equal(r.ok, false, reason + " " + JSON.stringify(b).slice(0, 80)); assert.equal(r.reason, reason, JSON.stringify(r)); assert.equal(r.status, status, reason); }
  assert.equal(T.readTeachRequest(chat({ turn: 10, messages: msgs(6, 100) })).ok, true, "10th message, 7 sent, within the caps");
});

test("buildTeachPrompt chat: the chat system prompt, the lines in order, the summary block only when sent", () => {
  const p = T.buildTeachPrompt(T.readTeachRequest(chat({ summary: "Asked about X." })).req);
  assert.equal(p.system, T.CHAT_SYSTEM); assert.equal(p.system, PURE.CHAT_SYSTEM);
  assert.equal(p.maxOut, T.CHAT_LIMITS.maxOut);
  assert.equal(p.user, "GROUNDING:\n" + GROUND + "\n\nEARLIER IN THIS CHAT (summary):\nAsked about X.\n\nCHAT:\nStudent: Why is A wrong?\nMaiK: Y is first line.\nStudent: And X?\n\nTASK: Answer the student's last message using only the grounding.");
  assert.equal(T.buildTeachPrompt(T.readTeachRequest(chat()).req).user.indexOf("EARLIER"), -1);
});

test("chat: guest 401 sign-in, model not called", async () => {
  const env = envFor(); calls = [];
  const r = await post(env, chat(), { token: null });
  assert.equal(r.status, 401); assert.equal(r.json.reason, "sign-in");
  assert.equal(calls.length, 0); noAI(r.json);
});

test("chat: 200 with MaiK Tokens, one usage record per call, the chat counter, nothing stored", async () => {
  const env = envFor(); calls = [];
  const one = await post(env, chat({ messages: [{ r: "u", t: "Why is A wrong?" }] , turn: 1 }));
  const two = await post(env, chat());
  for (const r of [one, two]) {
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.usage.mt > 0 && r.json.usage.mt === inrToMt(r.json.usage.inr));
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.systemInstruction.parts[0].text, PURE.CHAT_SYSTEM);
  assert.match(calls[1].body.contents[0].parts[0].text, /\nCHAT:\nStudent: Why is A wrong\?\nMaiK: Y is first line\.\nStudent: And X\?\n\nTASK: /);
  assert.equal(recs(env).length, 1); assert.equal(recs(env)[0][1], "2", "one usage record per model call");
  assert.equal(env.UPDATES_DB.counters.get(DAY + "|prep.teach.chat"), 2);
  assert.equal(env.UPDATES_DB.counters.get(DAY + "|prep.teach.calls"), 2);
  for (const [k, v] of env.MAIK_KV.m) assert.equal(/Why is A wrong|And X\?/.test(v), false, "student text stored in " + k);
  noAI(two.json);
});

test("chat: turn 11, too many messages and oversize never reach the model", async () => {
  const env = envFor(); calls = [];
  assert.deepEqual([(await post(env, chat({ turn: 11 }))).json.reason], ["turns"]);
  const r = await post(env, chat({ messages: msgs(8) }));
  assert.equal(r.status, 413); assert.equal(r.json.error, "too-large");
  assert.equal((await post(env, chat({ summary: "s".repeat(801) }))).status, 413);
  assert.equal(calls.length, 0);
  assert.equal(recs(env).length, 0, "nothing metered");
});

test("chat: idempotent replay is free", async () => {
  const env = envFor(); calls = [];
  const b = chat({ idem: "ck-replay-0001" });
  const one = await post(env, b), two = await post(env, b);
  assert.equal(two.replay, "1"); assert.equal(two.json.text, one.json.text);
  assert.equal(calls.length, 1); assert.equal(recs(env)[0][1], "1");
});
