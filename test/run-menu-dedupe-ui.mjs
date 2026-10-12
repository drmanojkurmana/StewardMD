/* One home per destination: the sidebar is REFERENCE only; the More sheet is the home for account, settings, help,
 * the tour and the legal pages. In the real app (owner decision 2026-10-12: nothing may appear in both menus).
 *
 * USAGE: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-menu-dedupe-ui.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9414, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/dd-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8991"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-sandbox", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const waitFor = async (expr, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } return false; };
const load = async () => {
  await call("Storage.clearDataForOrigin", { origin: BASE.replace(/\/$/, ""), storageTypes: "all" });
  await call("Page.navigate", { url: BASE });
  await waitFor("return !!document.querySelector('.rnav-tab')", 20000);
  await sleep(1800);
  await ev(`["introPoster","splash","smdBootSplash","accountGate","introOverlay","harrisonQuotePopup"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await sleep(400);
};
const openMore = async () => { await ev("[].slice.call(document.querySelectorAll('.rnav-tab')).filter(function(b){return /More/.test(b.textContent)})[0].click();return 1"); await waitFor("return !!document.querySelector('#hvSheet.on .hv-mi')"); await sleep(400); };
const closeSheet = async () => { await ev("var sc=document.getElementById('hvScrim');if(sc)sc.click();return 1"); await sleep(700); };
const norm = (t) => String(t).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().toLowerCase();
const moreLabels = () => ev("return JSON.stringify([].map.call(document.querySelectorAll('#hvSheet .hv-mi .ml'),function(e){var n=e.firstChild;while(n&&n.nodeType!==3)n=n.nextSibling;return (n?n.nodeValue:e.textContent).trim()}))").then(JSON.parse);
const sideLabels = () => ev("return JSON.stringify([].map.call(document.querySelectorAll('#sbDrawer .sbr-row .sbr-lbl'),function(e){return e.textContent.trim()}))").then(JSON.parse);
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  ({ result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }));
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('stewardmd_guest_used','1')}catch(e){}" });
  await call("Page.enable"); await call("Runtime.enable");
  await load();

  // Sidebar: reference only
  await ev("var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1");
  await waitFor("return document.querySelectorAll('#sbDrawer .sbr-row').length>0");
  await sleep(500);
  const side = await sideLabels();
  ok(side.some((l) => /Guidelines/.test(l)), "sidebar keeps Guidelines & Protocols (" + side.join(" | ") + ")");
  for (const gone of [/Drugs Database/, /Interaction Checker/, /^Calculators$/, /Help/, /App tour/, /About/, /^Settings$/]) ok(!side.some((l) => gone.test(l)), "sidebar no longer has " + gone);
  ok(!(await ev("return [].some.call(document.querySelectorAll('#sbDrawer .sbr-sec'),function(e){return /^(Tools|Settings)$/.test(e.textContent.trim())})")), "sidebar section headings Tools and Settings are gone");
  await ev("document.getElementById('sbBackdrop').click();return 1"); await sleep(900);

  // More: the one home
  await openMore();
  const more = await moreLabels();
  for (const need of [/^Profile$/, /^Subscription$/, /^AI Usage$/, /^Settings$/, /^Help & support$/, /^App tour$/, /^About & Acknowledgements$/, /^Medical disclaimer$/, /^Privacy policy$/, /^Terms of use$/, /^Open shared case$/, /^Search Medical Register$/, /^Connect patient$/]) ok(more.some((l) => need.test(l.replace(/&amp;/g, "&"))), "More has " + need);
  ok(!more.some((l) => /Display & Accessibility|Notification preferences/.test(l.replace(/&amp;/g, "&"))), "More no longer has separate Display and Notification rows (they are inside Settings)");
  const headings = await ev("return JSON.stringify([].map.call(document.querySelectorAll('#hvSheet .hv-sheet-wrap > div[style*=uppercase]'),function(e){return e.textContent.trim()}))").then(JSON.parse);
  ok(headings.join("|") === "Clinical|Account|Help|About & legal", "More is grouped: " + headings.join(" | "));

  // The two menus share nothing
  const both = side.map(norm).filter((l) => more.map(norm).includes(l));
  ok(both.length === 0, "no label appears in both menus (" + both.join(", ") + ")");

  // Each row still goes where it should
  await ev("window.__calls=[];var P=function(o,k){o[k]=function(){window.__calls.push(k)}};window.SMD_HELP=window.SMD_HELP||{};P(SMD_HELP,'openCentre');window.SMD_TOUR=window.SMD_TOUR||{};SMD_TOUR.start=function(){__calls.push('tour')};return 1");
  const rowClick = (re) => ev(`var b=[].slice.call(document.querySelectorAll('#hvSheet .hv-mi')).filter(function(b){return ${re}.test(b.textContent)})[0];b&&b.click();return !!b`);
  await rowClick("/^Help & support/"); await sleep(500);
  ok((await ev("return __calls.indexOf('openCentre')>=0")), "More > Help & support opens the Help centre");
  await openMore(); await rowClick("/^App tour/"); await sleep(700);
  ok((await ev("return __calls.indexOf('tour')>=0")), "More > App tour starts the tour");
  await openMore(); await rowClick("/^Settings/"); await waitFor("return !!document.querySelector('.sbr-set-ov')");
  ok(await ev("return !!document.querySelector('.sbr-set-ov')"), "More > Settings opens the Settings page");
  const setRows = await ev("return JSON.stringify([].map.call(document.querySelectorAll('.sbr-set-ov .smd-nav-row, .sbr-set-ov .sbr-row'),function(e){return e.textContent.replace(/\\s+/g,' ').trim().slice(0,30)}))").then(JSON.parse);
  ok(setRows.some((t) => /^Notifications/.test(t)) && setRows.some((t) => /^Appearance/.test(t)) && setRows.some((t) => /^Profile/.test(t)), "the Settings page has Profile, Notifications and Appearance (so More does not need its own)");
  await load();
  await openMore(); await rowClick("/^About & Acknowledgements/"); await sleep(900);
  ok(await ev("var m=document.getElementById('aboutModal');return !!m&&getComputedStyle(m).display!=='none'&&m.getClientRects().length>0"), "More > About & Acknowledgements opens the About modal");

  // Unread Help replies moved with Help
  await load();
  await ev("window.SMD_BUGS=window.SMD_BUGS||{};SMD_BUGS.unread=function(){return 3};return 1");
  await openMore();
  ok(/3 new/.test(await ev("var h=document.querySelector('#hvSheet [data-mi=help] .ml');return h?h.textContent:''")), "the unread-replies count shows on More > Help & support");
} catch (e) { console.log("FAIL harness:", e && e.message); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
