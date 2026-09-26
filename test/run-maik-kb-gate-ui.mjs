/* The KB name gate (flag smd_kb_gate) in a real browser: boots the app, lets it load the real KB and
 * interface.mjs through its own lazy loaders, and routes questions through StewardRAG.buildPackage().
 * Covers what node cannot: the cache-busted interface.mjs import (hasTerm), String#normalize, the flag.
 * USAGE: node test/run-maik-kb-gate-ui.mjs   (Chrome at $CHROME; serves the repo on :8997)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:8997/", PORT = 9397, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-kb-gate-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), "8997"], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let mid = 1, ws, sid; const pend = new Map();
const call = (m, p) => { const i = mid++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : { err: JSON.stringify(r.result && r.result.exceptionDetails) }; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const route = (q) => ev(`StewardRAG.buildPackage({ infectious: [], nonInfectious: [] }, { question: ${JSON.stringify(q)} }).then(function (p) {
  var tm = p.topicMatch || {};
  return { id: (p.grounding[0] || {}).diseaseId || null, mode: tm.matched === true ? "confident" : tm.mode, topic: tm.topic, others: p.retrieved.filter(function (r) { return r.diseaseId !== (p.grounding[0] || {}).diseaseId; }).length };
})`);
try {
  let ver; for (let t = 0; t < 60 && !ver; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  ({ result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }));
  await call("Runtime.enable"); await call("Page.navigate", { url: BASE });
  let up = false; for (let i = 0; i < 75 && !up; i++) { await sleep(400); up = (await ev("!!window.StewardRAG")) === true; }
  ok(up, "app booted with StewardRAG");
  ok((await ev("StewardRAG.ready()")) === true, "StewardRAG.ready(): real KB + interface.mjs loaded by the app");
  ok((await ev("import('/kb/ai/interface.mjs?v=gold1035-kbgate').then(function (m) { return typeof m.createStewardAI({}).hasTerm; })")) === "function", "the cache-busted interface.mjs URL serves hasTerm()");

  const expect = async (q, id, mode) => { const r = await route(q); ok(r.id === id && r.mode === mode && r.others === 0, `${JSON.stringify(q)} -> ${r.id} [${r.mode}]${r.others ? " +" + r.others + " off-topic notes" : ""}`); return r; };
  await expect("what is RA factor", "rheumatoid", "confident");
  await expect("factor 8 deficiency", "hemophilia_a", "confident");
  await expect("haemophilia A treatment", "hemophilia_a", "confident");
  await expect("panic attack treatment", "panic", "confident");
  await expect("what is the capital of france", null, "none");
  await expect("malria treatment", "MALARIA", "assume");   // typo path: hasTerm() says "malria" is not a KB word
  await expect("brucella treatment", null, "none");          // "brucella" IS a KB word: never "corrected" to rubella
  const g = await route("Guillain-Barré syndrome treatment");
  ok(g.id === "gbs", "accented name folds (String#normalize) -> " + g.id);

  await ev("localStorage.setItem('smd_kb_gate', '0'); 1");
  const legacy = await route("what is RA factor");
  await ev("localStorage.removeItem('smd_kb_gate'); 1");
  ok(!!legacy.id && legacy.id !== "rheumatoid", "smd_kb_gate=0 restores the legacy gate -> " + legacy.id);
} catch (e) { ok(false, "harness: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} try { serve.kill(); } catch {} }
console.log(fails === 0 ? "\nALL PASS: the KB name gate works in the real app" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
