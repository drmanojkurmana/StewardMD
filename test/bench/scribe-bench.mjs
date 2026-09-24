/* Micro-benchmarks for the 6 new MaiK Scribe modules (item: prove/disprove measurable cost).
 * Read-only against the modules — no app files are modified by this script.
 * Run: node test/bench/scribe-bench.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { statSync } from "node:fs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const P = (f) => join(ROOT, f);

// ---- browser-shape stubs, same pattern test/onco-p1.test.mjs uses to require drugs.js ----------
global.window = global;
global.document = {
  addEventListener() {}, getElementById() { return null; },
  createElement() { return { classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } }; },
  head: { appendChild() {} }, body: { appendChild() {} }, querySelectorAll() { return []; }
};

// ---- timing helper: median + p95 over N iterations, with a warmup ------------------------------
function timeit(fn, iterations, warmup) {
  warmup = warmup == null ? Math.max(3, Math.floor(iterations / 10)) : warmup;
  for (let i = 0; i < warmup; i++) fn();
  const times = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times[i] = Number(t1 - t0) / 1e6; // ms
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  return { median, p95, n: iterations };
}

const rows = []; // { op, size, median, p95 }
function record(op, size, stat) { rows.push({ op, size, median: stat.median, p95: stat.p95 }); }

// ---- realistic-ish consult text generator -------------------------------------------------------
// Deterministic (no Math.random) so re-runs are comparable. Mixes plain clinical sentences with
// drug-name mentions (correct brand names + a few misheard/phonetic variants) so scribe-drugfix has
// real fuzzy-match work to do, not just plain English.
const CLINICAL_SENTENCES = [
  "the patient presents with a three day history of fever and cough",
  "on examination the chest is clear with no added sounds",
  "blood pressure is stable and pulse is regular",
  "the patient reports mild abdominal pain after meals",
  "no history of vomiting or loose stools was noted today",
  "advised to continue the current medication and review in one week",
  "the wound looks clean with no discharge or redness",
  "patient denies any chest pain or shortness of breath",
  "temperature was recorded at ninety nine point two",
  "she has been compliant with treatment so far",
  "he was started on a course of antibiotics last week",
  "counselled the patient regarding diet and lifestyle modification",
  "follow up advised after the reports are available",
  "no known drug allergies were reported by the patient",
  "the patient is a known case of diabetes and hypertension",
  "review of systems is otherwise unremarkable today",
  "will continue monitoring renal function over the next few days",
  "the family history is significant for cardiac disease",
  "patient tolerated the procedure well without complications",
  "advised adequate hydration and rest for the next few days"
];
const MISHEARD = ["atorvastain", "omeprazol", "pantop", "amoxy clav", "azithromycine", "metfromin", "losartn"];

function realBrandPool(drugs) {
  const out = [];
  (drugs || []).forEach((d) => (d.brands || []).forEach((b) => { if (b && b.length > 2) out.push(b); }));
  return out;
}

function genTranscript(targetWords, drugs) {
  const brands = realBrandPool(drugs);
  const words = [];
  let s = 0, d = 0, m = 0;
  while (words.length < targetWords) {
    words.push(...CLINICAL_SENTENCES[s % CLINICAL_SENTENCES.length].split(" "));
    words.push(".");
    s++;
    // sprinkle a real brand every ~2 sentences, a misheard variant every ~5
    if (s % 2 === 0 && brands.length) { words.push(brands[d % brands.length]); d++; }
    if (s % 5 === 0) { words.push(...MISHEARD[m % MISHEARD.length].split(" ")); words.push("."); m++; }
  }
  return words.slice(0, targetWords).join(" ").replace(/ \./g, ".");
}

// ============================================================================================
// 1) scribe-drugfix.correct(transcript, {drugs}) — real drug list, 200/1000/5000/15000 words
// ============================================================================================
const F = require(P("scribe-drugfix.js"));
require(P("drugs.js")); // -> global.window.MEDDRUGS (real ward formulary)
const REAL_DRUGS = global.window.MEDDRUGS._list;
console.log(`Loaded real drug list: ${REAL_DRUGS.length} entries`);

const SIZES = [200, 1000, 5000, 15000];
const TRANSCRIPTS = {};
SIZES.forEach((n) => { TRANSCRIPTS[n] = genTranscript(n, REAL_DRUGS); });

SIZES.forEach((n) => {
  const iterations = n <= 200 ? 60 : n <= 1000 ? 30 : n <= 5000 ? 12 : 5;
  const txt = TRANSCRIPTS[n];
  const stat = timeit(() => F.correct(txt, { drugs: REAL_DRUGS }), iterations);
  record("scribe-drugfix.correct (real drug list)", `${n}w`, stat);
});

// ============================================================================================
// 2) scribe-rx.parse(text, {parseLine, drugs}) — realistic 10-line treatment block
// ============================================================================================
const RX = require(P("scribe-rx.js"));
// Mirrored VERBATIM from prescription.js:2422 (parseVoiceRx), same stub test/scribe-rx.test.mjs uses.
const RX_FREQ = { od: "OD", "once daily": "OD", "once a day": "OD", bd: "BD", "twice daily": "BD", "twice a day": "BD", "two times": "BD", tds: "TDS", tid: "TDS", thrice: "TDS", "three times": "TDS", qid: "QID", "four times": "QID", hs: "HS", "at night": "HS", "bed time": "HS", bedtime: "HS", sos: "SOS", "as needed": "SOS", prn: "SOS", stat: "STAT" };
function parseVoiceRx(text) {
  const t = String(text || "").trim(); if (!t) return null;
  const lower = t.toLowerCase();
  let freq = ""; Object.keys(RX_FREQ).forEach((k) => { if (!freq && new RegExp("\\b" + k.replace(/ /g, "\\s+") + "\\b", "i").test(lower)) freq = RX_FREQ[k]; });
  const dm = lower.match(/(\d+)\s*(days?|weeks?|months?)/); const duration = dm ? (dm[1] + " " + dm[2]) : "";
  const doseM = t.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?)?/i); const dose = doseM ? (doseM[1] + (doseM[2] ? (" " + doseM[2]) : "")) : "";
  const drugM = t.match(/^([a-z][a-z\s\-]*?)(?=\s*\d|\s+(?:od|bd|tds|tid|qid|hs|sos|prn|stat)\b|$)/i);
  const drugRaw = (drugM ? drugM[1] : t.split(/\s+/)[0] || "").trim();
  return { drug: drugRaw, dose, freq, duration };
}
const RX_BLOCK = [
  "tab pan 40 one before food for 5 days",
  "tab paracetamol 650 mg one TDS for 3 days",
  "cap azithromycin 500 mg OD for 3 days",
  "syp calpol 5 ml TDS x 3 days",
  "inj emeset 4 mg IV stat",
  "tab atorvastatin 20 mg HS",
  "tab losartan 50 mg OD",
  "tab metformin 500 mg BD",
  "tab amoxiclav 625 mg BD for 5 days",
  "tab omeprazole 20 mg OD before food"
].join("\n");
{
  const iterations = 500;
  const stat = timeit(() => RX.parse(RX_BLOCK, { parseLine: parseVoiceRx, drugs: REAL_DRUGS }), iterations);
  record("scribe-rx.parse (10-line treatment block)", "10 lines", stat);
}

// ============================================================================================
// 3) scribe-speaker.label(transcript) — text-only path, same 4 transcript sizes
// ============================================================================================
const SPK = require(P("scribe-speaker.js"));
SIZES.forEach((n) => {
  const iterations = n <= 200 ? 100 : n <= 1000 ? 40 : n <= 5000 ? 15 : 6;
  const txt = TRANSCRIPTS[n];
  const stat = timeit(() => SPK.label(txt), iterations);
  record("scribe-speaker.label (text-only)", `${n}w`, stat);
});

// ============================================================================================
// 4) scribe-safety.check(rows, ctx, {}) — degraded path (no engines) and trivial stubs, 5/15 rows
// ============================================================================================
const SAFE = require(P("scribe-safety.js"));
const MED_NAMES = ["Amoxicillin", "Ibuprofen", "Pantoprazole", "Metformin", "Atorvastatin", "Losartan",
  "Paracetamol", "Azithromycin", "Enalapril", "Clopidogrel", "Insulin glargine", "Levothyroxine",
  "Furosemide", "Amlodipine", "Ceftriaxone"];
function medRows(n) {
  return MED_NAMES.slice(0, n).map((g) => ({ drug: g, generic: g, matched: true }));
}
const CTX = { allergies: "penicillin", age: "45", sex: "F", pregnancy: "no", renal: false };
const TRIVIAL_STUBS = {
  analyzeRegimen: () => ({ findings: [] }),
  checkInteractions: () => ({ critical: [], major: [], moderate: [], minor: [], monitor: [], duplicates: [] })
};
[5, 15].forEach((n) => {
  const rowsN = medRows(n);
  let stat = timeit(() => SAFE.check(rowsN, CTX, {}), 500);
  record("scribe-safety.check (degraded, no engines)", `${n} rows`, stat);
  stat = timeit(() => SAFE.check(rowsN, CTX, TRIVIAL_STUBS), 500);
  record("scribe-safety.check (trivial stub engines)", `${n} rows`, stat);
});

// ============================================================================================
// 5) scribe-templates.get(id) / list()
// ============================================================================================
const TPL = require(P("scribe-templates.js"));
{
  let stat = timeit(() => TPL.get("paediatrics"), 2000);
  record("scribe-templates.get(id)", "1 call", stat);
  stat = timeit(() => TPL.list(), 2000);
  record("scribe-templates.list()", "1 call", stat);
}

// ============================================================================================
// 6) Module LOAD time: parse + execute on first require, per file + byte size
// ============================================================================================
const LOAD_FILES = ["scribe-drugfix.js", "scribe-rx.js", "scribe-icdsug.js", "scribe-safety.js",
  "scribe-speaker.js", "scribe-templates.js", "voice-ambient.js"];
const loadRows = [];
LOAD_FILES.forEach((f) => {
  const abs = P(f);
  const size = statSync(abs).size;
  const resolved = require.resolve(abs);
  const iterations = 40;
  const times = [];
  for (let i = 0; i < iterations; i++) {
    delete require.cache[resolved];
    const t0 = process.hrtime.bigint();
    require(abs);
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  loadRows.push({ op: "LOAD " + f, size, median, p95 });
});

// ============================================================================================
// Baseline: SMD_AMBIENT.reduce(transcript, opts) — the EXISTING hot function, O(n) per tick
// ============================================================================================
const AMBIENT = require(P("voice-ambient.js"));
SIZES.forEach((n) => {
  const iterations = n <= 200 ? 100 : n <= 1000 ? 40 : n <= 5000 ? 15 : 6;
  const txt = TRANSCRIPTS[n];
  const stat = timeit(() => AMBIENT.reduce(txt, { speaker: "doctor", state: {}, now: Date.now() }), iterations);
  record("BASELINE SMD_AMBIENT.reduce (existing, O(n)/tick)", `${n}w`, stat);
});

// ---- report ---------------------------------------------------------------------------------
function pad(s, w) { s = String(s); return s.length >= w ? s : s + " ".repeat(w - s.length); }
function fmt(ms) { return ms.toFixed(3); }

console.log("\n=== Operation timings (median / p95, ms) ===");
console.log(pad("Operation", 48) + pad("Input", 12) + pad("Median ms", 12) + "P95 ms");
rows.forEach((r) => {
  console.log(pad(r.op, 48) + pad(r.size, 12) + pad(fmt(r.median), 12) + fmt(r.p95));
});

console.log("\n=== Module load time (parse + execute on require) ===");
console.log(pad("File", 24) + pad("Bytes", 10) + pad("Median ms", 12) + "P95 ms");
loadRows.forEach((r) => {
  console.log(pad(r.op.replace("LOAD ", ""), 24) + pad(r.size, 10) + pad(fmt(r.median), 12) + fmt(r.p95));
});

const FRAME_MS = 16, PERCEPTIBLE_MS = 100;
console.log(`\n=== Threshold flags (this machine) — frame=${FRAME_MS}ms, perceptible=${PERCEPTIBLE_MS}ms ===`);
const all = rows.concat(loadRows.map((r) => ({ op: r.op, size: "-", median: r.median, p95: r.p95 })));
const overFrame = all.filter((r) => r.p95 > FRAME_MS);
const overPerceptible = all.filter((r) => r.p95 > PERCEPTIBLE_MS);
console.log(`Exceed ${FRAME_MS}ms (p95): ${overFrame.length ? "" : "none"}`);
overFrame.forEach((r) => console.log(`  - ${r.op} [${r.size}]: p95=${fmt(r.p95)}ms`));
console.log(`Exceed ${PERCEPTIBLE_MS}ms (p95): ${overPerceptible.length ? "" : "none"}`);
overPerceptible.forEach((r) => console.log(`  - ${r.op} [${r.size}]: p95=${fmt(r.p95)}ms`));

console.log(`\nNote: a low-end Android phone runs roughly 5-10x slower than this Mac. Multiply the`);
console.log(`above p95 numbers by 5-10x before judging safety on-device.`);
