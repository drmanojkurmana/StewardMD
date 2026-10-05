/* functions/_wardsynq/migrate-emar.js — the wire between the eMAR state machine and the record.
 *
 * `wardsynq/wardsynq-meds.js` has existed, tested, since P0: the ORDERED -> VERIFIED -> DISPENSED ->
 * SCANNED -> ADMINISTERED lifecycle, the legal-transition table, the five rights, the high-alert
 * witness rule. The 2026-09-07 audit found nothing called it, and that `MedicationAdministration`
 * had zero write paths anywhere in the repository. This file is that call, and only that call.
 *
 * WHAT THIS FILE DOES NOT DO, ON PURPOSE:
 *   - it does not re-implement a single check. Every gate below is `MedicationAdministrationRecord`'s
 *     own. A competing bedside check in the server layer is how the two drift and the weaker one wins.
 *   - it does not walk the chain for you. Each transition is a separate, authenticated, audited call
 *     by a real actor. Nothing here turns an order into an administered dose in one step, which is
 *     precisely the failure the state machine was built to make impossible.
 *   - it does not invent a dose, a schedule or a formulary. `dueAt` comes from the caller; the
 *     high-alert list is hospital configuration, injected, not a constant in this file.
 *
 * PERSISTENCE. Every transition writes a new VERSION of one MedicationAdministration through the
 * governed store, so the lifecycle is the resource's own append-only history rather than a status
 * column someone overwrote. Read it back and you can see who scanned, who gave it, and when.
 *
 * DUPLICATE DOSES. `medicationAdministrationIdFor(orderId, dueAt)` is deterministic, so a retried or
 * double-tapped administration lands on the SAME record — which the state machine then refuses,
 * because ADMINISTERED has no legal transition out of it. Prevention is identity plus the existing
 * machine, not a new guard that could disagree with either.
 *
 * SAFETY AT THE BEDSIDE. `safetyCheck` is wired to the SAME SafetyEngine the prescriber's pre-check
 * uses (wardsynq-safety.js via rulepack.js), reading the patient's own recorded allergies and active
 * orders. The engine's `hook()` decides; this file only passes the verdict through. Note the machine
 * defaults `safetyCheck` to fail-closed when none is supplied - that default is deliberate and is
 * left alone; supplying the real engine is what makes the ward usable rather than what weakens it.
 */

import { MedicationAdministrationRecord, STATES, TERMINAL, MedicationSafetyError, materialOrderChanges } from "../../wardsynq/wardsynq-meds.js";
import { SafetyEngine, resolveComponents } from "../../wardsynq/wardsynq-safety.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { weightInKg } from "../../wardsynq/wardsynq-vitals.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { medicationAdministrationIdFor } from "./opd-identity.js";
import { roundOrders, doseTimeRefusal } from "./mar-schedule.js";
import { witnessOrRefusal } from "./controlled-drugs.js";
import { readPregnancyLactation } from "./migrate-maternity.js";
import { CREATININE_CODES } from "./radiology-protocol.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** The transitions this route exposes, and the machine method each one is. */
const ACTIONS = Object.freeze(["verify", "dispense", "scan", "administer", "hold", "refuse", "cancel"]);

/* LOINC body weight, the code migrate-vitals.js already writes for the `weight` field. Named here
 * rather than re-derived so the ward and the vitals mapper cannot disagree about what a weight is. */
const BODY_WEIGHT_LOINC = "29463-7";

/* Codex F6, owner decision 2026-10-04: the LOINC codes for an estimated GFR, read as the laboratory reported it. Nothing here
 * computes an eGFR from a creatinine (radiology-protocol.js says why). EGFR_CODES is the accepted list in PREFERENCE order:
 * 98979-8 (CKD-EPI 2021 creatinine, the modern code) first, then the other active codes (62238-1 older CKD-EPI, 77147-7 MDRD
 * generic, 69405-9 GFR per 1.73 m2), then the legacy group last. The preference only breaks a tie between results of the same
 * draw; it never lets an older value beat a newer one. */
const EGFR_CODES = Object.freeze(["98979-8", "62238-1", "77147-7", "69405-9", "50044-7", "48642-3", "48643-1", "88293-6", "88294-4"]);
/* 33914-3 is discouraged by LOINC and maps to 77147-7: accepted on the way in, reported as 77147-7. */
const EGFR_ALIASES = Object.freeze({ "33914-3": "77147-7" });
/* Race-specific (48642-3, 48643-1, 88293-6, 88294-4) and population-specific (50044-7, MDRD female) equations. Accepted as
 * incoming history; StewardMD never generates or prefers them, and a result from one is flagged so a clinician can see it. */
const EGFR_LEGACY_CODES = Object.freeze(new Set(["50044-7", "48642-3", "48643-1", "88293-6", "88294-4"]));
/* An eGFR or creatinine older than this is shown with its age and is NOT used by the renal check. Seven days is the age at
 * which radiology-protocol.js already tells a radiologist a creatinine "describes the patient then, not now"; it is not a
 * clinical threshold this file invents, and it is listed for the owner to confirm. */
const RENAL_STALE_DAYS = 7;

/** PURE. The newest result with one of `codes`, with its unit, time and age, or null. Never a number without a date.
 * `opts` ({ aliases, legacy }) is for eGFR: a code in `aliases` is read as the code it maps to, the result is ranked by its
 * position in `codes` (the preference order) when several share the newest time, and a result from the `legacy` set carries
 * legacy: true. Without `opts` the order of `codes` means nothing, as before. */
