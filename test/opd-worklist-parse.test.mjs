// test/opd-worklist-parse.test.mjs — parseOpdHtml against the REAL GHIS Out-patients DataTable (14 columns,
// verified 2026-08-08). Guards the doctor-name-column fix + row robustness so the queue actually syncs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpdHtml } from "../functions/api/ghis/[[path]].js";

// The real Out-patients table: 14 headers, one OPD row, plus a "Reassign practitioner" modal table that must
// NOT be imported as a patient. (Structure mirrors ghis.gitam.edu DashboardUnit?type=docopdlist.)
const HTML = `
<table id="opd"><thead><tr>
  <th>Patient ID <span>arrows</span></th><th>Visit ID</th><th>Patient name</th><th>Department</th>
  <th>Age</th><th>Gender</th><th>Doctor name</th><th>Bed</th><th>Room</th><th>Visit type</th>
  <th>Admission date</th><th>Queue status</th><th>Floor</th><th>Station</th>
</tr></thead><tbody><tr>
  <td>MR26125863</td><td>OPMR260275723</td><td>MR. AMBATI VARAPRASAD</td><td>GASTROENTROLOGY</td>
  <td>41</td><td>Male</td><td>Dr CHANDU GOPALA KRISHNA</td><td>N/A</td><td>N/A</td><td>OPD</td>
  <td>08-Aug-2026</td><td>Open</td><td>N/A</td><td>N/A</td>
</tr></tbody></table>
<div class="modal"><table><tbody>
  <tr><td>Patient ID</td><td><input></td></tr>
  <tr><td>Visit ID</td><td><input></td></tr>
</tbody></table></div>`;

test("parseOpdHtml maps the 14-column Out-patients row correctly (doctor-name does not hijack patient name)", () => {
  const rows = parseOpdHtml(HTML);
  assert.equal(rows.length, 1, "exactly one OPD patient (modal rows excluded)");
  const r = rows[0];
  assert.equal(r.patientId, "MR26125863");
  assert.equal(r.visitId, "OPMR260275723");
  assert.equal(r.patientName, "MR. AMBATI VARAPRASAD");   // NOT the doctor's name
  assert.equal(r.doctor, "Dr CHANDU GOPALA KRISHNA");
  assert.equal(r.department, "GASTROENTROLOGY");
  assert.equal(r.visitType, "OPD");
});

test("parseOpdHtml tolerates no <tbody> and empty input", () => {
  assert.deepEqual(parseOpdHtml(""), []);
  assert.deepEqual(parseOpdHtml("no tags here"), []);
  const noTbody = `<table><tr><th>Patient ID</th><th>Patient name</th><th>Visit ID</th><th>Age</th></tr>
    <tr><td>MR9</td><td>ASHA K</td><td>OP9</td><td>30</td></tr></table>`;
  const r = parseOpdHtml(noTbody);
  assert.equal(r.length, 1);
  assert.equal(r[0].patientName, "ASHA K");
});
