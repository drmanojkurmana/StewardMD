/* PrepNucleus lesson + natural voice in headless Chrome, with a FAKE window.PREP_VOICE (the real runtime is tested apart in
 * run-prep-voice-ui.mjs against a stub). Checks the owner's rules: the first Play shows the one-time download card and
 * nothing is spoken meanwhile (no phone voice), the lesson then reads with the natural voice from the first sentence, the
 * card says ready and goes, a voice downloaded before loads with no card, and when the natural voice fails the phone voice reads.
 * USAGE: node test/run-prep-lessons-voice-ui.mjs   (SHOTS=<dir> saves screenshots)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url); const { chromium } = req("playwright");
const PORT = await freePort(), BASE = `http://localhost:${PORT}/`, FIX = "/test/fixtures/prep-lessons/";
const serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
// saved: the voice was downloaded before. fail: the download fails.
const FAKE = (o) => `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.SMD_PREP_ONBOARD=false;
  window.__tts=[]; window.SpeechSynthesisUtterance=function(t){this.text=t};
  Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{speak:function(u){window.__tts.push(u.text);setTimeout(function(){u.onend&&u.onend({})},300)},cancel:function(){}}});
  var st="none", cb=null; window.__said=[]; window.__voice={ p:function(x){cb&&cb(x)}, done:null, fail:null };
  window.__V={available:function(){return true},state:function(){return st},progress:function(){return 0},saved:function(){return ${!!o.saved}},unlock:function(){},init:function(){},
    usable:function(){return st==="ready"},stop:function(){},release:function(){},prefetch:function(){},
    say:function(t){window.__said.push(t);if(${!!o.sayFail}&&window.__said.length===1)return Promise.reject(new Error("audio"));return new Promise(function(r){setTimeout(r,300)})},
    download:function(f){st="downloading";cb=f;return new Promise(function(r,j){window.__voice.done=function(){st="ready";r()};window.__voice.fail=function(){st="error";j(new Error("x"))}})}};
  Object.defineProperty(window,"PREP_VOICE",{configurable:true,get:function(){return window.__V},set:function(){}});`;
async function lesson(o) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const pg = await ctx.newPage(); pg.on("pageerror", (e) => { console.log("PAGEERR " + e.message); fails++; });
  await pg.addInitScript(FAKE(o));
  await pg.goto(BASE); await pg.waitForFunction(() => !!window.PREP, null, { timeout: 30000 });
  await pg.evaluate(() => { localStorage.setItem("smd_prep", "1"); localStorage.removeItem("smd_prep_v1"); });
  await pg.goto(BASE + "?prep=1"); await pg.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  const jc = async (s) => { await pg.waitForSelector(s, { state: "attached" }); await pg.evaluate((s) => document.querySelector(s).click(), s); };
  await pg.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); document.body.classList.add("dark"); PREP.open({ subject: "surgery" }); });
  await jc("#smdPrep .pn-mod[data-m=sur-breast-cancer]"); await jc("#smdPrep [data-act=l-open]");
  await pg.waitForSelector("#smdPrep .pn-lsn-tx"); await pg.evaluate(() => document.getElementById("pnSetup")?.remove());
  await jc("#smdPrep [data-act=l-play]");
  return pg;
}
const shot = async (pg, n) => { if (process.env.SHOTS) await pg.screenshot({ path: join(process.env.SHOTS, "lesson-voice-" + n + ".png") }); };
try {
  // first Play: download card, silence, then the natural voice
  let pg = await lesson({});
  await pg.evaluate(() => window.__voice.p(0.42)); await sleep(900);
  const dl = await pg.evaluate(() => { const c = document.querySelector("#smdPrep .pn-vdl"); return { card: !!c, pc: c && c.querySelector(".pn-vdl-pc").textContent, tts: window.__tts.length, said: window.__said.length, spd: !!document.querySelector("#smdPrep .pn-lsn-spd") }; });
  ok(dl.card && dl.pc === "42%" && dl.spd, "the first Play shows the download card at 42% and the speed button stays");
  ok(dl.tts === 0 && dl.said === 0, "nothing is read while the voice downloads (no phone voice)");
  await shot(pg, "downloading");
  await pg.evaluate(() => window.__voice.done()); await sleep(600);
  const rd = await pg.evaluate(() => ({ ready: (document.querySelector("#smdPrep .pn-vdl") || {}).textContent || "", said: window.__said.slice(), tts: window.__tts.length }));
  ok(/Natural voice ready/.test(rd.ready), "the card says the voice is ready");
  ok(rd.said.length >= 1 && /Breast cancer/.test(rd.said[0]) && rd.tts === 0, "the lesson then reads with the natural voice from the first sentence");
  await shot(pg, "ready");
  await sleep(1800);
  ok(await pg.evaluate(() => !document.querySelector("#smdPrep .pn-vdl")), "the card goes after a moment");
  await pg.context().close();
  // downloaded before: no card
  pg = await lesson({ saved: true }); await sleep(400);
  ok(await pg.evaluate(() => !document.querySelector("#smdPrep .pn-vdl") && window.__tts.length === 0), "a voice downloaded before loads with no card and no phone voice");
  await pg.evaluate(() => window.__voice.done()); await sleep(500);
  ok(await pg.evaluate(() => window.__said.length >= 1), "and reads with it once loaded");
  await pg.context().close();
  // the natural voice fails: the phone voice reads
  pg = await lesson({}); await pg.evaluate(() => window.__voice.fail()); await sleep(600);
  ok(await pg.evaluate(() => window.__tts.length >= 1 && !document.querySelector("#smdPrep .pn-vdl")), "when the natural voice cannot load, the phone voice reads and the card goes");
  await pg.context().close();
  // one sentence the natural voice cannot read on the phone: the phone voice reads it and the lesson reads on
  pg = await lesson({ saved: true, sayFail: true }); await pg.evaluate(() => window.__voice.done()); await sleep(1500);
  const sf = await pg.evaluate(() => ({ tts: window.__tts.slice(), said: window.__said.slice(), on: window.PREP_LESSONS._l.playing }));
  ok(sf.tts.length === 1 && sf.tts[0] === sf.said[0] && sf.said.length >= 2 && sf.on, "a sentence the natural voice fails on is read by the phone voice, then the natural voice reads on");
  await pg.context().close();
} catch (e) { console.log("FAIL " + (e && e.stack || e)); fails++; }
await browser.close(); serve.kill();
console.log(fails ? "FAILED " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
