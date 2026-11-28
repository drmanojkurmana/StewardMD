import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const TA = require(path.join(repoRoot, "research-thesis-auto.js"));

test("ES5 and copy invariants on research-thesis-auto.js and new CSS", () => {
  const autoSrc = fs.readFileSync(path.join(repoRoot, "research-thesis-auto.js"), "utf8");
  const scrSrc = fs.readFileSync(path.join(repoRoot, "research-screen-thesis.js"), "utf8");
  for (const tok of ["=>", "let ", "const ", "class ", "`", "\u2014", "\u2013"]) {
    assert.equal(autoSrc.includes(tok), false, "Forbidden token " + JSON.stringify(tok) + " in research-thesis-auto.js");
  }
  assert.equal(scrSrc.includes("\u2014"), false, "No em-dash in research-screen-thesis.js");
  assert.equal(scrSrc.includes("\u2013"), false, "No en-dash in research-screen-thesis.js");
  assert.equal(/border-(?:left|right):\s*[2-9]px/.test(scrSrc), false, "No CSS side-stripe borders >= 2px");
});

test("rankTargetJournals selects specialty-matched top 3 with limits", () => {
  const cardioPages = [{ n: 1, text: "Heart failure prevalence, echocardiography ejection fraction, NT-proBNP and coronary artery disease." }];
  const cardio = TA.rankTargetJournals(TA.FALLBACK_JOURNALS, [], { paperType: "obs", pages: cardioPages });
  assert.equal(cardio.top3.length, 3);
  assert.equal(cardio.best.id, "indian_heart_j");
  assert.ok(cardio.best.wordLimit > 0);
  assert.ok(cardio.best.abstractLimit > 0);
  assert.ok(cardio.best.maxReferences > 0);
  assert.ok(cardio.best.maxTables > 0);
  assert.ok(cardio.best.fitReason.length > 0);

  const orthoPages = [{ n: 1, text: "Lumbar spinal fusion with pedicle screw instrumentation and interbody bone graft outcomes." }];
  const ortho = TA.rankTargetJournals(TA.FALLBACK_JOURNALS, [], { paperType: "rct", pages: orthoPages });
  assert.equal(ortho.best.id, "indian_j_orthop");
});

test("condenseTables extracts content without prose captions, caps to limit, and renumbers sections", () => {
  const pages = [
    { n: 12, text: "Table 3.4 for multilevel fusions demonstrates stable fusion rates.\nTable 1: Baseline Characteristics of Cohort\nVariable  Group A  Group B  p value\nAge (years)  54.2 +/- 8.1  56.0 +/- 7.4  0.34\nMale sex  28 (56%)  25 (50%)  0.55\n" },
    { n: 14, text: "Table 2: Primary Postoperative Outcomes\nOutcome  Intervention  Control  p value\nFusion rate  46/50 (92%)  38/50 (76%)  0.02\nComplications  3 (6%)  5 (10%)  0.46\n" },
    { n: 16, text: "Table 3: Subgroup Sensitivity Analysis\nSubgroup  OR  95% CI\nAge > 60  1.42  1.05-1.92\nDiabetes  1.18  0.84-1.66\n" },
    { n: 18, text: "Table 4: Adverse Events\nEvent  Count\nNausea  4\nHeadache  2\n" }
  ];
  const rawTables = [
    { id: "Table 1", page: 12, caption: "Table 1: Baseline Characteristics of Cohort" },
    { id: "Table 2", page: 14, caption: "Table 2: Primary Postoperative Outcomes" },
    { id: "Table 3", page: 16, caption: "Table 3: Subgroup Sensitivity Analysis" },
    { id: "Table 4", page: 18, caption: "Table 4: Adverse Events" }
  ];
  const sections = [
    { id: "results", heading: "Results", text: "Baseline demographics appear in Table 1 and outcomes in Table 2." }
  ];
  const out = TA.condenseTables(rawTables, pages, { maxTables: 2 }, sections);
  assert.equal(out.kept.length, 2);
  assert.equal(out.droppedCount, 2);
  assert.equal(out.kept[0].id, "Table 1");
  assert.equal(out.kept[1].id, "Table 2");
  assert.ok(out.kept[0].content.rows.length >= 2);
  assert.match(out.sections[0].text, /Table 1/);
  assert.match(out.sections[0].text, /Table 2/);
});

