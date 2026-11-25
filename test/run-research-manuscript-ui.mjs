// Real-browser headless test: ResearchMD Manuscript Screen (plain-prose editor).
// Mocks the research API from docs/research/contracts/phase-5/manuscript-api.md.
// Tests:
// - no raw {{run:...}} tokens or the word "token" visible anywhere
// - number spans non-editable, show resolved values, popover with plain names
// - save without edits sends byte-identical section text (PUT body)
// - Insert a result adds the exact token at the caret/end
// - version diff (plain text), approve then lock makes it read-only
// - gate failures listed in plain words and jump
// - DOCX export: gates first, then native Filesystem CACHE + Share (stubbed)
// - at 375/768/1024, no horizontal overflow, no em/en dash, no page errors
//
// Usage:
//   node test/run-research-manuscript-ui.mjs   (CHROME=/path/to/chrome to override)

import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => existsSync(p));

const PORT = 9098, CDP = 9498;
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2'
};

const PID = 'prj_bcg_1994';
const T0 = '2026-11-20T10:00:00Z';

const RESULTS_TEXT = 'A total of {{run:run_1.k}} trials were included. The pooled relative risk was {{run:run_1.estimate}} (95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Between-study heterogeneity was observed (I2 {{run:run_1.i2}}, tau2 {{run:run_1.tau2}}).';

/* Saved local run for Insert a result (engine pool() shape, log-scale RR). */
const LOCAL_RUN = {
  id: 'run_local_1',
  projectId: PID,
  measure: 'RR',
  model: 'random',
  createdAt: 1763700000000,
  manifest: {
    measure: 'RR',
    inputs: [{ id: 'bcg_1', values: { events1: 4, n1: 123, events2: 11, n2: 139 } }]
  },
  result: {
    pooled: { effect: Math.log(0.49), ciLower: Math.log(0.34), ciUpper: Math.log(0.70), se: 0.18 },
    heterogeneity: { q: 152.2, df: 12, p: 0.0001, i2: 72.8, tau2: 0.36 },
    weights: [100]
  }
};

/* ---------------- Mock In-Memory Manuscript Database ---------------- */
const db = {
  versions: [
    {
      id: 'man_v1',
      version: 1,
      title: 'BCG vaccination against tuberculosis: systematic review and meta-analysis',
      status: 'locked',
      sectionCount: 5,
      referenceCount: 2,
      versionHash: '9b1c7849e8a5b28d051e948f21915f02bc34220fa1689255a01bc89fb13632ef',
      createdAt: T0,
      createdBy: 'researcher',
      lockedAt: '2026-11-20T10:30:00Z',
      lockedBy: 'clinician'
    },
    {
      id: 'man_v2',
      version: 2,
      title: 'BCG vaccination against tuberculosis: systematic review and meta-analysis',
      status: 'draft',
      sectionCount: 5,
      referenceCount: 2,
      createdAt: '2026-11-21T09:00:00Z',
      createdBy: 'researcher'
    }
  ],
  manuscript: {
    id: 'man_v2',
    projectId: PID,
    version: 2,
    title: 'BCG vaccination against tuberculosis: systematic review and meta-analysis',
    authors: ['A. Clinician', 'B. Statistician'],
    affiliations: 'StewardMD Clinical Research Collaborative',
    status: 'draft',
    sections: [
      {
        id: 'abstract',
        heading: 'Abstract',
        level: 1,
        text: 'Objective: Evaluate BCG efficacy against tuberculosis.\nMethods: Systematic review of randomized trials.\nResults: BCG reduced tuberculosis risk (RR {{run:run_1.estimate}}, 95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Heterogeneity was moderate (I2 {{run:run_1.i2}}).\nConclusion: BCG vaccination demonstrates significant protective efficacy.'
      },
      {
        id: 'introduction',
        heading: 'Introduction',
        level: 1,
        text: 'Tuberculosis remains a major public health challenge worldwide [@who2023]. The Bacillus Calmette-Guerin vaccine has been evaluated across multiple distinct populations [@colditz1994].'
      },
      {
        id: 'methods',
        heading: 'Methods',
        level: 1,
        text: 'We conducted a systematic review following PRISMA 2020 guidelines. Eligible studies included randomized controlled trials reporting tuberculosis incidence in vaccinated and control cohorts.'
      },
      { id: 'results', heading: 'Results', level: 1, text: RESULTS_TEXT },
      {
        id: 'discussion',
        heading: 'Discussion',
        level: 1,
        text: 'Our findings confirm substantial protective efficacy of BCG vaccination against clinical tuberculosis. These results support current WHO recommendations for infant vaccination in high-incidence settings [@who2023].'
      }
    ],
    tokens: {
      'run_1:estimate': { value: 0.49, formatted: '0.49' },
      'run_1:ciLower': { value: 0.34, formatted: '0.34' },
      'run_1:ciUpper': { value: 0.70, formatted: '0.70' },
      'run_1:p': { value: 0.0001, formatted: '< .001' },
      'run_1:k': { value: 13, formatted: '13' },
      'run_1:i2': { value: 72.8, formatted: '72.8%' },
      'run_1:tau2': { value: 0.36, formatted: '0.36' }
    },
    references: [
      { key: 'colditz1994', title: 'Efficacy of BCG vaccine in the prevention of tuberculosis', doi: '10.1001/jama.1994.03510370074034', pmid: '8309034' },
      { key: 'who2023', title: 'Global Tuberculosis Report 2023', doi: '10.1016/S0140-6736(23)02145-X' }
    ],
    approval: null,
    lock: null
  }
};

