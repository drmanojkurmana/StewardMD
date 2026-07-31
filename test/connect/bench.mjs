// test/connect/bench.mjs — worst-case normalize throughput (run manually: node test/connect/bench.mjs)
import { normalizeFhir } from "../../functions/_connect/connectors/fhir-r4/normalize.js";
import { makeCtx } from "../../functions/_connect/interfaces.js";
const big = { patient: { id: "P1" }, resources: Array.from({ length: 500 }, (_, i) => ({ resourceType: "Observation", id: "O" + i, category: [{ coding: [{ code: "laboratory" }] }], code: { text: "lab" }, valueQuantity: { value: i } })) };
const N = 200, t = Date.now();
for (let i = 0; i < N; i++) normalizeFhir(makeCtx(), big);
const ms = (Date.now() - t) / N;
console.log("normalize 500-obs bundle: " + ms.toFixed(2) + " ms/patient (target < 50ms)");
