/* test/wardsynq-packages.test.mjs - gap-claims-gst-2: package billing (functions/_wardsynq/packages.js).
 *
 * Pure: validatePackage, coverageOf / applyPackage (included at zero, excluded on top, outside flagged), packageFlags
 * (length of stay, pre-authorisation) and documentPack (manual submission, never submitted).
 * Routes: GET /api/queue/ward/packages, GET /ward/package-versions, POST /ward/package-save, POST /ward/stay-package,
 * GET /ward/stay-packages, GET /ward/package-pack, and POST /ward/invoice on a stay with a package.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-packages.test.mjs
 */
import { as, seed, H, T, ORG_ID, OTHER_ADMIN, NURSE, HR, CASHIER, ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const P = await import("../functions/_wardsynq/packages.js");

const PATIENT = "opd-pat-pkg-001", ENC = "enc-pkg-1";
const PKG = {
  scheme: "pmjay", code: "SU007A", name: "Open reduction internal fixation", rate: "45000", expectedLosDays: 2, preAuthRequired: true,
  inclusions: { kinds: ["bed", "nursing", "medication", "investigation"], items: [] }, exclusions: { kinds: [], items: ["IMPLANT"] },
  preAuthDocuments: ["X-ray showing the fracture", "Clinical notes"], claimDocuments: ["Discharge summary", "Post-operative X-ray", "Implant invoice"],
};
const TARIFF = {
  "BED-GEN": { amount: 1000, kind: "bed", description: "General bed" },
  "DR-VISIT": { amount: 500, kind: "visit", description: "Doctor visit" },
  CBC: { amount: 300, kind: "investigation", description: "CBC" },
  PCM: { amount: 10, kind: "medication", description: "Paracetamol" },
  IMPLANT: { amount: 20000, kind: "medication", description: "Locking plate", gstRate: 12, hsnSac: "90211000" },
};

/* ---- pure ----------------------------------------------------------------------------------------- */

test("validatePackage: scheme, code, rupee rate, length of stay, cover lists and a kind both included and excluded", () => {
  const ok = P.validatePackage(PKG);
  assert.equal(ok.error, undefined, ok.message);
  assert.deepEqual([ok.item.rate, ok.item.expectedLosDays, ok.item.preAuthRequired, ok.item.exclusions.items], [45000, 2, true, ["IMPLANT"]]);
  assert.equal(P.validatePackage({ ...PKG, scheme: "nhs" }).error, "bad_scheme");
  assert.equal(P.validatePackage({ ...PKG, scheme: "insurer" }).error, "scheme_name_required");
  assert.equal(P.validatePackage({ ...PKG, rate: "45,000" }).error, "bad_rate");
  assert.equal(P.validatePackage({ ...PKG, rate: "1.005" }).error, "bad_rate");
  assert.equal(P.validatePackage({ ...PKG, expectedLosDays: "2.5" }).error, "bad_los");
  assert.equal(P.validatePackage({ ...PKG, inclusions: { kinds: ["everything"] } }).error, "bad_cover");
  assert.equal(P.validatePackage({ ...PKG, exclusions: { kinds: ["bed"] } }).error, "included_and_excluded");
  assert.equal(P.validatePackage({ ...PKG, preAuthDocuments: "A\nB\n\nA" }).item.preAuthDocuments.length, 2, "one per line, blanks and repeats dropped");
});

test("applyPackage: the package line, covered charges at zero, exclusions billed on top, charges named by neither flagged", () => {
  const assignment = { id: "a1", package: { ...P.validatePackage(PKG).item, id: "pkg-pmjay-su007a", version: 1 } };
  const charges = {
    priced: [
      { code: "BED-GEN", display: "General bed", amount: 1000, line: 1000, sourceType: "Encounter", sourceId: "e:bed:1" },
      { code: "IMPLANT", display: "Locking plate", amount: 20000, line: 20000, sourceType: "MedicationAdministration", sourceId: "m2" },
      { code: "DR-VISIT", display: "Doctor visit", amount: 500, line: 500, sourceType: "Encounter", sourceId: "e:visit:DR-VISIT:1" },
    ],
    unpriced: [{ code: "ORS", display: "ORS", sourceType: "MedicationAdministration", sourceId: "m3" }, { code: "XYZ", display: "XYZ", sourceType: "Other", sourceId: "o1" }],
  };
  const r = P.applyPackage(charges, assignment, TARIFF);
  assert.deepEqual([r.lines[0].line, r.lines[0].sourceType, r.lines[0].packageLine], [45000, "PackageAssignment", true]);
  const by = Object.fromEntries(r.lines.slice(1).map((l) => [l.code, l]));
  assert.deepEqual([by["BED-GEN"].line, by["BED-GEN"].packageIncluded], [0, true]);
  assert.deepEqual([by.IMPLANT.line, by.IMPLANT.packageExcluded], [20000, true]);
  assert.deepEqual([by["DR-VISIT"].line, by["DR-VISIT"].packageOutside], [500, true]);
  assert.deepEqual([by.ORS.line, by.ORS.packageIncluded], [0, true], "an unpriced medicine the package covers needs no price");
  assert.deepEqual(r.unpriced.map((u) => [u.code, u.packageOutside]), [["XYZ", true]]);
  assert.deepEqual(r.counts, { included: 2, excluded: 1, outside: 2 });
});

test("packageFlags and documentPack: length of stay exceeded, pre-authorisation missing, and a pack that is manual only", () => {
  const pkg = { ...P.validatePackage(PKG).item, id: "p", version: 3 };
  const enc = { id: ENC, patientId: PATIENT, periodStart: "2026-09-10T08:00:00Z" };
  const now = Date.parse("2026-09-13T09:00:00Z");
  const noAuth = P.packageFlags({ package: pkg, preAuthId: null }, enc, null, now);
  assert.deepEqual([noAuth.stayDays, noAuth.losExceeded, noAuth.preAuthState, noAuth.preAuthProblem, noAuth.manualPortal], [4, true, "missing", true, true]);
  const approved = P.packageFlags({ package: { ...pkg, expectedLosDays: 5 }, preAuthId: "pa" }, enc, { state: "approved" }, now);
  assert.deepEqual([approved.losExceeded, approved.preAuthState, approved.preAuthProblem], [false, "approved", false]);
  assert.equal(P.packageFlags({ package: pkg, preAuthId: "pa" }, enc, undefined, now).preAuthState, "unreadable");

  const pack = P.documentPack({ assignment: { package: pkg, patientId: PATIENT, beneficiaryId: null }, encounter: enc, preAuth: null, flags: noAuth, billed: [] });
  assert.equal(pack.manualSubmission, true);
  assert.match(pack.notice, /not connected to the PM-JAY Transaction Management System/);
  assert.match(pack.notice, /Nothing in this pack has been sent or submitted/);
  assert.deepEqual(pack.claimDocuments, PKG.claimDocuments);
  assert.equal(pack.checklist.find((c) => /Beneficiary ID/.test(c.text)).state, "not_done");
  assert.ok(pack.fields.some((f) => f.label === "Package code" && f.value === "SU007A"));
  assert.ok(!JSON.stringify(pack).match(/"state":"submitted"|"submitted":true/), "nothing is marked submitted");
});

/* ---- routes --------------------------------------------------------------------------------------- */

async function seedStay(days) {
  const start = new Date(Date.now() - (days || 3) * 86400000 + 60000).toISOString();
  await H.RECORD.append(T, [
    { resourceType: "Encounter", id: ENC, version: 1, patientId: PATIENT, class: "IPD", status: "in-progress", periodStart: start, location: { ward: "W1" } },
    { resourceType: "MedicationAdministration", id: "ma-pcm", version: 1, patientId: PATIENT, encounterId: ENC, drugCode: "PCM", drug: "Paracetamol", status: "administered", givenAt: start },
    { resourceType: "MedicationAdministration", id: "ma-imp", version: 1, patientId: PATIENT, encounterId: ENC, drugCode: "IMPLANT", drug: "Locking plate", status: "administered", givenAt: start },
    { resourceType: "DiagnosticReport", id: "dr-cbc", version: 1, patientId: PATIENT, encounterId: ENC, code: "CBC", status: "final", reportedAt: start },
    { resourceType: "PreAuthorisation", id: "pa-1", version: 1, patientId: PATIENT, treatment: "ORIF", state: "approved", scheme: "PM-JAY", decidedAt: start },
    { resourceType: "PreAuthorisation", id: "pa-other", version: 1, patientId: "someone-else", treatment: "X", state: "approved", decidedAt: start },
  ]);
}

test("negative authorization: 401 without a session, 403 for the wrong role or another hospital, nothing written", async () => {
  seed({ tariff: TARIFF });
  await seedStay();
  const before = writesNow();
  const posts = {
    "/ward/package-save": [{ orgId: ORG_ID, ...PKG }, [CASHIER, NURSE, HR, OTHER_ADMIN]],
    "/ward/stay-package": [{ orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: "pkg-pmjay-su007a" }, [NURSE, HR, OTHER_ADMIN]],
  };
  for (const [path, [body, refused]] of Object.entries(posts)) {
    assert.equal((await as(null, path, "POST", body)).__status, 401, path);
    for (const who of refused) assert.equal((await as(who, path, "POST", body)).__status, 403, `${path} ${who}`);
  }
  for (const path of [`/ward/packages?orgId=${ORG_ID}`, `/ward/package-versions?orgId=${ORG_ID}&id=pkg-pmjay-su007a`,
    `/ward/stay-packages?orgId=${ORG_ID}&patientId=${PATIENT}`, `/ward/package-pack?orgId=${ORG_ID}&patientId=${PATIENT}&encounterId=${ENC}`]) {
    assert.equal((await as(null, path)).__status, 401, path);
    for (const who of [NURSE, HR, OTHER_ADMIN]) assert.equal((await as(who, path)).__status, 403, `${path} ${who}`);
  }
  assert.equal(writesNow(), before, "nothing written by any refused call");
  const ok = await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG });
  assert.equal(ok.__status, 200, ok.__text);
  assert.equal((await as(CASHIER, `/ward/packages?orgId=${ORG_ID}`)).packages.length, 1, "billing reads the master");
});

