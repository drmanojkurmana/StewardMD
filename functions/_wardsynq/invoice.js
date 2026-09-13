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
import { openInvoice, postEvent, voidInvoice, reconciliationOf, receiptFor, receiptsFor, InvoiceRefusalError } from "../../wardsynq/wardsynq-invoice.js";
import { validateCollection, applyAdapterResult } from "../../wardsynq/wardsynq-payment-methods.js";
import { chargesForPatient } from "./charge-capture.js";
import { submitPaymentViaAdapter } from "../../wardsynq/wardsynq-payment-adapter.js";

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
function summary(inv) {
  return { invoiceId: inv.id, patientId: inv.patientId, encounterId: inv.encounterId, currency: inv.currency, lines: inv.lines, events: inv.events, void: inv.void, voidReason: inv.voidReason, version: inv.version, receipts: receiptsFor(inv), ...reconciliationOf(inv) };
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

  const charges = await chargesForPatient(request, env, { ...ctx, patientId });
  if (!charges.ok) return { ...base, ...charges, written: 0 };
  if (!charges.priced || !charges.priced.length) return { ...base, ok: true, written: 0, skipped: "nothing_priced", detail: charges.tariffWarning || "Nothing chargeable is priced right now." };

  // NEVER TWICE. Every source event already sitting on an earlier invoice for this patient is
  // excluded here, before a second invoice can be raised against it.
  let existing;
  try { existing = (await svc.byPatient(TYPE, patientId)) || []; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  const alreadyInvoiced = new Set();
  for (const inv of existing) { if (inv && !isExternalRecord(inv)) for (const l of inv.lines || []) if (l.sourceType && l.sourceId) alreadyInvoiced.add(`${l.sourceType}:${l.sourceId}`); }
  const newLines = charges.priced.filter((it) => !(it.sourceType && it.sourceId && alreadyInvoiced.has(`${it.sourceType}:${it.sourceId}`)));
  if (!newLines.length) return { ...base, ok: true, written: 0, skipped: "already_invoiced", detail: "Every currently priced item is already on an earlier invoice." };

  const at = str(ctx.at) || new Date().toISOString();
  const id = `wsq-invoice-${slug(patientId)}-${slug(at)}`;

  let ep;
  try {
    ep = openInvoice({
      id, patientId, encounterId: str(ctx.encounterId) || null, currency: charges.currency,
      lines: newLines.map((l) => ({ code: l.code, display: l.display, quantity: l.quantity, amount: l.amount, line: l.line, sourceType: l.sourceType || null, sourceId: l.sourceId || null })),
      actorId: resolved.actor.id, at,
    });
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
  ep.resourceType = TYPE;
  ep.source = { system: "wardsynq-native", sourceId: `invoice:${id}` };

  try {
    const out = await svc.put(ep, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...ep, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
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
  voidInvoiceRoute, readInvoice, invoicesForPatient,
};
