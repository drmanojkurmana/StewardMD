/* test/wardsynq-order-sets.test.mjs — a named group of orders, applied one at a time. Pure half.
 *
 * node --test test/wardsynq-order-sets.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, resolveSet, selectionFrom, requestsFor, applicationIdFor } from "../functions/_wardsynq/order-sets.js";

const CAP = {
  id: "cap-admission", name: "Community-acquired pneumonia, admission", version: "3",
  items: [
    { key: "amox", kind: "medication", drug: "Amoxicillin", dose: { value: 1, unit: "g" }, route: "iv", frequency: "TDS" },
    { key: "fluids", kind: "medication", drug: "Sodium chloride 0.9%", dose: { value: 1000, unit: "mL" }, route: "iv", frequency: "OD", defaultSelected: false },
    { key: "cxr", kind: "investigation", code: "CXR", display: "Chest X-ray" },
    { key: "cultures", kind: "investigation", code: "BC", display: "Blood cultures" },
  ],
};

test("a set resolves to exactly what it would order, with each item's default stated", () => {
  const r = resolveSet(CAP);
  assert.equal(r.ok, true);
  assert.equal(r.version, "3");
  assert.equal(r.items.length, 4);
  // Nothing is assumed: an item the set does not pre-select is one the clinician has to choose.
  assert.equal(r.items.find((i) => i.key === "amox").defaultSelected, true);
  assert.equal(r.items.find((i) => i.key === "fluids").defaultSelected, false);
  assert.deepEqual(KINDS, ["medication", "investigation"]);
});

test("a malformed item is REPORTED and dropped, never silently skipped", () => {
  const r = resolveSet({
    id: "s", name: "S", items: [
      { key: "ok", kind: "investigation", code: "CXR" },
      { key: "nodose", kind: "medication", drug: "Amoxicillin" },
      { key: "nodrug", kind: "medication", dose: { value: 1, unit: "g" } },
      { key: "bad", kind: "telepathy", code: "X" },
      { kind: "investigation", code: "" },
      { key: "ok", kind: "investigation", code: "CXR2" },
    ],
  });
  /* A set that quietly loses its antibiotic still looks like it applied cleanly, which is the worst
   * outcome available - so every dropped item comes back with a reason. */
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.problems.map((p) => p.reason), ["no_dose", "no_drug", "unknown_kind", "no_key", "duplicate"]);
  // A medication with no dose can never be given: the bedside five-rights check compares the
  // prepared dose against the ordered one, so a doseless order is unadministrable by construction.
  assert.equal(r.problems[0].reason, "no_dose");
  // A set with nothing usable is not a set.
  assert.equal(resolveSet({ id: "s", name: "S", items: [{ kind: "telepathy" }] }).error, "set_empty");
  assert.equal(resolveSet({ name: "no id" }).error, "set_incomplete");
});

test("with no explicit selection, ONLY the set's own defaults apply", () => {
  const r = resolveSet(CAP);
  const s = selectionFrom(r, null);
  assert.deepEqual(s.selected.map((i) => i.key).sort(), ["amox", "cultures", "cxr"]);
  assert.deepEqual(s.deselected, ["fluids"], "and the rest are named as not ordered");
  assert.deepEqual(s.unknown, []);
});

test("AN ITEM THE CLINICIAN NEVER SAW IS REFUSED, not quietly added", () => {
  const r = resolveSet(CAP);
  // This is the case where the set changed between being read and being applied. Ordering something
  // that was not on the clinician's screen is exactly what must not happen.
  const s = selectionFrom(r, ["amox", "vancomycin"]);
  assert.deepEqual(s.unknown, ["vancomycin"]);
  assert.deepEqual(s.selected.map((i) => i.key), ["amox"]);
  // A deselected item is simply not ordered.
  const only = selectionFrom(r, ["cxr"]);
  assert.deepEqual(only.selected.map((i) => i.key), ["cxr"]);
  assert.deepEqual(only.deselected.sort(), ["amox", "cultures", "fluids"]);
  // Asking twice for the same item orders it once.
  assert.equal(selectionFrom(r, ["cxr", "CXR", "cxr"]).selected.length, 1);
});

test("the requests are ORDER REQUESTS, carrying the set's own doses unchanged", () => {
  const r = resolveSet(CAP);
  const reqs = requestsFor(selectionFrom(r, ["amox", "cxr"]).selected, { patientId: "pat", encounterId: "enc" });
  assert.equal(reqs.length, 2);
  const med = reqs.find((x) => x.kind === "medication");
  assert.deepEqual(med.order.dose, { value: 1, unit: "g" });
  assert.equal(med.order.route, "iv");
  assert.equal(med.order.patientId, "pat");
  assert.equal(med.order.encounterId, "enc");
  // Nothing here computes a dose. The set's dose is carried through and is still checked by the
  // ordinary ordering route, which is the only place a dose is ever validated.
  const inv = reqs.find((x) => x.kind === "investigation");
  assert.equal(inv.order.code, "CXR");
  assert.equal(inv.order.display, "Chest X-ray");
});

test("THE ORG PROJECTION CARRIES WARDSYNQ CONFIGURATION, which it silently dropped before", async () => {
  const { org } = await import("../functions/_opd_org.js");
  /* That projection is a WHITELIST, and everything not listed is dropped. Six pieces of per-hospital
   * clinical configuration were being read as top-level org fields and arriving undefined - critical
   * limits, round times, beds, escalation, high-alert drugs, order sets. Nothing broke, which is
   * exactly the problem: every read fell back to a default, so a hospital that had carefully set its
   * own potassium limits was silently running on WardSynQ's. */
  const o = org({
    id: "org-1", name: "H", mode: "wardsynq",
    wardsynq: {
      criticalLimits: { "2823-3": { low: 2.5, high: 6.8, unit: "mmol/L" } },
      marTimes: { BD: ["09:00", "21:00"] },
      beds: { "Medical A": ["1", "2"] },
      orderSets: [CAP],
      utcOffsetMinutes: 0,
    },
  });
  assert.equal(o.wardsynq.criticalLimits["2823-3"].high, 6.8, "a site's own limit survives");
  assert.deepEqual(o.wardsynq.marTimes.BD, ["09:00", "21:00"]);
  assert.equal(o.wardsynq.orderSets[0].id, "cap-admission");
  assert.equal(o.wardsynq.utcOffsetMinutes, 0, "zero is a real offset, not an absent one");
  // An org with no WardSynQ configuration says null rather than an empty object pretending to be one.
  assert.equal(org({ id: "org-2", name: "H" }).wardsynq, null);
  assert.equal(org({ id: "org-3", name: "H", wardsynq: {} }).wardsynq, null);
  assert.equal(org({ id: "org-4", name: "H", wardsynq: "nonsense" }).wardsynq, null);
  // Unknown keys are not carried: the whitelist is still a whitelist, just a documented one.
  assert.equal(org({ id: "org-5", name: "H", wardsynq: { somethingElse: 1 } }).wardsynq, null);
});

test("an application id is per encounter, set and moment", () => {
  const a = applicationIdFor("enc", "cap-admission", "2026-09-07T09:00:00.000Z");
  assert.equal(a, applicationIdFor("ENC", "cap admission", "2026-09-07T09:00:00.000Z"));
  // Applying the same set twice in one stay is two applications, not an overwrite: a set applied
  // again at a different time is a different clinical act.
  assert.notEqual(a, applicationIdFor("enc", "cap-admission", "2026-09-07T15:00:00.000Z"));
  assert.equal(applicationIdFor("", "s", "t"), null);
});
