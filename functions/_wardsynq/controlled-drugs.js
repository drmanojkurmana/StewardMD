/* functions/_wardsynq/controlled-drugs.js - the NDPS / controlled-drug register, read from the stock ledger.
 *
 * THE LAW, AS READ (not paraphrased from memory). NDPS Rules 1985, Chapter VA/VB inserted by G.S.R. 359(E) of
 * 5 May 2015 (consolidated text, https://upload.indiacode.nic.in/showfile?actid=AC_CG_61_1073_00014_00014_1563259383370&type=rule&filename=the_narcotic_drugs_and_psychotropic_substances_rules,_1985_date_14.11.1985.pdf):
 *   r.52R(1)  a recognised medical institution (RMI) shall register the patients to whom essential narcotic drugs are
 *             dispensed; keep a separate record per patient in Form No. 3E; keep all receipts and disbursements in
 *             Form No. 3H (both preserved at least two years from the last entry); and file the calendar-year return
 *             in Form No. 3-I to the Controller of Drugs by 31 March of the following year.
 *   Form 3H   per drug, per day: opening stock; quantity received, received from, consignment note / bill / invoice
 *             number; quantity dispensed with the patient registration number (Form 3E) and quantity to each;
 *             closing stock; signature of the overall in-charge. "Entries shall be completed for each day before the
 *             close of the day."
 *   Form 3E   registration number; date; name; complete postal address with contact number; brief description of
 *             illness; whether registered with any other RMP or RMI; drugs dispensed (date, drug, quantity, remarks).
 *   Form 3-I  per drug: annual estimate, revised estimate, opening stock, procured, disbursed to patients, closing.
 *   r.52V(1)  expired stock "shall be destroyed by the recognised medical institution in the presence of an officer
 *             nominated by the Controller of Drugs".
 * Drugs and Cosmetics Rules 1945 r.65(3)(h) (G.S.R. 588(E), 30 Aug 2013; CDSCO consolidated text
 * https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/acts_rules/2016DrugsandCosmeticsAct1940Rules1945.pdf):
 * a Schedule H1 supply is recorded with the prescriber's name and address, the patient's name, the drug and the
 * quantity, kept three years.
 *
 * WHAT THE LAW DOES NOT SAY, AND THIS FILE DOES ANYWAY, MARKED AS HOSPITAL POLICY. No rule read requires a second
 * staff witness for a dispense, a dose or ward wastage, and none requires a physical count each shift (only the daily
 * book). WardSynQ requires the witness and offers the count because they are how a hospital finds a diversion, and
 * says on the screen that they are hospital policy, not the statute.
 *
 * ONE LEDGER. Nothing here stores a stock level or a second copy of a movement. Receipts, wastage and adjustments are
 * the StockMovement records stock.js writes; issues and returns are MedicationDispense (pharmacy-dispense.js); doses
 * given are MedicationAdministration (the eMAR). This file reads those and lays them out as the statutory book. The
 * only thing it adds to the store is a COUNT (registers.js, "ndpscount"), which checks the shelf against the book and
 * changes nothing in it.
 *
 * WHICH DRUGS. The hospital's drug master: the controlled-drug list on the Admin clinical settings screen
 * (wardsynq.controlledDrugs), and any formulary entry marked controlled: true. Matched on the whole normalised name or
 * code, never a substring - "morphine" must not catch a different product, the same rule formulary.js keeps.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { norm } from "./formulary.js";
import { quantityOf, levelsFrom } from "./stock.js";
import { saveEntry, listEntries } from "./registers.js";

const str = (v) => (v == null ? "" : String(v).trim());
const READ_CAP = 1000;
const POLICY_NOTE = "The second-person witness and the shift count are this hospital's policy. The NDPS Rules require the daily register (Form 3H), the per-patient record (Form 3E) and the annual return (Form 3-I); expired stock is destroyed in the presence of an officer nominated by the Controller of Drugs (rule 52V).";

/** PURE. The normalised names and codes this hospital flags as controlled. */
function controlledSet(cfg) {
  const w = cfg && typeof cfg === "object" ? cfg : {};
  const out = new Set();
  for (const n of Array.isArray(w.controlledDrugs) ? w.controlledDrugs : []) if (norm(n)) out.add(norm(n));
  for (const e of Array.isArray(w.formulary) ? w.formulary : []) {
    if (!e || e.controlled !== true) continue;
    for (const n of [e.drug, e.code, ...(Array.isArray(e.aliases) ? e.aliases : [])]) if (norm(n)) out.add(norm(n));
  }
  return out;
}

/** PURE. Is this drug (by name or code) on the hospital's controlled list? Whole-name match only. */
function isControlledDrug(cfg, drug, code, set) {
  const s = set || controlledSet(cfg);
  return !!((norm(code) && s.has(norm(code))) || (norm(drug) && s.has(norm(drug))));
}

