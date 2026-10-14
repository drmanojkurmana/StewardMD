/* PrepNucleus explanation formatting (prep-expfmt.js): the safe render-only formatter for stored MCQ
 * explanations. The corpus (test/prep-expfmt-corpus.json) holds 312 real bank explanations across
 * 22 subjects: overlay items plus MedMCQA-era deck items (Ans./ANSWTER leads, "*" bullets, REF: lines).
 * The owner's pasted-table item Q-8AV-4D5-GR7 is pinned exact. Stored text is never rewritten: every test
 * below asserts render-time behaviour, and the preservation test asserts no text is dropped or reworded.
 *
 * node --test test/prep-expfmt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
const X = req(join(ROOT, "prep-expfmt.js"));
const LF = req(join(ROOT, "prep-listfmt.js"));
const LX = req(join(ROOT, "drug-lexicon.js"));
const CORPUS = JSON.parse(fs.readFileSync(join(ROOT, "test/prep-expfmt-corpus.json"), "utf8")).items;
const DR = X.drugRx(X.drugNames(LX));
const ctxOf = (c) => ({ o: (c && c.o) || [], a: c && typeof c.a === "number" ? c.a : -1, drugRx: DR });
const byId = {};
for (const c of CORPUS) byId[c.id] = c;

const OWNER_E = "Breast cancer Incidence Sporadic breast cancer 65-75 % Familial breast cancer 20-30 % Hereditary breast cancer 5-10 % BRCA1 45 % BRCA 2 35 % p53 ( Li-Fraumeni syndrome ) 1 % STK11/LKB1a (Peutz-Jegherssyndrome), PTENa (Cowdendisease), MSH2/MLH1a ( Muir-Torresyndrome), ATMa (Ataxiatelangiectasia ) Less than 1 % Unknown 20 %";
/* 20 MedMCQA-era deck explanations: Ans./ANSWTER leads, "*" bullets, glued REF: lines (all real). */
const MED20 = ["1913f18b-943a-4bfb-8a4e-3f980472c581", "1eef9575-3939-4f80-9130-a4e6183c2c7c",
  "716b0e83-bfec-42db-8731-9096768346a3", "da1b64cb-3fef-4a1b-b5b1-c891ae878b8f",
  "096bead7-9d30-4410-ad72-4f96eb774844", "1d24340a-e8d7-4b22-b8c8-797bbcae8c88",
  "7ab4d9ea-9eec-4f3b-a447-6334fdaa8704", "912bbc51-bb08-4808-baad-bbc28c3d30a0",
  "d8f89efb-1d22-48fb-99ce-d19b5fdad934", "f87caa79-2294-460d-905b-2cfd5ee9c297",
  "a89fdf83-a04f-4964-b38a-19f1aa3dc15a", "6d53b647-13d0-4bd6-8d95-6f11c4225532",
  "f3c0be58-a8dd-4c68-9d2d-3f2bd9c410a5", "e9ef5b95-a4ca-4924-8d5a-4c39d550fd2b",
  "00a3c1cb-d244-4bbe-b233-5632fe48e93b", "0600ef39-a60e-4d6a-b06e-c9954d34cd14",
  "09cd14b2-8077-494c-ab3f-d03b8b758d2d", "0b457836-0c29-42e5-841c-94bb6e6740b0",
  "0e34a0e9-48f0-46c0-8476-8c45572fad04", "0efb3ec6-3959-4d9c-a145-63be996607d1"];

/* List markers become tags, so both sides drop them before the equality check. */
function stripMarkers(s) {
  return String(s).replace(/\*\*/g, "").replace(/^\s*\*\s+/, "")
    .replace(/(^|\s)\*(?!\*)(?=[^\s\*])/g, " ")
    .replace(/^\s*#{1,6}\s+/gm, "").replace(/^\s*([-•]|\d{1,2}[.)])\s+/gm, "")
    .replace(/\|/g, " ").replace(/^\s*:?-{2,}:?\s*$/gm, " ")
    .replace(/\brefs?\s*\.?\s*:\s*/gi, " ").replace(/([a-z0-9)\]])REF\s*:\s*/gi, "$1 ")
    .replace(/\b(references?|source)\s*:\s*/gi, " ").replace(/\s*;\s*/g, " ")
    .replace(/\s+/g, " ").trim();
}
function normExp(e) { return stripMarkers(String(e).replace(/\s+/g, " ").trim()); }
function normHtml(h) { return stripMarkers(X.visible(h)); }
function preserved(e, ctx) { return normHtml(X.exp(e, ctx)) === normExp(e); }

