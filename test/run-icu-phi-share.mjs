/* KI-H6 — PHI export consent gate. ICU Share (OS share sheet) + Print/PDF carry the patient's
 * name/bed/labs/imaging; nothing must leave the device until the clinician confirms a consent
 * sheet. Drives the real action flow with a stubbed navigator.share / window.open. Synthetic
 * patient only. USAGE: node test/run-icu-phi-share.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8922/").replace(/\/?$/, "/");
const PORT = 9424, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-phi-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8922"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.ingestLabs)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  // ---- SHARE ----
  const s1 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"QA-Share",age:60,sex:"M",bed:"7"}); ICU.ingestLabs({na:130,k:5.5});
    window.SMD_IS_NATIVE=false; window.__shared=null;
    try { navigator.share = function(o){ window.__shared=o; return Promise.resolve(); }; } catch(e){}
    ICU.open();
    var root=document.getElementById('icuRoot'); var b=document.createElement('button'); b.setAttribute('data-icu-act','sharecase'); root.appendChild(b); b.click(); b.remove();
    var m=document.getElementById('icuModal');
    return JSON.stringify({ consent: !!(m && /Patient-identifiable data/.test(m.textContent||"")), sharedYet: window.__shared!==null, hasGo: !!(m && m.querySelector('[data-icu-act="phiexportgo"]')) });
  `);
  ok(s1.consent && s1.hasGo, "Share → shows the PHI consent sheet (with a confirm button)");
  ok(s1.sharedYet === false, "Share → NOTHING is shared before the clinician confirms");
  const s2 = await J(`
    var m=document.getElementById('icuModal'); m.querySelector('[data-icu-act="phiexportgo"]').click();
    return JSON.stringify({ sharedNow: window.__shared!==null, hasName: !!(window.__shared && /QA-Share/.test(window.__shared.text||"")) });
  `);
  ok(s2.sharedNow && s2.hasName, "Share → after confirm, the summary IS shared (carries the patient context)");
  const s3 = await J(`
    window.__shared=null;
    var root=document.getElementById('icuRoot'); var b=document.createElement('button'); b.setAttribute('data-icu-act','sharecase'); root.appendChild(b); b.click(); b.remove();
    var m=document.getElementById('icuModal'); var cancel=[].slice.call(m.querySelectorAll('[data-icu-act="closeform"]'))[0];
    if (cancel) cancel.click();
    return JSON.stringify({ cancelledNotShared: window.__shared===null });
  `);
  ok(s3.cancelledNotShared, "Share → Cancel does NOT share");

  // ---- PRINT ----
  const p1 = await J(`
    window.__opened=false; try { window.open = function(){ window.__opened=true; return null; }; } catch(e){}
    var root=document.getElementById('icuRoot'); var b=document.createElement('button'); b.setAttribute('data-icu-act','printsummary'); root.appendChild(b); b.click(); b.remove();
    var m=document.getElementById('icuModal');
    return JSON.stringify({ consent: /Patient-identifiable data/.test(m.textContent||"") && /Print anyway/.test(m.textContent||""), openedYet: window.__opened });
  `);
  ok(p1.consent, "Print → shows the PHI consent sheet ('Print anyway')");
  ok(p1.openedYet === false, "Print → no print window opens before confirm");
  const p2 = await J(`
    var m=document.getElementById('icuModal'); m.querySelector('[data-icu-act="phiexportgo"]').click();
    return JSON.stringify({ openedNow: window.__opened });
  `);
  ok(p2.openedNow, "Print → after confirm, the print/PDF window is opened");

  console.log(fails === 0 ? "\nALL GREEN — KI-H6 PHI export consent gate passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
