/* functions/_kits_share.js - "every branch" wave 2: the server side of the specialty kits.
 *
 * Five things doctors asked to share or keep, each behind the same gate (env KITS_SHARE_ON = "1",
 * client flag smd_kits_share, both OFF until the owner turns them on):
 *   B1 referral   a referral (letter + kit summary) to a named, VERIFIED colleague's StewardMD inbox
 *   B3 handover   an I-PASS shift handover to the receiving doctor, who acknowledges it (read-back)
 *   B2 case room  a de-identified case thread; the owner invites colleagues by StewardMD ID
 *   B7 unit kit   a hospital or unit publishes its own additions to a kit (notes, order sets, local
 *                 test names, contacts) for its members; versions are immutable
 *   E3/E4 history kit values saved per patient across visits (antenatal card), per doctor
 *   F1 reviews    review-desk decisions synced for the owner, reviewer identity from the token
 *
 * Rules, all enforced here rather than trusted from the client:
 *   - Every caller is a Firebase-verified account; sending anything with patient data needs BOTH
 *     parties to be registration-verified doctors (claims.verified), so PHI only moves between
 *     verified doctors. Nobody can message themselves.
 *   - Patient data and clinical free text are AES-256-GCM encrypted at rest (FOLLOWCARE_PHI_KEY, the
 *     app's PHI key, as the OPD queue does). Metadata a list needs (kind, status, dates, kit id,
 *     sender name) stays plain; nothing else does.
 *   - No PHI in URLs, push text or logs: patient ids travel in POST bodies, pushes are fixed text,
 *     history documents are keyed by an HMAC of (doctor, patient id) under a key derived from the
 *     PHI key, so the id itself is never stored.
 *   - Case-room text is de-identified (stripIdentifiers) before it is stored.
 *   - Everything expires: referral 31 days, handover 3 days, case room 90 days after the last post,
 *     history 400 days after the last visit (a pregnancy and the postnatal period).
 *
 * The handlers take a ctx { env, uid, claims, deps, now, waitUntil } and a body, and return
 * { status, body }. deps injects Firestore, directory lookup, claims lookup, org lookup and push so
 * the logic is unit-tested without a network (test/kits-share.test.mjs). Collections are kx_*; the
 * Firestore rules' catch-all already denies clients.
 */
import { stripIdentifiers } from "./_deid.js";

export const LIMITS = {
  msgPayload: 24000, field: 2000, handoverRows: 30, caseTitle: 120, caseQuestion: 1000, caseSummary: 4000,
  casePost: 2000, casePosts: 200, caseMembers: 12, unitNotes: 3000, unitOrderSets: 10, unitTests: 15,
  unitInvestigations: 30, unitContacts: 10, histKeys: 80, histValue: 600, histEntries: 40, reviews: 600
};
export const TTL = { referral: 31 * 864e5, handover: 3 * 864e5, caseIdle: 90 * 864e5, hist: 400 * 864e5 };
export const RATE = { send: [30, 3600], caseCreate: [10, 3600], caseInvite: [30, 3600], casePost: [60, 3600], histAdd: [120, 3600], publish: [20, 3600] };
const KINDS = ["referral", "handover"];
const URGENCY = ["Routine", "Soon (within 2 weeks)", "Urgent (within 24 hours)", "Emergency (now)"];
const MSG_STATUS = { referral: ["seen", "accepted", "declined", "withdrawn"], handover: ["seen", "acknowledged", "withdrawn"] };
const PUBLISH_ROLES = ["admin", "pg_hod"];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PUSH = {
  referral: { title: "StewardMD", body: "A colleague sent you a referral. Open StewardMD to read it." },
  handover: { title: "StewardMD", body: "A colleague handed over patients to you. Open StewardMD to read it." },
  caseInvite: { title: "StewardMD", body: "A colleague asked for your opinion on a case. Open StewardMD to read it." },
  casePost: { title: "StewardMD", body: "New reply in a case you follow." }
};

