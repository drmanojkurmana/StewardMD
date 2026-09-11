// test/connect-agent/manifest-infer-html.test.mjs
// Feed the REAL GHIS view structures (FAKE values, no PHI) to inferHtmlOperations and prove the emitted
// operations: (1) validate inside a manifest via assertValidManifest, and (2) extract from the same
// synthetic HTML the hand-authored ghis-html-extract.test.mjs uses, end to end through
// extractRecords -> executeOperation -> normalizeOperation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferHtmlOperations } from '../../connect-agent/manifest/infer-html.mjs';
import { assertValidManifest, manifestContentHash } from '../../connect-agent/manifest/schema.mjs';
import { executeOperation } from '../../connect-agent/manifest/interpret.mjs';
import { normalizeOperation } from '../../connect-agent/manifest/normalize.mjs';

const ORIGIN_ID = 'origin:ghis';

// Wrap emitted operations in a minimal, valid manifest so assertValidManifest exercises the real gate.
function wrap(operations, unsupported = []) {
  const m = {
    schemaVersion: 3,
    manifestId: 'ghis-inferred',
    origins: [{ id: ORIGIN_ID, origin: 'https://ghis.gitam.edu', role: 'ui' }],
    operations,
    unsupported,
    capabilityProbes: [],
    provenance: { discoverySpecHash: `sha256:${'0'.repeat(64)}`, compilerVersion: '1.0.0', generatedAt: '2026-09-11T00:00:00.000Z' },
  };
  m.contentHash = manifestContentHash(m);
  return m;
}

// Real GHIS worklist structure, fake values (extra trailing columns present on-device are kept so cell
// indices from the 8 observed headers must still line up).
const GHIS_WORKLIST_HTML = `<!doctype html><html><body>
<table id="data_tables1" class="table table-bordered appointments dataTable">
<thead><tr><th>Patient ID</th><th>Visit ID</th><th>Patient name</th><th>Department</th><th>Age</th><th>Gender</th><th>Doctor name</th><th>Bed</th><th>Room</th><th>Visit type</th><th>Admission date</th></tr></thead>
<tbody>
<tr onclick="searchPatient('MR900001','Arrived and Occupied','IPMR700001','2012130687')">
  <td>MR900001</td><td>IPMR700001</td><td>JANE DOE</td><td>Cardiology</td><td>45</td><td>Female</td>
  <td>DR SMITH<input type="text" value="2055792" id="curr_doc" hidden=""></td><td>B-12</td><td>R-3</td><td>IP</td><td>2026-09-01</td>
</tr>
<tr onclick="searchPatient('MR900002','Bed Allocated','IPMR700002','2012130688')">
  <td>MR900002</td><td>IPMR700002</td><td>JOHN ROE</td><td>Neurology</td><td>60</td><td>Male</td>
  <td>DR PATEL<input type="text" value="2055793" id="curr_doc" hidden=""></td><td>B-07</td><td>R-1</td><td>IP</td><td>2026-08-30</td>
</tr>
</tbody></table></body></html>`;

const WORKLIST_VIEW = {
  resourceHint: 'worklist',
  pathTemplate: '/Doctor/Home',
  method: 'GET',
  rowsSelector: '#data_tables1 tbody tr',
  headers: ['Patient ID', 'Visit ID', 'Patient name', 'Department', 'Age', 'Gender', 'Doctor name', 'Bed'],
  onclickTemplate: "searchPatient('MR..','..','IPMR..')",
};

const stubExec = (html, expectPath) => ({ request: async ({ url }) => {
  if (expectPath) assert.equal(new URL(url).pathname, expectPath);
  return { status: 200, bodyText: html };
} });

