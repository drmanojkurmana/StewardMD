// Real-browser headless test: ResearchMD case series. Four synthetic patients are
// entered as per-patient case files (CARE order), then "Turn into master chart"
// opens the master chart in describe mode. With n <= 5 every value is listed
// (edge-case message), and a Common features table summarises the series. The
// case files and the chart stay on this phone (RMDStore); nothing is uploaded.
// Viewports 390x844 and 1024x1366.
//   node test/run-research-caseseries-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9121, CDP = 9521, OUT = '/tmp/stewardmd-research-alltypes-qwen';
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2'
};

let projN = 0;
const allBodies = [];

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
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
            id: 'prj_cs_' + projN, title: b.title || 'Untitled project',
            discipline: b.discipline || 'medicine', specialty: b.specialty || '',
            studyType: b.studyType || '', role: 'owner', createdAt: Date.now()
          },
          requestId: 'req_cs'
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
      res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store, no-cache, must-revalidate' });
      res.end(data);
    });
  });
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-cs-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
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
  for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch { /* busy */ } await sleep(100); }
  return false;
};
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const setVal = (sel, val) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.value=${JSON.stringify(val)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);

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

async function fillPatient(age, sex, trop, diagnosis) {
  await setVal('#rmdCfAge', age);
  await setVal('#rmdCfSex', sex);
  await setVal('#rmdCfPresenting', 'Zinc phosphide ingestion with chest pain');
  await setVal('#rmdCfPresentingDate', '2026-03-02');
  await setVal('#rmdCfDiagnosis', diagnosis);
  await click('[data-rmd-cf="addinv"]');
  await until(`!!document.querySelector('[data-rmd-cf-inv="0"][data-rmd-cf-invkey="test"]')`, 3000);
  await setVal('[data-rmd-cf-inv="0"][data-rmd-cf-invkey="date"]', '2026-03-02');
  await setVal('[data-rmd-cf-inv="0"][data-rmd-cf-invkey="test"]', 'Troponin I');
  await setVal('[data-rmd-cf-inv="0"][data-rmd-cf-invkey="value"]', trop);
  await setVal('[data-rmd-cf-inv="0"][data-rmd-cf-invkey="unit"]', 'ng/mL');
  await click('[data-rmd-cf="save"]');
  await until(`/Saved on this phone\\. Nothing was uploaded\\./.test(document.querySelector('#rmdCfSaveStatus').innerText)`, 5000);
}

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
  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH_STATS && !!window.SMD_RESEARCH.screens.casefile', 30000), 'app loaded with ResearchMD, stats engine and case file screen');

  // 1. Create a case-series project; lands on the case file in series mode.
  await resetToSeed();
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('[data-rmd-start-choice="case-series"]')`, 5000), 'start screen offers a case series');
  await click('[data-rmd-start-choice="case-series"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='My zinc phosphide case series';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_cs_1'`, 5000), 'case-series project created on the server');
  ok(await until(`!!document.querySelector('.rmd-casefile-screen')`, 5000), 'lands on the case file screen');
  ok(await until(`/Patients in this series/.test(document.querySelector('.rmd-casefile-screen').innerText)`, 5000), 'series mode shows the patient list');
  ok(await ev(`!!document.querySelector('[data-rmd-cf="addpatient"]')`), 'Add patient button present');
  ok(await ev(`!!document.querySelector('[data-rmd-cf="tochart"]')`), 'Turn into master chart button present');
  ok(/Next:/.test(await text('.rmd-casefile-screen')), 'a plain Next line is shown');
  await shot('caseseries-phone-390-casefile');

  // 2. Four synthetic patients (no names, hospital numbers, addresses or phones).
  await fillPatient('34', 'Male', '8.4', 'Zinc phosphide poisoning with myocardial infarction');
  ok(await ev(`!!document.querySelector('#rmdCfTimeline .rmd-cf-tl-row')`), 'timeline built from the entered dates');
  ok(await ev(`(()=>{const d=document.querySelector('#rmdCfTimeline .rmd-cf-day');return !!d && /Day 0/.test(d.innerText)})()`), 'Day 0 is the first presentation');
  await click('[data-rmd-cf="addpatient"]');
  await until(`!!document.querySelector('[data-rmd-cf-patient="2"]')`, 3000);
  await fillPatient('28', 'Female', '6.1', 'Zinc phosphide poisoning with acute hepatitis');
  await click('[data-rmd-cf="addpatient"]');
  await until(`!!document.querySelector('[data-rmd-cf-patient="3"]')`, 3000);
  await fillPatient('45', 'Male', '9.2', 'Zinc phosphide poisoning with arrhythmia');
  await click('[data-rmd-cf="addpatient"]');
  await until(`!!document.querySelector('[data-rmd-cf-patient="4"]')`, 3000);
  await fillPatient('39', 'Male', '7.5', 'Zinc phosphide poisoning with shock');
  ok(await ev(`document.querySelectorAll('[data-rmd-cf-patient]').length===4`), 'four patient tabs present');
  await shot('caseseries-phone-390-four-patients');

  // 3. Turn into master chart -> describe mode lists every value (n <= 5).
  await click('[data-rmd-cf="tochart"]');
  ok(await until(`!!document.querySelector('.rmd-mc-result')`, 8000), 'master chart opens in describe mode');
  ok(/Describe the series/.test(await text('.rmd-mc-result')), 'describe result heading shown');
  ok(/n = 4/.test(await text('.rmd-mc-result')), 'series n is 4');
  ok(/With so few patients, each value is listed instead of an average\./.test(await text('.rmd-mc-result')), 'small-n edge-case message shown');
  const lists = await ev(`(()=>{return Array.prototype.map.call(document.querySelectorAll('.rmd-mc-list'),function(e){return e.innerText||''}).join(' | ')})()`);
  ok(/8\.4/.test(lists) && /6\.1/.test(lists) && /9\.2/.test(lists) && /7\.5/.test(lists), 'every Troponin I value is listed');
  ok(/Male: 3 \(75\.0%\)/.test(lists), 'Sex counts shown as n (%)');
  ok(await ev(`!!document.querySelector('.rmd-mc-result .rmd-mc-table')`), 'Common features table present');
  const common = await text('.rmd-mc-result .rmd-mc-table');
  ok(/Sex/.test(common) && /Male/.test(common) && /3 of 4 \(75\.0%\)/.test(common), 'Common features table shows Sex Male 3 of 4');
  ok(/For a surgical case series, many journals ask for PROCESS 2025\. Check the journal's instructions\./.test(await text('.rmd-mc-result')), 'PROCESS 2025 note shown');
  ok(/In this series of 4 patients, the most common feature was Sex \(Male\), seen in 3 of 4 \(75\.0%\)\./.test(await text('.rmd-mc-sentence')), 'results sentence built from the calculation only');
  ok(await ev(`!document.querySelector('[data-rmd-mc="show-mean"]')`), 'no mean ± SD toggle for n <= 5');
  await shot('caseseries-phone-390-describe');

  // 4. The chart and case files are stored on this phone (RMDStore), not uploaded.
  ok(await ev(`(async()=>{const c=await window.RMDStore.get('prj_cs_1','masterchart','chart');return !!c && c.fromCasefiles===true && c.rows.length===4})()`), 'master chart stored in RMDStore with 4 rows');
  ok(await ev(`(async()=>{const r=await window.RMDStore.list('prj_cs_1','casefile');return r.length===4})()`), 'four case files stored in RMDStore');

  // 5. iPad layout, then privacy + responsive + dash + page-error sweeps.
  await viewport(1024, 1366, false);
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), 'no horizontal overflow at 1024px');
  await shot('caseseries-ipad-1024-describe');
  await viewport(390, 844, true);
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), 'no horizontal overflow at 390px');
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');
  const leaky = allBodies.filter((r) => /Troponin/.test(r.body) || /Zinc phosphide/.test(r.body) || /\b98\d{8}\b/.test(r.body));
  ok(leaky.length === 0, `no network request body carries case file values (${allBodies.length} bodies checked)`);
  ok(pageErrors.length === 0, `zero uncaught page errors (${pageErrors.length})`);
  if (pageErrors.length) console.log(pageErrors.join('\n'));

  console.log(failures === 0 ? '\nALL CASESERIES UI CHECKS PASSED' : `\n${failures} CASESERIES UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