/* ------------------------------------------------------------------ small pure helpers */
const enc = new TextEncoder(), dec = new TextDecoder();
function b64u(bytes) { let s = ""; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s) { const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(t + "===".slice((t.length + 3) % 4)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function hex(buf) { return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
export function newId(n) { const a = crypto.getRandomValues(new Uint8Array(n || 15)); const al = "abcdefghijkmnpqrstuvwxyz23456789"; let s = ""; a.forEach((b) => { s += al[b % al.length]; }); return s; }
const safeDocPart = (s) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
const R = (status, body) => ({ status, body });
const bad = (error, extra) => R(400, Object.assign({ error }, extra || {}));

/** Plain text in: no control characters, no HTML tags, em and en dashes become commas or hyphens,
 * capped. Returns "" for anything that is not a string or number. */
export function cleanText(v, max) {
  if (typeof v === "number") v = String(v);
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/<\/?[a-z!][^>]*>/gi, " ")
    .replace(/\s+[–—]\s+/g, ", ").replace(/[–—]/g, "-").trim().slice(0, max || LIMITS.field);
}
function cleanObj(o, maxKeys, maxVal) {
  const out = {};
  if (!o || typeof o !== "object" || Array.isArray(o)) return out;
  Object.keys(o).slice(0, maxKeys).forEach((k) => {
    const kk = String(k).replace(/[^A-Za-z0-9_:.-]/g, "").slice(0, 60); if (!kk) return;
    const v = o[k];
    if (typeof v === "boolean") out[kk] = v;
    else { const t = cleanText(v, maxVal); if (t) out[kk] = t; }
  });
  return out;
}

/* ------------------------------------------------------------------ crypto (PHI at rest) */
async function phiBytes(env) {
  const raw = env && env.FOLLOWCARE_PHI_KEY;
  if (!raw) throw Object.assign(new Error("phi_key_missing"), { status: 500 });
  const bytes = unb64u(raw);
  if (bytes.length !== 32) throw Object.assign(new Error("phi_key_bad_length"), { status: 500 });
  return bytes;
}
export async function seal(env, obj) {
  const key = await crypto.subtle.importKey("raw", await phiBytes(env), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12);
  return "kx1:" + b64u(out);
}
export async function unseal(env, blob) {
  if (!blob || String(blob).indexOf("kx1:") !== 0) return null;
  const key = await crypto.subtle.importKey("raw", await phiBytes(env), { name: "AES-GCM" }, false, ["decrypt"]);
  const all = unb64u(String(blob).slice(4));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12));
  return JSON.parse(dec.decode(pt));
}
/** HMAC(uid + patient id) under a key derived (HKDF) from the PHI key: the history doc id. */
export async function patientKey(env, uid, patientId) {
  const base = await crypto.subtle.importKey("raw", await phiBytes(env), "HKDF", false, ["deriveKey"]);
  const hk = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("stewardmd-kx"), info: enc.encode("kx-hist-v1") },
    base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  const norm = String(patientId || "").trim().toUpperCase().replace(/\s+/g, "");
  return hex(await crypto.subtle.sign("HMAC", hk, enc.encode(String(uid) + "\n" + norm))).slice(0, 40);
}

/* ------------------------------------------------------------------ shared guards */
function verifiedDoctor(claims) { return !!(claims && claims.verified === true); }
function senderName(claims) { return cleanText((claims && claims.name) || "", 80) || "A colleague"; }
async function limited(ctx, bucket) {
  const d = ctx.deps; if (!d.hitLimit) return false;
  const r = await d.hitLimit(bucket, ctx.uid, RATE[bucket][0], RATE[bucket][1]);
  return !!(r && r.ok === false);
}
/** { smdId } or { email } -> { uid } of a verified doctor, or an error code. */
async function resolveColleague(ctx, to) {
  const d = ctx.deps; to = to || {};
  const ident = to.smdId ? { smdId: String(to.smdId).slice(0, 20) } : to.email ? { email: String(to.email).slice(0, 120) } : null;
  if (!ident) return { error: "recipient_required" };
  const uid = await d.resolveUid(ident);
  if (!uid) return { error: "recipient_not_found" };
  if (uid === ctx.uid) return { error: "cannot_send_to_self" };
  const c = (await d.getClaims(uid)) || {};
  if (c.verified !== true) return { error: "recipient_not_verified" };
  return { uid, label: ident.smdId ? String(ident.smdId).toUpperCase() : cleanText(ident.email, 120).toLowerCase(), name: cleanText(c.name || "", 80) };
}
function push(ctx, uid, kind, data) {
  const d = ctx.deps; if (!d.push) return;
  const p = d.push(uid, Object.assign({}, PUSH[kind], { data: Object.assign({ type: "kits" }, data || {}) }));
  if (p && p.catch) { const q = p.catch(() => {}); if (ctx.waitUntil) ctx.waitUntil(q); }
}

