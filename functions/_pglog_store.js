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
import { signerSnapshot, signatureFields, canSign } from "./_pglog_signer.js";
import * as V from "./_pglog_verify.js";

const COL = {
  programme: "pg_programmes",
  resident: "pg_residents",
  rotation: "pg_rotations",
  entry: "pg_entries",
  assessment: "pg_assessments",
  attestation: "pg_attestations",
  certificate: "pg_certificates",
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
function e409(code) { return Object.assign(new Error(code || "conflict"), { status: 409 }); }

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
  // Test seam, consistent with the deps convention this whole file uses. Production never passes it;
  // without it the org/membership lookups below would need real Firestore to exercise anything that
  // sits BEHIND the gate — such as the registration check.
  if (deps && deps.gate) return deps.gate(env, actorUid, orgId, cap, opts);
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
  // PGMER-2023 5.2(xv)V — returned with the record, not thrown: a State's posting schedule is not
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
  if (!doc) return null;
  return withSignature(M.entry(withId(sanitize(id), doc.fields)), doc.fields);
}

/* M.entry() is the schema authority and drops anything it does not know, which is what keeps a
 * crafted field out of the record. The signature block therefore has to be re-attached explicitly —
 * ONE function, used by every read path.
 *
 * It was not, once: getEntry() re-attached it and listEntries() did not, so the same stored document
 * came back with a registration number down one path and without it down the other. That is the same
 * shape of bug as the two field lists behind the QR digest, and it had two live consequences — a
 * certificate's content digest flipped between "request" and "issue" for no reason a reader could
 * see, and every report counting "verified entries carrying the signer's registration" counted zero. */
