/* test/wardsynq-gst-einvoice.test.mjs - gap-claims-gst B: GST rules, credit and debit notes, and e-invoicing (IRN).
 *
 * Pure: functions/_region_in.js gstForLines (room rent over Rs 5000 a day, ICU, exempt health care, the in-patient
 * composite supply), validateTariff's GST fields, the note engine in wardsynq/wardsynq-invoice.js, and the portable
 * AES-ECB / RSA PKCS#1 v1.5 in functions/_wardsynq/einvoice-irp.js checked against node:crypto.
 * Routes: POST /api/queue/ward/invoice-credit-note, /ward/invoice-debit-note, /ward/invoice-parties, /ward/invoice-irn,
 * /ward/invoice-irn-cancel, /ward/connector-save (kind einvoice), with a mocked NIC IRP whose captured payloads are
 * decrypted here to pin the request shape (https://einv-apisandbox.nic.in/version1.03/generate-irn.html).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-gst-einvoice.test.mjs
 */
import { as, seed, H, ENV, T, ORG_ID, OTHER_ADMIN, NURSE, HR, CASHIER, ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { generateKeyPairSync, privateDecrypt, constants, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const R = await import("../functions/_region_in.js");
const { validateTariff } = await import("../functions/_clinic_billing.js");
const { tariffTable } = await import("../functions/_wardsynq/charge-capture.js");
const E = await import("../wardsynq/wardsynq-invoice.js");
const IRP = await import("../functions/_wardsynq/einvoice-irp.js");
const { ackMs } = await import("../functions/_wardsynq/einvoice.js");

const gstin = (first14) => first14 + R.gstinCheckChar(first14);
const SELLER = gstin("27AAPFU0939F1Z"), BUYER = gstin("29AAACB1234C1Z");
const ecb = (key, data, dir) => { const c = dir === "enc" ? createCipheriv("aes-256-ecb", key, null) : createDecipheriv("aes-256-ecb", key, null); return Buffer.concat([c.update(data), c.final()]); };

/* ---- pure ----------------------------------------------------------------------------------------- */

test("crypto: AES-256-ECB PKCS7 matches node:crypto both ways, and RSA PKCS#1 v1.5 opens with node's private key", async () => {
  const key = randomBytes(32);
  for (const n of [0, 1, 15, 16, 17, 31, 32, 33, 1000]) {
    const plain = randomBytes(n);
    const mine = Buffer.from(await IRP.aesEcbEncrypt(key, plain));
    assert.ok(mine.equals(ecb(key, plain, "enc")), `encrypt ${n}`);
    assert.ok(Buffer.from(await IRP.aesEcbDecrypt(key, ecb(key, plain, "enc"))).equals(plain), `decrypt ${n}`);
  }
  await assert.rejects(IRP.aesEcbDecrypt(key, randomBytes(15)));
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const msg = Buffer.from("eyJVc2VyTmFtZSI6InVzZXIifQ==");
  for (let i = 0; i < 3; i++) assert.ok(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(await IRP.rsaPkcs1Encrypt(spki, msg))).equals(msg));
  const pem = publicKey.export({ type: "spki", format: "pem" });
  assert.ok(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(await IRP.rsaPkcs1Encrypt(pem, msg))).equals(msg), "a PEM with its header lines works too");
  await assert.rejects(IRP.rsaPkcs1Encrypt(spki, randomBytes(246)), /too long/);
});

test("GST rules: room over Rs 5000 a day at 5 percent, ICU exempt at any price, health care exempt, medicines by stay", () => {
  const table = tariffTable(null, [
    { code: "ROOM-PVT", name: "Private room", kind: "bed", price: 600000, hsnSac: "999311" },
    { code: "ROOM-GEN", name: "General bed", kind: "bed", price: 500000 },
    { code: "ROOM-ICU", name: "ICU bed", kind: "bed", price: 1500000, intensiveCare: true },
    { code: "NURS", name: "Nursing", kind: "nursing", price: 80000 },
    { code: "CBC", name: "CBC", kind: "investigation", price: 30000 },
    { code: "PCM", name: "Paracetamol", kind: "medication", price: 1000, gstRate: 12, hsnSac: "30049099" },
    { code: "ORS", name: "ORS", kind: "medication", price: 2000 },
    { code: "SUP", name: "Knee support", kind: "medication", price: 50000, gstRate: 12 },
  ]);
  const line = (code, amount, q) => ({ code, amount, quantity: q || 1, line: amount * (q || 1) });
  const ip = R.gstForLines([line("ROOM-PVT", 6000), line("ROOM-GEN", 5000), line("ROOM-ICU", 15000), line("NURS", 800), line("CBC", 300), line("PCM", 10, 2)], table, "IN", { inpatient: true });
  const by = Object.fromEntries(ip.lines.map((l) => [l.code, l]));
  assert.deepEqual([by["ROOM-PVT"].gstRate, by["ROOM-PVT"].tax, by["ROOM-PVT"].basis, by["ROOM-PVT"].hsnSac], [5, 300, "room_over_5000_per_day", "999311"]);
  assert.equal(by["ROOM-GEN"].gstExempt, true, "exactly Rs 5000 does not exceed Rs 5000");
  assert.equal(by["ROOM-ICU"].basis, "intensive_care_room_exempt");
  assert.equal(by.NURS.basis, "healthcare_exempt"); assert.equal(by.CBC.basis, "healthcare_exempt");
  assert.equal(by.PCM.basis, "inpatient_composite_exempt", "a medicine to an in-patient follows the exempt composite supply");
  assert.equal(ip.totalTax, 300); assert.deepEqual(ip.unconfigured, []); assert.deepEqual(ip.missingHsnSac, []);

  const op = R.gstForLines([line("PCM", 10, 2), line("ORS", 20), line("SUP", 500)], table, "IN", { inpatient: false });
  const pcm = op.lines.find((l) => l.code === "PCM");
  assert.deepEqual([pcm.gstRate, pcm.tax, pcm.taxable, pcm.basis], [12, 2.4, 20, "price_list_rate"]);
  assert.deepEqual(op.unconfigured, ["ORS"], "an outpatient medicine with no rate is listed, never assumed");
  assert.deepEqual(op.missingHsnSac, ["SUP"], "a taxed item with no HSN/SAC is listed");
  // Rows written before this change keep their meaning.
  const legacy = R.gstForLines([{ code: "SRV1", line: 100 }, { code: "SRV2", line: 50 }, { code: "SRV3", line: 10 }], { SRV1: { gstRate: 18 }, SRV2: { gstExempt: true } }, "IN");
  assert.equal(legacy.totalTax, 18); assert.deepEqual(legacy.unconfigured, ["SRV3"]);
  assert.equal(R.gstForLines([line("ROOM-PVT", 6000)], table, "US").applies, false);
  assert.deepEqual(R.gstSplit(300, false), { cgst: 150, sgst: 150, igst: 0 });
  assert.deepEqual(R.gstSplit(0.05, false), { cgst: 0.03, sgst: 0.02, igst: 0 });
  assert.deepEqual(R.gstSplit(300, true), { cgst: 0, sgst: 0, igst: 300 });
});

