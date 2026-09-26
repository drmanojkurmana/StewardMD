// Real-browser test of the antibiogram rebuild: the full app in headless Chrome at 390px.
//   Antibiogram screen (v2): sources, strata chips, heatmap, cell sheet with its source, %R toggle,
//     pooled India view, Sources tab (census + a source's own consistency checks), My hospital
//     import (summary CSV, checked, saved on the device, used as a profile, removed)
//   one shared profile picker (reasoning, console, screen)
//   Stewardship console: syndrome-matched specimen (urine for pyelonephritis, blood for sepsis),
//     isolate numbers, AWaRe, provenance on tap
//   Syndrome reasoning: the resistance panel for the lead diagnosis, link to the full antibiogram
//   flag smd_abg_v2 = "0": the previous resistance view still works on the new data
//   no em dash in the new screens
//   node test/run-antibiogram-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9081, CDP = 9481, OUT = '/tmp/stewardmd-abg';
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
  ok(await until('!!(window.ABG&&window.ABG_V2&&window.ABG_STORE&&window.ABG_RULES&&window.HOSPITAL&&window.ASP&&window.DX)', 30000), 'app loaded with the antibiogram modules');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');1`);
  await armToasts();

  /* ---- data and profiles ---- */
  ok(await until('ABG_STORE.loaded()', 15000), 'the bundle loads (prefetched after start-up)');
  const ver = await ev('ABG_STORE.data().version'), idxVer = await ev('ABG_INDEX.version');
  ok(ver === idxVer, `bundle version matches the start-up index (${ver})`);
  ok(await until(`HOSPITAL.list.some(h=>h.id==='INDIA_POOLED')&&HOSPITAL.list.some(h=>h.abgScope==='inst:SKIMS_SRINAGAR')`), 'profiles: India pooled and every institution');
  const groups = await ev(`HOSPITAL.optionGroups().map(g=>g.label)`);
  ok(groups[0] === 'National' && groups.includes('Pooled') && groups.includes('North India'), 'shared picker groups: ' + groups.join(' | '));
  const skimsId = await ev(`HOSPITAL.profileForScope('inst:SKIMS_SRINAGAR')`);
  ok(skimsId === 'ABG_SKIMS_SRINAGAR', 'SKIMS has a stable profile id (the institution, not the edition): ' + skimsId);
  const oldId = await ev(`(function(){var k='stewardmd_hospital',p=localStorage.getItem(k);localStorage.setItem(k,'ABG_SKIMS_2025');var id=HOSPITAL.current().id;if(p==null)localStorage.removeItem(k);else localStorage.setItem(k,p);return id;})()`);
  ok(oldId === 'ABG_SKIMS_SRINAGAR', 'an id saved by an older build (one edition) resolves to its institution: ' + oldId);

  /* ---- Antibiogram screen, single source ---- */
  await ev(`localStorage.removeItem('smd_abg_view');ABG.open({tab:'resistance',scope:'inst:SKIMS_SRINAGAR'});1`);
  ok(await until(`!!document.querySelector('#abgOverlay .v2-t tbody tr')`), 'resistance table renders');
  ok(await ev(`document.querySelector('#v2Scope').value==='inst:SKIMS_SRINAGAR'`), 'the requested source is selected');
  const chips = await ev(`[...document.querySelectorAll('.v2-chips button[data-v2="spec"]')].map(b=>b.textContent)`);
  ok(chips.includes('Blood') && chips.includes('Urine'), 'specimen chips: ' + chips.join(', '));
  await click('.v2-chips button[data-v2="spec"][data-v="blood"]');
  ok(await until(`[...document.querySelectorAll('.v2-chips button[data-v2="set"]')].some(b=>b.textContent==='ICU')`), 'setting chips for blood include ICU');
  await click('.v2-chips button[data-v2="set"][data-v="icu"]');
  ok(await until(`/ICU/.test(document.querySelector('.v2-t caption').textContent)`), 'table caption follows the stratum');
  await shot('abg-skims-blood-icu');
  const firstCell = await ev(`(()=>{const c=document.querySelector('.v2-t td.v2-c[data-v2="cell"]:not(.v2-ir):not(.v2-x)');return c?{t:c.textContent,org:c.dataset.org,drug:c.dataset.drug}:null})()`);
  ok(!!firstCell, 'a value cell is present: ' + JSON.stringify(firstCell));
  await ev(`document.querySelector('.v2-t td.v2-c[data-v2="cell"]:not(.v2-ir):not(.v2-x)').click()`);
  ok(await until(`document.querySelector('#abgV2Sheet').classList.contains('on')`), 'tapping a cell opens its sheet');
  const sheet = await text('#abgV2Sheet');
  ok(/SKIMS|Sher-i-Kashmir/i.test(sheet) && /isolates/.test(sheet), 'the sheet names the source and the isolates');
  ok(!/20\d\d\d+ isolates/.test(sheet), 'the edition year and the isolate count stay apart on screen (no "2025487 isolates")');
  await shot('abg-cell-sheet');
  await click('#abgV2Sheet [data-v2="sheet-close"]');
  const sVal = parseFloat(firstCell.t);
  await click('[data-v2="mode"][data-v="r"]');
  const rVal = await ev(`parseFloat(document.querySelector('.v2-t td.v2-c[data-org="${firstCell.org}"][data-drug="${firstCell.drug}"]').textContent)`);
  ok(Math.abs(rVal - (100 - sVal)) < 0.11, `% resistant toggle: ${sVal} susceptible shows as ${rVal} resistant`);
  await click('[data-v2="mode"][data-v="s"]');

  /* ---- the default national profile: the ICMR AMRSN report ---- */
  const icmrScope = await ev(`(HOSPITAL.list.find(h=>h.id==='ICMR')||{}).abgScope||''`);
  ok(/^src:ICMR_AMRSN_20\d\d$/.test(icmrScope), 'the ICMR profile reads the full ICMR AMRSN report: ' + icmrScope);
  await ev(`(()=>{const s=document.querySelector('#v2Scope');s.value=${JSON.stringify(icmrScope)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  ok(await until(`document.querySelectorAll('.v2-t tbody tr').length>5`), 'ICMR table renders with many organisms');
  const icmrChips = await ev(`[...document.querySelectorAll('.v2-chips button[data-v2="spec"]')].map(b=>b.textContent)`);
  ok(icmrChips.includes('All specimens except urine and stool') && icmrChips.includes('Urine'), 'ICMR strata include all-except-urine and urine: ' + icmrChips.join(', '));
  await shot('abg-icmr');
  /* ---- pooled ---- */
  await ev(`(()=>{const s=document.querySelector('#v2Scope');s.value='india';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  ok(await until(`/Pooled from/.test(document.querySelector('.v2-meta')?.innerText||'')`), 'India pooled view explains the pool');
  ok(await ev(`HOSPITAL.current().id==='INDIA_POOLED'`), 'choosing a source moves the app-wide profile');
  await shot('abg-india-pooled');

  /* ---- Sources ---- */
  await click('#abgOverlay .abg-tab[data-tab="sources"]');
  ok(await until(`/Where the numbers come from/.test(document.querySelector('#abgBody').innerText)`), 'Sources tab explains the census');
  ok(await ev(`/checked twice against the document/.test(document.querySelector('#abgBody').innerText)`), 'verification counts are stated per source');
  await ev(`[...document.querySelectorAll('.v2-src button[data-v2="src"]')].find(b=>/SKIMS/.test(b.textContent))?.click()`);
  ok(await until(`/own tables disagree/i.test(document.querySelector('#abgV2Sheet').innerText)`), "a source's own inconsistencies are shown");
  // A sheet opened again after another closed must fill the screen (dialog-motion once left scale(0.97) on it).
  ok(await until(`(()=>{const o=document.querySelector('#abgV2Sheet'),s=o.querySelector('.v2-sh');return getComputedStyle(o).transform==='none'&&Math.abs(s.getBoundingClientRect().bottom-innerHeight)<2})()`), 'the reopened sheet is not scaled and reaches the bottom of the screen');
  await shot('abg-source-sheet');
  await click('#abgV2Sheet [data-v2="sheet-close"]');

  /* ---- My hospital: import, check, save, use, remove ---- */
  await click('#abgOverlay .abg-tab[data-tab="mine"]');
  ok(await until(`!!document.querySelector('#v2Paste')`), 'My hospital tab renders');
  await ev(`document.querySelector('#v2Name').value='Test City Hospital';document.querySelector('#v2Paste').value=ABG_RULES.summaryTemplate();1`);
  await click('[data-v2="imp-check"]');
  ok(await until(`/rows ready/.test(document.querySelector('#abgBody').innerText)`), 'the pasted table is checked');
  await click('[data-v2="imp-save"]');
  ok(await until(`document.querySelector('#v2Scope')?.value==='local'`), 'saved on the device and shown');
  ok(await until(`HOSPITAL.list.some(h=>h.id==='LOCAL')`), 'it becomes a selectable profile');
  ok(!(await ev(`JSON.stringify(localStorage.getItem('smd_abg_local')||'').includes('patient')`)), 'nothing patient-identifying is stored');
  await click('#abgOverlay .abg-tab[data-tab="mine"]');
  await ev(`window.__confirm=window.confirm;window.confirm=()=>true;1`);
  await click('[data-v2="del-local"]');
  await ev(`window.confirm=window.__confirm;1`);
  ok(await until(`!localStorage.getItem('smd_abg_local')`), 'removed from the device');

  /* ---- no em dash on the new screens ---- */
  let dash = false;
  for (const t of ['resistance', 'sources', 'mine']) { await click(`#abgOverlay .abg-tab[data-tab="${t}"]`); await sleep(200); if (/—/.test(await text('#abgBody'))) dash = true; }
  ok(!dash, 'no em dash in the resistance, sources and my-hospital screens');
  // Dark mode: the table and sheets stay legible (text colour differs from its background).
  await ev(`document.body.classList.add('dark');1`);
  await click('#abgOverlay .abg-tab[data-tab="resistance"]');
  await until(`!!document.querySelector('.v2-t')`);
  const contrast = await ev(`(()=>{const o=document.querySelector('.v2-o button'),m=document.querySelector('.v2-meta');const c=(e)=>getComputedStyle(e);return !!o&&!!m&&c(o).color!==c(document.querySelector('.v2-tw')).backgroundColor&&c(m).color!==c(m).backgroundColor})()`);
  ok(contrast, 'dark mode: organism names and the meta panel keep contrast');
  await shot('abg-dark');
  await ev(`document.body.classList.remove('dark');1`);
  await ev('ABG.close();1');

  /* ---- Stewardship console ---- */
  await ev(`HOSPITAL.setProfile(${JSON.stringify(skimsId)});1`);
  await ev(`ASP.open('PYELONEPHRITIS');1`);
  ok(await until(`!!document.querySelector('.asp-region #aspRegionBody')`), 'console shows the antibiogram panel');
  ok(await until(`/urine/i.test(document.querySelector('#aspRegionBody').innerText)&&/isolates/.test(document.querySelector('#aspRegionBody').innerText)`), 'pyelonephritis uses urine figures, with isolate numbers');
  ok(await ev(`document.querySelector('#aspRegionSel').value===${JSON.stringify(skimsId)}`), 'the console picker shows the active profile');
  await ev(`document.querySelector('.asp-region').scrollIntoView({block:'start'});1`);
  await shot('console-pyelo');
  await ev(`window.__toasts=[];document.querySelector('.asp-region-row[data-drug]')?.click();1`);
  // Read the toast as it is ON SCREEN: the app-wide citation scrub must not delete "page N".
  ok(await until(`/(SKIMS|Sher-i-Kashmir).*page \\d+/i.test((document.querySelector('.abg-toast.on')||{}).textContent||'')`), 'tapping a value names its source and page, as shown on screen');
  console.log('  toast:', await ev(`(document.querySelector('.abg-toast')||{}).textContent||''`));
  await ev(`ASP.open('SEPSIS');1`);
  ok(await until(`/blood/i.test(document.querySelector('#aspRegionBody')?.innerText||'')`), 'sepsis uses blood figures');

  /* ---- Syndrome reasoning ---- */
  await ev(`try{ASP.close&&ASP.close()}catch(e){};DX.openWorkspace();DX.reset();1`);
  const ids = await ev(`(()=>{const keys=DX.findingCatalog().map(f=>f.key);return ['fever','feverGU','dysuria','flankPain','costovertebralTenderness','urinaryFrequency'].filter(k=>keys.includes(k))})()`);
  await ev(`DX.addFindings(${JSON.stringify(ids)});1`);
  const lead = await ev(`(DX._differential().inf||[])[0]?.id||''`);
  ok(/PYELO|UTI|CYSTITIS/.test(lead), `a UTI syndrome leads (${lead}) from findings ${ids.join(', ')}`);
  ok(await until(`!!document.querySelector('#dxPolicy .dx-region-abg')`, 12000), 'reasoning shows the resistance panel for the lead syndrome');
  const rp = await text('#dxPolicy .dx-region-abg');
  ok(/urine/i.test(rp) && /isolates/.test(rp) && !/—/.test(rp), 'the panel names the specimen and isolates, without an em dash');
  await ev(`document.querySelector('[data-dx-jump="dxReview"]')?.click();1`); await sleep(300);
  await ev(`document.querySelector('#dxPolicy .dx-region-abg').scrollIntoView({block:'start'});1`);
  await shot('reasoning-panel');
  await click('#dxPolicy .dx-abg-open');
  ok(await until(`document.querySelector('#abgOverlay')?.classList.contains('on')`), 'the panel opens the full antibiogram');
  await ev('ABG.close();1');

  /* ---- flag off: previous view on the new data ---- */
  await ev(`localStorage.setItem('smd_abg_v2','0');HOSPITAL.setProfile('ICMR');ABG.close();document.getElementById('abgOverlay')?.remove();1`);
  await call('Page.reload');
  ok(await until('!!(window.ABG&&window.HOSPITAL)', 30000), 'reloaded with the flag off');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  await until('window.ABG_STORE&&ABG_STORE.loaded()', 15000);
  await ev(`ABG.open({tab:'resistance'});1`);
  ok(await until(`!!document.querySelector('#abgSrc')&&!document.querySelector('.v2-t')`), 'flag off: the previous resistance view renders');
  ok(await ev(`document.querySelectorAll('#abgBody .abg-oc').length>0`), 'flag off: it still lists organisms');
  await shot('abg-flag-off');
  await ev(`localStorage.removeItem('smd_abg_v2');1`);
} catch (e) {
  console.log('ERROR', e.message); failures++;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL'); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
}