function withSignature(e, f) {
  return Object.assign(e, {
    verifiedReg: (f && f.verifiedReg) || "", verifiedCouncil: (f && f.verifiedCouncil) || "",
    verifiedName: (f && f.verifiedName) || "", verifiedRegSource: (f && f.verifiedRegSource) || "",
    verifyCode: (f && f.verifyCode) || ""
  });
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
  // deliberately not a thing: 5.2(vi) says the STUDENT maintains the logbook, and a faculty-authored
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

/* WHO MAY SIGN THIS PARTICULAR RECORD — not "who may sign records".
 *
 * The cap check answers a question about a ROLE. PGMER-2023 5.2(vii) asks a question about a PERSON:
 * the logbook is authenticated by "the Post-graduate guide", and 9.2(c) penalises the NAMED faculty
 * member who submits a false record. Between those two, an org-wide PGLOG_VERIFY meant any faculty
 * member in the institution could sign, return or amend any resident's entry — an anaesthetist
 * signing a surgery trainee's operative record, under their own registration number, which the QR
 * then announces as "Verifying faculty (PGMER-2023 5.2(vii))".
 *
 * The same shape the attest path already uses (R1, finding C7): the named supervisor on the entry,
 * the resident's guide or co-guide, or the head of department — who may act when a guide has left or
 * is unavailable, and whose role is recorded.
 */
function isNamedFor(actorUid, entry, resident) {
  return M.sameActor(actorUid, entry && entry.supervisor) ||
    M.sameActor(actorUid, resident && resident.guide) ||
    ((resident && resident.coGuides) || []).some((x) => M.sameActor(actorUid, x));
}
async function requireNamedFor(env, actorUid, entry, role, deps) {
  const res = await getResident(env, entry.residentId, deps);
  if (isNamedFor(actorUid, entry, res)) return res;
  if (role === "pg_hod") return res;
  throw Object.assign(new Error("not_the_named_supervisor"), { status: 403,
    userMessage: "You are not this resident's guide and you are not named on this entry, so you " +
      "cannot sign it. Ask their guide, or the head of department." });
}

export async function verifyEntry(env, id, actorUid, note, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  const g = await gate(env, actorUid, cur.orgId, CAPS.PGLOG_VERIFY,
    { target: { departmentId: cur.departmentId } }, deps);
  // A cap says what a ROLE may do; this says whether this PERSON is the one the record names.
  await requireNamedFor(env, actorUid, cur, g.role, deps);
  // THE REGISTRATION GATE. Throws unless the actor holds a verified medical-council registration.
  // Before the cap check would have been the whole story; a cap says what a ROLE may do, and this
  // says whether the PERSON is a registered practitioner whose signature means anything.
  const snap = await (deps && deps.signerSnapshot ? deps.signerSnapshot : signerSnapshot)(env, actorUid, deps);
  const at = d.now();
  let out = M.verify(cur, actorUid, at, note);          // THROWS on self-verify
  // The signature records WHO, by registration number — not just a uid.
  out = Object.assign(out, signatureFields("verified", snap, at));
  // A code + QR the University can check independently.
  out.verifyCode = await issueCode(env, "entry", out, deps);
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:verify", cur.kind + " reg:" + snap.regNo, deps);
  return out;
}

// Minting a code must never take a signature down with it. If signing is unconfigured or the write
// fails, the record is still signed and auditable — it simply carries no QR, and the UI says so
// rather than printing a code that cannot be checked.
async function issueCode(env, kind, payload, deps) {
  try { return await (deps && deps.issueCode ? deps.issueCode : V.issue)(env, kind, payload, deps) || ""; }
  catch (e) { return ""; }
}

export async function returnEntry(env, id, actorUid, reason, deps) {
  const d = D(deps);
  const cur = await getEntry(env, id, deps);
  if (!cur) throw e404("entry");
  const g = await gate(env, actorUid, cur.orgId, CAPS.PGLOG_VERIFY,
    { target: { departmentId: cur.departmentId } }, deps);
  // A return is an adverse judgement recorded against a trainee by name, so it carries BOTH gates:
  // the person must be the one responsible for this logbook, and a registered practitioner.
  await requireNamedFor(env, actorUid, cur, g.role, deps);
  await (deps && deps.signerSnapshot ? deps.signerSnapshot : signerSnapshot)(env, actorUid, deps);
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
  if (norm(cur.createdBy) !== norm(actorUid)) {
    const g = await gate(env, actorUid, cur.orgId, CAPS.PGLOG_VERIFY,
      { target: { departmentId: cur.departmentId } }, deps);
    await requireNamedFor(env, actorUid, cur, g.role, deps);
  }
  const ctx = await entryContext(env, cur.residentId, deps);
  const out = M.amend(cur, patch, actorUid, d.now(), reason);
  const v = M.validateEntry(out, ctx);
  if (!v.ok) throw Object.assign(e400("validation"), { errors: v.errors });
  // The old code attested to a document that no longer stands. It must SAY so rather than keep
  // returning a green tick for content that has since changed.
  if (cur.verifyCode) { try { await V.supersede(env, cur.verifyCode, "", deps); } catch (e) {} }
  out.verifyCode = "";
  // Clear the WHOLE signature block. Leaving RegSource/RegCheckedAt behind left an amended,
  // unverified record still carrying evidence of a check that no longer applies to it.
  out.verifiedReg = ""; out.verifiedCouncil = ""; out.verifiedName = "";
  out.verifiedRegSource = ""; out.verifiedRegCheckedAt = 0;
  // An amend may redirect the record to a different guide; the SERVER decides whether that person
  // can actually receive it, exactly as submit does. Otherwise an amend orphans the entry.
  out.supervisor = await resolveSupervisor(env, cur.orgId, out.supervisor || cur.supervisor, ctx.resident, deps);
  await writeEntry(env, out, cur.orgId, deps);
  await audit(env, cur.orgId, actorUid, "pglog:entry:amend", id + " rev" + out.revisions.length, deps);
  // A certified logbook that COVERED this entry no longer describes a document that exists.
  await supersedeCertificatesFor(env, id, "a covered entry was amended", deps);
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
  let rows = r.map((x) => withSignature(M.entry(withId(x.id, x.fields)), x.fields));
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
  return r.map((x) => withSignature(M.entry(withId(x.id, x.fields)), x.fields))
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
  return r.map((x) => withSignature(M.entry(withId(x.id, x.fields)), x.fields)).filter((x) => !x.deleted);
}

/* ── assessments ─────────────────────────────────────────────────────────── */

export async function createAssessment(env, orgId, body, actorUid, deps) {
  const d = D(deps);
  // An assessment is written ABOUT a resident, so the department it is scoped to is theirs, not the
  // caller's claim. Resolve the resident first and gate on THAT department.
  const subject = await getResident(env, (body || {}).residentId, deps);
  await gate(env, actorUid, orgId, CAPS.PGLOG_ASSESS,
    { target: { departmentId: subject && subject.departmentId } }, deps);
  const id = newId();
  // The signature block is server-owned, exactly as it is on an entry. M.assessment() carries
  // signedBy/signedAt, so without this a draft could be created already claiming a signature that
  // signAssessment() never granted.
  const a = M.assessment(Object.assign({}, body, { id, orgId, assessor: actorUid, createdAt: d.now(),
    status: "draft", signedBy: "", signedAt: 0, assessedAt: 0, verifyCode: "" }));
  await d.fsCommit(env, [d.wCreate(env, COL.assessment + "/" + id, a)]);
  await audit(env, orgId, actorUid, "pglog:assessment:create", a.templateId, deps);
  return a;
}
export async function getAssessment(env, id, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.assessment + "/" + sanitize(id));
  if (!doc) return null;
  return Object.assign(M.assessment(withId(sanitize(id), doc.fields)), {
    assessorReg: doc.fields.assessorReg || "", assessorCouncil: doc.fields.assessorCouncil || "",
    assessorName: doc.fields.assessorName || "", verifyCode: doc.fields.verifyCode || ""
  });
}
// Complete an assessment. The template is passed in by the router (it is static JSON, and passing it
// keeps this file free of a second content loader). scoreAssessment() refuses a partial form.
export async function completeAssessment(env, id, patch, template, actorUid, deps) {
  const d = D(deps);
  const cur = await getAssessment(env, id, deps);
  if (!cur) throw e404("assessment");
  await gate(env, actorUid, cur.orgId, CAPS.PGLOG_ASSESS,
    { target: { departmentId: cur.departmentId } }, deps);
  const res = await getResident(env, cur.residentId, deps);
  // FAIL CLOSED. RULE 6 (an assessor may not assess themselves) compares against residentUid; if the
  // resident cannot be resolved that comparison silently passes, which is the exact "namespace
  // mismatch disables the guard" failure the verify() path was designed against. (R1, finding I6.)
  if (!res || !res.uid) throw e404("resident");
  const merged = M.assessment(Object.assign({}, cur, patch || {}, {
    id: cur.id, residentId: cur.residentId, orgId: cur.orgId, createdAt: cur.createdAt,
    assessor: cur.assessor, signedBy: cur.signedBy, signedAt: cur.signedAt, verifyCode: cur.verifyCode
  }));
  merged.residentUid = res.uid;                                  // so the model can refuse a self-assessment
  const snap = await (deps && deps.signerSnapshot ? deps.signerSnapshot : signerSnapshot)(env, actorUid, deps);
  const at = d.now();
  const out = M.assess(merged, actorUid, at, template);
  delete out.residentUid;                                        // not persisted; it is a lookup, not a field
  Object.assign(out, signatureFields("assessor", snap, at));
  out.verifyCode = await issueCode(env, "assessment", out, deps);
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
  await gate(env, actorUid, cur.orgId, CAPS.PGLOG_ASSESS,
    { target: { departmentId: cur.departmentId } }, deps);
  const snapS = await (deps && deps.signerSnapshot ? deps.signerSnapshot : signerSnapshot)(env, actorUid, deps);
  const out = Object.assign(M.signAssessment(cur, actorUid, d.now()),
    signatureFields("signed", snapS, d.now()));
  await d.fsCommit(env, [d.wUpdate(env, COL.assessment + "/" + sanitize(id), out)]);
  await audit(env, cur.orgId, actorUid, "pglog:assessment:sign", id, deps);
  return out;
}
export async function listAssessments(env, residentId, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.assessment, { where: { field: "residentId", value: sanitize(residentId) }, limit: 500 });
  return r.map((x) => M.assessment(withId(x.id, x.fields))).sort((a, b) => (b.assessedAt || b.createdAt || 0) - (a.assessedAt || a.createdAt || 0));
}

