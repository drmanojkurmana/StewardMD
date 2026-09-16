/* functions/_wardsynq/einvoice-irp.js - GST e-invoicing: the connector kind, its adapters, and the IRN request.
 *
 * A hospital above the notified aggregate turnover reports each B2B tax invoice, credit note and debit note to an
 * Invoice Registration Portal (IRP) and prints the IRN and signed QR code it returns. Which IRP, and whether the
 * law applies to this hospital at all, is the hospital's own setting on Admin > Integrations; nothing here decides
 * a hospital's turnover.
 *
 * ADAPTERS. One per way of reaching an IRP, selected by the connector's provider. The first is the NIC IRP direct
 * API (https://einv-apisandbox.nic.in):
 *   auth    POST <base>/eivital/v1.04/auth, headers client_id, client_secret, Gstin; body {"Data": RSA(base64(JSON))}
 *           where JSON is { UserName, Password, AppKey (base64 of a random 32-byte AES key), ForceRefreshAccessToken }
 *           (https://einv-apisandbox.nic.in/version1.04/authentication.html; the JSON is base64-encoded and then
 *           encrypted with the IRP public key, as the NIC Java sample does, https://einv-apisandbox.nic.in/sample-code-in-java.html).
 *           The response's Sek is AES-256 ECB PKCS7 under the AppKey.
 *   IRN     POST <base>/eicore/v1.03/Invoice, headers client_id, client_secret, Gstin, user_name, AuthToken; body
 *           {"Data": AES-ECB(Sek, JSON)}; response Data decrypts to AckNo, AckDt, Irn, SignedInvoice, SignedQRCode,
 *           Status (https://einv-apisandbox.nic.in/version1.03/generate-irn.html).
 *   cancel  POST <base>/eicore/v1.03/Invoice/Cancel, same headers, Data = AES-ECB(Sek, {Irn, CnlRsn, CnlRem}); only
 *           within 24 hours of generation (https://einv-apisandbox.nic.in/version1.03/cancel-irn.html). The eivital
 *           v1.04 / eicore v1.03 paths are as Microsoft's own IRP integration lists them
 *           (https://learn.microsoft.com/en-us/dynamics365/finance/localizations/india/apac-ind-e-invoices).
 *   Ciphers: RSA/ECB/PKCS1Padding and AES/ECB/PKCS5Padding (https://einv-apisandbox.nic.in/FaqsonAPI.html).
 *
 * PORTABLE CRYPTO ONLY. WebCrypto has neither RSA PKCS#1 v1.5 encryption nor AES-ECB, so both are built here from
 * what it does have: the RSA public key is read through WebCrypto's SPKI import and the one modular
 * exponentiation is BigInt; each AES-ECB block is one AES-CBC block with a zero IV (see aesEcb*). Both are checked
 * against node:crypto in test/wardsynq-gst-einvoice.test.mjs.
 *
 * NOTHING IS CLAIMED THAT THE IRP DID NOT SAY. A refusal, a timeout or an unreadable reply records nothing; only a
 * decrypted reply with an Irn is stored.
 */

import { isValidGstin, normalizeGstin, gstSplit, istDateOf } from "../_region_in.js";
import { checkDestination } from "./webhooks.js";

