/* Digital twin: forecasts are labelled predictions, too little data shows no number, and a look-back names what it could not read. */
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
const snapshot = { generatedAt: "2026-09-13T10:00:00Z", sections: {}, notBuilt: {} };
const v = (W, twin) => W._render({ ...W._st, view: "twin", twin: { snapshot, loaded: true, ...twin } });

test("forecast: a labelled range, no number without data, and a not-built metric says so", () => {
  const W = loadWard();
  assert.ok(v(W, {}).includes('data-w-act="twinpredict:bed-demand"'));
  const ok = v(W, { forecast: { ok: true, prediction: { label: "PREDICTION - NOT AN OBSERVED FACT", pointEstimate: 12.5, horizonDays: 1, inputWindow: { sampleSize: 9, from: "2026-09-01T00:00:00Z", to: "2026-09-12T00:00:00Z" }, uncertainty: { lowerBound: 10, upperBound: 15 } } } });
  assert.match(ok, /PREDICTION - NOT AN OBSERVED FACT/);
  assert.match(ok, /likely range 10 to 15/);
  const none = v(W, { forecast: { ok: false, error: "insufficient_data" } });
  assert.match(none, /Not enough past days/);
  assert.ok(!/per day expected/.test(none));
  assert.match(v(W, { forecast: { ok: false, error: "not_built", detail: "no blood-inventory data" } }), /not built: no blood-inventory data/);
});

test("look back: incomplete and unreadable are marked, and a refusal names the right it needs", () => {
  const W = loadWard();
  const html = v(W, { asOf: { ok: true, reconstruction: { at: "2026-09-10T08:00:00Z", notReconstructed: ["Encounter"], state: {
    EmergencyActivation: { status: "ok", count: 1 }, Blackout: { status: "unavailable" }, CriticalResultLoop: { status: "partial", count: 3, unreadable: 2 } } } } });
  assert.match(html, /Scheduling blocks<\/b><span><span class="w-st overdue">could not be read/);
  assert.match(html, /incomplete: 2 unreadable/);
  assert.match(v(W, { asOf: { ok: false, status: 403, error: "forbidden" } }), /needs hospital admin rights/);
});
