// tools/prep-explain.mjs: retrieval, prompt, reading, the code gates, the review gate set, r from x, scopes, the pilot
// pick and a full two-pass run against a fake Vertex. Every item here is SYNTHETIC (the repo is public).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  passagesOf, index, namesOther, misaligned, fixTables, queryOf, groundFor, explainPrompt, readX, tidy, keyAgrees, tableOk, xGate, gateWhy, reviewPrompt, readReview,
  reviewOk, XPASS, toR, applyX, scopeItems, pickPilot, estimate, run, XSchema, PER,
} from "../tools/prep-explain.mjs";

const IT = { id: "s1", q: "A 30 year old has beaded renal arteries on angiography. Most likely cause?", o: ["Atheroma", "Fibromuscular dysplasia", "Arteritis", "Embolism"], a: 1, exp: "Beaded look of the mid renal artery in young women is fibromuscular dysplasia.", t: "x-mod", prov: "LIC" };
const GOOD = {
  key: "Fibromuscular dysplasia gives the beaded look because short stenoses alternate with small dilatations in the mid artery.",
  notes: "## Fibromuscular dysplasia\n- **Beaded** mid renal or carotid artery, where short narrow rings alternate with small bulges\n- Mostly young and middle aged women; smoking adds risk\n- Causes renovascular hypertension, headache, pulsatile tinnitus or a neck bruit\n- Treat with balloon angioplasty, rarely a stent\n\n| Feature | FMD | Atheroma |\n| --- | --- | --- |\n| Site | Mid artery | Ostium |\n| Age | Young | Old |\n\n1. Suspect\n2. Image",
  others: { A: "Atheroma narrows the origin of the artery in older people.", C: "Arteritis thickens the wall smoothly.", D: "An embolism cuts off flow suddenly." },
  pearl: "Mid artery beads in a young woman: think fibromuscular dysplasia.",
};
const G0 = { exp: IT.exp, notes: "", text: IT.exp + "\n" };

test("tidy: long dashes become words or commas, emoji go, notes keep their lines", () => {
  assert.equal(tidy("doses 5\u201310 mg \u2014 twice"), "doses 5 to 10 mg, twice");
  assert.equal(tidy("ok \u{1F600} done"), "ok done");
  assert.equal(tidy("## H\\n- a\n\n\n\n- b  ", true), "## H\n- a\n\n- b");
});

