/* test/wardsynq-gst-packages.test.mjs - gst-packages (2026-09-17): the GST treatment review of package billing, applied.
 *
 * Pure: functions/_region_in.js gstForLines (in-patient composite supply for every item, not-health-care rows, take-home
 * medicines, the per-day room test for hourly beds, intensive care classes, printed SAC) and packageRoomComponent (the
 * room inside a package: published tariff, scheme rate, proportional split, capped, GST-inclusive rates, a missing
 * tariff); functions/_wardsynq/gst-settings.js; the TAN-based GSTIN of a government TDS deductor.
 * Routes: GET/POST /api/queue/org/gst-settings (negative authorization, the chartered accountant's opinion, the reason,
 * the audit row), POST /api/queue/ward/invoice on a package stay (the carved-out room line, the refusals), POST
 * /api/queue/ward/invoice-parties (who receives a cashless claim: the payer contract decides, gst-parties 2026-09-17;
 * the full party tests are test/wardsynq-gst-parties.test.mjs).
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-gst-packages.test.mjs
 */
import { as, seed, docs, H, T, ORG_ID, OTHER_ADMIN, NURSE, CASHIER, ADMIN } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const R = await import("../functions/_region_in.js");
const G = await import("../functions/_wardsynq/gst-settings.js");
const { validateTariff } = await import("../functions/_clinic_billing.js");
const { tariffTable, stayDayItems, stayDays, capturableFrom } = await import("../functions/_wardsynq/charge-capture.js");
const P = await import("../functions/_wardsynq/packages.js");

const DEF = G.readGstSettings(null);
const TABLE = tariffTable(null, [
  { code: "ROOM-PVT", name: "Private room", kind: "bed", price: 600000, ward: "Private" },
  { code: "ROOM-GEN", name: "General bed", kind: "bed", price: 150000, ward: "General" },
  { code: "ROOM-ICU", name: "ICU bed", kind: "bed", price: 1500000, ward: "ICU", intensiveCareClass: "ICU" },
  { code: "ROOM-PICU", name: "PICU bed", kind: "bed", price: 1200000, ward: "PICU", intensiveCareClass: "ICU_SPECIALTY" },
  { code: "ROOM-HDU", name: "HDU bed", kind: "bed", price: 800000, ward: "HDU", intensiveCareClass: "HDU" },
  { code: "DAYCARE", name: "Day care bed", kind: "bed", price: 30000, ward: "Day care", unitHours: 1 },
  { code: "NURS", name: "Nursing", kind: "nursing", price: 90000 },
  { code: "IMPLANT", name: "Locking plate", kind: "medication", price: 2000000, gstRate: 12, hsnSac: "90211000" },
  { code: "PCM", name: "Paracetamol", kind: "medication", price: 1000, gstRate: 5, hsnSac: "30049099" },
  { code: "ATT-MEAL", name: "Attendant meal", kind: "service", price: 15000, gstRate: 5, hsnSac: "996331", nonHealthcare: true },
  { code: "ATT-BED", name: "Attendant bed", kind: "service", price: 50000, nonHealthcare: true },
  { code: "CBC", name: "CBC", kind: "investigation", price: 30000 },
  { code: "OPD-VISIT", name: "Consultation", kind: "visit", price: 50000 },
]);
const day = (code, enc, n, extra) => ({ code, sourceType: "Encounter", sourceId: `${enc}:bed:${n}`, quantity: 1, amount: TABLE[code].amount, line: TABLE[code].amount, ...(extra || {}) });

/* ---- pure ----------------------------------------------------------------------------------------- */