test("Price list: HSN/SAC, GST rate and the intensive care marker are validated and kept only when sent", () => {
  assert.deepEqual(validateTariff({ name: "CBC", price: 100, kind: "investigation" }).item, { code: "", name: "CBC", kind: "investigation", price: 100 });
  const bed = validateTariff({ name: "ICU bed", price: 1500000, kind: "bed", hsnSac: " 9993 11 ", gstRate: "", intensiveCare: true }).item;
  assert.deepEqual([bed.hsnSac, bed.gstRate, bed.intensiveCare], ["999311", "", true]);
  assert.equal(validateTariff({ name: "X", price: 1, kind: "service", intensiveCare: true }).item.intensiveCare, undefined, "only a bed can be a room");
  assert.equal(validateTariff({ name: "X", price: 1, hsnSac: "99931" }).error, "bad_hsn_sac");
  assert.equal(validateTariff({ name: "X", price: 1, gstRate: "101" }).error, "bad_gst_rate");
  assert.equal(validateTariff({ name: "X", price: 1, gstRate: "abc" }).error, "bad_gst_rate");
  assert.equal(validateTariff({ name: "X", price: 1, kind: "medication", gstRate: "12" }).item.gstRate, 12);
});

test("dates: financial year, the Section 34 limit and the portal's India-time acknowledgement", () => {
  assert.equal(R.financialYearOf("2026-03-31T18:29:00Z"), "2526");
  assert.equal(R.financialYearOf("2026-03-31T18:31:00Z"), "2627", "midnight in India, not UTC");
  assert.equal(R.section34Deadline("2026-09-16T04:00:00Z"), "2027-11-30");
  assert.equal(R.section34Deadline("2027-02-01T04:00:00Z"), "2027-11-30");
  assert.equal(IRP.ddmmyyyy("2026-09-15T20:00:00Z"), "16/09/2026");
  assert.equal(ackMs("2026-09-16 10:00:00"), Date.parse("2026-09-16T04:30:00Z"));
});

function gstInvoice(id) {
  const inv = E.openInvoice({ id, patientId: PATIENT, encounterId: "enc-1", currency: "INR", actorId: "cfa:seed", at: RAISED, lines: [
    { code: "ROOM-PVT", display: "Private room", quantity: 1, amount: 6000, line: 6000, sourceType: "Encounter", sourceId: "enc-1:bed:1", taxKind: "GST", taxRate: 5, taxExempt: false, tax: 300, hsnSac: "999311", taxBasis: "room_over_5000_per_day", taxable: 6000, kind: "bed" },
    { code: "NURS", display: "Nursing", quantity: 1, amount: 800, line: 800, sourceType: "Encounter", sourceId: "enc-1:nursing:NURS:1", taxKind: "GST", taxRate: null, taxExempt: true, tax: 0, taxBasis: "healthcare_exempt", taxable: 800, kind: "nursing" },
  ] });
  return { ...inv, documentNumber: "INV/2627/000001", taxRegistration: { kind: "GSTIN", id: SELLER } };
}

test("notes engine: own number and reason, GST follows the line, credit capped, void refused, balance accounts for both", () => {
  const inv = gstInvoice("inv-e");
  assert.throws(() => E.postNote(inv, "credit_note", { noteNumber: "CRN/2627/000001", actorId: "a", at: "t", lines: [{ lineIndex: 0, taxable: 100 }] }), (e) => e.code === "REASON_REQUIRED");
  assert.throws(() => E.postNote(inv, "credit_note", { noteNumber: "CRN/2627/000001", actorId: "a", at: "t", reason: "r", lines: [{ lineIndex: 0, taxable: 6000.01 }] }), (e) => e.code === "CREDIT_EXCEEDS_LINE");
  assert.throws(() => E.postNote(inv, "credit_note", { noteNumber: "N1", actorId: "a", at: "t", reason: "r", lines: [{ lineIndex: 7, taxable: 1 }] }), (e) => e.code === "UNKNOWN_LINE");
  const before = JSON.stringify(inv.lines);
  E.postNote(inv, "credit_note", { noteNumber: "CRN/2627/000001", actorId: "a", at: "t", reason: "Room downgraded", lines: [{ lineIndex: 0, taxable: 1000 }, { lineIndex: 1, taxable: 200 }] });
  const cn = inv.events.at(-1);
  assert.deepEqual([cn.taxable, cn.tax, cn.amount, cn.lines[0].tax, cn.lines[1].tax], [1200, 50, 1250, 50, 0]);
  assert.equal(JSON.stringify(inv.lines), before, "original lines and tax untouched");
  assert.equal(E.creditableOn(inv, 0), 5000);
  E.postNote(inv, "debit_note", { noteNumber: "DBN/2627/000001", actorId: "a", at: "t", reason: "Extra day", lines: [{ lineIndex: 0, taxable: 500 }] });
  assert.equal(E.creditableOn(inv, 0), 5500);
  const rec = E.reconciliationOf(inv);
  assert.deepEqual([rec.charged, rec.credited, rec.debited, rec.balance], [7100, 1250, 525, 6375]);
  assert.throws(() => E.voidInvoice(inv, { actorId: "a", at: "t", reason: "x" }), (e) => e.code === "NOTES_EXIST");
  const v = gstInvoice("inv-v"); E.voidInvoice(v, { actorId: "a", at: "t", reason: "x" });
  assert.throws(() => E.postNote(v, "credit_note", { noteNumber: "N", actorId: "a", at: "t", reason: "r", lines: [{ lineIndex: 0, taxable: 1 }] }), (e) => e.code === "INVOICE_VOID");
});

