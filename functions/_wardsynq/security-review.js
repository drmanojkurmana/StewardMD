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
 *   - reads of a patient who is also staff: not identifiable without joining staff identity to
 *     patient identity, which is new PHI processing this review must not introduce.
 *   - VIP / sensitive patients: no such flag exists on the record.
 *   - denied READS: the record service audits denied WRITES (record.denied); a refused read throws
 *     before any row is written, so repeated-denial counts writes and any row whose outcome is denied.
 *
 * READS OUTSIDE AN ASSIGNMENT ARE checked (outOfAssignmentFindings). The pseudonymised reference on
 * each audit row is joined to the same pseudonym of the admission, the nurse assignment and the
 * break-glass grant, so no patient identifier is added to the audit trail to do it.
 *
 * Storage-agnostic: audit rows come from the repository's optional auditTrail(), sign-in and admin
 * rows are handed in by the router from the hospital's own event log. No platform calls here.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { RUN_TYPE, rpoVerdict } from "./backup-run.js";
import { span } from "../_roster.js";
import { verifyAuditChain, checkAnchorStores, anchorStoresOf, auditRetentionSetting } from "./audit-chain.js";

const str = (v) => (v == null ? "" : String(v).trim());
const DAY = 86400000;
const REVIEW_TYPE = "SecurityReview";
const RESTORE_TYPE = "RestoreTest";
const EVIDENCE_CAP = 50;
const AUDIT_VERIFY_LIMIT = 1000;
/* G3: the hospital event log is verified in Firestore batches, so its window is smaller. */
const ORG_VERIFY_LIMIT = 300;

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
  "out-of-assignment": "A read of a patient when the reader was neither the nurse assigned to that admission nor rostered on a shift whose unit is the ward the patient was on at the time of the read (names compared ignoring case). The ward at the time comes from the admission's version history, so a read before a transfer compares against the ward the patient was on then. One person signed in by different methods (Google account, email access, staff sign-in) is matched by email and counted as one reader. Each finding lists, per read, the patient's ward then and the wards the reader was rostered on then. Exempt reads are listed separately, and a read that cannot be compared is counted as not evaluated with its reason, never as clean.",
};

const NOT_DETECTED = [
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
    resourceType: scope.resourceType || null, recordId: scope.id || null, patientRef: e.patientRefHash || null, outcome: e.outcome || null,
    detail: e.meta != null ? str(e.meta) : (e.detail != null ? str(e.detail) : null),
    ...(e.wardAtRead !== undefined ? { wardAtRead: e.wardAtRead, readerWardsAtRead: e.readerWardsAtRead || [] } : {}) };
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

/* OUT-OF-ASSIGNMENT EXEMPTIONS, each one stated on the report. Roles whose work is the whole hospital
 * rather than a ward have no assignment to compare against; everyone else is compared, and a person
 * with no assignment data is "not evaluated", never exempt and never clean. */
const EXEMPT_ROLES = Object.freeze(["lab", "pharmacy", "cashier", "billing", "radiographer", "radiologist", "blood_bank", "him"]);
const EXEMPTIONS = Object.freeze([
  { id: "break-glass", rule: "Reads of a patient under the reader's own break-glass grant for that patient, while it was live.", reason: "Every break-glass grant is already reviewed on its own in the review queue." },
  { id: "role-not-ward-assigned", rule: "Reads by staff whose role is not assigned to wards: " + EXEMPT_ROLES.join(", ") + ".", reason: "These roles serve every ward, so there is no ward assignment to compare their reads against." },
  { id: "treating-clinician", rule: "Reads by the admission's named attending clinician during that admission.", reason: "The treating relationship is recorded on the admission itself." },
]);

const lo = (v) => (Number.isFinite(msOf(v)) ? msOf(v) : -Infinity);
const hi = (v) => (v == null || v === "" || !Number.isFinite(msOf(v)) ? Infinity : msOf(v));
const within = (t, from, to) => t >= lo(from) && t < hi(to);
const wardKey = (w) => str(w).toLowerCase();