test("keyAgrees: spelling slips, apostrophes, prefixes; namesOther and misaligned catch the wrong option", () => {
  assert.equal(keyAgrees("Buerger's disease shows corkscrew collaterals.", { ...IT, o: ["a", "Buergers disease", "c", "d"] }), true);
  assert.equal(keyAgrees("N-acetylcysteine is the antidote.", { ...IT, a: 0, o: ["N-acetylecysteine", "b", "c", "d"] }), true);
  assert.equal(keyAgrees("Infliximab works by inhibiting TNF-a.", { ...IT, a: 0, o: ["Inhibit TNF-a", "b", "c", "d"] }), true);
  assert.equal(keyAgrees("Molluscum contagiosum is umbilicated.", { ...IT, a: 0, o: ["Molluscumcontagiosum", "b", "c", "d"] }), true);
  assert.equal(namesOther("Atheroma narrows the origin.", IT), true);
  assert.equal(namesOther("Fibromuscular dysplasia, not atheroma.", IT), false);
  assert.equal(misaligned(IT, GOOD), "");
  const shifted = { ...GOOD, others: { A: "Arteritis gives smooth aortic narrowing.", C: "An embolism cuts off flow.", D: "" } };
  assert.equal(misaligned(IT, { ...GOOD, others: { A: "Arteritis gives smooth aortic narrowing.", C: "An embolism cuts off flow.", D: "" } }), "A", "two reasons each about another option: shifted");
  const IT2 = { ...IT, o: ["Atheroma", "Fibromuscular dysplasia", "Arteritis of the aorta", "Embolism"] };
  assert.equal(misaligned(IT2, { ...GOOD, others: { ...GOOD.others, A: "Unlike arteritis of the aorta, this is wrong." } }), "A", "one reason naming another option's whole text");
  assert.equal(misaligned(IT, { ...GOOD, others: { ...GOOD.others, A: "Not this one: think of embolism instead." } }), "", "a single loose word is not enough");
  const rev = { o: ["Reversible", "Irreversible", "Can be reversed by catalase", "Competitive"], a: 1 };
  assert.equal(misaligned(rev, { others: { A: "It does not proceed in the reverse direction.", C: "Catalase breaks down peroxide.", D: "Competitive describes inhibition." } }), "", "pilot false positive: a shared word start counts as its own option");
  assert.equal(xGate(IT, { ...GOOD, others: { A: "Arteritis gives smooth aortic narrowing in young women.", C: "An embolism cuts off flow suddenly.", D: "Embolism again." } }, G0), "align");
  const k = Object.defineProperty({ ...GOOD, key: "Both statements are true, so this is the answer.", others: { A: "x", C: "y", D: "z" } }, "ka", { value: "B" });
  assert.equal(xGate({ ...IT, o: ["ab", "bde", "ce", "ad"] }, k, G0), null, "an option with no words: the declared letter decides");
  const bad = Object.defineProperty({ ...GOOD }, "ka", { value: "A" });
  assert.equal(xGate(IT, bad, G0), "key", "a declared letter that is not the stored key fails");
});

test("keyAgrees: the key line must name the stored answer", () => {
  assert.equal(keyAgrees(GOOD.key, IT), true);
  assert.equal(keyAgrees("Atheroma is the cause here.", IT), false);
  assert.equal(keyAgrees("Fibromuscular disease of the wall.", IT), false, "one of two content words is not enough");
  assert.equal(keyAgrees("This is fibromuscular dysplasia.", { ...IT, o: ["x", "Fibromuscular dysplasia (FMD)", "y", "z"] }), true);
});

test("fixTables: the separator row follows the header width", () => {
  assert.equal(fixTables("| a | b |\n| --- | --- | --- |\n| c | d |"), "| a | b |\n| --- | --- |\n| c | d |");
  assert.equal(fixTables("no table\n- x"), "no table\n- x");
});

test("tableOk: a table needs a separator row and rows of one width", () => {
  assert.equal(tableOk(GOOD.notes), true);
  assert.equal(tableOk("| a | b |\n| c | d |\n| e | f |"), false);
  assert.equal(tableOk("| a | b |\n| --- | --- |\n| c | d | e |"), false);
  assert.equal(tableOk("no table"), true);
});

