import { test } from "node:test";
import assert from "node:assert";
import M from "../surgx-model.js";

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function src(over) {
  return Object.assign({ id: "s1", org: "WSES", title: "Some guideline", year: 2020 }, over || {});
}
function protocol(over) {
  return Object.assign({
    id: "p1", title: "A protocol", category: "abdomen",
    review: { status: "approved" },
    sources: [src()],
    bands: { red_flags: [{ text: "Rigid abdomen" }], definitive: [{ text: "Theatre", evidenceRef: "s1" }] }
  }, over || {});
}
function step(over) {
  return Object.assign({
    id: "step.x", kind: "access", title: "Incision", why: "Because access decides everything after it.",
    how: ["Cut."], review: { status: "approved" }
  }, over || {});
}
function procedure(over) {
  return Object.assign({
    id: "pr1", title: "An operation", educationalOnly: true,
    review: { status: "approved" }, sources: [src()],
    chapters: { indications: ["A reason"] },
    steps: [{ ref: "step.x" }]
  }, over || {});
}
function kase(over) {
  return Object.assign({
    id: "c1", title: "A case", simulation: true, levels: ["resident"],
    review: { status: "approved" }, stem: "A patient.",
    decisionPoints: [{
      id: "d1", phase: "decide", prompt: "What now?",
      options: [{ id: "a", text: "This", correct: true }, { id: "b", text: "That" }],
      why: "Because."
    }]
  }, over || {});
}

/* ── gate 1: review, and it must fail CLOSED ──────────────────────────────── */

test("review gate: only approved and published render by default", () => {
  assert.equal(M.isRenderable({ review: { status: "approved" } }), true);
  assert.equal(M.isRenderable({ review: { status: "published" } }), true);
  assert.equal(M.isRenderable({ review: { status: "ai_drafted" } }), false);
  assert.equal(M.isRenderable({ review: { status: "draft" } }), false);
  assert.equal(M.isRenderable({ review: { status: "in_review" } }), false);
});

test("review gate: a missing, empty or garbled status reads as draft, never as approved", () => {
  assert.equal(M.reviewStatus({}), "draft");
  assert.equal(M.reviewStatus(null), "draft");
  assert.equal(M.reviewStatus({ review: {} }), "draft");
  assert.equal(M.reviewStatus({ review: { status: "" } }), "draft");
  assert.equal(M.reviewStatus({ review: { status: "APPROVED!!" } }), "draft");
  assert.equal(M.reviewStatus({ review: { status: 42 } }), "draft");
  assert.equal(M.isRenderable({}), false);
  assert.equal(M.isRenderable({ review: { status: "aproved" } }), false);
});

test("review gate: a bare string status is accepted, case-insensitively", () => {
  assert.equal(M.reviewStatus({ review: "Approved" }), "approved");
  assert.equal(M.isRenderable({ review: "approved" }), true);
});

test("review gate: allowDraft opens everything except deprecated", () => {
  assert.equal(M.isRenderable({ review: { status: "ai_drafted" } }, { allowDraft: true }), true);
  assert.equal(M.isRenderable({ review: { status: "deprecated" } }, { allowDraft: true }), false);
});

/* ── gate 2: licence, and absence is a refusal ────────────────────────────── */

test("licence gate: absence of a licence record is a refusal, not a default-allow", () => {
  assert.equal(M.mediaRenderable(null), false);
  assert.equal(M.mediaRenderable({ id: "m", kind: "image" }), false);
  assert.equal(M.mediaRenderable({ id: "m", kind: "image", cleared: true }), false);
  assert.equal(M.mediaRenderable({ id: "m", kind: "image", cleared: true, licence: "CC BY 4.0" }), false);
});

test("licence gate: cleared + licence + attribution is NOT enough for a hosted external file", () => {
  const m = { id: "m", kind: "image", cleared: true, licence: "some licence", attribution: "Someone" };
  assert.equal(M.isMediaCleared(m), true, "the three fields are present");
  assert.equal(M.mediaRenderable(m), false, "but three typed fields are not diligence");
});

test("licence gate: an external file passes only with a verifiable open licence and https source", () => {
  const ok = { id: "m", kind: "image", cleared: true, licence: "CC BY 4.0", attribution: "A", sourceUrl: "https://commons.example/x" };
  assert.equal(M.mediaRenderable(ok), true);
  const httpOnly = Object.assign({}, ok, { sourceUrl: "http://commons.example/x" });
  assert.equal(M.mediaRenderable(httpOnly), false);
  const closedLicence = Object.assign({}, ok, { licence: "All rights reserved" });
  assert.equal(M.mediaRenderable(closedLicence), false);
});

