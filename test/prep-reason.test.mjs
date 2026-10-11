// PrepNucleus reasoning explanations (prep-reason.js): the layout switch, pipeline links, next-action choice,
// index shards, the feedback body order, the Learn-more/next/related slot, and degradation to the old UI.
// Fixtures: test/fixtures/prep-reason/items.json (all synthetic).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
const R = req(join(ROOT, "prep-reason.js"));
const P = req(join(ROOT, "prep.js"));
const FIX = join(ROOT, "test", "fixtures", "prep-reason");
const ITEMS = JSON.parse(fs.readFileSync(join(FIX, "items.json"), "utf8")).items;
const byId = Object.fromEntries(ITEMS.map((x) => [x.id, x]));
const md = (s) => P.mdLite(s), inl = (s) => P.inlineMd(s);
const rsOf = (it) => P.explainOf(it).r;

test("has: each new field opts in; old items and junk stay out", () => {
  for (const k of ["clues", "ddx", "mechanism", "mech", "lo", "rev", "next"]) assert.equal(R.hasX({ [k]: "x" }), true, k);
  assert.equal(R.hasX({ refs: ["a"] }), true, "refs");
  assert.equal(R.hasX({ references: ["a"] }), true, "references");
  assert.equal(R.hasX({ links: { kb: ["zika_virus"] } }), true, "links");
  assert.equal(R.hasX({ kb: "zika_virus" }), true, "flat kb");
  assert.equal(R.hasX({ key: "k", notes: "n", others: {}, pearl: "p" }), false, "old x");
  assert.equal(R.has(byId["fx-reason-old1"]), false, "exp-only fixture");
  assert.equal(R.has(byId["fx-reason-old2"]), false, "old-x fixture");
  for (const it of ITEMS.slice(0, 6)) assert.equal(R.has(it), true, it.id + " opts in");
  assert.equal(R.has(null), false);
  assert.equal(R.has({ x: "junk" }), false);
  assert.equal(R.hasX({ clues: "  " }), false, "blank is not content");
});

test("linksOf: pipeline shapes, flat ids, dedupe", () => {
  assert.deepEqual(R.linksOf({ links: { kb: ["a"], kb_ids: ["b"], drug_ids: ["c"], proto: ["d"], lesson_ids: ["e"], card: ["f"] } }),
    [{ k: "kb", id: "b" }, { k: "kb", id: "a" }, { k: "dr", id: "c" }, { k: "pr", id: "d" }, { k: "ls", id: "e" }, { k: "cd", id: "f" }]);
  assert.deepEqual(R.linksOf({ kb: "zika_virus", drug: "metformin", protocol: "p", lesson: "l", card: "c" }).map((l) => l.k),
    ["kb", "dr", "pr", "ls", "cd"]);
  assert.deepEqual(R.linksOf({ kb: "A", links: { kb: ["a", "b"] } }), [{ k: "kb", id: "a" }, { k: "kb", id: "b" }], "case-insensitive dedupe, links first");
  assert.deepEqual(R.linksOf({ links: { drug: "metformin" } }), [{ k: "dr", id: "metformin" }], "a bare string is one id");
  assert.deepEqual(R.linksOf(null), []);
  assert.deepEqual(R.linksOf({ links: { kb: ["", null, 7] } }), [], "junk ids dropped");
});

test("pref + nextAction: preference first, then review/revise/practise/plan, never a missing target", () => {
  assert.equal(R.pref("review"), "review"); assert.equal(R.pref("kb"), "review"); assert.equal(R.pref("lesson"), "revise");
  assert.equal(R.pref("cards"), "revise"); assert.equal(R.pref("practise"), "practise"); assert.equal(R.pref("practice"), "practise");
  assert.equal(R.pref("plan"), "plan"); assert.equal(R.pref("schedule"), "plan"); assert.equal(R.pref("nonsense"), "");
  assert.equal(R.pref(null), "");
  const full = { kb: 2, lesson: 1, related: 3, plan: 1 };
  assert.equal(R.nextAction("", full), "review");
  assert.equal(R.nextAction("plan", full), "plan", "a stated preference wins when its target exists");
  assert.equal(R.nextAction("review", { lesson: 1, plan: 1 }), "revise", "a preference with no target falls through");
  assert.equal(R.nextAction("", { related: 2, plan: 1 }), "practise");
  assert.equal(R.nextAction("", { plan: 1 }), "plan");
  assert.equal(R.nextAction("", {}), null);
  assert.equal(R.nextAction("", { kb: 0, lesson: 0, related: 0, plan: 0 }), null);
  assert.equal(R.nextLabel("review"), "Review the concept");
  assert.equal(R.nextLabel("revise"), "Revise this topic");
  assert.equal(R.nextLabel("practise"), "Practise related questions");
  assert.equal(R.nextLabel("plan"), "Schedule revision");
});

