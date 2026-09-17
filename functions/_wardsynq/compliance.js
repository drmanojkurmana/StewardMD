/* functions/_wardsynq/compliance.js - the returns a hospital is asked for, computed from its own record.
 *
 *   NABH indicators   the 32 hospital-wide key performance indicators of the NABH hospital standards, 6th edition
 *                     (PSQ 3a-3d, nabh-kpi-defs.js), month by month. NABH publishes no monthly submission format, so
 *                     this is a monthly table of the indicators, said as such.
 *   HMIS monthly      the Government of India HMIS monthly format for a private secondary care facility
 *                     (hmis-items.js), with the items WardSynQ's record supports filled and every other item marked.
 *   DHS checklist     the hospital's own self-assessment against the NABH Digital Health Standards (dhs-elements.js).
 *                     A self-assessment, never a certification: nothing here says a hospital meets a standard.
 *
 * AN INDICATOR THE RECORD CANNOT SUPPORT SAYS SO, AND NAMES WHAT IS MISSING. The same rule quality.js keeps: a
 * blank cell reads as zero, and a guessed number is worse than none. Where the record supports only part of a
 * definition the difference is written beside the value, never hidden.
 *
 * Measures name no clinician, as in quality.js.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { computeQualitySafety } from "./quality.js";
import { NABH_KPIS } from "./nabh-kpi-defs.js";
import { HMIS_FORMAT, HMIS_SECTIONS, HMIS_ITEMS } from "./hmis-items.js";
import { DHS_CHAPTERS, DHS_ELEMENTS } from "./dhs-elements.js";
import { milestoneTimes, dischargeMinutes } from "./discharge-milestones.js";

const str = (v) => (v == null ? "" : String(v).trim());
const DAY = 86400000, HOUR = 3600000;
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const round = (v, dp) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const READ_LIMIT = 5000;

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
const baseOf = (ctx) => ({ mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null });

/** Reads each type on its own: one unreadable type makes only the rows that need it not computable. */
async function readTypes(svc, types) {
  const rows = {}, unreadable = {};
  let truncated = false;
  await Promise.all(types.map(async (t) => {
    try { rows[t] = (await svc.list(t, READ_LIMIT)).filter(Boolean); if (rows[t].length >= READ_LIMIT) truncated = true; }
    catch (e) { unreadable[t] = e instanceof GovernanceError ? "not readable with this role" : str(e && e.message) || "read failed"; rows[t] = []; }
  }));
  return { rows, unreadable, truncated };
}

/** PURE. The last `count` calendar months in the hospital's local time, oldest first. */
function monthWindows(nowMs, count, offsetMinutes) {
  const off = (Number.isFinite(offsetMinutes) ? offsetMinutes : 330) * 60000;
  const local = new Date(nowMs + off);
  const out = [];
  for (let k = count - 1; k >= 0; k--) {
    const y = local.getUTCFullYear(), m = local.getUTCMonth() - k;
    const from = Date.UTC(y, m, 1) - off, to = Date.UTC(y, m + 1, 1) - off - 1;
    const d = new Date(Date.UTC(y, m, 1));
    out.push({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, fromMs: from, toMs: to, offsetMs: off });
  }
  return out;
}

const inW = (t, w) => { const v = ms(t); return v != null && v >= w.fromMs && v <= w.toMs; };
const val = (numerator, denominator, multiplier) => ({ numerator, denominator, value: denominator > 0 ? round((numerator / denominator) * multiplier, 2) : null });

/* ================================================================== NABH indicators */

/* What each indicator is computed from, or what the record lacks. `needs` are the types read; `compute` returns a
 * month cell. An indicator with `missing` is not computable and says what would have to be recorded. */
