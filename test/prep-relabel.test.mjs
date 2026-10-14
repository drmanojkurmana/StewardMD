// Know more fallback relabel (owner 2026-10-14 "Relabel"): module/subject-level fallback targets
// render under the plain "Learn this module" label with the module name, in the neutral secondary
// style; evidenced links keep their wording. Unit tests for the tier-to-label rule (isFallback),
// target tagging and ordering (kmTargets), the renderers (knowMoreHtml, slotHtml, sheet) and a
// fill() pass over crafted new-style and legacy shards.
//
// node --test test/prep-relabel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
const R = req(join(ROOT, "prep-reason.js"));

test("isFallback: explicit ev wins; legacy rows are evidenced only when score/type says so", () => {
  assert.equal(R.isFallback({ v: "kt", ev: 0 }), true, "new fallback article");
  assert.equal(R.isFallback({ v: "kt", ev: 1 }), false, "new item-evidenced article");
  assert.equal(R.isFallback({ v: "lt", ev: 0 }), true, "new module lesson");
  assert.equal(R.isFallback({ v: "lt", ev: 1 }), false, "ev wins over via");
  assert.equal(R.isFallback({ v: "kt" }), true, "legacy module article is a fallback");
  assert.equal(R.isFallback({ v: "lt" }), true, "legacy module/subject lesson is a fallback");
  assert.equal(R.isFallback({ tier: "topic" }), true, "legacy topic-tier lesson is a fallback");
  assert.equal(R.isFallback({ tier: "specific" }), false, "specific lesson stays evidenced");
  for (const v of ["a", "k", "q", "s", "h", "rm", "kl", "lk", "li", "lh"])
    assert.equal(R.isFallback({ v, c: 75 }), false, v + " stays evidenced");
  assert.equal(R.isFallback({ k: "kb", id: "x", title: "X" }), false, "pipeline x.links rows have no via: evidenced");
  assert.equal(R.isFallback(null), true);
});

test("shardLinks: ev rides new kt/lt rows; legacy rows keep their exact shape", () => {
  const sh = { T: [["kb", "a", "A"], ["kb", "b", "B"], ["ls", "m", "M"]],
    e: { i: [[0, 75, "kt", "", 0], [1, 75, "kt", "mgmt", 1], [2, 75, "lt"]] } };
  assert.deepEqual(R.shardLinks(sh, "i"), [
    { k: "kb", id: "a", title: "A", c: 75, v: "kt", sec: "", ev: 0 },
    { k: "kb", id: "b", title: "B", c: 75, v: "kt", sec: "mgmt", ev: 1 },
    { k: "ls", id: "m", title: "M", c: 75, v: "lt", sec: "" },
  ]);
});

test("lessonLinks: topic rows are fallback, specific rows evidenced, ev surfaces", () => {
  const sh = { T: [["ls", "m1", "Mod Lesson"], ["ls", "c9", "Image Step"]],
    e: { i: [[0, 75, "lt", "", 0], [1, 85, "li", "2", 1]] } };
  assert.deepEqual(R.lessonLinks(sh, "i"), [
    { key: "c9", title: "Image Step", c: 85, tier: "specific", step: "2", ev: 1 },
    { key: "m1", title: "Mod Lesson", c: 75, tier: "topic", step: "", ev: 0 },
  ]);
  assert.equal(R.isFallback(R.lessonLinks(sh, "i")[0]), false);
  assert.equal(R.isFallback(R.lessonLinks(sh, "i")[1]), true);
});

test("kmTargets: items with both keep both, evidenced first; fallbacks carry the module name", () => {
  const km = R.kmTargets({
    links: [{ k: "kb", id: "fb", title: "Off-topic Article", c: 75, v: "kt" },
      { k: "kb", id: "ev", title: "Right Article", c: 92, v: "k" }],
    okLessons: [{ key: "m1", title: "Mod Lesson", tier: "topic", step: "" }],
    sid: "s", mid: "m1", mt: "Renal Physiology",
  });
  assert.deepEqual(km.rowTargets.map((t) => t.k + ":" + (t.id || t.key)), ["kb:ev", "kb:fb", "ls:m1"]);
  assert.equal(km.rowTargets[0].fb, false, "evidenced leads");
  assert.equal(km.rowTargets[1].fb, true);
  assert.equal(km.rowTargets[1].mt, "Renal Physiology");
  assert.equal(km.rowTargets[2].fb, true, "topic-tier lesson is a fallback");
  assert.deepEqual(km.allTargets.map((t) => t.k + ":" + (t.id || t.key)), ["kb:ev", "kb:fb", "ls:m1"]);
});

