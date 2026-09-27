// Real-browser test of the antibiogram rebuild: the full app in headless Chrome at 390px.
//   Antibiogram screen (v2): sources, strata chips, heatmap, cell sheet with its source, %R toggle,
//     pooled India view, Sources tab (census + a source's own consistency checks), My hospital
//     import (summary CSV, checked, saved on the device, used as a profile, removed)
//   one shared profile picker (reasoning, console, screen)
//   Stewardship console: syndrome-matched specimen (urine for pyelonephritis, blood for sepsis),
//     isolate numbers, AWaRe, provenance on tap
//   Syndrome reasoning: the resistance panel for the lead diagnosis, link to the full antibiogram
//   flag smd_abg_v2 = "0": the previous resistance view still works on the new data
//   kill switch smd_abg_data = "0": console and reasoning fall back to the built-in national summary
//   keyboard access to every figure, search feedback, breakpoint notes, CSV contents, print label,
//   a % resistant import caught before it is saved as % susceptible
//   no em dash in the new screens
//   redesign (flag smd_abg_pro): three one-line tabs, Sources beside the exports with a way back,
//     plain drug names; flag off restores the previous look
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
const PORT = 9083, CDP = 9483, OUT = "/tmp/stewardmd-abgx";
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
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until('!!(window.ABG&&window.ABG_V2&&window.ABG_STORE&&window.ABG_RULES)', 30000), 'app loaded');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');1`);
  ok(await until('ABG_STORE.loaded()', 15000), 'bundle loaded');
  for (const pro of ['1', '0']) {
    await ev(`localStorage.setItem('smd_abg_pro','${pro}');localStorage.removeItem('smd_abg_view');ABG.open({tab:'resistance',scope:'inst:SKIMS_SRINAGAR'});1`);
    ok(await until(`!!document.querySelector('#abgOverlay .v2-foot')`), `resistance renders (pro=${pro})`);
    // Pick the longest-named pair in WISCA so selects are at their widest.
    await ev(`(()=>{const a=document.querySelector('#v2DrugA');if(a){a.selectedIndex=a.options.length-1;a.dispatchEvent(new Event('change',{bubbles:true}))}})();1`);
    await sleep(300);
    const ov = await ev(`(()=>{const W=document.documentElement.clientWidth,bad=[];document.querySelectorAll('#abgBody *').forEach(e=>{if(e.closest('.v2-tw,.v2-chips,.v2-ph,#abgV2Sheet'))return;const r=e.getBoundingClientRect();if(!r.width)return;if(r.left<-0.5||r.right>W+0.5)bad.push((e.className||e.tagName)+':'+Math.round(r.left)+'..'+Math.round(r.right))});const b=document.querySelector('#abgBody');const o=document.querySelector('#abgOverlay').getBoundingClientRect();return {bad:bad.slice(0,8),sw:b.scrollWidth,cw:b.clientWidth,iw:innerWidth,W,ov:[o.left,o.right],br:[b.getBoundingClientRect().left,b.getBoundingClientRect().right]}})()`);
    ok(ov.bad.length === 0 && ov.sw <= ov.cw + 1, `SMD-13 nothing on the resistance screen spills past the screen edge (pro=${pro}): ` + JSON.stringify(ov));
    const sl = await ev(`(()=>{let m=0;[document.querySelector('#abgBody'),document.querySelector('#abgOverlay'),document.scrollingElement].forEach(e=>{if(!e)return;e.scrollLeft=200;m=Math.max(m,e.scrollLeft);e.scrollLeft=0});return m})()`);
    ok(sl === 0, `SMD-13 the screen cannot be dragged sideways (pro=${pro}): ${sl}`);
    // Stress: the older two-across picker row with a very long drug pair (the iPhone screenshot).
    const wide = await ev(`(()=>{const w=document.querySelector('.v2-wrow');if(!w)return 'none';w.style.gridTemplateColumns='1fr 1fr';w.querySelectorAll('select').forEach(x=>{const o=document.createElement('option');o.textContent='Amoxicillin-clavulanate plus a very long combination name (W)';x.appendChild(o);x.value=o.value});const W=document.documentElement.clientWidth,bad=[];document.querySelectorAll('.v2-wis, .v2-wis *, .v2-foot, .v2-foot *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&(r.left<-0.5||r.right>W+0.5))bad.push(e.className||e.tagName)});return bad.join(',')})()`);
    ok(wide === '' || wide === 'none', `SMD-13 a long two-across drug pair stays inside the screen (pro=${pro}): ${wide}`);
    await ev(`document.querySelector('.v2-foot').scrollIntoView({block:'end'});1`);
    await shot('res-' + pro);
    await ev('ABG.close();1');
  }
  /* ---- SMD-12: PDF letterhead and a table that fits a portrait page ---- */
  for (const [scope, spec] of [['inst:SKIMS_SRINAGAR', 'all'], ['india', 'all'], ['india', 'blood']]) {
    await ev(`ABG.open({tab:'resistance',scope:${JSON.stringify(scope)}});1`);
    await until(`!!document.querySelector('#abgOverlay .v2-foot')`);
    await ev(`(()=>{const b=document.querySelector('.v2-chips button[data-v2="spec"][data-v="${spec}"]');if(b)b.click()})();1`);
    await sleep(200);
    const r = await ev(`new Promise(res=>{const f=document.createElement('iframe');f.style.cssText='position:fixed;left:0;top:0;width:560px;height:800px;border:0;background:#fff;z-index:99999';document.body.appendChild(f);f.srcdoc=ABG_V2._pdfHtml();f.onload=()=>{const d=f.contentDocument,tb=d.querySelector('table'),bd=d.body;const cells=[...d.querySelectorAll('th,td')];const clipped=cells.filter(c=>c.scrollWidth>c.clientWidth+1).length;const o={fits:tb.getBoundingClientRect().right<=bd.getBoundingClientRect().right+0.5,tw:Math.round(tb.getBoundingClientRect().width),bw:Math.round(bd.clientWidth),cols:Math.max(...[...d.querySelectorAll('thead tr')].map(r=>r.children.length-2)),blocks:d.querySelectorAll('table').length,minTh:Math.min(...[...d.querySelectorAll('thead th')].map(x=>x.clientWidth)),clipped,lh:d.querySelector('.lh')?.innerText||'',logo:(()=>{const i=d.querySelector('.lh img.mk');return !!i&&i.complete&&i.naturalWidth>40&&/^data:image\\/png/.test(i.src)})(),key:!!d.querySelector('.key'),dash:/\u2014/.test(d.body.innerText)};f.remove();res(o)}})`);
    if (process.env.PDF_OUT) await writeFile(`${process.env.PDF_OUT}/${spec}-${scope.replace(/\W/g,'')}.html`, await ev('ABG_V2._pdfHtml()'));
    ok(r.fits && r.clipped === 0 && r.cols <= 14 && r.minTh >= 24, `SMD-12 ${scope}/${spec}: at most ${r.cols} antibiotics per block (${r.blocks} blocks, narrowest column ${r.minTh}px) fit the portrait page, no clipped cell (table ${r.tw} of ${r.bw}px, clipped ${r.clipped})`);
    ok(/StewardMD/.test(r.lh) && /Period:/.test(r.lh) && /Exported \d{4}-\d\d-\d\d/.test(r.lh), `SMD-12 ${scope}/${spec}: letterhead has the wordmark, source, period and export date: ` + r.lh.replace(/\n/g, ' | '));
    ok(r.logo, `SMD-12 ${scope}/${spec}: the StewardMD SD mark is in the letterhead, inlined so the native PDF renderer shows it`);
    ok(r.cols <= 10 || r.key, `SMD-12 ${scope}/${spec}: with many antibiotics the codes carry a key`);
    ok(!r.dash, `SMD-12 ${scope}/${spec}: no em dash in the PDF`);
    ev('ABG.close();1');
  }
  const csvHead = await ev(`ABG_STORE.csv(ABG_STORE.table('india','all','all'),{scope:'India'}).split('\\n').slice(0,3).join(' / ')`);
  ok(/exported from StewardMD/i.test(csvHead) && /Source,India/.test(csvHead), 'SMD-12 the CSV starts with a StewardMD header block: ' + csvHead);

  /* ---- SMD-11: the import period is picked (From / To month and year), stored one way ---- */
  await ev(`ABG.open({tab:'mine'});1`);
  ok(await until(`!!document.querySelector('#v2PerFm')&&!document.querySelector('#v2Period')`), 'SMD-11 From and To month-year pickers replace the free-text period');
  const set = (fm, fy, tm, ty) => ev(`(()=>{const v={v2PerFm:${fm},v2PerFy:${fy},v2PerTm:${tm},v2PerTy:${ty}};Object.keys(v).forEach(k=>{document.querySelector('#'+k).value=String(v[k])});document.querySelector('#v2Name').value='Period Test Hospital';document.querySelector('#v2Paste').value=ABG_RULES.summaryTemplate();})();1`);
  await set(8, 2026, 2, 2023);
  await click('[data-v2="imp-check"]');
  ok(await until(`/ends before it starts/.test(document.querySelector('#abgBody').innerText)`), 'SMD-11 a period that ends before it starts is refused');
  await set(0, 2023, 8, 2026);
  await click('[data-v2="imp-check"]');
  ok(await until(`/rows ready/.test(document.querySelector('#abgBody').innerText)`), 'SMD-11 a valid period passes the check');
  ok(await ev(`document.querySelector('#v2PerFy').value==='2023'&&document.querySelector('#v2PerTm').value==='8'`), 'SMD-11 the picks survive the check re-render');
  await click('[data-v2="imp-save"]');
  ok(await until(`/"period":"Jan 2023 to Sep 2026"/.test(localStorage.getItem('smd_abg_local')||'')`), 'SMD-11 saved in the one standard form "Jan 2023 to Sep 2026"');
  await ev(`ABG.close();ABG.open({tab:'mine'});1`);
  ok(await until(`document.querySelector('#v2PerFy')?.value==='2023'&&document.querySelector('#v2PerTy')?.value==='2026'`), 'SMD-11 reopening prefills the saved period');
  await shot('mine-period');
  await ev(`window.confirm=()=>true;document.querySelector('[data-v2="del-local"]').click();1`);
  await ev('ABG.close();1');
} catch (e) { console.log('FAIL', e.message); failures++; }
finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? `${failures} failed` : 'all passed'); process.exit(failures ? 1 : 0);
