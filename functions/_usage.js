/* StewardMD — MaiK usage metering, quotas & circuit breaker (server-side).
 *
 * Cloudflare KV backed (MAIK_KV, falling back to CASES_KV/GHIS_KV — NOT D1). Identity is
 * derived SERVER-SIDE from the Firebase ID token (same verification as functions/api/cases)
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

import { proFromRequest } from "./_entitlement.js";
import { aiBudgetOn, monthlyCapFor } from "./_aibudget.js";
import { ownerOK } from "./_adminauth.js";

const FB_PROJECT_DEFAULT = "stewardmd-498ec";
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

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
    maxOutputTokens: n("MAIK_MAX_OUTPUT_TOKENS", 800),
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
let _jwks = null, _jwksExp = 0;
function b64urlToBytes(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function b64urlToString(s) { return new TextDecoder().decode(b64urlToBytes(s)); }
async function getJwks() {
  const now = Date.now(); if (_jwks && now < _jwksExp) return _jwks;
  const r = await fetch(JWK_URL); const data = await r.json(); const map = {};
  for (const k of (data.keys || [])) map[k.kid] = k;
  const cc = r.headers.get("Cache-Control") || "", m = cc.match(/max-age=(\d+)/);
  _jwksExp = now + (m ? parseInt(m[1], 10) * 1000 : 3600 * 1000); _jwks = map; return map;
}
async function verifyFirebaseToken(token, env) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const parts = String(token || "").split("."); if (parts.length !== 3) return null;
  let header, payload;
  try { header = JSON.parse(b64urlToString(parts[0])); payload = JSON.parse(b64urlToString(parts[1])); } catch (e) { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== project) return null;
  if (payload.iss !== "https://securetoken.google.com/" + project) return null;
  if (!payload.sub || !(typeof payload.exp === "number" && payload.exp > now)) return null;
  const jwk = (await getJwks())[header.kid]; if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    return ok ? { uid: payload.sub, email: (typeof payload.email === "string" ? payload.email : null), name: (typeof payload.name === "string" ? payload.name : null) } : null;
  } catch (e) { return null; }
}
export async function sha256hex(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24); }

// Returns { id, guest } — id is an opaque, non-PHI key. Never the raw email/IP in the clear.
// Pull the email out of an ALREADY-VERIFIED Firebase token payload (verifyFirebaseToken checked the
// signature/aud/iss/exp before we get here, so decoding the payload is safe).
function emailFromBearer(tok) {
  try {
    const p = String(tok || "").split("."); if (p.length < 2) return null;
    let s = p[1].replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const j = JSON.parse(new TextDecoder().decode(u));
    return j && j.email ? String(j.email).toLowerCase() : null;
  } catch (e) { return null; }
}

export async function identify(request, env) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (email) return { id: "cfa:" + (await sha256hex(email.toLowerCase())), guest: false, email: email.toLowerCase() };
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  // verifyFirebaseToken (THIS file's copy, ~line 59) returns an OBJECT { uid, email } or null. Read the
  // .uid off it. Coercing the whole object into the key ("fb:" + obj → "fb:[object Object]") collapsed
  // EVERY signed-in user onto ONE shared id, so all accounts shared a single KU ledger + quota bucket
  // (balances appeared to "reset" to the shared total; metering merged). Per-account key = "fb:<uid>".
  if (tok) { const fb = await verifyFirebaseToken(tok, env); if (fb && fb.uid) return { id: "fb:" + fb.uid, guest: false, email: fb.email || emailFromBearer(tok), name: fb.name || null }; }
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
  const who = await identify(request, env); const id = who.id;
  // Admin/owner exemption (owner Google login OR X-Admin-Token = UPDATES_ADMIN_TOKEN|VERIFY_ADMIN_TOKEN):
  // skip the per-USER throttles (rate limit, daily/monthly token caps, per-category request counts) so
  // internal benchmarking/eval isn't blocked by the tiny per-user beta caps. Cost is STILL metered and
  // the project-wide daily-cost circuit breaker below still applies — real users are unaffected.
  const admin = await ownerOK(request, env);
  // exempt = owner/admin OR the launch "no per-user restrictions" default. Only the per-USER throttles
  // below are skipped; the global daily-cost breaker + metering still run for everyone.
  const exempt = admin || aiUnlimited(env);
  let isProCaller = true, callerUid = null, callerVerified = false;
  try { const pr = await proFromRequest(env, request); isProCaller = pr.pro; callerUid = pr.uid || null; callerVerified = !!(pr.claims && pr.claims.verified); } catch (e) {}
  const now = new Date(), day = dayKey(now), month = monthKey(now);
  const QUOTA_MSG = "MaiK usage limit reached for now. Clinical reasoning, calculators, and reference tools remain available.";
  const PRO_MSG = "You've used your free MaiK allowance for this month. Upgrade to StewardMD Pro for unlimited clinical AI, imaging, and evidence review.";

  // global circuit breaker (project-wide daily cost). Hard-stop defaults from env but is ADMIN-EDITABLE
  // at runtime via KV ai:budget:daily (the AI Control Center budget editor). Fail-open: a bad/absent
  // value keeps the env default, so the breaker can never be accidentally disabled by a KV read error.
  const g = (await readJson(store, "maik:global:" + day)) || { cost: 0, req: 0, blocked: 0 };
  let hardStop = cfg.costHardStopInr;
  try { const bo = Number(await store.get("ai:budget:daily")); if (Number.isFinite(bo) && bo > 0) hardStop = bo; } catch (e) {}
  if (g.cost >= hardStop && !(request.headers.get("X-Maik-Admin-Override") === (env.UPDATES_ADMIN_TOKEN || "\0"))) {
    return { ok: false, reason: "circuit-breaker", message: QUOTA_MSG, id };
  }
  // per-user rate limit. The "router" type (the always-on semantic parser) is EXEMPT: it is a tiny
  // internal parse that precedes the real answer call, so it must neither consume the 3s cooldown nor
  // block the answer that follows it ~0.5s later. Cost is still bounded by the token caps + breaker.
  const rlKey = "maik:rl:" + id;
  if (type !== "router" && !exempt) {
    const last = await readJson(store, rlKey);
    if (last && (Date.now() - last.t) < cfg.rateSeconds * 1000) return { ok: false, reason: "rate", message: QUOTA_MSG, id };
  }

  // per-user daily/monthly counters
  const uKey = "maik:u:" + id + ":" + day, mKey = "maik:m:" + id + ":" + month;
  const u = (await readJson(store, uKey)) || { general: 0, case: 0, intent: 0, ocr: 0, pdfPages: 0, tokens: 0 };
  const m = (await readJson(store, mKey)) || { tokens: 0 };

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
    if (!isProCaller) return { ok: false, reason: "needs-pro", needsPro: true, message: PRO_MSG, id };
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
  if (type !== "router" && !exempt) await writeJson(store, rlKey, { t: Date.now() }, 60);
  return { ok: true, id, guest: who.guest, meter: true, _day: day, _month: month, u, m, g, cfg, store, type };
}

// Best-effort per-DEVICE daily abuse cap (anti account-farming). Device id = X-SMD-Device header
// (from device-id.js). Speed-bump only — resets on reinstall; the global cost breaker is the real
// backstop. env MAIK_DEVICE_DAILY_CAP (default 300; 0 disables). Fail-open on any gap.
export function deviceDailyCap(env) {
  const v = Number(env && env.MAIK_DEVICE_DAILY_CAP);
  return Number.isFinite(v) && v >= 0 ? v : 300;
}
export async function deviceCheck(env, store, request, now) {
  const cap = deviceDailyCap(env);
  if (!store || !cap) return { ok: true };
  const dev = request.headers.get("X-SMD-Device");
  if (!dev) return { ok: true };
  const day = dayKey(new Date(now || Date.now()));
  const key = "aiu:dev:" + dev + ":" + day;
  let used = 0;
  try { used = Number(await store.get(key)) || 0; } catch (e) { return { ok: true }; }
  if (used >= cap) return { ok: false, reason: "device-cap", used: used, cap: cap };
  try { await store.put(key, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 }); } catch (e) {}
  return { ok: true, used: used + 1, cap: cap };
}

/* Post-call record. gate is the object returned by checkQuota (ok:true). Records counters +
   cost; NEVER any prompt/PHI. status ∈ success|failed|timeout|blocked. */
