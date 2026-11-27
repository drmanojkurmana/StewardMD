/* Prescription export timing bench (dev-only, not shipped).
 *
 * Opens the REAL app in headless Chrome at phone size (390x844, 2x), opens the prescription pad, fills a
 * realistic prescription (8 drugs, advice, complaints, vitals, allergy, letterhead with logo, signature),
 * then times "Save as PDF" and "Save as JPEG" end to end through the real buttons, with the CPU slowed
 * down (THROTTLE, default 4x) to stand in for a phone. The /api/rx/issue call is answered inside the
 * browser after NET_MS (default 0) so the network is not part of the number.
 *
 * It also times the pieces on their own (page-to-picture, picture-to-JPEG, PDF build) and three ways of
 * taking the picture, and compares their pixels with the current way.
 *
 * USAGE: CHROME=/usr/bin/google-chrome ROOT=<checkout> OUT=<dir> LABEL=before node test/run-rx-export-bench.mjs
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { readFile, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || join(HERE, "..");
const OUT = process.env.OUT || "/tmp/rx-bench";
const LABEL = process.env.LABEL || "run";
const THROTTLE = +(process.env.THROTTLE || 4);
const RUNS = +(process.env.RUNS || 3);
const NET_MS = +(process.env.NET_MS || 0);
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
mkdirSync(OUT, { recursive: true });

/* Static server. Cacheable on purpose: on the phone the files come from the app bundle, and a
 * no-store server would make every re-read of the 74 stylesheets a fresh fetch and flatter any fix.
 * /api/* answers 404 here: nothing leaves this machine. */
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".gz": "application/gzip" };
const port = await freePort();
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.startsWith("/api/")) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
  if (p === "/") p = "/index.html";
  const fp = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  readFile(fp, (err, data) => {
    if (err) { readFile(join(ROOT, "data", p.replace(/^\//, "")), (e2, d2) => { if (e2) { res.writeHead(404); res.end("404"); return; } res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream", "cache-control": "public, max-age=3600" }); res.end(d2); }); return; }
    res.writeHead(200, { "content-type": TYPES[extname(fp)] || "application/octet-stream", "cache-control": "public, max-age=3600" });
    res.end(data);
  });
}).listen(port, "127.0.0.1");
const BASE = `http://127.0.0.1:${port}/`;

const CDP = await freePort();
const userDir = `/tmp/rx-bench-chrome-${CDP}`;
rmSync(userDir, { recursive: true, force: true });
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", `--remote-debugging-port=${CDP}`, `--user-data-dir=${userDir}`], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const logs = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e, awaitPromise = false) => {
  const r = await call("Runtime.evaluate", { expression: awaitPromise ? `(async function(){try{${e}}catch(x){return "ERR:"+String(x&&x.stack||x)}})()` : `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true, awaitPromise });
  if (r.result && r.result.exceptionDetails) return "EXC:" + JSON.stringify(r.result.exceptionDetails).slice(0, 500);
  return r.result && r.result.result ? r.result.result.value : null;
};
const until = async (e, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(250); } return false; };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const report = { label: LABEL, throttle: THROTTLE, runs: RUNS, netMs: NET_MS };

try {
  let ver; for (let t = 0; t < 300 && !ver; t++) { try { ver = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.consoleAPICalled") {
      const txt = (m.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || "")).join(" ");
      if (/^#\d+ \d+ms|html2canvas|\[rxbench\]/.test(txt)) logs.push(txt);
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  await sleep(1500);
  await ev(`if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }); return 1;`);
  await call("Page.navigate", { url: BASE + "?nosw=1" });
  if (!await until(`return !!(window.SMD_RX && window.SMD_RX._rxDoc && window.smdLazy && window.SMD_PGLOG_QR);`, 90000)) throw new Error("app did not load");
  await sleep(1500);
  report.domNodes = await ev(`return document.getElementsByTagName("*").length;`);
  report.styleSheets = await ev(`return document.styleSheets.length;`);
  report.cssRules = await ev(`var n=0; for (var i=0;i<document.styleSheets.length;i++){ try{ n+=document.styleSheets[i].cssRules.length; }catch(e){} } return n;`);

  /* Letterhead, signature, account name, under the same keys prescription.js reads. */
  await ev(`
    ["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();});
    var uid = "guest"; try { uid = (window.SMD_ACCOUNT && SMD_ACCOUNT.uid && SMD_ACCOUNT.uid()) || "guest"; } catch (e) {}
    var lc = document.createElement("canvas"); lc.width = 240; lc.height = 240; var g = lc.getContext("2d");
    g.fillStyle = "#0e6e63"; g.beginPath(); g.arc(120,120,110,0,7); g.fill(); g.fillStyle = "#fff"; g.font = "bold 110px sans-serif"; g.textAlign="center"; g.textBaseline="middle"; g.fillText("SK",120,128);
    var sc = document.createElement("canvas"); sc.width = 600; sc.height = 200; var s = sc.getContext("2d");
    s.strokeStyle = "#1e3a8a"; s.lineWidth = 5; s.lineCap = "round"; s.beginPath(); s.moveTo(30,150);
    for (var x = 30; x < 570; x += 6) s.lineTo(x, 110 + Math.sin(x/23)*45 + Math.cos(x/9)*12); s.stroke();
    localStorage.setItem("smd_rx_clinic_" + uid, JSON.stringify({ name: "Sri Krishna Clinic", address: "12-4-56, Dwaraka Nagar, Visakhapatnam, Andhra Pradesh 530016", phone: "+91 98480 12345", logo: lc.toDataURL("image/png") }));
    localStorage.setItem("smd_rx_sign_" + uid, sc.toDataURL("image/png"));
    try { var a = JSON.parse(localStorage.getItem("stewardmd_account") || "{}"); a.name = a.name || "Asha Rao"; localStorage.setItem("stewardmd_account", JSON.stringify(a)); } catch (e) {}
    window.SMD_VERIFY = { isVerified: function(){ return Promise.resolve(true); }, openPanel: function(){} };
    SMD_RX.open({ topic: "Community-acquired pneumonia" });
    return uid;`);
  if (!await until(`return !!document.querySelector('#rxLines [data-f="drug"]') && !!document.querySelector("#rxAdd");`, 20000)) throw new Error("pad did not open");
  const DRUGS = [
    ["Amoxycillin + Clavulanic Acid", "Augmentin 625 Duo", "625 mg", "BD", "7 days"],
    ["Azithromycin", "Azee 500", "500 mg", "OD", "3 days"],
    ["Paracetamol", "Dolo 650", "650 mg", "TDS SOS", "5 days"],
    ["Pantoprazole", "Pan 40", "40 mg", "OD before breakfast", "7 days"],
    ["Levocetirizine + Montelukast", "Montair LC", "1 tab", "HS", "10 days"],
    ["Ambroxol + Guaifenesin syrup", "Ascoril LS", "10 ml", "TDS", "5 days"],
    ["Salbutamol + Ipratropium nebulisation", "Duolin respules", "1 respule", "QID", "3 days"],
    ["Vitamin C + Zinc", "Limcee Zinc", "1 tab", "OD", "15 days"]
  ];
  await ev(`for (var i = 1; i < ${DRUGS.length}; i++) document.querySelector("#rxAdd").click(); return 1;`);
  await sleep(500);
  const filled = await ev(`
    var D = ${JSON.stringify(DRUGS)};
    function set(e, v){ if(!e) return; e.value = v; e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); }
    var rows = document.querySelectorAll("#rxLines .rx-line:not(.adv)");
    for (var i = 0; i < D.length && i < rows.length; i++) { ["drug","brand","dose","freq","duration"].forEach(function(f, k){ set(rows[i].querySelector('[data-f="'+f+'"]'), D[i][k]); }); }
    var adv = document.querySelector("#rxLines .rx-line.adv [data-f=drug]");
    set(adv, "Steam inhalation twice daily. Plenty of oral fluids. Review after 3 days or earlier if breathlessness, high fever or chest pain.");
    set(document.getElementById("rxPtName"), "Ramesh Varma"); set(document.getElementById("rxPtAge"), "46 / M");
    set(document.getElementById("rxDx"), "Community-acquired pneumonia (right lower lobe)");
    set(document.getElementById("rxCc"), "Fever 4 days, productive cough, right-sided chest pain");
    set(document.getElementById("rxVitals"), "BP 128/82, HR 102, RR 22, SpO2 95% RA, Temp 101.2 F");
    set(document.getElementById("rxAllergies"), "Sulfonamides (rash)");
    return rows.length;`);
  report.drugRows = filled;

  /* Browser-side stubs: the issue endpoint (answered here after NET_MS), sign-in token, haptics as the
   * finish line, toasts recorded, downloads captured instead of saved. */
  await ev(`
    window.__rx = { outs: {}, toasts: [], done: null, err: null, h2c: [], enc: [] };
    window.SMD_AUTH = window.SMD_AUTH || {}; try { Object.defineProperty(window.SMD_AUTH, "currentUser", { configurable: true, get: function(){ return { getIdToken: function(){ return Promise.resolve("bench"); } }; } }); } catch (e) { window.SMD_AUTH = { currentUser: { getIdToken: function(){ return Promise.resolve("bench"); } } }; }
    var of = window.fetch;
    window.fetch = function (u, o) {
      if (String(u).indexOf("/api/rx/issue") >= 0) return new Promise(function (r) { setTimeout(function(){ r(new Response(JSON.stringify({ ok: true, issued: true, code: "RX-7K3M-9Q2P-4TXA", validUntil: "2026-12-27T00:00:00.000Z" }), { status: 200, headers: { "content-type": "application/json" } })); }, ${NET_MS}); });
      return of.apply(this, arguments);
    };
    window.SMD_HAPTICS = { success: function(){ window.__rx.done = performance.now(); }, error: function(){ window.__rx.err = performance.now(); }, light: function(){}, medium: function(){}, selection: function(){} };
    window.SMD_toast = function (m) { window.__rx.toasts.push(String(m)); };
    var ac = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__rx.outs[this.download] = this.href; return; } return ac.apply(this, arguments); };
    return 1;`);

  /* One export through the real buttons. Returns ms from the tap on Save as PDF/JPEG to the success haptic. */
  async function e2e(kind) {
    await ev(`window.__rx.done = null; window.__rx.err = null; window.__rx.outs = {}; window.__rx.h2c = []; window.__rx.enc = []; document.querySelectorAll(".rx-bp-ov").forEach(function(o){o.remove();}); document.querySelector("#rxExport").click(); return 1;`);
    if (!await until(`return !!document.querySelector("#rxExpPdf");`, 10000)) throw new Error("export chooser did not open");
    await call("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    await ev(`window.__rx.t0 = performance.now(); document.querySelector("${kind === "pdf" ? "#rxExpPdf" : "#rxExpJpg"}").click(); return 1;`);
    const okDone = await until(`return !!(window.__rx.done || window.__rx.err);`, 180000);
    await call("Emulation.setCPUThrottlingRate", { rate: 1 });
    const r = await ev(`return JSON.stringify({ ms: (window.__rx.done || window.__rx.err) - window.__rx.t0, err: !!window.__rx.err, files: Object.keys(window.__rx.outs), h2c: window.__rx.h2c, enc: window.__rx.enc, toasts: window.__rx.toasts.slice(-3) });`);
    const o = JSON.parse(r); o.timedOut = !okDone; return o;
  }
  async function saveOuts(tag) {
    const outs = JSON.parse(await ev(`return JSON.stringify(window.__rx.outs);`) || "{}");
    for (const [name, href] of Object.entries(outs)) { const b64 = String(href).split(",")[1] || ""; writeFileSync(join(OUT, `${LABEL}-${tag}-${name}`), Buffer.from(b64, "base64")); }
    return Object.fromEntries(Object.entries(outs).map(([k, v]) => { const buf = Buffer.from(String(v).split(",")[1] || "", "base64"); return [k, { bytes: buf.length, sha256: createHash("sha256").update(k.endsWith(".pdf") ? buf.toString("latin1").replace(/\/CreationDate \([^)]*\)/g, "").replace(/\/ID \[[^\]]*\]/g, "") : buf).digest("hex").slice(0, 16) }]; }));
  }

  // First export after app start: includes loading html2canvas + jsPDF on demand.
  report.coldPdf = await e2e("pdf"); report.coldPdf.bytes = await saveOuts("cold");

  // Count html2canvas calls and encode time inside the real export (wrapped after the engines exist).
  await ev(`
    var H = window.html2canvas; if (H && !H.__w) { window.html2canvas = function (el, o) { var t = performance.now(); return H.apply(this, arguments).then(function (c) { window.__rx.h2c.push(Math.round(performance.now() - t)); return c; }); }; window.html2canvas.__w = 1; }
    var td = HTMLCanvasElement.prototype.toDataURL; if (!td.__w) { HTMLCanvasElement.prototype.toDataURL = function () { var t = performance.now(); var r = td.apply(this, arguments); if (this.width > 400) window.__rx.enc.push(Math.round(performance.now() - t)); return r; }; HTMLCanvasElement.prototype.toDataURL.__w = 1; }
    return 1;`);
  const pdf = [], jpg = [];
  for (let i = 0; i < RUNS; i++) { pdf.push(await e2e("pdf")); jpg.push(await e2e("jpeg")); }
  report.pdf = { medianMs: Math.round(med(pdf.map((x) => x.ms))), runs: pdf };
  report.jpeg = { medianMs: Math.round(med(jpg.map((x) => x.ms))), runs: jpg };
  await e2e("pdf"); report.pdfFile = await saveOuts("final");
  await e2e("jpeg"); report.jpegFile = await saveOuts("final");

  /* The pieces on their own, on the same sheet the export builds, with the same CPU slow-down. */
  await call("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const parts = await ev(`
    var log = function(){};
    var uid = "guest"; try { uid = (window.SMD_ACCOUNT && SMD_ACCOUNT.uid && SMD_ACCOUNT.uid()) || "guest"; } catch (e) {}
    var sig = localStorage.getItem("smd_rx_sign_" + uid);
    var rxv = { code: "RX-7K3M-9Q2P-4TXA", validUntil: "2026-12-27T00:00:00.000Z" };
    var H = window.html2canvas.__w ? null : window.html2canvas;
    function h2c(el, o) { return (window.__h2cRaw || window.html2canvas)(el, o); }
    var CSS_ = "position:fixed;left:-9999px;top:0;width:794px;background:#fff;z-index:-1";
    function build(doc) { var n = SMD_RX._rxDoc("Community-acquired pneumonia", "APMC/2019/48213", sig, rxv, { includeSafety: true }); n.style.cssText = CSS_; return n; }
    var OPT = { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false };
    function now() { return performance.now(); }
    function pick(rules, out, root, node) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.type === 1) {
          var sel = r.selectorText.replace(/::?(before|after|placeholder|selection|marker|first-line|first-letter|backdrop|-webkit-[a-z-]+|-moz-[a-z-]+)\\b(\\([^)]*\\))?/g, "");
          var hit = false; try { hit = root.matches(sel) || document.body.matches(sel) || node.matches(sel) || !!node.querySelector(sel); } catch (e) { hit = false; }
          if (hit) out.push(r.cssText);
        } else if (r.type === 4) { try { if (matchMedia(r.media.mediaText).matches) pick(r.cssRules, out, root, node); } catch (e) {} }
        else if (r.type === 12) { try { if (CSS.supports(r.conditionText)) pick(r.cssRules, out, root, node); } catch (e) {} }
        else if (r.type === 5) out.push(r.cssText);
      }
    }
    function matched(node) { var out = []; for (var i = 0; i < document.styleSheets.length; i++) { var rs; try { rs = document.styleSheets[i].cssRules; } catch (e) { continue; } if (rs) pick(rs, out, document.documentElement, node); } return out.join("\\n"); }
    function isoFrame(css) {
      var f = document.createElement("iframe"); f.setAttribute("aria-hidden", "true");
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1200px;border:0;visibility:hidden";
      document.body.appendChild(f);
      var d = f.contentDocument; d.open(); d.write("<!doctype html><html><head><meta charset=utf-8><style>" + css.replace(/<\\/style/gi, "<\\\\/style") + "</style></head><body></body></html>"); d.close();
      d.documentElement.className = document.documentElement.className; d.body.className = document.body.className;
      return f;
    }
    function diff(a, b) {
      if (a.width !== b.width || a.height !== b.height) return { sameSize: false, a: [a.width, a.height], b: [b.width, b.height] };
      var A = a.getContext("2d").getImageData(0, 0, a.width, a.height).data, B = b.getContext("2d").getImageData(0, 0, b.width, b.height).data, n = 0, mx = 0;
      for (var i = 0; i < A.length; i += 4) { var d = Math.max(Math.abs(A[i]-B[i]), Math.abs(A[i+1]-B[i+1]), Math.abs(A[i+2]-B[i+2])); if (d > mx) mx = d; if (d > 24) n++; }
      return { sameSize: true, size: [a.width, a.height], pixelsOff: n, pctOff: +(100 * n / (A.length / 4)).toFixed(4), maxDiff: mx };
    }
    var res = { v0: [], v1: [], v2: [], v2css: [], encJpegDataURL: [], encJpegBlob: [], encPngDataURL: [], pdfNow: [], pdfBytes: [] };
    var c0, c1, c2, css;
    for (var k = 0; k < ${RUNS}; k++) {
      // v0: as the app does it today
      var n0 = build(); document.body.appendChild(n0); var t = now(); c0 = await h2c(n0, OPT); res.v0.push(Math.round(now() - t)); n0.remove();
      // v1: same, but tell html2canvas to skip the rest of the app while it copies the page
      var n1 = build(); document.body.appendChild(n1); t = now();
      c1 = await h2c(n1, Object.assign({}, OPT, { ignoreElements: function (el) { return el.parentNode === document.body && el !== n1 && el.tagName !== "STYLE" && el.tagName !== "LINK"; } }));
      res.v1.push(Math.round(now() - t)); n1.remove();
      // v2: the sheet alone in a small page holding only the CSS rules that touch it
      var n2 = build(); document.body.appendChild(n2); t = now(); css = matched(n2); res.v2css.push(Math.round(now() - t)); n2.remove();
      var f = isoFrame(css); var d = f.contentDocument; var n2b = d.importNode(n2, true); d.body.appendChild(n2b);
      t = now(); c2 = await h2c(n2b, OPT); res.v2.push(Math.round(now() - t)); f.remove();
      // encoders on the picture
      t = now(); var j = c0.toDataURL("image/jpeg", 0.95); res.encJpegDataURL.push(Math.round(now() - t)); res.jpegBytes = Math.round(j.length * 3 / 4);
      t = now(); var bl = await new Promise(function (r) { c0.toBlob(r, "image/jpeg", 0.95); }); res.encJpegBlob.push(Math.round(now() - t));
      t = now(); var pn = c0.toDataURL("image/png"); res.encPngDataURL.push(Math.round(now() - t)); res.pngBytes = Math.round(pn.length * 3 / 4);
      // PDF build exactly as exportRxNow (no stamp), from the JPEG above
      var JS = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      t = now(); var pdf = new JS({ unit: "pt", format: "a4" }), pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      var imgH = c0.height * (pw / c0.width), y = 0, g = 0; while (g++ < 60) { pdf.addImage(j, "JPEG", 0, -y, pw, imgH); y += ph; if (y >= imgH - 1) break; pdf.addPage(); }
      var out = pdf.output("datauristring"); res.pdfNow.push(Math.round(now() - t)); res.pdfPages = pdf.getNumberOfPages(); res.pdfOutBytes = Math.round(out.length * 3 / 4);
    }
    res.canvas = [c0.width, c0.height];
    res.diffV1 = diff(c0, c1); res.diffV2 = diff(c0, c2); res.cssChars = css.length;
    window.__shots = { v0: c0.toDataURL("image/png"), v2: c2.toDataURL("image/png"), v1: c1.toDataURL("image/png") };
    return JSON.stringify(res);`, true);
  await call("Emulation.setCPUThrottlingRate", { rate: 1 });
  report.parts = parts && parts.startsWith("{") ? JSON.parse(parts) : parts;
} catch (e) {
  report.error = String(e && e.stack || e);
}

try {
  if (!report.error) {
    const shots = JSON.parse(await ev(`return JSON.stringify(window.__shots || {});`) || "{}");
    for (const [k, v] of Object.entries(shots)) writeFileSync(join(OUT, `${LABEL}-canvas-${k}.png`), Buffer.from(String(v).split(",")[1] || "", "base64"));
  }
} catch (e) { report.error2 = String(e); }
report.h2cLog = logs.slice(-40);
writeFileSync(join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
try { ws.close(); } catch {}
chrome.kill("SIGKILL"); server.close();
process.exit(report.error ? 1 : 0);
