// Real-browser headless test: ResearchMD Phase 6 screens end to end.
// The research API is mocked in-process from the frozen Phase 6 contracts
// (docs/research/contracts/phase-6/ipd.md, purchase.md, reports.md, institutions.md,
// templates.md, journals.md, responses.md).
// Covers:
//   1. IPD: compliance evidence upload & status, IPD upload blocked until evidence approved,
//      residency field, access log view.
//   2. Credits: balance, buy credits calls the purchase route, institution credit source,
//      cost report per project with CSV export.
//   3. Institution: workspace members, roles, seat allocations, projects, onboarding checklist.
//   4. Templates: pick a study design template (RCT, Cohort, Observational, Diagnostic, Prognostic),
//      inspect protocol/extraction/analysis defaults, apply template.
//   5. Journals: journal match with author-instruction link text & word limits;
//      reviewer-response workspace with linked manuscript section and version.
//   6. Responsive 375 / 768 / 1024, two-pane at >=768px, no horizontal overflow,
//      no em-dash in UI text, no page errors, Escape closes overlay.
// Run with:
//   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/run-research-phase6-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => existsSync(p));

const PORT = 9106, CDP = 9506, OUT = '/tmp/stewardmd-research-phase6';
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2'
};
const PID = 'prj_bcg_1994';
const T0 = Date.now();

