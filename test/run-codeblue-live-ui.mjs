/* Code Blue live screen in headless Chrome over CDP: idle (mode picker,
 * disclaimer, audio-blocked notice, patient link row), running with the
 * persistent status strip, CPR ring plus vent panel, drug buttons with dose
 * text and on-button counts (no counter pills), colour-coded live timeline,
 * bottom tab bar (Timer, Log, Notes, Settings) with the strip above every
 * tab and a slim End bar above the tabs,
 * paused, rhythm due, epinephrine due and overdue, ROSC with post-ROSC
 * checklist, re-arrest, log with edit and undo, empty log, procedures and
 * rhythm pickers, sound sheet with independent mutes, resume prompt, ended
 * summary opening the code sheet, LIVE patient-link export to the timeline,
 * training mode (badged, never touches the sheet or a record),
 * storage-full error. Phone 390 and 360 px, iPad 820x1180, 1194x834 and
 * 1366x1024, light and dark. Screenshots go to SHOTS=<dir>.
 *
 * USAGE: node test/run-codeblue-live-ui.mjs   (BASE=http://localhost:PORT/ for a running server; SHOTS=<dir> saves PNGs)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/cb-live-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FLAGS = (process.env.CHROME_FLAGS || "").split(/\s+/).filter(Boolean);

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=2"].concat(FLAGS), { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const shotCall = async (p) => { await sleep(250); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name, dark) => {
  if (!process.env.SHOTS) return;
  const fsx = await import("node:fs");
  fsx.mkdirSync(process.env.SHOTS, { recursive: true });
  await ev(`document.body.classList.${dark ? "add" : "remove"}("dark"); return 1;`);
  await sleep(400);
  const r = await shotCall({ format: "png" });
  if (r.result) fsx.writeFileSync(join(process.env.SHOTS, "cbl-" + name + "-" + (dark ? "dark" : "light") + ".png"), Buffer.from(r.result.data, "base64"));
};
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const viewIs = (v) => `return window.CodeBlueLive && CodeBlueLive._rt.view() === ${JSON.stringify(v)};`;
const CBL = `#cblRoot`;
// Shared in-page helper: the rect of an element only when it is really on screen.
// The raw rect is intersected with every scrolling/clipping ancestor and with
// the viewport, so tiles inside the secondary scroll region (or a closed
// timeline drawer) only report the part that is actually visible.
const VIS = `function visRect(el){var r=el.getBoundingClientRect();var cs=getComputedStyle(el);if(cs.display==="none"||cs.visibility==="hidden"||r.width===0||r.height===0)return null;var L=r.left,T=r.top,R=r.right,B=r.bottom;var n=el.parentElement;while(n){var s=getComputedStyle(n);if(/(auto|scroll|hidden|clip)/.test(s.overflowY+" "+s.overflowX)){var a=n.getBoundingClientRect();L=Math.max(L,a.left);T=Math.max(T,a.top);R=Math.min(R,a.right);B=Math.min(B,a.bottom);}n=n.parentElement;}L=Math.max(L,0);T=Math.max(T,0);R=Math.min(R,innerWidth);B=Math.min(B,innerHeight);if(R-L<=0||B-T<=0)return null;return {left:L,top:T,right:R,bottom:B,width:R-L,height:B-T};}`;

async function metrics(tag) {
  const small = await ev(`return (function () { ${VIS}
    return Array.from(document.querySelectorAll("${CBL} button")).map(function (b) { var r = visRect(b); return r ? Math.round(Math.min(r.width, r.height)) : null; }).filter(function (n) { return n !== null && n < 44; }).length; })();`);
  ok(small === 0, tag + ": all tap targets at least 44 px (small=" + small + ")");
  const tiles = await ev(`return Array.from(document.querySelectorAll("${CBL} .cbl-tile")).map(function (b) { return Math.round(b.getBoundingClientRect().height); });`);
  ok(Array.isArray(tiles) && tiles.length > 0 && tiles.every((h) => h >= 64), tag + ": tiles at least 64 px (" + (tiles || []).join(",") + ")");
  const scroll = await ev(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`);
  ok(scroll === true, tag + ": no horizontal scroll");
}

/* Layout audit that would have caught the broken phone and iPad screens:
 * at 390 and 360 no tile, clock, strip-cell, drug-button or tab text is
 * clipped, no two visible interactive elements overlap, every target is
 * at least 44 px; on iPad every grid cell has content and the timeline
 * column is visible with no toggle button. */
