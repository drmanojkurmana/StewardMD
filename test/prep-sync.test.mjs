/* PrepNucleus sync merge (prep-sync.js): convergence, idempotence, first-sync adoption, registers, clock skew,
 * compaction, the specialty-core review-log hook, crypto, and blob size. The server is an in-memory { ver, doc }.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-sync.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../specialty-core.js");
const P = require("../prep.js");
const SY = require("../prep-sync.js");

let clock = 1.9e12;
Date.now = () => ++clock;   // review-log timestamps strictly increase in execution order
const T = 1.9e12, DAY = 864e5, TODAY = 20400;
const clone = (x) => JSON.parse(JSON.stringify(x));
function canon(v) { return Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => ((o[k] = canon(v[k])), o), {}) : v; }
// The synced view of a store.
function view(s) {
  const mod = {}; for (const k in s.mod) mod[k] = { t: s.mod[k].t, ok: s.mod[k].ok, last: s.mod[k].last };
  return JSON.stringify(canon({ cards: s.cards, days: s.days, mod, exam: s.exam, goal: s.goal, last: s.last, pl: s.pl, pt: s.pt, lsp: s.lsp, ra: s.ra, bm: s.bm, mt: s.mt, rep: s.rep, ls: s.ls, mh: s.mh }));
}
function device(dev, store) { const s = clone(store || P.emptyStore()); s.rl = []; return { store: s, S: { on: true, dev, seq: 0, doc: null, fresh: true } }; }
// One sync: the device state goes through JSON like localStorage; lose = the PUT landed but its response did not.
function sync(d, srv, now, today = TODAY, lose = false) {
  const r = SY.round(d.store, d.S, srv.doc && clone(srv.doc), now, today);
  d.S = clone(d.S);
  srv.doc = clone(r.up); srv.ver++;
  if (!lose) { SY.ack(d.S, clone(r.up), srv.ver, now); d.S = clone(d.S); }
  return r.changed;
}
// prep.js record(): FSRS review + module counters + day count.
function answer(d, mid, item, ok, day, log) {
  C.review(d.store, "p:" + mid, item, ok ? 3 : 1, day);
  const ms = d.store.mod[mid] || (d.store.mod[mid] = { t: 0, ok: 0 });
  ms.t++; if (ok) ms.ok++; ms.last = day;
  if (log) log.push(["p:" + mid, item, ok ? 3 : 1, day]);
}
function legacy() {
  const s = P.emptyStore();
  C.review(s, "p:ana", "q1", 3, TODAY - 5); C.review(s, "p:ana", "q2", 1, TODAY - 4); C.review(s, "p:phy", "q9", 4, TODAY - 3);
  s.mod = { ana: { t: 2, ok: 1, last: TODAY - 4 }, phy: { t: 1, ok: 1, last: TODAY - 3 } };
  s.bm = { q1: ["anatomy", "ana", 1] }; s.exam = "usmle";
  return s;
}
// Reference: one device doing every review in (day, time) order on top of the shared start.
function reference(start, log) {
  const s = { cards: clone(start.cards), days: {} };
  log.slice().sort((a, b) => a[3] - b[3]).forEach((e) => C.review(s, e[0], e[1], e[2], e[3]));
  return s.cards;
}

function scenario(order) {
  const srv = { ver: 0, doc: null }, start = legacy(), log = [];
  const A = device("devA", start), B = device("devB");
  sync(A, srv, T); sync(B, srv, T + 1000);
  assert.equal(view(A.store), view(B.store), "B adopted A");
  const shared = clone(B.store);
  // offline on both
  answer(A, "ana", "q1", true, TODAY + 1, log); answer(A, "ana", "q3", false, TODAY + 1, log);
  answer(B, "ana", "q1", false, TODAY + 2, log); answer(B, "phy", "q7", true, TODAY + 2, log); answer(A, "phy", "q7", true, TODAY + 3, log);
  A.store.bm.q5 = ["anatomy", "ana", T + 5]; A.store.mt.q3 = ["anatomy", "ana", null, T + 5, "Q3"];
  B.store.exam = "neet-ss"; B.store.rep.q9 = "wrong key"; B.store.goal = 50;
  A.store.mh.push({ ts: T + 7, label: "A mock", marks: 10, max: 20, n: 5 }); B.store.mh.push({ ts: T + 8, label: "B mock", marks: 4, max: 20, n: 5 });
  const [X, Y] = order === "AB" ? [A, B] : [B, A];
  sync(X, srv, T + 2 * DAY); sync(Y, srv, T + 2 * DAY + 10); sync(X, srv, T + 2 * DAY + 20);
  return { A, B, srv, log, shared };
}

test("two devices converge in either order, and cards equal one device doing every review in time order", () => {
  const s1 = scenario("AB"), s2 = scenario("BA");
  assert.equal(view(s1.A.store), view(s1.B.store));
  assert.equal(view(s2.A.store), view(s2.B.store));
  assert.equal(view(s1.A.store), view(s2.A.store), "order does not matter");
  assert.deepEqual(canon(s1.A.store.cards), canon(reference(s1.shared, s1.log)));
  const st = s1.A.store;
  assert.equal(st.exam, "neet-ss"); assert.equal(st.goal, 50); assert.equal(st.rep.q9, "wrong key");
  assert.ok(st.bm.q1 && st.bm.q5); assert.ok(st.mt.q3);
  assert.deepEqual(st.mh.map((h) => h.label), ["A mock", "B mock"]);
  assert.deepEqual([st.mod.ana.t, st.mod.ana.ok, st.mod.phy.t, st.mod.phy.ok], [2 + 3, 1 + 1, 1 + 2, 1 + 2]);
  assert.equal(st.mod.phy.last, TODAY + 3);
  assert.equal(st.days[TODAY + 1], 2); assert.equal(st.days[TODAY + 2], 2); assert.equal(st.days[TODAY + 3], 1);
  assert.equal(st.rl.length, 0, "the log was drained");
});

test("idempotent: syncing again changes nothing; a lost PUT response does not double count", () => {
  const { A, B, srv } = scenario("AB");
  const before = view(A.store);
  assert.equal(sync(A, srv, T + 3 * DAY), false);
  assert.equal(sync(A, srv, T + 3 * DAY + 1), false);
  assert.equal(view(A.store), before);
  answer(A, "ana", "q8", true, TODAY + 4); answer(A, "ana", "q9", true, TODAY + 4);
  sync(A, srv, T + 4 * DAY, TODAY, true);   // the server took it; the device never heard
  sync(A, srv, T + 4 * DAY + 1);
  sync(B, srv, T + 4 * DAY + 2); sync(A, srv, T + 4 * DAY + 3);
  assert.equal(A.store.days[TODAY + 4], 2); assert.equal(B.store.days[TODAY + 4], 2);
  assert.equal(A.store.mod.ana.t, 7); assert.equal(B.store.mod.ana.t, 7);
  assert.equal(view(A.store), view(B.store));
  assert.equal(A.store.cards["p:ana:q8"][4], 1, "the replayed review applied once");
});

test("first sync adopts two legacy stores card by card and adds their counters", () => {
  const a = legacy(), b = P.emptyStore();
  C.review(b, "p:ana", "q1", 3, TODAY - 9); C.review(b, "p:ana", "q1", 3, TODAY - 6); C.review(b, "p:ana", "q1", 3, TODAY - 2);   // 3 reps vs A's 1
  C.review(b, "p:ana", "q4", 3, TODAY - 2);
  b.mod = { ana: { t: 4, ok: 4, last: TODAY - 2 } }; b.bm = { q4: ["anatomy", "ana", 2] };
  const srv = { ver: 0, doc: null }, A = device("devA", a), B = device("devB", b);
  sync(A, srv, T); sync(B, srv, T + 1); sync(A, srv, T + 2);
  assert.equal(view(A.store), view(B.store));
  const s = A.store;
  assert.deepEqual(s.cards["p:ana:q1"], b.cards["p:ana:q1"], "the card further along wins");
  assert.deepEqual(s.cards["p:ana:q2"], a.cards["p:ana:q2"]);
  assert.ok(s.cards["p:ana:q4"] && s.cards["p:phy:q9"]);
  assert.equal(s.mod.ana.t, 6); assert.equal(s.mod.ana.ok, 5); assert.equal(s.mod.ana.last, TODAY - 2);
  assert.equal(s.days[TODAY - 2], 2);
  assert.equal(s.exam, "usmle", "a new device's default does not override the server's value");
  assert.deepEqual(Object.keys(s.bm).sort(), ["q1", "q4"]);
});

test("bookmark deleted on A stays deleted when B did nothing; a later re-add on B wins over the delete", () => {
  const { A, B, srv } = scenario("AB");
  delete A.store.bm.q1;
  sync(A, srv, T + 5 * DAY); sync(B, srv, T + 5 * DAY + 1); sync(A, srv, T + 5 * DAY + 2);
  assert.equal(A.store.bm.q1, undefined); assert.equal(B.store.bm.q1, undefined);
  assert.ok(srv.doc.kv["bm.q1"] && srv.doc.kv["bm.q1"][1] === null, "tombstone");
  // concurrent: A deletes q5 (synced first), B, not having seen that, changes q5 later
  delete A.store.bm.q5; B.store.bm.q5 = ["anatomy", "ana", 999];
  sync(A, srv, T + 6 * DAY); sync(B, srv, T + 6 * DAY + 50); sync(A, srv, T + 6 * DAY + 60);
  assert.deepEqual(A.store.bm.q5, ["anatomy", "ana", 999]); assert.deepEqual(B.store.bm.q5, ["anatomy", "ana", 999]);
  // tombstones older than 120 days are pruned
  sync(A, srv, T + 200 * DAY);
  assert.equal(srv.doc.kv["bm.q1"], undefined);
});

test("clock skew: B's clock a day behind still wins for an edit made after it saw A's value", () => {
  const srv = { ver: 0, doc: null }, A = device("devA", legacy()), B = device("devB");
  sync(A, srv, T); sync(B, srv, T - DAY + 10);
  A.store.exam = "neet-pg"; sync(A, srv, T + 100);
  sync(B, srv, T - DAY + 200);   // B sees neet-pg
  assert.equal(B.store.exam, "neet-pg");
  B.store.exam = "fmge"; sync(B, srv, T - DAY + 300);
  sync(A, srv, T + 400);
  assert.equal(A.store.exam, "fmge"); assert.equal(B.store.exam, "fmge");
});

test("compaction folds old events into the base without changing the cards", () => {
  const srv = { ver: 0, doc: null }, start = legacy(), A = device("devA", start), B = device("devB"), log = [];
  sync(A, srv, T); sync(B, srv, T + 1);
  const shared = clone(B.store);
  for (let d = 0; d < 60; d++) {
    const dev = d % 2 ? A : B;
    answer(dev, "ana", "q" + (d % 7), d % 3 > 0, TODAY + d, log);
    answer(dev, "phy", "z" + (d % 5), d % 4 > 0, TODAY + d, log);
    sync(dev, srv, T + (d + 1) * DAY, TODAY + d);
  }
  sync(A, srv, T + 70 * DAY, TODAY + 60); sync(B, srv, T + 70 * DAY + 1, TODAY + 60);
  assert.ok(srv.doc.ev.length < 70 && Object.keys(srv.doc.hw).length === 2, "old events were folded");
  assert.ok(srv.doc.ev.every((e) => e[2] >= TODAY + 30));
  assert.deepEqual(canon(A.store.cards), canon(reference(shared, log)));
  assert.equal(view(A.store), view(B.store));
  // direct: compact(doc) replays to the same cards
  const doc = { v: 1, b: clone(shared.cards), hw: {}, ev: log.map((e, i) => ["dev" + (i % 2) + "." + (i + 1), e[0] + ":" + e[1], e[3], e[2], i]), c: {}, ml: {}, kv: {}, mh: [] };
  const cpt = SY.compact(doc, TODAY + 60);
  assert.ok(cpt.ev.length < doc.ev.length);
  assert.deepEqual(canon(SY.replay(cpt.b, cpt.ev)), canon(SY.replay(doc.b, doc.ev)));
});

test("a card changed outside the log is kept, never dropped", () => {
  const { A, srv } = scenario("AB");
  const k = "p:ana:q1", c = A.store.cards[k].slice(); c[4] += 5;
  A.store.cards[k] = c; A.store.cards["p:ana:zz"] = [5, 3, TODAY, TODAY + 3, 1, 0];
  sync(A, srv, T + 9 * DAY);
  assert.deepEqual(A.store.cards[k], c); assert.ok(A.store.cards["p:ana:zz"]);
});

test("specialty-core review log: only stores carrying rl log; prep's emptyStore has none", () => {
  const plain = C.emptyStore();
  C.review(plain, "d", "1", 3, 10);
  assert.equal(plain.rl, undefined);
  assert.equal("rl" in P.emptyStore(), false);
  const s = C.emptyStore(); s.rl = [];
  C.review(s, "p:x", "a:b", 4, 11);
  assert.equal(s.rl.length, 1);
  assert.deepEqual(s.rl[0].slice(0, 3), ["p:x:a:b", 11, 4]);
  // a card key whose item holds ":" replays to the same key
  assert.deepEqual(Object.keys(SY.replay({}, [["d.1", "p:x:a:b", 11, 4, 1]])), ["p:x:a:b"]);
});

test("a newer doc format is refused, not overwritten", () => {
  const A = device("devA", legacy());
  assert.throws(() => SY.round(A.store, A.S, { v: 2 }, T, TODAY), /newer-format/);
});

test("crypto: round trip; a wrong uid, a flipped byte, or a flipped flag fails", async () => {
  const salt = crypto.getRandomValues(new Uint8Array(32)), doc = { v: 1, b: { "p:a:1": [1, 2, 3, 4, 5, 0] }, kv: { exam: [1, "usmle"] } };
  const k = await SY.deriveKey("uid-1", salt), blob = await SY.encrypt(k, doc);
  assert.equal(blob[0], 1, "gzip");
  assert.deepEqual(await SY.decrypt(k, SY.b64dec(SY.b64enc(blob))), doc);
  await assert.rejects(SY.decrypt(await SY.deriveKey("uid-2", salt), blob), /decrypt-failed/);
  await assert.rejects(SY.decrypt(await SY.deriveKey("uid-1", crypto.getRandomValues(new Uint8Array(32))), blob), /decrypt-failed/);
  const t = blob.slice(); t[40] ^= 1;
  await assert.rejects(SY.decrypt(k, t), /decrypt-failed/);
  const f = blob.slice(); f[0] = 2;
  await assert.rejects(SY.decrypt(k, f), /decrypt-failed/);
});

test("a large realistic store (5000 cards, 3000 recent events) encrypts under 256 KB", async () => {
  const s = P.emptyStore();
  for (let i = 0; i < 5000; i++) {
    const mid = "mod-" + (i % 250), id = "itm-" + (10000 + i);
    for (let r = 0; r < 1 + (i % 3); r++) C.review(s, "p:" + mid, id, 1 + ((i + r) % 4), TODAY - 300 + (i % 200) + r * 7);
    if (i % 10 === 0) s.bm[id] = ["anatomy", mid, T + i];
    if (i % 9 === 0) s.mt[id] = ["anatomy", mid, null, T + i, "A question stem that was answered wrongly, cut at 140 characters by prep.js ".repeat(2).slice(0, 140)];
  }
  for (let m = 0; m < 250; m++) s.mod["mod-" + m] = { t: 40, ok: 25, last: TODAY - 1 };
  const srv = { ver: 0, doc: null }, A = device("devA", s);
  sync(A, srv, T);
  for (let i = 0; i < 3000; i++) C.review(A.store, "p:mod-" + (i % 250), "itm-" + (10000 + ((i * 7) % 5000)), 1 + (i % 4), TODAY + 1 + (i % 29));
  const r = SY.round(A.store, A.S, clone(srv.doc), T + DAY, TODAY + 30);
  assert.equal(r.up.ev.length, 3000);
  const blob = await SY.encrypt(await SY.deriveKey("uid", new Uint8Array(32)), r.up);
  console.log("# blob bytes", blob.length, "base64", SY.b64enc(blob).length);
  assert.ok(blob.length < 262144, "blob " + blob.length);
});
