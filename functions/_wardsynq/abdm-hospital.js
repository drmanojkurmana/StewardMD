/* functions/_wardsynq/abdm-hospital.js - owner S6, phase A1: a hospital's own ABDM profile.
 *
 * ABDM registrations are hospital-specific (owner S6). A hospital registers ITSELF in the Health
 * Facility Registry, presses Software Linkage for the StewardMD bridge, and ABDM issues it a HIP ID for
 * that (facility, bridge) pair. This file is the profile that records those facts, PURE: no fetch, no
 * storage, no ABDM gateway call. Design: docs/emr-gap-analysis/S6_ABDM_INTEGRATION_DESIGN.md 3.1-3.2, 4.2.
 *
 * STORAGE is the per-hospital connector (connectors.js, kind "abdm", singleton id "abdm"): versioned,
 * audited in the same append, credentials sealed and never returned. This file only declares the kind
 * and decides what may be saved.
 *
 * HONEST STATUS. The profile status is what the hospital's administrator declares about ABDM's portal;
 * WardSynQ checks nothing against ABDM in this phase. The checklist therefore never says "verified":
 * a fact the hospital typed is "entered", work this build cannot do is "not built", and production is
 * "blocked" until the software holds production credentials.
 *
 * FORMATS. HFR facility id and HPR id shapes come from functions/_region_in.js (shape only, no published
 * check digit). The HIP and HIU id shape is NOT published in anything this repo has verified: the sandbox
 * bridge's HIP ID was the facility id itself (IN + 10 digits), so only a conservative character rule is
 * applied. VERIFY against ABDM before tightening it.
 */

import { isValidHfrId, isValidHprId } from "../_region_in.js";
import { capsFor, CAPS } from "../_queue_roles.js";

const STATUSES = Object.freeze(["draft", "submitted", "sandbox-linked", "production-linked", "suspended"]);
const STATUS_LABELS = Object.freeze({ draft: "Draft", submitted: "Submitted for Software Linkage", "sandbox-linked": "Linked in sandbox", "production-linked": "Linked in production", suspended: "Suspended" });
/* from -> the statuses it may move to. Staying put is always allowed (editing a draft). */
const TRANSITIONS = Object.freeze({
  draft: ["submitted"],
  submitted: ["draft", "sandbox-linked", "suspended"],
  "sandbox-linked": ["production-linked", "suspended"],
  "production-linked": ["suspended"],
  suspended: ["draft"],
});
/* Identifiers are frozen once ABDM has linked them: changing a HIP ID under a live linkage would send
 * one facility's callbacks to another. Change them from draft or submitted, or by moving back to draft. */
const EDITABLE_FROM = new Set(["draft", "submitted"]);
const ID_KEYS = ["hfrFacilityId", "hipId", "hiuId"];

/* Owner A2: no production ABDM traffic until the India-region hosting from the AWS move exists. */
const AWAITING_INDIA = "Production ABDM traffic is held until India-region hosting exists, and needs the software's production ABDM credentials after certification.";

const str = (v) => (v == null ? "" : String(v).trim());
const isGatewayId = (v) => /^[A-Za-z0-9][A-Za-z0-9_.-]{2,49}$/.test(str(v));

/** PURE. Why moving `from` -> `to` is refused for these settings at this org, or null. from null = a new profile. */
function transitionRefusal(from, to, settings, org) {
  const f = from || "draft";
  if (!STATUSES.includes(to)) return `Status must be one of: ${STATUSES.join(", ")}.`;
  if (!STATUSES.includes(f)) return "The saved status is not one this build knows, so it cannot be moved. Nothing was saved.";
  if (from == null && !["draft", "submitted"].includes(to)) return "A new ABDM profile starts as a draft or submitted.";
  if (from != null && f !== to && !TRANSITIONS[f].includes(to)) return `${STATUS_LABELS[f]} cannot move to ${STATUS_LABELS[to]}.`;
  const s = settings || {};
  if (to === "submitted" || to === "sandbox-linked") {
    const hfr = hfrRefusal(s.hfrFacilityId, org);
    if (hfr) return hfr;
  }
  if (to === "sandbox-linked" && !str(s.hipId)) return "Enter the HIP ID ABDM showed after Software Linkage before marking the profile linked.";
  if (to === "production-linked" && f !== to) return `Production linking is blocked. ${AWAITING_INDIA}`;
  return null;
}

