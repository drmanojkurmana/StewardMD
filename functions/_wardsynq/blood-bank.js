/* functions/_wardsynq/blood-bank.js - the blood bank before the bedside: donors, donations, testing, components and
 * the unit inventory that a transfusion request is crossmatched against.
 *
 * migrate-transfusion.js already carries a unit from crossmatch to the bedside. What it could not say is where the
 * unit came from, whether it was tested, and whether it was still on the shelf. This is that half.
 *
 * A UNIT'S STATUS IS DERIVED, NEVER STORED. Quarantine, available, reserved, issued, expired, reactive, discarded
 * are all read from the unit's donation tests, its own events (discard, release of a reservation) and the
 * TransfusionEpisode records that name it. The same discipline as stock.js: the issue is ALREADY a record (the
 * episode moved to "issued"), so the inventory reads it instead of asking anybody to write a second one that could
 * disagree. A crossmatch that binds a unit reserves it; the issue on that episode is what takes it off the shelf.
 *
 * QUARANTINE UNTIL PROVEN, NOT UNTIL SUSPECTED. A unit stays in quarantine until the donation has a result for
 * every mandatory test and a blood group. One reactive result makes every unit from that donation reactive, to be
 * discarded, never released. "Not tested yet" and "tested negative" are never the same state.
 *
 * THE GATE AT CROSSMATCH AND ISSUE. When the unit being crossmatched is one this blood bank registered, the route
 * refuses it unless it is available (or already reserved for this episode), and the group, RhD, component and expiry
 * come from the inventory, not from what was typed: a mismatch is refused. At issue the unit must still be reserved
 * for that episode and not expired, discarded or reactive. A unit this blood bank never registered (from another
 * blood centre) passes as before, marked untracked.
 *
 * SOURCES (checked 2026-09-16; the NBTC, NACO and CDSCO sites refused connections that day, so the primary texts
 * could not be read directly):
 *   - Mandatory tests on every unit - anti-HIV 1 and 2, HBsAg, anti-HCV, syphilis and malaria - "According to the
 *     Drugs and Cosmetics Act of India, it is mandatory to test every unit of blood for anti-HIV 1 and 2, anti-HCV,
 *     HBsAg, syphilis, and malaria." Asian J Transfus Sci 2021, citing Drugs and Cosmetics Rules 1945.
 *     https://pmc.ncbi.nlm.nih.gov/articles/PMC8628240/   CONFIRMED (secondary source quoting the Rules).
 *   - Platelets: shelf life five days. https://pmc.ncbi.nlm.nih.gov/articles/PMC9720350/   CONFIRMED (secondary).
 *   - Red cells 2-6 C (stored 4 +/- 2 C), platelets 22 +/- 2 C on an agitator: https://pmc.ncbi.nlm.nih.gov/articles/PMC9855214/
 *     CONFIRMED (secondary, storage temperature only).
 *   - UNCONFIRMED against a primary text: red cells in SAGM 42 days and whole blood/CPDA-1 35 days; FFP and
 *     cryoprecipitate one year at -30 C or colder; donor age 18-65, weight 45 kg (55 kg for a 450 mL bag),
 *     haemoglobin 12.5 g/dL, 90 days between donations for men and 120 for women. Shelf lives are therefore
 *     DEFAULTS the screen offers and the blood bank confirms against its own licence conditions and SOPs; the
 *     expiry recorded is the one the blood bank enters. The donor criteria are enforced as stated here.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const up = (v) => str(v).toUpperCase();
const READ_CAP = 1000;
const DAY = 86400000;

const TTI = Object.freeze(["hiv", "hbv", "hcv", "syphilis", "malaria"]);
const ABO = Object.freeze(["O", "A", "B", "AB"]);
const RHD = Object.freeze(["positive", "negative"]);
const COMPONENTS = Object.freeze({
  "whole-blood": { code: "WB", shelfDays: 35, storage: "2 to 6 C", confirmed: false },
  prbc: { code: "PRBC", shelfDays: 42, storage: "2 to 6 C", confirmed: false },
  ffp: { code: "FFP", shelfDays: 365, storage: "-30 C or colder", confirmed: false },
  platelets: { code: "PLT", shelfDays: 5, storage: "20 to 24 C with continuous agitation", confirmed: true },
  cryo: { code: "CRYO", shelfDays: 365, storage: "-30 C or colder", confirmed: false },
});
/* The transfusion engine's and the ward screen's spellings, to the inventory's component. */
const COMPONENT_ALIAS = Object.freeze({ "whole-blood": "whole-blood", "red-cells": "prbc", prbc: "prbc", plasma: "ffp", ffp: "ffp", platelets: "platelets", sdp: "platelets", cryoprecipitate: "cryo", cryo: "cryo" });
/* Each yes needs a deferral. The periods beside them are guidance on the screen, not computed here. */
const SCREENING_QUESTIONS = Object.freeze(["illness", "malaria", "jaundice", "tattoo", "transfusion", "surgery", "pregnancy", "high-risk", "chronic-disease"]);
const CRITERIA = Object.freeze({ minAge: 18, maxAge: 65, minWeightKg: 45, minWeightKg450: 55, minHb: 12.5, intervalDaysMale: 90, intervalDaysFemale: 120 });
const ISSUED_PHASES = new Set(["issued", "checked", "transfusing", "completed"]);

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
function writeFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code) };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message) };
}
function readFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) };
  return { ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message) };
}
const baseOf = (ctx) => ({ mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null });
const off = (ctx) => !ctx.migration || ctx.migration.mode === "off";
function latest(rows) {
  const m = new Map();
  for (const r of rows || []) { if (!r || !str(r.id)) continue; const p = m.get(r.id); if (!p || Number(r.version || 0) >= Number(p.version || 0)) m.set(r.id, r); }
  return [...m.values()];
}
const byAt = (a, b) => str(a.at).localeCompare(str(b.at)) || str(a.id).localeCompare(str(b.id));
const normComponent = (c) => COMPONENT_ALIAS[str(c).toLowerCase()] || null;

