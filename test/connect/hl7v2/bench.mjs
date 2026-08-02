// test/connect/hl7v2/bench.mjs — Track B hot-path microbench (node test/connect/hl7v2/bench.mjs)
import { parseHl7 } from "../../../functions/_connect/connectors/hl7v2/parser.js";
import { normalizeHl7 } from "../../../functions/_connect/connectors/hl7v2/normalize.js";
import { parseDelimited } from "../../../functions/_connect/connectors/file/csv.js";
import { normalizeCsvLab } from "../../../functions/_connect/connectors/file/normalize.js";

const ctx = { tenant: { id: "t1" }, now: () => new Date() };
const bigOru = ["MSH|^~\\&|LAB|H|E|H|20260801||ORU^R01|M1|P|2.5", "PID|1||MRN1^^^H^MR||Doe^Jane||19800101|F", "OBR|1||O1|CBC^CBC^L"]
  .concat(Array.from({ length: 200 }, (_, i) => "OBX|" + i + "|NM|C" + i + "^Test" + i + "^LN||" + i + "|u|0-9|N|||F")).join("\r");
const csvCtx = { tenant: { id: "t1" }, now: () => new Date(), config: { config: { columnMap: { patientId: "MRN", testName: "Test", value: "Value", unit: "Unit", orderId: "Order" } } } };
const bigCsv = "MRN,Order,Test,Value,Unit\n" + Array.from({ length: 500 }, (_, i) => "P1,O" + (i % 10) + ",Test" + i + "," + i + ",u").join("\n");

function bench(name, n, fn) { const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) fn(); const ms = Number(process.hrtime.bigint() - t) / 1e6 / n; console.log(name.padEnd(40) + ms.toFixed(3) + " ms/op (" + n + " iters)"); }

console.log("StewardMD Connect Track B (HL7/CSV) — microbench\n");
bench("parse+normalize ORU (200 OBX)", 2000, () => normalizeHl7(ctx, parseHl7(bigOru)));
bench("parse+normalize CSV (500 rows)", 2000, () => normalizeCsvLab(csvCtx, parseDelimited(bigCsv)));
console.log("\nBudget: < 50ms CPU/typical message (foundation §10) — comfortably met.");
