/* test/wardsynq-lab-connector-e2e.test.mjs - the on-premises analyser connector against the real WardSynQ routes.
 *
 * Both ends are the real code: connect-agent/analyser/index.mjs start() with its fetch pointed at the router's
 * onRequest, and simulated instruments on real localhost sockets. An HL7 v2 analyser sends an ORU^R01 over MLLP and
 * gets an AA only after the result is durably queued; the result lands on the Laboratory board's analyser inbox,
 * matched to the tube's accession number, and nowhere on the chart. An ASTM analyser asks for the orders on a tube
 * (host query) and gets back its own test codes.
 *
 * Routes: GET /api/queue/lab-connector/analyser-config, POST /api/queue/lab-connector/analyser-results,
 * POST /api/queue/lab-connector/analyser-orders, GET /api/queue/ward/analyser-inbox.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-lab-connector-e2e.test.mjs
 */
import { as, seed, docs, H, ENV, ORG_ID, ADMIN, NURSE, DOCTOR, onRequest } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { start } from "../connect-agent/analyser/index.mjs";
import * as mllp from "../connect-agent/analyser/mllp.mjs";
import * as astm from "../connect-agent/analyser/astm.mjs";

const LAB = "lab@example.test";
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const until = async (fn, ms) => { const end = Date.now() + (ms || 5000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 30)); } };

test("an HL7 analyser's result reaches the bench inbox through the connector, and an ASTM analyser's host query gets its codes back", async () => {
  seed();
  docs.set(`q_members/${ORG_ID}__${idFor(LAB).replace(/[^A-Za-z0-9_-]/g, "-")}`, { fields: { orgId: ORG_ID, identity: idFor(LAB), role: "lab", active: true }, updateTime: "t1" });
  const [hl7Port, astmPort] = [await freePort(), await freePort()];
  const map = [{ instrumentCode: "K", testName: "Potassium", unit: "mmol/L", orderedAs: "Renal profile" }, { instrumentCode: "NA", testName: "Sodium", unit: "mmol/L", orderedAs: "Renal profile" }];
  for (const a of [
    { name: "Chemistry HL7", ref: "chem-hl7", protocol: "hl7", transport: "tcp-server", host: "127.0.0.1", port: hl7Port, testMap: map },
    { name: "Chemistry ASTM", ref: "chem-astm", protocol: "astm", transport: "tcp-server", host: "127.0.0.1", port: astmPort, hostQuery: true, testMap: map },
  ]) assert.equal((await as(ADMIN, "/ward/lab-analyser-save", "POST", { orgId: ORG_ID, analyser: a })).__status, 200);
  const key = (await as(ADMIN, "/ward/lab-connector-key", "POST", { orgId: ORG_ID })).key;

  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Connector Patient", mobile: "9876500951", gender: "female", ageYears: 61 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: "2" });
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG_ID, encounterId: adm.encounterId, code: "Renal profile", category: "laboratory" });
  const col = await as(NURSE, "/ward/collect", "POST", { orgId: ORG_ID, serviceRequestId: sr.orderId, specimenType: "Serum" });
  assert.match(col.accessionNumber, /^ACC-/);

  const dir = await mkdtemp(path.join(os.tmpdir(), "wsq-lab-e2e-"));
  const keyFile = path.join(dir, "key");
  await writeFile(keyFile, key + "\n", { mode: 0o600 });
  const fetchImpl = (url, opts) => onRequest({ request: new Request(url, opts), env: ENV, waitUntil: () => {} });
  const app = await start({ serverUrl: "https://wardsynq.test", keyFile, dataDir: dir, logLevel: "silent",
    timeouts: { drainIntervalMs: 40, astm: { enqTimeoutMs: 3000, frameTimeoutMs: 3000 } } }, { fetchImpl });
  const sockets = [];
  try {
    assert.deepEqual(Object.keys(app.ports).sort(), ["an-chem-astm", "an-chem-hl7"]);

    // HL7 v2.5.1 ORU^R01 over MLLP, the tube's accession in OBR-3.
    const oru = [
      "MSH|^~\\&|CHEM|LAB|WARDSYNQ|HOSP|20260916083000||ORU^R01^ORU_R01|MSG0001|P|2.5.1",
      "PID|1||UNUSED",
      `OBR|1||${col.accessionNumber}|RENAL^Renal profile|||20260916082000`,
      "OBX|1|NM|K^Potassium||4.1|mmol/L|3.5-5.1|N|||F|||20260916083000",
      "OBX|2|NM|NA^Sodium||139|mmol/L|135-145|N|||F|||20260916083000",
    ].join("\r") + "\r";
    const s1 = net.connect(hl7Port, "127.0.0.1"); sockets.push(s1);
    await new Promise((r) => s1.once("connect", r));
    const dec = mllp.createMllpDecoder();
    const ack = new Promise((resolve) => s1.on("data", (d) => { const m = dec.push(d); if (m.length) resolve(m[0]); }));
    s1.write(mllp.encodeMllp(oru));
    assert.match(await ack, /\rMSA\|AA\|MSG0001/);

    const inbox = await until(async () => { const r = await as(LAB, "/ward/analyser-inbox?orgId=" + ORG_ID); return r.rows && r.rows.length ? r : null; });
    assert.ok(inbox, "the result reached the bench inbox");
    const row = inbox.rows[0];
    assert.equal(row.state, "pending");
    assert.equal(row.patientId, adm.patientId);
    assert.equal(row.serviceRequestId, sr.orderId);
    assert.deepEqual(row.results.map((x) => [x.testName, x.value]), [["Potassium", "4.1"], ["Sodium", "139"]]);
    assert.equal(H.RECORD._rows.filter((x) => x.resourceType === "DiagnosticReport").length, 0, "nothing on the chart until a technologist releases it");

    // ASTM host query: the instrument asks about the tube, the connector answers with this analyser's codes.
    const s2 = net.connect(astmPort, "127.0.0.1"); sockets.push(s2);
    await new Promise((r) => s2.once("connect", r));
    const sent = await astm.sendTransmission(s2, ["H|\\^&|||CHEM|||||||P|1", `Q|1|^${col.accessionNumber}||^^^ALL||||||||O`, "L|1|N"], { enqTimeoutMs: 3000, frameAckTimeoutMs: 3000 });
    assert.equal(sent.ok, true);
    const answer = await astm.receiveTransmission(s2, { enqTimeoutMs: 5000, frameTimeoutMs: 3000 });
    assert.equal(answer.ok, true, JSON.stringify(answer));
    const o = answer.records.find((r) => r[0] === "O").split("|");
    assert.equal(o[2], col.accessionNumber);
    assert.equal(o[4], "^^^K\\^^^NA");
    assert.equal(answer.records[answer.records.length - 1], "L|1|N");
  } finally {
    for (const s of sockets) s.destroy();
    await app.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
