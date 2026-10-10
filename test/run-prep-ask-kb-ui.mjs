/* PrepNucleus Ask MaiK with the on-screen keyboard up, in the REAL app (headless Chrome over CDP) on the fixture bank.
 * Owner 2026-10-10 (iPhone recording, OTA v268): tapping the composer collapsed the sheet to its header row right
 * above the keyboard; the conversation and the text box were under the keyboard and the page showed through the top
 * half. Cause: in the app's WKWebView the overlay's client rect moves with the keyboard pan (rect.top = -offsetTop),
 * and the old onVV put the wrap at visualViewport.offsetTop - rootRect.top, counting the pan twice.
 *
 * Headless Chrome has no iOS keyboard, so the three iOS cases are emulated with a stand-in window.visualViewport:
 *   pan-webkit  layout viewport unchanged, the visual viewport shrinks by the keyboard and is panned down by it, and
 *               client rects move with the pan (what the owner's iPhone did: Element.getBoundingClientRect shifted);
 *   pan-layout  the same pan with client rects fixed to the layout viewport (Chrome / spec behaviour);
 *   resize      the web view itself shrinks (Capacitor Keyboard resize native/body, Android): innerHeight shrinks.
 * each at 390x844, 375x667 and 430x932, with html zoom 0.95 and 1.0 (SMD_ZOOM). The screen the student sees is the
 * layout region [pan, pan + visible height]; every check below is in those screen coordinates:
 *   the sheet is >= 60% of the visible area and ends flush at the keyboard; header and X on screen; the composer (box +
 *   send) fully above the keyboard; the newest message visible; no page showing through (hit tests land in the sheet,
 *   or in its scrim above it); focus stays in the box; dismissing the keyboard restores the full sheet; two rounds.
 * Plus: Online / On this phone switched while typing keeps the layout.
 * USAGE: node test/run-prep-ask-kb-ui.mjs   (CHROME=<binary>, SHOTS=<dir> saves the emulated screens)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-kb-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";
const ONLY = process.env.ONLY || "";

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
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const size = (w, h) => call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true });
if (process.env.SHOTS) mkdirSync(process.env.SHOTS, { recursive: true });
const shot = async (name, y, h, w) => {
  if (!process.env.SHOTS) return;
  await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
  await sleep(120);
  const r = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y, width: w, height: h, scale: 1 } });
  if (r.result) writeFileSync(join(process.env.SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
};
let answer = () => ({ status: 200, body: { text: "The answer is the key, as the stored explanation says.", usage: { mt: 52 }, wallet: { balanceMt: 1900, costCapOn: true } } });

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      const rq = m.params.request; let body = {}; try { body = JSON.parse(rq.postData || "{}"); } catch {}
      const a = answer(body);
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: a.status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(a.body)).toString("base64") });
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await size(390, 844);
  // The stand-in visual viewport is installed before any app script runs, so every listener binds to it.
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;
    (function(){ var f=new EventTarget(); f.width=innerWidth; f.height=innerHeight; f.offsetTop=0; f.offsetLeft=0; f.pageTop=0; f.pageLeft=0; f.scale=1; window.__vv=f; Object.defineProperty(window,"visualViewport",{configurable:true,get:function(){return f;}});
      var g=Element.prototype.getBoundingClientRect; window.__gbcr=function(e){return g.call(e);}; window.__shift=0;
      Element.prototype.getBoundingClientRect=function(){ var r=g.call(this); if(!window.__shift) return r; return new DOMRect(r.x, r.y-window.__shift, r.width, r.height); };
    })();` });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/prep-teach*" }] });
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000);
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); window.SMD_AUTH = { currentUser: { uid: "s1", getIdToken: function () { return Promise.resolve("tok-1"); } } }; return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-home") && !!window.PREP_ASK;`, 20000), "PrepNucleus opens with prep-ask.js");
  await ev(`try{localStorage.removeItem("smd_prep_ask_v1");}catch(e){} PREP_ASK._resetThreads(); var s=PREP._host.store(); s.ask={m:"online",q:1}; PREP._host.save(); return 1;`);
  await ev(`PREP._st.run=null; PREP._st.stack.length=1; PREP._host.home(); return 1;`);
  await click('#smdPrep .pn-tile[data-s=anatomy]'); await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 8000);
  await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]'); await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000);
  await click('#smdPrep [data-act=start][data-k=study]'); await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000);
  await ev(`var r=PREP._st.run, it=r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+((it.a+1)%4)+'"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb [data-act=ask]");`, 4000), "a wrong answer offers Ask MaiK");
  answer = (b) => b.kind !== "chat" ? { status: 200, body: { text: "The answer is the key, as the stored explanation says.", usage: { mt: 41 }, wallet: { balanceMt: 1899, costCapOn: true } } }
    : { status: 200, body: { text: "Think of it like this. You asked: " + b.messages[b.messages.length - 1].t + "\n- the key idea in plain words\n- how it links to this question\n- one line to remember it by", usage: { mt: 40 + b.turn }, wallet: { balanceMt: 1900 - b.turn, costCapOn: true } } };
  const settle = () => until(`return !document.querySelector("#pnAsk .pa-rev") && !document.querySelector('#pnAsk .pt-msg[data-key=typing]');`, 6000);
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.querySelector("#pnAsk .pa-last") && !!document.getElementById("paIn");`, 6000), "Ask MaiK opens with the first answer and the composer");
  await settle();
  for (const q of ["Explain in full why the other options are wrong", "Give me a way to remember it"]) {
    const n = await ev(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length;`);
    await ev(`var t=document.getElementById("paIn"); t.focus(); t.value=${JSON.stringify(q)}; t.dispatchEvent(new Event("input",{bubbles:true})); t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})); t.blur(); return 1;`);
    await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length === ${n + 1};`, 6000); await settle();
  }
  ok(await ev(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length;`) === 3, "a conversation of three answers (enough to scroll)");

  // Geometry in SCREEN coordinates: layout client rect (real, unshifted) minus the pan.
  const geo = (pan, Hv) => ev(`var P=${pan}, Hv=${Hv}, w=document.getElementById("pnAsk"), sh=w.querySelector(".pn-sheet"), b=w.querySelector(".pa-body"), q=function(s){return w.querySelector(s);};
    var R=function(e){ if(!e) return null; var r=window.__gbcr(e); return {t:Math.round(r.top-P), b:Math.round(r.bottom-P), h:Math.round(r.height)}; };
    var l=w.querySelector(".pa-last"), li=l&&l.closest("li"); if(!li){ var ms=w.querySelectorAll(".pa-body .pt-msg"); li=ms[ms.length-1]; }
    var W=innerWidth, hit=function(y){ var e=document.elementFromPoint(W/2, y+P); return !e ? "none" : e.closest(".pn-sheet") ? "sheet" : e.closest("#pnAsk") ? "scrim" : (e.id||e.className||e.tagName).toString().slice(0,40); };
    var s=R(sh), ys=[]; for (var y=2; y<Hv-1; y+=Math.max(8,Math.floor(Hv/24))) ys.push(y); ys.push(Hv-2);
    var hits=ys.map(function(y){ var h=hit(y); return { y: y, h: h, want: y >= s.t + 2 ? "sheet" : "ask" }; }).filter(function(x){ return x.want === "sheet" ? x.h !== "sheet" : (x.h !== "sheet" && x.h !== "scrim"); });
    return JSON.stringify({ sheet: s, top: R(q(".pa-top")), x: R(q(".pa-top [data-act=ak-close]")), cmp: R(q(".pa-cmp")), inp: R(q("#paIn")), send: R(q(".pa-send")), body: R(b), last: R(li), bad: hits.slice(0,4),
      focus: (document.activeElement||{}).id || "", kb: w.classList.contains("pa-kb"), st: w.style.top + "|" + w.style.height, zoom: document.documentElement.style.zoom });`).then(JSON.parse);
  const vis = (r, Hv) => !!r && r.t >= -1 && r.b <= Hv + 1 && r.h > 0;
  const check = (g, Hv, tag) => {
    ok(g.sheet.t >= -1 && g.sheet.b <= Hv + 1 && g.sheet.b >= Hv - 3 && g.sheet.h >= 0.6 * Hv, tag + ": the sheet fills the area above the keyboard (>= 60%, flush at the keyboard): " + JSON.stringify({ Hv, sheet: g.sheet, st: g.st }));
    ok(vis(g.top, Hv) && vis(g.x, Hv) && g.x.h >= 36, tag + ": header and X on screen: " + JSON.stringify({ top: g.top, x: g.x }));
    ok(vis(g.cmp, Hv) && vis(g.inp, Hv) && vis(g.send, Hv) && g.inp.h >= 40, tag + ": the composer (box + send) is fully above the keyboard: " + JSON.stringify({ cmp: g.cmp, inp: g.inp, send: g.send }));
    ok(!!g.last && g.body.h >= 60 && g.last.t >= g.body.t - 1 && g.last.t < g.body.b && (g.last.b <= g.body.b + 1 || g.last.h > g.body.h - 16), tag + ": the conversation shows and the newest message is visible: " + JSON.stringify({ body: g.body, last: g.last }));
    ok(!g.bad.length, tag + ": nothing of the page shows through (hit tests land in the sheet / its scrim): " + JSON.stringify(g.bad));
    ok(g.focus === "paIn", tag + ": the box keeps focus: " + g.focus);
  };
  const full = async (H, tag) => {
    const g = await geo(0, H);
    const side = (await ev(`return innerWidth;`)) >= 700;
    ok(!g.kb && g.st === "|" && (side ? g.sheet.b >= H - 40 && g.sheet.h >= 0.75 * H : g.sheet.b >= H - 1 && g.sheet.h >= 0.8 * H) && vis(g.cmp, H), tag + ": keyboard down, the full sheet is back: " + JSON.stringify({ sheet: g.sheet, st: g.st, kb: g.kb }));
  };

  const SIZES = [[390, 844], [375, 667], [430, 932]], ZOOMS = [0.95, 1], MODES = ["pan-webkit", "pan-layout", "resize"];
  const kbH = (H) => Math.round(H * 0.4) + 44;   // the keyboard plus the iOS form-accessory bar (up/down/check)
  for (const [W, H] of SIZES) for (const z of ZOOMS) for (const mode of MODES) {
    const tag0 = `${W}x${H} zoom ${z} ${mode}`;
    if (ONLY && tag0.indexOf(ONLY) < 0) continue;
    await size(W, H); await sleep(250);
    await ev(`var f=window.__vv; f.width=${W}; f.height=${H}; f.offsetTop=0; window.__shift=0; document.documentElement.style.zoom="${z}"; f.dispatchEvent(new Event("resize")); return 1;`);
    await sleep(150);
    for (let round = 1; round <= 2; round++) {
      const tag = tag0 + " round " + round, K = kbH(H), Hv = H - K, pan = mode === "resize" ? 0 : K;
      // focus first (iOS raises the keyboard after the focus), then the viewport changes in two steps as the keyboard animates
      await ev(`document.getElementById("paIn").focus(); return 1;`);
      if (mode === "resize") { await size(W, Hv); await sleep(120); await ev(`document.documentElement.style.zoom="${z}"; return 1;`); }
      for (const k of [0.5, 1]) {
        const kk = Math.round(K * k);
        await ev(`var f=window.__vv; f.height=${H}-${kk}; f.offsetTop=${mode === "resize" ? 0 : kk}; window.__shift=${mode === "pan-webkit" ? kk : 0}; f.dispatchEvent(new Event("resize")); f.dispatchEvent(new Event("scroll")); return 1;`);
        await sleep(60);
      }
      if (mode === "resize") await ev(`var f=window.__vv; f.height=${Hv}; f.offsetTop=0; f.dispatchEvent(new Event("resize")); return 1;`);
      await sleep(1000);
      check(await geo(pan, Hv), Hv, tag);
      if (round === 1) await shot(`kb-${W}x${H}-z${z}-${mode}`, pan, Hv, W);
      if (round === 2 && W === 390 && z === 1 && mode === "pan-webkit") {
        // switching where MaiK answers while typing keeps the layout
        await click('#pnAsk .pa-bar [data-act=ak-mode][data-v=local]'); await sleep(400);
        await ev(`document.getElementById("paIn") && document.getElementById("paIn").focus(); return 1;`); await sleep(300);
        const g1 = await geo(pan, Hv);
        ok(g1.sheet.b >= Hv - 3 && g1.sheet.h >= 0.6 * Hv && vis(g1.cmp, Hv) && vis(g1.top, Hv), tag + ": switched to On this phone while typing, the sheet keeps its place: " + JSON.stringify({ sheet: g1.sheet, cmp: g1.cmp }));
        await click('#pnAsk .pa-bar [data-act=ak-mode][data-v=online]'); await sleep(400);
        await ev(`document.getElementById("paIn") && document.getElementById("paIn").focus(); return 1;`); await sleep(300);
        const g2 = await geo(pan, Hv);
        ok(g2.sheet.b >= Hv - 3 && vis(g2.cmp, Hv), tag + ": and back to Online: " + JSON.stringify({ sheet: g2.sheet, cmp: g2.cmp }));
      }
      // dismiss (return / tap outside / swipe all end in a blur and the keyboard going down)
      await ev(`document.getElementById("paIn").blur(); var f=window.__vv; f.height=${H}; f.offsetTop=0; window.__shift=0; f.dispatchEvent(new Event("resize")); f.dispatchEvent(new Event("scroll")); return 1;`);
      if (mode === "resize") { await size(W, H); await sleep(120); await ev(`document.documentElement.style.zoom="${z}"; window.__vv.dispatchEvent(new Event("resize")); return 1;`); }
      await sleep(1000);
      await full(H, tag);
    }
  }
  // orientation: a phone turned to landscape with the keyboard up still shows the box and the newest line
  if (!ONLY) {
    await size(844, 390); await sleep(250);
    await ev(`var f=window.__vv; f.width=844; f.height=390; f.offsetTop=0; document.documentElement.style.zoom="1"; document.getElementById("paIn").focus(); f.height=390-170; f.offsetTop=170; window.__shift=170; f.dispatchEvent(new Event("resize")); return 1;`);
    await sleep(1000);
    const gl = await geo(170, 220);
    ok(vis(gl.cmp, 220) && vis(gl.top, 220) && gl.sheet.b >= 209 && gl.body.h >= 40, "844x390 landscape, keyboard up: header, a slice of the conversation and the composer fit: " + JSON.stringify({ sheet: gl.sheet, body: gl.body, cmp: gl.cmp }));
    await shot("kb-844x390-landscape", 170, 220, 844);
    await ev(`document.getElementById("paIn").blur(); var f=window.__vv; f.height=390; f.offsetTop=0; window.__shift=0; f.dispatchEvent(new Event("resize")); return 1;`);
    await sleep(1000);
    await full(390, "844x390 landscape");
  }
  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
  await sleep(300);
  try { if (userDir.indexOf("prep-kb-chrome-") > 0) rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