/** PURE. A NurseAssignment's history as intervals: each assign runs until the next event on that admission. */
function nurseAssignmentIntervals(rec, patientRef) {
  const ev = ((rec && rec.history) || []).filter((h) => h && Number.isFinite(msOf(h.at))).sort((a, b) => msOf(a.at) - msOf(b.at));
  return ev.map((h, i) => (h.action === "assign" && str(h.nurseId)
    ? { staffId: str(h.nurseId), patientRef, from: h.at, to: ev[i + 1] ? ev[i + 1].at : null, source: "nurse-assignment" } : null)).filter(Boolean);
}

/** PURE. Rota assignments as UTC intervals on a ward. roster: { shifts: {id: shift}, assignments: [] }. */
function rosterIntervals(roster, utcOffsetMinutes) {
  const shifts = (roster && roster.shifts) || {};
  const off = Number(utcOffsetMinutes) || 0;
  const out = [];
  for (const a of (roster && roster.assignments) || []) {
    const s = a && a.status !== "cancelled" && shifts[a.shiftId];
    if (!s || !str(a.identity)) continue;
    const [a0, a1] = span(a.date, s);
    out.push({ staffId: str(a.identity), ward: s.unit, from: new Date((a0 - off) * 60000).toISOString(), to: new Date((a1 - off) * 60000).toISOString(), source: "roster" });
  }
  return out;
}

/** PURE (G11). An admission's wards over time from its version history (ascending or not): one stay per
 * run of versions on the same ward, each starting at the transfer that moved the patient there. */
function wardHistoryStays(versions, patientRef) {
  const vs = (versions || []).filter(Boolean).sort((a, b) => (Number(a.version) || 0) - (Number(b.version) || 0));
  const out = [];
  for (const v of vs) {
    const ward = str(v.location && v.location.ward);
    const last = out[out.length - 1];
    if (last && wardKey(last.ward) === wardKey(ward)) { last.attendingId = v.attendingId || last.attendingId; last.to = v.periodEnd || null; continue; }
    /* A version on a new ward without a transfer time cannot be placed: its stay starts where the last one did,
     * so both wards cover that span. That can only miss a finding, never make one up. */
    const from = last ? (v.movedAt || (v.meta && v.meta.recordedAt) || (v.writtenBy && v.writtenBy.at) || last.from) : (v.periodStart || null);
    if (last) last.to = from;
    out.push({ patientRef, ward, attendingId: v.attendingId || null, from, to: v.periodEnd || null });
  }
  return out;
}

/** PURE (G11). One reader across sign-in methods. links: [[idA, idB], ...] naming the same person (a
 * membership identity and its email, an email and its access id, a Google account and its email).
 * preferred: ids to name the person by (membership identities). Returns {id: person}. */
function readerAliases(links, preferred) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  for (const [a, b] of links || []) {
    const x = str(a), y = str(b);
    if (!x || !y) continue;
    add(x); add(y);
    parent.set(find(x), find(y));
  }
  const pref = new Set((preferred || []).map(str));
  const groups = groupBy([...parent.keys()], find);
  const out = {};
  for (const ids of groups.values()) {
    const name = ids.filter((i) => pref.has(i)).sort()[0] || ids.filter((i) => !i.includes("@")).sort()[0] || ids.sort()[0];
    for (const i of ids) out[i] = name;
  }
  return out;
}

const HISTORY_READ_MAX = 200;
const ACCOUNT_LOOKUP_MAX = 200;

/**
 * G11. The links that make one person one reader, from what the hospital already holds: each
 * membership's identity and email, each email's access id, and each Google account's email.
 * directory: { accountEmail(id) -> email|null, accessIdOf(email) -> id } (handed in by the router).
 * Without a directory ids are compared as they are, and the report says so. A match that could not be
 * made is a NOTE, not incomplete data: it can split one person in two, which the note names, but it
 * cannot hide a read, so it must not turn every read in the hospital into "not evaluated".
 */
