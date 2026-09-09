/* test/ward-maik-ui.test.mjs — TASK 8.5: MaiK on the patient's own chart. Pure _render.
 *
 * The rules this screen must not bend, and they are all about what a clinician can SEE before they
 * agree to anything: what MaiK read, whether any of it was written by another hospital, that MaiK
 * stated no confidence when it stated none, what would be WRITTEN if they accept, and that accepting
 * produces an unsigned note MaiK authored rather than their own words.
 *
 * node --test test/ward-maik-ui.test.mjs
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
const base = {
  orgId: "org-wsq", ward: "", patients: [], view: "chart", problems: [], due: [], dueAt: "", busy: false,
  err: "", note: "", refusal: null, loaded: true,
  sel: { encounterId: "wsq-adm-1", patientId: "pat-1", ward: "Ward A", bed: "12", admittedAt: "2026-09-07T04:00:00.000Z", class: "IPD" },
};
const view = (maik) => load()._render(Object.assign({}, base, { maik }));

const INTERACTION = {
  id: "wsq-ai-pat-1-x", patientId: "pat-1", task: "summarise",
  model: { provider: "local-openai", model: "ward-model-7b", version: "ward-model-7b-q4" },
  generated: true, latencyMs: 900,
  output: "67-year-old woman. Penicillin allergy recorded.",
  contextProvenance: [{ resourceType: "Patient", id: "pat-1", version: 1 }, { resourceType: "AllergyIntolerance", id: "a1", version: 1 }],
  contextDocuments: [],
  security: { documentsIncluded: 0, rejected: [], injectionFindings: [], outputViolations: [], released: true },
  uncertainty: null,
  review: { state: "pending", by: null, at: null, reason: null, editedOutput: null },
  preview: null, resultingChanges: [],
};

/* ---- 1 ------------------------------------------------------------------------------------------ */

test("1. with nothing asked, MaiK offers two clinical acts and states what it cannot do", () => {
  const html = view({});
  assert.match(html, /data-w-act="maikask:summarise"/);
  assert.match(html, /data-w-act="maikask:draft-note"/);
  assert.match(html, /cannot sign, prescribe or change anything by itself/);
  // Not a chatbot: there is no free-text prompt box and no conversation.
  assert.ok(!/textarea id="wMaikPrompt"/.test(html));
  assert.ok(!/\bchat\b/i.test(html));
});

test("2. an answer always shows what MaiK read and which model answered", () => {
  const html = view({ interaction: INTERACTION });
  assert.match(html, /Penicillin allergy recorded/);
  assert.match(html, /Read 2 record versions from this chart/);
  assert.match(html, /ward-model-7b/);
  assert.match(html, /ward-model-7b-q4/, "the version that actually answered");
});

test("3. no stated confidence is SAID to be none, never rendered as a number", () => {
  const html = view({ interaction: INTERACTION });
  assert.match(html, /stated no measure of its own certainty\. Absence of a warning is not reassurance\./);
  const withUncertainty = view({ interaction: { ...INTERACTION, uncertainty: "low" } });
  assert.match(withUncertainty, /Model-stated uncertainty: low/);
  assert.ok(!/Absence of a warning/.test(withUncertainty));
});

test("4. text written by another hospital is called out on the answer", () => {
  const html = view({ interaction: { ...INTERACTION,
    contextDocuments: [{ id: "ClinicalNote/n1", origin: "fhir-partner-his", trust: "retrieved" }] } });
  assert.match(html, /Includes text written by another system: fhir-partner-his/);
});

test("5. a document that contained something shaped like an instruction is surfaced, not hidden", () => {
  const html = view({ interaction: { ...INTERACTION,
    security: { ...INTERACTION.security, injectionFindings: [{ id: "ClinicalNote/n1", signals: ["ignore-previous"] }] } } });
  assert.match(html, /contained something that reads like an instruction/);
  assert.match(html, /fenced as data and could not act/);
});

/* ---- 6: the three verbs, and the preview before them ---------------------------------------------- */

test("6. Accept, Edit and Reject are the only verbs, and there is no silent insertion", () => {
  const html = view({ interaction: INTERACTION });
  assert.match(html, /data-w-act="maikreview:accepted"/);
  assert.match(html, /data-w-act="maikedit"/);
  assert.match(html, /data-w-act="maikreview:rejected"/);
  for (const bad of ["Apply", "Insert", "Use this", "Add to note"]) assert.ok(!html.includes(bad), `no "${bad}" verb`);
});

test("7. a draft says what accepting would WRITE, before anybody accepts it", () => {
  const html = view({ interaction: { ...INTERACTION, task: "draft-note",
    preview: { resourceType: "ClinicalNote", id: "x-note", authorId: "ai:maik", signedBy: null, aiDrafted: true,
      note: "Accepting writes this note UNSIGNED and authored by MaiK. It becomes your own words only when you sign it, through the ordinary note path." } } });
  assert.match(html, /If you accept/);
  assert.match(html, /A ClinicalNote will be created, authored by ai:maik and <b>unsigned<\/b>/);
  assert.match(html, /becomes your own words only when you sign it/);
});

test("8. a decided answer shows the decision and what it wrote, and offers no second decision", () => {
  const html = view({ interaction: { ...INTERACTION, task: "draft-note",
    review: { state: "accepted", by: "cfa:doc", at: "2026-09-09T10:00:00Z", reason: null, editedOutput: null },
    resultingChanges: [{ resourceType: "ClinicalNote", id: "x-note", version: 1, unsigned: true }] } });
  assert.match(html, /Accepted by cfa:doc/);
  assert.match(html, /wrote 1 record/);
  assert.ok(!html.includes('data-w-act="maikreview:accepted"'), "a decision cannot be made twice from the screen");
});

/* ---- 9: the failure cases a clinician must not misread --------------------------------------------- */

test("9. a withheld answer says it was stopped, rather than showing an empty card", () => {
  const html = view({ interaction: { ...INTERACTION, output: null,
    withheld: { reason: "withheld", violations: ["patient-boundary"] },
    security: { ...INTERACTION.security, released: false } } });
  assert.match(html, /answer was withheld before anybody saw it/);
  assert.match(html, /patient-boundary/);
  assert.match(html, /Nothing was shown and nothing was written/);
  assert.ok(!html.includes('data-w-act="maikreview:accepted"'), "there is nothing to accept");
});

test("10. the server's own refusal is shown verbatim, never flattened", () => {
  const html = view({ err: "MaiK is not enabled for this hospital. It is off unless wardsynq.maik.enabled is true: a clinical system does not acquire a model by default." });
  assert.match(html, /It is off unless wardsynq\.maik\.enabled is true/);
});

test("11. an assembled answer says it was assembled rather than generated", () => {
  const html = view({ interaction: { ...INTERACTION, generated: false,
    model: { provider: "wardsynq", model: "deterministic", version: "1" } } });
  assert.match(html, /assembled from the record, not generated/);
});

test("12. the card is on the patient's chart, not a screen of its own", () => {
  const html = view({});
  assert.match(html, /<h3>MaiK<\/h3>/);
  // It renders inside the chart view, which is only reachable with a patient selected.
  const list = load()._render(Object.assign({}, base, { view: "list", sel: null, maik: {} }));
  assert.ok(!list.includes("<h3>MaiK</h3>"), "and it does not appear on the ward list, where there is no patient");
});
