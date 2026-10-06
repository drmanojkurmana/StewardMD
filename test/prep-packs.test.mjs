/* prep-packs.test.mjs - tools/prep-packs.mjs (Layer B source packs): BM25 matching, JSON flattening, the pack word cap,
 * StatPearls nxml stripping, the streamed tar reader, and prep-fill's second pack root. No network.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-packs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as P from "../tools/prep-packs.mjs";
import { packDirOf } from "../tools/prep-fill.mjs";

const doc = (name, text, aliases = []) => ({ name, aliases, text, id: "kb-" + name.toLowerCase().replace(/\W+/g, "-") });
const DOCS = [
  doc("Atrial fibrillation", "Irregularly irregular rhythm. Rate control with beta-blockers, anticoagulation by CHA2DS2-VA score, cardioversion.", ["AF"]),
  doc("Acute pancreatitis", "Epigastric pain radiating to the back, lipase above three times normal, fluid resuscitation, gallstones and alcohol."),
  doc("Myasthenia gravis", "Fatigable ptosis and diplopia, acetylcholine receptor antibodies, pyridostigmine, thymectomy, myasthenic crisis."),
  doc("Hyponatraemia", "Serum sodium below 135, SIADH, urine osmolality, osmotic demyelination with rapid correction, hypertonic saline."),
];
const mod = (title, section, scope) => ({ id: "x", title, section, scope, fill: 40 });

test("BM25 ranks the right document first", () => {
  const ix = P.bm25(DOCS.map((d) => ({ tokens: P.docTokens(d) })));
  const cases = [
    [mod("Atrial fibrillation and flutter", "Arrhythmias", "anticoagulation, rate control, cardioversion"), "Atrial fibrillation"],
    [mod("Pancreatitis", "Pancreas", "lipase, gallstone pancreatitis"), "Acute pancreatitis"],
    [mod("Neuromuscular junction disorders", "Neuromuscular", "myasthenia gravis, thymectomy, pyridostigmine"), "Myasthenia gravis"],
    [mod("Disorders of sodium and water", "Electrolytes", "SIADH, osmotic demyelination, hyponatremia"), "Hyponatraemia"],
  ];
  for (const [m, want] of cases) {
    const hits = P.matchDocs(ix, DOCS, m, 0.05);
    assert.equal(hits[0].doc.name, want, m.title);
  }
  // British and American spellings meet; a module about nothing in the corpus matches nothing above threshold
  assert.deepEqual(P.tokenize("haemoglobin oedema anaemia"), P.tokenize("hemoglobin edema anemia"));
  assert.equal(P.matchDocs(ix, DOCS, mod("Forensic ballistics", "Forensics", "rifling, tattooing"), 0.3).length, 0);
});

test("flattenJson keeps prose and drops ids, sources, references, review, slugs and source names", () => {
  const t = P.flattenJson({
    id: "acs", name: "Acute coronary syndrome", drugRefs: ["aspirin"], references: ["Big Book 22e p.145"],
    sources: [{ org: "ESC", title: "Guideline title", url: "https://x" }], review: { status: "approved" },
    provenance: { primaryRef: "Harrison 22e" }, contentHash: "h1234",
    enrichment: { harrison: {
      pathophysiology: "Ischaemia arises from an imbalance between myocardial oxygen demand and supply in the coronary circulation, and severe prolonged ischaemia ends in infarction (Harrison 22e p.145).",
      clinicalPearls: ["An ECG is recommended within 10 minutes of presentation to find ST elevation candidates.", "Chest wall tenderness does not exclude ischaemia (pp. 150, 151)."],
      importedAt: "2026-06-29T00:00:00Z",
    } },
    stages: [{ code: "T1", label: "Tumour 2 cm or less" }],
  }, "Acute coronary syndrome");
  assert.match(t, /^# Acute coronary syndrome/);
  assert.match(t, /# Pathophysiology\nIschaemia arises/);
  assert.match(t, /ends in infarction\.$/m);
  assert.match(t, /T1: Tumour 2 cm or less/);
  assert.match(t, /Chest wall tenderness does not exclude ischaemia\./);
  for (const bad of [/harrison/i, /22e/, /p\.\s?\d/, /pp\./, /Big Book/, /Guideline title/, /https/, /approved/, /h1234/, /aspirin/, /2026-06-29/]) assert.doesNotMatch(t, bad);
});

test("capParts keeps a pack under the word cap on whole lines and drops heading-only parts", () => {
  const line = Array.from({ length: 50 }, (_, i) => "w" + i).join(" ");
  const part = (id) => ({ id, text: "# " + id + "\n" + Array(40).fill(line).join("\n") });   // ~2,000 words each
  const out = P.capParts([part("a"), part("b"), part("c"), part("d")], P.CAP_WORDS);
  const total = out.reduce((a, p) => a + p.words, 0);
  assert.ok(total <= P.CAP_WORDS && total > P.CAP_WORDS - 60, String(total));
  for (const p of out) assert.equal(p.words, P.words(p.text));
  assert.deepEqual(P.capParts([part("a")], 1), []);   // nothing fits but the heading: dropped
  assert.equal(P.targetWords(2), P.MIN_WORDS);
  assert.equal(P.targetWords(80), P.CAP_WORDS);
});

test("nxmlToText keeps clinical sections and drops references, review questions, tables and citation marks", () => {
  const xml = `<book-part-wrapper><book-part><book-part-meta><title-group><title>Organophosphate Toxicity</title></title-group></book-part-meta>
<body><sec><title>Pathophysiology</title><p>Organophosphates inhibit acetylcholinesterase [<xref ref-type="bibr" rid="r1">1</xref>, <xref ref-type="bibr" rid="r2">2</xref>], so acetylcholine accumulates [3, 4].</p>
<table-wrap id="t1"><caption><p>Table 1</p></caption><table><tr><td>secret table cell</td></tr></table></table-wrap>
<list><list-item><p>Miosis &amp; bradycardia</p></list-item></list></sec>
<sec><title>Review Questions</title><p>Click here for a question.</p></sec>
<sec><title>Enhancing Healthcare Team Outcomes</title><sec><title>Nested</title><p>team text</p></sec></sec>
<sec><title>Treatment / Management</title><p>Atropine is titrated to drying of secretions.</p></sec>
<ref-list><ref><element-citation>Some reference</element-citation></ref></ref-list></body></book-part></book-part-wrapper>`;
  const r = P.nxmlToText(xml);
  assert.equal(r.title, "Organophosphate Toxicity");
  assert.equal(r.text, "# Pathophysiology\nOrganophosphates inhibit acetylcholinesterase, so acetylcholine accumulates.\nMiosis & bradycardia\n# Treatment / Management\nAtropine is titrated to drying of secretions.");
});

test("tarScan streams a tar and returns only the wanted entries", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prep-packs-"));
  const src = path.join(dir, "bundle");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "article-1.nxml"), "<x>one</x>");
  fs.writeFileSync(path.join(src, "image.jpg"), Buffer.alloc(3000, 7));
  fs.writeFileSync(path.join(src, "article-2.nxml"), "two".repeat(400));
  execFileSync("tar", ["-cf", path.join(dir, "b.tar"), "-C", dir, "bundle"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const got = {};
  await P.tarScan(fs.createReadStream(path.join(dir, "b.tar"), { highWaterMark: 700 }), (n) => n.endsWith(".nxml"), (n, buf) => { got[path.basename(n)] = buf.toString(); return false; });
  assert.deepEqual(got, { "article-1.nxml": "<x>one</x>", "article-2.nxml": "two".repeat(400) });
  fs.rmSync(dir, { recursive: true });
});

test("writePack writes neutral ids and prep-fill finds a pack in the second root", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prep-packs-"));
  const a = path.join(dir, "repo"), b = path.join(dir, "extra");
  P.writePack(path.join(b, "m1"), [{ id: "sp-nbk1", title: "Reference chapter: X", url: "https://u", text: "# X\nSome text here.", words: 4 }]);
  const pj = JSON.parse(fs.readFileSync(path.join(b, "m1", "pack.json"), "utf8"));
  assert.deepEqual(pj.srcPack, [{ id: "sp-nbk1", title: "Reference chapter: X", url: "https://u" }]);
  assert.equal(pj.gen, "prep-packs");
  assert.ok(fs.existsSync(path.join(b, "m1", "01-sp-nbk1.txt")));
  assert.equal(packDirOf([a, b], "m1"), path.join(b, "m1"));
  assert.equal(packDirOf([a, b], "m2"), path.join(a, "m2"));
  fs.rmSync(dir, { recursive: true });
});
