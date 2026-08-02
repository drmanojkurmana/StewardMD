// test/connect/hl7v2/connector.test.mjs — Task 4/6: event-profile connectors (shape + ingest round-trip).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hl7v2Connector } from "../../../functions/_connect/connectors/hl7v2/connector.js";
import { fileConnector } from "../../../functions/_connect/connectors/file/connector.js";
import { assertConnector } from "../../../functions/_connect/interfaces.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";

const ctx = (config) => ({ tenant: { id: "t1" }, now: () => new Date(0), config: config || {}, budget: { maxSegments: 5000, maxRows: 1000 }, logger: { warn() {} } });

test("both connectors satisfy the event-profile contract", () => {
  assert.doesNotThrow(() => assertConnector(hl7v2Connector));
  assert.doesNotThrow(() => assertConnector(fileConnector));
  assert.equal(hl7v2Connector.meta.profile, "event");
  assert.equal(fileConnector.meta.profile, "event");
});

test("hl7 ingest round-trip -> handle + valid bundle; never throws on a malformed message", async () => {
  const oru = ["MSH|^~\\&|LAB|H|E|H|20260801||ORU^R01|M1|P|2.5", "PID|1||MRN1^^^H^MR||Doe^Jane||19800101|F", "OBR|1||O1|CBC^CBC^L", "OBX|1|NM|718-7^Hb^LN||9.2|g/dL|||F"].join("\r");
  const r = await hl7v2Connector.ingest(ctx(), { rawBody: oru });
  assert.equal(r.handle.type, "hl7");
  assert.equal(r.handle.msgType, "ORU");
  assert.equal(validateBundle(r.bundle).ok, true);
  await assert.doesNotReject(() => hl7v2Connector.ingest(ctx(), { rawBody: "\x01\x02 garbage not hl7" }));
});

test("file ingest round-trip -> handle + valid bundle", async () => {
  const cfg = { config: JSON.stringify({ columnMap: { patientId: "MRN", testName: "Test", value: "Value", unit: "Unit" } }) };
  const r = await fileConnector.ingest(ctx(cfg), { rawBody: "MRN,Test,Value,Unit\nP1,Glucose,90,mg/dL" });
  assert.equal(r.handle.type, "file");
  assert.equal(r.handle.rows, 1);
  assert.equal(validateBundle(r.bundle).ok, true);
});
