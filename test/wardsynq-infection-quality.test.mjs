/* test/wardsynq-infection-quality.test.mjs - P5 infection-ams-quality: HAI cases confirmed by infection control against
 * CDC/NHSN, device-days, surgical prophylaxis review, the CLSI M39 antibiogram, audit checklists, mock drills, emergency
 * medicine stock-outs, PvPI ADR reports, emergency returns within 72 hours, and the NABH indicators they fill.
 *
 * Routes (the real router, ops harness): GET /api/queue/ward/infection-control, POST /ward/hai-case,
 * POST /ward/surgical-prophylaxis, GET /ward/antibiogram, GET /ward/quality-registers, POST /ward/audit-template,
 * POST /ward/quality-audit, POST /ward/mock-drill, POST /ward/adr-report, GET /ward/emergency-stock, POST /ward/stock-out,
 * POST /ward/stock-out-restore, GET /ward/ed-returns, POST /ward/ed-return-review.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-infection-quality.test.mjs
 */
import { as, seedHospital, recordsOf, auditsOf, H, TENANT, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceDays, deviceEligibility, ssiEligibility, computeAntibiogram, prophylaxisDoses, prophylaxisAppropriate, HAI_EVENTS } from "../functions/_wardsynq/infection-control.js";
import { scoreAudit, normaliseTemplate, edReturnPairs, normaliseAdr, auditSummary } from "../functions/_wardsynq/quality-registers.js";
// Imported after the harness: compliance.js now reaches Firestore through discharge-milestones.js, so a static import would bind the real module before the mock.
const { computeNabhIndicators, monthWindows } = await import("../functions/_wardsynq/compliance.js");

const IST = 330 * 60000;
const AUG = { month: "2026-08", fromMs: Date.UTC(2026, 7, 1) - IST, toMs: Date.UTC(2026, 8, 1) - IST - 1, offsetMs: IST, nowMs: Date.UTC(2026, 8, 20) };

/* ---------------------------------------------------------------- pure */

test("device-days count only between insertion and removal, one per patient per calendar day, never past now", () => {
  const lines = [
    { patientId: "p1", deviceClass: "central-line", insertedAt: "2026-08-03T20:00:00Z", removedAt: "2026-08-06T03:00:00Z" }, // IST 4 Aug 01:30 to 6 Aug 08:30: days 4, 5, 6
    { patientId: "p1", deviceClass: "central-line", insertedAt: "2026-08-05T05:00:00Z", removedAt: null },                    // second line, same patient: 5..now
    { patientId: "p2", deviceClass: "urinary-catheter", insertedAt: "2026-07-30T05:00:00Z", removedAt: "2026-08-02T05:00:00Z" },
    { patientId: "p3", deviceClass: null, insertedAt: "2026-08-01T05:00:00Z" },
  ];
  assert.equal(deviceDays(lines, "central-line", AUG.fromMs, AUG.toMs, IST, Date.UTC(2026, 7, 10, 6)), 7, "4 to 10 August for p1, the overlap counted once");
  assert.equal(deviceDays(lines, "urinary-catheter", AUG.fromMs, AUG.toMs, IST, AUG.nowMs), 2, "1 and 2 August; July days are outside the month");
  assert.equal(deviceDays(lines, "ventilator", AUG.fromMs, AUG.toMs, IST, AUG.nowMs), 0);
  assert.equal(deviceDays([{ patientId: "p9", deviceClass: "ventilator", insertedAt: "2026-09-25T05:00:00Z" }], "ventilator", Date.UTC(2026, 8, 1) - IST, Date.UTC(2026, 9, 1) - IST - 1, IST, Date.UTC(2026, 8, 20)), 0, "a line placed after now adds nothing");
});

