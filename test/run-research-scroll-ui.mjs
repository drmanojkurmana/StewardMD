// Touch-scroll + nested scroll-trap harness for ResearchMD on phone (390x844).
// Tests real touch swipes (Emulation.setTouchEmulationEnabled + Input.dispatchTouchEvent)
// across Manuscript (Sections / Read section / Approve tabs), Checklist, Thesis Draft,
// Master Chart, Run Meta-Analysis, and Search.
// Must fail when scroll traps exist and pass when #rmdScreenBody is the single scroll container.
//   node test/run-research-scroll-ui.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, readFile } from "node:fs";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const CHROME = process.env.CHROME || [
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find((p) => existsSync(p));

if (!CHROME) {
  console.log("FAIL Chrome not found");
  process.exit(1);
}

const PORT = 9134;
const CDP = 9534;
const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon"
};

const LONG_PARA = "Patients receiving SGLT2 inhibitors after sepsis resuscitation demonstrated lower incidence of acute kidney injury progression over 28 days across five multicenter cohorts totaling 4,820 participants. Heterogeneity remained moderate (I-squared = 38%) and sensitivity analyses excluding high-risk-of-bias studies preserved direction and magnitude of effect. Renal replacement therapy initiation occurred less frequently in the intervention arm (OR 0.72, 95% CI 0.56 to 0.93). ";
const LONG_TEXT = LONG_PARA.repeat(4);

const MOCK_MANUSCRIPT = {
  id: "man_scroll_1",
  projectId: "prj_scroll_sr",
  version: 1,
  title: "Effect of SGLT2 Inhibitors on Sepsis-Associated Acute Kidney Injury: A Systematic Review and Meta-Analysis",
  authors: ["A. Clinician", "B. Researcher"],
  affiliations: "Department of Critical Care Medicine",
  status: "draft",
  sections: [
    { id: "abstract", heading: "Abstract", level: 1, text: LONG_TEXT, citations: [], wordCount: 280 },
    { id: "introduction", heading: "Introduction", level: 1, text: LONG_TEXT, citations: [], wordCount: 280 },
    { id: "methods", heading: "Methods", level: 1, text: LONG_TEXT, citations: [], wordCount: 280 },
    { id: "results", heading: "Results", level: 1, text: LONG_TEXT, citations: [], wordCount: 280 },
    { id: "discussion", heading: "Discussion", level: 1, text: LONG_TEXT, citations: [], wordCount: 280 },
    { id: "limitations", heading: "Limitations", level: 2, text: LONG_TEXT, citations: [], wordCount: 280 },
    { id: "conclusion", heading: "Conclusions", level: 1, text: LONG_TEXT, citations: [], wordCount: 280 },
    { id: "references", heading: "References", level: 1, text: "1. Gupta R et al. Crit Care Med. 2024.\n2. Nair S et al. Intensive Care Med. 2024.\n3. Rao K et al. Nephrol Dial Transplant. 2025.", citations: [], wordCount: 40 }
  ],
  tokens: {},
  aiMeta: { draftedByAi: true, source: "maik" },
  references: [],
  approval: null,
  lock: null
};

const SEARCH_RESULTS = Array.from({ length: 12 }, (_, i) => ({
  id: "pmid_" + (39000001 + i),
  pmid: String(39000001 + i),
  title: "Cohort Study " + (i + 1) + ": Renal Outcomes with Empagliflozin and Dapagliflozin in Sepsis ICU Admissions",
  authors: ["Sharma P", "Verma R", "Menon A"],
  journal: "Critical Care Medicine",
  year: 2024 - (i % 3),
  abstract: LONG_PARA
}));

