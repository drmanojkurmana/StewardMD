// test/connect/abdm/hip-source-followcare.test.mjs — Stage-5 Task-1: HipSource + FollowCare adapter.
// The HIP SERVE side: StewardMD projects data it ALREADY HOLDS (a FollowCare discharge episode) into an
// SCCM-shaped record via the Phase-0 factories. ADR-2G (the FollowCare invariant): a PURE READ PROJECTION —
// it never diagnoses/prescribes/alters, it emits ONLY records scoped to the requested patientAbhaHash, an
// unknown/empty patient yields an empty list (never a throw), and NO raw ABHA is ever read or returned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { followcareSource, icuSource, casesSource, getHipSource, NotImplemented } from "../../../functions/_connect/abdm/hip-sources/followcare.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import {
  PATIENT_A_HASH, PATIENT_B_HASH, dischargeEpisodeA, dischargeEpisodeB, makeReader, makeLeakyReader,
} from "./fixtures/hip-followcare-synthetic.mjs";

const NOW = () => new Date("2026-07-21T00:00:00Z");                     // injected clock — no Date.now
const depsWith = (followcare) => ({ db: null, now: NOW, followcare });

// Every coded field of an SCCM resource must carry a non-empty text fallback (R12 / codeable invariant).
function assertTextFallbacks(b) {
  const ccs = [];
  (b.conditions || []).forEach((c) => ccs.push(c.code));
  (b.medications || []).forEach((m) => ccs.push(m.medication));
  (b.observations || []).forEach((o) => ccs.push(o.code));
  (b.documents || []).forEach((d) => ccs.push(d.type));
  for (const cc of ccs) assert.ok(cc && typeof cc.text === "string" && cc.text.trim(), "coded field missing text fallback");
}

test("HipSource contract: id + hiTypes declared", () => {
  assert.equal(followcareSource.id, "followcare");
  assert.deepEqual(followcareSource.hiTypes, ["DischargeSummary", "OPConsultation", "Prescription"]);
  assert.equal(typeof followcareSource.listCareContexts, "function");
  assert.equal(typeof followcareSource.loadRecord, "function");
});

test("listCareContexts: a synthetic discharge episode -> exactly one careContext", async () => {
  const deps = depsWith(makeReader([dischargeEpisodeA]));
  const ccs = await followcareSource.listCareContexts({}, deps, { tenantId: "t-mock", patientAbhaHash: PATIENT_A_HASH });
  assert.equal(ccs.length, 1);
  assert.equal(ccs[0].referenceNumber, "fc-ep-A-001");
  assert.equal(ccs[0].hiType, "DischargeSummary");
  assert.ok(ccs[0].display && ccs[0].display.length);
});

test("loadRecord: discharge episode -> SCCM-shaped record with conditions/medications/observations/documents", async () => {
  const deps = depsWith(makeReader([dischargeEpisodeA]));
  const out = await followcareSource.loadRecord({}, deps, { tenantId: "t-mock", careContextRef: "fc-ep-A-001" });

  assert.equal(out.recordType, "DischargeSummaryRecord");
  assert.equal(out.hiType, "DischargeSummary");
  assert.equal(out.patientAbhaHash, PATIENT_A_HASH);

  const r = out.record;
  assert.equal(validateBundle(r).ok, true, JSON.stringify(validateBundle(r).errors));
  assert.equal(r.meta.sourceConnector, "followcare");
  assert.equal(r.patient.id, "fc-pat-A");                    // FollowCare internal id — NOT an ABHA

  // discharge diagnosis -> conditions (incl. a code-less diagnosis surviving via text fallback)
  assert.equal(r.conditions.length, 2);
  assert.equal(r.conditions[0].code.text, "Community-acquired pneumonia");
  assert.equal(r.conditions[0].code.coding[0].kind, "standard");   // icd-10 is a standard system
  assert.equal(r.conditions[1].code.text, "Acute kidney injury (resolving)");
  assert.equal(r.conditions[1].code.coding.length, 0);            // code-less -> text only

  // discharge meds -> medications
  assert.equal(r.medications.length, 2);
  assert.equal(r.medications[0].medication.text, "Azithromycin");
  assert.equal(r.medications[0].dosage.text, "500 mg once daily x3 days");
  assert.equal(r.medications[1].medication.text, "Paracetamol 500 mg as needed");

  // vitals/labs -> observations (numeric value -> Quantity)
  assert.equal(r.observations.length, 2);
  assert.equal(r.observations[0].value.value, 78);
  assert.equal(r.observations[0].value.unit, "beats/min");
  assert.equal(r.observations[1].category, "laboratory");

  // discharge summary -> a single documentReference: NARRATIVE text only, NO binary
  assert.equal(r.documents.length, 1);
  assert.ok(/community-acquired pneumonia/i.test(r.documents[0].text));
  assert.equal(JSON.stringify(r.documents[0]).includes("data"), false, "document must carry no attachment/binary bytes");

  assertTextFallbacks(r);
});

test("ADR-2G: an unknown/empty patient -> an empty list, never a throw", async () => {
  const deps = depsWith(makeReader([dischargeEpisodeA]));
  const ccs = await followcareSource.listCareContexts({}, deps, { tenantId: "t-mock", patientAbhaHash: "no-such-patient" });
  assert.deepEqual(ccs, []);

  // missing patientAbhaHash and a missing reader both degrade to [] rather than throwing.
  assert.deepEqual(await followcareSource.listCareContexts({}, depsWith(makeReader([])), { tenantId: "t-mock", patientAbhaHash: PATIENT_A_HASH }), []);
  assert.deepEqual(await followcareSource.listCareContexts({}, { now: NOW }, { tenantId: "t-mock", patientAbhaHash: PATIENT_A_HASH }), []);
});

test("ADR-2G subject guard: never emits a careContext whose subject != the requested patientAbhaHash", async () => {
  // A leaky reader over-returns BOTH patients' episodes; the source itself must filter to patient A only.
  const deps = depsWith(makeLeakyReader([dischargeEpisodeA, dischargeEpisodeB]));
  const ccs = await followcareSource.listCareContexts({}, deps, { tenantId: "t-mock", patientAbhaHash: PATIENT_A_HASH });
  assert.equal(ccs.length, 1);
  assert.equal(ccs[0].referenceNumber, "fc-ep-A-001");
  assert.ok(!ccs.some((c) => c.referenceNumber === "fc-ep-B-001"), "patient B's careContext leaked into patient A's list");
  // and never the raw ABHA / patient-B pseudonym in the emitted list
  assert.equal(JSON.stringify(ccs).includes(PATIENT_B_HASH), false);
});

test("scaffolded sources (icu/cases) share the HipSource shape but throw NotImplemented", async () => {
  for (const s of [icuSource, casesSource]) {
    assert.equal(typeof s.id, "string");
    assert.ok(Array.isArray(s.hiTypes));
    await assert.rejects(() => Promise.resolve(s.listCareContexts({}, depsWith(makeReader([])), { tenantId: "t", patientAbhaHash: PATIENT_A_HASH })), NotImplemented);
    await assert.rejects(() => Promise.resolve(s.loadRecord({}, depsWith(makeReader([])), { tenantId: "t", careContextRef: "x" })), NotImplemented);
  }
  // registry lookup: followcare resolves; an unknown id is NotImplemented.
  assert.equal(getHipSource("followcare"), followcareSource);
  assert.throws(() => getHipSource("nope"), NotImplemented);
});
