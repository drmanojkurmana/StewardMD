// test/connect/onboard/worklist.test.mjs: unit tests for the worklist capability seam.
// Verifies fake connectors declaring the capability via deps.connectors, deps.registry,
// and opts.connector, fallback to FHIR behavior, rejection of non-worklist connectors,
// and RBAC protections.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pullWorklist,
  hasWorklistCapability,
  resolveConnector,
  fhirWorklistProvider,
} from "../../../functions/_connect/onboard/worklist.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";
import { PermissionError } from "../../../functions/_connect/permission.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { createRegistry } from "../../../functions/_connect/sdk/registry.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const env = {
  CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"),
  CONNECT_HMAC_SALT: "c2FsdA==",
};

const req = {};

function seedDb(membershipRole = "admin") {
  return makeOnboardDb({
    connect_membership: [{ user_id: "u1", tenant_id: "t1", role: membershipRole }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
    connect_connector_config: [],
  });
}

function makeDeps(db, over = {}) {
  return {
    db,
    kv: makeMockKv(),
    secrets: makeSecrets(env),
    identifyFn: async () => ({ id: "u1", guest: false }),
    fetch: async () => new Response("{}", { status: 200 }),
    now: () => new Date("2026-09-10T00:00:00.000Z"),
    ...over,
  };
}

test("hasWorklistCapability detects flag and function declarations correctly", () => {
  assert.equal(hasWorklistCapability(null), false);
  assert.equal(hasWorklistCapability({}), false);
  assert.equal(hasWorklistCapability({ worklist: async () => {} }), true);
  assert.equal(hasWorklistCapability({ fetchWorklist: async () => {} }), true);
  assert.equal(hasWorklistCapability({ meta: { capabilities: { worklist: true } } }), true);
  assert.equal(hasWorklistCapability({ meta: { capabilities: { operations: ["read", "worklist"] } } }), true);
  assert.equal(hasWorklistCapability({ meta: { capabilities: { operations: ["read"] } } }), false);
});

test("fake connector declaring worklist via meta.capabilities.worklist is dispatched through the seam", async () => {
  const db = seedDb();
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-fake-1",
    kind: "custom-emr",
    profile: "pull",
    base_url: "https://emr.example.org",
    config: JSON.stringify({ source: "onboard", name: "Custom EMR", type: "custom-emr" }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  let dispatchedCtx = null;
  let dispatchedOpts = null;

  const fakeConnector = {
    meta: {
      id: "custom-emr",
      name: "Custom EMR",
      version: "1.0",
      profile: "pull",
      capabilities: {
        worklist: true,
      },
    },
    worklist: async (ctx, opts) => {
      dispatchedCtx = ctx;
      dispatchedOpts = opts;
      return {
        ok: true,
        rows: [
          {
            patientId: "p-42",
            patientFirstName: "Anita Sen",
            gender: "female",
            dob: "1990-01-01",
            bedName: "Bed 4",
            employeeFirstName: "Dr Roy",
            deptDescription: "Cardiology",
            episodeId: "ep-42",
          },
        ],
      };
    },
  };

  const deps = makeDeps(db, {
    connectors: { "custom-emr": fakeConnector },
  });

  const res = await pullWorklist(deps, req, env, "t1", "conn-fake-1", { date: "2026-09-10" });
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].patientFirstName, "Anita Sen");
  assert.equal(dispatchedOpts.date, "2026-09-10");
  assert.equal(dispatchedCtx.tenant.id, "t1");
  assert.equal(dispatchedCtx.connectionId, "conn-fake-1");
});

test("fake connector declaring worklist in operations array is dispatched through SDK registry", async () => {
  const db = seedDb();
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-reg-1",
    kind: "reg-emr",
    profile: "pull",
    base_url: "https://reg.example.org",
    config: JSON.stringify({ source: "onboard", name: "Registry EMR", type: "reg-emr" }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  const conformingConnector = {
    meta: {
      id: "reg-emr",
      name: "Registry EMR",
      version: "1.0",
      profile: "pull",
      kinds: ["reg-emr"],
      sccmVersion: "1.0",
      lifecycle: "beta",
      capabilities: {
        resources: ["Patient"],
        operations: ["read", "worklist"],
        authKinds: ["none"],
        eventTypes: [],
        emitsBundle: true,
        worklist: true,
      },
    },
    capabilities: async () => ({ resources: ["Patient"], operations: ["read", "worklist"] }),
    authenticate: async () => ({ ok: true }),
    validate: async () => ({ ok: true }),
    fetchPatient: async () => ({ id: "P1" }),
    normalize: async () => ({ meta: { sccmVersion: "1.0" }, patient: { id: "P1" } }),
    worklist: async () => ({
      ok: true,
      rows: [{ patientId: "p-99", patientFirstName: "Vikram Mehta" }],
    }),
  };

  const registry = createRegistry();
  registry.register(conformingConnector);

  const deps = makeDeps(db, { registry });
  const res = await pullWorklist(deps, req, env, "t1", "conn-reg-1");
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].patientId, "p-99");
});

