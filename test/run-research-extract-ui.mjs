// Real-browser headless test: ResearchMD Extraction screen Bug C regression suite.
// Covers:
// 1. Opening form with no PDF makes no 422/409 requests; tapping Ask MaiK shows plain guidance (no 409 banner).
// 2. Running PDF job: opening form shows no 409 error banner; tapping Ask MaiK shows "MaiK is reading the paper",
//    polls /v1/jobs/:id until succeeded, then requests suggestions and renders them.
// 3. Running job polling timeout / failure shows plain guidance (never "on our side").
// 4. Saving/promoting with an unverified required field shows the plain field message
//    ("Verify Events (intervention) first: capture its quote or correct it"); navigating away and back clears transient
//    banners and makes no 422 request on open.
//   node test/run-research-extract-ui.mjs
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
const T0 = 1763000000000;

const TEMPLATES = [
  { id: 'rct_binary', label: 'RCT binary outcome', measures: ['RR', 'OR', 'RD'], fields: [
    { key: 'events1', label: 'Events (intervention)', type: 'integer', required: true },
    { key: 'n1', label: 'N (intervention)', type: 'integer', required: true },
    { key: 'events2', label: 'Events (control)', type: 'integer', required: true },
    { key: 'n2', label: 'N (control)', type: 'integer', required: true } ] }
];

function makeWords(text, x, y) {
  const out = []; let cx = x;
  for (const t of text.split(' ')) {
    const w = t.length * 6.2;
    out.push({ t, x0: +cx.toFixed(2), y0: y, x1: +(cx + w).toFixed(2), y1: y + 11 });
    cx += w + 4;
  }
  return out;
}
const RESULT = {
  jobId: 'job_run', idempotencyKey: 'k_run', status: 'done', usage: { pages: 1, seconds: 1.0 },
  ocr: false, sha256: 'd'.repeat(64),
  pages: [
    { n: 1, width: 612, height: 792, ocr: false, text: '27 cases among 16913 vaccinated; 29 cases among 17854 controls',
      words: makeWords('27 cases among 16913 vaccinated; 29 cases among 17854 controls', 72, 100), tables: [] }
  ]
};

const apiLog = [];
const state = {
  jobPolls: 0,
  jobMode: 'succeed_after_2', // 'succeed_after_2' | 'never_finish'
  studies: [
    { id: 'st_nopdf', projectId: PID, label: 'Comstock et al 1976', measure: 'RR', inputs: {}, locator: { kind: 'manual', citation: 'Comstock 1976' }, verified: false, version: 1, createdAt: T0, updatedAt: T0 },
    { id: 'st_running', projectId: PID, label: 'Aronson 1948', measure: 'RR', inputs: {}, locator: { kind: 'manual', citation: 'Aronson 1948' }, verified: false, version: 1, createdAt: T0, updatedAt: T0 }
  ],
  artifacts: [
    { id: 'art_run', projectId: PID, filename: 'aronson1948.pdf', sha256: 'd'.repeat(64), bytes: 1024, pages: 1, status: 'running', jobId: 'job_run', createdTs: T0 }
  ],
  extractions: {
    st_nopdf: { id: 'ext_nopdf', projectId: PID, studyId: 'st_nopdf', artifactId: null, template: 'rct_binary', status: 'draft', version: 1, fields: {}, suggestions: [], createdBy: 'u_self', createdTs: T0, updatedTs: T0 },
    st_running: { id: 'ext_running', projectId: PID, studyId: 'st_running', artifactId: 'art_run', template: 'rct_binary', status: 'draft', version: 1, fields: {}, suggestions: [], createdBy: 'u_self', createdTs: T0, updatedTs: T0 }
  }
};
function extById(id) { for (const k in state.extractions) if (state.extractions[k].id === id) return state.extractions[k]; return null; }
function envelope(code, message, extra) { return Object.assign({ error: { code, message, requestId: 'req_mock' } }, extra || {}); }

