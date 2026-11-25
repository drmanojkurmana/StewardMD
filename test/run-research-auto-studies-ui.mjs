// Real-browser headless test: ResearchMD "Find and add studies" sheet.
// Covers the primary Find button + secondary Add manually, the outcome
// question, search results (badge, abstract expand, select all), the live
// per-study progress wording (parser / cache / needs_pdf), the added-study
// cards (numbers, highlighted quote, DOI, Numbers match, Fix), the PDF upload
// affordance, the local-project gate, and the guided studies help text.
// Responsive + no em/en dash checks at 375 px.
//   node test/run-research-auto-studies-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9109, CDP = 9509, OUT = '/tmp/stewardmd-research-auto-studies';
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
const findCalls = [];
const autoCalls = [];
const patchCalls = [];
const pdfCalls = [];
const jobCalls = [];

const PAPERS = [
  {
    pmid: '111', doi: '10.1234/a', title: 'BCG and tuberculosis, trial one',
    authors: ['Aronson JD', 'Palmer CE'], year: 1948, journal: 'Am Rev Tuberc',
    abstract: 'Tuberculosis occurred in 4/123 vs 11/139 participants over ten years of follow-up.',
    freeFullText: false, source: 'pubmed'
  },
  {
    pmid: '222', doi: '10.1234/b', title: 'BCG and tuberculosis, trial two',
    authors: ['Comstock GW'], year: 1974, journal: 'Am J Epidemiol',
    abstract: 'Tuberculosis occurred in 12/1000 vs 24/1000 participants in the placebo arm.',
    freeFullText: true, source: 'europepmc'
  },
  {
    pmid: '333', doi: '10.1234/c', title: 'BCG and tuberculosis, trial three',
    authors: ['Ferguson RG', 'Simes AB'], year: 1949, journal: 'Can J Public Health',
    abstract: 'The effect estimate is reported only in the full text of this paper.',
    freeFullText: false, source: 'pubmed'
  }
];

function filledStudy(pid, id, label, inputs, quote) {
  return {
    id, projectId: pid, label, measure: 'RR', inputs,
    locator: { kind: 'manual', citation: label, section: 'Abstract', quote },
    quote, verified: false, version: 1
  };
}

