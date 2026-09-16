/* functions/_wardsynq/invoice.js — TASK 4.6: the join between charge-capture.js's priced proposal
 * and wardsynq-invoice.js's own ledger.
 *
 * NEVER DERIVE A CHARGE BY GUESSING. This file does not accept a client-supplied amount or line
 * item for what to invoice - raiseInvoice() calls chargesForPatient() itself and invoices exactly
 * what that function priced from the real record, nothing a caller typed. A line is never invoiced
 * twice: every already-invoiced source event (a specific administration, report, collection or
 * dispense) is excluded from a later invoice for the same patient.
 *
 * ONE LEDGER PER INVOICE, EVERY EVENT GOVERNED THE SAME WAY. postDiscount/postDeposit/postPayment/
 * postRefund/postAdjustment/postWriteOff are thin, near-identical wrappers around
 * wardsynq-invoice.js's postEvent() - the engine enforces every rule (reason required, refund
 * cannot exceed paid, void only before money moves); this file only reads, resolves the actor, and
 * writes the result back through RecordService with the SAME expectedVersion/idempotencyKey
 * discipline every other bridge in this codebase already uses.
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, isExternalRecord } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { openInvoice, postEvent, voidInvoice, reconciliationOf, receiptFor, receiptsFor, InvoiceRefusalError, NOTE_KINDS, postNote, setBuyer } from "../../wardsynq/wardsynq-invoice.js";
import { validateCollection, applyAdapterResult } from "../../wardsynq/wardsynq-payment-methods.js";
import { chargesForPatient } from "./charge-capture.js";
import { submitPaymentViaAdapter } from "../../wardsynq/wardsynq-payment-adapter.js";
import { gstForLines, gstSplit, financialYearOf, istDateOf, section34Deadline, validateBuyer, packageRoomComponent, GST_BASIS, SAC, ROOM_GST_RATE } from "../_region_in.js";
import { ADMISSION_CLASSES, OPEN } from "./migrate-inpatient.js";
import { ASSIGNMENT_TYPE, applyPackage, packageFlags } from "./packages.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "Invoice";
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function open_(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof InvoiceRefusalError) return { ok: false, status: 409, error: "invoice_refused", code: e.code, detail: e.message, ...extra };
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
/** Which inpatient stay an invoice is raised for: the named one (it must be this patient's), else the patient's
 * open stay (the latest if somehow more than one), else none (an outpatient bill). Never throws. */
async function stayForInvoice(svc, patientId, named) {
  if (named) {
    const enc = await svc.get("Encounter", named).catch(() => null);
    if (!enc || str(enc.patientId) !== patientId) return { error: { ok: false, status: 422, error: "encounter_not_this_patient", detail: "That stay is not this patient's." } };
    return { encounterId: enc.id };
  }
  let stays;
  try { stays = (await svc.byPatient("Encounter", patientId)) || []; }
  catch (e) { return { error: { ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) } }; }
  const open = stays.filter((e) => e && !isExternalRecord(e) && ADMISSION_CLASSES.includes(e.class) && e.status === OPEN)
    .sort((a, b) => str(b.periodStart).localeCompare(str(a.periodStart)));
  return { encounterId: open.length ? open[0].id : null };
}

/**
 * PURE. The invoices that belong to one stay, for the discharge checklist. An invoice carrying the stay's id is the
 * stay's. An invoice with NO encounter id (every invoice raised before 2026-09-16, when the cashier never sent one)
 * is matched by the patient (the list is already this patient's) and the service dates: it counts when one of its
 * lines is a charge from this stay (the same source event, or a bed day of this stay), or when it was raised between
 * admission and discharge (or now). An invoice for another stay is never counted.
 */
function invoicesForStay(invoices, encounter, stayChargeKeys, nowMs) {
  const id = str(encounter && encounter.id);
  const start = Date.parse(str(encounter && encounter.periodStart));
  const end = encounter && encounter.periodEnd ? Date.parse(str(encounter.periodEnd)) : (Number.isFinite(nowMs) ? nowMs : Date.now());
  const keys = stayChargeKeys instanceof Set ? stayChargeKeys : new Set(stayChargeKeys || []);
  return (invoices || []).filter((inv) => {
    if (!inv) return false;
    if (str(inv.encounterId)) return str(inv.encounterId) === id;
    const lines = inv.lines || [];
    if (lines.some((l) => keys.has(`${l.sourceType}:${l.sourceId}`) || (l.sourceType === "Encounter" && str(l.sourceId).startsWith(id + ":")))) return true;
    const raised = Date.parse(str(((inv.events || [])[0] || {}).at));
    return Number.isFinite(raised) && Number.isFinite(start) && raised >= start && raised <= end;
  });
}

