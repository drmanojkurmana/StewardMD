// functions/_connect/sdk/registry.js — Track C: per-request connector registry (fail-closed, no global state).
// The internal Map is created INSIDE createRegistry (never at module scope), so instances share nothing.
// register() is the fast STRUCTURAL gate (assertConnector + assertDescriptor + sccmVersion + dup); the full
// async behavioral kit (conformance.js) stays a build-time/CI concern. resolve() throws UpstreamError on an
// unknown id (matching engine.js today). asConnectorMap() is the frozen engine-compat bridge.
import { assertConnector } from "../interfaces.js";
import { UpstreamError } from "../permission.js";
import { describe, assertDescriptor } from "./descriptor.js";

export function createRegistry(opts = {}) {
  const strict = opts.strict !== false;                    // reserved: gates only the synchronous descriptor-level checks
  const map = new Map();                                   // id -> connector; per-instance, no shared/module state

  const reg = {
    register(connector) {
      assertConnector(connector);                          // structural (methods per profile, sccmVersion)
      const d = describe(connector);
      if (strict) assertDescriptor(d);                     // descriptor-level shape
      if (!/^1\.\d+$/.test(String(connector.meta.sccmVersion || ""))) throw new Error("connector must declare an sccmVersion of 1.x"); // minors are additive
      if (map.has(d.id)) throw new Error("duplicate connector id: " + d.id);
      map.set(d.id, connector);
      return reg;                                          // chainable on success; any throw above => not added (fail-closed)
    },
    resolve(id, profile) {
      const c = map.get(id);
      if (!c) throw new UpstreamError("connector not registered: " + id);
      if (profile && c.meta.profile !== profile) throw new UpstreamError("connector " + id + " is profile " + c.meta.profile + ", not " + profile);
      return c;
    },
    has(id) { return map.has(id); },
    list() { return [...map.values()].map(describe); },    // descriptors only — never connector code or secrets
    asConnectorMap() { const o = {}; for (const [id, c] of map) o[id] = c; return Object.freeze(o); },  // fresh frozen map per call
  };
  return reg;
}
