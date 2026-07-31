// test/connect/maik-bridge-lanes.test.mjs — the two lanes + R7 egress split (spec §4.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLanes, toPatientCase, EGRESS_BLOCKED_NOTICE } from "../../functions/_connect/maik-bridge/lanes.js";

// A minimal synthetic CanonicalBundle (SCCM-shaped) with distinctive markers.
const BUNDLE = {
  patient: { gender: "female", birthDate: "1979-05-02" },
  conditions: [{ code: { text: "Type 2 diabetes mellitus" }, clinicalStatus: "active" }],
  medications: [{ medication: { text: "Metformin" }, status: "active", origin: "statement" }],
  allergies: [{ code: { text: "Penicillin" }, criticality: "high" }],
  observations: [
    { category: "laboratory", code: { text: "HbA1c" }, value: { value: 9.1, unit: "%" }, interpretation: "high" },
    { category: "laboratory", code: { text: "Sodium" }, value: { value: 140, unit: "mmol/L" }, interpretation: "normal" },
    { category: "vital-signs", code: { text: "Heart rate" }, value: { value: 88, unit: "/min" } },
  ],
  diagnosticReports: [{ code: { text: "CXR" }, conclusion: "No acute cardiopulmonary process." }],
  documents: [],
};

test("sandbox tenant => egress lane OPEN (synthetic dev/test)", () => {
  const r = splitLanes(BUNDLE, { mode: "sandbox", egressBaaOk: false });
  assert.ok(r.egress);
  assert.equal(r.notice, null);
  assert.equal(r.egress.sex, "female");
  assert.ok(r.egress.findings.some((f) => f.includes("Type 2 diabetes")));
  assert.ok(r.egress.findings.some((f) => f.includes("Current medications: Metformin")));
  assert.ok(r.egress.findings.some((f) => f.includes("Allergies: Penicillin (high)")));
  assert.equal(r.egress.abnormalLabs.HbA1c, "9.1 %");
  assert.equal("Sodium" in r.egress.abnormalLabs, false);            // normal lab is not "abnormal"
});

test("live tenant WITHOUT BAA => egress lane BLOCKED, deterministic present, notice set", () => {
  const r = splitLanes(BUNDLE, { mode: "live", egressBaaOk: false });
  assert.equal(r.egress, null);
  assert.equal(r.notice, EGRESS_BLOCKED_NOTICE);
  assert.ok(r.deterministic);                                        // deterministic lane always available
  assert.equal(r.deterministic.problems[0].label, "Type 2 diabetes mellitus");
});

test("live tenant WITH BAA => egress lane OPEN", () => {
  const r = splitLanes(BUNDLE, { mode: "live", egressBaaOk: true });
  assert.ok(r.egress);
  assert.equal(r.notice, null);
});

test("unknown mode (fail-closed) without BAA => egress BLOCKED", () => {
  const r = splitLanes(BUNDLE, { mode: "unknown", egressBaaOk: false });
  assert.equal(r.egress, null);
});

test("deterministic lane is SCCM-only — no vendor fields / no provenance", () => {
  const c = splitLanes(BUNDLE, { mode: "sandbox", egressBaaOk: true }).deterministic;
  const blob = JSON.stringify(c);
  assert.equal(blob.includes("provenance"), false);
  assert.equal(blob.includes("sourceId"), false);
  assert.equal(blob.includes("resourceType"), false);               // no raw FHIR shape leaks through
});

test("toPatientCase derives age from birthDate", () => {
  const pc = toPatientCase({ patient: { gender: "male", birthDate: "2000-01-01" } });
  assert.equal(pc.sex, "male");
  assert.ok(pc.age >= 24 && pc.age <= 27);
});