/** PURE. The facility id must be well formed AND be the one on the hospital record: one source of truth. */
function hfrRefusal(hfrFacilityId, org) {
  const id = str(hfrFacilityId);
  if (!org || org.region !== "IN") return "ABDM applies to a hospital in India. Set the country on the Hospital tab.";
  if (!isValidHfrId(id) || id !== id.toUpperCase().replace(/[\s-]+/g, "")) return "The HFR facility ID is IN followed by 10 digits, with no spaces.";
  const onOrg = str(org.regionProfile && org.regionProfile.hfrId);
  if (!onOrg) return "Enter the HFR facility ID on the Hospital tab first, so the hospital record and the ABDM profile carry the same one.";
  if (onOrg !== id) return `The HFR facility ID must match the one on the hospital record (${onOrg}).`;
  return null;
}

/**
 * PURE. The connector framework's validate hook for the shared-bridge provider.
 * context: { org, previous } where previous is the saved settings (or null for a new profile).
 */
function validateShared(settings, _secrets, context) {
  const s = settings || {}, ctx = context || {}, prev = ctx.previous || null;
  const hfr = hfrRefusal(s.hfrFacilityId, ctx.org);
  if (hfr) return hfr;
  if (str(s.hipId) && !isGatewayId(s.hipId)) return "The HIP ID is 3 to 50 letters, digits, dots, dashes or underscores, as ABDM shows it.";
  if (str(s.hiuId) && !isGatewayId(s.hiuId)) return "The HIU ID is 3 to 50 letters, digits, dots, dashes or underscores, as ABDM shows it.";
  if (prev && !EDITABLE_FROM.has(prev.status) && s.status !== "draft" && ID_KEYS.some((k) => str(s[k]) !== str(prev[k]))) {
    return "The facility, HIP and HIU IDs are fixed once ABDM has linked them. Move the profile back to draft to change them.";
  }
  return transitionRefusal(prev ? prev.status : null, s.status, s, ctx.org);
}

/** PURE. Per member, for the doctors who would request records: registration number required, HPR ID optional. */
function doctorReadiness(members, registry) {
  const checks = (registry && registry.professionals) || {};
  return (members || [])
    .filter((m) => m && m.active !== false && capsFor(m.role).includes(CAPS.EMR_TREAT))
    .map((m) => {
      const hpr = str(m.regionProfile && m.regionProfile.hprId);
      // A registry answer counts only for the HPR ID it was about; a changed ID is unchecked again.
      const c = checks[m.identity] && hpr && checks[m.identity].hprId === hpr.replace(/\D/g, "") ? checks[m.identity] : null;
      return { identity: m.identity, email: m.email || "", role: m.role, regNoSet: !!str(m.regNo), hprId: hpr || null, hprValid: hpr ? isValidHprId(hpr) : null,
        hprRegistry: c ? { status: c.status, checkedAt: c.checkedAt, name: c.name || null } : null };
    })
    .sort((a, b) => String(a.email || a.identity).localeCompare(String(b.email || b.identity)));
}

/**
 * PURE. The per-hospital certification checklist (design 4.2), with statuses that claim only what is known.
 * status: "entered" (the hospital typed it; not checked against ABDM), "missing", "mismatch",
 * "not-built" (this build cannot do it yet), "blocked" (waits on something outside this build).
 */
