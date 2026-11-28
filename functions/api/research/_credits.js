/* ResearchMD Phase 3 credit lifecycle (ES module, server side).
 * Plan section 7: quote with per-step ceilings -> reserve the ceiling -> run
 * -> record actual usage -> settle -> release the rest; partial failure
 * charges only completed steps. The client never writes balances.
 *
 * D-4: reuse the MaiK wallet (functions/_credits.js, KV, INR) for users,
 * plus institution invoicing (admin-granted credits) in research_credit_ledger.
 * The MaiK wallet has NO reserve/settle primitive, so reserve/settle are
 * implemented on research_credit_ledger and the wallet is debited ONCE at
 * settle (documented in 0003_research_v3.sql and gateway.md):
 *   reserve  ledger -quote   (hold; wallet untouched)
 *   release  ledger +quote   (the FULL hold is refunded at settle or failure)
 *   settle   ledger -actual  (the actual charge; for users the wallet is
 *            debited actual INR here, for institutions the ledger IS the
 *            balance store). Net ledger effect per job: -actual, exactly
 *            once; "release the rest" is release minus settle.
 * For user rows owner_id is the MaiK WALLET KEY (em:<email> or fb:<uid>,
 * the _usage.js usageKeyFor scheme), pinned at reserve time so the callback
 * (which holds no user token or email) debits the exact reserved account.
 * A failed/cancelled step releases the full quote and charges nothing.
 *
 * Units: ledger deltas and AI costs are integer micro-USD. The wallet stays
 * INR; conversion at RESEARCH_USD_INR (default 96, the rate _ai_usage.js
 * documents). Institution pool is drawn first when it covers the quote,
 * otherwise the user's MaiK wallet. Caps (ceilings.md) are independent:
 * institution credits raise the balance, never the caps.
 *
 * Residual risk (documented, Phase 6 reconciliation): the wallet cannot hold
 * funds, so concurrent MaiK spend between reserve and settle can shrink the
 * balance; the debit is min(balance, actualInr) and the ledger settle row
 * records the full actual for daily reconciliation.
 */
import { getCreditRecord, putCreditRecord, getCredits } from "../../_credits.js";
import { modelRate } from "../../_ai_usage.js";
import { TIER_CEILINGS } from "./_caps.js";
import { refundCloudFallbackForJob } from "./_cloud_fallback.js";

export function usdInrRate(env) {
  const v = Number(env && env.RESEARCH_USD_INR);
  return Number.isFinite(v) && v > 0 ? v : 96;
}
export function inrToMicroUsd(inr, rate) { return Math.round((Number(inr) || 0) / rate * 1e6); }
export function microUsdToInr(microUsd, rate) { return Math.round((Number(microUsd) || 0) / 1e6 * rate * 100) / 100; }

/* Same binding resolution as _usage.js usageKv (the wallet's store). */
export function walletStore(env) {
  return (env && (env.MAIK_KV || env.CASES_KV || env.GHIS_KV || env.UPDATES_KV)) || null;
}
/* Same key scheme as _usage.js usageKeyFor: em:<email> when the account has
 * a verified email, else fb:<uid>. The research API holds Firebase claims. */
export function walletKeyFor(uid, email) {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  return e ? "em:" + e : "fb:" + uid;
}

/* Provisional per-paper quote ceiling (micro-USD). Plan section 6: pricing
 * is measured on real reviews in Phase 5 before any price is set; this is
 * the env-overridable hold ceiling, not a published price. */
export function quotePdfJob(env) {
  const v = Number(env && env.RESEARCH_PDF_QUOTE_MICRO_USD);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 50000; /* $0.05 */
}
/* Actual pdf_extract charge: the quote scaled by the fraction of the ceiling
 * actually used (pages or wall seconds, whichever is larger). One step: a
 * failed or cancelled job has no completed step and charges 0. */
