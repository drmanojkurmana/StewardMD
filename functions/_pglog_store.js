/* functions/_pglog_store.js — NMC Logbook · Firestore I/O + the authorization gate.
 * ===========================================================================
 * Thin persistence over the PURE core in ../pglog-model.js. Every DECISION — validation, the
 * verification state machine, progress, privacy scrubbing — lives there and is unit-tested; this
 * file moves documents and enforces WHO may move them. Mirrors functions/_opd_org_store.js and
 * functions/_onco_store.js conventions (fsGet/fsQuery/fsCommit/wCreate/wUpdate + qAudit).
 *
 * THREE THINGS THIS FILE IS RESPONSIBLE FOR AND THE MODEL IS NOT
 * --------------------------------------------------------------
 * 1. IDENTITY. The verified caller uid is taken from the Firebase token by the router and passed in.
 *    A client-supplied actor/createdBy/verifiedBy is IGNORED, always. This is what makes
 *    pglog-model's self-verify throw meaningful: the model compares two identities the client
 *    cannot choose.
 * 2. TIME. Every *At is stamped here with the server clock. The only caller-supplied date is
 *    occurredAt (when the work happened), which the model bounds to [programmeStart, today].
 * 3. VISIBILITY. publicEntry() projects a record for an audience. A cross-resident view (Academic
 *    Cell, department summary, any export) never receives caseRef or diagnosis — the educational
 *    logbook is not a second EMR (see NMC_PG_LOGBOOK_REQUIREMENTS.md section 5).
 *
 * NO COMPOSITE INDEXES. _fbfirestore.fsQuery supports one equality filter, deliberately. Every
 * query below is therefore on a single DENORMALISED field (residentId / orgScope / deptScope /
 * pendingFor), maintained on write. Adding a two-field query here means adding an index in the
 * console, which no other module in this repo needs; don't.
 *
 * TESTABILITY: every persistence fn takes an optional trailing `deps` {fsGet,fsQuery,fsCommit,
 * wCreate,wUpdate,qAudit,now} so node --test can run the whole draft -> submit -> verify -> amend
 * flow against fakes. Production callers never pass deps.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
import { getOrg, getMembership, listMembers } from "./_opd_org_store.js";
import { authorizeOrgAccess } from "./_opd_org.js";
import { CAPS, can } from "./_queue_roles.js";
// pglog-model.js is a root-level UMD module (module.exports, no ESM export) — the same interop path
// functions/_onco_store.js already uses for onco-dose.js. Never re-derive the rules here; that file
// is the one place they exist.
import M from "../pglog-model.js";

const COL = {
  programme: "pg_programmes",
  resident: "pg_residents",
  rotation: "pg_rotations",
  entry: "pg_entries",
  assessment: "pg_assessments",
  attestation: "pg_attestations",
  notif: "pg_notifs",
  config: "pg_config"
};

const D = (deps) => Object.assign({ fsGet, fsQuery, fsCommit, wCreate, wUpdate, qAudit, now: Date.now }, deps || {});
function sanitize(x) { return String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100); }
function newId() { return crypto.randomUUID().replace(/-/g, ""); }
const withId = (id, f) => Object.assign({ id }, f || {});
function norm(id) { return String(id == null ? "" : id).toLowerCase().replace(/^(fb:|ghis:|cfa:)/, ""); }
function e403(detail) { return Object.assign(new Error("forbidden"), { status: 403, detail }); }
function e404(detail) { return Object.assign(new Error("not_found"), { status: 404, detail }); }
function e400(code) { return Object.assign(new Error(code || "bad_request"), { status: 400 }); }

async function audit(env, orgId, actor, action, meta, deps) {
  // PHI-free by construction: meta carries ids, kinds and counts, never a case reference, a
  // diagnosis or a patient identifier. Best-effort — an audit failure must not block the action,
  // and the entry's own history[] is the authoritative trail regardless.
  try { await D(deps).qAudit(env, { hospitalId: orgId || "", ticketId: "", actor: actor || "", action, meta: String(meta == null ? "" : meta).slice(0, 200) }); } catch (e) {}
}

/* ── the authorization gate ──────────────────────────────────────────────────
 * Reuses the OPD org gate rather than inventing a parallel one: the org doc + the caller's
 * membership decide, and the frontend never does. `self` short-circuits the cap check for a
 * resident acting on their own record — that is what PGLOG_*_OWN means. */
export async function gate(env, actorUid, orgId, cap, opts, deps) {
  opts = opts || {};
  if (!actorUid) throw Object.assign(new Error("signin_required"), { status: 401 });
  const org = await getOrg(env, orgId);
  if (!org) throw e404("org");
  const member = await getMembership(env, orgId, actorUid);
  const a = authorizeOrgAccess(org, member, actorUid, orgId, null, opts.target);
  if (!a.ok) throw e403(a.reason);
  const role = a.role || (member && member.role) || "viewer";
  if (cap && !can(role, cap)) throw e403(cap);
  return { role, owner: !!a.owner, member, org };
}

