/* PrepNucleus decks that last (owner report 2026-10-09: decks were being erased).
 * 1. /api/prep/decks route on node:sqlite behind a D1 shim with the real migration (0004), Firebase claims mocked.
 * 2. prep-decks.js storage in a vm "window" with an in-memory IndexedDB (test/fake-idb.mjs), a fake Capacitor
 *    Filesystem and fetch wired to the real route: persist() is asked for, a failed open is retried and never turns
 *    into a silent in-memory store, a dropped connection reopens, a saved deck is mirrored to files and backed up
 *    encrypted, and a new phone (empty storage) or an evicted store gets the deck back; a deleted deck stays deleted.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-decks.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fakeIndexedDB } from "./fake-idb.mjs";

const CLAIMS = { "tok-a": { sub: "uid-alpha-123" }, "tok-b": { sub: "uid-beta-456" } };
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null } });
const { handle, DECK_BLOB_MAX, DECKS_MAX } = await import("../functions/api/prep/decks/[[path]].js");
const req = createRequire(import.meta.url);
const DKP = req("../prep-decks.js");
const SRP = req("../prep-source.js");

const SQL = fs.readFileSync(new URL("../prep-arena-worker/migrations/0004_prep_decks.sql", import.meta.url), "utf8");
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SQL);
  const conv = (a) => a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, conv(a)),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { db, prepare: (sql) => stmt(sql) };
}
const call = (env, method, tok, path = "", body) => handle(new Request("https://x/api/prep/decks" + (path ? "/" + path : ""), { method, headers: tok ? { Authorization: "Bearer " + tok } : {}, body }), env, path);
const blobOf = (n) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => i & 255)).toString("base64");

/* ---------------- 1. the route ---------------- */
test("route: sign-in, binding, ids; the list creates one salt per user", async () => {
  const env = { PREP_ARENA_DB: d1() };
  assert.equal((await call(env, "GET", null)).status, 401);
  assert.equal((await call({}, "GET", "tok-a")).status, 503);
  assert.equal((await call(env, "GET", "tok-a", "../x")).status, 404);
  assert.equal((await call(env, "GET", "tok-a", "gen_ZZZ")).status, 404);
  const l = await call(env, "GET", "tok-a");
  assert.equal(l.status, 200); assert.equal(l.headers.get("Cache-Control"), "no-store");
  const j = await l.json();
  assert.equal(Buffer.from(j.salt, "base64").length, 32); assert.deepEqual(j.decks, []);
  assert.equal((await (await call(env, "GET", "tok-a")).json()).salt, j.salt, "the salt is stable");
  assert.notEqual((await (await call(env, "GET", "tok-b")).json()).salt, j.salt, "each user has their own");
  const raw = env.PREP_ARENA_DB.db.prepare("SELECT uh FROM prep_deck_keys").all().map((r) => r.uh).join(",");
  assert.ok(!/uid-alpha|uid-beta/.test(raw), "the uid is never stored");
});

test("route: PUT needs the salt first, stores per user, GET returns it, DELETE removes it; sizes and counts are capped", async () => {
  const env = { PREP_ARENA_DB: d1() }, id = "gen_" + "a".repeat(12);
  assert.equal((await call(env, "PUT", "tok-a", id, blobOf(100))).status, 409, "no salt yet: GET the list first");
  await call(env, "GET", "tok-a");
  assert.equal((await call(env, "PUT", "tok-a", id, "!!")).status, 400);
  assert.equal((await call(env, "PUT", "tok-a", id, blobOf(10))).status, 400, "shorter than an IV and a tag");
  assert.equal((await call(env, "PUT", "tok-a", id, blobOf(DECK_BLOB_MAX + 1))).status, 413);
  const p = await call(env, "PUT", "tok-a", id, blobOf(300));
  assert.equal(p.status, 200);
  assert.equal(await (await call(env, "GET", "tok-a", id)).text(), blobOf(300));
  assert.equal((await call(env, "GET", "tok-b", id)).status, 404, "another user cannot read it");
  const list = (await (await call(env, "GET", "tok-a")).json()).decks;
  assert.deepEqual(list.map((d) => [d.id, d.size]), [[id, 300]]);
  assert.equal((await call(env, "PUT", "tok-a", id, blobOf(400))).status, 200, "an update replaces the row");
  assert.equal((await (await call(env, "GET", "tok-a")).json()).decks[0].size, 400);
  assert.equal((await call(env, "DELETE", "tok-a", id)).status, 200);
  assert.equal((await call(env, "GET", "tok-a", id)).status, 404);
  for (let i = 0; i < DECKS_MAX; i++) await call(env, "PUT", "tok-a", "gen_" + String(i).padStart(12, "0"), blobOf(40));
  assert.equal((await call(env, "PUT", "tok-a", "gen_" + "f".repeat(12), blobOf(40))).status, 409, DECKS_MAX + " decks at most");
  assert.equal((await call(env, "PUT", "tok-a", "gen_" + "0".repeat(12), blobOf(41))).status, 200, "an existing deck still updates at the cap");
});