const PRISMA_SECTIONS = [
  {
    title: "Title & Abstract",
    items: Array.from({ length: 3 }, (_, i) => ({
      num: String(i + 1),
      topic: "Title Item " + (i + 1),
      text: LONG_PARA,
      projectField: "manuscript"
    }))
  },
  {
    title: "Methods",
    items: Array.from({ length: 3 }, (_, i) => ({
      num: String(i + 4),
      topic: "Methods Item " + (i + 4),
      text: LONG_PARA,
      projectField: "search"
    }))
  },
  {
    title: "Results",
    items: Array.from({ length: 2 }, (_, i) => ({
      num: String(i + 7),
      topic: "Results Item " + (i + 7),
      text: LONG_PARA,
      projectField: "prisma"
    }))
  }
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + PORT);
  const p = decodeURIComponent(url.pathname);
  const send = (status, obj) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  if (p.startsWith("/api/")) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (p === "/api/research/v1/projects" && req.method === "GET") {
        return send(200, { projects: [] });
      }
      if (/\/manuscript$/.test(p) && req.method === "GET") {
        return send(200, { manuscript: MOCK_MANUSCRIPT });
      }
      if (/\/manuscript\/versions$/.test(p)) {
        return send(200, { versions: [{ id: "man_scroll_1", version: 1, title: MOCK_MANUSCRIPT.title, status: "draft", sectionCount: 8, referenceCount: 0 }] });
      }
      if (/\/manuscript\/diff/.test(p)) {
        return send(200, { changes: [] });
      }
      if (/\/find-studies$/.test(p) && req.method === "POST") {
        return send(200, { results: SEARCH_RESULTS });
      }
      if (/\/checklists$/.test(p)) {
        return send(200, { guidelines: [{ id: "prisma2020", name: "PRISMA 2020" }] });
      }
      if (/\/checklists\//.test(p)) {
        return send(200, { checklist: { id: "prisma2020", name: "PRISMA 2020", sections: PRISMA_SECTIONS } });
      }
      if (/\/checklist-snapshot$/.test(p)) return send(200, { snapshot: {} });
      if (/\/checklist-manual\//.test(p)) return send(200, { entries: {} });
      if (/\/journals\/match/.test(p)) return send(200, { journals: [] });
      return send(200, { ok: true, runs: [], protocols: [], studies: [], artifacts: [] });
    });
    return;
  }
  const rel = normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, "");
  const fp = join(repo, rel);
  readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("404");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(fp)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const chrome = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  "--remote-debugging-port=" + CDP,
  "--user-data-dir=/tmp/rmd-scroll-chrome-" + process.pid,
  "--no-first-run",
  "--disable-gpu"
], { stdio: "ignore" });

let ws;
let sid;
let id = 0;
let failures = 0;
const pending = new Map();
const pageErrors = [];

const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
});

const ev = async (expression) => {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
};

const ok = (pass, label) => {
  console.log((pass ? "PASS" : "FAIL") + " " + label);
  if (!pass) failures += 1;
};

const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) {
    try {
      if (await ev(expr)) return true;
    } catch {
      /* wait */
    }
    await sleep(100);
  }
  return false;
};

async function touchSwipe(startX, startY, endX, endY, steps = 10) {
  await call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY, radiusX: 12, radiusY: 12, force: 1, id: 1 }]
  });
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(startX + ((endX - startX) * i) / steps);
    const y = Math.round(startY + ((endY - startY) * i) / steps);
    await call("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }]
    });
    await sleep(16);
  }
  await call("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: []
  });
  await sleep(220);
}

