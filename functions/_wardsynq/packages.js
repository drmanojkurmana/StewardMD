/* functions/_wardsynq/packages.js - package billing: the package master, a package on a stay, and the manual
 * submission pack for schemes with no API.
 *
 * A PACKAGE IS A PRICE FOR A WHOLE EPISODE. A PM-JAY, state scheme, CGHS, ECHS, insurer or hospital package pays one
 * rate for a procedure and everything its inclusions name; the hospital bills that rate plus what the package
 * excludes. The charges themselves still come from charge-capture.js (what was DONE): a charge the package covers is
 * put on the bill at zero and marked included, so the bill still shows it happened and it is never billed again.
 *
 * THE MASTER is a tenant system record `_wardsynq_package` (no patient data), one per scheme and code, append-only:
 * every change is a new version with the old one kept, written with its audit row in the same append. It is edited on
 * Admin > Price list (wardsynq/site/pages/admin.js) by staff.admin only.
 *
 * A PACKAGE ON A STAY is a `PackageAssignment` record (billing.charge writes, billing.view reads, like a Claim). It
 * carries a COPY of the package version it was attached with, so a later rate change at the master never silently
 * changes a stay already running on the old rate. One package per stay; changing or removing it needs a reason and
 * is refused once the package is on a bill, or once the stay has an itemised bill (that would bill the same care
 * twice).
 *
 * NO SCHEME PORTAL IS CALLED. PM-JAY's Transaction Management System has no public API, and no official CGHS or ECHS
 * API is verified. documentPack() is an export for a person to upload by hand, and every word of it says so: nothing
 * here is ever "submitted". The TMS pre-authorisation screen asks for medical information, admission information,
 * treatment (diagnosis, plan, investigations, care team) and finance details, and "uploading of all mandatory
 * documents for the selected package is compulsory" (PM-JAY 2.0 TMS Provider User Manual,
 * https://sha.kerala.gov.in/wp-content/uploads/2024/02/PMJAY2.0-TMS-Provider-Usermanual_v10.pdf). Those documents
 * are per package, so the hospital lists them on the package from the scheme's own package master; none are invented.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, isExternalRecord } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ADMISSION_CLASSES } from "./migrate-inpatient.js";
import { stayDays } from "./charge-capture.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const PACKAGE_TYPE = "_wardsynq_package";
const ASSIGNMENT_TYPE = "PackageAssignment";
const MAX_PACKAGES = 2000;
const SCHEMES = Object.freeze(["pmjay", "state", "cghs", "echs", "insurer", "hospital"]);
/* Schemes whose claims go through a portal this build does not reach. Everything except a hospital's own package. */
const MANUAL_PORTAL_SCHEMES = Object.freeze(["pmjay", "state", "cghs", "echs", "insurer"]);
const ITEM_KINDS = Object.freeze(["bed", "nursing", "visit", "investigation", "medication", "service"]);
const SOURCE_KIND = Object.freeze({ MedicationAdministration: "medication", MedicationDispense: "medication", DiagnosticReport: "investigation", SpecimenCollection: "investigation" });

const refuse = (error, message, status) => ({ ok: false, status: status || 422, error, message });
const assignmentIdFor = (encounterId) => `wsq-pkgstay-${slug(encounterId)}`;

/* ---- pure ----------------------------------------------------------------------------------------- */

function listOf(v, max, len) {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\r?\n|,/) : [];
  const out = [];
  for (const x of arr) { const s = str(x).slice(0, len); if (s && !out.some((y) => y.toUpperCase() === s.toUpperCase())) out.push(s); }
  return out.length > max ? null : out;
}
function coverOf(v, label) {
  const o = v && typeof v === "object" ? v : {};
  const kinds = listOf(o.kinds, ITEM_KINDS.length, 40), items = listOf(o.items, 200, 120);
  if (!kinds || kinds.some((k) => !ITEM_KINDS.includes(k))) return { error: `${label}: the kinds must be among ${ITEM_KINDS.join(", ")}.` };
  if (!items) return { error: `${label}: at most 200 named items.` };
  return { cover: { kinds, items } };
}

