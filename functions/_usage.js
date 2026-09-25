/* StewardMD — MaiK usage metering, quotas & circuit breaker (server-side).
 *
 * Cloudflare KV backed (MAIK_KV, falling back to CASES_KV/GHIS_KV); the project-wide daily rollup and
 * breaker mirror use D1 when bound (_counters.js). Identity is derived SERVER-SIDE from the Firebase ID
 * token (_fbauth.js verifiedClaimsFor, memoised per request)
 * or Cf-Access email; unauthenticated callers fall back to a hashed client IP with a small
 * guest quota. The browser-supplied userId is NEVER trusted.
 *
 * PRIVACY: only aggregate counters are stored — request counts, token estimates, cost,
 * request type, status, timestamp, model. NEVER prompts, patient names, MRNs, reports,
 * images, or any clinical content / PHI.
 *
 * Fail-open: if no KV is bound the module allows the call (returns ok) but cannot meter —
 * so MaiK never breaks purely because metering storage is absent.
 */

import { proFromRequest, proMessageFor } from "./_entitlement.js";
import { aiBudgetOn, monthlyCapFor } from "./_aibudget.js";
import { ownerOK } from "./_adminauth.js";
import { addAiSpend } from "./_ai_usage.js";   // per-user spend rollup (the cost cap + wallet read it)
import { bump, readDay, mergeCounters, MAIK_GROUPS } from "./_counters.js";
import { verifiedClaimsFor } from "./_fbauth.js";


export function usageKv(env) { return env.MAIK_KV || env.CASES_KV || env.GHIS_KV || env.UPDATES_KV || null; }

export function usageConfig(env) {
  const n = (k, d) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  return {
    generalDaily: n("MAIK_GENERAL_DAILY_LIMIT", 60),
    caseDaily: n("MAIK_CASE_DAILY_LIMIT", 30),
    dailyTokens: n("MAIK_DAILY_TOKEN_LIMIT", 200000),
    monthlyTokens: n("MAIK_MONTHLY_TOKEN_LIMIT", 3000000),
    freeMonthlyTokens: n("MAIK_FREE_MONTHLY_TOKEN_LIMIT", 30000),   // non-Pro: ~one full case / month
    maxInputTokens: n("MAIK_MAX_INPUT_TOKENS", 4000),
    ocrDaily: n("MAIK_OCR_DAILY_LIMIT", 10),
    pdfPagesPerReport: n("MAIK_PDF_PAGES_PER_REPORT_LIMIT", 10),
    pdfPagesDaily: n("MAIK_PDF_PAGES_DAILY_LIMIT", 30),
    rateSeconds: n("MAIK_RATE_LIMIT_SECONDS", 3),
    costAlertInr: n("MAIK_PROJECT_DAILY_COST_ALERT_INR", 500),
    costHardStopInr: n("MAIK_PROJECT_DAILY_COST_HARD_STOP_INR", 1000),
    guestDaily: n("MAIK_GUEST_DAILY_LIMIT", 15),
    // model pricing (INR per 1000 tokens) — server-side, estimate only. Override via env.
    priceInInrPer1k: Number(env.MAIK_PRICE_IN_INR_PER_1K) || 0.007,
    priceOutInrPer1k: Number(env.MAIK_PRICE_OUT_INR_PER_1K) || 0.025,
  };
}

// ---- identity (server-derived; browser userId never trusted) ----
// Firebase ID tokens are verified by _fbauth.js verifiedClaimsFor, memoised per Request (T52). This file
// used to carry its own second copy of the verifier, so one AI request verified the same token ~5 times.
export async function sha256hex(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24); }

// Returns { id, guest } — id is an opaque, non-PHI key. Never the raw email/IP in the clear.
/* TRUST NOTE (T28, 2026-09-25): this trusts a Cf-Access-Authenticated-User-Email header as-is. That is
 * only safe behind Cloudflare Access, which also sets Cf-Access-Jwt-Assertion; elsewhere any client can
 * send the header and pick whose quota and wallet it spends. /api/ai strips an UNASSERTED Cf-Access
 * email before calling this (accessSafeRequest in functions/api/ai/[[path]].js), and its authorise()
 * no longer lets any Authorization header through: a bearer must verify as a Firebase ID token.
 * The other callers (license, billing, ward, queue...) still rely on the bare header; tightening them
 * is a separate change with its own tests. */
