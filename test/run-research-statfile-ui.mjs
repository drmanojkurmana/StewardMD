// Real-browser headless test: SPSS (.sav) and Stata (.dta) upload on the
// ResearchMD master chart screen (research-statfile.js). The file is handed to
// the page's file input exactly as a picked file would be; it is read on the
// device. Checks the upload wording, SPSS value labels written in, SPSS
// missing codes left blank, variable labels under each column name, a Stata
// file, a damaged file, the smd_rmd_statfile kill switch, and that no request
// body ever carries a patient row. Viewport 390x844.
//   node test/run-research-statfile-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9131, CDP = 9531, OUT = '/tmp/stewardmd-research-statfile';
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
let projN = 0;
const supportCalls = [];
const manuscriptPuts = [];
const allBodies = [];
const mans = {};

function baseManuscript(pid) {
  return {
    id: 'man_mc', projectId: pid, version: 2,
    title: 'My master chart study', authors: [], affiliations: '', status: 'draft',
    sections: [
      { id: 'abstract', heading: 'Abstract', level: 1, text: '' },
      { id: 'introduction', heading: 'Introduction', level: 1, text: '' },
      { id: 'methods', heading: 'Methods', level: 1, text: '' },
      { id: 'results', heading: 'Results', level: 1, text: '' },
      { id: 'discussion', heading: 'Discussion', level: 1, text: '' }
    ],
    tokens: {}
  };
}

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
      if (p === '/api/support' && req.method === 'POST') {
        supportCalls.push(b);
        return send(200, { ok: true, ticket: { id: 'sup_' + supportCalls.length } });
      }
      if (p === '/api/research/v1/projects' && req.method === 'POST') {
        projN++;
        return send(201, {
          project: {
            id: 'prj_sf_' + projN, title: b.title || 'Untitled project',
            discipline: b.discipline || 'medicine', specialty: b.specialty || '',
            studyType: b.studyType || '', role: 'owner', createdAt: Date.now()
          },
          requestId: 'req_sf'
        });
      }
      const projMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)(\/.*)?$/);
      if (projMatch) {
        const pid = projMatch[1];
        const sub = projMatch[2] || '';
        if (sub === '/manuscript' && req.method === 'GET') {
          return send(200, { manuscript: mans[pid] || null });
        }
        if (sub === '/manuscript/versions' && req.method === 'GET') return send(200, { versions: [] });
        const secMatch = sub.match(/^\/manuscript\/sections\/([^/]+)$/);
        if (secMatch && req.method === 'PUT') {
          manuscriptPuts.push({ pid, section: secMatch[1], body: b });
          if (!mans[pid]) mans[pid] = baseManuscript(pid);
          const man = mans[pid];
          let sec = man.sections.find((s) => s.id === secMatch[1]);
          if (!sec) { sec = { id: secMatch[1], heading: b.heading || secMatch[1], level: 1, text: '' }; man.sections.push(sec); }
          sec.text = b.text || '';
          sec.heading = b.heading || sec.heading;
          return send(200, { ok: true, version: man.version, tokens: {} });
        }
        if (sub === '/protocols' && req.method === 'GET') return send(200, { protocols: [] });
      }
      return send(404, { error: { code: 'project_not_found' } });
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
  });
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-sf-chrome-${process.pid}`,
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


const pick = (fixture, asName, cut) => ev(`(async()=>{
  const r = await fetch('/test/fixtures/research/statfiles/${fixture}');
  let b = await r.arrayBuffer();
  ${cut ? `b = b.slice(0, ${cut});` : ''}
  const f = new File([b], ${JSON.stringify(asName)}, { type: 'application/octet-stream' });
  const dt = new DataTransfer();
  dt.items.add(f);
  const i = document.querySelector('#rmdMcFile');
  if (!i) return false;
  i.files = dt.files;
  i.dispatchEvent(new Event('change'));
  return true;
})()`);

const colCard = (name) => text(`[data-rmd-mc-colcard="${name}"]`);

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
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable');

  await viewport(390, 844, true);
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH_STATFILE && !!window.SMD_RESEARCH.screens.masterchart', 30000), 'app loaded with ResearchMD, the SPSS/Stata reader and the master chart screen');

  await resetToSeed();
  await ev(`localStorage.removeItem('smd_rmd_statfile');1`);
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('[data-rmd-start-choice="masterchart"]')`, 5000), 'start screen offers the master chart');
  await click('[data-rmd-start-choice="masterchart"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='SPSS thesis';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`!!document.querySelector('#rmdMcFile')`, 5000), 'lands on the master chart upload step');

  // 1. Upload wording and file picker accept list.
  const upText = await text('.rmd-mc-screen');
  ok(/\.sav or \.dta/.test(upText), 'upload button names .sav and .dta');
  ok(/SPSS \(\.sav\) and Stata \(\.dta\) files are read on this phone\. Nothing is uploaded\./.test(upText), 'upload step says SPSS and Stata are read on the phone');
  const accept = await ev(`document.querySelector('#rmdMcFile').getAttribute('accept')`);
  ok(/\.sav/.test(accept) && /\.zsav/.test(accept) && /\.dta/.test(accept), 'file picker accepts .sav, .zsav and .dta');
  await shot('phone-390-upload');

  // 2. SPSS file (bytecode compressed).
  ok(await pick('rs_bytecode.sav', 'thesis data.sav'), 'SPSS file handed to the file input');
  ok(await until(`!!document.querySelector('.rmd-mc-screen [data-rmd-mc="continue-identifiers"]')`, 8000), 'SPSS file opens on the identifier check');
  const idText = await text('.rmd-mc-screen');
  ok(/6 patients, 9 columns in thesis data\.sav/.test(idText), 'rows and columns counted from the SPSS file');
  ok(/Read on this phone from the SPSS file\. Nothing was uploaded\./.test(idText), 'notice says the SPSS file was read on the phone');
  ok(/Value labels written in for 2 columns/.test(idText), 'notice counts columns with value labels written in');
  ok(/4 values were marked as missing in SPSS and are left blank/.test(idText), 'notice counts SPSS missing codes left blank');
  await shot('phone-390-sav-identifiers');
  await click('[data-rmd-mc="continue-identifiers"]');
  ok(await until(`!!document.querySelector('[data-rmd-mc-colcard="age_years"]')`, 5000), 'column cards shown');
  ok(/Age \(years\)/.test(await colCard('age_years')), 'SPSS variable label shown under age_years');
  ok(/Sex of participant/.test(await colCard('sex')), 'SPSS variable label shown under sex');
  ok(/2 missing/.test(await colCard('sex')), 'sex: code 9 and system missing both counted as missing');
  ok(/1 missing/.test(await colCard('age_years')), 'age_years: 999 (in the 900 to 999 missing range) counted as missing');
  await shot('phone-390-sav-columns');

  // 3. Stata file.
  await click('[data-rmd-mc="back-upload"]');
  ok(await until(`!!document.querySelector('#rmdMcFile')`, 3000), 'back on the upload step');
  ok(await pick('pd_118.dta', 'trial.dta'), 'Stata file handed to the file input');
  ok(await until(`!!document.querySelector('.rmd-mc-screen [data-rmd-mc="continue-identifiers"]')`, 8000), 'Stata file opens on the identifier check');
  const dtaText = await text('.rmd-mc-screen');
  ok(/5 patients, 9 columns in trial\.dta/.test(dtaText), 'rows and columns counted from the Stata file');
  ok(/Read on this phone from the Stata file/.test(dtaText), 'notice names Stata');
  await click('[data-rmd-mc="continue-identifiers"]');
  ok(await until(`!!document.querySelector('[data-rmd-mc-colcard="arm"]')`, 5000), 'Stata column cards shown');
  ok(/Study arm/.test(await colCard('arm')), 'Stata variable label shown under arm');

  // 4. Damaged file: calm error, still on the upload step.
  await click('[data-rmd-mc="back-upload"]');
  await until(`!!document.querySelector('#rmdMcFile')`, 3000);
  ok(await pick('rs_plain.sav', 'cut.sav', 400), 'cut-short SPSS file handed to the file input');
  ok(await until(`/ends early/.test((document.querySelector('.rmd-mc-screen [role="alert"]')||{}).textContent||'')`, 5000), 'damaged file shows a plain error');
  ok(/save it as CSV/.test(await text('.rmd-mc-screen [role="alert"]')), 'error suggests saving as CSV');
  ok(await ev(`!!document.querySelector('#rmdMcFile')`), 'still on the upload step after the error');

  // 5. Kill switch.
  await ev(`localStorage.setItem('smd_rmd_statfile','0');1`);
  await click('[data-rmd-mc="sample"]');
  await until(`!!document.querySelector('[data-rmd-mc="back-upload"]')`, 3000);
  await click('[data-rmd-mc="back-upload"]');
  ok(await until(`!!document.querySelector('#rmdMcFile')`, 3000), 'upload step redrawn');
  ok(/\(\.csv or \.xlsx\)/.test(await text('.rmd-mc-screen')), 'with smd_rmd_statfile = 0 the upload offers CSV and Excel only');
  ok(!/\.sav/.test(await ev(`document.querySelector('#rmdMcFile').getAttribute('accept')`)), 'with the kill switch the picker no longer accepts .sav');
  await ev(`localStorage.removeItem('smd_rmd_statfile');1`);

  // 6. Privacy, layout, dashes, page errors.
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), 'no horizontal overflow at 390px');
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');
  const leaky = allBodies.filter((r) => /Cardiology|lait spots|Visakhapatnam|first visit/.test(r.body));
  ok(leaky.length === 0, `no network request body carries rows from the SPSS or Stata file (${allBodies.length} bodies checked)`);
  ok(pageErrors.length === 0, `zero uncaught page errors (${pageErrors.length})`);
  if (pageErrors.length) console.log(pageErrors.join('\n'));

  console.log(failures === 0 ? '\nALL STATFILE UI CHECKS PASSED' : `\n${failures} STATFILE UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
