/* Record detail: an earlier version offers "who saw this version", and a failed lookup never reads as nobody. */
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
const detail = (extra) => ({ ok: true, resourceType: "Observation", recordId: "obs-1", versionCount: 2, record: { patientId: "p1", value: { value: 40, unit: "mL" } },
  versions: [{ version: 1, recordedAt: "2026-09-07T06:00:00Z", stood: true }, { version: 2, recordedAt: "2026-09-07T08:00:00Z", current: true }], ...extra });
const v = (W, d) => W._render({ ...W._st, view: "timeline", timeline: [], sel: { patientId: "p1", name: "Asha" }, recordDetail: d });

test("only superseded versions offer the lookup, and each answer state is distinct", () => {
  const W = loadWard();
  const html = v(W, detail());
  assert.ok(html.includes('data-w-act="readers:1"'));
  assert.ok(!html.includes('data-w-act="readers:2"'), "the current version has nobody to warn");
  assert.match(v(W, detail({ readers: { 1: { busy: true } } })), /Looking up who saw this version/);
  assert.match(v(W, detail({ readers: { 1: { ok: false } } })), /Do not read this as nobody/);
  const found = v(W, detail({ readers: { 1: { ok: true, people: [{ person: "doctor@x", kind: "opened", readAt: "2026-09-07T06:30:00Z", actedOn: true }], note: "Telling them is a human act" } } }));
  assert.match(found, /doctor@x/);
  assert.match(found, /acted on it/);
  assert.match(v(W, detail({ readLogFailed: true })), /could not be logged/);
});