test("IRN request (INV-01 v1.1): B2C refused, only taxed lines, place of supply where performed (CGST/SGST) unless the bill says recipient state, notes carry PrecDocDtls", () => {
  const seller = { gstin: SELLER, legalName: "WSQ Ward Hospital", address1: "1 Main Road", location: "Pune", pincode: "411001", stateCode: "27" };
  const inv = gstInvoice("inv-p");
  assert.equal(IRP.irnRequest(inv, seller, null).error, "b2c_not_reported");
  inv.buyer = { gstin: BUYER, legalName: "Acme Insurance Ltd", address1: "5 MG Road", location: "Bengaluru", pincode: "560001", stateCode: "29", pos: "29" };
  assert.equal(IRP.irnRequest(inv, seller, null).error, "bill_of_supply_number_missing", "a mixed B2B bill is not reported until its Bill of Supply has a number");
  inv.billOfSupplyNumber = "BOS/2627/000001";
  const p = IRP.irnRequest(inv, seller, null).payload;
  assert.equal(p.Version, "1.1");
  assert.deepEqual(p.TranDtls, { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" });
  assert.deepEqual(p.DocDtls, { Typ: "INV", No: "INV/2627/000001", Dt: "16/09/2026" });
  assert.deepEqual(p.SellerDtls, { Gstin: SELLER, LglNm: "WSQ Ward Hospital", Addr1: "1 Main Road", Loc: "Pune", Pin: 411001, Stcd: "27" });
  assert.equal(p.BuyerDtls.Pos, "27", "a health service is supplied where it is performed, whatever the buyer's state");
  assert.equal(p.ItemList.length, 1, "the exempt nursing line is not reported");
  assert.deepEqual(p.ItemList[0], { SlNo: "1", PrdDesc: "Private room", IsServc: "Y", HsnCd: "999311", UnitPrice: 6000, TotAmt: 6000, Discount: 0, AssAmt: 6000, GstRt: 5, IgstAmt: 0, CgstAmt: 150, SgstAmt: 150, TotItemVal: 6300 });
  assert.deepEqual(p.ValDtls, { AssVal: 6000, CgstVal: 150, SgstVal: 150, IgstVal: 0, TotInvVal: 6300 });
  inv.placeOfSupply = "recipient_state";
  const across = IRP.irnRequest(inv, seller, null).payload;
  assert.deepEqual([across.BuyerDtls.Pos, across.ValDtls.IgstVal, across.ValDtls.CgstVal], ["29", 300, 0], "only the recipient_state setting makes it IGST");
  delete inv.placeOfSupply;
  // A B2B bill of only exempt lines is a Bill of Supply: never reported.
  const exemptOnly = { ...gstInvoice("inv-x"), buyer: inv.buyer, lines: [gstInvoice("x").lines[1]] };
  assert.equal(IRP.irnRequest(exemptOnly, seller, null).error, "no_taxable_lines");
  assert.match(IRP.irnRequest(exemptOnly, seller, null).detail, /This Bill of Supply has no IRN/);
  E.postNote(inv, "credit_note", { noteNumber: "CRN/2627/000001", actorId: "a", at: "2026-09-17T05:00:00Z", reason: "r", lines: [{ lineIndex: 0, taxable: 1000 }] });
  const n = IRP.irnRequest(inv, seller, inv.events.at(-1)).payload;
  assert.deepEqual(n.DocDtls, { Typ: "CRN", No: "CRN/2627/000001", Dt: "17/09/2026" });
  assert.deepEqual(n.RefDtls, { PrecDocDtls: [{ InvNo: "INV/2627/000001", InvDt: "16/09/2026" }] });
  assert.equal(n.ItemList[0].AssAmt, 1000);
  E.postNote(inv, "credit_note", { noteNumber: "CRN/2627/000002", actorId: "a", at: "2026-09-17T05:00:00Z", reason: "r", withoutGst: true, gstTreatment: "without_gst", lines: [{ lineIndex: 0, taxable: 100 }] });
  assert.deepEqual([inv.events.at(-1).tax, inv.events.at(-1).financial], [0, true]);
  assert.equal(IRP.irnRequest(inv, seller, inv.events.at(-1)).error, "financial_note_not_reported", "a note issued without GST is not reported");
  const noHsn = gstInvoice("inv-h"); noHsn.buyer = inv.buyer; noHsn.billOfSupplyNumber = "BOS/2627/000002"; delete noHsn.lines[0].hsnSac;
  assert.deepEqual(IRP.irnRequest(noHsn, seller, null).codes, ["ROOM-PVT"]);
  const old = gstInvoice("inv-o"); old.buyer = inv.buyer; delete old.documentNumber;
  assert.equal(IRP.irnRequest(old, seller, null).error, "no_document_number");
});

/* ---- routes --------------------------------------------------------------------------------------- */

const PATIENT = "opd-pat-gst-001", RAISED = "2026-09-16T04:00:00Z";
async function seedGst(id) { const inv = gstInvoice(id); await H.RECORD.append(T, [{ ...inv, resourceType: "Invoice", version: 1, source: { system: "wardsynq-native", sourceId: `invoice:${id}` } }]); }
const BUYER_BODY = { gstin: BUYER, legalName: "Acme Insurance Ltd", address1: "5 MG Road", location: "Bengaluru", pincode: "560001", stateCode: "29", pos: "29" };
/* gst-parties (2026-09-17): the buyer on a bill is the GST recipient its payer's contract resolves to, never typed on the
 * bill. This contract makes the contracting party the recipient, on the contract clause. */
const ACME = { kind: "payer", provider: "manual", name: "Acme Insurance", settings: { ref: "acme", payerKind: "corporate", legalName: BUYER_BODY.legalName, gstin: BUYER,
  address1: BUYER_BODY.address1, location: BUYER_BODY.location, pincode: BUYER_BODY.pincode, stateCode: "29", gstRecipient: "contracting_party", gstBasisType: "contract_clause", gstBasisRef: "Acme agreement clause 7" } };
const acmeContract = async () => assert.equal((await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...ACME })).__status, 200);
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SPKI = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const EINV = { kind: "einvoice", provider: "nic-irp", settings: { baseUrl: "https://93.184.216.36", gstin: SELLER, legalName: "WSQ Ward Hospital", address1: "1 Main Road", location: "Pune", pincode: "411001", stateCode: "27", username: "wsq_api", publicKey: SPKI },
  secrets: { clientId: "client-id-never-leak", clientSecret: "client-secret-never-leak", password: "password-never-leak" } };
