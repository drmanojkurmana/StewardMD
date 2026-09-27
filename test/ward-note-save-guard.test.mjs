/* test/ward-note-save-guard.test.mjs — UI-01 and UI-02 from the frontend audit (audit-E.md E1/E2).
 *
 * Same load() pattern as test/ward-ui.test.mjs (a real ward.js run through `new Function`, no bundler),
 * extended with a stubbed global.fetch since these two bugs live in saveNote()'s network callback, not
 * in pure render. Reproduces the exact failure the audit found before asserting the fix:
 *
 *   UI-01: a saveNote() answer that arrives after the nurse opened a different patient's chart must not
 *          paint a false "Saved" banner on that other chart, and must not wipe text that patient has
 *          since typed into the same-shaped note fields.
 *   UI-02: a double-tap on "Save note" must send one request, not two, and the button must disable
 *          while a save is in flight.
 *
 * node --test test/ward-note-save-guard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");

function makeDoc() {
  const els = new Map();
  return {
    getElementById: (id) => els.get(id) || null,
    createElement: () => ({ classList: { add() {}, remove() {} } }),
    body: { appendChild() {} },
    querySelector: () => null,
    _set: (id, value) => { const el = { value: value || "" }; els.set(id, el); return el; },
  };
}
function load(doc) {
  const win = {};
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.WARD;
}

const TPL = {
  id: "ward-round", name: "Ward round note", noteType: "progress",
  sections: [{ key: "impression", title: "Impression" }, { key: "plan", title: "Plan" }],
};
const patient = (id) => ({ encounterId: "enc-" + id, patientId: "pat-" + id, ward: "Ward A", bed: "1", admittedAt: "2026-09-01T00:00:00.000Z" });
// authHeaders() -> fbToken() -> fetchRetry() -> fetch() is a few microtask hops deep; a macrotask tick
// lets all of them run before the test pokes at what fetch() was called with.
const tick = () => new Promise((r) => setTimeout(r, 0));

test("UI-01: a note save answering after the nurse switched patient paints nothing and wipes no one's typed text", async () => {
  const doc = makeDoc();
  const planBox = doc._set("wNote_plan", "unsaved text for patient B");
  const W = load(doc);
  const patA = patient("a"), patB = patient("b");
  Object.assign(W._st, { view: "chart", orgId: "org-1", templates: [TPL], noteTemplateId: "ward-round", sel: patA });

  let resolveFetch;
  global.fetch = () => new Promise((res) => { resolveFetch = res; });
  try {
    W._dispatch("note");
    assert.equal(W._st.noteSaving, true, "the save is marked in progress");
    await tick();
    assert.equal(typeof resolveFetch, "function", "the POST was actually sent");

    // The nurse backs out of A and opens B while A's save is still in flight (nothing blocks that).
    W._st.sel = patB;

    resolveFetch({ json: async () => ({ ok: true, written: 1 }) });
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(W._st.noteResult, null, "no false 'Saved' banner is painted on B's chart");
    assert.equal(planBox.value, "unsaved text for patient B", "B's typed note text survives A's save completing");
    assert.equal(W._st.noteSaving, false, "the busy flag still clears once the stale answer arrives");
  } finally { delete global.fetch; }
});

test("UI-02: double-tapping Save note sends one request, and the button disables while saving", async () => {
  const doc = makeDoc();
  const W = load(doc);
  Object.assign(W._st, { view: "chart", orgId: "org-1", templates: [TPL], noteTemplateId: "ward-round", sel: patient("c") });

  let noteSaves = 0, resolveFetch;
  // loadCosigns() fires a GET after a successful save; only /ward/note POSTs are the thing under test.
  global.fetch = (url) => {
    if (String(url).indexOf("/ward/note") >= 0) { noteSaves++; return new Promise((res) => { resolveFetch = res; }); }
    return Promise.resolve({ json: async () => ({ ok: true }) });
  };
  try {
    W._dispatch("note");
    W._dispatch("note"); // the double-tap, before the first request even leaves
    await tick();
    assert.equal(noteSaves, 1, "the second tap while the first is still in flight sends nothing");
    assert.match(W._render(W._st), /data-w-act="note" disabled/, "the button disables while a save is in progress");

    resolveFetch({ json: async () => ({ ok: true, written: 1 }) });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(W._st.noteSaving, false);
    assert.doesNotMatch(W._render(W._st), /data-w-act="note" disabled/, "pressable again once the save answers");
    assert.equal(noteSaves, 1, "still one note POST total");
  } finally { delete global.fetch; }
});
