// test/connect-agent/deep-crawl.test.mjs — unit tests for connect-agent/phone/deep-crawl.mjs:
// buildTableView (pure selector/redaction logic) and deepCrawlClinical (worklist -> patient -> views)
// against a fake six-method client that simulates a GHIS-style worklist/patient/medications/labs flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildTableView, buildBlockView, deepCrawlClinical, redactEndpoints, mergeEndpointDetails, hintFromHeaders } from '../../connect-agent/phone/deep-crawl.mjs';
import { inferHtmlOperations } from '../../connect-agent/manifest/infer-html.mjs';
import { extractRecords, isValidSelector } from '../../connect-agent/manifest/html.mjs';

// --- buildTableView -------------------------------------------------------------------------------

test('buildTableView: null raw -> singleRecord detail view', () => {
  const view = buildTableView(null, 'patient', '/patient/42');
  assert.deepEqual(view, { resourceHint: 'patient', pathTemplate: '/patient/42', method: 'GET', singleRecord: true });
});

test('buildTableView: id table -> #id selector, high confidence, no confidence field on output', () => {
  const raw = { id: 'data_tables1', class: 'table table-bordered', headers: ['Date', 'Drug', 'Dose'], rows: [{ isHeader: false, onclick: null }] };
  const view = buildTableView(raw, 'medications', '/view/4');
  assert.equal(view.rowsSelector, '#data_tables1 tbody tr');
  assert.equal(view.confidence, undefined);
  assert.deepEqual(view.headers, ['Date', 'Drug', 'Dose']);
  assert.equal(view.singleRecord, false);
});

test('buildTableView: no id, distinctive class -> table.<class> selector, medium confidence (not surfaced)', () => {
  const raw = { id: '', class: 'table lab-grid', headers: ['Test'], rows: [{ isHeader: false, onclick: null }] };
  const view = buildTableView(raw, 'labs', '/view/42');
  assert.equal(view.rowsSelector, 'table.lab-grid tbody tr');
  assert.equal(view.confidence, undefined);
});

test('buildTableView: no id/distinctive class -> generic fallback selector, low confidence flagged', () => {
  const raw = { id: '', class: 'table table-striped', headers: ['Test'], rows: [{ isHeader: false, onclick: null }] };
  const view = buildTableView(raw, 'labs', '/view/42');
  assert.equal(view.rowsSelector, 'table tbody tr');
  assert.equal(view.confidence, 'low');
});

test('buildTableView: onclick shape is redacted, no literal argument survives', () => {
  const raw = {
    id: 'data_tables1', class: '', headers: ['Name'],
    rows: [{ isHeader: false, onclick: "searchPatient('SECRETNAME','12345','ward-3')" }],
  };
  const view = buildTableView(raw, 'worklist', '/worklist');
  assert.equal(view.onclickTemplate, "searchPatient(#,#,#)");
  assert.ok(!JSON.stringify(view).includes('SECRETNAME'));
});

test('buildTableView: no data rows (header-only or empty table) -> singleRecord true', () => {
  const raw = { id: 'x', class: '', headers: ['A'], rows: [{ isHeader: true, onclick: null }] };
  const view = buildTableView(raw, 'history', '/history');
  assert.equal(view.singleRecord, true);
});

// --- deepCrawlClinical -----------------------------------------------------------------------------

const SENTINEL = 'SECRETNAME';

// Simulated pages, each exposing the raw facts the real CRAWL_RAW_TABLE/CRAWL_FIND_* functions would
// extract from the live DOM. The fake never emits SENTINEL through evaluate() results — mirroring how
// the real page-realm functions never read <td> text — but SENTINEL lives in the "onclick" args below
// (as a real EMR would embed a patient identifier in a row's onclick handler), so the test proves the
// module redacts it out rather than merely not being given it.
function makePages() {
  return {
    worklist: {
      rawTable: {
        id: 'data_tables1', class: 'table table-bordered',
        headers: ['MRN', 'Name', 'Ward'],
        rows: [{ isHeader: true, onclick: null }, { isHeader: false, onclick: `openPatient('${SENTINEL}','48213')` }],
      },
      patientRow: { index: 5 },
      controls: [],
    },
    patient: {
      rawTable: null, // demographics/label-value page
      patientRow: null,
      controls: [
        { index: 2, label: 'Medications' },
        { index: 3, label: 'Lab reports' },
        // 'Home' / 'Logout' never appear: CRAWL_FIND_CONTROLS drops SKIP-list labels in the page realm.
      ],
    },
    medications: {
      rawTable: { id: 'meds_table', class: '', headers: ['Date', 'Drug', 'Dose'], rows: [{ isHeader: false, onclick: null }] },
      patientRow: null,
      controls: [
        { index: 2, label: 'Medications' },
        { index: 3, label: 'Lab reports' },
      ],
    },
    labs: {
      rawTable: { id: 'labs_table', class: '', headers: ['Date', 'Test', 'Result Flag'], rows: [{ isHeader: false, onclick: null }] },
      patientRow: null,
      controls: [
        { index: 2, label: 'Medications' },
        { index: 3, label: 'Lab reports' },
      ],
    },
  };
}

