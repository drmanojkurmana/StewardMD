/* Renders the history page for real and checks what only breaks in a browser: the filters, the
 * collapse, the report button, and that a filter actually narrows the list. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sandbox = {
    navigator: { userAgent: "node" },
    location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} },
      querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.WARD;
}

const SEL = { patientId: "p1", encounterId: "e1", name: "Ramesh Kumar", mrn: "MRN-77", admittedAt: "2026-09-10T08:00:00.000Z" };
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();

const EVENTS = [
  { at: iso(1), resourceType: "ClinicalNote", id: "n1", category: "note", who: "dr.mehta",
    label: "dr.mehta wrote a progress note, signed",
    body: [{ heading: "assessment", text: "Community acquired pneumonia, right base." },
           { heading: "plan", text: "Co-amoxiclav 1.2g IV TDS." }] },
  { at: iso(2), resourceType: "ServiceRequest", id: "sr1", category: "investigation",
    label: "dr.mehta ordered CBC (laboratory) — active", reportReady: true, reportId: "dr1", reportStatus: "final" },
  { at: iso(3), resourceType: "ServiceRequest", id: "sr2", category: "investigation",
    label: "dr.mehta ordered Chest X-ray (imaging) — active", reportReady: false },
  { at: iso(200), resourceType: "CriticalResultLoop", id: "crl1", category: "critical", critical: true,
    label: "CRITICAL: Potassium 6.9 mmol/L — nobody has acknowledged this yet" },
  { at: iso(201), resourceType: "Encounter", id: "e1", category: "visit", label: "IPD: admitted — Ward A bed 3" },
];

const base = (W, extra) => ({ ...W._st, view: "timeline", sel: SEL, timeline: EVENTS, ...extra });

test("the history shows who wrote what, and the note's own words", () => {
  const W = loadWard();
  const html = W._render(base(W, { timelineOpen: { n1: 1 } }));
  assert.ok(html.includes("dr.mehta wrote a progress note"));
  assert.ok(html.includes("Community acquired pneumonia, right base."), "the note text is missing");
  assert.ok(html.includes("Co-amoxiclav 1.2g IV TDS."), "the plan is missing");
  assert.ok(html.includes("assessment"), "the heading is missing");
});

test("a note is collapsed by default, showing a real first line rather than nothing", () => {
  const W = loadWard();
  const html = W._render(base(W));
  assert.ok(html.includes("w-tl-peek"), "no collapsed preview");
  assert.ok(html.includes("Community acquired pneumonia"), "the preview should be the real first line");
  // Collapsed, the second section is not rendered.
  assert.ok(!html.includes("Co-amoxiclav 1.2g IV TDS."), "collapsed rows should not show every section");
  assert.ok(html.includes("Read it all"));
});

test("each row carries its category as a colour class and as a word", () => {
  const W = loadWard();
  const html = W._render(base(W));
  assert.ok(html.includes('class="w-tl-note"'));
  assert.ok(html.includes('class="w-tl-investigation"'));
  assert.ok(html.includes("w-tl-critical"));
  // And in words, because the colour groups but the word explains.
  assert.ok(html.includes(">note<"));
  assert.ok(html.includes(">investigation<"));
});

test("an investigation whose report is back offers a button; one still waiting says so", () => {
  const W = loadWard();
  const html = W._render(base(W));
  assert.ok(html.includes('data-w-act="timelinereport:dr1"'), "no report button for the finished test");
  assert.ok(html.includes("Open the report"));
  assert.ok(html.includes("waiting for the report"), "the pending test should say it is waiting");
});

test("filters are offered with counts, and only for kinds that actually have something", () => {
  const W = loadWard();
  const html = W._render(base(W));
  assert.ok(html.includes("Everything"));
  assert.ok(html.includes("Notes"));
  assert.ok(html.includes("Tests ordered"));
  assert.ok(html.includes("Critical events"));
  // Nothing billing-related is on this chart, so that chip is not offered at all.
  assert.ok(!html.includes("Billing"), "an empty filter should not be offered");
});

test("choosing a filter narrows the list and says so in words", () => {
  const W = loadWard();
  const html = W._render(base(W, { timelineFilter: "note" }));
  assert.ok(html.includes("dr.mehta wrote a progress note"));
  assert.ok(!html.includes("ordered CBC"), "the filter did not narrow the list");
  // The reader is told a filter is on, because one they do not notice hides half a chart.
  assert.match(html, /Showing only notes/);
  assert.ok(html.includes("Show everything"));
});

test("the date range narrows the list too, and the two filters combine", () => {
  const W = loadWard();
  const recent = W._render(base(W, { timelineWhen: "24h" }));
  assert.ok(recent.includes("ordered CBC"), "something from an hour ago should be inside 24 hours");
  assert.ok(!recent.includes("CRITICAL: Potassium"), "something from 200 hours ago is outside 24 hours");

  const both = W._render(base(W, { timelineWhen: "24h", timelineFilter: "investigation" }));
  assert.ok(both.includes("ordered CBC"));
  assert.ok(!both.includes("wrote a progress note"), "the type filter should still apply");
});

test("a filter that matches nothing says so rather than looking broken", () => {
  const W = loadWard();
  const html = W._render(base(W, { timelineFilter: "billing" }));
  assert.match(html, /Nothing of that kind on this stay/);
});

test("the glance card on the chart is never filtered", () => {
  const W = loadWard();
  // The chart card renders every event regardless of the filter the history page is using.
  const html = W._render({ ...W._st, view: "chart", sel: SEL, timeline: EVENTS, timelineFilter: "note" });
  assert.ok(html.includes("ordered CBC"), "the chart glance must not inherit the history's filter");
});
