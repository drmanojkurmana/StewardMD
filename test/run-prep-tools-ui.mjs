/* PrepNucleus study tools and revision timetable in the REAL app (headless Chromium over raw CDP), owner 2026-10-30.
 * What must hold:
 *  - cross out: every option has its own toggle before the answer; a struck option dims and reads "Bring back"; the
 *    toggles go once the answer shows; a timed test has them too;
 *  - notes: the pencil opens a sheet, Save puts the note under the explanation and in the store, Delete removes it;
 *  - how others answered: bars show only for an item the server returned (MOCKED /api/prep/stats?pct=1), never for
 *    one it left out; with anonymous statistics on, a finished practice set POSTs its answers (type practice);
 *  - a timed test's marked question lands in My notebook (Marked in tests), and the notebook lists notes;
 *  - Reset progress: refused with sync on; one subject clears its cards and keeps bookmarks and notes;
 *  - ReWise: made by topic (ticked weak topic first), six daily blocks with targets, Today's plan and the reminder line
 *    name what to read and practise, the day list lines up with the Today card (phone and iPad), a rest day plans
 *    reviews only, a past exam date is called out;
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
      if (/\/api\/prep\/stats\?rank=1/.test(url) || (/\/api\/prep\/stats$/.test(url) && /"kind":"rank"/.test(p.request.postData || ""))) {
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
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/prep/stats*", requestStage: "Request" }] });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_SETUP=false; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep","1"); localStorage.setItem("smd_prep_stats","1");}catch(e){}` });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!window.PREP_TOOLS && !!window.PREP_TT && !!document.querySelector("#smdPrep .pn-home");`, 20000), "prep-tools.js and prep-timetable.js load with PrepNucleus");
  ok(await ev(`return !!document.querySelector('link[data-prep="prep-tools.css"]') && !!document.querySelector('link[data-prep="prep-timetable.css"]') && PREP_LOADER.V === "prep117";`) === true, "both stylesheets load; loader at prep103");
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

  // ---- ReWise (revision plan v2, owner 2026-10-31)
  await act("tt-open");
  ok(await until(`return !!document.querySelector("#smdPrep .tt-edit") && !!document.querySelector("#smdPrep [data-act=tt-hrs]") && !!document.querySelector("#smdPrep [data-act=tt-gt]") && !!document.querySelector("#smdPrep .tt-wk");`, 3000), "ReWise opens on the editor: hours, rest days, grand test day, weak topics");
  ok(await small("#smdPrep .tt-edit") === "", "editor buttons at least 44 px " + await small("#smdPrep .tt-edit"));
  await shot("rw-edit");
  // A study day today: no rest days, no grand test, 4 hours, one topic ticked weak.
  await ev(`[].forEach.call(document.querySelectorAll("#smdPrep [data-act=tt-off][aria-pressed=true]"), function(b){ b.click(); }); return 1;`);
  await until(`return !document.querySelector("#smdPrep [data-act=tt-off][aria-pressed=true]");`, 3000);
  ok(/No rest day/.test(await text("#smdPrep .tt-edit")), "no rest day is allowed but warned");
  await click('#smdPrep [data-act=tt-gt][data-v="-1"]');
  await click('#smdPrep [data-act=tt-hrs][data-v="4"]');
  await until(`return document.querySelector('#smdPrep [data-act=tt-hrs][data-v="4"]').getAttribute("aria-pressed") === "true";`, 3000);
  const weakId = await ev(`var b=document.querySelectorAll("#smdPrep [data-act=tt-weak]"); var x=b[b.length-1]; x.click(); return x.getAttribute("data-v");`);
  await until(`return !!document.querySelector('#smdPrep [data-act=tt-weak][aria-pressed=true]');`, 3000);
  await click("#smdPrep [data-act=tt-save]");
  ok(await until(`return !!document.querySelector("#smdPrep .tt-view .tt-today");`, 8000), "Make my ReWise plan shows the plan");
  ok(await store(`!!(s.tt && s.tt.v === 2 && s.tt.days.length > 0 && s.tt.start === PREP._host.today() && s.tt.hrs === 4 && s.tt.weak[${JSON.stringify(weakId)}] === 1)`) === true, "stored as ReWise v2 with its days, hours and the weak tick");
  ok(await store(`s.tt.days[0].k === "learn" && s.tt.days[0].t[0] === ${JSON.stringify(weakId)}`) === true, "day one starts with the ticked weak topic");
  ok(await until(`var w=document.querySelector("#smdPrep .tt-why1"); return !!w && w.textContent === "You marked it weak" && !document.querySelector("#smdPrep .tt-why");`, 3000), "one topic today: its reason sits under the heading, not repeated in a list: " + await text("#smdPrep .tt-why1"));
  ok(await ev(`return [].map.call(document.querySelectorAll("#smdPrep .tt-bk .tt-bn > b"), function(b){ return b.firstChild.textContent.trim(); }).join("|");`) === "Recall|Read|Topic MCQs|Mixed MCQs|Error review|Quick recall", "the day's six blocks in order");
  ok(/(\d+) questions on/.test(await text("#smdPrep .tt-bks")), "Topic MCQs carry a question target");
  ok(await ev(`return document.querySelectorAll("#smdPrep .tt-dr").length >= 1 && /Today/.test(document.querySelector("#smdPrep .tt-dr").textContent);`) === true, "the day list starts today, with dates");
  ok(await ev(`var a=document.querySelector("#smdPrep .tt-today").getBoundingClientRect(), b=document.querySelector("#smdPrep .tt-days").getBoundingClientRect(); return Math.abs(a.left-b.left) < 1 && Math.abs(a.width-b.width) < 1;`) === true, "the day list lines up with the Today card");
  ok(await ev(`var w = PREP_TT.today(PREP._host); return w && w.k === "study" && w.mods.length >= 1;`) === true, "Today's plan sees a study day with its topics");
  ok(/^Read .+\. Practise \d+ questions on .+\.$/.test(await ev(`return PREP_TT.notice(PREP._host, 0).body;`)), "the reminder line says what to read and practise: " + await ev(`return PREP_TT.notice(PREP._host, 0).body;`));
  // Tick a block by hand (Read has no lesson here, so it is a tick).
  await click('#smdPrep [data-act=tt-tick][data-v="read"]');
  ok(await until(`return document.querySelector('#smdPrep [data-act=tt-tick][data-v="read"]').getAttribute("aria-checked") === "true" && !!PREP._host.store().tt.tk[PREP._host.today()].read;`, 3000), "a block ticks and is kept");
  // Measured blocks: Topic MCQs counts answers in today's topics; Quick recall counts cards graded today.
  ok(await until(`return /0 of \\d+/.test(document.querySelector('#smdPrep [data-act=tt-tick][data-v="topic"]').closest("li").textContent) && /0 of \\d+/.test(document.querySelector('#smdPrep [data-act=tt-tick][data-v="quick"]').closest("li").textContent);`, 8000), "Topic MCQs and Quick recall show their progress");
  await ev(`var s=PREP._host.store(), it=s.pt.items.filter(function(i){return i.k==="prac";})[0]; it.mods.forEach(function(p){ var m=s.mod[p.m]||(s.mod[p.m]={t:0,ok:0}); m.t += it.n; }); PREP._host.save(); PREP._host.rerender(); return 1;`);
  ok(await until(`return document.querySelector('#smdPrep [data-act=tt-tick][data-v="topic"]').getAttribute("aria-checked") === "true";`, 3000), "Topic MCQs tick themselves once the answers are in");
  // Error review: its own run over My mistakes; each answer counts.
  await ev(`var s=PREP._host.store(); s.mt = s.mt || {}; s.mt["${Q1}"] = ["anatomy","ana-brachial-plexus",null,Date.now()]; PREP._host.save(); PREP._host.rerender(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=tt-err]');`, 3000);
  await click('#smdPrep [data-act=tt-err]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && /Error review/.test(document.getElementById("smdPrep").innerText);`, 8000), "Error review opens a run of my mistakes");
  await click('#smdPrep .pn-opt[data-k="0"]');
  ok(await until(`var a=(PREP._host.store().tt.ac||{})[PREP._host.today()]; return !!a && a.err === 1 && a.errT === 1;`, 5000), "the answer counts toward Error review");
  await ev(`while (PREP._host.stack().length > 1) PREP._host.stack().pop(); PREP._host.stack().push(function(){}); PREP._host.rerender(); return 1;`);
  await act("tt-open");
  ok(await until(`var b=document.querySelector('#smdPrep [data-act=tt-tick][data-v="errors"]'); return !!b && b.getAttribute("aria-checked") === "true";`, 5000), "Error review ticks itself when its run is done");
  // The day's QBank modules: listed with size and progress, and each opens in QBank.
  ok(await until(`var r=document.querySelector('#smdPrep .tt-qbl .tt-qb[data-m="ana-brachial-plexus"]'); return !!r && /QBank modules for today/.test(document.querySelector("#smdPrep .tt-view").innerText) && /\\d+ questions · \\d+ seen/.test(r.textContent);`, 3000), "today's QBank module is listed with its questions and progress: " + await text("#smdPrep .tt-qbl"));
  ok(await small("#smdPrep .tt-qbl") === "", "QBank rows at least 44 px");
  await click('#smdPrep .tt-qb[data-m="ana-brachial-plexus"]');
  ok(await until(`return !document.querySelector("#smdPrep .tt-view") && /Brachial plexus/.test(document.getElementById("smdPrep").innerText);`, 5000), "the QBank row opens the module");
  await ev(`while (PREP._host.stack().length > 1) PREP._host.stack().pop(); PREP._host.rerender(); return 1;`);
  await act("tt-open");
  await until(`return !!document.querySelector("#smdPrep .tt-view");`, 3000);
  // A grand test review day: the test's own misses are named one by one, and its most-missed module is repaired.
  await ev(`var s=PREP._host.store(), td=PREP._host.today(); s.tt.days.forEach(function(y){ if (y.d === td) { y.k = "gtr"; y.t = []; } }); s.mt["${Q1}"] = ["anatomy","ana-brachial-plexus",null,Date.now(),"A man cannot abduct his arm"]; s.mh = (s.mh||[]).concat([{ ts: Date.now() - 864e5, label: "NEET-PG pattern", marks: 40, max: 200, n: 50, wq: ["${Q1}"], wm: { "ana-brachial-plexus": 1 } }]); s.pt = null; PREP._host.save(); PREP._host.rerender(); return 1;`);
  ok(await until(`var v=document.querySelector("#smdPrep .tt-view"); return !!v && /Name each error/.test(v.innerText) && /0 of 1/.test(v.innerText) && /QBank modules to repair today/.test(v.innerText) && /1 missed in the test/.test(v.innerText) && /1 miss, 0 named/.test(v.innerText);`, 5000), "review day: name each error (0 of 1), the test's most-missed module to repair");
  await click("#smdPrep [data-act=tt-gtrev]");
  ok(await until(`return !!document.querySelector("#smdPrep .tt-gr") && /A man cannot abduct his arm/.test(document.querySelector("#smdPrep .tt-gr").innerText) && document.querySelectorAll("#smdPrep [data-act=tt-tag]").length === 4;`, 3000), "the review lists the miss with four reasons");
  ok(await small("#smdPrep .tt-gr") === "", "review buttons at least 44 px " + await small("#smdPrep .tt-gr"));
  await shot("rw-gt-review");
  await click('#smdPrep [data-act=tt-tag][data-v="mixed"]');
  ok(await until(`return PREP._host.store().mt["${Q1}"][2] === "mixed" && /1 of 1 named/.test(document.querySelector("#smdPrep .tt-gr").innerText);`, 3000), "a reason is saved on the mistake");
  await ev(`PREP._host.stack().pop(); PREP._host.rerender(); return 1;`);
  ok(await until(`var b=document.querySelector('#smdPrep .tt-bk [data-act=tt-gtrev]'); return !!b && b.closest("li").querySelector(".tt-tick").getAttribute("aria-checked") === "true" && /Mixed up two options 1/.test(document.querySelector("#smdPrep .tt-view").innerText);`, 3000), "named: the block ticks itself and the reasons are counted");
  await shot("rw-gt-day");
  await ev(`var s=PREP._host.store(), td=PREP._host.today(); s.tt.days.forEach(function(y){ if (y.d === td) { y.k = "learn"; y.t = ["ana-brachial-plexus"]; } }); s.pt = null; PREP._host.save(); PREP._host.rerender(); return 1;`);
  await until(`return /QBank modules for today/.test(document.querySelector("#smdPrep .tt-view").innerText);`, 3000);
  // The PDF: shared through the phone's share sheet; here the harness takes the download.
  await click("#smdPrep [data-act=tt-pdf]");
  ok(await until(`return !!window.__rwPdf && /^ReWise-plan-\\d{4}-\\d{2}-\\d{2}\\.pdf$/.test(window.__rwPdf.name) && window.__rwPdf.size > 2000;`, 3000), "Share the plan as PDF makes the file");
  const pdfBin = await ev(`return PREP_TT._pdf(PREP._host);`);
  ok(typeof pdfBin === "string" && pdfBin.startsWith("%PDF-1.4"), "the PDF starts as a PDF");
  if (typeof pdfBin === "string") {
    const f = join(process.env.CLAUDE_JOB_DIR || tmpdir(), "rewise-" + Date.now() + ".pdf");
    writeFileSync(f, Buffer.from(pdfBin, "latin1"));
    if (SHOTS) writeFileSync(join(SHOTS, "rewise.pdf"), Buffer.from(pdfBin, "latin1"));
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
    if (r.status === 0) ok(/ReWise: NEET-PG/.test(r.stdout) && /Date-wise plan/.test(r.stdout) && /Brachial plexus/.test(r.stdout) && /Daily routine/.test(r.stdout) && /You marked it weak/.test(r.stdout), "pdftotext reads the plan: title, routine, dates, the weak topic and its reason");
    if (r.status === 0) ok(/QBank modules/.test(r.stdout), "the date table names the QBank modules");
    else console.log("SKIP pdftotext not installed");
  }
  await shot("rw-view");
  // iPad width: the lists stay in the panel column (the screenshot bug).
  await call("Emulation.setDeviceMetricsOverride", { width: 1000, height: 750, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  ok(await ev(`var a=document.querySelector("#smdPrep .tt-today").getBoundingClientRect(), b=document.querySelector("#smdPrep .tt-days").getBoundingClientRect(), h=document.querySelector("#smdPrep .tt-view > .pn-sec").getBoundingClientRect(); return Math.abs(a.left-b.left) < 1 && Math.abs(a.left-h.left) < 1 && a.left > 40 && Math.abs((a.left + a.width / 2) - innerWidth / 2) < 2;`) === true, "iPad: Today card, headings and the day list share one centred column");
  await shot("rw-view-ipad");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // Home: the plan follows ReWise.
  await ev(`while (PREP._host.stack().length > 1) PREP._host.stack().pop(); PREP._host.rerender(); return 1;`);
  ok(await until(`var s=PREP._host.store(), l=document.querySelector("#smdPrep .tt-line"); return !!l && /ReWise/.test(l.textContent) && !!s.pt && s.pt.rw === 1 && s.pt.items.some(function(i){ return i.k === "prac" && /^Practise \\d+ questions: /.test(i.ttl); });`, 8000), "home: the plan line says ReWise and the plan holds today's practice");
  ok(await ev(`var s=PREP._host.store(), p=s.pt.items.filter(function(i){return i.k==="prac";})[0], m=s.pt.items.filter(function(i){return i.k==="mix";})[0]; return !m || !m.mods.some(function(x){ return p.mods.some(function(y){ return y.m === x.m; }); });`) === true, "mixed practice never shares a module with today's topics, so each counts its own answers");
  ok(await until(`return [].some.call(document.querySelectorAll("#smdPrep .pl-item b"), function(b){ return /Practise \\d+ questions/.test(b.textContent); });`, 5000), "home: Today's plan names the practice");
  ok(await ev(`var x = PREP_PLAN.snapshot(PREP._host); return !!(x.rw && x.rw[0] && /Practise/.test(x.rw[0].body));`) === true, "the widget and reminder snapshot carries the ReWise line");
  await shot("rw-home");
  // A rest day today: edit, set today's weekday off, save.
  await act("tt-open");
  await until(`return !!document.querySelector("#smdPrep .tt-view");`, 3000);
  await click("#smdPrep [data-act=tt-edit]");
  await until(`return !!document.querySelector("#smdPrep .tt-edit");`, 3000);
  await ev(`var wd=(PREP._host.today()+4)%7; document.querySelector('#smdPrep [data-act=tt-off][data-v="'+wd+'"]').click(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=tt-off][aria-pressed=true]");`, 3000);
  await click("#smdPrep [data-act=tt-save]");
  ok(await until(`var k=document.querySelector("#smdPrep .tt-kind"); return !!k && /Rest day/.test(k.textContent);`, 8000), "today set as a rest day reads Rest day");
  ok(await ev(`var w = PREP_TT.today(PREP._host); return w && w.k === "rest";`) === true, "Today's plan sees a rest day");
  // An exam date in the past is called out.
  await ev(`var s=PREP._host.store(); s.pl = s.pl || {}; s.pl.date = new Date((PREP._host.today()-7)*864e5).toISOString().slice(0,10); PREP._host.save(); PREP._host.rerender(); return 1;`);
  ok(await until(`var w=document.querySelector("#smdPrep .tt-view .tt-warn"); return !!w && /has passed/.test(w.textContent);`, 3000), "a past exam date is called out: " + await text("#smdPrep .tt-view .tt-warn"));
  await ev(`var s=PREP._host.store(); s.pl.date = null; PREP._host.save(); return 1;`);
  await ev(`while (PREP._host.stack().length > 1) PREP._host.stack().pop(); PREP._host.rerender(); return 1;`);
  ok(await until(`var s=PREP._host.store(); return !!document.querySelector("#smdPrep .tt-line") && !!s.pt && s.pt.items.every(function(i){ return i.k === "rev"; });`, 8000), "home: a rest day holds reviews only");
  await shot("rw-home-rest");
  // A stored v1 (subject) timetable switches to ReWise by itself on the next home draw, same subjects and rest days.
  await ev(`var s=PREP._host.store(), td=PREP._host.today(), sid=s.tt.order[0]; s.tt = { v: 1, ex: PREP._host.exam().id, start: td, end: td + 20, off: [0], order: [sid], done: {}, blocks: [{ sid: sid, from: td, to: td + 20, days: 18 }] }; s.pt = null; PREP._host.save(); PREP._host.rerender(); return 1;`);
  ok(await until(`var t=PREP._host.store().tt; return !!t && t.v === 2 && t.off.length === 1 && t.off[0] === 0 && t.order.length === 1 && t.days.length >= 20;`, 8000), "a v1 timetable becomes ReWise by itself");

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
  ok(api.rank[1].method === "GET" && /rank=1&key=neet-pg%3Agrand&pct=51.5/.test(api.rank[1].url), "not opted in: read only (GET) " + api.rank[1].url);
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
