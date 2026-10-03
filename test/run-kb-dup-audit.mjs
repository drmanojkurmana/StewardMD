// Real-browser audit of ALL ~2,400 disease reader pages for repeated sections / list items (the "Management shown twice" bug).
//   node test/run-kb-dup-audit.mjs
// (header below is copied from the keyboard test) Real-browser test: Knowledge Base library follows the visible viewport when the iOS keyboard pans the page
// (search box and close bar were left under the status bar). The harness has no soft keyboard, so the
// shrunken/panned visual viewport is fed in through SMD_kbFitViewport.
//   node test/run-kb-dup-audit.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9096, CDP = 9496, OUT = "/tmp/stewardmd-kbkeys";
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
  ok(await until('!!window.SB && !!window.SMD_REASON && !!window.KB_ENRICHMENT', 40000), 'app loaded');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)&&document.getElementById(k).remove());1`);
  const ids = await ev(`(()=>{const s=new Set(Object.keys(KB_ENRICHMENT.byId));Object.keys(window.SYNDROMES||{}).forEach(k=>s.add(k));return [...s]})()`);
  await ev(`window.__r={};window.__a=function(ids){ids.forEach(function(id){try{SMD_REASON.openRef(id,{standalone:true});var r=document.querySelector('.dx-reader');var n=function(e){return e.textContent.replace(/\\s+/g,' ').trim().toLowerCase()};
   var seen={},kinds={};[].forEach.call(r.querySelectorAll('p,li,.dx-mgmt-sec,summary,h3,h4,button.dx-select'),function(e){var t=n(e);if(t.length<25)return;if(e.closest('.ev-viewer-collapsed'))return;if(seen[t]){kinds[e.tagName+':'+t.slice(0,40)]=1}seen[t]=1});
   var mg=[].filter.call(r.querySelectorAll('summary,.dx-mgmt-sec,button.dx-select'),function(e){return /^\\s*(management|open full)/i.test(e.textContent.replace(/[^a-z /]/gi,' ').trim())}).map(function(e){return e.textContent.replace(/\\s+/g,' ').trim().slice(0,30)});
   var H=(KB_ENRICHMENT.byId||{})[id],dm=(window.DX_MGMT||{})[id];var has=!!((window.SYNDROMES||{})[id]||(dm&&dm.tx&&dm.tx.length)||(H&&H.management&&H.management.length));
   window.__r[id]={dups:Object.keys(kinds),mg:mg,has:has,old:!!r.querySelector('button.dx-select[data-sel]'),syn:!!(window.SYNDROMES||{})[id],rx:r.querySelectorAll('.dx-mgmt-tx li').length}}catch(e){}})};1`);
  for (let i = 0; i < ids.length; i += 200) await ev(`__a(${JSON.stringify(ids.slice(i, i + 200))});1`);
  const R = await ev(`__r`); const agg = {}; let multi = 0, dupPages = 0;
  Object.entries(R).forEach(([id, v]) => { if (v.dups.length) { dupPages++; v.dups.forEach(d => { const k = d.slice(0, 22); (agg[k] = agg[k] || []).push(id); }); } if (v.mg.length > 1) { multi++; } });
  console.log('pages', Object.keys(R).length, '| with repeated text', dupPages, '| with 2+ management entries', multi);
  Object.entries(agg).sort((a, b) => b[1].length - a[1].length).slice(0, 8).forEach(([k, v]) => console.log(v.length, k, v.slice(0, 2)));
  const lost = Object.entries(R).filter(([, v]) => v.has && v.mg.length !== 1).map(([k]) => k);
  console.log('pages with management data but not exactly one management entry:', lost.length, lost.slice(0, 5));
  ok(Object.keys(R).length >= 2400, 'audited every disease page');
  ok(dupPages === 0, 'no disease page repeats a sentence, list item or heading');
  ok(multi === 0, 'no disease page has two management entries (collapse + separate page)');
  const oldLink = Object.entries(R).filter(([, v]) => v.old).map(([k]) => k);
  ok(oldLink.length === 0, 'no disease page links to the old case page (' + oldLink.slice(0, 3) + ')');
  const synNo = Object.entries(R).filter(([, v]) => v.syn && v.mg.length !== 1).map(([k]) => k);
  ok(synNo.length === 0, 'every infective syndrome shows Management on its own page (' + synNo.slice(0, 3) + ')');
  ok(R.CAP && R.CAP.rx >= 3, 'CAP lists its regimens inline (' + (R.CAP && R.CAP.rx) + ' drugs)');
  ok(lost.length === 0, 'every disease with management data still shows it, exactly once');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
