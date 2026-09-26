/* functions/_wardsynq/hl7v2.js — ADT out, because HL7v2 is what the machines in the building speak.
 *
 * The FHIR door (fhir.js) is how a hospital's record reaches a national exchange or a successor
 * system. This is how it reaches the analyser in the side room, the PACS, the billing package and
 * the bed-management screen that were installed in 2011 and are not going anywhere. Both are
 * "interoperability" and only one of them is what an integration engineer will actually ask for.
 *
 * SAME RULE AS THE FHIR DOOR: NEVER INVENT A CODE SYSTEM, and never invent a value. A field the
 * record does not have is EMPTY. HL7v2 makes that easy to get wrong, because a receiving system will
 * happily accept "U" for a sex nobody recorded and store it as fact - so an unrecorded sex is an
 * empty PID-8, not "U", and an unparseable date of birth is an empty PID-7 rather than a plausible
 * one.
 *
 * ESCAPING IS THE CORRECTNESS PROPERTY HERE. HL7v2 is delimiter-separated with no quoting: a patient
 * whose name contains a pipe does not produce a slightly odd message, it produces a message whose
 * every subsequent field is shifted into the wrong position. The receiver does not error - it stores
 * the wrong data, silently, against the right patient. Every value that reaches a segment goes
 * through `esc()`, and the test asserts it for each delimiter.
 *
 * READ ONLY, AND NOT A LISTENER. This encodes what the record already says. There is no inbound
 * parser: accepting HL7v2 writes means accepting whatever a sender believes Z-segments mean, and
 * that is how a record fills with data nobody can interpret afterwards. WardSynQ's own doors stay
 * the write path.
 *
 * IT IS NOT CERTIFIED AND DOES NOT CLAIM TO BE. This is HL7 v2.5.1-shaped ADT. It has not been
 * validated against a conformance profile, and no hospital should point a live interface at it
 * without their integration engineer reading the output first.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v));

/** The encoding characters MSH-2 declares, and the ones esc() has to neutralise. */
const FIELD = "|", COMPONENT = "^", REPEAT = "~", ESCAPE = "\\", SUBCOMPONENT = "&";

/**
 * PURE. HL7 v2 escape sequences.
 *
 * The backslash MUST be replaced first. Doing it last would re-escape the backslashes that the other
 * four replacements had just introduced, turning `a|b` into `a\\F\\b` - which a receiver reads as a
 * literal backslash followed by the letter F, not as a pipe.
 */
function esc(value) {
  return str(value)
    .replace(/\\/g, "\\E\\")
    .replace(/\|/g, "\\F\\")
    .replace(/\^/g, "\\S\\")
    .replace(/~/g, "\\R\\")
    .replace(/&/g, "\\T\\")
    // A newline inside a field would end the SEGMENT, which is the same class of corruption as a
    // stray pipe and is easier to arrive at from free text.
    .replace(/\r?\n/g, " ");
}

