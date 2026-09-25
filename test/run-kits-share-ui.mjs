// Real-browser test of wave 2 (kits-share.js) end to end: the full app in headless Chrome at 390px
// against a local server that runs the REAL /api/kits handlers (functions/_kits_share.js) over an
// in-memory Firestore (test/helpers/kits-share-world.mjs). Two verified doctors, Dr Asha (uA, owner
// of City Hospital) and Dr Bala (uB), take turns: the Bearer token is simply the uid here.
//   referral from the OPD consult -> Bala's inbox -> accept with a reply -> Asha sees it
//   handover -> read-back required -> acknowledged
//   case room from a kit (de-identified) -> invite -> reply
//   the hospital's version of a kit: publish, shown inside the kit, its order set queues tests
//   the patient's kit history: save a visit, show the antenatal card
//   review desk: send decisions to StewardMD
//   flag off: no Colleagues card, no Send buttons
//   node test/run-kits-share-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ENV, CLAIMS, world } from './helpers/kits-share-world.mjs';
const K = await import('../functions/_kits_share.js');
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9073, CDP = 9473;
const W = world();
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let now = Date.now();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/kits/')) {
    let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', async () => {
      const uid = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
      const send = (st, b) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
      const route = p.slice('/api/kits/'.length);
      if (!CLAIMS[uid]) return send(401, { error: 'auth_required' });
      const h = K.ROUTES[req.method + ' ' + route];
      if (!h) return send(404, { error: 'not_found' });
      let body = {}; if (req.method === 'POST') { try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'bad_json' }); } } else url.searchParams.forEach((v, k) => { body[k] = v; });
      try { now += 1000; const r = await h({ env: ENV, uid, claims: Object.assign({ sub: uid }, CLAIMS[uid]), deps: W.deps, now, waitUntil: null }, body); send(r.status, r.body); }
      catch (e) { send(500, { error: 'server_error', m: String(e.message) }); }
    });
    return;
  }
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('404'); return; } res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/kxshare-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failures++; };
const until = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 100) { if (await ev(expr)) return true; await sleep(100); } return false; };
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const setVal = (sel, v) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;if(el.type==='checkbox')el.checked=!!${JSON.stringify(v)};else el.value=${JSON.stringify(v)};el.dispatchEvent(new Event(el.tagName==='SELECT'||el.type==='checkbox'?'change':'input',{bubbles:true}));return true})()`);
const armToasts = () => ev(`window.__toasts=[];if(!window.toast||!window.toast.__rec){const t0=window.toast;const f=function(m){window.__toasts.push(String(m));try{return t0&&t0.apply(this,arguments)}catch(e){}};f.__rec=1;window.toast=f;}1`);
const toastHas = (re) => until(`window.__toasts.some(t=>${re}.test(t))`);
const as = (uid) => ev(`window.SMD_IDTOKEN=function(){return ${JSON.stringify(uid)}};1`);
const topIs = (sel) => ev(`(()=>{const e=document.elementFromPoint(innerWidth/2,innerHeight/2);return !!(e&&e.closest(${JSON.stringify(sel)}))})()`);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
async function shot(name) { await sleep(250); await mkdir('/tmp/stewardmd-kxshare', { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`/tmp/stewardmd-kxshare/${name}.png`, Buffer.from(r.result.data, 'base64')); }
const pickKit = async (root, kid) => { if (!await ev(`!!document.querySelector('${root} .kit-chips [data-kit-act="kit:${kid}"]')`)) { await click(`${root} [data-kit-act="picker"]`); await until(`!!document.querySelector('${root} [data-kit-picker] [data-kit-act="kit:${kid}"]')`); } await click(`${root} [data-kit-act="kit:${kid}"]`); return until(`document.querySelector('${root} .kit-chip.on')?.dataset.kitAct==='kit:${kid}'`); };
const R = '#smdOpdEmr';
try {
  // City Hospital (org1, owned by Asha) already has version 1 of the O&G kit.
  await K.unitPublish({ env: ENV, uid: 'uA', claims: Object.assign({ sub: 'uA' }, CLAIMS.uA), deps: W.deps, now: now++ }, { orgId: 'org1', kitId: 'obgyn', reason: 'seed',
    content: { notes: 'PPH trolley is in labour room 2.', contacts: ['On-call obstetrician: ext 2345'], investigations: [{ label: 'Hb (lab code H1)' }], orderSets: [{ label: 'City pre-eclampsia panel', tests: ['CBC', 'LFT', 'Urine protein creatinine ratio'] }] } });

  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' }); sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until('!!(window.SMD_SHARE&&window.SMD_KITS&&window.OPDEMR&&window.SMD_DOCS&&window.SMD_REVIEW)', 25000), 'app loaded with kits sharing');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');1`);
  ok(await ev('SMD_SHARE.on()'), 'sharing is on by default (no flag set)');
  ok(await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile[data-act="kxinbox"]')`, 8000), 'the Colleagues tile is on Home by default');
  await as('uA');

  /* ---- the hospital's version inside the kit, kit history ---- */
  await ev(`OPDEMR.openProfile({patientId:'MR-KX-1',name:'Lakshmi Devi',age:'28',sex:'Female',noStore:true});1`);
  await until(`!!document.querySelector('${R}.on [data-oe-act="tab:kit"]')`);
  await click(`${R} [data-oe-act="tab:kit"]`);
  await pickKit(R, 'obgyn');
  ok(await until(`/City Hospital/.test(document.querySelector('${R} [data-kit-unit="obgyn"]')?.textContent||'')&&/PPH trolley is in labour room 2/.test(document.querySelector('${R} [data-kit-unit="obgyn"]').textContent)`), "the kit shows City Hospital's version: notes, contacts, tests");
  ok(await ev(`/Edit City Hospital's version/.test(document.querySelector('${R} [data-kit-unit="obgyn"]').textContent)`), 'the hospital owner can edit it');
  await armToasts(); await click(`${R} [data-kit-act="unitos:0:0"]`);
  ok(await until(`OPDEMR._state().tab==='inv'&&['CBC','LFT'].every(t=>(OPDEMR._state().dictatedInv||[]).includes(t))`), "the hospital's order set queues its tests on the Investigations tab");
  await click(`${R} [data-oe-act="tab:kit"]`); await until(`!!document.querySelector('${R} .kit')`);
  await setVal(`${R} [data-kit-f="f:gravida"]`, '2'); await setVal(`${R} [data-kit-f="f:living"]`, '1');
  await armToasts(); await click(`${R} [data-kit-act="histsave"]`);
  ok(await toastHas(/Saved to the patient's kit history \(1 visit\)/), 'a visit is saved to the patient kit history');
  await click(`${R} [data-kit-act="histshow"]`);
  ok(await until(`/Gravida/.test(document.querySelector('${R} [data-kit-hist]')?.textContent||'')&&(()=>{const c=[...document.querySelectorAll('${R} [data-kit-hist] tbody td')].map(td=>td.textContent);return c.includes('2')&&c.includes('1')})()`), 'the antenatal card shows the saved visit: gravida 2, living 1');
  ok(await ev(`[...document.querySelectorAll('${R} [data-kit-act="histshow"]')].some(b=>/Antenatal card/.test(b.textContent))`), 'O&G calls it the antenatal card');
  const stored = JSON.stringify([...W.docs.entries()].filter(([k]) => k.startsWith('kx_hist/')));
  ok(!/MR-KX-1|Lakshmi/.test(stored), 'the server stored neither the record number nor the name in the clear');
  await ev(`document.querySelector('${R} .oe-canvas').scrollTop=0`); await shot('kit-share-card');

  /* ---- referral from Documents ---- */
  await click(`${R} [data-kit-act="docs"]`); await until(`document.querySelector('#smdDocs.on')`);
  await click('#smdDocs [data-dl-act="type:referral"]'); await until(`!!document.querySelector('#smdDocs [data-dl-f="reason"]')`);
  await setVal('#smdDocs [data-dl-f="reason"]', 'Severe pre-eclampsia at 34 weeks, BP 170/112'); await setVal('#smdDocs [data-dl-f="question"]', 'Please admit and plan delivery');
  await setVal('#smdDocs [data-dl-f="urgency"]', 'Urgent (within 24 hours)');
  await click('#smdDocs [data-dl-act="kxsend"]');
  ok(await until(`document.querySelector('#smdShare.on')`) && await topIs('#smdShare'), 'Send to a colleague opens above Documents');
  ok(/Lakshmi Devi/.test(await text('#smdShare')) && /Gravida: 2/.test(await text('#smdShare')), 'the compose view shows the patient and the kit summary it will send');
  await setVal('#sh_to', 'SMD-BBB222'); await armToasts(); await click('#smdShare [data-sh-act="send"]');
  ok(await toastHas(/Confirm the patient agreed/), 'consent must be confirmed');
  await setVal('#sh_consent', true); await click('#smdShare [data-sh-act="send"]');
  ok(await toastHas(/^Referral sent\.$/) && await until(`/To Dr Bala/.test(document.querySelector('#smdShare').textContent)`), 'sent, and listed under Sent');
  ok(W.pushes.some((p) => p.uid === 'uB' && /sent you a referral/.test(p.msg.body)), 'Bala gets a fixed-text push');
  await shot('share-sent');
  await click('#smdShare [data-sh-act="close"]'); await click('#smdDocs [data-dl-act="close"]');

  /* ---- Bala: inbox, accept ---- */
  await ev(`OPDEMR.close();1`); await as('uB');
  await ev(`window.SMD_STEWARD_ID={my:function(){return 'SMD-BBB222'},ensure:function(d,cb){cb&&cb('SMD-BBB222')}};1`);
  await ev(`SMD_SHARE.openInbox('in');1`);
  ok(await until(`/Referral: Urgent \\(within 24 hours\\)/.test(document.querySelector('#smdShare')?.textContent||'')&&/Dr Asha/.test(document.querySelector('#smdShare').textContent)`), "Bala's inbox lists the urgent referral from Dr Asha");
  ok(/Your StewardMD ID: SMD-BBB222/.test(await text('#smdShare')), 'the inbox shows your own StewardMD ID to give to colleagues');
  await armToasts(); await click('#smdShare [data-sh-act="copyid"]');
  ok(await toastHas(/SMD-BBB222/), 'your ID can be copied');
  await click('#smdShare .rv-row');
  ok(await until(`/Lakshmi Devi/.test(document.querySelector('#smdShare').textContent)&&/Severe pre-eclampsia/.test(document.querySelector('#smdShare').textContent)`), 'opening it shows the letter');
  await setVal('#sh_note', 'Bed ready in the labour ward.'); await click('#smdShare [data-sh-act="st:accepted"]');
  ok(await until(`/Accepted/.test(document.querySelector('#smdShare').textContent)&&/Bed ready in the labour ward/.test(document.querySelector('#smdShare').textContent)`), 'accepted with a reply');
  await shot('share-accepted');

  /* ---- Bala hands over to Asha; Asha must read back ---- */
  await click('#smdShare [data-sh-act="close"]');
  await ev(`SMD_DOCS.open({type:'handover'});1`); await until(`!!document.querySelector('#smdDocs [data-dl-act="hadd"]')`);
  await setVal('#smdDocs [data-dl-f="unit"]', 'Labour ward'); await click('#smdDocs [data-dl-act="hadd"]');
  await until(`!!document.querySelector('#smdDocs [data-dl-h="0:bed"]')`);
  await setVal('#smdDocs [data-dl-h="0:bed"]', 'LW 3'); await setVal('#smdDocs [data-dl-h="0:summary"]', '34 weeks, severe pre-eclampsia on magnesium'); await setVal('#smdDocs [data-dl-h="0:actions"]', 'BP every 15 min; urine output hourly');
  await click('#smdDocs [data-dl-act="kxsend"]'); await until(`document.querySelector('#smdShare.on')`);
  await setVal('#sh_to', 'Asha@City.example'); await armToasts(); await click('#smdShare [data-sh-act="send"]');
  ok(await toastHas(/Handover sent/), 'handover sent to the receiving doctor by her sign-in email');
  await click('#smdShare [data-sh-act="close"]'); await click('#smdDocs [data-dl-act="close"]');
  await as('uA'); await ev(`SMD_SHARE.openInbox('in');1`);
  await until(`/Handover/.test(document.querySelector('#smdShare').textContent)`);
  await ev(`[...document.querySelectorAll('#smdShare .rv-row')].find(b=>/Handover/.test(b.textContent)).click();1`);
  ok(await until(`/LW 3/.test(document.querySelector('#smdShare').textContent)&&/magnesium/.test(document.querySelector('#smdShare').textContent)`), 'Asha reads the handover');
  await armToasts(); await click('#smdShare [data-sh-act="st:acknowledged"]');
  ok(await toastHas(/Read the plan back/), 'acknowledging needs a read-back');
  await setVal('#sh_note', 'LW 3 on magnesium: BP every 15 min, hourly urine'); await click('#smdShare [data-sh-act="st:acknowledged"]');
  ok(await until(`/Acknowledged/.test(document.querySelector('#smdShare').textContent)`), 'handover acknowledged with the read-back');
  await click('#smdShare [data-sh-act="tab:out"]'); await click('#smdShare [data-sh-act="inbox"]');
  await until(`/Received/.test(document.querySelector('#smdShare').textContent)`); await click('#smdShare [data-sh-act="tab:out"]');
  ok(await until(`/Accepted/.test(document.querySelector('#smdShare').textContent)`), "Asha's sent list shows the referral accepted");
  await click('#smdShare [data-sh-act="close"]');

  /* ---- case room from a kit, de-identified ---- */
  await ev(`OPDEMR.openProfile({patientId:'MR-KX-2',name:'Ravi Kumar',age:'58',sex:'Male',noStore:true});1`);
  await until(`!!document.querySelector('${R}.on [data-oe-act="tab:kit"]')`); await click(`${R} [data-oe-act="tab:kit"]`);
  await pickKit(R, 'pulmonology');
  await click(`${R} [data-kit-act="askcase"]`); await until(`!!document.querySelector('#smdShare.on #sh_title')`);
  await setVal('#sh_title', 'Recurrent pleural effusion UHID 44812345'); await setVal('#sh_q', 'Tap again or thoracoscopy? Call 9876543210'); await setVal('#sh_inv', 'SMD-BBB222, SMD-NOPE00');
  await armToasts(); await click('#smdShare [data-sh-act="createcase"]');
  ok(await toastHas(/Case room opened\. 1 invited\. Not added: SMD-NOPE00 \(no StewardMD doctor with that ID\)/), 'case room opened; an unknown ID is reported, not silently dropped');
  ok(await until(`/Recurrent pleural effusion/.test(document.querySelector('#smdShare .dl-h')?.textContent||'')`) && !/44812345|9876543210/.test(await text('#smdShare')), 'identifiers are stripped before anyone sees them');
  await as('uB'); await click('#smdShare [data-sh-act="close"]'); await ev(`SMD_SHARE.openInbox('cases');1`);
  await until(`/Recurrent pleural effusion/.test(document.querySelector('#smdShare').textContent)`); await click('#smdShare .rv-row');
  await until(`!!document.querySelector('#sh_reply')`); await setVal('#sh_reply', 'Thoracoscopy, with pleural biopsy.'); await click('#smdShare [data-sh-act="reply"]');
  ok(await until(`/Thoracoscopy, with pleural biopsy/.test(document.querySelector('#smdShare').textContent)&&/Dr Bala/.test(document.querySelector('#smdShare').textContent)`), 'Bala replies in the thread');
  ok(!await ev(`!!document.querySelector('#smdShare [data-sh-act="closecase"]')`), 'only the owner can close or invite');
  await shot('share-case');
  await click('#smdShare [data-sh-act="close"]');

  /* ---- publish version 2 of the hospital's kit ---- */
  await as('uA'); await ev(`OPDEMR.close();SMD_KITS.open({kit:'obgyn'});1`);
  await until(`/Edit City Hospital's version/.test(document.querySelector('#smdKit [data-kit-unit="obgyn"]')?.textContent||'')`);
  await click('#smdKit [data-kit-act="unitedit:0"]');
  ok(await until(`document.querySelector('#smdShare.on #sh_notes')?.value==='PPH trolley is in labour room 2.'`) && await topIs('#smdShare'), 'the editor opens with the current version');
  await setVal('#sh_notes', 'PPH trolley in labour room 2. Check it every morning.'); await armToasts(); await click('#smdShare [data-sh-act="publish"]');
  ok(await toastHas(/Give the reason for this version/), 'a reason is asked for');
  await setVal('#sh_reason', 'Unit meeting 20 September'); await armToasts(); await click('#smdShare [data-sh-act="publish"]');
  ok(await toastHas(/Version 2 published for City Hospital/), 'version 2 published');
  ok(await until(`/version 2/.test(document.querySelector('#smdKit [data-kit-unit="obgyn"]')?.textContent||'')&&/Check it every morning/.test(document.querySelector('#smdKit [data-kit-unit="obgyn"]').textContent)`), 'the kit shows version 2 at once');
  ok(W.docs.has('kx_unit_ver/org1__obgyn__v1') && W.docs.has('kx_unit_ver/org1__obgyn__v2'), 'version 1 is kept');
  await click('#smdKit [data-kit-act="close"]');

  /* ---- review desk sync ---- */
  await ev(`localStorage.setItem('smd_review_decisions',JSON.stringify({'kit:obgyn':{decision:'approve',comment:'',at:new Date().toISOString()}}));SMD_REVIEW.open();1`);
  await until(`!!document.querySelector('#smdReview [data-rv-act="sync"]')`); await armToasts(); await click('#smdReview [data-rv-act="sync"]');
  ok(await toastHas(/Sent 1 decision to StewardMD/) && W.docs.has('kx_reviews/uA'), 'review decisions reach the server');
  await click('#smdReview [data-rv-act="close"]'); await ev(`localStorage.removeItem('smd_review_decisions');1`);

  /* ---- screens: no dashes, no side scroll ---- */
  await ev(`SMD_SHARE.openInbox('in');1`); await until(`document.querySelectorAll('#smdShare .rv-row').length>=1`);
  ok(!/[–—]/.test(await ev(`document.querySelector('#smdShare').innerText`)), 'no em or en dash on the Colleagues sheet');
  ok(await ev(`(()=>{const c=document.querySelector('#smdShare .kit-sheet-body');return c.scrollWidth<=c.clientWidth+1})()`), 'no sideways scroll at 390px');
  await click('#smdShare [data-sh-act="close"]');

  /* ---- flag off ---- */
  await call('Page.navigate', { url: `http://localhost:${PORT}/?share=0` });
  await until('!!(window.SMD_SHARE&&window.SMD_KITS&&window.OPDEMR)', 25000);
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());SMD_KITS.open({kit:'obgyn'});1`);
  await until(`!!document.querySelector('#smdKit.on .kit-head')`);
  ok(!await ev(`!!document.querySelector('#smdKit .kit-share')`), 'flag off: no Colleagues card in the kit');
  await ev(`SMD_KITS.close();SMD_DOCS.open({type:'referral'});1`); await until(`!!document.querySelector('#smdDocs [data-dl-act="print"]')`);
  ok(!await ev(`!!document.querySelector('#smdDocs [data-dl-act="kxsend"]')`), 'flag off: no Send button on the referral letter');
} catch (e) { console.error(e); failures++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS'); process.exit(failures ? 1 : 0);