test("licence gate: only self-authored media may be cleared as inline", () => {
  const mine = { id: "m", kind: "diagram", inline: true, diagramId: "d", caption: "c", cleared: true, licence: "StewardMD original work", attribution: "StewardMD" };
  assert.equal(M.mediaRenderable(mine), true);
  assert.equal(M.validateMedia(mine).ok, true);
  const theirs = Object.assign({}, mine, { attribution: "Someone Else" });
  assert.equal(M.validateMedia(theirs).ok, false, "an inline diagram attributed elsewhere must be refused");
});

test("licence gate: an uncleared entry must carry a work order", () => {
  const noNote = { id: "m", kind: "image", caption: "A picture", cleared: false };
  assert.equal(M.validateMedia(noNote).ok, false);
  const withNote = Object.assign({}, noNote, { note: "Source from an open atlas." });
  assert.equal(M.validateMedia(withNote).ok, true);
  assert.equal(M.mediaRenderable(withNote), false, "a work order does not make it renderable");
});

test("licence gate: the authoring escape hatch opens it, and only it", () => {
  const m = { id: "m", kind: "image", caption: "c", cleared: false, note: "todo" };
  assert.equal(M.mediaRenderable(m), false);
  assert.equal(M.mediaRenderable(m, { allowUncleared: true }), true);
});

/* ── gate 3: evidence ─────────────────────────────────────────────────────── */

test("evidence gate: an action item without a resolvable source fails validation", () => {
  const bad = protocol({ bands: { definitive: [{ text: "Operate" }, { text: "x", evidenceRef: "nope" }] }, sources: [src(), src({ id: "s2" })] });
  const r = M.validateProtocol(bad);
  assert.equal(r.ok, false);
  assert.equal(r.errors.filter((e) => /evidenceRef/.test(e)).length, 2);
});

test("evidence gate: a single-source protocol resolves implicitly", () => {
  const p = protocol({ bands: { do_now: [{ text: "Compress" }] } });
  assert.equal(M.validateProtocol(p).ok, true);
});

test("evidence gate: non-action bands need no source", () => {
  const p = protocol({ bands: { assess: [{ text: "Palpate" }], investigate: [{ text: "CT" }] }, sources: [src(), src({ id: "s2" })] });
  assert.equal(M.validateProtocol(p).ok, true);
});

test("a source needs org, title and a real year, and rejects placeholders", () => {
  assert.equal(M.isSource(src()), true);
  assert.equal(M.isSource(src({ org: "TBD" })), false);
  assert.equal(M.isSource(src({ title: "n/a" })), false);
  assert.equal(M.isSource(src({ year: null })), false);
  assert.equal(M.isSource(src({ year: 1800 })), false);
  assert.equal(M.isSource(src({ year: "2020" })), true, "a numeric string year is accepted");
});

/* ── validators ───────────────────────────────────────────────────────────── */

test("a step must be able to say WHY", () => {
  assert.equal(M.validateStep(step()).ok, true);
  const r = M.validateStep(step({ why: "" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /why required/.test(e)));
});

test("a procedure must declare itself educational", () => {
  assert.equal(M.validateProcedure(procedure(), { "step.x": step() }).ok, true);
  const r = M.validateProcedure(procedure({ educationalOnly: false }), { "step.x": step() });
  assert.equal(r.ok, false);
});

test("referential integrity: an unresolved stepRef fails rather than rendering an empty chapter", () => {
  const r = M.validateProcedure(procedure({ steps: [{ ref: "step.missing" }] }), { "step.x": step() });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /unresolved step/.test(e)));
});

test("a case must be labelled a simulation and must teach without AI", () => {
  assert.equal(M.validateCase(kase()).ok, true);
  assert.equal(M.validateCase(kase({ simulation: false })).ok, false);
  const noWhy = kase();
  noWhy.decisionPoints[0].why = "";
  assert.equal(M.validateCase(noWhy).ok, false, "a case with no authored 'why' breaks when the model does");
  const noCorrect = kase();
  noCorrect.decisionPoints[0].options = [{ id: "a", text: "x" }, { id: "b", text: "y" }];
  assert.equal(M.validateCase(noCorrect).ok, false);
});

/* ── protocol compilers ───────────────────────────────────────────────────── */

