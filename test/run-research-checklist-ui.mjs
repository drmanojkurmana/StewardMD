// Headless checklist screen. Loads the screen script in a harness page.
// The research API is mocked from test/fixtures/research/checklist/.
//   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/run-research-checklist-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const fixtureDir = fileURLToPath(new URL('./fixtures/research/checklist/', import.meta.url));
const CHROME = process.env.CHROME || [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => existsSync(p));
if (!CHROME) {
  console.log('FAIL no Chrome binary');
  process.exit(1);
}

const PORT = 9107;
const CDP = 9507;
const miniPrisma = JSON.parse(readFileSync(join(fixtureDir, 'mini-prisma.json'), 'utf8'));
const miniOther = JSON.parse(readFileSync(join(fixtureDir, 'mini-other.json'), 'utf8'));
miniPrisma.source = 'PRISMA 2020 statement (Page MJ et al., BMJ 2021;372:n71)';
miniPrisma.licence = 'CC BY 4.0';
miniOther.source = 'STROBE statement (von Elm E et al., Lancet 2007;370:1453-57)';
miniOther.licence = 'CC BY 4.0';
const partial = JSON.parse(readFileSync(join(fixtureDir, 'snapshot-partial.json'), 'utf8'));
const manuals = { prisma2020: {}, 'strobe-fixture': {} };

const HARNESS = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checklist harness</title>
<style>
  html, body { margin: 0; height: 100%; background: #0d1417; }
  body.dark { color-scheme: dark; }
  #researchMD {
    width: 100%; min-height: 100%; background: #0d1417; color: #e3ecea;
    --rmd-bg: #0d1417; --rmd-panel: #151f23; --rmd-ink: #e3ecea; --rmd-mut: #93a4a8;
    --rmd-line: #26363b; --rmd-acc: #37b8a6; --rmd-acc-soft: #153430;
    --rmd-warn: #f0b454; --rmd-warn-soft: #352812; --rmd-bad: #ff7b6e;
    --rmd-bad-soft: #3a1714; --rmd-fill: rgba(118,118,128,0.26);
    --rmd-f: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    --rmd-mono: ui-monospace, Menlo, monospace;
  }
  #researchMD, #researchMD * { box-sizing: border-box; }
  #rmdScreenBody { width: 100%; min-width: 0; }