export function pdfActualMicroUsd(quote, usage, ceilings) {
  const pages = Number(usage && usage.pages) || 0;
  const seconds = Number(usage && usage.seconds) || 0;
  const maxPages = Number(ceilings && ceilings.maxPages) || 60;
  const maxSeconds = Number(ceilings && ceilings.maxSeconds) || 240;
  const util = Math.max(0, Math.min(1, Math.max(pages / maxPages, seconds / maxSeconds)));
  return Math.max(0, Math.min(quote, Math.round(quote * util)));
}

/* AI call quote: the tier ceiling priced at the routed model's published
 * rate (_ai_usage.MODEL_RATES, INR per 1k tokens), converted to micro-USD. */
export function quoteAiCall(env, tier, model) {
  const c = TIER_CEILINGS[tier];
  const r = modelRate(env, model);
  const inr = (c.maxInputTokens / 1000) * r.in + (c.maxOutputTokens / 1000) * r.out;
  return inrToMicroUsd(inr, usdInrRate(env));
}
export function aiActualMicroUsd(env, model, tokensIn, tokensOut) {
  const r = modelRate(env, model);
  const inr = (Math.max(0, tokensIn | 0) / 1000) * r.in + (Math.max(0, tokensOut | 0) / 1000) * r.out;
  return inrToMicroUsd(inr, usdInrRate(env));
}

async function ledgerRow(db, uuid, ownerType, ownerId, delta, reason, jobId, now) {
  await db.prepare(
    "INSERT INTO research_credit_ledger (id,owner_type,owner_id,delta,reason,job_id,ts) VALUES (?,?,?,?,?,?,?)")
    .bind(uuid("crd_"), ownerType, ownerId, delta, reason, jobId || "", now).run();
}

export async function institutionBalance(db, institutionId) {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(delta),0) AS n FROM research_credit_ledger WHERE owner_type='institution' AND owner_id=?")
    .bind(institutionId).first();
  return (row && row.n) || 0;
}
/* Holds still outstanding: reserve rows whose job has not settled. Gateway
 * reserves are released inside the same request, so at rest only queued or
 * running worker jobs hold funds. */
export async function outstandingReserves(db, ownerType, ownerId) {
  const row = await db.prepare(
    "SELECT MAX(0, COALESCE(SUM(-delta),0)) AS n FROM research_credit_ledger WHERE owner_type=? AND owner_id=? AND reason IN ('reserve','release') AND job_id IN (SELECT id FROM research_job_runs WHERE status IN ('queued','running'))")
    .bind(ownerType, ownerId).first();
  return (row && row.n) || 0;
}

/* Currently unreleased hold for a job, keyed to the latest active reserve row
 * so released holds from prior device failures or paired gateway reserves are
 * never double-released or double-settled. */
export async function activeJobReservation(db, jobId) {
  const holdRow = await db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN reason IN ('reserve','release') THEN delta ELSE 0 END), 0) AS hold_net FROM research_credit_ledger WHERE job_id=?")
    .bind(jobId).first();
  const unreleased = -Number((holdRow && holdRow.hold_net) || 0);
  if (!(unreleased > 0)) return null;
  let reserveRow = await db.prepare(
    "SELECT * FROM research_credit_ledger WHERE job_id=? AND reason='reserve' AND delta=? ORDER BY ts DESC, rowid DESC LIMIT 1")
    .bind(jobId, -unreleased).first();
  if (!reserveRow) {
    reserveRow = await db.prepare(
      "SELECT * FROM research_credit_ledger WHERE job_id=? AND reason='reserve' ORDER BY ts DESC, rowid DESC LIMIT 1")
      .bind(jobId).first();
  }
  if (!reserveRow) return null;
  return {
    ownerType: reserveRow.owner_type,
    ownerId: reserveRow.owner_id,
    quote: unreleased,
    jobId,
  };
}
/* A queued/running server job older than this can no longer be running: the
 * worker lease is 2 h and the research worker cron ignores rows older than
 * 3 h, so a queue message that was lost (or a container that died) is
 * permanent. Device-run jobs heartbeat while the app is open and expire after
 * DEVICE_LOST_JOB_MS (15 min) of inactivity as device_failed so credits
 * release and the failed attempt stays excluded from the daily PO cap. */