export async function recordUsage(gate, info) {
  if (!gate || !gate.meter || !gate.store) return;
  const cfg = gate.cfg, store = gate.store;
  const inTok = Math.max(0, info.inTok | 0), outTok = Math.max(0, info.outTok | 0);
  const cost = estCostInr(cfg, inTok, outTok);
  const u = gate.u, m = gate.m, g = gate.g;
  if (gate.type === "general" || gate.type === "intent") u.general += 1;
  else if (gate.type === "case") u.case += 1;
  if (gate.type === "intent") u.intent += 1;
  if (gate.type === "ocr") u.ocr += 1;
  if (gate.type === "pdf") u.pdfPages += (info.pages || 1);
  u.tokens += inTok + outTok; m.tokens += inTok + outTok;
  g.cost += cost; g.req += 1;
  // per-request-type + status tallies for the admin view (no content)
  g.byType = g.byType || {}; g.byType[gate.type] = (g.byType[gate.type] || 0) + 1;
  g.byStatus = g.byStatus || {}; g.byStatus[info.status || "success"] = (g.byStatus[info.status || "success"] || 0) + 1;
  if (info.status === "blocked") g.blocked += 1;
  const dayTtl = 60 * 60 * 26, monTtl = 60 * 60 * 24 * 32;
  await writeJson(store, "maik:u:" + gate.id + ":" + gate._day, u, dayTtl);
  await writeJson(store, "maik:m:" + gate.id + ":" + gate._month, m, monTtl);
  await writeJson(store, "maik:global:" + gate._day, g, dayTtl);
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
  await writeJson(store, uKey, u, dayTtl); await writeJson(store, mKey, m, monTtl); await writeJson(store, "maik:global:" + day, g, dayTtl);
}

