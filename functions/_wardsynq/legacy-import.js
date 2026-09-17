/* functions/_wardsynq/legacy-import.js - loading a replaced HIS's patients, price list and suppliers (R2-5, gap 16 first slice).
 *
 * ALWAYS A DRY RUN FIRST. The same call without `commit` reads the file against what the hospital already holds and says,
 * row by row, what would happen: create, matched (already here, left alone), duplicate (a patient who may already be here,
 * not created) or invalid (the field and the reason). A commit re-runs exactly that check and writes only when the rows it
 * would create are the ones the dry run showed (`confirmCount` and `planId`); anything that changed in between refuses the
 * whole commit with nothing written (the hr-attendance-import pattern).
 *
 * NOTHING IS WRITTEN AROUND THE EXISTING DOORS.
 * - Patients go through the desk's registration (_opd_patient_store.js registerPatient: its validation, its MR number rule and
 *   its same-mobile duplicate refusal) and then the record master (migrate-registration.js registerPatientRecord). The
 *   legacy MR number is kept as a `legacy-mrn` identifier; with the hospital's own numbering on (wardsynq.externalMrn) it is
 *   also the MR number. An MR number already in use is never written over, and a possible duplicate (same mobile, or the
 *   identity engine agreeing on name and date of birth) is never merged: it is reported for the Patients screen's merge.
 * - Prices go to the Price list, the one table the ward and OPD invoice paths read (router wsqTariff: with the clinic billing
 *   store on it is the ONLY price table), through the same validateTariff and audited upsert as the Price list screen. A
 *   price already on the list is matched and never changed here; changing one stays on the Price list screen.
 * - Suppliers are Vendor records through RecordService, one per name at the id purchasing.js rate contracts use.
 *
 * OUT OF SCOPE BY DECISION (owner and accountant, audit O4): open stays, balances, deposits and GST documents. No row type
 * here can create an encounter, a bill line or an invoice. Aadhaar has no column to map to, and a mapped text field that
 * holds a 12-digit Aadhaar-shaped number refuses its row rather than store it.
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { findCandidates } from "../../wardsynq/wardsynq-mpi.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { parseCsv } from "./hr-attendance.js";
import { registerPatientRecord } from "./migrate-registration.js";
import { validateRegistration } from "../_opd_patient.js";
import { validateTariff } from "../_clinic_billing.js";

const str = (v) => (v == null ? "" : String(v).trim());
const refuse = (status, error, message, extra) => ({ ok: false, status, error, message, written: 0, ...(extra || {}) });
const MAX_CSV_BYTES = 2 * 1024 * 1024;
/* ponytail: row caps per run. A patient costs several store calls one after another inside one request, so a run is kept
 * well inside a Worker's budget; a larger file is split. Raise with a queued import if a hospital needs one file. */
const ROW_CAP = { patients: 100, prices: 500, vendors: 500 };
// ponytail: the name and date of birth comparison reads one page of patients (as mpi-view.js); exact checks are index seeks.
const NAME_POOL = 500;
const LIST_CAP = 500;   // BILL.listTariff and the Vendor list read at most this many; a full page cannot rule out a match
const AADHAAR = /(^|\D)\d{4}\s?\d{4}\s?\d{4}(\D|$)/;

const FIELDS = {
  patients: { required: ["legacyMrn", "name", "mobile", "gender"], optional: ["birthDate", "ageYears", "address", "district", "state", "pincode"] },
  prices: { required: ["name", "kind", "price"], optional: ["code", "ward", "hsnSac", "gstRate", "nonHealthcare", "intensiveCareClass", "unitHours"] },
  vendors: { required: ["name"], optional: ["gstin", "phone", "email", "address", "drugLicenceNo"] },
};
const KINDS = ["investigation", "medication", "service", "bed", "nursing", "visit"];