export const LOST_JOB_MS = 3 * 60 * 60 * 1000;
export const DEVICE_LOST_JOB_MS = 15 * 60 * 1000;

/* Fail lost jobs and release their holds. Idempotent and concurrency-safe:
 * the guarded transition changes a row exactly once, so a second runner (or
 * a racing getter) sees 0 changes and writes no release. Runs are capped at
 * 20 rows per call because callers run it inline on request paths. */
export async function expireLostJobs(db, uuid, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const cutoff = at - LOST_JOB_MS;
  const rows = (await db.prepare(
    "SELECT id FROM research_job_runs WHERE status IN ('queued','running') AND created_ts<? AND (output_json IS NULL OR output_json NOT LIKE '%\"runner\":\"device\"%') ORDER BY created_ts ASC LIMIT 20")
    .bind(cutoff).all()).results || [];
  let failedJobs = 0;
  let releasedMicroUsd = 0;
  for (const row of rows) {
    const upd = await db.prepare(
      "UPDATE research_job_runs SET status='failed',error_code='job_lost',completed_ts=? WHERE id=? AND status IN ('queued','running')")
      .bind(at, row.id).run();
    if (!upd.meta || upd.meta.changes !== 1) continue;
    failedJobs++;
    await refundCloudFallbackForJob(db, row.id, "job_lost").catch(() => {});
    /* Same release shape as a failed worker job (_callback.js): release only
     * the currently active reserve row. */
    const reservation = await activeJobReservation(db, row.id);
    if (!reservation) continue;
    await releaseCredits(db, uuid, reservation);
    releasedMicroUsd += reservation.quote;
  }
  const devCutoff = at - DEVICE_LOST_JOB_MS;
  const devRows = (await db.prepare(
    "SELECT id, created_ts, started_ts, output_json FROM research_job_runs WHERE status IN ('queued','running') AND output_json LIKE '%\"runner\":\"device\"%' ORDER BY created_ts ASC LIMIT 50")
    .all()).results || [];
  for (const row of devRows) {
    if (failedJobs >= 40) break;
    let out = {};
    try { out = JSON.parse(row.output_json || "{}") || {}; } catch { out = {}; }
    if (out.runner !== "device") continue;
    const leaseRefTs = Number(out.lastHeartbeatTs || out.heartbeatTs || row.started_ts || row.created_ts || 0);
    if (leaseRefTs >= devCutoff) continue;
    const upd = await db.prepare(
      "UPDATE research_job_runs SET status='failed',error_code='device_failed',completed_ts=? WHERE id=? AND status IN ('queued','running')")
      .bind(at, row.id).run();
    if (!upd.meta || upd.meta.changes !== 1) continue;
    failedJobs++;
    const reservation = await activeJobReservation(db, row.id);
    if (!reservation) continue;
    await releaseCredits(db, uuid, reservation);
    releasedMicroUsd += reservation.quote;
  }
  /* Stats jobs hold no credits (T0 work), but their status is polled the
   * same way, so they must not stay queued/running forever either. */
  const statsRows = (await db.prepare(
    "SELECT id FROM research_stats_jobs WHERE status IN ('queued','running') AND created_ts<?")
    .bind(cutoff).all()).results || [];
  const statsUpd = await db.prepare(
    "UPDATE research_stats_jobs SET status='failed',error_code='job_lost',completed_ts=? WHERE status IN ('queued','running') AND created_ts<?")
    .bind(at, cutoff).run();
  for (const sr of statsRows) {
    await refundCloudFallbackForJob(db, sr.id, "job_lost").catch(() => {});
  }
  const failedStatsJobs = (statsUpd.meta && statsUpd.meta.changes) || 0;
  return { failedJobs, failedStatsJobs, releasedMicroUsd };
}

