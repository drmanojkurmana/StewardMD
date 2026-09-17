/* test/wardsynq-connectors-payment.test.mjs - owner S2: any gateway, and a bill marked paid only on the gateway's word.
 *
 * Mocked-fetch contract tests for the Razorpay and Stripe adapters, and the real routes:
 * POST /api/queue/ward/connector-save (kind payment), POST /api/queue/ward/invoice-payment-link,
 * GET /api/queue/ward/payment-requests, POST /api/queue/payment-callback/<orgId>.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-connectors-payment.test.mjs
 */
import { as, seed, H, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, HR, CASHIER, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const { GATEWAYS, toMinor } = await import("../functions/_wardsynq/payment-gateways.js");
const { REQUEST_TYPE } = await import("../functions/_wardsynq/payment-links.js");
const { openInvoice, reconciliationOf } = await import("../wardsynq/wardsynq-invoice.js");

const RZP = GATEWAYS.razorpay, STRIPE = GATEWAYS.stripe;
const hex = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");
const KEY_SECRET = "rzp-key-secret-never-leak-0001", WH = "rzp-webhook-secret-never-leak-01";
const SK = "sk_test_never_leak_000000000001", WHSEC = "whsec_never_leak_00000000000001";

function gw(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [match, status, body] of routes) if (String(url).includes(match) && (!init || !init.method || match.method === undefined)) return new Response(body == null ? null : JSON.stringify(typeof body === "function" ? body(calls.length) : body), { status });
    return new Response(JSON.stringify({ error: { description: "no route" } }), { status: 404 });
  };
  return { calls, fetchImpl };
}

/* ---- adapters: pure and mocked ---------------------------------------------------------------------- */

test("amounts: major units to the integer minor unit, and no currency with an unverified exponent", () => {
  assert.equal(toMinor(150.5, "INR"), 15050);
  assert.equal(toMinor("1000", "usd"), 100000);
  assert.equal(toMinor(10, "JPY"), null, "a zero-decimal currency is refused, not multiplied by 100");
  assert.equal(toMinor(0, "INR"), null);
  assert.equal(toMinor(1.005, "INR"), null, "an amount that is not a whole number of paise is refused");
});

test("contract razorpay: payment link, webhook signature over the raw body, parse, status and refund", async () => {
  const settings = { keyId: "rzp_test_abc" }, secrets = { keySecret: KEY_SECRET, webhookSecret: WH };
  const g = gw([["/payment_links/plink_1", 200, { id: "plink_1", status: "paid", amount_paid: 15050, currency: "INR", payments: [{ payment_id: "pay_9" }] }],
    ["/payment_links/", 200, { id: "plink_1", short_url: "https://rzp.io/i/abc", status: "created" }],
    ["/payments/pay_9/refund", 200, { id: "rfnd_1", status: "processed" }]]);
  const made = await RZP.createPaymentRequest({ requestId: "pr-1", amountMinor: 15050, currency: "INR", settings, secrets, fetchImpl: g.fetchImpl });
  assert.deepEqual(made, { ok: true, providerRef: "plink_1", url: "https://rzp.io/i/abc" });
  assert.equal(g.calls[0].url, "https://api.razorpay.com/v1/payment_links/");
  assert.equal(g.calls[0].init.headers.Authorization, `Basic ${btoa("rzp_test_abc:" + KEY_SECRET)}`);
  const sent = JSON.parse(g.calls[0].init.body);
  assert.equal(sent.amount, 15050); assert.equal(sent.currency, "INR"); assert.equal(sent.reference_id, "pr-1"); assert.equal(sent.accept_partial, false);
  assert.ok(!/customer|name|mrn/i.test(JSON.stringify(sent.notes)) && !sent.customer, "no patient identity goes to the gateway");

  const raw = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1", amount: 15050, amount_paid: 15050, currency: "INR", reference_id: "pr-1", status: "paid" } }, payment: { entity: { id: "pay_9", amount: 15050, currency: "INR", status: "captured" } } } });
  const headers = new Headers({ "X-Razorpay-Signature": hex(WH, raw) });
  assert.equal(await RZP.verifyWebhook({ rawBody: raw, headers, secrets }), true);
  assert.equal(await RZP.verifyWebhook({ rawBody: raw + " ", headers, secrets }), false, "one changed byte fails");
  assert.equal(await RZP.verifyWebhook({ rawBody: raw, headers: new Headers({ "X-Razorpay-Signature": hex(KEY_SECRET, raw) }), secrets }), false, "signed with the key secret instead of the webhook secret fails");
  assert.equal(await RZP.verifyWebhook({ rawBody: raw, headers: new Headers(), secrets }), false);
  assert.deepEqual(RZP.parseWebhook(raw), { kind: "paid", requestId: "pr-1", providerRef: "plink_1", paymentId: "pay_9", amountMinor: 15050, currency: "INR", eventId: "plink_1:pay_9" });
  assert.equal(RZP.parseWebhook(JSON.stringify({ event: "payment_link.expired" })).kind, "other");
  assert.equal(RZP.parseWebhook("not json"), null);

  const st = await RZP.fetchStatus({ providerRef: "plink_1", settings, secrets, fetchImpl: g.fetchImpl });
  assert.deepEqual(st, { ok: true, paid: true, amountMinor: 15050, currency: "INR", paymentIds: ["pay_9"] });
  const rf = await RZP.refund({ paymentId: "pay_9", amountMinor: 5000, settings, secrets, fetchImpl: g.fetchImpl });
  assert.deepEqual(rf, { ok: true, state: "processed", refundRef: "rfnd_1" });
  assert.equal(JSON.parse(g.calls.at(-1).init.body).amount, 5000);
  const bad = await RZP.createPaymentRequest({ requestId: "pr-2", amountMinor: 1, currency: "INR", settings, secrets, fetchImpl: gw([["/payment_links/", 400, { error: { description: "amount too low" } }]]).fetchImpl });
  assert.equal(bad.ok, false); assert.match(bad.detail, /400: amount too low/);
});