const str = (v) => (v == null ? "" : String(v).trim());
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ---- bytes ------------------------------------------------------------------------------------------ */
const utf8 = (s) => new TextEncoder().encode(s);
const fromUtf8 = (b) => new TextDecoder().decode(b);
function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
const unb64 = (t) => Uint8Array.from(atob(str(t).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/* ---- AES-256-ECB with PKCS#7 padding, from AES-CBC ----------------------------------------------------
 * Encrypt: AES-CBC of one block under a zero IV is exactly AES of that block (WebCrypto appends a padding block,
 * which is dropped). Decrypt: CBC-decrypting C1..Cn under a zero IV gives Pi = AES^-1(Ci) xor C(i-1), so each
 * block is recovered by xoring the previous ciphertext block back in; one extra block, AES(Cn xor 0x10..), is
 * appended so the final CBC padding check sees a full block of 0x10 and strips exactly it. */
const ZERO_IV = new Uint8Array(16);
const cbcKey = (raw) => crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
async function aesBlock(key, block) { return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: ZERO_IV }, key, block)).slice(0, 16); }
async function aesEcbEncrypt(rawKey, bytes) {
  const key = await cbcKey(rawKey);
  const pad = 16 - (bytes.length % 16);
  const p = new Uint8Array(bytes.length + pad);
  p.set(bytes); p.fill(pad, bytes.length);
  const blocks = [];
  for (let i = 0; i < p.length; i += 16) blocks.push(aesBlock(key, p.subarray(i, i + 16)));
  const out = new Uint8Array(p.length);
  (await Promise.all(blocks)).forEach((b, i) => out.set(b, i * 16));
  return out;
}
async function aesEcbDecrypt(rawKey, bytes) {
  if (!bytes.length || bytes.length % 16) throw new Error("ciphertext is not whole AES blocks");
  const key = await cbcKey(rawKey);
  const tail = await aesBlock(key, bytes.subarray(bytes.length - 16).map((b) => b ^ 16));
  const buf = new Uint8Array(bytes.length + 16);
  buf.set(bytes); buf.set(tail, bytes.length);
  const p = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ZERO_IV }, key, buf));
  for (let i = 16; i < p.length; i++) p[i] ^= bytes[i - 16];
  const pad = p[p.length - 1];
  if (pad < 1 || pad > 16 || p.subarray(p.length - pad).some((b) => b !== pad)) throw new Error("bad padding");
  return p.slice(0, p.length - pad);
}

/* ---- RSA encryption with PKCS#1 v1.5 padding (RFC 8017 section 7.2.1) ---------------------------------- */
const bigOf = (bytes) => bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
async function rsaPkcs1Encrypt(publicKeyText, bytes) {
  const der = unb64(str(publicKeyText).replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, ""));
  const key = await crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const nBytes = unb64(jwk.n), n = bigOf(nBytes), e = bigOf(unb64(jwk.e)), k = nBytes.length;
  if (bytes.length > k - 11) throw new Error("message too long for the key");
  const em = new Uint8Array(k);
  em[1] = 2;
  const ps = em.subarray(2, k - bytes.length - 1);
  crypto.getRandomValues(ps);
  for (let i = 0; i < ps.length; i++) while (ps[i] === 0) ps[i] = crypto.getRandomValues(new Uint8Array(1))[0];
  em.set(bytes, k - bytes.length);
  let c = modPow(bigOf(em), e, n);
  const out = new Uint8Array(k);
  for (let i = k - 1; i >= 0; i--) { out[i] = Number(c & 0xffn); c >>= 8n; }
  return out;
}

/* ---- the IRN request (FORM GST INV-01, schema version 1.1) --------------------------------------------- */

