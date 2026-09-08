/* functions/_wardsynq/hl7-normalize.js - HL7 v2 (ADT, ORU) into an SCCM 1.1 bundle. PURE.
 *
 * The normaliser beside functions/_connect/connectors/fhir-r4/normalize.js, for the other wire.
 * It is the ONLY place that knows what a PID or an OBX is; everything after it - the adapter, the
 * identity reconciliation, the ownership rules, the exception queue, the provenance, the
 * idempotency - is the same code a FHIR Bundle lands through. An HL7 listener that wrote what it
 * parsed would be a second clinical model with a pipe symbol in it.
 *
 * WHAT IT NEVER DOES. It never invents a code system: an OBX-3 coded LN is LOINC, SCT is SNOMED,
 * anything else is kept under the sender's own table name and the terminology service marks it. It
 * never recomputes an abnormal flag (OBX-8 is carried as the laboratory's interpretation). It never
 * maps the sender's bed to one of ours. It never interprets a Z-segment: they are returned verbatim
 * beside the bundle so the exception a held message raises keeps them, and nothing reads them. It
 * never fabricates a date, a sex or a name: absent stays absent and the adapter says so.
 *
 * IDENTIFIERS ARE THE WHOLE POINT. PID-3 repetitions are carried as identifiers with their assigning
 * authority (CX.4) and type (CX.5), which is what the identity reconciliation matches on; PV1-19
 * is the visit's own number. Connect's own HL7 normaliser hashes ids for its context; this one
 * carries the sender's real ids, because a record nobody can attribute cannot be reconciled later.
 */

import { seg, segs, field, comp, rep, decodeEsc } from "../_connect/connectors/hl7v2/parser.js";
import { coding, codeable, quantity } from "../_connect/canonical/coding.js";
import { bundle, patient, encounter, condition, allergyIntolerance, observation, diagnosticReport, serviceRequest } from "../_connect/canonical/model.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** HL7 table 0396 names this server recognises as published vocabularies. Everything else is the sender's own table. */
const CODING_SYSTEMS = Object.freeze({ LN: "http://loinc.org", SCT: "http://snomed.info/sct", SNM: "http://snomed.info/sct", I10: "http://hl7.org/fhir/sid/icd-10", ICD10: "http://hl7.org/fhir/sid/icd-10", "I10P": "http://hl7.org/fhir/sid/icd-10-cm", RXNORM: "http://www.nlm.nih.gov/research/umls/rxnorm", ATC: "http://www.whocc.no/atc", UCUM: "http://unitsofmeasure.org" });

/** PURE. An HL7 TS/DTM (YYYYMMDD[HHMM[SS]][+ZZZZ]) into ISO 8601, or null. Never a default. */
function hl7Date(v) {
  const s = str(v);
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?([+-]\d{4})?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, tz] = m;
  if (!mo) return y;
  if (!d) return `${y}-${mo}`;
  if (!h) return `${y}-${mo}-${d}`;
  const zone = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "Z";
  return `${y}-${mo}-${d}T${h}:${mi || "00"}:${se || "00"}${zone}`;
}

/** PURE. A CE/CWE field into an SCCM codeable concept; the sender's table name is kept when unknown. */
function ccFrom(sg, n, enc, fallback) {
  const code = str(comp(sg, n, 0, enc)), text = decodeEsc(str(comp(sg, n, 1, enc)), enc), table = str(comp(sg, n, 2, enc));
  const system = CODING_SYSTEMS[table.toUpperCase()] || (table || null);
  if (!code && !text) return fallback ? codeable({ text: fallback }) : null;
  const kind = CODING_SYSTEMS[table.toUpperCase()] ? "standard" : "local";
  return codeable({ coding: code ? [coding({ system, code, display: text || null, kind })] : [], text: text || code || fallback || "unknown" });
}

/** PURE. PID-3 repetitions as identifiers: value, assigning authority (CX.4), type (CX.5). */
function identifiersFrom(pid, enc) {
  const raw = field(pid, 3);
  if (!raw) return [];
  const out = [];
  for (let r = 0; ; r++) {
    const v = rep(pid, 3, r, enc);
    if (v == null) break;
    const value = str(comp(pid, 3, 0, enc, r));
    if (!value) continue;
    const authority = str(comp(pid, 3, 3, enc, r)).split(enc.sub || "&")[0] || null;
    const type = str(comp(pid, 3, 4, enc, r)) || null;
    out.push({ system: authority, type, value });
  }
  return out;
}

const SEX = Object.freeze({ M: "male", F: "female", O: "other", U: "unknown", A: "other", N: "unknown" });
const PV1_CLASS = Object.freeze({ I: "IPD", O: "OPD", E: "ED", P: "OPD", R: "OPD", B: "OPD", C: "OPD", N: "OPD", U: "IPD" });
const OBR_STATUS = Object.freeze({ F: "final", P: "preliminary", C: "corrected", X: "cancelled", A: "preliminary", R: "preliminary", I: "preliminary", S: "preliminary" });
const OBX_STATUS = Object.freeze({ F: "final", P: "preliminary", C: "corrected", X: "cancelled", I: "preliminary", R: "preliminary", S: "preliminary", W: "entered-in-error", D: "entered-in-error" });

