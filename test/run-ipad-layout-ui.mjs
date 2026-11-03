/* test/run-ipad-layout-ui.mjs: whole-app iPad layout audit (owner 2026-11-03).
 * Pattern under test (from the Knowledge Library reader fix, knowledge-library.css
 * @media (min-width:700px) for #dxOverlay #dxMgmt.dx-reader): the SCROLL CONTAINER
 * spans the full screen width (scrollbar at the screen edge) and the readable
 * content inside it is a centred column (about 960px for text, wider for grids).
 * At 820x1180, 1024x1366 and 1366x1024 (mobile:true, deviceScaleFactor:2) this
 * asserts per screen: scroller spans the viewport, no horizontal page scroll,
 * nothing clipped past the right edge unless inside its own sideways-scrolling
 * box, and the main column is 600-1100px (text) / at least 600px (grid).
 * USAGE: node test/run-ipad-layout-ui.mjs [screen,screen,...]
 *   SHOTS=/tmp/ipad-audit/before (or after) saves a PNG per screen and size.
 *   Screens that cannot open in the harness are reported SKIP, never PASS.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT || 9044), CDP = Number(process.env.CDP_PORT || 9444);
const SHOTS = process.env.SHOTS || "";
const SIZES = [[820, 1180], [1024, 1366], [1366, 1024]];
const ACT = (a) => `(function(){var b=document.createElement('button');b.setAttribute('data-act',${JSON.stringify(a)});b.style.cssText='position:fixed;left:-50px;top:0;width:1px;height:1px';document.getElementById('homeV2').appendChild(b);b.click();b.remove();return 1})()`;
// name, open JS (null = home), scroller selector, column selector, kind: text|grid|dialog
const SCREENS = [
  ["home", null, ".hv-main", ".hv-stack", "grid"],
  ["maik", ACT("askai"), ".maik-body", ".maik-body", "text"],
  ["kb-library", "window.SMD_KB&&SMD_KB.open&&SMD_KB.open()", "#sbrefBody", "#sbrefBody", "grid"],
  ["kb-reader", "DX.openRef('MENINGITIS',{from:'knowledge-library'})", "#dxMgmt .dx-mgmt-body", "#dxMgmt .dx-reader-hero", "text"],
  ["kb-protocols", ACT("guidelines"), "#sbrefBody", "#sbrefBody", "grid"],
  ["clinix", ACT("clinix"), ".cx-scroll", ".cx-scroll", "grid"],
  ["prep-home", "window.PREP&&PREP.open&&PREP.open()", ".pn-body", ".pn-body", "grid"],
  ["tokos", ACT("tokos"), ".sp-scroll", ".sp-col", "grid"],
  ["ophthalmos", ACT("ophthalmos"), ".oph-scroll", ".oph-scroll", "grid"],
  ["narke", ACT("narke"), ".sp-scroll", ".sp-col", "grid"],
  ["kardia", ACT("kxlearn"), ".sp-scroll", ".sp-col", "grid"],
  ["radioanatome", ACT("atlas"), ".atlas-scroll", ".atlas-scroll", "grid"],
  ["icu", ACT("icu"), ".icu-scroll", ".icu-scroll", "grid"],
  ["surgx", ACT("surgx"), ".sgx-scroll", ".sgx-scroll", "grid"],
  ["wardsynq", ACT("wardsynq"), "#smdWard", "#smdWard", "grid"],
  ["opd-queue", ACT("queue"), "#smdQueue", "#smdQueue", "grid"],
  ["followcare", ACT("followcare"), ".fc-bd,.fc-ov", ".fc-bd", "text"],
  ["calculators", "window.MEDCALC&&MEDCALC.openList&&MEDCALC.openList()", ".mc-body", ".mc-body", "grid"],
  ["drug-index", "window.MEDDB&&MEDDB.openList&&MEDDB.openList()", "#dbOverlay .db-body,#dbOverlay", "#dbOverlay", "grid"],
  ["settings", "window.SMD_openSettings&&SMD_openSettings()", ".sbr-set-body,.hv-sheet", ".sbr-set-body,.hv-sheet-wrap", "text"],
  ["paywall", "window.SMD_PRO&&SMD_PRO.openPaywall&&SMD_PRO.openPaywall()", "#proPay > div", "#proPay > div", "dialog"],
  ["specialty-kits", ACT("speckit"), "#smdKitHost", "#smdKitHost", "grid"],
  ["icd", ACT("icdsearch"), ".icd-body", ".icd-body", "text"],
  ["thorex", ACT("thorex"), "#thorexRoot", "#thorexRoot", "grid"],
  ["sknx", ACT("sknx"), "#sknxRoot", "#sknxRoot", "grid"],
  ["pglog", ACT("pglog"), ".pgl-scroll", ".pgl-wrap", "text"],
];
const only = (process.argv[2] || "").split(",").filter(Boolean);
const screens = only.length ? SCREENS.filter(([n]) => only.includes(n)) : SCREENS;

const server = spawn("node", [repo + "test/serve.mjs", repo, String(PORT)], { stdio: "ignore" });
const chrome = spawn(process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/ipad-layout-chrome-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let ws, sid, id = 0, failures = 0, skips = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return undefined; return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? "PASS" : "FAIL"} ${label}`); if (!pass) failures++; };
async function shot(name) { if (!SHOTS) return; await sleep(250); await mkdir(SHOTS, { recursive: true }); const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) await writeFile(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, "base64")); }
async function boot() {
  await call("Page.navigate", { url: `http://localhost:${PORT}/?tour=0&prep=1&clinix=1&kardia=1&maik=1` });
  for (let i = 0; i < 100; i++) { if (await ev("!!document.getElementById('homeV2')")) break; await sleep(200); }
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');1`);
  await sleep(600);
}
const MEASURE = (scrollerSel, colSel) => `(()=>{const W=innerWidth;
  const pick=s=>{for(const el of document.querySelectorAll(s)){const b=el.getBoundingClientRect(),st=getComputedStyle(el);if(b.width>40&&b.height>40&&st.display!=='none'&&st.visibility!=='hidden')return el}return null};
  const sc=pick(${JSON.stringify(scrollerSel)}), col=pick(${JSON.stringify(colSel)});
  const clipped=[];document.querySelectorAll('body *').forEach(n=>{const b=n.getBoundingClientRect(),st=getComputedStyle(n);if(!b.width||st.display==='none'||st.visibility==='hidden'||b.right<=W+1||b.left>=W-1||b.bottom<0||b.top>innerHeight*2)return;let p=n.parentElement,off=false;while(p&&p!==document.body){const s=getComputedStyle(p),pr=p.getBoundingClientRect();if(p.getAttribute('aria-hidden')==='true'||p.hasAttribute('inert')||s.visibility==='hidden'||pr.left>=W-1){off=true;break}if(/auto|scroll/.test(s.overflowX)&&p.scrollWidth>p.clientWidth&&pr.right<=W+1)return;p=p.parentElement}if(off)return;clipped.push(n.tagName+'.'+String(n.className.baseVal??n.className).slice(0,28)+'@'+Math.round(b.right))});
  const sb=sc?sc.getBoundingClientRect():null, cb=col?col.getBoundingClientRect():null;
  const cst=col?getComputedStyle(col):null, colTextW=cb?Math.round(cb.width-(parseFloat(cst.paddingLeft)||0)-(parseFloat(cst.paddingRight)||0)):0;
  return JSON.stringify({W,page:document.documentElement.scrollWidth<=W+1,scW:sb?Math.round(sb.width):0,scL:sb?Math.round(sb.left):-1,scR:sb?Math.round(W-sb.right):-1,colW:cb?Math.round(cb.width):0,colTextW,colL:cb?Math.round(cb.left):-1,colR:cb?Math.round(W-cb.right):-1,clipped:clipped.slice(0,5),nClipped:clipped.length,hasSc:!!sc,hasCol:!!col})})()`;

try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!version) throw new Error("Chrome CDP did not start (needs a local listening socket; sandboxed runs cannot open one)");
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.confirm=function(){return true};try{localStorage.setItem("smd_onboarding_tour","0")}catch(e){}` });
  const results = [];
  for (const [name, open, scrollerSel, colSel, kind] of screens) {
    for (const [w, h] of SIZES) {
      await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
      await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await boot();
      if (open) { await ev(`(function(){try{return (${open})}catch(e){return 0}})()`); await sleep(2800); }
      const raw = await ev(MEASURE(scrollerSel, colSel));
      const tag = `${name} @${w}x${h}`;
      if (!raw) { console.log(`SKIP ${tag}: measure failed`); skips++; results.push({ name, w, h, skip: true }); continue; }
      const m = JSON.parse(raw);
      if (!m.hasSc) { console.log(`SKIP ${tag}: scroller ${scrollerSel} not open`); skips++; results.push({ name, w, h, skip: true, ...m }); await shot(`${name}-${w}x${h}`); continue; }
      if (kind !== "dialog") ok(m.scW >= w - 2 && m.scL <= 2 && m.scR <= 2, `${tag}: scroller spans viewport (${m.scW}px, L${m.scL} R${m.scR})`);
      ok(m.page, `${tag}: no horizontal page scroll`);
      ok(m.nClipped === 0, `${tag}: nothing clipped past right edge ${m.nClipped ? JSON.stringify(m.clipped) : ""}`);
      if (m.hasCol && kind === "text") ok(m.colTextW >= 600 && m.colTextW <= 1100, `${tag}: text column 600-1100px (${m.colTextW}px)`);
      else if (m.hasCol && kind === "grid") ok(m.colW >= 600, `${tag}: grid column at least 600px (${m.colW}px, not a phone box)`);
      else if (m.hasCol && kind === "dialog") ok(m.colW <= 700, `${tag}: dialog stays a dialog (${m.colW}px)`);
      results.push({ name, w, h, ...m });
      await shot(`${name}-${w}x${h}`);
    }
  }
  if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await writeFile(`${SHOTS}/measurements.json`, JSON.stringify(results, null, 1)); }
  console.log(failures ? `${failures} failures, ${skips} skips` : `All iPad layout checks pass (${skips} skips)`);
} catch (e) { console.error(e); failures++; } finally { ws?.close(); chrome.kill(); server.kill(); process.exitCode = failures ? 1 : 0; }