/** PURE. A package as the master stores it, or { error }. Money in rupees, two decimals at most. */
function validatePackage(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const scheme = str(r.scheme);
  if (!SCHEMES.includes(scheme)) return { error: "bad_scheme", message: `The scheme must be one of: ${SCHEMES.join(", ")}.` };
  const schemeName = str(r.schemeName).slice(0, 120);
  if ((scheme === "state" || scheme === "insurer") && !schemeName) return { error: "scheme_name_required", message: "Name the state scheme or the insurer." };
  const code = str(r.code), name = str(r.name);
  if (!code || code.length > 40) return { error: "bad_code", message: "The package code is required, at most 40 characters." };
  if (!name || name.length > 200) return { error: "bad_name", message: "The package name is required, at most 200 characters." };
  const rateText = str(r.rate);
  if (!/^\d+(\.\d{1,2})?$/.test(rateText) || Number(rateText) > 100000000) return { error: "bad_rate", message: "The package rate is an amount in rupees, like 45000 or 45000.50." };
  let los = null;
  if (str(r.expectedLosDays) !== "") {
    los = Number(r.expectedLosDays);
    if (!Number.isInteger(los) || los < 1 || los > 365) return { error: "bad_los", message: "The expected length of stay is a whole number of days from 1 to 365." };
  }
  const inc = coverOf(r.inclusions, "Inclusions"), exc = coverOf(r.exclusions, "Exclusions");
  if (inc.error || exc.error) return { error: "bad_cover", message: inc.error || exc.error };
  const both = inc.cover.kinds.filter((k) => exc.cover.kinds.includes(k))
    .concat(inc.cover.items.filter((i) => exc.cover.items.some((x) => x.toUpperCase() === i.toUpperCase())));
  if (both.length) return { error: "included_and_excluded", message: `Both included and excluded: ${both.join(", ")}.` };
  const preAuthDocuments = listOf(r.preAuthDocuments, 50, 200), claimDocuments = listOf(r.claimDocuments, 50, 200);
  if (!preAuthDocuments || !claimDocuments) return { error: "too_many_documents", message: "At most 50 documents per list." };
  /* GST on the room inside the package (gst-packages; functions/_region_in.js packageRoomComponent). roomRatePerDay: the
   * per-day room rate the payer's own rate card states, with where it is stated, used only when the hospital values
   * package rooms at the scheme's rate. priceIncludesGst: the payer pays this rate and no GST on top, so GST on a
   * taxed room is worked back out of it and borne by the hospital. False unless an administrator says so. */
  const roomRateText = str(r.roomRatePerDay);
  if (roomRateText && (!/^\d+(\.\d{1,2})?$/.test(roomRateText) || Number(roomRateText) > 10000000)) return { error: "bad_room_rate", message: "The scheme's room rate is an amount in rupees per day, like 4500." };
  const roomRateSource = str(r.roomRateSource).slice(0, 200);
  if (roomRateText && !roomRateSource) return { error: "room_rate_source_required", message: "Say where the payer's rate card states this room rate (document and page)." };
  return { item: { scheme, schemeName: schemeName || null, code, name, rate: round2(rateText), expectedLosDays: los, preAuthRequired: r.preAuthRequired === true,
    inclusions: inc.cover, exclusions: exc.cover, preAuthDocuments, claimDocuments,
    roomRatePerDay: roomRateText ? round2(roomRateText) : null, roomRateSource: roomRateText ? roomRateSource : null, priceIncludesGst: r.priceIncludesGst === true } };
}

/** PURE. The kind of a captured charge item: the Price list row's kind, else what its source record is. */
function kindOfItem(it, table) {
  const t = table && typeof table === "object" ? table : {};
  const key = Object.keys(t).find((k) => k.toUpperCase() === str(it && it.code).toUpperCase());
  const e = key !== undefined && t[key] && typeof t[key] === "object" ? t[key] : null;
  if (e && str(e.kind)) return str(e.kind);
  // A stay day with no Price list row is the unpriced bed day (charge-capture.js stayDayItems); every other daily charge has a row.
  if (it && it.sourceType === "Encounter") return "bed";
  return (it && SOURCE_KIND[it.sourceType]) || null;
}

