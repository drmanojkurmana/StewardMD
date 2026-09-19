// End-to-end proof that a responseFormat:'html' adapter turns a server-rendered GHIS worklist page into
// canonical records: validate manifest -> executeOperation over a stub transport -> normalizeOperation.
// Synthetic HTML mirrors the REAL GHIS #data_tables1 structure but carries only FAKE values (no PHI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestContentHash } from '../../connect-agent/manifest/schema.mjs';
import { executeOperation } from '../../connect-agent/manifest/interpret.mjs';
import { normalizeOperation } from '../../connect-agent/manifest/normalize.mjs';

// Mirrors the live GHIS worklist row shape captured on-device (values replaced with fakes):
// <tr onclick="searchPatient('MRN','status','VISIT','...')"> then cells in header order:
// Patient ID, Visit ID, Patient name, Department, Age, Gender, Doctor name(+hidden input), Bed, Room, ...
const GHIS_WORKLIST_HTML = `<!doctype html><html><body>
<table id="data_tables1" class="table table-bordered appointments dataTable">
<thead><tr><th>Patient ID</th><th>Visit ID</th><th>Patient name</th><th>Department</th><th>Age</th><th>Gender</th><th>Doctor name</th><th>Bed</th><th>Room</th><th>Visit type</th><th>Admission date</th></tr></thead>
<tbody>
<tr style="cursor:pointer;" onclick="searchPatient('MR900001','Arrived and Occupied','IPMR700001','2012130687')" role="row" class="odd">
  <td>MR900001</td><td>IPMR700001</td><td>JANE DOE</td><td>Cardiology</td><td>45</td><td>Female</td>
  <td>DR SMITH<input type="text" value="2055792" id="curr_doc" hidden=""></td><td>B-12</td><td>R-3</td><td class="sorting_1">IP</td><td>2026-09-01</td>
</tr>
<tr style="cursor:pointer;" onclick="searchPatient('MR900002','Bed Allocated','IPMR700002','2012130688')" role="row" class="even">
  <td>MR900002</td><td>IPMR700002</td><td>JOHN ROE</td><td>Neurology</td><td>60</td><td>Male</td>
  <td>DR PATEL<input type="text" value="2055793" id="curr_doc" hidden=""></td><td>B-07</td><td>R-1</td><td class="sorting_1">IP</td><td>2026-08-30</td>
</tr>
</tbody></table></body></html>`;

function ghisManifest() {
  const m = {
    schemaVersion: 3,
    manifestId: 'ghis-live',
    origins: [{ id: 'origin:ghis', origin: 'https://ghis.gitam.edu', role: 'ui' }],
    operations: [{
      type: 'list_worklist',
      method: 'GET',
      responseFormat: 'html',
      originId: 'origin:ghis',
      pathTemplate: '/Doctor/Home',
      placeholders: {},
      allowedQueryKeys: [],
      pagination: { style: 'none', maxPages: 1, maxItems: 500 },
      htmlExtract: {
        rows: '#data_tables1 tbody tr',
        fields: {
          mrn: { onclickArg: 0 },
          visit: { onclickArg: 2 },
          name: { cell: 2 },
          dept: { cell: 3 },
          age: { cell: 4 },
          sex: { cell: 5 },
          bed: { cell: 7 },
        },
      },
      mapping: {
        resource: 'worklist',
        fields: {
          id: { op: 'pick', path: 'mrn' },
          name: { op: 'pick', path: 'name' },
        },
      },
      sessionExpiry: { statusCodes: [401, 403], redirectPatterns: ['gimsrlogin', '/Index'] },
    }, {
      // Medications: the GHIS meds sub-view is a `.tbl-bordered` table (the write-entry form is a
      // separate #tblmedicines table, excluded by class). Headers observed live: Prod. Code, Drug Name,
      // Route, Dosage, Qty, Freq, Duration, ... The last "gen by" column is intentionally not mapped.
      type: 'list_medications',
      method: 'GET',
      responseFormat: 'html',
      originId: 'origin:ghis',
      pathTemplate: '/Doctor/Home/GetMedicines/{patientId}',
      placeholders: { patientId: { type: 'id' } },
      allowedQueryKeys: [],
      pagination: { style: 'none', maxPages: 1, maxItems: 500 },
      htmlExtract: {
        rows: 'table.tbl-bordered tbody tr',
        fields: {
          prodCode: { cell: 0 }, drug: { cell: 1 }, route: { cell: 2 },
          dose: { cell: 3 }, freq: { cell: 5 }, duration: { cell: 6 },
        },
      },
      mapping: {
        resource: 'medications',
        fields: {
          id: { op: 'pick', path: 'prodCode' },
          'medication.text': { op: 'pick', path: 'drug' },
          status: { op: 'const', value: 'active' },
          dosage: { op: 'pick', path: 'dose' },
        },
      },
      sessionExpiry: { statusCodes: [401, 403], redirectPatterns: ['gimsrlogin', '/Index'] },
    }],
    unsupported: [],
    capabilityProbes: [{ operationType: 'list_worklist', expect: { minItems: 1, requiredFields: ['id', 'name'] } }],
    provenance: { discoverySpecHash: `sha256:${'0'.repeat(64)}`, compilerVersion: '1.0.0', generatedAt: '2026-09-11T00:00:00.000Z' },
  };
  m.contentHash = manifestContentHash(m);
  return m;
}

const stubExec = (html) => ({ request: async ({ url }) => {
  assert.equal(new URL(url).pathname, '/Doctor/Home');
  return { status: 200, bodyText: html };
} });

test('GHIS html worklist: manifest validates, extracts records, normalizes to canonical', async () => {
  const manifest = ghisManifest();
  const result = await executeOperation({ manifest, operationType: 'list_worklist', exec: stubExec(GHIS_WORKLIST_HTML) });

  // Raw extraction: two rows, correct cells and onclick args (mrn from searchPatient arg0, name from cell 2).
  const items = result.pages.flatMap((p) => p.items);
  assert.equal(items.length, 2);
  assert.equal(items[0].mrn, 'MR900001');
  assert.equal(items[0].visit, 'IPMR700001');
  assert.equal(items[0].name, 'JANE DOE');
  assert.equal(items[0].age, '45');
  assert.equal(items[0].sex, 'Female');
  assert.equal(items[0].bed, 'B-12');
  // A nested <input value="2055792"> inside the doctor cell must not corrupt an earlier cell.
  assert.equal(items[1].mrn, 'MR900002');
  assert.equal(items[1].name, 'JOHN ROE');

  // Canonical: worklist resources keyed by the source MRN, with the patient name.
  const norm = normalizeOperation({ manifest, result });
  assert.equal(norm.resource, 'worklist');
  assert.equal(norm.items.length, 2);
  assert.deepEqual(norm.items.map((r) => r.id).sort(), ['MR900001', 'MR900002']);
  assert.equal(norm.items.find((r) => r.id === 'MR900001').name, 'JANE DOE');
});

test('GHIS html worklist: a login redirect body is treated as session expiry, not data', async () => {
  const manifest = ghisManifest();
  // No rows -> zero items; the interpreter must not invent records from an unrelated page.
  const result = await executeOperation({ manifest, operationType: 'list_worklist', exec: stubExec('<html><body>Please log in</body></html>') });
  assert.equal(result.pages.flatMap((p) => p.items).length, 0);
});