/* ---------------- 2. the pure payload ---------------- */
test("backup payload: questions, cards and unused facts with only their cited sentences; no images, no other page text, title scrubbed", () => {
  const m = DKP.newManifest({ id: "gen_" + "b".repeat(12), title: "Call 98765 43210 notes", exam: "neet-pg", profileV: 1, pv: "p1", model: "m", source: { type: "pdf", name: "x.pdf", pages: [1, 2], sha: "s" } });
  m.run = { target: 10 }; m.imgPend = ["i_1"];
  const sents = [{ n: 1, tx: "Cited one." }, { n: 2, tx: "Secret other page text." }, { n: 3, tx: "Cited three." }];
  const facts = [{ id: "f_1", deckId: m.id, ft: "F1", cq: "Q1", sn: [1], used: true }, { id: "f_3", deckId: m.id, ft: "F3", cq: "Q3", sn: [3], used: false }];
  const items = [{ id: "q_1", deckId: m.id, q: "Q?", o: ["a", "b", "c", "d"], a: 0, img: ["data:image/webp;base64,AAAA"], imgId: "i_1", _s: "deck", _m: "deck-x" }];
  const p = DKP.backupPayload(m, items, [{ id: "c_1", deckId: m.id, front: "f", back: "b" }], facts, sents, SRP.prepScrub);
  const txt = JSON.stringify(p);
  assert.equal(p.m.title, "Call [removed] notes");
  assert.equal(p.m.run, undefined); assert.equal(p.m.imgPend, undefined);
  assert.deepEqual(p.facts.map((f) => [f.id, f.quote]), [["f_3", "Cited three."]], "only the unused fact, with its own sentence");
  assert.ok(!/Secret other page|Cited one|data:image/.test(txt), "no other page text and no image data");
  assert.equal(p.items[0].imgId, "i_1"); assert.equal(p.items[0]._s, undefined);
  const back = DKP.fromPayload(JSON.parse(txt));
  assert.equal(back.m.noSrc, true); assert.equal(back.items[0]._s, "deck"); assert.equal(back.items[0]._m, "deck-" + m.id);
  assert.equal(DKP.fromPayload({ v: 1, m: { id: "../x" } }), null);
  assert.equal(DKP.fromPayload({ v: 2, m: { id: m.id } }), null);
});

