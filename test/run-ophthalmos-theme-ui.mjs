// Real-browser test: Ophthalmós follows the app's light / dark mode (body.dark, which theme-sync.js ties to the
// phone's setting). Owner 2026-09-29: "white or black should be linked to system, just like dark mode and light mode".
// Light: white surface. Dark: black reading room. Switching while it is open follows at once. Every visible
// text on each screen visited is at least 4.5:1 (3:1 for large text) against what is behind it, in both modes.
// Line diagrams keep their white card in dark mode; photographs keep their black plate in light mode.
//   node test/run-ophthalmos-theme-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9095, CDP = 9495, OUT = "/tmp/stewardmd-oph-theme";
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
  ok(await until(`!!window.OPHTHALMOS && !!document.body`, 30000), 'app and Ophthalmos loaded');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  // Contrast audit: every visible text node's colour against the first opaque background behind it.
  const AUDIT = `(()=>{const L=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)};
    const P=s=>{const m=s.match(/[\\d.]+/g);return m?m.map(Number):[0,0,0,0]};
    const lum=a=>.2126*L(a[0])+.7152*L(a[1])+.0722*L(a[2]);
    const bgOf=el=>{for(let e=el;e;e=e.parentElement){const cs=getComputedStyle(e);if(cs.backgroundImage&&cs.backgroundImage!=='none'&&/url\\(/.test(cs.backgroundImage)&&!/data:image\\/svg/.test(cs.backgroundImage))return null;const b=P(cs.backgroundColor);if(b.length<4||b[3]>.9)return b}return[255,255,255]};
    const root=document.querySelector('.oph-overlay.on');const bad=[];let n=0;
    const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let t;
    while((t=w.nextNode())){const tx=t.textContent.trim();if(!tx)continue;const el=t.parentElement;const r=el.getBoundingClientRect();
      if(!r.width||!r.height||r.bottom<0||r.top>innerHeight)continue;const cs=getComputedStyle(el);
      if(cs.visibility==='hidden'||+cs.opacity===0||parseFloat(cs.fontSize)<6||el.closest('[aria-hidden="true"],.oph-draft'))continue;
      const bg=bgOf(el);if(!bg)continue;const fg=P(cs.color);const a=fg.length>3?fg[3]:1;const mix=[0,1,2].map(i=>fg[i]*a+bg[i]*(1-a));
      const l1=lum(mix),l2=lum(bg);const cr=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);n++;
      const big=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.6&&+cs.fontWeight>=700);
      if(cr<(big?3:4.5))bad.push(tx.slice(0,30)+' '+cr.toFixed(2))}
    return {n,bad:bad.slice(0,8)}})()`;
  const bgNow = () => ev(`getComputedStyle(document.querySelector('.oph-overlay')).backgroundColor`);
  // Each screen is reached from a fresh open by clicking through; a step that is not on screen is skipped.
  const SCREENS = [
    ['welcome', []],
    ['test-hub', ['[data-act="lnpick"][data-t="test"], [data-act="lntab"][data-t="test"]']],
    ['sim', ['[data-act="lntab"][data-t="test"]', '[data-act="sim"]']],
    ['stats', ['[data-act="stats"]']],
    ['learn-home', ['[data-act="lntab"][data-t="learn"]']],
    ['lesson', ['[data-act="lntab"][data-t="learn"]', '[data-act="lesson"]']],
  ];
  const visit = async (mode) => {
    const seen = [];
    for (const [name, steps] of SCREENS) {
      await ev(`OPHTHALMOS.close&&OPHTHALMOS.close();OPHTHALMOS.open();1`); await sleep(700);
      let okSteps = true;
      for (const sel of steps) {
        const has = await ev(`!!document.querySelector('.oph-overlay.on').querySelector(${JSON.stringify(sel)})`);
        if (!has) { okSteps = sel.includes('lntab') || sel.includes('lnpick'); if (!okSteps) break; continue; }
        await ev(`document.querySelector('.oph-overlay.on').querySelector(${JSON.stringify(sel)}).click();1`); await sleep(900);
      }
      if (!okSteps) continue;
      const a = await ev(AUDIT);
      seen.push(name);
      ok(a.n > 3 && a.bad.length === 0, `${mode}: ${name} text readable (${a.n} texts)` + (a.bad.length ? ' LOW: ' + JSON.stringify(a.bad) : ''));
      const d = await ev(`(()=>{const d=document.querySelector('.oph-overlay.on .diagram, .oph-overlay.on .ln-pic.diagram .ln-pic-b, .oph-overlay.on .ln-banner.diagram');return d?getComputedStyle(d).backgroundColor:null})()`);
      if (d) ok(/255, 255, 255/.test(d), `${mode}: ${name} line diagram sits on its white card (${d})`);
      await shot(`${mode}-${name}`);
    }
    return seen;
  };
  // ── light ──
  await ev(`document.body.classList.remove('dark');window.__sb=[];window.Capacitor=window.Capacitor||{};Capacitor.Plugins=Capacitor.Plugins||{};Capacitor.Plugins.StatusBar={setStyle:o=>__sb.push(o.style),setBackgroundColor:()=>{}};OPHTHALMOS.open();1`);
  ok(await until(`!!document.querySelector('.oph-overlay.on')`), 'Ophthalmos opens');
  await sleep(800);
  ok(/255, 255, 255/.test(await bgNow()), 'light mode: white surface ' + await bgNow());
  ok(await ev(`__sb[__sb.length-1]`) === 'LIGHT', 'light mode: dark status-bar icons on the white overlay');
  const lightSeen = await visit('light');
  // ── switch to dark while open ──
  await ev(`document.body.classList.add('dark');1`); await sleep(300);
  ok(/^rgb\(0, 0, 0\)$/.test(await bgNow()), 'switching the app to dark while open turns Ophthalmos black at once: ' + await bgNow());
  const darkSeen = await visit('dark');
  ok(darkSeen.length >= 5 && darkSeen.join() === lightSeen.join(), 'the same screens were checked in both modes: ' + darkSeen.join(','));
  // Reopen in dark: the status bar must not be forced to dark icons over a black overlay.
  await ev(`OPHTHALMOS.close&&OPHTHALMOS.close();__sb=[];SMD_THEME_REVEAL=window.SMD_THEME_REVEAL||{};OPHTHALMOS.open();1`); await sleep(500);
  ok(!(await ev(`__sb`)).includes('LIGHT'), 'dark mode: opening does not force dark status-bar icons: ' + JSON.stringify(await ev(`__sb`)));
  // Photographs keep their black plate in light mode.
  await ev(`document.body.classList.remove('dark');1`);
  ok(await ev(`(()=>{const s=document.querySelector('.oph-overlay .oph-stage');return !s||/^rgb\\(0, 0, 0\\)$/.test(getComputedStyle(s).backgroundColor)})()`), 'light mode: clinical photo stage stays black');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