/**
 * PURE. Where one charge falls against a package: "excluded" (billed on top), "included" (covered by the rate, on the
 * bill at zero) or "outside" (named by neither list: billed, and flagged so a person checks it against the scheme's
 * rules). An exclusion wins over an inclusion; a named item wins over its kind only in that direction.
 */
function coverageOf(it, pkg, table) {
  const names = [str(it && it.code), str(it && it.display)].filter(Boolean).map((s) => s.toUpperCase());
  const named = (cover) => (cover.items || []).some((x) => names.includes(str(x).toUpperCase()));
  const kind = kindOfItem(it, table);
  const exc = pkg.exclusions || {}, inc = pkg.inclusions || {};
  if (named(exc) || (kind && (exc.kinds || []).includes(kind))) return "excluded";
  if (named(inc) || (kind && (inc.kinds || []).includes(kind))) return "included";
  return "outside";
}

/**
 * PURE. A stay's charges against its package. `charges` is chargesForPatient()'s answer for this stay.
 * Returns the lines to bill (the package line first), the unpriced items still owed a price, and the counts.
 */
function applyPackage(charges, assignment, table) {
  const pkg = assignment.package;
  const tag = { packageCode: pkg.code };
  const lines = [{ code: pkg.code, display: `Package: ${pkg.name}`, quantity: 1, amount: pkg.rate, line: pkg.rate, sourceType: ASSIGNMENT_TYPE, sourceId: assignment.id, kind: "package", packageLine: true, ...tag }];
  const counts = { included: 0, excluded: 0, outside: 0 }, unpriced = [];
  for (const it of charges.priced || []) {
    const c = coverageOf(it, pkg, table);
    counts[c] += 1;
    if (c === "included") lines.push({ ...it, amount: 0, line: 0, packageIncluded: true, ...tag });
    else lines.push({ ...it, ...(c === "excluded" ? { packageExcluded: true } : { packageOutside: true }), ...tag });
  }
  /* An unpriced charge the package covers needs no price: it is on the bill at zero. One it does not cover still does. */
  for (const it of charges.unpriced || []) {
    const c = coverageOf(it, pkg, table);
    counts[c] += 1;
    if (c === "included") lines.push({ ...it, amount: 0, line: 0, packageIncluded: true, ...tag });
    else unpriced.push({ ...it, ...(c === "excluded" ? { packageExcluded: true } : { packageOutside: true }) });
  }
  return { lines, unpriced, counts };
}

/** PURE. What a person must look at on a stay's package: length of stay and the pre-authorisation. */
function packageFlags(assignment, encounter, preAuth, nowMs) {
  const pkg = assignment.package;
  const days = encounter ? stayDays(encounter, null, nowMs).length : null;
  const preAuthState = !assignment.preAuthId ? (pkg.preAuthRequired ? "missing" : "not_required")
    : preAuth === undefined ? "unreadable" : preAuth ? str(preAuth.state) || "unknown" : "not_found";
  return {
    stayDays: days, expectedLosDays: pkg.expectedLosDays, losExceeded: !!(pkg.expectedLosDays && days != null && days > pkg.expectedLosDays),
    preAuthRequired: pkg.preAuthRequired, preAuthState,
    preAuthProblem: pkg.preAuthRequired && preAuthState !== "approved",
    manualPortal: MANUAL_PORTAL_SCHEMES.includes(pkg.scheme),
  };
}

const SCHEME_WORDS = { pmjay: "PM-JAY (Ayushman Bharat)", state: "State scheme", cghs: "CGHS", echs: "ECHS", insurer: "Private insurer", hospital: "Hospital package" };