function fakeClient(pages, { onClickControl } = {}) {
  let current = 'worklist';
  return {
    async currentUrl() { return { url: '/' + current }; },
    async wait() {},
    async evaluate({ expression }) {
      const page = pages[current];
      if (expression.includes('function CRAWL_PAGE_STATE')) return { result: JSON.stringify(page.pageState ?? null) };
      if (expression.includes('function CRAWL_RAW_TABLE')) return { result: JSON.stringify(page.rawTable) };
      if (expression.includes('function CRAWL_FIND_PATIENT_ROW')) return { result: JSON.stringify(page.patientRow) };
      if (expression.includes('function CRAWL_CLICK_ROW')) { current = 'patient'; return { result: 'ok' }; }
      if (expression.includes('function CRAWL_FIND_CONTROLS')) return { result: JSON.stringify(page.controls) };
      // This fake models a navigation-style EMR (each sub-view is its own URL): the crawler must come back
      // to the patient hub after capturing a view.
      if (expression === 'history.back()') { current = 'patient'; return { result: null }; }
      if (expression.includes('function CRAWL_CLICK_CONTROL')) {
        const m = /\)\((\d+),/.exec(expression);
        const idx = m ? Number(m[1]) : -1;
        const label = (page.controls.find((c) => c.index === idx) || {}).label;
        if (onClickControl) onClickControl(label);
        if (label === 'Medications') current = 'medications';
        else if (label === 'Lab reports') current = 'labs';
        return { result: 'ok' };
      }
      return { result: 'null' };
    },
  };
}

test('deepCrawlClinical: captures worklist, opens patient, then medications and labs', async () => {
  const pages = makePages();
  const client = fakeClient(pages);
  const { observedViews, trail, stopReason } = await deepCrawlClinical({ client, caps: { maxMs: 60000 } });

  assert.equal(observedViews.length, 3); // worklist, medications, labs (the patient hub page itself is a
  // navigation stop, not a clinical sub-view — only step-2 clicked views plus the worklist are captured)
  assert.equal(observedViews[0].resourceHint, 'worklist');
  assert.equal(observedViews[0].rowsSelector, '#data_tables1 tbody tr');
  assert.equal(observedViews[0].onclickTemplate, 'openPatient(#,#)');

  const meds = observedViews.find((v) => v.resourceHint === 'medications');
  const labs = observedViews.find((v) => v.resourceHint === 'labs');
  assert.ok(meds);
  assert.ok(labs);
  assert.deepEqual(meds.headers, ['Date', 'Drug', 'Dose']);
  assert.deepEqual(labs.headers, ['Date', 'Test', 'Result Flag']);

  assert.deepEqual(trail, ['patient-record', 'Medications', 'back', 'Lab reports', 'back']);
  assert.equal(stopReason, 'no-candidate');

  const dump = JSON.stringify(observedViews);
  assert.ok(!dump.includes(SENTINEL));
  assert.ok(!dump.includes('48213'));
});

test('deepCrawlClinical: dedup — a label is captured once even if it keeps reappearing', async () => {
  const pages = makePages();
  const client = fakeClient(pages);
  let clicks = 0;
  const origEvaluate = client.evaluate.bind(client);
  client.evaluate = async (args) => {
    if (args.expression.includes('CRAWL_CLICK_CONTROL')) clicks += 1;
    return origEvaluate(args);
  };
  const { observedViews, trail } = await deepCrawlClinical({ client, caps: { maxMs: 60000 } });
  const medsViews = observedViews.filter((v) => v.resourceHint === 'medications');
  assert.equal(medsViews.length, 1);
  assert.equal(trail.filter((l) => l === 'Medications').length, 1);
  assert.equal(clicks, 2); // Medications, Lab reports — never re-clicked once visited
});

test('deepCrawlClinical: caps stop the crawl (maxViews)', async () => {
  const pages = makePages();
  const client = fakeClient(pages);
  const { observedViews, stopReason } = await deepCrawlClinical({ client, caps: { maxViews: 2, maxMs: 60000 } });
  assert.equal(observedViews.length, 2);
  assert.equal(stopReason, 'max-views');
});

test('deepCrawlClinical: caps stop the crawl (maxMs)', async () => {
  const pages = makePages();
  const client = fakeClient(pages);
  const { stopReason } = await deepCrawlClinical({ client, caps: { maxMs: 0 } });
  assert.equal(stopReason, 'time-cap');
});

test('deepCrawlClinical: no patient row on the worklist stops with no-patient-row', async () => {
  const pages = makePages();
  pages.worklist.patientRow = null;
  const client = fakeClient(pages);
  const { observedViews, trail, stopReason } = await deepCrawlClinical({ client });
  assert.equal(stopReason, 'no-patient-row');
  assert.equal(observedViews.length, 1); // worklist only
  assert.deepEqual(trail, []);
});

// --- deepCrawlClinical: page state gate (fake client) -------------------------------------------------------
// The fake's CRAWL_PAGE_STATE answers are what the page-realm probe reports on a real device; these prove the
// crawler's decisions on them. The probe itself is proven against a real DOM further down.

test('deepCrawlClinical: (A) locked device: no table has layout, but the walk still proceeds and captures', async () => {
  const pages = makePages();
  pages.worklist.pageState = { textLen: 4200, hasPasswordInput: false, dataTableCount: 1, anyVisible: false };
  const { observedViews, trail, stopReason } = await deepCrawlClinical({ client: fakeClient(pages), caps: { maxMs: 60000 } });
  assert.equal(stopReason, 'no-candidate');
  assert.deepEqual(trail, ['patient-record', 'Medications', 'back', 'Lab reports', 'back']);
  assert.equal(observedViews.length, 3);
  assert.ok(observedViews.every((v) => v.resourceHint === 'worklist' || v.rowsSelector));
});