function checklist(settings, org, doctors, registry) {
  const s = settings || {};
  const onOrg = str(org && org.regionProfile && org.regionProfile.hfrId);
  const fac = registry && registry.facility && registry.facility.hfrFacilityId === onOrg ? registry.facility : null;
  const items = [];
  items.push({ key: "hfr", label: "Facility registered and verified in the Health Facility Registry",
    ...(!onOrg ? { status: "missing", detail: "No HFR facility ID on the hospital record. Enter it on the Hospital tab." }
      : str(s.hfrFacilityId) && str(s.hfrFacilityId) !== onOrg ? { status: "mismatch", detail: `The profile names ${str(s.hfrFacilityId)}; the hospital record names ${onOrg}.` }
      /* What the registry itself answered (abdm-registry.js), for this very ID. Its own status word is shown as it wrote it. */
      : fac && fac.status === "verified" ? { status: "verified", detail: `The Health Facility Registry lists ${onOrg}${fac.facilityName ? ` as ${fac.facilityName}` : ""}${fac.facilityStatus ? `, registry status ${fac.facilityStatus}` : ""}. Checked ${fac.checkedAt}.` }
      : fac && fac.status === "not-found" ? { status: "not-found", detail: `The Health Facility Registry has no facility ${onOrg}. Checked ${fac.checkedAt}.` }
      : fac ? { status: "unverified", detail: `The registry could not confirm ${onOrg} (${fac.reason || "no usable answer"}). Checked ${fac.checkedAt}; check again.` }
      : { status: "entered", detail: `${onOrg} is on the hospital record. WardSynQ has not checked it against the registry.` }) });
  items.push({ key: "linkage", label: "Software Linkage pressed for the StewardMD bridge; HIP ID entered",
    ...(str(s.hipId) ? { status: "entered", detail: `HIP ID ${str(s.hipId)} entered${str(s.hiuId) ? `, HIU ID ${str(s.hiuId)}` : ""}. Not checked against ABDM.` }
      : { status: "missing", detail: "No HIP ID yet. ABDM shows it after Software Linkage." }) });
  items.push({ key: "session", label: "Gateway session opened for this hospital", ...(fac && fac.reason !== "session"
    ? { status: "verified", detail: `A session with the shared StewardMD bridge was opened when the registry was checked, ${fac.checkedAt}. Bridge services are not listed here.` }
    : fac ? { status: "unverified", detail: `No session could be opened when the registry was checked, ${fac.checkedAt}.` }
    : { status: "not-checked", detail: "Opened by the first registry check." }) });
  items.push({ key: "sandbox", label: "Sandbox run: verify an ABHA, link a visit, share, request records, file them", status: "available",
    detail: "Built: ABHA at registration, Scan and Share on the Patients page, linking at discharge, and requests from the chart. No sandbox run is recorded as passed." });
  const docs = doctors || [];
  const withReg = docs.filter((d) => d.regNoSet).length, withHpr = docs.filter((d) => d.hprValid === true).length;
  const hprVerified = docs.filter((d) => d.hprRegistry && d.hprRegistry.status === "verified").length;
  items.push({ key: "doctors", label: "Doctors: registration number to request records, HPR ID optional",
    ...(!docs.length ? { status: "missing", detail: "No active prescriber at this hospital." }
      : { status: withReg === docs.length ? "entered" : "missing", detail: `${withReg} of ${docs.length} have a registration number; ${withHpr} have an HPR ID; ${hprVerified} found in the Health Professional Registry.` }) });
  items.push({ key: "counters", label: "Scan and share QR printed per counter", status: "available", detail: "Patients page, Scan and Share: one QR per counter, printable. Printing is not recorded." });
  items.push({ key: "dpdp", label: "Hospital admin confirms DPDP notices and ABHA consent text are shown at the desk", status: "not-built",
    detail: "ABDM's consent text is shown and recorded on the check-in sheet before an Aadhaar OTP. The admin's confirmation is not recorded yet." });
  items.push({ key: "production", label: "Switch this hospital to production", status: "blocked", detail: `Awaiting India hosting. ${AWAITING_INDIA}` });
  return items;
}

/** PURE. What the Admin ABDM card shows. connector = the framework summary (never a secret) or null. */
/* OWNER DECISION 2026-09-14: an invoice received from another facility over ABDM is a clinical DOCUMENT
 * and never this hospital's bill. A named per-hospital policy so the choice is explicit, audited on every
 * landed invoice (abdm-land.js), and one new entry here when a billing model for external invoices exists.
 * Absent means the default. A save with any other value is refused (externalInvoiceHandlingRefusal). */
const EXTERNAL_INVOICE_POLICY = "wardsynq.abdm.externalInvoiceHandling";
const EXTERNAL_INVOICE_HANDLINGS = Object.freeze({
  "clinical-document": "Kept on the patient's chart as a document from the sending facility. It never becomes a bill, charge, payment or ledger entry at this hospital, and billing screens and reports do not count it. Owner decision 2026-09-14: the billing model for external invoices is not built.",
});
const EXTERNAL_INVOICE_DEFAULT = "clinical-document";

