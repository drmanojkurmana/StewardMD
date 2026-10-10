// Real-browser test: MaiK Stop ends every thinking orb (owner screenshot 2026-10-10: two "Searching StewardMD
// knowledge" orbs spinning for minutes, Stop doing nothing), and a saved thread's orphaned orb is cleared on reopen.
//   node test/run-maik-stop-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9094, CDP = 9494, OUT = "/tmp/stewardmd-maikstop";
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const hung = [];
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); 
  if (/^\/api\/ai\/explain/.test(p)) { hung.push(res); return; }   // an answer that never comes: the turn stays in flight
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
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
async function shot(name) { await sleep(250); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
const ORPHAN = `<div class="maik-b you">Dose of ivig</div><div class="maik-b ai" data-mg="mgdead1"><div class="maik-buffer maik-thinking"><div class="maik-buffer-head"><span class="maik-buffer-txt">Searching StewardMD knowledge</span></div></div></div>`;
const orbs = () => ev(`document.querySelectorAll('#maikBody .maik-buffer').length`);
const openMaik = async () => { await click('#homeV2.rnav .rnav-tab-maik'); return until(`!!document.querySelector('#maikSheet.on #maikQ')`, 8000); };
const closeMaik = async () => { await click('#maikClose'); return until(`!document.getElementById('maikSheet')`, 4000); };
const ask = async (q) => ev(`(()=>{const e=document.getElementById('maikQ');e.value=${JSON.stringify(q)};e.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('maikSend').click();return 1})()`);
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until(`!!document.querySelector('#homeV2.rnav .rnav-tab-maik')`, 30000), 'app loaded');
  // Cloud answers on localhost need the proxy base; a prior AI consent so privacy.js does not wait on a tick.
  await ev(`window.AI_PROXY='/api/ai';localStorage.setItem('smd_consent_guest',JSON.stringify({consentAcceptedAt:'2026-01-01',clinicalAuthorityConfirmedAt:'2026-01-01'}));try{SMD_MAIK_ENGINE.setPref('cloud')}catch(e){};1`);
  await ev(`['smdBootSplash','introPoster'].forEach(function(i){const b=document.getElementById(i);if(b)b.style.display='none'});1`);

  // 1) A thread saved with a "Searching" bubble whose turn died (app reloaded): cleared on reopen.
  ok(await openMaik(), 'MaiK opens');
  await ev(`(()=>{const b=document.getElementById('maikBody');b.insertAdjacentHTML('beforeend',${JSON.stringify(ORPHAN)});return 1})()`);
  ok(await orbs() === 1, 'orphaned orb planted');
  await closeMaik(); ok(await openMaik(), 'MaiK reopens with the saved thread');
  ok(await orbs() === 0, 'orphaned orb cleared on reopen');
  ok(/This answer was interrupted/.test(await text('#maikBody')), 'it says the answer was interrupted');
  ok(/Dose of ivig/.test(await text('#maikBody')), 'the question itself is kept');

  // 2) A live question, then Stop: the orb ends at once, even with a stray orb elsewhere in the thread.
  await ask('Dose of ivig');
  ok(await until(`document.querySelectorAll('#maikBody .maik-buffer').length===1 && document.getElementById('maikSend').classList.contains('stopping')`, 8000), 'question in flight, Send became Stop');
  await ev(`(()=>{document.getElementById('maikBody').insertAdjacentHTML('beforeend','<div class="maik-b ai"><div class="maik-buffer maik-thinking"><span class="maik-buffer-txt">Searching StewardMD knowledge</span></div></div>');return 1})()`);
  ok(await orbs() === 2, 'two orbs showing (the in-flight one and a stray one)');
  await click('#maikSend');
  ok(await until(`document.querySelectorAll('#maikBody .maik-buffer').length===0`, 3000), 'Stop clears EVERY orb');
  ok(await ev(`!document.getElementById('maikSend').classList.contains('stopping')`), 'Stop turns back into Send');
  ok(/Stopped/.test(await text('#maikBody')), 'says Stopped');
  await shot('stopped');

  // 3) In flight, close, reopen, Stop: the reopened sheet's Stop ends the turn started before the close.
  await ask('Dose of ivig in kawasaki');
  ok(await until(`document.querySelectorAll('#maikBody .maik-buffer').length===1`, 8000), 'second question in flight');
  await closeMaik(); ok(await openMaik(), 'reopened while answering');
  ok(await until(`document.getElementById('maikSend').classList.contains('stopping')`, 3000), 'reopened sheet shows Stop');
  ok(await orbs() === 1, 'the live turn is NOT treated as an orphan');
  await click('#maikSend');
  ok(await until(`document.querySelectorAll('#maikBody .maik-buffer').length===0`, 3000), 'Stop after reopen clears the orb');
  // 4) A new question afterwards works and gets its own orb.
  await ask('Dose of ivig in ITP');
  ok(await until(`document.querySelectorAll('#maikBody .maik-buffer').length===1`, 8000), 'a new question after Stop starts normally');
  await click('#maikSend');
  ok(await until(`document.querySelectorAll('#maikBody .maik-buffer').length===0`, 3000), 'and can be stopped too');
} catch (e) { console.error(e); failures++; }
finally { hung.forEach((r) => { try { r.destroy(); } catch {} }); try { ws?.close(); } catch {} chrome.kill('SIGKILL'); server.close(); console.log(failures ? `\n${failures} FAILED` : '\nALL PASS'); process.exit(failures ? 1 : 0); }
