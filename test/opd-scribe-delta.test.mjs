/* test/opd-scribe-delta.test.mjs — the incremental (delta) cloud refine, server side.
 *
 * The cloud refine used to re-read the WHOLE growing transcript every 45 s, so a consult's input
 * cost grew with the SQUARE of its length. A background refine now sends only the speech since the
 * last APPLIED call plus the draft so far, and mergeScribeDraft folds the reply back in.
 *
 * A dropped clinical fact is the failure mode here, so the merge rules are asserted one by one:
 * add, update, NEVER blank, an absent key means "nothing new", and an explicit negation may correct
 * an earlier Yes. The merge semantics mirror maik-local.js scribeMerge/mergeText so the on-device
 * and cloud engines agree.
 *
 * node --test test/opd-scribe-delta.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeScribeDraft, scribeExtractPrompt, sanitizeScribeOutput, flagContradictions } from "../functions/api/ai/_opd-scribe.js";

const draft = (emrFields, extra) => Object.assign({ emrFields, suggestions: { ddx: [], investigations: [] } }, extra || {});

// ── merge rule: ADD ────────────────────────────────────────────────────────────────────────────
test("merge: a delta ADDS a field the draft does not have", () => {
  const out = mergeScribeDraft(draft({ cc: "Fever x 3 days" }), draft({ allergies: "Penicillin allergy" }));
  assert.equal(out.emrFields.cc, "Fever x 3 days");
  assert.equal(out.emrFields.allergies, "Penicillin allergy");
});

// ── merge rule: UPDATE (accumulate, never shorten) ─────────────────────────────────────────────
test("merge: a delta EXTENDS a narrative field instead of replacing it", () => {
  const out = mergeScribeDraft(draft({ presentHx: "Fever for 3 days, no chills" }),
                               draft({ presentHx: "Vomiting twice since this morning" }));
  assert.match(out.emrFields.presentHx, /Fever for 3 days/, "the earlier history must survive");
  assert.match(out.emrFields.presentHx, /Vomiting twice/, "the new history must be added");
});

test("merge: a delta that only rewords what is already there does not duplicate it", () => {
  const out = mergeScribeDraft(draft({ cc: "Fever for 3 days, cough" }), draft({ cc: "Fever 3 days cough" }));
  assert.equal(out.emrFields.cc, "Fever for 3 days, cough", "token containment keeps the field from growing forever");
});

// ── merge rule: NEVER blank ────────────────────────────────────────────────────────────────────
test("merge: an ABSENT key means 'nothing new about this', never 'clear it'", () => {
  const prev = draft({ cc: "Fever x 3 days", pastHx: "Appendicectomy 2019", dm: "Yes" });
  const out = mergeScribeDraft(prev, draft({ advice: "Review in 3 days" }));
  assert.equal(out.emrFields.cc, "Fever x 3 days");
  assert.equal(out.emrFields.pastHx, "Appendicectomy 2019");
  assert.equal(out.emrFields.dm, "Yes");
});

test("merge: an EMPTY value never blanks or shortens a populated field", () => {
  const prev = draft({ cc: "Fever x 3 days", presentHx: "Long history text that must not be lost" });
  const out = mergeScribeDraft(prev, draft({ cc: "", presentHx: "   " }));
  assert.equal(out.emrFields.cc, "Fever x 3 days");
  assert.equal(out.emrFields.presentHx, "Long history text that must not be lost");
});

test("merge: no delta can make any populated field shorter than it was", () => {
  const prev = draft({ cc: "Fever x 3 days", presentHx: "A B C D E F", homeMeds: "Metformin 500mg BD" });
  const nexts = [draft({}), draft({ cc: "" }), draft({ presentHx: "G" }), draft({ homeMeds: "Metformin" })];
  nexts.forEach((n) => {
    const out = mergeScribeDraft(prev, n);
    ["cc", "presentHx", "homeMeds"].forEach((k) => {
      assert.ok((out.emrFields[k] || "").length >= prev.emrFields[k].length, k + " shrank on " + JSON.stringify(n.emrFields));
    });
  });
});

// ── merge rule: Yes/No + contradiction correction ──────────────────────────────────────────────
test("merge: a bare 'No' does NOT overturn a stated 'Yes' (a model re-emitting every key must not erase a history)", () => {
  const out = mergeScribeDraft(draft({ dm: "Yes" }), draft({ dm: "No" }));
  assert.equal(out.emrFields.dm, "Yes");
});

test("merge: 'No' -> 'Yes' is always accepted", () => {
  const out = mergeScribeDraft(draft({ dm: "No" }), draft({ dm: "Yes" }));
  assert.equal(out.emrFields.dm, "Yes");
});

test("merge: an EXPLICIT negation in the new speech does overturn the earlier Yes", () => {
  // The doctor corrects themselves: the draft says the patient is on metformin, the new speech says
  // it was stopped. flagContradictions catches it on the details field; the Yes/No sibling flips.
  const prev = draft({ dm: "Yes", dmDetails: "Type 2 DM on metformin 500mg BD" });
  const newSpeech = "actually she stopped metformin last month";
  const contradictions = flagContradictions(newSpeech, prev);
  assert.ok(contradictions.some((c) => c.field === "dmDetails"), "the contradiction must be seen: " + JSON.stringify(contradictions));
  const out = mergeScribeDraft(prev, draft({ dm: "No" }), { contradictions });
  assert.equal(out.emrFields.dm, "No", "the newer, explicit statement wins");
});

test("merge: a contradicted NARRATIVE field keeps both statements (the correction is added, nothing is deleted)", () => {
  const prev = draft({ presentHx: "Fever for 3 days" });
  const newSpeech = "no fever actually, she only felt warm";
  const out = mergeScribeDraft(prev, draft({ presentHx: "Denies fever" }), { contradictions: flagContradictions(newSpeech, prev) });
  assert.match(out.emrFields.presentHx, /Fever for 3 days/);
  assert.match(out.emrFields.presentHx, /Denies fever/, "the newer statement is recorded, the older is not silently deleted");
});

// ── merge rule: suggestions / en / alcoholDetail ───────────────────────────────────────────────
test("merge: ddx and investigations are unioned, the latest provisionalDx wins", () => {
  const prev = draft({}, { suggestions: { provisionalDx: "Viral fever", ddx: ["Dengue"], investigations: ["CBC"] } });
  const next = draft({}, { suggestions: { provisionalDx: "Dengue fever", ddx: ["Dengue", "Malaria"], investigations: ["NS1"] } });
  const out = mergeScribeDraft(prev, next);
  assert.equal(out.suggestions.provisionalDx, "Dengue fever");
  assert.deepEqual(out.suggestions.ddx, ["Dengue", "Malaria"]);
  assert.deepEqual(out.suggestions.investigations, ["CBC", "NS1"]);
});

test("merge: the reply's `en` is the delta's own translation and is not dropped", () => {
  const out = mergeScribeDraft(draft({ cc: "Fever" }), draft({}, { en: "She says the fever came down." }));
  assert.equal(out.en, "She says the fever came down.");
});

test("merge: `sources` is never carried into the merged draft (a delta-only citation map would mis-badge earlier fields)", () => {
  const out = mergeScribeDraft(draft({ cc: "Fever" }), draft({ advice: "Rest" }, { sources: { advice: "take rest" } }));
  assert.equal(out.sources, undefined);
});

test("merge: unknown keys in either side are dropped (whitelist only)", () => {
  const out = mergeScribeDraft(draft({ cc: "Fever", evil: "x" }), draft({ alsoEvil: "y" }));
  assert.deepEqual(Object.keys(out.emrFields), ["cc"]);
});

// ── the prompt ─────────────────────────────────────────────────────────────────────────────────
test("prompt: with no priorDraft the prompt is BYTE-IDENTICAL to today's", () => {
  const t = "patient with fever";
  assert.equal(scribeExtractPrompt(t, { priorDraft: null }), scribeExtractPrompt(t));
  assert.equal(scribeExtractPrompt(t, { priorDraft: {} }), scribeExtractPrompt(t));
  assert.equal(scribeExtractPrompt(t, { priorDraft: { emrFields: {} } }), scribeExtractPrompt(t));
  assert.match(scribeExtractPrompt(t), /=== TRANSCRIPT ===\npatient with fever$/);
});

test("prompt: a priorDraft switches to delta mode — new speech last, captured note quoted, en is the NEW speech only", () => {
  const p = scribeExtractPrompt("and now she is vomiting", { priorDraft: { emrFields: { cc: "Fever x 3 days" } } });
  assert.match(p, /=== ALREADY CAPTURED \(the note so far\) ===\n\{"cc":"Fever x 3 days"\}/);
  assert.match(p, /=== NEW SPEECH ===\nand now she is vomiting$/);
  assert.match(p, /translation of the NEW SPEECH below ONLY/);
  assert.match(p, /OMITTED key means 'nothing new about this'/);
  assert.match(p, /never means 'clear it'/);
  assert.match(p, /CORRECTS\s+or contradicts/);
  assert.doesNotMatch(p, /=== TRANSCRIPT ===/);
});

test("prompt: delta mode is SMALLER than sending the whole transcript again", () => {
  const whole = "sentence about the consultation. ".repeat(400);   // ~13 000 chars, a 20-minute consult
  const tail = "sentence about the consultation. ".repeat(16);     // one 45-second window
  const prior = { emrFields: { cc: "Fever x 3 days", presentHx: "A ".repeat(200), pastHx: "B ".repeat(100) } };
  const full = scribeExtractPrompt(whole).length;
  const delta = scribeExtractPrompt(tail, { priorDraft: prior }).length;
  assert.ok(delta < full / 2, "delta prompt " + delta + " must be far smaller than the full one " + full);
});

test("prompt: the specialty block still rides along in delta mode", () => {
  const p = scribeExtractPrompt("x", { specialtyPrompt: "- ecgFindings: any stated ECG findings", priorDraft: { emrFields: { cc: "chest pain" } } });
  assert.match(p, /- ecgFindings: any stated ECG findings/);
  assert.match(p, /=== NEW SPEECH ===/);
});

// ── the prior draft is request-body input: it goes through the same whitelist as a model reply ──
test("a hostile priorDraft cannot smuggle keys or unbounded text into the prompt", () => {
  const hostile = { emrFields: { cc: "x".repeat(9000), __proto__: "y", notAField: "z", dm: "maybe" } };
  const clean = sanitizeScribeOutput(hostile);
  assert.equal(clean.emrFields.cc.length, 2000, "capped like any model field");
  assert.equal(clean.emrFields.notAField, undefined);
  assert.equal(clean.emrFields.dm, "maybe");   // not a Yes/No token: kept verbatim, still whitelisted+capped
  const p = scribeExtractPrompt("new speech", { priorDraft: clean });
  assert.doesNotMatch(p, /notAField/);
});
