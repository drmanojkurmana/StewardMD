// Real-browser test: pulling Home down ("Pull for a pulse", home-pull.js) reveals the hero's own teal with an ECG
// trace that draws with the pull, "Let go" past the trigger, a pearl on release that holds the band open, then home;
// no global Back button over Home while pulled; the native-bounce drawing has no words; the kill switch works.
//   node test/run-home-pull-ui.mjs   (SHOTS=<dir> saves light and dark pulled / pearl shots)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9091, CDP = 9491, OUT = process.env.SHOTS || "/tmp/stewardmd-home-pull";
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
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile')`, 30000), 'home rendered');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  ok(await until(`!!(window.SMD_HOME_PULL && SMD_HOME_PULL._s().sc && document.querySelector('#homeV2 > .hv-pull'))`, 10000), 'home-pull attached to the Home scroller, band in place');
  await ev(`document.querySelector('#homeV2 > .v3-main').scrollTop=0;1`);
  await sleep(300);
  const touch = (type, x, y) => call('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const band = () => ev(`(()=>{const b=document.querySelector('#homeV2 > .hv-pull');const cs=getComputedStyle(b);return {h:b.getBoundingClientRect().height,bg:cs.backgroundColor,t:b.querySelector('.hvp-t').textContent,dash:parseFloat(getComputedStyle(b.querySelector('.ln')).strokeDashoffset),heart:parseFloat(getComputedStyle(b.querySelector('.ht')).opacity),cls:b.className,op:parseFloat(b.firstChild.style.opacity||'0'),pulling:document.body.classList.contains('hv-pulling')}})()`);
  const pullTo = async (dy) => { await touch('touchStart', 195, 260); for (let k = 1; k <= 12; k++) { await touch('touchMove', 195, 260 + dy * k / 12); await sleep(16); } };
  // a short pull: the trace is partly drawn, prompt shown, not armed
  await pullTo(40);
  let b = await band();
  ok(b.h > 10 && b.h < 72 && b.dash > 0.05 && b.dash < 1 && /Pull for a pearl/.test(b.t) && !/armed/.test(b.cls), `a short pull: band ${Math.round(b.h)} px, trace part drawn (offset ${b.dash.toFixed(2)}), "${b.t}"`);
  const heroTop = await ev(`(()=>{const h=document.getElementById('homeV2');const d=document.createElement('div');d.style.color=getComputedStyle(h).getPropertyValue('--hrf-h0');h.appendChild(d);const c=getComputedStyle(d).color;d.remove();return c})()`);
  const tone = await ev(`(()=>{const b=document.querySelector('#homeV2 > .hv-pull'),i=document.querySelector('#homeV2 .hrf-art'),h=document.querySelector('#homeV2 .hrf-hero');const artTop=Math.abs(i.getBoundingClientRect().top-h.getBoundingClientRect().top)<=2&&i.getBoundingClientRect().width>=h.getBoundingClientRect().width*.9;return {artTop, v:b.style.getPropertyValue('--hvp-bg')}})()`);
  ok(tone.artTop ? /^rgb\(/.test(tone.v) && b.bg === tone.v.replace(/,/g, ', ') : b.bg === heroTop, tone.artTop ? `the band takes the hero artwork's own top edge colour (${b.bg})` : `art not along the top here: the band is the hero's top colour (${b.bg} = ${heroTop})`);
  // further: armed
  for (let k = 1; k <= 10; k++) { await touch('touchMove', 195, 300 + 220 * k / 10); await sleep(16); }
  b = await band();
  await sleep(600); b = await band();
  ok(b.h >= 72 && b.dash < 0.01 && /Let go/.test(b.t) && /armed/.test(b.cls) && b.heart > 0.9, `past the trigger: trace complete, the heart pops, "Let go" (${Math.round(b.h)} px)`);
  ok(b.pulling, 'body.hv-pulling while open');
  ok(await ev(`(()=>{const bb=document.querySelector('#homeV2 > .hv-pull').getBoundingClientRect(),h=document.querySelector('#homeV2 .hrf-hero').getBoundingClientRect();return Math.abs(bb.bottom-h.top)<=2})()`), 'no strip of page between the band and the hero');
  await ev(`window.SMD_SWIPE_BACK && SMD_SWIPE_BACK.syncHandle && SMD_SWIPE_BACK.syncHandle();1`);
  ok(await ev(`(()=>{const k=document.getElementById('smdTopBack');return !k||getComputedStyle(k).visibility==='hidden'})()`), 'no Back button over Home while it is pulled');
  await shot('pulled-light');
  // release: the pearl, the band held open
  await touch('touchEnd');
  await sleep(500);
  b = await band();
  ok(/busy/.test(b.cls) && !/Pull for a pearl|Let go/.test(b.t) && b.t.length > 8 && b.h >= 112, `release: a pearl holds the band open ("${b.t}", ${Math.round(b.h)} px)`);
  ok(await ev(`(()=>{const b=document.querySelector('#homeV2 > .hv-pull').getBoundingClientRect(),s=document.querySelector('#homeV2 > .hv-pull svg').getBoundingClientRect(),t=document.querySelector('#homeV2 > .hv-pull .hvp-t').getBoundingClientRect();return s.height>20 && s.top>=b.top && t.bottom<=b.bottom && s.bottom<=t.top+2})()`), 'held open: the line and the pearl both fit inside the band, line above pearl');
  await sleep(1300);
  ok(await ev(`parseFloat(getComputedStyle(document.querySelector('#homeV2 > .hv-pull .ht')).opacity)>0.9`), 'the heart beats on the drawn line while the pearl is up');
  await shot('pearl-light');
  ok(await until(`(()=>{const b=document.querySelector('#homeV2 > .hv-pull');return b.getBoundingClientRect().height<1 && !document.body.classList.contains('hv-pulling')})()`, 5000), 'then it springs home and closes');
  await sleep(300);
  const tf = await ev(`document.querySelector('#homeV2 > .v3-main').style.transform`);
  ok(!tf, 'the scroller is back in place (no transform left: "' + tf + '")');
  // a pull that is let go early: no pearl, straight home
  await pullTo(40); await touch('touchEnd');
  await sleep(150);
  ok(!/busy/.test((await band()).cls), 'a short pull let go: no pearl');
  ok(await until(`document.querySelector('#homeV2 > .hv-pull').getBoundingClientRect().height<1`, 3000), 'and it closes');
  // dark mode
  await ev(`document.body.classList.add('dark');1`); await sleep(200);
  await pullTo(160); await sleep(100); await shot('pulled-dark'); await touch('touchEnd'); await sleep(600); await shot('pearl-dark');
  ok(await until(`document.querySelector('#homeV2 > .hv-pull').getBoundingClientRect().height<1`, 5000), 'dark: pulls and closes too');
  await ev(`document.body.classList.remove('dark');1`);
  // a native bounce (iOS fling past the top) draws the band without words
  await ev(`SMD_HOME_PULL._draw(50,'pull',true);1`); await sleep(300);
  ok(await ev(`getComputedStyle(document.querySelector('#homeV2 > .hv-pull .hvp-t')).opacity==='0' && document.querySelector('#homeV2 > .hv-pull').getBoundingClientRect().height===50`), 'a native bounce: teal and trace, no prompt');
  await ev(`SMD_HOME_PULL._draw(0,'home',true);1`);
  // the pure helpers
  ok(await ev(`SMD_HOME_PULL._pure.prog(36,72)===0.5 && SMD_HOME_PULL._pure.prog(200,72)===1 && SMD_HOME_PULL._pure.pick(['a','b'],3)==='b'`), 'progress and pearl rotation');
  // kill switch
  await ev(`localStorage.setItem('smd_home_pull','0');1`);
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile')`, 30000); await sleep(1500);
  ok(await ev(`!document.querySelector('#homeV2 > .hv-pull')`), 'smd_home_pull=0: nothing attached');
  await ev(`localStorage.removeItem('smd_home_pull');1`);
} catch (e) { console.log('FAIL harness', e && e.stack || e); failures++; }
finally { try { chrome.kill(); } catch {} server.close(); }
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