/* ---------------- 3. storage in a browser-like window ---------------- */
const SRC = fs.readFileSync(new URL("../prep-decks.js", import.meta.url), "utf8");
function phone({ env, idb, files, uid = "uid-alpha-123", token = "tok-a", native = true } = {}) {
  const ls = new Map(), fileStore = files || new Map(), calls = [], persistAsked = [];
  const Filesystem = {
    writeFile: async (o) => { fileStore.set(o.path, o.data); return {}; },
    readFile: async (o) => { if (!fileStore.has(o.path)) throw new Error("no file"); return { data: fileStore.get(o.path) }; },
    readdir: async (o) => ({ files: [...fileStore.keys()].filter((k) => k.startsWith(o.path + "/")).map((k) => ({ name: k.slice(o.path.length + 1) })) }),
    deleteFile: async (o) => { fileStore.delete(o.path); },
  };
  const w = {
    document: {}, indexedDB: idb, SMD_IS_NATIVE: native, Capacitor: { Plugins: native ? { Filesystem } : {} },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    navigator: { storage: { persist: async () => { persistAsked.push(1); return true; } } },
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: (t) => clearTimeout(t),
    SMD_AUTH: { currentUser: { uid, getIdToken: async () => token } },
    PREP_SRC: { prepScrub: SRP.prepScrub },
    fetch: async (u, o) => {
      const path = String(u).replace(/^.*\/api\/prep\/decks\/?/, "");
      calls.push(o.method + " " + path);
      return handle(new Request("https://x/api/prep/decks" + (path ? "/" + path : ""), { method: o.method, headers: o.headers, body: o.body }), env, path);
    },
  };
  w.window = w;
  Object.assign(w, { crypto: globalThis.crypto, TextEncoder, TextDecoder, Response, Blob, CompressionStream, DecompressionStream, atob, btoa, Promise, JSON, Uint8Array, Math, Date, Object, Array, String, Number, Error });
  vm.createContext(w);
  vm.runInContext(SRC, w);
  return { DK: w.PREP_DECKS, w, files: fileStore, calls, persistAsked };
}
const J = (v) => JSON.parse(JSON.stringify(v));   // values from the vm realm, compared as plain data
const settle = async (ms = 60) => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, ms / 8)); };
async function makeDeck(DK, id) {
  const m = DK.newManifest({ id, title: "Anaemia", exam: "neet-pg", profileV: 1, pv: "p1", model: "m", source: { type: "paste", name: "", pages: null, sha: "s".repeat(64) } });
  m.topics = [{ id: "sec-0", title: { en: "Iron" }, count: 2, file: "idb:" + id + "/sec-0" }];
  await DK.putSrc({ deckId: id, name: "", type: "paste", sents: [{ n: 1, p: 1, h: "Iron", tx: "Ferritin below 15 confirms depletion.", s: "sec-0" }, { n: 2, p: 1, h: "Iron", tx: "Oral iron raises haemoglobin.", s: "sec-0" }, { n: 3, p: 1, h: "Iron", tx: "Parenteral iron suits intolerance.", s: "sec-0" }], sections: [{ id: "sec-0", title: "Iron" }] });
  await DK.putFacts([{ id: "f_1", deckId: id, ft: "F1", cq: "C1", sn: [1], used: true }, { id: "f_3", deckId: id, ft: "F3", cq: "C3", sn: [3], used: false }]);
  await DK.putItems([{ id: "q_1", deckId: id, q: "Which ferritin?", o: ["a", "b", "c", "d"], a: 1, t: "sec-0", _s: "deck", _m: "deck-" + id }, { id: "q_2", deckId: id, q: "Image question?", o: ["a", "b", "c", "d"], a: 0, imgId: "i_1", t: "sec-0" }]);
  await DK.putCards([{ id: "c_1", deckId: id, front: "C1", back: "F1" }]);
  await DK.putImgs([{ id: "i_1", deckId: id, p: 1, w: 300, h: 300, data: "data:image/webp;base64,AAAA" }]);
  await DK.putDeck(m);
  DK.changed(id);
  return m;
}

test("storage: persistent storage is asked for; a failed open is retried, a second failure rejects (never a silent memory store)", async () => {
  const idb = fakeIndexedDB(), env = { PREP_ARENA_DB: d1() };
  idb.failOpens = 1;
  const P = phone({ env, idb });
  assert.deepEqual(J(await P.DK.listDecks()), [], "one failed open, retried: the real (empty) store");
  assert.equal(P.persistAsked.length, 1, "navigator.storage.persist() asked once");
  assert.equal(P.DK.durable(), true);
  await makeDeck(P.DK, "gen_" + "1".repeat(12));
  idb.dropConnections();
  assert.equal((await P.DK.listDecks()).length, 1, "a dropped connection reopens and the deck is still there");
  idb.dropConnections(); idb.failOpens = 2;
  await assert.rejects(P.DK.listDecks(), /storage/, "two failed opens: an error the screen shows, not an empty list");
  assert.equal((await P.DK.listDecks()).length, 1, "and the next call reads the deck again");
});

