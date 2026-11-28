/* Unit tests for Brief K chapter-aware thesis segmentation, mapping,
 * DOCX heading detection, reference citation filtering, and bounded concurrency.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deflateRawSync } from "node:zlib";

const require = createRequire(import.meta.url);
const TH = require("../research-screen-thesis.js");

function makeLine(tx, size, bold, italic, caps) {
  return {
    tx,
    size: size || 11,
    bold: bold === undefined ? undefined : bold,
    italic: italic === undefined ? false : italic,
    caps: caps === undefined ? false : caps
  };
}

function makeDocxZip(documentXml) {
  const entries = [
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") }
  ];
  const localParts = [];
  const cdParts = [];
  let offset = 0;
  for (const en of entries) {
    const nameB = Buffer.from(en.name, "utf8");
    const body = deflateRawSync(en.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(en.data.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    localParts.push(lh, nameB, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(en.data.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    cdParts.push(ch, nameB);
    offset += lh.length + nameB.length + body.length;
  }
  const cd = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cd, eocd]);
}

function makeIndianMdMsPages() {
  const specs = [
    { n: 1, title: "Certificates", kind: "fm", text: "Certified that this bonafide thesis work was carried out." },
    { n: 2, title: "Acknowledgements", kind: "fm", text: "I thank my guide and patients." },
    { n: 3, title: "Table of Contents", kind: "fm", text: "1. Introduction .... 4\n2. Review of Literature .... 6" },
    { n: 4, title: "1. Introduction", kind: "ch", text: "Sepsis causes 24% mortality in ICU admissions worldwide [1].", sub: "1.1 Rationale" },
    { n: 5, title: "2. Aims and Objectives", kind: "ch", text: "To determine 28-day mortality and SOFA score utility in sepsis [2]." },
    { n: 6, title: "3. Review of Literature", kind: "ch", text: "Colditz et al. reviewed earlier prognostic biomarkers [3]. " + "Extensive background narrative. ".repeat(35) },
    { n: 7, title: "4. Materials and Methods", kind: "ch", text: "Prospective cohort study of 180 adult ICU patients from January 2023 to June 2024.", tblHead: "Table 1. Baseline Inclusion Criteria" },
    { n: 8, title: "5. Observations and Results", kind: "ch", text: "Table 2 shows mortality was 32/180 (17.8%, p = 0.004) in sepsis patients [1, 2].", tblHead: "Patient Group" },
    { n: 9, title: "6. Discussion", kind: "ch", text: "Our mortality rate of 17.8% aligns with published cohorts [1]." },
    { n: 10, title: "7. Conclusion", kind: "ch", text: "Early lactate clearance predicts 28-day survival in ICU sepsis." },
    { n: 11, title: "8. Bibliography", kind: "ref", text: "1. Kumar A. Sepsis outcomes in ICU. IJCCM 2022;26:10-15.\n2. Rao B. SOFA score accuracy. Lancet Resp 2023;11:44-50.\n3. Uncited Author. Review of historical trials. NEJM 2010;362:1-9." },
    { n: 12, title: "Annexure 1: Case Proforma and Consent Form", kind: "annex", text: "Patient serial number: ___ Informed consent signature: ___" }
  ];
  const pages = [];
  const pageLines = [];
  for (const sp of specs) {
    const lines = [makeLine(sp.title, 16, true, false, false)];
    if (sp.sub) lines.push(makeLine(sp.sub, 13, true, false, false));
    if (sp.tblHead) lines.push(makeLine(sp.tblHead, 9.5, true, false, false)); // small bold table header must not become chapter
    for (let k = 0; k < 6; k++) {
      lines.push(makeLine(sp.text + " Line " + k + ".", 11, false, false, false));
    }
    pageLines.push({ n: sp.n, lines });
    pages.push({ n: sp.n, text: lines.map((l) => l.tx).join("\n") });
  }
  return { pages, pageLines };
}

test("detectThesisHeadings handles Indian MD/MS theses, filters small bold table headers, and degrades when bold is absent", function () {
  const { pages, pageLines } = makeIndianMdMsPages();
  const det = TH.detectThesisHeadings(pageLines, pages);
  assert.ok(det.headings.length >= 10);
  const titles = det.headings.map((h) => h.title);
  assert.ok(titles.some((t) => /Introduction/i.test(t)));
  assert.ok(titles.some((t) => /Observations and Results/i.test(t)));
  assert.ok(titles.some((t) => /Bibliography/i.test(t)));
  assert.ok(!titles.some((t) => t === "Patient Group"), "small bold table header must not promote to heading");

  // Degrade gracefully when line.bold is absent (e.g., pdf.js size-only fallback)
  const sizeOnlyLines = pageLines.map((pg) => ({
    n: pg.n,
    lines: pg.lines.map((l) => makeLine(l.tx, l.size, undefined, false, l.caps))
  }));
  const detNoBold = TH.detectThesisHeadings(sizeOnlyLines, pages);
  assert.ok(detNoBold.headings.some((h) => /Materials and Methods/i.test(h.title)));
  assert.ok(detNoBold.headings.some((h) => /Conclusion/i.test(h.title)));
});

test("detectThesisHeadings handles Lehr-style CHAPTER N + wrapped caps and filters running headers", function () {
  const pages = [];
  const pageLines = [];
  for (let p = 1; p <= 8; p++) {
    const lines = [makeLine(String(10 + p), 13.6, false, false, false)]; // running page number must be ignored
    if (p === 1) {
      lines.push(makeLine("CHAPTER 1", 23.5, true, false, true));
      lines.push(makeLine("Introduction and aims", 19.6, false, false, false));
    } else if (p === 2) {
      lines.push(makeLine("CHAPTER 2", 23.5, true, false, true));
      lines.push(makeLine("Long-term (>10 years) clinical outcomes of", 19.6, false, false, false));
      lines.push(makeLine("posterolateral lumbar fusion", 19.6, false, false, false));
      lines.push(makeLine("Introduction", 13.6, true, false, false));
    } else if (p === 3) {
      lines.push(makeLine("Methods", 13.6, true, false, false));
    } else if (p === 4) {
      lines.push(makeLine("Results", 13.6, true, false, false));
    } else if (p === 5) {
      lines.push(makeLine("Discussion", 13.6, true, false, false));
    } else if (p === 6) {
      lines.push(makeLine("CHAPTER 8: General discussion and future directions", 19.6, true, false, false));
    } else if (p === 7) {
      lines.push(makeLine("References", 19.6, true, false, false));
    } else if (p === 8) {
      lines.push(makeLine("Curriculum Vitae", 19.6, true, false, false));
    }
    for (let b = 0; b < 8; b++) {
      lines.push(makeLine("Body paragraph " + b + " describing randomized surgical fusion follow-up across 60 patients.", 9.5, false, false, false));
    }
    pageLines.push({ n: p, lines });
    pages.push({ n: p, text: lines.map((l) => l.tx).join("\n") });
  }
  const tree = TH.buildChapterTree(pageLines, pages);
  const titles = tree.chapters.map((c) => c.title);
  assert.ok(titles.some((t) => /CHAPTER 2: Long-term.*posterolateral lumbar fusion/i.test(t)), "wraps CHAPTER + title lines: " + JSON.stringify(titles));
  const ch2 = tree.chapters.find((c) => /CHAPTER 2/i.test(c.title));
  assert.ok(ch2 && ch2.children.length >= 4, "captures study IMRaD subheadings");

  const mapped = TH.mapChaptersToJournal(tree, pages, null, "rct", {});
  assert.ok(mapped.excluded.some((e) => /Curriculum Vitae/i.test(e.title)));
  assert.ok(mapped.bySection.results.pages.length >= 1, "maps multi-study results");
  assert.ok(mapped.items.some((it) => it.target === "discussion" && /General discussion/i.test(it.title)));
});

test("mapChaptersToJournal maps Indian MD/MS chapters accurately, excludes front-matter/annexures without dropping them silently, and obeys overrides", function () {
  const { pages, pageLines } = makeIndianMdMsPages();
  const tree = TH.buildChapterTree(pageLines, pages);
  const mapped = TH.mapChaptersToJournal(tree, pages, null, "cohort", {});

  const introItems = mapped.items.filter((it) => it.target === "introduction");
  assert.ok(introItems.some((c) => /Introduction/i.test(c.title)));
  assert.ok(introItems.some((c) => /Aims and Objectives/i.test(c.title)));
  assert.ok(introItems.some((c) => /Review of Literature/i.test(c.title)));
  const lit = introItems.find((c) => /Review of Literature/i.test(c.title));
  assert.equal(lit.condenseReview, true);

  assert.ok(mapped.items.some((c) => c.target === "methods" && /Materials and Methods/i.test(c.title)));
  assert.ok(mapped.items.some((c) => c.target === "results" && /Observations and Results/i.test(c.title)));
  assert.ok(mapped.items.some((c) => c.target === "discussion" && /Discussion/i.test(c.title)));
  assert.ok(mapped.items.some((c) => c.target === "conclusion" && /Conclusion/i.test(c.title)));
  assert.ok(mapped.items.some((c) => c.target === "references" && /Bibliography/i.test(c.title)));
  assert.ok(mapped.bySection.introduction.pages.length >= 3);
  assert.ok(mapped.bySection.methods.pages.length >= 1);

  const exclTitles = mapped.excluded.map((c) => c.title);
  assert.ok(exclTitles.some((t) => /Certificates/i.test(t)));
  assert.ok(exclTitles.some((t) => /Table of Contents/i.test(t)));
  assert.ok(exclTitles.some((t) => /Annexure/i.test(t)));
  assert.equal(mapped.items.length, tree.chapters.length, "every detected chapter is accounted for in items");

  // User overrides move chapter cleanly
  const annx = tree.chapters.find((c) => /Annexure/i.test(c.title));
  const remapped = TH.mapChaptersToJournal(tree, pages, null, "cohort", { [annx.id]: "methods" });
  assert.ok(remapped.items.some((c) => c.id === annx.id && c.target === "methods"));
  assert.ok(!remapped.excluded.some((c) => c.id === annx.id));
});

test("parseDocx extracts Heading 1/2/3 styles into structured chapter tree", async function () {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>1. Introduction</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>' + 'Background sentence describing cohort rationale. '.repeat(20) + '</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>1.1 Aims and Objectives</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>' + 'Primary outcome is 30-day survival. '.repeat(20) + '</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>2. Materials and Methods</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>' + 'Eligible ICU adults aged 18 to 80 were enrolled. '.repeat(20) + '</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Annexure: Master Chart</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Patient raw rows 1 to 10.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const buf = makeDocxZip(xml);
  const pages = await TH.parseDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.ok(Array.isArray(pages._pageLines) && pages._pageLines.length >= 1);
  const tree = TH.buildChapterTree(pages._pageLines, pages);
  assert.ok(tree.chapters.some((c) => /Introduction/i.test(c.title)));
  assert.ok(tree.chapters.some((c) => /Materials and Methods/i.test(c.title)));
  const intro = tree.chapters.find((c) => /Introduction/i.test(c.title));
  assert.ok(intro.children.some((s) => /Aims and Objectives/i.test(s.title)));
  const mapped = TH.mapChaptersToJournal(tree, pages, null, "cohort", {});
  assert.ok(mapped.excluded.some((c) => /Annexure/i.test(c.title)));
});

test("extractThesisReferences keeps only cited references when citedText + refPages are given", function () {
  const { pages } = makeIndianMdMsPages();
  const refPages = pages.filter((p) => p.n === 11);
  const cited = "Mortality was 17.8% across 180 adults [1, 2].";
  const filtered = TH.extractThesisReferences(pages, { refPages, citedText: cited });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.some((r) => /Kumar A/i.test(r.title)));
  assert.ok(filtered.some((r) => /Rao B/i.test(r.title)));
  assert.ok(!filtered.some((r) => /Uncited Author/i.test(r.title)));

  // Legacy 1-arg form keeps all references
  const all = TH.extractThesisReferences(pages);
  assert.equal(all.length, 3);
});

test("runBoundedPool limits concurrent execution to 3 and preserves index order", async function () {
  let active = 0;
  let peak = 0;
  const delays = [40, 10, 30, 5, 25, 15, 5];
  const tasks = delays.map((ms, idx) => async () => {
    active += 1;
    if (active > peak) peak = active;
    await new Promise((r) => setTimeout(r, ms));
    active -= 1;
    return "sec-" + idx;
  });
  const out = await TH.runBoundedPool(tasks, 3);
  assert.equal(peak, 3);
  assert.deepEqual(out.map((r) => r.value), ["sec-0", "sec-1", "sec-2", "sec-3", "sec-4", "sec-5", "sec-6"]);
});

test("verifyNumbers caches duplicate tokens across 341 pages and accurately resolves page/table locators", function () {
  const pages = [];
  for (let p = 1; p <= 341; p++) {
    pages.push({
      n: p,
      text: p === 142
        ? "Table 4 Baseline cohorts. In this cohort 18.4% of 312 patients had event."
        : "Page " + p + " filler clinical text with value " + (1000 + p) + "."
    });
  }
  const draft = ("Cohort mortality was 18.4% across 312 patients. ").repeat(40) + "Unverified figure 99.9% occurred.";
  const res = TH.verifyNumbers(draft, pages);
  assert.equal(res.flags.length, 1);
  assert.equal(res.flags[0].number, "99.9");
  const loc = res.locators.find((l) => l.number === "18.4");
  assert.deepEqual(loc, { number: "18.4", page: 142, table: 4 });
});
