// test/opd-ghis-connector.test.mjs — Phase 2: GHIS as OPD connector #1 + the OPD→source bridge.
// Verifies the connector conforms to the contract and that the engine degrades to native safely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ghisOpdConnector } from "../functions/_opd_ghis_connector.js";   // side-effect: registers "ghis"
import { assertOpdSource, opdSupports, resolveOpdSource, registerOpdConnector, opdConnectorIds } from "../functions/_opd_source.js";
import { importFromSource } from "../functions/_queue_ghis.js";

test("ghis connector registers itself and conforms to the OPD source contract", () => {
  assert.ok(opdConnectorIds().indexOf("ghis") > -1, "ghis registered on import");
  const src = ghisOpdConnector({}, { id: "h1" });
  assert.equal(assertOpdSource(src), true);   // every declared cap is a real function
  assert.equal(src.connectorId, "ghis");
});

test("ghis declares only the capabilities its EMR supports (not org-sync/check-in/consult-state)", () => {
  const src = ghisOpdConnector({}, { id: "h1" });
  for (const c of ["getWorklist", "resolvePatient", "writeAssessment", "writeVitals", "writeOrder"]) assert.equal(opdSupports(src, c), true);
  for (const c of ["syncOrgStructure", "checkIn", "setConsultationState"]) assert.equal(opdSupports(src, c), false);
});

test("resolveOpdSource routes an org configured for ghis to the ghis connector (org config, not hardcode)", () => {
  const src = resolveOpdSource({}, { id: "h1", mode: "connect", connectorId: "ghis" });
  assert.equal(src.kind, "connector");
  assert.equal(src.connectorId, "ghis");
  assert.equal(opdSupports(src, "getWorklist"), true);
});

test("importFromSource: NATIVE org imports nothing external (queue untouched) — no EMR dependency", async () => {
  const r = await importFromSource({}, { id: "s1", hospitalId: "h1" }, { id: "h1", mode: "native" }, {});
  assert.equal(r.native, true);
  assert.equal(r.imported, 0);
  assert.equal(r.source, "native");
});

test("importFromSource: DEGRADES safely when the EMR session is unavailable (unauth) — never throws", async () => {
  registerOpdConnector("faketest", () => ({ opdCaps: ["getWorklist"], getWorklist: async () => ({ unauth: true, rows: [] }) }));
  const r = await importFromSource({}, { id: "s1", hospitalId: "h1" }, { id: "h1", mode: "connect", connectorId: "faketest" }, { ghisToken: "" });
  assert.equal(r.degraded, true);
  assert.equal(r.imported, 0);
});

test("importFromSource: DEGRADES to native when a connector throws — queue stays usable", async () => {
  registerOpdConnector("throwy", () => ({ opdCaps: ["getWorklist"], getWorklist: async () => { throw new Error("EMR down"); } }));
  const r = await importFromSource({}, { id: "s1", hospitalId: "h1" }, { id: "h1", mode: "connect", connectorId: "throwy" }, {});
  assert.equal(r.degraded, true);
});
