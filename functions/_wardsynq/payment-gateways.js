/* functions/_wardsynq/payment-gateways.js - owner S2: any hospital, any payment gateway.
 *
 * THE CONTRACT every gateway adapter implements, and nothing else reaches a gateway:
 *   createPaymentRequest({ requestId, amountMinor, currency, settings, secrets, fetchImpl }) -> { ok, providerRef, url } | { ok:false, detail }
 *   verifyWebhook({ rawBody, headers, secrets, nowMs })  -> boolean   (the gateway's signature over the RAW body)
 *   parseWebhook(rawBody)                                -> { kind: "paid", requestId, providerRef, paymentId, amountMinor, currency, eventId } | { kind: "other", type } | null
 *   fetchStatus({ providerRef, settings, secrets, fetchImpl }) -> { ok, paid, amountMinor, currency, paymentId } | { ok:false, detail }
 *   refund({ paymentId, amountMinor, settings, secrets, fetchImpl }) -> { ok, state, refundRef } | { ok:false, detail }
 *
 * "manual" is the default and the no-gateway answer: the money is taken at the counter and recorded by a
 * person, exactly as before this file existed. It has no link, no callback and no refund.
 *
 * AMOUNTS. Both gateways take the smallest currency unit as an integer (Razorpay: "amount in currency
 * subunits", e.g. 1000 = INR 10.00; Stripe: "a non-negative integer in the smallest currency unit"). An
 * invoice holds major units to two decimals, so only currencies whose minor unit is one hundredth are
 * accepted (MINOR_100). Another currency is refused, not converted with a guessed exponent.
 *
 * VERIFIED against the official documentation on 2026-09-14 (WebFetch):
 *   Razorpay: POST https://api.razorpay.com/v1/payment_links/ (Basic key_id:key_secret; amount, currency,
 *     reference_id max 40, accept_partial; response id, short_url, status); GET /v1/payment_links/:id;
 *     POST /v1/payments/:id/refund (amount in subunits; status pending|processed|failed); webhook header
 *     X-Razorpay-Signature = hex HMAC-SHA256 of the RAW body with the WEBHOOK secret; event
 *     payment_link.paid with payload.payment_link.entity {id, amount_paid, currency, reference_id, status}
 *     and payload.payment.entity {id, amount, currency, status}.
 *   Stripe: POST https://api.stripe.com/v1/checkout/sessions (form-encoded; mode=payment,
 *     line_items[0][price_data][currency|unit_amount|product_data][name], quantity, client_reference_id,
 *     success_url; response id, url, amount_total, currency, payment_status, payment_intent);
 *     GET /v1/checkout/sessions/:id; POST /v1/refunds (payment_intent, amount); Stripe-Signature header
 *     "t=<ts>,v1=<sig>[,v1=...]", signed_payload = t + "." + raw body, HMAC-SHA256 with the endpoint's
 *     whsec_ secret, only v1 counted, constant-time compare, 5 minute tolerance; events
 *     checkout.session.completed and checkout.session.async_payment_succeeded (a completed session is paid
 *     only when payment_status is "paid").
 * NOT verified against either live API: tested with a mocked transport only.
 */

import { hmacHex } from "./webhooks.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TIMEOUT_MS = 10000;
const STRIPE_TOLERANCE_S = 300;
/** ISO 4217 currencies whose minor unit is 1/100 that a hospital here is likely to bill in. */
const MINOR_100 = Object.freeze(["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"]);

/** PURE. Major units (two decimals) to the integer minor unit, or null when that cannot be exact. */
function toMinor(amount, currency) {
  if (!MINOR_100.includes(str(currency).toUpperCase())) return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const minor = Math.round(n * 100);
  return Math.abs(minor - n * 100) < 1e-6 ? minor : null;
}

function sameText(a, b) {
  const x = str(a), y = str(b);
  if (!x || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
const header = (headers, name) => str(headers && (typeof headers.get === "function" ? headers.get(name) : headers[name] || headers[name.toLowerCase()]));

/** One call with a timeout and no redirect. Returns { status, body } or throws. */
async function call(fetchImpl, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await (fetchImpl || fetch)(url, { ...init, redirect: "manual", signal: controller.signal });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: Number(res.status) || 0, body };
  } finally { clearTimeout(timer); }
}
/** The gateway's own error sentence, trimmed, never the credential (the request carries it, the answer does not). */
const why = (r) => str((r.body && r.body.error && (r.body.error.description || r.body.error.message)) || "").slice(0, 200);
const failed = (label, r) => ({ ok: false, detail: `${label} answered ${r.status}${why(r) ? ": " + why(r) : ""}.` });