test("knowMoreHtml: fallback-only renders Learn this module with the module subtitle", () => {
  const km = R.kmTargets({ links: [{ k: "kb", id: "fb", title: "Off-topic Article", c: 75, v: "kt" }], sid: "s", mid: "m1", mt: "Renal Physiology" });
  const h = R.knowMoreHtml({ targets: km.rowTargets, allTargets: km.allTargets, sid: "s", mid: "m1", iid: "x" });
  assert.match(h, /<h3 class="pn-km-h">Know more<\/h3>/);
  assert.match(h, /pn-km-btn pn-km-fb/);
  assert.match(h, /<b>Learn this module<\/b><small>Renal Physiology<\/small>/);
  assert.doesNotMatch(h, /Off-topic Article/, "the possibly wrong article title never shows");
  assert.match(h, /data-id="fb"/, "the button still opens the same target");
});

test("knowMoreHtml: evidenced keeps its wording and leads a mixed pair", () => {
  const km = R.kmTargets({
    links: [{ k: "kb", id: "fb", title: "Off-topic Article", c: 75, v: "kt" },
      { k: "kb", id: "ev", title: "Right Article", c: 92, v: "k" }],
    sid: "s", mid: "m1", mt: "Renal Physiology",
  });
  const h = R.knowMoreHtml({ targets: km.rowTargets, allTargets: km.allTargets });
  assert.match(h, /<b>Knowledge Library: Right Article<\/b>/);
  assert.ok(h.indexOf("Right Article") < h.indexOf("Learn this module"), "evidenced first");
});

test("knowMoreSheetBodyHtml: fallback rows read Learn this module with the module name", () => {
  const km = R.kmTargets({
    links: [{ k: "kb", id: "fb", title: "Off-topic Article", c: 75, v: "kt", ev: 0 },
      { k: "kb", id: "ev", title: "Right Article", c: 92, v: "k" }],
    sid: "s", mid: "m1", mt: "Renal Physiology",
  });
  const b = R.knowMoreSheetBodyHtml({ allTargets: km.allTargets });
  assert.match(b, /<small>Learn this module<\/small><b>Renal Physiology<\/b>/);
  assert.ok(b.indexOf("Right Article") < b.indexOf("Renal Physiology"), "evidenced first in the group");
  assert.doesNotMatch(b, /Off-topic Article/);
});

test("slotHtml: fallback link rows read Learn this module after evidenced rows", () => {
  const h = R.slotHtml({
    links: [{ k: "kb", id: "fb", title: "Off-topic Article", c: 75, v: "kt" },
      { k: "kb", id: "ev", title: "Right Article", c: 92, v: "k" }],
    lessons: [{ key: "m1", title: "Mod Lesson", tier: "topic", step: "" }],
    sid: "s", mid: "m1", mt: "Renal Physiology",
  });
  assert.match(h, /<small>Knowledge Library<\/small><b>Right Article<\/b>/);
  assert.ok(h.indexOf("Right Article") < h.indexOf("Learn this module"), "evidenced first");
  assert.doesNotMatch(h, /Off-topic Article/);
  assert.match(h, /data-id="fb"/, "the fallback target still opens");
});

test("moduleTitleOf: taxonomy display names from the real fixture bank", () => {
  const P = req(join(ROOT, "prep.js"));
  const tax = JSON.parse(fs.readFileSync(join(ROOT, "test", "fixtures", "prep", "taxonomy.json"), "utf8"));
  assert.equal(P.moduleTitleOf("ana-gametogenesis", tax), "Gametogenesis");
  assert.equal(P.moduleTitleOf("ana-brachial-plexus", tax), "Brachial plexus");
  assert.equal(P.moduleTitleOf("nope", tax), "");
  assert.equal(P.moduleTitleOf("x"), "", "no taxonomy, no crash");
});

