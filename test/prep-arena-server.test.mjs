/* PrepNucleus Arena server: pure helpers (functions/_prep-arena.js) and the Pages route (functions/api/prep/arena).
 * D1 is node:sqlite behind a D1-shaped shim with the real schema (prep-arena-worker/schema.sql); R2 is in memory;
 * Firebase claims are mocked. What must hold: marking matches prep.js MOCKS exactly; events are deterministic from the
 * IST schedule and draw the same screened items for everyone; keys never leave the server before a submit; one entry
 * per event; early and late submits are refused; leaving deletes the player's data; names never come from the email.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-arena-server.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const P = require("../prep.js");
const A = await import("../functions/_prep-arena.js");

const CLAIMS = {
  "tok-a": { sub: "u-a", name: "Asha Rao", email: "asha@example.com" },
  "tok-b": { sub: "u-b", name: "Bilal K", email: "b@example.com" },
  "tok-c": { sub: "u-c", name: "c@example.com", email: "c@example.com" },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null } });
const route = await import("../functions/api/prep/arena/[[path]].js");

const SCHEMA = fs.readFileSync(new URL("../prep-arena-worker/schema.sql", import.meta.url), "utf8");
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
// A small screened bank: anatomy (2 modules, one flagged item), physiology (1 module), pathology (1 module, USMLE vignettes).
function item(id, a, extra) { return { id, q: "Q " + id, o: ["A", "B", "C", "D"], a, exp: "why " + id, t: "m", d: 1, ...extra }; }
function bankR2() {
  const files = {
    "anatomy/index.json": { id: "anatomy", topics: [{ id: "ana-1", count: 12, usmle: 0, file: "mcq/ana-1.json" }, { id: "ana-2", count: 12, usmle: 0, file: "mcq/ana-2.json" }, { id: "ana-0", count: 0, file: "mcq/ana-0.json" }] },
    "anatomy/mcq/ana-1.json": { items: Array.from({ length: 12 }, (_, i) => item("ana1-" + i, i % 4, i === 0 ? { flags: ["disputed"] } : {})) },
    "anatomy/mcq/ana-2.json": { items: Array.from({ length: 12 }, (_, i) => item("ana2-" + i, (i + 1) % 4)) },
    "physiology/index.json": { id: "physiology", topics: [{ id: "phy-1", count: 15, usmle: 0, file: "mcq/phy-1.json" }] },
    "physiology/mcq/phy-1.json": { items: Array.from({ length: 15 }, (_, i) => item("phy1-" + i, (i + 2) % 4)) },
    "pathology/index.json": { id: "pathology", topics: [{ id: "pat-1", count: 10, usmle: 6, file: "mcq/pat-1.json" }] },
    "pathology/mcq/pat-1.json": { items: Array.from({ length: 10 }, (_, i) => item("pat1-" + i, 3, i < 6 ? { ex: ["usmle"] } : {})) },
  };
  return { get: async (k) => { const f = k.startsWith("prep-bank/v1/") && files[k.slice(13)]; return f ? { text: async () => JSON.stringify(f) } : null; } };
}
const bank = () => A.bankFrom(bankR2());

/* ---------- pure helpers ---------- */

test("marking matches prep.js scoreMock for every MOCKS pattern", () => {
  const pats = [].concat(...Object.values(P.MOCKS));
  for (const pat of pats) {
    const scheme = A.SCHEMES[pat.id === "usmle-block" ? "usmle" : pat.id];
    assert.deepEqual(scheme, { plus: pat.plus, minus: pat.minus }, pat.id);
    const items = Array.from({ length: 9 }, (_, i) => ({ id: "x" + i, a: i % 4, _s: "s" }));
    const arr = [0, 1, 2, -1, 3, 1, -1, 3, 2];   // index answers for scoreMock
    const ans = {}; arr.forEach((k, i) => { if (k >= 0) ans["x" + i] = k; });
    const want = P.scoreMock(items, arr, pat), got = A.markEntry(items, ans, scheme);
    assert.deepEqual([got.right, got.wrong, got.blank, got.score], [want.right, want.wrong, want.blank, want.marks], pat.id);
  }
  // INI-CET: 2 right, 1 wrong -> 2 - 1/3 = 1.67; junk values and unknown ids are blank
  const it3 = [{ id: "a", a: 0 }, { id: "b", a: 1 }, { id: "c", a: 2 }, { id: "d", a: 3 }];
  assert.deepEqual(A.markEntry(it3, { a: 0, b: 1, c: 0, d: "3", zz: 1 }, A.SCHEMES["ini-cet"]), { right: 2, wrong: 1, blank: 1, score: 1.67 });
  assert.equal(A.markEntry(it3, { a: 0, b: 0, c: 0, d: 0 }, A.SCHEMES["neet-pg"]).score, 1);
  assert.equal(A.markEntry(it3, { a: 7, b: -1, c: 1.5 }, A.SCHEMES["neet-ss"]).blank, 4);
});