async function layoutAudit(tag, mode) {
  mode = mode || "phone";
  const clip = await ev(`return (function () {
    var bad = [];
    var sels = ".cbl-tilelabel,.cbl-tilesub,.cbl-ringtime,.cbl-ringline,.cbl-cellk,.cbl-cellv,.cbl-druglabel,.cbl-drugdose,.cbl-drugsub,.cbl-duetext,.cbl-dueword,.cbl-tab span";
    Array.from(document.querySelectorAll("${CBL} " + sels)).forEach(function (el) {
      if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className + ":" + el.textContent.slice(0, 24));
    });
    return bad;
  })();`);
  ok(Array.isArray(clip) && clip.length === 0, tag + ": no clipped text (" + (clip || []).join("|") + ")");
  const doseLines = await ev(`return Array.from(document.querySelectorAll("${CBL} .cbl-drugdose")).filter(function (el) { return el.scrollHeight > el.clientHeight + 2; }).length;`);
  ok(doseLines === 0, tag + ": dose text on one line");
  const overlap = await ev(`return (function () {
    ${VIS}
    function vis(el) { return visRect(el); }
    var els = Array.from(document.querySelectorAll("${CBL} button")).map(function (b) { return [b, vis(b)]; }).filter(function (p) { return p[1]; });
    var bad = [];
    for (var i = 0; i < els.length; i++) for (var j = i + 1; j < els.length; j++) {
      var a = els[i][1], b = els[j][1];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
        bad.push((els[i][0].getAttribute("data-act") || "?") + "/" + (els[j][0].getAttribute("data-act") || "?"));
      }
    }
    return bad;
  })();`);
  ok(Array.isArray(overlap) && overlap.length === 0, tag + ": no overlapping tap targets (" + (overlap || []).join("|") + ")");
  const small = await ev(`return (function () { ${VIS}
    return Array.from(document.querySelectorAll("${CBL} button")).map(function (b) { var r = visRect(b); return r ? Math.round(Math.min(r.width, r.height)) : null; }).filter(function (n) { return n !== null && n < 44; }).length; })();`);
  ok(small === 0, tag + ": every interactive target at least 44 px (small=" + small + ")");
  if (mode === "ipad") {
    const tlw = await ev(`return document.querySelector('${CBL} .cbl-timeline').getBoundingClientRect().width;`);
    ok(tlw > 200, tag + ": timeline column visible without a toggle (" + tlw + " px)");
    const handle = await ev(`return getComputedStyle(document.querySelector('${CBL} .cbl-tlhandle')).display;`);
    ok(handle === "none", tag + ": no timeline toggle on iPad");
    const empty = await ev(`return Array.from(document.querySelectorAll('${CBL} .cbl-priority > *, ${CBL} .cbl-secgrid > *')).filter(function (el) { return el.textContent.trim().length === 0; }).length;`);
    ok(empty === 0, tag + ": every grid cell has content");
  } else {
    const handle = await ev(`return getComputedStyle(document.querySelector('${CBL} .cbl-tlhandle')).display;`);
    ok(handle !== "none", tag + ": slim timeline handle present on phone");
  }
}

/* Layout-contract shell audit: priority tiles fully inside the viewport
 * and above the tab bar, page itself never scrolls, nothing covers a
 * priority tile centre, and the clock never overflows its card. At
 * 820 px and above every tile must be visible without scrolling. */
async function shellAudit(tag) {
  const prio = await ev(`return (function () {
    var tabs = document.querySelector('${CBL} .cbl-tabs');
    var tabTop = tabs ? tabs.getBoundingClientRect().top : window.innerHeight;
    var out = {};
    [["shock", '[data-act="tile-shock"]'], ["epi", '[data-drug="epi"]'], ["rhythm", '[data-act="tile-rhythm"]'], ["pause", '[data-act="tile-pause"]']].forEach(function (pair) {
      var el = document.querySelector('${CBL} ' + pair[1]);
      if (!el) { out[pair[0]] = null; return; }
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var hit = document.elementFromPoint(cx, cy);
      out[pair[0]] = {
        inside: r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        aboveTabs: r.bottom <= tabTop + 1,
        hit: !!(hit && (hit === el || el.contains(hit)))
      };
    });
    return out;
  })();`);
  for (const k of ["shock", "epi", "rhythm", "pause"]) {
    ok(!!(prio && prio[k] && prio[k].inside && prio[k].aboveTabs), tag + ": priority " + k + " fully in viewport above tab bar " + JSON.stringify(prio && prio[k]));
    ok(!!(prio && prio[k] && prio[k].hit), tag + ": priority " + k + " centre is tappable (elementFromPoint)");
  }
  const noScroll = await ev(`return document.documentElement.scrollHeight <= window.innerHeight + 1;`);
  ok(noScroll === true, tag + ": page does not scroll (scrollHeight <= innerHeight)");
  const clockFit = await ev(`return (function () { var t = document.querySelector('${CBL} .cbl-ringtime'); var c = document.querySelector('${CBL} .cbl-ringcard'); if (!t || !c) return false; return t.scrollWidth <= c.clientWidth + 1 && t.getBoundingClientRect().right <= c.getBoundingClientRect().right + 1; })();`);
  ok(clockFit === true, tag + ": clock fits inside its card");
  const w = await ev(`return window.innerWidth;`);
  if (w >= 820) {
    const allVis = await ev(`return Array.from(document.querySelectorAll('${CBL} .cbl-tile, ${CBL} .cbl-drug')).every(function (el) { var r = el.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1; });`);
    ok(allVis === true, tag + ": all tiles visible without scrolling");
  }
  const overlap2 = await ev(`return (function () {
    // The rect a user can actually touch: the element's box clipped by every scrolling or overflow-hidden ancestor.
    function clipped(el) {
      var r = el.getBoundingClientRect(), L = r.left, T = r.top, R = r.right, B = r.bottom;
      for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        var ps = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(ps.overflowX + ps.overflowY)) {
          var pr = p.getBoundingClientRect();
          L = Math.max(L, pr.left); T = Math.max(T, pr.top); R = Math.min(R, pr.right); B = Math.min(B, pr.bottom);
        }
      }
      return R - L > 0 && B - T > 0 ? { left: L, top: T, right: R, bottom: B } : null;
    }
    var els = Array.from(document.querySelectorAll('${CBL} .cbl-priority > *, ${CBL} .cbl-secgrid > *, ${CBL} .cbl-tab, ${CBL} .cbl-endbtn')).filter(function (el) { var cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && clipped(el) !== null; });
    var bad = [];
    for (var i = 0; i < els.length; i++) for (var j = i + 1; j < els.length; j++) {
      var a = clipped(els[i]), b = clipped(els[j]);
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push((els[i].getAttribute("data-kind") || els[i].textContent.trim().slice(0, 8)) + "/" + (els[j].getAttribute("data-kind") || els[j].textContent.trim().slice(0, 8)));
    }
    return bad;
  })();`);
  ok(Array.isArray(overlap2) && overlap2.length === 0, tag + ": no overlapping interactive rects (" + (overlap2 || []).join("|") + ")");
}