async function assertScreenScrollsCleanly(name) {
  // Ensure clean top start
  await ev("(()=>{var sb=document.getElementById('rmdScreenBody'); if(sb) sb.scrollTop=0; return 1;})()");
  await sleep(120);

  const info = await ev(`(() => {
    var sb = document.getElementById('rmdScreenBody');
    if (!sb) return { error: 'no #rmdScreenBody' };
    var nested = [];
    var touchNone = [];
    var badOverscroll = [];
    var all = sb.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
        nested.push((el.tagName || '') + '.' + String(el.className || '').trim().split(/\\s+/).join('.') + '(h:' + el.clientHeight + ',sh:' + el.scrollHeight + ')');
      }
      if (cs.touchAction === 'none' && !el.classList.contains('rmd-img-canvas') && el.getBoundingClientRect().height > 120) {
        touchNone.push((el.tagName || '') + '.' + String(el.className || ''));
      }
      if (cs.overscrollBehavior === 'contain' && el.scrollHeight <= el.clientHeight + 4) {
        badOverscroll.push((el.tagName || '') + '.' + String(el.className || ''));
      }
    }
    var sbRect = sb.getBoundingClientRect();
    return {
      sbTop: Math.round(sbRect.top),
      sbBottom: Math.round(sbRect.bottom),
      sbHeight: sb.clientHeight,
      sbScrollHeight: sb.scrollHeight,
      nested: nested,
      touchNone: touchNone,
      badOverscroll: badOverscroll
    };
  })()`);

  if (info.error) {
    ok(false, name + ": " + info.error);
    return;
  }

  ok(info.nested.length === 0, name + ": zero nested vertical scroll containers (found: " + JSON.stringify(info.nested) + ")");
  ok(info.touchNone.length === 0, name + ": zero touch-action:none scroll blockers (found: " + JSON.stringify(info.touchNone) + ")");
  ok(info.badOverscroll.length === 0, name + ": zero overscroll-behavior:contain on non-scrolling nodes (found: " + JSON.stringify(info.badOverscroll) + ")");
  if (info.sbScrollHeight <= info.sbHeight + 40) {
    console.log("DIAG " + name + " text=" + JSON.stringify((await ev("(document.getElementById('rmdScreenBody').innerText||'').slice(0,220)"))));
  }
  ok(info.sbScrollHeight > info.sbHeight + 40, name + ": page content overflows #rmdScreenBody (" + info.sbScrollHeight + " > " + info.sbHeight + ")");

  // Swipe finger UP inside #rmdScreenBody to scroll DOWN to bottom
  const startY = Math.min(info.sbBottom - 60, Math.max(info.sbTop + 260, 680));
  const endY = Math.max(info.sbTop + 40, 180);
  let prev = -1;
  for (let attempt = 0; attempt < 25; attempt++) {
    await touchSwipe(195, startY, 195, endY, 10);
    const stNow = await ev("(() => { var sb=document.getElementById('rmdScreenBody'); return { st: sb.scrollTop, max: Math.max(0, sb.scrollHeight - sb.clientHeight) }; })()");
    if (stNow.st >= stNow.max - 20 || stNow.st === prev) break;
    prev = stNow.st;
  }

  const atBottom = await ev("(() => { var sb=document.getElementById('rmdScreenBody'); return { st: Math.round(sb.scrollTop), ch: sb.clientHeight, sh: sb.scrollHeight }; })()");
  ok(atBottom.st > 60 && atBottom.st + atBottom.ch >= atBottom.sh - 24, name + ": touch-scroll down reaches bottom (st=" + atBottom.st + ", ch=" + atBottom.ch + ", sh=" + atBottom.sh + ")");

  // Swipe finger DOWN to scroll UP back to top (scrollTop === 0)
  prev = -1;
  for (let attempt = 0; attempt < 25; attempt++) {
    await touchSwipe(195, endY + 40, 195, startY, 10);
    const cur = await ev("document.getElementById('rmdScreenBody').scrollTop");
    if (cur <= 0 || cur === prev) break;
    prev = cur;
  }

  const backTop = await ev(`(() => {
    var sb = document.getElementById('rmdScreenBody');
    var hdr = document.querySelector('#rmdStepBanner') || document.querySelector('#rmdScreenBody .rmd-man-topbar') || document.querySelector('#rmdScreenBody .rmd-step-banner') || document.querySelector('#rmdScreenBody h2');
    var hr = hdr ? hdr.getBoundingClientRect() : null;
    return {
      scrollTop: Math.round(sb.scrollTop),
      bodyOverflow: document.body.style.overflow || '',
      hdrOk: !!(hr && hr.height > 0 && hr.top >= -1 && hr.bottom <= 844)
    };
  })()`);

  ok(backTop.scrollTop === 0, name + ": touch-scroll up returns to scrollTop === 0 (got " + backTop.scrollTop + ")");
  ok(backTop.hdrOk, name + ": step banner / top header visible again at top");
  ok(backTop.bodyOverflow !== "hidden", name + ": no leftover body overflow lock");
}