test("direct connector override via opts.connector is dispatched", async () => {
  const db = seedDb();
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-override-1",
    kind: "override-emr",
    profile: "pull",
    base_url: "https://override.example.org",
    config: JSON.stringify({ source: "onboard", name: "Override EMR", type: "override-emr" }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  const overrideConnector = {
    worklist: async () => [{ patientId: "p-direct", patientFirstName: "Direct Patient" }],
  };

  const deps = makeDeps(db);
  const res = await pullWorklist(deps, req, env, "t1", "conn-override-1", {
    connector: overrideConnector,
  });
  assert.equal(res.ok, true);
  assert.equal(res.rows[0].patientId, "p-direct");
});

test("connector without worklist capability falls back to existing FHIR behavior for FHIR connections", async () => {
  const secrets = makeSecrets(env);
  const sealed = await secrets.seal(JSON.stringify({ method: "token", token: "fhir-tok-1" }));

  const db = seedDb();
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-fhir-1",
    kind: "fhir-r4",
    profile: "pull",
    base_url: "https://fhir.hospital.org",
    config: JSON.stringify({
      source: "onboard",
      name: "Hospital FHIR",
      type: "fhir",
      authMethod: "token",
      sealed,
    }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  const fhirFetch = async (url, init) => {
    const u = String(url);
    assert.equal(init.headers.Authorization, "Bearer fhir-tok-1");
    if (u.includes("/Encounter?")) {
      return new Response(JSON.stringify({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Encounter",
              id: "enc-101",
              subject: { reference: "Patient/pat-1", display: "" },
              location: [{ location: { display: "Ward 5 Bed 2" } }],
              participant: [{ individual: { display: "Dr Rao" } }],
              serviceType: { text: "Neurology" },
            },
          },
        ],
      }), { status: 200, headers: { "content-type": "application/fhir+json" } });
    }
    if (u.includes("/Patient/pat-1")) {
      return new Response(JSON.stringify({
        resourceType: "Patient",
        id: "pat-1",
        name: [{ text: "Kavita Nair" }],
        gender: "female",
        birthDate: "1988-12-04",
      }), { status: 200, headers: { "content-type": "application/fhir+json" } });
    }
    return new Response("not found", { status: 404 });
  };

  const deps = makeDeps(db, { fetch: fhirFetch });
  const res = await pullWorklist(deps, req, env, "t1", "conn-fhir-1", { date: "2026-09-10" });
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].patientId, "pat-1");
  assert.equal(res.rows[0].patientFirstName, "Kavita Nair");
  assert.equal(res.rows[0].bedName, "Ward 5 Bed 2");
  assert.equal(res.rows[0].employeeFirstName, "Dr Rao");
  assert.equal(res.rows[0].deptDescription, "Neurology");
  assert.equal(res.rows[0].episodeId, "enc-101");
  assert.equal(res.rows[0].gender, "female");
  assert.equal(res.rows[0].dob, "1988-12-04");
});

test("non-FHIR connection without worklist capability is rejected with exact existing error", async () => {
  const db = seedDb();
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-rest-1",
    kind: "rest-json",
    profile: "pull",
    base_url: "https://labs.example.org",
    config: JSON.stringify({ source: "onboard", name: "Lab API", type: "rest-json" }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  const deps = makeDeps(db);
  await assert.rejects(
    async () => pullWorklist(deps, req, env, "t1", "conn-rest-1"),
    (err) => {
      assert.ok(err instanceof OnboardError);
      assert.equal(err.klass, "invalid");
      assert.equal(err.message, "worklist is FHIR-only");
      return true;
    }
  );
});

test("connector declaring capability but lacking worklist function throws implementation error on non-FHIR", async () => {
  const db = seedDb();
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-broken-1",
    kind: "broken-emr",
    profile: "pull",
    base_url: "https://broken.example.org",
    config: JSON.stringify({ source: "onboard", name: "Broken EMR", type: "broken-emr" }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  const brokenConnector = {
    meta: {
      id: "broken-emr",
      capabilities: { worklist: true },
    },
    // No worklist function provided
  };

  const deps = makeDeps(db, {
    connectors: { "broken-emr": brokenConnector },
  });

  await assert.rejects(
    async () => pullWorklist(deps, req, env, "t1", "conn-broken-1"),
    (err) => {
      assert.ok(err instanceof OnboardError);
      assert.equal(err.klass, "invalid");
      assert.equal(err.message, "connector missing worklist implementation");
      return true;
    }
  );
});

test("auditor role is denied patient data (security fail-closed)", async () => {
  const db = seedDb("auditor");
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-audit-1",
    kind: "custom-emr",
    profile: "pull",
    base_url: "https://emr.example.org",
    config: JSON.stringify({ source: "onboard", name: "Custom EMR", type: "custom-emr" }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  const deps = makeDeps(db);
  await assert.rejects(
    async () => pullWorklist(deps, req, env, "t1", "conn-audit-1"),
    (err) => {
      assert.ok(err instanceof PermissionError);
      assert.match(err.message, /auditor may not read patient data/);
      return true;
    }
  );
});