async function contrast(tag) {
  const ratios = await ev(`return (function () {
    function lum(r, g, b) {
      var f = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(fg, bg) {
      function p(s) { var m = s.match(/\\d+(\\.\\d+)?/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]]; }
      var a = p(fg), b = p(bg), l1 = lum(a[0], a[1], a[2]), l2 = lum(b[0], b[1], b[2]);
      if (l1 < l2) { var t = l1; l1 = l2; l2 = t; }
      return (l1 + 0.05) / (l2 + 0.05);
    }
    var out = {};
    [["due", "${CBL} .cbl-dueword"], ["tile", "${CBL} .cbl-tilelabel"], ["muted", "${CBL} .cbl-tilesub"]].forEach(function (pair) {
      var el = document.querySelector(pair[1]);
      if (!el) { out[pair[0]] = 0; return; }
      var cs = getComputedStyle(el), bg = cs.backgroundColor, n = el;
      while ((!bg || bg === "rgba(0, 0, 0, 0)") && n.parentElement) { n = n.parentElement; bg = getComputedStyle(n).backgroundColor; }
      out[pair[0]] = Math.round(ratio(cs.color, bg) * 100) / 100;
    });
    return out;
  })();`);
  for (const k of ["due", "tile"]) {
    ok(ratios && ratios[k] >= 4.5, tag + ": contrast " + k + " >= 4.5 (" + (ratios && ratios[k]) + ")");
  }
  ok(ratios && ratios.muted >= 3, tag + ": contrast muted >= 3 (" + (ratios && ratios.muted) + ")");
}

