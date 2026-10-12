#!/usr/bin/env node
/**
 * tools/prep-item-stats.mjs - Item statistics analysis, psychometric metrics, and coverage report (plan section 11).
 *
 * Computes per item from privacy-preserving aggregate telemetry:
 *   - p-value (difficulty): right / n
 *   - Point-biserial or discrimination index ONLY when n >= 100 (else "not enough data")
 *   - Distractor selection shares (o0..o3 / n)
 *   - Omission rate (blank / n)
 *   - Response time statistics (secs / n)
 *   - FLAGS items for review (e.g. wrong key suspect, high omission, abnormal response time, negative discrimination)
 *   - Writes flags to the quality sidecar as requires_review with history (never rewrites or removes automatically)
 *   - Coverage report by learning objective and blueprint (items per objective, blueprint weight vs actual)
 *
 * Usage:
 *   node tools/prep-item-stats.mjs --stats <file.json> [--cache <dir>] [--quality <dir>] [--write-flags] [--report <file.md>]
 *   node tools/prep-item-stats.mjs coverage [--cache <dir>] [--report <file.md>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSidecar, saveSubject, scanCache, QUALITY_VER } from "./prep-quality.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_N_DISCRIMINATION = 100;
export const MIN_N_FLAGS = 100;

export const LETTERS = ["A", "B", "C", "D"];

/* ---------- Item statistics calculation ---------- */

/**
 * analyzeItem(stat, meta):
 *   stat: { item_id, exam, n, right, blank, secs, o0, o1, o2, o3, wrong?, discrimination? }
 *   meta: { key: 0..3 or "A".."D", subject, module, options?, lo?, kp? }
 */
export function analyzeItem(stat, meta = {}) {
  const n = Number(stat.n || stat.sample_size || stat.exposures || 0);
  const right = Number(stat.right || stat.correct || 0);
  const blank = Number(stat.blank || stat.omitted || 0);
  const wrong = stat.wrong != null ? Number(stat.wrong) : Math.max(0, n - right - blank);
  const secs = Number(stat.secs || stat.sum_seconds || 0);
  const o = [
    Number(stat.o0 || (stat.options && stat.options[0]) || 0),
    Number(stat.o1 || (stat.options && stat.options[1]) || 0),
    Number(stat.o2 || (stat.options && stat.options[2]) || 0),
    Number(stat.o3 || (stat.options && stat.options[3]) || 0)
  ];

  const pValue = n > 0 ? Math.round((right / n) * 1000) / 1000 : null;
  const omissionRate = n > 0 ? Math.round((blank / n) * 1000) / 1000 : null;
  const avgSecs = n > 0 ? Math.round((secs / n) * 10) / 10 : null;

  const distractorShares = o.map((cnt) => (n > 0 ? Math.round((cnt / n) * 1000) / 1000 : 0));

  // Determine difficulty label
  let difficultyInterpretation = "not enough data";
  if (n >= MIN_N_FLAGS && pValue !== null) {
    if (pValue >= 0.8) difficultyInterpretation = "Easy";
    else if (pValue >= 0.5) difficultyInterpretation = "Medium";
    else if (pValue >= 0.25) difficultyInterpretation = "Hard";
    else difficultyInterpretation = "Very hard";
  }

  // Discrimination index or point-biserial: ONLY when n >= 100
  let discrimination = null;
  let discriminationStatus = "not enough data";
  if (n >= MIN_N_DISCRIMINATION) {
    if (stat.discrimination != null) {
      discrimination = Number(stat.discrimination);
      discriminationStatus = "computed";
    } else if (stat.upper_right != null && stat.lower_right != null) {
      const upperN = Number(stat.upper_n || n / 2);
      const lowerN = Number(stat.lower_n || n / 2);
      discrimination = Math.round(((stat.upper_right / upperN) - (stat.lower_right / lowerN)) * 1000) / 1000;
      discriminationStatus = "computed";
    } else {
      discriminationStatus = "not available (ability distribution required)";
    }
  }

  // Key normalization: 0..3 index
  let keyIdx = null;
  if (typeof meta.key === "number" && meta.key >= 0 && meta.key <= 3) keyIdx = meta.key;
  else if (typeof meta.a === "number" && meta.a >= 0 && meta.a <= 3) keyIdx = meta.a;
  else if (typeof meta.key === "string") {
    const uc = meta.key.trim().toUpperCase();
    const idx = LETTERS.indexOf(uc);
    if (idx >= 0) keyIdx = idx;
  }

  // Evaluate flags (strictly when n >= MIN_N_FLAGS)
  const flags = [];
  if (n >= MIN_N_FLAGS) {
    // 1. Wrong-key suspect: most chosen option differs from key with high share (>= 40% or exceeds key)
    if (keyIdx !== null) {
      let maxCnt = -1, maxIdx = -1;
      for (let i = 0; i < 4; i++) {
        if (o[i] > maxCnt) { maxCnt = o[i]; maxIdx = i; }
      }
      if (maxIdx !== -1 && maxIdx !== keyIdx) {
        const maxShare = distractorShares[maxIdx];
        const keyShare = distractorShares[keyIdx];
        if (maxShare >= 0.40 || maxShare > keyShare) {
          const maxLet = LETTERS[maxIdx] || String(maxIdx);
          const keyLet = LETTERS[keyIdx] || String(keyIdx);
          flags.push({
            type: "wrong_key_suspect",
            reason: `statistically suspect key: option ${maxLet} chosen by ${Math.round(maxShare * 100)}% vs key ${keyLet} (${Math.round(keyShare * 100)}%) with n=${n}`
          });
        }
      }
    }

    // 2. High omission rate: >= 25% omitted
    if (omissionRate !== null && omissionRate >= 0.25) {
      flags.push({
        type: "high_omission",
        reason: `high omission rate: ${Math.round(omissionRate * 100)}% omitted with n=${n}`
      });
    }

    // 3. Abnormal response time: < 5s (too fast) or > 120s (too slow)
    if (avgSecs !== null) {
      if (avgSecs < 5.0) {
        flags.push({
          type: "abnormal_time_fast",
          reason: `abnormally fast average response time: ${avgSecs}s (<5s) with n=${n}`
        });
      } else if (avgSecs > 120.0) {
        flags.push({
          type: "abnormal_time_slow",
          reason: `abnormally slow average response time: ${avgSecs}s (>120s) with n=${n}`
        });
      }
    }

    // 4. Negative discrimination
    if (discrimination !== null && discrimination < 0) {
      flags.push({
        type: "negative_discrimination",
        reason: `negative discrimination index (${discrimination}) with n=${n}`
      });
    }
  }

  return {
    item_id: String(stat.item_id || ""),
    n,
    right,
    wrong,
    blank,
    secs,
    options: o,
    distractor_shares: distractorShares,
    p_value: pValue,
    difficulty: difficultyInterpretation,
    omission_rate: omissionRate,
    avg_secs: avgSecs,
    discrimination,
    discrimination_status: discriminationStatus,
    key_index: keyIdx,
    flags
  };
}

