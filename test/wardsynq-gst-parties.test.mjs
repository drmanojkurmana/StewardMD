/* test/wardsynq-gst-parties.test.mjs - gst-parties (2026-09-17): patient, payer, insurer, TPA and GST recipient kept
 * apart, the recipient determined on each payer contract (owner's legal guidance item 6; s.2(93) CGST Act).
 *
 * Pure: functions/_wardsynq/payer-contracts.js (resolution per payer kind and contract, the TPA as the insurer's agent,
 * no silent default for schemes and corporates, the old hospital-wide setting as a migration default only, the CA basis
 * a contracting-party recipient needs); functions/_wardsynq/gst-settings.js (the retired setting).
 * Routes: POST /api/queue/ward/connector-save (kind payer, the contract), GET /api/queue/ward/connectors (the parties a
 * contract resolves to), POST /api/queue/ward/stay-payer, GET /api/queue/ward/claims (stays, claims and
 * pre-authorisations with their parties), POST /api/queue/ward/invoice (the parties copied, the buyer = the resolved
 * recipient), POST /api/queue/ward/invoice-parties; negative authorization for the new routes.
 * Screens: ward.js (the invoice's parties and GST recipient line, the claims view), admin.js (the GST settings card).
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-gst-parties.test.mjs
 */
import { as, seed, H, T, ORG_ID, OTHER_ADMIN, NURSE, HR, CASHIER, ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const R = await import("../functions/_region_in.js");
const C = await import("../functions/_wardsynq/payer-contracts.js");
const G = await import("../functions/_wardsynq/gst-settings.js");
const IRP = await import("../functions/_wardsynq/einvoice-irp.js");

const gstin = (base) => base + R.gstinCheckChar(base);
const CORP_GSTIN = gstin("29AAACB1234C1Z"), INS_GSTIN = gstin("29AAACI5678D1Z");
const DETAILS = { address1: "5 MG Road", location: "Bengaluru", pincode: "560001", stateCode: "29" };
const payer = (id, name, settings) => ({ id, name, adapter: "manual", contract: C.contractOf(settings) });
const REGISTRY = [
  payer("star", "Star Health", { payerKind: "insurer", legalName: "Star Health and Allied Insurance Co Ltd", gstin: INS_GSTIN, ...DETAILS }),
  payer("mdindia", "MDIndia TPA", { payerKind: "tpa", insurerRef: "star", legalName: "MDIndia Health Insurance TPA Pvt Ltd" }),
  payer("mdindia-cp", "MDIndia TPA (contract)", { payerKind: "tpa", insurerRef: "star", gstRecipient: "contracting_party", gstBasisType: "ca_opinion", gstBasisRef: "Rao & Co 22", gstBasisDate: "2026-09-12" }),
  payer("pmjay", "PM-JAY", { payerKind: "government_scheme", legalName: "State Health Agency" }),
  payer("acme", "Acme Ltd", { payerKind: "corporate", legalName: "Acme Ltd", gstin: CORP_GSTIN, ...DETAILS, gstRecipient: "contracting_party", gstBasisType: "contract_clause", gstBasisRef: "Acme agreement 2026 clause 7" }),
  payer("oldco", "Old Co", {}),
];
const DEF = G.readGstSettings(null);

test("resolution: self-pay; an insurer or TPA defaults to the patient as ordinary cashless treatment; the TPA is the insurer's agent, never the insurer", () => {
  const self = C.resolveParties({ payerRef: "", payers: REGISTRY, gst: DEF });
  assert.deepEqual([self.selfPay, self.payer, self.gstRecipient.party, self.gstRecipient.source, self.gstRecipient.buyer], [true, null, "patient", "self_pay", null]);
  const ins = C.resolveParties({ payerRef: "star", payers: REGISTRY, gst: DEF });
  assert.deepEqual([ins.payer.ref, ins.insurer.ref, ins.tpa, ins.gstRecipient.party, ins.gstRecipient.source, ins.gstRecipient.determined, ins.gstRecipient.warning, ins.gstRecipient.buyer],
    ["star", "star", null, "patient", "default_cashless", true, null, null], "a registered insurer settling is still not the recipient by default");
  const tpa = C.resolveParties({ payerRef: "mdindia", payers: REGISTRY, gst: DEF });
  assert.deepEqual([tpa.payer.ref, tpa.tpa.ref, tpa.insurer.ref, tpa.insurer.legalName, tpa.gstRecipient.party, tpa.gstRecipient.source], ["mdindia", "mdindia", "star", "Star Health and Allied Insurance Co Ltd", "patient", "default_cashless"]);
  // A TPA contract that makes the contracting party the recipient: that is the insurer it acts for, never the TPA.
  const cp = C.resolveParties({ payerRef: "mdindia-cp", payers: REGISTRY, gst: DEF });
  assert.deepEqual([cp.gstRecipient.party, cp.gstRecipient.ref, cp.gstRecipient.gstin, cp.gstRecipient.buyer.gstin, cp.gstRecipient.buyer.payerRef], ["insurer", "star", INS_GSTIN, INS_GSTIN, "star"]);
  assert.deepEqual(cp.gstRecipient.basis, { type: "ca_opinion", ref: "Rao & Co 22", date: "2026-09-12" });
  // A TPA whose insurer is not in the registry: nobody is guessed, the patient with a warning.
  const lost = C.resolveParties({ payerRef: "mdindia-cp", payers: REGISTRY.filter((p) => p.id !== "star"), gst: DEF });
  assert.deepEqual([lost.insurer, lost.partiesWarning, lost.gstRecipient.party, lost.gstRecipient.determined, lost.gstRecipient.warning], [null, "tpa_insurer_not_found", "patient", false, "tpa_insurer_not_found"]);
});

test("resolution: a scheme or corporate with no determination warns and treats the patient as recipient; a corporate contract makes it the buyer; an unknown payer is never guessed", () => {
  const scheme = C.resolveParties({ payerRef: "pmjay", payers: REGISTRY, gst: DEF });
  assert.deepEqual([scheme.payer.kind, scheme.insurer, scheme.tpa, scheme.gstRecipient.party, scheme.gstRecipient.determined, scheme.gstRecipient.source, scheme.gstRecipient.warning],
    ["government_scheme", null, null, "patient", false, "not_determined", "recipient_not_determined"]);
  const kindless = C.resolveParties({ payerRef: "oldco", payers: REGISTRY, gst: DEF });
  assert.deepEqual([kindless.gstRecipient.party, kindless.gstRecipient.warning], ["patient", "payer_kind_not_recorded"]);
  const corp = C.resolveParties({ payerRef: "acme", payers: REGISTRY, gst: DEF });
  assert.deepEqual([corp.gstRecipient.party, corp.gstRecipient.source, corp.gstRecipient.buyer.gstin, corp.gstRecipient.buyer.pos, corp.gstRecipient.basis.type], ["payer", "contract", CORP_GSTIN, "29", "contract_clause"]);
  const unknown = C.resolveParties({ payerRef: "ghost", payers: REGISTRY, gst: DEF });
  assert.deepEqual([unknown.payer.found, unknown.gstRecipient.party, unknown.gstRecipient.warning], [false, "patient", "payer_not_found"]);
  // The retired hospital-wide "payer" is a migration default for contracts with no determination only; a saved "patient" is not a determination.
  const legacy = { ...DEF, recipientOfCashlessClaims: "payer", caOpinionRef: "CA 1", caOpinionDate: "2026-09-01" };
  const mig = C.resolveParties({ payerRef: "pmjay", payers: REGISTRY, gst: legacy });
  assert.deepEqual([mig.gstRecipient.party, mig.gstRecipient.source, mig.gstRecipient.basis, mig.gstRecipient.buyer.gstin], ["payer", "legacy_global", { type: "ca_opinion", ref: "CA 1", date: "2026-09-01" }, ""]);
  assert.equal(C.resolveParties({ payerRef: "acme", payers: REGISTRY, gst: legacy }).gstRecipient.source, "contract", "a contract's own determination wins");
  assert.equal(C.resolveParties({ payerRef: "star", payers: REGISTRY, gst: legacy }).gstRecipient.party, "payer");
  assert.equal(C.resolveParties({ payerRef: "pmjay", payers: REGISTRY, gst: { ...DEF, recipientOfCashlessClaims: "patient" } }).gstRecipient.warning, "recipient_not_determined");
});

test("contract: choosing the contracting party needs the CA basis and the recipient's details; a TPA needs its insurer; a GSTIN must be valid", () => {
  const ok = { ref: "acme", payerKind: "corporate", legalName: "Acme Ltd", gstin: CORP_GSTIN, ...DETAILS, gstRecipient: "contracting_party" };
  assert.match(C.contractProblem(ok, "acme"), /needs its basis/);
  assert.match(C.contractProblem({ ...ok, gstBasisType: "ca_opinion", gstBasisRef: "Rao 22" }, "acme"), /needs its basis/, "an opinion needs its date");
  assert.equal(C.contractProblem({ ...ok, gstBasisType: "ca_opinion", gstBasisRef: "Rao 22", gstBasisDate: "2026-09-12" }, "acme"), null);
  assert.equal(C.contractProblem({ ...ok, gstBasisType: "contract_clause", gstBasisRef: "Agreement clause 7" }, "acme"), null);
  assert.match(C.contractProblem({ ...ok, gstBasisType: "contract_clause", gstBasisRef: "c7", pincode: "12" }, "acme"), /PIN code/);
  assert.match(C.contractProblem({ ...ok, payerKind: "", gstBasisType: "contract_clause", gstBasisRef: "c7" }, "acme"), /kind of payer/);
  assert.match(C.contractProblem({ payerKind: "tpa" }, "t"), /acts for an insurer/);
  assert.match(C.contractProblem({ payerKind: "tpa", insurerRef: "t" }, "t"), /cannot act for itself/);
  assert.match(C.contractProblem({ gstin: "29AAACB1234C1ZZ" }, "x"), /GSTIN is not valid/);
  assert.equal(C.contractProblem({ payerKind: "government_scheme", gstRecipient: "patient" }, "x"), null, "the patient needs no basis beyond the choice");
});

test("GST settings: the hospital-wide recipient is retired; a saved 'payer' is kept (and keeps needing the CA opinion) but cannot be set", () => {
  const cfg = { gst: { recipientOfCashlessClaims: "payer", caOpinionRef: "CA 1", caOpinionDate: "2026-09-01" } };
  assert.equal(G.GST_CHOICES.recipientOfCashlessClaims, undefined);
  assert.equal(DEF.recipientOfCashlessClaims, null);
  assert.equal(G.readGstSettings(cfg).recipientOfCashlessClaims, "payer");
  assert.match(G.validateGstSettings({ recipientOfCashlessClaims: "patient" }, cfg).errors.recipientOfCashlessClaims, /determined on each payer contract/);
  const kept = G.validateGstSettings({ intensiveCareUnits: "named_only" }, cfg);
  assert.deepEqual([kept.errors, kept.value.recipientOfCashlessClaims], [{}, "payer"], "a later save does not erase the migration default");
  assert.match(G.validateGstSettings({ caOpinionRef: "" }, cfg).errors.caOpinionRef, /chartered accountant/);
});

/* ---- routes --------------------------------------------------------------------------------------- */

const PATIENT = "opd-pat-parties-1", ENC = "enc-parties-1";
const TARIFF = { "ROOM-PVT": { amount: 6000, kind: "bed", description: "Private room" }, CBC: { amount: 300, kind: "investigation", description: "CBC" } };
const CONNECTORS = {
  star: { kind: "payer", provider: "manual", name: "Star Health", settings: { ref: "star", payerKind: "insurer", legalName: "Star Health and Allied Insurance Co Ltd", gstin: INS_GSTIN, ...DETAILS } },
  mdindia: { kind: "payer", provider: "manual", name: "MDIndia TPA", settings: { ref: "mdindia", payerKind: "tpa", insurerRef: "star", legalName: "MDIndia Health Insurance TPA Pvt Ltd" } },
  pmjay: { kind: "payer", provider: "manual", name: "PM-JAY", settings: { ref: "pmjay", payerKind: "government_scheme" } },
  acme: { kind: "payer", provider: "manual", name: "Acme Ltd", settings: { ref: "acme", payerKind: "corporate", legalName: "Acme Ltd", gstin: CORP_GSTIN, ...DETAILS, gstRecipient: "contracting_party", gstBasisType: "contract_clause", gstBasisRef: "Acme agreement 2026 clause 7" } },
};
async function hospital() {
  seed({ tariff: TARIFF });
  for (const c of Object.values(CONNECTORS)) { const r = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...c }); assert.equal(r.__status, 200, r.__text); }
  const start = new Date(Date.now() - 2 * 86400000 + 60000).toISOString();
  await H.RECORD.append(T, [
    { resourceType: "Encounter", id: ENC, version: 1, patientId: PATIENT, class: "IPD", status: "in-progress", periodStart: start, location: { ward: "Private" } },
    { resourceType: "DiagnosticReport", id: "dr-cbc-p", version: 1, patientId: PATIENT, encounterId: ENC, code: "CBC", status: "final", reportedAt: start },
  ]);
}

