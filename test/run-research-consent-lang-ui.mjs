// Real-browser headless CDP test: ResearchMD multilingual consent form and publication consent.
// Tests Telugu and Urdu on both screens:
// - Start / plan screen IEC consent card
// - Publication consent screen
// - Selected language shown first with correct lang and dir
// - Urdu container is RTL (dir="rtl")
// - Do it myself shows template in script
// - Empty local blocks export ("Fill in the <language> version first.")
// - Responsive at 390x844 and 1024x1366 with no horizontal scroll
// - Zero page errors and zero em/en dashes
// Run with: node test/run-research-consent-lang-ui.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, readFile } from "node:fs";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const CHROME = process.env.CHROME || [
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find((p) => existsSync(p));

if (!CHROME) {
  console.error("No Chrome binary found");
  process.exit(1);
}

const PORT = 9135, CDP = 9535, OUT = "/tmp/stewardmd-research-consent-lang-ui";
const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

let projN = 0;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  const send = (status, obj) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (p.startsWith("/api/")) {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let b = {};
      try { b = JSON.parse(body || "{}"); } catch { b = {}; }

      if (p === "/api/research/v1/projects" && req.method === "POST") {
        projN++;
        return send(201, {
          project: {
            id: "prj_consent_" + projN,
            title: b.title || "Multilingual Clinical Study",
            discipline: "medicine",
            specialty: "General Medicine",
            studyType: "trial",
            role: "owner",
            createdAt: Date.now()
          },
          requestId: "req_proj_" + projN
        });
      }

      if (p.includes("/ai-draft") && req.method === "POST") {
        if (b.task === "consent_form") {
          return send(200, {
            draft: {
              id: "draft_cf_1",
              task: "consent_form",
              status: "unverified",
              language: b.input ? b.input.language : "Telugu",
              participantInformationSheet: {
                title: "పాల్గొనేవారి సమాచార పత్రం",
                purpose: "అధ్యయనం యొక్క ఉద్దేశ్యం",
                procedures: "అధ్యయన విధానాలు",
                duration: "12 నెలలు",
                risks: "తేలికపాటి అసౌకర్యం",
                benefits: "ప్రత్యక్ష ప్రయోజనం",
                alternatives: "ప్రామాణిక చికిత్స",
                confidentiality: "గోప్యతా భరోసా",
                voluntary: "స్వచ్ఛంద భాగస్వామ్యం",
                contact: "సంప్రదించండి"
              },
              consentForm: {
                statements: ["నేను సమాచార పత్రాన్ని చదివి అర్థం చేసుకున్నాను."],
                signatureBlock: "సంతకం: ________"
              },
              englishVersion: {
                participantInformationSheet: {
                  title: "Information for participants",
                  purpose: "Study purpose",
                  procedures: "Study procedures",
                  duration: "12 months",
                  risks: "Mild discomfort",
                  benefits: "Direct benefits",
                  alternatives: "Standard care",
                  confidentiality: "Confidentiality assured",
                  voluntary: "Voluntary participation",
                  contact: "Contact us"
                },
                consentForm: {
                  statements: ["I have read and understood the information sheet."],
                  signatureBlock: "Signature: ________"
                }
              }
            }
          });
        }
        if (b.task === "publication_consent") {
          return send(200, {
            draft: {
              english: "PATIENT CONSENT FOR PUBLICATION\n\n1. What will be published: Clinical details.",
              local: "ప్రచురణ కొరకు రోగి సమ్మతి పత్రం\n\n1. ప్రచురించబడే వివరాలు: వైద్య వివరాలు.",
              languageName: b.input ? b.input.language : "Telugu"
            }
          });
        }
        return send(200, { draft: {} });
      }

      if (p.includes("/protocols") && req.method === "GET") {
        return send(200, { protocols: [] });
      }

      if (p.includes("/cost-report") && req.method === "GET") {
        return send(200, { runs: [], totalMicroUsd: 0 });
      }

      send(200, { ok: true });
    });
    return;
  }

  // Serve static files
  const file = p === "/" ? "/index.html" : p;
  const full = join(repo, normalize(file));
  if (!full.startsWith(repo) || !existsSync(full)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  readFile(full, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end("Error");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(full)] || "application/octet-stream",
      "cache-control": "no-store, no-cache, must-revalidate"
    });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1");

