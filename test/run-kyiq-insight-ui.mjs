/* KnowYourIQ insight (prep-insight.js): the result screen after a set and the swipe pager in Review, in the real app.
 * Headless Chrome over CDP with touch. Synthetic items run through PREP._host.run (no bank needed).
 *  - result: confidence x correct bar, by-type rows, fix list (confident errors first), remember list, no AI call;
 *  - a question missed twice carries "Missed 2 times";
 *  - the fix list opens a pager over that list: Next, Previous and a touch swipe move through it without going back;
 *  - the Review list opens the same pager over the chosen filter;
 *  - smd_kyiq_insight=0 puts the old result back; no uncaught PrepNucleus error.
 * USAGE: node test/run-kyiq-insight-ui.mjs   (CHROME=<path>) */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const LOADER_V = (await import("node:fs")).readFileSync(new URL("../prep-loader.js", import.meta.url), "utf8").match(/var V = "([^"]+)"/)[1];
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-feel-chrome-" + PORT + "-" + Date.now();
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

const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(300);
  const r = await shotCall({ format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "kyiq-" + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const touch = (type, pts) => call("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
async function drag(from, to, steps = 8) {
  await touch("touchStart", [from]);
  for (let k = 1; k <= steps; k++) { await touch("touchMove", [[from[0] + (to[0] - from[0]) * k / steps, from[1] + (to[1] - from[1]) * k / steps]]); await sleep(16); }
  await touch("touchEnd", []);
}
const STEMS = [
  ["A 30-year-old presents with fever and a rash. Most likely diagnosis is:", 1, "confident"],
  ["Investigation of choice for renal stone is:", 1, "confident"],
  ["Treatment of choice for the above condition is:", 1, "confused"],
  ["Mechanism of action of the drug is:", 0, "guessing"],
  ["Screening test of choice for carcinoma cervix is:", 0, "confident"],
  ["Nerve supply of the diaphragm is:", 0, null],
  ["Most likely diagnosis in a child with a rash is:", 1, null],
  ["Next step in management of this patient is:", 1, "guessing"],
  ["Investigation of choice for biliary colic is:", 0, "confident"],
  ["Complication of mumps in an adult male is:", 0, "confident"]
];
const ITEMS = STEMS.map((s, i) => ({ id: "kx" + i, q: s[0], o: ["Right answer " + i, "Wrong answer " + i, "Other " + i, "Another " + i], a: 0, exp: "Key point for question " + i + " is that the right answer wins. More text follows here.", _s: "anatomy", _m: "kx-mod", t: "kx-mod" }));
const planFor = (q) => STEMS.find((s) => s[0] === q);
const txt = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
async function runAll(plan) {
  for (let n = 0; n < ITEMS.length; n++) {
    const q = await txt("#smdPrep .pn-q"); const p = plan(q);
    if (!p) { ok(false, "unknown question " + q); return; }
    if (p[2]) await click(`#smdPrep [data-act=conf][data-v=${p[2]}]`);
    await click(`#smdPrep [data-act=answer][data-k="${p[1]}"]`);
    await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 3000);
    await click("#smdPrep [data-act=next]");
    await sleep(200);
    if (await ev(`return !!document.querySelector("#smdPrep .ky-ins") || /Set finished/.test((document.querySelector("#smdPrep .pn-bar")||{}).textContent||"");`)) break;
  }
}
try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP|insight/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1"); localStorage.setItem("smd_prep_kyiq_intro","1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await ev(`document.body.classList.remove("dark"); PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-body") && !!window.PREP_INSIGHT;`, 20000), "PrepNucleus opens and prep-insight.js is loaded");

  // ---------- first run ----------
  await ev(`PREP._host.run(${JSON.stringify(ITEMS)}, "study", "Insight set"); return 1;`);
  ok(await until(`return /Mechanism|Investigation|diagnosis|Nerve|Treatment|Screening|Next step|Complication/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 8000), "the set starts");
  await runAll(planFor);
  ok(await until(`return !!document.querySelector("#smdPrep .ky-ins");`, 6000), "the insight section shows on the result screen");
  await ev(`document.querySelector("#smdPrep .ky-ins").scrollIntoView(); return 1;`); await shot("result-light-a");
  await ev(`document.querySelector("#smdPrep .ky-fixl").scrollIntoView(); return 1;`); await shot("result-light-b");
  await ev(`document.body.classList.add("dark"); return 1;`); await shot("result-dark-b");
  await ev(`document.querySelector("#smdPrep .ky-ins").scrollIntoView(); return 1;`); await shot("result-dark-a");
  await ev(`document.body.classList.remove("dark"); return 1;`);
  const g = await ev(`var o={}; document.querySelectorAll("#smdPrep .ky-grid i").forEach(function(i){ var c=(i.className.match(/ky-g-(\\w+)/)||[])[1]; o[c]=Number(i.style.flexGrow); }); return o;`);
  ok(g.misconception === 2 && g.confused === 1 && g.lucky === 1 && g.mastered === 3 && g.right === 1 && g.wrong === 1 && g.guesswrong === 1, "the confidence bar counts every group: " + JSON.stringify(g));
  const lead = await txt("#smdPrep .ky-lead");
  ok(/confident/.test(lead) && /2 confident errors/.test(lead), "the lead says what to fix first: " + lead);
  const types = await ev(`return Array.prototype.map.call(document.querySelectorAll("#smdPrep .ky-ty"), function(r){ return r.querySelector(".ky-tn").textContent + "=" + r.querySelector(".ky-tv").textContent; }).join("|");`);
  ok(/Diagnosis=0\/2/.test(types) && /Treatment=0\/2/.test(types) && /Investigation=1\/2/.test(types) && /Pathogenesis=1\/1/.test(types) && /Basic science and anatomy=1\/1/.test(types), "the by-type rows count each question type: " + types);
  const fixes = await ev(`return Array.prototype.map.call(document.querySelectorAll("#smdPrep .ky-fix[data-l=fix]"), function(b){ return b.querySelector(".ky-bd").textContent; }).join("|");`);
  ok(fixes === "Confident but wrong|Confident but wrong|Confused|Wrong|Guessed wrong", "the fix list is ordered confident error, confused, wrong, guessed wrong: " + fixes);
  ok(await ev(`var b=document.querySelector("#smdPrep .ky-fix[data-l=fix]"); return /You chose/.test(b.textContent) && /Answer/.test(b.textContent) && /Remember:/.test(b.textContent);`) === true, "a fix row shows your option, the answer and a remember line");
  const rem = await ev(`return document.querySelectorAll("#smdPrep .ky-fix[data-l=rem]").length;`);
  ok(rem === 1, "right answers you were unsure of are listed to remember (" + rem + ")");
  ok(await ev(`return !document.querySelector("#smdPrep .ky-empty");`) === true, "no empty-state block inside the result");
  ok(await ev(`return !!document.querySelector("#smdPrep [data-act=kypattern]") && !!document.querySelector("#smdPrep [data-act=kypractise]");`) === true, "the Explain my pattern and Practise these buttons show");

  // ---------- Explain my pattern: one small structured message, no auto call ----------
  await ev(`window.__ask = null; PREP_ASK.open = function (o) { window.__ask = o; return true; }; return 1;`);
  await click("#smdPrep [data-act=kypattern]");
  const ask = await ev(`return window.__ask && { kind: window.__ask.kind, len: (window.__ask.bk || "").length, bk: window.__ask.bk };`);
  ok(ask && ask.kind === "card" && ask.len > 80 && ask.len <= 1500 && /confident wrong 2/.test(ask.bk) && /By type:/.test(ask.bk), "Explain my pattern sends one compact summary (" + (ask && ask.len) + " chars)");

  // ---------- fix list opens a pager ----------
  await click("#smdPrep .ky-fix[data-l=fix]");
  ok(await until(`return !!document.querySelector("#smdPrep .ky-pos");`, 3000), "tapping a fix row opens the review pager");
  ok(await txt("#smdPrep .ky-pos") === "1 of 5", "the pager covers the fix list only: " + await txt("#smdPrep .ky-pos"));
  await shot("pager-light");
  ok(await ev(`return !document.querySelector("#smdPrep .pn-why-chip");`) === true, "the review pager has no Why A / Why B buttons");
  await ev(`document.body.classList.add("dark"); return 1;`); await shot("pager-dark");
  const bgs = await ev(`var r=document.querySelector("#smdPrep"), c=getComputedStyle(r).backgroundColor, o=document.querySelector("#smdPrep .pn-opt:not(.right):not(.wrong)"); return [c, o ? getComputedStyle(o).backgroundColor : ""];`);
  const dark = (c) => { const m = String(c).match(/\d+/g); return m && m.slice(0, 3).every((v) => +v < 40) && Math.max(...m.slice(0, 3)) - Math.min(...m.slice(0, 3)) < 8; };
  ok(dark(bgs[0]) && dark(bgs[1]), "dark mode background and cards are neutral black, not navy: " + JSON.stringify(bgs));
  await ev(`document.body.classList.remove("dark"); return 1;`);
  const q1 = await txt("#smdPrep .pn-q");
  await click("#smdPrep [data-act=rvnext]"); await sleep(250);
  ok(await txt("#smdPrep .ky-pos") === "2 of 5" && await txt("#smdPrep .pn-q") !== q1, "Next moves to the next question in the list");
  await click("#smdPrep [data-act=rvprev]"); await sleep(250);
  ok(await txt("#smdPrep .ky-pos") === "1 of 5" && await txt("#smdPrep .pn-q") === q1, "Previous comes back");
  ok(await ev(`return document.querySelector("#smdPrep [data-act=rvprev]").disabled === true;`) === true, "Previous is disabled on the first question");
  const r0 = await ev(`var e=document.querySelector("#smdPrep #pnRvQ").getBoundingClientRect(); return [e.top, innerWidth];`);
  await drag([330, r0[0] + 120], [60, r0[0] + 120]); await sleep(350);
  ok(await txt("#smdPrep .ky-pos") === "2 of 5", "a swipe left moves to the next question: " + await txt("#smdPrep .ky-pos"));
  await drag([60, r0[0] + 120], [330, r0[0] + 120]); await sleep(350);
  ok(await txt("#smdPrep .ky-pos") === "1 of 5", "a swipe right moves back: " + await txt("#smdPrep .ky-pos"));
  await drag([330, r0[0] + 120], [310, r0[0] + 125]); await sleep(300);
  ok(await txt("#smdPrep .ky-pos") === "1 of 5", "a short throw settles back and changes nothing");
  for (let k = 0; k < 4; k++) { await click("#smdPrep [data-act=rvnext]"); await sleep(150); }
  ok(await txt("#smdPrep .ky-pos") === "5 of 5" && await ev(`return document.querySelector("#smdPrep [data-act=rvnext]").disabled === true;`) === true, "the last question disables Next");
  await drag([330, r0[0] + 120], [60, r0[0] + 120]); await sleep(300);
  ok(await txt("#smdPrep .ky-pos") === "5 of 5", "a swipe past the end stays on the last question");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .ky-ins");`, 3000), "back returns to the result, not further");

  // ---------- Review filter list opens the same pager ----------
  await click("#smdPrep [data-act=rfilter][data-v=all]");
  await sleep(200);
  await click("#smdPrep [data-act=reviewq]");
  ok(await until(`return !!document.querySelector("#smdPrep .ky-pos");`, 3000) && await txt("#smdPrep .ky-pos") === "1 of 10", "the Review list opens the pager over All: " + await txt("#smdPrep .ky-pos"));
  await ev(`PREP.back(); return 1;`); await until(`return !!document.querySelector("#smdPrep .ky-ins");`, 3000);

  // ---------- missed twice ----------
  await click("#smdPrep [data-act=retrymissed]");
  await until(`return /Wrong|Right|answer/i.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"") || !!document.querySelector("#smdPrep .pn-q");`, 5000);
  ITEMS.length = ITEMS.length;
  for (let n = 0; n < 5; n++) {
    const q = await txt("#smdPrep .pn-q"); if (!planFor(q)) break;
    await click(`#smdPrep [data-act=answer][data-k="1"]`);
    await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 3000);
    await click("#smdPrep [data-act=next]"); await sleep(200);
  }
  ok(await until(`return !!document.querySelector("#smdPrep .ky-ins");`, 6000), "the second run shows the insight too");
  const reps = await ev(`return document.querySelectorAll("#smdPrep .ky-bd-rep").length;`);
  ok(reps === 5 && /Missed 2 times/.test(await txt("#smdPrep .ky-bd-rep")), "every question missed twice says so (" + reps + ")");
  ok(/repeated mistake/.test(await txt("#smdPrep .ky-lead")), "the lead mentions repeated mistakes");

  // ---------- kill switch ----------
  await ev(`localStorage.setItem("smd_kyiq_insight","0"); PREP._st.run && PREP._host.rerender(); return 1;`); await sleep(300);
  ok(await ev(`return !document.querySelector("#smdPrep .ky-ins");`) === true, "smd_kyiq_insight=0 brings the old result back");
  await ev(`localStorage.removeItem("smd_kyiq_insight"); return 1;`);
  ok(errors.length === 0, "no uncaught PrepNucleus error " + JSON.stringify(errors.slice(0, 2)));
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
