// PrepNucleus share IDs (prep-ids.js, tools/prep-ids.mjs): derivation, check character, typing, collisions, the index
// shards and tombstones, the bank route, the app wiring, and (when the live cache from `node tools/prep-ids.mjs fetch`
// is on this machine, or PREP_IDS_CACHE names one) every live MCQ and lesson with no collision.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assign, shards, build, collect } from "../tools/prep-ids.mjs";
import { bankPath } from "../functions/api/prep/bank/[[path]].js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = createRequire(import.meta.url)(join(ROOT, "prep-ids.js"));
const read = (f) => fs.readFileSync(join(ROOT, f), "utf8");

test("SHA-256 matches node:crypto (ASCII, UTF-8, block edges)", () => {
  for (const s of ["", "abc", "prepnucleus:q:rm-58a3df33975a", "x".repeat(55), "y".repeat(56), "z".repeat(64), "é漢😀", "pyq-neet-pg-2025-r1-39"])
    assert.equal(P.hex(P.sha256(s)), createHash("sha256").update(s, "utf8").digest("hex"));
});

test("an ID follows from the item id alone: type, 8 Crockford characters, check, grouped in threes", () => {
  assert.equal(P.idFor("Q", "rm-58a3df33975a"), "QZXVA7YAK0");                    // pinned: a change here renumbers every ID
  assert.equal(P.show("QZXVA7YAK0"), "Q-ZXV-A7Y-AK0");
  assert.equal(P.idFor("Q", "rm-58a3df33975a"), P.idFor("Q", "rm-58a3df33975a"));
  assert.notEqual(P.idFor("Q", "x"), P.idFor("L", "x").replace(/^L/, "Q"));       // namespaced by type
  const h = createHash("sha256").update("prepnucleus:q:3444c603-1d1c-4196-b420-e088704379b1").digest();
  const id = P.idFor("Q", "3444c603-1d1c-4196-b420-e088704379b1");
  assert.match(id, /^Q[0-9A-HJKMNP-TV-Z]{9}$/);
  assert.equal(P.shardOf(id), (h[0] << 2) | (h[1] >> 6));                           // the shard is the first 10 bits
  assert.match(P.idFor("L", "ctcbook-100001", true), /^L[0-9A-HJKMNP-TV-Z]{11}$/);  // long form: 10 + check
  assert.equal(P.show(P.idFor("L", "k", true)).split("-").length, 5);
  // no I, L, O, U in the body; nothing of the item id in the ID
  for (let i = 0; i < 2000; i++) { const x = P.idFor(i % 2 ? "Q" : "L", "item-" + i); assert.doesNotMatch(x.slice(1), /[ILOU]/); assert.ok(!x.toLowerCase().includes("item")); }
});

test("check character: every single wrong character and almost every swap of neighbours is caught", () => {
  let sub = 0, subMiss = 0, sw = 0, swMiss = 0;
  for (let k = 0; k < 600; k++) {
    const id = P.idFor(k % 2 ? "Q" : "L", "k" + k);
    for (let i = 1; i < id.length; i++) for (const c of P.ALPHA) { if (c === id[i]) continue; sub++; if (P.norm(id.slice(0, i) + c + id.slice(i + 1)).ok) subMiss++; }
    for (let i = 1; i < id.length - 1; i++) { if (id[i] === id[i + 1]) continue; sw++; if (P.norm(id.slice(0, i) + id[i + 1] + id[i] + id.slice(i + 2)).ok) swMiss++; }
    assert.equal(P.norm((id[0] === "Q" ? "L" : "Q") + id.slice(1)).ok, false, "type letter swapped");
  }
  assert.equal(subMiss, 0);
  assert.ok(swMiss / sw < 0.005, `swaps missed ${swMiss} of ${sw}`);
});

test("typing is forgiving: case, spaces, hyphens, O for 0, I or L for 1; errors are named", () => {
  const id = P.idFor("Q", "bp-7"), shown = P.show(id);
  assert.deepEqual(P.norm(shown.toLowerCase()), { ok: true, id });
  assert.deepEqual(P.norm(" " + shown.replace(/-/g, " ") + " "), { ok: true, id });
  assert.deepEqual(P.norm(id.toLowerCase()), { ok: true, id });
  const z = P.idFor("Q", "zero-test-" + [...Array(80).keys()].find((i) => /0/.test(P.idFor("Q", "zero-test-" + i).slice(1))));
  assert.deepEqual(P.norm(z.slice(0, 1) + z.slice(1).replace(/0/g, "O")), { ok: true, id: z });
  const one = P.idFor("Q", "one-test-" + [...Array(80).keys()].find((i) => /1/.test(P.idFor("Q", "one-test-" + i).slice(1))));
  assert.deepEqual(P.norm(one[0] + one.slice(1).replace(/1/g, "l")), { ok: true, id: one });
  assert.deepEqual(P.norm(one[0] + one.slice(1).replace(/1/g, "I")), { ok: true, id: one });
  assert.equal(P.norm("").err, "empty");
  assert.equal(P.norm("X-8K3-M7T-X26").err, "type");
  assert.equal(P.norm("Q-8K3-M7T").err, "length");
  assert.equal(P.norm("Q-8K3-M7U-X26").err, "char");
  const bad = id.slice(0, 9) + P.ALPHA[(P.ALPHA.indexOf(id[9]) + 1) % 32];
  assert.equal(P.norm(bad).err, "check");
  assert.match(P.errText("check"), /looks wrong/);
});

