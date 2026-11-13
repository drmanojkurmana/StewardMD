// Real-browser test: Today in Medical History (today-history.js). The home Pro banner flips to today's event
// and back every 5 s, a tap on the history face opens the sheet (today, day stepping, 29 February, Escape, focus
// return), the date as a way in, pause off screen and under the sheet, dark theme, reduced motion, kill switch.
//   node test/run-today-history-ui.mjs        (env: CHROME, PORT, CHROME_PORT, SHOTS)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = +process.env.PORT || 9131, CDP = +process.env.CHROME_PORT || 9531, OUT = process.env.SHOTS || "/tmp/stewardmd-todayhistory";
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
async function shot(name) { await sleep(300); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  const size = (w, h) => call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
  await size(390, 844);
  async function boot(setup, qs = '') {
    await call('Page.navigate', { url: `http://localhost:${PORT}/` });
    await until(`document.readyState==='complete'`, 30000);
    await ev(`localStorage.clear();sessionStorage.clear();${setup || ''};1`);
    await call('Page.navigate', { url: `http://localhost:${PORT}/${qs}` });
    ok(await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile') && !!window.SMD_TOOL_GROUPS && !!window.SMD_ROLE`, 30000), 'home rendered ' + (setup || 'fresh') + qs);
    await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
    await ev(`document.dispatchEvent(new Event('smd:role-changed'));1`); await sleep(200);
  }

  const today = await ev(`(()=>{const n=new Date();return n.getDate()+' '+['January','February','March','April','May','June','July','August','September','October','November','December'][n.getMonth()]})()`);
  const st = () => ev(`SMD_todayHistory._state()`);
  const backOn = (ms = 9000) => until(`document.getElementById('hrfBanner')?.classList.contains('th-back') && !SMD_todayHistory._state().busy`, ms);
  const frontOn = (ms = 9000) => until(`!document.getElementById('hrfBanner')?.classList.contains('th-back') && !SMD_todayHistory._state().busy`, ms);
  const bannerTop = () => ev(`document.getElementById('hrfBanner').scrollIntoView({block:'center'});1`);

  // 1. Launch: the banner shows its own face first, then flips to today's event after about 5 s.
  await boot('');
  const h0 = await ev(`document.getElementById('hrfBanner').getBoundingClientRect().height`);
  await sleep(2500);
  ok(await ev(`!document.getElementById('hrfBanner').classList.contains('th-back')`), 'front face first');
  ok(await backOn(6000), 'flips to history after about 5 s');
  await sleep(1200); await shot('01-banner-back-390');
  ok(await ev(`/This day in medical history/i.test(document.querySelector('#hrfBanner .th-face').innerText)`), 'history face shows the label');
  ok(await ev(`document.querySelector('#hrfBanner .th-face').innerText.toUpperCase().includes(${JSON.stringify(today.toUpperCase())})`), 'history face shows today');
  ok(await ev(`Math.abs(document.getElementById('hrfBanner').getBoundingClientRect().height-${h0})<1`), 'banner keeps its height');
  const inside = `(()=>{const b=document.getElementById('hrfBanner').getBoundingClientRect();return [...document.querySelectorAll('#hrfBanner .th-face-txt>*,#hrfBanner .th-face-go')].every(n=>{const q=n.getBoundingClientRect();return q.top>=b.top-1&&q.bottom<=b.bottom+1&&q.right<=b.right+1&&q.left>=b.left-1})})()`;
  ok(await ev(inside), 'history text inside the banner');
  ok(await ev(`(()=>{const t=document.querySelector('#hrfBanner .th-face-txt'),g=document.querySelector('#hrfBanner .th-face-go').getBoundingClientRect();return [...t.children].slice(1).every(n=>n.getBoundingClientRect().right<=g.left+1||n.getBoundingClientRect().bottom<=g.top+1)})()`), 'Tap to explore clear of the text');
  ok(await ev(`!!document.querySelector('#hrfBanner .th-face-art, #hrfBanner .th-face-img')`), 'face has a picture');
  ok(await ev(`/^This day in medical history, [0-9]{4}: /.test(document.getElementById('hrfBanner').getAttribute('aria-label'))`), 'banner name follows the face');
  ok(await ev(`document.documentElement.scrollWidth<=innerWidth`), 'no sideways scroll');
  // 2. It flips back after 5 s, and again after 5 more.
  const t0 = Date.now();
  ok(await frontOn(7000), 'flips back to the front');
  const backFor = Date.now() - t0;
  ok(backFor > 3500 && backFor < 6500, 'history face held about 5 s (' + backFor + ' ms)');
  ok(await ev(`document.getElementById('hrfBanner').getAttribute('aria-label')==='StewardMD facts and milestones'`), 'front name restored');
  ok(await backOn(7000), 'and flips again');
  // 3. Tap while history shows: the sheet opens (not the facts page).
  await armToasts();
  await click('#hrfBanner');
  ok(await until(`document.getElementById('thSheet')?.classList.contains('on') && document.querySelectorAll('#thSheet .th-ev').length>0`, 5000), 'tap on history face opens the sheet');
  ok(await ev(`(()=>{const m=document.getElementById('aboutModal');return !m||getComputedStyle(m).display==='none'})()`), 'facts page not opened');
  ok(await text('#thDate') === today, 'heading is today: ' + today);
  ok(await ev(`document.activeElement.id==='thDate'`), 'focus moves to the sheet heading');
  ok(await ev(`[...document.querySelectorAll('#thSheet .th-src')].every(a=>/^https:/.test(a.href)&&a.target==='_blank')`), 'sources are https, open outside');
  ok(await ev(`!/—/.test(document.getElementById('thSheet').innerText)`), 'no em-dash in the sheet');
  ok(await ev(`(()=>{const ys=[...document.querySelectorAll('#thSheet .th-yr')].map(e=>+e.textContent);return ys.every((y,i)=>!i||ys[i-1]<=y)})()`), 'events oldest first');
  await sleep(500); await shot('02-sheet-light');
  // flips pause under the sheet
  await sleep(6000);
  ok(await ev(`!document.getElementById('hrfBanner').classList.contains('th-back')`), 'banner rests on its front while the sheet is open');
  // 5. Day stepping, Back to today, and 29 February.
  await click('#thSheet .th-step[data-step="1"]');
  ok(await until(`document.getElementById('thDate').textContent!==${JSON.stringify(today)} && !document.querySelector('#thSheet .th-today').hidden`, 3000), 'next day + Back to today');
  await click('#thSheet .th-today');
  ok(await until(`document.getElementById('thDate').textContent===${JSON.stringify(today)}`, 3000), 'Back to today');
  await ev(`SMD_todayHistory.open(2,28);1`);
  await click('#thSheet .th-step[data-step="1"]');
  ok(await until(`document.getElementById('thDate').textContent==='29 February' && document.querySelectorAll('#thSheet .th-ev').length>0`, 5000), '29 February reachable with events');
  await click('#thSheet .th-step[data-step="1"]');
  ok(await until(`document.getElementById('thDate').textContent==='1 March'`, 3000), 'then 1 March');
  await ev(`SMD_todayHistory.open(1,1);1`); await click('#thSheet .th-step[data-step="-1"]');
  ok(await until(`document.getElementById('thDate').textContent==='31 December' && document.querySelectorAll('#thSheet .th-ev').length>0`, 5000), 'wraps 1 January back to 31 December');
  await ev(`SMD_todayHistory.open(8,20);1`);
  ok(await until(`[...document.querySelectorAll('#thSheet .th-ev')].some(li=>li.querySelector('.th-in')&&/1897/.test(li.innerText)&&/Secunderabad/.test(li.innerText))`, 5000), 'India event tagged India (Ross, Secunderabad, 1897)');
  ok(await ev(`[...document.querySelectorAll('#thSheet .th-yr')].filter(y=>y.textContent==='1897').length===1`), 'the world copy of the same event is not repeated');
  await sleep(400); await shot('05-sheet-india');
  await ev(`SMD_todayHistory.open(1,8);1`);
  ok(await until(`/Nothing to mark on this day/.test(document.getElementById('thSheet').innerText)`, 5000), 'a day with nothing left says so');
  ok(await ev(`!/\\b(death of|passing of|dies)\\b/i.test(document.getElementById('thSheet').innerText)`), 'no deaths listed');
  // 6. Escape closes; focus goes back to the date.
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  ok(await until(`!document.getElementById('thSheet').classList.contains('on')`, 2000), 'Escape closes');
  ok(await ev(`document.activeElement===document.getElementById('hrfBanner')`), 'focus returns to the banner');
  // 7. The date opens it again (keyboard), and the scrim closes it.
  await ev(`document.querySelector('#homeV2 .hrf-date').focus();1`); await key('Enter');
  ok(await until(`document.getElementById('thSheet').classList.contains('on')`, 2000), 'Enter on the date opens it');
  await click('#thScrim');
  ok(await until(`!document.getElementById('thSheet').classList.contains('on')`, 2000), 'scrim closes it');

  // 8. Dark theme sheet.
  await ev(`document.body.classList.add('dark');SMD_todayHistory.open();1`);
  await until(`document.querySelectorAll('#thSheet .th-ev').length>0`, 5000); await sleep(500); await shot('03-sheet-dark');
  ok(await ev(`getComputedStyle(document.getElementById('thSheet')).backgroundColor==='rgb(15, 26, 33)'`), 'dark sheet background');
  await ev(`SMD_todayHistory.close();document.body.classList.remove('dark');1`);

  // 9. Front-face tap still opens the facts page.
  await ev(`SMD_todayHistory.close();1`); await frontOn(9000);
  await click('#hrfBanner');
  ok(await until(`(()=>{const m=document.getElementById('aboutModal');return !!m&&getComputedStyle(m).display!=='none'&&!document.getElementById('thSheet').classList.contains('on')})()`, 3000), 'front face keeps its own tap (facts page)');

  // 10. 320 px: the history face fits.
  await size(320, 640); await boot('');
  ok(await backOn(9000), 'flips at 320');
  await sleep(1200); await shot('04-banner-back-320');
  ok(await ev(inside), 'history text inside the banner at 320');
  ok(await ev(`document.documentElement.scrollWidth<=innerWidth`), 'no sideways scroll at 320');
  await size(390, 844);

  // 11. Scrolled away: it rests on the front and stops flipping.
  await boot('');
  await ev(`(document.scrollingElement||document.documentElement).scrollTop=99999;document.querySelectorAll('*').forEach(n=>{if(n.scrollHeight>n.clientHeight+200&&getComputedStyle(n).overflowY!=='visible')n.scrollTop=99999});1`);
  await sleep(7000);
  ok(await ev(`(()=>{const r=document.getElementById('hrfBanner').getBoundingClientRect();return r.bottom<24?!document.getElementById('hrfBanner').classList.contains('th-back'):'not-scrolled'})()`) === true, 'no flip while off screen');

  // 12. Reduced motion: faces swap with a fade, no rotation.
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await boot('');
  ok(await backOn(8000), 'swaps with reduced motion');
  ok(await ev(`getComputedStyle(document.getElementById('hrfBanner')).animationName==='none'`), 'no rotation when reduced');
  await call('Emulation.setEmulatedMedia', { features: [] });

  // 13. Kill switch.
  await boot(`localStorage.setItem('smd_today_history','0')`);
  await sleep(3000);
  await sleep(4000);
  ok(await ev(`!document.querySelector('.th-face') && !window.SMD_todayHistory && !document.querySelector('#homeV2 .hrf-date').hasAttribute('role')`), 'smd_today_history=0 turns it all off');
} catch (e) { console.error(e); failures++; }
finally { try { ws?.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS'); process.exit(failures ? 1 : 0);
