// functions/_connect/sdk/descriptor.js — Track C: connector lifecycle/capability descriptor.
// Pure (reads connector.meta only; no env/fetch/global state). Inference defaults (spec §3.1):
//   pull  -> lifecycle "ga",       emitsBundle true
//   event -> lifecycle "skeleton", emitsBundle false
// both overridable via meta.lifecycle / meta.capabilities.
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
