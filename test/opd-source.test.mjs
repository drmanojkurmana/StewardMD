// test/opd-source.test.mjs — the OPD ⇄ EMR boundary contract + resolver (Phase 1). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPD_CAPS, opdSupports, assertOpdSource, registerOpdConnector, resolveOpdSource, nativeOpdSource, _resetOpdConnectors } from "../functions/_opd_source.js";

function goodSource() { return { opdCaps: ["getWorklist", "writeAssessment"], getWorklist: () => [], writeAssessment: () => ({ ok: true }) }; }

test("opdSupports: true only when declared AND implemented", () => {
  const s = goodSource();
  assert.equal(opdSupports(s, "getWorklist"), true);
  assert.equal(opdSupports(s, "writeVitals"), false);       // not declared
  assert.equal(opdSupports({ opdCaps: ["getWorklist"] }, "getWorklist"), false); // declared but no fn
  assert.equal(opdSupports(null, "getWorklist"), false);
});

test("assertOpdSource rejects unknown caps and undeclared-but-listed methods", () => {
  assert.equal(assertOpdSource(goodSource()), true);
  assert.equal(assertOpdSource({ opdCaps: [] }), true);     // native source (no caps) is valid
  assert.throws(() => assertOpdSource({ opdCaps: ["teleport"] }), /unknown capability/);
  assert.throws(() => assertOpdSource({ opdCaps: ["getWorklist"] }), /not implemented/);
  assert.throws(() => assertOpdSource(null), /must be an object/);
  for (const c of OPD_CAPS) assert.equal(typeof c, "string");
});

test("resolveOpdSource: native org -> native source (no caps)", () => {
  _resetOpdConnectors();
  const src = resolveOpdSource({}, { id: "o1", mode: "native" });
  assert.equal(src.kind, "native");
  assert.deepEqual(src.opdCaps, []);
  assert.equal(nativeOpdSource({}, { id: "o1" }).opdCaps.length, 0);
});

test("resolveOpdSource: connect org with a REGISTERED connector -> its source", () => {
  _resetOpdConnectors();
  registerOpdConnector("ghis", (env, org) => ({ opdCaps: ["getWorklist"], getWorklist: () => ["patient"] }));
  const src = resolveOpdSource({}, { id: "o1", mode: "connect", connectorId: "ghis" });
  assert.equal(src.kind, "connector");
  assert.equal(src.connectorId, "ghis");
  assert.equal(opdSupports(src, "getWorklist"), true);
});

test("resolveOpdSource DEGRADES to native: unregistered connector, missing connectorId, or a broken factory", () => {
  _resetOpdConnectors();
  assert.equal(resolveOpdSource({}, { id: "o1", mode: "connect", connectorId: "unknown" }).kind, "native");
  assert.equal(resolveOpdSource({}, { id: "o1", mode: "connect" }).kind, "native"); // no connectorId
  registerOpdConnector("bad", () => ({ opdCaps: ["getWorklist"] }));                // declared, not implemented
  assert.equal(resolveOpdSource({}, { id: "o1", mode: "connect", connectorId: "bad" }).kind, "native");
});
