/* Retention layers come from the legal requirement registry, and the registry's enforcement decides what a layer keeps.
 * node --test --experimental-test-module-mocks test/wardsynq-retention-registry.test.mjs */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const REG_URL = new URL("../functions/_wardsynq/legal-requirements.js", import.meta.url).href;
const RET_URL = new URL("../functions/_wardsynq/retention.js", import.meta.url).href;
const real = await import(REG_URL);
const R = await import(RET_URL);

const NOW = Date.parse("2026-09-17T00:00:00Z");
const facts = { patient: { dob: "1980-01-01" }, encounters: [{ class: "IPD", status: "finished", periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-10T00:00:00Z" }],
  registers: { mlc: [], formf: [{ id: "f1", eventDate: "2026-08-01" }], mtp: [] }, documents: [], consents: [] };

test("every retention layer is a registry record with its basis kept as an attribute; no second table", () => {
  for (const [k, c] of Object.entries(R.CLASSES)) {
    for (const l of c.bases) {
      const r = real.requirement(l.requirementId);
      assert.equal(r.retention.class, k);
      assert.equal(r.retention.layer, l.id);
      assert.equal(r.basis, l.type);
      assert.ok([real.LEGAL_OBLIGATION, real.RETENTION_POLICY].includes(r.basis), r.id);
      if (["OFFICE_MEMORANDUM", "GUIDELINE", "HOSPITAL_POLICY"].includes(r.sourceType)) assert.equal(r.basis, real.RETENTION_POLICY, r.id);
    }
  }
  assert.equal(real.REQUIREMENTS.filter((r) => r.retention && r.retention.class).length, Object.values(R.CLASSES).reduce((n, c) => n + c.bases.length, 0), "every registry retention record is used");
  const ipd = R.retentionMap(facts, null, NOW).find((x) => x.class === "clinical-ipd");
  assert.equal(ipd.basisType, R.LEGAL, "IMC reg 1.3.1 keeps a 2026 stay today");
});

test("a registry status change removes a legal layer's effect: STAYED IMC reg 1.3.1 and STRUCK_DOWN PCPNDT r.9(6) keep nothing; an expired layer neither", async () => {
  const change = { "IN-IMC-1-3-1": { status: "STAYED" }, "IN-PCPNDT-R9-6": { status: "STRUCK_DOWN" }, "IN-DCR-R65-3-1-H": { expiresOn: "2026-01-01" } };
  const reqs = real.REQUIREMENTS.map((r) => (change[r.id] ? Object.freeze({ ...r, ...change[r.id] }) : r));
  const find = (id) => { const r = reqs.find((x) => x.id === id); if (!r) throw new Error("no requirement " + id); return r; };
  mock.module(REG_URL, { namedExports: { ...real, REQUIREMENTS: reqs, requirement: find, enforced: (id, ctx) => real.enforcement(find(id), ctx).applies } });
  const S = await import(RET_URL + "?stayed");

  assert.equal(S.CLASSES["clinical-ipd"].legalFloorYears, null, "a stayed regulation is no legal floor");
  assert.equal(S.CLASSES["clinical-ipd"].policyOnly, true);
  assert.equal(S.CLASSES.pcpndt.policyOnly, true);
  assert.equal(S.CLASSES.h1.policyOnly, false, "an expiry is dated, not a status: the class still names its law");

  const map = S.retentionMap(facts, null, NOW);
  const ipd = map.find((x) => x.class === "clinical-ipd"), pc = map.find((x) => x.class === "pcpndt");
  assert.equal(ipd.legalUntil, null);
  assert.equal(ipd.basisType, S.POLICY, "only the DGHS OM keeps it now");
  assert.equal(ipd.bases.find((b) => b.requirementId === "IN-IMC-1-3-1").inForce, false);
  assert.equal(ipd.bases.find((b) => b.requirementId === "IN-IMC-1-3-1").notInForce, "stayed", "the registry's reason travels with the layer");
  assert.equal(pc.bases.find((b) => b.requirementId === "IN-PCPNDT-R9-6").notInForce, "struck-down");
  assert.ok(ipd.bases.filter((b) => b.inForce).every((b) => b.notInForce === undefined), "a layer in force carries no reason");
  assert.match(S.retentionAnswer(ipd), /This is not a legal requirement/);
  assert.equal(pc.legalUntil, null, "a struck-down rule keeps nothing");
  assert.equal(pc.basisType, S.POLICY, "the class's setting period (not lowered here) is policy, not law");
  assert.equal(S.retentionAnswer(pc), `Kept until ${pc.keepUntil.slice(0, 10)} under the hospital's retention policy. This is not a legal requirement.`);
  /* The unchanged module still enforces them. */
  assert.equal(R.retentionMap(facts, null, NOW).find((x) => x.class === "pcpndt").basisType, R.LEGAL);
  mock.reset();
});
