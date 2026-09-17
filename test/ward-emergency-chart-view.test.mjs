/* Opening a chart under an active emergency-access grant. */
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

const G = { grantId: "g1", patientId: "p1", actorId: "dr.a", reason: "Arrest", grantedAt: "2026-09-14T10:00:00.000Z", expiresAt: "2026-09-14T11:00:00.000Z", reads: 0 };

test("an ACTIVE emergency grant can open the chart read-only; an expired one cannot", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "breakglass", breakGlass: { ok: true, active: 1, grants: [{ ...G, active: true }, { ...G, grantId: "g2", patientId: "p2", active: false }] } });
  assert.ok(html.includes('data-w-act="emergencychart:p1"'));
  assert.ok(!html.includes('data-w-act="emergencychart:p2"'), "an expired grant must not open a chart");
});

test("a chart that could not be opened under the grant says why", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "breakglass", breakGlass: { ok: true, active: 0, grants: [] }, emergencyChart: { ok: false, detail: "No active emergency access for this patient." } });
  assert.match(html, /No active emergency access for this patient/);
});

/* R5-1: a failed per-type read used to arrive as [] and render as "none" - "no known allergies",
 * mid-emergency. The screen now names every part it could not read. */
test("a part of the chart that could not be read is NAMED, never rendered as none", () => {
  const W = loadWard();
  const html = W._render({
    ...W._st, view: "breakglass", breakGlass: { ok: true, active: 1, grants: [{ ...G, active: true }] },
    emergencyChart: { ok: true, patientId: "p1", chart: { AllergyIntolerance: null, MedicationOrder: [] }, unreadableTypes: ["AllergyIntolerance"] },
  });
  assert.match(html, /could not be read: AllergyIntolerance/);
  assert.match(html, /Do not read them as nothing recorded/);
});

test("a chart read whole says nothing about unreadable parts", () => {
  const W = loadWard();
  const html = W._render({
    ...W._st, view: "breakglass", breakGlass: { ok: true, active: 1, grants: [{ ...G, active: true }] },
    emergencyChart: { ok: true, patientId: "p1", chart: { AllergyIntolerance: [] }, unreadableTypes: [] },
  });
  assert.ok(!/could not be read/.test(html));
});