/** PURE. A donation's test state from its results: the latest complete result counts. */
function donationTests(donationId, results) {
  const mine = (results || []).filter((r) => r && str(r.donationId) === donationId).sort(byAt);
  const last = mine[mine.length - 1] || null;
  if (!last) return { state: "untested", group: null };
  const reactive = TTI.filter((t) => str(last.tti && last.tti[t]) === "reactive");
  return {
    state: reactive.length ? "reactive" : "cleared", reactive,
    group: ABO.includes(up(last.abo)) && RHD.includes(str(last.rhD)) ? { abo: up(last.abo), rhD: str(last.rhD) } : null,
    testedAt: last.at, testedBy: last.by,
  };
}

/** PURE. The deferral in force for a donor at `nowIso`, or null. */
function deferralInForce(donorId, screenings, nowIso) {
  const now = Date.parse(nowIso);
  const d = (screenings || []).filter((s) => s && str(s.donorId) === donorId && s.outcome === "deferred" && (s.permanent || Date.parse(s.deferredUntil) > now)).sort(byAt).pop();
  return d ? { screeningId: d.id, reason: d.deferralReason, permanent: !!d.permanent, until: d.permanent ? null : d.deferredUntil, at: d.at } : null;
}

/**
 * PURE. Every unit with its derived status.
 * units: BloodUnit; donations: BloodDonation; results: BloodTestResult; events: BloodUnitEvent; episodes: TransfusionEpisode.
 */
function unitStatuses(units, donations, results, events, episodes, nowIso) {
  const now = Date.parse(nowIso);
  return (units || []).filter(Boolean).map((u) => {
    const donation = (donations || []).find((d) => d && d.id === u.donationId) || null;
    const tests = donationTests(u.donationId, results);
    const mine = (events || []).filter((e) => e && str(e.unitId) === u.id).sort(byAt);
    const discard = mine.find((e) => e.kind === "discard") || null;
    const released = new Set(mine.filter((e) => e.kind === "release").map((e) => str(e.episodeId)));
    const naming = (episodes || []).filter((ep) => ep && ep.crossmatch && up(ep.crossmatch.unitId) === up(u.unitNumber));
    const issuedOn = naming.find((ep) => ISSUED_PHASES.has(ep.phase) || (ep.phase === "stopped" && (ep.ledger || []).some((l) => l && l.event === "issued")));
    const reservedFor = naming.find((ep) => ep.phase === "crossmatched" && !released.has(str(ep.id)));
    let status;
    if (discard) status = "discarded";
    else if (issuedOn) status = "issued";
    else if (Date.parse(u.expiresAt) <= now) status = "expired";
    else if (tests.state === "reactive") status = "reactive";
    else if (tests.state !== "cleared" || !tests.group) status = "quarantine";
    else if (reservedFor) status = "reserved";
    else status = "available";
    return {
      unitId: u.id, unitNumber: u.unitNumber, bagNumber: u.bagNumber, donationId: u.donationId, component: u.component,
      volumeMl: u.volumeMl, preparedAt: u.preparedAt, expiresAt: u.expiresAt, storage: u.storage,
      abo: tests.group ? tests.group.abo : null, rhD: tests.group ? tests.group.rhD : null,
      collectedAt: donation ? donation.collectedAt : null, status,
      ...(issuedOn ? { episodeId: issuedOn.id } : reservedFor ? { episodeId: reservedFor.id } : {}),
      ...(discard ? { discardReason: discard.reason, discardedAt: discard.at } : {}),
      ...(tests.state === "reactive" ? { reactive: tests.reactive } : {}),
    };
  });
}

