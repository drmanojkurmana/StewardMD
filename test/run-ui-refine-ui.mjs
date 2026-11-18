/* ui-refine.css + scroll-fade.js in the REAL app (owner 2026-11-18: "apply to whole app", the ten UI hacks).
 * Checks: tabular numbers, balanced headings, pretty paragraphs, a scroll row fading only on the side with more to
 * show, the press scale on a real held press, and the kill switch. USAGE: node test/run-ui-refine-ui.mjs */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/prep-tools-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}


await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
// Two inset() clips within a pixel of each other (rects carry sub-pixel noise under the text-size zoom).
const nums = (c) => (String(c).match(/-?\d+(\.\d+)?/g) || []).map(Number);
const sameClip = (a, b) => { const x = nums(a), y = nums(b); return x.length === y.length && x.length > 0 && x.every((v, i) => Math.abs(v - y[i]) <= 1); };
const nearAt = (tr) => { const n = nums(tr); return n.length >= 3 && Math.abs(n[0] - 30) <= 1 && Math.abs(n[1] - 420) <= 1 && Math.abs(n[2] - 1) < 0.02; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function shot(name) { if (!SHOTS) return; const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); }
// A real tap: pointerdown then click, at the element's centre.
const tap = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); var r=b.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2; b.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:x,clientY:y,button:0})); b.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0})); return 1;`);
// The newest animation on a target: its first keyframe and easing.
const anim = (sel) => ev(`var t=document.querySelector(${JSON.stringify(sel)}); if(!t) return "none"; var L=t.getAnimations(), a=L.filter(function(x){ return x.effect.getKeyframes().some(function(f){ return f.transform; }); }).slice(-1)[0] || L.slice(-1)[0]; if(!a) return "none"; var k=a.effect.getKeyframes(); return JSON.stringify({clip:k[0].clipPath||"", tr:k[0].transform||"", op:k[0].opacity, ease:a.effect.getTiming().easing, dur:a.effect.getTiming().duration});`);

try {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") { const d = JSON.stringify(m.params.exceptionDetails); if (/refine|sfade|scroll-fade/.test(d)) errors.push(d.slice(0, 300)); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const boot = async () => {
    await call("Page.navigate", { url: BASE + "?r=" + Date.now() });
    ok(await until(`return !!(window.SMD_SCROLL_FADE && document.body);`, 30000), "the app boots with scroll-fade.js");
    await sleep(1500);
    await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","harrisonQuotePopup"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  };
  await boot();
  // A fixture: a table, a heading, a paragraph, a scroll row and a button, on top of the app.
  await ev(`var w=document.createElement("div"); w.id="uirFx"; w.style.cssText="position:fixed;left:0;top:0;width:390px;z-index:99999;background:#fff";
    w.innerHTML='<h2 id="uirH">Free shipping on every order over fifty</h2><p id="uirP">A paragraph of text.</p><table><tr><td id="uirTd">1,111</td></tr></table>'+
      '<div id="uirRow" class="x-chips" style="display:flex;gap:8px;overflow-x:auto;width:300px">'+Array.from({length:12},function(_,i){return '<span style="flex:0 0 80px;height:30px;background:#ddd">'+i+'</span>';}).join("")+'</div>'+
      '<button id="uirBtn" style="width:120px;height:44px;transform:translateX(10px)">Press</button>';
    document.body.appendChild(w); SMD_SCROLL_FADE.scan(); return 1;`);
  const cs = (sel, p) => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(p)}];`);
  ok(/tabular-nums/.test(await cs("#uirTd", "fontVariantNumeric")), "table numbers are tabular");
  ok(await cs("#uirH", "textWrap") === "balance" || await cs("#uirH", "textWrapStyle") === "balance", "headings balance");
  ok(await cs("#uirP", "textWrapStyle") === "pretty" || await cs("#uirP", "textWrap") === "pretty", "paragraphs avoid a lone last word");
  ok(await ev(`return document.getElementById("uirRow").getAttribute("data-sfade");`) === "e", "a row at its start fades only the end");
  ok(/linear-gradient/.test(await cs("#uirRow", "maskImage") || await cs("#uirRow", "webkitMaskImage")), "the fade is a mask on the row itself");
  await ev(`var r=document.getElementById("uirRow"); r.scrollLeft=200; return 1;`); await sleep(120);
  ok(await ev(`return document.getElementById("uirRow").getAttribute("data-sfade");`) === "s e", "mid-scroll it fades both sides");
  await ev(`var r=document.getElementById("uirRow"); r.scrollLeft=r.scrollWidth; return 1;`); await sleep(120);
  ok(await ev(`return document.getElementById("uirRow").getAttribute("data-sfade");`) === "s", "at the end only the start fades");
  // A real held press (CDP mouse down keeps :active).
  const c = JSON.parse(await ev(`var r=document.getElementById("uirBtn").getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});`));
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1 });
  const pr = JSON.parse(await ev(`var b=document.getElementById("uirBtn"), s=getComputedStyle(b); return JSON.stringify({scale:s.scale, tr:s.transform});`));
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: 1 });
  ok(pr.scale === "0.97" && /matrix\(1, 0, 0, 1, 10, 0\)/.test(pr.tr), "a pressed button sinks to 97% and keeps its own transform: " + JSON.stringify(pr));
  ok(await cs("#uirBtn", "scale") === "none", "released, it is back to full size");
  // Kill switch.
  await ev(`localStorage.setItem("smd_ui_refine","0"); return 1;`);
  await boot();
  await ev(`var h=document.createElement("h2"); h.id="uirH2"; h.textContent="x"; document.body.appendChild(h); return 1;`);
  ok(await ev(`return document.documentElement.classList.contains("no-ui-refine");`) === true, "smd_ui_refine = 0 sets html.no-ui-refine");
  ok(await cs("#uirH2", "textWrapStyle") !== "balance" || await cs("#uirH2", "textWrap") !== "balance", "switched off, headings are left alone");
  await ev(`localStorage.removeItem("smd_ui_refine"); return 1;`);
  ok(errors.length === 0, "no error " + errors.join(" | "));
} catch (e) { console.error(e); fails++; }
finally { try { chrome.kill("SIGKILL"); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