test("POST /api/queue/ward/connector-save: a contract choosing the contracting party without the CA basis is refused and nothing written; GET /ward/connectors shows each contract's parties", async () => {
  seed();
  const before = writesNow();
  const bad = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...CONNECTORS.acme, settings: { ...CONNECTORS.acme.settings, gstBasisType: "", gstBasisRef: "" } });
  assert.deepEqual([bad.__status, bad.error], [422, "invalid_connector"]); assert.match(bad.message, /needs its basis/);
  assert.equal(writesNow(), before, "nothing written");
  for (const c of Object.values(CONNECTORS)) assert.equal((await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...c })).__status, 200);
  const list = await as(ADMIN, `/ward/connectors?orgId=${ORG_ID}&kind=payer`);
  assert.equal(list.__status, 200, list.__text);
  const by = Object.fromEntries(list.connectors.map((x) => [x.settings.ref, x.parties]));
  assert.deepEqual([by.mdindia.tpa.ref, by.mdindia.insurer.ref, by.mdindia.gstRecipient.party, by.mdindia.gstRecipient.source], ["mdindia", "star", "patient", "default_cashless"]);
  assert.deepEqual([by.pmjay.gstRecipient.determined, by.pmjay.gstRecipient.warning], [false, "recipient_not_determined"]);
  assert.deepEqual([by.acme.gstRecipient.party, by.acme.gstRecipient.gstin, by.acme.gstRecipient.buyer], ["payer", CORP_GSTIN, undefined], "the screen gets the recipient, not the invoice buyer");
});

