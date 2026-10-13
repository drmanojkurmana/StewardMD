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
  assert.deepEqual(ls[0], { k: "kb", id: "fibromuscular_dysplasia", title: "Fibromuscular dysplasia", c: 92, v: "k", sec: "causes" });
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
  assert.match(h, /Know more/);
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
  assert.match(h, /Lesson: Liver Masses/);
  assert.match(h, /data-act="l-open" data-s="s" data-m="m1" data-l="c9" data-step="2"/);
  assert.ok(!/data-l="m1" data-step/.test(h), "no step, no attribute");
  const fb = R.slotHtml({ lesson: { key: "m1" }, sid: "s", mid: "m1" });
  assert.match(fb, /data-act="l-open" data-s="s" data-m="m1" data-l="m1"/);
  assert.match(fb, /Revise this topic/, "the untitled fallback keeps its plain row");
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
      if (u.endsWith("/v2/links/index.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(ptr) });
      const m = /\/v2\/links\/(m\/[^/]+\.json)$/.exec(u);
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
  assert.match(s1.innerHTML, /Know more/, "index links render");
  assert.match(s1.innerHTML, /Fibromuscular [Dd]ysplasia/);
  assert.match(s1.innerHTML, /Related questions/);
  assert.match(s5.innerHTML, /Zika [Vv]irus/);
  assert.match(s3.innerHTML, /data-act="r-practise" data-i="fx-reason-3"/, "practise keeps the slot's item");
});

test("kmSlot: old items get slot, reasoning items return empty, no duplicate", () => {
  assert.equal(R.has(byId["fx-reason-old1"]), false, "old1 is not reasoning");
  assert.equal(R.has(byId["fx-reason-old2"]), false, "old2 is not reasoning");
  assert.equal(R.has(byId["fx-reason-1"]), true, "reason-1 is reasoning");

  const sOld1 = R.kmSlot(byId["fx-reason-old1"]);
  assert.match(sOld1, /class="pn-km"/);
  assert.match(sOld1, /data-i="fx-reason-old1"/);
  assert.match(sOld1, /data-m="ana-gametogenesis"/);

  const sOld2 = R.kmSlot(byId["fx-reason-old2"]);
  assert.match(sOld2, /class="pn-km"/);
  assert.match(sOld2, /data-i="fx-reason-old2"/);
  assert.match(sOld2, /data-m="ana-placenta"/);

  const sReason = R.kmSlot(byId["fx-reason-1"]);
  assert.equal(sReason, "", "reasoning item gets empty string (no duplicate row)");
  assert.equal(R.kmSlot(null), "");
});

test("knowMoreHtml: exactly 1 target shows the Know more header and one direct button", () => {
  const hKb = R.knowMoreHtml({ targets: [{ k: "kb", id: "heart_failure", title: "Heart failure", act: "r-kb", attrs: ' data-id="heart_failure"' }] });
  assert.match(hKb, /<h3 class="pn-km-h">Know more<\/h3>/, "header shows with a single target");
  assert.match(hKb, /class="pn-km-row"/);
  assert.doesNotMatch(hKb, /pn-km-duo/);
  assert.match(hKb, /<b>Knowledge Library: Heart failure<\/b>/);
  assert.match(hKb, /data-act="r-kb" data-id="heart_failure"/);
  assert.equal((hKb.match(/<button /g) || []).length, 1);

  const hLsTopic = R.knowMoreHtml({ targets: [{ k: "ls", key: "hf", title: "Heart failure", tier: "topic", act: "l-open", attrs: ' data-s="medicine" data-m="med-heart-failure" data-l="hf"' }] });
  assert.match(hLsTopic, /<h3 class="pn-km-h">Know more<\/h3>/);
  assert.match(hLsTopic, /<b>Lesson: Heart failure<\/b>/);

  const hLsSpec = R.knowMoreHtml({ targets: [{ k: "ls", key: "hf_echo", title: "Echo in HF", tier: "specific", act: "l-open", attrs: ' data-s="medicine" data-m="med-heart-failure" data-l="hf_echo"' }] });
  assert.match(hLsSpec, /<b>Lesson: Echo in HF<\/b>/);

  const hDr = R.knowMoreHtml({ targets: [{ k: "dr", id: "furosemide", title: "furosemide", act: "r-drug", attrs: ' data-t="furosemide"' }] });
  assert.match(hDr, /<h3 class="pn-km-h">Know more<\/h3>/);
  assert.match(hDr, /<b>Drug: furosemide<\/b>/);

  const hPr = R.knowMoreHtml({ targets: [{ k: "pr", id: "hf_guideline", title: "Acute HF Management", act: "r-proto", attrs: ' data-id="hf_guideline"' }] });
  assert.match(hPr, /<b>Protocol: Acute HF Management<\/b>/);

  const hCd = R.knowMoreHtml({ targets: [{ k: "cd", mid: "med-heart-failure", title: "Cards for this topic", act: "k-open", attrs: ' data-s="medicine" data-m="med-heart-failure"' }] });
  assert.match(hCd, /<b>Flashcards: Cards for this topic<\/b>/);
  assert.equal(R.knowMoreHtml({ targets: [] }), "");
});

