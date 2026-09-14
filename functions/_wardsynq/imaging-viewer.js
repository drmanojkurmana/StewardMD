/* functions/_wardsynq/imaging-viewer.js - P1.10: opening the images, in the viewer the hospital already has.
 *
 * dicom.js is right that WardSynQ must never fetch, proxy or store pixel data. What a radiologist
 * still needs is a way to get from the order on this screen to the study in their PACS/OHIF viewer
 * without retyping an accession number. That is a LINK, built from hospital configuration:
 *
 *   wardsynq.imagingViewer = { urlTemplate: "https://pacs.example/viewer?StudyInstanceUIDs={studyInstanceUid}" }
 *
 * RULES, each one a way a launch link goes wrong:
 *   - https only. A plain-http template would carry a study identifier and an MRN in clear text.
 *   - Only three placeholders exist: {studyInstanceUid}, {accessionNumber}, {patientId}. {patientId}
 *     is the MRN (the DICOM PatientID the worklist sends), never the patient's name. A template naming
 *     anything else is refused as a configuration fault rather than half-filled.
 *   - Every value is URL-encoded.
 *   - A placeholder with no known value means NO link, and the answer names what is missing.
 *
 * STUDY LINKAGE. The SCCM adapter links a study to an order only when both arrive in one message; a
 * DICOMweb pull carries studies alone. The worklist issues the order id AS the accession number, so a
 * study quoting that accession answers that order. Matched here, exactly, at read time. No match is
 * shown as no study, never approximated.
 *
 * REPORT TEMPLATES. wardsynq.radiologyTemplates is hospital content (sections, labels, optional pick
 * lists such as a BI-RADS category list the hospital itself types in). Nothing here scores anything.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const PLACEHOLDERS = Object.freeze(["studyInstanceUid", "accessionNumber", "patientId"]);

/** PURE. The launch URL, or why there is none. values: { studyInstanceUid, accessionNumber, patientId } */
function viewerLaunch(config, values) {
  const tpl = str(config && config.urlTemplate);
  if (!tpl) return { available: false, reason: "not_configured", detail: "No image viewer is configured for this hospital (wardsynq.imagingViewer.urlTemplate)." };
  if (!/^https:\/\//i.test(tpl)) return { available: false, reason: "template_not_https", detail: "The configured viewer template is not https, so no link is offered." };
  const used = Array.from(tpl.matchAll(/\{([^}]*)\}/g)).map((m) => m[1]);
  const unknown = used.filter((p) => !PLACEHOLDERS.includes(p));
  if (unknown.length) return { available: false, reason: "template_unsupported_placeholder", detail: `The viewer template names placeholders that do not exist: ${unknown.join(", ")}.` };
  if (!used.length) return { available: false, reason: "template_has_no_placeholder", detail: "The viewer template names no study, so it cannot open this one." };
  const v = values || {};
  const missing = [...new Set(used.filter((p) => !str(v[p])))];
  if (missing.length) return { available: false, reason: "missing_identifier", missing, detail: `The viewer needs ${missing.join(", ")}, which is not known for this study.` };
  const url = tpl.replace(/\{([^}]*)\}/g, (_, p) => encodeURIComponent(str(v[p])));
  try { if (new URL(url).protocol !== "https:") throw new Error("x"); } catch { return { available: false, reason: "template_invalid", detail: "The viewer template does not produce a valid https URL." }; }
  return { available: true, url };
}

/** PURE. The study answering an order: linked by id, else by the accession the order was issued under. */
function studyForOrder(order, studies) {
  if (!order) return null;
  const ids = new Set([str(order.id), ...((order.externalIdentifiers || []).map((i) => str(i && i.value)))].filter(Boolean));
  const list = (studies || []).filter(Boolean);
  return list.find((s) => str(s.serviceRequestId) === str(order.id))
    || list.find((s) => str(s.accessionNumber) && ids.has(str(s.accessionNumber)))
    || null;
}

/** PURE. Hospital report templates, with unusable ones reported rather than silently dropped. */
function templatesOf(raw) {
  const out = [], rejected = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const id = str(t && t.id), version = str(t && t.version) || "1";
    const sections = Array.isArray(t && t.sections) ? t.sections.filter((s) => s && str(s.key) && str(s.label)).map((s) => ({
      key: str(s.key), label: str(s.label), required: s.required === true,
      ...(Array.isArray(s.options) && s.options.length ? { options: s.options.map(str).filter(Boolean) } : {}),
    })) : [];
    if (!id || !sections.length) { rejected.push(id || "(no id)"); continue; }
    out.push({ id, version, name: str(t.name) || id, modality: str(t.modality) || null, sections });
  }
  return { templates: out, rejected };
}

