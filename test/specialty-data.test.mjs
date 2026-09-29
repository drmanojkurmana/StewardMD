// Specialty engine data layer, ported from the Ophthalmós data, levels and learn tests (module repo
// drmanojkurmana/ophthalmos test/{data,levels,learn}.test.mjs) to run against specialty-data.js with the fixture
// specialty in test/fixtures/specialty-fixture/. Levels are "mbbs" | "resident" (Tokós contract), storage is keyed by
// the host config (storeKey / prefKey), and eye-specific decks are replaced by the fixture's.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../specialty-core.js");
const D = require("../specialty-data.js");
const FX = new URL("./fixtures/specialty-fixture/", import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, FX), "utf8"));
const cfg = read("tracks.json");
const mcq = { items: read("decks/mcq/fx-a.json").items.concat(read("decks/mcq/fx-b.json").items) };
const gloss = read("learn/glossary.json").terms;
const media = Object.fromEntries(read("learn/media/credits.json").items.map((m) => [m.id, m]));
const KEY = "smd_fixture_v1", PKEY = "smd_fixture_prefs";
const mem = (init = {}) => ({ m: { ...init }, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); } });

/* ---------- access, levels, trials (data.test + levels.test) ---------- */
test("access: MBBS is free, Resident needs Pro; the host config names the free levels", () => {
  assert.equal(D.levelLocked(cfg, "mbbs", false), false);
  assert.equal(D.levelLocked(cfg, "resident", false), true);
  assert.equal(D.levelLocked(cfg, "resident", true), false);
  assert.equal(D.levelLocked({}, "mbbs", false), false, "default free level is mbbs");
  assert.equal(D.levelLocked({ levels: { free: ["mbbs", "resident"] } }, "resident", false), false, "createHost cfg.levels.free");
});

test("level keys keep each level's memory apart", () => {
  assert.equal(D.levelKey("ctg", "mbbs"), "ctg.mbbs");
  assert.equal(D.levelKey("ctg", "resident"), "ctg.resident");
  assert.notEqual(D.levelKey("x", "mbbs"), D.levelKey("x", "resident"));
});

test("MBBS pool leaves out hard questions; Resident pool draws all; untagged items stay in", () => {
  const mb = D.mcqPool(mcq.items, "mbbs"), res = D.mcqPool(mcq.items, "resident");
  assert.ok(mb.length > 0 && mb.every((it) => it.d !== 3));
  assert.equal(res.length, mcq.items.length);
  assert.equal(D.mcqPool([{ id: "x" }], "mbbs").length, 1);
});

test("trials: one per feature, open for Pro, used after the first run", () => {
  const s = D.loadStore(mem(), KEY);
  assert.deepEqual(s.trials, {});
  assert.equal(D.trialState(s, "clinic.ctg", true), "open");
  assert.equal(D.trialState(s, "clinic.ctg", false), "trial");
  assert.equal(D.useTrial(s, "clinic.ctg", 100), true);
  assert.equal(D.useTrial(s, "clinic.ctg", 101), false, "idempotent");
  assert.equal(s.trials["clinic.ctg"], 100, "first day kept");
  assert.equal(D.trialState(s, "clinic.ctg", false), "used");
  assert.equal(D.trialState(s, "clinic.ctg", true), "open", "Pro never sees a spent trial");
  assert.equal(D.trialState(s, "exam", false), "trial", "per feature");
  assert.equal(D.useTrial(s, "exam", 0), true, "day 0 counts as used");
  assert.equal(D.trialState(s, "exam", false), "used");
});

test("store survives corrupt or foreign localStorage, under the host's own key", () => {
  const ls = mem();
  ls.m[KEY] = "{not json";
  assert.equal(D.loadStore(ls, KEY).v, 1);
  ls.m[KEY] = JSON.stringify({ v: 99 });
  assert.deepEqual(D.loadStore(ls, KEY).cards, {});
  const s = D.loadStore(ls, KEY); s.cards["x"] = [1, 1, 1, 1, 1, 0]; D.saveStore(ls, s, KEY);
  assert.deepEqual(D.loadStore(ls, KEY).cards["x"], [1, 1, 1, 1, 1, 0]);
  assert.equal(ls.m["smd_other_v1"], undefined, "nothing written outside the key");
  assert.deepEqual(D.loadStore(ls, "smd_other_v1").cards, {}, "another host's key starts empty");
});

test("a store saved before trials existed loads with an empty trial list and keeps its cards", () => {
  const ls = mem({ [KEY]: JSON.stringify({ v: 1, cards: { "ctg.mbbs:a": [1, 2, 3, 4] }, conf: {}, days: {} }) });
  const s = D.loadStore(ls, KEY);
  assert.deepEqual(s.trials, {});
  assert.deepEqual(s.learn, {});
  assert.ok(s.cards["ctg.mbbs:a"]);
  D.useTrial(s, "drill.pph", 5); D.saveStore(ls, s, KEY);
  assert.equal(D.loadStore(ls, KEY).trials["drill.pph"], 5);
});

