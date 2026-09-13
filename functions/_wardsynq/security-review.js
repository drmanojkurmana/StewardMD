/* functions/_wardsynq/security-review.js - who looked at what, who took what out, who got in, and
 * whether anyone has checked. P2.17 (security review) and the P2.15 restore-visibility gap.
 *
 * ADVISORY, NEVER ENFORCING. Every rule here is a deterministic count over rows the system already
 * wrote. A finding is a question for a human, not a verdict: nothing in this file locks an account,
 * revokes a session or blocks a read. A rule that auto-locked a consultant at 3am because the ward
 * was busy would be a patient-safety hazard and would teach people to share logins.
 *
 * EVERY FINDING CARRIES ITS ROWS. A count with no evidence cannot be checked and cannot be argued
 * with; the reviewer sees the audit rows that produced it (capped, with the true total stated).
 *
 * NO FALSE GREENS. A section that could not read its source says "unavailable" with the reason. An
 * empty findings list is only ever produced from a successful read, and the data-protection status
 * is green only when a backup meets its objective AND a successful restore test is on the record.
 *
 * WHAT IS NOT DETECTED, AND WHY (stated on the report too):
 *   - reads of a patient outside the reader's ward/assignment: there is no staff-to-ward assignment
 *     data (memberships scope departments/OPDs/rooms only), and audit rows carry a pseudonymised
 *     patient reference, not a ward.
 *   - reads of a patient who is also staff: not identifiable without joining staff identity to
 *     patient identity, which is new PHI processing this review must not introduce.
 *   - VIP / sensitive patients: no such flag exists on the record.
 *   - denied READS: the record service audits denied WRITES (record.denied); a refused read throws
 *     before any row is written, so repeated-denial counts writes and any row whose outcome is denied.
 *
 * Storage-agnostic: audit rows come from the repository's optional auditTrail(), sign-in and admin
 * rows are handed in by the router from the hospital's own event log. No platform calls here.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { RUN_TYPE, rpoVerdict } from "./backup-run.js";

const str = (v) => (v == null ? "" : String(v).trim());
const DAY = 86400000;
const REVIEW_TYPE = "SecurityReview";
const RESTORE_TYPE = "RestoreTest";
const EVIDENCE_CAP = 50;

/* Every threshold in one place, and returned on the report so a reviewer can see the method. */
const RULES = Object.freeze({
  baselineDays: 28,
  distinctPatients: { minBaselineDays: 5, multiple: 3, minExcess: 20, noBaselineFloor: 50 },
  offHours: { minBaselineReads: 20, neighbourHours: 1 },
  denied: { threshold: 5 },
  exportVolume: { multiple: 3, floor: { backup: 500, roster: 5000, release: 10 } },
  login: { failedThreshold: 5, deviceWindowMinutes: 60, deviceCount: 3 },
});

const METHOD = {
  "chart-access-volume": "Distinct patients read per UTC day, per user, against the median of that user's own active days in the previous 28 days. Flagged above 3x the median and at least 20 more patients. With fewer than 5 baseline days, flagged at 50 or more distinct patients in a day.",
  "chart-access-off-hours": "Reads at a UTC hour when the user made no reads in that hour or the hours either side of it across the previous 28 days. Needs at least 20 baseline reads.",
  "repeated-denied": "5 or more denied record actions by one user in the period.",
  "unusual-export": "Rows taken out per user and channel (backup export, whole-tenant roster reads, patient copies and release-of-information) against that user's own daily average over the previous 28 days scaled to the period. Flagged above 3x that expectation and above a floor (500 backup rows, 5000 roster rows, 10 releases).",
  "failed-sign-ins": "5 or more failed, locked or refused sign-in or two-step attempts for one staff ID in the period.",
  "new-device": "A successful sign-in from a device label not seen on any earlier successful sign-in for that staff ID. The device label is coarse (from the browser's user agent), so this is a prompt to ask, not proof of a different machine.",
  "many-devices": "Successful sign-ins for one staff ID from 3 or more device labels within 60 minutes.",
};

