/* POST /api/ai/prep-qgen - PrepNucleus "Create a module with MaiK" (students) and the owner's Author tool.
 * Engine: functions/_prep-qgen.js (Claude via the Anthropic Messages / Message Batches APIs). Vault: PrepNucleus.md
 * "MaiK modules (qgen)".
 *
 * Feature flag: PREP_QGEN_ON = "1" and the secret ANTHROPIC_API_KEY (plus ANTHROPIC_WORKSPACE_ID). Without both every op
 * except status answers 503 { error: "not-configured" } and status says { on: false }, so the app hides its entry points.
 * Students additionally need PREP_QGEN_STUDENT = "1". The owner (ownerOK: owner Google login) needs only PREP_QGEN_ON.
 *
 * Ops (JSON body { op, ... }):
 *   status                -> { on, student, owner, caps: { modulesPerDay, perModule, perCall }, left, models }
 *   gen     { mod: "gen_<sha12>", topic, ground?, exam, diff?, n (1..5), round?, avoid?: [stems], bank?: [paths, owner only], idem? }
 *                         -> { items, dropped, flagged, usage: { inTok, outTok, thinkTok, cacheRead, cacheWrite, usd, inr, mt }, left, wallet? }
 *           Students get only items that passed the code gates and the verifier; the owner also gets flagged items
 *           (qg.v "flag" with qg.why) to review. Without a grounding every item carries qg.u 1 ("not from the library").
 *   report  { mod, id, why }  a student's flag on one of their own questions: a count by reason, no text kept.
 *   owner only:
 *   bsubmit { topic, ground?, exam, diff?, n (<= PREP_QGEN_BATCH_MAX), bank?, title?, subject?, module? } -> { job, estimate }
 *           Message Batches (50% price): generate requests now, the verify batch is submitted by bpoll when they end.
 *   bpoll   { job }           -> { job: { stage: gen | verify | done | failed, ... }, items? (when done), usage }
 *   stage   { title, exam, subject, module, items: [reviewed items] } -> { stageId, cmd }: the reviewed batch to R2
 *           prep-qgen/staging/<stageId>.json (never served by the bank route); publishing is the CLI's job (see cmd).
 *
 * Gate order (gen): sign-in, flag, size, input, idempotent replay (free), the
 * student caps (modules a day, questions a module, the daily USD breaker for all students), checkQuota "prep" (breaker, rate), gateAndCount("prep_qgen",
 * deferRecord) (request backstop, MaiK Tokens with AI_COST_CAP_ON), then the calls. One usage record per request.
 * Errors { error, reason, message?, retryAfter? }: 400 bad-input, 401 sign-in, 403 owner-only | off, 413 too-large,
 * 429 quota (rate | circuit-breaker | daily-modules | module-full | budget | ai-cost-cap | module-daily), 502 ai-failed,
 * 503 not-configured | busy, 504 ai-timeout. The key and the provider's error text never appear in a reply or a log. */
import { checkQuota, usageKv, identify, usageKeyFor, meterEmail, addDailyCostInr } from "../../_usage.js";
import { gateAndCount, buildUsageRecord, recordAiUsage, poolKeyFor } from "../../_ai_usage.js";
import { getCredits, inrToMt, costCapOn } from "../../_credits.js";
import { bump, istDay } from "../../_counters.js";
import { ownerOK } from "../../_adminauth.js";
import { verifiedClaimsFor, verifiedEmailOf } from "../../_fbauth.js";
import { cleanText, normText } from "../../_prep-core.js";
import { idemSeal, idemOpen } from "./_prep-teach.js";
import { QGEN, qgenConfig, readGen, runRound, estimate, batchGenRequests, batchCreate, batchGet, batchResults,
  batchGenToItems, batchVerifyRequests, batchApplyVerify, addUsage, usdToInr, QgenError } from "../../_prep-qgen.js";

