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
// The Drug Database waits on network calls that are slow or blocked in some environments: poll, never guess.
const waitFor = async (expr, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } return false; };
// JSON.parse of a page result, naming the expression when the page answered "ERR:..." (a missing element).
const jp = async (expr) => { const r = await ev(expr); try { return JSON.parse(r); } catch (e) { throw new Error("page result was not JSON (" + String(r).slice(0, 140) + ") for: " + expr.slice(0, 110)); } };
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
  // A returning user (home is revealed under the splash, no intro poster): the launch morph can run.
  // A headless browser has no keyboard: stand in for visualViewport (installed before any page script) so the
  // module's real listeners can be driven. Everything else about the app is untouched.
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('stewardmd_guest_used','1')}catch(e){}" +
    "try{var f=new EventTarget();f.height=window.innerHeight;f.width=window.innerWidth;f.offsetTop=0;f.offsetLeft=0;f.pageTop=0;f.pageLeft=0;f.scale=1;Object.defineProperty(window,'visualViewport',{value:f,configurable:true});window.__vv=f;}catch(e){}" });
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 80; i++) { if (await ev("return !!(window.SMD_SPRING && window.SMD_liveActivity && document.getElementById('homeV2'))")) break; await sleep(200); }
  const morph = { seen: false, hidden: false, endW: 0 };
  for (let i = 0; i < 160; i++) {
    const r = await jp(`var cl=document.querySelector('img[aria-hidden=true][style*="2147483100"]');var h=document.querySelector('#homeV2 .rnav-brand img');return JSON.stringify({clone:!!cl,w:cl?Math.round(cl.getBoundingClientRect().width):0,hv:h?h.style.visibility:''})`);
    if (r.clone) { morph.seen = true; morph.endW = r.w; }
    if (r.hv === "hidden") morph.hidden = true;
    if (morph.seen && !r.clone) break;
    await sleep(60);
  }
  await sleep(300);
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
  await waitFor("return [].some.call(document.querySelectorAll('.db-comp'),function(b){return /Amiodarone/.test(b.textContent)})", 12000);
  await ev(`window.__vt=[];var o=document.startViewTransition.bind(document);document.startViewTransition=function(cb){var v=o(cb);__vt.push('start');v.updateCallbackDone.then(function(){var n=document.querySelector('[style*=view-transition-name]');__vt.push('hero:'+(n?n.textContent.trim():''))});v.finished.then(function(){__vt.push('finished')},function(){__vt.push('fin-err')});return v};return 1`);
  const r = await jp(`var b=[].slice.call(document.querySelectorAll('.db-comp')).filter(function(b){return /Amiodarone/.test(b.textContent)})[0];var r=b.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await waitFor("return __vt.indexOf('finished')>0 && !!document.querySelector('.db-gen')");
  await sleep(200);
  const vt = await jp("return JSON.stringify(__vt)");
  ok(vt[0] === "start" && vt.indexOf("finished") > 0, "tapping a row runs a view transition " + JSON.stringify(vt));
  ok(vt.some(s => s === "hero:Amiodarone"), "the row title morphs into the matching screen title");
  ok(await ev("return !!document.querySelector('.db-gen') && /Amiodarone/.test(document.querySelector('.db-gen').textContent)"), "the replayed click still opened the drug");
  ok(await ev("return !document.querySelector('[style*=view-transition-name]')"), "transition names are cleared afterwards");

  // 3. Large title (back to the list)
  await ev("MEDDB.close();return 1"); await sleep(400);
  await tab("/Drugs/"); await sleep(900); await sheetItem("/Drug Database/"); await waitFor("return !!document.querySelector('.db-bigt') && document.querySelectorAll('.db-comp').length>3");   // the list must be tall enough to scroll
  await ev("document.getElementById('dbBody').scrollTop=0;return 1"); await sleep(100);
  await ev("document.getElementById('dbBody').scrollTop=40;return 1"); await sleep(250);
  const lt = await jp("var t=document.querySelector('.db-bigt'),b=document.querySelector('.db-top');return JSON.stringify({op:t?t.style.opacity:'none',tf:t?t.style.transform:'',sh:b?b.style.boxShadow:''})");
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
  const hap = await jp("return JSON.stringify(__hap)");
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
  const pc = await jp("var r=document.getElementById('__pc').getBoundingClientRect();return JSON.stringify({x:r.left+60,y:r.top+16})");
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

  // ---- round 2 ----
  ok(await ev("return !!(window.SMD_SWIPE_SEAM && window.SMD_TABBAR_SEAM && window.SMD_AZ_SEAM && window.SMD_KB_SEAM && window.SMD_BLURUP_SEAM && window.SMD_MORPH_SEAM && window.SMD_SOUND && window.SMD_undo)"), "round 2 modules loaded from index.html");
  ok(morph.seen && morph.hidden, "launch: the splash logo flies to the header logo (header logo hidden during the flight)");
  ok(morph.endW > 0 && morph.endW < 60, "launch: it shrinks toward the header size (last seen width " + morph.endW + ")");
  ok(await ev("return document.querySelector('#homeV2 .rnav-brand img').style.visibility===''"), "launch: the header logo is visible again afterwards");

  // 9. Swipe actions
  await ev(`window.__hDrag=function(sel,x0,x1,steps,ms){var t=document.querySelector(sel);var r=t.getBoundingClientRect();var y=r.top+20;var tg=document.elementFromPoint(x0,y);function T(x){return new Touch({identifier:9,target:tg,clientX:x,clientY:y,pageX:x,pageY:y});}
    function fire(type,x){var tt=type==='touchend'?[]:[T(x)];tg.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:tt,targetTouches:tt,changedTouches:[T(x)]}));}
    fire('touchstart',x0);var i=0;(function nx(){i++;if(i>steps){fire('touchend',x1);return;}fire('touchmove',x0+(x1-x0)*i/steps);setTimeout(nx,ms);})();};
    var w=document.createElement('div');w.id='__sw';w.style.cssText='position:fixed;inset:0;z-index:30000;background:#f1f5f9;padding:80px 12px';
    w.innerHTML='<div id="__r1" style="background:#fff;border-radius:12px;padding:12px 14px" onclick="window.__sopen=(window.__sopen||0)+1"><div style="font-weight:700">Bed 12</div><button onclick="event.stopPropagation();window.__scall=(window.__scall||0)+1">Call</button> <button title="Remove" onclick="event.stopPropagation();window.__srm=(window.__srm||0)+1">x</button></div>';
    document.body.appendChild(w);return 1`);
  await sleep(150);
  await ev("__hDrag('#__r1',330,300,5,12);return 1"); await sleep(700);
  ok(!(await ev("return !!document.querySelector('[role=toolbar]')")), "a short swipe snaps back, no tray");
  await ev("__hDrag('#__r1',330,150,6,12);return 1"); await sleep(900);
  ok((await ev("return [].map.call(document.querySelectorAll('[role=toolbar] button'),function(b){return b.textContent}).join('|')")) === "Call|Remove", "a long left swipe reveals the row's own actions");
  ok((await ev("return (window.__sopen||0)+'/'+(window.__scall||0)+'/'+(window.__srm||0)")) === "0/0/0", "a swipe fires nothing by itself (no open, no call, no remove)");
  ok((await ev("return document.getElementById('__r1').style.transition")) === "none", "while open the row's own transform transition is off (no lag behind the finger)");
  await ev("[].filter.call(document.querySelectorAll('[role=toolbar] button'),function(b){return b.textContent==='Call'})[0].click();return 1"); await sleep(500);
  ok((await ev("return window.__scall||0")) === 1 && !(await ev("return !!document.querySelector('[role=toolbar]')")), "tapping an action presses the real control and closes the tray");
  ok((await ev("return document.getElementById('__r1').style.transition")) === "", "and the row's transition is handed back when it closes");
  await ev("document.getElementById('__sw').remove();return 1");

  // 10. Tab bar + status tap
  const tfv = () => ev("var b=document.querySelector('.rnav-tabbar');return b.style.transform");
  await ev("document.querySelector('.v3-main').scrollTop=200;return 1"); await sleep(120);
  await ev("document.querySelector('.v3-main').scrollTop=420;return 1"); await sleep(300);
  ok(/translateY\(100%\)/.test(await tfv()), "scrolling down slides the tab bar away");
  await ev("document.querySelector('.v3-main').scrollTop=380;return 1"); await sleep(300);
  ok((await tfv()) === "", "scrolling up brings it back");
  await ev("document.querySelector('.v3-main').scrollTop=700;return 1"); await sleep(300);
  await ev("window.dispatchEvent(new Event('statusTap'));return 1"); await sleep(1000);
  ok((await ev("return document.querySelector('.v3-main').scrollTop")) === 0, "the status-bar tap scrolls the list to the top");

  // 11. A-Z scrubber (Drug Database)
  await tab("/Drugs/"); await sleep(900); await sheetItem("/Drug Database/");
  const STRIP = "var s=document.querySelector('div[aria-hidden=true][style*=\"z-index: 2147482200\"]');return !!s&&s.style.opacity==='1'";
  await waitFor(STRIP);
  ok(await ev("var s=document.querySelector('div[aria-hidden=true][style*=\"z-index: 2147482200\"]');return !!s&&s.style.opacity==='1'"), "the A-Z strip appears on the Drug Database");
  await ev("window.__az=0;window.SMD_HAPTICS=Object.assign({},window.SMD_HAPTICS||{},{selection:function(){__az++}});return 1");
  const sr = await jp("var s=document.querySelector('div[aria-hidden=true][style*=\"z-index: 2147482200\"]').getBoundingClientRect();return JSON.stringify({x:s.left+11,top:s.top,h:s.height})");
  const ay = (L) => sr.top + 6 + (sr.h - 12) * ("ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(L) + 0.5) / 26;
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: sr.x, y: ay("C"), button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: sr.x, y: ay("M"), button: "left", buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: sr.x, y: ay("M") + 1, button: "left", buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: sr.x, y: ay("M"), button: "left", clickCount: 1 });
  const gotM = await waitFor("var b=document.querySelector('.db-comp .db-comp-name');return !!b&&/^M/.test(b.textContent)", 12000);
  ok((await ev("return __az")) >= 2, "sliding ticks a haptic per letter");
  ok(gotM, "releasing on M shows the M molecules");
  await ev("MEDDB.close();return 1"); await sleep(1300);
  ok(await ev("var s=document.querySelector('div[aria-hidden=true][style*=\"z-index: 2147482200\"]');return s.style.opacity==='0'"), "the strip goes away with the screen");

  // 12. Keyboard-aware (visualViewport stubbed above)
  await ev(`var w=document.createElement('div');w.id='__kbw';w.style.cssText='position:fixed;inset:0;z-index:30000;background:#fff;overflow:auto';
    w.innerHTML='<div style="height:1400px;position:relative"><input id="__kin" style="position:absolute;top:660px;left:20px;width:300px;height:40px"></div><div id="__kbar" style="position:fixed;left:0;right:0;bottom:0;height:64px;background:#0f766e"><button>Save</button></div>';
    document.body.appendChild(w);document.getElementById('__kin').focus();return 1`);
  await ev("__vv.height=innerHeight-320;__vv.dispatchEvent(new Event('resize'));return 1");
  await sleep(1400);
  const kb = await jp("var r=document.getElementById('__kin').getBoundingClientRect();return JSON.stringify({v:document.documentElement.style.getPropertyValue('--smd-kb'),bottom:Math.round(r.bottom),vis:innerHeight-320,bar:document.getElementById('__kbar').style.transform})");
  ok(kb.v === "320px", "keyboard: --smd-kb is published (" + kb.v + ")");
  ok(kb.bottom <= kb.vis - 10 && kb.bottom > 0, "keyboard: the covered field is scrolled into the visible area " + JSON.stringify(kb));
  ok(/translate3d\(0px, -320px/.test(kb.bar), "keyboard: the pinned bar rides above the keyboard");
  await ev("__vv.height=innerHeight;__vv.dispatchEvent(new Event('resize'));return 1");
  await sleep(900);
  ok((await ev("return document.getElementById('__kbar').style.transform")) === "" && (await ev("return document.documentElement.style.getPropertyValue('--smd-kb')")) === "0px", "keyboard: everything settles back when it closes");
  await ev("document.getElementById('__kbar').style.transform='translateY(-5px)';__vv.height=innerHeight-320;__vv.dispatchEvent(new Event('resize'));return 1");
  await sleep(1000);
  ok((await ev("return document.getElementById('__kbar').style.transform")) === "translateY(-5px)", "keyboard: a bar that moves itself is left alone");
  await ev("__vv.height=innerHeight;__vv.dispatchEvent(new Event('resize'));document.getElementById('__kbw').remove();return 1");

  // 13. Undo card
  await ev("window.__did=0;window.__undid=0;SMD_undo.run({message:'Removed',perform:function(){__did++},restore:function(){__undid++}});return 1"); await sleep(900);
  const up = await jp("var b=document.querySelector('[data-dn-action]').getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})");
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: up.x, y: up.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: up.x, y: up.y, button: "left", clickCount: 1 });
  await sleep(300);
  ok((await ev("return __did+'/'+__undid")) === "1/1", "Undo: performs now, the Undo button restores it");
  await ev("localStorage.setItem('smd_undo','0');return 1");
  ok((await ev("return SMD_undo.run({message:'x',perform:function(){},restore:function(){}})")) === false, "Undo: kill switch returns false so the caller keeps its confirm()");
  await ev("localStorage.removeItem('smd_undo');return 1");

  // 14. Blur-up
  await call("Network.enable");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 700, downloadThroughput: 200000, uploadThroughput: 200000 });
  await ev("var d=document.createElement('div');d.id='__bu';d.style.cssText='position:fixed;top:80px;left:10px;z-index:30000;background:#fff';document.body.appendChild(d);var i=new Image();i.id='__img';i.style.cssText='width:300px';d.appendChild(i);i.src='/clinix-pallor.jpg?bu='+Date.now();return 1");
  await sleep(150);
  ok((await ev("return document.getElementById('__img').style.opacity")) === "0", "an image still loading stays hidden (no half-painted frame)");
  await sleep(3500);
  ok((await ev("return document.getElementById('__img').style.opacity")) === "" && (await ev("return document.getElementById('__img').naturalWidth")) > 0, "and is revealed once it has arrived");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev("document.getElementById('__bu').remove();return 1");

  // 15. Sounds: off by default, silent when off, plays when on, toggle in Settings
  await ev(`window.__osc=0;(function(){var P=(window.AudioContext||window.webkitAudioContext).prototype,o=P.createOscillator;P.createOscillator=function(){__osc++;return o.apply(this,arguments)}})();return 1`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 400, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 400, button: "left", clickCount: 1 });
  await ev("SMD_SOUND.play('success');return 1"); await sleep(150);
  ok((await ev("return localStorage.getItem('smd_sound')")) !== "1" && (await ev("return __osc")) === 0, "sounds are off by default and silent");
  await ev("SMD_SOUND.setEnabled(true);return 1");
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 400, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 400, button: "left", clickCount: 1 });
  await sleep(100);
  await ev("SMD_SOUND.play('success');return 1"); await sleep(200);
  ok((await ev("return __osc")) >= 2, "when enabled, a success plays (2 notes) " + (await ev("return __osc")));
  await ev("SMD_dynNotify.fromText('Saved to your notes');return 1"); await sleep(300);
  ok((await ev("return __osc")) >= 4, "a success card plays its note");
  await ev("SMD_dynNotify.dismiss();SMD_SOUND.setEnabled(false);return 1"); await sleep(900);
  await tab("/More/"); await sleep(900);
  // Display & Accessibility is reached through More > Settings > Appearance & Theme (menus de-duplicated 2026-10-12).
  await ev("var b=[].slice.call(document.querySelectorAll('#hvSheet .hv-mi')).filter(function(b){return /^Settings/.test(b.textContent)})[0]; b&&b.click(); return 1");
  await waitFor("return !!document.querySelector('.sbr-set-ov')"); await sleep(500);
  await ev("var b=[].slice.call(document.querySelectorAll('.sbr-set-ov .smd-nav-row, .sbr-set-ov .sbr-row, .sbr-set-ov button')).filter(function(b){return /^Appearance/.test(b.textContent.trim())&&b.getClientRects().length})[0]; b&&b.click(); return 1");
  await waitFor("return !!document.getElementById('hvSounds')");
  ok(await ev("return !!document.getElementById('hvSounds')"), "More > Settings > Appearance & Theme (Display & Accessibility) has the Sounds switch");
  await ev("document.getElementById('hvSounds').click();return 1"); await sleep(200);
  ok((await ev("return localStorage.getItem('smd_sound')")) === "1" && (await ev("return document.getElementById('hvSounds').classList.contains('on')")), "the switch turns sounds on");
  await ev("localStorage.removeItem('smd_sound');return 1");

  // 16. Touch targets: the home header icons and legal links are hit beyond their visible box
  // Closing the Display sheet returns to the Settings page it was opened from (onClose), so close the sheet first, then the page.
  await ev("var sc=document.getElementById('hvScrim');if(sc)sc.click();return 1"); await sleep(900);
  await ev("[].forEach.call(document.querySelectorAll('.sbr-set-ov'),function(e){e.remove()});return 1"); await sleep(500);
  await ev("document.querySelector('.v3-main').scrollTop=0;return 1"); await sleep(300);
  ok(await ev(`var b=document.querySelector('#homeV2 .rnav-head .rds-icon-btn'),r=b.getBoundingClientRect(),cy=r.top+r.height/2;
    return [document.elementFromPoint(r.left-4,cy),document.elementFromPoint(r.left+r.width/2,r.top-3),document.elementFromPoint(r.left+r.width/2,r.bottom+3)].every(function(e){return e&&e.closest('.rds-icon-btn')===b})`), "the first header icon is hit 4px beyond its visible box (touch target >= 44pt)");
  ok(await ev(`var a=document.querySelector('#homeV2 .v4-legal a');a.scrollIntoView({block:'center'});var r=a.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top-12)===a&&document.elementFromPoint(r.left+r.width/2,r.bottom+12)===a`), "legal footer links have a 44pt tall hit area");

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