function latestLab(observations, codes, nowMs, opts) {
  const aliases = (opts && opts.aliases) || {};
  const norm = (c) => (Object.prototype.hasOwnProperty.call(aliases, c) ? aliases[c] : c);
  const rank = (c) => (opts ? codes.indexOf(c) : 0);
  const rows = (observations || []).filter((o) => o && codes.includes(norm(str(o.code))) && Number.isFinite(Number(o.value)) && o.value !== "" && o.value !== null)
    .map((o) => ({ value: Number(o.value), unit: o.unit || null, at: (o.meta && o.meta.effectiveAt) || o.effectiveAt || null, code: norm(str(o.code)) }))
    .filter((o) => Number.isFinite(Date.parse(str(o.at))))
    .sort((a, b) => (Date.parse(b.at) - Date.parse(a.at)) || (rank(a.code) - rank(b.code)));
  if (!rows.length) return null;
  const ageDays = Math.max(0, Math.floor((nowMs - Date.parse(rows[0].at)) / 86400000));
  return { ...rows[0], ageDays, stale: ageDays >= RENAL_STALE_DAYS, ...(opts && opts.legacy && opts.legacy.has(rows[0].code) ? { legacy: true } : {}) };
}

/** PURE. The renal facts the order check is given: latest eGFR and creatinine, or null when the Observations were unreadable. */
function renalFrom(observations, nowMs) {
  if (observations === null) return null;
  return { egfr: latestLab(observations, EGFR_CODES, nowMs, { aliases: EGFR_ALIASES, legacy: EGFR_LEGACY_CODES }), creatinine: latestLab(observations, CREATININE_CODES, nowMs) };
}

/** The patient's most recently recorded weight in kg, or undefined when the ward has not weighed them. */
function latestWeightKg(obs) {
  const weights = (obs || [])
    /* THROUGH THE ONE CONVERSION, never a bare number. This required unit === "kg" and was safe
     * only because kg was the single unit the recorder could produce; now that a US ward can chart
     * pounds, a filter would silently drop that patient's weight and a bare read would be 2.2
     * times wrong. weightInKg is exact for kg and pounds and returns null for anything else, so an
     * unreadable unit still means "the ward has not weighed them" rather than a wrong number. */
    .filter((o) => o && o.code === BODY_WEIGHT_LOINC && weightInKg(o.value, o.unit) !== null)
    .sort((a, b) => String((b.meta && b.meta.effectiveAt) || "").localeCompare(String((a.meta && a.meta.effectiveAt) || "")));
  return weights.length ? weightInKg(weights[0].value, weights[0].unit) : undefined;
}

/**
 * The bedside safety hook, backed by the patient's REAL record: their documented allergies, their
 * currently active medication orders and their recorded weight. Never throws — a hook that throws
 * would surface as a server error rather than as the machine's own refusal, losing the reasons the
 * nurse needs to act on.
 */
/* What the engine is asked about, read from the patient's record: their allergies, their OTHER active
 * orders and their latest weight. One reader for the bedside hook and for order entry, so the check a
 * prescriber sees and the check the nurse's scan runs can never read different facts. */
async function safetyFacts(svc, order) {
  const patientId = order && order.patientId;
  // No catch: an unreadable allergy list or medication list is not an empty one. The callers turn the
  // throw into "the check could not run" instead of a clean check against no allergies.
  const [allergies, orders, encounters] = await Promise.all([
    svc.byPatient("AllergyIntolerance", patientId),
    svc.byPatient("MedicationOrder", patientId),
    // Which stays are over, read under the service as in roundOrders(): only used to leave their orders out.
    svc.repository ? svc.repository.byPatient(svc.tenantId, "Encounter", patientId) : svc.byPatient("Encounter", patientId),
  ]);
  /* CLIN-04: the checks read the orders of THIS stay, plus the patient's home medicines. An order left active on
   * another stay (a past admission, before discharge stopped them) is not a medicine given on this one, and a
   * months-old inpatient course must not raise a duplicate or a cumulative-dose block on a new admission. There is
   * no home/long-term flag on an order: the OPD prescriptions are the home medicines, and every active one is still
   * read, as before. An order whose stay cannot be found is read too; leaving it out is the unsafe direction. */
  const otherStays = new Set((encounters || []).filter((e) => e && e.class !== "OPD" && e.id !== (order && order.encounterId)).map((e) => e.id));
  const activeMeds = (orders || [])
    .filter((o) => o && o.status === "active" && o.id !== (order && order.id) && !otherStays.has(o.encounterId))
    .map((o) => ({ drug: o.drug, drugCode: o.genericName || o.drugCode, dose: o.dose || null, frequency: o.frequency || null }));
  /* The patient's OWN recorded weight, from the ward vitals, because a weight-based ceiling
   * cannot be checked without one — the engine blocks with DOSE_WEIGHT_MISSING, which is the
   * "a weight-based drug on an unweighed patient refuses rather than passes" invariant and is
   * correct. It is read from the record rather than taken from the request body on purpose: a
   * client-supplied weight is a number that can be typed to make a ceiling pass. If the ward has
   * not weighed the patient there is nothing to send, and the block stands. */
  // One Observation read for the weight and the renal function. Unreadable is null: no weight (as before) and renal unknown.
  let observations = null;
  try { observations = (await svc.byPatient("Observation", patientId)) || []; } catch { observations = null; }
  const weightKg = latestWeightKg(observations);
  return { allergies: allergies || [], activeMeds, weightKg, renal: renalFrom(observations, Date.now()) };
}

