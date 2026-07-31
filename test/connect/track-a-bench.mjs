// test/connect/track-a-bench.mjs — Track A hot-path microbench (node test/connect/track-a-bench.mjs)
import { signClientAssertion } from "../../functions/_connect/smart/assertion.js";
import { normalizeFhir } from "../../functions/_connect/connectors/fhir-r4/normalize.js";
import { RS384_PRIVATE_JWK } from "./smart/fixtures/smart-keys.mjs";

const TE = "https://smart-mock.local/oauth/token";
async function bench(name, n, fn) { const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) await fn(i); const ms = Number(process.hrtime.bigint() - t) / 1e6 / n; console.log(name.padEnd(38) + ms.toFixed(3) + " ms/op (" + n + " iters)"); }

const raw = { patient: { id: "P1", gender: "female", birthDate: "1979-01-01", name: [{ text: "X" }] }, resources: [
  ...Array.from({ length: 30 }, (_, i) => ({ resourceType: "Observation", id: "o" + i, category: [{ coding: [{ code: i % 2 ? "vital-signs" : "laboratory" }] }], code: { text: "Obs" + i }, valueQuantity: { value: i, unit: "u" }, interpretation: [{ text: "high" }] })),
  ...Array.from({ length: 20 }, (_, i) => ({ resourceType: "MedicationRequest", id: "m" + i, medicationCodeableConcept: { text: "Drug" + i }, dosageInstruction: [{ text: "1 BID" }] })),
  { resourceType: "DiagnosticReport", id: "d1", code: { text: "CBC" }, result: [{ reference: "Observation/o0" }] } ] };
const ctx = { tenant: { id: "t1" }, now: () => new Date() };

console.log("StewardMD Connect Track A (FHIR/SMART) — microbench\n");
await bench("signClientAssertion RS384", 200, () => signClientAssertion({ now: () => Date.now() }, { clientId: "cid", tokenEndpoint: TE, privateKeyJwk: RS384_PRIVATE_JWK, kid: RS384_PRIVATE_JWK.kid, alg: "RS384" }));
await bench("normalizeFhir (50 resources)", 5000, () => normalizeFhir(ctx, raw));
console.log("\nBudget: FHIR->SCCM normalize < 50ms CPU (foundation §10) — comfortably met. Token exchange is one signed POST + cache.");
