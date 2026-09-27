// Real-browser test (bug SMD-DVVJVN): on the native app's first launch StewardMD asks once to download
// the voice model and the MaiK pack suited to the phone, then queues both in the background.
//   node test/run-first-resources-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9091, CDP = 9491, OUT = "/tmp/stewardmd-frs";
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
  ok(await until('!!(window.SMD_FIRST_RESOURCES && window.SMD_VOICE)', 30000), 'app loaded with the first-run resources module');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  ok(!(await ev(`!!document.getElementById('frsSheet')`)), 'on the web (not native) nothing is offered');
  // Pretend to be the native app: the voice and model plugins are stubbed, calls recorded.
  await ev(`(()=>{window.__calls=[];window.SMD_IS_NATIVE=true;
    window.SMD_NATIVE=Object.assign(window.SMD_NATIVE||{},{WHISPER_MODELS:{'small.en-q5_1':{bytes:190098681},'telugu-small-q8_0':{bytes:264464607},'small-q8_0':{bytes:264464607}},
      whisperModelInstalled:k=>Promise.resolve({installed:false}),downloadWhisperModel:k=>{__calls.push('voice:'+k);return Promise.resolve({installed:true})}});
    const M=window.SMD_MAIK_MODELS;M.refreshDevice=()=>Promise.resolve({ramGB:8});
    M.recommend=()=>({recommended:[{id:'bonsai-27b',label:'Too big',bytes:9e9,level:'warn'},{id:'maik-mxcore',label:'MAiK MxCore',bytes:2489894976,level:'ok',installed:false}],unsuitable:[]});
    M.ensure=id=>{__calls.push('pack:'+id);return Promise.resolve({installed:true})};
    SMD_FIRST_RESOURCES.reset();SMD_FIRST_RESOURCES.maybeAsk();})();1`);
  ok(await until(`!!document.getElementById('frsSheet')`, 12000), 'native first launch: the download prompt appears once Home is on screen');
  const txt = await ev(`document.getElementById('frsSheet').innerText`);
  ok(/Voice dictation/.test(txt) && /MAiK MxCore/.test(txt) && !/Too big/.test(txt), 'it offers the voice model and the pack suited to this phone (only an "ok" pack): ' + txt.replace(/\n/g, ' | '));
  ok(/Total 2\.\d GB/.test(txt), 'the total size is shown');
  ok(!/—/.test(txt), 'no em dash');
  await shot('prompt');
  await ev(`(()=>{const c=document.querySelector('[data-frs="pack"]');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))})();1`);
  ok(/Total \d+ MB/.test(await ev(`document.getElementById('frsTot').textContent`)), 'unticking the AI model updates the total');
  await ev(`(()=>{const c=document.querySelector('[data-frs="pack"]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-frs-act="go"]').click()})();1`);
  ok(await until(`__calls.includes('pack:maik-mxcore')&&__calls.some(c=>c.startsWith('voice:'))`), 'Download now queues both downloads: ' + JSON.stringify(await ev('__calls')));
  ok(await ev(`!document.getElementById('frsSheet')&&localStorage.getItem('smd_first_resources_asked')==='yes'`), 'the sheet closes and the answer is remembered');
  await ev(`__calls=[];SMD_FIRST_RESOURCES.maybeAsk();1`); await sleep(2600);
  ok(!(await ev(`!!document.getElementById('frsSheet')`)), 'it never asks again');
  await ev(`SMD_FIRST_RESOURCES.reset();SMD_FIRST_RESOURCES.maybeAsk();1`);
  ok(await until(`!!document.getElementById('frsSheet')`, 8000), '(reset) asked again');
  await ev(`document.querySelector('[data-frs-act="later"]').click();1`);
  ok(await ev(`localStorage.getItem('smd_first_resources_asked')==='no'&&__calls.length===0`), 'Not now downloads nothing and is remembered');
  await ev(`localStorage.setItem('smd_first_resources','0');SMD_FIRST_RESOURCES.reset();SMD_FIRST_RESOURCES.maybeAsk();1`); await sleep(2600);
  ok(!(await ev(`!!document.getElementById('frsSheet')`)), 'flag smd_first_resources=0 turns it off');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
