// test/prep-lesson-coverage.test.mjs — Unit test for Gate 2: Blueprint mustKnow fact coverage verifier
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkFactCoverage, gatherLessonText, normFact, verifySubjectCoverage } from "../tools/prep-lesson-coverage.mjs";

test("checkFactCoverage: matches terms, numbers and drugs in lesson text", () => {
  const lessonText = "Type III collagen is synthesised early in granulation tissue, later replaced by Type I collagen to establish an adult ratio of 4:1. Cefazolin provides surgical antibiotic prophylaxis.";

  const fact1 = {
    fact: "Type III collagen is replaced by Type I collagen in a 4:1 ratio.",
    terms: ["Type III collagen", "Type I collagen"],
    numbers: ["4:1"],
  };
  assert.deepEqual(checkFactCoverage(fact1, lessonText), { covered: true, missing: [] });

  const factWithDrug = {
    fact: "Cefazolin is given for prophylaxis.",
    terms: ["prophylaxis"],
    drugs: ["cefazolin"],
  };
  assert.deepEqual(checkFactCoverage(factWithDrug, lessonText), { covered: true, missing: [] });

  const missingTerm = {
    fact: "Fibronectin guides migration.",
    terms: ["fibronectin"],
  };
  const resMissingTerm = checkFactCoverage(missingTerm, lessonText);
  assert.equal(resMissingTerm.covered, false);
  assert.match(resMissingTerm.missing[0], /fibronectin/);

  const missingNumber = {
    fact: "Tensile strength reaches 80% at 3 months.",
    terms: ["collagen"],
    numbers: ["80%"],
  };
  const resMissingNum = checkFactCoverage(missingNumber, lessonText);
  assert.equal(resMissingNum.covered, false);
  assert.match(resMissingNum.missing[0], /80%/);

  const missingDrug = {
    fact: "Vancomycin is given for MRSA.",
    terms: ["prophylaxis"],
    drugs: ["vancomycin"],
  };
  const resMissingDrug = checkFactCoverage(missingDrug, lessonText);
  assert.equal(resMissingDrug.covered, false);
  assert.match(resMissingDrug.missing[0], /vancomycin/);
});

test("gatherLessonText: extracts all text from steps, say, and visuals", () => {
  const sampleLesson = {
    module: "test-module",
    steps: [
      {
        tx: "Step one with **key term** and text.",
        say: "Narration for step one.",
        vis: {
          kind: "table",
          cols: ["Stage", "Description"],
          rows: [["T1", "Under 2 cm"], ["T2", "Between 2 and 5 cm"]],
        },
      },
      {
        tx: "Step two text.",
        say: "Narration for step two.",
        vis: {
          kind: "compare",
          left: { title: "Left side", points: ["Point A", "Point B"] },
          right: { title: "Right side", points: ["Point C", "Point D"] },
        },
      },
    ],
  };

  const text = gatherLessonText(sampleLesson);
  assert.match(text, /key term/);
  assert.match(text, /Narration for step one/);
  assert.match(text, /Under 2 cm/);
  assert.match(text, /Point A/);
  assert.match(text, /Point D/);
});