export async function identify(request, env) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (email) return { id: "cfa:" + (await sha256hex(email.toLowerCase())), guest: false, email: email.toLowerCase() };
  // Verified claims (memoised per request). Key on the uid ("fb:<uid>"), never the whole object:
  // "fb:" + obj once collapsed EVERY signed-in user onto one shared "fb:[object Object]" bucket.
  const fb = await verifiedClaimsFor(request, env);
  if (fb && fb.sub) return { id: "fb:" + fb.sub, guest: false, email: typeof fb.email === "string" ? fb.email.toLowerCase() : null, name: typeof fb.name === "string" ? fb.name : null };
  /* GUEST IDENTITY: per DEVICE when we have one, per IP only as a fallback (2026-08-25).
   *
   * It used to be IP-only, which meant everyone behind one public address shared a SINGLE guest
   * bucket. On a hospital or clinic NAT that is the whole building; on Indian mobile networks it is
   * far worse, because carrier-grade NAT puts thousands of subscribers behind one address — so one
   * heavy guest could lock out every other guest on that carrier IP. The tight cap was on the most
   * SHARED key in the system, which is exactly backwards.
   *
   * The app already sends X-SMD-Device on every AI call (see aiHeaders in reasoning.js), so keying
   * on it makes the guest cap behave the way it reads: per phone.
   *
   * A device id is client-supplied and resets on reinstall, so it is weaker than an IP against a
   * determined abuser. That is precisely what the OTHER two controls are for and they are unchanged:
   * the per-device daily cap (deviceCheck, MAIK_DEVICE_DAILY_CAP, default 300) and the project-wide
   * daily-cost circuit breaker, which nothing exempts anyone from. Signed-in identity is untouched —
   * this only affects callers who present no credentials at all. */
  const dev = request.headers.get("X-SMD-Device");
  if (dev) return { id: "dev:" + (await sha256hex(dev)), guest: true };
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "0";
  return { id: "ip:" + (await sha256hex(ip)), guest: true };
}

// The stable, human-readable usage/limit KEY for a caller: the verified email when signed in
// (so web + native attribute to the SAME person), else the guest IP bucket. Used by the AI usage
// pipeline so records land under "em:<email>" and per-user caps resolve off it.
export function usageKeyFor(who) {
  if (who && who.email) return "em:" + String(who.email).toLowerCase();
  return (who && who.id) || "ip:0";
}

// ---- date keys ----
function dayKey(d) { return d.toISOString().slice(0, 10); }
function monthKey(d) { return d.toISOString().slice(0, 7); }

// ---- token/cost estimation (approximate; provider metadata used when available) ----
export function estTokens(chars) { return Math.max(1, Math.ceil((chars || 0) / 4)); }
export function estCostInr(cfg, inTok, outTok) { return (inTok / 1000) * cfg.priceInInrPer1k + (outTok / 1000) * cfg.priceOutInrPer1k; }

async function readJson(store, key) { try { return (await store.get(key, "json")) || null; } catch (e) { return null; } }
async function writeJson(store, key, obj, ttl) { try { await store.put(key, JSON.stringify(obj), ttl ? { expirationTtl: ttl } : undefined); } catch (e) {} }

