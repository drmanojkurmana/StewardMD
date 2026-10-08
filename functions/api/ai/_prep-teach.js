/* POST /api/ai/prep-teach - "Ask MaiK online" for PrepNucleus students.
 * MaiK explains an MCQ (why the key is right, why the chosen option is wrong) or re-explains a lesson step,
 * ONLY from the grounding text the phone sends (the same system prompts as the on-device teacher, prep-teacher.js).
 *
 * Request (JSON, <= 16 KB):
 *   { kind: "mcq", ground, key (0..4), chosen (-1..4; -1 or === key: "why is the key right"), idem? }
 *   { kind: "step", ground, title?, idem? }
 * Response 200: { text, usage: { inTok, outTok, thinkTok, inr, mt }, wallet?: { balanceMt, costCapOn } }.
 * Errors { error, reason, message? }: 400 bad-input, 401 sign-in, 413 too-large, 429 quota (rate | circuit-breaker |
 * ai-cost-cap | module reasons), 502 ai-failed (provider | empty), 504 ai-timeout.
 *
 * Metering is by the student's MaiK Token (MT) balance, NOT a count cap (owner decision): gateAndCount("prep_tutor")
 * runs the existing rules (AI_COST_CAP_ON: today's free MT allowance, then the prepaid balance); the module's daily
 * count limit is 0 (unlimited). Exactly one usage record per model call is written through commit(extra); that
 * recorded cost is what checkCostCap later debits from the wallet. Never _usage.js recordUsage.
 * Nothing the student sent is logged or stored. The 10 minute idempotency record is AES-GCM sealed (see idemSeal).
 */
import { checkQuota, usageKv, identify, usageKeyFor, meterEmail, addDailyCostInr, estTokens } from "../../_usage.js";
import { gateAndCount, buildUsageRecord, recordAiUsage, estCostInr, envModel, MODEL_HARD_DEFAULT, poolKeyFor } from "../../_ai_usage.js";
import { getCredits, inrToMt, costCapOn } from "../../_credits.js";
import { bump, istDay } from "../../_counters.js";
import { ownerOK } from "../../_adminauth.js";
import { cleanText, prepScrub } from "../../_prep-core.js";

export const TEACH_BODY_MAX = 16 * 1024;   // bytes
export const TEACH_LIMITS = { ground: 3600, title: 200, maxOut: 450 };
const IDEM_TTL_S = 600;
const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;
const LETTERS = ["A", "B", "C", "D", "E"];

/* Same text as prep-teacher.js SYSTEM and STEP_SYSTEM, so online and offline answers follow the same rules. */
export const TEACH_SYSTEM =
  "You are MaiK, a medical exam teacher inside StewardMD PrepNucleus, helping a student who just answered a multiple choice question.\n" +
  "RULES:\n" +
  "- Explain using ONLY the facts in the GROUNDING block. Do not add any drug, dose, number, criterion, name or fact that is not written there.\n" +
  "- Refer to options by their letter.\n" +
  "- If the grounding does not say why an option is wrong or right, reply exactly: The stored explanation does not cover this.\n" +
  "- Plain prose, 3 to 5 short sentences. No headings, no lists, no preamble, no question back to the student.";
export const STEP_SYSTEM =
  "You are MaiK, a medical exam teacher inside StewardMD PrepNucleus. A student is reading a short lesson step and asked you to explain it again.\n" +
  "RULES:\n" +
  "- Explain using ONLY the facts in the GROUNDING block. Do not add any drug, dose, number, criterion, name or fact that is not written there.\n" +
  "- Simpler words than the step, 3 to 5 short sentences, then one line that starts with: Remember:\n" +
  "- Plain prose. No headings, no lists, no preamble, no question back to the student.";

const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, headers || {}) });
const fail = (status, error, reason, extra) => json(Object.assign({ error, reason }, extra || {}), status);
const quota = (reason, message, extra) => json(Object.assign({ error: "quota", reason, message }, extra || {}), 429);
const isTimeout = (e) => !!(e && (e.timeout || e.name === "AbortError" || e.name === "TimeoutError")) || /\btimeout\b|timed out|deadline exceeded/i.test(String((e && e.message) || e));
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const scrub = (s, max) => prepScrub(cleanText(s, max));
// The grounding block is one line per part (question, options, explanation...): keep the line breaks, scrub each line.
const scrubBlock = (s, max) => s.split(/\r?\n/).map((l) => scrub(l, max)).filter(Boolean).join("\n").slice(0, max);

