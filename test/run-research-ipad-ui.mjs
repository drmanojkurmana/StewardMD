// Real-browser headless test: ResearchMD iPad layout + "Ask MaiK" on every step.
// Renders Protocol and Studies (plus Search, Risk of Bias, Checklist) at
// 1024x1366 (iPad portrait) and 390x844 (iPhone), and sweeps 1366x1024 and
// 820x1180. Asserts: wide forms (>700px) on iPad, two-column short fields on
// iPad / one column on phone, no horizontal page scroll, the compact step
// banner stays <=64px tall on phone, and both "Ask MaiK to draft it" and
// "Do it myself" appear on Protocol, Search, Risk of Bias and Checklist.
//   node test/run-research-ipad-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9114, CDP = 9514, OUT = '/tmp/stewardmd-research-ipad';
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

// Minimal RoB 2 tool so the Risk of Bias assess pane (and its MaiK bar) mounts.
const ROB_TOOLS = [{
  id: 'rob2', name: 'RoB 2', source: 'Sterne et al BMJ 2019;366:l4898', overallRule: 'worst_domain_rob2',
  domains: [
    { key: 'd1', label: 'Randomization process', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [{ key: '1.1', text: 'Was the allocation sequence random?' }] },
    { key: 'd2', label: 'Deviations from intended interventions', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [] },
    { key: 'd3', label: 'Missing outcome data', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [] },
    { key: 'd4', label: 'Measurement of the outcome', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [] },
    { key: 'd5', label: 'Selection of the reported result', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [] }
  ]
}];
const SERVER_STUDIES = [{
  id: 'st_1', label: 'Aronson 1948', measure: 'RR',
  inputs: { events1: 4, n1: 100, events2: 8, n2: 100 },
  locator: { kind: 'manual', citation: 'Aronson 1948', page: '12', quote: 'BCG reduced tuberculosis' },
  quote: 'BCG reduced tuberculosis', verified: false, version: 1
}];
// A tiny PRISMA-style guideline so the checklist engine fills and the MaiK bar mounts.
const CHECKLIST = {
  id: 'prisma2020', name: 'PRISMA 2020', version: '2020',
  sections: [{
    title: 'Title',
    items: [{ num: '1', topic: 'Title', text: 'Identify the report as a systematic review.', projectField: '' }]
  }]
};
// Server shape from docs/research/contracts/phase-5/ai-draft.md (nested pico and outcomes).
const PROTOCOL_DRAFT = {
  title: 'BCG vaccination for tuberculosis prevention',
  pico: { population: 'Infants and children under 5 years', intervention: 'BCG vaccination at birth', comparison: 'No vaccination or placebo', outcome: 'Incidence of active tuberculosis' },
  peco: null,
  eligibility: ['Randomized or quasi-randomized trials'],
  outcomes: { primary: 'Confirmed tuberculosis at any follow-up', secondary: ['All-cause mortality'] },
  analysis: { measure: 'RR', model: 'random-effects' }
};

