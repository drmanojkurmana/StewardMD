/* wardsynq/wardsynq-fhir-claim-adapter.js - P1.5: a generic FHIR R4 Claim adapter.
 *
 * It fits exchanges that take a FHIR Claim and answer with a ClaimResponse (NHCX-style gateways, most
 * FHIR-native payers). It is GENERIC on purpose: no payer's name, profile URL or quirk is in this file.
 * A payer that needs a specific profile or bundle wrapping is a new adapter kind beside this one, not a
 * branch inside it, and the core claim model (wardsynq-billing.js) never learns about either.
 *
 * WHAT IT CLAIMS, AND NOTHING MORE:
 *   - not_configured : no https endpoint, or the payer requires credentials and none resolved.
 *                      Nothing was sent. "credentials missing" is said in so many words.
 *   - sent           : a 2xx with no readable ClaimResponse. Delivered, not acknowledged.
 *   - acknowledged   : a ClaimResponse came back (outcome queued, complete or partial). Its
 *                      adjudication amounts are carried as the PAYER's figures, never recomputed.
 *   - failed         : non-2xx, ClaimResponse outcome "error", or no response at all. A network
 *                      failure is recorded as failed WITH a note that delivery is unknown, because a
 *                      blind resubmission could duplicate a claim.
 *
 * NOT VERIFIED against any real payer or NHCX sandbox: none is reachable from this environment. Tested
 * against a mocked fetch only, and said so here.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const num = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const MAX_NOTE = 300;

/** PURE. A claim (use "claim") or pre-authorisation (use "preauthorization") as an R4 Claim resource. */
function buildFhirClaim(record, { use = "claim", payer = {}, now } = {}) {
  const currency = str(payer.currency) || "INR";
  const money = (v) => (num(v) == null ? undefined : { value: num(v), currency });
  const isPre = use === "preauthorization";
  const lines = Array.isArray(record.lines) && record.lines.length
    ? record.lines
    : [{ code: null, display: isPre ? record.treatment : "Inpatient episode", quantity: 1, amount: isPre ? (record.requestedAmount != null ? record.requestedAmount : record.authorizedAmount) : record.submittedAmount }];
  const items = lines.map((l, i) => ({
    sequence: i + 1,
    productOrService: { ...(str(l.code) ? { coding: [{ code: str(l.code), ...(str(l.display) ? { display: str(l.display) } : {}) }] } : {}), text: str(l.display) || str(l.code) || "Service" },
    quantity: { value: num(l.quantity) || 1 },
    ...(money(l.unitPrice) ? { unitPrice: money(l.unitPrice) } : {}),
    ...(money(l.amount) ? { net: money(l.amount) } : {}),
  }));
  const total = num(isPre ? (record.requestedAmount != null ? record.requestedAmount : record.authorizedAmount) : record.submittedAmount);
  const out = {
    resourceType: "Claim",
    identifier: [{ system: "urn:wardsynq:claim", value: str(record.id) }],
    status: "active",
    type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claim-type", code: "institutional" }] },
    use,
    // A reference, never a name: identity travels however the exchange itself requires, not in this body.
    patient: { reference: `Patient/${str(record.patientId)}` },
    created: str(now) || new Date().toISOString(),
    provider: { display: str(payer.providerName) || "Hospital" },
    priority: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/processpriority", code: "normal" }] },
    insurer: { display: str(payer.name) || str(payer.id) },
    insurance: [{ sequence: 1, focal: true, coverage: str(record.policyNumber) ? { identifier: { value: str(record.policyNumber) } } : { display: "Coverage not recorded" } }],
    item: items,
    ...(total != null ? { total: { value: total, currency } } : {}),
  };
  const codes = (record.codes || []).map((c) => str(c && c.code)).filter(Boolean);
  if (codes.length) out.diagnosis = codes.map((code, i) => ({ sequence: i + 1, diagnosisCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code }] } }));
  if (str(record.encounterId)) out.item.forEach((it) => { it.encounter = [{ reference: `Encounter/${str(record.encounterId)}` }]; });
  return out;
}

const catCode = (a) => str(a && a.category && a.category.coding && a.category.coding[0] && a.category.coding[0].code).toLowerCase();