test("settings: every default is the review's safest reading; a non-default needs the chartered accountant's opinion", () => {
  assert.deepEqual(DEF, { pkgRoomValuation: "published_tariff", recipientOfCashlessClaims: null, placeOfSupply: "where_performed", intensiveCareUnits: "named_and_specialty",
    roomChargeBasis: "bed_tariff", dischargeMedsAsComposite: "taxed", gstTdsDeductorSchemes: [], aggregateTurnoverRs: null, caOpinionRef: null, caOpinionDate: null });
  assert.deepEqual(G.readGstSettings({ gst: { pkgRoomValuation: "whole_package_exempt", gstTdsDeductorSchemes: ["pmjay", "nhs"] } }).pkgRoomValuation, "published_tariff", "an unknown value reads as the default");
  assert.match(G.validateGstSettings({ placeOfSupply: "recipient_state" }, null).errors.caOpinionRef, /chartered accountant's written opinion reference and its date/);
  const ok = G.validateGstSettings({ placeOfSupply: "recipient_state", caOpinionRef: "CA letter 7", caOpinionDate: "2026-09-10" }, null);
  assert.deepEqual([ok.errors, ok.value.placeOfSupply], [{}, "recipient_state"]);
  assert.equal(G.validateGstSettings({ aggregateTurnoverRs: "5 crore" }, null).errors.aggregateTurnoverRs.slice(0, 18), "Aggregate turnover");
  assert.equal(G.validateGstSettings({ intensiveCareUnits: "all_rooms" }, null).errors.intensiveCareUnits.startsWith("Choose one of"), true);
  assert.equal(G.validateGstSettings({ sneaky: 1 }, null).errors.sneaky, "This is not one of the GST settings.");
  assert.deepEqual([G.einvoiceApplicability(DEF).reason, G.einvoiceApplicability({ aggregateTurnoverRs: 50000000 }).applies, G.einvoiceApplicability({ aggregateTurnoverRs: 50000001 }).applies], ["turnover_not_entered", false, true]);
});

test("in-patient: every good or service is exempt composite health care (an implant with a rate too), except a room over Rs 5,000 a day and a not-health-care row", () => {
  const lines = [day("ROOM-PVT", "e1", 1), { code: "IMPLANT", sourceType: "MedicationAdministration", sourceId: "m1", line: 20000, amount: 20000 }, { code: "ATT-MEAL", line: 150 }, { code: "CBC", line: 300 }];
  const g = R.gstForLines(lines, TABLE, "IN", { inpatient: true, settings: DEF });
  const by = Object.fromEntries(g.lines.map((l) => [l.code, l]));
  assert.deepEqual([by["ROOM-PVT"].tax, by["ROOM-PVT"].hsnSac], [300, "999311"]);
  assert.deepEqual([by.IMPLANT.gstExempt, by.IMPLANT.basis, by.IMPLANT.hsnSac], [true, "inpatient_composite_exempt", "999311"], "the implant's own HSN is not the tax classification on an in-patient bill");
  assert.deepEqual([by["ATT-MEAL"].gstRate, by["ATT-MEAL"].tax, by["ATT-MEAL"].basis, by["ATT-MEAL"].hsnSac], [5, 7.5, "not_health_care", "996331"]);
  assert.deepEqual([by.CBC.gstExempt, by.CBC.hsnSac], [true, "999311"]);
  // A not-health-care row with no rate is never assumed: listed, and the bill is refused by the caller.
  assert.deepEqual(R.gstForLines([{ code: "ATT-BED", line: 500 }], TABLE, "IN", { inpatient: true }).unconfigured, ["ATT-BED"]);
});

test("take-home medicines at discharge: taxed at the item's rate by default, composite only with the hospital's setting", () => {
  const th = { code: "PCM", sourceType: "MedicationDispense", sourceId: "d1", line: 100, takeHome: true };
  assert.deepEqual(R.gstForLines([th], TABLE, "IN", { inpatient: true, settings: DEF }).lines[0].basis, "take_home_medicine");
  assert.equal(R.gstForLines([th], TABLE, "IN", { inpatient: true, settings: { ...DEF, dischargeMedsAsComposite: "composite" } }).lines[0].basis, "inpatient_composite_exempt");
  assert.equal(R.gstForLines([{ ...th, takeHome: undefined }], TABLE, "IN", { inpatient: true, settings: DEF }).lines[0].gstExempt, true, "a medicine used in the stay is exempt");
  const cap = capturableFrom({ MedicationDispense: [{ id: "d1", patientId: "p", drugCode: "PCM", drug: "Paracetamol", state: "issued", takeHome: true }] });
  assert.equal(cap.items[0].takeHome, true, "charge capture carries the take-home marker");
});

test("outpatients: consultation and tests exempt with their SAC, a medicine given in the visit exempt, one dispensed to take away taxed", () => {
  const g = R.gstForLines([{ code: "OPD-VISIT", line: 500 }, { code: "CBC", line: 300 }, { code: "PCM", sourceType: "MedicationAdministration", sourceId: "a", line: 10 },
    { code: "PCM", sourceType: "MedicationDispense", sourceId: "d", line: 100 }], TABLE, "IN", { inpatient: false, settings: DEF });
  assert.deepEqual(g.lines.map((l) => [l.code, l.gstExempt, l.hsnSac, l.tax]), [["OPD-VISIT", true, "999312", 0], ["CBC", true, "999316", 0], ["PCM", true, "999312", 0], ["PCM", false, "30049099", 5]]);
});

test("the room test is per day: an hourly bed is converted to 24 hours, a day's lines add up, nursing counts only with the setting", () => {
  // Rs 300 an hour is Rs 7,200 a day: a 6-hour day-care stay (line Rs 1,800) is still a room above Rs 5,000 a day.
  const dc = R.gstForLines([{ code: "DAYCARE", sourceType: "Encounter", sourceId: "e9:bed:1", quantity: 6, amount: 300, line: 1800 }], TABLE, "IN", { inpatient: true, settings: DEF }).lines[0];
  assert.deepEqual([dc.gstRate, dc.tax, dc.taxable], [5, 90, 1800]);
  assert.equal(R.perDayTariff(TABLE.DAYCARE), 7200);
  // Rs 4,500 bed + Rs 900 nursing: exempt as billed; above Rs 5,000 when the hospital counts daily nursing in the room charge.
  const table = { ...TABLE, B45: { amount: 4500, kind: "bed", description: "Semi-private" } };
  const lines = [{ code: "B45", sourceId: "e2:bed:1", line: 4500, amount: 4500 }, { code: "NURS", sourceId: "e2:nursing:NURS:1", line: 900, amount: 900 }];
  assert.equal(R.gstForLines(lines, table, "IN", { inpatient: true, settings: DEF }).totalTax, 0);
  const withN = R.gstForLines(lines, table, "IN", { inpatient: true, settings: { ...DEF, roomChargeBasis: "bed_and_daily_nursing" } });
  assert.deepEqual(withN.lines.map((l) => [l.code, l.tax]), [["B45", 225], ["NURS", 45]], "the whole day's room charge is taxed, not the excess");
  // Charge capture bills an hourly bed by the hours the day was occupied.
  const enc = { id: "e9", patientId: "p", periodStart: "2026-09-15T08:00:00Z", periodEnd: "2026-09-15T13:30:00Z", location: { ward: "Day care" } };
  const items = stayDayItems(enc, stayDays(enc, null, Date.parse("2026-09-16T00:00:00Z")), { DAYCARE: TABLE.DAYCARE });
  assert.deepEqual(items.map((i) => [i.code, i.quantity]), [["DAYCARE", 6]], "5 hours 30 minutes is 6 begun hours");
});

test("intensive care: the four named units exempt at any price; a specialty ICU exempt by default; HDU a room unless the hospital says otherwise", () => {
  const lines = [day("ROOM-ICU", "e", 1), day("ROOM-PICU", "e", 2), day("ROOM-HDU", "e", 3)];
  const basis = (settings) => R.gstForLines(lines, TABLE, "IN", { inpatient: true, settings }).lines.map((l) => l.basis);
  assert.deepEqual(basis(DEF), ["intensive_care_room_exempt", "intensive_care_room_exempt", "room_over_5000_per_day"]);
  assert.deepEqual(basis({ ...DEF, intensiveCareUnits: "named_only" }), ["intensive_care_room_exempt", "room_over_5000_per_day", "room_over_5000_per_day"]);
  assert.deepEqual(basis({ ...DEF, intensiveCareUnits: "include_hdu" }), ["intensive_care_room_exempt", "intensive_care_room_exempt", "intensive_care_room_exempt"]);
  assert.equal(R.isIntensiveCare({ intensiveCare: true }, DEF), true, "a row marked before classes existed is one of the named four");
  const v = validateTariff({ name: "HDU", price: 1, kind: "bed", intensiveCareClass: "hdu", unitHours: "8", nonHealthcare: false }).item;
  assert.deepEqual([v.intensiveCareClass, v.intensiveCare, v.unitHours, v.nonHealthcare], ["HDU", false, 8, false]);
  assert.equal(validateTariff({ name: "X", price: 1, kind: "bed", intensiveCareClass: "WARD" }).error, "bad_intensive_care_class");
  assert.equal(validateTariff({ name: "X", price: 1, kind: "bed", unitHours: "30" }).error, "bad_unit_hours");
  assert.equal(validateTariff({ name: "X", price: 1, kind: "service", unitHours: "8" }).item.unitHours, undefined, "only a bed has unit hours");
});

test("package room (review 2.3): ICU days not carved out, published tariff capped at the package, scheme rate, proportional split, GST-inclusive rate, missing tariff", () => {
  const pkg = { code: "SU007A", name: "ORIF", rate: 45000 };
  const lines = [day("ROOM-PVT", "e", 1, { packageIncluded: true, line: 0 }), day("ROOM-PVT", "e", 2, { packageIncluded: true, line: 0 }), day("ROOM-ICU", "e", 3, { packageIncluded: true, line: 0 }),
    { code: "CBC", sourceType: "DiagnosticReport", sourceId: "r", quantity: 1, packageIncluded: true, line: 0 }];
  const pub = R.packageRoomComponent(pkg, lines, TABLE, DEF);
  assert.deepEqual([pub.roomValue, pub.taxable, pub.tax, pub.exemptValue, pub.days, pub.method, pub.capped], [12000, 12000, 600, 33000, 2, "published_tariff", false], "only the two private room days, at Rs 6,000 each");
  assert.deepEqual(pub.groups, [{ name: "Private room", days: 2, ratePerDay: 6000 }]);
  const capped = R.packageRoomComponent({ ...pkg, rate: 10000 }, lines, TABLE, DEF);
  assert.deepEqual([capped.roomValue, capped.exemptValue, capped.capped], [10000, 0, true]);
  assert.equal(R.packageRoomComponent(pkg, [day("ROOM-GEN", "e", 1, { packageIncluded: true })], TABLE, DEF).roomValue, 0, "a Rs 1,500 room stays in the exempt package");
  // Scheme rate: the payer's own per-day room rate decides the test and the value; with none entered, the tariff (said as a fallback).
  assert.equal(R.packageRoomComponent({ ...pkg, roomRatePerDay: 4500 }, lines, TABLE, { ...DEF, pkgRoomValuation: "scheme_rate" }).roomValue, 0);
  const sch = R.packageRoomComponent({ ...pkg, roomRatePerDay: 5500 }, lines, TABLE, { ...DEF, pkgRoomValuation: "scheme_rate" });
  assert.deepEqual([sch.roomValue, sch.method, sch.fallback], [11000, "scheme_rate", false]);
  const noRate = R.packageRoomComponent(pkg, lines, TABLE, { ...DEF, pkgRoomValuation: "scheme_rate" });
  assert.deepEqual([noRate.roomValue, noRate.method, noRate.fallback], [12000, "published_tariff", true]);
  // Proportional split: 45000 x (6000 + 6000) / (6000 + 6000 + 15000 + 300) = 19780.22, Rs 9,890.11 a day.
  const ssp = R.packageRoomComponent(pkg, lines, TABLE, { ...DEF, pkgRoomValuation: "proportional_split" });
  assert.deepEqual([ssp.roomValue, ssp.method, ssp.groups[0].ratePerDay], [19780.22, "proportional_split", 9890.11]);
  const unpricedCovered = [...lines, { code: "MYSTERY", sourceType: "MedicationAdministration", sourceId: "x", packageIncluded: true, line: 0 }];
  assert.deepEqual([R.packageRoomComponent(pkg, unpricedCovered, TABLE, { ...DEF, pkgRoomValuation: "proportional_split" }).method, R.packageRoomComponent(pkg, unpricedCovered, TABLE, { ...DEF, pkgRoomValuation: "proportional_split" }).fallback], ["published_tariff", true]);
  // A payer rate that includes GST: tax = value x 5 / 105, borne by the hospital.
  const inc = R.packageRoomComponent({ ...pkg, priceIncludesGst: true }, lines, TABLE, DEF);
  assert.deepEqual([inc.tax, inc.taxable, inc.unrecoverableGst, inc.exemptValue], [571.43, 11428.57, 571.43, 33000]);
  // A covered room day with no bed row: nothing can be worked out.
  assert.deepEqual(R.packageRoomComponent(pkg, [{ code: "BED-DAY", display: "Bed per day, Deluxe", sourceType: "Encounter", sourceId: "e:bed:1", packageIncluded: true }], TABLE, DEF),
    { error: "room_tariff_missing", category: "Bed per day, Deluxe" });
});

test("GSTIN: a government payer registered only as a GST TDS deductor (TAN-based) is a valid buyer GSTIN", () => {
  const tan = "07DELA12345B1D";
  assert.equal(R.isValidGstin(tan + R.gstinCheckChar(tan)), true);
  assert.equal(R.isValidGstin("07DELA1234BB1D" + R.gstinCheckChar("07DELA1234BB1D")), false, "neither a PAN nor a TAN");
  assert.equal(R.validateBuyer({ gstin: tan + R.gstinCheckChar(tan), kind: "payer", legalName: "State Health Agency", address1: "1 Road", location: "Delhi", pincode: "110001", stateCode: "07" }).buyer.kind, "payer");
});

test("package master: the scheme's room rate needs its source; GST-inclusive is false unless said", () => {
  const base = { scheme: "cghs", code: "C1", name: "Cataract", rate: "30000", inclusions: { kinds: ["bed"] }, exclusions: {} };
  assert.deepEqual([P.validatePackage(base).item.roomRatePerDay, P.validatePackage(base).item.priceIncludesGst], [null, false]);
  assert.equal(P.validatePackage({ ...base, roomRatePerDay: "4500" }).error, "room_rate_source_required");
  assert.equal(P.validatePackage({ ...base, roomRatePerDay: "45,00", roomRateSource: "x" }).error, "bad_room_rate");
  const ok = P.validatePackage({ ...base, roomRatePerDay: "4500", roomRateSource: "CGHS OM 03.10.2025 Annexure II", priceIncludesGst: true }).item;
  assert.deepEqual([ok.roomRatePerDay, ok.roomRateSource, ok.priceIncludesGst], [4500, "CGHS OM 03.10.2025 Annexure II", true]);
});

/* ---- routes --------------------------------------------------------------------------------------- */

const orgAudit = (action) => [...docs.values()].map((d) => d.fields).filter((f) => f && f.action === action);
const gstCfg = () => (docs.get(`q_orgs/${ORG_ID}`).fields.wardsynq || {}).gst;

test("negative authorization: GET/POST /api/queue/org/gst-settings need staff.admin at this hospital; nothing written when refused", async () => {
  seed();
  const body = { orgId: ORG_ID, reason: "CA advice", settings: { aggregateTurnoverRs: "60000000" } };
  const before = JSON.stringify(docs.get(`q_orgs/${ORG_ID}`).fields);
  assert.equal((await as(null, `/org/gst-settings?orgId=${ORG_ID}`)).__status, 401);
  assert.equal((await as(null, "/org/gst-settings", "POST", body)).__status, 401);
  for (const who of [CASHIER, NURSE]) {
    assert.equal((await as(who, `/org/gst-settings?orgId=${ORG_ID}`)).__status, 403, who);
    assert.equal((await as(who, "/org/gst-settings", "POST", body)).__status, 403, who);
  }
  const other = await as(OTHER_ADMIN, "/org/gst-settings", "POST", body);
  assert.ok(other.__status === 403 || other.__status === 404, other.__text);
  assert.equal(JSON.stringify(docs.get(`q_orgs/${ORG_ID}`).fields), before, "nothing written by any refused call");
  assert.equal(orgAudit("org:gst_settings").length, 0);
  const read = await as(ADMIN, `/org/gst-settings?orgId=${ORG_ID}`);
  assert.equal(read.__status, 200, read.__text);
  assert.deepEqual(read.settings, DEF);
});

test("POST /api/queue/org/gst-settings: a non-default needs the CA's opinion, a change needs a reason, the save is audited by setting and read back", async () => {
  seed({ tariff: { KEEP: { amount: 1 } } });
  const noCa = await as(ADMIN, "/org/gst-settings", "POST", { orgId: ORG_ID, reason: "x", settings: { placeOfSupply: "recipient_state" } });
  assert.deepEqual([noCa.__status, noCa.error], [422, "invalid_gst_settings"]); assert.match(noCa.message, /Nothing was saved/);
  const noReason = await as(ADMIN, "/org/gst-settings", "POST", { orgId: ORG_ID, settings: { aggregateTurnoverRs: "60000000" } });
  assert.deepEqual([noReason.__status, noReason.error], [422, "reason_required"]);
  assert.equal(gstCfg(), undefined, "nothing saved by either");
  const ok = await as(ADMIN, "/org/gst-settings", "POST", { orgId: ORG_ID, reason: "CA opinion on cashless claims",
    settings: { placeOfSupply: "recipient_state", intensiveCareUnits: "include_hdu", aggregateTurnoverRs: "60000000", caOpinionRef: "Rao & Co letter 22", caOpinionDate: "2026-09-12" } });
  assert.equal(ok.__status, 200, ok.__text);
  assert.deepEqual(ok.changed.sort(), ["aggregateTurnoverRs", "caOpinionDate", "caOpinionRef", "intensiveCareUnits", "placeOfSupply"]);
  assert.deepEqual([ok.settings.placeOfSupply, ok.settings.aggregateTurnoverRs, gstCfg().intensiveCareUnits], ["recipient_state", 60000000, "include_hdu"]);
  // gst-parties: the hospital-wide GST recipient is retired; it is determined on each payer contract.
  const retired = await as(ADMIN, "/org/gst-settings", "POST", { orgId: ORG_ID, reason: "x", settings: { recipientOfCashlessClaims: "payer" } });
  assert.deepEqual([retired.__status, retired.error], [422, "invalid_gst_settings"]); assert.match(retired.message, /determined on each payer contract/);
  assert.deepEqual(docs.get(`q_orgs/${ORG_ID}`).fields.wardsynq.tariff, { KEEP: { amount: 1 } }, "the rest of the hospital's config is untouched");
  const ev = orgAudit("org:gst_settings");
  assert.equal(ev.length, 1);
  assert.deepEqual(JSON.parse(ev[0].meta).changed.sort(), ok.changed);
  const same = await as(ADMIN, "/org/gst-settings", "POST", { orgId: ORG_ID, settings: { placeOfSupply: "recipient_state" } });
  assert.deepEqual([same.__status, same.changed], [200, []], "a save that changes nothing needs no reason and writes no audit row");
  assert.equal(orgAudit("org:gst_settings").length, 1);
});

const PATIENT = "opd-pat-gstpkg-1", ENC = "enc-gstpkg-1";
const ROUTE_TARIFF = {
  "ROOM-PVT": { amount: 6000, kind: "bed", description: "Private room" },
  "ROOM-ICU": { amount: 15000, kind: "bed", description: "ICU bed", ward: "ICU", intensiveCare: true },
  CBC: { amount: 300, kind: "investigation", description: "CBC" },
  IMPLANT: { amount: 20000, kind: "medication", description: "Locking plate", gstRate: 12, hsnSac: "90211000" },
  "ATT-MEAL": { amount: 150, kind: "service", description: "Attendant meal", nonHealthcare: true },
};
const PKG = { scheme: "pmjay", code: "SU007A", name: "Open reduction internal fixation", rate: "45000", inclusions: { kinds: ["bed", "nursing", "investigation"], items: [] }, exclusions: { kinds: [], items: ["IMPLANT"] } };
async function packageStay(days, gst, tariff) {
  seed({ tariff: tariff || ROUTE_TARIFF, ...(gst ? { gst } : {}) });
  const start = new Date(Date.now() - days * 86400000 + 60000).toISOString();
  await H.RECORD.append(T, [
    { resourceType: "Encounter", id: ENC, version: 1, patientId: PATIENT, class: "IPD", status: "in-progress", periodStart: start, location: { ward: "Private" } },
    { resourceType: "MedicationAdministration", id: "ma-imp", version: 1, patientId: PATIENT, encounterId: ENC, drugCode: "IMPLANT", drug: "Locking plate", status: "administered", givenAt: start },
    { resourceType: "DiagnosticReport", id: "dr-cbc", version: 1, patientId: PATIENT, encounterId: ENC, code: "CBC", status: "final", reportedAt: start },
  ]);
  const pkg = (await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG })).package;
  const a = await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id });
  assert.equal(a.__status, 200, a.__text);
  return pkg;
}