// ---- Atomic daily-cost counter (D1) for the global circuit breaker -----------------------------
// The KV global counter (maik:global:<day>) is a non-atomic read-modify-write: a concurrent burst can
// lose updates and UNDERCOUNT, so the breaker trips late/never. D1's per-row UPSERT is atomic, so the
// daily cost total is exact regardless of concurrency. FAIL-SAFE: if UPDATES_DB is unbound or the
// ai_cost_daily table is missing, both helpers return null / no-op and the caller falls back to the KV
// counter exactly as before (zero regression). Cost stored as integer paise (no float drift).
function costDb(env) { try { return (env && env.UPDATES_DB) || null; } catch (e) { return null; } }
async function readDailyCostInr(env, day) {
  const db = costDb(env); if (!db) return null;
  try { const r = await db.prepare("SELECT cost_paise FROM ai_cost_daily WHERE day = ?").bind(day).first(); return r && r.cost_paise != null ? Number(r.cost_paise) / 100 : 0; }
  catch (e) { return null; }   // table missing / D1 error -> caller falls back to the KV counter
}
async function addDailyCostInr(env, day, inr) {
  const db = costDb(env); if (!db) return; const paise = Math.max(0, Math.round((inr || 0) * 100)); if (!paise) return;
  try { await db.prepare("INSERT INTO ai_cost_daily (day, cost_paise) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET cost_paise = cost_paise + excluded.cost_paise").bind(day, paise).run(); }
  catch (e) { /* fail-safe: the KV counter is still recorded by the caller */ }
}

// LAUNCH DECISION (2026-07-31, owner): AI has NO per-user restrictions — every account (signed-in OR
// guest) behaves like the owner. Removes the rate limit + daily/monthly token caps + per-category daily
// request caps that were blocking normal accounts (owners were admin-exempt, so "only my account works").
// The project-wide daily COST circuit breaker still applies and usage is still metered. To re-enable the
// per-user caps later, set env MAIK_ENFORCE_CAPS="1" (no code change).
function aiUnlimited(env) { try { return String(env && env.MAIK_ENFORCE_CAPS) !== "1"; } catch (e) { return true; } }

/* Pre-call gate. type ∈ general|case|intent|ocr|pdf. Returns {ok} or {ok:false, reason, message}.
   Enforces: rate limit, per-user daily requests (by class), daily/monthly tokens, OCR/PDF
   quotas, and the global daily-cost circuit breaker. Fail-open when no KV. */
