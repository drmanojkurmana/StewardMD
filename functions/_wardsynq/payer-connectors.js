/* functions/_wardsynq/payer-connectors.js - owner S4: a hospital's payers, insurers and TPAs, as connectors.
 *
 * The payer registry (wardsynq/wardsynq-tpa-adapter.js adapterForPayer) was already pluggable by adapter
 * KIND; what it lacked was a place for a hospital to put a payer's endpoint and credential that is not a
 * hand-edited org document. Each payer is now a connector (connectors.js, Admin > Integrations > Payers)
 * with a reference (the payerId a claim carries), its adapter, endpoint and rules, and its credential
 * sealed. payersFromConnectors() turns them into the registry's own payer shape, so billing.js resolves
 * adapters exactly as before; a connector wins over a wardsynq.payers entry with the same id, and the
 * org list keeps working for a hospital that has not moved.
 *
 * Adapters: "fhir-claim" (the existing generic FHIR R4 Claim adapter), "nhcx" (the HCX protocol: JWE to the
 * payer's certificate, answers through the verified callback in nhcx.js; see wardsynq-nhcx-adapter.js), "manual" (the hospital's own portal, email
 * or paper process: queued, never sent). The credential is opened at send time only, for that payer.
 *
 * gst-parties (2026-09-17): every payer, whatever its adapter, also carries its CONTRACT (payer-contracts.js): its
 * kind, legal name and GSTIN, the insurer a TPA acts for, and who the contract makes the GST recipient, with the basis.
 */

import { importEncryptionKey, importVerifyKey, importDecryptionKey, generateToken } from "../../wardsynq/wardsynq-nhcx-adapter.js";
import { makeSafeFetch } from "../_connect/onboard/net.js";
import { CONTRACT_FIELDS, contractOf, contractProblem, resolveParties, partiesRecord } from "./payer-contracts.js";

const str = (v) => (v == null ? "" : String(v).trim());
const REF = { key: "ref", label: "Payer reference (used on claims)", type: "text", required: true };
const RULES = [
  { key: "preauthRequiredAbove", label: "Pre-authorisation required above (amount)", type: "text" },
  { key: "timelyFilingDays", label: "Timely filing (days from discharge)", type: "text" },
  /* rcm-claims-ops: the claim checklist (claims-ops.js scrubClaim). No default: a payer with none of these set has no
   * checklist beyond its pre-authorisation amount. */
  { key: "queryResponseDays", label: "Days this payer gives to answer a query", type: "text" },
  { key: "claimDocuments", label: "Documents required with a claim, separated by semicolons", type: "text", list: true },
  { key: "requireSignedDischargeSummary", label: "A signed discharge summary is required", type: "select", options: [["", "Not required"], ["yes", "Required"]] },
  { key: "requireIcd10Codes", label: "Diagnoses must be ICD-10 codes from the loaded code set", type: "select", options: [["", "Not required"], ["yes", "Required"]] },
];
const NUMBER_RULES = ["preauthRequiredAbove", "timelyFilingDays", "queryResponseDays"];

/* Sealed like every connector credential. The certificates are public, but they are long and they decide
 * who can read what is sent, so they travel the same shown-once, never-returned path. */
const NHCX_SECRETS = Object.freeze([
  { key: "secret", label: "NHCX participant secret" },
  { key: "encryptionCert", label: "The payer's encryption certificate (PEM)" },
  { key: "signingCert", label: "The NHCX gateway's signing certificate (PEM), to check callbacks" },
  { key: "privateKey", label: "This hospital's encryption private key (PKCS8 PEM), to read callbacks" },
]);

function numbersValid(settings) {
  for (const f of RULES) if (NUMBER_RULES.includes(f.key) && settings[f.key] != null && settings[f.key] !== "" && !(Number(settings[f.key]) >= 0)) return `${f.label} must be a number.`;
  return contractProblem(settings, settings.ref);
}

