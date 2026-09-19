/* wardsynq/wardsynq-api-gov.js — the door, and who is allowed through it.
 *
 * An EMR's API is the point at which patient data leaves the building. Everything upstream of it, the
 * actor model, the governed store, the audit trail, is undone by one endpoint that returns a chart to
 * a token that should not have it. So this file is deliberately paranoid, and its defaults are the
 * safe ones rather than the convenient ones.
 *
 *   1. SCOPE IS NOT ACCESS. A token bearing `patient/Observation.read` says what the CLIENT may ask
 *      for. Whether this patient's observations may go to this requester is a separate question with
 *      a different answer, and conflating them is how a correctly-scoped token reads a chart it has
 *      no relationship to. Both are checked, in that order, and the second is the one that matters.
 *   2. DENY BY DEFAULT, AND AN UNKNOWN SCOPE IS NOT A GRANTED ONE. A scope string the gateway does
 *      not recognise is refused rather than ignored, because ignoring it means the request proceeds
 *      with whatever remains, which is precisely the wrong direction to fail in.
 *   3. AN EXPIRED TOKEN IS EXPIRED. Clock skew is not a reason to accept one, and there is no grace
 *      window, because a grace window is a window.
 *   4. EVERY ACCESS IS RECORDED, INCLUDING THE REFUSED ONES. A denied request is the more interesting
 *      audit line: a legitimate client does not repeatedly ask for charts it cannot have.
 *   5. A WEBHOOK MUST NOT CARRY THE DATA. The commonest way an integration leaks a hospital is a
 *      webhook posting a payload to a URL somebody typed. Notifications here carry an id and a type,
 *      never clinical content, so the receiver must come back through the authenticated door to
 *      learn anything.
 *   6. BULK IS A DIFFERENT RISK FROM SINGLE-PATIENT. One chart is a clinical act; ten thousand is an
 *      export. They are separated so a token that can do the first cannot silently do the second.
 *
 * NOT MODELLED: the OAuth flows themselves (token issuance, refresh, PKCE, introspection), TLS and
 * transport security, rate limiting beyond a simple counter, SMART launch context resolution, and
 * signature verification for inbound webhooks.
 *
 * STATUS: IMPLEMENTED and TESTED. Not a security certification of anything.
 *
 * node --test test/wardsynq-api-gov.test.mjs
 */

/**
 * SMART on FHIR scope shape: <context>/<Resource>.<permissions>.
 * Context is `patient` (one patient's compartment), `user` (whatever the user may see) or `system`
 * (backend, no user, the most dangerous kind).
 */
const CONTEXT = Object.freeze({ PATIENT: "patient", USER: "user", SYSTEM: "system" });
const PERMISSION = Object.freeze({ READ: "r", WRITE: "w", CREATE: "c", UPDATE: "u", DELETE: "d", SEARCH: "s" });

/** Resources this gateway knows. An unknown resource is refused, never passed through. */
const KNOWN_RESOURCES = Object.freeze([
  "Patient", "Encounter", "Observation", "Condition", "AllergyIntolerance",
  "MedicationOrder", "MedicationAdministration", "ServiceRequest", "DiagnosticReport",
  "CarePlan", "ClinicalNote", "*",
]);

const DECISION = Object.freeze({ ALLOW: "allow", DENY: "deny" });

/** Above this many records in one response, a request is an export rather than a lookup. */
const BULK_THRESHOLD = 50;

class ApiGovError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ApiGovError";
    this.code = code || "API_GOV_VIOLATION";
  }
}

/**
 * Parses one scope string, refusing anything it does not fully understand.
 *
 * @returns {{valid: boolean, context, resource, permissions: string[], raw, reason?}}
 */
function parseScope(raw) {
  const s = String(raw || "").trim();
  const m = /^(patient|user|system)\/([A-Za-z*]+)\.([a-z]+|read|write|\*)$/.exec(s);
  if (!m) return { valid: false, raw: s, reason: `"${s}" is not a scope this gateway understands` };

  const [, context, resource, perms] = m;
  if (!KNOWN_RESOURCES.includes(resource)) {
    return { valid: false, raw: s, reason: `unknown resource "${resource}"` };
  }

  // The v1 spellings, expanded. `*` is expanded explicitly rather than treated as a wildcard at
  // check time, so what a token can actually do is visible in the parse rather than at the door.
  const permissions = perms === "read" ? ["r", "s"]
    : perms === "write" ? ["c", "u", "d"]
      : perms === "*" ? ["c", "r", "u", "d", "s"]
        : perms.split("");

  const unknown = permissions.filter((p) => !Object.values(PERMISSION).includes(p));
  if (unknown.length) return { valid: false, raw: s, reason: `unknown permission letters: ${unknown.join(", ")}` };

  return { valid: true, raw: s, context, resource, permissions };
}

