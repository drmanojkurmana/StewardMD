/* ResearchMD Phase 5B submission pack.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-submission.test.mjs
 *
 * The pack is a draft the researcher uploads. This module does not send it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const SUB = require("../research-submission.js");

function deepFreeze(o) {
  if (o && typeof o === "object") {
    Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    Object.freeze(o);
  }
  return o;
}

function fullInput() {
  return {
    title: "BCG vaccination and tuberculosis in children",
    journal: "The Lancet",
    date: "24 Nov 2026",
    editor: "The Editors",
    summary: "This review estimates the risk ratio.",
    studyType: "Systematic review",
    registration: "PROSPERO CRD42025000001",
    authors: ["A. Aronson", "B. Ferguson"],
    corresponding: "A. Aronson, example@example.test",
    declarations: {
      funding: "No specific funding.",
      conflicts: { none: true },
      ethics: { notRequired: true, reason: "This is a review of published studies." },
      dataAvailability: { statement: "Data are in the project record.", url: "https://example.test/data" },
      aiUse: { used: false }
    }
  };
}

test("exports coverLetter, declarations, and manifest", function () {
  assert.equal(SUB.name, "research-submission");
  assert.equal(SUB.version, "rmd1");
  assert.equal(typeof SUB.coverLetter, "function");
  assert.equal(typeof SUB.declarations, "function");
  assert.equal(typeof SUB.manifest, "function");
  const src = readFileSync(new URL("../research-submission.js", import.meta.url), "utf8");
  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.equal(fakeWindow.SMD_RESEARCH_SUBMISSION.version, "rmd1");
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.equal(stripped.indexOf("direct submission"), -1);
  assert.ok(!/\bnew Date\b/.test(stripped));
  assert.ok(!/\bMath\.random\b/.test(stripped));
  assert.equal(stripped.indexOf("\u2014"), -1);
  assert.equal(stripped.indexOf("\u2013"), -1);
});

test("a complete cover letter lists nothing missing", function () {
  const input = fullInput();
  deepFreeze(input);
  const before = JSON.stringify(input);
  const letter = SUB.coverLetter(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(letter.missing, []);
  assert.equal(letter.draft, true);
  assert.equal(letter.sent, false);
  assert.ok(letter.subject.indexOf("BCG vaccination and tuberculosis in children") !== -1);
  assert.ok(letter.body.indexOf("BCG vaccination and tuberculosis in children") !== -1);
  assert.ok(letter.body.indexOf("The Lancet") !== -1);
  assert.ok(letter.body.indexOf("A. Aronson, B. Ferguson") !== -1);
  assert.ok(letter.body.indexOf("24 Nov 2026") !== -1);
  assert.ok(letter.body.indexOf("Dear The Editors,") !== -1);
  assert.ok(letter.body.indexOf("The authors declare no competing interests.") !== -1);
  assert.ok(letter.body.indexOf("No generative model was used") !== -1);
  assert.equal(letter.body.indexOf("{{"), -1);
  assert.equal(letter.body.indexOf("\u2014"), -1);
  assert.equal(letter.body.indexOf("\u2013"), -1);
});

test("a title-only letter does not invent a journal or leave a token", function () {
  const letter = SUB.coverLetter({ title: "Only a title" });
  assert.ok(letter.missing.indexOf("journal") !== -1);
  assert.ok(letter.missing.indexOf("editor") !== -1);
  assert.ok(letter.body.indexOf("Only a title") !== -1);
  assert.ok(letter.body.indexOf("Dear Editor,") !== -1);
  assert.equal(letter.body.indexOf("The Lancet"), -1);
  assert.equal(letter.body.indexOf("untitled"), -1);
  assert.equal(letter.body.indexOf("{{"), -1);
  assert.equal(letter.draft, true);
  assert.equal(letter.sent, false);
});

test("a custom template blanks missing tokens and names them", function () {
  const letter = SUB.coverLetter({ title: "BCG review" }, "Hello {{title}} for {{journal}}");
  assert.equal(letter.body, "Hello BCG review for ");
  assert.ok(letter.missing.indexOf("journal") !== -1);
  assert.equal(letter.body.indexOf("{{"), -1);
  assert.ok(letter.subject.indexOf("BCG review") !== -1);
});

test("omitted declarations do not claim that a model was or was not used", function () {
  const block = SUB.declarations({});
  assert.equal(block.aiUse.status, "missing");
  assert.ok(block.text.indexOf("Not stated: Funding, Competing interests, Ethics, Data availability, Use of generative models.") !== -1, block.text);
  assert.equal(block.text.indexOf("No generative model was used"), -1);
  assert.equal(block.text.indexOf("A generative model was used"), -1);
  assert.equal(block.text.indexOf("\u2014"), -1);
});

test("AI, ethics, and funding statements use only the supplied facts", function () {
  const none = SUB.declarations({ aiUse: { used: false } });
  assert.equal(none.aiUse.status, "stated");
  assert.ok(none.aiUse.text.indexOf("No generative model was used to draft the manuscript or to calculate results.") !== -1);

  const used = SUB.declarations({ aiUse: { used: true, tools: ["Model A"], role: "Language edit" } });
  assert.equal(used.aiUse.status, "stated");
  assert.ok(used.aiUse.text.indexOf("Model A") !== -1, used.aiUse.text);
  assert.ok(used.aiUse.text.indexOf("Language edit") !== -1, used.aiUse.text);

  const bare = SUB.declarations({ aiUse: { used: true } });
  assert.equal(bare.aiUse.status, "partial");
  assert.ok(bare.aiUse.text.indexOf("The tool and the role were not recorded.") !== -1);

  const ethics = SUB.declarations({ ethics: { notRequired: true, reason: "Published studies only." } });
  assert.equal(ethics.ethics.status, "stated");
  assert.ok(ethics.ethics.text.indexOf("Published studies only.") !== -1);
  assert.ok(ethics.ethics.text.indexOf("Ethics review was not required.") !== -1);

  const funded = SUB.declarations({ funding: { none: true } });
  assert.ok(funded.funding.text.indexOf("no specific funding") !== -1);
});

test("manifest is complete only when the three required files are named", function () {
  const gaps = SUB.manifest({ checklist: "checklist.csv", prismaDiagram: "flow.svg", figures: [{ filename: "forest.png" }] });
  assert.equal(gaps.complete, false);
  assert.ok(gaps.gaps.indexOf("manuscript") !== -1);
  assert.equal(gaps.sendsToJournal, false);
  assert.equal(gaps.researcherUploads, true);
  assert.equal(gaps.kind, "submission-pack");
  assert.ok(gaps.note.indexOf("does not send") !== -1);

  const input = {
    manuscriptDocx: { filename: "manuscript.docx", bytes: 12, sha256: "abc" },
    checklist: "checklist.csv",
    prismaDiagram: "flow.svg",
    figures: []
  };
  deepFreeze(input);
  const pack = SUB.manifest(input);
  assert.equal(JSON.stringify(input), JSON.stringify({
    manuscriptDocx: { filename: "manuscript.docx", bytes: 12, sha256: "abc" },
    checklist: "checklist.csv",
    prismaDiagram: "flow.svg",
    figures: []
  }));
  assert.equal(pack.complete, true);
  assert.deepEqual(pack.gaps, []);
  assert.equal(pack.figureCount, 0);
  assert.equal(pack.files.length, 3);
  assert.equal(pack.files[0].role, "manuscript");
  assert.equal(pack.files[0].sha256, "abc");
  assert.equal(pack.files[0].bytes, 12);
  assert.equal(pack.files[1].role, "checklist");
  assert.equal(pack.files[1].sha256, null);
  assert.equal(pack.files[2].role, "prisma-diagram");
  assert.equal(pack.files[2].present, true);
  assert.equal(pack.draft === true || pack.sendsToJournal === false, true);

  const withFig = SUB.manifest({
    manuscript: "manuscript.docx",
    checklist: { name: "checklist.csv" },
    diagram: "flow.svg",
    figures: [{ name: "forest.png", caption: "Forest plot" }]
  });
  assert.equal(withFig.complete, true);
  assert.equal(withFig.figureCount, 1);
  assert.equal(withFig.files[3].role, "figure");
  assert.equal(withFig.files[3].caption, "Forest plot");
  assert.equal(withFig.files[3].sha256, null);
  assert.equal(withFig.note.indexOf("\u2014"), -1);
  assert.equal(withFig.note.indexOf("direct submission"), -1);
});
