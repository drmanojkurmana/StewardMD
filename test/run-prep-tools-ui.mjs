/* PrepNucleus study tools and revision timetable in the REAL app (headless Chromium over raw CDP), owner 2026-10-30.
 * What must hold:
 *  - cross out: every option has its own toggle before the answer; a struck option dims and reads "Bring back"; the
 *    toggles go once the answer shows; a timed test has them too;
 *  - notes: the pencil opens a sheet, Save puts the note under the explanation and in the store, Delete removes it;
 *  - how others answered: bars show only for an item the server returned (MOCKED /api/prep/stats?pct=1), never for
 *    one it left out; with anonymous statistics on, a finished practice set POSTs its answers (type practice);
 *  - a timed test's marked question lands in My notebook (Marked in tests), and the notebook lists notes;
 *  - Reset progress: refused with sync on; one subject clears its cards and keeps bookmarks and notes;
 *  - timetable: made from the defaults, Today's plan names today's subject; a rest day today plans reviews only;
 *  - no em or en dash on screen, buttons at least 44 px on the new screens, no uncaught error.
 * Screenshots (phone 390 x 844, light and dark): SHOTS=<dir>.
 * USAGE: node test/run-prep-tools-ui.mjs   (CHROME, CHROME_PORT, BASE, SHOTS)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/prep-tools-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");
const SHOTS = process.env.SHOTS || "";
const Q1 = "ana-brachial-plexus-q1", Q2 = "ana-brachial-plexus-q2";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}

const api = { posts: [], pct: [], rank: [], rankN: 7 };
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
const screenText = () => ev(`var r=document.getElementById("smdPrep"); return r ? r.innerText : "";`);
const small = (scope) => ev(`var r=document.querySelector(${JSON.stringify(scope)}); if(!r) return "none"; return [].filter.call(r.querySelectorAll("button"), function(b){ return b.offsetParent && !b.closest(".pn-bar") && b.getBoundingClientRect().height < 44 * 0.95 - 0.5; }).map(function(b){ return (b.getAttribute("data-act")||"") + ":" + Math.round(b.getBoundingClientRect().height); }).join(",");`);
// A tools action as the app dispatches it: a real button in the PrepNucleus root, clicked.
const act = (a, v) => ev(`var r=document.getElementById("smdPrep"), b=document.createElement("button"); b.type="button"; b.setAttribute("data-act", ${JSON.stringify(a)}); ${v != null ? `b.setAttribute("data-v", ${JSON.stringify(String(v))});` : ""} b.hidden=true; r.appendChild(b); b.click(); if (b.parentNode) b.parentNode.removeChild(b); return 1;`);
async function shot(name) {
  if (!SHOTS) return;
  for (const dark of [false, true]) {
    await ev(`document.body.classList.toggle("dark", ${dark}); document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
    await sleep(200);
    const r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) writeFileSync(join(SHOTS, name + (dark ? "-dark" : "-light") + ".png"), Buffer.from(r.result.data, "base64"));
  }
  await ev(`document.body.classList.remove("dark"); return 1;`);
}
const store = (expr) => ev(`var s=PREP._host.store(); return ${expr};`);
const startRun = (mode) => ev(`PREP.loadItems("anatomy","ana-brachial-plexus").then(function(items){ window.__items = items; PREP._host.run(items.slice(), ${JSON.stringify(mode)}, "Tools fixture"); }); return 1;`);

try {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-600));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
    if (m.method === "Fetch.requestPaused") {
      const p = m.params, url = p.request.url;
      let status = 404, body = { error: "not-found" };
      if (/\/api\/prep\/rank/.test(url)) {
        api.rank.push({ method: p.request.method, url, post: p.request.postData || null });
        const n = api.rankN; status = 200;
        body = n >= 20 ? { n, above: 4, same: 1, below: n - 5, min: 20, rank: 5, percentile: Math.round(((n - 5) + 0.5) / n * 100) } : { n, above: 2, same: 0, below: n - 2, min: 20, rank: null, percentile: null };
      } else if (/\/api\/prep\/stats\?pct=1/.test(url)) {
        api.pct.push(url);
        // q1 has enough answers; q2 and q3 do not, so the server leaves them out.
        status = 200; body = { min: 30, items: { [Q1]: { n: 412, o: [61, 22, 12, 5] } } };
      } else if (/\/api\/prep\/stats$/.test(url) && p.request.method === "POST") {
        let post = p.request.postData;
        if (!post && p.request.hasPostData) { const r = await call("Fetch.getRequestPostData", { requestId: p.requestId }); post = r.result && r.result.postData; }
        api.posts.push(JSON.parse(post || "{}")); status = 202; body = { accepted: 1, stored: true };
      }
      call("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("DOM.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/prep/stats*", requestStage: "Request" }, { urlPattern: "*/api/prep/rank*", requestStage: "Request" }] });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_SETUP=false; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep","1"); localStorage.setItem("smd_prep_stats","1");}catch(e){}` });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!window.PREP_TOOLS && !!window.PREP_TT && !!document.querySelector("#smdPrep .pn-home");`, 20000), "prep-tools.js and prep-timetable.js load with PrepNucleus");
  ok(await ev(`return !!document.querySelector('link[data-prep="prep-tools.css"]') && !!document.querySelector('link[data-prep="prep-timetable.css"]') && PREP_LOADER.V === "prep98";`) === true, "both stylesheets load; loader at prep98");
  ok(await ev(`return !!document.querySelector('#smdPrep [data-act=x-notebook]') && !!document.querySelector('#smdPrep [data-act=tt-open]');`) === true, "home lists My notebook and Revision timetable");

  // ---- practice: cross out, answer, others, note
  await startRun("study");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && document.querySelectorAll("#smdPrep [data-act=x-strike]").length === 4;`, 10000), "practice: four options, each with a cross out toggle");
  ok(await until(`return ${JSON.stringify(api.pct.length)} >= 0 && !!window.__items;`, 3000) && await until(`return true;`, 300), "items loaded");
  await click('#smdPrep [data-act=x-strike][data-k="2"]');
  ok(await ev(`var o=document.querySelector('#smdPrep .pn-opt[data-k="2"]'), b=document.querySelector('#smdPrep [data-act=x-strike][data-k="2"]'); return o.classList.contains("px-struck") && b.getAttribute("aria-pressed")==="true" && /Bring back option C/.test(b.getAttribute("aria-label"));`) === true, "option C is crossed out and says Bring back");
  ok(await ev(`return document.querySelectorAll("#smdPrep .px-struck").length === 1;`) === true, "only that option is struck");
  await shot("tools-strike");
  await click('#smdPrep [data-act=x-strike][data-k="2"]');
  ok(await ev(`return !document.querySelector("#smdPrep .px-struck");`) === true, "tapping again brings it back");
  await click('#smdPrep [data-act=x-strike][data-k="3"]');
  await click('#smdPrep .pn-opt[data-k="1"]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 5000), "answering shows the explanation");
  ok(await ev(`return !document.querySelector("#smdPrep [data-act=x-strike]") && !document.querySelector("#smdPrep .px-struck");`) === true, "after the answer: no toggles, nothing dimmed");
  ok(api.pct.length >= 1 && api.pct[0].indexOf(Q1) > 0, "how others answered was asked once for the set");
  ok(await until(`return !!document.querySelector("#smdPrep .px-peer");`, 5000), "how others answered shows for q1 (the server returned it)");
  ok(await ev(`var p=document.querySelector("#smdPrep .px-peer"); return /412 PrepNucleus answers/.test(p.innerText) && p.querySelectorAll(".px-pr").length===4 && !!p.querySelector(".px-pr.ok") && !!p.querySelector(".px-pr.me");`) === true, "four bars, the answer count, the right answer and your pick marked");
  await shot("tools-peer");
  await click("#smdPrep [data-act=x-note]");
  ok(await until(`return !!document.querySelector("#pxSheet #pxNoteIn");`, 3000), "the pencil opens the note sheet");
  ok(await small("#pxSheet") === "", "note sheet buttons at least 44 px " + await small("#pxSheet"));
  await ev(`document.getElementById("pxNoteIn").value = "Axillary: C5, C6. Trap: radial."; return 1;`);
  await shot("tools-note-sheet");
  await click("#pxSheet [data-act=x-nsave]");
  ok(await until(`return !document.getElementById("pxSheet") && /Axillary: C5, C6/.test(document.querySelector("#smdPrep .px-note").innerText);`, 3000), "saved: the note shows under the explanation");
  ok(await store(`!!(s.qn && s.qn["${Q1}"] && s.qn["${Q1}"][2] === "Axillary: C5, C6. Trap: radial." && s.qn["${Q1}"][0] === "anatomy")`) === true, "the note is in the store with its subject");
  ok(await ev(`return document.querySelector("#smdPrep [data-act=x-note]").classList.contains("on");`) === true, "the pencil shows a note exists");
  await click("#smdPrep [data-act=next]");
  ok(await until(`return PREP._st.run.i === 1 && document.querySelectorAll("#smdPrep [data-act=x-strike]").length === 4;`, 3000), "question 2: toggles again, no strike carried over");
  await click('#smdPrep .pn-opt[data-k="1"]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 3000) && await ev(`return !document.querySelector("#smdPrep .px-peer");`) === true, "q2: no bars (too few answers on the server)");
  await click("#smdPrep [data-act=next]");
  await until(`return PREP._st.run.i === 2;`, 3000);
  await click('#smdPrep .pn-opt[data-k="0"]');
  await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 3000);
  await click("#smdPrep [data-act=next]");
  ok(await until(`return ${"true"} && PREP._st.run.done === true;`, 5000), "the set finishes");
  ok(await until(`return true;`, 600) && api.posts.some((b) => b.type === "practice" && b.exam === "neet-pg" && b.items.length === 3 && b.items.some((r) => r[0] === Q1 && r[3] === 1 && r[1] === 0)), "anonymous statistics on: the 3 practice answers were sent " + JSON.stringify(api.posts.map((b) => [b.type, b.items.length])));

  // ---- a timed test: cross out exists, a mark goes to the notebook
  await startRun("exam");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && PREP._st.run.mode === "exam" && document.querySelectorAll("#smdPrep [data-act=x-strike]").length === 4;`, 8000), "timed test: cross out toggles too");
  ok(await ev(`return !document.querySelector("#smdPrep [data-act=x-note]");`) === true, "timed test: no note button (the bar keeps to the clock)");
  await click('#smdPrep .pn-opt[data-k="0"]');
  await click("#smdPrep [data-act=markq]");
  await click("#smdPrep [data-act=next]");
  await until(`return PREP._st.run.i === 1;`, 3000);
  await ev(`PREP._st.run.i = 2; PREP._host.rerender(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=submit]");`, 3000);
  await click("#smdPrep [data-act=submit]");
  ok(await until(`return PREP._st.run.done === true;`, 5000), "the test is submitted");
  ok(await store(`!!(s.mk && s.mk["${Q1}"] && s.mk["${Q1}"][0] === "anatomy") && !s.mk["${Q2}"]`) === true, "the marked question is in Marked in tests, the unmarked one is not");

  // ---- My notebook
  await act("x-notebook");
  ok(await until(`return /My notebook/.test(document.querySelector("#smdPrep .pn-bar h1").textContent) && /Axillary: C5, C6/.test(document.querySelector("#smdPrep .px-list").innerText);`, 3000), "My notebook lists the note");
  ok(await ev(`return /Notes \\(1\\)/.test(document.querySelector("#smdPrep .px-tabs").innerText) && /Marked in tests \\(1\\)/.test(document.querySelector("#smdPrep .px-tabs").innerText);`) === true, "tabs count 1 note and 1 marked");
  ok(await small("#smdPrep .px-nb-body") === "", "notebook buttons at least 44 px " + await small("#smdPrep .px-nb-body"));
  await shot("tools-notebook");
  await click('#smdPrep [data-act=x-nbtab][data-v=marked]');
  ok(await until(`return /Fixture question 1/.test(document.querySelector("#smdPrep .px-list").innerText);`, 3000), "Marked in tests lists the question");
  await click("#smdPrep [data-act=x-nbrun]");
  ok(await until(`return !!PREP._st.run && !PREP._st.run.done && PREP._st.run.items.length === 1 && PREP._st.run.items[0].id === "${Q1}";`, 8000), "Practise these reloads the marked question");
  await ev(`PREP._host.back(); return 1;`);

  // ---- Progress and data, Reset
  await act("x-data");
  ok(await until(`return !!document.querySelector("#smdPrep .px-data");`, 3000), "Progress and data opens");
  ok(await ev(`return /On: tap to stop sharing/.test(document.querySelector("#smdPrep [data-act=x-stats]").textContent);`) === true, "statistics switch reads On");
  await ev(`window.__sync = window.PREP_SYNC; window.PREP_SYNC = { status: function () { return { on: true }; } }; PREP._host.rerender(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .px-warn") && !document.querySelector("#smdPrep [data-act=x-rgo]");`, 3000), "sync on: reset refused, with the reason");
  await ev(`window.PREP_SYNC = window.__sync; PREP._host.rerender(); return 1;`);
  ok(await store(`Object.keys(s.cards).some(function(k){ return k.indexOf("p:ana-brachial-plexus:") === 0; })`) === true, "before reset: anatomy cards exist");
  await ev(`var s=PREP._host.store(); s.bm["${Q2}"] = ["anatomy","ana-brachial-plexus",Date.now()]; PREP._host.save(); return 1;`);
  await click('#smdPrep [data-act=x-rsub][data-v=anatomy]');
  ok(await until(`return /Reset Anatomy/.test(document.querySelector("#smdPrep [data-act=x-rgo]").textContent);`, 3000), "picking Anatomy names it on the button");
  ok(await small("#smdPrep .px-data") === "", "data screen buttons at least 44 px " + await small("#smdPrep .px-data"));
  await until(`return getComputedStyle(document.querySelector("#smdPrep [data-act=x-rgo]")).opacity === "1";`, 3000);   // the fade from disabled
  const rbg = await ev(`var b=document.querySelector("#smdPrep [data-act=x-rgo]"), cs=getComputedStyle(b); return cs.backgroundColor + "|" + cs.color + "|" + cs.opacity;`);
  ok(/^rgb\(180, 35, 24\)\|rgb\(255, 255, 255\)\|1$/.test(rbg), "Reset reads as a red button, white text, full opacity: " + rbg);
  await shot("tools-data");
  await click("#smdPrep [data-act=x-rgo]");
  ok(await until(`return !!document.querySelector("#pxSheet [data-act=x-rdo]");`, 3000), "Reset asks first");
  ok(/uses one of your 3 resets for the year \(2 left after it\)/.test(await text("#pxSheet")), "the confirm sheet says it uses one of 3");
  await shot("tools-reset-ask");
  await click("#pxSheet [data-act=x-rdo]");
  ok(await until(`var s=PREP._host.store(); return !Object.keys(s.cards).some(function(k){ return k.indexOf("p:ana-brachial-plexus:") === 0; }) && !s.mod["ana-brachial-plexus"];`, 8000), "after reset: anatomy cards and accuracy are gone");
  ok(await store(`!!s.bm["${Q2}"] && !!s.qn["${Q1}"] && !!s.mk["${Q1}"]`) === true, "bookmarks, notes and marked questions stay");
  ok(await store(`Array.isArray(s.rsl) && s.rsl.length === 1`) === true, "the reset is logged");
  ok(await until(`var w=document.querySelector("#smdPrep .px-data .px-warn"); return !!w && /next reset is available on/.test(w.textContent) && !document.querySelector("#smdPrep [data-act=x-rgo]") && !document.querySelector("#smdPrep [data-act=x-rsub]");`, 3000), "a second reset within 3 months is refused, with the date and no subject choice");
  ok(/2 of 3 left/.test(await text("#smdPrep .px-quota")), "the quota reads 2 of 3 left: " + await text("#smdPrep .px-quota"));
  await shot("tools-reset-limit");

  // ---- Revision timetable
  await act("tt-open");
  ok(await until(`return !!document.querySelector("#smdPrep .tt-edit") && document.querySelectorAll("#smdPrep .tt-sr").length > 0;`, 3000), "timetable opens on the editor with the exam's subjects");
  ok(await small("#smdPrep .tt-edit") === "", "editor buttons at least 44 px " + await small("#smdPrep .tt-edit"));
  const first = await ev(`return document.querySelector("#smdPrep .tt-sr b").textContent;`);
  await shot("tt-edit");
  // Make sure today is a study day: no rest days.
  await ev(`var wd=(PREP._host.today()+4)%7; [].forEach.call(document.querySelectorAll("#smdPrep [data-act=tt-off][aria-pressed=true]"), function(b){ b.click(); }); return wd;`);
  await until(`return !document.querySelector("#smdPrep [data-act=tt-off][aria-pressed=true]");`, 3000);
  await click("#smdPrep [data-act=tt-save]");
  ok(await until(`return !!document.querySelector("#smdPrep .tt-view .tt-today");`, 3000), "Make timetable shows the timetable");
  ok(await store(`!!(s.tt && s.tt.blocks && s.tt.blocks.length > 0 && s.tt.start === PREP._host.today())`) === true, "the timetable is stored with its blocks");
  ok(await ev(`return document.querySelector("#smdPrep .tt-now b").textContent;`) === first.replace(/^1\. /, ""), "today is the first subject: " + first);
  ok(await ev(`return document.querySelectorAll("#smdPrep .tt-week li").length === 7;`) === true, "this week shows 7 days");
  await shot("tt-view");
  ok(await ev(`var w = PREP_TT.today(PREP._host); return w && w.k === "study";`) === true, "Today's plan sees a study day");
  // A rest day today: edit, set today's weekday off, save.
  await click("#smdPrep [data-act=tt-edit]");
  await until(`return !!document.querySelector("#smdPrep .tt-edit");`, 3000);
  await ev(`var wd=(PREP._host.today()+4)%7; document.querySelector('#smdPrep [data-act=tt-off][data-v="'+wd+'"]').click(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=tt-off][aria-pressed=true]");`, 3000);
  await click("#smdPrep [data-act=tt-save]");
  ok(await until(`return /Rest day/.test(document.querySelector("#smdPrep .tt-now").innerText);`, 3000), "today set as a rest day reads Rest day");
  ok(await ev(`var w = PREP_TT.today(PREP._host); return w && w.k === "rest";`) === true, "Today's plan sees a rest day");
  await ev(`while (PREP._host.stack().length > 1) PREP._host.stack().pop(); PREP._host.rerender(); return 1;`);
  ok(await until(`var s=PREP._host.store(); return !!document.querySelector("#smdPrep .tt-line") && /rest day/i.test(document.querySelector("#smdPrep .tt-line").textContent) && !!s.pt && s.pt.items.every(function(i){ return i.k === "rev"; });`, 8000), "home: the plan says rest day and holds reviews only");
  await shot("tt-home");

  // ---- rank on a test result (prep-tests.js): opted in, the score is added (POST); under 20 attempts no rank shows
  const rk = async () => { await ev(`window.__t = { type: "grand", exam: "neet-pg" }; window.__r = PREP._st.run; PREP_TESTS._rank.fetch(window.__r, { score: { raw: 412, max: 800 } }, { id: "neet-pg" }, window.__t); return 1;`); await until(`return window.__t.rank && window.__t.rank.state === "ok";`, 5000); return ev(`var d=document.createElement("div"); d.innerHTML = PREP_TESTS._rank.html(window.__t); return d.innerText.replace(/\\s+/g, " ");`); };
  ok(await ev(`return PREP_TESTS._rank.key({ id: "neet-pg" }, { type: "grand" }) + "|" + PREP_TESTS._rank.key({ id: "neet-pg" }, { type: "grand", paper: "PG 2024/r1" }) + "|" + PREP_TESTS._rank.pct({ raw: 412, max: 800 }) + "|" + PREP_TESTS._rank.pct({ raw: -900, max: 800 });`) === "neet-pg:grand|neet-pg:grand:PG2024r1|51.5|-100", "rank key and percent");
  api.rankN = 7;
  const few = await rk();
  ok(/Your rank shows once 20 PrepNucleus students have taken a full exam\. 7 so far\./.test(few) && !/percentile/i.test(few), "under 20 attempts: no rank, says how many so far: " + few);
  ok(api.rank.length === 1 && api.rank[0].method === "POST" && JSON.parse(api.rank[0].post).key === "neet-pg:grand" && JSON.parse(api.rank[0].post).pct === 51.5, "opted in: the score was added once (POST, key and percent only) " + JSON.stringify(api.rank[0]));
  api.rankN = 240;
  await ev(`localStorage.setItem("smd_prep_stats", "0"); return 1;`);
  const full = await rk();
  ok(/5\s*of 240/.test(full) && /98\s*percentile/.test(full) && /not an all-India rank/.test(full) && /compared, not added/.test(full), "240 attempts: rank 5 of 240, 98th percentile, labelled as PrepNucleus students only: " + full);
  ok(api.rank[1].method === "GET" && /key=neet-pg%3Agrand&pct=51.5/.test(api.rank[1].url), "not opted in: read only (GET) " + api.rank[1].url);
  await ev(`localStorage.setItem("smd_prep_stats", "1"); return 1;`);

  ok(!DASH.test(await screenText()), "no em or en dash");

  // ---- flags off: ?tools=0&tt=0 leaves both modules out and the runner as before
  await call("Page.navigate", { url: BASE + "?tools=0&tt=0" });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots with the flags off");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-home");`, 20000), "PrepNucleus opens");
  ok(await ev(`return !window.PREP_TOOLS && !window.PREP_TT && !document.querySelector('#smdPrep [data-act=x-notebook]') && !document.querySelector('#smdPrep [data-act=tt-open]') && !document.querySelector('#smdPrep .tt-line');`) === true, "flags off: no tools, no timetable rows, no plan line");
  await startRun("study");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000) && await ev(`return !document.querySelector("#smdPrep [data-act=x-strike]") && !document.querySelector("#smdPrep [data-act=x-note]") && !document.querySelector("#smdPrep li.px-ol");`) === true, "flags off: the runner has no cross out and no note button");
  ok(errors.length === 0, "no uncaught error " + errors.join(" | "));
} catch (e) { console.log("FAIL " + (e && e.stack || e)); fails++; }
finally {
  try { chrome.kill(); } catch {} try { if (serveProc) serveProc.kill(); } catch {}
  console.log(fails ? fails + " failed" : "all passed");
  process.exit(fails ? 1 : 0);
}
