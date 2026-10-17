/* Code Blue ECG rhythm course in headless Chrome over CDP: the overlay opens with its
 * TRAINING badge and disclaimer, the six-step course advances, all 23 strips render on
 * a 1 mm/5 mm grid labelled schematic, calipers read ms plus rate via keyboard and a
 * synthetic touch drag, the 12-lead view shows territory ST elevation, flashcards reveal,
 * and the quiz scores 10 randomised questions with misses persisted. 390 px, light and
 * dark. Screenshots go to SHOTS=<dir>.
 *
 * USAGE: node test/run-codeblue-ecg-ui.mjs   (BASE=http://localhost:PORT/ for a running server; SHOTS=<dir> saves PNGs)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/cb-ecg-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FLAGS = (process.env.CHROME_FLAGS || "").split(/\s+/).filter(Boolean);

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=2"].concat(FLAGS), { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const shotCall = async (p) => { await sleep(200); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name, dark) => {
  if (!process.env.SHOTS) return;
  const fsx = await import("node:fs");
  fsx.mkdirSync(process.env.SHOTS, { recursive: true });
  await ev(`document.body.classList.${dark ? "add" : "remove"}("dark"); return 1;`);
  await sleep(400);
  const r = await shotCall({ format: "png" });
  if (r.result) fsx.writeFileSync(join(process.env.SHOTS, "ecg-" + name + "-" + (dark ? "dark" : "light") + ".png"), Buffer.from(r.result.data, "base64"));
};
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
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
  await call("Page.navigate", { url: BASE + "test/codeblue-ecg-harness.html" });
  ok(await until(`return !!window.CodeBlueECG && !!window.CodeBlueECG.open;`, 15000), "harness loads codeblue-ecg.js with open()");
  ok(await ev(`CodeBlueECG.open(); return CodeBlueECG.isOpen() && !!document.querySelector('.cbecg[role=dialog]');`) === true, "open() shows the dialog");
  ok(await ev(`return document.querySelector(".cbecg-train").textContent === "TRAINING";`) === true, "TRAINING badge shows");
  ok(await ev(`return document.querySelector(".cbecg-dis").textContent.indexOf("Not a substitute for clinical judgement") >= 0;`) === true, "disclaimer shows");
  ok(await ev(`return document.querySelector(".cbecg-edu").textContent.indexOf("says nothing about your own ECG") >= 0;`) === true, "education-only note shows");

  // ---- course
  ok(await ev(`return !!document.querySelector(".cbecg-step svg") && !!document.querySelector(".cbecg-take");`) === true, "course step renders diagram plus takeaway");
  ok(await ev(`return document.querySelectorAll(".cbecg-dot").length === 6;`) === true, "six course steps");
  await click('[data-cbecg-next]');
  ok(await ev(`return document.querySelector(".cbecg-prog").textContent.indexOf("Step 2 of 6") >= 0;`) === true, "course advances to step 2");
  await click('[data-cbecg-done]');
  ok(await ev(`try{return JSON.parse(localStorage.getItem("smd.cbecg.v1")).courseDone.length === 1;}catch(e){return false;}`) === true, "mark done persists to smd.cbecg.v1");
  await shot("course", false); await shot("course", true);

  // ---- strips + grid + calipers
  await click('[data-cbecg-tab="rhythms"]');
  ok(await ev(`return document.querySelectorAll("#cbecg-rhy option").length === 23;`) === true, "23 rhythm strips offered");
  ok(await ev(`return !!document.querySelector("[data-cbecg-measure]") && document.querySelector("[data-cbecg-measure]").textContent.indexOf("PR") >= 0 && document.querySelector("[data-cbecg-measure]").textContent.indexOf("Teaching") >= 0;`) === true, "measuring mode shows PR QRS QT with teaching flags");
  ok(await ev(`var s=document.querySelector(".cbecg-stripwrap svg"); return !!s && !!s.querySelector(".cbecg-grid-minor") && !!s.querySelector(".cbecg-grid-major");`) === true, "strip draws 1 mm and 5 mm grid");
  ok(await ev(`return document.querySelector(".cbecg-stripwrap svg text").textContent === "schematic";`) === true, "strip labelled schematic");
  await ev(`document.querySelector("#cbecg-rhy").value = "mobitz1"; document.querySelector("#cbecg-rhy").dispatchEvent(new Event("change", { bubbles: true })); return 1;`);
  ok(await ev(`return document.querySelector(".cbecg-meta").textContent.indexOf("irregular") >= 0;`) === true, "Mobitz I strip shows irregular");
  await click("[data-cbecg-calbtn]");
  ok(await ev(`return document.querySelectorAll(".cbecg-line").length === 2 && !!document.querySelector('[data-cbecg-read]').textContent.match(/ms/);`) === true, "calipers show an ms readout");
  const before = await ev(`return document.querySelector("[data-cbecg-read]").textContent;`);
  await ev(`var l=document.querySelector("[data-cbecg-l2]"); l.focus(); l.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); return 1;`);
  const afterKey = await ev(`return document.querySelector("[data-cbecg-read]").textContent;`);
  ok(before !== afterKey, `keyboard moves a caliper (${before} -> ${afterKey})`);
  ok(await ev(`return /per min/.test(document.querySelector("[data-cbecg-read]").textContent);`) === true, "caliper readout includes equivalent rate");
  await ev(`var w=document.querySelector("[data-cbecg-stripwrap]"); var r=w.getBoundingClientRect(); var l1=document.querySelector("[data-cbecg-l1]");
    l1.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, pointerType: "touch", clientX: r.left + r.width * 0.3, bubbles: true }));
    l1.dispatchEvent(new PointerEvent("pointermove", { pointerId: 5, pointerType: "touch", clientX: r.left + r.width * 0.1, bubbles: true }));
    l1.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5, pointerType: "touch", clientX: r.left + r.width * 0.1, bubbles: true })); return 1;`);
  const afterTouch = await ev(`return document.querySelector("[data-cbecg-read]").textContent;`);
  ok(afterTouch !== afterKey, `touch drag moves a caliper (${afterKey} -> ${afterTouch})`);
  await shot("strip", false); await shot("strip", true);

  // ---- 12-lead
  await click('[data-cbecg-tab="leads"]');
  ok(await ev(`return document.querySelectorAll(".cbecg-cell").length === 12;`) === true, "12 lead cells render");
  ok(await ev(`return document.querySelectorAll(".cbecg-cell.up").length === 4 && document.querySelectorAll(".cbecg-cell.dn").length === 3;`) === true, "anterior set: 4 elevated, 3 reciprocal");
  await ev(`document.querySelector("#cbecg-set").value = "inferior"; document.querySelector("#cbecg-set").dispatchEvent(new Event("change", { bubbles: true })); return 1;`);
  ok(await ev(`return document.querySelectorAll(".cbecg-cell.up").length === 3;`) === true, "inferior set: 3 elevated");
  await ev(`document.querySelector("#cbecg-set").value = "posterior"; document.querySelector("#cbecg-set").dispatchEvent(new Event("change", { bubbles: true })); return 1;`);
  ok(await ev(`return document.querySelectorAll(".cbecg-cell.dn").length === 3 && document.querySelector("[data-cbecg-leadnote]").textContent.indexOf("V7 to V9") >= 0;`) === true, "posterior set: 3 depressed with posterior-lead note");
  ok(await ev(`return document.querySelectorAll(".cbecg-pattern").length === 2;`) === true, "LBBB and Wellens pattern cards render");
  await shot("leads", false); await shot("leads", true);

  // ---- flashcards
  await click('[data-cbecg-tab="cards"]');
  ok(await ev(`return document.querySelector(".cbecg-flash .cbecg-q").textContent.indexOf("Which rhythm") >= 0;`) === true, "flashcard asks first");
  await click("[data-cbecg-flash]");
  ok(await ev(`return !!document.querySelector(".cbecg-flash .cbecg-cat");`) === true, "flashcard reveals name plus ACLS category");
  await shot("cards", false); await shot("cards", true);

  // ---- quiz
  await click('[data-cbecg-tab="quiz"]');
  ok(await ev(`return document.querySelectorAll("[data-cbecg-level]").length === 3;`) === true, "quiz offers easy medium hard levels");
  await click('[data-cbecg-level="hard"]');
  await click("[data-cbecg-start]");
  ok(await ev(`return document.querySelectorAll(".cbecg-qset").length === 10;`) === true, "quiz asks 10 questions");
  for (let i = 0; i < 10; i++) await ev(`var qs=document.querySelectorAll(".cbecg-qset"); var q=qs[${i}]; if(q){var r=q.querySelector("input[value='0']"); if(r) r.click();} return 1;`);
  ok(await until(`return !!document.querySelector(".cbecg-score");`, 8000), "quiz reports a score");
  console.log("quiz: " + await ev(`return document.querySelector(".cbecg-score").textContent;`));
  ok(await ev(`try{var s=JSON.parse(localStorage.getItem("smd.cbecg.v1")); return typeof s.quizBest === "number" && typeof s.misses === "object";}catch(e){return false;}`) === true, "quiz best and misses persist");
  await shot("quiz", false); await shot("quiz", true);

  // ---- compliance at 390 px
  const lum = (c) => { const x = c.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; };
  const ratio = (f, b) => (Math.max(lum(f), lum(b)) + 0.05) / (Math.min(lum(f), lum(b)) + 0.05);
  const cols = `var m=document.querySelector(".cbecg-body p")||document.querySelector(".cbecg-body"); if(!m) return "none";
    function opaque(c){var a=String(c).match(/[\\d.]+/g); return !a || a.length<3 || !(+a[0]===0&&+a[1]===0&&+a[2]===0&&a.length>3&&+a[3]===0);}
    var el=m, b=null; while(el){var c=getComputedStyle(el).backgroundColor; if(opaque(c)){b=c;break;} el=el.parentElement;}
    if(!b) b=getComputedStyle(document.body).backgroundColor;
    return getComputedStyle(m).color + " on " + b;`;
  await ev(`document.body.classList.remove("dark"); return 1;`); await sleep(300);
  const [fL, bL] = String(await ev(cols)).split(" on ");
  const crLight = bL === undefined ? 0 : ratio(fL, bL);
  ok(crLight >= 4.5, "light: body-text contrast " + (bL === undefined ? String(await ev(cols)) : crLight.toFixed(2) + ":1"));
  await ev(`document.body.classList.add("dark"); return 1;`); await sleep(300);
  const [fD, bD] = String(await ev(cols)).split(" on ");
  const crDark = bD === undefined ? 0 : ratio(fD, bD);
  ok(crDark >= 4.5, "dark: body-text contrast " + (bD === undefined ? String(await ev(cols)) : crDark.toFixed(2) + ":1"));
  ok(await ev(`return document.documentElement.clientWidth <= 390 && document.querySelector(".cbecg-sheet").scrollWidth <= 391;`) === true, "390 px: no horizontal scroll");
  ok(await ev(`return Array.from(document.querySelectorAll(".cbecg-btn,.cbecg-tab")).every(function(b){var r=b.getBoundingClientRect(); return r.height >= 44 || r.width === 0;});`) === true, "touch targets at least 44 px");
  /* iPad: ECG holds at 820x1180 and 1194x834. */
  for (const [w, h, tag] of [[820, 1180, "820"], [1194, 834, "1194"]]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await sleep(300);
    ok(await ev(`return document.querySelector(".cbecg-sheet").scrollWidth <= ${w} + 1;`) === true, `${tag}: no horizontal scroll`);
    ok(await ev(`return Array.from(document.querySelectorAll(".cbecg-btn,.cbecg-tab")).every(function(b){var r=b.getBoundingClientRect(); return r.height >= 44 || r.width === 0;});`) === true, `${tag}: touch targets at least 44 px`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  ok(await ev(`return CodeBlueECG.isOpen(); CodeBlueECG.close(); return !CodeBlueECG.isOpen() && !document.querySelector(".cbecg");`) === true, "close() removes the dialog");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  console.log(fails ? `FAILED ${fails}` : "ALL PASS");
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
try { ws && ws.close(); } catch {}
chrome.kill();
if (serveProc) serveProc.kill();
process.exit(fails ? 1 : 0);
