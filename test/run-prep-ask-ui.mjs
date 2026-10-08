/* PrepNucleus Ask MaiK, MaiK lines and milestone balloons in the REAL app (headless Chrome over CDP), on the fixture bank.
 * Owner decisions 2026-10-09 (vault/plans/PrepNucleus-iPad-Confetti-MaikLines.md, sections 2, 3 and 5):
 * - balloons on a milestone (level-up here): 7 on a phone, 9 on an iPad-width card, transform and opacity only, gone by
 *   4 s, no confetti on the same card; under reduced motion none, the milestone said in words;
 * - one MaiK line per app session after a set of 5 or more, the subject's first line first;
 * - Ask MaiK on every answer (web too); first use asks "On this phone" or "Online" with "Don't ask again"; a web browser
 *   and a phone that cannot run MaiK are told so at once and offered Online; Online goes to /api/ai/prep-teach (answered
 *   here by the test) signed in, shows the MaiK Tokens used; tokens used up and signed out say so with the stored
 *   explanation; on a capable phone with MaiK Lite the phone answers (model stubbed); with the MaiK engine on Local an
 *   online ask asks first; the choice is changed in Your plan settings; iPad landscape runner opens a side panel.
 * USAGE: node test/run-prep-ask-ui.mjs   (CHROME=<binary>, SHOTS=<dir> saves screenshots)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-ask-chrome-" + PORT + "-" + Date.now();
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
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const size = (w, h, mobile = true) => call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  for (const dark of [false, true]) {
    await ev(`document.body.classList.toggle("dark", ${dark}); document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
    await sleep(120);
    const r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) writeFileSync(join(process.env.SHOTS, name + (dark ? "-dark" : "-light") + ".png"), Buffer.from(r.result.data, "base64"));
  }
  await ev(`document.body.classList.remove("dark"); return 1;`);
};
// The server's answer to /api/ai/prep-teach, set per step; every request body is kept.
let teach = { status: 200, body: {} }; const teachReqs = [];

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      const rq = m.params.request;
      teachReqs.push({ url: rq.url, auth: (rq.headers && (rq.headers.Authorization || rq.headers.authorization)) || "", body: rq.postData || "" });
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: teach.status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(teach.body)).toString("base64") });
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await size(390, 844);
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/prep-teach*" }] });
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000);
  await ev(`try{localStorage.removeItem("smd_prep_v1"); sessionStorage.clear();}catch(e){} ["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-home") && !!window.PREP_ASK && !!PREP._st.lines;`, 20000), "PrepNucleus opens with prep-ask.js and the MaiK lines loaded");

  // A practice set of the gametogenesis module (6 usable), every answer right (right = true) or every one wrong.
  const runSet = async (right) => {
    await ev(`PREP._st.stack.length=1; PREP._host.home(); return 1;`);
    await click('#smdPrep .pn-tile[data-s=anatomy]');
    await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 8000);
    await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]');
    await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000);
    await click('#smdPrep [data-act=start][data-k=study]');
    await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000);
    for (let i = 0; i < 12; i++) {
      const done = await ev(`return !PREP._st.run || PREP._st.run.done;`);
      if (done) break;
      await ev(`var r=PREP._st.run, it=r.items[r.i], k=${right ? "it.a" : "(it.a+1)%4"}; document.querySelector('#smdPrep .pn-opt[data-k="'+k+'"]').click(); return 1;`);
      await until(`return !!document.querySelector("#smdPrep [data-act=next]");`, 3000);
      await click("#smdPrep [data-act=next]");
    }
    return until(`return !!document.querySelector("#smdPrep .pn-score");`, 5000);
  };
  const setXp = (xp) => ev(`var s=PREP._host.store(); s.mod={ "zz-x": { t: ${Math.ceil(xp / 2)}, ok: ${Math.floor(xp / 2)} } }; s.ls={}; PREP._host.save(); return 1;`);

  // ---- balloons on a level-up, phone width
  await setXp(99);
  ok(await runSet(true), "a set of 6 finishes");
  const b1 = JSON.parse(await ev(`var c=document.querySelector("#smdPrep .pn-score"); return JSON.stringify({ cele: c.getAttribute("data-cele"), chip: (c.querySelector(".pn-mile")||{}).textContent, n: c.querySelectorAll(".pn-balloons > .pn-bl").length, conf: !!c.querySelector(".pn-confetti"), cel: PREP._host.store().cel });`));
  ok(b1.cele === "balloons" && b1.chip === "Level 2" && b1.n === 7 && !b1.conf, "level-up: balloons (7 at 390 px), the chip says Level 2, no confetti on the same card: " + JSON.stringify(b1));
  ok(b1.cel && b1.cel.keys && b1.cel.keys.indexOf("lv2") >= 0, "the milestone is recorded so it never fires twice");
  const props = await ev(`var ok=true, n=0; document.querySelectorAll("#smdPrep .pn-bl, #smdPrep .pn-bl > i").forEach(function(el){ el.getAnimations().forEach(function(a){ n++; a.effect.getKeyframes().forEach(function(k){ Object.keys(k).forEach(function(p){ if (["transform","opacity","offset","easing","composite","computedOffset"].indexOf(p) < 0) ok=false; }); }); }); }); return ok && n >= 14;`);
  ok(props === true, "balloons animate transform and opacity only");
  ok(await ev(`var c=document.querySelector("#smdPrep .pn-score"); return getComputedStyle(c.querySelector(".pn-balloons")).pointerEvents === "none";`) === true, "the balloon layer never takes a tap");
  const line1 = await ev(`var l=document.querySelector("#smdPrep .pn-maikline"); return l ? l.textContent + "|" + l.getAttribute("role") : "";`);
  ok(line1 === "You are the next great anatomist in the making.|status", "MaiK line: the subject's first line under the result, announced once: " + line1);
  await shot("ask-result-balloons-p390");
  ok(await until(`return !document.querySelector("#smdPrep .pn-balloons");`, 4500), "the balloon layer is gone by 4 s");

  // ---- second set the same session: no line, no balloons (no milestone)
  ok(await runSet(true), "a second set finishes");
  ok(await ev(`return !document.querySelector("#smdPrep .pn-maikline") && !document.querySelector("#smdPrep .pn-score[data-cele]");`) === true, "second set: no MaiK line (once a session) and no balloons");

  // ---- iPad width: 9 balloons
  await size(820, 1180); await setXp(599);
  ok(await runSet(true), "an iPad-width set finishes");
  const b2 = await ev(`var c=document.querySelector("#smdPrep .pn-score"); return c.getAttribute("data-cele")+":"+c.querySelectorAll(".pn-bl").length+":"+Math.round(c.getBoundingClientRect().width);`);
  ok(/^balloons:9:/.test(b2), "iPad width: 9 balloons on a card wider than 600 px (a level-up without a new rank): " + b2);
  await shot("ask-result-balloons-p820");

  // ---- reduced motion: no balloons, the milestone still in words
  await size(390, 844);
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await setXp(999);
  ok(await runSet(true), "a reduced-motion set finishes");
  ok(await ev(`var c=document.querySelector("#smdPrep .pn-score"); return c.getAttribute("data-cele")==="balloons" && c.getAttribute("data-big")==="2" && !c.querySelector(".pn-balloons") && /New rank: Resident/.test(c.textContent);`) === true, "reduced motion: no balloons, the chip still says New rank: Resident");
  await call("Emulation.setEmulatedMedia", { features: [] });

  // ---- today's plan finished for the first time: balloons on the plan, then never again
  const planDone = () => ev(`var s=PREP._host.store(), td=PREP._host.today(); s.pl=s.pl||{ob:1,exam:null,date:null,min:30,rem:null}; s.pt={ d: td, ex: PREP._host.exam().id, min: s.pl.min, items: [{ k: "mock", id: "neet-pg", label: "NEET-PG pattern", min: 30, t0: 0 }], total: 30 }; s.mh=[{ ts: Date.now(), label: "x", marks: 1, max: 4, n: 1 }]; PREP._host.save(); PREP._st.run=null; PREP._st.stack.length=1; PREP._host.home(); return 1;`);
  await ev(`var s=PREP._host.store(); s.cel={ day: -1, keys: (s.cel&&s.cel.keys)||[] }; PREP._host.save(); return 1;`);
  await planDone();
  ok(await until(`var p=document.querySelector("#smdPrep .pl-plan[data-cele=balloons]"); return !!p && !!p.querySelector(".pn-balloons .pn-bl") && /Today's plan is done/.test(p.textContent);`, 5000), "today's plan done the first time: balloons on the plan, the line says it is done");
  ok(await ev(`return PREP._host.store().cel.keys.indexOf("plan1") >= 0;`) === true, "plan1 is recorded");
  await planDone();
  ok(await until(`return !!document.querySelector("#smdPrep .pl-plan") && !document.querySelector("#smdPrep .pl-plan[data-cele]");`, 5000), "the next time: the plain line only");

  // ---- Ask MaiK on the web: a wrong answer, the button, the first-use choice
  await ev(`PREP._st.stack.length=1; PREP._host.home(); return 1;`);
  await runSet(false).catch(() => {});
  await ev(`PREP._st.stack.length=1; PREP._host.home(); return 1;`);
  await click('#smdPrep .pn-tile[data-s=anatomy]'); await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 8000);
  await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]'); await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000);
  await click('#smdPrep [data-act=start][data-k=study]'); await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000);
  await ev(`var r=PREP._st.run, it=r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+((it.a+1)%4)+'"]').click(); return 1;`);
  const btn = await ev(`var b=document.querySelector("#smdPrep .pn-fb [data-act=ask]"); return b ? b.textContent + "|" + Math.round(b.getBoundingClientRect().height) : "";`);
  ok(/^Why is [A-D] wrong\? Ask MaiK\|\d+$/.test(btn) && +btn.split("|")[1] >= 44, "a wrong answer offers Ask MaiK on the web, 44 px or more: " + btn);
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.querySelector("#pnAsk .pa-opts") && !!PREP_ASK._s().vd;`, 5000), "the Ask MaiK sheet opens with the two choices");
  const web = JSON.parse(await ev(`var w=document.getElementById("pnAsk"); return JSON.stringify({ note: (w.querySelector(".pa-note")||{}).textContent, local: w.querySelector('[data-v=local]').getAttribute("aria-disabled"), online: w.querySelector('[data-v=online]').getAttribute("aria-checked"), dont: w.querySelector("#paDont").checked, ai: /\\bAI\\b/.test(w.textContent), dash: /\\u2014/.test(w.textContent) });`));
  ok(web.note === "MaiK on this phone works in the StewardMD app. You can ask MaiK online here." && web.local === "true" && web.online === "true" && web.dont === false, "web: says at once that on-phone MaiK is in the app, Online is selected, Don't ask again unticked: " + JSON.stringify(web));
  ok(!web.ai && !web.dash, "no AI label and no em-dash in the sheet");
  await shot("ask-choose-web-p390");
  await click('#pnAsk [data-act=ak-close].pn-btn');
  ok(await until(`return !document.getElementById("pnAsk") && !!document.querySelector("#smdPrep .pn-fb");`, 2000), "Not now closes the sheet, the question stays");
  await click("#smdPrep [data-act=ask]"); await until(`return !!document.getElementById("pnAsk");`, 2000);
  await ev(`document.getElementById("smdPrep").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})); return 1;`);
  ok(await until(`return !document.getElementById("pnAsk") && !!document.querySelector("#smdPrep .pn-fb");`, 2000), "Escape closes the sheet first, the runner stays");

  // ---- Online, signed out
  await ev(`window.__authWas = window.SMD_AUTH; window.SMD_AUTH = { currentUser: null }; return 1;`);
  await click("#smdPrep [data-act=ask]"); await until(`return !!document.querySelector("#pnAsk [data-act=ak-go]");`, 3000);
  await click("#pnAsk [data-act=ak-go]");
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w && /Sign in to ask MaiK online/.test(w.textContent) && /Answer [A-D]/.test(w.querySelector(".pt-ans-b").textContent);`, 5000), "signed out: Sign in to ask MaiK online, with the stored explanation");
  ok(teachReqs.length === 0, "signed out: nothing is sent");
  ok(await ev(`var a=PREP._host.store().ask; return a && a.m==="online" && a.q===0;`) === true, "the choice is remembered (online), still asking each time");
  await click("#pnAsk .pa-top [data-act=ak-close]");

  // ---- Online, signed in: the answer, checked, with the MaiK Tokens used
  await ev(`window.SMD_AUTH = { currentUser: { uid: "s1", getIdToken: function () { return Promise.resolve("tok-1"); } } }; return 1;`);
  teach = { status: 200, body: { text: "The answer is the key, as the stored explanation says.\n\nYour pick is not what it describes.", usage: { inTok: 700, outTok: 120, mt: 68 }, wallet: { balanceMt: 1932, costCapOn: true } } };
  await click("#smdPrep [data-act=ask]");
  ok(await until(`var o=document.querySelector('#pnAsk [data-v=online]'); return !!o && o.getAttribute("aria-checked")==="true";`, 3000), "the next ask opens on the remembered choice (Online)");
  await ev(`document.getElementById("paDont").click(); return 1;`);
  await click("#pnAsk [data-act=ak-go]");
  ok(await until(`var a=document.querySelector("#pnAsk .pt-ans-b"); return !!a && /stored explanation says/.test(a.textContent);`, 6000), "online: MaiK's checked answer shows");
  const note = await ev(`return (document.querySelector("#pnAsk .pt-note")||{}).textContent;`);
  ok(/Answered online by MaiK/.test(note) && /Used about 68 MaiK Tokens; 1,932 left in your account\./.test(note), "online: the note says how it was checked and the MaiK Tokens used and left: " + note);
  const rq = teachReqs[teachReqs.length - 1] || {}, rb = JSON.parse(rq.body || "{}");
  ok(rq.auth === "Bearer tok-1" && rb.kind === "mcq" && /Question: Fixture question/.test(rb.ground) && /Correct answer: [A-D]\./.test(rb.ground) && Number.isInteger(rb.key) && Number.isInteger(rb.chosen) && rb.key !== rb.chosen, "online: signed request with the grounding, key and pick: " + JSON.stringify({ auth: rq.auth, kind: rb.kind, key: rb.key, chosen: rb.chosen }));
  ok(await ev(`var a=PREP._host.store().ask; return a.m==="online" && a.q===1;`) === true, "Don't ask again is stored");
  ok(await ev(`return document.querySelector('#pnAsk .pa-sb[data-v=online]').getAttribute("aria-checked")==="true";`) === true, "the chat shows the place switch on Online");
  await shot("ask-online-answer-p390");
  await click("#pnAsk .pa-top [data-act=ak-close]");
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.querySelector("#pnAsk .pa-body") && !document.querySelector("#pnAsk .pa-opts");`, 3000), "with Don't ask again, the next ask goes straight to the answer");
  await until(`return !!document.querySelector("#pnAsk .pt-ans-b");`, 5000);
  await click("#pnAsk .pa-top [data-act=ak-close]");

  // ---- tokens used up: the app's own top-up path, the stored explanation shown
  teach = { status: 429, body: { error: "quota", reason: "ai-cost-cap", creditsMt: 0, resetAt: Date.now() + 3600e3, message: "You have used today's free MaiK Tokens. Add MaiK Tokens or go Pro to keep asking MaiK online." } };
  await click("#smdPrep [data-act=ask]");
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w && /used today's free MaiK Tokens/.test(w.textContent) && !!w.querySelector("[data-act=ak-tokens]") === !!(window.SMD_PRO && SMD_PRO.openAiLimit) && /Answer [A-D]/.test(w.querySelector(".pt-ans-b").textContent);`, 6000), "tokens used up: said plainly, the top-up path offered, the stored explanation shown");
  ok(await ev(`return !/\\bAI\\b/.test(document.getElementById("pnAsk").textContent);`) === true, "tokens used up: no AI wording");
  await shot("ask-tokens-p390");
  await ev(`document.querySelectorAll("[data-pp]").forEach(function(){}); var x=document.querySelector(".pp-root,#smdProPaywall"); if (x) x.remove(); document.body.style.overflow=""; return 1;`);
  await click("#pnAsk .pa-top [data-act=ak-close]");

  // ---- Your plan settings: Ask me each time
  await ev(`PREP._st.run=null; PREP._st.stack.length=1; PREP._host.home(); return 1;`);
  await ev(`PREP_PLAN.act("p-settings", document.createElement("button"), PREP._host); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pl-g-ask [data-act=ak-pref][data-v=online][aria-checked=true]");`, 4000), "Your plan settings show Ask MaiK on Online");
  await click('#smdPrep .pl-g-ask [data-act=ak-pref][data-v=each]');
  ok(await ev(`var a=PREP._host.store().ask; return a.q===0 && a.m==="online" && document.querySelector('#smdPrep [data-act=ak-pref][data-v=each]').getAttribute("aria-checked")==="true";`) === true, "Ask me each time clears Don't ask again and keeps the last choice");
  await shot("ask-settings-p390");
  await ev(`PREP.back(); return 1;`);

  // ---- a phone that cannot run MaiK (iPhone 14 Pro, 6 GB), pack downloaded: said at once, Online offered
  const native = (model, ram, pack) => ev(`PREP_ASK._reset(); window.__capWas = window.__capWas || window.Capacitor;
    window.Capacitor = { isNativePlatform: function () { return true; }, getPlatform: function () { return "ios"; }, isPluginAvailable: function (n) { return n === "Device"; }, Plugins: { Device: { getInfo: function () { return Promise.resolve({ model: ${JSON.stringify(model)}, platform: "ios", osVersion: "26.0" }); } } } };
    window.SMD_MAIK_MODELS = { PACKS: { "maik-lite": { label: "MaiK Lite" } }, installed: function () { return Promise.resolve(${pack}); }, installedCached: function () { return ${pack}; }, suitability: function () { return { level: ${ram} >= 7 ? "ok" : "no" }; }, refreshDevice: function () { return Promise.resolve({ ramGB: ${ram} }); }, device: function () { return { ramGB: ${ram} }; } };
    window.SMD_MAIK_LOCAL = { available: function () { return true; }, currentPack: function () { return "maik-lite"; }, answer: function () { return Promise.resolve({ text: "The answer is the key, as the stored explanation says." }); } };
    return 1;`);
  await native("iPhone15,2", 5.6, true);
  await ev(`var s=PREP._host.store(); s.ask=null; PREP._host.save(); return 1;`);
  await click('#smdPrep .pn-tile[data-s=anatomy]'); await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 8000);
  await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]'); await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000);
  await click('#smdPrep [data-act=start][data-k=study]'); await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000);
  await ev(`var r=PREP._st.run, it=r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+it.a+'"]').click(); return 1;`);
  const rightBtn = await ev(`return (document.querySelector("#smdPrep .pn-fb [data-act=ask]")||{}).textContent;`);
  ok(/^Ask MaiK why [A-D] is right$/.test(rightBtn || ""), "a right answer offers Ask MaiK too: " + rightBtn);
  await click("#smdPrep [data-act=ask]");
  ok(await until(`var n=document.querySelector("#pnAsk .pa-note"); return !!n && n.textContent === "MaiK on this phone needs an iPhone 15 Pro or newer, or an iPad with an M1 chip or newer. You can ask MaiK online instead.";`, 5000), "not capable: the owner's sentence at once");
  ok(await ev(`var w=document.getElementById("pnAsk"); return w.querySelector('[data-v=local]').getAttribute("aria-disabled")==="true" && w.querySelector('[data-v=online]').getAttribute("aria-checked")==="true";`) === true, "not capable: On this phone unavailable, Online selected");
  await shot("ask-choose-notcapable-p390");
  await click('#pnAsk [data-act=ak-close].pn-btn');

  // ---- capable phone (iPhone 15 Pro) with MaiK Lite: the phone answers
  await native("iPhone16,1", 7.5, true);
  await click("#smdPrep [data-act=ask]");
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w && !!PREP_ASK._s().vd && w.querySelector('[data-v=local]').getAttribute("aria-checked")==="true" && /Runs on this phone\\. About 10 to 40 seconds\\./.test(w.textContent);`, 5000), "capable with MaiK Lite: On this phone selected, Runs on this phone");
  await shot("ask-choose-capable-p390");
  const before = teachReqs.length;
  await click("#pnAsk [data-act=ak-go]");
  ok(await until(`var a=document.querySelector("#pnAsk .pt-ans-b"); return !!a && /stored explanation says/.test(a.textContent) && /Written on this phone by MaiK Lite/.test(document.querySelector("#pnAsk .pt-note").textContent);`, 6000), "on this phone: the phone's checked answer, named as written on this phone");
  ok(teachReqs.length === before, "on this phone: nothing is sent to the server");
  await click("#pnAsk .pa-top [data-act=ak-close]");

  // ---- MaiK engine on Local: an online ask asks first
  await ev(`window.SMD_MAIK_ENGINE = { cloudAllowed: function () { return false; } }; var s=PREP._host.store(); s.ask={m:"online",q:1}; PREP._host.save(); return 1;`);
  teach = { status: 200, body: { text: "The answer is the key, as the stored explanation says.", usage: { mt: 60 }, wallet: { balanceMt: 0, costCapOn: false } } };
  const b4 = teachReqs.length;
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.querySelector("#pnAsk [data-act=ak-consent]");`, 4000) && teachReqs.length === b4, "engine on Local: Online asks before sending anything");
  await click("#pnAsk [data-act=ak-consent]");
  ok(await until(`return !!document.querySelector("#pnAsk .pt-ans-b") && /Used about 60 MaiK Tokens\\./.test(document.querySelector("#pnAsk .pt-note").textContent);`, 5000) && teachReqs.length === b4 + 1, "after Send online: one request, the answer, tokens used (no balance when the cap is off)");
  ok(await ev(`return SMD_MAIK_ENGINE.cloudAllowed() === false;`) === true, "the app-wide MaiK engine setting is unchanged");
  await click("#pnAsk .pa-top [data-act=ak-close]");
  await ev(`delete window.SMD_MAIK_ENGINE; return 1;`);

  // ---- iPad landscape runner: Ask MaiK opens as a side panel, the question stays in view
  await size(1180, 820);
  await sleep(300);
  await click("#smdPrep [data-act=ask]");
  await until(`return !!document.querySelector("#pnAsk .pt-ans-b");`, 5000);
  const sideP = JSON.parse(await ev(`var w=document.getElementById("pnAsk"), s=w.querySelector(".pn-sheet").getBoundingClientRect(), q=document.querySelector("#smdPrep .pn-q").getBoundingClientRect(); return JSON.stringify({ side: w.classList.contains("pa-side"), right: Math.round(innerWidth - s.right), w: w.querySelector(".pn-sheet").offsetWidth, qRight: Math.round(q.right), sLeft: Math.round(s.left), h: Math.round(s.height), vh: innerHeight });`));
  ok(sideP.side && sideP.right <= 4 && sideP.w <= 430 && sideP.qRight <= sideP.sLeft + 4 && sideP.h >= sideP.vh - 12, "iPad landscape: a right side panel, the question visible beside it: " + JSON.stringify(sideP));
  await shot("ask-side-l1180");
  await click("#pnAsk .pa-top [data-act=ak-close]");
  // iPad portrait: a centred panel
  await size(820, 1180); await sleep(300);
  await ev(`var s=PREP._host.store(); s.ask=null; PREP._host.save(); return 1;`);
  await click("#smdPrep [data-act=ask]"); await until(`return !!document.querySelector("#pnAsk .pa-opts");`, 4000);
  const cen = JSON.parse(await ev(`var sh=document.querySelector("#pnAsk .pn-sheet"), s=sh.getBoundingClientRect(); return JSON.stringify({ l: Math.round(s.left), r: Math.round(innerWidth - s.right), w: sh.offsetWidth, b: Math.round(s.bottom), vh: innerHeight });`));
  ok(Math.abs(cen.l - cen.r) <= 2 && cen.w <= 600 && cen.b <= cen.vh, "iPad portrait: the choice is a centred panel: " + JSON.stringify(cen));
  await shot("ask-choose-p820");
  await click('#pnAsk [data-act=ak-close].pn-btn');
  await size(390, 844);
  await ev(`window.Capacitor = window.__capWas; delete window.SMD_MAIK_MODELS; delete window.SMD_MAIK_LOCAL; window.SMD_AUTH = window.__authWas; PREP_ASK._reset(); return 1;`);

  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
