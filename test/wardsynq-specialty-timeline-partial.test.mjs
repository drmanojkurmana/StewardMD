/* A specialty timeline part that could not be read is named, never returned as an empty list. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let failTypes = new Set();
mock.module(new URL("../functions/_wardsynq/actor.js", import.meta.url).href, {
  namedExports: { resolveClinicalActor: async () => ({ actor: { id: "dr.a", scope: { read: null, write: null } }, tenant: {}, role: "doctor", source: "opd" }) },
});
mock.module(new URL("../functions/_wardsynq/service.js", import.meta.url).href, {
  namedExports: {
    RecordService: class {
      async byPatient(type) { if (failTypes.has(type)) throw new Error("read failed"); return []; }
      async get() { return null; }
    },
    isExternalRecord: () => false, externallyOwned: () => false, RESOURCE_TYPES: [], MODE: {}, NATIVE_SYSTEM: "wardsynq-native",
  },
});

const ONCO = await import("../functions/_wardsynq/migrate-oncology.js");
const CARDIO = await import("../functions/_wardsynq/migrate-cardiology.js");
const CTX = { migration: { mode: "native", tenantId: "t1" }, recordDeps: {}, actorDeps: {}, patientId: "p1" };

test("A FAILED CHEMOTHERAPY READ IS NAMED, never returned as 'no chemotherapy given'", async () => {
  failTypes = new Set([ONCO.CHEMO_TYPE]);
  const r = await ONCO.oncologyTimeline({}, {}, CTX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.incomplete, ["chemotherapy given"]);
  assert.match(r.warning, /Do not read those as empty/);
});

test("an oncology timeline that read everything carries no warning", async () => {
  failTypes = new Set();
  const r = await ONCO.oncologyTimeline({}, {}, CTX);
  assert.equal(r.incomplete, undefined);
  assert.equal(r.warning, undefined);
});

test("a failed ECG read is named on the cardiology timeline", async () => {
  failTypes = new Set([CARDIO.ECG_TYPE]);
  const r = await CARDIO.cardiologyTimeline({}, {}, CTX);
  assert.deepEqual(r.incomplete, ["ECGs"]);
});
