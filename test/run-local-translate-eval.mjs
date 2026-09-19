/* test/run-local-translate-eval.mjs - offline-translate measurement harness.
 *
 * WHAT THIS MEASURES. functions/api/ai/[[path]].js's `translate` route sends a short clinical
 * dictation line (Telugu / Hindi / code-switched Indian English) to a model with a fixed prompt and
 * expects clean clinical ENGLISH back: drug names, doses, units and numbers untouched, no leftover
 * native script, no fabricated content. This script replays that exact prompt against a LOCAL
 * OpenAI-compatible server (llama.cpp's llama-server, Ollama, LM Studio, ...) over the fixtures in
 * test/fixtures/indic-translate.json and grades every reply.
 *
 * WHY THIS EXISTS. Per project policy a language may be marked "supported offline" in maik-local.js
 * (VERIFIED_LANGS) ONLY after this harness has actually been run against a candidate on-device model
 * and passed. A language must not be flagged offline-ready on the strength of a prompt reading well -
 * it needs a measured run against a real model.
 *
 * NO PROVIDER, NO RESULT. If no server answers the first request, this prints a NOT VERIFIED banner
 * and exits 2. It never substitutes a fake score - a fixture's expected tokens are a fact about the
 * fixture, not a fact about any model.
 *
 * Run against a local llama-server or Ollama:
 *   LOCAL_LLM_BASE_URL=http://localhost:11434/v1 LOCAL_LLM_MODEL=qwen2.5:3b-instruct \
 *     node test/run-local-translate-eval.mjs
 *
 * Validate the fixtures only, no network, no model required:
 *   node test/run-local-translate-eval.mjs --dry
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(HERE, "fixtures", "indic-translate.json");

/* The EXACT system prompt the server sends for kind:"translate" - copied verbatim from
 * functions/api/ai/[[path]].js so this harness grades the same instruction production uses. */
const TRANSLATE_PROMPT =
  "Translate this clinical dictation to clear clinical ENGLISH. Keep drug names, doses, units, " +
  "numbers and standard abbreviations (BP, IV, BD, OD) exactly. If it is already English, return it unchanged. " +
  "Output ONLY the translation — no preamble, labels or quotes.";

/* Same Indic-script block list as functions/api/ai/_opd-scribe.js stripIndic - a translation that
 * still contains any of these glyphs has not actually translated the dictation. */
const INDIC_RE = /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const langIdx = args.indexOf("--lang");
const LANG_FILTER = langIdx >= 0 ? args[langIdx + 1] : null;
const outIdx = args.indexOf("--out");
const OUT_ARG = outIdx >= 0 ? args[outIdx + 1] : null;

const BASE_URL = process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1";
const MODEL = process.env.LOCAL_LLM_MODEL || "";

function loadFixtures() {
  const all = JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));
  return LANG_FILTER ? all.filter((f) => f.lang === LANG_FILTER) : all;
}

function normalize(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function grade(fixture, output) {
  const text = normalize(output);
  const lower = text.toLowerCase();
  const nonEmpty = text.length > 0;
  const noIndicScript = !INDIC_RE.test(text);
  const expectPresent = fixture.expect.every((tok) => lower.includes(String(tok).toLowerCase()));
  const numbersPreserved = fixture.numbers.every((n) => text.includes(n));
  const outputNumbers = new Set((text.match(NUMBER_RE) || []).map((n) => n.replace(/,/g, "")));
  const numberSet = new Set(fixture.numbers);
  const noNewNumbers = [...outputNumbers].every((n) => numberSet.has(n));
  const checks = { nonEmpty, noIndicScript, expectPresent, numbersPreserved, noNewNumbers };
  const pass = Object.values(checks).every(Boolean);
  return { pass, checks, output: text };
}

/* ---- --dry: validate fixtures only, no network ------------------------------------------------- */
if (DRY) {
  const fixtures = loadFixtures();
  let bad = 0;
  for (const f of fixtures) {
    const found = new Set((f.text.match(/\b\d+(?:[.,]\d+)*\b/g) || []).map((n) => n.replace(/,/g, "")));
    const want = new Set(f.numbers);
    const same = found.size === want.size && [...found].every((n) => want.has(n));
    if (!f.id || !f.lang || !f.text || !Array.isArray(f.expect) || !Array.isArray(f.numbers) || !same) {
      console.log(`FAIL ${f.id || "(no id)"}: fixture shape or numbers mismatch`);
      bad++;
    }
  }
  console.log(`--dry: ${fixtures.length} fixtures checked, ${bad} bad`);
  process.exit(bad === 0 ? 0 : 1);
}

if (!MODEL) {
  console.error("LOCAL_LLM_MODEL is required (unless --dry). Example: LOCAL_LLM_MODEL=qwen2.5:3b-instruct");
  process.exit(2);
}

async function callModel(text) {
  const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: TRANSLATE_PROMPT },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body?.choices?.[0]?.message?.content || "";
}

