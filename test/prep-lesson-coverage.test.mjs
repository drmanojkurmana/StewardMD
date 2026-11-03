// test/prep-lesson-coverage.test.mjs — Unit test for Gate 2: Blueprint mustKnow fact coverage verifier
import test from "node:test";
import assert from "node:assert/strict";
import { checkFactCoverage, gatherLessonText, verifySubjectCoverage } from "../tools/prep-lesson-coverage.mjs";

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
