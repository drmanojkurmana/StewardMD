// functions/_connect/connectors/hl7v2/normalize.js — HL7 v2 (ORU/ADT/MDM) -> SCCM. Warn-don't-drop.
import { coding, codeable, quantity } from "../../canonical/coding.js";
import { bundle, patient, encounter, observation, diagnosticReport, documentReference, condition, allergyIntolerance } from "../../canonical/model.js";
import { seg, segs, field, comp, decodeEsc } from "./parser.js";

const LOINC = "http://loinc.org", SNOMED = "http://snomed.info/sct";
function hashId(s) { let h = 5381; const str = String(s || ""); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return "h" + h.toString(16); }
function ccFromCE(sg, n, enc, fallback) {
  const code = comp(sg, n, 0, enc), text = comp(sg, n, 1, enc), sysRaw = comp(sg, n, 2, enc);
  const system = sysRaw === "LN" ? LOINC : sysRaw === "SCT" ? SNOMED : (sysRaw || null);
  const kind = system === LOINC || system === SNOMED ? "standard" : "local";
  if (!code && !text) return codeable({ text: fallback || "unknown" });
  return codeable({ coding: [coding({ system, code: code || null, display: text || null, kind })], text: decodeEsc(text, enc) || code || fallback || "unknown" });
}
const hl7Date = (v) => { const s = String(v || ""); return /^\d{8}/.test(s) ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) : (s || null); };
const sex = (v) => ({ M: "male", F: "female", O: "other", U: "unknown" }[String(v || "").toUpperCase()] || "unknown");

function patientFrom(msg, enc, warnings) {
  const pid = seg(msg, "PID");
  if (!pid) { warnings.push("no PID segment; patient unresolved"); return null; }
  const primary = comp(pid, 3, 0, enc) || field(pid, 3) || "";
  return patient({ id: hashId(primary) || "unknown", gender: sex(field(pid, 8)), birthDate: hl7Date(field(pid, 7)),
    name: { text: decodeEsc([comp(pid, 5, 1, enc), comp(pid, 5, 0, enc)].filter(Boolean).join(" ") || null, enc), given: comp(pid, 5, 1, enc) ? [comp(pid, 5, 1, enc)] : [], family: comp(pid, 5, 0, enc) || null } });
}

function obxValue(obx, enc) {
  const type = field(obx, 2), raw = field(obx, 5);
  if (raw == null) return null;
  if (type === "NM") return quantity({ value: Number(raw), unit: comp(obx, 6, 0, enc) || field(obx, 6) || null });
  if (type === "SN") { const m = String(raw).split("^"); return quantity({ value: Number(m[1] != null ? m[1] : raw), unit: comp(obx, 6, 0, enc) || null, comparator: (m[0] && /[<>]=?/.test(m[0])) ? m[0] : null }); }
  if (type === "CE" || type === "CWE") return ccFromCE(obx, 5, enc, "coded value");
  return { text: decodeEsc(String(raw), enc) };               // ST/TX/FT and unknown -> narrative
}

export function normalizeHl7(ctx, msg) {
  const enc = msg.encoding, warnings = (msg.warnings || []).slice();
  const msh = seg(msg, "MSH");
  const type = comp(msh, 9, 0, enc) || "";                     // ORU / ADT / MDM
  const out = bundle({ tenantId: ctx.tenant.id, sourceConnector: "hl7v2", generatedAt: ctx.now().toISOString(), warnings, provenance: [{ resource: "MSH", sourceConnector: "hl7v2", sourceId: "MSH/" + hashId(field(msh, 10)) }] });
  out.patient = patientFrom(msg, enc, warnings);

  if (type === "ORU") {
    let currentReport = null;
    for (const s of msg.segments) {
      if (s.id === "OBR") {
        const id = field(s, 3) || field(s, 1) || hashId(field(s, 4)); currentReport = { id: String(id), results: [] };
        out.diagnosticReports.push(diagnosticReport({ id: String(id), code: ccFromCE(s, 4, enc, "report"), status: field(s, 25) || "unknown", effectiveDateTime: hl7Date(field(s, 7)), results: currentReport.results }));
      } else if (s.id === "OBX") {
        const oid = (currentReport ? currentReport.id : "obx") + "-" + (field(s, 1) || comp(s, 3, 0, enc) || "x");
        out.observations.push(observation({ id: oid, category: "laboratory", code: ccFromCE(s, 3, enc, "observation"), value: obxValue(s, enc),
          referenceRange: field(s, 7) ? { text: field(s, 7) } : null, interpretation: field(s, 8) ? codeable({ text: field(s, 8) }) : null, status: field(s, 11) || "unknown", effectiveDateTime: hl7Date(field(s, 14)) }));
        if (currentReport) currentReport.results.push({ type: "Observation", id: oid });
        if (String(field(s, 11)).toUpperCase() === "C") warnings.push("OBX set " + (field(s, 1) || "?") + " is a correction (C); superseding not merged");   // OBX-1 set-id (an in-message ordinal) only; never echo the OBR-3 filler-order/accession id (was in `oid`)
      }
    }
  } else if (type === "ADT") {
    const pv1 = seg(msg, "PV1"), ev = comp(msh, 9, 1, enc) || "";
    if (pv1) out.encounters.push(encounter({ id: hashId(field(pv1, 19) || field(msh, 10)), class: field(pv1, 2) || null, status: ev === "A03" ? "finished" : "in-progress", period: { start: hl7Date(field(pv1, 44)), end: hl7Date(field(pv1, 45)) } }));
    for (const s of segs(msg, "DG1")) out.conditions.push(condition({ id: hashId((field(s, 3) || "") + field(s, 1)), code: ccFromCE(s, 3, enc, "diagnosis"), clinicalStatus: "active" }));   // G8 owner-gated
    for (const s of segs(msg, "AL1")) out.allergies.push(allergyIntolerance({ id: hashId((field(s, 3) || "") + field(s, 1)), code: ccFromCE(s, 3, enc, "allergen"), criticality: "unable-to-assess" }));
  } else if (type === "MDM") {
    const txa = seg(msg, "TXA");
    const narrative = segs(msg, "OBX").filter((s) => ["TX", "FT", "ST"].includes(field(s, 2))).map((s) => decodeEsc(field(s, 5), enc)).filter(Boolean).join("\n");
    out.documents.push(documentReference({ id: hashId((txa && field(txa, 12)) || field(msh, 10)), type: txa ? ccFromCE(txa, 2, enc, "document") : codeable({ text: "document" }), status: (txa && field(txa, 17)) || "unknown", text: narrative || null }));   // narrative only, NO binary
  } else {
    warnings.push("unsupported message type '" + type + "'; patient-only bundle");
  }
  return out;
}
