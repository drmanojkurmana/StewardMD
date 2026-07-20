/* Regression guard: MaiK must treat a casual / txt-speak FOLLOW-UP as a continuation of the current
 * topic — not dead-end to a web search on a garbage token.
 *
 * Bug (20 Jul 2026, on-device): after a C. difficile answer, "What iz da treatment doze?" (txt-speak
 * for "what is the treatment dose?") mis-routed to "researching the web for doze…" → failed. Cause:
 * maikResolveFollowup's dose branch checks \bdose\b (misses the "doze" typo) and its GENERIC_FU
 * catch-all requires EVERY word to be a known generic term ("iz"/"da"/"doze" are not) → returned
 * null → normal routing treated "doze" as a new topic → not in KB → web. Fix: maikDeslang() maps
 * unambiguous txt-speak/typos (iz→is, da→the, doze→dose, …) at the top of maikResolveFollowup.
 *
 * Extracts the REAL maikResolveFollowup + maikNorm + maikDeslang from home.js and runs them against
 * a stubbed active topic. USAGE: node test/maik-followup-deslang.test.mjs (also under `npm test`). */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.readFileSync(join(ROOT, "home.js"), "utf8");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const grab = (re, label) => { const m = home.match(re); if (!m) { console.log("❌ could not extract " + label + " — pattern changed"); process.exit(2); } return m[0]; };
const normSrc = grab(/function maikNorm\(q\)\s*\{[\s\S]*?\n {4}\}/, "maikNorm");
const fuSrc = grab(/function maikResolveFollowup\(q\)\s*\{[\s\S]*?\n {4}\}/, "maikResolveFollowup");
const deslangVar = grab(/var _MAIK_DESLANG = \{[^}]*\};/, "_MAIK_DESLANG");
const deslangFn = grab(/function maikDeslang\(s\)\s*\{[\s\S]*?\n {4}\}/, "maikDeslang");

let _maikTopic = { topic: "Clostridioides difficile infection", lastDrug: "vancomycin", ts: Date.now() };
const resolve = new Function("_getTopic", `
  var _maikTopic = _getTopic();
  ${normSrc}
  ${deslangVar}
  ${deslangFn}
  ${fuSrc}
  return maikResolveFollowup;
`)(() => _maikTopic);

// THE FIX: txt-speak follow-up continues the current topic (dose of the discussed drug), not web
const r = resolve("What iz da treatment doze?");
ok(!!r, "FIX 'What iz da treatment doze?' resolves as a follow-up (not null → no web dead-end)");
ok(!!r && /dose|vancomycin/i.test(JSON.stringify(r)) && /difficile|clostridioides/i.test(r.retrieval || ""),
  "  → continues on CDI + dose: " + JSON.stringify({ topic: r && r.topic, retrieval: r && r.retrieval }));
ok(!!resolve("wat iz da complication?"), "FIX 'wat iz da complication?' (txt-speak) resolves as follow-up");

// CONTROLS: correct spelling already worked
ok(!!resolve("treatment dose?"), "control: correctly-spelled 'treatment dose?' still resolves");
ok(!!resolve("complications?"), "control: generic 'complications?' still resolves");

// SAFETY: a clearly NEW topic must NOT be force-captured as a follow-up (deslang can't over-capture)
ok(resolve("how to treat malaria") === null, "safety: new topic 'how to treat malaria' NOT captured as follow-up");
ok(resolve("dengue fever management") === null, "safety: new topic 'dengue fever management' NOT captured");

// source guard
ok(/function maikDeslang/.test(home) && /q = maikDeslang\(q\)/.test(home), "maikResolveFollowup de-slangs the query before matching");

console.log(fails === 0 ? "\nALL PASS — MaiK continues txt-speak follow-ups on-topic" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