/* ------------------------------------------------------------------ B1 + B3: messages */
export function validateMessage(body) {
  const b = body || {}, kind = b.kind, p = b.payload || {};
  if (KINDS.indexOf(kind) < 0) return { error: "bad_kind" };
  if (kind === "referral") {
    const out = {
      patient: cleanObj(p.patient, 6, 120), reason: cleanText(p.reason), history: cleanText(p.history, 4000), investigations: cleanText(p.investigations),
      treatment: cleanText(p.treatment), question: cleanText(p.question), kitSummary: cleanText(p.kitSummary, 6000)
    };
    if (!out.reason && !out.question) return { error: "reason_required" };
    if (!out.patient.name && !out.patient.age) return { error: "patient_required" };
    const meta = { kitId: ID_RE.test(b.kitId || "") ? String(b.kitId).slice(0, 40) : "", urgency: URGENCY.indexOf(b.urgency) >= 0 ? b.urgency : "Routine" };
    if (JSON.stringify(out).length > LIMITS.msgPayload) return { error: "too_large" };
    return { payload: out, meta };
  }
  const rows = (Array.isArray(p.rows) ? p.rows : []).slice(0, LIMITS.handoverRows).map((r) => ({
    bed: cleanText(r && r.bed, 40), sev: ["unstable", "watcher", "stable"].indexOf(r && r.sev) >= 0 ? r.sev : "",
    summary: cleanText(r && r.summary, 1500), actions: cleanText(r && r.actions, 1500), cont: cleanText(r && r.cont, 1500)
  })).filter((r) => r.bed || r.summary);
  if (!rows.length) return { error: "rows_required" };
  const out = { unit: cleanText(p.unit, 120), shift: cleanText(p.shift, 60), rows };
  if (JSON.stringify(out).length > LIMITS.msgPayload) return { error: "too_large" };
  return { payload: out, meta: { kitId: "", urgency: "" } };
}
export async function msgSend(ctx, body) {
  if (!verifiedDoctor(ctx.claims)) return R(403, { error: "verify_required" });
  const v = validateMessage(body); if (v.error) return bad(v.error);
  // Rate-limited BEFORE the lookup, so failed lookups count too: nobody can probe the directory for free.
  if (await limited(ctx, "send")) return R(429, { error: "rate_limited" });
  const to = await resolveColleague(ctx, body.to); if (to.error) return R(to.error === "recipient_not_found" ? 404 : 400, { error: to.error });
  const d = ctx.deps, id = newId(18), now = ctx.now;
  const doc = {
    kind: body.kind, fromUid: ctx.uid, toUid: to.uid, fromName: senderName(ctx.claims), fromRegNo: cleanText(ctx.claims.regNo || "", 40),
    toLabel: to.label, toName: to.name, kitId: v.meta.kitId, urgency: v.meta.urgency, status: "sent",
    createdAt: now, updatedAt: now, expiresAt: now + TTL[body.kind], box: await seal(ctx.env, v.payload), reply: ""
  };
  await d.fsCommit([d.wCreate("kx_msgs/" + id, doc)]);
  push(ctx, to.uid, body.kind, { kind: body.kind, id });
  return R(200, { ok: true, id });
}
function msgMeta(id, f, me) {
  return { id, kind: f.kind, dir: f.toUid === me ? "in" : "out", fromName: f.fromName, fromRegNo: f.fromRegNo, toLabel: f.toLabel, toName: f.toName || "",
    kitId: f.kitId, urgency: f.urgency, status: f.status, createdAt: f.createdAt, updatedAt: f.updatedAt, expiresAt: f.expiresAt };
}
export async function msgList(ctx) {
  const d = ctx.deps, now = ctx.now;
  const [inb, outb] = await Promise.all([d.fsQuery("kx_msgs", { where: { field: "toUid", value: ctx.uid }, limit: 200 }), d.fsQuery("kx_msgs", { where: { field: "fromUid", value: ctx.uid }, limit: 200 })]);
  const live = (rows) => rows.filter((r) => r.fields && r.fields.expiresAt > now && r.fields.status !== "withdrawn")
    .map((r) => msgMeta(r.id, r.fields, ctx.uid)).sort((a, b) => b.createdAt - a.createdAt);
  const expired = inb.concat(outb).filter((r) => r.fields && r.fields.expiresAt <= now).map((r) => d.wDelete("kx_msgs/" + r.id));
  if (expired.length) { const p = d.fsCommit(expired.slice(0, 100)).catch(() => {}); if (ctx.waitUntil) ctx.waitUntil(p); }
  return R(200, { inbox: live(inb), sent: live(outb) });
}
async function loadMsg(ctx, id) {
  const d = ctx.deps; id = safeDocPart(id); if (!id) return null;
  const doc = await d.fsGet("kx_msgs/" + id);
  if (!doc || !doc.fields) return null;
  const f = doc.fields;
  if (f.fromUid !== ctx.uid && f.toUid !== ctx.uid) return null;   // not a party: indistinguishable from absent
  if (f.expiresAt <= ctx.now) return null;
  return { id, f, updateTime: doc.updateTime };
}
export async function msgRead(ctx, body) {
  const m = await loadMsg(ctx, body && body.id); if (!m) return R(404, { error: "not_found" });
  const d = ctx.deps, f = m.f;
  if (f.toUid === ctx.uid && f.status === "sent") {
    await d.fsCommit([d.wUpdate("kx_msgs/" + m.id, { status: "seen", updatedAt: ctx.now }, { updateTime: m.updateTime })]).catch(() => {});
    f.status = "seen";
  }
  return R(200, { msg: Object.assign(msgMeta(m.id, f, ctx.uid), { payload: await unseal(ctx.env, f.box), reply: f.reply ? await unseal(ctx.env, f.reply) : null }) });
}
export async function msgStatus(ctx, body) {
  const m = await loadMsg(ctx, body && body.id); if (!m) return R(404, { error: "not_found" });
  const d = ctx.deps, f = m.f, st = body.status, allowed = MSG_STATUS[f.kind] || [];
  if (allowed.indexOf(st) < 0) return bad("bad_status");
  const isTo = f.toUid === ctx.uid;
  if (st === "withdrawn" ? f.fromUid !== ctx.uid : !isTo) return R(403, { error: "not_allowed" });
  if (["accepted", "declined", "acknowledged", "withdrawn"].indexOf(f.status) >= 0) return R(409, { error: "already_" + f.status });
  const note = cleanText(body.note, 1500);
  if (f.kind === "handover" && st === "acknowledged" && !note) return bad("readback_required");
  const patch = { status: st, updatedAt: ctx.now };
  if (note) patch.reply = await seal(ctx.env, { note, by: senderName(ctx.claims), at: ctx.now });
  try { await d.fsCommit([d.wUpdate("kx_msgs/" + m.id, patch, { updateTime: m.updateTime })]); }
  catch (e) { if (e && e.code === "precondition") return R(409, { error: "changed_retry" }); throw e; }
  return R(200, { ok: true, status: st });
}

