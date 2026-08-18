// The native OPD HIP source - the "StewardMD EMR" path, for clinics with no EMR of their own.
// Two things are load-bearing: the subject guard (never serve another patient's visit) and the
// retention conflict (a linked care context outlives a TTL'd timeline).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nativeOpdSource, projectTimeline, hiTypesForTimeline, retentionRisk, RecordExpired,
} from "../../../functions/_connect/abdm/hip-sources/native-opd.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const DAY = 86400000;
const NOW = Date.UTC(2026, 7, 18);

const visit = (over = {}) => ({
  ticketId: "tkt-1", patientAbhaHash: HASH_A, date: "2026-03-03",
  expiresAt: NOW + 365 * DAY,
  entries: [
    { ts: NOW - 3000, kind: "note", text: "seen in OPD" },
    { ts: NOW - 2000, kind: "medication", text: "tablet advised" },
    { ts: NOW - 1000, kind: "vitals", text: "recorded" },
  ],
  ...over,
});

const readerFor = (visits) => ({
  opd: {
    listVisits: async () => visits,
    getVisit: async (_e, { ticketId }) => visits.find((v) => v.ticketId === ticketId) || null,
  },
  now: () => "2026-08-18T00:00:00.000Z",
});

// ── HI types ────────────────────────────────────────────────────────────────────────────────────────
test("HI types come from the entry kinds actually present", () => {
  assert.deepEqual(hiTypesForTimeline(visit()), ["OPConsultation", "Prescription", "WellnessRecord"]);
  assert.deepEqual(hiTypesForTimeline({ entries: [{ kind: "medication", text: "x" }] }), ["Prescription"]);
  assert.deepEqual(hiTypesForTimeline({ entries: [] }), []);
  assert.deepEqual(hiTypesForTimeline(null), []);
});

// ── discovery ───────────────────────────────────────────────────────────────────────────────────────
test("a visit is advertised with a data-blind display and a resolvable reference", async () => {
  const ccs = await nativeOpdSource.listCareContexts({}, readerFor([visit()]), { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.equal(ccs.length, 1);
  assert.equal(ccs[0].referenceNumber, "OPD:tkt-1");
  assert.equal(ccs[0].display, "OPD records (Consultation, Prescription, Vitals) from 3 March 2026");
});

test("another patient's visit is never served, even if the reader hands it over", async () => {
  // Defence in depth: the reader is supposed to scope by pseudonym, but the source re-checks.
  const ccs = await nativeOpdSource.listCareContexts({}, readerFor([visit({ patientAbhaHash: HASH_B })]),
    { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.deepEqual(ccs, []);
});

test("no pseudonym, no reader, or a junk reader response all degrade to [] rather than throwing", async () => {
  assert.deepEqual(await nativeOpdSource.listCareContexts({}, readerFor([visit()]), { tenantId: "t1" }), []);
  assert.deepEqual(await nativeOpdSource.listCareContexts({}, {}, { tenantId: "t1", patientAbhaHash: HASH_A }), []);
  const junk = { opd: { listVisits: async () => "not an array", getVisit: async () => null } };
  assert.deepEqual(await nativeOpdSource.listCareContexts({}, junk, { tenantId: "t1", patientAbhaHash: HASH_A }), []);
});

test("a visit with nothing servable is not advertised - an empty link is permanent noise", async () => {
  const ccs = await nativeOpdSource.listCareContexts({}, readerFor([visit({ entries: [] })]),
    { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.deepEqual(ccs, []);
});

// ── projection ──────────────────────────────────────────────────────────────────────────────────────
test("the projection carries the meds, vitals and consultation narrative", () => {
  const r = projectTimeline(visit(), { tenantId: "t1", now: () => "2026-08-18T00:00:00.000Z" });
  assert.equal(r.medications.length, 1);
  assert.equal(r.observations.length, 1);
  assert.equal(r.documents.length, 1);
  assert.match(r.documents[0].text, /seen in OPD/);
  assert.equal(r.recordType, "OPConsultRecord");
  assert.equal(r.meta.sourceConnector, "native-opd");
});

test("entries are ordered by time regardless of how the reader returns them", () => {
  const jumbled = visit({ entries: [
    { ts: 3000, kind: "note", text: "third" },
    { ts: 1000, kind: "note", text: "first" },
    { ts: 2000, kind: "note", text: "second" },
  ] });
  const text = projectTimeline(jumbled, { tenantId: "t1" }).documents[0].text;
  assert.ok(text.indexOf("first") < text.indexOf("second"), "not ordered");
  assert.ok(text.indexOf("second") < text.indexOf("third"), "not ordered");
});

test("the projection carries NO ABHA and NO patient name", () => {
  const r = projectTimeline(visit({ patientAbhaHash: HASH_A }), { tenantId: "t1" });
  const raw = JSON.stringify(r);
  assert.ok(!raw.includes(HASH_A), "the pseudonym belongs on the envelope, not in the record");
  assert.ok(!raw.includes("@"), "no ABHA address may appear");
  assert.equal(r.patient.name, null, "the queue keeps the name encrypted; it must not surface here");
});

// ── loading ─────────────────────────────────────────────────────────────────────────────────────────
test("loadRecord resolves a reference and reports its pseudonym for subject binding", async () => {
  const out = await nativeOpdSource.loadRecord({}, readerFor([visit()]), { tenantId: "t1", careContextRef: "OPD:tkt-1" });
  assert.equal(out.patientAbhaHash, HASH_A);
  assert.equal(out.hiType, "OPConsultation");
  assert.equal(out.recordType, "OPConsultRecord");
  assert.ok(out.record.documents.length);
});

test("a reference from another source is rejected rather than mis-resolved", async () => {
  await assert.rejects(
    () => nativeOpdSource.loadRecord({}, readerFor([visit()]), { tenantId: "t1", careContextRef: "FC:episode-9" }),
    /not a native OPD care context/);
});

test("a missing reader is a wiring error, not an empty projection", async () => {
  await assert.rejects(
    () => nativeOpdSource.loadRecord({}, {}, { tenantId: "t1", careContextRef: "OPD:tkt-1" }),
    /reader not injected/);
});

// ── the retention conflict ──────────────────────────────────────────────────────────────────────────
test("an aged-out record raises RecordExpired, not an anonymous miss", async () => {
  // The link at ABDM is permanent; the q_timeline doc is not. Name the failure so it can be reported.
  await assert.rejects(
    () => nativeOpdSource.loadRecord({}, readerFor([]), { tenantId: "t1", careContextRef: "OPD:tkt-1" }),
    (e) => e instanceof RecordExpired && /retention window/.test(e.message));
});

test("retentionRisk refuses to call a default 7-day timeline safe to link", () => {
  const soon = retentionRisk({ expiresAt: NOW + 7 * DAY }, { now: NOW });
  assert.equal(soon.daysLeft, 7);
  assert.equal(soon.safeToLink, false, "a 7-day TTL cannot back a permanent care context");

  const long = retentionRisk({ expiresAt: NOW + 200 * DAY }, { now: NOW });
  assert.equal(long.safeToLink, true);
});

test("a timeline with no TTL at all is treated as unsafe, not as infinite", () => {
  const r = retentionRisk({}, { now: NOW });
  assert.equal(r.daysLeft, 0);
  assert.equal(r.safeToLink, false);
});
