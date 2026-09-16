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
  xx.R.state.data = { ok: true, entries: [], incomplete: 3, centre: [{ kind: "r17-notice" }], onlinePortal: { mandatory: true, state: "Odisha" } };
  const html = xx.R.statusHtml(xx.c, "formf");
  assert.deepEqual(leftovers(html, ["Odisha"]), []);
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
  assert.match(html, /⟦Chief Medical Officer of the District⟧/);
  const { doc, R } = xx;
  doc.getElementById("rgS_f2Day").value = "10";
  doc.getElementById("rgS_f2Recipient").value = "state";
  doc.getElementById("rgS_rmiNo").value = "RMI/7";
  doc.getElementById("rgS_rmiExpires").value = "2027-01-31";
  doc.getElementById("rgS_doctors").value = "Dr P | KMC 1 | yes | 2026-01-01\nDr Q | KMC 2 |  |";
  doc.getElementById("rgS_witness").checked = false;
  const s = R.readSettings();
  assert.equal(s.mtp.formIIDueDay, 10);
  assert.equal(s.mtp.formIIRecipient, "state");
  assert.equal(s.ndps.requireWitness, false);
  assert.deepEqual(s.ndps.rmi.designatedDoctors, [{ name: "Dr P", registrationNo: "KMC 1", overallInCharge: true, from: "2026-01-01" }, { name: "Dr Q", registrationNo: "KMC 2", overallInCharge: false, from: "" }]);
  xx.R.state.settings = false;
  assert.match(R.settingsHtml(xx.c), /Do not read this as the defaults/);
});

test("the page reaches every register door and the settings route", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../wardsynq/site/pages/registers.js", import.meta.url), "utf8");
  for (const route of ["/org/register-settings", "/ward/register-ndps", "/ward/register-formf", "/ward/register-mtp", "/ward/register-mlc", "/ward/register-vital", "/ward/register-mccd", "/ward/stock-move", "view=annual", "view=form3e", "format=monthly", "format=print", "format=form2"]) assert.ok(page.includes(route), route);
});