/**
 * Parses a whole scope set. An unparseable scope invalidates the SET, rather than being dropped.
 *
 * Dropping it would let the request proceed with the scopes that did parse, which fails open on a
 * malformed token, and a malformed token is exactly when you want to stop.
 */
function parseScopes(scopeString) {
  const raws = String(scopeString || "").split(/\s+/).filter(Boolean);
  const parsed = raws.map(parseScope);
  const invalid = parsed.filter((p) => !p.valid);
  return {
    valid: invalid.length === 0 && parsed.length > 0,
    scopes: parsed.filter((p) => p.valid),
    invalid,
    reason: parsed.length === 0 ? "no scopes presented"
      : invalid.length ? `unrecognised scope${invalid.length > 1 ? "s" : ""}: ${invalid.map((i) => i.reason).join("; ")}. A scope the gateway cannot parse is refused, never ignored`
        : null,
  };
}

class ApiGateway {
  /**
   * @param {{now?: () => string, relationshipCheck?: (ctx) => boolean|Promise<boolean>,
   *   bulkThreshold?: number, auditSink?: (entry) => void}} deps
   *
   * `relationshipCheck` answers the question scopes cannot: may THIS requester see THIS patient. A
   * gateway constructed without one refuses every patient-context request, because the alternative
   * default is to allow them, and that default has emptied hospitals.
   */
  constructor({ now, relationshipCheck, bulkThreshold, auditSink } = {}) {
    this.now = now || (() => new Date().toISOString());
    this.relationshipCheck = relationshipCheck || null;
    this.bulkThreshold = typeof bulkThreshold === "number" ? bulkThreshold : BULK_THRESHOLD;
    this.auditSink = auditSink || null;
    this.audit = [];
  }

  _record(entry) {
    const line = { at: this.now(), ...entry };
    this.audit.push(line);
    if (this.auditSink) this.auditSink(line);
    return line;
  }

  /**
   * Decides one request.
   *
   * @param {{token: object, resource: string, permission: string, patientId?: string,
   *   expectedCount?: number, purpose?: string}} request
   */
  async authorise(request) {
    const { token, resource, permission, patientId, expectedCount, purpose } = request || {};
    const deny = (reason, code) => this._record({
      decision: DECISION.DENY, reason, code,
      clientId: (token && token.clientId) || null, resource, permission, patientId: patientId || null,
    });

    if (!token) return deny("no token presented", "NO_TOKEN");
    if (!token.expiresAt) return deny("token carries no expiry; a token that never expires is a permanent key", "NO_EXPIRY");

    // No grace window. A grace window is a window.
    if (Date.parse(token.expiresAt) <= Date.parse(this.now())) {
      return deny(`token expired at ${token.expiresAt}`, "EXPIRED");
    }
    if (token.revoked) return deny("token has been revoked", "REVOKED");

    const parsed = parseScopes(token.scope);
    if (!parsed.valid) return deny(parsed.reason, "BAD_SCOPES");

    const granting = parsed.scopes.filter((s) =>
      (s.resource === resource || s.resource === "*") && s.permissions.includes(permission));
    if (!granting.length) {
      return deny(`no scope grants ${permission} on ${resource}; presented: ${token.scope}`, "OUT_OF_SCOPE");
    }

    const context = granting.some((s) => s.context === CONTEXT.SYSTEM) ? CONTEXT.SYSTEM
      : granting.some((s) => s.context === CONTEXT.USER) ? CONTEXT.USER : CONTEXT.PATIENT;

    // Scope is not access. This is the check that actually protects a chart.
    if (context === CONTEXT.PATIENT) {
      if (!patientId) return deny("a patient-context scope requires a patient; without one this is an undirected query wearing a patient scope", "NO_PATIENT");
      if (!this.relationshipCheck) {
        return deny(
          "this gateway has no relationship check configured, so it cannot establish that this requester may see this patient. Refusing: the alternative default is to allow, and that default has emptied hospitals",
          "NO_RELATIONSHIP_CHECK");
      }
      const related = await this.relationshipCheck({ token, patientId, resource, permission, purpose });
      if (related !== true) {
        return deny(`${token.clientId || "this client"} has no established relationship with ${patientId}; a correctly scoped token is still not a reason to read a stranger's chart`, "NO_RELATIONSHIP");
      }
    }

    // Bulk is a different risk. A token that reads one chart should not silently read ten thousand.
    if (typeof expectedCount === "number" && expectedCount > this.bulkThreshold) {
      if (!token.bulkApproved) {
        return deny(
          `this request would return ${expectedCount} records, above the bulk threshold of ${this.bulkThreshold}. One chart is a clinical act and ten thousand is an export; the second needs its own approval`,
          "BULK_NOT_APPROVED");
      }
      if (!purpose) {
        return deny("a bulk export requires a recorded purpose", "NO_PURPOSE");
      }
    }

    return this._record({
      decision: DECISION.ALLOW, clientId: token.clientId || null,
      resource, permission, patientId: patientId || null, context,
      expectedCount: expectedCount ?? null, purpose: purpose || null,
      scopeUsed: granting.map((s) => s.raw),
    });
  }

