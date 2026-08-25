/* Inheritance patterns: the disease-to-pattern assignments must be right.
 *
 * R1 re-review, 2026-08-25, found two of mine wrong, and both were merge blockers:
 *   Fragile X was filed as X-linked RECESSIVE (it is X-linked dominant with reduced penetrance),
 *   which teaches that carrier females are unaffected and that a transmitting male's daughters are
 *   safe. About half of full-mutation females are affected and he passes the premutation to ALL of
 *   his daughters.
 *   Ehlers-Danlos was filed as autosomal RECESSIVE (most types, including the vascular type that
 *   ruptures arteries and bowel, are dominant), which would have had a family counselled at a 25%
 *   recurrence risk when the truth is 50%.
 *
 * Neither error looked wrong. A table of conditions reads as authoritative whatever it says, which
 * is precisely why the assignments are asserted here rather than left to review.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = JSON.parse(readFileSync(join(ROOT, "clinix/skills/core.json"), "utf8")).skills;
const inh = core["skill.annex.inheritance"];
const blob = JSON.stringify(inh);

/* The autosomal-dominant and autosomal-recessive columns of the examples table. */
function adAr() {
  const t = inh.teach.find((x) => (x.heading || "").startsWith("Examples worth knowing"));
  assert.ok(t?.table, "the AD/AR examples table is missing");
  const ad = t.table.rows.map((r) => r[1] || "").join(" | ");
  const ar = t.table.rows.map((r) => r[2] || "").join(" | ");
  return { ad, ar };
}

test("Fragile X is X-linked DOMINANT, and is not in the recessive list", () => {
  const xlr = inh.teach.find((x) => (x.heading || "").startsWith("X-linked recessive"));
  assert.ok(xlr, "the X-linked recessive block is missing");
  assert.ok(!/fragile/i.test(JSON.stringify(xlr.points || [])),
    "Fragile X must not be listed among the X-linked recessive conditions");
  assert.match(blob, /fragile x.{0,60}dominant/i,
    "Fragile X must be identified as X-linked dominant");
  assert.match(blob, /penetrance|half of full-mutation|premutation/i,
    "the counselling consequence (carrier females may be affected) must be stated");
});

test("Ehlers-Danlos is autosomal DOMINANT for the types that matter", () => {
  const { ad, ar } = adAr();
  assert.match(ad, /Ehlers-Danlos/i, "most EDS types, including vascular, are dominant");
  // It may appear in the recessive column ONLY with the two genuinely recessive types named.
  if (/Ehlers-Danlos/i.test(ar)) {
    assert.match(ar, /kyphoscoliotic|dermatosparaxis/i,
      "if EDS appears under recessive it must name only the kyphoscoliotic/dermatosparaxis types");
  }
});

test("the genuinely X-linked recessive conditions are still correct", () => {
  const xlr = JSON.stringify(inh.teach.find((x) => (x.heading || "").startsWith("X-linked recessive")));
  for (const ok of [/duchenne/i, /haemophilia|hemophilia/i, /glucose-6-phosphate|G6PD/i, /agammaglobulinaemia|agammaglobulinemia/i]) {
    assert.match(xlr, ok, `a true X-linked recessive condition is missing: ${ok}`);
  }
});

test("storage diseases are not blanket-labelled autosomal recessive", () => {
  // Fabry and Hunter (MPS II) are X-linked.
  assert.match(blob, /Fabry/i);
  assert.match(blob, /Hunter|MPS II/i);
  assert.match(blob, /Fabry.{0,80}X-linked|X-linked.{0,80}Fabry/i,
    "Fabry and Hunter must be marked as X-linked, not lumped with the recessive storage diseases");
});

test("polycystic kidney disease is qualified, since both AD and AR forms exist", () => {
  const { ad, ar } = adAr();
  assert.match(ad, /ADPKD|autosomal dominant polycystic/i, "the dominant form must be named as ADPKD");
  assert.match(ar, /ARPKD|autosomal recessive polycystic/i, "ARPKD is a real paediatric entity");
});

test("the male-to-male rule is stated in the correct direction", () => {
  /* The original `why` said the ABSENCE of male to male transmission "settles X-linked recessive
   * inheritance on its own". That is the converse. Absence is compatible with autosomal recessive,
   * mitochondrial and Y-linked inheritance, and with any pedigree that simply has no father-son
   * pair. Only its PRESENCE is informative, and it EXCLUDES X-linkage. */
  assert.match(inh.why, /excludes? X-linked|excludes X-link/i,
    "the why must say that father-to-son transmission EXCLUDES X-linkage");
  assert.ok(!/absence of male to male transmission,? settles/i.test(inh.why),
    "the inverted claim must not return");
  assert.match(blob, /mitochondrial/i,
    "mitochondrial inheritance also shows no male-to-male transmission and is the direct confounder");
});

test("a blank family history is not treated as excluding a genetic condition", () => {
  assert.match(blob, /de novo|new mutation/i, "most achondroplasia is a new mutation");
  assert.match(blob, /germline mosaic/i, "recurrence risk after a sporadic case is low but not zero");
  assert.ok(!/recurrence risk (is )?zero/i.test(blob.replace(/NOT zero/gi, "")),
    "never counsel recurrence risk as zero");
});

test("recurrence-risk arithmetic does not imply carriers are affected", () => {
  const p3 = (inh.probes || []).find((p) => p.level === 3);
  assert.ok(p3, "the level 3 probe is missing");
  assert.match(p3.a, /one in four/i);
  assert.match(p3.a, /one in two.{0,40}carrier/i, "one in two are unaffected CARRIERS");
  assert.match(p3.a, /neither affected nor a carrier/i,
    "the final quarter must be described as neither affected nor a carrier");
});

test("the history framework has an acuity gate before its twelve steps", () => {
  const fw = core["skill.approach.history_framework"];
  const t = JSON.stringify(fw);
  assert.match(t, /ABCDE/, "an unstable patient gets ABCDE first, not a full history");
  assert.match(t, /collateral/i, "a patient who cannot give a history needs a collateral one");
  // The gate must come FIRST, or it is not a gate.
  assert.match(fw.teach[0].heading || "", /stable/i,
    "the acuity gate must be the first teach block");
});

test("systemic enquiry opens with the constitutional screen", () => {
  const fw = core["skill.approach.history_framework"];
  const t = fw.teach.find((x) => (x.heading || "").startsWith("Systemic enquiry"));
  assert.ok(t?.table, "the systemic enquiry table is missing");
  const first = t.table.rows[0];
  assert.match(first[0], /general/i, "fever, sweats and weight loss belong at the top");
  assert.match(first[1], /night sweats/i);
  assert.match(first[1], /weight loss/i);
  assert.match(first[1], /tuberculosis/i, "in this setting it is the TB and malignancy screen");
  // Male lower urinary tract symptoms were missing from a table that covered gynaecology.
  const uro = t.table.rows.find((r) => /urogenital/i.test(r[0]));
  assert.match(uro[1], /hesitancy|poor stream|dribbling/i, "male LUTS are high yield here");
});