/** PURE. A ClaimResponse into { state, payerReference, outcome, adjudication, disallowances, note }. */
function mapClaimResponse(httpStatus, body) {
  const ok2xx = httpStatus >= 200 && httpStatus < 300;
  const cr = body && body.resourceType === "ClaimResponse" ? body : null;
  if (!ok2xx) {
    const diag = cr || (body && body.resourceType === "OperationOutcome" ? body : null);
    const why = diag && diag.issue ? diag.issue.map((i) => str(i.diagnostics || (i.details && i.details.text))).filter(Boolean).join("; ") : "";
    return { state: "failed", payerReference: null, outcome: null, note: `Payer endpoint answered HTTP ${httpStatus}${why ? `: ${why}` : ""}`.slice(0, MAX_NOTE) };
  }
  if (!cr) return { state: "sent", payerReference: null, outcome: null, note: `Delivered (HTTP ${httpStatus}); the payer returned no ClaimResponse, so nothing is acknowledged yet.` };
  const outcome = str(cr.outcome);
  const payerReference = str(cr.id) || str(cr.preAuthRef) || str(cr.identifier && cr.identifier[0] && cr.identifier[0].value) || null;
  if (outcome === "error") {
    const why = (cr.error || []).map((e) => str(e.code && (e.code.text || (e.code.coding && e.code.coding[0] && e.code.coding[0].code)))).filter(Boolean).join("; ");
    return { state: "failed", payerReference, outcome, note: `The payer rejected the claim${why ? `: ${why}` : ""}`.slice(0, MAX_NOTE) };
  }
  const totals = {};
  for (const t of cr.total || []) { const c = catCode(t); if (c && t.amount && num(t.amount.value) != null) totals[c] = num(t.amount.value); }
  const disallowances = [];
  for (const it of cr.item || []) {
    for (const a of it.adjudication || []) {
      const reason = str(a.reason && (a.reason.text || (a.reason.coding && a.reason.coding[0] && (a.reason.coding[0].display || a.reason.coding[0].code))));
      if (reason) disallowances.push({ itemSequence: it.itemSequence || null, reason, amount: a.amount ? num(a.amount.value) : null });
    }
  }
  return {
    state: "acknowledged", payerReference, outcome: outcome || null,
    adjudication: { submitted: totals.submitted == null ? null : totals.submitted, approved: totals.benefit == null ? (totals.eligible == null ? null : totals.eligible) : totals.benefit },
    disallowances,
    preAuthRef: str(cr.preAuthRef) || null,
    note: str(cr.disposition).slice(0, MAX_NOTE) || (outcome === "queued" ? "Acknowledged; the payer has queued it for adjudication." : "Acknowledged by the payer."),
  };
}

/** PURE. Does this payer require credentials? Yes unless it says auth "none" explicitly: an unstated auth block is not permission to send claims unauthenticated. */
function requiresAuth(payer) { const a = payer && payer.auth; return !(a === "none" || (a && typeof a === "object" && a.type === "none")); }

/**
 * The adapter. deps: { fetch, authorize(request) -> headers object | null }
 * Nothing is sent without an https endpoint, and nothing is sent unauthenticated to a payer that needs auth.
 */
function FhirClaimAdapter(payer, deps = {}) {
  return {
    id: `fhir-claim:${str(payer && payer.id)}`,
    name: `FHIR Claim to ${str(payer && payer.name) || str(payer && payer.id)}`,
    async submit(record, opts = {}) {
      const endpoint = str(payer && payer.endpoint);
      if (!/^https:\/\//i.test(endpoint)) return { state: "not_configured", note: "not_configured: this payer has no https endpoint configured. Nothing was sent." };
      if (typeof deps.fetch !== "function") return { state: "not_configured", note: "not_configured: no transport is available. Nothing was sent." };
      const use = opts.use === "preauthorization" ? "preauthorization" : "claim";
      const resource = buildFhirClaim(record, { use, payer, now: opts.now });
      const request = { url: endpoint, method: "POST", payerId: str(payer.id) };
      let authHeaders = null;
      if (requiresAuth(payer)) {
        try { authHeaders = typeof deps.authorize === "function" ? await deps.authorize(request) : null; } catch { authHeaders = null; }
        if (!authHeaders || !Object.keys(authHeaders).length) return { state: "not_configured", note: "not_configured: credentials missing. This payer requires authentication and no credential is configured. Nothing was sent." };
      }
      let res;
      try {
        res = await deps.fetch(endpoint, { method: "POST", headers: { "content-type": "application/fhir+json", accept: "application/fhir+json", ...(authHeaders || {}) }, body: JSON.stringify(resource) });
      } catch (e) {
        return { state: "failed", note: `No response from the payer endpoint (${str(e && e.message).slice(0, 120)}). Delivery is unknown: check with the payer before resubmitting.` };
      }
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return mapClaimResponse(res.status, body);
    },
  };
}

export { buildFhirClaim, mapClaimResponse, requiresAuth, FhirClaimAdapter };
