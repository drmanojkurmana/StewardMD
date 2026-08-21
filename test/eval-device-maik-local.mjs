/* eval-device-maik-local.mjs — score the on-device model on a fixed clinical set, on a REAL phone.
 *
 * Why this exists: every quality judgement in this branch so far came from one or two questions,
 * which is not enough to pick a model or a quant. This runs a fixed set through whichever pack is
 * installed and scores each answer MECHANICALLY, so Q4 vs Q5 vs Gemma-4-E2B is a number rather than
 * an impression.
 *
 * What it can and cannot do: it checks for expected drug/number tokens, for known-wrong tokens, and
 * for degeneration. It does NOT judge clinical nuance - a human still reads the transcript. Treat the
 * score as a regression signal, not a safety verdict.
 *
 * USAGE (device attached, model installed, bridge forwarded):
 *   node test/eval-device-maik-local.mjs [packId]
 */
import { writeFileSync } from "node:fs";

// Collect every line and writeFileSync it at the end. console.log alone is NOT enough: this script
// ends with process.exit(), which truncates buffered stdout when it is redirected to a file - the
// first two runs of this eval silently produced only the header line for exactly that reason.
const LINES = [];
const REPORT = process.env.EVAL_REPORT || "/tmp/maik-eval-report.txt";
function say(s) { LINES.push(s); console.log(s); }
function flush() { try { writeFileSync(REPORT, LINES.join("\n") + "\n"); } catch (e) {} }

const PORT = process.env.CDP_PORT || 9333;
const PACK = process.argv[2] || null;

/* Fixed set. `expect` = tokens a correct answer should contain (any of each inner array).
 * `reject` = tokens that indicate a known failure mode. Kept deliberately small and mechanical. */
const CASES = [
  { q: "first-line treatment of diabetic ketoacidosis in an adult",
    expect: [["saline", "sodium chloride", "nacl", "fluid"], ["insulin"], ["potassium", "electrolyte"]],
    reject: [] },
  { q: "dose of IV magnesium sulphate in severe asthma in an adult",
    expect: [["2 g", "2g", "2 gram"]], reject: ["mg/kg"] },
  { q: "empiric antibiotic for pyogenic liver abscess in an adult",
    expect: [["ceftriaxone", "piperacillin", "cefotaxime", "carbapenem"], ["metronidazole"]],
    reject: ["amoebic", "amebic"] },
  { q: "first-line antibiotic for severe community-acquired pneumonia needing ICU",
    expect: [["ceftriaxone", "cefotaxime", "piperacillin", "beta-lactam"],
             ["azithromycin", "macrolide", "clarithromycin", "levofloxacin", "moxifloxacin", "fluoroquinolone"]],
    reject: [] },
  { q: "management of anaphylaxis in an adult",
    expect: [["adrenaline", "epinephrine"], ["intramuscular", " im ", "0.5 mg", "0.5mg"]], reject: [] },
  { q: "first-line treatment of status epilepticus in an adult",
    expect: [["lorazepam", "midazolam", "diazepam", "benzodiazepine"]], reject: [] },
  { q: "empiric antibiotic for acute bacterial meningitis in an adult",
    expect: [["ceftriaxone", "cefotaxime"], ["vancomycin", "dexamethasone", "ampicillin"]], reject: [] },
  { q: "target INR range for a patient on warfarin with atrial fibrillation",
    expect: [["2.0", "2-3", "2 to 3", "2.5"]], reject: [] },
  { q: "initial management of an adult with suspected sepsis",
    expect: [["lactate", "culture", "fluid", "antibiotic"]], reject: [] },
  { q: "treatment of severe hyperkalaemia in an adult",
    expect: [["calcium", "insulin", "dextrose", "glucose"]], reject: [] }
];

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
if (!page) { console.log("no debuggable page - is the app running and the port forwarded?"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const call = (method, params) => { const i = id++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }); };

async function ev(expr, timeoutMs = 300000) {
  const p = call("Runtime.evaluate", {
    expression: `(async function(){try{${expr}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise: true
  });
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ __to: 1 }), timeoutMs))]);
  if (r.__to) return { __timeout: true };
  if (!r.result || !r.result.result) return { __bad: 1 };
  try { return JSON.parse(r.result.result.value); } catch { return { __raw: r.result.result.value }; }
}

const setup = await ev(`
  localStorage.setItem("smd_maik_local_bypass","1");
  ${PACK ? `SMD_MAIK_MODELS.setActivePack(${JSON.stringify(PACK)});` : ""}
  var pack = SMD_MAIK_MODELS.activePack();
  var L = Capacitor.Plugins.Llama;
  var path = await SMD_MAIK_MODELS.pathFor(pack);
  await L.load({ path: path, nCtx: 4096 });
  return JSON.stringify({ pack: pack, label: SMD_MAIK_MODELS.PACKS[pack].label, path: path,
                          sizeGB: (SMD_MAIK_MODELS.totalBytes(pack)/1e9).toFixed(2) });
`);
if (setup.__err || setup.__timeout) { say("setup failed: " + JSON.stringify(setup)); flush(); process.exit(1); }
say(`model: ${setup.label}  (${setup.sizeGB} GB)\n`);

let score = 0, prefills = [], totals = [];
const rows = [];
for (const c of CASES) {
  const out = await ev(`
    var L = Capacitor.Plugins.Llama;
    var t0 = Date.now();
    var g = await L.generate({ prompt: ${JSON.stringify(c.q)}, system: SMD_MAIK_LOCAL.SYSTEM,
                               nPredict: 200, temperature: 0, stream: false });
    return JSON.stringify({ text: g.text || "", prefillMs: g.prefillMs, totalMs: Date.now()-t0, promptTok: g.promptTokens });
  `);
  if (out.__timeout || out.__err) { say(`TIMEOUT/ERR  ${c.q.slice(0, 46)}  ${JSON.stringify(out).slice(0,80)}`); rows.push({ q: c.q, pass: false }); flush(); continue; }
  const t = (out.text || "").toLowerCase();
  const words = t.match(/[a-z]+/g) || [];
  const distinct = words.length ? new Set(words).size / words.length : 0;

  const missing = c.expect.filter((alts) => !alts.some((a) => t.includes(a)));
  const hitReject = (c.reject || []).filter((r) => t.includes(r));
  const degenerate = words.length > 25 && distinct < 0.45;
  const pass = missing.length === 0 && hitReject.length === 0 && !degenerate;
  if (pass) score++;
  prefills.push(out.prefillMs); totals.push(out.totalMs);
  rows.push({ q: c.q, pass, missing: missing.map((m) => m[0]), hitReject, degenerate, distinct, text: out.text, ms: out.totalMs });

  say(`${pass ? "PASS" : "FAIL"}  ${String(Math.round(out.totalMs / 1000)).padStart(3)}s  ${c.q.slice(0, 52)}`);
  if (!pass) {
    if (missing.length) say(`        missing: ${missing.map((m) => m[0]).join(", ")}`);
    if (hitReject.length) say(`        wrong-token: ${hitReject.join(", ")}`);
    if (degenerate) say(`        DEGENERATE (${Math.round(distinct * 100)}% distinct words)`);
  }
  flush();
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
say(`\n${setup.label}: ${score}/${CASES.length} passed`);
say(`median prefill ${med(prefills)}ms | median total ${med(totals)}ms`);
say(`\nTranscripts are for a human to read - this score is a regression signal, not a safety verdict.`);
for (const r of rows.filter((x) => !x.pass && x.text)) {
  say(`\n--- ${r.q}\n${String(r.text).trim().slice(0, 400)}`);
}
flush();
ws.close();
process.exit(0);
