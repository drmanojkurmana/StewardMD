/* functions/_wardsynq/patient-education.js - the hospital's own patient education leaflets, and which ones a patient
 * was given with their discharge.
 *
 * STRUCTURE ONLY. WardSynQ ships no leaflet: every title and word is written by the hospital, in the language it is
 * written in, and reviewed by a clinician of that hospital. There is no seed, sample or translation here.
 *
 * ONE EducationLeaflet RECORD PER LEAFLET PER LANGUAGE, versioned in the append-only store. A leaflet is a draft
 * until a SECOND clinician approves the exact version they read (expectedVersion): whoever wrote any of the current
 * draft may not approve it. Editing an approved leaflet makes it a draft again, so changed words never reach a patient
 * without a new approval. Retiring keeps the leaflet readable in the history and stops it being given again.
 *
 * NOTHING REACHES A PATIENT UNTIL IT IS APPROVED. Giving a leaflet (EducationAttachment, one per stay, a version per
 * change) accepts only an approved leaflet at the version the clinician was shown, and copies that version's words,
 * approver and approval time onto the patient's record. That copy is what prints after the discharge summary and what
 * the portal shows, so a later edit or retirement of the leaflet never changes what this patient was given. Taking a
 * leaflet back is a new version with who and why; it stays in the record, hidden from the print and the portal.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-patient-education.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { actorName } from "./patient-label.js";

const LEAFLET = "EducationLeaflet";
const GIVEN = "EducationAttachment";
const STATES = Object.freeze(["draft", "approved", "retired"]);
const MAX_TITLE = 160, MAX_BODY = 20000, MAX_TAGS = 20, MAX_TAG = 60;
/* A language tag as the portal's language list writes it (en, hi, ta, pt-BR). */
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
/* ponytail: one page of leaflets per load; a hospital with more than this wants a search. A full page says so. */
const SCAN = 500;

const str = (v) => (v == null ? "" : String(v).trim());
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const givenIdFor = (encounterId) => `wsq-edu-given-${str(encounterId).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100)}`;
const stripMeta = (r) => { const { meta, writtenBy, ...rest } = r; return rest; };

async function openService(request, env, ctx, need) {
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
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "this changed since it was shown; refresh and try again", written: 0 };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
}
async function readOne(svc, type, id) {
  try { return { rec: id ? await svc.get(type, id) : null }; }
  catch (e) { return { refuse: e instanceof GovernanceError ? { ok: false, status: 403, error: "permission" } : { ok: false, status: 502, error: "record_read_failed" } }; }
}

/** PURE. The leaflet fields from a request, or a refusal naming what is wrong. */
function leafletFields(input) {
  const i = input || {};
  const title = str(i.title), language = str(i.language), body = String(i.body == null ? "" : i.body).replace(/\r\n/g, "\n").trim();
  const tags = [...new Set((Array.isArray(i.tags) ? i.tags : []).map((t) => str(t).toLowerCase()).filter(Boolean))];
  const p = [];
  if (!title) p.push("title is required");
  else if (title.length > MAX_TITLE) p.push(`title is at most ${MAX_TITLE} characters`);
  if (!LANG.test(language)) p.push("language: a language code such as en, hi or ta");
  if (!body) p.push("body: write the leaflet text");
  else if (body.length > MAX_BODY) p.push(`body is at most ${MAX_BODY} characters`);
  if (tags.length > MAX_TAGS || tags.some((t) => t.length > MAX_TAG)) p.push(`tags: at most ${MAX_TAGS}, each at most ${MAX_TAG} characters`);
  return p.length ? { refuse: { error: "invalid_leaflet", detail: p.join("; "), problems: p } } : { fields: { title, language, body, tags } };
}

/** PURE. A leaflet as the library lists it. */
function leafletView(r) {
  return { leafletId: r.id, version: r.version, title: r.title, language: r.language, body: r.body, tags: r.tags || [], state: r.state,
    authorId: r.authorId, authorName: r.authorName || null, draftedBy: r.draftedBy || [], editedAt: r.editedAt || null,
    approval: r.approval || null, retired: r.retired || null };
}