test("NHSN device eligibility and SSI surveillance period are arithmetic shown to the nurse, not a diagnosis", () => {
  const line = { insertedAt: "2026-08-01T05:00:00Z", removedAt: "2026-08-07T05:00:00Z" };
  assert.equal(deviceEligibility(line, "2026-08-02", IST).eligible, false, "day 2 is not more than two days");
  const d3 = deviceEligibility(line, "2026-08-03", IST);
  assert.equal(d3.deviceDay, 3); assert.equal(d3.eligible, true);
  assert.equal(deviceEligibility(line, "2026-08-08", IST).eligible, true, "the day after removal is still eligible");
  assert.equal(deviceEligibility(line, "2026-08-09", IST).eligible, false);
  const op = { incisionAt: "2026-08-10T06:00:00Z" };
  assert.equal(ssiEligibility(op, "2026-09-08", "superficial-incisional", null, IST).postOpDay, 30);
  assert.equal(ssiEligibility(op, "2026-09-09", "superficial-incisional", null, IST).eligible, false);
  assert.equal(ssiEligibility(op, "2026-10-20", "organ-space", 90, IST).eligible, true);
  for (const e of Object.values(HAI_EVENTS)) assert.ok(e.criteria.length && /NHSN Patient Safety Component Manual, January 2026/.test(e.source));
});

test("antibiogram (CLSI M39): first isolate per patient per species, below the minimum is insufficient not a percentage, %S without I", () => {
  const rep = (patientId, day, organisms, status) => ({ category: "microbiology", status: status || "final", patientId, collectedAt: `2026-08-${day}T05:00:00Z`, organisms });
  const ec = (res) => [{ name: "Escherichia coli", susceptibilities: [{ antibiotic: "Ceftriaxone", result: res }, { antibiotic: "Meropenem", result: "S" }] }];
  const reports = [
    rep("p1", "02", ec("R")), rep("p1", "09", ec("S")), // same patient, same species: the later one is a duplicate
    rep("p2", "03", ec("S")), rep("p3", "04", ec("I")),
    rep("p4", "05", [{ name: "Klebsiella pneumoniae", susceptibilities: [{ antibiotic: "Meropenem", result: "R" }] }]),
    rep("p5", "06", ec("S"), "preliminary"), // not final: excluded
  ];
  const ab = computeAntibiogram(reports, { fromMs: AUG.fromMs, toMs: AUG.toMs, minIsolates: 3 });
  assert.equal(ab.duplicatesExcluded, 1);
  assert.equal(ab.firstIsolates, 4);
  const e = ab.organisms.find((o) => o.organism === "Escherichia coli");
  assert.equal(e.isolates, 3);
  const cro = e.antibiotics.find((a) => a.antibiotic === "Ceftriaxone");
  assert.equal(cro.tested, 3); assert.equal(cro.percentSusceptible, 33, "the first p1 isolate (R) counts, the later S does not; I is not susceptible");
  const k = ab.organisms.find((o) => o.organism === "Klebsiella pneumoniae");
  assert.equal(k.insufficient, true); assert.deepEqual(k.antibiotics, [], "one isolate: insufficient, no percentage");
  assert.equal(computeAntibiogram(reports, { fromMs: AUG.fromMs, toMs: AUG.toMs }).computable, false, "no minimum configured, no antibiogram");
});

test("prophylaxis: a dose in the window when indicated and per policy is appropriate; a dose when not indicated is not", () => {
  const found = prophylaxisDoses({ incisionAt: "2026-08-10T06:00:00Z", patientId: "p1", antibiotics: ["Cefazolin"], windowMinutes: 60,
    administrations: [{ patientId: "p1", status: "administered", drug: "Cefazolin 1 g", administeredAt: "2026-08-10T05:30:00Z" }, { patientId: "p1", status: "administered", drug: "Paracetamol", administeredAt: "2026-08-10T05:40:00Z" }, { patientId: "p2", status: "administered", drug: "Cefazolin", administeredAt: "2026-08-10T05:40:00Z" }],
    anaesthesiaEvents: [{ drug: "Cefazolin", at: "2026-08-10T03:00:00Z" }] });
  assert.equal(found.doses.length, 2, "listed antibiotics for this patient only");
  assert.equal(found.inWindow.length, 1, "the anaesthesia dose 3 hours before is outside a 60 minute window");
  assert.equal(prophylaxisAppropriate(true, "yes", 1), true);
  assert.equal(prophylaxisAppropriate(true, "no", 1), false);
  assert.equal(prophylaxisAppropriate(true, "yes", 0), false);
  assert.equal(prophylaxisAppropriate(false, "not-applicable", 0), true);
  assert.equal(prophylaxisAppropriate(false, "not-applicable", 1), false);
});

