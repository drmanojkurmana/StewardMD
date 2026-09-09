/* functions/_wardsynq/fhir-identity.js — TASK 7.11: the people and the place, as FHIR.
 *
 * WHAT THE AUDIT FOUND, and it decided the whole design. Every clinician on every exported resource
 * was a bare string: `requester: { display: "cfa:9f2a..." }`, `author: [{ display: "fb:dr-menon" }]`.
 * A receiving system cannot tell whether that is a person, a machine or a typo, cannot match the
 * same author across two resources, and cannot ask this server who it is. And WardSynQ holds NO
 * practitioner directory: q_members carries a role and nothing else - no name, no registration
 * number - so there is nothing to look one up in.
 *
 * SO NOTHING IS INVENTED. A Practitioner here carries exactly what this server actually knows:
 *
 *   ALWAYS   the actor identifier the record itself is stamped with. That alone is worth serving:
 *            it makes every reference on every exported resource RESOLVE and MATCH, which is the
 *            thing a bare display string can never do.
 *   ONLY IF VERIFIED   a name and a medical council registration number, from the verification
 *            record the eLOGBook signature path already relies on (functions/_pglog_signer.js). That
 *            record exists precisely because a document somebody relies on must carry a registered
 *            practitioner's number, so it is the one authoritative source of a clinician's identity
 *            in this system.
 *   NEVER    a name guessed from an email address or an opaque id, a qualification, a specialty, or
 *            a telecom. An unverified clinician gets a Practitioner with an identifier and a
 *            narrative that SAYS this server holds no verified registration for them.
 *
 * "NOT VERIFIED" AND "COULD NOT CHECK" ARE DIFFERENT ANSWERS, and this keeps them different - the
 * distinction signerSnapshot itself is built around. Where the register cannot be reached, the
 * Practitioner still carries the identifier (which is a fact about the record, not about the
 * register) and its narrative SAYS the registration could not be checked. It does not fail the read:
 * this asserts nothing about anybody's verification either way, so an unreachable register is not
 * the outage that a REFUSED SIGNATURE is - there, and only there, the fail-closed 503 belongs.
 *
 * DERIVED, NEVER STORED. Practitioner and Organization are views over facts other subsystems own -
 * exactly as Provenance already is (fhir.js's own header: "a view of the audit the record already
 * carries, so it cannot disagree with it"). There is no Practitioner row, so there is nothing to
 * fall out of date, and no second staff directory to reconcile with the real one.
 */

import { operationOutcome } from "./fhir.js";
import { fhirId } from "./fhir-id.js";
import { signerSnapshot } from "../_pglog_signer.js";
import { getOrg } from "../_opd_org_store.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** Our own identifier namespace for an actor id. The SAME string the record's writtenBy carries. */
const ACTOR_SYSTEM = "urn:stewardmd:actor";
/** A medical council's own register. The council NAME is the namespace: India has many, and a
 *  registration number is only unique within one. Never flattened into a single national system. */
const councilSystem = (council) => (str(council) ? `urn:stewardmd:council:${str(council).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "urn:stewardmd:council:unstated");

const narrative = (text) => ({ status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${String(text).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</div>` });

/**
 * PURE. One actor as an R4 Practitioner. `snapshot` is a verified registration
 * ({ regNo, council, name, verifiedAt }) or null when this server holds none.
 */
function fhirPractitioner(actorId, snapshot, opts) {
  const id = str(actorId);
  if (!id) return null;
  const o = opts || {};
  const s = snapshot || null;
  const out = {
    resourceType: "Practitioner",
    /* The id a client asked under. An actor id ("cfa:<email>", "fb:<uid>") is not a legal FHIR id,
     * and fhirId() would hash it one-way with nothing here able to reverse it - so a caller that
     * asked by the raw id is answered under the raw id, and only a caller that asked under the
     * hashed form gets that back. The IDENTIFIER is the same either way, and it is what a receiver
     * matches on. */
    id: str(o.id) || fhirId(id),
    identifier: [{ system: ACTOR_SYSTEM, value: id }],
  };
  if (s && str(s.regNo)) {
    out.identifier.push({
      // MD: the v2-0203 code for a medical licence number. A standard code for exactly this fact.
      type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MD", display: "Medical License number" }] },
      system: councilSystem(s.council), value: str(s.regNo),
      assigner: str(s.council) ? { display: str(s.council) } : undefined,
    });
    if (str(s.name)) out.name = [{ text: str(s.name) }];
    out.text = narrative(`Registration ${str(s.regNo)}${str(s.council) ? ` with ${str(s.council)}` : ""}, verified${str(s.verifiedAt) ? ` on ${str(s.verifiedAt)}` : ""}.`);
  } else if (str(o.accountName)) {
    /* THE NAME ON THE ACCOUNT, and labelled as exactly that. This is the SMART `fhirUser` case: a
     * person asking who they are signed in as, where showing them their own account name is useful
     * and is not a claim about anybody's registration. `use: "temp"` is R4's own word for a name
     * that is not the official one, and the narrative says where it came from - a receiver must
     * never read this as a verified clinician's name. */
    out.name = [{ use: "temp", text: str(o.accountName) }];
    out.text = narrative("The name here is the one on this person's own account. This server holds no verified medical registration for them, so it states no registration number and this name is not a verified identity.");
  } else if (o.unchecked) {
    /* COULD NOT CHECK, which is not the same as NONE HELD. Nothing is asserted about this person's
     * registration in either direction, and the sentence says so. */
    out.text = narrative("This person's medical registration could not be checked just now, so this states nothing about it either way - neither that one exists nor that one does not. The identifier is the account the record was written under.");
  } else {
    /* NO NAME, and the resource says why rather than looking like a person with none. A receiver
     * that renders this sees the sentence; one that matches on identifier still matches. */
    out.text = narrative("This server holds no verified medical registration for this person, so it states no name and no registration number. The identifier is the account the record was written under.");
  }
  // `assigner: undefined` would survive JSON.stringify as a missing key, but an explicit clean keeps
  // the resource free of undefined values for any consumer that walks it.
  out.identifier = out.identifier.map((i) => Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)));
  return out;
}

