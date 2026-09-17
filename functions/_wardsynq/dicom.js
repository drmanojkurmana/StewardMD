/* functions/_wardsynq/dicom.js — TASK 7.7: the imaging boundary, WardSynQ's side of it.
 *
 * TWO DIRECTIONS, AND ONE OF THEM DELIBERATELY DOES NOT EXIST.
 *
 *   IN: study metadata. A PACS/VNA that speaks DICOMweb QIDO-RS is read by the connector in
 *   functions/_connect/connectors/dicomweb/, normalised to SCCM, and landed as an ImagingStudy
 *   through the SAME adapter and the SAME governed pipeline as everything else
 *   (wardsynq/adapters/wardsynq-sccm-adapter.js). Until now those studies were counted and DROPPED;
 *   they now land, and each one is matched to the imaging ORDER it answers by accession number.
 *
 *   OUT: the worklist. This file. A modality asks "what am I scanning today", and the answer is
 *   built from this hospital's own imaging orders - as DICOM-JSON, the attribute shape a DICOMweb
 *   client parses.
 *
 * WHAT IS NOT HERE, AND WHY IT IS NOT A GAP TO BE FILLED LATER WITH A STUB.
 *
 *   WADO-RS retrieval. Pixel data is not fetched, proxied, cached or stored anywhere in WardSynQ.
 *   This runs on Pages Functions with no object storage, and a field holding a retrieve URL becomes
 *   the path every viewer, cache and log copies a patient's images through. The accession number and
 *   StudyInstanceUID on the ImagingStudy row are what a radiologist opens the study with, in the
 *   PACS viewer they already have and which already authenticates them. There is no code here that
 *   could be pointed at pixel data by mistake.
 *
 *   STOW-RS storing. WardSynQ does not author images, so it has nothing to store into a PACS. A
 *   STOW-RS client here would exist only to make a matrix say yes.
 *
 *   DIMSE C-FIND Modality Worklist. MWL is a TCP protocol, and Pages Functions has no TCP - the same
 *   reason hl7-inbound.js says plainly that MLLP does not exist here. The worklist below is its
 *   DICOMweb-shaped equivalent over HTTPS; a site that needs true C-FIND puts a broker in front of
 *   it, exactly as it does for MLLP.
 *
 * MODALITY IS NEVER GUESSED. An imaging order carries a code ("CT abdomen", or a local code from an
 * order catalogue); DICOM wants a modality (CT, MR, CR, US). Deriving one from words in a code is
 * how a chest radiograph ends up on an MRI worklist. A hospital MAPS its own order codes under
 * wardsynq.dicom.modalityMap, and an order whose code is not in that map appears on the worklist
 * WITHOUT a modality and is counted in `unmapped`, so the gap is visible rather than invented.
 *
 * WHO MAY ASK FOR THE WORKLIST. emr.view, because a worklist item is patient demographics beside a
 * requested procedure and that is precisely what emr.view already reads. The radiology capability
 * (lab.result) would have looked stricter and been broken: the laboratory grant deliberately cannot
 * read Patient at all - "and never reads the chart" is pinned in the role-mapping test - and a
 * worklist with no identity on it is worse than none. Widening that grant to make this feature work
 * would have overturned a considered boundary for convenience, so it was not done; an actor who
 * cannot read a patient simply gets that order skipped and COUNTED, never an item half-filled.
 *
 * STATUS: IMPLEMENTED and TESTED against a deterministic DICOMweb server this repo starts in-test.
 * NOT verified against any real PACS or VNA - none exists in this environment, and none is claimed.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { zoneOffsetAt } from "./mar-schedule.js";
import { reportIdFor as radiologyReportIdFor } from "./radiology-report.js";
import { effectiveCategory } from "./investigation-catalogue.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** DICOM defined terms for Modality (PS3.3 C.7.3.1.1.1), as far as a general hospital uses them.
 *  A configured map may only name one of these: a "modality" the standard does not define would be
 *  rejected by the modality itself, so it is refused here where somebody can still fix it. */
const MODALITIES = Object.freeze(["CR", "CT", "MR", "US", "XA", "NM", "PT", "RF", "DX", "MG", "PX", "IO", "OP", "ES", "EC", "SM", "OT"]);