const NABH_SOURCES = {
  1: { missing: "The time a patient reached the ward bed and the time the doctor's initial assessment was completed are not recorded as two separate times." },
  2: { needs: ["DiagnosticReport"], source: "Diagnostic reports released in the month (final or corrected); a report corrected after release counts as a reporting error.",
    note: "Counted per report, not per test within a report as the standard counts.",
    compute: (r, w) => { const rep = r.DiagnosticReport.filter((x) => (x.status === "final" || x.status === "corrected") && inW(x.reportedAt, w)); return val(rep.filter((x) => x.status === "corrected").length, rep.length, 1000); } },
  3: { missing: "An audit of staff adherence to safety precautions in diagnostics; WardSynQ holds no such audit." },
  4: { missing: "The number of opportunities for a medication error. Confirmed medication-error incidents are recorded, but the denominator is not." },
  5: { missing: "An adverse drug reaction record. Incidents have no adverse drug reaction category." },
  6: { missing: "Whether a surgical case is an unplanned return to theatre; a surgical case does not record it." },
  7: { needs: ["SurgicalCase"], source: "Surgical cases with an incision in the month; the checklist was followed when sign in, time out and sign out were all completed.",
    note: "Every case is counted, not an audited sample.",
    compute: (r, w) => { const cs = r.SurgicalCase.filter((c) => inW(c.incisionAt, w)); return val(cs.filter((c) => c.signIn && c.timeOut && c.signOut).length, cs.length, 100); } },
  8: { needs: ["TransfusionEpisode"], source: "Transfusions started in the month (one unit each) and the suspected reactions recorded against them.",
    compute: (r, w) => { const eps = r.TransfusionEpisode.filter((e) => inW(e.startedAt, w)); return val(eps.filter((e) => e.reaction).length, eps.length, 100); } },
  9: { missing: "Predicted deaths from a severity score (APACHE, SOFA, SAPS, MPM); WardSynQ does not record one." },
  10: { needs: ["Encounter"], source: "ICU stays that ended in the month, and a new ICU stay for the same patient starting within 48 hours.",
    note: "HDU stays are not told apart from ICU stays unless the hospital records them under a different class.",
    compute: (r, w) => {
      const icu = r.Encounter.filter((e) => e.class === "ICU" && e.status !== "cancelled");
      const ended = icu.filter((e) => inW(e.periodEnd, w));
      const back = ended.filter((e) => icu.some((o) => o !== e && str(o.patientId) === str(e.patientId) && ms(o.periodStart) > ms(e.periodEnd) && ms(o.periodStart) <= ms(e.periodEnd) + 48 * HOUR));
      return val(back.length, ended.length, 100);
    } },
  11: { missing: "Whether a return to the emergency department was with a similar presenting complaint; complaints are not recorded in a comparable coded form." },
  12: { needs: ["Encounter", "IncidentReport", "WoundAssessment"], source: "Confirmed pressure-injury incidents per 1000 occupied bed-days (quality.js).", qs: "pressure-injuries" },
  13: { missing: "Urinary catheter-days and a catheter-associated infection record." },
  14: { missing: "Ventilator-days and a ventilator-associated pneumonia record." },
  15: { missing: "Central line days and a line-associated bloodstream infection record." },
  16: { missing: "A surgical site infection record linked to the procedure." },
  17: { missing: "A hand hygiene compliance audit." },
  18: { missing: "The time a prophylactic antibiotic was given relative to incision on the surgical case." },
  19: { missing: "Rescheduling of a surgery; a surgical case does not record it." },
  20: { needs: ["TransfusionEpisode"], source: "Minutes from the transfusion request to the unit being issued, for units issued in the month.",
    compute: (r, w) => {
      const mins = [];
      for (const e of r.TransfusionEpisode) {
        const led = Array.isArray(e.ledger) ? e.ledger : [];
        const req = led.find((x) => x.event === "requested"), iss = led.find((x) => x.event === "issued");
        if (!req || !iss || !inW(iss.at, w) || ms(iss.at) < ms(req.at)) continue;
        mins.push((ms(iss.at) - ms(req.at)) / 60000);
      }
      const sum = mins.reduce((a, b) => a + b, 0);
      return { numerator: round(sum, 1), denominator: mins.length, value: mins.length ? round(sum / mins.length, 1) : null };
    } },
  21: { missing: "Nurses on duty per shift against occupied beds; the rota is not linked to bed occupancy." },
  22: { missing: "Outpatient arrival and consultation start times; these live in the OPD queue, not in the clinical record." },
  23: { missing: "The time a patient arrived for a diagnostic test and the time it started." },
  24: { needs: ["DischargeMilestone", "Encounter"], source: "Inpatient stays that left the clinical unit in the month: minutes from the recorded discharge advice to the recorded departure, less any time the patient asked to stay (discharge-milestones.js).",
    note: "Only stays where discharge advice was recorded are counted. Where the departure was not recorded, the time the stay was closed in WardSynQ is used.",
    compute: (r, w) => {
      const enc = new Map(r.Encounter.map((e) => [e.id, e]));
      const mins = [];
      for (const d of r.DischargeMilestone) {
        const e = enc.get(d.encounterId) || null;
        if (d.class === "DAYCARE" || (e && e.class === "DAYCARE")) continue;
        const left = milestoneTimes(d, { encounter: e }).left;
        if (!left || !inW(left.at, w)) continue;
        const m = dischargeMinutes(d, e);
        if (m != null) mins.push(m);
      }
      const sum = mins.reduce((a, b) => a + b, 0);
      return { numerator: sum, denominator: mins.length, value: mins.length ? round(sum / mins.length, 1) : null };
    } },
  25: { missing: "An audit of consent forms in medical records." },
  26: { missing: "A list of emergency medications and their stock-out events." },
  27: { missing: "Mock drill records." },
  28: { needs: ["Encounter", "IncidentReport", "WoundAssessment"], source: "Confirmed fall incidents per 1000 occupied bed-days (quality.js).", qs: "falls" },
  29: { needs: ["IncidentReport"], source: "Incident reports in the month whose severity is near-miss, over all incident reports in the month.",
    compute: (r, w) => { const inc = r.IncidentReport.filter((x) => inW(x.reportedAt || x.when, w)); return val(inc.filter((x) => x.severity === "near-miss").length, inc.length, 100); } },
  30: { missing: "Needlestick injury reports; staff injuries are not an incident category." },
  31: { missing: "An audit of whether handovers were appropriate. Handovers are recorded; their quality is not." },
  32: { missing: "An audit of prescriptions against a safe and rational prescribing checklist." },
};
const NABH_TYPES = [...new Set(Object.values(NABH_SOURCES).flatMap((s) => s.needs || []))];

