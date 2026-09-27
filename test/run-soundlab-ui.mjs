// Real-browser test (QA sheet SMD-05/06): Sound Lab plays within 100 ms of the tap (engine prewarmed,
// output woken on pointerdown) and shows a live waveform drawn from the audio output, which goes when it ends.
//   node test/run-soundlab-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9087, CDP = 9487, OUT = "/tmp/stewardmd-sound";
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('404'); return; } res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/abg-chrome-${process.pid}`, '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'], { stdio: 'ignore' });
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
async function shot(name) { await sleep(250); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until('!!(window.CLINIX && window.SMD_CLINIX_AUDIO)', 30000), 'app and the audio engine loaded');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  await ev(`window.CLINIX.open()`); await sleep(800);
  await ev(`document.querySelector('[data-act="cx-soundlab"]')?.click() || SMD_CLINIX_SCREENS.go('soundlab');1`);
  ok(await until(`!!document.querySelector('[data-act="cx-audio"]')`), 'Sound Lab open');
  ok(await ev(`!!SMD_CLINIX_AUDIO.now && SMD_CLINIX_AUDIO.now() >= 0 && typeof SMD_CLINIX_AUDIO.prewarm==='function'`), 'SMD-05 the audio engine is built when the Sound Lab opens');
  // A real press: pointerdown (wakes the output) then click, through CDP input events.
  const box = await ev(`(()=>{const b=document.querySelector('[data-act="cx-audio"][data-id="normal_heart"]')||document.querySelector('[data-act="cx-audio"]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();window.__kind=b.getAttribute('data-id');return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  const lat = await ev(`(()=>{const h=SMD_CLINIX_AUDIO.current();return h?{lead:h.startsAt-SMD_CLINIX_AUDIO.now(),kind:h.kind,state:SMD_CLINIX_AUDIO.unlock().state}:null})()`);
  ok(!!lat && lat.kind === await ev('window.__kind'), 'SMD-05 the tap starts the sound: ' + JSON.stringify(lat));
  ok(!!lat && lat.lead <= 0.1, `SMD-05 sound is scheduled within 100 ms of the tap (${lat && (lat.lead * 1000).toFixed(0)} ms)`);
  ok(await until(`!!document.querySelector('canvas.cx-wave')`), 'SMD-06 a live waveform appears on the playing card');
  await sleep(1200);
  const ink = await ev(`(()=>{const c=document.querySelector('canvas.cx-wave');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return {n,w:c.width}})()`);
  ok(ink.n > ink.w * 4, 'SMD-06 the waveform is drawn from the sound as it plays (' + ink.n + ' inked px)');
  await shot('soundlab-wave');
  ok(await until(`!document.querySelector('canvas.cx-wave') && !/\\bStop\\b/.test(document.querySelector('[data-act="cx-audio"][data-id="'+window.__kind+'"]').textContent)`, 15000), 'SMD-06 when the sound ends, the trace and the Stop label go');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