test("audits, drills, returns and ADR forms: every item answered, compliance from no, 72 hours from leaving, PvPI seriousness", () => {
  const t = normaliseTemplate({ name: "WHO moments", kind: "hand-hygiene", items: ["Hand rub or wash before patient contact", "Glove use appropriate"] }).template;
  assert.deepEqual(t.items.map((i) => i.id), ["i1", "i2"]);
  assert.equal(scoreAudit(t, { i1: "yes" }).error, "answer_every_item");
  assert.equal(scoreAudit(t, { i1: "na", i2: "na" }).error, "nothing_observed");
  assert.equal(scoreAudit(t, { i1: "yes", i2: "na" }).compliant, true);
  assert.equal(scoreAudit(t, { i1: "no", i2: "yes" }).compliant, false);
  const edited = normaliseTemplate({ name: "WHO moments", kind: "hand-hygiene", items: [{ id: "i2", text: "Glove use appropriate" }, "New item"] }, t).template;
  assert.deepEqual(edited.items.map((i) => i.id), ["i2", "i3"], "a kept item keeps its id; a new one never reuses a retired id");
  const s = auditSummary([{ kind: "handover", at: "2026-08-05T05:00:00Z", compliant: true }, { kind: "handover", at: "2026-08-06T05:00:00Z", compliant: false }, { kind: "handover", at: "2026-07-06T05:00:00Z", compliant: true }], AUG);
  assert.deepEqual(s.handover, { audited: 2, compliant: 1 });
  const enc = [
    { id: "e1", class: "ED", patientId: "p1", periodStart: "2026-08-01T05:00:00Z", periodEnd: "2026-08-01T09:00:00Z", reason: "chest pain" },
    { id: "e2", class: "ED", patientId: "p1", periodStart: "2026-08-04T08:00:00Z", reason: "chest pain again" },
    { id: "e3", class: "ED", patientId: "p1", periodStart: "2026-08-10T08:00:00Z" },
  ];
  const pairs = edReturnPairs(enc, AUG);
  assert.deepEqual(pairs.map((p) => [p.encounterId, p.prior.encounterId]), [["e2", "e1"]], "71 hours after leaving is a return; six days is not");
  assert.equal(normaliseAdr({ reaction: { description: "Rash", startDate: "2026-08-02", serious: true, seriousCriteria: [], outcome: "recovered" }, medicines: [{ name: "Amoxicillin" }] }).error, "seriousness_criterion_required");
  assert.equal(normaliseAdr({ reaction: { description: "Rash", startDate: "2026-08-02", serious: false, outcome: "recovered" }, medicines: [] }).error, "medicine_required");
  assert.ok(normaliseAdr({ reaction: { description: "Rash", startDate: "2026-08-02", serious: false, outcome: "recovering" }, medicines: [{ name: "Amoxicillin", actionTaken: "withdrawn", reappeared: "not-reintroduced" }] }).adr);
});

/* ---------------------------------------------------------------- through the router */

