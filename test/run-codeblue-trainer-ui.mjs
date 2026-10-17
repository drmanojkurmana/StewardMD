/* CodeBlue trainer in headless Chrome over CDP: home (disclaimer + TRAINING badge),
 * guided flow (wrong pick explained, correct pick coached), test station to a scored
 * debrief, a practice case to a result, My training with reset. 390 px, light and dark.
 * Screenshots go to SHOTS=<dir>.
 *
 * USAGE: node test/run-codeblue-trainer-ui.mjs   (BASE=http://localhost:PORT/ for a running server; SHOTS=<dir> saves PNGs)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/cb-trainer-" + PORT + "-" + Date.now();
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
  if (r.result) fsx.writeFileSync(join(process.env.SHOTS, "cbt-" + name + "-" + (dark ? "dark" : "light") + ".png"), Buffer.from(r.result.data, "base64"));
};
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const clickNth = (sel, n) => ev(`var b=document.querySelectorAll(${JSON.stringify(sel)})[${n}]; if(!b) return "missing"; b.click(); return 1;`);
const badgeEverywhere = `return (function(){var r=document.getElementById("cbtRoot"); if(!r||!r.classList.contains("on")) return false; return !!r.querySelector(".cbt-badge");})();`;

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/CodeBlue|CBT|cbt/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE + "test/fixtures/codeblue-trainer.html" });
  ok(await until(`return !!window.CodeBlueTrainer && !!window.CodeBlueTrainerData;`, 30000), "trainer scripts load with data");
  await ev(`try{localStorage.removeItem("smd.cbtrain.v1");}catch(e){} return 1;`);
  await ev(`CodeBlueTrainer.open(); return 1;`);
  ok(await until(`return CodeBlueTrainer.isOpen() && !!document.querySelector("#cbtRoot .cbt-station");`, 8000), "home opens with stations");
  ok(await ev(`return document.querySelector("#cbtRoot .cbt-disc").textContent.indexOf("Not a substitute for clinical judgement") >= 0;`) === true, "disclaimer shown on entry");
  ok(await ev(badgeEverywhere) === true, "home shows TRAINING badge");
  await shot("home", false); await shot("home", true);

  // ---- guided: wrong pick explained, correct pick coached ----
  await click('#cbtRoot [data-act="go-guided"]');
  ok(await until(`return !!document.querySelector('#cbtRoot [data-act="start-guided"]');`, 8000), "guided list renders");
  ok(await ev(`return document.querySelectorAll('#cbtRoot [data-act="start-guided"]').length >= 6;`) === true, "adult guided list holds at least 6");
  ok(await ev(badgeEverywhere) === true, "list shows TRAINING badge");
  await click('#cbtRoot [data-act="start-guided"]');
  ok(await until(`return !!document.querySelector("#cbtRoot .cbt-opt");`, 8000), "guided run starts");
  const nOpts = await ev(`return document.querySelectorAll("#cbtRoot .cbt-opt").length;`);
  ok(nOpts >= 3, "short action list (" + nOpts + ")");
  // Pick a wrong option first: find one that is not the correct index via engine.
  await ev(`var E=CodeBlueTrainer._engine; var s=E.findScenario("adult-vf-1"); window.__ci=s.states[0].o.findIndex(function(o){return o[1]===1;}); window.__wi=(window.__ci+1)%s.states[0].o.length; return 1;`);
  await ev(`document.querySelectorAll("#cbtRoot .cbt-opt")[window.__wi].click(); return 1;`);
  ok(await until(`return !!document.querySelector("#cbtRoot .cbt-why");`, 8000), "wrong pick explained, learner continues");
  ok(await ev(`return document.querySelector("#cbtRoot .cbt-p").textContent.length > 0 && !document.querySelector("#cbtRoot .cbt-next");`) === true, "no advance after a wrong pick");
  await ev(`document.querySelectorAll("#cbtRoot .cbt-opt")[window.__ci].click(); return 1;`);
  ok(await until(`return !!document.querySelector("#cbtRoot .cbt-coach");`, 8000), "correct pick shows one-sentence coach");
  await shot("guided", false); await shot("guided", true);

  // ---- test station: run to a scored debrief ----
  await click('#cbtRoot [data-act="home"]');
  await click('#cbtRoot [data-act="go-test"]');
  await click('#cbtRoot [data-act="start-test"]');
  ok(await until(`return !!document.querySelector("#cbtRoot #cbtTime");`, 8000), "test clock renders");
  ok(await ev(`return document.querySelector("#cbtRoot .cbt-clock").textContent.indexOf("TRAINING") >= 0;`) === true, "clock labelled TRAINING");
  const nStates = await ev(`return CodeBlueTrainer._engine.findScenario("adult-vf-1").states.length;`);
  for (let i = 0; i < nStates; i++) {
    await until(`return !!document.querySelector("#cbtRoot .cbt-opt");`, 8000);
    await ev(`var E=CodeBlueTrainer._engine; var s=E.findScenario("adult-vf-1"); var ci=s.states[${i}] ? s.states[${i}].o.findIndex(function(o){return o[1]===1;}) : 0; var b=document.querySelectorAll("#cbtRoot .cbt-opt")[ci]; if(b) b.click(); return 1;`);
    await sleep(250);
  }
  ok(await until(`return !!document.querySelector("#cbtRoot .cbt-score");`, 10000), "test ends with a percentage score");
  ok(await ev(`return /%/.test(document.querySelector("#cbtRoot .cbt-score").textContent);`) === true, "score reads as a percentage");
  ok(await ev(`return ["Correct","Late","Missed"].every(function(h){return Array.from(document.querySelectorAll("#cbtRoot .cbt-sub")).some(function(e){return e.textContent===h;});});`) === true, "debrief lists correct, late and missed");
  ok(await ev(`return document.querySelector("#cbtRoot").textContent.indexOf("epinephrine due 180 s") >= 0;`) === true, "debrief cites SPEC timings");
  ok(await ev(badgeEverywhere) === true, "debrief shows TRAINING badge");
  await shot("debrief", false); await shot("debrief", true);

  // ---- practice case: clues plus quiz to a result ----
  await click('#cbtRoot [data-act="home"]');
  await click('#cbtRoot [data-act="go-cases"]');
  ok(await ev(`return document.querySelectorAll('#cbtRoot [data-act="start-case"]').length >= 8;`) === true, "adult case list holds at least 8");
  await click('#cbtRoot [data-act="start-case"]');
  ok(await until(`return !!document.querySelector("#cbtRoot #cbtQuiz .cbt-opt");`, 8000), "case runs quiz with timed clues");
  for (let i = 0; i < 3; i++) {
    await until(`return !!document.querySelector("#cbtRoot #cbtQuiz .cbt-opt");`, 8000);
    await clickNth("#cbtRoot #cbtQuiz .cbt-opt", 0);
    ok(await until(`return !!document.querySelector("#cbtRoot #cbtFb .cbt-next");`, 8000), "quiz answer shows rationale " + (i + 1));
    await click('#cbtRoot #cbtFb .cbt-next');
    await sleep(250);
  }
  ok(await until(`return !!document.querySelector("#cbtRoot .cbt-score") && /of/.test(document.querySelector("#cbtRoot .cbt-score").textContent);`, 8000), "case ends with a result");
  await shot("case", false);

  // ---- my training: best, trend, weak spots, reset ----
  await click('#cbtRoot [data-act="go-mine"]');
  ok(await until(`return /Best (scenario|case) scores|No training/.test(document.querySelector("#cbtRoot").textContent);`, 8000), "my training renders");
  ok(await ev(`return /Best (scenario|case) scores/.test(document.querySelector("#cbtRoot").textContent);`) === true, "completions recorded best scores");
  ok(await ev(`return /Weak spots/.test(document.querySelector("#cbtRoot").textContent);`) === true, "weak spots by topic render");
  await shot("mine", true);
  await ev(`window.confirm=function(){return true;}; return 1;`);
  await click('#cbtRoot [data-act="reset"]');
  ok(await until(`return /No training recorded/.test(document.querySelector("#cbtRoot").textContent);`, 8000), "reset clears training");

  // ---- compliance at 390 px ----
  await click('#cbtRoot [data-act="home"]');
  await click('#cbtRoot [data-act="go-guided"]');
  await click('#cbtRoot [data-act="start-guided"]');
  const lum = (c) => { const x = c.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; };
  const ratio = (f, b) => (Math.max(lum(f), lum(b)) + 0.05) / (Math.min(lum(f), lum(b)) + 0.05);
  const cols = `var m=document.querySelector("#cbtRoot .cbt-p"); if(!m) return "none";
    var el=m, b=null; while(el){var c=getComputedStyle(el).backgroundColor; var a=String(c).match(/[\\d.]+/g); if(a && !(a.length>3 && +a[3]===0)){b=c;break;} el=el.parentElement;}
    if(!b) b=getComputedStyle(document.body).backgroundColor;
    return getComputedStyle(m).color + " on " + b;`;
  await ev(`document.body.classList.remove("dark"); return 1;`); await sleep(300);
  const [fL, bL] = String(await ev(cols)).split(" on ");
  const crLight = bL === undefined ? 0 : ratio(fL, bL);
  ok(crLight >= 4.5, "light: body contrast " + (bL === undefined ? String(await ev(cols)) : crLight.toFixed(2) + ":1"));
  await ev(`document.body.classList.add("dark"); return 1;`); await sleep(300);
  const [fD, bD] = String(await ev(cols)).split(" on ");
  const crDark = bD === undefined ? 0 : ratio(fD, bD);
  ok(crDark >= 4.5, "dark: body contrast " + (bD === undefined ? String(await ev(cols)) : crDark.toFixed(2) + ":1"));
  ok(await ev(`return document.documentElement.clientWidth <= 390 && document.getElementById("cbtRoot").scrollWidth <= 391;`) === true, "390 px: no horizontal scroll");
  ok(await ev(`return Array.from(document.querySelectorAll("#cbtRoot button")).every(function(b){return b.getBoundingClientRect().height >= 44;});`) === true, "all touch targets at least 44 px");
  ok(await ev(`return Array.from(document.styleSheets).some(function(s){try{return Array.from(s.cssRules).some(function(r){return r.media && /prefers-reduced-motion/.test(r.media.mediaText);});}catch(e){return false;}});`) === true, "stylesheet honours prefers-reduced-motion");
  await call("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  ok(await ev(`return window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;`) === true, "reduced-motion emulation matches");
  /* iPad: trainer holds at 820x1180 and 1194x834, light and dark. */
  for (const [w, h, tag] of [[820, 1180, "820"], [1194, 834, "1194"]]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await sleep(300);
    await ev(`CodeBlueTrainer.open(); return 1;`);
    ok(await until(`return !!document.querySelector("#cbtRoot.on");`, 5000), `trainer opens at ${tag}`);
    ok(await ev(`return document.getElementById("cbtRoot").scrollWidth <= ${w} + 1;`) === true, `${tag}: no horizontal scroll`);
    ok(await ev(`return Array.from(document.querySelectorAll("#cbtRoot button")).every(function(b){return b.getBoundingClientRect().height >= 44;});`) === true, `${tag}: all touch targets at least 44 px`);
    await ev(`CodeBlueTrainer.close(); return 1;`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev(`document.body.classList.remove("dark"); CodeBlueTrainer.close(); return 1;`);
  ok(await until(`return !CodeBlueTrainer.isOpen();`, 5000), "close() hides the overlay");
  await ev(`CodeBlueTrainer.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#cbtRoot .cbt-disc");`, 5000), "disclaimer shows again on re-entry");
  ok(errors.length === 0, "no trainer page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  console.log(fails ? `FAILED ${fails}` : "ALL PASS");
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
try { ws && ws.close(); } catch {}
chrome.kill();
if (serveProc) serveProc.kill();
process.exit(fails ? 1 : 0);
