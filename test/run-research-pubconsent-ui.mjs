// Real-browser headless CDP test: ResearchMD pubconsent rich-text editor, tutorial Generate,
// empty-draft error, Hindi/Urdu typing & RTL, formatting toolbar & aria-pressed, Save/Edit/DOCX,
// and Light + Dark theme WCAG AA contrast & responsive layout (375, 768, 1024px).
// Run with: node test/run-research-pubconsent-ui.mjs
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

const PORT = 9137, CDP = 9537, OUT = "/tmp/stewardmd-research-pubconsent-ui";
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
let forceEmptyDraft = false;
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
            id: "prj_pc_" + projN,
            title: b.title || "Case Report Study",
            discipline: "medicine",
            specialty: "General Medicine",
            studyType: "case-report",
            role: "owner",
            createdAt: Date.now()
          },
          requestId: "req_proj_" + projN
        });
      }

      if (p.includes("/ai-draft") && req.method === "POST") {
        if (forceEmptyDraft) {
          return send(200, { draft: {}, model: "mock" });
        }
        if (b.task === "publication_consent") {
          const lang = (b.input && b.input.language) || "English";
          return send(200, {
            draft: {
              english: "PATIENT CONSENT FOR PUBLICATION\n\n1. Clinical details.",
              local: lang !== "English" ? ("Local consent in " + lang) : "",
              languageName: lang
            }
          });
        }
        return send(200, { draft: {} });
      }

      send(200, { ok: true });
    });
    return;
  }

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
  `--user-data-dir=/tmp/rmd-pubconsent-chrome-${process.pid}`,
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
    } catch {}
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

