// functions/_connect/sdk/descriptor.js — Track C: connector lifecycle/capability descriptor.
// Pure (reads connector.meta only; no env/fetch/global state). Inference defaults (spec §3.1):
//   pull  -> lifecycle "ga",       emitsBundle true
//   event -> lifecycle "skeleton", emitsBundle false
// both overridable via meta.lifecycle / meta.capabilities.
//
// TASK 7 STEP 3 addition: `direction`/`identityStrategy`/`terminologyMappings`/`transport`/
// `retries`/`idempotency`/`ownership`/`readWrite`/`health`/`featureFlag`/`tenantScope` - the
// plan's own required contract fields for §7.9, added HERE rather than as a new abstraction.
// Two are STRUCTURAL FACTS this describe() can state honestly for every _connect connector
// without per-connector declaration, because they are enforced by the shared architecture, not
// claimed by any one connector:
//   - ownership: "external" always - RecordService (service.js) refuses to relabel externally-
//     sourced content as wardsynq-native for ANY connector; this is a write-layer invariant, not
//     a per-connector promise that could be wrong.
//   - readWrite: derived from which METHODS the profile requires (interfaces.js's own
//     PULL_METHODS/EVENT_METHODS) - a pull connector has no ingest method and cannot write; an
//     event connector's only way to affect the record IS ingest. Not asserted, derived.
//   - tenantScope: "single-tenant" always - TenantBackend has no parameter for another tenant.
// The rest (identityStrategy, terminologyMappings, transport, retries, idempotency, health,
// featureFlag) are per-connector facts this file cannot know on a connector's behalf, and
// defaulting them to something reassuring would be exactly the fabrication the plan forbids -
// they read from `meta` when a connector declares them, and `null` otherwise, honestly.
export const LIFECYCLES = Object.freeze(["experimental", "skeleton", "beta", "ga", "deprecated"]);

export function describe(connector) {
  const m = (connector && connector.meta) || {};
  const profile = m.profile;
  const emitsDefault = profile === "pull";                 // pull emits a bundle; event skeleton does not
  const caps = m.capabilities || {};
  return {
    id: m.id,
    name: m.name || m.id,
    version: m.version || "0",
    profile,
    // "outbound-pull": WardSynQ initiates the connection and fetches. "inbound-event": the
    // external system pushes, or an authorized actor initiates an event on WardSynQ's own door.
    direction: profile === "pull" ? "outbound-pull" : profile === "event" ? "inbound-event" : null,
    kinds: Array.isArray(m.kinds) ? m.kinds.slice() : [],
    sccmVersion: m.sccmVersion,
    lifecycle: m.lifecycle || (profile === "pull" ? "ga" : "skeleton"),
    capabilities: {
      resources: caps.resources || [],
      operations: caps.operations || [],
      authKinds: caps.authKinds || [],
      eventTypes: caps.eventTypes || [],
      emitsBundle: typeof caps.emitsBundle === "boolean" ? caps.emitsBundle : emitsDefault,
    },
    // Structural facts, true for every connector this shape governs - see the file header.
    ownership: "external",
    readWrite: profile === "pull" ? "read-only" : profile === "event" ? "write-via-ingest" : null,
    tenantScope: "single-tenant",
    // Per-connector facts. Never defaulted to anything but null: an unpopulated field says
    // "not declared", which is honest; a guessed value would not be.
    identityStrategy: m.identityStrategy || null,
    terminologyMappings: m.terminologyMappings || null,
    transport: m.transport || null,
    retries: m.retries || null,
    idempotency: m.idempotency || null,
    health: m.health || null,
    featureFlag: m.featureFlag || null,
  };
}

// Shape guard — mirrors assertConnector strictness. Throws a plain Error (ConformanceError is Task 2).
export function assertDescriptor(d) {
  if (!d || typeof d !== "object") throw new Error("descriptor must be an object");
  if (typeof d.id !== "string" || !d.id) throw new Error("descriptor.id must be a non-empty string");
  if (d.profile !== "pull" && d.profile !== "event") throw new Error("descriptor.profile must be 'pull' or 'event'");
  // SCCM 1.x: a minor is additive (1.1 added optional collections), so any 1.x descriptor is consumable.
  if (!/^1\.\d+$/.test(String(d.sccmVersion || ""))) throw new Error("descriptor.sccmVersion must be '1.x'");
  if (!Array.isArray(d.kinds)) throw new Error("descriptor.kinds must be an array");
  if (!LIFECYCLES.includes(d.lifecycle)) throw new Error("descriptor.lifecycle must be one of " + LIFECYCLES.join("|"));
  const c = d.capabilities;
  if (!c || typeof c !== "object") throw new Error("descriptor.capabilities required");
  if (typeof c.emitsBundle !== "boolean") throw new Error("descriptor.capabilities.emitsBundle must be a boolean");
  for (const k of ["resources", "operations", "authKinds", "eventTypes"]) if (!Array.isArray(c[k])) throw new Error("descriptor.capabilities." + k + " must be an array");
}