test("POST /ward/invoice on a package stay: a Rs 6,000 room is carved out and taxed at 5 percent; the implant excluded from the package stays exempt; documents and SAC per line", async () => {
  await packageStay(3);
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(inv.written, 1, inv.__text);
  const pl = inv.lines.find((l) => l.packageLine), room = inv.lines.find((l) => l.packageRoom), imp = inv.lines.find((l) => l.code === "IMPLANT");
  assert.deepEqual([pl.line, pl.taxExempt, pl.hsnSac, pl.taxBasis], [27000, true, "999311", "package_exempt"]);
  assert.deepEqual([room.code, room.line, room.tax, room.taxRate, room.hsnSac, room.taxBasis, room.cgst, room.sgst, room.igst], ["SU007A-ROOM", 18000, 900, 5, "999311", "package_room_over_5000_per_day", 450, 450, 0]);
  assert.equal(room.display, "Room charges within package: Private room, 3 day(s) at Rs 6000 per day");
  assert.deepEqual([imp.line, imp.taxExempt, imp.hsnSac], [20000, true, "999311"], "an implant billed on top of the package is still part of the in-patient supply");
  assert.equal(inv.charged, 45000 + 900 + 20000, "the package price is unchanged; GST on the room is on top");
  assert.deepEqual([inv.package.roomGst.days, inv.package.roomGst.taxable, inv.package.roomGst.method, inv.package.roomGst.capped, inv.package.roomGst.gstTdsPossible], [3, 18000, "published_tariff", false, false]);
  assert.equal(inv.placeOfSupply, "where_performed");
  assert.deepEqual(inv.documents.map((d) => [d.type, d.number, d.total]), [["invoice_cum_bill_of_supply", inv.documentNumber, 65900]]);
  assert.match(inv.warning, /still open/);
  /* A PM-JAY stay is a cashless claim. gst-parties: a registered scheme whose contract has no determination is named as
   * payer; the bill stays to the patient, with the warning that the recipient is not determined. */
  assert.equal((await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payer", provider: "manual", name: "SHA Karnataka",
    settings: { ref: "sha", payerKind: "government_scheme", legalName: "SHA Karnataka", gstin: "29AAACB1234C1Z" + R.gstinCheckChar("29AAACB1234C1Z"), address1: "1 Road", location: "Bengaluru", pincode: "560001", stateCode: "29" } })).__status, 200);
  const payer = await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: inv.invoiceId, payerRef: "sha" });
  assert.equal(payer.__status, 200, payer.__text);
  assert.deepEqual([payer.buyer, payer.parties.payer.ref, payer.parties.gstRecipient.party, payer.parties.gstRecipient.warning, payer.documents.map((d) => d.type)],
    [null, "sha", "patient", "recipient_not_determined", ["invoice_cum_bill_of_supply"]]);
});

