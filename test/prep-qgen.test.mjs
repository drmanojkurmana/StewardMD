/* prep-qgen.test.mjs - PrepNucleus "Create a module with MaiK": the engine (functions/_prep-qgen.js) and the real
 * /api/ai/prep-qgen route with a MOCKED Anthropic API (ANTHROPIC_BASE_URL), in-memory KV, D1 and R2. No real call.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-qgen.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const OWNER = "drmanojkurmana@gmail.com";
const CLAIMS = { "tok-a": { sub: "u-a", email: "a@example.com", email_verified: true }, "tok-b": { sub: "u-b", email: "b@example.com", email_verified: true }, "tok-o": { sub: "u-o", email: OWNER, email_verified: true } };
const realAuth = await import("../functions/_fbauth.js");
const claimsOf = (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null;
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => claimsOf(req), cfAccessEmail: async () => "", identify: async (req) => { const c = claimsOf(req); return c ? "fb:" + c.sub : null; } } });

const { onRequest } = await import("../functions/api/ai/[[path]].js");
const E = await import("../functions/_prep-qgen.js");

const KEY = "sk-ant-test-SECRET-0123456789abcdef", WS = "wrkspc_test_123", BASE = "https://mock.anthropic.test";
function fakeKv() {
  const m = new Map();
  return { m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); },
    list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
}
function fakeD1() {
  const stmt = (sql, args) => ({ bind: (...a) => stmt(sql, a), run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) });
  return { prepare: (sql) => stmt(sql, []), batch: async (l) => Promise.all(l.map((s) => s.run())) };
}
function fakeR2(files) {
  const m = new Map(Object.entries(files || {}));
  return { m, get: async (k) => (m.has(k) ? { text: async () => m.get(k) } : null), put: async (k, v) => { m.set(k, String(v)); } };
}

// ---- the mocked Anthropic API ----
const STEMS = ["", "A 30 year old has symptom pattern number 1 of a classic condition. Which drug is first line here?",
  "Which enzyme deficiency explains recurrent neonatal jaundice with dark urine in this infant?",
  "During surgery the anaesthetist notes falling saturation and rising airway pressure; what is the likeliest cause?",
  "Name the nerve injured when a fractured humeral shaft causes wrist drop after a fall.",
  "Which investigation best confirms pulmonary embolism in a stable pregnant woman with dyspnoea?",
  "What staining pattern on biopsy suggests membranous nephropathy in adult nephrotic syndrome?"];
const GOOD = (i, extra) => Object.assign({
  st: STEMS[i] || "Distinct stem " + i + " about an unrelated organ system and finding?",
  key: { ot: "Drug alpha" + i, wr: "First line for this pattern in the source." },
  dis: [{ ot: "Drug beta" + i, wr: "Second line only.", et: "mgmt" }, { ot: "Drug gamma" + i, wr: "Contraindicated here.", et: "knowledge" }, { ot: "Drug delta" + i, wr: "Used for another condition.", et: "confused" }],
  ex: "The first line choice follows from the mechanism and safety profile.", kp: "Remember the first line drug.", dl: 2, cog: "application", tags: ["pharmacology"],
}, extra || {});
let calls = [], genReply = null, verReply = null, batchState = {};
const usage = (i, o) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens_details: { thinking_tokens: 50 } });
function msg(model, obj, u, stop) { return { id: "msg_1", type: "message", model, stop_reason: stop || "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(obj) }], usage: u || usage(1000, 1500) }; }
function defaultGen(body) {
  const n = Number(/Write (\d+) questions/.exec(JSON.stringify(body.messages))[1]);
  return msg(body.model, { q: Array.from({ length: n }, (_, i) => GOOD(i + 1)) });
}
// the verifier answers with the true key (it sees options in shuffled order: find "Drug alpha")
function defaultVer(body) {
  const txt = body.messages[0].content.map((c) => c.text).join("\n");
  const qs = txt.split(/\nQ\d+: /).slice(1);
  const v = qs.map((q, i) => { const lines = q.split("\n"); const k = lines.findIndex((l) => /^[A-D]\. Drug alpha/.test(l)); return { i, pick: "ABCD"[k - 1] || "A", multi: false, wrong: false, outdated: false, unsupported: false, note: "" }; });
  return msg(body.model, { v }, usage(800, 300));
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.indexOf(BASE) !== 0) return realFetch ? new Response("{}") : null;
  const path = url.slice(BASE.length), h = init.headers || {};
  calls.push({ path, headers: h, body: init.body ? JSON.parse(init.body) : null });
  if (h["x-api-key"] !== KEY) return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key " + h["x-api-key"] } }), { status: 401 });
  if (!h["anthropic-workspace-id"]) return new Response(JSON.stringify({ error: { message: "must include the anthropic-workspace-id header" } }), { status: 400 });
  if (path === "/v1/messages") {
    const body = JSON.parse(init.body);
    const r = body.model === "claude-haiku-5-5" ? (verReply || defaultVer)(body) : (genReply || defaultGen)(body);
    if (r instanceof Response) return r;
    return new Response(JSON.stringify(r));
  }
  if (path === "/v1/messages/batches" && init.method === "POST") {
    const body = JSON.parse(init.body), id = "msgbatch_" + (Object.keys(batchState).length + 1);
    batchState[id] = { reqs: body.requests, polls: 0 };
    return new Response(JSON.stringify({ id, processing_status: "in_progress", request_counts: { processing: body.requests.length } }));
  }
  let m = /^\/v1\/messages\/batches\/(msgbatch_\d+)$/.exec(path);
  if (m) { const b = batchState[m[1]]; b.polls++; return new Response(JSON.stringify({ id: m[1], processing_status: b.polls >= 2 ? "ended" : "in_progress", request_counts: { processing: b.polls >= 2 ? 0 : b.reqs.length, succeeded: b.polls >= 2 ? b.reqs.length : 0 }, results_url: BASE + "/v1/messages/batches/" + m[1] + "/results" })); }
  m = /^\/v1\/messages\/batches\/(msgbatch_\d+)\/results$/.exec(path);
  if (m) {
    const lines = batchState[m[1]].reqs.map((r) => JSON.stringify({ custom_id: r.custom_id, result: { type: "succeeded", message: r.params.model === "claude-haiku-5-5" ? defaultVer(r.params) : defaultGen(r.params) } }));
    return new Response(lines.join("\n"));
  }
  return new Response("{}", { status: 404 });
};
process.on("exit", () => { globalThis.fetch = realFetch; });

const envFor = (extra) => Object.assign({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_WORKSPACE_ID: WS, ANTHROPIC_BASE_URL: BASE, PREP_QGEN_ON: "1", PREP_QGEN_STUDENT: "1",
  MAIK_KV: fakeKv(), UPDATES_DB: fakeD1(), PREP_BANK_R2: fakeR2(), MAIK_ENFORCE_CAPS: "1", MAIK_RATE_LIMIT_SECONDS: "0.001" }, extra || {});
let logs = [];
const origLog = console.log, origErr = console.error, origWarn = console.warn;
console.log = (...a) => { logs.push(a.join(" ")); }; console.error = (...a) => { logs.push(a.join(" ")); }; console.warn = (...a) => { logs.push(a.join(" ")); };
process.on("exit", () => { console.log = origLog; console.error = origErr; console.warn = origWarn; });
async function post(env, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = "Bearer " + (token || "tok-a");
  const req = new Request("https://stewardmd.in/api/ai/prep-qgen", { method: "POST", headers, body: JSON.stringify(body) });
  const waits = [];
  const r = await onRequest({ request: req, env, params: { path: ["prep-qgen"] }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const text = await r.text();
  return { status: r.status, text, json: JSON.parse(text), replay: r.headers.get("X-Prep-Replay") };
}
const GROUND = "Drug alpha1 is first line for this pattern. ".repeat(3) + "The classic condition presents with symptom pattern number 1 in adults aged 30. " + "Drug beta1 is second line. Drug gamma1 is contraindicated. Drug delta1 treats another condition. ".repeat(3);
const gen = (extra) => Object.assign({ op: "gen", mod: "gen_0123456789ab", topic: "First line drugs", exam: "neet-pg", n: 5 }, extra || {});
const noKey = (s) => assert.equal(String(s).indexOf(KEY), -1, "the key leaked");
const reset = () => { calls = []; genReply = null; verReply = null; };

/* ---------------- engine ---------------- */
test("genBody: cached topic+grounding block, structured output, fallbacks only off-batch", () => {
  const cfg = E.qgenConfig(envFor());
  const b = E.genBody({ topic: "T", ground: GROUND, exam: "neet-pg", n: 5, round: 2, avoid: ["Old stem one?"] }, cfg);
  assert.equal(b.model, "claude-sonnet-5-5");
  assert.deepEqual(b.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.match(b.messages[0].content[0].text, /<source>/);
  assert.equal(b.messages[0].content[1].cache_control, undefined);
  assert.match(b.messages[0].content[1].text, /round 2/);
  assert.match(b.messages[0].content[1].text, /Old stem one/);
  assert.equal(b.output_config.format.type, "json_schema");
  assert.equal(b.fallbacks, "default");
  assert.equal(b.temperature, undefined);
  assert.equal(b.thinking, undefined);
  const bb = E.genBody({ topic: "T", exam: "neet-pg", n: 5 }, cfg, { batch: true });
  assert.equal(bb.fallbacks, undefined);
  // the round's prefix is byte-identical across rounds of one module
  const b2 = E.genBody({ topic: "T", ground: GROUND, exam: "neet-pg", n: 5, round: 3 }, cfg);
  assert.equal(JSON.stringify(b2.system) + b2.messages[0].content[0].text, JSON.stringify(b.system) + b.messages[0].content[0].text);
});
test("schema: every object closed, no numeric or length constraints", () => {
  const walk = (s) => { if (s && typeof s === "object") { if (s.type === "object") assert.equal(s.additionalProperties, false); ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].forEach((k) => assert.equal(s[k], undefined, k)); Object.values(s).forEach(walk); } };
  walk(E.GEN_SCHEMA); walk(E.VERIFY_SCHEMA);
});
test("headers: key, version and workspace on every call", () => {
  const h = E.apiHeaders({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_WORKSPACE_ID: WS }, "server-side-fallback-2026-07-01");
  assert.equal(h["x-api-key"], KEY); assert.equal(h["anthropic-version"], "2023-06-01"); assert.equal(h["anthropic-workspace-id"], WS); assert.equal(h["anthropic-beta"], "server-side-fallback-2026-07-01");
});
test("style gates: dash, emoji, all of the above, source names", () => {
  const rq = E.sanitizeGen({ q: [GOOD(1)] })[0];
  assert.equal(E.styleGate(rq), null);
  assert.equal(E.styleGate(Object.assign({}, rq, { st: rq.st + " — or not" })), "dash");
  assert.equal(E.styleGate(Object.assign({}, rq, { ex: "Easy \u{1F600}" })), "emoji");
  assert.equal(E.styleGate(Object.assign({}, rq, { key: { ot: "All of the above", wr: "x" } })), "aota");
  assert.equal(E.styleGate(Object.assign({}, rq, { dis: [{ ot: "Both A and B", wr: "x" }].concat(rq.dis.slice(1)) })), "aota");
  assert.equal(E.styleGate(Object.assign({}, rq, { kp: "As in Harrison's chapter" })), "source");
  assert.equal(E.styleGate(Object.assign({}, rq, { kp: "Bailey and Love says so" })), "source");
  assert.equal(E.styleGate(Object.assign({}, rq, { kp: "Give first aid at once" })), null);
});
test("gateRound: length balance, grounding numbers, duplicates by hash and similarity", () => {
  const rqs = E.sanitizeGen({ q: [GOOD(1), GOOD(2, { key: { ot: "A very much longer key option that gives the answer away clearly", wr: "x" } }), GOOD(3, { key: { ot: "Drug alpha3", wr: "Given at 500 mg" } }), GOOD(1)] });
  const r = E.gateRound(rqs, { ground: GROUND + " Drug alpha2 Drug alpha3" });
  assert.deepEqual(r.rejected.map((x) => x.gate), ["g5", "g9b", "dup"]);
  assert.equal(r.kept.length, 1);
  const r2 = E.gateRound(E.sanitizeGen({ q: [GOOD(5)] }), { prior: [GOOD(5).st.toUpperCase()] });
  assert.deepEqual(r2.rejected.map((x) => x.gate), ["dup"]);
  // no grounding: no number gate
  const r3 = E.gateRound(E.sanitizeGen({ q: [GOOD(3, { key: { ot: "Drug alpha3", wr: "Given at 500 mg" } })] }), {});
  assert.equal(r3.kept.length, 1);
});
test("toItems + applyVerify: the app's item schema, key spread, disagreement flagged", () => {
  const items = E.toItems(E.sanitizeGen({ q: [GOOD(1), GOOD(2), GOOD(3), GOOD(4)] }), { mod: "gen_0123456789ab", round: 1, exam: "neet-pg", grounded: true });
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((x) => x.a).sort(), [0, 1, 2, 3]);
  for (const it of items) { assert.match(it.id, /^q_[a-f0-9]{12}$/); assert.equal(it.o.length, 4); assert.equal(it.r.length, 4); assert.equal(it.gen, "AI"); assert.ok(it.exp); assert.match(it.o[it.a], /Drug alpha/); }
  const v = E.applyVerify(items, { v: [{ i: 0, pick: "ABCD"[items[0].a], multi: false, wrong: false, outdated: false, unsupported: false, note: "" }, { i: 1, pick: "ABCD"[(items[1].a + 1) % 4], multi: false, wrong: false, outdated: false, unsupported: false, note: "Key looks wrong" }, { i: 2, pick: "ABCD"[items[2].a], multi: true, wrong: false, outdated: true, unsupported: true, note: "two answers" }] }, true);
  assert.equal(v[0].qg.v, "ok");
  assert.deepEqual(v[1].qg.why, ["disagree"]);
  assert.deepEqual(v[2].qg.why, ["multiple-best", "outdated", "not-in-source"]);
  assert.deepEqual(v[3].qg.why, ["no-verdict"]);
});
test("usd + estimate: prices from the skill table, batch half price", () => {
  assert.equal(E.usd("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 12);
  assert.equal(E.usd("claude-haiku-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 0.6);
  assert.equal(E.usd("claude-sonnet-5-5", { cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }), 2.7);
  assert.equal(E.usd("claude-sonnet-5-5", { input_tokens: 1e6 }, true), 1);
  const e = E.estimate({ n: 30, groundChars: 40000 }), eb = E.estimate({ n: 30, groundChars: 40000, batch: true });
  assert.equal(e.calls, 6); assert.ok(e.usd > 0 && e.usd < 1, String(e.usd)); assert.ok(Math.abs(eb.usd * 2 - e.usd) < 0.001);
});

/* ---------------- route ---------------- */
test("not configured: no key or flag off -> status on false, gen 503, no call", async () => {
  reset();
  for (const env of [envFor({ ANTHROPIC_API_KEY: undefined }), envFor({ PREP_QGEN_ON: "0" })]) {
    const s = await post(env, { op: "status" });
    assert.equal(s.status, 200, s.text); assert.equal(s.json.on, false, s.text);
    const g = await post(env, gen());
    assert.equal(g.status, 503); assert.equal(g.json.error, "not-configured");
  }
  assert.equal(calls.length, 0);
});
test("auth: guest 401, student flag off 403, owner ops refuse a non-owner", async () => {
  reset();
  assert.equal((await post(envFor(), gen(), null)).status, 401);
  const off = envFor({ PREP_QGEN_STUDENT: "0" });
  assert.equal((await post(off, gen())).json.reason, "student-off");
  const st = await post(off, { op: "status" }, "tok-o");
  assert.equal(st.json.owner, true); assert.equal(st.json.student, false);
  assert.equal((await post(off, { op: "status" })).json.owner, false);
  for (const op of ["bsubmit", "bpoll", "stage"]) { const r = await post(envFor(), { op, n: 5, topic: "x", exam: "neet-pg" }); assert.equal(r.status, 403, op); assert.equal(r.json.error, "owner-only"); }
  assert.equal(calls.length, 0);
});
test("student gen: generate + verify, workspace header, caching block, items in the app schema, metering", async () => {
  reset();
  const env = envFor();
  const r = await post(env, gen({ ground: GROUND, idem: "idem-00000001" }));
  assert.equal(r.status, 200, r.text);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.model, "claude-sonnet-5-5"); assert.equal(calls[1].body.model, "claude-haiku-5-5");
  for (const c of calls) { assert.equal(c.headers["anthropic-workspace-id"], WS); assert.equal(c.headers["anthropic-version"], "2023-06-01"); }
  assert.equal(calls[0].headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.deepEqual(calls[0].body.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(calls[1].body.messages[0].content[0].cache_control, { type: "ephemeral" });
  // the verifier never sees the key's reasons, the explanation or the pearl
  const vtxt = JSON.stringify(calls[1].body);
  assert.equal(vtxt.indexOf("First line for this pattern"), -1); assert.equal(vtxt.indexOf("Remember the first line drug"), -1);
  assert.equal(r.json.items.length, 1);   // GOOD(2..5) keys name "alpha2".."alpha5": numbers the grounding lacks, so g9b drops them
  noKey(r.text);
  assert.ok(r.json.usage.usd > 0); assert.ok(r.json.usage.mt > 0);
  // one usage record for module prep_qgen
  const recs = [...env.MAIK_KV.m.keys()].filter((k) => k.startsWith("aiu:mod:") && k.includes(":prep_qgen:"));
  assert.ok(recs.length >= 1, "usage record");
  // idempotent replay: no new call
  const n = calls.length, again = await post(env, gen({ ground: GROUND, idem: "idem-00000001" }));
  assert.equal(again.replay, "1"); assert.equal(calls.length, n);
});
test("student gen without grounding: all five pass, marked not from the library", async () => {
  reset();
  const r = await post(envFor(), gen());
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.items.length, 5);
  assert.ok(r.json.items.every((it) => it.qg.v === "ok" && it.qg.u === 1 && it.qg.g === 0));
  assert.equal(calls[0].body.messages[0].content[0].text.indexOf("<source>"), -1);
});
test("verifier disagreement: dropped for a student, kept flagged for the owner", async () => {
  reset();
  verReply = (body) => { const r = defaultVer(body), j = JSON.parse(r.content[1].text); j.v[0].pick = j.v[0].pick === "A" ? "B" : "A"; j.v[1].multi = true; r.content[1].text = JSON.stringify(j); return r; };
  const s = await post(envFor(), gen());
  assert.equal(s.json.items.length, 3); assert.equal(s.json.flagged, 2);
  assert.deepEqual(s.json.dropped.map((d) => d.why), [["disagree"], ["multiple-best"]]);
  const o = await post(envFor(), gen(), "tok-o");
  assert.equal(o.json.items.length, 5);
  assert.deepEqual(o.json.items.filter((x) => x.qg.v === "flag").map((x) => x.qg.why), [["disagree"], ["multiple-best"]]);
});
test("caps: modules a day, questions a module, the daily USD breaker", async () => {
  reset();
  const env = envFor({ PREP_QGEN_MODULES_PER_DAY: "2", PREP_QGEN_MODULE_Q_CAP: "7" });
  assert.equal((await post(env, gen({ mod: "gen_aaaaaaaaaaa1" }))).status, 200);
  assert.equal((await post(env, gen({ mod: "gen_aaaaaaaaaaa2" }))).status, 200);
  const third = await post(env, gen({ mod: "gen_aaaaaaaaaaa3" }));
  assert.equal(third.status, 429); assert.equal(third.json.reason, "daily-modules");
  assert.equal((await post(env, { op: "status" })).json.left, 0);
  // the same module continues: 5 + 2 then full
  const more = await post(env, gen({ mod: "gen_aaaaaaaaaaa1", round: 2, avoid: [] }));
  assert.equal(more.status, 200); assert.equal(more.json.items.length, 2); assert.equal(more.json.left.questions, 0);
  assert.match(calls[calls.length - 2].body.messages[0].content[1].text, /Write 2 questions/);
  const full = await post(env, gen({ mod: "gen_aaaaaaaaaaa1", round: 3 }));
  assert.equal(full.json.reason, "module-full");
  // owner is not capped by the student limits
  assert.equal((await post(env, gen({ mod: "gen_aaaaaaaaaaa4" }), "tok-o")).status, 200);
  // the shared breaker
  const env2 = envFor({ PREP_QGEN_DAILY_USD: "0.00001" });
  assert.equal((await post(env2, gen({ mod: "gen_bbbbbbbbbbb1" }))).status, 200);
  const br = await post(env2, gen({ mod: "gen_bbbbbbbbbbb2" }), "tok-b");
  assert.equal(br.json.reason, "budget");
});
test("input: sizes and shapes", async () => {
  reset();
  const env = envFor();
  assert.equal((await post(env, gen({ n: 6 }))).json.reason, "n");
  assert.equal((await post(env, gen({ exam: "mbbs" }))).json.reason, "exam");
  assert.equal((await post(env, gen({ mod: "deck1" }))).json.reason, "mod");
  assert.equal((await post(env, gen({ ground: "too short" }))).json.reason, "ground-short");
  assert.equal((await post(env, gen({ bank: ["v5/medicine/mcq/med-x.json"] }))).json.reason, "bank");   // students cannot name bank files
  const big = await post(env, gen({ ground: "x".repeat(E.QGEN.groundStudent + 1) }));
  assert.equal(big.status, 413);
  assert.equal(calls.length, 0);
});
test("provider failures: auth = not-configured, 529 = busy, never the key or provider text", async () => {
  reset();
  const bad = await post(envFor({ ANTHROPIC_API_KEY: "sk-ant-wrong-key-xxxxxxxx" }), gen());
  assert.equal(bad.status, 503); assert.equal(bad.json.error, "not-configured");
  assert.equal(bad.text.indexOf("invalid x-api-key"), -1);
  genReply = () => new Response('{"error":{"type":"overloaded_error"}}', { status: 529 });
  const busy = await post(envFor(), gen());
  assert.equal(busy.status, 503); assert.equal(busy.json.error, "busy");
  genReply = () => msg("claude-sonnet-5-5", {}, usage(10, 0), "refusal");
  const ref = await post(envFor(), gen());
  assert.equal(ref.status, 200); assert.equal(ref.json.items.length, 0); assert.equal(ref.json.refused, true);
  noKey(JSON.stringify(logs)); noKey(bad.text); noKey(busy.text);
});
test("owner dedupe against the bank file on R2", async () => {
  reset();
  const env = envFor({ PREP_BANK_R2: fakeR2({ "prep-bank/v5/pharmacology/mcq/ph-first.json": JSON.stringify({ items: [{ q: GOOD(1).st }, { q: GOOD(2).st }] }) }) });
  const r = await post(env, gen({ bank: ["v5/pharmacology/mcq/ph-first.json"] }), "tok-o");
  assert.equal(r.json.items.length, 3);
  assert.deepEqual(r.json.dropped.map((d) => d.gate), ["dup", "dup"]);
});
test("report: counts only", async () => {
  reset();
  const env = envFor();
  const r = await post(env, { op: "report", mod: "gen_0123456789ab", id: "q_0123456789ab", why: "wrong-key" });
  assert.equal(r.status, 200);
  const k = [...env.MAIK_KV.m.keys()].find((x) => x.startsWith("prep:qgen:rep:"));
  assert.deepEqual(JSON.parse(env.MAIK_KV.m.get(k)), { "wrong-key": 1 });
  assert.equal((await post(env, { op: "report", mod: "gen_0123456789ab", id: "q_0123456789ab", why: "rude words" })).status, 400);
});
test("owner bulk: batch submit, poll to verify, poll to done; stage to R2", async () => {
  reset(); batchState = {};
  const env = envFor();
  const s = await post(env, { op: "bsubmit", topic: "First line drugs", exam: "neet-pg", n: 12, ground: GROUND + " Drug alpha2 Drug alpha3 Drug alpha4 Drug alpha5", subject: "pharmacology", module: "ph-first" }, "tok-o");
  assert.equal(s.status, 200, s.text);
  assert.ok(s.json.estimate.usd > 0); assert.equal(s.json.estimate.batch, true);
  const sub = calls.find((c) => c.path === "/v1/messages/batches");
  assert.equal(sub.body.requests.length, 3);
  assert.ok(sub.body.requests.every((r) => r.params.fallbacks === undefined));
  let p = await post(env, { op: "bpoll", job: s.json.job.id }, "tok-o");
  assert.equal(p.json.job.stage, "gen");
  p = await post(env, { op: "bpoll", job: s.json.job.id }, "tok-o");
  assert.equal(p.json.job.stage, "verify");
  p = await post(env, { op: "bpoll", job: s.json.job.id }, "tok-o");
  p = await post(env, { op: "bpoll", job: s.json.job.id }, "tok-o");
  assert.equal(p.json.job.stage, "done", p.text);
  assert.ok(p.json.items.length >= 1);
  assert.ok(p.json.items.every((x) => x.qg.v === "ok"));
  noKey(p.text);
  const st = await post(env, { op: "stage", title: "First line", exam: "neet-pg", subject: "pharmacology", module: "ph-first", items: p.json.items }, "tok-o");
  assert.equal(st.status, 200, st.text);
  assert.match(st.json.cmd, /^node tools\/prep-qgen\.mjs publish --stage s\d{8}-[a-z0-9]+$/);
  const saved = env.PREP_BANK_R2.m.get("prep-qgen/staging/" + st.json.stageId + ".json");
  assert.equal(JSON.parse(saved).items.length, p.json.items.length);
  assert.equal(saved.indexOf("prep-bank/"), -1);
});

/* ---------------- CLI (tools/prep-qgen.mjs): pure parts and a dry run that sends nothing ---------------- */
test("CLI: chunks, plan, estimate, overlay shape; the dry run makes no call", async () => {
  const C = await import("../tools/prep-qgen.mjs");
  const text = Array.from({ length: 60 }, (_, i) => "Paragraph " + i + " about a topic with enough words to count.").join("\n\n");
  const ch = C.chunks(text, 600);
  assert.ok(ch.length > 3 && ch.every((c) => c.length <= 600));
  assert.equal(ch.join(" ").replace(/\s+/g, " ").length >= text.replace(/\s+/g, " ").length - ch.length, true);
  assert.deepEqual(C.split(12, 5), [3, 3, 2, 2, 2]);
  const p = C.plan({ text, n: 12, chunkChars: 600 });
  assert.equal(p.reduce((t, x) => t + x.n, 0), 12); assert.ok(p.length <= 3);
  const est = C.estimateJob(p, E.qgenConfig(envFor()));
  assert.ok(est.batch > 0 && Math.abs(est.batch * 2 - est.direct) < 0.0005, JSON.stringify(est));
  const ov = C.toOverlay([{ id: "q_0123456789ab", q: "Q?", o: ["a", "b", "c", "d"], a: 1, exp: "e", r: ["1", "2", "3", "4"], qg: { v: "ok" } }, { id: "q_bbbbbbbbbbbb", q: "Q2?", o: ["a", "b", "c", "d"], a: 0, qg: { v: "flag" } }], { subject: "medicine", module: "med-dka", set: "maik1" });
  assert.deepEqual(Object.keys(ov), ["topic", "set", "v", "items"]);
  assert.equal(ov.items.length, 1); assert.equal(ov.items[0].id, "mk-0123456789ab"); assert.equal(ov.items[0].t, "med-dka"); assert.equal(ov.items[0].prov, "SMD");
  // the dry run: no fetch to Anthropic, prints an estimate
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["tools/prep-qgen.mjs", "--topic", "DKA", "--count", "10"], { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Estimate: Batch \$\d/); assert.match(r.stdout, /DRY RUN: nothing was sent/);
});
test("bank route serves maik overlays, never the staging prefix", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../functions/api/prep/bank/[[path]].js", import.meta.url), "utf8");
  const re = /const MAIK_RE = (\/.+\/);/.exec(src)[1];
  const MAIK = eval(re);
  assert.ok(MAIK.test("overlay/maik1/medicine/med-dka.json"));
  assert.ok(!MAIK.test("overlay/maik0/medicine/med-dka.json"));
  assert.ok(!MAIK.test("prep-qgen/staging/s20261010-abc.json"));
});
test("client pure helpers: rounds, error words, review approvals", async () => {
  const { createRequire } = await import("node:module");
  const P = createRequire(import.meta.url)("../prep-qgen.js");
  assert.equal(P.nextN(10, 0, 0), 5); assert.equal(P.nextN(10, 9, 2), 1); assert.equal(P.nextN(10, 10, 2), 0);
  assert.equal(P.nextN(10, 6, 4), 0, "at most target/5 + 2 rounds");
  assert.equal(P.codeOf(0, {}), "offline"); assert.equal(P.codeOf(429, { reason: "daily-modules" }), "daily-modules"); assert.equal(P.codeOf(503, { error: "not-configured" }), "not-configured");
  assert.equal(P.codeOf(503, { error: "busy" }), "busy"); assert.equal(P.retryable("busy"), true); assert.equal(P.retryable("daily-modules"), false);
  const list = [{ it: { qg: { v: "ok" } }, st: "" }, { it: { qg: { v: "flag" } }, st: "" }, { it: { qg: { v: "ok" } }, st: "drop" }];
  assert.equal(P.bulkApprove(list), 1); assert.equal(P.approved(list).length, 1);
  assert.equal(P.leftLine({ caps: { modulesPerDay: 3 }, left: 2 }), "2 of 3 free modules left today");
  Object.values(P.MSG).forEach((m) => assert.equal(/[–—]/.test(m), false, m));
});
test("PREP_QGEN_OWNERS narrows the Author tool to the listed owner", async () => {
  CLAIMS["tok-k"] = { sub: "u-k", email: "kdiwakar45@gmail.com", email_verified: true };   // on the built-in owner list
  const env = envFor({ PREP_QGEN_OWNERS: OWNER });
  assert.equal((await post(env, { op: "status" }, "tok-k")).json.owner, false);
  assert.equal((await post(env, { op: "stage", subject: "x", module: "y", items: [] }, "tok-k")).status, 403);
  assert.equal((await post(env, { op: "status" }, "tok-o")).json.owner, true);
  assert.equal((await post(envFor(), { op: "status" }, "tok-k")).json.owner, false, "default list: the content owner only");
  assert.equal((await post(envFor(), { op: "status" }, "tok-o")).json.owner, true);
  assert.equal((await post(envFor({ PREP_QGEN_OWNERS: "*" }), { op: "status" }, "tok-k")).json.owner, true, "* = ownerOK decides");
});
test("one secret: key::workspace (production binding limit), no flag vars needed", async () => {
  reset();
  const env = envFor({ ANTHROPIC_API_KEY: KEY + "::" + WS, ANTHROPIC_WORKSPACE_ID: undefined, PREP_QGEN_ON: undefined, PREP_QGEN_STUDENT: undefined });
  assert.deepEqual(E.creds(env), { key: KEY, ws: WS });
  assert.equal((await post(env, { op: "status" })).json.on, true);
  const r = await post(env, gen());
  assert.equal(r.status, 200, r.text);
  assert.ok(calls.every((c) => c.headers["x-api-key"] === KEY && c.headers["anthropic-workspace-id"] === WS));
  noKey(r.text);
  assert.equal((await post(envFor({ PREP_QGEN_ON: "0" }), { op: "status" })).json.on, false);
});
