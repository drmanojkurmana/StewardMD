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
 * AFTER COLLECTION (blood-centre-rules.js, legal opinion 2026-09-17 section G): shelf lives and storage temperatures by
 * component, anticoagulant and additive; the mandatory tests with their methods, the irregular antibody screen, and NAT
 * where the hospital requires it; the label with its results and group colour; pilot and recipient samples kept 7 days
 * after issue; records kept five years. The expiry is worked out here from the collection (or pooling) time and may only
 * be made earlier. This replaces the secondary sources and unconfirmed shelf-life defaults this header used to cite.
 *
 * CONFIDENTIAL (G.5.8). Deferral reasons and infection results reach blood centre staff only: those registers are read
 * through the Blood bank routes and never handed out by the change feed or the record door (service.js
 * BLOOD_CENTRE_ONLY), and the crossmatch gate a ward uses never says a unit is reactive, only that it is not available.
 *
 * DONOR SELECTION. donor-criteria.js holds the criteria and the deferral table: the stricter of WHO 2012 and the law of
 * the hospital's jurisdiction (Drugs and Cosmetics Rules 1945 Schedule F Part XII-B in India), each value with its
 * section or item, and a hospital's own settings only where stricter. This file applies them to a screening and a
 * collection.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { DONATION_TYPES, HB_METHODS, donorCriteriaFor, screeningFailures, discretionary, deferralFor, meets } from "./donor-criteria.js";
import {
  ANTICOAGULANTS, ADDITIVES, COMPONENT_RULES, POOLABLE, POOLED_OPEN_HOURS, TEST_METHODS, ANTIBODY_SCREEN, GROUP_COLOURS,
  storageText, shelfFor, bloodCentreSettings, bloodCentreView, sampleRetainUntil,
} from "./blood-centre-rules.js";

const str = (v) => (v == null ? "" : String(v).trim());
const up = (v) => str(v).toUpperCase();
const READ_CAP = 1000;
const DAY = 86400000;

const TTI = Object.freeze(["hiv", "hbv", "hcv", "syphilis", "malaria"]);
const ABO = Object.freeze(["O", "A", "B", "AB"]);
const RHD = Object.freeze(["positive", "negative"]);
const COMPONENTS = COMPONENT_RULES;
/* The transfusion engine's and the ward screen's spellings, to the inventory's component. */
const COMPONENT_ALIAS = Object.freeze({ "whole-blood": "whole-blood", "red-cells": "prbc", prbc: "prbc", plasma: "ffp", ffp: "ffp", platelets: "platelets", sdp: "platelets", cryoprecipitate: "cryo", cryo: "cryo", granulocytes: "granulocytes" });
/* Heading L: the donor record says whether the donation was voluntary or replacement. */
const DONOR_KINDS = Object.freeze(["voluntary", "replacement"]);
const SAMPLE_KINDS = Object.freeze(["donor-pilot", "recipient"]);
const NOTIFICATION_STEPS = Object.freeze(["notified", "counselled", "referred"]);
const HOUR = 3600000, SKEW = 5 * 60000;
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

/**
 * PURE. A donation's test state from its results. A reactive result anywhere in its history keeps it reactive: a retest
 * never clears a reactive donation. Otherwise the latest result counts, and clears only with every mandatory test
 * non-reactive, and NAT too where this hospital requires it (opts.natRequired). states: untested, incomplete, reactive,
 * cleared.
 */
function donationTests(donationId, results, opts) {
  const mine = (results || []).filter((r) => r && str(r.donationId) === donationId).sort(byAt);
  const last = mine[mine.length - 1] || null;
  if (!last) return { state: "untested", group: null };
  const reactive = [...new Set(mine.flatMap((r) => [...TTI.filter((t) => str(r.tti && r.tti[t]) === "reactive"), ...(str(r.nat) === "reactive" ? ["nat"] : [])]))];
  const complete = TTI.every((t) => str(last.tti && last.tti[t]) === "non-reactive") && !(opts && opts.natRequired && str(last.nat) !== "non-reactive");
  return {
    state: reactive.length ? "reactive" : complete ? "cleared" : "incomplete", reactive,
    group: ABO.includes(up(last.abo)) && RHD.includes(str(last.rhD)) ? { abo: up(last.abo), rhD: str(last.rhD) } : null,
    tti: last.tti || null, methods: last.methods || null, nat: last.nat || null,
    antibodyScreen: last.antibodyScreen || null, antibodyIdentified: last.antibodyIdentified || null,
    testedAt: last.at, testedBy: last.by,
  };
}

/** PURE. A unit's tests: its donation's, or for a pool every donation's, reactive if any is and cleared only if all are
 * and share one group. */