async function handleApi(req, res, path) {
  const send = (status, body) => {
    apiLog.push({ method: req.method, path, status });
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') { try { body = raw ? JSON.parse(raw) : {}; } catch {} }
  const m = (re) => path.match(re); let mm;

  if (path === `/v1/projects/${PID}/studies` && req.method === 'GET') return send(200, { studies: state.studies });
  if (path === '/v1/extraction-templates' && req.method === 'GET') return send(200, { templates: TEMPLATES });
  if (path === `/v1/projects/${PID}/artifacts` && req.method === 'GET') return send(200, { artifacts: state.artifacts });

  if ((mm = m(/^\/v1\/projects\/[^/]+\/studies\/([^/]+)\/extraction$/))) {
    const sid = mm[1];
    if (req.method === 'GET') return send(200, { extraction: state.extractions[sid] });
    if (req.method === 'PUT') {
      const ex = state.extractions[sid];
      if (body.artifactId !== undefined) ex.artifactId = body.artifactId;
      for (const k in (body.fields || {})) {
        const f = body.fields[k];
        ex.fields[k] = { value: f.value, locator: f.locator || null, quote: f.quote || '', status: 'unverified', source: 'human', verifier: null, verifiedAt: null };
      }
      ex.version++;
      return send(200, { extraction: ex });
    }
  }
  if ((mm = m(/^\/v1\/projects\/[^/]+\/studies\/([^/]+)\/extraction\/suggestions$/)) && req.method === 'POST') {
    const sid = mm[1];
    const ex = state.extractions[sid];
    const artId = body.artifactId || ex.artifactId;
    if (!artId) return send(409, envelope('pdf_not_attached', 'Attach the study PDF on the Page tab first before asking MaiK to draft.'));
    const art = state.artifacts.find((a) => a.id === artId);
    if (!art || art.status !== 'succeeded') {
      return send(409, envelope('job_not_done', 'MaiK is still reading the paper.', { jobId: art ? art.jobId : 'job_run', jobStatus: art ? art.status : 'running' }));
    }
    ex.suggestions = [
      { id: 'sug_run_1', fieldKey: 'events1', value: 27, locator: { kind: 'pdf', citation: 'aronson1948.pdf', page: 1, pdf: { artifactId: art.id, page: 1 } }, quote: '27 cases among 16913 vaccinated', model: 't1-mock', status: 'unverified', createdTs: T0 }
    ];
    return send(200, { extraction: ex, added: 1, requestId: 'req_mock' });
  }
  if ((mm = m(/^\/v1\/jobs\/([^/]+)$/)) && req.method === 'GET') {
    state.jobPolls++;
    const art = state.artifacts.find((a) => a.jobId === mm[1]);
    if (state.jobMode === 'succeed_after_2' && state.jobPolls >= 3) {
      if (art) art.status = 'succeeded';
      return send(200, { job: { id: mm[1], projectId: PID, kind: 'pdf_extract', status: 'succeeded', usage: { pages: 1, seconds: 1 }, createdTs: T0, completedTs: T0 } });
    }
    return send(200, { job: { id: mm[1], projectId: PID, kind: 'pdf_extract', status: 'running', usage: {}, createdTs: T0 } });
  }
  if ((mm = m(/^\/v1\/artifacts\/([^/]+)\/result$/)) && req.method === 'GET') {
    const art = state.artifacts.find((a) => a.id === mm[1]);
    if (!art) return send(404, envelope('artifact_not_found', 'Artifact not found'));
    if (art.status !== 'succeeded') return send(409, envelope('job_not_done', 'MaiK is still reading the paper.', { jobId: art.jobId, jobStatus: art.status }));
    return send(200, RESULT);
  }
  if ((mm = m(/^\/v1\/extractions\/([^/]+)\/promote$/)) && req.method === 'POST') {
    const ex = extById(mm[1]);
    if (!ex) return send(404, envelope('extraction_not_found', 'No such extraction'));
    return send(422, envelope('extraction_unverified', 'Verify Events (intervention) first: capture its quote or correct it.', { fieldKey: 'events1', fieldLabel: 'Events (intervention)' }));
  }
  if (path === `/v1/projects/${PID}/rob-conflicts` && req.method === 'GET') return send(200, { conflicts: [] });
  if (path === '/v1/rob-tools' && req.method === 'GET') return send(200, { tools: [] });
  if ((mm = m(/^\/v1\/projects\/[^/]+\/studies\/[^/]+\/rob$/)) && req.method === 'GET') return send(200, { assessment: { self: { submitted: false, domains: [] }, peer: { hidden: true } } });
  return send(404, envelope('not_found', 'Unknown Research API endpoint'));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/research/')) {
    try { await handleApi(req, res, p.slice('/api/research'.length)); }
    catch (e) { res.writeHead(500); res.end(String(e)); }
    return;
  }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-extract-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
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
const ok = (pass, label) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failures++; };
const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch {} await sleep(100); }
  return false;
};
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const setVal = (sel, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);