const META = () => { const at = new Date().toISOString(); return { meta: { recordedAt: at }, writtenBy: { id: "seed", kind: "human", at } }; };
const P1 = "opd-pat-mrn-100", P2 = "opd-pat-mrn-200";
async function setup() {
  seedHospital();
  const s = await as(U.ADMIN, "/org/clinical-settings", "POST", { orgId: ORG, settings: { antibiotics: ["Cefazolin"], prophylaxisWindowMinutes: 60, antibiogramMinIsolates: 2, emergencyMedicines: ["Adrenaline", "Atropine"] } });
  assert.equal(s.__status, 200, JSON.stringify(s));
  await H.RECORD.append(TENANT, [
    { resourceType: "Patient", id: P1, version: 1, mrn: "MRN-100", name: "Asha Rao", dob: "1970-01-01", sex: "female", ...META() },
    { resourceType: "Patient", id: P2, version: 1, mrn: "MRN-200", name: "Ravi Kumar", dob: "1965-01-01", sex: "male", ...META() },
    { resourceType: "Encounter", id: "enc-ip-1", version: 1, patientId: P1, class: "IPD", status: "in-progress", periodStart: "2026-07-30T05:00:00Z", periodEnd: null, ...META() },
    { resourceType: "Encounter", id: "enc-ed-1", version: 1, patientId: P2, class: "ED", status: "finished", periodStart: "2026-08-01T05:00:00Z", periodEnd: "2026-08-01T09:00:00Z", reason: "abdominal pain", ...META() },
    { resourceType: "Encounter", id: "enc-ed-2", version: 1, patientId: P2, class: "ED", status: "finished", periodStart: "2026-08-03T05:00:00Z", periodEnd: "2026-08-03T09:00:00Z", reason: "abdominal pain, vomiting", ...META() },
    { resourceType: "SurgicalCase", id: "case-p2-1", version: 1, patientId: P2, procedure: "Appendicectomy", incisionAt: "2026-08-10T06:00:00Z", signIn: {}, timeOut: {}, signOut: {}, ...META() },
    { resourceType: "MedicationAdministration", id: "ma-1", version: 1, patientId: P2, drug: "Cefazolin 1 g IV", status: "administered", administeredAt: "2026-08-10T05:30:00Z", ...META() },
  ]);
  const line = await as(U.DOCTOR, "/ward/line", "POST", { orgId: ORG, encounterId: "enc-ip-1", patientId: P1, line: { type: "CVC", site: "Right IJ", deviceClass: "central-line", insertedAt: "2026-08-01T05:00:00Z" } });
  assert.equal(line.__status, 200, JSON.stringify(line));
  return { lineId: line.lineId };
}

