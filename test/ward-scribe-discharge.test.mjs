/* Item 16: MaiK Scribe wired into the WardSynQ discharge summary (discharge.js, #dEdit). OFF by
 * default (smd_discharge_scribe). Same shape as ward-scribe-append.test.mjs for the ward round
 * note -- one section's free text instead of one field, Accept-then-Save unchanged either way. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../discharge.js", import.meta.url), "utf8");

function load(opts) {
  opts = opts || {};
  const box = { value: "", focus() {}, setSelectionRange() {} };
  const toasts = [];
  const win = { SMD_AMBIENT: opts.ambient, SMD_AI: opts.ai };
  win.toast = (m) => toasts.push(m);
  const root = { classList: { add() {}, remove() {}, contains: () => true }, innerHTML: "", querySelector: () => null };
  const doc = {
    getElementById: (id) => (id === "dEdit" ? box : id === "smdDischarge" ? root : null),
    createElement: () => ({ classList: { add() {}, remove() {} }, appendChild() {} }),
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {} },
  };
  const store = opts.store || {};
  new Function("window", "document", "location", "localStorage", SRC)(
    win, doc, { search: "" }, { getItem: (k) => store[k] || null, setItem: () => {} }
  );
  return { W: win.DISCHARGE, box, toasts };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("smd_discharge_scribe is OFF unless a device explicitly turns it on", () => {
  const { W } = load();
  assert.equal(W._scribeOn(), false);
  const on = load({ store: { smd_discharge_scribe: "on" } });
  assert.equal(on.W._scribeOn(), true);
  const other = load({ store: { smd_discharge_scribe: "true" } });
  assert.equal(other.W._scribeOn(), false, "only the literal 'on' enables it");
});

test("_scribeAppend only appends, never replaces the clinician's own words", () => {
  const { W } = load();
  assert.equal(W._scribeAppend("", "Wound clean, no discharge."), "Wound clean, no discharge.");
  assert.equal(
    W._scribeAppend("Afebrile, tolerating diet.", "Wound clean, no discharge."),
    "Afebrile, tolerating diet.\nWound clean, no discharge."
  );
  assert.equal(W._scribeAppend("Afebrile.", "Afebrile."), "Afebrile.", "no duplicate of an already-present line");
  assert.equal(W._scribeAppend("Afebrile.", ""), "Afebrile.", "an empty draft is a no-op");
});

test("starting the scribe outside an open section does nothing (nowhere for a draft to land)", () => {
  const { W } = load({ ambient: {} });
  W._st.editing = "";
  W._startScribe();
  assert.equal(W._st.scribeOn, false);
});

test("starting the scribe with no SMD_AMBIENT on the build says so and does not turn it on", () => {
  const { W, toasts } = load({ ambient: undefined });
  W._st.editing = "assessment";
  W._startScribe();
  assert.equal(W._st.scribeOn, false);
  assert.match(toasts.join(" "), /not available/);
});

test("refine uses the SAME server extract opd-emr.js uses (kind opd-scribe) for the section draft", async () => {
  const calls = [];
  const ai = { extract: (transcript, kind) => { calls.push({ transcript, kind }); return Promise.resolve({ en: "Wound clean, dry, no discharge. Drain removed day 2." }); } };
  const { W } = load({ ai });
  W._scribeRefine("wound ekkada clean unna discharge ledu");
  await tick();
  assert.equal(calls[0].kind, "opd-scribe");
  assert.equal(W._st.scribeDraft, "Wound clean, dry, no discharge. Drain removed day 2.");
});

test("refine falls back to the raw transcript when there is no extractor or it fails", async () => {
  const a = load({ ai: undefined });
  a.W._scribeRefine("raw words");
  await tick();
  assert.equal(a.W._st.scribeDraft, "raw words");

  const b = load({ ai: { extract: () => Promise.reject(new Error("down")) } });
  b.W._scribeRefine("raw words 2");
  await tick();
  assert.equal(b.W._st.scribeDraft, "raw words 2");
});

test("accepting the draft lands it in the open section's edit box -- Save section is still separate", () => {
  const { W, box } = load();
  W._st.editing = "plan";
  box.value = "Review in surgical OPD in 2 weeks.";
  W._st.scribeDraft = "Suture removal on day 10 at the local PHC.";
  W._scribeInsert();
  assert.equal(box.value, "Review in surgical OPD in 2 weeks.\nSuture removal on day 10 at the local PHC.");
  assert.equal(W._st.scribeDraft, "", "the draft is consumed, not left to be added twice");
});

test("accepting with no section open does nothing", () => {
  const { W, box } = load();
  W._st.editing = "";
  box.value = "";
  W._st.scribeDraft = "Some draft text.";
  W._scribeInsert();
  assert.equal(box.value, "");
  assert.equal(W._st.scribeDraft, "Some draft text.", "an unreachable draft is left alone, not silently dropped");
});
