/* test/run-ipad-deep.mjs: opens a module directly (past sign-in and access gates), then taps through up to N tiles/rows
 * on its first screen, and writes a screenshot of every screen at iPad landscape (1180x820) and portrait (820x1180).
 * Flags a screen when something card-like is wider than 900 px (a phone layout stretched across the glass).
 * USAGE: node test/run-ipad-deep.mjs "<name>=<js that opens it>" ...   OUT=<dir>   (static server on :8994)
 * The first audit (run-ipad-fit.mjs) opens each tool through its Home button, which stops at a sign-in box or a flag for
 * several modules; this one calls the module's own open() instead. */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
const outDir = process.env.OUT || ((process.env.CLAUDE_JOB_DIR || "/tmp") + "/ipad-deep"), N = +(process.env.TAPS || 6);
mkdirSync(outDir, { recursive: true });
const mods = process.argv.slice(2).map((a) => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)]; });
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn("/opt/pw-browsers/chromium", ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--mute-audio", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/ipadd-${port}`, "about:blank"], { stdio: "ignore" });
let tabs; for (let i = 0; i < 300; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch {} await sleep(100); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await call("Runtime.evaluate", { expression: `(() => { try { return (${e}); } catch (x) { return 'ERR ' + x; } })()`, returnByValue: true })).result?.result?.value;
await call("Runtime.enable"); await call("Page.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.confirm=function(){return true}; try{localStorage.setItem("smd_onboarding_tour","0");}catch(e){}` });
const size = (w, h) => call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true, screenWidth: 820, screenHeight: 1366 });
const WIDE = `(function(){ var W=innerWidth, out=[]; var all=document.body.querySelectorAll('*');
  for (var i=0;i<all.length&&out.length<6;i++){ var e=all[i], s=getComputedStyle(e); if(s.display==='none'||s.visibility==='hidden'||+s.opacity<.05) continue;
    var r=e.getBoundingClientRect(); if(r.width<900||r.height<28||r.height>420||r.bottom<0||r.top>innerHeight) continue;
    var card=(s.borderRadius&&s.borderRadius!=='0px')&&(s.backgroundColor!=='rgba(0, 0, 0, 0)'||s.boxShadow!=='none'||s.borderTopWidth!=='0px');
    if(!card||e.tagName==='BODY'||e.scrollHeight>e.clientHeight+60&&/(auto|scroll)/.test(s.overflowY)) continue;
    out.push(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+'.'+String(e.className).trim().split(/\\s+/).slice(0,2).join('.')+' w'+Math.round(r.width)); }
  return out; })()`;
const TAPS = `(function(){ var top=document.elementFromPoint(innerWidth/2, innerHeight/2); var L=top; while(L&&L.parentElement&&L.parentElement!==document.body) L=L.parentElement; if(!L) return [];
  var c=L.querySelectorAll('[data-act],[data-k],[data-s],[data-m],.card,.tile,.row,button,a[href],li'); var r=[],seen={};
  for(var i=0;i<c.length&&r.length<30;i++){ var e=c[i], b=e.getBoundingClientRect(); if(b.width<60||b.height<30||b.top<40||b.top>innerHeight-30) continue; var t=(e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,40); if(!t||seen[t]||/(close|back|done|cancel|delete|remove|sign out|log out|reset|clear)/i.test(t)) continue; seen[t]=1; r.push([Math.round(b.left+b.width/2),Math.round(b.top+b.height/2),t]); }
  return r; })()`;
for (const [name, open] of mods) {
  await size(1180, 820);
  await call("Page.navigate", { url: "http://localhost:8994/?tour=0&prep=1&clinix=1&kardia=1&maik=1" });
  for (let i = 0; i < 100; i++) { if (await ev("!!document.getElementById('homeV2')")) break; await sleep(200); }
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}), true`);
  await sleep(800);
  const shot = async (tag) => { for (const [w, h, t] of [[1180, 820, "l"], [820, 1180, "p"]]) { await size(w, h); await sleep(500); const s = await call("Page.captureScreenshot", { format: "jpeg", quality: 55 }); if (s.result) writeFileSync(`${outDir}/${name}-${tag}-${t}.jpg`, Buffer.from(s.result.data, "base64")); if (t === "l") { const wide = await ev(WIDE); console.log(name, tag, "wide:", JSON.stringify(wide)); } } await size(1180, 820); await sleep(300); };
  await ev(open); await sleep(4000);
  await shot("0");
  const taps = await ev(TAPS) || [];
  console.log(name, "taps:", taps.slice(0, N).map((t) => t[2]).join(" | "));
  for (let k = 0; k < Math.min(N, taps.length); k++) {
    if (k) { await call("Page.navigate", { url: "http://localhost:8994/?tour=0&prep=1&clinix=1&kardia=1&maik=1" }); for (let i = 0; i < 100; i++) { if (await ev("!!document.getElementById('homeV2')")) break; await sleep(200); } await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}), true`); await sleep(500); await ev(open); await sleep(3500); }
    const t = taps[k]; await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: t[0], y: t[1] }] }); await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(1800);
    await shot(String(k + 1));
  }
}
chrome.kill(); process.exit(0);
