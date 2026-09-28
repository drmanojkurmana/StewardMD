// Real-browser test: the dose calculator (dose-calc.js) end to end, from the Drugs sheet, the drug
// page and an ICU patient. Serves data/dose-rules.json.gz at /dose-rules.json.gz like the www bundle.
//   node test/run-dose-calc-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9091, CDP = 9491, OUT = "/tmp/stewardmd-dosecalc";
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = p === '/dose-rules.json.gz' ? join(repo, 'data/dose-rules.json.gz') : join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('404'); return; } res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/abg-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failures++; };
const until = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch { /* page busy */ } await sleep(100); } return false; };
// A real key press through CDP (keyDown with its text fires keypress, which activates a button).
const key = async (k) => { const vk = k === 'Enter' ? 13 : 32, t = k === 'Enter' ? '\r' : ' '; await call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: t, unmodifiedText: t }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
const armToasts = () => ev(`window.__toasts=[];if(!window.toast||!window.toast.__rec){const t0=window.toast;const f=function(m){window.__toasts.push(String(m));try{return t0&&t0.apply(this,arguments)}catch(e){}};f.__rec=1;window.toast=f;}1`);
async function shot(name) { await sleep(250); await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?dosecalc=1` });
  ok(await until('!!window.SMD_DOSECALC && !!window.SMD_openRoute', 30000), 'app loaded with the dose calculator');
  // Flag OFF by default: without ?dosecalc=1 and no localStorage the calculator reports off.
  ok(await ev(`(()=>{try{localStorage.removeItem('smd_dose_calc')}catch(e){};history.replaceState(null,'','/');const a=SMD_DOSECALC.on();localStorage.setItem('smd_dose_calc','0');const b=SMD_DOSECALC.on();localStorage.removeItem('smd_dose_calc');history.replaceState(null,'','/?dosecalc=1');return a===true&&b===false})()`) === true, 'flag DEFAULT ON; smd_dose_calc=0 turns it off');
  // 1) Drugs sheet -> Dose calculator
  await ev(`SMD_openRoute('drugmenu');1`);
  ok(await until(`!!document.querySelector('[data-mi=dose]')`, 5000), 'Drugs sheet lists "Dose calculator"');
  await click('[data-mi=dose]');
  ok(await until(`!!document.querySelector('#doseCalc:not([hidden]) #dc_weight')`, 5000), 'calculator opens from the Drugs sheet');
  const typeIn = (id, v) => ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.focus();e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await typeIn('dc_weight', '55'); await typeIn('dc_age', '40');
  ok(await until(`!!document.querySelector('#doseCalc .dc-hit') || /Search a drug/.test(document.getElementById('dc_q').placeholder)`, 8000), 'drug search ready');
  await typeIn('dc_q', 'levothyrox');
  ok(await until(`!!document.querySelector('#doseCalc [data-drug^="Levothyroxine"]')`, 8000), 'search finds levothyroxine');
  await click('#doseCalc [data-drug^="Levothyroxine"]');
  ok(await until(`/88 mcg per day/.test(document.querySelector('#doseCalc .dc-body').innerText)`, 5000), "the owner's example: 55 kg -> 88 mcg per day");
  ok(/1\.6 mcg\/kg × 55 kg/.test(await text('#doseCalc .dc-body')), 'working shown (1.6 mcg/kg × 55 kg)');
  ok(!/—/.test(await text('#doseCalc')), 'no em dash in the calculator');
  await shot('levothyroxine');
  // Editing the weight recalculates in place and keeps focus.
  await typeIn('dc_weight', '60');
  ok(await until(`/96 mcg per day/.test(document.querySelector('#doseCalc .dc-body').innerText)`, 3000), 'weight change recalculates (60 kg -> 96 mcg)');
  ok(await ev(`document.activeElement && document.activeElement.id`) === 'dc_weight', 'focus stays in the weight field');
  // Kidney: meropenem at CrCl 20
  await click('#doseCalc [data-dc=change]'); await typeIn('dc_crcl', '20'); await typeIn('dc_q', 'meropenem');
  ok(await until(`!!document.querySelector('#doseCalc [data-drug="Meropenem"]')`, 5000), 'meropenem found');
  await click('#doseCalc [data-drug="Meropenem"]');
  ok(await until(`/Kidney/.test(document.querySelector('#doseCalc .dc-body').innerText) && /20 mL\\/min/.test(document.querySelector('#doseCalc .dc-body').innerText)`, 3000), 'kidney section uses the entered CrCl');
  await shot('meropenem-crcl20');
  // Close clears patient values.
  await click('#doseCalc [data-dc=close]');
  ok(await ev(`document.getElementById('doseCalc').hidden === true && !document.body.classList.contains('smd-dosecalc-open')`), 'close hides the calculator');
  // 2) Drug page button
  const btn = await ev(`SMD_DOSECALC.buttonHTML('Amikacin')`);
  ok(/data-dosecalc-drug="Amikacin"/.test(btn), 'drug page button rendered when the flag is on');
  await ev(`(()=>{const d=document.createElement('div');d.id='__dcb';d.innerHTML=SMD_DOSECALC.buttonHTML('Amikacin');document.body.appendChild(d);d.querySelector('button').click();return 1})()`);
  ok(await until(`/Amikacin/.test((document.querySelector('#doseCalc:not([hidden]) .dc-drug')||{}).innerText||'')`, 5000), 'drug page button opens the calculator on that drug');
  ok(await ev(`document.getElementById('dc_weight').value === ''`), 'patient values were cleared by the previous close');
  await typeIn('dc_weight', '120');
  ok(await until(`/1,500 mg per day/.test(document.querySelector('#doseCalc .dc-body').innerText)`, 3000), 'amikacin 120 kg capped at 1,500 mg per day');
  await click('#doseCalc [data-dc=close]'); await ev(`document.getElementById('__dcb').remove();1`);
  // 3) Prefilled patient (the ICU path) sits above the ICU layer
  await ev(`SMD_DOSECALC.open({source:'Bed 4', drug:'Meropenem', patient:{weight:70, age:60, ageUnit:'years', sex:'M', height:170, scr:1.2}});1`);
  ok(await until(`/61 mL\\/min/.test(document.querySelector('#doseCalc .dc-body').innerText)`, 5000), 'ICU prefill: creatinine 1.2 at 60 y M 70 kg -> CrCl 61');
  ok(/bed 4/i.test(await text('#doseCalc .dc-body h3')), 'source patient named in the card');
  ok(await ev(`+getComputedStyle(document.getElementById('doseCalc')).zIndex > 10000`), 'calculator stacks above #icuRoot (z-index 10000)');
  await shot('prefilled');
  await key('Enter'); await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));1`);
  ok(await ev(`document.getElementById('doseCalc').hidden === true`), 'Escape closes');
  // 4) Flag off: no entry points
  ok(await ev(`(()=>{history.replaceState(null,'','/?dosecalc=0');return SMD_DOSECALC.buttonHTML('Amikacin')===''&&!SMD_DOSECALC.on()})()`), 'flag off: no drug page button');
  // 5) Page layout: no horizontal overflow at 390 px
  await ev(`history.replaceState(null,'','/?dosecalc=1');SMD_DOSECALC.open();1`);
  ok(await until(`!!document.querySelector('#doseCalc:not([hidden]) #dc_weight')`, 3000) && await ev(`(()=>{const b=document.querySelector('#doseCalc .dc-body');return b.scrollWidth<=b.clientWidth+1})()`), 'no horizontal overflow at phone width');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