/** PURE. YYYYMMDDHHMMSS, or "" when the instant is not one. Never a plausible-looking guess. */
function ts(iso) {
  const ms = Date.parse(str(iso));
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (n, w) => String(n).padStart(w || 2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** PURE. YYYYMMDD for a date of birth. A partial or unparseable date is EMPTY, never completed. */
function dt(value) {
  const s = str(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).replace(/-/g, "");
  if (/^\d{8}$/.test(s)) return s;
  /* A record holding only "1972" knows the year and not the day. Emitting 19720101 would invent a
   * birthday that a receiving system will then use to match patients. */
  return "";
}

/** PURE. HL7 administrative sex. An unrecorded sex is EMPTY - never "U", which asserts "unknown" as
 *  a recorded finding rather than saying nothing was recorded. */
function sex(value) {
  const s = str(value).trim().toLowerCase();
  if (s === "male" || s === "m") return "M";
  if (s === "female" || s === "f") return "F";
  if (s === "other" || s === "o") return "O";
  return "";
}

/** PURE. One segment from its fields. Trailing empties are dropped, as HL7 permits. */
function segment(name, fields) {
  const out = [name, ...(fields || []).map((f) => (f === null || f === undefined ? "" : String(f)))];
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out.join(FIELD);
}

/**
 * PURE. The event an encounter's state implies. Returned rather than taken from a caller, so a
 * message can never announce an admission for a stay that has ended.
 */
function eventOf(encounter) {
  const e = encounter || {};
  if (e.class !== "IPD") return null;
  if (e.status === "finished") return "A03";       // discharge
  if (e.status === "in-progress") return "A01";    // admit
  return null;
}

/**
 * PURE. An ADT message for one encounter, or null when the record cannot support one.
 *
 * input: { encounter, patient, event?, controlId, sendingApp?, sendingFacility?, receivingApp?,
 *          receivingFacility?, now }
 */
function adtMessage(input) {
  const i = input || {};
  const e = i.encounter, p = i.patient || {};
  if (!e || !e.id) return null;
  const event = str(i.event) || eventOf(e);
  // A17, A08 and the rest are real events this does not produce. Emitting a message typed as
  // something it is not is worse than emitting none.
  if (event !== "A01" && event !== "A03" && event !== "A02") return null;

  const when = ts(i.now) || ts(new Date().toISOString());
  const control = esc(i.controlId || `${e.id}-${event}`);

  const msh = segment("MSH", [
    // MSH-1 is the field separator itself and is already consumed by the join, so MSH-2 leads here.
    `${COMPONENT}${REPEAT}${ESCAPE}${SUBCOMPONENT}`,
    esc(i.sendingApp || "WardSynQ"), esc(i.sendingFacility || ""),
    esc(i.receivingApp || ""), esc(i.receivingFacility || ""),
    when, "", `ADT${COMPONENT}${event}${COMPONENT}ADT_${event === "A03" ? "A03" : "A01"}`,
    control, "P", "2.5.1",
  ]);

  const evn = segment("EVN", [event, when, "", "", "", ts(event === "A03" ? e.periodEnd : e.periodStart)]);

  /* PID-3 carries the MRN with its assigning authority, because an identifier with no authority is
   * the commonest way two hospitals' patients get merged downstream. */
  const pid = segment("PID", [
    "1", "",
    `${esc(p.mrn || p.id || e.patientId)}${COMPONENT}${COMPONENT}${COMPONENT}${esc(i.sendingFacility || "WardSynQ")}${COMPONENT}MR`,
    "",
    esc(p.name || ""),                              // XPN, unparsed: the record holds one name string
    "", dt(p.dob), sex(p.sex),
  ]);

  const loc = e.location || {};
  /* PV1-3 is point-of-care ^ room ^ bed. A ward with no bed recorded emits an empty bed component,
   * never the ward name repeated into it. */
  /* Built BY FIELD NUMBER rather than by counting empty strings. Counting them by eye put the visit
   * number in PV1-18, where a receiver reads it as the "prior patient location" - the exact class of
   * silent misplacement this file's escaping rules exist to prevent, arrived at from the other
   * direction. `at(n)` takes the HL7 field number, so each line says which field it is. */
  const pv1Fields = [];
  const at = (n, v) => { pv1Fields[n - 1] = v; };
  at(1, "1");
  at(2, "I");                                        // inpatient
  // PV1-3: point of care ^ room ^ bed. No room recorded is an empty component, never the ward again.
  at(3, `${esc(loc.ward || "")}${COMPONENT}${esc(loc.room || "")}${COMPONENT}${esc(loc.bed || "")}`);
  at(7, esc(e.attendingId || ""));                   // attending doctor
  at(19, esc(e.id));                                 // visit number
  at(44, ts(e.periodStart));                         // admit date/time
  at(45, ts(e.periodEnd));                           // discharge date/time
  const pv1 = segment("PV1", Array.from(pv1Fields, (v) => v || ""));

  // CR is the real segment terminator. A receiver splitting on LF alone is a receiver that will
  // break on the first message from anything else, so this emits what the standard says.
  return [msh, evn, pid, pv1].join("\r");
}

/* ---- ORU^R01: the result, going out -------------------------------------------------------------
 *
 * ADT tells the other systems who is here. ORU tells them what came back, and it is the message an
 * Indian hospital's billing package, its analyser middleware and its referring clinics all actually
 * consume. Same rules as everything else in this file: every value escaped, nothing invented.
 *
 * A NON-NUMERIC RESULT IS SENT AS TEXT, WITH ITS TYPE SAID. "No growth at 48h" is a real laboratory
 * answer and OBX-2 has a value type field for exactly this ("ST" rather than "NM"). Sending it as
 * numeric would have the receiver parse it to zero or to nothing, and either way a culture that grew
 * something would arrive as a number nobody wrote.
 *
 * ABNORMAL FLAGS ARE THE LABORATORY'S, NEVER COMPUTED HERE. OBX-8 carries what the lab reported and
 * nothing else. Deriving "H" by comparing the value to the reference range would be this file
 * interpreting a result, which fhir.js does not do either and for the same reason.
 */

/** PURE. The HL7 value type for one observation. NM for a number, ST for anything else. */
function valueType(value) { return typeof value === "number" && Number.isFinite(value) ? "NM" : "ST"; }

/** PURE. OBX-11, the observation result status. A corrected result says so, in the field for it. */
function obxStatus(reportStatus) {
  const s = str(reportStatus).toLowerCase();
  if (s === "preliminary") return "P";
  if (s === "corrected") return "C";
  return "F";
}

/**
 * PURE. An ORU^R01 for one report, or null when there is nothing to send.
 *
 * input: { report, observations, patient, encounter?, controlId, sendingApp?, sendingFacility?, now }
 */
function oruMessage(input) {
  const i = input || {};
  const report = i.report, rows = Array.isArray(i.observations) ? i.observations.filter(Boolean) : [];
  if (!report || !report.id || !rows.length) return null;
  const p = i.patient || {};
  const e = i.encounter || null;

  const when = ts(i.now) || ts(new Date().toISOString());
  const msh = segment("MSH", [
    `${COMPONENT}${REPEAT}${ESCAPE}${SUBCOMPONENT}`,
    esc(i.sendingApp || "WardSynQ"), esc(i.sendingFacility || ""),
    esc(i.receivingApp || ""), esc(i.receivingFacility || ""),
    when, "", `ORU${COMPONENT}R01${COMPONENT}ORU_R01`,
    esc(i.controlId || report.id), "P", "2.5.1",
  ]);

  const pid = segment("PID", [
    "1", "",
    `${esc(p.mrn || p.id || report.patientId)}${COMPONENT}${COMPONENT}${COMPONENT}${esc(i.sendingFacility || "WardSynQ")}${COMPONENT}MR`,
    "", esc(p.name || ""), "", dt(p.dob), sex(p.sex),
  ]);

  const segments = [msh, pid];
  if (e && e.id) {
    const loc = e.location || {};
    const pv1 = [];
    const at = (n, v) => { pv1[n - 1] = v; };
    at(1, "1");
    at(2, e.class === "IPD" ? "I" : "O");
    at(3, `${esc(loc.ward || "")}${COMPONENT}${esc(loc.room || "")}${COMPONENT}${esc(loc.bed || "")}`);
    at(19, esc(e.id));
    segments.push(segment("PV1", Array.from(pv1, (v) => v || "")));
  }

  /* OBR-4 is the panel that was ordered; OBR-3 the filler's own number for it, which is what a
   * receiver quotes back when it asks about a result. */
  segments.push(segment("OBR", [
    "1", esc(report.serviceRequestId || ""), esc(report.id),
    esc(report.code || "Laboratory result"),
    "", "", ts(report.reportedAt), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
    ts(report.reportedAt), "", obxStatus(report.status),
  ]));

  rows.forEach((o, idx) => {
    const range = o.referenceRange || null;
    // As REPORTED. A range this file composed would be this file deciding what is normal.
    const rangeText = range ? (str(range.text) || [range.low, range.high].filter((v) => v !== null && v !== undefined).join("-")) : "";
    segments.push(segment("OBX", [
      String(idx + 1),
      valueType(o.value),
      // The code, its system, and the display - all as the record holds them. A local code stays a
      // local code; nothing here promotes one to LOINC.
      `${esc(o.code)}${COMPONENT}${esc(o.display || o.code)}${COMPONENT}${esc(o.codeSystem || "")}`,
      "",
      esc(o.value === null || o.value === undefined ? "" : o.value),
      esc(o.unit || ""),
      esc(rangeText),
      /* OBX-8, the abnormal flag. The LABORATORY's, never computed here: deriving "H" from the range
       * would be this file interpreting a result. */
      o.sourceCritical === true ? "AA" : "",
      "", "", obxStatus(report.status),
      "", "", "", "",
      ts((o.meta && o.meta.effectiveAt) || o.effectiveAt || report.reportedAt),
    ]));
  });

  if (str(report.conclusion)) {
    // The laboratory's own words, in the segment for them. Never composed.
    segments.push(segment("NTE", ["1", "L", esc(report.conclusion)]));
  }
  return segments.join("\r");
}

/* ---- the door ------------------------------------------------------------------------------------
 *
 * READ ONLY. It renders what the record already says. There is no inbound parser and no listener.
 */

async function open(request, env, ctx, need) {
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

/** ctx: { migration, encounterId, event?, sendingFacility?, actorDeps, recordDeps } */
async function adtForEncounter(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", message: null };

  const encounterId = str(ctx.encounterId).trim();
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", message: null };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, message: null };

  let encounter, patient;
  try {
    encounter = await svc.get("Encounter", encounterId);
    patient = encounter ? await svc.get("Patient", encounter.patientId).catch(() => null) : null;
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), message: null }; }
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, message: null };

  const event = str(ctx.event) || eventOf(encounter);
  const message = adtMessage({
    encounter, patient, event,
    controlId: `${encounterId}-${event || "none"}`,
    sendingFacility: str(ctx.sendingFacility) || "",
    now: new Date().toISOString(),
  });
  if (!message) {
    /* Named rather than returned as an empty string. "This stay is not one ADT describes" is
     * actionable; a blank body is a bug report. */
    return {
      ...base, ok: false, status: 409, error: "no_adt_event",
      detail: `an ADT admit or discharge message needs an inpatient stay that is open or finished; this encounter is ${encounter.class}/${encounter.status}`,
      encounterId, message: null,
    };
  }
  return {
    ...base, ok: true, encounterId, event, message,
    /* Said on every response. Shaped is not conformant, and an integration engineer should read the
     * output before anything live is pointed at it. */
    note: "HL7 v2.5.1-shaped ADT, generated from the record. Not validated against a conformance profile and not certified.",
    actor: resolved.actor.id,
  };
}

