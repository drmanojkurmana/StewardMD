// Linking an ABHA must also make the patient DISCOVERABLE. indexPatient() existed and was tested, but
// nothing ever called it: only the erasure sweep touched the index (unindexPatient), so it could be
// emptied and never filled - and discovery silently fell back to the ABHA-address arm alone, which is
// exactly the case the deterministic matcher was built to cover.
//
// Drives the REAL /api/abdm/link route, because "does the route pass the right fields" is the whole claim.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { matchDemographics, DEMOGRAPHIC_TABLE } from "../../../functions/_connect/abdm/demographic-index.js";

const canMock = typeof mock.module === "function";
const skip = canMock ? false : "needs --experimental-test-module-mocks";
let m1 = null;
if (canMock) {
  const at = (p) => new URL(p, import.meta.url).href;
  mock.module(at("../../../functions/_usage.js"), { namedExports: {
    identify: async () => ({ id: "doc-1", name: "Dr Test", guest: false }),
  }});
  mock.module(at("../../../functions/_connect/identity.js"), { namedExports: {
    resolveTenant: async (_db, _uid, tenantId) => ({ tenant: { id: tenantId } }),
  }});
  // /link never calls the gateway, but onRequest opens one session for the whole request.
  mock.module(at("../../../functions/_connect/abdm/gateway.js"), { namedExports: {
    makeGateway: () => ({ session: async () => "tok" }),
  }});
  ({ onRequest: m1 } = await import("../../../functions/api/abdm/[[path]].js"));
}

const ENV = () => ({
  ABDM_M1_FLAG: "1", CONNECT_FLAG: "1", ABDM_ENV: "sandbox",
  ABDM_CLIENT_ID: "SBX_1", ABDM_CLIENT_SECRET: "s", ABDM_HIP_ID: "IN2810006668", ABDM_HIU_ID: "IN2810006668",
  CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64"),
  CONNECT_MASTER_KEY: Buffer.from("connect-test-master-key-32-bytes").toString("base64"),
  CONNECT_DB: makeAbdmDb({}),
});

const link = async (env, body) => {
  const res = await m1({
    env, waitUntil: () => {},
    request: new Request("https://stewardmd.in/api/abdm/link", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
  });
  return { status: res.status, json: await res.json() };
};

const RAMESH = {
  tenantId: "t1", patientRef: "MR-001", abhaNumber: "12345678901234", abhaAddress: "ramesh@sbx",
  name: "Ramesh Kumar", gender: "M", yearOfBirth: 1985, mobile: "9876543210",
};

test("a link with verified demographics makes the patient discoverable by mobile", { skip }, async () => {
  const env = ENV();
  const { status, json } = await link(env, RAMESH);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.data.discoverable, true, JSON.stringify(json.data));

  // The real matcher, against the row the route just wrote - not an assertion about the row's shape.
  const m = await matchDemographics(env, { db: env.CONNECT_DB }, {
    tenantId: "t1",
    probe: { mobile: "9876543210", gender: "M", yearOfBirth: 1985, name: "Ramesh Kumar" },
  });
  assert.equal(m.matched, true, m.reason);
  assert.equal(m.patientRef, "MR-001");
  assert.deepEqual(m.matchedBy, ["MOBILE"]);
});

test("patient_ref doubles as the MRN arm's key", { skip }, async () => {
  const env = ENV();
  await link(env, RAMESH);
  const m = await matchDemographics(env, { db: env.CONNECT_DB }, {
    tenantId: "t1", probe: { mrn: "MR-001", gender: "M", yearOfBirth: 1985, name: "Ramesh Kumar" },
  });
  assert.equal(m.matched, true, m.reason);
  assert.deepEqual(m.matchedBy, ["MR"]);
});

test("without gender or year of birth NOTHING is written, and the route says so", { skip }, async () => {
  // Both discovery arms require gender AND age to corroborate, so such a row could never match. Writing
  // it would be noise in the index; the honest answer is discoverable:false.
  for (const missing of [{ gender: undefined }, { yearOfBirth: undefined }, { gender: undefined, yearOfBirth: undefined }]) {
    const env = ENV();
    const { status, json } = await link(env, { ...RAMESH, ...missing });
    assert.equal(status, 200);
    assert.equal(json.data.discoverable, false, JSON.stringify(missing));
    assert.equal((env.CONNECT_DB._tables[DEMOGRAPHIC_TABLE] || []).length, 0, "no row may be written");
    assert.ok(json.data.patientRef || json.data.linked || json.data.abhaLast4, "the LINK still succeeded");
  }
});

test("re-linking the same patient updates rather than duplicating", { skip }, async () => {
  // Two rows for one person read as ambiguity, which would suppress their own match.
  const env = ENV();
  await link(env, RAMESH);
  await link(env, { ...RAMESH, mobile: "9000000000" });
  assert.equal((env.CONNECT_DB._tables[DEMOGRAPHIC_TABLE] || []).length, 1);
  const m = await matchDemographics(env, { db: env.CONNECT_DB }, {
    tenantId: "t1", probe: { mobile: "9000000000", gender: "M", yearOfBirth: 1985, name: "Ramesh Kumar" },
  });
  assert.equal(m.matched, true, "the NEW number matches");
});

test("an index failure does not lose the ABHA binding", { skip }, async () => {
  // The binding is the durable artefact and certification pins it; discovery is an optimisation on top.
  const env = ENV();
  const realDb = env.CONNECT_DB;
  let calls = 0;
  env.CONNECT_DB = {
    ...realDb,
    prepare: (sql) => (/demographic/i.test(sql) && ++calls ? { bind: () => ({ first: async () => { throw new Error("d1 down"); }, run: async () => { throw new Error("d1 down"); }, all: async () => { throw new Error("d1 down"); } }) } : realDb.prepare(sql)),
  };
  const { status, json } = await link(env, RAMESH);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.data.discoverable, false);
  assert.match(json.data.indexError, /d1 down/);
  assert.ok(calls > 0, "the index was attempted");
});