/** POST /ward/education-leaflet-save. ctx: { leafletId?, expectedVersion (with leafletId), title, language, body, tags? } */
async function saveLeaflet(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const f = leafletFields(ctx);
  if (f.refuse) return { ...base, ok: false, status: 422, ...f.refuse, written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const me = resolved.actor.id, at = new Date().toISOString(), leafletId = str(ctx.leafletId);
  let next, expectedVersion;
  if (leafletId) {
    const got = await readOne(svc, LEAFLET, leafletId);
    if (got.refuse) return { ...base, ...got.refuse, written: 0 };
    const cur = got.rec;
    if (!cur) return { ...base, ok: false, status: 404, error: "leaflet_not_found", written: 0 };
    if (cur.state === "retired") return { ...base, ok: false, status: 409, error: "retired", detail: "a retired leaflet is not edited; write a new one", written: 0 };
    if (Number(ctx.expectedVersion) !== cur.version) return { ...base, ok: false, status: 409, error: "version_conflict", detail: "this leaflet changed since it was shown; refresh and try again", written: 0 };
    const same = ["title", "language", "body"].every((k) => cur[k] === f.fields[k]) && JSON.stringify(cur.tags || []) === JSON.stringify(f.fields.tags);
    if (same) return { ...base, ok: false, status: 422, error: "no_change", detail: "nothing was changed", written: 0 };
    const rest = stripMeta(cur);
    delete rest.version;
    /* An approved leaflet that is edited is a new draft: whoever approved the old words did not approve these. */
    next = { ...rest, ...f.fields, state: "draft", approval: null, editedAt: at,
      draftedBy: cur.state === "draft" ? [...new Set([...(cur.draftedBy || []), me])] : [me] };
    expectedVersion = cur.version;
  } else {
    next = { resourceType: LEAFLET, id: newId("wsq-edu"), ...f.fields, state: "draft", authorId: me, authorName: actorName(resolved.actor),
      draftedBy: [me], createdAt: at, editedAt: at, approval: null, retired: null, source: { system: "wardsynq-native", sourceId: "patient-education" } };
  }
  try {
    const put = await svc.put(next, { expectedVersion, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, leafletId: next.id, version: put.record.version, state: "draft" };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/** POST /ward/education-leaflet-approve. ctx: { leafletId, expectedVersion } - the version the approver read. */
async function approveLeaflet(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const got = await readOne(svc, LEAFLET, str(ctx.leafletId));
  if (got.refuse) return { ...base, ...got.refuse, written: 0 };
  const cur = got.rec, me = resolved.actor.id;
  if (!cur) return { ...base, ok: false, status: 404, error: "leaflet_not_found", written: 0 };
  if (cur.state !== "draft") return { ...base, ok: false, status: 409, error: "not_a_draft", detail: `this leaflet is ${cur.state}; only a draft is approved`, written: 0 };
  if (ctx.expectedVersion == null || Number(ctx.expectedVersion) !== cur.version) return { ...base, ok: false, status: 409, error: "version_conflict", detail: "approve the version you read: this leaflet changed since it was shown", written: 0 };
  if ((cur.draftedBy || [cur.authorId]).includes(me)) return { ...base, ok: false, status: 403, error: "own_leaflet", detail: "a leaflet is approved by a second clinician, not by anyone who wrote this draft", written: 0 };
  const rest = stripMeta(cur);
  delete rest.version;
  const next = { ...rest, state: "approved", approval: { by: me, byName: actorName(resolved.actor), at: new Date().toISOString(), draftVersion: cur.version } };
  try {
    const put = await svc.put(next, { expectedVersion: cur.version });
    return { ...base, ok: true, written: 1, leafletId: cur.id, version: put.record.version, state: "approved" };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/** POST /ward/education-leaflet-retire. ctx: { leafletId, reason }. Past attachments keep their own copy. */
async function retireLeaflet(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const reason = str(ctx.reason).slice(0, 300);
  if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the leaflet is retired", written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const got = await readOne(svc, LEAFLET, str(ctx.leafletId));
  if (got.refuse) return { ...base, ...got.refuse, written: 0 };
  const cur = got.rec;
  if (!cur) return { ...base, ok: false, status: 404, error: "leaflet_not_found", written: 0 };
  if (cur.state === "retired") return { ...base, ok: false, status: 409, error: "retired", written: 0 };
  const rest = stripMeta(cur);
  delete rest.version;
  const next = { ...rest, state: "retired", retired: { by: resolved.actor.id, byName: actorName(resolved.actor), at: new Date().toISOString(), reason } };
  try {
    const put = await svc.put(next, { expectedVersion: cur.version });
    return { ...base, ok: true, written: 1, leafletId: cur.id, version: put.record.version, state: "retired" };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/** GET /ward/education-leaflets. ctx: { state? }. The library, newest edit first. */
async function listLeaflets(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", leaflets: [] };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const state = str(ctx.state);
  if (state && !STATES.includes(state)) return { ...base, ok: false, status: 422, error: "state_unknown", detail: `state is one of ${STATES.join(", ")}` };
  let rows;
  try { rows = (await svc.list(LEAFLET, SCAN)) || []; } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed" }; }
  const leaflets = rows.filter((r) => r && (!state || r.state === state)).map(leafletView).sort((a, b) => str(b.editedAt).localeCompare(str(a.editedAt)));
  return { ...base, ok: true, me: resolved.actor.id, leaflets, ...(rows.length >= SCAN ? { partial: true, warning: `Only the newest ${SCAN} leaflets were read. Older ones may be missing.` } : {}) };
}

/** The stay, read as the caller (the patient compartment gate), and its attachment record. */
async function stayAndGiven(svc, encounterId) {
  if (!encounterId) return { refuse: { ok: false, status: 422, error: "encounter_required" } };
  const enc = await readOne(svc, "Encounter", encounterId);
  if (enc.refuse) return enc;
  if (!enc.rec) return { refuse: { ok: false, status: 404, error: "encounter_not_found" } };
  const given = await readOne(svc, GIVEN, givenIdFor(encounterId));
  if (given.refuse) return given;
  return { encounter: enc.rec, given: given.rec };
}

/** POST /ward/education-attach. ctx: { encounterId, leafletId, leafletVersion } - the approved version the clinician was shown. */
async function attachLeaflet(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const stay = await stayAndGiven(svc, str(ctx.encounterId));
  if (stay.refuse) return { ...base, ...stay.refuse, written: 0 };
  const got = await readOne(svc, LEAFLET, str(ctx.leafletId));
  if (got.refuse) return { ...base, ...got.refuse, written: 0 };
  const lf = got.rec;
  if (!lf) return { ...base, ok: false, status: 404, error: "leaflet_not_found", written: 0 };
  if (lf.state !== "approved") return { ...base, ok: false, status: 409, error: "not_approved", detail: `this leaflet is ${lf.state}; only an approved leaflet is given to a patient`, written: 0 };
  if (ctx.leafletVersion == null || Number(ctx.leafletVersion) !== lf.version) return { ...base, ok: false, status: 409, error: "version_conflict", detail: "this leaflet changed since it was shown; refresh and try again", written: 0 };
  const cur = stay.given, items = (cur && cur.items) || [];
  if (items.some((x) => !x.detached && x.leafletId === lf.id && x.leafletVersion === lf.version)) return { ...base, ok: false, status: 409, error: "already_attached", written: 0 };
  const me = resolved.actor.id, at = new Date().toISOString();
  const item = { itemId: newId("wsq-edu-item"), leafletId: lf.id, leafletVersion: lf.version, title: lf.title, language: lf.language, body: lf.body, tags: lf.tags || [],
    approvedById: lf.approval.by, approvedBy: lf.approval.byName || null, approvedAt: lf.approval.at,
    attachedById: me, attachedBy: actorName(resolved.actor), attachedAt: at, detached: null };
  const next = cur
    ? (() => { const r = stripMeta(cur); delete r.version; return { ...r, items: [...items, item] }; })()
    : { resourceType: GIVEN, id: givenIdFor(stay.encounter.id), patientId: stay.encounter.patientId, encounterId: stay.encounter.id, items: [item], source: { system: "wardsynq-native", sourceId: "patient-education" } };
  try {
    const put = await svc.put(next, { expectedVersion: cur ? cur.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, itemId: item.itemId, version: put.record.version };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/** POST /ward/education-detach. ctx: { encounterId, itemId, reason }. Kept in the record, hidden from print and portal. */
async function detachLeaflet(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const reason = str(ctx.reason).slice(0, 300);
  if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the leaflet is taken back", written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const stay = await stayAndGiven(svc, str(ctx.encounterId));
  if (stay.refuse) return { ...base, ...stay.refuse, written: 0 };
  const cur = stay.given, itemId = str(ctx.itemId);
  const hit = cur && (cur.items || []).find((x) => x.itemId === itemId);
  if (!hit) return { ...base, ok: false, status: 404, error: "item_not_found", written: 0 };
  if (hit.detached) return { ...base, ok: false, status: 409, error: "already_detached", written: 0 };
  const r = stripMeta(cur);
  delete r.version;
  const detached = { by: resolved.actor.id, byName: actorName(resolved.actor), at: new Date().toISOString(), reason };
  const next = { ...r, items: cur.items.map((x) => (x.itemId === itemId ? { ...x, detached } : x)) };
  try {
    const put = await svc.put(next, { expectedVersion: cur.version });
    return { ...base, ok: true, written: 1, itemId, version: put.record.version };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/** GET /ward/education-attachments. ctx: { encounterId }. Everything given on the stay, taken-back items marked. */
async function listAttachments(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", items: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  const stay = await stayAndGiven(svc, str(ctx.encounterId));
  if (stay.refuse) return { ...base, ...stay.refuse };
  return { ...base, ok: true, encounterId: stay.encounter.id, items: (stay.given && stay.given.items) || [], version: stay.given ? stay.given.version : null };
}

/** PURE. What the portal shows: the given copies still in force, newest first. Never a draft, never a taken-back one. */
function portalLeaflets(records) {
  const out = [];
  for (const r of records || []) for (const x of (r && r.items) || []) {
    if (x.detached) continue;
    out.push({ title: x.title, language: x.language, body: x.body, attachedAt: x.attachedAt });
  }
  return out.sort((a, b) => str(b.attachedAt).localeCompare(str(a.attachedAt)));
}

export {
  LEAFLET, GIVEN, STATES, leafletFields, leafletView, givenIdFor, portalLeaflets,
  saveLeaflet, approveLeaflet, retireLeaflet, listLeaflets, attachLeaflet, detachLeaflet, listAttachments,
};
