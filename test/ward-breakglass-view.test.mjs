/* Emergency access (break-glass), rendered for real. */
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
const view = (W, d, extra) => W._render({ ...W._st, view: "breakglass", breakGlass: d, ...extra });

test("the declaration states every limit plainly before anyone breaks glass", () => {
  const W = loadWard();
  const html = view(W, { ok: true, grants: [], active: 0 }, { sel: SEL });
  assert.match(html, /Read only/);
  assert.match(html, /This patient only/);
  assert.match(html, /ends on its own and cannot be extended/);
  assert.match(html, /recorded and reviewed/);
  assert.ok(html.includes('id="wBgReason"'), "a free-text reason, not a menu");
  assert.ok(!/<select[^>]*wBgReason/.test(html), "the reason must never be a dropdown");
});

test("the review log shows who, why, how often the chart was read, and whether anybody was told", () => {
  const W = loadWard();
  const html = view(W, { ok: true, active: 1, grants: [{
    grantId: "g1", patientId: "p1", actorId: "dr.locum@x.test", role: "doctor",
    reason: "Unresponsive in ED, no access to history", grantedAt: "2026-09-13T10:00:00.000Z",
    expiresAt: "2026-09-13T11:00:00.000Z", reads: 4, active: true, notification: null,
  }] });
  assert.ok(html.includes("dr.locum@x.test"));
  assert.ok(html.includes("Unresponsive in ED"));
  assert.match(html, /chart read 4 times/);
  assert.match(html, /nobody was notified automatically/, "silence must be visible on the review surface");
  assert.match(html, /1 emergency access grant is active now/);
});

test("a notified declaration says who was told", () => {
  const W = loadWard();
  const html = view(W, { ok: true, active: 0, grants: [{
    grantId: "g2", patientId: "p1", actorId: "dr.a", reason: "Arrest", grantedAt: "2026-09-13T10:00:00.000Z",
    expiresAt: "2026-09-13T11:00:00.000Z", reads: 1, active: false, notification: { sent: true, to: "privacy officer" },
  }] });
  assert.match(html, /notified: privacy officer/);
  assert.match(html, /expired/);
});

test("with no patient open, nobody can break glass from here", () => {
  const W = loadWard();
  const html = view(W, { ok: true, grants: [], active: 0 }, { sel: null });
  assert.ok(!html.includes('data-w-act="breakglassdeclare"'));
  assert.match(html, /Open a patient from the ward list/);
});

test("an unloaded log says loading, never 'no emergency access declared'", () => {
  const W = loadWard();
  const html = view(W, null, { sel: null });
  assert.match(html, /Loading/);
  assert.ok(!html.includes("No emergency access has been declared"));
});
