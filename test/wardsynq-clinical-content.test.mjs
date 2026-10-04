/* test/wardsynq-clinical-content.test.mjs - owner decisions 2026-10-04 on WardSynQ clinical content:
 *   - CAUTI offers SUTI 2 (NHSN ch.7 Table 1, a patient 1 year of age or less), so its fingerprint changes and it is
 *     UNAPPROVED again;
 *   - ventilated patients are surveyed by NHSN location: VAE (VAC, IVAC, PVAP; ch.10) on adult stays, VAP (PNU1 to PNU3;
 *     ch.6) on paediatric stays only, neither on a NICU stay; each rate and NABH KPI 14 count their own ventilator days;
 *   - the infection control "awaiting clinical sign-off" notice is read from the seed sign-off records;
 *   - the dialysis adequacy formulas (URR, single-pool Kt/V) are a seed list, UNAPPROVED until signed.
 *
 * Routes (the real router, ops harness): POST /api/queue/ward/line, POST /ward/hai-case, GET /ward/infection-control.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-clinical-content.test.mjs
 */
import { as, seedHospital, recordsOf, putDoc, H, TENANT, U, ORG } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const IC = await import("../functions/_wardsynq/infection-control.js");
const S = await import("../functions/_wardsynq/seed-signoff.js");
const { computeNabhIndicators, monthWindows } = await import("../functions/_wardsynq/compliance.js");

/* The fingerprints the owner's 2026-10-04 review page listed for origin/main 51d12faf0, before these changes. */
const OLD = { CLABSI: "a343246a5256f38dbe5fc033614d93f409d45101ab2e49c982f0d8f89b1dea55", CAUTI: "1b0f1376c7a89cf7d5121cb7936f3557c3eb746aa9e1cb99e5e28a7c35f09a02",
  VAP: "163f787e4478c397a7037119d369794084345ccffedacee32814c9a8882aa43d", SSI: "9414bb523c0a3f676573567bd84bc629517617d2d6b5aa6d918fabda2f0d9e7d" };

/* ---------------------------------------------------------------- pure */

test("HAI criteria: CAUTI names SUTI 2; VAE holds VAC, IVAC and PVAP from ch.10 on adult stays with no NABH number; VAP is paediatric only", () => {
  assert.deepEqual([...IC.HAI_EVENTS.CAUTI.criteria], ["SUTI 1a", "SUTI 2", "ABUTI"]);
  assert.match(IC.HAI_EVENTS.CAUTI.source, /ch\.7 Urinary Tract Infection Event, Table 1/);
  const vae = IC.HAI_EVENTS.VAE;
  assert.deepEqual([...vae.criteria], ["VAC", "IVAC", "PVAP"]);
  assert.equal(vae.device, "ventilator"); assert.equal(vae.population, "adult"); assert.equal(vae.nabh, null);
  assert.match(vae.source, /NHSN Patient Safety Component Manual, January 2026, ch\.10 Ventilator-Associated Event \(VAE\)/);
  assert.equal(IC.HAI_EVENTS.VAP.population, "paediatric"); assert.equal(IC.HAI_EVENTS.VAP.nabh, 14);
  assert.deepEqual([...IC.HAI_EVENTS.VAP.criteria], ["PNU1", "PNU2", "PNU3"]);
  assert.equal(IC.populationOf({ class: "NICU" }), "neonatal");
  assert.equal(IC.populationOf({ class: "PEDIATRICS" }), "paediatric");
  for (const k of ["IPD", "ICU", "MATERNITY"]) assert.equal(IC.populationOf({ class: k }), "adult", k);
  assert.equal(IC.populationOf(null), null);
});

test("seed fingerprints: CAUTI and VAP changed, so they show UNAPPROVED again; CLABSI and SSI kept the fingerprint the owner reviewed", async () => {
  const hai = (await S.seedStatus([])).find((l) => l.id === "hai-criteria");
  const hash = (id) => hai.items.find((i) => i.id === id).contentHash;
  assert.deepEqual(hai.items.map((i) => i.id), ["CAUTI", "CLABSI", "SSI", "VAE", "VAP"]);
  assert.equal(hash("CLABSI"), OLD.CLABSI);
  assert.equal(hash("SSI"), OLD.SSI);
  assert.notEqual(hash("CAUTI"), OLD.CAUTI, "SUTI 2 added");
  assert.notEqual(hash("VAP"), OLD.VAP, "restricted to paediatric stays");
  // A sign-off of the old CAUTI content does not sign the new one.
  const old = { id: S.signoffId("hai-criteria", "CAUTI", OLD.CAUTI), listId: "hai-criteria", itemId: "CAUTI", contentHash: OLD.CAUTI };
  assert.equal((await S.itemSignoffState("hai-criteria", [old])).CAUTI, "unapproved");
});