test("package master: created, changed only with a reason and the version read, every version kept and audited, withdrawn", async () => {
  seed();
  const c = await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG });
  assert.equal(c.package.id, "pkg-pmjay-su007a");
  assert.equal((await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG })).__status, 409, "same scheme and code twice");
  const change = { orgId: ORG_ID, ...PKG, id: c.package.id, rate: "48000" };
  assert.equal((await as(ADMIN, "/ward/package-save", "POST", { ...change, expectedVersion: 1 })).error, "reason_required");
  assert.equal((await as(ADMIN, "/ward/package-save", "POST", { ...change, expectedVersion: 7, reason: "HBP revision" })).__status, 409);
  assert.equal((await as(ADMIN, "/ward/package-save", "POST", { ...change, code: "OTHER", expectedVersion: 1, reason: "x" })).error, "identity_fixed");
  const u = await as(ADMIN, "/ward/package-save", "POST", { ...change, expectedVersion: 1, reason: "HBP revision" });
  assert.deepEqual([u.package.version, u.package.rate, u.package.changeReason], [2, 48000, "HBP revision"]);
  const w = await as(ADMIN, "/ward/package-save", "POST", { ...change, expectedVersion: 2, reason: "Scheme dropped it", active: false });
  assert.equal(w.package.active, false);
  const h = await as(CASHIER, `/ward/package-versions?orgId=${ORG_ID}&id=${c.package.id}`);
  assert.deepEqual(h.versions.map((v) => [v.version, v.rate, v.active]), [[1, 45000, true], [2, 48000, true], [3, 48000, false]]);
  const actions = H.RECORD.audit.filter((a) => a.connectorId === "wardsynq-packages").map((a) => [a.action, a.scope.changed.join(",")]);
  assert.deepEqual(actions.map((a) => a[0]), ["package.create", "package.update", "package.withdraw"]);
  assert.equal(H.RECORD.audit.find((a) => a.action === "package.update").scope.rateFrom, 45000);
});

