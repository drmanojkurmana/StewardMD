// functions/_connect/connectors/dicomweb/connector.js — DICOMweb QIDO-RS pull connector (STUDY METADATA ONLY).
// KEY REUSE INSIGHT: a hospital PACS/VNA that exposes a DICOMweb QIDO-RS studies endpoint can self-onboard
// STUDY-LEVEL METADATA (modality, body site, study date, accession, series/instance counts, an opaque study
// identifier) into the SCCM `imagingStudies` resource, using the SAME token/API-key pull shape as the
// rest-json connector (no SMART, no new mapping engine — just a small DICOM-JSON tag reader). This is a
// QIDO-RS (query) connector ONLY: it NEVER performs a WADO-RS retrieve, so no pixel data / binary attachment
// is ever fetched. The SCCM ImagingStudy model (canonical/model.js) has no url/binary field to begin with, and
// validateImagingStudy (canonical/validate.js) hard-fails on one, so a binary/url field cannot leak in here
// even by mistake.
import { imagingStudy, patient, bundle } from "../../canonical/model.js";
import { UpstreamError } from "../../permission.js";

// Deterministic, source-derived (never tenant-salted) id — the SAME tiny djb2-ish hash the file/hl7v2
// normalizers use (file/normalize.js, hl7v2/normalize.js), copied here (not shared/imported) so this
// connector stays a self-contained, no-new-deps module, matching the codebase's existing duplication idiom.
function hashId(s) { let h = 5381; const str = String(s || ""); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return "h" + h.toString(16); }

// DICOM-JSON value reader: `{ "TAG": { "vr":.., "Value":[..] } }` -> the first value, or undefined when the
// tag is absent. Returning undefined (never null/"") lets imagingStudy()'s putIf() OMIT the field rather than
// fabricate a placeholder — the no-fabrication discipline this whole connector is built around.
function tagValue(obj, tag) {
  const v = obj && obj[tag] && Array.isArray(obj[tag].Value) ? obj[tag].Value[0] : undefined;
  return v == null || v === "" ? undefined : v;
}

// Resolve the auth header from ctx.secrets("bearer") + an optional custom header name (config.headerName),
// PLUS the Accept header DICOMweb servers expect for the JSON response model (application/dicom+json). Built
// fresh on every call (the connector holds no state) — mirrors rest-json's authHeaderFor exactly, plus Accept.
async function authHeaderFor(ctx) {
  const header = { accept: "application/dicom+json" };
  const tok = ctx.secrets ? await ctx.secrets("bearer").catch(() => null) : null;
  if (!tok) return header;
  const name = (ctx.config && ctx.config.headerName) ? String(ctx.config.headerName) : "authorization";
  header[name] = name.toLowerCase() === "authorization" ? "Bearer " + tok : tok;
  return header;
}

function studiesBase(ctx) {
  const base = ((ctx.config && ctx.config.base_url) || "").replace(/\/$/, "");
  const path = (ctx.config && ctx.config.studiesPath) || "/studies";
  return base + path;
}

function studiesUrl(ctx, patientRef) {
  const tag = (ctx.config && ctx.config.patientTag) || "00100020";       // PatientID
  return studiesBase(ctx) + "?" + tag + "=" + encodeURIComponent(patientRef);
}

