/* functions/_wardsynq/migrate-allergy.js — best-effort allergy capture from the existing assessment
 * form, for a NATIVE WardSynQ hospital only (org.mode "wardsynq").
 *
 * WHERE THIS COMES FROM. GHIS's own Initial Assessment form (opd-emr.js ASSESS_SCHEMA, captured
 * verbatim 2026-08-07) already has a free-text field every doctor fills in on every patient:
 * `Known_allergies_details`. This is not a new capture UI — it reuses data collection that already
 * happens. What was missing was turning it into something wardsynq-safety.js's Allergy Shield can
 * actually check against: AllergyIntolerance.substance has to be a clean drug generic or allergy
 * class name, and free text is neither reliably.
 *
 * THE SAFETY POSTURE, stated once because it governs every decision below: a MISSED allergy (a real
 * one the text mentioned that this file failed to resolve) is a silent gap, no different from today
 * having none at all — acceptable, because nothing regresses. A FABRICATED allergy (resolving text
 * to the WRONG substance, or inventing a severity/reaction the text never stated) actively corrupts
 * the chart and is worse than nothing. Every choice here is biased toward the first failure mode,
 * never the second:
 *   - Resolution reuses wardsynq-safety.js's OWN resolveGeneric() — "deliberately conservative:
 *     exact token matching only, no fuzzy matching, no stemming" (its own words). Nothing here adds
 *     fuzzier matching on top.
 *   - A fragment that does not resolve is still recorded (substance:"unspecified",
 *     reportedText: the verbatim fragment) so it is visible on the chart to a human, but it cannot
 *     silently be mistaken for something the automated check verified — an unresolved substance
 *     matches nothing in checkAllergies() by construction.
 *   - severity/reaction/criticality are NEVER inferred from free text. Every entry this file writes
 *     carries severity:"unknown", verifiedBy:null (never auto-verified) — exactly the same
 *     "unable-to-assess" posture a human would take reading an unconfirmed line item. A DOCTOR
 *     explicitly confirming a structured allergy remains a separate, not-yet-built feature.
 *   - An explicit denial ("NKDA", "no known allergies", ...) writes NOTHING — recording an allergy
 *     entry for a patient who was asked and denied would itself be a fabrication.
 *
 * ONE ENTRY PER (patient, substance-or-fragment), STABLE ID. Re-saving the same assessment text is
 * idempotent (sameAllergy() + expectedVersion, the same pattern every sibling migrate-*.js uses);
 * editing the text to REMOVE a previously-reported allergy does not retract its prior version - this
 * store is append-only everywhere, and a "no longer relevant" allergy staying on the versioned
 * record (visibly superseded, never silently gone) is the same trade-off already accepted for every
 * other resource here.
 *
 * SCOPE: wardsynq-native assessment saves only, not GHIS-shadow tenants (even ones the owner has set
 * to "authoritative" for their own reasons) and not sign-off (which carries no vals at all).
 */
import { AllergyIntolerance } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { resolveGeneric } from "../../wardsynq/wardsynq-safety.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForTicket } from "./opd-identity.js";

const DENIAL_RE = /\b(nkda|no\s+known\s+(drug\s+)?allerg|none\s+known|denies?\s+(any\s+)?allerg|nil\s+known|no\s+allerg)/i;