test("knowMoreHtml: 2 targets render side-by-side duo buttons under the header", () => {
  const targets = [
    { k: "kb", id: "heart_failure", title: "Heart failure", act: "r-kb", attrs: ' data-id="heart_failure"' },
    { k: "ls", key: "hf", title: "Heart failure", tier: "topic", act: "l-open", attrs: ' data-s="medicine" data-m="med-heart-failure" data-l="hf"' }
  ];
  const hDuo = R.knowMoreHtml({ targets });
  assert.match(hDuo, /<h3 class="pn-km-h">Know more<\/h3>/);
  assert.match(hDuo, /class="pn-km-row pn-km-duo"/);
  assert.match(hDuo, /Knowledge Library: Heart failure/);
  assert.match(hDuo, /Lesson: Heart failure/);
  assert.equal((hDuo.match(/<button /g) || []).length, 2, "exactly two buttons");
  assert.doesNotMatch(hDuo, /pn-km-more/, "two targets need no More button");

  const targetsSame = [
    { k: "kb", id: "hf", title: "Heart failure", act: "r-kb", attrs: ' data-id="hf"' },
    { k: "kb", id: "cardiomyopathy", title: "Cardiomyopathy", act: "r-kb", attrs: ' data-id="cardiomyopathy"' }
  ];
  const hSame = R.knowMoreHtml({ targets: targetsSame, allTargets: targetsSame, iid: "item2" });
  assert.match(hSame, /class="pn-km-row pn-km-duo"/, "two of one kind still sit side by side");
  assert.equal((hSame.match(/<button /g) || []).length, 2);
});

test("kmTargets: the Nucleus360 floor fires only when nothing else exists", () => {
  const n360 = { id: "pancreatic-adenocarcinoma", title: "Pancreatic adenocarcinoma" };
  const lone = R.kmTargets({ links: [], okLessons: [], lesson: null, cards: false, itemCards: false, sid: "surgery", mid: "sur-pancreas", n360 });
  assert.equal(lone.rowTargets.length, 1, "one floor target");
  assert.deepEqual([lone.rowTargets[0].k, lone.rowTargets[0].act], ["n360", "n360-topic"]);
  assert.match(lone.rowTargets[0].attrs, /data-t="pancreatic-adenocarcinoma"/);
  assert.equal(R.kmKindLabel(lone.rowTargets[0]), "Nucleus360");
  assert.equal(R.kmTargetLabel(lone.rowTargets[0]), "Cover this topic with Nucleus360");
  const hFloor = R.knowMoreHtml({ targets: lone.rowTargets });
  assert.match(hFloor, /data-act="n360-topic"/);
  assert.match(hFloor, /Cover this topic with Nucleus360/);
  const withKb = R.kmTargets({ links: [{ k: "kb", id: "x", title: "X" }], okLessons: [], lesson: null, cards: false, itemCards: false, sid: "s", mid: "m", n360 });
  assert.ok(withKb.rowTargets.every((t) => t.k !== "n360"), "real targets suppress the floor");
  const bare = R.kmTargets({ links: [], okLessons: [], lesson: null, cards: false, itemCards: false, sid: "s", mid: "m" });
  assert.deepEqual(bare.rowTargets, [], "no floor without a mapped walkthrough");
});

