/* PrepNucleus in the REAL app (headless Chrome over CDP), against the small fixture bank in test/fixtures/prep.
 * What must hold: OFF by default (no tile, open() a no-op); with ?prep=1 the boot loads only prep-loader.js, the tile
 * opens the overlay, home lists the exam's subjects with MCQ counts; a subject lists sections and numbered modules
 * (an empty module says "Questions coming soon"); practice marks each answer with its explanation and source line and
 * writes FSRS cards; a flagged item and an item on the reported-and-hidden list never show; a report is kept; subject
 * search finds a question and opens it; a wrong answer joins My mistakes with its tag and leaves when answered right;
 * home shows readiness and Today's plan, whose reviews item starts the due set; a mini mock is marked with the pattern's negative marking and
 * analysed by subject; PREP.open({ query, n }) (Edge start_mcq) starts the best module; a bookmark is counted on home; a timed test runs a clock, marks for
 * review, submits and marks; the NEET-SS tab shows the SS subject; a module opened once loads again with the bank
 * route blocked after a reload (IndexedDB); back() unwinds to home and closes; the Review Desk "PrepNucleus reports"
 * tab lists reports and Restore sends the owner DELETE (the reports API is answered inside the browser); no request
 * reaches /api/prep/bank or /api/ai and no uncaught PrepNucleus error.
 *
 * USAGE: node test/run-prep-ui.mjs   (BASE=http://localhost:8997/ to use a running server; SHOTS=<dir> saves screenshots)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";

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

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = []; const flagCalls = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Screenshots land on the final frame: after 150 ms (Motion starts its animations on the next frame), finite animations
// (entrances, ring draw) are finished; loops keep running.
const shotCall = async (p) => { await sleep(150); await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
// Motion strips (STRIP=<dir>): every running animation is paused and stepped to each time in ms, one frame a step.
const strip = async (name, ts) => {
  if (!process.env.STRIP) return;
  const fsx = await import("node:fs");
  if (process.env.PN_LIGHT) await ev(`document.body.classList.remove("dark"); return 1;`);
  for (const t of ts) {
    await ev(`document.getAnimations().forEach(function (a) { try { a.pause(); a.currentTime = ${t}; } catch (e) {} }); return 1;`);
    const r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) fsx.writeFileSync(join(process.env.STRIP, name + "-" + (process.env.PN_LIGHT ? "light" : "dark") + "-" + String(t).padStart(4, "0") + ".png"), Buffer.from(r.result.data, "base64"));
  }
  await ev(`document.getAnimations().forEach(function (a) { try { a.play(); } catch (e) {} }); return 1;`);
};
const shot = async (name) => { if (!process.env.SHOTS) return; if (process.env.PN_LIGHT) await ev(`if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.remove("dark"); return 1;`); const r = await shotCall({ format: "png" }); if (r.result) (await import("node:fs")).writeFileSync(join(process.env.SHOTS, "prep-" + (process.env.PN_LIGHT ? "light-" : "") + name + ".png"), Buffer.from(r.result.data, "base64")); };

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Fetch.requestPaused") {
      const rq = m.params.request; flagCalls.push(rq.method + " " + rq.url);
      const body = rq.method === "GET" ? { items: [{ itemId: "ana-gametogenesis-q6", subject: "anatomy", module: "ana-gametogenesis", n: 3, reasons: { "wrong-key": 2, unclear: 1 }, hidden: true }, { itemId: "ana-gametogenesis-q2", subject: "anatomy", module: "ana-gametogenesis", n: 1, reasons: { typo: 1 } }] } : { ok: true };
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // Fixture bank instead of the real one; confirm() answers yes. Runs before any page script.
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const load = async (url) => { reqs.length = 0; await call("Page.navigate", { url }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(500); };
  const tile = `return !!document.querySelector('.rnav-tile[data-act=prep]');`;

  // ---- off per device (smd_prep="0"); the default is ON since 2026-10-06
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","0"); localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_home_tools");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await load(BASE);
  ok(reqs.some((u) => /prep-loader\.js\?v=/.test(u)) && !reqs.some((u) => /\/prep(\.js|\.css)/.test(u)), "boot loads prep-loader.js and not prep.js or prep.css");
  ok(await ev(tile) === false, "smd_prep=0: no PrepNucleus tile");
  ok(await ev(`return PREP.open();`) === false && await ev(`return !document.getElementById("smdPrep");`) === true, "smd_prep=0: PREP.open() does nothing");

  // ---- ON with ?prep=1
  await load(BASE + "?prep=1");
  ok(await until(tile, 10000), "?prep=1: the tile renders");
  await click(".rnav-tile[data-act=prep]");
  ok(await until(`return PREP.isOpen() && !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy]");`, 20000), "tile opens PrepNucleus home with the Anatomy subject");
  ok(reqs.some((u) => /\/prep\.js\?v=/.test(u)) && reqs.some((u) => /\/prep\.css\?v=/.test(u)), "prep.js and prep.css load on first open");
  ok(await until(`var t=document.querySelector("#smdPrep .pn-tile[data-s=anatomy] small"); return !!t && /9 MCQs/.test(t.textContent);`, 10000), "subject tile shows its MCQ count");
  ok(await ev(`return !document.querySelector("#smdPrep .pn-tile[data-s=ss-cardiology]");`) === true, "NEET-PG home does not list SS subjects");
  ok(await until(`var n=document.getElementById("pnNext"); return !!n && !n.hidden && /Gametogenesis/.test(n.textContent);`, 5000), "Solve next points at the first module with questions");
  await shot("home");

  // ---- subject (round 4: a push slides the new body in from the right on a shared axis; the first 450 ms after the
  // overlay opens are not animated, as the overlay itself just arrived, so wait past them)
  await sleep(500);
  const navIn = JSON.parse(await ev(`document.querySelector("#smdPrep .pn-tile[data-s=anatomy]").click(); var an=document.getAnimations().filter(function(a){var t=a.effect&&a.effect.target; return t&&t.matches&&t.matches("#smdPrep > .pn-body");}); var k=an.length?an[0].effect.getKeyframes():[]; return JSON.stringify({n:an.length, from:(k[0]&&k[0].transform)||"", op:k[0]?k[0].opacity:null});`));
  ok(navIn.n === 1 && /translateX\(28px\)/.test(navIn.from) && String(navIn.op) === "0", "a push slides the new screen in from the right: " + JSON.stringify(navIn));
  ok(await ev(`var p=document.createElement("p"); p.className="pn-load"; p.textContent="Loading"; document.querySelector("#smdPrep .pn-body").appendChild(p); var b=getComputedStyle(p,"::before"), a=getComputedStyle(p,"::after"), r=b.content!=="none" && parseFloat(getComputedStyle(p).minHeight)>=300 && /pn-shim/.test(a.animationName) && b.boxShadow!=="none"; p.remove(); return r;`) === true, "loading states draw a skeleton with a moving shimmer");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-mod[data-act=module]").length === 3;`, 10000), "subject lists its 3 modules");
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep .pn-sec")).map(function(h){return h.textContent;}).join("|");`) === "Embryology|Upper limb", "sections in taxonomy order");
  ok(await ev(`var b=document.querySelector('#smdPrep .pn-mod[data-m=ana-placenta]'); return b.getAttribute("aria-disabled")==="true" && /Questions coming soon/.test(b.textContent);`) === true, "an empty module says Questions coming soon and is disabled");
  ok(await ev(`return document.querySelector('#smdPrep .pn-mod[data-m=ana-brachial-plexus] .pn-num').textContent;`) === "3", "modules are numbered across sections");
  await shot("subject");

  // ---- practice
  await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]');
  ok(await until(`return /6 MCQs/.test((document.querySelector("#smdPrep .pn-big")||{}).textContent||"");`, 5000), "module screen shows 6 usable MCQs (the flagged one is not counted)");
  await shot("module");
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 10000), "practice starts");
  ok(await ev(`var i=document.querySelectorAll("#smdPrep .pn-qprog .pn-qseg i"); return i.length===5 && i[0].classList.contains("cur") && document.querySelector("#smdPrep .pn-qseg").getAttribute("aria-valuenow")==="0";`) === true, "focus mode: a segmented progress strip, one segment a question, the first lit");
  let seen = [];
  const keyRun = (k) => ev(`var t=document.activeElement||document.body; if(!document.getElementById("smdPrep").contains(t)) t=document.getElementById("smdPrep"); var e=new KeyboardEvent("keydown",{key:${JSON.stringify("K")},bubbles:true,cancelable:true}); t.dispatchEvent(e); return e.defaultPrevented;`.replace('"K"', JSON.stringify(k)));
  const swipeRun = (dx) => ev(`var b=document.querySelector("#smdPrep .pn-run"), r=b.getBoundingClientRect(), x=r.left+r.width*0.7, y=r.top+120, o={bubbles:true,pointerType:"touch",isPrimary:true,pointerId:5};
    b.dispatchEvent(new PointerEvent("pointerdown",Object.assign({clientX:x,clientY:y},o)));
    b.dispatchEvent(new PointerEvent("pointermove",Object.assign({clientX:x+${dx}/3,clientY:y+2},o)));
    b.dispatchEvent(new PointerEvent("pointermove",Object.assign({clientX:x+${dx},clientY:y+3},o)));
    var tr=document.getElementById("pnQw").style.transform;
    b.dispatchEvent(new PointerEvent("pointerup",Object.assign({clientX:x+${dx},clientY:y+3},o))); return tr;`);
  for (let i = 0; i < 5; i++) {
    seen.push(await ev(`return document.querySelector("#smdPrep .pn-q").textContent;`));
    if (i === 0) await shot("question");
    if (i === 0) { await click("#smdPrep [data-act=bookmark]"); ok(await ev(`return document.querySelector("#smdPrep [data-act=bookmark]").getAttribute("aria-pressed");`) === "true", "bookmark toggles on"); }
    if (i === 1) {
      // Round 3: a swipe before answering resists and stays; key B answers without the reveal motion; a swipe left goes on.
      const tr = await swipeRun(-160);
      ok(/translateX\(-\d/.test(tr) && Math.abs(parseFloat(tr.slice(11))) < 80 && /question 2 of|Question 2 of/.test(await ev(`return document.querySelector("#smdPrep .pn-t p").textContent;`)), "an unanswered question resists a swipe (rubber band) and stays: " + tr);
      ok(await keyRun("b") === true && await until(`return !!document.querySelector("#smdPrep .pn-fb") && document.querySelector("#smdPrep .pn-opt[data-k='1']").getAttribute("aria-pressed")==="true";`, 2000), "key B answers option B");
      ok(await ev(`return !document.querySelector("#smdPrep .pn-fb.pn-new");`) === true, "a key answer skips the reveal motion");
      ok(await ev(`var b=document.querySelector("#smdPrep .pn-bar [data-act=report]"); return !!b && b.getAttribute("aria-label")==="Report this question" && !!document.querySelector("#smdPrep .pn-bar [data-act=bookmark][aria-label]");`) === true, "bookmark and report are labelled icon buttons in the bar");
      ok(await ev(`var i=document.querySelectorAll("#smdPrep .pn-qseg i"); return (i[0].classList.contains("ok")||i[0].classList.contains("no")) && i[1].classList.contains("cur");`) === true, "the strip marks question 1 right or wrong and lights question 2");
      await swipeRun(-160);
      ok(await until(`return /Question 3 of/.test(document.querySelector("#smdPrep .pn-t p").textContent) && !!document.querySelector("#smdPrep .pn-qw.in-r");`, 2000), "a swipe left past the line moves to the next question, arriving from the right");
      seen.push(await ev(`return document.querySelector("#smdPrep .pn-q").textContent;`));
      i++;
    }
    await click('#smdPrep .pn-opt[data-k="1"]');
    if (i === 0 && process.env.STRIP) { await sleep(40); await strip("runner-reveal", [0, 60, 120, 180, 260, 360, 520, 900]); }
    if (i === 0) {
      ok(await ev(`return !!document.querySelector("#smdPrep .pn-fb.pn-new");`) === true, "a tapped answer plays the reveal once (.pn-new)");
      ok(await until(`return !!document.querySelector("#smdPrep .pn-fb .pn-exp");`, 3000), "an answer shows the verdict and explanation at once");
      ok(await ev(`return !document.querySelector("#smdPrep .pn-prov") && !/MedMCQA|AI-generated|Source:/.test(document.querySelector("#smdPrep .pn-fb").textContent);`) === true, "no source or authorship line under the explanation (owner rule: credits live in Terms)");
      ok(await ev(`return document.querySelectorAll("#smdPrep .pn-opt.right").length === 1;`) === true, "the right option is marked");
      ok(await ev(`var it=PREP._st.run.items[PREP._st.run.i], a=document.querySelector("#smdPrep .pn-fb .pn-ans"); return !!a && a.textContent.indexOf(it.o[it.a])>=0 && a.querySelector("small").textContent==="Right answer" && a.querySelector(".pn-l").textContent===String.fromCharCode(65+it.a);`) === true, "round 7: the answer sits on its own line under the verdict");
      ok(await ev(`var d=document.querySelectorAll("#smdPrep .pn-opt[aria-disabled=true]:not(.right):not(.wrong)"); return d.length>=2 && getComputedStyle(d[0]).opacity<1;`) === true, "round 7: the options that are neither the key nor the pick step back");
      ok(await ev(`var n=document.querySelector("#smdPrep .pn-qw > .pn-fb + .pn-navrow"); return !!n && getComputedStyle(n).position==="sticky";`) === true, "round 7: Next stays in reach (sticky row)");
      await shot("feedback");
      const wrong = await ev(`return !!document.querySelector("#smdPrep .pn-fb.no");`);
      if (wrong) {
        await click('#smdPrep [data-act=mtag][data-v=misread]');
        ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")), k=Object.keys(s.mt); return k.length===1 && s.mt[k[0]][2]==="misread";`) === true, "a wrong answer joins My mistakes and takes its tag");
      } else ok(await ev(`return !document.querySelector("#smdPrep [data-act=mtag]");`) === true, "a right answer offers no mistake tags");
      await click("#smdPrep [data-act=report]");
      ok(await until(`return document.querySelectorAll("#smdPrep [data-act=sendreport]").length === 5;`, 3000), "Report lists the five reasons");
      await click('#smdPrep [data-act=sendreport][data-v=unclear]');
      ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 3000), "after reporting, back on the answered question");
      ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return Object.keys(s.rep).length===1 && s.rep[Object.keys(s.rep)[0]]==="unclear";`) === true, "the report is kept on the device");
    }
    if (i === 3) {
      // Round 7: a tapped Next (pointer click, detail 1) slides the next question in; a key press does not.
      await ev(`document.querySelector("#smdPrep [data-act=next]").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,detail:1})); return 1;`);
      ok(await ev(`return !!document.querySelector("#smdPrep .pn-qw.in-r");`) === true, "round 7: a tapped Next arrives from the right");
      continue;
    }
    await click("#smdPrep [data-act=next]");
  }
  ok(await until(`return /Set finished/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 5000), "after the last question: results");
  ok(await ev(`var r=PREP._st.run, i=document.querySelectorAll("#smdPrep .pn-score .pn-recap i"); return i.length===r.items.length && document.querySelectorAll("#smdPrep .pn-recap i.ok").length===r.items.filter(function(it,k){return r.ans[k]===it.a;}).length;`) === true, "round 7: the result shows the set as one mark a question");
  ok(!seen.some((q) => /FLAGGED/.test(q)), "the flagged item never shows");
  ok(!seen.some((q) => /question 6 of/.test(q)), "the item on the hidden list never shows");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return !!s.hid.ids["ana-gametogenesis-q6"];`) === true, "the hidden list was fetched and kept");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return Object.keys(s.cards).filter(function(k){return k.indexOf("p:ana-gametogenesis:")===0;}).length;`) === 5, "5 FSRS cards written under the module deck");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return s.mod["ana-gametogenesis"].t;`) === 5, "attempts counted for the module");
  await click("#smdPrep [data-act=donerun]");
  ok(await until(`return /answered/.test((document.querySelector("#smdPrep .pn-mut")||{}).textContent||"");`, 3000), "Done returns to the module screen");

  // ---- timed test
  await click('#smdPrep [data-act=start][data-k=exam]');
  ok(await until(`return !!document.getElementById("pnClock");`, 5000), "timed test shows a clock");
  ok(await ev(`return /^\\d+:\\d\\d$/.test(document.getElementById("pnClock").textContent);`) === true, "clock reads m:ss");
  ok(await ev(`return !!document.querySelector("#smdPrep .pn-clockw .pn-pace .rv") && document.getElementById("pnClock").parentNode.classList.contains("pn-clockw");`) === true, "the clock sits in a pace ring");
  await click('#smdPrep .pn-opt[data-k="0"]');
  ok(await ev(`return !document.querySelector("#smdPrep .pn-fb");`) === true, "no feedback during a test");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-opt.sel .pn-pick").length===1 && !document.querySelector("#smdPrep .pn-opt:not(.sel) .pn-mark");`) === true, "round 7: a timed test's pick carries a check");
  await shot("exam");
  await click("#smdPrep [data-act=markq]");
  await click("#smdPrep [data-act=qgrid]");
  await shot("qgrid");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-qn").length > 0 && !!document.querySelector("#smdPrep .pn-qn.ans.mark");`, 3000), "question grid shows answered and marked");
  await click("#smdPrep .pn-qgrid + p + [data-act=submit]");
  await sleep(300); await shot("result");
  ok(await until(`return /Test marked/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 5000), "submit marks the test");
  await click("#smdPrep [data-act=donerun]");

  // ---- search within the subject (round 4: a pop slides the previous screen in from the left)
  const navOut = JSON.parse(await ev(`PREP.back(); var an=document.getAnimations().filter(function(a){var t=a.effect&&a.effect.target; return t&&t.matches&&t.matches("#smdPrep > .pn-body");}); var k=an.length?an[0].effect.getKeyframes():[]; return JSON.stringify({n:an.length, from:(k[0]&&k[0].transform)||"", op:k[0]?k[0].opacity:null});`));
  ok(navOut.n === 1 && /translateX\(-28px\)/.test(navOut.from), "back slides the previous screen in from the left: " + JSON.stringify(navOut));
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=search]");`, 3000), "the subject screen has a search button");
  await click("#smdPrep [data-act=search]");
  ok(await until(`return document.activeElement && document.activeElement.id === "pnSearch";`, 3000), "search opens with the field focused");
  ok(await ev(`return !!document.querySelector("#pnHits .pn-empty.pn-art-sc") && !!document.querySelector("#smdPrep .pn-srch > svg");`) === true, "search starts from a prompt with art, the field carries its glyph");
  await ev(`var i=document.getElementById("pnSearch"); i.value="brachial fixture"; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  ok(await until(`return document.querySelectorAll("#smdPrep [data-act=hit]").length === 3;`, 5000), "search finds the 3 matching questions: " + await ev(`return (document.getElementById("pnHits")||{}).textContent;`));
  await shot("search");
  await click('#smdPrep [data-act=hit][data-i="ana-brachial-plexus-q2"]');
  ok(await until(`var q=document.querySelector("#smdPrep .pn-q"); return !!q && /Fixture question 2 of ana-brachial-plexus/.test(q.textContent);`, 5000), "a hit opens that question");
  await ev(`PREP.back(); PREP.back(); return 1;`);

  // ---- back to home: bookmark count, exam tab
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-tabs");`, 5000), "back() unwinds to home");
  // Round 4: a tab cross-fades (opacity, no travel); Escape goes back with no animation; reduced motion is a fade.
  const navTab = JSON.parse(await ev(`document.querySelector("#smdPrep .pn-tab.on").click(); var an=document.getAnimations().filter(function(a){var t=a.effect&&a.effect.target; return t&&t.matches&&t.matches("#smdPrep > .pn-body");}); var k=an.length?an[0].effect.getKeyframes():[]; return JSON.stringify({n:an.length, from:(k[0]&&k[0].transform)||"", op:k[0]?k[0].opacity:null});`));
  ok(navTab.n === 1 && !navTab.from && String(navTab.op) === "0", "an exam tab cross-fades the body: " + JSON.stringify(navTab));
  await sleep(300); await click("#smdPrep [data-act=bookmarks]"); await until(`return /Bookmarks/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 3000); await sleep(300);
  const navKey = JSON.parse(await ev(`document.getElementById("smdPrep").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); var an=document.getAnimations().filter(function(a){var t=a.effect&&a.effect.target; return t&&t.matches&&t.matches("#smdPrep > .pn-body");}); var k=an.length?an[0].effect.getKeyframes():[]; return JSON.stringify({n:an.length, from:(k[0]&&k[0].transform)||"", op:k[0]?k[0].opacity:null});`));
  ok(navKey.n === 0 && await ev(`return !!document.querySelector("#smdPrep .pn-tabs");`) === true, "Escape goes back with no animation: " + JSON.stringify(navKey));
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const navRm = JSON.parse(await ev(`document.querySelector("#smdPrep [data-act=bookmarks]").click(); var an=document.getAnimations().filter(function(a){var t=a.effect&&a.effect.target; return t&&t.matches&&t.matches("#smdPrep > .pn-body");}); var k=an.length?an[0].effect.getKeyframes():[]; return JSON.stringify({n:an.length, from:(k[0]&&k[0].transform)||"", op:k[0]?k[0].opacity:null});`));
  ok(navRm.n === 1 && !navRm.from && String(navRm.op) === "0", "reduced motion: a push is a cross-fade with no travel: " + JSON.stringify(navRm));
  await call("Emulation.setEmulatedMedia", { features: [] });
  await ev(`PREP.back(); return 1;`); await until(`return !!document.querySelector("#smdPrep .pn-tabs");`, 3000);
  ok(await ev(`return /1 saved/.test(document.querySelector("#smdPrep [data-act=bookmarks]").textContent);`) === true, "home counts the bookmark");
  const nmt = await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).mt).length;`);
  ok(nmt > 0 && await ev(`return /${nmt} to fix/.test(document.querySelector("#smdPrep [data-act=mistakes]").textContent);`) === true, "home counts the mistakes: " + nmt);
  ok(await until(`return !!document.querySelector("#smdPrep .pl-hero") && !!document.querySelector("#smdPrep .pl-list [data-k=new]");`, 5000), "home shows the readiness line and Today's plan");
  await click("#smdPrep [data-act=mistakes]");
  await sleep(300); await shot("mistakes");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-mods .pn-mod").length === ${nmt};`, 5000), "My mistakes lists them");
  await click("#smdPrep [data-act=mpractice]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000), "Practise these starts a set of the mistakes");
  const n0 = await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).mt).length;`);
  await ev(`var it=PREP._st.run.items[0]; var b=document.querySelector('#smdPrep .pn-opt[data-k="'+it.a+'"]'); b.click(); return 1;`);
  ok(await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).mt).length;`) === n0 - 1, "answering a mistake right takes it off the list");
  await ev(`PREP.back(); PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=mocks]");`, 3000);
  await click("#smdPrep [data-act=mocks]");
  ok(await until(`return document.querySelectorAll("#smdPrep [data-act=mock]").length === 4;`, 3000), "NEET-PG and INI-CET patterns, full and mini");
  await shot("mocks");
  await click('#smdPrep [data-act=mock][data-v=neet-pg][data-k=mini]');
  ok(await until(`return !!document.getElementById("pnClock") && document.querySelector("#smdPrep .pn-t h1").textContent === "NEET-PG pattern (mini)";`, 10000), "the mini mock starts with a clock");
  await ev(`var r=PREP._st.run; r.ans=r.items.map(function(it,i){return i===0?it.a:i===1?(it.a+1)%4:-1;}); return 1;`);
  await click("#smdPrep [data-act=qgrid]");
  await click("#smdPrep .pn-qgrid + p + [data-act=submit]");
  ok(await until(`return document.querySelector("#smdPrep .pn-score .pn-big").textContent.split(" / ")[0] === "3";`, 5000), "marked +4 / -1: one right, one wrong = 3: " + await ev(`return (document.querySelector("#smdPrep .pn-score .pn-big")||{}).textContent;`));
  ok(await ev(`return !!document.querySelector('#smdPrep .pn-mod[data-act=subject][data-s=anatomy]');`) === true, "the analysis lists subjects, each opening its subject");
  await shot("mock-result");
  ok(await ev(`var m=JSON.parse(localStorage.getItem("smd_prep_v1")).mh; return m.length===1 && m[0].marks===3 && /mini/.test(m[0].label);`) === true, "the finished mock is kept in the mock history");
  await click("#smdPrep [data-act=donerun]");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep .pl-hero");`, 3000);
  await ev(`var st=PREP._st.store, k=Object.keys(st.cards).filter(function(x){return x.indexOf("p:ana-gametogenesis:")===0;})[0]; st.cards[k][3]=0; st.pt=null; PREP._st.stack[PREP._st.stack.length-1](); return 1;`);
  await until(`return !!document.querySelector("#smdPrep .pl-list [data-k=rev]");`, 5000);
  await click("#smdPrep .pl-list [data-k=rev]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && /Today/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 8000), "the reviews item of Today's plan runs the due set");
  await ev(`PREP.close(); PREP.open({ query: "quiz me on brachial plexus", n: 2 }); return 1;`);
  ok(await until(`var r=PREP._st.run; return !!r && r.items.length===2 && r.items.every(function(it){return it._m==="ana-brachial-plexus";});`, 8000), "PREP.open({ query, n }) starts the best-matching module with n questions");
  await ev(`PREP.close(); return 1;`);
  const er = await ev(`var p=SMD_EDGE.mcqParse("quiz me on brachial plexus, 3 questions"); return JSON.stringify(p);`);
  ok(/brachial plexus/.test(er || ""), "Edge reads \"quiz me on brachial plexus\" as a quiz request: " + er);
  ok(await ev(`return SMD_EDGE.startMcq({ kind: "start_mcq", n: 3, topic: "brachial plexus", mode: "study", title: "x" });`) === true, "Edge start_mcq opens PrepNucleus while the flag is on");
  ok(await until(`var r=PREP._st.run; return !!r && r.items.length===3 && r.items[0]._m==="ana-brachial-plexus";`, 8000), "and starts 3 questions of the matching module");
  ok(await ev(`var o=document.querySelector('#smdPrep .pn-opt[data-k="'+((PREP._st.run.items[0].a+1)%4)+'"]'); o.click(); return !document.querySelector("#smdPrep [data-act=teach]") && !!window.PREP_TEACHER;`) === true, "the offline teacher is loaded but offers nothing on the web (no local model)");
  await ev(`PREP.close(); PREP.open(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep .pn-tabs");`, 5000);
  await click('#smdPrep .pn-tab[data-v=neet-ss]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=ss-cardiology]") && !document.querySelector("#smdPrep .pn-tile[data-s=anatomy]");`, 5000), "NEET-SS tab shows the SS subject only");
  await click('#smdPrep .pn-tab[data-v=neet-pg]');
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !PREP.isOpen() && !document.getElementById("smdPrep");`, 3000), "back() on home closes PrepNucleus");

  // ---- screenshots only: custom module, bookmarks, downloads, My stats
  if (process.env.SHOTS) {
    for (const [act, name] of [["custom", "custom"], ["bookmarks", "bookmarks"], ["downloads", "downloads"], ["a-stats", "stats"]]) {
      await ev(`PREP.close(); PREP.open(); return 1;`);
      await until(`return !!document.querySelector("#smdPrep [data-act=${act}]");`, 5000);
      await click(`#smdPrep [data-act=${act}]`);
      if (act === "custom") await click("#smdPrep [data-act=cmsub]");
      await sleep(400); await shot(name);
    }
    await ev(`PREP.close(); return 1;`);
  }

  // ---- Round 5: the offline teacher is a chat. The runtime is stubbed (native app, MaiK Lite downloaded); the model's
  // answer is held until the test releases it, so the typing state can be checked first.
  await ev(`PREP.close(); window.__capWas = window.Capacitor; window.Capacitor = { isNativePlatform: function () { return true; } };
    window.SMD_MAIK_MODELS = { PACKS: { "maik-lite": { label: "MaiK Lite" } }, installed: function () { return Promise.resolve(true); }, installedCached: function () { return true; } };
    window.SMD_MAIK_LOCAL = { available: function () { return true; }, currentPack: function () { return "maik-lite"; }, answer: function () { return new Promise(function (r) { window.__ptGo = r; }); } };
    PREP.open(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep .pn-home");`, 8000);
  await ev(`window.__ptItem = { id: "pt-1", q: "Primary oocytes stay arrested in which phase of meiosis until just before ovulation?", o: ["Prophase I, diplotene stage", "Metaphase II", "Anaphase I", "Telophase II"], a: 0,
    exp: "Primary oocytes enter meiosis I in fetal life and arrest in the diplotene stage of prophase I. The arrest lasts until the LH surge before ovulation, when meiosis I completes.\\n\\nThe secondary oocyte then arrests in metaphase II until fertilisation.", kp: "Two arrests: prophase I until ovulation, metaphase II until fertilisation." };
    PREP_TEACHER.explain(window.__ptItem, 1, PREP._host); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pt-chat .pt-dots") && !!window.__ptGo;`, 5000), "teacher chat: MaiK types while the phone works");
  const ptRun = JSON.parse(await ev(`var c=document.querySelector("#smdPrep .pt-ctx"); return JSON.stringify({ sticky: getComputedStyle(c).position, q: /Primary oocytes/.test(c.textContent), pills: Array.from(c.querySelectorAll(".pt-pill")).map(function(p){return p.className+":"+p.textContent;}).join("|"), me: document.querySelector("#smdPrep .pt-msg.me").textContent, secs: !!document.querySelector("#smdPrep #ptSecs"), ai: document.querySelectorAll("#smdPrep .pt-msg.ai").length });`));
  ok(ptRun.sticky === "sticky" && ptRun.q && ptRun.pills === "pt-pill bad:You chose B|pt-pill ok:Answer A" && ptRun.me === "Why is B wrong?" && ptRun.secs && ptRun.ai === 1, "teacher chat: the question is pinned on top with both answers, the ask is the student's bubble, a seconds counter: " + JSON.stringify(ptRun));
  await shot("teacher-typing");
  await ev(`window.__ptGo({ text: "B is wrong because metaphase II is the second arrest, after ovulation. Primary oocytes arrest in the diplotene stage of prophase I from fetal life, and the arrest lasts until the LH surge before ovulation.\\n\\nThe secondary oocyte then arrests in metaphase II until fertilisation." }); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pt-ans-b") && !document.querySelector("#smdPrep .pt-dots");`, 5000), "teacher chat: the checked reply replaces the typing bubble");
  const ptDone = JSON.parse(await ev(`return JSON.stringify({ reply: /second arrest/.test(document.querySelector("#smdPrep .pt-ans-b").textContent), focus: document.activeElement === document.querySelector("#smdPrep .pt-ans-b"), note: /Checked: every drug and number/.test((document.querySelector("#smdPrep .pt-note")||{}).textContent||""), chips: Array.from(document.querySelectorAll("#smdPrep .pt-chips .pt-chip, #smdPrep .pt-more summary")).map(function(c){return c.textContent;}).join("|"), chipH: Math.min.apply(null, Array.from(document.querySelectorAll("#smdPrep .pt-chip")).map(function(c){return c.offsetHeight;})) });`));
  ok(ptDone.reply && ptDone.focus && ptDone.note && ptDone.chips === "Back to the question|Show the stored explanation" && ptDone.chipH >= 44, "teacher chat: reply bubble focused, the check note under it, suggestion chips at 44 px: " + JSON.stringify(ptDone));
  await ev(`document.querySelector("#smdPrep .pt-more summary").click(); return 1;`);
  ok(await ev(`var d=document.querySelector("#smdPrep .pt-more"); return d.open && /Exam pearl/.test(d.textContent) && /Why B is wrong|Answer A/.test(d.textContent);`) === true, "teacher chat: the stored explanation opens under its chip");
  await ev(`document.querySelector("#smdPrep .pt-more").open = false; return 1;`);
  await shot("teacher");
  await click("#smdPrep .pt-chips [data-act=back]");
  ok(await until(`return !document.querySelector("#smdPrep .pt-chat") && !!document.querySelector("#smdPrep .pn-home");`, 3000), "teacher chat: Back to the question leaves the chat");
  await ev(`PREP.close(); delete window.SMD_MAIK_LOCAL; delete window.SMD_MAIK_MODELS; window.Capacitor = window.__capWas; return 1;`);

  // ---- offline: reload, block the bank route, the module still opens from IndexedDB
  await load(BASE + "?prep=1");
  await call("Network.setBlockedURLs", { urls: ["*" + FIX + "api/*"] });
  await ev(`PREP.open(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy]");`, 20000);
  await click("#smdPrep .pn-tile[data-s=anatomy]");
  await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 5000);
  await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]');
  await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 5000);
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 10000), "a module opened once loads offline after a reload");
  await ev(`PREP.back(); PREP.back(); PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep .pn-tab[data-v=neet-ss]');`, 5000);
  await click('#smdPrep .pn-tab[data-v=neet-ss]');
  await until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=ss-cardiology]");`, 5000);
  await click("#smdPrep .pn-tile[data-s=ss-cardiology]");
  await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=scd-hfref]');`, 5000);
  await click('#smdPrep .pn-mod[data-m=scd-hfref]');
  await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 5000);
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-err");`, 10000), "a module never opened shows a clear offline message");
  await call("Network.setBlockedURLs", { urls: [] });
  await ev(`PREP.close(); return 1;`);

  // ---- Review Desk: PrepNucleus reports (owner tab), the reports API answered in the browser
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/prep/flag*" }] });
  await ev(`window.SMD_BULLETINS_DESK={probe:function(){return Promise.resolve(true);},pendingTotal:function(){return 0;},reset:function(){},html:function(t){return t;}}; window.SMD_AUTH={currentUser:{uid:"owner",email:"owner@example.com",getIdToken:function(){return Promise.resolve("owner-tok");},getIdTokenResult:function(){return Promise.resolve({token:"owner-tok",claims:{}});}}}; SMD_REVIEW.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdReview [data-rv-act="kind:prep"]');`, 5000), "the Review Desk shows a PrepNucleus reports tab to owners");
  await click('#smdReview [data-rv-act="kind:prep"]');
  ok(await until(`return document.querySelectorAll("#smdReview .rv-row").length === 2;`, 5000), "the tab lists the reported questions");
  ok(await ev(`return /wrong key 2, unclear 1/.test(document.querySelector("#smdReview .rv-row").textContent) && !!document.querySelector('#smdReview [data-rv-act="prepun:ana-gametogenesis-q6"]');`) === true, "reasons are summarised and a hidden question offers Restore");
  await click('#smdReview [data-rv-act="prepun:ana-gametogenesis-q6"]');
  ok(await until(`return true;`, 100) && await (async () => { for (let i = 0; i < 30; i++) { if (flagCalls.some((c) => /^DELETE /.test(c))) return true; await sleep(100); } return false; })(), "Restore sends the owner DELETE: " + flagCalls.join(", "));
  await ev(`SMD_REVIEW.close(); return 1;`);
  await call("Fetch.disable", {});

  const mine = reqs.filter((u) => /\/api\/(prep\/bank|ai)\//.test(u));
  ok(!mine.length, "no request reaches /api/prep/bank or /api/ai (the fixture bank serves every file; no AI)" + (mine.length ? ": " + mine.join(", ") : ""));
  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