/* ------------------------------------------------------------------ B2: case rooms */
export function deidentify(s, max) { return stripIdentifiers(cleanText(s, max)).slice(0, max); }
async function caseFor(ctx, id) {
  const d = ctx.deps; id = safeDocPart(id); if (!id) return null;
  const [c, mem] = await Promise.all([d.fsGet("kx_cases/" + id), d.fsGet("kx_case_mem/" + id + "__" + safeDocPart(ctx.uid))]);
  if (!c || !c.fields || !mem || !mem.fields) return null;
  if (c.fields.expiresAt <= ctx.now) return null;
  return { id, f: c.fields, role: mem.fields.role, updateTime: c.updateTime };
}
async function invite(ctx, caseId, smdIds, existing) {
  const d = ctx.deps, invited = [], notFound = [], writes = [];
  for (const s of (Array.isArray(smdIds) ? smdIds : []).slice(0, LIMITS.caseMembers)) {
    const to = await resolveColleague(ctx, String(s).indexOf("@") > 0 ? { email: s } : { smdId: s });
    if (to.error) { notFound.push({ smdId: String(s).slice(0, 20), error: to.error }); continue; }
    if (existing.indexOf(to.uid) >= 0 || invited.some((x) => x.uid === to.uid)) continue;
    if (existing.length + invited.length >= LIMITS.caseMembers) { notFound.push({ smdId: String(s).slice(0, 20), error: "room_full" }); continue; }
    invited.push(to);
    writes.push(d.wCreate("kx_case_mem/" + caseId + "__" + safeDocPart(to.uid), { caseId, uid: to.uid, role: "member", name: to.name, addedAt: ctx.now }));
  }
  return { invited, notFound, writes };
}
export async function caseCreate(ctx, body) {
  if (!verifiedDoctor(ctx.claims)) return R(403, { error: "verify_required" });
  const b = body || {};
  const title = deidentify(b.title, LIMITS.caseTitle), question = deidentify(b.question, LIMITS.caseQuestion), summary = deidentify(b.summary, LIMITS.caseSummary);
  if (!title || !question) return bad("title_and_question_required");
  if (await limited(ctx, "caseCreate")) return R(429, { error: "rate_limited" });
  const d = ctx.deps, id = newId(16), now = ctx.now;
  const inv = await invite(ctx, id, b.invite, [ctx.uid]);
  const writes = [
    d.wCreate("kx_cases/" + id, { ownerUid: ctx.uid, ownerName: senderName(ctx.claims), kitId: ID_RE.test(b.kitId || "") ? String(b.kitId).slice(0, 40) : "", status: "open",
      createdAt: now, updatedAt: now, expiresAt: now + TTL.caseIdle, posts: 0, box: await seal(ctx.env, { title, question, summary }) }),
    d.wCreate("kx_case_mem/" + id + "__" + safeDocPart(ctx.uid), { caseId: id, uid: ctx.uid, role: "owner", name: senderName(ctx.claims), addedAt: now })
  ].concat(inv.writes);
  await d.fsCommit(writes);
  inv.invited.forEach((t) => push(ctx, t.uid, "caseInvite", { caseId: id }));
  return R(200, { ok: true, id, invited: inv.invited.length, notFound: inv.notFound });
}
export async function caseList(ctx) {
  const d = ctx.deps, mems = (await d.fsQuery("kx_case_mem", { where: { field: "uid", value: ctx.uid }, limit: 200 })).filter((m) => m.fields && m.fields.caseId);
  // fsBatchGet returns a Map keyed by document path (null when absent).
  const docs = mems.length ? await d.fsBatchGet(mems.map((m) => "kx_cases/" + safeDocPart(m.fields.caseId))) : new Map();
  const out = [];
  for (const m of mems) {
    const id = safeDocPart(m.fields.caseId), c = docs.get("kx_cases/" + id);
    if (!c || !c.fields || c.fields.expiresAt <= ctx.now) continue;
    const box = await unseal(ctx.env, c.fields.box);
    out.push({ id, title: (box && box.title) || "", ownerName: c.fields.ownerName, kitId: c.fields.kitId, status: c.fields.status, posts: c.fields.posts || 0,
      updatedAt: c.fields.updatedAt, role: m.fields.role });
  }
  return R(200, { cases: out.sort((a, b) => b.updatedAt - a.updatedAt) });
}
export async function caseRead(ctx, body) {
  const c = await caseFor(ctx, body && body.id); if (!c) return R(404, { error: "not_found" });
  const d = ctx.deps;
  const [posts, mems] = await Promise.all([d.fsQuery("kx_case_posts", { where: { field: "caseId", value: c.id }, limit: LIMITS.casePosts }), d.fsQuery("kx_case_mem", { where: { field: "caseId", value: c.id }, limit: 50 })]);
  const list = [];
  for (const p of posts) { const box = await unseal(ctx.env, p.fields.box); list.push({ by: p.fields.authorName, mine: p.fields.authorUid === ctx.uid, at: p.fields.createdAt, text: (box && box.text) || "" }); }
  return R(200, { case: Object.assign({ id: c.id, ownerName: c.f.ownerName, kitId: c.f.kitId, status: c.f.status, role: c.role, createdAt: c.f.createdAt }, await unseal(ctx.env, c.f.box)),
    members: mems.map((m) => ({ name: m.fields.name || "", role: m.fields.role })), posts: list.sort((a, b) => a.at - b.at) });
}
export async function casePost(ctx, body) {
  const c = await caseFor(ctx, body && body.id); if (!c) return R(404, { error: "not_found" });
  if (c.f.status !== "open") return R(409, { error: "case_closed" });
  const text = deidentify(body.text, LIMITS.casePost); if (!text) return bad("text_required");
  if ((c.f.posts || 0) >= LIMITS.casePosts) return R(409, { error: "thread_full" });
  if (await limited(ctx, "casePost")) return R(429, { error: "rate_limited" });
  const d = ctx.deps, now = ctx.now, pid = c.id + "__" + String(now).padStart(14, "0") + "_" + newId(4);
  try {
    await d.fsCommit([
      d.wCreate("kx_case_posts/" + pid, { caseId: c.id, authorUid: ctx.uid, authorName: senderName(ctx.claims), createdAt: now, box: await seal(ctx.env, { text }) }),
      d.wUpdate("kx_cases/" + c.id, { posts: (c.f.posts || 0) + 1, updatedAt: now, expiresAt: now + TTL.caseIdle }, { updateTime: c.updateTime })
    ]);
  } catch (e) { if (e && e.code === "precondition") return R(409, { error: "changed_retry" }); throw e; }
  const mems = await d.fsQuery("kx_case_mem", { where: { field: "caseId", value: c.id }, limit: 50 });
  mems.map((m) => m.fields && m.fields.uid).filter((u) => u && u !== ctx.uid).forEach((u) => push(ctx, u, "casePost", { caseId: c.id }));
  return R(200, { ok: true });
}
export async function caseInvite(ctx, body) {
  const c = await caseFor(ctx, body && body.id); if (!c) return R(404, { error: "not_found" });
  if (c.role !== "owner") return R(403, { error: "owner_only" });
  if (c.f.status !== "open") return R(409, { error: "case_closed" });
  if (await limited(ctx, "caseInvite")) return R(429, { error: "rate_limited" });
  const d = ctx.deps, mems = await d.fsQuery("kx_case_mem", { where: { field: "caseId", value: c.id }, limit: 50 });
  const inv = await invite(ctx, c.id, body.smdIds, mems.map((m) => m.fields && m.fields.uid).filter(Boolean));
  if (inv.writes.length) await d.fsCommit(inv.writes);
  inv.invited.forEach((t) => push(ctx, t.uid, "caseInvite", { caseId: c.id }));
  return R(200, { ok: true, invited: inv.invited.length, notFound: inv.notFound });
}
export async function caseClose(ctx, body) {
  const c = await caseFor(ctx, body && body.id); if (!c) return R(404, { error: "not_found" });
  if (c.role !== "owner") return R(403, { error: "owner_only" });
  const d = ctx.deps;
  await d.fsCommit([d.wUpdate("kx_cases/" + c.id, { status: "closed", updatedAt: ctx.now }, { updateTime: c.updateTime })]);
  return R(200, { ok: true });
}