/* ── programmes ──────────────────────────────────────────────────────────── */

export async function createProgramme(env, orgId, body, actorUid, deps) {
  const d = D(deps);
  const id = newId();
  const f = M.programme(Object.assign({}, body, { id, orgId, createdAt: d.now() }));
  await d.fsCommit(env, [d.wCreate(env, COL.programme + "/" + id, f)]);
  await audit(env, orgId, actorUid, "pglog:programme:create", f.specialtyId + " " + f.degree, deps);
  return f;
}
export async function getProgramme(env, id, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.programme + "/" + sanitize(id));
  return doc ? M.programme(withId(sanitize(id), doc.fields)) : null;
}
export async function listProgrammes(env, orgId, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.programme, { where: { field: "orgId", value: sanitize(orgId) }, limit: 200 });
  return r.map((x) => M.programme(withId(x.id, x.fields)));
}
export async function updateProgramme(env, id, patch, actorUid, deps) {
  const d = D(deps);
  const cur = await getProgramme(env, id, deps);
  if (!cur) throw e404("programme");
  // orgId and id are immutable — a programme cannot be moved between institutions, which would
  // silently re-scope every record hanging off it.
  const f = M.programme(Object.assign({}, cur, patch || {}, { id: cur.id, orgId: cur.orgId, createdAt: cur.createdAt }));
  await d.fsCommit(env, [d.wUpdate(env, COL.programme + "/" + sanitize(id), f)]);
  await audit(env, cur.orgId, actorUid, "pglog:programme:update", id, deps);
  return f;
}

/* ── residents ───────────────────────────────────────────────────────────── */

// Deterministic id per (programme, uid), so enrolling twice is idempotent rather than creating a
// second training record for the same person.
function residentId(programmeId, uid) { return sanitize(programmeId) + "__" + sanitize(uid); }

export async function enrolResident(env, orgId, body, actorUid, deps) {
  const d = D(deps);
  const prog = await getProgramme(env, (body || {}).programmeId, deps);
  if (!prog || prog.orgId !== sanitize(orgId)) throw e404("programme");
  const uid = String((body || {}).uid || "").trim();
  if (!uid) throw e400("uid_required");
  const id = residentId(prog.id, uid);
  const f = M.resident(Object.assign({}, body, {
    id, uid, orgId, programmeId: prog.id, departmentId: body.departmentId || prog.departmentId,
    endDate: body.endDate || M.addMonths(body.startDate, prog.durationMonths),
    createdAt: d.now()
  }));
  // Denormalised single-field query keys (see the header note on composite indexes).
  const rec = Object.assign({}, f, { guideKey: sanitize(orgId) + "|" + norm(f.guide), orgScope: sanitize(orgId) });
  await d.fsCommit(env, [d.wUpdate(env, COL.resident + "/" + id, rec)]);
  await audit(env, orgId, actorUid, "pglog:resident:enrol", prog.specialtyId + " y" + f.trainingYear, deps);
  return f;
}
export async function getResident(env, id, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.resident + "/" + sanitize(id));
  return doc ? M.resident(withId(sanitize(id), doc.fields)) : null;
}
export async function residentForUid(env, orgId, uid, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.resident, { where: { field: "uid", value: String(uid) }, limit: 20 });
  const rows = r.map((x) => M.resident(withId(x.id, x.fields))).filter((x) => x.orgId === sanitize(orgId) && x.active);
  return rows[0] || null;
}
export async function listResidents(env, orgId, opts, deps) {
  opts = opts || {};
  const d = D(deps);
  // One equality filter, then filter the rest in memory. A department has tens of residents, not
  // thousands — this is cheaper and simpler than maintaining composite indexes.
  const r = await d.fsQuery(env, COL.resident, { where: { field: "orgScope", value: sanitize(orgId) }, limit: 500 });
  let rows = r.map((x) => M.resident(withId(x.id, x.fields)));
  if (opts.departmentId) rows = rows.filter((x) => x.departmentId === sanitize(opts.departmentId));
  if (opts.programmeId) rows = rows.filter((x) => x.programmeId === sanitize(opts.programmeId));
  if (opts.trainingYear) rows = rows.filter((x) => x.trainingYear === Number(opts.trainingYear));
  if (opts.guide) rows = rows.filter((x) => norm(x.guide) === norm(opts.guide) || (x.coGuides || []).some((g) => norm(g) === norm(opts.guide)));
  if (opts.activeOnly !== false) rows = rows.filter((x) => x.active);
  return rows;
}
export async function updateResident(env, id, patch, actorUid, deps) {
  const d = D(deps);
  const cur = await getResident(env, id, deps);
  if (!cur) throw e404("resident");
  const f = M.resident(Object.assign({}, cur, patch || {}, { id: cur.id, uid: cur.uid, orgId: cur.orgId, programmeId: cur.programmeId, createdAt: cur.createdAt }));
  const rec = Object.assign({}, f, { guideKey: sanitize(cur.orgId) + "|" + norm(f.guide), orgScope: sanitize(cur.orgId) });
  await d.fsCommit(env, [d.wUpdate(env, COL.resident + "/" + sanitize(id), rec)]);
  await audit(env, cur.orgId, actorUid, "pglog:resident:update", id, deps);
  return f;
}

