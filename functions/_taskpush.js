/* StewardMD — overdue ICU round-task escalation → native push to the whole unit.
 *
 * A shared ICU instruction (icuGroups/{gid}/patients/{pid}/tasks/{tid}) carries a priority-derived
 * `dueAt` (ms). When it passes `dueAt` and is still not `done`, the unit must be alerted so a
 * resident completes it or records why it's late. This module reads the task + the unit's members
 * from Firestore (Admin REST, service-account) and fans an APNs/FCM push out to EVERY member's
 * devices — so a member whose app is CLOSED still gets it. Each task is escalated ONCE (guarded by
 * a server-written `escalatedAt`).
 *
 * Two entry points (see functions/api/push/[[path]].js):
 *   - escalateOverdueTask(env, gid, pid, taskId)  — one task; called by a member's open app (heartbeat).
 *   - sweepOverdue(env)                            — collectionGroup scan of ALL overdue tasks (cron).
 */
import { serviceAccountToken } from "./_fbadmin.js";
import { nativePushEnabled, sendNativeToAll } from "./_nativepush.js";

const PROJECT_DEFAULT = "stewardmd-498ec";
const PRIO_LABEL = { immediate: "Immediate", high: "High", moderate: "Moderate", low: "Low" };

// identify() (functions/_fbauth.js) namespaces authenticated callers as "fb:<firebaseUid>", and
// native push TOKENS are stored under that namespaced id. But ICU membership docs
// (icuGroups/{gid}/members/{uid}) are keyed by the RAW Firebase uid the client writes
// (currentUser.uid). Membership lookups therefore need the RAW uid; token sends need the namespaced
// id. Mixing them silently broke BOTH paths — every membership check 403'd ("not-a-member", even for
// the unit head) and every push resolved to 0 tokens. rawUid() strips the namespace for Firestore
// membership; tokUid() restores it for the KV token store (member uids ARE Firebase uids, registered
// via identify() as "fb:"+uid), so both accept either form and normalise correctly.
const ID_NS = "fb:";
function rawUid(u) { return typeof u === "string" && u.indexOf(ID_NS) === 0 ? u.slice(ID_NS.length) : u; }
function tokUid(u) { return ID_NS + rawUid(u); }

