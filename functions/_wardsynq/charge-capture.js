/* functions/_wardsynq/charge-capture.js - billing what happened, never what was intended.
 *
 * #939 wired the claims engine: a code has to be supported by something already in the chart. This
 * is the other half - where the chargeable ITEMS come from - and it has one rule that decides
 * everything else in the file.
 *
 * A CHARGE COMES FROM WHAT WAS DONE, NEVER FROM WHAT WAS ORDERED. Capturing charges from orders is
 * the ordinary way to build this and it is wrong in a specific, expensive, patient-facing direction:
 * an order is an INTENTION. Doses get held, refused and cancelled; specimens do not get collected;
 * scans get abandoned. A system that bills from the order bills for medicine the patient declined
 * and tests nobody performed, and the patient is the one who receives that bill and has to argue
 * with it. So every item here comes from a record of an event that actually occurred, and the eMAR's
 * own state machine decides what "occurred" means: `administered` and nothing else. A `held` dose
 * has not been given, a `refused` dose was declined by the patient, and `scanned` means a nurse got
 * as far as the barcode. None of them are charges.
 *
 * IT WRITES NOTHING, ANYWHERE. Not to the chart - billing's write scope is `Claim` and
 * `PreAuthorisation` and the record service refuses the rest, which is the guarantee #939 rests on -
 * and not to the record at all. The charge list is COMPUTED on every request and never stored, for
 * the same reason ward-metrics.js and quality.js are: a stored charge list stops being true the
 * moment a result is corrected or an administration is amended, and a stale one is worse than none
 * because somebody bills from it.
 *
 * AN UNPRICED ITEM IS LISTED, NEVER DROPPED AND NEVER FREE. There is no default rate card and there
 * will not be one: inventing prices is the same class of mistake as inventing a diagnosis, and a
 * hospital's tariff is a commercial and regulatory document. `wardsynq.tariff` supplies it. An item
 * with no tariff entry appears in `unpriced` with its code, because an item silently dropped is
 * revenue nobody knows was lost, and an item quietly priced at zero is worse - it reads as a
 * deliberate decision to give something away.
 *
 * NOTHING HERE IS A CHARGE UNTIL A HUMAN CODES IT. The output is a proposal. It becomes a claim only
 * through `billing.js`, which still refuses any diagnosis the record does not document. This file
 * cannot create a claim and has no path to one.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, isExternalRecord } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ADMISSION_CLASSES } from "./migrate-inpatient.js";

const str = (v) => (v == null ? "" : String(v).trim());

/**
 * WHAT COUNTS AS HAVING HAPPENED, per resource type.
 *
 * Enumerated rather than expressed as "not cancelled", deliberately: a negative rule silently
 * accepts every state added later, and the state added later is usually the ambiguous one.
 */
const HAPPENED = Object.freeze({
  /* The eMAR's own terminal "given". `held`, `refused`, `scanned` and `cancelled` are all doses that
   * were not administered, and three of them are states a busy ward produces every day. */
  MedicationAdministration: Object.freeze(["administered"]),
  /* A released report. A preliminary result may still be superseded and is not a completed test -
   * billing for it means billing again when it finalises, or never correcting if it is withdrawn. */
  DiagnosticReport: Object.freeze(["final", "corrected"]),
  /* The sample was taken. A collection is the billable act for a phlebotomy line; the test itself
   * bills from its report, which is why both are here and neither stands in for the other. */
  SpecimenCollection: Object.freeze(["collected", "received"]),
  /* Medicine physically issued. Deliberately separate from the administration: a hospital that
   * charges for supply and a hospital that charges for the dose given are both real, and a site
   * choosing one puts only that code in its tariff. Nothing here decides which. */
  MedicationDispense: Object.freeze(["dispensed", "issued"]),
});

/* TASK 4.18's own end-to-end journey test found this: two of the four resource models here name
 * their own lifecycle field `state`, not `status` - pharmacy-dispense.js's own MedicationDispense
 * and specimen.js's own SpecimenCollection. This file had read `row.status` for all four since it
 * was written, which meant a dispensed drug or a collected specimen could NEVER be captured as a
 * charge: `row.status` was always undefined for those two types, so every one of them fell through
 * to "did_not_happen" regardless of its real state. Named here, once, rather than guessed per call
 * site - a second place this could drift silently if left implicit. */
const STATUS_FIELD = Object.freeze({ MedicationDispense: "state", SpecimenCollection: "state" });