async function readerAliasesFor(directory, members, events, notes) {
  if (!directory || typeof directory.accessIdOf !== "function") {
    notes.push("Sign-in accounts could not be matched to staff emails, so one person signing in different ways counts as separate readers.");
    return {};
  }
  const links = [];
  const emails = new Set();
  const isEmail = (x) => /^[^@\s]+@[^@\s]+$/.test(str(x));
  for (const m of members) {
    if (!m || !m.identity) continue;
    if (m.email) { links.push([m.identity, str(m.email).toLowerCase()]); emails.add(str(m.email).toLowerCase()); }
    if (isEmail(m.identity)) { links.push([m.identity, str(m.identity).toLowerCase()]); emails.add(str(m.identity).toLowerCase()); }
  }
  const accounts = [...new Set((events || []).map(actorOf).filter((a) => a.startsWith("fb:")))];
  let unmatched = 0;
  for (const [i, id] of accounts.entries()) {
    if (i >= ACCOUNT_LOOKUP_MAX || typeof directory.accountEmail !== "function") { unmatched += 1; continue; }
    try { const email = str(await directory.accountEmail(id)).toLowerCase(); if (email) { links.push([id, email]); emails.add(email); } }
    catch { unmatched += 1; }
  }
  if (unmatched) notes.push(`${unmatched} Google sign-in account${unmatched === 1 ? "" : "s"} could not be matched to an email, so ${unmatched === 1 ? "it counts" : "they count"} as a separate reader.`);
  for (const email of emails) {
    try { links.push([email, await directory.accessIdOf(email)]); } catch { /* the email alone still links what it can */ }
  }
  return readerAliases(links, members.map((m) => m && m.identity).filter(Boolean));
}

/**
 * PURE. Reads of a patient the reader was not assigned to at the time.
 *   reads:        audit rows (record.read with patientRefHash)
 *   assignments:  [{ staffId, from, to|null, patientRef? , ward?, source, tenantId? }]
 *   opts: { period, tenantId, roles: {staffId: role} | null when unreadable,
 *           stays: [{ patientRef, ward, attendingId, from, to, tenantId? }],
 *           breakGlass: [{ actorId, patientRef, from, to }], incomplete: [sentence] }
 * Rows carrying another hospital's tenantId are dropped before anything is counted.
 */
