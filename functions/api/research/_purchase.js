/* ResearchMD Phase 6.1 credit purchase + institution invoicing (ES module).
 * Contract: docs/research/contracts/phase-6/purchase.md. D-4: reuse the MaiK
 * wallet and the EXISTING MaiK purchase/payment route; NO new payment
 * provider. The client never writes balances.
 *
 * Purchase reuse: this module lazily imports functions/api/billing/[[path]].js
 * and forwards the caller's request (Authorization intact) to its onRequest:
 *   web/off-Play -> POST /api/billing/razorpay/order {pack}
 *   native IAP   -> POST /api/billing/iap/verify {platform, productId, token}
 * Fulfilment stays on the existing money path (webhook / store verification ->
 * fulfilPurchase("tokens:<pack>") -> addTokens on the MaiK wallet). Research
 * spend draws from that wallet via the Phase 3 reserve/settle lifecycle.
 *
 * Institution invoicing: adminAuth issues an invoice; marking it paid grants
 * ledger credits exactly once (guarded issued -> paid). Members draw from the
 * pool automatically (Phase 3 pickInstitution). The Phase 3 token-only admin
 * grant route stays; this adds the owner-claim surface + invoice workflow.
 */
import { adminAuth, adminErr } from "./_institutions.js";
import { verifiedClaimsFor } from "../../_fbauth.js";
import { grantInstitutionCredits, institutionBalance, usdInrRate, MT_PER_INR } from "./_credits.js";

const TOKEN_PRODUCT_RE = /^in\.stewardmd\.tokens\.([a-z]+)$/;

async function billingModule() {
  return import("../billing/[[path]].js");
}
/* Forward to the existing billing route; return its Response verbatim. */
async function forwardToBilling(ctx, billingPath, body) {
  const { request, env, requestId, api } = ctx;
  // defence in depth: money routes re-check the sign-in themselves, not only the router
  const claims = await verifiedClaimsFor(request, env);
  if (!claims || !claims.sub) return api.err(401, "unauthorized", "Sign in to buy credits", requestId);
  const mod = await billingModule();
  const headers = { "Content-Type": "application/json" };
  const auth = request.headers.get("authorization");
  if (auth) headers.Authorization = auth;
  const req = new Request("https://stewardmd.in" + billingPath,
    { method: "POST", headers, body: JSON.stringify(body) });
  return mod.onRequest({ request: req, env });
}

/* ---- GET /v1/purchase/packs (read-only server pack table) -------------------- */
export async function purchasePacks(ctx) {
  const { env, requestId, api } = ctx;
  const mod = await billingModule();
  const tokens = mod.plans(env).tokens;
  return api.json({
    packs: tokens, usdInrRate: usdInrRate(env), mtPerInr: MT_PER_INR, currency: "INR",
    note: "Research spend draws from the MaiK wallet. Buy a MaiK Token pack through the existing purchase route; the balance is shared with the rest of StewardMD.",
  }, 200, { "x-request-id": requestId });
}

/* ---- POST /v1/purchase/order {pack} -> billing Razorpay order ---------------- */
export async function purchaseOrder(ctx, body) {
  const { env, requestId, api } = ctx;
  const mod = await billingModule();
  const pack = typeof body.pack === "string" ? body.pack : "";
  if (!pack || !mod.plans(env).tokens[pack])
    return api.err(400, "invalid_body", "pack must be one of the server token packs", requestId);
  return forwardToBilling(ctx, "/api/billing/razorpay/order", { pack });
}

/* ---- POST /v1/purchase/iap-verify -> billing IAP verify (token packs only) --- */
export async function purchaseIapVerify(ctx, body) {
  const { requestId, api } = ctx;
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!TOKEN_PRODUCT_RE.test(productId))
    return api.err(400, "invalid_body", "Research purchases use MaiK Token packs (in.stewardmd.tokens.<pack>) only", requestId);
  const platform = body.platform;
  const purchaseToken = body.purchaseToken || body.receipt;
  if ((platform !== "apple" && platform !== "google") || typeof purchaseToken !== "string" || !purchaseToken)
    return api.err(400, "invalid_body", "platform (apple|google) and purchaseToken are required", requestId);
  return forwardToBilling(ctx, "/api/billing/iap/verify", { platform, productId, purchaseToken });
}

/* ---- institution credits + invoices ------------------------------------------ */
async function requireInstitution(ctx, id) {
  const inst = await ctx.db.prepare("SELECT * FROM research_institutions WHERE id=?").bind(id).first();
  return inst || null;
}
function validAmount(n) { return Number.isInteger(n) && n > 0 && n <= 1e12; }

