/* PrepNucleus nudges (prep-nudges.js, functions/_prep-nudge-push.js). What must hold: at most 2 a day, 4 h apart,
 * never in quiet hours; 3 ignored in a row -> 1 a day; while the app stays closed only days 4, 6, 9, 12, 15, 18, 21;
 * variants rotate without repeats; truthfulness (a streak nudge only with a real streak of 3+, the day-1 streak only
 * when today is studied, readiness numbers only on the day they were computed, the due nudge only with 20+ due, no
 * social claim from the phone); no em-dash or shame copy anywhere; the server push respects the same caps.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-nudges.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(import.meta.url);
const N = require("../prep-nudges.js");

const H = 3600e3, DAY = 864e5;
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();   // October 2026, local time
function base(over) {
  return Object.assign({ now: at(7, 8), quiet: "22:30-07:30", anchor: 19 * 60, name: "Asha", exam: "NEET-PG", examDays: 45,
    plan: { items: [{ k: "rev", done: false, x: 0, of: 12, min: 6 }, { k: "new", done: false, x: 0, of: 20, min: 20 }] },
    due: Array(22).fill(5), streak: 0, studiedToday: false, weak: null, wins: [], recap: null, arena: null, hist: [] }, over || {});
}
const dayOf = (t) => Math.round((N.dayStart(t, 0) - N.dayStart(at(7, 8), 0)) / DAY);
const kinds = (list) => list.map((n) => n.k);

test("caps: at most 2 a local day, 4 h apart, never in quiet hours, across many inputs", () => {
  const q = N.parseQuiet("22:30-07:30");
  for (let h = 0; h < 24; h++) for (const anchor of [6 * 60, 7 * 60 + 45, 13 * 60, 19 * 60, 21 * 60 + 15, 23 * 60]) for (const extra of [0, 1]) {
    const o = base({ now: at(7, h, 10), anchor: N.anchorFor(anchor, null, q), streak: 9, studiedToday: !!extra, weak: { id: "pharm", name: "Pharmacology", score: 41 }, due: Array(22).fill(40), examDays: 31,
      wins: [{ key: "q1000", k: "win_q", vars: { q: "1,000" } }], recap: { k: 0, q: 120, acc: 64, from: 40, to: 44 }, arena: "neet-pg" });
    const list = N.build(o), by = {};
    list.forEach((n) => { (by[N.dayStart(n.at, 0)] = by[N.dayStart(n.at, 0)] || []).push(n.at); });
    for (const d of Object.keys(by)) {
      const ts = by[d].sort((a, b) => a - b);
      assert.ok(ts.length <= 2, "cap " + h + " " + anchor);
      for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 4 * H, "4 h apart");
    }
    list.forEach((n) => { const d = new Date(n.at); assert.ok(!N.inQuiet(d.getHours() * 60 + d.getMinutes(), q), "quiet " + d); assert.ok(n.at > o.now); });
    const ids = list.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
    ids.forEach((id) => assert.ok(id >= N.ID0 && id < N.ID0 + N.ID_N && id < 2147483100 && id > 2147483000));
  }
});

test("quiet hours: custom window respected; an anchor inside it moves to 30 min before it starts", () => {
  const q = N.parseQuiet("21:00-09:00");
  assert.equal(N.anchorFor(22 * 60, null, q), 20 * 60 + 30);
  assert.equal(N.anchorFor(null, "08:00", q), 20 * 60 + 30);
  assert.equal(N.anchorFor(null, null, N.parseQuiet("garbage")), 19 * 60, "default 7 pm, default quiet");
  const list = N.build(base({ quiet: "21:00-09:00", anchor: N.anchorFor(null, "08:00", q), streak: 5, arena: "neet-pg" }));
  list.forEach((n) => { const d = new Date(n.at), m = d.getHours() * 60 + d.getMinutes(); assert.ok(m >= 9 * 60 && m < 21 * 60, "inside 09:00-21:00: " + d); });
  assert.ok(!list.some((n) => n.k === "sprint"), "the 19:45 IST sprint (if local) cannot sit 4 h from a 20:30 anchor");
});

test("back-off: 3 ignored in a row -> 1 a day; tail days 4, 6, 9 ... 21 only; nothing on day 3 or after 21", () => {
  const busy = base({ streak: 9, wins: [{ key: "q100", k: "win_q", vars: { q: "100" } }], due: Array(22).fill(30), weak: { id: "a", name: "Anatomy", score: 30 } });
  const counts = (l) => { const c = {}; l.forEach((n) => { const d = dayOf(n.at); c[d] = (c[d] || 0) + 1; }); return c; };
  const c0 = counts(N.build(busy));
  assert.equal(c0[0], 2, "normal: 2 today");
  assert.deepEqual(Object.keys(c0).map(Number).filter((d) => d > 2), N.TAIL, "tail days");
  assert.ok(!c0[3] && Object.keys(c0).every((d) => +d <= 21));
  N.TAIL.forEach((d) => assert.equal(c0[d], 1));
  const ign = [1, 2, 3].map((i) => ({ k: "plan_ready", v: 0, at: at(5, 19) + i, acted: false }));
  const c1 = counts(N.build(Object.assign({}, busy, { hist: ign })));
  [0, 1, 2].forEach((d) => assert.equal(c1[d], 1, "halved on day " + d));
  assert.equal(N.ignoredRun(ign.concat([{ k: "x", at: 1, acted: true }])), 0);
  assert.equal(N.ignoredRun([{ acted: true }].concat(ign)), 3);
  // settle: a nudge followed by app use within 3 h counts as acted
  const h = N.settle([{ id: 1, k: "due", v: 1, at: at(7, 19) }, { id: 2, k: "streak", v: 0, at: at(7, 23) }, { id: 3, k: "x", v: 0, at: at(9, 19) }], [], at(7, 23, 30));
  assert.deepEqual(h.map((x) => [x.k, x.acted]), [["due", false], ["streak", true]]);
  // what already fired today counts against today's cap
  const today = N.build(base({ now: at(7, 12), hist: [{ k: "plan_ready", v: 0, at: at(7, 9), acted: true }, { k: "due", v: 0, at: at(7, 11), acted: true }] }));
  assert.ok(!today.some((n) => dayOf(n.at) === 0), "cap reached by delivered ones");
});

test("rotation: no variant repeats back to back within a kind, and never the last delivered one", () => {
  const list = N.build(base({ examDays: null, due: Array(22).fill(0) }));
  const cb = list.filter((n) => n.k === "comeback").map((n) => n.v);
  assert.ok(cb.length >= 5);
  for (let i = 1; i < cb.length; i++) assert.notEqual(cb[i], cb[i - 1]);
  for (let d = 0; d < 30; d++) {
    const v = N.pick("comeback", d, 1, { name: "A", exam: "NEET-PG", due: "4", min: 2, days: 9 });
    assert.notEqual(v, 1);
  }
  assert.equal(N.pick("streak", 3, 2, { streak: 4, next: 5 }) !== 2, true, "{name} variant skipped without a name");
  assert.equal(N.pick("recap", 3, null, { q: "10", acc: 50 }), 1, "the readiness variant needs from and to");
});

test("truth: streak only at 3+, day-1 streak only when studied today", () => {
  assert.ok(!kinds(N.build(base({ streak: 2 }))).includes("streak"));
  const s0 = N.build(base({ streak: 3, studiedToday: false }));
  const st = s0.filter((n) => n.k === "streak");
  assert.equal(st.length, 1); assert.equal(dayOf(st[0].at), 0);
  assert.match(st[0].title + st[0].body, /3/);
  const s1 = N.build(base({ streak: 4, studiedToday: true, plan: { items: [{ k: "rev", done: true, x: 4, of: 4, min: 2 }] } }));
  const st1 = s1.filter((n) => n.k === "streak");
  assert.equal(st1.length, 1); assert.equal(dayOf(st1[0].at), 1, "studied today: tomorrow's streak is real");
  assert.ok(!s1.some((n) => dayOf(n.at) === 0 && /plan/.test(n.k)), "plan done: no plan nudge today");
});

test("truth: plan counts, due threshold, weak score and readiness only on their own day", () => {
  const half = N.build(base({ plan: { items: [{ k: "rev", done: true, x: 12, of: 12, min: 6 }, { k: "new", done: false, x: 8, of: 20, min: 20 }, { k: "lsn", done: false, x: 0, of: 1, min: 5 }] } }));
  const h0 = half.find((n) => n.k === "plan_half");
  assert.ok(h0 && dayOf(h0.at) === 0);
  assert.match(h0.title + " " + h0.body, /1 of 3|12 questions|about 17 min/);
  const noDue = N.build(base({ due: Array(22).fill(19) }));
  assert.ok(!kinds(noDue).includes("due"));
  const due = N.build(base({ due: Array(22).fill(26) }));
  const d1 = due.find((n) => n.k === "due");
  assert.ok(d1 && /26/.test(d1.title + d1.body) && /13 min/.test(d1.body));
  assert.deepEqual(d1.extra.prep, { mode: "plan" });
  const wk = N.build(base({ weak: { id: "pharmacology", name: "Pharmacology", score: 41 } })).filter((n) => n.k === "weak");
  wk.forEach((n) => { assert.ok(!/41/.test(n.body), "no readiness number on a later day"); assert.deepEqual(n.extra.prep, { subject: "pharmacology" }); });
  const rc = N.build(base({ now: at(11, 8), recap: { k: 0, q: 140, acc: 61, from: 40, to: 46 } })).find((n) => n.k === "recap");
  assert.ok(rc && /140/.test(rc.body) && /61%/.test(rc.body));
  const rc2 = N.build(base({ now: at(9, 8), recap: { k: 2, q: 140, acc: 61, from: 40, to: 46 } })).find((n) => n.k === "recap");
  assert.ok(rc2 && N.dayStart(rc2.at, 0) === N.dayStart(at(11, 8), 0) && !/→/.test(rc2.body), "readiness delta only when computed the same day");
  const cb = N.build(base({ due: Array(22).fill(0), name: null })).filter((n) => n.k === "comeback");
  cb.forEach((n) => assert.ok(!/reviews are waiting|undefined|null|\{/.test(n.title + n.body)));
});

test("truth: the phone never claims anything about other people; countdown only on milestone days", () => {
  N.all().forEach((s) => assert.ok(!/friend|others are|everyone is studying|parents/i.test(s), s));
  const cd = N.build(base({ examDays: 31 })).filter((n) => n.k === "countdown");
  assert.equal(cd.length, 1); assert.equal(dayOf(cd[0].at), 1); assert.match(cd[0].title, /30 days/);
  assert.ok(!kinds(N.build(base({ examDays: 45 }))).includes("countdown"));
});

test("copy: no em-dash, en-dash, emoji or shame words in any template, client or server", async () => {
  const S = await import("../functions/_prep-nudge-push.js");
  const all = N.all().concat(...Object.values(S.TEMPLATES).map((l) => l.flat()));
  assert.ok(all.length > 40);
  all.forEach((s) => {
    assert.ok(!/[—–]/.test(s), "dash: " + s);
    assert.ok(!/ - /.test(s), "spaced hyphen: " + s);
    assert.ok(!/\p{Extended_Pictographic}/u.test(s), "emoji (owner 2026-09-24, emoji-icons.js strips them from notifications): " + s);
    assert.ok(!/parent|shame|lazy|disappoint|last chance|hurry|before it's too late|falling behind|fail/i.test(s), "tone: " + s);
  });
});

test("Arena: sprint 15 min before 20:00 IST, grand test 30 min before Sunday 11:00 IST, only for players", () => {
  const t = N.arenaTimes("neet-pg", Date.UTC(2026, 9, 9, 0, 0), Date.UTC(2026, 9, 12, 0, 0));
  const sp = t.filter((x) => x.k === "sprint").map((x) => new Date(x.at).toISOString());
  assert.deepEqual(sp, ["2026-10-09T14:15:00.000Z", "2026-10-10T14:15:00.000Z", "2026-10-11T14:15:00.000Z"]);
  const gr = t.filter((x) => x.k === "grand");
  assert.equal(gr.length, 1); assert.equal(new Date(gr[0].at).toISOString(), "2026-10-11T05:00:00.000Z"); assert.equal(gr[0].vars.n, 100);
  assert.equal(N.arenaTimes("neet-ss", Date.UTC(2026, 9, 11), Date.UTC(2026, 9, 12)).find((x) => x.k === "grand").vars.min, 60);
  assert.ok(!kinds(N.build(base({ arena: null, anchor: 8 * 60 }))).some((k) => k === "sprint" || k === "grand"));
  assert.ok(kinds(N.build(base({ arena: "neet-pg", anchor: 8 * 60 }))).includes("sprint"), "joined: the sprint shows when it fits");
  assert.ok(!kinds(N.build(base({ arena: "fmge", anchor: 8 * 60 }))).includes("sprint"), "no Arena for FMGE");
});

test("learning the study time, wins, snapshots, recap and accuracy wins", () => {
  const now = at(20, 12);
  assert.equal(N.bestTime([at(19, 21, 5), at(18, 21, 40), at(17, 7)], now), null, "fewer than 5 sessions");
  assert.equal(N.bestTime([at(19, 21, 5), at(18, 21, 40), at(17, 7), at(16, 21), at(15, 7, 30), new Date(2026, 8, 1, 7).getTime()], now), 21 * 60 + 15, "older than 30 days ignored");
  assert.equal(N.bestTime([at(19, 21), at(18, 21), at(17, 7), at(16, 7), at(15, 9)], now), 7 * 60 + 15, "a tie goes to the earlier hour");
  assert.deepEqual(N.wins({ total: 2600, streak: 2, studiedToday: true, today: 1 }).map((w) => w.key), ["q2500"]);
  assert.deepEqual(N.wins({ total: 50, streak: 7, studiedToday: true, today: 9 }).map((w) => w.key), ["s7:9"]);
  assert.deepEqual(N.wins({ total: 50, streak: 8, studiedToday: true, today: 9 }), [], "the streak win is for the day it is reached");
  const won = N.build(base({ wins: [{ key: "q100", k: "win_q", vars: { q: "100" } }], hist: [{ k: "win_q", v: 0, at: at(1, 19), key: "q100", acted: true }] }));
  assert.ok(!kinds(won).includes("win_q"), "a delivered win is not repeated");
  // due per day
  const cards = { "p:m:1": [0, 1, 0, 100], "p:m:2": [0, 1, 0, 102], "p:m:c:9": [0, 1, 0, 100], "x:1": [0, 1, 0, 90] };
  const isQ = (k) => k.indexOf("p:") === 0 && !(k.split(":").length === 4 && k.split(":")[2] === "c");
  assert.deepEqual(N.dueByDay(cards, 100, isQ).slice(0, 4), [1, 1, 2, 2]);
  // snapshots: today = 200 (a Sunday), Monday = 194
  let sn = {}; sn = N.snap(sn, 186, [100, 60, 30, "neet-pg", { a: [50, 25] }]); sn = N.snap(sn, 193, [200, 120, 40, "neet-pg", { a: [100, 50] }]);
  const cur = [300, 190, 46, "neet-pg", { a: [160, 110] }];
  assert.deepEqual(N.recap(sn, 200, 0, cur), { k: 0, q: 100, acc: 70, from: 40, to: 46 });
  assert.deepEqual(N.recap(sn, 198, 5, cur), { k: 2, q: 100, acc: 70, from: 40, to: 46 });
  assert.equal(N.recap(sn, 197, 4, cur), null, "Sunday more than 2 days away");
  assert.equal(N.recap({ 195: sn[193] }, 200, 0, cur), null, "no snapshot before Monday: no recap");
  assert.equal(N.recap(sn, 200, 0, [200, 120, 40, "neet-pg"]), null, "no answers this week");
  assert.deepEqual(Object.keys(N.recap(sn, 200, 0, [300, 190, 46, "usmle"])).sort(), ["acc", "k", "q"], "another exam: no readiness delta");
  // accuracy win: this week (Mon 194) 60 answers 60/60 -> 100%, last week 50 answers 25/50 -> 50%
  const w = N.accWin(sn, 200, 0, cur, { a: "Anatomy" });
  assert.deepEqual(w, { subject: "a", name: "Anatomy", acc: 100, prev: 50, key: "a:a:194" });
  assert.equal(N.accWin(sn, 200, 0, [300, 190, 46, "neet-pg", { a: [110, 55] }], { a: "Anatomy" }), null, "under 20 answers this week");
  assert.ok(Object.keys(N.snap(sn, 230, cur)).every((d) => +d > 195));
  assert.equal(N.firstName("Dr. Asha Rao"), "Asha"); assert.equal(N.firstName("asha@x.in"), null); assert.equal(N.firstName(""), null);
  assert.equal(N.clock(new Date(2026, 0, 1, 20, 0).getTime()), "8 pm"); assert.equal(N.clock(new Date(2026, 0, 1, 10, 30).getTime()), "10:30 am");
});

/* ---------- server ---------- */
const CLAIMS = { "tok-a": { sub: "u-a", name: "Asha Rao" }, "tok-b": { sub: "u-b", name: "Bilal K" }, "tok-c": { sub: "u-c", name: "Chitra M" } };
const SMD = { a: "SMD-AAAAAA", b: "SMD-BBBBBB", c: "SMD-CCCCCC" };
const FS = new Map();
for (const k of Object.keys(SMD)) { FS.set("doctorDirectory/" + SMD[k], { uid: "u-" + k }); FS.set("users/u-" + k + "/profile/self", { smdId: SMD[k] }); }
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null } });
const realFs = await import("../functions/_fbfirestore.js");
mock.module("../functions/_fbfirestore.js", { namedExports: { ...realFs, fsGet: async (env, p) => { const f = FS.get(p); return f ? { fields: f } : null; } } });
const SENT = [];
const realNp = await import("../functions/_nativepush.js");
mock.module("../functions/_nativepush.js", { namedExports: { ...realNp, sendNativeToTokens: async (env, toks, msg) => { SENT.push({ toks: toks.map((t) => t.uid), msg }); return { sent: toks.length, total: toks.length }; } } });
const social = await import("../functions/api/prep/social/[[path]].js");
const arena = await import("../functions/api/prep/arena/[[path]].js");
const P = await import("../functions/_prep-nudge-push.js");
const A = await import("../functions/_prep-arena.js");
const SCHEMA = fs.readFileSync(new URL("../prep-arena-worker/schema.sql", import.meta.url), "utf8");
const MIG = fs.readFileSync(new URL("../prep-arena-worker/migrations/0003_nudges.sql", import.meta.url), "utf8");
function d1() {
  const db = new DatabaseSync(":memory:"); db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }), _exec: () => db.prepare(sql).run(...args) });
  return { db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } };
}
function kv() { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [...m.keys()].map((name) => ({ name })), list_complete: true }) }; }
const T0 = Date.parse("2026-10-07T06:30:00Z");   // Wednesday 12:00 IST
function call(env, method, path, who, body, now = T0, base = "social", headers = {}) {
  const req = new Request(`https://stewardmd.in/api/prep/${base}/` + path, { method, headers: { "Content-Type": "application/json", ...headers, ...(who ? { Authorization: "Bearer tok-" + who } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return (base === "social" ? social : arena).handle(req, env, path.split("?")[0], now).then(async (r) => ({ status: r.status, body: await r.json() }));
}
async function world() {
  const env = { PREP_ARENA_DB: d1(), PUSH_KV: kv(), APNS_KEY_P8: "x", APNS_KEY_ID: "x", APNS_TEAM_ID: "x", PREP_CRON_TOKEN: "cron-secret-0123456789" };
  for (const w of ["a", "b", "c"]) {
    await call(env, "POST", "consent", w, null, T0, "arena");
    await env.PUSH_KV.put("push:native:" + (await realNp.tokenId("apns-token-" + w)), JSON.stringify({ token: "apns-token-" + w, platform: "ios", uid: "u-" + w }));
  }
  for (const [x, y] of [["a", "b"], ["a", "c"]]) { await call(env, "POST", "friends/add", x, { smdId: SMD[y] }); await call(env, "POST", "friends/accept", y, { smdId: SMD[x] }); }
  return env;
}

test("server: schema carries the migration; registering needs this account's own push token", async () => {
  assert.ok(SCHEMA.includes(MIG));
  const env = await world();
  assert.deepEqual((await call(env, "POST", "nudges", "a", { on: true, token: "apns-token-b" })).body, { error: "push-not-enabled" }, "another account's token");
  assert.equal((await call(env, "POST", "nudges", "a", { on: true })).status, 400);
  assert.deepEqual((await call(env, "POST", "nudges", "a", { on: true, token: "apns-token-a", quiet: "23:00-07:00", tz: -330 })).body, { ok: true });
  const row = await env.PREP_ARENA_DB.prepare("SELECT * FROM social_push WHERE uidh = ?").bind(A.uidHash("u-a")).first();
  assert.equal(row.quiet, "23:00-07:00"); assert.ok(!JSON.stringify(row).includes("u-a"), "no uid stored");
  assert.deepEqual((await call(env, "POST", "nudges", "a", { on: false })).body, { ok: true });
  assert.equal(await env.PREP_ARENA_DB.prepare("SELECT * FROM social_push").first(), null);
});

test("server: a challenge pushes to the friend, inside their cap and quiet hours", async () => {
  const env = await world(); SENT.length = 0;
  await call(env, "POST", "challenge", "a", { smdId: SMD.b });
  assert.equal(SENT.length, 0, "b never registered: nothing sent");
  await call(env, "POST", "nudges", "b", { on: true, token: "apns-token-b", tz: -330 });
  await call(env, "POST", "challenge", "a", { smdId: SMD.b }, T0 + 1000);
  assert.equal(SENT.length, 1);
  assert.deepEqual(SENT[0].toks, ["u-b"]);
  assert.equal(SENT[0].msg.title, "Asha challenged you");
  assert.deepEqual(JSON.parse(SENT[0].msg.data.prep), { social: "friends" });
  await call(env, "POST", "challenge", "a", { smdId: SMD.b }, T0 + 2000);
  assert.equal(SENT.length, 2, "challenges skip the 4 h gap");
  await call(env, "POST", "challenge", "a", { smdId: SMD.b }, T0 + 3000);
  assert.equal(SENT.length, 2, "but not the cap of 2 a day");
  const night = Date.parse("2026-10-08T18:00:00Z");   // 23:30 IST, next day
  await call(env, "POST", "challenge", "a", { smdId: SMD.b }, night);
  assert.equal(SENT.length, 2, "quiet hours");
  const morning = Date.parse("2026-10-08T03:00:00Z");   // 08:30 IST
  await call(env, "POST", "challenge", "a", { smdId: SMD.b }, morning);
  assert.equal(SENT.length, 3, "a new day");
});

test("server: passed on the college board only when a friend's score was really overtaken", async () => {
  const env = await world(); SENT.length = 0;
  for (const w of ["a", "b", "c"]) { await call(env, "POST", "college", w, { college: "Govt. Med. Coll., Nagpur", state: "Maharashtra" }); await call(env, "POST", "nudges", w, { on: true, token: "apns-token-" + w }); }
  const db = env.PREP_ARENA_DB;
  const put = (w, id, score, t) => db.prepare("INSERT INTO arena_entries (event_id, uidh, started_at, submitted_at, score) VALUES (?, ?, ?, ?, ?)").bind(id, A.uidHash("u-" + w), t, t, score).run();
  await put("b", "daily-neet-pg-20261005", 30, T0 - 2 * DAY);
  await put("c", "daily-neet-pg-20261004", 80, T0 - 3 * DAY);
  await put("a", "daily-neet-pg-20261006", 20, T0);   // a: 0 -> 20, passes nobody
  assert.equal(await P.passed(env, db, A.uidHash("u-a"), 20, T0), 0);
  await put("a", "daily-neet-pg-20261007", 40, T0);   // a: 20 -> 60, passes b (30), not c (80)
  assert.equal(await P.passed(env, db, A.uidHash("u-a"), 40, T0), 1);
  assert.deepEqual(SENT.map((s) => s.toks[0]), ["u-b"]);
  assert.match(SENT[0].msg.title, /^Asha passed you on your college board/);
  assert.match(SENT[0].msg.body, /8 pm/);
  assert.equal(await P.passed(env, db, A.uidHash("u-a"), -4, T0), 0, "a negative score passes no one");
});

test("server: the evening digest names only friends who really studied today; the cron needs its secret", async () => {
  const env = await world(); SENT.length = 0;
  await call(env, "POST", "nudges", "a", { on: true, token: "apns-token-a" });
  await call(env, "POST", "nudges", "c", { on: true, token: "apns-token-c" });
  assert.equal((await call(env, "POST", "digest", null, null, T0, "social", { "X-Prep-Cron": "wrong-secret-0123456" })).status, 404);
  assert.deepEqual((await call(env, "POST", "digest", null, null, T0, "social", { "X-Prep-Cron": env.PREP_CRON_TOKEN })).body, { players: 2, sent: 0 }, "no one studied: nothing");
  await call(env, "POST", "progress", "b", { done: 12 });
  await call(env, "POST", "progress", "c", { done: 0 });
  const r = await call(env, "POST", "digest", null, null, T0 + 4 * H, "social", { "X-Prep-Cron": env.PREP_CRON_TOKEN });
  assert.deepEqual(r.body, { players: 2, sent: 1 });
  assert.deepEqual(SENT.map((s) => [s.toks[0], s.msg.title]), [["u-a", "Bilal studied today"]], "c's only friend (a) did nothing; a sees b, not c (0 done)");
  assert.equal(P.names(["Dr. Bilal K", "Chitra", "Dev", "Esha"]), "Bilal, Chitra and 2 more");
  assert.ok(!P.cronOk({ PREP_CRON_TOKEN: "" }, ""), "unset secret never matches");
  // Leave Arena drops the nudge row too
  await call(env, "DELETE", "consent", "a", null, T0, "arena");
  assert.equal(await env.PREP_ARENA_DB.prepare("SELECT * FROM social_push WHERE uidh = ?").bind(A.uidHash("u-a")).first(), null);
});