function outOfAssignmentFindings(reads, assignments, opts) {
  const o = opts || {};
  const fromMs = msOf(o.period.from), toMs = msOf(o.period.to);
  const inTenant = (x) => !o.tenantId || x.tenantId == null || x.tenantId === o.tenantId;
  /* G11: every id is mapped to its person first, so one person's Google, email and staff sign-ins are one reader. */
  const aliases = o.aliases || {};
  const who = (id) => aliases[str(id)] || str(id);
  const stays = (o.stays || []).filter((s) => s && inTenant(s));
  const knownWards = new Set(stays.map((s) => wardKey(s.ward)).filter(Boolean));
  /* A rota unit counts only when it names a ward some admission is on: a unit called "Nights" or a
   * misspelt ward would otherwise turn every read by that person into a finding. */
  const usable = (assignments || []).filter((a) => a && inTenant(a) && (a.patientRef || knownWards.has(wardKey(a.ward))));
  const mine = groupBy(usable, (a) => who(a.staffId));
  const byPatient = groupBy(stays, (s) => s.patientRef);
  const grants = (o.breakGlass || []).filter(Boolean);
  const incomplete = (o.incomplete || []).filter(Boolean);
  const roles = o.roles ? Object.fromEntries(Object.entries(o.roles).map(([k, v]) => [who(k), v])) : null;
  const hasData = (actor) => (mine.get(actor) || []).some((a) => lo(a.from) < toMs && hi(a.to) > fromMs);

  const inPeriod = (reads || []).filter((e) => e && e.action === "record.read" && e.patientRefHash && actorOf(e) && inTenant(e)
    && msOf(e.ts) >= fromMs && msOf(e.ts) < toMs);
  if (!usable.some((a) => lo(a.from) < toMs && hi(a.to) > fromMs)) {
    return { status: "not_evaluated", reason: incomplete.length ? "Assignment data could not be read: " + incomplete.join("; ") + "."
      : "No nurse assignment or rota shift matching an admission's ward is recorded for anyone in this period, so reads cannot be compared with assignments.",
    readsInPeriod: inPeriod.length, exemptions: EXEMPTIONS };
  }

  const flagged = [], notEval = new Map(), exempt = new Map();
  let assigned = 0;
  const tally = (m, actor, key, e) => { const k = actor + "|" + key; if (!m.has(k)) m.set(k, { actor, key, rows: [] }); m.get(k).rows.push(e); };
  for (const e of inPeriod) {
    const t = msOf(e.ts), actor = who(actorOf(e)), ref = e.patientRefHash;
    if (grants.some((g) => who(g.actorId) === actor && g.patientRef === ref && within(t, g.from, g.to))) { tally(exempt, actor, "break-glass", e); continue; }
    const role = roles ? roles[actor] : undefined;
    if (role && EXEMPT_ROLES.includes(role)) { tally(exempt, actor, "role-not-ward-assigned", e); continue; }
    const stay = (byPatient.get(ref) || []).filter((s) => within(t, s.from, s.to));
    if (stay.some((s) => s.attendingId && who(s.attendingId) === actor)) { tally(exempt, actor, "treating-clinician", e); continue; }
    const covered = (mine.get(actor) || []).some((a) => within(t, a.from, a.to)
      && ((a.patientRef && a.patientRef === ref) || (a.ward && stay.some((s) => wardKey(s.ward) === wardKey(a.ward)))));
    if (covered) { assigned += 1; continue; }
    if (!roles) tally(notEval, actor, "Staff roles could not be read, so the role exemption could not be applied.", e);
    else if (!hasData(actor)) tally(notEval, actor, "No nurse assignment or rota shift matching an admission's ward is recorded for this person in the period.", e);
    else if (incomplete.length) tally(notEval, actor, "Assignment data is incomplete: " + incomplete.join("; ") + ".", e);
    else if (!stay.length) tally(notEval, actor, "The patient had no admission on record at the time of the read, so there is no ward to compare against.", e);
    else {
      /* The ward history behind the flag: where the patient was, and where the reader was rostered, at that moment. */
      const readerWards = [...new Set((mine.get(actor) || []).filter((a) => a.ward && within(t, a.from, a.to)).map((a) => a.ward))];
      flagged.push({ ...e, reader: actor, wardAtRead: [...new Set(stay.map((s) => s.ward))].join(", "), readerWardsAtRead: readerWards });
    }
  }

  const findings = [...groupBy(flagged, (e) => e.reader)].map(([actor, rows]) => {
    const patients = new Set(rows.map((e) => e.patientRefHash)).size;
    const ids = [...new Set(rows.map(actorOf))];
    return finding("out-of-assignment", actor, `${rows.length} read${rows.length === 1 ? "" : "s"} of ${patients} patient${patients === 1 ? "" : "s"} this person was not assigned to at the time.`, rows,
      { patients, ...(ids.length > 1 || (ids.length === 1 && ids[0] !== actor) ? { signIns: ids } : {}) });
  });
  const summarise = (m, field) => [...m.values()].map((x) => ({ actor: x.actor, [field]: x.key, reads: x.rows.length, evidence: x.rows.slice(0, EVIDENCE_CAP).map(evidenceRow) }));
  return {
    status: "ok", findings, counts: findings.length ? { "out-of-assignment": findings.length } : {},
    assignedReads: assigned, notEvaluated: summarise(notEval, "reason"), exempt: summarise(exempt, "exemption"),
    readsInPeriod: inPeriod.length, exemptions: EXEMPTIONS, incomplete,
  };
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

const NEVER_DELETED = "It is informational only: this application never deletes audit rows, and a change or removal made in the database itself shows in the integrity check.";

/** PURE. What the audit trail still holds, and whether rows that should be there are not.
 * setting: auditRetentionSetting() (audit-chain.js), or absent when none was worked out. */
function auditRetention(oldestAuditAt, oldestRecordAt, setting) {
  const s = setting || {};
  const note = s.source === "configured" ? `Audit retention period: ${s.years} years, set by this hospital. ${NEVER_DELETED}`
    : s.source === "region-default" ? `Audit retention period: ${s.years} years, the default for this region (${s.citation}); this hospital has not set one. ${NEVER_DELETED}`
    : `${s.source === "invalid" ? s.note + " " : ""}No audit retention period is configured, so audit rows are kept indefinitely. This application never deletes audit rows; any removal would have happened in the database itself.`;
  const out = {
    configuredRetention: s.years || null, retentionSource: s.source || "not-configured",
    configuredNote: note,
    oldestAuditAt: oldestAuditAt || null, oldestRecordAt: oldestRecordAt || null, gap: null,
  };
  const a = msOf(oldestAuditAt), r = msOf(oldestRecordAt);
  if (Number.isFinite(r) && !Number.isFinite(a)) out.gap = `Records exist from ${str(oldestRecordAt).slice(0, 10)} but no audit rows were found at all. Audit rows that should exist are absent.`;
  else if (Number.isFinite(r) && Number.isFinite(a) && a - r > DAY) out.gap = `Records exist from ${str(oldestRecordAt).slice(0, 10)} but the oldest audit row is from ${str(oldestAuditAt).slice(0, 10)}. Audit rows for the earlier span are absent.`;
  return out;
}

/** PURE. Hospital event-log rows that carry no chain link (G3), split at when linking began.
 * startMs: the first linked row's time, or null when nothing has been linked yet. Unlinked rows are
 * never verified: before linking began they are the old era; after it they are a lost linking race or
 * a row added outside the application, and they are listed. */
function unlinkedRows(events, startMs, partial) {
  const all = (events || []).filter(Boolean);
  const rows = all.filter((e) => e.rowHash == null || e.rowHash === "");
  const start = Number.isFinite(startMs) ? startMs : null;
  const late = start == null ? [] : rows.filter((e) => msOf(e.ts) >= start);
  const before = rows.length - late.length;
  const startAt = start == null ? null : new Date(start).toISOString();
  const parts = [];
  if (start == null) parts.push(rows.length ? `No row of the hospital event log has been linked yet: all ${rows.length} rows read are unlinked and cannot be checked.` : "The hospital event log has no rows yet.");
  else {
    if (before) parts.push(`${before} row${before === 1 ? " was" : "s were"} written before linking began on ${startAt.slice(0, 10)}. They are not linked and cannot be checked.`);
    if (late.length) parts.push(`${late.length} row${late.length === 1 ? " was" : "s were"} written after linking began without a link: either linking lost a race with another writer every time, or the row was added outside the application. They cannot be checked.`);
    if (!rows.length) parts.push(`Every row read carries a link (linking began on ${startAt.slice(0, 10)}).`);
  }
  if (partial) parts.push(`Only the first ${all.length} rows of the event log were read, so there may be more.`);
  return { status: "ok", scanned: all.length, unlinked: rows.length, before, after: late.length, startAt, partial: !!partial,
    evidence: late.slice(0, EVIDENCE_CAP).map(evidenceRow), message: parts.join(" ") };
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
 * The whole report. ctx: { migration, actorDeps, recordDeps, days?, now?, rpoMinutes?, auditRetentionYears?, region?, anchorStore? | anchorStores?, orgAuditChain?, viewerIsOwner?,
 *   orgEvents: {events, partial} | {error}, viewerId,
 *   assignmentSources: { members: [{identity, role}] | {error}, roster: {shifts, assignments, partial} | {error}, utcOffsetMinutes } }
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
    retention = auditRead ? { status: "ok", ...auditRetention(auditRead.oldestAt, oldestRecordAt, auditRetentionSetting(ctx.auditRetentionYears, ctx.region)) } : { status: "unavailable", error: "audit_unreadable" };
  } catch (e) { retention = unavailable(e); }
  /* Tamper evidence over the newest rows, bounded. It never throws and is never "ok" on a failed or
   * short read, so it rides on the section whatever the retention read did. */
  retention.integrity = await verifyAuditChain(repository, tenantId, { limit: AUDIT_VERIFY_LIMIT });
  /* P2.17: the outside anchors compared against the rows they name. checkAnchors() never throws and
   * is never "ok" on a failed read, so it rides on the section the same way. Without a store there
   * is nothing outside the database to compare against, and the report says so plainly. */
  /* G12: every store handed in (KV and Firestore in production), each compared with the chain and with
   * each other; a disagreement between the copies is its own finding. */
  const stores = anchorStoresOf(ctx.anchorStores || ctx.anchorStore).map((x) => x.store);
  retention.anchors = stores.length
    ? await checkAnchorStores(repository, tenantId, stores)
    : { status: "no-anchors", message: "No anchor store was handed in, so there is nothing outside the database to compare against." };
  /* P2.17 acknowledgement. Only the hospital owner may acknowledge a legitimate restore, so the
   * report tells the screen whether the viewer is one (decided by the route, which knows the org,
   * never by the screen). Stamped on the anchors section, not decided from it: checkAnchors knows
   * the log, not the viewer. Absent means not allowed: a hand-built report never opens the form. */
  if (retention.anchors && typeof retention.anchors === "object") {
    retention.anchors.canAcknowledge = ctx.viewerIsOwner === true;
  }

  const orgEvents = ctx.orgEvents || { error: "not_supplied" };
  /* G3: the hospital event log (sign-ins, staff and hospital changes) is chained on its own. Its
   * verification never throws and is never ok on a failed read; its unlinked rows are named. */
  const orgChain = ctx.orgAuditChain;
  retention.orgIntegrity = orgChain
    ? await verifyAuditChain(orgChain, orgChain.chainId, { limit: ORG_VERIFY_LIMIT })
    : { status: "not_verified", message: "Not verified: the hospital event log chain could not be reached, so its integrity is unknown." };
  if (orgChain) {
    retention.orgAnchors = stores.length
      ? await checkAnchorStores(orgChain, orgChain.chainId, stores)
      : { status: "no-anchors", message: "No anchor store was handed in, so there is nothing outside the store to compare against." };
    retention.orgAnchors.canAcknowledge = ctx.viewerIsOwner === true;
  }
  const noStart = { status: "unavailable", message: "When linking began could not be read, so unlinked rows could not be counted." };
  if (orgEvents.error) retention.orgUnlinked = { status: "unavailable", message: "The hospital event log could not be read, so unlinked rows could not be counted." };
  else if (!orgChain || typeof orgChain.chainStart !== "function") retention.orgUnlinked = noStart;
  else {
    try { retention.orgUnlinked = unlinkedRows(orgEvents.events, await orgChain.chainStart(), orgEvents.partial); }
    catch { retention.orgUnlinked = noStart; }
  }
  const logins = orgEvents.error
    ? { status: "unavailable", error: "signin_log_unreadable", detail: str(orgEvents.error) }
    : { ...section(loginFindings(orgEvents.events, period)), partial: !!orgEvents.partial };

  const [grants, reviews, runs, tests, nurseAssignments, encounters] = await Promise.all([
    svc.list("BreakGlassGrant", 1000).then((v) => ({ v }), (e) => ({ e })),
    svc.list(REVIEW_TYPE, 1000).then((v) => ({ v }), (e) => ({ e })),
    svc.list(RUN_TYPE, 50).then((v) => ({ v }), (e) => ({ e })),
    svc.list(RESTORE_TYPE, 200).then((v) => ({ v }), (e) => ({ e })),
    svc.list("NurseAssignment", 1000).then((v) => ({ v }), (e) => ({ e })),
    svc.list("Encounter", 1000).then((v) => ({ v }), (e) => ({ e })),
  ]);

  /* OUT-OF-ASSIGNMENT. Needs the audit rows, the admissions (ward, attending), and at least one
   * assignment source. Each missing piece is named; none of them silently becomes "no findings". */
  let assignmentAccess;
  if (!auditRead) assignmentAccess = chartAccess.status === "ok" ? { status: "unavailable", error: "audit_unreadable" } : chartAccess;
  else if (encounters.e) assignmentAccess = { ...unavailable(encounters.e), detail: "Admissions could not be read, so wards are not known." };
  else {
    try {
      const src = ctx.assignmentSources || {};
      const refs = new Map();
      const refOf = async (patientId) => { const k = str(patientId); if (!k) return null; if (!refs.has(k)) refs.set(k, await ctx.recordDeps.pseudonym(k)); return refs.get(k); };
      const incomplete = [];
      const intervals = [];
      if (nurseAssignments.e) incomplete.push("nurse assignments could not be read");
      else {
        if (nurseAssignments.v.length >= 1000) incomplete.push("only the first 1000 nurse assignments were read");
        for (const a of nurseAssignments.v) if (a) intervals.push(...nurseAssignmentIntervals(a, await refOf(a.patientId)));
      }
      if (!src.roster || src.roster.error) incomplete.push("the rota could not be read");
      else {
        if (src.roster.partial) incomplete.push("only part of the rota could be read");
        intervals.push(...rosterIntervals(src.roster, src.utcOffsetMinutes));
      }
      if (encounters.v.length >= 1000) incomplete.push("only the first 1000 admissions were read");
      /* G11: a transferred admission's wards over time come from its version history, read only for
       * admissions that have moved (movedAt), bounded. A history that cannot be read is named. */
      const stays = [];
      let historyReads = 0, historyFailed = 0;
      for (const enc of encounters.v) {
        if (!enc) continue;
        const ref = await refOf(enc.patientId);
        if (enc.movedAt && typeof repository.history === "function" && historyReads < HISTORY_READ_MAX) {
          historyReads += 1;
          try { const vs = await repository.history(tenantId, "Encounter", enc.id); if (Array.isArray(vs) && vs.length) { stays.push(...wardHistoryStays(vs, ref)); continue; } }
          catch { /* counted below */ }
          historyFailed += 1;
        } else if (enc.movedAt) historyFailed += 1;
        stays.push({ patientRef: ref, ward: enc.location && enc.location.ward, attendingId: enc.attendingId || null, from: enc.periodStart || null, to: enc.periodEnd || null });
      }
      if (historyFailed) incomplete.push(`the ward history of ${historyFailed} transferred admission${historyFailed === 1 ? "" : "s"} could not be read, so only the current ward is known for ${historyFailed === 1 ? "it" : "them"}`);
      const breakGlass = [];
      for (const g of grants.v || []) if (g) breakGlass.push({ actorId: g.actorId, patientRef: await refOf(g.patientId), from: g.grantedAt, to: g.expiresAt });
      if (grants.e) incomplete.push("break-glass grants could not be read");
      const roles = Array.isArray(src.members) ? Object.fromEntries(src.members.filter((m) => m && m.identity).map((m) => [str(m.identity), str(m.role)])) : null;
      const matching = [];
      const aliases = await readerAliasesFor(ctx.readerDirectory, Array.isArray(src.members) ? src.members : [], auditRead.events, matching);
      assignmentAccess = outOfAssignmentFindings(auditRead.events, intervals, { period, tenantId, roles, stays, breakGlass, incomplete, aliases });
      assignmentAccess.matching = matching;
      if (auditRead.truncated) assignmentAccess.truncated = true;
    } catch (e) { assignmentAccess = unavailable(e); }
  }

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
  for (const s of [chartAccess, assignmentAccess, exports, logins]) for (const [k, v] of Object.entries(s.counts || {})) counts[k] = v;
  return {
    ...base, ok: true, generatedAt: now, period, days, advisory: true,
    note: "Findings are advisory. Nothing here locks an account or blocks access.",
    counts, chartAccess, assignmentAccess, exports, logins, reviewQueue: queue, dataProtection: protection, auditRetention: retention,
    rules: RULES, methods: METHOD, notDetected: NOT_DETECTED,
  };
}