test('deepCrawlClinical: (B) dead shell (tiny text, no data table, no password input) -> session-expired-or-shell, zero views', async () => {
  const pages = makePages();
  pages.worklist.pageState = { textLen: 196, hasPasswordInput: false, dataTableCount: 0, anyVisible: true };
  let clicks = 0, states = 0;
  const client = fakeClient(pages, { onClickControl: () => { clicks += 1; } });
  const orig = client.evaluate.bind(client);
  client.evaluate = async (args) => { if (args.expression.includes('CRAWL_PAGE_STATE')) states += 1; return orig(args); };
  const { observedViews, trail, stopReason } = await deepCrawlClinical({ client, caps: { maxMs: 60000 } });
  assert.equal(stopReason, 'session-expired-or-shell');
  assert.deepEqual(observedViews, []);
  assert.deepEqual(trail, []);
  assert.equal(clicks, 0);
  assert.equal(states, 2); // confirmed once after a wait: a slow worklist may still be loading its rows
});

test('deepCrawlClinical: (B) slow worklist: shell-like on first look, rows arrive by the recheck -> crawl proceeds', async () => {
  const pages = makePages();
  const looks = [{ textLen: 300, hasPasswordInput: false, dataTableCount: 0, anyVisible: true }, { textLen: 3000, hasPasswordInput: false, dataTableCount: 1, anyVisible: true }];
  const client = fakeClient(pages);
  const orig = client.evaluate.bind(client);
  client.evaluate = async (args) => (args.expression.includes('CRAWL_PAGE_STATE') ? { result: JSON.stringify(looks.shift()) } : orig(args));
  const { observedViews, stopReason } = await deepCrawlClinical({ client, caps: { maxMs: 60000 } });
  assert.equal(stopReason, 'no-candidate');
  assert.equal(observedViews.length, 3);
});

test('deepCrawlClinical: (B) login form present -> login-required, nothing clicked', async () => {
  const pages = makePages();
  pages.worklist.pageState = { textLen: 900, hasPasswordInput: true, dataTableCount: 0, anyVisible: true };
  const { observedViews, trail, stopReason } = await deepCrawlClinical({ client: fakeClient(pages), caps: { maxMs: 60000 } });
  assert.equal(stopReason, 'login-required');
  assert.deepEqual(observedViews, []);
  assert.deepEqual(trail, []);
});

test('deepCrawlClinical: unknown page state (probe failed) does not block the walk', async () => {
  const pages = makePages();
  pages.worklist.pageState = null;
  const { observedViews } = await deepCrawlClinical({ client: fakeClient(pages), caps: { maxMs: 60000 } });
  assert.equal(observedViews.length, 3);
});

// --- buildTableView: container-anchored selectors -----------------------------------------------------

test('buildTableView: headerless table without id -> container id + class + nth-of-type anchor', () => {
  const raw = {
    id: '', class: 'tbl-bordered', headers: ['Prod. Code', 'Drug Name'], rows: [{ isHeader: false, onclick: null }],
    container: { id: 'panel-meds', class: 'panel-body' }, tableNth: 2,
  };
  const view = buildTableView(raw, 'medications', '/view/4');
  assert.equal(view.rowsSelector, '#panel-meds table.tbl-bordered:nth-of-type(2) tbody tr');
  assert.ok(isValidSelector(view.rowsSelector));
  assert.equal(view.confidence, undefined);
});

test('buildTableView: generic-only classes but a distinctive container class -> .container table anchor', () => {
  const raw = { id: '', class: 'table', headers: ['A', 'B'], rows: [{ isHeader: false, onclick: null }], container: { id: '', class: 'row lab-panel' }, tableNth: 0 };
  const view = buildTableView(raw, 'labs', '/view/42');
  assert.equal(view.rowsSelector, '.lab-panel table tbody tr');
  assert.ok(isValidSelector(view.rowsSelector));
});

test('buildTableView: unsafe id/class characters never reach the selector', () => {
  const raw = { id: 'bad id]', class: 'x:y', headers: ['A'], rows: [{ isHeader: false, onclick: null }], container: { id: 'c(1)', class: '' }, tableNth: 0 };
  const view = buildTableView(raw, 'labs', '/view/42');
  assert.equal(view.rowsSelector, 'table tbody tr');
  assert.equal(view.confidence, 'low');
});

// --- deepCrawlClinical: accordion / multi-panel attribution (fake client) ---------------------------------
//
// Simulates a GHIS-style Doctor module: every sub-view loads by AJAX into its own panel and earlier panels'
// tables stay in the DOM. The fake mirrors what the page-realm CRAWL_RAW_TABLE does in a browser: with the
// observer ARMED before the click it reports the table inside the panel that just changed; without it, it
// reports the global "best" table, which is the lingering Labs table (more rows, has <th>). So the test
// fails if the crawler stops arming the observer before each sub-view click or captures before the click.

const LABS_RAW = { id: '', class: 'table table-striped', headers: ['TEST NAME', 'RESULT', 'UNITS'], rows: [{ isHeader: true, onclick: null }, { isHeader: false, onclick: null }, { isHeader: false, onclick: null }, { isHeader: false, onclick: null }], container: { id: 'panel-labs', class: '' }, tableNth: 0 };
const MED_LABELS = ['Prod. Code', 'Drug Name', 'Route', 'Dosage', 'Qty', 'Freq', 'Duration'];
// Headerless data table: the labels come from the sibling header table (recovered in the page realm).
const MEDS_RAW = { id: '', class: 'tbl-bordered', headers: MED_LABELS, rows: [{ isHeader: false, onclick: null }], container: { id: 'panel-meds', class: '' }, tableNth: 2 };

