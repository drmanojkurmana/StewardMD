/* PrepNucleus Layer C end to end: the phone's step loop (prep-create.js runRound + callOp, prep-source.js) against the
 * REAL /api/ai router and prep-generate handler, with Firebase auth mocked, in-memory KV and D1, and a mocked Vertex
 * generateContent that answers each op from the prompt it receives.
 * What must hold: a deck from pasted notes runs facts, mcq, solve, review and one batched regeneration, and saves only
 * items that passed the code gates, the blind solve and every review gate, in the 6.4 format the runner reads; the key
 * and reasons never reach the solve prompt; the deck counters come back and the cap line shows them; an idempotent
 * replay costs nothing and a lost response is recovered by resending the same idem; "10 more" sends only unused
 * facts; a 429 month-decks and a 400 deck-not-started show their plain messages and save nothing.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-layerc-e2e.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const CLAIMS = {};
for (const u of ["a", "b", "c", "d"]) CLAIMS["tok-" + u] = { sub: "u-" + u, email: u + "@example.com", email_verified: true };
const realAuth = await import("../functions/_fbauth.js");
const claimsOf = (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null;
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => claimsOf(req), cfAccessEmail: async () => "", identify: async (req) => { const c = claimsOf(req); return c ? "fb:" + c.sub : null; } } });

const { onRequest } = await import("../functions/api/ai/[[path]].js");
const Core = await import("../functions/_prep-core.js");
const { istDay } = await import("../functions/_counters.js");
const req = createRequire(import.meta.url);
const SR = req("../prep-source.js");
const DK = req("../prep-decks.js");
const PC = req("../prep-create.js");
const MONTH = istDay(Date.now()).slice(0, 7);

/* ---------------- server fakes (as test/prep-generate.test.mjs) ---------------- */
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
const envFor = () => ({ VERTEX_API_KEY: "vk-test", GEMINI_API_KEY: "dev-test", AI_PROVIDER: "developer", MAIK_KV: fakeKv(), UPDATES_DB: fakeD1(), MAIK_ENFORCE_CAPS: "1", MAIK_RATE_LIMIT_SECONDS: "0.001" });

/* ---------------- Vertex mock: answers each op from its prompt ---------------- */
const KEY = { ot: "It is stated in the notes", wr: "The note says so directly" };
const DIS = [{ ot: "It is never mentioned", wr: "The notes do not say this", et: "knowledge" }, { ot: "It is the opposite case", wr: "The note states the reverse", et: "confused" }, { ot: "It applies only to children", wr: "No age group is named", et: "knowledge" }];
const KP = "Revise this point once more";
const schemaOp = (s) => Object.keys(Core.SCHEMAS).find((k) => JSON.stringify(Core.SCHEMAS[k]) === JSON.stringify(s));
let vertex = [];
function answer(op, user) {
  if (op === "facts") {
    const f = [];
    user.replace(/^\[(\d+)\] (.*)$/gm, (_, n, tx) => { f.push({ ft: tx, cq: "Which point do the notes make about " + tx.split(" ").slice(0, 4).join(" ") + "?", sn: [Number(n)], fk: "recall" }); return ""; });
    return { f: f.slice(0, 15) };
  }
  if (op === "mcq") {
    const regen = /was rejected/.test(user), q = [];
    user.replace(/^\[(\d+)\] (.*)$/gm, (_, i, ft) => {
      const key = /Pernicious/.test(ft) && !regen ? { ot: KEY.ot, wr: "True in 99 percent of cases" } : KEY;   // gate 9b: 99 is not in the source
      q.push({ st: (regen ? "Rewritten check: " : "Check: ") + "which option fits the note on " + ft.replace(/[.?]$/, "").split(" ").slice(0, 8).join(" ") + "?", key, dis: DIS, kp: KP, fi: Number(i), dl: 2, cog: "recall" });
      return "";
    });
    return { q };
  }
  if (op === "solve") {
    const s = [];
    user.replace(/^Q(\d+): (.*)$/gm, (_, i, st) => { s.push({ i: Number(i), ot: /Serum/.test(st) && !/Rewritten/.test(st) ? DIS[0].ot : KEY.ot }); return ""; });
    return { s };
  }
  const g = [];
  user.replace(/^Q(\d+): (.*)$/gm, (_, i, st) => { const bad = /Hypersegmented/.test(st) && !/Rewritten/.test(st); g.push({ i: Number(i), g4: true, g6: true, g7: !bad, g8: true, g9: true, g10: true, g11: true, old: false, why: bad ? "a distractor is also right" : "" }); return ""; });
  return { g };
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  if (String(u).indexOf("generateContent") < 0) return new Response("{}");
  const body = JSON.parse(init.body), op = schemaOp(body.generationConfig.responseSchema), user = body.contents[0].parts[0].text;
  vertex.push({ op, user, system: body.systemInstruction && body.systemInstruction.parts[0].text });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer(op, user)) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 300, thoughtsTokenCount: 0 } }));
};
process.on("exit", () => { globalThis.fetch = realFetch; });

