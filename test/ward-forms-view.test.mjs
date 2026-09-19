/* Hospital forms on the ward chart, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function loadWard() {
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(SRC, sb);
  return sb.window.WARD;
}
const FORM = { key: "falls", title: "Falls", version: 1, sections: [{ title: "Risk", fields: [
  { key: "fell_before", label: "Fallen before", type: "boolean", required: true },
  { key: "falls_count", label: "How many falls", type: "integer", showWhen: { field: "fell_before", op: "eq", value: true } },
  { key: "bmi", label: "BMI", type: "calculated", calc: { op: "bmi", fields: ["w", "h"] } },
] }] };
const view = (W, extra) => W._render({ ...W._st, view: "forms", sel: { patientId: "p1" }, formDefs: { ok: true, published: [FORM] }, formResponses: { ok: true, responses: [] }, ...extra });

test("loading, failed and none are different sentences", () => {
  const W = loadWard();
  assert.match(W._render({ ...W._st, view: "forms", sel: { patientId: "p1" }, formDefs: null }), /Loading this hospital's forms/);
  assert.match(W._render({ ...W._st, view: "forms", sel: { patientId: "p1" }, formDefs: { failed: true } }), /Could not load the hospital's forms/);
  assert.match(view(W, { formResponses: { failed: true } }), /Do not read this as none/);
  assert.match(W._render({ ...W._st, view: "forms", sel: { patientId: "p1" }, formDefs: { ok: true, published: [] }, formResponses: { ok: true, responses: [] } }), /not published any forms yet/);
});

test("a follow-up question appears once the answer it depends on is given, and a change redraws the form", () => {
  const W = loadWard();
  assert.ok(!view(W, { formSel: FORM, formAnswers: {} }).includes('data-w-formfield="falls_count"'));
  assert.ok(view(W, { formSel: FORM, formAnswers: { fell_before: true } }).includes('data-w-formfield="falls_count"'));
  assert.match(view(W, { formSel: FORM, formAnswers: {} }), /Worked out when saved/, "a calculated field is never typed in");
  assert.match(view(W, { formSel: FORM, formAnswers: { fell_before: true }, formResult: { ok: false, errors: { falls_count: "How many falls is required" } } }), /How many falls is required/);
  assert.match(SRC, /el\.addEventListener\("change", onFormChange\)/);
});