const AUDIT_ROWS_MAX = 200;
const AUDIT_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

/**
 * G11 CLICKABLE EVIDENCE. The audit rows behind a finding, read back by id, as the reviewer sees them
 * (envelope only, never record content) with each row's chain link number. Reading them is itself
 * audited, and a read that could not be recorded is refused. Ids that were not found are listed, so
 * a partial answer never looks whole. ctx: { migration, ids: "a,b" | [] }
 */
async function auditRowsForReview(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", rows: [] };
  const { resolved, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const ids = [...new Set((Array.isArray(ctx.ids) ? ctx.ids : str(ctx.ids).split(",")).map(str).filter(Boolean))];
  if (!ids.length || ids.length > AUDIT_ROWS_MAX || ids.some((i) => !AUDIT_ID_RE.test(i))) {
    return { ...base, ok: false, status: 422, error: "ids_invalid", message: `Name between 1 and ${AUDIT_ROWS_MAX} audit rows by id.` };
  }
  const repository = ctx.recordDeps.repository;
  if (typeof repository.auditRowsById !== "function") return { ...base, ok: false, status: 501, error: "audit_unreadable", message: "This deployment's storage cannot read audit rows back by id." };
  let rows;
  try { rows = await repository.auditRowsById(mig.tenantId, ids); }
  catch { return { ...base, ok: false, status: 502, error: "read_failed", message: "The audit rows could not be read." }; }
  try { await repository.auditOnly(mig.tenantId, { ts: new Date().toISOString(), actor: resolved.actor.id, connectorId: "wardsynq", action: "security.audit_rows", scope: { rows: ids.length }, outcome: "ok" }); }
  catch { return { ...base, ok: false, status: 502, error: "audit_failed", message: "The audit rows were not shown because reading them could not be recorded in the audit trail." }; }
  const found = new Set(rows.map((r) => str(r.id)));
  return { ...base, ok: true, rows: rows.sort((a, b) => str(a.ts).localeCompare(str(b.ts))).map((r) => ({ ...evidenceRow(r), chainSeq: r.chainSeq == null ? null : r.chainSeq })),
    missing: ids.filter((i) => !found.has(i)) };
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
  RULES, METHOD, NOT_DETECTED, REVIEW_TYPE, RESTORE_TYPE, PRIVILEGED, EXEMPT_ROLES, EXEMPTIONS,
  chartAccessFindings, nurseAssignmentIntervals, rosterIntervals, wardHistoryStays, readerAliases, readerAliasesFor, outOfAssignmentFindings, exportChannel, exportFindings, deviceOf, loginFindings, reviewItems, reviewQueue, reviewProblem,
  dataProtection, auditRetention, unlinkedRows, ORG_VERIFY_LIMIT, securityReport, auditRowsForReview, recordSecurityReview, recordRestoreTest,
};
