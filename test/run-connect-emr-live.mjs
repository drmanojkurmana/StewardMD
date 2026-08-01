// test/run-connect-emr-live.mjs — LIVE end-to-end smoke for StewardMD Connect self-service EMR onboarding.
//
// Exercises the REAL onboard logic (store.saveConnection -> probe.testConnection -> pull.pullConnection),
// with the REAL global fetch, against a REAL open public FHIR R4 sandbox (no mock server). It reuses ONLY
// the test stubs the mocked suite already uses for the non-network seams: the round-tripping D1 mock
// (onboard-db.mjs), the in-memory KV (testkit), the envelope-secrets impl (real crypto, throwaway key), and
// a fixed non-guest identify. The network is genuinely live.
//
// Steps (PASS/FAIL each):
//   1. SAVE  — saveConnection seals a throwaway token + persists the row; proves assertPublicHttpsUrl ALLOWS
//              the public host (the SSRF guard's self-service allow-path) and the credential is envelope-sealed.
//   2. PROBE — testConnection opens the sealed creds, hits the REAL /metadata + /Patient?_count=1, and returns
//              { ok, fhirVersion, softwareName } read off the live CapabilityStatement.
//   3. PULL  — list a couple of real patient ids (GET {base}/Patient?_count=2), then pullConnection reuses the
//              fhir-r4 connector (bearer mode) to fetch + normalize one patient to an SCCM bundle; validate it.
//
// Only synthetic sandbox records are touched (these servers hold test data). A down/slow server is skipped
// (per-request timeout) and the next candidate is tried; if ALL are unreachable/empty we FAIL honestly.
//
// Run:  node test/run-connect-emr-live.mjs
import { makeSecrets } from "../functions/_connect/secrets.js";
import { makeMockKv } from "../functions/_connect/testkit.js";
import { assertPublicHttpsUrl } from "../functions/_connect/onboard/ssrf.js";
import { saveConnection } from "../functions/_connect/onboard/store.js";
import { testConnection } from "../functions/_connect/onboard/probe.js";
import { pullConnection } from "../functions/_connect/onboard/pull.js";
import { validateBundle } from "../functions/_connect/canonical/validate.js";
import { RESOURCE_KEYS } from "../functions/_connect/canonical/model.js";
import { makeOnboardDb } from "./connect/onboard/onboard-db.mjs";

// ---- candidate open FHIR R4 sandboxes, tried in order ------------------------------------------------------
const CANDIDATES = [
  "https://hapi.fhir.org/baseR4",   // open HAPI test server (no auth)
  "https://r4.smarthealthit.org",   // SMART open sandbox (Synthea synthetic data)
  "https://server.fire.ly",         // Firely public server
];
const THROWAWAY_TOKEN = "smd-live-smoke-throwaway-" + Math.random().toString(36).slice(2); // open servers ignore it
const REQ_TIMEOUT_MS = 25000;

// Real global fetch, but with a per-request abort timeout so a hung server is skipped rather than blocking.
// Preserves any init the feature code sets (redirect:"manual", headers, body); only injects a signal if absent.
const timedFetch = (url, init = {}) => init.signal ? fetch(url, init) : fetch(url, { ...init, signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });

// ---- non-network stubs (identical shape to the mocked onboard suite) --------------------------------------
const env = {
  CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"), // throwaway envelope key
  CONNECT_HMAC_SALT: Buffer.from("smd-live-smoke-salt").toString("base64"),        // for the PHI-free audit hash
};
const TENANT = "t-live";
const makeDeps = (db) => ({
  db,
  kv: makeMockKv(),
  secrets: makeSecrets(env),
  identifyFn: async () => ({ id: "u-live", guest: false }), // server-derived non-guest actor
  fetch: timedFetch,                                        // REAL network
  now: () => Date.now(),
});
const seedDb = () => makeOnboardDb({
  connect_membership: [{ user_id: "u-live", tenant_id: TENANT, role: "admin" }], // admin holds connector:*
  connect_tenant: [{ id: TENANT, mode: "sandbox", granted_scopes: "[]" }],
});
const req = {}; // identity is server-derived (identifyFn), so the request object is unused here

