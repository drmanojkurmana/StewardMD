/* test/support-live.test.mjs - Help & Support: one centre, live chat, 30-day expiry once solved.
 *
 * Owner 2026-09-27: "live chat not working in bug centre ... one single Help & support centre ...
 * real time chatting ... I replied immediately but it never reached user or he received
 * notification" and "auto expiry of tickets within 30 days once solved".
 *
 * The D1 event log (functions/_support_live.js) runs its REAL SQL against node:sqlite through a
 * tiny D1-shaped shim. node --test --experimental-test-module-mocks --experimental-sqlite test/support-live.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

function d1() {
  const db = new DatabaseSync(":memory:");
  const prep = (sql) => {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).get(...args) || null; },
    };
    return st;
  };
  return { prepare: prep, async batch(sts) { for (const s of sts) await s.run(); return []; } };
}
function memKV() {
  const m = new Map(), ttl = new Map();
  return { _m: m, _ttl: ttl,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; },
    async put(k, v, o) { m.set(k, v); if (o && o.expirationTtl) ttl.set(k, o.expirationTtl); },
    async delete(k) { m.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
}

const STORE = memKV();
const WHO = { current: { id: "fb:doc1", guest: false, email: "d@x.in", name: "Asha" } };
const PUSHES = [];
const realUsage = await import("../functions/_usage.js");
const realPush = await import("../functions/_nativepush.js");
mock.module("../functions/_usage.js", { namedExports: { ...realUsage, identify: async () => WHO.current, usageKv: () => STORE } });
mock.module("../functions/_nativepush.js", { namedExports: { ...realPush, sendNativeToAll: async (env, msg, opts) => { PUSHES.push({ msg, opts }); return { sent: 1 }; } } });
const L = await import("../functions/_support_live.js");
const S = await import("../functions/_support.js");
const route = await import("../functions/api/support.js");
const ai = await import("../functions/api/ai/[[path]].js");

let DB = d1();
const ENV = () => ({ UPDATES_DB: DB, MAIK_KV: STORE, UPDATES_ADMIN_TOKEN: "owner-token-123" });
const post = async (body) => { const r = await route.onRequestPost({ request: new Request("https://x/api/support", { method: "POST", body: JSON.stringify(body) }), env: ENV(), waitUntil: (p) => p }); return { status: r.status, body: await r.json() }; };
const get = async (q) => { const r = await route.onRequestGet({ request: new Request("https://x/api/support" + (q || "")), env: ENV() }); return r.json(); };
async function admin(seg, body) {
  const req = new Request("https://stewardmd.in/api/ai/" + seg, { method: body ? "POST" : "GET", headers: { "X-Admin-Token": "owner-token-123", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const r = await ai.onRequest({ request: req, env: ENV(), params: { path: seg.split("?")[0].split("/") }, waitUntil: (p) => p });
  return { status: r.status, body: await r.json() };
}
function fresh() { DB = d1(); L._resetForTests(); STORE._m.clear(); PUSHES.length = 0; WHO.current = { id: "fb:doc1", guest: false, email: "d@x.in", name: "Asha" }; }

test("event log: append, read after a cursor, per-owner isolation, head", async () => {
  fresh(); const env = ENV();
  assert.equal(await L.headSeq(env, "fb:a"), 0);
  await L.logEvent(env, { ticket: "T1", owner: "fb:a", sender: "user", kind: "new", text: "hi", ts: Date.now() });
  await L.logEvent(env, { ticket: "T2", owner: "fb:b", sender: "user", kind: "new", text: "other doctor", ts: Date.now() });
  await L.logEvent(env, { ticket: "T1", owner: "fb:a", sender: "support", kind: "msg", text: "hello", ts: Date.now() });
  const a = await L.eventsSince(env, { owner: "fb:a", after: 0 });
  assert.equal(a.live, true); assert.deepEqual(a.events.map((e) => e.text), ["hi", "hello"]);
  assert.equal((await L.eventsSince(env, { owner: "fb:a", after: a.seq })).events.length, 0, "nothing new after the cursor");
  assert.equal((await L.eventsSince(env, { after: 0 })).events.length, 3, "admin sees everything");
  assert.equal(await L.headSeq(env, "fb:a"), a.seq);
  assert.deepEqual(await L.eventsSince({}, { owner: "fb:a", after: 0 }), { live: false, seq: 0, events: [] }, "no D1: the client falls back to re-reading");
});

test("THE REPORT: a developer reply reaches the doctor's open chat within one poll, and pushes to their phone", async () => {
  fresh();
  const t = (await post({ action: "create", kind: "help", text: "How do I export a case?" })).body.ticket;
  assert.equal(t.kind, "help"); assert.equal(t.subject, "How do I export a case?");
  const head = (await get("?live=1")).seq;            // the doctor's chat starts polling from "now"
  const r = await admin("admin/support-reply", { id: t.id, text: "Open the case, tap Share, choose PDF." });
  assert.equal(r.status, 200);
  const ev = await get("?live=1&after=" + head);
  const msg = ev.events.find((e) => e.kind === "msg");
  assert.ok(msg, "the reply is in the doctor's live feed");
  assert.equal(msg.sender, "support"); assert.equal(msg.text, "Open the case, tap Share, choose PDF."); assert.equal(msg.ticket, t.id);
  // The push bug: tokens are stored under "fb:<uid>"; the reply must target that exact id.
  assert.equal(PUSHES.length, 1); assert.deepEqual(PUSHES[0].opts, { uid: "fb:doc1" });
  assert.equal(JSON.stringify(PUSHES[0].msg).includes("Share"), false, "no message text on a lock screen");
  assert.match(PUSHES[0].msg.url, /#help$/);
});

test("the doctor's message reaches the admin inbox live; opening it sends 'Seen' back", async () => {
  fresh();
  const t = (await post({ action: "create", kind: "feedback", text: "Please add dark mode to CliniX" })).body.ticket;
  const h = (await admin("admin/support-live")).body.seq;
  await post({ action: "reply", id: t.id, text: "Also bigger fonts" });
  const ev = (await admin("admin/support-live?after=" + h)).body.events;
  assert.ok(ev.some((e) => e.kind === "msg" && e.sender === "user" && e.text === "Also bigger fonts"));
  assert.equal((await S.listTickets(STORE))[0].unread, true);
  const dh = (await get("?live=1")).seq;
  assert.equal((await admin("admin/support-seen", { id: t.id })).status, 200);
  assert.equal((await S.listTickets(STORE))[0].unread, false, "the dot clears");
  assert.ok((await get("?live=1&after=" + dh)).events.some((e) => e.kind === "read" && e.sender === "support"), "the doctor sees Seen");
});

test("status changes are live too, and a doctor writing on a solved conversation reopens it", async () => {
  fresh();
  const t = (await post({ action: "create", text: "Login loops" })).body.ticket;
  const h = (await get("?live=1")).seq;
  await admin("admin/support-reply", { id: t.id, text: "Fixed", resolve: true });
  const evs = (await get("?live=1&after=" + h)).events;
  assert.ok(evs.some((e) => e.kind === "status:resolved"));
  assert.equal((await S.getTicket(STORE, t.id)).status, "resolved");
  await post({ action: "reply", id: t.id, text: "Still happening on my iPad" });
  assert.equal((await S.getTicket(STORE, t.id)).status, "open", "reopened");
});

test("owner ask: a SOLVED conversation expires 30 days after it was solved; open ones do not", async () => {
  fresh();
  const t = (await post({ action: "create", text: "q" })).body.ticket;
  assert.equal(STORE._ttl.get("support:t:" + t.id), 180 * 86400, "open: long TTL");
  await admin("admin/support-reply", { id: t.id, text: "done", resolve: true });
  assert.equal(STORE._ttl.get("support:t:" + t.id), S.RESOLVED_TTL, "solved: 30 days");
  assert.equal(S.RESOLVED_TTL, 30 * 86400);
  // 31 days later the index row is gone as well (its body already expired in KV).
  const idx = JSON.parse(STORE._m.get("support:index"));
  idx[0].resolvedAt = Date.now() - 31 * 86400000; STORE._m.set("support:index", JSON.stringify(idx));
  assert.equal((await S.listTickets(STORE)).some((r) => r.id === t.id), false);
  // Reopening puts it back on the open TTL.
  const t2 = (await post({ action: "create", text: "q2" })).body.ticket;
  await admin("admin/support-reply", { id: t2.id, text: "done", resolve: true });
  await admin("admin/support-reply", { id: t2.id, status: "open" });
  assert.equal(STORE._ttl.get("support:t:" + t2.id), 180 * 86400);
});

test("one centre: kinds bug | help | feedback; new conversations are capped per day; guests get nothing", async () => {
  fresh();
  assert.equal((await post({ action: "create", kind: "feedback", text: "idea" })).body.ticket.kind, "feedback");
  assert.equal((await post({ action: "create", kind: "weird", text: "x" })).body.ticket.kind, "help");
  assert.equal((await post({ action: "bug", text: "broken" })).body.ticket.kind, "bug");
  const rows = await S.listTickets(STORE);
  assert.ok(rows.every((r) => r.last && r.last.text), "the inbox carries a last-message preview");
  for (let i = 0; i < route.NEW_PER_DAY - 2; i++) await post({ action: "create", text: "n" + i });
  assert.equal((await post({ action: "create", text: "one too many" })).status, 429);
  WHO.current = { guest: true };
  assert.deepEqual(await get("?live=1&after=0"), { ok: true, live: false, seq: 0, events: [] });
  assert.equal((await post({ action: "create", text: "x" })).status, 401);
});

/* Owner 2026-09-27, round 2: "still not as fast or real time as WhatsApp". */
test("long-poll: a held request answers the moment a reply lands, not at the next poll", async () => {
  fresh();
  const t = (await post({ action: "create", text: "Is the app down?" })).body.ticket;
  const head = (await get("?live=1")).seq;
  const t0 = Date.now();
  const held = get("?live=1&fast=1&wait=10&after=" + head);          // the doctor's chat, waiting
  setTimeout(() => { admin("admin/support-reply", { id: t.id, text: "No, all fine now." }); }, 300);
  const r = await held;
  const took = Date.now() - t0;
  assert.ok(r.events.some((e) => e.kind === "msg" && e.text === "No, all fine now."), "the reply came back on the held request");
  assert.ok(took < 2000, "answered within a tick of the reply (" + took + " ms), not after the 10 s wait");
  // Nothing happening: it waits the full time and returns empty.
  const t1 = Date.now();
  const idle = await L.waitEvents(ENV(), { owner: "fb:doc1", after: r.seq, waitMs: 500, tickMs: 100 });
  assert.equal(idle.events.length, 0); assert.ok(Date.now() - t1 >= 400);
  // The server caps the hold, and the D1 queries one held request can make.
  assert.equal(L.WAIT_MAX_MS, 25000);
  let q = 0; const db = DB, counting = { prepare: (sql) => { if (/^SELECT seq/.test(sql)) q++; return db.prepare(sql); }, batch: (x) => db.batch(x) };
  await L.waitEvents(ENV(), { owner: "fb:nobody", after: 0, waitMs: 25000, tickMs: 100 }, counting);
  assert.equal(q, L.MAX_CHECKS, "never more than MAX_CHECKS queries per hold");
});

