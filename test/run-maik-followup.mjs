/* MaiK follow-up topic-continuity test (headless, via window.__MAIK_TEST hook).
 * Reproduces the real bug: after an ascites answer, the follow-up
 * "Ok First Line Treatment?" was retrieved standalone and keyword-matched
 * "First Bite Syndrome". Asserts the resolver keeps short generic follow-ups
 * ON topic and lets genuinely new topics fall through to normal routing. */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8797/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9363;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-fu-prof-" + Date.now();

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/); serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), m ? m[1] : "8797"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { fail++; console.log("❌ " + m); } };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 50; i++) { await sleep(400); if (await ev(`return !!document.querySelector('[data-act="askai"]');`)) { ready = true; break; } }
  if (!ready) throw new Error("home screen not ready");
  await ev(`document.querySelector('[data-act="askai"]').click(); return 1;`); await sleep(600);
  if (!(await ev(`return !!window.__MAIK_TEST;`))) throw new Error("__MAIK_TEST hook missing — MaiK sheet didn't open");

  await ev(`window.__MAIK_TEST.setTopic({ topic: "causes of high SAAG ascites", question: "causes of high SAAG ascites", depth: "concise", ts: Date.now() }); return 1;`);
  const R = async (q) => JSON.parse(await ev(`return JSON.stringify(window.__MAIK_TEST.resolveFollowup(${JSON.stringify(q)}) || null);`) || "null");

  // THE bug reproduction
  const fu = await R("Ok First Line Treatment?");
  console.log("  'Ok First Line Treatment?' →", JSON.stringify(fu));
  ok(fu && /ascites/i.test(fu.retrieval || ""), "retrieval query carries the conversation topic (ascites)");
  ok(fu && /ascites/i.test(fu.question || ""), "model question names the topic, not the bare fragment");
  ok(fu && /first line treatment/i.test(fu.question || ""), "the actual ask (first-line treatment) is preserved");

  // Other generic follow-up forms stay on topic
  const c1 = await R("complications?");
  ok(c1 && /ascites/i.test(c1.retrieval || ""), "'complications?' stays on topic");
  const c2 = await R("yes investigations");
  ok(c2 && /ascites/i.test(c2.retrieval || ""), "'yes investigations' stays on topic");

  // Bare ack falls through (handled as acknowledgement, not a clinical call)
  ok((await R("ok")) === null, "bare 'ok' falls through to the ack reply");

  // A genuinely NEW topic must NOT be glued to the old one
  ok((await R("how to treat dengue fever")) === null, "a new named topic (dengue) falls through to normal routing");
  ok((await R("pheochromocytoma workup")) === null, "non-generic token (pheochromocytoma) falls through");

  console.log(`\n${fail === 0 ? "ALL GREEN — MaiK follow-ups stay on topic" : fail + " FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