const putLog = [];
let exportGatesPass = false;

/* ---------------- API Handler ---------------- */
async function handleApi(req, res, path, query) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  }

  // GET /v1/projects/:projectId/manuscript/versions
  if (path.match(/^\/v1\/projects\/[^/]+\/manuscript\/versions$/) && req.method === 'GET') {
    return send(200, { versions: db.versions });
  }

  // GET /v1/projects/:projectId/manuscript
  if (path.match(/^\/v1\/projects\/[^/]+\/manuscript$/) && req.method === 'GET') {
    return send(200, { manuscript: db.manuscript });
  }

  // PUT /v1/projects/:projectId/manuscript/sections/:sectionId
  const secMatch = path.match(/^\/v1\/projects\/[^/]+\/manuscript\/sections\/([^/]+)$/);
  if (secMatch && req.method === 'PUT') {
    const sid = secMatch[1];
    const sec = db.manuscript.sections.find((s) => s.id === sid);
    if (!sec) {
      return send(404, { error: { code: 'section_not_found', message: 'No such section' } });
    }
    putLog.push({ sid, text: body.text });
    if (body.text !== undefined) sec.text = body.text;
    if (body.heading !== undefined) sec.heading = body.heading;
    return send(200, { section: sec, version: db.manuscript.version, tokens: db.manuscript.tokens });
  }

  // POST /v1/projects/:projectId/manuscript/approval/approve
  if (path.match(/^\/v1\/projects\/[^/]+\/manuscript\/approval\/approve$/) && req.method === 'POST') {
    db.manuscript.status = 'approved';
    db.manuscript.approval = {
      status: 'approved',
      approvedBy: 'clinician',
      approvedAt: new Date().toISOString(),
      note: body.note || 'Verified'
    };
    return send(200, { status: 'approved', approval: db.manuscript.approval });
  }

  // POST /v1/projects/:projectId/manuscript/lock
  if (path.match(/^\/v1\/projects\/[^/]+\/manuscript\/lock$/) && req.method === 'POST') {
    db.manuscript.status = 'locked';
    db.manuscript.lock = {
      version_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      locked_at: new Date().toISOString(),
      locked_by: 'clinician',
      run_ids: ['run_1'],
      manuscript_title: db.manuscript.title,
      section_count: db.manuscript.sections.length,
      reference_count: db.manuscript.references.length,
      status: 'locked'
    };
    return send(200, { status: 'locked', lock: db.manuscript.lock });
  }

  // POST /v1/projects/:projectId/manuscript/export
  if (path.match(/^\/v1\/projects\/[^/]+\/manuscript\/export$/) && req.method === 'POST') {
    if (exportGatesPass) {
      return send(202, { jobId: 'job_docx_1', status: 'pending', format: 'docx', gatesPassed: true });
    }
    // Gate failures: server messages carry raw tokens; the screen must reword them.
    return send(422, {
      status: 'failed',
      gatesPassed: false,
      error: {
        code: 'gate_failed',
        message: 'Export blocked: release gates failed.'
      },
      gateFailures: [
        {
          type: 'unresolved_token',
          message: 'Token {{run:run_missing.estimate}} cannot be resolved from saved runs.',
          token: '{{run:run_missing.estimate}}',
          sectionId: 'results',
          location: 'Results section'
        },
        {
          type: 'unresolved_citation',
          message: 'Citation key smith2020 has neither DOI nor PMID in references.',
          key: 'smith2020',
          sectionId: 'introduction',
          location: 'Introduction section'
        },
        {
          type: 'unlinked_claim',
          message: 'Claim of statistical significance in Results has no linked run token.',
          sectionId: 'results',
          location: 'Results section'
        }
      ]
    });
  }

  // GET /v1/projects/:projectId/studies
  if (path.match(/^\/v1\/projects\/[^/]+\/studies$/)) {
    return send(200, { studies: [] });
  }

  return send(404, { error: { code: 'not_found', message: 'Unknown endpoint: ' + path } });
}

