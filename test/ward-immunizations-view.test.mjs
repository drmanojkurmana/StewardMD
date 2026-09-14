/* test/ward-immunizations-view.test.mjs - G6: renders the immunizations screen for real, and pins that a
 * failed load never reads as "none recorded".
 *
 * node --test test/ward-immunizations-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function loadWard() {
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
  vm.createContext(sandbox); vm.runInContext(SRC, sandbox);
  return sandbox.window.WARD;
}

const SEL = { patientId: "p1", encounterId: "e1", name: "Asha", mrn: "MR1", admittedAt: "2026-09-10T08:00:00.000Z" };
const view = (W, immunizations) => W._render({ ...W._st, view: "immunizations", sel: SEL, immunizations });

test("the chart reaches the screen, and the screen calls the real routes", () => {
  assert.match(SRC, /data-w-act="immunizations"[^\n]*Immunizations<\/button>/);
  assert.ok(SRC.includes('apiGet("/ward/immunizations?orgId="'));
  assert.ok(SRC.includes('apiPost("/ward/immunization", {'));
  assert.ok(SRC.includes('apiPost("/ward/immunization-error", {'));
});

test("loading, failed and none recorded are three different sentences", () => {
  const W = loadWard();
  assert.match(view(W, null), /Loading immunizations/);
  const failed = view(W, false);
  assert.match(failed, /Could not load immunizations\. This is not the same as none recorded/);
  assert.ok(!/No immunizations recorded/.test(failed));
  const empty = view(W, { ok: true, immunizations: [] });
  assert.match(empty, /No immunizations recorded in this record/);
});

test("a given dose, a refused one and a withdrawn one each read as what they are", () => {
  const W = loadWard();
  const html = view(W, { ok: true, immunizations: [
    { immunizationId: "i1", vaccine: "Hepatitis B (adult)", vaccineCode: "43", vaccineCodeSystem: "cvx", status: "completed", occurredOn: "2026-09-10", doseNumber: 2, lotNumber: "HB-2291", site: "left deltoid", primarySource: true, performerId: "cfa:n", recordedBy: "cfa:n", recordedAt: "2026-09-10T09:00:00.000Z" },
    { immunizationId: "i2", vaccine: "MMR", status: "not-done", statusReason: "parent declined", occurredOn: "2026-09-09", primarySource: true, recordedBy: "cfa:n", recordedAt: "2026-09-09T09:00:00.000Z" },
    { immunizationId: "i3", vaccine: "Tetanus", status: "entered-in-error", occurredOn: "2026-09-01", primarySource: false, recordedBy: "cfa:n", recordedAt: "2026-09-01T09:00:00.000Z", errorBy: "cfa:d", errorAt: "2026-09-02T09:00:00.000Z", errorReason: "wrong patient" },
  ] });
  assert.ok(html.includes("Hepatitis B (adult)") && html.includes("dose 2") && html.includes("lot HB-2291"));
  assert.match(html, /not given<\/span>/);
  assert.ok(html.includes("Reason: parent declined"));
  assert.ok(html.includes("w-gone") && html.includes("wrong patient"), "a withdrawn entry stays, marked");
  assert.ok(html.includes("reported, not given here"));
  assert.ok(html.includes('data-w-act="immerror:i1"'));
  assert.ok(!html.includes('data-w-act="immerror:i3"'), "a withdrawn entry cannot be withdrawn again");
  assert.ok(!/<select id="wImVac"/.test(html), "the vaccine is typed, never picked from an invented catalogue");
  assert.ok(!/[—]/.test(html), "no em dash");
});