/* ---------------- the phone side ---------------- */
// The client's own callOp, with fetch wired straight to the router's onRequest (no network).
function phone(env, token, opts) {
  const o = opts || {}, log = [];
  const fetchToRouter = async (url, init) => {
    const r = await onRequest({ request: new Request("https://stewardmd.in" + url, init), env, params: { path: ["prep-generate"] }, waitUntil: () => {} });
    await new Promise((res) => setTimeout(res, 5));   // the per-user rate slot (1 ms here) clears
    const text = await r.text(), body = JSON.parse(init.body);
    log.push({ op: body.op, body, status: r.status, replay: r.headers.get("X-Prep-Replay") === "1", json: JSON.parse(text) });
    if (o.drop && o.drop(body, log)) throw new TypeError("Failed to fetch");   // the response is lost on the way back
    return { ok: r.ok, status: r.status, text: async () => text };
  };
  const waits = [];
  const send = (body) => PC.callOp(body, { url: PC.URL, fetch: fetchToRouter, token: async () => token, wait: async (ms) => { waits.push(ms); } });
  return { send, log, waits };
}
function memStore() {
  const s = { src: {}, decks: {}, facts: {}, items: {}, cards: {} };
  const put = (o, key) => async (recs) => { (Array.isArray(recs) ? recs : [recs]).forEach((r) => { o[r[key]] = JSON.parse(JSON.stringify(r)); }); };
  return { s, putSrc: put(s.src, "deckId"), putDeck: put(s.decks, "id"), putFacts: put(s.facts, "id"), putItems: put(s.items, "id"), putCards: put(s.cards, "id") };
}
const NOTES = [
  "# Iron deficiency anaemia",
  "Iron deficiency is the commonest cause of anaemia in Indian women of reproductive age.",
  "Serum ferritin below 15 ng/mL confirms depleted iron stores.",
  "Microcytic hypochromic red cells with pencil forms are typical on the peripheral smear.",
  "Oral ferrous sulphate 200 mg three times daily supplies about 180 mg elemental iron.",
  "Haemoglobin should rise by roughly 2 g/dL within three weeks of adequate oral therapy.",
  "Parenteral ferric carboxymaltose suits patients intolerant of tablets.",
  "",
  "MEGALOBLASTIC ANAEMIA",
  "Vitamin B12 deficiency causes subacute combined degeneration of the spinal cord.",
  "Hypersegmented neutrophils with five or more lobes appear early in folate deficiency.",
  "Pernicious anaemia results from autoantibodies against gastric intrinsic factor.",
  "Folic acid alone may worsen neurological damage when cobalamin is also lacking.",
  "Strict vegetarians frequently develop dietary cobalamin shortage over several years.",
  "Methylmalonic acid rises in cobalamin deficiency but stays normal with folate lack.",
  "",
  "Haemolytic anaemia:",
  "Spherocytes and raised osmotic fragility point towards hereditary spherocytosis.",
  "Glucose six phosphate dehydrogenase deficiency triggers haemolysis after primaquine exposure.",
  "Bite cells and Heinz bodies accompany oxidant injury to erythrocytes.",
  "Direct antiglobulin testing distinguishes immune destruction from intrinsic membrane defects.",
  "Splenectomy reduces transfusion needs in severe spherocytosis after early childhood.",
  "Raised unconjugated bilirubin and reticulocytosis reflect brisk erythrocyte turnover.",
].join("\n");
const TODAY = PC.dayKey();
function newDeckJob(uid, text) {
  const doc = SR.docFromNotes(SR.prepScrub(text || NOTES), "Notes"), sha = DK.sha256(SR.docText(doc));
  const id = PC.deckIdFor({ uid, sha, exam: "neet-pg", profileV: 1 });
  const m = DK.newManifest({ id, title: PC.defaultTitle(doc, ""), exam: "neet-pg", profileV: 1, pv: PC.PV, model: PC.MODEL, source: { type: "paste", name: "", pages: null, sha } });
  return PC.newJob({ m, sents: doc.sents, sections: doc.sections, facts: [], items: [], saved: false, target: 10, profile: PC.PROFILE, ctx: { doc: sha.slice(0, 12), name: m.title, exam: "neet-pg", pv: PC.PV, model: PC.MODEL } });
}
const moreJob = (store, id, target) => PC.newJob({ m: store.s.decks[id], sents: store.s.src[id].sents, sections: store.s.src[id].sections, facts: Object.values(store.s.facts), items: Object.values(store.s.items), saved: true, target: target || 10, profile: PC.PROFILE, ctx: { doc: "abcdefabcdef", name: "Notes", exam: "neet-pg", pv: PC.PV, model: PC.MODEL } });
const recCount = (env, email) => Number(env.MAIK_KV.m.get("aiu:mod:em:" + email + ":prep:" + istDay(Date.now()))) || 0;