/* The member's institution with the largest available pool, if any. */
export async function pickInstitution(db, uid) {
  const rows = (await db.prepare(
    "SELECT institution_id FROM research_institution_members WHERE uid=?")
    .bind(uid).all()).results || [];
  let best = null;
  for (const r of rows) {
    const balance = await institutionBalance(db, r.institution_id);
    const reserved = await outstandingReserves(db, "institution", r.institution_id);
    const available = balance - reserved;
    if (available > 0 && (!best || available > best.available))
      best = { id: r.institution_id, available };
  }
  return best;
}

export async function availableCredits(db, env, uid, email) {
  const rate = usdInrRate(env);
  const store = walletStore(env);
  const walletInr = store ? await getCredits(store, walletKeyFor(uid, email)) : 0;
  const walletMicroUsd = inrToMicroUsd(walletInr, rate);
  const institution = await pickInstitution(db, uid);
  const reserved = (await outstandingReserves(db, "user", walletKeyFor(uid, email))) +
    (institution ? await outstandingReserves(db, "institution", institution.id) : 0);
  const availableMicroUsd = walletMicroUsd + (institution ? institution.available : 0) - reserved;
  return {
    walletInr, walletMicroUsd,
    institutionId: institution ? institution.id : null,
    institutionMicroUsd: institution ? institution.available : 0,
    reservedMicroUsd: reserved,
    availableMicroUsd,
  };
}

/* Spendable balance of ONE pinned owner (micro-USD): wallet minus holds for
 * a user wallet key, ledger balance minus holds for an institution. */
export async function ownerAvailable(db, env, ownerType, ownerId) {
  const reserved = await outstandingReserves(db, ownerType, ownerId);
  if (ownerType === "institution")
    return (await institutionBalance(db, ownerId)) - reserved;
  const store = walletStore(env);
  const inr = store ? await getCredits(store, ownerId) : 0;
  return inrToMicroUsd(inr, usdInrRate(env)) - reserved;
}

/* Reserve the ceiling. Owner: institution pool first when it covers the
 * quote, else the user wallet. `owner` overrides with a pinned owner (the
 * gateway charges the same account the job reserved at creation). The
 * caller checks availability first. */
export async function reserveCredits(db, env, uuid, { uid, email, jobId, quote, owner }) {
  let ownerType, ownerId;
  if (owner) {
    ownerType = owner.ownerType; ownerId = owner.ownerId;
  } else {
    const institution = await pickInstitution(db, uid);
    ownerType = "user"; ownerId = walletKeyFor(uid, email);
    if (institution && institution.available >= quote) {
      ownerType = "institution"; ownerId = institution.id;
    }
  }
  await ledgerRow(db, uuid, ownerType, ownerId, -quote, "reserve", jobId, Date.now());
  return { ownerType, ownerId, quote, jobId };
}

/* Settle: refund the FULL hold, record the actual charge, debit the wallet
 * once (users) or the ledger (institutions). Net effect: -actual, once. */
export async function settleCredits(db, env, uuid, reservation, actualMicroUsd) {
  const actual = Math.max(0, Math.min(reservation.quote, Math.round(actualMicroUsd)));
  const release = reservation.quote;
  const now = Date.now();
  await ledgerRow(db, uuid, reservation.ownerType, reservation.ownerId, release, "release", reservation.jobId, now);
  if (actual > 0) {
    await ledgerRow(db, uuid, reservation.ownerType, reservation.ownerId, -actual, "settle", reservation.jobId, now);
    if (reservation.ownerType === "user") {
      const store = walletStore(env);
      if (store) {
        const key = reservation.ownerId; /* the wallet key pinned at reserve */
        const rec = await getCreditRecord(store, key);
        const chargeInr = microUsdToInr(actual, usdInrRate(env));
        rec.balance = Math.max(0, Math.round(((rec.balance || 0) - chargeInr) * 100) / 100);
        await putCreditRecord(store, key, rec);
      }
    }
  }
  return { chargedMicroUsd: actual, releasedMicroUsd: release };
}

