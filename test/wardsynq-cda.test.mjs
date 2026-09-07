/* test/wardsynq-cda.test.mjs — the discharge summary as a document. Pure.
 *
 * node --test test/wardsynq-cda.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, ts, titleOf, cdaDocument } from "../functions/_wardsynq/cda.js";

const SUMMARY = {
  id: "wsq-dcs-adm-1", patientId: "pat-1", signedBy: "cfa:dr", signedAt: "2026-09-09T10:00:00.000Z",
  sections: { diagnoses: "Community-acquired pneumonia", followUp: "GP review in one week" },
};
const PAT = { id: "pat-1", mrn: "SMD-1", name: "Asha Rao", dob: "1972-04-02", sex: "female" };
const ENC = { id: "wsq-adm-1", periodStart: "2026-09-07T08:00:00.000Z", periodEnd: "2026-09-09T10:00:00.000Z" };
const doc = (over) => cdaDocument({ summary: SUMMARY, patient: PAT, encounter: ENC, org: { name: "WSQ Hospital", oid: "2.25.1" }, now: "2026-09-09T11:00:00.000Z", ...(over || {}) });

test("ONLY A SIGNED SUMMARY LEAVES", () => {
  /* A draft has no author who has stood behind it, and a receiving hospital reading one would be
   * reading something nobody here has agreed to. */
  assert.equal(cdaDocument({ summary: { ...SUMMARY, signedBy: null }, patient: PAT }), null);
  assert.equal(cdaDocument({ summary: null }), null);
  assert.equal(cdaDocument({ summary: { ...SUMMARY, sections: {} } }), null, "and a summary with no sections is not a document");
  assert.ok(doc().includes("<ClinicalDocument"));
});

test("EVERY VALUE IS XML-ESCAPED, and the ampersand goes first", () => {
  /* A patient named "Smith & Sons" does not produce a slightly odd document - it produces one that
   * will not parse, or worse, one that parses into the wrong shape. */
  assert.equal(esc("a & b"), "a &amp; b");
  assert.equal(esc("<script>"), "&lt;script&gt;");
  assert.equal(esc('say "x"'), "say &quot;x&quot;");
  assert.equal(esc("it's"), "it&apos;s");
  // The ampersand MUST be replaced first or it re-escapes what the others introduce.
  assert.equal(esc("a<b"), "a&lt;b");
  assert.ok(!esc("a<b").includes("&amp;lt;"), "not double-escaped");

  const hostile = doc({ patient: { ...PAT, name: "Smith & Sons <test>" } });
  assert.match(hostile, /Smith &amp; Sons &lt;test&gt;/);
  assert.ok(!hostile.includes("<test>"), "no tag was opened by a name");
});

test("IT CLAIMS LEVEL 1 AND NO MORE", () => {
  const d = doc();
  /* A templateId asserts conformance to a profile this has never been validated against, and a
   * receiver cannot tell a real conformance claim from an invented one. */
  assert.ok(!d.includes("templateId"), "no conformance is asserted");
  assert.match(d, /<typeId root="2\.16\.840\.1\.113883\.1\.3"/, "but it is a real CDA R2 document");
  assert.match(d, /code="18842-5"/, "and it says it is a discharge summary");
  // Narrative only: no coded entries anywhere.
  assert.ok(!d.includes("<entry>"), "no coded entries");
  assert.ok(!d.includes("<observation"), "and nothing pretending to be one");
});

test("the author is who SIGNED it, and nothing is summarised", () => {
  const d = doc();
  // Not whoever exported it: the document's author is the person accountable for its contents.
  assert.match(d, /<id extension="cfa:dr"\/>/);
  assert.match(d, /<time value="20260909100000"\/>/, "and the time they signed");

  // The sections are the summary's own words, verbatim and in full.
  assert.match(d, /Community-acquired pneumonia/);
  assert.match(d, /GP review in one week/);
  assert.match(d, /<title>Diagnoses<\/title>/, "the key is humanised for display only");
  assert.match(d, /<title>Follow Up<\/title>/);
  assert.equal(titleOf("followUp"), "Follow Up");
  assert.equal(titleOf(""), "Section");
});

test("a field the record does not have is EMPTY, never a placeholder", () => {
  const bare = cdaDocument({ summary: SUMMARY, patient: { id: "pat-1", mrn: "SMD-2" }, org: {} });
  // A placeholder name is one somebody would read as the patient's actual name.
  assert.match(bare, /<name><\/name>/);
  assert.ok(!bare.includes("birthTime"), "no dob means no birthTime element at all");
  assert.ok(!bare.includes("administrativeGenderCode"));
  // An unparseable time is empty rather than a plausible instant.
  assert.equal(ts("not a date"), "");
  assert.equal(ts("2026-09-09T10:00:00.000Z"), "20260909100000");
  // No encounter means no componentOf, rather than an empty one implying a stay.
  assert.ok(!bare.includes("encompassingEncounter"));
});
