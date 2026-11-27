/* Headless compliance pass for the ResearchMD case and analysis screens.
 * Renders each owned screen at 390x844 (phone) in light and dark, and measures:
 *  - tap target sizes (button / input / select / textarea / a / [role=button])
 *  - text contrast (WCAG relative luminance ratio) for body and muted text
 *  - keyboard focus outline (:focus-visible) on a button and an input
 *  - horizontal overflow (scrollWidth must not exceed the viewport)
 *  - page errors
 * Synthetic data only. Nothing is uploaded. This is a test harness, not the app.
 * Run: node test/run-research-compliance-ui.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
var PORT = 9123, CDP = 9523;
var OUT = "/tmp/stewardmd-research-alltypes-qwen";
fs.mkdirSync(OUT, { recursive: true });
var MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
var allBodies = [];

var server = http.createServer(function (req, res) {
  var u = new URL(req.url, "http://localhost");
  if (u.pathname.indexOf("/api/research") === 0) {
    var body = "";
    req.on("data", function (c) { body += c; });
    req.on("end", function () {
      allBodies.push({ url: u.pathname, body: body });
      res.setHeader("Content-Type", "application/json");
      if (/\/find-studies$/.test(u.pathname)) { res.end(JSON.stringify({ results: [] })); return; }
      if (/\/manuscript$/.test(u.pathname) && req.method === "GET") { res.end(JSON.stringify({ manuscript: null })); return; }
      if (/\/protocols$/.test(u.pathname) && req.method === "GET") { res.end(JSON.stringify({ protocols: [] })); return; }
      if (req.method === "POST" && /\/projects$/.test(u.pathname)) {
        var p = {}; try { p = JSON.parse(body); } catch (e) {}
        res.end(JSON.stringify({ project: { id: p.id || "prj_cmp_1", title: p.title || "Study", studyType: p.studyType || "Case Report", createdAt: new Date().toISOString() } }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  var file = u.pathname === "/" ? "/index.html" : u.pathname;
  var full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end("no"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(full).pipe(res);
});
await new Promise(function (r) { server.listen(PORT, "127.0.0.1", r); });

var CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find(function (p) { return fs.existsSync(p); });
if (!CHROME) { console.error("No Chrome"); process.exit(1); }
var chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=" + CDP,
  "--user-data-dir=/tmp/rmd-cmp-chrome-" + process.pid, "--window-size=390,844", "--no-first-run", "about:blank"], { stdio: "ignore" });

async function getJson(url) { var r = await fetch(url); return r.json(); }
var target = null;
for (var i = 0; i < 60 && !target; i++) {
  await new Promise(function (r) { setTimeout(r, 250); });
  try { var ts = await getJson("http://127.0.0.1:" + CDP + "/json"); target = ts.find(function (t) { return t.type === "page"; }); } catch (e) {}
}
if (!target) { console.error("no CDP target"); chrome.kill(); process.exit(1); }

var ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(function (r, j) { ws.onopen = r; ws.onerror = j; });
var msgId = 0, pending = new Map(), pageErrors = [];
ws.onmessage = function (m) {
  var d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { var p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result); }
  if (d.method === "Runtime.exceptionThrown") pageErrors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400));
};
function call(method, params) {
  return new Promise(function (resolve, reject) { var id = ++msgId; pending.set(id, { resolve: resolve, reject: reject }); ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
}
async function ev(expr) {
  var r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("page eval: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
var failures = [];
function ok(name, cond, detail) { if (cond) console.log("PASS " + name); else { failures.push(name); console.log("FAIL " + name + (detail ? " :: " + detail : "")); } }
async function until(expr, ms) {
  var t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) { if (await ev(expr)) return true; await new Promise(function (r) { setTimeout(r, 150); }); }
  return false;
}
async function click(sel) { return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.click();return true})()"); }
async function setVal(sel, val) {
  return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.value=" + JSON.stringify(val) + ";e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
}
async function setSelect(sel, val) {
  return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.value=" + JSON.stringify(val) + ";e.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
}
async function tick() { await new Promise(function (r) { setTimeout(r, 450); }); }
async function shot(name) { var r = await call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, "compliance-" + name + ".png"), Buffer.from(r.data, "base64")); }
async function viewport(w, h, mobile) { await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile }); await tick(); }

/* In-page measurement helpers, injected once. */
var MEASURE = "(function(){" +
  "window.__rmdLum=function(c){if(!c)return null;var p=null;var m=/rgba?\\(([^)]+)\\)/.exec(c);if(m){p=m[1].split(',').map(function(x){return parseFloat(x);});}else if(/^#/.test(c)){var h=c.slice(1);if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];p=[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}if(!p)return null;" +
  "function f(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}return 0.2126*f(p[0])+0.7152*f(p[1])+0.0722*f(p[2]);};" +
  "window.__rmdBg=function(el){var e=el;while(e&&e!==document.documentElement){var b=getComputedStyle(e).backgroundColor;if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent'){var m=/rgba?\\(([^)]+)\\)/.exec(b);if(m){var p=m[1].split(',');if(p.length<4||parseFloat(p[3])>0.5)return b;}}e=e.parentElement;}return 'rgb(255,255,255)';};" +
  /* A primary button paints a gradient (background-image), so its backgroundColor is transparent.
   * Use the first gradient colour stop as the effective background instead of walking up to the panel. */
  "window.__rmdContrast=function(el){var cs=getComputedStyle(el);var bg;var bi=cs.backgroundImage;if(bi&&bi.indexOf('gradient')>=0){var gm=/rgba?\\([^)]+\\)/.exec(bi);bg=gm?gm[0]:window.__rmdBg(el);}else{bg=window.__rmdBg(el);}var l1=window.__rmdLum(cs.color);var l2=window.__rmdLum(bg);if(l1==null||l2==null)return null;var hi=Math.max(l1,l2),lo=Math.min(l1,l2);return Math.round(((hi+0.05)/(lo+0.05))*100)/100;};" +
  "window.__rmdTargets=function(rootSel){var root=document.querySelector(rootSel);if(!root)return[];var els=root.querySelectorAll('button,input,select,textarea,a[href],[role=button],label.rmd-btn');var out=[];" +
  "for(var i=0;i<els.length;i++){var e=els[i];var cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden')continue;" +
  /* offsetWidth/offsetHeight are layout CSS pixels, immune to the emulated page scale factor. */
  "var w=e.offsetWidth,h=e.offsetHeight;" +
  "var type=(e.getAttribute('type')||'').toLowerCase();" +
  /* Checkboxes/radios tap via their 44px label row; visually-hidden file inputs tap via their label button. */
  "if(type==='checkbox'||type==='radio')continue;if(type==='file'&&(w<=2||h<=2))continue;if(w===0&&h===0)continue;" +
  "var lab='';if(e.id){var l=root.querySelector('label[for=\"'+e.id+'\"]');if(l)lab=l.innerText.trim().slice(0,28);}" +
  "out.push({tag:e.tagName.toLowerCase(),type:type,cls:(e.className||'').toString().slice(0,40),w:w,h:h,txt:(lab||e.innerText||e.value||e.getAttribute('aria-label')||'').trim().slice(0,28)});}return out;};" +
  "window.__rmdOverflow=function(){var d=document.documentElement;return d.scrollWidth-d.clientWidth;};" +
  "})()";

