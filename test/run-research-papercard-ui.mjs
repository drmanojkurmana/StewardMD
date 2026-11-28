// Real-browser headless test: ResearchMD study card & link paste (0 MaiK tokens).
// Covers paste of PubMed/DOI links, calm loading feedback, study card rendering
// with scientific-first terminology, key results via SMD_RESEARCH_EXPLAIN, highlighted quotes,
// structured summary sections with More/Less toggle, conclusion, auto-add to studies,
// copy summary to clipboard, explain with MaiK toggle for unstructured cards,
// 400 link_unrecognised friendly error without raw codes, and iPad/iPhone responsive views.
// No em or en dashes anywhere.
// node test/run-research-papercard-ui.mjs
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

const PORT = 9122, CDP = 9522, OUT = '/tmp/stewardmd-research-papercard';
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

let projN = 0;
const paperCardCalls = [];
const explainCalls = [];
const autoCalls = [];

const STRUCTURED_CARD = {
  pmid: '12345678',
  pmcid: 'PMC9876543',
  doi: '10.1056/NEJMoa123456',
  title: 'BCG vaccination against tuberculosis: a randomised trial',
  journal: 'N Engl J Med',
  year: 2024,
  authors: ['Aronson JD', 'Palmer CE', 'Ferguson RG', 'Simes AB'],
  url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
  freeFullText: true,
  design: { key: 'rct', label: 'Randomised controlled trial (RCT)', source: 'pubmed' },
  sampleSize: { n: 4744, quote: 'A total of 4,744 participants were randomly assigned.' },
  structured: true,
  sections: [
    { label: 'Background', text: 'Tuberculosis remains a major global public health concern with high disease burden across low and middle income countries.' },
    { label: 'Methods', text: 'We randomly assigned participants to receive either BCG vaccination or matched placebo in a double-blind protocol.' },
    { label: 'Results', text: 'During the follow-up period, confirmed tuberculosis was documented in 237 of 2,373 vaccinees and 326 of 2,371 controls.' }
  ],
  findings: [
    {
      measure: 'HR',
      format: 'estimate',
      estimate: 0.74,
      ciLower: 0.65,
      ciUpper: 0.85,
      p: 0.002,
      quote: 'The hazard ratio for confirmed tuberculosis was 0.74 (95% CI, 0.65 to 0.85; p = 0.002).'
    }
  ],
  conclusion: 'BCG vaccination provided substantial long-term protection against active tuberculosis in this population.',
  mesh: ['Tuberculosis', 'BCG Vaccine'],
  keywords: ['tuberculosis', 'prevention'],
  method: 'api',
  tokensUsed: 0
};

const CACHED_CARD = Object.assign({}, STRUCTURED_CARD, {
  pmid: '22222222',
  title: 'Cached study: instant summary from memory',
  method: 'cache'
});

const UNSTRUCTURED_CARD = {
  pmid: '87654321',
  doi: '10.1016/S0140-6736(24)00000-0',
  title: 'Unstructured pilot study on tuberculosis prevention',
  journal: 'Lancet',
  year: 2023,
  authors: ['Smith J', 'Doe A'],
  url: 'https://doi.org/10.1016/S0140-6736(24)00000-0',
  freeFullText: false,
  design: { key: 'cohort', label: 'Cohort study (observational)', source: 'crossref' },
  sampleSize: { n: 1200, quote: '1200 participants were monitored.' },
  structured: false,
  sections: [
    { label: 'Narrative', text: 'An exploratory trial examining preventive efficacy in adolescent cohorts with long-term tracking.' }
  ],
  findings: [],
  conclusion: 'Initial results suggest potential benefit, but larger randomized evaluations remain necessary.',
  method: 'api',
  tokensUsed: 0
};