/* PURE. Whether this invoice is an inter-state supply.
 * PLACE OF SUPPLY (gst-packages). A health service, the room included, is supplied where it is performed (IGST Act
 * s.12(4); the GST treatment review rates this PROBABLE, as the primary text could not be retrieved, and lists it for
 * the chartered accountant), so CGST + SGST applies even when the insurer, TPA or patient is registered or resident in
 * another state. An outpatient pharmacy counter sale is also within the state. The invoice carries the basis it was
 * raised under (the hospital's placeOfSupply setting then); only "recipient_state" makes a B2B buyer whose place of
 * supply differs from the hospital GSTIN's state an IGST supply. A bill raised before the setting existed has no basis
 * and is read as where performed. */
function interStateOf(inv) {
  if (!inv || inv.placeOfSupply !== "recipient_state") return false;
  const seller = str(inv.taxRegistration && inv.taxRegistration.id).slice(0, 2), pos = str(inv.buyer && inv.buyer.pos);
  return !!(seller && pos && seller !== pos);
}
const taxedLine = (l) => !!l && l.taxKind === "GST" && l.taxExempt !== true && Number(l.taxRate) > 0;
/* PURE. THE DOCUMENTS THIS BILL IS (review 2.1 rule 9; s.31(3)(c) CGST Act, Rules 46, 46A and 49 CGST Rules). Only
 * exempt lines: a Bill of Supply, never reported for e-invoicing. Only taxed lines: a Tax Invoice. Both, to a patient
 * (no buyer GSTIN): one Invoice-cum-Bill of Supply (Rule 46A). Both, to a registered buyer: Rule 46A does not apply,
 * so a Tax Invoice of the taxed lines (its own number, the invoice number, reported for e-invoicing) and a separate
 * Bill of Supply of the exempt lines (its own number from the BOS series), whose totals add up to the bill. Computed
 * from the lines and the numbers issued, never stored. A bill with no GST lines (outside India) is no GST document. */
function documentsOf(inv) {
  const lines = (inv && inv.lines) || [];
  if (!inv || !str(inv.documentNumber) || !lines.some((l) => l && l.taxKind === "GST")) return [];
  const doc = (type, number, idx) => {
    const taxable = Math.round(idx.reduce((n, i) => n + (Number(lines[i].line) || 0), 0) * 100) / 100;
    const tax = Math.round(idx.reduce((n, i) => n + (Number(lines[i].tax) || 0), 0) * 100) / 100;
    return { type, number: number || null, lineIndexes: idx, taxable, tax, total: Math.round((taxable + tax) * 100) / 100 };
  };
  const all = lines.map((_, i) => i), taxed = all.filter((i) => taxedLine(lines[i])), exempt = all.filter((i) => !taxedLine(lines[i]));
  if (!taxed.length) return [doc("bill_of_supply", inv.documentNumber, all)];
  if (!exempt.length) return [doc("tax_invoice", inv.documentNumber, all)];
  if (inv.buyer && str(inv.buyer.gstin)) return [doc("tax_invoice", inv.documentNumber, taxed), doc("bill_of_supply", inv.billOfSupplyNumber, exempt)];
  return [doc("invoice_cum_bill_of_supply", inv.documentNumber, all)];
}
/* PURE. CGST/SGST or IGST on each taxed line and note line, computed from the stored tax and never stored itself:
 * the split follows the place of supply, which the buyer details decide. */
function withSplit(inv) {
  const inter = interStateOf(inv);
  const split = (l) => (l && l.taxKind === "GST" ? { ...l, ...gstSplit(l.tax, inter) } : l);
  return {
    interState: inter, lines: (inv.lines || []).map(split),
    events: (inv.events || []).map((e) => (e && NOTE_KINDS.includes(e.kind) ? { ...e, lines: (e.lines || []).map(split) } : e)),
  };
}
function summary(inv) {
  return { package: inv.package || null, taxRegistration: inv.taxRegistration || null, documentNumber: inv.documentNumber || null, billOfSupplyNumber: inv.billOfSupplyNumber || null,
    placeOfSupply: inv.placeOfSupply || null, documents: documentsOf(inv), buyer: inv.buyer || null, einvoices: inv.einvoices || [], ...withSplit(inv), invoiceId: inv.id, patientId: inv.patientId, encounterId: inv.encounterId, currency: inv.currency, void: inv.void, voidReason: inv.voidReason, version: inv.version, receipts: receiptsFor(inv), ...reconciliationOf(inv) };
}

