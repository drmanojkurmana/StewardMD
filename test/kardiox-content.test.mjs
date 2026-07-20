/* test/kardiox-content.test.mjs — Learn-ECG content integrity (100 total, 16 authored complete). */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const C = require("../kardiox-content.js");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

ok("exposed + version", !!C && Array.isArray(C.ecgs) && !!C.contentVersion);
ok("100 total ECGs", C.ecgs.length === 100 && C.total === 100);
ok("16 authored", C.authoredCount === 16);
ok("unique ids", new Set(C.ecgs.map(e => e.id)).size === 100);
ok("every entry has title/category/tier/difficulty", C.ecgs.every(e => e.id && e.title && e.category && ["core", "emergency", "rare"].indexOf(e.tier) >= 0 && ["foundational", "intermediate", "advanced", "expert"].indexOf(e.difficulty) >= 0));
ok("all reviewPending (unsigned clinical content)", C.ecgs.every(e => e.reviewPending === true));

const authored = C.ecgs.filter(e => !e.scaffold);
ok("authored count matches", authored.length === 16);
ok("authored have full lesson bodies", authored.every(e => e.overview && e.clinicalPresentation && Array.isArray(e.diagnosticCriteria) && e.diagnosticCriteria.length > 0 && e.pearl && e.pitfall && Array.isArray(e.references) && e.references.length > 0));
ok("authored quizzes valid (correctIndex in range, explanation present)", authored.every(e => e.quiz && Array.isArray(e.quiz.questions) && e.quiz.questions.length > 0 && e.quiz.questions.every(q => Array.isArray(q.options) && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length && q.explanation)));
ok("authored have flashcards", authored.every(e => Array.isArray(e.flashcards) && e.flashcards.length > 0 && e.flashcards.every(f => f.front && f.back)));
ok("AF lesson present + tagged", authored.some(e => e.id === "atrial-fibrillation-01" && /fibrillat/i.test(e.title)));

const cards = C.flashcards();
ok("flashcards() flattens authored cards with SM-2 fields", Array.isArray(cards) && cards.length > 0 && cards.every(c => c.id && c.front && c.back && c.easeFactor === 2.5 && c.repetitions === 0));

// categories present + emergency coverage
const cats = new Set(C.ecgs.map(e => e.category));
ok("multiple categories", cats.size >= 10);
ok("emergency tier present (STEMI/VT/etc.)", C.ecgs.some(e => e.tier === "emergency"));

console.log(`\nkardiox-content: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