test("Elo K=24: even match moves 12, a draw between equals moves nothing, an upset moves more", () => {
  assert.deepEqual(A.elo(1200, 1200, 1), [1212, 1188]);
  assert.deepEqual(A.elo(1200, 1200, 0.5), [1200, 1200]);
  assert.deepEqual(A.elo(1200, 1200, 0), [1188, 1212]);
  const [up] = A.elo(1000, 1400, 1), [fav] = A.elo(1400, 1000, 1);
  assert.equal(up - 1000, 22); assert.equal(fav - 1400, 2);
  const [x, y] = A.elo(1337, 1111, 0); assert.equal(x + y, 1337 + 1111, "zero-sum");
});

test("identity: uid hash is sha256 prefix 24; name from the token, never an email", () => {
  assert.equal(A.uidHash("u-a"), createHash("sha256").update("u-a").digest("hex").slice(0, 24));
  assert.equal(A.displayName({ name: "  Dr <b>Asha</b>\u0007 Rao  " }, "abc"), "Dr bAsha/b Rao");
  assert.equal(A.displayName({ name: "x".repeat(60) }, "abc").length, 40);
  assert.equal(A.displayName({ name: "c@example.com", email: "c@example.com" }, "0123456789abcdef"), "Doctor cdef");
  assert.equal(A.displayName({}, "0123456789abcdef"), "Doctor cdef");
});

test("schedule: daily 20:00-20:20 IST, weekly Sunday 11:00-14:00 IST, NEET-SS weekly 50 Q / 60 min", () => {
  const d = A.eventFromId("daily-neet-pg-20261006");
  assert.equal(new Date(d.starts_at).toISOString(), "2026-10-06T14:30:00.000Z");
  assert.equal(d.ends_at - d.starts_at, 20 * 60e3);
  assert.deepEqual([d.n, d.secs, d.seed], [20, 1200, "v1:daily-neet-pg-20261006"]);
  const w = A.eventFromId("weekly-neet-pg-20261011");   // a Sunday
  assert.equal(new Date(w.starts_at).toISOString(), "2026-10-11T05:30:00.000Z");
  assert.deepEqual([w.n, w.secs, w.ends_at - w.starts_at], [100, 7200, 3 * 3600e3]);
  const ss = A.eventFromId("weekly-neet-ss-20261011");
  assert.deepEqual([ss.n, ss.secs], [50, 3600]);
  for (const bad of ["weekly-neet-pg-20261012", "daily-neet-pg-20261332", "daily-ini-cet-20261006", "daily-neet-pg-2026106", "x"]) assert.equal(A.eventFromId(bad), null, bad);
  assert.deepEqual(A.eventFromId("daily-usmle-20261006"), A.eventFromId("daily-usmle-20261006"), "deterministic");

  const before = Date.parse("2026-10-06T14:00:00Z");   // 19:30 IST Tuesday
  const s1 = A.scheduleFor("neet-pg", before).map((e) => e.role + ":" + e.id);
  assert.deepEqual(s1, ["current:daily-neet-pg-20261005", "next:daily-neet-pg-20261006", "current:weekly-neet-pg-20261004", "next:weekly-neet-pg-20261011"]);
  const during = Date.parse("2026-10-06T14:35:00Z");
  assert.equal(A.scheduleFor("neet-pg", during)[0].id, "daily-neet-pg-20261006");
  const sunMorning = Date.parse("2026-10-11T05:00:00Z");   // 10:30 IST Sunday, before the weekly
  assert.equal(A.scheduleFor("neet-pg", sunMorning)[2].id, "weekly-neet-pg-20261004");
  assert.equal(A.scheduleFor("neet-pg", sunMorning + 3600e3)[2].id, "weekly-neet-pg-20261011");
});