/* ── rotations ───────────────────────────────────────────────────────────── */

export async function createRotation(env, orgId, body, actorUid, deps) {
  const d = D(deps);
  const id = newId();
  const f = M.rotation(Object.assign({}, body, { id, orgId, createdAt: d.now() }));
  const res = await getResident(env, f.residentId, deps);
  if (!res || res.orgId !== sanitize(orgId)) throw e404("resident");
  const rec = Object.assign({}, f, { orgScope: sanitize(orgId), deptScope: sanitize(orgId) + "|" + sanitize(f.departmentId) });
  await d.fsCommit(env, [d.wCreate(env, COL.rotation + "/" + id, rec)]);
  await audit(env, orgId, actorUid, "pglog:rotation:create", f.kind + " " + f.startDate, deps);
  // PGMER-2023 5.2(xii)V — returned with the record, not thrown: a State's posting schedule is not
  // the resident's to fix, and refusing the rotation would lose a true record of where they were.
  const prog = await getProgramme(env, res.programmeId, deps);
  const w = M.drpWindowOk(f, res, prog);
  return w.ok ? f : Object.assign({}, f, { warning: w.warning, warningSource: w.source, warningClause: w.clause });
}
export async function getRotation(env, id, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.rotation + "/" + sanitize(id));
  return doc ? M.rotation(withId(sanitize(id), doc.fields)) : null;
}
export async function listRotations(env, residentId, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.rotation, { where: { field: "residentId", value: sanitize(residentId) }, limit: 200 });
  return r.map((x) => M.rotation(withId(x.id, x.fields)))
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}
export async function updateRotation(env, id, patch, actorUid, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.rotation + "/" + sanitize(id));
  if (!doc) throw e404("rotation");
  const cur = M.rotation(withId(sanitize(id), doc.fields));
  const f = M.rotation(Object.assign({}, cur, patch || {}, { id: cur.id, residentId: cur.residentId, orgId: cur.orgId, createdAt: cur.createdAt }));
  const rec = Object.assign({}, f, { orgScope: sanitize(cur.orgId), deptScope: sanitize(cur.orgId) + "|" + sanitize(f.departmentId) });
  await d.fsCommit(env, [d.wUpdate(env, COL.rotation + "/" + sanitize(id), rec)]);
  await audit(env, cur.orgId, actorUid, "pglog:rotation:update", f.status, deps);
  return f;
}

/* ── entries — the logbook itself ────────────────────────────────────────── */

// The denormalised keys a write must maintain. `pendingFor` is what makes a faculty member's
// "awaiting my verification" list a single-field query; it is set on submit and CLEARED on
// verify/return, so a stale entry can never linger in someone's queue.
function entryKeys(e, orgId) {
  return {
    orgScope: sanitize(orgId),
    deptScope: sanitize(orgId) + "|" + sanitize(e.departmentId),
    pendingFor: e.status === "submitted" ? norm(e.supervisor) : "",
    monthKey: M.monthKey(e.occurredAt)
  };
}
async function writeEntry(env, e, orgId, deps, opts) {
  const d = D(deps);
  const rec = Object.assign({}, e, entryKeys(e, orgId));
  const path = COL.entry + "/" + sanitize(e.id);
  await d.fsCommit(env, [(opts && opts.create) ? d.wCreate(env, path, rec) : d.wUpdate(env, path, rec)]);
  return e;
}

export async function getEntry(env, id, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.entry + "/" + sanitize(id));
  return doc ? M.entry(withId(sanitize(id), doc.fields)) : null;
}

// Load the context the model needs to validate: the resident's programme window + degree.
async function entryContext(env, residentId, deps) {
  const res = await getResident(env, residentId, deps);
  if (!res) throw e404("resident");
  const prog = await getProgramme(env, res.programmeId, deps);
  return {
    resident: res, programme: prog,
    programmeStart: res.startDate, degree: prog ? prog.degree : "",
    today: M.isoDate(D(deps).now())
  };
}