/* ---------------- HTTP Static Server ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/research/')) {
    try {
      await handleApi(req, res, p.slice('/api/research'.length), u.searchParams);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'mock_error', message: String(e && e.message || e) } }));
    }
    return;
  }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'content-type': TYPES[extname(fp)] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate'
    });
    res.end(data);
  });
}).listen(PORT);

/* ---------------- CDP Headless Harness ---------------- */
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-manuscript-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
], { stdio: 'ignore' });

let ws, sid, id = 0, failures = 0;
const pending = new Map();
const pageErrors = [];

const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
});

const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};

const ok = (pass, label) => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  if (!pass) failures++;
};

const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) {
    try { if (await ev(expr)) return true; } catch { /* ignore page busy */ }
    await sleep(100);
  }
  return false;
};

const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const noOverflow = () => ev(`(()=>{const b=document.getElementById('researchMD');return b.scrollWidth<=b.clientWidth+2})()`);
const noDash = async () => !/[\u2014\u2013]/.test(await text('#researchMD'));
const noRawCode = async (label) => {
  const t = await text('#researchMD');
  // "MaiK tokens" is the AI cost currency (Ask MaiK bar), not a manuscript result token.
  const stripped = t.replace(/MaiK tokens?/gi, '');
  ok(!t.includes('{{run:') && !/token/i.test(stripped), `no raw tokens or the word "token" visible (${label})`);
};

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://localhost:${CDP}/json/version`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }

  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push('JS: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 200));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && msg.params.entry.source !== 'network') {
      pageErrors.push((msg.params.entry.url || '') + ' :: ' + msg.params.entry.text.slice(0, 160));
    }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Page.enable');

  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: false });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });

  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.manuscript', 30000), 'app loaded with manuscript screen registered');
  ok(await ev(`!!document.querySelector('script[src*="research-screen-manuscript.js?v=ra3"]')`), 'index.html carries research-screen-manuscript.js script tag with ?v=ra2');

  // Seed: server-backed project (practice gate skips it) + one saved local run.
  await ev(`(function(){var s=JSON.parse(localStorage.getItem('smd_research_state_v1'));s.projects[0].serverId=s.projects[0].id;s.projects[0].practice=false;s.runs=s.runs||{};s.runs[${JSON.stringify(PID)}]=[${JSON.stringify(LOCAL_RUN)}];localStorage.setItem('smd_research_state_v1',JSON.stringify(s));return 1})()`);
  await ev(`SMD_RESEARCH.open({screen:'manuscript'});1`);
  ok(await until(`!!document.querySelector('.rmd-manuscript-screen')`, 8000), 'manuscript screen renders');
  ok(await ev(`!!document.querySelector('[data-rmd-tab="manuscript"]')`), 'research shell nav carries Manuscript tab');

  /* 1. Plain prose editor, no raw code anywhere */
  await noRawCode('initial render');
  ok(await ev(`!!document.querySelector('#rmdSectionEditor') && !document.querySelector('#rmdSectionText')`), 'single contenteditable editor replaces the source textarea');
  ok(await ev(`!document.querySelector('.rmd-token-chip') && !document.querySelector('.rmd-preview-box')`), 'token chips and duplicate preview box removed');

  /* 2. Number spans: non-editable, resolved values, accessible */
  ok(await until(`!!document.querySelector('.rmd-num')`, 5000), 'number spans rendered for analysis results');
  const spanInfo = await ev(`(()=>{const c=document.querySelector('.rmd-num[data-field="estimate"]');return c?{editable:c.getAttribute('contenteditable'),text:c.textContent,role:c.getAttribute('role'),aria:c.getAttribute('aria-label'),token:c.getAttribute('data-token')}:null})()`);
  ok(spanInfo && spanInfo.editable === 'false', 'number spans not editable');
  ok(spanInfo && spanInfo.text === '0.49', 'number span shows resolved value 0.49');
  ok(spanInfo && spanInfo.role === 'button' && /combined result/.test(spanInfo.aria || ''), 'number span has role=button and plain aria-label');
  ok(spanInfo && spanInfo.token === '{{run:run_1.estimate}}', 'exact source token preserved in data attribute');
  ok(await ev(`(()=>{const e=document.getElementById('rmdSectionEditor');return e.getAttribute('contenteditable')==='true'&&e.getAttribute('role')==='textbox'})()`), 'editor is an editable multiline textbox on tablet draft mode');

  /* 3. Section navigation */
  ok(await ev(`document.querySelectorAll('.rmd-section-item[data-section-id]').length === 5`), 'section list renders 5 sections');
  ok(await ev(`(()=>{const m=document.querySelector('.rmd-section-item-meta');return m&&/^\\d+ words$/.test(m.textContent.trim())})()`), 'section meta shows word count only');
  await click('.rmd-section-item[data-section-id="methods"]');
  ok(await until(`/Methods/.test(document.querySelector('.rmd-editor-title').textContent)`, 3000), 'clicking section switches editor to Methods');
  await click('.rmd-section-item[data-section-id="results"]');
  ok(await until(`/Results/.test(document.querySelector('.rmd-editor-title').textContent)`, 3000), 'clicking section switches editor back to Results');

  /* 4. Save without edits: PUT body must be byte-identical */
  await click('[data-rmd="section-save"]');
  ok(await until(`!!document.querySelector('.rmd-banner-info')`, 5000), 'save displays confirmation');
  ok(await until(`/Saved\\./.test((document.querySelector('.rmd-banner-info')||{}).textContent||'')`, 5000), 'save confirmation is plain "Saved."');
  const noEditPut = putLog.filter((p) => p.sid === 'results').pop();
  ok(noEditPut && noEditPut.text === RESULTS_TEXT, 'save without edits sends byte-identical section text');

  /* 5. Tap a number: plain popover */
  await click('.rmd-num[data-field="estimate"]');
  ok(await until(`!!document.querySelector('.rmd-num-popover')`, 3000), 'tapping a number opens popover');
  const popText = await text('.rmd-num-popover');
  ok(/from your analysis run/.test(popText) && /updates by itself/.test(popText), 'popover explains where the number comes from');
  ok(!popText.includes('{{') && !popText.includes('run_1') && !/token/i.test(popText), 'popover shows no raw code');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));1`);
  ok(await ev(`!document.querySelector('.rmd-num-popover')`), 'Escape closes the number popover');
  await ev(`(()=>{const s=document.querySelector('.rmd-num[data-field="estimate"]');s.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 1})()`);
  ok(await until(`!!document.querySelector('.rmd-num-popover')`, 3000), 'keyboard Enter on a number opens popover');
  await click('[data-rmd-pop-close]');
  ok(await ev(`!document.querySelector('.rmd-num-popover')`), 'popover Close button works');

  /* 6. Insert a result from the latest saved run */
  await click('[data-rmd="insert-result"]');
  ok(await until(`!!document.querySelector('.rmd-insert-panel')`, 3000), 'Insert a result opens the results panel');
  const insertText = await text('.rmd-insert-panel');
  ok(/Risk ratio \(RR\)/.test(insertText) && /0\.49/.test(insertText), 'insert panel lists plain scientific names with values');
  ok(!insertText.includes('{{') && !/token/i.test(insertText), 'insert panel shows no raw code');
  await click('[data-rmd-insert-field="estimate"]');
  ok(await until(`!!document.querySelector('.rmd-num[data-token="{{run:run_local_1.estimate}}"]')`, 3000), 'inserting a result adds the exact token span');
  await click('[data-rmd="section-save"]');
  await sleep(400);
  const insertPut = putLog.filter((p) => p.sid === 'results').pop();
  ok(insertPut && insertPut.text === RESULTS_TEXT + '{{run:run_local_1.estimate}}', 'save after insert sends original text plus the exact token');
  await noRawCode('after insert');

  /* 7. Version diff in plain text */
  await click('[data-rmd="manuscript-diff-toggle"]');
  ok(await until(`!!document.querySelector('.rmd-diff-view')`, 5000), 'what-changed view renders');
  ok(await ev(`!!document.querySelector('.rmd-diff-view .rmd-diff-ins') || !!document.querySelector('.rmd-diff-view .rmd-diff-del')`), 'diff shows inserted/deleted content');
  const diffText = await text('.rmd-diff-view');
  ok(!diffText.includes('{{run:'), 'diff shows resolved numbers, not raw tokens');
  await click('[data-rmd="manuscript-mode-editor"]');
  ok(await until(`!!document.querySelector('#rmdSectionEditor')`, 5000), 'back to editor restores section view');

  /* 8. Approve then lock makes it read-only */
  ok(await ev(`!document.querySelector('.rmd-locked-banner')`), 'manuscript is initially unlocked');
  await click('[data-rmd="manuscript-approve"]');
  ok(await until(`/Approved/.test(document.querySelector('.rmd-man-topbar').textContent)`, 5000), 'Mark as final approves the manuscript');
  await click('[data-rmd="manuscript-lock"]');
  ok(await until(`/Locked/.test(document.querySelector('.rmd-man-topbar').textContent)`, 5000), 'lock freezes manuscript version');
  ok(await until(`!!document.querySelector('.rmd-locked-banner')`, 3000), 'locked banner displayed');
  const lockText = await text('.rmd-locked-banner');
  ok(!/e3b0c442|[0-9a-f]{32}/.test(lockText), 'locked banner hides the version hash');
  ok(await ev(`(()=>{const e=document.querySelector('#rmdSectionEditor');return e&&e.getAttribute('contenteditable')==='false'})()`), 'approve then lock makes the editor read-only');
  ok(await ev(`!document.querySelector('[data-rmd="section-save"]') && !document.querySelector('[data-rmd="insert-result"]')`), 'save and insert buttons hidden when locked');

  /* 9. Gate failures listed in plain words and jump */
  await click('[data-rmd="manuscript-export"]');
  ok(await until(`!!document.querySelector('.rmd-gate-card')`, 5000), 'Download Word file triggers gate check');
  ok(await until(`document.querySelectorAll('.rmd-gate-failure-item').length >= 3`, 5000), 'gate failures listed as items');
  const gateListText = await text('.rmd-gate-failure-list');
  ok(/Missing result/.test(gateListText), 'missing-result gate failure reported plainly');
  ok(/Reference needs details/.test(gateListText), 'reference gate failure reported plainly');
  ok(/Claim needs a result/.test(gateListText), 'claim gate failure reported plainly');
  ok(!/token/i.test(gateListText) && !gateListText.includes('{{'), 'gate failures show no raw codes');
  await noRawCode('gate failures');
  await click('[data-rmd-jump="introduction"]');
  ok(await until(`/Introduction/.test(document.querySelector('.rmd-editor-title').textContent)`, 3000), 'gate failure jump navigates to Introduction');

  /* 10. DOCX export success through native Filesystem CACHE + Share */
  exportGatesPass = true;
  await ev(`(function(){
    window.__exports = [];
    window.Capacitor = {
      isNativePlatform: function () { return true; },
      Plugins: {
        Filesystem: { writeFile: function (o) { window.__exports.push({ kind: 'write', opts: o }); return Promise.resolve({ uri: 'file:///cache/' + o.path }); } },
        Share: { share: function (o) { window.__exports.push({ kind: 'share', opts: o }); return Promise.resolve({}); } }
      }
    };
    return 1;
  })()`);
  await click('[data-rmd="manuscript-export"]');
  ok(await until(`window.__exports && window.__exports.some(function(x){return x.kind==='share'})`, 8000), 'DOCX export writes and shares the file on native');
  const docxWrite = await ev(`(window.__exports.filter(function(x){return x.kind==='write'})[0]||{}).opts||null`);
  const docxShare = await ev(`(window.__exports.filter(function(x){return x.kind==='share'})[0]||{}).opts||null`);
  ok(docxWrite && docxWrite.directory === 'CACHE', 'DOCX writeFile uses directory CACHE');
  ok(docxWrite && /^[A-Za-z0-9-]+-draft\.docx$/.test(docxWrite.path || ''), 'DOCX filename is readable ASCII ending -draft.docx');
  ok(docxWrite && typeof docxWrite.data === 'string' && /^UEsDB/.test(docxWrite.data), 'DOCX data is base64 of a real ZIP (PK header)');
  ok(docxShare && docxWrite && docxShare.url === 'file:///cache/' + docxWrite.path, 'Share.share receives the written file uri');
  ok(docxShare && docxShare.dialogTitle === 'Save or send your file', 'share sheet has plain dialog title');
  ok(await until(`/Your file is ready to save or share/.test(document.querySelector('.rmd-man-right').textContent)`, 5000), 'plain confirmation shown after export');
  await noRawCode('after export');

  /* 11. Responsive layouts: 375 / 768 / 1024 px, no overflow, no dashes */
  for (const [width, height, mobile] of [[375, 812, true], [768, 1024, true], [1024, 768, false]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    await ev(`SMD_RESEARCH.navigate('manuscript');1`);
    await sleep(200);

    ok(await until(`!!document.querySelector('.rmd-manuscript-screen')`, 5000), `manuscript screen renders at ${width}px`);
    ok(await noOverflow(), `no horizontal overflow at ${width}px`);
    ok(await noDash(), `no em/en dash in UI text at ${width}px`);

    if (width === 375) {
      ok(await ev(`!!document.querySelector('.rmd-phone-notice')`), 'phone view notice visible at 375px');
      ok(await ev(`(()=>{const e=document.querySelector('#rmdSectionEditor');return e&&e.getAttribute('contenteditable')==='false'})()`), 'editor is view-only on phone at 375px');
      ok(await ev(`!!document.querySelector('[data-rmd-phone-tab="approve"]')`), 'phone offers approve tab at 375px');
    }

    if (width >= 768) {
      ok(await ev(`(()=>{const l=document.querySelector('.rmd-man-left');const r=document.querySelector('.rmd-man-right');return l&&r&&getComputedStyle(l).display!=='none'&&getComputedStyle(r).display!=='none'})()`), `two-pane visible at ${width}px`);
    }
  }

  /* 12. No page errors, Escape closes */
  if (pageErrors.length) console.log('PAGE ERRORS:\n' + pageErrors.join('\n'));
  ok(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27}));1`);
  ok(await ev(`getComputedStyle(document.getElementById('researchMD')).display==='none'`), 'Escape closes the ResearchMD overlay');

} catch (e) {
  console.log('FAIL exception:', e.message);
  failures++;
} finally {
  try { ws.close(); } catch {}
  chrome.kill();
  server.close();
}

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