/* ------------------------------------------------------------------ B7: unit versions of a kit */
export function validateUnit(content) {
  const c = content || {};
  const orderSets = (Array.isArray(c.orderSets) ? c.orderSets : []).slice(0, LIMITS.unitOrderSets).map((o, i) => ({
    id: "unit-" + (i + 1), label: cleanText(o && o.label, 80),
    tests: (Array.isArray(o && o.tests) ? o.tests : []).map((t) => cleanText(t, 80)).filter(Boolean).slice(0, LIMITS.unitTests)
  })).filter((o) => o.label && o.tests.length >= 1);
  const investigations = (Array.isArray(c.investigations) ? c.investigations : []).slice(0, LIMITS.unitInvestigations).map((x) => ({
    label: cleanText(x && x.label, 80), query: cleanText((x && (x.query || x.label)) || "", 80)
  })).filter((x) => x.label);
  const contacts = (Array.isArray(c.contacts) ? c.contacts : []).map((x) => cleanText(x, 120)).filter(Boolean).slice(0, LIMITS.unitContacts);
  const out = { notes: cleanText(c.notes, LIMITS.unitNotes), orderSets, investigations, contacts };
  if (!out.notes && !orderSets.length && !investigations.length && !contacts.length) return { error: "empty" };
  return { content: out };
}
async function myOrgs(ctx) {
  const d = ctx.deps, ids = [ctx.uid].concat(ctx.claims && ctx.claims.email ? [String(ctx.claims.email).toLowerCase()] : []);
  const [member, owned] = await Promise.all([d.listOrgsForMember(ids), d.listOrgsForOwner(ctx.uid)]);
  const seen = {}, out = [];
  owned.forEach((o) => { if (o && o.id && !seen[o.id]) { seen[o.id] = 1; out.push({ id: o.id, name: o.name || "", role: "admin", owner: true }); } });
  member.forEach((o) => { if (o && o.id && !seen[o.id]) { seen[o.id] = 1; out.push({ id: o.id, name: o.name || "", role: o.memberRole || "viewer", owner: false }); } });
  return out;
}
export async function unitGet(ctx, query) {
  const kitId = String((query && query.kit) || ""); if (!ID_RE.test(kitId)) return bad("bad_kit");
  const d = ctx.deps, orgs = await myOrgs(ctx), versions = [];
  for (const o of orgs.slice(0, 10)) {
    const cur = await d.fsGet("kx_unit/" + safeDocPart(o.id) + "__" + kitId);
    if (!cur || !cur.fields || cur.fields.retired) continue;
    versions.push({ orgId: o.id, orgName: o.name, version: cur.fields.version, publishedBy: cur.fields.publishedBy, publishedAt: cur.fields.publishedAt, content: cur.fields.content });
  }
  const canPublish = verifiedDoctor(ctx.claims) ? orgs.filter((o) => o.owner || PUBLISH_ROLES.indexOf(o.role) >= 0).map((o) => ({ orgId: o.id, orgName: o.name })) : [];
  return R(200, { versions, canPublish });
}
export async function unitPublish(ctx, body) {
  const b = body || {};
  if (!verifiedDoctor(ctx.claims)) return R(403, { error: "verify_required" });
  if (!ID_RE.test(b.kitId || "")) return bad("bad_kit");
  const reason = cleanText(b.reason, 300); if (!reason) return bad("reason_required");
  const v = validateUnit(b.content); if (v.error) return bad(v.error);
  const orgs = await myOrgs(ctx), org = orgs.filter((o) => o.id === b.orgId)[0];
  if (!org || !(org.owner || PUBLISH_ROLES.indexOf(org.role) >= 0)) return R(403, { error: "not_allowed" });
  if (await limited(ctx, "publish")) return R(429, { error: "rate_limited" });
  const d = ctx.deps, base = safeDocPart(org.id) + "__" + b.kitId, cur = await d.fsGet("kx_unit/" + base);
  const version = ((cur && cur.fields && cur.fields.version) || 0) + 1, now = ctx.now, by = senderName(ctx.claims);
  const rec = { orgId: org.id, kitId: b.kitId, version, content: v.content, publishedBy: by, publishedByUid: ctx.uid, publishedAt: now, reason, retired: false };
  try {
    await d.fsCommit([
      d.wCreate("kx_unit_ver/" + base + "__v" + version, rec),
      cur ? d.wUpdate("kx_unit/" + base, rec, { updateTime: cur.updateTime }) : d.wCreate("kx_unit/" + base, rec)
    ]);
  } catch (e) { if (e && e.code === "precondition") return R(409, { error: "changed_retry" }); throw e; }
  return R(200, { ok: true, version });
}
export async function unitRetire(ctx, body) {
  const b = body || {};
  if (!verifiedDoctor(ctx.claims)) return R(403, { error: "verify_required" });
  const reason = cleanText(b.reason, 300); if (!reason) return bad("reason_required");
  const orgs = await myOrgs(ctx), org = orgs.filter((o) => o.id === b.orgId)[0];
  if (!org || !(org.owner || PUBLISH_ROLES.indexOf(org.role) >= 0)) return R(403, { error: "not_allowed" });
  if (!ID_RE.test(b.kitId || "")) return bad("bad_kit");
  const d = ctx.deps, base = safeDocPart(org.id) + "__" + b.kitId, cur = await d.fsGet("kx_unit/" + base);
  if (!cur || !cur.fields || cur.fields.retired) return R(404, { error: "not_found" });
  await d.fsCommit([d.wUpdate("kx_unit/" + base, { retired: true, retiredAt: ctx.now, retiredBy: senderName(ctx.claims), retireReason: reason }, { updateTime: cur.updateTime })]);
  return R(200, { ok: true });
}