/** PURE. Available units counted by group and component, with the soonest expiry of each. */
function inventoryOf(statuses) {
  const rows = new Map();
  for (const u of statuses || []) {
    if (u.status !== "available") continue;
    const k = `${u.abo}${u.rhD === "positive" ? "+" : "-"}|${u.component}`;
    const r = rows.get(k) || { group: `${u.abo}${u.rhD === "positive" ? "+" : "-"}`, component: u.component, available: 0, soonestExpiry: null };
    r.available++;
    if (!r.soonestExpiry || u.expiresAt < r.soonestExpiry) r.soonestExpiry = u.expiresAt;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => a.component.localeCompare(b.component) || a.group.localeCompare(b.group));
}

async function readBank(svc) {
  const types = ["BloodDonor", "DonorScreening", "BloodDonation", "BloodTestResult", "BloodUnit", "BloodUnitEvent", "TransfusionEpisode"];
  const rows = await Promise.all(types.map((t) => svc.list(t, READ_CAP)));
  const out = {};
  types.forEach((t, i) => { out[t] = t === "BloodUnitEvent" || t === "BloodTestResult" || t === "DonorScreening" ? (rows[i] || []).filter(Boolean) : latest(rows[i]); });
  out.truncated = rows.some((r) => (r || []).length >= READ_CAP);
  return out;
}

/** GET /ward/blood-bank - donors, donations with test state, units with status, inventory and expiry alerts. */
async function bloodBankOverview(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off" };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let b;
  try { b = await readBank(svc); } catch (e) { return { ...base, ...readFailure(e) }; }
  const now = ctx.now || new Date().toISOString();
  const units = unitStatuses(b.BloodUnit, b.BloodDonation, b.BloodTestResult, b.BloodUnitEvent, b.TransfusionEpisode, now);
  const soon = Date.parse(now) + 3 * DAY;
  return {
    ...base, ok: true, now, questions: SCREENING_QUESTIONS, tti: TTI, criteria: CRITERIA,
    components: Object.keys(COMPONENTS).map((c) => ({ component: c, ...COMPONENTS[c] })),
    donors: b.BloodDonor.map((d) => ({ donorId: d.id, donorNumber: d.donorNumber, name: d.name, sex: d.sex, dateOfBirth: d.dateOfBirth, phone: d.phone || null, deferral: deferralInForce(d.id, b.DonorScreening, now) }))
      .sort((a, b2) => str(a.name).localeCompare(str(b2.name))),
    screenings: b.DonorScreening.sort(byAt).reverse().slice(0, 200).map((s) => ({ screeningId: s.id, donorId: s.donorId, outcome: s.outcome, deferralReason: s.deferralReason || null, deferredUntil: s.deferredUntil || null, permanent: !!s.permanent, at: s.at, used: b.BloodDonation.some((d) => d.screeningId === s.id) })),
    donations: b.BloodDonation.map((d) => ({ donationId: d.id, bagNumber: d.bagNumber, donorId: d.donorId, volumeMl: d.volumeMl, bagType: d.bagType, collectedAt: d.collectedAt, tests: donationTests(d.id, b.BloodTestResult), units: units.filter((u) => u.donationId === d.id).length }))
      .sort((a, b2) => str(b2.collectedAt).localeCompare(str(a.collectedAt))),
    units: units.sort((a, b2) => str(a.expiresAt).localeCompare(str(b2.expiresAt))),
    inventory: inventoryOf(units),
    expiryAlerts: units.filter((u) => (u.status === "available" || u.status === "reserved") && Date.parse(u.expiresAt) <= soon)
      .concat(units.filter((u) => u.status === "expired" || u.status === "reactive")),
    ...(b.truncated ? { truncated: true, truncatedWarning: `More than ${READ_CAP} blood bank records of one kind exist and only the latest ${READ_CAP} were read, so this inventory may be incomplete. Check the shelf.` } : {}),
  };
}