function accordionClient(log) {
  let current = 'worklist';
  let armed = false;
  let lastLoaded = null;
  const loaded = new Set();
  const controls = [{ index: 1, label: 'Lab reports' }, { index: 3, label: 'Medications' }, { index: 5, label: 'Discharge summary' }];
  return {
    async currentUrl() { return { url: '/doctor/' + current }; },
    async wait() {},
    async evaluate({ expression }) {
      if (expression.includes('function CRAWL_ARM_OBSERVER')) { armed = true; log.push('arm'); return { result: 'ok' }; }
      if (expression.includes('function CRAWL_RAW_TABLE')) {
        log.push('capture');
        if (current === 'worklist') return { result: JSON.stringify(makePages().worklist.rawTable) };
        const wasArmed = armed; armed = false;
        if (wasArmed) {
          // Panel-attributed capture: only the panel the click populated. A view whose panel holds no
          // table (discharge narrative) reports null even though the labs table lingers.
          if (lastLoaded === 'labs') return { result: JSON.stringify(LABS_RAW) };
          if (lastLoaded === 'meds') return { result: JSON.stringify(MEDS_RAW) };
          return { result: 'null' };
        }
        // Global best-table fallback: the lingering labs table wins whenever it has been loaded.
        return { result: JSON.stringify(loaded.has('labs') ? LABS_RAW : (loaded.has('meds') ? MEDS_RAW : null)) };
      }
      if (expression.includes('function CRAWL_FIND_PATIENT_ROW')) return { result: JSON.stringify(current === 'worklist' ? { index: 1 } : null) };
      if (expression.includes('function CRAWL_CLICK_ROW')) { current = 'patient'; return { result: 'ok' }; }
      if (expression.includes('function CRAWL_FIND_CONTROLS')) return { result: JSON.stringify(current === 'worklist' ? [] : controls) };
      if (expression.includes('function CRAWL_CLICK_CONTROL')) {
        const m = /\)\((\d+),/.exec(expression);
        const label = (controls.find((c) => c.index === Number(m[1])) || {}).label;
        log.push('click:' + label);
        lastLoaded = label === 'Lab reports' ? 'labs' : label === 'Medications' ? 'meds' : 'discharge';
        loaded.add(lastLoaded);
        return { result: 'ok' };
      }
      return { result: 'null' };
    },
  };
}

test('deepCrawlClinical: accordion: medications captures the MED panel table, not the lingering labs table', async () => {
  const log = [];
  const { observedViews, trail } = await deepCrawlClinical({ client: accordionClient(log), caps: { maxMs: 60000 } });
  assert.deepEqual(trail, ['patient-record', 'Lab reports', 'Medications', 'Discharge summary']);

  const labs = observedViews.find((v) => v.resourceHint === 'labs');
  const meds = observedViews.find((v) => v.resourceHint === 'medications');
  const dis = observedViews.find((v) => v.resourceHint === 'discharge');
  assert.deepEqual(labs.headers, ['TEST NAME', 'RESULT', 'UNITS']);
  assert.equal(labs.rowsSelector, '#panel-labs table tbody tr');
  assert.deepEqual(meds.headers, MED_LABELS);
  assert.equal(meds.rowsSelector, '#panel-meds table.tbl-bordered:nth-of-type(2) tbody tr');
  assert.equal(meds.singleRecord, false);
  assert.equal(dis, undefined); // a narrative with neither a table nor label/value pairs yields no view

  // Observer armed immediately before the patient-row click and EVERY sub-view click, capture only after
  // it; never for the worklist. (The patient hub capture is block-only, so no table capture follows the
  // row click.)
  assert.deepEqual(log, ['capture', 'arm', 'arm', 'click:Lab reports', 'capture', 'arm', 'click:Medications', 'capture', 'arm', 'click:Discharge summary', 'capture']);

  // Downstream: inference now builds the medications AND labs operations from this crawl.
  const { operations } = inferHtmlOperations(observedViews, { originId: 'o1' });
  assert.deepEqual(operations.map((o) => o.type).sort(), ['list_medications', 'list_results', 'list_worklist']);
});

// --- deepCrawlClinical: real DOM (headless Chrome), proves the page-realm functions ----------------------
//
// The fake above proves the crawler's sequencing; this proves CRAWL_ARM_OBSERVER / CRAWL_RAW_TABLE against a
// real accordion DOM: panel attribution via MutationObserver, headerless-table label recovery from the sibling
// header table, write-form (#tblmedicines) and calendar exclusion, <li><a> nav controls, and PHI redaction.
// Skipped when Chrome is not installed (set CHROME to the binary) or DEEP_CRAWL_SKIP_CHROME=1.

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HAVE_CHROME = !process.env.DEEP_CRAWL_SKIP_CHROME && existsSync(CHROME);

// The id-less, <th>-less, class-less layout tables under #patient_details_table (as on the live GHIS page)
// come FIRST in DOM order and carry digit runs: a patient-row finder that accepts them opens nothing.
const LAYOUT_TABLES = `<div id="patient_details_table"><div class="left_inner"><table><tr><td>UHID</td><td>00</td></tr><tr><td>Ward</td><td>12</td></tr></table></div>
<div class="right_inner"><table><tr><td>Bed</td><td>34</td></tr><tr><td>Age</td><td>56</td></tr></table></div></div>`;
const CALENDAR = `<table class="ui-datepicker-calendar"><thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead>
<tbody>${'<tr><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td></tr>'.repeat(5)}</tbody></table>`;