export async function createEntry(env, orgId, body, actorUid, deps) {
  const d = D(deps);
  const ctx = await entryContext(env, (body || {}).residentId, deps);
  if (ctx.resident.orgId !== sanitize(orgId)) throw e403("cross_org");
  // A resident may only create their OWN records. Faculty logging on a resident's behalf is
  // deliberately not a thing: 5.2(v) says the STUDENT maintains the logbook, and a faculty-authored
  // entry would also defeat the self-verify guard (the author and the verifier would be one person).
  if (norm(ctx.resident.uid) !== norm(actorUid)) throw e403("not_own_record");
  const id = newId();
  const e = M.entry(Object.assign({}, body, {
    id, residentId: ctx.resident.id, programmeId: ctx.resident.programmeId, orgId: sanitize(orgId),
    // server-owned, never from the body
    status: "draft", createdBy: actorUid, createdAt: d.now(), updatedAt: d.now(),
    submittedAt: 0, verifiedBy: "", verifiedAt: 0, returnedBy: "", returnedAt: 0, returnReason: "",
    history: [{ at: d.now(), by: actorUid, action: "create", to: "draft" }], revisions: [], deleted: false
  }));
  const v = M.validateEntry(e, ctx);
  if (!v.ok) throw Object.assign(e400("validation"), { errors: v.errors });
  await writeEntry(env, e, orgId, deps, { create: true });
  await audit(env, orgId, actorUid, "pglog:entry:create", e.kind + " " + e.occurredAt, deps);
  return e;
}

export async function editEntry(env, id, patch, actorUid, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  if (norm(cur.createdBy) !== norm(actorUid)) throw e403("not_own_record");
  const ctx = await entryContext(env, cur.residentId, deps);
  const out = M.applyEdit(cur, patch, actorUid, d.now());   // THROWS on a verified entry
  const v = M.validateEntry(out, ctx);
  if (!v.ok) throw Object.assign(e400("validation"), { errors: v.errors });
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:edit", id, deps);
  return out;
}

// Pull a submitted entry back out of the verifier's queue. Clears pendingFor, so it leaves their
// list rather than mutating under them (R1, finding I2).
export async function withdrawEntry(env, id, actorUid, reason, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  const out = M.withdraw(cur, actorUid, d.now(), reason);   // THROWS unless the author
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:withdraw", cur.kind, deps);
  return out;
}

/* ── the faculty roster, and why submit resolves against it ──────────────────────
 * `pendingFor` is a denormalised copy of norm(supervisor), and it is the ONLY thing that puts an
 * entry in a faculty member's queue. So a free-text supervisor is not a cosmetic problem: a resident
 * who types "Dr Sharma" when the guide's identity is "fb:abc123" produces an entry that is
 * `submitted`, counts toward nothing, appears in NOBODY's queue, and sits there silently until the
 * examination. The resident believes it was sent. It was not.
 *
 * So a submit RESOLVES the supervisor against people who actually exist and actually hold the
 * verification capability, and REFUSES rather than orphaning the record.
 */
export async function facultyRoster(env, orgId, deps) {
  const members = await (deps && deps.listMembers ? deps.listMembers : listMembers)(env, orgId);
  return (members || [])
    .filter((m) => m && m.active !== false && can(m.role, CAPS.PGLOG_VERIFY))
    .map((m) => ({ identity: m.identity, role: m.role, email: m.email || "" }));
}

// Resolve free text or an identity to a real, capable supervisor. Matches the resident's own guide
// and co-guides first (they are named on the training record), then the org roster, by identity or
// by email local-part. Returns the CANONICAL identity, or "" when nothing matches.
export async function resolveSupervisor(env, orgId, text, resident, deps) {
  const want = norm(text);
  if (!want) return "";
  const named = [].concat(resident && resident.guide ? [resident.guide] : [], (resident && resident.coGuides) || []);
  for (const g of named) if (norm(g) === want) return g;
  let roster = [];
  try { roster = await facultyRoster(env, orgId, deps); } catch (e) { roster = []; }
  for (const m of roster) {
    if (norm(m.identity) === want) return m.identity;
    if (m.email && norm(m.email) === want) return m.identity;
    if (m.email && norm(m.email.split("@")[0]) === want) return m.identity;
  }
  return "";
}

export async function submitEntry(env, id, actorUid, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  if (norm(cur.createdBy) !== norm(actorUid)) throw e403("not_own_record");
  const ctx = await entryContext(env, cur.residentId, deps);
  const v = M.validateEntry(cur, ctx);
  if (!v.ok) throw Object.assign(e400("validation"), { errors: v.errors });
  // Resolve BEFORE stamping submitted, so an unresolvable supervisor is a refusal the resident sees
  // rather than an entry that quietly reaches nobody.
  const resolved = await resolveSupervisor(env, cur.orgId, cur.supervisor, ctx.resident, deps);
  if (!resolved) {
    // NOTE: userMessage, not message. The router's fail() maps a known error by e.message, so
    // overwriting it here would both break that mapping and hide the error code from callers.
    throw Object.assign(e400("supervisor_unresolved"), {
      detail: cur.supervisor,
      userMessage: "That supervisor is not on your department's faculty list, so nobody would " +
        "receive this entry to verify. Pick your guide or a listed faculty member."
    });
  }
  const out = M.submit(Object.assign({}, cur, { supervisor: resolved }), actorUid, d.now());
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:submit", cur.kind, deps);
  await notify(env, { to: resolved, orgId: cur.orgId, kind: "verify_pending", entryId: id,
    residentId: cur.residentId, text: "A logbook entry is awaiting your verification." }, deps);
  return out;
}

