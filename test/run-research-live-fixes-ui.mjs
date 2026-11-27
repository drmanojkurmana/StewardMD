// Real-browser headless test: ResearchMD live-fix batch (390px phone).
// Covers the rmd-live-fix-b changes end to end against the real files:
//   BUG-06 sample size output, BUG-07 CONSORT/CTRI theming, BUG-10 CONSORT
//   banner + svg height, BUG-11 rename project, BUG-12 search 429 banner
//   placement, institution empty state and find-sheet entity decoding.
//   node test/run-research-live-fixes-ui.mjs   (CHROME=/path/to/chrome to override)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => existsSync(p));

const PORT = 9123, CDP = 9523, OUT = '/tmp/stewardmd-research-live-fixes';
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
};

const apiCalls = [];
let patchBody = null;

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      apiCalls.push(p + ' ' + req.method);
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      let b = {};
      try { b = JSON.parse(body || '{}'); } catch { b = {}; }
      if (p === '/api/research/v1/projects/prj_fix/searches' && req.method === 'POST') {
        return send(429, { error: { code: 'search_rate_limited', message: 'This search matched too many articles for daytime PubMed limits. Narrow your query (e.g. add trial or a date range) or use Europe PMC.' } });
      }
      if (p === '/api/research/v1/projects/prj_fix/searches') {
        return send(200, { searchRuns: [], nextCursor: null });
      }
      if (p === '/api/research/v1/projects/prj_fix' && (req.method === 'PATCH' || req.method === 'PUT')) {
        patchBody = b;
        return send(200, { project: { id: 'prj_fix', title: b.title || '', role: 'owner' } });
      }
      if (p === '/api/research/v1/projects/prj_fix/find-studies') {
        return send(200, {
          results: [
            { pmid: '31234', title: 'Iron &amp; tuberculosis review', abstract: 'BACKGROUND &amp; OBJECTIVES: Iron status and tuberculosis therapy.', authors: ['Patel R'], journal: 'J Synth', year: 2024 }
          ]
        });
      }
      if (p === '/api/research/v1/institutions') {
        return send(200, { institutions: [] });
      }
      return send(404, { error: { code: 'not_found', message: 'Unknown Research API endpoint' } });
    });
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

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-live-fixes-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
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
    try { if (await ev(expr)) return true; } catch { /* page busy */ }
    await sleep(100);
  }
  return false;
};
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);

