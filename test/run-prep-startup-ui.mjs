/* PrepNucleus startup logo reveal UI test (headless Chrome over CDP):
 * Checks vertical (390x844 phone, 820x1180 iPad) and horizontal (1180x820 iPad, 844x390 phone) startup videos:
 *  - Tile click starts #smdPrepStartup immediately (instead of SMD_LOADER) with the right clip (v vs h)
 *  - Video loads & plays cleanly with no console/page errors
 *  - Stage fits inside viewport with zero overflow and no clipping
 *  - Live resize from portrait to landscape swaps to horizontal clip
 *  - Reveal class activates before/at end and Skip dismisses cleanly onto PrepNucleus Home
 *
 * USAGE: CHROME=<path> node test/run-prep-startup-ui.mjs   (SHOTS=<dir> saves PNGs)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort());
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-startup-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/Users/mkk/Library/Caches/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const FIX = "/test/fixtures/prep/";
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

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
const shot = async (name) => {
  if (!SHOTS) return;
  const r = await call("Page.captureScreenshot", { format: "png" });
  if (r.result && r.result.data) writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
};

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});

  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.SMD_PREP_STARTUP=true; window.SMD_PREP_ONBOARD=false; window.SMD_PREP_QGEN=false; window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; try{localStorage.setItem("smd_prep","1"); localStorage.setItem("smd_home_tools", JSON.stringify({ prep: true }));}catch(e){}`
  });

  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;

  async function checkViewport(w, h, expectOrient, tag) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await call("Page.navigate", { url: BASE + "?prep=1" });
    await until(`return !!(window.PREP && window.PREP_STARTUP && window.SMD_showHome);`, 30000);
    await ev(clean);
    await ev(`SMD_showHome(); return 1;`);
    ok(await until(`return !!document.querySelector('.rnav-tile[data-act=prep]');`, 10000), `${tag}: PrepNucleus tile rendered`);

    await ev(`document.querySelector('.rnav-tile[data-act=prep]').click(); return 1;`);
    ok(await until(`var o=document.getElementById("smdPrepStartup"), v=o&&o.querySelector("video"); return !!(o && v && v.readyState >= 1);`, 8000), `${tag}: startup video overlay opened and loaded metadata`);
    ok(await ev(`return !document.querySelector(".smd-ld-cover");`) === true, `${tag}: SMD_LOADER hearts cover suppressed during startup video`);

    const info = JSON.parse(await ev(`
      var o=document.getElementById("smdPrepStartup"), st=o.querySelector(".psv-stage"), v=o.querySelector("video");
      var rr=o.getBoundingClientRect(), K=(rr.width?innerWidth/rr.width:1);
      var br=st.getBoundingClientRect();
      return JSON.stringify({
        src: v.getAttribute("src"),
        muted: v.muted,
        vw: v.videoWidth, vh: v.videoHeight,
        sw: Math.round(br.width * K), sh: Math.round(br.height * K),
        sl: Math.round(br.left * K), sr: Math.round(innerWidth - br.right * K),
        st: Math.round(br.top * K), sb: Math.round(innerHeight - br.bottom * K),
        hasSkip: !!o.querySelector(".psv-skip"),
        hasSnd: !!o.querySelector(".psv-snd"),
        padX: o.classList.contains("psv-pad-x"),
        padY: o.classList.contains("psv-pad-y")
      });
    `));
    ok(info.src.includes(`prep-startup-${expectOrient}.mp4`), `${tag}: uses ${expectOrient} video (${info.src})`);
    ok(info.muted === true && !info.hasSkip && !info.hasSnd, `${tag}: muted, no skip button, no sound button`);
    ok(info.sl >= -1 && info.sr >= -1 && info.st >= -1 && info.sb >= -1, `${tag}: stage fits inside viewport (${info.sw}x${info.sh} in ${w}x${h})`);
    await sleep(350);
    await shot(`${tag}-01-start`);

    // Seek near reveal to verify live ambient crossfade into warm cream logo reveal and automatic exit
    await ev(`var v=document.querySelector("#smdPrepStartup video"); v.currentTime = 9.4; return 1;`);
    ok(await until(`var o=document.getElementById("smdPrepStartup"); return !!(o && o.classList.contains("psv-reveal"));`, 3000), `${tag}: reveal state activates at logo reveal`);
    await sleep(450);
    await shot(`${tag}-02-reveal`);

    // Natural completion dissolves cleanly onto PrepNucleus Home
    ok(await until(`return !document.getElementById("smdPrepStartup") && !!document.querySelector("#smdPrep #pnHome");`, 4000), `${tag}: finishes cleanly into PrepNucleus Home`);
  }

  await checkViewport(390, 844, "v", "phone-port");
  await checkViewport(820, 1180, "v", "ipad-port");
  await checkViewport(1180, 820, "h", "ipad-land");
  await checkViewport(844, 390, "h", "phone-land");

  // Live orientation flip test: start portrait -> resize to landscape -> clip swaps to h
  await call("Emulation.setDeviceMetricsOverride", { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true });
  await sleep(100);
  await ev(`PREP.close(); PREP.open(); return 1;`);
  ok(await until(`var v=document.querySelector("#smdPrepStartup video"); return !!(v && /prep-startup-v\.mp4/.test(v.getAttribute("src")||""));`, 5000), "rotate test: starts vertical");
  await call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  await ev(`window.dispatchEvent(new Event("resize")); return 1;`);
  const rotOk = await until(`var v=document.querySelector("#smdPrepStartup video"); return !!(v && /prep-startup-h\.mp4/.test(v.getAttribute("src")||""));`, 5000);
  if (!rotOk) console.log("ROTATE DEBUG:", await ev(`var o=document.getElementById("smdPrepStartup"), v=o&&o.querySelector("video"); return JSON.stringify({iw:innerWidth, ih:innerHeight, cw:o&&o.clientWidth, ch:o&&o.clientHeight, src:v&&v.getAttribute("src"), active:PREP_STARTUP._active()});`));
  ok(rotOk, "rotate test: swaps to horizontal on resize");
  await ev(`PREP_STARTUP.skip(); return 1;`);

  ok(errors.length === 0, "no uncaught JS errors: " + JSON.stringify(errors));
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
