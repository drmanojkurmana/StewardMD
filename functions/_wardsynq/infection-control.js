/* functions/_wardsynq/infection-control.js - healthcare-associated infection surveillance, surgical antibiotic
 * prophylaxis review and the cumulative antibiogram (P5, gaps 4 and 5 of the 2026-09-17 audit).
 *
 * THE DEFINITIONS ARE CDC/NHSN, APPLIED BY A PERSON. NABH (6th edition, PSQ 3a-3b, KPIs 13-16) defines CAUTI, VAP,
 * CLABSI and SSI "as per the latest CDC/NHSN definition", and the ICMR HAI surveillance network in India applies the
 * same definitions. The references this file was written against, each read on 2026-09-17:
 *   CLABSI  NHSN Patient Safety Component Manual, January 2026, ch.4 Bloodstream Infection Event
 *           https://www.cdc.gov/nhsn/pdfs/pscmanual/4psc_clabscurrent.pdf
 *   CAUTI   same manual, ch.7 Urinary Tract Infection Event  https://www.cdc.gov/nhsn/pdfs/pscmanual/7psccauticurrent.pdf
 *   VAP     same manual, ch.6 Pneumonia (VAP and PNEU) Event  https://www.cdc.gov/nhsn/pdfs/pscmanual/6pscvapcurrent.pdf
 *   SSI     same manual, ch.9 Surgical Site Infection Event   https://www.cdc.gov/nhsn/pdfs/pscmanual/9pscssicurrent.pdf
 * NOTHING HERE DIAGNOSES AN INFECTION. The infection control nurse opens a case, reads the chart against the NHSN
 * criteria, and confirms it (naming the criterion met) or rules it out. The server computes only two facts the manual
 * makes arithmetic of, and shows them beside the decision: which device day the date of event falls on (a device is
 * eligible after "more than two consecutive calendar days ... with day of device placement being Day 1" and until the
 * day after removal), and which post-operative day an SSI falls on against its 30 or 90 day surveillance period. A case
 * the arithmetic says is not eligible can still be confirmed, with the nurse's written reason, because the line log may
 * be late or incomplete; the reason stays on the record. The criterion names (HAI_EVENTS) are UNAPPROVED seed content
 * for clinical sign-off (seed-signoff.js).
 *
 * DEVICE-DAYS, as NHSN counts the denominator: one day per patient per calendar day on which at least one device of the
 * class was present, the day of insertion and the day of removal both counted (ch.4 Table 6 and Table 7). Read from the
 * line log (LineRecord with a deviceClass). NHSN accepts electronic counts only after three months within 5% of manual
 * daily counts; that validation is the hospital's and the answer says so.
 *
 * THE ANTIBIOGRAM FOLLOWS CLSI M39 (Analysis and Presentation of Cumulative Antimicrobial Susceptibility Test Data, M39-A4
 * January 2014, recommendations carried into the 5th edition, 2022; see Simner et al., J Clin Microbiol 2022,
 * doi:10.1128/jcm.02210-21, and Microbiol Spectr 2023 PMC9927543): final, verified results only; the first isolate of a
 * species per patient per analysis period, irrespective of body site or susceptibility profile; percent susceptible
 * (%S) without %I; and a species shown only when enough isolates were tested (M39 recommends 30; the hospital sets the
 * number, antibiogramMinIsolates). Organism names are counted as the laboratory reported them. Interpreting a MIC
 * needs licensed breakpoints and is not done: S, I, R and SDD are what the laboratory reported (pathology-report.js).
 *
 * APPEND-ONLY. A ruled-out case, a withdrawn confirmation and a changed prophylaxis review are new versions.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { readWindowed } from "./read-window.js";
import { computeQualitySafety } from "./quality.js";

const HAI_TYPE = "HaiCase", SAP_TYPE = "SurgicalProphylaxis";
/* READ_LIMIT: a whole-type read (service.listAll), oldest first; past it the newest are not read and the view says so. */
const DAY = 86400000, HOUR = 3600000, READ_LIMIT = 50000;
const DEVICE_CLASSES = Object.freeze(["central-line", "urinary-catheter", "ventilator"]);
const SSI_DEPTHS = Object.freeze(["superficial-incisional", "deep-incisional", "organ-space"]);
const HAI_STATES = Object.freeze(["under-review", "confirmed", "ruled-out", "withdrawn"]);
const NHSN = "NHSN Patient Safety Component Manual, January 2026";