/** ctx: { migration, patientId, encounterId?, tariff?, at?, actorDeps, recordDeps } */
async function raiseInvoice(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  /* THE STAY THIS BILL BELONGS TO (retest 2026-09-16). The cashier sends only the patient, so every invoice was
   * written with encounterId null and the discharge checklist could not tell it was this stay's bill. A named
   * encounter must be this patient's inpatient stay; with none named, the patient's open stay is used. */
  const stay = await stayForInvoice(svc, patientId, str(ctx.encounterId));
  if (stay.error) return { ...base, ...stay.error, written: 0 };
  let encounterId = stay.encounterId;

  /* PACKAGE BILLING (packages.js). A stay on a package bills the package rate and what the package excludes; a charge
   * it covers goes on the bill at zero, marked included, and only that stay's charges are read. Every OTHER stay on a
   * package keeps its charges off this bill: they belong to that package, never item by item. A DISCHARGED stay on a
   * package is still billed by it: with no stay named and none open, the latest package stay with something billable
   * not yet on a bill (the package line, an exclusion, a charge that came later) is this bill's stay. Not knowing
   * whether a stay is on a package raises nothing: an itemised bill for a package stay is a wrong bill. */
  let actives;
  try { actives = ((await svc.byPatient(ASSIGNMENT_TYPE, patientId)) || []).filter((a) => a && a.status === "active" && str(a.patientId) === patientId).sort((a, b) => str(b.at).localeCompare(str(a.at))); }
  catch { return { ...base, ok: false, status: 502, error: "package_unreadable", detail: "Whether this patient has a stay on a package could not be read, so no bill was raised.", written: 0 }; }
  const packageKeys = new Set();
  if (actives.some((a) => a.encounterId !== encounterId)) {
    let earlier;
    try { earlier = (await svc.byPatient(TYPE, patientId)) || []; }
    catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
    const onBill = new Set();
    for (const inv of earlier) if (inv && !isExternalRecord(inv)) for (const l of inv.lines || []) if (l.sourceType && l.sourceId) onBill.add(`${l.sourceType}:${l.sourceId}`);
    const pick = !encounterId;
    for (const a of actives) {
      if (a.encounterId === encounterId) continue;
      const ch = await chargesForPatient(request, env, { ...ctx, patientId, encounterId: a.encounterId });
      if (!ch.ok) return { ...base, ...ch, written: 0 };
      const ap = applyPackage(ch, a, ctx.tariff);
      if (pick && !encounterId && ap.lines.some((l) => !l.packageIncluded && !onBill.has(`${l.sourceType}:${l.sourceId}`))) { encounterId = a.encounterId; continue; }
      for (const it of [...(ch.priced || []), ...(ch.unpriced || [])]) if (it.sourceType && it.sourceId) packageKeys.add(`${it.sourceType}:${it.sourceId}`);
    }
  }
  let assignment = encounterId ? actives.find((a) => a.encounterId === encounterId) || null : null, packagePreAuth = null, packageStay = null;
  if (assignment) {
    packageStay = await svc.get("Encounter", encounterId).catch(() => null);
    if (assignment.preAuthId) packagePreAuth = await svc.get("PreAuthorisation", assignment.preAuthId).catch(() => undefined);
  }
  const charges = await chargesForPatient(request, env, { ...ctx, patientId, ...(assignment ? { encounterId } : {}) });
  if (!charges.ok) return { ...base, ...charges, written: 0 };
  if (!assignment && packageKeys.size) {
    const off = (it) => !(it.sourceType && it.sourceId && packageKeys.has(`${it.sourceType}:${it.sourceId}`));
    charges.priced = (charges.priced || []).filter(off); charges.unpriced = (charges.unpriced || []).filter(off);
  }
  const applied = assignment ? applyPackage(charges, assignment, ctx.tariff) : null;
  const billable = applied ? applied.lines : charges.priced;
  /* NOTHING RAISED IS SAID, WITH WHAT HAS NO PRICE (LT-30). This answered ok with written 0 and the
   * cashier screen showed nothing at all. The unpriced items go back by name so the screen can say
   * exactly which charges an administrator has to price. */
  const unpricedNames = ((applied ? applied.unpriced : charges.unpriced) || []).map((u) => ({ display: u.display || u.code, code: u.code, reason: u.reason }));
  if (!billable || !billable.length) return { ...base, ok: true, written: 0, skipped: "nothing_priced", unpriced: unpricedNames, ...(charges.unreadable ? { unreadable: charges.unreadable } : {}), detail: charges.tariffWarning || "Nothing chargeable is priced right now." };

  // NEVER TWICE. Every source event already sitting on an earlier invoice for this patient is
  // excluded here, before a second invoice can be raised against it.
  let existing;
  try { existing = (await svc.byPatient(TYPE, patientId)) || []; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  const alreadyInvoiced = new Set();
  for (const inv of existing) { if (inv && !isExternalRecord(inv)) for (const l of inv.lines || []) if (l.sourceType && l.sourceId) alreadyInvoiced.add(`${l.sourceType}:${l.sourceId}`); }
  const newLines = billable.filter((it) => !(it.sourceType && it.sourceId && alreadyInvoiced.has(`${it.sourceType}:${it.sourceId}`)));
  if (!newLines.length) return { ...base, ok: true, written: 0, skipped: "already_invoiced", detail: "Every currently priced item is already on an earlier invoice." };
  if (newLines.every((l) => l.packageIncluded)) return { ...base, ok: true, written: 0, skipped: "package_covers_all", detail: "Everything new on this stay is covered by its package, and the package is already on a bill." };

  /* P2.6: tax, from the region adapter and the hospital's own tariff only. India: a tariff item with a
   * gstRate gets a GST line, an exempt one says exempt, and one with no rate gets NO tax and is listed
   * back to the cashier - never assumed to be 0 percent or any default slab. A rate that is not a
   * number refuses the invoice: a bill with a guessed tax is worse than no bill. */
  /* PACKAGES AND GST (gst-packages; functions/_region_in.js packageRoomComponent). The package rate is exempt health
   * care (SAC 999311) EXCEPT a non-ICU room above Rs 5,000 a day inside it: that room is carved out as its own line,
   * valued by the hospital's pkgRoomValuation setting, and taxed at 5 percent; the package line keeps the rest. A covered
   * charge is at zero and carries no tax. A covered room day with no bed row refuses the bill: its class and tariff are
   * unknown, and GST on it cannot be worked out. A taxable line with no GST rate refuses the bill (review 2.1 rule 6).
   * ponytail: the room is valued from the stay's covered room days when the package line is billed; room days after a
   * package bill raised on an open stay are not in it, and the response says so (a debit note carries them). */
  const set = ctx.gst || {};
  const lineInput = newLines.filter((l) => !l.packageIncluded && !l.packageLine);
  const gst = gstForLines(lineInput, ctx.tariff, ctx.region, { inpatient: !!encounterId, settings: set });
  if (gst.invalid.length) return { ...base, ok: false, status: 422, error: "gst_rate_invalid", codes: gst.invalid, written: 0, detail: "These tariff items carry a GST rate that is not a number from 0 to 100. Correct the tariff before raising this invoice." };
  if (gst.unconfigured.length) return { ...base, ok: false, status: 422, error: "gst_rate_missing", codes: gst.unconfigured, written: 0, detail: "These items are taxable and have no GST rate on the Price list, so no bill was raised. An administrator sets each rate; none is assumed." };
  // gstForLines answers one line per input line, in order, once nothing is unconfigured or invalid.
  const gstOf = new Map(gst.applies ? lineInput.map((l, i) => [l, gst.lines[i]]) : []);
  const pkgLine = newLines.find((l) => l.packageLine);
  const room = gst.applies && pkgLine ? packageRoomComponent(assignment.package, applied.lines, ctx.tariff, set) : null;
  if (room && room.error) return { ...base, ok: false, status: 422, error: "room_tariff_missing", category: room.category, written: 0, detail: `This package covers room days in ${room.category}, which has no per-day room tariff on the Price list. GST cannot be worked out. Add the tariff before issuing this bill.` };
  const carved = !!(room && room.roomValue > 0);

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-invoice-${slug(patientId)}-${slug(at)}`;

  const billLines = [];
  for (const l of newLines) {
    const g = gstOf.get(l);
    const pk = l.packageCode ? { packageCode: l.packageCode, packageLine: !!l.packageLine, packageIncluded: !!l.packageIncluded, packageExcluded: !!l.packageExcluded, packageOutside: !!l.packageOutside } : {};
    const baseLine = { code: l.code, display: l.display, quantity: l.quantity, amount: l.amount, line: l.line, sourceType: l.sourceType || null, sourceId: l.sourceId || null };
    if (l.packageLine && gst.applies) {
      const exemptValue = carved ? room.exemptValue : l.line;
      billLines.push({ ...baseLine, amount: exemptValue, line: exemptValue, taxKind: "GST", taxRate: null, taxExempt: true, tax: 0, hsnSac: SAC.INPATIENT, taxBasis: GST_BASIS.PACKAGE, taxable: exemptValue, kind: "package", ...pk });
      if (carved) billLines.push({ code: `${l.code}-ROOM`, display: `Room charges within package: ${room.groups.map((x) => `${x.name}, ${x.days} day(s) at Rs ${x.ratePerDay} per day`).join("; ")}`,
        quantity: 1, amount: room.taxable, line: room.taxable, sourceType: l.sourceType, sourceId: `${l.sourceId}:room`,
        taxKind: "GST", taxRate: ROOM_GST_RATE, taxExempt: false, tax: room.tax, hsnSac: SAC.INPATIENT, taxBasis: GST_BASIS.PACKAGE_ROOM, taxable: room.taxable, kind: "bed", packageCode: l.packageCode, packageRoom: true });
      continue;
    }
    billLines.push({ ...baseLine, ...(g && !l.packageIncluded ? { taxKind: "GST", taxRate: g.gstRate, taxExempt: g.gstExempt, tax: g.tax, hsnSac: g.hsnSac, taxBasis: g.basis, taxable: g.taxable, kind: g.kind } : {}), ...pk });
  }

  let ep;
  try {
    ep = openInvoice({ id, patientId, encounterId, currency: charges.currency, lines: billLines, actorId: resolved.actor.id, at });
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
  ep.resourceType = TYPE;
  ep.source = { system: "wardsynq-native", sourceId: `invoice:${id}` };
  if (assignment) {
    const p = assignment.package;
    ep.package = { assignmentId: assignment.id, assignmentVersion: assignment.version, packageId: p.id, packageVersion: p.version, scheme: p.scheme, schemeName: p.schemeName || null,
      code: p.code, name: p.name, rate: p.rate, beneficiaryId: assignment.beneficiaryId || null, preAuthId: assignment.preAuthId || null,
      ...packageFlags(assignment, packageStay, packagePreAuth, Date.parse(at) || Date.now()), counts: applied.counts,
      ...(pkgLine && gst.applies ? { priceIncludesGst: p.priceIncludesGst === true } : {}),
      /* What the cashier and accounts are told about the carved-out room (review 2.5): days, value, method, whether it
       * was capped at the package price or fell back to the published tariff, and GST the hospital bears when the
       * payer's rate includes GST. gstTdsPossible: the scheme is one the hospital marked a notified GST TDS deductor. */
      ...(carved ? { roomGst: { days: room.days, groups: room.groups, taxable: room.taxable, tax: room.tax, method: room.method, fallback: room.fallback, capped: room.capped,
        unrecoverableGst: room.unrecoverableGst, gstTdsPossible: (set.gstTdsDeductorSchemes || []).includes(p.scheme) } } : {}) };
  }
  if (gst.applies) ep.placeOfSupply = set.placeOfSupply || "where_performed";
  if (gst.applies && str(ctx.gstin)) ep.taxRegistration = { kind: "GSTIN", id: str(ctx.gstin) };
  /* A TAX INVOICE CARRIES A CONSECUTIVE SERIAL NUMBER of at most 16 characters, unique for the financial year (Rule
   * 46(b) CGST Rules; the e-invoice DocDtls.No has the same limit). Issued only once the invoice itself is sound.
   * ponytail: a number issued and then not used (the invoice write fails) leaves a gap in the series; a hospital
   * explains gaps as cancelled numbers, the usual practice, rather than this taking a cross-record transaction. */
  /* A bill with nothing taxed is a Bill of Supply and takes its number from the BOS series; anything taxed takes the
   * invoice series (a Tax Invoice, or an Invoice-cum-Bill of Supply when exempt lines are on it too). */
  if (gst.applies) {
    try { ep.documentNumber = await nextDocumentNumber(ctx.recordDeps.repository, mig.tenantId, ep.lines.some(taxedLine) ? "INV" : "BOS", at, resolved.actor.id); }
    catch (e) { return { ...base, ok: false, status: 502, error: "document_number_failed", detail: "No invoice number could be issued, so nothing was raised.", written: 0 }; }
  }

  try {
    const out = await svc.put(ep, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...ep, version: out.record.version }), actor: resolved.actor.id,
      ...(unpricedNames.length ? { unpriced: unpricedNames } : {}), ...(charges.unreadable ? { unreadable: charges.unreadable } : {}),
      ...(carved && packageStay && !packageStay.periodEnd ? { warning: "This stay is still open. Room days after this bill are not in its GST room charges; raise a debit note for them." } : {}),
      ...(gst.applies ? { gst: { totalTax: gst.totalTax, missingHsnSac: gst.missingHsnSac, taxRegistration: ep.taxRegistration || null } } : {}) };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

const SERIES_TYPE = "_wardsynq_doc_series";
/** The next number in a document series ("INV", "CRN", "DBN") for the financial year of `at`: INV/2627/000001.
 *  Optimistic: two cashiers racing for the same number cannot both land (append refuses a version that exists). */
async function nextDocumentNumber(repo, tenantId, typ, at, actorId) {
  const fy = financialYearOf(at);
  if (!fy) throw new Error("no financial year for that time");
  const id = `${typ.toLowerCase()}-${fy}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await repo.latest(tenantId, SERIES_TYPE, id);
    const n = (cur ? Number(cur.last) || 0 : 0) + 1;
    const now = new Date().toISOString();
    const rec = { resourceType: SERIES_TYPE, id, version: cur ? cur.version + 1 : 1, series: typ, financialYear: fy, last: n, writtenBy: { id: actorId, kind: "human", at: now } };
    try {
      await repo.append(tenantId, [rec], { audit: { ts: now, actor: actorId, connectorId: "wardsynq-invoices", action: "document.number.issue", outcome: "ok", scope: { series: id, number: n } } });
      return `${typ}/${fy}/${String(n).padStart(6, "0")}`;
    } catch (e) { if (!(e instanceof VersionConflictError)) throw e; }
  }
  throw new Error("the document number series is busy");
}

