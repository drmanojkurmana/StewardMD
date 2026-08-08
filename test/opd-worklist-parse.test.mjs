// test/opd-worklist-parse.test.mjs — parseOpdHtml against the REAL GHIS Out-patients DataTable (14 columns,
// verified 2026-08-08). Guards the doctor-name-column fix + row robustness so the queue actually syncs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpdHtml, isOpdVisit } from "../functions/api/ghis/[[path]].js";

// The real Out-patients table: 14 headers, one OPD row, plus a "Reassign practitioner" modal table that must
// NOT be imported as a patient. (Structure mirrors ghis.gitam.edu DashboardUnit?type=docopdlist.)
// EXACT structure from the live DashboardUnit?type=docopdlist response (2026-08-08): thead has a hidden
// 15th <th> (tatnurseid); the doctor cell embeds a hidden <input>; there is a <tfoot> of empty <th> (which
// must NOT corrupt the header mapping); the row has an onclick + an action <a> in the Queue-status cell.
const HTML = `<div class="table-responsive" id="dash"><table class="table table-bordered appointments" id="data_tables1">
<thead class="thead-light"><tr>
<th> Patient ID</th><th> Visit ID</th><th class="l-w-200"> Patient name</th><th> Department</th><th> Age</th><th> Gender</th><th class="l-w-150"> Doctor name</th><th> Bed</th><th> Room</th><th class="l-w-150"> Visit type</th><th class="white_space"> Admission date</th><th class="l-w-200"> Queue status</th><th> Floor</th><th> Station</th><th hidden> tatnurseid</th>
</tr></thead><tbody>
<tr style="cursor:pointer;" onclick="searchPatient('MR26125863','Open','OPMR260275723','')">
<td>MR26125863</td><td>OPMR260275723</td><td>MR. AMBATI VARAPRASAD  </td><td>GASTROENTROLOGY</td><td>41</td><td>Male</td><td>Dr CHANDU GOPALA KRISHNA <input type="text" value="2055792" id="curr_doc" hidden /></td><td>N/A</td><td>N/A</td><td>OPD</td><td>08-Aug-2026</td><td class="action"><a href="#" class="highf"> Open </a></td><td>N/A</td><td>N/A</td><td hidden></td>
</tr></tbody>
<tfoot><tr><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th></tr></tfoot>
</table></div>`;

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

// docopdlist returns the doctor's WHOLE worklist (OPD + Emergency + IP). The browser's "Out patients" tab
// keeps only Visit type == OPD, so the app must too — else Emergency patients leak into the OPD queue.
const MIXED = `<table id="data_tables1"><thead><tr>
<th>Patient ID</th><th>Visit ID</th><th>Patient name</th><th>Department</th><th>Age</th><th>Gender</th><th>Doctor name</th><th>Bed</th><th>Room</th><th>Visit type</th><th>Admission date</th><th>Queue status</th><th>Floor</th><th>Station</th><th hidden>tatnurseid</th>
</tr></thead><tbody>
<tr><td>MR26125863</td><td>OPMR260275723</td><td>MR. AMBATI VARAPRASAD</td><td>GASTROENTROLOGY</td><td>41</td><td>Male</td><td>Dr CHANDU</td><td>N/A</td><td>N/A</td><td>OPD</td><td>09-Aug-2026</td><td>Open</td><td>N/A</td><td>N/A</td><td hidden></td></tr>
<tr><td>MR26200290</td><td>EMMR260290</td><td>MR. PRATYUSH</td><td>CASUALTY</td><td>33</td><td>Male</td><td>Dr CHANDU</td><td>N/A</td><td>N/A</td><td>EMERGENCY</td><td>09-Aug-2026</td><td>Open</td><td>N/A</td><td>N/A</td><td hidden></td></tr>
</tbody></table>`;

test("isOpdVisit keeps only Out-patients (Emergency/IP dropped)", () => {
  const rows = parseOpdHtml(MIXED);
  assert.equal(rows.length, 2, "parser keeps both raw rows");
  const opd = rows.filter(isOpdVisit);
  assert.equal(opd.length, 1, "only the OPD row survives the tab filter");
  assert.equal(opd[0].patientName, "MR. AMBATI VARAPRASAD");
  assert.equal(isOpdVisit({ visitType: "OPD" }), true);
  assert.equal(isOpdVisit({ visitType: "opd" }), true);
  assert.equal(isOpdVisit({ visitType: "EMERGENCY" }), false);
  assert.equal(isOpdVisit({ visitType: "IP" }), false);
  assert.equal(isOpdVisit({ visitType: "" }), false);
  assert.equal(isOpdVisit({}), false);
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