const NOT_DETECTED = [
  { rule: "reads outside ward or assignment", reason: "No staff-to-ward assignment data exists, and audit rows carry a pseudonymised patient reference, not a ward." },
  { rule: "reads of a patient who is also staff", reason: "Not identifiable without linking staff identity to patient identity, which would be new PHI processing." },
  { rule: "VIP or sensitive-flagged patients", reason: "No VIP or sensitive flag exists on the patient record." },
];

const FAILED_SIGNIN = new Set(["login:pin_failed", "login:pin_lockout", "login:pin_locked", "login:pin_refused",
  "login:password_failed", "login:password_lockout", "login:password_locked", "login:password_refused", "mfa:failed", "mfa:lockout"]);
const OK_SIGNIN = new Set(["login:pin_ok", "login:password_ok"]);
/* Admin acts that change who can do what, or how the hospital is configured. */
const PRIVILEGED = new Set(["member:set", "member:disable", "member:restore", "member:set_pin", "member:set_password",
  "member:reset_access", "org:update", "org:delete"]);
const RELEASE_TYPES = new Set(["PatientRecordRelease", "ROIRequest"]);

const msOf = (ts) => (typeof ts === "number" ? ts : Date.parse(str(ts)));
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const actorOf = (e) => str(e.actor || e.actorId);

/** PURE. The row as a reviewer sees it: envelope only, never record content. */
function evidenceRow(e) {
  const scope = e.scope || {};
  return { id: e.id || null, ts: e.ts, actor: actorOf(e) || null, action: e.action || null,
    resourceType: scope.resourceType || null, patientRef: e.patientRefHash || null, outcome: e.outcome || null,
    detail: e.meta != null ? str(e.meta) : (e.detail != null ? str(e.detail) : null) };
}

function finding(type, actor, summary, rows, extra) {
  return { type, actor, summary, method: METHOD[type], evidence: rows.slice(0, EVIDENCE_CAP).map(evidenceRow), evidenceTotal: rows.length, ...(extra || {}) };
}

/** PURE. Splits rows into the review period [from, to) and the baseline window before it. */
function windows(events, from, to) {
  const fromMs = msOf(from), toMs = msOf(to), baseMs = fromMs - RULES.baselineDays * DAY;
  const period = [], baseline = [];
  for (const e of events || []) {
    const t = msOf(e && e.ts);
    if (!Number.isFinite(t)) continue;
    if (t >= fromMs && t < toMs) period.push(e);
    else if (t >= baseMs && t < fromMs) baseline.push(e);
  }
  return { period, baseline, periodDays: Math.max(1, (toMs - fromMs) / DAY) };
}

const groupBy = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