/* ---------- Learn (learn.test) ---------- */
test("D.t: asked language, English fallback, strings pass through", () => {
  assert.equal(D.t({ en: "Uterus", hi: "गर्भाशय" }, "hi"), "गर्भाशय");
  assert.equal(D.t({ en: "Uterus", hi: "गर्भाशय" }, "en"), "Uterus");
  assert.equal(D.t({ en: "Uterus" }, "hi"), "Uterus");
  assert.equal(D.t({ en: "Uterus", hi: "" }, "hi"), "Uterus");
  assert.equal(D.t("plain", "hi"), "plain");
  assert.equal(D.t(null, "en"), "");
});

test("glossary links: [[id]] and [[id|shown]] split into text and term parts", () => {
  assert.deepEqual(D.glossParts("Tiny [[fx-term|terms]] and [[fx-other]]."), [
    { text: "Tiny " }, { term: "fx-term", shown: "terms" }, { text: " and " }, { term: "fx-other" }, { text: "." }]);
  assert.deepEqual(D.glossParts("no links"), [{ text: "no links" }]);
  assert.deepEqual(D.glossParts("[[fx-term]]"), [{ term: "fx-term" }]);
  assert.deepEqual(D.glossParts("[[Bad Id]] stays text"), [{ text: "[[Bad Id]] stays text" }]);
});

test("every fixture lesson validates against the glossary and the image library", () => {
  const files = fs.readdirSync(new URL("learn/lessons/", FX)).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const l = read("learn/lessons/" + f);
    assert.deepEqual(D.validateLesson(l, gloss, media), [], f);
    assert.equal(l.id + ".json", f);
  }
});

test("see.more: unknown or badly named media ids are reported", () => {
  const l = read("learn/lessons/fx-one.json");
  l.see.more = ["fx-pic", "no-such-picture", "Bad Id"];
  assert.deepEqual(D.validateLesson(l, gloss, media), ["see.more[1]: unknown media no-such-picture", "see.more[2]: a media id"]);
  l.see.more = "fx-pic";
  assert.match(D.validateLesson(l, gloss, media).join(), /see\.more: needs a list/);
});