/* ---------------- tests ---------------- */
const env = envFor(), store = memStore(), A = phone(env, "tok-a"), caps = [];
let job, res;

test("a full deck from pasted notes: facts, mcq, solve, review and one batched regeneration against the real handler", async () => {
  vertex = [];
  job = newDeckJob("u-a");
  res = await PC.runRound(job, { send: A.send, store, today: TODAY, onCaps: (c) => caps.push(c) });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(A.log.map((x) => x.op), ["facts", "facts", "mcq", "mcq", "solve", "solve", "review", "review", "mcq", "solve", "review"], "facts until the round has its 10, then two batches of 5");
  assert.ok(A.log.every((x) => x.status === 200 && !x.replay), "every op accepted first time: " + A.log.map((x) => x.status + (x.json.reason ? ":" + x.json.reason : "")).join(","));
  assert.deepEqual(vertex.map((v) => v.op), A.log.map((x) => x.op), "exactly one model call per op");
  // The three failures: a code gate (9b), the blind solve, a review gate; each fact regenerated once, in one call.
  const mcq1 = A.log.filter((x) => x.op === "mcq").slice(0, 2);
  assert.ok(mcq1.some((x) => x.json.rejected.some((r) => r.gate === "g9b")), "the server rejected the 99 percent key at gate 9b");
  const regen = A.log[8];
  assert.equal(regen.body.facts.length, 3);
  assert.ok(Array.isArray(regen.body.avoid) && regen.body.avoid.length === 3);
  const regenPrompt = vertex[8].user;
  for (const why of ["a number in the key is not in the source", "a blind check picked a different answer", "a distractor is also right"]) assert.ok(regenPrompt.includes("was rejected: " + why), why);
  assert.equal(res.accepted, 10, "a round makes at most its 10");
  assert.equal(job.m.stats.regenerated, 3);
  assert.equal(job.m.stats.rejected, 2, "solve and review rejections (the code-gate drop never became an item)");
});

test("only gate-passing items are saved, in the 6.4 format the runner reads", () => {
  const items = Object.values(store.s.items);
  assert.equal(items.length, 10);
  const keys = ["_m", "_s", "a", "cog", "d", "deckId", "et", "ex", "exp", "fid", "gen", "id", "kp", "mv", "o", "prov", "pv", "q", "r", "rv", "src", "t"];
  for (const it of items) {
    assert.deepEqual(Object.keys(it).sort(), keys, it.id);
    assert.match(it.id, /^q_[0-9a-f]{12}$/);
    assert.equal(it.o.length, 4); assert.equal(it.o[it.a], KEY.ot, "the shuffle kept the key");
    assert.equal(it.exp, KEY.wr); assert.equal(it.et[it.a], null);
    assert.deepEqual(it.rv, { solved: true, pass: true, old: false });
    assert.equal(it.prov, "USR"); assert.equal(it.gen, "AI"); assert.deepEqual(it.ex, ["neet-pg"]); assert.equal(it.pv, "p1"); assert.equal(it.mv, "gemini-3.1-flash-lite");
    assert.match(it.t, /^sec-[0-2]$/, "the section id the phone sent comes back on the item");
    assert.equal(it._s, "deck"); assert.equal(it._m, "deck-" + job.deckId); assert.equal(it.deckId, job.deckId);
    assert.ok(Array.isArray(it.src.sn) && it.src.sn.length && Array.isArray(it.src.p));
  }
  for (const w of ["Pernicious", "Serum", "Hypersegmented"]) {
    const hit = items.filter((it) => it.q.includes(w));
    assert.equal(hit.length, 1, w); assert.match(hit[0].q, /^Rewritten/, w + ": only the regenerated question is saved");
  }
  assert.equal(DK.questionCount(store.s.decks[job.deckId]), 10);
  assert.equal(Object.keys(store.s.cards).length, 12, "one card per fact");
});