/** PURE. DD/MM/YYYY in India time. */
function ddmmyyyy(iso) { const d = istDateOf(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ""; }
/** DocDtls.No: 1-16 characters, not starting with 0, "/" or "-" (generate-irn.html). */
const DOC_NO = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const HSN = /^(\d{4}|\d{6}|\d{8})$/;

/**
 * PURE. The Generate IRN request for an invoice (note = null) or one of its credit/debit note events.
 * seller: the connector's settings. Only TAXED lines are reported: exempt lines belong to a bill of supply, not
 * the e-invoice (https://gstzen.in/einvoicing/e-invoice/exempt-supplies-and-e-invoicing.html). Returns
 * { payload } or { error, detail, codes? }.
 */
function irnRequest(invoice, seller, note) {
  const buyer = invoice.buyer;
  if (!buyer || !str(buyer.gstin)) return { error: "b2c_not_reported", detail: "This bill has no buyer GSTIN, so it is a bill to a person (B2C). B2C bills are not reported for e-invoicing." };
  const docNo = str(note ? note.noteNumber : invoice.documentNumber);
  if (!DOC_NO.test(docNo)) return { error: "no_document_number", detail: "This bill has no invoice number that e-invoicing accepts (raised before invoice numbering). It cannot be reported." };
  const sellerState = str(seller.stateCode);
  const registered = str(invoice.taxRegistration && invoice.taxRegistration.id);
  if (registered && normalizeGstin(registered) !== normalizeGstin(seller.gstin)) return { error: "seller_gstin_mismatch", detail: "The bill was raised under a different GSTIN from the one set for e-invoicing." };
  const inter = sellerState !== str(buyer.pos);
  const source = note ? note.lines || [] : invoice.lines || [];
  const taxed = source.filter((l) => l && l.taxKind === "GST" && l.taxExempt !== true && Number(l.taxRate) > 0);
  if (!taxed.length) return { error: "no_taxable_lines", detail: "Nothing on this document is taxed. Exempt supplies are not reported for e-invoicing." };
  const noHsn = taxed.filter((l) => !HSN.test(str(l.hsnSac))).map((l) => l.code);
  if (noHsn.length) return { error: "hsn_sac_missing", codes: noHsn, detail: "These taxed items have no HSN/SAC on the Price list, so the document cannot be reported." };

  const items = taxed.map((l, i) => {
    const goods = l.kind === "medication";
    const qty = note ? 1 : Number(l.quantity) || 1;
    const ass = round2(note ? l.taxable : l.line);
    const unit = note ? ass : round2(l.amount);
    const sp = gstSplit(l.tax, inter);
    return { SlNo: String(i + 1), PrdDesc: (str(l.display) || str(l.code)).slice(0, 300), IsServc: goods ? "N" : "Y", HsnCd: str(l.hsnSac),
      // ponytail: every medicine is reported in NOS (numbers); a pack-size unit needs a unit on the Price list row.
      ...(goods ? { Qty: qty, Unit: "NOS" } : {}),
      UnitPrice: unit, TotAmt: round2(unit * qty), Discount: 0, AssAmt: ass, GstRt: Number(l.taxRate),
      IgstAmt: sp.igst, CgstAmt: sp.cgst, SgstAmt: sp.sgst, TotItemVal: round2(ass + Number(l.tax)) };
  });
  const sum = (k) => round2(items.reduce((n, it) => n + it[k], 0));
  const raisedAt = str(((invoice.events || [])[0] || {}).at);
  const party = (p) => ({ Gstin: normalizeGstin(p.gstin), LglNm: str(p.legalName), Addr1: str(p.address1), Loc: str(p.location), Pin: Number(p.pincode), Stcd: str(p.stateCode) });
  return { payload: {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: note ? (note.kind === "credit_note" ? "CRN" : "DBN") : "INV", No: docNo, Dt: ddmmyyyy(note ? note.at : raisedAt) },
    SellerDtls: party(seller),
    BuyerDtls: { ...party(buyer), Pos: str(buyer.pos) },
    ItemList: items,
    ValDtls: { AssVal: sum("AssAmt"), CgstVal: sum("CgstAmt"), SgstVal: sum("SgstAmt"), IgstVal: sum("IgstAmt"), TotInvVal: sum("TotItemVal") },
    ...(note ? { RefDtls: { PrecDocDtls: [{ InvNo: str(invoice.documentNumber), InvDt: ddmmyyyy(raisedAt) }] } } : {}),
  } };
}

/* ---- the NIC IRP adapter ------------------------------------------------------------------------------ */
const NIC_PATHS = Object.freeze({ auth: "/eivital/v1.04/auth", generate: "/eicore/v1.03/Invoice", cancel: "/eicore/v1.03/Invoice/Cancel" });