/**
 * PURE. The manual submission pack: checklist, the documents the package lists, and the fields a person copies into
 * the scheme's portal. Labelled on every part as manual; it never says submitted.
 */
function documentPack({ assignment, encounter, preAuth, flags, billed }) {
  const pkg = assignment.package;
  const portal = pkg.scheme === "pmjay" ? "the PM-JAY Transaction Management System (TMS)" : pkg.scheme === "hospital" ? "the payer's own process" : `the ${SCHEME_WORDS[pkg.scheme]}${pkg.schemeName ? " (" + pkg.schemeName + ")" : ""} portal`;
  const field = (section, label, value) => ({ section, label, value: value == null || value === "" ? null : String(value) });
  const fields = [
    field("Admission information", "Beneficiary ID", assignment.beneficiaryId),
    field("Admission information", "Hospital patient ID", assignment.patientId),
    field("Admission information", "Admission date and time", encounter && encounter.periodStart),
    field("Admission information", "Discharge date and time", encounter && encounter.periodEnd),
    field("Admission information", "Days in hospital so far", flags.stayDays),
    field("Treatment", "Scheme", SCHEME_WORDS[pkg.scheme] + (pkg.schemeName ? `: ${pkg.schemeName}` : "")),
    field("Treatment", "Package code", pkg.code),
    field("Treatment", "Package name", pkg.name),
    field("Treatment", "Treatment on the pre-authorisation", preAuth && preAuth.treatment),
    field("Treatment", "Diagnosis codes on the pre-authorisation", preAuth && (preAuth.codes || []).map((c) => c.code).join(", ")),
    field("Finance", "Package rate (Rs)", pkg.rate),
    field("Finance", "Expected length of stay (days)", pkg.expectedLosDays),
    field("Finance", "Pre-authorisation state in WardSynQ", flags.preAuthState),
    field("Finance", "Payer reference recorded", preAuth && preAuth.payerReference),
    field("Finance", "Excluded items billed", (billed || []).map((l) => `${l.display || l.code} ${l.line}`).join("; ")),
  ];
  const check = (text, done) => ({ text, state: done === true ? "done" : done === false ? "not_done" : "check" });
  const checklist = [
    check("Beneficiary ID entered on the stay", !!assignment.beneficiaryId),
    check("Pre-authorisation recorded in WardSynQ", pkg.preAuthRequired ? flags.preAuthState === "approved" || flags.preAuthState === "requested" : null),
    check("Pre-authorisation approved before the treatment it covers", pkg.preAuthRequired ? flags.preAuthState === "approved" : null),
    check("Stay within the expected length of stay", pkg.expectedLosDays ? !flags.losExceeded : null),
    check("Every document listed below attached on the portal", null),
    check("The portal's own reference written on the pre-authorisation in WardSynQ", !!(preAuth && preAuth.payerReference)),
  ];
  return {
    manualSubmission: true,
    notice: `WardSynQ is not connected to ${portal}. Nothing in this pack has been sent or submitted. A person uploads it on the portal and records the portal's reference here.`,
    scheme: pkg.scheme, schemeName: pkg.schemeName, package: { code: pkg.code, name: pkg.name, version: pkg.version, rate: pkg.rate },
    checklist,
    preAuthDocuments: pkg.preAuthDocuments || [], claimDocuments: pkg.claimDocuments || [],
    documentsNote: (pkg.preAuthDocuments || []).length || (pkg.claimDocuments || []).length ? null : "No documents are listed on this package. Add the scheme's mandatory documents for it on Admin, Price list, Packages.",
    fields,
    fieldsNote: "Field names on the portal may differ. Copy each value into the matching field; an empty value is not known here.",
  };
}

/* ---- the master ----------------------------------------------------------------------------------- */

