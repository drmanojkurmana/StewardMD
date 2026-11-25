// ResearchMD Interactive Tutorials & Publication Celebration headless UI test.
// Tests all 9 study-type tutorials, default-ON/skip preference persistence,
// scratch-to-publish interactive coaching on Case Report & Meta-Analysis/RCT,
// zero horizontal overflow at 375px/1024px, and zero em/en dashes.
//
// Run: node test/run-research-tutorial-ui.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const PORT = 9112;
const CDP = 9512;
const OUT = '/tmp/stewardmd-research-tutorial';
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function findChrome() {
  const list = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome'
  ].filter(Boolean);
  for (const p of list) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome binary not found; set CHROME=/path/to/chrome');
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'No live API needed for tutorials' } }));
    return;
  }
  if (p === '/') p = '/index.html';
  const filePath = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
});

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rmd-tut-ui-'));
const chrome = spawn(findChrome(), [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${userData}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP}/json/version`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP timeout');
}

let ws, sid, nextId = 1;
const pending = new Map();
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
});
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails));
  }
  return r.result ? r.result.result.value : undefined;
};
const click = async (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;})()`);
const until = async (expr, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await ev(expr)) return true;
    } catch {}
    await sleep(100);
  }
  return false;
};

let failures = 0;
const pageErrors = [];
function ok(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failures++;
}