test("parseStructuredBibEntry de-hyphenates wraps and extracts publication year over title years", () => {
  const e1 = TA.parseStructuredBibEntry("Campbell PT, Newton CC. Global epidemiology of heart fail-\nure trends 2003-2013. Bmj. 2017;356:j142.", "1");
  assert.match(e1.title, /heart failure/);
  assert.equal(e1.year, "2017");
  assert.equal(e1.journal, "Bmj");

  const e2 = TA.parseStructuredBibEntry("Lehr AM, Oner FC, Delawi D. Efficacy of allograft for spinal fusion: a systematic review. Spine J. 2012;12:412-420. doi:10.1016/j.spinee.2012.01.009", "4");
  assert.equal(e2.year, "2012");
  assert.equal(e2.doi, "10.1016/j.spinee.2012.01.009");
});

test("buildJournalReferences keeps only cited refs, formats by style, and renumbers citations", () => {
  const allBib = [
    { numMarker: "1", authors: "Alpha A, Beta B", title: "Uncited background paper", journal: "Med J", year: "2018", volume: "10", pages: "1-5" },
    { numMarker: "2", authors: "Smith J, Doe K", title: "Clinical cohort outcomes in sepsis", journal: "Crit Care Med", year: "2020", volume: "48", pages: "110-118", doi: "10.1097/ccm.0001" },
    { numMarker: "3", authors: "Patel R", title: "Multicentre validation trial", journal: "IJMR", year: "2022", volume: "155", pages: "22-30", pmid: "35000001" }
  ];
  const sections = [
    { id: "introduction", heading: "Introduction", text: "Prior work established risk predictors [2]." },
    { id: "results", heading: "Results", text: "Median SOFA score was 11 [9-14] vs 7 [5-9] in survivors (OR 0.34, 95% CI 0.17 to 0.68, p = 0.008)." },
    { id: "discussion", heading: "Discussion", text: "Our results align with recent trial data [3]." }
  ];
  const vanc = TA.buildJournalReferences(allBib, sections, { referenceStyle: "vancouver", maxReferences: 30 });
  assert.equal(vanc.citedCount, 2);
  assert.equal(vanc.totalBibliography, 3);
  assert.equal(vanc.oldToNew[2], 1);
  assert.equal(vanc.oldToNew[3], 2);
  assert.match(vanc.sections[0].text, /\[1\]/);
  assert.match(vanc.sections[1].text, /11 \[9-14\] vs 7 \[5-9\]/);
  assert.match(vanc.sections[2].text, /\[2\]/);
  assert.match(vanc.references[0].formatted, /^1\. Smith J, Doe K\./);

  const apa = TA.buildJournalReferences(allBib, sections, { referenceStyle: "apa", maxReferences: 30 });
  assert.equal(apa.references.length, 2);
  assert.ok(apa.references[0].authors.startsWith("Patel"));
  assert.match(apa.references[0].formatted, /\(2022\)\./);
});

