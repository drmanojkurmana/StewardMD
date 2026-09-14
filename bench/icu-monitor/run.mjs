/* bench/icu-monitor/run.mjs — ICU monitor extraction benchmark.
 *
 *   node bench/icu-monitor/run.mjs [--ocr] [--only <substr>] [--out bench/icu-monitor/out]
 *
 * For every fixtures/<case>.json: Apple Vision observations (from a cached <case>.obs.json, or run
 * live with --ocr through the Swift probe on this Mac; the device run is test/run-icu-ocr-device.mjs),
 * colour from the SAME JS sampler the app uses (pixels via PIL), then icu-monitor-parser.js, scored
 * against the ground truth. Writes out/report.md, out/results.json, out/<case>.evidence.txt and
 * out/<case>.overlay.svg. Never touches the network.
 *
 * Scoring per field (truth status → outcome):
 *   visible      : AUTO == value → correct | AUTO != value → WRONG (silent guess) | NEEDS_REVIEW → review | NOT_FOUND → missed
 *   ambiguous    : NEEDS_REVIEW/NOT_FOUND → correct-review | AUTO → SILENT GUESS (even if the value happens to match)
 *   not_visible  : NOT_FOUND/NEEDS_REVIEW → correct-abstain | AUTO → SILENT GUESS
 *   not_applicable: same as not_visible
 * "Safe extraction accuracy" = (correct + correct-review + correct-abstain) / scored fields. */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { pixelSource } from "./pixsource.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(new URL(import.meta.url).pathname);
const M = require(join(HERE, "..", "..", "icu-monitor-parser.js"));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const POLICY = opt("--policy", "strict");          // strict: no label → NEEDS_REVIEW; relaxed: slot + channel colour may auto-fill
const OUT = opt("--out", join(HERE, POLICY === "strict" ? "out" : "out-" + POLICY));
const ONLY = opt("--only", null);
const LIVE_OCR = flag("--ocr");
const PARSE_OPTS = POLICY === "relaxed" ? { unlabeledAuto: true } : {};
const FIX = join(HERE, "fixtures");
mkdirSync(OUT, { recursive: true });

const CORE = ["hr", "spo2", "sbp", "dbp", "map", "rr"];
const OPTIONAL = ["pulse", "pvc", "temp", "etco2"];
const ALL = CORE.concat(OPTIONAL);

