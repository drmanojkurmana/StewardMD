/* PrepNucleus startup clip (prep-startup.js) on iPhone and iPad sizes, headless Chrome over CDP, fixture banks.
 * Must hold at each size: the clip matching the orientation plays full screen (object-fit cover, no bands);
 * PrepNucleus opens and paints its home UNDER the clip while it plays; the overlay fades out after the clip ends,
 * leaving the ready home with no "Loading" screen. A cold open (scripts not loaded) is tested at each size.
 * USAGE: CHROME=<path> node test/run-prep-startup-ui.mjs   SIZES=390x844,820x1180   SHOTS=<dir> saves PNGs. */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:" + await freePort() + "/";
const PORT = await freePort(), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-startup-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FIX = "/test/fixtures/prep/";
const SIZES = (process.env.SIZES || "390x844,430x932,820x1180,1180x820,1024x1366,1366x1024,844x390").split(",").map((s) => { const [w, h] = s.split("x").map(Number); return { w, h }; });
const SHOTS = process.env.SHOTS || "";

const serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), BASE.match(/:(\d+)/)[1]], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(100); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name) => { if (!SHOTS) return; const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };

try {
  let ver; for (let t = 0; t < 300 && !ver; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  ({ result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }));
  await call("Runtime.enable"); await call("Page.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_ONBOARD=false; window.SMD_PREP_STARTUP=true; window.SMD_PREP_VOICE=false; try{localStorage.setItem("smd_prep","1");localStorage.setItem("smd_onboarding_tour","0");}catch(e){}` });
  for (const S of SIZES) {
    const tag = S.w + "x" + S.h, phone = Math.min(S.w, S.h) < 600;
    await call("Emulation.setDeviceMetricsOverride", { width: S.w, height: S.h, deviceScaleFactor: 1, mobile: phone, screenWidth: S.w, screenHeight: S.h });
    await call("Page.navigate", { url: BASE + "?prep=1&tour=0&prepstartup=1" });
    await until(`return !!(window.PREP && window.PREP_STARTUP && window.PREP_LOADER);`, 30000);
    await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
    const hevc = await ev(`return document.createElement("video").canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"');`);
    await ev(`PREP.open(); return 1;`);
    ok(await until(`return !!document.querySelector("#smdPrepStartup video");`, 3000), `${tag} overlay up`);
    const key = S.w > S.h ? "h" : "v";
    ok(await ev(`return document.querySelector("#smdPrepStartup video").currentSrc.indexOf("prep-startup-${key}.mp4")>0;`), `${tag} plays the ${key} clip`);
    const fit = await ev(`var v=document.querySelector("#smdPrepStartup video"); return getComputedStyle(v).objectFit+" "+v.offsetWidth+"x"+v.offsetHeight;`);
    // home.js zooms the document (iPad 1.08 to 1.15), so compare shape: the fixed video spans the whole window.
    const [fw, fh] = String(fit).split(" ")[1].split("x").map(Number);
    ok(String(fit).startsWith("cover ") && Math.abs(fw / fh - S.w / S.h) < 0.01, `${tag} full-screen cover (${fit})`);
    const playing = await until(`var v=document.querySelector("#smdPrepStartup video"); return !!v && v.currentTime>0.5;`, 4000);
    ok(playing, `${tag} video plays (canPlayType hvc1: "${hevc}")`);
    await shot(`startup-${tag}-a-early`);
    // Home painted underneath while the clip is still playing.
    ok(await until(`var r=document.getElementById("smdPrep"); return !!(r && !r.querySelector(".pn-load") && r.querySelector(".pn-body") && window.PREP_STARTUP._active());`, 6000), `${tag} home ready under the clip`);
    if (playing) {
      await until(`var v=document.querySelector("#smdPrepStartup video"); return !!v && v.duration-v.currentTime<0.3;`, 10000);
      await shot(`startup-${tag}-b-logo`);
    }
    ok(await until(`return !document.getElementById("smdPrepStartup");`, 12000), `${tag} overlay gone after the clip`);
    ok(await ev(`var r=document.getElementById("smdPrep"); return !!(r && !r.querySelector(".pn-load") && r.querySelector(".pn-body"));`), `${tag} home visible, no loading screen`);
    await sleep(300); await shot(`startup-${tag}-c-home`);
    await ev(`PREP.close && PREP.close(); return 1;`);
  }
  // Rotation mid-clip swaps to the other clip at the same fraction; back (Android, Escape) skips onto the ready home.
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
  await call("Page.navigate", { url: BASE + "?prep=1&tour=0&prepstartup=1" });
  await until(`return !!(window.PREP && window.PREP_STARTUP && window.PREP_LOADER);`, 30000);
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); PREP.open(); return 1;`);
  await until(`var v=document.querySelector("#smdPrepStartup video"); return !!v && v.currentTime>2;`, 6000);
  await call("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenWidth: 844, screenHeight: 390 });
  ok(await until(`var v=document.querySelector("#smdPrepStartup video"); return !!v && v.currentSrc.indexOf("prep-startup-h.mp4")>0 && v.currentTime>1.2;`, 5000), "rotation swaps to the h clip mid-run");
  await until(`var r=document.getElementById("smdPrep"); return !!(r && r.querySelector(".pn-body"));`, 6000);
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !document.getElementById("smdPrepStartup") && !!document.querySelector("#smdPrep .pn-body");`, 3000), "back skips the clip onto the home");
} finally {
  try { chrome.kill(); } catch {} try { serve.kill(); } catch {}
  console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exitCode = fails ? 1 : 0;
}
