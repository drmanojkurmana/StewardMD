// Real-browser test: the neonatal layer (neo-*.js) end to end at phone width. Flag off first, then
// ?neo=1: baby record, every tool screen, the tenfold guard, the high-alert second check, the dose
// calculator's neonatal path, 360 px overflow, dark mode, and the [hidden] display trap.
// Expected numbers are read from data/neo/*.json, not typed here.
//   node test/run-neo-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9097, CDP = 9497, OUT = '/tmp/stewardmd-neo';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const J = (f) => JSON.parse(readFileSync(join(repo, 'data/neo', f + '.json'), 'utf8'));
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = p === '/dose-rules.json.gz' ? join(repo, 'data/dose-rules.json.gz') : join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('404'); return; } res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/neo-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failures++; };
const until = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch { /* page busy */ } await sleep(100); } return false; };
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
const typeIn = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.focus();e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
async function shot(name) { await sleep(250); await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
const noOverflow = `(()=>{const b=document.querySelector('#neoHub .nh-body');return !!b&&b.scrollWidth<=b.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1})()`;
const bodyText = () => text('#neoHub .nh-body');
const pad = (n) => String(n).padStart(2, '0');
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });

  // 0) Flag OFF (default): nothing neonatal loads or shows.
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until('!!window.SMD_NEO_FLAGS && !!window.SMD_openRoute', 30000), 'app loaded, neo-flags.js present');
  await sleep(800);
  ok(await ev(`SMD_NEO_FLAGS.on()===false && !window.SMD_NEO_HUB && !window.SMD_NEO_DOSE`), 'flag OFF by default: the layer does not load');
  ok(await ev(`!(window.SMD_HOME_TOOLS&&SMD_HOME_TOOLS().some(t=>t.act==='neo'))`), 'flag OFF: no Neonatal home tool');
  ok(await ev(`!(MEDCALC._calcs||[]).some(c=>c.cat==='Neonatology')`), 'flag OFF: no neonatal calculators');

  // 1) Flag ON
  await call('Page.navigate', { url: `http://localhost:${PORT}/?neo=1` });
  ok(await until('!!window.SMD_NEO_HUB && !!window.SMD_NEO && !!window.SMD_NEO_DOSE && !!window.SMD_NEO_TDM && !!window.SMD_openRoute', 30000), 'flag ON (?neo=1): the layer loads');
  ok(await ev(`SMD_HOME_TOOLS().some(t=>t.act==='neo')`), 'Neonatal tile in the home tools registry');
  ok(await ev(`SMD_NEO_HUB.tools().length`) >= 10, 'hub lists every tool');
  await ev(`SMD_openRoute('neo');1`);
  ok(await until(`!!document.querySelector('#neoHub:not([hidden]) #nh_gaW')`, 5000), 'Home route opens the hub with the baby record open');
  // Baby: GA 30+2, born 4 days ago at 08:00, 1,250 g now, 1,180 g at birth, female.
  const now = new Date(); const born = new Date(now.getTime() - 4 * 864e5);
  const dob = `${born.getFullYear()}-${pad(born.getMonth() + 1)}-${pad(born.getDate())}`;
  await typeIn('#nh_gaW', '30'); await typeIn('#nh_gaD', '2'); await typeIn('#nh_dob', dob); await typeIn('#nh_tob', '00:00');
  await typeIn('#nh_weightG', '1.2');
  ok(/looks like kilograms/.test(await bodyText()), 'unit lock: 1.2 in a gram field is refused as kilograms');
  await typeIn('#nh_weightG', '1250'); await typeIn('#nh_birthWeightG', '1180'); await click('#neoHub [data-sex=F]');
  const sum = await text('#neoHub .nh-bsum');
  ok(/GA 30\+2/.test(sum) && /1,250 g/.test(sum) && /Female/.test(sum) && /PMA 30\+6/.test(sum), 'pinned baby summary: ' + sum.split('\n')[0]);
  await click('#neoHub [data-nh=edit]');
  await shot('home');
  ok(await ev(noOverflow), '360 px: no horizontal overflow on the hub');

  // 2) Every tool opens, shows a Draft badge, and fits 360 px.
  for (const t of await ev(`SMD_NEO_HUB.tools().map(t=>t.id)`)) {
    await ev(`SMD_NEO_HUB.open(${JSON.stringify(t)});1`);
    const loaded = await until(`!/Loading/.test(document.querySelector('#neoHub [data-nh=screen]').innerText)`, 8000);
    const txt = await bodyText();
    ok(loaded && !/could not open/i.test(txt), `tool "${t}" opens`);
    ok(/draft/i.test(txt), `tool "${t}" shows the Draft badge`);
    ok(await ev(noOverflow), `tool "${t}" fits 360 px`);
    ok(!/[—–]/.test(await ev(`[...document.querySelectorAll('#neoHub .nh-body *')].filter(e=>!e.closest('blockquote')&&e.children.length===0).map(e=>e.textContent).join(' ')`)), `tool "${t}": no em or en dash in app text`);
  }

  // 3) Dosing: caffeine loading dose = the band's mg/kg x 1.25 kg; tenfold guard.
  const caf = [...J('dose-bands-other').drugs].find((d) => d.id === 'caffeine-citrate');
  const load = caf.regimens[0].bands.find((b) => /loading/i.test(b.label)).dose.lo * 1.25;
  await ev(`SMD_NEO_HUB.open('dose',{drug:'caffeine-citrate'});1`);
  ok(await until(`/${load} mg per dose/.test(document.querySelector('#neoHub .nh-body').innerText)`, 6000), `caffeine loading dose ${load} mg for 1,250 g (from the band)`);
  await typeIn('#neoHub [data-plan="0:0"]', String(load * 10));
  ok(/STOP/.test(await text('#neoHub [data-guard="0:0"]')), 'tenfold guard: 10 x the band is a hard stop');
  ok(await ev(`[...document.querySelectorAll('#neoHub [data-neo-prep]')].every(b=>b.disabled)`), 'hard stop disables Prepare');
  await typeIn('#neoHub [data-plan="0:0"]', String(load));
  ok(/Within the band/.test(await text('#neoHub [data-guard="0:0"]')), 'the band dose itself passes');
  await shot('dose-caffeine');
  await ev(`SMD_NEO_HUB.open('dose',{drug:'aciclovirr'});1`);
  ok(await until(`/No neonatal dose on file/.test(document.querySelector('#neoHub .nh-body').innerText)`, 5000), 'unknown drug: "No neonatal dose on file"');

  // 4) Prepare from a dose (carry-over): vancomycin.
  await ev(`SMD_NEO_HUB.open('dose',{drug:'vancomycin'});1`);
  ok(await until(`!!document.querySelector('#neoHub [data-neo-prep]')`, 5000), 'vancomycin dose offers Prepare');
  await click('#neoHub [data-neo-prep]');
  ok(await until(`/Draw up/i.test(document.querySelector('#neoHub .nh-body').innerText) && /Reconstitute|Concentration/i.test(document.querySelector('#neoHub .nh-body').innerText)`, 5000), 'Prepare carries the dose over: reconstitute and draw-up shown');
  ok(/rounded to 0\.(01|1) mL/.test(await bodyText()), 'rounding rule shown');
  await shot('prep-vancomycin');

  // 5) Infusion: dopamine, high-alert second check gates Copy.
  const dop = J('infusions').drugs.find((d) => d.id === 'dopamine'), c0 = dop.concentrations.filter((c) => !c.when)[0];
  await ev(`SMD_NEO_HUB.open('inf',{drug:'dopamine'});1`);
  ok(await until(`!!document.querySelector('#neoHub [data-inf=dose]')`, 5000), 'dopamine infusion screen');
  await typeIn('#neoHub [data-inf=dose]', '5');
  const want = Math.round(5 * 1.25 * 60 / (c0.v / (c0.per_ml || 1)) * 100) / 100;
  ok(await until(`/${String(want).replace('.', '\\.')} mL\\/h/.test(document.querySelector('#neoHub .nh-body').innerText)`, 3000), `5 mcg/kg/min at ${c0.v} ${c0.unit}/mL = ${want} mL/h`);
  ok(await ev(`!!document.querySelector('#neoHub [data-2c]')`), 'high-alert: independent second check prompt');
  await click('#neoHub [data-acts=inf] [data-act=copy]');
  ok(await until(`document.querySelector('#neoHub [data-2c]').classList.contains('nh-shake')`, 2000), 'Copy blocked until the second check is ticked');
  await ev(`document.querySelector('#neoHub [data-2c-tick]').checked=true;1`);
  await click('#neoHub [data-acts=inf] [data-act=copy]');
  const copied = await until(`/Copied|Copy failed/.test(document.querySelector('#neoHub [data-acts=inf] [data-act=copy]').textContent)`, 6000);
  ok(copied, 'Copy runs after the second check' + (copied ? '' : ' (button: ' + await text('#neoHub [data-acts=inf] [data-act=copy]') + ', SMD_PRINT: ' + await ev('typeof window.SMD_PRINT') + ')'));
  await shot('infusion-dopamine');

  // 6) Fluids: GIR 3 mL/h of 10% at 1.25 kg = 3 x 10 x 10 / (60 x 1.25) = 4 mg/kg/min.
  await ev(`SMD_NEO_HUB.open('fluids');1`);
  await until(`!!document.querySelector('#neoHub [data-fl=rate]')`, 5000);
  await typeIn('#neoHub [data-fl=rate]', '3'); await typeIn('#neoHub [data-fl=pct]', '10');
  ok(await until(`/4 mg\\/kg\\/min/.test(document.querySelector('#neoHub .nh-body').innerText)`, 3000), 'GIR 4 mg/kg/min');
  await click('#neoHub [data-fl-tab=bag]');
  await until(`!!document.querySelector('#neoHub [data-fl=vol]')`, 3000);
  await typeIn('#neoHub [data-fl=vol]', '120'); await typeIn('#neoHub [data-fl=tgir]', '6');
  ok(await until(`/D50 .* mL \\+ sterile water .* mL/.test(document.querySelector('#neoHub .nh-body').innerText)`, 3000), 'bag builder: D50 + sterile water');
  ok(await ev(noOverflow), 'bag builder fits 360 px');
  await shot('fluids-bag');

  // 7) Calculators registry: GIR under Neonatology with the Draft line.
  ok(await ev(`!!MEDCALC.get('neo_gir') && MEDCALC.run ? true : !!MEDCALC.get('neo_gir')`), 'GIR registered in calculators.js');

  // 8) Search finds individual neonatal tools.
  ok(await ev(`SMD_NEO_HUB.searchItems().some(x=>/Infusions/.test(x.title))`), 'universal search items for neonatal tools');

  // 9) Dark mode
  await ev(`document.body.classList.add('dark');SMD_NEO_HUB.open('growth');1`);
  ok(await ev(`(()=>{const c=getComputedStyle(document.getElementById('neoHub')).backgroundColor.match(/\\d+/g).map(Number);return c[0]<60&&c[1]<60&&c[2]<60})()`), 'dark mode: hub background is dark');
  await shot('growth-dark');
  await ev(`document.body.classList.remove('dark');1`);

  // 10) Dose calculator: a neonate gets the neonatal band table, never child rows.
  await ev(`SMD_NEO_HUB.close();SMD_DOSECALC.open({drug:'Gentamicin',patient:{weight:1.25,age:4,ageUnit:'days',sex:'F'}});1`);
  ok(await until(`!!document.querySelector('#doseCalc:not([hidden]) [data-neo-blk]')`, 8000), 'dose calculator shows the neonatal band block for a neonate');
  ok(!/children's rows/.test(await text('#doseCalc .dc-body')), 'no child-row fallback text');
  await shot('dosecalc-neonate');
  await ev(`SMD_DOSECALC.close();SMD_DOSECALC.open({drug:'Levothyroxine',patient:{weight:1.25,age:4,ageUnit:'days',sex:'F'}});1`);
  ok(await until(`/No neonatal dose on file\\. Do not extrapolate\\./.test(document.querySelector('#doseCalc .dc-body').innerText)`, 8000), 'drug with no neonatal row: "No neonatal dose on file. Do not extrapolate."');
  await ev(`SMD_DOSECALC.close();1`);

  // 11) [hidden] display trap: a closed hub is not painted and does not eat taps.
  await ev(`SMD_NEO_HUB.open();SMD_NEO_HUB.close();1`);
  ok(await ev(`getComputedStyle(document.getElementById('neoHub')).display==='none'`), 'closed hub is display:none');
  ok(await ev(`(()=>{const e=document.elementFromPoint(30,40);return !!e&&!e.closest('#neoHub')})()`), 'taps reach the app behind a closed hub');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