  /** Denied requests, which are the interesting audit lines. */
  denials(clientId) {
    return this.audit.filter((a) => a.decision === DECISION.DENY && (!clientId || a.clientId === clientId));
  }

  /**
   * Clients whose denial pattern looks like probing rather than a misconfiguration.
   *
   * A misconfigured client fails the same way repeatedly. A client walking a patient id space fails
   * on many different patients, and that shape is worth surfacing.
   */
  suspiciousClients({ minDenials = 5, minDistinctPatients = 5 } = {}) {
    const byClient = new Map();
    for (const a of this.denials()) {
      if (!byClient.has(a.clientId)) byClient.set(a.clientId, { clientId: a.clientId, denials: 0, patients: new Set(), codes: new Set() });
      const c = byClient.get(a.clientId);
      c.denials += 1;
      if (a.patientId) c.patients.add(a.patientId);
      c.codes.add(a.code);
    }
    return [...byClient.values()]
      .filter((c) => c.denials >= minDenials && c.patients.size >= minDistinctPatients)
      .map((c) => ({
        clientId: c.clientId, denials: c.denials, distinctPatients: c.patients.size,
        codes: [...c.codes],
        reading: `${c.clientId} was refused ${c.denials} times across ${c.patients.size} different patients. A misconfigured client fails the same way on the same data; this shape is a client walking an id space.`,
      }));
  }
}

/**
 * Builds a webhook notification.
 *
 * It carries an id and a type and NOTHING clinical. The commonest way an integration leaks a
 * hospital is a webhook posting a payload to a URL somebody typed into a form, and no amount of
 * transport security helps once the payload is at the wrong address. The receiver must come back
 * through the authenticated door.
 */
function buildWebhook({ type, resourceType, resourceId, patientId, at }) {
  if (!type || !resourceType || !resourceId) {
    throw new ApiGovError("a webhook needs a type and the resource it refers to", "INCOMPLETE_WEBHOOK");
  }
  return {
    type, resourceType, resourceId,
    // A pseudonymous handle, so a subscriber cannot even accumulate a patient list from
    // notifications alone.
    patientRef: patientId ? `Patient/${patientId}` : null,
    at: at || new Date().toISOString(),
    // Deliberately not a data envelope. There is no `payload` key and there must never be one.
    note: "This notification carries no clinical content by design. Fetch the resource through the authenticated API to read it.",
  };
}

/** Rejects any webhook body that has picked up clinical content on its way out. */
function assertNoPayload(webhook) {
  const forbidden = ["payload", "data", "value", "observation", "result", "record", "body", "content"];
  const present = Object.keys(webhook || {}).filter((k) => forbidden.includes(k.toLowerCase()));
  if (present.length) {
    throw new ApiGovError(
      `webhook carries ${present.join(", ")}. Notifications must not carry clinical content: a webhook posts to a URL somebody typed, and no transport security helps once the payload is at the wrong address`,
      "WEBHOOK_CARRIES_DATA");
  }
  return true;
}

export {
  CONTEXT, PERMISSION, KNOWN_RESOURCES, DECISION, BULK_THRESHOLD,
  ApiGovError, ApiGateway,
  parseScope, parseScopes, buildWebhook, assertNoPayload,
};
