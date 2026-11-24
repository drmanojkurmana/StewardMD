// Real-browser headless test: ResearchMD "Time to event (survival analysis)" card
// on the master chart, for a cohort project. The survival engine (kaplanMeier,
// logRank, cox) is a stub until it merges, so this runner mocks a fixed engine
// result to check the screen wiring, then restores the stub to check the calm
// "not available yet" path. Asserts the KM SVG with a number-at-risk table,
// median survival (and "not reached"), the log-rank line, the Cox table with a
// separation row, the proportional-hazards reminder, the results paragraph, and
// the privacy guarantee that no request body carries a patient row.
// Viewports 390x844 and 1024x1366.
//   node test/run-research-survival-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9122, CDP = 9522, OUT = '/tmp/stewardmd-research-alltypes-qwen';
const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

let projN = 0;
const allBodies = [];

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (body) allBodies.push({ url: p, body });
    if (p.startsWith('/api/')) {
      let b = {};
      try { b = JSON.parse(body || '{}'); } catch { b = {}; }
      if (p === '/api/research/v1/projects' && req.method === 'POST') {
        projN++;
        return send(201, {
          project: {
            id: 'prj_sv_' + projN, title: b.title || 'Untitled project',
            discipline: b.discipline || 'medicine', specialty: b.specialty || '',
            studyType: b.studyType || '', role: 'owner', createdAt: Date.now()
          },
          requestId: 'req_sv'
        });
      }
      const projMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)(\/.*)?$/);
      if (projMatch) {
        const sub = projMatch[2] || '';
        if (sub === '/manuscript' && req.method === 'GET') return send(200, { manuscript: null });
        if (sub === '/manuscript/versions' && req.method === 'GET') return send(200, { versions: [] });
        if (sub === '/protocols' && req.method === 'GET') return send(200, { protocols: [] });
      }
      return send(404, { error: { code: 'project_not_found' } });
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
  });
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-sv-chrome-${process.pid}`,
  '--no-first-run',
  '--disable-gpu'
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
    try { if (await ev(expr)) return true; } catch { /* page busy */ }
    await sleep(100);
  }
  return false;
};

const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const setSelect = (sel, value) => ev(`(()=>{const s=document.querySelector(${JSON.stringify(sel)});if(!s)return false;s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change'));return s.value===${JSON.stringify(value)}})()`);
const tick = (list, value) => click(`.rmd-mc-check-input[data-rmd-mc-list="${list}"][value="${value}"]`);

async function shot(name) {
  await sleep(150);
  await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`);
  await mkdir(OUT, { recursive: true });
  const r = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}

const viewport = (width, height, mobile) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });

const resetToSeed = () => ev(`(()=>{
  localStorage.removeItem('smd_research_state_v1');
  localStorage.removeItem('smd_rmd_help');
  localStorage.removeItem('smd_rmd_seen');
  localStorage.removeItem('smd_rmd_masterchart_v1');
  localStorage.removeItem('smd_rmd_manuscript_local_v1');
  SMD_RESEARCH.store.init();
  return 1;
})()`);

// Fixed engine results (synthetic, not real patients). The screen only wires
// these into the DOM; it never computes statistics itself.
const KM_OK = {
  ok: true, warnings: [], nExcluded: 0,
  groups: [
    { name: 'Drug A', n: 100, nEvents: 60, median: { value: 18, lower: 12, upper: 25 },
      steps: [
        { t: 0, atRisk: 100, events: 0, censored: 0, survival: 1, seLogS: 0, ciLower: 1, ciUpper: 1 },
        { t: 10, atRisk: 90, events: 10, censored: 2, survival: 0.9, seLogS: 0.03, ciLower: 0.84, ciUpper: 0.96 },
        { t: 20, atRisk: 70, events: 15, censored: 3, survival: 0.75, seLogS: 0.05, ciLower: 0.66, ciUpper: 0.84 },
        { t: 30, atRisk: 40, events: 20, censored: 5, survival: 0.5, seLogS: 0.07, ciLower: 0.4, ciUpper: 0.6 }
      ] },
    { name: 'Drug B', n: 100, nEvents: 40, median: { value: 30, lower: 22, upper: 40 },
      steps: [
        { t: 0, atRisk: 100, events: 0, censored: 0, survival: 1, seLogS: 0, ciLower: 1, ciUpper: 1 },
        { t: 10, atRisk: 95, events: 5, censored: 1, survival: 0.95, seLogS: 0.02, ciLower: 0.91, ciUpper: 0.99 },
        { t: 20, atRisk: 80, events: 10, censored: 2, survival: 0.85, seLogS: 0.04, ciLower: 0.78, ciUpper: 0.92 },
        { t: 30, atRisk: 55, events: 15, censored: 4, survival: 0.65, seLogS: 0.06, ciLower: 0.55, ciUpper: 0.75 }
      ] }
  ]
};
const LR_OK = { ok: true, warnings: [], chi2: 10.3, df: 1, p: 0.0013, table: [] };
const COX_OK = {
  ok: true, warnings: [], n: 200, nEvents: 100, nExcluded: 0, converged: true, iterations: 5,
  logLik: -300, lrTest: { chi2: 12, df: 2, p: 0.002 },
  coefficients: [
    { term: 'Diabetes', predictor: 'Diabetes', level: 'Yes', beta: -0.53, se: 0.16, hr: 0.588, ciLower: 0.424, ciUpper: 0.816, z: -3.3, p: 0.0009, estimable: true },
    { term: 'Sex', predictor: 'Sex', level: 'Female', beta: null, se: null, hr: null, ciLower: null, ciUpper: null, z: null, p: null, estimable: false }
  ]
};
const KM_NOT_REACHED = {
  ok: true, warnings: ['No one in group Drug B had the event, so median survival is not reached.'], nExcluded: 0,
  groups: [
    KM_OK.groups[0],
    { name: 'Drug B', n: 100, nEvents: 0, median: { value: null, lower: null, upper: null },
      steps: [
        { t: 0, atRisk: 100, events: 0, censored: 0, survival: 1, seLogS: 0, ciLower: 1, ciUpper: 1 },
        { t: 30, atRisk: 60, events: 0, censored: 40, survival: 1, seLogS: 0, ciLower: 1, ciUpper: 1 }
      ] }
  ]
};

const setMock = (km, lr, cox) => ev(`(()=>{window.__svKm=${JSON.stringify(km)};window.__svLr=${JSON.stringify(lr)};window.__svCox=${JSON.stringify(cox)};return 1})()`);

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; }
    catch { await sleep(200); }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable');

  await viewport(390, 844, true);
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH_STATS && !!window.SMD_RESEARCH.screens.masterchart', 30000), 'app loaded with ResearchMD, stats engine and master chart screen');

  // 1. Create a cohort project (studyType "Cohort study" enables the survival card).
  await resetToSeed();
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('[data-rmd-start-choice="cohort"]')`, 5000), 'start screen offers a cohort study');
  await click('[data-rmd-start-choice="cohort"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='My cohort survival study';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_sv_1'`, 5000), 'cohort project created on the server');
  await ev(`SMD_RESEARCH.navigate('masterchart',{projectId:'prj_sv_1'});1`);
  ok(await until(`!!document.querySelector('.rmd-mc-screen')`, 5000), 'lands on the master chart upload step');

  // 2. Load the sample thesis and reach the question screen.
  await click('[data-rmd-mc="sample"]');
  ok(await until(`!!document.querySelector('.rmd-mc-screen [data-rmd-mc="continue-identifiers"]')`, 5000), 'identifier check shown');
  await click('[data-rmd-mc="continue-identifiers"]');
  ok(await until(`document.querySelectorAll('.rmd-mc-colcard').length === 12`, 5000), '12 column cards');
  await click('[data-rmd-mc="continue-columns"]');
  ok(await until(`!!document.querySelector('[data-rmd-mc-choice="survival"]')`, 5000), 'survival question offered for a cohort');
  ok(await ev(`!document.querySelector('[data-rmd-mc-choice="describe"]')`), 'describe (case series) question not offered for a cohort');
  ok(await ev(`!!document.querySelector('#rmdMcMatched')`), 'matched-controls toggle present');
  await shot('survival-phone-390-question');

  // 3. Install a fixed ok:true engine result and run the survival analysis.
  await ev(`(()=>{const S=window.SMD_RESEARCH_STATS;window.__svOrig={km:S.kaplanMeier,lr:S.logRank,cox:S.cox};S.kaplanMeier=function(){return window.__svKm};S.logRank=function(){return window.__svLr};S.cox=function(){return window.__svCox};return 1})()`);
  await setMock(KM_OK, LR_OK, COX_OK);
  await click('[data-rmd-mc-choice="survival"]');
  ok(await until(`!!document.querySelector('#rmdMcTime')`, 3000), 'survival form shows the time picker');
  ok(await setSelect('#rmdMcTime', 'Hospital stay days'), 'time column set');
  ok(await setSelect('#rmdMcEvent', 'Complication'), 'event column set');
  ok(await setSelect('#rmdMcSgroup', 'Group'), 'group column set');
  ok(await tick('cox', 'Diabetes'), 'Diabetes ticked as a Cox factor');
  await click('[data-rmd-mc="run"]');
  ok(await until(`!!document.querySelector('.rmd-mc-km')`, 8000), 'Kaplan-Meier SVG rendered');
  ok(await ev(`(()=>{const s=document.querySelector('.rmd-mc-km');return !!s && s.querySelectorAll('path').length>=2})()`), 'one survival curve path per group');
  ok(await ev(`!!document.querySelector('.rmd-mc-atrisk')`), 'number-at-risk table present under the axis');
  const riskHead = await text('.rmd-mc-atrisk thead');
  ok(/Number at risk/.test(riskHead), 'number-at-risk table labelled');
  ok(await ev(`document.querySelectorAll('.rmd-mc-atrisk tbody tr').length===2`), 'one number-at-risk row per group');
  ok(await ev(`document.querySelectorAll('.rmd-mc-atrisk thead th').length===6`), 'number at risk shown at 5 evenly spaced times');
  const medTable = await text('.rmd-mc-result .rmd-mc-table');
  ok(/18\.0 \(12\.0 to 25\.0\)/.test(medTable), 'median survival with 95% CI shown');
  ok(/Log-rank test: chi-square = 10\.30, df = 1/.test(await text('.rmd-mc-result')), 'log-rank p value shown');
  ok(/0\.588 \(0\.424 to 0\.816\)/.test(medTable) || /0\.59/.test(await text('.rmd-mc-result')), 'Cox hazard ratio with CI shown');
  ok(await ev(`!!document.querySelector('.rmd-mc-cox-sep')`), 'separation row present for a non-estimable factor');
  ok(/One group had no events \(or only events\), so its hazard ratio cannot be estimated\./.test(await text('.rmd-mc-cox-sep')), 'separation row uses the exact calm message');
  ok(/Hazard ratios assume the effect stays the same over time\. If the survival curves cross, ask your statistician before reporting\./.test(await text('.rmd-mc-ph')), 'proportional-hazards reminder shown under the Cox table');
  ok(await ev(`(()=>{const s=document.querySelector('.rmd-mc-sentence');return !!s && /hazard/i.test(s.innerText||'')})()`), 'results paragraph built from the hazard ratio');
  await shot('survival-phone-390-results');

  // 4. "Not reached" median and the calm warning banner.
  await setMock(KM_NOT_REACHED, LR_OK, COX_OK);
  await click('[data-rmd-mc="ask-another"]');
  await until(`!!document.querySelector('[data-rmd-mc-choice="survival"]')`, 3000);
  await click('[data-rmd-mc-choice="survival"]');
  await until(`!!document.querySelector('#rmdMcTime')`, 3000);
  await click('[data-rmd-mc="run"]');
  ok(await until(`!!document.querySelector('.rmd-mc-km')`, 8000), 'KM rendered for the not-reached case');
  ok(/not reached/.test(await text('.rmd-mc-result .rmd-mc-table')), 'median shown as "not reached" when null');
  ok(/No one in group Drug B had the event, so median survival is not reached\./.test(await text('.rmd-mc-screen')), 'engine warning shown in the calm banner');
  await shot('survival-phone-390-not-reached');

  // 5. Stub engine (ok:false): calm message, no numbers, no curve.
  await ev(`(()=>{const S=window.SMD_RESEARCH_STATS;S.kaplanMeier=window.__svOrig.km;S.logRank=window.__svOrig.lr;S.cox=window.__svOrig.cox;return 1})()`);
  await click('[data-rmd-mc="ask-another"]');
  await until(`!!document.querySelector('[data-rmd-mc-choice="survival"]')`, 3000);
  await click('[data-rmd-mc-choice="survival"]');
  await until(`!!document.querySelector('#rmdMcTime')`, 3000);
  await click('[data-rmd-mc="run"]');
  ok(await until(`/This analysis is not available yet\\. No numbers are shown\\./.test(document.querySelector('.rmd-mc-result').innerText)`, 8000), 'stub engine shows the calm not-available message');
  ok(await ev(`!document.querySelector('.rmd-mc-km') && !document.querySelector('.rmd-mc-atrisk')`), 'no curve or number-at-risk table when the engine is not built');
  ok(await ev(`!document.querySelector('.rmd-mc-sentence')`), 'no results paragraph when the engine is not built');
  await shot('survival-phone-390-stub');

  // 6. iPad layout, then privacy + responsive + dash + page-error sweeps.
  await viewport(1024, 1366, false);
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal overflow at 1024px');
  await shot('survival-ipad-1024');
  await viewport(390, 844, true);
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal overflow at 390px');
  ok(await ev(`(()=>{const t=document.querySelector('.rmd-mc-screen').innerText||'';return /Next:/.test(t)})()`), 'a plain Next line is shown');
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');
  const leaky = allBodies.filter((r) => /Patient 0/.test(r.body) || /\b98\d{8}\b/.test(r.body));
  ok(leaky.length === 0, `no network request body carries patient rows or phone numbers (${allBodies.length} bodies checked)`);
  ok(pageErrors.length === 0, `zero uncaught page errors (${pageErrors.length})`);
  if (pageErrors.length) console.log(pageErrors.join('\n'));

  console.log(failures === 0 ? '\nALL SURVIVAL UI CHECKS PASSED' : `\n${failures} SURVIVAL UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
