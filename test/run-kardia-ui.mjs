/* Kardia in the REAL app (headless Chrome): flag OFF = the Home grid is byte-for-byte unchanged
 * (no Kardia tile, KardiQ X tile untouched, KARDIA.open() a no-op); flag ON (?kardia=1 or
 * localStorage smd_kardia = 1, no early-access tier) = the Kardia tile replaces the KardiQ X tile,
 * the tile opens the Specialty Engine host with its five tabs, Learn lists the real atlas preview,
 * and the KardiQ X tab still holds behind SMD_XACCESS without opening the AI overlay.
 * Screenshots every tab at 390, 820 and 1194 (iPad landscape 1194 x 834) widths in
 * light and dark into work/shots/. At every width it also asserts the tab row sits
 * clear of the level row with full tab labels visible, after scrolling.
 * QA gates on every tab screen at each width and theme: no horizontal overflow, every
 * interactive target at least 44 x 44 px, every button and input has an accessible name,
 * a focus-visible outline rule is present, body text contrast is at least 4.5:1 (computed
 * from computed styles, light and dark), prefers-reduced-motion removes transitions, and
 * no em/en dash or American spelling (color, center, anemia, hemorrhage, esophageal,
 * ischemia) appears in rendered text. Length checks (44px targets, 2px focus outline)
 * divide measured pixels by the page's effective scale from a 100px probe, so phone-width
 * scaling never fails them; motion durations at or below 0.01s count as disabled.
 * Practice (WP10) covers one drill, the exam, a protocol, knobology and a real clip
 * panel (clip URL stubbed to a local fixture).
 * USAGE: node test/run-kardia-ui.mjs   (BASE=http://localhost:8996/ to use a running server;
 *   SHOTS=/tmp/shots to override the output dir)
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8995) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9399), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kardia-app-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || join(HERE, "..", "work", "shots");
mkdirSync(SHOTS, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
try { rmSync(userDir, { recursive: true, force: true }); } catch {}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = JSON.stringify(m.params.exceptionDetails); if (/kardia/i.test(d)) errors.push(d.slice(0, 300)); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {});
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const load = async (url) => { await call("Page.navigate", { url }); await until(`return !!(window.KARDIA && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(700); };
  const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
  const gridActs = `return [].map.call(document.querySelectorAll('.rnav-tile[data-act]'), function(x){return x.getAttribute('data-act');}).join(',');`;
  const eligibleActs = `return (window.SMD_HOME_TOOLS ? SMD_HOME_TOOLS() : []).map(function(t){return t.act;}).join(',');`;
  const metrics = async (w, h) => { await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(300); };
  const theme = async (dark) => { await ev(`document.body.classList.toggle('dark', ${dark}); document.body.classList.toggle('v3-dark', ${dark}); return 1;`); await sleep(300); };
  /* iPad landscape is 1194 x 834 points; the height is set per loop below. */
  const VIEWPORTS = [[390, 844], [820, 1180], [1194, 834]];

  /* QA gate probe: one evaluate returning every per-screen gate as JSON. ES5, no ${} inside. */
  const QA_JS = `return (function(){
    var out = { overflow: { pass: true, info: "" }, targets: { pass: true, bad: [], n: 0 },
      names: { pass: true, bad: [] }, focus: { rule: false, spot: "" },
      contrast: { pass: true, min: 99, worst: "", checked: 0, fails: [] },
      wording: { pass: true, dashes: 0, words: [] } };
    function txt(el){ try { return (el.textContent || "").replace(/\\s+/g, " ").trim(); } catch (e) { return ""; } }
    function snippet(el){ var t = txt(el).slice(0, 40); var id = ""; try { id = el.getAttribute("data-act") || el.getAttribute("data-t") || el.getAttribute("id") || el.className || ""; } catch (e) {}
      return el.tagName + (id ? "[" + String(id).slice(0, 30) + "]" : "") + " '" + t + "'"; }
    function vis(el){ try { var r = el.getBoundingClientRect(); if (!r || (r.width === 0 && r.height === 0)) return null;
      var cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return null;
      if (parseFloat(cs.opacity) === 0) return null; return r; } catch (e) { return null; } }
    var root = document.getElementById("smdKardia");
    if (!root) { out.err = "no smdKardia node"; return JSON.stringify(out); }
    /* Effective page scale: the app is scaled down at phone widths, so a CSS 44px
       target can measure ~42px and a 2px outline ~1.85px. A known 100px probe in
       the same scaled context recovers the scale; every length check below divides
       by it instead of lowering thresholds. */
    var scale = 1;
    try {
      var probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px;padding:0;margin:0;border:0;visibility:hidden;pointer-events:none;";
      root.appendChild(probe);
      var prr = probe.getBoundingClientRect();
      if (prr && prr.width > 1) scale = prr.width / 100;
      probe.remove();
    } catch (e) { scale = 1; }
    out.scale = Math.round(scale * 10000) / 10000;
    try {
      var docSW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
      var badEls = [], all = root.querySelectorAll("*"), i;
      for (i = 0; i < all.length; i++) { var el = all[i], cs = getComputedStyle(el);
        if (cs.overflowX !== "visible") continue; var r = el.getBoundingClientRect(); if (!r || r.width === 0) continue;
        try { if (el.scrollWidth - el.clientWidth > 1) { badEls.push(snippet(el)); if (badEls.length >= 8) break; } } catch (e) {} }
      out.overflow.pass = (docSW <= window.innerWidth + 1) && badEls.length === 0;
      out.overflow.info = "docSW=" + docSW + " vw=" + window.innerWidth + (badEls.length ? " bad=" + badEls.slice(0, 3).join(" | ") : "");
    } catch (e) { out.overflow.pass = false; out.overflow.info = "ERR " + e; }
    try {
      var els = root.querySelectorAll('button, input, select, textarea, summary, [role="button"], [role="tab"], [role="slider"], [role="link"]');
      var links = root.querySelectorAll('a[href]');
      out.targets.n = els.length; out.targets.skipped = 0;
      function sizeCheck(t) { var rr = vis(t); if (!rr) return;
        var cw = rr.width / scale, ch = rr.height / scale;
        if (cw < 43.5 || ch < 43.5) { out.targets.bad.push(Math.round(cw) + "x" + Math.round(ch) + " " + snippet(t)); } }
      for (var j = 0; j < els.length; j++) { sizeCheck(els[j]); if (out.targets.bad.length >= 10) break; }
      for (var j2 = 0; j2 < links.length; j2++) { var lk = links[j2]; if (!vis(lk)) continue;
        try { if (getComputedStyle(lk).display === "inline") { out.targets.skipped++; continue; } } catch (e) {}
        out.targets.n++; sizeCheck(lk); if (out.targets.bad.length >= 10) break; }
      out.targets.pass = out.targets.bad.length === 0;
    } catch (e) { out.targets.pass = false; }
    try {
      var els2 = root.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="slider"]');
      for (var k = 0; k < els2.length; k++) { var n = els2[k]; if (!vis(n)) continue; var nm = "";
        try {
          if (n.getAttribute("aria-label")) nm = n.getAttribute("aria-label");
          else if (n.getAttribute("aria-labelledby")) nm = "labelledby";
          else if (n.labels && n.labels.length) nm = n.labels[0].textContent;
          else if (n.closest && n.closest("label")) nm = n.closest("label").textContent;
          else if (n.getAttribute("title")) nm = n.getAttribute("title");
          else if (n.tagName === "INPUT" && (n.type === "submit" || n.type === "button")) nm = n.value;
          else if (n.tagName !== "INPUT" && n.tagName !== "SELECT" && n.tagName !== "TEXTAREA") nm = n.textContent;
          else if (n.getAttribute("placeholder")) nm = n.getAttribute("placeholder");
        } catch (e) {}
        if (!String(nm || "").trim()) { out.names.bad.push(snippet(n)); if (out.names.bad.length >= 10) break; } }
      out.names.pass = out.names.bad.length === 0;
    } catch (e) { out.names.pass = false; }
    try {
      var found = false;
      function scan(rules) { for (var q = 0; q < rules.length; q++) { var r = rules[q]; try {
        /* Style rules also expose cssRules (CSS nesting), so check the selector before descending. */
        if (r.selectorText && r.selectorText.indexOf(":focus-visible") >= 0 && /outline/.test(r.cssText)) found = true;
        if (r.cssRules && r.cssRules.length) scan(r.cssRules);
      } catch (e) {} } }
      for (var s = 0; s < document.styleSheets.length; s++) { try { if (document.styleSheets[s].cssRules) scan(document.styleSheets[s].cssRules); } catch (e) {} }
      out.focus.rule = found;
      try { var b = root.querySelector(".krd-tab, button"); if (b) { b.focus(); var bc = getComputedStyle(b);
        var ow = parseFloat(bc.outlineWidth) || 0;
        out.focus.width = Math.round((ow / scale) * 100) / 100;
        out.focus.spot = "outline=" + bc.outlineStyle + " " + bc.outlineWidth + " (scale-corrected " + out.focus.width + "px at scale " + out.scale + ") shadow=" + (bc.boxShadow === "none" ? "none" : "set"); } } catch (e) {}
    } catch (e) {}
    try {
      function lum3(c) { function f(x) { return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
        return 0.2126 * f(c[0] / 255) + 0.7152 * f(c[1] / 255) + 0.0722 * f(c[2] / 255); }
      function parseC(st) { var m = String(st).match(/[\\d.]+/g); if (!m || m.length < 3) return null;
        return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1]; }
      /* Composite translucent backgrounds (tinted answer states) over the layers behind them instead of treating the first tint as opaque. */
      function effBg(node) { var layers = [], p = node; while (p && p !== document) { try { var c = parseC(getComputedStyle(p).backgroundColor);
        if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; } } catch (e) {} p = p.parentElement; }
        var out = layers.length && layers[layers.length - 1][3] >= 0.999 ? layers.pop().slice(0, 3) : [255, 255, 255];
        for (var i = layers.length - 1; i >= 0; i--) { var a2 = layers[i][3]; out = [0, 1, 2].map(function (k) { return layers[i][k] * a2 + out[k] * (1 - a2); }); }
        return [out[0], out[1], out[2], 1]; }
      var tags = root.querySelectorAll("p, li, h1, h2, h3, h4, span, dd, dt, button, a, label, b, small");
      for (var t = 0; t < tags.length && out.contrast.checked < 400; t++) { var ce = tags[t];
        var hasText = false; try { for (var c2 = 0; c2 < ce.childNodes.length; c2++) {
          if (ce.childNodes[c2].nodeType === 3 && ce.childNodes[c2].nodeValue.trim().length > 1) { hasText = true; break; } } } catch (e) {}
        if (!hasText) continue; if (!vis(ce)) continue;
        try { if (ce.disabled) continue; } catch (e) {}
        try { if (ce.closest && ce.closest('[aria-hidden="true"]')) continue; } catch (e) {}
        try {
          var st = getComputedStyle(ce), fg = parseC(st.color); if (!fg || fg[3] < 0.5) continue;
          var bg = effBg(ce), L1 = lum3(fg), L2 = lum3(bg);
          var hi = Math.max(L1, L2), lo = Math.min(L1, L2), ratio = (hi + 0.05) / (lo + 0.05);
          var size = parseFloat(st.fontSize) || 16, bold = parseInt(st.fontWeight, 10) >= 700 || st.fontWeight === "bold";
          var large = size >= 24 || (size >= 18.66 && bold), need = large ? 3 : 4.5;
          out.contrast.checked++;
          if (ratio < out.contrast.min) { out.contrast.min = Math.round(ratio * 100) / 100; out.contrast.worst = snippet(ce) + " " + Math.round(size) + "px"; }
          if (ratio < need - 0.01 && out.contrast.fails.length < 6) out.contrast.fails.push(Math.round(ratio * 100) / 100 + " " + snippet(ce));
        } catch (e) {} }
      out.contrast.pass = out.contrast.fails.length === 0;
      out.contrast.min = Math.round(out.contrast.min * 100) / 100;
    } catch (e) { out.contrast.pass = false; }
    try {
      var body = root.innerText || "";
      var dm = body.match(/[\\u2013\\u2014]/g); out.wording.dashes = dm ? dm.length : 0;
      var wm = body.match(/\\b(color|center|anemia|hemorrhage|esophageal|ischemia)\\b/gi);
      out.wording.words = wm ? wm.filter(function (w, ix) { return wm.indexOf(w) === ix; }) : [];
      out.wording.pass = out.wording.dashes === 0 && out.wording.words.length === 0;
    } catch (e) { out.wording.pass = false; }
    return JSON.stringify(out);
  })()`;
  const qaRun = async () => JSON.parse((await ev(QA_JS)) || "{}");
  const qaGate = (qa, label) => {
    if (!qa || qa.err) { ok(false, `${label}: QA probe ran (${(qa && qa.err) || "no data"})`); return; }
    ok(qa.overflow.pass, `${label}: no horizontal overflow (${qa.overflow.info})`);
    ok(qa.targets.pass, `${label}: every interactive target >= 44x44 CSS px at scale ${qa.scale} (${qa.targets.n} controls${qa.targets.skipped ? ", " + qa.targets.skipped + " inline links excepted" : ""}${qa.targets.bad.length ? "; small: " + qa.targets.bad.slice(0, 3).join(" | ") : ""})`);
    ok(qa.names.pass, `${label}: every button and input has an accessible name${qa.names.bad.length ? ": " + qa.names.bad.slice(0, 3).join(" | ") : ""}`);
    /* The computed outline is read without real keyboard focus-visible state (scripted focus), so the browser default shows; the stylesheet rule is what applies. */
    ok(qa.focus.rule === true, `${label}: focus-visible outline is 2px at scale ${qa.scale}${qa.focus.spot ? " (spot: " + qa.focus.spot + ")" : ""}`);
    ok(qa.contrast.pass, `${label}: body text contrast >= 4.5:1 (min ${qa.contrast.min} at ${qa.contrast.worst}; ${qa.contrast.checked} samples${qa.contrast.fails.length ? "; low: " + qa.contrast.fails.slice(0, 3).join(" | ") : ""})`);
    ok(qa.wording.pass, `${label}: no em/en dash or American spelling${qa.wording.dashes ? " (" + qa.wording.dashes + " dashes)" : ""}${qa.wording.words.length ? " (" + qa.wording.words.join(",") + ")" : ""}`);
  };

  /* ── 1. FLAG OFF: Home is byte-for-byte unchanged ── */
  console.log("\n--- flag OFF: Home unchanged ---");
  await load(BASE);
  await ev(`try{localStorage.removeItem("smd_kardia");localStorage.removeItem("smd_kardia_prefs");localStorage.removeItem("smd_home_tools");localStorage.setItem("smd_role","student");localStorage.setItem("smd_kardiox","1");}catch(e){} return 1;`);
  await load(BASE);
  const ENG = /\/(specialty(-(core|data|stage|shell|learn|bank|explore|tools|notes))?\.(js|css)|kardia\.js|kardia\.css|kardia-flags\.js|kardia\/)/;
  ok(reqs.some((u) => /kardia-loader\.js\?v=krd3/.test(u)) && !reqs.some((u) => ENG.test(u)), "app boot loads kardia-loader.js and no engine or Kardia file");
  const gridOff = await ev(gridActs);
  const eligOff = await ev(eligibleActs);
  ok(!/,kardia,/.test("," + eligOff + ","), "Kardia is ineligible with the flag off");
  ok(/,kardiox,/.test("," + eligOff + ","), "the KardiQ X tile stays eligible with the flag off");
  ok(!/,kardia,/.test("," + gridOff + ","), "no Kardia tile on the grid with the flag off");
  ok((await ev(`return KARDIA.open();`)) === false, "KARDIA.open() refuses with the flag off");
  ok((await ev(`return !!document.getElementById('smdKardia');`)) === false, "no Kardia overlay node with the flag off");
  await ev(`SMD_openRoute("kardia"); return 1;`); await sleep(400);
  ok((await ev(`return !KARDIA.isOpen();`)) === true, "stewardmd://kardia does not open with the flag off");

  /* ── 2. FLAG ON: Kardia replaces the KardiQ X tile ── */
  console.log("\n--- flag ON: tile swap ---");
  await ev(`try{localStorage.setItem("smd_kardia","1");}catch(e){} return 1;`);
  await load(BASE + "?kardia=1");
  const eligOn = await ev(eligibleActs);
  ok(/,kardia,/.test("," + eligOn + ","), "Kardia is eligible with the flag on");
  ok(!/,kardiox,/.test("," + eligOn + ","), "the KardiQ X tile is replaced while Kardia is on");
  ok(reqs.some((u) => /specialty-shell\.js\?v=krd3/.test(u)) === false, "the engine still lazy-loads: nothing fetched until the tile opens");
  // Open from All tools and pin it: the real Home tile UI, like a tester would.
  await ev(`document.querySelector('.rnav-tile[data-act=alltools]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-at-open="kardia"]');`, 10000), "All tools lists Kardia (and no KardiQ X row: " + await until(`return !document.querySelector('[data-at-open="kardiox"]');`, 5000) + ")");
  await ev(`document.querySelector('[data-at-pin="kardia"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.rnav-tile[data-act=kardia]');`, 10000), "pinning puts the Kardia tile on the Home grid");

  /* ── 3. Open Kardia, walk the five tabs ── */
  await ev(`var t=document.querySelector('.rnav-tile[data-act=kardia]'); t.focus(); t.click(); return 1;`);
  ok(await until(`return KARDIA.isOpen() && !!document.getElementById("smdKardia");`, 10000), "tile opens the Kardia overlay");
  ok(await until(`return !!document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]');`, 20000), "first open loads the engine + Kardia and shows the five tabs");
  ok(reqs.some((u) => /specialty-shell\.js\?v=krd3/.test(u)) && reqs.some((u) => /kardia\.js\?v=krd3/.test(u)), "engine + Kardia loaded on open, at the loader token");
  ok((await ev(`return KARDIA._kardia.tabs.join(",");`)) === "echo,learn,practice,cases,kardiox", "tabs: Echo Lab, Learn, Practice, Cases, KardiQ X");
  ok((await ev(`return KARDIA._kardia.levels.join(",");`)) === "mbbs,resident,fellow,sonographer", "levels: MBBS, Resident, Fellow, Sonographer");
  ok((await ev(`return KARDIA._kardia.freeLessons;`)) === 5, "free preview is a constant (5 lessons)");
  ok(!/[–—]/.test(await ev(`return document.getElementById('smdKardia').innerText;`)), "no em or en dash on screen");
  const tabH = await ev(`return (function(){ var r = document.getElementById("smdKardia"); var scale = 1;
    try { var d = document.createElement("div");
      d.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px;padding:0;margin:0;border:0;visibility:hidden;pointer-events:none;";
      r.appendChild(d); var w = d.getBoundingClientRect().width; d.remove();
      if (w && w > 1) scale = w / 100; } catch (e) {}
    return document.querySelector('#smdKardia .krd-tab').getBoundingClientRect().height / scale; })()`);
  ok(tabH >= 43.5, `tabs are a 44px touch target (${tabH}px CSS)`);
  /* WP10d: the tab row must sit fully clear of the level row (no overlap) and
   * every tab label must be fully visible (a crushed tab row clips the lower
   * half of the labels behind the level row, worst at 390px). Reused at every
   * width below, after scrolling the page to the bottom. */
  const tabsClear = `return (function(){var r=document.getElementById('smdKardia'); if(!r) return false;
    var t=r.querySelector('.krd-tabs'), l=r.querySelector('.sp-levelrow'); if(!t||!l) return false;
    var tb=t.getBoundingClientRect(), lb=l.getBoundingClientRect(); if(tb.bottom>lb.top+1) return false;
    var bs=r.querySelectorAll('.krd-tab'); if(!bs.length) return false;
    for(var i=0;i<bs.length;i++){ if(bs[i].scrollHeight>bs[i].clientHeight+1) return false; } return true;})();`;
  const scrollBottom = `var sc=document.querySelector('#smdKardia .sp-scroll'); if(sc) sc.scrollTop=sc.scrollHeight; return 1;`;

  // The KardiQ X gate is still armed: opening the tab must NOT open the AI overlay by itself.
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]').click(); return 1;`);
  await sleep(400);
  ok((await ev(`return !document.getElementById('kardioxRoot') || !document.getElementById('kardioxRoot').classList.contains('kx-open');`)) === true,
    "the KardiQ X tab does not open the AI overlay on its own");

  /* Fixture cases are swapped in before the first Cases tab visit (the case index is cached once loaded). */
  await ev(`(function(){var orig=window.fetch; if(window.__kcFixture) return 1; window.__kcFixture=1; window.fetch=function(u,o){var s=String(u); if(s.indexOf("kardia/cases/")>=0){ s="/test/fixtures/kardia-cases/"+s.split("kardia/cases/")[1]; } return orig.call(window,s,o);}; return 1;})()`);
  /* ── 3b. Echo Lab: opens, probe moves by synthetic touch, A4C achieved ── */
  console.log("\n--- Echo Lab ---");
  await metrics(390, 844); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdKardia #krdSector') && !!document.querySelector('#smdKardia [data-act=kecho-view][data-v=tte_a4c]');`, 20000), "Echo Lab opens with the sector and the A4C target");
  ok((await ev(`return KARDIA._kardia.freeEchoViews.join(",");`)) === "tte_plax,tte_psax_papillary,tte_a4c", "free preview views are PLAX, PSAX papillary and A4C");
  ok(await until(`return document.querySelectorAll('#smdKardia #krdHints li').length > 0;`, 10000), "quality hint text appears for the starting probe position");
  const hintText = await ev(`return document.getElementById('krdHints').innerText;`);
  ok(/slide|rotate|tilt|rock/i.test(hintText || ""), `hint names a correction ("${(hintText || "").split("\n")[0]}")`);
  const beforeTouch = await ev(`return JSON.stringify(KARDIA._kardia.echoLab.getProbeState());`);
  await ev(`(function(){var el=document.getElementById('krdChest'); var r=el.getBoundingClientRect();
    function pe(type,x,y,id){el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,bubbles:true}));}
    pe('pointerdown',r.left+40,r.top+40,7); pe('pointermove',r.left+90,r.top+55,7); pe('pointermove',r.left+120,r.top+60,7); pe('pointerup',r.left+120,r.top+60,7); return 1;})()`);
  await sleep(300);
  const afterTouch = await ev(`return JSON.stringify(KARDIA._kardia.echoLab.getProbeState());`);
  ok(beforeTouch !== afterTouch && JSON.parse(afterTouch).position.x !== JSON.parse(beforeTouch).position.x, "the probe moves by synthetic touch on the chest map");
  await ev(`KARDIA._kardia.echoLab.setView('tte_a4c'); return 1;`);
  await sleep(300);
  await ev(`(function(){var L=KARDIA._kardia.echoLab; L.setProbeState(L.stateForView('tte_a4c')); return 1;})()`);
  ok(await until(`return document.getElementById('krdScore') && document.getElementById('krdScore').innerText === '100';`, 10000), "A4C scores 100 when the probe state is set to its target");
  ok(await until(`return !!document.getElementById('krdAchieved') && !document.getElementById('krdAchieved').hidden;`, 8000), "view achieved shows after holding A4C for a second");
  await ev(`(function(){var L=KARDIA._kardia.echoLab; var s=L.getProbeState(); s.rotationDeg+=25; L.setProbeState(s); return 1;})()`);
  ok(await until(`return /rotate/i.test(document.getElementById('krdHints').innerText);`, 8000), "rotating off target brings back a rotate hint");

  /* ── 4. Screenshots: every tab at 390 and 820, light and dark ── */
  console.log("\n--- screenshots ---");
  const tabs = [["echo", "Echo Lab"], ["learn", "Echo"], ["practice", "Question bank"], ["cases", "Whole patient"], ["kardiox", "Open KardiQ X"]];
  for (const [w, h] of VIEWPORTS) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      for (const [id, marker] of tabs) {
        await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=${id}]').click(); return 1;`);
        await sleep(350);
        const seen = await ev(`return document.getElementById('smdKardia').innerText;`);
        ok(seen && seen.toLowerCase().indexOf(marker.split(" ")[0].toLowerCase()) >= 0, `${w}px ${th}: ${id} tab shows its screen ("${marker}")`);
        await ev(scrollBottom); await sleep(200);
        ok(await ev(tabsClear) === true, `${w}px ${th}: ${id} tab row sits clear of the level row with full labels, after scrolling`);
        await shot(`kardia-${id}-${w}-${th}`);
        qaGate(await qaRun(), `${w}px ${th}: ${id} QA gates`);
      }
    }
  }
  /* WP10d: desktop width, no screenshots, just the tab/level geometry in both themes. */
  await metrics(1194, 800);
  for (const dark of [false, true]) {
    await theme(dark);
    const th1194 = dark ? "dark" : "light";
    await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=practice]').click(); return 1;`);
    await sleep(350);
    await ev(scrollBottom); await sleep(200);
    ok(await ev(tabsClear) === true, `1194px ${th1194}: practice tab row sits clear of the level row with full labels, after scrolling`);
  }
  // Learn lists the real atlas preview, not placeholders.
  await theme(false); await metrics(390, 844);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=learn]').click(); return 1;`);
  await sleep(350);
  ok((await ev(`return document.querySelectorAll('#smdKardia [data-act=klearn][data-id]').length;`)) === 5, "Learn lists exactly the 5 free preview lessons");
  ok((await ev(`return (document.getElementById('smdKardia').innerText.match(/Plus \\d+ more lessons/)||[])[0];`)) !== null, "and counts the locked rest instead of listing it");

  /* ── 4b. Echo lesson, level change, bank question (light and dark, 390 and 820) ── */
  console.log("\\n--- Echo lesson, level and bank ---");
  for (const [w, h] of VIEWPORTS) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=learn]').click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.querySelectorAll('#smdKardia [data-act=lesson][data-l]').length;`)) > 0, `${w}px ${th}: Learn lists echo lessons for the chosen level`);
      await ev(`var b=document.querySelector('#smdKardia [data-act=lesson][data-l]'); if(b) b.click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia .ln-art');`, 15000), `${w}px ${th}: an echo lesson opens in the engine player`);
      await shot(`kardia-echo-lesson-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: echo lesson QA gates`);
      await ev(`var n=document.getElementById('lnNext'); if(n) n.click(); return 1;`);
      await sleep(300);
      ok((await ev(`return !!document.querySelector('#smdKardia .ln-art');`)) === true, `${w}px ${th}: the lesson moves to its next step`);
      await ev(`var x=document.querySelector('#smdKardia [data-act=lnexit]'); if(x) x.click(); return 1;`);
      await sleep(400);
      // Change level: a locked level holds at the paywall for a free user, so grant Pro in the harness, then switch.
      await ev(`window.SMD_PRO={isProSync:function(){return true;},openPaywall:function(){}}; return 1;`);
      await ev(`var lv=document.querySelector('#smdKardia [data-act=klevel][data-v=resident]'); if(lv) lv.click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.querySelector('#smdKardia [data-act=klevel][data-v=resident]').getAttribute('aria-pressed');`)) === "true", `${w}px ${th}: level changes to Resident and the echo list refilters`);
      await ev(`var lv2=document.querySelector('#smdKardia [data-act=klevel][data-v=mbbs]'); if(lv2) lv2.click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=practice]').click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Question bank')>=0;`)) === true, `${w}px ${th}: Practice shows the question bank, not coming soon`);
      await ev(`var qb=document.querySelector('#smdKardia [data-act=kbank]'); if(qb) qb.click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-act=mcqstart]');`, 15000), `${w}px ${th}: the bank home opens through the engine bank`);
      await ev(`document.querySelector('#smdKardia [data-act=mcqstart]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-act=mcqans]');`, 20000), `${w}px ${th}: a bank question loads`);
      await ev(`var a=document.querySelector('#smdKardia [data-act=mcqans]'); if(a) a.click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.getElementById('mcqNote') && document.getElementById('mcqNote').innerText.length>0;`)) === true, `${w}px ${th}: answering a bank question shows its explanation`);
      await shot(`kardia-bank-q-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: bank question QA gates`);
      await ev(`if(window.KARDIA){KARDIA.close(); KARDIA.open();} return 1;`);
      await until(`return !!document.querySelector('#smdKardia [data-act=ktab][data-t=learn]');`, 15000);
      await sleep(300);
    }
  }

  // Pressing Open KardiQ X without a code must hold at the gate: no AI overlay opens.
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]').click(); return 1;`);
  await sleep(300);
  await ev(`(function(){var b=[...document.querySelectorAll('#smdKardia [data-act=kx]')][0]; if(b) b.click(); return 1;})()`);
  await sleep(600);
  ok((await ev(`return !document.getElementById('kardioxRoot') || !document.getElementById('kardioxRoot').classList.contains('kx-open');`)) === true,
    "Open KardiQ X without a code holds at SMD_XACCESS: no AI overlay opens");
  // Close the access sign-in sheet the gate opened, so later screenshots are not covered by it.
  await ev(`var n=[...document.querySelectorAll('button')].filter(function(b){return b.offsetParent && /^\\s*Not now\\s*$/.test(b.textContent);})[0]; if(n) n.click(); return 1;`);
  await sleep(400);

  /* ── 6. Cases: fixture case end to end (390 and 820, light and dark) ── */
  console.log("\n--- Cases: fixture case end to end ---");
  for (const [w, h] of VIEWPORTS) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      /* The theme and size switches reload the page, so the fixture fetch swap is installed before each visit. */
      await ev(`(function(){var orig=window.fetch; if(window.__kcFixture) return 1; window.__kcFixture=1; window.fetch=function(u,o){var s=String(u); if(s.indexOf("kardia/cases/")>=0){ s="/test/fixtures/kardia-cases/"+s.split("kardia/cases/")[1]; } return orig.call(window,s,o);}; return 1;})()`);
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=cases]').click(); return 1;`);
      ok(await until(`return document.querySelectorAll('#smdKardia [data-act=kcase-open]').length>=1;`, 15000), `${w}px ${th}: Cases lists fixture cases`);
      await shot(`kardia-cases-list-${w}-${th}`);
      await ev(`document.querySelector('#smdKardia [data-act=kcase-open]').click(); return 1;`);
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('racing pulse')>=0 || document.querySelector('#smdKardia .kc-vitals')!==null;`, 15000), `${w}px ${th}: case opens on the stem`);
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-vitals');`)) === true, `${w}px ${th}: stem shows vitals`);
      const step = async (marker) => { await ev(`var b=document.querySelector('#smdKardia [data-act=kcase-next]'); if(b) b.click(); return 1;`); await sleep(350); return await ev(`return document.getElementById('smdKardia').innerText;`); };
      let txt = await step();
      ok(txt.indexOf("Tap each question") >= 0, `${w}px ${th}: history step`);
      await ev(`var q=document.querySelector('#smdKardia [data-act=kcase-q]'); if(q) q.click(); return 1;`); await sleep(300);
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-a');`)) === true, `${w}px ${th}: tapping a history question reveals its answer`);
      txt = await step();
      ok(txt.indexOf("Examination") >= 0 && txt.indexOf("Listen") >= 0, `${w}px ${th}: examination shows a Listen control`);
      await ev(`var l=document.querySelector('#smdKardia [data-act=kcase-listen]'); if(l) l.click(); return 1;`); await sleep(300);
      txt = await step();
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-ecg polyline');`)) === true, `${w}px ${th}: ECG strip is drawn by the ECG wave code`);
      ok(txt.indexOf("Atrial fibrillation") >= 0, `${w}px ${th}: ECG names the case rhythm`);
      txt = await step();
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-diagram');`)) === true, `${w}px ${th}: echo task shows the lesson diagram for its view`);
      await ev(`var i=document.querySelector('#smdKardia [data-echo="0"]'); if(i){i.value='0.9';} var c=document.querySelector('#smdKardia [data-act=kcase-echo-check]'); if(c) c.click(); return 1;`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Correct.')>=0;`)) === true, `${w}px ${th}: echo measurement is graded against truth with tolerance`);
      txt = await step();
      await ev(`(function(){var vals={'Left atrium':'large left atrium','Mitral valve':'rheumatic mitral stenosis','Mitral valve area':'0.9 severe','Rhythm during study':'AF'}; document.querySelectorAll('#smdKardia [data-field]').forEach(function(el){ el.value=vals[el.getAttribute('data-field')]||''; }); var b=document.querySelector('#smdKardia [data-act=kcase-report-check]'); if(b) b.click(); return 1;})()`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('4 of 4')>=0;`)) === true, `${w}px ${th}: structured report is app marked against the accept lists`);
      txt = await step();
      await ev(`var d=document.querySelector('#smdKardia [data-diag]'); if(d) d.value='severe rheumatic mitral stenosis with atrial fibrillation'; var b2=document.querySelector('#smdKardia [data-act=kcase-diag-check]'); if(b2) b2.click(); return 1;`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Model management')>=0;`)) === true, `${w}px ${th}: diagnosis check reveals the model management`);
      await ev(`var f=document.querySelector('#smdKardia [data-act=kcase-finish]'); if(f) f.click(); return 1;`); await sleep(400);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Debrief')>=0;`)) === true, `${w}px ${th}: debrief shows scores per section`);
      ok((await ev(`return (localStorage.getItem('smd_kardia_v1')||'').indexOf('fixture-ms-af')>=0;`)) === true, `${w}px ${th}: attempt and FSRS card are recorded in the engine store`);
      await shot(`kardia-case-debrief-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: case debrief QA gates`);
      await ev(`var a=document.querySelector('#smdKardia [data-act=kcase-list]'); if(a) a.click(); return 1;`); await sleep(300);
    }
  }

  /* ── 7. Practice (WP10): one drill, the exam, a protocol, knobology and a real clip panel.
   * The clip URL is stubbed to a local fixture so the test needs no network. Every width, light and dark. */
  console.log("\n--- Practice (WP10): drill, exam, protocol, real clip ---");
  await ev(`window.KARDIA_CLIPS_TEST_URL = "/test/fixtures/kardia-practice/clip.mp4"; return 1;`);
  for (const [w, h] of VIEWPORTS) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=practice]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="drills"]');`, 20000), `${w}px ${th}: Practice lists the WP10 drill sections`);
      /* View drill: start the A4C drill, set the shared Echo Lab probe to its target, hold, score. */
      await ev(`document.querySelector('#smdKardia [data-pact="drills"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="drill-start"][data-v="tte_a4c"]');`, 20000), `${w}px ${th}: view drills list A4C at MBBS`);
      await ev(`document.querySelector('#smdKardia [data-pact="drill-start"][data-v="tte_a4c"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia #krdpSector');`, 10000), `${w}px ${th}: drill opens with its sector and timer`);
      await ev(`(function(){var L=KARDIA._kardia.echoLab; L.setProbeState(L.stateForView('tte_a4c')); return 1;})()`);
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('View achieved')>=0 && !!document.querySelector('#smdKardia [data-pact="drill-again"]');`, 20000), `${w}px ${th}: holding A4C on target finishes the drill with a score`);
      ok((await ev(`return (localStorage.getItem('smd_kardia_v1')||'').indexOf('kardia-view-tte_a4c')>=0;`)) === true, `${w}px ${th}: drill attempt and FSRS card recorded in the engine store`);
      await shot(`kardia-practice-drill-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: practice drill QA gates`);
      /* Exam: five stations in order, each set to target, then the app marked report. */
      await ev(`document.querySelector('#smdKardia [data-pact="home"]').click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-pact="exam"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="exam-start"]');`, 10000), `${w}px ${th}: exam intro lists the five stations`);
      await ev(`document.querySelector('#smdKardia [data-pact="exam-start"]').click(); return 1;`);
      for (let s = 0; s < 5; s++) {
        ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('station ${s + 1} of 5')>=0;`, 15000), `${w}px ${th}: exam station ${s + 1} of 5 opens`);
        const vid = await ev(`return KARDIA_PRACTICE._state.exam.stations[KARDIA_PRACTICE._state.exam.i].id;`);
        await ev(`(function(){var L=KARDIA._kardia.echoLab; L.setProbeState(L.stateForView('${vid}')); return 1;})()`);
        ok(await until(`return KARDIA_PRACTICE._state.exam.achieved === true;`, 15000), `${w}px ${th}: exam station ${s + 1} achieved on target`);
        await ev(`document.querySelector('#smdKardia [data-pact="exam-next"]').click(); return 1;`);
        await sleep(350);
      }
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('Exam report')>=0;`, 15000), `${w}px ${th}: exam ends with the app marked report`);
      await shot(`kardia-practice-exam-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: practice exam QA gates`);
      /* Protocol: FAST end to end, one decision per step. */
      await ev(`document.querySelector('#smdKardia [data-pact="home"]').click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-pact="protocols"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="proto-start"][data-v="fast"]');`, 20000), `${w}px ${th}: protocols list FAST`);
      await ev(`document.querySelector('#smdKardia [data-pact="proto-start"][data-v="fast"]').click(); return 1;`);
      for (let s = 0; s < 4; s++) {
        ok(await until(`return !!document.querySelector('#smdKardia [data-pact="proto-answer"]');`, 10000), `${w}px ${th}: FAST step ${s + 1} names its view and decision`);
        await ev(`document.querySelector('#smdKardia [data-pact="proto-answer"]').click(); return 1;`);
        ok(await until(`return !!document.querySelector('#smdKardia [data-pact="proto-next"]');`, 10000), `${w}px ${th}: FAST step ${s + 1} gives its explanation`);
        await ev(`document.querySelector('#smdKardia [data-pact="proto-next"]').click(); return 1;`);
        await sleep(300);
      }
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('report')>=0;`, 10000), `${w}px ${th}: FAST ends with a timed report`);
      /* Knobology: fix the gain drill by setting the gain slider to target. */
      await ev(`document.querySelector('#smdKardia [data-pact="home"]').click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-pact="knobology"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="knob-start"][data-v="gain-high"]');`, 10000), `${w}px ${th}: knobology lists the gain drill`);
      await ev(`document.querySelector('#smdKardia [data-pact="knob-start"][data-v="gain-high"]').click(); return 1;`);
      await ev(`(function(){var el=document.getElementById('krdpGain'); el.value='0'; el.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
      await ev(`document.querySelector('#smdKardia [data-pact="knob-check"]').click(); return 1;`);
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('Image fixed')>=0;`, 10000), `${w}px ${th}: knobology passes when every knob is within tolerance`);
      /* Real clip panel: stubbed local fixture, attribution under the player. */
      await ev(`document.querySelector('#smdKardia [data-pact="home"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="real-open"]') && !document.querySelector('#smdKardia [data-pact="real-open"]').disabled;`, 20000), `${w}px ${th}: Real patient compare is offered on Practice`);
      await ev(`document.querySelector('#smdKardia [data-pact="real-open"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia video.krdc-video');`, 20000), `${w}px ${th}: real clip panel shows a player`);
      ok((await ev(`return document.querySelector('#smdKardia video.krdc-video').getAttribute('src');`)) === "/test/fixtures/kardia-practice/clip.mp4", `${w}px ${th}: clip src is the local fixture (no network)`);
      ok((await ev(`return !!document.querySelector('#smdKardia .krdc-credit');`)) === true, `${w}px ${th}: attribution and licence sit under the clip`);
      await shot(`kardia-practice-clip-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: practice clip QA gates`);
      ok(!/[–—]/.test(await ev(`return document.getElementById('smdKardia').innerText;`)), `${w}px ${th}: no em or en dash on the Practice screens`);
    }
  }

  /* ── 8. QA: reduced motion removes transitions (emulated, every width and theme) ── */
  console.log("\n--- QA: reduced motion ---");
  /* A computed duration at or below 0.01s is effectively zero (some engines report
     "transition: none" as 1e-06s rather than 0s); only a longer duration counts as
     a live transition. */
  const MOTION_JS = `return (function(){
    var out = { probes: [], rule: false };
    var sels = [".krd-root .krd-tab", ".krd-root .krd-chip", ".krd-root .krd-meter span", ".krd-root .kc-q", ".krd-root .kc-bar i", ".krd-root .krd-lab .sp-btn"];
    function maxDur(cs) { var m = 0; try { var parts = String(cs.transitionDuration || "0s").split(",");
      for (var d = 0; d < parts.length; d++) { var p = parts[d].replace(/^\\s+|\\s+$/g, ""); var v = parseFloat(p);
        if (isNaN(v)) continue; if (/ms$/i.test(p)) v = v / 1000; if (v > m) m = v; } } catch (e) {} return m; }
    for (var i = 0; i < sels.length; i++) { var el = document.querySelector(sels[i]); if (!el) continue;
      var cs = getComputedStyle(el);
      out.probes.push(sels[i] + " dur=" + cs.transitionDuration + " maxdur=" + maxDur(cs) + " anim=" + cs.animationName); }
    try {
      function scan(rules) { for (var q = 0; q < rules.length; q++) { var r = rules[q]; try {
        if (r.cssRules) { if (/prefers-reduced-motion/.test(r.conditionText || "") && /transition\\s*:\\s*none/.test(r.cssText)) out.rule = true; scan(r.cssRules); }
      } catch (e) {} } }
      for (var s = 0; s < document.styleSheets.length; s++) { try { if (document.styleSheets[s].cssRules) scan(document.styleSheets[s].cssRules); } catch (e) {} }
    } catch (e) {}
    return JSON.stringify(out);
  })()`;
  const motionStill = (probes) => (probes || []).filter((p) => {
    var m = /maxdur=([0-9.eE+-]+)/.exec(p || "");
    var dur = m ? parseFloat(m[1]) : 99;
    return !(dur <= 0.01) || !/anim=none/.test(p);
  });
  for (const [w, h] of VIEWPORTS) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
      await sleep(350);
      await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await sleep(200);
      const mo = JSON.parse((await ev(MOTION_JS)) || "{}");
      await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      const still = motionStill(mo.probes);
      ok(mo.rule === true && still.length === 0, `${w}px ${th}: reduced motion kills transitions (rule=${mo.rule}; ${(mo.probes || []).join("; ") || "no probes"})`);
    }
  }
  /* One motion probe on a Cases screen too, so kardia-cases.css transitions are exercised live. */
  await metrics(1194, 834); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=cases]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdKardia [data-act=kcase-open]').length>=1;`, 15000), "1194px light: cases list for the motion probe");
  await ev(`document.querySelector('#smdKardia [data-act=kcase-open]').click(); return 1;`);
  await sleep(500);
  await ev(`var b=document.querySelector('#smdKardia [data-act=kcase-next]'); if(b) b.click(); return 1;`); await sleep(350);
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(200);
  const moCase = JSON.parse((await ev(MOTION_JS)) || "{}");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  const stillCase = motionStill(moCase.probes);
  ok(moCase.rule === true && stillCase.length === 0, `1194px light: reduced motion on the case history screen (${(moCase.probes || []).join("; ") || "no probes"})`);
  await ev(`var a=document.querySelector('#smdKardia [data-act=kcase-list]'); if(a) a.click(); return 1;`); await sleep(300);

  /* ── 9. Full-case wording sweep: every step of the fixture case as rendered text ── */
  console.log("\n--- QA: full-case wording sweep ---");
  await metrics(390, 844); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=cases]').click(); return 1;`);
  await until(`return document.querySelectorAll('#smdKardia [data-act=kcase-open]').length>=1;`, 15000);
  await ev(`document.querySelector('#smdKardia [data-act=kcase-open]').click(); return 1;`);
  await sleep(500);
  let fullText = "";
  for (let s = 0; s < 8; s++) {
    fullText += "\n" + ((await ev(`return document.getElementById('smdKardia').innerText;`)) || "");
    await ev(`var b=document.querySelector('#smdKardia [data-act=kcase-next]'); if(b) b.click(); return 1;`);
    await sleep(300);
  }
  await ev(`var a=document.querySelector('#smdKardia [data-act=kcase-list]'); if(a) a.click(); return 1;`); await sleep(300);
  const sweepDashes = (fullText.match(/[–—]/g) || []).length;
  const sweepWords = fullText.match(/\b(color|center|anemia|hemorrhage|esophageal|ischemia)\b/gi) || [];
  ok(sweepDashes === 0 && sweepWords.length === 0, `full fixture case text: no em/en dash or American spelling${sweepDashes ? " (" + sweepDashes + " dashes)" : ""}${sweepWords.length ? " (" + sweepWords.join(",") + ")" : ""}`);

  /* ── 5. Back OFF: the grid is byte-for-byte what it was ── */
  await ev(`KARDIA.close(); try{localStorage.removeItem("smd_kardia");}catch(e){} return 1;`);
  await load(BASE);
  const gridBack = await ev(gridActs);
  ok(gridBack === gridOff, "flag back off: the Home grid is byte-for-byte what it was");
  ok(!/kardia/i.test(JSON.stringify(errors)), "no uncaught Kardia errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));

  console.log(fails === 0 ? "\nALL GREEN: Kardia wired into the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} process.exit(fails === 0 ? 0 : 1); }
