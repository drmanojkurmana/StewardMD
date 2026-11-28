/* PrepNucleus Focus (prep-focus.js), headless Chrome over CDP at 390 px.
 * What must hold: with smd_prep_focus on, the Play row opens Focus; mode and duration choices stick; Start shows the
 * running ring; answers given during the session count and tag it; End opens "Leave early?", Keep going keeps the
 * session, End and save shows the summary and logs the minutes; Strict mode locks End; the native SmdFocus plugin is
 * called on start and stop when present; with the flag off the Play Focus room is unchanged.
 * USAGE: node test/run-prep-focus-ui.mjs   (CHROME=<path>; SHOTS=<dir>)
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
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-focus-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Screenshots land on the final frame: finite animations (entrances, ring draw) are finished first; loops keep running.
const shotCall = async (p) => { await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
let W = 390, LIGHT = false;
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(300);
  const r = await shotCall({ format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "focus-" + W + "-" + (LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const overflow = () => ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1 && !e.closest(".pn-filters,.pn-tabs,.pn-zoom-sc")) o.push(e.className||e.tagName); }); return o.slice(0,5).join("|");`);

async function theme(light) { LIGHT = light; await ev(light ? `document.body.classList.remove("dark"); return 1;` : `document.body.classList.add("dark"); return 1;`); await sleep(120); }

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
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1"); localStorage.setItem("smd_prep_focus","0");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);

  // Wall clock under test control: Focus reads Date.now(), so the session can be moved forward.
  await ev(`window.__off=0; var _n=Date.now.bind(Date); Date.now=function(){return _n()+window.__off;}; return 1;`);
  const jump = (minutes) => ev(`window.__off += ${minutes * 60e3}; return 1;`);
  // A stand-in SmdFocus plugin that records calls.
  await ev(`window.__nat=[]; window.Capacitor=window.Capacitor||{}; window.Capacitor.Plugins=window.Capacitor.Plugins||{};
    window.Capacitor.Plugins.SmdFocus={ status:function(){__nat.push("status"); return Promise.resolve({available:true,authorized:true,apps:3,categories:1,domains:0});},
      authorize:function(){__nat.push("authorize"); return Promise.resolve({authorized:true});}, pick:function(){__nat.push("pick"); return Promise.resolve({apps:3});},
      start:function(o){__nat.push("start:"+(o.endsAt?"t":"w")+(o.strict?"s":"")); return Promise.resolve({shielding:true});}, stop:function(){__nat.push("stop"); return Promise.resolve({});} }; return 1;`);

  // Flag turned off ("0") first: the Play row is still the Focus room.
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!window.PREP_PLAY && !!document.querySelector("#smdPrep [data-act=v-focus]");`, 20000), "PrepNucleus opens with the Play Focus row");
  ok(await ev(`return !window.PREP_FOCUS && /Focus room/.test(document.querySelector("#smdPrep [data-act=v-focus]").textContent);`) === true, "flag off: no PREP_FOCUS, the row is the Focus room");

  // Flag unset: on by default (owner 2026-11-28).
  await ev(`localStorage.removeItem("smd_prep_focus"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean); await theme(false);
  await ev(`window.__off=0; var _n=Date.now.bind(Date); Date.now=function(){return _n()+window.__off;}; window.__nat=[]; window.Capacitor=window.Capacitor||{}; window.Capacitor.Plugins=window.Capacitor.Plugins||{};
    window.Capacitor.Plugins.SmdFocus={ status:function(){__nat.push("status"); return Promise.resolve({available:true,authorized:true,apps:3,categories:1,domains:0});},
      authorize:function(){__nat.push("authorize"); return Promise.resolve({authorized:true});}, pick:function(){__nat.push("pick"); return Promise.resolve({apps:3});},
      start:function(o){__nat.push("start:"+(o.endsAt?"t":"w")+(o.strict?"s":"")); return Promise.resolve({shielding:true});}, stop:function(){__nat.push("stop"); return Promise.resolve({});} }; return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!window.PREP_FOCUS && !!document.querySelector("#smdPrep [data-act=v-focus]");`, 20000), "flag on: prep-loader.js loads prep-focus.js");
  ok(/Focus/.test(await text("#smdPrep [data-act=v-focus] b")) && !/room/.test(await text("#smdPrep [data-act=v-focus] b")), "the Play row is now Focus (" + await text("#smdPrep [data-act=v-focus]") + ")");
  // Practise grid: Focus has its own amber tile (owner 2026-11-28) and it opens Focus.
  ok(await ev(`var t=document.querySelector("#smdPrep .pn-home > .pn-grid4 > .fo-tile[data-act=fo-home]"); if(!t) return false; t.scrollIntoView({block:"center"}); return getComputedStyle(t.querySelector(".pn-ri")).backgroundColor === "rgb(239, 192, 123)";`) === true, "Practise grid has the amber Focus tile");
  await sleep(400); await shot("ph-grid");
  await click("#smdPrep .fo-tile[data-act=fo-home]");
  ok(await until(`return !!document.querySelector("#smdPrep .fo-home .fo-ring");`, 4000), "the Focus tile opens Focus");
  await click("#smdPrep [data-act=back]");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=v-focus]");`, 4000), "back from Focus returns to PrepNucleus home");
  await click("#smdPrep [data-act=v-focus]");
  ok(await until(`return !!document.querySelector("#smdPrep .fo-home .fo-ring");`, 4000), "Focus home: the goal ring");
  ok(await until(`return /3 apps, 1 category/.test(document.querySelector("#smdPrep .fo-home").textContent);`, 3000), "blocking row shows what is picked (from the plugin)");
  ok(await ev(`return !!document.querySelector('#smdPrep [data-act=fo-blk][aria-checked="false"]');`) === true, "Block during focus starts off");
  await click("#smdPrep [data-act=fo-blk]");
  ok(await ev(`return !!document.querySelector('#smdPrep [data-act=fo-blk][aria-checked="true"]');`) === true, "Block during focus switches on");
  await sleep(900); await shot("home");
  ok(!(await overflow()), "nothing wider than the screen on Focus home");

  // Custom timer (owner 2026-11-28): type a time, step it, use it.
  await click("#smdPrep [data-act=fo-custom]");
  ok(await until(`return !!document.querySelector("#foSheet #foC_dur");`, 2000), "Custom opens a sheet with a minutes field");
  await ev(`var i=document.getElementById("foC_dur"); i.value="35"; return 1;`);
  await click('#foSheet [data-act=fo-step][data-v="dur:5"]');
  ok(await ev(`return document.getElementById("foC_dur").value;`) === "40", "+ steps the field by 5");
  await sleep(300); await shot("custom-timer");
  await click("#foSheet [data-act=fo-csave]");
  ok(await until(`return !document.getElementById("foSheet") && PREP._host.store().fo.dur === 40;`, 2000), "Use this saves 40 min");
  ok(/Custom · 40m/.test(await text("#smdPrep .fo-home [data-act=fo-custom]")), "the Custom chip shows the time and is selected");

  // Pomodoro choice, custom Pomodoro, then back to a 25 min timer.
  await click('#smdPrep [data-act=fo-mode][data-v="pomo"]');
  ok(/25 \+ 5 x 4/.test(await text("#smdPrep .fo-home")), "Pomodoro shows its block choices");
  await click("#smdPrep [data-act=fo-pcustom]");
  ok(await until(`return !!document.querySelector("#foSheet #foC_f") && !!document.querySelector("#foSheet #foC_b") && !!document.querySelector("#foSheet #foC_n");`, 2000), "custom Pomodoro asks focus, break and rounds");
  await ev(`document.getElementById("foC_f").value="40"; document.getElementById("foC_b").value="8"; document.getElementById("foC_n").value="3"; return 1;`);
  await sleep(300); await shot("custom-pomo");
  ok(!(await overflow()), "nothing wider than the screen in the custom sheet");
  await click("#foSheet [data-act=fo-csave]");
  ok(await until(`var f=PREP._host.store().fo; return f.pomo === "c" && f.pc.f === 40 && f.pc.b === 8 && f.pc.n === 3;`, 2000), "custom Pomodoro is saved");
  ok(/40 \+ 8 x 3/.test(await text("#smdPrep .fo-home [data-act=fo-pcustom]")), "its chip reads 40 + 8 x 3");
  await click('#smdPrep [data-act=fo-mode][data-v="timer"]'); await click('#smdPrep [data-act=fo-dur][data-v="25"]');
  ok(await ev(`return PREP._host.store().fo.mode === "timer" && PREP._host.store().fo.dur === 25;`) === true, "mode and duration are saved");

  // Start.
  await click("#smdPrep [data-act=fo-start]");
  ok(await until(`return !!document.querySelector("#smdPrep .fo-run #foClock");`, 3000), "Start: the running ring");
  ok(/^2[45]:\d\d$/.test(await text("#foClock")), "the clock counts down from 25:00 (" + await text("#foClock") + ")");
  ok(await until(`return __nat.indexOf("start:t") >= 0;`, 2000), "the native plugin is asked to block until the end");
  await sleep(900); await shot("run");
  ok(!(await overflow()), "nothing wider than the screen while running");

  // Answers during the session count.
  await click("#smdPrep [data-act=fo-study]");
  await ev(`var items=[]; for (var i=0;i<3;i++) items.push({ id:"fq"+i, q:"Focus question "+i+"?", o:["Right","Wrong"], a:0, _s:"anatomy", _m:"ana-gametogenesis", exp:"Because." }); PREP._host.run(items, "study", "Focus set", {}); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=answer]");`, 4000);
  await click(`#smdPrep [data-act=answer][data-k="0"]`); await sleep(200); await click(`#smdPrep [data-act=next]`); await sleep(250); await click(`#smdPrep [data-act=answer][data-k="1"]`); await sleep(200);
  ok(await ev(`var r=JSON.parse(localStorage.getItem("smd_prep_focus_run")); return r.q===2 && r.r===1 && !!r.tags && Object.keys(r.tags).length===1;`) === true, "two answers counted, one right, tagged by subject");

  // Back to the session, 12 minutes later: Leave early?
  await ev(`PREP.close && PREP.close(); return 1;`); await ev(`PREP.open(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=v-focus]");`, 6000);
  ok(/left/.test(await text("#smdPrep [data-act=v-focus] small")), "the Play row shows the time left (" + await text("#smdPrep [data-act=v-focus] small") + ")");
  await jump(12);
  await click("#smdPrep [data-act=v-focus]");
  ok(await until(`return !!document.querySelector("#smdPrep .fo-run");`, 3000), "the row returns to the running session");
  await sleep(500);
  const endCs = await ev(`var cs=getComputedStyle(document.querySelector("#smdPrep .fo-end")); return cs.backgroundColor + "|" + cs.color;`);
  ok(/^rgba\(0, 0, 0, 0\)\|/.test(endCs) && !/\|rgba?\(0, 0, 0/.test(endCs), "End reads on the hero surface (" + endCs + ")");
  ok(await until(`return /^1[23]:\\d\\d$/.test(document.querySelector("#foClock").textContent);`, 3000), "the clock moved with wall time (" + await text("#foClock") + ")");
  await click("#smdPrep [data-act=fo-end]");
  ok(await until(`return !!document.querySelector("#foSheet .fo-sheet");`, 2000) && /Leave early/.test(await text("#foSheet h2")), "End opens Leave early?");
  await shot("leave");
  await click("#foSheet [data-act=fo-keep]");
  ok(await ev(`return !document.querySelector("#foSheet") && !!localStorage.getItem("smd_prep_focus_run");`) === true, "Keep going closes the sheet, the session runs on");
  await click("#smdPrep [data-act=fo-end]"); await until(`return !!document.querySelector("#foSheet");`, 2000);
  await click("#foSheet [data-act=fo-quit]");
  ok(await until(`return !!document.querySelector("#smdPrep .fo-done .fo-tiles");`, 3000), "End and save: the summary");
  ok(await ev(`var f=PREP._host.store().fo; return f.log.length===1 && f.log[0].m>=12 && f.log[0].q===2 && f.log[0].ok===0;`) === true, "the session is logged with its minutes and answers");
  ok(await until(`return __nat.indexOf("stop") >= 0;`, 2000), "the native plugin is told to stop blocking");
  await shot("done");

  // Strict mode locks End.
  await click("#smdPrep [data-act=back]");
  ok(await until(`return !!document.querySelector("#smdPrep .fo-home");`, 3000), "Done returns to Focus home");
  ok(/12m|13m/.test(await text("#smdPrep .fo-rec")), "Recent lists the session (" + await text("#smdPrep .fo-rec li") + ")");
  await click("#smdPrep [data-act=fo-strict]");
  await click("#smdPrep [data-act=fo-start]");
  ok(await until(`var b=document.querySelector("#smdPrep .fo-end"); return !!b && b.disabled && /Locked until/.test(b.textContent);`, 3000), "Strict mode: End is locked until the time is up");
  ok(await until(`return __nat.indexOf("start:ts") >= 0;`, 2000), "strict is passed to the plugin");
  // Time up: the session ends on its own.
  await jump(26);
  ok(await until(`return !!document.querySelector("#smdPrep .fo-done") && !localStorage.getItem("smd_prep_focus_run");`, 4000), "at 0 the session ends itself and shows the summary");
  ok(/Session complete|Goal reached/.test(await text("#foDoneH")), "a completed session says so (" + await text("#foDoneH") + ")");

  // Dark theme screenshots.
  if (process.env.SHOTS) {
    await theme(true); await click("#smdPrep [data-act=back]"); await until(`return !!document.querySelector("#smdPrep .fo-home");`, 3000); await shot("home");
    await ev(`PREP._host.store().fo.strict=false; return 1;`); await click("#smdPrep [data-act=fo-start]"); await until(`return !!document.querySelector("#smdPrep .fo-run");`, 3000); await shot("run");
  }
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