/* UNAPPROVED seed content (seed-signoff.js "hai-criteria"): the NHSN criteria a confirmation may name, per event. */
const HAI_EVENTS = Object.freeze({
  CLABSI: Object.freeze({ label: "Central line-associated bloodstream infection", device: "central-line", nabh: 15,
    criteria: Object.freeze(["LCBI 1", "LCBI 2", "LCBI 3", "MBI-LCBI 1", "MBI-LCBI 2", "MBI-LCBI 3"]), source: NHSN + ", ch.4 Bloodstream Infection Event, Table 1 and Table 2" }),
  CAUTI: Object.freeze({ label: "Catheter-associated urinary tract infection", device: "urinary-catheter", nabh: 13,
    criteria: Object.freeze(["SUTI 1a", "ABUTI"]), source: NHSN + ", ch.7 Urinary Tract Infection Event, Table 1" }),
  VAP: Object.freeze({ label: "Ventilator-associated pneumonia", device: "ventilator", nabh: 14,
    criteria: Object.freeze(["PNU1", "PNU2", "PNU3"]), source: NHSN + ", ch.6 Pneumonia (VAP and PNEU) Event, Tables 1 to 4" }),
  SSI: Object.freeze({ label: "Surgical site infection", device: null, nabh: 16,
    criteria: Object.freeze(["Superficial incisional SSI", "Deep incisional SSI", "Organ/Space SSI"]), source: NHSN + ", ch.9 Surgical Site Infection Event, Table 1" }),
});

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const offMs = (minutes) => (Number.isFinite(Number(minutes)) && minutes !== null && minutes !== "" ? Number(minutes) : 330) * 60000;
/** PURE. The hospital-local calendar day number of an instant. */
const dayOf = (t, off) => Math.floor((t + off) / DAY);
/** PURE. The local calendar day number of a YYYY-MM-DD date, or null. */
function dayOfDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(d));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return new Date(t).getUTCDate() === +m[3] ? Math.floor(t / DAY) : null;
}
/** PURE. [fromMs, toMs] of a YYYY-MM month in hospital-local time, or null. */
function monthRange(month, off) {
  const m = /^(\d{4})-(\d{2})$/.exec(str(month));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return { month: m[0], fromMs: Date.UTC(+m[1], +m[2] - 1, 1) - off, toMs: Date.UTC(+m[1], +m[2], 1) - off - 1, offsetMs: off };
}

/* ------------------------------------------------------------------ pure: device-days and eligibility */

/** PURE. NHSN denominator device-days of one class in [fromMs, toMs]: one per patient per local calendar day on which a
 *  line of that class was present. An open line runs to nowMs (never into the future). */
function deviceDays(lines, deviceClass, fromMs, toMs, off, nowMs) {
  const seen = new Set();
  const first = dayOf(fromMs, off), last = dayOf(Math.min(toMs, nowMs == null ? toMs : nowMs), off);
  for (const l of lines || []) {
    if (!l || l.deviceClass !== deviceClass) continue;
    const a = ms(l.insertedAt);
    if (a == null) continue;
    const r = ms(l.removedAt);
    const from = Math.max(first, dayOf(a, off)), to = Math.min(last, r == null ? last : dayOf(r, off));
    for (let d = from; d <= to; d++) seen.add(str(l.patientId) + "|" + d);
  }
  return seen.size;
}

/** PURE. Where a date of event falls against a device line, by the NHSN device-associated rule. */
function deviceEligibility(line, dateOfEvent, off) {
  const doe = dayOfDate(dateOfEvent), placed = line && ms(line.insertedAt);
  if (doe == null || placed == null) return { eligible: false, deviceDay: null, basis: "The date of event or the line's insertion time is missing." };
  const deviceDay = doe - dayOf(placed, off) + 1;
  const removed = ms(line.removedAt);
  const removedDay = removed == null ? null : dayOf(removed, off);
  const eligible = deviceDay > 2 && (removedDay == null || doe <= removedDay + 1);
  return {
    eligible, deviceDay, removedDay: removedDay == null ? null : removedDay - dayOf(placed, off) + 1,
    basis: "NHSN: the device had been in place for more than two consecutive calendar days on the date of event (placement is day 1) and was in place on the date of event or the day before. Counted from the line log, which does not show whether the line was in an inpatient location or when it was first accessed.",
  };
}

/** PURE. Where an SSI date of event falls against the operation (day 1 = the procedure date). */
function ssiEligibility(surgicalCase, dateOfEvent, depth, surveillanceDays, off) {
  const doe = dayOfDate(dateOfEvent), op = surgicalCase && ms(surgicalCase.incisionAt);
  if (doe == null || op == null) return { eligible: false, postOpDay: null, basis: "The date of event or the incision time is missing." };
  const postOpDay = doe - dayOf(op, off) + 1;
  const period = depth === "superficial-incisional" ? 30 : surveillanceDays;
  return {
    eligible: postOpDay >= 1 && postOpDay <= period, postOpDay, surveillanceDays: period,
    basis: "NHSN: the date of event is within the SSI surveillance period after the operative procedure (day 1 = the procedure date): 30 days for a superficial incisional SSI, 30 or 90 days by procedure category for deep incisional and organ/space.",
  };
}