function unitTests(u, results, opts) {
  const ids = Array.isArray(u.donationIds) && u.donationIds.length ? u.donationIds : [u.donationId];
  const parts = ids.map((id) => ({ donationId: id, ...donationTests(str(id), results, opts) }));
  if (parts.length === 1) return { ...parts[0], parts };
  const reactive = [...new Set(parts.flatMap((p) => p.reactive || []))];
  const groups = new Set(parts.map((p) => (p.group ? p.group.abo + p.group.rhD : "")));
  return {
    state: reactive.length ? "reactive" : parts.every((p) => p.state === "cleared") ? "cleared" : parts.every((p) => p.state === "untested") ? "untested" : "incomplete",
    reactive, group: groups.size === 1 && parts[0].group ? parts[0].group : null,
    antibodyScreen: parts.some((p) => p.antibodyScreen === "positive") ? "positive" : parts.every((p) => p.antibodyScreen === "negative") ? "negative" : null, parts,
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
function unitStatuses(units, donations, results, events, episodes, nowIso, opts) {
  const now = Date.parse(nowIso), list = (units || []).filter(Boolean);
  return list.map((u) => {
    const ids = Array.isArray(u.donationIds) && u.donationIds.length ? u.donationIds : [u.donationId];
    const collected = ids.map((id) => (donations || []).find((d) => d && d.id === id)).filter(Boolean).map((d) => d.collectedAt).sort();
    const tests = unitTests(u, results, opts);
    const mine = (events || []).filter((e) => e && str(e.unitId) === u.id).sort(byAt);
    const discard = mine.find((e) => e.kind === "discard") || null;
    const released = new Set(mine.filter((e) => e.kind === "release").map((e) => str(e.episodeId)));
    const naming = (episodes || []).filter((ep) => ep && ep.crossmatch && up(ep.crossmatch.unitId) === up(u.unitNumber));
    const issuedOn = naming.find((ep) => ISSUED_PHASES.has(ep.phase) || (ep.phase === "stopped" && (ep.ledger || []).some((l) => l && l.event === "issued")));
    const reservedFor = naming.find((ep) => ep.phase === "crossmatched" && !released.has(str(ep.id)));
    /* Pooled into another unit: the pool names its units, one record, so a unit and its pool never disagree.
     * ponytail: two pools written at the same moment could name one bag; the bag is physically pooled once. */
    const pool = list.find((p) => Array.isArray(p.sourceUnitIds) && p.sourceUnitIds.includes(u.id)) || null;
    let status;
    if (discard) status = "discarded";
    else if (issuedOn) status = "issued";
    else if (pool) status = "pooled";
    else if (Date.parse(u.expiresAt) <= now) status = "expired";
    else if (tests.state === "reactive") status = "reactive";
    else if (tests.state !== "cleared" || !tests.group) status = "quarantine";
    else if (reservedFor) status = "reserved";
    else status = "available";
    const issuedAt = issuedOn ? ((issuedOn.ledger || []).find((l) => l && l.event === "issued") || {}).at || null : null;
    return {
      unitId: u.id, unitNumber: u.unitNumber, bagNumber: u.bagNumber || null, donationId: u.donationId || null, donationIds: ids.map(str), component: u.component,
      volumeMl: u.volumeMl, preparedAt: u.preparedAt, expiresAt: u.expiresAt, storage: u.storage, storageRange: u.storageRange || null,
      anticoagulant: u.anticoagulant || null, additive: u.additive || null,
      abo: tests.group ? tests.group.abo : null, rhD: tests.group ? tests.group.rhD : null,
      collectedAt: collected[0] || null, status, antibodyScreen: tests.antibodyScreen || null,
      ...(u.pooled ? { pooled: true, openSystem: !!u.openSystem, sourceUnitIds: u.sourceUnitIds } : {}),
      ...(pool ? { poolUnitId: pool.id, poolUnitNumber: pool.unitNumber } : {}),
      ...(issuedOn ? { episodeId: issuedOn.id, issuedAt } : reservedFor ? { episodeId: reservedFor.id } : {}),
      ...(discard ? { discardReason: discard.reason, discardedAt: discard.at } : {}),
      ...(tests.state === "reactive" ? { reactive: tests.reactive } : {}),
      /* Heading K(3): the results "recorded on the label", with the group colour. Only for a unit that may be issued. */
      ...(status === "available" || status === "reserved" ? { label: { colour: GROUP_COLOURS[tests.group.abo],
        tests: tests.parts.map((p) => ({ donationId: p.donationId, tti: p.tti, methods: p.methods, nat: p.nat, antibodyScreen: p.antibodyScreen, antibodyIdentified: p.antibodyIdentified })) } } : {}),
    };
  });
}

/** PURE. When a unit left the blood centre (issue, discard, expiry, or its pool's), or null while it is still here. */
function unitEndTime(u, byId) {
  if (u.status === "issued") return u.issuedAt || null;
  if (u.status === "discarded") return u.discardedAt || null;
  if (u.status === "expired") return u.expiresAt;
  if (u.status === "pooled") { const p = byId.get(u.poolUnitId); return p ? unitEndTime(p, byId) : null; }
  return null;
}

/** PURE. The units made from a donation, pools included. */
const unitsOfDonation = (statuses, donationId) => (statuses || []).filter((u) => (u.donationIds || []).includes(donationId));

/**
 * PURE. The sample register with each sample's retain-until date (K Note (a): 7 days after issue, or the hospital's
 * longer period). A donor pilot sample is kept while any unit from its donation is still in the blood centre, then for
 * the period after the last of them left; a recipient sample for the period after its episode's unit was issued.
 */
function samplesOf(samples, statuses, episodes, days, nowIso) {
  const byId = new Map((statuses || []).map((u) => [u.unitId, u]));
  return (samples || []).map((s) => {
    let ends = [];
    if (s.kind === "donor-pilot") ends = unitsOfDonation(statuses, str(s.donationId)).map((u) => unitEndTime(u, byId));
    else {
      const ep = (episodes || []).find((e) => e && e.id === s.episodeId);
      const issued = ep && (ep.ledger || []).find((l) => l && l.event === "issued");
      const stopped = ep && !issued && ep.phase === "stopped" ? (ep.ledger || []).slice(-1)[0] : null;
      ends = [issued ? issued.at : stopped ? stopped.at : null];
    }
    const retainUntil = sampleRetainUntil(ends, days);
    const state = s.discardedAt ? "discarded" : retainUntil && Date.parse(retainUntil) <= Date.parse(nowIso) ? "may-discard" : "retain";
    return { sampleId: s.id, kind: s.kind, donationId: s.donationId || null, episodeId: s.episodeId || null, location: s.location, collectedAt: s.collectedAt,
      retainUntil, state, discardedAt: s.discardedAt || null, version: s.version };
  });
}

/**
 * PURE. Look-back (G.5.6): each transfusion reaction on a unit this blood centre made, traced to its donations and donors;
 * and for each reactive donation, the same donor's earlier donations and where their units went.
 */
function lookbackOf(statuses, donations, donors, episodes, results, opts) {
  const donationById = new Map((donations || []).map((d) => [d.id, d])), donorById = new Map((donors || []).map((d) => [d.id, d]));
  const epById = new Map((episodes || []).map((e) => [e.id, e]));
  const who = (id) => { const d = donationById.get(id), n = d && donorById.get(d.donorId); return { donationId: id, bagNumber: d ? d.bagNumber : null, donorId: d ? d.donorId : null, donorNumber: n ? n.donorNumber : null }; };
  const reactions = (episodes || []).filter((e) => e && e.reaction && e.reaction.unitId).map((e) => {
    const u = (statuses || []).find((x) => up(x.unitNumber) === up(e.reaction.unitId));
    return u ? { episodeId: e.id, patientMrn: e.patientMrn || null, at: e.reaction.at, detail: e.reaction.detail || null, unitNumber: u.unitNumber, component: u.component, donations: u.donationIds.map(who) } : null;
  }).filter(Boolean);
  const recall = (donations || []).filter((d) => donationTests(d.id, results, opts).state === "reactive").map((d) => ({
    ...who(d.id), collectedAt: d.collectedAt, reactive: donationTests(d.id, results, opts).reactive,
    earlier: (donations || []).filter((x) => x.donorId === d.donorId && str(x.collectedAt) < str(d.collectedAt)).sort((a, b) => str(b.collectedAt).localeCompare(str(a.collectedAt)))
      .map((x) => ({ donationId: x.id, bagNumber: x.bagNumber, collectedAt: x.collectedAt,
        units: unitsOfDonation(statuses, x.id).map((u) => ({ unitNumber: u.unitNumber, component: u.component, status: u.status, episodeId: u.episodeId || null, patientMrn: u.episodeId && epById.get(u.episodeId) ? epById.get(u.episodeId).patientMrn || null : null })) })),
  }));
  return { reactions, recall };
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
  const types = ["BloodDonor", "DonorScreening", "BloodDonation", "BloodTestResult", "BloodUnit", "BloodUnitEvent", "TransfusionEpisode", "BloodSample", "DonorNotification"];
  const rows = await Promise.all(types.map((t) => svc.list(t, READ_CAP)));
  const out = {};
  const appended = new Set(["BloodUnitEvent", "BloodTestResult", "DonorScreening", "DonorNotification"]);
  types.forEach((t, i) => { out[t] = appended.has(t) ? (rows[i] || []).filter(Boolean) : latest(rows[i]); });
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
  const set = bloodCentreSettings(ctx.wsqCfg), opts = { natRequired: set.natRequired };
  const units = unitStatuses(b.BloodUnit, b.BloodDonation, b.BloodTestResult, b.BloodUnitEvent, b.TransfusionEpisode, now, opts);
  const soon = Date.parse(now) + 3 * DAY;
  const criteria = donorCriteriaFor(ctx.wsqCfg, ctx.orgRegion), centre = bloodCentreView(ctx.wsqCfg);
  const testsOf = (id) => donationTests(id, b.BloodTestResult, opts);
  return {
    ...base, ok: true, now, tti: TTI, hbMethods: HB_METHODS, donationTypes: DONATION_TYPES, criteria, questions: criteria.questions, centre,
    components: centre.components, donorKinds: DONOR_KINDS, sampleKinds: SAMPLE_KINDS, notificationSteps: NOTIFICATION_STEPS,
    donors: b.BloodDonor.map((d) => ({ donorId: d.id, donorNumber: d.donorNumber, name: d.name, sex: d.sex, dateOfBirth: d.dateOfBirth, phone: d.phone || null, deferral: deferralInForce(d.id, b.DonorScreening, now) }))
      .sort((a, b2) => str(a.name).localeCompare(str(b2.name))),
    screenings: b.DonorScreening.sort(byAt).reverse().slice(0, 200).map((s) => ({ screeningId: s.id, donorId: s.donorId, donationType: s.donationType || "whole-blood", outcome: s.outcome, deferralReason: s.deferralReason || null, deferredUntil: s.deferredUntil || null, permanent: !!s.permanent, at: s.at, used: b.BloodDonation.some((d) => d.screeningId === s.id) })),
    donations: b.BloodDonation.map((d) => ({ donationId: d.id, bagNumber: d.bagNumber, donorId: d.donorId, donationType: d.donationType || "whole-blood", donorKind: d.donorKind || null, anticoagulant: d.anticoagulant || null,
      volumeMl: d.volumeMl, bagType: d.bagType, collectedAt: d.collectedAt, adverseReaction: d.adverseReaction || null, tests: testsOf(d.id), units: units.filter((u) => u.donationId === d.id).length }))
      .sort((a, b2) => str(b2.collectedAt).localeCompare(str(a.collectedAt))),
    samples: samplesOf(b.BloodSample, units, b.TransfusionEpisode, set.sampleRetentionDays, now).sort((a, b2) => str(b2.collectedAt).localeCompare(str(a.collectedAt))),
    /* G.5.8: every reactive donation and each notification or counselling step recorded against it, blood centre only. */
    notifications: b.BloodDonation.filter((d) => testsOf(d.id).state === "reactive").map((d) => ({ donationId: d.id, bagNumber: d.bagNumber, donorId: d.donorId, reactive: testsOf(d.id).reactive,
      steps: b.DonorNotification.filter((n) => n.donationId === d.id).sort(byAt).map((n) => ({ step: n.step, method: n.method || null, referredTo: n.referredTo || null, note: n.note || null, at: n.at })) })),
    lookback: lookbackOf(units, b.BloodDonation, b.BloodDonor, b.TransfusionEpisode, b.BloodTestResult, opts),
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

const refusal = (base, status, error, detail, extra) => ({ ...base, ok: false, status, error, detail, ...(extra || {}), written: 0 });

/**
 * POST /ward/donor-screening - the questionnaire, the measurements and the outcome: eligible, or deferred against the
 * conditions of the deferral table (donor-criteria.js). A longer period or a permanent deferral is always allowed; a
 * shorter one than the table never is, so the period recorded is the later of the two.
 */
async function screenDonor(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const criteria = donorCriteriaFor(ctx.wsqCfg, ctx.orgRegion), L = criteria.limits, m = criteria.measure;
  const outcome = str(ctx.outcome), donorId = str(ctx.donorId), donationType = str(ctx.donationType) || "whole-blood";
  if (!DONATION_TYPES.includes(donationType)) return refusal(base, 422, "donation_type_invalid", `The donation type is one of ${DONATION_TYPES.join(", ")}.`);
  const answers = {};
  for (const q of criteria.questions) {
    const v = ctx.answers && ctx.answers[q];
    if (typeof v !== "boolean") return refusal(base, 422, "questionnaire_incomplete", "Every screening question is answered yes or no.", { question: q });
    answers[q] = v;
  }
  const weightKg = Number(ctx.weightKg), hbGdl = Number(ctx.hbGdl);
  if (!(weightKg > 0) || !(hbGdl > 0) || str(ctx.weightKg) === "" || str(ctx.hbGdl) === "") return refusal(base, 422, "vitals_required", "Weight and haemoglobin are measured, not assumed.");
  if (!["eligible", "deferred"].includes(outcome)) return refusal(base, 422, "bad_outcome");
  const hbMethod = str(ctx.hbMethod) || null;
  if (hbMethod && !HB_METHODS.includes(hbMethod)) return refusal(base, 422, "hb_method_invalid", `The haemoglobin method is one of ${HB_METHODS.join(", ")}.`);
  const bp = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(str(ctx.bp)), num = (v) => (str(v) === "" ? null : Number(v));
  const temperatureC = num(ctx.temperature), pulse = num(ctx.pulse), plateletCount = num(ctx.plateletCount), totalProteinGL = num(ctx.totalProteinGL);
  const pulseRegular = typeof ctx.pulseRegular === "boolean" ? ctx.pulseRegular : null;
  if ((str(ctx.bp) && !bp) || [temperatureC, pulse, plateletCount, totalProteinGL].some((v) => v != null && !Number.isFinite(v))) {
    return refusal(base, 422, "vitals_invalid", "Blood pressure is written as systolic/diastolic (120/80); temperature, pulse, platelet count and total protein as numbers.");
  }
  const law = (item) => `${criteria.standards[criteria.jurisdiction]}, item ${item}`;
  if (!bp && (m.bp || [L.systolicMin, L.systolicMax, L.diastolicMin, L.diastolicMax].some(Boolean))) return refusal(base, 422, "bp_required", m.bp ? `Blood pressure is measured at every screening (${law(m.bp)}).` : "This hospital checks blood pressure before donation. Measure and record it.");
  if ((pulse == null && (m.pulse || L.pulseMin || L.pulseMax)) || (m.pulse && pulseRegular == null)) return refusal(base, 422, "pulse_required", m.pulse ? `The pulse and whether it is regular are recorded at every screening (${law(m.pulse)}).` : "This hospital checks the pulse before donation. Measure and record it.");
  if (temperatureC == null && m.temperature) return refusal(base, 422, "temperature_required", `The donor must be afebrile, so temperature is measured at every screening (${law(m.temperature)}).`);
  if (donationType === "apheresis-platelets" && plateletCount == null) return refusal(base, 422, "apheresis_lab_required", "A platelet apheresis donor's platelet count is measured before donation (WHO 2012, 4.10).");
  if (donationType === "apheresis-plasma" && totalProteinGL == null) return refusal(base, 422, "apheresis_lab_required", "A plasma apheresis donor's total protein is measured before donation (WHO 2012, 4.10).");
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let donor, screenings, donations;
  try { [donor, screenings, donations] = await Promise.all([svc.get("BloodDonor", donorId), svc.list("DonorScreening", READ_CAP), svc.list("BloodDonation", READ_CAP)]); }
  catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!donor) return refusal(base, 404, "donor_not_found");
  const now = new Date().toISOString();
  const history = latest(donations).filter((d) => d.donorId === donorId).map((d) => ({ at: d.collectedAt, type: d.donationType || "whole-blood", reinfusionComplete: d.reinfusionComplete }));
  const failures = screeningFailures(donor, { donationType, weightKg, hbGdl, answers, temperatureC, pulse, pulseRegular, plateletCount, totalProteinGL,
    systolic: bp ? Number(bp[1]) : null, diastolic: bp ? Number(bp[2]) : null }, history, now, criteria);
  const inForce = deferralInForce(donorId, screenings, now);
  const record = { resourceType: "DonorScreening", id: `wsq-screen-${crypto.randomUUID()}`, donorId, donationType, answers, weightKg, hbGdl, hbMethod,
    bp: str(ctx.bp) || null, pulse, pulseRegular, temperature: temperatureC, plateletCount, totalProteinGL, outcome, failures,
    criteriaInForce: { jurisdiction: criteria.jurisdiction, values: criteria.values }, by: resolved.actor.id, at: now };
  if (outcome === "eligible") {
    if (inForce) return refusal(base, 409, "donor_deferred", "This donor is deferred and cannot be accepted.", { deferral: inForce });
    const allowed = discretionary(criteria), hard = failures.filter((f) => !allowed.includes(f));
    if (hard.length) return refusal(base, 422, "not_eligible", `This donor does not meet: ${hard.join(", ")}. Record a deferral instead.`, { failures });
    if (failures.length) {
      /* WHO 4.1.2: an older first-time donor, or a regular donor past the upper age, only at the discretion of the
       * responsible physician, named with the reason on the record. Never where the law states the age without one. */
      const physician = str(ctx.physicianName), why = str(ctx.physicianReason);
      if (!physician || !why) return refusal(base, 422, "physician_discretion_required", "Past this age a donor is accepted only at the discretion of the responsible physician (WHO 2012, 4.1.2). Name the physician and the reason, or record a deferral.", { failures });
      record.physicianDiscretion = { name: physician, reason: why, failures };
    }
  } else {
    const conditions = (Array.isArray(ctx.deferralConditions) ? ctx.deferralConditions : []).filter((x) => x && str(x.condition));
    const uncovered = criteria.questions.filter((q) => answers[q] && !conditions.some((x) => criteria.deferrals[str(x.condition)] && criteria.deferrals[str(x.condition)].question === q));
    if (uncovered.length) return refusal(base, 422, "deferral_condition_required", `A yes to ${uncovered.join(", ")} is deferred against the condition in the deferral table it concerns.`, { questions: uncovered });
    const table = deferralFor(conditions, criteria, now);
    if (!table.ok) return { ...base, status: 422, ...table, written: 0 };
    const reason = str(ctx.deferralReason) || table.applied.map((a) => a.condition).join(", ");
    if (!reason) return refusal(base, 422, "reason_required", "A deferral records why.");
    const days = str(ctx.deferralDays) === "" || ctx.deferralDays == null ? null : Number(ctx.deferralDays);
    if (days != null && !(Number.isInteger(days) && days > 0)) return refusal(base, 422, "deferral_period_required", "A deferral is for a whole number of days, or permanent.");
    record.permanent = ctx.permanent === true || table.permanent;
    if (!record.permanent) {
      if (table.undated.length && days == null) return refusal(base, 422, "deferral_period_required", `${table.undated.join(", ")} has no fixed period in the standards: enter the days until it resolves.`, { conditions: table.undated });
      const own = days == null ? null : new Date(Date.parse(now) + days * DAY).toISOString();
      record.deferredUntil = [own, table.until].filter(Boolean).sort().pop() || null;
      if (!record.deferredUntil) return refusal(base, 422, "deferral_period_required", conditions.length ? "The deferral period for this condition has already passed. Enter the days if the donor is still deferred." : "A deferral is for a number of days, or permanent.");
    } else record.deferredUntil = null;
    record.deferralReason = reason;
    record.deferralConditions = table.applied;
  }
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, screeningId: record.id, outcome, failures, version: out.record.version,
      ...(outcome === "deferred" ? { permanent: record.permanent, deferredUntil: record.deferredUntil, deferralConditions: record.deferralConditions } : {}) };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/blood-donation - the collection, against an eligible screening from the last 24 hours. */
async function recordDonation(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const bag = up(ctx.bagNumber).replace(/[^A-Z0-9-]+/g, "");
  const volume = Number(ctx.volumeMl), donorKind = str(ctx.donorKind), anticoagulant = str(ctx.anticoagulant).toLowerCase();
  if (!bag) return refusal(base, 422, "bag_number_required");
  if (!DONOR_KINDS.includes(donorKind)) return refusal(base, 422, "donor_kind_required", "The donor record says whether this is a voluntary or a replacement donation (Schedule F Part XII-B, heading L).");
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let screening, donations;
  try { [screening, donations] = await Promise.all([svc.get("DonorScreening", str(ctx.screeningId)), svc.list("BloodDonation", READ_CAP)]); }
  catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const now = new Date().toISOString();
  if (!screening || screening.outcome !== "eligible") return refusal(base, 409, "no_eligible_screening", "A donation is collected only against an eligible screening.");
  if (Date.parse(now) - Date.parse(screening.at) > DAY) return refusal(base, 409, "screening_too_old", "The screening is more than 24 hours old. Screen the donor again.");
  if (latest(donations).some((d) => d.screeningId === screening.id)) return refusal(base, 409, "screening_used");
  const type = screening.donationType || "whole-blood", apheresis = type !== "whole-blood";
  if (!apheresis && ![350, 450].includes(volume)) return refusal(base, 422, "bad_volume", "A whole blood donation is a 350 mL or 450 mL bag.");
  /* Schedule P item 7: whole blood keeps 21 days in ACD and 35 in CPDA, so the bag's anticoagulant decides its expiry. */
  if (!apheresis && !ANTICOAGULANTS.includes(anticoagulant)) return refusal(base, 422, "anticoagulant_required", `Record the bag's anticoagulant (${ANTICOAGULANTS.join(" or ")}): it decides how long the blood keeps.`);
  if (apheresis && !(Number.isInteger(volume) && volume > 0 && volume <= 1000)) return refusal(base, 422, "bad_volume", "An apheresis collection records its volume in mL.");
  if (apheresis && typeof ctx.reinfusionComplete !== "boolean") return refusal(base, 422, "reinfusion_required", "Record whether the red cells were returned completely: it decides when this donor may give again.");
  if (!apheresis) {
    const lim = donorCriteriaFor(ctx.wsqCfg, ctx.orgRegion).limits[volume === 450 ? "minWeightKg450" : "minWeightKg350"];
    if (!meets("higher", Number(screening.weightKg), lim)) return refusal(base, 422, volume === 450 ? "weight_below_450" : "weight_below_350", `A ${volume} mL bag needs a donor weighing ${lim.exclusive ? "more than" : "at least"} ${lim.value} kg.`);
  }
  const record = { resourceType: "BloodDonation", id: `wsq-donation-${bag.toLowerCase()}`, bagNumber: bag, donorId: screening.donorId, screeningId: screening.id, donationType: type,
    donorKind, anticoagulant: apheresis ? null : anticoagulant,
    volumeMl: volume, bagType: str(ctx.bagType) || null, reinfusionComplete: apheresis ? ctx.reinfusionComplete : null, collectedAt: now, adverseReaction: str(ctx.adverseReaction) || null, by: resolved.actor.id, at: now };
  try {
    /* The bag number is the id: a bag used twice is refused, never merged into the first donation. */
    const out = await svc.put(record, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, donationId: record.id, bagNumber: bag, version: out.record.version };
  } catch (e) {
    if (e instanceof VersionConflictError) return refusal(base, 409, "bag_number_used", "That bag number is already recorded.");
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/**
 * POST /ward/blood-test-result - all five mandatory tests with the method of each (heading K(2), K(3)), the blood group
 * and the irregular antibody screen (heading L), and NAT where this hospital requires it, for one donation. A retest is
 * appended; a reactive result is never cleared by one.
 */
async function recordBloodTests(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const no = (error, detail, extra) => ({ ...base, ok: false, status: 422, error, ...(detail ? { detail } : {}), ...(extra || {}), written: 0 });
  const tti = {}, methods = {};
  for (const t of TTI) {
    const v = str(ctx.tti && ctx.tti[t]);
    if (!["reactive", "non-reactive"].includes(v)) return no("tti_incomplete", "Every mandatory test (HIV 1 and 2, HBsAg, HCV, syphilis, malaria) has a result before it is recorded.", { test: t });
    tti[t] = v;
  }
  for (const t of TTI) {
    const m = str(ctx.methods && ctx.methods[t]);
    if (!TEST_METHODS[t].includes(m)) return no("method_required", `Record the method of each test (${t}: ${TEST_METHODS[t].join(", ")}).`, { test: t });
    methods[t] = m;
  }
  if (!ABO.includes(up(ctx.abo)) || !RHD.includes(str(ctx.rhD))) return no("group_required");
  const antibodyScreen = str(ctx.antibodyScreen), antibodyIdentified = str(ctx.antibodyIdentified);
  if (!ANTIBODY_SCREEN.includes(antibodyScreen)) return no("antibody_screen_required", "Record the irregular antibody screen, negative or positive (Schedule F Part XII-B, heading L).");
  if (antibodyScreen === "positive" && !antibodyIdentified) return no("antibody_identity_required", "A positive screen records the antibody found, or that it is not yet identified.");
  const nat = str(ctx.nat), natMethod = str(ctx.methods && ctx.methods.nat), natRequired = bloodCentreSettings(ctx.wsqCfg).natRequired;
  if ((nat || natRequired) && !["reactive", "non-reactive"].includes(nat)) return no("nat_required", "This hospital requires NAT on every donation before release. Record its result.");
  if (nat && !TEST_METHODS.nat.includes(natMethod)) return no("method_required", `Record the NAT method (${TEST_METHODS.nat.join(", ")}).`, { test: "nat" });
  if (nat) methods.nat = natMethod;
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let donation, prior;
  try { [donation, prior] = await Promise.all([svc.get("BloodDonation", str(ctx.donationId)), svc.list("BloodTestResult", READ_CAP)]); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!donation) return { ...base, ok: false, status: 404, error: "donation_not_found", written: 0 };
  const now = new Date().toISOString();
  const record = { resourceType: "BloodTestResult", id: `wsq-bloodtest-${crypto.randomUUID()}`, donationId: donation.id, tti, methods, nat: nat || null, abo: up(ctx.abo), rhD: str(ctx.rhD),
    antibodyScreen, antibodyIdentified: antibodyScreen === "positive" ? antibodyIdentified : null, by: resolved.actor.id, at: now };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    const t = donationTests(donation.id, [...(prior || []).filter(Boolean), record], { natRequired });
    return { ...base, ok: true, written: 1, resultId: record.id, donationId: donation.id, version: out.record.version, state: t.state,
      ...(t.state === "reactive" ? { reactive: t.reactive, detail: "Reactive. Every unit from this donation is held as reactive and must be discarded, and a later retest does not clear it. Notify and counsel the donor in the confidential workflow on the Blood bank screen." } : {}) };
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
  const rows = [], now = new Date().toISOString(), collected = Date.parse(donation.collectedAt), shelfHours = bloodCentreSettings(ctx.wsqCfg).shelfHours;
  const no = (i, error, detail) => ({ ...base, ok: false, status: 422, error, line: i, ...(detail ? { detail } : {}), written: 0 });
  for (let i = 0; i < list.length; i++) {
    const c = list[i] || {};
    const comp = str(c.component), rule = COMPONENTS[comp], vol = Number(c.volumeMl), additive = str(c.additive).toLowerCase();
    if (!rule) return no(i, "bad_component");
    if (!(vol > 0)) return no(i, "volume_required");
    if (rows.some((r) => r.component === comp)) return no(i, "duplicate_component");
    if (comp === "prbc" && !ADDITIVES.includes(additive)) return no(i, "additive_required", `Record the red cells' additive solution (${ADDITIVES.join(", ")}): it decides how long they keep.`);
    /* When the unit was separated (platelets) or frozen (plasma): given, or now. Never before collection or in the future. */
    const prepared = str(c.preparedAt) ? Date.parse(str(c.preparedAt)) : Date.parse(now);
    if (!Number.isFinite(prepared) || prepared < collected || prepared > Date.parse(now) + SKEW) return no(i, "prepared_at_invalid", "The preparation time is after the collection and not in the future.");
    const within = rule.prepareWithinHours && (comp !== "platelets" || (donation.donationType || "whole-blood") === "whole-blood") ? rule.prepareWithinHours : null;
    if (within && prepared > collected + within * HOUR) {
      return no(i, "prepared_too_late", comp === "ffp" ? `Fresh frozen plasma is frozen within ${within} hours of collection (${rule.ref}). Record it as another plasma component or discard it.` : `Platelets are separated within ${within} hours of collection (${rule.ref}).`);
    }
    const shelf = shelfFor(comp, { anticoagulant: donation.anticoagulant, additive }, shelfHours);
    const latest = collected + shelf.hours * HOUR;
    /* The Rules' longest shelf life (or this hospital's shorter one) sets the latest expiry; an earlier one on the label may be entered. */
    let exp = latest;
    if (str(c.expiresAt)) {
      exp = Date.parse(str(c.expiresAt));
      if (!Number.isFinite(exp) || exp <= prepared) return no(i, "expiry_invalid", "The expiry is after the preparation time.");
      if (exp > latest) return no(i, "expiry_beyond_shelf_life", `${comp} keeps at most ${shelf.hours} hours from collection here (${shelf.hospital ? "this hospital's setting" : rule.ref}). The latest expiry is ${new Date(latest).toISOString()}.`);
    }
    rows.push({ component: comp, expiresAt: new Date(exp).toISOString(), preparedAt: new Date(prepared).toISOString(), volumeMl: vol, additive: comp === "prbc" ? additive : null, shelf, storage: rule.storage });
  }
  const written = [];
  for (const r of rows) {
    const unitNumber = `${donation.bagNumber}-${COMPONENTS[r.component].code}`;
    const record = { resourceType: "BloodUnit", id: `wsq-bu-${unitNumber.toLowerCase()}`, unitNumber, bagNumber: donation.bagNumber, donationId: donation.id,
      component: r.component, volumeMl: r.volumeMl, anticoagulant: donation.anticoagulant || null, additive: r.additive, preparedAt: r.preparedAt, expiresAt: r.expiresAt,
      shelfHours: r.shelf.hours, shelfBasis: r.shelf.basis, storage: storageText(r.storage), storageRange: r.storage, by: resolved.actor.id, at: now };
    try { await svc.put(record, { expectedVersion: 0 }); }
    catch (e) {
      const f = e instanceof VersionConflictError ? { ok: false, status: 409, error: "unit_exists", detail: `${unitNumber} is already recorded.` } : writeFailure(e);
      return { ...base, ...f, partial: written.length > 0, written: written.length, units: written,
        detail: `${f.detail || f.error}${written.length ? ` Units already written: ${written.map((w) => w.unitNumber).join(", ")}.` : " No unit was written."}` };
    }
    written.push({ unitNumber, component: r.component, expiresAt: r.expiresAt, storage: record.storage });
  }
  return { ...base, ok: true, written: written.length, units: written };
}

/**
 * POST /ward/blood-pool - pool available platelet or cryoprecipitate units of one group into one unit. "Pooled platelets or
 * cryo, open system: 6 hours" (legal opinion G.1); a closed-system pool keeps the soonest expiry of its units. The pool
 * names its units, and they leave the shelf by that one record.
 */
async function poolUnits(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const ids = [...new Set((Array.isArray(ctx.unitIds) ? ctx.unitIds : []).map(str).filter(Boolean))], component = str(ctx.component);
  if (!POOLABLE.includes(component)) return refusal(base, 422, "bad_component", `Only ${POOLABLE.join(" and ")} are pooled.`);
  if (ids.length < 2) return refusal(base, 422, "units_required", "A pool is made from two or more units.");
  if (typeof ctx.openSystem !== "boolean") return refusal(base, 422, "open_system_required", "Record whether the pool was made in an open system: an open pool keeps 6 hours.");
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let b;
  try { b = await readBank(svc); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const now = new Date().toISOString();
  const statuses = unitStatuses(b.BloodUnit, b.BloodDonation, b.BloodTestResult, b.BloodUnitEvent, b.TransfusionEpisode, now, { natRequired: bloodCentreSettings(ctx.wsqCfg).natRequired });
  const units = ids.map((id) => statuses.find((u) => u.unitId === id));
  const bad = ids.find((id, i) => !units[i] || units[i].status !== "available" || units[i].component !== component);
  if (bad) return refusal(base, 409, "unit_not_poolable", `Every unit in a pool is an available ${component} unit.`, { unitId: bad });
  if (new Set(units.map((u) => `${u.abo}${u.rhD}`)).size > 1) return refusal(base, 409, "group_mixed", "A pool is made from units of one ABO group and RhD type.");
  const expires = Math.min(...units.map((u) => Date.parse(u.expiresAt)), ctx.openSystem ? Date.parse(now) + POOLED_OPEN_HOURS * HOUR : Infinity);
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase(), rule = COMPONENTS[component];
  const record = { resourceType: "BloodUnit", id: `wsq-bu-pool-${tag.toLowerCase()}`, unitNumber: `POOL-${now.slice(0, 10).replace(/-/g, "")}-${tag}`, bagNumber: null, donationId: null,
    donationIds: [...new Set(units.flatMap((u) => u.donationIds))], sourceUnitIds: ids, pooled: true, openSystem: ctx.openSystem, component,
    volumeMl: units.reduce((n, u) => n + (Number(u.volumeMl) || 0), 0), preparedAt: now, expiresAt: new Date(expires).toISOString(),
    shelfBasis: ctx.openSystem ? "pooled-open" : "pooled-closed", storage: storageText(rule.storage), storageRange: rule.storage, by: resolved.actor.id, at: now };
  try {
    const out = await svc.put(record, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, unitId: record.id, unitNumber: record.unitNumber, expiresAt: record.expiresAt, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** POST /ward/blood-sample - register a donor pilot sample (per donation) or a recipient sample (per transfusion episode). */
async function registerSample(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const kind = str(ctx.kind), location = str(ctx.location);
  if (!SAMPLE_KINDS.includes(kind)) return refusal(base, 422, "bad_kind", `A sample is ${SAMPLE_KINDS.join(" or ")}.`);
  if (!location) return refusal(base, 422, "location_required", "Record where the sample is kept, so it can be found for a reaction work-up.");
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const refType = kind === "donor-pilot" ? "BloodDonation" : "TransfusionEpisode", refId = str(kind === "donor-pilot" ? ctx.donationId : ctx.episodeId);
  let ref;
  try { ref = refId ? await svc.get(refType, refId) : null; } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!ref) return refusal(base, 404, kind === "donor-pilot" ? "donation_not_found" : "episode_not_found");
  const now = new Date().toISOString();
  const record = { resourceType: "BloodSample", id: `wsq-sample-${kind}-${ref.id}`.toLowerCase(), kind, donationId: kind === "donor-pilot" ? ref.id : null,
    episodeId: kind === "recipient" ? ref.id : null, location, collectedAt: now, by: resolved.actor.id, at: now };
  try {
    const out = await svc.put(record, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, sampleId: record.id, version: out.record.version };
  } catch (e) {
    if (e instanceof VersionConflictError) return refusal(base, 409, "sample_exists", "A sample of this kind is already registered for it.");
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** POST /ward/blood-sample-discard - the discard log: refused while the sample must still be kept (K Note (a)). */
async function discardSample(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let b;
  try { b = await readBank(svc); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  const now = new Date().toISOString(), set = bloodCentreSettings(ctx.wsqCfg);
  const sample = b.BloodSample.find((s) => s.id === str(ctx.sampleId));
  if (!sample) return refusal(base, 404, "sample_not_found");
  const units = unitStatuses(b.BloodUnit, b.BloodDonation, b.BloodTestResult, b.BloodUnitEvent, b.TransfusionEpisode, now, { natRequired: set.natRequired });
  const view = samplesOf([sample], units, b.TransfusionEpisode, set.sampleRetentionDays, now)[0];
  if (view.state === "discarded") return refusal(base, 409, "sample_discarded", "This sample is already recorded as discarded.");
  if (view.state !== "may-discard") {
    return refusal(base, 409, "sample_retention_running", view.retainUntil
      ? `Keep this sample until ${view.retainUntil}: ${set.sampleRetentionDays} days after the last unit it covers was issued (Schedule F Part XII-B, heading K Note (a)).`
      : "Keep this sample: a unit it covers is still in the blood centre, or its unit has not been issued.", { retainUntil: view.retainUntil });
  }
  const record = { resourceType: "BloodSample", id: sample.id, kind: sample.kind, donationId: sample.donationId, episodeId: sample.episodeId, location: sample.location,
    collectedAt: sample.collectedAt, retainUntil: view.retainUntil, discardedAt: now, discardedBy: resolved.actor.id, by: resolved.actor.id, at: now };
  try {
    const out = await svc.put(record, { expectedVersion: sample.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, sampleId: sample.id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/**
 * POST /ward/donor-notification - the confidential workflow for a donor whose donation tested reactive (G.5.8): notified,
 * counselled, referred. Only against a reactive donation; blood centre staff only, never on a ward screen.
 */
async function recordDonorNotification(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const step = str(ctx.step), method = str(ctx.method), referredTo = str(ctx.referredTo);
  if (!NOTIFICATION_STEPS.includes(step)) return refusal(base, 422, "bad_step", `A step is ${NOTIFICATION_STEPS.join(", ")}.`);
  if (step === "notified" && !["in-person", "phone", "letter"].includes(method)) return refusal(base, 422, "method_required", "Record how the donor was told: in person, by phone or by letter.");
  if (step === "referred" && !referredTo) return refusal(base, 422, "referral_required", "Record where the donor was referred.");
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let donation, results;
  try { [donation, results] = await Promise.all([svc.get("BloodDonation", str(ctx.donationId)), svc.list("BloodTestResult", READ_CAP)]); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!donation) return refusal(base, 404, "donation_not_found");
  if (donationTests(donation.id, results).state !== "reactive") return refusal(base, 409, "donation_not_reactive", "Notification and counselling are recorded for a reactive donation only.");
  const now = new Date().toISOString();
  const record = { resourceType: "DonorNotification", id: `wsq-donor-note-${crypto.randomUUID()}`, donationId: donation.id, donorId: donation.donorId, step,
    method: step === "notified" ? method : null, referredTo: step === "referred" ? referredTo : null, note: str(ctx.note) || null, by: resolved.actor.id, at: now };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, notificationId: record.id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
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
  const unit = unitStatuses(b.BloodUnit, b.BloodDonation, b.BloodTestResult, b.BloodUnitEvent, b.TransfusionEpisode, now, { natRequired: bloodCentreSettings(ctx.wsqCfg).natRequired }).find((u) => u.unitId === str(ctx.unitId));
  if (!unit) return { ...base, ok: false, status: 404, error: "unit_not_found", written: 0 };
  if (kind === "discard" && ["issued", "discarded", "pooled"].includes(unit.status)) return { ...base, ok: false, status: 409, error: "unit_not_discardable", unitStatus: unit.status, detail: `This unit is ${unit.status}.`, written: 0 };
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
  const units = unitStatuses(b.BloodUnit, b.BloodDonation, b.BloodTestResult, b.BloodUnitEvent, b.TransfusionEpisode, new Date().toISOString(), { natRequired: bloodCentreSettings(ctx.wsqCfg).natRequired });
  const unit = units.find((u) => up(u.unitNumber) === unitNumber);
  if (!unit) return { ...base, ok: true, tracked: false };
  /* G.5.8: this answer can reach a ward screen, so a reactive unit is only "not available", never "reactive". */
  const shown = unit.status === "reactive" ? "not available" : unit.status;
  const refuse = (code, detail) => ({ ...base, ok: false, status: 409, error: "inventory_refused", code, unitStatus: shown, detail });
  if (stage === "crossmatch") {
    const mine = unit.status === "reserved" && unit.episodeId === str(ctx.episodeId);
    if (unit.status !== "available" && !mine) return refuse("UNIT_NOT_AVAILABLE", `Unit ${unit.unitNumber} is ${shown} in the blood bank inventory and cannot be crossmatched.`);
    if (str(ctx.aboGroup) && up(ctx.aboGroup) !== unit.abo) return refuse("GROUP_MISMATCH", `Unit ${unit.unitNumber} is group ${unit.abo} on its test record, not ${up(ctx.aboGroup)}.`);
    if (str(ctx.rhD) && str(ctx.rhD).toLowerCase() !== unit.rhD) return refuse("RHD_MISMATCH", `Unit ${unit.unitNumber} is RhD ${unit.rhD} on its test record, not ${str(ctx.rhD)}.`);
    const asked = normComponent((episode && episode.component) || ctx.component);
    if (asked && asked !== unit.component) return refuse("COMPONENT_MISMATCH", `Unit ${unit.unitNumber} is ${unit.component}, and the request is for ${asked}.`);
    return { ...base, ok: true, tracked: true, unit: { unitId: unit.unitNumber, aboGroup: unit.abo, rhD: unit.rhD, component: unit.component, expiresAt: unit.expiresAt } };
  }
  if (unit.status !== "reserved" || unit.episodeId !== str(ctx.episodeId)) return refuse("UNIT_NOT_RESERVED", `Unit ${unit.unitNumber} is ${shown} in the blood bank inventory, not reserved for this request, and cannot be issued.`);
  return { ...base, ok: true, tracked: true, unit: { unitId: unit.unitNumber, status: unit.status } };
}

export {
  TTI, ABO, RHD, COMPONENTS,
  donationTests, unitTests, deferralInForce, unitStatuses, inventoryOf, normComponent, samplesOf, lookbackOf,
  bloodBankOverview, registerDonor, screenDonor, recordDonation, recordBloodTests, separateComponents, bloodUnitEvent, bloodUnitGate,
  poolUnits, registerSample, discardSample, recordDonorNotification,
};
