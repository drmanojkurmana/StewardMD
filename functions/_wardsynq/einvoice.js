/* functions/_wardsynq/einvoice.js - the cashier's e-invoice actions: generate an IRN, cancel one.
 *
 * The order of refusals is the order a cashier can act on them: not connected, not enabled for this hospital,
 * the bill (void, B2C, no number, nothing taxed, no HSN/SAC), then the portal's own answer. Nothing is written
 * unless the portal returned an IRN (or confirmed a cancellation); the IRN is then appended to the invoice as a
 * new version, through RecordService like every other ledger change. A portal refusal is audited without the
 * bill being touched.
 *
 * CANCELLATION within 24 hours of the acknowledgement only (Cancel IRN, https://einv-apisandbox.nic.in/version1.03/cancel-irn.html);
 * after that the correction is a credit note, and the screen says so.
 */

import { activeConnectors, openConnectorSecrets } from "./connectors.js";
import { EINVOICE_ADAPTERS, CANCEL_REASONS, irnRequest } from "./einvoice-irp.js";
import { recordIrn, recordIrnCancel } from "../../wardsynq/wardsynq-invoice.js";
import { invoiceSummary, openInvoiceService, invoiceWriteFailure } from "./invoice.js";
import { einvoiceApplicability } from "./gst-settings.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "Invoice";
const DAY_MS = 86400000;
const auditEvent = (action, actor, scope, outcome) => ({ ts: new Date().toISOString(), actor, connectorId: "wardsynq-einvoice", action, outcome: outcome || "ok", scope });

/** "yyyy-MM-dd HH:mm:ss" from the portal is India time. */
function ackMs(ackDt) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(str(ackDt));
  return m ? Date.parse(`${m[1]}T${m[2]}+05:30`) : NaN;
}

async function prepare(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { done: { ...base, ok: true, skipped: "off", written: 0 } };
  const invoiceId = str(ctx.invoiceId);
  if (!invoiceId) return { done: { ...base, ok: false, status: 422, error: "invoice_required", written: 0 } };
  const { svc, resolved, error } = await openInvoiceService(request, env, ctx, "record:write");
  if (error) return { done: { ...base, ...error, written: 0 } };
  const repo = ctx.recordDeps.repository;
  let conn, inv;
  try { conn = (await activeConnectors(repo, mig.tenantId, "einvoice"))[0] || null; }
  catch { return { done: { ...base, ok: false, status: 502, error: "record_read_failed", message: "The e-invoice settings could not be read, so nothing was sent.", written: 0 } }; }
  const adapter = conn && EINVOICE_ADAPTERS[conn.provider];
  if (!adapter) return { done: { ...base, ok: false, status: 409, error: "einvoice_not_connected", message: "E-invoicing is not connected for this hospital (Admin > Integrations > GST e-invoicing). Nothing was sent.", written: 0 } };
  /* Asked before the bill is opened, so a hospital that is not reporting does not read (and audit reading) a bill for
   * nothing. Applicability is the aggregate turnover entered on the GST settings, exempt supplies included. */
  const applic = einvoiceApplicability(ctx.gst);
  if (ctx.requireEnabled && !applic.applies) return { done: { ...base, ok: false, status: 409, error: "einvoice_not_enabled", reason: applic.reason, written: 0,
    message: applic.reason === "turnover_not_entered"
      ? "E-invoicing is not enabled: the hospital's aggregate turnover is not entered on Admin > Price list > GST settings. Nothing was sent."
      : "E-invoicing does not apply: the aggregate turnover entered (exempt supplies included) is not above Rs 5 crore. Nothing was sent." } };
  try { inv = await svc.get(TYPE, invoiceId); }
  catch (e) { return { done: { ...base, ...invoiceWriteFailure(e, { invoiceId, written: 0 }) } }; }
  if (!inv) return { done: { ...base, ok: false, status: 404, error: "invoice_not_found", invoiceId, written: 0 } };
  const noteNumber = str(ctx.noteNumber);
  const note = noteNumber ? (inv.events || []).find((e) => e && (e.kind === "credit_note" || e.kind === "debit_note") && e.noteNumber === noteNumber) : null;
  if (noteNumber && !note) return { done: { ...base, ok: false, status: 404, error: "note_not_found", message: "No note with that number on this bill.", written: 0 } };
  return { base, svc, actorId: resolved.actor.id, repo, conn, adapter, inv, note, docNumber: noteNumber || str(inv.documentNumber) };
}