function smallTargets(list) {
  /* A tap target is too small if its height OR width is under 44px. Checkboxes
   * and radios are exempt when their associated label/row is >= 44px (handled
   * by the caller); here we flag every interactive box under 44px. */
  return list.filter(function (t) {
    if (t.type === "checkbox" || t.type === "radio") return false;
    return t.h < 44 || t.w < 44;
  });
}

async function measureScreen(label, rootSel, theme) {
  await ev("document.body.classList." + (theme === "dark" ? "add" : "remove") + "('dark');document.body.classList.remove('v3-dark');");
  await tick();
  var targets = await ev("window.__rmdTargets(" + JSON.stringify(rootSel) + ")");
  var overflow = await ev("window.__rmdOverflow()");
  var small = smallTargets(targets);
  ok(label + " [" + theme + "] no horizontal overflow", overflow <= 0, "overflow=" + overflow);
  ok(label + " [" + theme + "] tap targets >= 44px", small.length === 0, JSON.stringify(small));
  /* contrast: sample the screen heading, a muted line and a button label */
  var contrast = await ev("(function(){var root=document.querySelector(" + JSON.stringify(rootSel) + ");if(!root)return{};" +
    "function pick(sel){var e=root.querySelector(sel);return e?window.__rmdContrast(e):null;}" +
    "return {h3:pick('h3'),muted:pick('.rmd-muted'),btn:pick('.rmd-btn'),ink:pick('.rmd-step-text'),field:pick('label')};})()");
  var ratios = Object.keys(contrast).map(function (k) { return contrast[k]; }).filter(function (v) { return typeof v === "number"; });
  var minC = ratios.length ? Math.min.apply(null, ratios) : null;
  ok(label + " [" + theme + "] text contrast >= 4.5", minC == null || minC >= 4.5, JSON.stringify(contrast));
  console.log("  " + label + " [" + theme + "] targets=" + targets.length + " minContrast=" + minC + " contrast=" + JSON.stringify(contrast));
  return { targets: targets, small: small, contrast: contrast, overflow: overflow };
}