function slug(v) { return String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

/** PURE. Splits a free-text allergy note into candidate fragments — never more than a handful. */
function splitCandidates(text) {
  return String(text || "")
    .split(/[,;\n]+|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * PURE. Tries to resolve one fragment to a KNOWN substance/class in the pack. Whole-fragment first
 * (multi-word generics), then individual words — same conservative resolveGeneric() the interaction
 * checker already uses, plus a check against the pack's own allergy-class vocabulary (e.g.
 * "penicillins", "nsaids"), including simple plural/singular leniency on that vocabulary ONLY —
 * still exact membership, never a fuzzy guess.
 */
function resolveAllergySubstance(fragment, pack) {
  const whole = resolveGeneric(fragment, pack);
  if (whole) return whole;
  const words = fragment.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
  const members = pack && pack.allergyMembers;
  for (const w of words) {
    const g = resolveGeneric(w, pack);
    if (g) return g;
    if (members) {
      if (members.has(w)) return w;
      if (w.endsWith("s") && members.has(w.slice(0, -1))) return w.slice(0, -1);
      if (members.has(w + "s")) return w + "s";
    }
  }
  return null;
}

/**
 * PURE. `{raw, denies, entries: [{reportedText, substance, resolved}]}`. `denies:true` means the
 * text explicitly says no known allergies — entries is always empty in that case, on purpose.
 */
function parseAllergyFreeText(text, pack) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return { raw: "", denies: false, entries: [] };
  if (DENIAL_RE.test(raw)) return { raw, denies: true, entries: [] };
  const seen = new Set();
  const entries = [];
  for (const fragment of splitCandidates(raw)) {
    const substance = resolveAllergySubstance(fragment, pack);
    const key = substance || ("unresolved:" + fragment.toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ reportedText: fragment, substance: substance || "unspecified", resolved: !!substance });
  }
  return { raw, denies: false, entries };
}

/** Stable per (patient, substance-or-text) id — re-saving the same fragment is idempotent. */
function allergyId(patientId, entry) {
  const key = entry.resolved ? entry.substance : entry.reportedText;
  return `opd-alg-${slug(patientId)}-${slug(key)}`;
}

/** PURE. The same substance, reported the same way. */
function sameAllergy(a, b) {
  if (!a || !b) return false;
  return a.patientId === b.patientId && a.substance === b.substance && (a.reportedText || "") === (b.reportedText || "");
}

/**
 * Writes 0..N AllergyIntolerance entries from one assessment's Known_allergies_details field. Never
 * throws, and one bad entry never sinks the rest. ctx: { migration, ticket, vals, actorDeps,
 * recordDeps, rulePack }.
 */
async function recordAllergiesFromAssessment(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const text = ctx.vals && ctx.vals.Known_allergies_details;
  const parsed = parseAllergyFreeText(text, ctx.rulePack);
  if (!parsed.raw) return { ...base, ok: true, skipped: "no_text", written: 0 };
  if (parsed.denies) return { ...base, ok: true, skipped: "denies", written: 0 };
  if (!parsed.entries.length) return { ...base, ok: true, skipped: "no_candidates", written: 0 };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0 };
  }

  const patientId = patientIdForTicket(ctx.ticket);
  if (!patientId) return { ...base, ok: false, status: 422, error: "no_patient_identity", written: 0, actor: resolved.actor.id };

  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });

  let written = 0;
  const entries = [];
  for (const entry of parsed.entries) {
    const id = allergyId(patientId, entry);
    const candidate = AllergyIntolerance({
      id, patientId,
      substance: entry.substance,
      substanceCodeSystem: entry.resolved ? "wardsynq-text-derived" : "unresolved-free-text",
      severity: "unknown", criticality: "unable-to-assess", verifiedBy: null,
      source: { system: "wardsynq-native", sourceId: `opd-allergy:${id}` },
    });
    candidate.reportedText = entry.reportedText;   // bolted on, the pattern every sibling migration uses

    let current;
    try { current = await svc.get("AllergyIntolerance", id); } catch (e) { entries.push({ id, error: "record_read_failed" }); continue; }
    if (current && sameAllergy(current, candidate)) { entries.push({ id, skipped: "unchanged", version: current.version }); continue; }
    try {
      const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined });
      written += 1;
      entries.push({ id, written: 1, resolved: entry.resolved, version: out.record.version });
    } catch (e) {
      const code = e instanceof GovernanceError ? "governance" : e instanceof VersionConflictError ? "version_conflict" : "record_write_failed";
      entries.push({ id, error: code });
    }
  }
  return { ...base, ok: true, written, entries, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
}

export { parseAllergyFreeText, resolveAllergySubstance, sameAllergy, allergyId, recordAllergiesFromAssessment };