const ACCORDION_HTML = `<!doctype html><html><body>
${LAYOUT_TABLES}
<div id="worklist"><table id="data_tables1" class="table table-bordered"><thead><tr><th>MRN</th><th>Name</th><th>Ward</th></tr></thead>
<tbody><tr onclick="openPatient('${SENTINEL}','48213')"><td>48213</td><td>${SENTINEL}</td><td>W3</td></tr></tbody></table></div>
${CALENDAR}
<div id="patient" style="display:none">
<ul class="nav"><li><a href="#" onclick="loadView('42');return false">Lab reports</a></li>
<li><a href="#" onclick="loadView('4');return false">Medications</a></li>
<li><a href="#" onclick="loadView('9');return false">Discharge summary</a></li>
<li><a href="#" onclick="loadView('pp');return false">Patient profile</a></li>
<li><a href="#" onclick="window.__writes++;return false">Logout</a></li><li><button type="button" onclick="window.__writes++">Print</button></li></ul>
<div id="hospital_accordion_2026-09-11_48213" class="panel-collapse"></div>
<div id="panel-labs" class="panel-body"></div><div id="panel-meds" class="panel-body"></div><div id="panel-dis" class="panel-body"></div>
</div>
<script>
function openPatient(){window.__opened=true;document.getElementById('worklist').style.display='none';document.getElementById('patient').style.display='';}
var VIEWS={
 '42':['panel-labs','<table class="table table-striped"><thead><tr><th>TEST NAME</th><th>RESULT</th><th>UNITS</th></tr></thead><tbody>'+'<tr><td>Hb</td><td>13</td><td>g/dL</td></tr>'.repeat(6)+'</tbody></table>'],
 '4':['panel-meds','<table class="tbl-head"><thead><tr><th>Prod. Code</th><th>Drug Name</th><th>Route</th><th>Dosage</th><th>Qty</th><th>Freq</th><th>Duration</th></tr></thead></table>'
  +'<table class="tbl-bordered"><tbody><tr><td>P1</td><td>SECRETVAL</td><td>Oral</td><td>500</td><td>10</td><td>BD</td><td>5</td></tr></tbody></table>'
  +'<table id="tblmedicines"><tbody><tr><td><select><option>x</option></select></td><td><input type="text"></td><td><button type="submit">Add</button></td></tr></tbody></table>'],
 '9':['panel-dis','<div class="dsum"><table><tr><td>Diagnosis</td><td>SECRETDX</td></tr><tr><td>Admission date</td><td>01-02-2026</td></tr><tr><td>Summary</td><td>SECRETSUM</td></tr></table></div>'],
 'pp':['hospital_accordion_2026-09-11_48213','<div id="divPrint"><div class="rreport"><p><b>Study:</b> CT BRAIN</p><p><b>Reported on:</b> 02-02-2026</p><p><b>Impression:</b> SECRETIMP1</p></div><div class="rreport"><p><b>Study:</b> XRAY CHEST</p><p><b>Reported on:</b> 03-02-2026</p><p><b>Impression:</b> SECRETIMP2</p></div></div>']};
window.__writes=0;
function loadView(id){var v=VIEWS[id];setTimeout(function(){document.getElementById(v[0]).innerHTML=v[1];},30);}
</script></body></html>`;

async function withChrome(fn, html = ACCORDION_HTML) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const userDir = join(tmpdir(), 'deep-crawl-chrome-' + process.pid + '-' + port);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, '--no-first-run', '--disable-gpu', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let ver;
    for (let i = 0; i < 100 && !ver; i += 1) {
      try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); }
    }
    if (!ver) throw new Error('chrome did not expose CDP');
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 1; const pending = new Map(); let sessionId;
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const call = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId })); });
    const { result: { targetId } } = await call('Target.createTarget', { url: 'about:blank' });
    ({ result: { sessionId } } = await call('Target.attachToTarget', { targetId, flatten: true }));
    await call('Runtime.enable');
    await call('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
    const evaluate = async ({ expression }) => {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('page error: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return { result: r.result?.result?.value ?? null };
    };
    for (let i = 0; i < 50; i += 1) { if ((await evaluate({ expression: 'document.readyState === "complete" && !!document.body' })).result === true) break; await sleep(100); }
    await fn(evaluate);
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    const exited = new Promise((res) => proc.once('exit', res));
    proc.kill('SIGKILL');
    await exited;
    try { rmSync(userDir, { recursive: true, force: true }); } catch { /* chrome may still be flushing; a stale tmp dir is harmless */ }
  }
}

