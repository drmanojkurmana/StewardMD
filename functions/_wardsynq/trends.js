/* functions/_wardsynq/trends.js — P2.10 hospital intelligence: the hospital's measures over time.
 *
 * The digital twin answers "what is the hospital's state now" and quality.js "is the machinery working
 * this period". Neither says whether something is getting better or worse. This does, as a series of
 * buckets (day, week or month, in the HOSPITAL's clock), with a drill from a metric to a ward or
 * department and from there to the record ids behind one bucket.
 *
 * COMPUTED FROM THE RECORD, NEVER FROM A SNAPSHOT. No daily snapshot exists anywhere in this codebase,
 * and the record already carries every time these measures need: a stay's start and end, a report's
 * release, a loop's acknowledgement. A stored snapshot would be a second source of truth that drifts
 * from the record the day somebody corrects a discharge time. The costs are stated, not hidden: reads
 * are capped (READ_CAP per type, the store's roster ceiling) and a capped read marks every bucket
 * partial. Most measures attribute a stay to the ward on its CURRENT version; bed occupancy and length of
 * stay by ward (G7) read each stay's version history, which IS its movement history (migrate-inpatient.js),
 * and split it across the wards it passed through. Occupancy's available beds come from the bed registry's
 * own history (when each bed was added, turned off or on), never from today's count. See
 * vault/decisions/Decisions.md, 2026-09-14 "Trends from the record" and "G7 occupancy from history".
 *
 * A BUCKET THAT COULD NOT BE COMPUTED IS NULL WITH A REASON, NEVER 0. Zero is a real answer here only
 * when every source was read in full and nothing happened. Every point carries its numerator,
 * denominator and a coverage flag: "full", "partial" (a capped read, or a bucket still running) or
 * "none" (a source unreadable, or the hospital has not configured what the measure needs).
 *
 * EVERY DEFINITION LIVES IN DEFINITIONS BELOW, and the screen shows it as "how this is counted". There
 * is no second copy of any of them in the client.
 *
 * NO CLINICIAN IS COUNTED OR NAMED, for the reason quality.js gives. The drill ends at record ids,
 * which the reader opens through the ordinary record-detail route and its own read scope.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { INPATIENT, DEATH } from "./quality.js";
import { percentile } from "./digital-twin.js";
import { zoneOffsetAt, zonedSlotInstant } from "./mar-schedule.js";
import { stageOf } from "../../wardsynq/wardsynq-incidents.js";
import { reconciliationOf } from "../../wardsynq/wardsynq-invoice.js";

const str = (v) => (v == null ? "" : String(v).trim());
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const DAY = 86400000;
const round = (v, dp) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** The store's roster ceiling. A type at this count was cut short and every bucket says partial. */
const READ_CAP = 1000;
/** Record ids returned for one bucket and ward. More than this is counted and marked truncated. */
const EVENTS_CAP = 200;
const MAX_BUCKETS = 400;
const NO_WARD = "(no ward)", NO_DEPT = "(no department)";
const BUCKETS = ["day", "week", "month"];

const WARD_NOTE = "Ward is the ward on the stay's current record: where the patient is now, or was at discharge. A patient moved mid-stay is counted on that ward, not split.";
const SPLIT_NOTE = "Ward is where the patient was at each moment, read from the stay's movement history: a patient moved mid-stay is counted on each ward for the time spent there.";

/* One place for every definition. `sources` are the record types read; a source this reader cannot
 * read makes every bucket null with the reason. `finance` series need billing.view on the route. */
