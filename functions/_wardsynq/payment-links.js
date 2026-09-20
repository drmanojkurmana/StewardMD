/* functions/_wardsynq/payment-links.js - owner S2: a bill paid online is marked paid by the gateway, never
 * by the browser.
 *
 * THE FLOW.
 *   1. The cashier asks for a payment link for an invoice's balance (POST /ward/invoice-payment-link). The
 *      hospital's payment connector (connectors.js) creates it at the gateway; a PaymentRequest record
 *      remembers WHAT was asked: invoice, amount in the minor unit, currency, the gateway's reference.
 *   2. The patient pays on the gateway's own page. Nothing the patient's browser says is read anywhere.
 *   3. The gateway calls POST /api/queue/payment-callback/<orgId> (unauthenticated by design, like any
 *      gateway webhook). The invoice is marked paid ONLY WHEN, in order:
 *        - the signature over the raw body verifies with this hospital's sealed webhook secret;
 *        - the event is a completed payment naming a request this hospital issued, for the same gateway
 *          reference;
 *        - the gateway's own API, asked with this hospital's key, confirms that reference is paid;
 *        - the amount and currency equal the request EXACTLY. Anything else is refused and FLAGGED on the
 *          request, audited, and shown on the cashier screen for a person to reconcile.
 *   4. The payment posts to the invoice ledger with `capture: "integrated"` (the only path that can
 *      produce it) and the gateway payment id as its reference, then the request is marked paid.
 *
 * IDEMPOTENT. A retried or duplicated notice finds the payment id already on the invoice (or the request
 * already paid) and writes nothing. If the ledger write succeeded and the request update did not, the
 * gateway's retry completes it. A bad signature writes nothing at all, so the public door cannot be used
 * to grow the audit trail. A notice whose request cannot be found is audited once it has verified.
 *
 * NOT BUILT: a refund through the gateway from the cashier screen (the adapters implement refund(); the
 * ledger's refund entry is still recorded by hand), and partial payments (links are created with
 * accept_partial false / a single Checkout line).
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { VersionConflictError } from "./repository.js";
import { makeActor, KIND, TIER, GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { postEvent, reconciliationOf } from "../../wardsynq/wardsynq-invoice.js";
import { applyAdapterResult, CAPTURE } from "../../wardsynq/wardsynq-payment-methods.js";
import { activeConnectors, openConnectorSecrets } from "./connectors.js";
import { GATEWAYS, toMinor } from "./payment-gateways.js";

const REQUEST_TYPE = "_wardsynq_payment_request";
const INVOICE = "Invoice";
const MAX_BODY = 256 * 1024;
const str = (v) => (v == null ? "" : String(v).trim());
const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const auditEvent = (action, actor, scope, outcome) => ({ ts: new Date().toISOString(), actor, connectorId: "wardsynq-payments", action, outcome: outcome || "ok", scope });

async function openService(request, env, ctx, need) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_a_wardsynq_hospital" } };
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, need, ctx.actorDeps);
    return { svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: r.tenant, actor: r.actor, role: r.role, roleSource: r.source }), actorId: r.actor.id, repo: ctx.recordDeps.repository, tenantId: mig.tenantId };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", message: str(e && e.message) } };
  }
}

/** PURE. What the cashier screen sees of a request. */
function requestSummary(q) {
  return { id: q.id, invoiceId: q.invoiceId, provider: q.provider, url: q.status === "open" ? q.url : null, amount: q.amount, currency: q.currency, status: q.status,
    createdAt: q.createdAt, paidAt: q.paidAt || null, paymentId: q.paymentId || null, flag: q.flag || null };
}

// ponytail: newest 1000 requests per hospital, filtered here; an index by invoice when a hospital outgrows it.
const recentRequests = (repo, tenantId) => repo.latestByType(tenantId, REQUEST_TYPE, 1000, { newest: true });

