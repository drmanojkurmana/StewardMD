// Real-browser test: the verification screen redesign (owner, 2026-10-08). Signed-in user and
// /api/verify-doctor are faked before any app script runs; shots land in $OUT.
//   node test/run-verify-ux-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9098, CDP = 9498, OUT = process.env.OUT || "/tmp/stewardmd-verify-ux";
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
async function shot(name) { await sleep(250); await ev(`(()=>{const a=document.getElementById('smdApplock');if(a)a.style.display='none';return 1})()`); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.enable'); (await call('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){var user={uid:"u1",email:"sravani.ysn@gmail.com",displayName:"Sravani Yarrarapu",providerData:[{providerId:"google.com"}],getIdTokenResult:function(){return Promise.resolve({claims:{}})},getIdToken:function(f){if(f)window.__forced=(window.__forced||0)+1;return Promise.resolve("tok")}};var A={onAuthStateChanged:function(cb){setTimeout(function(){cb(user)},0);return function(){}}};Object.defineProperty(A,"currentUser",{get:function(){return user},set:function(){}});Object.defineProperty(window,"SMD_AUTH",{get:function(){return A},set:function(){},configurable:false});var f=window.fetch;window.__vresp={status:"pending_review",reason:"no_nmc_match",provisionalUntil:new Date(Date.now()+7*864e5).toISOString(),provisionalDays:7};window.__posts=0;window.fetch=function(u,o){if(String(u).indexOf("/api/verify-doctor")>=0){if(o&&o.method==="POST")window.__posts++;var m=(o&&o.method)||"GET";return new Promise(function(r){setTimeout(function(){r(new Response(JSON.stringify(m==="POST"?window.__vresp:{status:"unverified"})))},m==="POST"?1500:50)})}return f.apply(this,arguments)};})();` }));
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until('!!window.SMD_VERIFY && !!document.getElementById("verifyGate")', 40000), 'app loaded');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)&&document.getElementById(k).remove());1`);
  await sleep(1200);
  await ev(`SMD_VERIFY._evaluate();1`);
  ok(await until(`getComputedStyle(document.getElementById('verifyGate')).display !== 'none'`, 8000), 'an unverified doctor sees the verification screen');
  const txt = (id) => ev(`(document.getElementById(${JSON.stringify(id)})||{}).textContent||''`);
  const shown = (id) => ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});return !!e&&getComputedStyle(e).display!=='none'})()`);
  ok(/Verify your registration/.test(await txt('verifyTitle')), 'title is short and plain');
  ok(/About a minute/.test(await txt('verifyPerks')) && /Pro free for 7 days/.test(await txt('verifyPerks')) && /NMC register/.test(await txt('verifyPerks')), 'the promise for doctors: a minute, free Pro week, register check');
  ok(await ev(`document.querySelectorAll('#verifyPerks svg').length`) === 3, 'each promise has its icon');
  ok(!(await shown('verifyAccount')), 'a first visit shows no account table of blanks');
  ok(await shown('verifyMethod') && !(await shown('verifyRegRow')), 'doctors choose Certificate or Reg. number + photo ID; the number field waits for the second');
  ok(/Choose certificate/.test(await txt('verifySubmit')), 'one clear first action');
  ok(await ev(`document.getElementById('verifyGate').scrollWidth <= document.getElementById('verifyGate').clientWidth`), 'no sideways scroll at phone width');
  await shot('start');
  // students: no register promise, no method switch
  await ev(`document.querySelector('#verifyRoles [data-role=student]').click();1`); await sleep(150);
  ok(/Reviewed within a day/.test(await txt('verifyPerks')) && !/NMC register/.test(await txt('verifyPerks')), 'students are promised a review within a day, not a register check');
  ok(!(await shown('verifyMethod')), 'students see no certificate/number switch');
  await ev(`document.querySelector('#verifyRoles [data-role=doctor]').click();1`); await sleep(150);
  // photo-ID path without a number: asked for it, nothing sent
  const pick = async () => { await ev(`(()=>{const c=document.createElement('canvas');c.width=120;c.height=80;c.getContext('2d').fillRect(0,0,60,40);c.toBlob(b=>{const i=document.getElementById('verifyFile');const dt=new DataTransfer();dt.items.add(new File([b],'certificate.jpg',{type:'image/jpeg'}));i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));window.__picked=1},'image/jpeg');return 1})()`); await until('window.__picked===1', 3000); await ev('window.__picked=0;1'); };
  await ev(`document.querySelector('#verifyMethod [data-method=id]').click();1`); await sleep(150);
  ok(await shown('verifyRegRow'), 'Reg. number + photo ID shows the number field');
  await pick();
  await ev(`document.getElementById('verifySubmit').click();1`); await sleep(400);
  ok(/Enter your registration number/.test(await txt('verifyStatus')) && await ev('window.__posts') === 0, 'no number: asked for it, nothing sent');
  // switching back clears the photo ID that was chosen for the other path
  await ev(`document.querySelector('#verifyMethod [data-method=cert]').click();1`); await sleep(150);
  ok(await ev(`document.getElementById('verifyFile').files.length`) === 0 && !(await shown('verifyRegRow')), 'switching method starts that path clean');
  // certificate path: preview, steps, pending result
  await pick(); await sleep(200);
  ok(await ev(`!!document.querySelector('#verifyPreview img')`), 'the chosen photo shows as a thumbnail');
  ok(/Verify now/.test(await txt('verifySubmit')), 'then the button says Verify now');
  await ev(`window.__forced=0; document.getElementById('verifySubmit').click();1`); await sleep(500);
  ok(await ev(`document.querySelectorAll('#verifyStatus .vfx-steps li').length`) === 3, 'live steps while it checks');
  await shot('checking');
  ok(await until(`/Sent for a quick manual check/.test(document.getElementById('verifyStatus').textContent)`, 6000), 'manual review is explained, not just "pending"');
  ok(/Pro is on for the next 7 days/.test(await txt('verifyStatus')), 'and says Pro is on while it waits');
  ok(await ev('window.__forced') >= 1, 'the token is refreshed so the free Pro week shows at once');
  ok(!(await shown('verifySkipBtn')) && await shown('verifyDoneBtn'), 'after a result: Continue, no "skip"');
  ok(/Upload a clearer copy/.test(await txt('verifySubmit')) && await ev(`document.getElementById('verifyFile').files.length`) === 0, 'a clearer copy can still verify instantly: the next tap picks a new file');
  await shot('pending');
  ok(!/—/.test(await ev(`document.getElementById('verifyGate').innerText`)), 'no em dash on screen');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