/* ---- Razorpay (Payment Links) ----------------------------------------------------------------------- */

const RZP = "https://api.razorpay.com/v1";
const rzpAuth = (settings, secrets) => ({ Authorization: `Basic ${btoa(`${str(settings.keyId)}:${str(secrets.keySecret)}`)}` });

const razorpay = {
  label: "Razorpay (Payment Links)",
  help: "In the Razorpay Dashboard, add a webhook to the callback address shown after saving, for the event payment_link.paid, with the webhook secret you enter here.",
  settings: [{ key: "keyId", label: "Key ID", type: "text", required: true }],
  secrets: [{ key: "keySecret", label: "Key secret", required: true }, { key: "webhookSecret", label: "Webhook secret", required: true }],
  validate: (s, present) => (!(present.keySecret && present.webhookSecret) ? "Razorpay needs the key secret and the webhook secret." : null),

  async createPaymentRequest({ requestId, amountMinor, currency, settings, secrets, fetchImpl }) {
    const r = await call(fetchImpl, `${RZP}/payment_links/`, { method: "POST", headers: { "Content-Type": "application/json", ...rzpAuth(settings, secrets) },
      body: JSON.stringify({ amount: amountMinor, currency, accept_partial: false, reference_id: requestId, description: "Hospital bill payment", notes: { wardsynq_request: requestId } }) });
    if (r.status < 200 || r.status >= 300 || !r.body || !str(r.body.id) || !/^https:\/\//.test(str(r.body.short_url))) return failed("Razorpay", r);
    return { ok: true, providerRef: str(r.body.id), url: str(r.body.short_url) };
  },

  async verifyWebhook({ rawBody, headers, secrets }) {
    const sig = header(headers, "x-razorpay-signature");
    if (!sig || !str(secrets.webhookSecret)) return false;
    return sameText(await hmacHex(str(secrets.webhookSecret), rawBody), sig.toLowerCase());
  },

  parseWebhook(rawBody) {
    let e; try { e = JSON.parse(rawBody); } catch { return null; }
    if (!e || typeof e !== "object") return null;
    if (e.event !== "payment_link.paid") return { kind: "other", type: str(e.event) };
    const pl = e.payload && e.payload.payment_link && e.payload.payment_link.entity;
    const pay = e.payload && e.payload.payment && e.payload.payment.entity;
    if (!pl || !pay || pl.status !== "paid") return { kind: "other", type: "payment_link.paid (not paid)" };
    return { kind: "paid", requestId: str(pl.reference_id), providerRef: str(pl.id), paymentId: str(pay.id), amountMinor: Number(pl.amount_paid), currency: str(pl.currency).toUpperCase(), eventId: `${str(pl.id)}:${str(pay.id)}` };
  },

  async fetchStatus({ providerRef, settings, secrets, fetchImpl }) {
    const r = await call(fetchImpl, `${RZP}/payment_links/${encodeURIComponent(providerRef)}`, { method: "GET", headers: rzpAuth(settings, secrets) });
    if (r.status !== 200 || !r.body) return failed("Razorpay", r);
    const payments = Array.isArray(r.body.payments) ? r.body.payments : [];
    return { ok: true, paid: r.body.status === "paid", amountMinor: Number(r.body.amount_paid), currency: str(r.body.currency).toUpperCase(), paymentIds: payments.map((p) => str(p && p.payment_id)).filter(Boolean) };
  },

  async refund({ paymentId, amountMinor, settings, secrets, fetchImpl }) {
    const r = await call(fetchImpl, `${RZP}/payments/${encodeURIComponent(paymentId)}/refund`, { method: "POST", headers: { "Content-Type": "application/json", ...rzpAuth(settings, secrets) }, body: JSON.stringify({ amount: amountMinor }) });
    if (r.status < 200 || r.status >= 300 || !r.body || !str(r.body.id)) return failed("Razorpay", r);
    return { ok: true, state: str(r.body.status) || "pending", refundRef: str(r.body.id) };
  },
};

/* ---- Stripe (Checkout Sessions) --------------------------------------------------------------------- */

const STRIPE = "https://api.stripe.com/v1";
const stripeAuth = (secrets) => ({ Authorization: `Basic ${btoa(`${str(secrets.secretKey)}:`)}` });
const form = (pairs) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

const stripe = {
  label: "Stripe (Checkout)",
  help: "In the Stripe Dashboard, add a webhook endpoint at the callback address shown after saving, for checkout.session.completed and checkout.session.async_payment_succeeded, and enter its whsec_ signing secret here.",
  settings: [{ key: "returnUrl", label: "Page the patient returns to after paying", type: "url", required: true }],
  secrets: [{ key: "secretKey", label: "Secret key", required: true }, { key: "webhookSecret", label: "Webhook signing secret (whsec_...)", required: true }],
  validate: (s, present) => (!(present.secretKey && present.webhookSecret) ? "Stripe needs the secret key and the webhook signing secret." : null),

  async createPaymentRequest({ requestId, amountMinor, currency, settings, secrets, fetchImpl }) {
    const r = await call(fetchImpl, `${STRIPE}/checkout/sessions`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...stripeAuth(secrets) },
      body: form([["mode", "payment"], ["success_url", str(settings.returnUrl)], ["client_reference_id", requestId], ["metadata[wardsynq_request]", requestId],
        ["line_items[0][price_data][currency]", str(currency).toLowerCase()], ["line_items[0][price_data][unit_amount]", String(amountMinor)],
        ["line_items[0][price_data][product_data][name]", "Hospital bill payment"], ["line_items[0][quantity]", "1"]]) });
    if (r.status !== 200 || !r.body || !str(r.body.id) || !/^https:\/\//.test(str(r.body.url))) return failed("Stripe", r);
    return { ok: true, providerRef: str(r.body.id), url: str(r.body.url) };
  },

  async verifyWebhook({ rawBody, headers, secrets, nowMs }) {
    const parts = header(headers, "stripe-signature").split(",").map((p) => p.split("="));
    const t = (parts.find((p) => p[0] === "t") || [])[1];
    const v1 = parts.filter((p) => p[0] === "v1" && p[1]).map((p) => p[1]);
    if (!t || !/^\d+$/.test(t) || !v1.length || !str(secrets.webhookSecret)) return false;
    if (Math.abs((nowMs || Date.now()) / 1000 - Number(t)) > STRIPE_TOLERANCE_S) return false;
    const want = await hmacHex(str(secrets.webhookSecret), `${t}.${rawBody}`);
    return v1.some((s) => sameText(want, s));
  },

  parseWebhook(rawBody) {
    let e; try { e = JSON.parse(rawBody); } catch { return null; }
    if (!e || typeof e !== "object") return null;
    if (e.type !== "checkout.session.completed" && e.type !== "checkout.session.async_payment_succeeded") return { kind: "other", type: str(e.type) };
    const s = e.data && e.data.object;
    if (!s || s.payment_status !== "paid") return { kind: "other", type: `${str(e.type)} (not paid)` };
    return { kind: "paid", requestId: str(s.client_reference_id), providerRef: str(s.id), paymentId: str(s.payment_intent), amountMinor: Number(s.amount_total), currency: str(s.currency).toUpperCase(), eventId: str(e.id) };
  },

  async fetchStatus({ providerRef, secrets, fetchImpl }) {
    const r = await call(fetchImpl, `${STRIPE}/checkout/sessions/${encodeURIComponent(providerRef)}`, { method: "GET", headers: stripeAuth(secrets) });
    if (r.status !== 200 || !r.body) return failed("Stripe", r);
    return { ok: true, paid: r.body.payment_status === "paid", amountMinor: Number(r.body.amount_total), currency: str(r.body.currency).toUpperCase(), paymentIds: str(r.body.payment_intent) ? [str(r.body.payment_intent)] : [] };
  },

  async refund({ paymentId, amountMinor, secrets, fetchImpl }) {
    const r = await call(fetchImpl, `${STRIPE}/refunds`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...stripeAuth(secrets) }, body: form([["payment_intent", paymentId], ["amount", String(amountMinor)]]) });
    if (r.status !== 200 || !r.body || !str(r.body.id)) return failed("Stripe", r);
    return { ok: true, state: str(r.body.status) || "pending", refundRef: str(r.body.id) };
  },
};

/* ---- manual ------------------------------------------------------------------------------------------ */

const manual = {
  label: "Manual / offline (counter only, no gateway)",
  help: "Payments are taken at the counter and recorded by the cashier. No payment link is offered.",
  settings: [], secrets: [],
};

const PAYMENT_KIND = Object.freeze({
  label: "Payment gateway", singleton: true,
  help: "How patients can pay a bill online. An invoice is marked paid only when the gateway's signed notice arrives and the gateway itself confirms the payment, for exactly the amount and currency asked.",
  providers: { manual, razorpay, stripe },
});
const GATEWAYS = Object.freeze({ razorpay, stripe });

export { PAYMENT_KIND, GATEWAYS, MINOR_100, toMinor };