try {
  let version;
  for (let i = 0; i < 80; i++) {
    try {
      version = await (await fetch("http://127.0.0.1:" + CDP + "/json/version")).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw Error("Chrome debugger did not start");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") pageErrors.push(JSON.stringify(m.params).slice(0, 400));
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    hasTouch: true
  });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  await call("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/?research=1" });
  ok(await until("!!window.SMD_RESEARCH && !!window.SMD_RESEARCH.screens && !!window.SMD_RESEARCH.screens.manuscript", 45000), "app loaded at 390x844");

  // Dismiss splash if present & create a systematic review project with studies + thesis draft seed
  await ev(`(() => {
    var b = document.getElementById('smdBootSplash');
    if (b) b.style.display = 'none';
    var store = SMD_RESEARCH.store;
    var p = store.createProject({
      title: 'SGLT2 Inhibitors in Sepsis-Associated Acute Kidney Injury: Systematic Review and Meta-Analysis',
      discipline: 'medicine',
      specialty: 'Critical Care',
      studyType: 'systematic_review',
      researchQuestion: 'Do SGLT2 inhibitors reduce AKI progression in adult sepsis?'
    });
    p.serverId = 'prj_scroll_sr';
    store.updateProject && store.updateProject(p.id, { serverId: 'prj_scroll_sr' });
    for (var i = 1; i <= 6; i++) {
      store.createStudy(p.id, {
        label: 'Sepsis Renal Cohort ' + i + ' (202' + (i % 5) + ')',
        measure: 'OR',
        verified: true,
        locator: {
          citation: 'Sharma et al. Cohort ' + i + '. Crit Care. 2024',
          page: String(i),
          quote: 'Events in treatment and control arms.'
        },
        inputs: { a: 18 + i, b: 102 - i, c: 28 + i, d: 92 - i }
      });
    }
    store.setActiveProject(p.id);
    window.__SCROLL_PRJ_ID = p.id;
    return p.id;
  })()`);

  // 1. Manuscript (Sections, Read section, Approve)
  await ev("document.body.style.overflow = ''; SMD_RESEARCH.open({ screen: 'manuscript' }); SMD_RESEARCH.navigate('manuscript'); 1");
  ok(await until("!!document.querySelector('.rmd-manuscript-screen .rmd-section-item')", 8000), "manuscript loaded with sections");

  await ev("var b=document.querySelector('[data-rmd-phone-tab=\"sections\"]'); if(b) b.click(); 1");
  await sleep(150);
  await assertScreenScrollsCleanly("manuscript-sections");

  await ev("var b=document.querySelector('[data-rmd-phone-tab=\"read\"]'); if(b) b.click(); 1");
  await sleep(150);
  await assertScreenScrollsCleanly("manuscript-read");

  await ev("var b=document.querySelector('[data-rmd-phone-tab=\"approve\"]'); if(b) b.click(); 1");
  await sleep(150);
  await assertScreenScrollsCleanly("manuscript-approve");

  // 2. Checklist (PRISMA 2020 has 8 items -> tall page)
  await ev("SMD_RESEARCH.navigate('checklist'); 1");
  ok(await until("document.querySelectorAll('.rmd-checklist-screen [data-rmd-item]').length >= 6", 5000), "checklist loaded");
  await sleep(150);
  await assertScreenScrollsCleanly("checklist");

  // 3. Master chart (open observational sample chart -> tall analysis report)
  await ev(`(() => {
    var store = SMD_RESEARCH.store;
    var pObs = store.createProject({
      title: 'ICU Lactate Clearance Cohort Study',
      discipline: 'medicine',
      specialty: 'Critical Care',
      studyType: 'observational'
    });
    store.setActiveProject(pObs.id);
    window.__SCROLL_OBS_ID = pObs.id;
    SMD_RESEARCH.navigate('masterchart');
    return 1;
  })()`);
  ok(await until("!!document.querySelector('.rmd-mc-screen [data-rmd-mc=\"sample\"]')", 5000), "masterchart loaded");
  await ev("var s=document.querySelector('[data-rmd-mc=\"sample\"]'); if(s) s.click(); 1");
  await sleep(150);
  await ev("var c1=document.querySelector('[data-rmd-mc=\"continue-identifiers\"]'); if(c1) c1.click(); 1");
  await sleep(150);
  await ev("var c2=document.querySelector('[data-rmd-mc=\"continue-columns\"]'); if(c2) c2.click(); 1");
  ok(await until("document.querySelector('#rmdScreenBody').scrollHeight > 900", 5000), "masterchart sample analysis rendered");
  await assertScreenScrollsCleanly("masterchart");

  // 4. Run meta-analysis (switch back to systematic review with 6 studies and run pooled analysis)
  await ev("SMD_RESEARCH.store.setActiveProject(window.__SCROLL_PRJ_ID); SMD_RESEARCH.navigate('run'); 1");
  ok(await until("!!document.querySelector('.rmd-run-screen')", 5000), "run screen loaded");
  await ev("var r=document.querySelector('[data-rmd=\"run-analysis\"]'); if(r) r.click(); 1");
  await sleep(400);
  await assertScreenScrollsCleanly("run");

  // 5. Literature Search (trigger search so 12 results fill page)
  await ev("SMD_RESEARCH.navigate('search'); 1");
  ok(await until("!!document.querySelector('.rmd-p2-screen')", 5000), "search screen loaded");
  await ev(`(() => {
    var inp = document.querySelector('#rmdTopicInput') || document.querySelector('.rmd-p2-screen input[type="search"], .rmd-p2-screen input[type="text"]');
    if (inp) { inp.value = 'SGLT2 sepsis AKI'; }
    var btn = document.querySelector('[data-rmd="topic-search"], .rmd-p2-screen .rmd-btn-primary');
    if (btn) btn.click();
    return 1;
  })()`);
  await sleep(400);
  await assertScreenScrollsCleanly("search");

  // 6. Thesis draft screen with pre-populated long thesis extraction & draft
  await ev(`(() => {
    var store = SMD_RESEARCH.store;
    var pTh = store.createProject({
      title: 'Predictors of Ventilator-Associated Pneumonia in Surgical ICU',
      discipline: 'medicine',
      specialty: 'Surgery',
      studyType: 'thesis'
    });
    pTh.serverId = 'prj_scroll_th';
    var thData = {};
    var draftPayload = {
      paperType: 'obs',
      journal: { id: 'ijccm', name: 'Indian Journal of Critical Care Medicine (IJCCM)', wordLimit: 3000, abstractWordLimit: 350, referenceStyle: 'vancouver' },
      pages: [{ page: 1, text: ${JSON.stringify(LONG_TEXT)} }, { page: 2, text: ${JSON.stringify(LONG_TEXT)} }],
      extractedText: ${JSON.stringify(LONG_TEXT)},
      draft: {
        sections: [
          { id: 'abstract', heading: 'Abstract', text: ${JSON.stringify(LONG_TEXT)} },
          { id: 'introduction', heading: 'Introduction', text: ${JSON.stringify(LONG_TEXT)} },
          { id: 'methods', heading: 'Methods', text: ${JSON.stringify(LONG_TEXT)} },
          { id: 'results', heading: 'Results', text: ${JSON.stringify(LONG_TEXT)} },
          { id: 'discussion', heading: 'Discussion', text: ${JSON.stringify(LONG_TEXT)} }
        ],
        flags: [],
        locators: [],
        tables: [],
        references: [],
        words: 1400
      }
    };
    thData[pTh.id] = draftPayload;
    thData['prj_scroll_th'] = draftPayload;
    localStorage.setItem('smd_rmd_thesis_v1', JSON.stringify(thData));
    store.setActiveProject(pTh.id);
    SMD_RESEARCH.navigate('thesis-draft');
    return 1;
  })()`);
  ok(await until("!!document.querySelector('#rmdScreenBody .rmd-card')", 5000), "thesis-draft screen loaded");
  await sleep(250);
  await assertScreenScrollsCleanly("thesis-draft");

  // 7. Case Report modal open + Escape close leaves no body scroll lock and manuscript still touch-scrolls
  await ev(`(() => {
    var store = SMD_RESEARCH.store;
    var pCr = store.createProject({
      title: 'Rare Complication Case Report',
      discipline: 'medicine',
      specialty: 'Surgery',
      studyType: 'Case Report'
    });
    pCr.serverId = 'prj_scroll_cr';
    store.setActiveProject(pCr.id);
    SMD_RESEARCH.navigate('manuscript');
    return 1;
  })()`);
  ok(await until("!!document.querySelector('[data-rmd=\"ask-maik-case-report\"], [data-rmd=\"manuscript-redraft\"]')", 5000), "case report manuscript rendered");
  await ev("var rd=document.querySelector('[data-rmd=\"manuscript-redraft\"]'); if(rd) rd.click(); 1");
  ok(await until("!!document.querySelector('[data-rmd=\"ask-maik-case-report\"]')", 3000), "case report Ask MaiK button rendered");
  await ev("document.querySelector('[data-rmd=\"ask-maik-case-report\"]').click(); 1");
  ok(await until("!!document.querySelector('#rmdCaseReportDraftModal')", 3000), "case report modal opens");
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); 1");
  ok(await until("!document.querySelector('#rmdCaseReportDraftModal')", 3000), "Escape closes case report modal cleanly");
  ok(await ev("(document.body.style.overflow || '') !== 'hidden'"), "closing modal leaves no body overflow lock");

  ok(pageErrors.length === 0, "zero uncaught page errors (" + pageErrors.length + ")");
  if (pageErrors.length) console.log(pageErrors.join("\n"));

  console.log(failures === 0 ? "ALL SCROLL UI CHECKS PASSED" : failures + " SCROLL UI CHECK(S) FAILED");
} catch (e) {
  console.log("FAIL exception: " + (e && e.message ? e.message : e));
  failures += 1;
} finally {
  try { if (ws) ws.close(); } catch { /* ignore */ }
  try { chrome.kill("SIGTERM"); } catch { /* ignore */ }
  await new Promise((resolve) => server.close(resolve));
}

process.exit(failures === 0 ? 0 : 1);
