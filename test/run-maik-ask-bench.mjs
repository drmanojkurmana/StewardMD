/* test/run-maik-ask-bench.mjs — MaiK Ask quality benchmark (Phase L).
 * Part A: deterministic layer, offline (pathway routing, language detect, on-device extraction hit-rate,
 *         red-flag sensitivity/specificity via positiveRedFlag).
 * Part B: LIVE Gemini/Vertex quality against production (question generation + answer extraction) across
 *         English / Telugu / Telugu-English / Hinglish, graded vs expected findings + latency.
 * Run:  node test/run-maik-ask-bench.mjs           (offline only)
 *       BENCH_LIVE=1 node test/run-maik-ask-bench.mjs   (also hit the live endpoint)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.SMD_VVITALS = require("../voice-vitals.js");
const PW = require("../maik-pathways.js");
const A = require("../maik-ask.js");
const R = require("../maik-reasoning.js");
["headache.json", "fever.json", "cough.json"].forEach((f) => PW.register(JSON.parse(readFileSync(new URL("../clinical-pathways/" + f, import.meta.url), "utf8"))));
const norm = (s) => String(s == null ? "" : s).toLowerCase();
const pct = (n, d) => d ? (100 * n / d).toFixed(0) + "%" : "n/a";
let P = 0, F = 0; const fails = [];
function ck(cond, label) { if (cond) P++; else { F++; fails.push(label); } }

console.log("\n================  MaiK Ask — BENCHMARK  ================\n");

// ---- Part A1: pathway routing --------------------------------------------
const routeCases = [
  ["patient has headache for 2 days", "headache"], ["తలనొప్పి రెండు రోజులు", "headache"],
  ["sir dard ho raha hai", "headache"], ["fever since 3 days", "fever"], ["జ్వరం వచ్చింది", "fever"],
  ["bukhar hai do din se", "fever"], ["dry cough one week", "cough"], ["దగ్గు వస్తుంది", "cough"],
  ["chest pain radiating to arm", null], ["patient feels fine", null]
];
let rok = 0; routeCases.forEach(([t, exp]) => { if (PW.match(t) === exp) rok++; });
console.log("A1 Pathway routing        : " + rok + "/" + routeCases.length + "  (" + pct(rok, routeCases.length) + ")");
ck(rok >= 9, "pathway routing >=9/10");

// ---- Part A2: language detection -----------------------------------------
const langCases = [
  ["I have a headache for two days", "english"], ["రెండు రోజులుగా తలనొప్పి ఉంది", "telugu"],
  ["do din se sir dard hai", "hindi"], ["right side lo headache undi", "telugu"],
  ["headache do din se hai", "hindi"]
];
let lok = 0; langCases.forEach(([t, exp]) => { if (R.detectLanguage(t).primary === exp) lok++; });
console.log("A2 Language detection     : " + lok + "/" + langCases.length + "  (" + pct(lok, langCases.length) + ")");
ck(lok >= 4, "language detect >=4/5");

// ---- Part A3: deterministic (on-device, no-LLM) extraction hit-rate ------
// target, transcript, expected value-substring. "det" = handled with ZERO LLM (cost/offline signal).
const detCases = [
  [{ field: "duration", emr: "Chief_complaints_duration" }, "three days", "3 day"],
  [{ field: "location", kind: "field", cues: ["left", "right", "both"] }, "right side lo undi", "right"],
  [{ field: "nausea", kind: "associated" }, "avunu nausea undi", "present"],
  [{ field: "vomiting", kind: "associated" }, "ledu, vomiting avvaledu", "absent"],
  [{ field: "thunderclap_onset", kind: "redflag" }, "avunu sudden ga", "present"],
  [{ field: "duration", emr: "Chief_complaints_duration" }, "moodu rojula nunchi", null] // Telugu-word number: det MISS (needs LLM) - known gap
];
let det = 0, detApplicable = 0;
detCases.forEach(([tgt, t, want]) => {
  const r = A._deterministicAnswer(t, tgt);
  const got = r.length ? norm(r[0].value) : "";
  if (want === null) { detApplicable += 0; return; }  // documents a known det gap, not scored
  detApplicable++;
  if (got && got.indexOf(norm(want)) >= 0) det++;
});
console.log("A3 On-device extraction   : " + det + "/" + detApplicable + "  (" + pct(det, detApplicable) + ")  [Telugu-word numbers are a known det gap -> LLM]");
ck(det >= 4, "deterministic extraction >=4/5");

// ---- Part A4: red-flag sensitivity / specificity -------------------------
const rf = { field: "neuro_deficit", kind: "redflag", ask: "any weakness" };
const rfPos = ["present", "numbness in right hand since morning", "kudi cheyyi weak ga undi"];
const rfNeg = ["absent", "no weakness", "ledu", "nothing like that"];
let sens = 0, spec = 0;
rfPos.forEach((v) => { if (A._positiveRedFlag(rf, [{ field: "neuro_deficit", value: v }])) sens++; });
rfNeg.forEach((v) => { if (!A._positiveRedFlag(rf, [{ field: "neuro_deficit", value: v }])) spec++; });
console.log("A4 Red-flag sensitivity   : " + sens + "/" + rfPos.length + "  specificity: " + spec + "/" + rfNeg.length);
ck(sens === rfPos.length, "red-flag sensitivity 100%"); ck(spec === rfNeg.length, "red-flag specificity 100%");

// ---- Part B: LIVE Gemini quality -----------------------------------------
const LIVE = process.env.BENCH_LIVE === "1";
async function callLive(body) {
  const t0 = Date.now();
  const r = await fetch("https://stewardmd.in/api/ai/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { j, ms: Date.now() - t0, status: r.status };
}
if (!LIVE) {
  console.log("\nB  Live LLM quality       : SKIPPED (set BENCH_LIVE=1 to run against production Gemini)\n");
} else {
  console.log("\n--- B  LIVE Gemini/Vertex (production) ---");
  // B1: question generation — valid JSON, action=ask, correct targetField, non-empty, latency
  const qCases = [
    { complaint: "headache", targetField: "location", targetHint: "one side or both", language: "te-en" },
    { complaint: "fever", targetField: "grade", targetHint: "high or low grade, with chills", language: "hi-en" },
    { complaint: "cough", targetField: "type", targetHint: "dry or with sputum", language: "en" },
    { complaint: "headache", targetField: "onset", targetHint: "sudden or gradual", language: "te-en" }
  ];
  let qok = 0; const qlat = [];
  for (const c of qCases) {
    const { j, ms } = await callLive({ kind: "maik-ask-next", ctx: { ...c, known: {}, allowedFields: ["onset", "duration", "location", "character", "severity", "grade", "type", "nausea"] } });
    qlat.push(ms);
    const ok = j && j.action === "ask" && j.targetField === c.targetField && typeof j.question === "string" && j.question.trim().length > 3;
    if (ok) qok++;
    console.log("   Q[" + c.targetField + "/" + c.language + "] " + ms + "ms  " + (ok ? "OK" : "BAD") + "  -> " + JSON.stringify(j.question || j).slice(0, 90));
  }
  console.log("B1 Question gen valid     : " + qok + "/" + qCases.length + "   latency p50 ~" + qlat.sort((a,b)=>a-b)[Math.floor(qlat.length/2)] + "ms");
  ck(qok >= 3, "live question-gen >=3/4");

  // B2: answer extraction — expected field+value captured, across languages; no fabrication
  const allow = ["onset", "duration", "location", "character", "severity", "nausea", "vomiting", "grade", "pattern", "type", "neuro_deficit", "thunderclap_onset"];
  const xCases = [
    { t: "it's on the left side", targetField: "location", want: { location: "left" }, lang: "en" },
    { t: "right side lo undi, throbbing laga untundi", targetField: "location", want: { location: "right", character: "throb" }, lang: "te-en" },
    { t: "chala severe ga undi, bharinchalenu", targetField: "severity", want: { severity: "severe" }, lang: "te-en" },
    { t: "do din se hai", targetField: "duration", want: { duration: "2 day" }, lang: "hi" },
    { t: "moodu rojula nunchi", targetField: "duration", want: { duration: "3 day" }, lang: "te" },
    { t: "avunu, vaantulu ayyayi", targetField: "vomiting", targetKind: "associated", want: { vomiting: "present" }, lang: "te" },
    { t: "ledu, alanti emi ledu", targetField: "neuro_deficit", targetKind: "redflag", want: { neuro_deficit: "absent" }, lang: "te" },
    { t: "kudi cheyyi tricheyyatledu, numbness undi", targetField: "neuro_deficit", targetKind: "redflag", want: { neuro_deficit: "present" }, lang: "te-en" }
  ];
  let xok = 0, xfields = 0, xfab = 0, xlat = [];
  for (const c of xCases) {
    const { j, ms } = await callLive({ kind: "maik-ask-extract", transcript: c.t, ctx: { targetField: c.targetField, targetKind: c.targetKind, allowedFields: allow, question: "?" } });
    xlat.push(ms);
    const finds = (j && j.findings) || [];
    finds.forEach((f) => { if (allow.indexOf(f.field) < 0) xfab++; });   // fabrication = field outside allow
    let hit = true;
    for (const wf in c.want) { const f = finds.find((x) => x.field === wf); if (!f || norm(f.value).indexOf(norm(c.want[wf])) < 0) hit = false; }
    if (hit) { xok++; xfields++; }
    console.log("   X[" + c.lang + "] \"" + c.t.slice(0, 34) + "\" " + ms + "ms " + (hit ? "OK " : "MISS") + " -> " + JSON.stringify(finds).slice(0, 100));
  }
  console.log("B2 Extraction correct     : " + xok + "/" + xCases.length + "  (" + pct(xok, xCases.length) + ")   fabricated fields: " + xfab + "   latency p50 ~" + xlat.sort((a,b)=>a-b)[Math.floor(xlat.length/2)] + "ms");
  ck(xok >= 6, "live extraction >=6/8"); ck(xfab === 0, "no fabricated fields");
}

console.log("\n================  RESULT: " + P + " checks passed, " + F + " failed  ================");
if (F) { console.log("FAILED: " + fails.join("; ")); process.exit(1); }