/** PURE. Confirmed cases of an event whose date of event is in the local window. */
function confirmedIn(cases, event, w) {
  const first = dayOf(w.fromMs, w.offsetMs), last = dayOf(w.toMs, w.offsetMs);
  return (cases || []).filter((c) => c && c.event === event && c.status === "confirmed" && dayOfDate(c.dateOfEvent) != null && dayOfDate(c.dateOfEvent) >= first && dayOfDate(c.dateOfEvent) <= last);
}

/* ------------------------------------------------------------------ pure: prophylaxis */

/** PURE. The drug name or code is on the hospital's antibiotic list (the same matching quality.js uses for DOT). */
function isListedAntibiotic(drug, code, list) {
  const d = str(drug).toLowerCase(), c = str(code).toLowerCase();
  return (list || []).map((x) => str(x).toLowerCase()).filter(Boolean).some((x) => x === c || (d && (d === x || d.startsWith(x + " "))));
}

/** PURE. Listed antibiotics given within 24 hours either side of incision, from the eMAR and the anaesthesia record, and
 *  which of them fall in the hospital's window before incision. */
function prophylaxisDoses(input) {
  const i = input || {}, inc = ms(i.incisionAt), win = Number(i.windowMinutes);
  if (inc == null) return { doses: [], inWindow: [] };
  const doses = [];
  for (const a of i.administrations || []) {
    if (!a || a.status !== "administered" || str(a.patientId) !== str(i.patientId) || !isListedAntibiotic(a.drug, a.drugCode, i.antibiotics)) continue;
    const at = ms(a.administeredAt);
    if (at != null && Math.abs(at - inc) <= 24 * HOUR) doses.push({ drug: a.drug || a.drugCode, at: a.administeredAt, source: "eMAR", minutesBeforeIncision: Math.round((inc - at) / 60000) });
  }
  for (const ev of i.anaesthesiaEvents || []) {
    if (!ev || !isListedAntibiotic(ev.drug, null, i.antibiotics)) continue;
    const at = ms(ev.at);
    if (at != null && Math.abs(at - inc) <= 24 * HOUR) doses.push({ drug: ev.drug, at: ev.at, source: "anaesthesia record", minutesBeforeIncision: Math.round((inc - at) / 60000) });
  }
  doses.sort((x, y) => ms(x.at) - ms(y.at));
  const inWindow = Number.isInteger(win) && win > 0 ? doses.filter((d) => d.minutesBeforeIncision >= 0 && d.minutesBeforeIncision <= win) : [];
  return { doses, inWindow };
}

/** PURE. NABH PSQ 3b #18: a patient not given prophylaxis because it was not indicated counts as appropriate; one given it
 *  when not indicated does not. Indicated means a dose in the window of an agent the reviewer says matches the policy. */
function prophylaxisAppropriate(indicated, agentPerPolicy, inWindowCount) {
  return indicated ? inWindowCount > 0 && agentPerPolicy === "yes" : inWindowCount === 0;
}

/* ------------------------------------------------------------------ pure: antibiogram */