test("contract stripe: checkout session, Stripe-Signature v1 with tolerance, parse, status and refund", async () => {
  const settings = { returnUrl: "https://hospital.example/paid" }, secrets = { secretKey: SK, webhookSecret: WHSEC };
  const g = gw([["/checkout/sessions/cs_1", 200, { id: "cs_1", payment_status: "paid", amount_total: 15050, currency: "inr", payment_intent: "pi_9" }],
    ["/checkout/sessions", 200, { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }],
    ["/refunds", 200, { id: "re_1", status: "succeeded" }]]);
  const made = await STRIPE.createPaymentRequest({ requestId: "pr-1", amountMinor: 15050, currency: "INR", settings, secrets, fetchImpl: g.fetchImpl });
  assert.deepEqual(made, { ok: true, providerRef: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
  assert.equal(g.calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(g.calls[0].init.headers.Authorization, `Basic ${btoa(SK + ":")}`);
  const body = new URLSearchParams(g.calls[0].init.body);
  assert.equal(body.get("mode"), "payment");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "15050");
  assert.equal(body.get("line_items[0][price_data][currency]"), "inr");
  assert.equal(body.get("client_reference_id"), "pr-1");
  assert.equal(body.get("success_url"), "https://hospital.example/paid");

  const now = 1_800_000_000_000, t = Math.floor(now / 1000);
  const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", client_reference_id: "pr-1", payment_status: "paid", amount_total: 15050, currency: "inr", payment_intent: "pi_9" } } });
  const sig = (ts, secret) => `t=${ts},v1=${hex(secret, `${ts}.${raw}`)}`;
  assert.equal(await STRIPE.verifyWebhook({ rawBody: raw, headers: new Headers({ "Stripe-Signature": sig(t, WHSEC) }), secrets, nowMs: now }), true);
  assert.equal(await STRIPE.verifyWebhook({ rawBody: raw, headers: new Headers({ "Stripe-Signature": `t=${t},v1=deadbeef,v1=${hex(WHSEC, `${t}.${raw}`)}` }), secrets, nowMs: now }), true, "any one v1 matching is enough (secret rotation)");
  assert.equal(await STRIPE.verifyWebhook({ rawBody: raw, headers: new Headers({ "Stripe-Signature": sig(t - 301, WHSEC) }), secrets, nowMs: now }), false, "older than five minutes is refused");
  assert.equal(await STRIPE.verifyWebhook({ rawBody: raw, headers: new Headers({ "Stripe-Signature": `t=${t},v0=${hex(WHSEC, `${t}.${raw}`)}` }), secrets, nowMs: now }), false, "only v1 counts");
  assert.equal(await STRIPE.verifyWebhook({ rawBody: raw.replace("15050", "15051"), headers: new Headers({ "Stripe-Signature": sig(t, WHSEC) }), secrets, nowMs: now }), false);
  assert.deepEqual(STRIPE.parseWebhook(raw), { kind: "paid", requestId: "pr-1", providerRef: "cs_1", paymentId: "pi_9", amountMinor: 15050, currency: "INR", eventId: "evt_1" });
  assert.equal(STRIPE.parseWebhook(raw.replace('"paid"', '"unpaid"')).kind, "other", "a completed session that is not paid is not a payment");
  assert.equal(STRIPE.parseWebhook(raw.replace("checkout.session.completed", "checkout.session.async_payment_succeeded")).kind, "paid");

  assert.deepEqual(await STRIPE.fetchStatus({ providerRef: "cs_1", secrets, fetchImpl: g.fetchImpl }), { ok: true, paid: true, amountMinor: 15050, currency: "INR", paymentIds: ["pi_9"] });
  assert.deepEqual(await STRIPE.refund({ paymentId: "pi_9", amountMinor: 100, secrets, fetchImpl: g.fetchImpl }), { ok: true, state: "succeeded", refundRef: "re_1" });
  assert.equal(new URLSearchParams(g.calls.at(-1).init.body).get("payment_intent"), "pi_9");
});

/* ---- routes ----------------------------------------------------------------------------------------- */

const RZP_CONN = { kind: "payment", provider: "razorpay", settings: { keyId: "rzp_test_abc" }, secrets: { keySecret: KEY_SECRET, webhookSecret: WH } };
const saveGateway = (who, over) => as(who, "/ward/connector-save", "POST", { orgId: ORG_ID, ...RZP_CONN, ...(over || {}) });
const PATIENT = "opd-pat-pay-001";

async function seedInvoice(id, amount) {
  const inv = openInvoice({ id, patientId: PATIENT, encounterId: "enc-1", currency: "INR", lines: [{ code: "BED", display: "Bed day", quantity: 1, amount, line: amount }], actorId: "cfa:seed", at: "2026-09-14T09:00:00Z" });
  await H.RECORD.append(T, [{ ...inv, resourceType: "Invoice", version: 1, source: { system: "wardsynq-native", sourceId: `invoice:${id}` } }]);
}
const callback = (raw, headers, org) => as(null, `/payment-callback/${org || ORG_ID}`, "POST", raw, headers);
function rzpNotice(requestId, amountPaid, linkId, payId) {
  return JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: linkId || "plink_1", amount: amountPaid, amount_paid: amountPaid, currency: "INR", reference_id: requestId, status: "paid" } }, payment: { entity: { id: payId || "pay_9", amount: amountPaid, currency: "INR", status: "captured" } } } });
}
function gatewayApi(statusBody) {
  return gw([["/payment_links/plink_1", 200, statusBody || { id: "plink_1", status: "paid", amount_paid: 15050, currency: "INR", payments: [{ payment_id: "pay_9" }] }],
    ["/payment_links/", 200, { id: "plink_1", short_url: "https://rzp.io/i/abc", status: "created" }]]);
}

