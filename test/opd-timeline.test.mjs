/* test/opd-timeline.test.mjs — patient Profile "Visit timeline" (reads the encounter timeline).
 * node --test test/opd-timeline.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function load() { const win = {}; const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } }; new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} }); return win.OPDEMR; }
const NOW = Date.now();
const withTL = { patient: { name: "A", mrn: "1" }, tab: "profile", loading: false, ticketId: "T1", sessionId: "S1", labs: [], radiology: [], medications: [], timeline: [
  { ts: NOW - 120000, kind: "assessment", by: "Dr Asha", text: "Initial assessment saved" },
  { ts: NOW - 300000, kind: "investigation", by: "Dr Asha", text: "Investigation ordered: Complete blood count" },
  { ts: NOW - 600000, kind: "medication", text: "Paracetamol 650mg TID x5d" } ] };

test("timeline section renders the encounter events (newest first) with relative time", () => {
  const h = load()._render(withTL);
  assert.match(h, /Visit timeline/);
  assert.match(h, /Initial assessment saved/);
  assert.match(h, /Complete blood count/);
  assert.match(h, /Paracetamol/);
  assert.match(h, /ago|just now/);
  // newest (assessment, 2m) should appear before the oldest (medication, 10m)
  assert.ok(h.indexOf("Initial assessment saved") < h.indexOf("Paracetamol 650"), "sorted newest first");
});
test("no timeline for a non-queue (standalone) encounter", () => {
  assert.ok(!/Visit timeline/.test(load()._render(Object.assign({}, withTL, { ticketId: "", sessionId: "" }))));
});
test("empty timeline shows a helpful placeholder, not a blank", () => {
  const h = load()._render(Object.assign({}, withTL, { timeline: [] }));
  assert.match(h, /Visit timeline/);
  assert.match(h, /documenting the visit/i);
});
