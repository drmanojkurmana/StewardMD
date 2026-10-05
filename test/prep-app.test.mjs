/* PrepNucleus app (prep.js) pure helpers, the boot loader and the wiring into home, back and the native bundle.
 * What must hold: flagged items are never shown; USMLE uses vignettes only when a module has enough; progress, status,
 * stars and "solve next" read the FSRS store the way the screens show them; the custom draw spreads across modules and
 * honours difficulty; the flag is OFF by default and only the loader loads at boot; the bundle ships the tree and index
 * files but never the question files.
 *
 * node --test test/prep-app.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const P = require("../prep.js");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const item = (id, extra) => ({ id, q: "Q " + id, o: ["a", "b", "c", "d"], a: 0, exp: "", t: "m1", d: 1, ...extra });

test("usable and poolFor: flagged out; USMLE vignettes only when there are at least 5", () => {
  const items = [item("x1"), item("x2", { flags: ["disputed"] }), item("x3", { ex: ["usmle"] })];
  assert.deepEqual(P.poolFor(items, "neet-pg").map((i) => i.id), ["x1", "x3"]);
  assert.deepEqual(P.poolFor(items, "usmle").map((i) => i.id), ["x1", "x3"], "too few vignettes: whole pool");
  const many = [item("n1"), ...[1, 2, 3, 4, 5].map((k) => item("v" + k, { ex: ["usmle"] })), item("v6", { ex: ["usmle"], flags: ["key"] })];
  assert.deepEqual(P.poolFor(many, "usmle").map((i) => i.id), ["v1", "v2", "v3", "v4", "v5"]);
  assert.equal(P.usable(item("z", { flags: [] })), true);
  assert.deepEqual(P.poolFor(items, "neet-pg", { x3: 1 }).map((i) => i.id), ["x1"], "reported-and-hidden items are left out");
  assert.equal(P.usable(item("h"), { h: 1 }), false);
});

test("progressByModule counts answered and due per module from p: deck cards only", () => {
  const s = P.emptyStore();
  s.cards["p:m1:a"] = [5, 2, 10, 12, 1, 0];
  s.cards["p:m1:b"] = [5, 2, 10, 20, 1, 0];
  s.cards["p:m2:c"] = [5, 2, 10, 9, 1, 0];
  s.cards["t:m1:z"] = [5, 2, 10, 1, 1, 0];
  assert.deepEqual(P.progressByModule(s, 12), { m1: { answered: 2, due: 1 }, m2: { answered: 1, due: 1 } });
  assert.equal(P.deckKey("ana-x"), "p:ana-x");
});

test("statusOf, stars, countFor", () => {
  assert.equal(P.statusOf(0, 10), "new");
  assert.equal(P.statusOf(4, 10), "paused");
  assert.equal(P.statusOf(10, 10), "done");
  assert.equal(P.stars(null), null);
  assert.equal(P.stars({ t: 4, ok: 4 }), null, "under 5 attempts: no stars");
  assert.equal(P.stars({ t: 10, ok: 7 }), 4);
  assert.equal(P.stars({ t: 10, ok: 0 }), 0);
  assert.equal(P.countFor({ count: 40, usmle: 3 }, "usmle"), 40);
  assert.equal(P.countFor({ count: 40, usmle: 12 }, "usmle"), 12);
  assert.equal(P.countFor({ count: 40, usmle: 12 }, "neet-pg"), 40);
});

test("solveNext: most due first, then the weakest started module, then the first fresh one", () => {
  const subjects = [{ id: "s1" }, { id: "s2" }];
  const ix = { s1: { topics: [{ id: "a", title: { en: "A" }, count: 10 }, { id: "b", title: { en: "B" }, count: 10 }, { id: "e", title: { en: "E" }, count: 0 }] },
    s2: { topics: [{ id: "c", title: { en: "C" }, count: 10 }] } };
  const s = P.emptyStore();
  assert.deepEqual(P.solveNext(subjects, ix, s, 100, "neet-pg"), { why: "new", subject: "s1", module: "a", title: { en: "A" } });
  s.cards["p:a:1"] = [5, 2, 90, 200, 1, 0]; s.mod.a = { t: 5, ok: 4 };
  s.cards["p:b:1"] = [5, 2, 90, 200, 1, 0]; s.mod.b = { t: 5, ok: 1 };
  assert.equal(P.solveNext(subjects, ix, s, 100, "neet-pg").module, "b", "weakest share right");
  s.cards["p:c:1"] = [5, 2, 90, 99, 1, 0]; s.cards["p:c:2"] = [5, 2, 90, 100, 1, 0];
  s.cards["p:a:2"] = [5, 2, 90, 50, 1, 0];
  const n = P.solveNext(subjects, ix, s, 100, "neet-pg");
  assert.equal(n.why, "due"); assert.equal(n.module, "c"); assert.equal(n.n, 2);
  assert.equal(P.solveNext([], {}, s, 100, "neet-pg"), null);
});

test("filterModules by status", () => {
  const topics = [{ id: "a", count: 5 }, { id: "b", count: 5 }, { id: "c", count: 5 }];
  const prog = { a: { answered: 5 }, b: { answered: 2 } };
  const ids = (f) => P.filterModules(topics, prog, f, "neet-pg").map((t) => t.id);
  assert.deepEqual(ids("all"), ["a", "b", "c"]);
  assert.deepEqual(ids("done"), ["a"]);
  assert.deepEqual(ids("paused"), ["b"]);
  assert.deepEqual(ids("new"), ["c"]);
});

test("customDraw spreads across modules, honours difficulty and the count", () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const l1 = [1, 2, 3, 4, 5, 6].map((k) => item("a" + k, { d: k % 3 + 1 }));
  const l2 = [1, 2, 3, 4, 5, 6].map((k) => item("b" + k, { d: k % 3 + 1 }));
  const out = P.customDraw([l1, l2, []], 6, 0, rnd);
  assert.equal(out.length, 6);
  assert.equal(out.filter((i) => i.id[0] === "a").length, 3, "even spread");
  assert.equal(new Set(out.map((i) => i.id)).size, 6, "no repeats");
  const hard = P.customDraw([l1, l2], 50, 3, rnd);
  assert.equal(hard.length, 4); assert.ok(hard.every((i) => i.d === 3));
  assert.equal(l1.length, 6, "inputs untouched");
});

test("fmtTime and examOf", () => {
  assert.equal(P.fmtTime(0), "0:00"); assert.equal(P.fmtTime(65), "1:05"); assert.equal(P.fmtTime(-3), "0:00");
  assert.equal(P.examOf("usmle").sec, 90);
  assert.equal(P.examOf("nope").id, "neet-pg");
  assert.equal(P.examOf("neet-ss").branch, "ss-medicine");
});

function loaderIn(search, stored) {
  const added = [];
  const win = {
    location: { search },
    localStorage: { getItem: (k) => (k in stored ? stored[k] : null) },
    document: { querySelector: () => null, createElement: (t) => ({ tag: t, setAttribute() {} }), head: { appendChild: (el) => added.push(el) } },
  };
  vm.runInNewContext(read("prep-loader.js"), { window: win });
  return { win, added };
}

test("loader: OFF by default; smd_prep=1 or ?prep=1 turns it on, ?prep=0 wins over storage", () => {
  assert.equal(loaderIn("", {}).win.PREP_LOADER.enabled(), false);
  assert.equal(loaderIn("", { smd_prep: "1" }).win.PREP_LOADER.enabled(), true);
  assert.equal(loaderIn("?prep=1", {}).win.PREP_LOADER.enabled(), true);
  assert.equal(loaderIn("?prep=0", { smd_prep: "1" }).win.PREP_LOADER.enabled(), false);
  const off = loaderIn("", {});
  assert.equal(off.win.PREP.open(), false, "open is a no-op while off");
  assert.equal(off.added.length, 0, "nothing loads while off");
  assert.equal(off.win.PREP.isOpen(), false);
  assert.equal(off.win.PREP.back(), false);
});

test("loader: first open injects the stylesheet and scripts in order at one token", () => {
  const on = loaderIn("?prep=1", {});
  on.win.PREP.open();
  const L = on.win.PREP_LOADER;
  assert.deepEqual(on.added.map((e) => e.href || e.src), [...L.CSS, ...L.JS].map((f) => "/" + f + "?v=" + L.V));
  assert.ok(on.added.filter((e) => e.tag === "script").every((e) => e.async === false));
  assert.ok(L.JS.indexOf("specialty-core.js") < L.JS.indexOf("prep.js"));
});

test("wiring: index.html boots only the loader, at the loader's token; home, back and the bundle know PrepNucleus", () => {
  const html = read("index.html"), V = read("prep-loader.js").match(/var V = "([^"]+)"/)[1];
  assert.ok(html.includes(`<script src="/prep-loader.js?v=${V}" defer></script>`));
  assert.ok(!/src="\/prep\.js/.test(html), "prep.js is never in index.html");
  const home = read("home.js");
  assert.match(home, /act: "prep", ic: "quiz"/);
  assert.match(home, /localStorage\.getItem\("smd_prep"\) === "1"/);
  assert.match(home, /prep: function \(\) \{[\s\S]{0,200}homeToolEligible/);
  const sb = read("swipe-back.js");
  assert.match(sb, /window\.PREP\.isOpen\(\)\) return true/);
  assert.match(sb, /window\.PREP\.back\(\) !== false/);
  const www = read("scripts/build-www.sh");
  assert.match(www, /cp prep\/taxonomy\.json/);
  assert.match(www, /prep\/bank\/v1\/\*\/index\.json/);
  assert.doesNotMatch(www, /cp -R prep/, "never the whole prep directory (question files stay in R2)");
});

test("app text has no em or en dash", () => {
  for (const f of ["prep.js", "prep-loader.js", "prep.css"]) assert.doesNotMatch(read(f), /[–—]/, f);
});