const DEFINITIONS = Object.freeze({
  admissions: {
    id: "admissions", title: "Admissions", unit: "admissions", kind: "count", sources: ["Encounter"],
    numerator: "Inpatient stays that started in the bucket.", denominator: "None. This is a count.",
    inclusion: "Encounters of class IPD, ICU, MATERNITY, PEDIATRICS or NICU whose start time falls in the bucket, in hospital local time.",
    exclusion: "Cancelled encounters, outpatient and ED-only visits, and stays with no start time.",
  },
  discharges: {
    id: "discharges", title: "Discharges", unit: "discharges", kind: "count", sources: ["Encounter"],
    numerator: "Inpatient stays that ended (status finished) in the bucket.", denominator: "None. This is a count.",
    inclusion: "Finished inpatient encounters whose end time falls in the bucket. Deaths are included: a death ends a stay.",
    exclusion: "Cancelled encounters, stays still open, and stays with no end time.",
  },
  "average-los": {
    id: "average-los", title: "Average length of stay", unit: "days", kind: "mean", sources: ["Encounter"],
    numerator: "Total days, start to end, of the stays that ended in the bucket.", denominator: "Stays that ended in the bucket.",
    inclusion: "Finished inpatient encounters with both a start and an end time, the end in the bucket.",
    exclusion: "Open stays (not yet a length), cancelled encounters, and stays missing either time.",
  },
  "bed-occupancy": {
    id: "bed-occupancy", title: "Bed occupancy", unit: "%", kind: "ratio", sources: ["Encounter"], history: true, wardNote: SPLIT_NOTE,
    numerator: "Occupied bed-days: the part of every inpatient stay that falls in the bucket (an open stay runs to now), on the ward the patient was on at the time.",
    denominator: "Available bed-days: for each bed in the hospital's bed registry, the part of the bucket it was in service, from the registry's own history of when it was added and turned off or on, stopping at now.",
    inclusion: "Inpatient encounters that overlap the bucket, whether or not they have a bed. A day bucket is that day's occupancy.",
    exclusion: "Cancelled encounters. Blocked or closed beds are not subtracted. A bucket whose bed count is not known has no rate, never today's count: beds listed only in wardsynq.beds keep no history, and a bed registered before 2026-09-14 that is now turned off has no record of when. A bed registered before then is counted from its registration; a turn off and back on before that date was not recorded. By ward, a stay whose movement history could not be read makes the buckets it overlaps unknown.",
  },
  "ward-los": {
    id: "ward-los", title: "Length of stay by ward", unit: "days", kind: "mean", sources: ["Encounter"], history: true, wardNote: SPLIT_NOTE,
    numerator: "Total days on the ward, for the ward stays that ended in the bucket (a transfer out, or the discharge).", denominator: "Ward stays that ended in the bucket.",
    inclusion: "Every ward an inpatient stay passed through is one ward stay, from arriving (admission or transfer in) to leaving (transfer out or discharge). The records behind a bucket list each stay ward by ward.",
    exclusion: "Ward stays still running (not yet a length), cancelled encounters. A stay whose movement history could not be read, or has a move with no recorded time, makes its bucket unknown rather than being left out.",
  },
  "readmission-30d": {
    id: "readmission-30d", title: "30-day readmissions", unit: "%", kind: "ratio", sources: ["Encounter", "Patient"],
    numerator: "Index discharges followed by another inpatient stay for the same patient starting within 30 days of the discharge.",
    denominator: "Index discharges in the bucket whose 30 days are over, plus any already readmitted.",
    inclusion: "Finished inpatient stays that ended in the bucket. The readmission is attributed to the bucket and ward of the index discharge.",
    exclusion: "Deaths in the index stay (a recorded death or a death disposition). Discharges whose 30 days have not yet passed and with no readmission yet are pending, counted and not in the rate. There is no planned-readmission flag, so every readmission counts.",
  },
  "lab-tat": {
    id: "lab-tat", title: "Lab turnaround", unit: "minutes", kind: "median", sources: ["ServiceRequest", "DiagnosticReport", "Encounter"],
    numerator: "Median and 90th percentile minutes from the request being recorded to the report being released.", denominator: "Reports measured.",
    inclusion: "Non-imaging DiagnosticReports released in the bucket that name their request, the same definition as the command center's lab turnaround.",
    exclusion: "Imaging reports; reports with no release time; requests this reader cannot find or with no recorded time; reports timed before their request. Exclusions are counted.",
  },
  "critical-ack": {
    id: "critical-ack", title: "Critical result acknowledgement time", unit: "minutes", kind: "median", sources: ["CriticalResultLoop", "Encounter"],
    numerator: "Median and 90th percentile minutes from the result being reported to its acknowledgement.", denominator: "Critical result loops reported in the bucket.",
    inclusion: "CriticalResultLoops whose result was reported in the bucket.",
    exclusion: "Loops not yet acknowledged are not in the median; they are counted beside it as unacknowledged.",
  },
  "antibiotic-dot": {
    id: "antibiotic-dot", title: "Antibiotic days of therapy per 1,000 patient-days", unit: "per 1,000 patient-days", kind: "per1000", sources: ["MedicationAdministration", "Encounter"],
    numerator: "Days of therapy: one patient receiving one listed antibiotic on one hospital-local calendar day.",
    denominator: "Patient-days: the part of every inpatient stay that falls in the bucket.",
    inclusion: "Administered MedicationAdministrations of a drug on the hospital's antibiotic list (wardsynq.antibiotics).",
    exclusion: "Doses not administered. With no antibiotic list configured the measure is not computable, never 0.",
  },
  incidents: {
    id: "incidents", title: "Incidents by category", unit: "incidents", kind: "count", sources: ["IncidentReport", "Encounter"],
    numerator: "Incident reports dated (when it happened, else when reported) in the bucket, split by category.", denominator: "None. This is a count.",
    inclusion: "Signals, confirmed and investigated incidents. Uncategorised reports are counted as uncategorised. Ward is the patient's stay at the time, where the report names a patient.",
    exclusion: "Reports rejected or marked a duplicate.",
  },
  "pharmacy-dispensing": {
    id: "pharmacy-dispensing", title: "Pharmacy dispensing volume", unit: "dispenses", kind: "count", sources: ["MedicationDispense", "Encounter"],
    numerator: "Dispense records (supplies issued) in the bucket.", denominator: "None. This is a count.",
    inclusion: "MedicationDispense records by dispensed time. Ward is the destination recorded on the dispense, else the patient's stay.",
    exclusion: "Dispenses with no dispensed time. Quantities are not summed: a count of supplies, not of units.",
  },
  "billed-charges": {
    id: "billed-charges", title: "Billed charges", unit: "amount", kind: "sum", finance: true, sources: ["Invoice", "Encounter"],
    numerator: "Total charged on invoices raised in the bucket, as the invoice ledger reconciles it.", denominator: "Invoices raised in the bucket.",
    inclusion: "Invoices by the time of their first ledger event, the same as the billing report.",
    exclusion: "Invoices with no ledger event. Currency is not converted.",
  },
});