export async function checkQuota(env, request, type, opts) {
  const store = usageKv(env); if (!store) return { ok: true, id: null, meter: false };
  const cfg = usageConfig(env);
  /* PARALLELISED (2026-08-24). This was nine SERIAL round trips — identity, owner check, entitlement,
   * three global reads, then three per-user reads — and measured as the entire ~400ms of pre-Gemini
   * time in front of every answer (gate/rerank/connect/prompt all landed on the same millisecond).
   * They are independent, so they now run in waves: everything that needs no id starts at once, the
   * per-user counters start as soon as identify() resolves.
   *
   * ORDER OF REFUSAL IS UNCHANGED: the circuit breaker is still evaluated before the rate limit,
   * which is still evaluated before the per-user caps, and every check awaits its own read before
   * deciding. Only the WAITING is overlapped, never the decisions. */
  const _now0 = new Date(), _day0 = dayKey(_now0), _month0 = monthKey(_now0);
  const _qt0 = Date.now(), _qms = {};
  const _tap = (k, p) => Promise.resolve(p).then((v) => { _qms[k] = Date.now() - _qt0; return v; }, (e) => { _qms[k] = Date.now() - _qt0; throw e; });
  const _whoP = _tap("id", identify(request, env));
  const _adminP = _tap("own", ownerOK(request, env)).catch(function () { return false; });
  const _proP = _tap("pro", proFromRequest(env, request)).catch(function () { return null; });
  const _gP = _tap("glob", readJson(store, "maik:global:" + _day0));
  const _boP = _tap("bud", store.get("ai:budget:daily")).catch(function () { return null; });
  const _d1P = _tap("d1", readDailyCostInr(env, _day0)).catch(function () { return null; });
  const who = await _whoP; const id = who.id;
  // per-user reads need the id, so they start now rather than after the global reads have finished
  const _lastP = _tap("rl", readJson(store, "maik:rl:" + id));
  const _uP = _tap("u", readJson(store, "maik:u:" + id + ":" + _day0));
  const _mP = _tap("m", readJson(store, "maik:m:" + id + ":" + _month0));
  // Admin/owner exemption (owner Google login OR X-Admin-Token = UPDATES_ADMIN_TOKEN|VERIFY_ADMIN_TOKEN):
  // skip the per-USER throttles (rate limit, daily/monthly token caps, per-category request counts) so
  // internal benchmarking/eval isn't blocked by the tiny per-user beta caps. Cost is STILL metered and
  // the project-wide daily-cost circuit breaker below still applies — real users are unaffected.
  const admin = await _adminP;
  // exempt = owner/admin OR the launch "no per-user restrictions" default. Only the per-USER throttles
  // below are skipped; the global daily-cost breaker + metering still run for everyone.
  const exempt = admin || aiUnlimited(env);
  let isProCaller = true, callerUid = null, callerVerified = false;
  try { const pr = await _proP; if (pr) { isProCaller = pr.pro; callerUid = pr.uid || null; callerVerified = !!(pr.claims && pr.claims.verified); } } catch (e) {}
  const now = _now0, day = _day0, month = _month0;
  const QUOTA_MSG = "MaiK usage limit reached for now. Clinical reasoning, calculators, and reference tools remain available.";
  const PRO_MSG = "You've used your free MaiK allowance for this month. Upgrade to StewardMD Pro for unlimited clinical AI, imaging, and evidence review.";

  // global circuit breaker (project-wide daily cost). Hard-stop defaults from env but is ADMIN-EDITABLE
  // at runtime via KV ai:budget:daily (the AI Control Center budget editor). Fail-open: a bad/absent
  // value keeps the env default, so the breaker can never be accidentally disabled by a KV read error.
  const g = (await _gP) || { cost: 0, req: 0, blocked: 0 };
  let hardStop = cfg.costHardStopInr;
  try { const bo = Number(await _boP); if (Number.isFinite(bo) && bo > 0) hardStop = bo; } catch (e) {}
  // Prefer the ATOMIC D1 daily-cost total (exact under concurrency) over the racy KV counter, so the
  // breaker trips reliably instead of undercounting; fall back to KV when D1 is unavailable.
  let breakerCost = g.cost;
  { const d1c = await _d1P; if (d1c != null && d1c > breakerCost) breakerCost = d1c; }
  if (breakerCost >= hardStop && !(request.headers.get("X-Maik-Admin-Override") === (env.UPDATES_ADMIN_TOKEN || "\0"))) {
    return { ok: false, reason: "circuit-breaker", message: QUOTA_MSG, id };
  }
  // per-user rate limit. The "router" type (the always-on semantic parser) is EXEMPT: it is a tiny
  // internal parse that precedes the real answer call, so it must neither consume the 3s cooldown nor
  // block the answer that follows it ~0.5s later. Cost is still bounded by the token caps + breaker.
  const rlKey = "maik:rl:" + id;
  if (type !== "router" && !exempt) {
    const last = await _lastP;
    if (last && (Date.now() - last.t) < cfg.rateSeconds * 1000) return { ok: false, reason: "rate", message: QUOTA_MSG, id };
  }

  // per-user daily/monthly counters
  const uKey = "maik:u:" + id + ":" + day, mKey = "maik:m:" + id + ":" + month;
  const u = (await _uP) || { general: 0, case: 0, intent: 0, ocr: 0, pdfPages: 0, tokens: 0 };
  const m = (await _mP) || { tokens: 0 };

  if (!exempt && u.tokens >= cfg.dailyTokens) return { ok: false, reason: "daily-tokens", message: QUOTA_MSG, id };
  let monthlyCap = isProCaller ? cfg.monthlyTokens : cfg.freeMonthlyTokens;
  let budgetApplied = false;
  if (aiBudgetOn(env) && callerUid) {
    try {
      const cap = await monthlyCapFor(env, callerUid, isProCaller, callerVerified, month, { kv: store });
      if (cap != null) { monthlyCap = cap; budgetApplied = true; }
    } catch (e) { /* fail-open: keep legacy cap */ }
  }
  if (!exempt && m.tokens >= monthlyCap) {
    if (!isProCaller) {
      // callerVerified is already resolved above for the budget cap. Reuse it: "upgrade to Pro"
      // is the wrong ask for someone whose registration simply is not verified yet.
      const _r = callerVerified ? "verified-week-expired" : "unverified";
      return { ok: false, reason: _r, needsPro: true, verified: !!callerVerified, message: proMessageFor(_r), id };
    }
    return { ok: false, reason: budgetApplied ? "over-budget" : "monthly-tokens", message: QUOTA_MSG, id };
  }
  if (!exempt) {
    if (type === "general" || type === "intent") { const lim = who.guest ? cfg.guestDaily : cfg.generalDaily; if (u.general >= lim) return { ok: false, reason: "daily-requests", message: QUOTA_MSG, id }; }
    else if (type === "case") { if (u.case >= cfg.caseDaily) return { ok: false, reason: "daily-requests", message: QUOTA_MSG, id }; }
    else if (type === "ocr") { if (u.ocr >= cfg.ocrDaily) return { ok: false, reason: "ocr-daily", message: QUOTA_MSG, id }; }
    else if (type === "pdf") {
      const pages = (opts && opts.pages) || 1;
      if (pages > cfg.pdfPagesPerReport) return { ok: false, reason: "pdf-per-report", message: QUOTA_MSG, id };
      if (u.pdfPages + pages > cfg.pdfPagesDaily) return { ok: false, reason: "pdf-daily", message: QUOTA_MSG, id };
    }
  }
  // reserve the rate-limit slot immediately (best-effort; KV is not atomic). Router + admin are exempt.
  /* Reserve the rate-limit slot. Measured: a KV write costs ~380ms here, and awaiting it was the LAST
   * ~400ms of dead time in front of every answer (every read in this function finishes in <15ms).
   * opts.waitUntil runs it CONCURRENTLY with the response rather than skipping it, so the slot is
   * still written ~380ms later — well inside the 3s cooldown it enforces. This narrows the
   * double-fire window from "none" to "~380ms" on a control the code already calls best-effort and
   * non-atomic; without waitUntil the original awaited behaviour is kept. */
  if (type !== "router" && !exempt) {
    const _wr = () => writeJson(store, rlKey, { t: Date.now() }, 60);
    if (opts && typeof opts.waitUntil === "function") { try { opts.waitUntil(_wr()); } catch (e) { await _wr(); } }
    else await _wr();
  }
  _qms.total = Date.now() - _qt0;
  // costKey: the identity the WALLET and the cost cap use (em:<email>, else the device/ip id). It is
  // deliberately not `id` — that is "fb:<uid>" for a signed-in doctor, while credits and the aiu:doc
  // rollup are keyed by email, so recordUsage must bill against this one or the spend lands nowhere.
  return { ok: true, id, costKey: usageKeyFor(who), guest: who.guest, meter: true, _day: day, _month: month, u, m, g, cfg, store, type, env, _qms };
}