test("xGate: passes a grounded, well formed explanation and names each failure", () => {
  assert.equal(xGate(IT, GOOD, G0), null);
  assert.equal(xGate(IT, null, G0), "g1");
  assert.equal(xGate(IT, { ...GOOD, others: { A: "x", C: "", D: "y" } }, G0), "g1");
  assert.equal(xGate(IT, { ...GOOD, key: "Atheroma is right here." }, G0), "key");
  assert.equal(xGate(IT, { ...GOOD, pearl: "Seen in 90% of cases." }, G0), "g9b");
  assert.equal(xGate(IT, { ...GOOD, pearl: "Seen at age 30." }, G0), null, "a number in the stem is grounded");
  assert.equal(xGate(IT, { ...GOOD, pearl: "CD20, IL-2, I-131 and HbA1c are names, not numbers." }, G0), null, "identifiers with digits are not quantities");
  assert.equal(xGate(IT, { ...GOOD, notes: GOOD.notes + "\n1. Third step" }, G0), null, "list markers are not numbers");
  assert.equal(xGate(IT, { ...GOOD, pearl: "Beaded look of the mid renal artery in young women is fibromuscular dysplasia and more." }, G0), "verbatim");
  assert.equal(xGate(IT, { ...GOOD, notes: GOOD.notes + "\n![x](y.png)" }, G0), "markup");
  assert.equal(xGate(IT, { ...GOOD, notes: GOOD.notes + "\nSee <b>this</b>" }, G0), "markup");
  assert.equal(xGate(IT, { ...GOOD, notes: GOOD.notes + "\n| a | b |\n| c | d |\n| e | f |" }, G0), "markup");
  assert.equal(xGate(IT, { ...GOOD, pearl: "Reference: a big textbook." }, G0), "source");
  assert.equal(xGate(IT, { ...GOOD, pearl: "Classic in Robbins pathology." }, G0), "source");
  assert.equal(xGate(IT, { ...GOOD, pearl: "Mid artery beads: think FMD, Samplebook says." }, G0, ["Samplebook"]), "source", "the pack's avoid list");
  assert.equal(xGate(IT, { ...GOOD, pearl: "This AI note is short." }, G0), "ai");
  assert.equal(xGate(IT, { ...GOOD, notes: "## Short\n- too short" }, G0), "long");
  assert.match(gateWhy("g9b", IT, { ...GOOD, pearl: "Seen in 90% of cases." }, G0), /90/);
});

test("readX: one x per item from the reply, others never carry the key's letter, junk gives null", () => {
  const reply = JSON.stringify({ xs: [{ i: 0, ka: "b", ky: GOOD.key, nt: GOOD.notes, ra: GOOD.others.A, rb: "the key's own reason is not kept", rc: GOOD.others.C, rd: GOOD.others.D, pl: GOOD.pearl }, { i: 9, ky: "x" }] });
  const out = readX(reply, [IT, IT]);
  assert.deepEqual(out[0], GOOD);
  assert.equal(out[0].ka, "B");
  assert.equal(JSON.stringify(out[0]).includes("ka"), false, "ka checks the reply; it is never stored");
  assert.equal(out[1], null);
  assert.deepEqual(readX("not json", [IT]), [null]);
});

test("explainPrompt: one block per item with the key, the stored explanation and the notes; redo carries the reason", () => {
  const p = explainPrompt([{ ...IT, ground: { exp: IT.exp, notes: "Note text." } }]);
  assert.equal(p.schema, XSchema);
  assert.match(p.user, /Correct: B \(Fibromuscular dysplasia\)/);
  assert.match(p.user, /Stored explanation: Beaded/);
  assert.match(p.user, /Notes: Note text\./);
  assert.doesNotMatch(p.system, /[\u2013\u2014]/);
  const r = explainPrompt([{ ...IT, ground: { exp: "", notes: "" }, prev: "it used a long dash" }], { redo: true });
  assert.match(r.user, /Rejected before because: it used a long dash/);
  assert.match(r.user, /Stored explanation: \(none\)/);
  assert.match(r.system, /second attempt/);
});