test("a pasted share message gives its ID; ordinary words never look like one", () => {
  const id = P.idFor("L", "radbook-141315");
  const msg = P.shareText(id);
  assert.equal(msg, "Try this PrepNucleus lesson: " + P.show(id) + " (search this ID in PrepNucleus)");
  assert.equal(P.find(msg), id);
  assert.equal(P.find("hey see " + P.show(id).toLowerCase() + "!"), id);
  assert.equal(P.find("Q fever and L-asparaginase questions"), null);
  assert.equal(P.looks("Q fever test"), "");
  assert.equal(P.looks("lymphoma"), "");
  assert.equal(P.looks(P.show(id)), "id");
  assert.equal(P.looks("q-8k3-m7t-x2d"), "bad");
  assert.equal(P.looks("Q8K3M7TX2D"), "bad");
  assert.equal(P.looks("Q-8K3-M7T-X26"), "id");                                   // the example in every hint is well formed
  // share text carries no answer, no score, no user data: only the ID and how to use it
  assert.doesNotMatch(P.shareText(P.idFor("Q", "x")), /answer|score|http/i);
});

test("index locations parse; anything else is refused", () => {
  assert.deepEqual(P.parseLoc("m:radiology/rad-chest"), { kind: "m", sid: "radiology", mid: "rad-chest" });
  assert.deepEqual(P.parseLoc("p"), { kind: "p" });
  assert.deepEqual(P.parseLoc("x"), { kind: "x" });
  assert.deepEqual(P.parseLoc("l:ctcbook-100001"), { kind: "l", key: "ctcbook-100001" });
  assert.equal(P.parseLoc("m:../x"), null);
  assert.equal(P.parseLoc("javascript:alert(1)"), null);
});

// A deliberately weak ID (2 body characters) forces collisions, to test the long-form rule at scale.
const weak = (type, key, long) => { const b = P.b32(P.sha256(P.NS[type] + key), long ? 10 : 2); return type + b + P.checkChar(type, b); };

test("collisions: the earlier owner keeps the short ID, later keys take the long form, deterministically", () => {
  const entries = Array.from({ length: 3000 }, (_, i) => ({ type: "Q", key: "item-" + i, loc: "m:s/m" + (i % 7) }));
  const a = assign(entries, { e: {}, xt: {} }, weak);
  assert.deepEqual(a.errors.filter((e) => !e.startsWith("format")), []);
  assert.ok(a.long > 2000, "most keys collide at 2 characters");
  const b = assign(entries.slice().reverse(), { e: {}, xt: {} }, weak);
  assert.deepEqual(b.xt, a.xt, "order of input does not matter");
  // a later key colliding with a published one never takes it over
  const pubOwner = entries.find((x) => !a.xt["q:" + x.key]);
  const newKey = Array.from({ length: 5000 }, (_, i) => "new-" + i).find((k) => weak("Q", k) === weak("Q", pubOwner.key) && k < pubOwner.key);
  if (newKey) {
    const prev = { e: { [weak("Q", pubOwner.key)]: pubOwner.loc }, xt: {} };
    const c = assign([{ type: "Q", key: newKey, loc: "m:s/new" }, pubOwner], prev, weak);
    assert.equal(c.xt["q:" + newKey], 1);
    assert.equal(c.ids.get(weak("Q", pubOwner.key)), pubOwner.loc);
  }
  // xt from the published index is kept even when the collision is gone
  const d = assign([{ type: "Q", key: "solo", loc: "p" }], { e: {}, xt: { "q:solo": 1 } });
  assert.ok(d.ids.has(P.idFor("Q", "solo", true)));
  assert.equal(P.idOf("Q", "solo", d.xt), P.idFor("Q", "solo", true));
});

test("200,000 synthetic keys at full length: no unresolved collision, every ID well formed", () => {
  const entries = Array.from({ length: 200000 }, (_, i) => ({ type: i % 100 ? "Q" : "L", key: "syn-" + i, loc: "p" }));
  const a = assign(entries);
  assert.deepEqual(a.errors, []);
  assert.equal(a.ids.size, 200000);
});