/** PURE. The code an item is priced by, and what it is called on a bill. */
function itemFrom(resourceType, row) {
  const r = row || {};
  if (resourceType === "MedicationAdministration") {
    return { code: str(r.drugCode) || str(r.drug), display: str(r.drug) || str(r.drugCode), at: r.givenAt || r.at || null };
  }
  if (resourceType === "DiagnosticReport") {
    return { code: str(r.code), display: str(r.code) || "Report", at: r.reportedAt || null };
  }
  if (resourceType === "SpecimenCollection") {
    return { code: str(r.code) || "specimen-collection", display: str(r.display) || "Specimen collection", at: r.collectedAt || r.at || null };
  }
  if (resourceType === "MedicationDispense") {
    return { code: str(r.drugCode) || str(r.drug), display: str(r.drug) || str(r.drugCode), at: r.dispensedAt || r.at || null };
  }
  return null;
}

/**
 * PURE. Every event that actually happened, as a chargeable item.
 *
 * `slices` is `{MedicationAdministration: [...], DiagnosticReport: [...], ...}`.
 * Returns `{items, skipped}` - skipped carries WHY, because "we did not bill for this" is a fact a
 * finance office needs and an empty list does not carry.
 */
function capturableFrom(slices) {
  const items = [], skipped = [];
  for (const type of Object.keys(HAPPENED)) {
    for (const row of (slices && slices[type]) || []) {
      if (!row) continue;
      /* A dose another hospital gave, a report another laboratory released: real events, on this
       * chart because a feed brought them, and NOT this hospital's to bill. Named as skipped so a
       * finance office can see they were seen. */
      const statusField = STATUS_FIELD[type] || "status";
      if (isExternalRecord(row)) {
        skipped.push({ sourceType: type, sourceId: row.id || null, status: str(row[statusField]) || null, reason: "external_source", system: row.meta.source.system });
        continue;
      }
      const status = str(row[statusField]);
      if (!HAPPENED[type].includes(status)) {
        /* Named, not silently absent. A held dose and a dose nobody charted look identical on a
         * bill that lists neither, and only one of them is a charge somebody should chase. */
        skipped.push({ sourceType: type, sourceId: row.id || null, status: status || null, reason: "did_not_happen" });
        continue;
      }
      const it = itemFrom(type, row);
      if (!it || !it.code) {
        skipped.push({ sourceType: type, sourceId: row.id || null, status, reason: "no_code" });
        continue;
      }
      items.push({ ...it, sourceType: type, sourceId: row.id || null, patientId: row.patientId || null, quantity: 1 });
    }
  }
  return { items, skipped };
}

/**
 * PURE. Applies the hospital's tariff.
 *
 * Returns `{priced, unpriced, total, currency}`. `total` is the sum of the PRICED items only, and
 * `unpriced` is never folded into it at zero.
 */
function priceWith(items, tariff) {
  const table = tariff && typeof tariff === "object" ? tariff : {};
  const byCode = {};
  for (const k of Object.keys(table)) byCode[str(k).toUpperCase()] = k;

  const priced = [], unpriced = [];
  let total = 0, currency = null;

  for (let it of items || []) {
    /* By code, then by the name it was recorded under. A released report carries the test's name as
     * its code ("Complete blood count"), and the price list names the test the same way, so a price
     * set on the Price list screen reaches the bill without anybody learning an internal code. The
     * line is billed under the price list's own key, which is also what GST is looked up by. */
    const key = byCode[str(it.code).toUpperCase()] || byCode[str(it.display).toUpperCase()];
    const entry = key === undefined ? undefined : table[key];
    if (key !== undefined && key !== it.code) it = { ...it, code: key };
    const amount = entry && typeof entry === "object" ? Number(entry.amount) : Number(entry);
    /* `Number("")` is 0 and 0 is finite. A tariff entry that exists and carries no amount is a
     * configuration mistake, and treating it as a price of zero would silently give the item away. */
    if (!entry || entry.amount === "" || entry.amount === null || !Number.isFinite(amount)) {
      unpriced.push({ ...it, reason: entry ? "tariff_entry_has_no_amount" : "no_tariff_entry" });
      continue;
    }
    const cur = (entry && typeof entry === "object" && str(entry.currency)) || null;
    /* One bill, one currency. A total summed across two currencies is a number with no meaning, and
     * it would look exactly like a correct one. */
    if (cur && currency && cur !== currency) {
      unpriced.push({ ...it, reason: "currency_mismatch", currency: cur });
      continue;
    }
    if (cur && !currency) currency = cur;
    const line = amount * (Number(it.quantity) || 1);
    priced.push({ ...it, amount, currency: cur, line, description: (entry && entry.description) || it.display });
    total += line;
  }
  // Money, rounded once at the end rather than per line.
  return { priced, unpriced, total: Math.round(total * 100) / 100, currency };
}

