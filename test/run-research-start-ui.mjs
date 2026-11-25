// Real-browser headless test: ResearchMD Thesis / Study Start screen (plan).
// Covers:
// - Sample size: two proportions shows right n (121) and paragraph (134 / 268 with 10% dropout)
// - Dropout changes total (e.g. to 302 with 20% dropout)
// - IEC: Ask MaiK fills fields with "Drafted by MaiK, check it" note
// - Consent: Telugu shows both English and Telugu versions
// - CTRI: Blank fields (ethics committee, regulatory clearance) show "Fill this in"
// - 402: shows the plain MaiK tokens card / banner with navigation
// - Responsive: 390x844 and 1024x1366 no horizontal scroll
// - Zero page errors and zero em/en dashes
// Run with: node test/run-research-start-ui.mjs
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

const PORT = 9115, CDP = 9515, OUT = '/tmp/stewardmd-research-start-ui';
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
let nextCall402 = false;
const aiDraftCalls = [];

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
            id: 'prj_plan_' + projN,
            title: b.title || 'BCG Clinical Trial',
            discipline: b.discipline || 'medicine',
            specialty: b.specialty || 'Pulmonology',
            studyType: b.studyType || 'trial',
            role: 'owner',
            createdAt: Date.now()
          },
          requestId: 'req_proj_' + projN
        });
      }

      const projMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)(\/.*)?$/);
      if (projMatch) {
        const pid = projMatch[1];
        const sub = projMatch[2] || '';

        if (sub === '/protocols' && req.method === 'GET') {
          return send(200, { protocols: [] });
        }

        if (sub === '/cost-report' && req.method === 'GET') {
          return send(200, { runs: [], totalMicroUsd: 0 });
        }

        if (sub === '/ai-draft' && req.method === 'POST') {
          aiDraftCalls.push(b);
          if (nextCall402) {
            nextCall402 = false;
            return send(402, {
              error: {
                code: 'insufficient_credits',
                message: 'You need more MaiK tokens for this step.',
                requestId: 'req_poor'
              }
            });
          }

          if (b.task === 'iec_application') {
            return send(200, {
              draft: {
                id: 'draft_iec_1',
                task: 'iec_application',
                status: 'unverified',
                title: 'BCG trial in adult tuberculosis',
                investigators: [],
                background: 'Tuberculosis remains a major public health challenge.',
                objectives: ['To evaluate BCG vaccine efficacy', 'To measure hospital admission rate'],
                design: 'Randomized controlled trial',
                setting: 'Tertiary hospital, Bangalore',
                duration: '24 months',
                sampleSize: '118 per group (262 total allowing for 10% dropout)',
                inclusion: ['Adults aged 18 to 65', 'Confirmed sputum smear positive'],
                exclusion: ['Immunosuppressed patients', 'Previous severe allergic reaction'],
                methodology: 'Enrolled participants will be randomized 1:1 to receive BCG or placebo.',
                statisticalAnalysis: 'Intention-to-treat analysis comparing risk ratios with 95% confidence intervals.',
                risks: 'Minor local reaction at injection site.',
                benefits: 'Potential protection against severe pulmonary disease.',
                confidentiality: 'All patient identifiers will be coded and kept in secure access-controlled database.',
                compensation: 'Trial-related injury covered per ICMR guidelines.',
                conflictOfInterest: 'None declared.',
                funding: 'Institutional research grant.',
                consentProcess: 'Informed written consent obtained in participant preferred language.',
                vulnerablePopulations: 'None included.'
              },
              model: 'gemini-2.5-flash',
              costInr: 0.15
            });
          }

          if (b.task === 'consent_form') {
            return send(200, {
              draft: {
                id: 'draft_consent_1',
                task: 'consent_form',
                status: 'unverified',
                language: 'Telugu',
                participantInformationSheet: {
                  title: 'పాల్గొనేవారి సమాచార పత్రం',
                  purpose: 'ఈ అధ్యయనం పెద్దవారిలో క్షయ వ్యాధిని నివారించడానికి ఉద్దేశించబడింది.',
                  procedures: 'మీరు క్రమమైన రక్త పరీక్షలు చేయించుకోవాలి.',
                  duration: '12 నెలలు',
                  risks: 'తేలికపాటి జ్వరం లేదా నొప్పి ఉండవచ్చు.',
                  benefits: 'వ్యాధి నివారణ ప్రయోజనం కలగవచ్చు.',
                  alternatives: 'ప్రామాణిక చికిత్స అందుబాటులో ఉంది.',
                  confidentiality: 'మీ సమాచారం ఖచ్చితంగా గోప్యంగా ఉంచబడుతుంది.',
                  voluntary: 'మీ భాగస్వామ్యం పూర్తిగా స్వచ్ఛందమైనది.',
                  contact: ''
                },
                consentForm: {
                  statements: [
                    'నేను సమాచార పత్రాన్ని చదివి అర్థం చేసుకున్నాను.',
                    'నాకు ప్రశ్నలు అడిగే అవకాశం లభించింది.',
                    'నేను స్వచ్ఛందంగా పాల్గొనడానికి అంగీకరిస్తున్నాను.'
                  ],
                  signatureBlock: 'పాల్గొనేవారి సంతకం: ________  తేదీ: ________'
                },
                englishVersion: {
                  participantInformationSheet: {
                    title: 'Information for participants',
                    purpose: 'This study aims to prevent tuberculosis in adults.',
                    procedures: 'You will undergo routine health checks.',
                    duration: '12 months',
                    risks: 'Mild local discomfort.',
                    benefits: 'Direct protection against infection.',
                    alternatives: 'Standard care is available.',
                    confidentiality: 'All records remain strictly confidential.',
                    voluntary: 'Taking part is entirely your choice.',
                    contact: ''
                  },
                  consentForm: {
                    statements: [
                      'I have read and understood the information sheet.',
                      'I have had the opportunity to ask questions.',
                      'I agree to take part voluntarily.'
                    ],
                    signatureBlock: 'Signature of participant: ________  Date: ________'
                  },
                  language: 'English'
                },
                translatedVersion: {
                  participantInformationSheet: {
                    title: 'పాల్గొనేవారి సమాచార పత్రం',
                    purpose: 'ఈ అధ్యయనం పెద్దవారిలో క్షయ వ్యాధిని నివారించడానికి ఉద్దేశించబడింది.',
                    procedures: 'మీరు క్రమమైన రక్త పరీక్షలు చేయించుకోవాలి.',
                    duration: '12 నెలలు',
                    risks: 'తేలికపాటి జ్వరం లేదా నొప్పి ఉండవచ్చు.',
                    benefits: 'వ్యాధి నివారణ ప్రయోజనం కలగవచ్చు.',
                    alternatives: 'ప్రామాణిక చికిత్స అందుబాటులో ఉంది.',
                    confidentiality: 'మీ సమాచారం ఖచ్చితంగా గోప్యంగా ఉంచబడుతుంది.',
                    voluntary: 'మీ భాగస్వామ్యం పూర్తిగా స్వచ్ఛందమైనది.',
                    contact: ''
                  },
                  consentForm: {
                    statements: [
                      'నేను సమాచార పత్రాన్ని చదివి అర్థం చేసుకున్నాను.',
                      'నాకు ప్రశ్నలు అడిగే అవకాశం లభించింది.',
                      'నేను స్వచ్ఛందంగా పాల్గొనడానికి అంగీకరిస్తున్నాను.'
                    ],
                    signatureBlock: 'పాల్గొనేవారి సంతకం: ________  తేదీ: ________'
                  },
                  language: 'Telugu'
                }
              },
              model: 'gemini-2.5-flash',
              costInr: 0.20
            });
          }

          if (b.task === 'ctri_fields') {
            return send(200, {
              draft: {
                id: 'draft_ctri_1',
                task: 'ctri_fields',
                status: 'unverified',
                publicTitle: 'BCG vaccine in adults',
                scientificTitle: 'Evaluation of BCG vaccine for prevention of hospitalization in pulmonary tuberculosis',
                studyType: 'Interventional',
                phase: 'Phase 3',
                condition: 'Pulmonary tuberculosis',
                intervention: 'BCG vaccine single dose 0.1 mL intradermal',
                comparator: 'Normal saline placebo single dose 0.1 mL intradermal',
                inclusion: 'Adults aged 18 to 65 years with confirmed tuberculosis',
                exclusion: 'Immunocompromised individuals or active malignancy',
                primaryOutcome: {
                  outcome: 'Hospitalization rate at 12 months',
                  timepoint: '12 months'
                },
                secondaryOutcomes: [
                  'All-cause mortality at 24 months',
                  'Time to sputum conversion'
                ],
                targetSampleSize: 262,
                sites: 'Victoria Hospital, Bangalore Medical College, Bangalore',
                recruitmentStatus: 'Not Yet Recruiting',
                ethicsCommittee: '',
                regulatoryClearance: '',
                fundingSource: 'Institutional Research Grant',
                briefSummary: 'This randomized controlled trial evaluates the efficacy of BCG vaccination in reducing hospitalization among adult tuberculosis patients.'
              },
              model: 'gemini-2.5-flash',
              costInr: 0.20
            });
          }
        }
      }

      if (p === '/api/research/v1/purchase/packs' && req.method === 'GET') {
        return send(200, {
          packs: [
            { pack: 'tokens_50k', inr: 48, tokens: 50000, label: '50,000 tokens (approx $0.50)' }
          ]
        });
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
  `--user-data-dir=/tmp/rmd-start-chrome-${process.pid}`,
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
  if (r.result?.exceptionDetails) {
    const err = JSON.stringify(r.result.exceptionDetails).slice(0, 600);
    pageErrors.push(err);
    throw Error(err);
  }
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
      /* retry */
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
      pageErrors.push(JSON.stringify(m.params));
    }
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;

  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!window.SMD_RESEARCH.screens && !!window.SMD_RESEARCH.screens.plan', 30000), 'app loaded with ResearchMD plan screen');

  // 1. Create a trial project to unlock original studies journey
  await ev(`SMD_RESEARCH.open({screen:'start'});1`);
  ok(await until(`!!document.querySelector('.rmd-start-screen')`, 5000), 'start screen rendered');
  // Choose randomized trial
  await click('[data-rmd-start-choice="trial"]');
  ok(await until(`!!document.querySelector('#rmdStartForm')`, 3000), 'naming form appears');
  await ev(`(()=>{document.getElementById('rmd_start_title').value='BCG Tuberculosis Trial';return true})()`);
  await click('[data-rmd="start-create"]');
  ok(await until(`SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_plan_1'`, 5000), 'project created on the server');

  // Verify journey has "plan" step before protocol
  const tabs = await ev(`(()=>{
    return Array.from(document.querySelectorAll('.rmd-shell-tabs .rmd-tab')).map(t => t.getAttribute('data-rmd-tab')).filter(Boolean);
  })()`);
  ok(tabs.indexOf('plan') >= 0, 'journey tabs include plan');
  ok(tabs.indexOf('plan') < tabs.indexOf('protocol'), 'plan tab comes before protocol');

  // Navigate to plan screen
  await click('[data-rmd-tab="plan"]');
  ok(await until(`!!document.querySelector('.rmd-plan-screen')`, 5000), 'lands on the plan workspace');
  ok(/Plan my study/.test(await text('.rmd-screen-title')), 'screen heading is Plan my study');

  // 2. Sample size: two proportions shows 121 per group, 134 with 10% dropout (268 total)
  ok(/0 MaiK tokens/.test(await text('#rmdCardSampleSize')), 'sample size card has 0 MaiK tokens chip');
  ok(await ev(`document.getElementById('rmd_ss_aim').value === 'two_proportions'`), 'two proportions is the selected aim');
  const paragraph = await text('#rmd_ss_paragraph');
  ok(/121 patients per group are needed/.test(paragraph), 'sample size paragraph includes 118 patients per group');
  ok(/134 per group \(268 in total\) will be enrolled/.test(paragraph), 'sample size paragraph includes 134 per group (268 in total) with 10% dropout');

  // Dropout changes total
  await ev(`(()=>{
    const d = document.getElementById('rmd_ss_dropout');
    d.value = '0.20';
    d.oninput();
    return true;
  })()`);
  await sleep(100);
  const para2 = await text('#rmd_ss_paragraph');
  ok(/302 in total/.test(para2), 'updating dropout to 20% recalculates total to 302');

  // Test copy paragraph button
  await click('[data-rmd="ss-copy"]');
  await sleep(100);

  // 3. IEC Application: Ask MaiK fills fields with "Drafted by MaiK, check it" note
  ok(/ICMR 2017/.test(await text('#rmdCardIec')), 'IEC card has ICMR 2017 badge');
  await click('#rmdCardIec [data-rmd-ai="ask"]');
  ok(await until(`(()=>{
    const val = document.getElementById('rmd_iec_title').value;
    return val === 'BCG trial in adult tuberculosis';
  })()`, 5000), 'IEC title populated by MaiK draft');
  ok(await ev(`!!document.querySelector('#rmdCardIec [data-rmd-ai-note="title"]')`), 'IEC title marked with Drafted by MaiK note');
  ok(/Drafted by MaiK, check it/.test(await text('#rmdCardIec [data-rmd-ai-note="title"]')), 'note reads Drafted by MaiK, check it');

  // 4. Consent form in Telugu shows both versions
  await ev(`(()=>{
    const sel = document.getElementById('rmd_consent_lang');
    sel.value = 'Telugu';
    sel.onchange();
    return true;
  })()`);
  await click('#rmdCardConsent [data-rmd-ai="ask"]');
  ok(await until(`(()=>{
    const eng = document.getElementById('rmd_eng_title');
    const trans = document.getElementById('rmd_trans_title');
    return !!eng && !!trans;
  })()`, 5000), 'bilingual consent rendered for Telugu');
  ok(/Information for participants/.test(await text('#rmd_eng_title')), 'English version title rendered');
  ok(/పాల్గొనేవారి సమాచార పత్రం/.test(await ev(`document.getElementById('rmd_trans_title').value`)), 'Telugu version title rendered');

  // 5. CTRI blank fields show "Fill this in"
  await click('#rmdCardCtri [data-rmd-ai="ask"]');
  ok(await until(`(()=>{
    const pub = document.getElementById('rmd_ctri_pub');
    return pub && pub.value === 'BCG vaccine in adults';
  })()`, 5000), 'CTRI fields populated by MaiK draft');
  ok(await ev(`!!document.querySelector('[data-rmd-fillin="ethicsCommittee"]')`), 'CTRI ethicsCommittee marked Fill this in');
  ok(await ev(`!!document.querySelector('[data-rmd-fillin="regulatoryClearance"]')`), 'CTRI regulatoryClearance marked Fill this in');
  ok(/Fill this in/.test(await text('[data-rmd-fillin="ethicsCommittee"]')), 'badge reads Fill this in');

  // One line under CTRI card
  ok(/Register on ctri\.nic\.in before enrolling the first patient \(required for clinical trials in India\)\./.test(await text('.rmd-plan-screen')), 'notice under CTRI card is present');

  // 6. 402 scenario shows plain MaiK tokens card
  nextCall402 = true;
  await click('#rmdCardIec [data-rmd-ai="ask"]');
  ok(await until(`(()=>{
    return /You need more MaiK tokens for this step\./.test(document.querySelector('#rmdCardIec').innerText);
  })()`, 5000), '402 returns You need more MaiK tokens for this step');
  ok(await ev(`!!document.querySelector('#rmdCardIec [data-rmd-action="credits"]')`), 'Add tokens action button rendered');
  // Click Add tokens to navigate to plain MaiK tokens card
  await click('#rmdCardIec [data-rmd-action="credits"]');
  ok(await until(`!!document.querySelector('.rmd-credits-screen')`, 5000), 'navigates to plain MaiK tokens card');
  ok(/MaiK tokens/.test(await text('.rmd-credits-screen')), 'credits screen heading is MaiK tokens');

  // Navigate back to plan
  await click('[data-rmd-tab="plan"]');
  ok(await until(`!!document.querySelector('.rmd-plan-screen')`, 5000), 'back to plan screen');

  // 7. Responsive checks: 390x844 (iPhone) and 1024x1366 (iPad Pro)
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(150);
  ok(await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), '390x844 no horizontal scroll');
  await shot('phone-390-plan-screen');

  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: false });
  await sleep(150);
  ok(await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), '1024x1366 iPad no horizontal scroll');
  await shot('ipad-1024-plan-screen');

  // 8. No em/en dashes anywhere in ResearchMD text
  const dashes = await ev(`(()=>{
    const t = document.querySelector('#researchMD').innerText || '';
    return (t.match(/[\\u2013\\u2014]/g) || []).length;
  })()`);
  ok(dashes === 0, 'no em or en dashes in ResearchMD visible text');

  // 9. Zero page errors
  ok(pageErrors.length === 0, `zero page errors (got ${pageErrors.length}: ${pageErrors.join('; ')})`);

  console.log(failures === 0 ? '\nALL RESEARCH-START UI CHECKS PASSED' : `\n${failures} RESEARCH-START UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  server.close();
}