test("corpus: at least 300 real explanations across subjects and styles", () => {
  assert.ok(CORPUS.length >= 300, "n=" + CORPUS.length);
  const subj = new Set(CORPUS.map((c) => c.subj));
  assert.ok(subj.size >= 15, "subjects=" + subj.size);
  const b = {};
  for (const c of CORPUS) b[c.b] = (b[c.b] || 0) + 1;
  for (const [k, n] of [["pct", 30], ["semi", 20], ["ref", 20], ["plain", 50]])
    assert.ok((b[k] || 0) >= n, k + "=" + (b[k] || 0));
  for (const c of CORPUS) {
    assert.ok(c.exp && c.exp.length >= 20, c.id + " has text");
    assert.ok(!/[\u0900-\u097F]/.test(c.exp), c.id + " is English-only");
  }
});

test("owner item Q-8AV-4D5-GR7: pasted-table explanation keeps every label and value", () => {
  const h = LF.exp(OWNER_E) || X.exp(OWNER_E, ctxOf(null));
  for (const s of ["Sporadic breast cancer", "65-75 %", "Familial breast cancer", "Unknown", "20 %"])
    assert.ok(h.includes(s), "keeps " + s);
  assert.ok(preserved(OWNER_E, ctxOf(null)), "formatter drops no text");
});

test("20 MedMCQA-style explanations render and keep their text", () => {
  assert.equal(MED20.length, 20);
  let shaped = 0;
  for (const id of MED20) {
    const c = byId[id];
    assert.ok(c, id + " is in the corpus");
    const h = X.exp(c.exp, ctxOf(c));
    assert.ok(h, id + " renders");
    assert.ok(preserved(c.exp, ctxOf(c)), id + " keeps its text");
    if (X.kindOf(c.exp, ctxOf(c)) !== "plain") shaped++;
  }
  assert.ok(shaped >= 16, "shaped=" + shaped);
});

test("preservation invariant: visible text equals the original on all 312", () => {
  const bad = [];
  for (const c of CORPUS) {
    const h = X.exp(c.exp, ctxOf(c));
    if (!h || normHtml(h) !== normExp(c.exp)) bad.push(c.id);
  }
  assert.deepEqual(bad, [], bad.length + " items lose text");
});

test("list/table path drops nothing: parsed bodies all appear verbatim", () => {
  const parsed = CORPUS.filter((c) => LF.parse(c.exp));
  assert.ok(parsed.length >= 3, "parseable=" + parsed.length);
  for (const c of parsed) {
    const p = LF.parse(c.exp), h = LF.exp(c.exp);
    assert.ok(h, c.id + " renders");
    if (p.lead) assert.ok(h.includes(LF.esc(p.lead)), c.id + " keeps its lead");
    for (const it of (p.items || [])) assert.ok(h.includes(LF.esc(it.text)), c.id + " keeps " + it.text.slice(0, 40));
    for (const col of ((p.match && p.match.cols) || []))
      for (const it of col.items) assert.ok(h.includes(LF.esc(it.text)), c.id + " keeps " + it.text.slice(0, 40));
  }
});

test("answer sentence lifts into a strong key line, abbreviations do not cut it", () => {
  let h = X.exp("Ans. is a i.e. Fibromuscular dysplasia. Beaded mid artery in young women.", ctxOf(null));
  assert.ok(h.startsWith('<p class="pn-xkey"><strong>Ans. is a i.e. Fibromuscular dysplasia.</strong></p>'), h.slice(0, 90));
  h = X.exp("ANSWTER: (A) 7-9 weeks", ctxOf(null));
  assert.ok(h.includes('<p class="pn-xkey"><strong>ANSWTER: (A) 7-9 weeks</strong></p>'), h);
  h = X.exp("Answer: Fibromuscular dysplasia gives beads.", ctxOf(null));
  assert.ok(h.includes("<strong>Answer: Fibromuscular dysplasia gives beads.</strong>"), h);
  for (const c of CORPUS.filter((c) => /^\s*(ans\w*\.?|answer)\b/i.test(c.exp)))
    assert.ok(X.exp(c.exp, ctxOf(c)).includes('class="pn-xkey"'), c.id + " lifts its answer");
});

