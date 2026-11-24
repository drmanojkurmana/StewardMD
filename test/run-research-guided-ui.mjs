// Real-browser headless test: ResearchMD guided mode + friendly errors.
// Covers the "What do you want to publish?" start flow (server-first create),
// the journey step banner, the practice-project gate, the friendly 404 card
// (no raw HTTP/Code in view), the sign-in card, save-to-account copy, and the
// enlarged brand header. Responsive + no em/en dash checks at 375 px.
//   node test/run-research-guided-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9108, CDP = 9508, OUT = '/tmp/stewardmd-research-guided';
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

// Server-side records so we can assert what the client actually sent.
let projN = 0, studyN = 0;
const createdProjects = [];
const createdStudies = [];

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
      if (p === '/api/research/v1/projects' && req.method === 'POST') {
        if (b.title === 'UNAUTH') return send(401, { error: { code: 'unauthorized' } });
        projN++;
        const project = {
          id: 'prj_guided_' + projN,
          title: b.title || 'Untitled project',
          discipline: b.discipline || 'medicine',
          specialty: b.specialty || '',
          studyType: b.studyType || '',
          role: 'owner',
          createdAt: Date.now()
        };
        createdProjects.push(b);
        return send(201, { project, requestId: 'req_guided' });
      }
      const studyMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/studies$/);
      if (studyMatch && req.method === 'POST') {
        studyN++;
        createdStudies.push(b);
        return send(201, {
          study: {
            id: 'st_srv_' + studyN,
            projectId: studyMatch[1],
            label: b.label || '',
            measure: b.measure,
            inputs: b.inputs,
            locator: b.locator,
            quote: b.quote || '',
            verified: false,
            version: 1
          }
        });
      }
      // Every other research route (e.g. GET protocols) is a friendly 404.
      return send(404, { error: { code: 'project_not_found' } });
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
  `--user-data-dir=/tmp/rmd-guided-chrome-${process.pid}`,
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
const html = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerHTML||''})()`);

async function shot(name) {
  await sleep(150);
  await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`);
  await mkdir(OUT, { recursive: true });
  const r = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}