test("negative authorization: POST /api/queue/ward/stay-payer and /ward/invoice-parties need billing.charge at this hospital; nothing written when refused", async () => {
  await hospital();
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(inv.written, 1, inv.__text);
  const before = writesNow();
  const bodies = {
    "/ward/stay-payer": { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, payerRef: "mdindia" },
    "/ward/invoice-parties": { orgId: ORG_ID, invoiceId: inv.invoiceId, payerRef: "acme" },
  };
  for (const [path, body] of Object.entries(bodies)) {
    assert.equal((await as(null, path, "POST", body)).__status, 401, path);
    for (const who of [NURSE, HR]) assert.equal((await as(who, path, "POST", body)).__status, 403, `${path} ${who}`);
    const other = await as(OTHER_ADMIN, path, "POST", body);
    assert.ok(other.__status === 403 || other.__status === 404, `${path} ${other.__text}`);
  }
  assert.equal(writesNow(), before, "nothing written by any refused call");
  const ok = await as(CASHIER, "/ward/stay-payer", "POST", bodies["/ward/stay-payer"]);
  assert.equal(ok.__status, 200, ok.__text);
  assert.equal((await as(CASHIER, "/ward/invoice-parties", "POST", bodies["/ward/invoice-parties"])).__status, 200);
});

