/* PrepNucleus social route (functions/api/prep/social) and helpers (functions/_prep-social.js), on node:sqlite behind
 * the D1 shim of prep-arena-server.test.mjs with the real schema. Firebase claims and Firestore (doctorDirectory,
 * users/{uid}/profile/self) are mocked. What must hold: only Arena players use social; friends need a request and an
 * accept; challenges go only to accepted friends; college keys normalise; boards rank by 30-day event score; groups cap
 * at 30; Leave Arena deletes every social row.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-social-server.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const CLAIMS = {};
const USERS = { a: "Asha Rao", b: "Bilal K", c: "Chitra M", d: "Dev P" };
for (const k of Object.keys(USERS)) CLAIMS["tok-" + k] = { sub: "u-" + k, name: USERS[k] };
const SMD = { a: "SMD-AAAAAA", b: "SMD-BBBBBB", c: "SMD-CCCCCC", d: "SMD-DDDDDD" };
const FS = new Map();
for (const k of Object.keys(SMD)) { FS.set("doctorDirectory/" + SMD[k], { uid: "u-" + k }); FS.set("users/u-" + k + "/profile/self", { smdId: SMD[k] }); }
let fsDown = false;
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null } });
const realFs = await import("../functions/_fbfirestore.js");
mock.module("../functions/_fbfirestore.js", { namedExports: { ...realFs, fsGet: async (env, p) => { if (fsDown) throw new Error("down"); const f = FS.get(p); return f ? { fields: f } : null; } } });
const route = await import("../functions/api/prep/social/[[path]].js");
const arena = await import("../functions/api/prep/arena/[[path]].js");
const S = await import("../functions/_prep-social.js");
const A = await import("../functions/_prep-arena.js");

const SCHEMA = fs.readFileSync(new URL("../prep-arena-worker/schema.sql", import.meta.url), "utf8");
const MIGRATION = fs.readFileSync(new URL("../prep-arena-worker/migrations/0002_social.sql", import.meta.url), "utf8");
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return { db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } };
}
const T0 = Date.parse("2026-10-07T06:30:00Z");   // Wednesday 12:00 IST
function call(env, method, path, who, body, now = T0, base = "social") {
  const req = new Request(`https://stewardmd.in/api/prep/${base}/` + path, { method, headers: { "Content-Type": "application/json", ...(who ? { Authorization: "Bearer tok-" + who } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return (base === "social" ? route : arena).handle(req, env, path.split("?")[0], now).then(async (r) => ({ status: r.status, body: await r.json() }));
}
async function envWith(...who) {
  const env = { PREP_ARENA_DB: d1() };
  for (const w of who) await call(env, "POST", "consent", w, null, T0, "arena");
  return env;
}
const uh = (k) => A.uidHash("u-" + k);
async function friends(env, x, y) { await call(env, "POST", "friends/add", x, { smdId: SMD[y] }); await call(env, "POST", "friends/accept", y, { smdId: SMD[x] }); }

test("schema.sql carries the social migration verbatim", () => { assert.ok(SCHEMA.includes(MIGRATION)); });

test("consent gate: 401 without a token, 403 consent-required before joining the Arena", async () => {
  const env = await envWith("a");
  assert.equal((await call(env, "GET", "friends", null)).status, 401);
  for (const [m, p] of [["GET", "friends"], ["POST", "friends/add"], ["GET", "college-list"], ["GET", "groups"], ["POST", "challenge"]]) {
    const r = await call(env, m, p, "b", m === "POST" ? {} : null);
    assert.deepEqual([r.status, r.body.error], [403, "consent-required"], m + " " + p);
  }
  assert.equal((await call({}, "GET", "friends", "a")).status, 503);
});

test("friends: add, accept, decline, remove, and the error codes", async () => {
  const env = await envWith("a", "b", "c");
  assert.deepEqual((await call(env, "POST", "friends/add", "a", { smdId: "smd-aaaaaa" })).body, { error: "self" });
  assert.deepEqual((await call(env, "POST", "friends/add", "a", { smdId: "SMD-ZZZZZZ" })), { status: 404, body: { error: "not_found" } });
  assert.deepEqual((await call(env, "POST", "friends/add", "a", { smdId: SMD.d })), { status: 409, body: { error: "not_in_arena" } });
  assert.deepEqual((await call(env, "POST", "friends/add", "a", { smdId: " smd-bbbbbb " })).body, { ok: true });
  assert.deepEqual((await call(env, "POST", "friends/add", "a", { smdId: SMD.b })).body, { error: "already" });
  let fa = (await call(env, "GET", "friends", "a")).body, fb = (await call(env, "GET", "friends", "b")).body;
  assert.deepEqual(fa, { friends: [], incoming: [], outgoing: [{ smdId: SMD.b, name: "Bilal K", at: T0 }] });
  assert.deepEqual(fb, { friends: [], incoming: [{ smdId: SMD.a, name: "Asha Rao", at: T0 }], outgoing: [] });
  assert.equal((await call(env, "POST", "friends/accept", "a", { smdId: SMD.b })).status, 404, "the requester cannot accept their own request");
  assert.deepEqual((await call(env, "POST", "friends/accept", "b", { smdId: SMD.a }, T0 + 5)).body, { ok: true });
  fa = (await call(env, "GET", "friends", "a")).body;
  assert.deepEqual(fa.friends, [{ smdId: SMD.b, name: "Bilal K", since: T0 + 5 }]);
  assert.deepEqual((await call(env, "POST", "friends/add", "b", { smdId: SMD.a })).body, { error: "already" });
  // decline
  await call(env, "POST", "friends/add", "c", { smdId: SMD.a });
  assert.deepEqual((await call(env, "POST", "friends/decline", "a", { smdId: SMD.c })).body, { ok: true });
  assert.deepEqual((await call(env, "GET", "friends", "c")).body.outgoing, []);
  // adding someone who already asked you accepts
  await call(env, "POST", "friends/add", "c", { smdId: SMD.b });
  assert.deepEqual((await call(env, "POST", "friends/add", "b", { smdId: SMD.c })).body, { ok: true });
  assert.equal((await call(env, "GET", "friends", "b")).body.friends.length, 2);
  // remove
  assert.deepEqual((await call(env, "POST", "friends/remove", "a", { smdId: SMD.b })).body, { ok: true });
  assert.deepEqual((await call(env, "GET", "friends", "b")).body.friends.map((f) => f.name), ["Chitra M"]);
  assert.equal((await call(env, "POST", "friends/remove", "a", { smdId: SMD.b })).status, 404);
  // Firestore down is 503, never "not found"
  fsDown = true;
  try { assert.equal((await call(env, "POST", "friends/add", "a", { smdId: "SMD-QQQQQQ" })).status, 503); } finally { fsDown = false; }
});

test("challenges: only to accepted friends; accept and decline; expiry", async () => {
  const env = await envWith("a", "b", "c");
  await call(env, "POST", "friends/add", "a", { smdId: SMD.c });   // pending only
  assert.deepEqual((await call(env, "POST", "challenge", "a", { smdId: SMD.c })), { status: 403, body: { error: "not_friends" } });
  await friends(env, "a", "b");
  assert.equal((await call(env, "POST", "challenge", "a", { smdId: SMD.b, exam: "foo" })).status, 400);
  const ch = (await call(env, "POST", "challenge", "a", { smdId: SMD.b, exam: "usmle" })).body;
  assert.match(ch.room, S.ROOM_RE);
  assert.deepEqual([ch.expiresAt, ch.exam], [T0 + 600e3, "usmle"]);
  const inc = (await call(env, "GET", "challenges", "b")).body;
  assert.deepEqual(inc, { incoming: [{ room: ch.room, from: { smdId: SMD.a, name: "Asha Rao" }, exam: "usmle", expiresAt: T0 + 600e3 }], outgoing: [] });
  assert.deepEqual((await call(env, "GET", "challenges", "a")).body.outgoing[0].status, "pending");
  assert.equal((await call(env, "POST", "challenge/accept", "a", { room: ch.room })).status, 404, "the challenger cannot accept");
  assert.equal((await call(env, "POST", "challenge/accept", "c", { room: ch.room })).status, 404, "a stranger cannot accept");
  assert.deepEqual((await call(env, "POST", "challenge/accept", "b", { room: ch.room })).body, { room: ch.room, exam: "usmle" });
  assert.deepEqual((await call(env, "GET", "challenges", "b")).body.incoming, []);
  assert.equal((await call(env, "GET", "challenges", "a")).body.outgoing[0].status, "accepted");
  // decline (by the receiver) deletes; expired ones are gone from lists and cannot be accepted
  const c2 = (await call(env, "POST", "challenge", "b", { smdId: SMD.a })).body;
  assert.equal(c2.exam, "neet-pg");
  assert.deepEqual((await call(env, "POST", "challenge/decline", "a", { room: c2.room })).body, { ok: true });
  const c3 = (await call(env, "POST", "challenge", "b", { smdId: SMD.a })).body;
  assert.deepEqual((await call(env, "GET", "challenges", "a", null, T0 + 600e3)).body.incoming, []);
  assert.equal((await call(env, "POST", "challenge/accept", "a", { room: c3.room }, T0 + 600e3)).status, 404);
  for (let i = 0; i < 5; i++) await call(env, "POST", "challenge", "a", { smdId: SMD.b });
  assert.deepEqual((await call(env, "POST", "challenge", "a", { smdId: SMD.b })).body, { error: "limit" });
});

test("college: normalised keys, opt in and out, boards per college and per state", async () => {
  assert.equal(S.collegeKey("  Govt. Med. Coll.,   NAGPUR "), "government medical college nagpur");
  assert.equal(S.collegeKey("Government Medical College Nagpur"), "government medical college nagpur");
  assert.equal(S.collegeKey("St. John's Med Coll & Hosp"), "saint john s medical college and hospital");
  const env = await envWith("a", "b", "c", "d");
  assert.ok((await call(env, "GET", "college-list", "a")).body.colleges.length >= 20);
  assert.deepEqual((await call(env, "GET", "college", "a")).body, { college: null });
  assert.equal((await call(env, "POST", "college", "a", { college: "x", state: "MH" })).status, 400);
  const tag = (await call(env, "POST", "college", "a", { college: " Govt  Med Coll, Nagpur", state: "Maharashtra" })).body;
  assert.deepEqual(tag, { college: "Govt Med Coll, Nagpur", state: "Maharashtra", key: "government medical college nagpur", stateKey: "maharashtra" });
  await call(env, "POST", "college", "b", { college: "Government Medical College Nagpur", state: "maharashtra" });
  await call(env, "POST", "college", "c", { college: "Grant Medical College", state: " MAHARASHTRA " });
  await call(env, "POST", "college", "d", { college: "Madras Medical College", state: "Tamil Nadu" });
  // scores: a 36 + 10 in the window, an old 99 that does not count; b 46 with a higher rating; c nothing
  const db = env.PREP_ARENA_DB.db, ins = db.prepare("INSERT INTO arena_entries (event_id, uidh, started_at, submitted_at, score) VALUES (?, ?, 0, ?, ?)");
  ins.run("e1", uh("a"), T0 - 86400e3, 36); ins.run("e2", uh("a"), T0 - 2 * 86400e3, 10); ins.run("e0", uh("a"), T0 - 40 * 86400e3, 99);
  ins.run("e1", uh("b"), T0 - 86400e3, 46); ins.run("e1", uh("d"), T0 - 86400e3, 80);
  db.prepare("UPDATE arena_players SET rating = 1300 WHERE uidh = ?").run(uh("b"));
  const col = (await call(env, "GET", "board?scope=college&key=" + encodeURIComponent("Govt. Medical College, Nagpur"), "a")).body;
  assert.deepEqual(col.rows, [{ rank: 1, name: "Bilal K", score: 46, rating: 1300 }, { rank: 2, name: "Asha Rao", score: 46, rating: 1200, me: true }]);
  assert.deepEqual(col.me, { rank: 2, score: 46 });
  const st = (await call(env, "GET", "board?scope=state&key=maharashtra", "c")).body;
  assert.deepEqual(st.rows.map((r) => [r.rank, r.name, r.score]), [[1, "Bilal K", 46], [2, "Asha Rao", 46], [3, "Chitra M", 0]]);
  assert.deepEqual(st.me, { rank: 3, score: 0 });
  assert.equal((await call(env, "GET", "board?scope=state&key=maharashtra", "d")).body.me, null);
  assert.equal((await call(env, "GET", "board?scope=city&key=x", "a")).status, 400);
  assert.ok(!JSON.stringify(st).includes(uh("a")), "no uid hashes on boards");
  assert.deepEqual((await call(env, "DELETE", "college", "a")).body, { ok: true });
  assert.equal((await call(env, "GET", "board?scope=state&key=maharashtra", "a")).body.rows.length, 2, "opted out: off the board");
});

test("groups: create, join, full at 30, leave passes ownership, members today, weekly sprint board", async () => {
  const env = await envWith("a", "b", "c");
  assert.equal((await call(env, "POST", "groups/create", "a", { name: "x", dailyTarget: 50 })).status, 400);
  assert.equal((await call(env, "POST", "groups/create", "a", { name: "Night owls", dailyTarget: 0 })).status, 400);
  const { code } = (await call(env, "POST", "groups/create", "a", { name: "  Night   owls ", dailyTarget: 50 })).body;
  assert.match(code, S.GROUP_RE);
  assert.deepEqual((await call(env, "POST", "groups/join", "a", { code })).body, { error: "already" });
  assert.equal((await call(env, "POST", "groups/join", "b", { code: "ZZZZZZ" })).status, 404);
  assert.deepEqual((await call(env, "POST", "groups/join", "b", { code: code.toLowerCase() }, T0 + 1)).body, { ok: true });
  // progress: Monday counts for the week, last Sunday does not; today feeds todayDone (MAX keeps the higher report)
  const db = env.PREP_ARENA_DB.db;
  db.prepare("INSERT INTO social_progress (uidh, day, done) VALUES (?, '2026-10-05', 30), (?, '2026-10-04', 500)").run(uh("b"), uh("b"));
  assert.deepEqual((await call(env, "POST", "progress", "a", { done: 40 })).body, { ok: true });
  await call(env, "POST", "progress", "a", { done: 20 });
  await call(env, "POST", "progress", "b", { done: 25 });
  assert.equal((await call(env, "POST", "progress", "a", { done: -1 })).status, 400);
  const g = (await call(env, "GET", "groups", "b")).body.groups;
  assert.deepEqual(g, [{ code, name: "Night owls", dailyTarget: 50, owner: "Asha Rao", mine: false, members: [{ name: "Asha Rao", todayDone: 40 }, { name: "Bilal K", todayDone: 25 }] }]);
  const bd = (await call(env, "GET", "groups/board?code=" + code, "a")).body;
  assert.deepEqual(bd, { week: "2026-10-05", rows: [{ name: "Bilal K", score: 55 }, { name: "Asha Rao", score: 40 }] });
  assert.equal((await call(env, "GET", "groups/board?code=" + code, "c")).status, 404, "members only");
  // fill to 30 with fake players, then c is refused
  for (let i = 0; i < 28; i++) db.prepare("INSERT INTO social_group_members (code, uidh, joined_at) VALUES (?, ?, ?)").run(code, "fake" + i, T0 + 10 + i);
  assert.deepEqual((await call(env, "POST", "groups/join", "c", { code })), { status: 409, body: { error: "full" } });
  // owner leaves: b (longest-standing) owns it; last member leaving deletes the group
  assert.deepEqual((await call(env, "POST", "groups/leave", "a", { code })).body, { ok: true });
  assert.equal(db.prepare("SELECT owner FROM social_groups WHERE code = ?").get(code).owner, uh("b"));
  assert.equal((await call(env, "POST", "groups/leave", "a", { code })).status, 404);
  db.prepare("DELETE FROM social_group_members WHERE uidh LIKE 'fake%'").run();
  await call(env, "POST", "groups/leave", "b", { code });
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM social_groups").get().c, 0);
});

test("Leave Arena deletes every social row of the leaver and keeps others' groups", async () => {
  const env = await envWith("a", "b", "c");
  await friends(env, "a", "b");
  await call(env, "POST", "friends/add", "c", { smdId: SMD.a });
  await call(env, "POST", "challenge", "a", { smdId: SMD.b });
  await call(env, "POST", "college", "a", { college: "Grant Medical College", state: "Maharashtra" });
  await call(env, "POST", "progress", "a", { done: 10 });
  const { code } = (await call(env, "POST", "groups/create", "a", { name: "Ward 5", dailyTarget: 30 })).body;
  await call(env, "POST", "groups/join", "b", { code }, T0 + 1);
  const solo = (await call(env, "POST", "groups/create", "a", { name: "Just me", dailyTarget: 30 })).body.code;
  assert.deepEqual((await call(env, "DELETE", "consent", "a", null, T0, "arena")).body, { left: true });
  const db = env.PREP_ARENA_DB.db, me = uh("a");
  for (const [t, cols] of [["social_ids", ["uidh"]], ["social_friends", ["a", "b", "requester"]], ["social_challenges", ["from_uidh", "to_uidh"]], ["social_college", ["uidh"]], ["social_progress", ["uidh"]], ["social_group_members", ["uidh"]], ["social_groups", ["owner"]]]) {
    const n = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE ${cols.map((c) => c + " = ?").join(" OR ")}`).get(...cols.map(() => me)).c;
    assert.equal(n, 0, t);
  }
  assert.deepEqual(db.prepare("SELECT code FROM social_groups").all().map((r) => r.code), [code], "b's group lives on, the solo group is gone");
  assert.notEqual(solo, code);
  assert.deepEqual((await call(env, "GET", "friends", "b")).body, { friends: [], incoming: [], outgoing: [] });
});
