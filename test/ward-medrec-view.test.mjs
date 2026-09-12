/* Medicines reconciliation, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  return sandbox.window.WARD;
}

const SEL = { patientId: "p1", encounterId: "e1", name: "Ramesh Kumar" };
const view = (W, d) => W._render({ ...W._st, view: "medrec", sel: SEL, medRec: d });

const REC = (extra) => ({
  ok: true, encounterId: "e1", undecided: 1,
  reconciliations: [{
    reconciliationId: "r1", stage: "admission", source: "the patient",
    medicines: [
      { key: "metformin", drug: "Metformin 500mg twice a day", decision: "undecided" },
      { key: "amlodipine", drug: "Amlodipine 5mg", decision: "continued" },
    ],
    counts: { undecided: 1, continued: 1 }, undecided: 1, complete: false, empty: false,
  }],
  ...extra,
});

test("each medicine is listed as the patient said it, with its decision", () => {
  const W = loadWard();
  const html = view(W, REC());
  assert.ok(html.includes("Metformin 500mg twice a day"));
  assert.ok(html.includes("Amlodipine 5mg"));
  assert.match(html, /not decided/);
  assert.ok(html.includes("continued"));
});

test("an undecided medicine offers the decisions; a decided one does not", () => {
  const W = loadWard();
  const html = view(W, REC());
  assert.ok(html.includes('data-w-act="medrecdecide:admission~metformin~stopped"'));
  assert.ok(!html.includes("amlodipine~stopped"), "a medicine already decided needs no buttons");
});

test("COMPLETENESS IS COUNTED, never shown as a tick somebody pressed", () => {
  const W = loadWard();
  const open = view(W, REC());
  assert.match(open, /1 medicine still undecided/);

  const done = view(W, { ok: true, encounterId: "e1", undecided: 0, reconciliations: [{
    stage: "admission", medicines: [{ key: "a", drug: "A", decision: "continued" }],
    counts: { undecided: 0 }, undecided: 0, complete: true, empty: false,
  }] });
  assert.match(done, /Every medicine has a decision/);
});

test("the form says the words are recorded as spoken and nothing is corrected", () => {
  const W = loadWard();
  const html = view(W, REC());
  assert.match(html, /as the patient says them/);
  assert.match(html, /nothing is filled in from the chart/i);
  assert.ok(html.includes('id="wMrMeds"'));
  assert.ok(html.includes('id="wMrSource"'));
});

test("both stages are offered, because discharge reconciliation is its own act", () => {
  const W = loadWard();
  const html = view(W, REC());
  assert.ok(html.includes('value="admission"'));
  assert.ok(html.includes('value="discharge"'));
});

test("a stage with no medicines says so rather than looking reconciled", () => {
  const W = loadWard();
  const html = view(W, { ok: true, encounterId: "e1", undecided: 0, reconciliations: [{
    stage: "discharge", medicines: [], counts: {}, undecided: 0, complete: false, empty: true,
  }] });
  assert.match(html, /No medicines recorded/);
  assert.ok(!html.includes("Every medicine has a decision"), "an empty list is not a completed reconciliation");
});

test("a list that has not loaded says loading, not 'none recorded'", () => {
  const W = loadWard();
  const html = view(W, null);
  assert.match(html, /Loading/);
  assert.ok(!html.includes("No medicines history recorded"));
});

test("the screen asks for a patient rather than rendering a dead form", () => {
  const W = loadWard();
  assert.match(W._render({ ...W._st, view: "medrec", sel: null }), /Open a patient first/);
});
