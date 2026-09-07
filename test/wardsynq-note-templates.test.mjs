/* test/wardsynq-note-templates.test.mjs — the shape of a note, without the words. Pure half.
 *
 * node --test test/wardsynq-note-templates.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_RECORDED, resolveTemplate, composeNote, noteIdFor } from "../functions/_wardsynq/note-templates.js";

const ROUND = {
  id: "ward-round", name: "Ward round note", version: "2", noteType: "progress",
  sections: [
    { key: "impression", title: "Impression", required: true, prompt: "How is the patient today?" },
    { key: "examination", title: "Examination", prompt: "What did you find?" },
    { key: "plan", title: "Plan", required: true },
  ],
};

test("A TEMPLATE PROVIDES HEADINGS, NEVER CONTENT", () => {
  const t = resolveTemplate(ROUND);
  assert.equal(t.ok, true);
  assert.equal(t.sections.length, 3);
  // A prompt is a QUESTION. "Chest clear" would be an answer, and answers belong to the clinician.
  assert.equal(t.sections[0].prompt, "How is the patient today?");
  assert.ok(!("default" in t.sections[0]) && !("text" in t.sections[0]));

  /* A section carrying DEFAULT TEXT is refused outright, not stripped and accepted. A chart full of
   * pre-filled normals is how "chest clear" ends up in the notes of a patient nobody listened to,
   * and afterwards it is indistinguishable from a real examination. */
  for (const bad of [{ default: "Chest clear" }, { defaultText: "NAD" }, { text: "System examination unremarkable" }]) {
    const r = resolveTemplate({ id: "t", name: "T", sections: [{ key: "exam", title: "Exam", ...bad }, { key: "plan", title: "Plan" }] });
    assert.deepEqual(r.problems.map((p) => p.reason), ["default_text_not_allowed"]);
    assert.equal(r.sections.length, 1, "the offending section is dropped, the rest stand");
  }
});

test("AN UNFILLED SECTION IS VISIBLY UNFILLED, never hidden", () => {
  const t = resolveTemplate(ROUND);
  const c = composeNote(t, { impression: "Improving, afebrile since 14:00." });
  // Every section appears. A template cannot make a thin note look complete by hiding its own gaps.
  assert.deepEqual(Object.keys(c.sections).sort(), ["examination", "impression", "plan"]);
  assert.equal(c.sections.examination, NOT_RECORDED);
  assert.equal(c.sections.plan, NOT_RECORDED);
  assert.equal(c.sections.impression, "Improving, afebrile since 14:00.");
});

test("REQUIRED MEANS INCOMPLETE AND NAMED, NOT REFUSED", () => {
  const t = resolveTemplate(ROUND);
  const thin = composeNote(t, { impression: "Stable." });
  /* A clinician interrupted mid-note by an arrest must be able to save what they have. A system
   * that refuses is one people stop using for the notes that matter most - so the gap is named
   * instead of the work being thrown away. */
  assert.equal(thin.complete, false);
  assert.deepEqual(thin.missing.map((m) => m.key), ["plan"]);
  assert.equal(thin.missing[0].title, "Plan");
  // An optional section left empty does not make the note incomplete.
  const done = composeNote(t, { impression: "Stable.", plan: "Continue antibiotics, review tomorrow." });
  assert.equal(done.complete, true);
  assert.deepEqual(done.missing, []);
  assert.equal(done.sections.examination, NOT_RECORDED, "still visibly unfilled, just not required");
  // Whitespace is not an answer.
  assert.equal(composeNote(t, { impression: "  ", plan: "x" }).complete, false);
});

test("text for a section the template does not have is REPORTED, not dropped and not added", () => {
  const t = resolveTemplate(ROUND);
  const c = composeNote(t, { impression: "Stable.", plan: "Home tomorrow.", socialHistory: "Lives alone." });
  // This is the case where the template changed under the clinician mid-note. Silently dropping it
  // loses what they wrote; silently adding it puts a heading in the note the template never had.
  assert.deepEqual(c.unknown, ["socialHistory"]);
  assert.ok(!("socialHistory" in c.sections));
  assert.equal(c.complete, true, "and the note is still judged on the template's own sections");
});

test("a malformed template is reported, and one with nothing usable is not a template", () => {
  const r = resolveTemplate({
    id: "t", name: "T",
    sections: [{ key: "a", title: "A" }, { title: "" }, { key: "a", title: "Again" }],
  });
  assert.equal(r.sections.length, 1);
  assert.deepEqual(r.problems.map((p) => p.reason), ["no_key", "duplicate"]);
  assert.equal(resolveTemplate({ id: "t", name: "T", sections: [] }).error, "template_empty");
  assert.equal(resolveTemplate({ name: "no id" }).error, "template_incomplete");
  // Nothing here ships a clinical template of its own: the headings a hospital wants are a clinical
  // decision, and inventing them would be making it.
  assert.equal(resolveTemplate({ id: "t", name: "T", sections: [{ key: "x", title: "X" }] }).sections[0].required, false, "required is opt-in");
});

test("two ward rounds in a day are two notes", () => {
  const a = noteIdFor("enc", "ward-round", "2026-09-10T09:00:00.000Z");
  assert.equal(a, noteIdFor("ENC", "Ward Round", "2026-09-10T09:00:00.000Z"));
  assert.notEqual(a, noteIdFor("enc", "ward-round", "2026-09-10T17:00:00.000Z"));
  assert.notEqual(a, noteIdFor("enc", "operation-note", "2026-09-10T09:00:00.000Z"));
  assert.equal(noteIdFor("", "t", "at"), null);
});
