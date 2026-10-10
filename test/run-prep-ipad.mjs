/* PrepNucleus on iPad sizes (headless Chrome over CDP, touch emulation, deviceScaleFactor 1), against the fixture banks.
 * What must hold at each size (plan PrepNucleus-iPad-Confetti-MaikLines.md section 1.4):
 *  1. no horizontal overflow (document, root and body scrollWidth against clientWidth; both are window px here);
 *  2. reading screens keep the 720 px column (screen px = 720 x zoom); tabs and filters share the column's left edge;
 *  3. home: the Practise list is one column, two inside its card from 700 CSS px; subjects are tiles (prep50): 1 a row
 *     under 360 CSS px, 2 on a phone, 3 from 700, 4 from 1000 CSS px, each at least 150 px wide; the module list goes 2 a row from a 900 px window;
 *  4. from 820 px every sheet (setup, plan, Arena consent) is a centred panel no wider than 600 px, inside the window,
 *     its last button visible without scrolling the page;
 *  5. landscape lesson: the figure sits beside the text and ends above the bar; the bar's controls sit in the 720 column;
 *  6. .pn-ib, .pn-chip, .pn-tab, .pn-opt at least 44 screen px tall at every size;
 *  7. real keydown events: A answers, B bookmarks once answered, Enter goes on, Escape closes a sheet first then backs
 *     out; in a lesson ArrowRight and ArrowLeft move a step and Space plays the narration;
 *  8. the app zoom follows a resize (boot at 1180, set 507: the zoom recomputes); a split pane on an iPad never zooms
 *     below 1.0.
 * USAGE: CHROME=<path> node test/run-prep-ipad.mjs
 *   SIZES=820x1180,1180x820 (default: the 7 iPad sizes) SHOTS=<dir> saves light and dark PNGs per screen and size.
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/", LFIX = "/test/fixtures/prep-lessons/", MID = "sur-breast-cancer";
const SIZES = (process.env.SIZES || "820x1180,1180x820,1366x1024,507x820,438x820,375x1180,320x820").split(",").map((s) => { const [w, h] = s.split("x").map(Number); return { w, h }; });
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
// A real keydown on the focused element inside PrepNucleus (the root's listener and document listeners both see it).
const key = (k) => ev(`var r=document.getElementById("smdPrep"), t=document.activeElement; if(!r||!r.contains(t)) t=r; var e=new KeyboardEvent("keydown",{key:${JSON.stringify(k)},bubbles:true,cancelable:true}); t.dispatchEvent(e); return e.defaultPrevented;`);

/* Geometry in screen px. The app zooms the document (home.js autoFitD); getBoundingClientRect may report layout or
   zoomed px depending on the engine, so K converts with the fixed root, which always spans the window. */
const GEO = `var Z=parseFloat(document.documentElement.style.zoom)||1, RT=document.getElementById("smdPrep"), RR=RT.getBoundingClientRect(), K=innerWidth/RR.width;
  function R(el){ var b=el.getBoundingClientRect(); return { l:(b.left-RR.left)*K, r:(b.right-RR.left)*K, t:(b.top-RR.top)*K, b:(b.bottom-RR.top)*K, w:b.width*K, h:b.height*K }; }`;
