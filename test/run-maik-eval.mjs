/* MaiK full-answer EVAL (real headless Chrome) — loads the REAL KB + StewardRAG grounding + MaiKKB and
 * runs a golden set through the ACTUAL answer path (buildPackage -> compose), which node cannot do (the
 * grounding engine needs a browser). Reproduces the wrong-match end-to-end and verifies the guard, the
 * alias map, and the symptom layer on real answers. USAGE: node test/run-maik-eval.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8805, DBG = 9394, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-eval-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Golden set — grow me. expect: /regex/ the resolved topic (or answer text) must match.
// reject: /regex/ the topic must NOT match. mode: expected answer mode (e.g. "kb-symptom").
const GOLDEN = [
  { q: "how to treat diabetes", expect: /diabet/i },
  { q: "diabetic ketoacidosis management", expect: /ketoacidos/i },
  { q: "treatment of hypertension", mode: "kb-symptom", expect: /first-line management|blood pressure/i },  // #168 condition layer intercepts (no wrong IIH subtype)
  { q: "uti treatment", mode: "kb-symptom", expect: /antibiotic|cystitis|urinary/i },
  { q: "tuberculosis treatment", expect: /tuberculosis/i },
  { q: "how to treat tb", expect: /tuberculosis/i },
  { q: "heart attack treatment", expect: /coronary|myocard/i },
  { q: "management of sepsis", expect: /sepsis/i },
  { q: "dengue management", expect: /dengue/i },
  { q: "community acquired pneumonia", expect: /pneumonia/i },
  { q: "status epilepticus management", expect: /status epilepticus/i },
  // wrong-match regression — MUST NOT resolve to encephalopathy
  { q: "how to correct metabolic acidosis", reject: /encephalopath/i },
  { q: "metabolic acidosis not encephalopathy", reject: /encephalopath/i },
  // symptom layer — bare presentations get the first-approach
  { q: "fever", mode: "kb-symptom", expect: /can.t-miss/i },
  { q: "chest pain", mode: "kb-symptom", expect: /can.t-miss/i },
];

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
async function evalQ(q) {
  const r = await call("Runtime.evaluate", { expression: `window.__evalQuery(${JSON.stringify(q)})`, awaitPromise: true, returnByValue: true });
  return (r.result && r.result.result && r.result.result.value) || {};
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/maik-eval-harness.html" });

  let ready = null;
  for (let i = 0; i < 120; i++) { await sleep(150); ready = await call("Runtime.evaluate", { expression: "window.__evalReady === true", returnByValue: true }); if (ready.result && ready.result.result && ready.result.result.value === true) break; }
  ok(ready && ready.result && ready.result.result && ready.result.result.value === true, "real KB + StewardRAG + MaiKKB loaded");

  let instant = 0, deferred = 0;
  for (const c of GOLDEN) {
    const r = await evalQ(c.q);
    const label = c.q + "  ->  " + (r.topic || (r.error ? "ERR:" + r.error : "null (defer to LLM)")) + (r.mode ? " [" + r.mode + "]" : "");
    if (r.error) { ok(false, label); continue; }
    const hay = (r.topic || "") + " " + (r.text || "");
    if (c.reject) ok(!c.reject.test(hay), "REJECT " + c.reject + " | " + label);
    else if (c.mode) ok(r.mode === c.mode && (!c.expect || c.expect.test(hay)), "MODE " + c.mode + " | " + label);
    else if (c.resolves) ok(!!r.topic, "RESOLVES | " + label);
    // EXPECT: a wrong topic fails; a null (KB deferring to the server LLM, which still answers) is allowed.
    else { ok(!r.topic || c.expect.test(hay), "EXPECT " + c.expect + " | " + label); if (r.topic) instant++; else deferred++; }
  }
  console.log("\n-- coverage: " + instant + " KB-instant, " + deferred + " deferred-to-LLM (candidates for KB/symptom coverage) --");
  console.log(fails ? `\n${fails} EVAL CASE(S) FAILED` : "\nAll MaiK full-answer eval cases passed");
} catch (e) { console.log("HARNESS ERROR: " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc.kill(); } catch {} process.exit(fails ? 1 : 0); }