test("a stay on a package: POST /ward/stay-package then POST /ward/invoice bills the rate plus exclusions, covered charges at zero, flags said", async () => {
  seed({ tariff: TARIFF });
  await seedStay(3);
  const pkg = (await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG })).package;
  assert.equal((await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id, preAuthId: "pa-other" })).error, "preauth_not_this_patient");
  assert.equal((await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: "someone-else", encounterId: ENC, packageId: pkg.id })).error, "encounter_not_this_patient");
  const a = await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id, preAuthId: "pa-1", beneficiaryId: "PMJAY-1234" });
  assert.equal(a.__status, 200, a.__text);
  assert.deepEqual([a.assignment.package.rate, a.assignment.package.version, a.assignment.version], [45000, 1, 1]);
  // A later change at the master does not move the stay's copy.
  await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG, id: pkg.id, rate: "50000", expectedVersion: 1, reason: "revision" });

  const list = await as(CASHIER, `/ward/stay-packages?orgId=${ORG_ID}&patientId=${PATIENT}`);
  const s = list.assignments[0];
  assert.deepEqual([s.flags.losExceeded, s.flags.stayDays, s.flags.preAuthState, s.preAuth.state], [true, 3, "approved", "approved"]);
  assert.deepEqual(s.split.excluded.map((x) => x.display), ["Locking plate"]);
  assert.deepEqual(s.split.outside.map((x) => x.display), ["Doctor visit", "Doctor visit", "Doctor visit"]);

  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(inv.written, 1, inv.__text);
  const pl = inv.lines.find((l) => l.packageLine);
  assert.deepEqual([pl.line, pl.code, pl.taxExempt], [45000, "SU007A", true]);
  const included = inv.lines.filter((l) => l.packageIncluded);
  assert.ok(included.length >= 5 && included.every((l) => l.line === 0 && !l.taxKind), "3 bed days, CBC and paracetamol at zero, untaxed");
  const imp = inv.lines.find((l) => l.code === "IMPLANT");
  assert.deepEqual([imp.line, imp.packageExcluded], [20000, true]);
  assert.equal(inv.charged, 45000 + 20000 + 1500, "rate + exclusion + three outside visits; the implant is exempt on an inpatient bill");
  assert.deepEqual([inv.package.code, inv.package.rate, inv.package.losExceeded, inv.package.preAuthState, inv.package.beneficiaryId], ["SU007A", 45000, true, "approved", "PMJAY-1234"]);

  const again = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(again.written, 0, "the package is never billed twice");
  const change = await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id, reason: "wrong", expectedVersion: 1 });
  assert.equal(change.error, "package_already_billed");
  assert.equal((await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, remove: true, reason: "x", expectedVersion: 1 })).error, "package_already_billed");

  const pack = await as(CASHIER, `/ward/package-pack?orgId=${ORG_ID}&patientId=${PATIENT}&encounterId=${ENC}`);
  assert.equal(pack.__status, 200, pack.__text);
  assert.equal(pack.pack.manualSubmission, true);
  assert.ok(pack.pack.fields.some((f) => f.label === "Beneficiary ID" && f.value === "PMJAY-1234"));
  assert.ok(pack.pack.fields.some((f) => f.label === "Excluded items billed" && /Locking plate 20000/.test(f.value)));
});