/** PURE. The handling that decides a landed external invoice, from the hospital's wardsynq config.
 * A stored value this build does not know (a rollback, a hand edit) is never followed: the default is
 * applied and the stored value is named, so the audit row says what was configured and what was done. */
function externalInvoiceHandling(wardsynq) {
  const raw = wardsynq && wardsynq.abdm && typeof wardsynq.abdm === "object" ? wardsynq.abdm.externalInvoiceHandling : undefined;
  const set = raw !== undefined && raw !== null && raw !== "";
  const known = set && Object.prototype.hasOwnProperty.call(EXTERNAL_INVOICE_HANDLINGS, raw);
  const value = known ? raw : EXTERNAL_INVOICE_DEFAULT;
  return { policy: EXTERNAL_INVOICE_POLICY, value, source: !set ? "default" : known ? "hospital" : "unrecognised",
    ...(set && !known ? { configured: str(raw).slice(0, 60) } : {}), reason: EXTERNAL_INVOICE_HANDLINGS[value] };
}

/** PURE. A sentence when an org save's wardsynq patch carries an external invoice handling this build does not have, else null. */
function externalInvoiceHandlingRefusal(wardsynqPatch) {
  if (!wardsynqPatch || typeof wardsynqPatch !== "object" || wardsynqPatch.abdm === undefined || wardsynqPatch.abdm === null) return null;
  const a = wardsynqPatch.abdm;
  if (typeof a !== "object" || Array.isArray(a)) return "The ABDM settings were not saved: they must be an object.";
  const v = a.externalInvoiceHandling;
  if (v === undefined || v === null || Object.prototype.hasOwnProperty.call(EXTERNAL_INVOICE_HANDLINGS, v)) return null;
  return `External ABDM invoice handling "${str(v).slice(0, 60)}" was not saved. The only handling built is "${EXTERNAL_INVOICE_DEFAULT}": an invoice received from another facility is kept on the chart as a document. The billing model for external invoices is not built, so it cannot become a bill here.`;
}

function abdmView(connector, org, members, registry) {
  const settings = (connector && connector.settings) || {};
  const doctors = doctorReadiness(members, registry);
  const current = connector ? settings.status || null : null;
  const options = TRANSITIONS[current] ? [current, ...TRANSITIONS[current]] : ["draft", "submitted"];
  return {
    profile: connector,
    hfrOnOrg: str(org && org.regionProfile && org.regionProfile.hfrId) || null,
    region: (org && org.region) || null,
    /* Only the standing blocker is decided here; the typed IDs are checked when the save arrives. */
    statusOptions: options.map((st) => {
      const why = st === "production-linked" && st !== current ? transitionRefusal(current, st, settings, org) : null;
      return { status: st, label: STATUS_LABELS[st], allowed: !why, reason: why };
    }),
    doctors, checklist: checklist(settings, org, doctors, registry),
    bridge: "shared",
    invoiceHandling: externalInvoiceHandling(org && org.wardsynq),
  };
}

/* Owner A1: every hospital links its own facility to the one shared StewardMD bridge. There is no
 * per-hospital bridge credential, so this kind declares no secret and a secret sent with a save is dropped. */
const ABDM_KIND = Object.freeze({
  label: "ABDM (Ayushman Bharat Digital Mission)", singleton: true,
  help: "This hospital's own HFR facility and the HIP ID ABDM issued it on Software Linkage for the shared StewardMD bridge. No call to ABDM is made from this screen yet.",
  providers: {
    "shared-bridge": {
      label: "Shared StewardMD bridge",
      settings: [
        { key: "hfrFacilityId", label: "HFR facility ID", type: "text", required: true },
        { key: "hipId", label: "HIP ID (shown by ABDM after Software Linkage)", type: "text" },
        { key: "hiuId", label: "HIU ID (if this hospital requests records)", type: "text" },
        { key: "status", label: "Status", type: "select", required: true, options: STATUSES.map((st) => [st, STATUS_LABELS[st]]) },
      ],
      secrets: [],
      validate: validateShared,
    },
  },
});

export { EXTERNAL_INVOICE_POLICY, EXTERNAL_INVOICE_HANDLINGS, externalInvoiceHandling, externalInvoiceHandlingRefusal,
  ABDM_KIND, STATUSES, TRANSITIONS, transitionRefusal, hfrRefusal, validateShared, doctorReadiness, checklist, abdmView };