const istNow = (offsetMs) => new Date(Date.now() + 330 * 60000 + (offsetMs || 0)).toISOString().replace("T", " ").slice(0, 19);

/** A NIC IRP stand-in: signs in, decrypts each request with the session key, and answers encrypted. */
function mockIrp(opts) {
  const o = opts || {}, calls = [];
  let sek = null;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body), u = String(url);
    const call = { url: u, headers: init.headers, body };
    calls.push(call);
    if (u.endsWith("/eivital/v1.04/auth")) {
      const inner = JSON.parse(Buffer.from(privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(body.Data, "base64")).toString(), "base64").toString());
      call.plain = inner;
      if (inner.Password !== EINV.secrets.password) return new Response(JSON.stringify({ Status: 0, ErrorDetails: [{ ErrorCode: "1005", ErrorMessage: "Invalid Token" }] }), { status: 200 });
      sek = randomBytes(32);
      return new Response(JSON.stringify({ Status: 1, Data: { ClientId: "c", UserName: inner.UserName, AuthToken: "auth-token-1", Sek: ecb(Buffer.from(inner.AppKey, "base64"), sek, "enc").toString("base64"), TokenExpiry: "2026-09-16 16:00:00" } }), { status: 200 });
    }
    call.plain = JSON.parse(ecb(sek, Buffer.from(body.Data, "base64"), "dec").toString());
    const reply = u.endsWith("/Invoice/Cancel") ? { Irn: call.plain.Irn, CancelDate: istNow() }
      : o.refuse ? null : { AckNo: 112610000000001, AckDt: o.ackDt || istNow(), Irn: "a".repeat(64), SignedInvoice: "eyJ.sig", SignedQRCode: "eyJhbGciOiJSUzI1NiJ9.qr.sig", Status: "ACT" };
    if (!reply) return new Response(JSON.stringify({ Status: 0, ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }] }), { status: 200 });
    return new Response(JSON.stringify({ Status: 1, Data: ecb(sek, Buffer.from(JSON.stringify(reply)), "enc").toString("base64") }), { status: 200 });
  };
  return { calls, fetchImpl };
}

test("negative authorization: notes, buyer and IRN routes need billing.charge at this hospital; e-invoice settings are admin-only", async () => {
  seed();
  await seedGst("inv-a");
  await acmeContract();
  const before = writesNow();
  const bodies = {
    "/ward/invoice-credit-note": { orgId: ORG_ID, invoiceId: "inv-a", reason: "r", lines: [{ lineIndex: 0, taxable: 100 }] },
    "/ward/invoice-debit-note": { orgId: ORG_ID, invoiceId: "inv-a", reason: "r", lines: [{ lineIndex: 0, taxable: 100 }] },
    "/ward/invoice-parties": { orgId: ORG_ID, invoiceId: "inv-a", payerRef: "acme" },
    "/ward/invoice-irn": { orgId: ORG_ID, invoiceId: "inv-a" },
    "/ward/invoice-irn-cancel": { orgId: ORG_ID, invoiceId: "inv-a", reasonCode: "2" },
  };
  for (const [path, body] of Object.entries(bodies)) {
    assert.equal((await as(null, path, "POST", body)).__status, 401, path);
    for (const who of [NURSE, HR, OTHER_ADMIN]) assert.equal((await as(who, path, "POST", body)).__status, 403, `${path} ${who}`);
  }
  assert.equal((await as(null, `/ward/einvoice-status?orgId=${ORG_ID}`)).__status, 401);
  for (const who of [NURSE, OTHER_ADMIN]) assert.equal((await as(who, `/ward/einvoice-status?orgId=${ORG_ID}`)).__status, 403, who);
  assert.equal((await as(null, "/ward/connector-save", "POST", { orgId: ORG_ID, ...EINV })).__status, 401);
  for (const who of [CASHIER, NURSE, HR, OTHER_ADMIN]) assert.equal((await as(who, "/ward/connector-save", "POST", { orgId: ORG_ID, ...EINV })).__status, 403, who);
  assert.equal(writesNow(), before, "nothing written by any refused call");
  const ok = await as(CASHIER, "/ward/invoice-credit-note", "POST", { ...bodies["/ward/invoice-credit-note"], gstTreatment: "gst_refunded" });
  assert.equal(ok.__status, 200, ok.__text);
});