function autoResult(pid, pmid) {
  if (pmid === '111') {
    const quote = 'Tuberculosis occurred in 4/123 vs 11/139 participants over ten years of follow-up.';
    const inputs = { events1: 4, n1: 123, events2: 11, n2: 139 };
    return {
      status: 'filled', study: filledStudy(pid, 'st_auto_1', 'Aronson 1948', inputs, quote),
      fields: inputs, quote, location: 'Abstract', method: 'parser'
    };
  }
  if (pmid === '222') {
    const quote = 'Tuberculosis occurred in 12/1000 vs 24/1000 participants in the placebo arm.';
    const inputs = { events1: 12, n1: 1000, events2: 24, n2: 1000 };
    return {
      status: 'filled', study: filledStudy(pid, 'st_auto_2', 'Comstock 1974', inputs, quote),
      fields: inputs, quote, location: 'Abstract', method: 'cache'
    };
  }
  return { status: 'needs_pdf', study: null, fields: null, quote: '', location: '', method: null };
}

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
        projN++;
        return send(201, {
          project: {
            id: 'prj_auto_' + projN, title: b.title || 'Untitled project',
            discipline: b.discipline || 'medicine', specialty: b.specialty || '',
            studyType: b.studyType || '', role: 'owner', createdAt: Date.now()
          },
          requestId: 'req_auto'
        });
      }
      const projMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)(\/.*)?$/);
      if (projMatch) {
        const pid = projMatch[1];
        const sub = projMatch[2] || '';
        if (sub === '/protocols' && req.method === 'GET') return send(200, { protocols: [] });
        if (sub === '/find-studies' && req.method === 'POST') {
          findCalls.push(b);
          if (b.q === 'none') return send(200, { results: [] });
          return send(200, { results: PAPERS, requestId: 'req_find' });
        }
        if (sub === '/studies/auto-add' && req.method === 'POST') {
          autoCalls.push(b);
          const pmid = (b.items && b.items[0] && b.items[0].pmid) || '';
          // Small delay so the live progress wording is observable in the DOM.
          return setTimeout(() => send(200, { results: [autoResult(pid, pmid)], requestId: 'req_add' }), 250);
        }
        if (sub === '/pdfs' && req.method === 'POST') {
          pdfCalls.push(b);
          return send(201, { pdf: { id: 'pdf_1', projectId: pid } });
        }
        if (sub === '/jobs' && req.method === 'POST') {
          jobCalls.push(b);
          return send(202, { job: { id: 'job_1', kind: b.kind, status: 'queued' } });
        }
        const studyMatch = sub.match(/^\/studies\/([^/]+)$/);
        if (studyMatch && req.method === 'PATCH') {
          patchCalls.push({ id: studyMatch[1], body: b });
          return send(200, { study: { id: studyMatch[1], projectId: pid, verified: true, version: (b.version || 1) + 1 } });
        }
        if (sub === '/studies' && req.method === 'POST') {
          return send(201, { study: { id: 'st_manual_1', projectId: pid, label: b.label || '', measure: b.measure, inputs: b.inputs, verified: false, version: 1 } });
        }
      }
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
  `--user-data-dir=/tmp/rmd-auto-chrome-${process.pid}`,
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
  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH.find', 30000), 'app loaded with ResearchMD and the find sheet');

  // 1. Create a server-backed project so the find sheet is unlocked.
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('.rmd-start-screen')`, 5000), 'start screen rendered');
  await click('[data-rmd-start-choice="sr"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='Auto add review';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_auto_1'`, 5000), 'project created on the server');
  ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 5000), 'lands on the studies workspace');

  // 2. Primary Find button, secondary Add manually, guided help text.
  ok(await ev(`!!document.querySelector('.rmd-topbar-actions [data-rmd="find-studies"]')`), 'Find and add studies is a primary topbar action');
  ok(/Find and add studies/.test(await text('.rmd-topbar-actions [data-rmd="find-studies"]')), 'primary button reads Find and add studies');
  ok(await ev(`!!document.querySelector('.rmd-topbar-actions [data-rmd="add-study"]')`), 'Add manually is offered as the secondary action');
  ok(/Add manually/.test(await text('.rmd-topbar-actions [data-rmd="add-study"]')), 'secondary button reads Add manually');
  // The step banner keeps its tip collapsed behind How?; expand it to read the guided help.
  await click('[data-rmd-step-how]');
  ok(/Search for papers, tick the ones that fit/.test(await text('#researchMD')), 'guided studies help explains search, tick, fill, check');

  // 3. Open the sheet: outcome question + search box, Add disabled at first.
  await click('.rmd-topbar-actions [data-rmd="find-studies"]');
  ok(await until(`!!document.querySelector('#rmdFindSheet')`, 3000), 'find sheet opens');
  ok(/Find and add studies/.test(await text('.rmd-find-head')), 'sheet heading reads Find and add studies');
  ok(/What result are you combining\?/.test(await text('#rmdFindSheet')), 'sheet asks what result you are combining');
  ok(await ev(`!!document.getElementById('rmd_find_query')`), 'search box present');
  ok(/No tokens used to search/.test(await text('#rmdFindSheet')), 'search hint says no tokens are used to search');
  ok(await ev(`document.querySelector('[data-find="add"]').disabled === true`), 'Add button disabled before selecting papers');
  ok(/Add 0 studies/.test(await text('[data-find="add"]')), 'footer reads Add 0 studies initially');
  await shot('phone-375-find-search');

  // 4. Search returns merged results with badge, abstract preview, select all.
  await ev(`(()=>{document.getElementById('rmd_find_query').value='BCG tuberculosis randomised trial';return true})()`);
  await click('[data-find="search"]');
  ok(await until(`document.querySelectorAll('.rmd-find-result').length === 3`, 5000), 'three papers render after search');
  ok(findCalls.length === 1 && findCalls[0].q === 'BCG tuberculosis randomised trial', 'search sent the typed query to find-studies');
  ok(/3 papers found/.test(await text('#rmdFindSheet')), 'result count shown');
  ok(await ev(`!!document.querySelector('[data-find="select-all"]')`), 'Select all offered');
  ok(await ev(`document.querySelectorAll('.rmd-find-badge').length === 1`), 'Free full text badge on the open-access paper');
  ok(/Free full text/.test(await text('.rmd-find-badge')), 'badge reads Free full text');
  ok(await ev(`!!document.querySelector('.rmd-find-abstract.clamp')`), 'abstract preview is clamped to two lines');
  ok(await ev(`!!document.querySelector('[data-find-expand]')`), 'abstract has a More expand control');

  // 5. Expand an abstract preview.
  await click('[data-find-expand]');
  ok(await until(`(()=>{const r=document.querySelector('.rmd-find-result');return !!r && !r.querySelector('.rmd-find-abstract.clamp')})()`, 3000), 'tapping More expands the abstract');
  ok(/Less/.test(await text('[data-find-expand]')), 'expand control flips to Less');

  // 6. Set the outcome, select all, footer enables.
  await ev(`(()=>{const i=document.getElementById('rmd_find_outcome');i.value='confirmed tuberculosis';i.oninput();return true})()`);
  await click('[data-find="select-all"]');
  ok(await until(`document.querySelectorAll('.rmd-find-check:checked').length === 3`, 3000), 'Select all ticks every paper');
  ok(/Clear all/.test(await text('[data-find="select-all"]')), 'Select all flips to Clear all');
  ok(/Add 3 studies/.test(await text('[data-find="add"]')), 'footer reads Add 3 studies');
  ok(await ev(`document.querySelector('[data-find="add"]').disabled === false`), 'Add button enabled with outcome and selection');
  await shot('phone-375-find-selected');

  // 7. Add: live progress wording for parser, cache and needs_pdf.
  await click('[data-find="add"]');
  ok(await until(`/Filling in the numbers/.test(document.querySelector('#rmdFindSheet').innerText)`, 3000), 'adding phase shows Filling in the numbers');
  ok(await until(`/Reading abstract/.test(document.querySelector('#rmdFindSheet').innerText)`, 3000), 'progress shows Reading abstract');
  ok(await until(`/Found the numbers/.test(document.querySelector('#rmdFindSheet').innerText)`, 6000), 'parser progress shows Found the numbers');
  ok(await until(`/Already known, added instantly/.test(document.querySelector('#rmdFindSheet').innerText)`, 6000), 'cache progress shows Already known, added instantly');
  ok(await until(`/Added 2 of 3 studies/.test(document.querySelector('#rmdFindSheet').innerText)`, 8000), 'done summary reads Added 2 of 3 studies');
  ok(autoCalls.length === 3, 'one auto-add call per selected study');
  ok(/Check each one matches the paper, then tap Numbers match/.test(await text('#rmdFindSheet')), 'done summary tells the user to check each study');

  // 8. Added-study cards: numbers, highlighted quote, DOI, verify + fix.
  ok(await ev(`document.querySelectorAll('.rmd-find-card').length === 2`), 'two filled study cards render');
  ok(/Risk ratio \(RR\): 4\/123 vs 11\/139/.test(await text('.rmd-find-card')), 'card shows the risk ratio counts in standard form');
  ok(/outcome events out of each group/.test(await text('.rmd-find-card')), 'counts carry a plain meaning gloss');
  ok(await ev(`document.querySelectorAll('.rmd-find-card .rmd-find-num').length > 0`), 'numbers in the source quote are highlighted');
  ok(await ev(`!!document.querySelector('.rmd-find-card .rmd-find-doi')`), 'card links the DOI');
  ok(await ev(`(document.querySelector('.rmd-find-doi').href||'').indexOf('doi.org') >= 0`), 'DOI link points at doi.org');
  ok(await ev(`!!document.querySelector('[data-find-verify]')`), 'Numbers match one-tap verify offered');
  ok(/Numbers match/.test(await text('[data-find-verify]')), 'verify button reads Numbers match');
  ok(await ev(`!!document.querySelector('[data-find-fix]')`), 'Fix offered on each card');
  ok(await until(`SMD_RESEARCH.store.getStudies().length === 2`, 3000), 'both filled studies adopted into the local store');
  ok(await ev(`SMD_RESEARCH.store.getStudy('st_auto_1').verified === false`), 'adopted study starts unverified (never verified server-side)');

  // 9. needs_pdf row offers Upload PDF.
  ok(/Need the PDF to find the numbers/.test(await text('#rmdFindSheet')), 'needs_pdf progress reads Need the PDF to find the numbers');
  ok(await ev(`!!document.querySelector('[data-find-upload]')`), 'Upload PDF button offered for the needs_pdf study');
  ok(await ev(`!!document.querySelector('[data-find-file][accept="application/pdf"]')`), 'a PDF file input is wired behind Upload PDF');
  await shot('phone-375-find-done');

  // 10. One-tap verify marks the study verified locally.
  await click('[data-find-verify="0"]');
  ok(await until(`SMD_RESEARCH.store.getStudy('st_auto_1').verified === true`, 3000), 'Numbers match verifies the study');
  ok(await until(`!!document.querySelector('.rmd-find-verified')`, 3000), 'Verified badge appears on the card');

  // 11. Upload PDF sends the file and queues extraction.
  const uploaded = await ev(`(()=>{
    const input=document.querySelector('[data-find-file="2"]');
    if(!input) return 'noinput';
    const f=new File(['%PDF-1.4 fake'], 'paper.pdf', {type:'application/pdf'});
    const dt=new DataTransfer(); dt.items.add(f); input.files=dt.files;
    input.onchange();
    return 'ok';
  })()`);
  ok(uploaded === 'ok', 'PDF file input accepts a selected file');
  ok(await until(`/PDF sent for reading/.test(document.querySelector('#rmdFindSheet').innerText)`, 5000), 'upload confirms the PDF was sent for reading');
  ok(pdfCalls.length === 1 && jobCalls.length === 1, 'upload posted the PDF and queued a pdf_extract job');
  ok(jobCalls[0] && jobCalls[0].kind === 'pdf_extract', 'queued job kind is pdf_extract');

  // 12. No em/en dashes and no horizontal overflow with the sheet open.
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');
  ok(await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal overflow at 375px');

  // 13. Fix opens the prefilled manual form and closes the sheet.
  await click('[data-find-fix="1"]');
  ok(await until(`!document.getElementById('rmdFindSheet')`, 3000), 'Fix closes the find sheet');
  ok(await until(`!!document.getElementById('rmd_st_label')`, 3000), 'Fix opens the manual study form');
  ok(await ev(`document.getElementById('rmd_st_id').value === 'st_auto_2'`), 'form is prefilled with the chosen study id');
  ok(await ev(`document.getElementById('rmd_st_label').value === 'Comstock 1974'`), 'form label prefilled from the adopted study');
  await shot('phone-375-find-fix');

  // 14. Local (practice) project gate: save to account first.
  await resetToSeed();
  await ev(`SMD_RESEARCH.find.open();1`);
  ok(await until(`!!document.querySelector('#rmdFindSheet')`, 3000), 'find sheet opens on the practice project');
  ok(/Save this project to your account first/.test(await text('#rmdFindSheet')), 'local project is told to save to the account first');
  ok(await ev(`!!document.querySelector('[data-find="to-projects"]')`), 'a Back to projects action is offered');
  await shot('phone-375-find-local');

  console.log(failures === 0 ? '\nALL AUTO-STUDIES UI CHECKS PASSED' : `\n${failures} AUTO-STUDIES UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