/** Shared phase-transition runner: read the invoice, mutate it via the engine, write it back. `before(current, actorId)`,
 *  when given, runs first and may refuse (returns a response) or prepare the invoice (an issued document number). */
async function transition(request, env, ctx, run, before) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const invoiceId = str(ctx.invoiceId);
  if (!invoiceId) return { ...base, ok: false, status: 422, error: "invoice_required", written: 0 };

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const current = await svc.get(TYPE, invoiceId).catch(() => null);
  if (!current) return { ...base, ok: false, status: 404, error: "invoice_not_found", invoiceId, written: 0 };

  if (before) {
    const refused = await before(current, resolved.actor.id);
    if (refused) return { ...base, ...refused, invoiceId, written: 0 };
  }
  try { run(current, resolved.actor.id); }
  catch (e) { return { ...base, ...writeFailure(e, { invoiceId, written: 0, actor: resolved.actor.id }) }; }

  try {
    const out = await svc.put({ ...current, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...current, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { invoiceId, written: 0, actor: resolved.actor.id }) }; }
}

const at_ = (ctx) => str(ctx.at) || new Date().toISOString();

/** ctx: { migration, invoiceId, amount, reason, actorDeps, recordDeps } */
async function postDiscount(request, env, ctx) { return transition(request, env, ctx, (inv, actorId) => postEvent(inv, "discount", { amount: ctx.amount, actorId, at: at_(ctx), reason: ctx.reason })); }
/** ctx: { migration, invoiceId, amount, reference?, paymentAdapter?, actorDeps, recordDeps }. The
 * adapter call happens BEFORE transition() (its own `run` is synchronous, so the adapter's async
 * result must already be in hand) - never blocks the deposit itself, the same "never claim more
 * than the adapter reports" discipline wardsynq-payment-adapter.js's own header states. */
