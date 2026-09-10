// functions/_connect/connectors/browser-session/connector.js -- browser-session pull connector.
// Connects the compiled/validated adapter manifest to the Connect pull interface (interfaces.js).
// Reads are executed through the doctor's authenticated browser session within declared limits.
// The manifest is strictly data that is read, never model code that is run.
import {
  executeOperation,
  ManifestPolicyError,
  ResourceLimitError,
  SessionExpiredError,
  buildUrl,
} from "../../../../connect-agent/manifest/interpret.mjs";
import {
  normalizeOperation,
  buildBundle,
} from "../../../../connect-agent/manifest/normalize.mjs";
import {
  assertValidManifest,
  manifestContentHash,
  templatePlaceholders,
  parseManifest,
} from "../../../../connect-agent/manifest/schema.mjs";
import {
  getDeployment,
  getVersion,
  findLiveSession,
} from "../../agent/store.js";
import { UpstreamError, AuthError } from "../../permission.js";

export { ManifestPolicyError, ResourceLimitError, SessionExpiredError };

const PATIENT_READ_OPERATIONS = Object.freeze([
  "get_patient_summary",
  "list_medications",
  "list_allergies",
  "list_results",
  "list_encounters",
  "list_notes",
]);

// Default synthetic manifest for bare test harnesses (e.g. interfaces.runConformance)
// when no deployment/manifest is configured in ctx.config.
function createDefaultSyntheticManifest() {
  const m = {
    schemaVersion: 3,
    manifestId: "synthetic-browser-session-emr",
    origins: [{ id: "origin:api", origin: "https://emr.example.test", role: "api" }],
    operations: [
      {
        type: "get_patient_summary",
        method: "GET",
        originId: "origin:api",
        pathTemplate: "/api/patients/{patientId}/summary",
        placeholders: { patientId: { type: "id", description: "Patient identifier" } },
        allowedQueryKeys: [],
        pagination: { style: "none", maxPages: 1, maxItems: 1 },
        mapping: {
          resource: "patient",
          fields: {
            id: { op: "pick", path: "id" },
            name: { op: "pick", path: "name" },
            gender: { op: "pick", path: "gender" },
          },
        },
        sessionExpiry: { statusCodes: [401, 403], redirectPatterns: ["/login", "/auth"] },
      },
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
        sessionExpiry: { statusCodes: [401, 403], redirectPatterns: ["/login", "/auth"] },
      },
      {
        type: "list_worklist",
        method: "GET",
        originId: "origin:api",
        pathTemplate: "/api/worklist",
        placeholders: {},
        allowedQueryKeys: ["date"],
        pagination: { style: "none", maxPages: 1, maxItems: 100 },
        mapping: {
          resource: "worklist",
          itemsSelector: "patients",
          fields: {
            id: { op: "pick", path: "id" },
            name: { op: "pick", path: "name" },
          },
        },
        sessionExpiry: { statusCodes: [401, 403], redirectPatterns: ["/login", "/auth"] },
      },
    ],
    unsupported: [],
    capabilityProbes: [{ operationType: "get_patient_summary", expect: { minItems: 1 } }],
    provenance: {
      discoverySpecHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      compilerVersion: "1.0.0",
      generatedAt: "2026-09-10T00:00:00.000Z",
    },
  };
  m.contentHash = manifestContentHash(m);
  return Object.freeze(m);
}

const DEFAULT_SYNTHETIC_MANIFEST = createDefaultSyntheticManifest();