function contrastRatio(fg, bg) {
  const lum = (c) => {
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const lin = [1, 2, 3].map((i) => {
      const v = +m[i] / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const a = lum(fg), b = lum(bg);
  if (a == null || b == null) return null;
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH', 30000), 'app loaded with ResearchMD');

  // Seed a server RCT project.
  await ev(`(()=>{
    localStorage.setItem('smd_research_state_v1', JSON.stringify({
      projects: [{ id: 'prj_fix', serverId: 'prj_fix', title: 'Live fixes trial', discipline: 'medicine', specialty: '', studyType: 'Randomized Controlled Trial', researchQuestion: '', role: 'owner', createdAt: Date.now(), updatedAt: Date.now() }],
      activeProjectId: 'prj_fix', studies: { prj_fix: [] }, activeStudyId: null, runs: { prj_fix: [] }, offlineQueue: [], syncState: 'synced', conflict: null
    }));
    SMD_RESEARCH.store.init();
    return 1;
  })()`);
  await ev(`SMD_RESEARCH.open({screen:'plan'});1`);
  ok(await until(`!!document.querySelector('#rmdCardSampleSize')`, 8000), 'plan screen rendered');

  // BUG-06: sample size renders real numbers for the default aim.
  await sleep(300);
  const ssText = await text('.rmd-data-box');
  ok(/121 per group \(242 total\)/.test(ssText), 'sample size shows 121 per group (242 total)');
  ok(/With 10% loss to follow-up: 134 per group \(268 total\)/.test(ssText), 'dropout line shows 134 per group (268 total)');
  ok(!/undefined|NaN/.test(ssText), 'no undefined or NaN in the sample size output');
  ok(await until('document.documentElement.scrollWidth <= 393', 5000), '390px no horizontal scroll on plan');

  // BUG-07 + BUG-10: CONSORT theming and honest banner.
  await ev(`SMD_RESEARCH.navigate('consort');1`);
  ok(await until(`!!document.querySelector('.rmd-consort-screen')`, 8000), 'consort screen rendered');
  const consortText = await text('.rmd-consort-screen');
  ok(consortText.indexOf('CONSORT flow for this trial') >= 0, 'consort banner names the screen');
  ok(consortText.indexOf('Step 1 of 9') < 0, 'no fake Step 1 of 9 on consort');
  ok(consortText.indexOf('Next: Master chart') < 0, 'no invented Next label on consort');
  ok(await ev(`!document.querySelector('.rmd-consort-screen svg[height="auto"]')`), 'consort svg has no height="auto"');
  const cardBg = await ev(`getComputedStyle(document.querySelector('.rmd-consort-form > div')).backgroundColor`);
  ok(cardBg !== 'rgb(7, 19, 24)', 'consort form card is not hardcoded #071318 (got ' + cardBg + ')');
  const labelStyle = await ev(`(function(){
    var card = document.querySelector('.rmd-consort-form > div');
    var label = card.querySelector('label');
    return { color: getComputedStyle(label).color, bg: getComputedStyle(card).backgroundColor };
  })()`);
  const cr = contrastRatio(labelStyle.color, labelStyle.bg);
  ok(cr != null && cr >= 4.5, `consort label contrast ${(cr || 0).toFixed(2)}:1 in light theme`);
  const bannerContrast = await ev(`(function(){
    var b = document.querySelector('#rmd-consort-banner');
    var cs = getComputedStyle(b);
    return { color: cs.color, bg: cs.backgroundColor };
  })()`);
  const bc = contrastRatio(bannerContrast.color, bannerContrast.bg);
  ok(bc != null && bc >= 4.5, `consort arithmetic banner contrast ${(bc || 0).toFixed(2)}:1 in light theme`);

  // BUG-07: CTRI theming in light theme.
  await ev(`SMD_RESEARCH.navigate('ctri');1`);
  ok(await until(`!!document.querySelector('.rmd-ctri-screen')`, 8000), 'ctri screen rendered');
  const ctriInput = await ev(`(function(){
    var el = document.querySelector('#rmd-ctri-number');
    return el ? getComputedStyle(el).backgroundColor : '';
  })()`);
  ok(ctriInput !== 'rgb(7, 19, 24)', 'ctri input is not hardcoded #071318 (got ' + ctriInput + ')');
  const ctriHeading = await ev(`(function(){
    var h = document.querySelector('.rmd-ctri-screen .rmd-notice-box');
    var cs = getComputedStyle(h);
    return { color: cs.color, bg: cs.backgroundColor };
  })()`);
  const cc = contrastRatio(ctriHeading.color, ctriHeading.bg);
  ok(cc != null && cc >= 4.5, `ctri notice contrast ${(cc || 0).toFixed(2)}:1 in light theme`);

  // BUG-07: the same screens in dark theme (v3-dark); the tokens must hold there too.
  await ev(`document.body.classList.add('v3-dark');1`);
  await ev(`SMD_RESEARCH.navigate('consort');1`);
  ok(await until(`!!document.querySelector('.rmd-consort-screen')`, 8000), 'consort screen rendered in dark theme');
  const darkConsort = await ev(`(function(){
    var card = document.querySelector('.rmd-consort-form > div');
    var label = card.querySelector('label');
    var banner = document.querySelector('#rmd-consort-banner');
    return { label: getComputedStyle(label).color, card: getComputedStyle(card).backgroundColor, banner: getComputedStyle(banner).color, bannerBg: getComputedStyle(banner).backgroundColor };
  })()`);
  const dcr = contrastRatio(darkConsort.label, darkConsort.card);
  ok(dcr != null && dcr >= 4.5, `consort label contrast ${(dcr || 0).toFixed(2)}:1 in dark theme`);
  const dcb = contrastRatio(darkConsort.banner, darkConsort.bannerBg);
  ok(dcb != null && dcb >= 4.5, `consort banner contrast ${(dcb || 0).toFixed(2)}:1 in dark theme`);
  await ev(`SMD_RESEARCH.navigate('ctri');1`);
  ok(await until(`!!document.querySelector('.rmd-ctri-screen')`, 8000), 'ctri screen rendered in dark theme');
  const darkCtri = await ev(`(function(){
    var h = document.querySelector('.rmd-ctri-screen .rmd-notice-box');
    var cs = getComputedStyle(h);
    return { color: cs.color, bg: cs.backgroundColor };
  })()`);
  const dcc = contrastRatio(darkCtri.color, darkCtri.bg);
  ok(dcc != null && dcc >= 4.5, `ctri notice contrast ${(dcc || 0).toFixed(2)}:1 in dark theme`);
  await ev(`document.body.classList.remove('v3-dark');1`);

  // BUG-12: search 429 banner sits under the Run button.
  await ev(`SMD_RESEARCH.navigate('search');1`);
  ok(await until(`!!document.querySelector('[data-rmd="search-run"]')`, 8000), 'search screen rendered with the run button');
  await ev(`(()=>{
    var ta = document.querySelector('#rmd_search_query');
    if (!ta) return false;
    ta.value = 'BCG AND tuberculosis';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await ev(`document.querySelector('[data-rmd="search-run"]').click();1`);
  ok(await until(`!!document.querySelector('[data-rmd="search-run-error"]')`, 8000), 'the run error banner rendered');
  ok(/rate limit/i.test(await text('[data-rmd="search-run-error"]')), 'the banner carries the rate limit message');
  const pos = await ev(`(function(){
    var btn = document.querySelector('[data-rmd="search-run"]');
    var err = document.querySelector('[data-rmd="search-run-error"]');
    btn.scrollIntoView({ block: 'center' });
    var br = btn.getBoundingClientRect();
    var er = err.getBoundingClientRect();
    return { btnTop: Math.round(br.top), errTop: Math.round(er.top), errBottom: Math.round(er.bottom), gap: Math.round(er.top - br.bottom) };
  })()`);
  ok(pos.errTop > pos.btnTop && pos.gap >= 0 && pos.gap < 200, `error banner sits right under the run button (gap ${pos.gap}px)`);
  ok(pos.errBottom <= 844 + 2, 'error banner is on screen at 390x844 when the button is in view');

  // BUG-12: institution empty state, no inst_default requests.
  apiCalls.length = 0;
  await ev(`SMD_RESEARCH.navigate('institution');1`);
  ok(await until(`!!document.querySelector('.rmd-empty-state')`, 8000), 'institution empty state rendered');
  ok((await text('#rmdScreenBody')).indexOf('No institution workspace yet') >= 0, 'institution copy explains the empty state');
  ok((await text('#rmdScreenBody')).indexOf('Medical Research Institute') < 0, 'no mock institution data');
  await sleep(300);
  ok(!apiCalls.some((c) => c.indexOf('inst_default') >= 0), 'no inst_default requests fired');

  // BUG-11: rename a project from its card.
  await ev(`SMD_RESEARCH.navigate('projects');1`);
  ok(await until(`!!document.querySelector('[data-rmd-rename-project="prj_fix"]')`, 8000), 'project card has a Rename button');
  await ev(`document.querySelector('[data-rmd-rename-project="prj_fix"]').click();1`);
  ok(await until(`!!document.querySelector('#rmdRenameModal')`, 8000), 'rename dialog opened');
  ok((await ev(`document.querySelector('#rmd_rename_title').value`)) === 'Live fixes trial', 'rename dialog prefills the current title');
  await ev(`(()=>{
    var inp = document.querySelector('#rmd_rename_title');
    inp.value = 'Renamed sepsis trial';
    return true;
  })()`);
  await ev(`document.querySelector('#rmdRenameForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));1`);
  ok(await until(`!document.querySelector('#rmdRenameModal')`, 8000), 'rename dialog closed after saving');
  ok(patchBody && patchBody.title === 'Renamed sepsis trial', 'PATCH /v1/projects/prj_fix carried the new title');
  ok(await until(`(document.querySelector('.rmd-project-title')||{}).textContent === 'Renamed sepsis trial'`, 8000), 'project card shows the new name');
  ok(await until('document.documentElement.scrollWidth <= 393', 5000), '390px no horizontal scroll on projects');

  // BUG-12: find sheet decodes entities once.
  await ev(`SMD_RESEARCH.navigate('studies');1`);
  ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 8000), 'studies screen rendered');
  await ev(`SMD_RESEARCH.find.open(SMD_RESEARCH.store.getActiveProject());1`);
  ok(await until(`!!document.querySelector('#rmdFindSheet')`, 8000), 'find sheet opened');
  await ev(`(()=>{
    var inp = document.querySelector('#rmd_find_query');
    if (!inp) return false;
    inp.value = 'BCG tuberculosis';
    return true;
  })()`);
  await ev(`document.querySelector('[data-find="search"]').click();1`);
  ok(await until(`!!document.querySelector('.rmd-find-result')`, 8000), 'find results rendered');
  const sheetText = await text('#rmdFindSheet');
  ok(sheetText.indexOf('BACKGROUND & OBJECTIVES') >= 0, 'find abstract shows the entity decoded once');
  ok(sheetText.indexOf('&amp;') < 0, 'no literal &amp; in the rendered abstract');
  ok((await text('#rmdFindSheet')).indexOf('Iron & tuberculosis') >= 0, 'find title decoded once');

  ok(await until('document.documentElement.scrollWidth <= 393', 5000), '390px no horizontal scroll at the end');
  const dashText = await text('#researchMD');
  ok(!/\u2014|\u2013/.test(dashText), 'no em or en dashes in ResearchMD visible text');
} catch (e) {
  console.error('HARNESS ERROR', e);
  failures++;
} finally {
  try { chrome.kill('SIGKILL'); } catch {}
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL RESEARCH LIVE-FIX UI CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}
