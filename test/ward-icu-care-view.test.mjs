/* The ICU chart cards (P1.12), rendered for real from ward.js: loading, failed and empty are
 * different sentences; a score or dose that was not worked out is never shown as 0; a sparkline
 * breaks at an hour nobody charted. */
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
const SEL = { class: "ICU", patientId: "p1", encounterId: "e1", name: "Asha", ward: "ICU", bed: "3" };
const chart = (W, extra) => W._render({ ...W._st, view: "chart", sel: SEL, ...extra });

const CELL = (v) => (v == null ? { empty: true, value: null } : { empty: false, value: v });
const GRID = { hours: ["h1", "h2", "h3", "h4"], rows: [
  { code: "8867-4", label: "Heart rate", cells: [CELL(90), CELL(null), CELL(110), CELL(112)] },
  { code: "8480-6", label: "Systolic", cells: [CELL(120), CELL(118), CELL(null), CELL(96)] },
  { code: "8462-4", label: "Diastolic", cells: [CELL(70), CELL(68), CELL(null), CELL(55)] },
] };

const ICU = {
  ok: true, advisory: "Advisory only. This supports a clinician's judgement; it has not started, ordered or paged anything.",
  abg: { current: { sampleType: "venous", at: "2026-09-13T08:00:00Z", ph: 7.3, pco2: null, po2: 40, hco3: 20, baseExcess: null, lactate: 3.1, fio2: 0.4,
    interpretation: { interpretable: false, reason: "Not interpretable: pCO2 not recorded.", pf: null, pfReason: "P/F ratio needs an arterial sample; a venous pO2 is not a PaO2." } }, history: [] },
  ventilator: { current: { mode: "PSV", peep: 6, fio2: 0.35, at: "2026-09-13T07:00:00Z" }, history: [{ mode: "PSV", peep: 6, fio2: 0.35, at: "2026-09-13T07:00:00Z" }, { mode: "VC-AC", tidalVolumeMl: 450, at: "2026-09-13T05:00:00Z" }] },
  sedation: { current: { rass: -3, targetLow: -2, targetHigh: 0, at: "2026-09-13T07:30:00Z" }, status: { onTarget: false, say: "RASS -3, target -2 to 0: deeper than target." }, history: [] },
  rounds: { latest: { at: "2026-09-13T07:45:00Z", by: "cfa:n", assessed: 1, of: 10, items: [{ key: "feeding", label: "Feeding", answer: "yes" }, { key: "bowels", label: "Bowels", answer: "not-assessed" }] }, history: [] },
  roundItems: [{ key: "feeding", label: "Feeding" }, { key: "bowels", label: "Bowels" }],
  vasopressors: [{ drug: "Noradrenaline", running: true, dose: { value: null, reason: "The bag's concentration has not been recorded. It is never assumed." } }],
  sofa: { total: 4, partial: true, say: "Partial SOFA 4 from 2 of 6 systems. Not scored: Bilirubin, Cardiovascular, Nervous system (GCS), Renal (creatinine). The real total may be higher.",
    components: [{ key: "resp", label: "Respiration", score: 2, from: "P/F 140" }, { key: "liver", label: "Bilirubin", score: null, reason: "No bilirubin result." }] },
  sepsis: { result: "screen-positive", say: "Screen positive: 1 qSOFA criterion with lactate 3.1 mmol/L (above 2). Assess for sepsis. This is a prompt, not a diagnosis." },
};

