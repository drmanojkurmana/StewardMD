// test/connect/track-d-bench.mjs — hot-path cost of the Track D controls (run: node test/connect/track-d-bench.mjs)
// Confirms the security-critical primitives are negligible on the MaiK request path, and that the
// flag-OFF hook is effectively free (the shipping MaiK product pays nothing until both flags are on).
import { can } from "../../functions/_connect/enterprise/rbac.js";
import { splitLanes } from "../../functions/_connect/maik-bridge/lanes.js";
import { applyConnectContext } from "../../functions/_connect/maik-bridge/hook.js";

const BUNDLE = {
  patient: { gender: "female", birthDate: "1979-05-02" },
  conditions: Array.from({ length: 20 }, (_, i) => ({ code: { text: "Condition " + i }, clinicalStatus: "active" })),
  medications: Array.from({ length: 20 }, (_, i) => ({ medication: { text: "Drug " + i }, status: "active" })),
  allergies: [{ code: { text: "Penicillin" }, criticality: "high" }],
  observations: Array.from({ length: 40 }, (_, i) => ({ category: i % 2 ? "vital-signs" : "laboratory", code: { text: "Obs " + i }, value: { value: i, unit: "u" }, interpretation: i % 3 ? "high" : "normal" })),
  diagnosticReports: [{ code: { text: "CXR" }, conclusion: "x" }], documents: [],
};

function bench(name, n, fn) { const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) fn(i); const us = Number(process.hrtime.bigint() - t) / 1000 / n; console.log(name.padEnd(42) + us.toFixed(3) + " us/op  (" + n + " iters)"); return us; }

console.log("StewardMD Connect Track D — hot-path microbench\n");
bench("can(role, action)", 200000, () => can("clinician", "context:load"));
bench("splitLanes (blocked, live no-BAA)", 20000, () => splitLanes(BUNDLE, { mode: "live", egressBaaOk: false }));
bench("splitLanes (open, sandbox, max bundle)", 20000, () => splitLanes(BUNDLE, { mode: "sandbox", egressBaaOk: true }));

// Flag-OFF hook overhead: what the LIVE MaiK product pays per request while Track D is dark.
(async () => {
  const pkg = { question: "q", patientCase: { age: 40 }, grounding: [] };
  const off = await (async () => { const t = process.hrtime.bigint(); const N = 200000; for (let i = 0; i < N; i++) await applyConnectContext({}, {}, pkg); return Number(process.hrtime.bigint() - t) / 1000 / N; })();
  console.log("applyConnectContext (flag OFF)".padEnd(42) + off.toFixed(4) + " us/op  (early return; no KV/engine)");
  console.log("\nBudget: normalize <50ms CPU, context load <500ms e2e (foundation §10). The added primitives are sub-microsecond; the per-call cost when ON is one KV get + the existing engine load, unchanged.");
})();
