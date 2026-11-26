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
const miniStrobe = JSON.parse(readFileSync(join(fixtureDir, 'mini-strobe.json'), 'utf8'));
miniPrisma.source = 'PRISMA 2020 statement (Page MJ et al., BMJ 2021;372:n71)';
miniPrisma.licence = 'CC BY 4.0';
miniOther.source = 'STROBE statement (von Elm E et al., Lancet 2007;370:1453-57)';
miniOther.licence = 'CC BY 4.0';
const partial = JSON.parse(readFileSync(join(fixtureDir, 'snapshot-partial.json'), 'utf8'));
/* The checklist screen must build its document from the saved thesis draft
 * when no manuscript is stored on the project. */
delete partial.manuscript;
const manuals = { prisma2020: {}, 'strobe-fixture': {} };
const putLog = [];
const manuscript = {
  id: 'man_1',
  projectId: 'prj_checklist',
  version: 1,
  title: 'BCG vaccination and tuberculosis in children',
  status: 'draft',
  sections: [
    { id: 'abstract', heading: 'Abstract', level: 1, text: '' },
    { id: 'introduction', heading: 'Introduction', level: 1, text: '' },
    { id: 'methods', heading: 'Methods', level: 1, text: '' },
    { id: 'results', heading: 'Results', level: 1, text: '' },
    { id: 'discussion', heading: 'Discussion', level: 1, text: '' }
  ],
  tokens: {},
  references: [],
  approval: null,
  lock: null
};

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
<script src="/research-screen-manuscript.js"></script>
<script src="/research-doc-editor.js"></script>
<script src="/research-submission.js"></script>
<script src="/research-screen-checklist.js"></script>
<script>
if (!sessionStorage.getItem('__rmdHarnessInit')) {
  localStorage.removeItem('smd_rmd_doc_v1');
  localStorage.removeItem('smd_rmd_manuscript_local_v1');
  sessionStorage.setItem('__rmdHarnessInit', '1');
}
localStorage.setItem('smd_rmd_thesis_v1', JSON.stringify({
  prj_checklist: {
    journal: { wordLimit: 3000 },
    draft: {
      sections: [
        { id: 'abstract', heading: 'Abstract', text: 'BCG vaccination and tuberculosis in children: a systematic review.' },
        { id: 'introduction', heading: 'Introduction', text: 'Tuberculosis remains an important cause of childhood illness.\\nWe aimed to estimate the effect of BCG vaccination on tuberculosis.' },
        { id: 'methods', heading: 'Methods', text: 'This was a retrospective cohort study in two hospitals.\\nParticipants were children under five years admitted during the study period.\\nWe collected data from medical records and measured tuberculosis events.\\nWe used a Poisson regression model and reported risk ratios with confidence intervals.' },
        { id: 'results', heading: 'Results', text: 'We included 120 children.\\nThe main result was a risk ratio of 0.49.' },
        { id: 'discussion', heading: 'Discussion', text: 'The key result supports earlier trials.\\nLimitations include short follow up.\\nThe findings may not generalise to other settings.' }
      ]
    }
  }
}));
localStorage.setItem('smd_rmd_checklist_guide_v1', JSON.stringify({ prj_checklist: 'strobe-fixture' }));
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
  '/research-doc-editor.js': join(repo, 'research-doc-editor.js'),
  '/research-screen-manuscript.js': join(repo, 'research-screen-manuscript.js'),
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
        { id: miniOther.id, name: miniOther.name, version: miniOther.version },
        { id: miniStrobe.id, name: miniStrobe.name, version: miniStrobe.version }
      ]
    });
    return;
  }
  if (path === '/api/research/v1/checklists/prisma2020' && req.method === 'GET') {
    send(res, 200, miniPrisma);
    return;
  }
  if (path === '/api/research/v1/checklists/strobe-fixture' && req.method === 'GET') {
    send(res, 200, miniStrobe);
    return;
  }
  if (path === '/api/research/v1/projects/prj_checklist/checklist-snapshot' && req.method === 'GET') {
    send(res, 200, partial);
    return;
  }
  if (path === '/__puts' && req.method === 'GET') {
    send(res, 200, { puts: putLog });
    return;
  }
  if (path === '/api/research/v1/projects/prj_checklist/manuscript' && req.method === 'GET') {
    send(res, 200, { manuscript });
    return;
  }
  const msSection = path.match(/^\/api\/research\/v1\/projects\/prj_checklist\/manuscript\/sections\/([^/]+)$/);
  if (msSection && req.method === 'PUT') {
    const raw = await readBody(req);
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const sid = decodeURIComponent(msSection[1]);
    const target = manuscript.sections.find((s) => s.id === sid);
    if (target) {
      if (body.text != null) target.text = String(body.text);
      if (body.heading != null) target.heading = String(body.heading);
      putLog.push({ id: sid, heading: target.heading, text: target.text, version: body.version });
    }
    send(res, 200, { section: target || null, version: manuscript.version, tokens: {} });
    return;
  }
  if (/^\/api\/research\/v1\/projects\/prj_checklist\/ai-draft$/.test(path) && req.method === 'POST') {
    const raw = await readBody(req);
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    send(res, 200, {
      draft: {
        title: 'BCG vaccination and tuberculosis in children',
        sections: [
          { id: 'methods', heading: 'Methods', text: 'We planned the sample size to detect a risk ratio of 0.5 with 80 percent power.' },
          { id: 'results', heading: 'Results', text: 'We did a subgroup analysis by latitude band.' }
        ]
      },
      model: 'test',
      costInr: 2,
      task: body.task
    });
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
  `--user-data-dir=/tmp/rmd5b-chrome-${process.pid}-${Date.now()}`, '--no-first-run', '--disable-gpu'
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
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      pageErrors.push('JS ' + (d.url || '') + ':' + (d.lineNumber || 0) + ':' + (d.columnNumber || 0) + ' ' + ((d.exception && d.exception.description) || d.text || ''));
    }
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
  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.checklist && !!window.SMD_RESEARCH_SUBMISSION && !!window.SMD_RESEARCH_CHECKLIST && !!window.SMD_RESEARCH_DOC', 15000), 'harness loaded checklist screen, submission module and document editor');
  ok(await until('!!document.querySelector(\'[data-rmd-item="1a"]\') && !!document.querySelector(\'[data-doc-body="methods--study-design"]\')', 12000), 'STROBE checklist and document editor render');
  ok(/Study design/.test(await text('[data-doc-sub="methods--study-design"]')), 'STROBE Study design heading renders');
  ok(/Data sources\/measurement/.test(await text('[data-doc-sub="methods--data-sources-measurement"]')), 'STROBE Data sources heading renders');
  ok(/Generalisability/.test(await text('[data-doc-sub="discussion--generalisability"]')), 'STROBE Generalisability heading renders');

  ok(/retrospective cohort study/.test(await text('[data-doc-body="methods--study-design"]')), 'thesis draft text sits under Study design');
  ok(/children under five/.test(await text('[data-doc-body="methods--participants"]')), 'thesis draft text sits under Participants');
  ok(/medical records/.test(await text('[data-doc-body="methods--data-sources-measurement"]')), 'thesis draft text sits under Data sources');
  ok(/short follow up/.test(await text('[data-doc-body="discussion--limitations"]')), 'thesis draft text sits under Limitations');
  ok(/Tuberculosis remains/.test(await text('[data-doc-body="introduction--overview"]')), 'unmatched thesis text sits under its main section');
  ok(await ev('!!document.querySelector(\'[data-rmd-item="4"] [data-rmd-status="auto"]\')'), 'Study design item is filled from the draft');
  ok(await ev('!!document.querySelector(\'[data-rmd-item="9"] [data-rmd-status="missing"]\')'), 'Bias item starts missing');

  ok(await click('[data-rmd-item="19"]'), 'checklist item clicked');
  ok(await until('!!document.querySelector(\'[data-doc-sub="discussion--limitations"].rmd-doc-target\')', 3000), 'tapping an item jumps to its heading');

  const biasText = 'We matched participants by age and site to limit selection bias in the analysis.';
  await ev(`(()=>{const b=document.querySelector('[data-doc-body="methods--bias"]');if(!b)return false;b.focus();b.textContent=${JSON.stringify(biasText)};b.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  ok(await until('(()=>{const e=document.querySelector(\'[data-rmd-item="9"]\');return !!e && !!e.querySelector(\'[data-rmd-status="auto"]\') && /Filled/.test(e.textContent)})()', 4000), 'typing under a heading changes the item from Missing to Filled');

  await ev(`(()=>{const b=document.querySelector('[data-doc-body="methods--bias"]');b.focus();const r=document.createRange();r.selectNodeContents(b);const s=getSelection();s.removeAllRanges();s.addRange(r);return true})()`);
  ok(await click('[data-doc-cmd="bold"]'), 'bold toolbar button clicked');
  ok(await until('(()=>{const b=document.querySelector(\'[data-doc-body="methods--bias"]\');return !!b && (!!b.querySelector(\'b,strong\') || /font-weight\\s*:\\s*bold/.test(b.innerHTML))})()', 3000), 'bold formatting applied');
  await ev(`(()=>{const b=document.querySelector('[data-doc-body="methods--bias"]');b.focus();const r=document.createRange();r.selectNodeContents(b);const s=getSelection();s.removeAllRanges();s.addRange(r);return true})()`);
  ok(await click('[data-doc-cmd="insertUnorderedList"]'), 'bulleted list toolbar button clicked');
  ok(await until('!!document.querySelector(\'[data-doc-body="methods--bias"] ul, [data-doc-body="methods--bias"] ol\')', 3000), 'bullet formatting applied');

  ok(await click('[data-doc-save]'), 'save button clicked');
  ok(await until('/Saved/.test((document.querySelector("[data-doc-notice]")||{}).textContent||"")', 6000), 'save reports a stored result');
  const puts = await ev('fetch("/__puts").then(r=>r.json())');
  ok(puts && puts.puts && puts.puts.some((p) => p.id === 'methods' && /Bias/.test(p.text) && /Study design/.test(p.text)), 'save wrote the Methods section to the manuscript store');
  ok(await ev(`(()=>{const all=JSON.parse(localStorage.getItem('smd_rmd_doc_v1')||'{}');const d=all['prj_checklist']&&all['prj_checklist']['strobe-fixture'];if(!d)return false;const t=JSON.stringify(d);return /<b[ >]/.test(t) && /<ul[ >]/.test(t) && t.indexOf(${JSON.stringify(biasText)})!==-1})()`), 'bold, list and text persist in the local document store');

  await call('Page.reload', { ignoreCache: true });
  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!document.querySelector(\'[data-doc-body="methods--bias"]\')', 15000), 'page reloaded with the saved document');
  ok(await until('(()=>{const b=document.querySelector(\'[data-doc-body="methods--bias"]\');if(!b)return false;const h=b.innerHTML||"";return /<b[ >]/.test(h) && /<ul[ >]/.test(h) && /matched participants/.test(h)})()', 6000), 'bold and list survive save and reload');
  ok(await ev('!!document.querySelector(\'[data-rmd-item="9"] [data-rmd-status="auto"]\')'), 'typed text still fills the Bias item after reload');

  ok(await ev(`(()=>{const b=document.querySelector('[data-doc-body="methods--study-size"]');if(!b)return false;const dt=new DataTransfer();dt.setData('text/html','<p>Allowed <b>bold</b><script>alert(1)</script><style>.x{color:red}</style><img src="x" onerror="alert(1)"></p>');dt.setData('text/plain','Allowed bold');const e=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(e,'clipboardData',{value:dt});b.focus();b.dispatchEvent(e);return true})()`), 'paste event dispatched');
  ok(await until('(()=>{const b=document.querySelector(\'[data-doc-body="methods--study-size"]\');if(!b)return false;return /Allowed/.test(b.textContent) && !!b.querySelector(\'b\') && !b.querySelector(\'script,style,img\')})()', 4000), 'paste keeps allowed tags and strips scripts and styles');

  ok(await click('[data-rmd-export="csv"]'), 'csv export clicked');
  ok(await until('(()=>{const e=document.getElementById("rmdChecklistCsv");if(!e)return false;const t=e.textContent||"";return t.indexOf("section,number,topic,status")===0 && t.indexOf("Bias")!==-1 && t.indexOf("auto")!==-1})()', 4000), 'csv export contains the header, the Bias row and a status');

  const creditText = await text('#rmdChecklistCredit');
  ok(/Source/.test(creditText) && /Licence/.test(creditText), 'checklist footer names the source and the licence');
  ok(/STROBE/.test(creditText), 'footer source names the reporting guideline');
  ok(await until('(()=>{const t=(document.getElementById("rmdChecklistCsv")||{}).textContent||"";const rows=t.trim().split("\\n");return rows[0].indexOf("section,number,topic,status")===0 && /,source,licence$/.test(rows[0]) && rows.length>1 && rows.slice(1).every(function(r){return /,CC BY 4\\.0$/.test(r)})})()', 4000), 'csv export repeats the source and licence on every row');

  ok(await ev('(()=>{const l=document.querySelector(".rmd-checklist-items");const r=document.querySelector(".rmd-checklist-doc");if(!l||!r)return false;const a=l.getBoundingClientRect();const b=r.getBoundingClientRect();return a.width>40 && b.width>40 && a.left<b.left})()'), 'two panes at 1024');

  ok(await setVal('#rmdChecklistGuide', 'prisma2020'), 'guideline picker changed to PRISMA');
  ok(await until('!!document.querySelector(\'[data-rmd-item="1"]\') && !!document.querySelector(\'[data-doc-body="title--title"]\')', 6000), 'PRISMA headings render in the editor');
  ok(await setVal('#rmdChecklistGuide', 'strobe-fixture'), 'guideline picker returned to STROBE');
  ok(await until('(()=>{const b=document.querySelector(\'[data-doc-body="methods--bias"]\');return !!b && /matched participants/.test(b.textContent)})()', 6000), 'STROBE document restored with the saved text');

  ok(await click('[data-rmd-ai="ask"]'), 'Ask MaiK to draft it clicked');
  ok(await until('(()=>{const a=document.querySelector(\'[data-doc-body="methods--study-size"]\');const b=document.querySelector(\'[data-doc-body="results--other-analyses"]\');return !!a && !!b && /80 percent power/.test(a.textContent) && /latitude band/.test(b.textContent)})()', 9000), 'MaiK fills only the empty subheadings');
  ok(await ev('!!document.querySelector(\'[data-doc-sub="methods--study-size"] [data-rmd-ai-note]\')'), 'MaiK marks the drafted section');
  ok(await ev('!!document.querySelector(\'[data-doc-sub="results--other-analyses"] [data-rmd-ai-note]\')'), 'MaiK marks the second drafted section');
  ok(!(await ev('!!document.querySelector(\'[data-doc-sub="methods--study-design"] [data-rmd-ai-note]\')')), 'MaiK leaves a filled section unmarked');

  await ev(`(()=>{
    window.__docxSections = null;
    SMD_RESEARCH.docxFromSections = function (title, sections) { window.__docxSections = sections; return new Uint8Array([1,2,3]); };
    SMD_RESEARCH.p2.downloadBytes = function () { return Promise.resolve(); };
    return true;
  })()`);
  ok(await click('[data-doc-export]'), 'Download Word file clicked');
  ok(await until('(()=>{const s=window.__docxSections;if(!s)return false;const h=s.map(function(x){return x.heading});return h.indexOf("Methods")!==-1 && h.indexOf("Study design")!==-1 && h.indexOf("Bias")!==-1})()', 4000), 'DOCX export uses the checklist headings and formatting helper');
  ok(await until('/ready to save or share/.test((document.querySelector("[data-doc-notice]")||{}).textContent||"")', 3000), 'DOCX export reports the saved file');

  for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [1024, 768], [1024, 1366]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1024 });
    await ev('window.dispatchEvent(new Event("resize"))');
    ok(await until('!!document.querySelector(".rmd-checklist-screen") && !!document.querySelector(\'[data-rmd-item="1a"]\') && !!document.querySelector("[data-doc-body]")', 6000), 'screen and editor render at ' + width);
    if (width <= 390) {
      ok(await until('!document.querySelector("#researchMD textarea")', 4000), 'phone has no manual textarea');
      ok(!!await ev('!!document.querySelector("[data-rmd-approve]")'), 'approve control is on the phone');
      if (width === 375) {
        ok(await ev('document.querySelector("[data-rmd-approve]").disabled === true'), 'approve is disabled while checklist items remain missing');
        ok(await ev('!!document.querySelector("[data-rmd-approve-reason]") && /Fill the remaining/.test(document.querySelector("[data-rmd-approve-reason]").textContent)'), 'approve disabled reason is shown');
        await ev(`(()=>{document.querySelectorAll("[data-doc-body]").forEach(function(b){if(!(b.textContent||"").trim()){b.textContent="Reported in the manuscript with full study details.";b.dispatchEvent(new Event("input",{bubbles:true}));}});return true})()`);
        ok(await until('!document.querySelector("[data-rmd-approve]").disabled', 4000), 'approve enables once every checklist item has text');
        ok(await click('[data-rmd-approve]'), 'approve clicked');
      }
      ok(await until('/Approved on this device/.test((document.getElementById("rmdChecklistApproved")||{}).textContent||"")', 3000), 'phone approve note is shown');
    } else {
      ok(await ev('(()=>{const e=document.querySelector("[data-doc-body]");return !!e && e.getBoundingClientRect().width > 200})()'), 'document editor has usable width at ' + width);
    }
    ok(await noOverflow(), 'no horizontal overflow at ' + width);
    ok(await noEmDash(), 'no em dash at ' + width);
  }

  await ev(`(()=>{const r=document.getElementById('researchMD');r.style.setProperty('--rmd-bg','#f8f1e4');r.style.setProperty('--rmd-panel','#fffdf9');r.style.setProperty('--rmd-ink','#111c44');r.style.setProperty('--rmd-mut','#5b607a');r.style.setProperty('--rmd-line','#e5ddce');r.style.setProperty('--rmd-acc','#1b41bf');r.style.setProperty('--rmd-acc-soft','#e4e9f8');return true})()`);
  ok(await until('(()=>{const b=document.querySelector("[data-doc-body]");if(!b)return false;const m=getComputedStyle(b).backgroundColor.match(/\\d+/g);return !!m && (+m[0] + +m[1] + +m[2]) > 600})()', 3000), 'editor renders in the light theme');
  ok(await noOverflow(), 'no horizontal overflow in the light theme');

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