/** PURE. input: { rows: {Type: [...]}, unreadable: {Type: reason}, windows } */
function computeNabhIndicators(input) {
  const rows = { ...Object.fromEntries(NABH_TYPES.map((t) => [t, []])), ...(input.rows || {}) };
  const bad = input.unreadable || {};
  const qsByMonth = new Map();
  const qs = (w) => {
    if (!qsByMonth.has(w.month)) qsByMonth.set(w.month, Object.fromEntries(computeQualitySafety({ encounters: rows.Encounter, incidents: rows.IncidentReport, wounds: rows.WoundAssessment, fromMs: w.fromMs, toMs: w.toMs, unreadable: bad }).measures.map((m) => [m.id, m])));
    return qsByMonth.get(w.month);
  };
  return NABH_KPIS.map((k) => {
    const s = NABH_SOURCES[k.no] || { missing: "Not mapped." };
    const def = { no: k.no, standard: k.standard, title: k.title, definition: k.definition, numerator: k.numerator, denominator: k.denominator, unit: k.unit, frequency: k.frequency };
    if (s.missing) return { ...def, computable: false, reason: "Not computable from WardSynQ data. Missing: " + s.missing, dataSource: null, months: [] };
    const blocked = (s.needs || []).find((t) => bad[t]);
    if (blocked) return { ...def, computable: false, reason: `Not computable: ${blocked} records could not be read (${bad[blocked]}).`, dataSource: s.source, months: [] };
    const months = input.windows.map((w) => {
      if (s.qs) { const m = qs(w)[s.qs]; return { month: w.month, numerator: m.numerator, denominator: m.denominator, value: m.rate }; }
      return { month: w.month, ...s.compute(rows, w) };
    });
    return { ...def, computable: true, dataSource: s.source, note: s.note || null, months };
  });
}

const NABH_FORMAT_NOTE = "NABH publishes no monthly submission format for these indicators. This is a monthly table of the 32 indicators of the 6th edition (PSQ 3a-3d), with the value, numerator and denominator for each month WardSynQ can compute.";

/** ctx: { migration, months?, now?, utcOffsetMinutes?, actorDeps, recordDeps } */
async function nabhIndicators(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", indicators: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, indicators: null };
  const count = Math.min(12, Math.max(1, Number(ctx.months) || 6));
  const windows = monthWindows(Date.parse(str(ctx.now)) || Date.now(), count, ctx.utcOffsetMinutes);
  const { rows, unreadable, truncated } = await readTypes(svc, NABH_TYPES);
  const indicators = computeNabhIndicators({ rows, unreadable, windows });
  return {
    ...base, ok: true, months: windows.map((w) => w.month), indicators,
    computable: indicators.filter((i) => i.computable).length, notComputable: indicators.filter((i) => !i.computable).length,
    truncated, ...(truncated ? { truncatedNote: `At least one record type has more than ${READ_LIMIT} records; older months may be incomplete.` } : {}),
    formatNote: NABH_FORMAT_NOTE, source: "NABH Accreditation Standards for Hospitals, 6th edition (January 2025), PSQ 3a-3d",
  };
}