test("review: buildReviewPrompt plus the notes and gate nt; only g7 g8 g9 g10 nt decide", () => {
  const p = reviewPrompt([{ it: IT, x: GOOD, ground: G0 }, { it: { ...IT, id: "s2" }, x: GOOD, ground: { exp: "", notes: "", text: "" } }]);
  assert.match(p.user, /Topic notes: ## Fibromuscular dysplasia \/ - \*\*Beaded\*\*/);
  assert.equal((p.user.match(/Topic notes:/g) || []).length, 2);
  assert.match(p.user, /\(reason: Fibromuscular dysplasia gives/);
  assert.match(p.user, /no source: judge g9 from standard teaching/);
  assert.ok(p.schema.properties.g.items.required.includes("nt"));
  assert.deepEqual(XPASS, ["g7", "g8", "g9", "g10", "nt"]);
  const all = { i: 0, g4: false, g6: false, g7: true, g8: true, g9: true, g10: true, g11: false, nt: true, old: false, why: "" };
  const v = readReview(JSON.stringify({ g: [all, { ...all, i: 1, nt: false }] }), 3);
  assert.equal(reviewOk(v[0]), true, "question-writing gates g4 g6 g11 do not drop an explanation");
  assert.equal(reviewOk(v[1]), false);
  assert.equal(v[2], null);
});

test("toR and applyX: r from x when the item has none; exp and an existing r are kept", () => {
  assert.deepEqual(toR(IT, GOOD), [GOOD.others.A, GOOD.key, GOOD.others.C, GOOD.others.D]);
  const c = applyX(IT, { x: GOOD });
  assert.equal(c.exp, IT.exp);
  assert.deepEqual(c.x, GOOD);
  assert.equal(c.r[1], GOOD.key);
  const keep = applyX({ ...IT, r: ["a", "b", "c", "d"] }, { x: GOOD });
  assert.deepEqual(keep.r, ["a", "b", "c", "d"]);
  assert.equal(applyX(IT, { pending: true }), IT);
});

test("retrieval: passages keep sentences under their heading; BM25 ranks the passage that shares rare words", () => {
  const ps = passagesOf("# Renal\nFibromuscular dysplasia beads the renal artery. It affects young women.\n\n# Heart\nAortic stenosis causes syncope.", "Doc");
  assert.equal(ps.length, 2);
  assert.match(ps[0].h, /Doc: Renal/);
  const ix = index(ps);
  const hit = ix.search(queryOf(IT), 1)[0];
  assert.match(hit.p.tx, /Fibromuscular/);
  assert.ok(hit.rel > 0 && hit.rel <= 1);
  const g = groundFor(IT, { packIx: () => ix, kbIx: null });
  assert.match(g.notes, /beads the renal artery/);
  assert.match(g.text, /^Beaded look/);
});

const BANK = [
  { ...IT, id: "e1", exp: "", _s: "a" }, { ...IT, id: "e2", exp: "", _s: "b", flags: ["disputed"] }, { ...IT, id: "s1", exp: "short", _s: "a" },
  { ...IT, id: "n1", exp: "x".repeat(300), _s: "b" }, { ...IT, id: "n2", exp: "y".repeat(300), _s: "c" }, { ...IT, id: "b1", prov: "SMD", r: ["a", "b", "c", "d"], _s: "a" },
  { ...IT, id: "o1", q: "The pile of plates sign is seen in?", exp: "", _s: "c" },
];
test("scopes: hidden (flagged) items are never sent; Layer B and PYQ are their own scopes", () => {
  assert.deepEqual(scopeItems("empty", BANK).map((x) => x.id), ["e1", "o1"]);
  assert.deepEqual(scopeItems("short", BANK).map((x) => x.id), ["e1", "s1", "o1"]);
  assert.equal(scopeItems("all", BANK).length, 5);
  assert.deepEqual(scopeItems("layerb", BANK).map((x) => x.id), ["b1"]);
  assert.deepEqual(scopeItems("pyq", BANK, [{ ...IT, id: "p1" }, { ...IT, id: "p2", bank: "n1" }, { ...IT, id: "p3", flags: ["exp-pending"] }]).map((x) => x.id), ["p1", "p3"]);
  assert.throws(() => scopeItems("nope", BANK));
});

test("pickPilot: owner examples first, then a third each of empty, short and normal, across subjects", () => {
  const p = pickPilot(BANK, 3, ["pile of plates"]);
  assert.equal(p[0].id, "o1");
  assert.equal(p.length, 3);
  assert.ok(p.some((x) => x.id === "s1") && p.some((x) => x.id.startsWith("n")));
  assert.ok(!p.some((x) => x.id === "e2"), "a flagged item is never picked");
});

test("estimate: zero items cost nothing; tokens come from the real prompts", () => {
  assert.equal(estimate([], { packIx: () => null, kbIx: null }, "gemini-3.1-flash-lite").usd, 0);
  const e = estimate(BANK.slice(0, 4), { packIx: () => null, kbIx: null }, "gemini-3.1-flash-lite");
  assert.ok(e.inTok > 1000 && e.outTok > 0 && e.usd > 0 && e.requests === 2);
});

test("run: explain, gates, review, one retry with the reason, then pending; resumes without a second submit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pxp-"));
  const items = ["q1", "q2", "q3"].map((id) => ({ ...IT, id }));
  const submitted = [];
  const answer = (name, l) => {
    const n = l.ids.length;
    if (name.includes("review")) return JSON.stringify({ g: l.ids.map((id, i) => ({ i, g4: true, g6: true, g7: true, g8: true, g9: true, g10: true, g11: true, nt: id !== "q2", old: false, why: id === "q2" ? "notes wrong" : "" })) });
    const redo = name.includes("redo");
    return JSON.stringify({ xs: l.ids.map((id, i) => ({ i, ka: "B", ky: id === "q3" && !redo ? "Atheroma it is." : GOOD.key, nt: GOOD.notes, ra: GOOD.others.A, rb: GOOD.key, rc: GOOD.others.C, rd: GOOD.others.D, pl: GOOD.pearl })) });
  };
  const jobs = new Map();
  const vertex = { cfg: { model: "gemini-3.1-flash-lite" }, log: [], batch: {
    submit: async ({ name, lines }) => { submitted.push(name); const id = "job/" + submitted.length; jobs.set(id, { name, lines }); return { jobId: id }; },
    wait: async (id) => ({ jobId: id, state: "JOB_STATE_SUCCEEDED" }),
    results: async (info, lines) => { const j = jobs.get(info.jobId); const m = new Map(); for (const l of lines) { m.set(l.key, { text: answer(j.name, l) }); vertex.log.push({ mode: "batch", promptTokenCount: 100, candidatesTokenCount: 50 }); } return m; },
  } };
  const ctx = { packIx: () => null, kbIx: null };
  const prevJob = process.env.CLAUDE_JOB_DIR; process.env.CLAUDE_JOB_DIR = dir;
  try {
    const out = await run(items, ctx, { work: path.join(dir, "w"), run: "t", pollMs: 0, maxWaitMs: 0 }, { vertex, log: () => {} });
    assert.deepEqual(submitted, ["explain/explain", "explain/review", "explain/explain-redo", "explain/review-redo"]);
    assert.ok(out.results.q1.x && out.results.q1.rv.pass);
    assert.ok(out.results.q3.x && out.results.q3.rv.redo, "the retry fixed the key line");
    assert.equal(out.results.q2.pending, true);
    assert.match(out.results.q2.why, /notes/);
    assert.equal(out.report.first.rejected.key, 1);
    const again = await run(items, ctx, { work: path.join(dir, "w"), run: "t", pollMs: 0, maxWaitMs: 0 }, { vertex, log: () => {} });
    assert.equal(submitted.length, 4, "a finished run is read back, never sent again");
    assert.deepEqual(again.report, out.report);
    assert.match(fs.readFileSync(path.join(dir, "tmp", "explain", "log.tsv"), "utf8"), /explain-redo/);
  } finally { if (prevJob == null) delete process.env.CLAUDE_JOB_DIR; else process.env.CLAUDE_JOB_DIR = prevJob; fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(PER, 4);
});