function findCases(dir, acc = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) findCases(p, acc);
    else if (f.name.endsWith(".json") && !f.name.endsWith(".obs.json")) acc.push(p);
  }
  return acc;
}
let probeBin = null;
function probe() {
  if (probeBin) return probeBin;
  const src = join(HERE, "visionprobe.swift"), bin = join(OUT, "visionprobe");
  if (!existsSync(bin)) execFileSync("swiftc", ["-O", "-o", bin, src], { stdio: "inherit" });
  return (probeBin = bin);
}
function observations(casePath, gt) {
  const cache = casePath.replace(/\.json$/, ".obs.json");
  if (!LIVE_OCR && existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const img = join(dirname(casePath), gt.image);
  const t0 = Date.now();
  const out = execFileSync(probe(), [img, "0", "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  const j = JSON.parse(out); j.ocrMs = Date.now() - t0;
  writeFileSync(cache, JSON.stringify(j));
  return j;
}
function truthOf(gt, k) {
  const f = gt.fields || {};
  if (k === "sbp" || k === "dbp" || k === "map") {
    const e = f[k]; if (e) return e;
    const src = f.art && f.art.status === "visible" ? f.art : f.nibp && f.nibp.status === "visible" ? f.nibp : null;
    if (src && src.value && src.value[k] != null) return { status: "visible", value: src.value[k] };
    return { status: "not_visible" };
  }
  return f[k] || { status: "not_applicable" };
}
function outcome(truth, pred) {
  const auto = pred && pred.status === "AUTO_ACCEPTED", review = pred && pred.status === "NEEDS_REVIEW";
  const pv = pred ? pred.value : null;
  if (truth.status === "visible") {
    if (auto) return pv === truth.value ? "correct" : "wrong";
    return review ? "review" : "missed";
  }
  if (truth.status === "ambiguous") return auto ? "silent-guess" : "correct-review";
  return auto ? "silent-guess" : "correct-abstain";   // not_visible / not_applicable
}

const cases = findCases(FIX).filter((p) => !ONLY || p.includes(ONLY)).sort();
if (!cases.length) { console.error("no fixtures under " + FIX); process.exit(2); }
const results = [];
for (const casePath of cases) {
  const gt = JSON.parse(readFileSync(casePath, "utf8"));
  const img = join(dirname(casePath), gt.image);
  let obsJ;
  try { obsJ = observations(casePath, gt); } catch (e) { console.error("OCR failed for", gt.id, String(e.message).slice(0, 200)); continue; }
  const obs = (obsJ.obs || []).map((o) => ({ text: o.text, conf: o.conf, x: o.x, y: o.y, w: o.w, h: o.h }));
  let px = null; try { if (existsSync(img)) px = pixelSource(img); } catch (e) { /* colour becomes neutral */ }
  const mem0 = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  const res = M.parseMonitor(obs, Object.assign({ px }, PARSE_OPTS));
  const parseMs = Date.now() - t0;
  const fields = {};
  for (const k of ALL) {
    const truth = truthOf(gt, k), pred = res.fields[k] || { status: "NOT_FOUND", value: null };
    fields[k] = { truth: truth.status, expected: truth.value == null ? null : truth.value, status: pred.status, value: pred.value == null ? null : pred.value, suggested: pred.suggested == null ? null : pred.suggested, confidence: pred.confidence || 0, outcome: outcome(truth, pred), reason: pred.reason || null };
  }
  const colourUsed = Object.values(res.fields).some((f) => (f.candidates || []).some((c) => c.parts && !c.parts.colorNeutral));
  results.push({ id: gt.id, manufacturer: gt.manufacturer, layout: gt.layout, difficulty: gt.difficulty || [], synthetic: !!gt.synthetic, image: gt.image, imageSize: obsJ.image || gt.imageSize, boxes: obs.length, ocrMs: obsJ.ocrMs || null, parseMs, heapKB: Math.round((process.memoryUsage().heapUsed - mem0) / 1024), layoutDetected: res.layout.profile, colourUsed, fields, networkCalls: 0 });
  writeFileSync(join(OUT, gt.id + ".evidence.txt"), M.explain(res, obs));
  const W = (obsJ.image && obsJ.image.w) || (gt.imageSize && gt.imageSize.w) || 1000, H = (obsJ.image && obsJ.image.h) || (gt.imageSize && gt.imageSize.h) || 1000;
  writeFileSync(join(OUT, gt.id + ".overlay.svg"), M.overlaySVG(res, obs, W, H).replace(' style="position:absolute;left:0;top:0;pointer-events:none"', existsSync(img) ? '><image href="' + (img.startsWith("/") ? "file://" + img : img) + '" width="' + W + '" height="' + H + '"/' : ""));
}

/* ------------------------------------------------------------------ metrics */
function metrics(rows, keys) {
  const m = {};
  for (const k of keys) {
    const o = { visible: 0, correct: 0, wrong: 0, review: 0, missed: 0, autoEmitted: 0, silentGuess: 0, correctReview: 0, correctAbstain: 0, scored: 0 };
    for (const r of rows) {
      const f = r.fields[k]; if (!f) continue;
      if (f.truth === "not_applicable" && f.status !== "AUTO_ACCEPTED") continue;   // nothing to score unless it guessed
      o.scored++;
      if (f.truth === "visible") o.visible++;
      if (f.status === "AUTO_ACCEPTED") o.autoEmitted++;
      o[{ correct: "correct", wrong: "wrong", review: "review", missed: "missed", "silent-guess": "silentGuess", "correct-review": "correctReview", "correct-abstain": "correctAbstain" }[f.outcome]]++;
    }
    const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
    m[k] = {
      ...o,
      exactAccuracy: pct(o.correct, o.visible),
      recall: pct(o.correct, o.visible),
      precision: pct(o.correct, o.autoEmitted),
      falsePositiveRate: pct(o.wrong + o.silentGuess, o.autoEmitted),
      needsReviewRate: pct(o.review + o.correctReview, o.scored),
      silentGuessRate: pct(o.wrong + o.silentGuess, o.scored),
      safeAccuracy: pct(o.correct + o.correctReview + o.correctAbstain, o.scored)
    };
  }
  return m;
}
const overall = metrics(results, ALL);
const byMfr = {}, byLayout = {};
for (const r of results) { (byMfr[r.manufacturer] ||= []).push(r); (byLayout[r.layout] ||= []).push(r); }
const mfrMetrics = Object.fromEntries(Object.entries(byMfr).map(([k, v]) => [k, metrics(v, CORE)]));
const layoutMetrics = Object.fromEntries(Object.entries(byLayout).map(([k, v]) => [k, metrics(v, CORE)]));
const avg = (xs) => xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null;
const summary = {
  cases: results.length, real: results.filter((r) => !r.synthetic).length, synthetic: results.filter((r) => r.synthetic).length,
  manufacturers: Object.fromEntries(Object.entries(byMfr).map(([k, v]) => [k, v.length])),
  avgOcrMs: avg(results.map((r) => r.ocrMs).filter((x) => x != null)), avgParseMs: avg(results.map((r) => r.parseMs)), avgBoxes: avg(results.map((r) => r.boxes)),
  totalNetworkCalls: 0, geminiFallbacks: 0,
  silentGuessesTotal: results.reduce((n, r) => n + Object.values(r.fields).filter((f) => f.outcome === "wrong" || f.outcome === "silent-guess").length, 0),
  colourUsedCases: results.filter((r) => r.colourUsed).length
};
writeFileSync(join(OUT, "results.json"), JSON.stringify({ summary, overall, byManufacturer: mfrMetrics, byLayout: layoutMetrics, cases: results }, null, 2));

/* ------------------------------------------------------------------ report */
const L = [];
L.push("# ICU monitor extraction benchmark (policy: " + POLICY + ")", "", `Generated ${new Date().toISOString()} · parser v${M.VERSION} · ${summary.cases} cases (${summary.real} real, ${summary.synthetic} synthetic) · colour used in ${summary.colourUsedCases} cases · policy ${POLICY}${POLICY === "strict" ? " (no label → NEEDS_REVIEW)" : " (slot + channel colour may auto-fill an unlabeled value)"}`, "");
L.push(`Avg OCR ${summary.avgOcrMs ?? "cached"} ms · avg parse ${summary.avgParseMs} ms · avg boxes ${summary.avgBoxes} · network calls ${summary.totalNetworkCalls} · Gemini fallbacks ${summary.geminiFallbacks} · **silent guesses ${summary.silentGuessesTotal}**`, "");
L.push("## Field accuracy (all cases)", "", "| field | visible | correct | wrong | review | missed | exact % | recall % | precision % | FP % | needs-review % | silent-guess % | safe % |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const k of ALL) { const m = overall[k]; L.push(`| ${k} | ${m.visible} | ${m.correct} | ${m.wrong + m.silentGuess} | ${m.review + m.correctReview} | ${m.missed} | ${m.exactAccuracy ?? "-"} | ${m.recall ?? "-"} | ${m.precision ?? "-"} | ${m.falsePositiveRate ?? "-"} | ${m.needsReviewRate ?? "-"} | ${m.silentGuessRate ?? "-"} | ${m.safeAccuracy ?? "-"} |`); }
L.push("", "## Per manufacturer (core fields, exact % / safe %)", "", "| manufacturer | cases | " + CORE.join(" | ") + " |", "|---|---|" + CORE.map(() => "---").join("|") + "|");
for (const [k, m] of Object.entries(mfrMetrics)) L.push(`| ${k} | ${byMfr[k].length} | ` + CORE.map((f) => `${m[f].exactAccuracy ?? "-"} / ${m[f].safeAccuracy ?? "-"}`).join(" | ") + " |");
L.push("", "## Per layout (core fields, exact % / safe %)", "", "| layout | cases | " + CORE.join(" | ") + " |", "|---|---|" + CORE.map(() => "---").join("|") + "|");
for (const [k, m] of Object.entries(layoutMetrics)) L.push(`| ${k} | ${byLayout[k].length} | ` + CORE.map((f) => `${m[f].exactAccuracy ?? "-"} / ${m[f].safeAccuracy ?? "-"}`).join(" | ") + " |");
L.push("", "## Failures and abstentions", "");
for (const r of results) {
  const bad = Object.entries(r.fields).filter(([, f]) => f.outcome === "wrong" || f.outcome === "silent-guess" || f.outcome === "missed" || f.outcome === "review");
  if (!bad.length) continue;
  L.push(`- **${r.id}** (${r.manufacturer}, ${r.difficulty.join("+") || "clean"}, ${r.boxes} boxes, layout=${r.layoutDetected}): ` + bad.map(([k, f]) => `${k} ${f.outcome}` + (f.outcome === "review" || f.outcome === "missed" ? ` (expected ${JSON.stringify(f.expected)}${f.suggested != null ? ", suggested " + JSON.stringify(f.suggested) : ""}${f.reason ? ": " + f.reason : ""})` : ` (expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.value)})`)).join("; "));
}
L.push("", "## Per case", "", "| case | mfr | difficulty | boxes | OCR ms | parse ms | " + CORE.join(" | ") + " |", "|---|---|---|---|---|---|" + CORE.map(() => "---").join("|") + "|");
for (const r of results) L.push(`| ${r.id} | ${r.manufacturer} | ${r.difficulty.join("+") || "clean"} | ${r.boxes} | ${r.ocrMs ?? "-"} | ${r.parseMs} | ` + CORE.map((k) => { const f = r.fields[k]; const v = f.value == null ? (f.suggested != null ? "?" + f.suggested : "·") : f.value; return `${v} ${f.outcome === "correct" || f.outcome.startsWith("correct") ? "✓" : f.outcome === "review" ? "R" : f.outcome === "missed" ? "M" : "✗"}`; }).join(" | ") + " |");
writeFileSync(join(OUT, "report.md"), L.join("\n") + "\n");
console.log(L.slice(0, 18).join("\n"));
console.log(`\nreport: ${join(OUT, "report.md")}`);
if (summary.silentGuessesTotal) { console.error(`\nSILENT GUESSES: ${summary.silentGuessesTotal}`); process.exitCode = 1; }
