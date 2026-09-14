/* bench/icu-monitor/run.mjs — ICU monitor extraction benchmark (local only: Apple Vision + parser).
 *
 *   node bench/icu-monitor/run.mjs [--policy strict|relaxed] [--scales 1|2] [--ocr] [--sweep] [--only <substr>]
 *
 * THREE GROUPS, NEVER POOLED:
 *   real            real photographs as taken (today: 1, the owner's Philips MP40)
 *   perturbed-real  images DERIVED from real photographs (resize, JPEG, light, blur, glare, rotation,
 *                   perspective, crop); photographic robustness, not new monitors
 *   synthetic       rendered screens of six layouts; layout handling, not photographic accuracy
 * Unit-test fixtures (test/fixtures/*.json) are not part of this benchmark.
 *
 * Per case: Apple Vision on the full image (cached <case>.obs.json), then — with --scales 2, the
 * default — Vision again on the parser-chosen monitor region at a higher scale (cached
 * <case>.crop.json), mapped back and unioned (icu-monitor-parser.js mergeObservations). Colour and the
 * image-quality gate use the same JS the app runs, over PIL-decoded pixels. Gemini is never called:
 * this measures LOCAL extraction; Gemini fallback is an app-side, on-tap path counted separately.
 *
 * Scoring per field (truth status → outcome):
 *   visible       : AUTO == value → correct | AUTO != value → WRONG (silent guess) | review | missed
 *   ambiguous     : review / not found → correct-review | AUTO → SILENT GUESS (even if digits match)
 *   not_visible / not_applicable : review / not found → correct-abstain | AUTO → SILENT GUESS
 * "Safe" = (correct + correct-review + correct-abstain) / scored. The run exits non-zero on any silent
 * guess, any AUTO field without complete evidence, or a failed mandatory regression. */
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
const POLICY = opt("--policy", "strict");
const SCALES = Number(opt("--scales", "2"));
const OUT = opt("--out", join(HERE, (POLICY === "strict" ? "out" : "out-" + POLICY) + (SCALES === 1 ? "-1scale" : "")));
const ONLY = opt("--only", null);
const LIVE_OCR = flag("--ocr");
const SWEEP = flag("--sweep");
const PARSE_OPTS = POLICY === "relaxed" ? { unlabeledAuto: true } : {};
// --verify none | <field,field>: which fields need the independent digit check (default: the parser's VERIFY_FIELDS)
const VERIFY_OPT = opt("--verify", null);
if (VERIFY_OPT) PARSE_OPTS.verifyFields = VERIFY_OPT === "none" ? [] : VERIFY_OPT.split(",");
// --disable rule,rule: switch parser rules off for ablation (icu-monitor-parser.js FEATURES)
const DISABLE_OPT = opt("--disable", null);
if (DISABLE_OPT) PARSE_OPTS.disable = DISABLE_OPT.split(",");
const FIX = join(HERE, "fixtures");
mkdirSync(OUT, { recursive: true });

const CORE = ["hr", "spo2", "sbp", "dbp", "map", "rr"];
const OPTIONAL = ["pulse", "pvc", "temp", "etco2"];
const SOURCES = ["art", "nibp"];
const ALL = CORE.concat(OPTIONAL, SOURCES);
// external-real / external-draft: third-party monitor photos (fixtures/external, internal use only, not
// committed). Values are labelled by us; "draft" labels are not yet human-confirmed, so guesses there are
// reported as "check the label" and do not fail acceptance.
const GROUPS = ["real", "perturbed-real", "synthetic", "external-real", "external-draft"];
const ACCEPTANCE_GROUPS = ["real", "perturbed-real", "synthetic", "external-real"];