test("verifyReferencesOnline verifies matched PubMed/Crossref hits and flags unverified without inventing", async () => {
  const refs = [
    { numMarker: "1", authors: "Smith J", title: "Heart failure registry study", journal: "BMJ", year: "2020", pmid: "123456" },
    { numMarker: "2", authors: "Unknown X", title: "Nonexistent obscure monograph", journal: "Local Notes", year: "2019" }
  ];
  const mockFetch = async (url) => {
    if (url.includes("esummary.fcgi") && url.includes("123456")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            "123456": {
              title: "Heart failure registry study.",
              pubdate: "2020 Mar",
              fulljournalname: "BMJ",
              authors: [{ name: "Smith J" }],
              articleids: [{ idtype: "doi", value: "10.1136/bmj.m100" }]
            }
          }
        })
      };
    }
    return {
      ok: true,
      json: async () => ({ message: { items: [] }, esearchresult: { idlist: [] } })
    };
  };
  const ver = await TA.verifyReferencesOnline(refs, mockFetch, { journal: { referenceStyle: "vancouver" } });
  assert.equal(ver.totalCount, 2);
  assert.equal(ver.verifiedCount, 1);
  assert.deepEqual(ver.unverifiedIndices, [2]);
  assert.equal(ver.references[0].verified, true);
  assert.equal(ver.references[0].verificationSource, "PubMed");
  assert.equal(ver.references[1].verified, false);
  assert.equal(ver.references[1].needCheck, true);
});

test("extractThesisClues and buildDeclarationsAndCredit avoid funding false positives and include AI disclosure", () => {
  const pages = [
    { n: 1, text: "Ethics approval IEC/2023/419. Study registered NCT04123456. Data were supported by previous reviews of similar cohorts." },
    { n: 2, text: "Financial support from National Health Research Council Grant 9981 was declared." }
  ];
  const clues = TA.extractThesisClues(pages);
  assert.equal(clues.iecNumber, "IEC/2023/419");
  assert.equal(clues.registration, "NCT04123456");
  assert.match(clues.funding, /National Health Research Council/);

  const tp = TA.buildTitlePage({
    pages: [{ n: 1, text: "A Randomised Controlled Trial of Early Mobilisation\nDr. Asha Menon\nAll India Institute of Medical Sciences, New Delhi" }],
    sections: [
      { id: "abstract", text: "Background: A. Methods: B. Results: C. Conclusion: D." },
      { id: "introduction", text: "One two three four five." }
    ],
    user: { displayName: "Dr. Asha Menon", email: "asha@aiims.edu", affiliation: "Dept of Orthopaedics, AIIMS New Delhi" },
    journal: { name: "Indian Journal of Orthopaedics" },
    tablesCount: 2,
    referencesCount: 15
  });
  assert.equal(tp.wordCounts.abstract, 8);
  assert.equal(tp.wordCounts.mainText, 5);
  assert.equal(tp.correspondingAuthor.email, "asha@aiims.edu");

  const decl = TA.buildDeclarationsAndCredit({ pages, titlePage: tp, aiProvenance: { aiUsed: true, models: ["gemini-2.5-flash"], verifiedByAuthor: false } });
  assert.equal(decl.ethics.iecNumber, "IEC/2023/419");
  assert.match(decl.aiDisclosure.text, /StewardMD/i);
  assert.ok(decl.credit.entries.length >= 1);
});