test("negative authorization: gateway settings are admin-only, a link needs billing.charge, and another hospital is refused", async () => {
  seed();
  await seedInvoice("inv-a", 150.5);
  const before = writesNow();
  assert.equal((await saveGateway(null)).__status, 401);
  for (const who of [HR, NURSE, CASHIER, OTHER_ADMIN]) assert.equal((await saveGateway(who)).__status, 403, who);
  assert.equal((await as(null, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-a" })).__status, 401);
  for (const who of [NURSE, HR, OTHER_ADMIN]) assert.equal((await as(who, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-a" })).__status, 403, who);
  assert.equal((await as(NURSE, `/ward/payment-requests?orgId=${ORG_ID}&patientId=${PATIENT}`)).__status, 403);
  assert.equal(writesNow(), before, "nothing written by any refused call");
});

test("no gateway, or the manual default: no link is offered and nothing is written", async () => {
  seed();
  await seedInvoice("inv-m", 100);
  const none = await as(CASHIER, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-m" });
  assert.equal(none.__status, 409); assert.equal(none.error, "no_payment_gateway");
  const manual = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payment", provider: "manual", settings: {} });
  assert.equal(manual.__status, 200, manual.__text);
  const n = writesNow();
  const still = await as(CASHIER, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-m" });
  assert.equal(still.error, "no_payment_gateway");
  assert.equal(writesNow(), n);
  const noWebhook = await saveGateway(ADMIN, { secrets: { keySecret: KEY_SECRET } });
  assert.equal(noWebhook.__status, 422, noWebhook.__text); assert.match(noWebhook.message, /webhook secret/);
});

test("the full Razorpay path: link, signed notice, gateway confirmation, invoice paid once, audited", async () => {
  seed();
  await seedInvoice("inv-1", 150.5);
  const saved = await saveGateway(ADMIN);
  assert.equal(saved.__status, 200, saved.__text);
  assert.ok(!saved.__text.includes(KEY_SECRET) && !saved.__text.includes(WH));

  const api = gatewayApi();
  ENV.WSQ_PAY_FETCH = api.fetchImpl;
  try {
    const link = await as(CASHIER, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-1" });
    assert.equal(link.__status, 200, link.__text);
    assert.equal(link.request.status, "open");
    assert.equal(link.request.url, "https://rzp.io/i/abc");
    assert.equal(JSON.parse(api.calls[0].init.body).amount, 15050, "the balance, in paise");
    const again = await as(CASHIER, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-1" });
    assert.equal(again.__status, 409); assert.equal(again.error, "payment_link_open");
    const reqId = link.request.id;

    const listed = await as(CASHIER, `/ward/payment-requests?orgId=${ORG_ID}&patientId=${PATIENT}`);
    assert.equal(listed.__status, 200, listed.__text);
    assert.deepEqual(listed.requests.map((q) => [q.id, q.status]), [[reqId, "open"]]);

    // The browser's word is not a route: a notice with no signature, or a wrong one, writes nothing.
    const raw = rzpNotice(reqId, 15050);
    const before = writesNow();
    assert.equal((await callback(raw, {})).__status, 401);
    assert.equal((await callback(raw, { "X-Razorpay-Signature": hex("guess", raw) })).__status, 401);
    assert.equal(writesNow(), before);

    const paid = await callback(raw, { "X-Razorpay-Signature": hex(WH, raw) });
    assert.equal(paid.__status, 200, paid.__text);
    assert.equal(paid.paid, true);
    assert.ok(api.calls.some((c) => c.url.endsWith("/payment_links/plink_1") && c.init.method === "GET"), "the gateway's own API confirmed it");
    const inv = await H.RECORD.latest(T, "Invoice", "inv-1");
    const pay = inv.events.filter((e) => e.kind === "payment");
    assert.equal(pay.length, 1);
    assert.equal(pay[0].amount, 150.5);
    assert.equal(pay[0].reference, "razorpay:pay_9");
    assert.equal(pay[0].collection.capture, "integrated", "only a confirmed gateway payment is integrated");
    assert.equal(reconciliationOf(inv).balance, 0);
    assert.equal((await H.RECORD.latest(T, REQUEST_TYPE, reqId)).status, "paid");
    assert.equal(H.RECORD.audit.filter((a) => a.action === "payment.gateway.paid").length, 1);
    assert.ok(!JSON.stringify(H.RECORD.audit).includes(WH) && !JSON.stringify(H.RECORD.audit).includes(KEY_SECRET));

    // The gateway retries: nothing more is written.
    const n = writesNow();
    const dup = await callback(raw, { "X-Razorpay-Signature": hex(WH, raw) });
    assert.equal(dup.__status, 200); assert.equal(dup.duplicate, true);
    assert.equal(writesNow(), n);
  } finally { delete ENV.WSQ_PAY_FETCH; }
});

test("a signed notice for the wrong amount is refused and flagged, the bill untouched, and a retry writes nothing", async () => {
  seed();
  await seedInvoice("inv-2", 150.5);
  await saveGateway(ADMIN);
  ENV.WSQ_PAY_FETCH = gatewayApi({ id: "plink_1", status: "paid", amount_paid: 100, currency: "INR", payments: [{ payment_id: "pay_9" }] }).fetchImpl;
  try {
    const link = await as(CASHIER, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-2" });
    const raw = rzpNotice(link.request.id, 100);
    const r = await callback(raw, { "X-Razorpay-Signature": hex(WH, raw) });
    assert.equal(r.__status, 200, r.__text);
    assert.equal(r.flagged, "amount_or_currency_mismatch");
    const inv = await H.RECORD.latest(T, "Invoice", "inv-2");
    assert.equal(inv.events.filter((e) => e.kind === "payment").length, 0, "not marked paid");
    const q = await H.RECORD.latest(T, REQUEST_TYPE, link.request.id);
    assert.equal(q.status, "flagged");
    assert.deepEqual(q.flag.got, { amountMinor: 100, currency: "INR", confirmed: { amountMinor: 100, currency: "INR" } });
    assert.equal(H.RECORD.audit.filter((a) => a.action === "payment.callback.flagged").length, 1);
    const n = writesNow();
    assert.equal((await callback(raw, { "X-Razorpay-Signature": hex(WH, raw) })).flagged, "amount_or_currency_mismatch");
    assert.equal(writesNow(), n);
    const shown = await as(CASHIER, `/ward/payment-requests?orgId=${ORG_ID}&patientId=${PATIENT}`);
    assert.equal(shown.requests[0].flag.reason, "amount_or_currency_mismatch", "the cashier screen shows it for reconciling");
    assert.equal(shown.requests[0].url, null, "a flagged link is not offered again");
  } finally { delete ENV.WSQ_PAY_FETCH; }
});

test("the gateway does not confirm, cannot be reached, or the request is unknown: nothing is marked paid", async () => {
  seed();
  await seedInvoice("inv-3", 150.5);
  await saveGateway(ADMIN);
  ENV.WSQ_PAY_FETCH = gatewayApi().fetchImpl;
  let link;
  try { link = await as(CASHIER, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-3" }); } finally { delete ENV.WSQ_PAY_FETCH; }
  const raw = rzpNotice(link.request.id, 15050);
  const sig = { "X-Razorpay-Signature": hex(WH, raw) };

  ENV.WSQ_PAY_FETCH = async (url) => { if (String(url).includes("/payment_links/plink_1")) throw new Error("ECONNRESET"); return new Response("{}", { status: 500 }); };
  try {
    const n = writesNow();
    const down = await callback(raw, sig);
    assert.equal(down.__status, 503, "a transient failure asks the gateway to retry");
    assert.equal(writesNow(), n);
  } finally { delete ENV.WSQ_PAY_FETCH; }

  ENV.WSQ_PAY_FETCH = gatewayApi({ id: "plink_1", status: "created", amount_paid: 0, currency: "INR", payments: [] }).fetchImpl;
  try {
    const notPaid = await callback(raw, sig);
    assert.equal(notPaid.flagged, "gateway_says_not_paid");
    assert.equal((await H.RECORD.latest(T, "Invoice", "inv-3")).events.filter((e) => e.kind === "payment").length, 0);

    const ghostRaw = rzpNotice("pr-doesnotexist", 15050, "plink_x", "pay_x");
    const ghost = await callback(ghostRaw, { "X-Razorpay-Signature": hex(WH, ghostRaw) });
    assert.equal(ghost.__status, 200); assert.equal(ghost.unmatched, true);
    assert.equal(H.RECORD.audit.filter((a) => a.action === "payment.callback.unmatched").length, 1);

    const otherOrg = await callback(raw, sig, OTHER);
    assert.equal(otherOrg.__status, 404, "another hospital with no gateway does not accept the notice");
  } finally { delete ENV.WSQ_PAY_FETCH; }
});

test("Stripe through the same door: the signed checkout.session.completed marks the bill paid", async () => {
  seed();
  await seedInvoice("inv-s", 99.99);
  const saved = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payment", provider: "stripe", settings: { returnUrl: "https://93.184.216.34/paid" }, secrets: { secretKey: SK, webhookSecret: WHSEC } });
  assert.equal(saved.__status, 200, saved.__text);
  ENV.WSQ_PAY_FETCH = gw([["/checkout/sessions/cs_1", 200, { id: "cs_1", payment_status: "paid", amount_total: 9999, currency: "inr", payment_intent: "pi_9" }],
    ["/checkout/sessions", 200, { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }]]).fetchImpl;
  try {
    const link = await as(CASHIER, "/ward/invoice-payment-link", "POST", { orgId: ORG_ID, invoiceId: "inv-s" });
    assert.equal(link.__status, 200, link.__text);
    const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", client_reference_id: link.request.id, payment_status: "paid", amount_total: 9999, currency: "inr", payment_intent: "pi_9" } } });
    const t = Math.floor(Date.now() / 1000);
    const r = await callback(raw, { "Stripe-Signature": `t=${t},v1=${hex(WHSEC, `${t}.${raw}`)}` });
    assert.equal(r.__status, 200, r.__text);
    assert.equal(r.paid, true);
    const inv = await H.RECORD.latest(T, "Invoice", "inv-s");
    assert.equal(inv.events.find((e) => e.kind === "payment").reference, "stripe:pi_9");
    assert.equal(reconciliationOf(inv).balance, 0);
  } finally { delete ENV.WSQ_PAY_FETCH; }
});

test("switching gateway: another provider needs its own credentials typed again; back to manual needs none", async () => {
  seed();
  assert.equal((await saveGateway(ADMIN)).__status, 200);
  const n = writesNow();
  const toStripe = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payment", provider: "stripe", settings: { returnUrl: "https://93.184.216.34/paid" } });
  assert.equal(toStripe.__status, 422, "Razorpay's keys are not carried over to Stripe");
  assert.equal(writesNow(), n);
  const toManual = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payment", provider: "manual", settings: {} });
  assert.equal(toManual.__status, 200, toManual.__text);
  assert.deepEqual(toManual.connector.secretsSet, [], "the old gateway's sealed keys are dropped with it");
  const audit = H.RECORD.audit.filter((a) => a.action === "connector.update");
  assert.equal(audit.at(-1).scope.provider, "manual");
});

/* ---- the cashier screen (ward.js), rendered in a sandbox ---------------------------------------------- */

const { readFileSync } = await import("node:fs");
const vm = await import("node:vm");
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

test("cashier screen: a link is offered only while money is owed; open, paid and flagged links read differently; unloaded is not none", () => {
  const inv = { invoiceId: "inv1", status: "open", events: [], lines: [], balance: 150.5, currency: "INR" };
  const owed = cashierHtml({ invoices: [inv], payLinks: [] });
  assert.ok(owed.includes('data-w-act="invpaylink:inv1"'));
  assert.ok(!cashierHtml({ invoices: [{ ...inv, balance: 0, status: "paid" }], payLinks: [] }).includes("invpaylink"), "nothing owed, no link");
  const shown = cashierHtml({ invoices: [inv], payLinks: [
    { id: "pr-1", invoiceId: "inv1", status: "open", url: "https://rzp.io/i/abc", amount: 150.5, currency: "INR", provider: "razorpay" },
    { id: "pr-2", invoiceId: "inv1", status: "flagged", url: null, amount: 150.5, currency: "INR", provider: "razorpay", flag: { reason: "amount_or_currency_mismatch" } }] });
  assert.match(shown, /Payment link sent, not paid yet/);
  assert.ok(shown.includes('href="https://rzp.io/i/abc"'));
  assert.match(shown, /needs reconciling.*different amount or currency, so the bill was not marked paid/);
  assert.match(cashierHtml({ invoices: [inv], payLinks: false }), /could not be loaded. Do not read this as none sent/);
  assert.match(cashierHtml({ invoices: [inv], payLinks: null }), /Loading payment links/);
});