/** PURE. Chart-access anomalies over record audit rows. */
function chartAccessFindings(events, period) {
  const { period: inP, baseline } = windows(events, period.from, period.to);
  const isRead = (e) => e.action === "record.read" && e.patientRefHash;
  const out = [];
  const R = RULES.distinctPatients;

  const baseByActor = groupBy(baseline.filter(isRead), actorOf);
  for (const [actor, rows] of groupBy(inP.filter(isRead), actorOf)) {
    const base = baseByActor.get(actor) || [];
    const baseDaily = [...groupBy(base, (e) => isoDay(msOf(e.ts))).values()].map((d) => new Set(d.map((e) => e.patientRefHash)).size);
    const med = median(baseDaily);
    for (const [day, dayRows] of groupBy(rows, (e) => isoDay(msOf(e.ts)))) {
      const n = new Set(dayRows.map((e) => e.patientRefHash)).size;
      const hasBaseline = baseDaily.length >= R.minBaselineDays;
      const flagged = hasBaseline ? (n > med * R.multiple && n - med >= R.minExcess) : n >= R.noBaselineFloor;
      if (flagged) {
        out.push(finding("chart-access-volume", actor,
          hasBaseline ? `${n} distinct patients read on ${day}; this user's usual day is ${med}.` : `${n} distinct patients read on ${day}; not enough earlier activity for a personal baseline.`,
          dayRows, { day, distinctPatients: n, baselineMedian: hasBaseline ? med : null, baselineDays: baseDaily.length }));
      }
    }

    // Off-hours: hours with no baseline activity in the hour or its neighbours.
    if (base.length >= RULES.offHours.minBaselineReads) {
      const hours = new Array(24).fill(0);
      for (const e of base) hours[new Date(msOf(e.ts)).getUTCHours()] += 1;
      const quiet = (h) => { for (let d = -RULES.offHours.neighbourHours; d <= RULES.offHours.neighbourHours; d++) if (hours[(h + d + 24) % 24]) return false; return true; };
      const odd = rows.filter((e) => quiet(new Date(msOf(e.ts)).getUTCHours()));
      if (odd.length) {
        const hrs = [...new Set(odd.map((e) => new Date(msOf(e.ts)).getUTCHours()))].sort((a, b) => a - b);
        out.push(finding("chart-access-off-hours", actor, `${odd.length} reads at UTC hour${hrs.length === 1 ? "" : "s"} ${hrs.join(", ")}, outside this user's usual hours.`, odd, { hoursUtc: hrs }));
      }
    }
  }

  const denied = inP.filter((e) => e.action === "record.denied" || e.outcome === "denied");
  for (const [actor, rows] of groupBy(denied, actorOf)) {
    if (rows.length >= RULES.denied.threshold) out.push(finding("repeated-denied", actor, `${rows.length} denied record actions in the period.`, rows, { count: rows.length }));
  }
  return out;
}