/* HOW the money was taken, checked before anything is recorded.
 *
 * A collection that cannot be reconciled later is not a collection anybody can act on: cash with no
 * counter cannot be matched against a drawer, and a bank transfer with no UTR cannot be matched
 * against a statement. wardsynq-payment-methods.js decides what each method must carry, from the
 * hospital's OWN configuration - a hospital that has configured nothing takes cash only.
 *
 * It also decides what may honestly be CLAIMED. Everything is recorded as manually captured until a
 * provider actually answers; the reply is applied afterwards and is the only thing that can produce
 * an integrated capture. A request body cannot ask for one.
 *
 * A hospital that has configured no payment methods at all keeps working exactly as before - the
 * check is skipped rather than refusing every payment on a config nobody has filled in yet. */
function collectionFor(ctx, kind) {
  if (!ctx.paymentMethods && !str(ctx.method)) return { ok: true, collection: null };
  if (!str(ctx.method)) {
    return { ok: false, error: "method_required", detail: "Say how the money was taken." };
  }
  return validateCollection(
    { method: ctx.method, amount: ctx.amount, details: ctx.paymentDetails || {} },
    ctx.paymentMethods || null,
  );
}

async function postDeposit(request, env, ctx) {
  const c = collectionFor(ctx, "deposit");
  if (!c.ok) return { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null, ok: false, status: 422, error: c.error, detail: c.detail, ...(c.missing ? { missing: c.missing } : {}), written: 0 };
  const adapter = await submitPaymentViaAdapter({ kind: "deposit", amount: ctx.amount, reference: ctx.reference, method: c.collection && c.collection.method }, ctx.paymentAdapter || null);
  const collection = c.collection ? applyAdapterResult(c.collection, adapter) : null;
  return transition(request, env, ctx, (inv, actorId) => postEvent(inv, "deposit", { amount: ctx.amount, actorId, at: at_(ctx), reference: ctx.reference, adapter, ...(collection ? { collection } : {}) }));
}
/** ctx: { migration, invoiceId, amount, reference?, method?, paymentDetails?, paymentMethods?, paymentAdapter?, actorDeps, recordDeps } */
async function postPayment(request, env, ctx) {
  const c = collectionFor(ctx, "payment");
  if (!c.ok) return { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null, ok: false, status: 422, error: c.error, detail: c.detail, ...(c.missing ? { missing: c.missing } : {}), written: 0 };
  const adapter = await submitPaymentViaAdapter({ kind: "payment", amount: ctx.amount, reference: ctx.reference, method: c.collection && c.collection.method }, ctx.paymentAdapter || null);
  const collection = c.collection ? applyAdapterResult(c.collection, adapter) : null;
  return transition(request, env, ctx, (inv, actorId) => postEvent(inv, "payment", { amount: ctx.amount, actorId, at: at_(ctx), reference: ctx.reference, adapter, ...(collection ? { collection } : {}) }));
}
/** ctx: { migration, invoiceId, amount, reason, reference?, actorDeps, recordDeps } */
async function postRefund(request, env, ctx) { return transition(request, env, ctx, (inv, actorId) => postEvent(inv, "refund", { amount: ctx.amount, actorId, at: at_(ctx), reason: ctx.reason, reference: ctx.reference })); }
/** ctx: { migration, invoiceId, amount, reason, actorDeps, recordDeps } */
async function postAdjustment(request, env, ctx) { return transition(request, env, ctx, (inv, actorId) => postEvent(inv, "adjustment", { amount: ctx.amount, actorId, at: at_(ctx), reason: ctx.reason })); }
/** ctx: { migration, invoiceId, amount, reason, actorDeps, recordDeps } */
async function postWriteOff(request, env, ctx) { return transition(request, env, ctx, (inv, actorId) => postEvent(inv, "write_off", { amount: ctx.amount, actorId, at: at_(ctx), reason: ctx.reason })); }
/** ctx: { migration, invoiceId, reason, actorDeps, recordDeps } */
async function voidInvoiceRoute(request, env, ctx) { return transition(request, env, ctx, (inv, actorId) => voidInvoice(inv, { actorId, at: at_(ctx), reason: ctx.reason })); }

