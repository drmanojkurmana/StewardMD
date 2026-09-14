// OPD immunisation capture -> a conformant ImmunizationRecord.
//
// The gap this closes: ImmunizationRecord was the one HI type with a working serializer and NO source data,
// because nothing in the product recorded a vaccination. This covers the whole path - the code list, the
// capture validation, the timeline projection - and the refusals, which are the part that matters: an
// invented SNOMED code in a patient's national health record is a false clinical claim ABDM cannot retract.
import test from "node:test";
import assert from "node:assert/strict";
import { VACCINES, VACCINE_SYSTEM, SCHEDULE, isVaccineCode, vaccineCoding, vaccineCatalogue, buildImmunisation }
  from "../../../functions/_vaccines.js";
import { projectTimeline, hiTypesForTimeline, nativeOpdSource } from "../../../functions/_connect/abdm/hip-sources/native-opd.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { serializeNdhm, validateNdhmDoc } from "../../../functions/_connect/connectors/abdm/serialize.js";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";

const ctx = { tenantId: "gimsr", now: () => "2026-08-19T00:00:00.000Z" };
const BCG = "1861000221106";
const at = (iso) => Date.parse(iso);

const visit = (entries) => ({
  ticketId: "tkt-1", patientAbhaHash: "hash-1", expiresAt: Date.now() + 86400000, entries,
});
const immEntry = (over = {}) => ({
  ts: at("2026-08-18T09:00:00Z"), kind: "immunization", by: "dr-1",
  text: "BCG, dose 1", data: Object.assign({
    vaccineCode: vaccineCoding(BCG), occurrenceDateTime: "2026-08-18T09:00:00.000Z",
    status: "completed", doseNumber: 1, lotNumber: "L-77",
  }, over),
});

// ── the code list ───────────────────────────────────────────────────────────────────────────────────
test("every code comes from the IG's own value set, and the display is never the caller's", () => {
  assert.equal(VACCINE_SYSTEM, "http://snomed.info/sct");
  assert.ok(Object.keys(VACCINES).length > 150, "the whole ndhm-vaccine-codes set should be present");
  assert.equal(vaccineCoding(BCG).display, "BCG (Bacillus Calmette-Guerin) vaccine");
  // A caller cannot smuggle in their own wording for a real code.
  assert.equal(buildImmunisation({ vaccineCode: BCG, display: "Sugar water" }).data.vaccineCode.display,
    "BCG (Bacillus Calmette-Guerin) vaccine");
});

test("the India schedule is an ordering over that list, never a second catalogue", () => {
  for (const s of SCHEDULE) assert.ok(isVaccineCode(s.code), s.label + " (" + s.code + ") must exist in the IG set");
  const cat = vaccineCatalogue();
  assert.equal(cat.schedule.length, SCHEDULE.length);
  assert.equal(cat.schedule.length + cat.others.length, Object.keys(VACCINES).length, "no code is listed twice or lost");
  assert.ok(cat.schedule.every((s) => s.display === VACCINES[s.code]));
});

// ── capture refusals ────────────────────────────────────────────────────────────────────────────────
test("an unknown vaccine code is REFUSED, not stored as free text", () => {
  assert.equal(buildImmunisation({ vaccineCode: "9999999" }).error, "unknown_vaccine_code");
  assert.equal(buildImmunisation({ vaccineCode: "" }).error, "unknown_vaccine_code");
  assert.equal(buildImmunisation({}).error, "unknown_vaccine_code");
  // Not even a plausible-looking free-text vaccine name gets through.
  assert.equal(buildImmunisation({ vaccineCode: "BCG" }).error, "unknown_vaccine_code");
});

test("a vaccination cannot be dated in the future, and a bad date is refused", () => {
  const future = new Date(Date.now() + 5 * 86400000).toISOString();
  assert.equal(buildImmunisation({ vaccineCode: BCG, occurrenceDateTime: future }).error, "future_date");
  assert.equal(buildImmunisation({ vaccineCode: BCG, occurrenceDateTime: "not a date" }).error, "bad_date");
  // Back-dating within the day is allowed: a dose given this morning is still a real dose.
  assert.ok(buildImmunisation({ vaccineCode: BCG, occurrenceDateTime: "2026-08-18T09:00:00Z" }).data);
});

test("an implausible dose number is refused", () => {
  for (const n of [0, -1, 99, "abc"]) assert.equal(buildImmunisation({ vaccineCode: BCG, doseNumber: n }).error, "bad_dose", String(n));
  assert.equal(buildImmunisation({ vaccineCode: BCG, doseNumber: 2 }).data.doseNumber, 2);
  // Absent is fine - doseNumber is optional in FHIR, and guessing "1" would invent a fact.
  assert.equal("doseNumber" in buildImmunisation({ vaccineCode: BCG }).data, false);
});

test("the stored payload carries occurrence and status, because both are FHIR minima", () => {
  const d = buildImmunisation({ vaccineCode: BCG, doseNumber: 1, lotNumber: " L-77 ", note: " left arm " }).data;
  assert.ok(d.occurrenceDateTime, "occurrence[x] is min=1");
  assert.equal(d.status, "completed");
  assert.equal(d.lotNumber, "L-77");
  assert.match(d.text, /BCG.*dose 1.*left arm/);
});

