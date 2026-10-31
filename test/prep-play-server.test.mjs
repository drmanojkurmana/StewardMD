/* PrepNucleus play route (functions/api/prep/play) and squads (functions/api/prep/social squads), on node:sqlite with the
 * real schema, like prep-social-server.test.mjs. What must hold: squads keep a streak only when every member hits the
 * target; the focus room counts only fresh heartbeats; the spot board ranks right answers by time once a day; mnemonics
 * reject links and phone numbers, count one vote each and hide at 3 reports; seasons score battles and entries inside
 * the 8-week window; Leave Arena deletes every play row.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-play-server.test.mjs
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
const play = await import("../functions/api/prep/play/[[path]].js");
const PL = await import("../functions/_prep-play.js");
const arena = await import("../functions/api/prep/arena/[[path]].js");
const S = await import("../functions/_prep-social.js");
const A = await import("../functions/_prep-arena.js");

const SCHEMA = fs.readFileSync(new URL("../prep-arena-worker/schema.sql", import.meta.url), "utf8");
const MIGRATION = fs.readFileSync(new URL("../prep-arena-worker/migrations/0007_prep_play.sql", import.meta.url), "utf8");
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
  return (base === "social" ? route : base === "play" ? play : arena).handle(req, env, path.split("?")[0], now).then(async (r) => ({ status: r.status, body: await r.json() }));
}
async function envWith(...who) {
  const env = { PREP_ARENA_DB: d1() };
  for (const w of who) await call(env, "POST", "consent", w, null, T0, "arena");
  return env;
}
const uh = (k) => A.uidHash("u-" + k);

const P = (env, method, path, who, body, now = T0) => call(env, method, path, who, body, now, "play");

test("schema.sql carries the play migration verbatim (minus its header)", () => {
  const tables = MIGRATION.split("\n").filter((l) => !l.startsWith("--")).join("\n").trim();
  assert.ok(SCHEMA.includes(tables));
});

test("squads: a group of 3 to 6 keeps a streak of days on which every member hit the target", async () => {
  const env = await envWith("a", "b", "c");
  const { code } = (await call(env, "POST", "groups/create", "a", { name: "Ward 5", dailyTarget: 20 })).body;
  await call(env, "POST", "groups/join", "b", { code });
  await call(env, "POST", "groups/join", "c", { code });
  const DAY = 864e5, db = env.PREP_ARENA_DB.db;
  // Two full days before today (everyone >= 20), then today only a and b.
  for (const [w, n] of [["a", 25], ["b", 20], ["c", 30]]) for (const k of [1, 2]) db.prepare("INSERT INTO social_progress (uidh, day, done) VALUES (?, ?, ?)").run(uh(w), S.istDay(T0 - k * DAY), n);
  db.prepare("INSERT INTO social_progress (uidh, day, done) VALUES (?, ?, ?)").run(uh("c"), S.istDay(T0 - 3 * DAY), 5);
  for (const w of ["a", "b"]) db.prepare("INSERT INTO social_progress (uidh, day, done) VALUES (?, ?, ?)").run(uh(w), S.istDay(T0), 22);
  let g = (await call(env, "GET", "groups", "a")).body.groups[0];
  assert.equal(g.squad, true); assert.equal(g.streak, 2); assert.equal(g.todayAll, false);
  db.prepare("INSERT INTO social_progress (uidh, day, done) VALUES (?, ?, ?)").run(uh("c"), S.istDay(T0), 21);
  g = (await call(env, "GET", "groups", "a")).body.groups[0];
  assert.equal(g.streak, 3); assert.equal(g.todayAll, true);
  const b = (await call(env, "GET", "squads/board", "b")).body;
  assert.equal(b.rows.length, 1); assert.equal(b.rows[0].name, "Ward 5"); assert.equal(b.rows[0].size, 3); assert.equal(b.rows[0].mine, true);
  assert.equal(b.rows[0].score, 22 + 22 + 21 + 25 + 20 + 30 + 25 + 20 + 30 - (S.weekStart(T0) > S.istDay(T0 - 2 * 864e5) ? 75 : 0));
  assert.deepEqual(b.me, [{ name: "Ward 5", rank: 1, score: b.rows[0].score }]);
  assert.deepEqual(S.squadStreak([], {}, 10, T0), { streak: 0, today: false });
});

test("play: sign-in required; focus room counts heartbeats in the window and drops leavers", async () => {
  const env = await envWith("a", "b");
  assert.equal((await P(env, "GET", "focus", null)).status, 401);
  assert.deepEqual((await P(env, "POST", "focus", "a", { on: true })).body, { now: 1 });
  assert.deepEqual((await P(env, "POST", "focus", "b", { on: true }, T0 + 1000)).body, { now: 2 });
  assert.deepEqual((await P(env, "GET", "focus", "b", null, T0 + PL.FOCUS_WINDOW + 500)).body, { now: 1 }, "a's heartbeat aged out");
  assert.deepEqual((await P(env, "POST", "focus", "b", { on: false }, T0 + 2000)).body, { now: 1 });
});

test("spot: consent, once a day, right answers ranked by time, a wrong one counted but unranked", async () => {
  const env = await envWith("a", "b", "c");
  const day = PL.istDay(T0);
  assert.equal((await P(env, "POST", "spot", "a", { day: "2020-01-01", ok: true, ms: 100 })).status, 400, "another day");
  assert.equal((await P(env, "POST", "spot", "a", { day, ok: true, ms: 99999 })).status, 400, "over 10 s");
  await P(env, "POST", "spot", "a", { day, ok: true, ms: 4200 });
  await P(env, "POST", "spot", "b", { day, ok: true, ms: 2100 });
  const c = (await P(env, "POST", "spot", "c", { day, ok: false, ms: 3000 })).body;
  assert.equal((await P(env, "POST", "spot", "a", { day, ok: true, ms: 1 })).status, 409);
  assert.equal(c.n, 3);
  assert.deepEqual(c.rows.map((r) => [r.rank, r.name]), [[1, "Bilal K"], [2, "Asha Rao"]]);
  assert.deepEqual(c.me, { rank: null, ok: false, ms: 3000 });
  const env2 = { PREP_ARENA_DB: env.PREP_ARENA_DB };
  CLAIMS["tok-z"] = { sub: "u-z", name: "Zed" };
  assert.equal((await P(env2, "GET", "spot", "z")).status, 403, "no Arena consent");
});

test("mnemonic lab: rules, top 5 by votes, one vote each, own delete, hidden at 3 reports", async () => {
  const env = await envWith("a", "b", "c", "d");
  const it = "ana-brachial-plexus-q1";
  assert.deepEqual((await P(env, "POST", "mn", "a", { item: it, text: "hi" })).body, { error: "length" });
  assert.deepEqual((await P(env, "POST", "mn", "a", { item: it, text: "see www.example.com for more" })).body, { error: "no-links" });
  assert.deepEqual((await P(env, "POST", "mn", "a", { item: it, text: "call 9876543210 for notes" })).body, { error: "no-links" });
  const id = (await P(env, "POST", "mn", "a", { item: it, text: "Axillary: C5 C6, deltoid and teres minor" })).body.id;
  const id2 = (await P(env, "POST", "mn", "b", { item: it, text: "Remember ARMS: Axillary Radial Musculocutaneous" })).body.id;
  assert.equal((await P(env, "POST", "mn/vote", "a", { id, up: true })).status, 400, "no self vote");
  assert.deepEqual((await P(env, "POST", "mn/vote", "b", { id, up: true })).body, { up: 1 });
  assert.deepEqual((await P(env, "POST", "mn/vote", "b", { id, up: true })).body, { up: 1 }, "a second vote is not counted twice");
  assert.deepEqual((await P(env, "POST", "mn/vote", "c", { id, up: true })).body, { up: 2 });
  assert.deepEqual((await P(env, "POST", "mn/vote", "c", { id, up: false })).body, { up: 1 });
  let list = (await P(env, "GET", "mn?item=" + it, "b")).body.items;
  assert.deepEqual(list.map((x) => [x.id, x.up, x.mine, x.voted]), [[id, 1, false, true], [id2, 0, true, false]]);
  for (const w of ["a", "c", "c", "d"]) await P(env, "POST", "mn/report", w, { id: id2 });
  list = (await P(env, "GET", "mn?item=" + it, "a")).body.items;
  assert.deepEqual(list.map((x) => x.id), [id], "3 different reporters hide it; a repeat report does not count");
  assert.equal((await P(env, "POST", "mn/delete", "b", { id })).status, 404, "not yours");
  assert.deepEqual((await P(env, "POST", "mn/delete", "a", { id })).body, { ok: true });
  for (let i = 0; i < PL.MN_PER_DAY; i++) await P(env, "POST", "mn", "d", { item: it, text: "aid number " + i + " here" });
  assert.equal((await P(env, "POST", "mn", "d", { item: it, text: "one too many today" })).status, 429);
});

test("seasons: points from battles and event entries inside the season, tiers, last season", async () => {
  const env = await envWith("a", "b");
  const db = env.PREP_ARENA_DB.db, s = PL.seasonOf(T0), prev = PL.seasonOf(s.start - 1);
  const battle = (id, w, at) => db.prepare("INSERT INTO arena_battles (id, exam, a, b, a_score, b_score, winner, ended_at) VALUES (?, 'neet-pg', ?, ?, 1, 0, ?, ?)").run(id, uh("a"), uh("b"), w, at);
  for (let i = 0; i < 6; i++) battle("x" + i, uh("a"), s.start + 1000 + i);   // a: 6 wins = 18
  battle("d1", null, s.start + 2000);                                         // draw: +1 each
  battle("old", uh("b"), prev.start + 5);                                      // last season
  const j = (await P(env, "GET", "season?exam=neet-pg", "a")).body;
  assert.equal(j.season.n, s.n);
  assert.deepEqual([j.me.points, j.me.rank, j.me.tier], [19, 1, "Silver"]);
  assert.deepEqual(j.rows.map((r) => [r.name, r.points, r.tier]), [["Asha Rao", 19, "Silver"], ["Bilal K", 1, "Bronze"]]);
  assert.deepEqual((await P(env, "GET", "season?exam=neet-pg", "b")).body.last, { n: prev.n, points: 3, tier: "Bronze" });
  assert.deepEqual(PL.tierOf(140), { tier: "Diamond", at: 140, next: null });
  assert.equal(PL.seasonOf(PL.SEASON_ZERO).n, 1);
  assert.equal(PL.seasonOf(PL.SEASON_ZERO + 56 * 864e5).n, 2);
});

test("Leave Arena deletes every play row of the leaver", async () => {
  const env = await envWith("a", "b");
  const it = "ana-brachial-plexus-q1", day = PL.istDay(T0);
  await P(env, "POST", "focus", "a", { on: true });
  await P(env, "POST", "spot", "a", { day, ok: true, ms: 1000 });
  const id = (await P(env, "POST", "mn", "a", { item: it, text: "a memory aid by a" })).body.id;
  const idb = (await P(env, "POST", "mn", "b", { item: it, text: "a memory aid by b" })).body.id;
  await P(env, "POST", "mn/vote", "b", { id, up: true });
  await P(env, "POST", "mn/vote", "a", { id: idb, up: true });
  await P(env, "POST", "mn/report", "a", { id: idb });
  assert.deepEqual((await call(env, "DELETE", "consent", "a", null, T0, "arena")).body, { left: true });
  const db = env.PREP_ARENA_DB.db, me = uh("a");
  for (const t of ["play_focus", "play_spot", "play_mn", "play_mn_vote", "play_mn_report"]) assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE uidh = ?`).get(me).c, 0, t);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM play_mn_vote WHERE mn = ?").get(id).c, 0, "votes on a's aid go with it");
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM play_mn WHERE id = ?").get(idb).c, 1, "b's aid stays");
});