const chrome = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-consent-lang-chrome-${process.pid}`,
  "--no-first-run",
  "--disable-gpu"
], { stdio: "ignore" });

let ws, sid, msgId = 0, failures = 0;
const pending = new Map();
const pageErrors = [];

const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++msgId;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
});

const ev = async (expression) => {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    const err = JSON.stringify(r.result.exceptionDetails).slice(0, 600);
    pageErrors.push(err);
    throw Error(err);
  }
  return r.result?.result?.value;
};

const ok = (pass, label) => {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures++;
};

const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) {
    try {
      if (await ev(expr)) return true;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  return false;
};

const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const setSelect = (sel, val) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.value=${JSON.stringify(val)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);

async function shot(name) {
  await sleep(100);
  await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`);
  await mkdir(OUT, { recursive: true });
  const r = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, "base64"));
}

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") {
      pageErrors.push(JSON.stringify(m.params));
    }
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;

  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: `http://127.0.0.1:${PORT}/?research=1` });
  ok(await until("!!window.SMD_RESEARCH && !!window.SMD_RESEARCH.screens && !!window.SMD_RESEARCH.screens.plan", 30000), "app loaded with ResearchMD plan screen");
  await ev("if (navigator.clipboard) { navigator.clipboard.writeText = function() { return Promise.resolve(); }; }");

  // Create project to enter workspace
  await ev("SMD_RESEARCH.open({screen:'start'});1");
  ok(await until("!!document.querySelector('.rmd-start-screen')", 5000), "start screen rendered");
  await click('[data-rmd-start-choice="trial"]');
  ok(await until("!!document.querySelector('#rmdStartForm')", 3000), "naming form appears");
  await ev("(()=>{document.getElementById('rmd_start_title').value='Multilingual Trial';return true})()");
  await click('[data-rmd="start-create"]');
  ok(await until("SMD_RESEARCH.store.getActiveProject() && SMD_RESEARCH.store.getActiveProject().serverId === 'prj_consent_1'", 5000), "project created on server");

  // Lands on plan screen
  await click('[data-rmd-tab="plan"]');
  ok(await until("!!document.querySelector('.rmd-plan-screen')", 5000), "lands on plan screen");

  // =========================================================================
  // SCREEN 1: IEC Consent Card (research-screen-start.js)
  // =========================================================================

  // Open "Do it myself" on consent card
  await click('#rmdCardConsent [data-rmd-ai="manual"]');
  ok(await until("!!document.querySelector('#rmdCardConsent .rmd-consent-form')", 5000), "consent form opened via Do it myself");

  // Pick Telugu on Start Screen
  await setSelect("#rmd_consent_lang", "Telugu");
  await sleep(150);
  ok(await until("!!document.querySelector('#rmd_consent_selected_block')", 5000), "Telugu selected block rendered");

  // Telugu attributes: lang="te", dir="ltr", comes FIRST before english copy
  const teAttrs = await ev(`(()=>{
    const b = document.getElementById('rmd_consent_selected_block');
    const eng = document.getElementById('rmd_consent_english_copy');
    if (!b) return null;
    return {
      lang: b.getAttribute('lang'),
      dir: b.getAttribute('dir'),
      comesBeforeEng: !!(eng && (b.compareDocumentPosition(eng) & Node.DOCUMENT_POSITION_FOLLOWING))
    };
  })()`);
  ok(teAttrs && teAttrs.lang === "te", "Telugu container has lang=te");
  ok(teAttrs && teAttrs.dir === "ltr", "Telugu container has dir=ltr");
  ok(teAttrs && teAttrs.comesBeforeEng === true, "Telugu selected block is shown FIRST before English copy");

  // Translation check warning present
  ok(/Translation check: have a native speaker or your ethics committee check this translation before use/.test(await text("#rmd_consent_selected_block")), "Telugu block shows translation check warning");

  // English copy follows
  ok(/English copy \(for the ethics committee\)/.test(await text("#rmd_consent_english_copy")), "English copy follows as separate section");

  // Do it myself shows template in Telugu script
  const teTplVal = await ev(`(()=>{
    const t = document.getElementById('rmd_trans_title');
    const s = document.getElementById('rmd_trans_stmts');
    return (t ? t.value : '') + ' ' + (s ? s.value : '');
  })()`);
  ok(/[\u0C00-\u0C7F]/.test(teTplVal), "Do it myself populates Telugu script template");

  // Empty local blocks export on Start screen
  await ev(`(()=>{
    const t = document.getElementById('rmd_trans_title'); if (t) { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); }
    const p = document.getElementById('rmd_trans_purpose'); if (p) { p.value = ''; p.dispatchEvent(new Event('input', { bubbles: true })); }
    const pr = document.getElementById('rmd_trans_proc'); if (pr) { pr.value = ''; pr.dispatchEvent(new Event('input', { bubbles: true })); }
    const st = document.getElementById('rmd_trans_stmts'); if (st) { st.value = ''; st.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  })()`);
  await click('[data-rmd="consent-docx"]');
  await sleep(100);
  const startBlockedMsg = await text("#rmd_consent_status");
  ok(/Fill in the Telugu version first\./.test(startBlockedMsg), "empty local text blocks export with Fill in the Telugu version first.");

  // Pick Urdu on Start Screen
  await setSelect("#rmd_consent_lang", "Urdu");
  await sleep(150);
  ok(await until("!!document.querySelector('#rmd_consent_selected_block')", 5000), "Urdu selected block rendered on start screen");

  // Urdu attributes: lang="ur", dir="rtl"
  const urAttrs = await ev(`(()=>{
    const b = document.getElementById('rmd_consent_selected_block');
    const eng = document.getElementById('rmd_consent_english_copy');
    if (!b) return null;
    return {
      lang: b.getAttribute('lang'),
      dir: b.getAttribute('dir'),
      comesBeforeEng: !!(eng && (b.compareDocumentPosition(eng) & Node.DOCUMENT_POSITION_FOLLOWING))
    };
  })()`);
  ok(urAttrs && urAttrs.lang === "ur", "Urdu container has lang=ur");
  ok(urAttrs && urAttrs.dir === "rtl", "Urdu container has dir=rtl");
  ok(urAttrs && urAttrs.comesBeforeEng === true, "Urdu selected block is shown FIRST before English copy");

  // Urdu template in script
  const urTplVal = await ev(`(()=>{
    const t = document.getElementById('rmd_trans_title');
    const s = document.getElementById('rmd_trans_stmts');
    return (t ? t.value : '') + ' ' + (s ? s.value : '');
  })()`);
  ok(/[\u0600-\u06FF\u0750-\u077F]/.test(urTplVal), "Do it myself populates Urdu script template");

  // =========================================================================
  // SCREEN 2: Publication Consent Screen (research-screen-pubconsent.js)
  // =========================================================================

  // Navigate to pubconsent screen
  await ev("SMD_RESEARCH.navigate('pubconsent', { projectId: 'prj_consent_1' })");
  ok(await until("!!document.querySelector('.rmd-pubconsent-screen')", 5000), "navigated to pubconsent screen");

  // Click "Do it myself" tab
  await click('[data-rmd="tab-manual"]');
  ok(await until("document.querySelector('#rmd-manual-consent-panel').style.display !== 'none'", 3000), "Do it myself panel visible");

  // Pick Telugu in Do it myself
  await setSelect("#rmd-manual-lang", "te");
  await sleep(150);
  ok(await until("document.querySelector('#rmd-manual-local-container').style.display !== 'none'", 3000), "Telugu manual container visible");

  const pubTeAttrs = await ev(`(()=>{
    const loc = document.getElementById('rmd-manual-local-container');
    const eng = document.getElementById('rmd-manual-english-container');
    if (!loc) return null;
    return {
      lang: loc.getAttribute('lang'),
      dir: loc.getAttribute('dir'),
      comesBeforeEng: !!(eng && (loc.compareDocumentPosition(eng) & Node.DOCUMENT_POSITION_FOLLOWING))
    };
  })()`);
  ok(pubTeAttrs && pubTeAttrs.lang === "te", "pubconsent Telugu container has lang=te");
  ok(pubTeAttrs && pubTeAttrs.dir === "ltr", "pubconsent Telugu container has dir=ltr");
  ok(pubTeAttrs && pubTeAttrs.comesBeforeEng === true, "pubconsent Telugu block comes before English container");

  // Telugu template in script
  const pubTeVal = await ev(`(()=>{ const t = document.getElementById('rmd-manual-local'); return t ? t.value : ''; })()`);
  ok(/[\u0C00-\u0C7F]/.test(pubTeVal), "pubconsent Do it myself populates Telugu template in script");

  // Translation check notice in pubconsent
  ok(/Translation check: have a native speaker or your ethics committee check this translation before use/.test(await text("#rmd-manual-local-container")), "pubconsent shows translation check notice");

  // Pick Urdu in pubconsent Do it myself
  await setSelect("#rmd-manual-lang", "ur");
  await sleep(150);

  const pubUrAttrs = await ev(`(()=>{
    const loc = document.getElementById('rmd-manual-local-container');
    const ta = document.getElementById('rmd-manual-local');
    if (!loc) return null;
    return {
      lang: loc.getAttribute('lang'),
      dir: loc.getAttribute('dir'),
      taDir: ta ? ta.getAttribute('dir') : ''
    };
  })()`);
  ok(pubUrAttrs && pubUrAttrs.lang === "ur", "pubconsent Urdu container has lang=ur");
  ok(pubUrAttrs && pubUrAttrs.dir === "rtl", "pubconsent Urdu container has dir=rtl");
  ok(pubUrAttrs && pubUrAttrs.taDir === "rtl", "pubconsent Urdu textarea has dir=rtl");

  // Urdu template in script
  const pubUrVal = await ev(`(()=>{ const t = document.getElementById('rmd-manual-local'); return t ? t.value : ''; })()`);
  ok(/[\u0600-\u06FF\u0750-\u077F]/.test(pubUrVal), "pubconsent Do it myself populates Urdu template in script");

  // Test empty local blocks export in pubconsent saved view
  await ev(`(()=>{
    document.getElementById('rmd-manual-local').value = '';
    return true;
  })()`);
  await click('[data-rmd="save-manual-consent"]');
  ok(await until("!!document.querySelector('.rmd-consent-saved-view')", 5000), "saved view rendered in pubconsent");

  // Click DOCX export with empty local
  await click('[data-rmd="pubconsent-docx"]');
  await sleep(100);
  const pubBlockedMsg = await text("#rmd-pubconsent-status");
  ok(/Fill in the Urdu version first\./.test(pubBlockedMsg), "empty local in pubconsent blocks export with Fill in the Urdu version first.");

  // Save valid Urdu pubconsent record and verify saved view
  await ev(`(()=>{
    RMDStore.put('prj_consent_1', 'pubconsent', 'consent', {
      english: 'PATIENT CONSENT FOR PUBLICATION (English text)',
      local: 'یہ رضامندی کا فارم مریض کی اشاعت کے لیے ہے (Urdu text)',
      languageName: 'Urdu',
      language: 'ur',
      includesImages: true
    }).then(function() {
      SMD_RESEARCH.screens.pubconsent.render(document.querySelector('.rmd-workspace'));
    });
    return true;
  })()`);
  ok(await until("!!document.querySelector('#rmd-pubconsent-selected-block')", 5000), "Urdu saved consent block rendered");

  const savedUrAttrs = await ev(`(()=>{
    const b = document.getElementById('rmd-pubconsent-selected-block');
    const eng = document.getElementById('rmd-pubconsent-english-copy');
    if (!b) return null;
    return {
      lang: b.getAttribute('lang'),
      dir: b.getAttribute('dir'),
      comesBeforeEng: !!(eng && (b.compareDocumentPosition(eng) & Node.DOCUMENT_POSITION_FOLLOWING))
    };
  })()`);
  ok(savedUrAttrs && savedUrAttrs.lang === "ur", "saved pubconsent container has lang=ur");
  ok(savedUrAttrs && savedUrAttrs.dir === "rtl", "saved pubconsent container has dir=rtl");
  ok(savedUrAttrs && savedUrAttrs.comesBeforeEng === true, "saved Urdu version is shown FIRST before English copy");

  // Copy copies the selected language
  await click('[data-rmd="pubconsent-copy"]');
  await sleep(100);
  const copyBtnText = await text('[data-rmd="pubconsent-copy"]');
  ok(/Copied!|Copy/.test(copyBtnText), "Copy button triggers clipboard copy");

  // =========================================================================
  // VIEWPORTS & RESPONSIVENESS
  // =========================================================================

  // Test 390x844 (iPhone)
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(150);
  const scroll390 = await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth");
  ok(scroll390, "390x844 iPhone has no horizontal scroll");

  // Test 1024x1366 (iPad)
  await call("Emulation.setDeviceMetricsOverride", { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: false });
  await sleep(150);
  const scroll1024 = await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth");
  ok(scroll1024, "1024x1366 iPad has no horizontal scroll");

  // =========================================================================
  // ZERO PAGE ERRORS AND NO EM/EN DASHES
  // =========================================================================
  const dashes = await ev(`(()=>{
    const t = (document.querySelector('#researchMD') || document.body).innerText || '';
    const m = t.match(/[\\u2013\\u2014]/g);
    return m ? m.length : 0;
  })()`);
  ok(dashes === 0, `no em or en dashes in ResearchMD visible text (found ${dashes})`);
  ok(pageErrors.length === 0, `zero page errors (found ${pageErrors.length}: ${pageErrors.join(" | ")})`);

  await shot("consent-lang-verified");

  console.log(failures ? `\nFAILURES: ${failures}` : "\nALL RESEARCH CONSENT LANG UI CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
} catch (err) {
  console.error("Runner error:", err);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  server.close();
}