export const QGEN_BODY_MAX = 90 * 1024, QGEN_OWNER_BODY_MAX = 1200 * 1024;
const IDEM_TTL_S = 600, DAY_TTL_S = 2 * 86400, MOD_TTL_S = 400 * 86400, JOB_TTL_S = 8 * 86400;
const REPORT_WHY = ["wrong-key", "unclear", "outdated", "typo", "duplicate", "other"];
const json = (obj, status, h) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, h || {}) });
const fail = (status, error, reason, extra) => json(Object.assign({ error, reason }, extra || {}), status);
const quota = (reason, message, extra) => fail(429, "quota", reason, Object.assign({ message }, extra || {}));
const _enc = new TextEncoder();
const getJ = async (store, k) => { try { return (await store.get(k, "json")) || null; } catch (e) { return null; } };
const putJ = async (store, k, v, ttl) => { try { await store.put(k, JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined); } catch (e) {} };

/* Provider failure -> response. auth means the secret is wrong or expired: said as not-configured. */
function providerFail(e) {
  const c = e instanceof QgenError ? e.code : "provider";
  if (c === "timeout") return fail(504, "ai-timeout", "ai-timeout");
  if (c === "rate" || c === "overloaded") return fail(503, "busy", c, { retryAfter: 20, message: "MaiK is busy. Try again in a minute." });
  if (c === "auth" || c === "not-configured") return fail(503, "not-configured", "auth");
  return fail(502, "ai-failed", c === "bad-request" ? "bad-request" : "provider");
}

/* The Author tool's owner: ownerOK (owner Google login or admin token) AND, when PREP_QGEN_OWNERS is set, a verified
 * Firebase email on that list. OWNER_EMAILS also lists accounts that are not the content owner, and the Author tool
 * spends money and stages content for the shared bank, so the narrower list wins when it is set. */
export async function qgenOwner(request, env) {
  let ok = false;
  try { ok = await ownerOK(request, env); } catch (e) { ok = false; }
  if (!ok) return false;
  const list = String((env && env.PREP_QGEN_OWNERS) || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  try { const c = await verifiedClaimsFor(request, env); const em = c ? String(verifiedEmailOf(c) || "").toLowerCase() : ""; return !!em && list.indexOf(em) >= 0; } catch (e) { return false; }
}

/* Bank stems for the owner's de-duplication: the module files the Author screen names (R2, prep-bank/ prefix). */
async function bankStems(env, paths) {
  const bucket = env && env.PREP_BANK_R2, out = [];
  if (!bucket || !paths || !paths.length) return out;
  for (const p of paths) {
    try {
      const o = await bucket.get("prep-bank/" + p);
      if (!o) continue;
      const j = JSON.parse(await o.text());
      const items = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : []);
      items.forEach((it) => { if (it && typeof it.q === "string") out.push(it.q); });
    } catch (e) { /* a missing or unreadable file adds nothing */ }
  }
  return out;
}

async function statusOf(env, store, who, owner, cfg, now) {
  const out = { on: cfg.on, student: cfg.student, owner: !!(cfg.owner && owner), caps: { modulesPerDay: cfg.modulesPerDay, perModule: cfg.perModule, perCall: QGEN.perCall }, models: cfg.on ? [cfg.genModel, cfg.verifyModel] : [] };
  if (who && !who.guest && store) {
    const d = await getJ(store, "prep:qgen:day:" + who.id + ":" + istDay(now));
    out.left = Math.max(0, cfg.modulesPerDay - ((d && d.mods) || []).length);
  } else out.left = cfg.modulesPerDay;
  return out;
}