test("verifySubjectCoverage: computes coverage from blueprint", () => {
  const blueprint = {
    subject: "ss-test",
    title: "Test Specialty",
    sections: [
      {
        id: "sec-1",
        name: "Section 1",
        modules: [
          {
            id: "sur-breast-cancer",
            name: "Breast Cancer",
            topics: [
              {
                id: "sur-breast-cancer",
                title: "Breast Cancer Assessment",
                mustKnow: [
                  {
                    fact: "About 70 percent of cases are found at 55 or older.",
                    terms: ["breast cancer"],
                    numbers: ["70"],
                  },
                  {
                    fact: "Trastuzumab targets HER2 receptor.",
                    terms: ["HER2"],
                    drugs: ["trastuzumab"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const report = verifySubjectCoverage(blueprint);
  assert.equal(report.subject, "ss-test");
  assert.equal(report.totalTopics, 1);
  assert.equal(report.totalFacts, 2);
  assert.equal(report.coveredFacts, 2);
  assert.equal(report.coveragePct, 100);
});

test("verifySubjectCoverage: supports lessonTopics blueprints (paediatric lanes)", () => {
  const blueprint = {
    subject: "ss-pgt",
    title: "Paediatric Gastroenterology",
    sections: [
      {
        id: "sec-1",
        title: "Section 1",
        modules: [
          {
            id: "pgt-gi-nutrition",
            title: "Celiac Disease and Small Bowel Enteropathies",
            lessonTopics: [
              {
                id: "pgt-celiac-demo",
                title: "Celiac Disease",
                mustKnow: [{ fact: "Anti-tTG IgA with total IgA screens suspected disease.", terms: ["anti-tTG IgA"], numbers: [] }],
              },
            ],
          },
        ],
      },
    ],
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-lt-"));
  fs.writeFileSync(path.join(dir, "pgt-celiac-demo.json"), JSON.stringify({
    v: 1, module: "Celiac Disease and Small Bowel Enteropathies", subject: "ss-pgt", title: "Celiac demo", gen: "AI", quiz: [],
    steps: [
      { tx: "Order **anti-tTG IgA** with total serum IgA in every suspected child while gluten continues in the diet daily.", say: "Screen with the antibody pair on a normal diet.", vis: { kind: "table", cols: ["A", "B"], rows: [["x", "y"], ["z", "w"]] } },
      { tx: "A second step with enough words to satisfy the shape gate is present here for the test.", say: "Narration present.", vis: { kind: "table", cols: ["A", "B"], rows: [["x", "y"], ["z", "w"]] } },
      { tx: "A third step with enough words to satisfy the shape gate is present here for the test.", say: "Narration present.", vis: { kind: "table", cols: ["A", "B"], rows: [["x", "y"], ["z", "w"]] } },
      { tx: "A fourth step with enough words to satisfy the shape gate is present here for the test.", say: "Narration present.", vis: { kind: "table", cols: ["A", "B"], rows: [["x", "y"], ["z", "w"]] } },
    ],
  }));
  const report = verifySubjectCoverage(blueprint, dir);
  assert.equal(report.totalTopics, 1);
  assert.equal(report.totalFacts, 1);
  assert.equal(report.coveredFacts, 1);
  assert.equal(report.topics[0].id, "pgt-celiac-demo");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("normFact: plain string facts gain their numbers", () => {
  assert.deepEqual(normFact("Titre of 1:160 or higher is significant in 2019 criteria."),
    { fact: "Titre of 1:160 or higher is significant in 2019 criteria.", numbers: ["1:160", "2019"] });
  assert.deepEqual(normFact({ fact: "x", terms: ["x"] }), { fact: "x", terms: ["x"] });
});

test("verifySubjectCoverage: supports flat blueprints with string facts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  fs.writeFileSync(path.join(dir, "srh-flat-demo.json"), JSON.stringify({
    v: 1, module: "srh-flat-demo", subject: "ss-x", title: "Flat demo", minutes: 5, gen: "AI", quiz: [],
    steps: [
      { tx: "Antinuclear antibody testing by indirect immunofluorescence is the screening test with a titre of **1:160** or higher counting as significant in criteria from 2019.", say: "Screening uses immunofluorescence with a cutoff that indicates disease.", vis: { kind: "table", cols: ["A", "B"], rows: [["x", "y"], ["z", "w"]] } },
      { tx: "A second step with enough words to satisfy the shape gate is present here for the test.", say: "This narration is present.", vis: { kind: "table", cols: ["A", "B"], rows: [["x", "y"], ["z", "w"]] } },
      { tx: "A third step with enough words to satisfy the shape gate is present here for the test.", say: "This narration is present.", vis: { kind: "table", cols: ["A", "B"], rows: [["x", "y"], ["z", "w"]] } },
      { tx: "A fourth step with enough words to satisfy the shape gate is present here for the test.", say: "This narration is present.", vis: { kind: "table", cols: ["A", "B"], rows: [["x", "y"], ["z", "w"]] } },
    ],
  }));
  const blueprint = {
    subject: "ss-x",
    title: "Flat Specialty",
    topics: [
      { id: "srh-flat-demo", title: "Flat demo", mustKnow: ["Antinuclear antibody testing by indirect immunofluorescence with titre 1:160 significant in 2019 criteria."] },
      { id: "srh-flat-missing", title: "Missing", mustKnow: ["Some fact that has no lesson file."] },
    ],
  };
  const report = verifySubjectCoverage(blueprint, dir);
  assert.equal(report.totalTopics, 2);
  assert.equal(report.totalFacts, 2);
  assert.equal(report.coveredFacts, 1);
  assert.equal(report.topics[0].coveragePct, 100);
  assert.equal(report.topics[1].lessonPresent, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
