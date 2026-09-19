/* test/wardsynq-downtime.test.mjs — what the ward holds when the system is not there. Pure half.
 *
 * node --test test/wardsynq-downtime.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { patientPage, staleness } from "../functions/_wardsynq/downtime.js";

const AT = "2026-09-07T09:00:00.000Z";
const page = (over) => patientPage({
  patientId: "pat", encounterId: "enc", ward: "Medical A", bed: "12", generatedAt: AT,
  from: AT, to: "2026-09-08T09:00:00.000Z",
  patient: { mrn: "SMD-1", name: "Asha Rao", dob: "1972-04-02" },
  allergies: [{ substance: "Penicillin", reaction: "anaphylaxis", severity: "severe" }],
  orders: [{ status: "active", drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TDS" }],
  criticals: [],
  ...(over || {}),
});

test("AN UNREADABLE ALLERGY LIST IS NAMED, never printed as a blank line", () => {
  /* This is the single most dangerous thing this file could get wrong. An empty allergy line on a
   * piece of paper reads as "no known allergies" to every clinician alive, so a read that FAILED and
   * a patient with no allergies must never look the same. */
  const failed = page({ allergies: null });
  assert.equal(failed.allergies, null);
  assert.ok(failed.problems.includes("allergies could not be read"));

  // A patient genuinely without allergies is an empty list, and carries no problem.
  const none = page({ allergies: [] });
  assert.deepEqual(none.allergies, []);
  assert.deepEqual(none.problems, []);

  // The same distinction for medicines and open criticals.
  assert.ok(page({ orders: null }).problems.includes("medicines could not be read"));
  assert.ok(page({ criticals: null }).problems.includes("open critical results could not be read"));
  assert.deepEqual(page({ allergies: null, orders: null, criticals: null }).problems.length, 3);
});

test("THE DUE TIMES ARE ON THE SHEET, and an unreadable frequency says it has none", () => {
  const p = page();
  assert.equal(p.orders.length, 1);
  assert.equal(p.orders[0].scheduleKnown, true);
  assert.ok(p.orders[0].due.length >= 3, "three times a day, over a day");

  /* An order whose frequency the schedule cannot read gets no times and SAYS so. A blank time column
   * would read as "nothing due today", which is how a dose gets missed for a whole outage. */
  const vague = page({ orders: [{ status: "active", drug: "Warfarin", frequency: "as directed" }] });
  assert.equal(vague.orders[0].scheduleKnown, false);
  assert.deepEqual(vague.orders[0].due, []);

  // PRN is marked as such rather than given invented times.
  const prn = page({ orders: [{ status: "active", drug: "Paracetamol", frequency: "PRN" }] });
  assert.equal(prn.orders[0].asNeeded, true);
  assert.deepEqual(prn.orders[0].due, []);

  // A stopped medicine is not on the sheet at all: a downtime pack that lists a drug somebody
  // deliberately stopped is worse than no pack.
  assert.deepEqual(page({ orders: [{ status: "stopped", drug: "Gentamicin" }] }).orders, []);
});

test("IT SAYS IT IS A COPY, and how old it is", () => {
  const s = staleness(AT, Date.parse("2026-09-07T11:30:00.000Z"));
  assert.equal(s.minutes, 150);
  /* A downtime sheet is dangerous in exactly one way: a clinician trusts it after it has gone stale.
   * So the sheet says what it does not know, in words, rather than looking authoritative. */
  assert.match(s.note, /NOT on this sheet/);
  assert.match(s.note, /Check the wristband/);

  // A pack with no generation time refuses to imply one.
  const broken = staleness("not a time", Date.now());
  assert.equal(broken.minutes, null);
  assert.match(broken.note, /Do not rely on it/);
});

test("it carries what a ward needs and not the whole chart", () => {
  const p = page({ criticals: [{ state: "open", display: "Potassium", value: 6.9, unit: "mmol/L" }, { state: "acknowledged", display: "Sodium" }] });
  // Only what is still OUTSTANDING. An acknowledged result has already reached a human.
  assert.equal(p.criticals.length, 1);
  assert.equal(p.criticals[0].display, "Potassium");
  // Enough to identify the right person at a bedside.
  assert.deepEqual([p.mrn, p.name, p.bed], ["SMD-1", "Asha Rao", "12"]);
  assert.equal(p.generatedAt, AT, "and every page is stamped, not just the cover");
});