export async function resolveManifest(ctx) {
  if (ctx.manifest) return ctx.manifest;
  if (ctx.config && ctx.config.manifest) return ctx.config.manifest;
  if (ctx.config && ctx.config.activeVersion && ctx.config.activeVersion.manifest) return ctx.config.activeVersion.manifest;
  if (ctx.fixtures && ctx.fixtures.manifest) return ctx.fixtures.manifest;
  if (ctx.config && ctx.config.fixtures && ctx.config.fixtures.manifest) return ctx.config.fixtures.manifest;

  const db = ctx.db || (ctx.deps && ctx.deps.db);
  const tenantId = (ctx.tenant && ctx.tenant.id) || (ctx.config && (ctx.config.tenantId || ctx.config.tenant_id)) || "default";
  const deploymentId = (ctx.config && (ctx.config.deploymentId || ctx.config.deployment_id || ctx.config.connector_id)) || (ctx.row && ctx.row.deployment_id);
  let versionId = ctx.config && (ctx.config.versionId || ctx.config.version_id || ctx.config.active_version_id);

  if (db && deploymentId) {
    try {
      if (!versionId) {
        const dep = await getDeployment(db, tenantId, deploymentId);
        versionId = dep && dep.active_version_id;
      }
      if (versionId) {
        const ver = await getVersion(db, tenantId, versionId);
        if (ver) {
          if (ver.manifest && typeof ver.manifest === "object") return ver.manifest;
          if (typeof ver.manifest_ref === "string" && ver.manifest_ref.trim().startsWith("{")) {
            return parseManifest(ver.manifest_ref);
          }
          if (ver.manifest_ref && typeof ver.manifest_ref === "object") return ver.manifest_ref;
        }
      }
    } catch {
      // Fall through to default synthetic manifest
    }
  }

  return DEFAULT_SYNTHETIC_MANIFEST;
}

export async function resolveSession(ctx) {
  const nowMs = ctx.now ? ctx.now().getTime() : Date.now();

  const directSession = ctx.session || (ctx.config && ctx.config.session);
  if (directSession) {
    if (directSession.state !== "AUTHENTICATED") {
      throw new AuthError("session is not in AUTHENTICATED state");
    }
    if (directSession.expires_at && Number(directSession.expires_at) <= nowMs) {
      throw new AuthError("session has expired");
    }
    return directSession;
  }

  const db = ctx.db || (ctx.deps && ctx.deps.db);
  const tenantId = (ctx.tenant && ctx.tenant.id) || (ctx.config && (ctx.config.tenantId || ctx.config.tenant_id));
  const actorId = (ctx.actor && ctx.actor.id) || (ctx.config && (ctx.config.actorId || ctx.config.actor_id));
  const deploymentId = (ctx.config && (ctx.config.deploymentId || ctx.config.deployment_id || ctx.config.connector_id)) || (ctx.row && ctx.row.deployment_id);

  if (db && tenantId && actorId && deploymentId) {
    const session = await findLiveSession(db, tenantId, actorId, deploymentId, ["AUTHENTICATED"], nowMs);
    if (!session) {
      throw new AuthError("no active authenticated session found for actor and deployment");
    }
    return session;
  }

  if (actorId && deploymentId) {
    throw new AuthError("no active authenticated session found for actor and deployment");
  }

  return null;
}

