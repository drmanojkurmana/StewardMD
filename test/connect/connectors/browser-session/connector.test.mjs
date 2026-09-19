// test/connect/connectors/browser-session/connector.test.mjs -- browser-session connector tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserSessionConnector,
  ManifestPolicyError,
  resolveManifest,
  resolveSession,
  execFromFetch,
} from "../../../../functions/_connect/connectors/browser-session/connector.js";
import {
  assertConnector,
  runConformance as interfacesRunConformance,
} from "../../../../functions/_connect/interfaces.js";
import { runConformance as sdkRunConformance } from "../../../../functions/_connect/sdk/conformance.js";
import { validateBundle } from "../../../../functions/_connect/canonical/validate.js";
import { pullWorklist } from "../../../../functions/_connect/onboard/worklist.js";
import { OnboardError } from "../../../../functions/_connect/onboard/errors.js";
import { AuthError } from "../../../../functions/_connect/permission.js";
import { makeSecrets } from "../../../../functions/_connect/secrets.js";
import { makeMockKv } from "../../../../functions/_connect/testkit.js";
import { manifestContentHash } from "../../../../connect-agent/manifest/schema.mjs";
import { makeOnboardDb } from "../../onboard/onboard-db.mjs";

const env = {
  CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"),
  CONNECT_HMAC_SALT: "c2FsdA==",
};

const req = {};

