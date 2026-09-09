/* test/ward-maik-cds-ui.test.mjs — TASK 8.9: MaiK's explanation on the screen that already shows the
 * verdict. Pure _render, no browser.
 *
 * THE PROPERTY. There is exactly ONE place a clinician reads a safety verdict, and MaiK renders
 * inside it, underneath it, labelled as MaiK. A second CDS panel would be a second place to read the
 * findings, and the two would eventually disagree. These tests hold that shape, and they hold the
 * three things a clinician must be able to tell apart on the screen: the engine's findings, MaiK's
 * words about them, and what reviewing those words does (nothing, to any finding).
 *
 * node --test test/ward-maik-cds-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.WARD;
}

const SAFETY = {
  blocks: [], warnings: [],
  findings: [{ code: "ALLERGY_CLASS", severity: "contraindicated", disposition: "overridable",
    message: "amoxicillin belongs to penicillins, which the patient is documented allergic to (penicillin)." }],
};
const QUEUE = {
  ok: true, unverified: 1, allergies: [{ substance: "penicillin", severity: "severe" }],
  orders: [{ orderId: "ord-1", drug: "amoxicillin", state: "unverified",
    safety: { ...SAFETY, blocks: [{ code: "ALLERGY_CLASS", message: "documented penicillin allergy" }] } }],
};
const base = {
  orgId: "org-wsq", ward: "", patients: [], view: "pharmacy", problems: [], due: [], dueAt: "", busy: false,
  err: "", note: "", refusal: null, loaded: true, maik: null,
  sel: { encounterId: "wsq-adm-1", patientId: "pat-1", ward: "Ward A", bed: "12", admittedAt: "2026-09-07T04:00:00.000Z", class: "IPD" },
};
const view = (explain) => load()._render(Object.assign({}, base, {
  pharmacy: { queue: QUEUE, pickedOrderId: "ord-1", dispenses: [], explain: explain || null },
}));

const INTERACTION = {
  id: "wsq-maik-cds-pat-1-x", patientId: "pat-1", task: "explain",
  model: { provider: "local-openai", model: "ward-model-7b", version: "ward-model-7b-q4" },
  review: { state: "pending", by: null, at: null, reason: null, editedOutput: null },
  resultingChanges: [],
};
const ANSWERED = {
  orderId: "ord-1", busy: false, err: "",
  explanation: "Amoxicillin is a penicillin. This patient is documented anaphylactic to penicillin.",
  deterministic: { rulePackVersion: "stewardmd-1.0.0+seed+brands", unapproved: true, findings: SAFETY.findings },
  withheld: null, interaction: INTERACTION,
};

/* ---- 1: one CDS surface, and MaiK is inside it ---------------------------------------------------- */

test("1. MaiK is offered inside the card that already shows the verdict, not on a screen of its own", () => {
  const html = view(null);
  assert.match(html, /Safety verdict/, "the existing deterministic card is still the one place the verdict is read");
  assert.match(html, /data-w-act="maikexplain"/);
  // The offer sits after the verdict, not before it: the findings are what a clinician reads first.
  assert.ok(html.indexOf("Safety verdict") < html.indexOf('data-w-act="maikexplain"'));
  // No second verdict, no second findings list, no chat.
  assert.equal(html.match(/Safety verdict/g).length, 1);
  assert.ok(!/\bchat\b/i.test(html));
  assert.ok(!/textarea id="wMaik/.test(html));
});

test("2. an explanation says the engine computed it and MaiK did not", () => {
  const html = view(ANSWERED);
  assert.match(html, /documented anaphylactic to penicillin/, "MaiK's words are shown");
  assert.match(html, /MaiK computed none of this/);
  assert.match(html, /deterministic safety engine's, on rule pack stewardmd-1\.0\.0\+seed\+brands/);
  assert.match(html, /unapproved and does not gate this order/);
  assert.match(html, /ward-model-7b-q4/, "the model version that actually answered");
});

test("3. the screen states that reviewing MaiK overrides no finding", () => {
  const html = view(ANSWERED);
  assert.match(html, /overrides nothing/);
  assert.match(html, /Overriding a finding is a separate act, with its own reason, on the override record/);
  // The verbs are about the WORDS, never about the finding.
  assert.match(html, /data-w-act="maikexplainreview:accepted"/);
  assert.match(html, /data-w-act="maikexplainreview:rejected"/);
  for (const bad of ["Override", "Dismiss", "Acknowledge finding", "Clear finding"]) {
    assert.ok(!html.includes(bad), `no "${bad}" verb on a MaiK explanation`);
  }
});

test("4. a withheld answer says it was stopped, and says the findings are unaffected", () => {
  const html = view({ ...ANSWERED, explanation: null,
    withheld: { reason: "the explanation contradicted the deterministic verdict", violations: ["reassurance-over-findings"] } });
  assert.match(html, /answer was withheld before anybody saw it/);
  assert.match(html, /reassurance-over-findings/);
  assert.match(html, /findings above are the deterministic engine's own and are unaffected/);
  assert.ok(!html.includes('data-w-act="maikexplainreview:accepted"'), "there is nothing to call helpful");
  // And the engine's own card is untouched by MaiK being withheld.
  assert.match(html, /ALLERGY_CLASS/);
});

test("5. a refusal is rendered verbatim, never flattened into 'unavailable'", () => {
  const detail = 'the deterministic safety check did not run (no rule pack is loaded), so MaiK will not explain anything about this order. Nothing here means the order is safe; it means it was not checked.';
  const html = view({ orderId: "ord-1", busy: false, err: detail });
  assert.match(html, /Nothing here means the order is safe; it means it was not checked/);
  assert.match(html, /MaiK did not explain this/);
  assert.ok(!/\bunavailable\b/i.test(html.split("Safety verdict")[1] || ""), "not flattened");
  // The deterministic card still stands on its own.
  assert.match(html, /ALLERGY_CLASS/);
});

test("6. a decided explanation shows the decision, says no finding changed, and offers no second decision", () => {
  const html = view({ ...ANSWERED, interaction: { ...INTERACTION,
    review: { state: "rejected", by: "cfa:doc", at: "2026-09-09T10:00:00Z", reason: "Could mislead a junior.", editedOutput: null } } });
  assert.match(html, /Rejected by cfa:doc/);
  assert.match(html, /no finding changed/);
  assert.ok(!html.includes('data-w-act="maikexplainreview:accepted"'));
});

test("7. an explanation belonging to another order is not rendered under this one's findings", () => {
  const html = view({ ...ANSWERED, orderId: "ord-OTHER" });
  assert.ok(!html.includes("documented anaphylactic to penicillin"), "another order's words never appear here");
  assert.match(html, /data-w-act="maikexplain"/, "and the offer is back to unasked");
});
