/* StewardMD onboarding story (onboard-story.js), headless Chrome over CDP at 390 px.
 * What must hold: the clinician track asks patients a day and shows that number and x4; the canvas draws; the CTA
 * resolves done and marks the track seen; Skip appears after 3 s and resolves skipped; the prep track shows the sourced
 * figures with their source and the months from the hours answered; reduced motion still steps through; the welcome
 * Start plays the story first when the flag is on and goes straight to the tour when off; the first PrepNucleus open
 * plays the prep track over the plan steps.
 * USAGE: node test/run-onboard-story-ui.mjs   (CHROME=<path>; SHOTS=<dir>)
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
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/story-chrome-" + PORT + "-" + Date.now();
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
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "story-" + W + "-" + (LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
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
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/story|STORY|prep|PREP|onboarding/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; ` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);

  // Wall clock under test control: Focus reads Date.now(), so the session can be moved forward.
  await ev(`window.__off=0; var _n=Date.now.bind(Date); Date.now=function(){return _n()+window.__off;}; return 1;`);

  const play = (track) => ev(`window.__res=null; SMD_STORY.play(${JSON.stringify(track)}).then(function(r){window.__res=r;}); return 1;`);
  const line = () => text("#smdStory .ss-text .ss-l");
  const drawn = () => ev(`var c=document.querySelector("#smdStory canvas"); if(!c) return 0; var d=c.getContext("2d").getImageData(0,0,c.width,c.height).data, n=0; for (var i=3;i<d.length;i+=64) if (d[i]>0) n++; return n;`);
  // Tap the empty middle (advances a timed scene).
  // A quick tap on the right side (next) or the left side (back), as pointer events.
  const tapAt = (fx) => ev(`var el=document.getElementById("smdStory"), x=innerWidth*${fx}, y=innerHeight*0.55; ["pointerdown","pointerup"].forEach(function(t){ el.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerId:1,pointerType:"touch"})); }); return 1;`);
  const tapOn = () => tapAt(0.8);
  await ev(`localStorage.setItem("smd_onboard_story","1"); ["clinician","prep"].forEach(function(t){localStorage.removeItem("smd_story_seen_"+t);}); return 1;`);
  // Record haptics instead of firing them.
  await ev(`window.__h=[]; window.SMD_HAPTICS={}; ["tap","light","medium","heavy","selection","success","warning","error"].forEach(function(k){ SMD_HAPTICS[k]=function(){ __h.push(k); }; }); return 1;`);
  ok(await ev(`return !!window.SMD_STORY && SMD_STORY.enabled() && !SMD_STORY.seen("clinician");`) === true, "onboard-story.js loads at boot; flag on; not seen");

  // Clinician track.
  await play("clinician");
  ok(await until(`return !!document.querySelector("#smdStory .ss-opt");`, 3000), "clinician: the story opens with the patients question");
  ok(/Every shift starts with patients/.test(await line()), "first line (" + await line() + ")");
  await sleep(900);
  ok((await drawn()) > 200, "the canvas draws the ward (" + await drawn() + " samples lit)");
  await shot("c1-ward");
  ok(await ev(`return !document.querySelector("#smdStory .ss-skip.on");`) === true, "Skip is hidden in the first 3 s");
  ok(await ev(`return document.querySelectorAll("#smdStory .ss-bars i").length === 10 && !!document.querySelector("#smdStory .ss-bars i.now.wait");`) === true, "10 progress bars; a question waits (no timer)");
  ok(await ev(`return document.querySelectorAll("#smdStory .ss-l .ss-w").length >= 8 && !!document.querySelector("#smdStory .ss-text.ss-in");`) === true, "words are wrapped and rise in");
  // The finger in the field: a sweep gives light ticks.
  await ev(`__h.length=0; var el=document.getElementById("smdStory"), y=innerHeight*0.55; el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:60,clientY:y,pointerId:2})); for (var i=0;i<8;i++) el.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:60+i*35,clientY:y,pointerId:2})); return 1;`);
  await sleep(150);
  await ev(`var el=document.getElementById("smdStory"); el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:340,clientY:innerHeight*0.55,pointerId:2})); return 1;`);
  ok(await ev(`return __h.filter(function(k){return k==="selection";}).length >= 1;`) === true, "sweeping a finger through the points ticks");
  ok(/Every shift/.test(await line()), "a sweep is not a tap: the scene stays");
  await click('#smdStory .ss-opt[data-v="50"]');
  ok(await until(`return /50 patients today/.test(document.querySelector("#smdStory .ss-text").textContent);`, 2000), "the answer becomes the next line: 50 patients today");
  ok(await until(`return __h.indexOf("heavy") >= 0;`, 2000), "the scene lands with its haptic (heavy)");
  // Hold to pause: the timed scene does not move on while held.
  await ev(`var el=document.getElementById("smdStory"); el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:300,clientY:innerHeight*0.55,pointerId:3})); return 1;`);
  ok(await until(`return document.getElementById("smdStory").classList.contains("paused");`, 1500), "press and hold pauses");
  await sleep(2600);
  ok(/50 patients today/.test(await text("#smdStory .ss-text")), "held past its 2.4 s: still on the same scene");
  await ev(`var el=document.getElementById("smdStory"); el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:300,clientY:innerHeight*0.55,pointerId:3})); return 1;`);
  ok(await ev(`return !document.getElementById("smdStory").classList.contains("paused");`) === true, "release resumes");
  // Back: a tap on the left goes to the previous scene.
  await tapAt(0.12);
  ok(await until(`return /Every shift/.test(document.querySelector("#smdStory .ss-text").textContent);`, 2000), "a tap on the left goes back");
  await click('#smdStory .ss-opt[data-v="50"]');
  await until(`return /50 patients today/.test(document.querySelector("#smdStory .ss-text").textContent);`, 2000);
  await tapOn();
  ok(await until(`return /four decisions each/.test(document.querySelector("#smdStory .ss-text").textContent);`, 2000), "decisions scene");
  ok(await until(`return /^200$/.test(document.querySelector("#smdStory .ss-text em").textContent);`, 3500), "the count climbs to 50 x 4 = 200");
  ok(await until(`return document.querySelector("#smdStory .ss-text em").classList.contains("pop");`, 1000), "the number lands with a pop");
  await sleep(700); await shot("c3-decide");
  ok(await ev(`return document.querySelector("#smdStory .ss-skip").classList.contains("on");`) === true, "Skip shows after 3 s");
  for (let i = 0; i < 12 && !(await ev(`return !!document.querySelector("#smdStory .ss-cta");`)); i++) { await tapOn(); await sleep(250); if (i === 4) await shot("c7-wave"); }
  ok(await until(`return !!document.querySelector("#smdStory .ss-cta");`, 3000), "taps step through to the last scene");
  await sleep(900); await shot("c9-go");
  await click("#smdStory .ss-cta");
  ok(await until(`return !!window.__res && window.__res.done === true && window.__res.answers.patients === 50;`, 2000), "Try a renal dose resolves done with the answer");
  ok(await until(`return !document.getElementById("smdStory");`, 2000), "the story is removed");
  ok(await ev(`return SMD_STORY.seen("clinician");`) === true, "the clinician track is marked seen");

  // Prep track, figures and their sources; then Skip.
  await play("prep");
  ok(await until(`return /doctors sat NEET-PG 2025/.test(document.querySelector("#smdStory .ss-text").textContent);`, 3000), "prep: the crowd scene");
  ok(/NBEMS/.test(await text("#smdStory .ss-src")), "the figure shows its source (" + await text("#smdStory .ss-src") + ")");
  ok(await until(`return document.querySelector("#smdStory .ss-text em").textContent === "2,30,114";`, 4000), "the count lands on 2,30,114");
  ok(await ev(`var p=document.querySelector("#smdStory .ss-l"), w=p.querySelectorAll(".ss-w"); return w[0].textContent === "2,30,114" && w[1].textContent === "doctors" && w[1].getBoundingClientRect().left - w[0].getBoundingClientRect().right >= 3;`) === true, "a space separates the number from doctors");
  await sleep(500); await shot("p1-crowd");
  await tapOn();
  ok(await until(`return /52,244/.test(document.querySelector("#smdStory .ss-text").textContent) && /NMC/.test(document.querySelector("#smdStory .ss-src").textContent);`, 2000), "seats scene with its source");
  await sleep(900); await shot("p2-seats");
  await tapOn();
  await until(`return !!document.querySelector("#smdStory .ss-opt");`, 2000);
  await click('#smdStory .ss-opt[data-v="5"]');
  ok(await until(`return /5 hours.*a day is.*2\\.5 months/.test(document.querySelector("#smdStory .ss-text").textContent);`, 2000), "5 hours a day is 2.5 months a year");
  await sleep(1000); await shot("p4-months");
  await tapOn(); await sleep(1100); await shot("p5-turn");
  // Background: the story stops drawing and its clock waits.
  await ev(`Object.defineProperty(document,"hidden",{configurable:true,get:function(){return true;}}); document.dispatchEvent(new Event("visibilitychange")); return 1;`);
  ok(await ev(`return SMD_STORY._s().hidden === true;`) === true, "in the background the story pauses");
  await ev(`Object.defineProperty(document,"hidden",{configurable:true,get:function(){return false;}}); document.dispatchEvent(new Event("visibilitychange")); return 1;`);
  ok(await ev(`return SMD_STORY._s().hidden === false;`) === true, "back in front it resumes");
  await until(`return document.querySelector("#smdStory .ss-skip.on");`, 4000);
  await click("#smdStory .ss-skip");
  ok(await until(`return !!window.__res && window.__res.skipped === true && window.__res.answers.hours === 5;`, 2000), "Skip resolves skipped, the answer kept");
  ok(await until(`return !document.getElementById("smdStory") && SMD_STORY.seen("prep");`, 2000), "skipped still counts as seen");

  // Reduced motion: still steps, no crash.
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await play("clinician");
  await until(`return !!document.querySelector("#smdStory .ss-opt");`, 3000);
  await click('#smdStory .ss-opt[data-v="10"]');
  ok(await until(`return /10 patients today/.test(document.querySelector("#smdStory .ss-text").textContent);`, 2000), "reduced motion: the story still runs");
  await tapOn(); ok(await until(`return /\\b40\\b/.test(document.querySelector("#smdStory .ss-text em").textContent);`, 1500), "reduced motion: the count lands at once (40)");
  await ev(`document.querySelector("#smdStory .ss-skip").click(); return 1;`); await until(`return !document.getElementById("smdStory");`, 2000);
  await call("Emulation.setEmulatedMedia", { features: [] });

  // Welcome hand-off: flag on, not seen -> story then the app tour.
  await ev(`localStorage.removeItem("smd_story_seen_clinician"); return 1;`);
  await ev(`SMD_TOUR.start("welcome"); return 1;`);
  ok(await until(`return !!document.querySelector(".smdt-wel [data-w=start]") && document.querySelector(".smdt-wel").style.display !== "none";`, 3000), "welcome screen shows");
  await click(".smdt-wel [data-w=start]");
  ok(await until(`return !!document.getElementById("smdStory");`, 2000), "welcome Start plays the story first");
  // Finish it (not Skip): the renal dose example opens, then the tour.
  await until(`return !!document.querySelector("#smdStory .ss-opt");`, 3000);
  await click('#smdStory .ss-opt[data-v="25"]');
  for (let i = 0; i < 10 && !(await ev(`return !!document.querySelector("#smdStory .ss-cta");`)); i++) { await tapOn(); await sleep(250); }
  await click("#smdStory .ss-cta");
  ok(await until(`return !!document.querySelector(".rd-scrim .rd-demo");`, 4000), "the renal dose tool opens with the example banner");
  ok(/Example patient, not a real person/.test(await text(".rd-demo")), "the banner says it is an example");
  ok(await until(`return document.querySelector("#rdAge").value === "70" && document.querySelector("#rdScr").value === "2" && /Piperacillin/i.test(document.querySelector(".rd-h").textContent);`, 2000), "example values are filled for piperacillin-tazobactam");
  ok(await until(`var r=document.querySelector("#rdResult"); return r && r.style.display !== "none" && /29/.test(r.textContent) && /Give at this renal function/.test(r.textContent);`, 3000), "the real tool computes CrCl 29 and shows its own dose (" + (await text("#rdResult")).slice(0, 90) + ")");
  await sleep(400); await shot("c10-demo");
  ok(await ev(`return !document.querySelector(".smdt-card");`) === true, "the tour waits while the example is open");
  await click(".rd-scrim .rd-x");
  ok(await until(`return !document.querySelector(".rd-scrim") && !!document.querySelector(".smdt-card");`, 4000), "closing the example starts the app tour");
  // Next open of the tool starts empty (nothing from the example is kept).
  await ev(`SMD_RENAL_DOSE.open("Piperacillin-Tazobactam"); return 1;`);
  ok(await until(`return !!document.querySelector("#rdAge") && document.querySelector("#rdAge").value === "" && !document.querySelector(".rd-demo");`, 2000), "the next open of the renal tool is empty, no banner");
  await ev(`document.querySelector(".rd-scrim .rd-x").click(); return 1;`);
  await ev(`var x=document.querySelector(".smdt-card [data-a=close], .smdt-card .smdt-x"); if (x) x.click(); return 1;`);
  // Flag off: straight to the tour.
  await ev(`localStorage.setItem("smd_onboard_story","0"); localStorage.removeItem("smd_story_seen_clinician"); document.querySelectorAll(".smdt-card,.smdt-dim,.smdt-spot").forEach(function(e){e.remove();}); return 1;`);
  await ev(`SMD_TOUR.start("welcome"); return 1;`);
  await until(`return !!document.querySelector(".smdt-wel [data-w=start]") && document.querySelector(".smdt-wel").style.display !== "none";`, 3000);
  await click(".smdt-wel [data-w=start]"); await sleep(600);
  ok(await ev(`return !document.getElementById("smdStory");`) === true, "flag off: no story, the tour starts as before");

  // First PrepNucleus open: the prep track over the plan steps.
  await ev(`localStorage.setItem("smd_onboard_story","1"); localStorage.removeItem("smd_story_seen_prep"); localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1"); document.querySelectorAll(".smdt-card,.smdt-dim,.smdt-spot,.smdt-wel").forEach(function(e){e.remove();}); return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.getElementById("smdStory") && /NEET-PG/.test(document.querySelector("#smdStory").textContent);`, 20000), "first PrepNucleus open plays the prep track");
  ok(await until(`return !!document.querySelector("#smdPrep .pl-ob");`, 6000), "the plan onboarding waits underneath");
  await tapOn(); await sleep(300); await tapOn();
  ok(await until(`return !!document.querySelector("#smdStory .ss-opt") && !!document.querySelector("#smdStory .ss-mascot .pnm");`, 4000), "Nucleo asks the phone question");
  await sleep(900); await shot("p3-nucleo");
  await ev(`document.querySelector("#smdStory .ss-skip").click(); return 1;`); await until(`return !document.getElementById("smdStory");`, 2000);
  // The plan steps' Skip never shows the welcome screen.
  await ev(`var x=document.getElementById("smdStory"); if (x) x.remove(); return 1;`);
  await click("#smdPrep [data-act=p-skip]").catch(() => {});
  await ev(`var b=document.querySelector("#smdPrep [data-act=p-skip]"); if (b) b.click(); return 1;`);
  await sleep(600);
  ok(await ev(`return !document.querySelector("#smdPrep .wl-body");`) === true, "Skip on the plan steps: no welcome screen");
  // The welcome screen itself.
  await ev(`localStorage.removeItem("smd_prep_welcome_seen"); window.__wl = PREP_WELCOME.open(PREP._host); return 1;`);
  ok(await until(`return window.__wl === true && !!document.querySelector("#smdPrep .wl-body");`, 3000), "welcome: Your plan is ready");
  ok(/5-question warm-up/.test(await text("#smdPrep .wl-body")), "it offers the 5-question warm-up");
  await sleep(500); await shot("welcome");
  ok(await ev(`return PREP_WELCOME.open(PREP._host) === false;`) === true, "shown once per device");
  await ev(`window.__wl2 = 1; return 1;`);
  await ev(`localStorage.removeItem("smd_prep_welcome_seen"); PREP_WELCOME.open(PREP._host); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=wl-warm]");`, 3000);
  await click("#smdPrep [data-act=wl-warm]");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=answer]") && /Warm-up/.test(document.querySelector("#smdPrep .pn-bar").textContent);`, 15000), "the warm-up opens real questions in the runner");
  ok(errors.length === 0, "no uncaught error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
