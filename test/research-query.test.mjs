/* Regression guard for MaiK Research/Evidence-Review query sanitization (21 Jul 2026).
 *
 * Bug: the raw question was passed to PubMed, so natural-language "and"/"or"/"not"
 * ("Carvedilol or Propranolol", "best or better") became BOOLEAN OPERATORS and shattered the search
 * → near-random systematic reviews (akathisia, migraine, ROP) for an esophageal-varices question.
 * Fix: build the PubMed term from salient KEYWORDS only (researchTermFor), and drop off-topic
 * retrieved papers with a title-keyword relevance guard (sourceOnTopic). */
import assert from "node:assert";
import { researchTermFor, researchKeywords, sourceOnTopic, researchTopic } from "../functions/_research.js";

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

const Q = "Endoscopic Banding vs Beta Blocker (Carvedilol or Propranolol) which is best or better for esophageal varices";
const term = researchTermFor(Q);

// keeps the clinical keywords
["esophageal", "varices", "carvedilol", "propranolol", "banding", "blocker", "endoscopic"].forEach((w) =>
  ok(term.includes(w), `term keeps clinical keyword "${w}"  (term="${term}")`));

// drops the boolean-operator + question-filler words that broke PubMed
["\\bor\\b", "\\band\\b", "\\bvs\\b", "\\bwhich\\b", "\\bbest\\b", "\\bbetter\\b", "\\bfor\\b"].forEach((w) =>
  ok(!new RegExp(w).test(term), `term drops operator/filler ${w}`));

// relevance guard: real varices sources pass, off-topic reviews are rejected
const kw = researchKeywords(Q);
ok(sourceOnTopic("Carvedilol for portal hypertension in cirrhosis: systematic review with meta-analysis", kw), "on-topic source (carvedilol) accepted");
ok(sourceOnTopic("NSBBs, EBL or Combined Therapy for High-Risk Varices: Systematic Review", kw), "on-topic source (varices) accepted");
ok(!sourceOnTopic("Drug Efficacy in the Treatment of Antipsychotic-Induced Akathisia: A Systematic Review", kw), "off-topic source (akathisia) rejected");
ok(!sourceOnTopic("Preventive drug treatments for adults with chronic migraine", kw), "off-topic source (migraine) rejected");

// a vague follow-up has no SPECIFIC (>=5-char) keyword, so the relevance guard blocks every source
// (nothing to match) and we synthesize from knowledge instead of firing a junk PubMed search
const vagueKw = researchKeywords("what do you think is superior or inferior or same? just answer single answer");
ok(!vagueKw.some((w) => w.length >= 5), `vague follow-up has no specific keyword -> relevance guard blocks all (kw=${JSON.stringify(vagueKw)})`);

// ── follow-up context (researchTopic) ────────────────────────────────────────
const HIST = [{ q: "Endoscopic banding vs beta blocker for esophageal varices", a: "carvedilol / EVL discussion" }];
const t1 = researchTopic("what do you think? just one answer", HIST);
ok(/varices/.test(t1) && /esophageal/.test(t1), `vague follow-up inherits prior topic (got "${t1}")`);
const t2 = researchTopic("management of DKA", HIST);
ok(/dka/.test(t2) && !/varices/.test(t2), `question naming its own topic ignores history, even a short abbrev (got "${t2}")`);
ok(researchTopic("which is better?", []) === "", "vague follow-up with no history -> empty topic (answer from knowledge)");
ok(researchTopic("esophageal varices treatment", HIST).includes("varices"), "normal question uses its own keywords");

console.log(`\nALL ${pass} PASS — research query is sanitized + relevance-guarded + context-aware`);