const syntheticFetch = async (url) => {
  const u = String(url);
  if (u.includes("/summary")) {
    return new Response(
      JSON.stringify({ id: "P1", name: "Alice Test", gender: "female" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (u.includes("/results")) {
    return new Response(
      JSON.stringify({ results: [{ id: "R1", test: "HbA1c", value: "5.7" }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (u.includes("/worklist")) {
    return new Response(
      JSON.stringify({
        patients: [
          {
            id: "p10",
            name: "Test Patient",
            gender: "female",
            dob: "1992-04-15",
            bedName: "Bed 10",
            employeeFirstName: "Dr Sen",
            deptDescription: "Cardiology",
            episodeId: "ep-10",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (u.includes("/Encounter")) {
    return new Response(
      JSON.stringify({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Encounter",
              id: "enc-fhir-1",
              subject: { reference: "Patient/p-fhir-1", display: "FHIR Patient" },
              location: [{ location: { display: "Bed 1" } }],
              participant: [{ individual: { display: "Dr FHIR" } }],
              serviceType: { text: "General" },
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/fhir+json" } }
    );
  }
  if (u.includes("/Patient/p-fhir-1")) {
    return new Response(
      JSON.stringify({
        resourceType: "Patient",
        id: "p-fhir-1",
        name: [{ text: "FHIR Patient" }],
        gender: "male",
        birthDate: "1980-01-01",
      }),
      { status: 200, headers: { "content-type": "application/fhir+json" } }
    );
  }
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

function seedDb(membershipRole = "admin") {
  return makeOnboardDb({
    connect_membership: [{ user_id: "u1", tenant_id: "t1", role: membershipRole }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: "[]" }],
    connect_connector_config: [],
    connect_agent_session: [],
  });
}

function makeDeps(db, over = {}) {
  return {
    db,
    kv: makeMockKv(),
    secrets: makeSecrets(env),
    identifyFn: async () => ({ id: "u1", guest: false }),
    fetch: syntheticFetch,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
    ...over,
  };
}

test("1. assertConnector() and interfaces.runConformance() pass against synthetic manifest and fake exec", async () => {
  assert.doesNotThrow(() => assertConnector(browserSessionConnector));

  // The connector deliberately refuses to execute through a bare ctx.fetch (see connector.js's makeExec:
  // no session ever carries a real cookie, so a fallback fetch would be a silent unauthenticated request
  // to the hospital's own origin). A real caller injects a transport that actually runs inside the
  // browser session; here that is execFromFetch(syntheticFetch), fed to the harness via opts.exec.
  const res = await interfacesRunConformance(browserSessionConnector, {
    fetch: syntheticFetch,
    exec: execFromFetch(syntheticFetch),
    fixtures: { patientRef: "P1" },
  });
  assert.equal(res.passed, true, "interfaces.runConformance failed: " + JSON.stringify(res.checks.filter((c) => !c.ok)));
});

test("2. sdk.runConformance() passes against synthetic manifest and fake exec (all 10 checks)", async () => {
  const res = await sdkRunConformance(browserSessionConnector, {
    fetch: syntheticFetch,
    exec: execFromFetch(syntheticFetch),
    fixtures: { patientRef: "P1" },
  });
  assert.equal(res.passed, true, "sdk.runConformance failed: " + JSON.stringify(res.checks.filter((c) => !c.ok)));
  assert.equal(res.descriptor.profile, "pull");
  assert.equal(res.descriptor.lifecycle, "ga");
  assert.equal(res.checks.find((c) => c.name === "1-contract").ok, true);
  assert.equal(res.checks.find((c) => c.name === "2-authenticate").ok, true);
  assert.equal(res.checks.find((c) => c.name === "3-authenticate-retryable").ok, true);
  assert.equal(res.checks.find((c) => c.name === "4-capabilities").ok, true);
  assert.equal(res.checks.find((c) => c.name === "5-validate").ok, true);
  assert.equal(res.checks.find((c) => c.name === "6-valid-sccm").ok, true);
  assert.equal(res.checks.find((c) => c.name === "7-deterministic-ids").ok, true);
  assert.equal(res.checks.find((c) => c.name === "8-no-phi-in-audit").ok, true);
  assert.equal(res.checks.find((c) => c.name === "9-no-secret-leak").ok, true);
  assert.equal(res.checks.find((c) => c.name === "10-fail-closed").ok, true);
});

test("3. fetchPatient only calls declared operations; requesting undeclared operation throws ManifestPolicyError", async () => {
  await assert.rejects(
    async () => {
      await browserSessionConnector.fetchPatient(
        {
          fetch: syntheticFetch,
          operations: ["list_notes"],
        },
        "P1"
      );
    },
    (err) => {
      assert.ok(err instanceof ManifestPolicyError);
      assert.match(err.message, /operation 'list_notes' is not declared/);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await browserSessionConnector.fetchPatient(
        {
          fetch: syntheticFetch,
          operationType: "undeclared_op",
        },
        "P1"
      );
    },
    (err) => {
      assert.ok(err instanceof ManifestPolicyError);
      assert.match(err.message, /operation 'undeclared_op' is not declared/);
      return true;
    }
  );
});

test("4. normalize output passes validateBundle(bundle) with ok === true", async () => {
  const ctx = {
    fetch: syntheticFetch,
    exec: execFromFetch(syntheticFetch),
    tenant: { id: "t1" },
    scope: ["Patient", "Observation"],
  };

  const raw = await browserSessionConnector.fetchPatient(ctx, "P1");
  assert.ok(raw.results && raw.results.length > 0);

  const bundle = await browserSessionConnector.normalize(ctx, raw);
  assert.ok(bundle.sccmVersion, "bundle must have sccmVersion");
  assert.equal(bundle.patient.id, "P1");
  assert.equal(bundle.patient.name, "Alice Test");
  assert.equal(bundle.observations.length, 1);
  assert.equal(bundle.observations[0].code.text, "HbA1c");

  const validation = validateBundle(bundle);
  assert.equal(validation.ok, true, "validateBundle failed: " + (validation.errors || []).join("; "));
});

test("5. worklist() dispatch through functions/_connect/onboard/worklist.js#pullWorklist succeeds", async () => {
  const db = seedDb();
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-browser-1",
    kind: "browser-session",
    profile: "pull",
    base_url: "https://emr.example.test",
    config: JSON.stringify({ source: "onboard", type: "browser-session", name: "Browser Session EMR" }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  const deps = makeDeps(db, { exec: execFromFetch(syntheticFetch) });
  const res = await pullWorklist(deps, req, env, "t1", "conn-browser-1", { date: "2026-09-10" });

  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 1);

  const row = res.rows[0];
  assert.equal(row.patientId, "p10");
  assert.equal(row.patientFirstName, "Test Patient");
  assert.equal(row.gender, "female");
  assert.equal(row.dob, "1992-04-15");
  assert.equal(row.bedName, "Bed 10");
  assert.equal(row.employeeFirstName, "Dr Sen");
  assert.equal(row.deptDescription, "Cardiology");
  assert.equal(row.episodeId, "ep-10");

  // Verify FHIR path is unaffected
  const secrets = makeSecrets(env);
  const sealed = await secrets.seal(JSON.stringify({ method: "token", token: "fhir-tok-1" }));
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-fhir-1",
    kind: "fhir-r4",
    profile: "pull",
    base_url: "https://fhir.example.org",
    config: JSON.stringify({ source: "onboard", name: "FHIR Hospital", type: "fhir", authMethod: "token", sealed }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  const fhirRes = await pullWorklist(deps, req, env, "t1", "conn-fhir-1", { date: "2026-09-10" });
  assert.equal(fhirRes.ok, true);
  assert.equal(fhirRes.rows.length, 1);
  assert.equal(fhirRes.rows[0].patientId, "p-fhir-1");
  assert.equal(fhirRes.rows[0].patientFirstName, "FHIR Patient");

  // Verify non-worklist and non-FHIR connector throws OnboardError
  db._tables.connect_connector_config.push({
    tenant_id: "t1",
    connector_id: "conn-sql-1",
    kind: "sql",
    profile: "pull",
    base_url: "https://db.example.test",
    config: JSON.stringify({ source: "onboard", type: "sql" }),
    secret_ref: null,
    scope: "[]",
    status: "active",
  });

  await assert.rejects(
    async () => {
      await pullWorklist(deps, req, env, "t1", "conn-sql-1");
    },
    (err) => {
      assert.ok(err instanceof OnboardError);
      assert.equal(err.klass, "invalid");
      assert.match(err.message, /worklist is FHIR-only/);
      return true;
    }
  );
});

test("6. capabilities() reports exactly what manifest declares, nothing invented", async () => {
  const explicitCapsManifest = {
    schemaVersion: 3,
    manifestId: "custom-caps-emr",
    origins: [{ id: "origin:api", origin: "https://custom.example.test", role: "api" }],
    capabilities: ["Patient", "Observation"],
    operations: [],
    unsupported: [],
    provenance: { discoverySpecHash: "sha256:00", compilerVersion: "1.0.0", generatedAt: "2026-09-10T00:00:00Z" },
  };

  const caps1 = await browserSessionConnector.capabilities({ manifest: explicitCapsManifest });
  assert.deepEqual(caps1, ["Patient", "Observation"]);

  const opsManifest = {
    schemaVersion: 3,
    manifestId: "custom-ops-emr",
    origins: [{ id: "origin:api", origin: "https://custom.example.test", role: "api" }],
    operations: [
      { type: "get_patient_summary", method: "GET", originId: "origin:api", pathTemplate: "/patients/{patientId}" },
      { type: "list_medications", method: "GET", originId: "origin:api", pathTemplate: "/meds/{patientId}" },
    ],
    unsupported: [],
    provenance: { discoverySpecHash: "sha256:00", compilerVersion: "1.0.0", generatedAt: "2026-09-10T00:00:00Z" },
  };

  const caps2 = await browserSessionConnector.capabilities({ manifest: opsManifest });
  assert.deepEqual(caps2, ["get_patient_summary", "list_medications"]);

  // Default synthetic manifest declarations
  const defaultCaps = await browserSessionConnector.capabilities({});
  assert.deepEqual(defaultCaps, ["get_patient_summary", "list_results", "list_worklist"]);
});

test("7. authenticate() refuses with AuthError when no active session exists for actor+deployment", async () => {
  // Direct session in non-authenticated state
  await assert.rejects(
    async () => {
      await browserSessionConnector.authenticate({
        session: { state: "LOGIN_REQUIRED" },
      });
    },
    (err) => {
      assert.ok(err instanceof AuthError);
      assert.match(err.message, /session is not in AUTHENTICATED state/);
      return true;
    }
  );

  // Direct session expired
  await assert.rejects(
    async () => {
      await browserSessionConnector.authenticate({
        session: { state: "AUTHENTICATED", expires_at: 1000 },
        now: () => new Date(2000),
      });
    },
    (err) => {
      assert.ok(err instanceof AuthError);
      assert.match(err.message, /session has expired/);
      return true;
    }
  );

  // DB lookup where no session exists
  const emptyDb = seedDb();
  await assert.rejects(
    async () => {
      await browserSessionConnector.authenticate({
        db: emptyDb,
        tenant: { id: "t1" },
        actor: { id: "u1" },
        config: { deploymentId: "dep-1" },
      });
    },
    (err) => {
      assert.ok(err instanceof AuthError);
      assert.match(err.message, /no active authenticated session found/);
      return true;
    }
  );

  // DB lookup where active session exists succeeds
  const activeDb = seedDb();
  activeDb._tables.connect_agent_session.push({
    id: "sess-live-1",
    tenant_id: "t1",
    actor_id: "u1",
    deployment_id: "dep-1",
    runner_ref: "camofox-runner-ctx-42",
    state: "AUTHENTICATED",
    expires_at: 9999999999999,
    created_at: "2026-09-10T00:00:00Z",
  });

  const authRes = await browserSessionConnector.authenticate({
    db: activeDb,
    tenant: { id: "t1" },
    actor: { id: "u1" },
    config: { deploymentId: "dep-1" },
    now: () => new Date("2026-09-10T00:00:00Z"),
  });

  assert.equal(authRes.ok, true);
  assert.equal(authRes.sessionId, "sess-live-1");
  assert.equal(authRes.runnerRef, "camofox-runner-ctx-42");
});

test("8. Budgets are respected (ctx.budget.maxSubrequests limits executeOperation calls)", async () => {
  let callCount = 0;
  const countingFetch = async (url) => {
    callCount += 1;
    return new Response(
      JSON.stringify({ results: [{ id: "R" + callCount, test: "Test" + callCount, value: "10" }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const paginatedManifest = {
    schemaVersion: 3,
    manifestId: "paginated-emr",
    origins: [{ id: "origin:api", origin: "https://emr.example.test", role: "api" }],
    operations: [
      {
        type: "list_results",
        method: "GET",
        originId: "origin:api",
        pathTemplate: "/api/patients/{patientId}/results",
        placeholders: { patientId: { type: "id", description: "Patient identifier" } },
        allowedQueryKeys: ["page"],
        pagination: { style: "page", param: "page", maxPages: 5, maxItems: 100 },
        mapping: {
          resource: "observations",
          itemsSelector: "results",
          fields: {
            id: { op: "pick", path: "id" },
            category: { op: "const", value: "laboratory" },
            "code.text": { op: "pick", path: "test" },
            "value.value": { op: "pick", path: "value" },
            status: { op: "const", value: "final" },
          },
        },
        sessionExpiry: { statusCodes: [401, 403], redirectPatterns: [] },
      },
    ],
    unsupported: [],
    capabilityProbes: [{ operationType: "list_results", expect: { minItems: 0 } }],
    provenance: {
      discoverySpecHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      compilerVersion: "1.0.0",
      generatedAt: "2026-09-10T00:00:00.000Z",
    },
  };
  paginatedManifest.contentHash = manifestContentHash(paginatedManifest);

  const ctx = {
    manifest: paginatedManifest,
    operations: ["list_results"],
    fetch: countingFetch,
    exec: execFromFetch(countingFetch),
    budget: { maxSubrequests: 1 },
  };

  const raw = await browserSessionConnector.fetchPatient(ctx, "P1");
  assert.equal(raw.results.length, 1);
  assert.equal(raw.results[0].calls, 1);
  assert.equal(raw.results[0].partial, true);
  assert.ok(raw.results[0].warnings.some((w) => w.includes("call limit (1) reached")));
  assert.equal(callCount, 1);
});
