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

// ── Notification categories & per-recipient preferences ─────────────────────────────────────────
// Every fan-out push carries a category. Tier-1 categories (patient-safety) ALWAYS send and ignore
// preferences. Tier-2/3 categories are filtered by each recipient's own opt-in, stored on their
// member doc as members/{uid}.notif = { orderRoutine, handover, activity } (booleans). When a member
// has no stored pref a ROLE default applies: supervising roles (head/professor/assistant) mute the
// Tier-3 "unit activity" stream so they aren't flooded by every routine order a resident logs, while
// executor roles get everything. This is why the fan-out iterates full member objects (for role +
// notif), not just uids.
const TIER1_CATEGORY = { overdue: true, "order-urgent": true, critical: true };
const SUPERVISING_ROLE = { head: true, professor: true, assistant: true };
const EXECUTOR_ROLE = { senior_resident: true, junior_resident: true, intern: true };
const INSTRUCT_ROLE = { head: true, professor: true, assistant: true, senior_resident: true };

function catPrefKey(category) {
  if (category === "order-routine") return "orderRoutine";
  if (category === "handover") return "handover";
  if (category === "activity") return "activity";
  return null;   // tier-1 / reminder → not preference-filtered
}
function wantsCategory(member, category) {
  if (TIER1_CATEGORY[category]) return true;                 // patient-safety → never filtered
  const key = catPrefKey(category);
  if (!key) return true;                                      // unknown/reminder → don't suppress
  const prefs = member && member.notif;
  if (prefs && typeof prefs[key] === "boolean") return prefs[key];
  if (key === "handover") return true;                        // handovers on for everyone by default
  return !SUPERVISING_ROLE[member && member.role];            // orderRoutine/activity: executors on, supervisors off
}

// Fan a message out to a unit's members, deduped by raw uid, honouring each member's category prefs.
// opts: { excludeRaw } skip the actor · { onlyRoles } restrict to a role set · { force } bypass prefs.
// Returns { sent } device deliveries and { attempted } recipients that passed the filter.
async function fanOut(env, members, msg, category, opts) {
  opts = opts || {};
  const seen = new Set();
  let sent = 0, attempted = 0;
  for (const m of (members || [])) {
    const uid = m && m.uid; if (!uid) continue;
    const raw = rawUid(uid);
    if (seen.has(raw)) continue; seen.add(raw);
    if (opts.excludeRaw && raw === opts.excludeRaw) continue;
    if (opts.onlyRoles && !opts.onlyRoles[m.role]) continue;
    if (!opts.force && !wantsCategory(m, category)) continue;
    attempted++;
    try { const r = await sendNativeToAll(env, msg, { uid: tokUid(uid) }); sent += (r && r.sent) || 0; } catch (e) { /* skip */ }
  }
  return { sent, attempted };
}

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
  const raw = rawUid(uid);
  // Primary: direct doc-id lookup (member docs are keyed by the raw Firebase uid).
  const m = await fsGet(env, tok, `/icuGroups/${gid}/members/${raw}`, ["uid"]);
  if (m) return true;
  // Fallback: a direct-GET miss is reported to the caller as "not-a-member" (403) even when the user
  // IS a member — e.g. a member doc keyed by an auto-id carrying a `uid` FIELD, which the client's
  // collectionGroup query matches (so the app shows the user's role) while this doc-id GET misses.
  // Match on the field, exactly as the client does, so the server agrees with what the user sees.
  try {
    const list = await fsList(env, tok, `/icuGroups/${gid}/members`);
    if (Array.isArray(list) && list.some((d) => d && rawUid(d.uid) === raw)) return true;
  } catch (e) {}
  return false;
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
  // Overdue is Tier-1 (patient-safety) → sent to every member regardless of their notification prefs.
  const { sent, attempted } = await fanOut(env, members, msg, "overdue");
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
  return { escalated: sent > 0, finalized: finalize, unit: unitName, members: attempted, sent };
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
    route: "tasks",   // watch deep-link target (ignored by phone/web)
  } : {
    title: (urgent ? "🔴 " : "🩺 ") + PRIO_LABEL[prio] + " instruction · " + unitName,
    body: text + (count > 1 ? " (+" + (count - 1) + " more)" : "") + (bed ? " · Bed " + bed : ""),
    tag: "icu-instr-" + pid,
    url: "https://stewardmd.in/",
    route: "tasks",   // watch deep-link target (ignored by phone/web)
  };
  const byRaw = rawUid(byUid);   // author id normalised to the raw uid the member docs use
  // Category drives per-recipient filtering: handovers → Tier-2; immediate/high → Tier-1 (locked on
  // for all); moderate/low → Tier-3 "unit activity" that supervising roles mute by default.
  const category = isHandover ? "handover" : (urgent ? "order-urgent" : "order-routine");
  // Real teammates that exist (deduped, minus author) — reported as `eligible` so the client can tell
  // "nobody else in the unit" apart from "everyone muted this category".
  const others = [...new Set((members || []).map((m) => rawUid(m.uid)).filter(Boolean))].filter((u) => u !== byRaw);
  let out = await fanOut(env, members, msg, category, { excludeRaw: byRaw });
  // Solo unit (author is the only member) → notify the author (force, bypass prefs) so it's verifiable.
  if (!others.length && byRaw) out = await fanOut(env, [{ uid: byRaw, role: "head" }], msg, category, { force: true });
  return { notified: out.attempted, sent: out.sent, eligible: others.length, priority: prio, category };
}