function fsBase(env) { return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID || PROJECT_DEFAULT}/databases/(default)/documents`; }
function saTok(env) { return serviceAccountToken(env, "https://www.googleapis.com/auth/datastore"); }

// Firestore REST typed-value → JS.
function fval(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return +v.integerValue;
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
  if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fval);
  return null;
}
function decodeFields(f) { const o = {}; for (const k in f) o[k] = fval(f[k]); return o; }

// GET a single document's decoded fields (optionally masked to a few paths). null if missing/denied.
async function fsGet(env, tok, path, maskPaths) {
  let url = fsBase(env) + path;
  if (maskPaths && maskPaths.length) url += "?" + maskPaths.map((p) => "mask.fieldPaths=" + encodeURIComponent(p)).join("&");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d || d.error) return null;
  return d.fields ? decodeFields(d.fields) : {};   // doc exists but no fields → {}
}
// LIST a collection's docs (id + decoded fields).
async function fsList(env, tok, path) {
  const out = []; let pageToken;
  do {
    let url = fsBase(env) + path + "?pageSize=300";
    if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) break;
    const d = await r.json();
    (d.documents || []).forEach((doc) => out.push(Object.assign({ id: String(doc.name).split("/").pop() }, decodeFields(doc.fields || {}))));
    pageToken = d.nextPageToken || null;
  } while (pageToken);
  return out;
}
// PATCH one field (used to stamp escalatedAt so a task is only escalated once).
async function fsPatchField(env, tok, path, field, valueObj) {
  const r = await fetch(fsBase(env) + path + "?updateMask.fieldPaths=" + field, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { [field]: valueObj } }),
  });
  return r.ok;
}

// Is `uid` a member of the unit? (membership doc exists). Used to authorize a member-triggered call.
export async function isGroupMember(env, gid, uid) {
  if (!gid || !uid) return false;
  const tok = await saTok(env);
  const m = await fsGet(env, tok, `/icuGroups/${gid}/members/${rawUid(uid)}`, ["uid"]);
  return !!m;
}

// Escalate ONE overdue task: verify it's still overdue + un-escalated, push every member, stamp it.
export async function escalateOverdueTask(env, gid, pid, taskId, now) {
  now = now || Date.now();
  if (!nativePushEnabled(env)) return { error: "push-disabled" };
  if (!gid || !pid || !taskId) return { error: "bad-args" };
  const tok = await saTok(env);
  const taskPath = `/icuGroups/${gid}/patients/${pid}/tasks/${taskId}`;
  const t = await fsGet(env, tok, taskPath);
  if (!t) return { error: "task-not-found" };
  if (t.status === "done") return { skipped: "done" };
  if (t.escalatedAt) return { skipped: "already-escalated" };
  const dueAt = typeof t.dueAt === "number" ? t.dueAt : null;
  if (!dueAt || now < dueAt) return { skipped: "not-overdue" };

  const [g, p, members] = await Promise.all([
    fsGet(env, tok, `/icuGroups/${gid}`, ["name", "unit"]),
    fsGet(env, tok, `/icuGroups/${gid}/patients/${pid}`, ["name", "bed"]),
    fsList(env, tok, `/icuGroups/${gid}/members`),
  ]);
  const unitName = (g && g.name) || "ICU unit";
  const bed = (p && p.bed) || "";
  const prLabel = PRIO_LABEL[t.priority] || "";
  const overdueMin = Math.max(1, Math.round((now - dueAt) / 60000));
  const msg = {
    title: "⏰ Overdue task · " + unitName,
    body: (t.text || "Task") + (prLabel ? " (" + prLabel + ")" : "") + " is overdue by " + overdueMin + " min" + (bed ? " · Bed " + bed : "") + ". Complete it or record why.",
    tag: "icu-overdue-" + taskId,
    url: "https://stewardmd.in/",
  };
  const uids = [...new Set((members || []).map((m) => m.uid).filter(Boolean))];
  let sent = 0;
  for (const uid of uids) { try { const r = await sendNativeToAll(env, msg, { uid: tokUid(uid) }); sent += (r && r.sent) || 0; } catch (e) { /* skip */ } }
  // Only stamp escalatedAt (which permanently blocks any future retry, here and in the client's
  // matching `if (t.escalatedAt) return` guard) once the push actually reached a device, OR once
  // it's old enough that further retries aren't worth it. BUG FIXED: this used to stamp
  // unconditionally regardless of `sent` — so a task's very FIRST escalation attempt was its only
  // chance, and the common case (a teammate who hasn't registered a device for push yet) silenced
  // it forever, even after that teammate registered five minutes later. Now a 0-recipient attempt
  // within RETRY_CAP_MS is left unstamped, so the next 15-min cron sweep (or the next member's
  // heartbeat) retries automatically the moment someone registers — while a task that's been
  // retried for a full day with zero reach finally gets marked done so it doesn't loop forever.
  const RETRY_CAP_MS = 24 * 3600 * 1000;
  const finalize = sent > 0 || (now - dueAt) >= RETRY_CAP_MS;
  if (finalize) await fsPatchField(env, tok, taskPath, "escalatedAt", { integerValue: String(now) });
  return { escalated: sent > 0, finalized: finalize, unit: unitName, members: uids.length, sent };
}

// Immediate notification when an instruction is ISSUED (not only when overdue). Pushes the unit so
// residents see a new order at once — essential for high/immediate priority. Excludes the author; if
// the unit has only the author (solo), notifies them so it's still verifiable.
export async function notifyNewInstruction(env, gid, pid, byUid, info) {
  info = info || {};
  if (!nativePushEnabled(env)) return { error: "push-disabled" };
  if (!gid || !pid) return { error: "bad-args" };
  const tok = await saTok(env);
  const [g, p, members] = await Promise.all([
    fsGet(env, tok, `/icuGroups/${gid}`, ["name"]),
    fsGet(env, tok, `/icuGroups/${gid}/patients/${pid}`, ["name", "bed"]),
    fsList(env, tok, `/icuGroups/${gid}/members`),
  ]);
  const unitName = (g && g.name) || "ICU unit";
  const bed = (p && p.bed) || "";
  const prio = info.priority && PRIO_LABEL[info.priority] ? info.priority : "moderate";
  const count = Math.max(1, +info.count || 1);
  const text = String(info.text || "New instruction").slice(0, 90);
  const urgent = prio === "immediate" || prio === "high";
  const isHandover = info.kind === "handover";
  const msg = isHandover ? {
    title: "⇄ Shift handover · " + unitName,
    body: (bed ? "Bed " + bed + " — " : "") + text + " · tap to read the full SBAR",
    tag: "icu-handover-" + pid,
    url: "https://stewardmd.in/",
  } : {
    title: (urgent ? "🔴 " : "🩺 ") + PRIO_LABEL[prio] + " instruction · " + unitName,
    body: text + (count > 1 ? " (+" + (count - 1) + " more)" : "") + (bed ? " · Bed " + bed : ""),
    tag: "icu-instr-" + pid,
    url: "https://stewardmd.in/",
  };
  const byRaw = rawUid(byUid);   // author id normalised to the raw uid the member docs use
  let recipients = [...new Set((members || []).map((m) => m.uid).filter(Boolean))].filter((u) => rawUid(u) !== byRaw);
  if (!recipients.length && byRaw) recipients = [byRaw];   // solo unit → notify the author so it's verifiable
  let sent = 0;
  for (const uid of recipients) { try { const r = await sendNativeToAll(env, msg, { uid: tokUid(uid) }); sent += (r && r.sent) || 0; } catch (e) { /* skip */ } }
  return { notified: recipients.length, sent, priority: prio };
}

// Cron sweep: collectionGroup('tasks') where dueAt < now (single inequality → needs a COLLECTION_GROUP
// index on tasks.dueAt), then code-filter status!=done && !escalatedAt, and escalate each. Bounded.
export async function sweepOverdue(env, now) {
  now = now || Date.now();
  if (!nativePushEnabled(env)) return { error: "push-disabled" };
  const tok = await saTok(env);
  const q = {
    structuredQuery: {
      from: [{ collectionId: "tasks", allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: "dueAt" }, op: "LESS_THAN", value: { integerValue: String(now) } } },
      limit: 300,
    },
  };
  const r = await fetch(fsBase(env) + ":runQuery", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(q),
  });
  if (!r.ok) return { error: "query-failed", status: r.status, detail: (await r.text()).slice(0, 300) };
  const rows = await r.json();
  let checked = 0, escalated = 0, sent = 0;
  for (const row of rows || []) {
    const doc = row && row.document; if (!doc) continue;
    const f = decodeFields(doc.fields || {}); checked++;
    if (f.status === "done" || f.escalatedAt) continue;
    const m = String(doc.name).match(/icuGroups\/([^/]+)\/patients\/([^/]+)\/tasks\/([^/]+)$/); if (!m) continue;
    const res = await escalateOverdueTask(env, m[1], m[2], m[3], now);
    if (res && res.escalated) { escalated++; sent += res.sent || 0; }
  }
  return { checked, escalated, sent };
}
