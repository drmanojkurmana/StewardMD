/* MaiK general-knowledge + high-risk management-retrieval audit (gold122).
 *
 * Proves the organophosphate-class failure is fixed and does NOT regress:
 *   • every high-risk topic has a canonical retrievable object,
 *   • "how to treat X" retrieves MANAGEMENT content (not pathophysiology),
 *   • general-knowledge questions work with NO active deterministic case,
 *   • no raw KB chunk IDs would surface (client source-humaniser maps to titles).
 *
 * Read-only: exercises the client RAG layer (StewardRAG/interface.mjs). Does not
 * touch the deterministic engine, privacy/de-identification, or the provider layer.
 *
 * USAGE: BASE=http://localhost:8902/ node test/run-maik-knowledge.mjs   (exit 0 = pass)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9362, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-knowledge-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8902"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.StewardRAG && window.SMD_REASON)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("StewardRAG/SMD_REASON not loaded");
  await ev(`await window.StewardRAG.ready(); return true;`);

  // ── high-risk management-retrieval audit ──
  const TOPICS = ["organophosphate poisoning", "paracetamol poisoning", "methanol poisoning", "snakebite",
    "status epilepticus", "anaphylaxis", "DKA", "hyperkalemia", "sepsis initial management", "meningitis empiric management"];
  for (const topic of TOPICS) {
    await sleep(200);
    const raw = await ev(`
      var pkg = await window.StewardRAG.buildPackage(window.SMD_REASON.assess({}), { question: "how to treat " + ${JSON.stringify(topic)} });
      var top3 = (pkg.retrieved || []).slice(0, 3);
      return JSON.stringify({ mgmt: top3.some(function (c) { return /^management/.test(c.section); }), top: (top3[0] || {}).section || null });`);
    let r = {}; try { r = JSON.parse(raw || "{}"); } catch {}
    ok(r.mgmt === true, `"how to treat ${topic}" retrieves MANAGEMENT in top-3 (top=[${r.top}])`);
  }

  // ── general-knowledge mode: works with NO active deterministic case ──
  const gk = await ev(`
    var pkg = await window.StewardRAG.buildPackage(window.SMD_REASON.assess({}), { question: "what is the classic presentation of dengue?" });
    return JSON.stringify({ n: (pkg.retrieved || []).length, hasQ: pkg.question === "what is the classic presentation of dengue?" });`);
  const g = JSON.parse(gk || "{}");
  ok(g.n > 0 && g.hasQ, `general-knowledge question retrieves KB with no active case (${g.n} chunks)`);

  // ── source humaniser: maps raw section IDs to human titles, never leaks chunk IDs ──
  const hs = await ev(`
    if (!(window.SMD_MaiK && window.SMD_MaiK.sourceTitles)) return JSON.stringify({ missing: true });
    var titles = window.SMD_MaiK.sourceTitles([
      { section: "harrison.pathophysiology", source: { ref: "Harrison 22e" } },
      { section: "management", source: { ref: "StewardMD management protocol" } },
      { section: "management.treatment", source: { ref: "StewardMD Drug Index / protocol" } }
    ]);
    var joined = titles.join(" | ");
    return JSON.stringify({ titles: titles, leak: /harrison\\.|#|management\\.treatment|chunkId/.test(joined) });`);
  const h = JSON.parse(hs || "{}");
  ok(!h.missing && h.leak === false, `source humaniser returns human titles, no raw IDs (${(h.titles || []).join(", ")})`);

  console.log(fails === 0 ? "\nALL GREEN — MaiK knowledge audit passed" : `\n${fails} FAILED`);
} catch (e) {
  console.error("HARNESS ERROR:", e.message); fails++;
} finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); }
process.exit(fails === 0 ? 0 : 1);