test("every compiled protocol has all seven bands, in the fixed order, always", () => {
  const c = M.compileProtocol(protocol());
  assert.equal(c.bands.length, 7);
  assert.deepEqual(c.bands.map((b) => b.band), M.BAND_IDS);
  assert.deepEqual(M.BAND_IDS, ["red_flags", "do_now", "assess", "investigate", "resuscitate", "definitive", "escalate"]);
});

test("an absent band compiles empty rather than being dropped or reordered", () => {
  const c = M.compileProtocol(protocol({ bands: { do_now: [{ text: "Now", evidenceRef: "s1" }] } }));
  assert.equal(c.bands.length, 7);
  assert.equal(c.bands.filter((b) => b.items.length).length, 1);
});

test("compileProtocol applies the review gate", () => {
  assert.equal(M.compileProtocol(protocol({ review: { status: "ai_drafted" } })), null);
  assert.ok(M.compileProtocol(protocol({ review: { status: "ai_drafted" } }), { allowDraft: true }));
});

/* ── the ws-surgery engine projection ─────────────────────────────────────── */

// A stand-in shaped exactly like a real ws-surgery.js syndrome.
function syndrome() {
  return {
    id: "syn", name: "A syndrome",
    q: [{ id: "pain", label: "Pain" }, { id: "vomit", label: "Vomiting" }],
    danger: [{ id: "shock", label: "Shock" }],
    assess: function (sel) {
      if (sel.has("shock")) {
        return {
          emergency: true, ladder: 5, catg: "Catastrophe",
          sc: "Theatre now.", ref: "Emergency referral.",
          mgmt: ["Do not delay for imaging.", "Resuscitate en route."],
          abx: { firstLine: [{ drug: "Pip-tazo", dose: "4.5 g", route: "IV q8h" }], ref: "ICMR AMRSN 2024" }
        };
      }
      return { emergency: false, ladder: 0, catg: "Undifferentiated", sc: "Observe.", ref: "Surgical review.", mgmt: ["Serial examination."] };
    }
  };
}
const NOSEL = { has: () => false };
const SHOCKED = { has: (k) => k === "shock" };

test("engine projection: source control becomes DEFINITIVE, referral becomes ESCALATION, one to one", () => {
  const c = M.compileEngineProtocol(syndrome(), NOSEL, null);
  const def = c.bands.find((b) => b.band === "definitive");
  const esc = c.bands.find((b) => b.band === "escalate");
  assert.equal(def.items[0].text, "Observe.");
  assert.equal(esc.items[0].text, "Surgical review.");
});

test("engine projection: clinical notes are carried WHOLE, never split across bands by keyword", () => {
  const c = M.compileEngineProtocol(syndrome(), SHOCKED, null);
  assert.deepEqual(c.notes, ["Do not delay for imaging.", "Resuscitate en route."]);
  // None of the note text may have leaked into a band.
  const allBandText = c.bands.flatMap((b) => b.items.map((i) => i.text)).join(" | ");
  assert.ok(!/Resuscitate en route/.test(allBandText));
});

test("engine projection: DO NOW carries only the engine's own emergency assertion, nothing inferred", () => {
  const calm = M.compileEngineProtocol(syndrome(), NOSEL, null);
  assert.equal(calm.bands.find((b) => b.band === "do_now").items.length, 0);
  const hot = M.compileEngineProtocol(syndrome(), SHOCKED, null);
  const now = hot.bands.find((b) => b.band === "do_now").items;
  assert.equal(now.length, 1);
  assert.ok(/Catastrophe/.test(now[0].text));
  assert.equal(now[0].timeCritical, true);
});

test("engine projection: INVESTIGATE is empty unless an authored overlay supplies it", () => {
  const bare = M.compileEngineProtocol(syndrome(), NOSEL, null);
  assert.equal(bare.bands.find((b) => b.band === "investigate").items.length, 0);
  const withOverlay = M.compileEngineProtocol(syndrome(), NOSEL, {
    sources: [src()], investigate: [{ text: "Erect CXR" }]
  });
  const inv = withOverlay.bands.find((b) => b.band === "investigate").items;
  assert.equal(inv.length, 1);
  assert.equal(inv[0].evidence.org, "WSES", "the overlay's single source resolves implicitly");
});