test("shardLinks: the 75 floor, strongest first; relOf: union across targets, 8 at most", () => {
  const sh = JSON.parse(fs.readFileSync(join(FIX, "api", "v1", "links", "m", fs.readdirSync(join(FIX, "api", "v1", "links", "m")).find((f) => f.startsWith("ana-gametogenesis-"))), "utf8"));
  const ls = R.shardLinks(sh, "fx-reason-1");
  assert.equal(ls.length, 1);
  assert.deepEqual(ls[0], { k: "kb", id: "fibromuscular_dysplasia", title: "Fibromuscular dysplasia", c: 92, sec: "causes" });
  assert.deepEqual(R.shardLinks(sh, "fx-reason-old1"), [], "an unlinked item has no links");
  assert.deepEqual(R.shardLinks({ T: [["kb", "a", "A"]], e: { i: [[0, 74, "s"]] } }, "i"), [], "74 is not shown");
  assert.deepEqual(R.shardLinks(null, "i"), []);
  assert.deepEqual(R.relOf(sh, "fx-reason-1"), [["ana-brachial-plexus", "fx-rel-1"]]);
  const big = { T: [["kb", "a", "A"], ["kb", "b", "B"]], e: { i: [[0, 90, "k"], [1, 90, "k"]] },
    x: { 0: [["m", "1"], ["m", "2"], ["m", "3"], ["m", "4"], ["m", "5"]], 1: [["m", "5"], ["m", "6"], ["m", "7"], ["m", "8"], ["m", "9"]] } };
  assert.equal(R.relOf(big, "i").length, 8, "deduped and capped");
  assert.deepEqual(R.relOf({ T: [], e: {}, x: {} }, "i"), []);
});

test("mergeLinks: pipeline links first, one row per target", () => {
  const pipe = [{ k: "kb", id: "a", title: "A", c: 95 }];
  const ix = [{ k: "kb", id: "a", title: "A", c: 92 }, { k: "dr", id: "b", title: "B", c: 80 }];
  assert.deepEqual(R.mergeLinks(pipe, ix), [pipe[0], ix[1]]);
});

test("body: sections in order, the pick open first, Exam pearl, revision, refs, slot", () => {
  const it = byId["fx-reason-1"], rs = rsOf(it);
  const h = R.body(it, { why: "<WHY>", pearl: it.x.pearl, rs, chosen: 0, md, inl });
  const at = (s) => { const i = h.indexOf(s); assert.ok(i >= 0, "has " + s); return i; };
  assert.ok(at("Learning objective") < at("Key clues") && at("Key clues") < at("Differential") && at("Differential") < at("Mechanism") &&
    at("Mechanism") < at("<WHY>") && at("<WHY>") < at("Why the others are wrong") && at("Why the others are wrong") < at("Exam pearl") &&
    at("Exam pearl") < at("Revision summary") && at("Revision summary") < at("References") && at("References") < at("pn-rx"));
  assert.match(h, /<aside class="pn-kp" aria-label="Exam pearl"><b>Exam pearl<\/b>/);
  const dets = h.match(/<details class="pn-ro"[^>]*>/g) || [];
  assert.equal(dets.length, 3);
  assert.equal(dets.filter((d) => /open/.test(d)).length, 1, "only one row open");
  assert.ok(h.indexOf("<details") < h.indexOf("Your pick"), "the pick's row comes first");
  assert.match(h, /<span class="pn-l">A<\/span>.*Your pick/s);
  assert.match(h, /data-i="fx-reason-1" data-s="" data-m="ana-gametogenesis"/);
  const evil = R.body({ ...it, x: { ...it.x, clues: "<script>alert(1)</script> **bold**" } }, { why: "", pearl: "", rs: null, chosen: -1, md, inl });
  assert.doesNotMatch(evil, /<script>/);
  assert.match(evil, /&lt;script&gt;.*<b>bold<\/b>/);
  const mech = R.body({ ...it, x: { mech: "m", key: "k" } }, { why: "", pearl: "", rs: null, chosen: -1, md, inl });
  assert.match(mech, /Mechanism/);
  const right = R.body(it, { why: "", pearl: "", rs, chosen: 1, md, inl });
  assert.ok(!(right.match(/<details class="pn-ro" open>/) || []).length, "nobody open when the pick was right");
});