const resetToSeed = () => ev(`(()=>{
  localStorage.removeItem('smd_research_state_v1');
  localStorage.removeItem('smd_rmd_help');
  localStorage.removeItem('smd_rmd_seen');
  SMD_RESEARCH.store.init();
  return 1;
})()`);

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

  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH_ENGINE', 30000), 'app loaded with ResearchMD and stats engine');

  // 1. Start screen: four plain choices.
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('.rmd-start-screen')`, 5000), 'start screen rendered');
  ok(/What do you want to publish\?/.test(await text('.rmd-start-screen')), 'start screen asks what to publish');
  ok(await ev(`document.querySelectorAll('[data-rmd-start-choice]').length === 5`), 'five publication choices offered');
  ok(/Combine many studies into one answer/.test(await text('.rmd-start-screen')), 'systematic review choice present');
  ok(/Write up an interesting patient/.test(await text('.rmd-start-screen')), 'case report choice present');
  await shot('phone-375-start');

  // 2. Pick the review choice, name it, create on the server first.
  await click('[data-rmd-start-choice="sr"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears after a choice');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='My guided review';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_guided_1'`, 5000), 'project created on the server and stored with the server id');
  ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 5000), 'lands on the studies workspace (step 1)');
  ok(createdProjects.length === 1 && createdProjects[0].studyType === 'Systematic Review & Meta-Analysis', 'create payload carries the right study template');
  ok(createdProjects[0].title === 'My guided review', 'create payload carries the chosen title');

  // 3. Journey step banner.
  ok(await until(`!!document.querySelector('#rmdStepBanner')`, 3000), 'journey step banner present');
  ok(/Step 1 of 15/.test(await text('#rmdStepBanner')), 'banner reads Step 1 of 15 for a review');
  ok(await ev(`!!document.querySelector('[data-rmd-action="toggle-more"]')`), 'advanced tools hidden behind More');
  ok(await ev(`!document.querySelector('[data-rmd-tab="ipd"]')`), 'IPD tab not shown until More is opened');
  await shot('phone-375-studies-step1');

  // 4. Friendly 404 on a server screen: no raw HTTP/Code in view.
  await ev(`SMD_RESEARCH.navigate('protocol', {});1`);
  ok(await until(`/We could not open this project on your account/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), '404 shows the friendly project card');
  const bodyText = await text('#rmdScreenBody');
  ok(!/HTTP/.test(bodyText) && !/Code:/.test(bodyText), 'no raw HTTP status or code visible to the user');
  ok(/Details for support/.test(await html('#rmdScreenBody')), 'raw code kept only in collapsed support details');
  ok(await ev(`!!document.querySelector('#rmdScreenBody [data-rmd-action="projects"]')`), 'a Back to projects action is offered');
  await shot('phone-375-friendly-404');

  // 5. Practice project gate on a server screen, offline studies still work.
  await resetToSeed();
  await ev(`SMD_RESEARCH.open({screen:'protocol'});1`);
  ok(await until(`!!document.querySelector('.rmd-practice-card')`, 5000), 'practice project shows the practice card on Protocol');
  ok(/This is a practice project/.test(await text('.rmd-practice-card')), 'practice card explains it is a practice project');
  ok(await ev(`!!document.querySelector('[data-rmd-action="practice-start"]') && !!document.querySelector('.rmd-practice-card [data-rmd-action="save"]')`), 'practice card offers Start my own project and Make a copy for me');
  await ev(`SMD_RESEARCH.navigate('studies', {});1`);
  ok(await until(`document.querySelectorAll('.rmd-study-row').length === 13`, 5000), 'practice studies still render offline (13 BCG trials)');
  ok(/Make a copy for me/.test(await text('#rmdHelpWrap')), 'studies screen offers to copy the practice project');
  await shot('phone-375-practice-studies');

  // 6. Brand header enlarged.
  await ev(`SMD_RESEARCH.open({screen:'projects'});1`);
  ok(await until(`!!document.querySelector('.rmd-logo')`, 3000), 'brand logo present');
  ok(await ev(`getComputedStyle(document.querySelector('.rmd-logo')).height === '30px'`), 'logo height is 30px (was 24px)');
  ok(await ev(`getComputedStyle(document.querySelector('.rmd-shell-brand strong')).fontSize === '24px'`), 'wordmark font size is 24px (was 19px)');
  await shot('phone-375-brand');

  // 7. Signed-out create shows one friendly sign-in card.
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  await click('[data-rmd-start-choice="case"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'case report naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='UNAUTH';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`/Please sign in to use ResearchMD/.test(document.querySelector('#rmdStartErr').innerText)`, 5000), 'signed-out create shows the sign-in message');
  ok(await ev(`!!document.querySelector('#rmdStartErr [data-rmd-action="signin"]')`), 'sign-in card offers a Sign in action');
  ok(!/HTTP/.test(await text('#rmdStartErr')) && !/Code:/.test(await text('#rmdStartErr')), 'sign-in card hides raw codes');
  await shot('phone-375-signin');

  // 8. Make a copy for me: creates the server project and copies the studies.
  await resetToSeed();
  const studiesBefore = createdStudies.length;
  await ev(`SMD_RESEARCH.open({screen:'studies'});1`);
  ok(await until(`!!document.querySelector('#rmdHelpWrap [data-rmd-action="save"]')`, 5000), 'save action available on practice studies');
  await click('#rmdHelpWrap [data-rmd-action="save"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && !!SMD_RESEARCH.store.getActiveProject().serverId`, 8000), 'practice project saved to the account');
  ok(await until(`SMD_RESEARCH.store.getStudies().length === 13`, 8000), 'all 13 studies copied to the server project');
  ok(createdStudies.length - studiesBefore >= 13, '13 study create calls were sent to the server');
  ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 5000), 'lands back on the studies workspace after saving');
  await shot('phone-375-saved');

  // 9. No em/en dashes in the overlay; no horizontal overflow at 375.
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');
  const overflow = await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
  ok(overflow, 'no horizontal overflow at 375px');

  console.log(failures === 0 ? '\nALL GUIDED UI CHECKS PASSED' : `\n${failures} GUIDED UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