/**
 * PURE. The message as an SCCM 1.1 bundle plus what could not go in it.
 * Returns { sccm, kind: {type, event, controlId, version, sendingApp, sendingFacility, at}, zSegments, warnings }
 */
function hl7ToSccm(msg, opts) {
  const o = opts || {};
  const enc = msg.encoding;
  const warnings = [...(msg.warnings || [])];
  const msh = seg(msg, "MSH");
  const kind = {
    type: str(comp(msh, 9, 0, enc)).toUpperCase(), event: str(comp(msh, 9, 1, enc)).toUpperCase(), controlId: str(field(msh, 10)),
    version: str(field(msh, 12)), sendingApp: decodeEsc(str(field(msh, 3)), enc), sendingFacility: decodeEsc(str(field(msh, 4)), enc), at: hl7Date(field(msh, 7)),
    processingId: str(field(msh, 11)),
  };

  /* Z-segments: kept whole, never read. A hospital's Z-segments are its own business and the one
   * thing a generic normaliser must not guess at. */
  const zSegments = (msg.segments || []).filter((s) => /^Z/i.test(s.id)).map((s) => ({ id: s.id, raw: s.fields.join(enc.field) }));

  const pid = seg(msg, "PID");
  const identifiers = pid ? identifiersFrom(pid, enc) : [];
  const primary = identifiers[0] ? identifiers[0].value : "";
  const family = pid ? decodeEsc(str(comp(pid, 5, 0, enc)), enc) : "", given = pid ? decodeEsc(str(comp(pid, 5, 1, enc)), enc) : "";
  const name = pid && (family || given) ? { text: [given, family].filter(Boolean).join(" "), given: given ? [given] : [], family: family || null } : null;
  const p = pid ? patient({ id: primary || `msg-${kind.controlId || "unknown"}`, identifiers, name, gender: SEX[str(field(pid, 8)).toUpperCase()] || "unknown", birthDate: hl7Date(field(pid, 7)), deceased: str(field(pid, 30)).toUpperCase() === "Y" ? true : null }) : null;
  if (!pid) warnings.push("no PID segment");
  else if (!primary) warnings.push("PID-3 carries no identifier");

  const out = bundle({ tenantId: o.tenantId || null, sourceConnector: o.sourceConnector || "hl7v2", generatedAt: o.now || null, patient: p, warnings,
    provenance: [{ resource: "MSH", sourceConnector: o.sourceConnector || "hl7v2", sourceId: `MSH/${kind.controlId}` }] });

  const pv1 = seg(msg, "PV1");
  const visitId = pv1 ? str(comp(pv1, 19, 0, enc)) : "";
  const encId = visitId || (pv1 ? `visit-${kind.controlId}` : "");
  if (pv1) {
    const cls = PV1_CLASS[str(field(pv1, 2)).toUpperCase()] || null;
    if (!cls) warnings.push(`PV1-2 patient class "${str(field(pv1, 2))}" is not a class this server knows; the adapter records IPD and says so`);
    const admit = hl7Date(field(pv1, 44)), discharge = hl7Date(field(pv1, 45));
    const status = kind.event === "A03" || discharge ? "finished" : kind.event === "A11" ? "cancelled" : "in-progress";
    const loc = { facility: decodeEsc(str(comp(pv1, 3, 3, enc)), enc) || null, ward: decodeEsc(str(comp(pv1, 3, 0, enc)), enc) || null, bed: [decodeEsc(str(comp(pv1, 3, 1, enc)), enc), decodeEsc(str(comp(pv1, 3, 2, enc)), enc)].filter(Boolean).join("-") || null };
    out.encounters.push(encounter({
      id: encId, status, class: cls, period: admit || discharge ? { start: admit, end: discharge } : null,
      reason: pv1 && str(field(pv1, 4)) ? decodeEsc(str(field(pv1, 4)), enc) : null,
      location: loc.ward || loc.bed ? loc : null,
      identifiers: visitId ? [{ system: str(comp(pv1, 19, 3, enc)).split(enc.sub || "&")[0] || "visit-number", type: "VN", value: visitId }] : [],
    }));
  }
  const encRef = encId ? { type: "Encounter", id: encId } : null;

  for (const s of segs(msg, "DG1")) {
    const cc = ccFrom(s, 3, enc, null) || (str(field(s, 4)) ? codeable({ text: decodeEsc(str(field(s, 4)), enc) }) : null);
    if (!cc) { warnings.push(`DG1 ${str(field(s, 1))} carries no diagnosis`); continue; }
    out.conditions.push(condition({ id: `dg1-${str(field(s, 1)) || out.conditions.length + 1}-${kind.controlId}`, code: cc, clinicalStatus: "active", onset: hl7Date(field(s, 5)), encounter: encRef }));
  }
  for (const s of segs(msg, "AL1")) {
    const cc = ccFrom(s, 3, enc, null);
    if (!cc) { warnings.push(`AL1 ${str(field(s, 1))} names no allergen`); continue; }
    const sev = str(comp(s, 4, 0, enc)).toUpperCase();
    out.allergies.push(allergyIntolerance({ id: `al1-${str(field(s, 1)) || out.allergies.length + 1}-${kind.controlId}`, code: cc, clinicalStatus: "active", criticality: sev === "SV" ? "high" : sev === "MI" ? "low" : "unable-to-assess",
      reactions: str(field(s, 5)) ? [{ text: decodeEsc(str(field(s, 5)), enc), severity: sev === "SV" ? "severe" : sev === "MO" ? "moderate" : sev === "MI" ? "mild" : null }] : [] }));
  }

  if (kind.type === "ORU") {
    let report = null;
    for (const s of msg.segments || []) {
      if (s.id === "OBR") {
        const filler = str(comp(s, 3, 0, enc)), placer = str(comp(s, 2, 0, enc));
        const rid = filler || placer || `obr-${str(field(s, 1)) || "1"}-${kind.controlId}`;
        const cc = ccFrom(s, 4, enc, "report");
        report = { id: rid, results: [] };
        if (placer) out.serviceRequests.push(serviceRequest({ id: placer, code: cc, status: "completed", intent: "order", authoredOn: hl7Date(field(s, 6)), requester: decodeEsc(str(comp(s, 16, 1, enc)), enc) || null, encounter: encRef }));
        out.diagnosticReports.push(diagnosticReport({ id: rid, code: cc, status: OBR_STATUS[str(field(s, 25)).toUpperCase()] || "preliminary", effectiveDateTime: hl7Date(field(s, 7)) || hl7Date(field(s, 22)), results: report.results, basedOn: placer ? { type: "ServiceRequest", id: placer } : null }));
        if (!str(field(s, 25))) warnings.push(`OBR ${rid} carries no result status; recorded as preliminary`);
      } else if (s.id === "OBX") {
        const oid = `${report ? report.id : "obx"}-${str(field(s, 1)) || "x"}`;
        const type = str(field(s, 2)).toUpperCase(), raw = field(s, 5);
        let value = null;
        if (raw != null && raw !== "") {
          if (type === "NM") { const n = Number(String(raw).trim()); value = Number.isFinite(n) ? quantity({ value: n, unit: str(comp(s, 6, 0, enc)) || null, code: str(comp(s, 6, 0, enc)) || null }) : { text: decodeEsc(String(raw), enc) }; if (!Number.isFinite(n)) warnings.push(`OBX ${oid} is typed NM but carries "${raw}"; kept as text`); }
          else if (type === "SN") { const m = /^([<>=]*)\^?([-\d.]+)/.exec(String(raw)); const cmp = m && ["<", "<=", ">=", ">"].includes(m[1]) ? m[1] : null; value = m && Number.isFinite(Number(m[2])) ? quantity({ value: Number(m[2]), unit: str(comp(s, 6, 0, enc)) || null, comparator: cmp }) : { text: decodeEsc(String(raw), enc) }; }
          else if (type === "CE" || type === "CWE" || type === "CNE") value = ccFrom(s, 5, enc, "coded value");
          else value = { text: decodeEsc(String(raw), enc) };
        }
        const flag = str(field(s, 8));
        const st = OBX_STATUS[str(field(s, 11)).toUpperCase()] || "unknown";
        if (st === "entered-in-error") { warnings.push(`OBX ${oid} is marked ${str(field(s, 11))} (deleted/wrong) and was not carried`); continue; }
        out.observations.push(observation({ id: oid, category: "laboratory", code: ccFrom(s, 3, enc, "observation"), value,
          referenceRange: str(field(s, 7)) ? { text: decodeEsc(str(field(s, 7)), enc) } : null,
          // The laboratory's own flag, as sent. Never recomputed here or anywhere downstream.
          interpretation: flag ? codeable({ text: flag }) : null,
          effectiveDateTime: hl7Date(field(s, 14)) || (report && out.diagnosticReports.length ? out.diagnosticReports[out.diagnosticReports.length - 1].effectiveDateTime : null), status: st }));
        if (report) report.results.push({ type: "Observation", id: oid });
        else warnings.push(`OBX ${oid} arrived before any OBR and belongs to no report`);
      }
    }
  }
  return { sccm: out, kind, zSegments, warnings };
}

export { hl7Date, ccFrom, identifiersFrom, hl7ToSccm, CODING_SYSTEMS, PV1_CLASS, OBR_STATUS, OBX_STATUS };