/* ── attestation — PGMER-2023 5.2(vii) ────────────────────────────────────────
 * The monthly guide authentication. Written with wCreate (currentDocument.exists:false) on a
 * DETERMINISTIC id, so a month can be signed exactly once: a second attempt fails the precondition
 * rather than silently replacing a signature. */
export async function attest(env, body, actorUid, deps) {
  const d = D(deps);
  const res = await getResident(env, (body || {}).residentId, deps);
  if (!res) throw e404("resident");
  // Pass the TARGET so authorizeOrgAccess() actually evaluates the membership's department scope.
  // Every gate() call in this module was passing `null`, so `withinScope` never ran and a head of
  // department scoped to one department could mint the Head-of-Department proficiency certificate
  // for a resident in a department they do not head. (An empty scope still means whole-org
  // membership, the same as everywhere else in the app.)
  const g = await gate(env, actorUid, res.orgId, CAPS.PGLOG_ATTEST,
    { target: { departmentId: res.departmentId } }, deps);
  if (M.sameActor(actorUid, res.uid)) throw e403("self_attest_forbidden");
  const kind = M.ATTESTATION_KINDS.indexOf(String(body.kind || "monthly")) > -1 ? String(body.kind || "monthly") : "";
  if (!kind) throw e400("unknown_attestation_kind");
  /* THE SIGNATURE MUST COME FROM THE AUTHORITY THE DOCUMENT NAMES.
   * PGMER-2023 5.2(vii): the monthly authentication is by "the postgraduate GUIDE imparting the
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
  // The clause says "the Post-graduate guide". A guide is a registered practitioner; this is where
  // that stops being an assumption.
  const snapA = await (deps && deps.signerSnapshot ? deps.signerSnapshot : signerSnapshot)(env, actorUid, deps);
  const at = d.now();
  const a = Object.assign(M.attestation({
    residentId: res.id, programmeId: res.programmeId, orgId: res.orgId, kind, period,
    entryIds: scope.map((e) => e.id), counts, note: body.note,
    attestedBy: actorUid, attestedRole: g.role, attestedAt: at, createdAt: at
  }), signatureFields("attested", snapA, at));
  a.verifyCode = await issueCode(env, "attestation", a, deps);
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
export async function getAttestation(env, id, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.attestation + "/" + sanitize(id));
  return doc ? Object.assign(M.attestation(withId(sanitize(id), doc.fields)), {
    // the signature fields live alongside the model's own shape
    attestedReg: doc.fields.attestedReg || "", attestedCouncil: doc.fields.attestedCouncil || "",
    attestedName: doc.fields.attestedName || "", verifyCode: doc.fields.verifyCode || ""
  }) : null;
}
export async function listAttestations(env, residentId, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.attestation, { where: { field: "residentId", value: sanitize(residentId) }, limit: 200 });
  return r.map((x) => M.attestation(withId(x.id, x.fields))).sort((a, b) => String(b.period).localeCompare(String(a.period)));
}


/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LOGBOOK CERTIFICATES — the signed, frozen document a college or University is handed.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The monthly attestation says "this month was checked". A certificate says "THIS COMPILED LOGBOOK,
 * exactly this content, was signed by these named registered practitioners". It is what the exported
 * PDF rests on, and it is issued only when the quorum is met.
 *
 * The digest is computed HERE, over the frozen entry set, and recomputed at verification time. If a
 * covered entry is amended afterwards the certificate is SUPERSEDED — the document those people
 * signed no longer exists, and a green tick over changed content would be the worst possible outcome
 * for a record an examination relies on.
 */

async function digestContent(env, cert, entries, deps) {
  const canon = M.certificateContent(cert, entries);
  return (deps && deps.certDigest ? deps.certDigest : V.digestFor)(env, "certificate_content", { canon });
}

export async function getCertificate(env, id, deps) {
  const d = D(deps);
  const doc = await d.fsGet(env, COL.certificate + "/" + sanitize(id));
  return doc ? M.certificate(withId(sanitize(id), doc.fields)) : null;
}
export async function listCertificates(env, residentId, deps) {
  const d = D(deps);
  const r = await d.fsQuery(env, COL.certificate, { where: { field: "residentId", value: sanitize(residentId) }, limit: 50 });
  return r.map((x) => M.certificate(withId(x.id, x.fields))).sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
}

/* Open a certification request: freeze WHAT is being certified, and say plainly what is being left
 * out. Only VERIFIED entries are covered — a certificate that quietly included drafts would be a
 * signature over work nobody checked. */
export async function requestCertificate(env, body, actorUid, deps) {
  const d = D(deps);
  const res = await getResident(env, (body || {}).residentId, deps);
  if (!res) throw e404("resident");
  // The resident may ask for their own logbook to be certified; faculty may open it for them.
  if (!M.sameActor(actorUid, res.uid)) {
    await gate(env, actorUid, res.orgId, CAPS.PGLOG_VERIFY, { target: { departmentId: res.departmentId } }, deps);
  } else {
    await gate(env, actorUid, res.orgId, CAPS.PGLOG_VIEW_OWN, null, deps);
  }

  const [all, atts, prog] = await Promise.all([
    listEntries(env, res.id, {}, deps),
    listAttestations(env, res.id, deps),
    getProgramme(env, res.programmeId, deps)
  ]);
  const verified = all.filter((e) => !e.deleted && e.status === "verified");
  if (!verified.length) throw Object.assign(e400("pglog_cert_nothing_to_certify"), {
    userMessage: "There are no verified entries to certify yet. A certificate covers verified work only."
  });

  const today = M.isoDate(d.now());
  const months = M.attestationStatus(res, all, atts, { today });
  const counts = {};
  M.ENTRY_KINDS.forEach((k) => { counts[k] = verified.filter((e) => e.kind === k).length; });

  const at = d.now();
  const id = newId();
  let cert = M.certificate({
    id, residentId: res.id, programmeId: res.programmeId, orgId: res.orgId,
    departmentId: res.departmentId, scope: String((body && body.scope) || "final"),
    status: "pending",
    entryIds: verified.map((e) => e.id),
    entryCount: verified.length,
    counts,
    excluded: {
      draft: all.filter((e) => !e.deleted && e.status === "draft").length,
      submitted: all.filter((e) => !e.deleted && e.status === "submitted").length,
      returned: all.filter((e) => !e.deleted && e.status === "returned").length
    },
    monthsAttested: months.filter((m) => m.attested).length,
    monthsTotal: months.length,
    quorum: (prog && prog.config && prog.config.certQuorum) || undefined,
    requestedBy: actorUid, requestedAt: at, createdAt: at, updatedAt: at,
    history: [{ at, by: actorUid, action: "request" }]
  });
  cert.contentDigest = await digestContent(env, cert, verified, deps).catch(() => "");

  await d.fsCommit(env, [d.wCreate(env, COL.certificate + "/" + id, cert)]);
  await audit(env, res.orgId, actorUid, "pglog:cert:request", cert.entryCount + " entries", deps);
  // Tell the people who have to sign it. A request nobody hears about is a request that stalls.
  const roster = await facultyRoster(env, res.orgId, deps).catch(() => []);
  const tell = [res.guide].concat(res.coGuides || [],
    roster.filter((m) => m.role === "pg_hod").map((m) => m.identity));
  const told = {};
  for (const who of tell) {
    const k = norm(who);
    if (!k || told[k]) continue;
    told[k] = 1;
    await notify(env, { to: who, orgId: res.orgId, kind: "cert_signature_requested",
      residentId: res.id, certificateId: id,
      text: "A completed logbook is ready for your signature." }, deps);
  }
  return cert;
}

/* Sign it. Two gates, both already built: the CAPABILITY (a role that may verify or attest) and the
 * REGISTRATION (a person actually on a medical register). The signing role is decided by the SERVER
 * from the membership, never taken from the body — a client that could name itself "hod" would be
 * the whole quorum. */
export async function signCertificate(env, id, actorUid, body, deps) {
  const d = D(deps);
  const cur = await getCertificate(env, id, deps);
  if (!cur) throw e404("certificate");
  const res = await getResident(env, cur.residentId, deps);
  if (!res) throw e404("resident");
  const g = await gate(env, actorUid, cur.orgId, CAPS.PGLOG_ATTEST,
    { target: { departmentId: res.departmentId } }, deps);
  const snap = await (deps && deps.signerSnapshot ? deps.signerSnapshot : signerSnapshot)(env, actorUid, deps);

  const isGuide = M.sameActor(actorUid, res.guide) || (res.coGuides || []).some((x) => M.sameActor(actorUid, x));
  const role = g.role === "pg_hod" ? "hod" : (isGuide ? "guide" : "faculty");
  const at = d.now();
  const prog = await getProgramme(env, res.programmeId, deps);
  const quorum = (prog && prog.config && prog.config.certQuorum) || cur.quorum;

  let out = M.signCertificate(cur, {
    by: actorUid, role, reg: snap.regNo, council: snap.council, name: snap.name,
    regSource: snap.source, note: (body && body.note) || ""
  }, res.uid, at, quorum, res);

  // ISSUED. Re-derive the digest from the entries as they stand NOW: signing a document whose
  // content moved between the request and the last signature would certify something nobody read.
  if (out.status === "issued") {
    const covered = await entriesByIds(env, out.entryIds, deps);
    const fresh = await digestContent(env, out, covered, deps).catch(() => "");
    if (fresh && cur.contentDigest && fresh !== cur.contentDigest) {
      throw Object.assign(e409("pglog_cert_content_changed"), {
        userMessage: "The logbook changed after this certification was opened, so it was not issued. " +
          "Open a fresh certification request so the signatures cover what is actually there now."
      });
    }
    out.contentDigest = fresh || out.contentDigest;
    out.verifyCode = await issueCode(env, "certificate", out, deps);
  }

  await d.fsCommit(env, [d.wUpdate(env, COL.certificate + "/" + sanitize(id), out)]);
  await audit(env, cur.orgId, actorUid, "pglog:cert:sign", role + " reg:" + snap.regNo + " -> " + out.status, deps);
  await notify(env, { to: res.uid, orgId: cur.orgId, kind: out.status === "issued" ? "cert_issued" : "cert_signed",
    residentId: res.id, certificateId: id,
    text: out.status === "issued"
      ? "Your logbook is certified and can now be shared as a PDF."
      : "A faculty signature was added to your logbook certification." }, deps);
  return out;
}

// Read a specific set of entries. Chunked, because a certificate can cover thousands and the store's
// one-equality-filter rule means there is no "where id in (...)" to lean on.
async function entriesByIds(env, ids, deps) {
  const out = [];
  for (const id of (ids || [])) {
    const e = await getEntry(env, id, deps).catch(() => null);
    if (e) out.push(e);
  }
  return out;
}

/* A covered entry changed, so the certificate no longer describes a document that exists. Called
 * from amendEntry/deleteEntry — best-effort, because the digest recomputation at verification time
 * is the real backstop and a failure here must never block the correction itself. */
export async function supersedeCertificatesFor(env, entryId, reason, deps) {
  const d = D(deps);
  const e = await getEntry(env, entryId, deps).catch(() => null);
  if (!e) return 0;
  let n = 0;
  try {
    const certs = await listCertificates(env, e.residentId, deps);
    for (const c of certs) {
      if (c.status !== "issued") continue;
      if ((c.entryIds || []).indexOf(entryId) < 0) continue;
      const out = M.supersedeCertificate(c, reason, d.now(), "");
      await d.fsCommit(env, [d.wUpdate(env, COL.certificate + "/" + sanitize(c.id), out)]);
      if (c.verifyCode) { try { await V.supersede(env, c.verifyCode, "", deps); } catch (x) {} }
      await audit(env, c.orgId, "system", "pglog:cert:supersede", c.id + " " + reason, deps);
      await notify(env, { to: (await getResident(env, c.residentId, deps).catch(() => null) || {}).uid || "",
        orgId: c.orgId, kind: "cert_superseded", residentId: c.residentId, certificateId: c.id,
        text: "A certified logbook was superseded because a record it covered was corrected." }, deps);
      n++;
    }
  } catch (x) {}
  return n;
}

export async function revokeCertificate(env, id, actorUid, reason, deps) {
  const d = D(deps);
  const cur = await getCertificate(env, id, deps);
  if (!cur) throw e404("certificate");
  const res = await getResident(env, cur.residentId, deps);
  const g = await gate(env, actorUid, cur.orgId, CAPS.PGLOG_ATTEST,
    { target: { departmentId: res && res.departmentId } }, deps);
  // Withdrawing a document a University may already hold is a departmental decision, not a
  // faculty one.
  if (g.role !== "pg_hod") throw Object.assign(new Error("hod_required"), { status: 403,
    userMessage: "Only the head of department can revoke an issued certificate." });
  const out = M.revokeCertificate(cur, actorUid, d.now(), reason);
  if (cur.verifyCode) { try { await V.supersede(env, cur.verifyCode, "", deps); } catch (e) {} }
  await d.fsCommit(env, [d.wUpdate(env, COL.certificate + "/" + sanitize(id), out)]);
  await audit(env, cur.orgId, actorUid, "pglog:cert:revoke", id, deps);
  await notify(env, { to: res && res.uid, orgId: cur.orgId, kind: "cert_revoked", residentId: cur.residentId,
    certificateId: id, text: "A certified logbook was revoked: " + String(reason).slice(0, 160) }, deps);
  return out;
}

/* Is the certificate still true? Re-reads every covered entry and re-derives the digest — the same
 * check the public verification page runs, exposed so the export path can refuse to print an
 * "official" document over content that has moved. */
export async function certificateIntegrity(env, cert, deps) {
  if (!cert) return { ok: false, reason: "not_found" };
  if (cert.status !== "issued") return { ok: false, reason: cert.status };
  const covered = await entriesByIds(env, cert.entryIds, deps);
  const fresh = await digestContent(env, cert, covered, deps).catch(() => "");
  if (!fresh) return { ok: false, reason: "unavailable" };
  return { ok: V.digestEqual(fresh, cert.contentDigest), reason: "digest",
           missing: cert.entryIds.length - covered.length };
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
/* The same boundary for the OTHER records, which had none.
 *
 * publicEntry() was the documented privacy boundary and it was applied to entries only, while
 * assessments, attestations and the resident record were serialised raw next to it — so an audience
 * deliberately downgraded to "aggregate" still read the trainee's formative feedback (3000 chars),
 * their remediation action plan, every criterion score, and the resident's Firebase uid. A boundary
 * that covers one of four record types is not a boundary.
 *
 * What survives at aggregate is what oversight actually needs: that an assessment HAPPENED, of what
 * kind, when, by whom. Not what it said about the person.
 */
export function publicAssessment(a, audience) {
  if (!a) return null;
  const full = audience === "self" || audience === "verifier" || audience === "hod";
  const out = {
    id: a.id, residentId: a.residentId, templateId: a.templateId, status: a.status,
    encounterDate: a.encounterDate, assessedAt: a.assessedAt, assessor: a.assessor,
    createdAt: a.createdAt, signedAt: a.signedAt,
    assessorReg: a.assessorReg || "", assessorCouncil: a.assessorCouncil || "",
    assessorName: a.assessorName || "",
    // The OUTCOME is a fact about training progress and oversight needs it; the WORDS are feedback
    // to a named trainee and are nobody else's business.
    outcome: a.outcome, total: a.total, maxTotal: a.maxTotal,
    discussedWithTrainee: a.discussedWithTrainee,
    verifyCode: full ? (a.verifyCode || "") : ""
  };
  if (full) {
    out.scores = a.scores || {};
    out.feedback = a.feedback || "";
    out.strengths = a.strengths || "";
    out.improvements = a.improvements || "";
    out.actionPlan = a.actionPlan || "";
    out.setting = a.setting || "";
    out.caseSummary = a.caseSummary || "";
    out.history = a.history || [];
  }
  return out;
}

export function publicAttestation(a, audience) {
  if (!a) return null;
  const full = audience === "self" || audience === "verifier" || audience === "hod";
  return {
    id: a.id, residentId: a.residentId, kind: a.kind, period: a.period, counts: a.counts,
    attestedBy: a.attestedBy, attestedRole: a.attestedRole, attestedAt: a.attestedAt,
    attestedReg: a.attestedReg || "", attestedCouncil: a.attestedCouncil || "",
    attestedName: a.attestedName || "",
    entryCount: (a.entryIds || []).length,
    note: full ? (a.note || "") : "",
    entryIds: full ? (a.entryIds || []) : [],
    verifyCode: full ? (a.verifyCode || "") : ""
  };
}

/* The resident record itself. `uid` is the Firebase identity — an internal handle that has no
 * business leaving the server for anyone but the resident, and was being returned in full to every
 * dashboard caller. */
export function publicResident(r, audience) {
  if (!r) return null;
  const full = audience === "self" || audience === "verifier" || audience === "hod";
  const out = {
    id: r.id, name: r.name, smdId: r.smdId, orgId: r.orgId, programmeId: r.programmeId,
    departmentId: r.departmentId, trainingYear: r.trainingYear, startDate: r.startDate,
    expectedEndDate: r.expectedEndDate, status: r.status, unit: r.unit,
    guide: r.guide, coGuides: r.coGuides || [], rollNo: r.rollNo || ""
  };
  if (audience === "self") out.uid = r.uid;
  if (full) { out.notes = r.notes || ""; }
  return out;
}

/* A certificate is a document ABOUT a trainee that other people are meant to read, so it discloses
 * more than an entry does — but it still carries no clinical content, and the covered entry IDS are
 * the certificate's own audit trail, not something a third party needs. */
export function publicCertificate(c, audience) {
  if (!c) return null;
  const full = audience === "self" || audience === "verifier" || audience === "hod";
  const out = {
    id: c.id, residentId: c.residentId, orgId: c.orgId, scope: c.scope, status: c.status,
    entryCount: c.entryCount, counts: c.counts, excluded: c.excluded,
    monthsAttested: c.monthsAttested, monthsTotal: c.monthsTotal,
    quorum: c.quorum,
    // The registration numbers are the point of the document: they are public register data, and a
    // signature nobody can check is not a signature.
    signatures: (c.signatures || []).map((sig) => ({
      by: full ? sig.by : "", role: sig.role, reg: sig.reg, council: sig.council,
      name: sig.name, at: sig.at, note: full ? sig.note : ""
    })),
    requestedAt: c.requestedAt, issuedAt: c.issuedAt,
    contentDigest: c.contentDigest,
    supersededAt: c.supersededAt, supersedeReason: c.supersedeReason,
    revokedAt: c.revokedAt, revokeReason: c.revokeReason,
    verifyCode: full ? (c.verifyCode || "") : ""
  };
  if (full) { out.entryIds = c.entryIds; out.history = c.history; out.requestedBy = c.requestedBy; }
  return out;
}

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
    latencyDays: M.latencyDays(e),
    // The signature is not a secret — it is the thing that makes the record mean anything, and a
    // registration number is public information on the Indian Medical Register.
    verifiedReg: e.verifiedReg || "", verifiedCouncil: e.verifiedCouncil || "",
    verifiedName: e.verifiedName || "",
    // The CODE is not part of the signature — it is the capability that makes the public
    // verification endpoint safe to leave unauthenticated. Handing it to a third party with only
    // aggregate access lets them look the resident up by name and programme without ever holding the
    // document. It goes only to people who can already read the record it belongs to.
    verifyCode: full ? (e.verifyCode || "") : ""
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
// Academic Cell has institution-wide OVERSIGHT (5.2(iv) "ensure and monitor"), which is a
// completeness question, not a clinical-detail one.
export function audienceFor(role, actorUid, entry, resident) {
  if (resident && M.sameActor(actorUid, resident.uid)) return "self";
  if (role === "pg_hod") return "hod";
  if (can(role, CAPS.PGLOG_VERIFY) && entry && M.sameActor(actorUid, entry.supervisor)) return "verifier";
  if (can(role, CAPS.PGLOG_VERIFY)) return "verifier";
  return "aggregate";
}

// Can this actor sign anything at all? Used by the UI to EXPLAIN why a verify control is
// unavailable, never as the gate — the gate is signerSnapshot() throwing on the write path.
export async function signerStatus(env, actorUid, deps) { return canSign(env, actorUid, deps); }

export { COL, norm, residentId };