try {
  let version;
  for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') pageErrors.push('JS: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 200));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && msg.params.entry.source !== 'network') pageErrors.push(msg.params.entry.text.slice(0, 160));
  };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');

  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.extract', 30000), 'app loaded');
  await ev(`(function(){var s=JSON.parse(localStorage.getItem('smd_research_state_v1'));s.projects[0].serverId=s.projects[0].id;s.projects[0].practice=false;localStorage.setItem('smd_research_state_v1',JSON.stringify(s));return 1})()`);

  /* 1. Open form with no PDF */
  apiLog.length = 0;
  await ev(`SMD_RESEARCH.open({screen:'extract'});1`);
  ok(await until(`!!document.querySelector('[data-rmd-fieldrow="events1"]')`, 8000), 'extract form opened');
  await sleep(200);
  ok(apiLog.every((r) => r.status !== 422 && r.status !== 409), `opening form with no PDF makes no 422 or 409 requests (${JSON.stringify(apiLog)})`);
  const openBody1 = await text('#rmdScreenBody');
  ok(!/Something went wrong on our side/i.test(openBody1) && !/422|409/.test(openBody1), 'no error banner on opening form');

  /* Tap Ask MaiK with no PDF -> plain guidance, no 409 banner */
  apiLog.length = 0;
  await click('[data-rmd-ai="ask"]');
  ok(await until(`/Attach the study PDF on the Page tab first/i.test(document.querySelector('#rmdScreenBody').textContent)`, 3000), 'Ask MaiK with no PDF shows plain guidance');
  const noPdfBody = await text('#rmdScreenBody');
  ok(!/Something went wrong on our side/i.test(noPdfBody) && !/job_not_done|HTTP 409/i.test(noPdfBody), 'no 409 or "on our side" banner for missing PDF');
  ok(apiLog.every((r) => r.status !== 409), 'no failing 409 call made when PDF is missing');

  /* 2. Switch to study with a running PDF job -> opening shows no 409 banner; Ask MaiK polls & shows suggestions */
  apiLog.length = 0;
  await setVal('#rmdExtractStudy', 'st_running');
  ok(await until(`document.querySelector('#rmdExtractStudy').value==='st_running'`, 4000), 'switched to study with running job');
  await sleep(250);
  const runOpenBody = await text('#rmdScreenBody');
  ok(!/Something went wrong on our side/i.test(runOpenBody) && !/HTTP 409/.test(runOpenBody), 'opening study with running job shows no 409 error banner');
  await ev(`if(SMD_RESEARCH.screens.extract._setPollOptions) SMD_RESEARCH.screens.extract._setPollOptions({ intervalMs: 250, timeoutMs: 5000 }); 1`);
  await click('[data-rmd-ai="ask"]');
  ok(await until(`/MaiK is reading the paper/i.test(document.querySelector('#rmdScreenBody').textContent)`, 3000), 'visible "MaiK is reading the paper" state shown while polling');
  ok(await until(`!!document.querySelector('.rmd-suggestion') && /27/.test(document.querySelector('.rmd-suggestion').textContent)`, 8000), 'after job succeeds, client fetches and displays suggestions');

  /* 3. Polling timeout shows plain timeout message (never "on our side") */
  state.artifacts[0].status = 'running';
  state.jobPolls = 0;
  state.jobMode = 'never_finish';
  await ev(`if(SMD_RESEARCH.screens.extract._setPollOptions) SMD_RESEARCH.screens.extract._setPollOptions({ intervalMs: 40, timeoutMs: 120 }); 1`);
  await click('[data-rmd-ai="ask"]');
  ok(await until(`/taking longer than usual/i.test(document.querySelector('#rmdScreenBody').textContent)`, 4000), 'polling timeout shows plain timeout guidance');
  const toBody = await text('#rmdScreenBody');
  ok(!/Something went wrong on our side/i.test(toBody), 'timeout does not say "on our side"');

  /* 4. Save/promote with unverified required field -> plain field message; re-opening clears stale banner & makes no 422 */
  await setVal('#rmdExtractStudy', 'st_nopdf');
  ok(await until(`!!document.querySelector('[data-rmd="extract-promote"]') && !document.querySelector('.rmd-loading')`, 4000), 'switched back to st_nopdf');
  await click('[data-rmd="extract-promote"]');
  ok(await until(`/Verify Events \\(intervention\\) first: capture its quote or correct it/i.test(document.querySelector('#rmdScreenBody').textContent)`, 4000), 'promoting with unverified required field shows plain field message');
  const promBody = await text('#rmdScreenBody');
  ok(!/Something went wrong on our side/i.test(promBody) && !/Details for support/i.test(promBody), 'unverified field message has no "on our side" or support details');
  ok(await ev(`document.querySelector('#rmdField_events1').getAttribute('aria-invalid') === 'true'`), 'invalid field marked aria-invalid="true"');

  /* Tap Verify on events1 with no quote -> plain guidance, no 404/422 crash banner */
  await click('[data-rmd-verify="events1"]');
  ok(await until(`/Enter a value for Events \\(intervention\\) first/i.test(document.querySelector('#rmdScreenBody').textContent)`, 4000), 'verifying empty field gives plain guidance');
  const verBody = await text('#rmdScreenBody');
  ok(!/Something went wrong on our side/i.test(verBody), 'verify failure does not say "on our side"');

  /* Navigate away and back to Extract -> no stale 422 banner and no 422 request */
  apiLog.length = 0;
  await ev(`SMD_RESEARCH.navigate('rob');1`);
  await sleep(150);
  await ev(`SMD_RESEARCH.navigate('extract');1`);
  ok(await until(`!!document.querySelector('[data-rmd-fieldrow="events1"]')`, 4000), 're-opened extract screen');
  await sleep(200);
  const reopenBody = await text('#rmdScreenBody');
  ok(!/Verify Events \(intervention\) first/i.test(reopenBody) && !/Something went wrong/i.test(reopenBody), 're-opening form has no stale error banner');
  ok(apiLog.every((r) => r.status !== 422), 're-opening form makes no 422 request');

  /* Tap Ask MaiK -> Open Page tab button switches to Page tab with upload control */
  await click('[data-rmd-ai="ask"]');
  ok(await until(`!!document.querySelector('[data-rmd="extract-goto-page"]')`, 3000), 'missing PDF guidance offers Open Page tab button');
  const gotoMinH = await ev(`parseFloat(getComputedStyle(document.querySelector('[data-rmd="extract-goto-page"]')).minHeight)`);
  ok(gotoMinH >= 44, `Open Page tab button meets 44px CSS min-height target (${gotoMinH})`);
  await click('[data-rmd="extract-goto-page"]');
  ok(await until(`!!document.querySelector('[data-rmd="extract-upload-pdf"]')`, 3000), 'Open Page tab switches to Page pane with Attach study PDF');

  /* Layout/copy/dark-mode invariants at 390px and 1024px */
  await click('[data-rmd-extract-view="form"]');
  ok(await ev(`(()=>{const b=document.getElementById('researchMD');const d=document.documentElement;return b.scrollWidth<=b.clientWidth+2 && d.scrollWidth<=d.clientWidth})()`), 'no horizontal overflow at 390px');
  await ev(`document.body.classList.add('dark'); 1`);
  await sleep(80);
  ok(await ev(`(()=>{const el=document.querySelector('[data-rmd-ai="ask"]');const cs=getComputedStyle(el);return cs.minHeight==='44px'})()`), 'Ask MaiK button meets 44px height in dark mode');
  await ev(`document.body.classList.remove('dark'); 1`);
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: false });
  await sleep(80);
  ok(await ev(`(()=>{const l=document.querySelector('.rmd-pane-left');const r=document.querySelector('.rmd-pane-right');return l&&r&&getComputedStyle(l).display!=='none'&&getComputedStyle(r).display!=='none'})()`), 'two-pane layout visible at 1024px');
  ok(await ev(`!/[\\u2014\\u2013]/.test(document.getElementById('researchMD').textContent)`), 'no em/en dash in UI text');
  ok(pageErrors.length === 0, `no page errors (${pageErrors.length})`);
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