export async function handlePrepQgen(ctx) {
  const { request, env, body } = ctx;
  const later = (p) => { const w = ctx.waitUntil; if (typeof w === "function") { try { w(Promise.resolve(p).catch(() => {})); return; } catch (e) {} } return p; };
  const now = ctx.now || Date.now(), day = istDay(now);
  if (request.method !== "POST") return fail(400, "bad-input", "method");
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const cfg = qgenConfig(env), store = usageKv(env);

  let who = null;
  try { who = await identify(request, env); } catch (e) { who = null; }
  const signed = !!(who && !who.guest && who.id);
  const owner = signed ? await qgenOwner(request, env) : false;

  if (b.op === "status") return json(await statusOf(env, store, signed ? who : null, owner, cfg, now));
  if (!signed) return fail(401, "sign-in", "sign-in", { message: "Sign in to create a module with MaiK." });
  if (!cfg.on) return fail(503, "not-configured", "off", { message: "Creating modules with MaiK is not switched on yet." });
  const ownerOp = b.op === "bsubmit" || b.op === "bpoll" || b.op === "stage";
  if (ownerOp && !owner) return fail(403, "owner-only", "owner-only");
  if (!owner && !cfg.student) return fail(403, "off", "student-off", { message: "Creating modules with MaiK is not open yet." });

  let canon = "";
  try { canon = JSON.stringify(b); } catch (e) { return fail(400, "bad-input", "body"); }
  const max = owner ? QGEN_OWNER_BODY_MAX : QGEN_BODY_MAX;
  if (Number(request.headers.get("Content-Length")) > max || _enc.encode(canon).length > max) return fail(413, "too-large", "body");
  if (!/application\/json/i.test(request.headers.get("Content-Type") || "")) return fail(400, "bad-input", "content-type");
  if (!store) return quota("circuit-breaker", "MaiK modules are not available just now.");
  const uid = who.id;

  if (b.op === "report") {
    if (!/^gen_[a-f0-9]{12}$/.test(String(b.mod || "")) || !/^q_[a-f0-9]{12}$/.test(String(b.id || "")) || REPORT_WHY.indexOf(b.why) < 0) return fail(400, "bad-input", "report");
    const k = "prep:qgen:rep:" + day, r = (await getJ(store, k)) || {};
    r[b.why] = (r[b.why] || 0) + 1;
    await putJ(store, k, r, 40 * 86400);
    later(bump(env, day, { ["prep.qgen.report." + b.why]: 1 }).catch(() => {}));
    return json({ ok: true });
  }
  if (b.op === "bsubmit") return ownerSubmit(env, store, b, cfg, now);
  if (b.op === "bpoll") return ownerPoll(env, store, b, cfg, now, later);
  if (b.op === "stage") return ownerStage(env, b, uid, now);
  if (b.op !== "gen") return fail(400, "bad-input", "op");

  // ---- gen ----
  const rr = readGen(b, owner);
  if (!rr.ok) return rr.status === 413 ? fail(413, "too-large", rr.reason) : fail(400, "bad-input", rr.reason);
  const req = rr.req;
  const idemK = req.idem ? "prep:qgen:idem:" + uid + ":" + req.idem : null;
  if (idemK) {
    try {
      const sealed = await store.get(idemK);
      const text = sealed ? await idemOpen(uid, canon, sealed) : null;
      if (text) return new Response(text, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Prep-Replay": "1" } });
    } catch (e) {}
  }
  // student caps: modules a day (counted at the first accepted round), questions a module, the shared daily USD breaker
  const modK = "prep:qgen:mod:" + uid + ":" + req.mod, dayK = "prep:qgen:day:" + uid + ":" + day;
  const usdK = (owner ? "prep:qgen:ousd:" : "prep:qgen:usd:") + day;
  const modRec = (await getJ(store, modK)) || { q: 0, usd: 0 };
  const dayRec = (await getJ(store, dayK)) || { mods: [] };
  const spent = Number(await store.get(usdK).catch(() => 0)) || 0;
  if (spent >= (owner ? cfg.ownerDailyUsd : cfg.dailyUsd)) return quota("budget", "MaiK modules have reached today's limit for everyone. Try again tomorrow.");
  let n = req.n;
  if (!owner) {
    const isNew = dayRec.mods.indexOf(req.mod) < 0 && !modRec.q;
    if (isNew && dayRec.mods.length >= cfg.modulesPerDay) return quota("daily-modules", "You have created " + cfg.modulesPerDay + " modules with MaiK today. Make more tomorrow.", { limit: cfg.modulesPerDay, left: 0 });
    if (modRec.q >= cfg.perModule) return quota("module-full", "This module has its " + cfg.perModule + " questions.", { limit: cfg.perModule });
    n = Math.min(n, cfg.perModule - modRec.q);
  }
  req.n = n;
  const q = await checkQuota(env, request, "prep", { waitUntil: ctx.waitUntil });
  if (!q.ok) {
    if (q.reason === "circuit-breaker") return quota("circuit-breaker", "MaiK modules are paused for a short while.");
    return quota("rate", "Too fast. Wait a few seconds and try again.", { retryAfter: 3 });
  }


  let commit = null;
  try {
    const mq = await gateAndCount(env, store, "prep_qgen", usageKeyFor(who), "unknown", now, meterEmail(who), ctx.waitUntil, owner, true);
    if (mq && !mq.ok) {
      if (mq.reason === "ai-cost-cap") return quota("ai-cost-cap", "You have used today's free MaiK Tokens. Add MaiK Tokens to keep creating modules.", { resetAt: mq.resetAt, creditsMt: mq.creditsMt, usedMt: mq.usedMt, capMt: mq.capMt });
      return quota(mq.reason || "module-daily", "MaiK modules are at their limit for today.");
    }
    if (mq && typeof mq.commit === "function") commit = mq.commit;
  } catch (e) { /* fail open like every module counter; the record is still written below */ }

  const t0 = Date.now();
  let res = null, err = null;
  try {
    res = await runRound(env, req, { cfg, keepFlagged: owner, prov: owner ? "SMD" : "USR", bankStems: owner ? await bankStems(env, req.bank) : [] });
  } catch (e) { err = e; }
  const latencyMs = Date.now() - t0;
  const usage = (res && res.usage) || addUsage(null, cfg.genModel, null);
  const inr = usdToInr(usage.usd, env);
  let out = null, response;
  if (res) {
    const items = res.items;
    const accepted = items.filter((it) => it.qg.v === "ok").length;
    modRec.q += owner ? items.length : accepted; modRec.usd = Math.round((modRec.usd + usage.usd) * 1e6) / 1e6;
    if (accepted && dayRec.mods.indexOf(req.mod) < 0) dayRec.mods.push(req.mod);
    const payload = { items, dropped: res.dropped, flagged: res.flagged, usage: Object.assign({}, usage, { inr, mt: inrToMt(inr) }),
      left: { modules: Math.max(0, cfg.modulesPerDay - dayRec.mods.length), questions: Math.max(0, cfg.perModule - modRec.q) } };
    if (res.stop === "refusal") payload.refused = true;
    try { const bal = await getCredits(store, await poolKeyFor(store, usageKeyFor(who))); payload.wallet = { balanceMt: inrToMt(bal), costCapOn: costCapOn(env) }; } catch (e) {}
    out = JSON.stringify(payload);
    response = new Response(out, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    await putJ(store, modK, modRec, MOD_TTL_S);
    await putJ(store, dayK, dayRec, DAY_TTL_S);
    if (idemK) { try { await store.put(idemK, await idemSeal(uid, canon, out), { expirationTtl: IDEM_TTL_S }); } catch (e) {} }
  } else response = providerFail(err);
  if (usage.usd > 0) { try { await store.put(usdK, String(Math.round((spent + usage.usd) * 1e6) / 1e6), { expirationTtl: DAY_TTL_S }); } catch (e) {} }

  // one usage record, then the project breaker and the console counters (no text anywhere)
  const status = res ? "success" : (err && err.code === "timeout" ? "timeout" : "failed");
  const extra = { feature: owner ? "prep:qgen-owner" : "prep:qgen", model: cfg.genModel, provider: "anthropic", promptTokens: usage.inTok + usage.cacheRead + usage.cacheWrite, completionTokens: usage.outTok, thinkTokens: usage.thinkTok, estCostInr: inr, latencyMs, status, httpStatus: response.status };
  await later((async () => {
    try {
      if (commit) await commit(extra);
      else await recordAiUsage(env, store, buildUsageRecord(Object.assign({}, extra, { doctorId: usageKeyFor(who), module: "prep_qgen", subscription: "unknown", ts: now, email: meterEmail(who) })), now);
    } catch (e) {}
    if (inr > 0) {
      try { await addDailyCostInr(env, day, inr); } catch (e) {}
      try { await bump(env, day, { "maik.cost": inr, "prep.qgen.calls": 1, "prep.qgen.items": res ? res.items.length : 0 }); } catch (e) {}
    }
  })());
  return response;
}

/* ---------------- owner: bulk via Message Batches ---------------- */
async function ownerSubmit(env, store, b, cfg, now) {
  const n = b.n;
  if (!Number.isInteger(n) || n < 1 || n > cfg.batchMax) return fail(400, "bad-input", "n");
  const rr = readGen(Object.assign({}, b, { n: 1, mod: b.mod || "gen_000000000000" }), true);
  if (!rr.ok) return rr.status === 413 ? fail(413, "too-large", rr.reason) : fail(400, "bad-input", rr.reason);
  const id = "j" + now.toString(36) + Math.random().toString(36).slice(2, 8);
  const mod = /^gen_[a-f0-9]{12}$/.test(String(b.mod || "")) ? b.mod : "gen_" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((x) => x.toString(16).padStart(2, "0")).join("");
  const job = { id, mod, stage: "gen", created: now, n, topic: rr.req.topic, ground: rr.req.ground, exam: rr.req.exam, diff: rr.req.diff, avoid: rr.req.avoid,
    bank: rr.req.bank, title: cleanText(b.title, 120), subject: cleanText(b.subject, 60), module: cleanText(b.module, 80) };
  const est = estimate({ n, groundChars: job.ground.length, batch: true }, cfg);
  if (est.usd > cfg.ownerDailyUsd) return quota("budget", "This job is estimated at $" + est.usd + ", above the owner's daily limit of $" + cfg.ownerDailyUsd + ".", { estimate: est });
  try {
    const bt = await batchCreate(env, batchGenRequests(job, cfg));
    job.genBatch = bt.id;
  } catch (e) { return providerFail(e); }
  await putJ(store, "prep:qgen:job:" + id, job, JOB_TTL_S);
  return json({ job: { id, stage: job.stage, n, mod }, estimate: est });
}
async function ownerPoll(env, store, b, cfg, now, later) {
  if (!/^j[a-z0-9]{6,20}$/.test(String(b.job || ""))) return fail(400, "bad-input", "job");
  const k = "prep:qgen:job:" + b.job, job = await getJ(store, k);
  if (!job) return fail(400, "bad-input", "job-gone");
  const brief = () => ({ id: job.id, stage: job.stage, n: job.n, mod: job.mod, made: (job.items || []).length, dropped: (job.dropped || []).length, counts: job.counts || null });
  try {
    if (job.stage === "gen" || job.stage === "verify") {
      const bt = await batchGet(env, job.stage === "gen" ? job.genBatch : job.verBatch);
      job.counts = bt.request_counts || null;
      if (bt.processing_status === "ended") {
        const results = await batchResults(env, bt);
        if (job.stage === "gen") {
          const stems = await bankStems(env, job.bank);
          const r = batchGenToItems(results, Object.assign({}, job, { bankStems: stems }), cfg);
          job.items = r.items; job.dropped = r.dropped; job.usage = r.usage;
          if (r.items.length) { const vb = await batchCreate(env, batchVerifyRequests(r.items, job.ground, cfg)); job.verBatch = vb.id; job.stage = "verify"; }
          else job.stage = "done";
        } else {
          const v = batchApplyVerify(job.items, results, !!job.ground, cfg);
          job.items = v.items;
          job.usage = job.usage || addUsage(null, cfg.genModel, null);
          ["inTok", "outTok", "thinkTok", "cacheRead", "cacheWrite"].forEach((x) => { job.usage[x] += v.usage[x]; });
          job.usage.usd = Math.round((job.usage.usd + v.usage.usd) * 1e6) / 1e6;
          if (!job.ground) job.items.forEach((it) => { it.qg.u = 1; });
          job.stage = "done";
          const spentK = "prep:qgen:ousd:" + istDay(now);
          const spent = Number(await store.get(spentK).catch(() => 0)) || 0;
          await store.put(spentK, String(spent + job.usage.usd), { expirationTtl: DAY_TTL_S }).catch(() => {});
          later(bump(env, istDay(now), { "maik.cost": usdToInr(job.usage.usd, env), "prep.qgen.batch.items": job.items.length }).catch(() => {}));
        }
        await putJ(store, k, job, JOB_TTL_S);
      }
    }
  } catch (e) { return providerFail(e); }
  const out = { job: brief(), usage: job.usage ? Object.assign({}, job.usage, { inr: usdToInr(job.usage.usd, env) }) : null };
  if (job.stage === "done") { out.items = job.items || []; out.dropped = job.dropped || []; out.meta = { title: job.title, subject: job.subject, module: job.module, exam: job.exam, topic: job.topic }; }
  return json(out);
}

/* ---------------- owner: stage a reviewed batch for the CLI to publish ---------------- */
function cleanItem(it) {
  if (!it || typeof it !== "object" || typeof it.q !== "string" || !Array.isArray(it.o) || it.o.length !== 4 || !Number.isInteger(it.a) || it.a < 0 || it.a > 3) return null;
  const s = (v, m) => cleanText(v, m);
  const o = { id: String(it.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40), q: s(it.q, 1500), o: it.o.map((x) => s(x, 400)), a: it.a, exp: s(it.exp, 1500),
    r: Array.isArray(it.r) ? it.r.slice(0, 4).map((x) => s(x, 500)) : [], kp: s(it.kp, 400), d: Number.isInteger(it.d) ? it.d : 2, cog: s(it.cog, 20),
    tg: Array.isArray(it.tg) ? it.tg.slice(0, 4).map((x) => s(x, 40)) : [], qg: it.qg && typeof it.qg === "object" ? { g: it.qg.g ? 1 : 0, v: s(it.qg.v, 10), why: Array.isArray(it.qg.why) ? it.qg.why.slice(0, 6).map((x) => s(x, 30)) : undefined, ed: it.qg.ed ? 1 : undefined } : undefined };
  if (!o.id || !o.q || o.o.some((x) => !x) || new Set(o.o.map(normText)).size !== 4) return null;
  return o;
}
async function ownerStage(env, b, uid, now) {
  const bucket = env && env.PREP_BANK_R2;
  if (!bucket) return fail(503, "not-configured", "r2");
  const items = Array.isArray(b.items) ? b.items.map(cleanItem) : [];
  if (!items.length || items.length > 1000 || items.some((x) => !x)) return fail(400, "bad-input", "items");
  const subject = String(b.subject || ""), module = String(b.module || "");
  if (!/^[a-z0-9-]{2,60}$/.test(subject) || !/^[a-z0-9-]{2,80}$/.test(module)) return fail(400, "bad-input", "module");
  const stageId = "s" + istDay(now).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 10);
  const rec = { v: 1, stageId, at: now, by: uid.slice(0, 12), title: cleanText(b.title, 120), exam: cleanText(b.exam, 20), subject, module, items };
  await bucket.put("prep-qgen/staging/" + stageId + ".json", JSON.stringify(rec), { httpMetadata: { contentType: "application/json" } });
  return json({ stageId, n: items.length, cmd: "node tools/prep-qgen.mjs publish --stage " + stageId });
}