/* CLIN-12: a finding the prescriber already answered at order entry (safetyAtOrder, overridden with a reason)
 * is not re-asked at every bedside scan with no way for the nurse to answer it. It is cleared to a warning, so the
 * nurse still sees it. Only the SAME finding is cleared: matched by rule or allergy id where the order recorded
 * one, else by its exact words, so a new interaction or a new allergy since the order still stops the scan. */
function withOrderDecisions(verdict, order, extraWarnings) {
  const sao = order && order.safetyAtOrder;
  const decided = sao && sao.checked && sao.reason ? (sao.findings || []).filter((f) => f && f.overridden) : [];
  const isDecided = (b) => b.requiresOverride && decided.some((d) => d.code === b.code
    && (d.ruleId || d.allergyId ? (!!d.ruleId && d.ruleId === b.ruleId) || (!!d.allergyId && d.allergyId === b.allergyId) : d.message === b.message));
  const cleared = verdict.blocks.filter(isDecided);
  const blocks = verdict.blocks.filter((b) => !isDecided(b));
  return { ...verdict, allowed: blocks.length === 0, blocks,
    warnings: verdict.warnings.concat(cleared.map((b) => ({ code: b.code, severity: b.severity, disposition: "warn", message: b.message, overriddenAtOrder: true, reason: sao.reason })), extraWarnings || []) };
}

/* CLIN-20: a pharmacist's open query on this version of the order is said at the bedside. Read under the service
 * (a nurse may not hold the verification grant); an unreadable list is said too, never read as "no query". */
async function pharmacyQueryWarning(svc, order) {
  try {
    const rows = ((await svc.repository.byPatient(svc.tenantId, "MedicationVerification", order.patientId)) || [])
      .filter((v) => v && v.orderId === order.id && Number(v.orderVersion) === Number(order.version) && v.outcome === "queried");
    return rows.map((v) => ({ code: "PHARMACY_QUERY_OPEN", disposition: "warn", message: `The pharmacist has queried this order: ${v.reason || "no reason given"}. Check with the prescriber before giving.` }));
  } catch (e) {
    return [{ code: "PHARMACY_QUERY_UNKNOWN", disposition: "warn", message: "Whether the pharmacist has queried this order could not be read." }];
  }
}

/* Codex F5: A CHECK THAT DID NOT RUN STOPS THE DOSE, unless a named clinician continues with a reason. It used to come back
 * allowed with a warning, so a failed allergy read moved through the scan exactly like a clean check. Refused by default
 * now (a block with checkNotRun: true, so a screen can ask for the reason); `continuation` {reason, by} is that reason,
 * attributed by the caller to the signed-in actor, and turns the refusal into a warning plus `notRun`, which the eMAR keeps
 * on the record as safetyNotRun and the round shows. It is never a clean verdict: the warning still says nothing ran. */
function checkNotRun(code, detail, continuation) {
  const message = `The allergy, interaction and dose checks could not run${detail ? ` (${detail})` : ""}.`;
  const reason = str(continuation && continuation.reason).slice(0, 500);
  if (!reason || !str(continuation && continuation.by)) {
    return { allowed: false, warnings: [],
      blocks: [{ code, disposition: "block", checkNotRun: true, message: `${message} Give a reason to continue without them, or wait until they can run.` }] };
  }
  const at = new Date().toISOString();
  return { allowed: true, blocks: [],
    warnings: [{ code, disposition: "warn", checkNotRun: true, message: `${message} Continued without them: ${reason}` }],
    notRun: { code, message, reason, by: str(continuation.by), at } };
}

function bedsideSafetyCheck(svc, rulePack, opts) {
  const continuation = opts && opts.continuation;
  return async (hookCtx) => {
    if (!rulePack) return checkNotRun("NO_RULE_PACK", "no decision-support content is loaded", continuation);
    try {
      const order = hookCtx && hookCtx.order;
      const { allergies, activeMeds, weightKg } = await safetyFacts(svc, order);
      const engine = new SafetyEngine({ rulePack });
      // Carried ON the patient, not as a sibling field: hook() forwards order/patient/allergies/
      // activeMeds/overrides to evaluate() and nothing else, while evaluate() reads
      // `ctx.weightKg ?? patient.weightKg`. Attaching it here is what makes the ceiling checkable
      // without widening the engine's own hook signature.
      const patient = { ...(hookCtx.patient || {}), ...(typeof weightKg === "number" ? { weightKg } : {}) };
      const verdict = engine.hook()({ order, patient, activeMeds, allergies });
      return withOrderDecisions(verdict, order, await pharmacyQueryWarning(svc, order));
    } catch (e) {
      // Could not check. Never "allowed": that is the clean bill of health for a check that never ran (Codex F5).
      return checkNotRun("SAFETY_CHECK_UNAVAILABLE", str(e && e.message) || "decision support unavailable", continuation);
    }
  };
}

/**
 * LT-14: the SAME engine and the SAME record facts at ORDER ENTRY, as the full verdict (findings
 * included, so override analytics can count what fired). `overrides` are the prescriber's, already
 * attributed by the caller. Never throws: a check that could not run says so (checked: false) and is
 * never reported as a clean one.
 */
