/* Headless UI: ResearchMD case report end to end.
 * Case file (CARE order, zinc phosphide MI example) -> timeline (Day 0, sorted,
 * undated last) -> novelty (mocked search, 0 MaiK tokens, query strips patient
 * details, add to references) -> IEC case report variant (never blocks) ->
 * images (downscale <= 2048, black box burned in, fresh JPEG with no EXIF APP1,
 * stored as a data URL string never a Blob, box pixel is black).
 * Synthetic data only. Nothing is uploaded.
 * Run: node test/run-research-casereport-ui.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
var PORT = 9120, CDP = 9520, PID = "prj_cr_1";
var OUT = "/tmp/stewardmd-research-alltypes-qwen";
fs.mkdirSync(OUT, { recursive: true });
var MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
var allBodies = [];

var FIND_RESULTS = [
  { pmid: "30000001", title: "Acute myocardial infarction after zinc phosphide poisoning", authors: [" Rao A", " Menon K"], journal: "Indian J Crit Care Med", year: 2019, abstract: "A young adult developed ST elevation myocardial infarction after aluminium phosphide analogue ingestion with normal coronary arteries.", freeFullText: true },
  { pmid: "30000002", title: "Toxic vasospasm and myocardial injury in phosphide poisoning", authors: [" Silva P"], journal: "Clin Toxicol", year: 2021, abstract: "Case series describing reversible coronary vasospasm after phosphide exposure." },
  { doi: "10.0000/synthetic.3", title: "Normal coronary angiogram in toxic myocardial infarction", authors: [" Lee J", " Park S", " Kim H", " Choi M"], journal: "Case Rep Cardiol", year: 2022, abstract: "Report of a toxic vasospastic mechanism rather than plaque rupture." }
];

var server = http.createServer(function (req, res) {
  var u = new URL(req.url, "http://localhost");
  if (u.pathname.indexOf("/api/research") === 0) {
    var body = "";
    req.on("data", function (c) { body += c; });
    req.on("end", function () {
      allBodies.push({ url: u.pathname, body: body });
      res.setHeader("Content-Type", "application/json");
      if (/\/find-studies$/.test(u.pathname)) { res.end(JSON.stringify({ results: FIND_RESULTS })); return; }
      if (/\/manuscript$/.test(u.pathname) && req.method === "GET") { res.end(JSON.stringify({ manuscript: null })); return; }
      if (/\/protocols$/.test(u.pathname) && req.method === "GET") { res.end(JSON.stringify({ protocols: [] })); return; }
      if (req.method === "POST" && /\/projects$/.test(u.pathname)) {
        var p = {}; try { p = JSON.parse(body); } catch (e) {}
        res.end(JSON.stringify({ project: { id: PID, title: p.title || "Case report", studyType: p.studyType || "Case Report", createdAt: new Date().toISOString() } }));
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
  "--user-data-dir=/tmp/rmd-cr-chrome-" + process.pid, "--window-size=390,844", "--no-first-run", "about:blank"], { stdio: "ignore" });

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
async function text(sel) { return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");return e?e.innerText:''})()"); }
async function setSelect(sel, val) {
  return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.value=" + JSON.stringify(val) + ";e.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
}
async function setVal(sel, val) {
  return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.value=" + JSON.stringify(val) + ";e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
}
async function tick() { await new Promise(function (r) { setTimeout(r, 450); }); }
async function shot(name) { var r = await call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, "casereport-" + name + ".png"), Buffer.from(r.data, "base64")); }
async function viewport(w, h, mobile) { await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile }); await tick(); }

try {
  await call("Page.enable"); await call("Runtime.enable");
  await viewport(390, 844, true);
  await ev("(function(){try{['smd_research_state_v1','smd_rmd_help','smd_rmd_seen','smd_rmd_masterchart_v1','smd_rmd_manuscript_local_v1'].forEach(function(k){localStorage.removeItem(k);});}catch(e){}})()");
  await call("Page.navigate", { url: "http://localhost:" + PORT + "/?research=1" });
  ok("case report modules load", await until("!!(window.SMD_RESEARCH && SMD_RESEARCH.screens && SMD_RESEARCH.screens.casefile && SMD_RESEARCH.screens.novelty && SMD_RESEARCH.screens.iec && SMD_RESEARCH.screens.images)", 20000));
  await ev("(function(){if(SMD_RESEARCH.store&&SMD_RESEARCH.store.init)SMD_RESEARCH.store.init();})()");

  /* create a single case report project */
  ok("start opens", await until("!!(SMD_RESEARCH.open && (SMD_RESEARCH.open({screen:'start'}), document.querySelector('[data-rmd-start-choice=\"case\"]')))", 10000));
  await click('[data-rmd-start-choice="case"]');
  await until("!!document.querySelector('#rmdStartForm')");
  await setVal("#rmd_start_title", "Zinc phosphide MI case report");
  await click('[data-rmd="start-create"]');
  ok("case file step opens (report mode)", await until("!!document.querySelector('.rmd-casefile-screen')", 12000));
  ok("report mode is not a series", !(await ev("!!document.querySelector('[data-rmd-cf=\"addpatient\"]')")));
  ok("Next line on case file", /Next:/.test(await text(".rmd-casefile-screen")));

  /* load the synthetic zinc phosphide MI example */
  ok("example button present", await click('[data-rmd-cf="example"]'));
  ok("example fills age", await until("(document.querySelector('#rmdCfAge')||{}).value==='34'"));
  ok("example fills diagnosis", await until("/zinc phosphide/i.test((document.querySelector('#rmdCfDiagnosis')||{}).value||'')"));
  ok("no patient name field", !(await ev("!!document.querySelector('[data-rmd-cf-field=\"name\"]')")));
  ok("no hospital number field", !(await ev("!!document.querySelector('[data-rmd-cf-field=\"hospital\"]')")));
  ok("no address field", !(await ev("!!document.querySelector('[data-rmd-cf-field=\"address\"]')")));
  await click('[data-rmd-cf="save"]');
  await until("!!document.querySelector('#rmdCfSaveStatus') && /Saved on this phone/.test(document.querySelector('#rmdCfSaveStatus').innerText)");

  /* timeline: Day 0 first, sorted, follow-up last dated */
  ok("timeline shows Day 0", await until("(function(){var d=document.querySelectorAll('#rmdCfTimeline .rmd-cf-day');return d.length && d[0].innerText==='Day 0';})()"));
  var days = await ev("(function(){return Array.prototype.map.call(document.querySelectorAll('#rmdCfTimeline .rmd-cf-day'),function(e){return e.innerText;});})()");
  ok("timeline day numbers ascend", (function () {
    var nums = []; for (var i = 0; i < days.length; i++) { var m = /^Day (\d+)$/.exec(days[i]); if (m) nums.push(Number(m[1])); }
    for (var j = 1; j < nums.length; j++) if (nums[j] < nums[j - 1]) return false;
    return nums.length >= 4;
  })(), JSON.stringify(days));
  ok("timeline includes Day 42 follow-up", days.indexOf("Day 42") >= 0, JSON.stringify(days));
  await shot("01-casefile-timeline");

  /* add identifiers into the unusual text to prove the novelty query strips them */
  await setVal("#rmdCfUnusual", "Myocardial infarction after zinc phosphide poisoning is rarely reported. Seen in a 34-year-old male on 2026-03-02 with a normal coronary angiogram.");
  await click('[data-rmd-cf="save"]');
  await tick();
  ok("case file stored in RMDStore", await ev("RMDStore.get('" + PID + "','casefile','case').then(function(v){return !!(v && v.diagnosis);})"));

  /* novelty */
  await ev("SMD_RESEARCH.navigate('novelty',{projectId:'" + PID + "'})");
  ok("novelty opens", await until("!!document.querySelector('#rmdNvQuery')", 10000));
  ok("0 MaiK tokens chip", /0 MaiK tokens/.test(await text(".rmd-novelty-screen")));
  var query = await ev("(document.querySelector('#rmdNvQuery')||{}).value||''");
  ok("query built from diagnosis and unusual feature", /zinc phosphide/i.test(query) && /myocardial infarction/i.test(query), query);
  ok("query strips age", !/\b34\b/.test(query), query);
  ok("query strips sex", !/\bmale\b/i.test(query), query);
  ok("query strips dates", !/2026-03-02/.test(query) && !/\d{4}-\d{2}-\d{2}/.test(query), query);
  ok("search button", await click('[data-rmd-nv="search"]'));
  ok("found N similar published cases", await until("/We found 3 similar published cases/.test((document.querySelector('.rmd-novelty-screen')||{}).innerText||'')", 10000));
  ok("three paper cards", await ev("document.querySelectorAll('.rmd-nv-result').length===3"));
  ok("add to references buttons", await ev("document.querySelectorAll('[data-rmd-nv-add]').length===3"));
  ok("add first reference", await click('[data-rmd-nv-add]'));
  ok("added confirmation", await until("/Added to your references/.test((document.querySelector('.rmd-novelty-screen')||{}).innerText||'')"));
  var findBody = allBodies.filter(function (b) { return /find-studies/.test(b.url); }).pop();
  var findQ = ""; try { findQ = JSON.parse(findBody.body).q || ""; } catch (e) {}
  ok("search request carries no age, sex or date", !/\b34\b/.test(findQ) && !/\bmale\b/i.test(findQ) && !/2026-03-02/.test(findQ), findQ);
  await shot("02-novelty");

  /* IEC case report variant: never blocks */
  await ev("SMD_RESEARCH.navigate('iec',{projectId:'" + PID + "'})");
  ok("IEC opens", await until("!!document.querySelector('#rmdIecStatus')", 10000));
  ok("case report permission line", /Ask your ethics committee or HOD whether they need to review it/.test(await text(".rmd-iec-screen")));
  ok("no ICMR study line for a case report", !/ICMR 2017/.test(await text(".rmd-iec-screen")));
  ok("case report never blocks (no warn banner)", !(await ev("!!document.querySelector('.rmd-iec-screen .rmd-banner-warn')")));
  ok("Next line on IEC", /Next:/.test(await text(".rmd-iec-screen")));
  await setSelect("#rmdIecStatus", "approved");
  await tick();
  ok("RMDIec.status reads approved", await ev("window.RMDIec.status('" + PID + "').then(function(s){return s==='approved';})"));
  await shot("03-iec-report");

  /* images: synthetic large image, downscale, black box, fresh JPEG */
  await ev("SMD_RESEARCH.navigate('images',{projectId:'" + PID + "'})");
  ok("images opens", await until("/Add an image/.test((document.querySelector('.rmd-images-screen')||{}).innerText||'')", 10000));
  var synthetic = await ev("(function(){var c=document.createElement('canvas');c.width=3000;c.height=2000;var x=c.getContext('2d');x.fillStyle='#ff8800';x.fillRect(0,0,3000,2000);x.fillStyle='#003366';x.font='bold 120px sans-serif';x.fillText('JOHN DOE  MRN 123456',200,400);x.fillStyle='#ffffff';x.beginPath();x.arc(1500,1200,300,0,6.283);x.fill();return c.toDataURL('image/png');})()");
  ok("synthetic image generated", typeof synthetic === "string" && synthetic.indexOf("data:image/png") === 0);
  await ev("SMD_RESEARCH.screens.images.openImage(" + JSON.stringify(synthetic) + ",'ECG on admission',null)");
  ok("image editor opens", await until("!!document.querySelector('#rmdImgCanvas')", 10000));
  var dims = await ev("(function(){var e=SMD_RESEARCH.screens.images.getEditor();return e?{w:e.width,h:e.height}:null;})()");
  ok("downscaled longest side <= 2048", dims && dims.w <= 2048 && dims.h <= 2048, JSON.stringify(dims));
  ok("downscaled to 2048 wide", dims && dims.w === 2048, JSON.stringify(dims));
  /* burn a black box over the name region (editor coordinates) */
  await ev("SMD_RESEARCH.screens.images.addBox({x:80,y:180,w:1000,h:260})");
  ok("one black box drawn", await ev("SMD_RESEARCH.screens.images.getEditor().boxes.length===1"));
  ok("save disabled before checklist", await ev("document.querySelector('[data-rmd-img=\"save\"]').disabled===true"));
  var keys = ["name", "hospital", "dates", "face", "tattoos", "logo"];
  for (var ki = 0; ki < keys.length; ki++) await click('[data-rmd-img-check="' + keys[ki] + '"]');
  ok("save enabled after checklist", await ev("document.querySelector('[data-rmd-img=\"save\"]').disabled===false"));
  await shot("04-image-editor");
  await click('[data-rmd-img="save"]');
  ok("image saved notice", await until("/Saved on this phone. Nothing was uploaded/.test((document.querySelector('.rmd-images-screen')||{}).innerText||'')", 10000));
  var stored = await ev("RMDStore.list('" + PID + "','image').then(function(recs){if(!recs.length)return null;var v=recs[0].value;return {id:recs[0].id,isString:typeof v.dataUrl==='string',prefix:String(v.dataUrl).slice(0,23),width:v.width,height:v.height,name:v.name,redacted:v.redacted,dataUrl:v.dataUrl};})");
  ok("image stored in RMDStore", !!stored);
  ok("stored value is a data URL string, not a Blob", stored && stored.isString === true && stored.prefix === "data:image/jpeg;base64,", stored && stored.prefix);
  ok("stored value marked redacted", stored && stored.redacted === true);
  ok("stored name has no patient name", stored && stored.name === "ECG on admission");

  /* JPEG header: SOI present, no APP1 (EXIF) segment */
  var b64 = stored.dataUrl.split(",")[1];
  var buf = Buffer.from(b64, "base64");
  ok("JPEG starts with SOI marker", buf[0] === 0xFF && buf[1] === 0xD8);
  var hasApp1 = false, off = 2;
  while (off + 4 < buf.length && buf[off] === 0xFF) {
    var marker = buf[off + 1];
    if (marker === 0xE1) { hasApp1 = true; break; }
    if (marker === 0xDA) break; /* start of scan: header ends */
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
    var len = (buf[off + 2] << 8) | buf[off + 3];
    off += 2 + len;
  }
  ok("exported JPEG has no APP1 (EXIF) segment", !hasApp1);

  /* box pixel is black in the exported JPEG */
  var pixel = await ev("(function(){return new Promise(function(resolve){var img=new Image();img.onload=function(){var c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;var x=c.getContext('2d');x.drawImage(img,0,0);var d=x.getImageData(580,310,1,1).data;resolve({r:d[0],g:d[1],b:d[2]});};img.onerror=function(){resolve(null);};img.src=" + JSON.stringify(stored.dataUrl) + ";});})()");
  ok("redacted box pixel is black", pixel && pixel.r < 16 && pixel.g < 16 && pixel.b < 16, JSON.stringify(pixel));
  await shot("05-image-saved");

  /* ===== sweeps ===== */
  await viewport(1024, 1366, false);
  ok("no horizontal overflow at 1024px", await ev("document.documentElement.scrollWidth<=document.documentElement.clientWidth"));
  await viewport(390, 844, true);
  ok("no horizontal overflow at 390px", await ev("document.documentElement.scrollWidth<=document.documentElement.clientWidth"));
  var dashes = await ev("(function(){var t=(document.querySelector('#researchMD')||{}).innerText||'';var m=t.match(/[\\u2013\\u2014]/g);return m?m.length:0;})()");
  ok("no em or en dashes in ResearchMD visible text", dashes === 0, String(dashes));
  var leak = allBodies.filter(function (b) { return /JOHN DOE|MRN 123456|\b34\b|\bmale\b|2026-03-02|Troponin/i.test(b.body); });
  ok("no network request body carries patient identifiers (" + allBodies.length + " bodies checked)", leak.length === 0, JSON.stringify(leak).slice(0, 300));
  ok("zero uncaught page errors (" + pageErrors.length + ")", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 400));

  console.log(failures.length ? "\nFAILURES: " + failures.join("; ") : "\nALL CASEREPORT UI CHECKS PASSED");
  process.exitCode = failures.length ? 1 : 0;
} catch (e) {
  console.error("RUNNER ERROR", e); process.exitCode = 1;
} finally {
  try { ws.close(); } catch (e) {}
  chrome.kill(); server.close();
}