/** PURE. How many rows one audit row took out, and through which channel. Null when it took none out. */
function exportChannel(e) {
  if (e.action === "record.export") {
    const n = Number(e.resourceCounts && e.resourceCounts.records);
    const fromDetail = /(\d+) rows/.exec(str(e.detail));
    return { channel: "backup", rows: Number.isFinite(n) ? n : fromDetail ? Number(fromDetail[1]) : 0 };
  }
  if (e.action === "record.list") {
    const rows = Object.values(e.resourceCounts || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    return { channel: "roster", rows };
  }
  if (e.action === "record.write" && e.scope && RELEASE_TYPES.has(e.scope.resourceType)) return { channel: "release", rows: 1 };
  return null;
}

/** PURE. Unusual export volume per person and channel, against their own baseline. */
function exportFindings(events, period) {
  const { period: inP, baseline, periodDays } = windows(events, period.from, period.to);
  const tag = (rows) => rows.map((e) => ({ e, x: exportChannel(e) })).filter((r) => r.x && actorOf(r.e));
  const baseTotals = new Map();
  for (const { e, x } of tag(baseline)) { const k = actorOf(e) + "|" + x.channel; baseTotals.set(k, (baseTotals.get(k) || 0) + x.rows); }
  const out = [];
  for (const [k, rows] of groupBy(tag(inP), (r) => actorOf(r.e) + "|" + r.x.channel)) {
    const [actor, channel] = k.split("|");
    const volume = rows.reduce((s, r) => s + r.x.rows, 0);
    const expected = ((baseTotals.get(k) || 0) / RULES.baselineDays) * periodDays;
    if (volume >= RULES.exportVolume.floor[channel] && volume > expected * RULES.exportVolume.multiple) {
      out.push(finding("unusual-export", actor,
        `${volume} ${channel === "release" ? "releases" : "rows"} via ${channel} in the period; this user's own history predicts about ${Math.round(expected)}.`,
        rows.map((r) => r.e), { channel, volume, expected: Math.round(expected) }));
    }
  }
  return out;
}

/** PURE. The device label the sign-in audit appended (" · <label>"), or "" when none was recorded. */
function deviceOf(e) {
  const meta = str(e.meta);
  if (meta.includes(" · ")) return meta.split(" · ").pop().trim();
  return OK_SIGNIN.has(e.action) ? meta : "";
}

/** PURE. Suspicious sign-in patterns over the hospital's sign-in events (ts in ms or ISO). */
function loginFindings(events, period) {
  const fromMs = msOf(period.from), toMs = msOf(period.to);
  const all = (events || []).filter((e) => e && Number.isFinite(msOf(e.ts))).sort((a, b) => msOf(a.ts) - msOf(b.ts));
  const inP = (e) => msOf(e.ts) >= fromMs && msOf(e.ts) < toMs;
  const out = [];
  const L = RULES.login;

  for (const [actor, rows] of groupBy(all.filter((e) => inP(e) && FAILED_SIGNIN.has(e.action)), actorOf)) {
    if (rows.length >= L.failedThreshold) out.push(finding("failed-sign-ins", actor, `${rows.length} failed, locked or refused sign-in attempts in the period.`, rows, { count: rows.length }));
  }

  for (const [actor, rows] of groupBy(all.filter((e) => OK_SIGNIN.has(e.action)), actorOf)) {
    const seen = new Set();
    const fresh = [];
    let earlier = 0;
    for (const e of rows) {
      const dev = deviceOf(e);
      if (inP(e) && dev && earlier > 0 && !seen.has(dev)) fresh.push(e);
      if (dev) seen.add(dev);
      earlier += 1;
    }
    if (fresh.length) out.push(finding("new-device", actor, `Signed in from ${fresh.length === 1 ? "a device" : fresh.length + " devices"} not seen before: ${[...new Set(fresh.map(deviceOf))].join(", ")}.`, fresh));

    const periodRows = rows.filter((e) => inP(e) && deviceOf(e));
    for (let i = 0; i < periodRows.length; i++) {
      const end = msOf(periodRows[i].ts) + L.deviceWindowMinutes * 60000;
      const win = periodRows.slice(i).filter((e) => msOf(e.ts) <= end);
      const devices = new Set(win.map(deviceOf));
      if (devices.size >= L.deviceCount) {
        out.push(finding("many-devices", actor, `${devices.size} devices signed in within ${L.deviceWindowMinutes} minutes: ${[...devices].join(", ")}.`, win, { devices: [...devices] }));
        break;                                   // one finding per person; the rows say the rest
      }
    }
  }
  return out;
}

/** PURE. Break-glass grants and privileged admin acts as review items. */
function reviewItems(grants, orgEvents, period) {
  const fromMs = msOf(period.from) - RULES.baselineDays * DAY;
  const items = [];
  for (const g of grants || []) {
    if (!g) continue;
    items.push({ kind: "break-glass", subjectId: str(g.id || g.grantId), actor: str(g.actorId), action: "break-glass", at: g.grantedAt || null,
      detail: str(g.reason), patientId: g.patientId || null });
  }
  for (const e of orgEvents || []) {
    if (!e || !PRIVILEGED.has(e.action) || !(msOf(e.ts) >= fromMs)) continue;
    items.push({ kind: "privileged-action", subjectId: str(e.id), actor: str(e.actor), action: e.action,
      at: Number.isFinite(msOf(e.ts)) ? new Date(msOf(e.ts)).toISOString() : null, detail: str(e.meta) });
  }
  return items.filter((i) => i.subjectId);
}

/** PURE. Attaches recorded decisions. Awaiting items first, newest first within each group. */
function reviewQueue(items, reviews, viewerIds) {
  const me = new Set((viewerIds || []).map(str).filter(Boolean));
  const byKey = groupBy((reviews || []).filter(Boolean), (r) => r.subjectKind + "|" + r.subjectId);
  const out = items.map((i) => {
    const rs = (byKey.get(i.kind + "|" + i.subjectId) || []).sort((a, b) => str(a.at).localeCompare(str(b.at)))
      .map((r) => ({ decision: r.decision, note: r.note || "", reviewedBy: r.reviewedBy, at: r.at }));
    const last = rs[rs.length - 1];
    return { ...i, reviews: rs, status: last ? last.decision : "awaiting", ownAction: me.has(i.actor) };
  });
  return out.sort((a, b) => (a.status === "awaiting") !== (b.status === "awaiting") ? (a.status === "awaiting" ? -1 : 1) : str(b.at).localeCompare(str(a.at)));
}

/** PURE. Refusal code for a review, or null when it may be recorded. */
function reviewProblem(item, decision, note, reviewerIds) {
  if (!item) return { error: "subject_not_found", message: "That break-glass grant or admin action was not found, so there is nothing to review." };
  if ((reviewerIds || []).map(str).filter(Boolean).includes(str(item.actor))) return { error: "self_review", message: "You cannot review your own action. Another administrator must review it." };
  if (decision !== "appropriate" && decision !== "follow-up") return { error: "decision_invalid", message: "Choose reviewed-appropriate or needs follow-up." };
  if (decision === "follow-up" && str(note).length < 5) return { error: "note_required", message: "Say what needs following up." };
  return null;
}

/** PURE. Backup + restore-test status. Green only on evidence of both. */
function dataProtection(backupRuns, restoreTests, rpoMinutes, now) {
  const runs = (backupRuns || []).filter(Boolean).sort((a, b) => str(b.at).localeCompare(str(a.at)));
  const tests = (restoreTests || []).filter(Boolean).sort((a, b) => str(b.at).localeCompare(str(a.at)));
  const last = runs[0] || null, lastTest = tests[0] || null;
  const rpo = rpoVerdict(last && last.at, rpoMinutes, now);
  const reasons = [];
  if (!last) reasons.push("No backup run has ever been recorded.");
  else if (rpo.meets === false) reasons.push(rpo.reading);
  else if (rpo.meets === null) reasons.push("No recovery point objective is configured, so the backup age cannot be judged.");
  if (!lastTest) reasons.push("No restore test has ever been recorded. A backup nobody has restored is not known to work.");
  else if (lastTest.outcome !== "success") reasons.push(`The last restore test (${str(lastTest.at).slice(0, 10)}) did not succeed: ${lastTest.outcome}.`);
  const red = !last || !lastTest || rpo.meets === false || lastTest.outcome === "failed";
  return {
    status: reasons.length === 0 ? "green" : red ? "red" : "amber",
    reasons,
    lastBackup: last ? { at: last.at, throughSeq: last.throughSeq, rows: last.rows, location: last.location } : null,
    rpo,
    lastRestoreTest: lastTest ? { at: lastTest.at, restoredWhat: lastTest.restoredWhat, outcome: lastTest.outcome, performedBy: lastTest.performedBy, recordedBy: lastTest.recordedBy, note: lastTest.note || "" } : null,
    restoreTests: tests.length,
  };
}

/** PURE. What the audit trail still holds, and whether rows that should be there are not. */
function auditRetention(oldestAuditAt, oldestRecordAt) {
  const out = {
    configuredRetention: null,
    configuredNote: "No audit retention period is configured. This application never deletes audit rows; any removal would have happened in the database itself.",
    oldestAuditAt: oldestAuditAt || null, oldestRecordAt: oldestRecordAt || null, gap: null,
  };
  const a = msOf(oldestAuditAt), r = msOf(oldestRecordAt);
  if (Number.isFinite(r) && !Number.isFinite(a)) out.gap = `Records exist from ${str(oldestRecordAt).slice(0, 10)} but no audit rows were found at all. Audit rows that should exist are absent.`;
  else if (Number.isFinite(r) && Number.isFinite(a) && a - r > DAY) out.gap = `Records exist from ${str(oldestRecordAt).slice(0, 10)} but the oldest audit row is from ${str(oldestAuditAt).slice(0, 10)}. Audit rows for the earlier span are absent.`;
  return out;
}

async function open_(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

const unavailable = (e) => ({ status: "unavailable", error: e instanceof GovernanceError ? "permission" : "read_failed", detail: str(e && e.message) });
const section = (findings) => ({ status: "ok", findings, counts: findings.reduce((m, f) => { m[f.type] = (m[f.type] || 0) + 1; return m; }, {}) });

/**
 * The whole report. ctx: { migration, actorDeps, recordDeps, days?, now?, rpoMinutes?,
 *   orgEvents: {events, partial} | {error}, viewerId }
 */
async function securityReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const { svc, resolved, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  const tenantId = mig.tenantId;
  const repository = ctx.recordDeps.repository;
  const now = str(ctx.now) || new Date().toISOString();
  const days = Math.max(1, Math.min(90, Number(ctx.days) || 7));
  const period = { from: new Date(msOf(now) - days * DAY).toISOString(), to: new Date(msOf(now) + 1).toISOString() };

  let chartAccess, exports, retention;
  let auditRead = null;
  if (typeof repository.auditTrail !== "function") {
    chartAccess = exports = { status: "unavailable", error: "audit_unreadable", detail: "This deployment's storage cannot read the audit trail back, so access and export review cannot run." };
  } else {
    try {
      auditRead = await repository.auditTrail(tenantId, { since: new Date(msOf(period.from) - RULES.baselineDays * DAY).toISOString() });
      chartAccess = { ...section(chartAccessFindings(auditRead.events, period)), truncated: !!auditRead.truncated };
      exports = { ...section(exportFindings(auditRead.events, period)), truncated: !!auditRead.truncated };
    } catch (e) { chartAccess = exports = unavailable(e); }
  }
  try {
    const first = await repository.changes(tenantId, 0, 1);
    const rec = first && first.records && first.records[0];
    const oldestRecordAt = rec ? ((rec.meta && rec.meta.recordedAt) || (rec.writtenBy && rec.writtenBy.at) || null) : null;
    retention = auditRead ? { status: "ok", ...auditRetention(auditRead.oldestAt, oldestRecordAt) } : { status: "unavailable", error: "audit_unreadable" };
  } catch (e) { retention = unavailable(e); }

  const orgEvents = ctx.orgEvents || { error: "not_supplied" };
  const logins = orgEvents.error
    ? { status: "unavailable", error: "signin_log_unreadable", detail: str(orgEvents.error) }
    : { ...section(loginFindings(orgEvents.events, period)), partial: !!orgEvents.partial };

  const [grants, reviews, runs, tests] = await Promise.all([
    svc.list("BreakGlassGrant", 1000).then((v) => ({ v }), (e) => ({ e })),
    svc.list(REVIEW_TYPE, 1000).then((v) => ({ v }), (e) => ({ e })),
    svc.list(RUN_TYPE, 50).then((v) => ({ v }), (e) => ({ e })),
    svc.list(RESTORE_TYPE, 200).then((v) => ({ v }), (e) => ({ e })),
  ]);

  let queue;
  if (reviews.e) queue = unavailable(reviews.e);
  else {
    const items = reviewItems(grants.v || [], orgEvents.events || [], period);
    queue = {
      status: grants.e || orgEvents.error ? "partial" : "ok",
      missing: [grants.e ? "break-glass grants could not be read" : null, orgEvents.error ? "admin actions could not be read" : null].filter(Boolean),
      items: reviewQueue(items, reviews.v, [resolved.actor.id, ctx.viewerId]),
    };
    queue.awaiting = queue.items.filter((i) => i.status === "awaiting").length;
  }

  const protection = runs.e || tests.e
    ? { ...unavailable(runs.e || tests.e), status: "unavailable", reasons: ["Backup or restore-test records could not be read, so data protection is not known."] }
    : dataProtection(runs.v, tests.v, ctx.rpoMinutes, now);

  /* Reading everyone's access pattern is itself an access worth recording. */
  try { await repository.auditOnly(tenantId, { ts: now, actor: resolved.actor.id, connectorId: "wardsynq", action: "security.report", scope: { days }, outcome: "ok" }); }
  catch (e) { return { ...base, ok: false, status: 502, error: "audit_failed", detail: "The security report was refused because reading it could not be recorded in the audit trail." }; }

  const counts = {};
  for (const s of [chartAccess, exports, logins]) for (const [k, v] of Object.entries(s.counts || {})) counts[k] = v;
  return {
    ...base, ok: true, generatedAt: now, period, days, advisory: true,
    note: "Findings are advisory. Nothing here locks an account or blocks access.",
    counts, chartAccess, exports, logins, reviewQueue: queue, dataProtection: protection, auditRetention: retention,
    rules: RULES, methods: METHOD, notDetected: NOT_DETECTED,
  };
}

/** ctx: { migration, subjectKind, subjectId, decision, note, orgEvents, viewerId, idempotencyKey? } */
async function recordSecurityReview(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const kind = str(ctx.subjectKind), subjectId = str(ctx.subjectId);
  let item = null;
  try {
    /* The subject is looked up on the server, never taken from the body: the self-review rule is
     * only as good as the actor it compares against. */
    if (kind === "break-glass") {
      const g = subjectId ? await svc.get("BreakGlassGrant", subjectId) : null;
      item = g ? reviewItems([g], [], { from: new Date(0).toISOString() })[0] : null;
    } else if (kind === "privileged-action") {
      if (ctx.orgEvents && ctx.orgEvents.error) return { ...base, ok: false, status: 502, error: "signin_log_unreadable", written: 0 };
      const e = ((ctx.orgEvents && ctx.orgEvents.events) || []).find((x) => str(x.id) === subjectId);
      item = e ? reviewItems([], [e], { from: new Date(0).toISOString() })[0] || null : null;
    }
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  const problem = reviewProblem(item, str(ctx.decision), ctx.note, [resolved.actor.id, ctx.viewerId]);
  if (problem) return { ...base, ok: false, status: problem.error === "subject_not_found" ? 404 : problem.error === "self_review" ? 403 : 422, ...problem, written: 0 };

  const at = new Date().toISOString();
  const record = {
    resourceType: REVIEW_TYPE,
    id: `secrev-${kind}-${subjectId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80)}-${at.replace(/[^0-9]/g, "")}`,
    subjectKind: kind, subjectId, subjectActor: item.actor, subjectAction: item.action,
    decision: str(ctx.decision), note: str(ctx.note).slice(0, 2000), reviewedBy: resolved.actor.id, at,
    source: { system: "wardsynq-native", sourceId: `security-review:${kind}:${subjectId}:${at}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, review: record, recordVersion: out.record.version };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

const RESTORE_OUTCOMES = ["success", "partial", "failed"];

/** ctx: { migration, restoredWhat, outcome, at?, performedBy?, note?, idempotencyKey? } */
async function recordRestoreTest(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const restoredWhat = str(ctx.restoredWhat), outcome = str(ctx.outcome);
  if (restoredWhat.length < 5) return { ...base, ok: false, status: 422, error: "restored_what_required", message: "Say what was restored (which backup, into what).", written: 0 };
  if (!RESTORE_OUTCOMES.includes(outcome)) return { ...base, ok: false, status: 422, error: "outcome_required", message: "Record the outcome: success, partial or failed.", written: 0 };
  const at = str(ctx.at) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(at)) || Date.parse(at) > Date.now() + 60000) return { ...base, ok: false, status: 422, error: "at_invalid", message: "The restore test time must be a real time, not in the future.", written: 0 };

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const record = {
    resourceType: RESTORE_TYPE, id: `wsq-restore-${at.replace(/[^0-9]/g, "")}`,
    at, restoredWhat: restoredWhat.slice(0, 500), outcome, note: str(ctx.note).slice(0, 2000),
    performedBy: str(ctx.performedBy) || resolved.actor.id, recordedBy: resolved.actor.id,
    source: { system: "wardsynq-native", sourceId: `restore-test:${at}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, restoreTest: record, recordVersion: out.record.version };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: e && e.code === "VERSION_CONFLICT" ? 409 : 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

export {
  RULES, METHOD, NOT_DETECTED, REVIEW_TYPE, RESTORE_TYPE, PRIVILEGED,
  chartAccessFindings, exportChannel, exportFindings, deviceOf, loginFindings, reviewItems, reviewQueue, reviewProblem,
  dataProtection, auditRetention, securityReport, recordSecurityReview, recordRestoreTest,
};