// Best-effort per-DEVICE daily abuse cap (anti account-farming). Device id = X-SMD-Device header
// (from device-id.js). Speed-bump only — resets on reinstall; the global cost breaker is the real
// backstop. env MAIK_DEVICE_DAILY_CAP (default 300; 0 disables). Fail-open on any gap.
export function deviceDailyCap(env) {
  const v = Number(env && env.MAIK_DEVICE_DAILY_CAP);
  return Number.isFinite(v) && v >= 0 ? v : 300;
}
/* waitUntil (optional): defer the counter WRITE past the response. The read still gates the cap —
 * only the increment is deferred — and a KV write was measured adding real dead time in front of
 * every answer. Omit it and the old awaited behaviour is kept, so existing callers are unchanged. */
export async function deviceCheck(env, store, request, now, waitUntil) {
  const cap = deviceDailyCap(env);
  if (!store || !cap) return { ok: true };
  const dev = request.headers.get("X-SMD-Device");
  if (!dev) return { ok: true };
  const day = dayKey(new Date(now || Date.now()));
  const key = "aiu:dev:" + dev + ":" + day;
  let used = 0;
  try { used = Number(await store.get(key)) || 0; } catch (e) { return { ok: true }; }
  if (used >= cap) return { ok: false, reason: "device-cap", used: used, cap: cap };
  const put = function () { return store.put(key, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 }); };
  if (typeof waitUntil === "function") { try { waitUntil(put().catch(function () {})); } catch (e) {} }
  else { try { await put(); } catch (e) {} }
  return { ok: true, used: used + 1, cap: cap };
}

