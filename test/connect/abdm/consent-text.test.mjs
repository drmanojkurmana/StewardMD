// test/connect/abdm/consent-text.test.mjs — the PUBLISHED ABHA consent language + its recording.
//
// CRT_ABHA_102 is the certification case behind this file: the ABDM-published consent language must be
// DISPLAYED and the beneficiary's agreement RECORDED. These tests pin the three binding rules stated on
// the published page, because each of them is the kind of thing a later "tidy-up" edit would quietly
// break, and the failure would only surface at a functional-testing audit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import {
  enrolmentConsent, consentSatisfied, recordEnrolConsent, claimEnrolConsent,
  ConsentRecordError, CONSENT_VERSION, ENROL_CONSENT_TABLE,
} from "../../../functions/_connect/abdm/consent-text.js";

const NOW = "2026-08-19T00:00:00.000Z";
const deps = (tables = {}) => ({ db: makeAbdmDb(tables), now: () => NOW });
const rows = (d) => d.db._tables[ENROL_CONSENT_TABLE] || [];
const ALL_AGREED = ["aadhaar-auth", "link-records", "share-records", "anonymised-public-health",
  "worker-explained", "beneficiary-agrees"];

test("the five published clauses and both attestations are all present", () => {
  const c = enrolmentConsent();
  assert.equal(c.version, CONSENT_VERSION);
  assert.equal(c.heading, "I hereby declare that:");
  assert.deepEqual(c.clauses.map((x) => x.id),
    ["aadhaar-auth", "non-aadhaar-route", "link-records", "share-records", "anonymised-public-health"]);
  assert.deepEqual(c.attestations.map((x) => x.role), ["worker", "beneficiary"]);
  // Verbatim anchors from the published image - if these drift, the wording is no longer ABDM's.
  assert.match(c.clauses[0].text, /Unique Identification Authority of India/);
  assert.match(c.clauses[0].text, /Targeted Delivery of Financial and other Subsidies, Benefits and Services\) Act, 2016/);
  assert.match(c.clauses[3].text, /^I authorize the sharing of all my health records/);
});

// ── published rule 1: private entities remove "government" ──────────────────────────────────────────
test("a private integrator's consent carries NO mention of government records", () => {
  const c = enrolmentConsent();                       // StewardMD is a Digital Solution Company
  const all = c.clauses.map((x) => x.text).join(" ");
  assert.ok(!/government/i.test(all), "published note 1: private entities must remove the word government");
  assert.match(c.clauses[2].text, /legacy \(past\) health records/);
  assert.match(c.clauses[4].text, /anonymization and subsequent use of my health records/);
});

test("the government wording is still available, and is opt-in only", () => {
  const g = enrolmentConsent({ government: true });
  assert.match(g.clauses[2].text, /legacy \(past\) government health records/);
  assert.match(g.clauses[4].text, /my government health records for public health purposes/);
});

// ── published rule 2: the second point is unchecked in the Aadhaar flow ─────────────────────────────
test("the non-Aadhaar route starts UNCHECKED in the Aadhaar flow", () => {
  const a = enrolmentConsent({ flow: "aadhaar" });
  assert.equal(a.clauses[1].id, "non-aadhaar-route");
  assert.equal(a.clauses[1].defaultChecked, false, "published note 2");
  // …and everything ABDM does tick, is ticked.
  assert.deepEqual(a.clauses.filter((c) => c.defaultChecked).map((c) => c.id),
    ["aadhaar-auth", "link-records", "share-records", "anonymised-public-health"]);
});

test("neither attestation is pre-ticked - agreeing is the patient's act, not a default", () => {
  for (const a of enrolmentConsent().attestations) assert.equal(a.defaultChecked, false);
});

// ── published rule 3: names interpolate ─────────────────────────────────────────────────────────────
test("the attestations name the clinician and the beneficiary", () => {
  const c = enrolmentConsent({ workerName: "Dr A Rao", patientName: "Ramesh Kumar" });
  assert.match(c.attestations[0].text, /^I, Dr A Rao, confirm that I have duly informed/);
  assert.match(c.attestations[1].text, /^I, Ramesh Kumar, have been explained about the consent/);
});

