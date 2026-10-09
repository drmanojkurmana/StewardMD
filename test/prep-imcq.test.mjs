/* prep-imcq.test.mjs - the image op of POST /api/ai/prep-generate (PrepNucleus Layer C, image questions from a PDF),
 * through the real /api/ai router with a mocked Vertex generateContent, in-memory KV and D1 (harness as in
 * prep-generate.test.mjs).
 * What must hold: the image reaches the model as one inline_data part next to the page text, in the same request as
 * the prompt; the op needs a started deck (the deck caps cannot be skipped); a bad or oversized image is 400 / 413
 * before any call; the model's sure flag, the cited sentences, the code gates and the page-text support gate decide
 * whether a question is kept (otherwise skipped with a reason); a kept item carries imgPlace "stem"; every call is
 * metered once like the other ops; nothing about the image is stored in KV counters.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-imcq.test.mjs
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
const idem = () => "imcq" + String(++idemN).padStart(8, "0");
const deckOf = (s) => "gen_" + C.sha12("ideck" + s);
const SENTS = [
  { n: 7, p: 3, h: "Chest radiology", tx: "Figure 2 is a chest X-ray of tension pneumothorax with mediastinal shift to the opposite side." },
  { n: 8, p: 3, h: "Chest radiology", tx: "Immediate needle decompression in the second intercostal space is life saving." },
];
const IMG = Buffer.alloc(3000, 7).toString("base64");
const FACTS_REPLY = JSON.stringify({ fs: [{ ft: "Tension pneumothorax shifts the mediastinum away.", cq: "Which way does the mediastinum shift?", sn: [7], fk: "dx" }] });
const factsBody = (deck) => ({ op: "facts", deckId: deck, idem: idem(), exam: "neet-pg", profileV: 1, pv: "p1", chunk: { i: 0, sents: SENTS } });
const imcqBody = (deck, extra) => Object.assign({ op: "imcq", deckId: deck, idem: idem(), exam: "neet-pg", profileV: 1, pv: "p1", img: { mime: "image/jpeg", data: IMG }, near: SENTS, t: "sec-0", src: { doc: "abcdef123456", name: "Chest notes.pdf" } }, extra || {});
const Q = { st: "The chest X-ray shown is of a breathless man after a road accident. What is the diagnosis?", key: { ot: "Tension pneumothorax", wr: "Mediastinal shift away from a dark hemithorax." },
  dis: [{ ot: "Massive haemothorax", wr: "Would show white-out, not a dark field.", et: "dx" }, { ot: "Lung collapse", wr: "Shift would be towards the lesion.", et: "confused" }, { ot: "Pleural effusion", wr: "Fluid, not air, with a meniscus.", et: "dx" }],
  kp: "Treat tension before the film.", sn: [7], dl: 2, cog: "application" };
async function startDeck(env, s) { reply = () => FACTS_REPLY; const r = await post(env, factsBody(deckOf(s))); assert.equal(r.status, 200, JSON.stringify(r.json)); }

test("imcq: the image is one inline_data part with the page text, in a Vertex call labelled prep; the kept item is a stem image question", async () => {
  const env = envFor({ AI_PROVIDER: "vertex" });
  await startDeck(env, "ok");
  calls = []; reply = () => JSON.stringify({ sure: true, q: [Q] });
  const r = await post(env, imcqBody(deckOf("ok")));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(calls.length, 1);
  const parts = calls[0].body.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.match(parts[0].text, /\[7\] Figure 2 is a chest X-ray/);
  assert.match(parts[0].text, /The image is attached\./);
  assert.deepEqual(parts[1], { inline_data: { mime_type: "image/jpeg", data: IMG } });
  assert.match(calls[0].body.systemInstruction.parts[0].text, /image-based single-best-answer MCQ/);
  assert.equal(calls[0].body.generationConfig.responseSchema.required.join(), "sure,kind,q", "kind is said before the question");
  assert.match(calls[0].body.systemInstruction.parts[0].text, /never be answerable by reading words/);
  assert.deepEqual(calls[0].body.labels, { app: "prep" });
  assert.equal(r.json.skipped, null);
  assert.equal(r.json.items.length, 1);
  const it = r.json.items[0];
  assert.equal(it.imgPlace, "stem");
  assert.equal(it.o[it.a], "Tension pneumothorax");
  assert.deepEqual(it.src.sn, [7]); assert.deepEqual(it.src.p, [3]);
  assert.equal(it.t, "sec-0"); assert.equal(it.prov, "USR");
  assert.ok(r.json.usage && r.json.usage.inTok > 0, "metered like every op");
  const kv = JSON.stringify([...env.MAIK_KV.m.entries()].filter(([k]) => !/^prep:idem:/.test(k)));
  assert.ok(kv.indexOf(IMG.slice(0, 40)) < 0, "no image bytes in KV counters");
});

test("imcq needs a started deck, and a bad image is refused before any model call", async () => {
  const env = envFor();
  calls = [];
  let r = await post(env, imcqBody(deckOf("never")));
  assert.equal(r.status, 400); assert.equal(r.json.reason, "deck-not-started");
  await startDeck(env, "bad"); calls = [];
  const cases = [
    [{ img: { mime: "image/gif", data: IMG } }, 400, "img"],
    [{ img: { mime: "image/jpeg", data: "not base64!!" + IMG } }, 400, "img"],
    [{ img: null }, 400, "img"],
    [{ near: [] }, 400, "near"],
    [{ img: { mime: "image/jpeg", data: "A".repeat(360004) } }, 413, null],
  ];
  for (const [extra, status, why] of cases) {
    r = await post(env, imcqBody(deckOf("bad"), extra));
    assert.equal(r.status, status, JSON.stringify(extra).slice(0, 60)); if (why) assert.equal(r.json.reason, why);
  }
  assert.equal(calls.length, 0);
});

test("imcq gates: unsure, a key the page text does not state, a number not in it, a stem that ignores the image, sentences not sent", async () => {
  const env = envFor();
  await startDeck(env, "gates");
  const cases = [
    [{ sure: false, q: [] }, "unsure"],
    [{ sure: true, q: [Object.assign({}, Q, { key: { ot: "Aortic dissection", wr: "Widened mediastinum." } })] }, "unsupported"],
    [{ sure: true, q: [Object.assign({}, Q, { key: { ot: "Pneumothorax type 3", wr: "Shift." } })] }, "g9b"],
    [{ sure: true, q: [Object.assign({}, Q, { st: "What is the diagnosis in a breathless man after a road accident?" })] }, "no-image-ref"],
    [{ sure: true, q: [Object.assign({}, Q, { sn: [99] })] }, "no-source"],
    // Owner bug 2026-10-09: a page of notes cut out whole became "Based on the table provided in the image...".
    [{ sure: true, kind: "table", q: [Q] }, "not-figure"],
    [{ sure: true, kind: "text", q: [Q] }, "not-figure"],
    [{ sure: true, kind: "radiograph", q: [Object.assign({}, Q, { st: "Based on the table provided in the image, which finding needs a needle first?" })] }, "reads-image"],
    [{ sure: true, kind: "radiograph", q: [Object.assign({}, Q, { st: "According to the text in the image shown, what is the next step?" })] }, "reads-image"],
  ];
  for (const [rep, why] of cases) {
    reply = () => JSON.stringify(rep);
    const r = await post(env, imcqBody(deckOf("gates")));
    assert.equal(r.status, 200, why); assert.equal(r.json.items.length, 0, why); assert.equal(r.json.skipped, why);
  }
  reply = () => "not json at all";
  const bad = await post(env, imcqBody(deckOf("gates")));
  assert.equal(bad.status, 502); assert.equal(bad.json.reason, "bad-output");
});

test("imcq core: sanitizeImageMcq keeps only sent sentence numbers; gateImgSupport and imageStemOk", () => {
  const r = C.sanitizeImageMcq({ sure: true, q: [Object.assign({}, Q, { sn: [7, 99, 7] })] }, [7, 8]);
  assert.deepEqual(r.sn, [7]); assert.equal(r.rq.fi, 0); assert.equal(r.rq.key.ot, "Tension pneumothorax");
  assert.equal(C.sanitizeImageMcq({ q: [] }, [7]), null, "sure is required");
  assert.equal(C.gateImgSupport({ key: { ot: "Tension pneumothoraces" } }, SENTS[0].tx), true, "word starts match");
  assert.equal(C.gateImgSupport({ key: { ot: "Aortic dissection" } }, SENTS[0].tx), false);
  assert.equal(C.imageStemOk("The ECG shown was recorded in casualty."), true);
  assert.equal(C.imageStemOk("Which drug is first line?"), false);
  assert.ok(C.PREP_OPS.indexOf("imcq") >= 0);
});

test("imcq core: kind before the question; a stem that asks to read the image is never kept", () => {
  assert.equal(C.sanitizeImageMcq({ sure: true, kind: "table", q: [Q] }, [7]).sure, false, "a table is not a figure");
  assert.equal(C.sanitizeImageMcq({ sure: true, kind: "radiograph", q: [Q] }, [7]).kind, "radiograph");
  assert.equal(C.sanitizeImageMcq({ sure: true, q: [Q] }, [7]).sure, true, "an older reply without kind still reads");
  for (const st of ["Based on the table provided in the image, which lymphoma is most common?", "The table shown lists the stages; which is stage IIB?",
    "According to the notes in the image, what is the drug of choice?", "As listed in the image above, which feature is typical?", "Using the information in the slide shown, pick the answer."])
    assert.equal(C.imageStemReads(st), true, st);
  for (const st of ["The chest X-ray shown is of a man after a road accident. What is the diagnosis?", "The image shows a skin lesion on the forearm. What is it?",
    "The ECG shown was recorded in casualty. What is the rhythm?", "The micrograph shows a lymph node biopsy. What is the diagnosis?"])
    assert.equal(C.imageStemReads(st), false, st);
  const p = C.buildImageMcqPrompt({ sents: [{ n: 1, tx: "Figure 1 is a chest X-ray." }] });
  assert.match(p.system, /when kind is text, table, chart or other, set sure to false/);
  assert.deepEqual(C.IMG_FIGURES, ["radiograph", "ct-mri", "ultrasound", "photo", "micrograph", "ecg", "diagram"]);
});
