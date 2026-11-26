// Real-browser headless test: ResearchMD ClinicalTrials.gov Trials UI.
// Verifies:
//   1. Client flag smd_research_trials OFF ("0"; default is ON) -> nothing rendered, 0 /trials calls
//   2. Client flag ON + server unavailable (404 or {available:false}) -> hidden, no error banner/empty box
//   3. Client flag ON + server available -> "Trials" chip, NCT lookup + search, kept fields + "Data: ClinicalTrials.gov"
//   4. Mid-session unavailable response -> hidden cleanly
//   5. Responsive 375 / 768 / 1024 px, no horizontal overflow, no em-dash
//   node test/run-research-trials-ui.mjs
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));

const PORT = 9095, CDP = 9495;
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

const TRIAL = {
  nct: 'NCT04280705',
  title: 'Adaptive COVID-19 Treatment Trial (ACTT-1)',
  phase: 'PHASE3',
  status: 'COMPLETED',
  enrollment: 1062,
  arms: [
    { label: 'Remdesivir', type: 'EXPERIMENTAL', description: '200 mg IV loading dose' },
    { label: 'Placebo', type: 'PLACEBO_COMPARATOR', description: 'Matching placebo' },
  ],
  primaryOutcome: [
    { measure: 'Time to recovery', timeFrame: 'Day 1 through Day 29' },
  ],
  resultsPosted: true,
  source: 'ClinicalTrials.gov',
};

let serverMode = 'available'; // 'disabled' | 'unavailable' | 'available' | 'drop_mid_search'
let trialsApiCalls = [];

async function handleApi(req, res, path) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  let body = null;
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  }
  if (/\/searches$/.test(path) && req.method === 'GET') {
    return send(200, { searchRuns: [] });
  }
  if (/\/trials$/.test(path) && req.method === 'GET') {
    trialsApiCalls.push({ method: 'GET', path });
    if (serverMode === 'disabled') return send(404, { error: { code: 'not_found', message: 'Disabled' } });
    if (serverMode === 'unavailable') return send(200, { available: false, reason: 'unavailable', source: 'ClinicalTrials.gov' });
    return send(200, { available: true, source: 'ClinicalTrials.gov' });
  }
  if (/\/trials\/search$/.test(path) && req.method === 'POST') {
    trialsApiCalls.push({ method: 'POST', path, body });
    if (serverMode === 'drop_mid_search') return send(200, { available: false, studies: [], reason: 'unavailable', source: 'ClinicalTrials.gov' });
    return send(200, { available: true, studies: [TRIAL], nextPageToken: null, totalCount: 1, source: 'ClinicalTrials.gov' });
  }
  if (/\/trials\/NCT\d{8}$/.test(path) && req.method === 'GET') {
    trialsApiCalls.push({ method: 'GET', path });
    return send(200, { available: true, trial: TRIAL, source: 'ClinicalTrials.gov' });
  }
  return send(404, { error: { code: 'not_found', message: 'Unknown endpoint' } });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/research/')) {
    await handleApi(req, res, p.slice('/api/research'.length));
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
  `--user-data-dir=/tmp/rmd-trials-chrome-${process.pid}`, '--no-first-run', '--disable-gpu',
], { stdio: 'ignore' });