/** PURE. One CSV cell. A leading =, +, - or @ is quoted with an apostrophe so a spreadsheet does not run it. */
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** PURE. The NABH monthly table as CSV. */
function nabhCsv(report) {
  const head = ["No", "Standard", "Indicator", "Unit", ...report.months.flatMap((m) => [m + " value", m + " numerator", m + " denominator"]), "Computable", "Data source or what is missing"];
  const body = report.indicators.map((i) => {
    const cells = report.months.flatMap((m) => { const c = (i.months || []).find((x) => x.month === m); return c ? [c.value, c.numerator, c.denominator] : ["", "", ""]; });
    return [i.no, i.standard, i.title, i.unit, ...cells, i.computable ? "yes" : "no", i.computable ? [i.dataSource, i.note].filter(Boolean).join(" ") : i.reason];
  });
  return csvRows([[report.formatNote], head, ...body]);
}

/* ================================================================== HMIS monthly */

/* Item code -> how WardSynQ fills it. Every item not listed here is reported as not available from WardSynQ data. */
const HMIS_TYPES = ["Encounter", "Patient", "DeliveryRecord", "DiagnosticReport", "Immunization"];
const CSECTION = /caesarean|cesarean|c-?section|lscs/i;
const DIED = /\b(died|death|deceased|expired|dead)\b/i;
const LAMA = /\blama\b|\bdama\b|against medical advice/i;
/* Admissions are the stays a patient is admitted to. ICU is left out because an ICU stay is recorded as its own encounter
 * inside an admission, and counting it would count the same admission twice. */
const ADMIT = new Set(["IPD", "MATERNITY", "PEDIATRICS", "NICU"]);
const night = (t, w) => { const v = ms(t); if (v == null) return false; const h = new Date(v + w.offsetMs).getUTCHours(); return h >= 20 || h < 8; };
function hmisHelpers(rows) {
  const pat = new Map(rows.Patient.map((p) => [str(p.id), p]));
  const ageAt = (pid, at) => { const p = pat.get(str(pid)), b = p && ms(p.dob), t = ms(at); return b == null || t == null ? null : (t - b) / (365.25 * DAY); };
  const sexOf = (pid) => { const s = str((pat.get(str(pid)) || {}).sex).toLowerCase(); return s.startsWith("m") ? "m" : s.startsWith("f") ? "f" : null; };
  /* HMIS splits by sex under 60 and puts everyone 60 and over in one band. The format has no total cell for these rows,
   * so a patient with no recorded sex or date of birth is counted nowhere, and each band says so. */
  const band = (list, at, key) => list.filter((e) => {
    const age = ageAt(e.patientId, at(e)), sex = sexOf(e.patientId);
    if (age == null) return false;
    if (key === "e") return age >= 60;
    if (age >= 60) return false;
    return (key === "a" || key === "b" ? sex === "m" : sex === "f") && ((key === "a" || key === "c") ? age < 18 : age >= 18);
  }).length;
  return { band };
}
const BAND_NOTE = "A patient with no recorded sex or date of birth is in no band, so is not counted here.";
const stays = (r, w, pick) => r.Encounter.filter((e) => ADMIT.has(e.class) && e.status !== "cancelled" && pick(e, w));
const admitted = (e, w) => inW(e.periodStart, w);
const discharged = (e, w) => e.status === "finished" && inW(e.periodEnd, w);
const diedStay = (r) => { const dead = new Map(r.Patient.filter((p) => p.deceased && p.deceased.at).map((p) => [str(p.id), ms(p.deceased.at)])); return (e) => DIED.test(str(e.disposition)) || (dead.has(str(e.patientId)) && dead.get(str(e.patientId)) <= (ms(e.periodEnd) || 0) + DAY && dead.get(str(e.patientId)) >= (ms(e.periodStart) || 0)); };
const imaging = (re) => ({ needs: ["DiagnosticReport"], source: "Imaging reports released in the month whose test or modality names it.", note: "Matched by the test name; an in-house study only.",
  count: (r, w) => r.DiagnosticReport.filter((x) => x.category === "imaging" && (x.status === "final" || x.status === "corrected") && inW(x.reportedAt, w) && re.test([x.modality, x.display, x.code].map(str).join(" "))).length });
