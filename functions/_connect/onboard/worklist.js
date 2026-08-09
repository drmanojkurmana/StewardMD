// functions/_connect/onboard/worklist.js — today's INPATIENT/OPD roster from a connected FHIR hospital,
// for Ward Sync (the generic equivalent of GHIS GetIPWL). Reuses the exact secure connection-loading of
// pull.js (RBAC connector:read, getRow, SSRF-guarded base, envelope-opened creds, bearer), then queries
// today's Encounters and enriches each distinct patient with bed (Encounter.location), treating doctor
// (Encounter.participant) and name/gender/age (a bounded parallel Patient read). Returns roster rows in the
// SAME shape Ward Sync already renders (patientId/patientFirstName/gender/bedName/employeeFirstName/
// deptDescription/dob/episodeId), so the client UI is unchanged. Read-only; never persists PHI.
import { requireCan } from "../enterprise/guard.js";
import { PermissionError } from "../permission.js";
import { assertPublicHttpsUrl } from "./ssrf.js";
import { makeSafeFetch } from "./net.js";
import { OnboardError } from "./errors.js";
import { getRow } from "./store.js";
import { resolveAuth } from "./probe.js";

function fhirName(p) {
  const n = ((p && p.name) || [])[0] || {};
  if (n.text) return String(n.text).trim();
  const g = Array.isArray(n.given) ? n.given.join(" ") : (n.given || "");
  return ((g + " " + (n.family || "")).trim()) || "";
}
export function encounterRoster(bundle) {
  const rows = [], seen = {};
  for (const e of ((bundle && bundle.entry) || [])) {
    const enc = e.resource || {};
    if (enc.resourceType && enc.resourceType !== "Encounter") continue;
    const subj = enc.subject || {};
    const ref = String(subj.reference || "");
    const pid = ref.indexOf("Patient/") === 0 ? ref.slice(8) : (ref.split("/").pop() || "");
    if (!pid || seen[pid]) continue;
    seen[pid] = 1;
    const bed = ((((enc.location || [])[0]) || {}).location || {}).display || "";
    const doc = ((((enc.participant || [])[0]) || {}).individual || {}).display || "";
    const dept = (enc.serviceType && (enc.serviceType.text || ((((enc.serviceType.coding || [])[0]) || {}).display))) || (((enc.type || [])[0]) || {}).text || "";
    rows.push({ patientId: pid, patientFirstName: subj.display || "", gender: "", dob: "", bedName: bed, employeeFirstName: doc, deptDescription: dept, episodeId: enc.id || pid });
  }
  return rows;
}

export async function pullWorklist(deps, request, env, tenantId, connectionId, opts) {
  const { tenant, role } = await requireCan(deps, request, env, tenantId, "connector:read");
  if (role === "auditor") throw new PermissionError("auditor may not read patient data");
  const { row, config } = await getRow(deps.db, tenant.id, connectionId);
  if (config.type !== "fhir" && row.kind !== "fhir-r4") throw new OnboardError("invalid", "worklist is FHIR-only");
  const base = assertPublicHttpsUrl(row.base_url, "baseUrl").href.replace(/\/$/, "");
  let creds = {}; try { creds = JSON.parse(await deps.secrets.open(config.sealed)); } catch (e) { creds = {}; }
  const bearer = (await resolveAuth(deps, base, config, creds)).bearer;
  const safeFetch = makeSafeFetch(deps.fetch);
  const h = { Authorization: "Bearer " + bearer, Accept: "application/fhir+json" };
  const today = (opts && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) ? opts.date : new Date().toISOString().slice(0, 10);
  const res = await safeFetch(base + "/Encounter?date=ge" + today + "&_count=50", { headers: h, redirect: "manual" });
  if (!res || !res.ok) throw new OnboardError("upstream", "encounter query failed");
  const rows = encounterRoster(await res.json());
  // Enrich name/gender/age from the Patient resource (bounded + parallel: fast first load).
  await Promise.all(rows.slice(0, 20).map(async (r) => {
    try {
      const pr = await safeFetch(base + "/Patient/" + encodeURIComponent(r.patientId), { headers: h, redirect: "manual" });
      if (pr && pr.ok) { const p = await pr.json(); if (!r.patientFirstName) r.patientFirstName = fhirName(p); r.gender = p.gender || ""; r.dob = p.birthDate || ""; }
    } catch (e) { /* leave the fallback */ }
  }));
  rows.forEach((r) => { if (!r.patientFirstName) r.patientFirstName = "Patient " + r.patientId; });
  return { ok: true, rows };
}