/** What the metric picker needs, without the full definitions. */
function trendCatalogue() {
  return Object.values(DEFINITIONS).map((d) => ({ id: d.id, title: d.title, unit: d.unit, finance: !!d.finance }));
}

/* ---- the hospital's clock ----------------------------------------------------------------------- */

/** PURE. Local calendar parts of an instant: the zone's offset at that instant, else the fixed offset. */
function localParts(atMs, clock) {
  const z = clock.timeZone ? zoneOffsetAt(clock.timeZone, atMs) : null;
  const d = new Date(atMs + (z != null ? z : clock.offset) * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}
/** PURE. The instant of local midnight on y-m-d (overflowing days roll over, as Date.UTC does). */
function localMidnight(y, m, d, clock) {
  if (clock.timeZone) {
    const n = new Date(Date.UTC(y, m, d));
    const z = zonedSlotInstant(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), "00:00", clock.timeZone);
    if (z) return z.at;
  }
  return Date.UTC(y, m, d) - clock.offset * 60000;
}
const ymd = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/**
 * PURE. The buckets covering local dates [from, to], snapped out to whole weeks (Monday) or months.
 * input: { from: "YYYY-MM-DD", to, bucket, utcOffsetMinutes, timeZone }
 * -> { buckets: [{key, label, startMs, endMs}] } | { error }
 */
