// Knowledge Library live search: with the on-screen keyboard up (a short viewport), typing must show
// results in the visible area, directly under a pinned search box, on phone and iPad, on every tab.
// Also: on iPad the panel fills the screen (no floating 900px column). Screenshots: /tmp/stewardmd-kb-search
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url)), out = '/tmp/stewardmd-kb-search';
const server = spawn('node', [repo + 'test/serve.mjs', repo, '9041'], { stdio: 'ignore' });
const profile = `/tmp/kbsearch-chrome-${process.pid}`;
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9441', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async e => { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failures++; };
const size = (w, h) => call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
async function shot(n) { await sleep(250); await mkdir(out, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); await writeFile(`${out}/${n}.jpg`, Buffer.from(r.result.data, 'base64')); }
const type = async (sel, v) => { await ev(`(()=>{const q=document.querySelector('${sel}');q.focus();q.value=${JSON.stringify(v)};q.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(250); };
// the first result must start inside the visible viewport, below the search box, and the box must be on screen
const visible = async rowSel => { const r = await ev(`(()=>{const r=document.querySelector('${rowSel}'),b=document.querySelector('#sbrefBody .kblib-searchbox');if(!r||!b)return {pass:false,why:'missing'};const rt=r.getBoundingClientRect().top,bb=b.getBoundingClientRect();return {pass:bb.top>=0&&bb.bottom<innerHeight&&rt>=bb.bottom-2&&rt<innerHeight-40&&document.documentElement.scrollWidth<=innerWidth,why:[Math.round(bb.top),Math.round(bb.bottom),Math.round(rt),innerHeight,document.documentElement.scrollWidth]}})()`); if (!r.pass) console.log('  ', rowSel, JSON.stringify(r.why)); return r.pass; };
try {
  let v; for (let i = 0; i < 60; i++) { try { v = await (await fetch('http://localhost:9441/json/version')).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const t = await call('Target.createTarget', { url: 'about:blank' }); sid = (await call('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
  await size(1180, 820);
  await call('Page.navigate', { url: 'http://localhost:9041/' });
  for (let i = 0; i < 100; i++) { if (await ev('!!window.SB?.__smdKbWrapped && Object.keys(window.KB_ENRICHMENT?.byId||{}).length>4000')) break; await sleep(250); }
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');SB.openRef('syndromes')`);
  await sleep(400); await shot('ipad-discover');
  ok(await ev(`Math.abs(document.querySelector('#sbrefOverlay .sbref-top').getBoundingClientRect().width-innerWidth)<=1`), 'iPad: the header spans the full screen width');
  ok(await ev(`document.querySelector('#sbrefTitle').textContent.trim()==='Knowledge Library'`), 'iPad: the header names the library (the empty bar is gone)');
  ok(await ev(`(()=>{const d=document.querySelector('.kblib-discover'),s=d.getBoundingClientRect();return parseFloat(getComputedStyle(d).width)<=820&&Math.abs(s.left-(innerWidth-s.right))<=2})()`), 'iPad: Discover content keeps a centred reading width');
  for (const [w, h, tag] of [[1180, 470, 'iPad'], [820, 640, 'iPad portrait'], [390, 430, 'phone']]) {
    const f = tag.replace(' ', '-');
    await size(w, h); await ev(`SB.openRef('syndromes')`); await sleep(300);
    await type('#kblibQ', 'menin');
    ok(await visible('#kblibGrid .kblib-row'), `${tag}, keyboard up: Discover results show right under the search box`);
    ok(await ev(`/menin/i.test(document.querySelector('#kblibGrid .kblib-row').textContent)`), `${tag}: first result matches as you type`);
    ok(await ev(`getComputedStyle(document.querySelector('.kblib-personal')).display==='none'`), `${tag}: "Your library" steps aside while searching`);
    await shot(f + '-discover');
    await type('#kblibQ', '');
    ok(await ev(`getComputedStyle(document.querySelector('.kblib-intro')).display!=='none'&&getComputedStyle(document.querySelector('.kblib-personal')).display!=='none'`), `${tag}: clearing the search brings Discover back`);
    await ev(`SB.openRef('aware')`); await sleep(400);
    await type('#kblibToolSearch', 'cef');
    ok(await visible('#sbrefBody .aware-card:not([hidden])'), `${tag}, keyboard up: AWaRe results show under the search box`);
    await shot(f + '-aware');
    await ev(`SB.openRef('protocols')`); for (let i = 0; i < 40; i++) { if (await ev(`!!document.querySelector('#kbpQ') && !!document.querySelector('#kbpList .kbp-row')`)) break; await sleep(200); }
    await type('#kbpQ', 'sepsis');
    for (let i = 0; i < 30; i++) { if (await ev(`!!document.querySelector('#kbpList .kbp-row')`)) break; await sleep(200); }
    ok(await visible('#kbpList .kbp-row'), `${tag}, keyboard up: Protocols results show under the search box`);
    await shot(f + '-protocols');
    await ev(`document.activeElement?.blur()`);
  }
} catch (e) { console.log('ERR', e.message); failures++; }
finally { chrome.kill(); server.kill(); console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS'); setTimeout(() => process.exit(failures ? 1 : 0), 300); }
