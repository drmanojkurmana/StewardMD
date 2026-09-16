/* test/wardsynq-register-settings.test.mjs - the statutory registers' settings and clocks (register-settings.js) and the
 * pure rules the legal review of 2026-09-17 added to registers.js and register-routes.js.
 *
 * node --test test/wardsynq-register-settings.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettings, validateRegisterSettings, formFMonthlyClock, mtpFormIIClock, rbdClock, ndpsAnnualClocks, rmiStatus, pcpndtCentreAlerts } from "../functions/_wardsynq/register-settings.js";
import { validateFields, rule4AAllowed, mlcClocks, mtpFormII, csvFor, FOETAL_DEATH_CAUSES } from "../functions/_wardsynq/registers.js";
import { mtpEpisodes, maskMtpNames } from "../functions/_wardsynq/register-routes.js";

test("defaults are the safest reading: Form II by the 7th with the annex, every MLC category intimated, 2024 RBD forms, ICD-10 optional, witness on; online Form F, MedLEaPR and the Form II recipient are no longer settings", () => {
  const s = registerSettings({ registers: { pcpndt: { onlinePortal: { mandatory: true, state: "Odisha" } }, mtp: { formIIRecipient: "district" }, mlc: { medleapr: { enabled: true } } } });
  assert.equal(s.mtp.formIIRecipient, undefined, "owner's legal guidance 2026-09-17: the recipient is the Chief Medical Officer of the State, not a setting");
  assert.equal(s.pcpndt.onlinePortal, undefined, "online Form F is per State/UT configuration (legal-requirements.js)");
  assert.equal(s.mlc.medleapr, undefined, "MedLEaPR is per State/UT configuration (legal-requirements.js)");
  assert.equal(s.mtp.formIIDueDay, 7);
  assert.equal(s.mtp.formIIOver20Annex, true);
  assert.equal(s.pcpndt.formGVersion, "1996");
  assert.equal(s.mlc.intimationCategories.length, 16);
  assert.equal(s.rbd.formVersion, "model-2024");
  assert.equal(s.mccd.requireIcd10, false);
  assert.equal(s.ndps.requireWitness, true);
});

test("validateRegisterSettings refuses a Form 3G valid for more than three years, two over-all in-charges and a bad date", () => {
  const { problems } = validateRegisterSettings({
    ndps: { rmi: { form3gNumber: "RMI/1", issuedOn: "2025-01-01", expiresOn: "2029-01-02", designatedDoctors: [{ name: "A", overallInCharge: true }, { name: "B", overallInCharge: true }], changes: [{ changedOn: "01-02-2026" }] } },
    mtp: { formIIDueDay: 31 },
  });
  for (const re of [/three years/, /one over-all in-charge/, /changedOn: a date/, /formIIDueDay/]) assert.ok(problems.some((p) => re.test(p)), re + " in " + problems.join(" | "));
  assert.deepEqual(validateRegisterSettings({ mtp: { formIIDueDay: 5 } }).problems, []);
});

test("PCPNDT r.9(8): the monthly report is due by the 5th, escalated on the 3rd, overdue after", () => {
  assert.equal(formFMonthlyClock("2026-08", "2026-08-20").state, "open");
  assert.equal(formFMonthlyClock("2026-08", "2026-09-02").state, "due");
  assert.equal(formFMonthlyClock("2026-08", "2026-09-03").state, "escalate");
  assert.deepEqual(formFMonthlyClock("2026-08", "2026-09-07"), { period: "2026-08", dueBy: "2026-09-05", state: "overdue", daysOverdue: 2 });
  assert.equal(formFMonthlyClock("2026-12", "2027-01-04").dueBy, "2027-01-05");
  assert.equal(formFMonthlyClock("2026-08", "2026-09-09", "2026-09-06").state, "submitted-late");
  assert.equal(mtpFormIIClock("2026-08", registerSettings({ registers: { mtp: { formIIDueDay: 10 } } }), "2026-09-09").state, "due");
});

test("RBD r.5(3): 21 days, an alert from day 14, and after day 30 the District Registrar's permission (s.13)", () => {
  assert.equal(rbdClock("2026-09-01", "2026-09-10").state, "due");
  assert.equal(rbdClock("2026-09-01", "2026-09-15").state, "alert");
  assert.equal(rbdClock("2026-09-01", "2026-09-25").state, "overdue");
  assert.equal(rbdClock("2026-09-01", "2026-10-05").state, "late-permission");
  assert.equal(rbdClock("2026-09-01", "2026-10-05", "2026-09-20").state, "submitted");
  assert.equal(rbdClock("2026-09-01", "2026-09-10").dueBy, "2026-09-22");
});

test("NDPS: Form 3J by 30 November of the preceding year, Form 3-I by 31 March; recognition renewal 60 days ahead, expiry blocks unless renewal applied for", () => {
  const [j, i] = ndpsAnnualClocks("2026-11-15", {});
  assert.deepEqual([j.what, j.year, j.dueBy, j.state], ["form3j", 2027, "2026-11-30", "due-soon"]);
  assert.deepEqual([i.what, i.year, i.dueBy, i.state], ["form3i", 2025, "2026-03-31", "overdue"]);
  assert.equal(ndpsAnnualClocks("2026-11-15", { "form3i-2025": "2026-03-20" })[1].state, "submitted");
  const rmi = (x) => registerSettings({ registers: { ndps: { rmi: { form3gNumber: "RMI/7", issuedOn: "2024-01-01", designatedDoctors: [{ name: "Dr P", overallInCharge: true }], ...x } } } });
  assert.equal(rmiStatus(registerSettings(null), "2026-09-17").configured, false);
  assert.deepEqual(rmiStatus(rmi({ expiresOn: "2026-10-01" }), "2026-09-17").alerts.map((a) => a.kind), ["rmi-renewal-due"]);
  assert.equal(rmiStatus(rmi({ expiresOn: "2026-09-01" }), "2026-09-17").blocked, true);
  assert.equal(rmiStatus(rmi({ expiresOn: "2026-09-01", renewalApplicationRef: "CD/REN/44" }), "2026-09-17").blocked, false);
  const ch = rmiStatus(rmi({ expiresOn: "2027-12-31", changes: [{ kind: "designated-doctor", changedOn: "2026-09-01" }] }), "2026-09-17").alerts[0];
  assert.deepEqual([ch.kind, ch.dueBy, ch.overdue], ["rmi-doctor-intimation", "2026-09-08", true]);
});

test("PCPNDT centre panel: Form B renewal 30 days ahead, r.13 changes intimated 30 days before, r.17 notice and copies", () => {
  const s = registerSettings({ registers: { pcpndt: { centre: { formBNumber: "PNDT/9", formBValidUntil: "2026-10-01", plannedChanges: [{ what: "New ultrasound machine", effectiveOn: "2026-10-10" }], r17NoticeDisplayed: true } } } });
  const kinds = pcpndtCentreAlerts(s, "2026-09-17").map((a) => a.kind);
  assert.deepEqual(kinds, ["formb-renewal-due", "r13-change-intimation", "r17-copies"]);
  assert.equal(pcpndtCentreAlerts(s, "2026-09-17")[1].overdue, true, "30 days before 10 October was 10 September");
});

test("MTP rule 4A: which rule 4 clause may terminate at what gestation by what method", () => {
  assert.deepEqual(rule4AAllowed(8, "medical"), ["a", "b", "c", "ca", "d"]);
  assert.deepEqual(rule4AAllowed(10, "medical"), ["a", "b", "c", "d"]);
  assert.deepEqual(rule4AAllowed(12, "surgical"), ["a", "b", "c", "d"]);
  assert.deepEqual(rule4AAllowed(16, "surgical"), ["a", "b", "d"]);
  const v = validateFields("mtp", { admissionDate: "2026-09-01", patientName: "X Y", age: 25, religion: "hindu", address: "A", gestationWeeks: 10, reasons: ["contraceptive-failure"],
    opinionRmp1: "Dr A", opinionRmp1Clause: "ca", method: "medical", terminationDate: "2026-09-01", terminationTime: "10:00", terminatedBy: "Dr A", terminatedByClause: "ca",
    mentallyIll: "no", consentBy: "woman", consentDate: "2026-09-01", opinionCertified: "Dr A" });
  assert.ok(v.problems.some((p) => /rule 4\(ca\) may not perform a medical termination at 10 weeks/.test(p)), v.problems.join(" | "));
});

test("MTP Form II: the 2003 columns up to 20 weeks, the rest in a labelled annex, or omitted and said so", () => {
  const e = (w, extra) => ({ fields: { terminationDate: "2026-09-02", gestationWeeks: w, religion: "hindu", reasons: ["rape"], ...extra } });
  const rows = [e(8), e(18), e(22), e(26), e(30, { emergencySection5: "yes" })];
  const on = mtpFormII(rows, "H", "S", registerSettings(null));
  assert.equal(on.statement["4(e). Total"], 2);
  assert.equal(on.annex["Over 20 and up to 24 weeks"], 1);
  assert.equal(on.annex["Over 24 weeks (Medical Board, Form D)"], 2);
  assert.equal(on.annex["Under section 5 (immediately necessary to save life)"], 1);
  const off = mtpFormII(rows, "H", "S", registerSettings({ registers: { mtp: { formIIOver20Annex: false } } }));
  assert.equal(off.annex, undefined);
  assert.match(off.annexOmitted, /^3 termination/);
});

test("MLC clocks: POCSO report in 24 hours (r.6(5)), the IO report in 7 days (BNSS s.184(6)), police intimation pending, inquest papers", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const pocso = mlcClocks({ fields: { status: "open", category: "pocso", arrivalAt: "2026-09-16T06:00:00Z", consentBy: "guardian", examEndAt: "2026-09-16T08:00:00Z" } }, now, registerSettings(null));
  assert.deepEqual(pocso.map((c) => [c.kind, c.state]), [["police-intimation", "pending"], ["pocso-report", "overdue"], ["io-report", "due"]]);
  assert.equal(pocso[2].dueBy, "2026-09-23T08:00:00.000Z");
  assert.deepEqual(mlcClocks({ fields: { status: "open", category: "death-in-custody", arrivalAt: "2026-09-17T06:00:00Z", intimationAt: "2026-09-17T06:10:00Z" } }, now).map((c) => c.kind), ["inquest-papers"]);
  assert.deepEqual(mlcClocks({ fields: { status: "closed", category: "pocso" } }, now), []);
});

test("RBD forms: no Aadhaar, no abbreviations, the 18 causes of foetal death, Form 4A has no manner of death, a mode of dying warns", () => {
  assert.equal(FOETAL_DEATH_CAUSES.length, 18);
  assert.equal(FOETAL_DEATH_CAUSES[17][1], "18. Not stated");
  assert.ok(validateFields("birth", { motherAadhaar: "123412341234" }).problems.some((p) => /motherAadhaar: not a field/.test(p)));
  assert.ok(validateFields("birth", { remarks: "Aadhaar 1234 5678 9012" }).problems.some((p) => /Aadhaar numbers are not stored/.test(p)));
  assert.equal(validateFields("birth", { motherMobile: "919876543210" }).problems.length, 0, "a mobile number is not refused");
  assert.ok(validateFields("death", { deceasedName: { first: "R.", last: "Kumar" } }).problems.some((p) => /abbreviations/.test(p)));
  assert.ok(validateFields("stillbirth", { causeOfFoetalDeath: "19" }).problems.some((p) => /causeOfFoetalDeath/.test(p)));
  const csv = csvFor("stillbirth", [{ id: "x", version: 1, fields: { causeOfFoetalDeath: "7", clinicalNote: "internal only" } }]);
  assert.ok(csv.includes("7. Diabetes in the mother") && !csv.includes("internal only") && !csv.includes("Clinical note"), "the coded label is exported, the hospital's note never is");
  const base = { dateOfDeath: "2026-09-01", sex: "male", ageValue: 70, ageUnit: "years", causeIa: "Old age", certifier: "Dr A", verifiedOn: "2026-09-01", copyGivenToName: "B", copyGivenToRelation: "Son", copyGivenOn: "2026-09-02" };
  const a4 = validateFields("mccd", { ...base, form: "4A", attendedFrom: "2026-08-01", attendedTo: "2026-09-01", mannerOfDeath: "natural" });
  assert.ok(a4.problems.some((p) => /Form No. 4A has no manner of death/.test(p)));
  const ok4a = validateFields("mccd", { ...base, form: "4A", attendedFrom: "2026-08-01", attendedTo: "2026-09-01" });
  assert.deepEqual([ok4a.problems, ok4a.missing], [[], []], "4A complete without a manner of death or an ICD-10 code");
  assert.match(ok4a.warnings[0], /mode of dying/);
  assert.ok(validateFields("mccd", { ...base, form: "4" }).missing.includes("mannerOfDeath"));
  assert.ok(validateFields("mccd", { ...base, form: "4", mannerOfDeath: "natural" }, null, { settings: registerSettings({ registers: { mccd: { requireIcd10: true } } }) }).missing.includes("underlyingIcd10"));
  const addr = { townVillage: "V", district: "D", state: "S" };
  assert.ok(validateFields("death", { addressAtDeath: addr }).missing.includes("addressAtDeath.pin"), "the 2024 forms need the whole address");
  assert.ok(!validateFields("death", { addressAtDeath: addr }, null, { settings: registerSettings({ registers: { rbd: { formVersion: "model-1999" } } }) }).missing.some((m) => m.startsWith("addressAtDeath")));
});

test("MTP reg 7: the serial replaces her name on rows of the episode's stay and her Patient record; another stay and another patient keep theirs", () => {
  const eps = mtpEpisodes([{ patientId: "p1", encounterId: "e1", serial: "3/2026", fields: { admissionDate: "2026-09-10" } },
    { patientId: "p9", encounterId: "e9", serial: "1/2026", fields: { admissionDate: "2026-01-02", dischargeDate: "2026-01-03" } }], "2026-09-17");
  assert.deepEqual([...eps.keys()], ["p1"], "an episode ends 42 days after discharge");
  const out = maskMtpNames({ ok: true, patients: [{ patientId: "p1", encounterId: "e1", name: "Asha Rao" }, { patientId: "p1", encounterId: "e0", name: "Asha Rao" }, { patientId: "p2", name: "Bina" }],
    patient: { name: "Asha Rao" }, patientId: "p1", roster: [{ resourceType: "Patient", id: "p1", name: "Asha Rao", display: "Asha Rao" }], drug: { patientId: "p1", encounterId: "e1", name: "Asha Rao", items: [{ name: "Ramipril" }] } }, eps);
  assert.equal(out.patients[0].name, "3/2026");
  assert.equal(out.patients[0].nameWithheld, "MTP Regulations 2003 reg 7");
  assert.equal(out.patients[1].name, "Asha Rao", "a different stay");
  assert.equal(out.patients[2].name, "Bina");
  assert.equal(out.patient.name, "3/2026");
  assert.deepEqual([out.roster[0].name, out.roster[0].display], ["3/2026", "3/2026"]);
  assert.equal(out.drug.items[0].name, "Ramipril", "a child object that is not the patient keeps its name");
});
