/* Order sets, rendered for real. The assertions that matter: every item is shown with its default
 * choice before anything is ordered, and a set that landed in part says so loudly. */
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
const SET = {
  id: "cap", name: "Pneumonia, admission", version: "3",
  items: [
    { key: "amox", kind: "medication", drug: "Amoxicillin", dose: { value: 1, unit: "g" }, route: "iv", frequency: "TDS" },
    { key: "fluids", kind: "medication", drug: "Saline", dose: { value: 1000, unit: "mL" }, defaultSelected: false },
    { key: "cxr", kind: "investigation", code: "CXR", display: "Chest X-ray" },
  ],
};
const view = (W, extra) => W._render({ ...W._st, view: "ordersets", sel: SEL, orderSets: { ok: true, sets: [SET] }, ...extra });

test("every item in the set is shown with its default choice before anything is ordered", () => {
  const W = loadWard();
  const html = view(W, { orderSetPick: SET });
  assert.match(html, /id="wOsItem_amox" type="checkbox"[^>]*checked/);
  assert.match(html, /id="wOsItem_cxr" type="checkbox"[^>]*checked/);
  // An item the hospital marked not-selected-by-default starts unticked.
  assert.ok(/id="wOsItem_fluids" type="checkbox"[^>]*>/.test(html));
  assert.ok(!/id="wOsItem_fluids" type="checkbox"[^>]*checked/.test(html), "a default-off item must start unticked");
  assert.ok(html.includes("Amoxicillin 1g iv TDS"));
  assert.ok(html.includes("Chest X-ray"));
});

test("the screen says each item is ordered on its own with the ordinary checks", () => {
  const W = loadWard();
  const html = view(W, { orderSetPick: SET });
  assert.match(html, /ordered on its own, with the same checks as any order you write by hand/);
});

test("A SET THAT LANDED IN PART SAYS SO, names what was refused, and says nothing was retried", () => {
  const W = loadWard();
  const html = view(W, { orderSetResult: {
    applied: ["cxr"], deselected: ["fluids"],
    failed: [{ key: "amox", error: "refused", detail: "Allergy: penicillin" }],
  } });
  assert.match(html, /Part of this set was NOT ordered/);
  assert.ok(html.includes("Allergy: penicillin"), "the refusal reason must be shown");
  assert.match(html, /have not been ordered. Nothing was retried/);
  assert.ok(html.includes("Ordered:</b> cxr"));
  assert.ok(html.includes("Left out by you: fluids"));
});

test("a set that landed whole says so, and does not warn", () => {
  const W = loadWard();
  const html = view(W, { orderSetResult: { applied: ["amox", "cxr"], failed: [], deselected: [] } });
  assert.match(html, /Every chosen item was ordered/);
  assert.ok(!html.includes("NOT ordered"));
});

test("a hospital with no sets is told so, rather than shown an empty chooser", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "ordersets", sel: SEL, orderSets: { ok: true, sets: [] } });
  assert.match(html, /has not set up any order sets/);
});

test("the screen asks for a patient rather than rendering a dead form", () => {
  const W = loadWard();
  assert.match(W._render({ ...W._st, view: "ordersets", sel: null }), /Open a patient first/);
});