function findCases(dir, acc = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) findCases(p, acc);
    else if (f.name.endsWith(".json") && !/\.(obs|crop|confirm\.cache)\.json$/.test(f.name) && !f.name.startsWith("AUDIT")) acc.push(p);
  }
  return acc;
}
let probeBin = null;
function probe() {
  if (flag("--cached-only")) throw new Error("--cached-only: no admissible cache, refusing to run Mac Vision");
  if (probeBin) return probeBin;
  const src = join(HERE, "visionprobe.swift"), bin = join(HERE, "out", "visionprobe");
  mkdirSync(join(HERE, "out"), { recursive: true });
  if (!existsSync(bin)) execFileSync("swiftc", ["-O", "-o", bin, src], { stdio: "inherit" });
  return (probeBin = bin);
}
function vision(img, extra) {
  const t0 = Date.now();
  const out = execFileSync(probe(), [img, "0", "-", "-"].concat(extra || []), { encoding: "utf8", maxBuffer: 64 << 20 });
  const j = JSON.parse(out); j.ocrMs = Date.now() - t0;
  // only the recognizer the phone uses is admissible; anything else is an OCR failure, not a data point
  if (j.level !== "accurate") throw new Error("vision ran at level " + j.level + "; refusing to score it");
  return j;
}
// Mac Vision caches carry the quad (q); caches read on the iPhone (bench/icu-monitor/device-run.mjs,
// engine "ios-device") may not, because the installed plugin does not return it
const admissible = (j) => j && j.level === "accurate" && j.obs && (j.obs.length === 0 || j.obs[0].q || j.engine === "ios-device");
// During the macOS Neural Engine fault Vision can also "succeed" with ZERO observations on a perfectly
// readable photo (8 Rios frames, 2026-09-14). An empty full-image read is an OCR failure: never cached,
// never scored (a real blank screen still has chrome text; RETAKE cases in the fixtures all have boxes).
function fullPass(casePath, img) {
  const cache = casePath.replace(/\.json$/, ".obs.json");
  if (!LIVE_OCR && existsSync(cache)) { const j = JSON.parse(readFileSync(cache, "utf8")); if (admissible(j) && j.obs.length) return j; }
  const j = vision(img);
  if (!j.obs.length) throw new Error("Vision returned no text for the full image (treated as an OCR failure, not cached)");
  writeFileSync(cache, JSON.stringify(j)); return j;
}
function cropPass(casePath, img, region) {
  const cache = casePath.endsWith(".confirm.json") ? casePath.replace(/\.confirm\.json$/, ".confirm.cache.json") : casePath.replace(/\.json$/, ".crop.json");
  const key = [region.x, region.y, region.w, region.h, region.scale].map((v) => (+v).toFixed(4)).join(",");
  if (!LIVE_OCR && existsSync(cache)) { const j = JSON.parse(readFileSync(cache, "utf8")); if (j.key === key && admissible(j)) return j; }
  const j = vision(img, [`crop=${region.x},${region.y},${region.w},${region.h}`, `scale=${region.scale}`]);
  j.key = key; j.region = region; writeFileSync(cache, JSON.stringify(j)); return j;
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
function sameReading(pred, truth) {
  if (!pred || !truth) return false;
  if (pred.s !== truth.sbp || pred.d !== truth.dbp) return false;
  return pred.map == null || pred.map === truth.map;
}
function outcome(k, truth, pred) {
  const auto = pred && pred.status === "AUTO_ACCEPTED", review = pred && pred.status === "NEEDS_REVIEW";
  if (truth.status === "visible") {
    // a pressure auto-filled from the WRONG SOURCE (ART vs NIBP) is a wrong clinical value even with right digits
    const srcOf = (s) => (s == null ? null : /^(?:ART|ABP|IBP\d?|P1)$/i.test(s) ? "ART" : /^(?:NIBP|NBP)$/i.test(s) ? "NIBP" : String(s).toUpperCase());
    if (auto && ["sbp", "dbp", "map"].includes(k) && truth.source && pred.source && srcOf(truth.source) !== srcOf(pred.source)) return "wrong";
    if (auto) return (SOURCES.includes(k) ? sameReading(pred.value, truth.value) : pred.value === truth.value) ? "correct" : "wrong";
    return review ? "review" : "missed";
  }
  if (truth.status === "unlabelled") return auto ? "auto-unlabelled" : "unlabelled";   // never scored
  if (truth.status === "ambiguous") return auto ? "silent-guess" : "correct-review";
  return auto ? "silent-guess" : "correct-abstain";
}
function scoreCase(gt, res) {
  const fields = {};
  for (const k of ALL) {
    const truth = truthOf(gt, k), pred = res.fields[k] || { status: "NOT_FOUND", value: null };
    fields[k] = { truth: truth.status, expected: truth.value == null ? null : truth.value, status: pred.status, value: pred.value == null ? null : pred.value, suggested: pred.suggested == null ? null : pred.suggested,
      confidence: pred.confidence || 0, outcome: outcome(k, truth, pred), reason: pred.reason || null, retake: !!pred.retake,
      mapMissing: SOURCES.includes(k) && pred.status === "AUTO_ACCEPTED" && pred.value && pred.value.map == null && truth.value && truth.value.map != null };
  }
  return fields;
}

const cases = findCases(FIX).filter((p) => !ONLY || p.includes(ONLY)).sort();
if (!cases.length) { console.error("no fixtures under " + FIX); process.exit(2); }
const results = [], prepared = [];
for (const casePath of cases) {
  const gt = JSON.parse(readFileSync(casePath, "utf8"));
  const group = gt.group || (gt.synthetic ? "synthetic" : "real");
  const img = join(dirname(casePath), gt.image);
  let full, crop = null, region = null;
  try { full = fullPass(casePath, img); } catch (e) { console.error("OCR failed for", gt.id, String(e.message).slice(0, 200)); continue; }
  const imageSize = full.image || gt.imageSize;
  const fullObs = (full.obs || []).map((o) => ({ text: o.text, conf: o.conf, x: o.x, y: o.y, w: o.w, h: o.h, q: o.q }));
  let obs = fullObs, mergeNotes = [], confirmMs = null, confirmRan = false;
  if (SCALES === 2) {
    region = M.monitorRegion(fullObs, imageSize);
    if (region) {
      try { crop = cropPass(casePath, img, region); } catch (e) { console.error("crop OCR failed for", gt.id, String(e.message).slice(0, 160)); }
      if (crop) { const mapped = M.mapCropObservations(crop.obs.map((o) => ({ text: o.text, conf: o.conf, x: o.x, y: o.y, w: o.w, h: o.h, q: o.q })), region); obs = M.mergeObservations(fullObs, mapped); mergeNotes = obs.notes || []; }
    }
    // third, targeted read: confirm (or conflict) large values the first two passes did not both read
    const creg = M.confirmationRegion(obs, imageSize);
    if (creg && (crop || !region)) {
      try {
        const conf = cropPass(casePath.replace(/\.json$/, ".confirm.json"), img, creg);
        obs = M.applyConfirmation(obs, M.mapCropObservations(conf.obs.map((o) => ({ text: o.text, conf: o.conf, x: o.x, y: o.y, w: o.w, h: o.h })), creg));
        mergeNotes = obs.notes || mergeNotes; confirmMs = conf.ocrMs || null; confirmRan = true;
      } catch (e) { console.error("confirmation OCR failed for", gt.id, String(e.message).slice(0, 120)); }
    }
  }
  let px = null; try { if (existsSync(img)) px = pixelSource(img); } catch (e) { /* colour + quality pixel checks become neutral */ }
  const t0 = Date.now();
  const twoScale = SCALES === 2 ? { ran: !!crop || confirmRan } : null;
  const res = M.parseMonitor(obs, Object.assign({ px, imageSize, twoScale }, PARSE_OPTS));
  const parseMs = Date.now() - t0;
  const fields = scoreCase(gt, res);
  const incomplete = Object.entries(res.fields).filter(([, f]) => f.status === "AUTO_ACCEPTED" && !(f.proof && f.proof.complete)).map(([k]) => k);
  const colourUsed = Object.values(res.fields).some((f) => (f.candidates || []).some((c) => c.parts && !c.parts.colorNeutral));
  results.push({ id: gt.id, group, manufacturer: gt.manufacturer, layout: gt.layout, difficulty: gt.difficulty || [], perturbation: gt.perturbation || null, mandatoryRegression: !!gt.mandatoryRegression,
    image: gt.image, imageSize, boxesFull: fullObs.length, boxesMerged: obs.length, recovered: obs.filter((o) => o.scale === "crop").length, region, mergeNotes,
    ocrMsFull: full.ocrMs || null, ocrMsCrop: crop ? crop.ocrMs || null : null, ocrMsConfirm: confirmMs, visionLevel: [full.level, crop && crop.level].filter(Boolean),
    parseMs, quality: { status: res.quality.status, issues: res.quality.issues.map((i) => `${i.kind}:${i.severity}:${i.value}`), blur: res.quality.blur, tilt: res.quality.tilt && +res.quality.tilt.angle.toFixed(1) },
    layoutDetected: res.layout.profile, colourUsed, incompleteEvidence: incomplete, fields, networkCalls: 0, geminiCalls: 0 });
  // decoded pixels are ~10 MB per photo: keep them only where a later re-parse needs them (the regression
  // cases, or every case with --sweep); holding all 268 exhausted memory (2026-09-15)
  const keepPx = SWEEP || /^philips-mp40-owner-(?:900|1800)px$/.test(gt.id);
  prepared.push({ gt, group, obs, px: keepPx ? px : null, imageSize, id: gt.id, twoScale });
  writeFileSync(join(OUT, gt.id + ".evidence.txt"), M.explain(res, obs));
  const Wd = imageSize.w, Ht = imageSize.h;
  writeFileSync(join(OUT, gt.id + ".overlay.svg"), M.overlaySVG(res, obs, Wd, Ht).replace(' style="position:absolute;left:0;top:0;pointer-events:none">', existsSync(img) ? '><image href="file://' + img + '" width="' + Wd + '" height="' + Ht + '"/>' : ">"));
}

/* ------------------------------------------------------------------ metrics */
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
function metrics(rows, keys) {
  const m = {};
  for (const k of keys) {
    const o = { visible: 0, correct: 0, wrong: 0, review: 0, missed: 0, autoEmitted: 0, silentGuess: 0, correctReview: 0, correctAbstain: 0, scored: 0, retake: 0, autoUnlabelled: 0 };
    for (const r of rows) {
      const f = r.fields[k]; if (!f) continue;
      if (f.truth === "unlabelled") { if (f.status === "AUTO_ACCEPTED") o.autoUnlabelled++; continue; }
      if (f.truth === "not_applicable" && f.status !== "AUTO_ACCEPTED") continue;
      o.scored++;
      if (f.truth === "visible") o.visible++;
      if (f.status === "AUTO_ACCEPTED") o.autoEmitted++;
      if (f.retake) o.retake++;
      o[{ correct: "correct", wrong: "wrong", review: "review", missed: "missed", "silent-guess": "silentGuess", "correct-review": "correctReview", "correct-abstain": "correctAbstain" }[f.outcome]]++;
    }
    m[k] = { ...o, exactAccuracy: pct(o.correct, o.visible), recall: pct(o.correct, o.visible), precision: pct(o.correct, o.autoEmitted), falsePositiveRate: pct(o.wrong + o.silentGuess, o.autoEmitted),
      needsReviewRate: pct(o.review + o.correctReview, o.scored), silentGuessRate: pct(o.wrong + o.silentGuess, o.scored), safeAccuracy: pct(o.correct + o.correctReview + o.correctAbstain, o.scored) };
  }
  return m;
}
const avg = (xs) => { xs = xs.filter((x) => x != null); return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null; };
const byGroup = {};
for (const g of GROUPS) {
  const rows = results.filter((r) => r.group === g); if (!rows.length) continue;
  const by = (key) => { const o = {}; for (const r of rows) { const v = typeof key === "function" ? key(r) : r[key]; (o[v] ||= []).push(r); } return o; };
  byGroup[g] = {
    cases: rows.length, overall: metrics(rows, ALL),
    byManufacturer: Object.fromEntries(Object.entries(by("manufacturer")).map(([k, v]) => [k, { cases: v.length, m: metrics(v, CORE) }])),
    byLayout: Object.fromEntries(Object.entries(by("layout")).map(([k, v]) => [k, { cases: v.length, m: metrics(v, CORE) }])),
    silentGuesses: rows.reduce((n, r) => n + Object.values(r.fields).filter((f) => f.outcome === "wrong" || f.outcome === "silent-guess").length, 0),
    incompleteEvidence: rows.reduce((n, r) => n + r.incompleteEvidence.length, 0),
    retake: rows.filter((r) => r.quality.status === "RETAKE_PHOTO").length, degraded: rows.filter((r) => r.quality.status === "DEGRADED").length,
    avgOcrMsFull: avg(rows.map((r) => r.ocrMsFull)), avgOcrMsCrop: avg(rows.map((r) => r.ocrMsCrop)), avgParseMs: avg(rows.map((r) => r.parseMs)),
    avgBoxesFull: avg(rows.map((r) => r.boxesFull)), avgRecovered: avg(rows.map((r) => r.recovered)), colourUsed: rows.filter((r) => r.colourUsed).length
  };
}

/* ------------------------------------------------------------------ mandatory regressions */
const regressions = [];
{
  const p = prepared.find((c) => c.id === "philips-mp40-owner-1800px");
  if (p) {
    const relaxed = M.parseMonitor(p.obs, { px: p.px, imageSize: p.imageSize, twoScale: p.twoScale, unlabeledAuto: true }).values;
    const want = { hr: 105, spo2: 100, sbp: 149, dbp: 66, map: 98, rr: 22 };
    const got = Object.fromEntries(Object.keys(want).map((k) => [k, relaxed[k]]));
    regressions.push({ name: "Philips 2x photo, unlabeledAuto: HR 105, SpO2 100, 149/66, MAP 98, RR 22 (Pulse not inferred)", pass: JSON.stringify(got) === JSON.stringify(want) && relaxed.pulse == null, got: JSON.stringify(got) + " pulse=" + relaxed.pulse });
    const strict = M.parseMonitor(p.obs, { px: p.px, imageSize: p.imageSize, twoScale: p.twoScale });
    const wrong = CORE.filter((k) => strict.fields[k].status === "AUTO_ACCEPTED" && strict.fields[k].value !== want[k]);
    const autoCore = CORE.filter((k) => strict.fields[k].status === "AUTO_ACCEPTED");
    regressions.push({ name: "Philips 2x photo, strict: no wrong auto-fill; every non-auto core field suggests the true value", pass: !wrong.length && CORE.every((k) => strict.fields[k].status === "AUTO_ACCEPTED" || strict.fields[k].suggested === want[k]), got: "auto " + autoCore.join(",") + (wrong.length ? " WRONG " + wrong.join(",") : "") });
  }
  const r9 = prepared.find((c) => c.id === "philips-mp40-owner-900px");
  if (r9) {
    const s = M.parseMonitor(r9.obs, { px: r9.px, imageSize: r9.imageSize, twoScale: r9.twoScale });
    const want = { hr: 105, spo2: 100, sbp: 149, dbp: 66, rr: 22 };
    const wrong = Object.keys(want).filter((k) => s.fields[k].status === "AUTO_ACCEPTED" && s.fields[k].value !== want[k]);
    regressions.push({ name: "Philips real 900px, strict: no wrong auto-fill, MAP never computed, Pulse never inferred", pass: !wrong.length && (s.fields.map.value == null || s.fields.map.value === 98) && s.fields.pulse.value !== 105 || (!wrong.length && s.fields.pulse.status === "AUTO_ACCEPTED" && s.fields.pulse.label), got: "auto " + Object.keys(s.values).join(",") });
  }
}

/* ------------------------------------------------------------------ threshold sweep */
const sweep = {};
if (SWEEP) {
  const FIELD_KEYS = { hr: ["hr"], spo2: ["spo2"], rr: ["rr"], pulse: ["pulse"], pvc: ["pvc"], temp: ["temp"], pressure: ["sbp", "dbp"], map: ["map"] };
  const TS = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95];
  for (const g of GROUPS) {
    const rows = prepared.filter((p) => p.group === g); if (!rows.length) continue;
    sweep[g] = {};
    for (const [tf, keys] of Object.entries(FIELD_KEYS)) {
      sweep[g][tf] = TS.map((t) => {
        let correct = 0, guesses = 0, review = 0;
        for (const p of rows) {
          const res = M.parseMonitor(p.obs, Object.assign({ px: p.px, imageSize: p.imageSize, twoScale: p.twoScale, thresholds: { [tf]: { conf: t } } }, PARSE_OPTS));
          const sc = scoreCase(p.gt, res);
          for (const k of keys) { const o = sc[k].outcome; if (o === "correct") correct++; else if (o === "wrong" || o === "silent-guess") guesses++; else if (o === "review" || o === "correct-review") review++; }
        }
        return { t, correct, guesses, review };
      });
    }
  }
}