test("references become chips where they stand, glued blobs stay untouched", () => {
  let h = X.exp("Iron deficiency is microcytic. Ref: Hoffbrand 7/e p44.", ctxOf(null));
  assert.ok(h.includes('<span class="pn-xchip">Hoffbrand 7/e p44.</span>'), h);
  h = X.exp("Anaemia in pregnancy\nREF: Dutta Obstetrics", ctxOf(null));
  assert.ok(h.includes('<span class="pn-xchip">Dutta Obstetrics</span>'), h);
  h = X.exp("ANSWTER: (A) 7-9 weeksREF: Dutta 6th ed p. 58-59HCG is a glycoprotein.", ctxOf(null));
  assert.ok(!h.includes("pn-xchip") && h.includes("weeksREF:"), "glued blob keeps its text, no false chip");
  assert.ok(preserved("ANSWTER: (A) 7-9 weeksREF: Dutta 6th ed p. 58-59HCG is a glycoprotein.", ctxOf(null)));
});

test("drugs, doses and option phrases embolden; stop-words and bare numbers do not", () => {
  const rx = X.drugRx(["metformin", "magnesium sulfate", "acid", "aspirin"]);
  const ctx = { o: ["Fibromuscular dysplasia"], a: 0, drugRx: rx };
  let h = X.inline("Take metformin 500 mg twice daily for fibromuscular dysplasia.", ctx);
  assert.ok(h.includes("<strong>metformin</strong>") && h.includes("<strong>500 mg</strong>"), h);
  assert.ok(/<strong>fibromuscular dysplasia<\/strong>/i.test(h), h);
  h = X.inline("Magnesium sulfate 4 g IV; folic acid daily; stop if eGFR falls below 30.", ctx);
  assert.ok(h.includes("<strong>Magnesium sulfate</strong>") && h.includes("<strong>4 g</strong>"), h);
  assert.ok(!h.includes("<strong>acid</strong>") && !h.includes("<strong>30</strong>"), h);
  h = X.inline("Aspirin and ASPIRIN 75 mg.", ctx);
  assert.ok(h.includes("<strong>Aspirin</strong>") && h.includes("<strong>ASPIRIN</strong>"), h);
  assert.ok(!/<strong>[^<]*<strong>/.test(h), "never nested");
  const names = X.drugNames(LX);
  assert.ok(names.includes("crocin") && names.includes("magnesium sulfate"), "brands and phrases listed");
  assert.ok(!names.includes("acid") && !names.includes("ion"), "common words excluded");
});

test("new structured Markdown renders natively with the same elements", () => {
  const ctx = ctxOf(null);
  let h = X.exp("**Answer: Fibromuscular dysplasia**\n\n**Why the others are wrong**\n- Atheroma narrows the ostium\n- Embolism cuts off suddenly", ctx);
  assert.ok(h.includes("<strong>Answer: Fibromuscular dysplasia</strong>"), h);
  assert.ok(h.includes("<ul>") && h.includes("<li>Atheroma narrows the ostium</li>"), h);
  h = X.exp("## Management\n1. Suspect\n2. Image\n\n| Feature | FMD |\n| --- | --- |\n| Site | Mid artery |", ctx);
  assert.ok(h.includes('<h4 class="pn-xh">Management</h4>') && h.includes("<ol>"), h);
  assert.ok(h.includes("<table>") && h.includes('<th scope="col">Feature</th>'), h);
  assert.ok(preserved("**Answer: FMD**", ctx) && X.kindOf("**Answer: FMD**", ctx) === "md");
});