test("raising a bill: POST /ward/invoice numbers it in the financial year's series and carries HSN/SAC, basis and GST per line", async () => {
  seed({ tariff: { "ROOM-PVT": { amount: 6000, kind: "bed", description: "Private room", hsnSac: "999311" }, "NURS": { amount: 800, kind: "nursing", description: "Nursing" } } });
  const start = new Date(Date.now() - 3600000).toISOString();
  await H.RECORD.append(T, [{ resourceType: "Encounter", id: "enc-g1", version: 1, patientId: PATIENT, class: "IPD", status: "in-progress", periodStart: start, location: { ward: "W1" } }]);
  const r = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(r.__status, 200, r.__text);
  assert.equal(r.written, 1, r.__text);
  assert.equal(r.documentNumber, `INV/${R.financialYearOf(new Date().toISOString())}/000001`);
  const room = r.lines.find((l) => l.code === "ROOM-PVT"), nurs = r.lines.find((l) => l.code === "NURS");
  assert.deepEqual([room.taxRate, room.tax, room.hsnSac, room.taxBasis, room.cgst, room.sgst], [5, 300, "999311", "room_over_5000_per_day", 150, 150]);
  assert.deepEqual([nurs.taxExempt, nurs.taxBasis], [true, "healthcare_exempt"]);
  assert.equal(r.charged, 7100);
});

test("credit and debit notes through the routes: numbered per series, audited, summary splits GST, void refused", async () => {
  seed();
  await seedGst("inv-n");
  const noReason = await as(CASHIER, "/ward/invoice-credit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-n", lines: [{ lineIndex: 0, taxable: 100 }] });
  assert.equal(noReason.__status, 409); assert.equal(noReason.code, "REASON_REQUIRED");
  const over = await as(CASHIER, "/ward/invoice-credit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-n", reason: "r", lines: [{ lineIndex: 0, taxable: 9000 }] });
  assert.equal(over.code, "CREDIT_EXCEEDS_LINE");
  assert.equal(await H.RECORD.latest(T, "_wardsynq_doc_series", "crn-2627"), null, "a refused note uses no number");
  // Section 34(2) from 1 October 2025: GST on a credit note to a patient is reduced only if it is refunded, so the cashier says which.
  const ask = await as(CASHIER, "/ward/invoice-credit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-n", reason: "Room downgraded", lines: [{ lineIndex: 0, taxable: 1000 }] });
  assert.deepEqual([ask.__status, ask.error, ask.recipient, ask.gst], [409, "gst_confirmation_required", "patient", 50]);
  assert.match(ask.detail, /only if the GST is refunded to the patient\. Refund Rs 50 of GST with this note, or issue it without GST\./);
  assert.equal(await H.RECORD.latest(T, "_wardsynq_doc_series", "crn-2627"), null, "a note waiting for the confirmation uses no number");
  assert.equal((await H.RECORD.latest(T, "Invoice", "inv-n")).version, 1, "and writes nothing");
  const c1 = await as(CASHIER, "/ward/invoice-credit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-n", reason: "Room downgraded", gstTreatment: "gst_refunded", gstConfirmation: "Refunded at counter 2", lines: [{ lineIndex: 0, taxable: 1000 }] });
  assert.equal(c1.__status, 200, c1.__text);
  assert.equal(c1.noteNumber, "CRN/2627/000001");
  const rec = c1.events.find((e) => e.noteNumber === "CRN/2627/000001");
  assert.deepEqual([rec.tax, rec.gstTreatment, rec.gstConfirmation.reference], [50, "gst_refunded", "Refunded at counter 2"]);
  assert.ok(rec.gstConfirmation.by && rec.gstConfirmation.at, "the confirmation names who recorded it and when");
  const c2 = await as(CASHIER, "/ward/invoice-credit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-n", reason: "Second correction", gstTreatment: "gst_refunded", lines: [{ lineIndex: 0, taxable: 100 }] });
  assert.equal(c2.noteNumber, "CRN/2627/000002");
  // A note on the exempt nursing line carries no GST and needs no confirmation: a financial credit note.
  const fin = await as(CASHIER, "/ward/invoice-credit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-n", reason: "Nursing waived", lines: [{ lineIndex: 1, taxable: 100 }] });
  assert.equal(fin.__status, 200, fin.__text);
  assert.deepEqual([fin.events.at(-1).tax, fin.events.at(-1).financial], [0, true]);
  const d1 = await as(CASHIER, "/ward/invoice-debit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-n", reason: "Extra day", lines: [{ lineIndex: 0, taxable: 500 }] });
  assert.equal(d1.noteNumber, "DBN/2627/000001");
  assert.deepEqual([d1.credited, d1.debited, d1.balance], [1255, 525, 6370]);
  const note = d1.events.find((e) => e.noteNumber === "CRN/2627/000001");
  assert.deepEqual([note.lines[0].cgst, note.lines[0].sgst, note.lines[0].igst, note.lines[0].hsnSac], [25, 25, 0, "999311"]);
  assert.equal(d1.lines[0].tax, 300, "the original line's tax is never changed");
  assert.equal(H.RECORD.audit.filter((a) => a.action === "document.number.issue").length, 4);
  const v = await as(CASHIER, "/ward/invoice-void", "POST", { orgId: ORG_ID, invoiceId: "inv-n", reason: "x" });
  assert.equal(v.code, "NOTES_EXIST");
  assert.deepEqual(d1.documents.map((d) => [d.type, d.number, d.total]), [["invoice_cum_bill_of_supply", "INV/2627/000001", 7100]], "taxed and exempt lines to a patient: one Invoice-cum-Bill of Supply");
  // A buyer from another state: still CGST + SGST (where the service is performed), and the bill becomes two documents.
  await acmeContract();
  const b = await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: "inv-n", payerRef: "acme" });
  assert.equal(b.__status, 200, b.__text);
  assert.equal(b.interState, false); assert.deepEqual([b.lines[0].igst, b.lines[0].cgst, b.lines[0].sgst], [0, 150, 150]);
  assert.equal(b.billOfSupplyNumber, "BOS/2627/000001");
  assert.deepEqual(b.documents.map((d) => [d.type, d.number, d.lineIndexes, d.taxable, d.tax, d.total]),
    [["tax_invoice", "INV/2627/000001", [0], 6000, 300, 6300], ["bill_of_supply", "BOS/2627/000001", [1], 800, 0, 800]]);
  assert.equal(b.documents.reduce((n, d) => n + d.total, 0), b.charged, "the two documents add up to the bill");
  const again = await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: "inv-n", payerRef: "acme" });
  assert.equal(again.billOfSupplyNumber, "BOS/2627/000001", "the Bill of Supply number is issued once");
  // The recipient's details are checked on the contract: a state code that does not match the GSTIN is refused there.
  const bad = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...ACME, settings: { ...ACME.settings, stateCode: "27", pincode: "12" } });
  assert.equal(bad.__status, 422); assert.match(bad.message, /PIN code is 6 digits\. The state code does not match the GSTIN\./);
});

