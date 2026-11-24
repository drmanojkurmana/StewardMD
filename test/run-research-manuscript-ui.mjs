// Real-browser headless test: ResearchMD Phase 5A Manuscript Screen (Package 5A.3).
// Mocks the research API from docs/research/contracts/phase-5/manuscript-api.md.
// Tests:
// - token chips not editable
// - version diff
// - approve then lock makes it read-only
// - gate failures listed and jump
// - at 375/768/1024
// - no horizontal overflow
// - no em-dash
// - no page errors
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
      {
        id: 'results',
        heading: 'Results',
        level: 1,
        text: 'A total of {{run:run_1.k}} trials were included. The pooled relative risk was {{run:run_1.estimate}} (95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Between-study heterogeneity was observed (I2 {{run:run_1.i2}}, tau2 {{run:run_1.tau2}}).'
      },
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
    // Return gate failures to test gate failure listing and jump
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
const noEmDash = async () => !/\u2014/.test(await text('#researchMD'));

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
  ok(await ev(`!!document.querySelector('script[src*="research-screen-manuscript.js?v=rmd3"]')`), 'index.html carries research-screen-manuscript.js script tag with ?v=rmd3');

  // Open manuscript screen
  await ev(`SMD_RESEARCH.open({screen:'manuscript'});1`);
  ok(await until(`!!document.querySelector('.rmd-manuscript-screen')`, 8000), 'manuscript screen renders');
  ok(await ev(`!!document.querySelector('[data-rmd-tab="manuscript"]')`), 'research shell nav carries Manuscript tab');

  /* 1. Token chips not editable and show resolved values */
  ok(await until(`!!document.querySelector('.rmd-token-chip')`, 5000), 'token chips rendered for {{run:...}} tokens');
  const chipEditable = await ev(`(()=>{const c=document.querySelector('.rmd-token-chip');return c?c.getAttribute('contenteditable'):null})()`);
  ok(chipEditable === 'false', 'token chips not editable');

  const chipText = await ev(`(()=>{const c=document.querySelector('.rmd-token-chip');return c?c.textContent:''})()`);
  ok(/0\.49|13|<\s*\.001|72\.8%/.test(chipText), 'token chip displays resolved value');

  /* 2. Section navigation and editing */
  ok(await ev(`document.querySelectorAll('.rmd-section-item[data-section-id]').length === 5`), 'IMRAD section list renders 5 sections');
  await click('.rmd-section-item[data-section-id="methods"]');
  ok(await until(`/Methods/.test(document.querySelector('.rmd-editor-title').textContent)`, 3000), 'clicking section switches editor to Methods');

  await click('.rmd-section-item[data-section-id="results"]');
  ok(await until(`/Results/.test(document.querySelector('.rmd-editor-title').textContent)`, 3000), 'clicking section switches editor back to Results');

  const isTextareaEditable = await ev(`(()=>{const t=document.querySelector('#rmdSectionText');return t&&!t.disabled&&!t.readOnly})()`);
  ok(isTextareaEditable, 'editor textarea is editable on tablet draft mode');

  await click('[data-rmd="section-save"]');
  ok(await until(`!!document.querySelector('.rmd-banner-info')`, 5000), 'save draft section saves and displays confirmation');

  /* 3. Version diff */
  await click('[data-rmd="manuscript-diff-toggle"]');
  ok(await until(`!!document.querySelector('.rmd-diff-view')`, 5000), 'version diff view renders');
  ok(await ev(`!!document.querySelector('.rmd-diff-view .rmd-diff-ins') || !!document.querySelector('.rmd-diff-view .rmd-diff-del')`), 'version diff shows inserted/deleted content');
  await click('[data-rmd="manuscript-mode-editor"]');
  ok(await until(`!!document.querySelector('#rmdSectionText')`, 5000), 'back to editor restores section view');

  /* 4. Approve then lock makes it read-only */
  ok(await ev(`!document.querySelector('.rmd-locked-banner')`), 'manuscript is initially unlocked');
  await click('[data-rmd="manuscript-approve"]');
  ok(await until(`/Approved/.test(document.querySelector('.rmd-man-topbar').textContent)`, 5000), 'approve marks manuscript approved');

  await click('[data-rmd="manuscript-lock"]');
  ok(await until(`/Locked/.test(document.querySelector('.rmd-man-topbar').textContent)`, 5000), 'lock freezes manuscript version');
  ok(await until(`!!document.querySelector('.rmd-locked-banner')`, 3000), 'locked banner displayed with SHA-256 hash');

  const isLockedReadOnly = await ev(`(()=>{const t=document.querySelector('#rmdSectionText');return t&&(t.disabled||t.readOnly)})()`);
  ok(isLockedReadOnly, 'approve then lock makes it read-only');

  const isSaveDisabled = await ev(`(()=>{const b=document.querySelector('[data-rmd="section-save"]');return !b||b.disabled})()`);
  ok(isSaveDisabled, 'save section button hidden or disabled when locked');

  /* 5. Gate failures listed and jump */
  await click('[data-rmd="manuscript-export"]');
  ok(await until(`!!document.querySelector('.rmd-gate-card')`, 5000), 'export DOCX triggers gate check');
  ok(await until(`document.querySelectorAll('.rmd-gate-failure-item').length >= 3`, 5000), 'gate failures listed as items');

  const gateListText = await text('.rmd-gate-failure-list');
  ok(/unresolved token/i.test(gateListText), 'unresolved token gate failure reported');
  ok(/unresolved citation/i.test(gateListText), 'unresolved citation gate failure reported');
  ok(/unlinked claim/i.test(gateListText), 'unlinked claim gate failure reported');

  // Jump to section from gate failure
  await click('[data-rmd-jump="introduction"]');
  ok(await until(`/Introduction/.test(document.querySelector('.rmd-editor-title').textContent)`, 3000), 'gate failure jump navigates to Introduction');

  /* 6. Responsive layouts: 375 / 768 / 1024 px, no overflow, no em-dash */
  for (const [width, height, mobile] of [[375, 812, true], [768, 1024, true], [1024, 768, false]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    await ev(`SMD_RESEARCH.navigate('manuscript');1`);
    await sleep(200);

    ok(await until(`!!document.querySelector('.rmd-manuscript-screen')`, 5000), `manuscript screen renders at ${width}px`);
    ok(await noOverflow(), `no horizontal overflow at ${width}px`);
    ok(await noEmDash(), `no em-dash in UI text at ${width}px`);

    if (width === 375) {
      // Phone: view and approve only
      ok(await ev(`!!document.querySelector('.rmd-phone-notice')`), 'phone view notice visible at 375px');
      const phoneReadOnly = await ev(`(()=>{const t=document.querySelector('#rmdSectionText');return t&&(t.disabled||t.readOnly)})()`);
      ok(phoneReadOnly, 'editor is view-only (disabled) on phone at 375px');
      ok(await ev(`!!document.querySelector('[data-rmd-phone-tab="approve"]')`), 'phone offers approve tab at 375px');
    }

    if (width >= 768) {
      // Tablet/desktop: two-pane layout
      ok(await ev(`(()=>{const l=document.querySelector('.rmd-man-left');const r=document.querySelector('.rmd-man-right');return l&&r&&getComputedStyle(l).display!=='none'&&getComputedStyle(r).display!=='none'})()`), `two-pane visible at ${width}px`);
    }
  }

  /* 7. No page errors, Escape closes */
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