let ws, sid, id = 0, failures = 0;
const pending = new Map();
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
const until = async (expr, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    try { if (await ev(expr)) return true; } catch {}
    await sleep(100);
  }
  return false;
};
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const setVal = (sel, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const noOverflow = () => ev(`(()=>{const b=document.getElementById('researchMD');const d=document.documentElement;return b.scrollWidth<=b.clientWidth+2 && d.scrollWidth<=d.clientWidth})()`);
const noEmDash = async () => !/—/.test(await ev(`document.getElementById('researchMD').innerText || ''`));

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;

  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.search', 30000), 'app loaded');

  await ev(`(function(){
    localStorage.setItem('smd_research_trials','0');
    var s = JSON.parse(localStorage.getItem('smd_research_state_v1'));
    s.projects[0].serverId = s.projects[0].id;
    s.projects[0].practice = false;
    localStorage.setItem('smd_research_state_v1', JSON.stringify(s));
    return 1;
  })()`);

  /* 1. Flag OFF -> nothing rendered, no /trials call */
  await ev(`SMD_RESEARCH.open({screen:'search'});1`);
  ok(await until(`/Run a Search/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'search screen opens with flag OFF');
  ok(await ev(`!document.querySelector('[data-rmd-db="clinicaltrials"]') && !document.querySelector('[data-rmd="trials-panel"]')`), 'flag OFF renders no Trials chip or panel');
  ok(trialsApiCalls.length === 0, 'flag OFF makes zero /trials API requests');

  /* 2. Flag ON + server disabled (404) -> hidden cleanly */
  serverMode = 'disabled';
  await ev(`localStorage.setItem('smd_research_trials','1'); SMD_RESEARCH.navigate('projects'); SMD_RESEARCH.navigate('search'); 1`);
  await sleep(300);
  ok(trialsApiCalls.length >= 1, 'flag ON probes /trials availability');
  ok(await ev(`!document.querySelector('[data-rmd-db="clinicaltrials"]') && !document.querySelector('[data-rmd="trials-panel"]') && !document.querySelector('[data-rmd="trials-error"]')`), 'disabled server hides Trials with no error banner');

  /* 3. Flag ON + server returns {available:false} -> hidden cleanly */
  serverMode = 'unavailable';
  trialsApiCalls.length = 0;
  await ev(`(function(){ var s=JSON.parse(localStorage.getItem('smd_research_state_v1')); s.projects.push({id:'p_unavail',serverId:'p_unavail',title:'Unavail',role:'owner',practice:false}); s.activeProjectId='p_unavail'; localStorage.setItem('smd_research_state_v1',JSON.stringify(s)); SMD_RESEARCH.store.init(); SMD_RESEARCH.navigate('search'); return 1; })()`);
  await sleep(300);
  ok(await ev(`!document.querySelector('[data-rmd-db="clinicaltrials"]') && !document.querySelector('[data-rmd="trials-error"]')`), 'unavailable server hides Trials with no error banner');

  /* 4. Flag ON + server available -> chip appears, NCT lookup + search render kept fields + credit */
  serverMode = 'available';
  trialsApiCalls.length = 0;
  await ev(`(function(){ var s=JSON.parse(localStorage.getItem('smd_research_state_v1')); s.projects.push({id:'p_avail',serverId:'p_avail',title:'Avail',role:'owner',practice:false}); s.activeProjectId='p_avail'; localStorage.setItem('smd_research_state_v1',JSON.stringify(s)); SMD_RESEARCH.store.init(); SMD_RESEARCH.navigate('search'); return 1; })()`);
  ok(await until(`!!document.querySelector('[data-rmd-db="clinicaltrials"]')`, 5000), 'Trials chip renders when flag ON and server available');
  await click('[data-rmd-db="clinicaltrials"]');
  ok(await until(`!!document.querySelector('[data-rmd="trials-panel"]')`, 3000), 'Trials lookup panel opens');

  await setVal('#rmd_trials_nct', 'NCT04280705');
  await click('[data-rmd="trials-nct-lookup"]');
  ok(await until(`!!document.querySelector('.rmd-trial-card')`, 5000), 'NCT lookup renders result card');
  const cardTxt = await ev(`document.querySelector('.rmd-trial-card').innerText`);
  ok(/NCT04280705/.test(cardTxt) && /Adaptive COVID-19 Treatment Trial/.test(cardTxt) && /PHASE3/.test(cardTxt) && /COMPLETED/.test(cardTxt) && /1062/.test(cardTxt) && /Remdesivir/.test(cardTxt) && /Time to recovery/.test(cardTxt) && /Results posted/.test(cardTxt) && /Data: ClinicalTrials\.gov/.test(cardTxt),
    'trial card renders all kept fields and Data: ClinicalTrials.gov credit');

  await setVal('#rmd_trials_cond', 'COVID-19');
  await setVal('#rmd_trials_intr', 'Remdesivir');
  await setVal('#rmd_trials_phase', 'PHASE3');
  await setVal('#rmd_trials_status', 'COMPLETED');
  await click('[data-rmd="trials-search"]');
  ok(await until(`!!document.querySelector('[data-rmd="trials-results"]')`, 5000), 'search results render');
  const searchCall = trialsApiCalls.find((c) => c.method === 'POST');
  ok(!!searchCall && searchCall.body.condition === 'COVID-19' && searchCall.body.intervention === 'Remdesivir' && searchCall.body.phase === 'PHASE3' && searchCall.body.status === 'COMPLETED',
    'search request sends condition, intervention, phase, status');

  /* Responsive checks across widths */
  for (const [w, h, mob] of [[375, 812, true], [768, 1024, true], [1024, 768, false]]) {
    await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: mob });
    await sleep(100);
    ok(await noOverflow(), `no horizontal overflow at ${w}px`);
    ok(await noEmDash(), `no em-dash at ${w}px`);
  }

  /* 5. Mid-session unavailable hides feature with no error banner */
  serverMode = 'drop_mid_search';
  await click('[data-rmd="trials-search"]');
  ok(await until(`!document.querySelector('[data-rmd-db="clinicaltrials"]')`, 5000), 'mid-session unavailable hides Trials chip');
  ok(await ev(`!document.querySelector('[data-rmd="trials-panel"]') && !document.querySelector('[data-rmd="trials-error"]')`), 'mid-session unavailable leaves no empty panel or error banner');
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
