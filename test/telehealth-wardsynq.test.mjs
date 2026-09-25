/* Video visits in a WardSynQ hospital: booking, arrival, the diary, the consent on the record, the Encounter, day close.
 *
 * What these defend:
 *   - a video appointment is booked only while the hospital has video on, and only with who agreed,
 *   - the consent also lands on the patient's record (scope teleconsult, a care purpose),
 *   - the arrival makes the queue ticket a video visit with its room, and the record's Encounter says virtual,
 *   - video switched off after booking: the patient still arrives, as an ordinary visit, and the answer says so,
 *   - the day close counts the video visits.
 *
 * node --test --experimental-test-module-mocks test/telehealth-wardsynq.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, seedHospital, as, admittedPatient, ORG, DOCTOR } from "./_wardsynq-alert-harness.mjs";
const { SCOPES } = await import("../functions/_wardsynq/consent.js");
const { CARE_PURPOSES } = await import("../functions/_wardsynq/privacy-law.js");
const { encounterFromTicket, sameEncounter } = await import("../functions/_wardsynq/migrate-encounter.js");
const { dayClose } = await import("../functions/_queue_eta.js");

const SERVER = "https://video.example.org";
const tickets = () => [...docs.entries()].filter(([k]) => k.startsWith("q_tickets/")).map(([k, d]) => ({ id: k.slice(10), ...d.fields }));
const later = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const book = (patientId, extra, h) => as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId, clinicianId: "cfa:dr-clinic", startAt: later(h || 1), minutes: 15, reason: "Review", ...(extra || {}) });

test("teleconsult is a consent scope and a care purpose (never child-gated)", () => {
  assert.ok(SCOPES.teleconsult);
  assert.ok(CARE_PURPOSES.includes("teleconsult"));
});

test("booking: refused while video is off; refused without who agreed; the diary says whether video is on", async () => {
  seedHospital();
  const { patientId } = await admittedPatient();
  const off = await book(patientId, { teleconsult: true, teleConsent: { givenBy: "patient", agreed: true } });
  assert.equal(off.__status, 409, JSON.stringify(off));
  assert.equal(off.error, "video_off");
  const diaryOff = await as(DOCTOR, `/ward/diary?orgId=${ORG}`, "GET");
  assert.equal(diaryOff.telehealth, false);

  seedHospital({ telehealth: { baseUrl: SERVER } });
  const p2 = (await admittedPatient()).patientId;
  const noConsent = await book(p2, { teleconsult: true });
  assert.equal(noConsent.__status, 422, JSON.stringify(noConsent));
  assert.equal(noConsent.error, "consent_required");
  const diaryOn = await as(DOCTOR, `/ward/diary?orgId=${ORG}`, "GET");
  assert.equal(diaryOn.telehealth, true);
});

test("a video appointment: consent on the record, arrival makes a video ticket, the Encounter is virtual", async () => {
  seedHospital({ telehealth: { baseUrl: SERVER } });
  const { patientId } = await admittedPatient();
  const booked = await book(patientId, { teleconsult: true, teleConsent: { givenBy: "patient", agreed: true } });
  assert.equal(booked.__status, 200, JSON.stringify(booked));
  assert.equal(booked.teleconsult, true);
  assert.equal(booked.teleConsentBy, "patient");
  assert.deepEqual(booked.teleConsentRecord && booked.teleConsentRecord.ok, true, JSON.stringify(booked.teleConsentRecord));

  const diary = await as(DOCTOR, `/ward/diary?orgId=${ORG}`, "GET");
  assert.equal(diary.appointments.find((a) => a.appointmentId === booked.appointmentId).teleconsult, true);

  const arrived = await as(DOCTOR, "/ward/appointment", "POST", { orgId: ORG, appointmentId: booked.appointmentId, state: "arrived" });
  assert.equal(arrived.__status, 200, JSON.stringify(arrived));
  assert.equal(arrived.queueTicket.teleconsult, true);
  const t = tickets().find((x) => x.id === arrived.queueTicket.id);
  assert.match(t.teleRoom, /^wsq-[0-9a-f]{32}$/);
  assert.equal(t.teleConsentBy, "patient");

  const enc = encounterFromTicket({ ticket: t, tenantId: "x" });
  assert.ok(enc, "the ticket names a patient");
  assert.equal(enc.virtual, true);
  assert.equal(JSON.stringify(enc).includes(t.teleRoom), false, "the room never reaches the record");
  assert.equal(sameEncounter({ ...enc, virtual: false }, enc), false, "becoming a video visit is a change");
});

test("video switched off after booking: the patient still arrives, as an ordinary visit", async () => {
  seedHospital({ telehealth: { baseUrl: SERVER } });
  const { patientId } = await admittedPatient();
  const booked = await book(patientId, { teleconsult: true, teleConsent: { givenBy: "parent", agreed: true } });
  assert.equal(booked.__status, 200, JSON.stringify(booked));
  docs.get(`q_orgs/${ORG}`).fields.wardsynq = {};
  const arrived = await as(DOCTOR, "/ward/appointment", "POST", { orgId: ORG, appointmentId: booked.appointmentId, state: "arrived" });
  assert.equal(arrived.__status, 200, JSON.stringify(arrived));
  assert.equal(arrived.queueTicket.teleconsult, false);
  assert.equal(arrived.teleNote, "video_off");
});

test("encounter: an in-person ticket is not virtual; an encounter written before the field compares unchanged", () => {
  const t = { id: "t1", ghisPatientId: "MRN-1", status: "waiting", registeredAt: 1 };
  const enc = encounterFromTicket({ ticket: t });
  assert.ok(enc);
  assert.equal(enc.virtual, false);
  const legacy = { ...enc }; delete legacy.virtual;
  assert.equal(sameEncounter(legacy, enc), true);
});

test("day close counts the video visits", () => {
  const rows = [{ sessionId: "s", status: "completed", teleconsult: true }, { sessionId: "s", status: "completed" }, { sessionId: "s", status: "waiting", teleconsult: true }];
  assert.equal(dayClose(rows, Date.now(), {}).teleconsult, 2);
  assert.equal(dayClose([], Date.now(), {}).teleconsult, 0);
});
