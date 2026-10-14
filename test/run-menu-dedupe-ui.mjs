/* One home per destination: the sidebar holds Reference, Account, Help and About & legal; the More sheet holds the
 * Clinical rows. In the real app (owner decision 2026-10-14, reversing 2026-10-12; nothing may appear in both menus).
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

  // Sidebar: reference + account + help + legal (owner, 2026-10-14)
  await ev("var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1");
  await waitFor("return document.querySelectorAll('#sbDrawer .sbr-row').length>0");
  await sleep(500);
  const side = await sideLabels();
  for (const need of [/Guidelines/, /^Subscription$/, /^AI Usage$/, /^Settings$/, /^Help & support$/, /^App tour$/, /^About & Acknowledgements$/, /^Medical disclaimer$/, /^Privacy policy$/, /^Terms of use$/]) ok(side.some((l) => need.test(l.replace(/&amp;/g, "&"))), "sidebar has " + need + " (" + side.join(" | ") + ")");
  for (const gone of [/RadioAnatome/, /^Profile/, /Drugs Database/, /Interaction Checker/, /^Calculators$/]) ok(!side.some((l) => gone.test(l)), "sidebar has no " + gone);
  const heads = await ev("return JSON.stringify([].map.call(document.querySelectorAll('#sbDrawer .sbr-sec'),function(e){return e.textContent.trim()}))").then(JSON.parse);
  ok(heads.filter((h) => h !== "Clinical workspace").join("|") === "Reference|Account|Help|About & legal", "sidebar is grouped: " + heads.join(" | "));
  // The photo and name bar opens the profile (signed-in view)
  await ev("document.getElementById('sbBackdrop').click();return 1"); await sleep(700);
  await ev("localStorage.setItem('stewardmd_account', JSON.stringify({ type: 'email', email: 'dr@example.com', name: 'Dr Test' }));return 1");
  await ev("var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1");
  ok(await waitFor("return !!document.querySelector('#smdSbProfile')", 6000), "the photo and name bar is in the sidebar");
  await ev("document.querySelector('#smdSbProfile').click();return 1");
  ok(await waitFor("return !!document.querySelector('#hvSheet .hv-pf, .hv-acct, .hub-hero')", 6000), "tapping the photo and name bar opens the profile page");
  await ev("localStorage.removeItem('stewardmd_account');return 1");
  await load();
  await ev("var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1");
  await waitFor("return document.querySelectorAll('#sbDrawer .sbr-row').length>0"); await sleep(400);

  // Each sidebar row goes where it should
  await ev("window.__calls=[];window.SMD_HELP=window.SMD_HELP||{};SMD_HELP.openCentre=function(){__calls.push('help')};window.SMD_TOUR=window.SMD_TOUR||{};SMD_TOUR.start=function(){__calls.push('tour')};var m=window.SMD_moreAct;window.SMD_moreAct=function(a){__calls.push('more:'+a);};window.__moreOrig=m;return 1");
  const sideClick = (act) => ev(`var b=document.querySelector('#sbDrawer [data-sbr-act="${act}"]');b&&b.click();return !!b`);
  await sideClick("help"); await sleep(500);
  ok(await ev("return __calls.indexOf('help')>=0"), "sidebar > Help & support opens the Help centre");
  await ev("var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1"); await waitFor("return document.querySelectorAll('#sbDrawer .sbr-row').length>0"); await sleep(300);
  await sideClick("tour"); await sleep(500);
  ok(await ev("return __calls.indexOf('tour')>=0"), "sidebar > App tour starts the tour");
  for (const act of ["subscription", "aiusage", "disclaimer", "privacy", "terms"]) {
    await ev("var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1"); await waitFor("return document.querySelectorAll('#sbDrawer .sbr-row').length>0"); await sleep(300);
    await sideClick(act); await sleep(400);
    ok(await ev(`return __calls.indexOf('more:${act}')>=0`), "sidebar > " + act + " goes to the shared handler");
  }
  await load();
  await ev("var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1"); await waitFor("return document.querySelectorAll('#sbDrawer .sbr-row').length>0"); await sleep(400);
  await sideClick("settings"); await waitFor("return !!document.querySelector('.sbr-set-ov')");
  ok(await ev("return !!document.querySelector('.sbr-set-ov')"), "sidebar > Settings opens the Settings page");
  await load();
  await ev("var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1"); await waitFor("return document.querySelectorAll('#sbDrawer .sbr-row').length>0"); await sleep(400);
  await sideClick("ack"); await sleep(900);
  ok(await ev("var m=document.getElementById('aboutModal');return !!m&&getComputedStyle(m).display!=='none'&&m.getClientRects().length>0"), "sidebar > About & Acknowledgements opens the About modal");
  await load();
  await ev("window.SMD_BUGS=window.SMD_BUGS||{};SMD_BUGS.unread=function(){return 3};var b=document.querySelector('[aria-label=Menu]');b&&b.click();return 1");
  await waitFor("return document.querySelectorAll('#sbDrawer .sbr-row').length>0"); await sleep(400);
  ok(/3 new/.test(await ev("var h=document.querySelector('#sbDrawer [data-sbr-act=help]');return h?h.textContent:''")), "the unread-replies count shows on sidebar > Help & support");
  await ev("document.getElementById('sbBackdrop').click();return 1"); await sleep(900);

  // More: Clinical only
  await openMore();
  const more = await moreLabels();
  for (const need of [/^Open shared case$/, /^Search Medical Register$/, /^Connect patient$/]) ok(more.some((l) => need.test(l.replace(/&amp;/g, "&"))), "More has " + need);
  for (const gone of [/^Profile$/, /^Subscription$/, /^AI Usage$/, /^Settings$/, /^Help/, /^App tour$/, /^About/, /disclaimer/i, /^Privacy/, /^Terms/]) ok(!more.some((l) => gone.test(l.replace(/&amp;/g, "&"))), "More no longer has " + gone);
  const headings = await ev("return JSON.stringify([].map.call(document.querySelectorAll('#hvSheet .hv-sheet-wrap > div[style*=uppercase]'),function(e){return e.textContent.trim()}))").then(JSON.parse);
  ok(headings.join("|") === "Clinical", "More is grouped: " + headings.join(" | "));
  const both = side.map(norm).filter((l) => more.map(norm).includes(l));
  ok(both.length === 0, "no label appears in both menus (" + both.join(", ") + ")");
} catch (e) { console.log("FAIL harness:", e && e.message); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
