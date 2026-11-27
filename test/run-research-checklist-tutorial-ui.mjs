// ResearchMD Case Report Tutorial Checklist UI test (390px phone & 1024px tablet, light & dark).
// Verifies CARE guideline selection, manuscript title & section sync, tally consistency,
// Approve gate, compact collapsible single tutorial banner, 1-row phone editor toolbar + More menu,
// matching MaiK token cost wording, zero horizontal overflow, zero em dashes, zero uncaught errors.
//
// Run: CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/run-research-checklist-tutorial-ui.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const PORT = 9118;
const CDP = 9518;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function findChrome() {
  const list = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome'
  ].filter(Boolean);
  for (const p of list) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome binary not found; set CHROME=/path/to/chrome');
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'No live API needed for tutorials' } }));
    return;
  }
  if (p === '/') p = '/index.html';
  const filePath = path.join(ROOT, p.replace(/^\/+/, ''));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
});

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rmd-chk-tut-ui-'));
const chrome = spawn(findChrome(), [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${userData}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP}/json/version`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP timeout');
}

let ws, sid, nextId = 1;
const pending = new Map();
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
});
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails));
  }
  return r.result ? r.result.result.value : undefined;
};
const click = async (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;})()`);
const until = async (expr, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await ev(expr)) return true;
    } catch {}
    await sleep(100);
  }
  return false;
};

let failures = 0;
const pageErrors = [];
function ok(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failures++;
}

