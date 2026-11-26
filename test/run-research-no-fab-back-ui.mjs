// Regression test: Bug E — no floating round back button on any screen.
// Opens ResearchMD (Thesis to Journal Article), PrepNucleus, and home at
// 1024x1366 (iPad portrait) and 390x844 (iPhone portrait).
// Asserts that no position:fixed element with a back chevron or
// aria-label^="Back" overlaps the top-left 120x120 px corner of the screen.
// Also asserts #smdTopBack does not exist in the DOM at all.
//   node test/run-research-no-fab-back-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('SKIP: No Chrome/Chromium found. Set CHROME=/path/to/chrome.');
  process.exit(0);
}

const PORT = 9138, CDP = 9538, OUT = '/tmp/stewardmd-no-fab-back';
const TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.woff2':'font/woff2'
};

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
    return;
  }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[\\/])+/, ''));
  readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'content-type': TYPES[extname(fp)] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate'
    });
    res.end(data);
  });
}).listen(PORT);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/smd-no-fab-back-${process.pid}`,
  '--no-first-run',
  '--disable-gpu'
], { stdio: 'ignore' });

let ws, sid, id = 0, failures = 0;
const pending = new Map();

const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
});

const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

const ok = (pass, label) => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  if (!pass) failures++;
};

const until = async (expr, ms = 15000) => {
  for (let t = 0; t < ms; t += 150) {
    try { if (await ev(expr)) return true; } catch { /* page busy */ }
    await sleep(150);
  }
  return false;
};

const setViewport = async (w, h, mobile) =>
  call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });

async function shot(name) {
  await sleep(300);
  await mkdir(OUT, { recursive: true });
  const r = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}

// Core assertion: no fixed-position element with a back indicator overlaps top-left 120x120.
// Checks for:
//   1. #smdTopBack does not exist
//   2. No position:fixed element matching [aria-label^="Back"] or containing a back chevron
//      path ("M15 5l-7 7 7 7") sits in the top-left 120x120 zone.
const NO_FAB_BACK_EXPR = `(function() {
  // 1. The removed button must not exist in the DOM.
  if (document.getElementById('smdTopBack')) return 'smdTopBack element exists in DOM';
  // 2. No other fixed-position element with Back semantics in top-left corner.
  var suspects = [].slice.call(document.querySelectorAll('[aria-label],[aria-label^="Back"],[aria-label^="back"]'));
  for (var i = 0; i < suspects.length; i++) {
    var el = suspects[i];
    var lbl = (el.getAttribute('aria-label') || '').toLowerCase();
    if (!lbl.startsWith('back')) continue;
    var cs = window.getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;  // invisible
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
    // overlaps top-left 120x120?
    if (r.left < 120 && r.top < 120) return 'fixed Back element in top-left corner: id=' + el.id + ' class=' + el.className;
  }
  // 3. Any fixed round button with the specific back chevron path.
  var btns = [].slice.call(document.querySelectorAll('button'));
  for (var j = 0; j < btns.length; j++) {
    var b = btns[j];
    var bcs = window.getComputedStyle(b);
    if (bcs.position !== 'fixed') continue;
    var br = b.getBoundingClientRect();
    if (br.width < 2 || br.height < 2) continue;
    if (bcs.visibility === 'hidden' || bcs.display === 'none' || parseFloat(bcs.opacity) < 0.05) continue;
    if (br.left >= 120 || br.top >= 120) continue;
    // Check for back chevron SVG path
    if ((b.innerHTML || '').indexOf('M15 5l-7 7 7 7') !== -1) return 'fixed chevron-back button in top-left corner: id=' + b.id;
    // Round fixed button at top-left is suspicious even without the specific path
    var br2 = parseFloat(bcs.borderRadius) || 0;
    if (br2 >= Math.min(br.width, br.height) / 2 - 2 && br.width < 60 && br.height < 60) {
      return 'suspicious fixed round button in top-left corner: id=' + b.id + ' class=' + b.className;
    }
  }
  return null;  // null = clean
})()`;

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; }
    catch { await sleep(200); }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;

  const viewports = [
    [1024, 1366, false, 'iPad-portrait-1024x1366'],
    [390,  844,  true,  'phone-390x844']
  ];

  for (const [w, h, mobile, label] of viewports) {
    await setViewport(w, h, mobile);

    // ── ResearchMD: Thesis to Journal Article ──
    await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
    ok(await until('!!window.SMD_RESEARCH', 20000), `${label}: ResearchMD app loaded`);
    // Open the thesis workflow which is the screen shown in the bug screenshot.
    await ev(`try { SMD_RESEARCH.open({ screen: 'projects' }); } catch(e) {}`);
    await sleep(600);

    // Wait up to 2 s for swipe-back to run its first tick (setInterval 900ms) — but it has
    // been removed so this just gives the page time to settle.
    await sleep(1000);

    var rmdResult = await ev(NO_FAB_BACK_EXPR);
    ok(rmdResult === null, `${label}: ResearchMD — no floating Back FAB in top-left 120x120 (got: ${rmdResult})`);
    ok(await ev(`!document.getElementById('smdTopBack')`), `${label}: ResearchMD — #smdTopBack element absent from DOM`);
    await shot(`${label}-research`);

    // ── Home screen ──
    await call('Page.navigate', { url: `http://localhost:${PORT}/` });
    ok(await until('!!document.getElementById("homeV2")', 15000), `${label}: home screen loaded`);
    await sleep(1000);
    var homeResult = await ev(NO_FAB_BACK_EXPR);
    ok(homeResult === null, `${label}: home — no floating Back FAB in top-left 120x120 (got: ${homeResult})`);
    ok(await ev(`!document.getElementById('smdTopBack')`), `${label}: home — #smdTopBack absent from DOM`);
    await shot(`${label}-home`);

    // ── PrepNucleus (a full-screen module with its own back controls) ──
    // Navigate via URL param so the module boots without needing user interaction on home.
    await call('Page.navigate', { url: `http://localhost:${PORT}/?prep=1` });
    ok(await until('!!window.PREP || !!document.getElementById("smdPrep")', 15000), `${label}: PrepNucleus module loaded`);
    await sleep(1000);
    var prepResult = await ev(NO_FAB_BACK_EXPR);
    ok(prepResult === null, `${label}: PrepNucleus — no floating Back FAB in top-left 120x120 (got: ${prepResult})`);
    ok(await ev(`!document.getElementById('smdTopBack')`), `${label}: PrepNucleus — #smdTopBack absent from DOM`);
    await shot(`${label}-prep`);
  }

  // Confirm SMD_SWIPE_BACK no longer exposes syncHandle (it was removed with the button).
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until('!!window.SMD_SWIPE_BACK', 15000), 'SMD_SWIPE_BACK global present');
  ok(await ev(`typeof window.SMD_SWIPE_BACK.syncHandle === 'undefined'`), 'SMD_SWIPE_BACK.syncHandle removed from API');
  ok(await ev(`typeof window.SMD_SWIPE_BACK.goBack === 'function'`), 'SMD_SWIPE_BACK.goBack still present (gesture back intact)');
  ok(await ev(`typeof window.SMD_SWIPE_BACK.hardwareBack === 'function'`), 'SMD_SWIPE_BACK.hardwareBack still present (Android back intact)');

  console.log(failures === 0 ? '\nALL NO-FAB-BACK CHECKS PASSED' : `\n${failures} NO-FAB-BACK CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('Harness error:', e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}