test('deepCrawlClinical: real DOM accordion (headless Chrome): panel attribution + header recovery', { skip: !HAVE_CHROME && 'Chrome not available' }, async () => {
  await withChrome(async (evaluate) => {
    const client = { evaluate, async wait({ ms }) { await sleep(Math.min(ms, 200)); }, async currentUrl() { return { url: 'https://emr.example/doctor/index' }; } };
    const { observedViews, trail, stopReason, found } = await deepCrawlClinical({ client, caps: { maxMs: 60000, waitMs: 200 } });
    assert.deepEqual(trail, ['patient-record', 'Lab reports', 'Medications', 'Discharge summary', 'Patient profile']);
    assert.equal(stopReason, 'no-candidate');
    // Read-only SKIP list: Logout and Print were never clicked.
    assert.equal((await evaluate({ expression: 'window.__writes' })).result, 0);
    assert.deepEqual([...found].sort(), ['discharge', 'labs', 'medications', 'radiology', 'worklist']);

    // (C) the digit-bearing layout rows come first in DOM order; the onclick row of #data_tables1 was opened.
    assert.equal((await evaluate({ expression: 'window.__opened === true' })).result, true);

    const worklist = observedViews[0];
    assert.equal(worklist.rowsSelector, '#data_tables1 tbody tr'); // calendar (more rows, weekday <th>) skipped
    assert.deepEqual(worklist.headers, ['MRN', 'Name', 'Ward']);
    assert.equal(worklist.onclickTemplate, 'openPatient(#,#)');

    const labs = observedViews.find((v) => v.resourceHint === 'labs');
    assert.deepEqual(labs.headers, ['TEST NAME', 'RESULT', 'UNITS']);
    assert.equal(labs.rowsSelector, '#panel-labs table tbody tr');
    assert.equal(labs.singleRecord, false);

    const meds = observedViews.find((v) => v.resourceHint === 'medications');
    assert.deepEqual(meds.headers, MED_LABELS); // recovered from the sibling header table, NOT the labs <th>
    assert.equal(meds.rowsSelector, '#panel-meds table.tbl-bordered:nth-of-type(2) tbody tr');
    assert.ok(!meds.rowsSelector.includes('tblmedicines'));
    assert.equal(meds.singleRecord, false);

    // Discharge summary: a label/value REPORT BLOCK, not a headed table. Labels come back as headers, each
    // value as a positional selector relative to the block root; the lingering tables are not reused.
    const dis = observedViews.find((v) => v.resourceHint === 'discharge');
    assert.equal(dis.block, true);
    assert.equal(dis.singleRecord, true);
    assert.deepEqual(dis.headers, ['Diagnosis', 'Admission date', 'Summary']);
    assert.equal(dis.rowsSelector, '#panel-dis div:nth-of-type(1) table:nth-of-type(1)');
    assert.deepEqual(dis.cellSelectors, ['tr:nth-of-type(1) td:nth-of-type(2)', 'tr:nth-of-type(2) td:nth-of-type(2)', 'tr:nth-of-type(3) td:nth-of-type(2)']);

    // Patient profile: two same-shaped radiology reports under an accordion whose id embeds a date and a
    // visit number. The UNSTABLE id is never an anchor; the repeated blocks come back as one repeated view.
    const rad = observedViews.find((v) => v.resourceHint === 'radiology');
    assert.equal(rad.block, true);
    assert.equal(rad.singleRecord, false);
    assert.equal(rad.rowsSelector, '#divPrint > div.rreport');
    assert.deepEqual(rad.headers, ['Study', 'Reported on', 'Impression']);
    assert.ok(!JSON.stringify(rad).includes('hospital_accordion'));

    const dump = JSON.stringify(observedViews);
    for (const secret of [SENTINEL, 'SECRETVAL', '48213', 'Hb', 'Oral', 'SECRETDX', 'SECRETSUM', 'SECRETIMP', 'CT BRAIN', '2026-09-11']) assert.ok(!dump.includes(secret), secret + ' leaked');

    // End to end: inference emits list_medications, and its htmlExtract pulls the med data row (only) from
    // the final page HTML, proving the selector is unambiguous among the three tables in the panel.
    const { operations, unsupported } = inferHtmlOperations(observedViews, { originId: 'o1' });
    assert.deepEqual(operations.map((o) => o.type).sort(), ['list_medications', 'list_notes', 'list_results', 'list_worklist'], JSON.stringify(unsupported));
    const medOp = operations.find((o) => o.type === 'list_medications');
    const html = (await evaluate({ expression: 'document.documentElement.outerHTML' })).result;
    const recs = extractRecords(html, medOp.htmlExtract);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].drugName, 'SECRETVAL');
    assert.equal(recs[0].prodCode, 'P1');
    // Report blocks extract by positional selectors. One list_notes per manifest (schema: unique operation
    // types), so the discharge block (captured first, equally rich) holds the type and radiology is noted
    // as a duplicate; each block extracts correctly on its own.
    const noteOp = operations.find((o) => o.type === 'list_notes');
    assert.equal(noteOp.htmlExtract.rows, dis.rowsSelector);
    const disRecs = extractRecords(html, noteOp.htmlExtract);
    assert.equal(disRecs.length, 1);
    assert.equal(disRecs[0].report, 'SECRETSUM');
    assert.equal(disRecs[0].date, '01-02-2026');
    const radOnly = inferHtmlOperations([rad], { originId: 'o1' }).operations[0];
    assert.equal(radOnly.htmlExtract.rows, '#divPrint > div.rreport');
    const notes = extractRecords(html, radOnly.htmlExtract);
    assert.equal(notes.length, 2);
    // Inline "<b>Label:</b> value" pairs extract the whole line (the label text rides along).
    assert.equal(notes[0].title, 'Study: CT BRAIN');
    assert.equal(notes[0].date, 'Reported on: 02-02-2026');
    assert.equal(notes[0].report, 'Impression: SECRETIMP1');
    assert.equal(notes[1].title, 'Study: XRAY CHEST');
  });
});

// --- buildBlockView / redactEndpoints / unstable anchors (pure) ---------------------------------------------

test('buildTableView: an id embedding a date or visit number is UNSTABLE and never anchors the selector', () => {
  const raw = { id: 'hospital_accordion_2026-09-11_48213', class: 'tbl-bordered', headers: ['A', 'B'], rows: [{ isHeader: false, onclick: null }], container: { id: 'visit_2026', class: 'panel-body' }, tableNth: 0 };
  const view = buildTableView(raw, 'medications', '/v');
  assert.equal(view.rowsSelector, 'table.tbl-bordered tbody tr');
  assert.ok(!JSON.stringify(view).includes('2026'));
});

