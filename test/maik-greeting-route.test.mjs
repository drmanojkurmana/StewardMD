/* Regression guard: a GREETING must not swallow a clinical question.
 *
 * Bug (20 Jul 2026, on-device): "Hi rx of uti" returned the scripted "Hello. I can help…" instead
 * of answering — MaiK felt like scripted, not real, intelligence. Cause: maikRoute's casual-greeting
 * branch used a NARROW keyword allow-list (treat|manage|dose|sign|…) to decide "is there clinical
 * substance?" — it missed "rx"/"uti"/most disease names, so "hi <clinical>" got the canned reply.
 * Fix: a greeting is "casual" only when the message is essentially JUST the greeting (greetOnly);
 * if a real question follows it, route clinical.
 *
 * Extracts the REAL maikRoute + maikNorm + maikLev + MAIK_CASUAL/MAIK_ACK from home.js and runs
 * them (isPatientSpecific stubbed false). USAGE: node test/maik-greeting-route.test.mjs (npm test). */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.readFileSync(join(ROOT, "home.js"), "utf8");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const grab = (re, label) => { const m = home.match(re); if (!m) { console.log("❌ could not extract " + label + " — pattern changed"); process.exit(2); } return m[0]; };

const norm = grab(/function maikNorm\(q\)\s*\{[\s\S]*?\n {4}\}/, "maikNorm");
const lev = grab(/function maikLev\([\s\S]*?\n {4}\}/, "maikLev");
const cas = grab(/var MAIK_CASUAL = \[[^\]]*\];/, "MAIK_CASUAL");
const ack = grab(/var MAIK_ACK = \[[^\]]*\];/, "MAIK_ACK");
const route = grab(/function maikRoute\(q, active\)\s*\{[\s\S]*?\n {4}\}/, "maikRoute");
const maikRoute = new Function(`${norm}\n${lev}\n${cas}\n${ack}\nfunction isPatientSpecific(){return false;}\n${route}\nreturn maikRoute;`)();
const kind = (q) => maikRoute(q, false).kind;

// FIX: a greeting followed by a real question is answered (clinical), not swallowed as casual
[["Hi rx of uti"], ["hi what is dengue"], ["hey dose of atropine"], ["hello treatment of malaria"], ["hi c diff rx"]]
  .forEach(([q]) => ok(kind(q) === "clinical", "FIX greeting+question routes clinical: " + JSON.stringify(q) + " → " + kind(q)));

// CONTROL: pure greetings / acks / social still stay casual (not answered as a topic)
[["hi"], ["hello"], ["hey there"], ["hi doctor"], ["good morning"], ["how are you"], ["thanks"], ["ok"], ["hi how are you"], ["bye"]]
  .forEach(([q]) => ok(kind(q) === "casual", "CONTROL pure-social stays casual: " + JSON.stringify(q) + " → " + kind(q)));

// CONTROL: a normal clinical query (no greeting) still routes clinical
ok(kind("rx of uti") === "clinical", "CONTROL 'rx of uti' still clinical");

// source guard
ok(/var greetOnly =/.test(home) && /casualHit && isShort && greetOnly/.test(home), "maikRoute gates the casual reply on greetOnly (not the old keyword allow-list)");

console.log(fails === 0 ? "\nALL PASS — greetings don't swallow clinical questions" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
