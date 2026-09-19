/* Wristbands, rendered for real. The assertion that matters most: a mismatch is a loud STOP. */
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

const SEL = { patientId: "p1", name: "Ramesh Kumar" };
const ACTIVE = { id: "t1", tagType: "wristband", code: "WB-001", status: "active", assignedAt: "2026-09-13T08:00:00.000Z", assignedBy: "nurse.a" };
const view = (W, extra) => W._render({ ...W._st, view: "tags", sel: SEL, tags: { ok: true, tags: [ACTIVE], active: [ACTIVE] }, ...extra });

test("A MISMATCHED BAND IS A LOUD STOP, naming the patient and saying do not give anything", () => {
  const W = loadWard();
  const html = view(W, { tagVerify: { matches: false, reason: "scanned code does not match the active tag on record" } });
  assert.match(html, /STOP - this band does not match Ramesh Kumar/);
  assert.match(html, /Do not give anything to this patient/);
  assert.ok(html.includes("w-dead"), "the mismatch must be in the stop colour");
});

test("a matching band says so plainly", () => {
  const W = loadWard();
  const html = view(W, { tagVerify: { matches: true } });
  assert.match(html, /This band belongs to Ramesh Kumar/);
  assert.ok(!html.includes("STOP"));
});

test("with no check done yet, no verdict of either kind is shown", () => {
  const W = loadWard();
  const html = view(W, { tagVerify: null });
  assert.ok(!html.includes("STOP"));
  assert.ok(!html.includes("This band belongs to"));
});

test("an ended band stays in the history with who ended it and why", () => {
  const W = loadWard();
  const lost = { id: "t0", tagType: "wristband", code: "WB-000", status: "lost", assignedAt: "2026-09-12T08:00:00.000Z",
    endedAt: "2026-09-13T07:00:00.000Z", endedBy: "nurse.b", endedReason: "Cut off for surgery" };
  const html = view(W, { tags: { ok: true, tags: [lost, ACTIVE], active: [ACTIVE] } });
  assert.ok(html.includes("WB-000"), "an ended band must never vanish");
  assert.ok(html.includes("Cut off for surgery"));
  assert.ok(html.includes("nurse.b"));
});

test("a patient with no active band is warned", () => {
  const W = loadWard();
  const html = view(W, { tags: { ok: true, tags: [], active: [] } });
  assert.match(html, /no active band/);
});

test("an unloaded band list says loading, never 'no band issued'", () => {
  const W = loadWard();
  const html = view(W, { tags: null });
  assert.match(html, /Loading/);
  assert.ok(!html.includes("No band has ever been issued"));
});
