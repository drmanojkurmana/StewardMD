/* PrepNucleus Lessons in the REAL app (headless Chrome over CDP): the shipped sample lesson (prep/lessons/v1/
 * sur-breast-cancer.json) against the real taxonomy and a 4-item fixture bank for its quiz.
 * What must hold: the module screen shows a Lesson row; the reader shows a segmented progress bar, the step text with
 * bold terms and the visual drawn from data (table, flow with arrows and edge labels, compare cards, image); Next, Back
 * and a swipe move between steps; Play speaks the step's narration through speechSynthesis (stubbed), Pause cancels it,
 * the speed cycles and is kept, auto-advance moves on when a step's narration ends; the image enlarges and back()
 * closes it first; leaving the reader stops the voice; Finish shows the XP once (a second pass earns none); the 3 quick
 * questions run through the normal runner and write FSRS cards under the module deck; progress is kept in the store and
 * the lesson in IndexedDB; Ask MaiK shows on the web too (its sheet offers Online); no request reaches /api/ai and no
 * uncaught PrepNucleus error.
 *
 * USAGE: node test/run-prep-lessons-ui.mjs   (CHROME=<path>; SHOTS=<dir> saves screenshots, PN_LIGHT=1 in light)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const LOADER_V = (await import("node:fs")).readFileSync(new URL("../prep-loader.js", import.meta.url), "utf8").match(/var V = "([^"]+)"/)[1];
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-lsn-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep-lessons/";
const MID = "sur-breast-cancer";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Screenshots land on the final frame: after 150 ms (Motion starts its animations on the next frame), finite animations
// (entrances, ring draw) are finished; loops keep running.
const shotCall = async (p) => { await sleep(150); await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(320);
  const r = await shotCall({ format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "lesson-" + (process.env.PN_LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const step = () => ev(`var p=document.querySelector("#smdPrep .pn-t p"); return p ? p.textContent : "";`);
const store = (expr) => ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return ${expr};`);

// speechSynthesis stub: records every utterance and cancel, and ends an utterance after 1.5 s (the time it "speaks").
const TTS_STUB = `
  window.__tts = []; window.__ttsCancel = 0;
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.rate = 1; this.lang = ""; };
  var cur = null;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speaking: false,
    speak: function (u) { cur = u; window.__tts.push({ text: u.text, rate: u.rate, lang: u.lang }); this.speaking = true; var self = this;
      setTimeout(function () { if (cur === u) { self.speaking = false; cur = null; if (u.onend) u.onend({}); } }, 1500); },
    cancel: function () { window.__ttsCancel++; cur = null; this.speaking = false; } } });`;

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` + TTS_STUB });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  if (process.env.PN_LIGHT) await ev(`if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.remove("dark"); return 1;`); else await ev(`document.body.classList.add("dark"); return 1;`);

  // ---- module screen: the Lesson row
  await ev(`PREP.open({ subject: "surgery" }); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=${MID}]');`, 20000), "Surgery lists the breast cancer module");
  ok(await ev(`return !!window.PREP_LESSONS;`) === true, "prep-loader.js loads prep-lessons.js");
  await click(`#smdPrep .pn-mod[data-m=${MID}]`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=l-open]");`, 8000), "the module screen shows a Lesson row");
  ok(/8 steps, then 3 quick questions/.test(await ev(`return document.querySelector("#smdPrep [data-act=l-open]").textContent;`)), "the row says the steps and the quiz");
  ok(await ev(`return !document.querySelector('#smdPrep .pn-mod[data-m=sur-breast-benign]');`) === true, "only the module screen with a lesson gets the row");
  await shot("module");

  // ---- reader: step 1 (table)
  await click("#smdPrep [data-act=l-open]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-lsn-tx");`, 8000), "Lesson opens the reader");
  ok(await step() === "Step 1 of 8", "bar reads Step 1 of 8");
  ok(await ev(`var i=document.querySelectorAll("#smdPrep .pn-lsn-prog i"); return i.length===8 && document.querySelectorAll("#smdPrep .pn-lsn-prog i.on").length===1;`) === true, "segmented progress: 8 segments, 1 filled");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-lsn-tx b").length >= 3 && !/\\*\\*/.test(document.querySelector("#smdPrep .pn-lsn-tx").textContent);`) === true, "bold key terms drawn, no ** left");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-vtbl tbody tr").length===5 && document.querySelectorAll("#smdPrep .pn-vtbl thead th").length===2;`) === true, "the table is real HTML: 2 columns, 5 rows");
  ok(await ev(`return !!document.querySelector("#smdPrep [data-act=l-prev]").disabled;`) === true, "Previous is disabled on the first step");
  ok(await ev(`return !!document.querySelector("#smdPrep [data-act=l-ask]");`) === true, "Ask MaiK shows on the web too (owner 2026-10-09: the sheet says where it works)");
  await ev(`document.querySelector("#smdPrep [data-act=l-ask]").click(); return 1;`);
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w && !!w.querySelector(".pa-opts") && /works in the StewardMD app/.test(w.textContent);`, 5000), "Ask MaiK on a step opens the choice sheet, saying on-phone MaiK is in the app");
  await ev(`document.querySelector("#pnAsk .pn-scrim").click(); return 1;`);
  ok(await until(`return !document.getElementById("pnAsk") && !!document.querySelector("#smdPrep #pnLsn");`, 3000), "the sheet closes back to the step");
  ok(await ev(`var a=document.querySelector("#smdPrep .pn-lsn-bar").getBoundingClientRect(); return a.bottom <= innerHeight + 1 && a.height >= 60;`) === true, "the bottom bar sits on screen");
  const sw = await ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.right>innerWidth+1 && !e.closest(".pn-vtbl")) o.push(e.className||e.tagName); }); return o.slice(0,5).join("|");`);
  ok(sw === "", "nothing wider than the 390 px screen (tables scroll inside their card)" + (sw ? ": " + sw : ""));
  ok(await store(`s.ls["${MID}"].i === 0 && s.ls["${MID}"].n === 8`) === true, "lesson progress is in the store");
  await shot("step1-table");

  // ---- step 2 (flow) by Next
  await click("#smdPrep [data-act=l-next]");
  ok(await step() === "Step 2 of 8", "Next goes to step 2");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-fn").length===6 && document.querySelectorAll("#smdPrep .pn-fl-ah").length===5 && document.querySelectorAll("#smdPrep .pn-fl-gap line").length===5;`) === true, "flow: 6 nodes, 5 arrows, 5 connectors");
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep .pn-fl-lb")).map(function(x){return x.textContent;}).join(",")==="breast,axilla";`) === true, "flow edge labels drawn");
  ok(await ev(`var r=document.querySelectorAll("#smdPrep .pn-fl-row"); return r.length===5 && r[3].children.length===2;`) === true, "flow laid out in levels (biopsy and axilla side by side)");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-flow + .pn-sr li").length===5;`) === true, "flow has a screen-reader list");
  await shot("step2-flow");

  // ---- narration
  await click("#smdPrep [data-act=l-play]");
  ok(await until(`return window.__tts.length===1;`, 3000), "Play speaks");
  ok(await ev(`var u=window.__tts[0]; return /^A suspicious lump goes through triple assessment/.test(u.text) && u.rate===1 && u.lang==="en-IN";`) === true, "it speaks the step's narration at 1x, en-IN");
  ok(await ev(`var b=document.querySelector("#smdPrep [data-act=l-play]"); return b.getAttribute("aria-pressed")==="true" && b.getAttribute("aria-label")==="Pause narration";`) === true, "Play becomes Pause");
  ok(await ev(`var w=document.querySelectorAll("#smdPrep .pn-lsn-play.on .pn-wave i"); return w.length===5 && getComputedStyle(w[0]).animationName==="pn-wave";`) === true, "the Play pill's waveform moves while the voice speaks");
  ok(await ev(`var i=document.querySelectorAll("#smdPrep .pn-lsn-prog i"); return i[1].classList.contains("cur") && i[0].classList.contains("on") && !i[0].classList.contains("cur") && i[1].getBoundingClientRect().width > i[0].getBoundingClientRect().width * 2;`) === true, "step dots: the current step is the lit pill");
  await shot("step2-playing");
  await click("#smdPrep [data-act=l-speed]");
  ok(await ev(`return document.querySelector("#smdPrep [data-act=l-speed]").textContent;`) === "1.25x", "speed cycles to 1.25x");
  ok(await until(`return window.__tts.length===2 && window.__tts[1].rate===1.25;`, 2000), "a speed change while playing restarts the step at the new rate");
  ok(await store(`s.lsp.r`) === 1.25, "the speed is kept in the store");
  ok(await until(`return document.querySelector("#smdPrep [data-act=l-play]").getAttribute("aria-pressed")==="false";`, 4000) && await step() === "Step 2 of 8", "without auto-advance the narration ends on the same step and Play resets");
  await click("#smdPrep [data-act=l-auto]");
  ok(await store(`s.lsp.au`) === 1, "auto-advance turns on and is kept");
  await click("#smdPrep [data-act=l-play]");
  ok(await until(`return /Step 3 of 8/.test(document.querySelector("#smdPrep .pn-t p").textContent);`, 5000), "auto-advance moves to step 3 when the narration ends");
  ok(await until(`var u=window.__tts[window.__tts.length-1]; return /^Most invasive breast cancers are ductal/.test(u.text);`, 2000), "and speaks step 3");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-cmp-c").length===2 && document.querySelectorAll("#smdPrep .pn-cmp-c li").length===7;`) === true, "compare cards drawn (step 3)");
  const c0 = await ev(`return window.__ttsCancel;`);
  await click("#smdPrep [data-act=l-play]");
  ok(await ev(`return window.__ttsCancel;`) > c0 && await ev(`return document.querySelector("#smdPrep [data-act=l-play]").getAttribute("aria-pressed");`) === "false", "Pause cancels the speech");
  await click("#smdPrep [data-act=l-auto]");
  await shot("step3-compare");

  // ---- swipe and Back
  await ev(`var el=document.getElementById("pnLsn"), r=el.getBoundingClientRect(), y=r.top+120;
    el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:320,clientY:y,pointerType:"touch",isPrimary:true}));
    el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:150,clientY:y+8,pointerType:"touch",isPrimary:true})); return 1;`);
  ok(await step() === "Step 4 of 8", "a left swipe goes to the next step");
  await ev(`var el=document.getElementById("pnLsn"), r=el.getBoundingClientRect(), y=r.top+120;
    el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:100,clientY:y,pointerType:"touch",isPrimary:true}));
    el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:280,clientY:y,pointerType:"touch",isPrimary:true})); return 1;`);
  ok(await step() === "Step 3 of 8", "a right swipe goes back");
  await click("#smdPrep [data-act=l-prev]");
  ok(await step() === "Step 2 of 8", "Previous goes back a step");
  await click("#smdPrep [data-act=l-next]"); await click("#smdPrep [data-act=l-next]"); await click("#smdPrep [data-act=l-next]");
  ok(await step() === "Step 5 of 8" && await ev(`return document.querySelectorAll("#smdPrep .pn-vtbl").length===0;`) === true, "step 5");
  await shot("step4-table-wide");

  // ---- image and zoom
  await click("#smdPrep [data-act=l-next]"); await click("#smdPrep [data-act=l-prev]");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-vimg img"); return !!i && i.complete && i.naturalWidth>0;`, 5000), "step 5 shows the diagram image (loaded)");
  await shot("step5-image");
  await click("#smdPrep [data-act=l-zoom]");
  // The lesson's enlarged image opens in the shared viewer (prep-viewer.js; gestures in test/run-prep-feel-ui.mjs).
  ok(await until(`var i=document.querySelector(".pv .pv-img"), f=document.querySelector("#smdPrep .pn-vimg img"); return !!(i && f && i.src === f.src);`, 2000), "tap enlarges the image in the shared viewer");
  ok(await ev(`return document.activeElement && document.activeElement.classList.contains("pv-x");`) === true, "focus moves to Close");
  await sleep(300);
  // a two-finger pinch out (60 px to 180 px apart) takes the picture to about 3x
  await ev(`var sc=document.querySelector(".pv-stage"), r=sc.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2, o={bubbles:true,pointerType:"touch"};
    sc.dispatchEvent(new PointerEvent("pointerdown",Object.assign({pointerId:11,clientX:cx-30,clientY:cy},o)));
    sc.dispatchEvent(new PointerEvent("pointerdown",Object.assign({pointerId:12,clientX:cx+30,clientY:cy},o)));
    sc.dispatchEvent(new PointerEvent("pointermove",Object.assign({pointerId:11,clientX:cx-90,clientY:cy},o)));
    sc.dispatchEvent(new PointerEvent("pointermove",Object.assign({pointerId:12,clientX:cx+90,clientY:cy},o)));
    sc.dispatchEvent(new PointerEvent("pointerup",Object.assign({pointerId:11,clientX:cx-90,clientY:cy},o)));
    sc.dispatchEvent(new PointerEvent("pointerup",Object.assign({pointerId:12,clientX:cx+90,clientY:cy},o))); return 1;`);
  ok(await ev(`var s=PREP_VIEWER._state(); return !!s && s.s > 2.5 && s.s <= 5;`) === true, "pinch zooms (1x to 5x)");
  await shot("step5-zoom");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !document.querySelector(".pv") && !document.querySelector("#smdPrep .pn-zoom");`, 2000) && /Step 5 of 8/.test(await ev(`return document.querySelector("#smdPrep .pn-t p").textContent;`)), "back() closes the enlarged image first and stays on the step");

  // ---- leaving stops the voice; progress resumes
  await click("#smdPrep [data-act=l-play]");
  await until(`return document.querySelector("#smdPrep [data-act=l-play]").getAttribute("aria-pressed")==="true";`, 2000);
  const c1 = await ev(`return window.__ttsCancel;`);
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=l-open]");`, 3000) && await ev(`return window.__ttsCancel;`) > c1, "leaving the reader stops the narration");
  ok(/Continue from step 5 of 8/.test(await ev(`return document.querySelector("#smdPrep [data-act=l-open]").textContent;`)), "the Lesson row offers to continue from step 5");
  await click("#smdPrep [data-act=l-open]");
  ok(await until(`return /Step 5 of 8/.test((document.querySelector("#smdPrep .pn-t p")||{}).textContent||"");`, 5000), "reopening resumes at step 5");

  // ---- finish
  for (let i = 0; i < 3; i++) await click("#smdPrep [data-act=l-next]");
  ok(await step() === "Step 8 of 8" && /Finish/.test(await ev(`return document.querySelector("#smdPrep [data-act=l-next]").textContent;`)), "the last step's button says Finish");
  await shot("step8-compare");
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-lsn-fin");`, 3000), "Finish shows the finish screen");
  // The figure counts up from +0 (prep-motion.js), so wait for it to land.
  ok(await until(`return /\\+80/.test(document.querySelector("#smdPrep .pn-lsn-xp").textContent);`, 2500), "first finish earns +80 XP (10 a step)");
  ok(await store(`s.ls["${MID}"].xp === 80 && s.ls["${MID}"].done > 0`) === true, "XP and finish time stored");
  await shot("finish");

  // ---- quiz through the runner
  await click("#smdPrep [data-act=l-quiz]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000), "3 quick questions start in the runner");
  ok(await ev(`return document.querySelector("#smdPrep .pn-t p").textContent;`) === "Question 1 of 3", "three questions");
  for (let i = 0; i < 3; i++) {
    await click('#smdPrep .pn-opt[data-k="1"]');
    await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 2000);
    if (i === 0) await shot("quiz-feedback");
    await click("#smdPrep [data-act=next]");
  }
  ok(await until(`return /Set finished/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 3000), "the set finishes with results");
  ok(await store(`Object.keys(s.cards).filter(function(k){return k.indexOf("p:${MID}:")===0;}).length`) === 3, "3 FSRS cards written under the module deck");
  await click("#smdPrep [data-act=donerun]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-lsn-fin");`, 3000), "Done returns to the lesson's finish screen");

  // ---- read again: no XP twice
  await click("#smdPrep [data-act=l-again]");
  ok(await step() === "Step 1 of 8", "Read again starts at step 1");
  for (let i = 0; i < 8; i++) await click("#smdPrep [data-act=l-next]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-lsn-fin");`, 3000) && !/\+/.test(await ev(`return document.querySelector("#smdPrep .pn-lsn-xp").textContent;`)), "a second finish earns no XP");
  ok(await store(`s.ls["${MID}"].xp`) === 80, "lesson XP stays 80");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return /Finished/.test((document.querySelector("#smdPrep [data-act=l-open]")||{}).textContent||"");`, 3000), "the Lesson row says Finished");

  // ---- offline copy, network, errors
  ok(await evA(`PREP._host.cacheGet("lessons/v1/${MID}.json").then(function(f){ return !!(f && f.steps && f.steps.length===8); })`) === true, "the lesson is kept in IndexedDB for offline");
  ok(reqs.some((u) => u.includes("/prep-lessons.js?v=" + LOADER_V)) && reqs.some((u) => /\/prep\/lessons\/v1\/index\.json/.test(u)), "prep-lessons.js and the lesson index load");
  ok(!reqs.some((u) => /\/api\/(ai|prep\/bank)/.test(u)), "no request to /api/ai or the live bank");
  // ---- generated lesson from the bank API (fixture api/v1/lessons): a module with no bundled lesson gets one
  ok(/8 steps/.test(await ev(`return document.querySelector("#smdPrep [data-act=l-open]") ? "8 steps" : "";`)) && await ev(`return PREP_LESSONS._l.ix.modules["${MID}"].from === "app" && PREP_LESSONS._l.ix.modules["${MID}"].gen === "hand";`) === true, "the hand-written bundled lesson wins over the bank's generated one for the same module");
  await ev(`var d=document.createElement("div"); d.id="genSlot"; document.body.appendChild(d); PREP_LESSONS.mount(d, "surgery", "sur-thyroid", PREP._host); return 1;`);
  ok(await until(`var b=document.querySelector("#genSlot [data-act=l-open]"); return !!b && /steps/.test(b.textContent);`, 5000), "a module with no bundled lesson shows the generated lesson row");
  await ev(`PREP_LESSONS.open("surgery", "sur-thyroid", PREP._host); return 1;`);
  ok(await until(`return /^Step 1 of \\d+$/.test((document.querySelector("#smdPrep .pn-t p")||{}).textContent||"");`, 8000), "the generated lesson opens in the reader");
  ok(reqs.some((u) => u.includes(FIX + "api/v1/lessons/sur-thyroid.json")) && reqs.some((u) => u.includes(FIX + "api/v1/lessons/index.json")), "the generated lesson and index load through the bank API base");
  ok(await evA(`PREP._host.cacheGet("v1/lessons/sur-thyroid.json").then(function(f){ return !!(f && f.module === "sur-thyroid"); })`) === true, "the generated lesson is kept in IndexedDB like bank files");
  await ev(`PREP.close(); return 1;`);
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
