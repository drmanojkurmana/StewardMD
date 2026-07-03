/* Verifies the ICU import chooser text is visible: the .icu-btn label must not be
 * white-on-white. Reproduces the bug (overlay WITHOUT .icu-modal → theme vars
 * undefined → transparent bg + white text) and confirms the fix (WITH .icu-modal). */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8796/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9362;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-color-prof";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/); serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), m ? m[1] : "8796"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { fail++; console.log("❌ " + m); } };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 50; i++) { await sleep(400); if (await ev(`return !!(window.ICU && window.ICU.open);`)) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`window.ICU.open(); return 1;`); await sleep(400);   // injects icu-css

  // Build both variants exactly like importMethod() does, measure the label color + button bg.
  const probe = (cls) => `
    var ov=document.createElement('div'); ov.className='${cls}';
    ov.innerHTML='<div class="icu-imp-review"><div class="icu-imp-hd">t</div><div style="padding:12px 16px">'+
      '<button class="icu-btn" id="probeBtn" style="display:block;width:100%;text-align:left"><b id="probeB">🧪 Laboratory report</b></button></div></div>';
    document.body.appendChild(ov);
    var b=document.getElementById('probeB'), btn=document.getElementById('probeBtn');
    var col=getComputedStyle(b).color, bg=getComputedStyle(btn).backgroundImage, bgc=getComputedStyle(btn).backgroundColor;
    ov.remove();
    return JSON.stringify({col:col,hasGradient:/gradient/.test(bg),bgc:bgc});`;

  const buggy = JSON.parse(await ev(probe("icu-imp-ov")));            // OLD (no icu-modal)
  const fixed = JSON.parse(await ev(probe("icu-imp-ov icu-modal")));  // NEW (with icu-modal)

  console.log("  buggy:", JSON.stringify(buggy), "\n  fixed:", JSON.stringify(fixed));
  // The bug: white text AND no gradient background (→ invisible on white).
  ok(buggy.col === "rgb(255, 255, 255)" && !buggy.hasGradient, "reproduced bug: white label + no button background (invisible)");
  // The fix: theme vars resolve → teal gradient background renders (label now sits on teal, readable).
  ok(fixed.hasGradient === true, "fix: button gets its teal gradient background (label visible on it)");

  console.log(`\n${fail === 0 ? "ALL GREEN — import chooser text is now visible" : fail + " FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
