/* test/insulin-convert.test.mjs - clinician-guided insulin conversion suggestions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import C from "../insulin-convert.js";
import DB from "../insulin-db.js";

function conv(o) { return C.convert(Object.assign({ db: DB }, o)); }

test("bolus to bolus is 1:1", () => {
  const r = conv({ fromId: "lispro", toId: "aspart", dose: 24 });
  assert.equal(r.ratio, 1);
  assert.equal(r.suggested, 24);
  assert.match(r.kind, /bolus/i);
});

test("regular -> rapid keeps units but flags timing", () => {
  const r = conv({ fromId: "regular", toId: "aspart", dose: 30 });
  assert.equal(r.suggested, 30);
  assert.ok(r.assumptions.some(a => /start of the meal/i.test(a)));
});

test("NPH -> long-acting analogue reduces ~20%", () => {
  const r = conv({ fromId: "nph", toId: "glargine100", dose: 40 });
  assert.equal(r.ratio, 0.8);
  assert.equal(r.suggested, 32);
  assert.ok(r.assumptions.some(a => /20%/.test(a)));
});

test("glargine -> degludec is 1:1 with steady-state caution", () => {
  const r = conv({ fromId: "glargine100", toId: "degludec", dose: 20 });
  assert.equal(r.suggested, 20);
  assert.ok(r.assumptions.some(a => /steady state/i.test(a)));
});

test("premix -> premix keeps total", () => {
  const r = conv({ fromId: "mix7030h", toId: "mixaspart3070", dose: 36 });
  assert.equal(r.suggested, 36);
  assert.match(r.kind, /premix/i);
});

test("basal -> basal-bolus returns a regimen (reduced basal + prandial)", () => {
  const r = conv({ fromId: "glargine100", toId: "aspart", dose: 40 });
  assert.match(r.kind, /basal-bolus/i);
  assert.equal(typeof r.suggested, "object");
  assert.equal(r.suggested.basal, 32);      // 40 x 0.8
  assert.equal(r.suggested.bolusEach, 4);   // ~10% of 40
});

test("concentrated insulin raises a device/concentration warning", () => {
  const r = conv({ fromId: "glargine100", toId: "glargine300", dose: 30 });
  assert.ok(r.warnings.some(w => /concentrated/i.test(w)));
});

test("every valid suggestion carries follow-up + a verify-against-protocol ref + conservative caveat", () => {
  const r = conv({ fromId: "glargine100", toId: "degludec", dose: 20 });
  assert.ok(r.followUp && /review/i.test(r.followUp));
  assert.ok(r.refs.some(x => /protocol/i.test(x)));
  assert.ok(r.assumptions.some(a => /conservative starting estimate/i.test(a)));
});

test("errors on missing dose, missing insulin, or same insulin", () => {
  assert.ok(conv({ fromId: "lispro", toId: "aspart", dose: 0 }).error);
  assert.ok(conv({ fromId: "lispro", toId: "nope", dose: 10 }).error);
  assert.ok(conv({ fromId: "lispro", toId: "lispro", dose: 10 }).error);
});

/* ── Basal-switch dose rules that come straight from product labelling ──────
 * Both are 80% rules but they trigger on different things; applying either
 * blindly harms the patient in opposite directions. */
test("NPH -> analogue: 20% reduction only from TWICE-daily NPH", () => {
  const bd = C.convert({ fromId: "nph", toId: "glargine100", dose: 40, db: DB });          // default BD
  assert.equal(bd.ratio, 0.8);
  assert.equal(bd.suggested, 32);
  const od = C.convert({ fromId: "nph", toId: "glargine100", dose: 40, fromFreq: "od", db: DB });
  assert.equal(od.ratio, 1);
  assert.equal(od.suggested, 40);            // was 32 — reducing here under-doses
  assert.ok(od.assumptions.some(a => /ONCE-daily/.test(a)));
  assert.ok(od.assumptions.some(a => /once- or twice-daily/.test(a)));
});

test("off glargine U-300: start at 80%, never unit-for-unit", () => {
  const r = C.convert({ fromId: "glargine300", toId: "glargine100", dose: 50, db: DB });
  assert.equal(r.ratio, 0.8);
  assert.equal(r.suggested, 40);             // was 50 — a straight swap overdoses
  assert.ok(r.assumptions.some(a => /not interchangeable unit-for-unit/i.test(a)));
  const toDeg = C.convert({ fromId: "glargine300", toId: "degludec", dose: 50, db: DB });
  assert.equal(toDeg.suggested, 40);
});

test("basal analogue -> analogue (not U-300, not NPH) stays 1:1", () => {
  const r = C.convert({ fromId: "glargine100", toId: "degludec", dose: 30, db: DB });
  assert.equal(r.ratio, 1);
  assert.equal(r.suggested, 30);
});