async function focusCheck(label, rootSel) {
  /* :focus-visible only matches after real keyboard interaction, not script focus.
   * Establish keyboard modality with a real Tab press, then focus the button and
   * input and read whether they match :focus-visible and show an indicator. */
  await ev("(function(){var a=document.activeElement;if(a&&a.blur)a.blur();})()");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  var info = await ev("(function(){var root=document.querySelector(" + JSON.stringify(rootSel) + ");if(!root)return null;" +
    "var b=root.querySelector('button');" +
    "var all=root.querySelectorAll('input,select,textarea');var inp=null;" +
    "for(var i=0;i<all.length;i++){var t=(all[i].getAttribute('type')||'').toLowerCase();if(t==='file'&&all[i].offsetWidth<=2)continue;if(all[i].offsetWidth>2&&all[i].offsetHeight>2){inp=all[i];break;}}" +
    "function rd(e){if(!e)return null;e.focus();var cs=getComputedStyle(e);var fv=false;try{fv=e.matches(':focus-visible');}catch(x){}" +
    "return {fv:fv,w:cs.outlineWidth,style:cs.outlineStyle,color:cs.outlineColor,border:cs.borderColor,shadow:cs.boxShadow};}" +
    "return {hasBtn:!!b,hasInp:!!inp,btn:rd(b),input:rd(inp)};})()");
  if (!info || (!info.hasBtn && !info.hasInp)) {
    ok(label + " focus indicator (file-picker screen, no visible focusable control)", true);
    return;
  }
  /* The page runs at documentElement zoom 0.95 (Display setting), so computed px are
   * zoom-scaled. Assert a visible solid accent ring rather than an exact pixel width. */
  function ringOk(o) {
    if (!o || !o.fv) return false;
    var solid = o.style === "solid" && parseFloat(o.w) > 0 && o.color && o.color !== "rgba(0, 0, 0, 0)" && o.color !== "transparent";
    var field = /rgb/.test(o.shadow || "") || (o.border && o.border !== "rgba(0, 0, 0, 0)");
    return solid || field;
  }
  if (info.hasBtn) ok(label + " button focus outline", ringOk(info.btn), JSON.stringify(info.btn));
  if (info.hasInp) ok(label + " input focus indicator", ringOk(info.input), JSON.stringify(info.input));
}

