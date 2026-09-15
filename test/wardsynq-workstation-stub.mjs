/* test/wardsynq-workstation-stub.mjs - a local server for the Order workstation's real-browser runners.
 *
 * Serves the real page and its modules from this checkout, and answers /api/queue/* with the shapes the
 * real ward routes return (proven against the real router in test/wardsynq-order-workstation.test.mjs),
 * including the medication-order route's checkOnly step.
 * Every API request is recorded. `set(mode)` switches the answers: "ok", "empty", "listFail", "allergyFail",
 * "signedOut", "refuse".
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
export const PATIENT = { encounterId: "enc-qa-01", patientId: "pat-qa-01", name: "Test Patient QA-01", mrn: "SMD-6TEQZM-00027", ward: "General A", bed: "03", class: "IPD" };

export async function startStub(port, extraFiles) {
  let mode = "ok";
  const calls = [];
  const bundle = (resources) => ({ resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((resource) => ({ resource, search: { mode: "match" } })) });
  const answer = (path, q, body) => {
    if (mode === "signedOut") return [401, { ok: false, error: "unauthorized" }];
    if (path === "/whoami") return [200, { ok: true, role: "doctor", caps: ["emr.view", "emr.treat"], name: "Dr Harness", orgId: q.get("orgId") }];
    if (path === "/ward/list") {
      if (mode === "listFail") return [502, { ok: false, error: "record_read_failed", detail: "harness outage" }];
      return [200, { ok: true, patients: mode === "empty" ? [] : [PATIENT], region: "IN" }];
    }
    if (path === "/ward/fhir/AllergyIntolerance") {
      if (mode === "allergyFail") return [403, { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "forbidden" }] }];
      return [200, bundle([{ resourceType: "AllergyIntolerance", id: "alg-1", criticality: "high", clinicalStatus: { coding: [{ code: "active" }] }, code: { text: "Penicillins" }, reaction: [{ manifestation: [{ text: "anaphylaxis" }], severity: "severe" }] }])];
    }
    if (path === "/ward/timeline") return [200, { ok: true, events: [], activeMedications: [{ orderId: "rx-w", drug: "Warfarin 3mg", dose: { value: 3, unit: "mg" }, route: "oral", frequency: "HS" }] }];
    if (path.startsWith("/ward/fhir/Patient/")) return [200, { resourceType: "Patient", id: PATIENT.patientId, gender: "female", birthDate: "1958-01-01" }];
    if (path === "/ward/fhir/Observation") {
      return [200, q.get("code") === "29463-7"
        ? bundle([{ resourceType: "Observation", id: "w1", code: { coding: [{ system: "http://loinc.org", code: "29463-7" }], text: "Body weight" }, valueQuantity: { value: 62, unit: "kg" }, effectiveDateTime: "2026-09-15T06:00:00.000Z" }])
        : bundle([{ resourceType: "Observation", id: "l1", code: { text: "INR" }, valueQuantity: { value: 2.4, unit: "" } }])];
    }
    if (path === "/ward/medication-order") {
      if (mode === "refuse") return [409, { ok: false, error: "restricted_drug", detail: "Needs a microbiology approval.", written: 0 }];
      const drug = String(body && body.order && body.order.drug);
      // The server's own check (functions/_wardsynq/migrate-emar.js orderEntrySafety): a penicillin for this patient is a finding.
      const allergy = /amoxicillin/i.test(drug) ? [{ code: "ALLERGY_CLASS", severity: "contraindicated", disposition: "overridable", message: "Amoxicillin belongs to penicillins, which the patient is documented allergic to (Penicillins).", allergyId: "alg-1" }] : [];
      const safety = { checked: true, rulePackVersion: "stewardmd-harness", allowed: !allergy.length, blocks: [], overridables: allergy, warnings: [], findings: allergy, unresolvedDrug: false, unresolvedActiveMeds: [] };
      if (body && body.checkOnly === true) return [200, { ok: true, written: 0, checkOnly: true, drug, safety, formulary: "on-formulary" }];
      return [200, { ok: true, written: 1, orderId: "wsq-rx-enc-qa-01-" + drug.toLowerCase(), status: "active", safety }];
    }
    return [404, { ok: false, error: "not_found" }];
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith("/api/queue/")) {
      const chunks = []; for await (const c of req) chunks.push(c);
      let body = null; try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch {}
      const path = url.pathname.slice("/api/queue".length);
      calls.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), body });
      const [status, obj] = answer(path, url.searchParams, body);
      res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); return;
    }
    if (extraFiles && extraFiles[url.pathname]) { res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); res.end(extraFiles[url.pathname]); return; }
    const file = join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(port, r));
  return { calls, set: (m) => { mode = m; }, close: () => server.close() };
}
