/* functions/_wardsynq/opening-balance.js - the old system's balance on a stay open at switch-over (owner 2026-10-04).
 *
 * When a hospital moves to WardSynQ, every patient already admitted carries what they owe on the old system's bill. Each
 * such stay gets ONE opening-balance line: the amount, the old bill's reference, the date it was struck as of, and who
 * entered it. New charges add from there.
 *
 * ONE PER STAY, AND ENTERING IT AGAIN CHANGES NOTHING. The record's id is the stay's, written create-only. The same
 * amount, reference and date again (a re-run import, a double tap) is matched and nothing is written; a different one is
 * refused by name, because a carried balance silently replaced is money nobody can account for. A mistake found after
 * entry is corrected on the bill (an adjustment or a credit note, each with its reason), never by overwriting the line.
 *
 * NOT TAXED AGAIN. The old system already raised (and taxed) the supplies behind it, so the line carries no GST, is left
 * out of the GST document on the bill (invoice.js documentsOf) and out of e-invoice reporting, and a bill with nothing
 * else on it takes no invoice number. It is the FIRST line on the stay's bill (charge-capture.js, packages.js), and the
 * bill's balance, deposits and payments treat it like any other charge.
 *
 * A STAY THAT IS OPEN, AT THIS HOSPITAL. The patient is admitted through the usual admission door first; this file never
 * creates a stay. Reached two ways: one at a time (POST /ward/opening-balance) and from a CSV of the old system's open
 * stays (legacy-import.js, kind openingBalances), both needing billing.charge AND staff.admin, both audited.
 */
import { VersionConflictError } from "./repository.js";
import { RecordService, isExternalRecord } from "./service.js";
import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { ADMISSION_CLASSES, OPEN } from "./migrate-inpatient.js";
import { istDateOf } from "../_region_in.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "OpeningBalance";
const CODE = "OPENING-BALANCE";
const KIND = "opening_balance";
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const idFor = (encounterId) => (slug(encounterId) ? `wsq-ob-${slug(encounterId)}` : null);
const AADHAAR = /(^|\D)\d{4}\s?\d{4}\s?\d{4}(\D|$)/;

/** PURE. Whether an invoice line (or a priced charge) is a carried opening balance. */
const isOpeningBalanceLine = (l) => !!l && (l.kind === KIND || l.sourceType === TYPE);

/**
 * PURE. The three facts a person types: { value: { amountPaise, legacyBillRef, asOf } } or { error, field, detail }.
 * amount: rupees, at most two decimals, above zero (commas allowed). asOf: YYYY-MM-DD (a CSV day is converted by the
 * caller), not after today in India.
 */
function validateOpeningBalance(input, nowMs) {
  const i = input && typeof input === "object" ? input : {};
  const amt = str(i.amount).replace(/,/g, "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amt) || !(Number(amt) > 0)) {
    return { error: "bad_amount", field: "amount", detail: "The balance is a plain amount in rupees above zero, like 45000 or 45000.50. A credit carried from the old system is recorded as a deposit on the bill." };
  }
  const ref = str(i.legacyBillRef);
  if (!ref || ref.length > 80) return { error: "legacy_bill_ref_required", field: "legacyBillRef", detail: "Give the old system's bill number (up to 80 characters), so the balance can be traced back." };
  if (AADHAAR.test(ref)) return { error: "aadhaar_not_stored", field: "legacyBillRef", detail: "This looks like an Aadhaar number. Aadhaar is not stored." };
  const asOf = str(i.asOf);
  const t = Date.parse(asOf + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== asOf) {
    return { error: "bad_as_of", field: "asOf", detail: "Give the date the old bill was struck as of, as a real date." };
  }
  const today = istDateOf(new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString());
  if (asOf > today) return { error: "bad_as_of", field: "asOf", detail: "The balance cannot be as of a day that has not come yet." };
  return { value: { amountPaise: Math.round(Number(amt) * 100), legacyBillRef: ref, asOf } };
}

/** PURE. The priced charge an opening balance puts on its stay's bill, in the shape charge-capture.js prices. */
function openingLine(rec) {
  const amount = Math.round(Number(rec.amountPaise)) / 100;
  return { code: CODE, display: `Opening balance carried from the previous system (bill ${str(rec.legacyBillRef)}, as of ${str(rec.asOf)})`,
    quantity: 1, amount, line: amount, sourceType: TYPE, sourceId: str(rec.id), kind: KIND, patientId: str(rec.patientId) || null, encounterId: str(rec.encounterId) || null,
    legacyBillRef: str(rec.legacyBillRef), asOf: str(rec.asOf) };
}

/** PURE. The same three facts. */
const sameBalance = (rec, v) => !!rec && Number(rec.amountPaise) === v.amountPaise && str(rec.legacyBillRef) === v.legacyBillRef && str(rec.asOf) === v.asOf;

/**
 * The patient's open inpatient stay at this hospital: the one named (it must be this patient's and open), else the only
 * one. { encounter } or { error, detail }. A read that fails throws.
 */
