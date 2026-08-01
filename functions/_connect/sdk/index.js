// functions/_connect/sdk/index.js — Track C: the single public import surface for the Connector SDK.
export { describe, assertDescriptor, LIFECYCLES } from "./descriptor.js";
export { runConformance, assertConforms, ConformanceError } from "./conformance.js";
export { createRegistry } from "./registry.js";
export { BUILTIN, defaultRegistry } from "./catalog.js";