/* ------------------------------------------------------------------ E3/E4: kit history per patient */
function cleanPatientId(v) { const s = String(v == null ? "" : v).trim(); return s.length >= 2 && s.length <= 64 ? s : ""; }
export async function histAdd(ctx, body) {
  const b = body || {}, pid = cleanPatientId(b.patientId);
  if (!pid) return bad("patient_id_required");
  if (!ID_RE.test(b.kitId || "")) return bad("bad_kit");
  const e = b.entry || {}, entry = { vals: cleanObj(e.vals, LIMITS.histKeys, LIMITS.histValue), tools: cleanObj(e.tools, LIMITS.histKeys, LIMITS.histValue), summary: cleanText(e.summary, 1500) };
  if (!Object.keys(entry.vals).length && !Object.keys(entry.tools).length && !entry.summary) return bad("empty");
  if (await limited(ctx, "histAdd")) return R(429, { error: "rate_limited" });
  const d = ctx.deps, key = await patientKey(ctx.env, ctx.uid, pid), path = "kx_hist/" + safeDocPart(ctx.uid) + "__" + key, now = ctx.now;
  const cur = await d.fsGet(path);
  let list = [];
  if (cur && cur.fields && cur.fields.box && cur.fields.expiresAt > now) list = (await unseal(ctx.env, cur.fields.box)) || [];
  list.push({ at: now, kitId: b.kitId, entry });
  if (list.length > LIMITS.histEntries) list = list.slice(-LIMITS.histEntries);
  const rec = { uid: ctx.uid, updatedAt: now, expiresAt: now + TTL.hist, count: list.length, box: await seal(ctx.env, list) };
  try { await d.fsCommit([cur ? d.wUpdate(path, rec, { updateTime: cur.updateTime }) : d.wCreate(path, rec)]); }
  catch (x) { if (x && x.code === "precondition") return R(409, { error: "changed_retry" }); throw x; }
  return R(200, { ok: true, count: list.length });
}
export async function histRead(ctx, body) {
  const b = body || {}, pid = cleanPatientId(b.patientId); if (!pid) return bad("patient_id_required");
  const d = ctx.deps, key = await patientKey(ctx.env, ctx.uid, pid), cur = await d.fsGet("kx_hist/" + safeDocPart(ctx.uid) + "__" + key);
  if (!cur || !cur.fields || cur.fields.expiresAt <= ctx.now) return R(200, { entries: [] });
  let list = (await unseal(ctx.env, cur.fields.box)) || [];
  if (b.kitId) list = list.filter((x) => x.kitId === b.kitId);
  return R(200, { entries: list });
}
export async function histForget(ctx, body) {
  const b = body || {}, pid = cleanPatientId(b.patientId); if (!pid) return bad("patient_id_required");
  const d = ctx.deps, key = await patientKey(ctx.env, ctx.uid, pid);
  await d.fsCommit([d.wDelete("kx_hist/" + safeDocPart(ctx.uid) + "__" + key)]);
  return R(200, { ok: true });
}

