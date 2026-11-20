/* PrepNucleus MaiK buddy (prep-buddy.js), headless Chrome over CDP at 390 px.
 * What must hold: he stands in the corner of a practice set only (not on home, not in a timed test, not with the flag
 * off); 3 right in a row is celebrated; a wrong answer makes him sad with a word of encouragement; 3 wrong offers
 * Revise topic (opens the module, back returns to the set); a right answer after misses is the comeback; a tap opens
 * the quick-ask bubble whose Ask fills the Ask MaiK sheet; he steps aside under that sheet; the set's end is summed up.
 * USAGE: node test/run-prep-buddy-ui.mjs   (CHROME=<path>; SHOTS=<dir>)
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
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-buddy-chrome-" + PORT + "-" + Date.now();
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
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "buddy-" + W + "-" + (LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
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
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await theme(false);


  // A practice set of 12 synthetic questions (answer A is right), started through the runner the app uses.
  const startSet = (mode, sid) => ev(`var items=[]; for (var i=0;i<12;i++) items.push({ id:"bq"+i, q:"Buddy question "+i+"?", o:["Right","Wrong one","Wrong two","Wrong three"], a:0, _s:${JSON.stringify(sid || "anatomy")}, _m:"ana-gametogenesis", exp:"Because." });
    PREP._host.run(items, ${JSON.stringify(mode)}, "Buddy set"); return 1;`);
  const pickAns = async (k) => { await click(`#smdPrep [data-act=answer][data-k="${k}"]`); await sleep(200); };
  const next = async () => { await click(`#smdPrep [data-act=next]`); await sleep(250); };
  const bub = () => text(".pnb-bub");
  const mood = () => ev(`var s=PREP_BUDDY._s(); return s.mk ? s.mk.state() : null;`);

  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!window.PREP_BUDDY && !!window.MaiKCompanion && !!document.querySelector("#smdPrep");`, 20000), "PrepNucleus opens; prep-loader.js loads prep-buddy.js");
  ok(await ev(`return !document.getElementById("pnBuddy");`) === true, "no buddy on the PrepNucleus home screen");

  // Open the subject first so its index is loaded (Revise topic needs the module in it), as when practising a module.
  await ev(`PREP.open({ subject: "anatomy" }); return 1;`);
  ok(await until(`return !!(PREP._st.ix && PREP._st.ix.anatomy && PREP._st.ix.anatomy.topics.length);`, 8000), "the anatomy index is loaded");
  await startSet("study");
  ok(await until(`return /Buddy question 0/.test(document.querySelector("#smdPrep .pn-q").textContent) && !!document.querySelector("#pnBuddy .pnm-hit");`, 6000), "practice set: Nucleo stands in the corner");
  ok(await until(`var r=document.querySelector("#pnBuddy .pnm-hit").getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.width > 30;`, 4000), "he walks in and stands fully on screen");
  ok(await ev(`return document.querySelector("#smdPrep").classList.contains("pnb-on") && parseFloat(getComputedStyle(document.querySelector("#smdPrep .pn-run")).paddingBottom) >= 60;`) === true, "the question body gets room under him");

  // 3 right in a row: the streak line and the hop.
  await pickAns(0); await next(); await pickAns(0); await next(); await pickAns(0);
  ok(/Three/.test(await bub()), "3 right in a row: he celebrates (" + await bub() + ")");
  let m = await mood(); ok(m && m.mood > 0.4, "his mood is up after the streak (" + (m && m.mood) + ")");
  await shot("streak");
  // A wrong answer: sad.
  await next(); await pickAns(1);
  m = await mood(); ok(m && m.mood < 0.2 && (m.gesture === "shrug" || m.mouth === "frown" || m.face === "concern"), "a wrong answer: he looks sad (" + JSON.stringify(m && { mood: m.mood, g: m.gesture, mouth: m.mouth }) + ")");
  ok((await bub()).length > 0, "first miss: a word of encouragement (" + await bub() + ")");
  await sleep(400);
  ok(await ev(`var bar=document.querySelector("#smdPrep .pn-fb + .pn-navrow"), a=document.querySelector("#pnBuddy .pnm-hit"); if (!bar||!a) return "missing"; var br=bar.getBoundingClientRect(), r=a.getBoundingClientRect(); return br.bottom < innerHeight - 4 || r.bottom <= br.top + 2;`) === true, "with the sticky Next bar on screen he stands on it, not over the button");
  ok(await ev(`var b=document.querySelector(".pnb-bub"), bar=document.querySelector("#smdPrep .pn-fb + .pn-navrow"); if (!b||!bar) return true; return b.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top;`) === true, "his bubble stays above the Next bar");
  await shot("wrong");
  // Two more wrong: the slump offers revising the topic.
  await next(); await pickAns(2); await next(); await pickAns(3);
  ok(await until(`return !!document.querySelector(".pnb-bub [data-b=rev]");`, 2000), "3 wrong in a row: he asks to revise the topic, with Revise topic and Keep going");
  ok(await ev(`return [].every.call(document.querySelectorAll(".pnb-bub button"), function(b){ return b.getBoundingClientRect().height >= 43.5; });`) === true, "bubble buttons are at least 44 px");
  ok(await ev(`var b=document.querySelector(".pnb-bub"); return !!b.querySelector("b") && !/Anatomy \u00b7/.test(b.textContent);`) === true, "the topic is named on its own, in bold (" + await bub() + ")");
  ok(await ev(`var b=document.querySelector(".pnb-bub"), a=document.querySelector("#pnBuddy .pnm-hit, #pnBuddy .mkc-a"), tail=parseFloat(b.style.getPropertyValue("--pnb-tail")), br=b.getBoundingClientRect(), r=a.getBoundingClientRect(); return Math.abs((br.right - tail) - (r.left + r.width/2)) < 3;`) === true, "the tail points at the mascot");
  ok(await ev(`var b=document.querySelector(".pnb-bub"), rt=getComputedStyle(document.getElementById("smdPrep")); return b.style.getPropertyValue("--pn-card").trim() === rt.getPropertyValue("--pn-card").trim() && !!rt.getPropertyValue("--pn-card").trim();`) === true, "the bubble wears PrepNucleus's own card colour");
  await shot("slump");
  await theme(true); await shot("slump"); await theme(false);
  await click(".pnb-bub [data-b=rev]"); await sleep(800);
  ok(await until(`return !document.querySelector("#pnBuddy") && !/Buddy question/.test((document.querySelector("#smdPrep .pn-q")||{textContent:""}).textContent);`, 4000), "Revise topic opens the module screen; the buddy leaves with the set");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return /Buddy question 5/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"") && !!document.querySelector("#pnBuddy .pnm-hit");`, 4000), "back returns to the set, and he is back");
  // Comeback after the misses.
  await next(); await pickAns(0);
  ok(/track|comeback|form/i.test(await bub()), "right after the misses: the comeback (" + await bub() + ")");

  // Tap him: the quick-ask bubble; a chip opens Ask MaiK for this question with the words filled in.
  await ev(`PREP_BUDDY.quickAsk(); return 1;`);
  ok(await until(`return !!document.querySelector(".pnb-bub .pnb-list button") && !!document.querySelector(".pnb-bub input");`, 2000), "tap: a quick-ask bubble with chips and a box");
  ok(await ev(`return parseFloat(getComputedStyle(document.querySelector(".pnb-bub input")).fontSize) >= 16;`) === true, "the box is 16 px (no iOS zoom on focus)");
  ok(await ev(`return document.querySelector(".pnb-in button").disabled;`) === true, "send is disabled until something is typed");
  await shot("quickask");
  await theme(true); await shot("quickask"); await theme(false);
  await ev(`document.querySelector(".pnb-bub input").value = "Why is A right?"; document.querySelector(".pnb-bub form").requestSubmit(); return 1;`);
  ok(await until(`return !!document.getElementById("pnAsk");`, 4000), "Ask sends the question to the Ask MaiK sheet");
  ok(await ev(`var s=PREP_ASK._s(); return s && s.draft;`) === "Why is A right?", "with the words filled in");
  ok(await ev(`return getComputedStyle(document.getElementById("pnBuddy")).display === "none";`) === true, "he steps aside while the Ask MaiK sheet is open");
  await ev(`PREP_ASK.close(); return 1;`); await sleep(300);

  // Finish the set: the closing line.
  for (let i = 0; i < 6; i++) { if (await ev(`return !!document.querySelector("#smdPrep [data-act=answer]:not([aria-disabled])");`)) await pickAns(0); await next(); }
  ok(await until(`return /%/.test((document.querySelector(".pnb-bub")||{}).textContent||"");`, 3000), "end of set: he sums it up (" + await bub() + ")");
  await shot("done");

  // A timed test shows no answers, so he is not there.
  await ev(`PREP.back(); return 1;`); await sleep(200);
  await startSet("exam");
  ok(await until(`return /Buddy question 0/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 4000) && await ev(`return !document.getElementById("pnBuddy");`) === true, "timed test or mock: no buddy");
  await ev(`PREP.back(); return 1;`); await sleep(200);

  // A topic whose index is not loaded: the slump has no Revise button (it would open a blank screen), only a thought for later.
  await startSet("study", "no-such-subject");
  await until(`return /Buddy question 0/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 4000);
  await pickAns(1); await next(); await pickAns(1); await next(); await pickAns(1);
  ok(await until(`return /after this set/.test((document.querySelector(".pnb-bub")||{}).textContent||"");`, 2000) && await ev(`return !document.querySelector(".pnb-bub [data-b=rev]");`) === true, "no module to open: no Revise button, revise after the set (" + await bub() + ")");
  await ev(`PREP.back(); return 1;`); await sleep(200);

  // The MaiK companion is still there for those who prefer him: smd_prep_mascot = "maik".
  await ev(`localStorage.setItem("smd_prep_mascot","maik"); return 1;`);
  await startSet("study");
  ok(await until(`return !!document.querySelector("#pnBuddy .mkc-a") && !document.querySelector("#pnBuddy .pnm");`, 4000), "smd_prep_mascot=maik: the MaiK companion instead of Nucleo");
  await pickAns(0); await next(); await pickAns(0); await next(); await pickAns(0);
  ok(/Three|straight/.test(await bub()), "the MaiK companion gets the same lines");
  await ev(`localStorage.removeItem("smd_prep_mascot"); PREP.back(); return 1;`); await sleep(200);

  // Every face and pose, side by side (for the owner's review; SHOTS only).
  if (process.env.SHOTS) {
    await ev(`var w=document.createElement("div"); w.id="pnmShow"; w.style.cssText="position:fixed;inset:0;z-index:99999;background:#f3f2ee;display:flex;flex-wrap:wrap;gap:6px;padding:20px;align-content:flex-start";
      [["normal","rest","Idle"],["proud","thumbs","Right"],["happy","cheer","3 in a row"],["sad","droop","Wrong"],["cry","droop","3 wrong"],["think","hug","Low score"],["wow","rest","Wow"],["happy","wave","Hello"]].forEach(function(f){
        var c=document.createElement("div"); c.style.cssText="width:170px;height:200px;position:relative;text-align:center;font:600 12px Inter,sans-serif;color:#13203d";
        var h=document.createElement("div"); h.style.cssText="position:absolute;left:53px;top:30px;width:64px;height:76px;transform:scale(1.9);transform-origin:50% 40%"; c.appendChild(h);
        var m=PREP_MASCOT.mount(h,{reduceMotion:true,hideKey:"x_show"}); m.el.setAttribute("data-face",f[0]); m.el.setAttribute("data-pose",f[1]);
        var l=document.createElement("div"); l.textContent=f[2]; l.style.cssText="position:absolute;left:0;right:0;top:172px"; c.appendChild(l); w.appendChild(c); });
      document.body.appendChild(w); return 1;`);
    await sleep(500);
    const r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) fs.writeFileSync(join(process.env.SHOTS, "nucleo-faces.png"), Buffer.from(r.result.data, "base64"));
    await ev(`document.body.classList.add("dark"); document.getElementById("pnmShow").style.background="#1a1a2e"; [].forEach.call(document.querySelectorAll("#pnmShow div div:last-child"),function(l){l.style.color="#e8eef2";}); return 1;`);
    await sleep(300);
    const r2 = await call("Page.captureScreenshot", { format: "png" });
    if (r2.result) fs.writeFileSync(join(process.env.SHOTS, "nucleo-faces-dark.png"), Buffer.from(r2.result.data, "base64"));
    await ev(`document.getElementById("pnmShow").remove(); document.body.classList.remove("dark"); return 1;`);
  }

  // Flag off: no buddy.
  await ev(`localStorage.setItem("smd_prep_buddy","0"); return 1;`);
  await startSet("study");
  ok(await until(`return /Buddy question 0/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 4000) && await ev(`return !document.getElementById("pnBuddy");`) === true, "smd_prep_buddy=0: no buddy");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
