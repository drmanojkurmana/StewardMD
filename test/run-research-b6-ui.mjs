// Real-browser headless test: ResearchMD Brief 6 screens (polish wording, format check, reference import).
// Covers:
//   A. "Ask MaiK: polish the wording" on manuscript sections:
//      - Tracked-changes view: old struck through (<del class="rmd-diff-del">), new highlighted (<ins class="rmd-diff-ins">)
//      - Reason chips (scientific term first, plain meaning in brackets)
//      - "Accept all", individual "Accept", individual "Reject"
//      - {{run:...}} token preservation (rejection when dropped/altered)
//      - 402 insufficient_credits displays "You need more MaiK tokens for this step." card
//   B. Journal format check:
//      - Link from manuscript top-actions to Ready to submit screen
//      - Format check card on Ready to submit screen with journal title
//      - Pass / warn / fail SVG icons (no emoji)
//      - Scientific label with plain meaning in brackets
//      - "Fix" button jumping directly to the targeted manuscript section
//   C. Reference file import:
//      - Export tips for Zotero, Mendeley, and EndNote
//      - File picker accepting .ris, .bib, .json, .xml, .nbib, .csv
//      - Entry count parsing for CSL-JSON, EndNote XML, NBIB, etc.
//      - Summary banner showing "42 added, 5 duplicates flagged"
//   D. Responsive layouts (375 / 768 px), no horizontal overflow, zero em/en dashes, zero page errors.
//
// Usage:
//   node test/run-research-b6-ui.mjs   (CHROME=/path/to/chrome to override)

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

const PORT = 9099, CDP = 9499;
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2'
};

const PID = 'prj_bcg_1994';
const T0 = '2026-11-20T10:00:00Z';

const RESULTS_TEXT = 'A total of {{run:run_1.k}} trials were included. The pooled relative risk was {{run:run_1.estimate}} (95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Between-study heterogeneity was observed (I2 {{run:run_1.i2}}, tau2 {{run:run_1.tau2}}).';

const POLISHED_TEXT = 'A total of {{run:run_1.k}} clinical trials were systematically evaluated. The pooled relative risk was {{run:run_1.estimate}} (95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Marked between-study heterogeneity was observed (I2 {{run:run_1.i2}}, tau2 {{run:run_1.tau2}}).';

const POLISH_CHANGES = [
  { before: 'trials were included.', after: 'clinical trials were systematically evaluated.', reason: 'academic tone' },
  { before: 'Between-study', after: 'Marked between-study', reason: 'clarity' }
];

