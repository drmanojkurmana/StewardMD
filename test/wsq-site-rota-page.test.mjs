/* The Staff rota page's sections: failed never reads as none, gaps are marked, answers only for the person asked. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const sb = { window: { WSQ: { page() {} } } };
vm.createContext(sb); vm.runInContext(read("wardsynq/site/pages/rota.js"), sb);
const R = sb.window.WSQ._rota;
const C = (who) => ({ esc, state: { who } });

test("my shifts: loading, failed and none are different, and a failure never reads as no shifts", () => {
  assert.match(R.mineHtml(C({ name: "n1" }), null), /Loading your shifts/);
  const f = R.mineHtml(C({ name: "n1" }), { ok: false });
  assert.match(f, /Do not read this as none/);
  assert.ok(!f.includes("No shifts"));
  assert.match(R.mineHtml(C({ name: "n1" }), { ok: true, assignments: [], leave: [], swaps: [] }), /No shifts in the next two months/);
});

test("a swap offered to me can be answered; one I offered cannot be answered by me", () => {
  const swaps = [{ id: "s1", date: "2026-09-17", shiftId: "day", from: "n2", to: "n1", status: "proposed" }, { id: "s2", date: "2026-09-18", shiftId: "day", from: "n1", to: "n2", status: "proposed" }];
  const html = R.mineHtml(C({ name: "n1" }), { ok: true, assignments: [], leave: [], swaps });
  assert.ok(html.includes('data-rota="swapyes" data-id="s1"'));
  assert.ok(!html.includes('data-id="s2">Accept'));
});

test("coverage marks short shifts, and a failed or partial coverage never reads as fully staffed", () => {
  const html = R.coverageHtml(C({}), { ok: true, partial: false, coverage: [{ date: "2026-09-14", shift: "Day", unit: "Ward A", staff: ["n1"], gaps: [{ role: "nurse", short: 1 }] }, { date: "2026-09-14", shift: "Night", unit: "Ward A", staff: [], gaps: [] }] });
  assert.match(html, /<tr class="warn"><td>2026-09-14<\/td><td>Day/);
  assert.match(html, /1 nurse/);
  assert.match(html, /nobody/);
  assert.match(R.coverageHtml(C({}), { ok: false, message: "ask for at most two months at a time" }), /Do not read this as fully staffed/);
  assert.match(R.coverageHtml(C({}), { ok: true, partial: true, coverage: [] }), /gaps may be understated/);
});

test("approvals: a swap still waiting for the colleague cannot be approved yet", () => {
  const html = R.pendingHtml(C({}), { ok: true, leave: [] }, { ok: true, swaps: [{ id: "s1", date: "d", from: "a", to: "b", status: "proposed" }, { id: "s2", date: "d", from: "a", to: "c", status: "accepted" }] });
  assert.ok(!html.includes('data-rota="swapok" data-id="s1"'));
  assert.ok(html.includes('data-rota="swapok" data-id="s2"'));
  assert.match(R.pendingHtml(C({}), { ok: false }, null), /Could not load leave requests/);
  assert.match(read("wardsynq/site/shell.js"), /item\("rota", "Staff rota"\)/);
});