test("a saved deck is mirrored to the app's files and backed up encrypted; a new phone gets it back after sign-in", async () => {
  const env = { PREP_ARENA_DB: d1() }, id = "gen_" + "2".repeat(12);
  const A = phone({ env, idb: fakeIndexedDB() });
  await makeDeck(A.DK, id);
  await settle(200);
  assert.ok(A.files.has("prep-decks/" + id + ".json"), "file mirror written");
  const mirrored = JSON.parse(A.files.get("prep-decks/" + id + ".json"));
  assert.equal(mirrored.items.length, 2); assert.equal(mirrored.imgs.length, 1); assert.equal(mirrored.src.sents.length, 3);
  assert.ok(A.calls.includes("PUT " + id), "backed up: " + A.calls.join(","));
  const row = env.PREP_ARENA_DB.db.prepare("SELECT blob FROM prep_decks").get();
  const plain = Buffer.from(row.blob).toString("latin1");
  assert.ok(!/Ferritin|Which ferritin|Anaemia/.test(plain), "the server copy is ciphertext");
  // A new phone: empty IndexedDB, no files, the same account.
  const B = phone({ env, idb: fakeIndexedDB(), files: new Map() });
  assert.deepEqual(J(await B.DK.listDecks()), []);
  const r = await B.DK.restore();
  assert.deepEqual(J(r), { files: 0, account: 1 });
  const list = await B.DK.listDecks();
  assert.equal(list.length, 1); assert.equal(list[0].title, "Anaemia"); assert.equal(list[0].noSrc, true);
  const items = await B.DK.items(id);
  assert.deepEqual(items.map((x) => x.id).sort(), ["q_1", "q_2"]);
  assert.ok(items.every((x) => x._s === "deck" && x._m === "deck-" + id));
  assert.equal((await B.DK.cards(id)).length, 1);
  const facts = await B.DK.facts(id);
  assert.deepEqual(facts.map((f) => [f.id, f.quote]), [["f_3", "Parenteral iron suits intolerance."]], "the unused fact comes back with its sentence, ready for 10 more");
  assert.equal(await B.DK.getSrc(id), undefined, "the source text is not restored");
  assert.deepEqual(J(await B.DK.imgs(id)), [], "images stay on the phone that cut them");
  // Another account sees nothing.
  const C = phone({ env, idb: fakeIndexedDB(), files: new Map(), uid: "uid-beta-456", token: "tok-b" });
  assert.deepEqual(J(await C.DK.restore()), { files: 0, account: 0 });
});

test("evicted storage on the same phone: the deck comes back whole from the app's files, before the account", async () => {
  const env = { PREP_ARENA_DB: d1() }, id = "gen_" + "3".repeat(12), idb = fakeIndexedDB();
  const A = phone({ env, idb });
  await makeDeck(A.DK, id);
  await settle(200);
  idb.wipe(); idb.dropConnections();
  const A2 = phone({ env, idb, files: A.files });
  assert.deepEqual(J(await A2.DK.listDecks()), []);
  assert.deepEqual(J(await A2.DK.restore()), { files: 1, account: 0 });
  assert.equal((await A2.DK.imgs(id)).length, 1, "images come back from the file copy");
  assert.equal((await A2.DK.getSrc(id)).sents.length, 3, "and the source sentences");
  assert.equal((await A2.DK.listDecks())[0].noSrc, undefined);
});

test("a deleted deck stays deleted: file and account copies go, restore never brings it back", async () => {
  const env = { PREP_ARENA_DB: d1() }, id = "gen_" + "4".repeat(12);
  const A = phone({ env, idb: fakeIndexedDB() });
  await makeDeck(A.DK, id);
  await settle(200);
  await A.DK.deleteDeck(id);
  await settle(100);
  assert.deepEqual(J(await A.DK.listDecks()), []);
  assert.equal(A.files.has("prep-decks/" + id + ".json"), false);
  assert.ok(A.calls.includes("DELETE " + id));
  assert.equal(env.PREP_ARENA_DB.db.prepare("SELECT COUNT(*) AS n FROM prep_decks").get().n, 0);
  assert.deepEqual(J(await A.DK.restore()), { files: 0, account: 0 });
});

test("a browser without IndexedDB says so (durable false) instead of pretending decks are kept", async () => {
  const P = phone({ env: { PREP_ARENA_DB: d1() }, idb: undefined, native: false });
  await P.DK.putDeck({ id: "gen_" + "5".repeat(12), created: 1, topics: [] });
  assert.equal((await P.DK.listDecks()).length, 1);
  assert.equal(P.DK.durable(), false);
});
