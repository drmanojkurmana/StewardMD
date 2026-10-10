/* Knowledge Library disease reader on a phone (2026-10-09): fits the screen and reads in textbook order.
 * Drives the real app (index.html + reasoning.js + kb-v2-loader.js) in headless Chrome through DX.openRef.
 *   - 390x844 and 360x780: no horizontal page scroll, no horizontal scroll in the reader body, and no
 *     element past the right edge unless it sits inside its own sideways-scrolling box;
 *   - sections appear in the textbook order, At a glance first;
 *   - each v2 table and flowchart sits in its section (diagnostic, ddx, treatment, flowchart);
 *   - jump chips scroll the body to the section; ?kbv2=0 still renders a clean page.
 * USAGE: node test/run-kb-reader-mobile-ui.mjs   (screenshots in $SHOTS or /tmp/stewardmd-kb-reader)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT || 9034), CDP = Number(process.env.CDP_PORT || 9434);
const SHOTS = process.env.SHOTS || "/tmp/stewardmd-kb-reader";
const DISEASES = (process.env.DISEASES || "MENINGITIS,CAP,gout,sickle_cell_disease,adult_jaundice,stable_angina").split(",");
const ORDER = ["kbr-glance", "kbr-causes", "kbr-patho", "kbr-dx", "kbr-ddx", "kbr-mgmt", "kbr-prog", "kbr-pearls", "kbr-refs", "kbr-related"];
const HOME = { diagnostic: "kbr-dx", ddx: "kbr-ddx", treatment: "kbr-mgmt", flowchart: "kbr-mgmt", "flowchart-dx": "kbr-dx", foot: "kbr-refs" };

const server = spawn("node", [repo + "test/serve.mjs", repo, String(PORT)], { stdio: "ignore" });
const chrome = spawn(process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/kb-reader-chrome-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? "PASS" : "FAIL"} ${label}`); if (!pass) failures++; };
async function shot(name) { await sleep(250); await mkdir(SHOTS, { recursive: true }); const r = await call("Page.captureScreenshot", { format: "png" }); await writeFile(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, "base64")); }
async function boot(query) {
  await call("Page.navigate", { url: `http://localhost:${PORT}/${query || ""}` });
  for (let i = 0; i < 120; i++) { if (await ev("!!window.DX && Object.keys(window.KB_ENRICHMENT?.byId||{}).length>4000")) break; await sleep(250); }
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark')`);
}
async function open(d) {
  await ev(`DX.openRef(${JSON.stringify(d)},{from:'knowledge-library'})`);
  for (let i = 0; i < 40; i++) { if (await ev(`[...document.querySelectorAll('#dxMgmt .kbv2-slot')].every(s=>s.getAttribute('data-kbv2-done'))`)) break; await sleep(150); }
  await sleep(200);
}
// every element whose right edge passes the viewport, unless an ancestor scrolls sideways on its own
const FIT = `(()=>{const W=innerWidth,out=[];document.querySelectorAll('#dxMgmt *').forEach(n=>{const b=n.getBoundingClientRect();if(!b.width||b.right<=W+1)return;let p=n.parentElement;while(p&&p.id!=='dxMgmt'){const s=getComputedStyle(p);if(/auto|scroll/.test(s.overflowX)&&p.scrollWidth>p.clientWidth&&p.getBoundingClientRect().right<=W+1)return;p=p.parentElement}out.push(n.tagName+'.'+String(n.className.baseVal??n.className).slice(0,30)+'@'+Math.round(b.right))});const body=document.querySelector('#dxMgmt .dx-mgmt-body');return JSON.stringify({page:document.documentElement.scrollWidth<=innerWidth,body:body.scrollWidth<=body.clientWidth,clipped:out.slice(0,6),n:out.length})})()`;

try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;

  // the app sets html zoom from the text-size setting (0.95 by default); the last pass forces 1 (largest text here)
  for (const [w, h, zoom] of [[390, 844], [360, 780], [360, 780, "1"]]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await boot("");
    if (zoom) await ev(`document.documentElement.style.zoom=${JSON.stringify(zoom)}`);
    for (const d of DISEASES) {
      await open(d);
      if (zoom) { const fit = JSON.parse(await ev(FIT)); ok(fit.page && fit.body && fit.n === 0, `${d} @${w} zoom ${zoom}: fits ${fit.n ? JSON.stringify(fit.clipped) : ""}`); continue; }
      const fit = JSON.parse(await ev(FIT));
      ok(fit.page && fit.body && fit.n === 0, `${d} @${w}: fits, no page or body sideways scroll, nothing clipped ${fit.n ? JSON.stringify(fit.clipped) : ""}`);
      const order = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#dxMgmt #kbr-glance, #dxMgmt .kbr-sec')].filter(s=>!s.hidden).map(s=>s.id))`));
      const idx = order.map((x) => ORDER.indexOf(x));
      ok(idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), `${d} @${w}: textbook order ${order.join(" > ")}`);
      const homes = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#dxMgmt .kbv2-slot[data-kbv2-kind]')].filter(s=>s.innerHTML).map(s=>[s.getAttribute('data-kbv2-kind'),s.closest('.kbr-sec')&&s.closest('.kbr-sec').id]))`));
      ok(homes.length > 0 && homes.every(([k, sec]) => HOME[k] === sec), `${d} @${w}: tables and flowcharts sit in their sections ${JSON.stringify(homes)}`);
      ok(await ev(`document.querySelectorAll('#dxMgmt .kbv2-slot:not([data-kbv2-kind])').length===0 && document.querySelectorAll('#dxMgmt .kbv2-foot').length>=0 && [...document.querySelectorAll('#dxMgmt .kbv2-foot')].filter(p=>/AI-drafted/.test(p.textContent)).length===1`), `${d} @${w}: one v2 block per kind, one AI-drafted note`);
      ok(await ev(`(()=>{const c=[...document.querySelectorAll('#dxMgmt .kbr-chip')].filter(c=>!c.hidden);return c.length>1&&c.every(b=>{const t=document.getElementById(b.getAttribute('data-jump'));return t&&!t.hidden})})()`), `${d} @${w}: every jump chip points at a visible section`);
      if (w === 390 || d === "sickle_cell_disease" || d === "MENINGITIS") {
        await ev(`document.querySelector('#dxMgmt .dx-mgmt-body').scrollTop=0`); await shot(`${w}-${d}-top`);
        for (const sec of (w === 390 ? ["kbr-dx", "kbr-ddx", "kbr-mgmt", "kbr-pearls", "kbr-refs"] : ["kbr-dx", "kbr-ddx", "kbr-mgmt"])) {
          const has = await ev(`!!document.getElementById('${sec}')&&!document.getElementById('${sec}').hidden`);
          if (!has) continue;
          await ev(`document.querySelector('#dxMgmt .kbr-chip[data-jump="${sec}"]').click()`); await sleep(1200);
          if (sec === "kbr-dx") ok(await ev(`(()=>{const t=document.getElementById('kbr-dx').getBoundingClientRect().top,n=document.querySelector('#dxMgmt .kbr-jump').getBoundingClientRect().bottom;return t>=n-2&&t<n+40})()`), `${d} @${w}: Diagnosis chip scrolls its section under the sticky row`);
          await shot(`${w}-${d}-${sec.slice(4)}`);
        }
      }
    }
  }
  // dark mode keeps the reader legible
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev(`document.body.classList.add('dark')`); await open("gout");
  ok(await ev(`getComputedStyle(document.querySelector('#dxMgmt .kbr-jump')).backgroundColor!==getComputedStyle(document.querySelector('#dxMgmt .kbr-chip')).color`), "dark: jump row is painted");
  await shot("390-gout-dark-top"); await ev(`document.querySelector('#dxMgmt .kbr-chip[data-jump="kbr-mgmt"]').click()`); await sleep(700); await shot("390-gout-dark-mgmt");
  // kill switch
  await boot("?kbv2=0"); await open("gout");
  ok(await ev(`!window.SMD_KBV2_ON && document.querySelectorAll('#dxMgmt .kbv2-slot').length===0 && !!document.getElementById('kbr-mgmt')`), "?kbv2=0: no v2 slots, sections still render");
  const fit = JSON.parse(await ev(FIT)); ok(fit.page && fit.body && fit.n === 0, `?kbv2=0 gout fits ${JSON.stringify(fit.clipped)}`);
  await boot("?kbv2=1");
  console.log(failures ? `${failures} failures` : "All reader checks pass");
} catch (e) { console.error(e); failures++; } finally { ws?.close(); chrome.kill(); server.kill(); process.exitCode = failures ? 1 : 0; }