/* ---------- Quality Sidecar Writer for Flags ---------- */

/**
 * applyStatsFlags(loadedQuality, analysisList, { at = now }):
 *   Appends flagged history entries and sets requires_review in the sidecar.
 *   Never rewrites or removes items automatically.
 */
export function applyStatsFlags(loadedQuality, analysisList, { at = new Date().toISOString() } = {}) {
  let flaggedCount = 0;
  let entriesCount = 0;

  for (const item of analysisList) {
    if (!item.flags || !item.flags.length) continue;
    const id = item.item_id;
    let hit = loadedQuality.ids.get(id);
    if (!hit) {
      // Create new record under "review" subject
      const rec = {
        item_id: id,
        bank: "unknown",
        bank_version: "unknown",
        status: "requires_review",
        status_changed_at: at,
        history: [{
          at,
          by: "prep-quality",
          action: "created",
          reason: "record created from item telemetry flags",
          source: "item statistics"
        }]
      };
      const subj = "review";
      if (!loadedQuality.files.has(subj)) {
        loadedQuality.files.set(subj, { v: 1, subject: subj, quality_version: QUALITY_VER, generated_at: at, records: [] });
      }
      loadedQuality.files.get(subj).records.push(rec);
      loadedQuality.ids.set(id, { subj, rec });
      hit = { subj, rec };
    }

    for (const f of item.flags) {
      const dup = hit.rec.history.some((h) => h.action === "flagged" && h.by === "prep-item-stats" && h.reason === f.reason);
      if (!dup) {
        hit.rec.history.push({
          at,
          by: "prep-item-stats",
          action: "flagged",
          reason: f.reason,
          source: "item statistics"
        });
        entriesCount++;
      }
    }

    // Set requires_review unless already retired or rejected
    if (hit.rec.status !== "retired" && hit.rec.status !== "rejected") {
      hit.rec.status = "requires_review";
      hit.rec.status_changed_at = at;
    }
    flaggedCount++;
  }

  return { flagged_items: flaggedCount, entries_added: entriesCount };
}

/* ---------- Coverage Report by Learning Objective & Blueprint ---------- */

/**
 * computeCoverage(profiles, bankCache):
 *   Computes coverage by exam blueprint and learning objective.
 */