test("abbreviations never split a sentence; doses and staging never listify", () => {
  const ctx = ctxOf(null);
  let h = X.exp("Vitamin A. deficiency leads to xerophthalmia. Give e.g. supplements for 2 yrs. Fig. 2 shows it.", ctx);
  assert.equal((h.match(/<p>/g) || []).length, 2, h + " (Fig. is an abbreviation: no split)");
  assert.ok(!h.includes("<ol") && !h.includes("<ul"), "no phantom lists");
  h = X.exp("The tumour is staged T1N0M0. Wide excision is planned.", ctx);
  assert.ok(!h.includes("<ol") && X.kindOf("Give 10 mg. Now repeat.", ctx) !== "semi");
});

test("XSS: script tags, handlers and links are inert text, never elements", () => {
  const ctx = ctxOf(null);
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>[x](javascript:alert(3))<a href="https://evil.test">y</a>';
  const h = X.exp(evil, ctx);
  assert.ok(!/<script/i.test(h) && !/<img/i.test(h) && !/<a[\s>]/.test(h), h);
  const deEsc = h.replace(/&lt;.*?&gt;/g, "");
  assert.ok(!/href=|src=|on\w+=/i.test(deEsc), "no live attributes: " + deEsc);
  const tags = h.match(/<[a-zA-Z\/!][^>]*>/g) || [];
  assert.ok(tags.length > 0 && tags.every((t) => /^<\/?(p|ul|ol|li|strong|span|h4|table|thead|tbody|tr|th|td|div)[\s>]/.test(t)), "only formatter tags: " + tags.join(" "));
  assert.ok(h.includes("&lt;script&gt;") && X.visible(h).includes("javascript:alert(3)"), "text kept, inert");
  for (const c of CORPUS) {
    const x = X.exp(c.exp, ctxOf(c));
    assert.ok(!/<(script|iframe|object|embed|form|input|button|select|textarea|link|meta|style)[\s>]/i.test(x), c.id);
    assert.ok(!/href=|src=|on\w+=/i.test(x.replace(/&lt;.*?&gt;/g, "")), c.id + " carries no attributes");
  }
});

test("blank, whitespace and very long blobs stay safe", () => {
  assert.equal(X.exp("", ctxOf(null)), "");
  assert.equal(X.exp("   \n  ", ctxOf(null)), "");
  assert.equal(X.exp(null, ctxOf(null)), "");
  const long = "word ".repeat(3000);
  const h = X.exp(long, ctxOf(null));
  assert.ok(h.startsWith("<p>") && X.visible(h) === long.trim(), "long blob is one escaped paragraph");
  assert.equal(X.kindOf("", ctxOf(null)), "empty");
});

test("tag hygiene on all 312: balanced strongs, no nesting, no leaks, no links", () => {
  for (const c of CORPUS) {
    const h = X.exp(c.exp, ctxOf(c));
    const o = (h.match(/<strong>/g) || []).length, cl = (h.match(/<\/strong>/g) || []).length;
    assert.equal(o, cl, c.id + " balances its emphasis");
    assert.ok(!/<strong>[^<]*<strong>/.test(h), c.id + " never nests");
    assert.ok(!/XFM-[SC]\d+@@/.test(h), c.id + " leaks no placeholder");
    assert.ok(!/<(a|script)[\s>]/i.test(h), c.id + " emits no links or scripts");
  }
});

test("per-option reasons and key points keep their text through inline", () => {
  let n = 0;
  for (const c of CORPUS) {
    const ctx = ctxOf(c);
    for (const r of (c.r || [])) {
      if (!String(r).trim()) continue;
      n++;
      assert.equal(X.visible(X.inline(r, ctx)), String(r).replace(/\s+/g, " ").trim(), c.id + " reason kept");
    }
    if (c.kp) {
      n++;
      assert.equal(X.visible(X.inline(c.kp, ctx)), c.kp.replace(/\s+/g, " ").trim(), c.id + " key point kept");
    }
  }
  assert.ok(n >= 300, "reason/key-point strings=" + n);
});

test("most explanations gain structure: answers, lists, tables, chips or emphasis", () => {
  const kinds = {};
  for (const c of CORPUS) {
    const k = X.kindOf(c.exp, ctxOf(c));
    kinds[k] = (kinds[k] || 0) + 1;
  }
  const shaped = CORPUS.length - (kinds.plain || 0);
  assert.ok(shaped >= 150, "shaped=" + shaped + " " + JSON.stringify(kinds));
});
