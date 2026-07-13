/* Compose captured app screens into elegant 1284×2778 App Store marketing frames.
 * Renders store-assets/apple-marketing/_frame.html (device frame + headline + gradient)
 * at deviceScaleFactor 1, one PNG per screen. Also crops the real meningitis
 * decision capture to lead with QUICK DECISION.
 *
 *   node scripts/store/render.mjs
 * Output: store-assets/apple-marketing/<nn-name>.png
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "store-assets", "apple-marketing");
const BASE = (process.env.BASE || "http://localhost:8917/").replace(/\/?$/, "/");
const FRAME = BASE + "store-assets/apple-marketing/_frame.html";
const PORT = 9413;
const userDir = "/private/tmp/claude-501/store-frame-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const enc = (o) => Object.entries(o).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");

// head lines use "|" for line break
const SHOTS = [
  { out: "01-home", img: "01-home-light.png", bg: "light", appdark: 0,
    eyebrow: "POINT OF CARE", head: "Antibiotic decisions,|right at the bedside",
    sub: "Evidence-based antimicrobial guidance, the moment you need it." },
  { out: "02-clinical-decision", img: "08-decision.png", bg: "light", appdark: 0,
    eyebrow: "CLINICAL DECISION", head: "From findings to|a clear first move",
    sub: "Diagnosis, disposition and first-line regimen — in one glance." },
  { out: "03-antibiogram", img: "02-antibiogram-light.png", bg: "light", appdark: 0,
    eyebrow: "ANTIBIOGRAM", head: "Know what covers|what — instantly",
    sub: "An interactive spectrum grid with ICMR & local resistance rates." },
  { out: "04-lab-watch", img: "03-watchlab.png", bg: "light", appdark: 0,
    eyebrow: "LAB WATCH · 24/7", head: "Your labs, watched|round the clock",
    sub: "Get alerted the moment a critical result comes back." },
  { out: "05-icu-snapshot", img: "04-icu-snapshot.png", bg: "light", appdark: 0,
    eyebrow: "ICU SNAPSHOT", head: "The whole ICU picture,|at a glance",
    sub: "Vitals, labs and electrolyte alerts unified for every bed." },
  { out: "06-antibiogram-dark", img: "05-antibiogram-dark.png", bg: "dark", appdark: 1,
    eyebrow: "SPECTRUM + RESISTANCE", head: "Coverage and|resistance, decoded",
    sub: "The same trusted spectrum grid, tuned for the night shift." },
  { out: "07-dark-mode", img: "06-home-dark.png", bg: "dark", appdark: 1,
    eyebrow: "DARK MODE", head: "Calm and clear,|on every night shift",
    sub: "The full StewardMD toolkit in a low-glare dark theme." },
  { out: "08-drug-index", img: "08-drugdb.png", bg: "light", appdark: 0,
    eyebrow: "DISEASES + DRUGS", head: "1,200+ diseases,|4 lakh+ drug brands",
    sub: "Search 4,12,224 Indian brands for dose & price — across 1,200+ conditions." },
];

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8917"])[1];
  serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
  throw new Error("server did not start");
}

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};

await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--mute-audio"], { stdio: "ignore" });

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 1290, height: 2796, deviceScaleFactor: 1, mobile: false });

  // ---- crop the real meningitis decision capture to lead with QUICK DECISION ----
  await call("Page.navigate", { url: BASE }); await sleep(600);
  const cropRes = await call("Runtime.evaluate", {
    awaitPromise: true, returnByValue: true,
    expression: `new Promise(function(res){
      var im = new Image(); im.crossOrigin='anonymous';
      im.onload = function(){
        var topCut = 150; // drop the app header
        var w = im.naturalWidth, h = im.naturalHeight - topCut;
        var c = document.createElement('canvas'); c.width=w; c.height=h;
        c.getContext('2d').drawImage(im, 0, topCut, w, h, 0, 0, w, h);
        res(c.toDataURL('image/png'));
      };
      im.onerror = function(){ res(''); };
      im.src = '${BASE}store-assets/raw-app-screens/06-meningitis.png';
    })`
  });
  const cropped = cropRes.result && cropRes.result.result ? cropRes.result.result.value : "";
  if (cropped && cropped.startsWith("data:image/png")) {
    writeFileSync(join(OUT, "screens", "08-decision.png"), Buffer.from(cropped.split(",")[1], "base64"));
    console.log("✅ cropped decision screen");
  } else {
    console.log("⚠️  decision crop failed:", String(cropped).slice(0, 80));
  }

  // ---- recolor the brand mark (teal-on-white icon → mint-on-transparent) for the frame header ----
  const markRes = await call("Runtime.evaluate", {
    awaitPromise: true, returnByValue: true,
    expression: `new Promise(function(res){
      var im = new Image(); im.crossOrigin='anonymous';
      im.onload = function(){
        var s=1024, c=document.createElement('canvas'); c.width=s; c.height=s;
        var ctx=c.getContext('2d'); ctx.drawImage(im,0,0,s,s);
        var d=ctx.getImageData(0,0,s,s), p=d.data;
        for(var i=0;i<p.length;i+=4){
          var lum=(p[i]+p[i+1]+p[i+2])/3;           // white bg → high lum
          var a=Math.max(0, Math.min(255, 255-lum)); // dark stroke → opaque
          p[i]=94; p[i+1]=234; p[i+2]=212;           // mint
          p[i+3]=Math.round(a*(p[i+3]/255));
        }
        ctx.putImageData(d,0,0);
        res(c.toDataURL('image/png'));
      };
      im.onerror=function(){res('');};
      im.src='${BASE}store-assets/app-icon-1024-white.png';
    })`
  });
  const mark = markRes.result && markRes.result.result ? markRes.result.result.value : "";
  if (mark && mark.startsWith("data:image/png")) {
    writeFileSync(join(OUT, "screens", "mark.png"), Buffer.from(mark.split(",")[1], "base64"));
    console.log("✅ recolored brand mark");
  } else {
    console.log("⚠️  mark recolor failed");
  }

  for (const s of SHOTS) {
    const url = FRAME + "?" + enc({ img: s.img, bg: s.bg, appdark: s.appdark, eyebrow: s.eyebrow, head: s.head, sub: s.sub });
    await call("Page.navigate", { url });
    let ok = false;
    for (let i = 0; i < 40; i++) { await sleep(150); if (await ev(`return window.__framReady===true;`) === true) { ok = true; break; } }
    await sleep(400);
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { x: 0, y: 0, width: 1290, height: 2796, scale: 1 } });
    const buf = Buffer.from(shot.result.data, "base64");
    writeFileSync(join(OUT, s.out + ".png"), buf);
    console.log((ok ? "✅" : "⚠️ ") + " framed", s.out, `(${buf.length} bytes)`);
  }
} finally {
  try { chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
}
process.exit(0);