/* Post-call record. gate is the object returned by checkQuota (ok:true). Records counters +
   cost; NEVER any prompt/PHI. status ∈ success|failed|timeout|blocked. */
export async function recordUsage(gate, info) {
  if (!gate || !gate.meter || !gate.store) return;
  const cfg = gate.cfg, store = gate.store;
  const inTok = Math.max(0, info.inTok | 0), outTok = Math.max(0, info.outTok | 0);
  /* Implicit prompt caching (audit section 7): Vertex caches a repeated prompt prefix automatically
   * and bills those input tokens at a 90% discount (usageMetadata.cachedContentTokenCount). Price
   * them at 10% and count them, so the report shows whether the static system prompt is being hit. */
  const cachedTok = Math.min(inTok, Math.max(0, info.cachedTok | 0));
  const cost = estCostInr(cfg, inTok - cachedTok * 0.9, outTok);
  const u = gate.u, m = gate.m, g = gate.g;
  /* Only a GENERATED result counts against the per-user daily request caps (T36): a cache hit
   * (status "cache"), a failed call, and a continuation the caller marks noCount (MaiK's tier-2
   * "Know more") are metered for tokens/cost below but are not a new request. */
  if (info.status === "success" && !info.noCount) {
    if (gate.type === "general" || gate.type === "intent") u.general += 1;
    else if (gate.type === "case") u.case += 1;
    if (gate.type === "intent") u.intent += 1;
    if (gate.type === "ocr") u.ocr += 1;
    if (gate.type === "pdf") u.pdfPages += (info.pages || 1);
  }
  u.tokens += inTok + outTok; m.tokens += inTok + outTok;
  g.cost += cost; g.req += 1; g.inTok = (g.inTok || 0) + inTok; g.cachedTok = (g.cachedTok || 0) + cachedTok;
  // per-request-type + status tallies for the admin view (no content)
  g.byType = g.byType || {}; g.byType[gate.type] = (g.byType[gate.type] || 0) + 1;
  g.byStatus = g.byStatus || {}; g.byStatus[info.status || "success"] = (g.byStatus[info.status || "success"] || 0) + 1;
  if (info.status === "blocked") g.blocked += 1;
  const dayTtl = 60 * 60 * 26, monTtl = 60 * 60 * 24 * 32;
  await writeJson(store, "maik:u:" + gate.id + ":" + gate._day, u, dayTtl);
  await writeJson(store, "maik:m:" + gate.id + ":" + gate._month, m, monTtl);
  // Project-wide rollup: atomic D1 counters when available (T53). The KV maik:global object was
  // read in checkQuota and written back here SECONDS later, so concurrent requests overwrote each
  // other; it is now only the fallback.
  const st = info.status || "success";
  const gi = { "maik.cost": cost, "maik.req": 1, "maik.blocked": st === "blocked" ? 1 : 0, "maik.inTok": inTok, "maik.cachedTok": cachedTok };
  gi["maik.type." + gate.type] = 1; gi["maik.status." + st] = 1;
  if (!(await bump(gate.env, gate._day, gi))) await writeJson(store, "maik:global:" + gate._day, g, dayTtl);
  try { await addDailyCostInr(gate.env, gate._day, cost); } catch (e) {}   // atomic mirror (exact under concurrency)
  // Per-USER spend, for the cost cap / prepaid wallet / AI Usage dashboard. Without this the aiu:doc
  // rollup those three read carries only request COUNTS (see addAiSpend), so the cap never fires.
  try { await addAiSpend(store, gate.costKey, gate._day, cost, inTok + outTok); } catch (e) {}
  return { cost, alert: g.cost >= cfg.costAlertInr && g.cost < cfg.costHardStopInr };
}

