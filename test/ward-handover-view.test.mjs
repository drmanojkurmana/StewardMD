/* The shift-handover screen, rendered for real. The module behind it was complete and had no
 * caller; these assertions are about the screen not undoing its guarantees. */
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

const ROSTER = [{ patientId: "p1", name: "Ramesh Kumar", encounterId: "e1" }];
const WAITING = {
  handoverId: "h1", patientId: "p1", encounterId: "e1", state: "waiting",
  sections: { situation: "Breathless on 2L.", background: "Admitted with pneumonia.", assessment: "Improving.", recommendation: "Wean the oxygen." },
  sbarStated: 4, givenBy: "nurse.a@x.test", givenAt: "2026-09-13T07:00:00.000Z",
};
const view = (W, d, extra) => W._render({ ...W._st, view: "handover", list: ROSTER, handovers: d, ...extra });

test("a waiting handover shows the patient by name, who gave it, and all four parts", () => {
  const W = loadWard();
  const html = view(W, { ok: true, handovers: [WAITING], waiting: 1 });
  assert.ok(html.includes("Ramesh Kumar"), "the patient should be named, not shown as an id");
  assert.ok(html.includes("nurse.a@x.test"));
  assert.ok(html.includes("Breathless on 2L."));
  assert.ok(html.includes("Wean the oxygen."));
  assert.match(html, /waiting to be taken/);
  assert.ok(html.includes('data-w-act="handovertake:h1"'));
});

test("a handover with parts left blank says how many, rather than looking complete", () => {
  const W = loadWard();
  const html = view(W, { ok: true, waiting: 1, handovers: [{ ...WAITING, sections: { situation: "Breathless." }, sbarStated: 1 }] });
  assert.match(html, /3 of the four parts were left blank/);
});

test("a handover already taken shows who took it and offers nothing to do", () => {
  const W = loadWard();
  const html = view(W, { ok: true, waiting: 0, handovers: [{ ...WAITING, state: "received", receivedBy: "nurse.b@x.test", receivedAt: "2026-09-13T07:30:00.000Z" }] });
  assert.ok(html.includes("nurse.b@x.test"));
  assert.match(html, /taken/);
  assert.ok(!html.includes('data-w-act="handovertake:h1"'), "nothing to take twice");
});

test("the incoming shift's list is the default, with a count", () => {
  const W = loadWard();
  const html = view(W, { ok: true, handovers: [WAITING], waiting: 1 });
  assert.match(html, /class="w-tl-f on" data-w-act="handovershow:waiting"/);
  assert.ok(html.includes("<i>1</i>"), "the waiting count should be on the filter");
});

test("giving a handover asks for all four parts and says blanks are recorded as blank", () => {
  const W = loadWard();
  const html = view(W, { ok: true, handovers: [], waiting: 0 }, { sel: ROSTER[0] });
  for (const f of ["wHo_situation", "wHo_background", "wHo_assessment", "wHo_recommendation"]) {
    assert.ok(html.includes('id="' + f + '"'), "missing " + f);
  }
  assert.match(html, /recorded as not stated/);
  assert.match(html, /Nothing is filled in from the chart on your behalf/);
  assert.ok(html.includes('data-w-act="handovergive"'));
});

test("with no patient open the screen says how to hand one over rather than showing a dead form", () => {
  const W = loadWard();
  const html = view(W, { ok: true, handovers: [], waiting: 0 }, { sel: null });
  assert.match(html, /Open a patient from the ward list/);
  assert.ok(!html.includes('id="wHo_situation"'));
});

test("an empty waiting list says nothing is waiting; a list that has not loaded does not", () => {
  const W = loadWard();
  const empty = view(W, { ok: true, handovers: [], waiting: 0 });
  assert.match(empty, /Nothing waiting to be taken/);

  const unloaded = view(W, null);
  assert.match(unloaded, /Loading/);
  assert.ok(!unloaded.includes("Nothing waiting to be taken"), "an unloaded list must not read as a quiet shift");
});