test("slotHtml: Learn more rows, the one action per kind, related rows, empty when nothing exists", () => {
  const d = { links: [{ k: "kb", id: "zika_virus", title: "Zika virus" }, { k: "dr", id: "metformin", title: "Metformin" }, { k: "pr", id: "p", title: "P" }],
    lesson: { key: "ana-placenta" }, cards: true, related: [{ mid: "m", id: "q", stem: "Why is the sky blue?" }],
    next: { kind: "review", label: "Review the concept", id: "zika_virus", target: "Zika virus" }, sid: "anatomy", mid: "ana-placenta" };
  const h = R.slotHtml(d);
  assert.match(h, /Learn more/);
  assert.match(h, /data-act="r-kb" data-id="zika_virus"/);
  assert.match(h, /data-act="r-drug" data-t="Metformin"/);
  assert.match(h, /data-act="r-proto" data-id="p"/);
  assert.match(h, /data-act="l-open" data-s="anatomy" data-m="ana-placenta" data-l="ana-placenta"/);
  assert.match(h, /data-act="k-open" data-s="anatomy" data-m="ana-placenta"/);
  assert.match(h, /data-act="r-kb" data-id="zika_virus"><b>Review the concept<\/b><small>Zika virus<\/small>/);
  assert.match(h, /Related questions/);
  assert.match(h, /data-act="r-rel" data-m="m" data-id="q"/);
  const revise = R.slotHtml({ ...d, links: [], next: { kind: "revise", label: "Revise this topic", lkey: "ana-placenta", target: "Lesson" } });
  assert.match(revise, /data-act="l-open"[^>]*><b>Revise this topic<\/b>/);
  const cards = R.slotHtml({ lesson: null, cards: true, next: { kind: "revise", label: "Revise this topic", lkey: null, target: "Flashcards" }, sid: "s", mid: "m" });
  assert.match(cards, /data-act="k-open"[^>]*><b>Revise this topic<\/b>/);
  assert.match(R.slotHtml({ next: { kind: "practise", label: "Practise related questions", target: "2 questions" } }), /data-act="r-practise"><b>Practise related questions<\/b>/);
  assert.match(R.slotHtml({ next: { kind: "plan", label: "Schedule revision", target: "Today's plan" } }), /data-act="r-plan"><b>Schedule revision<\/b>/);
  assert.equal(R.slotHtml({}), "");
  assert.equal(R.slotHtml({ links: [], lesson: null, cards: false, related: [], next: null }), "");
});

