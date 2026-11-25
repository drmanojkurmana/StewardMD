/* PrepNucleus auto explanations (owner 2026-11-20: "I shouldnt see a single mcq without explanation", Haiku 5.5).
 * Server: functions/api/prep/explain.js writes one explanation per question with claude-haiku-5-5, keeps it in R2 and
 * serves every later request from there; per-caller and daily-USD limits; bad input and unusable replies refused.
 * Arena: a battle question carries the bank's stored explanation, sent only in the round result (Revenge shows it).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-autoexplain.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as X from "../functions/api/prep/explain.js";
import { expOf } from "../functions/_prep-arena.js";
import * as C from "../prep-arena-worker/src/core.js";

const Q = { q: "A 19 year old took 40 paracetamol tablets 6 hours ago. Level is above the treatment line. Next step?", o: ["Observe", "IV N-acetylcysteine", "Activated charcoal", "Liver transplant"], a: 1 };
const REPLY = { key: "IV N-acetylcysteine now — the level is above the treatment line.", notes: "- **NAPQI** is detoxified by glutathione", others: { A: "Observing risks liver failure.", B: "", C: "Charcoal helps only within 1 hour.", D: "Transplant is for fulminant failure." }, pearl: "Treat above the line." };

function memR2() { const m = new Map(); return { m, async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; }, async put(k, v) { m.set(k, v); } }; }
function memKV() { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); } }; }
function env(extra) { return { ANTHROPIC_API_KEY: "sk-test-key-xxxxxxxx", ANTHROPIC_BASE_URL: "https://api.test", PREP_BANK_R2: memR2(), UPDATES_KV: memKV(), ...extra }; }
const req = (b) => new Request("https://x/api/prep/explain", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify(b) });
function stubFetch(reply, log) {
  return async (url, init) => {
    log.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 400 }, model: "claude-haiku-5-5" }), { status: 200 });
  };
}
const waitAll = () => { const ps = []; return { waitUntil: (p) => ps.push(p), done: () => Promise.all(ps) }; };

test("readReq: stem, 2 to 6 options and a key inside them; anything else is refused", () => {
  assert.deepEqual(X.readReq(Q), Q);
  for (const b of [{}, { ...Q, a: 4 }, { ...Q, a: -1 }, { ...Q, a: "1x" }, { ...Q, o: ["only"] }, { ...Q, o: [...Q.o, "e", "f", "g"] }, { ...Q, q: "short" }, { ...Q, o: ["a", "", "c", "d"] }]) assert.equal(X.readReq(b), null, JSON.stringify(b).slice(0, 60));
});

test("request body: Haiku 5.5, structured output with one reason per wrong letter, the key given, no dash in the output", () => {
  const b = X.axBody(Q, X.AX_MODEL);
  assert.equal(b.model, "claude-haiku-5-5");
  assert.equal(b.output_config.format.type, "json_schema");
  assert.deepEqual(b.output_config.format.schema.properties.others.required, ["A", "B", "C", "D"]);
  assert.equal(b.output_config.format.schema.additionalProperties, false);
  assert.match(b.messages[0].content[0].text, /<key>B<\/key>/);
  assert.ok(!("thinking" in b) && !("temperature" in b));
  const x = X.toX(REPLY, Q);
  assert.ok(!/[—–]/.test(x.key), "em dash removed");
  assert.deepEqual(Object.keys(x.others), ["A", "C", "D"], "the key's own entry dropped");
  assert.equal(X.toX({ ...REPLY, others: { A: "x", C: "", D: "" } }, Q), null, "a wrong option without a reason is unusable");
  assert.equal(X.toX({ ...REPLY, key: "" }, Q), null);
});

test("route: first request writes with Haiku and stores in R2; the second, from anyone, is served from R2 with no call", async () => {
  const log = [], e = env(), orig = globalThis.fetch;
  globalThis.fetch = stubFetch(REPLY, log);
  try {
    const w = waitAll();
    const r1 = await X.onRequestPost({ request: req(Q), env: e, waitUntil: w.waitUntil });
    await w.done();
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.cached, false); assert.match(j1.x.key, /N-acetylcysteine/);
    assert.equal(log.length, 1); assert.equal(log[0].url, "https://api.test/v1/messages"); assert.equal(log[0].body.model, "claude-haiku-5-5");
    assert.equal(e.PREP_BANK_R2.m.size, 1); assert.ok([...e.PREP_BANK_R2.m.keys()][0].startsWith("prep-explain/v1/"));
    const r2 = await X.onRequestPost({ request: req({ ...Q, q: "  " + Q.q.toUpperCase() + " " }), env: e, waitUntil: w.waitUntil });
    const j2 = await r2.json();
    assert.equal(j2.cached, true); assert.equal(log.length, 1, "no second model call");
    assert.ok(Number(e.UPDATES_KV.m.get([...e.UPDATES_KV.m.keys()].find((k) => k.startsWith("prep:ax:usd:")))) > 0, "spend booked");
  } finally { globalThis.fetch = orig; }
});

test("route: limits, switch and bad replies", async () => {
  const orig = globalThis.fetch, log = [];
  globalThis.fetch = stubFetch(REPLY, log);
  try {
    assert.equal((await X.onRequestPost({ request: req(Q), env: env({ PREP_AX_ON: "0" }) })).status, 503);
    assert.equal((await X.onRequestPost({ request: req(Q), env: env({ ANTHROPIC_API_KEY: "" }) })).status, 503);
    assert.equal((await X.onRequestPost({ request: req({ q: "x" }), env: env() })).status, 400);
    const e = env({ PREP_AX_GUEST_DAY: "1" }), w = waitAll();
    assert.equal((await X.onRequestPost({ request: req(Q), env: e, waitUntil: w.waitUntil })).status, 200); await w.done();
    assert.equal((await X.onRequestPost({ request: req({ ...Q, a: 0 }), env: e })).status, 429, "guest cap");
    assert.equal((await X.onRequestPost({ request: req(Q), env: e })).status, 200, "a cached one is never capped");
    const e2 = env(); e2.UPDATES_KV.m.set("prep:ax:usd:" + new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), "9");
    assert.equal(((await (await X.onRequestPost({ request: req(Q), env: e2 })).json()).error), "budget");
    globalThis.fetch = stubFetch({ key: "", notes: "", others: {}, pearl: "" }, log);
    const e3 = env(), r = await X.onRequestPost({ request: req(Q), env: e3 });
    assert.equal(r.status, 502); assert.equal(e3.PREP_BANK_R2.m.size, 0, "nothing stored");
  } finally { globalThis.fetch = orig; }
});

test("arena: the stored explanation rides with the item and reaches players only in the round result", () => {
  assert.equal(expOf({ q: "q", o: ["a", "b"], a: 0 }), undefined);
  const e = expOf({ q: "q", o: ["a", "b"], a: 0, exp: "Because.", x: { key: "A is right", others: { B: "no" }, pearl: "p" }, kp: "k", r: ["ra", "rb"] });
  assert.deepEqual(e, { exp: "Because.", x: { key: "A is right", pearl: "p", others: { B: "no" } }, r: ["ra", "rb"], kp: "k" });
  const items = Array.from({ length: 7 }, (_, i) => ({ id: "q" + i, q: "Q" + i, o: ["A", "B", "C", "D"], a: 0, e: { exp: "why " + i } }));
  const s = C.newBattle({ id: "m", exam: "neet-pg", players: [{ uidh: "a", name: "A", rating: 1200 }, { uidh: "b", name: "B", rating: 1200 }], items, now: 0 });
  C.battleEvent(s, { type: "start" }, 0);
  let t = C.wakeAt(s); const q = C.battleEvent(s, { type: "tick" }, t);
  const qm = q.find((o) => o.msg.t === "q").msg;
  assert.ok(!("e" in qm), "no explanation with the question");
  C.battleEvent(s, { type: "answer", side: 0, i: 0, k: 1 }, t);
  const r = C.battleEvent(s, { type: "answer", side: 1, i: 0, k: 0 }, t + 1).find((o) => o.msg.t === "r").msg;
  assert.deepEqual(r.e, { exp: "why 0" });
});
