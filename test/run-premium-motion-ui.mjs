/* The premium motion layer in the REAL app (index.html, every module loaded by its own tag), in a
 * headless browser with touch emulation: sheet drag + depth, shared-element view transitions,
 * large titles, pull to refresh, picker haptics, skeletons, long-press previews, Live Activity bridge.
 * Flicks are dispatched in-page (CDP round trips are ~70ms apart, too slow to be a flick).
 *
 * USAGE: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-premium-motion-ui.mjs */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PORT = 9412, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pm-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8994"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-sandbox", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const exc = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const tab = (re) => ev(`[].slice.call(document.querySelectorAll('.rnav-tab')).filter(function(b){return ${re}.test(b.textContent)})[0].click(); return 1`);
const sheetItem = (re) => ev(`[].slice.call(document.querySelectorAll('.hv-sheet button, .hv-sheet .hv-mi')).filter(function(b){return ${re}.test(b.textContent)})[0].click(); return 1`);
const FASTDRAG = `window.__fastDrag=function(x,y0,y1,steps,ms){var t=document.elementFromPoint(x,y0);function T(y){return new Touch({identifier:7,target:t,clientX:x,clientY:y,pageX:x,pageY:y});}
function fire(type,y){var tt=type==='touchend'?[]:[T(y)];t.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:tt,targetTouches:tt,changedTouches:[T(y)]}));}
fire('touchstart',y0);var i=0;(function nx(){i++;if(i>steps){fire('touchend',y1);return;}fire('touchmove',y0+(y1-y0)*i/steps);setTimeout(nx,ms);})();};return 1`;

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") exc.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400)); };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  ({ result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }));
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 80; i++) { if (await ev("return !!(window.SMD_SPRING && window.SMD_liveActivity && document.getElementById('homeV2'))")) break; await sleep(200); }
  await sleep(2500);
  await ev(`["introPoster","splash","accountGate","introOverlay","harrisonQuotePopup"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await sleep(600);
  await ev(FASTDRAG);

  ok(await ev("return !!(window.SMD_SPRING && window.SMD_SHEET_DRAG_SEAM && window.SMD_VT_SEAM && window.SMD_LT_SEAM && window.SMD_PTR_SEAM && window.SMD_SKEL_SEAM && window.SMD_PEEK_SEAM && window.SMD_liveActivity)"), "all premium modules loaded from index.html");
  const ours = exc.filter(e => /smd-spring|sheet-drag|view-transitions|large-title|pull-refresh|picker-haptics|skeletons|long-press-preview|live-activities/.test(e));
  ok(ours.length === 0, "no page exceptions from the new modules" + (ours.length ? ": " + ours[0] : ""));

  // 1. Sheet drag + depth
  await tab("/More/"); await sleep(900);
  ok(/matrix\(0\.94/.test(await ev("return getComputedStyle(document.getElementById('homeV2')).transform")), "home recedes behind its sheet");
  await ev("__fastDrag(195,140,190,10,40);return 1"); await sleep(1000);
  ok(await ev("return document.getElementById('hvSheet').classList.contains('on') && document.getElementById('hvSheet').style.transform===''"), "a slow short pull springs the sheet back");
  await ev("__fastDrag(195,400,470,5,10);return 1"); await sleep(1100);
  ok(await ev("return !document.getElementById('hvSheet').classList.contains('on')"), "a flick down dismisses the sheet");
  ok(await ev("return getComputedStyle(document.getElementById('homeV2')).transform==='none'"), "home comes forward again");

  // 2. View transition: drug row -> detail
  await tab("/Drugs/"); await sleep(900); await sheetItem("/Drug Database/"); await sleep(2500);
  await ev(`window.__vt=[];var o=document.startViewTransition.bind(document);document.startViewTransition=function(cb){var v=o(cb);__vt.push('start');v.updateCallbackDone.then(function(){var n=document.querySelector('[style*=view-transition-name]');__vt.push('hero:'+(n?n.textContent.trim():''))});v.finished.then(function(){__vt.push('finished')},function(){__vt.push('fin-err')});return v};return 1`);
  const r = JSON.parse(await ev(`var b=[].slice.call(document.querySelectorAll('.db-comp')).filter(function(b){return /Amiodarone/.test(b.textContent)})[0];var r=b.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})`));
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(1300);
  const vt = JSON.parse(await ev("return JSON.stringify(__vt)"));
  ok(vt[0] === "start" && vt.indexOf("finished") > 0, "tapping a row runs a view transition " + JSON.stringify(vt));
  ok(vt.some(s => s === "hero:Amiodarone"), "the row title morphs into the matching screen title");
  ok(await ev("return !!document.querySelector('.db-gen') && /Amiodarone/.test(document.querySelector('.db-gen').textContent)"), "the replayed click still opened the drug");
  ok(await ev("return !document.querySelector('[style*=view-transition-name]')"), "transition names are cleared afterwards");

  // 3. Large title (back to the list)
  await ev("MEDDB.close();return 1"); await sleep(400);
  await tab("/Drugs/"); await sleep(900); await sheetItem("/Drug Database/"); await sleep(2500);
  await ev("document.getElementById('dbBody').scrollTop=0;return 1"); await sleep(100);
  await ev("document.getElementById('dbBody').scrollTop=40;return 1"); await sleep(250);
  const lt = JSON.parse(await ev("var t=document.querySelector('.db-bigt'),b=document.querySelector('.db-top');return JSON.stringify({op:t?t.style.opacity:'none',tf:t?t.style.transform:'',sh:b?b.style.boxShadow:''})"));
  ok(lt.op !== "" && Number(lt.op) < 1 && /scale/.test(lt.tf), "the large title shrinks and fades as it scrolls " + JSON.stringify(lt));
  ok(/rgba/.test(lt.sh), "the bar draws its hairline once content is under it");
  await ev("MEDDB.close();return 1"); await sleep(400);

  // 4. Pull to refresh (Alerts)
  await ev("document.getElementById('v3BellBtn').click();return 1"); await sleep(1500);
  await ev("window.__ref=0;document.getElementById('ntfRefresh').addEventListener('click',function(){__ref++});return 1");
  await ev("__fastDrag(195,141,201,6,16);return 1"); await sleep(900);
  ok((await ev("return __ref")) === 0, "a short pull does not refresh");
  await ev("__fastDrag(195,141,401,12,16);return 1"); await sleep(2200);
  ok((await ev("return __ref")) === 1, "a long pull presses the screen's own Refresh once");
  await ev("var c=[].filter.call(document.querySelectorAll('button'),function(b){return /Close/.test(b.textContent)&&b.getClientRects().length})[0]; c&&c.click(); return 1"); await sleep(600);
  ok(!(await ev("return document.body.classList.contains('ntf-lock')")), "Alerts closed");

  // 5. Picker haptics
  await ev(`window.__hap={sel:0,light:0};window.SMD_HAPTICS=Object.assign({},window.SMD_HAPTICS||{},{selection:function(){__hap.sel++},light:function(){__hap.light++}});
    var i=document.createElement('input');i.type='range';i.min=0;i.max=10;i.step=1;i.value=5;i.id='__rng';document.body.appendChild(i);
    i.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    [5,6,6,7,10].forEach(function(v){i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}))});return 1`);
  const hap = JSON.parse(await ev("return JSON.stringify(__hap)"));
  ok(hap.sel === 2 && hap.light === 1, "a slider ticks once per step, firmer at the end " + JSON.stringify(hap));

  // 6. Skeletons
  await ev(`var d=document.createElement('div');d.id='__sk';d.style.cssText='position:fixed;top:80px;left:16px;right:16px;z-index:99999;background:#fff';d.innerHTML='<div id="__ph">Loading ward patients…</div>';document.body.appendChild(d);return 1`);
  await sleep(200);
  ok(await ev("return document.getElementById('__ph').classList.contains('smd-skel-host') && document.getElementById('__ph').getAttribute('aria-busy')==='true'"), "a Loading placeholder becomes a skeleton (still announced)");
  await ev("document.getElementById('__sk').innerHTML='<div class=__row>A</div><div class=__row>B</div>';return 1"); await sleep(40);
  ok((await ev("return document.getAnimations().filter(function(a){return a.effect&&a.effect.target&&a.effect.target.className==='__row'}).length")) === 2, "arriving content fades in");
  await ev("document.getElementById('__sk').remove();return 1");

  // 7. Long-press preview
  await ev(`var w=document.createElement('div');w.id='__lp';w.style.cssText='position:fixed;inset:0;z-index:30000;background:#f8fafc;padding:80px 12px';
    w.innerHTML='<div id="__pc" style="background:#fff;border-radius:12px;padding:12px 14px" onclick="window.__open=(window.__open||0)+1"><div style="font-weight:700">Bed 12</div><div>Medicine</div><button onclick="event.stopPropagation();window.__call=(window.__call||0)+1">Call</button></div>';
    document.body.appendChild(w);return 1`);
  await sleep(150);
  const pc = JSON.parse(await ev("var r=document.getElementById('__pc').getBoundingClientRect();return JSON.stringify({x:r.left+60,y:r.top+16})"));
  await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pc.x, y: pc.y }] });
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1000);   // the tap ran a view transition (a row); input hit-tests to the root until it ends
  ok((await ev("return window.__open||0")) === 1 && !(await ev("return !!document.querySelector('[role=menu]')")), "a tap still opens the row, no menu");
  await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pc.x, y: pc.y }] });
  await sleep(700);
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(450);
  ok((await ev("return [].map.call(document.querySelectorAll('[role=menuitem]'),function(b){return b.textContent}).join('|')")) === "Open|Call", "press and hold lifts the row with its own actions");
  ok((await ev("return window.__open||0")) === 1, "the lifting finger does not also open the row");
  await ev("[].filter.call(document.querySelectorAll('[role=menuitem]'),function(b){return b.textContent==='Call'})[0].click();return 1"); await sleep(400);
  ok((await ev("return window.__call||0")) === 1 && !(await ev("return !!document.querySelector('[role=menu]')")), "choosing an action presses the real control and closes");
  await ev("document.getElementById('__lp').remove();return 1");

  // 8. Live Activity bridge (stubbed iOS plugin)
  await ev(`window.__la=[];window.Capacitor={isNativePlatform:function(){return true},getPlatform:function(){return 'ios'},Plugins:{WatchBridge:{
    clinicalActivityUpsert:function(p){__la.push('up:'+p.key+':'+p.title);return Promise.resolve({started:true})},
    clinicalActivityEnd:function(p){__la.push('end:'+p.key);return Promise.resolve({ended:true})}}}};
    var o={key:'opd-queue',title:'In consult',detail:'3 waiting',startedAt:1700000000000};
    SMD_liveActivity.upsert(o);SMD_liveActivity.upsert(o);SMD_liveActivity.end('opd-queue');SMD_liveActivity.end('opd-queue');return 1`);
  await sleep(100);
  ok((await ev("return __la.join(',')")) === "up:opd-queue:In consult,end:opd-queue", "Live Activity: unchanged facts are not re-sent, end is sent once");
} catch (e) { console.log("FAIL harness:", e && e.message); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