function bucketsFor(input) {
  const i = input || {};
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const f = re.exec(str(i.from)), t = re.exec(str(i.to));
  if (!f || !t) return { error: "range_required", detail: "from and to are local dates, YYYY-MM-DD" };
  if (!BUCKETS.includes(i.bucket)) return { error: "bucket_invalid", detail: "bucket is day, week or month" };
  // 330 is the default every other clock in WardSynQ uses when a hospital has set none.
  const off = i.utcOffsetMinutes == null || i.utcOffsetMinutes === "" ? 330 : Number(i.utcOffsetMinutes);
  const clock = { timeZone: str(i.timeZone) || null, offset: Number.isFinite(off) ? off : 330 };
  let y = +f[1], m = +f[2] - 1, d = +f[3];
  const endKey = ymd(+t[1], +t[2] - 1, +t[3]);
  if (ymd(y, m, d) > endKey) return { error: "range_invalid", detail: "from is after to" };
  if (i.bucket === "week") d -= (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7;
  if (i.bucket === "month") d = 1;
  const out = [];
  while (ymd(y, m, d) <= endKey) {
    if (out.length >= MAX_BUCKETS) return { error: "range_too_long", detail: `at most ${MAX_BUCKETS} buckets; use a wider bucket` };
    const [ny, nm, nd] = i.bucket === "day" ? [y, m, d + 1] : i.bucket === "week" ? [y, m, d + 7] : [y, m + 1, 1];
    const key = ymd(y, m, d);
    out.push({ key, label: i.bucket === "month" ? key.slice(0, 7) : i.bucket === "week" ? "week of " + key : key, startMs: localMidnight(y, m, d, clock), endMs: localMidnight(ny, nm, nd, clock) });
    const n = new Date(Date.UTC(ny, nm, nd)); y = n.getUTCFullYear(); m = n.getUTCMonth(); d = n.getUTCDate();
  }
  return { buckets: out, clock };
}

/* ---- facts: what each metric counts, each with its time, ward and record ------------------------ */

const wardOfStay = (e) => str(e && e.location && e.location.ward) || null;
const isStay = (e) => e && INPATIENT.has(e.class) && e.status !== "cancelled" && ms(e.periodStart) != null;

function indexStays(encounters) {
  const byId = new Map(), byPatient = new Map();
  for (const e of encounters || []) {
    if (!e || !e.id) continue;
    byId.set(str(e.id), e);
    if (!isStay(e)) continue;
    const k = str(e.patientId);
    if (!byPatient.has(k)) byPatient.set(k, []);
    byPatient.get(k).push(e);
  }
  return { byId, byPatient };
}
/** The ward a record belongs to: its encounter's ward, else the patient's stay covering the time. */
function wardAt(rec, idx, atMs) {
  const e = rec && rec.encounterId ? idx.byId.get(str(rec.encounterId)) : null;
  if (wardOfStay(e)) return wardOfStay(e);
  for (const s of idx.byPatient.get(str(rec && rec.patientId)) || []) {
    const a = ms(s.periodStart), b = ms(s.periodEnd);
    if (atMs >= a && (b == null || atMs <= b)) return wardOfStay(s);
  }
  return null;
}
const ref = (resourceType, r) => ({ resourceType, id: r.id });

/**
 * PURE. One stay, ward by ward, from its version history (ascending). A transfer is a new version with a
 * new location and its movedAt (migrate-inpatient.js); other versions (a discharge) keep the location.
 * -> [{ward, bed, start, end}] with end null while running, or null when a move has no time to place it.
 */
function staySegments(versions) {
  const vs = (versions || []).filter(Boolean).slice().sort((a, b) => (a.version || 0) - (b.version || 0));
  if (!vs.length) return null;
  const last = vs[vs.length - 1];
  const where = (v) => `${str(v.location && v.location.ward).toLowerCase()}\u0000${str(v.location && v.location.bed).toLowerCase()}`;
  const segs = [];
  for (const v of vs) {
    const prev = segs[segs.length - 1];
    if (prev && prev.key === where(v)) continue;
    const at = prev ? ms(v.movedAt) : ms(last.periodStart);
    if (at == null) return null;
    if (prev) prev.end = at;
    segs.push({ key: where(v), ward: wardOfStay(v), bed: str(v.location && v.location.bed) || null, start: at, end: null });
  }
  const end = last.status === "finished" ? ms(last.periodEnd) : null;
  if (last.status === "finished" && end == null) return null;
  segs[segs.length - 1].end = end;
  if (segs.some((g) => g.end != null && g.end < g.start)) return null;
  return segs.map((g) => ({ ward: g.ward, bed: g.bed, start: g.start, end: g.end }));
}

/**
 * PURE. The available bed-days of one registry bed in [a, b) (b already stopped at now).
 * bed: { since, active, changes: [{active, at}], legacy } -> { days } | { unknown: true }
 */
function bedDaysIn(bed, a, b) {
  if (!(b > a)) return { days: 0 };
  const since = Number(bed && bed.since);
  if (!(since > 0)) return { unknown: true };
  const changes = ((bed && bed.changes) || []).filter((c) => c && Number(c.at) > 0).map((c) => ({ active: c.active === true, at: Number(c.at) })).sort((x, y) => x.at - y.at);
  // A legacy bed turned off with no recorded change: when it went out of service is not known.
  if (bed.legacy && !changes.length && bed.active === false) return since >= b ? { days: 0 } : { unknown: true };
  let on = changes.length ? !changes[0].active : bed.active !== false, t = since, total = 0;
  for (const c of changes.concat([{ at: Infinity, active: on }])) {
    if (on) total += Math.max(0, Math.min(c.at, b) - Math.max(t, a));
    on = c.active; t = c.at;
  }
  return { days: total / DAY };
}

/** PURE. The facts a metric aggregates. Stays carry {start, end}; everything else an instant `at`. */
function factsFor(def, rows, ctx) {
  const idx = indexStays(rows.Encounter);
  const stays = (rows.Encounter || []).filter(isStay);
  const stayFact = (e) => ({ start: ms(e.periodStart), end: ms(e.periodEnd), ward: wardOfStay(e), ref: ref("Encounter", e), stay: e });
  /* A stay's ward-by-ward pieces. A stay never changed (version 1) is one piece; a changed one needs its
   * history, and one whose history is missing or cannot be placed is null. */
  const hist = ctx.histories || {};
  const segmentsOf = (e) => (!(Number(e.version) > 1) ? [{ ward: wardOfStay(e), bed: str(e.location && e.location.bed) || null, start: ms(e.periodStart), end: e.status === "finished" ? ms(e.periodEnd) : null }]
    : Object.prototype.hasOwnProperty.call(hist, e.id) ? staySegments(hist[e.id]) : null);
  const segView = (segs) => segs.map((g) => ({ ward: g.ward, bed: g.bed, from: new Date(g.start).toISOString(), to: g.end == null ? null : new Date(g.end).toISOString(),
    days: round(((g.end == null ? ctx.nowMs : g.end) - g.start) / DAY, 1), ...(g.end == null ? { running: true } : {}) }));
  switch (def.id) {
    case "admissions": return stays.map((e) => ({ at: ms(e.periodStart), ward: wardOfStay(e), ref: ref("Encounter", e) }));
    case "discharges":
    case "average-los":
      return stays.filter((e) => e.status === "finished" && ms(e.periodEnd) != null)
        .map((e) => ({ at: ms(e.periodEnd), ward: wardOfStay(e), ref: ref("Encounter", e), days: (ms(e.periodEnd) - ms(e.periodStart)) / DAY }));
    case "bed-occupancy":
      return stays.flatMap((e) => {
        const segs = segmentsOf(e);
        if (!segs) return [{ ...stayFact(e), ward: null, wardUnknown: true }];
        return segs.map((g) => ({ start: g.start, end: g.end, ward: g.ward, ref: ref("Encounter", e), stay: e }));
      });
    case "ward-los":
      return stays.flatMap((e) => {
        const segs = segmentsOf(e);
        if (!segs) return e.status === "finished" && ms(e.periodEnd) != null ? [{ at: ms(e.periodEnd), ward: null, wardUnknown: true, ref: ref("Encounter", e) }] : [];
        const view = segView(segs);
        return segs.filter((g) => g.end != null).map((g) => ({ at: g.end, ward: g.ward, days: (g.end - g.start) / DAY,
          ref: { resourceType: "Encounter", id: e.id, transferred: segs.length > 1, segments: view } }));
      });
    case "readmission-30d": {
      const deceasedAt = new Map((rows.Patient || []).filter((p) => p && p.deceased && p.deceased.at).map((p) => [str(p.id), ms(p.deceased.at)]));
      return stays.filter((e) => e.status === "finished" && ms(e.periodEnd) != null).map((e) => {
        const end = ms(e.periodEnd), d = deceasedAt.get(str(e.patientId));
        const died = (d != null && d >= ms(e.periodStart) && d <= end + DAY) || DEATH.test(str(e.disposition));
        const back = (idx.byPatient.get(str(e.patientId)) || []).some((o) => o !== e && o.id !== e.id && ms(o.periodStart) > end && ms(o.periodStart) <= end + 30 * DAY);
        return { at: end, ward: wardOfStay(e), ref: ref("Encounter", e), died, readmitted: back ? true : end + 30 * DAY > ctx.nowMs ? null : false };
      });
    }
    case "lab-tat": {
      const reqs = new Map((rows.ServiceRequest || []).filter((r) => r && r.id).map((r) => [str(r.id), r]));
      const out = [];
      for (const r of rows.DiagnosticReport || []) {
        if (!r || !r.serviceRequestId) continue;
        const sr = reqs.get(str(r.serviceRequestId));
        if (sr && sr.category === "imaging") continue;
        const end = ms(r.reportedAt);
        if (end == null) continue; // no release time: in no bucket
        const start = sr ? ms(sr.meta && sr.meta.recordedAt) : null;
        const excluded = !sr ? "requestNotReadable" : start == null ? "requestTimeMissing" : end < start ? "negative" : null;
        out.push({ at: end, ward: wardAt(r, idx, end), ref: ref("DiagnosticReport", r), excluded, minutes: excluded ? null : Math.round((end - start) / 60000) });
      }
      return out;
    }
    case "critical-ack":
      return (rows.CriticalResultLoop || []).filter((l) => l && ms(l.reportedAt || l.openedAt) != null).map((l) => {
        const at = ms(l.reportedAt || l.openedAt), ack = ms(l.acknowledgedAt);
        return { at, ward: wardAt(l, idx, at), ref: ref("CriticalResultLoop", l), minutes: ack != null && ack >= at ? Math.round((ack - at) / 60000) : null };
      });
    case "antibiotic-dot": {
      const abx = ctx.antibiotics;
      const out = [];
      for (const a of rows.MedicationAdministration || []) {
        if (!a || a.status !== "administered") continue;
        const at = ms(a.administeredAt); if (at == null) continue;
        const drug = str(a.drug).toLowerCase(), code = str(a.drugCode).toLowerCase();
        if (!abx.some((x) => x === code || (drug && (drug === x || drug.startsWith(x + " "))))) continue;
        const p = localParts(at, ctx.clock);
        out.push({ at, ward: wardAt(a, idx, at), ref: ref("MedicationAdministration", a), dotKey: `${str(a.patientId)}|${drug || code}|${ymd(p.y, p.m, p.d)}` });
      }
      return out.concat(stays.map((e) => ({ ...stayFact(e), denominatorOnly: true })));
    }
    case "incidents":
      return (rows.IncidentReport || []).filter((x) => x && stageOf(x) !== "rejected" && ms(x.when || x.reportedAt) != null).map((x) => {
        const at = ms(x.when || x.reportedAt);
        return { at, ward: x.patientId ? wardAt(x, idx, at) : null, ref: ref("IncidentReport", x), category: str(x.category) || "uncategorised" };
      });
    case "pharmacy-dispensing":
      return (rows.MedicationDispense || []).filter((x) => x && ms(x.dispensedAt) != null).map((x) => {
        const at = ms(x.dispensedAt);
        return { at, ward: str(x.destination) || wardAt(x, idx, at), ref: ref("MedicationDispense", x) };
      });
    case "billed-charges":
      return (rows.Invoice || []).filter((inv) => inv && ms(((inv.events || [])[0] || {}).at) != null).map((inv) => {
        const at = ms(inv.events[0].at);
        let charged = null; try { charged = Number(reconciliationOf(inv).charged) || 0; } catch (e) { charged = null; }
        return { at, ward: wardAt(inv, idx, at), ref: ref("Invoice", inv), charged };
      });
    default: return [];
  }
}

const overlap = (f, b, nowMs) => Math.max(0, Math.min(f.end == null ? nowMs : f.end, b.endMs, nowMs) - Math.max(f.start, b.startMs));
const touches = (f, b, nowMs) => (f.start != null ? overlap(f, b, nowMs) > 0 : f.at >= b.startMs && f.at < b.endMs);

/** PURE. One bucket's numbers from the facts in it (already filtered to the group). */
function reduce(def, facts, b, ctx, group) {
  const n = facts.length;
  switch (def.kind) {
    case "count": {
      const out = { value: n, numerator: n, denominator: null };
      if (def.id === "incidents") { out.byCategory = {}; for (const f of facts) out.byCategory[f.category] = (out.byCategory[f.category] || 0) + 1; }
      return out;
    }
    case "mean": {
      const unknown = ctx.unknownIn(b);
      if (unknown) return { value: null, numerator: null, denominator: null, unknownStays: unknown, reason: `the ward history of ${unknown} stay${unknown === 1 ? "" : "s"} could not be read, so this is not known` };
      const total = facts.reduce((s, f) => s + f.days, 0);
      return { value: n ? round(total / n, 1) : null, numerator: round(total, 1), denominator: n, ...(n ? {} : { reason: "no stays ended in this bucket" }) };
    }
    case "median": {
      const measured = facts.filter((f) => f.minutes != null && !f.excluded).map((f) => f.minutes);
      const out = { value: percentile(measured, 50), p90: percentile(measured, 90), numerator: measured.length, denominator: n };
      if (def.id === "critical-ack") out.unacknowledged = n - measured.length;
      else out.excluded = facts.filter((f) => f.excluded).length;
      if (!measured.length) out.reason = n ? "nothing in this bucket could be measured" : "none in this bucket";
      return out;
    }
    case "ratio": {
      if (def.id === "readmission-30d") {
        const idx = facts.filter((f) => !f.died);
        const decided = idx.filter((f) => f.readmitted !== null);
        const num = decided.filter((f) => f.readmitted).length;
        return { value: decided.length ? round(num / decided.length, 3) : null, numerator: num, denominator: decided.length,
          pending: idx.length - decided.length, excludedDied: n - idx.length, ...(decided.length ? {} : { reason: idx.length ? "every discharge is still inside its 30 days" : "no discharges in this bucket" }) };
      }
      // bed occupancy
      const occupied = facts.reduce((s, f) => s + overlap(f, b, ctx.nowMs), 0) / DAY;
      const unknownStays = group === null ? 0 : ctx.unknownIn(b);
      if (unknownStays) return { value: null, numerator: null, denominator: null, unknownStays, reason: `which ward ${unknownStays} stay${unknownStays === 1 ? " was" : "s were"} on in this bucket is not known: the movement history could not be read` };
      const bd = ctx.bedDays(group, b.startMs, Math.min(b.endMs, ctx.nowMs));
      if (!bd.beds) return { value: null, numerator: round(occupied, 1), denominator: null, reason: group ? "no beds are registered for this " + ctx.groupBy : "no beds are registered for this hospital" };
      if (bd.unknown) return { value: null, numerator: round(occupied, 1), denominator: null, beds: bd.beds, unknownBeds: bd.unknown, reason: `the bed count in this bucket is not known: ${bd.unknown} bed${bd.unknown === 1 ? " has" : "s have"} no history for it` };
      const avail = bd.days;
      return { value: avail > 0 ? round(occupied / avail, 3) : null, numerator: round(occupied, 1), denominator: round(avail, 1), beds: bd.beds, ...(avail > 0 ? {} : { reason: "no bed was in service in this bucket" }) };
    }
    case "per1000": {
      const dot = new Set(facts.filter((f) => f.dotKey).map((f) => f.dotKey)).size;
      const pd = facts.filter((f) => f.denominatorOnly).reduce((s, f) => s + overlap(f, b, ctx.nowMs), 0) / DAY;
      return { value: pd > 0 ? round((dot / pd) * 1000, 1) : null, numerator: dot, denominator: round(pd, 1), ...(pd > 0 ? {} : { reason: "no patient-days in this bucket" }) };
    }
    case "sum": {
      if (facts.some((f) => f.charged == null)) return { value: null, numerator: null, denominator: n, reason: "an invoice in this bucket could not be reconciled" };
      const total = facts.reduce((s, f) => s + f.charged, 0);
      return { value: round(total, 2), numerator: round(total, 2), denominator: n };
    }
    default: return { value: null, numerator: null, denominator: null, reason: "unknown measure" };
  }
}

/**
 * PURE. The series, and optionally the record ids behind one bucket of one group.
 *
 * input: { metric, buckets, clock, rows: {Type: []}, unreadable: {Type: reason}, capped: [Type], nowMs,
 *          groupBy: ""|"ward"|"department", wardDepartments: {lowerWard: name},
 *          bedHistory: [{ward, since, active, changes, legacy}], histories: {encounterId: versions},
 *          antibiotics: [], registryError, eventsFor: {key, group} }
 */
function computeTrend(input) {
  const i = input || {};
  const def = DEFINITIONS[i.metric];
  const nowMs = Number(i.nowMs) || Date.now();
  const groupBy = i.groupBy === "ward" || i.groupBy === "department" ? i.groupBy : "";
  const unreadable = i.unreadable || {};
  const capped = (i.capped || []).filter((t) => def.sources.includes(t));
  const blank = (reason) => ({ value: null, numerator: null, denominator: null, coverage: "none", reason });

  /* Why no bucket can have a number, if there is such a reason. */
  const blockedType = def.sources.find((t) => unreadable[t]);
  const abx = (Array.isArray(i.antibiotics) ? i.antibiotics : []).map((a) => str(a).toLowerCase()).filter(Boolean);
  const blocked = blockedType ? `${blockedType} records could not be read: ${unreadable[blockedType]}`
    : def.id === "antibiotic-dot" && !abx.length ? "antibiotic list not configured. Set wardsynq.antibiotics on the organisation."
    : groupBy === "department" && i.registryError ? `the ward and department registry could not be read: ${i.registryError}`
    : null;

  /* Wards are matched case-insensitively (as ADT's own bed check is) and shown as the registry spells
   * them, else as the first record did. */
  const lower = (w) => str(w).toLowerCase();
  const beds = new Map(), depts = new Map(), names = new Map();
  for (const bed of Array.isArray(i.bedHistory) ? i.bedHistory : []) {
    const w = str(bed && bed.ward); if (!w) continue;
    if (!beds.has(lower(w))) beds.set(lower(w), []);
    beds.get(lower(w)).push(bed); if (!names.has(lower(w))) names.set(lower(w), w);
  }
  for (const [w, d] of Object.entries(i.wardDepartments || {})) { depts.set(lower(w), d); if (!names.has(lower(w))) names.set(lower(w), w); }
  const groupOf = (w) => (groupBy === "ward" ? (w ? names.get(lower(w)) || str(w) : NO_WARD)
    : groupBy === "department" ? (w && depts.get(lower(w))) || NO_DEPT : null);
  const wardUnknown = [];
  const ctx = {
    nowMs, clock: i.clock || { timeZone: null, offset: 330 }, antibiotics: abx, groupBy, histories: i.histories || {},
    bedDays: (group, a, b) => {
      const out = { beds: 0, days: 0, unknown: 0 };
      for (const [w, list] of beds) {
        if (group !== null && groupOf(w) !== group) continue;
        for (const bed of list) { const r = bedDaysIn(bed, a, b); out.beds++; if (r.unknown) out.unknown++; else out.days += r.days; }
      }
      return out;
    },
    // Stays that could not be placed on a ward, in this bucket (a stay by its overlap, a ward stay by its end).
    unknownIn: (b) => wardUnknown.filter((f) => (f.start != null ? overlap(f, b, nowMs) > 0 : f.at >= b.startMs && f.at < b.endMs)).length,
  };

  const facts = blocked ? [] : factsFor(def, i.rows || {}, ctx);
  for (const f of facts) if (f.ward && !names.has(lower(f.ward))) names.set(lower(f.ward), f.ward);
  /* One pass: each fact into the buckets it touches, under its group, so a year of days across thirty
   * wards is not a scan of every fact for every cell. */
  const bs = i.buckets || [];
  const bucketAt = (t) => {
    let lo = 0, hi = bs.length - 1, hit = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (bs[mid].startMs <= t) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
    return hit >= 0 && t < bs[hit].endMs ? hit : -1;
  };
  const cells = new Map();
  const put = (g, k, f) => { if (!cells.has(g)) cells.set(g, bs.map(() => [])); cells.get(g)[k].push(f); };
  for (const f of facts) {
    // Unplaced: counted as unknown per bucket. Hospital-wide occupancy still has the stay's own days.
    if (f.wardUnknown && (groupBy || def.id === "ward-los")) { wardUnknown.push(f); continue; }
    const g = groupOf(f.ward);
    if (f.start == null) { const k = bucketAt(f.at); if (k >= 0) put(g, k, f); continue; }
    if (!bs.length) continue;
    for (let k = bucketAt(Math.max(f.start, bs[0].startMs)); k >= 0 && k < bs.length && bs[k].startMs < nowMs; k++) {
      if (touches(f, bs[k], nowMs)) put(g, k, f);
      if (f.end != null && bs[k].endMs > f.end) break;
    }
  }
  let groups = [null];
  if (groupBy) {
    const seen = new Set(cells.keys());
    if (def.id === "bed-occupancy") for (const w of beds.keys()) seen.add(groupOf(w));
    // Stays that could not be placed still have a row, whose buckets say not known.
    if (wardUnknown.length && !seen.size) seen.add(groupOf(null));
    groups = [...seen].sort();
  }
  const series = groups.map((group) => ({
    group,
    points: bs.map((b, k) => {
      const base = { key: b.key, label: b.label, start: new Date(b.startMs).toISOString(), end: new Date(b.endMs).toISOString(), ...(b.endMs > nowMs ? { inProgress: true } : {}) };
      if (blocked) return { ...base, ...blank(blocked) };
      if (b.startMs > nowMs) return { ...base, ...blank("this bucket has not started") };
      const r = reduce(def, (cells.get(group) || [])[k] || [], b, ctx, group);
      return { ...base, ...r, coverage: capped.length || b.endMs > nowMs ? "partial" : "full" };
    }),
  }));

  let events = null;
  if (i.eventsFor && !blocked) {
    const k = bs.findIndex((x) => x.key === i.eventsFor.key);
    const seen = new Set(), list = [];
    const inCell = k < 0 ? [] : [...cells].filter(([g]) => lower(g) === lower(i.eventsFor.group)).flatMap(([, c]) => c[k]);
    for (const f of inCell) {
      if (f.denominatorOnly) continue;
      const k = f.ref.resourceType + "|" + f.ref.id;
      if (seen.has(k)) continue;
      seen.add(k); list.push(f.ref);
    }
    events = { total: list.length, truncated: list.length > EVENTS_CAP || capped.length > 0, items: list.slice(0, EVENTS_CAP) };
  }
  return { series, events, blocked, capped };
}

/* ---- routes --------------------------------------------------------------------------------------- */

async function openService(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    return { svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** Shared by both routes: validate, read each source on its own, compute. */
async function run(request, env, ctx, eventsFor) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };
  const def = DEFINITIONS[str(ctx.metric)];
  if (!def) return { ...base, ok: false, status: 422, error: "metric_unknown" };
  const bk = bucketsFor({ from: ctx.from, to: ctx.to, bucket: str(ctx.bucket) || "day", utcOffsetMinutes: ctx.utcOffsetMinutes, timeZone: ctx.timeZone });
  if (bk.error) return { ...base, ok: false, status: 422, error: bk.error, detail: bk.detail };
  const { svc, error } = await openService(request, env, ctx);
  if (error) return { ...base, ...error };

  const rows = {}, unreadable = {}, capped = [];
  let refused = false;
  await Promise.all(def.sources.map(async (t) => {
    try { rows[t] = (await svc.list(t, READ_CAP)) || []; if (rows[t].length >= READ_CAP) capped.push(t); }
    catch (e) { refused = refused || e instanceof GovernanceError; unreadable[t] = e instanceof GovernanceError ? "not readable with this role" : "read failed"; rows[t] = []; }
  }));
  /* The event list names records. A reader who may not read a source type is refused outright, the way
   * record-detail refuses: a null bucket is right for a chart, but an empty id list would read as none. */
  if (eventsFor && Object.keys(unreadable).length) {
    return refused ? { ...base, ok: false, status: 403, error: "permission", detail: "your role cannot read the records behind this measure" }
      : { ...base, ok: false, status: 502, error: "record_read_failed", unreadable: Object.keys(unreadable) };
  }
  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  /* G7: the movement history of every changed stay that overlaps the range, in one audited read. A read
   * that fails leaves those stays unplaced (their buckets say unknown); it never drops them. */
  const histories = {};
  if (def.history && !unreadable.Encounter && bk.buckets.length) {
    const lo = bk.buckets[0].startMs, hi = Math.min(bk.buckets[bk.buckets.length - 1].endMs, nowMs);
    const ids = (rows.Encounter || []).filter((e) => isStay(e) && Number(e.version) > 1 && ms(e.periodStart) < hi && (ms(e.periodEnd) == null || ms(e.periodEnd) >= lo)).map((e) => str(e.id));
    if (ids.length) {
      try { const got = await svc.histories("Encounter", ids); for (const id of ids) if (got.get(id)) histories[id] = got.get(id); }
      catch (e) { /* every changed stay stays unplaced */ }
    }
  }
  const r = computeTrend({ metric: def.id, buckets: bk.buckets, clock: bk.clock, rows, unreadable, capped, nowMs,
    groupBy: ctx.groupBy, wardDepartments: ctx.wardDepartments, bedHistory: ctx.bedHistory, histories, antibiotics: ctx.antibiotics,
    registryError: ctx.registryError, eventsFor });
  return {
    ...base, ok: true, generatedAt: new Date(nowMs).toISOString(),
    metric: def.id, definition: { ...def, wardAttribution: def.wardNote || WARD_NOTE }, bucket: str(ctx.bucket) || "day",
    range: { from: ctx.from, to: ctx.to, timeZone: bk.clock.timeZone, utcOffsetMinutes: bk.clock.offset },
    groupBy: str(ctx.groupBy) || null,
    truncated: capped.length > 0, capped, unreadable: Object.keys(unreadable), readCap: READ_CAP,
    ...(capped.length ? { warning: `Only the first ${READ_CAP} ${capped.join(", ")} records were read, so every bucket may be short. Treat these numbers as a floor.` } : {}),
    series: eventsFor ? undefined : r.series,
    ...(eventsFor ? { key: eventsFor.key, ward: eventsFor.group, events: r.events, reason: r.blocked } : {}),
  };
}

/** ctx: { migration, metric, from, to, bucket, groupBy?, utcOffsetMinutes?, timeZone?, antibiotics?, bedHistory?,
 *  wardDepartments?, registryError?, now?, actorDeps, recordDeps } */
async function trendSeries(request, env, ctx) {
  return run(request, env, ctx, null);
}

/** ctx: trendSeries's, plus key (a bucket key) and ward. Record ids only; the caller authorises the ward. */
async function trendEvents(request, env, ctx) {
  const ward = str(ctx.ward), key = str(ctx.key);
  if (!ward || !key) return { ok: false, status: 422, error: "ward_and_bucket_required" };
  return run(request, env, { ...ctx, groupBy: "ward" }, { key, group: ward });
}

export { DEFINITIONS, READ_CAP, EVENTS_CAP, NO_WARD, NO_DEPT, trendCatalogue, bucketsFor, localParts, staySegments, bedDaysIn, computeTrend, trendSeries, trendEvents };