test("POST /ward/invoice: the package rate includes GST (worked back, borne by the hospital); a scheme marked a GST TDS deductor is flagged; the payer setting makes the scheme the buyer with its own Bill of Supply", async () => {
  // An old saved hospital-wide "payer" (retired): read only as the migration default for a contract with no determination.
  await packageStay(2, { gstTdsDeductorSchemes: ["pmjay"], recipientOfCashlessClaims: "payer", caOpinionRef: "CA 1", caOpinionDate: "2026-09-01" });
  const pkg = (await as(CASHIER, `/ward/packages?orgId=${ORG_ID}`)).packages[0];
  const upd = await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG, id: pkg.id, expectedVersion: 1, reason: "Scheme pays no GST on top", priceIncludesGst: true });
  assert.equal(upd.__status, 200, upd.__text);
  const rm = await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id, reason: "rate revised", expectedVersion: 1 });
  assert.equal(rm.__status, 200, rm.__text);
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(inv.written, 1, inv.__text);
  const room = inv.lines.find((l) => l.packageRoom), pl = inv.lines.find((l) => l.packageLine);
  assert.deepEqual([room.line, room.tax, pl.line], [11428.57, 571.43, 33000]);
  assert.equal(inv.charged, 45000 + 20000, "a GST-inclusive rate: the bill total is the package price");
  assert.deepEqual([inv.package.roomGst.unrecoverableGst, inv.package.roomGst.gstTdsPossible, inv.package.priceIncludesGst], [571.43, true, true]);
  const tan = "29BLRA12345B1D", gstin = tan + R.gstinCheckChar(tan);
  assert.equal((await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payer", provider: "manual", name: "SAST",
    settings: { ref: "sast", payerKind: "government_scheme", legalName: "Suvarna Arogya Suraksha Trust", gstin, address1: "1 Road", location: "Bengaluru", pincode: "560001", stateCode: "29" } })).__status, 200);
  const b = await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: inv.invoiceId, payerRef: "sast" });
  assert.equal(b.__status, 200, b.__text);
  assert.deepEqual([b.buyer.gstin, b.parties.gstRecipient.source, b.parties.gstRecipient.basis.ref], [gstin, "legacy_global", "CA 1"]);
  assert.deepEqual(b.documents.map((d) => d.type), ["tax_invoice", "bill_of_supply"]);
  assert.ok(/^BOS\//.test(b.billOfSupplyNumber) && /^INV\//.test(b.documentNumber));
  assert.equal(b.documents.reduce((n, d) => n + d.total, 0), b.charged);
});