test("a stay with an itemised bill is refused a package; a package change needs a reason; removal is recorded as a version", async () => {
  seed({ tariff: TARIFF });
  await seedStay(1);
  const pkg = (await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG, preAuthRequired: false })).package;
  const a = await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id });
  assert.equal(a.__status, 200, a.__text);
  assert.equal((await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id, expectedVersion: 1 })).error, "reason_required");
  const rm = await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, remove: true, reason: "Patient chose to pay privately", expectedVersion: 1 });
  assert.deepEqual([rm.assignment.status, rm.assignment.version], ["removed", 2]);
  assert.equal((await H.RECORD.history(T, "PackageAssignment", P.assignmentIdFor(ENC))).length, 2);
  const itemised = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(itemised.written, 1, itemised.__text);
  assert.ok(!itemised.lines.some((l) => l.packageCode), "a removed package bills nothing");
  const late = await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id, expectedVersion: 2, reason: "back" });
  assert.equal(late.error, "stay_already_billed_itemised");
  const withdrawn = await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG, preAuthRequired: false, id: pkg.id, expectedVersion: 1, reason: "gone", active: false });
  assert.equal(withdrawn.package.active, false);
});

test("a discharged stay on a package is still billed by its package when the cashier names no stay; a late charge on it stays covered", async () => {
  seed({ tariff: TARIFF });
  await seedStay(3);
  const pkg = (await as(ADMIN, "/ward/package-save", "POST", { orgId: ORG_ID, ...PKG })).package;
  assert.equal((await as(CASHIER, "/ward/stay-package", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, packageId: pkg.id, preAuthId: "pa-1" })).__status, 200);
  const enc = await H.RECORD.latest(T, "Encounter", ENC);
  await H.RECORD.append(T, [{ ...enc, version: 2, status: "finished", periodEnd: new Date().toISOString() }]);
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(inv.written, 1, inv.__text);
  assert.equal(inv.encounterId, ENC);
  assert.ok(inv.lines.some((l) => l.packageLine && l.line === 45000));
  assert.ok(!inv.lines.some((l) => l.code === "PCM" && l.line > 0), "a covered medicine is not billed item by item");
  // A result released after the bill is covered by the package; an outpatient test after discharge is billed on its own.
  await H.RECORD.append(T, [{ resourceType: "DiagnosticReport", id: "dr-late", version: 1, patientId: PATIENT, encounterId: ENC, code: "CBC", status: "final", reportedAt: new Date().toISOString() }]);
  const late = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(late.written, 0, late.__text);
  await H.RECORD.append(T, [{ resourceType: "DiagnosticReport", id: "dr-opd", version: 1, patientId: PATIENT, encounterId: "opd-visit-9", code: "CBC", status: "final", reportedAt: new Date().toISOString() }]);
  const opd = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(opd.written, 1, opd.__text);
  assert.deepEqual(opd.lines.map((l) => [l.sourceId, l.line]), [["dr-opd", 300]], "only the outpatient test, never the package stay's late result");
  assert.equal(opd.package, null);
});
