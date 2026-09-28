// Real-browser test: the Home 'All tools' sheet lists every tool, opens one directly (without pinning
// it to Home), pins and unpins from the row, filters, and leads to Customize.
//   node test/run-all-tools-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9094, CDP = 9494, OUT = "/tmp/stewardmd-alltools";
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
  const tile = await ev(`(()=>{const t=document.querySelector('#rnavToolsGrid .rnav-tile.addtool');return t?{act:t.dataset.act,txt:t.innerText.replace(/\\s+/g,' ')}:null})()`);
  ok(tile && tile.act === 'alltools' && /All tools/.test(tile.txt), 'the last Home tile is "All tools": ' + JSON.stringify(tile));
  await ev(`document.querySelector('#rnavToolsGrid .rnav-tile.addtool').click();1`);
  ok(await until(`document.querySelector('#hvSheet.on .hv-at-list')`), 'tapping it opens the All tools sheet');
  const n = await ev(`document.querySelectorAll('#hvSheet .hv-at-row').length`), shown = await ev(`document.querySelectorAll('#rnavToolsGrid .rnav-tile:not(.addtool)').length`);
  ok(n > shown, `the list has every tool (${n}), more than the ${shown} pinned on Home`);
  // Open a tool that is NOT on Home straight from the list.
  const hidden = await ev(`(()=>{const on=new Set([...document.querySelectorAll('#rnavToolsGrid .rnav-tile')].map(t=>t.dataset.act));const r=[...document.querySelectorAll('#hvSheet .hv-at-row')].find(r=>!on.has(r.dataset.at)&&r.dataset.at==='syndromes')||[...document.querySelectorAll('#hvSheet .hv-at-row')].find(r=>!on.has(r.dataset.at));return r?r.dataset.at:''})()`);
  ok(!!hidden, 'a tool that is not on Home is listed: ' + hidden);
  await ev(`document.querySelector('#hvSheet [data-at-open="${hidden}"]').click();1`);
  ok(await until(`!document.querySelector('#hvSheet.on')`), 'the sheet closes');
  const opened = await until(`(()=>{const h=document.getElementById('homeV2');const cover=[...document.querySelectorAll('body > *')].filter(e=>e!==h&&e.id!=='hvSheet'&&e.id!=='hvScrim'&&getComputedStyle(e).position==='fixed'&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>300);return cover.length>0||!h.classList.contains('on')})()`, 8000);
  ok(opened, 'the tool opens without being added to Home first');
  ok(await ev(`!document.querySelector('#rnavToolsGrid .rnav-tile[data-act="${hidden}"]')`), 'Home is unchanged (the tool was not pinned)');
  await ev(`try{closeAllModules&&closeAllModules()}catch(e){};document.querySelectorAll('body > [id]').forEach(e=>{});1`);
  // Pin from the list: it appears on Home; unpin: it goes.
  await ev(`SMD_openRoute('alltools');1`);
  ok(await until(`document.querySelector('#hvSheet.on .hv-at-list')`), 'search route "alltools" opens the same sheet');
  await ev(`document.querySelector('#hvSheet [data-at-pin="${hidden}"]').click();1`);
  ok(await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile[data-act="${hidden}"]')`), 'the pin adds the tool to Home');
  ok(await ev(`document.querySelector('#hvSheet [data-at-pin="${hidden}"]').classList.contains('on')`), 'the pin shows as on');
  await ev(`document.querySelector('#hvSheet [data-at-pin="${hidden}"]').click();1`);
  ok(await until(`!document.querySelector('#rnavToolsGrid .rnav-tile[data-act="${hidden}"]')`), 'tapping the pin again removes it from Home');
  // Filter box
  await ev(`(()=>{const q=document.getElementById('hvAtQ');q.value='calc';q.dispatchEvent(new Event('input',{bubbles:true}))})();1`);
  const vis = await ev(`[...document.querySelectorAll('#hvSheet .hv-at-row')].filter(r=>!r.hidden).map(r=>r.dataset.at)`);
  ok(vis.length >= 1 && vis.length < n && vis.includes('calculators'), 'the filter narrows the list: ' + vis.join(','));
  await ev(`(()=>{const q=document.getElementById('hvAtQ');q.value='zzzz';q.dispatchEvent(new Event('input',{bubbles:true}))})();1`);
  ok(await ev(`!document.querySelector('#hvSheet .hv-at-none').hidden`), 'no match says so');
  await ev(`(()=>{const q=document.getElementById('hvAtQ');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})();1`);
  await shot('alltools');
  ok(!/—/.test(await ev(`document.getElementById('hvSheet').innerText`)), 'no em dash');
  await ev(`document.querySelector('#hvSheet [data-at-cust]').click();1`);
  ok(await until(`/Customize tools/.test(document.querySelector('#hvSheet').innerText)&&!!document.querySelector('#hvSheet .hv-tool-tog')`), 'Customize inside the sheet opens the reorder sheet');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