/* ------------------------------------------------------------------ F1: review decisions */
export async function reviewsPut(ctx, body) {
  const list = (Array.isArray(body && body.decisions) ? body.decisions : []).slice(0, LIMITS.reviews).map((x) => ({
    kind: ["protocol", "kit", "consent"].indexOf(x && x.kind) >= 0 ? x.kind : "", id: ID_RE.test((x && x.id) || "") ? String(x.id).slice(0, 80) : "",
    decision: ["approve", "approve-minor", "changes"].indexOf(x && x.decision) >= 0 ? x.decision : "", comment: cleanText(x && x.comment, 2000),
    at: /^\d{4}-\d{2}-\d{2}T/.test((x && x.at) || "") ? String(x.at).slice(0, 30) : ""
  })).filter((x) => x.kind && x.id && x.decision && x.at && (x.decision === "approve" || x.comment));
  if (!list.length) return bad("no_decisions");
  const d = ctx.deps, c = ctx.claims || {};
  await d.fsCommit([d.wUpdate("kx_reviews/" + safeDocPart(ctx.uid), {
    uid: ctx.uid, name: senderName(c), email: cleanText(c.email || "", 120), regNo: cleanText(c.regNo || "", 40), verified: c.verified === true, decisions: list, updatedAt: ctx.now
  })]);
  return R(200, { ok: true, count: list.length });
}
/** Owner only (the router checks): every reviewer's decisions in the review-desk export shape, so
 * scripts/apply-reviews.mjs applies them unchanged. verified comes from the token, not the phone. */
export async function reviewsAll(ctx) {
  const rows = await ctx.deps.fsQuery("kx_reviews", { limit: 500 });
  return R(200, { reviews: rows.map((r) => ({ schema: 1, app: "StewardMD review desk (server)", exportedAt: new Date(r.fields.updatedAt || ctx.now).toISOString(),
    reviewer: { name: r.fields.name || "", regNo: r.fields.regNo || "", speciality: "", verified: r.fields.verified === true }, decisions: r.fields.decisions || [] })) });
}

/* ------------------------------------------------------------------ routing table (used by the router) */
export const ROUTES = {
  "POST msg/send": msgSend, "GET msg/list": msgList, "POST msg/read": msgRead, "POST msg/status": msgStatus,
  "POST case/create": caseCreate, "GET case/list": caseList, "POST case/read": caseRead, "POST case/post": casePost, "POST case/invite": caseInvite, "POST case/close": caseClose,
  "GET unit": unitGet, "POST unit/publish": unitPublish, "POST unit/retire": unitRetire,
  "POST hist/add": histAdd, "POST hist/read": histRead, "POST hist/forget": histForget,
  "POST reviews": reviewsPut
};