test("POST /ward/stay-payer then GET /ward/claims: the stay, its claim and its pre-authorisation carry patient, payer, insurer, TPA and GST recipient separately", async () => {
  await hospital();
  const unknown = await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, payerRef: "ghost" });
  assert.deepEqual([unknown.__status, unknown.error, unknown.written], [422, "payer_not_found", 0]);
  const set = await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, payerRef: "mdindia", policyNumber: "POL-1" });
  assert.equal(set.__status, 200, set.__text);
  assert.deepEqual([set.stayPayer.payerRef, set.stayPayer.policyNumber, set.stayPayer.parties.tpa.ref, set.stayPayer.parties.insurer.ref, set.stayPayer.parties.gstRecipient.party], ["mdindia", "POL-1", "mdindia", "star", "patient"]);
  const noReason = await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, payerRef: "pmjay", expectedVersion: 1 });
  assert.deepEqual([noReason.__status, noReason.error], [422, "reason_required"]);
  const stale = await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, payerRef: "pmjay", reason: "x" });
  assert.deepEqual([stale.__status, stale.error], [409, "version_conflict"]);
  const wrongStay = await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: "someone-else", encounterId: ENC, payerRef: "star" });
  assert.equal(wrongStay.error, "encounter_not_this_patient");
  await H.RECORD.append(T, [{ resourceType: "PreAuthorisation", id: "pa-1", version: 1, patientId: PATIENT, treatment: "ORIF", state: "approved", payerId: "mdindia" }]);
  const claims = await as(CASHIER, `/ward/claims?orgId=${ORG_ID}&patientId=${PATIENT}`);
  assert.equal(claims.__status, 200, claims.__text);
  assert.equal(claims.stayPayers.length, 1);
  const pa = claims.preAuthorisations[0].parties;
  assert.deepEqual([pa.payer.ref, pa.tpa.ref, pa.insurer.ref, pa.gstRecipient.party, pa.gstRecipient.buyer], ["mdindia", "mdindia", "star", "patient", undefined]);
  const moved = await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, payerRef: "pmjay", reason: "Patient is a PM-JAY beneficiary", expectedVersion: 1 });
  assert.equal(moved.__status, 200, moved.__text);
  assert.deepEqual([moved.stayPayer.parties.gstRecipient.warning, moved.stayPayer.parties.gstRecipient.determined], ["recipient_not_determined", false]);
  assert.equal((await H.RECORD.history(T, "StayPayer", "wsq-staypayer-" + ENC)).length, 2, "append-only: the first payer is kept");
});