// ---- renderer (prep.js pure part): escaping, the Markdown subset, tables, old "*" bullets, x -> r
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../prep.js");

test("mdLite: everything is escaped before the subset becomes tags", () => {
  const h = P.mdLite('<img src=x onerror="alert(1)"> & <script>x</script> [a](javascript:1) ![i](y.png)');
  assert.doesNotMatch(h, /<img|<script|<a /);
  assert.match(h, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &lt;script&gt;/);
  assert.equal(P.mdLite("**<b>x</b>**"), "<p><b>&lt;b&gt;x&lt;/b&gt;</b></p>");
  assert.equal(P.inlineMd('a "q" \'s\''), "a &quot;q&quot; &#39;s&#39;");
  assert.equal(P.mdLite(""), "");
  assert.equal(P.mdLite(null), "");
});

test("mdLite: headings, bold, bullets, numbered steps, paragraphs; stray asterisks go", () => {
  const h = P.mdLite("## Key *point*\nFirst line\nsame para\n\n- one **bold**\n* two\n\n3. third\n4. fourth\nafter");
  assert.equal(h, '<h4 class="pn-xh">Key point</h4><p>First line same para</p><ul><li>one <b>bold</b></li><li>two</li></ul><ol start="3"><li>third</li><li>fourth</li></ol><p>after</p>');
  assert.equal(P.mdLite("**Bold start** of a line"), "<p><b>Bold start</b> of a line</p>", "a bold opening is not a bullet");
});

