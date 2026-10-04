/* test/wardsynq-opening-balance.test.mjs - opening balances for stays open at switch-over (owner decision 2026-10-04).
 *
 * Routes: POST /api/queue/ward/opening-balance (one stay) and POST /api/queue/ward/legacy-import kind openingBalances
 * (a CSV of the old system's open stays). Both need staff.admin AND billing.charge: no session 401; nurse, cashier (no
 * staff.admin), hr (no billing.charge) and another hospital's admin 403, with nothing written. One line per stay: the same
 * balance again is matched and writes nothing, a different one is refused. The line is the first on the stay's bill,
 * carries no GST and sits in no GST document, and deposits and payments settle it like any charge.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-opening-balance.test.mjs
 */
import { as, seed, docs, H, T, ORG_ID, ADMIN, NURSE, HR, CASHIER, DOCTOR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { openingLine, validateOpeningBalance } = await import("../functions/_wardsynq/opening-balance.js");
const { applyPackage } = await import("../functions/_wardsynq/packages.js");
const { billState } = await import("../functions/_wardsynq/migrate-discharge.js");

const ROOM = { "PVT-ROOM": { amount: 6000, kind: "bed", description: "Private room", currency: "INR" } };
const OB = "/ward/opening-balance", IMP = "/ward/legacy-import";
const audits = (action) => [...docs.values()].filter((d) => d.fields && d.fields.action === action);
const records = (type) => H.RECORD._rows.filter((r) => r.resourceType === type);
let n = 0;
async function admitted(admit = true) {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Switchover Patient " + n, mobile: "98765" + String(30000 + n), gender: "female", ageYears: 60 });
  assert.equal(reg.__status, 200, reg.__text);
  if (!admit) return { reg };
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: String(n) });
  assert.equal(adm.__status, 200, adm.__text);
  return { reg, adm };
}
const carry = (who, body) => as(who, OB, "POST", { orgId: ORG_ID, amount: "45,000.50", legacyBillRef: "OLD/IP/7781", asOf: "2026-10-01", ...body });

test("POST /api/queue/ward/opening-balance: 401, and 403 for nurse, cashier without staff.admin, hr without billing.charge and another hospital, with nothing written; bad input is refused by field", async () => {
  seed({ tariff: ROOM });
  const { reg } = await admitted();
  const before = writesNow();
  assert.equal((await as(null, OB, "POST", { orgId: ORG_ID, mrn: reg.mrn, amount: "1", legacyBillRef: "X", asOf: "2026-10-01" })).__status, 401);
  assert.equal((await carry(NURSE, { mrn: reg.mrn })).__status, 403);
  assert.equal((await carry(CASHIER, { mrn: reg.mrn })).__status, 403, "billing.charge alone is not enough");
  assert.equal((await carry(HR, { mrn: reg.mrn })).__status, 403, "staff.admin alone is not enough");
  assert.equal((await as(OTHER_ADMIN, OB, "POST", { orgId: ORG_ID, mrn: reg.mrn, amount: "1", legacyBillRef: "X", asOf: "2026-10-01" })).__status, 403);
  assert.equal(writesNow(), before, "nothing was written or read into the record by a refusal");

  assert.equal((await carry(ADMIN, { mrn: reg.mrn, amount: "0" })).error, "bad_amount");
  assert.equal((await carry(ADMIN, { mrn: reg.mrn, amount: "-5" })).error, "bad_amount");
  assert.equal((await carry(ADMIN, { mrn: reg.mrn, amount: "12.345" })).error, "bad_amount");
  assert.equal((await carry(ADMIN, { mrn: reg.mrn, legacyBillRef: "" })).error, "legacy_bill_ref_required");
  assert.equal((await carry(ADMIN, { mrn: reg.mrn, asOf: "2099-01-01" })).error, "bad_as_of");
  assert.equal((await carry(ADMIN, { mrn: reg.mrn, asOf: "2026-02-30" })).error, "bad_as_of");
  const notAdmitted = await admitted(false);
  const none = await carry(ADMIN, { mrn: notAdmitted.reg.mrn });
  assert.deepEqual([none.__status, none.error], [409, "no_open_stay"], "a balance is only carried onto a stay that is open here");
  assert.equal(records("OpeningBalance").length, 0);
});

test("one line per stay: entered, entered again (matched, nothing written), a different balance refused; audited and attributed", async () => {
  seed({ tariff: ROOM });
  const { reg, adm } = await admitted();
  const ok = await carry(ADMIN, { mrn: reg.mrn });
  assert.equal(ok.__status, 200, ok.__text);
  assert.equal(ok.written, 1);
  assert.deepEqual([ok.openingBalance.amountPaise, ok.openingBalance.legacyBillRef, ok.openingBalance.asOf, ok.openingBalance.encounterId], [4500050, "OLD/IP/7781", "2026-10-01", adm.encounterId]);
  assert.ok(ok.openingBalance.enteredBy, "who entered it is on the record");
  const again = await carry(ADMIN, { patientId: adm.patientId });
  assert.deepEqual([again.__status, again.written, again.matched], [200, 0, true], "idempotent per stay");
  const differ = await carry(ADMIN, { mrn: reg.mrn, amount: "45000" });
  assert.deepEqual([differ.__status, differ.error, differ.existing.amountPaise], [409, "opening_balance_exists", 4500050]);
  assert.equal(records("OpeningBalance").length, 1, "one version, never replaced");
  assert.equal(audits("opening_balance").length, 1, "the hospital's audit log names the entry once");
  assert.ok(H.RECORD.audit.some((a) => JSON.stringify(a).includes('"resourceType":"OpeningBalance"')), "the record write is audited");
});

