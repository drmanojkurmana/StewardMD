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
// Routing now depends on WHICH ENGINE would pay for the answer, so the harness can set it.
let ENGINE = "cloud";
const maikRoute = new Function("window", `${norm}\n${lev}\n${cas}\nfunction isPatientSpecific(){return false;}\n${route}\nreturn maikRoute;`)(
  { MaiKScope, SMD_MAIK_ENGINE: { effective: () => ENGINE } });
const setEngine = (e) => { ENGINE = e; };
const kind = (q) => maikRoute(q, false).kind;

// FIX: a greeting followed by a real question is answered (clinical), not swallowed as casual
[["Hi rx of uti"], ["hi what is dengue"], ["hey dose of atropine"], ["hello treatment of malaria"], ["hi c diff rx"]]
  .forEach(([q]) => ok(kind(q) === "clinical", "FIX greeting+question routes clinical: " + JSON.stringify(q) + " → " + kind(q)));

/* A GREETING IS ROUTED BY WHO PAYS FOR IT.
 *
 * Owner: "bring back Hi hello greeting routing in MAIK CLOUD and KB as they may waste ai tokens for
 * simple hi hello greetings". Correct - a paid Gemini turn to answer "hi" is money spent on nothing,
 * and KB-only means the clinician has explicitly asked not to spend. On-device is free and offline,
 * which is the case the scripted reply was removed for in the first place.
 */
setEngine("cloud");
[["hi"], ["hello"], ["hey there"], ["hi doctor"], ["good morning"], ["bye"], ["thanks"], ["ok"]]
  .forEach(([q]) => ok(kind(q) === "casual", "CLOUD answers a greeting locally, no tokens: " + JSON.stringify(q) + " → " + kind(q)));

setEngine("rag");
[["hi"], ["hello"], ["good morning"], ["thanks"]]
  .forEach(([q]) => ok(kind(q) === "casual", "KB-only answers a greeting locally: " + JSON.stringify(q) + " → " + kind(q)));

setEngine("local");
[["hi"], ["hello"], ["hey there"], ["hi doctor"], ["good morning"], ["bye"]]
  .forEach(([q]) => ok(kind(q) === "clinical", "ON-DEVICE lets the model greet (free, offline): " + JSON.stringify(q) + " → " + kind(q)));

// The reply is ONE short line. The old scripted paragraph listing every capability is what made it
// read as a bot; bringing the routing back must not bring that back with it.
setEngine("cloud");
const hi = maikRoute("hi", false);
ok("greeting reply is one short line", hi.reply.length < 60 && hi.reply.split("\n").length === 1);
ok("greeting reply does not recite a capability list", !/calculator|drug information|patient assessment/i.test(hi.reply));
ok("sign-off is its own reply", maikRoute("bye", false).reply === "Goodbye.");

// A greeting WITH a real question still gets answered on every engine - the original bug.
["cloud", "rag", "local"].forEach((e) => {
  setEngine(e);
  ok("greeting+question still answers on " + e, kind("hi rx of uti") === "clinical");
});
setEngine("cloud");

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