const fixtures = loadFixtures();
let firstCallFailed = null;
const results = [];

for (const f of fixtures) {
  let output, error;
  try {
    output = await callModel(f.text);
  } catch (e) {
    error = String((e && e.message) || e);
    if (firstCallFailed === null && results.length === 0) firstCallFailed = error;
  }
  if (error) {
    if (results.length === 0) break;
    results.push({ id: f.id, lang: f.lang, pass: false, checks: {}, output: "", error });
    console.log(`FAIL ${f.id} (${f.lang}): request error - ${error}`);
    continue;
  }
  const graded = grade(f, output);
  results.push({ id: f.id, lang: f.lang, ...graded });
  const failedChecks = Object.entries(graded.checks).filter(([, v]) => !v).map(([k]) => k);
  const sample = graded.output.slice(0, 120);
  console.log(`${graded.pass ? "PASS" : "FAIL"} ${f.id} (${f.lang})${failedChecks.length ? " [" + failedChecks.join(",") + "]" : ""}: ${sample}`);
}

if (results.length === 0) {
  console.log(`
=========================================================================
NOT VERIFIED: no model server answered at ${BASE_URL}
=========================================================================
${firstCallFailed || "no response"}

The harness and its fixtures are in place, but no model was run, so there
are no per-language pass rates and none are claimed. A language stays out
of VERIFIED_LANGS in maik-local.js until this script has actually passed
against a candidate on-device model.

Start a local OpenAI-compatible server, then re-run:
  llama-server: llama-server -m <model.gguf> --port 11434
  Ollama:       ollama serve && ollama pull qwen2.5:3b-instruct
  LOCAL_LLM_MODEL=<model> LOCAL_LLM_BASE_URL=${BASE_URL} node test/run-local-translate-eval.mjs
=========================================================================`);
  process.exit(2);
}

/* ---- per-language summary --------------------------------------------------------------------- */
const byLang = {};
for (const r of results) {
  const b = (byLang[r.lang] ||= { n: 0, passed: 0, numbersOk: 0, expectOk: 0 });
  b.n++;
  if (r.pass) b.passed++;
  if (r.checks.numbersPreserved && r.checks.noNewNumbers) b.numbersOk++;
  if (r.checks.expectPresent) b.expectOk++;
}

console.log("\nlang     n  passed  pass%   numbers%  expect%");
let allLangsClean = true;
let totalPassed = 0;
for (const [lang, b] of Object.entries(byLang)) {
  const passRate = b.passed / b.n;
  const numRate = b.numbersOk / b.n;
  const expRate = b.expectOk / b.n;
  totalPassed += b.passed;
  if (numRate < 1) allLangsClean = false;
  console.log(
    `${lang.padEnd(8)} ${String(b.n).padEnd(3)} ${String(b.passed).padEnd(7)} ${(passRate * 100).toFixed(0).padStart(4)}%   ${(numRate * 100).toFixed(0).padStart(5)}%    ${(expRate * 100).toFixed(0).padStart(4)}%`
  );
}
const overallPassRate = totalPassed / results.length;
console.log(`\noverall pass rate: ${(overallPassRate * 100).toFixed(1)}%`);

const OUT_PATH = OUT_ARG || join(HERE, "local-translate-eval", `${MODEL.replace(/[^\w.-]+/g, "_")}.json`);
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      model: MODEL,
      baseUrl: BASE_URL,
      timestamp: new Date().toISOString(),
      results,
      summary: byLang,
    },
    null,
    2
  )
);
console.log(`\nwrote ${OUT_PATH}`);

const gatePassed = allLangsClean && overallPassRate >= 0.9;
if (!gatePassed) {
  console.log("\nGATE NOT MET: every language needs 100% numbersPreserved+noNewNumbers and overall pass rate >= 90%.");
}
process.exit(gatePassed ? 0 : 1);