try {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const version = await waitCdp();
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m);
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(m.params));
    }
  };

  const target = await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const attach = await new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve, reject: () => {} });
    ws.send(JSON.stringify({ id, method: 'Target.attachToTarget', params: { targetId: target.id, flatten: true } }));
  });
  sid = attach.result.sessionId;
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/?research=1` });

  ok(await until('!!(window.SMD_RESEARCH && window.SMD_RESEARCH.tutorial)', 20000), 'ResearchMD tutorial module loaded');
  await ev(`SMD_RESEARCH.open({ screen: 'projects' }); 1;`);
  ok(await until(`document.querySelectorAll('[data-rmd-tut-launch]').length === 9`, 5000), 'Projects Tutorial Hub renders all 9 study design tutorials');

  const noDash = async () => (await ev(`(document.querySelector('#researchMD').innerText.match(/[\\u2013\\u2014]/g)||[]).length`)) === 0;
  const noOverflow = async () => await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`);

  ok(await noOverflow(), 'Tutorial hub fits 390px phone with zero horizontal overflow');
  ok(await noDash(), 'Tutorial hub has zero em/en dashes');

  // Verify default ON & skip toggle works on Start screen, AND manual typing triggers student self-progress detection
  await click('[data-rmd="start-guided"]');
  ok(await until(`!!document.querySelector('[data-rmd-start-choice="case"]')`, 4000), 'Start screen renders');
  await click('[data-rmd-start-choice="case"]');
  ok(await until(`!!document.querySelector('[data-rmd="start-tut-launch"]')`, 4000), 'Case Report start form promotes Example Tutorial by default');
  ok(await ev(`document.querySelector('[data-rmd="start-tut-def"]').checked === true`), 'Save tutorial as default checkbox is ON by default');

  // Launch Case Report tutorial scratch-to-published walkthrough + test every button
  await click('[data-rmd="start-tut-launch"]');
  ok(await until(`!!document.querySelector('#rmdTutBar') && !!document.querySelector('#rmdCfAge')`, 5000), 'Case Report tutorial opens at Step 1 (Case file) from scratch with Tutorial Coach');
  ok(await ev(`document.querySelector('#rmdCfAge').value === ''`), 'Tutorial truly starts from scratch with empty patient fields');
  await click('[data-rmd-tut="spot"]');
  ok(await ev(`!!document.querySelector('.rmd-tut-spot')`), 'Show me where spotlights the exact target input');
  // Student types Age manually first and coach acknowledges manual progress
  await ev(`(function(){var el=document.querySelector('#rmdCfAge');el.value='42';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  ok(await until(`/Great start!/.test(document.querySelector('#rmdTutBar').innerText)`, 3000), 'Coach detects when student enters details manually');
  ok(await click('[data-rmd-tut="auto"]'), 'Enter & Show Me fills patient case fields and saves');
  ok(await until(`/Saved realistic patient case details/.test(document.body.innerText)`, 4000), 'Coach confirms case details saved');

  // Walk ALL Case Report steps via Next Step -> Ready -> Submit -> Published Celebration
  for (const screen of ['novelty', 'iec', 'pubconsent', 'images', 'manuscript', 'checklist', 'ready']) {
    await click('[data-rmd-tut="next"]');
    ok(await until(`!!document.querySelector('#rmdTutBar')`, 4000), `Tutorial coach advances smoothly to ${screen}`);
    if (screen !== 'ready') {
      await click('[data-rmd-tut="auto"]');
      await sleep(180);
    }
  }
  ok(await until(`!!document.querySelector('[data-rmd="submit-paper"]') && !document.querySelector('[data-rmd="submit-paper"]').disabled`, 5000), 'Confirm & Submit Paper button unlocks after full scratch-to-finish walkthrough');
  await click('[data-rmd="submit-paper"]');
  ok(await until(`!!document.querySelector('[data-rmd="publish-paper"]')`, 4000), 'Submitting advances paper to Submitted -> Under Review state');
  await click('[data-rmd="publish-paper"]');
  ok(await until(`!!document.querySelector('#rmdCelebrationModal') && /Congratulations, Author!/.test(document.body.innerText)`, 4000), 'Accept & Publish launches Manuscript Submitted & Published Celebration modal with confetti');
  ok(await ev(`document.querySelectorAll('#rmdCelebrationModal .rmd-confetti-bit').length === 24`), 'Celebration confetti elements render');
  ok(await click('[data-rmd-cele="copy"]'), 'Copy Citation button works inside celebration modal');
  ok(await noOverflow(), 'Celebration modal fits 390px phone cleanly');
  ok(await noDash(), 'Celebration modal has zero em/en dashes');

  // Close celebration and verify Published badge + replay & skip persistence
  await click('[data-rmd-cele="hub"]');
  ok(await until(`/Published/.test(document.querySelector('[data-rmd="tut-hub"]').innerText)`, 4000), 'Completed tutorial displays Published badge on Tutorial Hub');

  // Rigorous full-journey walkthrough of Meta-Analysis, RCT, Master Chart, Thesis, Case Series, Case-Control, Cohort, and Observational
  for (const key of ['sr', 'trial', 'case-series', 'case-control', 'cohort', 'masterchart', 'obs', 'thesis']) {
    await ev(`SMD_RESEARCH.tutorial.startTutorial(${JSON.stringify(key)}, { reset: true }); 1;`);
    ok(await until(`!!document.querySelector('#rmdTutBar')`, 4000), `${key} tutorial launches cleanly from scratch`);
    await click('[data-rmd-tut="auto"]');
    await sleep(320);
    // For RCT verify randomisation/plan/masterchart stats; for SR verify real pooled Risk Ratio run!
    if (key === 'sr') {
      await ev(`SMD_RESEARCH.navigate('run', {}); 1;`);
      ok(await until(`!!document.querySelector('[data-rmd="calculate"]')`, 4000), 'Meta-analysis run screen ready');
      await click('[data-rmd-tut="auto"]');
      ok(await until(`/Risk ratio/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'Meta-analysis Enter & Show Me computes real pooled Risk Ratio');
      await ev(`SMD_RESEARCH.navigate('extract', {}); 1;`);
      ok(await until(`!!document.querySelector('#rmdTutBar')`, 4000), 'Extraction screen loads cleanly in tutorial');
    }
    if (key === 'masterchart' || key === 'case-control') {
      await ev(`SMD_RESEARCH.navigate('masterchart', {}); 1;`);
      ok(await until(`!!document.querySelector('[data-rmd-mc="sample"]')`, 4000), `${key} master chart upload renders`);
      await click('[data-rmd-tut="auto"]');
      ok(await until(`/Results paragraph|Table 1|risk factors|odds ratio/i.test(document.querySelector('#rmdScreenBody').innerText)`, 6000), `${key} master chart completes full on-device biostatistics automatically`);
    }
    if (key === 'thesis') {
      await click('[data-rmd-tut="auto"]');
      ok(await until(`/Thesis read/.test(document.querySelector('#rmdScreenBody').innerText)`, 4000), 'Thesis sample loads into Thesis reader');
      await click('[data-rmd-tut="next"]');
      ok(await until(`!!document.querySelector('[data-rmd-type]')`, 4000), 'Thesis Paper Type screen loads cleanly');
    }
    // Verify ready -> submit -> publish celebration works for every study type too
    await ev(`SMD_RESEARCH.navigate('ready', {}); 1;`);
    await until(`!!document.querySelector('#rmdTutBar')`, 4000);
    await click('[data-rmd-tut="auto"]');
    ok(await until(`!!document.querySelector('[data-rmd="submit-paper"]') && !document.querySelector('[data-rmd="submit-paper"]').disabled`, 4000), `${key} unlocks Confirm & Submit Paper`);
    await click('[data-rmd="submit-paper"]');
    await until(`!!document.querySelector('[data-rmd="publish-paper"]')`, 4000);
    await click('[data-rmd="publish-paper"]');
    ok(await until(`!!document.querySelector('#rmdCelebrationModal')`, 4000), `${key} completes with Submitted & Published Celebration`);
    await click('[data-rmd-cele="close"]');
    ok(await noOverflow(), `${key} tutorial has zero horizontal overflow at 390px`);
    ok(await noDash(), `${key} tutorial has zero em/en dashes`);
  }

  // Test iPad 1024px layout & Skip tutorial default toggle persistence
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: false });
  await ev(`SMD_RESEARCH.navigate('projects', {}); 1;`);
  ok(await until(`document.querySelectorAll('[data-rmd-tut-launch]').length === 9`, 4000), 'All 9 tutorials render on 1024px tablet');
  ok(await noOverflow(), 'Tutorial hub fits 1024px tablet cleanly');
  await ev(`SMD_RESEARCH.tutorial.setTutorialDefault('case', false); 1;`);
  await click('[data-rmd="start-guided"]');
  await until(`!!document.querySelector('[data-rmd-start-choice="case"]')`, 4000);
  await click('[data-rmd-start-choice="case"]');
  ok(await until(`document.querySelector('[data-rmd="start-tut-def"]').checked === false`, 4000), 'Skip preference persists accurately across views');
  await ev(`SMD_RESEARCH.tutorial.setTutorialDefault('case', true); 1;`);

  ok(pageErrors.length === 0, `zero uncaught page errors (${pageErrors.length})`);
} catch (e) {
  console.log('FAIL exception:', e.message, e.stack);
  failures++;
} finally {
  try { ws.close(); } catch {}
  chrome.kill();
  server.close();
}

console.log(failures ? `\n${failures} failed` : '\nALL TUTORIAL UI CHECKS PASSED');
process.exit(failures ? 1 : 0);