test("a credit note after 30 November of the next financial year is issued without GST, and says so", async () => {
  seed();
  const inv = gstInvoice("inv-late");
  inv.events[0].at = "2024-06-01T04:00:00Z";
  await H.RECORD.append(T, [{ ...inv, resourceType: "Invoice", version: 1, source: { system: "wardsynq-native", sourceId: "invoice:inv-late" } }]);
  const r = await as(CASHIER, "/ward/invoice-credit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-late", reason: "Late correction", lines: [{ lineIndex: 0, taxable: 1000 }] });
  assert.equal(r.__status, 200, r.__text);
  assert.equal(r.warning, "The last date to reduce GST for supplies of 2024-25 was 2025-11-30. This note is issued without GST.");
  const ev = r.events.at(-1);
  assert.deepEqual([ev.gstReversalLate, ev.tax, ev.amount, ev.gstTreatment, ev.financial], [true, 0, 1000, "without_gst", true]);
});

test("a credit note to a registered buyer reduces GST only with the buyer's input tax credit reversal recorded", async () => {
  seed();
  const inv = { ...gstInvoice("inv-reg"), buyer: { ...BUYER_BODY, kind: "business" }, billOfSupplyNumber: "BOS/2627/000009" };
  await H.RECORD.append(T, [{ ...inv, resourceType: "Invoice", version: 1, source: { system: "wardsynq-native", sourceId: "invoice:inv-reg" } }]);
  const body = { orgId: ORG_ID, invoiceId: "inv-reg", reason: "Room downgraded", lines: [{ lineIndex: 0, taxable: 1000 }] };
  const ask = await as(CASHIER, "/ward/invoice-credit-note", "POST", body);
  assert.deepEqual([ask.__status, ask.error, ask.recipient, ask.payerName], [409, "gst_confirmation_required", "registered", "Acme Insurance Ltd"]);
  assert.equal(ask.detail, "GST on this credit note reduces the hospital's tax only after Acme Insurance Ltd reverses the matching input tax credit. Record their confirmation.");
  assert.equal((await as(CASHIER, "/ward/invoice-credit-note", "POST", { ...body, gstTreatment: "itc_reversed" })).error, "gst_confirmation_required", "a reversal with no reference is not a confirmation");
  assert.equal((await as(CASHIER, "/ward/invoice-credit-note", "POST", { ...body, gstTreatment: "gst_refunded" })).error, "gst_confirmation_required", "a registered buyer's GST is not refunded, its credit is reversed");
  const ok = await as(CASHIER, "/ward/invoice-credit-note", "POST", { ...body, gstTreatment: "itc_reversed", gstConfirmation: "Acme letter ACM/GST/114 of 17-09-2026" });
  assert.equal(ok.__status, 200, ok.__text);
  assert.deepEqual([ok.events.at(-1).tax, ok.events.at(-1).gstConfirmation.reference], [50, "Acme letter ACM/GST/114 of 17-09-2026"]);
  const without = await as(CASHIER, "/ward/invoice-credit-note", "POST", { ...body, reason: "Goodwill", gstTreatment: "without_gst" });
  assert.deepEqual([without.events.at(-1).tax, without.events.at(-1).financial], [0, true]);
});