export function computeCoverage(profiles = {}, bankItems = []) {
  // Aggregate bank by subject and module/objective
  const bankBySubject = {};
  const bankByModule = {};
  const objectivesBySubject = {};

  for (const it of bankItems) {
    const subj = it.subject || it._s || "unmapped";
    const mod = it.module || it._m || it.t || "unmapped";
    const lo = it.lo || it.kp || mod;

    bankBySubject[subj] = (bankBySubject[subj] || 0) + 1;
    bankByModule[mod] = (bankByModule[mod] || 0) + 1;

    if (!objectivesBySubject[subj]) objectivesBySubject[subj] = new Set();
    objectivesBySubject[subj].add(lo);
  }

  // Calculate blueprint coverage per exam
  const examCoverage = {};
  for (const [examId, p] of Object.entries(profiles)) {
    const bp = p.blueprint || {};
    const subMap = bp.subjects || {};
    const totalTarget = p.format ? p.format.questions : Object.values(subMap).reduce((a, b) => a + b, 0);

    const subjectRows = [];
    let totalBank = 0;
    let totalTargetMet = 0;

    for (const [subj, target] of Object.entries(subMap)) {
      const actual = bankBySubject[subj] || 0;
      totalBank += actual;
      totalTargetMet += Math.min(target, actual);
      subjectRows.push({
        subject: subj,
        target_questions: target,
        actual_questions: actual,
        coverage_ratio: target > 0 ? Math.round((actual / target) * 100) / 100 : null,
        shortfall: Math.max(0, target - actual),
        objectives_count: objectivesBySubject[subj] ? objectivesBySubject[subj].size : 0
      });
    }

    examCoverage[examId] = {
      exam_name: p.name || examId,
      format_questions: totalTarget,
      total_target: Object.values(subMap).reduce((a, b) => a + b, 0),
      total_available: totalBank,
      blueprint_kind: bp.kind || "none",
      overall_coverage: totalTarget > 0 ? Math.round((totalTargetMet / totalTarget) * 100) / 100 : 0,
      subjects: subjectRows
    };
  }

  return {
    exams: examCoverage,
    total_bank_items: bankItems.length,
    total_modules: Object.keys(bankByModule).length,
    viable_modules: Object.values(bankByModule).filter((c) => c >= 10).length
  };
}

/**
 * generateReportMarkdown(coverage, statsAnalysis = []):
 *   Generates the published documentation and report markdown.
 */
export function generateReportMarkdown(coverage, statsAnalysis = []) {
  const at = new Date().toISOString();
  let md = `# PrepNucleus Item Statistics & Blueprint Coverage Report\n\n`;
  md += `Published: ${at.slice(0, 10)} | Quality Version: ${QUALITY_VER}\n\n`;
  md += `## 1. Metric Definitions & Sample Size Rules (Plan Section 11)\n\n`;
  md += `| Metric | Definition | Interpretation Threshold |\n`;
  md += `|---|---|---|\n`;
  md += `| **Sample Size ($n$)** | Total recorded response exposures for the item | Baseline denominator |\n`;
  md += `| **Difficulty ($p$-value)** | Proportion of correct responses: $p = \\text{right} / n$ | Interpreted only when $n \\ge 100$: $\\ge 0.8$ Easy, $0.5\\text{-}0.8$ Medium, $0.25\\text{-}0.5$ Hard, $<0.25$ Very hard |\n`;
  md += `| **Discrimination ($D$ / $r_{pbis}$)** | Ability to distinguish high from low performers: $D = p_{\\text{upper}} - p_{\\text{lower}}$ | Interpreted ONLY when $n \\ge 100$; below 100 published as "not enough data" |\n`;
  md += `| **Distractor Share** | Proportion choosing each option: $o_k / n$ for $k \\in \\{0, 1, 2, 3\\}$ | Used to audit plausibility of options |\n`;
  md += `| **Omission Rate** | Proportion leaving unanswered: $\\text{blank} / n$ | Flagged for review if $\\ge 25\\%$ and $n \\ge 100$ |\n`;
  md += `| **Average Response Time** | Mean completion time in seconds: $\\text{secs} / n$ | Flagged if $<5\\text{s}$ (guessing) or $>120\\text{s}$ (confusing) with $n \\ge 100$ |\n`;
  md += `| **Review Flags** | Statistical thresholds that mark an item \`requires_review\` | Never used to automatically rewrite or remove an item |\n\n`;

  md += `## 2. Statistical Review Flags Summary\n\n`;
  const flagged = statsAnalysis.filter((x) => x.flags && x.flags.length);
  md += `- **Analyzed Items**: ${statsAnalysis.length}\n`;
  md += `- **Items with $n \\ge 100$**: ${statsAnalysis.filter((x) => x.n >= MIN_N_FLAGS).length}\n`;
  md += `- **Flagged Items for Owner Review**: ${flagged.length}\n\n`;

  if (flagged.length) {
    md += `| Item ID | $n$ | $p$-value | Omission | Avg Time | Flag Reason |\n`;
    md += `|---|---|---|---|---|---|\n`;
    for (const f of flagged.slice(0, 50)) {
      md += `| \`${f.item_id}\` | ${f.n} | ${f.p_value ?? "-"} | ${f.omission_rate ? Math.round(f.omission_rate * 100) + "%" : "0%"} | ${f.avg_secs ?? "-"}s | ${f.flags.map((x) => x.reason).join("; ")} |\n`;
    }
    if (flagged.length > 50) md += `| ... | ... | ... | ... | ... | *and ${flagged.length - 50} more items* |\n`;
    md += `\n`;
  }

  md += `## 3. Blueprint & Learning Objective Coverage\n\n`;
  md += `- **Total Live Bank Questions**: ${coverage.total_bank_items}\n`;
  md += `- **Total Covered Modules/Objectives**: ${coverage.total_modules}\n`;
  md += `- **Viable Modules ($\\ge 10$ items)**: ${coverage.viable_modules}\n\n`;

  for (const [examId, e] of Object.entries(coverage.exams)) {
    md += `### ${e.exam_name} (\`${examId}\`)\n\n`;
    md += `- Blueprint Kind: \`${e.blueprint_kind}\` | Format: ${e.format_questions} questions | Overall Met: ${Math.round(e.overall_coverage * 100)}%\n\n`;
    md += `| Subject | Blueprint Target | Bank Available | Coverage | Shortfall | Learning Objectives |\n`;
    md += `|---|---|---|---|---|---|\n`;
    for (const s of e.subjects) {
      md += `| ${s.subject} | ${s.target_questions} | ${s.actual_questions} | ${s.coverage_ratio != null ? Math.round(s.coverage_ratio * 100) + "%" : "-"} | ${s.shortfall} | ${s.objectives_count} |\n`;
    }
    md += `\n`;
  }

  return md;
}

