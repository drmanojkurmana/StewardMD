/* POST /api/ai/prep-generate - PrepNucleus Layer C: a student's notes or PDF to a question deck.
 * Contract: vault/plans/PrepNucleus-LayerC.md 6.0 (protocol), 6.8 (metering), 8 (gates, privacy), 9.3 (caps);
 * caps per owner decision D6 in vault/plans/PrepNucleus.md (every signed-in user, no plan split).
 *
 * One op per request, one Gemini call per op, so each request fits the router's 28 s deadline:
 *   facts   { chunk: { i, sents: [{ n, p, h, tx }] } }              -> { facts, dropped, usage }
 *   mcq     { facts: [<= 7 { fid, ft, sn, sents | quote, p, h, t? }], mix?, avoid?, src? }
 *                                                                   -> { items (6.4, gated, shuffled, rv null), rejected, usage }
 *   solve   { q: [<= 7 { id, q, o[4], a }] }  a stays here; only stem and options reach the model
 *                                                                   -> { solved: [{ id, ok, ot }], usage }
 *   review  { q: [<= 7 { id, q, o[4], a, r?, kp? }], para: { id: text } } -> { gates: [{ id, i, g4..g11, old, why, pass }], usage }
 * Common fields: { op, deckId: "gen_<sha12>", idem, exam, profileV?, pv? }.
 * usage = { inTok, outTok, thinkTok, inr, deckTok, deckCapTok, dayDecks, monthDecks }.
 *
 * Errors are { error, reason, retryAfter? }:
 *   400 bad-input (reason names the field), 401 sign-in, 413 too-large (body | chunk | pages | chars),
 *   429 error "quota" with reason rate | circuit-breaker | daily-calls | daily-decks | month-decks | token-cap,
 *   502 ai-failed (reason provider | bad-output), 504 ai-timeout. 402 needs-plan is unused (D6).
 *
 * Gate order (6.8): sign-in, size, input, idempotent replay (free), checkQuota type "prep" (breaker and rate
 * limit), gateAndCount("prep", deferRecord) (95 calls a day), then prep's KV counters: decks a day (3) and a
 * month (10), counted once per deck at its first accepted facts call, and the per-deck token cap (200k, checked
 * before the call, fail closed). A mcq, solve or review on a deck that never had an accepted facts call is a
 * 400 (deck-not-started), so the deck caps cannot be skipped by never calling facts.
 *
 * Metering: after every Gemini call (success or not) exactly one usage record (commit(extra): model, real
 * tokens, cost, feature "prep:<op>", latency, status), the cost fed to the project breaker (addDailyCostInr)
 * and to the console's maik.cost counter. Never _usage.js recordUsage (MaiK rate, MaiK allowance).
 *
 * Privacy (8.5): every student string is run through prepScrub before it reaches a prompt. Nothing is logged.
 * KV holds counters only, plus the 10 minute idempotency record, which is AES-GCM sealed with a key derived
 * from the caller's uid and the exact request body: the server cannot read it back without that same request.
 * Vertex only (labels { app: "prep" } reach Cloud Billing), model PREP_MODEL (default MODEL_HARD_DEFAULT,
 * the admin override is ignored), thinkingBudget 0 (genBody), responseSchema JSON.
 */
import { checkQuota, usageKv, identify, usageKeyFor, meterEmail, addDailyCostInr, estTokens } from "../../_usage.js";
import { gateAndCount, buildUsageRecord, recordAiUsage, estCostInr, envModel, MODEL_HARD_DEFAULT } from "../../_ai_usage.js";
import { bump, istDay, istNextMidnightMs } from "../../_counters.js";
import { ownerOK } from "../../_adminauth.js";
import {
  PREP_OPS, PREP_LIMITS, getProfile, cleanText, prepScrub, parseModelJson,
  buildFactsPrompt, buildMcqPrompt, buildSolvePrompt, buildReviewPrompt,
  sanitizeFacts, sanitizeMcq, sanitizeSolve, sanitizeReview, finalizeFacts, reviewPass,
  gateBatch, mulberry32, seedFrom, keyPositions, shuffleOptions, solveMatches, toStoredItem,
} from "../../_prep-core.js";