test("e-invoice: not connected, not enabled, B2C each refused plainly; the IRN request pinned by decrypting it; QR stored; cancel within 24 hours", async () => {
  seed();
  await seedGst("inv-i");
  assert.equal((await as(CASHIER, `/ward/einvoice-status?orgId=${ORG_ID}`)).state, "not_connected");
  const none = await as(CASHIER, "/ward/invoice-irn", "POST", { orgId: ORG_ID, invoiceId: "inv-i" });
  assert.equal(none.__status, 409); assert.equal(none.error, "einvoice_not_connected");

  const saved = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...EINV });
  assert.equal(saved.__status, 200, saved.__text);
  assert.ok(!saved.__text.includes("password-never-leak") && !saved.__text.includes("client-secret-never-leak"));
  // Applicability is the aggregate turnover on the GST settings, exempt supplies included: not entered, then Rs 5 crore exactly, then above.
  const st0 = await as(CASHIER, `/ward/einvoice-status?orgId=${ORG_ID}`);
  assert.deepEqual([st0.state, st0.reason], ["not_enabled", "turnover_not_entered"]);
  assert.ok(!st0.__text.includes("wsq_api"), "no setting is returned");
  const off = await as(CASHIER, "/ward/invoice-irn", "POST", { orgId: ORG_ID, invoiceId: "inv-i" });
  assert.equal(off.error, "einvoice_not_enabled"); assert.match(off.message, /aggregate turnover is not entered/);
  assert.equal((await as(ADMIN, "/org/gst-settings", "POST", { orgId: ORG_ID, reason: "Turnover for 2025-26", settings: { aggregateTurnoverRs: "50000000" } })).__status, 200);
  const st1 = await as(CASHIER, `/ward/einvoice-status?orgId=${ORG_ID}`);
  assert.deepEqual([st1.state, st1.reason], ["not_enabled", "below_threshold"], "Rs 5 crore is not above Rs 5 crore");
  assert.equal((await as(ADMIN, "/org/gst-settings", "POST", { orgId: ORG_ID, reason: "Turnover including exempt supplies", settings: { aggregateTurnoverRs: "50000001" } })).__status, 200);
  assert.equal((await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...EINV, settings: { ...EINV.settings, stateCode: "29" } })).__status, 422, "state code must match the GSTIN");
  assert.equal((await as(CASHIER, `/ward/einvoice-status?orgId=${ORG_ID}`)).state, "ready");

  const irp = mockIrp();
  ENV.WSQ_EINV_FETCH = irp.fetchImpl;
  try {
    const b2c = await as(CASHIER, "/ward/invoice-irn", "POST", { orgId: ORG_ID, invoiceId: "inv-i" });
    assert.equal(b2c.__status, 409); assert.equal(b2c.error, "b2c_not_reported");
    assert.equal(irp.calls.length, 0, "a B2C bill never reaches the portal");
    assert.equal((await H.RECORD.latest(T, "Invoice", "inv-i")).version, 1, "the bill is untouched");
    assert.equal(H.RECORD.audit.filter((a) => a.action === "einvoice.irn.refused").length, 0);

    const tested = await as(ADMIN, "/ward/connector-test", "POST", { orgId: ORG_ID, id: "einvoice" });
    assert.equal(tested.test.passed, true, tested.__text);

    await acmeContract();
    assert.equal((await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: "inv-i", payerRef: "acme" })).__status, 200);
    irp.calls.length = 0;
    const gen = await as(CASHIER, "/ward/invoice-irn", "POST", { orgId: ORG_ID, invoiceId: "inv-i" });
    assert.equal(gen.__status, 200, gen.__text);
    const [auth, send] = irp.calls;
    assert.equal(auth.url, "https://93.184.216.36/eivital/v1.04/auth");
    assert.deepEqual([auth.headers.client_id, auth.headers.client_secret, auth.headers.Gstin], ["client-id-never-leak", "client-secret-never-leak", SELLER]);
    assert.deepEqual(Object.keys(auth.plain), ["UserName", "Password", "AppKey", "ForceRefreshAccessToken"]);
    assert.equal(Buffer.from(auth.plain.AppKey, "base64").length, 32);
    assert.equal(send.url, "https://93.184.216.36/eicore/v1.03/Invoice");
    assert.deepEqual([send.headers.user_name, send.headers.AuthToken, send.headers.Gstin], ["wsq_api", "auth-token-1", SELLER]);
    assert.deepEqual(Object.keys(send.body), ["Data"]);
    assert.equal(send.plain.Version, "1.1");
    assert.deepEqual(send.plain.DocDtls, { Typ: "INV", No: "INV/2627/000001", Dt: "16/09/2026" });
    assert.deepEqual(send.plain.ItemList.map((i) => [i.HsnCd, i.AssAmt, i.IgstAmt, i.CgstAmt]), [["999311", 6000, 0, 150]], "the Tax Invoice of the taxed line only, CGST and SGST");
    assert.equal(send.plain.BuyerDtls.Pos, "27");
    assert.equal(send.plain.BuyerDtls.Gstin, BUYER);
    assert.equal(gen.einvoices[0].irn, "a".repeat(64));
    assert.equal(gen.einvoices[0].signedQrCode, "eyJhbGciOiJSUzI1NiJ9.qr.sig");
    assert.equal(gen.einvoices[0].status, "ACT");
    assert.equal(gen.einvoices[0].ackNo, "112610000000001");
    assert.ok(!JSON.stringify(H.RECORD.audit).includes("never-leak"));

    assert.equal((await as(CASHIER, "/ward/invoice-irn", "POST", { orgId: ORG_ID, invoiceId: "inv-i" })).error, "irn_exists");
    assert.equal((await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: "inv-i", payerRef: "" })).code, "IRN_ACTIVE");
    assert.equal((await as(CASHIER, "/ward/invoice-void", "POST", { orgId: ORG_ID, invoiceId: "inv-i", reason: "x" })).code, "IRN_ACTIVE");

    // A credit note is reported as CRN with the invoice it answers.
    const cn = await as(CASHIER, "/ward/invoice-credit-note", "POST", { orgId: ORG_ID, invoiceId: "inv-i", reason: "Room downgraded", gstTreatment: "itc_reversed", gstConfirmation: "Acme ITC reversal letter 12", lines: [{ lineIndex: 0, taxable: 1000 }] });
    irp.calls.length = 0;
    const cnIrn = await as(CASHIER, "/ward/invoice-irn", "POST", { orgId: ORG_ID, invoiceId: "inv-i", noteNumber: cn.noteNumber });
    assert.equal(cnIrn.__status, 200, cnIrn.__text);
    assert.equal(irp.calls[1].plain.DocDtls.Typ, "CRN");
    assert.deepEqual(irp.calls[1].plain.RefDtls.PrecDocDtls, [{ InvNo: "INV/2627/000001", InvDt: "16/09/2026" }]);

    assert.equal((await as(CASHIER, "/ward/invoice-irn-cancel", "POST", { orgId: ORG_ID, invoiceId: "inv-i" })).error, "cancel_reason_required");
    irp.calls.length = 0;
    const cnl = await as(CASHIER, "/ward/invoice-irn-cancel", "POST", { orgId: ORG_ID, invoiceId: "inv-i", reasonCode: "2", remark: "Wrong buyer" });
    assert.equal(cnl.__status, 200, cnl.__text);
    assert.equal(irp.calls[1].url, "https://93.184.216.36/eicore/v1.03/Invoice/Cancel");
    assert.deepEqual(irp.calls[1].plain, { Irn: "a".repeat(64), CnlRsn: "2", CnlRem: "Wrong buyer" });
    assert.equal(cnl.einvoices.find((x) => x.docType === "INV").status, "CNL");
  } finally { delete ENV.WSQ_EINV_FETCH; }
});