test("verifyKeywordsMesh, prefillChecklist, runFormatCheck, estimateAutoCost", async () => {
  const cands = TA.extractKeywordCandidates("Spinal Fusion Allograft Study", "Lumbar spinal fusion with ceramic bone graft showed 92% fusion.", []);
  assert.ok(cands.length >= 2);
  const mockFetch = async (url) => {
    if (url.includes("esearch.fcgi")) return { ok: true, json: async () => ({ esearchresult: { idlist: ["D013123"] } }) };
    if (url.includes("esummary.fcgi")) return { ok: true, json: async () => ({ result: { "D013123": { ds_meshterms: ["Spinal Fusion"] } } }) };
    return { ok: false };
  };
  const kw = await TA.verifyKeywordsMesh(["Spinal Fusion"], mockFetch);
  assert.equal(kw[0].meshVerified, true);
  assert.equal(kw[0].term, "Spinal Fusion");

  const secs = [
    { id: "abstract", text: "Background: Rationale and prior literature gap for spinal fusion grafting. Methods: Randomized controlled trial with explicit eligibility criteria, sample size calculation, computer-generated random allocation, and blinded outcome assessment. Results: Participant flow showed 50 randomized patients achieving 92% fusion with narrow 95% confidence intervals. Conclusion: Ceramic graft is non-inferior in primary clinical fusion." },
    { id: "introduction", text: "Autologous iliac crest bone graft has long served as the gold standard for posterolateral spinal fusion, though donor-site morbidity motivates synthetic bone substitutes. Our objective was to compare fusion rates, functional Oswestry disability index scores, and perioperative complications between beta-tricalcium phosphate and autograft in a pragmatic multicentre cohort." },
    { id: "methods", text: "We conducted a parallel-group randomized controlled trial with 1:1 central computer-generated allocation concealment across three tertiary orthopaedic centres after institutional ethics committee approval. Eligible adults aged 18 to 75 years scheduled for single-level instrumented posterolateral lumbar fusion were randomized to side-specific ceramic graft versus autograft with blinded CT assessment at 12 months." },
    { id: "results", text: "Of 62 screened patients, 50 participants completed random allocation and 48 completed 12-month follow-up imaging. Baseline age, sex distribution, smoking status, and comorbidity scores were balanced across arms. Primary fusion rate was 46/50 (92%) with no serious device-related adverse events or reoperations reported during follow-up." },
    { id: "discussion", text: "In this randomized trial, synthetic beta-tricalcium phosphate ceramic demonstrated fusion rates comparable to iliac crest autograft without donor-site pain. Key limitations include single-level pathology restriction and 12-month follow-up duration, which limit generalizability to multilevel revision spine deformities requiring longer biological incorporation." },
    { id: "conclusion", text: "Synthetic ceramic bone graft substitute provides reliable posterolateral lumbar fusion rates comparable to iliac crest autograft while eliminating donor-site harvest morbidity." }
  ];
  const cl = TA.prefillChecklist(null, "rct", secs, { funding: { text: "None" } }, { title: "Trial" });
  assert.equal(cl.guidelineId, "consort2025");
  assert.ok(cl.covered > 5);

  const fmt = TA.runFormatCheck({
    journal: { id: "ijmr", name: "IJMR", wordLimit: 3000, abstractLimit: 250, maxTables: 4, maxReferences: 35, referenceStyle: "vancouver" },
    sections: secs,
    references: [{ verified: true, formatted: "1. Ref." }],
    tables: [{ id: "Table 1" }],
    keywords: [{ term: "A" }, { term: "B" }, { term: "C" }],
    declarations: { ethics: { iecNumber: "IEC/1" } },
    checklistPrefill: { total: 10, covered: 10, missing: 0, guidelineName: "CONSORT" },
    titlePage: { hasPlaceholders: false }
  });
  assert.equal(fmt.failCount, 0);

  const cost = TA.estimateAutoCost([{ n: 1, text: "Short thesis under limit." }], {}, { wordLimit: 3000 });
  assert.equal(cost.aiCalls, 1);
  assert.equal(cost.estimatedMaikTokens, Math.round(0.06 * TA.MT_PER_INR));
});

