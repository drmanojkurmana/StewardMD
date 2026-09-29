// test/run-tokos-explore-ui.mjs: the six Tokós explorers in headless Chrome at 390 x 844.
// Loads the engine and Tokós through tokos-loader.js, then the six explorer models (tokos/models.json lists them only
// after integration), stubs learn/index.json with a small fixture so "Learn this" has lessons to link, and drives each
// explorer's main interaction in English and Hindi. Screenshots go to SHOTS (default the job's tokos2-shots/explore/).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
// BASE (a running server) or PORT (the server this harness starts) and CHROME_PORT override the defaults, so parallel sessions do not collide.
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8993) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9413), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tokos-explore-ui-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE + "tokos-explore-ui.js"); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8993"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const key = async (k, code, vk, text) => { await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const shot = async (name) => { if (!SHOTS) return; await sleep(250); const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "none"; b.click(); return 1;`);
const text = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); return b ? b.textContent.replace(/\\s+/g," ").trim() : null;`);
const slide = (sel, v) => ev(`var r=document.querySelector(${JSON.stringify(sel)}); r.value=${JSON.stringify(String(v))}; r.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
const openX = async (id) => {
  await ev(`TOKOS._exploreUI.open(${JSON.stringify(id)}); return 1;`);
  return until(`return !!document.querySelector('.tkx[data-tkx="${id}"]');`);
};
const scrollTo = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}), s=document.getElementById("exScroll"); if(e&&s) s.scrollTop += e.getBoundingClientRect().top - 70; return 1;`);
const noDevanagariDigits = () => ev(`return !/[०-९]/.test(document.getElementById("smdTokos").textContent);`);

const IDS = ["mechanism", "cycle", "palm-coein", "popq", "ovarian-triage", "cervical-screening"];
const FIXTURE_IX = {
  v: 1,
  units: [{ id: "ob3", title: { en: "Labour", hi: "प्रसव" }, level: "mbbs", lessons: ["ob3-mechanism"] }, { id: "gy11", title: { en: "Ovarian tumours", hi: "अंडाशय के ट्यूमर" }, level: "mbbs", lessons: ["gy11-ultrasound-iota"] }],
  lessons: {
    "ob3-mechanism": { title: { en: "Mechanism of labour: how the head turns to fit", hi: "प्रसव की क्रियाविधि" }, minutes: 6, idea: { en: "x", hi: "x" }, see: { diagram: "x.svg" }, test: { mcqTopic: "ob-labour" } },
    "gy11-ultrasound-iota": { title: { en: "Reading the ultrasound: the IOTA simple rules", hi: "अल्ट्रासाउंड पढ़ना" }, minutes: 6, idea: { en: "x", hi: "x" }, see: { diagram: "x.svg" }, test: { mcqTopic: "gy-benign", explorer: "ovarian-triage" } }
  }
};

try {
  let ver, n = 0; while (n++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  await until(`return !!window.TOKOS_LOADER;`, 15000);
  ok(await ev(`return TOKOS_LOADER.JS.indexOf("tokos-explore-ui.js") > TOKOS_LOADER.JS.indexOf("tokos.js") && TOKOS_LOADER.CSS.indexOf("tokos-explore-ui.css") >= 0;`) === true, "loader lists the explorer UI after the host, and its stylesheet");
  await ev(`TOKOS_LOADER.load(); return 1;`);
  ok(await until(`return !!(window.TOKOS && TOKOS._exploreUI && window.TOKOS_EXPLORE_UI);`, 15000), "explorer UI loads with the engine");
  // tokos/models.json now lists the explorers, so they may already be loaded here: only a loaded model is listed.
  ok(await ev(`return TOKOS._explore.every(function (x) { return !!(window.TOKOS_MODELS || {})[x.id]; });`) === true, "no explorer is listed before its model loads");

  // the models (integration lists them in tokos/models.json), then the engine's model sync registers the screens
  await ev(`window.__m=0; ${JSON.stringify(IDS)}.forEach(function(id){var s=document.createElement("script"); s.src="/tokos-models/explorer-"+id+".js"; s.onload=function(){window.__m++;}; document.head.appendChild(s);}); return 1;`);
  await until(`return window.__m===6;`);
  // Learn index fixture: the real tokos/learn lands with the content branches
  await ev(`var f=window.fetch, IX=${JSON.stringify(JSON.stringify(FIXTURE_IX))}; window.fetch=function(u){ if(/learn\\/index\\.json/.test(String(u))) return Promise.resolve(new Response(IX,{status:200,headers:{"content-type":"application/json"}})); return f.apply(this, arguments); }; TOKOS._syncModels(); return 1;`);
  ok(await ev(`return TOKOS._explore.map(function(x){return x.id;}).join(",");`) === IDS.join(","), "all six explorers register once their models load");
  await ev(`TOKOS._syncModels(); return 1;`);
  ok(await ev(`return TOKOS._explore.length;`) === 6, "a second sync does not register twice");

  await ev(`try{localStorage.removeItem("smd_tokos_v1");localStorage.setItem("smd_tokos_prefs", JSON.stringify({lang:"en",level:"mbbs",tab:"learn",seen:1}));}catch(e){} document.body.innerHTML='<div id="smdTokos"></div>'; document.body.classList.add("dark"); return 1;`);
  await ev(`TOKOS.open(); return 1;`);
  if (await until(`return !!document.querySelector('[data-act=pick][data-t=learn]');`, 3000)) await click("[data-act=pick][data-t=learn]");
  ok(await until(`return document.querySelectorAll('[data-act=exopen]').length===6;`), "Learn home lists the six explorers");
  await scrollTo(".ex-home"); await shot("00-learn-home-explore-dark");

  /* ---- mechanism ---- */
  await click('[data-act=exopen][data-x="mechanism"]');
  ok(await until(`return !!document.querySelector('.tkx[data-tkx=mechanism] .tkx-fig svg [data-part]');`), "mechanism: the original SVG frame is inlined");
  ok(await text(".tkx-meta .tkx-lv") === "MBBS" && await text(".tkx-meta .tkx-draft") === "AI draft, awaiting specialist review", "level and AI-draft review mark shown");
  ok(await ev(`return !!document.querySelector('.tkx-src ol.tkx-refs li a[href^="https://"]');`) === true, "sources listed with links");
  ok(await until(`return !!document.querySelector('.tkx [data-act=lesson][data-l="ob3-mechanism"]');`), "Learn this links the mechanism lesson from the index");
  ok(await ev(`return document.querySelector(".tkx-src-b").offsetHeight===0;`) === true, "sources start closed and take no space");
  await click(".tkx-src summary");
  ok(await ev(`return document.querySelector(".tkx-src").open && document.querySelector(".tkx-src-b").offsetHeight>0;`) === true, "sources open on tap");
  await click(".tkx-src summary");
  await shot("01-mechanism-dark");
  await click('[data-act=tkxmstep][data-v="1"]');
  ok(await until(`return /Descent/.test(document.getElementById("tkxMvH").textContent) && document.querySelector('[data-act=tkxmgo][aria-current=step]').getAttribute("data-v")==="1";`), "Next steps to Descent");
  await click('[data-act=tkxmgo][data-v="3"]');
  ok(await until(`return /Internal rotation/i.test(document.getElementById("tkxMvH").textContent) && /90 degrees/.test(document.querySelector(".tkx-turn").textContent);`), "internal rotation from LOT turns the occiput 90 degrees");
  await until(`return !!document.querySelector('.tkx-fig svg');`);
  await click('[data-act=tkxmpart][data-v="occiput"]');
  ok(await until(`return !!document.querySelector('.tkx-fig [data-part=occiput].tkx-hl') && document.querySelector('[data-act=tkxmpart][data-v=occiput]').getAttribute("aria-pressed")==="true";`), "a part chip highlights that part in the picture");
  await ev(`document.querySelector('[data-act=tkxmstep][data-v="1"]').focus(); return 1;`);
  await key("ArrowRight", "ArrowRight", 39);
  ok(await until(`return /Extension/.test(document.getElementById("tkxMvH").textContent);`), "Right arrow steps forward (keyboard)");
  await ev(`var s=document.querySelector('[data-xin=start]'); s.value="OP"; s.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
  ok(await until(`return document.querySelector('[data-act=tkxmop]').disabled===false;`), "a posterior start enables the persistent OP toggle");
  await click("[data-act=tkxmop]"); await click('[data-act=tkxmgo][data-v="7"]');
  ok(await until(`return /Born as OP/.test(document.querySelector(".tkx").textContent);`), "persistent OP is born as OP");
  await slide("[data-xin=station]", 3);
  ok(await text("#tkxLive .tkx-num") === "+3 cm" && /Below the ischial spines/.test(await text("#tkxLive")), "station slider: +3 cm, below the spines (live, no repaint)");
  ok(await ev(`var r=document.querySelector('[data-xin=station]'); return r.value==="3" && r.getAttribute("aria-valuetext")==="+3 cm";`) === true, "slider stays mounted with its spoken value");
  ok(await ev(`return JSON.parse(localStorage.getItem("smd_tokos_v1")||"{}").explore.mechanism != null;`) === true, "first interaction marks the explorer as explored");
  await scrollTo("#tkxStH"); await shot("02-mechanism-station-dark");

  /* ---- cycle ---- */
  ok(await openX("cycle"), "cycle opens");
  ok(/Relative levels/.test(await text("#tkxCyH")), "the chart is labelled relative levels");
  ok(await ev(`return document.querySelectorAll(".tkx-chart path.tkx-c").length===4 && document.querySelectorAll(".tkx-legend li").length===4;`) === true, "four hormone curves with a legend");
  await slide("[data-xin=day]", 21);
  ok(/Day 21 of 28/.test(await text(".tkx-daybig")) && /Luteal/.test(await text(".tkx-kv")) && /Secretory/.test(await text(".tkx-kv")), "day 21: luteal, secretory lining");
  await slide("[data-xin=day]", 3);
  ok(/Menstrual/.test(await text(".tkx-kv")), "day 3: menstrual lining");
  await click('[data-act=tkxclen][data-v="1"]');
  ok(await until(`return /29 days/.test(document.querySelector(".tkx-stepper output").textContent) && document.querySelector("[data-xin=day]").max==="29";`), "cycle length stepper to 29 days widens the slider");
  await slide("[data-xin=day]", 14); await shot("03-cycle-dark");

  /* ---- palm-coein ---- */
  ok(await openX("palm-coein"), "PALM-COEIN opens");
  ok(await until(`return !!document.getElementById("tkxPcH");`), "vignettes load from tokos/explorer/palm-coein.json");
  ok(/Case 1 of 16/.test(await text(".tkx-caseline")), "16 cases");
  await click('[data-act=tkxpc][data-v="P"]'); await shot("04-palm-pick-dark");
  await click("[data-act=tkxpccheck]");
  ok(await until(`return /Correct/.test((document.querySelector(".tkx-result")||{}).textContent||"") && /AUB-P/.test(document.querySelector(".tkx-result").textContent);`), "polyp case: Correct, AUB-P");
  await scrollTo(".tkx-result"); await shot("05-palm-feedback-dark");
  await click('[data-act=tkxpcnext][data-v="1"]');
  ok(/Case 2 of 16/.test(await text(".tkx-caseline")) && /1 of 1 right/.test(await text(".tkx-caseline")), "next case, session score kept");
  await click('[data-act=tkxpc][data-v="C"]'); await click("[data-act=tkxpccheck]");
  ok(await until(`return /Not quite/.test(document.querySelector(".tkx-result").textContent) && /Missed/.test(document.querySelector(".tkx-result").textContent);`), "a wrong pick explains what was missed");

  /* ---- popq ---- */
  ok(await openX("popq"), "POP-Q opens");
  ok(await ev(`return document.querySelectorAll(".tkx-grid .tkx-cell").length===9;`) === true, "nine-point grid");
  ok(/Stage 0/.test(await text("#tkxLive .tkx-stage")), "starting values are stage 0");
  await click('[data-act=tkxpq][data-v="Ba"]');
  for (let i = 0; i < 8; i++) { await ev(`document.querySelector('[data-act=tkxpqstep][data-v="0.5"]').focus(); return 1;`); await key("Enter", "Enter", 13, "\r"); }
  ok(await text('[data-act=tkxpq][data-v="Ba"] b') === "+1" && /Stage II/.test(await text("#tkxLive .tkx-stage")) && /Ba at \+1 cm/.test(await text("#tkxLive")), "Ba +1: stage II, leading edge Ba");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute("data-act")==="tkxpqstep";`) === true, "focus stays on the stepper after a repaint");
  ok(await ev(`return !!document.querySelector('.tkx [data-act=lesson]');`) === false, "no lesson in the index: no Learn this section (graceful absence)");
  await shot("06-popq-dark");
  await click("[data-act=tkxpqnod]");
  ok(await ev(`return document.querySelector('[data-act=tkxpq][data-v=D]').disabled;`) === true, "no cervix: D is left out");

  /* ---- ovarian triage ---- */
  ok(await openX("ovarian-triage"), "ovarian triage opens");
  ok(/No feature ticked/.test(await text("#tkxLive")), "empty state before any feature");
  await click('[data-act=tkxot][data-v="B1"]');
  ok(/Benign/.test(await text("#tkxLive .tkx-stage")), "B1 only: benign");
  await click('[data-act=tkxot][data-v="M5"]');
  ok(/Inconclusive/.test(await text("#tkxLive .tkx-stage")) && /Rule 3/.test(await text("#tkxLive")), "B1 + M5: inconclusive, rule 3");
  await click('[data-act=tkxot][data-v="B1"]');
  ok(/Malignant/.test(await text("#tkxLive .tkx-stage")), "M5 only: malignant");
  ok(await until(`return !!document.querySelector('.tkx [data-act=lesson][data-l="gy11-ultrasound-iota"]');`), "Learn this found by the lesson's test.explorer");
  await scrollTo("#tkxOtR"); await shot("07-ovarian-dark");

  /* ---- cervical screening ---- */
  ok(await openX("cervical-screening"), "cervical screening opens");
  await click('[data-act=tkxcx][data-v="age-30-65"]');
  ok(await until(`return /VIA/.test(document.getElementById("tkxCxH").textContent) && document.activeElement===document.getElementById("tkxCxH");`), "30 to 65: VIA step, focus on the step heading");
  await click('[data-act=tkxcx][data-v="positive"]');
  ok(await until(`return !!document.querySelector("[data-act=tkxcxq]");`), "VIA positive: cryotherapy eligibility check");
  ok(/Eligible/.test(await text(".tkx-sub .tkx-result")) && await ev(`return document.querySelector('[data-act=tkxcx][data-v="eligible-cryo"]').classList.contains("pri");`) === true, "default findings: eligible, suggestion marked");
  await click('[data-act=tkxcxq][data-v="3"]');
  ok(/Not eligible/.test(await text(".tkx-sub .tkx-result")) && await ev(`return document.querySelector('[data-act=tkxcx][data-v="not-eligible"]').classList.contains("pri");`) === true, "3 quadrants: not eligible, suggestion follows");
  await scrollTo(".tkx-choices"); await shot("08-cervical-dark");
  await click('[data-act=tkxcx][data-v="not-eligible"]'); await click('[data-act=tkxcx][data-v="cin2-3"]');
  ok(await until(`return /LEEP/.test(document.getElementById("tkxCxH").textContent) && document.querySelectorAll(".tkx-trail li").length===4;`), "biopsy CIN 2-3: LEEP, trail of four steps");
  await click("[data-act=tkxcxback]");
  ok(await until(`return /Biopsy/.test(document.getElementById("tkxCxH").textContent);`), "back one step");
  await click("[data-act=tkxcxreset]");
  ok(await until(`return /Who is in front/.test(document.getElementById("tkxCxH").textContent) && !document.querySelector(".tkx-trail");`), "start again");

  /* ---- Hindi ---- */
  await click("[data-act=lang]");
  ok(await until(`return document.getElementById("smdTokos").getAttribute("lang")==="hi";`), "Hindi switch repaints the explorer");
  await click('[data-act=tkxcx][data-v="age-30-65"]');
  ok(await noDevanagariDigits(), "cervical (hi): no Devanagari digits");
  for (const id of IDS) {
    await openX(id);
    await until(`return !document.querySelector(".tkx-sk,.tkx-fig-sk");`, 5000);
    ok(await noDevanagariDigits(), id + " (hi): numerals stay ASCII");
  }
  await openX("cycle");
  ok(/दिन 14 \/ 29/.test(await text(".tkx-daybig")), "cycle (hi): दिन 14 / 29");
  await shot("09-cycle-hi-dark");
  await openX("popq");
  ok(/Stage II/.test(await text("#tkxLive .tkx-stage")) && /\+1/.test(await text('[data-act=tkxpq][data-v="Ba"] b')), "POP-Q (hi): stage and signed values ASCII");
  await openX("mechanism");
  ok(/चरण|Movement/.test(await text("#tkxMvH")) && /[ऀ-ॿ]/.test(await text(".tkx-lead")), "mechanism (hi): Hindi text");
  await shot("10-mechanism-hi-dark");

  /* ---- paper theme ---- */
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await click("[data-act=lang]");
  await until(`return !document.getElementById("smdTokos").getAttribute("lang");`);
  for (const [i, id] of IDS.entries()) { await openX(id); await until(`return !document.querySelector(".tkx-sk,.tkx-fig-sk");`, 5000); await shot(`1${i + 1}-${id}-paper`); }
  await openX("palm-coein"); await click('[data-act=tkxpcagain]'); await click('[data-act=tkxpc][data-v="O"]'); await click('[data-act=tkxpc][data-v="C"]'); await click("[data-act=tkxpccheck]");
  await until(`return !!document.querySelector(".tkx-result");`); await scrollTo(".tkx-result"); await shot("17-palm-feedback-paper");
  const explored = await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_tokos_v1")).explore||{}).sort().join(",");`);
  ok(explored === [...IDS].sort().join(","), "all six marked explored after use: " + explored);

  // back from an explorer returns to Learn
  await click(".sp-top .sp-back");
  ok(await until(`return document.querySelectorAll('[data-act=exopen]').length===6 && document.querySelectorAll('.ex-done').length===6;`), "back returns to Learn, six explored ticks");

  ok(errors.length === 0, "no uncaught errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