/**
 * The second person, or the refusal. ctx.witnessId is who the recorder named; ctx.witnessCheck(id) answers whether that
 * id is an active member of this hospital allowed to witness (the route owns the membership lookup). Shared by stock
 * wastage, dispensing and the eMAR so the three cannot disagree about what a witness is.
 */
async function witnessOrRefusal(ctx, actorId) {
  const witnessId = str(ctx.witnessId);
  if (!witnessId) return { error: { ok: false, status: 422, error: "witness_required", detail: "This is a controlled drug. Name the second person who witnessed it." } };
  if (witnessId.toLowerCase() === str(actorId).toLowerCase()) return { error: { ok: false, status: 422, error: "witness_not_independent", detail: "The witness must be a different person from the one recording." } };
  if (typeof ctx.witnessCheck !== "function") return { error: { ok: false, status: 502, error: "witness_check_unavailable", detail: "The witness could not be checked, so nothing was recorded." } };
  let ok = false;
  try { ok = (await ctx.witnessCheck(witnessId)) === true; } catch { return { error: { ok: false, status: 502, error: "witness_check_failed", detail: "The witness could not be checked, so nothing was recorded." } }; }
  if (!ok) return { error: { ok: false, status: 422, error: "witness_not_staff", detail: "The witness is not an active member of this hospital who may witness a controlled drug." } };
  return { witnessId };
}

const dayOf = (iso) => str(iso).slice(0, 10);
const k3 = (code, location, unit) => `${norm(code)}|${norm(location)}|${norm(unit)}`;

/**
 * PURE. The register book: per controlled item (code, location, unit), every event in time order with the running
 * balance, the Form 3H day rows, and what is wrong (unwitnessed, negative, count discrepancies). The balance rules are
 * levelsFrom()'s own: an issue leaves the one store the item was received into, a returned issue is not an issue,
 * and a count or a dose given on the ward changes nothing in the book. The closing balance is cross-checked against
 * levelsFrom() itself, and a disagreement is reported rather than one of them trusted.
 */
