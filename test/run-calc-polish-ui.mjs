// Real-browser test: the Clinical Calculators list after the 2026-11-11 polish. Same screen as before; this
// guards the defects that were repaired: an unreadable selected chip, search and categories scrolling away,
// and a star and chevron that were not centred on the row.
//   node test/run-calc-polish-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9094, CDP = 9494;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('404'); return; } res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/calcpolish-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
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
  ok(await until(`!!(window.MEDCALC&&window.ICONS&&document.querySelector('#homeV2'))`, 30000), 'app loaded');
  await ev(`window.MEDCALC.openList();1`);
  ok(await until(`!!document.querySelector('#mcList .mc-card')`, 10000), 'calculator list rendered');
  const lum = `(c=>{const m=c.match(/[\\d.]+/g).map(Number);const v=(/^color/.test(c)?m.slice(0,3).map(x=>x*255):m.slice(0,3)).map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]})`;
  const chip = await ev(`(()=>{const L=${lum};const e=document.querySelector('#mcCats .mc-cat.on'),c=getComputedStyle(e);const a=L(c.color),b=L(c.backgroundColor);return {t:e.textContent.trim(),r:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),sh:c.boxShadow}})()`);
  ok(chip.t === 'All' && chip.r >= 4.5, `selected chip is readable (contrast ${chip.r.toFixed(1)}:1)`);
  ok(!/30px/.test(await ev(`getComputedStyle(document.querySelector('#mcCats .mc-cat:not(.on)')).boxShadow`)), 'chips carry no 30px drop shadow (it was clipped into a grey band)');
  ok(await ev(`!document.querySelector('.mc-body #mcSearch')&&!document.querySelector('.mc-body #mcCats')&&!!document.querySelector('.mc-pin #mcSearch')&&!!document.querySelector('.mc-pin #mcCats')`), 'search and categories sit outside the scrolling list');
  await ev(`document.querySelector('#mcOverlay .mc-body').scrollTop=1500;1`);
  const pin = await ev(`(()=>{const r=document.getElementById('mcCats').getBoundingClientRect(),b=document.querySelector('#mcOverlay .mc-body');return {top:r.top,st:b.scrollTop,h:innerHeight}})()`);
  ok(pin.st > 1000 && pin.top > 0 && pin.top < pin.h / 2, 'categories stay on screen after scrolling the list');
  await ev(`document.querySelector('#mcCats .mc-cat[data-cat="Renal"]').click();1`);
  ok(await until(`document.querySelector('#mcCats .mc-cat.on').getAttribute('data-cat')==='Renal'&&[...document.querySelectorAll('#mcList .mc-card')].length>5`), 'a category chip still filters the list');
  const geo = `(c=>{const h=c.querySelector('.mc-card-head').getBoundingClientRect(),v=c.querySelector('.mc-chev').getBoundingClientRect(),s=c.querySelector('.mc-star').getBoundingClientRect(),m=(h.top+h.bottom)/2;return {dc:Math.abs((v.top+v.bottom)/2-m),ds:Math.abs((s.top+s.bottom)/2-m),sw:s.width,sh:s.height,order:s.right<=v.left+1}})`;
  const g1 = await ev(`${geo}(document.querySelector('#mcList .mc-card'))`);
  ok(g1.dc < 1.5 && g1.ds < 1.5 && g1.order, 'star and chevron are centred on the row, star before chevron');
  ok(g1.sw >= 40 && g1.sh >= 40, `star touch target is full size (${Math.round(g1.sw)}x${Math.round(g1.sh)})`);
  await ev(`document.querySelector('#mcList [data-open="crcl"]').click();1`);
  ok(await until(`!!document.getElementById('mcPanel_crcl')&&!!document.getElementById('mcCalc_crcl')`), 'tapping a row still opens its calculator');
  const g2 = await ev(`${geo}(document.querySelector('#mcList .mc-card.open'))`);
  ok(g2.dc < 1.5 && g2.ds < 1.5, 'open calculator: star and chevron stay on the title row');
  await ev(`document.querySelector('#mcList [data-fav="crcl"]').click();1`);
  ok(await until(`JSON.parse(localStorage.getItem('smd_watch_calc_favs')||'[]').indexOf('crcl')>=0&&document.querySelector('#mcList [data-fav="crcl"]').classList.contains('on')`), 'the star still saves a favourite');
  await ev(`(()=>{const s=document.getElementById('mcSearch');s.value='sodium';s.dispatchEvent(new Event('input'));})();1`);
  ok(await until(`/Results/i.test(document.querySelector('#mcList .mc-grp-h').textContent)&&document.getElementById('mcCats').style.display==='none'`), 'search still shows a flat results list');
  await ev(`document.getElementById('mcClose').click();1`);
  ok(await until(`!document.getElementById('mcOverlay').classList.contains('on')`), 'Close still closes the screen');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
