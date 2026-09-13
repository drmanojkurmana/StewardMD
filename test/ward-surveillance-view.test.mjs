/* The surveillance board and the MaiK copilot tasks, rendered for real (pure _render). */
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
const W = loadWard();
const board = (d) => W._render({ ...W._st, view: "surveillance", surveillance: d });
const SIGNAL = {
  id: "news2-rising|2026-09-13T08:00:00.000Z", ruleId: "news2-rising", label: "NEWS2 rising", summary: "NEWS2 1 to 7 (a rise of 6 is significant regardless of the absolute total).",
  source: "trendOf() in wardsynq-deterioration.js", firstSeenAt: "2026-09-13T08:00:00.000Z", active: true,
  evidence: [{ resourceType: "Observation", id: "obs-rr-2", value: 26, unit: "/min", at: "2026-09-13T08:00:00.000Z" }],
  incidentSource: { resourceType: "Observation", id: "obs-rr-2" }, acknowledgements: [],
};
const row = (over) => ({ patientId: "pat-1", encounterId: "enc-1", patient: { name: "Anjali Menon", bed: "12" }, signals: [SIGNAL], notEvaluated: [], ...over });

test("loading, failed and empty are three different sentences", () => {
  const loading = board(null), failed = board({ failed: true }), empty = board({ ok: true, rows: [row({ signals: [] })], notBuilt: [] });
  assert.match(loading, /Checking every patient on the ward/);
  assert.match(failed, /Could not load surveillance\. Do not read this as no signals/);
  assert.match(empty, /No active signals on this ward/);
  assert.ok(!/No active signals/.test(failed) && !/No active signals/.test(loading));
  assert.match(board({ ok: true, rows: [] }), /No patients on this ward, so nothing was checked/);
});

test("a patient whose signals could not be computed is never shown as having none", () => {
  const html = board({ ok: true, rows: [row({ signals: null, failed: "record_read_failed" })] });
  assert.match(html, /Signals could not be computed for this patient/);
  assert.ok(!/No active signals on this ward/.test(html));
});

test("a signal shows its rule, evidence links, acknowledgement state, and the incident signal action", () => {
  const html = board({ ok: true, rows: [row()], notBuilt: [{ ruleId: "readmission-risk", reason: "no prospective definition" }], monitoring: "Nothing has been paged." });
  assert.match(html, /NEWS2 rising/);
  assert.match(html, /trendOf\(\) in wardsynq-deterioration\.js/);
  assert.match(html, /data-w-act="timelinedetail:Observation~obs-rr-2"/);
  assert.match(html, /Not acknowledged/);
  assert.match(html, /data-w-act="survack:0~0"/);
  assert.match(html, /data-w-act="incidentsignal:Observation~obs-rr-2"/);
  assert.match(html, /Not built: readmission-risk/);
  assert.match(html, /Nothing has been paged/);
  const acked = board({ ok: true, rows: [row({ signals: [{ ...SIGNAL, incidentSource: null, acknowledgements: [{ by: "cfa:nurse", at: "2026-09-13T08:10:00.000Z", note: "Doctor informed" }] }] })] });
  assert.match(acked, /Acknowledged by cfa:nurse/);
  assert.ok(!/incidentsignal:/.test(acked), "no incident action without a source the incident route accepts");
});

const base = { ...W._st, view: "chart", sel: { encounterId: "enc-1", patientId: "pat-1", ward: "Ward A", bed: "12", class: "IPD" } };
const chart = (maik) => W._render({ ...base, maik });

test("the chart offers the eight copilot tasks", () => {
  const html = chart({});
  for (const t of ["admission-summary", "explain-deterioration", "unresolved-issues", "prepare-rounds", "overnight-events", "explain-labs", "medication-risks", "referral-summary"]) {
    assert.match(html, new RegExp(`data-w-act="maikask:${t}"`), t);
  }
});

test("a copilot answer separates facts from the record (as links) from MaiK's reasoning", () => {
  const html = chart({ interaction: {
    id: "wsq-ai-1", patientId: "pat-1", task: "explain-deterioration", output: "The respiratory rate rose.", generated: true,
    model: { model: "ward-model-7b" }, contextProvenance: [{ resourceType: "Observation", id: "obs-rr-2", version: 1 }], contextDocuments: [],
    security: { injectionFindings: [] }, uncertainty: null, review: { state: "pending" }, preview: null, resultingChanges: [],
    facts: { signals: [SIGNAL], abnormalLabs: [{ resourceType: "Observation", id: "cr3", value: 240, unit: "umol/L" }], notEvaluated: [{ ruleId: "obs-overdue", reason: "no frequency" }] },
  } });
  const facts = html.indexOf("Facts from the record"), reasoning = html.indexOf("MaiK&#39;s reasoning") >= 0 ? html.indexOf("MaiK&#39;s reasoning") : html.indexOf("MaiK's reasoning");
  assert.ok(facts >= 0 && reasoning > facts, "facts first, reasoning after, under separate headings");
  assert.ok(html.indexOf("The respiratory rate rose.") > reasoning);
  assert.match(html, /data-w-act="timelinedetail:Observation~obs-rr-2"/);
  assert.match(html, /data-w-act="timelinedetail:Observation~cr3"/);
  assert.match(html, /Not evaluated: obs-overdue/);
  const unavailable = chart({ interaction: { id: "x", output: "y", contextProvenance: [], review: { state: "pending" }, facts: { unavailable: "record_read_failed" } } });
  assert.match(unavailable, /computed findings could not be produced/);
});

test("model unavailable says no answer was produced, and shows no answer", () => {
  const html = chart({ err: "This hospital has approved no model provider." });
  assert.match(html, /No answer was produced\. This hospital has approved no model provider\./);
  assert.ok(!/w-maik-out/.test(html));
});

test("the new screens carry no em dash", () => {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const a = src.indexOf("function evidenceLinks"), b = src.indexOf("function nurseWorklistView");
  assert.ok(a > 0 && b > a);
  assert.ok(!/—/.test(src.slice(a, b)));
  const s = readFileSync(fileURLToPath(new URL("../functions/_wardsynq/surveillance.js", import.meta.url)), "utf8");
  assert.ok(!/—/.test(s));
  assert.match(readFileSync(fileURLToPath(new URL("../wardsynq/site/shell.js", import.meta.url)), "utf8"), /go: "ward:surveillance"/);
});
