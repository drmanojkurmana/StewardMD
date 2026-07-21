/* Regression guard: MaiK's clinical-answer timeout must be a NO-PROGRESS WATCHDOG, not a fixed
 * total-time ceiling.
 *
 * Bug (20 Jul 2026, on-device / native): a real answer that was still generating got destroyed at
 * 40s with "MaiK took too long to respond." Root cause — on native there is no SSE streaming
 * (reasoning.js explainGroundedStream falls back to fetch-whole-then-typewriter when SMD_IS_NATIVE),
 * so no tokens arrive until the very end, while runClinical armed a FIXED 40s timer against the whole
 * cold-start + full-answer generation and overwrote the answer when it fired.
 *
 * Fix: rolling watchdog (_armTO) reset on every streamed token (onDelta), a generous ceiling that
 * covers a native whole-answer fetch, and staged reassurance text so the wait doesn't read as frozen.
 *
 * These are source-shape assertions (runClinical is a deep closure, not unit-extractable). */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.readFileSync(join(ROOT, "home.js"), "utf8");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// the timeout is armed via a resettable watchdog, not a one-shot fixed timer
ok(/function _armTO\(\)\s*\{\s*clearTimeout\(_maikTO\);\s*_maikTO = setTimeout\(_maikTimedOut, MAIK_TO_MS\)/.test(home),
  "timeout is a resettable watchdog (_armTO clears + re-sets _maikTO)");

// onDelta (streamed-token callback) RESETS the watchdog so an actively-streaming answer is never killed
const onDelta = (home.match(/var onDelta = function \(acc\) \{[\s\S]*?\n {10}\};/) || [""])[0];
ok(/_armTO\(\)/.test(onDelta) && /_streamStarted = true/.test(onDelta) && /if \(_maikDone\) return/.test(onDelta),
  "onDelta resets the watchdog + marks progress + won't paint after a timeout");

// ceiling has real headroom for native's whole-answer fetch (was a too-tight 40000)
const m = home.match(/MAIK_TO_MS = (\d+)/);
ok(m && Number(m[1]) >= 60000, "MAIK_TO_MS gives native cold-start headroom (>=60000, was 40000): " + (m && m[1]));

// staged reassurance while waiting, and it is cleared on progress/finish/error
ok(/_stageT\.push\(setTimeout/.test(home) && /Composing your answer/.test(home), "staged reassurance messages exist");
ok((home.match(/_clearStages\(\)/g) || []).length >= 4, "_clearStages() called on progress, finish, error, and timeout");

console.log(fails === 0 ? "\nALL PASS — timeout is a no-progress watchdog, streaming answers survive" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