async function who(request, env, ctx, need) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_a_wardsynq_hospital" } };
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, need, ctx.actorDeps);
    return { actorId: r.actor.id, resolved: r, repo: ctx.recordDeps.repository, tenantId: mig.tenantId };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", message: str(e && e.message) } };
  }
}
const publicPackage = (p) => ({ id: p.id, version: p.version, scheme: p.scheme, schemeName: p.schemeName || null, code: p.code, name: p.name, rate: p.rate,
  expectedLosDays: p.expectedLosDays == null ? null : p.expectedLosDays, preAuthRequired: p.preAuthRequired === true, inclusions: p.inclusions, exclusions: p.exclusions,
  preAuthDocuments: p.preAuthDocuments || [], claimDocuments: p.claimDocuments || [], active: p.active !== false, changeReason: p.changeReason || null,
  roomRatePerDay: p.roomRatePerDay == null ? null : p.roomRatePerDay, roomRateSource: p.roomRateSource || null, priceIncludesGst: p.priceIncludesGst === true,
  writtenBy: p.writtenBy && p.writtenBy.id, writtenAt: p.writtenBy && p.writtenBy.at });

/** ctx: {} - every package at this hospital, withdrawn ones included and marked. */
async function listPackages(request, env, ctx) {
  const w = await who(request, env, ctx, "record:read");
  if (w.error) return w.error;
  let rows;
  try { rows = (await w.repo.latestByType(w.tenantId, PACKAGE_TYPE, MAX_PACKAGES)) || []; }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The packages could not be read." }; }
  return { ok: true, packages: rows.filter(Boolean).map(publicPackage).sort((a, b) => a.scheme.localeCompare(b.scheme) || a.code.localeCompare(b.code)) };
}

/** ctx: { id } - every version of one package, oldest first. */
async function packageVersions(request, env, ctx) {
  const w = await who(request, env, ctx, "record:read");
  if (w.error) return w.error;
  let rows;
  try { rows = (await w.repo.history(w.tenantId, PACKAGE_TYPE, str(ctx.id))) || []; }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The package history could not be read." }; }
  if (!rows.length) return refuse("package_not_found", "No such package at this hospital.", 404);
  return { ok: true, versions: rows.map(publicPackage) };
}

/**
 * Create or change a package. ctx: { id?, expectedVersion?, active?, reason?, ...fields }. A new package is keyed by
 * scheme and code; a change names the id and the version it read, and says why.
 */
async function savePackage(request, env, ctx) {
  const w = await who(request, env, ctx, "record:write");
  if (w.error) return w.error;
  const v = validatePackage(ctx);
  if (v.error) return refuse(v.error, v.message);
  const id = str(ctx.id) || `pkg-${v.item.scheme}-${slug(v.item.code)}`;
  let cur;
  try { cur = await w.repo.latest(w.tenantId, PACKAGE_TYPE, id); }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The package could not be read, so nothing was changed." }; }
  if (str(ctx.id) && !cur) return refuse("package_not_found", "No such package at this hospital.", 404);
  if (!str(ctx.id) && cur) return refuse("package_exists", "A package with this scheme and code already exists. Change that one instead.", 409);
  if (cur && (cur.scheme !== v.item.scheme || cur.code !== v.item.code)) return refuse("identity_fixed", "The scheme and code of a package do not change. Withdraw it and add a new one.");
  if (cur && Number(ctx.expectedVersion) !== cur.version) return refuse("version_conflict", "This package changed since it was opened. Reload and try again; nothing was saved.", 409);
  const reason = str(ctx.reason).slice(0, 500);
  if (cur && !reason) return refuse("reason_required", "Say why the package is being changed.");
  if (!cur) {
    let all;
    try { all = (await w.repo.latestByType(w.tenantId, PACKAGE_TYPE, MAX_PACKAGES)) || []; }
    catch { return { ok: false, status: 502, error: "record_read_failed", message: "The packages could not be read, so nothing was saved." }; }
    if (all.length >= MAX_PACKAGES) return refuse("too_many_packages", `A hospital may keep ${MAX_PACKAGES} packages.`, 409);
  }
  const active = typeof ctx.active === "boolean" ? ctx.active : cur ? cur.active !== false : true;
  const at = new Date().toISOString();
  const next = { resourceType: PACKAGE_TYPE, id, version: cur ? cur.version + 1 : 1, ...v.item, active, changeReason: reason || null,
    createdAt: (cur && cur.createdAt) || at, createdBy: (cur && cur.createdBy) || w.actorId, writtenBy: { id: w.actorId, kind: "human", at } };
  const fields = ["schemeName", "name", "rate", "expectedLosDays", "preAuthRequired", "inclusions", "exclusions", "preAuthDocuments", "claimDocuments", "roomRatePerDay", "roomRateSource", "priceIncludesGst", "active"];
  const changed = cur ? fields.filter((k) => JSON.stringify(next[k]) !== JSON.stringify(k === "priceIncludesGst" ? cur[k] === true : cur[k] === undefined ? null : cur[k])) : fields;
  if (cur && !changed.length) return { ok: true, unchanged: true, package: publicPackage(cur) };
  const action = !cur ? "package.create" : active !== (cur.active !== false) ? (active ? "package.restore" : "package.withdraw") : "package.update";
  const scope = { packageId: id, version: next.version, changed, ...(cur && changed.includes("rate") ? { rateFrom: cur.rate, rateTo: next.rate } : {}), reason: reason || null };
  try {
    await w.repo.append(w.tenantId, [next], { audit: { ts: at, actor: w.actorId, connectorId: "wardsynq-packages", action, outcome: "ok", scope } });
  } catch (e) {
    return e instanceof VersionConflictError ? refuse("version_conflict", "This package changed at the same moment. Reload and try again; nothing was saved.", 409)
      : { ok: false, status: 502, error: "record_write_failed", message: "The change could not be recorded, so it was not made." };
  }
  return { ok: true, package: publicPackage(next) };
}