const bandsOf = (code, needs, source, list, at) => {
  const out = {};
  for (const k of ["a", "b", "c", "d", "e"]) out[code + k] = { needs: [...needs, "Patient"], source, note: BAND_NOTE, count: (r, w) => hmisHelpers(r).band(list(r, w), at, k) };
  return out;
};
const HMIS_FILL = {
  "2.2.": { needs: ["DeliveryRecord"], source: "Delivery records dated in the month.", count: (r, w) => r.DeliveryRecord.filter((d) => inW(d.deliveredAt, w)).length },
  "2.2.2": { needs: ["DeliveryRecord"], source: "Delivery records dated in the month, 8 PM to 8 AM hospital time, whose mode is not a caesarean section.", count: (r, w) => r.DeliveryRecord.filter((d) => inW(d.deliveredAt, w) && night(d.deliveredAt, w) && !CSECTION.test(str(d.mode))).length },
  "3.1.": { needs: ["DeliveryRecord"], source: "Delivery records dated in the month whose mode is a caesarean section.", note: "The delivery mode is recorded as written; it is matched by the words caesarean, C-section or LSCS.", count: (r, w) => r.DeliveryRecord.filter((d) => inW(d.deliveredAt, w) && CSECTION.test(str(d.mode))).length },
  "3.1.1.": { needs: ["DeliveryRecord"], source: "Caesarean deliveries dated in the month, 8 PM to 8 AM hospital time.", count: (r, w) => r.DeliveryRecord.filter((d) => inW(d.deliveredAt, w) && night(d.deliveredAt, w) && CSECTION.test(str(d.mode))).length },
  "9.1.2.": { needs: ["Immunization", "Patient"], source: "BCG doses given in the month to infants under 12 months old.", note: "Matched by the vaccine name BCG; an infant with no recorded date of birth is not counted.",
    count: (r, w) => { const pat = new Map(r.Patient.map((p) => [str(p.id), ms(p.dob)])); return r.Immunization.filter((x) => x.status === "completed" && inW(x.occurredOn, w) && /\bbcg\b/i.test(str(x.vaccine)) && pat.get(str(x.patientId)) != null && ms(x.occurredOn) - pat.get(str(x.patientId)) < 365.25 * DAY).length; } },
  "14.2.1.": { needs: ["Encounter"], source: "Outpatient visits opened in the month (WardSynQ records allopathic care); virtual visits are not counted.", count: (r, w) => r.Encounter.filter((e) => e.class === "OPD" && e.status !== "cancelled" && inW(e.periodStart, w)).length },
  ...bandsOf("14.3.1.", ["Encounter"], "Inpatient, maternity, paediatric and newborn stays that started in the month (ICU stays inside an admission are not counted again).", (r, w) => stays(r, w, admitted), (e) => e.periodStart),
  ...bandsOf("14.3.2.", ["Encounter"], "Inpatient, maternity, paediatric and newborn stays that ended in the month.", (r, w) => stays(r, w, discharged), (e) => e.periodEnd),
  ...bandsOf("14.3.4.", ["Encounter", "Patient"], "Stays (not newborn care, not the emergency department) that ended in the month with a recorded death or a death disposition.", (r, w) => stays(r, w, discharged).filter((e) => e.class !== "NICU").filter(diedStay(r)), (e) => e.periodEnd),
  "14.3.6.": { needs: ["Encounter"], source: "Day care stays that started in the month.", count: (r, w) => r.Encounter.filter((e) => e.class === "DAYCARE" && e.status !== "cancelled" && inW(e.periodStart, w)).length },
  "14.3.7.a": { needs: ["Encounter"], source: "Stays that ended in the month with a discharge disposition of left against medical advice.", note: "Matched by the words LAMA, DAMA or against medical advice in the disposition.", count: (r, w) => stays(r, w, discharged).filter((e) => LAMA.test(str(e.disposition))).length },
  "14.5.1.": { needs: ["Encounter"], source: "Emergency department visits opened in the month.", count: (r, w) => r.Encounter.filter((e) => e.class === "ED" && e.status !== "cancelled" && inW(e.periodStart, w)).length },
  "14.5.2.": { needs: ["Encounter"], source: "Emergency department visits opened 8 PM to 8 AM hospital time.", count: (r, w) => r.Encounter.filter((e) => e.class === "ED" && e.status !== "cancelled" && inW(e.periodStart, w) && night(e.periodStart, w)).length },
  "14.7.": { needs: ["Encounter", "Patient"], source: "Emergency department visits that ended in the month with a recorded death or a death disposition.", count: (r, w) => r.Encounter.filter((e) => e.class === "ED" && e.status === "finished" && inW(e.periodEnd, w)).filter(diedStay(r)).length },
  "15.1.1.": { needs: ["DiagnosticReport"], source: "Laboratory reports released in the month by this hospital.", note: "Counted per report, not per test within a report.",
    count: (r, w) => r.DiagnosticReport.filter((x) => x.category !== "imaging" && (x.status === "final" || x.status === "corrected") && inW(x.reportedAt, w) && !(x.meta && x.meta.source && x.meta.source.system && x.meta.source.system !== "wardsynq-native")).length },
  "15.6.1.a.i": imaging(/x-?ray|radiograph/i),
  "15.6.1.b.i": imaging(/ultraso|\busg\b|sonograph/i),
  "15.6.1.c.i": imaging(/\bct\b|computed tomograph/i),
  "15.6.1.d.i": imaging(/\bmri\b|magnetic resonance/i),
};