test("the invoice: the opening balance is the first line, untaxed and outside the GST document; new charges are taxed as before; deposits and payments settle it; it is never billed twice", async () => {
  seed({ tariff: ROOM });
  const { reg, adm } = await admitted();
  assert.equal((await carry(ADMIN, { mrn: reg.mrn })).__status, 200);
  const ch = await as(CASHIER, `/ward/charges?orgId=${ORG_ID}&patientId=${adm.patientId}&encounterId=${adm.encounterId}`);
  assert.equal(ch.__status, 200, ch.__text);
  assert.equal(ch.priced[0].code, "OPENING-BALANCE", "the cashier sees it before raising");
  assert.equal(ch.total, 51000.5);

  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: adm.patientId, encounterId: adm.encounterId });
  assert.equal(inv.__status, 200, inv.__text);
  const [first, room] = inv.lines;
  assert.deepEqual([first.code, first.kind, first.line, first.sourceType], ["OPENING-BALANCE", "opening_balance", 45000.5, "OpeningBalance"]);
  assert.match(first.display, /OLD\/IP\/7781/);
  assert.equal(first.taxKind, undefined, "not taxed again");
  assert.equal(first.tax, undefined);
  assert.deepEqual([room.code, room.tax, room.cgst, room.sgst], ["PVT-ROOM", 300, 150, 150], "a room above Rs 5,000 a day is taxed exactly as before");
  assert.equal(inv.documents.length, 1);
  assert.deepEqual([inv.documents[0].type, inv.documents[0].lineIndexes, inv.documents[0].taxable, inv.documents[0].tax], ["tax_invoice", [1], 6000, 300], "the GST document holds the new supply only");
  assert.match(inv.documentNumber, /^INV\//);
  assert.equal(inv.balance, 51300.5, "owed: the carried balance plus the new charges and their GST");

  const dep = await as(CASHIER, "/ward/invoice-deposit", "POST", { orgId: ORG_ID, invoiceId: inv.invoiceId, amount: 10000 });
  assert.equal(dep.__status, 200, dep.__text);
  assert.equal(dep.balance, 41300.5);
  const pay = await as(CASHIER, "/ward/invoice-payment", "POST", { orgId: ORG_ID, invoiceId: inv.invoiceId, amount: 41300.5 });
  assert.equal(pay.__status, 200, pay.__text);
  assert.deepEqual([pay.balance, pay.status], [0, "paid"]);

  const again = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: adm.patientId, encounterId: adm.encounterId });
  assert.equal(again.skipped, "already_invoiced", "the carried balance is on one bill only");
});

test("a bill with only the carried balance takes no GST number and has no GST document", async () => {
  seed({});
  const { reg, adm } = await admitted();
  assert.equal((await carry(ADMIN, { mrn: reg.mrn, amount: "1200" })).__status, 200);
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: adm.patientId, encounterId: adm.encounterId });
  assert.equal(inv.__status, 200, inv.__text);
  assert.deepEqual(inv.lines.map((l) => [l.code, l.line]), [["OPENING-BALANCE", 1200]]);
  assert.equal(inv.documentNumber, null);
  assert.deepEqual(inv.documents, []);
  assert.equal(inv.balance, 1200);
});