/* ---- a package on a stay -------------------------------------------------------------------------- */

async function openSvc(request, env, ctx, need) {
  const w = await who(request, env, ctx, need);
  if (w.error) return w;
  const svc = new RecordService({ repository: w.repo, pseudonym: ctx.recordDeps.pseudonym, tenant: w.resolved.tenant, actor: w.resolved.actor, role: w.resolved.role, roleSource: w.resolved.source });
  return { ...w, svc };
}
function readError(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code) };
  return { ok: false, status: 502, error: "record_read_failed", message: "The stay's records could not be read, so nothing was changed." };
}

/** PURE. Whether a non-void invoice already bills this stay: the package line itself, or itemised charges of the stay. */
function stayBilling(invoices, encounterId, assignmentId) {
  const live = (invoices || []).filter((i) => i && !i.void);
  return {
    packageBilled: live.some((i) => (i.lines || []).some((l) => l.sourceType === ASSIGNMENT_TYPE && l.sourceId === assignmentId)),
    itemisedBilled: live.some((i) => (i.lines || []).some((l) => l.sourceType !== ASSIGNMENT_TYPE && !l.packageIncluded) &&
      (str(i.encounterId) === str(encounterId) || (i.lines || []).some((l) => l.sourceType === "Encounter" && str(l.sourceId).startsWith(str(encounterId) + ":")))),
  };
}

/**
 * Attach, change or remove the package on a stay. ctx: { patientId, encounterId, packageId?, preAuthId?, beneficiaryId?,
 * reason?, remove?, expectedVersion? }.
 */
