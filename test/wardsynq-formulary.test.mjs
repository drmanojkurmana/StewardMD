/* test/wardsynq-formulary.test.mjs — what this hospital stocks, and what it guards. Pure.
 *
 * node --test test/wardsynq-formulary.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFormulary, lookup, formularyStatus } from "../functions/_wardsynq/formulary.js";

/* Shaped as a hospital would supply one. The CONTENT is this test's, not clinical guidance:
 * WardSynQ ships the structure and the hospital supplies the list it has approved. */
const LIST = [
  { drug: "Amoxicillin", aliases: ["Amoxycillin"] },
  { drug: "Amoxicillin-clavulanate" },
  { drug: "Meropenem", restricted: true, requiresApproval: true, approvedBy: "Microbiology", note: "Carbapenem stewardship." },
  { drug: "Vancomycin", restricted: true, restrictedTo: ["Intensive care", "Microbiology"] },
  { drug: "Paracetamol", code: "PCM-500" },
];
const F = resolveFormulary(LIST);
const status = (over) => formularyStatus({ formulary: F, ...(over || {}) });

test("A FORMULARY IS NOT A SAFETY CHECK: off-formulary never blocks", () => {
  const s = status({ drug: "Rifaximin" });
  assert.equal(s.state, "non-formulary");
  /* A drug not on the list is not dangerous - it is not stocked. Refusing on those grounds would
   * teach prescribers that the safety warnings are bureaucratic too, which is how the ones that
   * matter stop being read. */
  assert.equal(s.blocked, false);
  assert.match(s.detail, /The order stands/);
  assert.match(s.detail, /may need to obtain this/);

  // A hospital MAY require a reason. That is their control to switch on, and even then the reason is
  // recorded rather than adjudicated.
  const demanded = status({ drug: "Rifaximin", requireReasonOffFormulary: true });
  assert.equal(demanded.blocked, true);
  assert.equal(demanded.needs, "reason");
  const given = status({ drug: "Rifaximin", requireReasonOffFormulary: true, reason: "Patient's own supply from home." });
  assert.equal(given.blocked, false);
  assert.equal(given.reason, "Patient's own supply from home.");
});

test("RESTRICTED DOES BLOCK, and the refusal is actionable at 2am", () => {
  const s = status({ drug: "Meropenem" });
  assert.equal(s.state, "restricted");
  assert.equal(s.blocked, true);
  // It names what is missing AND who grants it. A refusal a prescriber cannot act on is one they
  // will work around.
  assert.match(s.detail, /needs an approval reference from Microbiology/);
  assert.equal(s.note, "Carbapenem stewardship.");

  assert.equal(status({ drug: "Meropenem", approvalRef: "MICRO-2291" }).blocked, false);
  assert.equal(status({ drug: "Meropenem", approvalRef: "MICRO-2291" }).satisfiedBy, "approval");

  // A specialty restriction is satisfied by being in that specialty, not by an approval number.
  const vanc = status({ drug: "Vancomycin" });
  assert.equal(vanc.blocked, true);
  assert.match(vanc.detail, /a prescriber in Intensive care or Microbiology/);
  assert.equal(status({ drug: "Vancomycin", specialty: "intensive care" }).blocked, false, "case is not identity");
  assert.equal(status({ drug: "Vancomycin", specialty: "Cardiology" }).blocked, true);
  assert.equal(status({ drug: "Vancomycin", approvalRef: "X" }).blocked, true, "an approval does not satisfy a specialty rule");
});

test("NOTHING IS MATCHED FUZZILY", () => {
  /* These are different drugs with different restrictions. A formulary that guessed would apply the
   * wrong rule with total confidence - or miss the restriction on the one that has it. */
  assert.equal(lookup(F, "Amoxicillin").drug, "Amoxicillin");
  assert.equal(lookup(F, "Amoxicillin-clavulanate").drug, "Amoxicillin-clavulanate");
  assert.equal(lookup(F, "Mero"), null, "a prefix is not a match");
  assert.equal(lookup(F, "IV Meropenem 1g"), null, "and neither is a substring");
  assert.equal(status({ drug: "Meropenem 1g" }).state, "non-formulary", "so it is off-formulary, not restricted-and-missed");

  // Case, spacing and punctuation are not identity; the words are.
  assert.equal(lookup(F, "  amoxicillin  ").drug, "Amoxicillin");
  // An alias the HOSPITAL wrote is a match. Nothing is inferred.
  assert.equal(lookup(F, "Amoxycillin").drug, "Amoxicillin");
  // A code matches too, and wins over the name.
  assert.equal(lookup(F, "anything at all", "PCM-500").drug, "Paracetamol");
});

test("an unusable entry is REPORTED, and no formulary is not an opinion", () => {
  const bad = resolveFormulary([...LIST, { note: "no drug and no code" }, { drug: "Colistin", restricted: true }]);
  assert.deepEqual(bad.problems.map((p) => p.reason), ["no_drug_or_code", "restriction_has_no_route"]);
  /* A restriction with nothing to satisfy it would refuse every order and no prescriber could ever
   * clear it. Reported rather than enforced. */
  assert.equal(lookup(bad, "Colistin"), null);
  assert.equal(bad.entries.length, 5, "the sound entries still stand");

  // No formulary at all is NOT "everything is off-formulary". It is no opinion, and blocks nothing.
  const none = formularyStatus({ formulary: resolveFormulary([]), drug: "Meropenem", requireReasonOffFormulary: true });
  assert.equal(none.state, "not-configured");
  assert.equal(none.blocked, false);
  assert.equal(formularyStatus({ drug: "Meropenem" }).blocked, false);
});