test("POST /api/queue/ward/hai-case and GET /ward/infection-control: 401, 403 for a doctor, nurse and another hospital with nothing written; the infection control nurse opens and confirms", async () => {
  const { lineId } = await setup();
  const open = { orgId: ORG, action: "open", patientId: P1, event: "CLABSI", dateOfEvent: "2026-08-05", lineId };
  assert.equal((await as(null, "/ward/hai-case", "POST", open)).__status, 401);
  assert.equal((await as(U.DOCTOR, "/ward/hai-case", "POST", open)).__status, 403, "a treating doctor does not confirm HAIs");
  assert.equal((await as(U.NURSE, "/ward/hai-case", "POST", open)).__status, 403);
  assert.equal((await as(U.ICN, "/ward/hai-case", "POST", { ...open, orgId: ORG2 })).__status, 403);
  assert.equal((await as(null, `/ward/infection-control?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.NURSE, `/ward/infection-control?orgId=${ORG}&month=2026-08`)).__status, 403);
  assert.equal((await as(U.ICN, `/ward/infection-control?orgId=${ORG2}&month=2026-08`)).__status, 403);

  // Reading the screen with an eligible line and nothing else creates no case: nothing auto-diagnoses.
  let view = await as(U.ICN, `/ward/infection-control?orgId=${ORG}&month=2026-08`);
  assert.equal(view.__status, 200, JSON.stringify(view));
  assert.equal((await recordsOf("HaiCase")).length, 0, "nothing written by refused calls or by reading");
  assert.deepEqual(view.cases, []);
  assert.equal(view.rates.find((x) => x.event === "CLABSI").denominator, 31, "an open central line all August");
  assert.equal(view.lines[0].lineId, lineId);
  assert.equal(view.patients[P1].mrn, "MRN-100");

  const wrongDevice = await as(U.ICN, "/ward/hai-case", "POST", { ...open, event: "CAUTI" });
  assert.equal(wrongDevice.error, "wrong_device_class");
  const r = await as(U.ICN, "/ward/hai-case", "POST", open);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.status, "under-review");
  assert.equal(r.eligibility.deviceDay, 5); assert.equal(r.eligibility.eligible, true);
  const noCrit = await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "confirm", caseId: r.caseId, criteriaMet: ["PNU1"] });
  assert.equal(noCrit.error, "unknown_criteria", "a CLABSI is confirmed against a bloodstream infection criterion");
  const c = await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "confirm", caseId: r.caseId, criteriaMet: ["LCBI 1"], organisms: ["Klebsiella pneumoniae"] });
  assert.equal(c.__status, 200, JSON.stringify(c));
  assert.equal((await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "rule-out", caseId: r.caseId, reason: "changed mind" })).error, "not_under_review");
  assert.ok(auditsOf("HaiCase").length >= 2, "case writes are audited");
  const hist = await H.RECORD.history(TENANT, "HaiCase", r.caseId);
  assert.deepEqual(hist.map((h) => h.status), ["under-review", "confirmed"], "append-only: the review stays readable beside the confirmation");
  view = await as(U.ICN, `/ward/infection-control?orgId=${ORG}&month=2026-08`);
  const rate = view.rates.find((x) => x.event === "CLABSI");
  assert.equal(rate.numerator, 1); assert.equal(rate.value, 32.26);

  // An ineligible date needs the nurse's written reason to confirm.
  const early = await as(U.ICN, "/ward/hai-case", "POST", { ...open, dateOfEvent: "2026-08-02" });
  assert.equal(early.eligibility.eligible, false);
  const refused = await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "confirm", caseId: early.caseId, criteriaMet: ["LCBI 2"] });
  assert.equal(refused.error, "eligibility_note_required");
});

test("POST /api/queue/ward/surgical-prophylaxis: 401, 403 for a doctor and another hospital, nothing written; the review stores the doses found and #18 and #16 compute", async () => {
  await setup();
  const body = { orgId: ORG, caseId: "case-p2-1", indicated: true, agentPerPolicy: "yes" };
  assert.equal((await as(null, "/ward/surgical-prophylaxis", "POST", body)).__status, 401);
  assert.equal((await as(U.DOCTOR, "/ward/surgical-prophylaxis", "POST", body)).__status, 403);
  assert.equal((await as(U.ICN, "/ward/surgical-prophylaxis", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("SurgicalProphylaxis")).length, 0);
  const r = await as(U.ICN, "/ward/surgical-prophylaxis", "POST", body);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.appropriate, true); assert.equal(r.dosesInWindow, 1);
  const view = await as(U.ICN, `/ward/infection-control?orgId=${ORG}&month=2026-08`);
  assert.equal(view.prophylaxis[0].review.appropriate, true);

  const ssi = await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "open", patientId: P2, event: "SSI", dateOfEvent: "2026-08-20", surgicalCaseId: "case-p2-1", ssiDepth: "deep-incisional" });
  assert.equal(ssi.error, "surveillance_days_required");
  const ok = await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "open", patientId: P2, event: "SSI", dateOfEvent: "2026-08-20", surgicalCaseId: "case-p2-1", ssiDepth: "deep-incisional", surveillanceDays: 30 });
  assert.equal(ok.eligibility.postOpDay, 11);
  await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "confirm", caseId: ok.caseId, criteriaMet: ["Deep incisional SSI"] });

  const rows = {};
  for (const t of ["HaiCase", "LineRecord", "SurgicalCase", "SurgicalProphylaxis"]) rows[t] = await recordsOf(t);
  const nabh = computeNabhIndicators({ rows, unreadable: {}, windows: monthWindows(Date.UTC(2026, 8, 20), 2, 330) });
  const aug = (no) => nabh.find((i) => i.no === no).months.find((m) => m.month === "2026-08");
  assert.deepEqual([aug(18).numerator, aug(18).denominator, aug(18).value, aug(18).unreviewed], [1, 1, 100, 0]);
  assert.deepEqual([aug(16).numerator, aug(16).denominator], [1, 1]);
  assert.deepEqual([aug(15).numerator, aug(15).denominator], [0, 31], "no CLABSI confirmed in this test");
});

test("GET /api/queue/ward/antibiogram: 401, 403 for a nurse and another hospital; infection control and the laboratory read it", async () => {
  await setup();
  const q = `/ward/antibiogram?orgId=${ORG}&from=2026-08-01&to=2026-08-31`;
  assert.equal((await as(null, q)).__status, 401);
  assert.equal((await as(U.NURSE, q)).__status, 403);
  assert.equal((await as(U.ICN, `/ward/antibiogram?orgId=${ORG2}&from=2026-08-01&to=2026-08-31`)).__status, 403);
  await H.RECORD.append(TENANT, ["p1", "p2", "p3"].map((p, i) => ({ resourceType: "DiagnosticReport", id: "micro-" + p, version: 1, patientId: p, category: "microbiology", status: "final",
    collectedAt: `2026-08-0${i + 2}T05:00:00Z`, organisms: [{ name: "Escherichia coli", susceptibilities: [{ antibiotic: "Meropenem", result: i ? "S" : "R" }] }], ...META() })));
  const r = await as(U.ICN, q);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.organisms[0].antibiotics[0].percentSusceptible, 67);
  assert.ok(r.dot && r.dot.computable, "days of therapy from quality.js for the same period");
  const lab = await as(U.LAB, q);
  assert.equal(lab.__status, 200, JSON.stringify(lab));
  assert.equal(lab.dot.computable, false, "the laboratory reads cultures, not administrations, and is told so");
});

test("POST /api/queue/ward/audit-template, /ward/quality-audit, /ward/mock-drill and GET /ward/quality-registers: 401, 403 for a nurse and another hospital with nothing written; #17, #25, #27, #31, #32 compute", async () => {
  await setup();
  const tpl = { orgId: ORG, name: "Handover SBAR", kind: "handover", items: ["Situation", "Background", "Assessment", "Recommendation"] };
  assert.equal((await as(null, "/ward/audit-template", "POST", tpl)).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/audit-template", "POST", tpl)).__status, 403);
  assert.equal((await as(U.SAFETY, "/ward/audit-template", "POST", { ...tpl, orgId: ORG2 })).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/mock-drill", "POST", { orgId: ORG, drillType: "Fire", at: "2026-08-05T05:00:00Z", location: "Ward 3", variations: [] })).__status, 403);
  assert.equal((await as(null, `/ward/quality-registers?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.NURSE, `/ward/quality-registers?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(U.SAFETY, `/ward/quality-registers?orgId=${ORG2}`)).__status, 403);
  assert.equal((await recordsOf("QualityAuditTemplate")).length + (await recordsOf("MockDrill")).length, 0);

  const t = await as(U.SAFETY, "/ward/audit-template", "POST", tpl);
  assert.equal(t.__status, 200, JSON.stringify(t));
  assert.equal((await as(U.NURSE, "/ward/quality-audit", "POST", { orgId: ORG, templateId: t.templateId, answers: { i1: "yes", i2: "yes", i3: "yes", i4: "yes" } })).__status, 403);
  const a1 = await as(U.ICN, "/ward/quality-audit", "POST", { orgId: ORG, templateId: t.templateId, at: "2026-08-05T05:00:00Z", unit: "Ward 3", answers: { i1: "yes", i2: "yes", i3: "yes", i4: "yes" } });
  assert.equal(a1.__status, 200, JSON.stringify(a1)); assert.equal(a1.compliant, true);
  const a2 = await as(U.ICN, "/ward/quality-audit", "POST", { orgId: ORG, templateId: t.templateId, at: "2026-08-06T05:00:00Z", answers: { i1: "yes", i2: "no", i3: "yes", i4: "yes" } });
  assert.equal(a2.compliant, false);
  const d = await as(U.SAFETY, "/ward/mock-drill", "POST", { orgId: ORG, drillType: "Code blue", at: "2026-08-07T05:00:00Z", location: "ICU", participants: 8, variations: ["Crash cart key not found", "Defibrillator pads expired"] });
  assert.equal(d.__status, 200, JSON.stringify(d));
  const reg = await as(U.SAFETY, `/ward/quality-registers?orgId=${ORG}&month=2026-08`);
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  assert.deepEqual(reg.summary.handover, { audited: 2, compliant: 1 });
  assert.equal(reg.drills[0].variations.length, 2);
  assert.ok(auditsOf("QualityAudit").length >= 2);

  const rows = {};
  for (const x of ["QualityAudit", "MockDrill", "Encounter"]) rows[x] = await recordsOf(x);
  const nabh = computeNabhIndicators({ rows, unreadable: {}, windows: monthWindows(Date.UTC(2026, 8, 20), 2, 330) });
  const aug = (no) => nabh.find((i) => i.no === no).months.find((m) => m.month === "2026-08");
  assert.deepEqual([aug(31).numerator, aug(31).denominator, aug(31).value], [1, 2, 50]);
  assert.equal(aug(27).value, 2);
  assert.equal(aug(17).value, null, "no hand hygiene audit: no rate, never 0%");
  assert.equal(aug(32).denominator, 0);
});

test("POST /api/queue/ward/adr-report: 401, 403 for a cashier and another hospital with nothing written; a nurse files the PvPI form and #5 computes", async () => {
  await setup();
  const body = { orgId: ORG, mrn: "MRN-100", reaction: { description: "Urticarial rash over trunk", startDate: "2026-08-04", serious: false, outcome: "recovering" },
    medicines: [{ name: "Amoxicillin", dose: "500 mg", route: "oral", frequency: "TDS", actionTaken: "withdrawn", reappeared: "not-reintroduced" }] };
  assert.equal((await as(null, "/ward/adr-report", "POST", body)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/adr-report", "POST", body)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/adr-report", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("AdverseDrugReaction")).length, 0);
  const r = await as(U.NURSE, "/ward/adr-report", "POST", body);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const bad = await as(U.NURSE, "/ward/adr-report", "POST", { ...body, reaction: { ...body.reaction, serious: true } });
  assert.equal(bad.error, "seriousness_criterion_required");
  const reg = await as(U.SAFETY, `/ward/quality-registers?orgId=${ORG}&month=2026-08`);
  assert.equal(reg.adrs.length, 1);
  const rows = { AdverseDrugReaction: await recordsOf("AdverseDrugReaction"), Encounter: await recordsOf("Encounter") };
  const cell = computeNabhIndicators({ rows, unreadable: {}, windows: monthWindows(Date.UTC(2026, 8, 20), 2, 330) }).find((i) => i.no === 5).months.find((m) => m.month === "2026-08");
  assert.deepEqual([cell.numerator, cell.denominator, cell.value], [1, 1, 100]);
});

test("GET /api/queue/ward/emergency-stock, POST /ward/stock-out and /ward/stock-out-restore: 401, 403 for a cashier and another hospital; only a listed medicine; restore closes it; #26 computes", async () => {
  await setup();
  const body = { orgId: ORG, medicine: "adrenaline", location: "Ward 3", occurredAt: "2026-08-12T05:00:00Z" };
  assert.equal((await as(null, "/ward/stock-out", "POST", body)).__status, 401);
  assert.equal((await as(U.CASHIER, "/ward/stock-out", "POST", body)).__status, 403);
  assert.equal((await as(U.NURSE, "/ward/stock-out", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await as(null, `/ward/emergency-stock?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(U.CASHIER, `/ward/emergency-stock?orgId=${ORG}`)).__status, 403);
  assert.equal((await recordsOf("EmergencyStockOut")).length, 0);
  assert.equal((await as(U.NURSE, "/ward/stock-out", "POST", { ...body, medicine: "Paracetamol" })).error, "not_an_emergency_medicine");
  const r = await as(U.NURSE, "/ward/stock-out", "POST", body);
  assert.equal(r.__status, 200, JSON.stringify(r));
  await as(U.PHARMACY, "/ward/stock-out", "POST", { ...body, medicine: "Atropine", location: "Pharmacy" });
  let view = await as(U.NURSE, `/ward/emergency-stock?orgId=${ORG}&month=2026-08`);
  assert.equal(view.open.length, 2); assert.equal(view.stockOuts[0].medicine === "Adrenaline" || view.stockOuts[1].medicine === "Adrenaline", true, "stored with the list's spelling");
  assert.equal((await as(U.CASHIER, "/ward/stock-out-restore", "POST", { orgId: ORG, stockOutId: r.stockOutId })).__status, 403);
  const back = await as(U.PHARMACY, "/ward/stock-out-restore", "POST", { orgId: ORG, stockOutId: r.stockOutId });
  assert.equal(back.__status, 200, JSON.stringify(back));
  view = await as(U.NURSE, `/ward/emergency-stock?orgId=${ORG}&month=2026-08`);
  assert.equal(view.open.length, 1);
  const cell = computeNabhIndicators({ rows: { EmergencyStockOut: await recordsOf("EmergencyStockOut") }, unreadable: {}, windows: monthWindows(Date.UTC(2026, 8, 20), 2, 330) }).find((i) => i.no === 26).months.find((m) => m.month === "2026-08");
  assert.equal(cell.value, 2, "each medicine counted separately");
});

test("GET /api/queue/ward/ed-returns and POST /ward/ed-return-review: 401, 403 for a cashier, a nurse cannot decide, another hospital refused; the doctor's review fills #11", async () => {
  await setup();
  assert.equal((await as(null, `/ward/ed-returns?orgId=${ORG}&month=2026-08`)).__status, 401);
  assert.equal((await as(U.CASHIER, `/ward/ed-returns?orgId=${ORG}&month=2026-08`)).__status, 403);
  const list = await as(U.NURSE, `/ward/ed-returns?orgId=${ORG}&month=2026-08`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.deepEqual(list.returns.map((x) => [x.encounterId, x.prior.encounterId, x.review]), [["enc-ed-2", "enc-ed-1", null]]);
  const body = { orgId: ORG, encounterId: "enc-ed-2", similar: true };
  assert.equal((await as(null, "/ward/ed-return-review", "POST", body)).__status, 401);
  assert.equal((await as(U.NURSE, "/ward/ed-return-review", "POST", body)).__status, 403);
  assert.equal((await as(U.DOCTOR, "/ward/ed-return-review", "POST", { ...body, orgId: ORG2 })).__status, 403);
  assert.equal((await recordsOf("EdReturnReview")).length, 0);
  assert.equal((await as(U.DOCTOR, "/ward/ed-return-review", "POST", { ...body, encounterId: "enc-ed-1" })).error, "not_a_return");
  const r = await as(U.DOCTOR, "/ward/ed-return-review", "POST", body);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const rows = { Encounter: await recordsOf("Encounter"), EdReturnReview: await recordsOf("EdReturnReview") };
  const cell = computeNabhIndicators({ rows, unreadable: {}, windows: monthWindows(Date.UTC(2026, 8, 20), 2, 330) }).find((i) => i.no === 11).months.find((m) => m.month === "2026-08");
  assert.deepEqual([cell.numerator, cell.denominator, cell.value, cell.unreviewed], [1, 2, 50, 0]);
});

test("NABH: an indicator this package fills says what it is computed from, and one whose register cannot be read says so instead of zero", () => {
  const windows = monthWindows(Date.UTC(2026, 8, 20), 1, 330);
  const all = computeNabhIndicators({ rows: {}, unreadable: { HaiCase: "not readable with this role" }, windows });
  for (const no of [5, 11, 17, 18, 25, 26, 27, 31, 32]) assert.equal(all.find((i) => i.no === no).computable, true, "#" + no);
  for (const no of [13, 14, 15, 16]) assert.match(all.find((i) => i.no === no).reason, /HaiCase records could not be read/);
  assert.equal(all.find((i) => i.no === 26).months[0].value, 0, "a count of stock-outs from a readable register is a real zero");
});
