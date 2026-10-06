/* PrepNucleus plan (prep-plan.js) in the REAL app (headless Chrome over CDP), against the fixture bank in test/fixtures/prep.
 * What must hold: the first plain open shows onboarding (exam, date, minutes, reminder; Continue waits for an exam; Back and
 * Skip work) and its answers land in the store; home leads with the readiness line (0 and a friendly line before any
 * answer, the days to the exam) and Today's plan; tapping the line opens "How this is computed" with the three factors and
 * the weakest subjects, each with one action; Escape closes the sheet; answering questions from the plan ticks progress
 * and moves readiness off 0; the settings sheet edits the plan and re-plans (a lesson appears once the exam is more than
 * 14 days away or undecided); a lesson finished today is ticked; skipping onboarding still lands on home and never shows it
 * again; the FMGE tab lists the MBBS subjects, its mock screen carries the bulletin pattern and a mini mock is marked +1
 * with no negative marking and a pass line; the FMGE Arena says coming soon; no uncaught PrepNucleus error, no /api/ai call.
 *
 * USAGE: node test/run-prep-plan-ui.mjs   (SHOTS=<dir> saves screenshots, PN_LIGHT=1 light theme; CHROME=, PORT=, CHROME_PORT=)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-plan-chrome-" + PORT + "-" + Date.now();
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

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
const store = (expr) => ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")||"{}"); return ${expr};`);
const shot = async (name) => { if (!process.env.SHOTS) return; await sleep(350); const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) fs.writeFileSync(join(process.env.SHOTS, "plan-" + (process.env.PN_LIGHT ? "light-" : "") + name + ".png"), Buffer.from(r.result.data, "base64")); };
// An ISO date n days from today, local time.
const isoIn = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
// The fixture has no lessons: the lesson index is stubbed with one fixture module, so the plan can offer it.
const STUB_LESSONS = `if(window.PREP_LESSONS){PREP_LESSONS.index=function(){return Promise.resolve({v:1,modules:{"ana-brachial-plexus":{title:"Brachial plexus",minutes:5,steps:5}}});};} return 1;`;

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
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;};` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_prep_arena");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await ev(process.env.PN_LIGHT ? `if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.remove("dark"); return 1;` : `document.body.classList.add("dark"); return 1;`);

  // ---- onboarding
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pl-q");`, 20000), "the first plain open shows onboarding");
  await ev(STUB_LESSONS);
  ok(/Which exam/.test(await text("#smdPrep .pl-q")) && await ev(`return document.querySelectorAll("#smdPrep [data-act=p-f-exam]").length;`) === 5, "step 1 offers the five exams");
  ok(await ev(`return document.querySelector("#smdPrep [data-act=p-ob-next]").disabled;`) === true, "Continue waits for an exam");
  ok(await ev(`return !!document.querySelector("#smdPrep [data-act=p-skip]") && !document.querySelector("#smdPrep .pn-tabs");`) === true, "Skip is offered; home is not drawn behind");
  await click('#smdPrep [data-act=p-f-exam][data-v=neet-pg]');
  ok(await ev(`return document.querySelector('#smdPrep [data-v=neet-pg]').getAttribute("aria-checked");`) === "true", "picking an exam checks it");
  await shot("ob-exam");
  await click("#smdPrep [data-act=p-ob-next]");
  ok(await until(`return /When is your exam/.test(document.querySelector("#smdPrep .pl-q").textContent) && !!document.getElementById("plDate");`, 3000), "step 2: a native date input");
  ok(await ev(`return document.getElementById("plDate").type;`) === "date" && await ev(`return document.querySelector("#smdPrep [data-act=p-f-nodate]").getAttribute("aria-pressed");`) === "true", "date starts as Not decided yet");
  await ev(`var d=document.getElementById("plDate"); d.value=${JSON.stringify(isoIn(10))}; d.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
  ok(await until(`return document.getElementById("plDate").value===${JSON.stringify(isoIn(10))} && document.querySelector("#smdPrep [data-act=p-f-nodate]").getAttribute("aria-pressed")==="false";`, 3000), "a date clears Not decided");
  await shot("ob-date");
  await click("#smdPrep [data-act=p-ob-back]");
  ok(await until(`return /Which exam/.test(document.querySelector("#smdPrep .pl-q").textContent);`, 3000), "Back returns to step 1 with the choice kept");
  ok(await ev(`return document.querySelector('#smdPrep [data-v=neet-pg]').getAttribute("aria-checked");`) === "true", "the exam is still picked");
  await click("#smdPrep [data-act=p-ob-next]"); await click("#smdPrep [data-act=p-ob-next]");
  ok(await until(`return /How much time/.test(document.querySelector("#smdPrep .pl-q").textContent);`, 3000), "step 3: minutes a day");
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep [data-act=p-f-min]")).map(function(b){return b.getAttribute("data-v");}).join(",");`) === "15,30,60,90,120", "15, 30, 60, 90, 120 minutes");
  await click('#smdPrep [data-act=p-f-min][data-v="120"]');
  await shot("ob-minutes");
  await click("#smdPrep [data-act=p-ob-next]");
  ok(await until(`return /remind you/.test(document.querySelector("#smdPrep .pl-q").textContent) && document.getElementById("plRem").type==="time";`, 3000), "step 4: a native time input");
  await ev(`var d=document.getElementById("plRem"); d.value="07:30"; d.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
  ok(/Reminders arrive in the StewardMD app|Study reminders/.test(await text("#smdPrep .pl-ob")), "the reminder step offers the reminder (or says where it works)");
  await shot("ob-reminder");
  ok(await text("#smdPrep [data-act=p-ob-next]") === "Start preparing", "the last step starts");
  await click("#smdPrep [data-act=p-ob-next]");
  ok(await until(`return !!document.querySelector("#smdPrep .pl-hero");`, 8000), "finishing lands on home");
  ok(await store(`JSON.stringify(s.pl)`) === JSON.stringify({ ob: 1, exam: "neet-pg", date: isoIn(10), min: 120, rem: "07:30" }), "answers are stored: " + await store(`JSON.stringify(s.pl)`));
  ok(!/(phone|track|subscribe|price)/i.test(await store(`JSON.stringify(s.pl)`)), "no phone, tracking or paywall field");

  // ---- home: readiness line and Today's plan
  ok(await until(`return /^0\\/100/.test(document.querySelector("#smdPrep .pl-num").textContent);`, 3000), "readiness is 0 before any answer");
  ok(/first answers start it moving/.test(await text("#smdPrep .pl-hero")), "a friendly empty line, not a failing score");
  ok(/10 days to the exam/.test(await text("#smdPrep .pl-top")), "the countdown shows the days to the exam");
  ok(await until(`return !!document.querySelector("#smdPrep .pl-list");`, 5000), "Today's plan is drawn");
  const kinds = async () => ev(`return Array.from(document.querySelectorAll("#smdPrep .pl-list .pl-item")).map(function(b){return b.getAttribute("data-k");}).join(",");`);
  ok(await kinds() === "new,mock", "10 days out, 120 min, nothing due: new questions then a mini mock, no new lesson: " + await kinds());
  ok(await ev(`return document.querySelector("#smdPrep .pl-hero").compareDocumentPosition(document.querySelector("#smdPrep .pl-list")) & 4;`) === 4, "the readiness line comes before the plan");
  ok(/About \d+ of your 120 minutes/.test(await text("#smdPrep .pl-foot")), "the plan says how much of the time it fills");
  await shot("home-empty");

  // ---- How this is computed (empty)
  await click("#smdPrep .pl-hero");
  ok(await until(`return !!document.querySelector("#pnPlanSheet .pl-sheet");`, 3000), "tapping the line opens How this is computed");
  ok(await ev(`return Array.from(document.querySelectorAll("#pnPlanSheet .pl-f b")).map(function(b){return b.textContent;}).join("|");`) === "Coverage|Retention|Accuracy", "three factors");
  ok(/Nothing answered yet/.test(await text("#pnPlanSheet")), "the empty sheet explains why all parts are zero");
  await shot("why-empty");
  await ev(`document.querySelector("#smdPrep").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return 1;`);
  ok(await until(`return !document.getElementById("pnPlanSheet") && !!document.querySelector("#smdPrep .pl-hero");`, 3000), "Escape closes the sheet, home stays");

  // ---- answer from the plan: progress ticks, readiness moves
  await click("#smdPrep .pl-list [data-k=new]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && /New questions/.test(document.querySelector("#smdPrep .pn-t h1").textContent);`, 8000), "the new-questions item starts a set");
  for (let i = 0; i < 3; i++) {
    await ev(`var it=PREP._st.run.items[PREP._st.run.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+(${i}===2?(it.a+1)%4:it.a)+'"]').click(); return 1;`);
    await click("#smdPrep [data-act=next]");
  }
  ok(await store(`(s.ra||[]).length`) === 3, "each answer is logged for accuracy");
  await ev(`PREP._st.run=null; PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pl-hero") && !/^0\\//.test(document.querySelector("#smdPrep .pl-num").textContent);`, 5000), "readiness moves off 0: " + await text("#smdPrep .pl-num"));
  ok(/3 of \d+ done/.test(await text("#smdPrep .pl-list [data-k=new]")), "the new-questions item counts 3 done: " + await text("#smdPrep .pl-list [data-k=new]"));
  await click("#smdPrep .pl-hero");
  await until(`return !!document.querySelector("#pnPlanSheet .pl-w");`, 3000);
  ok(/2 of 2 modules attempted|1 of 2 modules attempted/.test(await text("#pnPlanSheet")) && /Right in your last 3 answers/.test(await text("#pnPlanSheet")), "factors explain themselves: " + await text("#pnPlanSheet .pl-fs"));
  ok(await ev(`return document.querySelectorAll("#pnPlanSheet .pl-w").length;`) === 1 && /Anatomy/.test(await text("#pnPlanSheet .pl-w")), "weakest subjects listed (the fixture exam has one)");
  ok(await ev(`return document.querySelectorAll("#pnPlanSheet .pl-w .pn-btn").length;`) === 1, "one action per weak subject: " + await text("#pnPlanSheet .pl-w .pn-btn"));
  await shot("why");
  await click("#pnPlanSheet .pl-w .pn-btn");
  ok(await until(`return !document.getElementById("pnPlanSheet") && !!document.querySelector("#smdPrep #pnModPanel");`, 5000), "the action opens that module");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep .pl-hero");`, 3000);

  // ---- settings: re-plan with no exam date, the lesson appears; a finished lesson ticks
  await click("#smdPrep [data-act=p-settings]");
  ok(await until(`return !!document.querySelector("#pnPlanSheet #plDate") && !!document.querySelector("#pnPlanSheet #plRem");`, 3000), "Change plan opens the settings sheet with every answer");
  await shot("settings");
  await click('#pnPlanSheet [data-act=p-f-nodate]');
  await click('#pnPlanSheet [data-act=p-f-min][data-v="30"]');
  await click("#pnPlanSheet [data-act=p-save]");
  ok(await until(`return !document.getElementById("pnPlanSheet");`, 3000) && await store(`s.pl.date===null && s.pl.min===30`) === true, "Save keeps the edits");
  ok(await until(`return /lsn/.test(Array.from(document.querySelectorAll("#smdPrep .pl-list .pl-item")).map(function(b){return b.getAttribute("data-k");}).join(","));`, 5000), "re-planned: a lesson in the weakest subject: " + await kinds());
  ok(!/days to the exam/.test(await text("#smdPrep .pl-top")), "no exam date, no countdown");
  ok(await ev(`var b=document.querySelector('#smdPrep .pl-list [data-k=lsn]'); return b.getAttribute("data-act")==="l-open" && b.getAttribute("data-m")==="ana-brachial-plexus";`) === true, "the lesson row opens the lesson reader");
  await shot("home");
  await ev(`var s=PREP._st.store; s.ls["ana-brachial-plexus"]={i:0,n:5,done:Date.now(),xp:50}; PREP._st.stack[PREP._st.stack.length-1](); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep .pl-list [data-k=lsn].done') && /Done:/.test(document.querySelector('#smdPrep .pl-list [data-k=lsn]').textContent);`, 3000), "a lesson finished today is ticked (and read as Done)");
  await shot("home-ticked");

  // ---- FMGE: tab, subjects, mock pattern, Arena coming soon
  await click('#smdPrep .pn-tab[data-v=fmge]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy]") && !document.querySelector("#smdPrep .pn-tile[data-s=ss-cardiology]");`, 5000), "the FMGE tab lists the MBBS subjects");
  ok(/FMGE readiness/.test(await text("#smdPrep .pl-hero")), "readiness follows the tab: " + await text("#smdPrep .pl-hero"));
  await shot("fmge-home");
  await click("#smdPrep [data-act=mocks]");
  ok(await until(`return /300 questions in 2 parts of 150, 2 h 30 min each/.test(document.querySelector("#smdPrep .pn-body").textContent);`, 3000), "the FMGE pattern: " + await text("#smdPrep .pn-panel .pn-mut"));
  ok(/no negative marking/.test(await text("#smdPrep .pn-panel")) && /Pass mark 150 of 300/.test(await text("#smdPrep .pn-panel")), "no negative marking, pass mark 150 of 300");
  ok(/One part: 150 questions/.test(await text('#smdPrep [data-act=mock][data-k=part]')), "a full mock is one part of 150");
  await shot("fmge-mocks");
  await click('#smdPrep [data-act=mock][data-v=fmge][data-k=mini]');
  ok(await until(`return !!document.getElementById("pnClock") && document.querySelector("#smdPrep .pn-t h1").textContent === "FMGE pattern (mini)";`, 10000), "the FMGE mini mock starts with a clock");
  await ev(`var r=PREP._st.run; r.ans=r.items.map(function(it,i){return i===0?it.a:i===1?(it.a+1)%4:-1;}); return 1;`);
  await click("#smdPrep [data-act=qgrid]");
  await click("#smdPrep .pn-qgrid + p + [data-act=submit]");
  ok(await until(`return (document.querySelector("#smdPrep .pn-score .pn-big")||{}).textContent && document.querySelector("#smdPrep .pn-score .pn-big").textContent.split(" / ")[0] === "1";`, 5000), "marked +1, no negative: one right, one wrong = 1: " + await text("#smdPrep .pn-score .pn-big"));
  ok(/Pass mark in the exam: 50% of the maximum/.test(await text("#smdPrep .pn-score")), "the result names the pass mark");
  await shot("fmge-result");
  await click("#smdPrep [data-act=donerun]");
  await ev(`PREP.back(); return 1;`);
  await ev(`localStorage.setItem("smd_prep_arena","1"); window.SMD_AUTH={currentUser:{uid:"u1",displayName:"Test",getIdToken:function(){return Promise.resolve("t");}}}; PREP._st.stack[PREP._st.stack.length-1](); return 1;`);
  ok(await until(`return /FMGE Arena: coming soon/.test((document.getElementById("pnCompete")||{}).textContent||"");`, 5000), "the FMGE Arena says coming soon");
  await ev(`localStorage.removeItem("smd_prep_arena"); delete window.SMD_AUTH; return 1;`);
  await click('#smdPrep .pn-tab[data-v=neet-pg]');

  // ---- skip: a fresh store, Skip lands on home and onboarding never shows again
  await ev(`PREP.close(); localStorage.removeItem("smd_prep_v1"); PREP._st.store=null; PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=p-skip]");`, 5000), "a fresh store shows onboarding again");
  await click("#smdPrep [data-act=p-skip]");
  ok(await until(`return !!document.querySelector("#smdPrep .pl-hero") && !!document.querySelector("#smdPrep .pn-tabs");`, 5000), "Skip lands on home");
  ok(await store(`s.pl && s.pl.ob===1 && s.pl.min===30 && s.pl.date===null`) === true, "skipping stores the defaults");
  await ev(`PREP.close(); PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pl-hero");`, 5000) && await ev(`return !document.querySelector("#smdPrep .pl-q");`) === true, "the next open goes straight home");
  ok(!/days to the exam/.test(await text("#smdPrep .pl-top")), "no date, no countdown");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !PREP.isOpen();`, 3000), "back() on home closes PrepNucleus");

  const ai = reqs.filter((u) => /\/api\/(ai|prep\/bank)\//.test(u));
  ok(!ai.length, "no request reaches /api/ai or /api/prep/bank" + (ai.length ? ": " + ai.join(", ") : ""));
  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