test("draw: deterministic per seed, screened (no flagged items), spread across subjects, no duplicates", async () => {
  const a = await A.drawItems(bank(), "neet-pg", 20, "v1:daily-neet-pg-20261006");
  const b = await A.drawItems(bank(), "neet-pg", 20, "v1:daily-neet-pg-20261006");
  const c = await A.drawItems(bank(), "neet-pg", 20, "v1:daily-neet-pg-20261007");
  assert.equal(a.length, 20);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  assert.notDeepEqual(a.map((x) => x.id), c.map((x) => x.id));
  assert.equal(new Set(a.map((x) => x.id)).size, 20);
  assert.ok(!a.some((x) => x.id === "ana1-0"), "flagged item drawn");
  assert.deepEqual([...new Set(a.map((x) => x.s))].sort(), ["anatomy", "pathology", "physiology"]);
  // short draws still reach every subject over a few seeds
  const seen = new Set();
  for (let i = 0; i < 6; i++) (await A.drawItems(bank(), "neet-pg", 1, "s" + i)).forEach((x) => seen.add(x.s));
  assert.ok(seen.size >= 2);
  // USMLE: only the USMLE subjects, vignettes when a module has 5+
  const u = await A.drawItems(bank(), "usmle", 30, "u");
  assert.ok(u.filter((x) => x.s === "pathology").every((x) => +x.id.split("-")[1] < 6));
  // NEET-SS: no bank yet -> empty, not a crash
  assert.deepEqual(await A.drawItems(bank(), "neet-ss", 20, "x"), []);
});

/* ---------- the route ---------- */

const T0 = Date.parse("2026-10-06T14:30:00Z");   // daily-neet-pg-20261006 opens
const EV = "daily-neet-pg-20261006";
function call(env, method, path, tok, body, now = T0) {
  const req = new Request("https://stewardmd.in/api/prep/arena/" + path, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return route.handle(req, env, path.split("?")[0], now).then(async (r) => ({ status: r.status, body: await r.json() }));
}
const envOf = () => ({ PREP_ARENA_DB: d1(), PREP_BANK_R2: bankR2() });

test("route: no token is 401 everywhere; no DB is 503", async () => {
  const env = envOf();
  for (const [m, p] of [["GET", "consent"], ["POST", "consent"], ["GET", "events?exam=neet-pg"], ["POST", `events/${EV}/start`], ["GET", "board?exam=neet-pg"], ["GET", "me/stats"]]) {
    assert.equal((await call(env, m, p, null)).status, 401, m + " " + p);
    assert.equal((await call(env, m, p, "tok-bogus")).status, 401);
  }
  assert.equal((await call({}, "GET", "consent", "tok-a")).status, 503);
});

test("consent: join stores a hash and the token name; email never stored; leave deletes everything", async () => {
  const env = envOf();
  assert.deepEqual((await call(env, "GET", "consent", "tok-a")).body, { joined: false, name: "Asha Rao" });
  assert.equal((await call(env, "POST", `events/${EV}/start`, "tok-a")).status, 403, "start needs consent");
  assert.deepEqual((await call(env, "POST", "consent", "tok-a")).body, { joined: true, name: "Asha Rao" });
  assert.deepEqual((await call(env, "POST", "consent", "tok-c")).body.name.startsWith("Doctor "), true, "an email-shaped name is not shown");
  const rows = env.PREP_ARENA_DB.db.prepare("SELECT * FROM arena_players").all();
  assert.deepEqual(rows.map((r) => r.uidh).sort(), [A.uidHash("u-a"), A.uidHash("u-c")].sort());
  assert.ok(!JSON.stringify(rows).includes("example.com"));
  assert.ok(!JSON.stringify(rows).includes("u-a"), "raw uid not stored");

  await call(env, "POST", `events/${EV}/start`, "tok-a");
  await call(env, "POST", `events/${EV}/submit`, "tok-a", { ans: {} }, T0 + 1000);
  env.PREP_ARENA_DB.db.prepare("INSERT INTO arena_battles (id, exam, a, b, a_score, b_score, winner, ended_at) VALUES ('m1','neet-pg',?,?,50,20,?,1)").run(A.uidHash("u-a"), A.uidHash("u-c"), A.uidHash("u-a"));
  assert.deepEqual((await call(env, "DELETE", "consent", "tok-a")).body, { left: true });
  const db = env.PREP_ARENA_DB.db;
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM arena_players WHERE uidh = ?").get(A.uidHash("u-a")).c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM arena_entries").get().c, 0);
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM arena_battles").all()).includes(A.uidHash("u-a")), "battles keep no trace of the leaver");
  assert.equal((await call(env, "GET", "me/stats", "tok-c")).body.battles[0].result, "loss", "the other side keeps their record");
  assert.deepEqual((await call(env, "GET", "consent", "tok-a")).body.joined, false);
});