test("POST /ward/invoice and /ward/invoice-parties: the documents and the IRN follow the resolved GST recipient, never the payer", async () => {
  await hospital();
  await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, payerRef: "mdindia" });
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(inv.written, 1, inv.__text);
  assert.deepEqual([inv.parties.payer.ref, inv.parties.tpa.ref, inv.parties.insurer.ref, inv.parties.gstRecipient.party, inv.parties.gstRecipient.source, inv.buyer],
    ["mdindia", "mdindia", "star", "patient", "default_cashless", null], "a TPA settling for a registered insurer: the bill is still to the patient");
  assert.deepEqual(inv.documents.map((d) => d.type), ["invoice_cum_bill_of_supply"]);
  const seller = { gstin: gstin("29AAACW1234H1Z"), legalName: "WSQ Ward Hospital", address1: "1 Main Road", location: "Bengaluru", pincode: "560001", stateCode: "29" };
  const stored = await H.RECORD.latest(T, "Invoice", inv.invoiceId);
  assert.equal(IRP.irnRequest(stored, seller, null).error, "b2c_not_reported", "no IRN for a bill to the patient");
  // The corporate contract makes the contracting party the recipient: B2B, two documents, the IRN names its GSTIN.
  const corp = await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: inv.invoiceId, payerRef: "acme" });
  assert.equal(corp.__status, 200, corp.__text);
  assert.deepEqual([corp.parties.payer.ref, corp.parties.gstRecipient.party, corp.buyer.gstin, corp.buyer.legalName], ["acme", "payer", CORP_GSTIN, "Acme Ltd"]);
  assert.deepEqual(corp.documents.map((d) => d.type), ["tax_invoice", "bill_of_supply"]);
  assert.match(corp.billOfSupplyNumber, /^BOS\//);
  const b2b = IRP.irnRequest(await H.RECORD.latest(T, "Invoice", inv.invoiceId), seller, null);
  assert.equal(b2b.payload.BuyerDtls.Gstin, CORP_GSTIN);
  // Back to the scheme with no determination: the patient again, with the warning kept on the bill.
  const scheme = await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: inv.invoiceId, payerRef: "pmjay" });
  assert.deepEqual([scheme.buyer, scheme.parties.gstRecipient.warning, scheme.documents.length], [null, "recipient_not_determined", 1]);
  const ghost = await as(CASHIER, "/ward/invoice-parties", "POST", { orgId: ORG_ID, invoiceId: inv.invoiceId, payerRef: "ghost" });
  assert.deepEqual([ghost.__status, ghost.error, ghost.written], [422, "payer_not_found", 0]);
});