export async function verifyEntry(env, id, actorUid, note, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  await gate(env, actorUid, cur.orgId, CAPS.PGLOG_VERIFY, null, deps);
  const out = M.verify(cur, actorUid, d.now(), note);   // THROWS on self-verify
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:verify", cur.kind + " " + cur.residentId, deps);
  return out;
}

export async function returnEntry(env, id, actorUid, reason, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  await gate(env, actorUid, cur.orgId, CAPS.PGLOG_VERIFY, null, deps);
  const out = M.returnEntry(cur, actorUid, d.now(), reason);   // THROWS without a reason
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:return", cur.kind, deps);
  // The resident must be told WHAT to correct — a bare "returned" is useless feedback.
  await notify(env, { to: cur.createdBy, orgId: cur.orgId, kind: "entry_returned", entryId: id,
    residentId: cur.residentId, text: "Returned for correction: " + String(reason).slice(0, 160) }, deps);
  return out;
}

// The authorised correction of a VERIFIED record. Never an overwrite: the full prior document is
// pushed into revisions[] by the model and the entry goes back for verification.
export async function amendEntry(env, id, patch, actorUid, reason, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  // Either the author correcting their own record, or someone holding VERIFY (a guide fixing a
  // record they signed). Nobody else can touch a verified document.
  if (norm(cur.createdBy) !== norm(actorUid)) await gate(env, actorUid, cur.orgId, CAPS.PGLOG_VERIFY, null, deps);
  const ctx = await entryContext(env, cur.residentId, deps);
  const out = M.amend(cur, patch, actorUid, d.now(), reason);
  const v = M.validateEntry(out, ctx);
  if (!v.ok) throw Object.assign(e400("validation"), { errors: v.errors });
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:amend", id + " rev" + out.revisions.length, deps);
  await notify(env, { to: cur.verifiedBy, orgId: cur.orgId, kind: "verify_pending", entryId: id,
    residentId: cur.residentId, text: "A verified entry was amended and needs re-verification." }, deps);
  return out;
}

export async function deleteEntry(env, id, actorUid, reason, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  if (norm(cur.createdBy) !== norm(actorUid)) throw e403("not_own_record");
  const out = M.softDelete(cur, actorUid, d.now(), reason);   // THROWS on a verified entry
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:delete", cur.kind, deps);
  return out;
}

export async function listEntries(env, residentId, opts, deps) {
  opts = opts || {};
  const d = D(deps);
  const r = await d.fsQuery(env, COL.entry, { where: { field: "residentId", value: sanitize(residentId) }, limit: opts.limit || 2000 });
  let rows = r.map((x) => M.entry(withId(x.id, x.fields)));
  if (!opts.includeDeleted) rows = rows.filter((x) => !x.deleted);
  if (opts.kind) rows = rows.filter((x) => x.kind === opts.kind);
  if (opts.status) rows = rows.filter((x) => x.status === opts.status);
  if (opts.from) rows = rows.filter((x) => M.daysBetween(opts.from, x.occurredAt) >= 0);
  if (opts.to) rows = rows.filter((x) => M.daysBetween(x.occurredAt, opts.to) >= 0);
  return rows.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
}

// A faculty member's verification queue — one equality filter on the denormalised pendingFor.
export async function pendingForFaculty(env, orgId, identity, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.entry, { where: { field: "pendingFor", value: norm(identity) }, limit: 500 });
  return r.map((x) => M.entry(withId(x.id, x.fields)))
    .filter((x) => !x.deleted && x.status === "submitted" && x.orgId === sanitize(orgId))
    .sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
}

export async function listEntriesForScope(env, orgId, opts, deps) {
  opts = opts || {};
  const d = D(deps);
  const where = opts.departmentId
    ? { field: "deptScope", value: sanitize(orgId) + "|" + sanitize(opts.departmentId) }
    : { field: "orgScope", value: sanitize(orgId) };
  const r = await d.fsQuery(env, COL.entry, { where, limit: opts.limit || 5000 });
  return r.map((x) => M.entry(withId(x.id, x.fields))).filter((x) => !x.deleted);
}

/* ── assessments ─────────────────────────────────────────────────────────── */