test("buildSubmissionPackageFiles emits valid docx, PDF checklist, RIS, and ZIP bundle", () => {
  const state = {
    title: "Heart Failure Readmission Cohort",
    approved: false,
    titlePage: {
      title: "Heart Failure Readmission Cohort",
      shortTitle: "HF Readmissions",
      journalName: "Indian Heart Journal",
      authors: [{ name: "Dr. Ravi Kumar", affiliationNum: 1, isCorresponding: true }],
      affiliations: ["1. Dept of Cardiology, PGIMER"],
      correspondingAuthor: { name: "Dr. Ravi Kumar", email: "ravi@pgimer.edu", affiliation: "PGIMER" },
      wordCounts: { abstract: 120, mainText: 2400, tables: 1, figures: 0, references: 1 }
    },
    journal: { id: "indian_heart_j", name: "Indian Heart Journal", lineNumbers: true, referenceStyle: "vancouver" },
    sections: [
      { id: "abstract", heading: "Abstract", text: "Background: Context. Methods: Design. Results: n=120. Conclusion: Summary." },
      { id: "introduction", heading: "Introduction", text: "Heart failure causes substantial morbidity [1]." },
      { id: "methods", heading: "Methods", text: "Cohort of 120 adults." },
      { id: "results", heading: "Results", text: "Readmission occurred in 24 (20%)." },
      { id: "discussion", heading: "Discussion", text: "Consistent with global registries [1]." },
      { id: "conclusion", heading: "Conclusion", text: "Early follow-up reduces readmissions." }
    ],
    tables: [{
      id: "Table 1",
      caption: "Table 1: Baseline Cohort",
      content: { headers: ["Characteristic", "Value"], rows: [["Total patients", "120"], ["Readmission", "24 (20%)"]] }
    }],
    references: [{
      citationIndex: 1,
      authors: "Campbell PT, Newton CC",
      title: "Epidemiology of heart failure",
      journal: "BMJ",
      year: "2017",
      volume: "356",
      pages: "j142",
      doi: "10.1136/bmj.j142",
      verified: true,
      verificationSource: "Crossref",
      formatted: "1. Campbell PT, Newton CC. Epidemiology of heart failure. BMJ. 2017;356:j142."
    }],
    declarations: {
      ethics: { iecNumber: "IEC/2023/12", text: "Approved IEC/2023/12" },
      funding: { text: "No external funding" },
      conflicts: { text: "No conflicts" },
      consent: { text: "Consent obtained" },
      dataAvailability: { text: "Available on request" },
      aiDisclosure: { text: "Prepared with StewardMD ResearchMD AI assistance; verified by authors." },
      credit: { text: "Ravi Kumar: Conceptualization, Writing" }
    },
    checklistPrefill: {
      guidelineName: "STROBE",
      covered: 1,
      total: 1,
      items: [{ itemNum: "1", topic: "Title and abstract", status: "yes", section: "Title", text: "Covered" }]
    }
  };

  const pack = TA.buildSubmissionPackageFiles(state);
  assert.equal(pack.files.length, 8);
  const names = pack.files.map((f) => f.name);
  assert.deepEqual(names, [
    "01-title-page.docx",
    "02-manuscript.docx",
    "03-tables.docx",
    "04-cover-letter.docx",
    "05-reporting-checklist.docx",
    "05-reporting-checklist.pdf",
    "06-references.ris",
    "submission-manifest.txt"
  ]);
  /* Verify DOCX files start with PK ZIP header and checklist PDF starts with %PDF-1.4 */
  for (let i = 0; i < 5; i++) {
    assert.equal(pack.files[i].data[0], 0x50);
    assert.equal(pack.files[i].data[1], 0x4b);
  }
  const pdfStr = Buffer.from(pack.files[5].data).toString("latin1");
  assert.ok(pdfStr.startsWith("%PDF-1.4"));
  assert.ok(pdfStr.includes("%%EOF"));

  assert.match(pack.risText, /TY  - JOUR/);
  assert.match(pack.risText, /DO  - 10\.1136\/bmj\.j142/);
  assert.match(pack.risText, /ER  - /);

  assert.equal(pack.zipBytes[0], 0x50);
  assert.equal(pack.zipBytes[1], 0x4b);
  const manifestStr = Buffer.from(pack.files[7].data).toString("utf8");
  assert.match(manifestStr, /Approved: No/);

  const approvedPack = TA.buildSubmissionPackageFiles({ ...state, approved: true, approvedAt: "2026-11-28T10:00:00Z" });
  const approvedManifest = Buffer.from(approvedPack.files[7].data).toString("utf8");
  assert.match(approvedManifest, /Approved: Yes/);
});
