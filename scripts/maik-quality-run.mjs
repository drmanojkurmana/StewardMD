#!/usr/bin/env node
/* MaiK quality run (audit T19, 2026-09-25): the measurement the audit found missing.
 *
 * Runs the MaiK eval cases (test/maik-eval/cases.json) against the LIVE /api/ai/explain endpoint and
 * records, per case: the answer, total time, and the objective checks a script can make honestly
 * (answered, on the expected topic, not a refusal, no "[object Object]", no provider name). It then
 * writes a grading sheet so a clinician can mark each answer correct / incomplete / unsafe: factual
 * accuracy needs a clinician, and this script does not pretend otherwise.
 *
 * Costs real tokens, so it is NOT part of CI. Needs a signed-in token:
 *   MAIK_EVAL_TOKEN=<firebase id token> node scripts/maik-quality-run.mjs [--n 10] [--base https://stewardmd.in]
 * Offline parity: after running the same cases on a phone, pass --offline <answers.json> ({id: text}) to
 * compare drug names and dose numbers between the two engines.
 * Output: docs/maik-eval/run-<date>.json and docs/maik-eval/run-<date>-grading.md
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://stewardmd.in"), N = Number(arg("--n", "0")) || 0, OFFLINE = arg("--offline", "");
const TOKEN = process.env.MAIK_EVAL_TOKEN || "";

export function checks(c, text) {
  const t = String(text || ""), low = t.toLowerCase();
  const topic = String(c.expectedTopic || "").toLowerCase();
  return {
    answered: t.trim().length > 80,
    onTopic: !topic || topic.split(/\s+/).filter((w) => w.length > 3).some((w) => low.includes(w)),
    notRefusal: !/i can only help with medical|unable to (answer|help)|not (able|allowed) to/i.test(t),
    noObject: !/\[object Object\]/.test(t),
    noProvider: !/\b(gemini|vertex|openai|google ai)\b/i.test(t),
  };
}
// Drug-like tokens and dose numbers, for comparing the cloud and offline answers to the same question.
export function claimsOf(text) {
  const t = String(text || "").toLowerCase();
  const doses = (t.match(/\d+(?:\.\d+)?\s?(?:mg|mcg|g|units?|ml|mg\/kg)\b/g) || []).map((s) => s.replace(/\s/g, ""));
  const drugs = (t.match(/\b[a-z]{2,}(?:cillin|mycin|cycline|azole|oxacin|pril|sartan|statin|olol|dipine|parin|prazole|vir|mab|nib|one|ide|ine|ate)\b/g) || []);
  return { doses: [...new Set(doses)].sort(), drugs: [...new Set(drugs)].sort() };
}
export function parity(cloud, offline) {
  const a = claimsOf(cloud), b = claimsOf(offline);
  const onlyCloud = a.doses.filter((d) => !b.doses.includes(d)), onlyOffline = b.doses.filter((d) => !a.doses.includes(d));
  return { sharedDrugs: a.drugs.filter((d) => b.drugs.includes(d)), onlyCloudDoses: onlyCloud, onlyOfflineDoses: onlyOffline };
}
const pct = (xs, p) => { if (!xs.length) return null; const s = xs.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function main() {
  if (!TOKEN) { console.log("MAIK_EVAL_TOKEN not set: nothing sent (this run costs tokens, so it never runs unattended)."); return; }
  const all = JSON.parse(readFileSync(join(ROOT, "test/maik-eval/cases.json"), "utf8"));
  const cases = (Array.isArray(all) ? all : all.cases || []).filter((c) => c.reviewerRequired || c.expectedAction === "retrieve_synthesis").slice(0, N || undefined);
  const off = OFFLINE ? JSON.parse(readFileSync(OFFLINE, "utf8")) : null;
  const rows = [];
  for (const c of cases) {
    const t0 = Date.now(); let text = "", err = "";
    try {
      const r = await fetch(BASE + "/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN, Origin: BASE },
        body: JSON.stringify({ package: { question: c.message, grounding: [] }, depth: "concise" }) });
      const j = await r.json().catch(() => ({})); text = j.text || ""; err = r.ok ? (j.error || "") : ("HTTP " + r.status);
    } catch (e) { err = String(e && e.message || e); }
    const row = { id: c.id, question: c.message, ms: Date.now() - t0, error: err, text, checks: checks(c, text) };
    if (off && off[c.id]) row.parity = parity(text, off[c.id]);
    rows.push(row); console.log(`${c.id} ${row.ms} ms ${err || Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => "FAIL:" + k).join(" ") || "ok"}`);
  }
  const ms = rows.filter((r) => !r.error).map((r) => r.ms);
  const passAll = rows.filter((r) => !r.error && Object.values(r.checks).every(Boolean)).length;
  const summary = { when: new Date().toISOString(), base: BASE, cases: rows.length, errors: rows.filter((r) => r.error).length, objectivePass: passAll, p50ms: pct(ms, 0.5), p95ms: pct(ms, 0.95) };
  const stamp = summary.when.slice(0, 10), dir = join(ROOT, "docs/maik-eval"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `run-${stamp}.json`), JSON.stringify({ summary, rows }, null, 1));
  writeFileSync(join(dir, `run-${stamp}-grading.md`), `# MaiK grading sheet ${stamp}\n\nMark each answer: correct / incomplete / unsafe, and note any wrong drug or dose.\n\n` +
    rows.map((r) => `## ${r.id}: ${r.question}\n\n${r.error ? "_error: " + r.error + "_" : r.text}\n\n**Grade:** \n**Notes:** \n`).join("\n"));
  console.log("\n" + JSON.stringify(summary));
}
if (process.argv[1] && process.argv[1].endsWith("maik-quality-run.mjs")) main();