test("e-invoice: a portal refusal records nothing but is audited; an IRN older than 24 hours is not cancelled", async () => {
  seed({ gst: { aggregateTurnoverRs: 120000000 } });
  await seedGst("inv-r");
  assert.equal((await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...EINV })).__status, 200);
  await acmeContract();
  assert.equal((await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: "inv-r", payerRef: "acme" })).__status, 200);
  ENV.WSQ_EINV_FETCH = mockIrp({ refuse: true }).fetchImpl;
  try {
    const v = (await H.RECORD.latest(T, "Invoice", "inv-r")).version;
    const r = await as(CASHIER, "/ward/invoice-irn", "POST", { orgId: ORG_ID, invoiceId: "inv-r" });
    assert.equal(r.__status, 502); assert.match(r.message, /No IRN was issued.*2150 Duplicate IRN/);
    assert.equal((await H.RECORD.latest(T, "Invoice", "inv-r")).version, v);
    assert.equal(H.RECORD.audit.filter((a) => a.action === "einvoice.irn.refused").length, 1);

    ENV.WSQ_EINV_FETCH = mockIrp({ ackDt: istNow(-25 * 3600000) }).fetchImpl;
    assert.equal((await as(CASHIER, "/ward/invoice-irn", "POST", { orgId: ORG_ID, invoiceId: "inv-r" })).__status, 200);
    const late = await as(CASHIER, "/ward/invoice-irn-cancel", "POST", { orgId: ORG_ID, invoiceId: "inv-r", reasonCode: "1" });
    assert.equal(late.__status, 409); assert.equal(late.error, "cancel_window_closed"); assert.match(late.message, /credit note/);
  } finally { delete ENV.WSQ_EINV_FETCH; }
});

/* ---- screen --------------------------------------------------------------------------------------- */

function cashierHtml(cashier) {
  const src = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  const sandbox = { navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  const W = sandbox.window.WARD;
  return W._render({ ...W._st, view: "cashier", cashier: { patientId: "p1", ...cashier } });
}

test("cashier screen: HSN/SAC and GST per line, notes, and each e-invoice state said plainly", () => {
  const line = { code: "ROOM-PVT", display: "Private room", quantity: 1, amount: 6000, line: 6000, taxKind: "GST", taxRate: 5, taxExempt: false, tax: 300, hsnSac: "999311", taxable: 6000, taxBasis: "room_over_5000_per_day", cgst: 150, sgst: 150, igst: 0 };
  const inv = { invoiceId: "inv1", documentNumber: "INV/2627/000001", status: "open", balance: 6300, currency: "INR", lines: [line], einvoices: [], buyer: null,
    events: [{ kind: "credit_note", noteNumber: "CRN/2627/000001", amount: 1050, taxable: 1000, tax: 50, reason: "Room downgraded", at: "2026-09-17T05:00:00Z", lines: [{ ...line, taxable: 1000, tax: 50, cgst: 25, sgst: 25, igst: 0 }] }] };
  const html = cashierHtml({ invoices: [inv], payLinks: [], einvoice: { state: "not_connected" } });
  assert.match(html, /INV\/2627\/000001/);
  assert.match(html, /999311/);
  assert.match(html, /CGST 150/); assert.match(html, /SGST 150/);
  assert.match(html, /CRN\/2627\/000001/); assert.match(html, /Room downgraded/);
  assert.match(html, /E-invoicing is not connected/);
  assert.ok(html.includes('data-w-act="invcredit:inv1"') && html.includes('data-w-act="invdebit:inv1"') && html.includes('data-w-act="invparties:inv1"') && html.includes('data-w-act="invprint:inv1"'));
  assert.match(cashierHtml({ invoices: [inv], payLinks: [], einvoice: { state: "not_enabled" } }), /not enabled for this hospital/);
  assert.match(cashierHtml({ invoices: [inv], payLinks: [], einvoice: { state: "ready" } }), /B2C, not reported/);
  const b2b = { ...inv, buyer: { gstin: BUYER, legalName: "Acme" } };
  assert.ok(cashierHtml({ invoices: [b2b], payLinks: [], einvoice: { state: "ready" } }).includes('data-w-act="invirn:inv1"'));
  const reg = { ...b2b, einvoices: [{ docType: "INV", docNumber: "INV/2627/000001", irn: "a".repeat(64), ackNo: "1126", ackDt: "2026-09-16 10:00:00", status: "ACT" }] };
  const regHtml = cashierHtml({ invoices: [reg], payLinks: [], einvoice: { state: "ready" } });
  assert.match(regHtml, /IRN aaaa/); assert.ok(regHtml.includes('data-w-act="invirncancel:inv1~INV/2627/000001"'));
  assert.match(cashierHtml({ invoices: [inv], payLinks: [], einvoice: null }), /Checking e-invoicing/);
  assert.match(cashierHtml({ invoices: [inv], payLinks: [], einvoice: false }), /could not be read/);
});