async function setStayPackage(request, env, ctx) {
  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  if (!patientId || !encounterId) return refuse("stay_required", "Choose the patient's stay.");
  const o = await openSvc(request, env, ctx, "record:write");
  if (o.error) return o.error;
  const { svc } = o;
  const id = assignmentIdFor(encounterId);
  let enc, cur, invoices;
  try {
    [enc, cur, invoices] = await Promise.all([svc.get("Encounter", encounterId), svc.get(ASSIGNMENT_TYPE, id), svc.byPatient("Invoice", patientId)]);
  } catch (e) { return readError(e); }
  if (!enc || str(enc.patientId) !== patientId || isExternalRecord(enc) || !ADMISSION_CLASSES.includes(enc.class)) return refuse("encounter_not_this_patient", "That is not an inpatient stay of this patient.");
  if (cur && Number(ctx.expectedVersion) !== cur.version) return refuse("version_conflict", "The package on this stay changed since it was opened. Reload and try again; nothing was saved.", 409);
  const reason = str(ctx.reason).slice(0, 500);
  const billing = stayBilling(invoices, encounterId, id);
  const active = cur && cur.status === "active";
  if (active && billing.packageBilled) return refuse("package_already_billed", "This package is already on a bill for the stay. Raise a credit or debit note on that bill instead.", 409);
  const remove = ctx.remove === true;
  if (remove) {
    if (!active) return refuse("no_package", "This stay has no package to remove.", 409);
    if (!reason) return refuse("reason_required", "Say why the package is being removed.");
    const next = { ...cur, status: "removed", reason, changedBy: o.actorId, at: new Date().toISOString() };
    try { const out = await svc.put(next, { expectedVersion: cur.version }); return { ok: true, assignment: { ...next, version: out.record.version } }; }
    catch (e) { return writeFail(e); }
  }
  if (billing.itemisedBilled) return refuse("stay_already_billed_itemised", "This stay already has a bill with itemised charges. Void that bill or credit it before putting the stay on a package, so no care is billed twice.", 409);
  if (active && !reason) return refuse("reason_required", "Say why the package on this stay is being changed.");
  let pkg;
  try { pkg = await o.repo.latest(o.tenantId, PACKAGE_TYPE, str(ctx.packageId)); }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The package could not be read, so nothing was changed." }; }
  if (!pkg) return refuse("package_not_found", "No such package at this hospital.", 404);
  if (pkg.active === false) return refuse("package_withdrawn", "That package has been withdrawn from the price list.");
  const preAuthId = str(ctx.preAuthId) || null;
  if (preAuthId) {
    let pa;
    try { pa = await svc.get("PreAuthorisation", preAuthId); } catch (e) { return readError(e); }
    if (!pa || str(pa.patientId) !== patientId) return refuse("preauth_not_this_patient", "That pre-authorisation is not this patient's.");
  }
  const beneficiaryId = str(ctx.beneficiaryId).slice(0, 60) || null;
  const at = new Date().toISOString();
  const next = {
    resourceType: ASSIGNMENT_TYPE, id, patientId, encounterId, status: "active",
    package: { ...publicPackage(pkg), active: undefined, changeReason: undefined, writtenBy: undefined, writtenAt: undefined },
    preAuthId, beneficiaryId, reason: reason || null, changedBy: o.actorId, at,
    source: { system: "wardsynq-native", sourceId: `package-assignment:${id}` },
  };
  try {
    const out = await svc.put(JSON.parse(JSON.stringify(next)), { expectedVersion: cur ? cur.version : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ok: true, assignment: { ...JSON.parse(JSON.stringify(next)), version: out.record.version } };
  } catch (e) { return writeFail(e); }
}
function writeFail(e) {
  if (e instanceof VersionConflictError) return refuse("version_conflict", "The package on this stay changed at the same moment. Reload and try again; nothing was saved.", 409);
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: (e.reasons || []).map((r) => r.code) };
  return { ok: false, status: 502, error: "record_write_failed", message: "The change could not be recorded, so it was not made." };
}

/**
 * The packages on a patient's stays, each with its flags and, when chargesFor is given, the split of the stay's
 * charges so far (included, excluded, outside). ctx: { patientId, chargesFor?(encounterId), tariff? }
 */
