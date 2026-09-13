/* The nurse worklist, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}
const v = (W, d) => W._render({ ...W._st, view: "nurseworklist", nurseWorklist: d });

test("loading, failed and an empty ward are different sentences", () => {
  const W = loadWard();
  assert.match(v(W, null), /Loading the ward/);
  assert.match(v(W, { failed: true }), /Do not read this as nothing due/);
  assert.match(v(W, { ok: true, rows: [] }), /No patients on this ward/);
});

test("overdue doses stand out, an unscorable score has no number, and a read failure is on the row", () => {
  const W = loadWard();
  const html = v(W, { ok: true, rows: [
    { patientId: "p1", patient: { name: "Asha", bed: "4", encounterId: "e1" }, overdue: 2, dueSoon: 1, news2: { total: 7, risk: "high", scorable: true }, problems: [] },
    { patientId: "p2", patient: { name: "Ravi", encounterId: "e2" }, overdue: 0, dueSoon: 0, news2: { total: null, risk: null, scorable: false }, problems: [] },
    { patientId: "p3", patient: { name: "Sita" }, overdue: null, dueSoon: null, news2: null, problems: ["medication schedule could not be read"] },
  ] });
  assert.match(html, /2 doses overdue/);
  assert.match(html, /NEWS 7 high/);
  assert.match(html, /Score: not enough observations/);
  assert.ok(!/NEWS 0/.test(html), "never a zero for a score that was not worked out");
  assert.match(html, /medication schedule could not be read/);
  assert.ok(html.includes('data-w-act="open:e1"'));
  assert.match(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"), /go: "ward:nurseworklist"/);
});