test("mdLite: a pipe table becomes a scrolling, labelled region; rows are padded to the header width; no separator = text", () => {
  const h = P.mdLite("| Feature | FMD | Atheroma |\n| --- | :---: | --- |\n| Site | Mid **artery** | Ostium |\n| Age | Young |\n\nAfter.");
  assert.match(h, /^<div class="pn-xt" role="region" tabindex="0" aria-label="Table: Feature, FMD, Atheroma"><table><thead><tr><th scope="col">Feature<\/th>/);
  assert.match(h, /<tr><th scope="row">Site<\/th><td>Mid <b>artery<\/b><\/td><td>Ostium<\/td><\/tr>/);
  assert.match(h, /<tr><th scope="row">Age<\/th><td>Young<\/td><td><\/td><\/tr>/);
  assert.match(h, /<\/table><\/div><p>After\.<\/p>$/);
  assert.equal(P.mdLite("| a | b |\n| c | d |"), "<p>| a | b | | c | d |</p>");
  assert.doesNotMatch(P.mdLite('| <x> | "y" |\n| --- | --- |\n| 1 | 2 |'), /<x>|"y"/);
});

test("legacyExp: MedMCQA's inline asterisk bullets become a list; a lone leading asterisk is dropped", () => {
  const exp = "*Corkscrew appearance of vessels on Angiography- It is the hallmark. *Represents collaterals around areas of occlusion *Most often seen at wrist & ankles.";
  assert.equal(P.mdLite(P.legacyExp(exp)), "<ul><li>Corkscrew appearance of vessels on Angiography- It is the hallmark.</li><li>Represents collaterals around areas of occlusion</li><li>Most often seen at wrist &amp; ankles.</li></ul>");
  assert.equal(P.legacyExp("Intro line. *One *Two"), "Intro line.\n- One\n- Two");
  assert.equal(P.legacyExp("*Only one point here"), "Only one point here");
  assert.equal(P.legacyExp("2 * 3 = 6 and **bold**"), "2 * 3 = 6 and **bold**", "a spaced asterisk and bold are not bullets");
  assert.equal(P.legacyExp(""), "");
});

test("explainOf: x needs a key line; r comes from the item, else from x", () => {
  const it = { o: ["a", "b", "c", "d"], a: 2 };
  const x = { key: "C is right.", notes: "n", others: { A: "not a", B: "not b", D: "not d" }, pearl: "p" };
  assert.deepEqual(P.explainOf({ ...it, x }).r, ["not a", "not b", "C is right.", "not d"]);
  assert.deepEqual(P.explainOf({ ...it, x, r: ["1", "2", "3", "4"] }).r, ["1", "2", "3", "4"]);
  assert.equal(P.explainOf({ ...it, x: { key: "  " } }).x, null);
  assert.equal(P.explainOf({ ...it, x: "junk" }).x, null);
  assert.equal(P.explainOf(it).r, null);
});