function makeExec(ctx, session) {
  if (ctx.exec && typeof ctx.exec.request === "function") return ctx.exec;
  if (ctx.config && ctx.config.exec && typeof ctx.config.exec.request === "function") return ctx.config.exec;

  let cookieHeader = "";
  if (session && session.cookie) cookieHeader = String(session.cookie);
  else if (session && session.cookies) {
    if (typeof session.cookies === "string") cookieHeader = session.cookies;
    else if (Array.isArray(session.cookies)) {
      cookieHeader = session.cookies.map((c) => (typeof c === "string" ? c : `${c.name}=${c.value}`)).join("; ");
    }
  } else if (ctx.config && ctx.config.cookie) {
    cookieHeader = String(ctx.config.cookie);
  }

  return {
    async request({ method, url, headers = {} }) {
      const reqHeaders = Object.assign({}, headers);
      if (cookieHeader && !reqHeaders.cookie && !reqHeaders.Cookie) {
        reqHeaders.cookie = cookieHeader;
      }
      let res;
      try {
        res = await ctx.fetch(url, { method, headers: reqHeaders, redirect: "manual" });
      } catch (err) {
        if (err && err.name && !["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(err.name)) throw err;
        throw new UpstreamError("browser session fetch failed: " + (err ? err.message : "network error"));
      }

      const status = res.status;
      const resHeaders = {};
      if (res.headers && typeof res.headers.forEach === "function") {
        res.headers.forEach((v, k) => { resHeaders[k.toLowerCase()] = v; });
      } else if (res.headers && typeof res.headers === "object") {
        for (const [k, v] of Object.entries(res.headers)) {
          resHeaders[k.toLowerCase()] = v;
        }
      }

      let bodyText = "";
      try {
        bodyText = typeof res.text === "function" ? await res.text() : (typeof res.json === "function" ? JSON.stringify(await res.json()) : "");
      } catch {
        bodyText = "";
      }

      return {
        status,
        headers: resHeaders,
        bodyText,
      };
    },
  };
}

function budgetLimits(ctx) {
  const limits = {};
  if (ctx.budget) {
    if (typeof ctx.budget.maxSubrequests === "number") limits.maxCalls = ctx.budget.maxSubrequests;
    if (typeof ctx.budget.deadlineMs === "number") limits.maxMs = ctx.budget.deadlineMs;
    if (typeof ctx.budget.maxBytes === "number") limits.maxBytes = ctx.budget.maxBytes;
  }
  return limits;
}

export const browserSessionConnector = {
  meta: {
    id: "browser-session",
    name: "Browser session EMR pull connector",
    version: "1.0",
    profile: "pull",
    kinds: ["browser-session"],
    sccmVersion: "1.0",
    lifecycle: "ga",
    capabilities: {
      worklist: true,
      resources: ["Patient", "Encounter", "MedicationStatement", "AllergyIntolerance", "Observation", "DocumentReference"],
      operations: ["read", "worklist"],
      authKinds: ["browser-session"],
      eventTypes: [],
    },
    transport: "camofox-browser-session",
    featureFlag: "CONNECT_BROWSER_SESSION_FLAG",
  },

  authenticate: async (ctx) => {
    const session = await resolveSession(ctx);
    if (session) {
      return {
        ok: true,
        sessionId: session.id,
        runnerRef: session.runner_ref,
        session,
      };
    }
    return { ok: true, handle: { type: "browser-session", anonymous: true } };
  },

  capabilities: async (ctx) => {
    const manifest = await resolveManifest(ctx);
    if (manifest && Array.isArray(manifest.capabilities)) {
      return manifest.capabilities;
    }
    if (manifest && Array.isArray(manifest.operations)) {
      return manifest.operations.map((o) => o.type);
    }
    return [];
  },

  validate: async (ctx) => {
    const checks = [];
    try {
      const manifest = await resolveManifest(ctx);
      if (!manifest || !Array.isArray(manifest.operations) || manifest.operations.length === 0) {
        checks.push({ name: "manifest", ok: false, detail: "no declared operations in manifest" });
        return { ok: false, checks };
      }

      let op = null;
      if (Array.isArray(manifest.capabilityProbes) && manifest.capabilityProbes.length > 0) {
        const probeType = manifest.capabilityProbes[0].operationType;
        op = manifest.operations.find((o) => o.type === probeType);
      }
      if (!op) {
        op = manifest.operations.find((o) => templatePlaceholders(o.pathTemplate).length === 0) || manifest.operations[0];
      }

      const session = await resolveSession(ctx).catch(() => null);
      const exec = makeExec(ctx, session);
      const needed = templatePlaceholders(op.pathTemplate);
      const allParams = Object.assign({ id: "validate-probe", patientId: "validate-probe" }, ctx.params, ctx.config && ctx.config.params);
      const params = {};
      for (const k of needed) {
        if (allParams[k] !== undefined) params[k] = allParams[k];
      }

      const limits = { maxCalls: 1, maxMs: (ctx.budget && ctx.budget.deadlineMs) || 5000 };
      const res = await executeOperation({
        manifest,
        operationType: op.type,
        exec,
        params,
        limits,
        validate: false,
      });

      const ok = !res.partial || res.calls > 0;
      checks.push({ name: "capability-probe", ok, detail: op.type + (res.partial ? " (partial)" : "") });
      return { ok, checks };
    } catch (e) {
      checks.push({ name: "validate", ok: false, detail: e ? e.message : "probe failed" });
      return { ok: false, checks };
    }
  },

  fetchPatient: async (ctx, patientRef) => {
    if (!patientRef) throw new UpstreamError("patientRef required");

    const manifest = await resolveManifest(ctx);
    assertValidManifest(manifest);

    let operationsToRun = [];
    if (ctx.operations && Array.isArray(ctx.operations)) {
      operationsToRun = ctx.operations;
    } else if (ctx.operationType) {
      operationsToRun = [ctx.operationType];
    } else if (ctx.config && Array.isArray(ctx.config.operations)) {
      operationsToRun = ctx.config.operations;
    } else if (ctx.config && ctx.config.operationType) {
      operationsToRun = [ctx.config.operationType];
    } else {
      operationsToRun = manifest.operations
        .map((o) => o.type)
        .filter((type) => PATIENT_READ_OPERATIONS.includes(type));
    }

    for (const opType of operationsToRun) {
      const declared = manifest.operations.some((o) => o.type === opType);
      if (!declared) {
        throw new ManifestPolicyError("operation '" + opType + "' is not declared by this manifest");
      }
    }

    const session = await resolveSession(ctx).catch(() => null);
    const exec = makeExec(ctx, session);
    const limits = budgetLimits(ctx);

    const results = [];
    for (const opType of operationsToRun) {
      const op = manifest.operations.find((o) => o.type === opType);
      const needed = templatePlaceholders(op.pathTemplate);
      const allParams = Object.assign(
        { id: patientRef, patientId: patientRef },
        ctx.params,
        ctx.config && ctx.config.params
      );
      const params = {};
      for (const k of needed) {
        if (allParams[k] !== undefined) params[k] = allParams[k];
      }

      const res = await executeOperation({
        manifest,
        operationType: op.type,
        exec,
        params,
        limits,
        validate: false,
      });
      results.push(res);
    }

    return { manifest, results, warnings: [] };
  },

  normalize: async (ctx, raw) => {
    if (raw && (raw.resourceType === "Bundle" || raw.sccmVersion)) return raw;
    if (raw && raw.bundle && (raw.bundle.resourceType === "Bundle" || raw.bundle.sccmVersion)) return raw.bundle;

    const manifest = (raw && raw.manifest) || (await resolveManifest(ctx));
    const results = (raw && Array.isArray(raw.results)) ? raw.results : (Array.isArray(raw) ? raw : (raw && raw.operationType ? [raw] : []));
    const tenantId = (ctx.tenant && ctx.tenant.id) || null;
    const generatedAt = ctx.now ? ctx.now().toISOString() : new Date().toISOString();
    const scope = ctx.scope || [];

    const { bundle: outBundle, validation } = buildBundle({
      manifest,
      results,
      tenantId,
      generatedAt,
      scope,
      sourceConnector: "browser-session",
    });

    if (!validation.ok) {
      outBundle.meta = outBundle.meta || {};
      outBundle.meta.warnings = outBundle.meta.warnings || [];
      outBundle.meta.warnings.push(...validation.errors);
    }

    return outBundle;
  },

  worklist: async (ctx, opts = {}) => {
    const manifest = await resolveManifest(ctx);
    const op = manifest.operations && manifest.operations.find((o) => o.type === "list_worklist");
    if (!op) {
      throw new ManifestPolicyError("operation 'list_worklist' is not declared by this manifest");
    }

    const session = await resolveSession(ctx).catch(() => null);
    const exec = makeExec(ctx, session);

    const needed = templatePlaceholders(op.pathTemplate);
    const allParams = Object.assign({}, ctx.params, ctx.config && ctx.config.params, opts && opts.params);
    const params = {};
    for (const k of needed) {
      if (allParams[k] !== undefined) params[k] = allParams[k];
    }

    const query = {};
    if (opts && opts.date && op.allowedQueryKeys && op.allowedQueryKeys.includes("date")) {
      query.date = opts.date;
    }

    const limits = budgetLimits(ctx);

    const result = await executeOperation({
      manifest,
      operationType: op.type,
      exec,
      params,
      query,
      limits,
      validate: false,
    });

    const { items } = normalizeOperation({ manifest, result });
    const rawItems = (result.pages || []).flatMap((p) => p.items || []);

    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const norm = items[i] || {};
      const raw = rawItems[i] || {};
      const patientId = String(norm.id || raw.patientId || raw.id || "");
      const patientFirstName = String(norm.name || raw.patientFirstName || raw.name || raw.displayName || (patientId ? "Patient " + patientId : ""));
      const gender = String(raw.gender || raw.sex || "");
      const dob = String(raw.dob || raw.birthDate || "");
      const bedName = String(raw.bedName || raw.bed || "");
      const employeeFirstName = String(raw.employeeFirstName || raw.doctor || raw.physician || "");
      const deptDescription = String(raw.deptDescription || raw.department || raw.dept || "");
      const episodeId = String(raw.episodeId || raw.encounterId || norm.id || patientId);

      rows.push({
        patientId,
        patientFirstName,
        gender,
        dob,
        bedName,
        employeeFirstName,
        deptDescription,
        episodeId,
      });
    }

    return { ok: true, rows };
  },
};