/** ctx: { migration, reportId, sendingFacility?, actorDeps, recordDeps } */
async function oruForReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", message: null };

  const reportId = str(ctx.reportId).trim();
  if (!reportId) return { ...base, ok: false, status: 422, error: "report_required", message: null };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, message: null };

  let report, observations, patient, encounter;
  try {
    report = await svc.get("DiagnosticReport", reportId);
    if (report) {
      [observations, patient, encounter] = await Promise.all([
        svc.byPatient("Observation", report.patientId).catch(() => []),
        svc.get("Patient", report.patientId).catch(() => null),
        report.encounterId ? svc.get("Encounter", report.encounterId).catch(() => null) : Promise.resolve(null),
      ]);
    }
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), message: null }; }
  if (!report) return { ...base, ok: false, status: 404, error: "report_not_found", reportId, message: null };

  /* Only the observations THIS report released. A patient's whole Observation history in one ORU
   * would send a receiver every result the hospital has ever produced, every time. */
  const wanted = new Set((report.resultObservationIds || []).map(str));
  const rows = (observations || []).filter((o) => o && wanted.has(str(o.id)));

  const message = oruMessage({
    report, observations: rows, patient, encounter,
    controlId: reportId, sendingFacility: str(ctx.sendingFacility) || "", now: new Date().toISOString(),
  });
  if (!message) {
    return { ...base, ok: false, status: 409, error: "nothing_to_send", detail: "this report released no observations that are still on the record", reportId, message: null };
  }
  return {
    ...base, ok: true, reportId, observations: rows.length, message,
    note: "HL7 v2.5.1-shaped ORU^R01, generated from the record. Not validated against a conformance profile and not certified.",
    actor: resolved.actor.id,
  };
}

export { esc, ts, dt, sex, segment, eventOf, adtMessage, adtForEncounter, valueType, obxStatus, oruMessage, oruForReport };