function irpError(j, status) {
  let e = j && j.ErrorDetails;
  if (typeof e === "string") { try { e = JSON.parse(fromUtf8(unb64(e))); } catch { e = [{ ErrorMessage: e }]; } }
  const list = Array.isArray(e) ? e : e ? [e] : [];
  const text = list.map((x) => `${str(x && x.ErrorCode)} ${str(x && x.ErrorMessage)}`.trim()).filter(Boolean).join("; ").slice(0, 300);
  return text || `The e-invoice portal refused the request${status ? ` (HTTP ${status})` : ""}.`;
}
async function post(url, headers, body, ctx) {
  const dest = await checkDestination(url, ctx);
  if (!dest.ok) return { ok: false, reason: "url_refused", detail: dest.detail };
  let res;
  try { res = await (ctx.fetchImpl || fetch)(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); }
  catch (e) { return { ok: false, reason: "unreachable", detail: `The e-invoice portal could not be reached (${str(e && e.message).slice(0, 80)}).` }; }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || String(j.Status) !== "1") return { ok: false, reason: "refused", httpStatus: res.status, detail: irpError(j, res.status) };
  return { ok: true, json: j };
}
const base = (settings) => str(settings.baseUrl).replace(/\/+$/, "");
const clientHeaders = (settings, secrets) => ({ client_id: str(secrets.clientId), client_secret: str(secrets.clientSecret), Gstin: normalizeGstin(settings.gstin) });

async function nicAuthenticate(ctx) {
  const { settings, secrets } = ctx;
  if (!secrets.clientId || !secrets.clientSecret || !secrets.password) return { ok: false, reason: "credentials_missing", detail: "The e-invoice credentials are not all set." };
  const appKey = crypto.getRandomValues(new Uint8Array(32));
  const creds = JSON.stringify({ UserName: str(settings.username), Password: secrets.password, AppKey: b64(appKey), ForceRefreshAccessToken: false });
  let data;
  try { data = b64(await rsaPkcs1Encrypt(settings.publicKey, utf8(b64(utf8(creds))))); }
  catch { return { ok: false, reason: "public_key_unusable", detail: "The IRP public key in the e-invoice settings could not be used." }; }
  const r = await post(base(settings) + NIC_PATHS.auth, clientHeaders(settings, secrets), { Data: data }, ctx);
  if (!r.ok) return r;
  try {
    const d = typeof r.json.Data === "string" ? JSON.parse(r.json.Data) : r.json.Data;
    const sek = await aesEcbDecrypt(appKey, unb64(d.Sek));
    if (!str(d.AuthToken) || sek.length !== 32) throw new Error("incomplete");
    return { ok: true, authToken: str(d.AuthToken), sek, userName: str(d.UserName) || str(settings.username) };
  } catch { return { ok: false, reason: "unreadable", detail: "The e-invoice portal's sign-in reply could not be read." }; }
}
async function nicCall(path, request, ctx) {
  const auth = await nicAuthenticate(ctx);
  if (!auth.ok) return auth;
  const headers = { ...clientHeaders(ctx.settings, ctx.secrets), user_name: auth.userName, AuthToken: auth.authToken };
  const r = await post(base(ctx.settings) + path, headers, { Data: b64(await aesEcbEncrypt(auth.sek, utf8(JSON.stringify(request)))) }, ctx);
  if (!r.ok) return r;
  try { return { ok: true, data: JSON.parse(fromUtf8(await aesEcbDecrypt(auth.sek, unb64(r.json.Data)))) }; }
  catch { return { ok: false, reason: "unreadable", detail: "The e-invoice portal's reply could not be decrypted, so nothing was recorded." }; }
}

// ponytail: signs in for every call; a hospital reporting hundreds a day would keep the 6-hour AuthToken and Sek sealed.
const NIC_IRP = Object.freeze({
  async generateIrn({ payload, settings, secrets, fetchImpl, resolveHost }) {
    const r = await nicCall(NIC_PATHS.generate, payload, { settings, secrets, fetchImpl, resolveHost });
    if (!r.ok) return r;
    const d = r.data || {};
    if (!/^[0-9a-f]{64}$/i.test(str(d.Irn))) return { ok: false, reason: "unreadable", detail: "The e-invoice portal's reply had no IRN, so nothing was recorded." };
    return { ok: true, irn: str(d.Irn), ackNo: d.AckNo == null ? null : String(d.AckNo), ackDt: str(d.AckDt), signedQrCode: str(d.SignedQRCode) || null, status: str(d.Status) || "ACT" };
  },
  async cancelIrn({ irn, reasonCode, remark, settings, secrets, fetchImpl, resolveHost }) {
    const r = await nicCall(NIC_PATHS.cancel, { Irn: irn, CnlRsn: String(reasonCode), CnlRem: str(remark).slice(0, 100) }, { settings, secrets, fetchImpl, resolveHost });
    if (!r.ok) return r;
    if (str(r.data && r.data.Irn) !== irn) return { ok: false, reason: "unreadable", detail: "The e-invoice portal's reply did not confirm this IRN, so nothing was recorded." };
    return { ok: true, cancelDate: str(r.data.CancelDate) };
  },
});
const EINVOICE_ADAPTERS = Object.freeze({ "nic-irp": NIC_IRP });