test("with no names supplied the placeholders stay visible rather than reading as a signed statement", () => {
  const c = enrolmentConsent();
  assert.match(c.attestations[0].text, /\(name of healthcare worker\)/);
  assert.match(c.attestations[1].text, /\(beneficiary name\)/);
});

test("the published advisories (patient-facing screen, local language) are carried to the UI", () => {
  const c = enrolmentConsent();
  assert.ok(c.advice.doubleScreen && c.advice.localLanguage);
});

// ── what counts as agreement ────────────────────────────────────────────────────────────────────────
test("agreement needs every default clause AND both attestations", () => {
  assert.equal(consentSatisfied(ALL_AGREED).ok, true);
  for (const drop of ALL_AGREED) {
    const out = consentSatisfied(ALL_AGREED.filter((x) => x !== drop));
    assert.equal(out.ok, false, "dropping " + drop + " must not still count as consent");
    assert.deepEqual(out.missing, [drop]);
  }
});

test("nothing, junk, or a non-array is not agreement", () => {
  for (const bad of [null, undefined, [], "all", {}, ["yes"]]) assert.equal(consentSatisfied(bad).ok, false);
});

test("ticking the non-Aadhaar route does not substitute for the clauses ABDM requires", () => {
  assert.equal(consentSatisfied(["non-aadhaar-route", "worker-explained", "beneficiary-agrees"]).ok, false);
});

// ── recording it ────────────────────────────────────────────────────────────────────────────────────
test("a complete agreement is recorded with its version and the clauses actually agreed", async () => {
  const d = deps();
  const { id } = await recordEnrolConsent(d, { tenantId: "t1", actor: "fb:u1", patientRef: "P-1", agreed: ALL_AGREED });
  assert.ok(id);
  const r = rows(d)[0];
  assert.equal(r.tenant_id, "t1");
  assert.equal(r.actor, "fb:u1");
  assert.equal(r.version, CONSENT_VERSION);
  assert.deepEqual(JSON.parse(r.agreed), ALL_AGREED);
  assert.equal(r.used_at, null);
  // No PHI: the row carries no Aadhaar number, no ABHA number/address and no patient name - only ids
  // the tenant already holds. (`flow: "aadhaar"` names the route taken, and is not an identifier.)
  const durable = JSON.stringify({ ...r, agreed: "", flow: "" });
  assert.ok(!/\d{12}/.test(durable), "no Aadhaar-shaped number");
  assert.ok(!/\d{14}/.test(durable), "no ABHA-shaped number");
  assert.ok(!/@/.test(durable), "no ABHA address");
});

test("an incomplete agreement is REFUSED, never stored as a half-tick", async () => {
  const d = deps();
  await assert.rejects(() => recordEnrolConsent(d, { tenantId: "t1", actor: "fb:u1", agreed: ["aadhaar-auth"] }),
    ConsentRecordError, "a half-consent would read months later as if the patient had agreed");
  assert.equal(rows(d).length, 0);
});

test("a recorded consent is single-use: a second enrolment must ask the patient again", async () => {
  const d = deps();
  const { id } = await recordEnrolConsent(d, { tenantId: "t1", actor: "fb:u1", agreed: ALL_AGREED });
  const claimed = await claimEnrolConsent(d, { tenantId: "t1", consentId: id });
  assert.equal(claimed.id, id);
  assert.equal(rows(d)[0].used_at, NOW);
  await assert.rejects(() => claimEnrolConsent(d, { tenantId: "t1", consentId: id }), ConsentRecordError,
    "one patient's agreement must never be spent on another patient's ABHA");
});

test("a consent belonging to another tenant, or no consent at all, is refused", async () => {
  const d = deps();
  const { id } = await recordEnrolConsent(d, { tenantId: "t1", actor: "fb:u1", agreed: ALL_AGREED });
  await assert.rejects(() => claimEnrolConsent(d, { tenantId: "t2", consentId: id }), ConsentRecordError);
  await assert.rejects(() => claimEnrolConsent(d, { tenantId: "t1", consentId: "made-up" }), ConsentRecordError);
  await assert.rejects(() => claimEnrolConsent(d, { tenantId: "t1", consentId: null }), ConsentRecordError,
    "no consent id means no evidence of consent, which is not consent");
  assert.equal(rows(d)[0].used_at, null, "a refused claim must not burn the record");
});