/** PURE. A YYYY-MM-DD... instant into DICOM DA (YYYYMMDD) and TM (HHMMSS), or nulls.
 *
 * LT-27: DA and TM are the INSTITUTION'S LOCAL wall clock (PS3.5), and this copied the UTC digits out of the ISO
 * string, so every study read 5 h 30 min early on an Indian worklist. With `clock` ({offsetMinutes, timeZone}, the
 * hospital's own, as the MAR uses) an instant with a time is shifted to that wall clock, and `offset` carries
 * TimezoneOffsetFromUTC ("+0530") so a reader never has to guess. A date alone (a date of birth) is never shifted. */
function dicomDateTime(iso, clock) {
  const s = str(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return { date: null, time: null };
  const at = Date.parse(s);
  if (!clock || !m[4] || !Number.isFinite(at)) return { date: `${m[1]}${m[2]}${m[3]}`, time: m[4] ? `${m[4]}${m[5]}${m[6]}` : null };
  const zone = str(clock.timeZone) ? zoneOffsetAt(str(clock.timeZone), at) : null;
  const off = Number.isFinite(zone) ? zone : Number.isFinite(clock.offsetMinutes) ? clock.offsetMinutes : 330;
  const w = new Date(at + off * 60000).toISOString();
  const abs = Math.abs(off), pad = (n) => String(n).padStart(2, "0");
  return { date: w.slice(0, 4) + w.slice(5, 7) + w.slice(8, 10), time: w.slice(11, 13) + w.slice(14, 16) + w.slice(17, 19),
    offset: `${off < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}${pad(abs % 60)}` };
}

/** PURE. A WardSynQ name into DICOM PN (Family^Given), which is the one reordering DICOM requires. */
function dicomName(name) {
  const n = str(name);
  if (!n) return null;
  const parts = n.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[parts.length - 1]}^${parts.slice(0, -1).join(" ")}`;
}

const SEX = Object.freeze({ male: "M", female: "F", other: "O", unknown: "" });

const tag = (vr, value) => (value == null || value === "" ? undefined : { vr, Value: [value] });

/**
 * PURE. One imaging order as a DICOM-JSON worklist item.
 *
 * The accession number IS the order's id: it is the number the study will come back quoting, and
 * matching them is the whole reason the linkage in the SCCM adapter works. A study whose accession
 * this hospital did not issue simply will not match, which is correct.
 *
 * ScheduledProcedureStepStartDate is the date the order was AUTHORED, because that is the only time
 * a WardSynQ imaging order carries - it has no appointment slot. That is stated rather than dressed
 * up as a schedule this system does not keep.
 */
function worklistItem(order, patient, modality, clock) {
  const when = dicomDateTime((order.meta && order.meta.effectiveAt) || order.authoredAt || null, clock);
  const item = {
    "00080201": tag("SH", when.offset || null),                                     // TimezoneOffsetFromUTC
    "00100010": tag("PN", dicomName(patient && patient.name)),                      // PatientName
    "00100020": tag("LO", str(patient && patient.mrn) || null),                     // PatientID
    "00100030": tag("DA", dicomDateTime(patient && patient.dob).date),              // PatientBirthDate
    "00100040": tag("CS", SEX[str(patient && patient.sex)] || null),                // PatientSex
    "00080050": tag("SH", str(order.id)),                                           // AccessionNumber
    "00321060": tag("LO", str(order.display) || str(order.code)),                   // RequestedProcedureDescription
    "00401001": tag("SH", str(order.id)),                                           // RequestedProcedureID
    "00400100": {                                                                    // ScheduledProcedureStepSequence
      vr: "SQ",
      Value: [{
        "00080060": tag("CS", modality || null),                                    // Modality
        "00400002": tag("DA", when.date),                                           // ScheduledProcedureStepStartDate
        "00400003": tag("TM", when.time),                                           // ScheduledProcedureStepStartTime
        "00400007": tag("LO", str(order.display) || str(order.code)),               // ScheduledProcedureStepDescription
        "00400009": tag("SH", str(order.id)),                                       // ScheduledProcedureStepID
      }].map((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined))),
    },
  };
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
}

/** PURE. The hospital's own order-code to modality map, with anything the standard does not define refused. */
function modalityMapOf(config) {
  const raw = (config && config.modalityMap && typeof config.modalityMap === "object") ? config.modalityMap : {};
  const out = {}, rejected = [];
  for (const [code, mod] of Object.entries(raw)) {
    const m = str(mod).toUpperCase();
    if (MODALITIES.includes(m)) out[str(code).toLowerCase()] = m;
    else rejected.push(`${code} -> ${mod}`);
  }
  return { map: out, rejected };
}

/** PURE. Is this order one a modality should see: an imaging request that is still to be done. */
function isPendingImaging(o) {
  // LT-15: a catalogued imaging test filed as laboratory (the demo's "CXR") is on the radiology worklist too.
  if (!o || o.resourceType !== "ServiceRequest" || effectiveCategory(o) !== "imaging") return false;
  // An imported order carries the sender's own status; a native one carries ours. Either way a
  // cancelled or completed order is not on anybody's worklist.
  const status = str(o.externalStatus) || str(o.status);
  return ["draft", "active", "on-hold", "scheduled"].includes(status);
}

/**
 * The worklist. ctx: { migration, config (wardsynq.dicom), patientId?, actorDeps, recordDeps }
 *
 * Read through the caller's OWN governed read, so the worklist contains exactly the orders that
 * caller could already see - it is not a second door into the chart with its own rules.
 */
async function imagingWorklist(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", worklist: [] };

  let svc;
  try {
    const resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
    svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message), worklist: [] };
  }

  const { map, rejected } = modalityMapOf(ctx.config);
  let orders;
  try {
    orders = str(ctx.patientId)
      ? await svc.byPatient("ServiceRequest", str(ctx.patientId))
      : await svc.list("ServiceRequest", 500);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), worklist: [] }; }

  /* LT-27: A REPORTED STUDY IS NOT STILL TO BE DONE. reportImaging() never changes the order's status, so a study
   * with a final report stayed on the worklist with File Report beside it and could be reported twice. A final or
   * corrected radiology report (one per order, radiology-report.js reportIdFor) takes it off; a preliminary one
   * leaves it on, because the final reading is still owed. If the reports cannot be read the list is kept whole
   * and says so, never trimmed on a guess. */
  let reported = new Set(), warnings = [];
  const wanted = (orders || []).filter(isPendingImaging);
  try {
    const reports = await Promise.all(wanted.map((o) => svc.get("DiagnosticReport", radiologyReportIdFor(o.id))));
    reported = new Set(reports.filter((r) => r && (r.status === "final" || r.status === "corrected")).map((r) => r.serviceRequestId));
  } catch { warnings = ["Radiology reports could not be read, so a study listed here may already be reported."]; }
  const pending = wanted.filter((o) => !reported.has(o.id));
  const patients = new Map();
  const worklist = [];
  const unmapped = [];
  const pcpndt = [];
  for (const o of pending) {
    let p = patients.get(o.patientId);
    if (p === undefined) {
      try { p = await svc.get("Patient", o.patientId); } catch { p = null; }
      patients.set(o.patientId, p);
    }
    // No patient, no worklist entry: a modality item with no identity is how the wrong study gets
    // attached to the wrong person. It is skipped and counted, never emitted half-filled.
    if (!p) { unmapped.push({ order: o.id, reason: "the patient is not readable by this caller" }); continue; }
    const modality = map[str(o.code).toLowerCase()] || map[str(o.display).toLowerCase()] || null;
    if (!modality) unmapped.push({ order: o.id, reason: `no modality is mapped for "${str(o.code)}"; the item is on the worklist without one` });
    worklist.push(worklistItem(o, p, modality, ctx.clock || null));
    /* PCPNDT (legal review B.4.1, B.4.3): an obstetric ultrasound still to be done whose Form F is missing or incomplete is
     * flagged beside the worklist, never inside the DICOM item a modality parses. The route hands in the check. */
    if (typeof ctx.pcpndtFlag === "function") { const flag = await ctx.pcpndtFlag(o, modality); if (flag) pcpndt.push({ orderId: o.id, ...flag }); }
  }

  return { ...base, ok: true, worklist, count: worklist.length, unmapped, reportedExcluded: reported.size, ...(typeof ctx.pcpndtFlag === "function" ? { pcpndt } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(rejected.length ? { configWarnings: [`these modalityMap entries name a modality DICOM does not define and were ignored: ${rejected.join(", ")}`] } : {}) };
}

export { MODALITIES, dicomDateTime, dicomName, worklistItem, modalityMapOf, isPendingImaging, imagingWorklist };