/** PURE. input: { rows, unreadable, window } -> item rows in format order. */
function computeHmis(input) {
  const rows = { ...Object.fromEntries(HMIS_TYPES.map((t) => [t, []])), ...(input.rows || {}) };
  const bad = input.unreadable || {};
  return HMIS_ITEMS.map((it) => {
    const f = HMIS_FILL[it.code];
    const row = { code: it.code, section: it.section, label: it.label, kind: it.kind || "number" };
    if (it.kind === "header") return { ...row, available: null };
    if (!f) return { ...row, available: false, value: null, reason: "Not available from WardSynQ data." };
    const blocked = f.needs.find((t) => bad[t]);
    if (blocked) return { ...row, available: false, value: null, reason: `${blocked} records could not be read (${bad[blocked]}).` };
    return { ...row, available: true, value: f.count(rows, input.window), source: f.source, ...(f.note ? { note: f.note } : {}) };
  });
}

/** ctx: { migration, month? (YYYY-MM), now?, utcOffsetMinutes?, actorDeps, recordDeps } */
async function hmisMonthly(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", items: [] };
  const want = str(ctx.month);
  if (want && !/^\d{4}-(0[1-9]|1[0-2])$/.test(want)) return { ...base, ok: false, status: 422, error: "month_invalid", items: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, items: null };
  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const windows = monthWindows(nowMs, 60, ctx.utcOffsetMinutes);
  const window = want ? windows.find((w) => w.month === want) : windows[windows.length - 1];
  if (!window) return { ...base, ok: false, status: 422, error: "month_out_of_range", detail: "a month in the last five years, not in the future", items: null };
  const { rows, unreadable, truncated } = await readTypes(svc, HMIS_TYPES);
  const items = computeHmis({ rows, unreadable, window });
  return {
    ...base, ok: true, month: window.month, format: HMIS_FORMAT, sections: HMIS_SECTIONS, items,
    filled: items.filter((i) => i.available === true).length, notAvailable: items.filter((i) => i.available === false).length,
    truncated, ...(truncated ? { truncatedNote: `At least one record type has more than ${READ_LIMIT} records; counts may be incomplete.` } : {}),
    note: "Items WardSynQ's record supports are filled from it. Every other item is marked not available and must be filled from the hospital's own registers before the return is submitted.",
  };
}

/** PURE. The HMIS return as CSV, one row per item. */
function hmisCsv(report) {
  const secTitle = new Map((report.sections || []).map((s) => [s.code, s.title]));
  return csvRows([
    [`HMIS monthly return, ${report.format && report.format.title ? report.format.title : "Other Secondary Care Facility, Pvt"}, ${report.month}`],
    [report.note],
    ["Section", "Item", "Description", "Value", "Filled from WardSynQ", "Source or reason"],
    ...report.items.map((i) => [secTitle.get(i.section) || i.section, i.code, i.label, i.available ? i.value : "", i.available === true ? "yes" : i.available === false ? "no" : "", i.available ? [i.source, i.note].filter(Boolean).join(" ") : i.reason || ""]),
  ]);
}

