/* functions/_wardsynq/cda.js — the discharge summary as a document another hospital can open.
 *
 * FHIR (fhir.js) is how a system gets the RECORD out. HL7v2 (hl7v2.js) is how it talks to the
 * machines in the building. CDA is the third thing, and the one a receiving HOSPITAL actually files:
 * a clinical DOCUMENT, human-readable, that a doctor somewhere else opens and reads. Indian HIEs and
 * most referral pathways move documents, not resources.
 *
 * LEVEL 1, AND IT SAYS SO. This produces a valid CDA R2 header wrapping a NARRATIVE body, with no
 * coded entries. That is a real, defined conformance level and it is the honest one to claim: a
 * level-3 document asserts that every clinical statement inside it is machine-coded to a template,
 * and emitting templateIds we have never validated against would be the same lie as emitting a
 * guessed LOINC - a receiver cannot tell a real conformance claim from an invented one, and will
 * trust both.
 *
 * ONLY A SIGNED SUMMARY LEAVES. A discharge summary is a document somebody put their name to. There
 * is no such thing as exporting a draft one: a draft has no author who has stood behind it, and a
 * receiving hospital reading one would be reading something nobody in this hospital has agreed to.
 * The refusal names the fix.
 *
 * XML ESCAPING IS THE CORRECTNESS PROPERTY, exactly as delimiter escaping is in HL7v2. A patient
 * named "Smith & Sons" or a note containing "<" does not produce a slightly odd document - it
 * produces one that will not parse, or worse, one that parses into the wrong shape. Every value goes
 * through esc().
 *
 * NOTHING IS SUMMARISED. The sections are the summary's own, verbatim. A document generator that
 * shortened a discharge summary on the way out would be making a clinical decision about what
 * mattered, in a file nobody would think to look in.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v));

/** PURE. The five XML entities. `&` MUST be first, or it re-escapes what the others introduce. */
function esc(value) {
  return str(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * PURE. YYYYMMDDHHMMSS+ZZZZ, the CDA TS.FULL time format. Absent or unparseable is EMPTY, never a guess.
 *
 * OPS-21/F21: the offset is ALWAYS explicit (+0000: these digits are UTC), never bare - a bare CDA
 * effectiveTime/time is read by a receiver as ITS OWN local time (same class of defect as hl7v2.js's
 * ts()), so signing and authoring instants were ambiguous or shifted for a receiver in another zone.
 * A caller slicing to the date-only portion (birthTime) is unaffected - slice(0, 8) stops before it.
 */
function ts(iso) {
  const ms = Date.parse(str(iso).trim());
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}+0000`;
}

/** PURE. HL7 AdministrativeGender (OID 2.16.840.1.113883.5.1): code + codeSystem + displayName, never
 *  a raw sex string in displayName alone - a CDA consumer reads @code, and a receiver with no @code
 *  sees no sex at all (affects reference ranges and dosing downstream). Unmapped is UN (undifferentiated). */
const ADMIN_GENDER = Object.freeze({ male: { code: "M", display: "Male" }, m: { code: "M", display: "Male" }, female: { code: "F", display: "Female" }, f: { code: "F", display: "Female" } });
function administrativeGender(sex) {
  const s = str(sex).trim().toLowerCase();
  const g = ADMIN_GENDER[s] || { code: "UN", display: "Undifferentiated" };
  return `code="${g.code}" codeSystem="2.16.840.1.113883.5.1" displayName="${esc(g.display)}"`;
}

/** PURE. A section's title, humanised from its key only for DISPLAY. The content is never touched. */
function titleOf(key) {
  const k = str(key).trim();
  if (!k) return "Section";
  return k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/**
 * PURE. The document. Returns null when there is nothing that may honestly be exported.
 *
 * input: { summary, patient, encounter, org, now }
 */
function cdaDocument(input) {
  const i = input || {};
  const summary = i.summary;
  if (!summary || !summary.id) return null;
  // ONLY A SIGNED SUMMARY. A draft has no author who has stood behind it.
  if (!summary.signedBy) return null;

  const p = i.patient || {};
  const e = i.encounter || null;
  const org = i.org || {};
  const sections = summary.sections && typeof summary.sections === "object" ? summary.sections : {};
  const keys = Object.keys(sections);
  if (!keys.length) return null;

  const effective = ts(i.now) || ts(new Date().toISOString());

  const body = keys.map((k) => {
    const text = str(sections[k]).trim();
    return [
      "      <component>",
      "        <section>",
      `          <title>${esc(titleOf(k))}</title>`,
      /* The section's own words, wrapped in a paragraph and escaped. Never shortened, never
       * reordered, never summarised - a generator that edited a discharge summary on the way out
       * would be making a clinical decision in a file nobody would think to look in. */
      `          <text><paragraph>${esc(text || "Not recorded.")}</paragraph></text>`,
      "        </section>",
      "      </component>",
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ClinicalDocument xmlns="urn:hl7-org:v3">',
    '  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>',
    /* NO templateId. Asserting one claims conformance to a profile this document has never been
     * validated against, and a receiver cannot tell a real claim from an invented one. */
    `  <id root="${esc(org.oid || "2.25.0")}" extension="${esc(summary.id)}"/>`,
    '  <code code="18842-5" codeSystem="2.16.840.1.113883.6.1" displayName="Discharge summary"/>',
    `  <title>${esc(`Discharge summary${p.name ? ` - ${p.name}` : ""}`)}</title>`,
    `  <effectiveTime value="${effective}"/>`,
    '  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>',
    '  <languageCode code="en-IN"/>',
    "  <recordTarget>",
    "    <patientRole>",
    `      <id root="${esc(org.oid || "2.25.0")}" extension="${esc(p.mrn || summary.patientId)}"/>`,
    "      <patient>",
    // A name the record does not hold is an EMPTY element, never a placeholder somebody might read
    // as the patient's actual name.
    `        <name>${esc(p.name || "")}</name>`,
    ...(p.sex ? [`        <administrativeGenderCode ${administrativeGender(p.sex)}/>`] : []),
    ...(ts(p.dob) ? [`        <birthTime value="${ts(p.dob).slice(0, 8)}"/>`] : []),
    "      </patient>",
    "    </patientRole>",
    "  </recordTarget>",
    "  <author>",
    `    <time value="${ts(summary.signedAt) || effective}"/>`,
    "    <assignedAuthor>",
    // The clinician who SIGNED it. Not whoever exported it: the document's author is the person
    // accountable for its contents. OPS-22/F22: root, or this id is anonymous to any receiver -
    // the SAME org OID the patient/document ids above already use.
    `      <id root="${esc(org.oid || "2.25.0")}" extension="${esc(summary.signedBy)}"/>`,
    "    </assignedAuthor>",
    "  </author>",
    "  <custodian>",
    "    <assignedCustodian>",
    "      <representedCustodianOrganization>",
    // OPS-14/F14: id is required (minOccurs=1) - a document with only <name> fails the CDA R2 schema
    // and any HIE/partner that schema-validates incoming CDA rejects the whole document.
    `        <id root="${esc(org.oid || "2.25.0")}"/>`,
    `        <name>${esc(org.name || "")}</name>`,
    "      </representedCustodianOrganization>",
    "    </assignedCustodian>",
    "  </custodian>",
    ...(e && e.id ? [
      "  <componentOf>",
      "    <encompassingEncounter>",
      // OPS-22/F22: root, for the same reason as the author id above.
      `      <id root="${esc(org.oid || "2.25.0")}" extension="${esc(e.id)}"/>`,
      `      <effectiveTime><low value="${ts(e.periodStart)}"/><high value="${ts(e.periodEnd)}"/></effectiveTime>`,
      "    </encompassingEncounter>",
      "  </componentOf>",
    ] : []),
    "  <component>",
    "    <structuredBody>",
    body,
    "    </structuredBody>",
    "  </component>",
    "</ClinicalDocument>",
  ].join("\n");
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** ctx: { migration, encounterId, org?, actorDeps, recordDeps } */
async function cdaForEncounter(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", document: null };

  const encounterId = str(ctx.encounterId).trim();
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", document: null };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, document: null };

  const summaryId = `wsq-dcs-${encounterId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  let summary, encounter, patient;
  try {
    summary = await svc.get("ClinicalNote", summaryId);
    encounter = await svc.get("Encounter", encounterId).catch(() => null);
    patient = encounter ? await svc.get("Patient", encounter.patientId).catch(() => null) : null;
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), document: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), document: null };
  }
  if (!summary) return { ...base, ok: false, status: 404, error: "summary_not_found", detail: "no discharge summary has been drafted for this stay", encounterId, document: null };
  /* THE REFUSAL THAT MATTERS. A receiving hospital reading a draft would be reading something nobody
   * here has agreed to. The fix is named rather than left to be guessed. */
  if (!summary.signedBy) {
    return { ...base, ok: false, status: 409, error: "summary_not_signed", detail: "a discharge summary is exported as a document only once a clinician has signed it", encounterId, document: null };
  }

  const document = cdaDocument({ summary, patient, encounter, org: ctx.org || {}, now: new Date().toISOString() });
  if (!document) return { ...base, ok: false, status: 409, error: "nothing_to_export", detail: "this summary has no sections", encounterId, document: null };

  return {
    ...base, ok: true, encounterId, summaryId, document,
    /* Said every time. Shaped is not conformant, and a level claimed is a level a receiver will
     * expect: this is a narrative document with no coded entries and it says so rather than
     * asserting a templateId nobody has validated. */
    note: "HL7 CDA R2, LEVEL 1 - a valid header wrapping a narrative body, with no coded entries and no "
      + "templateId asserting conformance to a profile this has not been validated against.",
    actor: resolved.actor.id,
  };
}

export { esc, ts, titleOf, cdaDocument, cdaForEncounter };
