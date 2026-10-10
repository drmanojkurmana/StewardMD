// Real-browser test: a cut-short MaiK answer says so, and "Know more" never repeats the bottom line already shown
// (owner, 2026-10-10: the answer stopped at a table header and Know more restated it and stopped there too).
//   node test/run-maik-knowmore-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9096, CDP = 9496, OUT = "/tmp/stewardmd-maikknow";
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const seen = [], MODE = { cut: true }, hung = [];
const LEAD = "**You're asking about the differential diagnosis for organophosphate/cholinergic poisoning.** The key is recognizing the cholinergic toxidrome.\n\nHere's a breakdown of conditions that can mimic organophosphate poisoning:\n\n| Diagnosis/Option | Distinguishing Features";
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); 
  if (/^\/api\/ai\/explain/.test(p)) {
    let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
      let b = {}; try { b = JSON.parse(raw); } catch {}
      seen.push({ tier: b.tier || 0, priorLead: !!b.priorLead });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (b.tier === 2) res.end(JSON.stringify({ text: LEAD + "\n\n**Rationale**\nCholinesterase inhibition causes the cholinergic toxidrome.\n\n| Option | Feature |\n|---|---|\n| Carbamate | Short course |", sources: [] }));
      else res.end(JSON.stringify({ text: LEAD, cutShort: MODE.cut || undefined, sources: [] }));
    }); return;
  }
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
async function shot(name) { await sleep(250); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
const ask = async (q) => ev(`(()=>{const e=document.getElementById('maikQ');e.value=${JSON.stringify(q)};e.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('maikSend').click();return 1})()`);
const bubbleText = () => ev(`(()=>{const a=[...document.querySelectorAll('#maikBody .maik-b:not(.you)')];return a.length?a[a.length-1].innerText:''})()`);
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until(`!!document.querySelector('#homeV2.rnav .rnav-tab-maik')`, 30000), 'app loaded');
  await ev(`window.AI_PROXY='/api/ai';localStorage.setItem('smd_consent_guest',JSON.stringify({consentAcceptedAt:'2026-01-01',clinicalAuthorityConfirmedAt:'2026-01-01'}));try{SMD_MAIK_ENGINE.setPref('cloud')}catch(e){};['smdBootSplash','introPoster'].forEach(function(i){const b=document.getElementById(i);if(b)b.style.display='none'});1`);
  await click('#homeV2.rnav .rnav-tab-maik');
  ok(await until(`!!document.querySelector('#maikSheet.on #maikQ')`, 8000), 'MaiK open');
  await ask('differential diagnosis of organophosphate poisoning');
  ok(await until(`/Distinguishing Features/.test(document.getElementById('maikBody').innerText)`, 40000), 'the cut answer arrives');
  ok(await until(`!document.getElementById('maikSend').classList.contains('stopping')`, 15000), 'answer finished');
  ok(/This answer was cut short\. Tap Regenerate/.test(await bubbleText()), 'it says the answer was cut short, with what to do');
  ok(await until(`!!document.querySelector('#maikBody .maik-know')`, 10000), 'Know more is offered');
  await click('#maikBody .maik-know');
  ok(await until(`/Rationale/.test(document.getElementById('maikBody').innerText)`, 30000), 'Know more brings the detail');
  ok(await until(`/Short course/.test(document.getElementById('maikBody').innerText)`, 15000), 'the detail finishes typing out');
  const t = await bubbleText();
  ok((t.match(/You're asking about the differential diagnosis/g) || []).length === 1, 'the bottom line is NOT repeated in the detail (' + (t.match(/You're asking about the differential diagnosis/g) || []).length + ' times)');
  ok(/Carbamate/.test(t) && /Short course/.test(t), 'and the real detail, with its table, is there ');
  ok(seen.some((s) => s.tier === 2 && s.priorLead), 'the detail was asked for with the lead it must not repeat');
  await shot('knowmore');
} catch (e) { console.error(e); failures++; }
finally { try { ws?.close(); } catch {} chrome.kill('SIGKILL'); server.close(); console.log(failures ? `\n${failures} FAILED` : '\nALL PASS'); process.exit(failures ? 1 : 0); }
