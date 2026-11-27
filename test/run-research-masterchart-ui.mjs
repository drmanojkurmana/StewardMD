// Real-browser headless test: ResearchMD "Analyse my thesis data (master chart)".
// Covers the start choice, on-device sample thesis, identifier check (Name and
// Mobile left out), column type chips, Compare groups / Table 1 / logistic
// results with plain-language glosses, Use in my manuscript (append, never
// overwrite), the feedback sheet, and the privacy guarantee that no request
// body ever carries a patient row. Viewports 390x844 and 1024x1366.
//   node test/run-research-masterchart-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9110, CDP = 9510, OUT = '/tmp/stewardmd-research-masterchart';
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
            id: 'prj_mc_' + projN, title: b.title || 'Untitled project',
            discipline: b.discipline || 'medicine', specialty: b.specialty || '',
            studyType: b.studyType || '', role: 'owner', createdAt: Date.now()
          },
          requestId: 'req_mc'
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
  `--user-data-dir=/tmp/rmd-mc-chrome-${process.pid}`,
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
  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH_STATS && !!window.SMD_RESEARCH.screens.masterchart', 30000), 'app loaded with ResearchMD, stats engine and master chart screen');

  // 1. Start choice creates the project and lands on the master chart screen.
  await resetToSeed();
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('[data-rmd-start-choice="masterchart"]')`, 5000), 'start screen offers Analyse my thesis data (master chart)');
  ok(/Upload your Excel master chart/.test(await text('.rmd-start-screen')), 'start choice explains the master chart flow');
  await click('[data-rmd-start-choice="masterchart"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='My thesis analysis';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_mc_1'`, 5000), 'project created on the server');
  ok(await until(`!!document.querySelector('.rmd-mc-screen')`, 5000), 'lands on the master chart upload step');
  ok(/Your master chart stays on this phone\. Nothing is uploaded\./.test(await text('.rmd-mc-screen')), 'privacy line shown on the upload step');
  ok(await ev(`!!document.querySelector('[data-rmd-mc="sample"]')`), 'Try with a sample thesis button present');
  await shot('phone-390-upload');

  // 2. Sample thesis: deterministic synthetic chart, identifiers flagged first.
  await click('[data-rmd-mc="sample"]');
  ok(await until(`!!document.querySelector('.rmd-mc-screen [data-rmd-mc="continue-identifiers"]')`, 5000), 'identifier check is the first step after loading');
  const idText = await text('.rmd-mc-screen');
  ok(/Patient identifiers \(names, phone numbers, hospital numbers\) found in: Name, Mobile\./.test(idText), 'Name and Mobile flagged as identifiers');
  ok(/They are left out of every analysis\./.test(idText), 'identifier banner says they are left out of every analysis');
  ok(/Sample data \(not real patients\)/.test(idText), 'sample badge shown');
  ok(/200 patients, 12 columns/.test(idText), 'sample chart has 200 patients and 12 columns');
  await shot('phone-390-identifiers');

  // 3. Columns screen: type chips, missing counts, identifier cards locked out.
  await click('[data-rmd-mc="continue-identifiers"]');
  ok(await until(`document.querySelectorAll('.rmd-mc-colcard').length === 12`, 5000), 'all 12 columns shown as cards');
  ok(await ev(`document.querySelectorAll('.rmd-mc-missing').length === 12`), 'every column card shows a missing count');
  ok(await ev(`(()=>{const c=document.querySelector('[data-rmd-mc-colcard="Name"]');return !!c && /Left out \\(identifier\\)/.test(c.innerText) && !c.querySelector('[data-rmd-mc-type]')})()`), 'Name card is left out and has no type chips');
  ok(await ev(`!!document.querySelector('[data-rmd-mc-colcard="Mobile"]')`), 'Mobile card present');
  ok(await ev(`(()=>{const b=document.querySelector('[data-rmd-mc-type="numeric"][data-rmd-mc-col="Age"]');return !!b && b.classList.contains('rmd-chip-active')})()`), 'Age guessed as Number');
  await click('[data-rmd-mc-type="categorical"][data-rmd-mc-col="Age"]');
  ok(await ev(`(()=>{const b=document.querySelector('[data-rmd-mc-type="categorical"][data-rmd-mc-col="Age"]');return !!b && b.classList.contains('rmd-chip-active')})()`), 'one tap changes Age to Categories');
  await click('[data-rmd-mc-type="numeric"][data-rmd-mc-col="Age"]');
  ok(await ev(`(()=>{const b=document.querySelector('[data-rmd-mc-type="numeric"][data-rmd-mc-col="Age"]');return !!b && b.classList.contains('rmd-chip-active')})()`), 'Age changed back to Number');
  await shot('phone-390-columns');

  // iPad: two-column grid, 44px chips, no horizontal scroll.
  await viewport(1024, 1366, false);
  await sleep(200);
  ok(await ev(`getComputedStyle(document.querySelector('.rmd-mc-grid')).gridTemplateColumns.split(' ').length === 2`), 'column grid is two columns on iPad');
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), 'no horizontal overflow at 1024px (columns)');
  await shot('ipad-1024-columns');
  await viewport(390, 844, true);
  await sleep(200);

  // 4. Save on this phone: localStorage only, calm confirmation.
  await click('[data-rmd-mc="save-phone"]');
  ok(await until(`/Saved on this phone\\. Nothing was uploaded\\./.test(document.querySelector('.rmd-mc-screen').innerText)`, 3000), 'save confirmation shown');
  ok(await ev(`(()=>{try{const all=JSON.parse(localStorage.getItem('smd_rmd_masterchart_v1')||'{}');const s=all['prj_mc_1'];return !!s && s.rows.length===200 && s.columns.length===12}catch(e){return false}})()`), 'chart saved in localStorage under the project id (200 rows)');

  // 5. Question cards (5 when on-device stats v2 adds Linear regression).
  await click('[data-rmd-mc="continue-columns"]');
  ok(await until(`document.querySelectorAll('[data-rmd-mc-choice]').length === 5`, 5000), 'five analysis questions offered (including linear regression)');
  ok(/Table 1 \(baseline characteristics\)/.test(await text('.rmd-mc-screen')), 'Table 1 question present');
  ok(/Risk factors \(logistic regression\)/.test(await text('.rmd-mc-screen')), 'logistic regression question present');
  ok(/Linear regression \(numeric outcome\)/.test(await text('.rmd-mc-screen')), 'linear regression question present');
  await shot('phone-390-question');

  // 6. Compare groups: HbA1c at 12 weeks by Group.
  await click('[data-rmd-mc-choice="compare"]');
  ok(await until(`!!document.querySelector('#rmdMcGroup')`, 3000), 'compare form shows the group picker');
  ok(await setSelect('#rmdMcGroup', 'Group'), 'group column set to Group');
  ok(await tick('outcomes', 'HbA1c at 12 weeks'), 'HbA1c at 12 weeks ticked as an outcome');
  await click('[data-rmd-mc="run"]');
  ok(await until(`!!document.querySelector('.rmd-mc-result .rmd-mc-test')`, 8000), 'compare result rendered');
  const testLine = await text('.rmd-mc-result .rmd-mc-test');
  ok(/test/i.test(testLine), 'result shows the test label');
  ok(await ev(`(()=>{const w=document.querySelector('.rmd-mc-result .rmd-mc-why');return !!w && (w.innerText||'').length>10})()`), 'result explains why this test was chosen');
  ok(/p [=</]/.test(await text('.rmd-mc-result .rmd-mc-stat')), 'result shows the p value');
  ok(await ev(`!!document.querySelector('.rmd-mc-result .rmd-mc-gloss')`), 'plain-language gloss shown under the numbers');
  ok(await ev(`(()=>{const s=document.querySelector('.rmd-mc-result .rmd-mc-sentence');return !!s && (s.innerText||'').length>20})()`), 'Results sentence built from the computed numbers');
  const cmpTable = await text('.rmd-mc-result .rmd-mc-table');
  ok(/Drug A/.test(cmpTable) && /Drug B/.test(cmpTable), 'per-group summary table shows Drug A and Drug B');
  await shot('phone-390-compare-results');

  // 7. Use in my manuscript appends via the server PUT.
  await click('[data-rmd-mc="use-manuscript"]');
  ok(await until(`/Added to the Results section of your manuscript/.test(document.querySelector('.rmd-mc-screen').innerText)`, 8000), 'use-in-manuscript confirmation shown');
  ok(manuscriptPuts.length === 1 && manuscriptPuts[0].section === 'results', 'one PUT to the manuscript results section');
  ok(/HbA1c/.test(manuscriptPuts[0]?.body?.text || ''), 'appended text carries the compare results');

  // 8. Table 1 with the default variables.
  await click('[data-rmd-mc="ask-another"]');
  ok(await until(`!!document.querySelector('[data-rmd-mc-choice="table1"]')`, 3000), 'back on the question screen');
  await click('[data-rmd-mc-choice="table1"]');
  ok(await until(`!!document.querySelector('#rmdMcGroup')`, 3000), 'Table 1 form shows the group picker');
  ok(await setSelect('#rmdMcGroup', 'Group'), 'Table 1 grouped by Group');
  ok(await ev(`document.querySelectorAll('.rmd-mc-check-input[data-rmd-mc-list="variables"]:checked').length >= 5`), 'baseline variables pre-ticked');
  await click('[data-rmd-mc="run"]');
  ok(await until(`!!document.querySelector('.rmd-mc-table')`, 8000), 'Table 1 rendered');
  const t1 = await text('.rmd-mc-table');
  ok(t1.includes('±'), 'Table 1 shows mean ± sd cells');
  ok(t1.includes('('), 'Table 1 shows n (%) or median (IQR) cells');
  ok(/p [=</]/.test(t1), 'Table 1 shows p values');
  ok(await ev(`!!document.querySelector('[data-rmd-mc="export-docx"]')`), 'Download Table 1 (DOCX) button present');
  ok(await ev(`!!document.querySelector('[data-rmd-mc="export-csv"]')`), 'Download results (CSV) button present');
  await shot('phone-390-table1');
  await click('[data-rmd-mc="use-manuscript"]');
  ok(await until(`/Added to the Results section of your manuscript/.test(document.querySelector('.rmd-mc-screen').innerText)`, 8000), 'Table 1 added to the manuscript');
  ok(manuscriptPuts.length === 2 && /Table 1\. Baseline characteristics/.test(manuscriptPuts[1]?.body?.text || ''), 'second PUT carries the Table 1 text');
  ok(/HbA1c/.test(manuscriptPuts[1]?.body?.text || ''), 'second append keeps the earlier results text (never overwrites)');

  // 9. Logistic regression: Complication by Age, Diabetes, BMI.
  await click('[data-rmd-mc="ask-another"]');
  await click('[data-rmd-mc-choice="logistic"]');
  ok(await until(`!!document.querySelector('#rmdMcOutcome')`, 3000), 'logistic form shows the outcome picker');
  ok(await setSelect('#rmdMcOutcome', 'Complication'), 'outcome set to Complication');
  ok(await tick('predictors', 'Age'), 'Age ticked as a risk factor');
  ok(await tick('predictors', 'Diabetes'), 'Diabetes ticked as a risk factor');
  ok(await tick('predictors', 'BMI'), 'BMI ticked as a risk factor');
  await click('[data-rmd-mc="run"]');
  ok(await until(`!!document.querySelector('.rmd-mc-table')`, 8000), 'logistic results rendered');
  const lgHead = await text('.rmd-mc-screen');
  ok(/OR \(95% CI\)/.test(lgHead), 'logistic table reports OR with 95% CI');
  ok(/n = 200/.test(lgHead), 'logistic reports the analysed n');
  const lgTable = await text('.rmd-mc-table');
  ok(/ to /.test(lgTable) && /\(/.test(lgTable), 'OR cells carry confidence intervals');
  ok(await ev(`document.querySelectorAll('.rmd-mc-gloss').length >= 1`), 'od ratios explained in plain language');
  await shot('phone-390-logistic');

  // 10. Feedback sheet posts to /api/support, never patient data.
  await ev(`(()=>{window.SMD_AUTH={currentUser:{getIdToken:function(){return Promise.resolve('test-token')}}};return 1})()`);
  ok(await ev(`!!document.querySelector('.rmd-footer-feedback[data-rmd-action="feedback"]')`), 'Tell us what went wrong link in the footer');
  await click('[data-rmd-action="feedback"]');
  ok(await until(`!!document.querySelector('#rmdFeedbackModal #rmdFeedbackText')`, 3000), 'feedback sheet opens');
  ok(/do not include patient details/i.test(await text('#rmdFeedbackModal')), 'feedback sheet warns against patient details');
  await ev(`(()=>{document.getElementById('rmdFeedbackText').value='The results table was hard to read on my phone.';return true})()`);
  await click('#rmdFeedbackSend');
  ok(await until(`/Sent\\. We read every message\\./.test(document.getElementById('rmdFeedbackStatus').innerText)`, 8000), 'feedback success message shown');
  ok(supportCalls.length === 1, 'one POST to /api/support');
  ok(supportCalls[0]?.kind === 'feedback' && supportCalls[0]?.action === 'create', 'support payload is a feedback create');
  ok(/^ResearchMD: /.test(supportCalls[0]?.subject || ''), 'subject names the ResearchMD screen');
  ok(supportCalls[0]?.text === 'The results table was hard to read on my phone.', 'support payload carries exactly what was typed');
  ok(!/Patient 0/.test(JSON.stringify(supportCalls[0] || {})), 'feedback carries no patient values');
  await shot('phone-390-feedback');
  await ev(`(()=>{const b=document.querySelector('[data-rmd-feedback-close]');if(b)b.click();return 1})()`);

  // 11. Manuscript screen shows the appended Results text (iPad layout).
  await viewport(1024, 1366, false);
  await click('[data-rmd-mc="open-manuscript"]');
  ok(await until(`!!document.querySelector('.rmd-manuscript-screen')`, 8000), 'manuscript screen opens');
  ok(await until(`!!document.querySelector('[data-section-id="results"]')`, 5000), 'results section listed');
  await click('[data-section-id="results"]');
  ok(await until(`/Table 1\\. Baseline characteristics/.test(document.querySelector('.rmd-manuscript-screen').innerText)`, 5000), 'appended Table 1 text visible in the manuscript');
  ok(await until(`/HbA1c/.test(document.querySelector('.rmd-manuscript-screen').innerText)`, 3000), 'earlier compare results still in the manuscript');
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), 'no horizontal overflow at 1024px (manuscript)');
  await shot('ipad-1024-manuscript');

  // 12. Privacy + responsive + dash + page-error sweeps.
  await viewport(390, 844, true);
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), 'no horizontal overflow at 390px');
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');
  const leaky = allBodies.filter((r) => /Patient 0/.test(r.body));
  ok(leaky.length === 0, `no network request body carries patient rows (${allBodies.length} bodies checked)`);
  ok(pageErrors.length === 0, `zero uncaught page errors (${pageErrors.length})`);
  if (pageErrors.length) console.log(pageErrors.join('\n'));

  console.log(failures === 0 ? '\nALL MASTERCHART UI CHECKS PASSED' : `\n${failures} MASTERCHART UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