/** Cancellation reasons, Cancel IRN CnlRsn. */
const CANCEL_REASONS = Object.freeze({ 1: "Duplicate", 2: "Data entry mistake", 3: "Order cancelled", 4: "Others" });

const EINVOICE_KIND = Object.freeze({
  label: "GST e-invoicing", singleton: true,
  help: "Reports B2B tax invoices, credit notes and debit notes to the Invoice Registration Portal and prints the IRN and QR code. Bills to patients (B2C) and exempt supplies are never reported.",
  providers: {
    "nic-irp": {
      label: "NIC Invoice Registration Portal (direct API)",
      help: "Credentials come from the e-invoice portal's API registration. The IRP public key is downloaded from the same portal.",
      settings: [
        { key: "applies", label: "E-invoicing applies to us (aggregate turnover above the notified threshold)", type: "checkbox" },
        { key: "baseUrl", label: "Portal API address (sandbox: https://einv-apisandbox.nic.in)", type: "url", required: true },
        { key: "gstin", label: "Hospital GSTIN", type: "text", required: true },
        { key: "legalName", label: "Legal name (as registered for GST)", type: "text", required: true },
        { key: "address1", label: "Address", type: "text", required: true },
        { key: "location", label: "Place", type: "text", required: true },
        { key: "pincode", label: "PIN code", type: "text", required: true },
        { key: "stateCode", label: "State code (2 digits)", type: "text", required: true },
        { key: "username", label: "E-invoice API user name", type: "text", required: true },
        { key: "publicKey", label: "IRP public key (base64, from the portal)", type: "text", required: true },
      ],
      secrets: [{ key: "clientId", label: "Client id" }, { key: "clientSecret", label: "Client secret" }, { key: "password", label: "E-invoice API password" }],
      validate(settings, present) {
        if (!isValidGstin(settings.gstin)) return "The hospital GSTIN is not valid.";
        if (!/^\d{2}$/.test(str(settings.stateCode)) || normalizeGstin(settings.gstin).slice(0, 2) !== str(settings.stateCode)) return "The state code must be the first two digits of the GSTIN.";
        if (!/^[1-9]\d{5}$/.test(str(settings.pincode))) return "PIN code is 6 digits.";
        if (str(settings.legalName).length < 3 || str(settings.legalName).length > 100) return "Legal name is 3 to 100 characters.";
        if (str(settings.location).length < 3 || str(settings.location).length > 50) return "Place is 3 to 50 characters.";
        if (!/^[A-Za-z0-9+/=\s-]{200,}$/.test(str(settings.publicKey).replace(/-----(BEGIN|END) PUBLIC KEY-----/g, ""))) return "The IRP public key is the base64 text of the key file.";
        const missing = ["clientId", "clientSecret", "password"].filter((k) => !(present && present[k]));
        if (missing.length) return "Client id, client secret and password are all needed.";
        return null;
      },
      /* The connection test signs in and nothing more: no document is sent. */
      async test({ settings, secrets, fetchImpl, resolveHost }) {
        const r = await nicAuthenticate({ settings, secrets, fetchImpl, resolveHost });
        return r.ok ? { ok: true, detail: "Signed in to the e-invoice portal." } : r;
      },
    },
  },
});

export { EINVOICE_KIND, EINVOICE_ADAPTERS, NIC_PATHS, CANCEL_REASONS, irnRequest, ddmmyyyy, aesEcbEncrypt, aesEcbDecrypt, rsaPkcs1Encrypt };