test("knowMoreHtml: >2 targets or several of one kind render single Know more button opening sheet", () => {
  // >2 targets
  const targets3 = [
    { k: "kb", id: "heart_failure", title: "Heart failure", act: "r-kb", attrs: ' data-id="heart_failure"' },
    { k: "ls", key: "hf", title: "Heart failure", tier: "topic", act: "l-open", attrs: ' data-s="medicine" data-m="med-heart-failure" data-l="hf"' },
    { k: "dr", id: "furosemide", title: "furosemide", act: "r-drug", attrs: ' data-t="furosemide"' }
  ];
  const h3 = R.knowMoreHtml({ targets: targets3, allTargets: targets3, iid: "item1" });
  assert.match(h3, /<h3 class="pn-km-h">Know more<\/h3>/);
  assert.match(h3, /class="pn-km-row pn-km-duo"/, "the top two stay visible");
  assert.match(h3, /Knowledge Library: Heart failure/);
  assert.match(h3, /Lesson: Heart failure/);
  assert.doesNotMatch(h3, /Drug: furosemide/, "the third target lives in the sheet");
  assert.match(h3, /class="pn-km-btn pn-km-more"/);
  assert.match(h3, /data-act="r-km-sheet"/);
  assert.match(h3, /data-i="item1"/);
  assert.match(h3, /<b>More \(3\)<\/b>/);
  assert.equal((h3.match(/<button /g) || []).length, 3, "two direct buttons plus More");
});

test("knowMoreSheetBodyHtml: groups all targets in kind order with module chapter first", () => {
  const allTargets = [
    { k: "dr", id: "furosemide", title: "Furosemide", act: "r-drug", attrs: ' data-t="furosemide"' },
    { k: "ls", key: "hf_echo", title: "Echo in HF", tier: "specific", act: "l-open", attrs: ' data-l="hf_echo"' },
    { k: "ls", key: "hf", title: "Heart failure chapter", tier: "topic", act: "l-open", attrs: ' data-l="hf"' },
    { k: "kb", id: "heart_failure", title: "Heart failure", act: "r-kb", attrs: ' data-id="heart_failure"' },
    { k: "pr", id: "hf_proto", title: "Acute HF", act: "r-proto", attrs: ' data-id="hf_proto"' },
    { k: "cd", mid: "med-heart-failure", title: "Cards for this topic", act: "k-open", attrs: ' data-m="med-heart-failure"' }
  ];
  const body = R.knowMoreSheetBodyHtml({ allTargets });
  const at = (s) => { const idx = body.indexOf(s); assert.ok(idx >= 0, "has " + s); return idx; };
  // Check group order: Knowledge Library < Lessons < Drugs < Protocols < Flashcards
  assert.ok(at("Knowledge Library") < at("Lessons") && at("Lessons") < at("Drugs") &&
    at("Drugs") < at("Protocols") && at("Protocols") < at("Flashcards"), "kind order preserved");

  // Check lesson ordering: topic tier before specific tier
  assert.ok(at("Lesson: Heart failure chapter") < at("Lesson: Echo in HF"), "topic chapter comes before specific lesson");
});