async function sha16(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const vendorIdFor = (name) => (slug(name) ? `wsq-vendor-${slug(name)}` : null);

/** PURE. A day as the file writes it, in the chosen order, to YYYY-MM-DD; "" when it is not a real day. */
function dayOf(text, order) {
  const p = str(text).split(/[\/.\-\s]+/);
  if (p.length !== 3 || !p.every((x) => /^\d+$/.test(x))) return "";
  const [y, m, d] = order === "dmy" ? [p[2], p[1], p[0]] : order === "mdy" ? [p[2], p[0], p[1]] : p;
  if (y.length !== 4) return "";
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const t = Date.parse(iso + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : "";
}

/** PURE. The mapped cells of one line: { field: text }. A column index outside the line reads as empty. */
function cellsOf(line, mapping, fields) {
  const out = {};
  for (const f of fields) {
    const col = mapping[f];
    out[f] = col === undefined || col === null || col === "" ? "" : str(line[Number(col)]);
  }
  return out;
}

const invalid = (row, label, field, detail) => ({ row, status: "invalid", label, field, reason: detail });

/** PURE. One patient line to the desk's registration body, or the refusal. */
function patientRow(row, cells, ctx) {
  const label = cells.legacyMrn || cells.name;
  if (!cells.legacyMrn) return invalid(row, label, "legacyMrn", "The legacy MR number is empty. It is how this patient is found again.");
  for (const f of ["name", "address", "district", "state"]) {
    if (AADHAAR.test(cells[f])) return invalid(row, label, f, "This looks like an Aadhaar number. Aadhaar is not stored; remove it from the file.");
  }
  const g = cells.gender.toLowerCase();
  const gender = { m: "male", f: "female", o: "other" }[g] || g;
  let birthDate = "";
  if (cells.birthDate) {
    birthDate = dayOf(cells.birthDate, ctx.dateOrder);
    if (!birthDate) return invalid(row, label, "birthDate", "The date of birth is not a real date in the chosen date order.");
  }
  const body = { name: cells.name, mobile: cells.mobile, gender, birthDate, ageYears: birthDate ? "" : cells.ageYears, mrn: cells.legacyMrn,
    address: cells.address, district: cells.district, state: cells.state, pincode: cells.pincode };
  const v = validateRegistration(body, ctx.nowMs, ctx.region);
  if (!v.ok) { const f = Object.keys(v.errors)[0]; return invalid(row, label, f, v.errors[f]); }
  return { row, status: "create", label, name: v.patient.name, legacyMrn: cells.legacyMrn, body, patient: v.patient };
}

/** PURE. One price line to a Price list item, or the refusal. Rupees in, paise stored, as the Price list screen does. */
function priceRow(row, cells) {
  const label = cells.name;
  const kind = cells.kind.toLowerCase();
  if (!KINDS.includes(kind)) return invalid(row, label, "kind", `The kind is one of ${KINDS.join(", ")}.`);
  if (!/^\d+(\.\d{1,2})?$/.test(cells.price)) return invalid(row, label, "price", "The price is a plain amount in rupees, like 450 or 450.50.");
  const yes = /^(y|yes|true|1)$/i.test(cells.nonHealthcare);
  const item = { name: cells.name, code: cells.code, kind, ward: cells.ward, price: Math.round(Number(cells.price) * 100), hsnSac: cells.hsnSac, gstRate: cells.gstRate, nonHealthcare: yes };
  if (kind === "bed") { item.intensiveCareClass = cells.intensiveCareClass; item.unitHours = cells.unitHours; }
  const v = validateTariff(item);
  if (!v.ok) return invalid(row, label, TARIFF_FIELD[v.error] || "name", v.detail || TARIFF_SAY[v.error] || v.error);
  /* A line the law taxes at its own rate (a medicine sold to an outpatient or taken home, or anything that is not health
   * care) with no rate cannot be billed: gstForLines lists it unconfigured and the bill is refused. Manual entry lets the
   * rate be added later; an import that loads hundreds of such rows at once refuses them here instead. */
  if ((kind === "medication" || yes) && v.item.gstRate === "") return invalid(row, label, "gstRate", "This item is taxed at its own GST rate and the rate is empty.");
  return { row, status: "create", label, item: v.item };
}
const TARIFF_FIELD = { name_required: "name", blood_not_for_sale: "name", bad_price: "price", bad_hsn_sac: "hsnSac", bad_gst_rate: "gstRate", bad_intensive_care_class: "intensiveCareClass", bad_unit_hours: "unitHours" };
const TARIFF_SAY = { name_required: "The name is empty.", bad_price: "The price is not a plain amount.", bad_hsn_sac: "HSN/SAC is 4, 6 or 8 digits.",
  bad_gst_rate: "The GST rate is a percentage from 0 to 100.", bad_intensive_care_class: "The intensive care class is ICU, CCU, ICCU, NICU, ICU_SPECIALTY, HDU or empty.",
  bad_unit_hours: "The hours one bed price covers are a whole number from 1 to 24." };

/** PURE. One supplier line to a Vendor record, or the refusal. */
function vendorRow(row, cells) {
  const label = cells.name;
  if (!vendorIdFor(cells.name)) return invalid(row, label, "name", "The supplier's name is empty.");
  const gstin = cells.gstin.toUpperCase().replace(/\s+/g, "");
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return invalid(row, label, "gstin", "A GSTIN is 15 characters, like 36AABCU9603R1ZM.");
  if (cells.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cells.email)) return invalid(row, label, "email", "The email address is not valid.");
  const vendor = { resourceType: "Vendor", id: vendorIdFor(cells.name), name: cells.name.slice(0, 200) };
  for (const f of ["phone", "email", "address", "drugLicenceNo"]) if (cells[f]) vendor[f] = cells[f].slice(0, 300);
  if (gstin) vendor.gstin = gstin;
  return { row, status: "create", label, vendor };
}

async function openSvc(request, env, ctx, need) {
  const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
  return new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
}
const failOf = (e) => (e instanceof AuthError ? refuse(401, "auth", "Sign in again.")
  : e instanceof PermissionError || e instanceof GovernanceError ? refuse(403, "permission", "Your role cannot read or write these records, so nothing was imported.")
  : refuse(502, "import_read_failed", "What the hospital already holds could not be read, so nothing was imported."));

/** Marks each create line matched, duplicate or a repeat, against the store and the rest of the file. Returns { partial }. */
async function checkAgainstStore(request, env, ctx, kind, rows) {
  const lines = rows.filter((r) => r.status === "create");
  const repeat = (keyOf, why) => {
    const first = new Map();
    for (const r of lines) {
      if (r.status !== "create") continue;
      const k = keyOf(r);
      if (!k) continue;
      if (first.has(k)) Object.assign(r, { status: "invalid", field: why, reason: `Repeats row ${first.get(k)}.` });
      else first.set(k, r.row);
    }
  };
  if (kind === "prices") {
    repeat((r) => `${r.item.kind}|${(r.item.code || r.item.name).toUpperCase()}|${str(r.item.ward).toUpperCase()}`, "name");
    const have = await ctx.prices.list();
    for (const r of lines) {
      if (r.status !== "create") continue;
      const hit = have.find((t) => t.kind === r.item.kind && str(t.ward).toUpperCase() === str(r.item.ward).toUpperCase()
        && (r.item.code ? str(t.code).toUpperCase() === r.item.code.toUpperCase() : str(t.name).toUpperCase() === r.item.name.toUpperCase()));
      if (hit) Object.assign(r, { status: "matched", existing: { name: hit.name, code: hit.code || "", price: hit.price } });
    }
    return { partial: have.length >= LIST_CAP };
  }
  if (kind === "vendors") {
    repeat((r) => r.vendor.id, "name");
    const svc = await openSvc(request, env, ctx, "record:read");
    const have = (await svc.list("Vendor", LIST_CAP)) || [];
    const ids = new Set(have.filter(Boolean).map((v) => v.id));
    for (const r of lines) if (r.status === "create" && ids.has(r.vendor.id)) Object.assign(r, { status: "matched", existing: { name: r.vendor.name } });
    return { partial: have.length >= LIST_CAP };
  }
  // patients
  repeat((r) => r.legacyMrn.toUpperCase(), "legacyMrn");
  repeat((r) => r.patient.mobile, "mobile");
  const svc = await openSvc(request, env, ctx, "record:read");
  const live = lines.filter((r) => r.status === "create");
  const indexed = live.length ? await svc.findPatientsByIdentifier({ identifiers: live.map((r) => ({ system: "legacy-mrn", value: r.legacyMrn })) }) : [];
  const byLegacy = new Map();
  for (const p of indexed || []) for (const i of p.identifiers || []) if (i && i.system === "legacy-mrn") byLegacy.set(str(i.value).toUpperCase(), p);
  const pool = (await svc.list("Patient", NAME_POOL)) || [];
  for (const r of live) {
    const known = byLegacy.get(r.legacyMrn.toUpperCase());
    if (known) { Object.assign(r, { status: "matched", existing: { mrn: known.mrn } }); continue; }
    /* The hospital's own numbering makes the legacy number the MR number: one already in use is never written over. */
    if (ctx.externalMrn && await ctx.patients.byMrn(r.legacyMrn)) { Object.assign(r, { status: "duplicate", existing: { mrn: r.legacyMrn }, reason: "This MR number is already in use at this hospital." }); continue; }
    const sameMobile = await ctx.patients.mobileTaken(r.patient.mobile);
    if (sameMobile) { Object.assign(r, { status: "duplicate", existing: { mrn: sameMobile.mrn }, reason: "A patient with this mobile number is already registered." }); continue; }
    const hit = findCandidates({ name: r.patient.name, dob: r.patient.birthDate, sex: r.patient.gender, identifiers: [] }, pool, { limit: 1 })
      .find((h) => { const agreed = (h.match.breakdown || []).filter((f) => f.agreed).map((f) => f.field); return agreed.includes("name") && agreed.includes("dob"); });
    if (hit) Object.assign(r, { status: "duplicate", existing: { mrn: hit.patient.mrn }, reason: "A patient with the same name and date of birth is already registered." });
  }
  return { partial: false, namePoolPartial: pool.length >= NAME_POOL };
}

/**
 * POST /api/queue/ward/legacy-import. ctx: { migration, actorDeps, recordDeps, kind, csv, mapping, commit, confirmCount, planId,
 *   region, externalMrn, nowMs, patients: { byMrn, mobileTaken, register }, prices: { list, save } | null, audit(action, meta) }
 */
async function importLegacy(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off" || !mig.tenantId) return refuse(404, "not_a_wardsynq_hospital", "Importing is for a WardSynQ hospital.");
  const kind = str(ctx.kind);
  if (!FIELDS[kind]) return refuse(422, "unknown_kind", "Choose what the file holds: patients, prices or suppliers.");
  if (kind === "prices" && !ctx.prices) return refuse(409, "price_list_off", "This hospital's Price list is not switched on, so there is nowhere the bills read prices from. Nothing was imported.");
  const csv = String(ctx.csv == null ? "" : ctx.csv);
  if (!csv.trim()) return refuse(422, "csv_required", "Choose the CSV file.");
  if (csv.length > MAX_CSV_BYTES) return refuse(413, "csv_too_large", "The file is larger than 2 MB. Split it.");
  const lines = parseCsv(csv).filter((l) => l.some((x) => str(x)));
  const cap = ROW_CAP[kind], dataRows = Math.max(0, lines.length - 1);
  if (dataRows > cap) return refuse(413, "too_many_rows", `The file has ${dataRows} rows. One run takes at most ${cap}; split the file.`, { rowCap: cap });
  const mp = ctx.mapping;
  if (!mp || typeof mp !== "object") {
    // What the columns look like, so a person can map them. Aadhaar-shaped values are masked even here.
    const mask = (x) => (AADHAAR.test(str(x)) ? "XXXX XXXX XXXX" : str(x).slice(0, 60));
    return { ok: true, step: "map", kind, fields: FIELDS[kind], headers: (lines[0] || []).map(mask), sample: lines.slice(1, 4).map((l) => l.map(mask)), rowCount: dataRows, rowCap: cap };
  }
  const missing = FIELDS[kind].required.filter((f) => mp[f] === undefined || mp[f] === null || mp[f] === "");
  if (missing.length) return refuse(422, "mapping_incomplete", `Choose a column for: ${missing.join(", ")}.`, { missing });
  const dateOrder = ["ymd", "dmy", "mdy"].includes(str(mp.dateOrder)) ? str(mp.dateOrder) : "dmy";
  const fields = [...FIELDS[kind].required, ...FIELDS[kind].optional];
  const rowCtx = { dateOrder, nowMs: Number(ctx.nowMs) || Date.now(), region: ctx.region };
  const rows = lines.slice(1).map((l, i) => {
    const cells = cellsOf(l, mp, fields);
    return kind === "patients" ? patientRow(i + 2, cells, rowCtx) : kind === "prices" ? priceRow(i + 2, cells) : vendorRow(i + 2, cells);
  });

  let check;
  try { check = await checkAgainstStore(request, env, ctx, kind, rows); }
  catch (e) { return failOf(e); }
  const creates = rows.filter((r) => r.status === "create");
  const count = (s) => rows.filter((r) => r.status === s).length;
  const planId = await sha16(kind + "\n" + creates.map((r) => `${r.row}|${r.label}`).join("\n"));
  const report = { kind, rowCap: cap, planId, counts: { create: creates.length, matched: count("matched"), duplicate: count("duplicate"), invalid: count("invalid") },
    rows: rows.map((r) => ({ row: r.row, status: r.status, label: r.label, ...(r.field ? { field: r.field } : {}), ...(r.reason ? { reason: r.reason } : {}), ...(r.existing ? { existing: r.existing } : {}) })),
    partial: !!check.partial, ...(check.namePoolPartial ? { namePoolPartial: true } : {}) };
  if (ctx.commit !== true) return { ok: true, step: "preview", ...report };

  if (check.partial) return { ...refuse(409, "store_too_large_to_check", "What is already held could not be read in full, so matches cannot be ruled out and nothing was imported."), ...report };
  if (Number(ctx.confirmCount) !== creates.length || str(ctx.planId) !== planId) return { ...refuse(409, "preview_changed", "What would be imported changed since the dry run. Run the dry run again; nothing was imported."), ...report };
  if (!creates.length) return { ok: true, step: "done", written: 0, ...report };

  let written = 0, svc = null;
  const stopped = async (r, message) => {
    await ctx.audit("legacy_import_stopped", `${kind} ${written} of ${creates.length} plan ${planId} stopped at row ${r.row}`).catch(() => null);
    return { ...refuse(502, "import_incomplete", `The import stopped at row ${r.row} after ${written} of ${creates.length}. ${message} The rest were not saved; importing the same file again adds only what is missing.`), written, ...report };
  };
  try { if (kind === "vendors") svc = await openSvc(request, env, ctx, "record:write"); }
  catch (e) { return failOf(e); }
  for (const r of creates) {
    if (kind === "prices") {
      let out;
      try { out = await ctx.prices.save(r.item); } catch { out = null; }
      if (!out || !out.ok) return stopped(r, "The price was not saved.");
    } else if (kind === "vendors") {
      try { await svc.put(r.vendor, { expectedVersion: 0 }); }
      catch (e) { return stopped(r, e instanceof VersionConflictError ? "A supplier with this name was added meanwhile." : "The supplier was not saved."); }
    } else {
      let reg;
      try { reg = await ctx.patients.register(r.body); } catch { reg = null; }
      if (!reg || !reg.ok) return stopped(r, reg && reg.error === "duplicate" ? "A patient with this mobile number was registered meanwhile." : "The patient was not registered.");
      const rec = await registerPatientRecord(request, env, { migration: mig, actorDeps: ctx.actorDeps, recordDeps: ctx.recordDeps,
        registration: { mrn: reg.mrn, mrSource: reg.mrSource, pending: reg.pending, patient: { ...reg.patient, legacyMrn: r.legacyMrn } } }).catch(() => ({ ok: false }));
      if (!rec.ok) { written++; return stopped(r, `MR number ${reg.mrn} was issued but its chart record was not written; registering the patient again at the desk repairs it.`); }
      r.mrn = reg.mrn;
    }
    written++;
  }
  await ctx.audit("legacy_import", `${kind} created ${written} matched ${report.counts.matched} duplicate ${report.counts.duplicate} invalid ${report.counts.invalid} plan ${planId}`).catch(() => null);
  if (kind === "patients") report.rows.forEach((x) => { const c = creates.find((r) => r.row === x.row); if (c && c.mrn) x.mrn = c.mrn; });
  return { ok: true, step: "done", written, ...report };
}

export { ROW_CAP, dayOf, patientRow, priceRow, vendorRow, importLegacy };