/** PURE. CLSI M39 cumulative antibiogram over final microbiology reports collected in [fromMs, toMs]. */
function computeAntibiogram(reports, opts) {
  const o = opts || {}, min = Number(o.minIsolates);
  if (!Number.isInteger(min) || min < 1) return { computable: false, reason: "not-configured" };
  const firsts = new Map();
  let duplicates = 0, used = 0;
  const rows = (reports || []).filter((r) => r && r.category === "microbiology" && (r.status === "final" || r.status === "corrected"))
    .map((r) => ({ r, at: ms(r.collectedAt) != null ? ms(r.collectedAt) : ms(r.reportedAt) }))
    .filter((x) => x.at != null && x.at >= o.fromMs && x.at <= o.toMs)
    .sort((a, b) => a.at - b.at);
  for (const { r, at } of rows) {
    used++;
    for (const org of r.organisms || []) {
      const species = str(org.name).toLowerCase().replace(/\s+/g, " ");
      if (!species) continue;
      const key = str(r.patientId) + "|" + species;
      if (firsts.has(key)) { duplicates++; continue; }
      firsts.set(key, { species, name: str(org.name), at, susceptibilities: org.susceptibilities || [] });
    }
  }
  const bySpecies = new Map();
  for (const f of firsts.values()) {
    if (!bySpecies.has(f.species)) bySpecies.set(f.species, { organism: f.name, isolates: 0, drugs: new Map() });
    const s = bySpecies.get(f.species);
    s.isolates++;
    const seenDrug = new Set();
    for (const x of f.susceptibilities) {
      const drug = str(x.antibiotic), k = drug.toLowerCase();
      if (!drug || seenDrug.has(k)) continue;
      seenDrug.add(k);
      if (!s.drugs.has(k)) s.drugs.set(k, { antibiotic: drug, tested: 0, susceptible: 0 });
      const d = s.drugs.get(k);
      d.tested++;
      if (str(x.result).toUpperCase() === "S") d.susceptible++;
    }
  }
  const organisms = [...bySpecies.values()].sort((a, b) => b.isolates - a.isolates || a.organism.localeCompare(b.organism)).map((s) => {
    if (s.isolates < min) return { organism: s.organism, isolates: s.isolates, insufficient: true, antibiotics: [] };
    return { organism: s.organism, isolates: s.isolates, insufficient: false, antibiotics: [...s.drugs.values()].sort((a, b) => a.antibiotic.localeCompare(b.antibiotic)).map((d) => (d.tested < min
      ? { antibiotic: d.antibiotic, tested: d.tested, insufficient: true, percentSusceptible: null }
      : { antibiotic: d.antibiotic, tested: d.tested, insufficient: false, percentSusceptible: Math.round((d.susceptible / d.tested) * 100) })) };
  });
  return { computable: true, minIsolates: min, reportsUsed: used, firstIsolates: firsts.size, duplicatesExcluded: duplicates, organisms };
}

/* ------------------------------------------------------------------ plumbing */

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
const bare = (rec) => { const n = { ...rec }; delete n.version; delete n.meta; delete n.writtenBy; return n; };
/** Reads each type on its own: an unreadable type is named, never read as empty; a type past READ_LIMIT sets truncated.
 *
 * R5-3: a type in `windowed` is read from `sinceMs` rather than from the hospital's first record
 * (read-window.js). Only the types this view MEASURES over its period are listed there; the case
 * register itself is shown whole, so it is not. */
async function readTypes(svc, types, opts) {
  const rows = {}, unreadable = {};
  const sinceMs = opts && opts.sinceMs, windowed = new Set((opts && opts.windowed) || []);
  let truncated = false;
  await Promise.all(types.map(async (t) => {
    try { const got = windowed.has(t) ? await readWindowed(svc, t, { sinceMs, max: READ_LIMIT }) : await svc.listAll(t, { max: READ_LIMIT }); rows[t] = got.rows.filter(Boolean); if (got.truncated) truncated = true; }
    catch (e) { unreadable[t] = e instanceof GovernanceError ? "not readable with this role" : str(e && e.message) || "read failed"; rows[t] = null; }
  }));
  return { rows, unreadable, truncated };
}
async function patientsFor(svc, ids) {
  const out = {};
  for (const id of [...new Set(ids.map(str).filter(Boolean))].slice(0, 150)) {
    try { const p = await svc.get("Patient", id); if (p) out[id] = { name: p.name || null, mrn: p.mrn || null }; } catch { /* named as unknown on screen */ }
  }
  return out;
}

/* ------------------------------------------------------------------ HAI cases */

/** ctx: { migration, action: open|confirm|rule-out|withdraw, caseId?, patientId?, event?, dateOfEvent?, lineId?,
 *        surgicalCaseId?, ssiDepth?, surveillanceDays?, criteriaMet?, organisms?, eligibilityNote?, reason?, note?,
 *        expectedVersion?, utcOffsetMinutes?, idempotencyKey?, actorDeps, recordDeps } */
