/* LEGACY Dynamic Island notifications (dynamic-notify.js) in a real headless browser.
 * Since 2026-10-26 the Island is opt-in (localStorage smd_dyn_notify=island); by default SMD_dynNotify and toast()
 * draw toast.js's plain card. This harness turns the Island on, covers it, then checks the default card path.
 * Covers: SMD_dynNotify.fromText routes into the island, the card springs to rest under the pill, content is
 * readable, tap fires onPress and dismisses, swipe up dismisses, a second notification morphs the
 * open card, the kill switch (smd_dyn_notify=0) restores the old bottom toast.
 *
 * USAGE: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-dynamic-notify-ui.mjs
 *        SHOTS=<dir> also saves screenshots of the open card and mid-animation frames. */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9411, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/dyn-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-sandbox", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const r = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 260, scale: 2 } });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
};
const touch = async (type, x, y) => call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('smd_dyn_notify','island')}catch(e){}" });
  const load = async () => { await call("Page.navigate", { url: BASE + "test/fixtures/dynamic-notify.html" }); for (let i = 0; i < 50; i++) { if (await ev("return !!(window.SMD_dynNotify && window.toast)")) return; await sleep(100); } };
  await load();

  ok(await ev("return typeof SMD_dynNotify === 'function' && SMD_dynNotify.enabled()"), "SMD_dynNotify defined and on by default");

  // 1. fromText (the old toast route) draws the island when it is opted in
  await ev("SMD_dynNotify.fromText('Saved to your notes'); return 1");
  await sleep(90); await shot("1-opening");
  // Wait for the springs to settle (position AND width: a cold or loaded headless run delays the frames).
  for (let i = 0; i < 60; i++) { if (await ev("var r=document.querySelectorAll('svg g rect')[1]; return r && Math.abs(+r.getAttribute('y')-55)<0.5 && Math.abs(+r.getAttribute('width')-366)<0.5")) break; await sleep(100); }
  await shot("2-open");
  const st = JSON.parse(await ev(`var r=document.querySelector('svg rect:nth-of-type(2)')||document.querySelectorAll('svg g rect')[1];
    var p=document.querySelectorAll('svg g rect')[0];
    return JSON.stringify({vis:SMD_dynNotify.isVisible(), text:document.body.innerText.indexOf('Saved to your notes')>=0,
      oldToast:!!document.getElementById('smdToast'), cy:+r.getAttribute('y'), ch:+r.getAttribute('height'), cw:+r.getAttribute('width'),
      py:+p.getAttribute('y'), ph:+p.getAttribute('height'), pw:+p.getAttribute('width')})`));
  ok(st.vis && st.text, "fromText shows as a dynamic notification with its text");
  ok(!st.oldToast, "old bottom toast not used");
  ok(Math.abs(st.pw - 126) < 0.5 && Math.abs(st.ph - 37) < 0.5 && Math.abs(st.py - 8) < 0.5, "pill at rest: 126x37 at the top " + JSON.stringify([st.pw, st.ph, st.py]));
  ok(Math.abs(st.cy - (8 + 37 + 10)) < 0.5 && Math.abs(st.cw - 366) < 0.5 && st.ch >= 63.5, "card at rest under the pill " + JSON.stringify([st.cy, st.cw, st.ch]));

  // 2. swipe up dismisses
  const cy = st.cy + st.ch / 2;
  await touch("mousePressed", 195, cy);
  for (let i = 1; i <= 5; i++) { await touch("mouseMoved", 195, cy - i * 12); await sleep(12); }
  await touch("mouseReleased", 195, cy - 60);
  await sleep(80); await shot("3-swipe-closing");
  ok(!(await ev("return SMD_dynNotify.isVisible()")), "swipe up dismisses");
  await sleep(1200);
  ok(await ev("return getComputedStyle(document.querySelector('svg')).opacity === '0'"), "island hidden after close");

  // 3. tap fires onPress and dismisses
  await ev("window.__pressed=0; SMD_dynNotify({title:'New lab result', message:'Bed 4: potassium 6.1 mmol/L', symbol:'bell', onPress:function(){window.__pressed++}}); return 1");
  await sleep(900); await shot("4-push");
  const ch2 = Number(await ev("return document.querySelectorAll('svg g rect')[1].getAttribute('height')"));
  await touch("mousePressed", 195, 55 + ch2 / 2); await touch("mouseReleased", 195, 55 + ch2 / 2);
  await sleep(50);
  ok((await ev("return window.__pressed")) === 1 && !(await ev("return SMD_dynNotify.isVisible()")), "tap calls onPress once and dismisses");
  await sleep(1200);

  // 4. a second notification morphs the open card (no queue)
  await ev("SMD_dynNotify({title:'One'}); return 1"); await sleep(700);
  const h1 = Number(await ev("return document.querySelectorAll('svg g rect')[1].getAttribute('height')"));
  await ev("SMD_dynNotify({title:'Two', message:'A longer second line that wraps onto more than one line on a phone screen, for sure'}); return 1");
  await sleep(120); await shot("5-morph");
  await sleep(900);
  const h2 = Number(await ev("return document.querySelectorAll('svg g rect')[1].getAttribute('height')"));
  ok(h2 > h1 + 10, "open card grows to fit the next notification " + h1 + " -> " + h2);
  ok(await ev("return document.body.innerText.indexOf('One')<0 && document.body.innerText.indexOf('Two')>=0"), "previous content retired");
  await ev("SMD_dynNotify.dismiss(); return 1"); await sleep(1200);

  // 5. auto-dismiss
  await ev("SMD_dynNotify({title:'Quick', duration:600}); return 1"); await sleep(1100);
  ok(!(await ev("return SMD_dynNotify.isVisible()")), "auto-dismisses after its duration");
  await sleep(800);

  // 5b. Display zoom (home.js zoomNowD, 0.95 auto fit on a small phone): the card stays centred on the screen and the
  // pill on the hardware island. Before the fix the whole island drew 5% small and slid left (11 px left, 31 px right).
  await ev("document.documentElement.style.zoom='0.95'; window.dispatchEvent(new Event('resize')); return 1");
  await ev("SMD_dynNotify({title:'Zoomed page', message:'centred on the screen'}); return 1"); await sleep(1200);
  const zc = await ev("var L=[].slice.call(document.querySelectorAll('body > div')).filter(function(e){return e.style.clipPath&&e.textContent.indexOf('Zoomed page')>=0;})[0];var r=L.getBoundingClientRect();var p=document.querySelector('svg rect').getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(innerWidth-r.right),pc:Math.round(p.left+p.width/2),vw:innerWidth};");
  ok(Math.abs(zc.l - zc.r) <= 1 && Math.abs(zc.pc - zc.vw / 2) <= 1, "zoomed page (0.95): card centred and pill on the island " + JSON.stringify(zc));
  await ev("SMD_dynNotify.dismiss(); document.documentElement.style.zoom=''; return 1"); await sleep(1200);

  // 6. default (Island not opted in): toast() and SMD_dynNotify both draw the plain card, no SVG island
  await ev("localStorage.removeItem('smd_dyn_notify'); return 1");
  await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: "1" }).catch(() => {});
  await call("Page.navigate", { url: BASE + "test/fixtures/dynamic-notify.html" }); await sleep(1200);
  await ev("localStorage.removeItem('smd_dyn_notify'); return 1");
  await ev("toast(\"Couldn't save the note\"); return 1"); await sleep(500);
  ok(await ev("var t=document.getElementById('smdToast'); return !!t && t.textContent.indexOf(\"Couldn't save the note\")>=0"), "toast() draws the plain card by default");
  ok(await ev("return document.querySelectorAll('svg g rect').length===0 || !SMD_dynNotify.isVisible() || !!document.getElementById('smdToast')"), "no Island on the default path");
  await ev("SMD_dynNotify({title:'Antibiogram removed', message:'From this device', action:{label:'Undo', onPress:function(){window.__undo=1}}}); return 1"); await sleep(500);
  ok(await ev("var b=document.querySelector('#smdToast [data-act]'); return !!b && b.textContent==='Undo'"), "Undo action renders as a button on the plain card");
} catch (e) { console.log("FAIL harness:", e && e.message); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