/* Full release: a failed or cancelled step charges nothing (plan section 7:
 * only completed steps are charged). */
export async function releaseCredits(db, uuid, reservation) {
  await ledgerRow(db, uuid, reservation.ownerType, reservation.ownerId, reservation.quote, "release", reservation.jobId, Date.now());
  return { chargedMicroUsd: 0, releasedMicroUsd: reservation.quote };
}

export async function grantInstitutionCredits(db, uuid, institutionId, amountMicroUsd, adminUid) {
  await ledgerRow(db, uuid, "institution", institutionId, amountMicroUsd, "grant", "", Date.now());
  return { balanceMicroUsd: await institutionBalance(db, institutionId) };
}

/* Admin-granted institution credits (D-4 invoicing). Credential: the
 * RESEARCH_ADMIN_TOKEN secret in x-research-admin-token, constant-time.
 * No Firebase user: the admin acts for the institution, not as a member. */
export async function adminInstitutionRoute(ctx, id, action, body) {
  const { request, env, db, requestId, api } = ctx;
  const { json, err, uuid, safeEqual } = api;
  if (!env.RESEARCH_ADMIN_TOKEN)
    return err(503, "admin_unavailable", "Research admin is not configured", requestId);
  if (!safeEqual(request.headers.get("x-research-admin-token") || "", env.RESEARCH_ADMIN_TOKEN))
    return err(401, "unauthorized", "Invalid admin credentials", requestId);
  const now = Date.now();
  if (!id && !action) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120)
      return err(400, "invalid_body", "name must be 1-120 characters", requestId);
    const instId = uuid("inst_");
    await db.prepare("INSERT INTO research_institutions (id,name,created_by,created_ts) VALUES (?,?,?,?)")
      .bind(instId, name, "admin", now).run();
    return json({ institution: { id: instId, name, createdTs: now } }, 201, { "x-request-id": requestId });
  }
  const inst = await db.prepare("SELECT * FROM research_institutions WHERE id=?").bind(id).first();
  if (!inst) return err(404, "institution_not_found", "Institution not found", requestId);
  if (action === "members") {
    const uid = typeof body.uid === "string" ? body.uid.trim() : "";
    if (!uid || uid.length > 128)
      return err(400, "invalid_body", "uid must be 1-128 characters", requestId);
    await db.prepare("INSERT OR IGNORE INTO research_institution_members (institution_id,uid,created_ts) VALUES (?,?,?)")
      .bind(id, uid, now).run();
    return json({ member: { institutionId: id, uid, createdTs: now } }, 201, { "x-request-id": requestId });
  }
  if (action === "credits") {
    const amount = body.amountMicroUsd;
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1e12)
      return err(400, "invalid_body", "amountMicroUsd must be a positive integer", requestId);
    const out = await grantInstitutionCredits(db, uuid, id, amount, "admin");
    return json({ institutionId: id, grantedMicroUsd: amount, balanceMicroUsd: out.balanceMicroUsd },
      201, { "x-request-id": requestId });
  }
  return err(404, "not_found", "Unknown admin endpoint", requestId);
}

/* GET /v1/credits: the caller's own spendable view. Read-only; the client
 * never writes balances. */
export async function creditsView(ctx) {
  const { env, db, uid, claims, requestId, api } = ctx;
  const view = await availableCredits(db, env, uid, claims && claims.email);
  return api.json({ credits: Object.assign({ unit: "micro-USD", usdInrRate: usdInrRate(env) }, view),
    requestId }, 200, { "x-request-id": requestId });
}
