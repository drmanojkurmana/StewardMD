/* test/maik-router-gaps-0911.test.mjs — source-level (home.js is a WebView-only IIFE) regression
 * tests for the gaps found in the owner's two live transcripts (2026-09-11):
 *   1. "Hello dude" fell to the clarifier because "dude" wasn't a recognised address word.
 *   2. Meta-complaints about MaiK's own last answer ("why are you missing continuity", "you are
 *      wrong") were sent to retrieval as if they were new clinical questions.
 *   3. "How to diagnose it" (a follow-up) fell through to a brand-new, topic-less query because
 *      "diagnose" and "it" were not recognised as generic continuation words.
 *   4. "Ok tell me dose of metoprolol" gate-failed while "Metoprolol dose" (same question) worked,
 *      because the dose-follow-up drug extractor left "Ok tell" glued onto the drug name.
 *   5. The FIRST message after opening MaiK got a raw "model-missing" error code with no guidance. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const home = readFileSync(new URL("../home.js", import.meta.url), "utf8");

// 1. "Hello dude" / casual address words
ok("common casual address words strip so a plain greeting is recognised", /dude\|bro\|man\|buddy/.test(home));

// 2. meta-complaint short-circuit before retrieval, routed as casual (no AI/KB call)
ok("a self-referential complaint block exists", /Complaint about MaiK's OWN last answer/.test(home));
ok("...matches 'why are/is/did/didn't you' framing", /why \(are\|is\|did\|didn/.test(home));
ok("...matches 'you already know' / 'missing continuity'", /you already know/.test(home) && /missing continuity/.test(home));
ok("...matches 'you're wrong' / 'that's wrong'", home.includes("you'?re wrong|you are wrong") && home.includes("that'?s wrong"));
ok("...replies apologetically and asks to re-ask, as a casual reply (never hits retrieval)",
   /Sorry about that\. Could you ask the question again/.test(home) && /kind: "casual", reply: "Sorry about that/.test(home));

// 3. GENERIC_FU: pronoun + verb form
ok("GENERIC_FU includes 'it' (pronoun) as a generic continuation word", /GENERIC_FU = \/\^\([^$]*\|it\|/.test(home));
ok("GENERIC_FU includes 'them' (pronoun)", /GENERIC_FU = \/\^\([^$]*\|them\|/.test(home));
ok("GENERIC_FU includes 'diagnose'/'diagnostic', not just the noun 'diagnosis'",
   /diagnosis\|diagnose\|diagnosed\|diagnostic/.test(home));

// 4. dose-follow-up drug extraction strips request-frame filler ("Ok tell me dose of X" -> "X")
ok("the dose extractor strips request-frame words (tell/ok/okay/so/can/could/you/show)",
   /\|tell\|ok\|okay\|so\|can\|could\|you\|show\|us\|kindly\)/.test(home));

// 5. model-missing gets specific guidance instead of a raw error code
ok("maikErrorNotice has a specific model-missing branch", /model-missing\/i\.test\(e\)/.test(home));
ok("...tells the clinician to simply ask again", /still loading\. Please ask again/i.test(home));

console.log(`maik-router-gaps-0911: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
