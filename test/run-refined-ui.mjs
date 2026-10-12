/* "Refined clinical" look, in the REAL app: the home page must be byte-for-byte unchanged in computed style
 * with the look on or off, while the inner screens (Calculators cards, the More sheet) are refined.
 * Also the kill switch (localStorage smd_refined=0) and dark mode.
 *
 * USAGE: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-refined-ui.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PORT = 9413, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/rf-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8993"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-sandbox", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const waitFor = async (expr, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } return false; };
const load = async (setup) => {
  await call("Storage.clearDataForOrigin", { origin: BASE.replace(/\/$/, ""), storageTypes: "all" });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('stewardmd_guest_used','1')}catch(e){}" + (setup || "") });
  await call("Page.navigate", { url: BASE });
  await waitFor("return !!document.querySelector('.rnav-tab')", 20000);
  await sleep(1500);
  await ev(`["introPoster","splash","smdBootSplash","accountGate","introOverlay","harrisonQuotePopup"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await sleep(400);
};
// A fingerprint of how every visible element on the home page is drawn.
const HOME_SIG = `var out=[];[].forEach.call(document.querySelectorAll('#homeV2, #homeV2 *'),function(e){if(!e.getClientRects().length)return;if(e.getAnimations&&e.getAnimations({subtree:false}).length)return;var c=getComputedStyle(e);   // a running animation (the Ask MaiK glow) changes by itself, whatever the CSS
  out.push([e.tagName,String(e.className).slice(0,30),c.borderRadius,c.boxShadow,c.borderColor,c.fontSize,c.fontWeight,c.letterSpacing,c.color,c.backgroundColor,c.padding,c.margin].join('|'))});return out.join('\\n')`;
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  ({ result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }));
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.enable"); await call("Runtime.enable");

  await load();
  ok(await ev("return document.documentElement.classList.contains('smd-refined')"), "the look is on by default (html.smd-refined)");
  ok(await ev("return !!document.querySelector('link[href^=\"/refined.css\"]')"), "refined.css is linked from index.html");

  // 1. Home is unchanged: fingerprint with the look on, then off
  const on = await ev(HOME_SIG);
  await ev("document.documentElement.classList.remove('smd-refined');return 1"); await sleep(300);
  const off = await ev(HOME_SIG);
  await ev("document.documentElement.classList.add('smd-refined');return 1"); await sleep(200);
  if (on !== off) { const A = on.split("\n"), B = off.split("\n"); let n = 0; for (let i = 0; i < Math.max(A.length, B.length) && n < 6; i++) if (A[i] !== B[i]) { console.log("  DIFF on :", A[i]); console.log("  DIFF off:", B[i]); n++; } }
  ok(typeof on === "string" && on.split("\n").length > 100 && on === off, "HOME PAGE: every element draws identically with the look on and off (" + (on ? on.split("\n").length : 0) + " elements)");

  // 2. Inner: Calculators cards
  await ev("[].slice.call(document.querySelectorAll('#homeV2 button')).filter(function(b){return /Calculators/.test(b.textContent)})[0].click();return 1");
  await waitFor("return document.querySelectorAll('.mc-card').length>3");
  const card = await ev("var c=getComputedStyle(document.querySelector('.mc-card'));return c.borderRadius+'|'+c.boxShadow");
  ok(/^16px\|/.test(card) && /0\.04\d/.test(card), "inner: a Calculators card is 16px with the layered soft shadow (" + card + ")");
  await ev("document.documentElement.classList.remove('smd-refined');return 1"); await sleep(200);
  const card0 = await ev("var c=getComputedStyle(document.querySelector('.mc-card'));return c.borderRadius");
  ok(card0 === "14px", "inner: with the class off the card is back to the old 14px (" + card0 + ")");
  await ev("document.documentElement.classList.add('smd-refined');return 1");

  // 3. Inner: the More sheet is rounder
  await load();
  await ev("[].slice.call(document.querySelectorAll('.rnav-tab')).filter(function(b){return /More/.test(b.textContent)})[0].click();return 1"); await sleep(1100);
  ok((await ev("return getComputedStyle(document.getElementById('hvSheet')).borderTopLeftRadius")) === "26px", "inner: the More sheet has 26px top corners");

  // 4. Dark mode: cards keep a visible hairline and a deeper shadow
  await load();
  await ev("document.body.classList.add('dark','v3-dark');return 1");
  await ev("[].slice.call(document.querySelectorAll('#homeV2 button')).filter(function(b){return /Calculators/.test(b.textContent)})[0].click();return 1");
  await waitFor("return document.querySelectorAll('.mc-card').length>3");
  const dk = await ev("var c=getComputedStyle(document.querySelector('.mc-card'));return c.boxShadow+'|'+c.borderTopColor");
  ok(/0\.26|0\.35/.test(dk) && /255, 255, 255/.test(dk), "dark: card shadow is the deeper dark one and the hairline is a light alpha (" + dk + ")");

  ok((await ev("return getComputedStyle(document.querySelector('.mc-cat.on')).backgroundColor")) === "rgb(31, 122, 110)", "dark: the selected category chip is the deeper teal, so its white text clears 4.5:1");
  ok((await ev("return getComputedStyle(document.querySelector('.mc-count')).color")) === "rgb(76, 194, 176)", "dark: the teal count badge text is the lighter teal (4.0:1 before)");
  await load("try{localStorage.setItem('smd_refined','0')}catch(e){}");
  await ev("document.body.classList.add('dark','v3-dark');return 1");
  await ev("[].slice.call(document.querySelectorAll('#homeV2 button')).filter(function(b){return /Calculators/.test(b.textContent)})[0].click();return 1");
  await waitFor("return document.querySelectorAll('.mc-cat').length>3");
  ok((await ev("return getComputedStyle(document.querySelector('.mc-cat.on')).backgroundColor")) !== "rgb(31, 122, 110)", "dark: with the look off the chip keeps its old teal");

  // 5. Kill switch
  await load("try{localStorage.setItem('smd_refined','0')}catch(e){}");
  ok(!(await ev("return document.documentElement.classList.contains('smd-refined')")), "kill switch: localStorage smd_refined=0 leaves the old look");
} catch (e) { console.log("FAIL harness:", e && e.message); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
