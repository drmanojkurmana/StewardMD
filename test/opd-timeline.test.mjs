/* test/opd-timeline.test.mjs — patient Profile "Timeline": merges the encounter timeline (this visit's
 * recorded actions) with the patient's existing GHIS history (labs, imaging, meds), newest first.
 * node --test test/opd-timeline.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function load() { const win = {}; const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } }; new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} }); return win.OPDEMR; }
const NOW = Date.now();
const base = {
  patient: { name: "A", mrn: "1" }, tab: "profile", loading: false, ticketId: "T1", sessionId: "S1", radiology: [],
  labs: [{ serviceName: "Complete blood count", orderDate: "01-Aug-2026", status: "Reported" }],
  medications: [{ drugText: "Paracetamol 650mg", frequency: "TID", dateTime: "02-Aug-2026 10:00" }],
  timeline: [{ ts: NOW - 120000, kind: "assessment", by: "Dr Asha", text: "Initial assessment saved" }]
};

test("timeline MERGES this-visit actions + existing GHIS labs/meds", () => {
  const h = load()._render(base);
  assert.match(h, /Timeline/);
  assert.match(h, /Initial assessment saved/);         // encounter entry
  assert.match(h, /Lab: Complete blood count/);        // existing lab
  assert.match(h, /Paracetamol 650mg TID/);            // existing med
});

test("populated even with NO recorded actions (uses GHIS history) — the reported empty-timeline case", () => {
  const h = load()._render(Object.assign({}, base, { timeline: [], sessionId: "S1" }));
  assert.match(h, /Timeline/);
  assert.match(h, /Lab: Complete blood count/);        // was empty before; now shows history
});

test("never throws on messy/partial GHIS shapes (null fields, object dosage, missing dates)", () => {
  const messy = Object.assign({}, base, {
    labs: [{ status: "Reported" }, { serviceName: null, orderDate: null }, {}],
    radiology: [{ description: null }, {}],
    medications: [{ drug: "X", dosage: { value: 5, unit: "mg" }, dateTime: null }, {}, { drugText: null }],
    timeline: [{ ts: null, kind: null, text: null, by: null }],
  });
  const h = load()._render(messy);           // must not throw — a throw here aborts paint() and freezes the tab
  assert.match(h, /Timeline/);
});

test("genuinely-empty (no data, no ticket) -> hidden; has ticket -> placeholder", () => {
  const empty = { patient: { name: "A", mrn: "1" }, tab: "profile", loading: false, labs: [], radiology: [], medications: [] };
  assert.ok(!/Timeline/.test(load()._render(empty)), "no data + no ticket -> hidden");
  assert.match(load()._render(Object.assign({}, empty, { ticketId: "T1", sessionId: "S1" })), /No entries yet/);
});
