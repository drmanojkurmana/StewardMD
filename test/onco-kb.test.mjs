/* ONCQIS Phase J-a: Knowledge Center INGESTION.
 *  - J5 extraction sanitizer + the PHI GUARD (the AI payload carries ONLY guideline + protocol text).
 *  - J6 pure impact categorization + protocolUpdateJob (NEVER mutates an input protocol).
 *  - the KB store writes ONLY evidence/extraction/report artifacts, NEVER an ACTIVE protocol.
 * Pure + deterministic (store test injects a fake KV). */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const KB = require(join(HERE, "..", "functions", "_onco_kb.js"));
import * as STORE from "../functions/_onco_kb_store.js";

// ---- fixtures ---------------------------------------------------------------------------------
const activeProtocol = {
  id: "folfox-6", name: "FOLFOX-6", disease: "colorectal cancer", diseaseId: "colorectal-cancer",
  protocolVersion: "1.0", status: "ACTIVE",
  regimen: { drugs: [{ id: "oxaliplatin", name: "oxaliplatin" }, { id: "fluorouracil", name: "fluorouracil" }], cycleLengthDays: 14, cycles: 12 },
  evidence: { core: [{ layer: "core", source: "DeVita 12e" }] }
};
const draftProtocol = { id: "rchop", name: "R-CHOP", disease: "DLBCL", diseaseId: "dlbcl", protocolVersion: "0.1", status: "DRAFT",
  regimen: { drugs: [{ id: "rituximab", name: "rituximab" }] } };

// ---- J5: PHI GUARD ----------------------------------------------------------------------------
test("PHI GUARD: analyzePayload carries ONLY guideline + protocol text - no PHI ever", () => {
  const p = KB.analyzePayload("Guideline says give oxaliplatin 85 mg/m2 (p.42).", "FOLFOX-6 current protocol text.");
  // Exact, closed key set.
  assert.deepEqual(Object.keys(p).sort(), ["guidelineText", "protocolText"]);
  // None of the denylisted PHI keys can appear (defensive: even if a caller passed an object).
  KB.PHI_DENYLIST.forEach((k) => assert.equal(Object.prototype.hasOwnProperty.call(p, k), false, "payload must not carry " + k));
  // The built prompt is derived ONLY from the two strings - no stray PHI token.
  const prompt = KB.extractionPrompt(p);
  assert.ok(prompt.indexOf("oxaliplatin") > -1);
  assert.ok(!/mrn|patient name|date of birth|aadhaar/i.test(prompt));
});

// ---- J5: sanitizer - VERIFY, never invent -----------------------------------------------------
test("sanitizeExtraction: missing fields => VERIFY, changes get a source location, category clamped", () => {
  const ex = KB.sanitizeExtraction({
    title: "NCCN Colon v3.2026", diseaseAreas: ["colorectal cancer"],
    changes: [
      { category: "dosing", description: "oxaliplatin dose", drug: "oxaliplatin", to: "85 mg/m2", sourceLocation: "p.42" },
      { category: "totally-made-up", description: "no source here", drug: "leucovorin" }   // no sourceLocation
    ]
  });
  assert.equal(ex.org, "VERIFY");            // not supplied => VERIFY
  assert.equal(ex.version, "VERIFY");
  assert.equal(ex.changes[0].category, "dose_change");   // synonym clamped
  assert.equal(ex.changes[0].sourceLocation, "p.42");
  assert.equal(ex.changes[1].category, "no_material_change"); // unknown category clamped, not invented
  assert.equal(ex.changes[1].sourceLocation, "VERIFY");  // no location => VERIFY (unverified)
});

// ---- J6: per-protocol categorization ----------------------------------------------------------
test("impactForProtocol: verified dose change on a used drug => EVIDENCE DIVERGENCE", () => {
  const ex = KB.sanitizeExtraction({ diseaseAreas: ["colorectal cancer"], changes: [
    { category: "dose_change", drug: "oxaliplatin", to: "100 mg/m2", sourceLocation: "p.42" } ] });
  const r = KB.impactForProtocol(ex, activeProtocol);
  assert.equal(r.status, "EVIDENCE DIVERGENCE");
  assert.equal(r.relevantChanges.length, 1);
});

test("impactForProtocol: new drug for the disease not in the regimen => NEW DRUG", () => {
  const ex = KB.sanitizeExtraction({ diseaseAreas: ["colorectal cancer"], changes: [
    { category: "new_treatment_option", drug: "encorafenib", to: "add for BRAF V600E", sourceLocation: "p.10" } ] });
  assert.equal(KB.impactForProtocol(ex, activeProtocol).status, "NEW DRUG");
});

test("impactForProtocol: withdrawing a drug the protocol uses => CLINICAL REVIEW REQUIRED", () => {
  const ex = KB.sanitizeExtraction({ diseaseAreas: ["colorectal cancer"], changes: [
    { category: "drug_withdrawal", drug: "fluorouracil", sourceLocation: "p.5" } ] });
  assert.equal(KB.impactForProtocol(ex, activeProtocol).status, "CLINICAL REVIEW REQUIRED");
});

