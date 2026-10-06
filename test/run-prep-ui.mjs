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
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const shot = async (name) => { if (!process.env.SHOTS) return; if (process.env.PN_LIGHT) await ev(`document.body.classList.remove("dark"); return 1;`); const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) (await import("node:fs")).writeFileSync(join(process.env.SHOTS, "prep-" + (process.env.PN_LIGHT ? "light-" : "") + name + ".png"), Buffer.from(r.result.data, "base64")); };

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
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const load = async (url) => { reqs.length = 0; await call("Page.navigate", { url }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(500); };
  const tile = `return !!document.querySelector('.rnav-tile[data-act=prep]');`;

  // ---- default OFF
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.removeItem("smd_prep"); localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_home_tools");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await load(BASE);
  ok(reqs.some((u) => /prep-loader\.js\?v=/.test(u)) && !reqs.some((u) => /\/prep(\.js|\.css)/.test(u)), "boot loads prep-loader.js and not prep.js or prep.css");
  ok(await ev(tile) === false, "default OFF: no PrepNucleus tile");
  ok(await ev(`return PREP.open();`) === false && await ev(`return !document.getElementById("smdPrep");`) === true, "default OFF: PREP.open() does nothing");

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

  // ---- subject
  await click("#smdPrep .pn-tile[data-s=anatomy]");
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
  let seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push(await ev(`return document.querySelector("#smdPrep .pn-q").textContent;`));
    if (i === 0) { await click("#smdPrep [data-act=bookmark]"); ok(await ev(`return document.querySelector("#smdPrep [data-act=bookmark]").getAttribute("aria-pressed");`) === "true", "bookmark toggles on"); }
    await click('#smdPrep .pn-opt[data-k="1"]');
    if (i === 0) {
      ok(await until(`return !!document.querySelector("#smdPrep .pn-fb .pn-exp");`, 3000), "an answer shows the verdict and explanation at once");
      ok(await ev(`return document.querySelector("#smdPrep .pn-prov").textContent;`) === "Source: MedMCQA (MIT licence)", "source line under the explanation");
      ok(await ev(`return document.querySelectorAll("#smdPrep .pn-opt.right").length === 1;`) === true, "the right option is marked");
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
    await click("#smdPrep [data-act=next]");
  }
  ok(await until(`return /Set finished/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 5000), "after the last question: results");
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
  await click('#smdPrep .pn-opt[data-k="0"]');
  ok(await ev(`return !document.querySelector("#smdPrep .pn-fb");`) === true, "no feedback during a test");
  await shot("exam");
  await click("#smdPrep [data-act=markq]");
  await click("#smdPrep [data-act=qgrid]");
  await shot("qgrid");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-qn").length > 0 && !!document.querySelector("#smdPrep .pn-qn.ans.mark");`, 3000), "question grid shows answered and marked");
  await click("#smdPrep .pn-qgrid + p + [data-act=submit]");
  await sleep(300); await shot("result");
  ok(await until(`return /Test marked/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 5000), "submit marks the test");
  await click("#smdPrep [data-act=donerun]");

  // ---- search within the subject
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=search]");`, 3000), "the subject screen has a search button");
  await click("#smdPrep [data-act=search]");
  ok(await until(`return document.activeElement && document.activeElement.id === "pnSearch";`, 3000), "search opens with the field focused");
  await ev(`var i=document.getElementById("pnSearch"); i.value="brachial fixture"; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  ok(await until(`return document.querySelectorAll("#smdPrep [data-act=hit]").length === 3;`, 5000), "search finds the 3 matching questions: " + await ev(`return (document.getElementById("pnHits")||{}).textContent;`));
  await shot("search");
  await click('#smdPrep [data-act=hit][data-i="ana-brachial-plexus-q2"]');
  ok(await until(`var q=document.querySelector("#smdPrep .pn-q"); return !!q && /Fixture question 2 of ana-brachial-plexus/.test(q.textContent);`, 5000), "a hit opens that question");
  await ev(`PREP.back(); PREP.back(); return 1;`);

  // ---- back to home: bookmark count, exam tab
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-tabs");`, 5000), "back() unwinds to home");
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