/* POST /v1/institutions/{id}/credits (adminAuth; reuses grantInstitutionCredits) */
export async function grantCreditsRoute(ctx, id, body) {
  const { db, requestId, api } = ctx;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  if (!(await requireInstitution(ctx, id)))
    return api.err(404, "institution_not_found", "Institution not found", requestId);
  if (!validAmount(body.amountMicroUsd))
    return api.err(400, "invalid_body", "amountMicroUsd must be a positive integer", requestId);
  const out = await grantInstitutionCredits(db, api.uuid, id, body.amountMicroUsd, auth.uid);
  return api.json({ institutionId: id, grantedMicroUsd: body.amountMicroUsd, balanceMicroUsd: out.balanceMicroUsd },
    201, { "x-request-id": requestId });
}

function invoiceOf(row) {
  return { id: row.id, institutionId: row.institution_id, amountMicroUsd: row.amount_micro_usd,
    reference: row.reference || "", note: row.note || "", status: row.status,
    issuedBy: row.issued_by, paidTs: row.paid_ts == null ? null : row.paid_ts, createdTs: row.created_ts };
}
/* POST /v1/institutions/{id}/invoices (adminAuth) */
export async function createInvoice(ctx, id, body) {
  const { db, requestId, api } = ctx;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  if (!(await requireInstitution(ctx, id)))
    return api.err(404, "institution_not_found", "Institution not found", requestId);
  if (!validAmount(body.amountMicroUsd))
    return api.err(400, "invalid_body", "amountMicroUsd must be a positive integer", requestId);
  const reference = body.reference === undefined ? "" : String(body.reference);
  const note = body.note === undefined ? "" : String(body.note);
  if (reference.length > 120 || note.length > 2000)
    return api.err(400, "invalid_body", "reference <= 120 and note <= 2000 characters", requestId);
  const invoiceId = api.uuid("inv_"), now = Date.now();
  await db.prepare("INSERT INTO research_invoices (id,institution_id,amount_micro_usd,reference,note,status,issued_by,created_ts) VALUES (?,?,?,?,?,'issued',?,?)")
    .bind(invoiceId, id, body.amountMicroUsd, reference, note, auth.uid, now).run();
  const row = await db.prepare("SELECT * FROM research_invoices WHERE id=?").bind(invoiceId).first();
  return api.json({ invoice: invoiceOf(row) }, 201, { "x-request-id": requestId });
}
/* GET /v1/institutions/{id}/invoices (adminAuth or institution admin) */
export async function listInvoices(ctx, id) {
  const { db, uid, requestId, api } = ctx;
  if (!(await requireInstitution(ctx, id)))
    return api.err(404, "institution_not_found", "Institution not found", requestId);
  let allowed = false;
  const me = await db.prepare("SELECT role FROM research_institution_members WHERE institution_id=? AND uid=?")
    .bind(id, uid).first();
  if (me && me.role === "admin") allowed = true;
  if (!allowed) {
    const auth = await adminAuth(ctx);
    if (!auth.ok) return api.err(404, "institution_not_found", "Institution not found", requestId);
  }
  const rows = (await db.prepare("SELECT * FROM research_invoices WHERE institution_id=? ORDER BY created_ts DESC LIMIT 100")
    .bind(id).all()).results || [];
  return api.json({ invoices: rows.map(invoiceOf) }, 200, { "x-request-id": requestId });
}
/* POST /v1/invoices/{id}/mark-paid (adminAuth): grant ONCE, guarded transition */
export async function markInvoicePaid(ctx, invoiceId) {
  const { db, requestId, api } = ctx;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  const row = await db.prepare("SELECT * FROM research_invoices WHERE id=?").bind(invoiceId).first();
  if (!row) return api.err(404, "invoice_not_found", "Invoice not found", requestId);
  const now = Date.now();
  const upd = await db.prepare("UPDATE research_invoices SET status='paid',paid_ts=? WHERE id=? AND status='issued'")
    .bind(now, invoiceId).run();
  if (!upd.meta || !upd.meta.changes)
    return api.err(409, "invoice_already_paid", "Invoice is not payable (already paid or void)", requestId);
  const out = await grantInstitutionCredits(db, api.uuid, row.institution_id, row.amount_micro_usd, auth.uid);
  const fresh = await db.prepare("SELECT * FROM research_invoices WHERE id=?").bind(invoiceId).first();
  return api.json({ invoice: invoiceOf(fresh), balanceMicroUsd: out.balanceMicroUsd },
    200, { "x-request-id": requestId });
}
