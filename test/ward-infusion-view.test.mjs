/* Infusions and the care plan, rendered for real. The assertion that matters: an estimated volume
 * always carries its caveat, and a drip nobody has charted is loud rather than quietly finished. */
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
const view = (W, d) => W._render({ ...W._st, view: "infusions", sel: SEL, infusions: d });

test("A STALE DRIP IS LOUD - counted at the top and warned on its row", () => {
  const W = loadWard();
  const html = view(W, { ok: true, running: 1, stale: 1, infusions: [{
    orderId: "o1", drug: "Saline", running: true, startedAt: "2026-09-13T02:00:00.000Z", lastChartedAt: "2026-09-13T02:00:00.000Z",
    volume: { ml: 800, lastRatePerHour: 100, stale: true, staleDetail: "No rate has been charted for 8 hours. Check the pump before relying on this volume.",
      assumption: "This total assumes the pump has run at 100 mL/h for the 8 hours since it was last charted." },
  }] });
  assert.match(html, /1 running infusion has not been charted for hours/);
  assert.match(html, /Check the pump before relying on this volume/);
});

test("EVERY ESTIMATED VOLUME CARRIES ITS CAVEAT", () => {
  const W = loadWard();
  const html = view(W, { ok: true, running: 1, stale: 0, infusions: [{
    orderId: "o1", drug: "Saline", running: true, startedAt: "2026-09-13T10:00:00.000Z", lastChartedAt: "2026-09-13T11:00:00.000Z",
    volume: { ml: 100, lastRatePerHour: 100, assumption: "This total assumes the pump has run at 100 mL/h for the 1 hours since it was last charted." },
  }] });
  assert.match(html, /about 100 mL so far/);
  assert.match(html, /assumes the pump has run/);
});

test("an uncharted infusion still reads as running, never as finished", () => {
  const W = loadWard();
  const html = view(W, { ok: true, running: 1, stale: 1, infusions: [{
    orderId: "o1", drug: "Heparin", running: true, startedAt: "2026-09-13T02:00:00.000Z", lastChartedAt: "2026-09-13T02:00:00.000Z",
    volume: { ml: 400, lastRatePerHour: 50, stale: true, staleDetail: "No rate has been charted for 8 hours." },
  }] });
  assert.match(html, />running</);
  assert.ok(!html.includes(">not running<"));
});

test("an unloaded list says loading, never 'none charted'", () => {
  const W = loadWard();
  const html = view(W, null);
  assert.match(html, /Loading/);
  assert.ok(!html.includes("No infusions charted"));
});

test("the care plan asks for a review date, because a goal with no date is never revisited", () => {
  const W = loadWard();
  const html = view(W, { ok: true, infusions: [], running: 0, stale: 0 });
  assert.ok(html.includes('id="wCpTitle"'));
  assert.ok(html.includes('id="wCpGoals"'));
  assert.ok(html.includes('id="wCpReview" type="date"'));
  assert.match(html, /A goal with no review date is a goal nobody comes back to/);
});
