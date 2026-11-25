/* Headless UI test: ResearchMD Novelty Screen PHI gate.
 * Verifies that novelty search:
 * - Scans query with RMDPhi.scan and SMD_redactPHI
 * - Refuses to search when query contains planted phone number
 * - Renders manuscript block message with de-identification findings
 * - Does not make any network request to /find-studies when blocked
 * - Allows clean queries without identifiers to search successfully
 *
 * Usage:
 *   node test/run-research-novelty-ui.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
var PORT = 9128, CDP = 9528, PID = "prj_nv_1";
var MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

var findStudiesCalls = [];

var server = http.createServer(function (req, res) {
  var u = new URL(req.url, "http://localhost");
  if (u.pathname.indexOf("/api/research") === 0) {
    var body = "";
    req.on("data", function (c) { body += c; });
    req.on("end", function () {
      res.setHeader("Content-Type", "application/json");
      if (/\/find-studies$/.test(u.pathname)) {
        var parsed = {};
        try { parsed = JSON.parse(body); } catch (e) {}
        findStudiesCalls.push(parsed);
        res.end(JSON.stringify({
          results: [
            {
              pmid: "30000001",
              title: "Acute myocardial infarction after zinc phosphide poisoning",
              authors: ["Rao A", "Menon K"],
              journal: "Indian J Crit Care Med",
              year: 2019,
              abstract: "A young adult developed ST elevation myocardial infarction after phosphide ingestion.",
              freeFullText: true
            }
          ]
        }));
        return;
      }
      if (/\/manuscript$/.test(u.pathname) && req.method === "GET") {
        res.end(JSON.stringify({ manuscript: null }));
        return;
      }
      if (/\/protocols$/.test(u.pathname) && req.method === "GET") {
        res.end(JSON.stringify({ protocols: [] }));
        return;
      }
      if (req.method === "POST" && /\/projects$/.test(u.pathname)) {
        var p = {};
        try { p = JSON.parse(body); } catch (e) {}
        res.end(JSON.stringify({
          project: {
            id: PID,
            title: p.title || "Case report",
            studyType: p.studyType || "Case Report",
            createdAt: new Date().toISOString()
          }
        }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  var file = u.pathname === "/" ? "/index.html" : u.pathname;
  var full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(full)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(full).pipe(res);
});

await new Promise(function (r) { server.listen(PORT, "127.0.0.1", r); });

var CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium"
].find(function (p) { return fs.existsSync(p); });

if (!CHROME) {
  console.error("No Chrome found");
  process.exit(1);
}

var chrome = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--remote-debugging-port=" + CDP,
  "--user-data-dir=/tmp/rmd-nv-chrome-" + process.pid,
  "--window-size=390,844",
  "--no-first-run",
  "about:blank"
], { stdio: "ignore" });

async function getJson(url) {
  var r = await fetch(url);
  return r.json();
}

var target = null;
for (var i = 0; i < 60 && !target; i++) {
  await new Promise(function (r) { setTimeout(r, 250); });
  try {
    var ts = await getJson("http://127.0.0.1:" + CDP + "/json");
    target = ts.find(function (t) { return t.type === "page"; });
  } catch (e) {}
}

if (!target) {
  console.error("No CDP target");
  chrome.kill();
  server.close();
  process.exit(1);
}

var ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(function (r, j) { ws.onopen = r; ws.onerror = j; });

var msgId = 0, pending = new Map(), pageErrors = [];
ws.onmessage = function (m) {
  var d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    var p = pending.get(d.id);
    pending.delete(d.id);
    d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result);
  }
  if (d.method === "Runtime.exceptionThrown") {
    pageErrors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  }
};

function call(method, params) {
  return new Promise(function (resolve, reject) {
    var id = ++msgId;
    pending.set(id, { resolve: resolve, reject: reject });
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
}

async function ev(expr) {
  var r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("page eval: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

var failures = [];
function ok(name, cond, detail) {
  if (cond) {
    console.log("PASS " + name);
  } else {
    failures.push(name);
    console.log("FAIL " + name + (detail ? " :: " + detail : ""));
  }
}

async function until(expr, ms) {
  var t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    if (await ev(expr)) return true;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return false;
}

async function click(sel) {
  return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.click();return true})()");
}

async function text(sel) {
  return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");return e?e.innerText:''})()");
}

async function setVal(sel, val) {
  return ev("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.value=" + JSON.stringify(val) + ";e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
}

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await ev("(function(){try{['smd_research_state_v1','smd_rmd_help','smd_rmd_seen'].forEach(function(k){localStorage.removeItem(k);});}catch(e){}})()");
  await call("Page.navigate", { url: "http://localhost:" + PORT + "/?research=1" });

  ok("modules load", await until("!!(window.SMD_RESEARCH && SMD_RESEARCH.screens && SMD_RESEARCH.screens.novelty && window.RMDPhi)", 20000));
  ok("script tags have v tokens", await ev("!!document.querySelector('script[src*=\"research-screen-novelty.js?v=ra3\"]') && !!document.querySelector('script[src*=\"research-phi.js?v=ra3\"]')"));

  // Open novelty directly with seeded project
  await ev("(function(){" +
    "var s = { activeProjectId: '" + PID + "', projects: [{ id: '" + PID + "', title: 'Zinc phosphide MI', studyType: 'case-report', role: 'owner', practice: false }] };" +
    "localStorage.setItem('smd_research_state_v1', JSON.stringify(s));" +
    "if (SMD_RESEARCH.store && SMD_RESEARCH.store.init) SMD_RESEARCH.store.init();" +
    "return 1;" +
  "})()");

  await ev("SMD_RESEARCH.navigate('novelty', { projectId: '" + PID + "' }); 1");
  ok("novelty screen renders", await until("!!document.querySelector('#rmdNvQuery')", 10000));

  // Test 1: Plant a phone number into the search query
  await setVal("#rmdNvQuery", "zinc phosphide myocardial injury 98765.43210");
  findStudiesCalls = [];
  await click('[data-rmd-nv="search"]');

  ok("refuses to search on planted phone", await until("/De-identification findings/i.test((document.querySelector('.rmd-novelty-screen')||{}).innerText||'')", 5000));
  ok("findStudies never called for blocked query", findStudiesCalls.length === 0, "calls count: " + findStudiesCalls.length);

  var bannerText = await text(".rmd-banner-warn");
  ok("block message mentions de-identification findings", /De-identification findings \(must fix before sending\):/i.test(bannerText), bannerText);
  ok("block message identifies phone match", /phone/i.test(bannerText), bannerText);

  // Test 2: Plant an Aadhaar number into the search query
  await setVal("#rmdNvQuery", "zinc phosphide poisoning 1234 5678 9012");
  await click('[data-rmd-nv="search"]');
  ok("refuses to search on planted Aadhaar", await until("/aadhaar/i.test((document.querySelector('.rmd-novelty-screen')||{}).innerText||'')", 5000));
  ok("findStudies still never called", findStudiesCalls.length === 0, "calls count: " + findStudiesCalls.length);

  // Test 3: Plant a hospital number into the search query
  await setVal("#rmdNvQuery", "zinc phosphide poisoning hospital number 445566");
  await click('[data-rmd-nv="search"]');
  ok("refuses to search on planted hospital number", await until("/hospital identification number/i.test((document.querySelector('.rmd-novelty-screen')||{}).innerText||'')", 5000));
  ok("findStudies still never called for hospital number", findStudiesCalls.length === 0, "calls count: " + findStudiesCalls.length);

  // Test 4: Clean query searches successfully
  await setVal("#rmdNvQuery", "zinc phosphide myocardial injury");
  await click('[data-rmd-nv="search"]');

  var t0 = Date.now();
  while (Date.now() - t0 < 5000 && findStudiesCalls.length === 0) {
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  ok("clean query triggers find-studies", findStudiesCalls.length === 1);
  ok("findStudies was called with clean query", findStudiesCalls.length === 1 && /zinc phosphide myocardial injury/i.test(findStudiesCalls[0].q || ""));
  ok("results rendered for clean query", await until("document.querySelectorAll('.rmd-nv-result').length === 1", 5000));
  ok("warning banner cleared on successful search", !(await ev("!!document.querySelector('.rmd-novelty-screen .rmd-banner-warn')")));

  // Test 5: Verify no em or en dash in novelty screen
  var screenText = await text(".rmd-novelty-screen");
  ok("no em or en dash in novelty screen", !/[\u2013\u2014]/.test(screenText));

  // Test 6: Verify zero page errors
  ok("zero page errors (" + pageErrors.length + ")", pageErrors.length === 0, pageErrors.join("; "));

} catch (e) {
  console.log("FAIL exception: " + e.message);
  failures.push("exception: " + e.message);
} finally {
  try { ws.close(); } catch {}
  chrome.kill();
  server.close();
}

console.log(failures.length ? (failures.length + " failed") : "all passed");
process.exit(failures.length ? 1 : 0);