const geo = (body) => ev(GEO + body);
// 6 holds on iPad sizes; a 390 px phone run (SIZES=390x844, screenshots) shows the phone's own 0.95 zoom, out of scope.
const SMALL = `if(innerWidth===390&&screen.width===390) return ""; var bad=[]; RT.querySelectorAll(".pn-ib, .pn-chip, .pn-tab, .pn-opt").forEach(function(el){ var b=R(el); if(b.w===0&&b.h===0) return; if(b.h<43.5||(el.classList.contains("pn-ib")&&b.w<43.5)) bad.push((el.getAttribute("data-act")||el.className)+":"+b.w.toFixed(1)+"x"+b.h.toFixed(1)); }); return bad.join(", ");`;
// scrollWidth and clientWidth share units whatever the zoom (this Chrome reports both in window px), so compare them.
const OVER = `var de=document.documentElement, b=RT.querySelector(".pn-body"), o=[]; if(de.scrollWidth>de.clientWidth+1) o.push("document "+de.scrollWidth+">"+de.clientWidth); if(RT.scrollWidth>RT.clientWidth+1) o.push("root "+RT.scrollWidth+">"+RT.clientWidth); if(b&&b.scrollWidth>b.clientWidth+1) o.push("body "+b.scrollWidth+">"+b.clientWidth); return o.join(", ");`;
const COLS = (sel) => `var g=document.querySelector(${JSON.stringify(sel)}); return g ? getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length : -1;`;
// A sheet: centred, no wider than 600 px, inside the window, its last button on screen.
const SHEET = (sel) => GEO + `var s=RT.querySelector(${JSON.stringify(sel)}); if(!s) return "no sheet"; var b=R(s), mw=parseFloat(getComputedStyle(s).maxWidth), bt=s.querySelectorAll("button"), last=bt[bt.length-1], lb=last?R(last):null, p=[];
  if(Math.abs(b.l-(innerWidth-b.r))>=2) p.push("off centre "+b.l.toFixed(1)+"/"+(innerWidth-b.r).toFixed(1)); if(!(mw<=600)) p.push("max-width "+mw); if(b.w>600*Z+1) p.push("width "+b.w.toFixed(0));
  if(b.b>innerHeight+1||b.t<-1) p.push("outside "+b.t.toFixed(0)+".."+b.b.toFixed(0)+" of "+innerHeight); if(!lb||lb.b>Math.min(innerHeight,b.b)+1||lb.t<b.t-1) p.push("last button hidden"+(lb?" "+lb.t.toFixed(0)+".."+lb.b.toFixed(0):"")); return p.join(", ");`;

const shot = async (tag, name) => {
  if (!SHOTS) return;
  for (const theme of ["light", "dark"]) {
    await ev(`if (!document.getElementById("pnNoTr")) { var t=document.createElement("style"); t.id="pnNoTr"; t.textContent="*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.toggle("dark", ${theme === "dark"}); return 1;`);
    await sleep(160);
    await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
    const r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) writeFileSync(join(SHOTS, `ipad-${tag}-${name}-${theme}.png`), Buffer.from(r.result.data, "base64"));
  }
};

// The device: a touch screen; split panes (narrow windows) sit on an iPad screen, phones on their own.
const metrics = async ({ w, h }) => {
  const phone = w === 390, wide = w >= 820;
  const screen = phone || wide ? { screenWidth: w, screenHeight: h } : h >= 1000 ? { screenWidth: 820, screenHeight: 1180 } : { screenWidth: 1180, screenHeight: 820 };
  await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true, ...screen });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
};
const zoomFor = (w) => w < 600 ? 1 : w < 900 ? 1.08 : 1.15;   // autoFitD at DPR 1 (the 0.9 and 0.95 steps never on an iPad)