test("engine projection: the antibiotic block and its reference string survive unaltered", () => {
  const c = M.compileEngineProtocol(syndrome(), SHOCKED, null);
  const res = c.bands.find((b) => b.band === "resuscitate").items[0];
  assert.equal(res.abx.firstLine[0].drug, "Pip-tazo");
  assert.equal(res.evidence.org, "ICMR AMRSN 2024");
});

test("engine projection: selection state round-trips onto the findings and danger signs", () => {
  const c = M.compileEngineProtocol(syndrome(), SHOCKED, null);
  const rf = c.bands.find((b) => b.band === "red_flags").items[0];
  const as = c.bands.find((b) => b.band === "assess").items;
  assert.equal(rf.active, true);
  assert.equal(rf.selectable, true);
  assert.equal(as.length, 2);
  assert.equal(as[0].active, false);
});

test("engine projection: the ladder and emergency flag are the engine's, not re-derived", () => {
  assert.equal(M.compileEngineProtocol(syndrome(), SHOCKED, null).ladder, 5);
  assert.equal(M.compileEngineProtocol(syndrome(), SHOCKED, null).emergency, true);
  assert.equal(M.compileEngineProtocol(syndrome(), NOSEL, null).ladder, 0);
  assert.equal(M.compileEngineProtocol(syndrome(), NOSEL, null).emergency, false);
});

test("engine projection: an assess() that throws degrades to empty bands rather than crashing", () => {
  const broken = { id: "b", name: "B", q: [], danger: [], assess: () => { throw new Error("boom"); } };
  const c = M.compileEngineProtocol(broken, NOSEL, null);
  assert.equal(c.bands.length, 7);
  assert.equal(c.bands.filter((b) => b.items.length).length, 0);
});

test("engine projection: a shared condition keeps Internal Medicine primary and says so", () => {
  const s = syndrome();
  s.shared = { primary: "Internal Medicine", role: "Surgery consult" };
  const c = M.compileEngineProtocol(s, NOSEL, null);
  const esc = c.bands.find((b) => b.band === "escalate").items;
  assert.ok(esc.some((i) => /Internal Medicine.*PRIMARY/.test(i.text)));
});

/* ── procedure compiler ───────────────────────────────────────────────────── */

test("procedure: steps compile in authored order and roll structures at risk upward", () => {
  const steps = {
    "step.a": step({ id: "step.a", title: "A", structuresAtRisk: ["Ureter"], critical: true }),
    "step.b": step({ id: "step.b", title: "B" })
  };
  const pr = procedure({ steps: [{ ref: "step.a" }, { ref: "step.b" }] });
  const c = M.compileProcedure(pr, steps);
  const chap = (id) => c.chapters.find((x) => x.id === id);
  assert.deepEqual(chap("steps").steps.map((s) => s.title), ["A", "B"]);
  assert.equal(chap("structuresAtRisk").lines[0].text, "Ureter");
  assert.equal(chap("criticalSafety").lines.length, 1);
});

test("procedure: an unreviewed step is DROPPED and COUNTED, never silently omitted", () => {
  const steps = { "step.a": step({ id: "step.a" }), "step.b": step({ id: "step.b", review: { status: "ai_drafted" } }) };
  const c = M.compileProcedure(procedure({ steps: [{ ref: "step.a" }, { ref: "step.b" }] }), steps);
  assert.equal(c.chapters.find((x) => x.id === "steps").steps.length, 1);
  assert.equal(c.pendingSteps, 1, "the UI must be able to say how much is hidden");
});

test("procedure: chapter order is fixed by the model, not by the content", () => {
  const c = M.compileProcedure(procedure({ chapters: { postop: ["Later"], indications: ["First"] } }), { "step.x": step() });
  assert.deepEqual(c.chapters.map((x) => x.id), M.CHAPTER_IDS);
});

test("reuse report: a procedure authoring more than it reuses is visible as a number", () => {
  const r = M.reuseReport(
    [{ id: "p", steps: [{ ref: "step.core.a" }, { ref: "step.core.b" }, { ref: "step.local" }] }],
    ["step.core.a", "step.core.b"]
  );
  assert.equal(r[0].total, 3);
  assert.equal(r[0].reused, 2);
  assert.equal(r[0].authored, 1);
  assert.ok(r[0].ratio > 0.6);
});

/* ── cases ────────────────────────────────────────────────────────────────── */

