// Real-browser headless test: ResearchMD one-tap Thesis-to-Journal pipeline.
// Covers: token estimate on upload, 12-step automatic pipeline, Stop & Continue,
// persistence across reload, single-step Re-run, 5xx non-charge invariant,
// Top-3 journal switching without re-charging AI, Amber vs Green checklist +
// inline confirmations, manual Approve and mark final, full .zip package export,
// and 390px light/dark + 1024px iPad layout & touch target checks.
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
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

const getFreePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    srv.close(() => resolve(port));
  });
  srv.on('error', reject);
});

const PORT = await getFreePort();
const CDP = await getFreePort();
const OUT = '/tmp/stewardmd-research-thesis-auto';
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
let slowDraftMs = 600;
let forceDraft500 = false;
const aiDraftCalls = [];
const approveCalls = [];
const savedSections = [];
const pageErrors = [];

const JOURNALS = [
  {
    id: 'indian_heart_j',
    name: 'Indian Heart Journal',
    shortName: 'IHJ',
    specialty: 'Cardiology',
    isIndian: true,
    wordLimit: 3500,
    abstractWordLimit: 250,
    abstractFormat: 'Structured (Background, Methods, Results, Conclusions), up to 250 words',
    referenceStyle: 'vancouver',
    maxReferences: 35,
    maxTables: 5,
    openAccess: true,
    noFee: true,
    indexedPubMed: true,
    lineNumbers: true,
    articleTypes: ['Original Article', 'Cohort Study']
  },
  {
    id: 'ijmr',
    name: 'Indian Journal of Medical Research (IJMR)',
    shortName: 'IJMR',
    specialty: 'General Medicine',
    isIndian: true,
    wordLimit: 3000,
    abstractWordLimit: 250,
    abstractFormat: 'Structured, up to 250 words',
    referenceStyle: 'vancouver',
    maxReferences: 35,
    maxTables: 4,
    openAccess: true,
    noFee: true,
    indexedPubMed: true,
    lineNumbers: true,
    articleTypes: ['Original Article']
  },
  {
    id: 'jama',
    name: 'JAMA (Journal of the American Medical Association)',
    shortName: 'JAMA',
    specialty: 'General Medicine',
    isIndian: false,
    wordLimit: 3000,
    abstractWordLimit: 350,
    abstractFormat: 'Structured, up to 350 words',
    referenceStyle: 'ama',
    maxReferences: 40,
    maxTables: 5,
    openAccess: false,
    noFee: true,
    indexedPubMed: true,
    lineNumbers: true,
    articleTypes: ['Original Investigation']
  }
];

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
            id: 'prj_auto_' + projN,
            title: b.title || 'Heart Failure Thesis',
            studyType: b.studyType || '',
            role: 'owner',
            createdAt: Date.now()
          }
        });
      }
      if (p === '/api/research/v1/journals' && req.method === 'GET') {
        return send(200, { journals: JOURNALS });
      }
      if (p === '/api/research/v1/journals/match' && req.method === 'POST') {
        return send(200, { matches: [{ score: 10, designMatch: true, journal: JOURNALS[0] }] });
      }
      const aiMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/ai-draft$/);
      if (aiMatch && req.method === 'POST') {
        aiDraftCalls.push(b);
        if (forceDraft500) {
          return send(500, { error: { code: 'upstream_500', message: 'Simulated upstream 500 failure' } });
        }
        const reqSec = (b && b.input && b.input.section) || 'abstract';
        const secTexts = {
          abstract: 'Background: Heart failure hospital readmissions cause major morbidity. Methods: Retrospective cohort of 240 adults with reduced ejection fraction. Results: 30-day readmission occurred in 48 (20%) patients [1]. Conclusion: Early NT-proBNP guided follow-up lowers readmissions.',
          introduction: 'Heart failure remains a leading cause of hospital admissions in cardiology [1]. Prior cohorts described biomarkers [2].',
          methods: 'We included 240 consecutive adults admitted for decompensated heart failure after ethics clearance IEC/2023/419.',
          results: 'Of 240 enrolled adults, 48 (20%) were readmitted within 30 days as detailed in Table 1 and Table 2.',
          discussion: 'Our 20% readmission rate parallels global registry estimates [1]. Limitations include single-centre design.',
          conclusion: 'Structured post-discharge follow-up improves heart failure outcomes across 240 adults.'
        };
        const respond = () => send(200, {
          draft: {
            sections: [{ id: reqSec, heading: reqSec.charAt(0).toUpperCase() + reqSec.slice(1), text: secTexts[reqSec] || 'Draft section for 240 adults.' }]
          },
          model: 'gemini-2.5-flash',
          costInr: 0.06
        });
        if (slowDraftMs > 0) setTimeout(respond, slowDraftMs);
        else respond();
        return;
      }
      const manMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/manuscript$/);
      if (manMatch && req.method === 'GET') {
        return send(200, { manuscript: { version: 2, status: 'draft', sections: [] } });
      }
      const secMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/manuscript\/sections\/([^/]+)$/);
      if (secMatch && req.method === 'PUT') {
        savedSections.push({ sid: secMatch[2], text: b.text });
        return send(200, { ok: true, manuscript: { version: (b.version || 1) + 1 } });
      }
      const appMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/manuscript\/approval\/approve$/);
      if (appMatch && req.method === 'POST') {
        approveCalls.push(b);
        return send(200, { ok: true, approval: { status: 'approved' } });
      }
      const clMatch = p.match(/^\/api\/research\/v1\/checklists\/([^/]+)$/);
      if (clMatch && req.method === 'GET') {
        return send(200, {
          checklist: {
            id: clMatch[1],
            name: 'STROBE',
            sections: [
              { title: 'Title and Abstract', items: [{ number: '1', topic: 'Title and abstract study design' }] },
              { title: 'Introduction', items: [{ number: '2', topic: 'Background and rationale' }] },
              { title: 'Methods', items: [{ number: '4', topic: 'Study design and participants' }] },
              { title: 'Results', items: [{ number: '16', topic: 'Main outcomes and estimates' }] },
              { title: 'Discussion', items: [{ number: '19', topic: 'Limitations and generalizability' }] },
              { title: 'Other', items: [{ number: '22', topic: 'Funding and ethics' }] }
            ]
          }
        });
      }
      return send(200, { ok: true });
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
  '--headless=new',
  '--no-sandbox',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-thesis-auto-chrome-${process.pid}`,
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

const until = async (expr, ms = 12000) => {
  for (let t = 0; t < ms; t += 100) {
    try { if (await ev(expr)) return true; } catch { /* busy */ }
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

const uploadDocx = (xml, filename = 'HeartFailureThesis.docx') => ev(`(async (xml, filename)=>{
  const inp=document.querySelector('#rmdThesisFile');
  if(!inp)return false;
  const enc=new TextEncoder();
  const name=enc.encode('word/document.xml');
  const body=enc.encode(xml);
  const lh=new Uint8Array(30+name.length);
  const dvL=new DataView(lh.buffer);
  dvL.setUint32(0,0x04034b50,true); dvL.setUint16(4,20,true);
  dvL.setUint32(18,body.length,true); dvL.setUint32(22,body.length,true); dvL.setUint16(26,name.length,true);
  lh.set(name,30);
  const ch=new Uint8Array(46+name.length);
  const dvC=new DataView(ch.buffer);
  dvC.setUint32(0,0x02014b50,true); dvC.setUint16(4,20,true); dvC.setUint16(6,20,true);
  dvC.setUint32(20,body.length,true); dvC.setUint32(24,body.length,true); dvC.setUint16(28,name.length,true);
  ch.set(name,46);
  const eocd=new Uint8Array(22);
  const dvE=new DataView(eocd.buffer);
  dvE.setUint32(0,0x06054b50,true); dvE.setUint16(8,1,true); dvE.setUint16(10,1,true);
  dvE.setUint32(12,ch.length,true); dvE.setUint32(16,lh.length+body.length,true);
  const out=new Uint8Array(lh.length+body.length+ch.length+eocd.length);
  out.set(lh,0); out.set(body,lh.length); out.set(ch,lh.length+body.length); out.set(eocd,lh.length+body.length+ch.length);
  const f=new File([out], filename, {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  const dt=new DataTransfer(); dt.items.add(f); inp.files=dt.files;
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
})(${JSON.stringify(xml)}, ${JSON.stringify(filename)})`);

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; }
    catch { await sleep(200); }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown' && m.params?.exceptionDetails) {
      pageErrors.push(m.params.exceptionDetails.text || 'Runtime exception');
    }
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });

  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH_THESIS && !!window.SMD_RESEARCH_THESIS_AUTO', 25000), 'app loaded with ResearchMD and thesis-auto module');

  // Create real thesis project
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('[data-rmd-start-choice="thesis"]')`, 5000), 'start screen ready');
  await click('[data-rmd-start-choice="thesis"]');
  ok(await until(`!!document.querySelector('#rmd_start_title')`, 5000), 'title input ready');
  await ev(`(()=>{const el=document.getElementById('rmd_start_title');el.value='Heart Failure Readmission Cohort Thesis';el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 10000), 'upload screen ready');

  const para = 'Observational cohort of 240 adults with heart failure and reduced ejection fraction, measuring NT-proBNP and echocardiography predictors of 30-day readmission (48 events, 20%). Ethics IEC/2023/419. '.repeat(26);
  const refsXml = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>References</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>1. Campbell PT, Newton CC. Epidemiology of heart failure. BMJ. 2017;356:j142.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>2. Ponikowski P. ESC Heart Failure Guidelines. Eur Heart J. 2016;37:2129.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>3. Uncited Extra Ref. Arch Med. 2011;12:55-60.</w:t></w:r></w:p>';
  const tblXml = '<w:p><w:r><w:t>Table 1: Baseline Demographics of 240 Patients</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Variable   Group A   Group B</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Age (years)   61.2   59.4</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Table 2: Primary Readmission Outcomes</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Outcome   Count   Percent</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>30-day readmission   48   20%</w:t></w:r></w:p>';

  const fullDocXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>1. Introduction</w:t></w:r></w:p><w:p><w:r><w:t>' + para + '</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>2. Methods</w:t></w:r></w:p><w:p><w:r><w:t>' + para + '</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>3. Results</w:t></w:r></w:p><w:p><w:r><w:t>' + para + '</w:t></w:r></w:p>' + tblXml + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>4. Discussion</w:t></w:r></w:p><w:p><w:r><w:t>' + para + '</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    refsXml + '</w:body></w:document>';

  await uploadDocx(fullDocXml);
  ok(await until(`!!document.querySelector('#rmdMakeJournalPaper')`, 10000), 'primary Make my journal paper button shown');
  ok(await until(`/Estimated MaiK cost/i.test((document.querySelector('#rmdThesisAutoEstimate')||{}).innerText||'')`, 3000), 'MaiK token estimate shown before starting');
  await shot('before-upload-390-light');

  // Intercept online PubMed/Crossref network calls inside page with fast stub JSON so harness runs deterministically offline
  await ev(`(()=>{
    const origFetch = window.fetch.bind(window);
    window.fetch = function(url, init) {
      const s = String(url || '');
      if (s.includes('api.crossref.org') || s.includes('eutils.ncbi.nlm.nih.gov')) {
        if (s.includes('esearch.fcgi') && s.includes('db=mesh')) {
          return Promise.resolve(new Response(JSON.stringify({ esearchresult: { idlist: ['D006333'] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        if (s.includes('esummary.fcgi') && s.includes('db=mesh')) {
          return Promise.resolve(new Response(JSON.stringify({ result: { D006333: { ds_meshterms: ['Heart Failure'] } } }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        if (s.includes('api.crossref.org') && /Campbell|BMJ/i.test(decodeURIComponent(s))) {
          return Promise.resolve(new Response(JSON.stringify({
            message: { items: [{ title: ['Epidemiology of heart failure'], published: { 'date-parts': [[2017]] }, 'container-title': ['BMJ'], author: [{ family: 'Campbell', given: 'PT' }], DOI: '10.1136/bmj.j142' }] }
          }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({ message: { items: [] }, esearchresult: { idlist: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return origFetch(url, init);
    };
    return 1;
  })()`);

  // Start automatic 12-step run, then press Stop mid-draft
  await click('#rmdMakeJournalPaper');
  const started = await until(`!!document.querySelector('#rmdAutoStopBtn')`, 6000);
  if (!started) console.log('DEBUG body after Make click:', await text('#rmdScreenBody'));
  ok(started, '12-step pipeline started running');
  await sleep(300);
  await click('#rmdAutoStopBtn');
  ok(await until(`!!document.querySelector('#rmdAutoContinueBtn')`, 8000), 'Stop pauses pipeline cleanly and shows Continue paper');

  // Verify persistence across full app reload
  await ev('window.__preReloadFlag = 1; 1');
  await call('Page.reload');
  ok(await until('!window.__preReloadFlag && !!window.SMD_RESEARCH && !!window.SMD_RESEARCH_THESIS_AUTO', 25000), 'reloaded ResearchMD cleanly');
  await ev(`SMD_RESEARCH.open({screen:'thesis-auto'});1`);
  ok(await until(`!!document.querySelector('#rmdAutoContinueBtn')`, 5000), 'paused progress and Continue button survived full app restart');
  ok(await ev(`document.querySelectorAll('[data-auto-step][data-step-status="done"]').length >= 3`), 'pre-draft steps persisted as done across restart');

  // Re-install offline PubMed/Crossref stub after reload & complete remaining steps
  await ev(`(()=>{
    const origFetch = window.fetch.bind(window);
    window.fetch = function(url, init) {
      const s = String(url || '');
      if (s.includes('api.crossref.org') || s.includes('eutils.ncbi.nlm.nih.gov')) {
        if (s.includes('esearch.fcgi') && s.includes('db=mesh')) return Promise.resolve(new Response(JSON.stringify({ esearchresult: { idlist: ['D006333'] } }), { status: 200 }));
        if (s.includes('esummary.fcgi') && s.includes('db=mesh')) return Promise.resolve(new Response(JSON.stringify({ result: { D006333: { ds_meshterms: ['Heart Failure'] } } }), { status: 200 }));
        if (s.includes('api.crossref.org') && /Campbell/i.test(decodeURIComponent(s))) {
          return Promise.resolve(new Response(JSON.stringify({ message: { items: [{ title: ['Epidemiology of heart failure'], published: { 'date-parts': [[2017]] }, 'container-title': ['BMJ'], author: [{ family: 'Campbell', given: 'PT' }], DOI: '10.1136/bmj.j142' }] } }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ message: { items: [] }, esearchresult: { idlist: [] } }), { status: 200 }));
      }
      return origFetch(url, init);
    };
    return 1;
  })()`);
  slowDraftMs = 0;
  await click('#rmdAutoContinueBtn');
  ok(await until(`!!document.querySelector('#rmdAutoApproveBtn') && /Awaiting approval/.test((document.querySelector('#rmdAutoStatusBadge')||{}).innerText||'')`, 12000), 'stops cleanly at Review and approve once all 12 steps finish');

  // Verify failed 500 AI call on Re-run does NOT increase charged tokens/calls
  const usedBeforeFail = await ev(`(document.querySelector('#rmdAutoCostSummary')||{}).innerText||''`);
  forceDraft500 = true;
  await click('[data-rmd-auto-rerun="draft"]');
  ok(await until(`!!document.querySelector('#rmdAutoErrBanner')`, 8000), '500 failure surfaces clean error banner');
  const usedAfterFail = await ev(`(document.querySelector('#rmdAutoCostSummary')||{}).innerText||''`);
  const callsAfterFail = usedAfterFail.match(/(\d+)\s*AI\)/);
  const callsBeforeFail = usedBeforeFail.match(/(\d+)\s*AI\)/);
  ok(callsAfterFail && callsBeforeFail && callsAfterFail[1] === callsBeforeFail[1], 'failed 500 AI calls were never charged to MaiK token ledger');

  // Re-run draft cleanly to restore review state
  forceDraft500 = false;
  await click('[data-rmd-auto-rerun="draft"]');
  ok(await until(`!!document.querySelector('#rmdAutoApproveBtn')`, 10000), 'single-step draft Re-run completes cleanly');

  // Switch journal among Top 3 without invoking ai-draft again
  const callsBeforeSwitch = aiDraftCalls.length;
  await click('[data-rmd-auto-journal="jama"]');
  ok(await until(`/AMA/i.test((document.querySelector('#rmdAutoRefsCard')||{}).innerText||'')`, 6000), 'switching journal to JAMA updates reference style to AMA');
  ok(aiDraftCalls.length === callsBeforeSwitch, 'switching journal triggers zero extra AI calls');

  // Verify Amber vs Green states & inline confirmation
  ok(await ev(`document.querySelector('[data-ready-item="title_page"]').getAttribute('data-ready-state') === 'amber'`), 'author list starts Amber until confirmed');
  await ev(`(()=>{
    document.querySelector('#rmdAutoAuth1In').value = 'Dr. Priya Nair';
    document.querySelector('#rmdAutoAuth1In').dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#rmdAutoAuth2In').value = 'Prof. Suresh Menon';
    document.querySelector('#rmdAutoAuth2In').dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#rmdAutoEmailIn').value = 'priya@hospital.org';
    document.querySelector('#rmdAutoEmailIn').dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#rmdAutoAffilIn').value = 'Dept of Cardiology, SCTIMST';
    document.querySelector('#rmdAutoAffilIn').dispatchEvent(new Event('input', {bubbles:true}));
    return 1;
  })()`);
  await click('#rmdConfirmTitleCb');
  await click('#rmdConfirmEthicsCb');
  await click('#rmdConfirmDeclCb');
  await click('#rmdConfirmRefsCb');
  ok(await ev(`document.querySelector('[data-ready-item="title_page"]').getAttribute('data-ready-state') === 'green'`), 'confirming title/author details switches item from Amber to Green');
  ok(await ev(`document.querySelector('[data-ready-item="ethics"]').getAttribute('data-ready-state') === 'green'`), 'confirming IEC turns ethics Green');
  ok(await ev(`document.querySelector('[data-ready-item="references"]').getAttribute('data-ready-state') === 'green'`), 'confirming unverified refs turns references Green');

  await shot('after-review-390-light');

  // Final approval action
  await click('#rmdAutoApproveBtn');
  ok(await until(`/Approved final/.test((document.querySelector('#rmdAutoStatusBadge')||{}).innerText||'')`, 6000), 'clicking Approve marks package Approved final');
  ok(approveCalls.length === 1, 'server /manuscript/approval/approve endpoint called on final approval');

  // Submission package ZIP download check
  await ev(`(()=>{
    window.__capturedDownloads = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      window.__capturedDownloads.push({ download: this.download || '', href: this.href || '' });
      return origClick.apply(this, arguments);
    };
    return 1;
  })()`);
  await click('#rmdAutoExportPackBtn');
  ok(await until(`window.__capturedDownloads.length >= 1`, 4000), 'Export full package triggers ZIP file download');
  const dlInfo = await ev(`window.__capturedDownloads[0]`);
  ok(/-submission-package\.zip$/.test(dlInfo.download), 'submission zip filename ends with -submission-package.zip: ' + dlInfo.download);

  // Dark mode check & screenshot at 390px
  await ev(`document.body.classList.add('dark');1`);
  await sleep(150);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), '390px dark no horizontal overflow');
  await shot('after-review-390-dark');
  await ev(`document.body.classList.remove('dark');1`);

  // Touch targets >= 44px & no em/en dashes & iPad 1024px layout
  const smallEls = await ev(`(()=>{
    const els = Array.from(document.querySelectorAll('#researchMD .rmd-auto-wrap button, #researchMD .rmd-auto-wrap summary, #researchMD .rmd-auto-wrap .rmd-auto-confirm-row, #researchMD .rmd-auto-wrap .rmd-auto-jcard'));
    const bad = els.map(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { tag: el.tagName, id: el.id, w: Math.round(r.width), h: Math.round(r.height), rh: r.height, mh: cs.minHeight, scale: window.visualViewport && window.visualViewport.scale }; }).filter(x => x.w > 0 && x.h < 44);
    return bad;
  })()`);
  if (smallEls.length) console.log('Small touch targets in .rmd-auto-wrap:', smallEls);
  ok(smallEls.length === 0, 'all interactive buttons, cards, summaries and checkboxes in .rmd-auto-wrap meet 44px touch target');
  const dashes = await ev(`((document.querySelector('#researchMD').innerText||'').match(/[\\u2013\\u2014]/g)||[]).length`);
  ok(dashes === 0, 'zero em or en dashes in ResearchMD visible text');

  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: false });
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), '1024x1366 tablet no horizontal overflow');
  await shot('after-review-1024-ipad');

  ok(pageErrors.length === 0, 'zero runtime page errors: ' + pageErrors.join('; '));
  console.log(failures === 0 ? '\nALL THESIS AUTO UI CHECKS PASSED' : `\n${failures} THESIS AUTO UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill('SIGKILL'); } catch {}
  server.close();
}