function registerBook(input) {
  const i = input || {};
  const set = i.set || controlledSet(i.cfg);
  const from = str(i.from), to = str(i.to);
  const movements = (i.movements || []).filter((m) => m && isControlledDrug(null, m.display, m.code, set));
  const dispenses = (i.dispenses || []).filter((d) => d && isControlledDrug(null, d.drug, d.drugCode, set));
  const orders = new Map((i.orders || []).filter(Boolean).map((o) => [o.id, o]));
  const events = [];
  const receivedAt = new Map();
  for (const m of movements) {
    const q = quantityOf(m.quantity);
    if (q && (m.kind === "receipt" || m.kind === "transfer-in")) {
      const k = `${norm(m.code)}|${norm(q.unit)}`;
      const s = receivedAt.get(k) || new Set(); s.add(str(m.location) || null); receivedAt.set(k, s);
    }
  }
  const SIGN = { receipt: 1, "transfer-in": 1, adjustment: 1, wastage: -1, "transfer-out": -1 };
  for (const m of movements) {
    const q = quantityOf(m.quantity);
    if (!q || SIGN[m.kind] === undefined) continue;
    events.push({ at: str(m.at), kind: m.kind, code: str(m.code), display: str(m.display) || str(m.code), location: str(m.location) || null, unit: q.unit,
      delta: q.value * SIGN[m.kind], quantity: q.value, ref: { movementId: m.id }, by: m.by || null, witnessedBy: m.witnessedBy || null,
      reason: m.reason || null, batch: m.batch || null, receivedFrom: m.receivedFrom || null, documentNo: m.documentNo || null,
      needsWitness: m.kind === "wastage" || m.kind === "adjustment" });
  }
  for (const d of dispenses) {
    const q = quantityOf(d.quantity);
    if (!q) continue;
    const code = str(d.drugCode) || str(d.drug);
    const src = receivedAt.get(`${norm(code)}|${norm(q.unit)}`);
    const location = src && src.size === 1 ? [...src][0] : null;
    const base = { code, display: str(d.drug) || code, location, unit: q.unit, quantity: q.value, patientId: d.patientId || null, orderId: d.orderId || null, ref: { dispenseId: d.id }, batch: d.batch || null };
    events.push({ ...base, at: str(d.dispensedAt), kind: "issue", delta: -q.value, by: d.dispensedBy || null, witnessedBy: d.witnessedBy || null, destination: d.destination || null, needsWitness: true });
    if (d.state === "returned") events.push({ ...base, at: str(d.returnedAt), kind: "return", delta: q.value, by: d.returnedBy || null, reason: d.returnReason || null, needsWitness: false });
  }
  /* A dose given on the ward: already issued, so the book does not move. Shown so every issue can be followed to the
   * patient it reached, and so an issue with no dose recorded against it stands out. */
  for (const a of i.administrations || []) {
    if (!a || a.status !== "administered") continue;
    const o = orders.get(a.orderId);
    if (!o || !isControlledDrug(null, o.drug, o.drugCode, set)) continue;
    const code = str(o.drugCode) || str(o.drug);
    events.push({ at: str(a.administeredAt), kind: "administered", code, display: str(o.drug) || code, location: null, unit: null, delta: 0, quantity: null,
      dose: o.dose || null, patientId: a.patientId || o.patientId || null, orderId: o.id, ref: { administrationId: a.id }, by: a.administeredBy || null, witnessedBy: a.witnessedBy || null, needsWitness: true });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  const items = new Map();
  const itemFor = (e) => {
    const k = e.unit ? k3(e.code, e.location, e.unit) : null;
    if (!k) return null;
    if (!items.has(k)) items.set(k, { code: e.code, display: e.display, location: e.location, unit: e.unit, opening: 0, balance: 0, lines: [], days: new Map(), problems: [] });
    return items.get(k);
  };
  const doses = [];
  for (const e of events) {
    if (e.kind === "administered") { doses.push(e); continue; }
    const it = itemFor(e);
    if (!it) continue;
    const inPeriod = (!from || dayOf(e.at) >= from) && (!to || dayOf(e.at) < to);
    if (!inPeriod && (!from || dayOf(e.at) < from)) { it.opening += e.delta; it.balance += e.delta; continue; }
    if (!inPeriod) continue;
    it.balance += e.delta;
    const line = { ...e, balanceAfter: it.balance, unwitnessed: e.needsWitness && !e.witnessedBy };
    it.lines.push(line);
    if (line.unwitnessed) it.problems.push({ kind: "unwitnessed", at: e.at, ref: e.ref });
    if (it.balance < 0) it.problems.push({ kind: "negative_balance", at: e.at, balance: it.balance, ref: e.ref });
    const day = dayOf(e.at);
    const row = it.days.get(day) || { date: day, opening: it.balance - e.delta, received: 0, receivedFrom: [], documents: [], dispensed: 0, toPatients: [], wasted: 0, adjusted: 0, returned: 0, closing: 0 };
    if (e.kind === "receipt" || e.kind === "transfer-in") { row.received += e.quantity; if (e.receivedFrom) row.receivedFrom.push(e.receivedFrom); if (e.documentNo) row.documents.push(e.documentNo); }
    else if (e.kind === "issue") { row.dispensed += e.quantity; row.toPatients.push({ patientId: e.patientId, quantity: e.quantity }); }
    else if (e.kind === "return") row.returned += e.quantity;
    else if (e.kind === "wastage" || e.kind === "transfer-out") row.wasted += e.quantity;
    else if (e.kind === "adjustment") row.adjusted += e.delta;
    row.closing = it.balance;
    it.days.set(day, row);
  }
  for (const d of doses) {
    if ((from && dayOf(d.at) < from) || (to && dayOf(d.at) >= to)) continue;
    if (!d.witnessedBy) d.unwitnessed = true;
  }
  /* The cross-check. Two computations of the same book that disagree are a defect to see, not a number to pick. */
  const reference = levelsFrom(movements, dispenses).levels;
  const out = [...items.values()].map((it) => {
    const ref = reference.find((r) => k3(r.code, r.location, r.unit) === k3(it.code, it.location, it.unit));
    const mismatch = !to && ref && Math.abs(ref.level - it.balance) > 1e-9;
    return { code: it.code, display: it.display, location: it.location, unit: it.unit, opening: it.opening, closing: it.balance, lines: it.lines,
      form3h: [...it.days.values()], problems: it.problems, ...(mismatch ? { ledgerMismatch: { register: it.balance, stock: ref.level } } : {}) };
  }).sort((a, b) => a.display.localeCompare(b.display) || str(a.location).localeCompare(str(b.location)));
  return { items: out, doses: doses.filter((d) => (!from || dayOf(d.at) >= from) && (!to || dayOf(d.at) < to)) };
}

async function openRead(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    return { svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }), resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/**
 * The register for a period. ctx: { migration, actorDeps, recordDeps, cfg, actor, from?, to? (YYYY-MM-DD, to exclusive) }.
 * Reads the stock ledger as the signed-in person (pharmacist or ward in-charge), so the record's own read scope applies.
 */
async function ndpsRegister(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", items: [] };
  const from = str(ctx.from), to = str(ctx.to);
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) return { ...base, ok: false, status: 422, error: "bad_dates", message: "Give dates as YYYY-MM-DD." };
  const set = controlledSet(ctx.cfg);
  if (!set.size) return { ...base, ok: true, configured: false, items: [], doses: [], counts: [], message: "No drug is flagged as controlled. The pharmacy flags them on the Admin clinical settings screen (Controlled drugs).", policy: POLICY_NOTE };
  const { svc, error } = await openRead(request, env, ctx);
  if (error) return { ...base, ...error, items: [] };
  let movements, dispenses, administrations, orders;
  try {
    [movements, dispenses, administrations, orders] = await Promise.all([
      svc.list("StockMovement", READ_CAP), svc.list("MedicationDispense", READ_CAP),
      svc.list("MedicationAdministration", READ_CAP), svc.list("MedicationOrder", READ_CAP),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), items: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", message: "The stock ledger could not be read. Do not read this as an empty register.", items: [] };
  }
  const counts = await listEntries({ ...ctx, kind: "ndpscount", from: from || undefined, to: to || undefined });
  if (!counts.ok) return { ...base, ...counts, items: [] };
  const book = registerBook({ set, movements, dispenses, administrations, orders, from, to });
  const truncated = [movements, dispenses, administrations, orders].some((x) => (x || []).length >= READ_CAP);
  return {
    ...base, ok: true, configured: true, from: from || null, to: to || null, items: book.items, doses: book.doses,
    counts: counts.entries, discrepancies: counts.entries.filter((c) => c.fields && Number(c.fields.variance) !== 0).length,
    unwitnessed: book.items.reduce((n, it) => n + it.problems.filter((p) => p.kind === "unwitnessed").length, 0) + book.doses.filter((d) => d.unwitnessed).length,
    ...(truncated ? { truncated: true, truncatedWarning: `More than ${READ_CAP} records of one kind exist; only the newest were read, so this register may be incomplete and must not be filed as it stands.` } : {}),
    policy: POLICY_NOTE,
    retention: "Form 3E and Form 3H are kept at least two years from the last entry (NDPS Rules r.52R). WardSynQ keeps every entry and never deletes one.",
  };
}

/**
 * A shift count. The expected quantity is the book's, computed now by the server; the entry records the variance
 * and flags a discrepancy. It never adjusts stock. ctx: { migration, actorDeps, recordDeps, cfg, actor, code, location?,
 * unit, counted, shift?, note?, countedOn?, witnessId?, witnessCheck, idempotencyKey? }
 */
async function recordNdpsCount(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const code = str(ctx.code), unit = str(ctx.unit), counted = Number(ctx.counted);
  if (!code || !unit) return { ...base, ok: false, status: 422, error: "code_and_unit_required", written: 0 };
  if (str(ctx.counted) === "" || !Number.isFinite(counted) || counted < 0) return { ...base, ok: false, status: 422, error: "counted_required", message: "Give the number actually counted.", written: 0 };
  if (!isControlledDrug(ctx.cfg, code, code)) return { ...base, ok: false, status: 422, error: "not_controlled", message: "This drug is not on the hospital's controlled-drug list.", written: 0 };
  const w = await witnessOrRefusal(ctx, ctx.actor && ctx.actor.id);
  if (w.error) return { ...base, ...w.error, written: 0 };
  const { svc, error } = await openRead(request, env, ctx);
  if (error) return { ...base, ...error, written: 0 };
  let movements, dispenses;
  try { [movements, dispenses] = await Promise.all([svc.list("StockMovement", READ_CAP), svc.list("MedicationDispense", READ_CAP)]); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", written: 0 }; }
  if (movements.length >= READ_CAP || dispenses.length >= READ_CAP) return { ...base, ok: false, status: 409, error: "too_many_records", message: `More than ${READ_CAP} stock records exist, so the register quantity cannot be worked out safely. Nothing was recorded.`, written: 0 };
  const level = levelsFrom(movements, dispenses).levels.find((r) => k3(r.code, r.location, r.unit) === k3(code, ctx.location, unit));
  const expected = level ? level.level : 0;
  const r = await saveEntry({
    ...ctx, kind: "ndpscount", idempotencyKey: ctx.idempotencyKey,
    fields: { countedOn: str(ctx.countedOn) || new Date().toISOString().slice(0, 10), shift: ctx.shift, code, location: ctx.location, unit, counted, note: ctx.note },
    serverFields: { expected, variance: counted - expected },
    links: { witnessedBy: w.witnessId },
  });
  if (!r.ok) return { ...base, ...r };
  return { ...base, ok: true, written: 1, entry: r.entry, expected, counted, variance: counted - expected, discrepancy: counted !== expected,
    note: counted !== expected ? "The shelf and the register disagree. Nothing was adjusted: the pharmacist investigates and reconciles with a reason." : "The shelf matches the register." };
}

export { POLICY_NOTE, controlledSet, isControlledDrug, witnessOrRefusal, registerBook, ndpsRegister, recordNdpsCount };
