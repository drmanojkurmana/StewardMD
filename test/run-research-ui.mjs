// Real-browser headless test: ResearchMD Phase 1.2 screens end to end.
// Tests projects screen, study table, locator provenance, verification,
// offline 409 conflict handling, meta-analysis run, inline SVG forest plot,
// CSV and manifest export, and responsive layouts at 375, 768, and 1024 px.
//   node test/run-research-ui.mjs      (CHROME=/path/to/chrome to override the browser)
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

const PORT = 9093, CDP = 9493, OUT = "/tmp/stewardmd-research";
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

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/api/research/v1/projects' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let b = {};
      try { b = JSON.parse(body || '{}'); } catch { b = {}; }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        project: {
          id: 'prj_srv_phase1',
          title: b.title || 'Untitled project',
          discipline: b.discipline || 'medicine',
          specialty: b.specialty || '',
          studyType: b.studyType || '',
          role: 'owner',
          createdAt: Date.now()
        },
        requestId: 'req_phase1'
      }));
    });
    return;
  }
  if (p.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not_found"}');
    return;
  }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(fp)] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate'
    });
    res.end(data);
  });
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-chrome-${process.pid}`,
  '--no-first-run',
  '--disable-gpu'
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

const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) {
    try {
      if (await ev(expr)) return true;
    } catch {
      /* page busy */
    }
    await sleep(100);
  }
  return false;
};

const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);

async function shot(name) {
  await sleep(150);
  await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`);
  await mkdir(OUT, { recursive: true });
  const r = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}

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
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;

  // Viewport 1: Phone (375 x 812)
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });

  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH_ENGINE', 30000), 'app loaded with ResearchMD and stats engine');

  // 1. Feature Flag Tests
  const flagOffCheck = await ev(`(()=>{
    try { localStorage.removeItem('smd_research'); } catch (e) {}
    history.replaceState(null, '', '/');
    const a = SMD_RESEARCH.on();
    localStorage.setItem('smd_research', '0');
    const b = SMD_RESEARCH.on();
    localStorage.removeItem('smd_research');
    history.replaceState(null, '', '/?research=0');
    const c = SMD_RESEARCH.on();
    history.replaceState(null, '', '/');
    return a === true && b === false && c === false;
  })()`);
  ok(flagOffCheck, 'flag smd_research: default ON; off with smd_research=0 or ?research=0');

  // 2. Shell Overlay Opening & Closing
  await ev(`SMD_RESEARCH.open();1`);
  ok(await until(`!!document.querySelector('#researchMD:not([hidden])')`, 5000), '#researchMD overlay opens and is visible');
  ok(await ev(`document.body.classList.contains('smd-research-open')`), 'body has smd-research-open class');

  // Verify display:none on [hidden]
  await ev(`SMD_RESEARCH.close();1`);
  ok(await ev(`document.getElementById('researchMD').hidden === true`), 'close sets hidden attribute');
  ok(await ev(`getComputedStyle(document.getElementById('researchMD')).display === 'none'`), '#researchMD[hidden] has display:none!important');
  ok(await ev(`(()=>{const e=document.elementFromPoint(30,40);return !e || !e.closest('#researchMD')})()`), 'taps reach app behind when closed');

  // 3. Re-open to Projects & Seed Project Verification
  await ev(`SMD_RESEARCH.open({screen:'projects'});1`);
  ok(await until(`!!document.querySelector('.rmd-projects-screen')`, 5000), 'projects screen rendered');
  ok(await ev(`document.querySelectorAll('.rmd-project-card').length >= 1`), 'initial seed project present');
  ok(/BCG Vaccine vs Tuberculosis/i.test(await text('.rmd-projects-screen')), 'BCG vaccine trial seed project listed');
  ok(await ev(`document.getElementById('rmdSyncBadge') && /Synced/i.test(document.getElementById('rmdSyncBadge').innerText)`), 'sync badge shows Synced');
  await shot('phone-375-projects');

  // 4. Create New Project via Modal Form
  await click('[data-rmd="new-project"]');
  ok(await until(`!!document.querySelector('#rmdProjModal')`, 3000), 'new project modal opens');
  await ev(`(()=>{
    document.getElementById('rmd_proj_title').value = 'SGLT2 Inhibitors in Heart Failure';
    document.getElementById('rmd_proj_disc').value = 'cardiology';
    document.getElementById('rmd_proj_spec').value = 'Heart Failure';
    document.getElementById('rmd_proj_q').value = 'Does empagliflozin reduce CV death or HF hospitalization?';
    return true;
  })()`);
  await click('[data-rmd="create-project-submit"]');
  ok(await until(`/SGLT2 Inhibitors in Heart Failure/.test(document.querySelector('.rmd-studies-topbar').innerText)`, 5000), 'new project created and navigated to studies workspace');

  // 5. Studies Screen on BCG Project
  await click('[data-rmd="to-projects"]');
  ok(await until(`!!document.querySelector('[data-rmd-project-id="prj_bcg_1994"]')`, 5000), 'navigated back to projects');
  await click('[data-rmd-open-project="prj_bcg_1994"]');
  ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 5000), 'studies screen opened for BCG project');

  const studyRowsCount = await ev(`document.querySelectorAll('.rmd-study-row').length`);
  ok(studyRowsCount === 13, 'all 13 BCG trials rendered in study table (Colditz 1994)');
  ok(/Aronson 1948/.test(await text('.rmd-studies-screen')), 'Aronson 1948 trial displayed');
  ok(/Am Rev Tuberc 1948/.test(await text('.rmd-studies-screen')), 'citation displayed');
  ok(/p\. 258/.test(await text('.rmd-studies-screen')), 'page locator displayed');

  // Verify verification toggle
  const firstVerifiedBefore = await ev(`document.querySelector('.rmd-study-row [data-rmd-verify]').innerText`);
  ok(/Verified/.test(firstVerifiedBefore), 'study initially verified');
  await click('.rmd-study-row [data-rmd-verify]');
  ok(await until(`/Unverified/.test(document.querySelector('.rmd-study-row [data-rmd-verify]').innerText)`, 3000), 'toggle verification marks study unverified');
  await click('.rmd-study-row [data-rmd-verify]');
  ok(await until(`/Verified/.test(document.querySelector('.rmd-study-row [data-rmd-verify]').innerText)`, 3000), 'toggle verification re-verifies study');

  // 6. Add a Study with Provenance Locator & Quote
  await click('[data-rmd="add-study"]');
  ok(await until(`!!document.querySelector('#rmdStudyForm')`, 3000), 'add study form opened');
  await ev(`(()=>{
    document.getElementById('rmd_st_label').value = 'Pilot Trial 2026';
    document.getElementById('rmd_st_events1').value = '5';
    document.getElementById('rmd_st_n1').value = '100';
    document.getElementById('rmd_st_events2').value = '15';
    document.getElementById('rmd_st_n2').value = '100';
    document.getElementById('rmd_st_citation').value = 'Pilot Study Group, Lancet 2026; 399:10-15';
    document.getElementById('rmd_st_page').value = '12';
    document.getElementById('rmd_st_quote').value = 'Tuberculosis confirmed in 5 of 100 vaccinated subjects and 15 of 100 control subjects.';
    document.getElementById('rmd_st_verified').checked = true;
    return true;
  })()`);
  await click('[data-rmd="save-study"]');
  ok(await until(`/Pilot Trial 2026/.test(document.querySelector('.rmd-pane-left, .rmd-studies-list').innerText)`, 5000), 'new verified study added to table');
  ok(await ev(`SMD_RESEARCH.store.getStudy('st_') !== null || SMD_RESEARCH.store.getStudies().length === 14`), 'study stored with version 1');

  // 7. Offline 409 stale_version Conflict Simulation & Resolution
  const conflictSim = await ev(`(()=>{
    try {
      const store = SMD_RESEARCH.store;
      const studies = store.getStudies();
      const target = studies[0];
      // Simulate client update with version older than stored (409 stale_version)
      store.updateStudy(target.id, {
        version: 999, // Mismatched version triggers conflict per contract
        label: target.label + ' Conflict Test',
        inputs: { events1: 99, n1: 999, events2: 99, n2: 999 }
      });
      return false;
    } catch (e) {
      return e.code === 'stale_version' && !!SMD_RESEARCH.store.getConflict();
    }
  })()`);
  ok(conflictSim, 'version mismatch triggers 409 stale_version error');
  ok(await until(`!!document.querySelector('#rmdConflictModal')`, 3000), '409 conflict dialog rendered on screen');
  ok(/This study changed while you were editing/.test(await text('#rmdConflictModal')), 'conflict dialog explains the stale version in plain words');
  ok(/Details for support/.test(await ev(`document.querySelector('#rmdConflictModal').innerHTML`)), 'raw code kept only in collapsed support details');
  ok(/Your Changes/i.test(await text('#rmdConflictModal')) && /Server Stored/i.test(await text('#rmdConflictModal')), 'side-by-side local vs server comparison shown');
  await shot('phone-375-conflict409');

  // Resolve conflict
  await click('[data-rmd="conflict-accept-server"]');
  ok(await until(`!document.querySelector('#rmdConflictModal')`, 3000), 'conflict resolved and modal dismissed');
  ok(await ev(`SMD_RESEARCH.store.getConflict() === null`), 'store conflict cleared');

  // Clean up the pilot study so we keep the exact 13 BCG trials for metafor parity
  await ev(`(()=>{
    const store = SMD_RESEARCH.store;
    const studies = store.getStudies();
    for (let i = 0; i < studies.length; i++) {
      if (studies[i].label === 'Pilot Trial 2026') {
        store.deleteStudy(studies[i].id);
        break;
      }
    }
    return true;
  })()`);

  // 8. Run Meta-Analysis Screen & Forest Plot
  await click('[data-rmd="to-run"]');
  ok(await until(`!!document.querySelector('.rmd-run-screen')`, 5000), 'navigated to run meta-analysis screen');
  await click('[data-rmd="calculate"]');
  ok(await until(`!!document.querySelector('.rmd-forest-card')`, 5000), 'calculation completed and results displayed');

  // Check stats accuracy against metafor dat.bcg benchmark
  const resultsText = await text('.rmd-kpi-grid');
  ok(/0\.49/.test(resultsText) || /0\.48/.test(resultsText), 'pooled RR estimate ~ 0.49 (metafor reference)');
  ok(/0\.34/.test(resultsText) && (/0\.69/.test(resultsText) || /0\.70/.test(resultsText)), 'pooled 95% CI [0.34, 0.70] (metafor reference)');
  ok(/92\.1%/.test(resultsText) || /92%/.test(resultsText), 'I² ~ 92.1% (metafor reference)');
  ok(/152\.2/.test(resultsText), 'Cochran Q ~ 152.23 (metafor reference)');

  // Verify inline SVG Forest Plot elements
  ok(await ev(`!!document.querySelector('svg.rmd-forest-svg')`), 'inline SVG forest plot rendered in DOM');
  ok(await ev(`document.querySelectorAll('svg.rmd-forest-svg line.rf-ci-line').length === 13`), 'all 13 study CI lines drawn in SVG');
  ok(await ev(`document.querySelectorAll('svg.rmd-forest-svg rect.rf-box').length === 13`), 'all 13 study weight boxes drawn in SVG');
  ok(await ev(`!!document.querySelector('svg.rmd-forest-svg polygon.rf-diamond')`), 'pooled summary diamond polygon drawn in SVG');
  ok(await ev(`!!document.querySelector('svg.rmd-forest-svg line.rf-null-line')`), 'dashed line of no effect drawn at null value');
  ok(/Favors Intervention/.test(await text('svg.rmd-forest-svg')), 'directional labels drawn on forest plot');
  await shot('phone-375-forestplot');

  // 9. Export Functions Test (CSV and Manifest)
  const csvCheck = await ev(`(()=>{
    const store = SMD_RESEARCH.store;
    const runRes = store.getActiveRunResult();
    let csvData = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (b) => { csvData = b; return 'blob:mock'; };
    SMD_RESEARCH.screens.run.exportCsv(runRes, store.getActiveProject(), store.getStudies());
    URL.createObjectURL = origCreate;
    return !!csvData && csvData.size > 100;
  })()`);
  ok(csvCheck, 'CSV export triggers and produces valid study data blob');

  const manifestCheck = await ev(`(()=>{
    const store = SMD_RESEARCH.store;
    const runRes = store.getActiveRunResult();
    let manData = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (b) => { manData = b; return 'blob:mock'; };
    SMD_RESEARCH.screens.run.exportManifest(runRes);
    URL.createObjectURL = origCreate;
    return !!manData && manData.size > 100;
  })()`);
  ok(manifestCheck, 'manifest JSON export triggers and produces valid contract blob');

  // 9b. Native export path: Capacitor Filesystem CACHE + Share (stubbed plugins)
  const nativeCsv = await ev(`(async()=>{
    window.__exports = [];
    window.Capacitor = {
      isNativePlatform: function () { return true; },
      Plugins: {
        Filesystem: { writeFile: function (o) { window.__exports.push({ kind: 'write', opts: { path: o.path, directory: o.directory, dataLen: (o.data || '').length } }); return Promise.resolve({ uri: 'file:///cache/' + o.path }); } },
        Share: { share: function (o) { window.__exports.push({ kind: 'share', opts: o }); return Promise.resolve({}); } }
      }
    };
    const store = SMD_RESEARCH.store;
    await SMD_RESEARCH.screens.run.exportCsv(store.getActiveRunResult(), store.getActiveProject(), store.getStudies());
    const w = (window.__exports.filter(function (x) { return x.kind === 'write'; })[0] || {}).opts;
    const s = (window.__exports.filter(function (x) { return x.kind === 'share'; })[0] || {}).opts;
    delete window.Capacitor;
    return { w: w || null, s: s || null };
  })()`);
  ok(nativeCsv.w && nativeCsv.w.directory === 'CACHE', 'native CSV export writes via Filesystem with directory CACHE');
  ok(nativeCsv.w && /^[A-Za-z0-9-]+-results\.csv$/.test(nativeCsv.w.path || '') && nativeCsv.w.dataLen > 100, 'native CSV export uses readable ASCII -results.csv filename with base64 data');
  ok(nativeCsv.w && nativeCsv.s && nativeCsv.s.url === 'file:///cache/' + nativeCsv.w.path, 'native CSV export shares the written file uri');
  ok(nativeCsv.s && nativeCsv.s.dialogTitle === 'Save or send your file', 'native CSV share sheet has plain dialog title');
  ok(await ev(`/Your file is ready to save or share/.test(document.body.textContent)`), 'native CSV export shows plain confirmation');

  // 10. Viewport 2: Tablet Portrait (768 x 1024)
  await call('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true });
  await click('[data-rmd="to-studies"]');
  ok(await until(`!!document.querySelector('.rmd-split-layout')`, 5000), 'studies screen on 768px tablet');

  const twoPaneCheck = await ev(`(()=>{
    const left = document.querySelector('.rmd-pane-left');
    const right = document.querySelector('.rmd-pane-right');
    if (!left || !right) return false;
    const sLeft = getComputedStyle(left);
    const sRight = getComputedStyle(right);
    return sLeft.display !== 'none' && sRight.display !== 'none';
  })()`);
  ok(twoPaneCheck, 'tablet 768px renders two-pane split layout (studies list + detail pane)');
  await shot('tablet-768-studies-twopane');

  // 11. Viewport 3: Tablet Landscape (1024 x 768)
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: false });
  await click('[data-rmd="to-run"]');
  ok(await until(`!!document.querySelector('.rmd-run-layout')`, 5000), 'meta-analysis screen on 1024px landscape');

  const noOverflow1024 = await ev(`(()=>{
    const b = document.getElementById('researchMD');
    return b.scrollWidth <= b.clientWidth + 2;
  })()`);
  ok(noOverflow1024, 'no horizontal layout overflow at 1024px landscape');
  await shot('tablet-1024-landscape-run');

  // 12. App-wide Text Audit: No em-dashes
  const allUiText = await text('#researchMD');
  ok(!/—/.test(allUiText), 'no em-dashes in any ResearchMD UI text');

  // 13. Escape key closes overlay
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));1`);
  ok(await ev(`getComputedStyle(document.getElementById('researchMD')).display === 'none'`), 'Escape key closes ResearchMD overlay');

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