test("typing: each side sees the other typing; only the owner can signal on a conversation", async () => {
  fresh();
  const t = (await post({ action: "create", text: "q" })).body.ticket;
  const dh = (await get("?live=1")).seq, ah = (await admin("admin/support-live")).body.seq;
  assert.equal((await admin("admin/support-typing", { id: t.id })).status, 200);
  assert.ok((await get("?live=1&after=" + dh)).events.some((e) => e.kind === "typing" && e.sender === "support"), "doctor sees support typing");
  assert.equal((await post({ action: "typing", id: t.id })).status, 200);
  assert.ok((await admin("admin/support-live?after=" + ah)).body.events.some((e) => e.kind === "typing" && e.sender === "user"), "admin sees the doctor typing");
  WHO.current = { id: "fb:someone-else", guest: false };
  assert.equal((await post({ action: "typing", id: t.id })).status, 404);
});

test("KV lag cannot hide or drop a message: reads and writes fold in the D1 log", async () => {
  fresh();
  const t = (await post({ action: "create", text: "first" })).body.ticket;
  // Simulate an edge location whose KV copy has not caught up with the developer's reply.
  const stale = STORE._m.get("support:t:" + t.id), staleIdx = STORE._m.get("support:index");
  await admin("admin/support-reply", { id: t.id, text: "Reply written at another PoP" });
  STORE._m.set("support:t:" + t.id, stale); STORE._m.set("support:index", staleIdx);
  // The doctor's list still shows it (merged from D1), unread.
  const mine = (await get("")).tickets.find((x) => x.id === t.id);
  assert.ok(mine.messages.some((m) => m.from === "support" && m.text === "Reply written at another PoP"));
  assert.equal(mine.userUnread, true);
  // The doctor answers from that stale copy: the reply is not overwritten away.
  await post({ action: "reply", id: t.id, text: "Thanks" });
  const texts = (await S.getTicket(STORE, t.id)).messages.map((m) => m.text);
  assert.deepEqual(texts, ["first", "Reply written at another PoP", "Thanks"]);
  // Same the other way: the admin's view of the thread and the inbox preview are current.
  STORE._m.set("support:t:" + t.id, stale); STORE._m.set("support:index", staleIdx);
  const one = (await admin("admin/support?id=" + t.id)).body.ticket;
  assert.deepEqual(one.messages.map((m) => m.text), ["first", "Reply written at another PoP", "Thanks"]);
  const row = (await admin("admin/support")).body.tickets.find((x) => x.id === t.id);
  assert.equal(row.last.text, "Thanks"); assert.equal(row.unread, true);
});

test("a conversation started a moment ago shows in the inbox before KV's index catches up", async () => {
  fresh();
  const before = STORE._m.get("support:index") || "[]";
  const t = (await post({ action: "bug", text: "Export button does nothing" })).body.ticket;
  STORE._m.set("support:index", before);                              // this edge has not seen it yet
  const row = (await admin("admin/support?status=open")).body.tickets.find((x) => x.id === t.id);
  assert.ok(row, "listed from the live log");
  assert.equal(row.kind, "bug"); assert.equal(row.unread, true); assert.match(row.subject, /Export button/);
  // Seen by support clears the dot even on the merged row.
  await admin("admin/support-seen", { id: t.id });
  STORE._m.set("support:index", before);
  assert.equal((await admin("admin/support")).body.tickets.find((x) => x.id === t.id).unread, false);
});