export async function createAssessment(env, orgId, body, actorUid, deps) {
  const d = D(deps);
  await gate(env, actorUid, orgId, CAPS.PGLOG_ASSESS, null, deps);
  const id = newId();
  const a = M.assessment(Object.assign({}, body, { id, orgId, assessor: actorUid, createdAt: d.now(), status: "draft" }));
  await d.fsCommit(env, [d.wCreate(env, COL.assessment + "/" + id, a)]);
  await audit(env, orgId, actorUid, "pglog:assessment:create", a.templateId, deps);
  return a;
}
export async function getAssessment(env, id, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.assessment + "/" + sanitize(id));
  return doc ? M.assessment(withId(sanitize(id), doc.fields)) : null;
}
// Complete an assessment. The template is passed in by the router (it is static JSON, and passing it
// keeps this file free of a second content loader). scoreAssessment() refuses a partial form.
export async function completeAssessment(env, id, patch, template, actorUid, deps) {
  const d = D(deps);
  const cur = await getAssessment(env, id, deps);
  if (!cur) throw e404("assessment");
  await gate(env, actorUid, cur.orgId, CAPS.PGLOG_ASSESS, null, deps);
  const res = await getResident(env, cur.residentId, deps);
  // FAIL CLOSED. RULE 6 (an assessor may not assess themselves) compares against residentUid; if the
  // resident cannot be resolved that comparison silently passes, which is the exact "namespace
  // mismatch disables the guard" failure the verify() path was designed against. (R1, finding I6.)
  if (!res || !res.uid) throw e404("resident");
  const merged = M.assessment(Object.assign({}, cur, patch || {}, { id: cur.id, residentId: cur.residentId, orgId: cur.orgId, createdAt: cur.createdAt }));
  merged.residentUid = res.uid;                                  // so the model can refuse a self-assessment
  const out = M.assess(merged, actorUid, d.now(), template);
  delete out.residentUid;                                        // not persisted; it is a lookup, not a field
  await d.fsCommit(env, [d.wUpdate(env, COL.assessment + "/" + sanitize(id), out)]);
  await audit(env, cur.orgId, actorUid, "pglog:assessment:complete", out.templateId + " " + out.outcome, deps);
  await notify(env, { to: res.uid, orgId: cur.orgId, kind: "assessment_ready", residentId: cur.residentId,
    text: out.outcome === "remediation" ? "An assessment with a remediation plan is ready for you." : "New faculty feedback is available." }, deps);
  return out;
}
export async function signAssessment(env, id, actorUid, deps) {
  const d = D(deps);
  const cur = await getAssessment(env, id, deps);
  if (!cur) throw e404("assessment");
  await gate(env, actorUid, cur.orgId, CAPS.PGLOG_ASSESS, null, deps);
  const out = M.signAssessment(cur, actorUid, d.now());
  await d.fsCommit(env, [d.wUpdate(env, COL.assessment + "/" + sanitize(id), out)]);
  await audit(env, cur.orgId, actorUid, "pglog:assessment:sign", id, deps);
  return out;
}
export async function listAssessments(env, residentId, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.assessment, { where: { field: "residentId", value: sanitize(residentId) }, limit: 500 });
  return r.map((x) => M.assessment(withId(x.id, x.fields))).sort((a, b) => (b.assessedAt || b.createdAt || 0) - (a.assessedAt || a.createdAt || 0));
}

/* ── attestation — PGMER-2023 5.2(vi) ────────────────────────────────────────
 * The monthly guide authentication. Written with wCreate (currentDocument.exists:false) on a
 * DETERMINISTIC id, so a month can be signed exactly once: a second attempt fails the precondition
 * rather than silently replacing a signature. */