test("seed list dialysis-adequacy: URR and single-pool Kt/V, each with the code that computes it, UNAPPROVED until signed; unreadable records sign nothing", async () => {
  const l = (await S.seedStatus([])).find((x) => x.id === "dialysis-adequacy");
  assert.ok(l, "the list exists");
  assert.deepEqual(l.items.map((i) => [i.id, i.status]), [["urr", "unapproved"], ["sp-ktv", "unapproved"]]);
  const k = l.items.find((i) => i.id === "sp-ktv");
  assert.match(k.content, /Daugirdas JT\. Second generation logarithmic estimates of single-pool variable volume Kt\/V: an analysis of error\. J Am Soc Nephrol 1993;4\(5\):1205-13/);
  assert.match(k.content, /fn:function ktv\(/, "the arithmetic is part of the fingerprint");
  assert.match(l.items.find((i) => i.id === "urr").content, /fn:function urr\(/);
  const rec = { id: S.signoffId("dialysis-adequacy", "sp-ktv", k.contentHash), listId: "dialysis-adequacy", itemId: "sp-ktv", contentHash: k.contentHash };
  assert.deepEqual(await S.itemSignoffState("dialysis-adequacy", [rec]), { urr: "unapproved", "sp-ktv": "signed" });
  assert.deepEqual(await S.itemSignoffState("dialysis-adequacy", null), { urr: "signoffs-unreadable", "sp-ktv": "signoffs-unreadable" });
});

test("the awaiting sign-off notice names only the events not yet signed, and says so when the records cannot be read", () => {
  const all = Object.fromEntries(Object.keys(IC.HAI_EVENTS).map((k) => [k, "signed"]));
  assert.equal(IC.unapprovedNotice(all), null);
  assert.equal(IC.unapprovedNotice({ ...all, CAUTI: "unapproved" }), "The NHSN criterion names for CAUTI are seed content awaiting clinical sign-off.");
  assert.match(IC.unapprovedNotice(null), /could not be read/);
  assert.match(IC.unapprovedNotice({ ...all, VAE: "signoffs-unreadable" }), /could not be read/);
});

/* ---------------------------------------------------------------- through the router */

const META = () => { const at = new Date().toISOString(); return { meta: { recordedAt: at }, writtenBy: { id: "seed", kind: "human", at } }; };
const ADULT = "opd-pat-mrn-301", CHILD = "opd-pat-mrn-302", BABY = "opd-pat-mrn-303";
async function setup() {
  seedHospital();
  await H.RECORD.append(TENANT, [
    { resourceType: "Patient", id: ADULT, version: 1, mrn: "MRN-301", name: "Adult One", dob: "1970-01-01", sex: "female", ...META() },
    { resourceType: "Patient", id: CHILD, version: 1, mrn: "MRN-302", name: "Child Two", dob: "2020-01-01", sex: "male", ...META() },
    { resourceType: "Patient", id: BABY, version: 1, mrn: "MRN-303", name: "Baby Three", dob: "2026-07-25", sex: "female", ...META() },
    { resourceType: "Encounter", id: "enc-icu", version: 1, patientId: ADULT, class: "ICU", status: "in-progress", periodStart: "2026-07-30T05:00:00Z", periodEnd: null, ...META() },
    { resourceType: "Encounter", id: "enc-paed", version: 1, patientId: CHILD, class: "PEDIATRICS", status: "in-progress", periodStart: "2026-07-30T05:00:00Z", periodEnd: null, ...META() },
    { resourceType: "Encounter", id: "enc-nicu", version: 1, patientId: BABY, class: "NICU", status: "in-progress", periodStart: "2026-07-30T05:00:00Z", periodEnd: null, ...META() },
  ]);
  const vent = async (encounterId, patientId) => {
    const r = await as(U.DOCTOR, "/ward/line", "POST", { orgId: ORG, encounterId, patientId, line: { type: "ETT", site: "Oral", deviceClass: "ventilator", insertedAt: "2026-08-01T05:00:00Z" } });
    assert.equal(r.__status, 200, JSON.stringify(r));
    return r.lineId;
  };
  return { adult: await vent("enc-icu", ADULT), child: await vent("enc-paed", CHILD), baby: await vent("enc-nicu", BABY) };
}
const view = () => as(U.ICN, `/ward/infection-control?orgId=${ORG}&month=2026-08`);
const open = (event, patientId, lineId) => as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "open", event, patientId, lineId, dateOfEvent: "2026-08-06" });