test("POST /ward/invoice refusals: a covered room day with no bed tariff, and a taxable item with no GST rate; nothing is written or numbered", async () => {
  await packageStay(2, null, { CBC: ROUTE_TARIFF.CBC, IMPLANT: ROUTE_TARIFF.IMPLANT });
  const r = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.deepEqual([r.__status, r.error, r.written], [422, "room_tariff_missing", 0]);
  assert.match(r.detail, /has no per-day room tariff on the Price list\. GST cannot be worked out\. Add the tariff before issuing this bill\./);
  assert.equal((await H.RECORD.latestByType(T, "Invoice", 10)).length, 0, "no bill written");
  // An outpatient attendant meal with no rate: taxable, so the bill is refused rather than raised untaxed.
  seed({ tariff: { "ATT-MEAL": ROUTE_TARIFF["ATT-MEAL"] } });
  await H.RECORD.append(T, [{ resourceType: "MedicationDispense", id: "md-1", version: 1, patientId: "opd-pat-meal", drugCode: "ATT-MEAL", drug: "Attendant meal", state: "issued" }]);
  const meal = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: "opd-pat-meal" });
  assert.deepEqual([meal.__status, meal.error, meal.codes], [422, "gst_rate_missing", ["ATT-MEAL"]]);
  assert.equal(await H.RECORD.latest(T, "_wardsynq_doc_series", "inv-2627"), null, "no number issued");
});

