// functions/_connect/sdk/catalog.js — Track C: frozen built-in connector catalog + defaultRegistry().
// BUILTIN is an immutable list of CODE REFS only (no per-request data). defaultRegistry() builds a FRESH
// registry per call (no module-level instance), registers each built-in fail-closed, and returns it.
import { fhirR4Connector } from "../connectors/fhir-r4/connector.js";
import { abdmConnector } from "../abdm/connector.js";
import { restJsonConnector } from "../connectors/rest-json/connector.js";
import { dicomWebConnector } from "../connectors/dicomweb/connector.js";
import { graphqlConnector } from "../connectors/graphql/connector.js";
import { createRegistry } from "./registry.js";

export const BUILTIN = Object.freeze([fhirR4Connector, abdmConnector, restJsonConnector, dicomWebConnector, graphqlConnector]);

export function defaultRegistry() {
  const reg = createRegistry();
  for (const c of BUILTIN) reg.register(c);                // fail-closed: a non-conforming built-in would throw here
  return reg;
}
