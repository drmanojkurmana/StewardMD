// test/run-narke-explore-ui.mjs: the six Narkē explorers in headless Chrome at 390 x 844.
// Loads the engine and Narkē through narke-loader.js (the loader lists narke-explore-ui.js/.css and narke/models.json lists
// the six explorer models), stubs learn/index.json with a small fixture so "Learn this" has a lesson to link, and drives each
// explorer's main interaction in English and Hindi, dark and paper themes. Screenshots go to SHOTS when set.
// USAGE: PORT=<free port> CHROME_PORT=<free port> node test/run-narke-explore-ui.mjs
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8994) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9414), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/narke-explore-ui-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE + "narke-explore-ui.js"); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const key = async (k, code, vk, text) => { await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const shot = async (name) => { if (!SHOTS) return; await sleep(250); const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "none"; b.click(); return 1;`);
const text = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); return b ? b.textContent.replace(/\\s+/g," ").trim() : null;`);
const slide = (sel, v) => ev(`var r=document.querySelector(${JSON.stringify(sel)}); r.value=${JSON.stringify(String(v))}; r.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
const openX = async (id) => { await ev(`NARKE._exploreUI.open(${JSON.stringify(id)}); return 1;`); return until(`return !!document.querySelector('.nkx[data-nkx="${id}"]');`); };
const scrollTo = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}), s=document.getElementById("exScroll"); if(e&&s) s.scrollTop += e.getBoundingClientRect().top - 70; return 1;`);
const noDevanagariDigits = () => ev(`return !/[०-९]/.test(document.getElementById("smdNarke").textContent);`);
// Layout checks at 390 px: nothing wider than the screen, every visible control at least 44 px tall (sliders, buttons, selects, summary).
const noOverflow = () => ev(`var s=document.getElementById("exScroll"); return s && s.scrollWidth <= s.clientWidth + 1;`);
// The app's Display setting zooms the whole page (home.js sets documentElement.style.zoom), so rects are divided by it.
const smallTargets = () => ev(`var z=parseFloat(document.documentElement.style.zoom||getComputedStyle(document.documentElement).zoom)||1; return [].filter.call(document.querySelectorAll('.nkx button, .nkx input, .nkx select, .nkx summary'), function(b){var r=b.getBoundingClientRect(); return r.width>0 && r.height>0 && r.height/z<43.5;}).map(function(b){return (b.getAttribute("data-act")||b.getAttribute("data-xin")||b.tagName)+":"+(b.getBoundingClientRect().height/z).toFixed(1);}).join(",");`);

const IDS = ["odc", "mac", "tof", "dermatomes", "ventilator", "circuit"];
const FIXTURE_IX = {
  v: 1,
  units: [{ id: "as4", title: { en: "General anaesthesia", hi: "General anaesthesia" }, level: "mbbs", lessons: ["as4-inhalational-agents"] }],
  lessons: { "as4-inhalational-agents": { title: { en: "Inhalational agents", hi: "Inhalational agents" }, minutes: 6, idea: { en: "x", hi: "x" }, see: { diagram: "x.svg" }, test: { mcqTopic: "inhalational", explorer: "mac" } } }
};

try {
  let ver, n = 0; while (n++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
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
  await until(`return !!window.NARKE_LOADER;`, 15000);
  ok(await ev(`return NARKE_LOADER.JS.indexOf("narke-explore-ui.js") > NARKE_LOADER.JS.indexOf("narke.js") && NARKE_LOADER.CSS.indexOf("narke-explore-ui.css") >= 0;`) === true, "loader lists the explorer UI after the host, and its stylesheet");
  // Learn index fixture before the first load (the real narke/learn lands with the content branches)
  await ev(`var f=window.fetch, IX=${JSON.stringify(JSON.stringify(FIXTURE_IX))}; window.fetch=function(u){ if(/narke\\/learn\\/index\\.json/.test(String(u))) return Promise.resolve(new Response(IX,{status:200,headers:{"content-type":"application/json"}})); return f.apply(this, arguments); }; return 1;`);
  await ev(`NARKE_LOADER.load(); return 1;`);
  ok(await until(`return !!(window.NARKE && NARKE._exploreUI && window.NARKE_EXPLORE_UI && NARKE._explore && NARKE._explore.length===6);`, 15000), "the six explorers register once narke/models.json loads their models");
  ok(await ev(`return NARKE._explore.every(function (x) { return !!NARKE_MODELS[x.id]; });`) === true, "only a loaded model is listed");
  await ev(`NARKE._syncModels(); return 1;`);
  ok(await ev(`return NARKE._explore.length;`) === 6, "a second sync does not register twice");

  await ev(`try{localStorage.removeItem("smd_narke_v1");localStorage.setItem("smd_narke_prefs", JSON.stringify({lang:"en",level:"mbbs",tab:"learn",seen:1}));}catch(e){} document.body.innerHTML='<div id="smdNarke"></div>'; document.body.classList.add("dark"); return 1;`);
  await ev(`NARKE.open(); return 1;`);
  if (await until(`return !!document.querySelector('[data-act=pick][data-t=learn]');`, 3000)) await click("[data-act=pick][data-t=learn]");
  ok(await until(`return document.querySelectorAll('[data-act=exopen]').length===6;`), "Learn home lists the six explorers");
  await scrollTo(".ex-home"); await shot("00-learn-home-explore-dark");

  /* ---- odc ---- */
  await click('[data-act=exopen][data-x="odc"]');
  ok(await until(`return !!document.querySelector('.nkx[data-nkx=odc] .nkx-chart path.nkx-spo2');`), "ODC: the curve is drawn");
  ok(await text(".nkx-meta .nkx-lv") === "MBBS" && await text(".nkx-meta .nkx-draft") === "AI draft, awaiting specialist review", "level and AI-draft review mark shown");
  ok(await ev(`return !!document.querySelector('.nkx-src ol.nkx-refs li a[href^="https://"]');`) === true, "sources listed with links");
  ok(await ev(`return document.querySelector(".nkx-src-b").offsetHeight===0;`) === true, "sources start closed");
  ok(/^90\.6/.test(await text(".nkx-readout .nkx-big")), "PaO2 60: saturation 90.6%");
  await slide("[data-xin=po2]", 40);
  ok(/^74\.9/.test(await text(".nkx-readout .nkx-big")) && await ev(`var r=document.querySelector("[data-xin=po2]"); return r.getAttribute("aria-valuetext")==="40 mmHg" && document.activeElement!==null;`) === true, "PaO2 slider 40: 74.9%, spoken value, slider stays mounted");
  await slide("[data-xin=ph]", 7.2);
  ok(/Right shift/.test(await text(".nkx-shift")) && /P50 is 32\.2/.test(await text(".nkx-readout")), "pH 7.2: right shift, P50 32.2");
  await click('[data-act=nkxodhbf]');
  ok(await until(`return document.querySelector('[data-act=nkxodhbf]').getAttribute("aria-pressed")==="true";`), "HbF toggle");
  ok(await ev(`return JSON.parse(localStorage.getItem("smd_narke_v1")||"{}").explore.odc != null;`) === true, "first interaction marks the explorer as explored");
  ok(await noOverflow(), "ODC: no horizontal overflow at 390 px");
  await shot("01-odc-dark");
  await click("[data-act=nkxodreset]");

  /* ---- mac ---- */
  ok(await openX("mac"), "MAC opens");
  ok(/1\.80%/.test(await text(".nkx-agents li:first-child")), "sevoflurane MAC 1.80% at age 40");
  await slide("[data-xin=age]", 80);
  ok(/1\.40%/.test(await text(".nkx-agents li:first-child")) && /80 years/.test(await text('[data-out=age]')), "age 80: sevoflurane MAC 1.40%");
  await slide("[data-xin=age]", 40);
  ok(/0\.67/.test(await text("#nkxLive2 .nkx-big")), "sevoflurane 1.2%: 0.67 MAC");
  await slide("[data-xin=n2o]", 50);
  ok(/1\.15/.test(await text("#nkxLive2 .nkx-big")) && /half of patients/.test(await text("#nkxLive2")), "+ N2O 50%: 1.15 MAC, the 1 MAC band");
  await click('[data-act=nkxmcag][data-v="isoflurane"]');
  ok(await until(`return /End-tidal Isoflurane/.test(document.querySelector('[data-xin=et]').closest("label").textContent);`), "switching agent keeps the MAC fraction and relabels the slider");
  ok(await until(`return !!document.querySelector('.nkx [data-act=lesson][data-l="as4-inhalational-agents"]');`), "Learn this links the lesson whose test names the explorer");
  ok(await noOverflow(), "MAC: no horizontal overflow");
  await shot("02-mac-dark");

  /* ---- tof ---- */
  ok(await openX("tof"), "TOF opens");
  ok(/Minimal block/.test(await text(".nkx-readout .nkx-stage")) && /Residual block/.test(await text(".nkx")), "count 4, ratio 0.6: minimal, residual warning");
  ok(/neostigmine/i.test(await text("#nkxLive")) && /Sugammadex 2 mg\/kg: 120 mg/.test(await text("#nkxLive")), "minimal: sugammadex 2 mg/kg (120 mg at 60 kg) or neostigmine");
  await click('[data-act=nkxtfc][data-v="0"]');
  ok(await until(`return /Deep block/.test(document.querySelector(".nkx-readout .nkx-stage").textContent) && document.activeElement && document.activeElement.getAttribute("data-v")==="0";`), "count 0, PTC 5: deep block, focus kept on the pressed button");
  ok(/Sugammadex 4 mg\/kg: 240 mg/.test(await text("#nkxLive")), "deep: sugammadex 4 mg/kg");
  for (let i = 0; i < 5; i++) { await ev(`document.querySelector('[data-act=nkxtfp][data-v="-1"]').focus(); return 1;`); await key("Enter", "Enter", 13, "\r"); }
  ok(await until(`return /Intense block/.test(document.querySelector(".nkx-readout .nkx-stage").textContent);`), "PTC 0 by keyboard: intense block");
  await click('[data-act=nkxtff][data-v="benzyl"]');
  ok(await until(`return /Wait/.test(document.getElementById("nkxLive").textContent);`), "atracurium family at intense block: wait");
  await click('[data-act=nkxtfc][data-v="4"]'); await slide("[data-xin=ratio]", 0.95);
  ok(/Recovered/.test(await text(".nkx-readout .nkx-stage")), "ratio 0.95: recovered");
  ok(await noOverflow(), "TOF: no horizontal overflow");
  await shot("03-tof-dark");

  /* ---- dermatomes ---- */
  ok(await openX("dermatomes"), "dermatomes opens");
  ok(await ev(`return !!document.querySelector(".nkx-body .nkx-lvl") && !document.querySelector(".nkx-body text");`) === true, "original body SVG, no text inside");
  ok(/Enough: Hip surgery/.test(await text("#nkxLive2")), "T10 is enough for hip surgery");
  await ev(`var s=document.querySelector('[data-xin=op]'); s.value="caesarean"; s.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
  ok(/Not enough: Caesarean delivery needs T4, 6 segments higher/.test(await text("#nkxLive2")), "caesarean at T10: not enough, 6 segments short");
  await slide("[data-xin=level]", 10); // C2..C8 = 0..6, T1 = 7, T4 = 10
  ok(/^T4/.test(await text(".nkx-readout .nkx-big")) && /Enough/.test(await text("#nkxLive2")) && /bradycardia/.test(await text("#nkxLive")), "T4: enough for caesarean, cardiac accelerator warning");
  ok(await ev(`return document.querySelector("[data-xin=level]").getAttribute("aria-valuetext")==="T4";`) === true, "slider speaks the level");
  ok(await noOverflow(), "dermatomes: no horizontal overflow");
  await shot("04-dermatomes-dark");

  /* ---- ventilator ---- */
  ok(await openX("ventilator"), "ventilator opens");
  ok(await ev(`return document.querySelectorAll(".nkx-mon .nkx-wave path.nkx-line").length===3;`) === true, "three channels: pressure, flow, volume");
  ok(/Peak\s*18/.test(await text(".nkx-num6")) && /Plateau\s*15/.test(await text(".nkx-num6")), "VC defaults: peak 18, plateau 15");
  await click('[data-act=nkxvpre][data-v="bronchospasm"]');
  ok(await until(`return /plateau stays about the same/.test(document.getElementById("nkxLive").textContent);`), "bronchospasm in VC: the lesson line");
  await click('[data-act=nkxvmode][data-v="pc"]');
  ok(await until(`return !!document.querySelector("[data-xin=pinsp]") && /tidal volume falls/.test(document.getElementById("nkxLive").textContent);`), "PC: inspiratory pressure slider, bronchospasm lowers tidal volume");
  await click('[data-act=nkxvpre][data-v="stiff"]'); await click('[data-act=nkxvmode][data-v="vc"]');
  ok(await until(`return /Plateau 30 cmH2O or more/.test(document.getElementById("nkxLive").textContent);`), "stiff lung in VC: plateau alert");
  await slide("[data-xin=compliance]", 50);
  ok(await ev(`return document.querySelector('[data-act=nkxvpre][data-v=stiff]').getAttribute("aria-pressed")==="false";`) === true, "moving a slider off the preset clears the chip");
  ok(await noOverflow(), "ventilator: no horizontal overflow");
  await shot("05-ventilator-dark");

  /* ---- circuit ---- */
  ok(await openX("circuit"), "circuit opens");
  ok(await ev(`return !!document.querySelector(".nkx-circ [data-part=absorber]") && !document.querySelector(".nkx-circ text");`) === true, "original schematic, no text inside");
  ok(/^0/.test(await text(".nkx-num3 dd")), "working absorber: inspired CO2 0");
  await click('[data-act=nkxciabs][data-v="exhausted"]');
  ok(await until(`return /Inspired CO2 is above zero/.test(document.getElementById("nkxLive").textContent);`), "exhausted absorber at 2 L/min: rebreathing alert");
  await slide("[data-xin=fgf]", 9); // 6 L/min
  ok(/^0/.test(await text(".nkx-num3 dd")) && /washes CO2 out/.test(await text("#nkxLive")), "fresh gas 6 L/min = minute ventilation: washout");
  await slide("[data-xin=fgf]", 3);
  ok(/^>100/.test(await text(".nkx-num3 dd")), "1 L/min with no absorber: above 100, still rising");
  await click('[data-act=nkxcipart][data-v="apl"]');
  ok(await until(`return !!document.querySelector(".nkx-circ [data-part=apl].nkx-hl") && /Adjustable pressure limiting/.test(document.querySelector(".nkx-role").textContent);`), "APL chip highlights the valve and explains it");
  ok(await noOverflow(), "circuit: no horizontal overflow");
  await shot("06-circuit-dark");

  /* ---- 44 px targets on every screen ---- */
  for (const id of IDS) { await openX(id); await sleep(600); const sm = await smallTargets(); ok(sm === "", id + ": every control at least 44 px tall" + (sm ? " (" + sm + ")" : "")); }

  /* ---- Hindi ---- */
  await click("[data-act=lang]");
  ok(await until(`return document.getElementById("smdNarke").getAttribute("lang")==="hi";`), "Hindi switch repaints the explorer");
  for (const id of IDS) {
    await openX(id);
    ok(await noDevanagariDigits(), id + " (hi): numerals stay ASCII");
    ok(await ev(`return /[ऀ-ॿ]/.test(document.querySelector(".nkx").textContent);`) === true, id + " (hi): Hindi text");
  }
  await openX("tof"); await shot("07-tof-hi-dark");

  /* ---- paper theme ---- */
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await click("[data-act=lang]");
  await until(`return !document.getElementById("smdNarke").getAttribute("lang");`);
  for (const [i, id] of IDS.entries()) { await openX(id); await shot(`1${i}-${id}-paper`); }
  ok(await ev(`return getComputedStyle(document.querySelector(".nkx-mon")).backgroundColor;`) === "rgb(5, 7, 10)", "monitor plate stays black on paper");
  const explored = await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_narke_v1")).explore||{}).sort().join(",");`);
  ok(explored === [...IDS].sort().join(","), "all six marked explored after use: " + explored);

  await click(".sp-top .sp-back");
  ok(await until(`return document.querySelectorAll('[data-act=exopen]').length===6 && document.querySelectorAll('.ex-done').length===6;`), "back returns to Learn, six explored ticks");
  ok(errors.length === 0, "no uncaught errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
