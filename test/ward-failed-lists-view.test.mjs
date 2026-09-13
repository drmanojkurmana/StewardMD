/* Lists a clinician acts on: loading, failed and genuinely empty are different sentences. */
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

test("SAFETY: the critical results board never says none open while loading or after a failed load", () => {
  const W = loadWard();
  const v = (critsBoard) => W._render({ ...W._st, view: "critsboard", critsBoard });
  assert.match(v(null), /Loading open critical results/);
  const failed = v(false);
  assert.match(failed, /Do not read this as none open/);
  assert.ok(!/No open critical results anywhere/.test(failed));
  assert.match(v([]), /No open critical results anywhere right now/);
});

test("an escalated critical result says plainly whether anybody was notified", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "critsboard", critsBoard: [{ loopId: "c1", patientId: "p1", display: "Potassium", value: 7.1, state: "open", escalation: { level: "escalate", minutesOpen: 240 },
    escalations: [{ level: "overdue", at: "2026-09-13T10:30:00Z", minutesOpen: 30, notification: { delivered: false, reason: "NO_CHANNEL" } }, { level: "escalate", at: "2026-09-13T12:00:00Z", minutesOpen: 120, notification: { delivered: true } }] }] });
  assert.match(html, /nobody was notified<\/b> \(no notification channel is set up\)/);
  assert.match(html, /notification delivered/);
});

test("billing: a failed invoice or claim read is not 'none raised'", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "billing", sel: { patientId: "p1" }, billing: { invoices: null, claims: [] } });
  assert.match(html, /Invoices could not be loaded/);
  assert.ok(!/No invoice has been raised/.test(html));
  assert.match(html, /No claim has been coded/);
});