/* readTeachRequest(body) -> { ok: true, req } | { ok: false, status, reason }. Every string is scrubbed here, once. */
export function readTeachRequest(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const bad = (reason, status) => ({ ok: false, status: status || 400, reason });
  if (b.kind !== "mcq" && b.kind !== "step") return bad("kind");
  if (typeof b.ground !== "string" || !b.ground.trim()) return bad("ground");
  if (b.ground.length > TEACH_LIMITS.ground) return bad("ground");
  if (b.idem != null && !IDEM_RE.test(String(b.idem))) return bad("idem");
  const req = { kind: b.kind, ground: scrubBlock(b.ground, TEACH_LIMITS.ground), idem: b.idem || null };
  if (!req.ground) return bad("ground");
  if (b.kind === "mcq") {
    if (!isInt(b.key, 0, 4)) return bad("key");
    if (!isInt(b.chosen, -1, 4)) return bad("chosen");
    req.key = b.key; req.chosen = b.chosen;
  } else {
    if (b.title != null) {
      if (typeof b.title !== "string" || b.title.length > TEACH_LIMITS.title) return bad("title");
      req.title = scrub(b.title, TEACH_LIMITS.title);
    }
  }
  return { ok: true, req };
}

/* buildTeachPrompt(req) -> { system, user, maxOut, temperature } */
export function buildTeachPrompt(req) {
  let task;
  if (req.kind === "mcq") {
    const y = LETTERS[req.key];
    if (req.chosen >= 0 && req.chosen !== req.key) {
      const x = LETTERS[req.chosen];
      task = "The student chose " + x + ". Explain why " + x + " is wrong and why " + y + " is the correct answer, using only the grounding.";
    } else task = "Explain why " + y + " is the correct answer and why the other options are not, using only the grounding.";
  } else task = "Explain this step again in simpler words, using only the grounding.";
  return { system: req.kind === "mcq" ? TEACH_SYSTEM : STEP_SYSTEM, user: "GROUNDING:\n" + req.ground + "\n\nTASK: " + task, maxOut: TEACH_LIMITS.maxOut, temperature: 0.2 };
}

/* ---- idempotency record, sealed so it is unreadable without the same request (as prep-generate) ---- */
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
  } catch (e) { return null; }
}

/* handlePrepTeach({ request, env, body, callGemini, waitUntil, now? }) -> Response.
 * callGemini is the router's, injected to avoid a circular import. */
