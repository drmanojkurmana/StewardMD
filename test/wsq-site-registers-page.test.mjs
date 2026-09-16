/* test/wsq-site-registers-page.test.mjs - the Registers page after the legal review (wardsynq/site/pages/registers.js):
 * name and address parts round-trip through the form, due dates are said in words, the Form F presumed-contravention
 * count shows, and the settings tab translates around the server's legal notes and reads back what was typed.
 * Driven through the page's exported helpers in the fake DOM of test/wsq-site-i18n-harness.mjs.
 *
 * node --test test/wsq-site-registers-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";
import { schemaOf } from "../functions/_wardsynq/registers.js";
import { registerSettings, NOTES } from "../functions/_wardsynq/register-settings.js";

function env(lang) {
  const e = loadSite({ lang, pages: ["registers.js"] });
  const c = { esc: e.win.WSQ.esc, t: e.win.WSQ.t, tSafe: e.win.WSQ.tSafe, en: e.win.WSQ.en, can: () => true, state: { orgId: "org-1" } };
  return { ...e, c, R: e.win.WSQ._registers };
}

test("a 2024 birth report's name and address are parts on the form and come back as parts", () => {
  const { c, R, doc } = env("en");
  const schema = schemaOf("birth");
  const html = R.formHtml(c, schema, { kind: "birth", fields: { motherName: { first: "Asha", last: "Rao" } } });
  assert.ok(html.includes('id="rgF_motherName_first" value="Asha"') && html.includes('id="rgF_motherName_last" value="Rao"'));
  assert.ok(html.includes('id="rgF_addressAtBirth_pin"') && html.includes("PIN Code"));
  doc.getElementById("rgF_motherName_first").value = "Asha";
  doc.getElementById("rgF_motherName_middle").value = "";
  doc.getElementById("rgF_motherName_last").value = "Rao";
  doc.getElementById("rgF_addressAtBirth_townVillage").value = "Hoskote";
  doc.getElementById("rgF_addressAtBirth_pin").value = "562114";
  const out = R.readForm(schema);
  assert.deepEqual(out.motherName, { first: "Asha", last: "Rao" });
  assert.deepEqual(out.addressAtBirth, { townVillage: "Hoskote", pin: "562114" });
  const still = R.formHtml(c, schemaOf("stillbirth"), { kind: "stillbirth", fields: {} });
  assert.ok(/<option value="18" selected>18\. Not stated<\/option>/.test(still), "Form 3 item 12 starts at Not stated");
});

test("a due date is said in words beside its colour; the Form F count of incomplete entries is a presumed contravention", () => {
  const xx = env("xx");
  assert.match(xx.R.clockText(xx.c, { state: "overdue", dueBy: "2026-09-05" }), /^⟦OVERDUE: was due by 2026-09-05⟧$/);
  xx.R.state.data = { ok: true, entries: [], incomplete: 3, centre: [{ kind: "r17-notice" }], portalPending: 2, portalOverdue: 1,
    stateSubmission: { stateUt: "MH", stateName: "Maharashtra", configured: true, mode: "ONLINE", deadlineDays: 5, portalUrl: "https://pcpndt.maharashtra.gov.in/", requiresPortal: true, requiresReference: true } };
  const html = xx.R.statusHtml(xx.c, "formf");
  assert.deepEqual(leftovers(html, []), []);
  assert.match(html, /⟦In Maharashtra Form F is submitted online at https:\/\/pcpndt\.maharashtra\.gov\.in\/\.⟧ ⟦Due within 5 calendar days of the procedure\.⟧/);
  assert.match(html, /class="msg err">⟦2 Form F not yet recorded as submitted on the State\/UT portal, 1 past the deadline\.⟧/);
  assert.match(html, /⟦3 incomplete Form F this month: presumed contravention/);
  assert.match(html, /class="msg err"/);
  const table = xx.R.entriesTable(xx.c, schemaOf("death"), { ok: true, entries: [{ id: "reg-death-1", version: 1, complete: false, eventDate: "2026-08-01", fields: { dateOfDeath: "2026-08-01" }, clock: { state: "late-permission", dueBy: "2026-08-22" } }] });
  assert.match(table, /class="msg err">⟦LATE: after 30 days the District Registrar&#39;s permission and a fee are needed \(RBD Act s\.13\)⟧/);
});

test("register settings: every label translates around the server's legal notes, and what is typed is what is sent", () => {
  const xx = env("xx");
  xx.R.state.settings = { ok: true, settings: registerSettings(null), notes: NOTES };
  const html = xx.R.settingsHtml(xx.c);
  assert.deepEqual(leftovers(html, [...Object.values(NOTES), "1996", "sexual-assault-adult", "acid-attack", "pocso", "rta", "death-in-custody", "death-woman-married-under-7-years", "bnss33-offence", "assault", "burns", "poisoning", "suspected-suicide", "fall-industrial", "animal-bite", "brought-dead", "unknown-unconscious", "other"]), []);
  assert.ok(!html.includes("rgS_f2Recipient") && !html.includes("rgS_portal") && !html.includes("rgS_medleapr"), "the settings the owner's legal guidance replaced are gone");
  const { doc, R } = xx;
  doc.getElementById("rgS_f2Day").value = "10";
  doc.getElementById("rgS_rmiNo").value = "RMI/7";
  doc.getElementById("rgS_rmiExpires").value = "2027-01-31";
  doc.getElementById("rgS_doctors").value = "Dr P | KMC 1 | yes | 2026-01-01\nDr Q | KMC 2 |  |";
  doc.getElementById("rgS_witness").checked = false;
  const s = R.readSettings();
  assert.equal(s.mtp.formIIDueDay, 10);
  assert.equal(s.mtp.formIIRecipient, undefined);
  assert.equal(s.ndps.requireWitness, false);
  assert.deepEqual(s.ndps.rmi.designatedDoctors, [{ name: "Dr P", registrationNo: "KMC 1", overallInCharge: true, from: "2026-01-01" }, { name: "Dr Q", registrationNo: "KMC 2", overallInCharge: false, from: "" }]);
  xx.R.state.settings = false;
  assert.match(R.settingsHtml(xx.c), /Do not read this as the defaults/);
});

test("second legal pass: read-only doors show no write forms; a restricted case shows only its number; MTP rows show their retention end; the Schedule X and patient views translate; new settings read back", () => {
  const xx = env("xx");
  const { R, doc } = xx;
  R.state.tab = "ndps";
  const book = { ok: true, configured: true, rmi: { alerts: [] }, policy: "policy", items: [{ code: "Morphine", display: "Morphine", location: null, unit: "ampoule", opening: 0, closing: 5, lines: [],
    form3h: [{ date: "2026-09-16", opening: 0, received: 5, dispensed: 0, closing: 5, closure: null, unclosedLate: true }] }], doses: [], counts: [], unwitnessed: 0, discrepancies: 0, daysUnclosed: 1 };
  R.state.data = book;
  const writer = R.ndpsHtml({ ...xx.c, can: (cap) => cap === "register.ndps" });
  assert.ok(writer.includes('data-rg="closeday"') && writer.includes('data-rg="receive"') && writer.includes('data-rg="transfer"') && writer.includes('data-rg="count"'));
  assert.match(writer, /⟦1 past days of Form 3H are not closed/);
  const inspector = R.ndpsHtml({ ...xx.c, can: (cap) => cap === "register.ndps.read" });
  for (const act of ["closeday", "receive", "transfer", "count", "destroy"]) assert.ok(!inspector.includes(`data-rg="${act}"`), act);
  assert.deepEqual(leftovers(inspector, ["Morphine", "policy", "ampoule", "2026-09-16"]), []);

  const table = R.entriesTable(xx.c, schemaOf("mlc"), { ok: true, entries: [{ id: "reg-mlc-1", serial: "MLC/2026/00001", restricted: true, eventDate: "2026-09-16" }] });
  assert.match(table, /⟦Restricted case: it opens only to its treating team/);
  assert.ok(!table.includes("data-rg=\"open\""), "a withheld case cannot be opened from the list");
  const mtp = R.entriesTable(xx.c, schemaOf("mtp"), { ok: true, retentionNote: "x", entries: [{ id: "reg-mtp-1", serial: "1/2026", version: 1, complete: true, eventDate: "2026-09-16", retentionEnd: "2031-12-31", fields: { admissionDate: "2026-09-16" } }] });
  assert.match(mtp, /⟦Kept until at least⟧/);
  assert.ok(mtp.includes("2031-12-31"));

  R.state.sub.ndps = "schedx";
  R.state.data = { ok: true, configured: true, retention: "kept", rule65InpatientRegisters: true, withoutParticulars: 1, receiptsOutsideLockAndKey: 1,
    pages: [{ drug: "Pentazocine", receipts: [{ date: "2026-09-16", quantity: "10 ampoule", supplierName: "Pharma", missing: [], lockAndKey: false }], supplies: [{ date: "2026-09-16", quantity: "1 ampoule", patientId: "p1", patientName: "A B", dispenseId: "d1", particulars: null }] }] };
  const x = R.rule65Html({ ...xx.c, can: (cap) => cap === "register.ndps" });
  assert.ok(x.includes('data-rg="schedx"'));
  assert.deepEqual(leftovers(x, ["Pentazocine", "kept", "10 ampoule", "1 ampoule", "Pharma", "A B", "2026-09-16"]), []);
  R.state.ndpsPatient = "p1";
  R.state.data = { ok: true, readOnly: true, supplies: [{ at: "2026-09-16T10:00:00Z", drug: "Morphine", quantity: "2 ampoule", state: "returned" }], doses: [] };
  assert.deepEqual(leftovers(R.ndpsPatientHtml(xx.c), ["2026-09-16 10:00 Morphine 2 ampoule", "p1"]), []);

  xx.R.state.settings = { ok: true, settings: registerSettings(null), notes: NOTES };
  R.settingsHtml(xx.c);
  doc.getElementById("rgS_stateFormat").value = "kerala";
  doc.getElementById("rgS_restricted").value = "mlo@hospital.test\n";
  doc.getElementById("rgS_regimes").value = "Alprazolam | schedule-h1";
  doc.getElementById("rgS_rule65").checked = false;
  doc.getElementById("rgS_xLocations").value = "CD cupboard";
  const s = R.readSettings();
  assert.equal(s.mlc.stateFormat, "kerala");
  assert.deepEqual(s.mlc.restrictedReaders, ["mlo@hospital.test"]);
  assert.deepEqual(s.ndps.drugRegimes, [{ drug: "Alprazolam", regime: "schedule-h1" }]);
  assert.equal(s.ndps.rule65InpatientRegisters, false);
  assert.deepEqual(s.ndps.scheduleXLocations, ["CD cupboard"]);
});

test("the page reaches every register door and the settings route", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../wardsynq/site/pages/registers.js", import.meta.url), "utf8");
  for (const route of ["/org/register-settings", "/ward/register-ndps", "/ward/register-formf", "/ward/register-mtp", "/ward/register-mlc", "/ward/register-vital", "/ward/register-mccd", "/ward/stock-move", "view=annual", "view=form3e", "format=monthly", "format=print", "format=form2",
    "&view=", "view=patient", "format=kerala", "requisitionFrom", "form3hclose", "schedxsupply", "homecare"]) assert.ok(page.includes(route), route);
});