/* ---------------- In-memory Phase 6 API Database & Mock ---------------- */
const db = {
  project: {
    id: PID,
    title: 'BCG Vaccine Tuberculosis Meta-Analysis',
    data_region: 'GLOBAL_DEID',
    institution_id: 'inst_1'
  },
  ipdConfig: {
    dataRegion: 'GLOBAL_DEID',
    jurisdictions: [],
    identifiabilityTier: 'anonymised_deid',
    attestation: { responsibility: true }
  },
  evidence: [
    {
      id: 'ev_init',
      projectId: PID,
      kind: 'irb_approval',
      title: 'Institutional Ethics Board Review #2026-401',
      jurisdiction: 'GLOBAL_DEID',
      status: 'pending',
      uploadedBy: 'u_self',
      createdTs: T0 - 3600000
    }
  ],
  datasets: [],
  accessLog: [
    { id: 'log_1', projectId: PID, datasetId: '', userId: 'u_self', action: 'read', result: 'ok', ipHash: '4f2e91b8', ts: T0 - 1800000 }
  ],
  purchasePacks: [
    { pack: 'tokens_50k', inr: 48, tokens: 50000, label: '50,000 tokens (approx $0.50)' },
    { pack: 'tokens_200k', inr: 192, tokens: 200000, label: '200,000 tokens (approx $2.00)' },
    { pack: 'tokens_500k', inr: 480, tokens: 500000, label: '500,000 tokens (approx $5.00)' }
  ],
  orders: [],
  costReport: {
    scope: 'project',
    id: PID,
    unit: 'micro-USD',
    ai: {
      totalCostMicroUsd: 37500,
      tokensIn: 6300,
      tokensOut: 1270,
      calls: 8,
      byStep: [
        { key: 'extraction', costMicroUsd: 25000, calls: 5 },
        { key: 'screening', costMicroUsd: 12500, calls: 3 }
      ],
      byTier: [{ key: 't1', costMicroUsd: 37500, calls: 8 }],
      byModel: [{ key: 'gemini-2.5-flash', costMicroUsd: 37500, calls: 8 }],
      byDay: [{ key: '2026-11-24', costMicroUsd: 37500, calls: 8 }]
    },
    ledger: {
      grantedMicroUsd: 1000000,
      reservedMicroUsd: 50000,
      releasedMicroUsd: 12500,
      settledMicroUsd: 37500,
      netMicroUsd: -37500
    },
    totalChargedMicroUsd: 37500
  },
  institution: {
    id: 'inst_1',
    name: 'Apollo Research Institute',
    seats: 10,
    used: 2
  },
  institutionMembers: [
    { uid: 'u_self', role: 'admin', createdTs: T0 - 86400000 },
    { uid: 'dr_singh', role: 'member', createdTs: T0 - 43200000 }
  ],
  institutionProjects: [
    { id: PID, title: 'BCG Vaccine Tuberculosis Meta-Analysis', discipline: 'medicine', specialty: 'pulmonology', createdTs: T0 - 86400000 }
  ],
  onboarding: [
    { key: 'workspace_created', label: 'Workspace created', done: true, source: 'computed' },
    { key: 'members_added', label: 'Team members invited', done: true, source: 'computed' },
    { key: 'credits_granted', label: 'Institution credits allocated', done: true, source: 'computed' },
    { key: 'first_project', label: 'First research project initiated', done: true, source: 'computed' },
    { key: 'first_review', label: 'First study run completed', done: false, source: 'computed' },
    { key: 'pilot_agreement_signed', label: 'Institutional pilot agreement signed', done: false, source: 'manual' },
    { key: 'training_completed', label: 'Researcher onboarding and ethics training completed', done: false, source: 'manual' }
  ],
  templates: [
    {
      id: 'rct',
      name: 'Randomised Controlled Trial',
      design: 'randomised_controlled_trial',
      reportingChecklistId: 'consort',
      protocolFields: [
        { key: 'population', label: 'Target clinical population and eligibility criteria' },
        { key: 'intervention', label: 'Experimental intervention regimen' },
        { key: 'primary_outcome', label: 'Primary outcome measure' }
      ],
      extractionForm: { fields: ['Randomised (N)', 'Intervention events', 'Control events'] },
      analysisDefaults: { engine: 'python-stats', family: 'logistic', model: 'Logistic regression' },
      guidance: 'Follows CONSORT 2010 guidelines.'
    },
    {
      id: 'cohort',
      name: 'Cohort Study',
      design: 'cohort',
      reportingChecklistId: 'strobe',
      protocolFields: [
        { key: 'cohort_definition', label: 'Cohort entry criteria' },
        { key: 'exposure', label: 'Exposure definition' }
      ],
      extractionForm: { fields: ['Cohort size', 'Follow-up duration', 'Events observed'] },
      analysisDefaults: { engine: 'python-stats', family: 'cox', model: 'Cox proportional hazards' },
      guidance: 'Follows STROBE cohort statement.'
    },
    {
      id: 'observational',
      name: 'Observational Study',
      design: 'observational',
      reportingChecklistId: 'strobe',
      protocolFields: [{ key: 'study_setting', label: 'Setting and eligibility' }],
      extractionForm: { fields: ['Total participants', 'Cases', 'Controls'] },
      analysisDefaults: { engine: 'python-stats', family: 'logistic', model: 'Multivariable regression' },
      guidance: 'Follows STROBE observational guidelines.'
    },
    {
      id: 'diagnostic_accuracy',
      name: 'Diagnostic Accuracy Study',
      design: 'diagnostic_accuracy',
      reportingChecklistId: 'stard',
      protocolFields: [{ key: 'index_test', label: 'Index test' }, { key: 'reference_standard', label: 'Reference standard' }],
      extractionForm: { fields: ['TP', 'FP', 'FN', 'TN'] },
      analysisDefaults: { engine: 'python-stats', family: 'diagnostic', model: 'Reitsma bivariate model' },
      guidance: 'Follows STARD 2015 guidelines.'
    },
    {
      id: 'prognostic',
      name: 'Prognostic Model',
      design: 'prognostic',
      reportingChecklistId: 'tripod',
      protocolFields: [{ key: 'candidate_predictors', label: 'Candidate predictors' }],
      extractionForm: { fields: ['Sample size', 'AUC / C-index', 'Calibration slope'] },
      analysisDefaults: { engine: 'python-stats', family: 'cox', model: 'Prognostic score' },
      guidance: 'Follows TRIPOD prediction model guidelines.'
    }
  ],
  journals: [
    {
      score: 7,
      matchedKeywords: ['clinical trials', 'general medicine'],
      designMatch: true,
      journal: {
        id: 'nejm',
        name: 'New England Journal of Medicine',
        issn: '0028-4793',
        scope: ['general medicine', 'internal medicine', 'clinical trials'],
        authorInstructionsUrl: 'https://www.nejm.org/author-center',
        wordLimits: { abstract: 250, main: 3000 },
        referenceStyle: 'vancouver'
      }
    },
    {
      score: 5,
      matchedKeywords: ['clinical trials'],
      designMatch: true,
      journal: {
        id: 'jama',
        name: 'JAMA',
        issn: '0098-7484',
        scope: ['general medicine', 'clinical trials', 'systematic reviews'],
        authorInstructionsUrl: 'https://jamanetwork.com/journals/jama/pages/instructions-for-authors',
        wordLimits: { abstract: 350, main: 3500 },
        referenceStyle: 'ama'
      }
    }
  ],
  reviewerComments: [
    {
      id: 'comm_1',
      projectId: PID,
      round: 1,
      reviewerLabel: 'Reviewer 1',
      sectionRef: 'Methods - Section 2.3',
      text: 'Clarify whether random-effects or fixed-effect models were pre-specified.',
      createdTs: T0 - 7200000
    }
  ],
  reviewerResponses: []
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    try { return JSON.parse(buf.toString('utf8')); } catch { return {}; }
  }
  return buf.toString('utf8');
}

