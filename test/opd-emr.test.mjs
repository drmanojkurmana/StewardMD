// test/opd-emr.test.mjs — OPD EMR read-only profile view (window.OPDEMR._render), P1.
// Loads the browser IIFE with stubbed globals and exercises the PURE _render (no DOM/network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");

function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  const loc = { search: "" };
  const ls = { getItem: () => null, setItem: () => {} };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, loc, ls);
  return win.OPDEMR;
}

const NO_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const mock = {
  patient: { name: "Asha Rao", mrn: "MR10234" },
  phone: "9876543210",
  labs: [{ serviceName: "Complete Blood Count", orderDate: "01-Aug-2026", department: "Haematology", status: "Reported", renderId: "R1", episodeId: "E1" }],
  radiology: [{ resultid: "RAD9", date: "02-Aug-2026", description: "Chest X-Ray PA", printType: "automated" }],
  medications: [{ drugText: "Amoxicillin 500mg", route: "Oral", dosage: "500mg", frequency: "TID", duration: "5 days", dateTime: "01-Aug-2026 10:00" }]
};

test("_render shows patient header, reports (labs+radiology) and current meds", () => {
  const html = load()._render(mock);
  assert.match(html, /Asha Rao/);
  assert.match(html, /MR10234/);
  assert.match(html, /9876543210/);
  assert.match(html, /Reports/);
  assert.match(html, /Complete Blood Count/);
  assert.match(html, /Chest X-Ray PA/);
  assert.match(html, /Current medications/);
  assert.match(html, /Amoxicillin 500mg/);
  assert.match(html, /oe-logo-mark/);                 // StewardMD logo header markup present
  assert.match(html, /material-symbols-outlined/);    // icons, not emoji
  assert.ok(!NO_EMOJI.test(html), "render must contain no emoji");
});

test("_render tappable report rows carry detail ids (lab render/episode, radiology resultid/type)", () => {
  const html = load()._render(mock);
  assert.match(html, /data-oe-act="lab:R1:E1"/);
  assert.match(html, /data-oe-act="rad:RAD9:automated"/);
});

test("_render loading / error / empty states", () => {
  const OE = load();
  assert.match(OE._render({ loading: true }), /Loading patient profile/);
  assert.match(OE._render({ error: "Could not load" }), /Could not load/);
  const empty = OE._render({ patient: { name: "X", mrn: "1" }, labs: [], radiology: [], medications: [] });
  assert.match(empty, /No labs or imaging on record/);
  assert.match(empty, /No current medications on record/);
});

test("_render escapes patient/report text (no HTML injection)", () => {
  const html = load()._render({ patient: { name: "<script>x</script>", mrn: "1" }, labs: [], radiology: [], medications: [] });
  assert.ok(!/<script>x<\/script>/.test(html));
  assert.match(html, /&lt;script&gt;/);
});