</style>
</head>
<body class="dark v3-dark">
<div id="researchMD"><div id="rmdScreenBody"></div></div>
<script src="/research.js"></script>
<script>
window.SMD_RESEARCH = window.SMD_RESEARCH || {};
var SMD = window.SMD_RESEARCH;
SMD.esc = function (s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};
SMD.navigate = function (name) { window.__rmdNav = name; };
SMD.store = {
  getActiveProject: function () {
    return { id: "prj_checklist", title: "BCG vaccination systematic review" };
  }
};
SMD.api = {
  request: function (method, path, body) {
    var opts = { method: method, headers: { "Accept": "application/json" } };
    if (body != null) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch("/api/research" + path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = {};
        try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = {}; }
        if (!res.ok) {
          var err = new Error((data.error && data.error.message) || ("Request failed (HTTP " + res.status + ")"));
          err.code = "http_" + res.status;
          throw err;
        }
        return data;
      });
    });
  }
};
</script>
<script src="/research-checklist.js"></script>
<script src="/research-submission.js"></script>
<script src="/research-screen-checklist.js"></script>
<script>
SMD_RESEARCH.screens.checklist.render(document.getElementById("rmdScreenBody"));
</script>
</body>
</html>`;

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store'
  });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const FILES = {
  '/research.js': join(repo, 'research.js'),
  '/research-checklist.js': join(repo, 'research-checklist.js'),
  '/research-submission.js': join(repo, 'research-submission.js'),
  '/research-screen-checklist.js': join(repo, 'research-screen-checklist.js')
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  if (path === '/checklist-harness.html' || path === '/') {
    send(res, 200, HARNESS, 'text/html; charset=utf-8');
    return;
  }
  if (FILES[path]) {
    send(res, 200, readFileSync(FILES[path]), 'application/javascript; charset=utf-8');
    return;
  }
  if (path === '/api/research/v1/checklists' && req.method === 'GET') {
    send(res, 200, {
      checklists: [
        { id: miniPrisma.id, name: miniPrisma.name, version: miniPrisma.version },
        { id: miniOther.id, name: miniOther.name, version: miniOther.version }
      ]
    });
    return;
  }
  if (path === '/api/research/v1/checklists/prisma2020' && req.method === 'GET') {
    send(res, 200, miniPrisma);
    return;
  }
  if (path === '/api/research/v1/checklists/strobe-fixture' && req.method === 'GET') {
    send(res, 200, miniOther);
    return;
  }
  if (path === '/api/research/v1/projects/prj_checklist/checklist-snapshot' && req.method === 'GET') {
    send(res, 200, partial);
    return;
  }
  const manual = path.match(/^\/api\/research\/v1\/projects\/prj_checklist\/checklist-manual\/([^/]+)$/);
  if (manual && (req.method === 'GET' || req.method === 'PUT')) {
    const gid = manual[1];
    if (!manuals[gid]) manuals[gid] = {};
    if (req.method === 'PUT') {
      const raw = await readBody(req);
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      if (body && body.num != null) manuals[gid][String(body.num)] = body.text == null ? '' : String(body.text);
    }
    send(res, 200, { entries: manuals[gid] });
    return;
  }
  send(res, 404, { error: { message: 'not found' } });
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd5b-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
], { stdio: 'ignore' });

let ws;
let sid;
let id = 0;
let failures = 0;
const pending = new Map();
const pageErrors = [];
const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
});
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const ok = (pass, label) => { console.log((pass ? 'PASS' : 'FAIL') + ' ' + label); if (!pass) failures++; };
const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) {
    try { if (await ev(expr)) return true; } catch { /* page busy */ }
    await sleep(100);
  }
  return false;
};
const click = (sel) => ev('(()=>{const b=document.querySelector(' + JSON.stringify(sel) + ');if(!b)return false;b.click();return true})()');
const text = (sel) => ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return "";return e.innerText||e.textContent||""})()');
const setVal = (sel, value) => ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return false;e.value=' + JSON.stringify(value) + ';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
const noOverflow = () => ev('(()=>{const b=document.getElementById("researchMD");const d=document.documentElement;return !!b && b.scrollWidth<=b.clientWidth+2 && d.scrollWidth<=d.clientWidth})()');
const noEmDash = async () => !/\u2014/.test(await text('#researchMD'));

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + CDP + '/json/version')).json(); break; }
    catch { await sleep(200); }
  }
  if (!version) throw new Error('Chrome debugging port did not open');
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') pageErrors.push('JS: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 200));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && msg.params.entry.source !== 'network') {
      pageErrors.push((msg.params.entry.url || '') + ' :: ' + String(msg.params.entry.text || '').slice(0, 160));
    }
  };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Page.enable');

  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/checklist-harness.html' });
  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.checklist && !!window.SMD_RESEARCH_SUBMISSION && !!window.SMD_RESEARCH_CHECKLIST', 15000), 'harness loaded checklist screen and submission module');
  ok(await until('!!document.querySelector(\'[data-rmd-item="1"]\')', 8000), 'checklist items render');
  ok(await ev('!!document.querySelector(\'[data-rmd-item="1"] [data-rmd-status="auto"]\')'), 'item 1 is filled');
  ok(await ev('!!document.querySelector(\'[data-rmd-item="7"] [data-rmd-status="partial"]\')'), 'item 7 is partial');
  ok(await ev('!!document.querySelector(\'[data-rmd-item="22"] [data-rmd-status="missing"]\')'), 'item 22 is missing');
  ok(await ev('!!document.querySelector(\'[data-rmd-item="M1"] [data-rmd-status="manual"]\')'), 'item M1 is manual');
  ok(/Records identified/.test(await text('[data-rmd-item="16a"]')), 'item 16a shows the flow counts');

  ok(await click('[data-rmd-pointer="1"]'), 'pointer button clicked');
  ok(await until('(()=>{const e=document.querySelector(\'[data-rmd-ms-current="1"]\');return !!e && /systematic review/.test(e.textContent)})()', 4000), 'pointer jump marks the title paragraph');

  const manualText = 'Matched by age, and site.';
  ok(await setVal('[data-rmd-manual="M1"]', manualText), 'manual textarea accepts an entry');
  ok(await click('[data-rmd-manual-save="M1"]'), 'manual entry saved');
  ok(await until('(()=>{const e=document.querySelector(\'[data-rmd-item="M1"]\');return !!e && e.textContent.indexOf(' + JSON.stringify(manualText) + ')!==-1 && !!e.querySelector(\'[data-rmd-status="manual"]\')})()', 5000), 'saved manual text stays manual');

  ok(await click('[data-rmd-export="csv"]'), 'csv export clicked');
  ok(await until('(()=>{const e=document.getElementById("rmdChecklistCsv");if(!e)return false;const t=e.textContent||"";return t.indexOf("section,number,topic,status")===0 && t.indexOf(' + JSON.stringify(manualText) + ')!==-1 && t.indexOf("manual")!==-1})()', 4000), 'csv export contains the header, the manual text, and a status');

  const creditText = await text('#rmdChecklistCredit');
  ok(/Source/.test(creditText) && /Licence/.test(creditText), 'checklist footer names the source and the licence');
  ok(/PRISMA/.test(creditText), 'footer source names the reporting guideline');
  ok(await until('(()=>{const t=(document.getElementById("rmdChecklistCsv")||{}).textContent||"";const rows=t.trim().split("\\n");return rows[0].indexOf("section,number,topic,status")===0 && /,source,licence$/.test(rows[0]) && rows.length>1 && rows.slice(1).every(function(r){return /,CC BY 4\\.0$/.test(r)})})()', 4000), 'csv export repeats the source and licence on every row');

  ok(await ev('(()=>{const l=document.querySelector(".rmd-checklist-items");const r=document.querySelector(".rmd-checklist-manuscript");if(!l||!r)return false;const a=l.getBoundingClientRect();const b=r.getBoundingClientRect();return a.width>40 && b.width>40 && a.left<b.left})()'), 'two panes at 1024');

  ok(await setVal('#rmdChecklistGuide', 'strobe-fixture'), 'guideline picker changed');
  ok(await until('/State the objectives\\./.test(document.querySelector("#rmdScreenBody").textContent)', 5000), 'other guideline renders its item');
  ok(await setVal('#rmdChecklistGuide', 'prisma2020'), 'guideline picker returned to PRISMA');
  ok(await until('!!document.querySelector(\'[data-rmd-item="1"]\') && !!document.querySelector(\'[data-rmd-manual="M1"]\')', 5000), 'PRISMA checklist restored with the saved entry');

  for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [1024, 768], [1024, 1366]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1024 });
    await ev('window.dispatchEvent(new Event("resize"))');
    ok(await until('!!document.querySelector(".rmd-checklist-screen") && !!document.querySelector(\'[data-rmd-item="M1"]\')', 5000), 'screen renders at ' + width);
    if (width <= 390) {
      ok(await until('!document.querySelector("#researchMD textarea")', 4000), 'phone has no manual textarea');
      ok((await text('[data-rmd-item="M1"]')).indexOf(manualText) !== -1, 'saved manual text stays visible on a phone');
      ok(!!await ev('!!document.querySelector("[data-rmd-approve]")'), 'approve control is on the phone');
      ok(await click('[data-rmd-approve]'), 'approve clicked');
      ok(await until('/Approved on this device/.test((document.getElementById("rmdChecklistApproved")||{}).textContent||"")', 3000), 'phone approve note is shown');
    } else {
      ok(await until('!!document.querySelector("#researchMD textarea")', 4000), 'manual textarea is available at ' + width);
    }
    ok(await noOverflow(), 'no horizontal overflow at ' + width);
    ok(await noEmDash(), 'no em dash at ' + width);
  }

  if (pageErrors.length) console.log('PAGE ERRORS:\n' + pageErrors.join('\n'));
  ok(pageErrors.length === 0, 'no page errors (' + pageErrors.length + ')');
} catch (e) {
  console.log('FAIL exception: ' + (e && e.message ? e.message : e));
  failures++;
} finally {
  try { if (ws) ws.close(); } catch { /* already closed */ }
  try { chrome.kill(); } catch { /* already gone */ }
  server.close();
}

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