/* Admin aggregate (token-gated by the caller). Anonymised — account ids are already
   hashed; returns totals, per-type/status breakdown, breaker status, and top accounts. */
export async function adminReport(env) {
  const store = usageKv(env); if (!store) return { enabled: false };
  const cfg = usageConfig(env);
  const now = new Date(), day = dayKey(now), month = monthKey(now);
  const g = (await readJson(store, "maik:global:" + day)) || { cost: 0, req: 0, blocked: 0, byType: {}, byStatus: {} };
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
    circuitBreaker: { status: breaker, dailyCostInr: Math.round((g.cost || 0) * 100) / 100, alertInr: cfg.costAlertInr, hardStopInr: cfg.costHardStopInr },
    limits: { generalDaily: cfg.generalDaily, caseDaily: cfg.caseDaily, dailyTokens: cfg.dailyTokens, monthlyTokens: cfg.monthlyTokens, maxOutputTokens: cfg.maxOutputTokens },
    accounts: users.slice(0, 50), accountCount: users.length,
    note: "Costs are ESTIMATED from token counts; no prompts, patient data, or PHI are stored.",
  };
}

// Deploy marker: force a fresh Pages build so the MAIK_KV binding attaches to the runtime (2026-07-03).
// Re-trigger: build with the confirmed KV bindings (GHIS_KV, MAIK_KV, UPDATES_KV) present (2026-07-03 #2).
