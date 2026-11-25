// Real-browser check for the ResearchMD backup screen.
// Serves the app on 127.0.0.1 (crypto.subtle needs a secure context).
//   node test/run-research-backup-ui.mjs   (CHROME=/path/to/chrome to override)
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, readFile } from "node:fs";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const CHROME = process.env.CHROME || [
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find(function (p) { return existsSync(p); });

const PORT = 9321;
const CDP = 9521;
const PHRASE = "backup-phrase-1";
const TOKEN = "SYNTHJPEGTOKEN";
const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

if (!CHROME) {
  console.error("FAIL no Chrome binary");
  process.exit(1);
}

const bodies = [];
const server = http.createServer(function (req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = decodeURIComponent(url.pathname);
  let body = "";
  req.on("data", function (c) { body += c; });
  req.on("end", function () {
    if (body) bodies.push({ url: p, body: body });
    if (p.indexOf("/api/") === 0) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    const fp = join(repo, normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, ""));
    readFile(fp, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.end("404");
        return;
      }
      res.writeHead(200, {
        "content-type": TYPES[extname(fp)] || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end(data);
    });
  });
}).listen(PORT, "127.0.0.1");

const chrome = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  "--remote-debugging-port=" + CDP,
  "--user-data-dir=/tmp/rmd-backup-chrome-" + process.pid,
  "--no-first-run",
  "--disable-gpu"
], { stdio: "ignore" });

let ws;
let sid;
let id = 0;
let failures = 0;
const pending = new Map();
const pageErrors = [];
const net = [];

const call = function (method, params) {
  return new Promise(function (resolve) {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method: method, params: params || {}, sessionId: sid }));
  });
};