test('buildBlockView: labels become headers, selectors kept, colon stripped; too few pairs or an unstable root -> null', () => {
  const view = buildBlockView({ rootSelector: '#sb7', labels: ['Study:', 'Reported on', 'Impression:'], selectors: ['p:nth-of-type(1)', 'p:nth-of-type(2)', 'p:nth-of-type(3)'], repeated: false }, 'radiology', 'https://h/x?y=1');
  assert.deepEqual(view.headers, ['Study', 'Reported on', 'Impression']);
  assert.equal(view.rowsSelector, '#sb7');
  assert.equal(view.singleRecord, true);
  assert.equal(view.block, true);
  assert.ok(view.cellSelectors.every(isValidSelector));
  assert.equal(buildBlockView({ rootSelector: '#sb7', labels: ['Study'], selectors: ['p'], repeated: false }, 'radiology', '/'), null);
  assert.equal(buildBlockView({ rootSelector: '#hospital_accordion_2026 div', labels: ['A', 'B'], selectors: ['p', 'p'], repeated: false }, 'radiology', '/'), null);
});

test('redactEndpoints: same-origin non-asset requests only, query values dropped, digit runs redacted, capped at 8', () => {
  const reqs = [
    { method: 'GET', url: 'https://emr.example/Doctor/GetLabs?patientId=MR900001&visit=12345' },
    { method: 'POST', url: 'https://emr.example/Doctor/Meds/2012130687' },
    { method: 'GET', url: 'https://emr.example/Doctor/Meds/2012130687' }, // same path, different method: kept
    { method: 'GET', url: 'https://emr.example/Content/site.css?v=3' },
    { method: 'GET', url: 'https://other.example/api' },
    { method: 'GET', url: 'not a url' },
  ];
  const out = redactEndpoints(reqs, 'https://emr.example/Doctor/Home');
  assert.deepEqual(out, [
    { method: 'GET', path: '/Doctor/GetLabs?patientId&visit' },
    { method: 'POST', path: '/Doctor/Meds/#' },
    { method: 'GET', path: '/Doctor/Meds/#' },
  ]);
  assert.ok(!JSON.stringify(out).includes('MR900001'));
  const many = Array.from({ length: 20 }, (_, i) => ({ method: 'GET', url: `https://emr.example/p${i}` }));
  assert.equal(redactEndpoints(many, 'https://emr.example/').length, 8);
});

test('redactEndpoints: passes bodyKeys/requestKind/xhr/contentType through and strips a hostile body key', () => {
  const reqs = [
    {
      method: 'POST', url: 'https://emr.example/Doctor/Home/Searchnew',
      bodyKeys: ['__RequestVerificationToken', 'recordNo', 'mrn2012130687', 'user@example.com'],
      requestKind: 'form', xhr: true, contentType: 'text/html; charset=utf-8',
    },
  ];
  const out = redactEndpoints(reqs, 'https://emr.example/Doctor/Home');
  assert.deepEqual(out, [{
    method: 'POST', path: '/Doctor/Home/Searchnew',
    bodyKeys: ['__RequestVerificationToken', 'recordNo'], // mrn2012130687 (digits) and the @ address dropped
    requestKind: 'form', xhr: true, contentType: 'text/html; charset=utf-8',
  }]);

  // observer-style entry: path + origin instead of url, and no extra fields at all
  const plain = redactEndpoints([{ method: 'GET', path: '/Doctor/Home', origin: 'https://emr.example' }], 'https://emr.example/Doctor/Home');
  assert.deepEqual(plain, [{ method: 'GET', path: '/Doctor/Home' }]);
});

test('mergeEndpointDetails: attaches observer details to the matching endpoint by method + redacted path', () => {
  const endpoints = [
    { method: 'POST', path: '/Doctor/Home/Searchnew' },
    { method: 'GET', path: '/Doctor/GetLabs?patientId' },
  ];
  const observerEvents = [
    {
      method: 'POST', path: '/Doctor/Home/Searchnew', origin: 'https://emr.example', queryKeys: [],
      bodyKeys: ['__RequestVerificationToken', 'recordNo'], requestKind: 'form', xhr: true, contentType: 'text/html',
    },
    { method: 'GET', path: '/Doctor/Other', origin: 'https://emr.example', queryKeys: [] }, // no match: ignored
  ];
  const merged = mergeEndpointDetails(endpoints, observerEvents);
  assert.deepEqual(merged[0], {
    method: 'POST', path: '/Doctor/Home/Searchnew',
    bodyKeys: ['__RequestVerificationToken', 'recordNo'], requestKind: 'form', xhr: true, contentType: 'text/html',
  });
  assert.deepEqual(merged[1], { method: 'GET', path: '/Doctor/GetLabs?patientId' }); // untouched, no match
  assert.deepEqual(mergeEndpointDetails([], observerEvents), []);
  assert.deepEqual(mergeEndpointDetails(endpoints, []), endpoints);
});

test('hintFromHeaders: a container label ("Patient profile") is re-hinted from what the block actually holds', () => {
  assert.equal(hintFromHeaders(['Study', 'Reported on', 'Impression']), 'radiology');
  assert.equal(hintFromHeaders(['Diagnosis', 'Admission date', 'Summary']), 'discharge');
  assert.equal(hintFromHeaders(['UHID', 'Patient name', 'Gender', 'Age']), 'patient');
  assert.equal(hintFromHeaders(['Foo', 'Bar']), 'unknown');
});

// (A) Locked / backgrounded WebView: nothing has layout, every table reports zero client rects (simulated with
// display:none on <html>). Visibility must drop out of the scoring and the walk must still capture the real
// <th> data table over the layout tables, with sub-views attributed by the MutationObserver, not null.
const LOCKED_HTML = ACCORDION_HTML.replace('<html>', '<html style="display:none">');

