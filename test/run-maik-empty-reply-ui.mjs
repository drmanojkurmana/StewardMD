// Real-browser test: an EMPTY /explain reply (owner screenshot 2026-10-04, "Reason: Failed to execute
// 'json' on 'Response': Unexpected end of JSON input") is retried once, then shown in plain words.
//   node test/run-maik-empty-reply-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9087, CDP = 9487;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let explainHits = 0;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // window.AI_PROXY points MaiK at /api/ai here. Empty 200 body, like the native bridge hands back.
  if (/\/explain$/.test(p) && req.method === 'POST') { explainHits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(''); return; }
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('404'); return; } res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/maik-empty-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failures++; };
const until = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch { /* page busy */ } await sleep(100); } return false; };
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until('!!(window.SMD_askMaik && window.SMD_AI)', 30000), 'app and MaiK loaded');
  await ev(`window.AI_PROXY="/api/ai";try{localStorage.setItem("smd_ai","1");if(SMD_AI.setFlag)SMD_AI.setFlag(true)}catch(e){};try{SMD_MAIK_ENGINE&&SMD_MAIK_ENGINE.setPref&&SMD_MAIK_ENGINE.setPref("cloud")}catch(e){};['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  await ev(`SMD_askMaik("");1`);
  ok(await until(`!!document.querySelector('#maikSheet #maikQ')`), 'MaiK sheet open');
  await sleep(600);
  await ev(`(()=>{const q=document.querySelector('#maikQ');q.value='How to treat organophosphate poisoning?';q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#maikSend')?.click()})();1`);
  const shown = await until(`/empty reply|unavailable/i.test((document.querySelector('#maikBody')||{}).innerText||'')`, 30000);
  const body = await ev(`(document.querySelector('#maikBody')||{}).innerText||''`);
  ok(shown, 'an answer bubble settled');
  ok(/empty reply/i.test(body), 'the notice says the reply was empty');
  ok(!/Unexpected end of JSON|on 'Response'/.test(body), 'the raw browser parse error is not shown');
  // 1 stream attempt + 2 JSON attempts (the old code stopped at 2: stream + one unguarded r.json()).
  ok(explainHits >= 3, `the JSON path retried once (explain requests: ${explainHits})`);
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