/* THE FINDINGS ORDER ENTRY REFUSES (retest 2026-09-16). Every other finding is reported and proceeds with the
 * prescriber's reason, because the content is unapproved seed data (see createWardMedicationOrder). A dose
 * above an absolute ceiling is not a judgement the rule content makes: it is arithmetic on the order and the
 * patient's other active orders of the same molecule, and 8 g of paracetamol a day has no reason. Each such
 * finding carries hardStop: true, so a screen labels exactly what the server refuses and nothing else. */
const ORDER_ENTRY_HARD_STOPS = Object.freeze(["DOSE_ABSOLUTE_CEILING", "DOSE_ABSOLUTE_CEILING_DAILY", "DOSE_ABSOLUTE_CEILING_CUMULATIVE"]);

/* Codex F6: WHAT THE ORDER CHECK COULD NOT COVER, SAID AS A FINDING. The engine's renal and pregnancy/lactation checks only
 * fire from loaded tables (getRulePack loads none; order-entry-pack.js adds the signed-off NFI tables) and from the patient's
 * measurements; with either missing they returned nothing, which reads as checked and clean. Disposition "warn", never a
 * block: they report missing content and data, decide nothing clinical, and no table or formula is invented here. */
/* Owner decision 2026-10-04: with the National Formulary of India tables present (`tables` = rulePack.clinicalTables,
 * order-entry-pack.js), an UNSIGNED table says exactly that ("NFI table loaded, awaiting clinical sign-off") and is not used;
 * a SIGNED table that has no entry for the ordered drug says so too, rather than reading as checked. `generics` is what the
 * ordered drug resolved to. Without `tables` (a pack with no NFI tables at all) the wording is as before. */
const NFI_STATE_SAID = Object.freeze({
  "awaiting-signoff": "NFI table loaded, awaiting clinical sign-off",
  "signoffs-unreadable": "NFI table loaded, but its clinical sign-off could not be read, so it was not applied",
});
function coverageFindings(order, renal, renalTable, plRules, pregnancyStatus, tables, generics) {
  const out = [];
  const w = (code, message, extra) => out.push({ code, severity: "moderate", disposition: "warn", message, ...(extra || {}) });
  const lab = (x, name) => `${name} ${x.value}${x.unit ? " " + x.unit : ""} on ${x.at.slice(0, 10)}${x.stale ? `, ${x.ageDays} days old` : ""}`;
  const known = renal ? [renal.egfr && lab(renal.egfr, "eGFR"), renal.creatinine && lab(renal.creatinine, "creatinine")].filter(Boolean) : [];
  const said = known.length ? ` Latest recorded: ${known.join("; ")}.` : "";
  const covers = (t) => (generics || []).some((g) => t.covered && t.covered.has(g));
  const rt = tables && tables.renal;
  if (rt && rt.state !== "signed") w("RENAL_CHECK_NOT_AVAILABLE", `Renal dose check not available: ${NFI_STATE_SAID[rt.state] || NFI_STATE_SAID["awaiting-signoff"]}. ${order.drug} was not checked for renal dosing.${said}`, { table: rt.table, tableState: rt.state });
  else if (rt && !covers(rt)) w("RENAL_CHECK_NOT_COVERED", `Renal dose check: ${order.drug} is not in the NFI renal table, so it was not checked for renal dosing.${said}`, { table: rt.table });
  else if (!rt && !renalTable) w("RENAL_CHECK_NOT_AVAILABLE", `Renal dose check not available: no renal table is loaded, so ${order.drug} was not checked for renal dosing.${said}`);
  if (renal === null) w("RENAL_FUNCTION_UNREADABLE", "The patient's results could not be read, so renal function is unknown. Do not read this as normal.");
  else if (!renal.egfr) w("RENAL_FUNCTION_NOT_RECORDED", `No eGFR is recorded for this patient, so no renal dose check can use one.${renal.creatinine ? ` Latest creatinine: ${lab(renal.creatinine, "").trim()}. Nothing here computes an eGFR from it.` : ""}`);
  else if (renal.egfr.stale) w("RENAL_FUNCTION_STALE", `The latest eGFR is ${renal.egfr.ageDays} days old, so the renal dose check did not use it.`);
  else if (renal.egfr.legacy) w("RENAL_EGFR_LEGACY_EQUATION", `The latest eGFR is from a legacy race-specific or population-specific equation (LOINC ${renal.egfr.code}).`);
  const s = pregnancyStatus || {};
  const recorded = s.pregnant === true ? " The patient is recorded as pregnant." : s.lactating === true ? " The patient is recorded as breastfeeding or within the postpartum lactation window." : "";
  if (tables && tables.pregnancy && tables.lactation) {
    // Only a side the patient's record does not rule out (recorded true, or not recorded) is spoken about.
    const sides = [["pregnancy", "pregnancy", s.pregnant], ["lactation", "breastfeeding", s.lactating]].filter(([, , st]) => st !== false);
    const unsigned = sides.filter(([k]) => tables[k].state !== "signed");
    if (unsigned.length) {
      const st = unsigned.some(([k]) => tables[k].state === "signoffs-unreadable") ? "signoffs-unreadable" : "awaiting-signoff";
      const names = unsigned.map(([k]) => k).join(" and ");
      w("PREGNANCY_LACTATION_CHECK_NOT_AVAILABLE", `${names[0].toUpperCase() + names.slice(1)} check not available: ${NFI_STATE_SAID[st]}. ${order.drug} was not checked for use in ${unsigned.map(([, use]) => use).join(" or ")}.${recorded}`,
        { tables: unsigned.map(([k]) => tables[k].table), tableState: st });
    }
    for (const [k, use, st] of sides) {
      if (st === true && tables[k].state === "signed" && !covers(tables[k])) {
        w("PREGNANCY_LACTATION_NOT_COVERED", `${order.drug} is not in the NFI ${k} table, so no NFI guidance on use in ${use} was applied.${recorded}`, { table: tables[k].table });
      }
    }
  } else if (!plRules && !(s.pregnant === false && s.lactating === false)) {
    w("PREGNANCY_LACTATION_CHECK_NOT_AVAILABLE", `Pregnancy and lactation check not available: no pregnancy or lactation rules are loaded, so ${order.drug} was not checked for use in pregnancy or breastfeeding.${recorded}`);
  }
  return out;
}