test("media credit: linked licence for CC items; MAIKNOWLEDGE LLP for originals", () => {
  assert.deepEqual(D.mediaCredit(media["fx-pic"]), { by: "", licence: "Original, MAIKNOWLEDGE LLP", licenceUrl: "", source: "", adapted: false });
  assert.deepEqual(D.mediaCredit({ licence: "CC BY-SA 4.0", author: "A", source: "https://commons.wikimedia.org/x", changes: "cropped" }),
    { by: "A", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/", source: "https://commons.wikimedia.org/x", adapted: true });
  assert.equal(D.mediaCredit({ licence: "CC BY 4.0" }).licenceUrl, "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(D.mediaCredit({ licence: "CC0" }).licenceUrl, "https://creativecommons.org/publicdomain/zero/1.0/");
  assert.equal(D.mediaCredit(null), null);
});

test("scopeSvg: two inline copies share no id, class or keyframe name, and no rule reaches outside", () => {
  const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img"><title>t</title><style>.dot{animation:pulse 1s infinite}@keyframes pulse{to{opacity:.2}}' +
    '@media (prefers-reduced-motion: reduce){*{animation:none!important}}</style><defs><linearGradient id="g"/></defs><circle class="dot" id="c" fill="url(#g)"/><use href="#c"/></svg>';
  const a = D.scopeSvg(src, "lnm1"), b = D.scopeSvg(src, "lnm2");
  const ids = (s) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids(a), ["lnm1-g", "lnm1-c"]);
  assert.deepEqual(ids(a).filter((x) => ids(b).includes(x)), []);
  assert.match(a, /url\(#lnm1-g\)/); assert.match(a, /href="#lnm1-c"/);
  assert.match(a, /class="lnm1-dot"/);
  assert.match(a, /@keyframes lnm1-pulse/); assert.match(a, /animation:lnm1-pulse 1s infinite/);
  assert.match(a, /@media \(prefers-reduced-motion: reduce\)\{\.lnm1 \*\{animation:none!important\}/);
  assert.match(a, /^<svg[^>]*class="lnm1"[^>]*aria-hidden="true"/);
  assert.ok(!/<title>|role="img"/.test(a));
  assert.equal(D.scopeSvg('<svg id="x"><script>alert(1)</script><g onclick="x()" class="a b"/></svg>', "p"), '<svg id="p-x" class="p" aria-hidden="true" focusable="false"><g class="p-a p-b"/></svg>');
});

test("validator rejects a broken lesson with a reason per field", () => {
  const bad = read("learn/lessons/fx-one.json");
  bad.level = "intern"; bad.title = { hi: "only hindi" }; bad.see.hotspots[0].x = 1.4;
  bad.check[0].a = 9; bad.check.push({ q: { en: "q" }, why: { en: "w" }, o: [{ en: "one" }], a: 0 }); delete bad.test.mcqTopic;
  bad.idea.en = "Links an [[unknown-term]]"; delete bad.see.w;
  const e = D.validateLesson(bad, gloss).join("\n");
  for (const m of [/level/, /title/, /hotspots\[0\]/, /check\[0\]\.a/, /check\[1\]\.o/, /test: needs clinic or mcqTopic/, /unknown glossary term unknown-term/, /see\.w, see\.h/])
    assert.match(e, m);
  assert.deepEqual(D.validateLesson(null), ["lesson: not an object"]);
  assert.ok(D.validateIndex({ v: 1, units: [{ id: "x", level: "phd", lessons: [] }] }).length > 0);
  const u = [{ id: "x", level: "mbbs", title: { en: "X" }, lessons: ["a"] }];
  assert.deepEqual(D.validateIndex({ v: 1, units: u }), ["lessons.a: missing summary"]);
  assert.deepEqual(D.validateIndex({ v: 1, units: u, lessons: { a: { title: { en: "A" }, minutes: 4, see: { diagram: "d.svg" } } } }), []);
  assert.deepEqual(D.validateIndex({ v: 1, units: [] }), [], "an empty index is valid: no lessons yet");
});

test("progress: finishing a lesson marks it done once and makes one Good FSRS card under deck key learn", () => {
  const s = D.loadStore(mem(), KEY);
  assert.deepEqual(s.learn, {}, "old stores gain learn: {}");
  assert.equal(D.finishLesson(s, "fx-one", 100), true);
  assert.deepEqual(s.learn["fx-one"], { done: true, day: 100 });
  const c = s.cards[C.key("learn", "fx-one")];
  assert.ok(c);
  assert.equal(c[3], 100 + C.intervalDays(C.nextState(null, 0, C.GOOD).s));
  assert.equal(D.finishLesson(s, "fx-one", 101), false, "second finish changes nothing");
  assert.equal(s.cards[C.key("learn", "fx-one")][4], 1);
  assert.deepEqual(D.learnDue(s, 100), []);
  assert.deepEqual(D.learnDue(s, c[3]), ["fx-one"]);
  C.review(s, "learn", "fx-one", C.AGAIN, c[3]);
  assert.deepEqual(D.learnDue(s, c[3] + 1), ["fx-one"]);
});

test("next lesson: MBBS units first, then Resident; null when every lesson is done or none exist", () => {
  const ix = { v: 1, units: [
    { id: "r", level: "resident", title: { en: "R" }, lessons: ["r1"] },
    { id: "m1", level: "mbbs", title: { en: "M1" }, lessons: ["a", "b"] },
    { id: "m2", level: "mbbs", title: { en: "M2" }, lessons: ["c"] }] };
  const s = D.loadStore(mem(), KEY);
  assert.deepEqual(D.nextLesson(ix, s), { id: "a", level: "mbbs" });
  D.finishLesson(s, "a", 1);
  assert.deepEqual(D.nextLesson(ix, s), { id: "b", level: "mbbs" });
  D.finishLesson(s, "b", 1); D.finishLesson(s, "c", 1);
  assert.deepEqual(D.nextLesson(ix, s), { id: "r1", level: "resident" });
  D.finishLesson(s, "r1", 2);
  assert.equal(D.nextLesson(ix, s), null);
  assert.equal(D.nextLesson({ v: 1, units: [] }, s), null);
  assert.equal(D.nextLesson(null, s), null, "no index loaded");
});

test("prefs: first run until a tab is chosen; MBBS and English by default; bad values are dropped", () => {
  const ls = mem();
  const p = D.loadPrefs(ls, PKEY);
  assert.deepEqual(p, { level: "mbbs", lang: "en" });
  assert.equal(D.firstRun(p), true);
  D.savePrefs(ls, { level: "resident", tab: "learn", lang: "hi" }, PKEY);
  const q = D.loadPrefs(ls, PKEY);
  assert.deepEqual(q, { level: "resident", tab: "learn", lang: "hi" });
  assert.equal(D.firstRun(q), false);
  D.savePrefs(ls, { level: "x", tab: "stats", lang: "fr" }, PKEY);
  assert.deepEqual(D.loadPrefs(ls, PKEY), { level: "mbbs", lang: "en" });
  D.savePrefs(ls, { level: "resident" }, PKEY);
  assert.equal(D.firstRun(D.loadPrefs(ls, PKEY)), true, "an install from before the tabs sees the first run once");
});

test("today() computes a stable local day number; dueOn counts cards due by a day under a prefix", () => {
  assert.equal(D.today(Date.UTC(2026, 8, 29, 6, 0)), D.today(Date.UTC(2026, 8, 29, 6, 0) + 3600000));
  const s = C.emptyStore();
  C.review(s, "ctg.mbbs", "a", C.AGAIN, 10); C.review(s, "ctg.resident", "b", C.AGAIN, 10);
  assert.equal(D.dueOn(s, "ctg.mbbs:", 11), 1);
  assert.equal(D.dueOn(s, "ctg.mbbs:", 10), 0);
});
