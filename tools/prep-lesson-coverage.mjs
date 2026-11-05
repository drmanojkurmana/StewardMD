#!/usr/bin/env node
// tools/prep-lesson-coverage.mjs — Gate 2: Blueprint mustKnow fact coverage verifier.
// Checks that every mustKnow fact in a subject's blueprint is covered in the corresponding lesson steps
// (matching key terms and any specified numbers or drugs).
//
// USAGE:
//   node tools/prep-lesson-coverage.mjs --subject <subject-id> [--lessons-dir prep/lessons/v1]
//   node tools/prep-lesson-coverage.mjs --blueprint prep/blueprints/ss/<subject-id>.json
//   node tools/prep-lesson-coverage.mjs --all

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { normText } from "../functions/_prep-core.js";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LP = require("../prep-lessons.js");

/* extractNumbers(str) -> list of numbers/ratios like "4:1", "0.5", "50%", "24" */
export function extractNumbers(text) {
  const matches = String(text || "").match(/\b\d+(?:[.:/]\d+)?%?\b/g) || [];
  return [...new Set(matches)];
}

/* checkFactCoverage(fact, lessonText) -> { covered: boolean, missing: string[] } */
export function checkFactCoverage(mustKnowFact, lessonText) {
  const normLesson = " " + normText(lessonText) + " ";
  const missing = [];

  // Terms check
  const terms = Array.isArray(mustKnowFact.terms) && mustKnowFact.terms.length
    ? mustKnowFact.terms
    : (mustKnowFact.term ? [mustKnowFact.term] : []);

  if (terms.length) {
    for (const term of terms) {
      const nt = normText(term);
      if (nt && !normLesson.includes(nt)) {
        missing.push(`term "${term}"`);
      }
    }
  } else if (mustKnowFact.fact) {
    // Fallback: if no explicit terms, pick the head phrase or first 2 significant words
    const headWords = normText(mustKnowFact.fact).split(" ").filter((w) => w.length >= 4).slice(0, 2);
    for (const w of headWords) {
      if (!normLesson.includes(" " + w + " ")) {
        missing.push(`word "${w}"`);
      }
    }
  }

  // Numbers check
  const numbers = Array.isArray(mustKnowFact.numbers) && mustKnowFact.numbers.length
    ? mustKnowFact.numbers
    : [];

  const rawLessonLower = String(lessonText || "").toLowerCase();
  for (const num of numbers) {
    const rawNum = String(num).trim().toLowerCase();
    const ntNum = normText(rawNum);
    if (!rawLessonLower.includes(rawNum) && !normLesson.includes(" " + ntNum + " ") && !normLesson.includes(ntNum)) {
      missing.push(`number "${num}"`);
    }
  }

  // Drugs check
  const drugs = Array.isArray(mustKnowFact.drugs) && mustKnowFact.drugs.length
    ? mustKnowFact.drugs
    : [];

  for (const drug of drugs) {
    const nd = normText(drug);
    if (nd && !normLesson.includes(nd)) {
      missing.push(`drug "${drug}"`);
    }
  }

  return {
    covered: missing.length === 0,
    missing,
  };
}

/* gatherLessonText(lesson) -> string containing all plain text, narration, and visual text */
export function gatherLessonText(lesson) {
  if (!lesson || !Array.isArray(lesson.steps)) return "";
  const parts = [];
  for (const step of lesson.steps) {
    if (step.tx) parts.push(LP.plain(step.tx));
    if (step.say) parts.push(step.say);
    if (step.vis) parts.push(LP.visText(step.vis));
  }
  return parts.join("\n");
}

/* normFact(fact) -> object fact: blueprint topics may list mustKnow facts as plain strings
 * (newer flat blueprints) or as { fact, terms, numbers, drugs } objects. Strings gain their numbers. */
export function normFact(fact) {
  if (typeof fact === "string") return { fact, numbers: extractNumbers(fact) };
  return fact || {};
}

function checkTopic(topicId, topicTitle, mustKnow, lessonsDir, topicsReport, counts) {
  const facts = (mustKnow || []).map(normFact);
  counts.total += facts.length;

  const lessonFile = path.join(lessonsDir, `${topicId}.json`);
  let lesson = null;
  if (fs.existsSync(lessonFile)) {
    try {
      lesson = JSON.parse(fs.readFileSync(lessonFile, "utf8"));
    } catch {
      lesson = null;
    }
  }

  if (!lesson) {
    topicsReport.push({
      id: topicId,
      title: topicTitle,
      lessonPresent: false,
      totalFacts: facts.length,
      coveredFacts: 0,
      coveragePct: 0,
      missing: facts.map((f) => ({
        fact: f.fact || JSON.stringify(f),
        missing: ["lesson file missing"],
      })),
    });
    return;
  }

  const lessonText = gatherLessonText(lesson);
  const missingFacts = [];
  let topicCovered = 0;

  for (const fact of facts) {
    const res = checkFactCoverage(fact, lessonText);
    if (res.covered) {
      topicCovered++;
      counts.covered++;
    } else {
      missingFacts.push({
        fact: fact.fact || JSON.stringify(fact),
        missing: res.missing,
      });
    }
  }

  const coveragePct = facts.length ? Math.round((topicCovered / facts.length) * 100) : 100;
  topicsReport.push({
    id: topicId,
    title: topicTitle,
    lessonPresent: true,
    totalFacts: facts.length,
    coveredFacts: topicCovered,
    coveragePct,
    missing: missingFacts,
  });
}