/* opts.lactationWindowDays: the hospital's postpartum lactation window (wardsynqConfig). The maternity record is read for
 * every order (Codex F6; it used to be read only when the pack had rules) and `pregnancyLactation.rulesLoaded` is on every
 * verdict, so a screen can say "no pregnancy or lactation rules loaded" beside what is recorded rather than imply a check. */
async function orderEntrySafety(svc, rulePack, order, overrides, opts) {
  if (!rulePack) return { checked: false, code: "NO_RULE_PACK", message: "no decision-support content is loaded; nothing was checked" };
  try {
    const rulesLoaded = rulePack.pregnancyLactation ? rulePack.pregnancyLactation.size : 0;
    const renalTable = rulePack.renalAdjustments ? rulePack.renalAdjustments.size : 0;
    // The maternity record is read whether or not rules are loaded (Codex F6): an empty table is only honest beside what is recorded.
    const [{ allergies, activeMeds, weightKg, renal }, pregnancyStatus] = await Promise.all([
      safetyFacts(svc, order),
      readPregnancyLactation(svc, order && order.patientId, { lactationWindowDays: opts && opts.lactationWindowDays }),
    ]);
    // The eGFR the record holds, with its time, unit and code; a stale one is shown and not used.
    const egfr = renal && renal.egfr && !renal.egfr.stale ? renal.egfr.value : undefined;
    // "same-drug" and "pregnancy" only here: order entry is where a second order of an active molecule, or a
    // medicine in pregnancy or breastfeeding, is decided.
    const v = new SafetyEngine({ rulePack, checks: ["allergy", "interaction", "dose", "renal", "same-drug", "pregnancy"] })
      .evaluate({ order, allergies, activeMeds, weightKg, egfr, pregnancyStatus, overrides: overrides || [] });
    const coverage = coverageFindings(order, renal, renalTable, rulesLoaded, pregnancyStatus, rulePack.clinicalTables || null,
      rulePack.clinicalTables ? resolveComponents(order.drugCode || order.drug, rulePack) : []);
    const pick = (f) => ({ code: f.code, severity: f.severity || null, disposition: f.disposition, message: f.message || "",
      ...(f.ruleId ? { ruleId: f.ruleId } : {}), ...(f.allergyId ? { allergyId: f.allergyId } : {}), ...(f.overridden ? { overridden: true } : {}),
      ...(f.disposition === "block" && ORDER_ENTRY_HARD_STOPS.includes(f.code) ? { hardStop: true } : {}) });
    const blocks = v.blocks.map(pick);
    return {
      checked: true, rulePackVersion: v.rulePackVersion, allowed: v.allowed,
      blocks, overridables: v.overridables.map(pick), warnings: v.warnings.map(pick), findings: v.findings.map(pick),
      hardStops: blocks.filter((f) => f.hardStop),
      unresolvedDrug: v.unresolvedDrug, unresolvedActiveMeds: v.unresolvedActiveMeds || [],
      pregnancyLactation: { rulesLoaded, ...(pregnancyStatus || {}) },
      /* Codex F6: what the check could NOT cover, apart from the engine's findings: it is not a rule firing (override
       * analytics count only those) and it must not turn every order into one that needs a reason. */
      coverage,
      // Codex F6: the measurements the renal check was given (null = the results could not be read).
      renal: { tableLoaded: renalTable, egfr: renal ? renal.egfr : null, creatinine: renal ? renal.creatinine : null, ...(renal ? {} : { unreadable: true }) },
      // Owner decision 2026-10-04: each NFI table and whether it is signed off (only a signed table is applied).
      ...(rulePack.clinicalTables ? { clinicalTables: { source: rulePack.clinicalTables.source, renal: rulePack.clinicalTables.renal.state, pregnancy: rulePack.clinicalTables.pregnancy.state, lactation: rulePack.clinicalTables.lactation.state } } : {}),
    };
  } catch (e) {
    return { checked: false, code: "SAFETY_CHECK_UNAVAILABLE", message: str(e && e.message) || "decision support unavailable" };
  }
}