async function visualAudit(tag) {
  await ev(`try { document.fonts.load('250 96px "Inter CodeBlue"'); document.fonts.load('600 16px "Inter CodeBlue"'); } catch (e) {} return 1;`);
  const fontOk = await until(`try { return document.fonts.check('250 96px "Inter CodeBlue"'); } catch (e) { return false; }`, 8000);
  ok(fontOk === true, tag + ": Inter CodeBlue font loaded (document.fonts.check)");
  const clock = await ev(`var el = document.querySelector('${CBL} .cbl-ringtime'); if (!el) return null; var cs = getComputedStyle(el); return { fam: cs.fontFamily, num: cs.fontVariantNumeric, ls: cs.letterSpacing, fs: parseFloat(cs.fontSize) };`);
  ok(!!clock && /Inter CodeBlue/.test(clock.fam), tag + ": clock is Inter (" + (clock && clock.fam) + ")");
  ok(!!clock && /tabular/.test(clock.num), tag + ": clock is tabular (" + (clock && clock.num) + ")");
  const thick = await ev(`return Array.from(document.querySelectorAll('${CBL} *')).filter(function (el) { var cs = getComputedStyle(el); return parseFloat(cs.borderLeftWidth) > 1 && cs.borderLeftStyle !== 'none'; }).length;`);
  ok(thick === 0, tag + ": no thick coloured border-left (thick=" + thick + ")");
  const blue = await ev(`return Array.from(document.querySelectorAll('${CBL} *')).filter(function (el) { var cs = getComputedStyle(el); var bg = cs.backgroundColor; return /rgb\(59, 130, 246\)|rgb\(37, 99, 235\)|rgb\(29, 78, 216\)/.test(bg); }).length;`);
  ok(typeof blue === "number" && blue <= 4, tag + ": filled-blue elements at most 4 (blue=" + blue + ")");
}

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.confirm=function(){return true;}; window.prompt=function(dflt){return "Edited label";};` });
  await call("Page.navigate", { url: BASE + "test/fixtures/codeblue-live-harness.html" });
  ok(await until(`return !!(window.CodeBlueLive && window.CodeBlueAudio && window.CodeBlueSheet);`, 30000), "harness loads live, audio and sheet modules");

  await ev(`try{localStorage.clear();}catch(e){} return 1;`);
  await ev(`CodeBlueLive.open(); return 1;`);
  ok(await until(viewIs("idle"), 5000), "idle: mode picker opens");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="idle"]');`) === true, "idle state renders");
  ok(await ev(`return document.querySelector('${CBL} .cbl-disc').textContent.indexOf("Not a substitute") >= 0;`) === true, "disclaimer on entry");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-modepick').length === 3;`) === true, "three mode chips");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="audio-blocked"]');`) === true, "audio-blocked notice before Start");
  await shot("idle", false); await shot("idle", true);

  await click(`${CBL} [data-act="start"]`);
  ok(await until(viewIs("running"), 5000), "start: clock runs");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="running"] .cbl-elapsed');`) === true, "clock block renders");
  ok(await ev(`return document.querySelector('${CBL} .cbl-due').getAttribute("data-level") === "running";`) === true, "due strip reads CPR in progress");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-tile').length === 6;`) === true, "6 action tiles, Epinephrine only in the drug row");
  ok(await ev(`return !document.querySelector('${CBL} [data-act="tile-epi"]');`) === true, "no Epinephrine action tile");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="strip"]');`) === true, "status strip renders");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-strip .cbl-cell').length === 5;`) === true, "strip has CODE, RHYTHM, EPI, SHOCK, VENT cells");
  ok(await ev(`return !!document.querySelector('${CBL} svg.cbl-ring');`) === true, "CPR ring renders");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="vent"]');`) === true, "vent panel renders");
  ok(await ev(`return document.querySelector('${CBL} [data-act="vent-cue"]').textContent === "Cue on";`) === true, "vent cue on by default");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-drug').length === 3;`) === true, "3 drug buttons");
  ok(await ev(`return document.querySelector('${CBL} [data-drug="epi"] .cbl-drugdose').textContent.indexOf("1 mg") >= 0;`) === true, "adult epi dose text");
  ok(await ev(`return document.querySelector('${CBL} [data-drug="amio"] .cbl-drugdose').textContent.indexOf("300 mg") >= 0;`) === true, "adult amiodarone dose text");
  ok(await ev(`return document.querySelector('${CBL} [data-drug="lido"] .cbl-drugdose').textContent.indexOf("mg/kg") >= 0;`) === true, "adult lidocaine dose text");
  ok(await ev(`return !document.querySelector('${CBL} [data-state="counts"]');`) === true, "no counter pills; counts live on the buttons");
  ok(await ev(`return document.querySelector('${CBL} [data-drug="amio"] .cbl-drugsub').textContent.trim() === "" && document.querySelector('${CBL} [data-drug="amio"] .cbl-drugdose').textContent.indexOf("300 mg") >= 0;`) === true, "drug tiles show only the dose text until logged");
  ok(await ev(`return document.querySelectorAll('${CBL} [data-state="tabs"] [role="tab"]').length === 4;`) === true, "Timer, Log, Notes, Settings tabs");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="timeline"]');`) === true, "live timeline renders");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-guide li').length >= 3;`) === true, "guide prompts render with sources");
  ok(await ev(`return Array.from(document.querySelectorAll('${CBL} .cbl-gsrc')).every(function (e) { return e.textContent.length > 5; });`) === true, "every prompt cites a source");
  await shot("running", false); await shot("running", true);
  await metrics("running-390"); await contrast("running-390-dark"); await visualAudit("running-390");
  await layoutAudit("running-390", "phone"); await shellAudit("running-390");
  await ev(`document.body.classList.add("dark"); return 1;`); await sleep(200); await shellAudit("running-390-dark");
  await ev(`document.body.classList.remove("dark"); return 1;`); await sleep(200);

  /* Tabs keep the status strip visible; each tab shell renders. */
  await click(`${CBL} [data-act="tab-log"]`);
  ok(await until(`return CodeBlueLive._rt.tab() === "log";`, 5000), "log tab opens");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="strip"]');`) === true, "strip stays above the Log tab");
  ok(await ev(`return !!document.querySelector('${CBL} [data-tabpanel="log"] [data-state="empty-log"]');`) === true, "log tab shows the empty state");
  await click(`${CBL} [data-act="tab-notes"]`);
  ok(await until(`return CodeBlueLive._rt.tab() === "notes";`, 5000), "notes tab opens");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="strip"]');`) === true, "strip stays above the Notes tab");
  ok(await ev(`return !!document.querySelector('${CBL} #cblNoteTab');`) === true, "notes composer renders");
  ok(await ev(`return document.querySelectorAll('${CBL} [data-act="notes-algo"]').length === 4;`) === true, "notes algorithm tabs render");
  ok(await ev(`return document.querySelectorAll('${CBL} [data-state="reference-grid"] .cbl-refcard').length === 8;`) === true, "notes reference grid renders 8 cards");
  for (const algo of ["brady", "tachy", "postrosc", "arrest"]) {
    await click(`${CBL} [data-act="notes-algo"][data-algo="${algo}"]`);
    ok(await until(`return CodeBlueLive._rt.notesAlgo() === "${algo}";`, 5000), "algorithm tab " + algo + " opens");
    await shot("notes-" + algo, false); await shot("notes-" + algo, true);
  }
  await shot("notes-grid", false); await shot("notes-grid", true);
  for (const [w, h, tag] of [[820, 1180, "820"], [1194, 834, "1194"]]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await sleep(300); await shot("notes-grid-" + tag, true);
    await click(`${CBL} [data-act="tab-settings"]`);
    await shot("settings-root-" + tag, true);
    await click(`${CBL} [data-act="tab-notes"]`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  await ev(`document.querySelector('${CBL} #cblNoteTab').value = "Tab note"; document.querySelector('${CBL} [data-act="note-add"]').click(); return 1;`);
  ok(await until(`return CodeBlueLive._rt.session().events.some(function (e) { return e.kind === "note" && e.label === "Tab note"; });`, 5000), "note added from the Notes tab");
  await click(`${CBL} [data-act="tab-settings"]`);
  ok(await until(`return CodeBlueLive._rt.tab() === "settings";`, 5000), "settings tab opens");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="strip"]');`) === true, "strip stays above the Settings tab");
  ok(await ev(`return !!document.querySelector('${CBL} [data-tabpanel="settings"] [data-state="patient-link"]');`) === true, "settings reuses the patient link row");
  ok(await ev(`return !!document.querySelector('${CBL} [data-settings-search]');`) === true, "settings search renders");
  ok(await ev(`return document.querySelectorAll('${CBL} [data-state="quick-toggles"] .cbl-toggle').length === 4;`) === true, "settings quick toggles render");
  await ev(`CodeBlueLive._rt.setSettingsQuery("compression"); return 1;`);
  ok(await until(`return !!document.querySelector('${CBL} [data-state="settings-results"]');`, 5000), "settings search results render");
  await shot("settings-search", false); await shot("settings-search", true);
  await ev(`CodeBlueLive._rt.setSettingsQuery(""); CodeBlueLive._rt.setSettingsGroup("Rhythm check"); return 1;`);
  ok(await until(`return !!document.querySelector('${CBL} [data-settings-detail="Rhythm check"]');`, 5000), "settings detail pane renders");
  await shot("settings-detail", false); await shot("settings-detail", true);
  await ev(`CodeBlueLive._rt.setSettingsGroup(null); return 1;`);
  await shot("settings-root", false); await shot("settings-root", true);
  await click(`${CBL} [data-act="tab-timer"]`);
  ok(await until(`return CodeBlueLive._rt.tab() === "timer";`, 5000), "back to the Timer tab");

  /* cb4-F: Log segments (Log, Team and scene, Past codes), filters, manual entry. */
  await click(`${CBL} [data-act="tab-log"]`);
  ok(await until(`return CodeBlueLive._rt.tab() === "log";`, 5000), "log tab reopens for segments");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-segbtn').length === 3;`) === true, "three log segments render");
  await click(`${CBL} [data-act="log-manual-toggle"]`);
  ok(await ev(`return !!document.querySelector('${CBL} [data-act="log-add-manual"]');`) === true, "manual entry renders behind disclosure");
  await ev(`document.querySelector('${CBL} #cblManualLabel').value = "Missed shock"; document.querySelector('${CBL} #cblManualTime').value = "1:00"; document.querySelector('${CBL} #cblManualKind').value = "shock"; document.querySelector('${CBL} [data-act="log-add-manual"]').click(); return 1;`);
  ok(await until(`return CodeBlueLive._rt.session().events.some(function (e) { return e.label === "Missed shock" && e.elapsed === 60; });`, 5000), "manual missed event added at its time");
  ok(await ev(`return CodeBlueLive._engine.computeCounts(CodeBlueLive._rt.session().events).shocks >= 1;`) === true, "counts recomputed after manual entry");
  await click(`${CBL} [data-act="log-filter"][data-f="drugs"]`);
  ok(await ev(`return !!document.querySelector('${CBL} [data-f="drugs"].on');`) === true, "filter chip selects Drugs");
  await shot("logtab", false); await shot("logtab", true);
  await click(`${CBL} [data-seg="team"]`);
  ok(await until(`return !!document.querySelector('${CBL} [data-state="team-scene"]');`, 5000), "team and scene segment renders");
  ok(await ev(`return !!document.querySelector('${CBL} #cblScene-location');`) === true, "scene location field renders");
  await shot("team", false); await shot("team", true);
  await click(`${CBL} [data-seg="past"]`);
  ok(await until(`return !!document.querySelector('${CBL} [data-state="past-empty"], ${CBL} [data-state="past-list"]');`, 5000), "past codes segment renders");
  await shot("past-empty", false); await shot("past-empty", true);
  await click(`${CBL} [data-seg="log"]`);
  await click(`${CBL} [data-act="tab-timer"]`);

  /* Timeline drawer opens on phone from the slim handle; drug buttons log with undo. */
  ok(await ev(`return !!document.querySelector('${CBL} .cbl-tlhandle[data-act="timeline-toggle"]');`) === true, "timeline opens from the slim handle, not a loose button");
  await click(`${CBL} [data-act="timeline-toggle"]`);
  ok(await ev(`return document.querySelector('${CBL} [data-state="timeline"]').classList.contains("open");`) === true, "timeline drawer opens on phone");
  await click(`${CBL} [data-act="timeline-toggle"]`);
  await click(`${CBL} [data-act="drug-amio"]`);
  ok(await until(`return CodeBlueLive._rt.session().events.some(function (e) { return e.label === "Amiodarone"; });`, 5000), "amiodarone logs with undo toast");
  ok(await ev(`return document.querySelector('${CBL} [data-drug="amio"] .cbl-drugsub').textContent.indexOf("1 given") >= 0;`) === true, "amiodarone count lives on its button");
  await click(`${CBL} [data-act="drug-lido"]`);
  ok(await until(`return CodeBlueLive._rt.session().events.some(function (e) { return e.label === "Lidocaine"; });`, 5000), "lidocaine logs");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="toast"].on');`) === true, "one-tap drug has a 5 s undo toast");

  await click(`${CBL} [data-act="tile-pause"]`);
  ok(await until(`return document.querySelector('${CBL} .cbl-due').getAttribute("data-level") === "paused";`, 5000), "paused: strip shows Paused with word");
  await shot("paused", true);
  await click(`${CBL} [data-act="tile-pause"]`);
  ok(await until(`return document.querySelector('${CBL} .cbl-due').getAttribute("data-level") === "running";`, 5000), "resume from pause");

  await ev(`CodeBlueLive._rt.setElapsed(120); return 1;`);
  ok(await until(`return document.querySelector('${CBL} .cbl-duetext').textContent === "Rhythm check due";`, 5000), "rhythm check due at 120 s");
  await shot("rhythm-due", false);
  await click(`${CBL} [data-act="tile-rhythm"]`);
  ok(await until(`return !!document.querySelector('${CBL} .cbl-sheet');`, 5000), "rhythm picker sheet opens");
  ok(await ev(`return document.querySelectorAll('${CBL} [data-act="rhythm-pick"]').length === 7;`) === true, "7 fixed rhythm labels");
  await ev(`Array.from(document.querySelectorAll('${CBL} [data-act="rhythm-pick"]')).filter(function (b) { return b.textContent === "VF"; })[0].click(); return 1;`);
  ok(await until(`return document.querySelector('${CBL} .cbl-duetext').textContent === "Shock";`, 5000), "shockable rhythm advises Shock");
  await shot("shock", true);

  await click(`${CBL} [data-act="tile-shock"]`);
  ok(await until(`return CodeBlueLive._rt.session().events.some(function (e) { return e.kind === "shock"; });`, 5000), "shock logs with undo toast");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="toast"].on');`) === true, "undo toast appears");
  await click(`${CBL} [data-act="sheet-log"]`);
  ok(await until(`return !!document.querySelector('${CBL} [data-sheet="log"] .cbl-log');`, 5000), "log sheet lists events");
  await ev(`document.querySelector('${CBL} [data-act="sheet-close"]').click(); return 1;`);

  await click(`${CBL} [data-act="drug-epi"]`);
  /* Epinephrine timing runs from the logged dose, not from code start, so
   * measure offsets from the dose. Reset the rhythm cycle first so the
   * rhythm strip does not cover the epinephrine states. */
  const epiAt = await ev(`return CodeBlueLive._rt.session().events.filter(function (e) { return e.kind === "drug"; }).pop().elapsed;`);
  await ev(`CodeBlueLive._rt.setElapsed(${epiAt} + 70); return 1;`);
  await click(`${CBL} [data-act="tile-rhythm"]`);
  await ev(`Array.from(document.querySelectorAll('${CBL} [data-act="rhythm-pick"]')).filter(function (b) { return b.textContent === "PEA"; })[0].click(); return 1;`);
  await ev(`CodeBlueLive._rt.setElapsed(${epiAt} + 182); return 1;`);
  ok(await until(`return document.querySelector('${CBL} .cbl-duetext').textContent === "Epinephrine due";`, 5000), "epinephrine due after 180 s");
  await shot("epi-due", false);
  await ev(`CodeBlueLive._rt.setElapsed(${epiAt} + 192); return 1;`);
  await click(`${CBL} [data-act="tile-rhythm"]`);
  await ev(`Array.from(document.querySelectorAll('${CBL} [data-act="rhythm-pick"]')).filter(function (b) { return b.textContent === "PEA"; })[0].click(); return 1;`);
  await ev(`CodeBlueLive._rt.setElapsed(${epiAt} + 302); return 1;`);
  ok(await until(`return document.querySelector('${CBL} .cbl-duetext').textContent === "Epinephrine overdue";`, 5000), "epinephrine overdue after 300 s");
  ok(await ev(`return document.querySelector('${CBL} .cbl-dueword').textContent === "Overdue";`) === true, "overdue word present, colour never alone");
  ok(await ev(`return document.querySelector('${CBL} .cbl-due').classList.contains("cbl-due-overdue");`) === true, "overdue strip restyles the border, colour never alone");
  await shot("epi-overdue", true);

  await click(`${CBL} [data-act="tile-rosc"]`);
  ok(await until(`return document.querySelector('${CBL} .cbl-duetext').textContent === "ROSC";`, 5000), "ROSC strip");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="checklist-open"]');`) === true, "Checklist footer appears at ROSC");
  ok(await ev(`return !!document.querySelector('${CBL} [data-act="tile-rearrest"]');`) === true, "Re-arrest replaces Pause");
  await click(`${CBL} [data-act="sheet-checks"]`);
  ok(await until(`return !!document.querySelector('${CBL} [data-state="checklist"]');`, 5000), "post-ROSC checklist opens");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-check').length === 9;`) === true, "9 adult checklist items");
  await ev(`document.querySelector('${CBL} .cbl-check').click(); return 1;`);
  ok(await until(`return CodeBlueLive._rt.session().events.some(function (e) { return e.kind === "note" && e.label.indexOf("Checklist:") === 0; });`, 5000), "checklist tick logs a note");
  await shot("checklist", false);
  await ev(`document.querySelector('${CBL} [data-act="sheet-close"]').click(); return 1;`);

  await click(`${CBL} [data-act="tile-rearrest"]`);
  ok(await until(`return document.querySelector('${CBL} .cbl-due').getAttribute("data-level") !== "rosc";`, 5000), "re-arrest restarts CPR");
  ok(await ev(`return CodeBlueLive._rt.session().events.some(function (e) { return e.kind === "reArrest"; });`) === true, "reArrest event logged");
  await shot("rearrest", true);

  await click(`${CBL} [data-act="tile-proc"]`);
  ok(await until(`return document.querySelectorAll('${CBL} [data-act="proc-pick"]').length === 7;`, 5000), "procedures sheet with fixed vocabulary");
  await shot("procedures", false);
  await ev(`document.querySelector('${CBL} [data-act="sheet-close"]').click(); return 1;`);

  await click(`${CBL} [data-act="audio"]`);
  ok(await until(`return document.querySelectorAll('${CBL} [data-act="mute"]').length === 3;`, 5000), "sound sheet has Voice, Metronome, Breaths mutes");
  await ev(`document.querySelectorAll('${CBL} [data-act="mute"]')[0].click(); return 1;`);
  ok(await ev(`return document.querySelectorAll('${CBL} [data-act="mute"]')[0].getAttribute("aria-pressed") === "false";`) === true, "voice mute toggles independently");
  await ev(`document.querySelector('${CBL} [data-act="sheet-close"]').click(); return 1;`);

  await click(`${CBL} [data-act="sheet-log"]`);
  await ev(`var b=document.querySelector('${CBL} [data-act="log-edit"]'); if(b) b.click(); return 1;`);
  ok(await until(`return CodeBlueLive._rt.session().events.some(function (e) { return e.edited === true; });`, 5000), "log edit marks edited");
  const nBefore = await ev(`return CodeBlueLive._rt.session().events.length;`);
  await ev(`var b=document.querySelector('${CBL} [data-act="log-del"]'); if(b) b.click(); return 1;`);
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="toast"].on');`) === true, "delete offers undo");
  await ev(`var b=document.querySelector('${CBL} [data-act="toast-undo"]'); if(b) b.click(); return 1;`);
  ok(await until(`return CodeBlueLive._rt.session().events.length === ${JSON.stringify(nBefore)};`, 5000), "undo restores the deleted event");
  await ev(`document.querySelector('${CBL} [data-act="sheet-close"]').click(); return 1;`);

  await click(`${CBL} [data-act="end"]`);
  ok(await until(viewIs("ended"), 5000), "end shows the summary (confirmed)");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="ended"]');`) === true, "ended summary renders");
  ok(await ev(`return document.querySelector('${CBL} [data-state="ended"]').textContent.indexOf("Estimated CPR fraction") >= 0;`) === true, "debrief shows estimated CPR fraction");
  await shot("ended", false);
  await shot("debrief", false); await shot("debrief", true);
  await click(`${CBL} [data-act="debrief-past"]`);
  ok(await until(`return !!document.querySelector('${CBL} [data-state="past-list"], ${CBL} [data-state="past-empty"]');`, 5000), "debrief past codes renders");
  await shot("past-filled", false); await shot("past-filled", true);
  await click(`${CBL} [data-act="debrief-past"]`);
  await click(`${CBL} [data-act="open-sheet"]`);
  ok(await until(`return !!document.querySelector(".cb-sheet-ov, .cb-sheet");`, 8000), "End opens the code sheet payload");
  await ev(`CodeBlueLive.close(); try{localStorage.clear();}catch(e){} return 1;`);

  /* Empty log on a fresh code. */
  await ev(`CodeBlueLive.open(); return 1;`);
  await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
  ok(await until(viewIs("running"), 5000), "second code starts");
  await click(`${CBL} [data-act="sheet-log"]`);
  ok(await until(`return !!document.querySelector('${CBL} [data-state="empty-log"]');`, 5000), "empty log state");
  await shot("empty-log", true);
  await ev(`document.querySelector('${CBL} [data-act="sheet-close"]').click(); return 1;`);

  /* Resume prompt from the saved snapshot. */
  await click(`${CBL} [data-act="tile-shock"]`);
  ok(await ev(`return !!localStorage.getItem("smd.cbl.v1");`) === true, "snapshot saved on event");
  await ev(`CodeBlueLive.close(); CodeBlueLive.open(); return 1;`);
  ok(await until(`return !!document.querySelector('${CBL} [data-state="resume-prompt"]') && ${viewIs("idle").slice(7)}`, 8000), "resume prompt offers Resume and Discard");
  await shot("resume", false);
  await click(`${CBL} [data-act="resume-yes"]`);
  ok(await until(viewIs("running"), 5000), "resume continues the code");

  /* Storage-full error state. */
  await ev(`window.__realSetItem = localStorage.setItem.bind(localStorage); localStorage.setItem = function () { throw new Error("full"); }; return 1;`);
  await click(`${CBL} [data-act="tile-shock"]`);
  ok(await until(`return !!document.querySelector('${CBL} [data-state="error"]');`, 5000), "storage-full error shows");
  await shot("error", true);
  await ev(`localStorage.setItem = window.__realSetItem; return 1;`);

  /* Training mode: badged, sped-up, never touches the sheet. */
  await ev(`CodeBlueLive.close(); try{localStorage.clear();}catch(e){} CodeBlueLive.open({ training: true }); return 1;`);
  await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('${CBL} .cbl-badge') && CodeBlueLive._rt.session().training === true;`, 5000), "training badge and flag");
  await ev(`CodeBlueLive._rt.setElapsed(5); return 1;`);
  ok(await ev(`return localStorage.getItem("smd.cbl.v1") === null;`) === true, "training never writes snapshots");
  await click(`${CBL} [data-act="end"]`);
  ok(await until(viewIs("ended"), 5000), "training ends");
  ok(await ev(`return !document.querySelector('${CBL} [data-act="open-sheet"]');`) === true, "training never offers the code sheet");
  await shot("training", true);
  await ev(`CodeBlueLive.close(); return 1;`);

  /* 360 px, light: layout holds. */
  await call("Emulation.setDeviceMetricsOverride", { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
  await ev(`CodeBlueLive.open(); return 1;`);
  await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
  ok(await until(viewIs("running"), 5000), "running at 360 px");
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await sleep(300);
  await metrics("running-360-light"); await contrast("running-360-light");
  await layoutAudit("running-360", "phone"); await shellAudit("running-360");
  await shot("running-360", false);
  await click(`${CBL} [data-act="sheet-log"]`);
  ok(await until(`return !!document.querySelector('${CBL} .cbl-sheet');`, 5000), "sheet opens at 360 px");
  await shot("log-360", false);
  await ev(`CodeBlueLive.close(); try{localStorage.clear();}catch(e){} return 1;`);

  /* Paediatric: no dose lines anywhere. */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev(`CodeBlueLive.open(); return 1;`);
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="patient-link"]');`) === true, "idle shows the patient link row");
  ok(await ev(`return document.querySelector('${CBL} [data-state="patient-link"]').textContent.indexOf("No patient linked") >= 0;`) === true, "unlinked run says it stays on device");
  await ev(`document.querySelector('${CBL} [data-act="idle-mode"][data-mode="paediatric"]').click(); return 1;`);
  await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
  ok(await until(viewIs("running"), 5000), "paediatric code starts");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-drugdose').length === 0;`) === true, "paediatric drug buttons show no doses");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-drug').length === 1;`) === true, "paediatric runs Epinephrine only");
  ok(await ev(`return !!document.querySelector('${CBL} [data-drug="epi"] .cbl-drugsub');`) === true, "paediatric keeps the last-given line");
  await click(`${CBL} [data-act="end"]`);
  ok(await until(viewIs("ended"), 5000), "paediatric code ends");
  console.log("DIAG unlinked-end: " + JSON.stringify(await ev(`return (function () { var ended = document.querySelector('${CBL} [data-state="ended"]'); var sess = null, err = null; try { sess = CodeBlueLive._rt.session(); } catch (e) { err = String(e && e.message || e); } return { endedText: ended ? ended.textContent.trim().slice(0, 300) : null, training: sess ? sess.training : null, link: sess ? sess.link : null, exportState: (function () { try { return CodeBlueLive._rt.exportState(); } catch (e2) { return String(e2); } })(), err: err }; })();`)));
  ok(await ev(`return document.querySelector('${CBL} [data-state="ended"]').textContent.indexOf("Kept on this device only") >= 0;`) === true, "unlinked end says kept on device");
  await ev(`CodeBlueLive.close(); try{localStorage.clear();}catch(e){} return 1;`);

  /* LIVE with a linked patient: End writes the code sheet to the timeline. */
  await ev(`window.__tlWrites = []; window.SMD_ICU_GROUPS = { currentOpenPatient: function () { return { gid: "g1", pid: "p1" }; }, addTimelineEvent: function (g, p, e) { window.__tlWrites.push({ g: g, p: p, e: e }); } }; return 1;`);
  await ev(`CodeBlueLive.open(); return 1;`);
  ok(await ev(`return document.querySelector('${CBL} [data-state="patient-link"]').textContent.indexOf("Linked to patient record") >= 0;`) === true, "idle picks up the open ICU patient");
  await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
  ok(await until(viewIs("running"), 5000), "linked code starts");
  ok(await ev(`return !!(CodeBlueLive._rt.link() && CodeBlueLive._rt.link().gid === "g1");`) === true, "link captured at Start");
  await click(`${CBL} [data-act="tile-shock"]`);
  await click(`${CBL} [data-act="end"]`);
  ok(await until(viewIs("ended"), 5000), "linked code ends");
  console.log("DIAG linked-end: " + JSON.stringify(await ev(`return (function () { var ended = document.querySelector('${CBL} [data-state="ended"]'); var sess = null, err = null; try { sess = CodeBlueLive._rt.session(); } catch (e) { err = String(e && e.message || e); } var writes = null; try { writes = window.__tlWrites ? window.__tlWrites.length : "no __tlWrites"; } catch (e3) { writes = "read error: " + String(e3 && e3.message || e3); } var first = null; try { first = window.__tlWrites && window.__tlWrites[0] ? window.__tlWrites[0].e : null; } catch (e4) { first = "read error: " + String(e4 && e4.message || e4); } return { endedText: ended ? ended.textContent.trim().slice(0, 300) : null, tlWrites: writes, firstEvent: first, training: sess ? sess.training : null, link: sess ? sess.link : null, exportState: (function () { try { return CodeBlueLive._rt.exportState(); } catch (e2) { return String(e2); } })(), err: err }; })();`)));
  ok(await until(`return window.__tlWrites.length === 1;`, 5000), "code sheet written to the patient timeline");
  ok(await ev(`return window.__tlWrites[0].e.type === "codeblue" && window.__tlWrites[0].e.title === "Code Blue summary";`) === true, "timeline event matches the watch export shape");
  ok(await ev(`return document.querySelector('${CBL} [data-state="ended"]').textContent.indexOf("Written to the linked patient timeline") >= 0;`) === true, "ended state confirms the timeline write");
  ok(await ev(`return !!document.querySelector(".cb-sheet-ov, .cb-sheet");`) === true, "linked end opens the code sheet");
  await ev(`var o = document.querySelector(".cb-sheet-ov"); if (o) o.remove(); CodeBlueLive.close(); try{localStorage.clear();}catch(e){} delete window.SMD_ICU_GROUPS; return 1;`);

  /* iPad: 820x1180 portrait, three zones, timeline as a right column. */
  await call("Emulation.setDeviceMetricsOverride", { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true });
  await ev(`CodeBlueLive.open(); return 1;`);
  await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
  ok(await until(viewIs("running"), 5000), "running at 820x1180");
  ok(await ev(`return getComputedStyle(document.querySelector('${CBL} .cbl-timeline')).position === "static";`) === true, "iPad portrait: timeline is a right column");
  ok(await ev(`return getComputedStyle(document.querySelector('${CBL} .cbl-actions')).gridTemplateColumns.split(" ").length === 4;`) === true, "iPad portrait: 4 column action grid");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="strip"]');`) === true, "iPad portrait: strip visible");
  await click(`${CBL} [data-act="tab-log"]`);
  ok(await until(`return CodeBlueLive._rt.tab() === "log";`, 5000), "iPad portrait: log tab opens");
  ok(await ev(`return !!document.querySelector('${CBL} [data-state="strip"]');`) === true, "iPad portrait: strip stays above the Log tab");
  await click(`${CBL} [data-act="tab-timer"]`);
  await metrics("running-820"); await contrast("running-820-dark"); await visualAudit("running-820");
  await layoutAudit("running-820", "ipad"); await shellAudit("running-820");
  await shot("running-820", false); await shot("running-820", true);

  /* iPad: 1194x834 landscape. */
  await call("Emulation.setDeviceMetricsOverride", { width: 1194, height: 834, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await until(viewIs("running"), 5000), "running at 1194x834");
  ok(await ev(`return getComputedStyle(document.querySelector('${CBL} .cbl-timeline')).position === "static";`) === true, "iPad landscape: timeline is a right column");
  ok(await ev(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`) === true, "iPad landscape: no horizontal scroll");
  await metrics("running-1194"); await visualAudit("running-1194");
  await layoutAudit("running-1194", "ipad"); await shellAudit("running-1194");
  await ev(`document.body.classList.add("dark"); return 1;`); await sleep(200); await shellAudit("running-1194-dark");
  await ev(`document.body.classList.remove("dark"); return 1;`); await sleep(200);
  await shot("running-1194", false); await shot("running-1194", true);

  /* iPad: 1366x1024 landscape. */
  await call("Emulation.setDeviceMetricsOverride", { width: 1366, height: 1024, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await until(viewIs("running"), 5000), "running at 1366x1024");
  ok(await ev(`return getComputedStyle(document.querySelector('${CBL} .cbl-timeline')).position === "static";`) === true, "1366: timeline is a right column");
  await metrics("running-1366");
  await layoutAudit("running-1366", "ipad"); await shellAudit("running-1366");
  await shot("running-1366", true);
  await ev(`CodeBlueLive.close(); try{localStorage.clear();}catch(e){} return 1;`);

  console.log(fails === 0 ? "ALL UI CHECKS PASSED" : fails + " UI CHECKS FAILED");
  try { chrome.kill(); } catch {}
  if (serveProc) { try { serveProc.kill(); } catch {} }
  process.exit(fails === 0 ? 0 : 1);
} catch (err) {
  console.log("FATAL " + (err && err.stack || err));
  try { chrome.kill(); } catch {}
  if (serveProc) { try { serveProc.kill(); } catch {} }
  process.exit(2);
}