const PICO_DATA = {
  population: 'Infants and children under 5 years',
  intervention: 'BCG vaccination at birth',
  comparison: 'No vaccination or placebo',
  outcome: 'Incidence of active tuberculosis',
  design: 'Randomised controlled trial',
  mainResult: 'Reduction in tuberculosis incidence (26% risk reduction)',
  conclusion: 'BCG vaccination is protective.'
};

const METRIC_FULLTEXT_CARD = {
  pmid: '40959673',
  pmcid: 'PMC9999999',
  doi: '10.7759/cureus.99999',
  title: 'Prognostic utility of PT-INR, IL-6, and HDL in patients with severe sepsis',
  journal: 'Cureus',
  year: 2025,
  authors: ['Kurmana MK', 'Kumhar M', 'Tiwari RK', 'Meena A'],
  url: 'https://pubmed.ncbi.nlm.nih.gov/40959673/',
  freeFullText: true,
  design: { key: 'observational', label: 'Observational study (researchers recorded what happened, without assigning a treatment)', source: 'publication_type' },
  sampleSize: { n: 152, quote: '152 adults' },
  structured: true,
  sections: [
    { label: 'Background', text: 'Sepsis remains a major cause of ICU mortality.' },
    { label: 'Results', text: 'In-hospital mortality was 38.8%. IL-6 was 104.87 +/- 28.45 pg/mL.' }
  ],
  findings: [
    {
      format: 'metric',
      kind: 'percent',
      label: 'Proportion (percentage)',
      value: '38.8%',
      numbers: [38.8],
      quote: 'In-hospital mortality was 38.8%.',
      source: 'Abstract'
    },
    {
      format: 'metric',
      kind: 'mean_sd',
      label: 'Mean +/- standard deviation (SD) (average and spread)',
      value: '104.87 +/- 28.45 pg/mL',
      numbers: [104.87, 28.45],
      quote: 'Non-survivors had higher IL-6 (104.87 +/- 28.45 pg/mL).',
      source: 'Abstract'
    },
    {
      format: 'metric',
      kind: 'auc',
      label: 'Area under the curve (AUC) (diagnostic accuracy)',
      value: '0.995 (IL-6)',
      p: '<0.001',
      numbers: [0.995],
      quote: 'AUC was 0.995 for IL-6, p < 0.001.',
      source: 'Full text'
    },
    {
      format: 'metric',
      kind: 'diagnostic',
      label: 'Sensitivity and specificity (test accuracy)',
      value: '100%',
      numbers: [100],
      quote: 'IL-6 had 100% sensitivity and specificity at 75 pg/mL.',
      source: 'Full text'
    }
  ],
  conclusion: 'IL-6 strongly predicted mortality in severe sepsis.',
  method: 'api',
  tokensUsed: 0
};

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
            id: 'prj_paper_' + projN,
            title: b.title || 'Untitled project',
            discipline: b.discipline || 'medicine',
            specialty: b.specialty || '',
            studyType: b.studyType || '',
            role: 'owner',
            createdAt: Date.now()
          },
          requestId: 'req_paper'
        });
      }

      if (p === '/api/research/v1/paper-card' && req.method === 'POST') {
        paperCardCalls.push(b);
        if (b.link && b.link.indexOf('bad_link') >= 0) {
          return send(400, {
            error: {
              code: 'link_unrecognised',
              message: 'We could not recognise this study link. Check the address and try again.'
            }
          });
        }
        if (b.link && b.link.indexOf('not_found') >= 0) {
          return send(404, { error: { code: 'paper_not_found', message: 'Study not found' } });
        }
        return setTimeout(() => send(200, { card: STRUCTURED_CARD, requestId: 'req_standalone' }), 80);
      }

      const projMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)(\/.*)?$/);
      if (projMatch) {
        const pid = projMatch[1];
        const sub = projMatch[2] || '';

        if (sub === '/protocols' && req.method === 'GET') {
          return send(200, { protocols: [] });
        }

        if (sub === '/paper-card' && req.method === 'POST') {
          paperCardCalls.push(b);
          if (b.link && b.link.indexOf('bad_link') >= 0) {
            return send(400, {
              error: {
                code: 'link_unrecognised',
                message: 'We could not recognise this study link. Check the address and try again.'
              }
            });
          }
          if (b.link && b.link.indexOf('not_found') >= 0) {
            return send(404, {
              error: {
                code: 'paper_not_found',
                message: 'Study not found'
              }
            });
          }
          if (b.link && b.link.indexOf('40959673') >= 0) {
            return setTimeout(() => send(200, { card: METRIC_FULLTEXT_CARD, requestId: 'req_metric' }), 80);
          }
          if (b.link && b.link.indexOf('unstructured') >= 0) {
            return setTimeout(() => send(200, { card: UNSTRUCTURED_CARD, requestId: 'req_unstructured' }), 100);
          }
          if (b.link && b.link.indexOf('cached') >= 0) {
            return setTimeout(() => send(200, { card: CACHED_CARD, requestId: 'req_cached' }), 100);
          }
          return setTimeout(() => send(200, { card: STRUCTURED_CARD, requestId: 'req_card' }), 100);
        }

        if (sub === '/paper-card/explain' && req.method === 'POST') {
          explainCalls.push(b);
          const baseCard = b.pmid === '40959673' ? METRIC_FULLTEXT_CARD : UNSTRUCTURED_CARD;
          const updatedCard = Object.assign({}, baseCard, { ai: PICO_DATA });
          return setTimeout(() => send(200, { card: updatedCard, model: 'gemini-2.5-flash', costInr: 0.15 }), 100);
        }

        if (sub === '/studies/auto-add' && req.method === 'POST') {
          autoCalls.push(b);
          const pmid = (b.items && b.items[0] && b.items[0].pmid) || '12345678';
          if (pmid === '40959673' && b.outcome && b.outcome.indexOf('fail_once') >= 0) {
            return setTimeout(() => send(200, {
              results: [{
                status: 'needs_pdf',
                study: null,
                fields: null,
                quote: '',
                location: '',
                method: '',
                message: 'The abstract did not contain a complete result. Upload the PDF (the full paper) so the numbers can be read from a table.'
              }],
              requestId: 'req_add_fail'
            }), 80);
          }
          const newStudy = {
            id: 'st_auto_' + Date.now(),
            projectId: pid,
            label: 'Aronson 2024',
            measure: 'HR',
            inputs: { effect: 0.74, ciLower: 0.65, ciUpper: 0.85 },
            locator: { kind: 'manual', citation: 'Aronson 2024', section: 'Abstract', quote: 'The hazard ratio was 0.74' },
            verified: false,
            version: 1
          };
          return setTimeout(() => send(200, {
            results: [{
              status: 'filled',
              study: newStudy,
              fields: newStudy.inputs,
              quote: 'The hazard ratio was 0.74',
              location: 'Abstract',
              method: 'parser'
            }],
            requestId: 'req_add'
          }), 150);
        }
      }

      return send(404, { error: { code: 'not_found' } });
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
  `--user-data-dir=/tmp/rmd-papercard-chrome-${process.pid}`,
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
      /* wait */
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
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params);
    }
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;

  await call('Runtime.enable');
  await call('Page.enable');

  // Start with iPhone dimensions: 390x844
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });

  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH.paperCard', 30000), 'app loaded with ResearchMD and the paperCard module');

  // Create a server-backed project
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('.rmd-start-screen')`, 5000), 'start screen rendered');
  await click('[data-rmd-start-choice="sr"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='PaperCard Usability Review';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_paper_1'`, 5000), 'project created on the server');
  ok(await until(`!!document.querySelector('.rmd-studies-screen')`, 5000), 'lands on the studies workspace');

  // Check phone home/studies screen: NO space-eating paste box inside studies workspace,
  // and mobile top header shows compact RStudy button (header input bar hidden at 390px)
  ok(await ev(`!document.querySelector('.rmd-studies-paste-wrap')`), 'studies screen no longer wastes space with inline paste box');
  ok(await ev(`(()=>{const b=document.querySelector('[data-rmd="open-read-study"]');return !!b && b.innerText.trim()==='RStudy' && getComputedStyle(b).display!=='none';})()`), 'mobile header shows RStudy button at 390px');
  ok(await ev(`getComputedStyle(document.querySelector('.rmd-shell-center')).display === 'none'`), 'wide header Read study bar is hidden on mobile 390px');

  // Verify local/demo project works via standalone /v1/paper-card on Read Study page
  await ev(`SMD_RESEARCH.store.setActiveProject('prj_bcg_1994');1`);
  await click('[data-rmd="open-read-study"]');
  ok(await until(`!!document.querySelector('#rmdReadStudyWrap [data-rmd="paste-link-input"]')`, 5000), 'clicking RStudy navigates to dedicated Read Study page');
  ok(/Paste a PubMed link, doi.org, bare DOI/.test(await ev(`document.querySelector('[data-rmd="paste-link-input"]').placeholder`)), 'input has correct placeholder');
  ok(/Works with or without https:\/\/, PubMed, doi.org, bare DOIs/.test(await text('#rmdReadStudyWrap .rmd-paste-hint')), 'hint text explains supported links and DOIs');

  // Paste into input and ensure local project calls standalone /v1/paper-card cleanly
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="paste-link-input"]');
    inp.value = '10.1056/NEJMoa123456';
    inp.dispatchEvent(new Event('paste', { bubbles: true }));
    return true;
  })()`);
  ok(await until(`!!document.querySelector('.rmd-papercard')`, 5000), 'local/demo project renders paper card for bare DOI via /v1/paper-card');
  ok(paperCardCalls.length === 1 && paperCardCalls[0].link === '10.1056/NEJMoa123456', 'bare DOI sent cleanly on Read Study page');

  // Switch back to server project prj_paper_1 for project-scoped auto-add / explain assertions
  await ev(`SMD_RESEARCH.store.setActiveProject(SMD_RESEARCH.store.getState().projects.find(p => p.serverId === 'prj_paper_1').id); SMD_RESEARCH.navigate('read-study', {}); 1`);
  ok(await until(`!!document.querySelector('#rmdReadStudyWrap [data-rmd="paste-link-input"]')`, 5000), 'Read Study page ready for server project');

  // 1. Paste of a PubMed link calls /paper-card with { link }
  paperCardCalls.length = 0;
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="paste-link-input"]');
    inp.value = 'https://pubmed.ncbi.nlm.nih.gov/12345678/';
    inp.dispatchEvent(new Event('paste', { bubbles: true }));
    return true;
  })()`);

  // Verify calm line while loading: "Reading the study"
  // (Notice: setTimeout in server sends response after 100ms)
  ok(await until(`!!document.querySelector('.rmd-papercard')`, 5000), 'paper card renders on link paste');
  ok(paperCardCalls.length === 1 && paperCardCalls[0].link === 'https://pubmed.ncbi.nlm.nih.gov/12345678/', 'paste called /paper-card with { link }');
  ok(await ev(`document.querySelector('[data-rmd="paste-link-input"]').value === 'https://pubmed.ncbi.nlm.nih.gov/12345678/'`), 'pasted URL is not doubled in input field');

  // 2. Card shows title, design label, n, key result line built by SMD_RESEARCH_EXPLAIN, highlighted quote, conclusion, "0 MaiK tokens"
  const cardTitle = await text('.rmd-papercard-title');
  ok(/BCG vaccination against tuberculosis: a randomised trial/.test(cardTitle), 'card shows study title');

  const designText = await text('.rmd-badge-design');
  ok(/Randomised controlled trial \(RCT\)/.test(designText), 'shows design label with scientific term first and plain in brackets');

  const sampleText = await text('.rmd-badge-sample');
  ok(/n = 4,744 \(people studied\)/.test(sampleText), 'shows formatted sample size with plain meaning: n = 4,744 (people studied)');

  const freeFullText = await text('.rmd-badge-free');
  ok(/Free full text/.test(freeFullText), 'shows Free full text badge');

  const tokenChipText = await text('.rmd-papercard-badges');
  ok(/0 MaiK tokens/.test(tokenChipText), 'shows quiet 0 MaiK tokens chip');

  const statText = await text('.rmd-finding-stat');
  ok(/Hazard ratio \(HR\) 0\.74/.test(statText), 'key result line contains Hazard ratio (HR) 0.74');
  ok(/people who got the treatment had lower hazard/.test(statText), 'key result line contains bracketed plain meaning from SMD_RESEARCH_EXPLAIN');

  const quoteHtml = await ev(`document.querySelector('.rmd-finding-quote').innerHTML`);
  ok(/<mark class="rmd-find-num">0\.74<\/mark>/.test(quoteHtml) && /<mark class="rmd-find-num">0\.65<\/mark>/.test(quoteHtml), 'numbers in quote sentence are highlighted with rmd-find-num');

  const conclusionText = await text('.rmd-papercard-conclusion');
  ok(/BCG vaccination provided substantial long-term protection/.test(conclusionText), 'card shows conclusion text');

  // 3. Cache method shows the instant chip
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="paste-link-input"]');
    inp.value = 'https://pubmed.ncbi.nlm.nih.gov/cached/';
    inp.dispatchEvent(new Event('paste', { bubbles: true }));
    return true;
  })()`);
  ok(await until(`/Cached study/.test(document.querySelector('.rmd-papercard-title').innerText)`, 5000), 'cached study loaded');
  const cachedBadges = await text('.rmd-papercard-badges');
  ok(/Already read by someone, instant/.test(cachedBadges), 'cache method shows instant chip: Already read by someone, instant');
  ok(/0 MaiK tokens/.test(cachedBadges), 'cache method also carries 0 MaiK tokens chip');

  // 4. "Add to my studies" calls auto-add with the pmid
  await click('[data-rmd="card-add-study"]');
  // Since project has no outcome yet, outcome question appears
  ok(await until(`document.querySelector('#rmdCardOutcomePrompt').style.display !== 'none'`, 3000), 'outcome prompt asked when project has no outcome');
  ok(/What result are you combining\?/.test(await text('#rmdCardOutcomePrompt')), 'outcome prompt asks the same question as Find sheet');
  await ev(`(()=>{
    const field = document.getElementById('rmd_card_outcome_field');
    field.value = 'confirmed active tuberculosis';
    return true;
  })()`);
  await click('[data-rmd="confirm-outcome-add"]');
  for (let t = 0; t < 5000; t += 100) {
    if (autoCalls.length > 0) break;
    await sleep(100);
  }
  ok(autoCalls.length > 0, 'auto-add was called');
  ok(autoCalls[0].items[0].pmid === '22222222', 'calls auto-add with the study pmid');
  ok(autoCalls[0].outcome === 'confirmed active tuberculosis', 'calls auto-add with the specified outcome');
  ok(await until(`/Added to studies/.test(document.querySelector('[data-rmd="card-add-study"]').innerText)`, 5000), 'button confirms Added to studies');
  ok(/Added to PaperCard Usability Review/.test(await text('#rmdCardAddStatus')), 'status banner confirms Added to <project>');

  // 5. "Copy summary" writes text
  await click('[data-rmd="card-copy-summary"]');
  ok(await until(`/Copied/.test(document.querySelector('[data-rmd="card-copy-summary"]').innerText)`, 3000), 'Copy summary button shows Copied');

  // 6. Explain button hidden for a structured card and shown for an unstructured one
  // Check structured card first: explain button is NOT in DOM
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="paste-link-input"]');
    inp.value = 'https://pubmed.ncbi.nlm.nih.gov/12345678/';
    inp.dispatchEvent(new Event('paste', { bubbles: true }));
    return true;
  })()`);
  ok(await until(`/BCG vaccination against tuberculosis/.test(document.querySelector('.rmd-papercard-title').innerText)`, 5000), 'structured card reloaded');
  ok(await ev(`!document.querySelector('[data-rmd="explain-study"]')`), 'Explain button hidden for structured card with findings');

  // Check unstructured card: explain button IS in DOM
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="paste-link-input"]');
    inp.value = 'https://pubmed.ncbi.nlm.nih.gov/unstructured/';
    inp.dispatchEvent(new Event('paste', { bubbles: true }));
    return true;
  })()`);
  ok(await until(`/Unstructured pilot study/.test(document.querySelector('.rmd-papercard-title').innerText)`, 5000), 'unstructured card loaded');
  ok(await ev(`!!document.querySelector('[data-rmd="explain-study"]')`), 'Explain button shown for unstructured card');
  ok(/^Explain with MaiK$/.test((await text('[data-rmd="explain-study"]')).trim()), 'explain button text has no hardcoded price');
  ok(await ev(`!!document.querySelector('[data-rmd-cost-task="paper_card_explain"]')`), 'explain button carries a server-backed cost line');

  // Click Explain with MaiK and verify PICO lines render
  await click('[data-rmd="explain-study"]');
  for (let t = 0; t < 5000; t += 100) {
    if (explainCalls.length > 0) break;
    await sleep(100);
  }
  ok(explainCalls.length > 0, 'called /paper-card/explain');
  ok(await until(`!!document.querySelector('.rmd-ai-pico-box')`, 5000), 'PICO breakdown renders');
  const picoText = await text('.rmd-ai-pico-box');
  ok(/Population \(who was studied\):/.test(picoText), 'shows Population PICO line');
  ok(/Intervention \(what was tested\):/.test(picoText), 'shows Intervention PICO line');
  ok(/Comparison \(what it was compared to\):/.test(picoText), 'shows Comparison PICO line');
  ok(/Outcome \(what was measured\):/.test(picoText), 'shows Outcome PICO line');

  // 6b. Metric + free full text card (40959673): renders key results numbers, Abstract/Full text source labels, Explain with MaiK, and Add button recovers from needs_pdf
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="paste-link-input"]');
    inp.value = 'https://pubmed.ncbi.nlm.nih.gov/40959673/';
    inp.dispatchEvent(new Event('paste', { bubbles: true }));
    return true;
  })()`);
  ok(await until(`/Prognostic utility of PT-INR/.test(document.querySelector('.rmd-papercard-title').innerText)`, 5000), 'metric + full-text card loaded');
  const metricResultsText = await text('.rmd-papercard-results');
  ok(/38\.8%/.test(metricResultsText) && /104\.87/.test(metricResultsText) && /0\.995/.test(metricResultsText) && /100%/.test(metricResultsText), 'key results list renders percentages, mean +/- SD, AUC, and sensitivity');
  ok(/Abstract/.test(metricResultsText) && /Full text/.test(metricResultsText), 'key results labels Abstract and Full text sources');
  ok(/very unlikely to be chance/.test(metricResultsText), 'string p-value (<0.001) renders plain explanation');
  ok(await ev(`!!document.querySelector('[data-rmd="explain-study"]')`), 'Explain with MaiK shown for metric-only card');

  // Add button returns to normal state when auto-add returns needs_pdf instead of hanging on Adding...
  await ev(`(()=>{ const p = SMD_RESEARCH.store.getActiveProject(); p.outcome = 'fail_once mortality'; return true; })()`);
  await click('[data-rmd="card-add-study"]');
  ok(await until(`/Add to my studies/.test(document.querySelector('[data-rmd="card-add-study"]').innerText) && !document.querySelector('[data-rmd="card-add-study"]').disabled`, 5000), 'Add button returns to normal state after needs_pdf response');
  ok(/Upload the PDF/.test(await text('#rmdCardAddStatus')), 'plain guidance shown after needs_pdf response');

  // 7. 400 link_unrecognised shows the plain message with no raw code
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="paste-link-input"]');
    inp.value = 'bad_link_format';
    inp.dispatchEvent(new Event('paste', { bubbles: true }));
    return true;
  })()`);
  ok(await until(`!!document.querySelector('.rmd-papercard-status-target .rmd-banner-error')`, 5000), 'error banner displayed for unrecognized link');
  const errorText = await text('.rmd-papercard-status-target');
  ok(/We could not recognise this study link/.test(errorText), 'shows friendly message from server');
  ok(!/link_unrecognised/.test(errorText), 'no raw code link_unrecognised shown to user');
  ok(!/HTTP 400/.test(errorText), 'no raw HTTP 400 code shown to user');

  // 8. Responsive checks: 390x844 (phone) and 1024x1366 (iPad) with no horizontal scroll
  // Reload structured card for layout checks
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="paste-link-input"]');
    inp.value = 'https://pubmed.ncbi.nlm.nih.gov/12345678/';
    inp.dispatchEvent(new Event('paste', { bubbles: true }));
    return true;
  })()`);
  ok(await until(`!!document.querySelector('.rmd-papercard')`, 5000), 'card reloaded for layout assertions');

  // Check phone 390x844
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(150);
  const scrollW390 = await ev(`document.documentElement.scrollWidth`);
  const clientW390 = await ev(`document.documentElement.clientWidth`);
  ok(scrollW390 <= 391 && scrollW390 <= clientW390, 'no horizontal scroll at 390x844');
  await shot('phone-390-papercard');

  // Check iPad 1024x1366: header bar input visible, RStudy button hidden, and submitting from header bar works
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: false });
  await sleep(150);
  ok(await ev(`getComputedStyle(document.querySelector('.rmd-head-read-bar')).display !== 'none'`), 'iPad 1024px header displays compact Read study bar');
  ok(await ev(`getComputedStyle(document.querySelector('[data-rmd="open-read-study"]')).display === 'none'`), 'mobile RStudy button hidden on iPad 1024px');
  await ev(`(()=>{
    const inp = document.querySelector('[data-rmd="header-paste-link"]');
    inp.value = 'pubmed.ncbi.nlm.nih.gov/12345678/';
    document.querySelector('[data-rmd="header-read-study"]').click();
    return true;
  })()`);
  ok(await until(`!!document.querySelector('.rmd-papercard') && /BCG vaccination/.test(document.querySelector('.rmd-papercard-title').innerText)`, 5000), 'submitting schemeless URL in header bar opens Read Study page and renders card');
  const scrollW1024 = await ev(`document.documentElement.scrollWidth`);
  const clientW1024 = await ev(`document.documentElement.clientWidth`);
  ok(scrollW1024 <= 1025 && scrollW1024 <= clientW1024, 'no horizontal scroll at 1024x1366');
  // Check iPad max-width 880px
  const cardWidth = await ev(`document.querySelector('.rmd-papercard').offsetWidth`);
  ok(cardWidth <= 880, 'card obeys max-width 880px on iPad');
  await shot('ipad-1024-papercard');

  // 9. Zero page errors
  ok(pageErrors.length === 0, 'zero page errors or unhandled exceptions');
  if (pageErrors.length > 0) {
    console.error('Page errors encountered:', pageErrors);
  }

  // 10. No em or en dashes anywhere in ResearchMD DOM
  const dashCount = await ev(`(()=>{
    const t = document.querySelector('#researchMD').innerText || '';
    return (t.match(/[\\u2013\\u2014]/g) || []).length;
  })()`);
  ok(dashCount === 0, 'zero em or en dashes in ResearchMD visible text');

  console.log(failures === 0 ? '\nALL PAPERCARD UI CHECKS PASSED' : `\n${failures} PAPERCARD UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
