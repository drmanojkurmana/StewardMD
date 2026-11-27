/* BUG-04: thesis sectionHtml must tokenise the plain text before building HTML.
 *
 * The old code ran sequential regex replacements over HTML it had already
 * produced, so a verified "1" rewrote data-page="1" and leaked the tag as
 * text, and **bold** stayed literal.
 *
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/research-thesis-render.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const THESIS = require("../research-screen-thesis.js");

test("sectionHtml keeps number badges inside attributes and renders markdown once", () => {
  const locators = [
    { number: "120", page: "1", table: "4" },
    { number: "1", page: "9", table: "" }
  ];
  const html = THESIS.sectionHtml("**Background:** We enrolled 1 patient, then 120 adults.", locators);

  assert.match(html, /^<strong>Background:<\/strong> /, "bold markdown becomes a real strong element");
  assert.equal(html.indexOf("**"), -1, "no literal markdown asterisks survive");
  assert.match(html, /data-page="9" data-table="" tabindex="0" role="button">1<\/span>/,
    "the number 1 gets its own badge with its own page");
  assert.match(html, /data-page="1" data-table="4" tabindex="0" role="button">120<\/span>/,
    "the 120 badge keeps data-page=\"1\" intact");
  assert.equal(html.indexOf('data-page="<span'), -1, "no tag is injected into an attribute");
  assert.equal(html.indexOf('&lt;span'), -1, "no badge tag leaks as escaped text");
  assert.equal((html.match(/<span class="rmd-thesis-num"/g) || []).length, 2,
    "each verified number becomes exactly one badge");
});

test("sectionHtml escapes text and flags, and supports italic", () => {
  const html = THESIS.sectionHtml("A <b> & *p* = 0.03 [check this number] 120", [
    { number: "120", page: "2", table: "" }
  ]);
  assert.match(html, /&lt;b&gt; &amp; /, "literal HTML is escaped");
  assert.match(html, /<em>p<\/em>/, "italic markdown becomes em");
  assert.match(html, /<span class="rmd-thesis-flag">\[check this number\]<\/span>/);
  assert.match(html, /data-page="2"[^>]*>120<\/span>$/);
});

test("sectionHtml does not touch digits that are part of a decimal", () => {
  const html = THESIS.sectionHtml("The ratio was 1.5 in 15 patients.", [
    { number: "1.5", page: "3", table: "" },
    { number: "5", page: "7", table: "" }
  ]);
  assert.match(html, /data-page="3"[^>]*>1\.5<\/span>/);
  assert.equal(html.indexOf('>5</span>'), -1, "the 5 inside 1.5 is not a separate badge");
});
test("digits inside a word (HbA1c, T2DM) are not badged as thesis numbers", () => {
  const locators = [{ number: "1", page: "1", table: "" }, { number: "2", page: "1", table: "" }, { number: "8.4", page: "2", table: "" }];
  const html = THESIS.sectionHtml("Mean HbA1c was 8.4% in T2DM patients; 1 patient left.", locators);
  assert.ok(html.indexOf("HbA1c") >= 0, "HbA1c stays plain text");
  assert.ok(html.indexOf("T2DM") >= 0, "T2DM stays plain text");
  assert.match(html, />8\.4<\/span>/, "8.4 is still a badge");
  assert.match(html, /role="button">1<\/span> patient/, "a standalone 1 is still a badge");
});

test("journalView merges matched seed row by name and dedupes boilerplate", () => {
  const annalsSeed = {
    id: "annals",
    name: "Annals of Internal Medicine",
    wordLimit: null,
    publisher: null,
    abstractFormat: null,
    referenceStyle: null,
    apcNote: null,
    url: null
  };
  const annalsCatalogue = {
    id: "annals_internal_med",
    name: "Annals of Internal Medicine",
    shortName: "Ann Intern Med",
    publisher: "American College of Physicians",
    specialty: "Internal Medicine",
    wordLimit: 3000,
    abstractFormat: "Structured (Background, Objective...), up to 250 words",
    referenceStyle: "vancouver",
    apcNote: "Subscription publication is free; open access fee optional",
    url: "https://www.acpjournals.org/journal/aim/authors"
  };
  const cureus = {
    id: "cureus",
    name: "Cureus",
    publisher: "Springer Nature",
    specialty: "General Medicine",
    wordLimit: null,
    abstractFormat: "Structured, up to 3500 characters",
    referenceStyle: "vancouver",
    apcNote: "Free publishing tier available",
    url: "https://www.cureus.com/author_guide"
  };
  const view = THESIS.journalView({
    items: [THESIS.normJournal(annalsCatalogue), THESIS.normJournal(cureus)],
    matches: [Object.assign(THESIS.normJournal(annalsSeed), { matchScore: 7 })]
  });
  const annalsRows = view.filter((j) => /Annals of Internal Medicine/.test(j.name));
  assert.equal(annalsRows.length, 1, "Annals of Internal Medicine is deduplicated across seed and catalogue");
  assert.equal(annalsRows[0].wordLimit, 3000, "merged row inherits catalogue wordLimit");
  const annalsHtml = THESIS.journalRowHtml(annalsRows[0]);
  assert.equal(annalsHtml.indexOf("Check the author guidelines"), -1, "merged Annals card shows real metadata without boilerplate");

  const sparseOnlyHtml = THESIS.journalRowHtml(THESIS.normJournal(annalsSeed));
  const boilerplateHits = sparseOnlyHtml.match(/Check the author guidelines/g) || [];
  assert.ok(boilerplateHits.length <= 1, "sparse journal card repeats Check the author guidelines at most once");

  const cureusHtml = THESIS.journalRowHtml(THESIS.normJournal(cureus));
  assert.ok(/Word limit:<\/b> Check the author guidelines/.test(cureusHtml), "single missing field (Cureus wordLimit) keeps inline guidance");
});