export async function attest(env, body, actorUid, deps) {
  const d = D(deps);
  const res = await getResident(env, (body || {}).residentId, deps);
  if (!res) throw e404("resident");
  const g = await gate(env, actorUid, res.orgId, CAPS.PGLOG_ATTEST, null, deps);
  if (M.sameActor(actorUid, res.uid)) throw e403("self_attest_forbidden");
  const kind = M.ATTESTATION_KINDS.indexOf(String(body.kind || "monthly")) > -1 ? String(body.kind || "monthly") : "";
  if (!kind) throw e400("unknown_attestation_kind");
  /* THE SIGNATURE MUST COME FROM THE AUTHORITY THE DOCUMENT NAMES.
   * PGMER-2023 5.2(vi): the monthly authentication is by "the postgraduate GUIDE imparting the
   * training". The 2022-revised curricula: the completed log book "should be signed by the HEAD OF
   * THE DEPARTMENT", and the proficiency certificate is "from Head of Department".
   * Holding PGLOG_ATTEST is not the same as being that person, and minting a document that names an
   * authority the signer does not hold is exactly what 9.2(c) penalises. (R1, finding C7.) */
  if (kind === "monthly") {
    const isGuide = M.sameActor(actorUid, res.guide) ||
      (res.coGuides || []).some((x) => M.sameActor(actorUid, x));
    // A department head may authenticate for a guide who has left or is unavailable — but it is the
    // HoD doing it, and attestedRole records which.
    if (!isGuide && g.role !== "pg_hod") throw e403("not_the_guide");
  } else if (kind === "hod_final" || kind === "hod_proficiency") {
    if (g.role !== "pg_hod") throw e403("hod_required");
  }
  const period = kind === "monthly" ? String(body.period || "") : "";
  if (kind === "monthly" && !/^\d{4}-\d{2}$/.test(period)) throw e400("period_required");
  // Snapshot exactly which entries this signature covers — the artefact an examiner asks for.
  const all = await listEntries(env, res.id, {}, deps);
  const scope = kind === "monthly"
    ? all.filter((e) => M.monthKey(e.occurredAt) === period && e.kind !== "attendance")
    : all.filter((e) => e.kind !== "attendance");
  const counts = { verified: scope.filter((e) => e.status === "verified").length, total: scope.length };
  M.ENTRY_KINDS.forEach((k) => { counts[k] = scope.filter((e) => e.kind === k).length; });
  const a = M.attestation({
    residentId: res.id, programmeId: res.programmeId, orgId: res.orgId, kind, period,
    entryIds: scope.map((e) => e.id), counts, note: body.note,
    attestedBy: actorUid, attestedRole: g.role, attestedAt: d.now(), createdAt: d.now()
  });
  try {
    await d.fsCommit(env, [d.wCreate(env, COL.attestation + "/" + sanitize(a.id), a)]);
  } catch (err) {
    if (err && err.code === "precondition") throw Object.assign(new Error("already_attested"), { status: 409, detail: a.id });
    throw err;
  }
  // Stamp the covered entries so an entry can show which authentication carried it.
  if (kind === "monthly" && scope.length) {
    // Firestore caps a commit at 500 writes, so batch rather than truncating at 400 — a silently
    // unstamped entry would look unauthenticated on its own detail screen while the month is signed.
    for (let i = 0; i < scope.length; i += 400) {
      const writes = scope.slice(i, i + 400).map((e) => d.wUpdate(env, COL.entry + "/" + sanitize(e.id), { attestedIn: period }));
      try { await d.fsCommit(env, writes); } catch (e) {}
    }
  }
  await audit(env, res.orgId, actorUid, "pglog:attest:" + kind, period + " n=" + scope.length, deps);
  return a;
}
export async function listAttestations(env, residentId, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.attestation, { where: { field: "residentId", value: sanitize(residentId) }, limit: 200 });
  return r.map((x) => M.attestation(withId(x.id, x.fields))).sort((a, b) => String(b.period).localeCompare(String(a.period)));
}

/* ── curriculum overrides (Academic Cell) ─────────────────────────────────── */

export async function getConfig(env, programmeId, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.config + "/" + sanitize(programmeId));
  return doc ? doc.fields : { overrides: {} };
}
export async function setConfig(env, programmeId, body, actorUid, deps) {
  const d = D(deps);
  const prog = await getProgramme(env, programmeId, deps);
  if (!prog) throw e404("programme");
  await gate(env, actorUid, prog.orgId, CAPS.PGLOG_CONFIGURE, null, deps);
  // An override may only change target/per/hidden/note. It can NEVER rewrite a label, a source, a
  // clause or a quote — otherwise a department could relabel its own target as an NMC requirement.
  const clean = {};
  Object.keys((body && body.overrides) || {}).slice(0, 400).forEach((k) => {
    const o = body.overrides[k] || {};
    clean[String(k).slice(0, 80)] = {
      target: o.target === null ? null : (o.target === undefined ? undefined : Number(o.target)),
      per: o.per ? String(o.per).slice(0, 16) : undefined,
      hidden: !!o.hidden,
      note: String(o.note || "").slice(0, 300)
    };
  });
  const rec = { programmeId: sanitize(programmeId), orgId: prog.orgId, overrides: clean, updatedBy: actorUid, updatedAt: d.now() };
  await d.fsCommit(env, [d.wUpdate(env, COL.config + "/" + sanitize(programmeId), rec)]);
  await audit(env, prog.orgId, actorUid, "pglog:config:set", Object.keys(clean).length + " overrides", deps);
  return rec;
}

/* ── notifications ───────────────────────────────────────────────────────────
 * NO NEW NOTIFICATION SYSTEM. Targeted device push reuses sendNativeToAll(env, msg, {uid}) — the
 * same per-uid path functions/_taskpush.js uses for ICU instructions — and an in-module inbox row
 * covers the case where the app is opened later. Push is best-effort and never blocks the action.
 * PHI-free: a notification body carries a kind and an id, never a case reference or a diagnosis. */
