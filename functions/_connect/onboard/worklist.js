// functions/_connect/onboard/worklist.js: today's INPATIENT/OPD roster from a connected hospital,
// for Ward Sync (the generic equivalent of GHIS GetIPWL).
//
// WORKLIST CAPABILITY SEAM:
// A connector declares the "worklist" capability flag (meta.capabilities.worklist: true,
// or meta.capabilities.operations containing "worklist") and implements:
//   worklist(ctx, opts) -> Promise<{ ok: boolean, rows: Array<WorklistRow> }>
// where:
//   ctx: { tenant, config, row, connectionId, fetch, secrets, db, kv, now, logger, budget, deps }
//   opts: { date: "YYYY-MM-DD" }
// Looked up by connector kind/id (row.kind || config.type || connectionId) from:
//   1. deps.connectors[id] (injected per-request connector map)
//   2. deps.registry.resolve(id) (injected SDK registry)
//   3. defaultRegistry().resolve(id) (SDK catalog built-ins)
//   4. opts.connector (direct connector override)
// Connectors without the "worklist" capability fall back to fhirWorklistProvider if the
// connection is FHIR (config.type === "fhir" || row.kind === "fhir-r4"), or throw
// OnboardError("invalid", "worklist is FHIR-only") exactly as before.
// Read-only; never persists PHI.
import { requireCan } from "../enterprise/guard.js";
import { PermissionError } from "../permission.js";
import { assertPublicHttpsUrl } from "./ssrf.js";
import { makeSafeFetch } from "./net.js";
import { OnboardError } from "./errors.js";
import { getRow } from "./store.js";
import { resolveAuth } from "./probe.js";
import { defaultRegistry } from "../sdk/catalog.js";

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

export function hasWorklistCapability(connector) {
  if (!connector) return false;
  if (typeof connector.worklist === "function" || typeof connector.fetchWorklist === "function") return true;
  const metaCaps = (connector.meta && connector.meta.capabilities) || {};
  if (metaCaps.worklist === true) return true;
  if (Array.isArray(metaCaps.operations) && metaCaps.operations.includes("worklist")) return true;
  return false;
}

export function resolveConnector(deps, row, config, connectionId, opts) {
  if (opts && opts.connector) return opts.connector;
  const candidates = [row && row.kind, config && config.type, connectionId, "fhir-r4"].filter(Boolean);
  if (deps && deps.connectors) {
    for (const id of candidates) {
      if (deps.connectors[id]) return deps.connectors[id];
    }
  }
  if (deps && deps.registry && typeof deps.registry.has === "function") {
    for (const id of candidates) {
      if (deps.registry.has(id)) return deps.registry.resolve(id);
    }
  }
  try {
    const reg = defaultRegistry();
    for (const id of candidates) {
      if (reg && typeof reg.has === "function" && reg.has(id)) return reg.resolve(id);
    }
  } catch {}
  return null;
}

export async function fhirWorklistProvider(ctx, opts) {
  const row = ctx.row || {};
  const config = ctx.config || {};
  const deps = ctx.deps || ctx;
  const base = assertPublicHttpsUrl(row.base_url, "baseUrl").href.replace(/\/$/, "");
  let creds = {}; try { creds = JSON.parse(await deps.secrets.open(config.sealed)); } catch (e) { creds = {}; }
  const bearer = (await resolveAuth(deps, base, config, creds)).bearer;
  const safeFetch = ctx.fetch || makeSafeFetch(deps.fetch);
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

export async function pullWorklist(deps, request, env, tenantId, connectionId, opts) {
  const { tenant, role } = await requireCan(deps, request, env, tenantId, "connector:read");
  if (role === "auditor") throw new PermissionError("auditor may not read patient data");
  const { row, config } = await getRow(deps.db, tenant.id, connectionId);

  const connector = resolveConnector(deps, row, config, connectionId, opts);
  const hasCap = hasWorklistCapability(connector);
  const isFhir = (config && config.type === "fhir") || (row && row.kind === "fhir-r4");

  if (!hasCap && !isFhir) {
    throw new OnboardError("invalid", "worklist is FHIR-only");
  }

  const safeFetch = makeSafeFetch(deps && deps.fetch);
  const ctx = {
    tenant: { id: tenant.id, mode: tenant.mode || "sandbox", settings: {} },
    config,
    row,
    connectionId,
    fetch: safeFetch,
    secrets: deps && deps.secrets,
    db: deps && deps.db,
    kv: deps && deps.kv,
    now: (deps && typeof deps.now === "function") ? deps.now : () => new Date(),
    logger: (deps && deps.logger) || { warn() {}, error() {} },
    budget: (deps && deps.budget) || { maxSubrequests: 20, deadlineMs: 8000, maxPagesPerResource: 50, maxRows: 50000 },
    deps,
  };

  const worklistFn = connector && (typeof connector.worklist === "function" ? connector.worklist : connector.fetchWorklist);
  if (hasCap && typeof worklistFn === "function") {
    const today = (opts && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) ? opts.date : new Date().toISOString().slice(0, 10);
    const worklistOpts = Object.assign({}, opts, { date: today });
    const res = await worklistFn.call(connector, ctx, worklistOpts);
    if (res && Array.isArray(res.rows)) return { ok: res.ok !== undefined ? res.ok : true, rows: res.rows };
    if (Array.isArray(res)) return { ok: true, rows: res };
    return res;
  }

  if (!isFhir) {
    throw new OnboardError("invalid", "connector missing worklist implementation");
  }

  return await fhirWorklistProvider(ctx, opts);
}
