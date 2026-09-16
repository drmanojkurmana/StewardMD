/* test/ward-code-picker-view.test.mjs - the code picker in ward.js, the Code sets and Growth charts cards on Admin > FHIR, and
 * the growth card naming the reference in use.
 *
 * The picker never shows loading, failed, "none loaded" or "no match" as the same thing, offers only the systems that
 * are loaded, and a picked code is sent with its system on a problem, an operation booking and a test order. The Admin
 * card lists what is loaded, and a failed list is not "nothing loaded". Routes: test/wardsynq-code-sets.test.mjs.
 *
 * node --test test/ward-code-picker-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
function loadWard() {
  const calls = [];
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {} },
    localStorage: { getItem: (k) => (k === "smd_opd_staff_tok" ? "tok" : ""), setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (url, opts) => { calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null }); return Promise.resolve({ json: () => Promise.resolve({ ok: false }) }); },
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb); vm.runInContext(read("ward.js"), sb);
  return { W: sb.window.WARD, calls };
}
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·").replace(/&hellip;/g, "...").replace(/\s+/g, " ");
const SEL = { encounterId: "enc-1", patientId: "pat-1", name: "Asha Rao", mrn: "MRN-1", ward: "Medical A", bed: "3", class: "IPD", admittedAt: "2026-09-10T04:00:00.000Z" };
const SETS = [{ system: "snomed", name: "SNOMED CT", loaded: true, count: 3 }, { system: "icd-10", name: "ICD-10", loaded: false, count: 0 }, { system: "loinc", name: "LOINC", loaded: true, count: 2 }];
const chart = (W, extra) => W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, view: "chart", sel: SEL, stayPlan: null, ...extra })));

test("PICKER on the chart: loading, failed, none loaded, results and no match read differently; only loaded systems are offered", () => {
  const { W } = loadWard();
  assert.match(text(chart(W, { codeSets: null })), /Standard code \(optional\) Loading this hospital's code sets\.\.\./);
  assert.match(text(chart(W, { codeSets: false })), /could not be loaded, so no code can be picked now\. Do not read this as none loaded\./);
  assert.match(text(chart(W, { codeSets: SETS.map((s) => ({ ...s, loaded: false })) })), /No SNOMED CT, ICD-10 or LOINC codes are loaded for this hospital\./);
  const open = chart(W, { codeSets: SETS, cp: { prob: { system: "snomed", results: [{ code: "233604007", display: "Pneumonia" }] }, inv: { system: "loinc", results: [] } } });
  assert.ok(open.includes('id="wCp-prob-sys"') && open.includes('<option value="snomed" selected>SNOMED CT</option>') && !open.includes('value="icd-10"'), "ICD-10 is not loaded, so not offered");
  assert.ok(open.includes('data-w-act="cppick:prob|0"'));
  assert.match(text(open), /No code in this hospital's set matches\./);
  assert.match(text(chart(W, { codeSets: SETS, cp: { prob: { system: "snomed", results: false, err: "not_loaded" } } })), /The code search failed\. Do not read this as no match\./);
  const chosen = chart(W, { codeSets: SETS, cp: { prob: { chosen: { system: "snomed", code: "233604007", display: "Pneumonia", name: "SNOMED CT" } } } });
  assert.match(text(chosen), /233604007 Pneumonia SNOMED CT close Remove code/);
});

test("A PICKED CODE is searched through GET /api/queue/ward/code-search and sent with its system on POST /api/queue/ward/problem", async () => {
  const { W, calls } = loadWard();
  Object.assign(W._st, { orgId: "org-1", view: "chart", sel: SEL, codeSets: SETS, cp: { prob: { system: "snomed", results: [{ code: "233604007", display: "Pneumonia" }] } } });
  W._dispatch("cppick:prob|0");
  assert.deepEqual(JSON.parse(JSON.stringify(W._st.cp.prob.chosen)), { system: "snomed", code: "233604007", display: "Pneumonia", name: "SNOMED CT" });
  W._dispatch("problem");
  await new Promise((r) => setTimeout(r, 20));
  const post = calls.find((c) => c.url.endsWith("/ward/problem"));
  assert.deepEqual({ code: post.body.problem.code, codeSystem: post.body.problem.codeSystem, display: post.body.problem.display }, { code: "233604007", codeSystem: "snomed", display: "Pneumonia" });
  W._dispatch("cpclear:prob");
  assert.equal(W._st.cp.prob, null);
  const src = read("ward.js");
  assert.ok(src.includes('"/ward/code-search?orgId="') && src.includes('coding: codeChosen("surg")') && src.includes('coding: codeChosen("inv")'), "operation bookings and test orders send the picked code too");
});

test("ADMIN code sets card on Admin > FHIR: loading, a failed list not read as none, what is loaded, and the licence to confirm", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(read("wardsynq/site/shell.js")); run(read("wardsynq/site/pages/admin.js"));
  const c = { esc: win.WSQ.esc, ms: win.WSQ.ms }, card = win.WSQ._codeSetsHtml;
  assert.match(card(c, null), /class="spin"/);
  assert.match(text(card(c, { ok: false, error: "permission" })), /could not be read\. This is not the same as none loaded\. permission/);
  const html = card(c, { ok: true, systems: [{ system: "snomed", name: "SNOMED CT", loaded: true, count: 3, importedAt: "2026-09-16T04:00:00.000Z", fileName: "sct.csv" }, { system: "loinc", name: "LOINC", loaded: false, count: 0 }] });
  assert.match(text(html), /SNOMED CT 3 2026-09-16T04:00:00\.000Z · sct\.csv LOINC not loaded/);
  assert.ok(html.includes('id="admCodeFile" type="file"') && html.includes('id="admCodeLicence" type="checkbox"'));
  assert.match(text(html), /SNOMED CT affiliate licence \(in India, through NRCeS\)/);
  assert.match(text(card(c, { ok: true, systems: [] }, { ok: false, html: "Nothing was loaded: bad" })), /Nothing was loaded: bad/);
  assert.ok(read("wardsynq/site/pages/admin.js").includes('c.api("/ward/code-set-import", {'), "the card posts to the real import route");
});

test("ADMIN growth charts card on Admin > FHIR: loading, a failed read not taken as CDC in use, CDC 2000 or the hospital's tables in use, the licence to confirm", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(read("wardsynq/site/shell.js")); run(read("wardsynq/site/pages/admin.js"));
  const c = { esc: win.WSQ.esc, ms: win.WSQ.ms }, card = win.WSQ._growthTablesHtml;
  assert.match(card(c, null), /class="spin"/);
  assert.match(text(card(c, { ok: false, error: "permission" })).replace(/&#39;/g, "'"), /could not be read\. Do not read this as the CDC reference in use\. permission/);
  const cdc = text(card(c, { ok: true, inUse: "cdc2000", loaded: null }));
  assert.match(cdc, /In use: CDC 2000 growth reference\./);
  assert.match(cdc.replace(/&#39;/g, "'"), /holds a licence from the publisher of these growth tables/);
  assert.doesNotMatch(card(c, { ok: true, inUse: "cdc2000", loaded: null }), /admGrowthWithdraw/);
  const hosp = card(c, { ok: true, inUse: "hospital", loaded: { referenceName: "WHO Child Growth Standards 2006", count: 25000, importedAt: "2026-09-17T04:00:00.000Z", fileName: "who.csv" } });
  assert.match(text(hosp).replace(/&#39;/g, "'"), /In use: this hospital.s tables, 25000 rows, loaded 2026-09-17T04:00:00\.000Z\. WHO Child Growth Standards 2006 \(who\.csv\)/);
  assert.ok(hosp.includes('id="admGrowthWithdraw"') && hosp.includes('id="admGrowthFile" type="file"') && hosp.includes('id="admGrowthLicence" type="checkbox"') && hosp.includes('value="who-restricted"'));
  const src = read("wardsynq/site/pages/admin.js");
  assert.ok(src.includes('c.api("/ward/growth-tables" + q)') && src.includes('c.api("/ward/growth-table-import", {'), "the card reads and posts to the real routes");
});

test("WARD growth card names the reference in use: CDC 2000 with CDC's attribution, or the hospital's own tables by their name", () => {
  const { W } = loadWard();
  assert.ok(W && W._growthCard, "ward.js exposes the growth card for this test");
  const line = (c) => ({ centile: c, points: [[0, 3 + c / 50], [30, 4 + c / 50]] });
  const g = (reference) => ({ sex: "male", approxDob: false, gestationDays: null, lines: [3, 10, 25, 50, 75, 90, 97].map(line), notRecorded: [], reference,
    measurements: [{ at: "2026-07-01T06:00:00.000Z", valueKg: 3.5, chronologicalDays: 20, plotDays: 20, corrected: false, result: { ok: true, reference: reference.id, z: 0.1, centile: 54, implausible: false } }] });
  const cdc = W._growthCard({ growth: g({ id: "cdc2000", name: "CDC 2000 growth reference" }) });
  assert.match(cdc, /Growth \(CDC 2000 growth reference\)/);
  assert.match(cdc, /aria-label="Weight for age against the centiles 3, 10, 25, 50, 75, 90, 97 of the CDC 2000 growth reference\./);
  assert.match(cdc, /Source: CDC\..*does not imply endorsement by CDC/);
  assert.doesNotMatch(cdc, /WHO/);
  const hosp = W._growthCard({ growth: g({ id: "hospital", name: "IAP 2015 <licensed>" }) });
  assert.match(hosp, /Growth \(IAP 2015 &lt;licensed&gt;\)/, "the hospital's name is its data, escaped");
  assert.match(hosp, /This hospital's own growth tables, loaded under its licence/);
  assert.doesNotMatch(hosp, /Source: CDC/);
});