test("fill: old item with links resolves .pn-km, offline caching works, low confidence hidden, no links hidden", async () => {
  const src = fs.readFileSync(join(ROOT, "prep-reason.js"), "utf8");
  const ptr = JSON.parse(fs.readFileSync(join(FIX, "api", "v1", "links", "index.json"), "utf8"));
  const shards = {};
  for (const f of fs.readdirSync(join(FIX, "api", "v1", "links", "m")))
    shards[f] = JSON.parse(fs.readFileSync(join(FIX, "api", "v1", "links", "m", f), "utf8"));

  const testShard = {
    v: 1, m: "med-test-mod", s: "medicine", ver: "fix",
    T: [
      ["kb", "target_high", "High confidence target"],
      ["kb", "target_low", "Low confidence target"]
    ],
    e: {
      "old-with-links": [[0, 85, "k"]],
      "old-low-only": [[1, 60, "k"]],
      "old-empty": []
    },
    x: {}, mod: {}
  };
  ptr.m["med-test-mod"] = "medicine/12345678";
  shards["med-test-mod-12345678.json"] = testShard;

  let networkDown = false;
  const G = {
    fetch: (url) => {
      if (networkDown) return Promise.reject(new Error("Network offline"));
      const u = String(url);
      if (u.endsWith("/v2/links/index.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(ptr) });
      const m = /\/v2\/links\/(m\/[^/]+\.json)$/.exec(u);
      const sh = m && shards[m[1].slice(2)];
      return Promise.resolve(sh ? { ok: true, json: () => Promise.resolve(sh) } : { ok: false, status: 404 });
    },
  };
  new Function("window", src)(G);
  const PR = G.PREP_REASON;

  const makeSlot = (iid, mid) => {
    const attrs = { "data-i": iid, "data-s": "medicine", "data-m": mid, class: "pn-km" };
    const styleObj = { display: "" };
    return {
      className: "pn-km",
      style: styleObj,
      getAttribute: (k) => attrs[k] || null,
      setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; },
      innerHTML: ""
    };
  };

  const sLinked = makeSlot("old-with-links", "med-test-mod");
  const sLow = makeSlot("old-low-only", "med-test-mod");
  const sNoLink = makeSlot("old-empty", "med-test-mod");

  const byIid = { "old-with-links": sLinked, "old-low-only": sLow, "old-empty": sNoLink };
  const root = {
    querySelectorAll: () => [sLinked, sLow, sNoLink],
    querySelector: (sel) => { const m = /data-i="([^"]+)"/.exec(sel); return (m && byIid[m[1]]) || null; }
  };

  const cache = new Map();
  const H = {
    root: () => root,
    run_: () => ({ items: [
      { id: "old-with-links", q: "Question 1", a: 0, o: ["a", "b"], exp: "Plain exp", _s: "medicine", _m: "med-test-mod" },
      { id: "old-low-only", q: "Question 2", a: 0, o: ["a", "b"], exp: "Plain exp", _s: "medicine", _m: "med-test-mod" },
      { id: "old-empty", q: "Question 3", a: 0, o: ["a", "b"], exp: "Plain exp", _s: "medicine", _m: "med-test-mod" }
    ] }),
    subjectOfModule: () => "medicine",
    bankApi: "https://x/api/prep/bank/",
    cacheGet: (k) => (cache.has(k) ? cache.get(k) : null),
    cachePut: (k, v) => { cache.set(k, v); }
  };

  PR.fill(H);
  for (let i = 0; i < 200 && [sLinked, sLow, sNoLink].some((s) => s.getAttribute("data-done") !== "1"); i++)
    await new Promise((r) => setTimeout(r, 10));

  assert.equal(sLinked.getAttribute("data-done"), "1");
  assert.equal(sLinked.style.display, "");
  assert.match(sLinked.innerHTML, /High confidence target/, "high confidence target rendered");
  assert.doesNotMatch(sLinked.innerHTML, /Low confidence target/);

  // Low confidence (< 75): excluded, so row is hidden
  assert.equal(sLow.getAttribute("data-done"), "1");
  assert.equal(sLow.style.display, "none", "low confidence slot is hidden");
  assert.equal(sLow.innerHTML, "");

  // No links: hidden and quiet, no placeholder
  assert.equal(sNoLink.getAttribute("data-done"), "1");
  assert.equal(sNoLink.style.display, "none", "unlinked item slot is hidden");
  assert.equal(sNoLink.innerHTML, "");

  // Test offline caching: now kill the network, fill another slot from cache
  networkDown = true;
  assert.ok(cache.has("v2/links/index.json"), "index was cached");
  assert.ok(cache.has("v2/links/m/med-test-mod-12345678.json"), "shard was cached");

  const sOffline = makeSlot("old-with-links", "med-test-mod");
  root.querySelectorAll = () => [sOffline];
  root.querySelector = (sel) => (/data-i="old-with-links"/.test(sel) ? sOffline : null);

  // Clear memory cache so it must read from H.cacheGet
  PR._r.ptr = null;
  PR.fill(H);
  for (let i = 0; i < 200 && sOffline.getAttribute("data-done") !== "1"; i++)
    await new Promise((r) => setTimeout(r, 10));

  assert.equal(sOffline.getAttribute("data-done"), "1", "offline slot resolved from cacheGet");
  assert.match(sOffline.innerHTML, /High confidence target/, "cached content rendered while offline");
});


test("titleRelevant: SGLT2 namesake fails, the module topic passes (owner screenshot 2026-10-13)", () => {
  const hay = "A 62-year-old woman with heart failure with reduced ejection fraction LVEF 30% on ARNI and bisoprolol non-diabetic which additional drug class reduces death SGLT2 inhibitor (dapagliflozin) med-heart-failure heart failure";
  assert.equal(R.titleRelevant("Familial Renal Glucosuria", hay), false);
  assert.equal(R.titleRelevant("Heart failure", hay), true);
  assert.equal(R.titleRelevant("Dapagliflozin", hay), true);
});

test("shardLinks keeps via so the module topic (kt) can lead the next action", () => {
  const sh = { T: [["kb", "renal_glucosuria", "Familial Renal Glucosuria"], ["kb", "heart_failure", "Heart failure"]], e: { i1: [[0, 95, "a"], [1, 75, "kt"]] } };
  const ls = R.shardLinks ? R.shardLinks(sh, "i1") : null;
  if (ls) { assert.equal(ls.find((l) => l.id === "heart_failure").v, "kt"); }
});
