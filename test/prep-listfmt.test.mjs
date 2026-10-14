/* PrepNucleus list formatting (prep-listfmt.js): the safe render-only parser for run-together enumerations.
 * The corpus (test/prep-listfmt-corpus.json) holds 441 real bank stems plus real options and explanations pulled
 * from the published bank on 2026-10-14; the owner's item Q-8AV-4D5-GR7 is pinned exact.
 *
 * node --test test/prep-listfmt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LF = createRequire(import.meta.url)(join(ROOT, "prep-listfmt.js"));
const CORPUS = JSON.parse(fs.readFileSync(join(ROOT, "test/prep-listfmt-corpus.json"), "utf8"));

const OWNER_Q = "Arrange the incidence of various types of breast cancers in increasing incidence. a. PTEN ( Cowden disease )b. Sporadic breast cancerc. Hereditary breast cancerd. BRCA1e. BRCA2f. Familial breast cancer";
const OWNER_E = "Breast cancer Incidence Sporadic breast cancer 65-75 % Familial breast cancer 20-30 % Hereditary breast cancer 5-10 % BRCA1 45 % BRCA 2 35 % p53 ( Li-Fraumeni syndrome ) 1 % STK11/LKB1a (Peutz-Jegherssyndrome), PTENa (Cowdendisease), MSH2/MLH1a ( Muir-Torresyndrome), ATMa (Ataxiatelangiectasia ) Less than 1 % Unknown 20 %";

function stripTags(h) { return String(h).replace(/<[^>]*>/g, ""); }
function unesc(h) {
  return stripTags(h).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

test("owner item Q-8AV-4D5-GR7: stem parses to lead plus a) to f)", () => {
  const p = LF.parse(OWNER_Q);
  assert.ok(p && !p.match);
  assert.equal(p.lead, "Arrange the incidence of various types of breast cancers in increasing incidence.");
  assert.deepEqual(p.items.map((x) => x.label), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(p.items.map((x) => x.text), ["PTEN ( Cowden disease )", "Sporadic breast cancer", "Hereditary breast cancer", "BRCA1", "BRCA2", "Familial breast cancer"]);
});

test("owner item: stem renders as a neat list, one item per line", () => {
  assert.equal(LF.stem(OWNER_Q),
    '<p class="pn-lf-lead">Arrange the incidence of various types of breast cancers in increasing incidence.</p>' +
    '<ol class="pn-lf">' +
    '<li><span class="pn-lf-m" aria-hidden="true">a)</span><span>PTEN ( Cowden disease )</span></li>' +
    '<li><span class="pn-lf-m" aria-hidden="true">b)</span><span>Sporadic breast cancer</span></li>' +
    '<li><span class="pn-lf-m" aria-hidden="true">c)</span><span>Hereditary breast cancer</span></li>' +
    '<li><span class="pn-lf-m" aria-hidden="true">d)</span><span>BRCA1</span></li>' +
    '<li><span class="pn-lf-m" aria-hidden="true">e)</span><span>BRCA2</span></li>' +
    '<li><span class="pn-lf-m" aria-hidden="true">f)</span><span>Familial breast cancer</span></li>' +
    "</ol>");
});

test("owner item: pasted-table explanation renders as label/value rows", () => {
  const h = LF.exp(OWNER_E);
  assert.ok(h);
  assert.ok(h.includes('<p class="pn-lf-lead">Breast cancer Incidence</p>'));
  assert.ok(h.includes('<tr><th scope="row">Sporadic breast cancer</th><td>65-75 %</td></tr>'));
  assert.ok(h.includes('<tr><th scope="row">Familial breast cancer</th><td>20-30 %</td></tr>'));
  assert.ok(h.includes('<tr><th scope="row">Unknown</th><td>20 %</td></tr>'));
  assert.ok(h.includes('role="region"') && h.includes("<table"));
});

test("sequence options render as spaced chips with an accessible order", () => {
  for (const o of ["a,b,c,d,e,f", "a,d,b,c,f,e", "D>B>C>A", "b-d-a-c", "(i), (ii), (iii), (iv)", "(iii), (i), (iv), (ii)"]) {
    const h = LF.opt(o);
    assert.ok(h.includes('class="pn-seq"'), o);
    assert.ok(h.includes("aria-label"), o);
  }
  const h = LF.opt("a,d,b,c,f,e");
  assert.equal(unesc(h), "a › d › b › c › f › e");
  assert.ok(h.includes('aria-label="Order: a, d, b, c, f, e"'));
});

test("pair options align each pair", () => {
  for (const o of ["a-2, b-1", "1-E, 2-C, 3-D, 4-A", "1-b, 2-c, 3-a, 4-d"]) {
    const h = LF.opt(o);
    assert.ok(h.includes('class="pn-pairs"'), o);
    assert.ok(h.includes("pairs with"), o);
  }
  assert.equal(unesc(LF.opt("1-E, 2-C")), "1 – E, 2 – C");
});

test("ordinary options pass through escaped and unchanged", () => {
  for (const e of CORPUS.ordinary_options) assert.equal(LF.opt(e.o), LF.esc(e.o));
  assert.equal(LF.opt("Arrange for urgent plasmapheresis immediately"), "Arrange for urgent plasmapheresis immediately");
  assert.equal(LF.opt("10-20"), "10-20");
});

test("false positives stay untouched", () => {
  const texts = [
    "Which vitamin deficiency causes night blindness? Vitamin A. deficiency leads to xerophthalmia. Vitamin D. keeps bones strong.",
    "See Fig. 2. for the anatomy. The nerve passes medially.",
    "The tumour is staged T1N0M0. Wide excision is planned.",
    "Give 10 mg. Now repeat after 20 mg. Watch the pressure.",
    "A 5-day-old boy is seen after a diverting colostomy for anal atresia. He has a hemivertebra, a ventricular septal defect and an absent right radius. What is the most likely unifying diagnosis?",
    "Low DNA. The sample was sent for sequencing.",
    "Arrange for urgent plasmapheresis immediately.",
    "e.g. penicillin causes allergy. i.e. avoid it.",
  ];
  for (const t of texts) {
    assert.equal(LF.parse(t), null, t.slice(0, 60));
    assert.equal(LF.stem(t), LF.esc(t), t.slice(0, 60));
  }
});

test("a phantom first label does not hide the genuine run behind it", () => {
  const p = LF.parse("Colostomy for anal atresia. He has anomalies. a. Real one b. Real two c. Real three");
  assert.ok(p && !p.match);
  assert.deepEqual(p.items.map((x) => x.text), ["Real one", "Real two", "Real three"]);
});

test("match-the-following stems become a two-column table with headers", () => {
  const q = "Match each interstitial lung disease pattern with its characteristic imaging finding.\nColumn A\nA. UIP\nB. NSIP\nC. LCH\nD. COP\nColumn B\n1. Honeycombing\n2. Sub-pleural sparing\n3. Bizarre cysts\n4. Atoll sign";
  const p = LF.parse(q);
  assert.ok(p && p.match);
  assert.deepEqual(p.match.cols.map((c) => c.items.length), [4, 4]);
  assert.equal(p.lead, "Match each interstitial lung disease pattern with its characteristic imaging finding.");
  for (const c of p.match.cols) for (const it of c.items) assert.ok(!/column/i.test(it.text));
  const h = LF.stem(q);
  assert.ok(h.includes('<th scope="col">Column I</th>') && h.includes('<th scope="col">Column II</th>'));
  assert.ok(h.includes("Honeycombing") && h.includes("Sub-pleural sparing"));
});

test("roman and numbered runs parse; XSS is escaped", () => {
  const r = LF.parse("Arrange the structures pierced (outside to inside): i) Skin ii) Fascia iii) Muscle iv) Peritoneum");
  assert.ok(r && r.items.length === 4 && r.ol === "i");
  const n = LF.parse("Pick the contraindication: 1. Asthma 2. Heart block 3. Allergy");
  assert.ok(n && n.items.length === 3 && n.ol === "1");
  const x = LF.stem('Weird <script>alert("x")</script> a. One b. Two');
  assert.ok(!x.includes("<script>") && x.includes("&lt;script&gt;"));
  assert.equal(LF.exp("No percents here, just prose about 65 patients and 20 controls."), null);
});

test("corpus: 441 real stems never throw; confident parses keep every word", () => {
  assert.ok(CORPUS.stems.length >= 400);
  let parsed = 0, tables = 0;
  for (const s of CORPUS.stems) {
    const p = LF.parse(s.q);
    const h = LF.stem(s.q);
    if (!p) { assert.equal(h, LF.esc(s.q)); continue; }
    parsed++;
    if (p.match) {
      tables++;
      for (const c of p.match.cols) for (const it of c.items) assert.ok(h.includes(LF.esc(it.text)), s.i);
    } else {
      assert.ok(p.items.length >= 2);
      assert.ok(h.includes(LF.esc(p.lead)) || !p.lead);
      for (const it of p.items) assert.ok(h.includes(LF.esc(it.text)), s.i + " " + it.label);
      assert.ok(h.includes("<ol"));
    }
  }
  assert.ok(parsed >= 200, "parsed " + parsed);
});

test("corpus: clean stems (no enumeration) never parse", () => {
  const clean = CORPUS.stems.filter((s) => s.f === "clean");
  assert.ok(clean.length >= 100);
  for (const s of clean) assert.equal(LF.parse(s.q), null, s.i + " " + s.q.slice(0, 80));
});

test("corpus: options and explanations never throw and never lose text", () => {
  for (const e of CORPUS.seq_options) {
    const h = LF.opt(e.o);
    for (const tok of String(e.o).split(/[,;>\-–()\s]+/).filter(Boolean)) assert.ok(unesc(h).includes(tok), e.o);
  }
  for (const e of CORPUS.pct_exps) {
    const h = LF.exp(e.e);
    if (!h) continue;
    for (const m of e.e.match(/\d+(?:\s*[–-]\s*\d+)?\s*%/g) || []) assert.ok(unesc(h).includes(m.replace(/\s+/g, " ").trim().replace(/ +/g, " ").replace(/^/, "")), e.i);
  }
  for (const e of CORPUS.ordinary_exps) assert.doesNotThrow(() => LF.exp(e.e));
});
