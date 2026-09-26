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
 * --cases test/maik-eval/live-cases.json runs the 60-case answer-quality set instead (2026-09-26): each
 * case lists its key points as concept regexes, scored as checks.keyPoints (a concept check, NOT a
 * clinician's grade; every case there is certified:false until reviewed).
 *
 * --latency: a cheap DAILY signal, separate from the WEEKLY gold-set run above. Sends 5 short fixed
 * questions to the streaming endpoint (?stream=1) and times total ms + time-to-first-byte off the wire;
 * output tokens are estimated from response length (the reliable-replay stream path carries no
 * usageMetadata). No grading sheet — this measures speed, not correctness.
 *   MAIK_EVAL_TOKEN=<firebase id token> node scripts/maik-quality-run.mjs --latency
 * Output: docs/maik-eval/latency-<date>.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://stewardmd.in"), N = Number(arg("--n", "0")) || 0, OFFLINE = arg("--offline", "");
const CASES_FILE = arg("--cases", "test/maik-eval/cases.json");
const TOKEN = process.env.MAIK_EVAL_TOKEN || "";

export function checks(c, text) {
  const t = String(text || ""), low = t.toLowerCase();
  const topic = String(c.expectedTopic || c.topic || "").toLowerCase();
  const out = {
    answered: t.trim().length > 80,
    onTopic: !topic || topic.split(/\s+/).filter((w) => w.length > 3).some((w) => low.includes(w)),
    notRefusal: !/i can only help with medical|unable to (answer|help)|not (able|allowed) to/i.test(t),
    noObject: !/\[object Object\]/.test(t),
    noProvider: !/\b(gemini|vertex|openai|google ai)\b/i.test(t),
  };
  // live-cases.json: every key point present. A decline/hedge case is scored on its refusal or hedge,
  // so "answered at length", "on topic" and "not a refusal" do not apply to it.
  if (c.requiredElements) out.keyPoints = c.requiredElements.every((e) => new RegExp(e.re, "i").test(t));
  if ((c.tags || []).includes("decline-hedge")) { delete out.answered; delete out.onTopic; delete out.notRefusal; }
  return out;
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
export const pct = (xs, p) => { if (!xs.length) return null; const s = xs.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// ── --latency: cheap daily synthetic check (separate from the weekly gold-set run above) ──────────
export const LATENCY_QUESTIONS = [
  "What is the first-line treatment for uncomplicated cystitis in adults?",
  "What is the maximum daily dose of paracetamol (acetaminophen) in adults?",
  "What are the diagnostic criteria for type 2 diabetes mellitus?",
  "What is the reversal agent for warfarin-associated major bleeding?",
  "What is the target INR range for atrial fibrillation on warfarin?",
];
// No usageMetadata on the reliable-replay stream path (MAIK_LIVE_STREAM off in prod) - estimate.
export const estOutTokens = (text) => Math.ceil(String(text || "").length / 4);

// opts lets tests inject base/token/fetch without touching env or the network.
export async function runOneLatency(q, opts = {}) {
  const base = opts.base || BASE, token = opts.token || TOKEN, fetchFn = opts.fetch || fetch;
  const t0 = Date.now();
  let ttfbMs = null, text = "", err = "";
  try {
    const r = await fetchFn(base + "/api/ai/explain?stream=1", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, Origin: base, Accept: "text/event-stream" },
      body: JSON.stringify({ package: { question: q, grounding: [] }, depth: "concise" }) });
    if (!r.ok || !r.body) { err = "HTTP " + (r && r.status); } else {
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (ttfbMs === null) ttfbMs = Date.now() - t0;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try { const evt = JSON.parse(line.slice(6)); if (evt.delta) text += evt.delta; } catch (e) {}
        }
      }
    }
  } catch (e) { err = String((e && e.message) || e); }
  return { question: q, totalMs: Date.now() - t0, ttfbMs, outTokens: estOutTokens(text), error: err };
}
export function latencySummary(rows, base) {
  const ok = rows.filter((r) => !r.error);
  const totals = ok.map((r) => r.totalMs), ttfbs = ok.filter((r) => r.ttfbMs != null).map((r) => r.ttfbMs), outToks = ok.map((r) => r.outTokens);
  return { when: new Date().toISOString(), base, mode: "latency", cases: rows.length, errors: rows.length - ok.length,
    totalMsP50: pct(totals, 0.5), totalMsP95: pct(totals, 0.95), ttfbMsP50: pct(ttfbs, 0.5), ttfbMsP95: pct(ttfbs, 0.95),
    outTokensP50: pct(outToks, 0.5), outTokensP95: pct(outToks, 0.95) };
}
async function runLatency() {
  if (!TOKEN) { console.log("MAIK_EVAL_TOKEN not set: nothing sent (latency check skipped)."); return; }
  const rows = [];
  for (const q of LATENCY_QUESTIONS) {
    const row = await runOneLatency(q);
    rows.push(row);
    console.log(`${row.error || "ok"} total=${row.totalMs} ms ttfb=${row.ttfbMs} ms outTok~${row.outTokens}`);
  }
  const summary = latencySummary(rows, BASE);
  const stamp = summary.when.slice(0, 10), dir = join(ROOT, "docs/maik-eval"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `latency-${stamp}.json`), JSON.stringify({ summary, rows }, null, 1));
  console.log("\n" + JSON.stringify(summary));
}

async function main() {
  if (!TOKEN) { console.log("MAIK_EVAL_TOKEN not set: nothing sent (this run costs tokens, so it never runs unattended)."); return; }
  const all = JSON.parse(readFileSync(join(ROOT, CASES_FILE), "utf8"));
  // Key-point cases all run; the routing set keeps its reviewer/synthesis filter. A follow-up case
  // (priorTurns) needs its earlier turn, which this single-shot run does not send: run-live-eval.mjs has it.
  const cases = (Array.isArray(all) ? all : all.cases || [])
    .filter((c) => !c.priorTurns && (c.requiredElements || c.reviewerRequired || c.expectedAction === "retrieve_synthesis")).slice(0, N || undefined);
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
if (process.argv[1] && process.argv[1].endsWith("maik-quality-run.mjs")) {
  if (process.argv.includes("--latency")) runLatency(); else main();
}
