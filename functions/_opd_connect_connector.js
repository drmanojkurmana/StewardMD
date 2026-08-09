/* functions/_opd_connect_connector.js — the Connect → OPD BRIDGE.
 *
 * Turns a hospital connected through StewardMD Connect (EMR Connect wizard, stored in CONNECT_DB
 * connect_connector_config) into an OPD worklist SOURCE — so ANY FHIR R4 hospital feeds the OPD queue,
 * exactly like GHIS does, with zero per-hospital code. It registers the "connect" OPD connector; an OPD
 * org with { mode:"connect", connectorId:"connect", connectTenantId, connectConnectionId } resolves to it.
 *
 *   OPD import-from-source → resolveOpdSource(org) → connectOpdConnector → today's FHIR Encounters → pool
 *
 * It REUSES the Connect module's proven connection-loading (getRow + envelope-open + SSRF-guarded fetch +
 * auth acquisition) — it does not re-implement FHIR auth/SSRF. Any failure degrades to native (OPD keeps
 * working). Read-only: it only queries today's Encounters and imports names/refs — no write-back here.
 */
import { registerOpdConnector } from "./_opd_source.js";
import { makeSecrets } from "./_connect/secrets.js";
import { getRow } from "./_connect/onboard/store.js";
import { resolveAuth } from "./_connect/onboard/probe.js";
import { makeSafeFetch } from "./_connect/onboard/net.js";
import { assertPublicHttpsUrl } from "./_connect/onboard/ssrf.js";

// PURE: FHIR R4 Encounter Bundle -> OPD worklist rows keyed for the existing importRoster/mapGhisRow mapper
// (PatientName/PatientId/VisitId/VisitType). One row per DISTINCT patient with a today's encounter.
export function encountersToRows(bundle) {
  const out = [], seen = {};
  for (const e of ((bundle && bundle.entry) || [])) {
    const enc = e.resource || {};
    if (enc.resourceType && enc.resourceType !== "Encounter") continue;
    const subj = enc.subject || {};
    const ref = String(subj.reference || "");
    const pid = ref.indexOf("Patient/") === 0 ? ref.slice(8) : (ref.split("/").pop() || "");
    if (!pid || seen[pid]) continue;
    seen[pid] = 1;
    const dept = (enc.serviceType && (enc.serviceType.text || (((enc.serviceType.coding || [])[0]) || {}).display)) ||
      (((enc.type || [])[0]) || {}).text || "";
    out.push({ PatientName: subj.display || ("Patient " + pid), PatientId: pid, VisitId: enc.id || pid, VisitType: "new", Department: dept });
  }
  return out;
}

// A display name from a FHIR R4 Patient resource: prefer name.text, else given + family.
export function fhirName(p) {
  const n = ((p && p.name) || [])[0] || {};
  if (n.text) return String(n.text).trim();
  const given = Array.isArray(n.given) ? n.given.join(" ") : (n.given || "");
  const full = (given + " " + (n.family || "")).trim();
  return full || "";
}

// Load a stored Connect FHIR connection and pull today's OPD Encounters as worklist rows. Throws on any
// problem (missing binding/key, non-FHIR connection, bad URL, FHIR error) — the caller degrades to native.
async function connectWorklist(env, tenantId, connectionId, dateStr) {
  if (String(env && env.CONNECT_FLAG) !== "1" || !(env && env.CONNECT_DB)) return { rows: [] };
  if (!tenantId || !connectionId) return { rows: [] };
  const secrets = makeSecrets(env);                                  // throws if CONNECT_MASTER_KEY missing
  const { row, config } = await getRow(env.CONNECT_DB, tenantId, connectionId);
  if (config.type !== "fhir" && row.kind !== "fhir-r4") return { rows: [] };   // bridge handles FHIR only (for now)
  const base = assertPublicHttpsUrl(row.base_url, "baseUrl").href.replace(/\/$/, "");
  let creds = {}; try { creds = JSON.parse(await secrets.open(config.sealed)); } catch (e) { creds = {}; }
  const bearer = (await resolveAuth({ fetch: fetch, now: () => new Date() }, base, config, creds)).bearer;
  const safeFetch = makeSafeFetch(fetch);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || "") ? dateStr : new Date().toISOString().slice(0, 10);
  const h = { Authorization: "Bearer " + bearer, Accept: "application/fhir+json" };
  const url = base + "/Encounter?date=ge" + today + "&_count=50";
  const res = await safeFetch(url, { headers: h, redirect: "manual" });
  if (!res || !res.ok) throw new Error("fhir_worklist_" + ((res && res.status) || "err"));
  const rows = encountersToRows(await res.json());
  // Resolve real names for rows whose Encounter had no subject.display (fetch the Patient). Bounded.
  let looked = 0;
  for (const r of rows) {
    if (looked >= 20 || !/^Patient /.test(r.PatientName)) continue;
    try {
      const pr = await safeFetch(base + "/Patient/" + encodeURIComponent(r.PatientId), { headers: h, redirect: "manual" });
      looked++;
      if (pr && pr.ok) { const p = await pr.json(); const nm = fhirName(p); if (nm) r.PatientName = nm; }
    } catch (e) { /* leave the fallback name */ }
  }
  return { rows };
}

export function connectOpdConnector(env, org) {
  return {
    kind: "connector",
    connectorId: "connect",
    orgId: (org && org.id) || "",
    opdCaps: ["getWorklist"],
    // Today's OPD worklist for a Connect-linked FHIR hospital. {error} on any failure -> engine degrades.
    getWorklist: async (ctx, opts) => {
      try { return await connectWorklist(env, org && org.connectTenantId, org && org.connectConnectionId, (opts && opts.date) || ""); }
      catch (e) { return { error: true, rows: [] }; }
    }
  };
}

// Self-register: importing this file makes the "connect" OPD connector resolvable by org config.
registerOpdConnector("connect", connectOpdConnector);
