/* /api/prep/sync route: node:sqlite behind a D1-shaped shim with the real migration, Firebase claims mocked.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-sync-route.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const CLAIMS = { "tok-a": { sub: "uid-alpha-123" }, "tok-b": { sub: "uid-beta-456" } };
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null } });
const { handle } = await import("../functions/api/prep/sync/[[path]].js");

const SQL = fs.readFileSync(new URL("../prep-arena-worker/migrations/0001_prep_sync.sql", import.meta.url), "utf8");
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SQL);
  const conv = (a) => a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x));   // D1 binds an ArrayBuffer as a BLOB
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, conv(a)),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { db, prepare: (sql) => stmt(sql) };
}
const URL_ = "https://x/api/prep/sync";
function call(env, method, tok, { body, headers = {}, path = "" } = {}) {
  const h = { ...headers }; if (tok) h.Authorization = "Bearer " + tok;
  return handle(new Request(URL_, { method, headers: h, body }), env, path);
}
const blobOf = (n) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => i & 255)).toString("base64");

test("auth, binding, path", async () => {
  const env = { PREP_ARENA_DB: d1() };
  assert.equal((await call(env, "GET", null)).status, 401);
  assert.equal((await call(env, "GET", "tok-zzz")).status, 401);
  assert.equal((await call({}, "GET", "tok-a")).status, 503);
  assert.equal((await call(env, "GET", "tok-a", { path: "x" })).status, 404);
  assert.equal((await call(env, "POST", "tok-a")).status, 405);
});

test("GET creates a salt and ETag 0; PUT needs If-Match, is compare-and-set, capped; DELETE wipes", async () => {
  const env = { PREP_ARENA_DB: d1() };
  const g = await call(env, "GET", "tok-a");
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("ETag"), '"0"');
  assert.equal(g.headers.get("Cache-Control"), "no-store");
  assert.equal(await g.text(), "");
  const salt = g.headers.get("X-Sync-Salt");
  assert.equal(Buffer.from(salt, "base64").length, 32);
  assert.equal((await call(env, "GET", "tok-a")).headers.get("X-Sync-Salt"), salt, "salt is stable");

  const put = (ver, body, s = salt) => call(env, "PUT", "tok-a", { body, headers: { ...(ver == null ? {} : { "If-Match": '"' + ver + '"' }), "X-Sync-Salt": s } });
  assert.equal((await put(null, blobOf(100))).status, 428);
  const ok = await put(0, blobOf(100));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ver: 1 });
  assert.equal(ok.headers.get("ETag"), '"1"');
  const stale = await put(0, blobOf(100));
  assert.equal(stale.status, 412);
  assert.equal(stale.headers.get("ETag"), '"1"');
  const g2 = await call(env, "GET", "tok-a");
  assert.equal(g2.headers.get("ETag"), '"1"');
  assert.equal(await g2.text(), blobOf(100), "blob round trip");

  assert.equal((await put(1, blobOf(262145))).status, 413);
  assert.equal((await put(1, blobOf(262144))).status, 200, "exactly at the cap is fine");
  assert.equal((await put(2, "not base64!!")).status, 400);
  assert.equal((await put(2, blobOf(10))).status, 400, "shorter than a header + tag");
  assert.equal((await put(2, blobOf(100), Buffer.alloc(32, 7).toString("base64"))).status, 412, "another row's salt");

  const del = await call(env, "DELETE", "tok-a");
  assert.equal(del.status, 200);
  assert.equal(env.PREP_ARENA_DB.db.prepare("SELECT COUNT(*) AS n FROM prep_sync").get().n, 0);
  const g3 = await call(env, "GET", "tok-a");
  assert.equal(g3.headers.get("ETag"), '"0"');
  assert.notEqual(g3.headers.get("X-Sync-Salt"), salt, "fresh salt after a wipe");
  assert.equal((await put(0, blobOf(100))).status, 412, "the old salt cannot write into the new row");
});

test("users are isolated; the uid is stored nowhere", async () => {
  const env = { PREP_ARENA_DB: d1() };
  const ga = await call(env, "GET", "tok-a"), gb = await call(env, "GET", "tok-b");
  assert.notEqual(ga.headers.get("X-Sync-Salt"), gb.headers.get("X-Sync-Salt"));
  const r = await call(env, "PUT", "tok-a", { body: blobOf(64), headers: { "If-Match": '"0"', "X-Sync-Salt": ga.headers.get("X-Sync-Salt") } });
  assert.equal(r.status, 200);
  assert.equal(await (await call(env, "GET", "tok-b")).text(), "");
  assert.equal((await call(env, "GET", "tok-b")).headers.get("ETag"), '"0"');
  await call(env, "DELETE", "tok-b");
  assert.equal(await (await call(env, "GET", "tok-a")).text(), blobOf(64), "B's wipe leaves A alone");
  const rows = env.PREP_ARENA_DB.db.prepare("SELECT * FROM prep_sync").all();
  const dump = JSON.stringify(rows, (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : v));
  for (const uid of ["uid-alpha-123", "uid-beta-456"]) assert.ok(!dump.includes(uid), uid);
  rows.forEach((x) => assert.match(x.uh, /^[0-9a-f]{64}$/));
});

/* End to end: the browser client (window.PREP_SYNC in a vm window) against this route, two devices, real crypto. */
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SRC = fs.readFileSync(new URL("../prep-sync.js", import.meta.url), "utf8");
const CORE = require("../specialty-core.js");
function win(env, tok, uid) {
  const ls = new Map();
  const w = {
    document: { addEventListener() {} }, SPECIALTY_CORE: CORE,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    SMD_AUTH: { currentUser: { uid, getIdToken: async () => tok } },
    fetch: async (u, o) => handle(new Request(new URL(u, "https://stewardmd.in"), { method: o.method, headers: o.headers, body: o.body }), env, ""),
    crypto, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response, Blob, atob, btoa, Promise, JSON, Uint8Array, Date, Math,
  };
  w.window = w;
  vm.runInNewContext(SRC, w);
  return w;
}
const store = (w) => JSON.parse(w.localStorage.getItem("smd_prep_v1") || "null");