test('worklist view -> valid list_worklist that extracts and normalizes', async () => {
  const { operations, unsupported, notes } = inferHtmlOperations([WORKLIST_VIEW], { originId: ORIGIN_ID });
  assert.equal(unsupported.length, 0, JSON.stringify(unsupported));
  assert.equal(operations.length, 1);
  const op = operations[0];

  // Shape: id from onclick arg 0, name from cell 2, age toNumber, sex map.
  assert.equal(op.type, 'list_worklist');
  assert.equal(op.responseFormat, 'html');
  assert.equal(op.originId, ORIGIN_ID);
  assert.equal(op.htmlExtract.fields.patientId.onclickArg, 0);
  assert.equal(op.htmlExtract.fields.name.cell, 2);
  assert.equal(op.htmlExtract.fields.age.cell, 4);
  assert.equal(op.htmlExtract.fields.sex.cell, 5);
  assert.ok(!('doctor' in op.htmlExtract.fields), 'doctor column is a guard, not extracted');
  assert.deepEqual(op.mapping.fields.id, { op: 'pick', path: 'patientId' });
  assert.equal(op.mapping.fields.age.op, 'toNumber');
  assert.equal(op.mapping.fields.age.unit, 'a');
  assert.equal(op.mapping.fields.gender.op, 'map');
  assert.equal(op.mapping.fields.gender.default, 'other');

  // Validates inside a manifest.
  const manifest = wrap([op]);
  assert.doesNotThrow(() => assertValidManifest(manifest));

  // Extracts + normalizes from the real synthetic HTML.
  const result = await executeOperation({ manifest, operationType: 'list_worklist', exec: stubExec(GHIS_WORKLIST_HTML, '/Doctor/Home') });
  const items = result.pages.flatMap((p) => p.items);
  assert.equal(items.length, 2);
  assert.equal(items[0].patientId, 'MR900001'); // onclick arg 0
  assert.equal(items[0].name, 'JANE DOE');       // cell 2
  assert.equal(items[0].sex, 'Female');          // cell 5

  const norm = normalizeOperation({ manifest, result });
  assert.equal(norm.resource, 'worklist');
  assert.deepEqual(norm.items.map((r) => r.id).sort(), ['MR900001', 'MR900002']);
  assert.equal(norm.items.find((r) => r.id === 'MR900001').name, 'JANE DOE');
  void notes;
});

test('medications view -> list_medications with id=prodCode, medication.text=drug', () => {
  const view = {
    resourceHint: 'medications',
    pathTemplate: '/Doctor/Home/GetMedicines/{patientId}',
    method: 'GET',
    rowsSelector: 'table.tbl-bordered tbody tr',
    headers: ['Prod. Code', 'Drug Name', 'Route', 'Dosage', 'Qty', 'Freq', 'Duration'],
  };
  const { operations, unsupported } = inferHtmlOperations([view], { originId: ORIGIN_ID });
  assert.equal(unsupported.length, 0, JSON.stringify(unsupported));
  const op = operations[0];
  assert.equal(op.type, 'list_medications');
  assert.equal(op.htmlExtract.fields.prodCode.cell, 0);
  assert.equal(op.htmlExtract.fields.drugName.cell, 1);
  assert.deepEqual(op.mapping.fields.id, { op: 'pick', path: 'prodCode' });
  assert.deepEqual(op.mapping.fields['medication.text'], { op: 'pick', path: 'drugName' });
  assert.deepEqual(op.mapping.fields.status, { op: 'const', value: 'active' });
  assert.deepEqual(op.mapping.fields.dosage, { op: 'pick', path: 'dosage' }); // Dosage column mapped
  // placeholder derived from the path template
  assert.deepEqual(op.placeholders.patientId, { type: 'id' });
  assert.doesNotThrow(() => assertValidManifest(wrap([op])));
});

const LAB_HTML = `<!doctype html><html><body>
<table id="lab_table" class="tbl-bordered">
<thead><tr><th>TEST NAME (METHOD)</th><th>TEST NAME</th><th>RESULTS</th><th>BIOLOGICAL REFERENCE INTERVAL</th><th>UNITS</th></tr></thead>
<tbody>
<tr><td>GLUCOSE (Hexokinase)</td><td>GLUCOSE</td><td>5.4</td><td>3.9 - 5.6</td><td>mmol/L</td></tr>
<tr><td>SODIUM (ISE)</td><td>SODIUM</td><td>139</td><td>135 - 145</td><td>mmol/L</td></tr>
</tbody></table></body></html>`;