// Arena and social calls answered in the browser: not joined yet, so Friends asks consent first.
function api(url, method) {
  if (/\/api\/prep\/arena\/consent/.test(url)) return [200, { joined: false, name: "" }];
  if (/\/api\/prep\/social\//.test(url)) return [403, { error: "consent-required" }];
  return [404, { error: "nope" }];
}

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      const rq = m.params.request, [code, body] = api(rq.url, rq.method);
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: code, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/prep/arena/*" }, { urlPattern: "*/api/prep/social/*" }] });
  // Fixture banks (?lsn=1 for the lesson fixture), a speechSynthesis stub, a signed-in student for the consent sheet.
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `(function(){ var L=/[?&]lsn=1/.test(location.search), F=L?${JSON.stringify(LFIX)}:${JSON.stringify(FIX)};
    window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; if(!L) window.SMD_PREP_BASE=F; window.SMD_PREP_BANK_API=F+"api/"; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")};
    window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; window.toast=function(m){(window.__toasts=window.__toasts||[]).push(m);};
    window.SMD_AUTH={currentUser:{uid:"u1",displayName:"Asha Rao",email:"asha@example.com",getIdToken:function(){return Promise.resolve("tok");},getIdTokenResult:function(){return Promise.resolve({token:"tok",claims:{}});}}};
    window.__tts=[]; window.SpeechSynthesisUtterance=function(t){this.text=t;this.rate=1;this.lang="";};
    Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{speaking:false,speak:function(u){window.__tts.push(u.text);this.speaking=true;},cancel:function(){this.speaking=false;}}});
  })();` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const boot = async (q) => {
    await call("Page.navigate", { url: BASE + "?prep=1&tour=0" + (q || "") });
    await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  };
  // fresh device state once: PrepNucleus on, Arena off (the consent sheet comes from Friends), auto fit on
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  const reset = `try{["smd_prep_v1","smd_prep_setup","smd_display_v1"].forEach(function(k){localStorage.removeItem(k);}); localStorage.setItem("smd_prep","1"); localStorage.setItem("smd_prep_arena","0"); localStorage.setItem("smd_onboarding_tour","0");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`;
  await ev(reset);

  for (const S of SIZES) {
    const tag = (S.w > S.h ? "l" : "p") + S.w, Z = zoomFor(S.w), land = S.w > S.h && S.w >= 900, at = ` @${S.w}x${S.h}`;
    console.log(`\n---- ${S.w}x${S.h}`);
    await metrics(S);
    await ev(reset);
    await boot();

    // 8. zoom at boot (a split pane on an iPad keeps 1.0)
    const z0 = await ev(`return parseFloat(document.documentElement.style.zoom)||1;`);
    if (S.w !== 390) ok(Math.abs(z0 - Z) < 0.001, "8. auto fit zoom " + z0 + " (want " + Z + ")" + at);

    // ---- home
    await ev(`PREP.open(); return 1;`);
    ok(await until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy]") && /MCQs/.test(document.querySelector("#smdPrep .pn-tile[data-s=anatomy]").textContent);`, 20000), "home opens" + at);
    await sleep(400);
    ok(await geo(OVER) === "", "1. home: no horizontal overflow " + (await geo(OVER)) + at);
    const al = await geo(`var t=RT.querySelector(".pn-home > .pn-next + .pn-group"), c=RT.querySelector("#pnGrid"); var a=R(t), b=R(c); return Math.abs(a.l-b.l).toFixed(1)+"|"+Math.abs(a.r-b.r).toFixed(1);`);
    ok(+al.split("|")[0] <= 1 && +al.split("|")[1] <= 1, "2. home: the Practise group shares the column's edges (left|right off by " + al + ")" + at);
    // Quiet home (2026-10-10): Practise is one list, two columns inside its card from 700 CSS px; subjects are rows, a
    // grid of row cards (each at least 300 px) from 700 CSS px.
    const wide = await ev(`return matchMedia("(min-width: 700px)").matches;`);
    const subs = await ev(COLS("#smdPrep #pnGrid")), grp = await ev(COLS("#smdPrep .pn-home > .pn-next + .pn-group"));
    const tileW = await ev(`return Math.round(document.querySelector("#smdPrep #pnGrid > .pn-tile").getBoundingClientRect().width / (parseFloat(document.documentElement.style.zoom)||1));`);
    // Tide pass (prep50): subjects are tiles, 1 a row under 360 CSS px, 2 on a phone, 3 from 700, 4 from 1000; never under 150 px.
    const cssW = await ev(`return Math.round(innerWidth / (parseFloat(document.documentElement.style.zoom)||1));`), wantSubs = cssW < 360 ? 1 : cssW < 700 ? 2 : cssW < 1000 ? 3 : 4;
    ok(grp === (wide ? 2 : 1) && subs === wantSubs && tileW >= 150, `3. home: Practise ${wide ? 2 : 1} a row (${grp}), subject tiles ${subs} a row (want ${wantSubs}) at ${tileW} px` + at);
    ok(await geo(SMALL) === "", "6. home: 44 px targets " + (await geo(SMALL)) + at);
    await shot(tag, "home");
    if (SHOTS) { await ev(`var h=document.querySelector("#smdPrep .pn-home"), p=h.querySelectorAll(".pn-h"); for (var i=0;i<p.length;i++) if (/Practise/.test(p[i].textContent)) { h.scrollTop += p[i].getBoundingClientRect().top - h.getBoundingClientRect().top - 8; } return 1;`); await shot(tag, "home-tiles"); await ev(`document.querySelector("#smdPrep .pn-home").scrollTop = 0; return 1;`); }

    // ---- plan sheet (readiness: How this is computed)
    if (await ev(`return !!document.querySelector("#smdPrep .pl-hero");`)) {
      await click("#smdPrep .pl-hero");
      ok(await until(`return !!document.querySelector("#pnPlanSheet .pl-sheet");`, 3000), "readiness sheet opens" + at);
      await sleep(400);
      if (S.w >= 820) ok(await ev(SHEET("#pnPlanSheet .pl-sheet")) === "", "4. plan sheet is a centred panel " + (await ev(SHEET("#pnPlanSheet .pl-sheet"))) + at);
      else ok(await geo(`var s=R(RT.querySelector("#pnPlanSheet .pl-sheet")); return s.b >= innerHeight-2 && s.w >= innerWidth-2;`) === true, "4. under 700 px the plan sheet stays a bottom sheet" + at);
      await shot(tag, "plan-sheet");
      await key("Escape");
      ok(await until(`return !document.querySelector("#pnPlanSheet .pl-sheet") && !!document.querySelector("#smdPrep #pnHome");`, 2000), "7. Escape closes the plan sheet and stays home" + at);
    }

    // ---- subject
    await click("#smdPrep .pn-tile[data-s=anatomy]");
    ok(await until(`return document.querySelectorAll("#smdPrep .pn-mod[data-act=module]").length === 3;`, 10000), "subject lists its modules" + at);
    await sleep(400);
    ok(await geo(OVER) === "", "1. subject: no horizontal overflow " + (await geo(OVER)) + at);
    const fl = await geo(`var f=RT.querySelector(".pn-filters"), c=RT.querySelector("#pnSub > *"), cs=getComputedStyle(f), pl=parseFloat(cs.paddingLeft)*K*Z/K; var a=R(f), b=R(c); return Math.abs(a.l+parseFloat(cs.paddingLeft)*Z-b.l).toFixed(1);`);
    ok(+fl <= 1, "2. subject: filter chips start at the column's left edge (off by " + fl + ")" + at);
    const mc = await ev(COLS("#smdPrep #pnSub .pn-mods"));
    ok(S.w >= 900 ? mc === 2 : mc <= 1, "3. module list: " + (S.w >= 900 ? "2 a row" : "one a row") + " (" + mc + ")" + at);
    ok(await geo(SMALL) === "", "6. subject: 44 px targets " + (await geo(SMALL)) + at);
    await shot(tag, "subject");

    // ---- setup sheet over the subject; Escape closes it first, then backs out to home
    if (await ev(`return !!document.querySelector('#smdPrep [data-act=su-subject]');`)) {
      await click("#smdPrep [data-act=su-subject]");
      ok(await until(`return !!document.querySelector("#pnSetup .su-sheet") && !document.querySelector("#pnSetup .pn-load");`, 8000), "the setup sheet opens" + at);
      await sleep(450);
      if (S.w >= 820) ok(await ev(SHEET("#pnSetup .su-sheet")) === "", "4. setup sheet is a centred panel with Start in view " + (await ev(SHEET("#pnSetup .su-sheet"))) + at);
      else ok(await geo(`var s=R(RT.querySelector("#pnSetup .su-sheet")); return s.b >= innerHeight-2 && s.w >= innerWidth-2;`) === true, "4. under 700 px the setup sheet stays a bottom sheet" + at);
      if (S.w >= 820) ok(await ev(`var a=document.querySelector("#pnSetup .su-sheet").getAnimations(); return a.every(function(x){ var k=x.effect.getKeyframes(); return !k.some(function(f){ return /translateY\\(100%\\)/.test(f.transform||""); }); });`) === true, "the centred sheet does not slide up from the bottom" + at);
      ok(await geo(SMALL) === "", "6. setup sheet: 44 px targets " + (await geo(SMALL)) + at);
      await shot(tag, "setup-sheet");
      await key("Escape");
      ok(await until(`return !document.querySelector("#pnSetup .su-sheet") && !!document.querySelector("#smdPrep #pnSub");`, 2000), "7. Escape closes the sheet first and stays on the subject" + at);
    }
    await key("Escape");
    ok(await until(`return !!document.querySelector("#smdPrep #pnHome");`, 2000), "7. a second Escape backs out to home" + at);

    // ---- module and the runner (practice through the setup sheet's Start)
    await click("#smdPrep .pn-tile[data-s=anatomy]");
    await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 8000);
    await click("#smdPrep .pn-mod[data-m=ana-gametogenesis]");
    ok(await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000), "module screen" + at);
    await sleep(300);
    ok(await geo(OVER) === "", "1. module: no horizontal overflow " + (await geo(OVER)) + at);
    await shot(tag, "module");
    await click("#smdPrep [data-act=start][data-k=study]");
    if (await until(`return !!document.querySelector("#pnSetup [data-act=su-go]") && !document.querySelector("#pnSetup .pn-load");`, 5000)) await click("#pnSetup [data-act=su-go]");
    ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000), "practice starts" + at);
    await sleep(400);
    ok(await geo(OVER) === "", "1. runner: no horizontal overflow " + (await geo(OVER)) + at);
    if (land) {
      const two = await geo(`var q=R(RT.querySelector(".pn-q")), f=R(RT.querySelector(".pn-qw > :first-child")), o=R(RT.querySelector(".pn-opts")); return q.r <= o.l + 1 && Math.abs(f.t-o.t) < 4 ? "" : "stem "+q.l.toFixed(0)+".."+q.r.toFixed(0)+" options "+o.l.toFixed(0)+".."+o.r.toFixed(0);`);
      ok(two === "", "D5. landscape runner: the stem left, the options right " + two + at);
    } else {
      const col = await geo(`var w=R(RT.querySelector(".pn-qw")).w; return w <= 720*Z+1 ? "" : w.toFixed(1)+" > "+(720*Z).toFixed(1);`);
      ok(col === "", "2. runner: the question keeps the 720 px column " + col + at);
    }
    ok(await geo(SMALL) === "", "6. runner: 44 px targets " + (await geo(SMALL)) + at);
    await shot(tag, "runner-question");
    ok(await key("a") === true && await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 2000), "7. key A answers" + at);
    await sleep(300);
    ok(await geo(OVER) === "", "1. feedback: no horizontal overflow " + (await geo(OVER)) + at);
    if (land) ok(await geo(`var f=R(RT.querySelector(".pn-fb")), q=R(RT.querySelector(".pn-q")); return f.l >= q.r - 1;`) === true, "D5. landscape: the feedback sits in the answer column" + at);
    await shot(tag, "runner-feedback");
    const bm0 = await ev(`var b=document.querySelector("#smdPrep [data-act=bookmark]"); return b ? b.getAttribute("aria-pressed") : "none";`);
    await key("b");
    ok(await until(`var b=document.querySelector("#smdPrep [data-act=bookmark]"); return !!b && b.getAttribute("aria-pressed") !== ${JSON.stringify(bm0)};`, 1500), "7. key B bookmarks an answered question" + at);
    await ev(`var f=document.querySelector("#smdPrep .pn-fb"); if (f) f.focus(); return 1;`);
    ok(await key("Enter") === true && await until(`return /Question 2 of/.test(document.querySelector("#smdPrep .pn-t p").textContent);`, 2000), "7. Enter goes to the next question" + at);
    await ev(`PREP.close(); return 1;`);

    // ---- stats (My stats: level, streaks, calendar)
    await ev(`PREP.open(); return 1;`);
    if (await until(`return !!document.querySelector("#smdPrep [data-act=a-stats]");`, 6000)) {
      await click("#smdPrep [data-act=a-stats]");
      await until(`return !!document.querySelector("#smdPrep .pn-heat");`, 6000);
      await sleep(400);
      ok(await geo(OVER) === "", "1. stats: no horizontal overflow " + (await geo(OVER)) + at);
      await shot(tag, "stats");
    }
    await ev(`PREP.close(); return 1;`);

    // ---- Arena consent sheet (Friends asks consent first)
    await ev(`if(!window.PrepSocial){var l=document.createElement("link"); l.rel="stylesheet"; l.href="/prep-social.css"; document.head.appendChild(l); var s=document.createElement("script"); s.src="/prep-social.js"; document.head.appendChild(s);} return 1;`);
    if (await until(`return !!(window.PrepSocial && PrepSocial.open);`, 6000)) {
      await ev(`window.SMD_AUTH={currentUser:{uid:"u1",displayName:"Asha Rao",email:"asha@example.com",getIdToken:function(){return Promise.resolve("tok");},getIdTokenResult:function(){return Promise.resolve({token:"tok",claims:{}});}}}; PrepSocial.open("friends"); return 1;`);
      if (await until(`return !!document.querySelector("#smdPrep .pn-sheet [data-act=a-join]");`, 10000)) {
        await sleep(450);
        if (S.w >= 820) ok(await ev(SHEET(".pn-sheet")) === "", "4. Arena consent is a centred panel with Join in view " + (await ev(SHEET(".pn-sheet"))) + at);
        await shot(tag, "social-consent");
      } else ok(false, "the Arena consent sheet opens (toasts: " + (await ev(`return (window.__toasts||[]).join(" | ");`)) + ")" + at);
      await ev(`PREP.close(); return 1;`);
    }

    // ---- lesson reader (lesson fixture): the table step, then the image step by ArrowRight
    await boot("&lsn=1");
    await ev(`PREP.open({ subject: "surgery" }); return 1;`);
    if (await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=${MID}]');`, 20000)) {
      await click(`#smdPrep .pn-mod[data-m=${MID}]`);
      await until(`return !!document.querySelector("#smdPrep [data-act=l-open]");`, 8000);
      await click("#smdPrep [data-act=l-open]");
      ok(await until(`return !!document.querySelector("#smdPrep .pn-vtbl") && /Step 1 of/.test(document.querySelector("#smdPrep .pn-t p").textContent);`, 8000), "lesson opens on the table step" + at);
      await sleep(400);
      ok(await geo(OVER) === "", "1. lesson: no horizontal overflow " + (await geo(OVER)) + at);
      const barCol = await geo(`var bar=R(RT.querySelector(".pn-lsn-bar")), bin=RT.querySelector(".pn-lsn-bin"); if(!bin) return "no inner"; var b=R(bin); return b.w <= 720*Z+1 && Math.abs(b.l-(innerWidth-b.r))<2 && bar.w >= innerWidth-1 ? "" : "bar "+bar.w.toFixed(0)+" inner "+b.l.toFixed(0)+".."+b.r.toFixed(0);`);
      ok(barCol === "", "5. the bar's controls sit in the 720 column, the shelf spans the window " + barCol + at);
      ok(await geo(SMALL) === "", "6. lesson: 44 px targets " + (await geo(SMALL)) + at);
      await shot(tag, "lesson-table");
      await ev(`document.querySelector("#smdPrep .pn-lsn-step").focus(); return 1;`);
      for (let i = 0; i < 4; i++) { await key("ArrowRight"); await sleep(120); }
      ok(await until(`return /Step 5 of/.test(document.querySelector("#smdPrep .pn-t p").textContent);`, 2000), "7. ArrowRight moves a step (now step 5)" + at);
      await key("ArrowLeft"); await sleep(120);
      ok(await until(`return /Step 4 of/.test(document.querySelector("#smdPrep .pn-t p").textContent);`, 2000), "7. ArrowLeft goes back a step" + at);
      await key("ArrowRight");
      ok(await until(`var i=document.querySelector("#smdPrep .pn-vimg img"); return !!i && i.complete && i.naturalWidth>0;`, 5000), "step 5 shows the image" + at);
      await ev(`document.querySelector("#smdPrep .pn-lsn-step").focus(); return 1;`);
      await key(" ");
      ok(await until(`var p=document.querySelector("#smdPrep [data-act=l-play]"); return !!p && p.getAttribute("aria-pressed")==="true";`, 2000), "7. Space plays the narration" + at);
      await key(" ");
      await sleep(300);
      if (land) {
        const fig = await geo(`var f=R(RT.querySelector(".pn-lsn-step > .pn-vis-image")), x=R(RT.querySelector(".pn-lsn-tx")), bar=R(RT.querySelector(".pn-lsn-bar")); return f.b <= bar.t + 1 && f.l >= x.r - 1 ? "" : "figure "+f.l.toFixed(0)+","+f.t.toFixed(0)+".."+f.b.toFixed(0)+" text right "+x.r.toFixed(0)+" bar top "+bar.t.toFixed(0);`);
        ok(fig === "", "5. landscape lesson: the figure beside the text, above the bar " + fig + at);
      }
      await shot(tag, "lesson-image");
      await ev(`PREP.close(); return 1;`);
    } else ok(false, "the lesson fixture's module lists" + at);

    // 8. resize: boot at 1180 wide, then a 507 split pane recomputes the zoom (and back)
    if (S.w === 1180) {
      await metrics({ w: 507, h: 820 });
      ok(await until(`return Math.abs((parseFloat(document.documentElement.style.zoom)||1) - 1) < 0.001;`, 3000), "8. resize 1180 to 507: zoom recomputes to 1 (was " + z0 + ")");
      await metrics(S);
      ok(await until(`return Math.abs((parseFloat(document.documentElement.style.zoom)||1) - 1.15) < 0.001;`, 3000), "8. and back to 1.15 at 1180");
      await ev(`var s=JSON.parse(localStorage.getItem("smd_display_v1")||"{}"); s.autoFit=false; s.fontScale=1.3; localStorage.setItem("smd_display_v1", JSON.stringify(s)); return 1;`);
      await boot();
      await metrics({ w: 507, h: 820 }); await sleep(600);
      ok(Math.abs(await ev(`return parseFloat(document.documentElement.style.zoom)||1;`) - 1.3) < 0.001, "8. a manual display choice is kept on resize");
      await metrics(S);
    }
  }
  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
