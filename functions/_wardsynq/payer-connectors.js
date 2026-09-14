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
 * Adapters: "fhir-claim" (the existing generic FHIR R4 Claim adapter), "nhcx" (a shape only, see
 * wardsynq-nhcx-adapter.js for what is and is not verified), "manual" (the hospital's own portal, email
 * or paper process: queued, never sent). The credential is opened at send time only, for that payer.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const REF = { key: "ref", label: "Payer reference (used on claims)", type: "text", required: true };
const RULES = [
  { key: "preauthRequiredAbove", label: "Pre-authorisation required above (amount)", type: "text" },
  { key: "timelyFilingDays", label: "Timely filing (days from discharge)", type: "text" },
];

function numbersValid(settings) {
  for (const f of RULES) if (settings[f.key] != null && settings[f.key] !== "" && !(Number(settings[f.key]) >= 0)) return `${f.label} must be a number.`;
  return null;
}

const PAYER_KIND = Object.freeze({
  label: "Insurance payers and TPAs", singleton: false,
  help: "Each payer your hospital claims from. A claim names the payer by its reference. Payer rules are warnings only; they never block care or change a claim.",
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
        ...RULES],
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
      label: "NHCX (National Health Claims Exchange), not yet able to send",
      help: "Prepares the HCX envelope only. Nothing is sent until encryption, profiles and participant onboarding are built; claims record why.",
      settings: [REF,
        { key: "gatewayUrl", label: "NHCX gateway base URL", type: "url", required: true },
        { key: "senderCode", label: "This hospital's participant code", type: "text", required: true },
        { key: "recipientCode", label: "The payer's participant code", type: "text", required: true },
        ...RULES],
      secrets: [{ key: "token", label: "Gateway bearer token" }],
      validate: (settings) => numbersValid(settings),
    },
    manual: {
      label: "Manual (portal, email or paper)",
      settings: [REF, ...RULES],
      secrets: [],
      validate: (settings) => numbersValid(settings),
    },
  },
});

/** PURE. Active payer connectors in the registry's payer shape. The credential stays sealed. */
function payersFromConnectors(records) {
  return (records || []).filter((r) => r && r.kind === "payer" && r.active === true && str(r.settings && r.settings.ref)).map((r) => {
    const s = r.settings || {};
    const authType = r.provider === "fhir-claim" ? str(s.authType) || "bearer" : r.provider === "nhcx" ? "bearer" : "none";
    const rules = {};
    for (const f of RULES) if (str(s[f.key])) rules[f.key] = Number(s[f.key]);
    return {
      id: str(s.ref), name: str(r.name) || str(s.ref), adapter: r.provider,
      endpoint: str(s.endpoint || s.gatewayUrl) || null, currency: str(s.currency) || undefined, providerName: str(s.providerName) || undefined,
      senderCode: str(s.senderCode) || undefined, recipientCode: str(s.recipientCode) || undefined,
      auth: authType === "none" ? "none" : { type: authType, headerName: str(s.headerName) || undefined, connectorSecret: (r.secretsEnc && r.secretsEnc.token) || null },
      rules, source: "connector",
    };
  });
}

/** PURE. Connector payers first; an org-document payer with the same id is shadowed, never merged. */
function mergePayers(fromConnectors, fromOrg) {
  const ids = new Set(fromConnectors.map((p) => p.id));
  return [...fromConnectors, ...(Array.isArray(fromOrg) ? fromOrg : []).filter((p) => p && !ids.has(str(p.id)))];
}

export { PAYER_KIND, payersFromConnectors, mergePayers };