test("the key and the reasons never reach the solve prompt", () => {
  const solves = vertex.filter((v) => v.op === "solve");
  assert.equal(solves.length, 3);
  for (const s of solves) {
    assert.ok(!/Key:|reason|Pearl/i.test(s.user), "no key line, reason or pearl");
    assert.ok(!s.user.includes(KEY.wr) && !s.user.includes(KP));
  }
  const solveBodies = A.log.filter((x) => x.op === "solve");
  assert.ok(solveBodies.every((x) => x.body.q.every((q) => Number.isInteger(q.a))), "a travels in the request, for the server's compare");
  const review = vertex.find((v) => v.op === "review");
  assert.match(review.user, /Key: [A-D]/, "the reviewer, unlike the solver, sees the key");
  assert.match(review.user, /Source paragraph: \[\d+\] /);
  assert.ok(A.log.filter((x) => x.op === "review").every((x) => x.body.q.every((q) => Array.isArray(q.r) && q.r.length === 4 && q.r.every(Boolean))), "review gets every reason (gate 1 guarantees them)");
  assert.match(review.user, /\(reason: The note says so directly\)/);
});

test("deck counters come back on every response and the cap line shows them; cost is metered", () => {
  assert.ok(A.log.every((x) => x.json.usage && x.json.usage.dayDecks === 1 && x.json.usage.monthDecks === 1));
  assert.deepEqual(caps.at(-1), { month: 1, day: 1, at: TODAY });
  assert.equal(PC.capLine(job.caps, TODAY), "1 of 30 decks this month, 1 of 5 today");
  assert.equal(job.m.cost.inTok, 11 * 900);
  assert.equal(job.m.cost.outTok, 11 * 300);
  assert.ok(job.m.cost.inr > 0);
  assert.match(PC.costLine(job.m.cost), /^Cost so far: Rs \d+\.\d\d \(13200 tokens\)$/);
  assert.equal(recCount(env, "a@example.com"), 11, "one usage record per call");
  assert.ok(job.m.cost.mt > 0 && job.m.cost.mt === Math.round(job.m.cost.mt), "MaiK Tokens add up from every call");
});

test("an idempotent replay is free: same idem, no model call, no record, no extra deck", async () => {
  const before = vertex.length, recs = recCount(env, "a@example.com");
  const body = { op: "facts", deckId: job.deckId, exam: "neet-pg", profileV: 1, pv: "p1", chunk: SR.chunkPayload(job.chunks[0]) };
  const out = await A.send(body);
  assert.equal(A.log.at(-1).replay, true);
  assert.equal(A.log.at(-1).body.idem, A.log[0].body.idem, "the phone computes the same idem for the same request");
  assert.deepEqual(out, A.log[0].json);
  assert.equal(vertex.length, before);
  assert.equal(recCount(env, "a@example.com"), recs);
  assert.equal(env.MAIK_KV.m.get("prep:decks:fb:u-a:" + MONTH), "1");
});

test("a lost response: the run pauses offline, and the resend with the same idem is answered from the replay record", async () => {
  const env2 = envFor(), st2 = memStore();
  let dropped = false;
  const P = phone(env2, "tok-d", { drop: (b) => { if (b.op === "mcq" && !dropped) { dropped = true; return true; } return false; } });
  const j = newDeckJob("u-d");
  const r1 = await PC.runRound(j, { send: P.send, store: st2, today: TODAY });
  assert.equal(r1.ok, false); assert.equal(r1.code, "offline"); assert.equal(r1.retry, true);
  assert.match(r1.message, /No connection/);
  const modelCalls = vertex.length;
  const r2 = await PC.runRound(j, { send: P.send, store: st2, today: TODAY });
  assert.equal(r2.ok, true);
  const resent = P.log.filter((x) => x.op === "mcq")[1];
  assert.equal(resent.replay, true, "the resent mcq is a replay");
  assert.equal(resent.body.idem, P.log.filter((x) => x.op === "mcq")[0].body.idem);
  assert.equal(vertex.length - modelCalls, P.log.length - P.log.indexOf(resent) - 1, "no model call for the replay");
  assert.equal(r2.accepted, 10);
});

