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

test("very hard: vh items are level 4 at load, the bank's d left as written elsewhere; draw, chip and adaptive honour it", () => {
  const items = [item("v1", { d: 3, vh: true }), item("h1", { d: 3 }), item("e1", { d: 1 }), item("m1", { d: 2 }), item("v2", { d: 4 })];
  assert.deepEqual(items.map(P.levelOf), [4, 3, 1, 2, 4], "levelOf reads vh before markLevels too");
  P.markLevels(items);
  assert.deepEqual(items.map((i) => i.d), [4, 3, 1, 2, 4], "only vh items change");
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  assert.deepEqual(P.customDraw([items], 10, 4, rnd).map((i) => i.id).sort(), ["v1", "v2"]);
  assert.deepEqual(P.customDraw([items], 10, 3, rnd).map((i) => i.id), ["h1"]);
  assert.deepEqual(P.adaptiveNew(items, {}, "p:x", 4, 3, () => 0.5).map((i) => P.levelOf(i)), [4, 4, 3], "nearest very hard first");
  const src = read("prep.js");
  assert.match(src, /\[4, "Very hard"\]/, "custom practice chip");
  assert.match(src, /"hard", "very hard"\]\[cm\.d\]/, "custom practice line");
  assert.match(src, /markLevels\(mergeOverlay\(/, "loadModule marks the levels");
});

test("overlay releases: a new folder per release, the earlier folders' cached copies named for removal", () => {
  assert.deepEqual(P.oldOverlays("medcov2"), ["medcov"]);
  assert.deepEqual(P.oldOverlays("medcov4"), ["medcov", "medcov2", "medcov3"]);
  assert.deepEqual(P.oldOverlays("medcov"), []); assert.deepEqual(P.oldOverlays("radnotes"), []);
  assert.match(read("prep.js"), /medicine: \["medcov4"\], "ss-pulmonology": \["medcov4"\]/);
  assert.match(read("prep.js"), /radiology: \["radnotes2", "radmax6"\]/, "radiology reads the radnotes2 and radmax6 releases");
  assert.deepEqual(P.oldOverlays("radmax6"), ["radmax", "radmax2", "radmax3", "radmax4", "radmax5"], "radmax6 replaces cached radmax to radmax5 copies");
  assert.deepEqual(P.oldOverlays("radmax5"), ["radmax", "radmax2", "radmax3", "radmax4"], "radmax5 replaces cached radmax to radmax4 copies");
  assert.deepEqual(P.oldOverlays("radnotes2"), ["radnotes"], "radnotes2 replaces cached radnotes copies");
  assert.deepEqual(P.oldOverlays("radmax4"), ["radmax", "radmax2", "radmax3"], "radmax4 replaces cached radmax to radmax3 copies");
  assert.deepEqual(P.oldOverlays("radmax3"), ["radmax", "radmax2"], "radmax3 replaces cached radmax and radmax2 copies");
  assert.deepEqual(P.oldOverlays("radmax"), []);
  assert.deepEqual(P.oldOverlays("radmax2"), ["radmax"], "radmax2 replaces cached radmax copies");
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

test("loader: ON by default (owner 2026-10-06); smd_prep=0 or ?prep=0 turns it off, ?prep=1 wins over storage", () => {
  assert.equal(loaderIn("", {}).win.PREP_LOADER.enabled(), true);
  assert.equal(loaderIn("", { smd_prep: "0" }).win.PREP_LOADER.enabled(), false);
  assert.equal(loaderIn("?prep=1", { smd_prep: "0" }).win.PREP_LOADER.enabled(), true);
  assert.equal(loaderIn("?prep=0", { smd_prep: "1" }).win.PREP_LOADER.enabled(), false);
  const off = loaderIn("?prep=0", {});
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
  assert.match(home, /localStorage\.getItem\("smd_prep"\) !== "0"/);
  assert.match(home, /prep: function \(opts\) \{[\s\S]{0,200}homeToolEligible/);
  const sb = read("swipe-back.js");
  assert.match(sb, /window\.PREP\.isOpen\(\)\) return true/);
  assert.match(sb, /window\.PREP\.back\(\) !== false/);
  const www = read("scripts/build-www.sh");
  assert.match(www, /cp prep\/taxonomy\.json/);
  assert.match(www, /prep\/bank\/\$\{BV:-v1\}\/\*\/index\.json/);
  assert.doesNotMatch(www, /cp -R prep/, "never the whole prep directory (question files stay in R2)");
});

test("app text has no em or en dash", () => {
  for (const f of ["prep.js", "prep-loader.js", "prep.css", "prep-arena.js"]) assert.doesNotMatch(read(f), /[–—]/, f);
});

test("Phase 4: target difficulty and adaptive new picks", () => {
  assert.equal(P.targetDifficulty(null), 2);
  assert.equal(P.targetDifficulty({ t: 10, ok: 9 }), 4, "90% after 10 attempts -> very hard");
  assert.equal(P.targetDifficulty({ t: 9, ok: 9 }), 3, "very hard needs 10 attempts");
  assert.equal(P.targetDifficulty({ t: 10, ok: 8 }), 3);
  assert.equal(P.targetDifficulty({ t: 10, ok: 6 }), 2);
  assert.equal(P.targetDifficulty({ t: 10, ok: 3 }), 1);
  const pool = [item("e1", { d: 1 }), item("e2", { d: 1 }), item("m1", { d: 2 }), item("h1", { d: 3 }), item("h2", { d: 3 })];
  const cards = { "p:x:h2": [5, 2, 1, 9, 1, 0] };
  const got = P.adaptiveNew(pool, cards, "p:x", 3, 2, () => 0.5).map((i) => i.id);
  assert.deepEqual(got, ["h1", "m1"], "unseen only, nearest the target first");
  assert.deepEqual(P.adaptiveNew(pool, {}, "p:x", 1, 2, () => 0.5).map((i) => i.d), [1, 1]);
});

test("Phase 4: weak modules, today's plan, mistake counts", () => {
  const s = P.emptyStore();
  s.mod = { a: { t: 10, ok: 3 }, b: { t: 10, ok: 5 }, c: { t: 10, ok: 9 }, d: { t: 3, ok: 0 } };
  assert.deepEqual(P.weakModules(s, 3), ["a", "b"], "under 60% with 5 attempts or more, weakest first");
  s.cards["p:a:1"] = [5, 2, 1, 10, 1, 0]; s.cards["p:a:2"] = [5, 2, 1, 9, 1, 0]; s.cards["p:c:1"] = [5, 2, 1, 10, 1, 0]; s.cards["p:c:2"] = [5, 2, 1, 99, 1, 0];
  s.days[10] = 12; s.goal = 30;
  const p = P.planToday(s, 10);
  assert.equal(p.due, 3); assert.deepEqual(p.dueModules, [{ m: "a", n: 2 }, { m: "c", n: 1 }]);
  assert.equal(p.done, 12); assert.equal(p.left, 18); assert.deepEqual(p.weak, ["a", "b"]);
  s.mt = { q1: ["anatomy", "a", "know", 1, "Q"], q2: ["anatomy", "a", null, 2, "Q"], q3: ["anatomy", "b", "misread", 3, "Q"] };
  const c = P.mistakeCounts(s.mt);
  assert.equal(c.all, 3); assert.equal(c.know, 1); assert.equal(c.misread, 1); assert.equal(c.untagged, 1);
});

test("Phase 5: mock patterns, module picks across subjects, marking with negatives", () => {
  assert.deepEqual([P.mockOf("neet-pg", "ini-cet").n, P.mockOf("neet-pg", "ini-cet").min], [200, 180]);
  assert.equal(P.mockOf("usmle").minus, 0);
  const ix = (id, counts) => ({ id, ix: { topics: counts.map((n, i) => ({ id: id + i, count: n })) } });
  const picks = P.mockModules([ix("big", [100, 100, 100, 100]), ix("small", [10, 0])], "neet-pg", 4, () => 0.3);
  assert.ok(picks.some((p) => p.s === "small"), "every subject with questions gets a module");
  assert.ok(picks.length <= 4); assert.ok(picks.every((p) => p.n > 0));
  const items = [item("1", { _s: "a" }), item("2", { _s: "a" }), item("3", { _s: "b" }), item("4", { _s: "b" })];
  const sc = P.scoreMock(items, [0, 1, -1, 0], { plus: 4, minus: 1 });
  assert.deepEqual([sc.right, sc.wrong, sc.blank, sc.marks, sc.max], [2, 1, 1, 7, 16]);
  assert.deepEqual(sc.bySubject.a, { n: 2, right: 1, wrong: 1 });
  assert.equal(P.scoreMock(items, [1, 1, 1, 1], { plus: 1, minus: 1 / 3 }).marks, -1.33);
});

test("findModule: typed topic to the best module", () => {
  const subs = [{ id: "anatomy", name: { en: "Anatomy" }, sections: [{ id: "s1", name: { en: "Upper limb" }, modules: [{ id: "ana-hand", name: { en: "Hand" } }, { id: "ana-bp", name: { en: "Brachial plexus" } }] }] },
    { id: "pathology", name: { en: "Pathology" }, sections: [{ id: "s2", name: { en: "Haematopathology" }, modules: [{ id: "pat-lymphoma", name: { en: "Hodgkin and non-Hodgkin lymphoma" } }] }] }];
  assert.deepEqual(P.findModule(subs, "10 questions on lymphoma"), { subject: "pathology", module: "pat-lymphoma" });
  assert.deepEqual(P.findModule(subs, "quiz me on brachial plexus"), { subject: "anatomy", module: "ana-bp" });
  assert.equal(P.findModule(subs, "astrophysics"), null);
});

/* ---- Arena client (prep-arena.js) ---- */
const AR = require("../prep-arena.js");

test("arena flag: ON by default (owner 2026-10-06); smd_prep_arena=0 or ?arena=0 off, ?arena=1 wins; the loader ships prep-arena.js after prep.js", () => {
  const get = (m) => (k) => (k in m ? m[k] : null);
  assert.equal(AR.enabled("", get({})), true);
  assert.equal(AR.enabled("", get({ smd_prep_arena: "0" })), false);
  assert.equal(AR.enabled("?prep=1&arena=1", get({ smd_prep_arena: "0" })), true);
  assert.equal(AR.enabled("?arena=0", get({ smd_prep_arena: "1" })), false);
  const L = loaderIn("?prep=1", {}).win.PREP_LOADER;
  assert.ok(L.JS.indexOf("prep-arena.js") > L.JS.indexOf("prep.js"));
});

test("arena events: server shape normalised, live before coming, countdown words", () => {
  const now = 1_800_000_000_000;
  const evs = AR.eventsFrom({ events: [
    { role: "current", id: "daily-neet-pg-1", kind: "daily", startsAt: now - 86400e3, endsAt: now - 86400e3 + 1200e3, n: 20, secs: 1200, status: "closed", entry: "submitted" },
    { role: "next", id: "daily-neet-pg-2", kind: "daily", startsAt: now + 3600e3, endsAt: now + 4800e3, n: 20, secs: 1200, status: "upcoming", entry: null },
    { role: "current", id: "weekly-neet-pg-1", kind: "weekly", startsAt: (now - 60e3) / 1000, endsAt: (now + 7140e3) / 1000, n: 100, secs: 7200, entry: "started" }] });
  assert.equal(evs.length, 3);
  assert.equal(evs[2].start, now - 60e3, "seconds read as seconds");
  assert.equal(AR.pickEvent(evs, "daily", now).id, "daily-neet-pg-2", "a closed event gives way to the coming one");
  assert.equal(AR.pickEvent(evs, "weekly", now).id, "weekly-neet-pg-1");
  assert.equal(AR.eventLine(evs[1], now), "Starts in 1:00:00");
  assert.equal(AR.eventLine(evs[2], now), "In progress, ends in 1:59:00");
  assert.equal(AR.eventLine(evs[0], now), "Submitted. See the leaderboard");
  assert.equal(AR.eventLine(null, now), "No event scheduled");
  assert.equal(AR.countdown(65e3), "1:05");
  assert.equal(AR.countdown(2 * 86400e3 + 4 * 3600e3 + 5e3), "2 d 4 h");
  assert.equal(AR.countdown(-5), "0:00");
  assert.equal(AR.normEvent({}), null);
});

test("arena: answers map, signed change, the server's refusals in plain words", () => {
  assert.deepEqual(AR.answersOf([{ id: "a" }, { id: "b" }, { id: "c" }], [2, -1, 0]), { a: 2, c: 0 });
  assert.equal(AR.signed(12), "+12"); assert.equal(AR.signed(-8), "minus 8"); assert.equal(AR.signed(0), "0");
  assert.match(AR.errWord(425, "not-open"), /not opened yet/);
  assert.match(AR.errWord(410, "too-late"), /Too late/);
  assert.match(AR.errWord(410, "closed"), /has closed/);
  assert.match(AR.errWord(409, "already-submitted"), /already taken/);
  assert.match(AR.errWord(409, "not-started"), /Start the event/);
  assert.match(AR.errWord(503, "bank-empty"), /Coming soon/);
  assert.match(AR.errWord(401), /Sign in/);
});

test("arena local stats: 30 day row oldest first, accuracy by subject weakest first", () => {
  assert.deepEqual(AR.lastDays({ 100: 5, 98: 2, 70: 9 }, 100, 3), [2, 0, 5]);
  assert.equal(AR.lastDays({}, 100, 30).length, 30);
  const acc = AR.accuracyBySubject({ "ana-a": { t: 10, ok: 9 }, "ana-b": { t: 10, ok: 3 }, "phy-a": { t: 4, ok: 1 }, "x-1": { t: 0, ok: 0 }, "zz": { t: 3, ok: 3 } },
    (m) => ({ ana: "anatomy", phy: "physiology" })[m.split("-")[0]] || null);
  assert.deepEqual(acc.map((x) => [x.sid, x.t, x.ok, x.pct]), [["physiology", 4, 1, 25], ["anatomy", 20, 12, 60]]);
});

test("battle state machine: queue, match, rounds, end; busy, slow, nobody, resume, forfeit; bad messages ignored", () => {
  const t0 = 1000;
  let b = AR.battleNew();
  assert.equal(AR.battleStep(b, { t: "q", i: 0, o: ["a", "b"] }, t0), b, "no question before a match");
  assert.equal(AR.battleStep(b, null, t0), b); assert.equal(AR.battleStep(b, { t: 5 }, t0), b);
  b = AR.battleStep(b, { t: "waiting" }, t0); assert.equal(b.waiting, true);
  b = AR.battleStep(b, { t: "match", id: "m1", opp: { name: "R".repeat(60), rating: 1250 }, n: 7, secs: 20 }, t0);
  assert.equal(b.phase, "match"); assert.equal(b.opp.name.length, 40); assert.equal(AR.liveBattle(b), true);
  assert.equal(AR.battleStep(b, { t: "busy" }, t0), b, "busy only while queueing (a resume may answer the queue)");
  b = AR.battleStep(b, { t: "q", i: 0, q: "Q1", o: ["a", "b", "c", "d"], deadline: t0 + 15000 }, t0);
  assert.equal(b.phase, "q"); assert.equal(b.deadline, t0 + 15000);
  const skew = AR.battleStep(b, { t: "q", i: 1, q: "Q2", o: ["a", "b"], deadline: t0 + 999999 }, t0);
  assert.equal(skew.deadline, t0 + 20000, "a far deadline (clock skew) is held to the round length");
  assert.equal(AR.canPick(b, 2, t0 + 1), true); assert.equal(AR.canPick(b, 9, t0 + 1), false); assert.equal(AR.canPick(b, 1, t0 + 15000), false);
  assert.equal(AR.battleStep(b, { t: "r", i: 3, a: 0 }, t0), b, "a result for another round is ignored");
  b = AR.battleStep(b, { t: "r", i: 0, a: 1, you: { k: 1, pts: 18 }, opp: { k: 0, pts: 0 }, score: [18, 0] }, t0);
  assert.equal(b.phase, "r"); assert.deepEqual(b.score, [18, 0]); assert.equal(b.you.pts, 18);
  assert.equal(AR.battleStep(b, { t: "end", result: "maybe" }, t0), b);
  const end = AR.battleStep(b, { t: "end", score: [18, 0], result: "win", rating: { before: 1200, after: 1212 }, forfeit: "opp" }, t0);
  assert.equal(end.phase, "end"); assert.equal(end.forfeit, "opp"); assert.deepEqual(end.rating, { before: 1200, after: 1212 });
  assert.equal(AR.battleClosed(end), end, "closing after the end changes nothing");
  const lost = AR.battleClosed(b); assert.equal(lost.phase, "lost");
  const back = AR.battleStep(lost, { t: "match", id: "m1", opp: { name: "R", rating: 1250 }, n: 7, secs: 20, resume: true, score: [18, 12] }, t0);
  assert.equal(back.phase, "match"); assert.equal(back.resumed, true); assert.deepEqual(back.score, [18, 12]);
  for (const t of ["busy", "slow", "nobody"]) { const x = AR.battleStep(AR.battleNew(), { t }, t0); assert.equal(x.phase, t); assert.equal(AR.battleClosed(x), x); }
});

test("PrepNucleus 4K logo icon and banner assets ship and are wired", () => {
  const rootLogo = path.join(ROOT, "prepnucleus-logo.png");
  assert.ok(fs.existsSync(rootLogo), "prepnucleus-logo.png must exist at repo root");
  const logoBuf = fs.readFileSync(rootLogo);
  assert.equal(logoBuf.slice(1, 4).toString("ascii"), "PNG", "must be a PNG");
  assert.equal(logoBuf[25], 6, "prepnucleus-logo.png must have RGBA alpha channel");
  assert.ok(logoBuf.length < 400 * 1024, "prepnucleus-logo.png must be under 400KB");

  const icon4k = path.join(ROOT, "prep/art/logo-icon-4k.png");
  assert.ok(fs.existsSync(icon4k), "4K logo icon must exist");

  const bannerDark = path.join(ROOT, "prep/art/banner-dark.webp");
  const bannerLight = path.join(ROOT, "prep/art/banner-light.webp");
  const banner4k = path.join(ROOT, "prep/art/banner-4k.png");
  assert.ok(fs.existsSync(bannerDark), "banner-dark.webp must exist");
  assert.ok(fs.existsSync(bannerLight), "banner-light.webp must exist");
  assert.ok(fs.existsSync(banner4k), "banner-4k.png must exist");

  const prepJs = read("prep.js");
  assert.match(prepJs, /pn-bar-logo/, "prep.js must render the logo icon in the header");
  // Apple pass (2026-10-10, owner palette): no oversized banner on home; the brand is the mark beside the name in the
  // bar, flat amber (#EFC07B) on dark and flat Prussian blue (#0F3460) on light.
  assert.doesNotMatch(prepJs, /pn-brand-banner/, "home no longer renders the brand banner");
  assert.match(prepJs, /logo-mark-amber-96\.webp/, "the dark theme bar uses the flat amber mark");
  assert.match(prepJs, /logo-mark-prussian-96\.webp/, "the light theme bar uses the flat Prussian mark");
  assert.ok(fs.existsSync(path.join(ROOT, "prep/art/logo-mark-amber-96.webp")), "logo-mark-amber-96.webp must exist");
  assert.ok(fs.existsSync(path.join(ROOT, "prep/art/logo-mark-prussian-96.webp")), "logo-mark-prussian-96.webp must exist");

  const prepCss = read("prep.css");
  assert.doesNotMatch(prepCss, /pn-sky|hero-dark\.webp|banner-dark\.webp/, "prep.css draws no painted sky or banner");
  assert.match(prepCss, /\.pn-bar-logo/, "prep.css must style pn-bar-logo");

  const homeJs = read("home.js");
  assert.match(homeJs, /prepnucleus-logo\.png/, "home.js must reference prepnucleus-logo.png");
  assert.match(homeJs, /act: "prep"[\s\S]*anim: "prep"/, "HOME_TOOLS must declare anim: prep");
});


test("mergeOverlay: bank items first, overlay items added once by id, kept whole (x, r, img, imgPlace, prov, set, sid, key)", () => {
  const bank = [{ id: "b1", a: 0 }, { id: "rn-1", a: 2, q: "bank copy" }];
  const ov = [{ id: "rn-1", a: 1, q: "overlay copy" }, { id: "rn-2", a: 3, x: { key: "k" }, r: ["a", "b", "c", "d"], img: ["rn-n1-p093-1.webp"], imgPlace: "stem", prov: "SMD", set: "radnotes", sid: "n1-x" }, { id: "rn-2", a: 0 }, null, { a: 1 }];
  const m = P.mergeOverlay(bank, ov);
  assert.deepEqual(m.map((i) => i.id), ["b1", "rn-1", "rn-2"]);
  assert.equal(m[1].q, "bank copy", "the bank copy wins a clash");
  assert.deepEqual(m[2], ov[1], "overlay item untouched");
  assert.equal(m[2].a, 3, "answer key unchanged");
  assert.deepEqual(P.mergeOverlay(null, undefined), []);
});

test("bank stamps: a module cached before an in-place republish is fetched again; offline or unstamped keeps the copy", () => {
  const m = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prep/bank/v5/manifest.json"), "utf8"));
  const s = P.bankStamps(m);
  const ana = m.subjects.find((x) => x.id === "anatomy");
  assert.equal(s.anatomy, ana.bytes + "." + ana.items);
  assert.deepEqual(P.bankStamps(null), {});
  assert.equal(P.cacheFresh({ items: [] }, s.anatomy), false, "an entry cached before stamps existed is stale");
  assert.equal(P.cacheFresh({ items: [], s: "1.1" }, s.anatomy), false, "another stamp is stale");
  assert.equal(P.cacheFresh({ items: [], s: s.anatomy }, s.anatomy), true);
  assert.equal(P.cacheFresh({ items: [] }, ""), true, "no stamp (offline, subject outside the manifest): keep the copy");
  assert.equal(P.cacheFresh(null, ""), false);
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prep.js"), "utf8");
  assert.match(src, /cachePut\(p, \{ items: items, ts: Date\.now\(\), s: stamp \}\)/, "loadBank stores the stamp");
  assert.match(src, /function \(e\) \{ if \(hit\) return \(st\.mem\[p\] = hit\.items\); throw e; \}/, "a failed refetch falls back to the cached copy");
  const sh = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts/build-www.sh"), "utf8");
  assert.match(sh, /manifest\.json" "\$WWW\/prep\/bank/, "the native bundle ships the manifest");
});

test("tide pass: question of the day is stable for a day, the self comparison counts only modules below", () => {
  assert.equal(P.dayHash(20371, 7), P.dayHash(20371, 7), "same day, same pick");
  assert.notEqual(P.dayHash(20371, 7), P.dayHash(20372, 7), "the next day moves on");
  assert.ok(P.dayHash(20371, 7) >= 0 && Number.isInteger(P.dayHash(20371, 7)));
  assert.equal(P.selfShare([40, 50, 60, 70, 80], 65), 60);
  assert.equal(P.selfShare([40, 50, 60, 70, 80], 40), 0, "ties are not counted as below");
  assert.equal(P.selfShare([], 50), 0);
});

test("tide pass: prep-tide.js loads after prep-motion.js, optional, and prep.js attaches, syncs and detaches it", () => {
  const L = read("prep-loader.js"), J = read("prep.js"), T = read("prep-tide.js");
  assert.match(L, /"prep-motion\.js", "prep-tide\.js"/);
  assert.match(L, /"prep-tide\.js": 1/);
  assert.match(J, /PREP_TIDE\.attach\(root\)/); assert.match(J, /PREP_TIDE\.sync\(root\)/); assert.match(J, /PREP_TIDE\.detach\(\)/);
  assert.match(T, /prefers-reduced-motion/, "reduced motion draws one still frame");
  assert.match(T, /visibilitychange/, "pauses when the page is hidden");
  assert.match(T, /FRAME_MS = 1000 \/ 30/, "capped at 30 frames a second");
  assert.match(T, /IDLE_MS = 10000/, "settles 10 s after the last interaction");
  assert.doesNotMatch(T, /https?:\/\//, "no network: offline");
});