test("POST /ward/invoice: a stay settled under a corporate contract is raised to the corporate as buyer with its own Bill of Supply number", async () => {
  await hospital();
  await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: PATIENT, encounterId: ENC, payerRef: "acme" });
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: PATIENT });
  assert.equal(inv.written, 1, inv.__text);
  assert.deepEqual([inv.buyer.gstin, inv.parties.gstRecipient.basis.ref, inv.documents.map((d) => d.type)], [CORP_GSTIN, "Acme agreement 2026 clause 7", ["tax_invoice", "bill_of_supply"]]);
  assert.ok(/^INV\//.test(inv.documentNumber) && /^BOS\//.test(inv.billOfSupplyNumber));
});

test("POST /ward/invoice naming a DISCHARGED stay: the final bill carries that stay's payer parties and resolved recipient, not self-pay; another patient's stay is refused", async () => {
  await hospital();
  const P2 = "opd-pat-parties-2", DISCHARGED = "enc-parties-2";
  const start = new Date(Date.now() - 6 * 86400000).toISOString(), end = new Date(Date.now() - 3 * 86400000).toISOString();
  await H.RECORD.append(T, [
    { resourceType: "Encounter", id: DISCHARGED, version: 1, patientId: P2, class: "IPD", status: "finished", periodStart: start, periodEnd: end, location: { ward: "Private" } },
    { resourceType: "DiagnosticReport", id: "dr-cbc-d", version: 1, patientId: P2, encounterId: DISCHARGED, code: "CBC", status: "final", reportedAt: start },
  ]);
  assert.equal((await as(CASHIER, "/ward/stay-payer", "POST", { orgId: ORG_ID, patientId: P2, encounterId: DISCHARGED, payerRef: "acme" })).__status, 200);
  const wrong = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: P2, encounterId: ENC });
  assert.deepEqual([wrong.__status, wrong.error, wrong.written], [422, "encounter_not_this_patient", 0], "the open stay of another patient");
  assert.equal((await H.RECORD.byPatient(T, "Invoice", P2)).length, 0, "no bill raised");
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG_ID, patientId: P2, encounterId: DISCHARGED });
  assert.equal(inv.written, 1, inv.__text);
  assert.equal(inv.encounterId, DISCHARGED);
  assert.deepEqual([inv.parties.payer.ref, inv.parties.gstRecipient.party, inv.parties.gstRecipient.source, inv.buyer.gstin, inv.documents.map((d) => d.type)],
    ["acme", "payer", "contract", CORP_GSTIN, ["tax_invoice", "bill_of_supply"]]);
});

/* ---- screens -------------------------------------------------------------------------------------- */