// ── projection ──────────────────────────────────────────────────────────────────────────────────────
test("an OPD vaccination becomes an SCCM immunisation, and the HI type appears", () => {
  const tl = visit([immEntry()]);
  assert.deepEqual(hiTypesForTimeline(tl), ["ImmunizationRecord"]);
  const rec = projectTimeline(tl, ctx);
  assert.equal(rec.recordType, "ImmunizationRecord");
  assert.equal(rec.immunizations.length, 1);
  const im = rec.immunizations[0];
  assert.equal(im.vaccineCode.coding[0].code, BCG);
  assert.equal(im.vaccineCode.coding[0].system, VACCINE_SYSTEM);
  assert.equal(im.occurrenceDateTime, "2026-08-18T09:00:00.000Z");
  assert.equal(im.doseNumber, 1);
  assert.equal(im.lotNumber, "L-77");
  assert.equal(validateBundle(rec).ok, true, JSON.stringify(validateBundle(rec).errors));
});

test("an immunisation entry with NO coded payload is not advertised or projected", () => {
  // A legacy or corrupt entry cannot make a valid Immunization (vaccineCode + occurrence are both min=1),
  // so promising the HI type would leave the patient a care context that never loads.
  const bare = { ts: at("2026-08-18T09:00:00Z"), kind: "immunization", text: "gave a vaccine", data: null };
  assert.deepEqual(hiTypesForTimeline(visit([bare])), []);
  assert.equal(projectTimeline(visit([bare]), ctx).immunizations.length, 0);
  const noCode = { ...bare, data: { occurrenceDateTime: "2026-08-18T09:00:00.000Z" } };
  assert.deepEqual(hiTypesForTimeline(visit([noCode])), []);
});

test("a visit with a consultation AND a vaccination keeps both", () => {
  const tl = visit([{ ts: at("2026-08-18T08:00:00Z"), kind: "note", text: "Fever 3 days" }, immEntry()]);
  const types = hiTypesForTimeline(tl);
  assert.ok(types.includes("OPConsultation") && types.includes("ImmunizationRecord"), JSON.stringify(types));
  const rec = projectTimeline(tl, ctx);
  assert.equal(rec.immunizations.length, 1, "the vaccination survives alongside the narrative");
  assert.equal(rec.documents.length, 1);
  assert.equal(rec.recordType, "OPConsultRecord", "a visit with a consultation reads as one");
});

test("the source advertises ImmunizationRecord only when a visit really carries one", async () => {
  assert.ok(nativeOpdSource.hiTypes.includes("ImmunizationRecord"));
  const reader = { listVisits: async () => [visit([immEntry()])] };
  const ctxs = await nativeOpdSource.listCareContexts({}, { opd: reader }, { tenantId: "gimsr", patientAbhaHash: "hash-1" });
  assert.equal(ctxs.length, 1);
  assert.equal(ctxs[0].hiType, "ImmunizationRecord");
});

// ── the wire ────────────────────────────────────────────────────────────────────────────────────────
test("it SERIALIZES to a conformant NDHM ImmunizationRecord and round-trips", () => {
  const rec = projectTimeline(visit([immEntry()]), ctx);
  const doc = serializeNdhm(ctx, { ...rec, profile: "ImmunizationRecord" });
  const v = validateNdhmDoc(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));

  const im = doc.entry.map((e) => e.resource).find((r) => r.resourceType === "Immunization");
  assert.equal(im.vaccineCode.coding[0].code, BCG);
  assert.equal(im.status, "completed");
  assert.ok(im.occurrenceDateTime);
  assert.equal(im.lotNumber, "L-77");
  // No half-coded site or route may appear - the capture path never collects them.
  assert.equal(im.site, undefined);
  assert.equal(im.route, undefined);

  const back = normalizeNdhm(ctx, doc);
  assert.equal(back.immunizations.length, 1);
  assert.equal(back.immunizations[0].vaccineCode.coding[0].code, BCG);
});

test("a not-done vaccination is still a legal record, and a bogus status is refused", () => {
  const ok = projectTimeline(visit([immEntry({ status: "not-done" })]), ctx);
  assert.equal(validateBundle(ok).ok, true);
  const bad = projectTimeline(visit([immEntry({ status: "sort-of" })]), ctx);
  assert.equal(validateBundle(bad).ok, false);
});

// ── who may record one ──────────────────────────────────────────────────────────────────────────────
test("doctor and authorised clinical staff may record a vaccination; nobody else may", async () => {
  const { CAPS, ROLE_CAPS, capsFor } = await import("../../../functions/_queue_roles.js");
  // Owner-decided 2026-08-19: doctor + authorised staff. The nurse usually gives the dose, so recording
  // it cannot be doctor-only - otherwise the doctor types in someone else's act.
  for (const role of ["doctor", "nurse", "intern", "resident", "admin"]) {
    assert.ok(capsFor(role).includes(CAPS.EMR_IMMUNISE), role + " must be able to record a vaccination");
  }
  // Non-clinical and read-only roles must not be able to write into a national health record.
  for (const role of ["reception", "supervisor", "cashier", "viewer"]) {
    assert.ok(!capsFor(role).includes(CAPS.EMR_IMMUNISE), role + " must NOT be able to record a vaccination");
  }
  // It is a SEPARATE authority from prescribing: a nurse gains recording without gaining emr.treat.
  assert.ok(!capsFor("nurse").includes(CAPS.EMR_TREAT), "the nurse still may not prescribe or order");
  assert.notEqual(CAPS.EMR_IMMUNISE, CAPS.EMR_TREAT);
  assert.notEqual(CAPS.EMR_IMMUNISE, CAPS.EMR_VITALS);
  // ONCQIS governance roles are clinical-governance only and hold no queue/EMR write.
  for (const role of Object.keys(ROLE_CAPS).filter((r) => r.startsWith("oncqis_"))) {
    assert.ok(!capsFor(role).includes(CAPS.EMR_IMMUNISE), role);
  }
});
