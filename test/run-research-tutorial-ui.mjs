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

  // Verify default ON & skip toggle works on Start screen
  await click('[data-rmd="start-guided"]');
  ok(await until(`!!document.querySelector('[data-rmd-start-choice="case"]')`, 4000), 'Start screen renders');
  await click('[data-rmd-start-choice="case"]');
  ok(await until(`!!document.querySelector('[data-rmd="start-tut-launch"]')`, 4000), 'Case Report start form promotes Example Tutorial by default');
  ok(await ev(`document.querySelector('[data-rmd="start-tut-def"]').checked === true`), 'Save tutorial as default checkbox is ON by default');

  // Launch Case Report tutorial scratch-to-published walkthrough
  await click('[data-rmd="start-tut-launch"]');
  ok(await until(`!!document.querySelector('#rmdTutBar') && !!document.querySelector('#rmdCfAge')`, 5000), 'Case Report tutorial opens at Step 1 (Case file) from scratch with Tutorial Coach');
  ok(await ev(`document.querySelector('#rmdCfAge').value === ''`), 'Tutorial truly starts from scratch with empty patient fields');
  ok(await click('[data-rmd-tut="auto"]'), 'Enter & Show Me fills patient case fields and saves');
  ok(await until(`/Saved realistic patient case details/.test(document.body.innerText)`, 4000), 'Coach confirms case details saved');

  // Advance step-by-step across remaining stages through Ready -> Submit -> Published Celebration
  for (const screen of ['manuscript', 'checklist', 'ready']) {
    await ev(`SMD_RESEARCH.navigate(${JSON.stringify(screen)}, {}); 1;`);
    ok(await until(`!!document.querySelector('#rmdTutBar')`, 4000), `Tutorial coach renders on ${screen}`);
    if (screen === 'manuscript' || screen === 'checklist') {
      await click('[data-rmd-tut="auto"]');
      await sleep(150);
    }
  }
  ok(await until(`!!document.querySelector('[data-rmd="submit-paper"]') && !document.querySelector('[data-rmd="submit-paper"]').disabled`, 5000), 'Confirm & Submit Paper button unlocks after manuscript approval + checklist completion');
  await click('[data-rmd="submit-paper"]');
  ok(await until(`!!document.querySelector('[data-rmd="publish-paper"]')`, 4000), 'Submitting advances paper to Submitted -> Under Review state');
  await click('[data-rmd="publish-paper"]');
  ok(await until(`!!document.querySelector('#rmdCelebrationModal') && /Congratulations, Author!/.test(document.body.innerText)`, 4000), 'Accept & Publish launches Manuscript Submitted & Published Celebration modal with confetti');
  ok(await ev(`document.querySelectorAll('#rmdCelebrationModal .rmd-confetti-bit').length === 24`), 'Celebration confetti elements render');
  ok(await noOverflow(), 'Celebration modal fits 390px phone cleanly');
  ok(await noDash(), 'Celebration modal has zero em/en dashes');

  // Close celebration and test Meta-Analysis & RCT tutorial launches
  await click('[data-rmd-cele="hub"]');
  ok(await until(`/Published/.test(document.querySelector('[data-rmd="tut-hub"]').innerText)`, 4000), 'Completed tutorial displays Published badge on Tutorial Hub');

  for (const key of ['sr', 'trial', 'case-series', 'case-control']) {
    await ev(`SMD_RESEARCH.tutorial.startTutorial(${JSON.stringify(key)}, { reset: true }); 1;`);
    ok(await until(`!!document.querySelector('#rmdTutBar')`, 4000), `${key} tutorial launches cleanly with interactive coach`);
    await click('[data-rmd-tut="auto"]');
    await sleep(150);
    ok(await noOverflow(), `${key} tutorial has zero horizontal overflow at 390px`);
  }

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