test('labs view -> list_results, value.value toNumber unit from UNITS, referenceRange omitted + noted', async () => {
  const view = {
    resourceHint: 'labs',
    pathTemplate: '/Doctor/Home/GetLab',
    method: 'GET',
    rowsSelector: '#lab_table tbody tr',
    headers: ['TEST NAME (METHOD)', 'TEST NAME', 'RESULTS', 'BIOLOGICAL REFERENCE INTERVAL', 'UNITS'],
  };
  const { operations, unsupported, notes } = inferHtmlOperations([view], { originId: ORIGIN_ID });
  assert.equal(unsupported.length, 0, JSON.stringify(unsupported));
  const op = operations[0];
  assert.equal(op.type, 'list_results');
  assert.equal(op.mapping.resource, 'observations');
  assert.deepEqual(op.mapping.fields['code.text'], { op: 'pick', path: 'testName' });
  assert.equal(op.mapping.fields['value.value'].op, 'toNumber');
  assert.equal(op.mapping.fields['value.value'].path, 'result');
  assert.equal(op.mapping.fields['value.value'].unitPath, 'unit');
  assert.deepEqual(op.mapping.fields.category, { op: 'const', value: 'laboratory' });
  assert.deepEqual(op.mapping.fields.status, { op: 'const', value: 'final' });
  // Reference range NOT invented from the combined "low - high" column, and it is noted.
  assert.ok(!('referenceRange.low' in op.mapping.fields));
  assert.ok(!('referenceRange.high' in op.mapping.fields));
  assert.ok(notes.some((n) => /referenceRange omitted/.test(n)), JSON.stringify(notes));

  const manifest = wrap([op]);
  assert.doesNotThrow(() => assertValidManifest(manifest));

  const result = await executeOperation({ manifest, operationType: 'list_results', exec: stubExec(LAB_HTML, '/Doctor/Home/GetLab') });
  const norm = normalizeOperation({ manifest, result });
  assert.equal(norm.resource, 'observations');
  assert.equal(norm.items.length, 2);
  const glucose = norm.items.find((r) => r.code && r.code.text === 'GLUCOSE (Hexokinase)');
  assert.ok(glucose, 'glucose observation present');
  assert.equal(glucose.value.value, 5.4);
  assert.equal(glucose.value.unit, 'mmol/L');
  assert.equal(glucose.referenceRange, null); // omitted, not invented
});

test('unknown / blank-header view -> unsupported, not a broken op', () => {
  const views = [
    { resourceHint: 'unknown', pathTemplate: '/Doctor/Mystery', method: 'GET', rowsSelector: 'table tbody tr', headers: ['Foo', 'Bar'] },
    { resourceHint: 'labs', pathTemplate: '/Doctor/NoResult', method: 'GET', rowsSelector: 'table tbody tr', headers: ['TEST NAME'] }, // no RESULTS column
  ];
  const { operations, unsupported } = inferHtmlOperations(views, { originId: ORIGIN_ID });
  assert.equal(operations.length, 0);
  assert.equal(unsupported.length, 2);
  assert.equal(unsupported[0].capability, 'unknown');
  assert.equal(unsupported[0].observedPath, '/Doctor/Mystery');
  assert.match(unsupported[1].reason, /value\.value/);
});

test('hostile header label is dropped; Object.prototype untouched', () => {
  const proto = Object.getPrototypeOf({});
  const view = {
    resourceHint: 'worklist',
    pathTemplate: '/Doctor/Home',
    method: 'GET',
    rowsSelector: '#data_tables1 tbody tr',
    headers: ['Patient ID', '__proto__', 'constructor', 'Patient name'],
    onclickTemplate: "searchPatient('MR..')",
  };
  const { operations } = inferHtmlOperations([view], { originId: ORIGIN_ID });
  const op = operations[0];
  // Neither hostile label became a field, and the map is not polluted.
  assert.ok(!Object.prototype.hasOwnProperty.call(op.htmlExtract.fields, '__proto__'));
  assert.ok(!Object.prototype.hasOwnProperty.call(op.htmlExtract.fields, 'constructor'));
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf({}), proto);
  // "Patient name" shifted to column 3 by the two junk headers; extraction still targets the right cell.
  assert.equal(op.htmlExtract.fields.name.cell, 3);
  assert.doesNotThrow(() => assertValidManifest(wrap([op])));
});

test('duplicate operation type is de-duped, richer kept', () => {
  const lean = { resourceHint: 'worklist', pathTemplate: '/A', method: 'GET', rowsSelector: 'table tbody tr', headers: ['Patient ID'] };
  const rich = { resourceHint: 'worklist', pathTemplate: '/B', method: 'GET', rowsSelector: 'table tbody tr', headers: ['Patient ID', 'Patient name', 'Age'] };
  const { operations, notes } = inferHtmlOperations([lean, rich], { originId: ORIGIN_ID });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].pathTemplate, '/B'); // richer kept
  assert.ok(notes.some((n) => /duplicate list_worklist/.test(n)));
  assert.doesNotThrow(() => assertValidManifest(wrap(operations)));
});
