// Real-browser test: Knowledge Base library follows the visible viewport when the iOS keyboard pans the page
// (search box and close bar were left under the status bar). The harness has no soft keyboard, so the
// shrunken/panned visual viewport is fed in through SMD_kbFitViewport.
//   node test/run-kb-keyboard-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9095, CDP = 9495, OUT = "/tmp/stewardmd-kbkeys";
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
  ok(await until('!!window.SB && !!window.SMD_kbFitViewport && !!window.KB_ENRICHMENT', 40000), 'app loaded with the library');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)&&document.getElementById(k).remove());SB.openRef('syndromes');1`);
  ok(await until(`!!document.querySelector('#sbrefOverlay .kblib-discover') && !!document.getElementById('kblibQ')`, 20000), 'library open with its search box');
  ok(await until(`getComputedStyle(document.getElementById('sbrefOverlay')).opacity==='1'`, 5000), 'open animation finished');
  await sleep(900);   // the overlay opens with a short scale-in
  const st = () => ev(`(()=>{const o=document.getElementById('sbrefOverlay');return o.style.top+'|'+o.style.height+'|'+o.style.bottom})()`);
  ok(await st() === '||', 'idle: overlay is plain inset:0 (no inline sizing)');
  // The keyboard rises and iOS pans the page 300 px: the visible area is y 300..800 of the layout viewport.
  await ev(`SMD_kbFitViewport({height:500,offsetTop:300});1`);
  ok(await st() === '300px|500px|auto', 'keyboard up + page panned: overlay follows the visible area');
  ok(await ev(`(()=>{const o=document.getElementById('sbrefOverlay');return parseFloat(getComputedStyle(o).height)===500&&parseFloat(getComputedStyle(o).top)===300})()`), 'and really lays out there (top 300, height 500)');
  ok(await ev(`(()=>{const b=document.getElementById('sbrefBody');return b.scrollHeight>b.clientHeight||b.clientHeight>0})()`), 'body stays scrollable inside the shortened overlay');
  // Keyboard down.
  await ev(`SMD_kbFitViewport({height:844,offsetTop:0});1`);
  ok(await st() === '||', 'keyboard down: overlay back to inset:0');
  // Duplicate "Management": a reference disease printed its treatment list twice (glance accordion + numbered section).
  const id = await ev(`Object.keys(KB_ENRICHMENT.byId).find(k=>{const h=KB_ENRICHMENT.byId[k];return h.class==='infective'&&!(window.SYNDROMES||{})[k]&&h.management&&h.management.length&&!(window.DX_MGMT||{})[k]})||Object.keys(KB_ENRICHMENT.byId).find(k=>{const h=KB_ENRICHMENT.byId[k];return h.class==='infective'&&!(window.SYNDROMES||{})[k]&&h.management&&h.management.length})`);
  await ev(`SMD_REASON.openRef(${JSON.stringify(id)},{standalone:true});1`);
  ok(await until(`!!document.querySelector('.dx-reader .dx-reader-content')`, 8000), 'reference disease page open: ' + id);
  ok(await ev(`(()=>{const t=document.querySelector('.dx-reader').innerText;const n=(t.match(/OBSERVE|FLUCONAZOLE|first-line/gi)||[]).length;return document.querySelectorAll('.dx-reader details > summary').length>=0 && ![...document.querySelectorAll('.dx-reader summary')].some(s=>/^Management$/.test(s.textContent.trim()))&&document.querySelectorAll('.dx-reader .dx-mgmt-tx').length===1})()`), 'management list appears once (no duplicate accordion)');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