test('deepCrawlClinical: real DOM, locked device (zero rects everywhere): data table wins, sub-views captured', { skip: !HAVE_CHROME && 'Chrome not available' }, async () => {
  await withChrome(async (evaluate) => {
    assert.equal((await evaluate({ expression: '[].some.call(document.querySelectorAll("table"), function (t) { return t.getClientRects().length > 0; })' })).result, false);
    const client = { evaluate, async wait({ ms }) { await sleep(Math.min(ms, 200)); }, async currentUrl() { return { url: 'https://emr.example/doctor/index' }; } };
    const { observedViews, trail, stopReason } = await deepCrawlClinical({ client, caps: { maxMs: 60000, waitMs: 200 } });
    assert.equal(stopReason, 'no-candidate');
    assert.deepEqual(trail, ['patient-record', 'Lab reports', 'Medications', 'Discharge summary', 'Patient profile']);
    assert.equal((await evaluate({ expression: 'window.__opened === true' })).result, true);

    assert.equal(observedViews[0].rowsSelector, '#data_tables1 tbody tr'); // not a #patient_details_table layout table
    assert.deepEqual(observedViews[0].headers, ['MRN', 'Name', 'Ward']);
    const labs = observedViews.find((v) => v.resourceHint === 'labs');
    const meds = observedViews.find((v) => v.resourceHint === 'medications');
    assert.equal(labs.rowsSelector, '#panel-labs table tbody tr');
    assert.deepEqual(labs.headers, ['TEST NAME', 'RESULT', 'UNITS']);
    assert.equal(meds.rowsSelector, '#panel-meds table.tbl-bordered:nth-of-type(2) tbody tr');
    assert.deepEqual(meds.headers, MED_LABELS);
    assert.equal(meds.singleRecord, false);

    const dump = JSON.stringify(observedViews);
    for (const secret of [SENTINEL, 'SECRETVAL', '48213', 'Hb', 'Oral']) assert.ok(!dump.includes(secret), secret + ' leaked');
    const { operations } = inferHtmlOperations(observedViews, { originId: 'o1' });
    assert.deepEqual(operations.map((o) => o.type).sort(), ['list_medications', 'list_results', 'list_worklist']);
  }, LOCKED_HTML);
});

// (B) Expired session: the GHIS dead shell as probed on the device: ~200 chars of text, two id-less layout
// tables under #patient_details_table, the jQuery datepicker, nav links that render nothing, no login form.
const SHELL_HTML = `<!doctype html><html><body>
<ul class="nav"><li><a href="#" onclick="return false">Medications</a></li><li><a href="#" onclick="return false">Lab reports</a></li></ul>
${LAYOUT_TABLES}
${CALENDAR}
<p>Doctor module. Select a patient.</p>
</body></html>`;

const LOGIN_HTML = `<!doctype html><html><body><form><label>User</label><input type="text" name="u">
<label>Password</label><input type="password" name="p"><button type="submit">Login</button></form>
${LAYOUT_TABLES}</body></html>`;

test('deepCrawlClinical: real DOM, dead shell -> session-expired-or-shell, nothing captured or clicked', { skip: !HAVE_CHROME && 'Chrome not available' }, async () => {
  await withChrome(async (evaluate) => {
    const client = { evaluate, async wait({ ms }) { await sleep(Math.min(ms, 200)); }, async currentUrl() { return { url: 'https://emr.example/doctor/index#' }; } };
    const { observedViews, trail, stopReason } = await deepCrawlClinical({ client, caps: { maxMs: 60000, waitMs: 200 } });
    assert.equal(stopReason, 'session-expired-or-shell');
    assert.deepEqual(observedViews, []);
    assert.deepEqual(trail, []);
  }, SHELL_HTML);
});

test('deepCrawlClinical: real DOM, login form -> login-required', { skip: !HAVE_CHROME && 'Chrome not available' }, async () => {
  await withChrome(async (evaluate) => {
    const client = { evaluate, async wait() {}, async currentUrl() { return { url: 'https://emr.example/login' }; } };
    const { observedViews, stopReason } = await deepCrawlClinical({ client, caps: { maxMs: 60000 } });
    assert.equal(stopReason, 'login-required');
    assert.deepEqual(observedViews, []);
  }, LOGIN_HTML);
});

test('guided ask: the table the doctor taps inside turns green and is the one captured (real DOM)', async () => {
  const html = '<html><body>'
    + '<table id="big"><thead><tr><th>Patient ID</th><th>Patient name</th><th>Age</th><th>Ward</th></tr></thead><tbody>'
    + '<tr><td>A1</td><td>X</td><td>30</td><td>W1</td></tr><tr><td>A2</td><td>Y</td><td>40</td><td>W2</td></tr><tr><td>A3</td><td>Z</td><td>50</td><td>W3</td></tr></tbody></table>'
    + '<table id="meds"><thead><tr><th>Drug Name</th><th>Dose</th></tr></thead><tbody><tr><td id="cell">Amox</td><td>500 mg</td></tr></tbody></table>'
    + '</body></html>';
  const { GUIDE_SOURCES, captureView } = await import('../../connect-agent/phone/deep-crawl.mjs');
  await withChrome(async (evaluate) => {
    const client = { evaluate, async currentUrl() { return { url: 'https://emr.example/rx' }; } };
    await evaluate({ expression: GUIDE_SOURCES.armGuide });
    await evaluate({ expression: "document.getElementById('cell').click(); 1" });
    assert.match(String((await evaluate({ expression: "document.getElementById('meds').style.outline" })).result), /solid/);
    const view = await captureView({ client, resourceHint: 'medications' });
    assert.equal(view.rowsSelector, '#meds tbody tr', 'the pointed table, not the bigger one');
    await evaluate({ expression: GUIDE_SOURCES.clearPoint });
    assert.equal((await evaluate({ expression: "document.getElementById('meds').style.outline" })).result, '');
  }, html);
});