test("client end to end: enable, review, sync both ways, 412 retry, disable with wipe", async () => {
  const env = { PREP_ARENA_DB: d1() };
  const A = win(env, "tok-a", "uid-alpha-123"), B = win(env, "tok-a", "uid-alpha-123"), X = win(env, "tok-b", "uid-beta-456");
  assert.deepEqual(JSON.parse(JSON.stringify(await A.PREP_SYNC.sync("x"))), { ok: false, changed: false, err: "off" });
  A.localStorage.setItem("smd_prep_v1", JSON.stringify({ v: 1, cards: { "p:ana:q1": [5, 3, 100, 103, 1, 0] }, conf: {}, days: { 100: 1 }, mod: { ana: { t: 1, ok: 1, last: 100 } }, exam: "usmle", bm: { q1: ["a", "ana", 1] } }));
  assert.equal((await A.PREP_SYNC.enable()).ok, true);
  assert.deepEqual(store(A).rl, [], "the log exists while sync is on");
  let changes = 0; B.PREP_SYNC.onChange(() => changes++);
  const rb = await B.PREP_SYNC.enable();
  assert.deepEqual([rb.ok, rb.changed, changes], [true, true, 1]);
  assert.equal(store(B).exam, "usmle"); assert.deepEqual(store(B).cards, store(A).cards);

  // B reviews (through the log), A edits a register; both sync
  const sb = store(B); CORE.review(sb, "p:ana", "q2", 3, 101); B.localStorage.setItem("smd_prep_v1", JSON.stringify(sb));
  const sa = store(A); delete sa.bm.q1; A.localStorage.setItem("smd_prep_v1", JSON.stringify(sa));
  assert.equal((await B.PREP_SYNC.sync("t")).ok, true);
  assert.equal((await A.PREP_SYNC.sync("t")).ok, true);
  assert.equal((await B.PREP_SYNC.sync("t")).ok, true);
  assert.deepEqual(store(A).cards, store(B).cards);
  assert.ok(store(A).cards["p:ana:q2"]); assert.equal(store(B).bm.q1, undefined);
  assert.equal(store(A).days[101], 1);

  // a concurrent writer between A's GET and PUT: A gets 412, re-reads, merges again, succeeds
  const realFetch = A.fetch; let once = true;
  A.fetch = async (u, o) => { if (o.method === "PUT" && once) { once = false; await B.PREP_SYNC.sync("race"); } return realFetch(u, o); };
  const sb2 = store(B); CORE.review(sb2, "p:ana", "q3", 1, 102); B.localStorage.setItem("smd_prep_v1", JSON.stringify(sb2));
  const r = await A.PREP_SYNC.sync("t");
  assert.equal(r.ok, true); assert.ok(store(A).cards["p:ana:q3"], "B's racing review merged in");
  const ver = JSON.parse(A.localStorage.getItem("smd_prep_sync_v1")).ver;
  assert.ok(ver >= 5, "ver " + ver);

  assert.equal((await X.PREP_SYNC.sync("t")).err, "off", "another user is untouched");
  const st = A.PREP_SYNC.status();
  assert.deepEqual([st.on, st.signedIn, st.err, st.busy], [true, true, null, false]);
  await A.PREP_SYNC.disable({ wipe: true });
  assert.equal(store(A).rl, undefined); assert.equal(A.PREP_SYNC.status().on, false);
  assert.equal(env.PREP_ARENA_DB.db.prepare("SELECT COUNT(*) AS n FROM prep_sync").get().n, 0);
  // B still on: its next sync sees no server copy, re-uploads its own state under the new salt
  assert.equal((await B.PREP_SYNC.sync("t")).ok, true);
  assert.ok(store(B).cards["p:ana:q3"]);
});