test("ICU cards: loading, failed and an empty record are different sentences", () => {
  const W = loadWard();
  const loading = chart(W, { icu: null });
  assert.match(loading, /Loading the ICU record/);
  const failed = chart(W, { icu: false });
  assert.match(failed, /The ICU record could not be loaded. Do not read this as no blood gas on record/);
  assert.match(failed, /Do not read this as no vasopressor on record/);
  const empty = chart(W, { icu: { ok: true, abg: { current: null, history: [] }, ventilator: { current: null, history: [] }, sedation: { current: null, history: [] }, rounds: { latest: null }, vasopressors: [], sofa: { total: null, say: "SOFA not scored: nothing on the record to score.", components: [] }, sepsis: { result: "cannot-screen", say: "Cannot screen: missing respiratory rate in the last 4 hours." }, roundItems: [] } });
  assert.match(empty, /No blood gas on record/);
  assert.match(empty, /No ventilator settings on record/);
  assert.match(empty, /No RASS on record/);
  assert.match(empty, /No vasoactive infusion on record/);
  assert.match(empty, /No round checklist recorded/);
  assert.match(empty, /SOFA not scored/);
  assert.match(empty, /Cannot screen: missing respiratory rate/);
  assert.ok(!/<b>0<\/b><span>SOFA/.test(empty), "an unscored SOFA never renders as 0");
  assert.match(chart(W, { flowsheet: null, flowsheetFailed: true, icu: ICU }), /The flowsheet could not be loaded, so no trends can be drawn/);
  assert.match(chart(W, { flowsheet: null, icu: ICU }), /Loading trends/);
});

test("ICU cards: partial SOFA, advisory sepsis prompt with the bundle offered, refused dose reason, RASS vs target, not-assessed round item", () => {
  const W = loadWard();
  const html = chart(W, { icu: ICU, flowsheet: GRID });
  assert.match(html, /Partial SOFA 4 from 2 of 6/);
  assert.match(html, /not scored: No bilirubin result/);
  assert.match(html, /Screen positive: 1 qSOFA criterion with lactate 3.1/);
  assert.match(html, /Code Sepsis bundle can be started from the Resuscitation card. Nothing has been started/);
  assert.ok(html.includes('data-w-act="resusstart"') && html.includes('value="code-sepsis"'), "the Code Sepsis bundle start is offered on an ICU chart");
  assert.match(html, /Advisory only/);
  assert.match(html, /Dose not worked out: The bag&#39;s concentration has not been recorded|Dose not worked out: The bag's concentration has not been recorded/);
  assert.ok(!/0 mcg\/kg\/min/.test(html), "a refused dose is never shown as 0");
  assert.match(html, /Not interpretable: pCO2 not recorded/);
  assert.match(html, /P\/F ratio needs an arterial sample/);
  assert.match(html, /<b>Now:<\/b> PSV/);
  assert.match(html, /deeper than target/);
  assert.match(html, /Bowels<\/b><span>Not assessed/);
  for (const act of ["icuabg", "icuvent", "icused", "icuround", "icuload"]) assert.ok(html.includes(`data-w-act="${act}"`), act);
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  assert.ok(src.includes('"/ward/icu?orgId="') && src.includes('"/ward/icu-record"'), "the screen calls both ICU routes");
});

test("ICU trends: a sparkline breaks at an hour nobody charted rather than joining across it", () => {
  const W = loadWard();
  const html = chart(W, { icu: ICU, flowsheet: GRID });
  const trends = html.slice(html.indexOf("<h3>Trends</h3>"), html.indexOf("<h3>Sepsis screen"));
  const hr = trends.slice(trends.indexOf("Heart rate"), trends.indexOf("Blood pressure"));
  // HR: charted, gap, charted, charted -> one lone point then a two-point line, never one 4-point line.
  assert.equal((hr.match(/<polyline/g) || []).length, 1);
  assert.equal((hr.match(/<circle/g) || []).length, 1);
  const bp = trends.slice(trends.indexOf("Blood pressure"), trends.indexOf("SpO2"));
  assert.equal((bp.match(/<polyline/g) || []).length, 2, "systolic and diastolic each break at the gap: two 2-point lines");
  assert.equal((bp.match(/<circle/g) || []).length, 2);
  assert.match(trends, /SpO2<\/b><span>Nothing charted in this window/);
  assert.match(trends, /A break in a line is an hour nobody charted/);
  assert.ok(!chart(W, { sel: { ...SEL, class: "IPD" }, icu: ICU, flowsheet: GRID }).includes("<h3>Trends</h3>"), "ICU-only cards stay off an ordinary ward chart");
});