test("case: level filters decision points and controls scaffolding", () => {
  const k = kase();
  k.decisionPoints[0].hint = "A hint";
  k.decisionPoints.push({ id: "d2", phase: "operate", prompt: "Surgeon only", levels: ["surgeon"], why: "x", options: [{ id: "a", text: "1", correct: true }, { id: "b", text: "2" }] });
  const student = M.compileCase(k, "student");
  const surgeon = M.compileCase(k, "surgeon");
  assert.equal(student.decisionPoints.length, 1);
  assert.equal(surgeon.decisionPoints.length, 2);
  assert.equal(student.decisionPoints[0].hint, "A hint", "a student gets the scaffolding");
  assert.equal(surgeon.decisionPoints[0].hint, "", "a surgeon does not");
});

test("case scoring is NOT a single percentage: safety misses are reported separately", () => {
  const k = kase();
  k.decisionPoints[0].missedRedFlags = ["Torsion"];
  const c = M.compileCase(k, "resident");
  const wrong = M.scoreCase(c, { d1: "b" });
  assert.equal(wrong.correct, 0);
  assert.equal(wrong.safetyMisses, 1);
  assert.deepEqual(wrong.redFlagsMissed, ["Torsion"]);
  assert.equal(wrong.verdict, "unsafe-reasoning");
  const right = M.scoreCase(c, { d1: "a" });
  assert.equal(right.verdict, "good");
  assert.equal(M.scoreCase(c, {}).verdict, "incomplete");
});

/* ── notes: completeness ──────────────────────────────────────────────────── */

const NOTE_SCHEMA = [{
  title: "S", fields: [
    { k: "a", label: "A", required: true, aiFillable: true },
    { k: "b", label: "B", required: true, aiFillable: false },
    { k: "c", label: "C", required: false, aiFillable: true }
  ]
}];

test("completeness: a required field that is empty is MISSING and blocks finalise", () => {
  const r = M.noteCompleteness(NOTE_SCHEMA, { a: "x" }, { a: "clinician" });
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].k, "b");
  assert.equal(r.canFinalize, false);
});

test("completeness: a filled but unconfirmed required field also blocks finalise", () => {
  const r = M.noteCompleteness(NOTE_SCHEMA, { a: "x", b: "y" }, { a: "ai", b: "clinician" });
  assert.equal(r.missing.length, 0);
  assert.equal(r.unconfirmed.length, 1);
  assert.equal(r.unconfirmed[0].k, "a");
  assert.equal(r.canFinalize, false, "a dictated field that reads correctly is still not signed");
});

test("completeness: only clinician provenance unlocks finalise", () => {
  assert.equal(M.noteCompleteness(NOTE_SCHEMA, { a: "x", b: "y" }, { a: "voice", b: "clinician" }).canFinalize, false);
  assert.equal(M.noteCompleteness(NOTE_SCHEMA, { a: "x", b: "y" }, { a: "clinician", b: "clinician" }).canFinalize, true);
});

test("completeness: whitespace is not a value", () => {
  const r = M.noteCompleteness(NOTE_SCHEMA, { a: "   ", b: "y" }, { a: "clinician", b: "clinician" });
  assert.equal(r.missing.length, 1);
  assert.equal(r.canFinalize, false);
});

/* ── notes: rendering ─────────────────────────────────────────────────────── */

test("rendered note: a draft is stamped DRAFT and missing required fields are PRINTED", () => {
  const t = M.renderNoteText(NOTE_SCHEMA, { a: "Something" }, { a: "clinician" }, { title: "Op note" });
  assert.ok(/DRAFT - NOT VERIFIED/.test(t));
  assert.ok(/B: \[NOT RECORDED\]/.test(t), "omitting a missing required field would be the UI lying");
});

test("rendered note: an unconfirmed field is flagged inline until finalised", () => {
  const draft = M.renderNoteText(NOTE_SCHEMA, { a: "x", b: "y" }, { a: "ai", b: "clinician" }, { title: "T" });
  assert.ok(/\[unverified: ai\]/.test(draft));
  const finalised = M.renderNoteText(NOTE_SCHEMA, { a: "x", b: "y" }, { a: "clinician", b: "clinician" },
    { title: "T", finalized: true, finalizedBy: "clinician", finalizedAt: "2026-08-24" });
  assert.ok(!/unverified/.test(finalised));
  assert.ok(/Finalised by: clinician/.test(finalised));
});

test("rendered note: an optional empty field is simply absent", () => {
  const t = M.renderNoteText(NOTE_SCHEMA, { a: "x", b: "y" }, {}, { title: "T" });
  assert.ok(!/^C:/m.test(t));
});