// Immediate CRITICAL-VALUE alert to the WHOLE unit when a member records a life-threatening result
// (e.g. K⁺ 7.0). Category "critical" is Tier-1 → sent to every member regardless of their prefs and
// even when the app is closed. Excludes the author; solo unit → notify the author so it's verifiable.
// info: { label, value, unit, bed?, reason? } — the value that tripped the critical threshold.
export async function notifyCriticalValue(env, gid, pid, byUid, info) {
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
  const bed = (p && p.bed) || info.bed || "";
  const label = String(info.label || "Critical value").slice(0, 40);
  const val = (info.value != null ? String(info.value) : "") + (info.unit ? " " + info.unit : "");
  const msg = {
    title: "🔴 CRITICAL · " + unitName,
    body: label + (val ? " " + val : "") + (bed ? " · Bed " + bed : "") + " — review now" + (info.reason ? " (" + String(info.reason).slice(0, 40) + ")" : "") + ".",
    tag: "icu-crit-" + pid + "-" + label.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    url: "https://stewardmd.in/",
    route: "critical",   // watch deep-link → CriticalLabs (ignored by phone/web)
    // Carry the shared-unit ids + analyte so the watch's LabAlert can attribute an acknowledge back to
    // this patient's timeline (without these the ack was dropped — the "ack didn't reach timeline" bug).
    gid: gid, pid: pid, analyte: label, value: (info.value != null ? String(info.value) : ""), units: info.unit || "",
  };
  const byRaw = rawUid(byUid);
  const others = [...new Set((members || []).map((m) => rawUid(m.uid)).filter(Boolean))].filter((u) => u !== byRaw);
  let out = await fanOut(env, members, msg, "critical", { excludeRaw: byRaw });
  if (!others.length && byRaw) out = await fanOut(env, [{ uid: byRaw, role: "head" }], msg, "critical", { force: true });
  return { notified: out.attempted, sent: out.sent, eligible: others.length, category: "critical" };
}

// On-demand "nudge": an instructing member re-pushes a task's reminder to the unit's executor roles
// (SR / JR / intern), excluding the nudger. Unlike escalateOverdueTask this has NO overdue /
// escalatedAt / done guards — it's an explicit human action, works before a task is due and again
// after. `redo` frames it as "please repeat" for a task already marked done. Only an instructing
// role may nudge (defence-in-depth; the button is also role-gated client-side).
export async function remindTask(env, gid, pid, taskId, byUid, redo) {
  if (!nativePushEnabled(env)) return { error: "push-disabled" };
  if (!gid || !pid || !taskId) return { error: "bad-args" };
  const tok = await saTok(env);
  const [t, g, p, members, actor] = await Promise.all([
    fsGet(env, tok, `/icuGroups/${gid}/patients/${pid}/tasks/${taskId}`),
    fsGet(env, tok, `/icuGroups/${gid}`, ["name"]),
    fsGet(env, tok, `/icuGroups/${gid}/patients/${pid}`, ["name", "bed"]),
    fsList(env, tok, `/icuGroups/${gid}/members`),
    fsGet(env, tok, `/icuGroups/${gid}/members/${rawUid(byUid)}`, ["name", "role"]),
  ]);
  if (!t) return { error: "task-not-found" };
  if (!actor || !INSTRUCT_ROLE[actor.role]) return { error: "forbidden" };
  const unitName = (g && g.name) || "ICU unit";
  const bed = (p && p.bed) || "";
  const byName = (actor && actor.name) || "A senior";
  const prLabel = PRIO_LABEL[t.priority] || "";
  const msg = {
    title: (redo ? "🔁 Please repeat · " : "⏰ Reminder · ") + unitName,
    body: byName + ": " + (t.text || "Task") + (prLabel ? " (" + prLabel + ")" : "") + (bed ? " · Bed " + bed : "") + (redo ? " — please do it again." : " — please complete."),
    tag: "icu-remind-" + taskId,
    url: "https://stewardmd.in/",
  };
  // Reminders bypass category prefs (explicit human ask) but only target executor roles.
  const out = await fanOut(env, members, msg, "reminder", { excludeRaw: rawUid(byUid), onlyRoles: EXECUTOR_ROLE });
  return { reminded: out.attempted, sent: out.sent };
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