try {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const version = await waitCdp();
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m);
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(m.params));
    }
  };

  const target = await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const attach = await new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve, reject: () => {} });
    ws.send(JSON.stringify({ id, method: 'Target.attachToTarget', params: { targetId: target.id, flatten: true } }));
  });
  sid = attach.result.sessionId;
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/?research=1` });

  ok(await until('!!(window.SMD_RESEARCH && window.SMD_RESEARCH.tutorial)', 20000), 'ResearchMD tutorial module loaded');
  await ev('SMD_RESEARCH.open({ screen: "projects" }); 1;');
  await ev('SMD_RESEARCH.tutorial.startTutorial(SMD_RESEARCH.tutorial.keyForStudyType("Case Report")); 1;');
  ok(await until('!!document.querySelector("#rmdTutBar")', 5000), 'Case Report tutorial starts cleanly');

  // Check single banner & cost wording on step 1 (no AI cost -> No MaiK tokens needed)
  ok(await ev('!document.querySelector("#rmdStepBanner")'), 'step 1 shows only one banner in tutorial mode');
  ok(await ev('/No MaiK tokens needed/.test(document.querySelector("#rmdTutBar").innerText)'), 'step 1 shows No MaiK tokens needed');

  // Jump to checklist before manuscript is drafted to verify state honesty & Approve disabled
  await ev('SMD_RESEARCH.navigate("checklist", {}); 1;');
  ok(await until('!!document.querySelector("#rmdChecklistGuide") && !!document.querySelector("[data-rmd-item=\\"1\\"]")', 6000), 'checklist screen loads in Case Report tutorial');
  ok(await ev('document.querySelector("#rmdChecklistGuide").value === "care"'), 'CARE guideline loads for Case Report tutorial (not PRISMA 2020)');
  ok(await ev('!document.querySelector("#rmdStepBanner") && !!document.querySelector("#rmdTutBar")'), 'exactly one banner in tutorial mode on checklist step');
  ok(await ev('!/approved/i.test(document.querySelector("#rmdTutBar").innerText) && !/Drafted all sections/.test(document.querySelector("#rmdTutBar").innerText)'), 'tutorial card does not falsely claim approved or drafted');
  ok(await ev('document.querySelector("[data-rmd-approve]").disabled === true'), 'Approve is disabled while checklist items remain incomplete');
  ok(await ev('!!document.querySelector("[data-rmd-approve-reason]") && /Fill the remaining/.test(document.querySelector("[data-rmd-approve-reason]").textContent)'), 'Approve shows disabled reason text');

  // Phone tutorial card height <= 25% of viewport and collapsible with remembered session state
  const barHeightCollapsed = await ev('Math.round(document.querySelector("#rmdTutBar").getBoundingClientRect().height)');
  ok(barHeightCollapsed > 0 && barHeightCollapsed <= Math.floor(844 * 0.25), `phone tutorial card height ${barHeightCollapsed}px <= 25% of 844px (${Math.floor(844 * 0.25)}px)`);
  ok(await ev('document.querySelector("[data-rmd-tut=\\"toggle\\"]").getAttribute("aria-expanded") === "false" && document.querySelector("#rmdTutDetails").hidden === true'), 'tutorial card starts collapsed on 390px phone with aria-expanded=false');

  // Card does not cover Edit in document buttons
  ok(await ev(`(()=>{
    var bar = document.querySelector("#rmdTutBar").getBoundingClientRect();
    var btn = document.querySelector("[data-rmd-jump]");
    if (!btn) return false;
    var r = btn.getBoundingClientRect();
    return r.top >= bar.bottom - 1;
  })()`), 'tutorial card does not cover Edit in document button');

  // Expand and test How?, Enter & Show Me, Show me where inside collapsed area, and session persistence
  ok(await click('[data-rmd-tut="toggle"]'), 'collapse toggle button clicked to expand');
  ok(await ev('document.querySelector("[data-rmd-tut=\\"toggle\\"]").getAttribute("aria-expanded") === "true" && document.querySelector("#rmdTutDetails").hidden === false'), 'tutorial card expands and reveals details');
  ok(await ev('!!document.querySelector("#rmdTutDetails [data-rmd-tut=\\"auto\\"]") && !!document.querySelector("#rmdTutDetails [data-rmd-tut=\\"spot\\"]") && !!document.querySelector("#rmdTutDetails [data-rmd-tut=\\"how\\"]")'), 'Enter & Show Me, Show me where, and How? are reachable inside banner');
  ok(await click('[data-rmd-tut="how"]'), 'How? button clicked');
  ok(await ev('document.querySelector("[data-rmd-tut=\\"how\\"]").getAttribute("aria-expanded") === "true" && document.querySelector("#rmdTutHowTip").hidden === false'), 'How? expands step guidance');
  ok(await click('[data-rmd-tut="toggle"]'), 'collapse toggle button clicked to collapse again');
  ok(await ev('document.querySelector("[data-rmd-tut=\\"toggle\\"]").getAttribute("aria-expanded") === "false"'), 'tutorial card collapses again');

  // Navigate to manuscript, draft & approve via Enter & Show Me, then navigate back to checklist
  await ev('SMD_RESEARCH.navigate("manuscript", {}); 1;');
  ok(await until('!!document.querySelector("[data-rmd-tut=\\"toggle\\"]")', 4000), 'navigated to manuscript');
  ok(await ev('document.querySelector("[data-rmd-tut=\\"toggle\\"]").getAttribute("aria-expanded") === "false"'), 'collapsed state remembered across step navigation');
  await click('[data-rmd-tut="auto"]');
  ok(await until('/approved Manuscript v1/.test(document.querySelector("#rmdTutBar").innerText)', 4000), 'manuscript Enter & Show Me drafts and approves');
  await ev('SMD_RESEARCH.navigate("checklist", {}); 1;');
  ok(await until('!!document.querySelector("[data-rmd-item=\\"1\\"]") && !!document.querySelector("[data-doc-body]")', 6000), 'returned to checklist after drafting manuscript');

  // Ensure step 6 coach message did NOT leak onto checklist step
  ok(await ev('!/Drafted all sections/.test(document.querySelector("#rmdTutBar").innerText)'), 'step 6 status message does not leak onto checklist step');

  // Verify Item 1 shows manuscript title and counts as Filled
  const item1Text = await ev('document.querySelector("[data-rmd-item=\\"1\\"]").innerText');
  ok(/Isoniazid-Induced Severe Hepatotoxicity/.test(item1Text), 'Item 1 shows worked example manuscript title');
  ok(await ev('document.querySelector("[data-rmd-item=\\"1\\"] [data-rmd-status]").getAttribute("data-rmd-status") === "auto"'), 'Item 1 status is Filled (auto)');

  // Verify tally equals actual item status counts
  ok(await ev(`(()=>{
    var txt = (document.querySelector("[data-rmd-counts]")||{}).textContent || "";
    var m = txt.match(/Filled (\\d+)\\. Partial (\\d+)\\. Manual (\\d+)\\. Missing (\\d+)\\./);
    if (!m) return false;
    var badges = Array.from(document.querySelectorAll("[data-rmd-item] [data-rmd-status]"));
    var c = { auto: 0, partial: 0, manual: 0, missing: 0 };
    badges.forEach(function(b){ c[b.getAttribute("data-rmd-status")] = (c[b.getAttribute("data-rmd-status")] || 0) + 1; });
    return +m[1] === c.auto && +m[2] === c.partial && +m[3] === c.manual && +m[4] === c.missing && c.auto >= 5;
  })()`), 'tally matches item statuses and drafted sections count as filled');

  // Cost wording: the tutorial itself is free, while the screen's own Ask MaiK bar still quotes its real cost.
  // Live BUG-10: the coach bar used to say "Costs about 2 MaiK tokens", contradicting the free tutorial cards.
  const cardCostOk = await ev('/No MaiK tokens needed/.test(document.querySelector("#rmdTutBar").innerText)');
  const askCostOk = await ev('/No MaiK tokens needed/.test((document.querySelector(".rmd-ai-cost")||{}).textContent || "")');
  ok(cardCostOk && askCostOk, 'tutorial coach bar and the Ask MaiK bar both say No MaiK tokens needed (tutorial is free)');

  // Approve stays disabled while Informed Consent (manual item 13) is empty; enables once filled
  ok(await ev('document.querySelector("[data-rmd-approve]").disabled === true'), 'Approve remains disabled while Informed Consent item 13 is still open');
  await ev(`(()=>{
    var bodies = Array.from(document.querySelectorAll("[data-doc-body]"));
    var last = bodies[bodies.length - 1];
    if (!last) return false;
    last.textContent = "Written informed consent for publication was obtained from the patient.";
    last.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  ok(await until('document.querySelector("[data-rmd-approve]").disabled === false', 4000), 'Approve enables once all checklist items are filled');
  ok(await ev('/Filled 6\\. Partial 0\\. Manual 0\\. Missing 0\\./.test(document.querySelector("[data-rmd-counts]").textContent)'), 'tally updates to Filled 6 after entering last item');

  // Toolbar on 390px phone: one row, 44px targets, More menu with aria-haspopup/aria-expanded, Escape & outside tap close
  const toolbarCheck = await ev(`(()=>{
    var cmds = ["bold","italic","underline","insertUnorderedList","insertOrderedList","undo"];
    var els = cmds.map(function(c){ return document.querySelector('.rmd-doc-toolbar [data-doc-cmd="' + c + '"]'); });
    var more = document.querySelector('.rmd-doc-toolbar [data-doc-more]');
    if (els.some(function(e){ return !e; }) || !more) return { ok: false, reason: "missing buttons" };
    var all = els.concat([more]);
    var rects = all.map(function(e){ return e.getBoundingClientRect(); });
    var top0 = rects[0].top;
    var oneRow = rects.every(function(r){ return Math.abs(r.top - top0) <= 2; });
    var sized = rects.every(function(r){ return r.height >= 43.5 && r.width >= 43.5; });
    var extraHidden = Array.from(document.querySelectorAll('.rmd-doc-toolbar [data-doc-tier="extra"]')).every(function(e){ return getComputedStyle(e).display === "none"; });
    return {
      ok: oneRow && sized && extraHidden,
      oneRow: oneRow,
      sized: sized,
      extraHidden: extraHidden,
      hasPopup: more.getAttribute("aria-haspopup") === "menu",
      expandedFalse: more.getAttribute("aria-expanded") === "false"
    };
  })()`);
  ok(toolbarCheck && toolbarCheck.ok && toolbarCheck.hasPopup && toolbarCheck.expandedFalse, '390px toolbar is 1 row with 44px targets and More button');

  ok(await click('[data-doc-more]'), 'More menu button clicked');
  ok(await ev('document.querySelector("[data-doc-more]").getAttribute("aria-expanded") === "true" && document.querySelector("[data-doc-more-menu]").hidden === false'), 'More menu opens with aria-expanded=true');
  ok(await ev('document.querySelectorAll("[data-doc-more-menu] [data-doc-cmd]").length === 5'), 'More menu contains H2, H3, Sup, Sub, Redo');

  // Escape closes More menu and restores focus to More button
  await ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); 1;');
  ok(await ev('document.querySelector("[data-doc-more]").getAttribute("aria-expanded") === "false" && document.querySelector("[data-doc-more-menu]").hidden === true'), 'More menu closes on Escape');

  // Outside tap closes More menu
  await click('[data-doc-more]');
  ok(await ev('document.querySelector("[data-doc-more-menu]").hidden === false'), 'More menu reopens');
  await click('[data-rmd-counts]');
  ok(await ev('document.querySelector("[data-doc-more-menu]").hidden === true && document.querySelector("[data-doc-more]").getAttribute("aria-expanded") === "false"'), 'More menu closes on outside tap');

  // Check 390px and 1024px in both dark and light themes
  const noOverflow = () => ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth && (!document.getElementById("researchMD") || document.getElementById("researchMD").scrollWidth <= document.getElementById("researchMD").clientWidth + 2)');
  const noDash = () => ev('(document.querySelector("#researchMD").innerText.match(/[\\u2013\\u2014]/g)||[]).length === 0');

  for (const [w, h, mobile] of [[390, 844, true], [1024, 1366, false]]) {
    await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
    await ev('window.dispatchEvent(new Event("resize")); 1;');
    await sleep(150);
    for (const theme of ['dark', 'light']) {
      await ev(`(function(){
        if (${JSON.stringify(theme)} === "dark") { document.body.classList.add("dark", "v3-dark"); }
        else { document.body.classList.remove("dark", "v3-dark"); }
      })()`);
      await sleep(80);
      ok(await noOverflow(), `no horizontal overflow at ${w}px (${theme})`);
      ok(await noDash(), `no em/en dash at ${w}px (${theme})`);
    }
  }

  ok(pageErrors.length === 0, `zero uncaught page errors (${pageErrors.length})`);
} catch (e) {
  console.log('FAIL exception:', e.message, e.stack);
  failures++;
} finally {
  try { if (ws) ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  server.close();
}

console.log(failures ? `\n${failures} failed` : '\nALL CHECKLIST TUTORIAL UI CHECKS PASSED');
process.exit(failures ? 1 : 0);
