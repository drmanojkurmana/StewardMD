/* ResearchMD shared document editor: heading builder and draft mapping.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-doc-editor.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const DOC = require("../research-doc-editor.js");
const STROBE = JSON.parse(readFileSync(new URL("../data/research-checklists/strobe.json", import.meta.url), "utf8"));

function draft(sections) {
  return { sections };
}

function textOf(doc, sectionId, subId) {
  const sec = doc.sections.filter((s) => s.id === sectionId)[0];
  assert.ok(sec, "missing section " + sectionId);
  const sub = sec.subheadings.filter((s) => s.id === subId)[0];
  assert.ok(sub, "missing subheading " + subId);
  return DOC.htmlToText(sub.html);
}

test("STROBE outline lists the owner's subheadings in order", function () {
  const outline = DOC.outlineFor(STROBE);
  const actual = outline.sections.map((s) => ({
    title: s.title,
    subs: s.subheadings.map((x) => x.title)
  }));
  assert.deepEqual(actual, [
    { title: "Title and abstract", subs: ["Title and abstract"] },
    { title: "Introduction", subs: ["Background/rationale", "Objectives"] },
    {
      title: "Methods",
      subs: ["Study design", "Setting", "Participants", "Variables",
        "Data sources/measurement", "Bias", "Study size",
        "Quantitative variables", "Statistical methods"]
    },
    {
      title: "Results",
      subs: ["Participants", "Descriptive data", "Outcome data", "Main results", "Other analyses"]
    },
    {
      title: "Discussion",
      subs: ["Key results", "Limitations", "Interpretation", "Generalisability"]
    },
    { title: "Other information", subs: ["Funding"] }
  ]);
  assert.equal(outline.itemSub["6a"], "methods--participants");
  assert.equal(outline.itemSub["6b"], "methods--participants");
  assert.equal(outline.itemSub["8*"], "methods--data-sources-measurement");
  assert.equal(outline.itemSub["22"], "other-information--funding");
});

test("the outline builder covers CONSORT, CARE, PRISMA and SPIRIT data files", function () {
  const files = ["consort2025.json", "care.json", "prisma2020.json", "spirit.json"];
  for (const file of files) {
    const checklist = JSON.parse(readFileSync(new URL("../data/research-checklists/" + file, import.meta.url), "utf8"));
    const outline = DOC.outlineFor(checklist);
    assert.equal(outline.sections.length, checklist.sections.length, file + ": section count");
    let items = 0;
    for (let i = 0; i < checklist.sections.length; i++) {
      const src = checklist.sections[i];
      const out = outline.sections[i];
      const topics = [];
      for (const item of src.items || []) {
        items++;
        const topic = String(item.topic || item.text || item.num || item.number || "").trim();
        if (topics.indexOf(topic) === -1) topics.push(topic);
      }
      assert.deepEqual(out.subheadings.map((s) => s.title), topics, file + ": " + src.title + " subheadings");
      for (const sub of out.subheadings) {
        assert.ok(sub.title, file + ": subheading has a title");
        assert.ok(sub.id, file + ": subheading has an id");
      }
    }
    assert.equal(Object.keys(outline.itemSub).length, items, file + ": every item maps to a subheading");
  }
});

test("draft text lands under matching subheadings and unmatched text under its section", function () {
  const outline = DOC.outlineFor(STROBE);
  const doc = DOC.emptyDoc(outline);
  DOC.applySources(doc, outline, draft([
    { heading: "Abstract", text: "BCG vaccination and tuberculosis in children: a systematic review." },
    {
      heading: "Introduction",
      text: "Tuberculosis remains an important cause of childhood illness.\nWe aimed to estimate the effect of BCG vaccination on tuberculosis."
    },
    {
      heading: "Methods",
      text: "This was a retrospective cohort study in two hospitals.\nParticipants were children under five years admitted during the study period.\nWe collected data from medical records and measured tuberculosis events.\nWe used a Poisson regression model and reported risk ratios with confidence intervals."
    },
    {
      heading: "Results",
      text: "We included 120 children.\nThe main result was a risk ratio of 0.49."
    },
    {
      heading: "Discussion",
      text: "The key result supports earlier trials.\nLimitations include short follow up.\nThe findings may not generalise to other settings."
    },
    { heading: "Funding", text: "No specific funding was received." }
  ]), false);

  assert.match(textOf(doc, "title-and-abstract", "title-and-abstract--title-and-abstract"), /systematic review/);
  assert.match(textOf(doc, "introduction", "introduction--overview"), /Tuberculosis remains/);
  assert.match(textOf(doc, "introduction", "introduction--objectives"), /We aimed to estimate/);
  assert.match(textOf(doc, "methods", "methods--study-design"), /retrospective cohort/);
  assert.match(textOf(doc, "methods", "methods--participants"), /children under five/);
  assert.match(textOf(doc, "methods", "methods--data-sources-measurement"), /medical records/);
  assert.match(textOf(doc, "methods", "methods--statistical-methods"), /Poisson regression/);
  assert.match(textOf(doc, "results", "results--overview"), /We included 120/);
  assert.match(textOf(doc, "results", "results--main-results"), /risk ratio of 0.49/);
  assert.match(textOf(doc, "discussion", "discussion--key-results"), /key result/);
  assert.match(textOf(doc, "discussion", "discussion--limitations"), /short follow up/);
  assert.match(textOf(doc, "discussion", "discussion--generalisability"), /not generalise/);
  assert.match(textOf(doc, "other-information", "other-information--funding"), /No specific funding/);
});

test("only empty subheadings are filled by an AI draft", function () {
  const outline = DOC.outlineFor(STROBE);
  const doc = DOC.emptyDoc(outline);
  DOC.applySources(doc, outline, draft([
    { heading: "Methods", text: "This was a cohort study.\nParticipants were adults." }
  ]), false);
  assert.match(textOf(doc, "methods", "methods--study-design"), /cohort study/);
  assert.match(textOf(doc, "methods", "methods--participants"), /adults/);
  const before = textOf(doc, "methods", "methods--study-design");
  DOC.applySources(doc, outline, draft([
    { heading: "Methods", text: "This was a randomised trial.\nParticipants were children." }
  ]), true);
  assert.equal(textOf(doc, "methods", "methods--study-design"), before);
  assert.doesNotMatch(textOf(doc, "methods", "methods--participants"), /children/);
});

test("manuscript sections and DOCX sections keep the checklist headings", function () {
  const outline = DOC.outlineFor(STROBE);
  const doc = DOC.emptyDoc(outline);
  DOC.applySources(doc, outline, draft([
    { heading: "Methods", text: "This was a cohort study in two hospitals." },
    { heading: "Discussion", text: "Limitations include short follow up." }
  ]), false);
  const sections = DOC.docToSections(doc);
  const methods = sections.filter((s) => s.id === "methods")[0];
  assert.ok(methods, "methods manuscript section");
  assert.match(methods.text, /Study design/);
  assert.match(methods.text, /two hospitals/);
  const dx = DOC.docxSections(doc);
  const headings = dx.map((s) => s.heading);
  assert.ok(headings.indexOf("Methods") !== -1, "main Methods heading");
  assert.ok(headings.indexOf("Study design") !== -1, "Study design heading");
  assert.ok(headings.indexOf("Limitations") !== -1, "Limitations heading");
});

test("HTML helpers keep the allowed tags, drop scripts and styles, and count words", function () {
  const safe = DOC.sanitizeHtml('<p onclick="bad()">Hello <b>bold</b><script>alert(1)</script><style>x{}</style><img src="x" onerror="bad()"></p>');
  assert.match(safe, /Hello/);
  assert.match(safe, /<b>bold<\/b>/);
  assert.doesNotMatch(safe, /script/i);
  assert.doesNotMatch(safe, /style/i);
  assert.doesNotMatch(safe, /onclick/i);
  assert.doesNotMatch(safe, /onerror/i);
  assert.doesNotMatch(safe, /img/i);

  const text = DOC.htmlToText("<p>Hello <b>bold</b>.</p><ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol>");
  assert.match(text, /Hello bold/);
  assert.match(text, /One/);
  assert.match(text, /1\. First/);
  assert.equal(DOC.countWords(text), 5);
  assert.equal(DOC.statusForWords(0), "missing");
  assert.equal(DOC.statusForWords(2), "partial");
  assert.equal(DOC.statusForWords(12), "filled");
});

test("editor sources stay ES5, dual export, no dashes", function () {
  const src = readFileSync(new URL("../research-doc-editor.js", import.meta.url), "utf8");
  const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.equal(body.indexOf("=>"), -1, "no arrow functions");
  assert.ok(!/\b(let|const)\s/.test(body), "no let/const declarations");
  assert.equal(body.indexOf("`"), -1, "no template strings");
  assert.ok(!/\bclass\s+[A-Za-z]/.test(body), "no classes");
  assert.equal(body.indexOf("\u2014"), -1, "no em dash");
  assert.equal(body.indexOf("\u2013"), -1, "no en dash");

  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.equal(typeof fakeWindow.SMD_RESEARCH_DOC.outlineFor, "function");
  assert.equal(fakeWindow.SMD_RESEARCH_DOC.version, "rmd1");
});