const ev = async function (expression) {
  const r = await call("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 700));
  return r.result && r.result.result ? r.result.result.value : undefined;
};

const ok = function (pass, label) {
  console.log((pass ? "PASS" : "FAIL") + " " + label);
  if (!pass) failures += 1;
};

const until = async function (expr, ms) {
  const limit = ms || 10000;
  for (let t = 0; t < limit; t += 100) {
    try {
      if (await ev(expr)) return true;
    } catch (e) { /* page busy */ }
    await sleep(100);
  }
  return false;
};

const viewport = function (width, height, mobile) {
  return call("Emulation.setDeviceMetricsOverride", {
    width: width,
    height: height,
    deviceScaleFactor: 2,
    mobile: mobile
  });
};

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch("http://127.0.0.1:" + CDP + "/json/version")).json();
      break;
    } catch (e) {
      await sleep(200);
    }
  }
  if (!version) throw Error("Chrome DevTools did not answer");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise(function (r) { ws.onopen = r; });
  ws.onmessage = function (e) {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Runtime.exceptionThrown") {
      pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    } else if (m.method === "Network.requestWillBeSent") {
      const req = m.params.request || {};
      net.push((req.method || "") + " " + (req.url || "") + "\n" + (req.postData || ""));
    }
  };

  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Page.enable");

  await viewport(390, 844, true);
  await call("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/?research=1" });
  ok(await until("!!window.SMD_RESEARCH && !!window.RMDBackup && !!window.RMDStore && window.SMD_RESEARCH.screens && !!window.SMD_RESEARCH.screens.backup", 30000), "app loaded with backup screen");
  ok(await ev("window.isSecureContext === true"), "page is a secure context");

  await ev("SMD_RESEARCH.open({screen:'backup'});1");
  ok(await until("!!document.getElementById('rmdBackupExport')", 8000), "backup screen rendered");
  ok(/If you forget this passphrase, nobody can open the backup, including us\./.test(await ev("document.getElementById('rmdBackupWarn').textContent")), "passphrase warning is visible");
  ok(await ev("document.getElementById('rmdBackupMsg').hasAttribute('hidden')"), "no error on first paint");
  ok(await ev("document.getElementById('rmdBackupImages').checked === false"), "images are off until ticked");
  ok(await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "no horizontal overflow at 390px");
  ok(await ev("getComputedStyle(document.querySelector('.rmd-backup-grid')).gridTemplateColumns.split(' ').filter(Boolean).length === 1"), "one column on a phone");
  const btnBox = await ev("(function(){var b=document.getElementById('rmdBackupExport');var s=getComputedStyle(b);return s.minHeight+'|'+s.height+'|'+s.fontSize;})()");
  ok(parseFloat(String(btnBox).split("|")[0]) >= 44, "save button CSS min-height is 44px (" + btnBox + ")");

  await ev("(function(){document.getElementById('rmdBackupPass1').value='short';document.getElementById('rmdBackupPass2').value='short';document.getElementById('rmdBackupExportForm').requestSubmit();return 1})()");
  ok(await until("/Use at least 8 characters\\./.test(document.getElementById('rmdBackupMsg').textContent)", 3000), "short passphrase is refused");
  await ev("(function(){document.getElementById('rmdBackupPass1').value='" + PHRASE + "';document.getElementById('rmdBackupPass2').value='other-phrase-1';document.getElementById('rmdBackupExportForm').requestSubmit();return 1})()");
  ok(await until("/Type the same passphrase in both boxes\\./.test(document.getElementById('rmdBackupMsg').textContent)", 3000), "mismatched passphrase is refused");

  await viewport(1024, 1366, false);
  await sleep(200);
  ok(await ev("getComputedStyle(document.querySelector('.rmd-backup-grid')).gridTemplateColumns.split(' ').filter(Boolean).length === 2"), "two columns on iPad");
  ok(await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "no horizontal overflow at 1024px");
  await viewport(390, 844, true);

  const seeded = await ev("(async function(){" +
    "await RMDStore._setBackend({records:{}, local:{}});" +
    "var img = await RMDStore.put('p1','image','img1',{dataUrl:'data:image/jpeg;base64," + TOKEN + "',width:8,height:8,name:'synthetic.jpg',redacted:true});" +
    "var chart = await RMDStore.put('p1','masterchart','chart',{title:'Synthetic chart',n:4});" +
    "HTMLAnchorElement.prototype.click = function(){};" +
    "if (navigator.canShare) navigator.canShare = function(){return false;};" +
    "return (!img || img.ok !== false) && (!chart || chart.ok !== false);" +
  "})()");
  ok(seeded === true, "synthetic chart and image stored on the phone");

  await ev("(function(){document.getElementById('rmdBackupPass1').value='" + PHRASE + "';document.getElementById('rmdBackupPass2').value='" + PHRASE + "';document.getElementById('rmdBackupImages').checked=true;document.getElementById('rmdBackupExportForm').requestSubmit();return 1})()");
  ok(await until("!!(SMD_RESEARCH.screens.backup.lastFile && SMD_RESEARCH.screens.backup.lastFile.size > 40)", 120000), "export produced a backup file");
  ok(/Backup file ready/.test(await ev("document.getElementById('rmdBackupMsg').textContent || ''")), "export confirmation shown");

  const cleared = await ev("(async function(){await RMDStore._setBackend({records:{}, local:{}});var d=await RMDStore.exportAll({includeImages:true});return d.records.length;})()");
  ok(cleared === 0, "store cleared before restore");

  await ev("(function(){var screen=SMD_RESEARCH.screens.backup;var input=document.getElementById('rmdBackupFile');try{var dt=new DataTransfer();dt.items.add(screen.lastFile);input.files=dt.files;}catch(e){}screen.lastRestoreFile=screen.lastFile;document.getElementById('rmdBackupRestorePass').value='" + PHRASE + "';document.getElementById('rmdBackupRestoreForm').requestSubmit();return 1})()");
  ok(await until("/1 images/.test(document.getElementById('rmdBackupPreviewBox').textContent || '')", 120000), "restore preview counts the image");
  ok(await ev("document.getElementById('rmdBackupReplace').disabled === false"), "replace is available after the file is read");

  await ev("document.getElementById('rmdBackupReplace').click();1");
  ok(await until("/Restored\\. Added 2, updated 0, skipped 0\\./.test(document.getElementById('rmdBackupMsg').textContent || '')", 8000), "replace reports added records");
  const round = await ev("(async function(){var img=await RMDStore.get('p1','image','img1');var chart=await RMDStore.get('p1','masterchart','chart');return {url: img && img.dataUrl, title: chart && chart.title};})()");
  ok(round && round.url === "data:image/jpeg;base64," + TOKEN, "image data URL came back unchanged");
  ok(round && round.title === "Synthetic chart", "chart came back");

  const dashes = await ev("(function(){var t=(document.getElementById('researchMD')||document.body).innerText||'';return (t.match(/[\u2013\u2014]/g)||[]).length;})()");
  ok(dashes === 0, "no em or en dashes on the backup screen");
  ok(await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "no horizontal overflow at 390px after restore");
  const leaked = net.filter(function (row) { return row.indexOf(TOKEN) >= 0 || row.indexOf(PHRASE) >= 0; });
  const leakedBodies = bodies.filter(function (row) { return row.body.indexOf(TOKEN) >= 0 || row.body.indexOf(PHRASE) >= 0; });
  ok(leaked.length === 0 && leakedBodies.length === 0, "no network request carries the backup (" + net.length + " requests)");
  ok(pageErrors.length === 0, "zero page errors (" + pageErrors.length + ")");
  if (pageErrors.length) console.log(pageErrors.join("\n"));

  console.log(failures === 0 ? "\nALL BACKUP UI CHECKS PASSED" : "\n" + failures + " BACKUP UI CHECK(S) FAILED");
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error("Harness error:", e);
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  chrome.kill();
  server.close();
}