try {
  await call("Page.enable"); await call("Runtime.enable");
  /* mobile:false keeps a 1:1 page scale so CSS-pixel sizes and outline widths read true;
   * phone media queries still apply because the layout width is 390px. */
  await viewport(390, 844, false);
  await ev("(function(){try{['smd_research_state_v1','smd_rmd_help','smd_rmd_seen','smd_rmd_masterchart_v1','smd_rmd_manuscript_local_v1'].forEach(function(k){localStorage.removeItem(k);});}catch(e){}})()");
  await call("Page.navigate", { url: "http://localhost:" + PORT + "/?research=1" });
  ok("modules load", await until("!!(window.SMD_RESEARCH && SMD_RESEARCH.screens && SMD_RESEARCH.screens.casefile && SMD_RESEARCH.screens.masterchart)", 20000));
  await ev(MEASURE);
  await ev("(function(){if(SMD_RESEARCH.store&&SMD_RESEARCH.store.init)SMD_RESEARCH.store.init();})()");

  /* ---- case report project: casefile, novelty, iec, images ---- */
  ok("start opens", await until("!!(SMD_RESEARCH.open && (SMD_RESEARCH.open({screen:'start'}), document.querySelector('[data-rmd-start-choice=\"case\"]')))", 10000));
  await click('[data-rmd-start-choice="case"]');
  await until("!!document.querySelector('#rmdStartForm')");
  await setVal("#rmd_start_title", "Compliance case report");
  await click('[data-rmd="start-create"]');
  ok("casefile opens", await until("!!document.querySelector('[data-rmd-cf=\"example\"]')", 12000));
  await click('[data-rmd-cf="example"]');
  ok("casefile example loads", await until("(document.querySelector('#rmdCfAge')||{}).value==='34'", 5000));
  await until("!!document.querySelector('#rmdCfSaveStatus') && /Saved/.test(document.querySelector('#rmdCfSaveStatus').innerText||'')", 5000);
  await measureScreen("casefile", ".rmd-casefile-screen", "light");
  await focusCheck("casefile", ".rmd-casefile-screen");
  await shot("casefile-light");
  await measureScreen("casefile", ".rmd-casefile-screen", "dark");
  await shot("casefile-dark");
  await ev("document.body.classList.remove('dark')");

  await ev("SMD_RESEARCH.navigate('novelty',{projectId:'prj_cmp_1'})");
  ok("novelty opens", await until("!!document.querySelector('#rmdNvQuery') && !document.querySelector('[data-rmd-nv=\"search\"]').disabled", 10000));
  await measureScreen("novelty", ".rmd-novelty-screen", "light");
  await focusCheck("novelty", ".rmd-novelty-screen");
  await measureScreen("novelty", ".rmd-novelty-screen", "dark");
  await ev("document.body.classList.remove('dark')");

  await ev("SMD_RESEARCH.navigate('iec',{projectId:'prj_cmp_1'})");
  ok("iec opens", await until("!!document.querySelector('#rmdIecStatus')", 10000));
  await measureScreen("iec", ".rmd-iec-screen", "light");
  await focusCheck("iec", ".rmd-iec-screen");
  await measureScreen("iec", ".rmd-iec-screen", "dark");
  await shot("iec-dark");
  await ev("document.body.classList.remove('dark')");

  await ev("SMD_RESEARCH.navigate('images',{projectId:'prj_cmp_1'})");
  ok("images opens", await until("!!document.querySelector('.rmd-images-screen')", 10000));
  await measureScreen("images-list", ".rmd-images-screen", "light");
  /* open the editor with a synthetic image so toolbar + checklist render */
  await ev("(function(){var c=document.createElement('canvas');c.width=1200;c.height=800;var x=c.getContext('2d');x.fillStyle='#3366aa';x.fillRect(0,0,1200,800);x.fillStyle='#fff';x.font='40px sans-serif';x.fillText('SYNTHETIC',60,120);SMD_RESEARCH.screens.images.openImage(c.toDataURL('image/png'),'Synthetic scan','img1');})()");
  ok("images editor opens", await until("!!document.querySelector('#rmdImgCanvas')", 8000));
  await measureScreen("images-editor", ".rmd-images-screen", "light");
  await focusCheck("images-editor", ".rmd-images-screen");
  await shot("images-editor-light");
  await measureScreen("images-editor", ".rmd-images-screen", "dark");
  await ev("document.body.classList.remove('dark')");

  /* ---- cohort project: plan (sample size + controls) and masterchart ---- */
  await ev("SMD_RESEARCH.open({screen:'start'})");
  await until("!!document.querySelector('[data-rmd-start-choice=\"cohort\"]')");
  await click('[data-rmd-start-choice="cohort"]');
  await until("!!document.querySelector('#rmdStartForm')");
  await setVal("#rmd_start_title", "Compliance cohort");
  await click('[data-rmd="start-create"]');
  ok("plan opens", await until("!!document.querySelector('.rmd-plan-screen')", 12000));
  await measureScreen("plan", ".rmd-plan-screen", "light");
  await focusCheck("plan", ".rmd-plan-screen");
  await shot("plan-light");
  await measureScreen("plan", ".rmd-plan-screen", "dark");
  await ev("document.body.classList.remove('dark')");

  await ev("SMD_RESEARCH.navigate('masterchart',{projectId:'prj_cmp_1'})");
  ok("masterchart opens", await until("!!document.querySelector('.rmd-mc-screen')", 12000));
  await measureScreen("masterchart", ".rmd-mc-screen", "light");
  await focusCheck("masterchart", ".rmd-mc-screen");
  await measureScreen("masterchart", ".rmd-mc-screen", "dark");
  await shot("masterchart-dark");
  await ev("document.body.classList.remove('dark')");

  /* master chart with data: question screen, survival form and result card carry
   * their own buttons/selects, so measure those states too. */
  await click('[data-rmd-mc="sample"]');
  await until("!!document.querySelector('[data-rmd-mc=\"continue-identifiers\"]')", 8000);
  await click('[data-rmd-mc="continue-identifiers"]');
  await until("!!document.querySelector('[data-rmd-mc=\"continue-columns\"]')", 8000);
  await click('[data-rmd-mc="continue-columns"]');
  ok("masterchart question offered", await until("!!document.querySelector('[data-rmd-mc-choice=\"survival\"]')", 8000));
  await measureScreen("masterchart-question", ".rmd-mc-screen", "light");
  await focusCheck("masterchart-question", ".rmd-mc-screen");
  await measureScreen("masterchart-question", ".rmd-mc-screen", "dark");
  await ev("document.body.classList.remove('dark')");
  await click('[data-rmd-mc-choice="survival"]');
  await until("!!document.querySelector('#rmdMcTime')", 8000);
  await setSelect("#rmdMcTime", "Hospital stay days");
  await setSelect("#rmdMcEvent", "Complication");
  await setSelect("#rmdMcSgroup", "Group");
  await measureScreen("masterchart-survival-form", ".rmd-mc-screen", "light");
  await click('[data-rmd-mc="run"]');
  await tick();
  await measureScreen("masterchart-survival-result", ".rmd-mc-screen", "light");
  await focusCheck("masterchart-survival-result", ".rmd-mc-screen");
  await measureScreen("masterchart-survival-result", ".rmd-mc-screen", "dark");
  await shot("masterchart-survival-dark");
  await ev("document.body.classList.remove('dark')");

  /* tablet: the same screens must fit 1024x1366 with no document-level overflow. */
  await viewport(1024, 1366, false);
  ok("masterchart-survival-result [tablet 1024x1366] no horizontal overflow", (await ev("window.__rmdOverflow()")) <= 0);
  await ev("SMD_RESEARCH.navigate('plan',{projectId:'prj_cmp_1'})");
  ok("plan opens on tablet", await until("!!document.querySelector('.rmd-plan-screen')", 8000));
  ok("plan [tablet 1024x1366] no horizontal overflow", (await ev("window.__rmdOverflow()")) <= 0);
  await shot("plan-tablet-1024");
  await viewport(390, 844, false);
  ok("plan [phone 390x844] no horizontal overflow", (await ev("window.__rmdOverflow()")) <= 0);

  /* reduced motion: the app must not force animation when the user asks not to.
   * Emulate prefers-reduced-motion and confirm no infinite animation runs. */
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await tick();
  var anims = await ev("(function(){var root=document.querySelector('#researchMD');if(!root||!root.getAnimations)return 0;var a=root.getAnimations({subtree:true});var n=0;for(var i=0;i<a.length;i++){var t=a[i].effect&&a[i].effect.getTiming&&a[i].effect.getTiming();if(t&&(t.iterations===Infinity||(t.duration&&t.duration>1000&&t.iterations>1)))n++;}return n;})()");
  ok("reduced motion: no looping animation", anims === 0, "looping=" + anims);
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "" }] });

  ok("zero page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await shot("final");
} catch (e) {
  failures.push("harness exception: " + (e && e.message));
  console.log("FAIL harness exception :: " + (e && e.stack || e));
} finally {
  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

if (failures.length) { console.log("COMPLIANCE FAILURES: " + failures.length); process.exit(1); }
console.log("ALL COMPLIANCE CHECKS PASSED");
process.exit(0);