test("POST /ward/hai-case: VAE only on an adult stay's ventilator line, VAP only on a paediatric stay's, neither on a NICU stay; nothing written by a refusal", async () => {
  const L = await setup();
  const vapAdult = await open("VAP", ADULT, L.adult);
  assert.equal(vapAdult.__status, 422); assert.equal(vapAdult.error, "wrong_population"); assert.equal(vapAdult.population, "adult");
  assert.match(vapAdult.detail, /open a VAE instead/);
  const vaeChild = await open("VAE", CHILD, L.child);
  assert.equal(vaeChild.error, "wrong_population"); assert.match(vaeChild.detail, /open a VAP instead/);
  const nicu = await open("VAP", BABY, L.baby);
  assert.equal(nicu.error, "wrong_population"); assert.equal(nicu.population, "neonatal"); assert.match(nicu.detail, /neither VAP nor VAE in a neonatal location/);
  assert.equal((await open("VAE", BABY, L.baby)).error, "wrong_population");
  assert.equal((await recordsOf("HaiCase")).length, 0, "refusals wrote nothing");

  const vae = await open("VAE", ADULT, L.adult);
  assert.equal(vae.__status, 200, JSON.stringify(vae));
  assert.equal(vae.eligibility.deviceDay, 6); assert.equal(vae.eligibility.eligible, true, "the same device-day rule as VAP");
  assert.equal((await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "confirm", caseId: vae.caseId, criteriaMet: ["PNU1"] })).error, "unknown_criteria");
  const c = await as(U.ICN, "/ward/hai-case", "POST", { orgId: ORG, action: "confirm", caseId: vae.caseId, criteriaMet: ["PVAP"] });
  assert.equal(c.__status, 200, JSON.stringify(c));
  const vap = await open("VAP", CHILD, L.child);
  assert.equal(vap.__status, 200, JSON.stringify(vap));
  const stored = (await recordsOf("HaiCase")).find((x) => x.id === vae.caseId);
  assert.equal(stored.population, "adult");
  assert.match(stored.definitionSource, /ch\.10 Ventilator-Associated Event/);

  // Rates: each ventilator event over its own stays' ventilator days (31 August days for one line each).
  const v = await view();
  assert.equal(v.__status, 200, JSON.stringify(v));
  const rate = (e) => v.rates.find((x) => x.event === e);
  assert.deepEqual([rate("VAE").numerator, rate("VAE").denominator, rate("VAE").population, rate("VAE").nabh], [1, 31, "adult", null]);
  assert.deepEqual([rate("VAP").numerator, rate("VAP").denominator, rate("VAP").population], [0, 31, "paediatric"], "the NICU and adult ventilator days are not VAP days");
  assert.ok(v.events.some((e) => e.id === "VAE" && e.criteria.includes("IVAC")));

  // NABH KPI 14 (VAP) counts paediatric ventilator days only.
  const rows = {};
  for (const t of ["HaiCase", "LineRecord", "Encounter"]) rows[t] = await recordsOf(t);
  const nabh = computeNabhIndicators({ rows, unreadable: {}, windows: monthWindows(Date.UTC(2026, 8, 20), 2, 330) });
  const k14 = nabh.find((i) => i.no === 14).months.find((m) => m.month === "2026-08");
  assert.deepEqual([k14.numerator, k14.denominator], [0, 31]);
});

test("GET /ward/infection-control: the awaiting sign-off notice is read from the seed sign-off records and clears for signed events", async () => {
  await setup();
  let v = await view();
  assert.equal(v.unapproved, "The NHSN criterion names for CLABSI, CAUTI, VAP, VAE, SSI are seed content awaiting clinical sign-off.");
  assert.ok(v.events.every((e) => e.signoff === "unapproved"));
  const hai = (await S.seedStatus([])).find((l) => l.id === "hai-criteria");
  const sign = (it) => putDoc("q_seed_signoffs/" + S.signoffId("hai-criteria", it.id, it.contentHash),
    { listId: "hai-criteria", itemId: it.id, contentHash: it.contentHash, version: it.version, signedBy: S.SIGNATORY, signedAt: "2026-10-04T10:00:00Z", text: "Signed off" });
  hai.items.filter((it) => it.id !== "CAUTI").forEach(sign);
  v = await view();
  assert.equal(v.unapproved, "The NHSN criterion names for CAUTI are seed content awaiting clinical sign-off.");
  assert.equal(v.events.find((e) => e.id === "VAE").signoff, "signed");
  sign(hai.items.find((it) => it.id === "CAUTI"));
  v = await view();
  assert.equal(v.unapproved, null, "every event signed: no notice");
});