/* verifySubjectCoverage(blueprint, lessonsDir) -> SubjectCoverageReport */
export function verifySubjectCoverage(blueprint, lessonsDir = path.join(ROOT, "prep/lessons/v1")) {
  const subject = blueprint.subject || blueprint.id;
  const topicsReport = [];
  const counts = { total: 0, covered: 0 };

  for (const section of blueprint.sections || []) {
    for (const module of section.modules || []) {
      for (const topic of module.topics || [module]) {
        checkTopic(topic.id || module.id, topic.title || module.name || topic.id || module.id,
          topic.mustKnow, lessonsDir, topicsReport, counts);
      }
    }
  }

  // Flat blueprints list topics at the top level: { subject, title, topics: [{ id, title, mustKnow }] }.
  for (const topic of blueprint.topics || []) {
    checkTopic(topic.id, topic.title || topic.id, topic.mustKnow, lessonsDir, topicsReport, counts);
  }

  const overallPct = counts.total ? Math.round((counts.covered / counts.total) * 100) : 100;
  return {
    subject,
    title: blueprint.title || subject,
    totalTopics: topicsReport.length,
    totalFacts: counts.total,
    coveredFacts: counts.covered,
    coveragePct: overallPct,
    topics: topicsReport,
  };
}

/* CLI runner */
export async function main(argv = process.argv.slice(2)) {
  let blueprintPath = null;
  let subject = null;
  let all = false;
  let lessonsDir = path.join(ROOT, "prep/lessons/v1");

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--blueprint" && argv[i + 1]) {
      blueprintPath = path.resolve(process.cwd(), argv[++i]);
    } else if (argv[i] === "--subject" && argv[i + 1]) {
      subject = argv[++i];
    } else if (argv[i] === "--lessons-dir" && argv[i + 1]) {
      lessonsDir = path.resolve(process.cwd(), argv[++i]);
    } else if (argv[i] === "--all") {
      all = true;
    }
  }

  const blueprints = [];
  if (all) {
    const bpDir = path.join(ROOT, "prep/blueprints/ss");
    if (fs.existsSync(bpDir)) {
      for (const f of fs.readdirSync(bpDir).filter((x) => x.endsWith(".json"))) {
        blueprints.push(path.join(bpDir, f));
      }
    }
  } else if (subject) {
    blueprintPath = path.join(ROOT, `prep/blueprints/ss/${subject}.json`);
    blueprints.push(blueprintPath);
  } else if (blueprintPath) {
    blueprints.push(blueprintPath);
  } else {
    console.log("Usage: node tools/prep-lesson-coverage.mjs --subject <subject-id> | --blueprint <path> | --all");
    process.exit(1);
  }

  let allPass = true;
  for (const bp of blueprints) {
    if (!fs.existsSync(bp)) {
      console.error(`Blueprint not found: ${bp}`);
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(bp, "utf8"));
    const report = verifySubjectCoverage(data, lessonsDir);
    console.log(`\n=== COVERAGE REPORT: ${report.title} (${report.subject}) ===`);
    console.log(`Topics: ${report.totalTopics} | Must-Know Facts: ${report.coveredFacts}/${report.totalFacts} (${report.coveragePct}%)`);

    for (const t of report.topics) {
      if (t.coveragePct < 100) {
        allPass = false;
        console.log(`  FAIL [${t.id}] ${t.title}: ${t.coveredFacts}/${t.totalFacts} (${t.coveragePct}%)`);
        for (const m of t.missing) {
          console.log(`       - Missing: ${m.missing.join(", ")} in "${m.fact.slice(0, 60)}..."`);
        }
      } else {
        console.log(`  PASS [${t.id}] ${t.title}: ${t.coveredFacts}/${t.totalFacts} (100%)`);
      }
    }
  }

  if (!allPass) {
    console.log("\nFAIL: Coverage gate failed: one or more mustKnow facts are missing from lessons.");
    process.exit(1);
  } else {
    console.log("\nPASS: All blueprint mustKnow facts covered in lessons!");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