/** ctx: { invoiceId, fetchImpl? }. A link for the invoice's current balance, through this hospital's gateway. */
async function createPaymentLink(request, env, ctx) {
  const o = await openService(request, env, ctx, "record:write");
  if (o.error) return o.error;
  const invoiceId = str(ctx.invoiceId);
  if (!invoiceId) return { ok: false, status: 422, error: "invoice_required" };
  const unread = { ok: false, status: 502, error: "record_read_failed", message: "The invoice or the payment settings could not be read, so no link was made." };
  let inv, conn, existing;
  try { conn = (await activeConnectors(o.repo, o.tenantId, "payment"))[0] || null; } catch { return unread; }
  const gateway = conn && GATEWAYS[conn.provider];
  // Asked before the bill is opened, so a hospital with no gateway does not read (and audit reading) a bill for nothing.
  if (!gateway) return { ok: false, status: 409, error: "no_payment_gateway", message: "This hospital has no online payment gateway set up (Admin > Integrations > Payment gateway). Take the payment at the counter." };
  try {
    inv = await o.svc.get(INVOICE, invoiceId);
    existing = (await recentRequests(o.repo, o.tenantId)) || [];
  } catch { return unread; }
  if (!inv) return { ok: false, status: 404, error: "invoice_not_found" };
  if (inv.void) return { ok: false, status: 409, error: "invoice_void", message: "This bill is cancelled; nothing can be collected against it." };
  const open = existing.find((q) => q && q.invoiceId === invoiceId && q.status === "open");
  if (open) return { ok: false, status: 409, error: "payment_link_open", message: "A payment link for this bill is already open. Use it, or wait for it to be paid.", request: requestSummary(open) };
  const { balance, currency } = reconciliationOf(inv);
  if (!(balance > 0)) return { ok: false, status: 422, error: "nothing_owed", message: "Nothing is owed on this bill." };
  const amountMinor = toMinor(balance, currency);
  if (amountMinor == null) return { ok: false, status: 422, error: "currency_not_supported", message: `Online payment is not available for ${str(currency) || "this currency"}.` };

  const secrets = await openConnectorSecrets(env, conn);
  const id = `pr-${randomHex(8)}`;
  let made;
  try { made = await gateway.createPaymentRequest({ requestId: id, amountMinor, currency: str(currency).toUpperCase(), settings: conn.settings || {}, secrets, fetchImpl: ctx.fetchImpl }); }
  catch (e) { made = { ok: false, detail: `The gateway could not be reached (${str(e && e.message).slice(0, 80)}).` }; }
  if (!made.ok) return { ok: false, status: 502, error: "gateway_refused", message: `No link was made. ${made.detail}` };

  const at = new Date().toISOString();
  const rec = { resourceType: REQUEST_TYPE, id, version: 1, invoiceId, patientId: inv.patientId, provider: conn.provider, providerRef: made.providerRef, url: made.url,
    amount: balance, amountMinor, currency: str(currency).toUpperCase(), status: "open", createdAt: at, createdBy: o.actorId, writtenBy: { id: o.actorId, kind: "human", at } };
  try { await o.repo.append(o.tenantId, [rec], { audit: auditEvent("payment.link.create", o.actorId, { requestId: id, invoiceId, provider: rec.provider, amountMinor, currency: rec.currency }) }); }
  catch { return { ok: false, status: 502, error: "record_write_failed", message: "The gateway made a link but it could not be recorded here. Do not send it; if it is paid, the payment will be flagged for reconciliation." }; }
  return { ok: true, request: requestSummary(rec) };
}