async function recordHaiCase(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const action = str(ctx.action), off = offMs(ctx.utcOffsetMinutes);
  if (!["open", "confirm", "rule-out", "withdraw"].includes(action)) return { ...base, ok: false, status: 400, error: "unknown_action", detail: "action is open, confirm, rule-out or withdraw", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const now = new Date().toISOString(), by = resolved.actor.id;

  if (action === "open") {
    const event = str(ctx.event), def = HAI_EVENTS[event];
    if (!def) return { ...base, ok: false, status: 422, error: "unknown_event", detail: `event is one of ${Object.keys(HAI_EVENTS).join(", ")}`, written: 0 };
    const patientId = str(ctx.patientId), dateOfEvent = str(ctx.dateOfEvent);
    if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
    if (dayOfDate(dateOfEvent) == null) return { ...base, ok: false, status: 422, error: "date_of_event_required", detail: "the date of event as YYYY-MM-DD", written: 0 };
    if (dayOfDate(dateOfEvent) > dayOf(Date.now(), off)) return { ...base, ok: false, status: 422, error: "date_of_event_in_future", written: 0 };
    let eligibility, link = {};
    try {
      if (def.device) {
        const line = str(ctx.lineId) ? await svc.get("LineRecord", str(ctx.lineId)) : null;
        if (!line || str(line.patientId) !== patientId) return { ...base, ok: false, status: 422, error: "line_required", detail: "a device-associated infection is linked to the patient's line in the line log", written: 0 };
        if (line.deviceClass !== def.device) return { ...base, ok: false, status: 422, error: "wrong_device_class", detail: `${event} is linked to a ${def.device} line`, written: 0 };
        eligibility = deviceEligibility(line, dateOfEvent, off);
        link = { lineId: line.id, encounterId: line.encounterId || null };
      } else {
        const depth = str(ctx.ssiDepth), days = Number(ctx.surveillanceDays);
        if (!SSI_DEPTHS.includes(depth)) return { ...base, ok: false, status: 422, error: "ssi_depth_required", detail: `ssiDepth is one of ${SSI_DEPTHS.join(", ")}`, written: 0 };
        if (depth !== "superficial-incisional" && days !== 30 && days !== 90) return { ...base, ok: false, status: 422, error: "surveillance_days_required", detail: "a deep incisional or organ/space SSI states its surveillance period, 30 or 90 days, from the NHSN procedure category", written: 0 };
        const sc = str(ctx.surgicalCaseId) ? await svc.get("SurgicalCase", str(ctx.surgicalCaseId)) : null;
        if (!sc || str(sc.patientId) !== patientId) return { ...base, ok: false, status: 422, error: "surgical_case_required", detail: "a surgical site infection is linked to the patient's operation", written: 0 };
        if (!sc.incisionAt) return { ...base, ok: false, status: 422, error: "no_incision", detail: "the linked case has no incision time", written: 0 };
        eligibility = ssiEligibility(sc, dateOfEvent, depth, days, off);
        link = { surgicalCaseId: sc.id, encounterId: sc.encounterId || null, ssiDepth: depth, surveillanceDays: eligibility.surveillanceDays };
      }
    } catch (e) {
      if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
      return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
    }
    const id = "wsq-hai-" + crypto.randomUUID();
    const record = {
      resourceType: HAI_TYPE, id, patientId, event, dateOfEvent, lineId: null, surgicalCaseId: null, ssiDepth: null, surveillanceDays: null, ...link,
      status: "under-review", eligibility, criteriaMet: [], organisms: [], eligibilityNote: null, reason: null,
      note: str(ctx.note) || null, openedBy: by, openedAt: now, decidedBy: null, decidedAt: null, definitionSource: def.source,
    };
    try {
      const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
      return { ...base, ok: true, written: 1, caseId: id, status: record.status, eligibility, version: out.record.version };
    } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  }

  const caseId = str(ctx.caseId);
  let current;
  try { current = caseId ? await svc.get(HAI_TYPE, caseId) : null; }
  catch (e) { return { ...base, ...(e instanceof GovernanceError ? { ok: false, status: 403, error: "governance" } : { ok: false, status: 502, error: "record_read_failed" }), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "case_not_found", written: 0 };
  let next;
  if (action === "confirm") {
    if (current.status !== "under-review") return { ...base, ok: false, status: 409, error: "not_under_review", detail: `this case is ${current.status}`, written: 0 };
    const allowed = HAI_EVENTS[current.event].criteria;
    const criteria = [...new Set((Array.isArray(ctx.criteriaMet) ? ctx.criteriaMet : []).map(str).filter(Boolean))];
    if (!criteria.length) return { ...base, ok: false, status: 422, error: "criteria_required", detail: "name the NHSN criterion the case meets", written: 0 };
    const bad = criteria.filter((c) => !allowed.includes(c));
    if (bad.length) return { ...base, ok: false, status: 422, error: "unknown_criteria", detail: `${bad.join(", ")} is not a ${current.event} criterion; use ${allowed.join(", ")}`, written: 0 };
    const eligibilityNote = str(ctx.eligibilityNote);
    if (!(current.eligibility && current.eligibility.eligible) && eligibilityNote.length < 10) return { ...base, ok: false, status: 422, error: "eligibility_note_required", detail: "the line log or operation date does not show this case as eligible under NHSN; say why it is confirmed anyway", eligibility: current.eligibility, written: 0 };
    next = { ...bare(current), status: "confirmed", criteriaMet: criteria, organisms: (Array.isArray(ctx.organisms) ? ctx.organisms : []).map(str).filter(Boolean).slice(0, 10), eligibilityNote: eligibilityNote || null, decidedBy: by, decidedAt: now };
  } else {
    const reason = str(ctx.reason);
    if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", written: 0 };
    if (action === "rule-out" && current.status !== "under-review") return { ...base, ok: false, status: 409, error: "not_under_review", detail: `this case is ${current.status}`, written: 0 };
    if (action === "withdraw" && current.status !== "confirmed") return { ...base, ok: false, status: 409, error: "not_confirmed", detail: "only a confirmed case is withdrawn", written: 0 };
    next = { ...bare(current), status: action === "rule-out" ? "ruled-out" : "withdrawn", reason, decidedBy: by, decidedAt: now };
  }
  try {
    const out = await svc.put(next, { expectedVersion: ctx.expectedVersion != null && ctx.expectedVersion !== "" ? Number(ctx.expectedVersion) : current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId, status: next.status, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/* ------------------------------------------------------------------ prophylaxis review */

/** ctx: { migration, caseId, indicated (boolean), agentPerPolicy (yes|no|not-applicable), note?, antibiotics, windowMinutes,
 *        expectedVersion?, actorDeps, recordDeps } */
async function recordProphylaxisReview(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const caseId = str(ctx.caseId), agent = str(ctx.agentPerPolicy);
  if (!caseId) return { ...base, ok: false, status: 422, error: "case_required", written: 0 };
  if (typeof ctx.indicated !== "boolean") return { ...base, ok: false, status: 422, error: "indicated_required", detail: "say whether prophylaxis was indicated for this operation", written: 0 };
  if (!["yes", "no", "not-applicable"].includes(agent) || (ctx.indicated && agent === "not-applicable")) return { ...base, ok: false, status: 422, error: "agent_required", detail: "say whether the antibiotic given matches the hospital's policy (yes or no); not-applicable only when prophylaxis was not indicated", written: 0 };
  const win = Number(ctx.windowMinutes), abx = Array.isArray(ctx.antibiotics) ? ctx.antibiotics : [];
  if (!Number.isInteger(win) || win < 1) return { ...base, ok: false, status: 409, error: "window_not_configured", detail: "Set the prophylaxis window (minutes before incision) in Admin, clinical settings, before reviewing.", written: 0 };
  if (!abx.length) return { ...base, ok: false, status: 409, error: "antibiotics_not_configured", detail: "Set the antibiotic list in Admin, clinical settings, before reviewing: doses are found by it.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let sc, admins, anaes, current;
  try {
    sc = await svc.get("SurgicalCase", caseId);
    if (!sc) return { ...base, ok: false, status: 404, error: "case_not_found", written: 0 };
    if (!sc.incisionAt) return { ...base, ok: false, status: 409, error: "no_incision", detail: "a case is reviewed once its incision time is recorded", written: 0 };
    admins = await svc.byPatient("MedicationAdministration", sc.patientId);
    anaes = await svc.byPatient("AnesthesiaRecord", sc.patientId);
    current = await svc.get(SAP_TYPE, "wsq-sap-" + slug(caseId));
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The case, its doses or its anaesthesia record could not be read, so nothing was saved.", written: 0 };
  }
  const events = (anaes || []).filter((a) => a && a.caseId === caseId).flatMap((a) => a.events || []);
  const found = prophylaxisDoses({ incisionAt: sc.incisionAt, patientId: sc.patientId, administrations: admins, anaesthesiaEvents: events, antibiotics: abx, windowMinutes: win });
  const record = {
    ...(current ? bare(current) : {}), resourceType: SAP_TYPE, id: "wsq-sap-" + slug(caseId), caseId, patientId: sc.patientId, incisionAt: sc.incisionAt,
    indicated: ctx.indicated, agentPerPolicy: agent, windowMinutes: win, doses: found.doses, dosesInWindow: found.inWindow.length,
    appropriate: prophylaxisAppropriate(ctx.indicated, agent, found.inWindow.length), note: str(ctx.note) || null,
    reviewedBy: resolved.actor.id, reviewedAt: new Date().toISOString(),
  };
  try {
    const out = await svc.put(record, { expectedVersion: current ? (ctx.expectedVersion != null && ctx.expectedVersion !== "" ? Number(ctx.expectedVersion) : current.version) : undefined });
    return { ...base, ok: true, written: 1, caseId, appropriate: record.appropriate, doses: record.doses, dosesInWindow: record.dosesInWindow, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
}

/* ------------------------------------------------------------------ the infection control screen */

/** ctx: { migration, month (YYYY-MM), antibiotics, windowMinutes, utcOffsetMinutes, actorDeps, recordDeps } */
async function infectionControlView(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", cases: [] };
  const off = offMs(ctx.utcOffsetMinutes), nowMs = Date.now();
  const localNow = new Date(nowMs + off);
  const month = str(ctx.month) || `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth() + 1).padStart(2, "0")}`;
  const w = monthRange(month, off);
  if (!w) return { ...base, ok: false, status: 422, error: "bad_month", detail: "month as YYYY-MM", cases: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, cases: null };
  const { rows, unreadable, truncated } = await readTypes(svc, [HAI_TYPE, "LineRecord", "SurgicalCase", SAP_TYPE, "MedicationAdministration", "AnesthesiaRecord"],
    { sinceMs: w.fromMs, windowed: [SAP_TYPE, "MedicationAdministration", "AnesthesiaRecord"] });

  const cases = rows[HAI_TYPE] && [...rows[HAI_TYPE]].sort((a, b) => str(b.openedAt).localeCompare(str(a.openedAt)));
  const rates = Object.entries(HAI_EVENTS).map(([event, def]) => {
    const need = def.device ? [HAI_TYPE, "LineRecord"] : [HAI_TYPE, "SurgicalCase"];
    const blocked = need.find((t) => unreadable[t]);
    if (blocked) return { event, nabh: def.nabh, computable: false, reason: `${blocked} could not be read (${unreadable[blocked]})` };
    const numerator = def.device ? confirmedIn(cases, event, w).length
      : confirmedIn(cases, event, { fromMs: -8.64e15, toMs: 8.64e15, offsetMs: off }).filter((c) => { const s = rows.SurgicalCase.find((x) => x.id === c.surgicalCaseId); const t = s && ms(s.incisionAt); return t != null && t >= w.fromMs && t <= w.toMs; }).length;
    const denominator = def.device ? deviceDays(rows.LineRecord, def.device, w.fromMs, w.toMs, off, nowMs) : rows.SurgicalCase.filter((s) => { const t = ms(s.incisionAt); return t != null && t >= w.fromMs && t <= w.toMs; }).length;
    const mult = def.device ? 1000 : 100;
    return { event, nabh: def.nabh, computable: true, numerator, denominator, per: mult, value: denominator > 0 ? Math.round((numerator / denominator) * mult * 100) / 100 : null };
  });

  const recent = nowMs - 120 * DAY;
  const lines = rows.LineRecord && rows.LineRecord.filter((l) => l.deviceClass && (!l.removedAt || ms(l.removedAt) >= recent))
    .map((l) => ({ lineId: l.id, patientId: l.patientId, deviceClass: l.deviceClass, type: l.type, site: l.site || null, insertedAt: l.insertedAt, removedAt: l.removedAt || null }));
  const operations = rows.SurgicalCase && rows.SurgicalCase.filter((s) => ms(s.incisionAt) != null && ms(s.incisionAt) >= nowMs - 100 * DAY)
    .map((s) => ({ caseId: s.id, patientId: s.patientId, procedure: s.procedure || null, incisionAt: s.incisionAt }));

  let prophylaxis = null, prophylaxisReason = null;
  const win = Number(ctx.windowMinutes), abx = Array.isArray(ctx.antibiotics) ? ctx.antibiotics : [];
  const sapBlocked = ["SurgicalCase", SAP_TYPE, "MedicationAdministration", "AnesthesiaRecord"].find((t) => unreadable[t]);
  if (sapBlocked) prophylaxisReason = `${sapBlocked} could not be read (${unreadable[sapBlocked]})`;
  else if (!Number.isInteger(win) || win < 1) prophylaxisReason = "window-not-configured";
  else if (!abx.length) prophylaxisReason = "antibiotics-not-configured";
  else {
    prophylaxis = rows.SurgicalCase.filter((s) => { const t = ms(s.incisionAt); return t != null && t >= w.fromMs && t <= w.toMs; })
      .sort((a, b) => ms(a.incisionAt) - ms(b.incisionAt)).map((s) => {
        const found = prophylaxisDoses({ incisionAt: s.incisionAt, patientId: s.patientId, administrations: rows.MedicationAdministration, anaesthesiaEvents: rows.AnesthesiaRecord.filter((a) => a.caseId === s.id).flatMap((a) => a.events || []), antibiotics: abx, windowMinutes: win });
        const review = rows[SAP_TYPE].find((r) => r.caseId === s.id) || null;
        return { caseId: s.id, patientId: s.patientId, procedure: s.procedure || null, incisionAt: s.incisionAt, doses: found.doses, dosesInWindow: found.inWindow.length,
          review: review && { indicated: review.indicated, agentPerPolicy: review.agentPerPolicy, appropriate: review.appropriate, reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt, windowMinutes: review.windowMinutes, version: review.version } };
      });
  }
  const ids = [...(cases || []).map((c) => c.patientId), ...(lines || []).map((l) => l.patientId), ...(operations || []).map((o) => o.patientId), ...(prophylaxis || []).map((p) => p.patientId)];
  return {
    ...base, ok: true, month, truncated, cases, casesError: unreadable[HAI_TYPE] || null, rates, lines, linesError: unreadable.LineRecord || null,
    operations, operationsError: unreadable.SurgicalCase || null, prophylaxis, prophylaxisReason, windowMinutes: Number.isInteger(win) ? win : null,
    patients: await patientsFor(svc, ids),
    events: Object.entries(HAI_EVENTS).map(([id, d]) => ({ id, label: d.label, device: d.device, criteria: d.criteria, source: d.source, nabh: d.nabh })),
    ssiDepths: SSI_DEPTHS, deviceClasses: DEVICE_CLASSES,
    unapproved: "The NHSN criterion names offered here are seed content awaiting clinical sign-off.",
    denominatorNote: "Device-days are counted electronically from the line log. NHSN accepts electronic counts only after three consecutive months within 5% of manual daily counts; that validation is the hospital's.",
  };
}

/** ctx: { migration, from?, to? (YYYY-MM-DD), minIsolates, antibiotics, utcOffsetMinutes, actorDeps, recordDeps } */
async function antibiogramReport(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", organisms: [] };
  const off = offMs(ctx.utcOffsetMinutes), nowMs = Date.now();
  const fromDay = str(ctx.from) ? dayOfDate(ctx.from) : dayOf(nowMs, off) - 364;
  const toDay = str(ctx.to) ? dayOfDate(ctx.to) : dayOf(nowMs, off);
  if (fromDay == null || toDay == null || fromDay > toDay) return { ...base, ok: false, status: 422, error: "bad_period", detail: "from and to as YYYY-MM-DD, from not after to", organisms: null };
  const fromMs = fromDay * DAY - off, toMs = (toDay + 1) * DAY - off - 1;
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, organisms: null };
  const { rows, unreadable, truncated } = await readTypes(svc, ["DiagnosticReport", "MedicationAdministration", "Encounter"],
    { sinceMs: fromMs, windowed: ["DiagnosticReport", "MedicationAdministration"] });
  const period = { from: new Date(fromDay * DAY).toISOString().slice(0, 10), to: new Date(toDay * DAY).toISOString().slice(0, 10) };
  if (unreadable.DiagnosticReport) return { ...base, ok: false, status: 502, error: "record_read_failed", detail: `Microbiology reports could not be read (${unreadable.DiagnosticReport}).`, organisms: null };
  const ab = computeAntibiogram(rows.DiagnosticReport, { fromMs, toMs, minIsolates: Number(ctx.minIsolates) });
  /* Days of therapy come from quality.js, unchanged: the same measure the quality report shows, for the same period. */
  let dot = null;
  if (unreadable.MedicationAdministration || unreadable.Encounter) dot = { computable: false, reason: "Administration or encounter records could not be read with this role." };
  else {
    const m = computeQualitySafety({ encounters: rows.Encounter, administrations: rows.MedicationAdministration, antibiotics: ctx.antibiotics, fromMs, toMs, incidents: [], wounds: [], unreadable: {} }).measures.find((x) => x.id === "antibiotic-dot");
    dot = m ? { computable: m.computable !== false, numerator: m.numerator == null ? null : m.numerator, denominator: m.denominator == null ? null : m.denominator, rate: m.rate == null ? null : m.rate, reason: m.reason || null } : null;
  }
  return {
    ...base, ok: true, period, ...ab, organisms: ab.computable ? ab.organisms : null, dot,
    truncated,
    method: "CLSI M39: final results only; first isolate of each species per patient in the period, whatever the specimen or susceptibility; percent susceptible excludes intermediate; a species or antibiotic tested on fewer isolates than the hospital minimum is shown as insufficient. Organism names are counted as reported. Screening cultures are not told apart from diagnostic ones in the record and are included.",
  };
}

export {
  HAI_TYPE, SAP_TYPE, DEVICE_CLASSES, SSI_DEPTHS, HAI_STATES, HAI_EVENTS, dayOfDate, monthRange, deviceDays, deviceEligibility, ssiEligibility,
  confirmedIn, isListedAntibiotic, prophylaxisDoses, prophylaxisAppropriate, computeAntibiogram,
  recordHaiCase, recordProphylaxisReview, infectionControlView, antibiogramReport,
};
