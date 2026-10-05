/* prep-generate.test.mjs - POST /api/ai/prep-generate (PrepNucleus Layer C), driven through the real /api/ai
 * router with a mocked Vertex generateContent, in-memory KV and a small in-memory D1.
 * Contract: vault/plans/PrepNucleus-LayerC.md 6.0, 6.8, 8, 9.3 and vault/plans/PrepNucleus.md 7, 9.3.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-generate.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLAIMS = {};
for (const u of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]) CLAIMS["tok-" + u] = { sub: "u-" + u, email: u + "@example.com", email_verified: true };
const realAuth = await import("../functions/_fbauth.js");
const claimsOf = (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null;
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => claimsOf(req), cfAccessEmail: async () => "", identify: async (req) => { const c = claimsOf(req); return c ? "fb:" + c.sub : null; } } });

const { onRequest } = await import("../functions/api/ai/[[path]].js");
const C = await import("../functions/_prep-core.js");
const { istDay } = await import("../functions/_counters.js");
const DAY = istDay(Date.now()), MONTH = DAY.slice(0, 7);

/* ---- fakes ---- */
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
    all: async () => ({ results: [...counters.entries()].filter(([k]) => k.startsWith(args[0] + "|") && k.slice(args[0].length + 1).startsWith(String(args[1]).replace(/%$/, ""))).map(([k, n]) => ({ k: k.split("|")[1], n })) }),
  });
  return { counters, cost, prepare: (sql) => stmt(sql, []), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

/* Vertex mock: replies come from `reply(body)`, which returns a text string, or an object to send as is. */
let calls = [], reply = () => "{}";
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.indexOf("generateContent") >= 0) {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const r = await reply(body, init);
    if (r && typeof r === "object") return new Response(JSON.stringify(r));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: r }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 300, thoughtsTokenCount: 20 } }));
  }
  return new Response("{}");
};
process.on("exit", () => { globalThis.fetch = realFetch; });

