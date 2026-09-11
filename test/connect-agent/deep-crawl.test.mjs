// test/connect-agent/deep-crawl.test.mjs — unit tests for connect-agent/phone/deep-crawl.mjs:
// buildTableView (pure selector/redaction logic) and deepCrawlClinical (worklist -> patient -> views)
// against a fake six-method client that simulates a GHIS-style worklist/patient/medications/labs flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTableView, deepCrawlClinical } from '../../connect-agent/phone/deep-crawl.mjs';

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
        { index: 4, label: 'Home' }, // not a clinical keyword match — excluded by CRAWL_FIND_CONTROLS itself
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
      if (expression.includes('function CRAWL_RAW_TABLE')) return { result: JSON.stringify(page.rawTable) };
      if (expression.includes('function CRAWL_FIND_PATIENT_ROW')) return { result: JSON.stringify(page.patientRow) };
      if (expression.includes('function CRAWL_CLICK_ROW')) { current = 'patient'; return { result: 'ok' }; }
      if (expression.includes('function CRAWL_FIND_CONTROLS')) return { result: JSON.stringify(page.controls) };
      if (expression.includes('function CRAWL_CLICK_CONTROL')) {
        const m = /\)\((\d+)\)\s*$/.exec(expression);
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

  assert.deepEqual(trail, ['patient-record', 'Medications', 'Lab reports']);
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
