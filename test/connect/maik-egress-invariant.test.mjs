// test/connect/maik-egress-invariant.test.mjs — DUAL-ADVERSARIAL: the HARD invariant (spec §0, §4.6).
// With smd_connect_maik ON + a live bundle + egressBaaOk=false, ZERO patient bytes may reach the pkg the
// AI endpoint hands to renderGroundedPrompt/callGemini. The reviewers must try to smuggle bytes through
// any channel; every probe must fail to appear in pkg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyConnectContext, maikWiringOn } from "../../functions/_connect/maik-bridge/hook.js";
import { splitLanes } from "../../functions/_connect/maik-bridge/lanes.js";

const ON = { CONNECT_FLAG: "1", CONNECT_MAIK_FLAG: "1" };

// Distinctive markers that must NEVER reach the LLM prompt when egress is blocked.
const LIVE_BUNDLE = {
  patient: { gender: "male", birthDate: "1960-03-03" },
  conditions: [{ code: { text: "TESTOSIS-XYZ" }, clinicalStatus: "active" }],
  medications: [{ medication: { text: "ZZDRUG-777" }, status: "active" }],
  allergies: [{ code: { text: "ALLERGEN-QQ" }, criticality: "high" }],
  observations: [{ category: "laboratory", code: { text: "MARKERLAB" }, value: { value: 1.23, unit: "u" }, interpretation: "high" }],
  diagnosticReports: [{ code: { text: "R" }, conclusion: "IMPRESSION-MARKER" }],
  documents: [{ type: { text: "D" }, text: "DOCTEXT-MARKER" }],
};
const MARKERS = ["TESTOSIS-XYZ", "ZZDRUG-777", "ALLERGEN-QQ", "MARKERLAB", "IMPRESSION-MARKER", "DOCTEXT-MARKER"];

function pullBlocked() { return async () => splitLanes(LIVE_BUNDLE, { mode: "live", egressBaaOk: false }); }
function pullOpen() { return async () => splitLanes(LIVE_BUNDLE, { mode: "live", egressBaaOk: true }); }

test("flag helper requires BOTH smd_connect and smd_connect_maik", () => {
  assert.equal(maikWiringOn(ON), true);
  assert.equal(maikWiringOn({ CONNECT_FLAG: "1" }), false);
  assert.equal(maikWiringOn({ CONNECT_MAIK_FLAG: "1" }), false);
  assert.equal(maikWiringOn({}), false);
});

test("INVARIANT: live + no BAA => ZERO patient bytes in pkg (no smuggle path)", async () => {
  const pkg = { question: "what now?", patientCase: { age: 40 }, grounding: [], history: [] };
  const r = await applyConnectContext(ON, {}, pkg, { pullLanes: pullBlocked() });
  assert.equal(r.applied, false);
  const blob = JSON.stringify(r.pkg);
  for (const m of MARKERS) assert.equal(blob.includes(m), false, "SMUGGLE: '" + m + "' reached the LLM pkg");
  assert.ok(r.notice && r.notice.length);                    // a device-facing notice is available
  assert.equal(JSON.stringify(r.notice).includes("TESTOSIS-XYZ"), false);  // notice itself carries no PHI
});

test("egress OPEN (BAA present) => the same markers DO enter pkg (proves the block was the gate, not a bug)", async () => {
  const pkg = { question: "what now?", grounding: [] };
  const r = await applyConnectContext(ON, {}, pkg, { pullLanes: pullOpen() });
  assert.equal(r.applied, true);
  const blob = JSON.stringify(r.pkg);
  assert.ok(blob.includes("TESTOSIS-XYZ"));
  assert.ok(blob.includes("ZZDRUG-777"));
});

test("a thrown bridge error is swallowed (fail-safe) and adds nothing", async () => {
  const pkg = { question: "q", patientCase: { age: 50 }, grounding: [] };
  const before = JSON.stringify(pkg);
  const r = await applyConnectContext(ON, {}, pkg, { pullLanes: async () => { throw new Error("engine boom"); } });
  assert.equal(r.applied, false);
  assert.equal(JSON.stringify(r.pkg), before);
});