test("events: current + next for both kinds, created lazily and only once", async () => {
  const env = envOf();
  await call(env, "POST", "consent", "tok-a");
  const r = await call(env, "GET", "events?exam=neet-pg", "tok-a", null, T0 + 60e3);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.events.map((e) => [e.role, e.kind, e.status]), [["current", "daily", "open"], ["next", "daily", "upcoming"], ["current", "weekly", "closed"], ["next", "weekly", "upcoming"]]);
  await call(env, "GET", "events?exam=neet-pg", "tok-a", null, T0 + 60e3);
  assert.equal(env.PREP_ARENA_DB.db.prepare("SELECT COUNT(*) AS c FROM arena_events").get().c, 4);
  assert.equal((await call(env, "GET", "events?exam=foo", "tok-a")).status, 400);
  assert.equal((await call(env, "POST", "events/daily-neet-pg-20300101/start", "tok-a")).status, 404, "far future ids are not created");
});

test("start sends items without keys or explanations; submit marks on the server, once", async () => {
  const env = envOf();
  await call(env, "POST", "consent", "tok-a"); await call(env, "POST", "consent", "tok-b");
  assert.equal((await call(env, "POST", `events/${EV}/start`, "tok-a", null, T0 - 1000)).status, 425, "before the window");
  assert.equal((await call(env, "POST", `events/${EV}/submit`, "tok-a", { ans: {} }, T0 + 5000)).status, 409, "submit before start");
  const s = await call(env, "POST", `events/${EV}/start`, "tok-a", null, T0 + 2000);
  assert.equal(s.status, 200);
  assert.equal(s.body.items.length, 20);
  assert.deepEqual(Object.keys(s.body.items[0]).sort(), ["id", "o", "q"]);
  assert.ok(!/"a":|"exp":|why /.test(JSON.stringify(s.body)), "no key or explanation in start");
  assert.equal(s.body.endsAt, T0 + 1200e3);
  const again = await call(env, "POST", `events/${EV}/start`, "tok-a", null, T0 + 9000);
  assert.deepEqual(again.body.items, s.body.items, "a restart resumes the same paper");
  assert.equal(again.body.startedAt, T0 + 2000, "and keeps the first start time");

  const drawn = await A.drawItems(bank(), "neet-pg", 20, "v1:" + EV);
  const ans = {}; drawn.forEach((it, i) => { if (i < 10) ans[it.id] = it.a; else if (i < 14) ans[it.id] = (it.a + 1) % 4; });
  const sub = await call(env, "POST", `events/${EV}/submit`, "tok-a", { ans, ms: 1 }, T0 + 302000);
  assert.equal(sub.status, 200);
  assert.deepEqual([sub.body.right, sub.body.wrong, sub.body.blank, sub.body.score], [10, 4, 6, 36]);
  assert.equal(sub.body.ms, 300000, "server time, not the client's ms");
  assert.deepEqual([sub.body.rank, sub.body.of], [1, 1]);
  assert.equal(Object.keys(sub.body.key).length, 20);
  drawn.forEach((it) => assert.equal(sub.body.key[it.id], it.a));
  assert.equal((await call(env, "POST", `events/${EV}/submit`, "tok-a", { ans }, T0 + 303000)).status, 409, "second submit");
  assert.equal((await call(env, "POST", `events/${EV}/start`, "tok-a", null, T0 + 304000)).status, 409, "no restart after submit");

  // b: faster with the same score ranks above a
  await call(env, "POST", `events/${EV}/start`, "tok-b", null, T0 + 3000);
  const sb = await call(env, "POST", `events/${EV}/submit`, "tok-b", { ans }, T0 + 103000);
  assert.deepEqual([sb.body.score, sb.body.rank, sb.body.of], [36, 1, 2]);
  const board = await call(env, "GET", `events/${EV}/board?around=me`, "tok-a", null, T0 + 400000);
  assert.deepEqual(board.body.rows.map((r) => [r.rank, r.name, r.score]), [[1, "Bilal K", 36], [2, "Asha Rao", 36]]);
  assert.deepEqual(board.body.me, { rank: 2, name: "Asha Rao", score: 36, ms: 300000 });
  assert.ok(!JSON.stringify(board.body).includes(A.uidHash("u-a")), "no uid hashes on the board");

  const st = await call(env, "GET", "me/stats", "tok-a");
  assert.deepEqual(st.body.events.map((e) => [e.id, e.score, e.right]), [[EV, 36, 10]]);
});

