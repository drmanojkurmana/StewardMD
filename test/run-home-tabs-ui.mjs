// Real-browser test: Home tabs (owner 2026-11-07). [For you] [Learn] [Bedside] [Practice] [<branch>] above the tool
// grid, the "Try something new" card, New chips on never-opened tools, the branch picker, problem search in
// universal search, Anaesthetica, and the ?hometabs=0 kill switch. 390 px and iPad width, light and dark.
//   node test/run-home-tabs-ui.mjs        (env: CHROME, PORT, CHROME_PORT, SHOTS)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = +process.env.PORT || 9097, CDP = +process.env.CHROME_PORT || 9497, OUT = process.env.SHOTS || "/tmp/stewardmd-hometabs";
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
    await ev(`localStorage.clear();${setup || ''};1`);
    await call('Page.navigate', { url: `http://localhost:${PORT}/${qs}` });
    ok(await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile') && !!window.SMD_TOOL_GROUPS && !!window.SMD_ROLE`, 30000), 'home rendered ' + (setup || 'fresh') + qs);
    await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
    await ev(`document.dispatchEvent(new Event('smd:role-changed'));1`); await sleep(200);
  }
  const panelActs = (id) => ev(`[...document.querySelectorAll('#rnavHpanel-${id} .rnav-tile')].map(t=>t.dataset.act)`);
  const activeTab = () => ev(`(document.querySelector('#homeV2 .rnav-htab.on')||{}).dataset?.hometab||''`);
  const scrollToTabs = () => ev(`document.querySelector('#homeV2 .rnav-htabs').scrollIntoView({block:'start'});1`);

  // 1. Fresh install: five tabs, For you open with the grid as before, and one "Try something new" card.
  await boot('');
  ok(await ev(`[...document.querySelectorAll('#homeV2 .rnav-htab')].map(b=>b.dataset.hometab).join()==='foryou,learn,bedside,practice,branch'`), 'five tabs in order');
  ok(await ev(`document.querySelector('#homeV2 [role=tablist]') && document.querySelectorAll('#homeV2 [role=tab]').length===5`), 'tablist semantics');
  ok(await activeTab() === 'foryou', 'For you is open by default');
  ok(await ev(`!document.getElementById('rnavHpanel-foryou').hidden && document.getElementById('rnavHpanel-learn').hidden`), 'only For you panel visible');
  ok(await ev(`(document.getElementById('rnavHtab-branch').innerText||'').indexOf('Specialty')===0`), 'no kit: the last tab reads Specialty');
  const grid = await ev(`[...document.querySelectorAll('#rnavToolsGrid .rnav-tile:not(.addtool)')].map(t=>t.dataset.act)`);
  const tryAct = await ev(`(document.querySelector('#rnavTry .rnav-try-go')||{}).dataset?.act||''`);
  ok(!!tryAct && !grid.includes(tryAct), `Try card offers a tool not already on Home: ${tryAct}`);
  ok(await ev(`[...document.querySelectorAll('#rnavToolsGrid .rnav-tile-new')].length===0`), 'tools already on Home carry no New chip');
  const tabsBox = await ev(`(()=>{const r=document.querySelector('#homeV2 .rnav-htabs').getBoundingClientRect();return {w:r.width,sw:document.querySelector('#homeV2 .rnav-htabs').scrollWidth,doc:document.documentElement.scrollWidth}})()`);
  ok(tabsBox.doc <= 390, 'no horizontal page scroll at 390 px: ' + JSON.stringify(tabsBox));
  ok(await ev(`[...document.querySelectorAll("#homeV2 .rnav-htab")].every(b=>b.offsetHeight>=44)`), "tabs are 44 px tall (offsetHeight: Home may still be scaling in)");
  await scrollToTabs(); await shot('390-foryou-light');

  // 2. Learn: every learning tool, pinned or not, with New chips; remembered after a reload.
  await click('#rnavHtab-learn');
  ok(await activeTab() === 'learn', 'Learn opens');
  let acts = await panelActs('learn');
  ok(['prep', 'clinix', 'kxlearn', 'narke', 'tokos'].every((a) => acts.includes(a)), 'Learn lists the learning tools: ' + acts.join(','));
  ok(await ev(`document.getElementById('rnavHpanel-foryou').hidden`), 'For you hides');
  ok(await ev(`document.querySelectorAll('#rnavHpanel-learn .rnav-tile-new').length>0`), 'never-opened tools carry New');
  ok(/Anaesthetica/.test(await text('#rnavHpanel-learn [data-act="narke"]')), 'the anaesthesia tile reads Anaesthetica');
  ok(/Learn anaesthesia/.test(await text('#rnavHpanel-learn [data-act="narke"]')), 'with a plain subtitle');
  await scrollToTabs(); await shot('390-learn-light');
  await call('Page.reload', {}); await until(`!!document.querySelector('#homeV2 .rnav-htab.on')`, 30000);
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  ok(await activeTab() === 'learn', 'the last tab is remembered');

  // 3. Bedside and Practice.
  await click('#rnavHtab-bedside'); acts = await panelActs('bedside');
  ok(['dosecalc', 'codeblue', 'docs'].every((a) => acts.includes(a)), 'Bedside: ' + acts.join(','));
  await click('#rnavHtab-practice'); acts = await panelActs('practice');
  ok(['followcare', 'kxinbox'].every((a) => acts.includes(a)), 'Practice: ' + acts.join(','));
  ok(await ev(`(document.querySelector('#rnavHpanel-practice .rnav-tab-sub')||{}).innerText.length>5`), 'each task tab says what it is for');

  // 4. Opening a tool from a tab marks it seen: no New chip next time.
  await ev(`window.SMD_TOOL_GROUPS.markSeen('narke');1`);
  await click('#rnavHtab-learn');
  ok(await ev(`!document.querySelector('#rnavHpanel-learn [data-act="narke"] .rnav-tile-new')`), 'a seen tool loses its New chip');
  await ev(`window.__opened=null;1`);
  ok(await ev(`(()=>{const k=document.querySelector('#rnavHpanel-learn [data-act="guidelines"]');k.click();return JSON.parse(localStorage.getItem('smd_tools_seen')).includes('guidelines')})()`), 'tapping a tile marks it seen');
  await ev(`document.querySelectorAll('.modal.open,.overlay.on').forEach(m=>m.classList.remove('open','on'));1`);

  // 5. Specialty tab with no kit: opens the picker; choosing Oncology names the tab and lists its tools.
  await call('Page.reload', {}); await until(`!!document.querySelector('#homeV2 .rnav-htab.on')`, 30000);
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  await click('#rnavHtab-branch');
  ok(await until(`!!document.querySelector('#hvSheet.on [data-branch="oncology"]')`), 'no specialty yet: the picker opens');
  await shot('390-picker-light');
  await click('#hvSheet [data-branch="oncology"]');
  ok(await until(`/Oncology/.test(document.getElementById('rnavHtab-branch').innerText)`), 'the tab is named Oncology');
  acts = await panelActs('branch');
  ok(acts.includes('oncohome') || acts.includes('staging'), 'Oncology lists cancer tools: ' + acts.join(','));
  ok(acts.includes('speckit'), 'and the specialty kit');
  await ev(`try{document.getElementById('hvScrim').click()}catch(e){};1`);
  await scrollToTabs(); await shot('390-oncology-light');
  // Tapping the open specialty tab again opens the picker to switch branch.
  await click('#rnavHtab-branch');
  ok(await until(`!!document.querySelector('#hvSheet.on [data-branch="cardiology"]')`), 'tapping the open specialty tab opens the picker');
  await click('#hvSheet [data-branch="cardiology"]');
  ok(await until(`/Cardiology/.test(document.getElementById('rnavHtab-branch').innerText)`), 'switched to Cardiology');

  // 6. A kit from the profile names the tab without a pick.
  await boot(`localStorage.setItem('smd_my_specialty','obgyn')`);
  ok(/O&G/.test(await ev(`document.getElementById('rnavHtab-branch').innerText`)), 'kit obgyn: the tab reads O&G');

  // 7. Not now hides the Try card for the week.
  ok(await click('#rnavTry .rnav-try-no'), 'Not now tapped');
  ok(await ev(`!document.querySelector('#rnavTry .rnav-try')`), 'Try card gone');
  await call('Page.reload', {}); await until(`!!document.querySelector('#homeV2 .rnav-htab.on')`, 30000);
  ok(await ev(`!document.querySelector('#rnavTry .rnav-try')`), 'and stays gone after a reload');

  // 8. Problem search: "sodium 122" leads with Electrolytes.
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());window.openSearch();1`);
  ok(await until(`!!document.getElementById('usInput') && !document.getElementById('usInput').disabled`, 15000), 'search opens');
  const first = async (q) => { await ev(`(()=>{const i=document.getElementById('usInput');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));})();1`); await sleep(400); return ev(`(document.querySelector('#usBody [data-cat="tools"], #usBody .us-row')||{}).innerText||''`); };
  let row = await first('sodium 122');
  ok(/Electrolytes/.test(row) && /Fits your search/.test(row), 'sodium 122 -> Electrolytes first: ' + row.replace(/\s+/g, ' ').slice(0, 80));
  row = await first('dose for a child');
  ok(/Dose calculator/.test(row), 'dose for a child -> Dose calculator: ' + row.replace(/\s+/g, ' ').slice(0, 80));
  await shot('390-search-light');
  await ev(`window.closeSearch&&window.closeSearch();1`);

  // 9. iPad width and dark theme.
  await size(1024, 1366);
  await boot(`localStorage.setItem('smd_my_specialty','cancer-screening');localStorage.setItem('smd_home_tab','bedside')`);
  ok(await activeTab() === 'bedside', 'iPad: remembered tab opens');
  ok(await ev(`document.documentElement.scrollWidth<=1024`), 'iPad: no horizontal scroll');
  await scrollToTabs(); await shot('ipad-bedside-light');
  await ev(`document.body.classList.add('dark');document.documentElement.setAttribute('data-theme','dark');1`);
  await click('#rnavHtab-foryou'); await scrollToTabs(); await shot('ipad-foryou-dark');
  ok(await ev(`(()=>{const b=document.querySelector('#homeV2 .rnav-htab:not(.on)'),s=getComputedStyle(b);return s.color!==s.backgroundColor})()`), 'dark: tab text visible');
  await size(390, 844); await click('#rnavHtab-branch'); await scrollToTabs(); await shot('390-oncology-dark');

  // 10. Kill switch: the single grid as before.
  await boot('', '?hometabs=0');
  ok(await ev(`!document.querySelector('#homeV2 .rnav-htabs') && !!document.querySelector('#rnavToolsGrid .rnav-tile.addtool')`), '?hometabs=0: no tabs, the grid as before');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