async function openStayOf(svc, patientId, encounterId) {
  const stays = ((await svc.byPatient("Encounter", patientId)) || [])
    .filter((e) => e && !isExternalRecord(e) && ADMISSION_CLASSES.includes(e.class) && str(e.patientId) === patientId);
  const open = stays.filter((e) => e.status === OPEN);
  if (encounterId) {
    const e = stays.find((x) => str(x.id) === encounterId);
    if (!e) return { error: "encounter_not_this_patient", detail: "That stay is not this patient's." };
    if (e.status !== OPEN) return { error: "stay_not_open", detail: "That stay is closed. An opening balance is only carried onto a stay open at switch-over." };
    return { encounter: e };
  }
  if (!open.length) return { error: "no_open_stay", detail: "This patient has no open stay in WardSynQ. Admit them first, then carry the balance." };
  if (open.length > 1) return { error: "several_open_stays", detail: "This patient has more than one open stay. Name the stay." };
  return { encounter: open[0] };
}

/** The record already on a stay, or null. A read that fails throws. */
async function existingFor(svc, encounterId) {
  return (await svc.get(TYPE, idFor(encounterId))) || null;
}

/**
 * Writes one stay's opening balance, create-only. { status: "created" | "matched", record } or { error, status, detail }.
 * source: "single" | "import".
 */
async function writeOpeningBalance(svc, actorId, { encounter, value, source, at }) {
  const id = idFor(encounter.id);
  const prior = await existingFor(svc, encounter.id);
  if (prior) return sameBalance(prior, value) ? { status: "matched", record: prior } : conflict(prior);
  const record = { resourceType: TYPE, id, patientId: str(encounter.patientId), encounterId: str(encounter.id), ...value,
    enteredBy: actorId, enteredAt: str(at) || new Date().toISOString(), entry: source === "import" ? "import" : "single",
    note: "Carried from the previous system at switch-over. Not taxed again." };
  try {
    const out = await svc.put(record, { expectedVersion: 0 });
    return { status: "created", record: { ...record, version: out.record.version } };
  } catch (e) {
    if (!(e instanceof VersionConflictError)) throw e;
    /* Written meanwhile by somebody else: the same balance is a match, a different one is refused. */
    const now = await existingFor(svc, encounter.id);
    return sameBalance(now, value) ? { status: "matched", record: now } : conflict(now);
  }
}
const conflict = (rec) => ({ error: "opening_balance_exists", status: 409, existing: rec ? { amountPaise: rec.amountPaise, legacyBillRef: rec.legacyBillRef, asOf: rec.asOf } : null,
  detail: rec ? `This stay already carries an opening balance of Rs ${(Number(rec.amountPaise) / 100).toFixed(2)} (old bill ${rec.legacyBillRef}, as of ${rec.asOf}). It is not replaced; correct it on the bill with an adjustment or a credit note.`
    : "This stay already carries a different opening balance. It is not replaced." });

/**
 * POST /ward/opening-balance. ctx: { migration, actorDeps, recordDeps, patientId, encounterId?, amount, legacyBillRef, asOf,
 *   nowMs?, audit(action, meta) }. The router has already checked billing.charge and staff.admin.
 */
async function recordOpeningBalance(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", detail: "Choose the patient.", written: 0 };
  const v = validateOpeningBalance(ctx, ctx.nowMs);
  if (v.error) return { ...base, ok: false, status: 422, error: v.error, field: v.field, detail: v.detail, written: 0 };
  let svc, actorId;
  try {
    const resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
    svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    actorId = resolved.actor.id;
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message), written: 0 };
  }
  try {
    const stay = await openStayOf(svc, patientId, str(ctx.encounterId));
    if (stay.error) return { ...base, ok: false, status: stay.error === "no_open_stay" || stay.error === "stay_not_open" ? 409 : 422, error: stay.error, detail: stay.detail, written: 0 };
    const out = await writeOpeningBalance(svc, actorId, { encounter: stay.encounter, value: v.value, source: "single" });
    if (out.error) return { ...base, ok: false, status: out.status, error: out.error, existing: out.existing, detail: out.detail, written: 0 };
    if (out.status === "created") await ctx.audit("opening_balance", `stay ${stay.encounter.id} amountPaise ${v.value.amountPaise} asOf ${v.value.asOf}`).catch(() => null);
    return { ...base, ok: true, written: out.status === "created" ? 1 : 0, ...(out.status === "matched" ? { matched: true, detail: "This stay already carries exactly this opening balance. Nothing was written." } : {}),
      openingBalance: out.record, line: openingLine(out.record) };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), written: 0 };
    return { ...base, ok: false, status: 502, error: "record_failed", detail: "The stay or its opening balance could not be read or written. Nothing was changed.", written: 0 };
  }
}

export { TYPE, CODE, KIND, idFor, isOpeningBalanceLine, validateOpeningBalance, openingLine, sameBalance, openStayOf, existingFor, writeOpeningBalance, recordOpeningBalance };