/** ctx: { migration, invoiceId, noteNumber?, fetchImpl?, actorDeps, recordDeps } */
async function generateIrnRoute(request, env, ctx) {
  const p = await prepare(request, env, { ...ctx, requireEnabled: true });
  if (p.done) return p.done;
  const { base, svc, actorId, repo, conn, adapter, inv, note, docNumber } = p;
  const tenantId = ctx.migration.tenantId;
  const refuse = (status, error, message, extra) => ({ ...base, ok: false, status, error, message, written: 0, ...(extra || {}) });
  if (inv.void) return refuse(409, "invoice_void", "This bill is cancelled; it is not reported.");
  if ((inv.einvoices || []).some((x) => x && x.docNumber === docNumber && x.status === "ACT")) return refuse(409, "irn_exists", "This document already has an IRN.");
  const req = irnRequest(inv, conn.settings || {}, note);
  if (req.error) return refuse(req.error === "b2c_not_reported" ? 409 : 422, req.error, req.detail, req.codes ? { codes: req.codes } : null);

  const secrets = await openConnectorSecrets(env, conn);
  let got;
  try { got = await adapter.generateIrn({ payload: req.payload, settings: conn.settings || {}, secrets, fetchImpl: ctx.fetchImpl, resolveHost: ctx.resolveHost }); }
  catch (e) { got = { ok: false, reason: "error", detail: `The e-invoice request could not be made (${str(e && e.message).slice(0, 80)}).` }; }
  const scope = { invoiceId: inv.id, docType: req.payload.DocDtls.Typ, docNumber, provider: conn.provider };
  if (!got.ok) {
    try { await repo.auditOnly(tenantId, auditEvent("einvoice.irn.refused", actorId, { ...scope, reason: got.reason || null, httpStatus: got.httpStatus || null }, "refused")); } catch { /* the refusal is still returned */ }
    return refuse(502, "irp_refused", `No IRN was issued, and nothing was recorded. ${str(got.detail)}`);
  }
  const at = new Date().toISOString();
  recordIrn(inv, { docType: req.payload.DocDtls.Typ, docNumber, irn: got.irn, ackNo: got.ackNo, ackDt: got.ackDt, signedQrCode: got.signedQrCode, actorId, at });
  try {
    const out = await svc.put({ ...inv, resourceType: TYPE }, { expectedVersion: inv.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, irn: got.irn, ackNo: got.ackNo, ackDt: got.ackDt, ...invoiceSummary({ ...inv, version: out.record.version }), actor: actorId };
  } catch (e) {
    // The portal has the IRN: said in full so it can be written on the bill by hand, never lost silently.
    return { ...base, ...invoiceWriteFailure(e, { written: 0, actor: actorId, irn: got.irn, ackNo: got.ackNo, ackDt: got.ackDt }), message: `The portal issued IRN ${got.irn} (acknowledgement ${got.ackNo}) but it could not be recorded here. Write it on the bill and reload.` };
  }
}

/** ctx: { migration, invoiceId, noteNumber?, reasonCode, remark?, nowMs?, fetchImpl?, actorDeps, recordDeps } */
async function cancelIrnRoute(request, env, ctx) {
  const code = str(ctx.reasonCode);
  if (!CANCEL_REASONS[code]) return { ok: false, status: 422, error: "cancel_reason_required", message: "Choose why the IRN is cancelled.", written: 0 };
  if (str(ctx.remark).length > 100) return { ok: false, status: 422, error: "remark_too_long", message: "The remark is up to 100 characters.", written: 0 };
  const p = await prepare(request, env, ctx);
  if (p.done) return p.done;
  const { base, svc, actorId, repo, conn, adapter, inv, docNumber } = p;
  const entry = (inv.einvoices || []).find((x) => x && x.docNumber === docNumber && x.status === "ACT");
  if (!entry) return { ...base, ok: false, status: 409, error: "no_active_irn", message: "This document has no active IRN to cancel.", written: 0 };
  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const ack = ackMs(entry.ackDt);
  if (!Number.isFinite(ack) || nowMs - ack > DAY_MS) return { ...base, ok: false, status: 409, error: "cancel_window_closed", message: "An IRN can be cancelled only within 24 hours of its acknowledgement. Raise a credit note instead.", written: 0 };

  const secrets = await openConnectorSecrets(env, conn);
  let got;
  try { got = await adapter.cancelIrn({ irn: entry.irn, reasonCode: code, remark: ctx.remark, settings: conn.settings || {}, secrets, fetchImpl: ctx.fetchImpl, resolveHost: ctx.resolveHost }); }
  catch (e) { got = { ok: false, reason: "error", detail: `The cancellation could not be sent (${str(e && e.message).slice(0, 80)}).` }; }
  if (!got.ok) {
    try { await repo.auditOnly(ctx.migration.tenantId, auditEvent("einvoice.cancel.refused", actorId, { invoiceId: inv.id, docNumber, reason: got.reason || null, httpStatus: got.httpStatus || null }, "refused")); } catch { /* still returned */ }
    return { ...base, ok: false, status: 502, error: "irp_refused", message: `The IRN was not cancelled, and nothing was recorded. ${str(got.detail)}`, written: 0 };
  }
  recordIrnCancel(inv, { irn: entry.irn, cancelDate: got.cancelDate, reasonCode: code, remark: ctx.remark, actorId, at: new Date().toISOString() });
  try {
    const out = await svc.put({ ...inv, resourceType: TYPE }, { expectedVersion: inv.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, irn: entry.irn, ...invoiceSummary({ ...inv, version: out.record.version }), actor: actorId };
  } catch (e) {
    return { ...base, ...invoiceWriteFailure(e, { written: 0, actor: actorId }), message: `The portal cancelled IRN ${entry.irn} but that could not be recorded here. Reload before doing anything else with this bill.` };
  }
}

/** What the cashier screen says about e-invoicing at this hospital: not_connected, not_enabled or ready. No setting
 *  or credential is returned; reading bills (billing.view) is enough to know whether they are reported. */
async function einvoiceStatus(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: true, state: "not_connected" };
  const { error } = await openInvoiceService(request, env, ctx, "record:read");
  if (error) return error;
  let conn;
  try { conn = (await activeConnectors(ctx.recordDeps.repository, mig.tenantId, "einvoice"))[0] || null; }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The e-invoice settings could not be read." }; }
  const applic = einvoiceApplicability(ctx.gst);
  return { ok: true, state: !conn || !EINVOICE_ADAPTERS[conn.provider] ? "not_connected" : applic.applies ? "ready" : "not_enabled", ...(applic.reason ? { reason: applic.reason } : {}) };
}

export { generateIrnRoute, cancelIrnRoute, einvoiceStatus, ackMs };