/**
 * PURE. The one price table charges are priced from: the hospital's configured `wardsynq.tariff`
 * and the Price list the Admin Center edits (q_tariff rows, prices in paise).
 *
 * Until LT-30 the ward bill read ONLY the configuration, while the Price list screen wrote only
 * q_tariff, so an administrator could set every price on screen and the bill still said "no price
 * set". A Price list row wins over a configured entry with the same key: it is the one the hospital
 * can see and change, and its changes are audited. A row is keyed by its code, and by its name
 * when it has no code. A withdrawn row prices nothing.
 */
const DAILY_KINDS = Object.freeze(["bed", "nursing", "visit"]);
function tariffTable(configTariff, priceListRows) {
  const out = {};
  const cfg = configTariff && typeof configTariff === "object" ? configTariff : {};
  for (const k of Object.keys(cfg)) out[k] = cfg[k];
  for (const r of priceListRows || []) {
    if (!r || r.active === false) continue;
    const key = str(r.code) || str(r.name);
    const paise = Number(r.price);
    if (!key || !Number.isFinite(paise) || paise < 0) continue;
    for (const k of Object.keys(out)) if (k.toUpperCase() === key.toUpperCase()) delete out[k];
    out[key] = { amount: paise / 100, description: str(r.name) || key, kind: str(r.kind) || null, ward: str(r.ward) || null,
      ...(r.gstRate !== undefined && r.gstRate !== null && r.gstRate !== "" ? { gstRate: r.gstRate } : {}),
      ...(str(r.hsnSac) ? { hsnSac: str(r.hsnSac) } : {}), ...(r.intensiveCare === true ? { intensiveCare: true } : {}) };
    // A test is also found by its name, so a coded row still prices a report recorded under the name.
    if (str(r.code) && str(r.name) && !Object.keys(out).some((k) => k.toUpperCase() === str(r.name).toUpperCase())) out[str(r.name)] = out[key];
  }
  return out;
}

const DAY_MS = 86400000;
/**
 * PURE. The days of an inpatient stay, each with the ward the patient was on when the day began.
 * A day is charged once it has started: admitted at 09:00 and still here at 09:01 the next morning
 * is two days. `versions` is the Encounter's history (oldest first) so a transfer moves the ward
 * from the day it happened; without it every day is on the current ward.
 * ponytail: the ward at the START of each day, not the ward the patient spent most of it on. Split
 * a day at the transfer time if a hospital bills that way.
 */
function stayDays(encounter, versions, nowMs) {
  const start = Date.parse(str(encounter && encounter.periodStart));
  const end = encounter && encounter.periodEnd ? Date.parse(str(encounter.periodEnd)) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  // ponytail: capped at a year of days per stay; a longer stay is billed in parts.
  const count = Math.min(366, Math.max(1, Math.ceil((end - start) / DAY_MS)));
  const moves = (versions || []).filter(Boolean);
  const days = [];
  for (let n = 1; n <= count; n++) {
    const t = start + (n - 1) * DAY_MS;
    let ward = str(encounter.location && encounter.location.ward);
    if (moves.length) {
      ward = str(moves[0].location && moves[0].location.ward) || ward;
      for (const v of moves) { const m = Date.parse(str(v.movedAt)); if (Number.isFinite(m) && m <= t) ward = str(v.location && v.location.ward) || ward; }
    }
    days.push({ n, at: new Date(t).toISOString(), ward });
  }
  return days;
}

/**
 * PURE. What a stay day is charged: its bed, and any nursing or doctor-visit charge the price list
 * sets per day. A bed is ONE line a day (the ward's own bed price, else the hospital-wide one) and
 * is listed with no price when neither exists, because a stay with no bed charge is a gap, not a
 * gift. Nursing and visit charges exist only where the price list names them.
 */
function stayDayItems(encounter, days, table) {
  const entries = Object.keys(table || {}).map((k) => ({ key: k, e: table[k] })).filter((x) => x.e && typeof x.e === "object" && DAILY_KINDS.includes(x.e.kind));
  const sameWard = (e, ward) => str(e.ward).toUpperCase() === str(ward).toUpperCase();
  const seen = new Set(), items = [];
  for (const d of days || []) {
    const bed = entries.find((x) => x.e.kind === "bed" && x.e.ward && sameWard(x.e, d.ward)) || entries.find((x) => x.e.kind === "bed" && !x.e.ward);
    items.push({ code: bed ? bed.key : "BED-DAY", display: bed ? (bed.e.description || bed.key) : `Bed per day${d.ward ? ", " + d.ward : ""}`,
      at: d.at, ward: d.ward || null, day: d.n, sourceType: "Encounter", sourceId: `${encounter.id}:bed:${d.n}`, patientId: encounter.patientId || null, quantity: 1 });
    for (const x of entries) {
      if (x.e.kind === "bed" || (x.e.ward && !sameWard(x.e, d.ward)) || seen.has(`${x.e.description}:${d.n}`)) continue;
      seen.add(`${x.e.description}:${d.n}`);
      items.push({ code: x.key, display: x.e.description || x.key, at: d.at, ward: d.ward || null, day: d.n,
        sourceType: "Encounter", sourceId: `${encounter.id}:${x.e.kind}:${x.key}:${d.n}`, patientId: encounter.patientId || null, quantity: 1 });
    }
  }
  return items;
}