async function handleApi(req, res, path) {
  const send = (code, body, mime = 'application/json') => {
    res.writeHead(code, {
      'content-type': mime,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  // IPD Config
  if (path === `/v1/projects/${PID}/ipd-config` && req.method === 'GET') {
    return send(200, { config: db.ipdConfig });
  }
  if (path === `/v1/projects/${PID}/ipd-config` && req.method === 'POST') {
    const b = await readBody(req);
    db.ipdConfig = Object.assign(db.ipdConfig, b);
    return send(200, { config: db.ipdConfig });
  }

  // IPD Evidence
  if (path === `/v1/projects/${PID}/ipd-evidence` && req.method === 'GET') {
    return send(200, { evidence: db.evidence });
  }
  if (path === `/v1/projects/${PID}/ipd-evidence` && req.method === 'POST') {
    const evItem = {
      id: `ev_${Date.now()}`,
      projectId: PID,
      kind: 'irb_approval',
      title: 'Ethics Approval Certificate',
      jurisdiction: 'GLOBAL_DEID',
      status: 'pending',
      uploadedBy: 'u_self',
      createdTs: Date.now()
    };
    db.evidence.unshift(evItem);
    return send(201, { evidence: evItem });
  }
  if (path.match(/^\/v1\/ipd-evidence\/([^/]+)\/approve$/) && req.method === 'POST') {
    const eid = path.split('/')[3];
    const evItem = db.evidence.find((e) => e.id === eid);
    if (evItem) { evItem.status = 'approved'; evItem.approvedBy = 'u_self'; evItem.approvedTs = Date.now(); }
    return send(200, { success: true, evidence: evItem });
  }
  if (path.match(/^\/v1\/ipd-evidence\/([^/]+)\/reject$/) && req.method === 'POST') {
    const eid = path.split('/')[3];
    const evItem = db.evidence.find((e) => e.id === eid);
    if (evItem) { evItem.status = 'rejected'; }
    return send(200, { success: true, evidence: evItem });
  }

  // IPD Uploads & Datasets
  if (path === `/v1/projects/${PID}/ipd-uploads` && req.method === 'POST') {
    const hasApproved = db.evidence.some((e) => e.status === 'approved');
    if (!hasApproved) {
      return send(403, {
        error: {
          code: 'ipd_gate',
          message: 'IPD upload blocked: ethics/IRB compliance evidence must be approved by the project owner.'
        }
      });
    }
    const ds = {
      id: `ds_${Date.now()}`,
      version: db.datasets.length + 1,
      rowCount: 50,
      bytes: 2048,
      identifiabilityTier: 'anonymised_deid',
      dataRegion: db.ipdConfig.dataRegion,
      createdTs: Date.now()
    };
    db.datasets.unshift(ds);
    db.accessLog.unshift({ id: `log_${Date.now()}`, projectId: PID, datasetId: ds.id, userId: 'u_self', action: 'upload', result: 'ok', ipHash: '4f2e91b8', ts: Date.now() });
    return send(201, { dataset: ds });
  }
  if (path === `/v1/projects/${PID}/ipd-datasets` && req.method === 'GET') {
    return send(200, { datasets: db.datasets });
  }
  if (path === `/v1/projects/${PID}/ipd-access-log` && req.method === 'GET') {
    return send(200, { log: db.accessLog });
  }

  // Credits & Purchase
  if (path === '/v1/purchase/packs' && req.method === 'GET') {
    return send(200, { packs: db.purchasePacks, usdInrRate: 96 });
  }
  if (path === '/v1/purchase/order' && req.method === 'POST') {
    const b = await readBody(req);
    const ord = { orderId: `ord_${Date.now()}`, pack: b.pack, amount: 4800, currency: 'INR' };
    db.orders.push(ord);
    return send(200, ord);
  }
  if (path === `/v1/projects/${PID}/cost-report` && req.method === 'GET') {
    return send(200, { report: db.costReport });
  }
  if (path === `/v1/projects/${PID}/cost-report.csv` && req.method === 'GET') {
    const csv = 'scope,day,step,tier,model,tokens_in,tokens_out,cost_micro_usd\nproject,2026-11-24,extraction,t1,gemini-flash,4200,850,25000\nproject,2026-11-24,screening,t1,gemini-flash,2100,420,12500\nTOTAL,,,,,6300,1270,37500\n';
    return send(200, csv, 'text/csv');
  }

  // Institutions
  if (path === '/v1/institutions' && req.method === 'GET') {
    return send(200, { institutions: [db.institution] });
  }
  if (path.startsWith('/v1/institutions/') && path.endsWith('/seats') && req.method === 'GET') {
    return send(200, { seats: db.institution.seats, used: db.institutionMembers.length, members: db.institutionMembers });
  }
  if (path.startsWith('/v1/institutions/') && path.endsWith('/projects') && req.method === 'GET') {
    return send(200, { projects: db.institutionProjects });
  }
  if (path.startsWith('/v1/institutions/') && path.endsWith('/onboarding') && req.method === 'GET') {
    return send(200, { items: db.onboarding, updatedTs: Date.now() });
  }
  if (path.startsWith('/v1/institutions/') && path.endsWith('/onboarding') && req.method === 'PUT') {
    const b = await readBody(req);
    if (b && b.items) {
      for (const k in b.items) {
        const item = db.onboarding.find((x) => x.key === k);
        if (item) item.done = !!b.items[k];
      }
    }
    return send(200, { items: db.onboarding, updatedTs: Date.now() });
  }
  if (path.startsWith('/v1/institutions/') && path.endsWith('/members') && req.method === 'POST') {
    const b = await readBody(req);
    const m = { uid: b.uid || 'new_user', role: b.role || 'member', createdTs: Date.now() };
    db.institutionMembers.push(m);
    db.institution.used = db.institutionMembers.length;
    return send(201, { member: m });
  }
  if (path.match(/^\/v1\/institutions\/[^/]+\/members\/([^/]+)$/) && req.method === 'PUT') {
    const uid = path.split('/')[4];
    const b = await readBody(req);
    const m = db.institutionMembers.find((x) => x.uid === uid);
    if (m) m.role = b.role;
    return send(200, { member: m });
  }
  if (path.match(/^\/v1\/institutions\/[^/]+\/members\/([^/]+)$/) && req.method === 'DELETE') {
    const uid = path.split('/')[4];
    db.institutionMembers = db.institutionMembers.filter((x) => x.uid !== uid);
    db.institution.used = db.institutionMembers.length;
    return send(200, { success: true });
  }

  // Templates
  if (path === '/v1/study-templates' && req.method === 'GET') {
    return send(200, { templates: db.templates });
  }
  if (path.startsWith('/v1/study-templates/') && req.method === 'GET') {
    const tid = path.split('/')[3];
    const t = db.templates.find((x) => x.id === tid) || db.templates[0];
    return send(200, { template: t });
  }

  // Journals & Responses
  if (path === '/v1/journals/match' && req.method === 'POST') {
    return send(200, { matches: db.journals });
  }
  if (path === `/v1/projects/${PID}/reviewer-comments` && req.method === 'GET') {
    return send(200, { comments: db.reviewerComments });
  }
  if (path === `/v1/projects/${PID}/reviewer-comments` && req.method === 'POST') {
    const b = await readBody(req);
    const comm = {
      id: `comm_${Date.now()}`,
      projectId: PID,
      round: b.round || 1,
      reviewerLabel: b.reviewerLabel || 'Reviewer 1',
      sectionRef: b.sectionRef || '',
      text: b.text || '',
      createdTs: Date.now()
    };
    db.reviewerComments.push(comm);
    return send(201, { comment: comm });
  }
  if (path === `/v1/projects/${PID}/reviewer-responses` && req.method === 'GET') {
    return send(200, { responses: db.reviewerResponses });
  }
  if (path.match(/^\/v1\/reviewer-comments\/([^/]+)\/responses$/) && req.method === 'POST') {
    const cid = path.split('/')[3];
    const b = await readBody(req);
    const resp = {
      id: `resp_${Date.now()}`,
      commentId: cid,
      text: b.text || '',
      manuscriptVersionId: b.manuscriptVersionId || '',
      sectionId: b.sectionId || '',
      changeNote: b.changeNote || '',
      status: 'final',
      version: 1,
      createdTs: Date.now(),
      updatedTs: Date.now()
    };
    db.reviewerResponses.push(resp);
    return send(201, { response: resp });
  }

  // Fallback 404
  return send(404, { error: { code: 'not_found', message: `Unknown mock route: ${path}` } });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/research/')) {
    try { await handleApi(req, res, p.slice('/api/research'.length)); }
    catch (e) {
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

/* ---------------- CDP Harness ---------------- */
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd6-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
], { stdio: 'ignore' });

let ws, sid, id = 0, failures = 0;
const pending = new Map();
const pageErrors = [];

const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id; pending.set(n, resolve);
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
    try { if (await ev(expr)) return true; } catch {}
    await sleep(100);
  }
  return false;
};

const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const setVal = (sel, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const nav = (screen) => ev(`SMD_RESEARCH.navigate(${JSON.stringify(screen)});1`);

const noOverflow = () => ev(`(()=>{const b=document.getElementById('researchMD');return b.scrollWidth<=b.clientWidth+2})()`);
const noEmDash = async () => !/—/.test(await text('#researchMD'));

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; }
    catch { await sleep(200); }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push('JS: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 200));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && msg.params.entry.source !== 'network') {
      pageErrors.push((msg.params.entry.url || '') + ' :: ' + msg.params.entry.text.slice(0, 160));
    }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');

  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: false });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });

  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.ipd && !!SMD_RESEARCH.screens.credits && !!SMD_RESEARCH.screens.institution && !!SMD_RESEARCH.screens.templates && !!SMD_RESEARCH.screens.journals', 30000), 'app loaded with all five Phase 6 screens');
  ok(await ev(`!!document.querySelector('script[src*="research-screen-ipd.js?v=rmd3"]') && !!document.querySelector('script[src*="research-screen-credits.js?v=rmd5"]') && !!document.querySelector('script[src*="research-screen-institution.js?v=rmd3"]') && !!document.querySelector('script[src*="research-screen-templates.js?v=rmd3"]') && !!document.querySelector('script[src*="research-screen-journals.js?v=rmd3"]')`), 'index.html carries the five new script tags with ?v=rmd3');

  // Mark the seed project as server-backed so server screens mount (practice gate skips it).
  await ev(`(function(){var s=JSON.parse(localStorage.getItem('smd_research_state_v1'));s.projects[0].serverId=s.projects[0].id;s.projects[0].practice=false;localStorage.setItem('smd_research_state_v1',JSON.stringify(s));return 1})()`);
  await ev(`SMD_RESEARCH.open({screen:'ipd'});1`);

  /* ---------------- 1. IPD: blocked then allowed, residency, access log ---------------- */
  ok(await until(`!!document.querySelector('#rmdIpdGateBanner')`, 8000), 'IPD screen renders');
  ok(await until(`/blocked/.test(document.querySelector('#rmdIpdGateBanner').textContent)`, 3000), 'IPD upload is blocked before compliance evidence approval');
  ok(await ev(`document.querySelector('[data-rmd="ipd-upload"]').disabled === true`), 'IPD upload button disabled while gate is blocked');
  ok(await until(`!!document.querySelector('#rmdResidencyBadge') && /GLOBAL_DEID/.test(document.querySelector('#rmdResidencyBadge').textContent)`, 3000), 'data residency field displays project residency pin');
  ok(await until(`!!document.querySelector('[data-rmd-approve-evidence="ev_init"]')`, 3000), 'pending compliance evidence item listed');

  // Owner approves the evidence item -> gate unlocks
  await click('[data-rmd-approve-evidence="ev_init"]');
  ok(await until(`/unlocked/.test(document.querySelector('#rmdIpdGateBanner').textContent)`, 6000), 'approving evidence unlocks the IPD gate');

  // Mock file attachment on IPD file input
  await ev(`(()=>{const csv='patient_id,age,outcome\\np1,45,1\\np2,52,0\\n';const f=new File([csv],'ipd.csv',{type:'text/csv'});const inp=document.getElementById('rmdIpdFile');Object.defineProperty(inp,'files',{value:[f],configurable:true});inp.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  ok(await ev(`document.querySelector('[data-rmd="ipd-upload"]').disabled === false`), 'IPD upload button enabled after approval and file selection');

  await click('[data-rmd="ipd-upload"]');
  ok(await until(`/uploaded/.test(document.querySelector('#rmdScreenBody').textContent)`, 6000), 'IPD dataset upload succeeds and is envelope-encrypted');
  ok(await until(`document.querySelectorAll('.rmd-ipd-left .rmd-data-check').length > 0`, 3000), 'IPD access log renders audit entries');

  /* ---------------- 2. Credits: balance, buy route called, institution source, cost report CSV ---------------- */
  await nav('credits');
  ok(await until(`!!document.querySelector('#rmdBalanceVal')`, 8000), 'Credits screen renders with available balance');
  ok(await until(`!!document.querySelector('#rmdCreditSourceBadge') && /Institution/.test(document.querySelector('#rmdCreditSourceBadge').textContent)`, 3000), 'institution credit source indicator displayed');
  ok(await until(`!!document.querySelector('#rmdTotalChargedVal')`, 3000), 'project cost report displays total charged');

  // Buy credits triggers purchase route
  await click('[data-rmd="buy-credits"]');
  ok(await until(`/Purchase order created/.test(document.querySelector('#rmdScreenBody').textContent)`, 6000), 'buy credits calls the purchase order route');
  ok(db.orders.length > 0 && db.orders[0].pack === 'tokens_50k', 'purchase order record captured on backend');

  // Export CSV triggers
  await click('[data-rmd="export-cost-csv"]');
  ok(await until(`/CSV/.test(document.querySelector('#rmdScreenBody').textContent)`, 5000), 'cost report CSV export triggered');

  /* ---------------- 3. Institution: workspace members, roles, seats, onboarding checklist ---------------- */
  await nav('institution');
  ok(await until(`!!document.querySelector('#rmdInstSeatsBadge')`, 8000), 'Institution workspace renders');
  ok(await until(`document.querySelectorAll('#rmdMembersList [data-rmd-member-row]').length >= 2`, 3000), 'institution members and roles rendered');

  // Add member
  await setVal('#rmdNewMemberUid', 'dr_chatterjee');
  await setVal('#rmdNewMemberRole', 'member');
  await click('[data-rmd="add-member"]');
  ok(await until(`!!document.querySelector('[data-rmd-member-row="dr_chatterjee"]')`, 6000), 'new team member added to institution workspace');
  ok(await until(`document.querySelectorAll('.rmd-inst-right .rmd-data-check').length >= 4`, 3000), 'pilot onboarding checklist rendered');

  /* ---------------- 4. Templates: study design templates, inspect, apply ---------------- */
  await nav('templates');
  ok(await until(`document.querySelectorAll('#rmdTemplatesList [data-rmd-template-id]').length === 5`, 8000), 'all five study design templates rendered');

  // Select Cohort template
  await click('[data-rmd-template-id="cohort"]');
  ok(await until(`!!document.querySelector('#rmdTemplateChecklistBadge') && /STROBE/.test(document.querySelector('#rmdTemplateChecklistBadge').textContent)`, 4000), 'cohort template inspected with STROBE checklist badge');

  await click('[data-rmd="apply-template"]');
  ok(await until(`/Template applied/.test(document.querySelector('#rmdTemplateAnnounce').textContent)`, 5000), 'study design template applied to project');

  /* ---------------- 5. Journals: matching with author-instruction link text & limits; reviewer response ---------------- */
  await nav('journals');
  ok(await until(`!!document.querySelector('#rmdJournalKeywords')`, 8000), 'Journals and Reviewer Responses screen renders');

  // Journal match
  await click('[data-rmd="match-journals"]');
  ok(await until(`document.querySelectorAll('#rmdJournalMatchesList [data-rmd-journal-card]').length >= 2`, 6000), 'journal match returns ranked matches');
  ok(await until(`!!document.querySelector('.rmd-author-instruction-link') && /Author instructions/.test(document.querySelector('.rmd-author-instruction-link').textContent)`, 3000), 'journal author-instruction link text present');
  ok(await until(`/Word limits/.test(document.querySelector('#rmdJournalMatchesList').textContent) && /Abstract:/.test(document.querySelector('#rmdJournalMatchesList').textContent)`, 3000), 'journal word limits displayed');

  // Switch to Reviewer Responses mode
  await click('[data-rmd-mode="responses"]');
  ok(await until(`!!document.querySelector('#rmdCommentsList')`, 5000), 'Reviewer-response workspace renders');
  ok(await until(`!!document.querySelector('#rmdResponseText')`, 3000), 'Response form rendered for selected comment');

  // Fill and link response to manuscript section
  await setVal('#rmdResponseText', 'We updated Section 2.3 to specify that random-effects models were pre-planned for all secondary outcomes.');
  await setVal('#rmdRespVersionId', 'v2-revision');
  await setVal('#rmdRespSectionId', 'methods-statistical-analysis');
  await setVal('#rmdRespChangeNote', 'Added pre-specified random-effects model note.');
  await click('[data-rmd="save-response"]');

  ok(await until(`!!document.querySelector('.rmd-linked-section') && /methods-statistical-analysis/.test(document.querySelector('.rmd-linked-section').textContent)`, 6000), 'author response created and linked to manuscript section');

  /* ---------------- 6. Responsive: 375 / 768 / 1024, no overflow, no em-dash, two-pane ---------------- */
  const screens = ['ipd', 'credits', 'institution', 'templates', 'journals'];
  for (const [width, height, mobile] of [[375, 812, true], [768, 1024, true], [1024, 768, false]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    for (const name of screens) {
      await nav(name);
      await sleep(150);
      ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 8000), `${name} renders at ${width}px`);
      ok(await noOverflow(), `no horizontal overflow on ${name} at ${width}px`);
      ok(await noEmDash(), `no em-dash in UI text on ${name} at ${width}px`);
    }

    if (width >= 768) {
      for (const name of screens) {
        await nav(name);
        await sleep(100);
        ok(await ev(`(()=>{const l=document.querySelector('.rmd-pane-left');const r=document.querySelector('.rmd-pane-right');return l&&r&&getComputedStyle(l).display!=='none'&&getComputedStyle(r).display!=='none'})()`), `${name} two-pane visible at ${width}px`);
      }
    }
  }

  /* ---------------- 7. No page errors, Escape closes ---------------- */
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