/** Builds the governed service, or a shaped refusal. Never throws. */
async function openService(request, env, ctx, need) {
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

/**
 * The medication round: every active order for this patient with whatever administration record
 * already exists for the named dose time. This is what "what is due" means — the orders, plus what
 * has already happened to them this round. It computes no schedule and invents no due times.
 *
 * ctx: { migration, patientId, dueAt, actorDeps, recordDeps }
 */
async function medicationRound(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", due: [] };

  const patientId = str(ctx.patientId);
  const dueAt = str(ctx.dueAt);
  if (!patientId || !dueAt) return { ...base, ok: false, status: 422, error: "patient_and_dueAt_required", due: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, due: [] };

  let orders;
  try { orders = await roundOrders(svc, patientId); } // CLIN-04: this stay's orders only
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), due: [] }; }

  const due = [];
  let unread = 0;
  for (const o of orders) {
    const marId = medicationAdministrationIdFor(o.id, dueAt);
    let mar = null, readFailed = false;
    /* A failed read is NOT "not started". Reporting it as null invited a second dose of something
     * already given. */
    try { mar = marId ? await svc.get("MedicationAdministration", marId) : null; } catch { readFailed = true; unread += 1; }
    due.push({
      orderId: o.id, orderVersion: o.version == null ? null : o.version, drug: o.drug, dose: o.dose || null, route: o.route || null, frequency: o.frequency || null,
      administrationId: marId,
      ...(readFailed ? { readFailed: true } : {}),
      status: readFailed ? "unknown" : mar ? mar.status : null,          // null = this dose has not been started
      administeredAt: (mar && mar.administeredAt) || null,
      administeredBy: (mar && mar.administeredBy) || null,
    });
  }
  return { ...base, ok: true, patientId, dueAt, due, ...(unread ? { incomplete: true, warning: `${unread} dose record${unread === 1 ? "" : "s"} could not be read. Check the chart before giving ${unread === 1 ? "that dose" : "those doses"}.` } : {}) };
}

/**
 * One governed transition of one dose.
 *
 * ctx: { migration, action, orderId, dueAt, patient, scan?, reason?, witnessId?, rulePack?,
 *        highAlertDrugs?, expectedOrderVersion?, uncheckedReason?, actorDeps, recordDeps }
 */