export const dicomWebConnector = {
  meta: { id: "dicomweb", name: "DICOMweb QIDO-RS imaging metadata", version: "1.0", profile: "pull", kinds: ["dicomweb"], sccmVersion: "1.0" },

  authenticate: async () => ({ ok: true }),   // no handshake — the token (if any) is attached per-request below

  capabilities: async () => ({ resources: ["ImagingStudy"], operations: ["read"], authKinds: ["token"] }),

  // An unfiltered, limited QIDO query (`?limit=1`) proves the studies endpoint is reachable + authorized,
  // without requiring a real patient identifier just to validate the connection (keep it simple).
  validate: async (ctx) => {
    const checks = [];
    try {
      const header = await authHeaderFor(ctx);
      // redirect:"manual" (mirrors rest-json/fhir-r4.validate) — never auto-follow a 3xx to another origin here.
      const res = await ctx.fetch(studiesBase(ctx) + "?limit=1", { headers: header, redirect: "manual" });
      const ok = !!(res && res.ok);
      checks.push({ name: "studies-endpoint", ok });
      return { ok, checks };
    } catch (e) { checks.push({ name: "validate", ok: false, detail: e.message }); return { ok: false, checks }; }
  },

  fetchPatient: async (ctx, patientRef) => {
    const header = await authHeaderFor(ctx);
    let res;
    try {
      // redirect:"manual" — never auto-follow a 3xx through this authenticated read to another origin (the
      // onboard ctx.fetch is additionally redirect-safe; this hardens the engine path too).
      res = await ctx.fetch(studiesUrl(ctx, patientRef), { headers: header, redirect: "manual" });
    } catch (e) {
      // Preserve an already-typed/controlled error (the onboard SSRF guard's OnboardError("ssrf"), ...) so its
      // class is never masked; only a BARE platform rejection is normalized to a typed UpstreamError. Copied
      // verbatim from the rest-json connector's fetchPatient idiom.
      if (e && e.name && !["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(e.name)) throw e;
      throw new UpstreamError("studies read failed");
    }
    if (!res.ok) throw new UpstreamError("studies read HTTP " + res.status);
    let data;
    try { data = await res.json(); } catch (e) { throw new UpstreamError("studies response was not JSON"); }

    // Accept ONLY a JSON array of DICOM-JSON study objects (the QIDO-RS response model has no {results:[...]}
    // envelope, unlike the rest-json contract); anything else is 0 studies + a warning — NEVER invent studies.
    const warnings = [];
    let rows;
    if (Array.isArray(data)) rows = data;
    else { rows = []; warnings.push("unrecognized response shape (expected a JSON array of DICOM-JSON study objects); no studies read"); }

    const maxRows = (ctx.budget && ctx.budget.maxRows) || 5000;
    if (rows.length > maxRows) { warnings.push("studies truncated at maxRows (" + maxRows + ")"); rows = rows.slice(0, maxRows); }

    return { rows, warnings, patientRef };
  },

  // Map each DICOM-JSON study object -> an SCCM ImagingStudy. METADATA ONLY: no WADO-RS call is ever made
  // here, and imagingStudy()'s field allowlist (canonical/model.js) has no url/binary slot for one to leak
  // into even if the raw study object carried one (validateImagingStudy hard-fails on it as defense in depth).
  normalize: async (ctx, raw) => {
    const rows = (raw && raw.rows) || [];
    const warnings = ((raw && raw.warnings) || []).slice();
    const patientRef = (raw && raw.patientRef) || "";
    const studies = [];
    for (const obj of rows) {
      try {
        const uid = tagValue(obj, "0020000D");                         // StudyInstanceUID
        if (uid == null) { warnings.push("study missing StudyInstanceUID (0020000D); skipped"); continue; }
        const modality = tagValue(obj, "00080061") || tagValue(obj, "00080060");   // ModalitiesInStudy || Modality
        const studyDate = tagValue(obj, "00080020");                    // StudyDate
        const accessionNumber = tagValue(obj, "00080050");              // AccessionNumber
        const description = tagValue(obj, "00081030");                  // StudyDescription
        const seriesCount = tagValue(obj, "00201206");                 // NumberOfStudyRelatedSeries
        const instanceCount = tagValue(obj, "00201208");                // NumberOfStudyRelatedInstances
        const bodySite = tagValue(obj, "00180015");                     // BodyPartExamined, if present
        // Defensively String()/Number()-cast every optional field (a stray numeric-looking accession number or
        // similar from an unusual DICOM-JSON writer must still satisfy validateImagingStudy's string/number
        // allowlist, never silently mis-typed).
        studies.push(imagingStudy({
          id: hashId(uid),                          // deterministic hashed id — NEVER the raw UID as/in a URL
          sourceStudyId: String(uid),                // an opaque identifier string, not a URL
          modality: modality != null ? String(modality) : undefined,
          studyDate: studyDate != null ? String(studyDate) : undefined,
          accessionNumber: accessionNumber != null ? String(accessionNumber) : undefined,
          description: description != null ? String(description) : undefined,
          seriesCount: seriesCount != null ? Number(seriesCount) : undefined,
          instanceCount: instanceCount != null ? Number(instanceCount) : undefined,
          bodySite: bodySite != null ? String(bodySite) : undefined,
        }));
      } catch (e) { warnings.push("study skipped (malformed): " + (e && e.message)); }
    }
    return bundle({
      tenantId: ctx.tenant.id,
      patient: patient({ id: hashId(patientRef) }),   // the queried patient ref, hashed — never the raw id/a URL
      sourceConnector: "dicomweb",
      generatedAt: ctx.now().toISOString(),
      imagingStudies: studies,
      warnings,
      provenance: [{ resource: "ImagingStudy", sourceConnector: "dicomweb", sourceId: "dicomweb/" + hashId(patientRef) }],
    });
  },
};