test("10 more: unused facts first, then the next chunk; no new deck counted", async () => {
  const before = A.log.length;
  const more = moreJob(store, job.deckId);
  const usedBefore = new Set(Object.values(store.s.facts).filter((f) => f.used).map((f) => f.id));
  const r = await PC.runRound(more, { send: A.send, store, today: TODAY });
  const calls = A.log.slice(before);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(calls.map((x) => x.op), ["facts", "mcq", "mcq", "solve", "solve", "review", "review"]);
  const sent = calls.filter((x) => x.op === "mcq").flatMap((x) => x.body.facts);
  assert.ok(sent.every((f) => !usedBefore.has(f.fid)), "no used fact is sent again");
  assert.equal(sent.length, 8, "the 2 facts left and the last chunk's 6");
  assert.equal(r.accepted, 8); assert.equal(r.more, false);
  assert.equal(Object.keys(store.s.items).length, 18);
  assert.equal(calls.at(-1).json.usage.monthDecks, 1, "10 more is not a new deck");
});

test("429 month-decks: the monthly-limit message, the cap line shows the month full, nothing saved", async () => {
  env.MAIK_KV.m.set("prep:decks:fb:u-b:" + MONTH, "30");
  const B = phone(env, "tok-b"), st = memStore(), seen = [];
  const j = newDeckJob("u-b");
  const before = vertex.length;
  const r = await PC.runRound(j, { send: B.send, store: st, today: TODAY, onCaps: (c) => seen.push(c) });
  assert.equal(B.log.length, 1); assert.equal(B.log[0].status, 429);
  assert.deepEqual([B.log[0].json.error, B.log[0].json.reason], ["quota", "month-decks"]);
  assert.equal(r.ok, false); assert.equal(r.code, "month-decks"); assert.equal(r.retry, false);
  assert.equal(r.message, "You have made 30 decks this month, the monthly limit. Your decks still work for practice.");
  assert.match(PC.capLine(j.caps, TODAY), /^30 of 30 decks this month/);
  assert.equal(vertex.length, before, "no model call");
  assert.equal(Object.keys(st.s.decks).length + Object.keys(st.s.items).length + Object.keys(st.s.src).length, 0);
});

test("400 deck-not-started: a deck the server never saw a facts call for cannot get questions", async () => {
  // Another account asks for "10 more" on a deck it never started (its facts exist only on the phone).
  const fresh = memStore();
  const j = newDeckJob("u-a");
  const pre = await PC.runRound(j, { send: phone(envFor(), "tok-a").send, store: fresh, today: TODAY });
  assert.equal(pre.ok, true);
  const C = phone(env, "tok-c");
  const more = moreJob(fresh, j.deckId, 2);   // 2 wanted, 2 unused facts: the first call is mcq, not facts
  const before = vertex.length;
  const r = await PC.runRound(more, { send: C.send, store: fresh, today: TODAY });
  assert.equal(C.log.length, 1);
  assert.equal(C.log[0].status, 400); assert.deepEqual([C.log[0].json.error, C.log[0].json.reason], ["bad-input", "deck-not-started"]);
  assert.equal(r.ok, false); assert.equal(r.code, "deck-not-started"); assert.equal(r.retry, false);
  assert.match(r.message, /no longer knows this deck/);
  assert.equal(vertex.length, before);
});

test("server error vocabulary maps to the phone's messages", () => {
  for (const reason of ["rate", "circuit-breaker", "daily-calls", "daily-decks", "month-decks", "token-cap"]) assert.equal(PC.errorCode(429, { error: "quota", reason }), reason);
  for (const reason of ["body", "chunk", "pages", "chars"]) assert.equal(PC.errorCode(413, { error: "too-large", reason }), "too-large");
  assert.equal(PC.errorCode(400, { error: "bad-input", reason: "mix" }), "bad-input");
  assert.equal(PC.errorCode(502, { error: "ai-failed", reason: "bad-output" }), "ai-failed");
  assert.equal(PC.errorCode(504, { error: "ai-timeout", reason: "ai-timeout" }), "ai-timeout");
  assert.equal(PC.errorCode(401, { error: "sign-in", reason: "sign-in" }), "sign-in");
  assert.equal(PC.errorCode(429, { error: "quota" }), "rate");
});
