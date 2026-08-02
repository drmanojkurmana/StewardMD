// functions/_connect/onboard/csv-upload.js — Self-Service EMR Onboarding, Increment 2: the CSV upload path.
// A ONE-SHOT upload -> parse (the REUSED, DoS-hardened Track-B parser connectors/file/csv.js) -> normalize to
// SCCM (the REUSED connectors/file/normalize.js) -> return the canonical bundle for in-app viewing. There is
// NO outbound fetch here, so SSRF is N/A; the work is bounded by a HARD 2MB byte cap enforced BEFORE parsing
// plus the parser's own column/row/cell/warning caps (the security review's maxColumns=512 / maxRows / maxCell
// / maxWarnings). RBAC mirrors the FHIR pull: connector:read, and the auditor role is denied because the
// returned bundle carries PHI. The audit is PHI-free by construction (action connect.onboard.csv-parsed,
// counts only via the audit ALLOW filter — never a raw row / cell / value).
import { requireCan } from "../enterprise/guard.js";
import { PermissionError } from "../permission.js";
import { makeAuditSink } from "../audit.js";
import { validateBundle } from "../canonical/validate.js";
import { RESOURCE_KEYS } from "../canonical/model.js";
import { parseDelimited } from "../connectors/file/csv.js";
import { normalizeCsvLab } from "../connectors/file/normalize.js";
import { OnboardError } from "./errors.js";

// Hard byte cap enforced before parsing (stricter than the parser's 5MB internal net). Exported so the HTTP
// surface can reject an oversized body up front via Content-Length, before buffering it.
export const CSV_MAX_BYTES = 2_000_000;

// Canonical SCCM field -> accepted header aliases (normalized: lowercased, alphanumerics only). The FIRST
// matching header wins and is never reused for a second field, so a plain lab export normalizes with no manual
// column mapping. The caller may still pass an explicit columnMap to override.
const ALIASES = {
  patientId: ["patientid", "mrn", "patient", "pid", "patientmrn", "uhid", "hospitalno", "hospitalnumber"],
  name: ["name", "patientname", "fullname"],
  dob: ["dob", "dateofbirth", "birthdate"],
  sex: ["sex", "gender"],
  orderId: ["orderid", "order", "accession", "accessionnumber", "ordernumber", "orderno", "labno", "reportno"],
  testCode: ["testcode", "code", "loinc", "loinccode"],
  testCodeSystem: ["testcodesystem", "codesystem", "codesys", "system"],
  testName: ["testname", "test", "analyte", "observation", "parameter", "investigation"],
  value: ["value", "result", "resultvalue", "val"],
  unit: ["unit", "units", "uom"],
  refLow: ["reflow", "low", "rangelow", "refrangelow", "normallow"],
  refHigh: ["refhigh", "high", "rangehigh", "refrangehigh", "normalhigh"],
  abnormalFlag: ["abnormalflag", "flag", "abnormal", "interpretation"],
  collectedAt: ["collectedat", "collected", "collectiondate", "drawn", "specimendate", "resultdate", "reporteddate", "date"],
  resultStatus: ["resultstatus", "status"],
};
const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");

// The canonical SCCM field names this mapper ever assigns — the single source of truth for any other module
// (e.g. ai-map.js's AI-suggest allow-list) that needs "every field this mapper could produce", so nothing else
// hardcodes a second, divergent list that could drift from ALIASES above.
export const SCCM_TARGET_FIELDS = Object.freeze(Object.keys(ALIASES));

// Best-effort structural mapping from header names to canonical fields (never inspects a value).
export function inferColumnMap(header = []) {
  const map = {}, used = new Set();
  const cols = header.map((h) => ({ raw: h, key: norm(h) }));
  for (const field of Object.keys(ALIASES)) {
    for (const alias of ALIASES[field]) {
      const hit = cols.find((c) => c.key === alias && !used.has(c.raw));
      if (hit) { map[field] = hit.raw; used.add(hit.raw); break; }
    }
  }
  return map;
}

function byteLen(s) { try { return new TextEncoder().encode(s).length; } catch { return String(s || "").length; } }

// deps: { db, identifyFn }. body: { name?, csv, columnMap? }. Returns { ok, bundle, rowsParsed, columns, warnings }.
export async function parseCsvUpload(deps, request, env, tenantId, body = {}) {
  // Read-ish PHI view: same gate as the FHIR pull (connector:read); an auditor is denied the PHI bundle.
  const { actor, tenant, role } = await requireCan(deps, request, env, tenantId, "connector:read");
  if (role === "auditor") throw new PermissionError("auditor may not view patient data");

  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) throw new OnboardError("invalid", "csv text required");
  if (byteLen(csv) > CSV_MAX_BYTES) throw new OnboardError("too-large", "csv exceeds byte cap");

  const t0 = Date.now();
  // Parse with the REUSED, DoS-hardened parser (its column/row/cell/warning caps bound adversarial input).
  const parsed = parseDelimited(csv);
  // Auto-map columns unless the caller supplied an explicit map; normalize with the REUSED SCCM normalizer.
  const columnMap = (body.columnMap && typeof body.columnMap === "object") ? body.columnMap : inferColumnMap(parsed.header);
  const ctx = { tenant: { id: tenant.id }, now: () => new Date(), config: { config: { columnMap } }, budget: { maxWarnings: 500 } };
  const bundle = normalizeCsvLab(ctx, parsed);

  // Merge validator warnings; NEVER throw for a validation miss here (this is an interactive upload — surface
  // the issue and still show the best-effort bundle, do not crash the wizard).
  const v = validateBundle(bundle);
  for (const w of v.warnings) bundle.meta.warnings.push(w);
  if (!v.ok) for (const e of v.errors) bundle.meta.warnings.push("validation: " + e);
  if (!columnMap.patientId) bundle.meta.warnings.push("no recognizable patient id column; patient set to 'unknown'");

  const rowsParsed = (parsed.rows || []).length;
  // PHI-free audit: counts only (rows + columns + per-resource-type) — the audit ALLOW filter keeps these
  // inside resourceCounts and structurally drops anything else, so no raw row / cell / value can leak.
  const counts = RESOURCE_KEYS.reduce((a, k) => (a[k] = bundle[k].length, a), { rows: rowsParsed, columns: (parsed.header || []).length });
  await makeAuditSink(env, deps.db)({
    tenantId: tenant.id, actor: actor.id, action: "connect.onboard.csv-parsed",
    resourceCounts: counts, latencyMs: Date.now() - t0, outcome: "ok", ts: new Date().toISOString(),
  });

  return { ok: true, bundle, rowsParsed, columns: parsed.header || [], warnings: bundle.meta.warnings };
}