/** ctx: { patientId }. This patient's payment requests, newest first. */
async function listPaymentRequests(request, env, ctx) {
  const o = await openService(request, env, ctx, "record:read");
  if (o.error) return o.error;
  const patientId = str(ctx.patientId);
  if (!patientId) return { ok: false, status: 422, error: "patient_required" };
  let rows;
  try {
    // Reading the invoices first means a caller who may not read this patient's bills learns nothing.
    await o.svc.byPatient(INVOICE, patientId);
    rows = (await recentRequests(o.repo, o.tenantId)) || [];
  } catch (e) { return e instanceof GovernanceError ? { ok: false, status: 403, error: "permission" } : { ok: false, status: 502, error: "record_read_failed", message: "Payment links could not be read." }; }
  return { ok: true, patientId, requests: rows.filter((q) => q && q.patientId === patientId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(requestSummary) };
}

const gatewayActor = () => makeActor({ id: "service:payment-gateway", kind: KIND.SERVICE, tier: TIER.DRAFT, display: "Payment gateway notice", scope: { read: [INVOICE], write: [INVOICE] } });
const BY = "service:payment-gateway";

/**
 * The gateway's notice. ctx: { orgId, migration, recordDeps, headers, fetchImpl?, nowMs? }. request is the
 * raw Request (its body is read here, as text, because the signature is over the exact bytes).
 * Returns { status, body }: 2xx tells the gateway to stop retrying, so only a transient failure is non-2xx.
 */
async function receivePaymentCallback(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !mig.tenantId) return { status: 404, body: { ok: false, error: "not_found" } };
  const repo = ctx.recordDeps.repository, tenantId = mig.tenantId;
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return { status: 400, body: { ok: false, error: "bad_body" } };
  let conn;
  try { conn = (await activeConnectors(repo, tenantId, "payment"))[0] || null; } catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
  const gateway = conn && GATEWAYS[conn.provider];
  if (!gateway) return { status: 404, body: { ok: false, error: "not_found" } };
  const secrets = await openConnectorSecrets(env, conn);
  if (!secrets.webhookSecret) return { status: 503, body: { ok: false, error: "unavailable" } };
  if (!(await gateway.verifyWebhook({ rawBody: raw, headers: request.headers, secrets, nowMs: ctx.nowMs }))) return { status: 401, body: { ok: false, error: "signature" } };

  const ev = gateway.parseWebhook(raw);
  if (!ev) return { status: 400, body: { ok: false, error: "bad_body" } };
  if (ev.kind !== "paid") return { status: 200, body: { ok: true, ignored: true } };
  const audit = (action, scope, outcome) => auditEvent(action, BY, { provider: conn.provider, requestId: ev.requestId || null, providerRef: ev.providerRef, paymentId: ev.paymentId, ...scope }, outcome);

  let req;
  try { req = ev.requestId ? await repo.latest(tenantId, REQUEST_TYPE, ev.requestId) : null; } catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
  if (!req || req.providerRef !== ev.providerRef || req.provider !== conn.provider) {
    try { await repo.auditOnly(tenantId, audit("payment.callback.unmatched", { amountMinor: ev.amountMinor, currency: ev.currency }, "refused")); } catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
    return { status: 200, body: { ok: true, unmatched: true } };
  }
  if (req.status === "paid" && req.paymentId === ev.paymentId) return { status: 200, body: { ok: true, duplicate: true } };
  // Already flagged for a person to reconcile: a retry of the same notice changes nothing and writes nothing.
  if (req.status === "flagged" && req.flag && req.flag.paymentId === ev.paymentId) return { status: 200, body: { ok: true, flagged: req.flag.reason } };

  /* The gateway's own word, asked with this hospital's key. A notice is a claim; this is the check. */
  let st;
  try { st = await gateway.fetchStatus({ providerRef: req.providerRef, settings: conn.settings || {}, secrets, fetchImpl: ctx.fetchImpl }); }
  catch { st = { ok: false }; }
  if (!st.ok) return { status: 503, body: { ok: false, error: "gateway_unconfirmed" } };

  const flagWith = async (reason, got) => {
    const at = new Date().toISOString();
    const next = { ...req, version: req.version + 1, status: "flagged", flag: { reason, at, got, paymentId: ev.paymentId }, writtenBy: { id: BY, kind: "service", at } };
    try { await repo.append(tenantId, [next], { audit: audit("payment.callback.flagged", { reason, expected: { amountMinor: req.amountMinor, currency: req.currency }, got }, "refused") }); }
    catch (e) { return { status: e instanceof VersionConflictError ? 409 : 503, body: { ok: false, error: "unavailable" } }; }
    return { status: 200, body: { ok: true, flagged: reason } };
  };
  const got = { amountMinor: ev.amountMinor, currency: ev.currency };
  if (!st.paid) return flagWith("gateway_says_not_paid", got);
  if (req.status === "paid") return flagWith("second_payment_on_paid_request", got);
  if (ev.amountMinor !== req.amountMinor || ev.currency !== req.currency || st.amountMinor !== req.amountMinor || st.currency !== req.currency) return flagWith("amount_or_currency_mismatch", { ...got, confirmed: { amountMinor: st.amountMinor, currency: st.currency } });
  if (st.paymentIds && st.paymentIds.length && !st.paymentIds.includes(ev.paymentId)) return flagWith("payment_not_on_gateway_record", got);

  const svc = new RecordService({ repository: repo, pseudonym: ctx.recordDeps.pseudonym, tenant: { id: tenantId }, actor: gatewayActor(), role: "payment-gateway", roleSource: "wardsynq-payments" });
  const reference = `${conn.provider}:${ev.paymentId}`;
  const at = new Date().toISOString();
  let inv;
  try { inv = await svc.get(INVOICE, req.invoiceId); } catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
  if (!inv) return flagWith("invoice_missing", got);
  const already = (inv.events || []).some((e) => e && e.kind === "payment" && e.reference === reference);
  if (!already) {
    if (inv.void) return flagWith("invoice_void", got);
    const adapter = { adapterId: conn.provider, adapterName: GATEWAYS[conn.provider].label, state: "acknowledged", payerReference: ev.paymentId,
      note: "Confirmed by the gateway: signed notice verified and payment status read back from the gateway.", attemptedAt: at };
    const collection = applyAdapterResult({ method: "online", provider: conn.provider, amount: req.amount, details: { reference: ev.paymentId }, capture: CAPTURE.MANUAL, settlement: "unknown", settles: "batch" },
      { state: "captured", payerReference: ev.paymentId });
    try {
      postEvent(inv, "payment", { amount: req.amount, actorId: BY, at, reference, adapter, collection });
      await svc.put({ ...inv, resourceType: INVOICE }, { expectedVersion: inv.version });
    } catch (e) {
      // A concurrent cashier action moved the invoice: the gateway retries and this runs again on the new version.
      return { status: e instanceof VersionConflictError ? 409 : 503, body: { ok: false, error: "invoice_not_updated" } };
    }
  }
  const next = { ...req, version: req.version + 1, status: "paid", paidAt: at, paymentId: ev.paymentId, writtenBy: { id: BY, kind: "service", at } };
  try { await repo.append(tenantId, [next], { audit: audit("payment.gateway.paid", { invoiceId: req.invoiceId, amountMinor: req.amountMinor, currency: req.currency, ledgerAlreadyHadIt: already }) }); }
  catch (e) { if (!(e instanceof VersionConflictError)) return { status: 503, body: { ok: false, error: "unavailable" } }; }
  return { status: 200, body: { ok: true, paid: true } };
}

export { REQUEST_TYPE, requestSummary, createPaymentLink, listPaymentRequests, receivePaymentCallback };