test("wiring: the loader carries prep-reason.js after prep.js, optional; the CSS scopes and sizes the new rows", () => {
  const loader = fs.readFileSync(join(ROOT, "prep-loader.js"), "utf8");
  const js = /var JS = \[(.*?)\];/.exec(loader)[1];
  assert.ok(js.indexOf('"prep.js"') < js.indexOf('"prep-reason.js"'), "prep-reason.js loads after prep.js");
  assert.match(loader, /"prep-reason\.js": 1/, "optional: without it the old UI shows");
  const prep = fs.readFileSync(join(ROOT, "prep.js"), "utf8");
  assert.match(prep, /indexOf\("r-"\) === 0 && G\.PREP_REASON/, "r-* acts forward");
  assert.match(prep, /RX\.body\(it, \{ why: whyHtml/, "feedback uses the reasoning body");
  const css = fs.readFileSync(join(ROOT, "prep.css"), "utf8");
  const block = css.slice(css.indexOf("Reasoning explanations"));
  for (const s of [".pn-ro", ".pn-rlr", ".pn-rn", ".pn-rqr", ".pn-rref", ".pn-rlo"]) assert.ok(block.includes(s), "styles " + s);
  assert.ok(block.includes("min-height: 44px"), "44px targets");
  assert.ok(!block.match(/#[0-9a-f]{3,}/i), "tokens only, so light and dark follow");
  assert.ok(!block.includes("box-shadow") && !block.includes("glow"), "no glow");
});

test("srcOf: source plus version/via only when a version-ish field exists", () => {
  assert.equal(R.srcOf({ prov: "SMD", x: { links: { ver: "wave-w17@2026-10-11", via: "grounding-tier-1" } } }),
    "Source: StewardMD · wave-w17 · grounding-tier-1");
  assert.equal(R.srcOf({ prov: "SMD", x: { links: { via: "grounding-source" } } }), "Source: StewardMD · grounding-source");
  assert.equal(R.srcOf(byId["fx-reason-1"]), "Source: Licensed bank", "references alone still name the source");
  assert.equal(R.srcOf(byId["fx-reason-old1"]), "", "bare prov stays unshown");
  assert.equal(R.srcOf(byId["fx-reason-old2"]), "", "old x stays unshown");
  assert.equal(R.srcOf({ x: { refs: ["a"] } }), "", "no prov, no line");
  assert.equal(R.srcOf(null), "");
});

test("body: the provenance line sits under references, omitted without version fields", () => {
  const h = R.body(byId["fx-reason-1"], { why: "", pearl: "", rs: null, chosen: -1, md, inl });
  assert.ok(h.indexOf("References") < h.indexOf("pn-src") && h.indexOf("pn-src") < h.indexOf("pn-rx"), "refs, provenance, slot");
  assert.match(h, /<p class="pn-src">Source: Licensed bank<\/p>/);
  const bare = R.body({ ...byId["fx-reason-1"], prov: "LIC", x: { ...byId["fx-reason-1"].x, links: {}, refs: [] } },
    { why: "", pearl: "", rs: null, chosen: -1, md, inl });
  assert.doesNotMatch(bare, /pn-src/);
});

test("findRunItem: the run's item by id, null when absent", () => {
  assert.equal(R.findRunItem(ITEMS, "fx-reason-1"), byId["fx-reason-1"]);
  assert.equal(R.findRunItem(ITEMS, "nope"), null);
  assert.equal(R.findRunItem(null, "fx-reason-1"), null);
});

test("slotHtml: the practise action carries the slot's own item", () => {
  const h = R.slotHtml({ next: { kind: "practise", label: "Practise related questions", target: "2 questions" },
    sid: "anatomy", mid: "ana-gametogenesis", iid: "fx-reason-1" });
  assert.match(h, /data-act="r-practise" data-i="fx-reason-1" data-m="ana-gametogenesis"/);
  const bare = R.slotHtml({ next: { kind: "practise", label: "P", target: "1 question" } });
  assert.match(bare, /data-act="r-practise"><b>/, "no item, no attributes");
});

test("lessonLinks: tiers from via, the step rides along, the 75 floor, strongest first", () => {
  const sh = { T: [["ls", "m1", "Liver Masses"], ["ls", "c9", "Adenoma Imaging"], ["kb", "a", "A"]],
    e: { i: [[0, 75, "lt"], [1, 85, "li", "2"], [2, 92, "k"]], j: [[0, 74, "lt"]] } };
  assert.deepEqual(R.lessonLinks(sh, "i"), [
    { key: "c9", title: "Adenoma Imaging", c: 85, tier: "specific", step: "2" },
    { key: "m1", title: "Liver Masses", c: 75, tier: "topic", step: "" },
  ]);
  assert.deepEqual(R.lessonLinks(sh, "j"), [], "74 is not shown");
  assert.deepEqual(R.lessonLinks(sh, "zz"), []);
  assert.deepEqual(R.lessonLinks(null, "i"), []);
});

test("slotHtml: per-item lessons with Read-the-lesson rows and steps, the module fallback stays", () => {
  const lessons = [{ key: "m1", title: "Liver Masses", tier: "topic", step: "" }, { key: "c9", title: "Adenoma Imaging", tier: "specific", step: "2" }];
  const h = R.slotHtml({ lessons, sid: "s", mid: "m1" });
  assert.match(h, /Read the lesson: Liver Masses/);
  assert.match(h, /data-act="l-open" data-s="s" data-m="m1" data-l="c9" data-step="2"/);
  assert.ok(!/data-l="m1" data-step/.test(h), "no step, no attribute");
  const fb = R.slotHtml({ lesson: { key: "m1" }, sid: "s", mid: "m1" });
  assert.match(fb, /data-act="l-open" data-s="s" data-m="m1" data-l="m1"/);
  assert.ok(!/Read the lesson/.test(fb), "the untitled fallback keeps its old row");
  assert.equal(R.slotHtml({ lessons: [], lesson: null }), "");
  const rv = R.slotHtml({ lessons, next: { kind: "revise", label: "Revise this topic", lkey: "c9", step: "2", target: "Lesson" }, sid: "s", mid: "m1" });
  assert.match(rv, /data-act="l-open"[^>]*data-l="c9" data-step="2"><b>Revise this topic<\/b>/);
});

test("fill: every gaps slot resolves by its own data-i without remember()", async () => {
  const src = fs.readFileSync(join(ROOT, "prep-reason.js"), "utf8");
  const ptr = JSON.parse(fs.readFileSync(join(FIX, "api", "v1", "links", "index.json"), "utf8"));
  const shards = {};
  for (const f of fs.readdirSync(join(FIX, "api", "v1", "links", "m")))
    shards[f] = JSON.parse(fs.readFileSync(join(FIX, "api", "v1", "links", "m", f), "utf8"));
  const G = {
    fetch: (url) => {
      const u = String(url);
      if (u.endsWith("/v1/links/index.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(ptr) });
      const m = /\/v1\/links\/(m\/[^/]+\.json)$/.exec(u);
      const sh = m && shards[m[1].slice(2)];
      return Promise.resolve(sh ? { ok: true, json: () => Promise.resolve(sh) } : { ok: false, status: 404 });
    },
  };
  new Function("window", src)(G);
  const PR = G.PREP_REASON;
  assert.ok(PR && PR.fill, "the browser branch loads");
  const slot = (iid, mid) => {
    const attrs = { "data-i": iid, "data-s": "anatomy", "data-m": mid };
    return { getAttribute: (k) => attrs[k] || null,
      setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; }, innerHTML: "" };
  };
  const s1 = slot("fx-reason-1", "ana-gametogenesis"), s5 = slot("fx-reason-5", "ana-gametogenesis"),
    s3 = slot("fx-reason-3", "ana-brachial-plexus");
  const byIid = { "fx-reason-1": s1, "fx-reason-5": s5, "fx-reason-3": s3 };
  const root = { querySelectorAll: () => [s1, s5, s3],
    querySelector: (sel) => { const m = /data-i="([^"]+)"/.exec(sel); return (m && byIid[m[1]]) || null; } };
  const runItems = [{ ...byId["fx-reason-1"], _s: "anatomy", _m: "ana-gametogenesis" },
    { ...byId["fx-reason-5"], _s: "anatomy", _m: "ana-gametogenesis" },
    { ...byId["fx-reason-3"], _s: "anatomy", _m: "ana-brachial-plexus" }];
  const cache = new Map();
  const H = { root: () => root, run_: () => ({ items: runItems }),
    loadModule: (sid, mid) => Promise.resolve(mid === "ana-brachial-plexus"
      ? [{ id: "fx-rel-1", q: "Synthetic related stem one?", o: ["a", "b"], a: 0 },
        { id: "fx-rel-2", q: "Synthetic related stem two?", o: ["a", "b"], a: 1 }]
      : mid === "ana-gametogenesis" ? [{ ...byId["fx-reason-1"] }] : []),
    subjectOfModule: () => "anatomy", bankApi: "https://x/api/prep/bank/",
    cacheGet: (k) => (cache.has(k) ? cache.get(k) : null), cachePut: (k, v) => { cache.set(k, v); } };
  PR.fill(H);
  for (let i = 0; i < 200 && [s1, s5, s3].some((s) => s.getAttribute("data-done") !== "1"); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(s1.getAttribute("data-done"), "1", "first gaps slot fills with no remember()");
  assert.equal(s5.getAttribute("data-done"), "1", "second gaps slot fills with no remember()");
  assert.equal(s3.getAttribute("data-done"), "1", "third gaps slot fills with no remember()");
  assert.match(s1.innerHTML, /Learn more/, "index links render");
  assert.match(s1.innerHTML, /Fibromuscular [Dd]ysplasia/);
  assert.match(s1.innerHTML, /Related questions/);
  assert.match(s5.innerHTML, /Zika [Vv]irus/);
  assert.match(s3.innerHTML, /data-act="r-practise" data-i="fx-reason-3"/, "practise keeps the slot's item");
});