let draftCalls = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  const q = u.searchParams;
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (p.startsWith('/api/')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let b = {};
      try { b = JSON.parse(body || '{}'); } catch { b = {}; }
      const m = (re) => p.match(re);
      let mm;

      // Shared Ask MaiK route (server built on the other branch; mocked here).
      if ((mm = m(/^\/api\/research\/v1\/projects\/([^/]+)\/ai-draft$/)) && req.method === 'POST') {
        draftCalls++;
        const task = b.task;
        if (task === 'protocol') return send(200, { draft: PROTOCOL_DRAFT, model: 'gemini-2.5-flash', costInr: 2 });
        if (task === 'search_query') return send(200, { draft: { pubmed: '("BCG"[MeSH]) AND "tuberculosis"[MeSH]', europePmc: 'BCG AND tuberculosis' }, model: 'gemini-2.5-flash', costInr: 2 });
        if (task === 'rob') return send(200, { draft: { domains: [{ key: 'd1', judgment: 'low', reason: 'Random sequence described.', quote: 'BCG reduced tuberculosis' }] }, model: 'gemini-2.5-flash', costInr: 2 });
        if (task === 'checklist') return send(200, { draft: { guidelineId: 'prisma2020', items: [{ itemNum: '1', topic: 'Title', status: 'missing', section: '' }] }, model: 'gemini-2.5-flash', costInr: 2 });
        if (task === 'title_abstract') return send(200, { draft: { title: 'BCG for TB', abstract: 'Background: {{run:r1.estimate}}' }, model: 'gemini-2.5-flash', costInr: 2 });
        return send(400, { error: { code: 'unknown_task', message: 'Unknown task' } });
      }

      // Protocol
      if (m(/^\/api\/research\/v1\/projects\/[^/]+\/protocols$/) && req.method === 'GET') return send(200, { protocols: [] });
      if (m(/^\/api\/research\/v1\/projects\/[^/]+\/protocols$/) && req.method === 'POST') {
        return send(201, { protocol: { id: 'proto_1', version: 1, status: 'draft', content: b.content || {} } });
      }

      // Search
      if (m(/^\/api\/research\/v1\/projects\/[^/]+\/searches$/) && req.method === 'GET') return send(200, { searchRuns: [], nextCursor: null });

      // Risk of Bias
      if (p === '/api/research/v1/rob-tools' && req.method === 'GET') return send(200, { tools: ROB_TOOLS });
      if (m(/^\/api\/research\/v1\/projects\/[^/]+\/studies$/) && req.method === 'GET') return send(200, { studies: SERVER_STUDIES });
      if (m(/^\/api\/research\/v1\/projects\/[^/]+\/studies\/([^/]+)\/rob$/)) {
        if (req.method === 'GET') return send(200, { assessment: { self: { submitted: false, domains: [] }, peer: { hidden: true }, outcome: null } });
        return send(200, { assessment: { self: { submitted: true, domains: b.domains || [] }, peer: { hidden: true }, outcome: 'agreement' } });
      }

      // Checklist
      if (p === '/api/research/v1/checklists' && req.method === 'GET') return send(200, { checklists: [{ id: 'prisma2020', name: 'PRISMA 2020', version: '2020' }] });
      if (m(/^\/api\/research\/v1\/checklists\/([^/]+)$/) && req.method === 'GET') return send(200, { checklist: CHECKLIST });
      if (m(/^\/api\/research\/v1\/projects\/[^/]+\/checklist-snapshot$/) && req.method === 'GET') return send(200, { snapshot: {} });
      if (m(/^\/api\/research\/v1\/projects\/[^/]+\/checklist-manual\/([^/]+)$/)) {
        if (req.method === 'GET') return send(200, { entries: {} });
        return send(200, { entries: { [b.num]: b.text } });
      }

      // Anything else: benign empty so layout still mounts (no friendly-404 card).
      return send(200, {});
    });
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
  `--user-data-dir=/tmp/rmd-ipad-chrome-${process.pid}`,
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

const setViewport = async (width, height, mobile) => {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  // The app's Display autoFit (home.js) zooms <html>; pin zoom to 1 so the emulated
  // device width maps 1:1 to CSS layout pixels for the layout assertions.
  try { await ev(`document.documentElement.style.zoom='1';1`); } catch { /* page not ready */ }
};

const noOverflow = () => ev(`(()=>{const b=document.querySelector('#researchMD');if(!b)return false;return b.scrollWidth<=b.clientWidth+2 && document.documentElement.scrollWidth<=document.documentElement.clientWidth})()`);
const widthOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 0;return e.offsetWidth})()`);
const colCount = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 0;const g=getComputedStyle(e).gridTemplateColumns;return g.split(/\\s+/).filter(Boolean).length})()`);
const hasAiBar = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)});if(!r)return false;const a=r.querySelector('[data-rmd-ai="ask"]');const m=r.querySelector('[data-rmd-ai="manual"]');return !!(a&&m)&&/Ask MaiK to draft it/.test(a.innerText)&&/Do it myself/.test(m.innerText)})()`);

async function shot(name) {
  await sleep(150);
  await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`);
  await mkdir(OUT, { recursive: true });
  const r = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}

