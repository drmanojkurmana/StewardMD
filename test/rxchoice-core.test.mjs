/* RxChoice™ deterministic core — matching, pricing, ranking, safety.
 * Run: node --test test/rxchoice-core.test.mjs   (or via npm test)
 *
 * Every record below has the shape the StewardMD Drug Database actually returns
 * (worker/src/index.js + offline-db.js): { id, brand, composition, manufacturer, mrp, form, pack,
 * discontinued }. The strengthless compositions ("Amoxycillin + Clavulanic Acid") are not a
 * simplification - that is how the live database holds most combination products, with the strength
 * in the brand name, and it is the case the safety rules exist for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const RX = createRequire(import.meta.url)("../rxchoice-core.js");

const tab = (o) => Object.assign({ form: "tablet", pack: "strip of 10 tablets", discontinued: 0 }, o);

// The doctor's product: Augmentin 625, strength known only from the brand name.
const AUG = tab({ id: 1, brand: "Augmentin 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd", mrp: 205.4 });
const LINE = { dose: "1 tab", freq: "BD", duration: "5 days" };
const rxOf = (rec, line = LINE) => Object.assign({}, rec, line);

test("composition key compares the WHOLE combination, order-independent", () => {
  assert.equal(RX.compositionKey("Amoxycillin (500mg) + Clavulanic Acid (125mg)"), "amoxycillin+clavulanic acid");
  assert.equal(RX.compositionKey("Clavulanic Acid + Amoxycillin"), "amoxycillin+clavulanic acid");
  assert.notEqual(RX.compositionKey("Amoxycillin"), RX.compositionKey("Amoxycillin + Clavulanic Acid"));
});

test("strength key is provenance-tagged, and a composition key never matches a brand key", () => {
  assert.equal(RX.strengthKey(tab({ brand: "Clavam 625", composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)" })),
    "comp:amoxycillin=500mg|clavulanic acid=125mg");
  assert.equal(RX.strengthKey(AUG), "brand:625mg");
  // Same ingredients and the same therapy, but the strengths were established two different ways -
  // 625 off a brand name vs 500+125 out of a composition. Refused rather than guessed equal.
  assert.equal(RX.eligibility(rxOf(AUG), tab({ id: 2, brand: "Clavam 625", composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)", mrp: 120 })).reason,
    "strength_mismatch");
  // A product whose strength cannot be established at all is never eligible.
  assert.equal(RX.strengthKey(tab({ brand: "Moxikind CV", composition: "Amoxycillin + Clavulanic Acid" })), "");
  assert.equal(RX.eligibility(rxOf(AUG), tab({ id: 3, brand: "Moxikind CV", composition: "Amoxycillin + Clavulanic Acid", mrp: 90 })).reason, "strength_unknown");
  // A syrup is refused on its FORM, which is the reason a doctor can act on.
  assert.equal(RX.eligibility(rxOf(AUG), tab({ id: 9, brand: "Clavam 625 Dry Syrup", composition: "Amoxycillin + Clavulanic Acid", form: "syrup", pack: "bottle of 30 ml", mrp: 70 })).reason, "form_mismatch");
  assert.equal(RX.canonStrength(1, "g").value, 1000, "1 g normalizes to 1000 mg");
});

test("eligibility rejects ingredient, strength, form, release and market mismatches", () => {
  const r = (o) => RX.eligibility(rxOf(AUG), tab(o)).reason;
  assert.equal(r({ id: 2, brand: "Clavam 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", mrp: 120 }), "exact");
  assert.equal(r({ id: 3, brand: "Mox 500 Capsule", composition: "Amoxycillin", mrp: 40 }), "composition_mismatch", "combination must not match a single ingredient");
  assert.equal(r({ id: 4, brand: "Clavam 375 Tablet", composition: "Amoxycillin + Clavulanic Acid", mrp: 80 }), "strength_mismatch");
  assert.equal(r({ id: 5, brand: "Clavam 625 Dry Syrup", composition: "Amoxycillin + Clavulanic Acid", form: "syrup", pack: "bottle of 30 ml", mrp: 70 }), "form_mismatch");
  assert.equal(r({ id: 6, brand: "Clavam 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", mrp: 120, discontinued: 1 }), "discontinued");
});

test("release characteristics are matched as a set: IR never matches XR/SR", () => {
  const ir = rxOf(tab({ id: 10, brand: "Glycomet 500 Tablet", composition: "Metformin (500mg)", mrp: 30 }));
  assert.equal(RX.eligibility(ir, tab({ id: 11, brand: "Glyciphage 500 Tablet", composition: "Metformin (500mg)", mrp: 25 })).reason, "exact");
  assert.equal(RX.eligibility(ir, tab({ id: 12, brand: "Glycomet SR 500 Tablet", composition: "Metformin (500mg)", mrp: 35 })).reason, "release_mismatch");
  assert.equal(RX.eligibility(ir, tab({ id: 13, brand: "Metformin 500 Extended Release Tablet", composition: "Metformin (500mg)", mrp: 35 })).reason, "release_mismatch");
  assert.equal(RX.releaseKey("Metformin Extended Release"), RX.releaseKey("Metformin XR"), "spelled-out release collapses onto its abbreviation");
});

test("course quantity: dose x frequency x duration, and nothing when any is missing", () => {
  assert.equal(RX.requiredQuantity({ dose: "1 tab", freq: "BD", duration: "5 days" }, "tablet").units, 10);
  assert.equal(RX.requiredQuantity({ dose: "625 mg", freq: "TDS", duration: "1 week" }, "tablet").units, 21, "a strength dose of a matching-strength product is 1 unit");
  assert.equal(RX.requiredQuantity({ dose: "5 ml", freq: "BD", duration: "3 days" }, "liquid").units, 30);
  assert.equal(RX.requiredQuantity({ dose: "1 tab", freq: "SOS", duration: "5 days" }, "tablet"), null, "PRN has no countable course");
  assert.equal(RX.requiredQuantity({ dose: "1 tab", freq: "BD", duration: "" }, "tablet"), null);
  assert.equal(RX.requiredQuantity({ dose: "", freq: "BD", duration: "5 days" }, "tablet"), null);
});

test("course cost is pack-aware, not pack MRP - the spec's worked example", () => {
  const need = { units: 10 };
  const a = RX.courseCost(tab({ mrp: 100, pack: "strip of 10 tablets" }), need);
  const b = RX.courseCost(tab({ mrp: 150, pack: "strip of 20 tablets" }), need);
  const c = RX.courseCost(tab({ mrp: 300, pack: "strip of 30 tablets" }), need);
  assert.equal(a.courseCost, 100, "10 of a 10-pack = one pack");
  assert.equal(b.courseCost, 75, "10 of a 20-pack: loose tablets at the pack's unit price - the bigger pack is the cheaper course");
  assert.equal(c.courseCost, 100, "10 of a 30-pack at Rs 10/tablet");
  assert.equal(b.packsRequired, 1);
  assert.equal(b.wholePackCost, 150, "the whole-pack figure is reported too, never silently swapped in");
  assert.equal(RX.courseCost(tab({ mrp: 50, pack: "strip of 10 tablets" }), { units: 21 }).packsRequired, 3, "21 tablets needs 3 ten-packs");
  // An indivisible pack cannot be cut, so there the course really does cost whole packs.
  const vial = RX.courseCost(tab({ mrp: 68, pack: "vial of 10 ml Injection", form: "injection" }), { units: 25 });
  assert.equal(vial.dispensing, "pack");
  assert.equal(vial.courseCost, 204, "25 ml from 10 ml vials = 3 vials");
  assert.equal(RX.courseCost(tab({ mrp: null, pack: "strip of 10 tablets" }), need), null, "missing price is never invented");
  assert.equal(RX.courseCost(tab({ mrp: 100, pack: "as directed" }), need), null, "unreadable pack is never guessed");
});
// b above: 150/20 = 7.5 per tablet; one pack covers the course, so the course costs the pack.
test("the dispensing model is reported, never assumed", () => {
  const b = RX.courseCost(tab({ mrp: 150, pack: "strip of 20 tablets" }), { units: 10 });
  assert.equal(b.packPrice, 150);
  assert.equal(b.dispensing, "unit");
  assert.equal(b.unitPrice, 7.5);
  assert.equal(b.dispensed, 10, "only what is dispensed, so a big pack is not charged as waste");
});

const POOL = [
  tab({ id: 2, brand: "Clavam 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", manufacturer: "Alkem Laboratories Ltd", mrp: 181 }),
  tab({ id: 3, brand: "Moxclav 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", manufacturer: "Wanbury Ltd", mrp: 96 }),
  tab({ id: 4, brand: "Advent 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", manufacturer: "Cipla Ltd", mrp: 198 }),
  tab({ id: 5, brand: "Mega CV 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", manufacturer: "Aristo Pharmaceuticals Pvt Ltd", mrp: 132 }),
  tab({ id: 6, brand: "Clavam 375 Tablet", composition: "Amoxycillin + Clavulanic Acid", manufacturer: "Alkem Laboratories Ltd", mrp: 88 }),        // wrong strength
  tab({ id: 7, brand: "Mox 500 Capsule", composition: "Amoxycillin", manufacturer: "Ranbaxy", mrp: 40, form: "capsule" }),                         // wrong composition
  tab({ id: 8, brand: "Gone CV 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", manufacturer: "Cipla Ltd", mrp: 50, discontinued: 1 })   // off the market
];

test("the four options: generic lowest, premium branded, balanced by value, prescribed untouched", () => {
  const r = RX.choose(rxOf(AUG), POOL);
  assert.equal(r.eligibleCount, 4, "only the exact, on-market, priceable matches are eligible");
  assert.equal(r.generic.brand, "Moxclav 625 Tablet");
  assert.equal(r.generic.courseCost, 96);
  assert.equal(r.premium.tier, "branded", "premium is an established manufacturer, never a price claim");
  assert.ok(["Advent 625 Tablet"].includes(r.premium.brand));
  assert.equal(r.prescribed.brand, "Augmentin 625 Tablet", "the doctor's own product is always card four");
  assert.equal(r.prescribed.courseCost, 205.4);
  assert.equal(r.balanced.label, "Recommended Value", "never 'best medicine'");
  assert.ok(r.balanced.score.value > 0 && r.balanced.score.priceEfficiency != null, "balanced is an explainable score");
  // Balanced is neither hardcoded-cheapest nor the middle of the array.
  assert.equal(r.balanced.brand, RX.choose(rxOf(AUG), POOL.slice().reverse()).balanced.brand, "ranking is order-independent and deterministic");
  assert.ok(r.balanced.courseCost <= r.premium.courseCost);
  // Here the best-value product is also the cheapest. That is reported, not engineered away: forcing
  // a different product into BALANCED would mean recommending one the score ranked lower.
  assert.equal(r.balanced.sameAs, "generic");
  assert.equal(r.balanced.brand, r.generic.brand);
});

test("the doctor's own product is never offered back as an alternative", () => {
  const r = RX.choose(rxOf(AUG), POOL.concat([AUG]));
  [r.generic, r.balanced, r.premium].forEach((o) => assert.notEqual(String(o.id), String(AUG.id)));
});

test("no validated alternatives -> no cards, and the original is preserved", () => {
  const r = RX.choose(rxOf(AUG), [POOL[5], POOL[6]]);
  assert.equal(r.reason, "no_validated_alternatives");
  assert.equal(r.generic, null);
  assert.equal(r.balanced, null);
  assert.equal(r.premium, null);
  assert.equal(r.prescribed.brand, "Augmentin 625 Tablet", "the doctor's product survives an empty result");
});

test("no course quantity -> nothing is priced and nothing is offered", () => {
  const r = RX.choose(rxOf(AUG, { dose: "1 tab", freq: "SOS", duration: "" }), POOL);
  assert.equal(r.reason, "no_course_quantity");
  assert.equal(r.balanced, null);
  assert.equal(r.prescribed.brand, "Augmentin 625 Tablet");
});

test("narrow therapeutic index, biologics, insulin and devices are not price-swapped", () => {
  const warf = rxOf(tab({ id: 20, brand: "Warf 5 Tablet", composition: "Warfarin (5mg)", manufacturer: "Cipla Ltd", mrp: 60 }));
  const wr = RX.choose(warf, [tab({ id: 21, brand: "Uniwarfin 5 Tablet", composition: "Warfarin (5mg)", manufacturer: "Mankind", mrp: 30 })]);
  assert.equal(wr.blocked, true);
  assert.match(wr.reason, /[Nn]arrow therapeutic index/);
  assert.equal(wr.generic, null);
  assert.equal(wr.prescribed.brand, "Warf 5 Tablet");
  assert.ok(RX.restricted({ composition: "Insulin Glargine", form: "injection" }), "insulin");
  assert.ok(RX.restricted({ composition: "Adalimumab", form: "injection" }), "biologic");
  assert.ok(RX.restricted({ composition: "Salbutamol", form: "inhaler" }), "device-dependent form");
  assert.ok(RX.restricted({ composition: "Fentanyl", form: "patch" }), "transdermal system");
  assert.equal(RX.restricted({ composition: "Paracetamol (500mg)", form: "tablet" }), null, "an ordinary oral solid is not restricted");
});

test("prescription totals and savings, with an unpriceable line kept honest", () => {
  const r1 = RX.choose(rxOf(AUG), POOL);
  const pcm = tab({ id: 30, brand: "Dolo 650 Tablet", composition: "Paracetamol (650mg)", manufacturer: "Micro Labs Ltd", mrp: 30, pack: "strip of 15 tablets" });
  const r2 = RX.choose(rxOf(pcm, { dose: "1 tab", freq: "TDS", duration: "3 days" }),
    [tab({ id: 31, brand: "Calpol 650 Tablet", composition: "Paracetamol (650mg)", manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd", mrp: 25, pack: "strip of 15 tablets" })]);
  const t = RX.totals([r1, r2]);
  // 3 days TDS = 9 tablets of a 15-tablet strip, dispensed loose: Rs 30/15 x 9 = Rs 18.
  assert.equal(t.prescribed, Math.round((205.4 + 18) * 100) / 100);
  assert.equal(t.generic, Math.round((96 + 15) * 100) / 100);
  assert.equal(t.savings.generic, Math.round((t.prescribed - t.generic) * 100) / 100);
  assert.ok(t.savings.generic > 0);
  // A blocked line contributes the doctor's own product to every column, never a gap or a guess.
  const warfR = RX.choose(rxOf(tab({ id: 20, brand: "Warf 5 Tablet", composition: "Warfarin (5mg)", manufacturer: "Cipla Ltd", mrp: 60 })), []);
  const t2 = RX.totals([r1, warfR]);
  assert.equal(t2.generic, 96 + 60, "the blocked line contributes the doctor's own product to the generic column");
  assert.equal(t2.prescribed, Math.round((205.4 + 60) * 100) / 100);
});

test("audit entry keeps the original product as a field of its own", () => {
  const r = RX.choose(rxOf(AUG), POOL);
  const a = RX.auditEntry({ prescriptionId: "rx-1", original: r.prescribed, alternative: r.balanced, category: "balanced", reasonShown: "Recommended Value", doctorApproved: true });
  assert.equal(a.originalProduct.brand, "Augmentin 625 Tablet");
  assert.equal(a.alternativeProduct.brand, r.balanced.brand);
  assert.equal(a.doctorApproved, true);
  assert.equal(a.patientSelected, false);
  assert.equal(a.courseCostAtTime, r.balanced.courseCost);
  assert.ok(a.timestamp);
});

test("garbage in never throws", () => {
  assert.equal(RX.choose(null, null).prescribed.brand, undefined);
  assert.equal(RX.compositionKey(null), "");
  assert.equal(RX.parsePack(null), null);
  assert.equal(RX.normalizeForm(undefined), "");
  assert.equal(RX.totals([]).generic, null);
});
