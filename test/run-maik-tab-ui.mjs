// Real-browser test: the bottom-nav "Ask Maik" tab shows the MaiK mark (maik-ai-mark.png), light + dark.
//   node test/run-maik-tab-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9093, CDP = 9493, OUT = "/tmp/stewardmd-maiktab";
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
async function tabShot(name) { await sleep(300); await ev(`(()=>{['smdBootSplash','introPoster'].forEach(function(i){const b=document.getElementById(i);if(b)b.style.display='none'});return 1})()`); await mkdir(OUT, { recursive: true }); const rc = await ev(`(()=>{const t=document.querySelector('#homeV2.rnav .rnav-tab-maik');const bar=t.closest('.rnav-tabbar')||t.parentNode;const r=bar.getBoundingClientRect();const c=t.getBoundingClientRect();let top=document.elementFromPoint(c.left+c.width/2,c.top+c.height/2);let guard=0;while(top&&!t.contains(top)&&guard++<10){let o=top;while(o.parentElement&&o.parentElement!==document.body)o=o.parentElement;o.style.display='none';top=document.elementFromPoint(c.left+c.width/2,c.top+c.height/2);}return {x:r.left,y:Math.max(0,r.top-24),w:r.width,h:r.height+24}})()`);
  const r = await call('Page.captureScreenshot', { format: 'png', clip: { x: rc.x, y: rc.y, width: rc.w, height: rc.h, scale: 2 } }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until(`!!document.querySelector('#homeV2.rnav .rnav-tab-maik')`, 30000), 'bottom nav rendered');
  ok(await until(`(()=>{const i=document.querySelector('.rnav-tab-maik .rnav-maik-mark img');return !!i&&i.complete&&i.naturalWidth>0})()`, 8000), 'Ask Maik tab shows the MaiK mark image, loaded');
  ok(await ev(`!/auto_awesome/.test(document.querySelector('.rnav-tab-maik').textContent)`), 'old sparkle glyph gone');
  ok(await ev(`document.querySelector('.rnav-tab-maik').getAttribute('aria-label')==='Ask Maik' && /Ask Maik/.test(document.querySelector('.rnav-tab-maik').innerText)`), 'label and accessible name kept');
  ok(await ev(`(()=>{const r=document.querySelector('.rnav-maik-mark img').getBoundingClientRect(),c=document.querySelector('.rnav-maik-mark').getBoundingClientRect();return r.width>=22&&r.width<=30&&r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom})()`), 'mark sits inside the teal circle');
  await tabShot('light');
  await ev(`document.body.classList.add('dark');1`); await tabShot('dark');
  ok(await ev(`(()=>{const i=document.querySelector('.rnav-maik-mark img');return i.naturalWidth>0&&getComputedStyle(i).display!=='none'})()`), 'mark still visible in dark mode');
  await ev(`document.querySelector('.rnav-tab-maik').click();1`);
  ok(await until(`!!document.getElementById('maikSheet')`, 8000), 'tapping it still opens Ask Maik');
} catch (e) { console.error(e); failures++; }
finally { try { ws?.close(); } catch {} chrome.kill('SIGKILL'); server.close(); console.log(failures ? `\n${failures} FAILED` : '\nALL PASS'); process.exit(failures ? 1 : 0); }