test("timing: late submits are refused after the entry's time + 60 s grace; junk bodies are 400", async () => {
  const env = envOf();
  await call(env, "POST", "consent", "tok-a"); await call(env, "POST", "consent", "tok-b");
  await call(env, "POST", `events/${EV}/start`, "tok-a", null, T0);
  assert.equal((await call(env, "POST", `events/${EV}/submit`, "tok-a", { ans: [1, 2] }, T0 + 1000)).status, 400);
  assert.equal((await call(env, "POST", `events/${EV}/submit`, "tok-a", { nope: 1 }, T0 + 1000)).status, 400);
  assert.equal((await call(env, "POST", `events/${EV}/submit`, "tok-a", { ans: {} }, T0 + 1200e3 + 60001)).status, 410);
  // b starts 10 minutes in: the window end (not start + 20 min) caps the entry
  await call(env, "POST", `events/${EV}/start`, "tok-b", null, T0 + 600e3);
  const ok = await call(env, "POST", `events/${EV}/submit`, "tok-b", { ans: {} }, T0 + 1200e3 + 59000);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ms, 600e3, "ms stops at the window end; the grace minute does not count");
  assert.equal((await call(env, "POST", `events/${EV}/start`, "tok-c", null, T0 + 1200e3)).status, 403, "no consent");
  await call(env, "POST", "consent", "tok-c");
  assert.equal((await call(env, "POST", `events/${EV}/start`, "tok-c", null, T0 + 1200e3)).status, 410, "window over: no new start");
});

test("rating board and stats read the battles the Worker writes", async () => {
  const env = envOf(), db = env.PREP_ARENA_DB.db;
  for (const t of ["tok-a", "tok-b", "tok-c"]) await call(env, "POST", "consent", t);
  const [a, b, c] = ["u-a", "u-b", "u-c"].map(A.uidHash);
  db.prepare("UPDATE arena_players SET rating = 1212, battles = 1, wins = 1 WHERE uidh = ?").run(a);
  db.prepare("UPDATE arena_players SET rating = 1188, battles = 2, wins = 1 WHERE uidh = ?").run(b);
  db.prepare("UPDATE arena_players SET rating = 1200, battles = 1, wins = 0 WHERE uidh = ?").run(c);
  const ins = db.prepare("INSERT INTO arena_battles (id, exam, a, b, a_score, b_score, winner, ended_at, a_after, b_after) VALUES (?,?,?,?,?,?,?,?,?,?)");
  ins.run("m1", "neet-pg", a, b, 80, 40, a, T0 - 3 * 86400e3, 1212, 1188);
  ins.run("m2", "neet-pg", b, c, 50, 30, b, T0 - 10 * 86400e3, 1200, 1188);
  ins.run("m3", "usmle", c, b, 10, 10, null, T0 - 86400e3, 1200, 1188);
  const all = await call(env, "GET", "board?exam=neet-pg&period=all", "tok-b", null, T0);
  assert.deepEqual(all.body.rows.map((r) => [r.rank, r.name, r.rating, r.battles, r.wins]), [[1, "Asha Rao", 1212, 1, 1], [2, "Doctor " + c.slice(-4), 1200, 1, 0], [3, "Bilal K", 1188, 2, 1]]);
  assert.deepEqual(all.body.me.rank, 3);
  const wk = await call(env, "GET", "board?exam=neet-pg&period=week", "tok-c", null, T0);
  assert.deepEqual(wk.body.rows.map((r) => r.name), ["Asha Rao", "Bilal K"]);
  assert.equal(wk.body.me, null);
  assert.equal((await call(env, "GET", "board?exam=neet-pg&period=year", "tok-a")).status, 400);
  const st = await call(env, "GET", "me/stats", "tok-b", null, T0);
  assert.deepEqual(st.body.battles.map((x) => [x.id, x.opp, x.result, x.score.join(":"), x.rating]), [["m3", "Doctor " + c.slice(-4), "draw", "10:10", 1188], ["m1", "Asha Rao", "loss", "40:80", 1188], ["m2", "Doctor " + c.slice(-4), "win", "50:30", 1200]]);
  assert.deepEqual(st.body.trend.map((x) => x.rating), [1200, 1188, 1188]);
  assert.deepEqual(st.body.player, { name: "Bilal K", rating: 1188, battles: 2, wins: 1, since: T0 });
});