test("impactForProtocol: an UNVERIFIED (VERIFY source) change => CLINICAL REVIEW REQUIRED", () => {
  const ex = KB.sanitizeExtraction({ diseaseAreas: ["colorectal cancer"], changes: [
    { category: "dose_change", drug: "oxaliplatin", to: "85 mg/m2" } ] });  // no source
  assert.equal(KB.impactForProtocol(ex, activeProtocol).status, "CLINICAL REVIEW REQUIRED");
});

test("impactForProtocol: unrelated disease => NO CHANGE", () => {
  const ex = KB.sanitizeExtraction({ diseaseAreas: ["breast cancer"], changes: [
    { category: "dose_change", drug: "paclitaxel", to: "175 mg/m2", sourceLocation: "p.1" } ] });
  assert.equal(KB.impactForProtocol(ex, activeProtocol).status, "NO CHANGE");
});

test("impactForProtocol: severity precedence - review beats divergence when both present", () => {
  const ex = KB.sanitizeExtraction({ diseaseAreas: ["colorectal cancer"], changes: [
    { category: "dose_change", drug: "oxaliplatin", to: "100 mg/m2", sourceLocation: "p.42" },   // divergence
    { category: "drug_withdrawal", drug: "fluorouracil", sourceLocation: "p.5" } ] });            // review
  assert.equal(KB.impactForProtocol(ex, activeProtocol).status, "CLINICAL REVIEW REQUIRED");
});

// ---- J6: batch job ----------------------------------------------------------------------------
test("protocolUpdateJob: compares ONLY ACTIVE protocols, counts categories + statuses", () => {
  const ex = KB.sanitizeExtraction({ title: "NCCN Colon", diseaseAreas: ["colorectal cancer"], changes: [
    { category: "dose_change", drug: "oxaliplatin", to: "100 mg/m2", sourceLocation: "p.42" },
    { category: "new_treatment_option", drug: "encorafenib", sourceLocation: "p.10" },
    { category: "no_material_change", description: "editorial", sourceLocation: "p.1" } ] });
  const report = KB.protocolUpdateJob(ex, [activeProtocol, draftProtocol], { now: 123, extractionId: "ex1" });
  assert.equal(report.kind, "onco-update-impact-report");
  assert.equal(report.protocolsCompared, 1);            // draftProtocol excluded (not ACTIVE)
  assert.equal(report.protocols.length, 1);
  assert.equal(report.protocols[0].status, "EVIDENCE DIVERGENCE"); // divergence beats new-drug
  assert.equal(report.categoryCounts.dose_change, 1);
  assert.equal(report.categoryCounts.new_treatment_option, 1);
  assert.equal(report.statusCounts["EVIDENCE DIVERGENCE"], 1);
  assert.equal(report.generatedAt, 123);
  assert.equal(report.extractionId, "ex1");
});

test("protocolUpdateJob: NEVER mutates an input protocol (deep-equality before/after)", () => {
  const snapshot = structuredClone(activeProtocol);
  const ex = KB.sanitizeExtraction({ diseaseAreas: ["colorectal cancer"], changes: [
    { category: "dose_change", drug: "oxaliplatin", to: "100 mg/m2", sourceLocation: "p.42" } ] });
  KB.protocolUpdateJob(ex, [activeProtocol], { now: 1 });
  assert.deepEqual(activeProtocol, snapshot, "the ACTIVE protocol object must be byte-for-byte unchanged");
});

// ---- store: writes ONLY proposed artifacts, never a protocol ----------------------------------
function fakeKv() {
  const map = new Map(); const writes = [];
  return {
    writes,
    async put(k, v) { writes.push(k); map.set(k, v); },
    async get(k, t) { const v = map.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); },
    async list({ prefix }) { return { keys: [...map.keys()].filter((k) => k.indexOf(prefix) === 0).map((name) => ({ name })) }; },
    async delete(k) { map.delete(k); }
  };
}

test("KB store: the whole upload->analyze->impact flow writes ONLY onco:kb:(ev|ex|ir): keys", async () => {
  const kv = fakeKv();
  const ev = await STORE.saveEvidence(kv, { title: "NCCN Colon", org: "NCCN", licensed: true, pdfB64: "x", uploadDate: 1 });
  const ex = await STORE.saveExtraction(kv, { evidenceId: ev.id, title: "NCCN Colon", diseaseAreas: ["colorectal cancer"], changes: [], createdAt: 2 });
  await STORE.markEvidenceExtracted(kv, ev.id, ex.id);
  const report = KB.protocolUpdateJob(ex, [activeProtocol], { now: 3, extractionId: ex.id });
  await STORE.saveImpactReport(kv, report);

  assert.ok(kv.writes.length >= 3);
  kv.writes.forEach((k) => assert.match(k, /^onco:kb:(ev|ex|ir):/, "unexpected key written: " + k));
  // Explicitly prove no protocol/plan/dose namespace was ever touched.
  kv.writes.forEach((k) => assert.ok(!/protocol|q_onco_plans|q_onco_cycles|dose/i.test(k), "a protocol/plan/dose key was written: " + k));
});

test("KB store: listEvidence never leaks the raw PDF bytes", async () => {
  const kv = fakeKv();
  await STORE.saveEvidence(kv, { title: "T", licensed: true, pdfB64: "SECRETPDFBYTES", uploadDate: 1 });
  const list = await STORE.listEvidence(kv);
  assert.equal(list.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(list[0], "pdfB64"), false);
});