export async function handlePrepTeach(ctx) {
  const { request, env, body, callGemini } = ctx;
  const later = (p) => { const w = ctx.waitUntil; if (typeof w === "function") { try { w(Promise.resolve(p).catch(() => {})); return; } catch (e) {} } return p; };
  const now = ctx.now || Date.now();
  if (request.method !== "POST") return fail(400, "bad-input", "method");

  // 1. sign-in
  let who = null;
  try { who = await identify(request, env); } catch (e) { who = null; }
  if (!who || who.guest || !who.id) return fail(401, "sign-in", "sign-in", { message: "Sign in to ask MaiK online." });
  const uid = who.id;

  // 2. size and shape
  if (Number(request.headers.get("Content-Length")) > TEACH_BODY_MAX) return fail(413, "too-large", "body");
  if (!/application\/json/i.test(request.headers.get("Content-Type") || "")) return fail(400, "bad-input", "content-type");
  let canon = "";
  try { canon = JSON.stringify(body || {}); } catch (e) { return fail(400, "bad-input", "body"); }
  if (_enc.encode(canon).length > TEACH_BODY_MAX) return fail(413, "too-large", "body");
  const rr = readTeachRequest(body);
  if (!rr.ok) return rr.status === 413 ? fail(413, "too-large", rr.reason) : fail(400, "bad-input", rr.reason);
  const req = rr.req;

  // 3. KV is needed for the breaker, the wallet and the record
  const store = usageKv(env);
  if (!store) return quota("circuit-breaker", "Ask MaiK online is not available just now. The stored explanation is above.");

  // idempotent replay: no gate, no model call, no record, no charge
  const idemK = req.idem ? "prep:teach:idem:" + uid + ":" + req.idem : null;
  if (idemK) {
    try {
      const sealed = await store.get(idemK);
      if (sealed) {
        const text = await idemOpen(uid, canon, sealed);
        if (text) return new Response(text, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Prep-Replay": "1" } });
      }
    } catch (e) { /* a failed read is a miss */ }
  }

  // 4. project breaker and per-user rate limit (type "prep": MaiK token allowances are not charged here)
  const q = await checkQuota(env, request, "prep", { waitUntil: ctx.waitUntil });
  if (!q.ok) {
    if (q.reason === "circuit-breaker") return quota("circuit-breaker", "Ask MaiK online is not available just now. The stored explanation is above.");
    return quota("rate", "You are asking MaiK too fast. Wait a few seconds and try again.", { retryAfter: 3 });
  }

  // 5. MaiK Token metering: the existing rules via gateAndCount (module prep_tutor, deferred record)
  let commit = null;
  try {
    const owner = await Promise.resolve(ownerOK(request, env)).catch(() => false);
    const mq = await gateAndCount(env, store, "prep_tutor", usageKeyFor(who), "unknown", now, meterEmail(who), ctx.waitUntil, owner, true);
    if (mq && !mq.ok) {
      if (mq.reason === "ai-cost-cap") {
        return quota("ai-cost-cap", "You have used today's free MaiK Tokens. Add MaiK Tokens or go Pro to keep asking MaiK online.",
          { resetAt: mq.resetAt, cap: mq.cap, dayCost: mq.dayCost, credits: mq.credits, creditsMt: mq.creditsMt, usedMt: mq.usedMt, capMt: mq.capMt });
      }
      return quota(mq.reason || "module-daily", "Ask MaiK online is at its limit for today. The stored explanation is above.");
    }
    if (mq && typeof mq.commit === "function") commit = mq.commit;
  } catch (e) { /* fail open like every module counter; the record is still written below */ }

  // 6. the one model call
  const p = buildTeachPrompt(req);
  const model = envModel(env && env.PREP_TEACH_MODEL, MODEL_HARD_DEFAULT);
  const meta = {}, t0 = Date.now();
  let text = "", err = null;
  try {
    text = await callGemini(env, [{ text: p.user }], p.maxOut, { model, providers: ["vertex"], labels: { app: "prep" }, system: p.system, temperature: p.temperature, meta });
  } catch (e) { err = e; }
  const latencyMs = Date.now() - t0;
  text = typeof text === "string" ? text.trim() : "";
  const u = meta.usage;
  const estIn = estTokens(p.system.length + p.user.length);
  const inTok = u && u.promptTokenCount != null ? u.promptTokenCount | 0 : (err ? 0 : estIn);
  const outTok = u && u.candidatesTokenCount != null ? u.candidatesTokenCount | 0 : (err ? 0 : estTokens(text.length));
  const thinkTok = u && u.thoughtsTokenCount != null ? u.thoughtsTokenCount | 0 : 0;
  const inr = estCostInr(env, model, inTok, outTok + thinkTok);
  const timedOut = !!err && isTimeout(err);
  const ok = !err && !!text;
  const status = ok ? "success" : (timedOut ? "timeout" : "failed");
  const httpStatus = ok ? 200 : (timedOut ? 504 : 502);

  // 7. response; the wallet balance is read after the call (best effort)
  let res, out = null;
  if (ok) {
    const payload = { text, usage: { inTok, outTok, thinkTok, inr, mt: inrToMt(inr) } };
    try {
      const bal = await getCredits(store, await poolKeyFor(store, usageKeyFor(who)));
      payload.wallet = { balanceMt: inrToMt(bal), costCapOn: costCapOn(env) };   // the live flag (cfgFlag), as /usage reports it
    } catch (e) { /* omit wallet */ }
    out = JSON.stringify(payload);
    res = new Response(out, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } else if (timedOut) res = fail(504, "ai-timeout", "ai-timeout");
  else res = fail(502, "ai-failed", err ? "provider" : "empty");
  if (out && idemK) { try { await store.put(idemK, await idemSeal(uid, canon, out), { expirationTtl: IDEM_TTL_S }); } catch (e) { /* the response still stands */ } }

  // 8. exactly one usage record, then the breaker and the console cost counter (no text anywhere)
  const day = istDay(now);
  const extra = { feature: "prep:teach", model, provider: "vertex", promptTokens: inTok, completionTokens: outTok + thinkTok, thinkTokens: thinkTok, estCostInr: inr, latencyMs, status, httpStatus };
  const meter = (async () => {
    try {
      if (commit) await commit(extra);
      else await recordAiUsage(env, store, buildUsageRecord(Object.assign({}, extra, { doctorId: usageKeyFor(who), module: "prep_tutor", subscription: "unknown", ts: now, email: meterEmail(who) })), now);
    } catch (e) {}
    if (inr > 0) {
      try { await addDailyCostInr(env, day, inr); } catch (e) {}
      let d1 = false;
      try { d1 = await bump(env, day, { "maik.cost": inr, "prep.teach.calls": 1 }); } catch (e) {}
      if (!d1) {   // no D1: the breaker reads the KV rollup instead
        try { const gk = "maik:global:" + day; const g = (await store.get(gk, "json")) || { cost: 0, req: 0, blocked: 0 }; g.cost = (g.cost || 0) + inr; await store.put(gk, JSON.stringify(g), { expirationTtl: 60 * 60 * 26 }); } catch (e) {}
      }
    }
  })();
  await later(meter);
  return res;
}