function envFor(extra) {
  return Object.assign({ VERTEX_API_KEY: "vk-test", GEMINI_API_KEY: "dev-test", AI_PROVIDER: "developer", GEMINI_MODEL: "gemini-3.6-flash", MAIK_KV: fakeKv(), UPDATES_DB: fakeD1(), MAIK_ENFORCE_CAPS: "1", MAIK_RATE_LIMIT_SECONDS: "0.001" }, extra || {});
}
async function post(env, body, opts) {
  const o = opts || {};
  const headers = { "Content-Type": "application/json" };
  if (o.token !== null) headers.Authorization = "Bearer " + (o.token || "tok-a"); else headers.Origin = "https://stewardmd.in";
  const req = new Request("https://stewardmd.in/api/ai/prep-generate", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const waits = [];
  const r = await onRequest({ request: req, env, params: { path: ["prep-generate"] }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  await new Promise((res) => setTimeout(res, 5));   // let the rate slot clear (1 ms)
  return { status: r.status, json: await r.json(), replay: r.headers.get("X-Prep-Replay") };
}

/* ---- fixtures ---- */
let idemN = 0;
const idem = () => "idem" + String(++idemN).padStart(8, "0");
const deckOf = (s) => "gen_" + C.sha12("deck" + s);
const SENTS = [
  { n: 1, p: 4, h: "AML", tx: "Acute promyelocytic leukemia is defined by the t(15;17) translocation creating PML-RARA." },
  { n: 2, p: 4, h: "AML", tx: "All-trans retinoic acid is given at 45 mg/m2 per day during induction." },
  { n: 3, p: 5, h: "AML", tx: "Disseminated intravascular coagulation is a common and dangerous presenting complication of acute promyelocytic leukemia in adults." },
];
const FACTS_REPLY = JSON.stringify({ f: [
  { ft: "APL is defined by the t(15;17) translocation.", cq: "Which translocation defines APL?", sn: [1], fk: "recall" },
  { ft: "ATRA induction dose is 45 mg/m2 per day.", cq: "What is the ATRA induction dose in APL?", sn: [2], fk: "mgmt" },
  { ft: "DIC is a common presenting complication of APL.", cq: "Which coagulopathy complicates APL at presentation?", sn: [3], fk: "dx" },
  { ft: "ATRA is given at 60 mg/m2.", cq: "ATRA dose?", sn: [2], fk: "mgmt" },
  { ft: "Out of chunk fact.", cq: "?", sn: [42], fk: "recall" },
] });
const factsBody = (deck, extra) => Object.assign({ op: "facts", deckId: deck, idem: idem(), exam: "neet-pg", profileV: 1, pv: "p1", chunk: { i: 0, sents: SENTS } }, extra || {});

const Q_GOOD0 = { st: "A 30-year-old man has gum bleeding and a high blast count with Auer rods. Which cytogenetic change is most typical?", key: { ot: "t(15;17)", wr: "Creates the PML-RARA fusion of APL." }, dis: [{ ot: "t(8;21)", wr: "Typical of AML with maturation.", et: "confused" }, { ot: "t(9;22)", wr: "Philadelphia chromosome of CML.", et: "confused" }, { ot: "inv(16)", wr: "Seen in AML with eosinophilia.", et: "knowledge" }], kp: "Auer rods plus DIC: think APL and start ATRA.", fi: 0, dl: 2, cog: "application" };
const Q_GOOD1 = { st: "What is the usual daily induction dose of all-trans retinoic acid for this leukemia?", key: { ot: "45 mg/m2", wr: "Standard ATRA induction dose is 45 mg/m2 a day." }, dis: [{ ot: "15 mg/m2", wr: "Too low for induction.", et: "calc" }, { ot: "90 mg/m2", wr: "Double the usual dose.", et: "calc" }, { ot: "4.5 mg/m2", wr: "A tenfold error.", et: "calc" }], kp: "ATRA 45 mg/m2/day.", fi: 1, dl: 1, cog: "recall" };
const Q_NUM = Object.assign({}, Q_GOOD1, { st: "Which daily ATRA dose is used for induction in promyelocytic leukemia today?", key: { ot: "50 mg/m2", wr: "Common induction dose." } });
const Q_VERB = { st: "Which complication most often accompanies the presentation of this leukemia subtype?", key: { ot: "DIC", wr: "Procoagulant release from granules." }, dis: [{ ot: "TTP", wr: "No schistocyte-driven picture here.", et: "confused" }, { ot: "HUS", wr: "Renal failure is not the feature.", et: "confused" }, { ot: "ITP", wr: "Isolated low platelets only.", et: "dx" }], kp: "Disseminated intravascular coagulation is a common and dangerous presenting complication of acute promyelocytic leukemia in adults.", fi: 2, dl: 2, cog: "recall" };
const Q_DUPOPT = Object.assign({}, Q_GOOD0, { st: "Duplicate options question about chromosome change in leukemia of promyelocytes?", dis: [Q_GOOD0.dis[0], Q_GOOD0.dis[0], Q_GOOD0.dis[2]], fi: 0 });
const Q_KEYDIS = Object.assign({}, Q_GOOD0, { st: "Key equals a distractor question about leukemia cytogenetic features overall?", dis: [{ ot: "t(15;17)", wr: "x", et: "knowledge" }, Q_GOOD0.dis[1], Q_GOOD0.dis[2]] });
const Q_TWO = Object.assign({}, Q_GOOD0, { st: "Only two distractors for this cytogenetics item on leukemia?", dis: Q_GOOD0.dis.slice(0, 2) });
const Q_SAMEFACT = Object.assign({}, Q_GOOD0, { st: "Second question on the same fact, worded quite differently from the first one?" });

async function startDeck(env, s, token) {
  const r = await post(env, factsBody(deckOf(s)), { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.facts;
}
const recCount = (env, email) => Number(env.MAIK_KV.m.get("aiu:mod:em:" + (email || "a@example.com") + ":prep:" + DAY)) || 0;

/* ---- tests ---- */
test("sign-in is required: an unsigned app request is 401 sign-in and never reaches the model", async () => {
  const env = envFor(); calls = [];
  const r = await post(env, factsBody(deckOf("x")), { token: null });
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, { error: "sign-in", reason: "sign-in" });
  assert.equal(calls.length, 0);
});

test("bad input is 400 bad-input naming the field, before any gate or model call", async () => {
  const env = envFor(); calls = [];
  const base = factsBody(deckOf("bad"));
  const cases = [
    [Object.assign({}, base, { op: "write-essay" }), "op"],
    [Object.assign({}, base, { deckId: "deck-1" }), "deckId"],
    [Object.assign({}, base, { idem: "x" }), "idem"],
    [Object.assign({}, base, { exam: "neet-ug" }), "exam"],
    [Object.assign({}, base, { chunk: { i: 0, sents: [{ n: 1, p: 1, tx: "" }] } }), "chunk.sents"],
    [Object.assign({}, base, { chunk: { i: 0, sents: [SENTS[0], SENTS[0]] } }), "chunk.sents"],
    [{ op: "mcq", deckId: base.deckId, idem: idem(), exam: "neet-pg", facts: [] }, "facts"],
    [{ op: "solve", deckId: base.deckId, idem: idem(), exam: "neet-pg", q: [{ id: "q_1", q: "Stem?", o: ["a", "b", "c", "d"], a: 7 }] }, "q"],
    [{ op: "solve", deckId: base.deckId, idem: idem(), exam: "neet-pg", q: [{ id: "q_1", q: "Stem?", o: ["a", "b", "c"], a: 0 }] }, "q"],
  ];
  for (const [b, why] of cases) {
    const r = await post(env, b);
    assert.equal(r.status, 400, why); assert.equal(r.json.error, "bad-input"); assert.equal(r.json.reason, why);
  }
  const nj = await post(env, "not json");
  assert.equal(nj.status, 400);
  assert.equal(calls.length, 0);
  assert.equal(recCount(env), 0, "no usage record for a refused request");
});

test("too large: body over 400 KB and a facts chunk over 6,000 tokens are 413", async () => {
  const env = envFor(); calls = [];
  const big = Array.from({ length: 120 }, (_, i) => ({ n: i + 1, p: 1, h: "H", tx: "x".repeat(3900) }));
  const r1 = await post(env, factsBody(deckOf("big"), { chunk: { i: 0, sents: big } }));
  assert.equal(r1.status, 413); assert.deepEqual(r1.json, { error: "too-large", reason: "body" });
  const r2 = await post(env, factsBody(deckOf("big"), { chunk: { i: 0, sents: big.slice(0, 7) } }));
  assert.equal(r2.status, 413); assert.equal(r2.json.reason, "chunk");
  assert.equal(calls.length, 0);
});

test("facts: Vertex only, pinned model, labels, responseSchema, thinkingBudget 0; facts grounded and filled", async () => {
  const env = envFor(); calls = []; reply = () => FACTS_REPLY;
  const r = await post(env, factsBody(deckOf("f1")));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.match(c.url, /^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/gemini-3\.1-flash-lite:generateContent$/, "Vertex even with AI_PROVIDER=developer; PREP model, not GEMINI_MODEL");
  assert.deepEqual(c.body.labels, { app: "prep" });
  assert.equal(c.body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(c.body.generationConfig.responseSchema, C.SCHEMAS.facts);
  assert.deepEqual(c.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(c.body.generationConfig.maxOutputTokens, 1536);
  assert.match(c.body.contents[0].parts[0].text, /^<source>\n## AML \(page 4\)\n\[1\] Acute promyelocytic/);
  const f = r.json.facts;
  assert.equal(f.length, 3, "the 60 mg/m2 fact and the out-of-chunk fact are dropped");
  assert.equal(r.json.dropped, 2);
  assert.equal(f[1].fid, "f_" + C.sha12(deckOf("f1") + "2"));
  assert.equal(f[1].quote, SENTS[1].tx); assert.deepEqual(f[1].p, [4]); assert.equal(f[1].h, "AML");
  assert.deepEqual(r.json.usage, { inTok: 900, outTok: 300, thinkTok: 20, inr: r.json.usage.inr, deckTok: 1220, deckCapTok: 200000, dayDecks: 1, monthDecks: 1 });
  assert.ok(r.json.usage.inr > 0);
});

test("Vertex not configured: 502 ai-failed, and the developer key is never used", async () => {
  const env = envFor({ VERTEX_API_KEY: "" }); calls = []; reply = () => FACTS_REPLY;
  const r = await post(env, factsBody(deckOf("nov")));
  assert.equal(r.status, 502); assert.equal(r.json.error, "ai-failed"); assert.equal(r.json.reason, "provider");
  assert.equal(calls.length, 0);
});

test("mcq: gates reject bad items, survivors are shuffled with the key intact and returned as 6.4 items", async () => {
  const env = envFor(); reply = () => FACTS_REPLY;
  const facts = await startDeck(env, "m1");
  calls = [];
  reply = () => JSON.stringify({ q: [Q_GOOD0, Q_GOOD1, Q_NUM, Q_VERB, Q_DUPOPT, Q_KEYDIS, Q_TWO] });
  const body = { op: "mcq", deckId: deckOf("m1"), idem: idem(), exam: "neet-pg", facts, mix: { dl: { 1: 0.3, 2: 0.5, 3: 0.2 }, cog: { recall: 0.5, application: 0.5 } }, src: { doc: "abc123abc123", name: "APL notes.pdf" } };
  const r = await post(env, body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 3000);
  assert.match(calls[0].body.systemInstruction.parts[0].text, /NEET-PG/);
  const gates = Object.fromEntries(r.json.rejected.map((x) => [x.gate, x.fid]));
  assert.equal(gates.g9b, facts[1].fid, "number not in the cited sentences");
  assert.equal(gates.verbatim, facts[2].fid, "12-word copy of the source");
  assert.ok("g3" in gates, "duplicate options"); assert.ok("g2" in gates, "key repeated as a distractor"); assert.ok("g1" in gates, "three options only");
  assert.equal(r.json.items.length, 2);
  for (const [it, src] of [[r.json.items[0], Q_GOOD0], [r.json.items[1], Q_GOOD1]]) {
    assert.equal(it.o[it.a], src.key.ot, "shuffle keeps the key correct");
    assert.equal(it.exp, src.key.wr); assert.equal(it.r[it.a], src.key.wr); assert.equal(it.et[it.a], null);
    assert.deepEqual(it.o.slice().sort(), [src.key.ot].concat(src.dis.map((d) => d.ot)).sort());
    assert.equal(it.prov, "USR"); assert.equal(it.gen, "AI"); assert.equal(it.rv, null); assert.equal(it.mv, "gemini-3.1-flash-lite");
    assert.deepEqual(it.ex, ["neet-pg"]); assert.equal(it.src.name, "APL notes.pdf"); assert.ok(Array.isArray(it.src.sn));
    assert.match(it.id, /^q_[a-f0-9]{12}$/);
  }
  assert.notEqual(r.json.items[0].a, r.json.items[1].a, "keys spread across letters");
  assert.equal(r.json.usage.dayDecks, 1, "mcq does not count a deck");
});

test("mcq: two questions on one fact keep the first (gate 12)", async () => {
  const env = envFor(); reply = () => FACTS_REPLY;
  const facts = await startDeck(env, "m12");
  reply = () => JSON.stringify({ q: [Q_GOOD0, Q_SAMEFACT] });
  const r = await post(env, { op: "mcq", deckId: deckOf("m12"), idem: idem(), exam: "neet-pg", facts: facts.slice(0, 2) });
  assert.equal(r.status, 200);
  assert.equal(r.json.items.length, 1);
  assert.deepEqual(r.json.rejected, [{ fi: 0, fid: facts[0].fid, gate: "g12" }]);
});

test("a mcq, solve or review on a deck with no accepted facts call is 400 deck-not-started", async () => {
  const env = envFor(); calls = [];
  const r = await post(env, { op: "solve", deckId: deckOf("never"), idem: idem(), exam: "neet-pg", q: [{ id: "q_1", q: "Stem?", o: ["a", "b", "c", "d"], a: 0 }] });
  assert.equal(r.status, 400); assert.equal(r.json.reason, "deck-not-started");
  assert.equal(calls.length, 0);
});

test("solve: blind (the key never reaches the prompt), compared on the server", async () => {
  const env = envFor(); reply = () => FACTS_REPLY;
  await startDeck(env, "s1");
  const items = [{ id: "q_aaaaaaaaaaaa", q: "Which translocation defines APL?", o: ["t(8;21)", "t(15;17)", "t(9;22)", "inv(16)"], a: 1 },
                 { id: "q_bbbbbbbbbbbb", q: "ATRA induction dose?", o: ["15 mg/m2", "90 mg/m2", "45 mg/m2", "4.5 mg/m2"], a: 2 }];
  calls = [];
  reply = () => JSON.stringify({ s: [{ i: 0, ot: "t(15;17)" }, { i: 1, ot: "90 mg/m2" }] });
  const r = await post(env, { op: "solve", deckId: deckOf("s1"), idem: idem(), exam: "neet-pg", q: items });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.solved, [{ id: "q_aaaaaaaaaaaa", ok: true, ot: "t(15;17)" }, { id: "q_bbbbbbbbbbbb", ok: false, ot: "90 mg/m2" }]);
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 400);
  assert.equal(calls[0].body.generationConfig.temperature, 0.2);
  // The same items with other keys produce the byte-identical prompt: nothing about a reaches the model.
  const other = items.map((it) => Object.assign({}, it, { a: (it.a + 1) % 4 }));
  await post(env, { op: "solve", deckId: deckOf("s1"), idem: idem(), exam: "neet-pg", q: other });
  assert.deepEqual(calls[1].body.contents, calls[0].body.contents);
  assert.deepEqual(calls[1].body.systemInstruction, calls[0].body.systemInstruction);
  assert.equal(/Key:|answer is/i.test(calls[0].body.contents[0].parts[0].text), false);
});

test("review: every gate must be true to pass; old is a label", async () => {
  const env = envFor(); reply = () => FACTS_REPLY;
  await startDeck(env, "r1");
  const items = [{ id: "q_aaaaaaaaaaaa", q: "Which translocation defines APL?", o: ["t(8;21)", "t(15;17)", "t(9;22)", "inv(16)"], a: 1, r: ["AML with maturation.", "PML-RARA.", "CML.", "AML M4Eo."], kp: "Think DIC." },
                 { id: "q_bbbbbbbbbbbb", q: "ATRA induction dose?", o: ["15 mg/m2", "90 mg/m2", "45 mg/m2", "4.5 mg/m2"], a: 2 }];
  const ok = { g4: true, g6: true, g7: true, g8: true, g9: true, g10: true, g11: true };
  calls = [];
  reply = () => JSON.stringify({ g: [Object.assign({ i: 0, old: true, why: "" }, ok), Object.assign({ i: 1, old: false, why: "90 is also defensible" }, ok, { g10: false })] });
  const r = await post(env, { op: "review", deckId: deckOf("r1"), idem: idem(), exam: "neet-pg", q: items, para: { q_aaaaaaaaaaaa: "APL paragraph text here." } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.gates[0].pass, true); assert.equal(r.json.gates[0].old, true);
  assert.equal(r.json.gates[1].pass, false); assert.equal(r.json.gates[1].g10, false); assert.equal(r.json.gates[1].why, "90 is also defensible");
  assert.match(calls[0].body.contents[0].parts[0].text, /APL paragraph text here\./);
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 800);
});

test("student text is scrubbed before it reaches the prompt", async () => {
  const env = envFor(); calls = []; reply = () => FACTS_REPLY;
  const sents = SENTS.concat([{ n: 4, p: 5, h: "AML", tx: "Patient name: Ramesh Kumar, MRN 445566, phone 9876543210, gave 1000 mg." }]);
  const r = await post(env, factsBody(deckOf("scrub"), { chunk: { i: 0, sents } }));
  assert.equal(r.status, 200);
  const text = calls[0].body.contents[0].parts[0].text;
  assert.equal(/Ramesh|445566|9876543210/.test(text), false);
  assert.match(text, /\[4\] \[removed\]/);
});

test("idempotent replay: same idem and body returns the stored response, no second model call or record; the stored copy is sealed", async () => {
  const env = envFor(); calls = []; reply = () => FACTS_REPLY;
  const body = factsBody(deckOf("idem"));
  const r1 = await post(env, body);
  assert.equal(r1.status, 200);
  assert.equal(recCount(env), 1);
  const r2 = await post(env, body);
  assert.equal(r2.status, 200); assert.equal(r2.replay, "1");
  assert.deepEqual(r2.json, r1.json);
  assert.equal(calls.length, 1, "no second Gemini call");
  assert.equal(recCount(env), 1, "no second usage record");
  assert.equal(r2.json.usage.dayDecks, 1);
  const sealed = env.MAIK_KV.m.get("prep:idem:fb:u-a:" + body.idem);
  assert.ok(sealed);
  assert.equal(/translocation|t\(15;17\)|fid/.test(sealed), false, "no question or source text at rest");
  // Same idem with a different payload is not a replay (the seal does not open): it runs as a new call.
  const r3 = await post(env, Object.assign({}, body, { chunk: { i: 1, sents: SENTS.slice(0, 2) } }));
  assert.equal(r3.status, 200); assert.equal(r3.replay, null);
  assert.equal(calls.length, 2);
});

test("deck caps: 3 new decks a day, 10 a month; a deck counts once; old decks keep working", async () => {
  const env = envFor(); reply = () => FACTS_REPLY;
  for (const s of ["d1", "d2", "d3"]) await startDeck(env, s, "tok-b");
  calls = [];
  const r4 = await post(env, factsBody(deckOf("d4")), { token: "tok-b" });
  assert.equal(r4.status, 429); assert.equal(r4.json.error, "quota"); assert.equal(r4.json.reason, "daily-decks");
  assert.ok(r4.json.retryAfter > 0 && r4.json.retryAfter <= 86400);
  assert.equal(calls.length, 0);
  const again = await post(env, factsBody(deckOf("d2")), { token: "tok-b" });
  assert.equal(again.status, 200, "a counted deck is never counted twice");
  assert.equal(again.json.usage.dayDecks, 3); assert.equal(again.json.usage.monthDecks, 3);
  assert.equal(env.MAIK_KV.m.get("prep:decks:fb:u-b:" + DAY), "3");
  // month cap
  env.MAIK_KV.m.set("prep:decks:fb:u-c:" + MONTH, "10");
  const m = await post(env, factsBody(deckOf("c1")), { token: "tok-c" });
  assert.equal(m.status, 429); assert.equal(m.json.reason, "month-decks");
  // a failed first facts call does not count the deck
  reply = () => "garbage";
  const f = await post(env, factsBody(deckOf("d5")), { token: "tok-d" });
  assert.equal(f.status, 502);
  assert.equal(env.MAIK_KV.m.get("prep:decks:fb:u-d:" + DAY), undefined);
});

test("token cap: a call that would cross the per-deck cap is refused before Gemini (fail closed)", async () => {
  const env = envFor({ PREP_DECK_TOKEN_CAP: "2800" }); reply = () => FACTS_REPLY;
  const r1 = await post(env, factsBody(deckOf("tc")), { token: "tok-e" });
  assert.equal(r1.status, 200); assert.equal(r1.json.usage.deckTok, 1220); assert.equal(r1.json.usage.deckCapTok, 2800);
  calls = [];
  const r2 = await post(env, factsBody(deckOf("tc")), { token: "tok-e" });
  assert.equal(r2.status, 429); assert.equal(r2.json.reason, "token-cap"); assert.equal(r2.json.deckTok, 1220);
  assert.equal(calls.length, 0);
});

test("daily calls cap (95, AI_MODULES.prep): at the cap the call is refused with daily-calls", async () => {
  const env = envFor(); calls = []; reply = () => FACTS_REPLY;
  env.MAIK_KV.m.set("aiu:mod:em:f@example.com:prep:" + DAY, "95");
  const r = await post(env, factsBody(deckOf("dc")), { token: "tok-f" });
  assert.equal(r.status, 429); assert.equal(r.json.reason, "daily-calls"); assert.equal(r.json.limit, 95);
  assert.equal(calls.length, 0);
  env.MAIK_KV.m.set("aiu:mod:em:f@example.com:prep:" + DAY, "94");
  assert.equal((await post(env, factsBody(deckOf("dc")), { token: "tok-f" })).status, 200);
  assert.equal(recCount(env, "f@example.com"), 95);
});

test("rate limit and circuit breaker come from checkQuota type prep; MaiK's monthly allowance does not apply", async () => {
  const env = envFor({ MAIK_RATE_LIMIT_SECONDS: "3" }); reply = () => FACTS_REPLY;
  env.MAIK_KV.m.set("maik:m:fb:u-g:" + new Date().toISOString().slice(0, 7), JSON.stringify({ tokens: 99999999 }));   // MaiK allowance long gone
  assert.equal((await post(env, factsBody(deckOf("rl")), { token: "tok-g" })).status, 200);
  const r = await post(env, factsBody(deckOf("rl")), { token: "tok-g" });
  assert.equal(r.status, 429); assert.equal(r.json.reason, "rate"); assert.equal(r.json.retryAfter, 3);
  const env2 = envFor();
  env2.MAIK_KV.m.set("maik:global:" + DAY, JSON.stringify({ cost: 999999, req: 1, blocked: 0 }));
  const b = await post(env2, factsBody(deckOf("cb")), { token: "tok-g" });
  assert.equal(b.status, 429); assert.equal(b.json.reason, "circuit-breaker");
});

test("metering: exactly one usage record per Gemini call, with real tokens and cost; the breaker and maik.cost are fed", async () => {
  const env = envFor(); reply = () => FACTS_REPLY;
  await startDeck(env, "u1", "tok-h");
  reply = () => "not json";
  const bad = await post(env, factsBody(deckOf("u1")), { token: "tok-h" });
  assert.equal(bad.status, 502); assert.equal(bad.json.reason, "bad-output"); assert.equal(bad.json.usage.inTok, 900);
  const n = recCount(env, "h@example.com");
  assert.equal(n, 2, "one record per call, the failed one included");
  const doc = JSON.parse(env.MAIK_KV.m.get("aiu:doc:em:h@example.com:" + DAY));
  assert.equal(doc.req, 2); assert.equal(doc.fail, 1);
  assert.equal(doc.tok, 2 * (900 + 320));
  assert.ok(doc.cost > 0);
  const inr = bad.json.usage.inr;
  assert.equal(inr, Math.round(((900 / 1000) * 0.024 + (320 / 1000) * 0.144) * 10000) / 10000);
  const d1 = env.UPDATES_DB;
  assert.ok(Math.abs(d1.counters.get(DAY + "|maik.cost") - 2 * inr) < 1e-9);
  assert.equal(d1.counters.get(DAY + "|aiu.mod.prep"), 2);
  assert.equal(d1.counters.get(DAY + "|aiu.model.gemini-3.1-flash-lite"), 2);
  assert.equal(d1.counters.get(DAY + "|prep.thinkTok"), 40);
  assert.ok(d1.cost.get(DAY) > 0, "project breaker (ai_cost_daily) fed");
  assert.equal(env.MAIK_KV.m.get("maik:u:fb:u-h:" + DAY), undefined, "never _usage.js recordUsage (MaiK allowance)");
  // Records hold no text: nothing in KV mentions the source or the questions.
  for (const [k, v] of env.MAIK_KV.m) if (!k.startsWith("prep:idem:")) assert.equal(/leukemia|translocation|retinoic/i.test(v), false, k);
});

test("504 ai-timeout when Vertex does not answer in time; the call is still recorded once", async () => {
  const env = envFor({ MAIK_AI_TIMEOUT_MS: "2000", MAIK_AI_DEADLINE_MS: "2500" }); reply = () => FACTS_REPLY;
  await startDeck(env, "t1", "tok-i");
  reply = (b, init) => new Promise((res, rej) => { init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
  const r = await post(env, factsBody(deckOf("t1")), { token: "tok-i" });
  assert.equal(r.status, 504); assert.equal(r.json.error, "ai-timeout");
  assert.equal(recCount(env, "i@example.com"), 2);
  const doc = JSON.parse(env.MAIK_KV.m.get("aiu:doc:em:i@example.com:" + DAY));
  assert.equal(doc.fail, 1);
});

test("502 ai-failed on malformed model output for every op", async () => {
  const env = envFor(); reply = () => FACTS_REPLY;
  const facts = await startDeck(env, "x1", "tok-j");
  const it = [{ id: "q_aaaaaaaaaaaa", q: "Stem?", o: ["a", "b", "c", "d"], a: 0 }];
  reply = () => '{"q":[{"st":"truncated';
  for (const b of [factsBody(deckOf("x1")), { op: "mcq", deckId: deckOf("x1"), idem: idem(), exam: "neet-pg", facts }, { op: "solve", deckId: deckOf("x1"), idem: idem(), exam: "neet-pg", q: it }, { op: "review", deckId: deckOf("x1"), idem: idem(), exam: "neet-pg", q: it }]) {
    const r = await post(env, b, { token: "tok-j" });
    assert.equal(r.status, 502, b.op); assert.deepEqual([r.json.error, r.json.reason], ["ai-failed", "bad-output"]);
  }
  reply = () => ({ candidates: [{ content: { parts: [] }, finishReason: "RECITATION" }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 0 } });
  const rec = await post(env, factsBody(deckOf("x1")), { token: "tok-j" });
  assert.equal(rec.status, 502, "a RECITATION block is ai-failed");
});

test("mcq avoid: one { fi, why } (6.0) or a batched array, each reason reaching the prompt; a bad avoid is 400", async () => {
  const env = envFor(); reply = () => FACTS_REPLY;
  const facts = await startDeck(env, "av1", "tok-k");
  reply = () => JSON.stringify({ q: [Q_GOOD0] });
  const base = { op: "mcq", deckId: deckOf("av1"), exam: "neet-pg", facts };
  calls = [];
  const one = await post(env, Object.assign({ idem: idem(), avoid: { fi: 1, why: "two answers were defensible" } }, base), { token: "tok-k" });
  assert.equal(one.status, 200, JSON.stringify(one.json));
  assert.match(calls[0].body.contents[0].parts[0].text, /fact \[1\] was rejected: two answers were defensible/);
  calls = [];
  const many = await post(env, Object.assign({ idem: idem(), avoid: [{ fi: 0, why: "a blind check picked a different answer" }, { fi: 2, why: "it copied the source word for word" }] }, base), { token: "tok-k" });
  assert.equal(many.status, 200, JSON.stringify(many.json));
  const user = calls[0].body.contents[0].parts[0].text;
  assert.match(user, /fact \[0\] was rejected: a blind check picked a different answer/);
  assert.match(user, /fact \[2\] was rejected: it copied the source word for word/);
  for (const bad of [[], [{ fi: 0 }, { fi: 0 }], [{ fi: 9 }], { fi: "x" }, [{ fi: 0, why: 5 }]]) {
    const r = await post(env, Object.assign({ idem: idem(), avoid: bad }, base), { token: "tok-k" });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.deepEqual([r.json.error, r.json.reason], ["bad-input", "avoid"]);
  }
});