// Shared token accounting for non-MaiK AI surfaces (e.g. ThoreX LLM) so they draw from the same
// monthly allowance. Increments the same maik:m / maik:u / maik:global counters recordUsage uses.
export async function meterTokens(env, id, inTok, outTok) {
  const store = usageKv(env); if (!store || !id) return;
  const cfg = usageConfig(env);
  const now = new Date(), day = dayKey(now), month = monthKey(now);
  const uKey = "maik:u:" + id + ":" + day, mKey = "maik:m:" + id + ":" + month;
  const u = (await readJson(store, uKey)) || { general: 0, case: 0, intent: 0, ocr: 0, pdfPages: 0, tokens: 0 };
  const m = (await readJson(store, mKey)) || { tokens: 0 };
  const g = (await readJson(store, "maik:global:" + day)) || { cost: 0, req: 0, blocked: 0 };
  const tot = (inTok || 0) + (outTok || 0);
  const cost = ((inTok || 0) / 1000) * cfg.priceInInrPer1k + ((outTok || 0) / 1000) * cfg.priceOutInrPer1k;
  u.tokens += tot; m.tokens += tot; g.cost += cost; g.req += 1;
  const dayTtl = 60 * 60 * 26, monTtl = 60 * 60 * 24 * 32;
  await writeJson(store, uKey, u, dayTtl); await writeJson(store, mKey, m, monTtl);
  if (!(await bump(env, day, { "maik.cost": cost, "maik.req": 1 }))) await writeJson(store, "maik:global:" + day, g, dayTtl);   // T53
  try { await addDailyCostInr(env, day, cost); } catch (e) {}   // atomic mirror for the global breaker
}

/* Admin aggregate (token-gated by the caller). Anonymised — account ids are already
   hashed; returns totals, per-type/status breakdown, breaker status, and top accounts. */
export async function adminReport(env) {
  const store = usageKv(env); if (!store) return { enabled: false };
  const cfg = usageConfig(env);
  const now = new Date(), day = dayKey(now), month = monthKey(now);
  const g0 = (await readJson(store, "maik:global:" + day)) || { cost: 0, req: 0, blocked: 0, byType: {}, byStatus: {} };
  const d1 = await readDay(env, day, "maik.");
  const g = d1 ? mergeCounters(g0, d1, "maik", MAIK_GROUPS) : g0;   // KV (fallback) + D1 atomic counters (T53)
  // list per-user day keys (best-effort; KV list is paginated)
  let users = [], cursor, dayTokens = 0;
  try {
    do {
      const res = await store.list({ prefix: "maik:u:", cursor, limit: 1000 });
      for (const k of res.keys) if (k.name.endsWith(":" + day)) { const v = await readJson(store, k.name); if (v) { users.push({ acct: k.name.slice(6, -11).slice(0, 16), tokens: v.tokens || 0, general: v.general || 0, case: v.case || 0, ocr: v.ocr || 0 }); dayTokens += v.tokens || 0; } }
      cursor = res.list_complete ? null : res.cursor;
    } while (cursor);
  } catch (e) {}
  users.sort((a, b) => b.tokens - a.tokens);
  const breaker = g.cost >= cfg.costHardStopInr ? "HARD-STOP" : g.cost >= cfg.costAlertInr ? "ALERT" : "ok";
  return {
    enabled: true, day, month,
    daily: { requests: g.req || 0, tokens: dayTokens, estCostInr: Math.round((g.cost || 0) * 100) / 100, blocked: g.blocked || 0 },
    byType: g.byType || {}, byStatus: g.byStatus || {},
    promptCache: { inputTokens: g.inTok || 0, cachedTokens: g.cachedTok || 0, hitPct: g.inTok ? Math.round((g.cachedTok || 0) / g.inTok * 1000) / 10 : 0 },
    circuitBreaker: { status: breaker, dailyCostInr: Math.round((g.cost || 0) * 100) / 100, alertInr: cfg.costAlertInr, hardStopInr: cfg.costHardStopInr },
    limits: { generalDaily: cfg.generalDaily, caseDaily: cfg.caseDaily, dailyTokens: cfg.dailyTokens, monthlyTokens: cfg.monthlyTokens },
    accounts: users.slice(0, 50), accountCount: users.length,
    note: "Costs are ESTIMATED from token counts; no prompts, patient data, or PHI are stored.",
  };
}

// Deploy marker: force a fresh Pages build so the MAIK_KV binding attaches to the runtime (2026-07-03).
// Re-trigger: build with the confirmed KV bindings (GHIS_KV, MAIK_KV, UPDATES_KV) present (2026-07-03 #2).
