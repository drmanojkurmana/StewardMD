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
import { gstForLines, gstSplit, financialYearOf, istDateOf, section34Deadline, validateBuyer } from "../_region_in.js";
import { ADMISSION_CLASSES, OPEN } from "./migrate-inpatient.js";

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

/* PURE. Whether this invoice is an inter-state supply: a B2B buyer whose place of supply is not the seller's state
 * (the first two digits of the hospital's GSTIN are its state code). A bill to a person (B2C) is treated as
 * within the state.
 * ponytail: B2C is always intra-state (the hospital's own state); a B2C place of supply from the patient's address
 * (Section 12(2)(b) IGST Act) needs an address on the invoice first. */
function interStateOf(inv) {
  const seller = str(inv && inv.taxRegistration && inv.taxRegistration.id).slice(0, 2), pos = str(inv && inv.buyer && inv.buyer.pos);
  return !!(seller && pos && seller !== pos);
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
  return { taxRegistration: inv.taxRegistration || null, documentNumber: inv.documentNumber || null, buyer: inv.buyer || null, einvoices: inv.einvoices || [], ...withSplit(inv), invoiceId: inv.id, patientId: inv.patientId, encounterId: inv.encounterId, currency: inv.currency, void: inv.void, voidReason: inv.voidReason, version: inv.version, receipts: receiptsFor(inv), ...reconciliationOf(inv) };
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
  const encounterId = stay.encounterId;

  const charges = await chargesForPatient(request, env, { ...ctx, patientId });
  if (!charges.ok) return { ...base, ...charges, written: 0 };
  /* NOTHING RAISED IS SAID, WITH WHAT HAS NO PRICE (LT-30). This answered ok with written 0 and the
   * cashier screen showed nothing at all. The unpriced items go back by name so the screen can say
   * exactly which charges an administrator has to price. */
  const unpricedNames = (charges.unpriced || []).map((u) => ({ display: u.display || u.code, code: u.code, reason: u.reason }));
  if (!charges.priced || !charges.priced.length) return { ...base, ok: true, written: 0, skipped: "nothing_priced", unpriced: unpricedNames, ...(charges.unreadable ? { unreadable: charges.unreadable } : {}), detail: charges.tariffWarning || "Nothing chargeable is priced right now." };

  // NEVER TWICE. Every source event already sitting on an earlier invoice for this patient is
  // excluded here, before a second invoice can be raised against it.
  let existing;
  try { existing = (await svc.byPatient(TYPE, patientId)) || []; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  const alreadyInvoiced = new Set();
  for (const inv of existing) { if (inv && !isExternalRecord(inv)) for (const l of inv.lines || []) if (l.sourceType && l.sourceId) alreadyInvoiced.add(`${l.sourceType}:${l.sourceId}`); }
  const newLines = charges.priced.filter((it) => !(it.sourceType && it.sourceId && alreadyInvoiced.has(`${it.sourceType}:${it.sourceId}`)));
  if (!newLines.length) return { ...base, ok: true, written: 0, skipped: "already_invoiced", detail: "Every currently priced item is already on an earlier invoice." };

  /* P2.6: tax, from the region adapter and the hospital's own tariff only. India: a tariff item with a
   * gstRate gets a GST line, an exempt one says exempt, and one with no rate gets NO tax and is listed
   * back to the cashier - never assumed to be 0 percent or any default slab. A rate that is not a
   * number refuses the invoice: a bill with a guessed tax is worse than no bill. */
  const gst = gstForLines(newLines, ctx.tariff, ctx.region, { inpatient: !!encounterId });
  if (gst.invalid.length) return { ...base, ok: false, status: 422, error: "gst_rate_invalid", codes: gst.invalid, written: 0, detail: "These tariff items carry a GST rate that is not a number from 0 to 100. Correct the tariff before raising this invoice." };
  const taxByCode = new Map(gst.lines.map((g) => [g.code.toUpperCase(), g]));

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-invoice-${slug(patientId)}-${slug(at)}`;

  let ep;
  try {
    ep = openInvoice({
      id, patientId, encounterId, currency: charges.currency,
      lines: newLines.map((l) => {
        const g = taxByCode.get(str(l.code).toUpperCase());
        return { code: l.code, display: l.display, quantity: l.quantity, amount: l.amount, line: l.line, sourceType: l.sourceType || null, sourceId: l.sourceId || null,
          ...(g ? { taxKind: "GST", taxRate: g.gstRate, taxExempt: g.gstExempt, tax: g.tax, hsnSac: g.hsnSac, taxBasis: g.basis, taxable: g.taxable, kind: g.kind } : {}) };
      }),
      actorId: resolved.actor.id, at,
    });
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
  ep.resourceType = TYPE;
  ep.source = { system: "wardsynq-native", sourceId: `invoice:${id}` };
  if (gst.applies && str(ctx.gstin)) ep.taxRegistration = { kind: "GSTIN", id: str(ctx.gstin) };
  /* A TAX INVOICE CARRIES A CONSECUTIVE SERIAL NUMBER of at most 16 characters, unique for the financial year (Rule
   * 46(b) CGST Rules; the e-invoice DocDtls.No has the same limit). Issued only once the invoice itself is sound.
   * ponytail: a number issued and then not used (the invoice write fails) leaves a gap in the series; a hospital
   * explains gaps as cancelled numbers, the usual practice, rather than this taking a cross-record transaction. */
  if (gst.applies) {
    try { ep.documentNumber = await nextDocumentNumber(ctx.recordDeps.repository, mig.tenantId, "INV", at, resolved.actor.id); }
    catch (e) { return { ...base, ok: false, status: 502, error: "document_number_failed", detail: "No invoice number could be issued, so nothing was raised.", written: 0 }; }
  }

  try {
    const out = await svc.put(ep, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...ep, version: out.record.version }), actor: resolved.actor.id,
      ...(unpricedNames.length ? { unpriced: unpricedNames } : {}), ...(charges.unreadable ? { unreadable: charges.unreadable } : {}),
      ...(gst.applies ? { gst: { totalTax: gst.totalTax, unconfigured: gst.unconfigured, missingHsnSac: gst.missingHsnSac, taxRegistration: ep.taxRegistration || null } } : {}) };
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

/** Shared phase-transition runner: read the invoice, mutate it via the engine, write it back. */
async function transition(request, env, ctx, run) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const invoiceId = str(ctx.invoiceId);
  if (!invoiceId) return { ...base, ok: false, status: 422, error: "invoice_required", written: 0 };

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const current = await svc.get(TYPE, invoiceId).catch(() => null);
  if (!current) return { ...base, ok: false, status: 404, error: "invoice_not_found", invoiceId, written: 0 };

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
  try { postNote(JSON.parse(JSON.stringify(current)), kind, { ...opts, noteNumber: "CHECK" }); }
  catch (e) { return { ...base, ...writeFailure(e, { invoiceId, written: 0, actor: actorId }) }; }
  let noteNumber;
  try { noteNumber = await nextDocumentNumber(ctx.recordDeps.repository, mig.tenantId, kind === "credit_note" ? "CRN" : "DBN", at, actorId); }
  catch { return { ...base, ok: false, status: 502, error: "document_number_failed", detail: "No note number could be issued, so nothing was recorded.", written: 0 }; }
  postNote(current, kind, { ...opts, noteNumber });
  const ev = current.events[current.events.length - 1];
  const raisedAt = str(((current.events || [])[0] || {}).at);
  const deadline = section34Deadline(raisedAt);
  if (kind === "credit_note" && ev.tax > 0 && deadline && istDateOf(at) > deadline) ev.gstReversalLate = true;
  try {
    const out = await svc.put({ ...current, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, noteNumber, ...summary({ ...current, version: out.record.version }), actor: actorId,
      ...(ev.gstReversalLate ? { warning: `The time limit for reducing GST on this supply was ${deadline} (Section 34 CGST Act). The bill is reduced, but the GST cannot be reduced in the return.` } : {}) };
  } catch (e) { return { ...base, ...writeFailure(e, { invoiceId, written: 0, actor: actorId, noteNumber }) }; }
}

/** ctx: { migration, invoiceId, buyer: { gstin, legalName, address1, location, pincode, stateCode, pos } | null }.
 *  An empty GSTIN clears the buyer: the bill is then to a person (B2C). */
async function setBuyerRoute(request, env, ctx) {
  const v = validateBuyer(ctx.buyer);
  if (v.errors) return { mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null, ok: false, status: 422, error: "invalid_buyer", errors: v.errors, written: 0 };
  return transition(request, env, ctx, (inv, actorId) => setBuyer(inv, v.buyer, { actorId, at: at_(ctx) }));
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