async function administerStep(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const action = str(ctx.action);
  const orderId = str(ctx.orderId);
  const dueAt = str(ctx.dueAt);
  if (!ACTIONS.includes(action)) return { ...base, ok: false, status: 400, error: "unknown_action", detail: `action must be one of ${ACTIONS.join(", ")}` };
  if (!orderId || !dueAt) return { ...base, ok: false, status: 422, error: "order_and_dueAt_required" };

  const marId = medicationAdministrationIdFor(orderId, dueAt);
  if (!marId) return { ...base, ok: false, status: 422, error: "bad_identifiers" };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  // The order is the authority for what may be given. Read it from the record, never from the body:
  // a client-supplied drug or dose is exactly the wrong-drug/wrong-dose path the rights check exists
  // to close, and trusting the body would walk straight around it.
  let order, existing;
  try {
    order = await svc.get("MedicationOrder", orderId);
    existing = await svc.get("MedicationAdministration", marId);
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
  }
  if (!order) return { ...base, ok: false, status: 404, error: "order_not_found", orderId };
  /* A RETRY IS ANSWERED WITH WHAT IT ALREADY DID, BEFORE THE STATE MACHINE IS ASKED AGAIN.
   * Asked again, the machine refuses "administer" on a dose that is already administered, and a
   * device replaying its offline queue after a lost response would tell the nurse a recorded dose
   * was refused. The key is bound to this patient and this dose; anything else is a refusal. */
  if (ctx.idempotencyKey) {
    let prior = null;
    try { prior = await svc.replayFor(ctx.idempotencyKey, "MedicationAdministration", order.patientId, marId); }
    catch (e) {
      if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "idempotency_conflict", detail: "this request key already recorded a different dose", orderId, administrationId: marId, written: 0 };
      return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
    }
    if (prior && prior.record && prior.record.id !== marId) {
      return { ...base, ok: false, status: 409, error: "idempotency_conflict", detail: "this request key already recorded a different dose", orderId, administrationId: marId, written: 0 };
    }
    if (prior && prior.record) {
      const rec = prior.record;
      return { ...base, ok: true, written: 0, replayed: true, action, to: rec.status, orderId, administrationId: marId,
        patientId: order.patientId, encounterId: order.encounterId || null, administeredBy: rec.administeredBy || null,
        administeredAt: rec.administeredAt || null, witnessedBy: rec.witnessedBy || null, version: rec.version, actor: resolved.actor.id, role: resolved.role };
    }
  }
  if (order.status !== "active") return { ...base, ok: false, status: 409, error: "order_not_active", orderId, orderStatus: order.status };
  /* G2: THE ORDER THE NURSE SAW IS THE ORDER THE DOSE IS RECORDED AGAINST. A dose charted on a device while
   * offline reaches here minutes or hours later; if the prescriber changed the order meanwhile, recording it
   * against the new dose, route or frequency would chart something nobody gave. So a caller that names the
   * order version it acted on is refused when that is no longer the order, and shown the order as it is now.
   * A stopped order is refused above, before this. A retry of a dose already recorded was answered above too. */
  if (ctx.expectedOrderVersion !== undefined && ctx.expectedOrderVersion !== null && ctx.expectedOrderVersion !== "" && Number(ctx.expectedOrderVersion) !== Number(order.version)) {
    return { ...base, ok: false, status: 409, error: "order_changed", detail: "this order changed after the dose was charted; nothing was recorded", orderId, administrationId: marId, written: 0,
      expectedOrderVersion: Number(ctx.expectedOrderVersion), currentVersion: order.version,
      current: { drug: order.drug || null, dose: order.dose || null, route: order.route || null, frequency: order.frequency || null, status: order.status, version: order.version } };
  }

  // Wrong-patient prevention, before any state is touched: the patient the ward says it is holding
  // must be the patient the ORDER names. The five rights check this again at the bedside against the
  // scanned wristband; this is the same question asked of the record rather than of the scan.
  const patient = ctx.patient || null;
  if (!patient || !patient.id) return { ...base, ok: false, status: 422, error: "patient_required" };
  if (patient.id !== order.patientId) {
    return { ...base, ok: false, status: 409, error: "wrong_patient", detail: "this order belongs to a different patient", orderId, orderPatientId: order.patientId, presentedPatientId: patient.id };
  }

  /* CLIN-11: the wristband the scan must match is the PATIENT RECORD's, never one the request names. The body
   * only says which patient the ward thinks it holds (checked against the order above). */
  let bedsidePatient = { id: order.patientId };
  if (action === "scan") {
    let rec;
    try { rec = await svc.get("Patient", order.patientId); }
    catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), orderId, written: 0 }; }
    if (!rec) return { ...base, ok: false, status: 409, error: "patient_not_found", detail: "the patient this order belongs to has no record to check the wristband against", orderId, written: 0 };
    bedsidePatient = { id: order.patientId, mrn: rec.mrn || null, wristbandBarcode: rec.wristbandBarcode || null };
  }

  /* Codex F5: the scanning nurse's reason to continue when the safety check could not run, attributed here to the
   * signed-in actor (never to anyone the body names) and kept on the dose record as safetyNotRun. */
  const uncheckedReason = action === "scan" ? str(ctx.uncheckedReason).slice(0, 500) : "";
  const emar = new MedicationAdministrationRecord({
    safetyCheck: bedsideSafetyCheck(svc, ctx.rulePack, { continuation: uncheckedReason ? { reason: uncheckedReason, by: resolved.actor.id } : null }),
    highAlertDrugs: ctx.highAlertDrugs || [],
    // CLIN-11: the right-time check runs against this dose's due time; a late dose is charted as late, never early.
    allowLate: true,
  });

  let record = existing;
  if (!record) {
    // CLIN-11: a new dose record only at a time the order schedules (the round's own slots), never an arbitrary one.
    const off = doseTimeRefusal(order, dueAt, ctx.schedule, Date.now(), 60);
    if (off) return { ...base, ok: false, status: 409, error: "not_a_scheduled_dose", detail: off, orderId, dueAt, written: 0 };
    if (action !== "verify" && action !== "cancel" && action !== "hold") {
      // A dose has to start at the beginning. Refusing here is what stops an "administer" call on an
      // order that nobody verified or dispensed from quietly creating a record already at the end.
      return { ...base, ok: false, status: 409, error: "dose_not_started", detail: "this dose has no administration record yet; verify it first", orderId, administrationId: marId };
    }
    record = emar.open(order);
    record.id = marId;                       // deterministic, so a retry is the same dose
    record.encounterId = order.encounterId || null;
    /* WHEN THE DOSE WAS DUE. It was in the id and nowhere else, so the record could say a dose was
     * given and could not say whether it was given late - and "was this dose on time" is a question
     * a ward has to be able to answer about its own eMAR. Recovering it by parsing the id back would
     * be guessing at a slug; this is the value the caller actually passed. */
    record.dueAt = dueAt;
  }

  const before = record.status;
  /* Codex F3: EVERY CHECK ON A DOSE IS BOUND TO THE ORDER IT WAS DONE AGAINST. expectedOrderVersion (G2, above) only
   * catches a stale screen; a round reloaded after the amendment carries the new version and passed it, so a dose scanned
   * under v1 could be given under v2. Whatever the caller sends, a clinically material change since this dose was
   * verified, dispensed or scanned (wardsynq-meds.js materialOrderChanges) refuses the next step and nothing is written.
   * Verifying again is the way on: it voids the earlier checks on the record (back to ORDERED, rebound to the order as it
   * is now, audited) and verifies, so dispensing and the bedside scan are done again against the new order. */
  if (existing && !TERMINAL.includes(existing.status) && ["verify", "dispense", "scan", "administer"].includes(action)) {
    const changed = materialOrderChanges(existing.orderSnapshot, order);
    if (changed.length && action !== "verify") {
      return { ...base, ok: false, status: 409, error: "order_changed_recheck", action, from: before, changed, orderId, administrationId: marId, written: 0,
        detail: `This order was changed (${changed.join(", ")}) after this dose was verified, dispensed or scanned. Verify it again, then dispense and scan it against the order as it is now. Nothing was recorded.`,
        checkedUnderVersion: (existing.orderSnapshot && existing.orderSnapshot.version) ?? null, currentVersion: order.version,
        current: { drug: order.drug || null, dose: order.dose || null, route: order.route || null, frequency: order.frequency || null, status: order.status, version: order.version } };
    }
    if (changed.length) emar.invalidateForAmendedOrder(record, order, resolved.actor.id);
  }
  /* A CONTROLLED DRUG IS GIVEN IN FRONT OF A SECOND PERSON (controlled-drugs.js), whatever the high-alert list says.
   * Stricter than the high-alert witness below: the witness must also be an active member of this hospital who may
   * witness one, checked by the route, because this dose is a line in the NDPS register. Refused before the machine
   * runs, so nothing is written. */
  /* CLIN-18: a HIGH-ALERT dose's witness is checked the same way when one is named (the machine below refuses
   * one that is missing or is the nurse); before, any string other than the nurse's own id passed. */
  const controlledDose = typeof ctx.isControlled === "function" && ctx.isControlled(order.drug, order.drugCode) === true;
  let witnessId = str(ctx.witnessId) || null;
  /* CLIN-18: a bedside witness (high-alert or controlled) AUTHENTICATES: they enter their own staff PIN on this device
   * and it is verified before anything is recorded (witness-auth.js). A typed identifier alone is refused. */
  // The nurse naming herself is refused below as not independent, before anyone's PIN is tried.
  if (action === "administer" && witnessId && (controlledDose || emar.isHighAlert(order)) && witnessId.toLowerCase() !== str(resolved.actor.id).toLowerCase()) {
    if (typeof ctx.witnessPinCheck !== "function") {
      return { ...base, ok: false, status: 502, error: "witness_check_unavailable", detail: "The witness could not be checked, so nothing was recorded.", orderId, administrationId: marId, written: 0 };
    }
    let pinR;
    try { pinR = await ctx.witnessPinCheck(witnessId, ctx.witnessPin); }
    catch (e) { return { ...base, ok: false, status: 502, error: "witness_check_failed", detail: "The witness could not be checked, so nothing was recorded.", orderId, administrationId: marId, written: 0 }; }
    if (!pinR || !pinR.ok) {
      return { ...base, ok: false, status: 409, error: "refused", action, from: existing ? existing.status : null, orderId, administrationId: marId, actor: resolved.actor.id, written: 0,
        reasons: [{ code: String((pinR && pinR.error) || "witness_pin_wrong").toUpperCase(), message: (pinR && pinR.detail) || "The witness's PIN is not right." }],
        detail: (pinR && pinR.detail) || "The witness's PIN is not right.", ...(pinR && pinR.attemptsLeft != null ? { attemptsLeft: pinR.attemptsLeft } : {}) };
    }
    witnessId = pinR.identity;
  }
  if (action === "administer" && (controlledDose || (emar.isHighAlert(order) && witnessId))) {
    const w = await witnessOrRefusal({ ...ctx, witnessId }, resolved.actor.id);
    if (w.error) {
      return { ...base, ok: false, status: w.error.status === 502 ? 502 : 409, error: w.error.status === 502 ? w.error.error : "refused", action, from: before,
        reasons: [{ code: String(w.error.error).toUpperCase(), message: w.error.detail }], detail: w.error.detail, orderId, administrationId: marId, actor: resolved.actor.id, written: 0 };
    }
  }
  try {
    if (action === "verify") await emar.transition(record, STATES.VERIFIED, { actorId: resolved.actor.id });
    else if (action === "dispense") await emar.transition(record, STATES.DISPENSED, { actorId: resolved.actor.id });
    else if (action === "scan") await emar.scan(record, { order, patient: bedsidePatient, nurseId: resolved.actor.id,
      // The due time and the moment of the scan are the server's, never the device's.
      scan: { ...(ctx.scan || {}), scheduledAt: dueAt, at: new Date().toISOString() } });
    else if (action === "administer") await emar.administer(record, { order, nurseId: resolved.actor.id, witnessId });
    else if (action === "hold") await emar.hold(record, resolved.actor.id, str(ctx.reason));
    else if (action === "refuse") await emar.refuse(record, resolved.actor.id, str(ctx.reason));
    else if (action === "cancel") await emar.cancel(record, resolved.actor.id, str(ctx.reason));
  } catch (e) {
    if (e instanceof MedicationSafetyError) {
      // The machine refused: five rights, safety engine, illegal transition, missing witness. Its
      // reasons are the answer — they are what the nurse has to act on.
      return { ...base, ok: false, status: 409, error: "refused", action, from: before, reasons: e.reasons || [], detail: str(e.message), orderId, administrationId: marId, actor: resolved.actor.id };
    }
    return { ...base, ok: false, status: 502, error: "emar_failed", detail: str(e && e.message), orderId, administrationId: marId };
  }

  try {
    const out = await svc.put(record, { expectedVersion: existing ? existing.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, action, from: before, to: record.status,
      orderId, administrationId: marId, patientId: order.patientId, encounterId: order.encounterId || null,
      administeredBy: record.administeredBy || null, administeredAt: record.administeredAt || null,
      witnessedBy: record.witnessedBy || null,
      safetyWarnings: record.safetyWarnings || [],
      ...(record.safetyNotRun ? { safetyNotRun: record.safetyNotRun } : {}),
      version: out.record.version, actor: resolved.actor.id, role: resolved.role,
    };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), orderId, administrationId: marId, actor: resolved.actor.id };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", detail: e.detail, orderId, administrationId: marId };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), orderId, administrationId: marId };
  }
}

export { ACTIONS, ORDER_ENTRY_HARD_STOPS, EGFR_CODES, EGFR_ALIASES, EGFR_LEGACY_CODES, RENAL_STALE_DAYS, latestLab, renalFrom, coverageFindings, bedsideSafetyCheck, orderEntrySafety, medicationRound, administerStep };