/** POST /ward/blood-donor - register a donor. */
async function registerDonor(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const name = str(ctx.name), sex = str(ctx.sex), dob = str(ctx.dateOfBirth);
  if (!name || !["male", "female", "other"].includes(sex) || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return { ...base, ok: false, status: 422, error: "donor_incomplete", detail: "A donor needs a name, sex and date of birth.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const at = new Date().toISOString();
  const record = { resourceType: "BloodDonor", id: `wsq-donor-${crypto.randomUUID()}`, donorNumber: `D-${at.slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    name, sex, dateOfBirth: dob, phone: str(ctx.phone) || null, address: str(ctx.address) || null, by: resolved.actor.id, at };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, donorId: record.id, donorNumber: record.donorNumber, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

function ageOn(dob, iso) {
  const b = new Date(dob + "T00:00:00Z"), n = new Date(iso);
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

/** PURE. Why a donor may not donate now, from the screening values and their donation history. [] = no reason. */
function screeningFailures(donor, s, lastDonationAt, nowIso) {
  const out = [];
  const age = ageOn(donor.dateOfBirth, nowIso);
  if (!(age >= CRITERIA.minAge && age <= CRITERIA.maxAge)) out.push("age");
  if (!(Number(s.weightKg) >= CRITERIA.minWeightKg)) out.push("weight");
  if (!(Number(s.hbGdl) >= CRITERIA.minHb)) out.push("haemoglobin");
  if (SCREENING_QUESTIONS.some((q) => s.answers && s.answers[q] === true)) out.push("questionnaire");
  if (lastDonationAt) {
    const gap = (Date.parse(nowIso) - Date.parse(lastDonationAt)) / DAY;
    if (gap < (donor.sex === "female" ? CRITERIA.intervalDaysFemale : CRITERIA.intervalDaysMale)) out.push("interval");
  }
  return out;
}

/** POST /ward/donor-screening - questionnaire, weight, haemoglobin, and the outcome: eligible, or deferred with reason and period. */
async function screenDonor(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const outcome = str(ctx.outcome), donorId = str(ctx.donorId);
  const answers = {};
  for (const q of SCREENING_QUESTIONS) {
    const v = ctx.answers && ctx.answers[q];
    if (typeof v !== "boolean") return { ...base, ok: false, status: 422, error: "questionnaire_incomplete", question: q, detail: "Every screening question is answered yes or no.", written: 0 };
    answers[q] = v;
  }
  const weightKg = Number(ctx.weightKg), hbGdl = Number(ctx.hbGdl);
  if (!(weightKg > 0) || !(hbGdl > 0) || str(ctx.weightKg) === "" || str(ctx.hbGdl) === "") return { ...base, ok: false, status: 422, error: "vitals_required", detail: "Weight and haemoglobin are measured, not assumed.", written: 0 };
  if (!["eligible", "deferred"].includes(outcome)) return { ...base, ok: false, status: 422, error: "bad_outcome", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let donor, screenings, donations;
  try { [donor, screenings, donations] = await Promise.all([svc.get("BloodDonor", donorId), svc.list("DonorScreening", READ_CAP), svc.list("BloodDonation", READ_CAP)]); }
  catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!donor) return { ...base, ok: false, status: 404, error: "donor_not_found", written: 0 };
  const now = new Date().toISOString();
  const last = latest(donations).filter((d) => d.donorId === donorId).map((d) => d.collectedAt).sort().pop() || null;
  const failures = screeningFailures(donor, { weightKg, hbGdl, answers }, last, now);
  const inForce = deferralInForce(donorId, screenings, now);
  const record = { resourceType: "DonorScreening", id: `wsq-screen-${crypto.randomUUID()}`, donorId, answers, weightKg, hbGdl,
    bp: str(ctx.bp) || null, pulse: str(ctx.pulse) || null, temperature: str(ctx.temperature) || null, outcome, failures, by: resolved.actor.id, at: now };
  if (outcome === "eligible") {
    if (inForce) return { ...base, ok: false, status: 409, error: "donor_deferred", deferral: inForce, detail: "This donor is deferred and cannot be accepted.", written: 0 };
    if (failures.length) return { ...base, ok: false, status: 422, error: "not_eligible", failures, detail: `This donor does not meet: ${failures.join(", ")}. Record a deferral instead.`, written: 0 };
  } else {
    const reason = str(ctx.deferralReason), days = Number(ctx.deferralDays);
    if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "A deferral records why.", written: 0 };
    if (ctx.permanent !== true && !(Number.isInteger(days) && days > 0)) return { ...base, ok: false, status: 422, error: "deferral_period_required", detail: "A deferral is for a number of days, or permanent.", written: 0 };
    record.deferralReason = reason;
    record.permanent = ctx.permanent === true;
    record.deferredUntil = record.permanent ? null : new Date(Date.parse(now) + days * DAY).toISOString();
  }
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, screeningId: record.id, outcome, failures, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/blood-donation - the collection, against an eligible screening from the last 24 hours. */
async function recordDonation(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const bag = up(ctx.bagNumber).replace(/[^A-Z0-9-]+/g, "");
  const volume = Number(ctx.volumeMl);
  if (!bag) return { ...base, ok: false, status: 422, error: "bag_number_required", written: 0 };
  if (![350, 450].includes(volume)) return { ...base, ok: false, status: 422, error: "bad_volume", detail: "A donation is a 350 mL or 450 mL bag.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let screening, donations;
  try { [screening, donations] = await Promise.all([svc.get("DonorScreening", str(ctx.screeningId)), svc.list("BloodDonation", READ_CAP)]); }
  catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const now = new Date().toISOString();
  if (!screening || screening.outcome !== "eligible") return { ...base, ok: false, status: 409, error: "no_eligible_screening", detail: "A donation is collected only against an eligible screening.", written: 0 };
  if (Date.parse(now) - Date.parse(screening.at) > DAY) return { ...base, ok: false, status: 409, error: "screening_too_old", detail: "The screening is more than 24 hours old. Screen the donor again.", written: 0 };
  if (latest(donations).some((d) => d.screeningId === screening.id)) return { ...base, ok: false, status: 409, error: "screening_used", written: 0 };
  if (volume === 450 && !(Number(screening.weightKg) >= CRITERIA.minWeightKg450)) return { ...base, ok: false, status: 422, error: "weight_below_450", detail: `A 450 mL bag needs a donor of at least ${CRITERIA.minWeightKg450} kg.`, written: 0 };
  const record = { resourceType: "BloodDonation", id: `wsq-donation-${bag.toLowerCase()}`, bagNumber: bag, donorId: screening.donorId, screeningId: screening.id,
    volumeMl: volume, bagType: str(ctx.bagType) || null, collectedAt: now, adverseReaction: str(ctx.adverseReaction) || null, by: resolved.actor.id, at: now };
  try {
    /* The bag number is the id: a bag used twice is refused, never merged into the first donation. */
    const out = await svc.put(record, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, donationId: record.id, bagNumber: bag, version: out.record.version };
  } catch (e) {
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "bag_number_used", detail: "That bag number is already recorded.", written: 0 };
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** POST /ward/blood-test-result - all five mandatory tests and the blood group for one donation. A retest is appended. */
async function recordBloodTests(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const tti = {};
  for (const t of TTI) {
    const v = str(ctx.tti && ctx.tti[t]);
    if (!["reactive", "non-reactive"].includes(v)) return { ...base, ok: false, status: 422, error: "tti_incomplete", test: t, detail: "Every mandatory test (HIV 1 and 2, HBsAg, HCV, syphilis, malaria) has a result before it is recorded.", written: 0 };
    tti[t] = v;
  }
  if (!ABO.includes(up(ctx.abo)) || !RHD.includes(str(ctx.rhD))) return { ...base, ok: false, status: 422, error: "group_required", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let donation;
  try { donation = await svc.get("BloodDonation", str(ctx.donationId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!donation) return { ...base, ok: false, status: 404, error: "donation_not_found", written: 0 };
  const now = new Date().toISOString();
  const record = { resourceType: "BloodTestResult", id: `wsq-bloodtest-${crypto.randomUUID()}`, donationId: donation.id, tti, abo: up(ctx.abo), rhD: str(ctx.rhD), method: str(ctx.method) || null, by: resolved.actor.id, at: now };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    const reactive = TTI.filter((t) => tti[t] === "reactive");
    return { ...base, ok: true, written: 1, resultId: record.id, donationId: donation.id, version: out.record.version,
      state: reactive.length ? "reactive" : "cleared",
      ...(reactive.length ? { reactive, detail: "Reactive. Every unit from this donation is held as reactive and must be discarded; the donor needs notification and counselling." } : {}) };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/blood-components - the units separated from one donation, each with its own expiry and storage. */
async function separateComponents(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const list = Array.isArray(ctx.components) ? ctx.components : [];
  if (!list.length) return { ...base, ok: false, status: 422, error: "components_required", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let donation;
  try { donation = await svc.get("BloodDonation", str(ctx.donationId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!donation) return { ...base, ok: false, status: 404, error: "donation_not_found", written: 0 };
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i] || {};
    const comp = str(c.component);
    const exp = Date.parse(str(c.expiresAt)), vol = Number(c.volumeMl);
    if (!COMPONENTS[comp]) return { ...base, ok: false, status: 422, error: "bad_component", line: i, written: 0 };
    if (!Number.isFinite(exp) || exp <= Date.parse(donation.collectedAt)) return { ...base, ok: false, status: 422, error: "expiry_required", line: i, detail: "Each unit carries the expiry printed on its label, after the collection time.", written: 0 };
    if (!(vol > 0)) return { ...base, ok: false, status: 422, error: "volume_required", line: i, written: 0 };
    if (rows.some((r) => r.component === comp)) return { ...base, ok: false, status: 422, error: "duplicate_component", line: i, written: 0 };
    const beyond = exp > Date.parse(donation.collectedAt) + COMPONENTS[comp].shelfDays * DAY + DAY;
    rows.push({ component: comp, expiresAt: new Date(exp).toISOString(), volumeMl: vol, storage: str(c.storage) || COMPONENTS[comp].storage, beyond });
  }
  const now = new Date().toISOString();
  const written = [];
  for (const r of rows) {
    const unitNumber = `${donation.bagNumber}-${COMPONENTS[r.component].code}`;
    const record = { resourceType: "BloodUnit", id: `wsq-bu-${unitNumber.toLowerCase()}`, unitNumber, bagNumber: donation.bagNumber, donationId: donation.id,
      component: r.component, volumeMl: r.volumeMl, preparedAt: now, expiresAt: r.expiresAt, storage: r.storage, by: resolved.actor.id, at: now };
    try { await svc.put(record, { expectedVersion: 0 }); }
    catch (e) {
      const f = e instanceof VersionConflictError ? { ok: false, status: 409, error: "unit_exists", detail: `${unitNumber} is already recorded.` } : writeFailure(e);
      return { ...base, ...f, partial: written.length > 0, written: written.length, units: written,
        detail: `${f.detail || f.error}${written.length ? ` Units already written: ${written.map((w) => w.unitNumber).join(", ")}.` : " No unit was written."}` };
    }
    written.push({ unitNumber, component: r.component, expiresAt: r.expiresAt, ...(r.beyond ? { beyondDefaultShelfLife: true } : {}) });
  }
  return { ...base, ok: true, written: written.length, units: written,
    ...(written.some((w) => w.beyondDefaultShelfLife) ? { detail: "At least one expiry is later than this build's default shelf life for that component. Check it against the label and your licence conditions." } : {}) };
}

/** POST /ward/blood-unit-event - discard (with a reason) or release a crossmatch reservation that will not be issued. */
async function bloodUnitEvent(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const kind = str(ctx.kind), reason = str(ctx.reason);
  if (!["discard", "release"].includes(kind)) return { ...base, ok: false, status: 422, error: "bad_kind", written: 0 };
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let b;
  try { b = await readBank(svc); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const now = new Date().toISOString();
  const unit = unitStatuses(b.BloodUnit, b.BloodDonation, b.BloodTestResult, b.BloodUnitEvent, b.TransfusionEpisode, now).find((u) => u.unitId === str(ctx.unitId));
  if (!unit) return { ...base, ok: false, status: 404, error: "unit_not_found", written: 0 };
  if (kind === "discard" && ["issued", "discarded"].includes(unit.status)) return { ...base, ok: false, status: 409, error: "unit_not_discardable", unitStatus: unit.status, detail: `This unit is ${unit.status}.`, written: 0 };
  if (kind === "discard" && unit.status === "reserved") return { ...base, ok: false, status: 409, error: "unit_reserved", detail: "Release the reservation first, so the ward is not left expecting this unit.", written: 0 };
  if (kind === "release" && unit.status !== "reserved") return { ...base, ok: false, status: 409, error: "unit_not_reserved", written: 0 };
  const record = { resourceType: "BloodUnitEvent", id: `wsq-bue-${crypto.randomUUID()}`, unitId: unit.unitId, kind, reason, ...(kind === "release" ? { episodeId: unit.episodeId } : {}), by: resolved.actor.id, at: now };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, unitId: unit.unitId, kind, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/**
 * The inventory gate on the transfusion routes. stage "crossmatch": { unitId, episodeId, aboGroup, rhD, component };
 * stage "issue": { episodeId }. Returns { ok, tracked, unit? } or a refusal. Never writes.
 */
async function bloodUnitGate(request, env, ctx, stage) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, tracked: false };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let b, episode = null;
  try {
    b = await readBank(svc);
    if (str(ctx.episodeId)) episode = await svc.get("TransfusionEpisode", str(ctx.episodeId));
  } catch (e) { return { ...base, ...readFailure(e), error: "inventory_unreadable", detail: "The blood bank inventory could not be read, so this unit cannot be checked against it. Nothing was recorded." }; }
  const unitNumber = stage === "issue" ? up(episode && episode.crossmatch && episode.crossmatch.unitId) : up(ctx.unitId);
  if (!unitNumber) return { ...base, ok: true, tracked: false };
  const units = unitStatuses(b.BloodUnit, b.BloodDonation, b.BloodTestResult, b.BloodUnitEvent, b.TransfusionEpisode, new Date().toISOString());
  const unit = units.find((u) => up(u.unitNumber) === unitNumber);
  if (!unit) return { ...base, ok: true, tracked: false };
  const refuse = (code, detail) => ({ ...base, ok: false, status: 409, error: "inventory_refused", code, unitStatus: unit.status, detail });
  if (stage === "crossmatch") {
    const mine = unit.status === "reserved" && unit.episodeId === str(ctx.episodeId);
    if (unit.status !== "available" && !mine) return refuse("UNIT_NOT_AVAILABLE", `Unit ${unit.unitNumber} is ${unit.status} in the blood bank inventory and cannot be crossmatched.`);
    if (str(ctx.aboGroup) && up(ctx.aboGroup) !== unit.abo) return refuse("GROUP_MISMATCH", `Unit ${unit.unitNumber} is group ${unit.abo} on its test record, not ${up(ctx.aboGroup)}.`);
    if (str(ctx.rhD) && str(ctx.rhD).toLowerCase() !== unit.rhD) return refuse("RHD_MISMATCH", `Unit ${unit.unitNumber} is RhD ${unit.rhD} on its test record, not ${str(ctx.rhD)}.`);
    const asked = normComponent((episode && episode.component) || ctx.component);
    if (asked && asked !== unit.component) return refuse("COMPONENT_MISMATCH", `Unit ${unit.unitNumber} is ${unit.component}, and the request is for ${asked}.`);
    return { ...base, ok: true, tracked: true, unit: { unitId: unit.unitNumber, aboGroup: unit.abo, rhD: unit.rhD, component: unit.component, expiresAt: unit.expiresAt } };
  }
  if (unit.status !== "reserved" || unit.episodeId !== str(ctx.episodeId)) return refuse("UNIT_NOT_RESERVED", `Unit ${unit.unitNumber} is ${unit.status} in the blood bank inventory, not reserved for this request, and cannot be issued.`);
  return { ...base, ok: true, tracked: true, unit: { unitId: unit.unitNumber, status: unit.status } };
}

export {
  TTI, ABO, RHD, COMPONENTS, SCREENING_QUESTIONS, CRITERIA,
  donationTests, deferralInForce, unitStatuses, inventoryOf, screeningFailures, normComponent,
  bloodBankOverview, registerDonor, screenDonor, recordDonation, recordBloodTests, separateComponents, bloodUnitEvent, bloodUnitGate,
};