/**
 * A credit or debit note (gap-claims-gst B). ctx: { migration, invoiceId, kind: "credit_note"|"debit_note", reason,
 * lines: [{ lineIndex, taxable }], at?, actorDeps, recordDeps }. The note is checked against the invoice BEFORE its
 * number is issued, so a refused note uses no number. A credit note reversing GST after the Section 34 time limit
 * is still recorded (the bill is still reduced) but carries `gstReversalLate` and the response says so: the tax
 * cannot be reduced in the return any more.
 */
async function postNoteRoute(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const kind = str(ctx.kind);
  if (!NOTE_KINDS.includes(kind)) return { ...base, ok: false, status: 422, error: "unknown_note_kind", written: 0 };
  const invoiceId = str(ctx.invoiceId);
  if (!invoiceId) return { ...base, ok: false, status: 422, error: "invoice_required", written: 0 };
  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(TYPE, invoiceId); }
  catch (e) { return { ...base, ...writeFailure(e, { invoiceId, written: 0 }) }; }
  if (!current) return { ...base, ok: false, status: 404, error: "invoice_not_found", invoiceId, written: 0 };
  const at = at_(ctx), actorId = resolved.actor.id;
  const opts = { actorId, at, reason: ctx.reason, lines: ctx.lines };
  let probe;
  try { probe = postNote(JSON.parse(JSON.stringify(current)), kind, { ...opts, noteNumber: "CHECK" }).events.at(-1); }
  catch (e) { return { ...base, ...writeFailure(e, { invoiceId, written: 0, actor: actorId }) }; }
  /* WHEN A CREDIT NOTE MAY REDUCE GST (Section 34(2) CGST Act; its proviso substituted by s.126 Finance (No. 7) Act,
   * 2025, from 1 October 2025). Only a note on TAXED lines is a Section 34 credit note; one on exempt lines carries no
   * GST and is a financial credit note (Circular 92/11/2019-GST para 2.D(iii)). A Section 34 note:
   * - after 30 November following the supply's financial year: issued without GST, and the response says so.
   * - to a registered recipient: reduces GST only once it has reversed the matching input tax credit, so the cashier
   *   records that confirmation (gstTreatment "itc_reversed" with its reference) or issues the note without GST.
   * - to a patient: reduces GST only if the GST is actually refunded, so the cashier confirms it is refunded with this
   *   note ("gst_refunded") or issues it without GST.
   * Asked BEFORE a number is issued, so a note waiting for that answer uses no number and writes nothing. */
  const raisedAt = str(((current.events || [])[0] || {}).at);
  const deadline = section34Deadline(raisedAt);
  const note = { withoutGst: false, gstTreatment: null, gstConfirmation: null, late: false };
  if (kind === "credit_note" && probe.tax > 0) {
    const registered = !!(current.buyer && str(current.buyer.gstin));
    const t = str(ctx.gstTreatment), ref = str(ctx.gstConfirmation).slice(0, 200);
    if (deadline && istDateOf(at) > deadline) Object.assign(note, { withoutGst: true, gstTreatment: "without_gst", late: true });
    else if (istDateOf(at) >= SECTION_34_PROVISO_FROM) {
      if (t === "without_gst") Object.assign(note, { withoutGst: true, gstTreatment: t });
      else if (registered && t === "itc_reversed" && ref) Object.assign(note, { gstTreatment: t, gstConfirmation: { reference: ref, by: actorId, at } });
      else if (!registered && t === "gst_refunded") Object.assign(note, { gstTreatment: t, gstConfirmation: { reference: ref || null, by: actorId, at } });
      else return { ...base, ok: false, status: 409, error: "gst_confirmation_required", recipient: registered ? "registered" : "patient", gst: probe.tax,
        payerName: registered ? str(current.buyer.legalName) : null, written: 0, invoiceId,
        detail: registered
          ? `GST on this credit note reduces the hospital's tax only after ${str(current.buyer.legalName)} reverses the matching input tax credit. Record their confirmation.`
          : `GST on this credit note reduces the hospital's tax only if the GST is refunded to the patient. Refund Rs ${probe.tax} of GST with this note, or issue it without GST.` };
    }
  }
  let noteNumber;
  try { noteNumber = await nextDocumentNumber(ctx.recordDeps.repository, mig.tenantId, kind === "credit_note" ? "CRN" : "DBN", at, actorId); }
  catch { return { ...base, ok: false, status: 502, error: "document_number_failed", detail: "No note number could be issued, so nothing was recorded.", written: 0 }; }
  postNote(current, kind, { ...opts, noteNumber, withoutGst: note.withoutGst, gstTreatment: note.gstTreatment, gstConfirmation: note.gstConfirmation });
  const ev = current.events[current.events.length - 1];
  if (note.late) ev.gstReversalLate = true;
  const fy = financialYearOf(raisedAt);
  try {
    const out = await svc.put({ ...current, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, noteNumber, ...summary({ ...current, version: out.record.version }), actor: actorId,
      ...(note.late ? { warning: `The last date to reduce GST for supplies of 20${fy.slice(0, 2)}-${fy.slice(2)} was ${deadline}. This note is issued without GST.` } : {}) };
  } catch (e) { return { ...base, ...writeFailure(e, { invoiceId, written: 0, actor: actorId, noteNumber }) }; }
}
const SECTION_34_PROVISO_FROM = "2025-10-01";