/** PURE. The hospital itself, from its own org record. Everything here is stored, nothing derived. */
function fhirOrganization(org) {
  const o = org || {};
  if (!str(o.id)) return null;
  return Object.fromEntries(Object.entries({
    resourceType: "Organization",
    id: fhirId(str(o.id)),
    identifier: str(o.code) ? [{ system: "urn:stewardmd:org", value: str(o.code) }] : undefined,
    active: true,
    /* A real code from FHIR's own organization-type value set. "prov" is a healthcare provider,
     * which a clinic and a teaching institution both are; the distinction this system draws between
     * them (org.kind) is carried as a second, clearly LOCAL coding rather than forced into the
     * standard set, because "institution" is not one of its codes. */
    type: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/organization-type", code: "prov", display: "Healthcare Provider" },
      ...(str(o.kind) ? [{ system: "urn:stewardmd:org-kind", code: str(o.kind) }] : [])] }],
    name: str(o.name) || undefined,
  }).filter(([, v]) => v !== undefined));
}

/**
 * GET .../Practitioner/{id}. ctx: { migration, env }
 *
 * The id may be the actor id itself or the hashed form fhirId() produced for a reference; both
 * resolve, because a reference this server emitted must be followable.
 */
async function practitionerRead(request, env, ctx) {
  /* THE ID IS TAKEN AS GIVEN, and that is safe because of what this server does NOT emit: since
   * TASK 7.11 every clinician on an exported resource is a LOGICAL reference (an identifier), never
   * `Practitioner/{hashed id}` - so there is no hashed practitioner id in the wild to reverse, and
   * nothing here has to guess which actor a hash came from. fhir.js's resolveId scans stored records
   * of a type; there are no stored Practitioner records to scan. */
  const wanted = str(ctx.id);
  if (!wanted) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such practitioner") };

  let snapshot = null, unchecked = false;
  try {
    snapshot = await signerSnapshot(env, wanted, ctx.signerDeps || {});
  } catch (e) {
    /* A 503 from signerSnapshot means the register could not be REACHED. Saying "no verified
     * registration" then would assert something this server does not know, so the resource says
     * COULD NOT BE CHECKED instead - a different sentence from "none held", which is the whole
     * point. Every other error means the person genuinely has no verified registration, which is a
     * fact worth returning rather than an error. */
    unchecked = !!(e && e.status === 503);
    snapshot = null;
  }
  const resource = fhirPractitioner(wanted, snapshot, { id: str(ctx.id), accountName: ctx.accountName, unchecked });
  if (!resource) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such practitioner") };
  return { ok: true, status: 200, resource };
}

/** GET .../Organization/{id}. The hospital this door belongs to, and only that one. */
async function organizationRead(request, env, ctx) {
  const wanted = str(ctx.id);
  const orgId = str(ctx.orgId);
  /* ONE HOSPITAL PER DOOR. This door is opened with an orgId and answers about that organisation;
   * asking it for another hospital's Organization is a 404, not a lookup. A FHIR server that will
   * describe any organisation by id is a directory, and this is not one. */
  if (!wanted || (orgId && wanted !== orgId && fhirId(orgId) !== str(ctx.id))) {
    return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "this door answers only about the hospital it belongs to") };
  }
  let org = null;
  try { org = await (ctx.getOrg || getOrg)(env, orgId || wanted); }
  catch (e) { return { ok: false, status: 502, outcome: operationOutcome("error", "exception", "the organisation record could not be read") }; }
  const resource = fhirOrganization(org);
  if (!resource) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such organisation") };
  return { ok: true, status: 200, resource };
}

export { ACTOR_SYSTEM, councilSystem, fhirPractitioner, fhirOrganization, practitionerRead, organizationRead };