export async function notify(env, n, deps) {
  const d = D(deps);
  const to = String((n && n.to) || "").trim();
  if (!to) return { ok: false, reason: "no_recipient" };
  const id = newId();
  const rec = {
    id, to: norm(to), orgId: sanitize(n.orgId), kind: String(n.kind || "").slice(0, 40),
    text: String(n.text || "").slice(0, 300), entryId: sanitize(n.entryId || ""),
    residentId: sanitize(n.residentId || ""), at: d.now(), read: false
  };
  try { await d.fsCommit(env, [d.wCreate(env, COL.notif + "/" + id, rec)]); } catch (e) {}
  try {
    const push = deps && deps.sendNativePush ? deps.sendNativePush : (await import("./_nativepush.js")).sendNativeToAll;
    await push(env, {
      title: "NMC Logbook", body: rec.text, tag: "pglog-" + rec.kind,
      url: "https://stewardmd.in/?pglog=1", route: "pglog"
    }, { uid: "fb:" + norm(to) });
  } catch (e) { /* push is best-effort; the inbox row is the durable part */ }
  return { ok: true, id };
}
export async function listNotifications(env, uid, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.notif, { where: { field: "to", value: norm(uid) }, limit: 100 });
  return r.map((x) => withId(x.id, x.fields)).sort((a, b) => (b.at || 0) - (a.at || 0));
}
export async function markNotificationRead(env, id, uid, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.notif + "/" + sanitize(id));
  if (!doc || norm(doc.fields.to) !== norm(uid)) throw e404("notification");
  await d.fsCommit(env, [d.wUpdate(env, COL.notif + "/" + sanitize(id), { read: true })]);
  return { ok: true };
}

/* ── projections — the privacy boundary ──────────────────────────────────────
 * publicEntry() is where "this is an educational logbook, not a second EMR" is enforced. An
 * audience that is not the resident, their verifying faculty or their HoD receives counts and
 * categories — never a case reference and never a diagnosis. Every cross-resident dashboard,
 * department summary and export goes through here. */
export function publicEntry(e, audience) {
  if (!e) return null;
  const full = audience === "self" || audience === "verifier" || audience === "hod";
  const out = {
    id: e.id, kind: e.kind, residentId: e.residentId, occurredAt: e.occurredAt,
    title: full ? e.title : "", status: e.status, role: e.role,
    supervisor: e.supervisor, requirementIds: e.requirementIds, rotationId: e.rotationId,
    departmentId: e.departmentId, createdAt: e.createdAt, submittedAt: e.submittedAt,
    verifiedBy: e.verifiedBy, verifiedAt: e.verifiedAt, returnReason: full ? e.returnReason : "",
    attestedIn: e.attestedIn, revisionCount: (e.revisions || []).length,
    latencyDays: M.latencyDays(e)
  };
  if (e.kind === "clinical") { out.setting = e.setting; out.category = e.category; out.outcome = e.outcome; }
  if (e.kind === "procedure") { out.procedureId = e.procedureId; out.setting = e.setting; out.outcome = e.outcome; out.complications = e.complications; }
  if (e.kind === "academic") { out.academicType = e.academicType; out.scope = e.scope; out.topic = full ? e.topic : ""; }
  if (e.kind === "research") { out.subtype = e.subtype; out.milestone = e.milestone; out.firstAuthor = e.firstAuthor; out.indexed = e.indexed; }
  if (e.kind === "certification") { out.subtype = e.subtype; }
  if (e.kind === "attendance") { out.state = e.state; out.endDate = e.endDate; }
  if (e.kind === "reflection") { out.subtype = e.subtype; out.body = full ? e.body : ""; }
  if (full) {
    out.caseRef = e.caseRef || "";
    out.diagnosis = e.diagnosis || "";
    out.remarks = e.remarks || "";
    out.procedureText = e.procedureText || "";
    out.ageBand = e.ageBand || "";
    out.sex = e.sex || "";
    out.attachments = e.attachments || [];
    out.history = e.history || [];
    out.revisions = e.revisions || [];
  }
  return out;
}

// What audience is this caller to this record? Drives publicEntry(). Deliberately narrow: an
// Academic Cell has institution-wide OVERSIGHT (5.2(iii) "ensure and monitor"), which is a
// completeness question, not a clinical-detail one.
export function audienceFor(role, actorUid, entry, resident) {
  if (resident && M.sameActor(actorUid, resident.uid)) return "self";
  if (role === "pg_hod") return "hod";
  if (can(role, CAPS.PGLOG_VERIFY) && entry && M.sameActor(actorUid, entry.supervisor)) return "verifier";
  if (can(role, CAPS.PGLOG_VERIFY)) return "verifier";
  return "aggregate";
}

export { COL, norm, residentId };