writeFileSync(join(OUT, "results.json"), JSON.stringify({ generated: new Date().toISOString(), parser: M.VERSION, policy: POLICY, scales: SCALES, thresholds: M.THRESH, quality: M.QUALITY, groups: byGroup, regressions, sweep, cases: results }, null, 2));

/* ------------------------------------------------------------------ report */
const L = [];
L.push(`# ICU monitor extraction benchmark: parser v${M.VERSION}, policy ${POLICY}, ${SCALES}-scale Vision, digit verification: ${(PARSE_OPTS.verifyFields || M.VERIFY_FIELDS).join(",") || "none"}`, "");
L.push(`Generated ${new Date().toISOString()}. Local extraction only (Apple Vision on macOS + icu-monitor-parser.js). **Gemini calls: 0** (not part of this benchmark; the app's on-tap fallback is counted separately). Network calls: 0.`, "");
L.push("**Groups are reported separately and never pooled.** `real` = photographs as taken. `perturbed-real` = images derived from a real photograph (robustness, not new monitors). `synthetic` = rendered layouts (layout handling, not photographic accuracy). Unit-test fixtures are not included.", "");
L.push("## Acceptance", "");
const accepted = ACCEPTANCE_GROUPS.map((g) => byGroup[g]).filter(Boolean);
const totalGuesses = accepted.reduce((n, g) => n + g.silentGuesses, 0), totalIncomplete = Object.values(byGroup).reduce((n, g) => n + g.incompleteEvidence, 0);
L.push(`- Silent guesses (${ACCEPTANCE_GROUPS.filter((g) => byGroup[g]).join(", ")}): **${totalGuesses}**`, `- AUTO fields without complete evidence (all groups): **${totalIncomplete}**`);
if (byGroup["external-draft"]) L.push(`- external-draft (labels NOT yet human-confirmed): ${byGroup["external-draft"].silentGuesses} disagreement(s) with the draft label; check the label before counting any as a silent guess`);
for (const r of regressions) L.push(`- ${r.pass ? "PASS" : "**FAIL**"}: ${r.name} (${r.got})`);
L.push("");
for (const g of GROUPS) {
  const G = byGroup[g]; if (!G) continue;
  L.push(`## Group: ${g} (${G.cases} case${G.cases === 1 ? "" : "s"})`, "");
  L.push(`Silent guesses ${G.silentGuesses} · incomplete evidence ${G.incompleteEvidence} · RETAKE_PHOTO ${G.retake} · DEGRADED ${G.degraded} · avg Vision full ${G.avgOcrMsFull ?? "cached"} ms + crop ${G.avgOcrMsCrop ?? "-"} ms · parse ${G.avgParseMs} ms · boxes ${G.avgBoxesFull} (+${G.avgRecovered} from crop) · colour used in ${G.colourUsed}`, "");
  L.push("| field | visible | correct | wrong | review | missed | exact % | precision % | needs-review % | silent-guess % | safe % |", "|---|---|---|---|---|---|---|---|---|---|---|");
  const autoUnl = ALL.reduce((n, k) => n + G.overall[k].autoUnlabelled, 0);
  if (autoUnl) L.push(`AUTO on fields the dataset does not label (not scored): ${autoUnl}`, "");
  for (const k of ALL) { const m = G.overall[k]; if (!m.scored) continue; L.push(`| ${k} | ${m.visible} | ${m.correct} | ${m.wrong + m.silentGuess} | ${m.review + m.correctReview} | ${m.missed} | ${m.exactAccuracy ?? "-"} | ${m.precision ?? "-"} | ${m.needsReviewRate ?? "-"} | ${m.silentGuessRate ?? "-"} | ${m.safeAccuracy ?? "-"} |`); }
  if (g !== "real" && !g.startsWith("external")) {
    L.push("", `Per manufacturer (${g}; core fields exact % / safe %)`, "", "| manufacturer | cases | " + CORE.join(" | ") + " |", "|---|---|" + CORE.map(() => "---").join("|") + "|");
    for (const [k, v] of Object.entries(G.byManufacturer)) L.push(`| ${k} | ${v.cases} | ` + CORE.map((f) => `${v.m[f].exactAccuracy ?? "-"} / ${v.m[f].safeAccuracy ?? "-"}`).join(" | ") + " |");
  }
  L.push("");
  if (g === "perturbed-real") {
    L.push("| perturbation | quality | " + CORE.join(" | ") + " | pulse | art |", "|---|---|" + CORE.map(() => "---").join("|") + "|---|---|");
    for (const r of results.filter((x) => x.group === g)) {
      const cell = (f) => { const v = f.value == null ? (f.suggested != null ? "?" + (typeof f.suggested === "object" ? f.suggested.s + "/" + f.suggested.d : f.suggested) : "·") : (typeof f.value === "object" ? f.value.s + "/" + f.value.d + (f.value.map != null ? "(" + f.value.map + ")" : "") : f.value); return `${v} ${f.outcome === "correct" || f.outcome.startsWith("correct") ? "✓" : f.outcome === "review" ? "R" : f.outcome === "missed" ? "M" : "✗"}`; };
      L.push(`| ${r.id.replace("philips-mp40-", "")} | ${r.quality.status}${r.quality.issues.length ? " " + r.quality.issues.join(" ") : ""} | ` + CORE.map((k) => cell(r.fields[k])).join(" | ") + ` | ${cell(r.fields.pulse)} | ${cell(r.fields.art)} |`);
    }
    L.push("");
  }
}
if (SWEEP) {
  L.push("## Threshold sweep (confidence threshold per field; correct auto / silent guesses)", "");
  for (const g of GROUPS) {
    if (!sweep[g]) continue;
    L.push(`${g}:`, "", "| field | " + [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95].map((t) => t.toFixed(2)).join(" | ") + " | current |", "|---|" + "---|".repeat(9));
    for (const [tf, rowsT] of Object.entries(sweep[g])) L.push(`| ${tf} | ` + rowsT.map((x) => `${x.correct}/${x.guesses}`).join(" | ") + ` | ${M.THRESH[tf].conf} |`);
    L.push("");
  }
}
L.push("## Every non-correct outcome", "");
for (const r of results) {
  const bad = Object.entries(r.fields).filter(([, f]) => ["wrong", "silent-guess", "missed", "review"].includes(f.outcome));
  if (!bad.length) continue;
  L.push(`- **${r.id}** [${r.group}] (${r.manufacturer}, ${r.difficulty.join("+") || "clean"}, quality ${r.quality.status}): ` + bad.map(([k, f]) => `${k} ${f.outcome}` + (f.outcome === "review" || f.outcome === "missed" ? ` (exp ${JSON.stringify(f.expected)}${f.suggested != null ? ", sug " + JSON.stringify(f.suggested) : ""}${f.reason ? ": " + f.reason.slice(0, 110) : ""})` : ` (exp ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.value)})`)).join("; "));
}
writeFileSync(join(OUT, "report.md"), L.join("\n") + "\n");
console.log(L.slice(0, 12).join("\n"));
for (const g of GROUPS) if (byGroup[g]) { const m = byGroup[g].overall; console.log(`${g.padEnd(15)} cases ${String(byGroup[g].cases).padEnd(3)} ` + CORE.map((k) => `${k} ${m[k].exactAccuracy ?? "-"}%`).join("  ") + `  | guesses ${byGroup[g].silentGuesses} retake ${byGroup[g].retake}`); }
console.log(`\nreport: ${join(OUT, "report.md")}`);
if (totalGuesses || totalIncomplete || regressions.some((r) => !r.pass)) { console.error(`\nACCEPTANCE FAILED: guesses ${totalGuesses}, incomplete evidence ${totalIncomplete}, regressions failed ${regressions.filter((r) => !r.pass).length}`); process.exitCode = 1; }
