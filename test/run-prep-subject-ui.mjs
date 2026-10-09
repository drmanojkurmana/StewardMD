/* PrepNucleus subject screen, Learn and the exam choice, in the REAL app (headless Chrome over CDP, touch emulation).
 * Data: the app's own prep/ (taxonomy, bundled indexes incl. ss-radiology v8, the bundled pilot lessons); the bank API is
 * answered here: a lessons index naming two Radiology NEET-SS modules (srd-abd-liver, srd-cardiac-vascular), else 404.
 * What must hold, at 390 x 844, 820 x 1180 and 1180 x 820:
 *  1. Subject screen (Radiology NEET-SS, Surgery NEET-PG): the actions block (Practise, Learn) has the same left and right
 *     edges as the subject hero and the module list (within 1 px); Practise starts on that left edge; on a phone it spans
 *     the column, from 700 px the last button in the row ends on the right edge.
 *  2. Learn shows only where the subject has lessons (Radiology NEET-SS: 2; Anatomy: none), opens a list grouped by module
 *     in module order, and a row opens the lesson reader; the module screen of a module with a lesson shows "Learn".
 *  3. Module counts are the v8 index counts (Radiology NEET-SS: 690 in the hero, srd-cardiac-vascular 83).
 *  4. The exam is asked once: a fresh store opens onboarding with no Skip on the exam step; after it, home has no exam
 *     switcher, Settings shows the exam; a reopen goes straight home; Settings lists six exams (INI-SS among them) and a
 *     change there is kept.
 *  5. No horizontal overflow; no em or en dash on screen; no uncaught PrepNucleus error.
 * USAGE: CHROME=<path> node test/run-prep-subject-ui.mjs   (SHOTS=<dir> saves light and dark PNGs per screen and size)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-subject-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const SIZES = (process.env.SIZES || "390x844,820x1180,1180x820").split(",").map((s) => { const [w, h] = s.split("x").map(Number); return { w, h }; });
const SHOTS = process.env.SHOTS || "";
const DASH = "[" + String.fromCharCode(8211, 8212) + "]";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// The lessons index the bank API answers: two Radiology NEET-SS modules (one a module's own lesson, one keyed apart).
const LIX = { v: 1, modules: {
  "srd-abd-liver": { title: "Liver, biliary tree and pancreas", minutes: 6, steps: 5 },
  "srd-cardiac-x1": { title: "Aortic dissection on CT", minutes: 5, steps: 4, module: "srd-cardiac-vascular" }
} };
const PILOT = JSON.parse(readFileSync(join(ROOT, "prep/lessons/v1/sur-breast-cancer.json"), "utf8"));
function api(url) {
  if (/\/v1\/lessons\/index\.json/.test(url)) return [200, LIX];
  if (/\/v1\/lessons\/srd-abd-liver\.json/.test(url)) return [200, { ...PILOT, module: "srd-abd-liver", title: "Liver, biliary tree and pancreas", quiz: [] }];
  return [404, { error: "nope" }];
}

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);

// Geometry in window px (the app zooms the document; K converts through the fixed root, which spans the window).
const GEO = `var RT=document.getElementById("smdPrep"), RR=RT.getBoundingClientRect(), K=innerWidth/RR.width;
  function R(el){ var b=el.getBoundingClientRect(); return { l:(b.left-RR.left)*K, r:(b.right-RR.left)*K, w:b.width*K }; }`;
const geo = (body) => ev(GEO + body);
const OVER = `var de=document.documentElement, b=RT.querySelector(".pn-body"), o=[]; if(de.scrollWidth>de.clientWidth+1) o.push("document "+de.scrollWidth+">"+de.clientWidth); if(b&&b.scrollWidth>b.clientWidth+1) o.push("body "+b.scrollWidth+">"+b.clientWidth); return o.join(", ");`;
// The actions block against the hero and the module list: "" when every edge agrees within 1 px.
const ALIGN = `var h=RT.querySelector("#pnSub > .pn-subhead"), a=RT.querySelector("#pnSub > .pn-subacts"), m=RT.querySelector("#pnSub > .pn-mods"), p=a&&a.querySelector(".pn-subgo"), last=a&&a.lastElementChild, o=[];
  if(!h||!a||!m||!p) return "missing "+[!h&&"hero",!a&&"actions",!m&&"modules",!p&&"practise"].filter(Boolean).join(",");
  var H=R(h), A=R(a), M=R(m), P=R(p), L=R(last), d=function(x,y){return Math.abs(x-y);};
  if(d(A.l,H.l)>1||d(A.r,H.r)>1) o.push("actions "+A.l.toFixed(1)+".."+A.r.toFixed(1)+" vs hero "+H.l.toFixed(1)+".."+H.r.toFixed(1));
  if(d(M.l,H.l)>1||d(M.r,H.r)>1) o.push("modules "+M.l.toFixed(1)+".."+M.r.toFixed(1)+" vs hero "+H.l.toFixed(1)+".."+H.r.toFixed(1));
  if(d(P.l,H.l)>1) o.push("practise starts "+P.l.toFixed(1)+" vs "+H.l.toFixed(1));
  if(innerWidth<700&&d(P.r,H.r)>1) o.push("practise ends "+P.r.toFixed(1)+" vs "+H.r.toFixed(1));
  if(d(L.r,H.r)>1) o.push("last button ends "+L.r.toFixed(1)+" vs "+H.r.toFixed(1));
  return o.join("; ");`;

const shot = async (tag, name) => {
  if (!SHOTS) return;
  for (const theme of ["light", "dark"]) {
    await ev(`if (!document.getElementById("pnNoTr")) { var t=document.createElement("style"); t.id="pnNoTr"; t.textContent="*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.toggle("dark", ${theme === "dark"}); return 1;`);
    await sleep(160);
    await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
    const r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) writeFileSync(join(SHOTS, `subject-${tag}-${name}-${theme}.png`), Buffer.from(r.result.data, "base64"));
  }
  await ev(`document.body.classList.remove("dark"); return 1;`);
};
const metrics = async ({ w, h }) => {
  await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: w === 390 ? 3 : 2, mobile: true, screenWidth: w, screenHeight: h });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
};
const noDash = async (where) => { const t = await ev(`return document.getElementById("smdPrep").innerText;`); ok(!new RegExp(DASH).test(t || ""), "no em or en dash on " + where); };

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      const [code, body] = api(m.params.request.url);
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: code, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  // ?ob=1 keeps onboarding on (the exam-once check); otherwise it is skipped like the other UI suites.
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `(function(){ window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.confirm=function(){return true;};
    if(!/[?&]ob=1/.test(location.search)) window.SMD_PREP_ONBOARD=false; window.toast=function(m){(window.__toasts=window.__toasts||[]).push(m);};
    window.SpeechSynthesisUtterance=function(t){this.text=t;}; Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{speaking:false,speak:function(){},cancel:function(){}}}); })();` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const boot = async (q) => { await call("Page.navigate", { url: BASE + "?prep=1&tour=0" + (q || "") }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean); };
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  const reset = `try{["smd_prep_v1","smd_prep_setup"].forEach(function(k){localStorage.removeItem(k);}); localStorage.setItem("smd_prep","1"); localStorage.setItem("smd_prep_arena","0"); localStorage.setItem("smd_onboarding_tour","0");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`;

  for (const S of SIZES) {
    const tag = (S.w > S.h ? "l" : "p") + S.w, at = ` @${S.w}x${S.h}`;
    console.log(`\n---- ${S.w}x${S.h}`);
    await metrics(S); await ev(reset); await boot();

    // ---- Radiology NEET-SS: counts, alignment, Learn
    await ev(`PREP.open(); return 1;`);
    ok(await until(`return !!document.querySelector("#smdPrep #pnHome");`, 20000), "home opens" + at);
    ok(await ev(`return !document.querySelector("#smdPrep .pn-tabs, #smdPrep [data-act=exam]");`) === true, "home has no exam switcher" + at);
    ok(/Exam: NEET-PG/.test(await ev(`var r=document.querySelector("#smdPrep [data-act=p-settings].pn-row"); return r ? r.textContent : "";`) || ""), "home lists Settings with the exam" + at);
    await shot(tag, "home");
    await ev(`PREP._host.setExam("neet-ss"); return 1;`);
    ok(await until(`return !!document.querySelector('#smdPrep [data-act=subject][data-s="ss-radiology"]');`, 8000), "NEET-SS lists Radiology" + at);
    await click(`#smdPrep [data-act=subject][data-s="ss-radiology"]`);
    ok(await until(`return document.querySelectorAll("#smdPrep .pn-mod[data-act=module]").length === 24 && !!document.querySelector("#smdPrep [data-act=l-subject]");`, 10000), "Radiology lists 24 modules and a Learn button" + at);
    await sleep(350);
    ok(/690 MCQs/.test(await ev(`return document.querySelector("#smdPrep .pn-subhead").textContent;`)), "the hero counts 690 MCQs (bank v8)" + at);
    ok(/83 MCQs/.test(await ev(`return document.querySelector('#smdPrep .pn-mod[data-m="srd-cardiac-vascular"]').textContent;`)), "srd-cardiac-vascular shows its v8 count (83)" + at);
    const al = await geo(ALIGN);
    ok(al === "", "Practise and Learn sit in the hero and module column" + (al ? ": " + al : "") + at);
    ok(/^\s*Learn\s*2 lessons\s*$/.test((await ev(`return document.querySelector("#smdPrep [data-act=l-subject]").textContent;`)).replace(/·/g, "")), "Learn counts 2 lessons" + at);
    ok(await ev(`var b=document.querySelector("#smdPrep [data-act=l-subject]").getBoundingClientRect(); return b.height >= 44;`) === true, "Learn is at least 44 px tall" + at);
    ok(await geo(OVER) === "", "subject: no horizontal overflow " + (await geo(OVER)) + at);
    await noDash("the subject screen" + at);
    await shot(tag, "radiology");
    await click("#smdPrep [data-act=l-subject]");
    ok(await until(`return document.querySelectorAll("#smdPrep .pn-lsn-mod").length === 2;`, 5000), "Learn lists 2 modules" + at);
    const order = await ev(`return Array.prototype.map.call(document.querySelectorAll("#smdPrep .pn-lsn-mod [data-act=l-open]"), function(b){return b.getAttribute("data-m")+":"+b.getAttribute("data-l");}).join(",");`);
    ok(order === "srd-cardiac-vascular:srd-cardiac-x1,srd-abd-liver:srd-abd-liver", "in module order, each lesson under its module: " + order + at);
    ok(/Learn/.test(await ev(`return document.querySelector("#smdPrep .pn-t h1").textContent;`)), "the Learn screen is titled Learn" + at);
    ok(await geo(OVER) === "", "Learn: no horizontal overflow " + (await geo(OVER)) + at);
    await noDash("the Learn screen" + at);
    await shot(tag, "learn");
    await click(`#smdPrep .pn-lsn-mod [data-l="srd-abd-liver"]`);
    ok(await until(`return !!document.querySelector("#smdPrep .pn-lsn-tx");`, 8000), "a Learn row opens the lesson reader" + at);
    await ev(`PREP.back(); return 1;`);
    ok(await until(`return document.querySelectorAll("#smdPrep .pn-lsn-mod").length === 2;`, 4000), "back returns to Learn" + at);
    await ev(`PREP.back(); return 1;`);
    ok(await until(`return !!document.querySelector("#smdPrep #pnSub .pn-subacts");`, 4000), "and back to the subject" + at);
    await click(`#smdPrep .pn-mod[data-m="srd-abd-liver"]`);
    ok(await until(`var h=document.querySelector("#smdPrep #pnLsnSlot .pn-lsn-h"); return !!h && /Learn/.test(h.textContent) && !!document.querySelector("#smdPrep #pnLsnSlot [data-act=l-open]");`, 6000), "the module screen shows Learn with its lesson" + at);
    await shot(tag, "module");
    await ev(`PREP.back(); return 1;`); await sleep(200);
    await click(`#smdPrep .pn-mod[data-m="srd-neuro-vascular"]`);
    await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 6000); await sleep(400);
    ok(await ev(`return !document.querySelector("#smdPrep #pnLsnSlot .pn-lsn-h");`) === true, "a module with no lesson shows no Learn" + at);
    await ev(`PREP.close(); return 1;`);

    // ---- Surgery NEET-PG (bundled pilot lessons) and Anatomy (none)
    await ev(`PREP.open(); return 1;`); await until(`return !!document.querySelector("#smdPrep #pnHome");`, 8000);
    await ev(`PREP._host.setExam("neet-pg"); return 1;`);
    await until(`return !!document.querySelector('#smdPrep [data-act=subject][data-s="surgery"]');`, 8000);
    await click(`#smdPrep [data-act=subject][data-s="surgery"]`);
    ok(await until(`return !!document.querySelector("#smdPrep [data-act=l-subject]");`, 10000), "Surgery shows Learn (bundled lessons)" + at);
    await sleep(300);
    const al2 = await geo(ALIGN);
    ok(al2 === "", "Surgery: Practise and Learn in the column" + (al2 ? ": " + al2 : "") + at);
    await shot(tag, "surgery");
    await ev(`PREP.back(); return 1;`);
    await until(`return !!document.querySelector('#smdPrep [data-act=subject][data-s="anatomy"]');`, 5000);
    await click(`#smdPrep [data-act=subject][data-s="anatomy"]`);
    await until(`return document.querySelectorAll("#smdPrep .pn-mod[data-act=module]").length > 3;`, 10000); await sleep(800);
    ok(await ev(`return !document.querySelector("#smdPrep [data-act=l-subject]");`) === true, "Anatomy (no lessons) shows no Learn" + at);
    const al3 = await geo(ALIGN);
    ok(al3 === "", "Anatomy: Practise in the column" + (al3 ? ": " + al3 : "") + at);
    await ev(`PREP.close(); return 1;`);
  }

  // ---- the exam is asked once (phone size)
  console.log("\n---- exam asked once");
  await metrics(SIZES[0]); await ev(reset); await boot("&ob=1");
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=p-f-exam]");`, 15000), "a fresh store asks the exam");
  ok(await ev(`return !document.querySelector("#smdPrep [data-act=p-skip]");`) === true, "the exam step has no Skip");
  ok(await ev(`return document.querySelectorAll("#smdPrep [data-act=p-f-exam]").length;`) === 6 && /INI-SS/.test(await ev(`return document.querySelector("#smdPrep .pl-ob").textContent;`)), "six exams, INI-SS among them");
  await shot("p390", "onboard-exam");
  await click(`#smdPrep [data-act=p-f-exam][data-v="neet-ss"]`);
  await click("#smdPrep [data-act=p-ob-next]");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=p-skip]");`, 3000), "later steps can be skipped");
  await click("#smdPrep [data-act=p-skip]");
  ok(await until(`return !!document.querySelector("#smdPrep #pnHome") && !!document.querySelector('#smdPrep [data-act=subject][data-s="ss-radiology"]');`, 10000), "home opens on NEET-SS subjects");
  ok(await ev(`return !document.querySelector("#smdPrep .pn-tabs, #smdPrep [data-act=exam]");`) === true, "no exam switcher on home");
  ok(await ev(`return JSON.parse(localStorage.getItem("smd_prep_v1")).pl.exam;`) === "neet-ss", "the choice is stored (pl.exam)");
  await ev(`PREP.close(); return 1;`); await boot("&ob=1"); await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep #pnHome");`, 15000) && await ev(`return !document.querySelector("#smdPrep [data-act=p-f-exam]");`) === true, "a reopen goes straight home, the exam is not asked again");
  ok(/NEET-SS/.test(await ev(`return document.querySelector("#smdPrep .pn-t p").textContent;`)), "the bar names the exam");
  await click("#smdPrep .pn-row[data-act=p-settings]");
  ok(await until(`return document.querySelectorAll("#pnPlanSheet [data-act=p-f-exam]").length === 6;`, 4000), "Settings has the Exam row with six exams");
  const segOver = await ev(`var o=[]; document.querySelectorAll("#pnPlanSheet .pl-g-exam .pl-segb").forEach(function(b){ if(b.scrollWidth>b.clientWidth+1) o.push(b.textContent); }); return o.join(",");`);
  ok(segOver === "", "no exam label is clipped in Settings " + segOver);
  await shot("p390", "settings");
  await click(`#pnPlanSheet [data-act=p-f-exam][data-v="ini-ss"]`);
  await click("#pnPlanSheet [data-act=p-save]");
  ok(await until(`return /INI-SS/.test(document.querySelector("#smdPrep .pn-t p").textContent) && !!document.querySelector('#smdPrep [data-act=subject][data-s="ss-radiology"]');`, 5000), "Settings changes the exam (INI-SS, the NEET-SS bank)");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return s.pl.exam + "|" + s.exam;`) === "ini-ss|neet-ss", "the store keeps ini-ss on the neet-ss tab");
  await ev(`PREP.close(); return 1;`);
  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  await sleep(300);
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
