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
let jobMode = 'phi'; // 'phi' -> job fails phi_blocked; 'clean' -> job succeeds
const createdProjects = [];
const aiDraftCalls = [];
const savedSections = [];

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
          return send(200, { id: jobMatch[1], status: 'failed', errorCode: 'phi_blocked', errorPages: [12, 54] });
        }
        return send(200, { id: jobMatch[1], status: 'succeeded' });
      }
      const resMatch = p.match(/^\/api\/research\/v1\/artifacts\/([^/]+)\/result$/);
      if (resMatch && req.method === 'GET') {
        return send(200, {
          pages: [
            { n: 12, width: 612, height: 792, words: wordsOf('Patient identifiers were removed from this page before upload.'), ocr: false },
            { n: 54, width: 612, height: 792, words: wordsOf('Table 7 reports the pooled risk ratio 0.49 with 95% CI 0.34 to 0.70 across 13 trials and 123 people.'), ocr: false }
          ],
          ocr: false
        });
      }
      const aiMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/ai-draft$/);
      if (aiMatch && req.method === 'POST') {
        aiDraftCalls.push(b);
        return send(200, {
          draft: {
            sections: [
              { id: 'abstract', heading: 'Abstract', text: 'Background: we studied BCG. Methods: a review. Results: risk ratio 0.49. Conclusion: BCG helps.' },
              { id: 'introduction', heading: 'Introduction', text: 'Tuberculosis remains common. BCG is widely used.' },
              { id: 'methods', heading: 'Methods', text: 'We searched PubMed and pooled 13 trials.' },
              { id: 'results', heading: 'Results', text: 'The pooled risk ratio was 0.49 (95% CI 0.34 to 0.70). The adjusted estimate was 0.77 in the subgroup.' },
              { id: 'discussion', heading: 'Discussion', text: 'BCG appears protective. Limitations include heterogeneity.' }
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
      if (p === '/api/research/v1/journals/match' && req.method === 'POST') {
        return send(200, {
          matches: [{
            score: 0.9,
            journal: { id: 'ijmr', name: 'Indian Journal of Medical Research', issn: '0971-5916', wordLimits: { abstract: 250, main: 3000 }, referenceStyle: 'vancouver' }
          }]
        });
      }
      const manMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/manuscript$/);
      if (manMatch && req.method === 'GET') {
        return send(200, { manuscript: { version: 1, status: 'draft', sections: [] } });
      }
      const secMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/manuscript\/sections\/([^/]+)$/);
      if (secMatch && req.method === 'PUT') {
        savedSections.push({ sid: secMatch[2], body: b });
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

  const uploadDocx = () => ev(`(()=>{
    const inp=document.querySelector('#rmdThesisFile');
    if(!inp)return false;
    const enc=new TextEncoder();
    const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
      +'<w:p><w:r><w:t>Observational thesis cohort of BCG vaccination outcomes.</w:t></w:r></w:p>'
      +'<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      +'<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table 7</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pooled risk ratio 0.49 (95% CI 0.34 to 0.70) across 120 patients.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
      +'</w:body></w:document>';
    const name=enc.encode('word/document.xml');
    const body=enc.encode(xml);
    const lh=new Uint8Array(30+name.length);
    const dvL=new DataView(lh.buffer);
    dvL.setUint32(0,0x04034b50,true); dvL.setUint16(4,20,true); dvL.setUint16(8,0,true);
    dvL.setUint32(18,body.length,true); dvL.setUint32(22,body.length,true); dvL.setUint16(26,name.length,true);
    lh.set(name,30);
    const ch=new Uint8Array(46+name.length);
    const dvC=new DataView(ch.buffer);
    dvC.setUint32(0,0x02014b50,true); dvC.setUint16(4,20,true); dvC.setUint16(6,20,true); dvC.setUint16(10,0,true);
    dvC.setUint32(20,body.length,true); dvC.setUint32(24,body.length,true); dvC.setUint16(28,name.length,true);
    dvC.setUint32(42,0,true); ch.set(name,46);
    const eocd=new Uint8Array(22);
    const dvE=new DataView(eocd.buffer);
    dvE.setUint32(0,0x06054b50,true); dvE.setUint16(8,1,true); dvE.setUint16(10,1,true);
    dvE.setUint32(12,ch.length,true); dvE.setUint32(16,lh.length+body.length,true);
    const out=new Uint8Array(lh.length+body.length+ch.length+eocd.length);
    out.set(lh,0); out.set(body,lh.length); out.set(ch,lh.length+body.length); out.set(eocd,lh.length+body.length+ch.length);
    const f=new File([out],'FinalThesis1.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    const dt=new DataTransfer(); dt.items.add(f); inp.files=dt.files;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);

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
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;

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
  ok(/Step 1 of 8/.test(await text('#rmdStepBanner')), 'banner reads Step 1 of 8 for the thesis journey');
  await shot('phone-375-upload');

  // 3. PHI hit: warning shown, AI blocked.
  jobMode = 'phi';
  ok(await uploadPdf(), 'thesis PDF dispatched to the upload route');
  ok(await until(`!!document.querySelector('#rmdThesisPhi')`, 8000), 'PHI warning shown on a mocked hit');
  const phiText = await text('#rmdThesisPhi');
  ok(/Patient identifiers/.test(phiText), 'PHI warning names patient identifiers');
  ok(/12, 54/.test(phiText), 'PHI warning lists the affected pages');
  ok(/Nothing was sent to an AI provider/.test(phiText), 'PHI warning confirms no provider call');
  ok(aiDraftCalls.length === 0, 'no AI call was made after the PHI hit');
  await ev(`SMD_RESEARCH.navigate('thesis-draft', {});1`);
  ok(await until(`!!document.querySelector('#rmdThesisPhi')`, 5000), 'draft step still shows the PHI warning');
  ok(await ev(`!document.querySelector('[data-rmd-ai="ask"]')`), 'Ask MaiK is not offered while PHI is blocked');
  ok(aiDraftCalls.length === 0, 'still no AI call on the draft step');
  await shot('phone-375-phi');

  // 4. Clean re-upload succeeds.
  await ev(`SMD_RESEARCH.navigate('thesis', {});1`);
  ok(await until(`!!document.querySelector('#rmdThesisReupload')`, 5000), 're-upload action offered');
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back after re-upload');
  jobMode = 'clean';
  ok(await uploadPdf(), 'clean thesis PDF dispatched');
  ok(await until(`/Thesis read/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'clean thesis read and page count shown');
  ok(await ev(`!document.querySelector('#rmdThesisPhi')`), 'PHI warning cleared after the clean upload');
  await shot('phone-375-read');

  // 4b. Real selectable-text PDF read directly on-device via pdf.js (0 extra server upload calls).
  const beforeRealPdfUploads = uploadN;
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back for real PDF check');
  ok(await uploadRealPdf(), 'real multi-object PDF selected');
  ok(await until(`/FinalThesisReal\\.pdf was read: 1 page\\(s\\)/.test(document.querySelector('#rmdScreenBody').innerText)`, 10000), 'real PDF read directly on-device with page count');
  ok(uploadN === beforeRealPdfUploads, 'selectable-text PDF required zero server upload calls');

  // 4c. Real Word (.docx) thesis read natively on-device (0 extra server upload calls).
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back for Word DOCX check');
  ok(await uploadDocx(), 'real Word (.docx) thesis selected');
  ok(await until(`/FinalThesis1\\.docx was read: 2 page\\(s\\)/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'DOCX read natively on-device with exact 2 page count');
  ok(uploadN === beforeRealPdfUploads, 'DOCX read required zero server upload calls');
  ok(await ev(`(()=>{const t=JSON.parse(localStorage.getItem('smd_rmd_thesis_v1')||'{}')['prj_thesis_1']||{};return t.pages&&t.pages.length===2&&/Table 7/.test(t.pages[1].text);})()`), 'DOCX extracted table text cleanly onto page 2');

  // Restore clean server result pages (page 54, Table 7) for Step 5-12 assertions or verify end-to-end
  await click('#rmdThesisReupload');
  ok(await until(`!!document.querySelector('#rmdThesisFile')`, 5000), 'file input back before continuing');
  jobMode = 'clean';
  ok(await uploadPdf(), 'mock clean PDF restores page 54 fixture');
  ok(await until(`/Thesis read/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'page 54 fixture loaded');

  // 5. Paper type step.
  await click('[data-rmd-thesis-next="thesis-type"]');
  ok(await until(`/Pick the paper type/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'paper type step rendered');
  ok(await ev(`document.querySelectorAll('[data-rmd-type]').length === 4`), 'four paper types offered');
  ok(/STROBE/.test(await text('#rmdScreenBody')), 'STROBE reporting checklist named');
  await click('[data-rmd-type="obs"]');
  ok(await ev(`(JSON.parse(localStorage.getItem('smd_rmd_checklist_guide_v1')||'{}'))['prj_thesis_1'] === 'strobe'`), 'chosen checklist stored as the project preference');
  await shot('phone-375-type');

  // 6. Journal step.
  await click('[data-rmd-thesis-next="thesis-journal"]');
  ok(await until(`/Pick the target journal/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'journal step rendered');
  ok(/3,000 words/.test(await text('#rmdScreenBody')), 'default journal shows the 3,000 word limit');
  ok(/structured/i.test(await text('#rmdScreenBody')), 'default journal shows the structured abstract');
  ok(await until(`/Indian Journal of Medical Research/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'matched journals listed');
  await shot('phone-375-journal');

  // 7. Draft step: Ask MaiK, number verification, locators, word limit.
  await click('[data-rmd-thesis-next="thesis-draft"]');
  ok(await until(`!!document.querySelector('[data-rmd-ai="ask"]')`, 5000), 'Ask MaiK offered on the draft step');
  await click('[data-rmd-ai="ask"]');
  ok(await until(`!!document.querySelector('.rmd-thesis-section-text')`, 8000), 'draft rendered after the mocked provider call');
  ok(aiDraftCalls.length === 1, 'exactly one AI call for the draft');
  ok(aiDraftCalls[0].task === 'thesis_to_paper', 'AI call uses the thesis_to_paper task');
  ok(!!aiDraftCalls[0].input && Array.isArray(aiDraftCalls[0].input.pages) && aiDraftCalls[0].input.pages.length > 0, 'AI call carries the thesis page text');
  const draftText = await text('#rmdDraftBody');
  ok(/\[check this number\]/.test(draftText), 'invented number sentence flagged');
  ok(!/0\.77/.test(draftText), 'invented number removed from the draft');
  ok(/0\.49/.test(draftText), 'verbatim number kept');
  ok(/of 3000 words/.test(draftText), 'word limit line shown');
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

  // 11. Checklist step uses the stored preference; journey continues.
  await click('[data-rmd-thesis-next="checklist"]');
  ok(await until(`(()=>{const b=document.querySelector('#rmdStepBanner');return !!b && /Step 7 of 8/.test(b.innerText)})()`, 5000), 'banner reads Step 7 of 8 at the checklist');

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

  // 14. No em/en dashes; no horizontal overflow at 375.
  const dashes = await ev(`(()=>{const t=document.querySelector('#researchMD').innerText||'';return (t.match(/[\\u2013\\u2014]/g)||[]).length})()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');
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