test("shards: 1024 files named by content, tombstones kept as x, the pointer names them all", () => {
  const ids = new Map([[P.idFor("Q", "a"), "m:anatomy/ana-x"], [P.idFor("L", "b"), "l:b"]]);
  const gone = P.idFor("Q", "dropped");
  const { files, pointer } = shards(ids, [gone], { gen: "2026-10-10", n: 2, x: 1, xt: {} });
  assert.equal(files.length, 1024);
  assert.equal(pointer.s.length, 1024 * 6);
  for (const f of files) {
    assert.equal(f.name, P.shardName(pointer, f.n));
    assert.equal(createHash("sha256").update(f.body).digest("hex").slice(0, 6), f.name.slice(3, 9));
    assert.ok(bankPath({ path: ["v1", "ids", f.name] }), "route serves " + f.name);
  }
  const at = (id) => JSON.parse(files[P.shardOf(id)].body).e[id];
  assert.equal(at(P.idFor("Q", "a")), "m:anatomy/ana-x");
  assert.equal(at(gone), "x");
  assert.ok(bankPath({ path: ["v1", "ids", "index.json"] }));
  assert.equal(bankPath({ path: ["v1", "ids", "zz-12345.json"] }), null);
  assert.equal(bankPath({ path: ["v1", "ids", "..", "manifest.json"] }), null);
});

test("build: an ID published before and gone from the live set is kept as a tombstone", () => {
  const cache = fs.mkdtempSync(join(os.tmpdir(), "prep-ids-"));
  try {
    fs.mkdirSync(join(cache, "v5/anatomy/mcq"), { recursive: true });
    const ix = JSON.parse(read("prep/bank/v5/anatomy/index.json"));
    fs.writeFileSync(join(cache, "v5/anatomy/mcq", ix.topics[0].id + ".json"), JSON.stringify({ items: [{ id: "live-1" }, { id: "live-2" }] }));
    fs.writeFileSync(join(cache, "lessons-index.json"), JSON.stringify({ v: 1, modules: { "les-a": { title: "A" } } }));
    const dropped = P.idFor("Q", "was-here");
    const b = build({ cache, prev: { e: { [dropped]: "m:anatomy/" + ix.topics[0].id }, xt: {} } });
    assert.deepEqual(b.tomb, [dropped]);
    assert.equal(JSON.parse(b.files[P.shardOf(dropped)].body).e[dropped], "x");
    assert.equal(b.pointer.x, 1);
    assert.equal(JSON.parse(b.files[P.shardOf(P.idFor("Q", "live-1"))].body).e[P.idFor("Q", "live-1")], "m:anatomy/" + ix.topics[0].id);
    assert.ok(b.c.l.some((x) => x.key === "les-a") && b.c.l.some((x) => x.key === "sur-breast-cancer"), "bank and bundled lessons");
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
});

const LIVE = process.env.PREP_IDS_CACHE || join(os.homedir(), "prep-data/ids/cache");
test("every live MCQ and lesson: unique, well-formed IDs (needs the cache from tools/prep-ids.mjs fetch)", { skip: !fs.existsSync(join(LIVE, "lessons-index.json")) && "no live cache on this machine" }, () => {
  const c = collect(LIVE);
  const a = assign(c.q.map((x) => ({ type: "Q", key: x.key, loc: x.loc })).concat(c.l.map((x) => ({ type: "L", key: x.key, loc: x.loc }))));
  assert.deepEqual(a.errors, []);
  assert.ok(c.q.length > 190000 && c.l.length > 1700, `${c.q.length} MCQs, ${c.l.length} lessons`);
  assert.equal(a.ids.size, c.q.length + c.l.length);
  assert.equal(a.long, 0, "no collision at 8 characters today");
  const subjects = new Set(c.q.map((x) => x.loc.split(/[:/]/)[1]));
  assert.ok(subjects.has("ss-radiology") && subjects.has("radiology") && subjects.has("medicine") && c.q.some((x) => x.loc === "p"));
});

test("wiring: loader, prep.js, lessons, PYQ and the deep link use prep-ids.js", () => {
  const loader = read("prep-loader.js"), prep = read("prep.js"), les = read("prep-lessons.js"), nb = read("native-bridge.js");
  assert.match(loader, /"prep-ids\.js"/); assert.match(loader, /"prep-ids\.css"/); assert.match(loader, /"prep-ids\.js": 1/);
  assert.match(prep, /a\.indexOf\("id-"\) === 0 && G\.PREP_IDS/);
  assert.match(prep, /IDS\.shareBtn\(qid\)/); assert.match(prep, /G\.PREP_IDS\.searchHtml\(q\)/); assert.match(prep, /row\("id-screen"/);
  assert.match(prep, /opts\.id && G\.PREP_IDS/);
  assert.match(les, /IDS\.ofLesson\(L\.key\)/); assert.match(les, /function open\(sid, mid, h, key, fromStart\)/);
  assert.match(read("prep-pyq.js"), /items: loadItems/);
  assert.match(nb, /stewardmd:\\\/\\\/prep\\\//);
  // no link in the share text (no web page opens a PrepNucleus question)
  assert.doesNotMatch(read("prep-ids.js").match(/function shareText[\s\S]*?\n  }/)[0], /https?:/);
});
