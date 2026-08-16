/* scripts/maik-answer-eval.mjs — LIVE answer-quality eval for MaiK (grades the actual model output).
 *
 * The decision-layer net (scripts/maik-eval.mjs) is offline + free; THIS one hits the real answer
 * endpoint so answer PROSE can't silently regress when you change model/prompt/KB. Token-gated so it
 * never runs (and never costs) without an explicit owner token.
 *
 *   MAIK_EVAL_TOKEN=<firebase id token>  \
 *   MAIK_EVAL_URL=https://stewardmd.in   \   (default)
 *   MAIK_APP_KEY=<APP_GATE_KEY>          \   (optional — sends X-SMD-App past the coming-soon gate)
 *   node scripts/maik-answer-eval.mjs
 *
 * Grading is a lightweight rubric (non-empty, not a refusal, contains expected clinical keywords).
 * Swap in an LLM-judge later for nuance; the rubric already catches empty/refused/off-topic answers.
 */
const TOKEN = process.env.MAIK_EVAL_TOKEN || "";
const BASE = (process.env.MAIK_EVAL_URL || "https://stewardmd.in").replace(/\/$/, "");
const APPKEY = process.env.MAIK_APP_KEY || "";
const THRESHOLD = Number(process.env.MAIK_EVAL_THRESHOLD || "0.8");

if (!TOKEN) { console.log("maik-answer-eval: skipped (set MAIK_EVAL_TOKEN to a Firebase owner ID token to run)."); process.exit(0); }

// [question, [expected keywords — ANY 1 counts as on-topic], [must-NOT-contain]]
const CASES = [
  ["Treatment of pulmonary tuberculosis", ["rifampicin", "isoniazid", "rhze", "atd", "2 months"], []],
  ["Management of DKA", ["fluid", "insulin", "potassium", "0.9"], []],
  ["Empirical antibiotics for community acquired pneumonia", ["amoxicillin", "macrolide", "ceftriaxone", "azithromycin"], []],
  ["Dose of adrenaline in anaphylaxis", ["0.5", "1:1000", "im", "intramuscular", "0.01"], []],
  ["Management of hyperkalemia", ["calcium gluconate", "insulin", "dextrose", "salbutamol"], []],
  ["Treatment of severe malaria", ["artesunate", "iv", "quinine"], []],
  ["Snake bite management", ["asv", "antivenom", "neostigmine", "20 minute"], []],
  ["OP poisoning treatment", ["atropine", "pralidoxime", "pam"], []],
  ["Correction of severe hyponatremia", ["3%", "hypertonic", "8", "12", "mmol", "osmotic"], []],
  ["Management of status epilepticus", ["lorazepam", "benzodiazepine", "phenytoin", "levetiracetam"], []],
];
const REFUSAL = /(for healthcare professionals|only medical|clinical questions|which did you mean)/i;

function extractAnswer(txt) {
  // SSE (data: {...}) → concat deltas; else JSON {answer|text|content}; else raw text.
  if (/^data:/m.test(txt)) {
    let out = "";
    for (const line of txt.split("\n")) {
      const m = line.match(/^data:\s*(.*)$/); if (!m) continue;
      try { const j = JSON.parse(m[1]); out += (j.delta || j.text || j.token || j.content || ""); } catch (e) { if (m[1] && m[1] !== "[DONE]") out += m[1]; }
    }
    if (out) return out;
  }
  try { const j = JSON.parse(txt); return j.answer || j.text || j.content || j.result || txt; } catch (e) {}
  return txt;
}

async function ask(q) {
  const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN };
  if (APPKEY) headers["X-SMD-App"] = APPKEY;
  const res = await fetch(BASE + "/api/ai/explain", { method: "POST", headers, body: JSON.stringify({ package: { question: q } }) });
  const txt = await res.text();
  return { status: res.status, answer: extractAnswer(txt) };
}

let pass = 0, rows = [];
for (const [q, kws, bans] of CASES) {
  let r; try { r = await ask(q); } catch (e) { rows.push(["ERR", q, e.message]); continue; }
  const a = String(r.answer || "").toLowerCase();
  const ok = r.status === 200 && a.length > 120 && !REFUSAL.test(a)
    && kws.some((k) => a.includes(k)) && !bans.some((b) => a.includes(b.toLowerCase()));
  if (ok) pass++;
  rows.push([ok ? "PASS" : "FAIL", q, `status=${r.status} len=${a.length}` + (ok ? "" : ` hit=[${kws.filter((k) => a.includes(k)).join(",")}]`)]);
}
rows.forEach((r) => console.log(`${r[0].padEnd(5)}| ${r[1]}  (${r[2]})`));
const rate = pass / CASES.length;
console.log(`\n${pass}/${CASES.length} passed (${(rate * 100).toFixed(0)}%) · threshold ${(THRESHOLD * 100).toFixed(0)}%`);
process.exit(rate >= THRESHOLD ? 0 : 1);