/** ctx: { migration, invoiceId, buyer: { gstin, legalName, address1, location, pincode, stateCode, pos } | null }.
 *  An empty GSTIN clears the buyer: the bill is then to a person (B2C). */
async function setBuyerRoute(request, env, ctx) {
  const v = validateBuyer(ctx.buyer);
  if (v.errors) return { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null, ok: false, status: 422, error: "invalid_buyer", errors: v.errors, written: 0 };
  const set = ctx.gst || {};
  return transition(request, env, ctx, (inv, actorId) => setBuyer(inv, v.buyer, { actorId, at: at_(ctx) }), async (inv, actorId) => {
    if (!v.buyer || inv.void || (inv.einvoices || []).some((x) => x && x.status === "ACT")) return null;
    /* WHO RECEIVES A CASHLESS CLAIM (s.2(93)(a) CGST Act) is the hospital's setting, default the patient: an insurer, TPA
     * or scheme is then only the payer, and the bill stays B2C. A stay on a scheme or insurer package is a cashless
     * claim whatever the cashier chose. */
    const payer = v.buyer.kind === "payer" || !!(inv.package && inv.package.scheme && inv.package.scheme !== "hospital");
    if (payer && set.recipientOfCashlessClaims !== "payer") return { ok: false, status: 422, error: "payer_not_recipient",
      detail: "Your GST settings treat the patient as the recipient of a cashless claim, so this bill stays a bill to the patient; the insurer, TPA or scheme is named as payer only. Nothing was changed." };
    /* A registered buyer of a bill with taxed and exempt lines gets a separate Bill of Supply for the exempt ones, with
     * its own number, issued once. */
    const lines = inv.lines || [];
    if (!inv.billOfSupplyNumber && str(inv.documentNumber) && lines.some(taxedLine) && lines.some((l) => !taxedLine(l))) {
      try { inv.billOfSupplyNumber = await nextDocumentNumber(ctx.recordDeps.repository, ctx.migration.tenantId, "BOS", at_(ctx), actorId); }
      catch { return { ok: false, status: 502, error: "document_number_failed", detail: "No Bill of Supply number could be issued, so the buyer was not saved." }; }
    }
    return null;
  });
}

