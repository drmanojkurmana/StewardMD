/* test/maik-followup-actions.test.mjs — two assistant behaviours from the owner's live battery
 * (2026-09-04), source-level because home.js is a WebView-only IIFE:
 *   1. "and the dose?" after a treatment answer must resolve to the topic's first-line drug, not
 *      ask "which drug?" back. The resolver already tracked the topic; only the no-drug branch
 *      gave up.
 *   2. Every answer gets Copy / Regenerate / Edit actions, and Regenerate asks the engine for
 *      sampling jitter (otherwise a temperature-0 model returns the identical answer). */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const home = readFileSync(new URL("../home.js", import.meta.url), "utf8");

// 1. dose follow-up
ok("the 'which drug?' clarifier is gone", !/Which drug.s dose would you like/.test(home));
ok("a bare dose follow-up resolves to the current topic's first-line drug", /first-line drug and dose for " \+ t\.topic/.test(home));
ok("...and retrieval is steered at the topic's dose/duration", /retrieval: t\.topic \+ " first line drug dose duration"/.test(home));
ok("a named or remembered drug still takes precedence (unchanged branch)", /_drug = _drug \|\| t\.lastDrug;\s*\n\s*if \(_drug\) return \{ question: _pop \+ " dosing of " \+ _drug/.test(home));

// 2. answer actions
const fb = home.match(/function _answerFeedback\(host, meta\) \{[\s\S]*?var up = mk\("Yes", "up"\)/);
ok("the actions are built inside the feedback row", !!fb);
const f = fb ? fb[0] : "";
for (const label of ["Copy", "Regenerate", "Edit"]) ok(`"${label}" action present`, new RegExp('act\\("' + label + '"').test(f));
ok("Copy strips chips, sources and chrome before copying (answer text only)", /\.maik-fb,\.maik-followups,\.maik-tools,\.maik-refine,\.maik-chip,\.maik-src/.test(f) && /navigator\.clipboard/.test(f));
ok("Regenerate drops the cached render for this question, flags regen, resends", /delete _maikCache\[maikNorm\(question\)/.test(f) && /_maikRegen = true;/.test(f) && /send\(\);/.test(f));
ok("Edit puts the question back in the composer and focuses it", /qEl\.value = question; qEl\.focus\(\)/.test(f));
ok("the regen flag is consumed for exactly the next send and passed to the engine", /var _regen = _maikRegen; _maikRegen = false;/.test(home) && /regen: _regen \}, onDelta\)/.test(home));

console.log(`maik-followup-actions: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