// ---- tiny reporter ----------------------------------------------------------------------------------------
let failed = 0;
const log = (...a) => console.log(...a);
const step = (name, ok, detail) => { log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`); if (!ok) failed++; return ok; };
const short = (s, n = 220) => { const t = typeof s === "string" ? s : JSON.stringify(s); return t.length > n ? t.slice(0, n) + "…" : t; };

// A raw (feature-independent) probe used only to CHOOSE a live server: valid CapabilityStatement + >=1 patient.
async function surveyServer(base) {
  const out = { base, metaOk: false, fhirVersion: null, softwareName: null, patientIds: [], note: "" };
  try {
    const m = await timedFetch(base + "/metadata", { headers: { accept: "application/fhir+json" } });
    if (!m.ok) { out.note = "metadata HTTP " + m.status; return out; }
    const cs = await m.json();
    if (!cs || cs.resourceType !== "CapabilityStatement") { out.note = "metadata not a CapabilityStatement"; return out; }
    out.metaOk = true; out.fhirVersion = cs.fhirVersion || null; out.softwareName = (cs.software && cs.software.name) || null;
    const p = await timedFetch(base + "/Patient?_count=2", { headers: { accept: "application/fhir+json" } });
    if (p.ok) { const pb = await p.json(); out.patientIds = (pb.entry || []).map((e) => e.resource && e.resource.id).filter(Boolean); }
  } catch (e) { out.note = (e && e.name === "TimeoutError") ? "timeout" : "unreachable (" + short(e && e.message, 60) + ")"; }
  return out;
}

// Prefer a patient that actually has linked resources so the normalized bundle is a meaningful proof.
async function pickRichPatient(base, ids) {
  for (const id of ids) {
    try {
      const r = await timedFetch(base + "/Observation?patient=" + encodeURIComponent(id) + "&_count=1", { headers: { accept: "application/fhir+json" } });
      if (r.ok) { const b = await r.json(); if ((b.entry || []).length > 0) return id; }
    } catch { /* try next */ }
  }
  return ids[0];
}

async function main() {
  log("StewardMD Connect — LIVE self-service EMR onboarding smoke");
  log("=".repeat(78));

  // ---- choose a live server -----------------------------------------------------------------------------
  log("\nSurveying candidate FHIR R4 sandboxes (first that responds AND holds a pullable patient wins):");
  let chosen = null;
  for (const base of CANDIDATES) {
    const s = await surveyServer(base);
    const usable = s.metaOk && s.patientIds.length > 0;
    log(`  - ${base}\n      metadata=${s.metaOk ? "ok" : "no"} fhirVersion=${s.fhirVersion || "?"} software=${short(s.softwareName, 40) || "?"} patients=${s.patientIds.length}${s.note ? " (" + s.note + ")" : ""}`);
    if (usable && !chosen) chosen = s;
  }
  if (!chosen) {
    log("\nRESULT: FAIL — no candidate sandbox was reachable AND non-empty from this environment.");
    log("(Not faking a pass. All three servers were down/slow/empty at run time.)");
    process.exit(1);
  }
  const BASE = chosen.base;
  log(`\nChosen live server: ${BASE}  (fhirVersion=${chosen.fhirVersion}, software=${chosen.softwareName})`);
  log("=".repeat(78));

  const db = seedDb();
  const deps = makeDeps(db);

  // ---- assertPublicHttpsUrl must ALLOW the public host (the self-service SSRF allow-path) ----------------
  log("\nStep 0 — SSRF guard allows the public host");
  try { const u = assertPublicHttpsUrl(BASE, "fhirBaseUrl"); step("assertPublicHttpsUrl ALLOWS " + BASE, true, "-> " + u.href); }
  catch (e) { step("assertPublicHttpsUrl ALLOWS " + BASE, false, "guard REJECTED a public host: " + short(e.message, 80)); }

  // ---- Step 1: SAVE (envelope-seal + persist) -----------------------------------------------------------
  log("\nStep 1 — SAVE connection (envelope-seal via real secrets stub)");
  let connectionId = null;
  try {
    const body = { name: "Live Smoke FHIR", type: "fhir", fhirBaseUrl: BASE, auth: { method: "token", token: THROWAWAY_TOKEN } };
    const res = await saveConnection(deps, req, env, TENANT, body);
    connectionId = res.connectionId;
    const row = (db._tables.connect_connector_config || [])[0];
    const cfg = JSON.parse(row.config || "{}");
    const sealedHidesToken = typeof cfg.sealed === "string" && cfg.sealed.length > 0 && !JSON.stringify(row).includes(THROWAWAY_TOKEN);
    step("saveConnection returned a connectionId", !!connectionId, connectionId);
    step("credential is envelope-sealed (token NOT stored in the clear)", sealedHidesToken, "sealed len=" + (cfg.sealed || "").length);
  } catch (e) { step("saveConnection", false, short(e.message, 120)); }

  // ---- Step 2: PROBE (real /metadata) -------------------------------------------------------------------
  log("\nStep 2 — PROBE the live server (real /metadata + /Patient?_count=1)");
  let probe = null;
  if (connectionId) {
    try {
      probe = await testConnection(deps, req, env, TENANT, connectionId);
      log("      probe result: " + JSON.stringify({ ok: probe.ok, fhirVersion: probe.fhirVersion, softwareName: probe.softwareName }));
      step("probe ok", probe.ok === true, probe.ok ? "" : "error=" + probe.error);
      step("probe reports a FHIR R4 version", /^4\./.test(String(probe.fhirVersion || "")), "fhirVersion=" + probe.fhirVersion);
      step("probe reports softwareName from live CapabilityStatement", !!probe.softwareName, "software=" + short(probe.softwareName, 60));
    } catch (e) { step("testConnection", false, short(e.message, 120)); }
  } else { step("PROBE skipped (no connection saved)", false); }

  // ---- Step 3: LIST + PULL + normalize ------------------------------------------------------------------
  log("\nStep 3 — LIST a couple of patient ids, then PULL + normalize one to SCCM");
  log("      GET " + BASE + "/Patient?_count=2 -> ids: " + JSON.stringify(chosen.patientIds.slice(0, 2)));
  if (connectionId && probe && probe.ok) {
    try {
      const patientId = await pickRichPatient(BASE, chosen.patientIds); // synthetic sandbox record
      log("      pulling synthetic patient: " + patientId);
      const bundle = await pullConnection(deps, req, env, TENANT, connectionId, patientId);

      const v = validateBundle(bundle);
      const counts = RESOURCE_KEYS.reduce((a, k) => (a[k] = (bundle[k] || []).length, a), {});
      const totalResources = Object.values(counts).reduce((a, n) => a + n, 0);

      step("normalized bundle is a valid SCCM bundle", v.ok === true, v.ok ? "sccmVersion=" + bundle.sccmVersion : "warnings=" + short(v.warnings));
      step("bundle carries patient demographics", !!(bundle.patient && bundle.patient.id), bundle.patient ? "patient.id=" + bundle.patient.id : "no patient");
      step("bundle carries a couple of normalized resources", totalResources >= 2, "counts=" + JSON.stringify(counts));

      // ---- proof excerpt (synthetic data only) ----
      const p = bundle.patient || {};
      const nm = Array.isArray(p.name) ? p.name[0] : p.name;
      log("\n  --- normalized SCCM bundle excerpt (synthetic sandbox record) ---");
      log("  patient: " + JSON.stringify({ id: p.id, name: nm, gender: p.gender, birthDate: p.birthDate }));
      log("  counts:  " + JSON.stringify(counts));
      const cond0 = (bundle.conditions || [])[0];
      const obs0 = (bundle.observations || [])[0];
      const med0 = (bundle.medications || [])[0];
      if (cond0) log("  condition[0]:   " + short(JSON.stringify({ id: cond0.id, code: cond0.code, clinicalStatus: cond0.clinicalStatus }), 200));
      if (obs0) log("  observation[0]: " + short(JSON.stringify({ id: obs0.id, code: obs0.code, value: obs0.value }), 200));
      if (med0) log("  medication[0]:  " + short(JSON.stringify({ id: med0.id, medication: med0.medication, origin: med0.origin }), 200));
      log("  meta.sourceConnector: " + JSON.stringify(bundle.meta && bundle.meta.sourceConnector));

      // ---- PHI-free audit invariant (bonus): the raw patientId must not be persisted in the clear --------
      const auditBlob = JSON.stringify(db._tables.connect_audit_event || []);
      step("audit row written for the pull", auditBlob.includes("connect.onboard.pulled"), "");
      step("raw patientId NOT persisted in audit (pseudonymized)", !auditBlob.includes(patientId), "");
    } catch (e) { step("pullConnection + normalize", false, short(e.message, 160)); }
  } else { step("PULL skipped (probe did not pass)", false); }

  // ---- verdict ------------------------------------------------------------------------------------------
  log("\n" + "=".repeat(78));
  log(failed === 0 ? `RESULT: ALL STEPS PASS (live against ${BASE})` : `RESULT: FAIL — ${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