/* ================================================================== DHS self-assessment */

const DHS_TYPE = "DhsAssessment", DHS_ID = "wsq-dhs-assessment";
const DHS_STATUSES = Object.freeze(["met", "partly-met", "not-met", "not-applicable"]);
const DHS_NOTE = "This is the hospital's own self-assessment against the NABH Digital Health Standards, 2nd edition (September 2025). It is not an assessment by NABH and does not certify or accredit anything.";

/** PURE. The elements with the hospital's entries on them, and the counts. */
function dhsView(assessment) {
  const entries = (assessment && assessment.entries) || {};
  const elements = DHS_ELEMENTS.map((e) => ({ ...e, ...(entries[e.code] ? { status: entries[e.code].status, evidence: entries[e.code].evidence, note: entries[e.code].note, updatedAt: entries[e.code].updatedAt, updatedBy: entries[e.code].updatedBy } : { status: null, evidence: null, note: null }) }));
  const counts = Object.fromEntries([...DHS_STATUSES, "not-assessed"].map((s) => [s, 0]));
  for (const e of elements) counts[e.status || "not-assessed"]++;
  return { chapters: DHS_CHAPTERS, elements, counts, total: elements.length };
}

/** ctx: { migration, actorDeps, recordDeps } */
async function dhsChecklist(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", elements: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, elements: null };
  let a;
  try { a = await svc.get(DHS_TYPE, DHS_ID); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", elements: null }; }
  return { ...base, ok: true, selfAssessment: true, note: DHS_NOTE, version: a ? a.version : 0, ...dhsView(a) };
}

/** ctx: { migration, entries: [{code, status, evidence, note}], expectedVersion, actorDeps, recordDeps } */
async function saveDhsAssessment(request, env, ctx) {
  const base = baseOf(ctx);
  if (!ctx.migration || ctx.migration.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const list = Array.isArray(ctx.entries) ? ctx.entries.slice(0, 200) : [];
  if (!list.length) return { ...base, ok: false, status: 422, error: "entries_required", written: 0 };
  const codes = new Set(DHS_ELEMENTS.map((e) => e.code));
  for (const x of list) {
    if (!x || !codes.has(str(x.code))) return { ...base, ok: false, status: 422, error: "unknown_element", written: 0 };
    if (x.status != null && x.status !== "" && !DHS_STATUSES.includes(x.status)) return { ...base, ok: false, status: 422, error: "unknown_status", written: 0 };
    if ((x.status === "met" || x.status === "partly-met") && !str(x.evidence)) return { ...base, ok: false, status: 422, error: "evidence_required", code: str(x.code), detail: "say what shows this element is met", written: 0 };
  }
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(DHS_TYPE, DHS_ID); } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  /* Two administrators editing at once must not silently overwrite each other: the screen sends the version it read. */
  if (Number(ctx.expectedVersion || 0) !== (current ? current.version : 0)) return { ...base, ok: false, status: 409, error: "version_conflict", detail: "Someone else saved this checklist since you opened it. Reload it and make your change again.", written: 0 };
  const now = new Date().toISOString();
  const entries = { ...((current && current.entries) || {}) };
  for (const x of list) {
    const code = str(x.code);
    if (!x.status) delete entries[code];
    else entries[code] = { status: x.status, evidence: str(x.evidence).slice(0, 2000) || null, note: str(x.note).slice(0, 2000) || null, updatedAt: now, updatedBy: resolved.actor.id };
  }
  const rec = { resourceType: DHS_TYPE, id: DHS_ID, standard: "NABH Digital Health Standards, 2nd edition (September 2025)", selfAssessment: true, entries, source: { system: "wardsynq-native", sourceId: "dhs-self-assessment" } };
  try {
    const out = await svc.put(rec, { expectedVersion: current ? current.version : undefined });
    return { ...base, ok: true, written: 1, selfAssessment: true, note: DHS_NOTE, version: out.record.version, ...dhsView(rec) };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", written: 0 };
  }
}

export {
  READ_LIMIT, monthWindows, NABH_SOURCES, computeNabhIndicators, nabhIndicators, nabhCsv, csvCell, csvRows, NABH_FORMAT_NOTE,
  HMIS_FILL, computeHmis, hmisMonthly, hmisCsv, DHS_STATUSES, DHS_NOTE, dhsView, dhsChecklist, saveDhsAssessment,
};