/**
 * PURE. A report's sections checked against its template. Returns { ok, sections } or { ok:false, error, detail }.
 * A value outside a pick list is refused: the list is the hospital's, and "other" is its call to add.
 */
function applyTemplate(templates, templateId, templateVersion, values) {
  const t = (templates || []).find((x) => x.id === str(templateId));
  if (!t) return { ok: false, error: "template_not_found", detail: `No report template "${str(templateId)}" is configured.` };
  if (str(templateVersion) && str(templateVersion) !== t.version) {
    return { ok: false, error: "template_version_changed", detail: `Template "${t.id}" is now version ${t.version}; reload it before reporting.` };
  }
  const v = values && typeof values === "object" ? values : {};
  const unknown = Object.keys(v).filter((k) => !t.sections.some((s) => s.key === k));
  if (unknown.length) return { ok: false, error: "unknown_section", detail: `Not in template "${t.id}": ${unknown.join(", ")}.` };
  const sections = [];
  for (const s of t.sections) {
    const val = str(v[s.key]);
    if (!val) { if (s.required) return { ok: false, error: "section_required", detail: `"${s.label}" is required by this template.` }; continue; }
    if (s.options && !s.options.includes(val)) return { ok: false, error: "option_not_in_list", detail: `"${val}" is not one of the choices for "${s.label}".` };
    sections.push({ key: s.key, label: s.label, value: val });
  }
  if (!sections.length) return { ok: false, error: "sections_empty", detail: "Nothing was entered against the template." };
  return { ok: true, template: { id: t.id, version: t.version, name: t.name }, sections };
}

/**
 * GET imaging-studies. ctx: { migration, patientId?, serviceRequestId?, viewerConfig, templatesConfig }
 * Read through the caller's own governed read. A type the caller may not read is an empty list for
 * that type, stated in `unreadable`, never an error that hides the orders they can see.
 */
async function imagingStudies(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", orders: [] };
  let patientId = str(ctx.patientId);
  const srId = str(ctx.serviceRequestId);
  if (!patientId && !srId) return { ...base, ok: false, status: 422, error: "patient_or_request_required", orders: [] };

  let svc;
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
    svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: r.tenant, actor: r.actor, role: r.role, roleSource: r.source });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", detail: str(e && e.message), orders: [] };
  }

  const unreadable = [];
  let orders;
  try {
    if (srId) { const one = await svc.get("ServiceRequest", srId); orders = one ? [one] : []; if (one) patientId = str(one.patientId); }
    else orders = await svc.byPatient("ServiceRequest", patientId);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), orders: [] }; }
  if (srId && !orders.length) return { ...base, ok: false, status: 404, error: "request_not_found", orders: [] };
  orders = (orders || []).filter((o) => o && o.category === "imaging");

  let studies = [];
  try { studies = await svc.byPatient("ImagingStudy", patientId); } catch { unreadable.push("ImagingStudy"); }
  const tpl = str(ctx.viewerConfig && ctx.viewerConfig.urlTemplate);
  let mrn = "";
  if (tpl.includes("{patientId}")) {
    try { const p = await svc.get("Patient", patientId); mrn = str(p && p.mrn); } catch { unreadable.push("Patient"); }
  }

  const { templates, rejected } = templatesOf(ctx.templatesConfig);
  return {
    ...base, ok: true, patientId,
    orders: orders.map((o) => {
      const s = studyForOrder(o, studies);
      // The accession is the study's own when one landed; otherwise the id this hospital issued the order under.
      const values = { studyInstanceUid: s && s.studyUid, accessionNumber: (s && s.accessionNumber) || o.id, patientId: mrn };
      return {
        serviceRequestId: o.id, display: o.display || o.code || null,
        study: s ? { id: s.id, studyUid: s.studyUid || null, accessionNumber: s.accessionNumber || null, modality: s.modality || null, started: s.started || null, seriesCount: s.seriesCount == null ? null : s.seriesCount, instanceCount: s.instanceCount == null ? null : s.instanceCount } : null,
        viewer: viewerLaunch(ctx.viewerConfig, values),
      };
    }),
    templates,
    ...(rejected.length ? { templateWarnings: [`these report templates have no id or no usable section and were ignored: ${rejected.join(", ")}`] } : {}),
    ...(unreadable.length ? { unreadable } : {}),
  };
}

export { PLACEHOLDERS, viewerLaunch, studyForOrder, templatesOf, applyTemplate, imagingStudies };