test("wiring: the fallback rows reuse tokens, keep 44px targets, no glow", () => {
  const css = fs.readFileSync(join(ROOT, "prep.css"), "utf8");
  assert.ok(css.includes(".pn-root .pn-km-btn {") && css.includes("min-height: 44px"), "44px targets");
  const i = css.indexOf(".pn-km-btn.pn-km-fb");
  assert.ok(i >= 0, "fallback style exists");
  const slice = css.slice(i, i + 900);
  assert.ok(!slice.match(/#[0-9a-f]{3,}/i), "tokens only, so light and dark follow");
  assert.ok(!slice.includes("box-shadow") && !slice.includes("glow") && !slice.includes("gradient"), "no glow");
  const prep = fs.readFileSync(join(ROOT, "prep.js"), "utf8");
  assert.match(prep, /moduleTitleOf: moduleTitleOf/, "HOST exposes the module title for the fallback subtitle");
});

test("fill: new-style and legacy fallback rows relabel, evidenced rows keep their wording", async () => {
  const src = fs.readFileSync(join(ROOT, "prep-reason.js"), "utf8");
  const ptr = { v: 1, ver: "relabel", gen: "test", th: 75, n: { items: 4, linked: 4, links: 5 }, src: {}, m: { "med-test-mod": "medicine/12345678" }, c: {} };
  const shard = {
    v: 1, m: "med-test-mod", s: "medicine", ver: "relabel",
    T: [["kb", "ev_article", "Evidenced Article"], ["kb", "fallback_article", "Fallback Article"], ["ls", "med-test-mod", "Test Module Lesson"]],
    e: {
      "it-ev": [[0, 92, "k"]],
      "it-fb": [[1, 75, "kt"]],
      "it-both": [[0, 92, "k"], [1, 75, "kt", "", 0]],
      "it-lesson": [[2, 75, "lt", "", 0]],
    },
    x: {}, mod: {},
  };
  const G = {
    fetch: (url) => {
      const u = String(url);
      if (u.endsWith("/v2/links/index.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(ptr) });
      if (u.endsWith("/v2/links/m/med-test-mod-12345678.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(shard) });
      return Promise.resolve({ ok: false, status: 404 });
    },
  };
  new Function("window", src)(G);
  const PR = G.PREP_REASON;
  const mk = (cls, iid) => {
    const attrs = { "data-i": iid, "data-s": "medicine", "data-m": "med-test-mod", class: cls };
    const styleObj = { display: "" };
    return { className: cls, style: styleObj,
      getAttribute: (k) => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; }, innerHTML: "" };
  };
  const sEv = mk("pn-rx", "it-ev"), sFb = mk("pn-rx", "it-fb"), sBoth = mk("pn-rx", "it-both"), sLesson = mk("pn-km", "it-lesson");
  const byIid = { "it-ev": sEv, "it-fb": sFb, "it-both": sBoth, "it-lesson": sLesson };
  const root = { querySelectorAll: () => [sEv, sFb, sBoth, sLesson],
    querySelector: (sel) => { const m = /data-i="([^"]+)"/.exec(sel); return (m && byIid[m[1]]) || null; } };
  const item = (id) => ({ id, q: "Why does this happen?", o: ["Because", "Otherwise"], a: 0, exp: "Because.", _s: "medicine", _m: "med-test-mod" });
  const cache = new Map();
  const H = { root: () => root, run_: () => ({ items: [item("it-ev"), item("it-fb"), item("it-both"), item("it-lesson")] }),
    loadModule: () => Promise.resolve([]), subjectOfModule: () => "medicine", moduleTitleOf: () => "Renal Physiology",
    bankApi: "https://x/api/prep/bank/", cacheGet: (k) => (cache.has(k) ? cache.get(k) : null), cachePut: (k, v) => { cache.set(k, v); } };
  PR.fill(H);
  const slots = [sEv, sFb, sBoth, sLesson];
  for (let i = 0; i < 200 && slots.some((s) => s.getAttribute("data-done") !== "1"); i++)
    await new Promise((r) => setTimeout(r, 10));
  for (const s of slots) assert.equal(s.getAttribute("data-done"), "1", "every slot fills");

  assert.match(sEv.innerHTML, /<small>Knowledge Library<\/small><b>Evidenced Article<\/b>/, "evidenced keeps its wording");
  assert.match(sEv.innerHTML, /<b>Review the concept<\/b><small>Evidenced Article<\/small>/, "review names the evidenced article");
  assert.doesNotMatch(sEv.innerHTML, /Learn this module/);

  assert.match(sFb.innerHTML, /Learn this module/, "legacy fallback-only relabels");
  assert.match(sFb.innerHTML, /Renal Physiology/, "the module name subtitles the row");
  assert.doesNotMatch(sFb.innerHTML, /Fallback Article/, "the unevidenced title never shows");
  assert.match(sFb.innerHTML, /data-id="fallback_article"/, "the target still opens");
  assert.match(sFb.innerHTML, /<b>Review the concept<\/b><small>Renal Physiology<\/small>/, "review names the module, not the article");

  assert.ok(sBoth.innerHTML.indexOf("Evidenced Article") < sBoth.innerHTML.indexOf("Learn this module"), "items with both keep both, evidenced first");

  assert.match(sLesson.innerHTML, /pn-km-btn pn-km-fb/, "lesson fallback uses the secondary style");
  assert.match(sLesson.innerHTML, /data-l="med-test-mod"/, "the lesson still opens");
});

test("fill: without HOST.moduleTitleOf the subtitle falls back to the module id", async () => {
  const src = fs.readFileSync(join(ROOT, "prep-reason.js"), "utf8");
  const ptr = { v: 1, ver: "relabel", gen: "test", th: 75, n: { items: 1, linked: 1, links: 1 }, src: {}, m: { "med-test-mod": "medicine/12345678" }, c: {} };
  const shard = { v: 1, m: "med-test-mod", s: "medicine", ver: "relabel",
    T: [["kb", "fallback_article", "Fallback Article"]], e: { "i": [[0, 75, "kt"]] }, x: {}, mod: {} };
  const G = {
    fetch: (url) => {
      const u = String(url);
      if (u.endsWith("/v2/links/index.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(ptr) });
      if (u.endsWith("/v2/links/m/med-test-mod-12345678.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(shard) });
      return Promise.resolve({ ok: false, status: 404 });
    },
  };
  new Function("window", src)(G);
  const PR = G.PREP_REASON;
  const attrs = { "data-i": "i", "data-s": "medicine", "data-m": "med-test-mod", class: "pn-km" };
  const s = { className: "pn-km", style: { display: "" },
    getAttribute: (k) => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; }, innerHTML: "" };
  const root = { querySelectorAll: () => [s], querySelector: () => s };
  const cache = new Map();
  const H = { root: () => root, run_: () => ({ items: [] }),
    loadModule: () => Promise.resolve([]), subjectOfModule: () => "medicine",
    bankApi: "https://x/api/prep/bank/", cacheGet: (k) => (cache.has(k) ? cache.get(k) : null), cachePut: (k, v) => { cache.set(k, v); } };
  PR.fill(H);
  for (let i = 0; i < 200 && s.getAttribute("data-done") !== "1"; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.getAttribute("data-done"), "1");
  assert.match(s.innerHTML, /<b>Learn this module<\/b><small>Med Test Mod<\/small>/, "old hosts relabel too, titled from the module id");
});

test("browser stubs: the committed seed routes links and names real articles", async () => {
  const ui = await import("./run-prep-relabel-ui.mjs");
  const seen = [];
  const window = { fetch: async (u) => { seen.push(String(u)); return { ok: true, json: async () => ({ passthrough: true }) }; } };
  new Function("window", ui.SEED)(window);
  const j = async (u) => (await window.fetch(u)).json();
  assert.deepEqual(await j("https://x/test/fixtures/prep/api/v2/links/index.json"), ui.INDEX);
  assert.deepEqual(await j("https://x/test/fixtures/prep/api/v2/links/m/ana-gametogenesis-rel4bel0.json"), ui.SHARD);
  assert.deepEqual(await j("https://x/other.json"), { passthrough: true }, "everything else passes through");
  assert.deepEqual(Object.keys(ui.SHARD.e).sort(),
    ["ana-gametogenesis-q1", "ana-gametogenesis-q2", "ana-gametogenesis-q3", "ana-gametogenesis-q4"],
    "legacy fallback, evidenced, mixed and lesson-only rows");
  // The stub's KB ids are real articles, so the app's hasDiseaseRef keeps them.
  const ctx = { window: {} };
  vm.createContext(ctx);
  for (const f of ["kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js"])
    if (fs.existsSync(join(ROOT, f))) vm.runInContext(fs.readFileSync(join(ROOT, f), "utf8"), ctx, { filename: f });
  const byId = (ctx.window.KB_ENRICHMENT && ctx.window.KB_ENRICHMENT.byId) || {};
  assert.ok(Object.keys(byId).length > 1000, "the real article universe loads");
  for (const row of ui.SHARD.T) if (row[0] === "kb") assert.ok(byId[row[1]], row[1] + " is a real article");
});
