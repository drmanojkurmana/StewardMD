/* StewardMD — server-side ICU writes for the Apple Watch (direct-API path).
 *
 * The watch can't run the Firestore client SDK, so instead of only relaying
 * through the phone it calls these endpoints directly (authed with its bridged
 * Firebase ID token). We write to Firestore via the Admin REST API + the
 * service account, exactly mirroring what the phone's SMD_ICU_GROUPS does:
 *   - setTaskStatus  → PATCH the task doc (+ append a "Task completed" timeline)
 *   - appendTimeline → POST a timeline event (used for critical-ack)
 *
 * Security: the caller's uid comes from the VERIFIED token (never the body), and
 * every write is gated on the caller being a member of the unit (isGroupMember).
 */
import { serviceAccountToken } from "./_fbadmin.js";
import { isGroupMember } from "./_taskpush.js";

const PROJECT_DEFAULT = "stewardmd-498ec";
function fsBase(env) { return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID || PROJECT_DEFAULT}/databases/(default)/documents`; }
function saTok(env) { return serviceAccountToken(env, "https://www.googleapis.com/auth/datastore"); }
const ID_NS = "fb:";
const rawUid = (u) => (typeof u === "string" && u.indexOf(ID_NS) === 0 ? u.slice(ID_NS.length) : u);

// JS → Firestore REST typed value.
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function encFields(obj) { const f = {}; for (const k in obj) if (obj[k] !== undefined) f[k] = enc(obj[k]); return f; }

async function fsGetRaw(env, tok, path) {
  const r = await fetch(fsBase(env) + path, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && d.fields ? d.fields : (d ? {} : null);
}
async function fsPatch(env, tok, path, fields) {
  const mask = Object.keys(fields).map((k) => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  const r = await fetch(fsBase(env) + path + "?" + mask, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encFields(fields) }),
  });
  return r.ok;
}
async function fsCreate(env, tok, collectionPath, fields) {
  const r = await fetch(fsBase(env) + collectionPath, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encFields(fields) }),
  });
  return r.ok;
}
async function memberName(env, tok, gid, rawId) {
  try {
    const m = await fsGetRaw(env, tok, `/icuGroups/${gid}/members/${rawId}`);
    return (m && m.name && m.name.stringValue) || "Clinician";
  } catch (e) { return "Clinician"; }
}
async function appendTimeline(env, tok, gid, pid, ev) {
  const fields = {
    ts: new Date(), type: ev.type || "note", title: ev.title || "", detail: ev.detail || "",
    by: ev.by || null, byName: ev.byName || "", byRole: ev.byRole || null,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),   // matches the client TTL
  };
  return fsCreate(env, tok, `/icuGroups/${gid}/patients/${pid}/timeline`, fields);
}

/// Set a task's status server-side (+ a "Task completed" timeline on done).
/// `uid` is the verified caller (namespaced or raw). Returns {ok} or {error}.
export async function watchSetTaskStatus(env, uid, gid, pid, taskId, status) {
  if (!gid || !pid || !taskId || !status) return { error: "bad-args" };
  if (!["pending", "progress", "done"].includes(status)) return { error: "bad-status" };
  if (!(await isGroupMember(env, gid, uid))) return { error: "forbidden" };
  const tok = await saTok(env);
  const raw = rawUid(uid);
  const taskPath = `/icuGroups/${gid}/patients/${pid}/tasks/${taskId}`;
  const done = status === "done";
  const name = done ? await memberName(env, tok, gid, raw) : "";
  const patch = done
    ? { status, completedBy: raw, completedByName: name, completedAt: new Date() }
    : { status, completedBy: null, completedByName: null, completedAt: null };
  if (!(await fsPatch(env, tok, taskPath, patch))) return { error: "write-failed" };
  if (done) {
    let text = "task";
    try { const tf = await fsGetRaw(env, tok, taskPath); if (tf && tf.text && tf.text.stringValue) text = tf.text.stringValue; } catch (e) {}
    await appendTimeline(env, tok, gid, pid, { type: "task", title: "Task completed — " + text, by: raw, byName: name });
  }
  return { ok: true };
}

/// Post a round instruction from the watch (e.g. after a critical-value ack the senior dictates an
/// order). Creates a PENDING task + an audit timeline event, and returns {ok, text, priority} so the
/// route can fan the new-instruction push out to the unit. `uid` is the verified caller.
export async function watchPostInstruction(env, uid, gid, pid, text, priority) {
  const txt = String(text || "").trim().slice(0, 400);
  if (!gid || !pid || !txt) return { error: "bad-args" };
  if (!(await isGroupMember(env, gid, uid))) return { error: "forbidden" };
  const tok = await saTok(env);
  const raw = rawUid(uid);
  const m = await fsGetRaw(env, tok, `/icuGroups/${gid}/members/${raw}`);
  const name = (m && m.name && m.name.stringValue) || "Clinician";
  const role = (m && m.role && m.role.stringValue) || null;
  const prio = ["immediate", "high", "moderate", "low"].includes(priority) ? priority : "high";
  const ok = await fsCreate(env, tok, `/icuGroups/${gid}/patients/${pid}/tasks`, {
    text: txt, priority: prio, status: "pending", ts: new Date(),
    by: raw, byName: name, byRole: role, source: "watch",
  });
  if (!ok) return { error: "write-failed" };
  await appendTimeline(env, tok, gid, pid, { type: "instruction", title: "Round instruction — " + name, detail: txt, by: raw, byName: name, byRole: role });
  return { ok: true, text: txt, priority: prio };
}

/// Append a timeline event server-side (critical-ack). Returns {ok} or {error}.
export async function watchAppendTimeline(env, uid, gid, pid, ev) {
  if (!gid || !pid) return { error: "bad-args" };
  if (!(await isGroupMember(env, gid, uid))) return { error: "forbidden" };
  const tok = await saTok(env);
  const raw = rawUid(uid);
  const name = await memberName(env, tok, gid, raw);
  await appendTimeline(env, tok, gid, pid, {
    type: (ev && ev.type) || "note", title: (ev && ev.title) || "", detail: (ev && ev.detail) || "",
    by: raw, byName: name,
  });
  return { ok: true };
}