/** ctx: { migration, invoiceId, actorDeps, recordDeps } */
async function readInvoice(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", invoice: null };
  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, invoice: null };
  const invoiceId = str(ctx.invoiceId);
  if (!invoiceId) return { ...base, ok: false, status: 422, error: "invoice_required", invoice: null };
  const inv = await svc.get(TYPE, invoiceId).catch(() => null);
  if (!inv) return { ...base, ok: false, status: 404, error: "invoice_not_found", invoice: null };
  return { ...base, ok: true, invoice: summary(inv) };
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function invoicesForPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", invoices: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", invoices: [] };
  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, invoices: [] };
  let rows;
  try { rows = (await svc.byPatient(TYPE, patientId)) || []; }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), invoices: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), invoices: [] };
  }
  const invoices = rows.filter(Boolean).filter((r) => !isExternalRecord(r)).map(summary).sort((a, b) => String(b.invoiceId).localeCompare(String(a.invoiceId)));
  return {
    ...base, ok: true, invoices, patientId,
    outstandingBalance: Math.round(invoices.reduce((n, i) => n + (i.status === "void" ? 0 : i.balance), 0) * 100) / 100,
  };
}

export {
  TYPE, raiseInvoice, postDiscount, postDeposit, postPayment, postRefund, postAdjustment, postWriteOff,
  voidInvoiceRoute, readInvoice, invoicesForPatient, stayForInvoice, invoicesForStay,
  postNoteRoute, setBuyerRoute, nextDocumentNumber, summary as invoiceSummary, interStateOf, open_ as openInvoiceService, writeFailure as invoiceWriteFailure,
};
