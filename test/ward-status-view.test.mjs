/* Ward status: an unread count is blank on the server and "not readable" on the screen, never 0. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { summariseWard, blankUnreadable } from "../functions/_wardsynq/ward-metrics.js";

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

test("server: unread types become null counts and the total is null", () => {
  const m = blankUnreadable(summariseWard({ encounters: [], criticalLoops: [], administrations: [] }), ["CriticalResultLoop", "ShiftHandover"]);
  assert.equal(m.open.criticalResults, null);
  assert.equal(m.open.handoversWaiting, null);
  assert.equal(m.open.dosesInFlight, 0, "a type that was read keeps its real zero");
  assert.equal(m.openItems, null);
  const all = blankUnreadable(summariseWard({}), ["Encounter"]);
  assert.equal(all.patients, null);
  assert.ok(Object.values(all.open).every((v) => v === null));
});

test("screen: loading, failed, partial and full are different", () => {
  const W = loadWard();
  const v = (wm) => W._render({ ...W._st, view: "list", loaded: true, patients: [], wardMetrics: wm });
  assert.match(v({ busy: true }), /Loading ward status/);
  assert.match(v({ ok: false }), /Do not read this as nothing open/);
  const partial = v({ ok: true, partial: true, unreadable: ["ShiftHandover"], metrics: { openItems: null, patients: 2, occupiedBeds: 2, unplaced: 0, open: { criticalResults: 1, handoversWaiting: null } } });
  assert.match(partial, /Handovers not received<\/b><span><span class="w-st overdue">not readable/);
  assert.match(partial, /Those counts are left blank/);
  assert.match(v({ ok: true, metrics: { openItems: 3, patients: 2, occupiedBeds: 2, unplaced: 0, open: { criticalResults: 1 } } }), /<b>3<\/b> open items/);
});