const contrastScript = (sel) => `(()=>{
  function parseRgb(str) {
    var m = String(str || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  function effectiveBg(el) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      var bg = parseRgb(getComputedStyle(cur).backgroundColor);
      if (bg && bg.a > 0.1) return bg;
      cur = cur.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  function lum(c) {
    var arr = [c.r / 255, c.g / 255, c.b / 255].map(function(v) {
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * arr[0] + 0.7152 * arr[1] + 0.0722 * arr[2];
  }
  var el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  var fg = parseRgb(getComputedStyle(el).color);
  var bg = effectiveBg(el);
  if (!fg || !bg) return null;
  var l1 = lum(fg), l2 = lum(bg);
  var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return { ratio: ratio, fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor };
})()`;

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
    if (m.method === "Runtime.exceptionThrown") pageErrors.push(JSON.stringify(m.params));
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;

  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: `http://127.0.0.1:${PORT}/?research=1` });
  ok(await until("!!window.SMD_RESEARCH && !!window.SMD_RESEARCH.tutorial && !!window.SMD_RESEARCH.screens.pubconsent", 30000), "app loaded with ResearchMD tutorial and pubconsent");

  // Open ResearchMD shell in explicit Light mode first
  await ev("document.body.classList.remove('dark', 'v3-dark'); SMD_RESEARCH.open({ screen: 'projects' }); 1");
  await sleep(120);

  // 1. Launch Case Report tutorial and navigate to Step 4 (pubconsent)
  await ev("SMD_RESEARCH.tutorial.startTutorial('case', { reset: true }); 1");
  await sleep(150);
  await ev("SMD_RESEARCH.navigate('pubconsent', { projectId: 'tut_case' }); 1");
  ok(await until("!!document.querySelector('#rmd-maik-english')", 5000), "pubconsent screen renders with Ask MaiK editor");

  // B3: Cost text
  const costText = await text("#rmd-maik-consent-panel .rmd-ai-cost");
  ok(costText.trim() === "No MaiK tokens needed", `tutorial cost line says it is free, like the coach bar: "${costText.trim()}"`);

  // Check 44px touch targets (CSS px via offsetWidth/offsetHeight) and aria-labels on toolbar buttons at 375px
  const toolbarAudit = await ev(`(()=>{
    var btns = document.querySelectorAll('#rmd-maik-english-host .rmd-ce-btn');
    var minW = 999, minH = 999, missingAria = 0;
    for (var i = 0; i < btns.length; i++) {
      var w = btns[i].offsetWidth;
      var h = btns[i].offsetHeight;
      if (w < minW) minW = w;
      if (h < minH) minH = h;
      if (!btns[i].getAttribute('aria-label')) missingAria++;
    }
    return { count: btns.length, minW: minW, minH: minH, missingAria: missingAria };
  })()`);
  ok(toolbarAudit.count >= 15 && toolbarAudit.minW >= 44 && toolbarAudit.minH >= 44 && toolbarAudit.missingAria === 0,
    `toolbar has ${toolbarAudit.count} real buttons >=44px (${toolbarAudit.minW}x${toolbarAudit.minH}) with aria-labels`);

  // Check no horizontal overflow at 375px
  ok(await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "375px light mode has no horizontal overflow on editor");

  // 2. B1: Tutorial Generate fills the editor with demo consent and status line stays readable
  await click('[data-rmd="generate-maik-consent"]');
  ok(await until("/PATIENT CONSENT FOR PUBLICATION/.test(document.querySelector('#rmd-maik-english').innerText)", 5000),
    "tutorial Generate fills editor under Generate with demo consent");
  const genStatus = await text("#rmd-maik-consent-status");
  ok(/Draft loaded below/i.test(genStatus), `status line stays readable after Generate: "${genStatus.trim()}"`);

  // 3. Test empty-draft error handling (mock empty draft in tutorial api wrapper temporarily)
  await ev(`(()=>{
    window.__origTutReq = SMD_RESEARCH.api.request;
    SMD_RESEARCH.api.request = function(m, p, b) {
      if (b && b.task === 'publication_consent') return Promise.resolve({ draft: {}, model: 'empty-test' });
      return window.__origTutReq(m, p, b);
    };
    return true;
  })()`);
  await click('[data-rmd="generate-maik-consent"]');
  ok(await until("/MaiK returned an empty consent\\. Try again, or type it below\\./.test(document.querySelector('#rmd-maik-consent-status').innerText)", 4000),
    "empty draft shows error message and keeps status line visible");
  await ev(`(()=>{ if (window.__origTutReq) SMD_RESEARCH.api.request = window.__origTutReq; return true; })()`);

  // 4. Multilingual typing: Hindi (ltr) and Urdu (rtl)
  await setSelect("#rmd-maik-lang", "hi");
  ok(await until("document.querySelector('#rmd-maik-local-container').style.display !== 'none'", 3000), "Hindi local editor appears");
  const hiInfo = await ev(`(()=>{
    var ed = document.getElementById('rmd-maik-local');
    ed.focus();
    ed.innerHTML = '<p>मैं अपने मामले के प्रकाशन के लिए सहमत हूं।</p>';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    return { lang: ed.getAttribute('lang'), dir: ed.getAttribute('dir'), txt: ed.innerText };
  })()`);
  ok(hiInfo.lang === "hi" && hiInfo.dir === "ltr" && /सहमत/.test(hiInfo.txt), "Hindi editor has lang=hi, dir=ltr, and preserves Hindi script");

  await setSelect("#rmd-maik-lang", "ur");
  await sleep(100);
  const urInfo = await ev(`(()=>{
    var ed = document.getElementById('rmd-maik-local');
    ed.focus();
    ed.innerHTML = '<p>میں اپنے کیس کی اشاعت کے لیے رضامند ہوں۔</p>';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    return { lang: ed.getAttribute('lang'), dir: ed.getAttribute('dir'), txt: ed.innerText };
  })()`);
  ok(urInfo.lang === "ur" && urInfo.dir === "rtl" && /رضامند/.test(urInfo.txt), "Urdu editor has lang=ur, dir=rtl, and preserves Urdu script");

  // 5. Bold formatting button wraps selection and shows aria-pressed="true", plus Text Size Large
  const fmtRes = await ev(`(()=>{
    var ed = document.getElementById('rmd-maik-local');
    ed.focus();
    var p = ed.querySelector('p');
    var range = document.createRange();
    range.selectNodeContents(p);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    ed.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    var boldBtn = document.querySelector('#rmd-maik-local-host [data-ce-cmd="bold"]');
    boldBtn.click();
    var hasBold = !!ed.querySelector('b, strong');
    var pressed = boldBtn.getAttribute('aria-pressed');
    var lgBtn = document.querySelector('#rmd-maik-local-host [data-ce-size="lg"]');
    lgBtn.click();
    var hasLg = !!ed.querySelector('.rmd-ce-sz-lg');
    var lgPressed = lgBtn.getAttribute('aria-pressed');
    return { hasBold: hasBold, pressed: pressed, hasLg: hasLg, lgPressed: lgPressed, html: ed.innerHTML };
  })()`);
  ok(fmtRes.hasBold && fmtRes.pressed === "true", `Bold button wraps selection and sets aria-pressed=true (html: ${fmtRes.html})`);
  ok(fmtRes.hasLg && fmtRes.lgPressed === "true", "Large size button wraps selection with .rmd-ce-sz-lg and sets aria-pressed=true");

  // 6. Save shows formatted saved view (not <pre>)
  await click('[data-rmd="save-maik-consent"]');
  ok(await until("!!document.querySelector('.rmd-consent-saved-view')", 5000), "Save switches to formatted saved view");
  const savedCheck = await ev(`(()=>{
    var loc = document.getElementById('rmd_pubconsent_local_preview');
    var eng = document.getElementById('rmd_pubconsent_english_preview');
    return {
      locTag: loc ? loc.tagName : '',
      engTag: eng ? eng.tagName : '',
      hasBold: !!(loc && loc.querySelector('b, strong')),
      hasLg: !!(loc && loc.querySelector('.rmd-ce-sz-lg')),
      locDir: loc ? loc.getAttribute('dir') : ''
    };
  })()`);
  ok(savedCheck.locTag === "DIV" && savedCheck.engTag === "DIV", "saved view renders formatted DIVs instead of <pre>");
  ok(savedCheck.hasBold && savedCheck.hasLg && savedCheck.locDir === "rtl", "saved view keeps bold, large size, and dir=rtl");

  // 7. DOCX download bytes contain <w:b/> and <w:bidi/>
  const docxRes = await ev(`(()=>{
    var captured = null;
    var origDl = SMD_RESEARCH.p2.downloadBytes;
    SMD_RESEARCH.p2.downloadBytes = function(name, bytes) {
      captured = bytes;
      return Promise.resolve();
    };
    document.querySelector('[data-rmd="pubconsent-docx"]').click();
    SMD_RESEARCH.p2.downloadBytes = origDl;
    if (!captured) return null;
    var str = new TextDecoder('utf-8').decode(captured);
    return {
      len: captured.length,
      hasBold: str.indexOf('<w:b/>') >= 0,
      hasBidi: str.indexOf('<w:bidi/>') >= 0,
      hasRtl: str.indexOf('<w:rtl/>') >= 0,
      hasSz: str.indexOf('<w:sz w:val="28"/>') >= 0
    };
  })()`);
  ok(docxRes && docxRes.hasBold && docxRes.hasBidi && docxRes.hasRtl && docxRes.hasSz,
    `DOCX bytes carry <w:b/>, <w:bidi/>, <w:rtl/>, and <w:sz> (${JSON.stringify(docxRes)})`);

  // 8. Contrast check in Light mode (>= 4.5) and Viewports (375, 768, 1024)
  for (const vp of [
    { w: 375, h: 812, mobile: true },
    { w: 768, h: 1024, mobile: false },
    { w: 1024, h: 1366, mobile: false }
  ]) {
    await call("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: vp.mobile });
    await sleep(120);
    const noOverflow = await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth");
    ok(noOverflow, `saved view light mode has no horizontal overflow at ${vp.w}px`);
  }

  const lightLocContrast = await ev(contrastScript("#rmd_pubconsent_local_preview"));
  const lightEngContrast = await ev(contrastScript("#rmd_pubconsent_english_preview"));
  ok(lightLocContrast && lightLocContrast.ratio >= 4.5, `Light mode local saved view contrast >= 4.5 (got ${lightLocContrast && lightLocContrast.ratio.toFixed(2)})`);
  ok(lightEngContrast && lightEngContrast.ratio >= 4.5, `Light mode English saved view contrast >= 4.5 (got ${lightEngContrast && lightEngContrast.ratio.toFixed(2)})`);
  await shot("pubconsent-saved-light");

  // 9. Dark mode contrast check (>= 4.5) and Viewports (375, 768, 1024)
  await ev("document.body.classList.add('dark'); 1");
  await sleep(120);
  const darkLocContrast = await ev(contrastScript("#rmd_pubconsent_local_preview"));
  const darkEngContrast = await ev(contrastScript("#rmd_pubconsent_english_preview"));
  ok(darkLocContrast && darkLocContrast.ratio >= 4.5, `Dark mode local saved view contrast >= 4.5 (got ${darkLocContrast && darkLocContrast.ratio.toFixed(2)})`);
  ok(darkEngContrast && darkEngContrast.ratio >= 4.5, `Dark mode English saved view contrast >= 4.5 (got ${darkEngContrast && darkEngContrast.ratio.toFixed(2)})`);
  await shot("pubconsent-saved-dark");

  // 10. Edit reopens with formatting preserved
  await click('[data-rmd="pubconsent-edit"]');
  ok(await until("!!document.querySelector('#rmd-manual-local')", 5000), "Edit reopens editor panel");
  const editCheck = await ev(`(()=>{
    var loc = document.getElementById('rmd-manual-local');
    var tb = document.querySelector('#rmd-manual-local-host .rmd-ce-toolbar');
    return {
      dir: loc.getAttribute('dir'),
      tbDir: tb ? tb.getAttribute('dir') : '',
      hasBold: !!loc.querySelector('b, strong'),
      hasLg: !!loc.querySelector('.rmd-ce-sz-lg'),
      txt: loc.innerText
    };
  })()`);
  ok(editCheck.dir === "rtl" && editCheck.tbDir === "ltr" && editCheck.hasBold && editCheck.hasLg && /رضامند/.test(editCheck.txt),
    "Edit reopens with formatting, RTL body, LTR toolbar, and text intact");

  // 10b. Keyboard shortcut Ctrl+B and paste sanitization in editor
  const pasteKeyRes = await ev(`(()=>{
    var eng = document.getElementById('rmd-manual-english');
    eng.focus();
    var dt = new DataTransfer();
    dt.setData('text/html', '<p>Pasted <b>safe</b> <script>window.__xss=1</script><a href="https://evil.test">link</a><img src="x" onerror="window.__xss=2"></p>');
    dt.setData('text/plain', 'Pasted safe link');
    var evPaste = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    eng.dispatchEvent(evPaste);
    var hasScript = !!eng.querySelector('script');
    var hasLink = !!eng.querySelector('a');
    var hasImg = !!eng.querySelector('img');
    var hasSafeB = !!eng.querySelector('b');
    // Test Ctrl+B shortcut on selected text
    var p = eng.querySelector('p');
    if (p) {
      var r = document.createRange();
      r.selectNodeContents(p);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    eng.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
    return {
      xss: !!window.__xss,
      hasScript: hasScript,
      hasLink: hasLink,
      hasImg: hasImg,
      hasSafeB: hasSafeB
    };
  })()`);
  ok(!pasteKeyRes.xss && !pasteKeyRes.hasScript && !pasteKeyRes.hasLink && !pasteKeyRes.hasImg && pasteKeyRes.hasSafeB,
    `paste sanitization strips script/a/img and preserves safe <b> (${JSON.stringify(pasteKeyRes)})`);

  for (const vp of [
    { w: 375, h: 812, mobile: true },
    { w: 768, h: 1024, mobile: false },
    { w: 1024, h: 1366, mobile: false }
  ]) {
    await call("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: vp.mobile });
    await sleep(120);
    const noOverflow = await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth");
    ok(noOverflow, `editor dark mode has no horizontal overflow at ${vp.w}px`);
  }
  await shot("pubconsent-editor-dark");

  // 11. Zero em/en dashes and zero uncaught page errors
  const dashes = await ev(`(()=>{
    var t = (document.querySelector('#researchMD') || document.body).innerText || '';
    var m = t.match(/[\\u2013\\u2014]/g);
    return m ? m.length : 0;
  })()`);
  ok(dashes === 0, `no em or en dashes in ResearchMD visible text (found ${dashes})`);
  ok(pageErrors.length === 0, `zero uncaught page errors (found ${pageErrors.length}: ${pageErrors.join(" | ")})`);

  console.log(failures ? `\nFAILURES: ${failures}` : "\nALL RESEARCH PUBCONSENT UI CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
} catch (err) {
  console.error("Runner error:", err);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  server.close();
}