const goto = async (screen) => {
  await ev(`SMD_RESEARCH.navigate(${JSON.stringify(screen)}, {});1`);
  await sleep(250);
};

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

  await setViewport(1024, 1366, false);
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.protocol && !!SMD_RESEARCH.screens.search && !!SMD_RESEARCH.screens.rob && !!SMD_RESEARCH.screens.checklist && !!SMD_RESEARCH.screens.studies', 30000), 'app loaded with Protocol, Search, RoB, Checklist and Studies screens');

  // Mark the seed project server-backed so the server screens mount (practice gate skips it).
  // Clear first. This harness used to share port 9110 with the master-chart runner, so a
  // leftover profile can hold "My thesis analysis" as projects[0] and hide the seeded studies.
  // Re-init the store so the in-memory state picks up the change (getActiveProject reads memory).
  await ev(`(function(){try{localStorage.removeItem('smd_research_state_v1');}catch(e){}SMD_RESEARCH.store.init();var s=JSON.parse(localStorage.getItem('smd_research_state_v1'));s.projects[0].serverId=s.projects[0].id;s.projects[0].practice=false;localStorage.setItem('smd_research_state_v1',JSON.stringify(s));SMD_RESEARCH.store.init();return 1})()`);
  // Pin the Display setting to default density with autoFit off so home.js does not
  // re-zoom <html> on resize during the viewport sweep (layout assertions use 1:1 pixels).
  await ev(`(function(){try{var d=JSON.parse(localStorage.getItem('smd_display_v1')||'{}');d.autoFit=false;d.density='default';d.fontScale=1;localStorage.setItem('smd_display_v1',JSON.stringify(d));}catch(e){}document.documentElement.style.zoom='1';return 1})()`);
  // open() injects the rmdCss stylesheet (navigate alone does not), matching the real app boot.
  // Boot on projects so no protocol load is stranded on a detached body when we navigate below.
  await ev(`SMD_RESEARCH.open({screen:'projects'});1`);

  // ---- iPad portrait 1024x1366 ----
  await goto('protocol');
  ok(await until(`!!document.querySelector('[data-rmd="proto-create"]')`, 5000), 'iPad: protocol empty state mounts');
  await click('[data-rmd="proto-create"]');
  ok(await until(`!!document.querySelector('#rmdProtoForm')`, 3000), 'iPad: protocol form opens');
  ok(await widthOf('#rmdScreenBody .rmd-form-card') > 700, 'iPad: protocol form card is wider than 700px');
  ok(await colCount('#rmdProtoForm .rmd-form-row') === 2, 'iPad: protocol short fields use two columns');
  ok(await hasAiBar('#rmdProtoForm'), 'iPad: Protocol offers Ask MaiK to draft it + Do it myself');
  ok(await noOverflow(), 'iPad: no horizontal scroll on Protocol');
  await shot('ipad-1024-protocol');

  // Ask MaiK fills the same form fields and marks them drafted (nothing saved).
  await click('#rmdProtoForm [data-rmd-ai="ask"]');
  ok(await until(`document.querySelector('#rmd_proto_pop') && /Infants and children/.test(document.querySelector('#rmd_proto_pop').value)`, 5000), 'iPad: Ask MaiK fills the protocol population field');
  ok(await until(`!!document.querySelector('#rmdProtoForm [data-rmd-ai-note="population"]')`, 3000), 'iPad: drafted field is marked Drafted by MaiK, check it');
  ok(/Drafted by MaiK, check it/.test(await text('#rmdProtoForm')), 'iPad: drafted note copy present');
  ok(draftCalls >= 1, 'iPad: ai-draft route was called');

  await goto('studies');
  ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 5000), 'iPad: studies workspace mounts');
  ok(await widthOf('.rmd-studies-screen .rmd-detail-card') > 700, 'iPad: study detail card is wider than 700px');
  ok(await noOverflow(), 'iPad: no horizontal scroll on Studies');
  await click('.rmd-detail-card [data-rmd-edit]');
  ok(await until(`!!document.querySelector('#rmdStudyForm')`, 3000), 'iPad: study edit form opens');
  ok(await colCount('#rmdStudyForm .rmd-form-row') === 2, 'iPad: study form short fields use two columns');
  await shot('ipad-1024-studies');

  await goto('search');
  ok(await until(`!!document.querySelector('.rmd-p2-screen')`, 5000), 'iPad: search screen mounts');
  ok(await hasAiBar('.rmd-p2-screen'), 'iPad: Search offers Ask MaiK to draft it + Do it myself');
  ok(await noOverflow(), 'iPad: no horizontal scroll on Search');

  await goto('rob');
  ok(await until(`!!document.querySelector('.rmd-rob-form')`, 5000), 'iPad: risk of bias assess pane mounts');
  ok(await hasAiBar('.rmd-rob-form'), 'iPad: Risk of Bias offers Ask MaiK to draft it + Do it myself');
  ok(await noOverflow(), 'iPad: no horizontal scroll on Risk of Bias');

  await goto('checklist');
  ok(await until(`!!document.querySelector('.rmd-ai-bar')`, 6000), 'iPad: checklist MaiK bar mounts');
  ok(await hasAiBar('#rmdScreenBody'), 'iPad: Checklist offers Ask MaiK to draft it + Do it myself');
  ok(await noOverflow(), 'iPad: no horizontal scroll on Checklist');
  await shot('ipad-1024-checklist');

  // ---- iPhone 390x844 ----
  await setViewport(390, 844, true);
  await goto('protocol');
  ok(await until(`!!document.querySelector('#rmdProtoForm')`, 5000), 'phone: protocol form still open');
  ok(await colCount('#rmdProtoForm .rmd-form-row') === 1, 'phone: protocol short fields collapse to one column');
  ok(await hasAiBar('#rmdProtoForm'), 'phone: Protocol offers Ask MaiK to draft it + Do it myself');
  ok(await noOverflow(), 'phone: no horizontal scroll on Protocol');
  const bannerH = await ev(`(()=>{const b=document.querySelector('#rmdStepBanner');if(!b)return 999;return Math.round(b.getBoundingClientRect().height)})()`);
  ok(bannerH <= 64, `phone: step banner is <=64px tall (got ${bannerH}px)`);
  ok(await ev(`!!document.querySelector('#rmdStepBanner [data-rmd-action="help-next"]')`), 'phone: banner offers a Next step button');
  ok(await ev(`!!document.querySelector('#rmdStepBanner [data-rmd-step-how]')`), 'phone: banner offers a How? link');
  await shot('phone-390-protocol');

  await goto('studies');
  ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 5000), 'phone: studies workspace mounts');
  ok(await noOverflow(), 'phone: no horizontal scroll on Studies');
  await shot('phone-390-studies');

  await goto('search');
  ok(await until(`!!document.querySelector('.rmd-p2-screen')`, 5000), 'phone: search screen mounts');
  ok(await hasAiBar('.rmd-p2-screen'), 'phone: Search offers Ask MaiK to draft it + Do it myself');
  ok(await noOverflow(), 'phone: no horizontal scroll on Search');

  await goto('rob');
  ok(await until(`!!document.querySelector('.rmd-rob-form')`, 5000), 'phone: risk of bias assess pane mounts');
  ok(await hasAiBar('.rmd-rob-form'), 'phone: Risk of Bias offers Ask MaiK to draft it + Do it myself');
  ok(await noOverflow(), 'phone: no horizontal scroll on Risk of Bias');

  await goto('checklist');
  ok(await until(`!!document.querySelector('.rmd-ai-bar')`, 6000), 'phone: checklist MaiK bar mounts');
  ok(await hasAiBar('#rmdScreenBody'), 'phone: Checklist offers Ask MaiK to draft it + Do it myself');
  ok(await noOverflow(), 'phone: no horizontal scroll on Checklist');

  // ---- Sweep the other two required viewports for overflow + MaiK bar ----
  for (const [w, h, label] of [[1366, 1024, 'iPad landscape 1366x1024'], [820, 1180, 'iPad mini 820x1180']]) {
    await setViewport(w, h, false);
    await goto('protocol');
    ok(await until(`!!document.querySelector('#rmdProtoForm')`, 5000), `${label}: protocol form mounts`);
    ok(await widthOf('#rmdScreenBody .rmd-form-card') > 700, `${label}: protocol form card wider than 700px`);
    ok(await colCount('#rmdProtoForm .rmd-form-row') === 2, `${label}: two-column short fields`);
    ok(await noOverflow(), `${label}: no horizontal scroll on Protocol`);
    await goto('studies');
    ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 5000), `${label}: studies workspace mounts`);
    ok(await noOverflow(), `${label}: no horizontal scroll on Studies`);
    await shot(`sweep-${w}x${h}`);
  }

  // No em/en dashes anywhere in the overlay.
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');

  console.log(failures === 0 ? '\nALL IPAD UI CHECKS PASSED' : `\n${failures} IPAD UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
