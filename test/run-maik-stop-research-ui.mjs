/* MaiK Stop during web research and Research mode — real headless browser.
 *
 * Owner, 2026-09-25: "fix stop for research and web search too". The Research chip never showed the
 * Stop button and "Researching the web" ran on; Research mode's Stop freed the button but the
 * "Reviewing the evidence" bubble and the late answer still arrived. SMD_AI.research is stubbed to
 * hang until the test releases it, so Stop is pressed mid-flight and the late answer must be dropped.
 *
 * USAGE: node test/run-maik-stop-research-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8998/").replace(/\/?$/, "/");
const PORT = 9397, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-stopweb-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const stopping = () => ev(`return document.getElementById("maikSend").classList.contains("stopping");`);
const bodyText = () => ev(`return document.getElementById("maikBody").textContent;`);
// Every research call hangs until the test settles it.
const STUB = `window.SMD_AI.research = function () { return new Promise(function (res) { window.__settle = res; }); }; return 1;`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_AI)`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);
  ok(await ev(`return !!document.getElementById("maikBody");`) === true, "the MaiK sheet opens");
  await ev(STUB);

  // ── A. The Research chip under an answer ──
  await ev(`var d = document.createElement("div"); d.className = "maik-b ai"; d.innerHTML = "<p>Answer.</p>";
    d.appendChild(__MAIK_TEST.webChipEl("empiric therapy for cellulitis")); document.getElementById("maikBody").appendChild(d); return 1;`);
  await ev(`document.querySelector("#maikBody .maik-webchip").click(); return 1;`); await sleep(300);
  ok(await stopping() === true, "web research: the send button turns into Stop");
  ok(/Researching the web/.test(await bodyText()), "web research: the progress line shows");
  await ev(`document.getElementById("maikSend").click(); return 1;`); await sleep(300);
  ok(await stopping() === false, "web research: Stop frees the composer");
  ok(!(await ev(`return !!document.querySelector("#maikBody .maik-webbusy");`)), "web research: the progress line is gone");
  ok(await ev(`return !!document.querySelector("#maikBody .maik-stopped");`) === true, "web research: the turn says Stopped");
  ok(await ev(`return document.querySelector("#maikBody .maik-webchip").disabled;`) === false, "web research: the chip can be tapped again");
  await ev(`window.__settle({ text: "LATE WEB ANSWER" }); return 1;`); await sleep(400);
  ok(!/LATE WEB ANSWER/.test(await bodyText()), "web research: an answer that lands after Stop is dropped");

  // ── B. Web research that is NOT stopped still delivers and frees the composer ──
  await ev(STUB);
  await ev(`document.querySelector("#maikBody .maik-webchip").click(); return 1;`); await sleep(300);
  await ev(`window.__settle({ text: "WEB ANSWER ARRIVES" }); return 1;`); await sleep(500);
  ok(/WEB ANSWER ARRIVES/.test(await bodyText()), "web research: an unstopped answer still arrives");
  ok(await stopping() === false, "web research: the composer is free after the answer");

  // ── C. Research mode (evidence review) ──
  await ev(STUB);
  await ev(`var b = document.getElementById("maikResearch"); if (!b) return "missing"; if (!b.classList.contains("on")) b.click(); return 1;`);
  await ev(`var q = document.getElementById("maikQ"); q.value = "fluids in septic shock"; q.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("maikSend").click(); return 1;`); await sleep(500);
  ok(await stopping() === true, "Research mode: the send button turns into Stop");
  ok(/Reviewing the evidence/.test(await bodyText()), "Research mode: 'Reviewing the evidence' shows");
  await ev(`document.getElementById("maikSend").click(); return 1;`); await sleep(300);
  ok(await stopping() === false, "Research mode: Stop frees the composer");
  const tail = await ev(`var a = document.querySelectorAll("#maikBody .maik-b.ai"); return a[a.length - 1].textContent;`);
  ok(/Stopped\./.test(tail) && !/Reviewing the evidence/.test(tail), `Research mode: the bubble says Stopped ("${tail.trim()}")`);
  await ev(`window.__settle({ text: "LATE EVIDENCE REVIEW" }); return 1;`); await sleep(400);
  ok(!/LATE EVIDENCE REVIEW/.test(await bodyText()), "Research mode: a review that lands after Stop is dropped");

  console.log(fails === 0 ? "\nALL GREEN: Stop ends web research and Research mode" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