const WARD_SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
function render(view, extra) {
  const sandbox = { navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(WARD_SRC, sandbox);
  const W = sandbox.window.WARD;
  return W._render({ ...W._st, view, ...extra });
}
const TPA_PARTIES = C.partiesRecord(C.resolveParties({ payerRef: "mdindia", payers: REGISTRY, gst: DEF }), "2026-09-17T05:00:00Z");
const CORP_PARTIES = C.partiesRecord(C.resolveParties({ payerRef: "acme", payers: REGISTRY, gst: DEF }), "2026-09-17T05:00:00Z");
const SCHEME_PARTIES = C.partiesRecord(C.resolveParties({ payerRef: "pmjay", payers: REGISTRY, gst: DEF }), "2026-09-17T05:00:00Z");
const INV = { invoiceId: "inv1", status: "open", balance: 100, charged: 100, paidIn: 0, currency: "INR", lines: [], einvoices: [], events: [], documents: [] };

test("cashier screen: the invoice names patient, payer, insurer and TPA, and the GST recipient on its own labelled line with its basis", () => {
  const html = render("cashier", { cashier: { patientId: "p1", payLinks: [], invoices: [{ ...INV, parties: TPA_PARTIES }] } });
  assert.match(html, /Payer: <b>MDIndia TPA<\/b>/);
  assert.match(html, /Insurer: <b>Star Health<\/b>/);
  assert.match(html, /TPA: <b>MDIndia TPA<\/b> \(settles for the insurer\)/);
  assert.match(html, /GST recipient: <b>the patient<\/b>/);
  assert.match(html, /Default for an insurer or TPA: ordinary cashless treatment is a supply to the patient/);
  const corp = render("cashier", { cashier: { patientId: "p1", payLinks: [], invoices: [{ ...INV, parties: CORP_PARTIES, buyer: { gstin: CORP_GSTIN, legalName: "Acme Ltd" } }] } });
  assert.match(corp, new RegExp(`GST recipient: <b>Acme Ltd<\\/b>, GSTIN ${CORP_GSTIN}`));
  assert.match(corp, /Basis: contract clause, Acme agreement 2026 clause 7/);
  const scheme = render("cashier", { cashier: { patientId: "p1", payers: [], invoices: [{ ...INV, parties: SCHEME_PARTIES }], payLinks: [] } });
  assert.match(scheme, /Not determined on this payer's contract\. The patient is treated as the GST recipient until an administrator records the determination on Admin, Integrations, Payers\./);
  assert.ok(render("cashier", { cashier: { patientId: "p1", payLinks: [], invoices: [{ ...INV }] } }).includes('data-w-act="invparties:inv1"'), "the parties can be set from the bill");
});

test("cashier screen: the bill names its stay; a discharged stay is chosen when none is open, the open stay otherwise", () => {
  const OPEN = { id: "e-open", status: "in-progress", periodStart: "2026-09-10T05:00:00Z", periodEnd: null, ward: "Private" };
  const GONE = { id: "e-gone", status: "finished", periodStart: "2026-08-01T05:00:00Z", periodEnd: "2026-08-05T05:00:00Z", ward: "General" };
  const gone = render("cashier", { cashier: { patientId: "p1", payLinks: [], invoices: [], stays: [GONE] } });
  assert.match(gone, /<span>Stay this bill is for<\/span><select id="wCashStay"><option value="e-gone" selected>[^<]*General \(discharged [^)]+\)<\/option><option value="">No stay: an outpatient bill<\/option>/);
  const both = render("cashier", { cashier: { patientId: "p1", payLinks: [], invoices: [], stays: [GONE, OPEN] } });
  assert.match(both, /<option value="e-open" selected>/);
  assert.ok(!both.includes("No stay: an outpatient bill"), "with a stay open the server would bill it: no outpatient choice");
  assert.match(render("cashier", { cashier: { patientId: "p1", payLinks: [], invoices: [], stays: [GONE, OPEN], stayId: "e-gone" } }), /<option value="e-gone" selected>/);
  assert.match(render("cashier", { cashier: { patientId: "p1", payLinks: [], invoices: [], stays: false } }), /The stays could not be read/);
  assert.match(WARD_SRC, /apiPost\("\/ward\/invoice", \{ orgId: st\.orgId, patientId: st\.cashier\.patientId, encounterId: stay \|\| undefined \}\)/);
});

test("claims screen: each stay's payer, and each claim and pre-authorisation, shows the same parties", () => {
  const html = render("tpa", { tpa: { payers: [], claims: [{ id: "c1", state: "coded", codes: [{ code: "S72" }], payerId: "mdindia", parties: TPA_PARTIES }],
    preAuthorisations: [{ id: "pa1", state: "approved", treatment: "ORIF", payerId: "pmjay", parties: SCHEME_PARTIES }],
    stayPayers: [{ encounterId: "e1", payerRef: "mdindia", policyNumber: "POL-1", version: 1, parties: TPA_PARTIES }], estimates: [] } });
  assert.match(html, /Who settles each stay/);
  assert.match(html, /Policy POL-1/);
  assert.equal((html.match(/Insurer: <b>Star Health<\/b>/g) || []).length, 2, "the stay and the claim");
  assert.match(html, /GST recipient: <b>the patient<\/b> &middot; <span class="w-warn">Not determined/);
  assert.match(render("tpa", { tpa: { payers: [], claims: [], preAuthorisations: [], stayPayers: null, estimates: [] } }), /Who settles each stay could not be read\. This is not the same as self-pay\./);
});

test("admin GST settings card: no hospital-wide recipient; a saved old value is said to apply only to contracts with no determination", () => {
  const src = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  assert.ok(!/GST_CHOICE_KEYS = \[[^\]]*recipientOfCashlessClaims/.test(src));
  assert.match(src, /site\.admin\.gst\.recipientPerContract/);
  assert.match(src, /site\.admin\.gst\.recipientLegacy/);
});

test("admin payers card: the contract fields in the staff language, and each payer's GST recipient with its basis or the not-determined warning", async () => {
  const { loadSite } = await import("./wsq-site-i18n-harness.mjs");
  const { catalogue } = await import("../functions/_wardsynq/connectors.js");
  const payerCard = (lang) => {
    const { win } = loadSite({ lang, pages: ["admin.js"] });
    const c = { esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en, ms: win.WSQ.ms, state: { orgId: ORG_ID } };
    const conn = (ref, name, settings) => ({ id: "payer-" + ref, kind: "payer", provider: "manual", name, active: true, settings: { ref, ...settings }, secretsSet: [], secretsSetAt: null,
      parties: C.partiesRecord(C.resolveParties({ payerRef: ref, payers: REGISTRY, gst: DEF }), null) });
    return win.WSQ._connectorsHtml(c, { ok: true, keyConfigured: true, catalogue: catalogue().filter((k) => k.kind === "payer"),
      connectors: [conn("mdindia", "MDIndia TPA", { payerKind: "tpa", insurerRef: "star" }), conn("pmjay", "PM-JAY", { payerKind: "government_scheme" }),
        conn("acme", "Acme Ltd", { payerKind: "corporate", gstRecipient: "contracting_party", gstBasisType: "contract_clause", gstBasisRef: "Acme agreement 2026 clause 7" })] });
  };
  const html = payerCard();
  assert.match(html, /TPA \(acts for an insurer\)\. GST recipient: the patient Default: ordinary cashless treatment is a supply to the patient\./);
  assert.match(html, /Government scheme \(PM-JAY, State scheme, CGHS, ECHS\)\. GST recipient: the patient<\/span><br><span class="msg err">Not determined: bills treat the patient as the GST recipient until you choose\./);
  assert.match(html, new RegExp(`Corporate\\. GST recipient: Acme Ltd \\(${CORP_GSTIN}\\) Basis: Acme agreement 2026 clause 7`));
  assert.match(html, /<span>GST recipient under this contract \(s\.2\(93\) CGST Act\)<\/span><select class="cnSet" data-key="gstRecipient"><option value="" selected>Not determined<\/option>/);
  // In a staff language the contract's labels, options and the recipient lines are the translations, not the server's English.
  const xx = payerCard("xx");
  for (const en of ["GST recipient under this contract (s.2(93) CGST Act)", "Not determined", "Chartered accountant's opinion", "Not determined: bills treat the patient as the GST recipient until you choose."]) {
    assert.ok(!xx.includes(">" + escHtml(en) + "<"), en);
  }
  assert.match(xx, /⟦Kind of payer⟧/);
});
const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
