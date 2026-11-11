// Real-browser test: the "MaiKnowledge" credit under Home keeps its script face (Sacramento) whichever
// font the doctor picks in Settings. The app-wide font rule (html[data-font] body *) once flattened it.
//   node test/run-maik-wordmark-font-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9093, CDP = 9493;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('404'); return; } res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/mkfont-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
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
  ok(await until(`!!document.querySelector('.v4-maik-name .mk-s')`, 30000), 'home footer credit rendered');
  for (const font of ['plex', 'system', 'arial', 'serif', 'atkinson', 'lexend', 'inter']) {
    await ev(`localStorage.setItem('smd_display_v1',JSON.stringify({fontScale:1,density:'default',theme:'classic',font:${JSON.stringify(font)},headingStyle:'default'}));1`);
    await call('Page.navigate', { url: `http://localhost:${PORT}/` });
    await until(`!!document.querySelector('.v4-maik-name .mk-s')`, 30000);
    const want = font === 'plex' ? null : font;
    await until(`document.documentElement.getAttribute('data-font')===${JSON.stringify(want)}`, 10000);
    const r = await ev(`(async()=>{const s=document.querySelector('.v4-maik-name .mk-s'),b=document.querySelector('.v4-maik-name .mk-b');try{await document.fonts.load("25px Sacramento")}catch(e){}return {attr:document.documentElement.getAttribute('data-font'),s:getComputedStyle(s).fontFamily,b:getComputedStyle(b).fontFamily,loaded:document.fonts.check("25px Sacramento")}})()`);
    ok(r.attr === want && /^"?Sacramento/.test(r.s) && r.loaded, `font "${font}": "nowledge" stays in Sacramento (${r.s})`);
    if (want) ok(!/Sacramento/.test(r.b), `font "${font}": the chosen font still applies to the rest ("MaiK" is ${r.b})`);
  }
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
