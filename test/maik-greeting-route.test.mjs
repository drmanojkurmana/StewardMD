/* Regression guard: a GREETING must not swallow a clinical question, and must not be answered by a
 * canned string either.
 *
 * Bug (20 Jul 2026, on-device): "Hi rx of uti" returned the scripted "Hello. I can help…" instead
 * of answering — MaiK felt like scripted, not real, intelligence. Cause: maikRoute's casual-greeting
 * branch used a NARROW keyword allow-list (treat|manage|dose|sign|…) to decide "is there clinical
 * substance?" — it missed "rx"/"uti"/most disease names, so "hi <clinical>" got the canned reply.
 * Fix: a greeting is "casual" only when the message is essentially JUST the greeting (greetOnly);
 * if a real question follows it, route clinical.
 *
 * UPDATE (20 Aug 2026): the scripted replies are GONE. On seeing "Hello. I can help with clinical
 * knowledge…" on device the owner's note was "THIS IS manufactured TEXT REMOVE IT / WHY IS HI NOT
 * BEING DIRECTED DIRECTLY TO GEMMA TO RESPOND". So a pure greeting now routes CLINICAL as well - it
 * reaches whichever engine is selected and MaiK answers in its own voice. What must still hold is the
 * original bug fix: a greeting with a real question after it is answered, never deflected.
 *
 * Extracts the REAL maikRoute + maikNorm + maikLev + MAIK_CASUAL from home.js and runs them
 * (isPatientSpecific stubbed false, the real MaiKScope injected as window.MaiKScope - maikRoute now
 * defers to it for short queries, so stubbing it away would test the wrong code).
 * USAGE: node test/maik-greeting-route.test.mjs (npm test). */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.readFileSync(join(ROOT, "home.js"), "utf8");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const grab = (re, label) => { const m = home.match(re); if (!m) { console.log("❌ could not extract " + label + " — pattern changed"); process.exit(2); } return m[0]; };

const norm = grab(/function maikNorm\(q\)\s*\{[\s\S]*?\n {4}\}/, "maikNorm");
const lev = grab(/function maikLev\([\s\S]*?\n {4}\}/, "maikLev");
const cas = grab(/var MAIK_CASUAL = \[[^\]]*\];/, "MAIK_CASUAL");
const route = grab(/function maikRoute\(q, active\)\s*\{[\s\S]*?\n {4}\}/, "maikRoute");
// The real firewall, not a stub: maikRoute asks it whether a short query has clinical signal, which
// is the whole point of the fix that removed maikRoute's own rival keyword list.
const MaiKScope = createRequire(import.meta.url)("../kb/ai/maik-scope.js");
const maikRoute = new Function("window", `${norm}\n${lev}\n${cas}\nfunction isPatientSpecific(){return false;}\n${route}\nreturn maikRoute;`)({ MaiKScope });
const kind = (q) => maikRoute(q, false).kind;

// FIX: a greeting followed by a real question is answered (clinical), not swallowed as casual
[["Hi rx of uti"], ["hi what is dengue"], ["hey dose of atropine"], ["hello treatment of malaria"], ["hi c diff rx"]]
  .forEach(([q]) => ok(kind(q) === "clinical", "FIX greeting+question routes clinical: " + JSON.stringify(q) + " → " + kind(q)));

// A pure greeting now reaches the MODEL instead of returning a fixed string.
[["hi"], ["hello"], ["hey there"], ["hi doctor"], ["good morning"], ["hi how are you"], ["bye"]]
  .forEach(([q]) => ok(kind(q) === "clinical", "greeting reaches the model: " + JSON.stringify(q) + " → " + kind(q)));

// A non-clinical TOPIC is still deflected deterministically and for free. That is scope enforcement,
// not a greeting, and it is the one canned reply that stays.
[["tell me a joke"], ["what's the weather"], ["who won the match"]]
  .forEach(([q]) => ok(kind(q) === "casual", "non-clinical topic still deflected: " + JSON.stringify(q) + " → " + kind(q)));

// CONTROL: a normal clinical query (no greeting) still routes clinical
ok(kind("rx of uti") === "clinical", "CONTROL 'rx of uti' still clinical");

// source guard
ok(/var greetOnly =/.test(home) && /casualHit && isShort && greetOnly/.test(home), "maikRoute still gates on greetOnly (not the old keyword allow-list)");
ok(!home.includes("Hello. I can help with clinical knowledge"), "the scripted greeting is gone from home.js");
ok(!/var MAIK_ACK =/.test(home), "MAIK_ACK is dead code once the ack reply is gone");

console.log(fails === 0 ? "\nALL PASS — greetings reach the model and never swallow a clinical question" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