async function stayPackages(request, env, ctx) {
  const patientId = str(ctx.patientId);
  if (!patientId) return refuse("patient_required", "Choose a patient.");
  const o = await openSvc(request, env, ctx, "record:read");
  if (o.error) return o.error;
  let rows, stays;
  /* A billing.view desk may not read stays (actor.js): the packages still show, with the days said to be unknown. */
  let staysUnreadable = false;
  try { [rows, stays] = await Promise.all([o.svc.byPatient(ASSIGNMENT_TYPE, patientId), o.svc.byPatient("Encounter", patientId).catch(() => { staysUnreadable = true; return []; })]); }
  catch (e) { return readError(e); }
  const nowMs = Date.now();
  const out = [];
  for (const a of (rows || []).filter((r) => r && r.status === "active")) {
    const enc = (stays || []).find((e) => e && e.id === a.encounterId) || null;
    let pa = null;
    if (a.preAuthId) pa = await o.svc.get("PreAuthorisation", a.preAuthId).catch(() => undefined);
    const flags = packageFlags(a, enc, pa, nowMs);
    let split = null;
    if (typeof ctx.chargesFor === "function") {
      const ch = await ctx.chargesFor(a.encounterId).catch(() => null);
      if (ch && ch.ok) {
        const ap = applyPackage(ch, a, ctx.tariff);
        const pick = (f) => ap.lines.filter(f).map((l) => ({ display: l.display || l.code, line: l.line }));
        split = { counts: ap.counts, excluded: pick((l) => l.packageExcluded), outside: pick((l) => l.packageOutside),
          unpriced: ap.unpriced.map((u) => ({ display: u.display || u.code })), ...(ch.unreadable ? { unreadable: ch.unreadable } : {}) };
      } else split = false;
    }
    out.push({ ...a, flags, preAuth: pa ? { id: pa.id, state: pa.state, treatment: pa.treatment, payerReference: pa.payerReference || null } : pa === undefined ? false : null, split });
  }
  return {
    ok: true, patientId, assignments: out, ...(staysUnreadable ? { staysUnreadable: true } : {}),
    stays: (stays || []).filter((e) => e && !isExternalRecord(e) && ADMISSION_CLASSES.includes(e.class)).map((e) => ({ id: e.id, status: e.status, periodStart: e.periodStart, periodEnd: e.periodEnd || null, ward: (e.location && e.location.ward) || null }))
      .sort((a, b) => str(b.periodStart).localeCompare(str(a.periodStart))),
  };
}

/** The manual submission pack for one stay's package. ctx: { patientId, encounterId, chargesFor?, tariff? } */
async function packagePack(request, env, ctx) {
  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  if (!patientId || !encounterId) return refuse("stay_required", "Choose the patient's stay.");
  const o = await openSvc(request, env, ctx, "record:read");
  if (o.error) return o.error;
  let a, enc;
  try { [a, enc] = await Promise.all([o.svc.get(ASSIGNMENT_TYPE, assignmentIdFor(encounterId)), o.svc.get("Encounter", encounterId).catch(() => null)]); }
  catch (e) { return readError(e); }
  if (!a || a.status !== "active" || str(a.patientId) !== patientId) return refuse("no_package", "This stay has no package.", 404);
  let pa = null;
  if (a.preAuthId) { try { pa = await o.svc.get("PreAuthorisation", a.preAuthId); } catch (e) { return readError(e); } }
  const flags = packageFlags(a, enc, pa, Date.now());
  let billed = null;
  if (typeof ctx.chargesFor === "function") {
    const ch = await ctx.chargesFor(encounterId).catch(() => null);
    if (!ch || !ch.ok) return { ok: false, status: 502, error: "charges_unreadable", message: "The stay's charges could not be read, so the pack would be incomplete. Nothing was prepared." };
    billed = applyPackage(ch, a, ctx.tariff).lines.filter((l) => l.packageExcluded || l.packageOutside);
  }
  return { ok: true, pack: documentPack({ assignment: a, encounter: enc, preAuth: pa, flags, billed }) };
}

export {
  PACKAGE_TYPE, ASSIGNMENT_TYPE, SCHEMES, ITEM_KINDS, assignmentIdFor,
  validatePackage, kindOfItem, coverageOf, applyPackage, packageFlags, documentPack, stayBilling,
  listPackages, packageVersions, savePackage, setStayPackage, stayPackages, packagePack,
};