/* ---------- CLI Runner ---------- */

async function main(argv = process.argv.slice(2)) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const cmd = argv[0];

  const statsFile = arg("--stats", null);
  const qualityDir = path.resolve(arg("--quality", path.join(os.homedir(), "prep-data/quality/out")));
  const reportFile = arg("--report", path.join(ROOT, "docs/prep-item-stats.md"));

  // Load stats data
  let statsList = [];
  if (statsFile && fs.existsSync(statsFile)) {
    const raw = JSON.parse(fs.readFileSync(statsFile, "utf8"));
    statsList = Array.isArray(raw) ? raw : raw.items || [raw];
  }

  // Load profiles from prep/assess/profiles
  const profilesDir = path.join(ROOT, "prep/assess/profiles");
  const profiles = {};
  if (fs.existsSync(profilesDir)) {
    for (const f of fs.readdirSync(profilesDir)) {
      if (f.endsWith(".json")) {
        try {
          const p = JSON.parse(fs.readFileSync(path.join(profilesDir, f), "utf8"));
          if (p.id) profiles[p.id] = p;
        } catch (e) {}
      }
    }
  }

  // Run analysis
  const analyzed = statsList.map((st) => analyzeItem(st, { key: st.key != null ? st.key : st.a }));
  const flagged = analyzed.filter((x) => x.flags && x.flags.length);

  console.log(`prep-item-stats: analyzed ${analyzed.length} item records`);
  console.log(`  n >= 100: ${analyzed.filter((x) => x.n >= MIN_N_FLAGS).length}`);
  console.log(`  flagged for review: ${flagged.length}`);

  if (argv.includes("--write-flags") && flagged.length > 0) {
    if (fs.existsSync(path.join(qualityDir, "index.json"))) {
      const loaded = loadSidecar(qualityDir);
      const res = applyStatsFlags(loaded, analyzed);
      for (const [subj, file] of loaded.files) {
        saveSubject(qualityDir, subj, file);
      }
      console.log(`  write-flags: updated quality sidecar in ${qualityDir} (${res.flagged_items} items flagged, ${res.entries_added} entries)`);
    } else {
      console.warn(`  write-flags: quality directory ${qualityDir} index.json not found, skipping sidecar update`);
    }
  }

  const cacheDir = path.resolve(arg("--cache", path.join(os.homedir(), "prep-data/ids/cache")));
  let bankItems = [];
  if (fs.existsSync(cacheDir) && (fs.existsSync(path.join(cacheDir, "stamps.json")) || fs.existsSync(path.join(cacheDir, "pyq-index.json")))) {
    try {
      const { byId } = scanCache(cacheDir, ROOT);
      for (const [id, loc] of byId) {
        bankItems.push({ id, subject: loc.subject, module: loc.module });
      }
    } catch (e) {}
  }

  const coverage = computeCoverage(profiles, bankItems);
  const md = generateReportMarkdown(coverage, analyzed);

  if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, md, "utf8");
    console.log(`  report written to ${reportFile}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