async function open_(request, env, ctx, need) {
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

/** ctx: { migration, patientId, encounterId?, tariff? } - what could be charged, computed now. */
async function chargesForPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", items: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", items: [] };

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, items: [] };

  const types = Object.keys(HAPPENED);
  /* A slice that could not be read is NAMED, not treated as nothing done. Reading it as empty is
   * how a bill looks settled when the doses on it were simply not visible to this request. */
  const unreadable = [];
  let slices, stays = [];
  try {
    const rows = await Promise.all(types.map((t) => svc.byPatient(t, patientId).catch(() => { unreadable.push(t); return []; })));
    slices = {};
    types.forEach((t, i) => { slices[t] = (rows[i] || []).filter(Boolean); });
    stays = (await svc.byPatient("Encounter", patientId).catch(() => { unreadable.push("Encounter"); return []; }))
      .filter((e) => e && !isExternalRecord(e) && ADMISSION_CLASSES.includes(e.class));
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), items: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), items: [] };
  }

  /* Scoped to one visit when asked. A charge list that spans every admission a patient ever had is
   * how last year's care ends up on this year's bill. */
  const encounterId = str(ctx.encounterId);
  if (encounterId) {
    for (const t of types) slices[t] = slices[t].filter((r) => str(r.encounterId) === encounterId);
    stays = stays.filter((e) => e.id === encounterId);
  }

  const { items, skipped } = capturableFrom(slices);
  /* The days of each inpatient stay: a bed occupied is care that happened, like a dose given. The
   * version history says which ward each day was on; if it cannot be read, the current ward is used
   * and the charge list says so. */
  const nowMs = Number.isFinite(Date.parse(str(ctx.now))) ? Date.parse(str(ctx.now)) : Date.now();
  let histories = new Map();
  if (stays.length) {
    try { histories = await svc.histories("Encounter", stays.map((e) => e.id)); }
    catch { histories = new Map(); }
  }
  let wardHistoryUnread = 0;
  for (const e of stays) {
    const versions = histories.get(e.id);
    if (!versions) wardHistoryUnread += 1;
    items.push(...stayDayItems(e, stayDays(e, versions || null, nowMs), ctx.tariff));
  }
  const { priced, unpriced, total, currency } = priceWith(items, ctx.tariff);

  return {
    ...base, ok: true, patientId, encounterId: encounterId || null,
    items, priced, unpriced, total, currency,
    ...(unreadable.length ? { unreadable, unreadableWarning: `Could not read: ${unreadable.join(", ")}. Do not read the charge list as complete.` } : {}),
    ...(wardHistoryUnread ? { wardHistoryWarning: "The ward history of a stay could not be read, so its bed days are charged at the current ward." } : {}),
    /* Said every time. Nothing here is a charge, and the number is a proposal computed from the
     * record as it stands this second. */
    notCharged: skipped,
    tariffConfigured: !!(ctx.tariff && Object.keys(ctx.tariff).length),
    ...(ctx.tariff && Object.keys(ctx.tariff).length ? {} : {
      tariffWarning: "No prices are set for this hospital, so nothing is priced. An administrator sets them on the Price list in the Admin Center. There is no default rate card: a price list is a commercial and regulatory document, not a default.",
    }),
    ...(unpriced.length ? {
      unpricedWarning: `${unpriced.length} item${unpriced.length === 1 ? " has" : "s have"} no price. They are listed rather than dropped: an item silently omitted is revenue nobody knows was lost, and one quietly priced at zero reads as a decision to give it away.`,
    } : {}),
    note: "Captured from what was DONE, never from what was ordered: a held or refused dose and an uncollected specimen are not charges. This is a proposal and nothing has been billed - a claim is coded by a person through the claim route, which still refuses any diagnosis the record does not document.",
  };
}

export { HAPPENED, DAILY_KINDS, itemFrom, capturableFrom, priceWith, tariffTable, stayDays, stayDayItems, chargesForPatient };
