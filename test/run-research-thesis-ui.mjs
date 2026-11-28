// Real-browser headless test: ResearchMD thesis-to-paper flow (client only).
// Mocked server: pdf-uploads + pdf_extract job (PHI hit then clean), artifacts
// result, ai-draft "thesis_to_paper", journals/match, manuscript save. Asserts
// the start choice, upload step, PHI warning blocks AI, verbatim-number
// verification with locators, word limit, tables, references, viewer gate,
// and the "What this means" BCG line on the Run tab.
//   node test/run-research-thesis-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9118, CDP = 9518, OUT = '/tmp/stewardmd-research-thesis';
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

const wordsOf = (s) => s.split(/\s+/).filter(Boolean).map((t) => ({ t, x0: 0, y0: 0, x1: 1, y1: 1 }));

// Mocked server state.
let projN = 0, uploadN = 0;
let jobMode = 'phi'; // 'phi' -> job prompts consent_needed; 'clean' -> job succeeds
let requireDraftConsent = false;
let returnEmptyDraft = false;
let journalsFail = false;
let slowSectionPutMs = 0;
const createdProjects = [];
const aiDraftCalls = [];
const journalMatchCalls = [];
const savedSections = [];
const formatCheckCalls = [];
const pageErrors = [];

const JOURNALS = [
  {
    id: 'ijccm', name: 'Indian Journal of Critical Care Medicine (IJCCM)', shortName: 'IJCCM',
    publisher: 'Thieme / ISCCM', specialty: 'Critical Care', region: 'indian', isIndian: true,
    wordLimit: 3000, abstractFormat: 'Structured (Background, Methods, Results, Conclusion), up to 350 words',
    abstractWordLimit: 350, referenceStyle: 'vancouver', openAccess: true,
    apcNote: 'No publication fee / APC funded by society', noFee: true, indexedPubMed: true,
    url: 'https://www.ijccm.org/journal/IJCCM/page/instructions-to-authors'
  },
  {
    id: 'japi', name: 'Journal of The Association of Physicians of India (JAPI)', shortName: 'JAPI',
    publisher: 'Association of Physicians of India', specialty: 'Internal Medicine', region: 'indian', isIndian: true,
    wordLimit: 2000, abstractFormat: 'Structured, up to 250 words', abstractWordLimit: 250,
    referenceStyle: 'vancouver', openAccess: false, apcNote: 'Subscription journal, no publication fee',
    noFee: true, indexedPubMed: true, url: 'https://www.japi.org/instructions-to-authors'
  },
  {
    id: 'lancet', name: 'The Lancet', shortName: 'Lancet', publisher: 'Elsevier', specialty: 'General Medicine',
    region: 'international', isIndian: false, wordLimit: 4500,
    abstractFormat: 'Structured, up to 300 words', abstractWordLimit: 300, referenceStyle: 'vancouver',
    openAccess: true, apcNote: 'APC applies for open access', noFee: false, indexedPubMed: true,
    url: 'https://www.thelancet.com/for-authors'
  },
  {
    id: 'bmjopen', name: 'BMJ Open', shortName: 'BMJ Open', publisher: 'BMJ', specialty: 'General Medicine',
    region: 'international', isIndian: false, wordLimit: 4000,
    abstractFormat: 'Structured, up to 300 words', abstractWordLimit: 300, referenceStyle: 'vancouver',
    openAccess: true, apcNote: 'APC applies', noFee: false, indexedPubMed: true,
    url: 'https://bmjopen.bmj.com/pages/authors'
  },
  {
    id: 'cureus', name: 'Cureus', shortName: 'Cureus', publisher: 'Springer Nature', specialty: 'General Medicine',
    region: 'international', isIndian: false, wordLimit: null,
    abstractFormat: 'Structured, up to 3500 characters', abstractWordLimit: null, referenceStyle: 'vancouver',
    openAccess: true, apcNote: 'Free publishing tier available', noFee: true, indexedPubMed: true,
    url: 'https://www.cureus.com/author_guide'
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
        createdProjects.push(b);
        return send(201, {
          project: {
            id: 'prj_thesis_' + projN,
            title: b.title || 'Untitled',
            studyType: b.studyType || '',
            role: 'owner',
            createdAt: Date.now()
          },
          requestId: 'req_thesis'
        });
      }
      const upMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/pdf-uploads$/);
      if (upMatch && req.method === 'POST') {
        uploadN++;
        return send(201, {
          artifact: {
            id: 'art_' + uploadN,
            projectId: upMatch[1],
            filename: 'thesis.pdf',
            sha256: 'abc',
            bytes: 1024,
            pages: 2,
            status: 'queued',
            jobId: 'job_' + uploadN,
            createdTs: Date.now()
          }
        });
      }
      const jobMatch = p.match(/^\/api\/research\/v1\/jobs\/([^/]+)$/);
      if (jobMatch && req.method === 'GET') {
        if (jobMode === 'phi') {
          return send(200, {
            id: jobMatch[1],
            status: 'failed',
            errorCode: 'consent_needed',
            errorPages: [12, 54],
            maskedCount: 1,
            findings: [{ page: 12, category: 'patient_name', preview: '...admitted to [name]...' }]
          });
        }
        return send(200, { id: jobMatch[1], status: 'succeeded' });
      }
      const resMatch = p.match(/^\/api\/research\/v1\/artifacts\/([^/]+)\/result$/);
      if (resMatch && req.method === 'GET') {
        return send(200, {
          pages: [
            { n: 12, width: 612, height: 792, words: wordsOf('Observations were collected across participating centres.'), ocr: false },
            { n: 54, width: 612, height: 792, words: wordsOf('Table 7 reports the pooled risk ratio 0.49 with 95% CI 0.34 to 0.70 across 13 trials and 123 people.'), ocr: false }
          ],
          ocr: false
        });
      }
      const aiMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/ai-draft$/);
      if (aiMatch && req.method === 'POST') {
        aiDraftCalls.push(b);
        if (requireDraftConsent && !(b && b.input && b.input.phiConsent && b.input.phiConsent.confirmed)) {
          return send(409, {
            error: { code: 'consent_needed', message: 'Please confirm there are no patient names left on the flagged pages before AI drafting.' },
            pages: [2],
            maskedCount: 1,
            findings: [{ page: 2, category: 'patient_name', preview: '...admitted to the [name]...' }]
          });
        }
        if (returnEmptyDraft) {
          return send(200, { draft: {}, model: 'empty-test' });
        }
        return send(200, {
          draft: {
            sections: [
              { id: 'abstract', heading: 'Abstract', text: 'Background: we studied BCG. Methods: a review. Results: risk ratio 0.49. Conclusion: BCG helps.' },
              { id: 'introduction', heading: 'Introduction', text: 'Tuberculosis remains common. BCG is widely used.' },
              { id: 'methods', heading: 'Methods', text: 'We searched PubMed and pooled 13 trials.' },
              { id: 'results', heading: 'Results', text: 'The pooled risk ratio was 0.49 (95% CI 0.34 to 0.70). The adjusted estimate was 0.77 in the subgroup.' },
              { id: 'discussion', heading: 'Discussion', text: 'BCG appears protective. Limitations include heterogeneity.' },
              { id: 'conclusion', heading: 'Conclusion', text: 'BCG vaccination remains beneficial across 13 trials.' }
            ],
            tables: [
              { id: 't1', caption: 'Main results', reason: 'It carries the pooled estimate.', score: 9 },
              { id: 't2', caption: 'Study characteristics', reason: 'Readers need the trial list.', score: 8 },
              { id: 't3', caption: 'Risk of bias', reason: 'It supports the GRADE rating.', score: 7 },
              { id: 't4', caption: 'Appendix search strings', reason: 'Rarely needed in the paper.', score: 2 }
            ],
            references: [
              { authors: 'Colditz GA', year: '1994', title: 'Efficacy of BCG vaccine', journal: 'JAMA', volume: '271', pages: '698', doi: '10.1001/jama.1994.03510340058033', pmid: '8126532' },
              { authors: 'WHO', year: '2023', title: 'BCG position paper', journal: 'Weekly Epidemiol Rec' }
            ]
          },
          requestId: 'req_draft'
        });
      }
      if (p === '/api/research/v1/journals' && req.method === 'GET') {
        if (journalsFail) return send(500, { error: { code: 'server_error', message: 'Journal list unavailable' } });
        const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().toLowerCase();
        let list = JOURNALS;
        if (q) {
          list = list.filter((j) =>
            j.name.toLowerCase().includes(q) ||
            (j.shortName && j.shortName.toLowerCase().includes(q)) ||
            (j.specialty && j.specialty.toLowerCase().includes(q)));
        }
        return send(200, { journals: list });
      }
      if (p === '/api/research/v1/journals/match' && req.method === 'POST') {
        journalMatchCalls.push(b);
        if (journalsFail) return send(500, { error: { code: 'server_error', message: 'Journal match unavailable' } });
        return send(200, {
          matches: [
            { score: 9, journal: JOURNALS[0] },
            { score: 7, journal: JOURNALS[1] }
          ]
        });
      }
      const manMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/manuscript$/);
      if (manMatch && req.method === 'GET') {
        const secs = savedSections.map((s) => ({ id: s.sid, heading: (s.body && s.body.heading) || s.sid, text: (s.body && s.body.text) || '' }));
        return send(200, { manuscript: { version: 1, status: 'draft', sections: secs } });
      }
      if (/\/manuscript\/versions$/.test(p) && req.method === 'GET') {
        return send(200, { versions: [] });
      }
      if (/\/checklist-snapshot$/.test(p) && req.method === 'GET') {
        return send(200, { snapshot: {} });
      }
      if (/\/format-check$/.test(p) && req.method === 'GET') {
        const jid = (new URL(req.url, 'http://x').searchParams.get('journal') || '').trim();
        formatCheckCalls.push(jid);
        const found = JOURNALS.find((j) => j.id === jid);
        return send(200, {
          journalId: jid,
          journalName: found ? (found.shortName || found.name) : jid.toUpperCase(),
          checks: [{ check: 'word_count', status: 'pass', label: 'Word count', detail: savedSections.length + ' sections saved' }]
        });
      }
      const secMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/manuscript\/sections\/([^/]+)$/);
      if (secMatch && req.method === 'PUT') {
        savedSections.push({ sid: secMatch[2], body: b });
        if (slowSectionPutMs > 0) {
          setTimeout(() => send(200, { ok: true, tokens: {} }), slowSectionPutMs);
          return;
        }
        return send(200, { ok: true, tokens: {} });
      }
      if (p === '/api/research/v1/checklists' && req.method === 'GET') {
        return send(200, { checklists: [{ id: 'strobe', name: 'STROBE' }, { id: 'prisma2020', name: 'PRISMA 2020' }] });
      }
      const clMatch = p.match(/^\/api\/research\/v1\/checklists\/([^/]+)$/);
      if (clMatch && req.method === 'GET') {
        return send(200, { checklist: { id: clMatch[1], title: clMatch[1], items: [{ num: '1', text: 'Title' }] } });
      }
      const manualMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/checklist-manual\/([^/]+)$/);
      if (manualMatch && req.method === 'GET') {
        return send(200, { entries: [] });
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
  `--user-data-dir=/tmp/rmd-thesis-chrome-${process.pid}`,
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

  const uploadPdf = () => ev(`(()=>{
    const inp=document.querySelector('#rmdThesisFile');
    if(!inp)return false;
    const f=new File([new Uint8Array([37,80,68,70,45,49,46,52])],'thesis.pdf',{type:'application/pdf'});
    const dt=new DataTransfer();
    dt.items.add(f);
    inp.files=dt.files;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);

  const uploadRealPdf = () => ev(`(()=>{
    const inp=document.querySelector('#rmdThesisFile');
    if(!inp)return false;
    const objs=[
      '1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n',
      '2 0 obj\\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\\nendobj\\n',
      '3 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\\nendobj\\n',
      '4 0 obj\\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\\nendobj\\n'
    ];
    const stream='BT /F1 12 Tf 72 720 Td (Table 7 reports the pooled risk ratio 0.49 across 120 patients in 13 trials.) Tj ET';
    objs.push('5 0 obj\\n<< /Length '+stream.length+' >>\\nstream\\n'+stream+'\\nendstream\\nendobj\\n');
    let pdf='%PDF-1.4\\n';
    const offs=[0];
    for(const o of objs){ offs.push(pdf.length); pdf+=o; }
    const xref=pdf.length;
    pdf+='xref\\n0 '+(objs.length+1)+'\\n0000000000 65535 f \\n';
    for(let i=1;i<=objs.length;i++) pdf+=String(offs[i]).padStart(10,'0')+' 00000 n \\n';
    pdf+='trailer\\n<< /Size '+(objs.length+1)+' /Root 1 0 R >>\\nstartxref\\n'+xref+'\\n%%EOF';
    const f=new File([new TextEncoder().encode(pdf)],'FinalThesisReal.pdf',{type:'application/pdf'});
    const dt=new DataTransfer();
    dt.items.add(f);
    inp.files=dt.files;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);

  const uploadDocx = (opts = {}) => ev(`(async (opts)=>{
    const inp=document.querySelector('#rmdThesisFile');
    if(!inp)return false;
    const enc=new TextEncoder();
    const xml=opts.xml || ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
      +'<w:p><w:r><w:t>Observational thesis cohort of BCG vaccination outcomes.</w:t></w:r></w:p>'
      +'<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      +'<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table 7</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pooled risk ratio 0.49 (95% CI 0.34 to 0.70) across 120 patients.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
      +'</w:body></w:document>');
    const name=enc.encode('word/document.xml');
    const rawBody=enc.encode(xml);
    let body = rawBody;
    let method = 0;
    if (opts.deflate && window.CompressionStream) {
      method = 8;
      const cs = new CompressionStream('deflate-raw');
      const stream = new Blob([rawBody]).stream().pipeThrough(cs);
      body = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const lh=new Uint8Array(30+name.length);
    const dvL=new DataView(lh.buffer);
    dvL.setUint32(0,0x04034b50,true); dvL.setUint16(4,20,true); dvL.setUint16(8,method,true);
    dvL.setUint32(18,body.length,true); dvL.setUint32(22,rawBody.length,true); dvL.setUint16(26,name.length,true);
    lh.set(name,30);
    const ch=new Uint8Array(46+name.length);
    const dvC=new DataView(ch.buffer);
    dvC.setUint32(0,0x02014b50,true); dvC.setUint16(4,20,true); dvC.setUint16(6,20,true); dvC.setUint16(10,method,true);
    dvC.setUint32(20,body.length,true); dvC.setUint32(24,rawBody.length,true); dvC.setUint16(28,name.length,true);
    dvC.setUint32(42,0,true); ch.set(name,46);
    const eocd=new Uint8Array(22);
    const dvE=new DataView(eocd.buffer);
    dvE.setUint32(0,0x06054b50,true); dvE.setUint16(8,1,true); dvE.setUint16(10,1,true);
    dvE.setUint32(12,ch.length,true); dvE.setUint32(16,lh.length+body.length,true);
    const out=new Uint8Array(lh.length+body.length+ch.length+eocd.length);
    out.set(lh,0); out.set(body,lh.length); out.set(ch,lh.length+body.length); out.set(eocd,lh.length+body.length+ch.length);
    const f=new File([out], opts.filename || 'FinalThesis1.docx',{type: opts.mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    const dt=new DataTransfer(); dt.items.add(f); inp.files=dt.files;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })(${JSON.stringify(opts)})`);

  const syntheticThesisXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + '<w:p><w:r><w:t>Background: Severe sepsis cohort overview.</w:t></w:r></w:p>'
    + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    + '<w:p><w:r><w:t>Patients admitted to the Intensive Care Unit during 2024. Refs: Kumar A, Rao B.</w:t></w:r></w:p>'
    + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    + '<w:p><w:r><w:t>Coordinator contact phone 9876543210 for queries.</w:t></w:r></w:p>'
    + '</w:body></w:document>';

const resetToSeed = () => ev(`(()=>{
  localStorage.removeItem('smd_research_state_v1');
  localStorage.removeItem('smd_rmd_help');
  localStorage.removeItem('smd_rmd_seen');
  localStorage.removeItem('smd_rmd_thesis_v1');
  localStorage.removeItem('smd_rmd_checklist_guide_v1');
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
    if (m.method === 'Runtime.exceptionThrown' && m.params && m.params.exceptionDetails) {
      pageErrors.push(m.params.exceptionDetails.text || 'Runtime exception');
    }
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable');

  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH_THESIS', 30000), 'app loaded with ResearchMD and the thesis flow');

  // 1. Start choice present.
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('.rmd-start-screen')`, 5000), 'start screen rendered');
  ok(await ev(`document.querySelectorAll('[data-rmd-start-choice]').length === 9`), 'nine publication choices offered');
  ok(/Turn my thesis into a journal paper/.test(await text('.rmd-start-screen')), 'thesis choice present');
  ok(/Upload your MD\/MS\/DNB thesis/.test(await text('.rmd-start-screen')), 'thesis choice explains the upload');
  await shot('phone-375-start');

  // 2. Create the thesis project, land on the upload step.
  await click('[data-rmd-start-choice="thesis"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='My thesis paper';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_thesis_1'`, 5000), 'project created on the server');
  ok(createdProjects[0].studyType === 'Thesis to Journal Article', 'create payload carries the thesis study type');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'upload step rendered with a file input');
  ok(/Upload your thesis/.test(await text('#rmdScreenBody')), 'upload step asks for the thesis');
  ok(/Step 1 of 9/.test(await text('#rmdStepBanner')), 'banner reads Step 1 of 9 for the thesis journey');
  await shot('phone-375-upload');

  // 3. Soft hits / phone number open the calm consent sheet instead of a red block.
  ok(await uploadDocx({ xml: syntheticThesisXml, filename: 'ThesisSoft.docx' }), 'synthetic 3-page DOCX uploaded');
  ok(await until(`!!document.querySelector('#rmdThesisConsentSheet[open]')`, 8000), 'calm consent sheet opened on soft PHI finding');
  ok(await ev(`!document.querySelector('#rmdThesisPhi')`), 'no red PHI block rendered');
  const consentText = await text('#rmdThesisConsentSheet');
  ok(/Check for patient details/.test(consentText), 'consent sheet title matches spec');
  ok(/We looked for patient details on these pages: 2\./.test(consentText), 'consent sheet names page 2');
  ok(/1 phone number or ID number hidden automatically\./.test(consentText), 'consent sheet reports masked count');
  ok(await ev(`!!document.querySelector('#rmdThesisConsentConfirm') && !!document.querySelector('#rmdThesisConsentReupload')`), 'consent sheet renders both buttons');
  ok(/I confirm, continue/.test(await text('#rmdThesisConsentConfirm')), 'confirm button label correct');
  ok(/Upload a different file/.test(await text('#rmdThesisConsentReupload')), 'reupload button label correct');
  ok(aiDraftCalls.length === 0, 'no AI call made before confirmation');
  await shot('phone-375-phi');

  // Clicking "Upload a different file" resets back to file input.
  await click('#rmdThesisConsentReupload');
  ok(await until(`!document.querySelector('#rmdThesisConsentSheet[open]') && !!document.querySelector('#rmdThesisFile')`, 5000), 'Upload a different file closes sheet and returns file input');

  // Re-upload synthetic DOCX and click "I confirm, continue" -> consent recorded with timestamp & phone masked.
  ok(await uploadDocx({ xml: syntheticThesisXml, filename: 'ThesisSoft.docx' }), 'synthetic 3-page DOCX re-uploaded');
  ok(await until(`!!document.querySelector('#rmdThesisConsentSheet[open]')`, 8000), 'consent sheet re-opened');
  await click('#rmdThesisConsentConfirm');
  ok(await until(`!document.querySelector('#rmdThesisConsentSheet[open]')`, 5000), 'confirm closes consent sheet');
  ok(await ev(`(()=>{const t=JSON.parse(localStorage.getItem('smd_rmd_thesis_v1')||'{}')['prj_thesis_1']||{};return !!(t.phiConsent&&t.phiConsent.confirmed&&t.phiConsent.timestamp)&&t.pages&&t.pages[2]&&/\\[phone\\]/.test(t.pages[2].text)&&!/9876543210/.test(t.pages[2].text);})()`), 'consent recorded with timestamp and phone masked in thesis state');

  // 4. Clean re-upload succeeds with NO consent sheet shown.
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back after re-upload');
  jobMode = 'clean';
  ok(await uploadPdf(), 'clean thesis PDF dispatched');
  ok(await until(`/Thesis read/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'clean thesis read and page count shown');
  ok(await ev(`!document.querySelector('#rmdThesisConsentSheet')`), 'no consent sheet when nothing is found');
  await shot('phone-375-read');

  // 4b. Real selectable-text PDF read directly on-device via pdf.js (0 extra server upload calls).
  const beforeRealPdfUploads = uploadN;
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back for real PDF check');
  ok(await uploadRealPdf(), 'real multi-object PDF selected');
  ok(await until(`/FinalThesisReal\\.pdf was read: 1 page\\(s\\)/.test(document.querySelector('#rmdScreenBody').innerText)`, 10000), 'real PDF read directly on-device with page count');
  ok(uploadN === beforeRealPdfUploads, 'selectable-text PDF required zero server upload calls');

  // 4c. Real Word (.docx) thesis read natively on-device with deflate compression (0 extra server upload calls).
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back for Word DOCX check');
  ok(await uploadDocx({ deflate: true }), 'real Word (.docx) thesis with deflate compression selected');
  ok(await until(`/FinalThesis1\\.docx was read: 2 page\\(s\\)/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'DOCX read natively on-device with exact 2 page count');
  ok(uploadN === beforeRealPdfUploads, 'DOCX read required zero server upload calls');
  ok(await ev(`(()=>{const t=JSON.parse(localStorage.getItem('smd_rmd_thesis_v1')||'{}')['prj_thesis_1']||{};return t.pages&&t.pages.length===2&&/Table 7/.test(t.pages[1].text);})()`), 'DOCX extracted table text cleanly onto page 2');

  // 4d. DOCX with alternate MIME type (application/docx) supported.
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back for alternate DOCX MIME check');
  ok(await uploadDocx({ deflate: true, filename: 'ThesisAlt.docx', mime: 'application/docx' }), 'alternate MIME DOCX selected');
  ok(await until(`/ThesisAlt\\.docx was read: 2 page\\(s\\)/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'alternate MIME DOCX read successfully');

  // 4e. Legacy binary .doc triggers informative warning banner.
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back for legacy .doc check');
  await ev(`(()=>{
    const inp=document.querySelector('#rmdThesisFile');
    const f=new File([new Uint8Array([0xD0,0xCF,0x11,0xE0])],'ThesisOld.doc',{type:'application/msword'});
    const dt=new DataTransfer(); dt.items.add(f); inp.files=dt.files;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  ok(await until(`/Older Word \\(\\.doc\\) files are binary format/.test(document.querySelector('#rmdThesisMsg').innerText)`, 5000), 'legacy .doc triggers informative warning banner');

  // Restore clean server result pages (page 54, Table 7) for Step 5-12 assertions or verify end-to-end
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back before continuing');
  jobMode = 'clean';
  ok(await uploadPdf(), 'mock clean PDF restores page 54 fixture');
  ok(await until(`/Thesis read/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'page 54 fixture loaded');

  // 5. Paper type step.
  await click('[data-rmd-thesis-next="thesis-type"]');
  ok(await until(`/Pick the paper type/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'paper type step rendered');
  ok(await ev(`document.querySelectorAll('[data-rmd-type]').length === 9`), 'nine paper types offered');
  ok(/STROBE/.test(await text('#rmdScreenBody')), 'STROBE reporting checklist named');
  await click('[data-rmd-type="obs"]');
  ok(await ev(`(JSON.parse(localStorage.getItem('smd_rmd_checklist_guide_v1')||'{}'))['prj_thesis_1'] === 'strobe'`), 'chosen checklist stored as the project preference');
  await shot('phone-375-type');

  // 6. Journal step: catalogue picker, search, chips, best matches.
  await click('[data-rmd-thesis-next="thesis-journal"]');
  ok(await until(`/Pick the target journal/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'journal step rendered');
  ok(/3,000 words/.test(await text('#rmdScreenBody')), 'default journal shows the 3,000 word limit');
  ok(/structured/i.test(await text('#rmdScreenBody')), 'default journal shows the structured abstract');
  ok(await until(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 5`, 5000), 'five catalogue journals listed');
  ok(await ev(`(()=>{const t=document.querySelector('#rmdJournalResults').innerText;return ['IJCCM','JAPI','The Lancet','BMJ Open','Cureus'].every((n)=>t.includes(n));})()`), 'all five catalogue names render');
  ok(await until(`/Best match for your study/.test(document.querySelector('#rmdJournalResults').innerText)`, 5000), 'best match section is shown');
  ok(await ev(`(()=>{const g=document.querySelectorAll('#rmdJournalResults .rmd-journal-group');return g.length>0 && /Best match/.test(g[0].textContent);})()`), 'best match group renders before all journals');
  ok(await ev(`document.querySelector('#rmdJournalResults [data-rmd-journal-id]').getAttribute('data-rmd-journal-id') === 'ijccm'`), 'IJCCM is the first best match');
  ok(await ev(`(()=>{const b=document.querySelector('#rmdJournalResults [data-rmd-journal-id="ijccm"]');const a=document.querySelector('#rmdJournalResults a.rmd-journal-link');return b.tagName==='BUTTON'&&!b.contains(a);})()`), 'journal row keeps the pick button and guidelines link separate');
  ok(/Word limit: Check the author guidelines/.test(await text('#rmdJournalResults')), 'null word limit says Check the author guidelines');
  ok(await ev(`(()=>{const a=document.querySelector('#rmdJournalResults a.rmd-journal-link');return !!a && a.target==='_blank' && /^https?:/.test(a.href) && /Author guidelines/.test(a.textContent);})()`), 'author guidelines link opens outside the app');
  ok(Array.isArray(journalMatchCalls[0] && journalMatchCalls[0].keywords), 'journal match request sends a keywords array');

  // Search by short name.
  await ev(`(()=>{const i=document.getElementById('rmdJournalSearch');i.value='IJCCM';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  ok(await until(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 1`, 3000), 'search IJCCM narrows the list to one journal');
  ok(/Indian Journal of Critical Care Medicine/.test(await text('#rmdJournalResults')), 'search finds IJCCM by its short name');
  await ev(`(()=>{const i=document.getElementById('rmdJournalSearch');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  ok(await until(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 5`, 3000), 'clearing the search restores all journals');

  // Filter chips combine with AND semantics.
  await click('[data-rmd-jchip="indian"]');
  ok(await until(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 2`, 3000), 'Indian chip shows two Indian journals');
  ok(await ev(`(()=>{const t=document.querySelector('#rmdJournalResults').innerText;return t.includes('IJCCM')&&t.includes('JAPI')&&!t.includes('The Lancet');})()`), 'Indian chip excludes international journals');
  await click('[data-rmd-jchip="open"]');
  ok(await until(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 1`, 3000), 'Indian and Open access chips combine');
  ok(/IJCCM/.test(await text('#rmdJournalResults')), 'combined chips keep IJCCM');
  await click('[data-rmd-jchip="indian"]');
  await click('[data-rmd-jchip="open"]');
  ok(await until(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 5`, 3000), 'clearing both chips restores all journals');
  ok(await ev(`document.getElementById('rmdJournalSearch').offsetHeight >= 44`), 'journal search meets the 44px touch target');
  ok(await ev(`document.querySelector('[data-rmd-jchip="indian"]').offsetHeight >= 44`), 'journal filter chip meets the 44px touch target');
  ok(await ev(`document.querySelector('#rmdJournalResults [data-rmd-journal-id]').offsetHeight >= 44`), 'journal row meets the 44px touch target');
  ok(await ev(`document.querySelector('#rmdJournalResults a.rmd-journal-link').offsetHeight >= 44`), 'author guidelines link meets the 44px touch target');
  const journalContrast = async () => JSON.parse(await ev(`(()=>{
    function rgb(s){const m=String(s).match(/[\\d.]+/g);return m?m.slice(0,3).map(Number):[0,0,0];}
    function lum(c){const a=c.map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
    function ratio(a,b){const L1=lum(a),L2=lum(b);return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);}
    const item=document.querySelector('#rmdJournalResults .rmd-journal-item');
    const name=document.querySelector('#rmdJournalResults .rmd-journal-name');
    const specs=document.querySelector('#rmdJournalResults .rmd-journal-specs');
    const bg=rgb(getComputedStyle(item).backgroundColor);
    return JSON.stringify({name:ratio(rgb(getComputedStyle(name).color),bg),muted:ratio(rgb(getComputedStyle(specs).color),bg)});
  })()`));
  const lightContrast = await journalContrast();
  ok(lightContrast.name >= 4.5 && lightContrast.muted >= 4.5, 'journal row text meets 4.5:1 in light mode');
  await ev(`(()=>{document.body.classList.add('dark');localStorage.setItem('stewardmd_theme','dark');return true})()`);
  await sleep(200);
  ok(await ev(`document.body.classList.contains('dark')`), 'journal picker renders in dark mode');
  const darkContrast = await journalContrast();
  ok(darkContrast.name >= 4.5 && darkContrast.muted >= 4.5, 'journal row text meets 4.5:1 in dark mode');
  await shot('phone-375-journal-dark');
  await ev(`(()=>{document.body.classList.remove('dark');localStorage.setItem('stewardmd_theme','light');return true})()`);
  await sleep(200);
  await shot('phone-375-journal');

  // Journal picker at phone and tablet widths.
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), '390x844 journal picker no horizontal scroll');
  await shot('phone-390-journal');
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: false });
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), '1024x1366 journal picker no horizontal scroll');
  await shot('tablet-1024-journal');
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await sleep(200);

  // Choosing a catalogue journal drives the draft word limit and updates project targetJournal.
  await ev(`(()=>{const b=document.querySelector('[data-rmd-journal-id="japi"]');if(!b)return false;b.click();return true})()`);
  ok(await ev(`(()=>{const t=JSON.parse(localStorage.getItem('smd_rmd_thesis_v1')||'{}')['prj_thesis_1']||{};return t.journal&&t.journal.id==='japi'&&t.journal.wordLimit===2000;})()`), 'choosing JAPI stores its 2,000 word limit');
  ok(await ev(`(()=>{const p=SMD_RESEARCH.store.getActiveProject();return !!p && p.targetJournal==='japi';})()`), 'choosing JAPI sets proj.targetJournal on store project');
  ok(await ev(`document.querySelector('[data-rmd-journal-id="japi"]').getAttribute('aria-pressed') === 'true'`), 'chosen journal is marked pressed');
  await click('[data-rmd-thesis-next="thesis-draft"]');
  ok(await until(`/Word limit: 2000 words/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'draft uses the chosen journal word limit');
  await ev(`SMD_RESEARCH.navigate('thesis-journal',{});1`);
  ok(await until(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 5`, 5000), 'journal step returns to the catalogue');

  // Other journal stores the values the user typed.
  await click('[data-rmd-journal="other"]');
  ok(await until(`!document.querySelector('#rmdJournalCustom').hasAttribute('hidden')`, 3000), 'Other journal opens the custom form');
  ok(await ev(`document.getElementById('rmdJournalCustomName').offsetHeight >= 44`), 'custom journal name input meets the 44px touch target');
  ok(await ev(`document.querySelector('#rmdJournalCustom .rmd-btn-primary').offsetHeight >= 44`), 'custom journal save button meets the 44px touch target');
  await ev(`(()=>{
    document.getElementById('rmdJournalCustomName').value='Journal of Test Medicine';
    document.getElementById('rmdJournalCustomWords').value='1800';
    document.getElementById('rmdJournalCustomAbstract').value='Structured abstract up to 200 words';
    document.getElementById('rmdJournalCustomRefs').value='apa';
    document.getElementById('rmdJournalCustomForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    return true;
  })()`);
  ok(await ev(`(()=>{const t=JSON.parse(localStorage.getItem('smd_rmd_thesis_v1')||'{}')['prj_thesis_1']||{};const j=t.journal||{};return j.custom===true&&j.name==='Journal of Test Medicine'&&j.wordLimit===1800&&j.abstractFormat==='Structured abstract up to 200 words'&&j.referenceStyle==='apa';})()`), 'Other journal saves custom values');
  ok(await ev(`document.querySelector('[data-rmd-journal="other"]').getAttribute('aria-pressed') === 'true'`), 'custom journal is marked selected');

  // Offline fallback keeps the default and Other journal with a plain note.
  journalsFail = true;
  await ev(`SMD_RESEARCH.navigate('thesis-journal',{});1`);
  ok(await until(`/journal list could not load/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'offline journal lookup shows the plain fallback note');
  ok(await ev(`!!document.querySelector('[data-rmd-journal="default"]') && !!document.querySelector('[data-rmd-journal="other"]')`), 'offline fallback keeps the default and Other journal');
  ok(await ev(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 0`), 'offline fallback hides catalogue rows');
  journalsFail = false;
  await ev(`SMD_RESEARCH.navigate('thesis-journal',{});1`);
  ok(await until(`document.querySelectorAll('#rmdJournalResults [data-rmd-journal-id]').length === 5`, 5000), 'journal list returns after reconnect');

  // Reselect JAPI for the draft flow.
  await ev(`(()=>{const b=document.querySelector('[data-rmd-journal-id="japi"]');if(!b)return false;b.click();return true})()`);
  ok(await ev(`(()=>{const t=JSON.parse(localStorage.getItem('smd_rmd_thesis_v1')||'{}')['prj_thesis_1']||{};return t.journal&&t.journal.id==='japi';})()`), 'JAPI reselected for the draft flow');

  // 7. Draft step: empty AI draft -> error + retry (no pills over 0-word boxes); then 409 consent_needed -> consent sheet -> confirm -> draft rendered with number verification & locators.
  await click('[data-rmd-thesis-next="thesis-draft"]');
  ok(await until(`!!document.querySelector('[data-rmd-ai="ask"]')`, 5000), 'Ask MaiK offered on the draft step');
  returnEmptyDraft = true;
  await click('[data-rmd-ai="ask"]');
  ok(await until(`!!document.querySelector('.rmd-banner-error')`, 5000), 'empty AI draft shows error banner');
  ok(await ev(`document.querySelectorAll('.rmd-ai-note').length === 0`), 'no Drafted by MaiK pills shown on 0-word sections');
  ok(await ev(`!!document.querySelector('[data-rmd="ai-retry"]')`), 'retry button shown on empty AI draft error');
  returnEmptyDraft = false;
  requireDraftConsent = true;
  const callsBeforeConsent = aiDraftCalls.length;
  await click('[data-rmd="ai-retry"]');
  ok(await until(`!!document.querySelector('#rmdThesisConsentSheet[open]')`, 8000), 'consent sheet opened on 409 consent_needed from ai-retry');
  const draftConsentTxt = await text('#rmdThesisConsentSheet');
  ok(/pages: 2\./.test(draftConsentTxt) && !!await ev(`document.querySelector('#rmdThesisConsentConfirm')`) && !!await ev(`document.querySelector('#rmdThesisConsentReupload')`), 'draft consent sheet shows pages and both buttons');
  await click('#rmdThesisConsentConfirm');
  ok(await until(`!!document.querySelector('.rmd-thesis-section-text')`, 8000), 'I confirm, continue proceeds automatically to render draft');
  requireDraftConsent = false;
  ok(aiDraftCalls.length === callsBeforeConsent + 2, '409 preflight followed by 1 consented AI call');
  const lastAiCall = aiDraftCalls[aiDraftCalls.length - 1];
  ok(lastAiCall.task === 'thesis_to_paper', 'AI call uses the thesis_to_paper task');
  ok(!!(lastAiCall.input && lastAiCall.input.phiConsent && lastAiCall.input.phiConsent.confirmed), 'second AI call sends confirmed phiConsent');
  ok(!!lastAiCall.input && Array.isArray(lastAiCall.input.pages) && lastAiCall.input.pages.length > 0, 'AI call carries the thesis page text');
  ok(await ev(`document.querySelectorAll('.rmd-ai-note').length === 6`), 'Drafted by MaiK pills appear on all 6 populated sections');
  const draftText = await text('#rmdDraftBody');
  ok(/\[check this number\]/.test(draftText), 'invented number sentence flagged');
  ok(!/0\.77/.test(draftText), 'invented number removed from the draft');
  ok(/0\.49/.test(draftText), 'verbatim number kept');
  ok(/of 2000 words/.test(draftText), 'word limit line uses the chosen journal');
  ok(await ev(`!!document.querySelector('.rmd-thesis-num[data-page="54"]')`), 'kept number carries a page locator');
  ok(await ev(`(()=>{const e=document.querySelector('.rmd-thesis-section-text .rmd-thesis-num');return !!e && e.textContent==='0.49' && e.getAttribute('data-page')==='54'})()`), 'abstract number wrapped with its thesis locator');
  await click('.rmd-thesis-num[data-page="54"]');
  ok(await until(`!!document.querySelector('.rmd-thesis-pop')`, 3000), 'number source popover opens');
  // let the app-wide text scrubber (emoji-icons.js) flush before reading: the locator must survive it
  await sleep(150);
  ok(/From your thesis, page 54, Table 7/.test(await text('.rmd-thesis-pop')), 'popover names the thesis page and table');
  await shot('phone-375-draft');
  await click('.rmd-thesis-pop-close');

  // 8. Save to the manuscript.
  await click('#rmdDraftSave');
  ok(await until(`!!document.querySelector('[data-rmd-table]')`, 8000), 'save lands on the tables step');
  ok(savedSections.length >= 5, 'all five sections PUT to the manuscript');
  ok(savedSections.every((s) => s.body && typeof s.body.text === 'string' && s.body.version === 1), 'section saves carry text and version');

  // 9. Tables: three suggested, cap enforced.
  ok(await ev(`document.querySelectorAll('[data-rmd-table]').length === 4`), 'four tables listed');
  ok(await ev(`document.querySelectorAll('[data-rmd-table]:checked').length === 3`), 'MaiK suggests three tables');
  await ev(`(()=>{const b=document.querySelector('[data-rmd-table="t4"]');b.click();return true})()`);
  ok(await ev(`!document.querySelector('[data-rmd-table="t4"]').checked`), 'a fourth table cannot be ticked');
  await shot('phone-375-tables');

  // 10. References: journal style + check flag.
  await click('[data-rmd-thesis-next="thesis-refs"]');
  ok(await until(`/Check the references/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'references step rendered');
  ok(/\[check this reference\]/.test(await text('#rmdScreenBody')), 'reference without DOI or PMID flagged');
  ok(/doi: 10\.1001/.test(await text('#rmdScreenBody')), 'DOI shown in the formatted reference');
  await shot('phone-375-refs');

  // 11. References advances to Manuscript (Step 7 of 9), then Checklist (Step 8 of 9), then Ready (Step 9 of 9).
  await click('[data-rmd-thesis-next="manuscript"]');
  ok(await until(`(()=>{const b=document.querySelector('#rmdStepBanner');return !!b && /Step 7 of 9/.test(b.innerText)})()`, 5000), 'banner reads Step 7 of 9 at the manuscript step');
  ok(await until(`!!document.querySelector('[data-rmd="manuscript-export"]')`, 5000), 'manuscript screen exposes DOCX export in thesis journey');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(150);
  await ev(`SMD_RESEARCH.navigate('manuscript',{});1`);
  ok(await until(`!!document.querySelector('.rmd-tab-active[data-rmd-tab="manuscript"]')`, 5000), 'manuscript tab active at 390px');
  ok(await ev(`(()=>{const nav=document.querySelector('.rmd-shell-tabs');const act=nav&&nav.querySelector('.rmd-tab-active');if(!nav||!act)return false;const nr=nav.getBoundingClientRect();const ar=act.getBoundingClientRect();return nav.scrollLeft>0 && ar.left>=nr.left-2 && ar.right<=nr.right+2;})()`), 'active Manuscript pill scrolls cleanly into view at 390px');

  await ev(`SMD_RESEARCH.navigate('checklist',{});1`);
  ok(await until(`(()=>{const b=document.querySelector('#rmdStepBanner');return !!b && /Step 8 of 9/.test(b.innerText)})()`, 5000), 'banner reads Step 8 of 9 at the checklist');

  await ev(`SMD_RESEARCH.navigate('ready',{});1`);
  ok(await until(`(()=>{const b=document.querySelector('#rmdStepBanner');return !!b && /Step 9 of 9/.test(b.innerText)})()`, 5000), 'banner reads Step 9 of 9 at ready');
  ok(await until(`!!document.querySelector('[data-rmd="format-check-card"]')`, 5000), 'format check card renders on ready step');
  ok(formatCheckCalls.includes('japi') && !formatCheckCalls.includes('jama'), 'ready screen checks format against chosen journal japi, not JAMA');
  ok(/ready for JAPI\?/.test(await text('[data-rmd="format-check-card"]')), 'format check card names JAPI');
  ok(await ev(`(()=>{const nav=document.querySelector('.rmd-shell-tabs');const act=nav&&nav.querySelector('.rmd-tab-active');if(!nav||!act)return false;const nr=nav.getBoundingClientRect();const ar=act.getBoundingClientRect();return nav.scrollLeft>0 && ar.left>=nr.left-2 && ar.right<=nr.right+2;})()`), 'active Ready pill scrolls cleanly into view at 390px');
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await sleep(150);

  // 11a. Regression: clicking Ready while Save to manuscript PUTs are still in-flight stays on Ready (never hijacked to thesis-tables).
  slowSectionPutMs = 350;
  await ev(`SMD_RESEARCH.navigate('thesis-draft',{});1`);
  ok(await until(`!!document.querySelector('#rmdDraftSave')`, 5000), 'Draft tab ready before slow save regression check');
  await click('#rmdDraftSave');
  await sleep(40);
  await click('[data-rmd-tab="ready"]');
  await sleep(2250);
  ok(await until(`!!document.querySelector('.rmd-ready-screen') && !!document.querySelector('[data-rmd="format-check-card"]')`, 5000), 'Ready screen stays rendered with format-check card even after in-flight saveDraft finishes');
  slowSectionPutMs = 0;

  // 11b. "< ResearchMD" header navigation from Draft tab lands on project list; X closes ResearchMD.
  await ev(`SMD_RESEARCH.navigate('thesis-draft',{});1`);
  ok(await until(`!!document.querySelector('[data-rmd="back"]') && !!document.querySelector('.rmd-thesis-screen')`, 5000), 'back button rendered on Draft tab');
  ok(/ResearchMD/.test(await text('[data-rmd="back"]')), 'header back button is labelled ResearchMD');
  ok(await ev(`document.querySelector('[data-rmd="back"]').offsetHeight >= 44`), 'back button meets 44px touch target (offsetHeight=' + await ev(`document.querySelector('[data-rmd="back"]').offsetHeight`) + ', computedMin=' + await ev(`getComputedStyle(document.querySelector('[data-rmd="back"]')).minHeight`) + ')');
  await click('[data-rmd="back"]');
  ok(await until(`!!document.querySelector('.rmd-projects-screen') || !!document.querySelector('[data-rmd-project]')`, 5000), '< ResearchMD from Draft tab lands on the ResearchMD project list');
  ok(await ev(`!!document.querySelector('[data-rmd="close"]')`), 'X close button present on project list');
  await click('[data-rmd="close"]');
  ok(await until(`document.querySelector('#researchMD').hidden === true`, 5000), 'X closes ResearchMD');
  await ev(`SMD_RESEARCH.open({screen:'projects'});1`);
  ok(await until(`document.querySelector('#researchMD').hidden === false`, 5000), 're-opened ResearchMD');
  await ev(`(()=>{const st=SMD_RESEARCH.store.getState();const p=(st.projects||[]).find(x=>x.serverId==='prj_thesis_1'||x.id==='prj_thesis_1');if(p)SMD_RESEARCH.store.setActiveProject(p.id);return true})()`);

  // 12. Viewer cannot run AI.
  await ev(`(()=>{const p=SMD_RESEARCH.store.getActiveProject();p.role='viewer';SMD_RESEARCH.navigate('thesis-draft',{});return true})()`);
  ok(await until(`/Only the project owner/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'viewer sees the role explanation');
  ok(await ev(`!document.querySelector('[data-rmd-ai="ask"]')`), 'viewer is not offered Ask MaiK');
  await shot('phone-375-viewer');

  // 13. Run tab: "What this means" for the BCG practice sample.
  await resetToSeed();
  await ev(`SMD_RESEARCH.open({screen:'run'});1`);
  ok(await until(`!!document.querySelector('[data-rmd="calculate"]')`, 8000), 'Run tab rendered for the practice sample');
  await click('[data-rmd="calculate"]');
  ok(await until(`!!document.querySelector('.rmd-what-mean-box')`, 8000), 'What this means box shown after pooling');
  const meanText = await text('.rmd-what-mean-box');
  ok(/Risk ratio \(RR\) 0\.49/.test(meanText), 'standard statistic first: Risk ratio (RR) 0.49');
  ok(/95% CI 0\.34 to 0\.70/.test(meanText), 'confidence interval in reporting format');
  ok(/half the risk/.test(meanText), 'plain BCG meaning follows the statistic');
  await shot('phone-375-run-meaning');

  // 13b. Tutorial + own file upload offers one action to start a real project and blocks sandbox drafting.
  await ev(`(()=>{SMD_RESEARCH.tutorial.startTutorial('thesis',{reset:true});return true})()`);
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'tutorial thesis upload input ready');
  const prevCreatedCount = createdProjects.length;
  await uploadDocx({
    filename: 'Own_ICU_RCT_Thesis.docx',
    xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Summary. Randomized controlled trial of early physiotherapy in 140 ICU adults showed 22% reduction in delirium.</w:t></w:r></w:p></w:body></w:document>'
  });
  ok(await until(`!!document.querySelector('#rmdThesisStartReal')`, 8000), 'own thesis inside tutorial shows Start a real project with this thesis');
  ok(/Tutorial drafts are practice only/.test(await text('#rmdScreenBody')), 'one-line tutorial explanation shown');
  ok(await ev(`!document.querySelector('[data-rmd-thesis-next="thesis-type"]')`), 'cannot continue in tutorial sandbox with own thesis');
  await click('#rmdThesisStartReal');
  ok(await until(`/Pick the paper type/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'Start real project navigates to thesis-type');
  ok(createdProjects.length === prevCreatedCount + 1, 'real server project created from tutorial upload');
  ok(await ev(`(()=>{const p=SMD_RESEARCH.store.getActiveProject();return !!p && !p.tutorial && !!p.serverId;})()`), 'active project is now a real synced project');
  ok(await ev(`document.querySelector('[data-rmd-type="rct"]').getAttribute('aria-pressed') === 'true'`), 'real RCT thesis suggested and carried over without re-upload');
  ok(await ev(`!!document.querySelector('#rmdThesisTypeQuote')`) && /Page\s+1:\s*"Randomized controlled trial/.test(await text('#rmdThesisTypeQuote')), 'verbatim quote from uploaded thesis shown on type step');

  // 14. No em/en dashes; zero page errors; no horizontal overflow at 375, 390x844 and 1024x1366.
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');
  ok(pageErrors.length === 0, 'zero page errors: ' + pageErrors.join('; '));
  const overflow = await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`);
  ok(overflow, 'no horizontal overflow at 375px');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), '390x844 no horizontal scroll');
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: false });
  await sleep(200);
  ok(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), '1024x1366 no horizontal scroll');
  await shot('tablet-1024-thesis');
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await sleep(200);

  console.log(failures === 0 ? '\nALL THESIS UI CHECKS PASSED' : `\n${failures} THESIS UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}