const PAYER_KIND = Object.freeze({
  label: "Payers: insurers, TPAs, government schemes and corporates", singleton: false,
  help: "Each payer your hospital claims from, with its contract. A claim names the payer by its reference. Payer rules never block care. The claim checklist (documents, pre-authorisation, signed discharge summary, ICD-10 codes) stops a claim being sent until it is complete or a person records why it is sent anyway. The GST recipient is decided on each contract: choosing the contracting party needs your chartered accountant's basis.",
  providers: {
    "fhir-claim": {
      label: "FHIR R4 Claim endpoint",
      help: "Posts a FHIR Claim and reads the ClaimResponse. Nothing is sent without https and, unless authentication is None, a credential.",
      settings: [REF,
        { key: "endpoint", label: "Claim endpoint URL", type: "url", required: true },
        { key: "currency", label: "Currency (ISO code, e.g. INR)", type: "text" },
        { key: "providerName", label: "Hospital name as the payer knows it", type: "text" },
        { key: "authType", label: "Authentication", type: "select", required: true, options: [["bearer", "Bearer token"], ["header", "Named header"], ["none", "None"]] },
        { key: "headerName", label: "Header name (for a named header)", type: "text" },
        ...RULES, ...CONTRACT_FIELDS],
      secrets: [{ key: "token", label: "Token or API key" }],
      validate(settings, present) {
        const auth = str(settings.authType);
        if (auth !== "none" && !(present && present.token)) return "This payer's authentication needs the token.";
        if (auth === "header" && !/^[A-Za-z0-9-]{1,60}$/.test(str(settings.headerName))) return "A named header needs its name (letters, digits and dashes).";
        if (settings.currency && !/^[A-Z]{3}$/.test(str(settings.currency))) return "Currency is a three-letter ISO code such as INR.";
        return numbersValid(settings);
      },
    },
    nhcx: {
      label: "NHCX (National Health Claims Exchange)",
      help: "Sends eligibility checks, pre-authorisations and claims to this payer through the NHCX gateway, encrypted to the payer's certificate. A request the gateway accepts is shown as sent; only the payer's own signed and encrypted answer, arriving at the callback address, marks it acknowledged, approved or refused. Register the callback address shown after saving as this hospital's endpoint URL in the NHCX participant registry.",
      settings: [REF,
        { key: "gatewayUrl", label: "NHCX gateway base URL (including the API version path)", type: "url", required: true },
        { key: "senderCode", label: "This hospital's participant code", type: "text", required: true },
        { key: "recipientCode", label: "The payer's participant code", type: "text", required: true },
        { key: "username", label: "NHCX user name (for the access token)", type: "text", required: true },
        { key: "providerName", label: "Hospital name as the payer knows it", type: "text", required: true },
        ...RULES, ...CONTRACT_FIELDS],
      secrets: NHCX_SECRETS,
      validate(settings, present) {
        const need = NHCX_SECRETS.filter((f) => !(present && present[f.key])).map((f) => f.label);
        if (need.length) return `NHCX needs: ${need.join("; ")}.`;
        return numbersValid(settings);
      },
      /* The one safe call the protocol offers: an access token. The certificates and the key are parsed first. */
      async test({ settings, secrets, fetchImpl }) {
        for (const [k, load] of [["encryptionCert", importEncryptionKey], ["signingCert", importVerifyKey], ["privateKey", importDecryptionKey]]) {
          try { await load(secrets[k]); } catch { return { ok: false, reason: "bad_" + k, detail: `${NHCX_SECRETS.find((f) => f.key === k).label} could not be read. Paste the whole PEM, including the BEGIN and END lines.` }; }
        }
        const t = await generateToken({ gatewayUrl: settings.gatewayUrl, username: settings.username, participantCode: settings.senderCode, secret: secrets.secret, fetchImpl: makeSafeFetch(fetchImpl || fetch) });
        return t.ok ? { ok: true, detail: "The certificates and key read correctly and the NHCX gateway issued an access token. Nothing was sent to the payer." }
          : { ok: false, reason: "token", httpStatus: t.httpStatus || null, detail: t.detail.replace(" Nothing was sent.", "") };
      },
    },
    manual: {
      label: "Manual (portal, email or paper)",
      settings: [REF, ...RULES, ...CONTRACT_FIELDS],
      secrets: [],
      validate: (settings) => numbersValid(settings),
    },
  },
});

/** PURE. Active payer connectors in the registry's payer shape. The credential stays sealed. */
function payersFromConnectors(records) {
  return (records || []).filter((r) => r && r.kind === "payer" && r.active === true && str(r.settings && r.settings.ref)).map((r) => {
    const s = r.settings || {};
    const authType = r.provider === "fhir-claim" ? str(s.authType) || "bearer" : r.provider === "nhcx" ? "nhcx" : "none";
    const rules = {};
    for (const f of RULES) if (str(s[f.key])) rules[f.key] = NUMBER_RULES.includes(f.key) ? Number(s[f.key]) : f.list ? str(s[f.key]).split(";").map(str).filter(Boolean) : str(s[f.key]);
    return {
      id: str(s.ref), name: str(r.name) || str(s.ref), adapter: r.provider,
      endpoint: str(s.endpoint || s.gatewayUrl) || null, currency: str(s.currency) || undefined, providerName: str(s.providerName) || undefined,
      senderCode: str(s.senderCode) || undefined, recipientCode: str(s.recipientCode) || undefined,
      auth: authType === "none" ? "none" : { type: authType, headerName: str(s.headerName) || undefined, connectorSecret: (r.secretsEnc && r.secretsEnc.token) || null },
      // NHCX opens several sealed values at send time (nhcx.js); the seals stay server-side, like the token above.
      ...(r.provider === "nhcx" ? { connectorId: r.id, username: str(s.username) || undefined, connectorSecrets: r.secretsEnc || {} } : {}),
      rules, contract: contractOf(s), source: "connector",
    };
  });
}

/** PURE. The parties a payer connector's contract resolves to, active or not, against every payer connector. */
function connectorParties(rec, records, gst) {
  const all = payersFromConnectors((records || []).map((r) => (r && r.kind === "payer" ? { ...r, active: true } : r)));
  return partiesRecord(resolveParties({ payerRef: str(rec && rec.settings && rec.settings.ref), payers: all, gst }), null);
}

/** PURE. Connector payers first; an org-document payer with the same id is shadowed, never merged. */
function mergePayers(fromConnectors, fromOrg) {
  const ids = new Set(fromConnectors.map((p) => p.id));
  // An org-document payer's contract, if it has one, is read from the same keys as a connector's settings.
  return [...fromConnectors, ...(Array.isArray(fromOrg) ? fromOrg : []).filter((p) => p && !ids.has(str(p.id))).map((p) => ({ ...p, contract: contractOf(p) }))];
}

export { PAYER_KIND, NHCX_SECRETS, payersFromConnectors, mergePayers, connectorParties };
