// Real-browser test: every Clinical Tools icon on Home moves (like OncoTree), each kind with its own
// motion, staggered, paused off screen, still under reduced motion; SURGX stays static by its brief.
//   node test/run-home-live-icons-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9089, CDP = 9489, OUT = "/tmp/stewardmd-live";
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
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
async function shot(name) { await sleep(250); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile')`, 30000), 'home tools grid rendered');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  await sleep(800);
  const r = await ev(`(()=>{const tiles=[...document.querySelectorAll('#rnavToolsGrid .rnav-tile:not(.addtool)')];const out=tiles.map(t=>{const a=t.getAttribute('data-act'),live=t.querySelector('.rnav-badge .ai-live'),anim=t.querySelector('.rnav-badge .ai-anim,.ai-clinix-img'),img=t.querySelector('.rnav-badge img');return {a,live:!!live,name:live?getComputedStyle(live).animationName:'',moving:!!anim||(!!live&&getComputedStyle(live).animationName!=='none')||(!!img&&getComputedStyle(img).animationName!=='none'),brand:!!img,locked:t.classList.contains('role-locked')}});return out})()`);
  const still = r.filter(t => !t.moving && !t.locked);
  ok(r.length >= 6 && still.length === 0, `every unlocked Clinical Tools icon moves (${r.length} tiles; still: ${JSON.stringify(still.map(t => t.a))})`);
  ok(new Set(r.filter(t => t.live).map(t => t.name)).size >= 3, 'the motions differ by kind of tool: ' + [...new Set(r.filter(t => t.live).map(t => t.name))].join(', '));
  ok(await ev(`(()=>{const b=document.querySelector('#rnavToolsGrid .rnav-tile[data-act="surgx"] .rnav-badge');if(!b)return 'absent';const a=getComputedStyle(b,'::after'),i=getComputedStyle(b.querySelector('.ai-surgx-img'));return a.animationName==='surgxGlint'&&/surgx-logo/.test(a.maskImage||a.webkitMaskImage)&&i.animationName==='surgxEdge'})()`) === true, 'SURGX shines like a knife: a glint clipped to the blade, and the edge lights up');
  const delays = await ev(`[...document.querySelectorAll('#rnavToolsGrid .ai-live')].map(e=>getComputedStyle(e).animationDelay)`);
  ok(new Set(delays).size > 1, 'tiles are staggered, not in unison');
  await ev(`document.getElementById('homeV2').classList.add('hv-still');1`);
  ok(await ev(`[...document.querySelectorAll('#rnavToolsGrid .ai-live')].every(e=>getComputedStyle(e).animationPlayState==='paused')`), 'paused when the home is not on screen (energy rule)');
  await ev(`document.getElementById('homeV2').classList.remove('hv-still');1`);
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  ok(await ev(`[...document.querySelectorAll('#rnavToolsGrid .ai-live')].every(e=>getComputedStyle(e).animationName==='none')`), 'reduced motion: no tile moves');
  await call('Emulation.setEmulatedMedia', { features: [] });
  await ev(`document.querySelector('#rnavToolsGrid').scrollIntoView({block:'start'});1`);
  await shot('tiles');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