/* ---------------- Mock In-Memory Database ---------------- */
const db = {
  project: {
    id: PID,
    title: 'BCG vaccination against tuberculosis: systematic review and meta-analysis',
    journal: 'jama',
    manuscript_journal: 'jama',
    targetJournal: 'jama',
    practice: false,
    serverId: PID,
    studyType: 'systematic_review'
  },
  manuscript: {
    id: 'man_v2',
    projectId: PID,
    version: 2,
    title: 'BCG vaccination against tuberculosis: systematic review and meta-analysis',
    authors: ['A. Clinician', 'B. Statistician'],
    affiliations: 'StewardMD Clinical Research Collaborative',
    status: 'draft',
    journal: 'jama',
    sections: [
      {
        id: 'abstract',
        heading: 'Abstract',
        level: 1,
        text: 'Objective: Evaluate BCG efficacy against tuberculosis.\nMethods: Systematic review of randomized trials.\nResults: BCG reduced tuberculosis risk (RR {{run:run_1.estimate}}, 95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}).\nConclusion: BCG vaccination demonstrates significant protective efficacy.'
      },
      {
        id: 'introduction',
        heading: 'Introduction',
        level: 1,
        text: 'Tuberculosis remains a major public health challenge worldwide [@who2023].'
      },
      {
        id: 'methods',
        heading: 'Methods',
        level: 1,
        text: 'We conducted a systematic review following PRISMA 2020 guidelines.'
      },
      { id: 'results', heading: 'Results', level: 1, text: RESULTS_TEXT },
      {
        id: 'discussion',
        heading: 'Discussion',
        level: 1,
        text: 'Our findings confirm substantial protective efficacy of BCG vaccination against clinical tuberculosis.'
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
  },
  formatChecks: [
    { check: 'total_word_count', status: 'pass', detail: 'Total manuscript word count: 2,450 (limit 3,500 words)' },
    { check: 'abstract_structure', status: 'pass', detail: 'Structured abstract with Objective, Methods, Results, Conclusion present (285 words, limit 300)', section: 'abstract' },
    { check: 'title_length', status: 'pass', detail: 'Title length: 82 characters (limit 150)' },
    { check: 'tables_figures_count', status: 'warn', detail: 'Found 5 display items (limit 4). Consider moving supplementary tables to appendix.', section: 'results' },
    { check: 'reference_count', status: 'pass', detail: '28 references cited (limit 30)' },
    { check: 'reference_style', status: 'pass', detail: 'Vancouver numbered citations consistently formatted' },
    { check: 'tokens_resolved', status: 'pass', detail: 'All 7 analysis result tokens successfully resolved' },
    { check: 'citation_bidirectional', status: 'pass', detail: 'Every cited reference is in the bibliography and vice versa' },
    { check: 'keywords_count', status: 'fail', detail: 'Only 2 keywords found (JAMA requires 3 to 6 keywords)', section: 'abstract' },
    { check: 'required_sections', status: 'pass', detail: 'IMRaD structure and declarations (ethics, funding, conflicts, data availability) present' },
    { check: 'reporting_checklist', status: 'warn', detail: 'PRISMA 2020 checklist is 82% complete (18 of 22 items filled)' }
  ]
};

let polishMode = 'success'; // 'success' | '402' | 'corrupt_tokens'
const draftCalls = [];
const importCalls = [];

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

  // POST /v1/projects/:projectId/ai-draft
  if (path.match(/^\/v1\/projects\/[^/]+\/ai-draft$/) && req.method === 'POST') {
    draftCalls.push(body);
    if (polishMode === '402') {
      return send(402, {
        error: { code: 'insufficient_credits', message: 'Insufficient credits for AI drafting' }
      });
    }
    if (polishMode === 'corrupt_tokens') {
      // Simulates an invalid AI response where a {{run:...}} token was dropped
      return send(200, {
        draft: {
          polished: 'All 13 trials were included without tokens.',
          changes: [{ before: 'trials were included.', after: 'trials were included without tokens.', reason: 'clarity' }]
        },
        model: 'gemini-2.5-flash',
        costInr: 0.35
      });
    }
    // Normal success
    return send(200, {
      draft: {
        polished: POLISHED_TEXT,
        changes: POLISH_CHANGES
      },
      model: 'gemini-2.5-flash',
      costInr: 0.40
    });
  }

  // GET /v1/projects/:projectId/format-check
  if (path.match(/^\/v1\/projects\/[^/]+\/format-check$/) && req.method === 'GET') {
    return send(200, { checks: db.formatChecks });
  }

  // GET /v1/projects/:projectId/manuscript
  if (path.match(/^\/v1\/projects\/[^/]+\/manuscript$/) && req.method === 'GET') {
    return send(200, { manuscript: db.manuscript });
  }

  // GET /v1/projects/:projectId/manuscript/versions
  if (path.match(/^\/v1\/projects\/[^/]+\/manuscript\/versions$/) && req.method === 'GET') {
    return send(200, { versions: [] });
  }

  // PUT /v1/projects/:projectId/manuscript/sections/:sectionId
  const secMatch = path.match(/^\/v1\/projects\/[^/]+\/manuscript\/sections\/([^/]+)$/);
  if (secMatch && req.method === 'PUT') {
    const sid = secMatch[1];
    const sec = db.manuscript.sections.find((s) => s.id === sid);
    if (sec && body.text !== undefined) sec.text = body.text;
    return send(200, { section: sec, version: db.manuscript.version, tokens: db.manuscript.tokens });
  }

  // GET /v1/projects/:projectId/searches
  if (path.match(/^\/v1\/projects\/[^/]+\/searches$/) && req.method === 'GET') {
    return send(200, { searchRuns: [], nextCursor: null });
  }

  // POST /v1/projects/:projectId/import-uploads
  if (path.match(/^\/v1\/projects\/[^/]+\/import-uploads$/) && req.method === 'POST') {
    return send(200, { storageKey: 'upload_key_abc_123' });
  }

  // POST /v1/projects/:projectId/imports
  if (path.match(/^\/v1\/projects\/[^/]+\/imports$/) && req.method === 'POST') {
    importCalls.push(body);
    return send(200, {
      id: 'imp_1',
      added: 42,
      duplicates: 5,
      recordsAdded: 42,
      duplicatesFlagged: 5,
      totalRecords: 47,
      status: 'completed'
    });
  }

  // GET /v1/projects/:projectId/studies
  if (path.match(/^\/v1\/projects\/[^/]+\/studies$/)) {
    return send(200, { studies: [] });
  }

  // GET /v1/projects/:projectId/checklist/snapshot
  if (path.match(/^\/v1\/projects\/[^/]+\/checklist(-snapshot|\/snapshot)$/)) {
    return send(200, { snapshot: { type: 'prisma', prisma: { studiesIncluded: 10 } }, completionPct: 82, filled: 18, total: 22 });
  }

  // GET /v1/checklists/:gid
  if (path.match(/^\/v1\/checklists\/[^/]+$/)) {
    return send(200, { checklist: { items: [] } });
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
  `--user-data-dir=/tmp/rmd-b6-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
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

const waitCond = async (fn, ms = 8000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await sleep(100);
  }
  return false;
};

const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const noOverflow = () => ev(`(()=>{const b=document.getElementById('researchMD');return b.scrollWidth<=b.clientWidth+2})()`);
const noDash = async () => !/[\u2014\u2013]/.test(await text('#researchMD'));

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

  // Seed state with our project
  await ev(`(function(){
    var s = JSON.parse(localStorage.getItem('smd_research_state_v1') || '{"projects":[]}');
    s.projects = s.projects || [];
    var p = s.projects.find(function(x){ return x.id === ${JSON.stringify(PID)}; });
    if (!p) {
      s.projects.unshift(${JSON.stringify(db.project)});
    } else {
      p.serverId = ${JSON.stringify(PID)};
      p.journal = 'jama';
      p.targetJournal = 'jama';
      p.practice = false;
    }
    s.activeProjectId = ${JSON.stringify(PID)};
    localStorage.setItem('smd_research_state_v1', JSON.stringify(s));
    return 1;
  })()`);

  // Open manuscript screen
  await ev(`SMD_RESEARCH.open({ screen: 'manuscript' }); 1;`);
  ok(await until(`!!document.querySelector('.rmd-manuscript-screen')`, 8000), 'manuscript screen renders');

  /* ========================================================================
   * FEATURE A: Ask MaiK: polish the wording (tracked-changes view)
   * ======================================================================== */
  console.log('\n--- Test A: Ask MaiK: polish the wording ---');

  // Check button exists
  ok(await ev(`!!document.querySelector('[data-rmd="polish-wording"]')`), '"Ask MaiK: polish the wording" button present in toolbar');
  const btnText = await text('[data-rmd="polish-wording"]');
  ok(btnText.includes('Ask MaiK: polish the wording') || btnText.includes('polish the wording'), 'polish button carries exact label');

  // Click polish button
  draftCalls.length = 0;
  await click('[data-rmd="polish-wording"]');

  // Verify API was called
  ok(await waitCond(() => draftCalls.length > 0), 'ai-draft endpoint called on polish click');
  ok(draftCalls[0] && draftCalls[0].task === 'polish', 'task is "polish"');
  ok(draftCalls[0] && draftCalls[0].input && draftCalls[0].input.sectionId === 'results', 'input includes sectionId "results"');
  ok(draftCalls[0] && draftCalls[0].input && draftCalls[0].input.text.includes('{{run:run_1.k}}'), 'input text carries {{run:...}} tokens');

  // Verify tracked-changes view appears
  ok(await until(`!!document.querySelector('.rmd-polish-card')`, 5000), 'tracked-changes review card rendered');
  ok(await ev(`!!document.querySelector('.rmd-diff-del')`), 'struck-through deletion rendered (<del class="rmd-diff-del">)');
  ok(await ev(`!!document.querySelector('.rmd-diff-ins')`), 'highlighted insertion rendered (<ins class="rmd-diff-ins">)');

  // Verify reason chips with scientific term first and plain meaning in brackets
  const reasonText = await text('.rmd-polish-card');
  ok(reasonText.includes('Academic tone') && reasonText.includes('formal scientific style'), 'reason chip carries "Academic tone (formal scientific style)"');
  ok(reasonText.includes('Clarity') && reasonText.includes('clear expression'), 'reason chip carries "Clarity (clear expression)"');

  // Verify action buttons
  ok(await ev(`!!document.querySelector('[data-rmd="polish-accept-all"]')`), '"Accept all" button present');
  ok(await ev(`!!document.querySelector('[data-rmd-polish-accept]')`), 'individual "Accept" button present');
  ok(await ev(`!!document.querySelector('[data-rmd-polish-reject]')`), 'individual "Reject" button present');
  ok(await ev(`!!document.querySelector('[data-rmd="polish-dismiss"]')`), 'Dismiss button present');

  // Test individual Accept
  await click('[data-rmd-polish-accept="0"]');
  await sleep(150);
  const editorAfterOne = await text('#rmdSectionEditor');
  ok(editorAfterOne.includes('clinical trials were systematically evaluated'), 'individual Accept applied first change');

  // Test individual Reject
  await click('[data-rmd-polish-reject="1"]');
  await sleep(150);

  // Test Accept All on fresh draft
  await click('[data-rmd="polish-wording"]');
  ok(await until(`!!document.querySelector('.rmd-polish-card')`, 5000), 'fresh polish draft rendered');
  await click('[data-rmd="polish-accept-all"]');
  await sleep(150);
  const editorAfterAll = await text('#rmdSectionEditor');
  ok(editorAfterAll.includes('Marked between-study heterogeneity'), 'Accept all applied remaining changes');
  ok(await ev(`!document.querySelector('.rmd-polish-card')`), 'tracked-changes card dismissed after Accept all');

  // Test Token Preservation failure
  console.log('\n--- Test A2: Token preservation rejection ---');
  polishMode = 'corrupt_tokens';
  await click('[data-rmd="polish-wording"]');
  ok(await until(`!!document.querySelector('.rmd-banner-warn') || !!document.querySelector('.rmd-banner-error') || /Token preservation failure/.test(document.body.innerText)`, 5000), 'draft rejected when tokens dropped');
  const alertText = await text('#researchMD');
  ok(alertText.includes('Token preservation failure') && alertText.includes('values changed or missing'), 'Token preservation failure banner shown with plain meaning');

  // Test 402 insufficient_credits
  console.log('\n--- Test A3: 402 insufficient_credits ---');
  polishMode = '402';
  await click('[data-rmd="polish-wording"]');
  ok(await until(`/You need more MaiK tokens for this step/.test(document.body.innerText)`, 5000), '402 renders "You need more MaiK tokens for this step." card');

  // Reset polish mode
  polishMode = 'success';


  /* ========================================================================
   * FEATURE B: Journal format check
   * ======================================================================== */
  console.log('\n--- Test B: Journal format check ---');

  // Link from manuscript screen
  ok(await ev(`!!document.querySelector('[data-rmd="to-format-check"]')`), '"Journal format check" button in top-bar actions');
  await click('[data-rmd="to-format-check"]');

  // Navigates to Ready to submit screen
  ok(await until(`!!document.querySelector('.rmd-ready-screen')`, 8000), 'navigates to Ready to submit screen');
  ok(await until(`!!document.querySelector('.rmd-format-check-card')`, 8000), 'Journal format check card renders');

  // Check card title and journal reference
  const checkCardText = await text('.rmd-format-check-card');
  ok(checkCardText.includes('Journal format check') && checkCardText.includes('JAMA'), 'format check card mentions journal (JAMA)');

  // Verify pass / warn / fail icons (SVG, no emoji)
  ok(await ev(`!!document.querySelector('.rmd-format-check-icon-pass svg')`), 'pass SVG icon rendered (no emoji)');
  ok(await ev(`!!document.querySelector('.rmd-format-check-icon-warn svg')`), 'warn SVG icon rendered (no emoji)');
  ok(await ev(`!!document.querySelector('.rmd-format-check-icon-fail svg')`), 'fail SVG icon rendered (no emoji)');
  ok(!/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(checkCardText), 'zero emoji in format check text or status icons');

  // Check scientific label with plain meaning in brackets
  ok(checkCardText.includes('Keywords') && checkCardText.includes('3 to 6 index terms for medical databases'), 'scientific label carries plain meaning: Keywords (3 to 6 index terms for medical databases)');
  ok(checkCardText.includes('Tables and figures limit') && checkCardText.includes('number of displays and illustrations'), 'scientific label carries plain meaning: Tables and figures limit (number of displays and illustrations)');
  ok(checkCardText.includes('Reporting checklist completion') && checkCardText.includes('adherence to publication guideline'), 'scientific label carries plain meaning: Reporting checklist completion (adherence to publication guideline)');

  // Verify "Fix" button jumping to right section
  ok(await ev(`!!document.querySelector('[data-rmd-fix-sec="abstract"]')`), 'Fix button present for abstract section item');
  await click('[data-rmd-fix-sec="abstract"]');
  ok(await until(`!!document.querySelector('.rmd-manuscript-screen')`, 8000), 'Fix button navigates back to manuscript screen');
  const currentHeading = await text('.rmd-editor-title');
  ok(currentHeading.includes('Abstract'), 'Fix button jumped directly to Abstract section editor');


  /* ========================================================================
   * FEATURE C: Reference file import in Search screen
   * ======================================================================== */
  console.log('\n--- Test C: Reference file import in Search screen ---');

  // Navigate to Search screen
  await ev(`SMD_RESEARCH.navigate('search'); 1;`);
  ok(await until(`!!document.querySelector('#rmd_import_file')`, 8000), 'Search screen renders with Import References panel');

  // File picker accepts .ris, .bib, .json, .xml, .nbib, .csv
  const acceptAttr = await ev(`(()=>{const i=document.querySelector('#rmd_import_file');return i?i.getAttribute('accept'):'';})()`);
  ok(acceptAttr.includes('.ris') && acceptAttr.includes('.bib') && acceptAttr.includes('.json') &&
     acceptAttr.includes('.xml') && acceptAttr.includes('.nbib') && acceptAttr.includes('.csv'),
     'file picker accepts .ris, .bib, .json, .xml, .nbib, .csv');

  // Verify export tips for Zotero, Mendeley, and EndNote
  const searchFullText = await text('#researchMD');
  ok(searchFullText.includes('Zotero') && (searchFullText.includes('Better CSL JSON') || searchFullText.includes('Export Collection')), 'Zotero export tip present');
  ok(searchFullText.includes('Mendeley') && (searchFullText.includes('CSL-JSON') || searchFullText.includes('Export')), 'Mendeley export tip present');
  ok(searchFullText.includes('EndNote') && (searchFullText.includes('EndNote XML') || searchFullText.includes('XML')), 'EndNote export tip present');

  // Test entry counting for CSL-JSON, EndNote XML, and NBIB
  const cslJsonSample = JSON.stringify([
    { id: 'item1', title: 'Paper 1', type: 'article-journal' },
    { id: 'item2', title: 'Paper 2', type: 'article-journal' }
  ]);
  const cslCount = await ev(`(function(){
    var s = SMD_RESEARCH.screens.search;
    return s && typeof s.countEntries === 'function' ? s.countEntries('csl_json', ${JSON.stringify(cslJsonSample)}) : -1;
  })()`);
  ok(cslCount === 2, `countEntries correctly counts 2 items in CSL-JSON (${cslCount})`);

  const endnoteXmlSample = '<xml><records><record><title>One</title></record><record><title>Two</title></record><record><title>Three</title></record></records></xml>';
  const xmlCount = await ev(`(function(){
    var s = SMD_RESEARCH.screens.search;
    return s && typeof s.countEntries === 'function' ? s.countEntries('endnote_xml', ${JSON.stringify(endnoteXmlSample)}) : -1;
  })()`);
  ok(xmlCount === 3, `countEntries correctly counts 3 items in EndNote XML (${xmlCount})`);

  const nbibSample = 'PMID- 123456\nTI  - First paper\n\nPMID- 234567\nTI  - Second paper\n';
  const nbibCount = await ev(`(function(){
    var s = SMD_RESEARCH.screens.search;
    return s && typeof s.countEntries === 'function' ? s.countEntries('nbib', ${JSON.stringify(nbibSample)}) : -1;
  })()`);
  ok(nbibCount === 2, `countEntries correctly counts 2 items in PubMed NBIB (${nbibCount})`);

  // Simulate file upload and import execution
  console.log('\n--- Test C2: Import execution & result summary ---');
  importCalls.length = 0;
  await ev(`(function(){
    var dt = new DataTransfer();
    var file = new File([${JSON.stringify(cslJsonSample)}], 'zotero_export.json', { type: 'application/json' });
    dt.items.add(file);
    var fi = document.querySelector('#rmd_import_file');
    fi.files = dt.files;
    fi.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(200);

  // Click import button
  await click('[data-rmd="import-run"]');
  ok(await waitCond(() => importCalls.length > 0), 'imports API called on submit');

  // Verify result summary wording: "42 added, 5 duplicates flagged"
  ok(await until(`/42 added, 5 duplicates flagged/.test(document.body.innerText)`, 5000), 'import result banner renders');
  const resultSummary = await text('#researchMD');
  ok(resultSummary.includes('42 added, 5 duplicates flagged'), 'result summary carries exact required wording "42 added, 5 duplicates flagged"');


  /* ========================================================================
   * FEATURE D: Responsive, no dashes, no overflow, no page errors
   * ======================================================================== */
  console.log('\n--- Test D: Responsive, typography, and polish ---');

  for (const [width, height, mobile] of [[375, 812, true], [768, 1024, true]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });

    // Manuscript screen at this viewport
    await ev(`SMD_RESEARCH.navigate('manuscript'); 1;`);
    await sleep(200);
    ok(await until(`!!document.querySelector('.rmd-manuscript-screen')`, 5000), `manuscript renders at ${width}px`);
    ok(await noOverflow(), `no horizontal overflow on manuscript at ${width}px`);
    ok(await noDash(), `no em/en dashes in manuscript UI text at ${width}px`);

    // Ready to submit screen at this viewport
    await ev(`SMD_RESEARCH.navigate('ready'); 1;`);
    await sleep(200);
    ok(await until(`!!document.querySelector('.rmd-ready-screen')`, 5000), `ready screen renders at ${width}px`);
    ok(await noOverflow(), `no horizontal overflow on ready screen at ${width}px`);
    ok(await noDash(), `no em/en dashes in ready screen UI text at ${width}px`);

    // Search screen at this viewport
    await ev(`SMD_RESEARCH.navigate('search'); 1;`);
    await sleep(200);
    ok(await until(`!!document.querySelector('#rmd_import_file')`, 5000), `search screen renders at ${width}px`);
    ok(await noOverflow(), `no horizontal overflow on search screen at ${width}px`);
    ok(await noDash(), `no em/en dashes in search screen UI text at ${width}px`);
  }

  // Page errors check
  if (pageErrors.length) console.log('PAGE ERRORS:\n' + pageErrors.join('\n'));
  ok(pageErrors.length === 0, `zero page errors across entire test run (${pageErrors.length})`);

  // Close overlay with Escape
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 })); 1;`);
  ok(await ev(`getComputedStyle(document.getElementById('researchMD')).display === 'none'`), 'Escape cleanly closes the ResearchMD overlay');

} catch (e) {
  console.log('FAIL exception:', e.message, e.stack);
  failures++;
} finally {
  try { ws.close(); } catch {}
  chrome.kill();
  server.close();
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