test("POST /api/queue/ward/legacy-import kind openingBalances: refused without both doors; dry run row by row writes nothing; commit writes exactly the plan; re-import matches; a different balance is invalid", async () => {
  seed({ tariff: ROOM });
  const a = await admitted();
  const b = await admitted();
  const notAdmitted = await admitted(false);
  // A patient loaded from the old system keeps its legacy number; the CSV may name them by it.
  const pImp = { orgId: ORG_ID, kind: "patients", csv: "HIS No,Name,Mobile,Sex,DOB\nL-900,Legacy Person,9876539999,F,14/02/1950\n", mapping: { legacyMrn: 0, name: 1, mobile: 2, gender: 3, birthDate: 4, dateOrder: "dmy" } };
  const pDry = await as(ADMIN, IMP, "POST", pImp);
  const pDone = await as(ADMIN, IMP, "POST", { ...pImp, commit: true, confirmCount: pDry.counts.create, planId: pDry.planId });
  assert.equal(pDone.written, 1, pDone.__text);
  const legacy = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: pDone.rows[0].mrn, ward: "Medical A", bed: "90" });
  assert.equal(legacy.__status, 200, legacy.__text);
  assert.equal((await carry(ADMIN, { mrn: b.reg.mrn, amount: "999" })).__status, 200, "b already carries a different balance");

  const csv = "MRN,Balance,Old bill,As of\n" +
    `${a.reg.mrn},"45,000.50",OLD/IP/7781,01/10/2026\n` +
    "L-900,1200,OLD/IP/7782,01/10/2026\n" +
    `${b.reg.mrn},5000,OLD/IP/7783,01/10/2026\n` +
    `${notAdmitted.reg.mrn},100,OLD/IP/7784,01/10/2026\n` +
    `${a.reg.mrn},7,OLD/IP/7785,01/10/2026\n` +
    "SMD-NOBODY,100,OLD/IP/7786,31/02/2026\n";
  const mapping = { patientRef: 0, amount: 1, legacyBillRef: 2, asOf: 3, dateOrder: "dmy" };
  const body = (extra) => ({ orgId: ORG_ID, kind: "openingBalances", csv, mapping, ...(extra || {}) });

  const before = writesNow();
  assert.equal((await as(null, IMP, "POST", body())).__status, 401);
  assert.equal((await as(NURSE, IMP, "POST", body())).__status, 403);
  assert.equal((await as(CASHIER, IMP, "POST", body())).__status, 403, "the import is hospital administration");
  assert.equal((await as(HR, IMP, "POST", body())).__status, 403, "hr holds staff.admin but not billing.charge");
  assert.equal((await as(OTHER_ADMIN, IMP, "POST", body())).__status, 403);
  assert.equal(writesNow(), before);

  const dry = await as(ADMIN, IMP, "POST", body());
  assert.equal(dry.__status, 200, dry.__text);
  const st = Object.fromEntries(dry.rows.map((r) => [r.row, r]));
  assert.equal(st[2].status, "create");
  assert.equal(st[3].status, "create", "found by the legacy MR number");
  assert.equal(st[4].status, "invalid"); assert.match(st[4].reason, /different opening balance/);
  assert.equal(st[5].status, "invalid"); assert.match(st[5].reason, /no open stay/);
  assert.equal(st[6].status, "invalid"); assert.match(st[6].reason, /Repeats row 2/);
  assert.equal(st[7].status, "invalid"); assert.equal(st[7].field, "asOf");
  assert.deepEqual(dry.counts, { create: 2, matched: 0, duplicate: 0, invalid: 4 });
  assert.equal(records("OpeningBalance").length, 1, "a dry run writes nothing");

  const wrong = await as(ADMIN, IMP, "POST", body({ commit: true, confirmCount: 3, planId: dry.planId }));
  assert.equal(wrong.error, "preview_changed");
  const done = await as(ADMIN, IMP, "POST", body({ commit: true, confirmCount: 2, planId: dry.planId }));
  assert.equal(done.__status, 200, done.__text);
  assert.equal(done.written, 2);
  assert.equal(records("OpeningBalance").length, 3);
  const obs = await H.RECORD.latestByType(T, "OpeningBalance", 100);
  assert.deepEqual(obs.filter((r) => r.entry === "import").map((r) => [r.encounterId, r.amountPaise]).sort(), [[a.adm.encounterId, 4500050], [legacy.encounterId, 120000]].sort());
  assert.ok(audits("legacy_import").some((x) => /openingBalances created 2/.test(String(x.fields.meta))), "the run is audited");

  const re = await as(ADMIN, IMP, "POST", body());
  assert.deepEqual([re.rows.find((r) => r.row === 2).status, re.rows.find((r) => r.row === 3).status, re.counts.create], ["matched", "matched", 0], "importing the same file again changes nothing");
  const reDone = await as(ADMIN, IMP, "POST", body({ commit: true, confirmCount: 0, planId: re.planId }));
  assert.equal(reDone.written, 0);
  assert.equal(records("OpeningBalance").length, 3);
});

test("pure: a package never covers the carried balance and keeps it first; discharge sees it unbilled until it is on a bill; the amount rule", () => {
  const ob = openingLine({ id: "wsq-ob-e1", patientId: "p1", encounterId: "e1", amountPaise: 4500050, legacyBillRef: "OLD/1", asOf: "2026-10-01" });
  const pkg = { code: "PKG1", name: "Knee", rate: 90000, inclusions: { items: ["OPENING-BALANCE"], kinds: ["bed"] } };
  const out = applyPackage({ priced: [ob, { code: "PVT-ROOM", sourceType: "Encounter", sourceId: "e1:bed:1", quantity: 1, amount: 6000, line: 6000 }], unpriced: [] }, { id: "pa-1", package: pkg }, ROOM);
  assert.deepEqual(out.lines.map((l) => [l.code, l.line, !!l.packageIncluded]), [["OPENING-BALANCE", 45000.5, false], ["PKG1", 90000, false], ["PVT-ROOM", 0, true]]);
  assert.equal(billState({ ok: true, priced: [ob], unpriced: [] }, [], null).state, "unbilled", "a stay is not settled while the carried balance is on no bill");
  assert.equal(validateOpeningBalance({ amount: "1,00,000", legacyBillRef: "R", asOf: "2026-10-01" }).value.amountPaise, 10000000, "Indian digit grouping is read");
});