export const PREP_BODY_MAX = 400 * 1024;      // bytes
export const PREP_CHUNK_TOK_MAX = 6000;       // facts chunk, estimated at chars / 4
const IDEM_TTL_S = 600;
const DECK_TTL_S = 400 * 86400;               // the deck's token record outlives any "10 more" a student asks for
const MONTH_TTL_S = 40 * 86400, DAY_TTL_S = 2 * 86400;
const IST_MS = 5.5 * 3600 * 1000;
const RE = { deck: /^gen_[a-f0-9]{12}$/, idem: /^[A-Za-z0-9_-]{8,64}$/, fid: /^f_[a-f0-9]{12}$/, id: /^[A-Za-z0-9_-]{1,64}$/, t: /^[a-z0-9-]{1,40}$/, doc: /^[a-f0-9]{6,64}$/, pv: /^[A-Za-z0-9.-]{1,16}$/ };

const num = (env, k, d) => { const v = Number(env && env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
export function prepCaps(env) {
  return {
    decksDay: num(env, "PREP_DECKS_PER_DAY", 3),
    decksMonth: num(env, "PREP_DECKS_PER_MONTH", 10),
    deckTok: num(env, "PREP_DECK_TOKEN_CAP", 200000),
    pages: num(env, "PREP_PAGE_CAP", 60),
    chars: num(env, "PREP_CHARS_CAP", 300000),
  };
}
const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (status, error, reason, extra) => json(Object.assign({ error, reason }, extra || {}), status);
const quota = (reason, retryAfter, extra) => fail(429, "quota", reason, Object.assign(retryAfter ? { retryAfter } : {}, extra || {}));
const isTimeout = (e) => !!(e && (e.timeout || e.name === "AbortError" || e.name === "TimeoutError")) || /\btimeout\b|timed out|deadline exceeded/i.test(String((e && e.message) || e));
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isStr = (v, lo, hi) => typeof v === "string" && v.trim().length >= lo && v.length <= hi;
const scrub = (s, max) => prepScrub(cleanText(s, max));

/* ---- input (400) ---- */
function readOptions(o) { return Array.isArray(o) && o.length === 4 && o.every((x) => isStr(x, 1, 400)); }
function readSents(list, max, txMax) {
  if (!Array.isArray(list) || !list.length || list.length > max) return null;
  const seen = new Set(), out = [];
  for (const s of list) {
    if (!s || typeof s !== "object" || !isInt(s.n, 1, 1e7) || seen.has(s.n) || !isStr(s.tx, 1, txMax)) return null;
    const p = s.p == null ? 0 : s.p;
    if (!isInt(p, 0, 100000) || (s.h != null && typeof s.h !== "string")) return null;
    seen.add(s.n);
    out.push({ n: s.n, p, h: scrub(s.h || "", 200), tx: scrub(s.tx, txMax) });
  }
  return out;
}
function readMix(m) {
  if (m == null) return null;
  if (typeof m !== "object") return undefined;
  const w = (x, keys) => { if (x == null) return undefined; if (typeof x !== "object") return null; const o = {}; for (const k of keys) { if (x[k] == null) continue; const v = Number(x[k]); if (!Number.isFinite(v) || v < 0 || v > 1) return null; o[k] = v; } return o; };
  const out = {};
  if (m.dl != null) { if (isInt(m.dl, 1, 3)) out.dl = m.dl; else { const o = w(m.dl, ["1", "2", "3"]); if (!o) return undefined; out.dl = o; } }
  if (m.cog != null) { if (typeof m.cog === "string") { if (["recall", "application", "reasoning"].indexOf(m.cog) < 0) return undefined; out.cog = m.cog; } else { const o = w(m.cog, ["recall", "application", "reasoning"]); if (!o) return undefined; out.cog = o; } }
  return out;
}
/* readRequest(body) -> { ok: true, req } | { ok: false, status, reason }. Every string that can reach a prompt
 * is scrubbed here, once. */
export function readRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  const bad = (reason, status) => ({ ok: false, status: status || 400, reason });
  if (PREP_OPS.indexOf(b.op) < 0) return bad("op");
  if (!RE.deck.test(String(b.deckId || ""))) return bad("deckId");
  if (!RE.idem.test(String(b.idem || ""))) return bad("idem");
  const profile = getProfile(b.exam);
  if (!profile) return bad("exam");
  if (b.profileV != null && !isInt(b.profileV, 0, 9999)) return bad("profileV");
  if (b.pv != null && !RE.pv.test(String(b.pv))) return bad("pv");
  const req = { op: b.op, deckId: b.deckId, idem: b.idem, exam: profile.id, profile };
  if (b.op === "facts") {
    const c = b.chunk;
    if (!c || typeof c !== "object" || (c.i != null && !isInt(c.i, 0, 100000))) return bad("chunk");
    const sents = readSents(c.sents, 1500, 4000);
    if (!sents) return bad("chunk.sents");
    req.sents = sents;
    req.chars = sents.reduce((t, s) => t + s.tx.length + s.h.length, 0);
    if (estTokens(req.chars) > PREP_CHUNK_TOK_MAX) return bad("chunk", 413);
    req.pages = Array.from(new Set(sents.map((s) => s.p)));
  } else if (b.op === "mcq") {
    if (!Array.isArray(b.facts) || !b.facts.length || b.facts.length > PREP_LIMITS.mcq.maxItems) return bad("facts");
    req.facts = [];
    for (const f of b.facts) {
      if (!f || typeof f !== "object" || !RE.fid.test(String(f.fid || "")) || !isStr(f.ft, 1, 400)) return bad("facts");
      if (!Array.isArray(f.sn) || !f.sn.length || f.sn.length > 2 || !f.sn.every((n) => isInt(n, 1, 1e7))) return bad("facts.sn");
      let sents = null, quote = "";
      if (f.sents != null) { sents = readSents(f.sents, 4, 2000); if (!sents) return bad("facts.sents"); }
      else if (isStr(f.quote, 1, 4000)) quote = scrub(f.quote, 4000);
      else return bad("facts.quote");
      if (f.p != null && !(Array.isArray(f.p) && f.p.length <= 8 && f.p.every((p) => isInt(p, 0, 100000)))) return bad("facts.p");
      if (f.h != null && typeof f.h !== "string") return bad("facts.h");
      if (f.t != null && !RE.t.test(String(f.t))) return bad("facts.t");
      req.facts.push({ fid: f.fid, ft: scrub(f.ft, 400), sn: f.sn.slice(), sents, quote: sents ? sents.map((s) => s.tx).join(" ") : quote, p: (f.p || (sents ? Array.from(new Set(sents.map((s) => s.p))) : [])).slice(), h: scrub(f.h || (sents ? sents[0].h : ""), 200), t: f.t || null });
    }
    const mix = readMix(b.mix);
    if (mix === undefined) return bad("mix");
    req.mix = mix;
    if (b.avoid != null) {
      if (typeof b.avoid !== "object" || !isInt(b.avoid.fi, 0, req.facts.length - 1) || (b.avoid.why != null && !isStr(b.avoid.why, 0, 300))) return bad("avoid");
      req.avoid = { fi: b.avoid.fi, why: scrub(b.avoid.why || "", 200) };
    }
    if (b.src != null) {
      if (typeof b.src !== "object" || (b.src.doc != null && !RE.doc.test(String(b.src.doc))) || (b.src.name != null && !isStr(b.src.name, 0, 200))) return bad("src");
      req.src = { doc: b.src.doc || "", name: scrub(b.src.name || "", 160) };
    }
  } else {
    if (!Array.isArray(b.q) || !b.q.length || b.q.length > PREP_LIMITS[b.op].maxItems) return bad("q");
    req.q = [];
    for (const it of b.q) {
      if (!it || typeof it !== "object" || !RE.id.test(String(it.id || "")) || !isStr(it.q, 1, 2000) || !readOptions(it.o) || !isInt(it.a, 0, 3)) return bad("q");
      const x = { id: it.id, q: scrub(it.q, 2000), o: it.o.map((o) => scrub(o, 400)), a: it.a };
      if (b.op === "review") {
        if (it.r != null) { if (!readOptions(it.r)) return bad("q.r"); x.r = it.r.map((r) => scrub(r, 400)); }
        if (it.kp != null) { if (!isStr(it.kp, 0, 400)) return bad("q.kp"); x.kp = scrub(it.kp, 400); }
      }
      req.q.push(x);
    }
    if (new Set(req.q.map((x) => x.id)).size !== req.q.length) return bad("q.id");
    if (b.op === "review") {
      const para = b.para == null ? {} : b.para;
      if (typeof para !== "object" || Array.isArray(para)) return bad("para");
      req.paras = {};
      for (const it of req.q) {
        const t = para[it.id];
        if (t != null && !isStr(t, 0, 2000)) return bad("para");
        req.paras[it.id] = scrub(t || "", 2000);
      }
    }
  }
  return { ok: true, req };
}

/* ---- prompt per op ---- */
function promptFor(req) {
  if (req.op === "facts") return buildFactsPrompt({ sents: req.sents });
  if (req.op === "mcq") return buildMcqPrompt({ facts: req.facts, profile: req.profile, mix: req.mix, avoid: req.avoid });
  // Blind solve: only stem and options are handed to the builder, never a.
  if (req.op === "solve") return buildSolvePrompt({ items: req.q.map((it) => ({ q: it.q, o: it.o })) });
  return buildReviewPrompt({ items: req.q, paras: req.paras, profile: req.profile });
}

/* ---- model output per op -> response payload, or null for malformed output (502) ---- */
function finish(req, text, model) {
  const raw = parseModelJson(text);
  if (req.op === "facts") {
    const f = sanitizeFacts(raw); if (!f) return null;
    const r = finalizeFacts(f, req.sents, req.deckId);
    return { facts: r.facts, dropped: r.dropped.length };
  }
  if (req.op === "mcq") {
    const rqs = sanitizeMcq(raw, req.facts.length); if (!rqs) return null;
    const g = gateBatch(rqs, (fi) => req.facts[fi].quote, []);
    const rnd = mulberry32(seedFrom(req.deckId + ":" + req.idem));
    const pos = keyPositions(g.kept.length, rnd);
    const items = g.kept.map((rq, k) => {
      const f = req.facts[rq.fi];
      return toStoredItem(rq, shuffleOptions(rq, pos[k], rnd), { deckId: req.deckId, fact: f, prov: "USR", exam: req.exam, mv: model, src: req.src, t: f.t || undefined });
    });
    return { items, rejected: g.rejected.map((r) => ({ fi: r.fi, fid: req.facts[r.fi].fid, gate: r.gate })) };
  }
  if (req.op === "solve") {
    const picks = sanitizeSolve(raw, req.q.length); if (!picks) return null;
    return { solved: req.q.map((it, i) => ({ id: it.id, ok: solveMatches(picks[i], it), ot: picks[i] })) };
  }
  const gs = sanitizeReview(raw, req.q.length); if (!gs) return null;
  return { gates: req.q.map((it, i) => Object.assign({ id: it.id, i }, gs[i], { pass: reviewPass(gs[i]) })) };
}

/* ---- idempotency record, sealed so it is unreadable without the same request ---- */
const _enc = new TextEncoder();
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function idemKey(uid, canon) {
  const d = await crypto.subtle.digest("SHA-256", _enc.encode(uid + "\n" + canon));
  return crypto.subtle.importKey("raw", d, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function idemSeal(uid, canon, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await idemKey(uid, canon), _enc.encode(text));
  return b64(iv) + "." + b64(new Uint8Array(ct));
}
async function idemOpen(uid, canon, sealed) {
  try {
    const [iv, ct] = String(sealed).split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await idemKey(uid, canon), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch (e) { return null; }   // another payload under the same idem: not a replay
}

function secsToNextIstMonth(now) {
  const t = new Date(now + IST_MS);
  return Math.max(1, Math.ceil((Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) - IST_MS - now) / 1000));
}
const readNum = (s) => Number(s) || 0;
function readDeck(s) { try { const o = s ? JSON.parse(s) : null; return o && typeof o === "object" ? { tok: Number(o.tok) || 0, pg: Array.isArray(o.pg) ? o.pg : [], ch: Number(o.ch) || 0 } : null; } catch (e) { return null; } }

/* handlePrepGenerate({ request, env, body, callGemini, waitUntil, now? }) -> Response.
 * callGemini is the router's (functions/api/ai/[[path]].js), injected to avoid a circular import. */
export async function handlePrepGenerate(ctx) {
  const { request, env, body, callGemini } = ctx;
  const later = (p) => { const w = ctx.waitUntil; if (typeof w === "function") { try { w(Promise.resolve(p).catch(() => {})); return; } catch (e) {} } return p; };
  const now = ctx.now || Date.now();
  if (request.method !== "POST") return fail(400, "bad-input", "method");

  // 1. sign-in
  let who = null;
  try { who = await identify(request, env); } catch (e) { who = null; }
  if (!who || who.guest || !who.id) return fail(401, "sign-in", "sign-in");
  const uid = who.id;

  // 2. size and shape
  if (Number(request.headers.get("Content-Length")) > PREP_BODY_MAX) return fail(413, "too-large", "body");
  if (!/application\/json/i.test(request.headers.get("Content-Type") || "")) return fail(400, "bad-input", "content-type");
  let canon = "";
  try { canon = JSON.stringify(body || {}); } catch (e) { return fail(400, "bad-input", "body"); }
  if (_enc.encode(canon).length > PREP_BODY_MAX) return fail(413, "too-large", "body");
  const rr = readRequest(body);
  if (!rr.ok) return rr.status === 413 ? fail(413, "too-large", rr.reason) : fail(400, "bad-input", rr.reason);
  const req = rr.req, op = req.op;

  // Counters need KV. Without it the caps cannot hold, so the paid call is refused (fail closed).
  const store = usageKv(env);
  if (!store) return quota("circuit-breaker");

  // 3. idempotent replay: no gate, no model call, no record, no charge
  const idemK = "prep:idem:" + uid + ":" + req.idem;
  try {
    const sealed = await store.get(idemK);
    if (sealed) {
      const text = await idemOpen(uid, canon, sealed);
      if (text) return new Response(text, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Prep-Replay": "1" } });
    }
  } catch (e) { /* a failed read is a miss */ }

  // 4. project breaker and per-user rate limit (MaiK token allowances skipped for type "prep")
  const q = await checkQuota(env, request, "prep", { waitUntil: ctx.waitUntil });
  if (!q.ok) return q.reason === "circuit-breaker" ? quota("circuit-breaker") : quota("rate", 3);

  // 5. calls a day (aiu:mod:<doc>:prep:<day>), recorded once after the call
  let commit = null;
  try {
    const owner = await Promise.resolve(ownerOK(request, env)).catch(() => false);
    const mq = await gateAndCount(env, store, "prep", usageKeyFor(who), "unknown", now, meterEmail(who), ctx.waitUntil, owner, true);
    if (mq && !mq.ok) return quota("daily-calls", Math.ceil((istNextMidnightMs(now) - now) / 1000), { limit: mq.limit, used: mq.used });
    if (mq && typeof mq.commit === "function") commit = mq.commit;
  } catch (e) { /* fail open like every module counter; the record is still written below */ }

  // 6. prep counters: decks a day / month, per-deck tokens, pages and chars (fail closed on a read error)
  const caps = prepCaps(env), day = istDay(now), month = day.slice(0, 7);
  const tokK = "prep:tok:" + uid + ":" + req.deckId, dayK = "prep:decks:" + uid + ":" + day, monK = "prep:decks:" + uid + ":" + month;
  let deck, dayDecks, monthDecks;
  try {
    const [d, dd, md] = await Promise.all([store.get(tokK), store.get(dayK), store.get(monK)]);
    deck = readDeck(d); dayDecks = readNum(dd); monthDecks = readNum(md);
  } catch (e) { return quota("circuit-breaker"); }
  const seen = !!deck;
  if (!seen) {
    if (op !== "facts") return fail(400, "bad-input", "deck-not-started");
    if (dayDecks >= caps.decksDay) return quota("daily-decks", Math.ceil((istNextMidnightMs(now) - now) / 1000), { dayDecks, monthDecks });
    if (monthDecks >= caps.decksMonth) return quota("month-decks", secsToNextIstMonth(now), { dayDecks, monthDecks });
    deck = { tok: 0, pg: [], ch: 0 };
  }
  if (op === "facts") {
    const pg = new Set(deck.pg.concat(req.pages));
    if (pg.size > caps.pages) return fail(413, "too-large", "pages");
    if (deck.ch + req.chars > caps.chars) return fail(413, "too-large", "chars");
  }
  const p = promptFor(req);
  const estIn = estTokens(p.system.length + p.user.length + JSON.stringify(p.schema).length);
  if (deck.tok + estIn + p.maxOut > caps.deckTok) return quota("token-cap", 0, { deckTok: deck.tok, deckCapTok: caps.deckTok });

  // 7. the one Gemini call
  const model = envModel(env && env.PREP_MODEL, MODEL_HARD_DEFAULT);
  const tEnv = Number(env && env.PREP_TEMPERATURE);
  const temperature = op !== "solve" && Number.isFinite(tEnv) && tEnv >= 0 && tEnv <= 2 ? tEnv : p.temperature;
  const meta = {}, t0 = Date.now();
  let text = "", err = null;
  try {
    text = await callGemini(env, [{ text: p.user }], p.maxOut, { model, providers: ["vertex"], labels: { app: "prep" }, system: p.system, json: true, schema: p.schema, temperature, meta });
  } catch (e) { err = e; }
  const latencyMs = Date.now() - t0;
  const u = meta.usage;
  const inTok = u && u.promptTokenCount != null ? u.promptTokenCount | 0 : (err ? 0 : estIn);
  const outTok = u && u.candidatesTokenCount != null ? u.candidatesTokenCount | 0 : (err ? 0 : estTokens(String(text || "").length));
  const thinkTok = u && u.thoughtsTokenCount != null ? u.thoughtsTokenCount | 0 : 0;
  const inr = estCostInr(env, model, inTok, outTok + thinkTok);
  const payload = err ? null : finish(req, text, model);
  const timedOut = !!err && isTimeout(err);
  const status = payload ? "success" : (timedOut ? "timeout" : "failed");
  const httpStatus = payload ? 200 : (timedOut ? 504 : 502);

  // 8. counters (awaited: they enforce). The deck is counted at its first accepted facts call.
  const writes = [];
  const newDeck = !seen && op === "facts" && !!payload;
  if (seen || newDeck) {
    deck.tok += inTok + outTok + thinkTok;
    if (op === "facts" && payload) { deck.pg = Array.from(new Set(deck.pg.concat(req.pages))); deck.ch += req.chars; }
    writes.push(store.put(tokK, JSON.stringify(deck), { expirationTtl: DECK_TTL_S }));
  }
  if (newDeck) {
    dayDecks += 1; monthDecks += 1;
    writes.push(store.put(dayK, String(dayDecks), { expirationTtl: DAY_TTL_S }), store.put(monK, String(monthDecks), { expirationTtl: MONTH_TTL_S }));
  }
  const usage = { inTok, outTok, thinkTok, inr, deckTok: deck.tok, deckCapTok: caps.deckTok, dayDecks, monthDecks };
  let res, out = null;
  if (payload) { out = JSON.stringify(Object.assign(payload, { usage })); res = new Response(out, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
  else res = timedOut ? fail(504, "ai-timeout", "ai-timeout", { usage }) : fail(502, "ai-failed", err ? "provider" : "bad-output", { usage });
  if (out) writes.push(idemSeal(uid, canon, out).then((s) => store.put(idemK, s, { expirationTtl: IDEM_TTL_S })));
  try { await Promise.all(writes); } catch (e) { /* KV write failure: the response still stands */ }

  // 9. exactly one usage record, then the breaker and the console cost counter (no text anywhere)
  const extra = { feature: "prep:" + op, model, provider: "vertex", promptTokens: inTok, completionTokens: outTok + thinkTok, thinkTokens: thinkTok, estCostInr: inr, latencyMs, status, httpStatus };
  const meter = (async () => {
    try {
      if (commit) await commit(extra);
      else await recordAiUsage(env, store, buildUsageRecord(Object.assign({}, extra, { doctorId: usageKeyFor(who), module: "prep", subscription: "unknown", ts: now, email: meterEmail(who) })), now);
    } catch (e) {}
    if (inr > 0) {
      try { await addDailyCostInr(env, day, inr); } catch (e) {}
      let d1 = false;
      try { d1 = await bump(env, day, { "maik.cost": inr, "prep.calls": 1, "prep.inTok": inTok, "prep.outTok": outTok, "prep.thinkTok": thinkTok }); } catch (e) {}
      if (!d1) {   // no D1: the breaker reads the KV rollup instead
        try { const gk = "maik:global:" + day; const g = (await store.get(gk, "json")) || { cost: 0, req: 0, blocked: 0 }; g.cost = (g.cost || 0) + inr; await store.put(gk, JSON.stringify(g), { expirationTtl: 60 * 60 * 26 }); } catch (e) {}
      }
    }
  })();
  await later(meter);
  return res;
}
