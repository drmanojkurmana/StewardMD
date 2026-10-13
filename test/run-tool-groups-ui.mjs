// Real-browser test: tool-groups.js in the app. Home starts with a short starter set picked from the role and the
// specialty; the All tools sheet is grouped by role (own role first and open), with descriptions, a working search,
// a Recently used row, and a first pin that keeps everything already on Home. ?toolgroups=0 restores the flat list.
//   node test/run-tool-groups-ui.mjs        (env: CHROME, PORT, CHROME_PORT, SHOTS)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = +process.env.PORT || 9096, CDP = +process.env.CHROME_PORT || 9496, OUT = process.env.SHOTS || "/tmp/stewardmd-toolgroups";
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
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const tiles = () => ev(`[...document.querySelectorAll('#rnavToolsGrid .rnav-tile:not(.addtool)')].map(t=>t.dataset.act)`);
  async function boot(setup, qs = '') {
    await call('Page.navigate', { url: `http://localhost:${PORT}/` });
    await until(`document.readyState==='complete'`, 30000);
    await ev(`localStorage.clear();${setup || ''};1`);
    await call('Page.navigate', { url: `http://localhost:${PORT}/${qs}` });
    ok(await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile') && !!window.SMD_TOOL_GROUPS && !!window.SMD_ROLE`, 30000), 'home rendered ' + (setup || 'fresh') + qs);
    await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
    // role-features.js runs after home.js; the grid re-renders on smd:role-changed, so settle on the final grid.
    await ev(`document.dispatchEvent(new Event('smd:role-changed'));1`); await sleep(200);
  }
  const openAll = async () => { await ev(`document.querySelector('#rnavToolsGrid .rnav-tile.addtool').click();1`); return until(`!!document.querySelector('#hvSheet.on .hv-at-list')`); };
  const closeAll = () => ev(`try{document.getElementById('hvScrim').click()}catch(e){};1`);
  const QUICK = ['startcase', 'reasoning', 'drugmenu', 'calculators', 'syndromes', 'antibiogram', 'dosing', 'hospital', 'askai'];

  // 1. Fresh install, no role: a short starter set, nothing that is already above the grid.
  await boot('');
  let t = await tiles();
  ok(t.length >= 6 && t.length <= 8, `no role: Home shows ${t.length} tools (6 to 8): ${t.join(',')}`);
  ok(t.every((a) => !QUICK.includes(a)), 'none of them repeats a quick action or chip');
  await shot('home-none');

  // 2. Intern with an O&G kit: the pack first, the intern tools, nothing locked for an intern.
  await boot(`localStorage.setItem('smd_role','intern');localStorage.setItem('smd_my_specialty','obgyn')`);
  t = await tiles();
  const exp = await ev(`SMD_TOOL_GROUPS.starter('intern','obgyn',a=>{return SMD_ROLE.allows(a)})`);
  ok(t.length >= 6 && t.length <= 8 && t.includes('tokos'), `intern + O&G: ${t.join(',')}`);
  ok(exp.filter((a) => t.includes(a)).length === t.length, 'Home matches the starter set');
  ok(await ev(`!document.querySelector('#rnavToolsGrid .role-locked')`), 'no locked tile in the starter set');
  await shot('home-intern-og');

  // 3. The sheet: sections by role, Interns first, open and marked; the others closed; every tool once; descriptions.
  ok(await openAll(), 'All tools opens'); await sleep(700);
  const secs = await ev(`[...document.querySelectorAll('#hvSheet .hv-at-sec')].map(d=>({role:d.dataset.role,open:d.open,you:!!d.querySelector('.hv-at-you'),n:d.querySelectorAll('.hv-at-row').length,count:+d.querySelector('.hv-at-n').textContent}))`);
  ok(secs[0].role === 'intern' && secs[0].open && secs[0].you, 'Interns section first, open, "Your role": ' + JSON.stringify(secs[0]));
  ok(secs.slice(1).every((s) => !s.open && !s.you), 'the other sections start closed');
  ok(secs.every((s) => s.n === s.count && s.n > 0), 'each header count matches its rows');
  const rows = await ev(`[...document.querySelectorAll('#hvSheet .hv-at-sec .hv-at-row')].map(r=>r.dataset.at)`);
  const elig = await ev(`SMD_HOME_TOOLS().length + document.querySelectorAll('#hvSheet .hv-at-sec .hv-at-open[aria-label*="locked"]').length`);
  ok(new Set(rows).size === rows.length && rows.length === elig, `every tool listed once (${rows.length})`);
  const descs = await ev(`[...document.querySelectorAll('#hvSheet .hv-at-sec .hv-at-row')].map(r=>({a:r.dataset.at,d:r.querySelector('.mc').textContent}))`);
  ok(await ev(`[...document.querySelectorAll('#hvSheet .hv-at-sec .hv-at-row')].every(r=>r.querySelector('.mc').textContent===SMD_TOOL_GROUPS.desc(r.dataset.at))`), 'every row shows its one-line description');
  ok(descs.every((x) => !/[–—]/.test(x.d)), 'no dashes');
  await shot('sheet-intern');
  // Tap a closed header: it opens (a native <details>), 48 px tall at least.
  const h = await ev(`(()=>{const s=document.querySelector('#hvSheet .hv-at-sec[data-role="resident"] summary');s.click();return Math.round(s.getBoundingClientRect().height)})()`);
  ok(h >= 44 && await ev(`document.querySelector('#hvSheet .hv-at-sec[data-role="resident"]').open`), `a header opens its section (header ${h}px tall)`);
  ok(await ev(`(()=>{const sh=document.getElementById('hvSheet');return sh.scrollWidth<=sh.clientWidth+1})()`), 'no sideways scroll at 390 px');

  // 4. Search: matches in closed sections show, empty sections hide; clearing restores what was open.
  await ev(`(()=>{const q=document.getElementById('hvAtQ');q.value='ecg';q.dispatchEvent(new Event('input',{bubbles:true}))})();1`);
  const hits = await ev(`[...document.querySelectorAll('#hvSheet .hv-at-row')].filter(r=>!r.hidden&&r.offsetParent).map(r=>r.dataset.at)`);
  ok(hits.includes('kxlearn') && !hits.includes('docs'), 'search "ecg" finds Learn ECG in the closed Students section: ' + hits.join(','));
  ok(await ev(`[...document.querySelectorAll('#hvSheet .hv-at-sec')].every(d=>d.hidden||d.open)`), 'sections with a match open, the rest hide');
  await ev(`(()=>{const q=document.getElementById('hvAtQ');q.value='verified cases';q.dispatchEvent(new Event('input',{bubbles:true}))})();1`);
  ok((await ev(`[...document.querySelectorAll('#hvSheet .hv-at-row')].filter(r=>!r.hidden&&r.offsetParent).map(r=>r.dataset.at)`)).includes('pglog'), 'search reads the descriptions, every word in any order');
  await ev(`(()=>{const q=document.getElementById('hvAtQ');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})();1`);
  const after = await ev(`[...document.querySelectorAll('#hvSheet .hv-at-sec')].map(d=>d.dataset.role+':'+(d.open?1:0)+(d.hidden?'h':''))`);
  ok(after.join() === 'intern:1,student:0,resident:1,doctor:0', 'cleared: back to Interns and Residents open: ' + after.join());

  // 5. Recently used: open a tool from the sheet, come back, it leads the sheet.
  await ev(`document.querySelector('#hvSheet [data-at-open="tokos"]').click();1`);
  await sleep(1200);
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile') && !!window.SMD_ROLE`, 30000);
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.dispatchEvent(new Event('smd:role-changed'));1`);
  ok(await openAll(), 'All tools opens again'); await sleep(700);
  ok(await ev(`[...document.querySelectorAll('#hvSheet .hv-at-recent .hv-at-row')].map(r=>r.dataset.at)[0]==='tokos'`), 'Recently used shows Tokos first');
  ok(await ev(`localStorage.getItem('smd_tools_recent')==='["tokos"]'`), 'only the tool id is stored');
  await shot('sheet-recent');

  // 6. The first pin keeps the whole starter set and adds the tool; both copies of a pin stay in step.
  const before = await tiles();
  await ev(`document.querySelector('#hvSheet .hv-at-sec [data-at-pin="narke"]').click();1`);
  await sleep(200);
  const pinned = await tiles();
  ok(before.every((a) => pinned.includes(a)) && pinned.includes('narke') && pinned.length === before.length + 1, `first pin keeps Home and adds Narke: ${pinned.join(',')}`);
  await ev(`document.querySelector('#hvSheet .hv-at-recent [data-at-pin="tokos"]').click();1`);
  await sleep(150);
  ok(await ev(`[...document.querySelectorAll('#hvSheet [data-at-pin="tokos"]')].every(b=>b.classList.contains('on')===false)`) && !(await tiles()).includes('tokos'), 'unpinning from Recently used updates both rows and Home');
  ok(await ev(`localStorage.getItem('smd_role')==='intern'`), 'role untouched');
  // A role change no longer reshuffles a Home the user has arranged.
  await ev(`localStorage.setItem('smd_role','doctor');document.dispatchEvent(new Event('smd:role-changed'));1`); await sleep(150);
  const kept = await tiles();
  ok(pinned.filter((a) => a !== 'tokos').every((a) => kept.includes(a)), 'after pinning, a role change keeps the user\'s Home');
  await closeAll();

  // 7. Dark theme screenshot of the sheet, then the kill switch.
  await boot(`localStorage.setItem('smd_role','resident')`);
  await ev(`document.body.classList.add('dark');1`);
  await openAll(); await sleep(700);
  const dk = await ev(`(()=>{const sh=document.getElementById('hvSheet'),r=sh.querySelector('.hv-at-sec .hv-at-row'),b=r.getBoundingClientRect(),cs=getComputedStyle(sh);return {bg:cs.backgroundColor,op:cs.opacity,tf:cs.transform,ink:getComputedStyle(r.querySelector('.ml')).color,top:Math.round(b.top),h:Math.round(b.height)}})()`);
  console.log('dark sheet', JSON.stringify(dk));
  ok(dk.h > 40 && dk.top < 844, 'dark: the first row is on screen');
  await shot('sheet-resident-dark');
  ok(await ev(`(()=>{const s=getComputedStyle(document.querySelector('#hvSheet .hv-at-st'));return s.color!==getComputedStyle(document.getElementById('hvSheet')).backgroundColor})()`), 'dark: section titles readable');
  await closeAll();
  await boot('', '?toolgroups=0');
  t = await tiles();
  ok(t.length > 8, `?toolgroups=0: the old defaults (${t.length} tools)`);
  await openAll();
  ok(await ev(`!document.querySelector('#hvSheet .hv-at-sec') && document.querySelectorAll('#hvSheet .hv-at-row').length > 30`), '?toolgroups=0: the flat list');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
