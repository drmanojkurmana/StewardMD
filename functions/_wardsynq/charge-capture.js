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
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

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
      const status = str(row.status);
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
  for (const k of Object.keys(table)) byCode[str(k).toUpperCase()] = table[k];

  const priced = [], unpriced = [];
  let total = 0, currency = null;

  for (const it of items || []) {
    const entry = byCode[str(it.code).toUpperCase()];
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
  let slices;
  try {
    const rows = await Promise.all(types.map((t) => svc.byPatient(t, patientId).catch(() => [])));
    slices = {};
    types.forEach((t, i) => { slices[t] = (rows[i] || []).filter(Boolean); });
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), items: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), items: [] };
  }

  /* Scoped to one visit when asked. A charge list that spans every admission a patient ever had is
   * how last year's care ends up on this year's bill. */
  const encounterId = str(ctx.encounterId);
  if (encounterId) {
    for (const t of types) slices[t] = slices[t].filter((r) => str(r.encounterId) === encounterId);
  }

  const { items, skipped } = capturableFrom(slices);
  const { priced, unpriced, total, currency } = priceWith(items, ctx.tariff);

  return {
    ...base, ok: true, patientId, encounterId: encounterId || null,
    items, priced, unpriced, total, currency,
    /* Said every time. Nothing here is a charge, and the number is a proposal computed from the
     * record as it stands this second. */
    notCharged: skipped,
    tariffConfigured: !!(ctx.tariff && Object.keys(ctx.tariff).length),
    ...(ctx.tariff && Object.keys(ctx.tariff).length ? {} : {
      tariffWarning: "This hospital has not configured wardsynq.tariff, so nothing is priced. There is no default rate card and there will not be one: a tariff is a commercial and regulatory document, not a default.",
    }),
    ...(unpriced.length ? {
      unpricedWarning: `${unpriced.length} item${unpriced.length === 1 ? " has" : "s have"} no price. They are listed rather than dropped: an item silently omitted is revenue nobody knows was lost, and one quietly priced at zero reads as a decision to give it away.`,
    } : {}),
    note: "Captured from what was DONE, never from what was ordered: a held or refused dose and an uncollected specimen are not charges. This is a proposal and nothing has been billed - a claim is coded by a person through the claim route, which still refuses any diagnosis the record does not document.",
  };
}

export { HAPPENED, itemFrom, capturableFrom, priceWith, chargesForPatient };