test("POST /ward/invoice: an outpatient bill with nothing taxed is a Bill of Supply numbered in its own series", async () => {
  seed({ tariff: { CBC: ROUTE_TARIFF.CBC } });
  await H.RECORD.append(T, [{ resourceType: "DiagnosticReport", id: "dr-op", version: 1, patientId: "opd-pat-bos", encounterId: "opd-1", code: "CBC", status: "final", reportedAt: new Date().toISOString() }]);
  const r = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: "opd-pat-bos" });
  assert.equal(r.written, 1, r.__text);
  assert.match(r.documentNumber, /^BOS\/\d{4}\/000001$/);
  assert.deepEqual(r.documents.map((d) => [d.type, d.total]), [["bill_of_supply", 300]]);
  assert.deepEqual([r.lines[0].hsnSac, r.lines[0].taxExempt], ["999316", true]);
});

/* ---- screens -------------------------------------------------------------------------------------- */

const WARD_SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
function cashierHtml(cashier) {
  const sandbox = { navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(WARD_SRC, sandbox);
  const W = sandbox.window.WARD;
  return W._render({ ...W._st, view: "cashier", cashier: { patientId: "p1", payLinks: [], ...cashier } });
}
const PKG_LINE = { code: "SU007A", display: "Package: ORIF", quantity: 1, amount: 27000, line: 27000, taxKind: "GST", taxRate: null, taxExempt: true, tax: 0, hsnSac: "999311", taxBasis: "package_exempt", taxable: 27000, packageCode: "SU007A", packageLine: true, cgst: 0, sgst: 0, igst: 0 };
const ROOM_LINE = { code: "SU007A-ROOM", display: "Room charges within package: Private room, 3 day(s) at Rs 6000 per day", quantity: 1, amount: 18000, line: 18000, taxKind: "GST", taxRate: 5, taxExempt: false, tax: 900, hsnSac: "999311", taxBasis: "package_room_over_5000_per_day", taxable: 18000, packageCode: "SU007A", packageRoom: true, cgst: 450, sgst: 450, igst: 0 };
const PKG_INV = { invoiceId: "inv1", status: "open", balance: 45900, charged: 45900, paidIn: 0, currency: "INR", documentNumber: "INV/2627/000004", billOfSupplyNumber: "BOS/2627/000002",
  lines: [PKG_LINE, ROOM_LINE], einvoices: [], events: [], buyer: { gstin: "29AAACB1234C1ZX", legalName: "Acme Insurance Ltd" },
  documents: [{ type: "tax_invoice", number: "INV/2627/000004", lineIndexes: [1], taxable: 18000, tax: 900, total: 18900 }, { type: "bill_of_supply", number: "BOS/2627/000002", lineIndexes: [0], taxable: 27000, tax: 0, total: 27000 }],
  package: { code: "SU007A", name: "ORIF", rate: 45000, roomGst: { days: 3, taxable: 18000, tax: 900, method: "published_tariff", capped: true, fallback: true, unrecoverableGst: 857.14, gstTdsPossible: true } } };

test("cashier screen: each GST document under its own heading and number, the package room carved out and why, the exempt footnote", () => {
  const html = cashierHtml({ invoices: [PKG_INV], einvoice: { state: "ready" } });
  assert.match(html, /<b>Tax Invoice INV\/2627\/000004<\/b> &middot; taxable 18000 &middot; GST 900 &middot; total 18900/);
  assert.match(html, /<b>Bill of Supply BOS\/2627\/000002<\/b> &middot; taxable 27000 &middot; GST 0 &middot; total 27000/);
  assert.match(html, /room charges within the package, taxed/);
  assert.match(html, /This package includes 3 room day\(s\) above Rs 5,000 per day\. Rs 18000 of the package is shown as room charges and taxed at 5%\. The rest of the package is exempt\. Valuation method: the published room tariff\./);
  assert.match(html, /The room tariff for this stay is more than the package price\. The whole package price has been treated as room charges for GST\./);
  assert.match(html, /so the published room tariff was used/);
  assert.match(html, /GST of Rs 857\.14 on room charges in this package is payable by the hospital because the payer's package rate does not allow GST on top\./);
  assert.match(html, /may deduct GST TDS on the taxed room charges \(Section 51\)/);
  assert.match(html, /GST 5% applies because this room is not an ICU, CCU, ICCU or NICU and its charge exceeds Rs 5,000 per day \(Notification 11\/2017-Central Tax \(Rate\), entry 31A\)\./);
  assert.match(html, /Health care services by a clinical establishment are exempt from GST \(Notification 12\/2017-Central Tax \(Rate\), entry 74\)\. Medicines, implants, consumables and food supplied to an admitted patient form part of that service\./);
  // A registered payer with taxed and exempt charges: two documents said, and only the Tax Invoice offered for an IRN.
  assert.match(html, /It will be issued as a Tax Invoice \(reported for e-invoicing\) and a separate Bill of Supply\./);
  assert.ok(html.includes('data-w-act="invirn:inv1"') && !html.includes("invirn:inv1~BOS"), "the Bill of Supply is never offered for an IRN");
});

test("cashier screen: a B2B Bill of Supply has no IRN; turnover not entered is said; a credit note says how its GST was treated", () => {
  const exempt = { ...PKG_INV, lines: [PKG_LINE], documents: [{ type: "bill_of_supply", number: "BOS/2627/000003", lineIndexes: [0], taxable: 27000, tax: 0, total: 27000 }], package: null, documentNumber: "BOS/2627/000003",
    events: [{ kind: "credit_note", noteNumber: "CRN/2627/000001", amount: 100, taxable: 100, tax: 0, financial: true, reason: "Waived", at: "2026-09-17T05:00:00Z", lines: [] },
      { kind: "credit_note", noteNumber: "CRN/2627/000002", amount: 1050, taxable: 1000, tax: 50, gstTreatment: "gst_refunded", gstConfirmation: { reference: "Counter 2" }, reason: "Downgrade", at: "2026-09-17T05:00:00Z", lines: [] }] };
  const html = cashierHtml({ invoices: [exempt], einvoice: { state: "ready" } });
  assert.match(html, /Exempt supplies are not reported for e-invoicing\. This Bill of Supply has no IRN\./);
  assert.ok(!html.includes('data-w-act="invirn:inv1"'), "no Get IRN for a Bill of Supply");
  assert.ok(!html.includes("invirn:inv1~CRN/2627/000001"), "a note with no GST is not offered for an IRN");
  assert.match(html, /No GST on this note: a financial note, not reported for e-invoicing\./);
  assert.match(html, /GST refunded to the patient with this note: Counter 2\./);
  assert.match(cashierHtml({ invoices: [exempt], einvoice: { state: "not_enabled", reason: "turnover_not_entered" } }), /aggregate turnover, exempt supplies included, is not entered on Admin, Price list, GST settings/);
});

test("ward.js wiring: a credit note asks the Section 34 question on the ward; the bill's payer is chosen from the payer contracts; a dispense can be take-home; the raise refusals are translated", () => {
  assert.match(WARD_SRC, /if \(r && r\.error === "gst_confirmation_required"\) \{ invoiceNoteGst\(body, r\); return; \}/);
  assert.match(WARD_SRC, /Object\.assign\(\{\}, body, \{ gstTreatment: v\.gstTreatment, gstConfirmation: v\.gstConfirmation \|\| undefined \}\)/);
  assert.match(WARD_SRC, /cashWrite\("\/ward\/invoice-parties", \{ orgId: st\.orgId, invoiceId: invoiceId, payerRef: v\.payerRef \|\| "" \}/);
  assert.match(WARD_SRC, /takeHome: checked\("wPhTakeHome"\) \|\| undefined/);
  assert.match(WARD_SRC, /r\.error === "room_tariff_missing"\) st\.cashier\.err = wT\("ward\.gst-room-tariff-missing"/);
  assert.match(WARD_SRC, /r\.error === "gst_rate_missing"\) st\.cashier\.err = wT\("ward\.gst-rate-missing"/);
});
