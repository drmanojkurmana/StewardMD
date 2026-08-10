/* Ward Sync lab-drawer overlay test (real headless Chrome, CDP).
 * Proves the fix for the screenshot bug: the lab drawer is a FIXED, full-screen, OPAQUE overlay
 * with its own scrollable body — so the patient list can't bleed through and the two scroll
 * layers no longer fight (the flicker/stall while sliding). Uses the REAL CSS from ghis-ward.js.
 *   node test/run-ward-drawer-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9386, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-drawer-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-drawer-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  let ready = null;
  for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true || (ready && ready !== false)) break; }
  ok(ready === true, `real ghis-ward.js CSS loaded into the harness (${ready})`);
  await ev(`return window.__openDrawer();`);
  await sleep(150);

  ok(await ev(`return getComputedStyle(document.getElementById("ghisLabDrawer")).position;`) === "fixed",
    "lab drawer is position:fixed (escapes the patient-list scroller)");

  const cover = await ev(`var r=document.getElementById("ghisLabDrawer").getBoundingClientRect(); return JSON.stringify({top:Math.round(r.top),left:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height),vw:innerWidth,vh:innerHeight});`);
  const C = JSON.parse(cover);
  ok(C.top <= 1 && C.left <= 1 && C.w >= C.vw - 1 && C.h >= C.vh - 1, `drawer covers the full viewport (${C.w}x${C.h} vs ${C.vw}x${C.vh})`);

  const bg = await ev(`return getComputedStyle(document.getElementById("ghisLabDrawer")).backgroundColor;`);
  ok(/^rgb\(/.test(bg) && !/rgba\([^)]*,\s*0\s*\)/.test(bg), `drawer background is opaque (${bg})`);

  ok(await ev(`return getComputedStyle(document.getElementById("ghisLabBody")).overflowY;`) === "auto",
    "lab body has its own scroll (overflow-y:auto)");

  // Bleed test: scroll the drawer body fully, then the point mid-screen must resolve to the drawer,
  // never a patient card behind it.
  const bleed = await ev(`
    var b=document.getElementById("ghisLabBody"); b.scrollTop=b.scrollHeight;
    var el=document.elementFromPoint(Math.round(innerWidth/2), Math.round(innerHeight/2));
    return JSON.stringify({ inDrawer: !!(el&&el.closest&&el.closest("#ghisLabDrawer")), onCard: !!(el&&el.closest&&el.closest(".ghis-pt-card")) });`);
  const B = JSON.parse(bleed);
  ok(B.inDrawer && !B.onCard, "no bleed-through: mid-screen hit is the drawer, never a patient card behind it");

  ok(await ev(`return !!document.getElementById("ghisSearchPt");`) === true, "patient search box present in Ward Sync");

  // screenshot for eyeballing
  const shot = await call("Page.captureScreenshot", { format: "png" });
  if (shot.result && shot.result.data) {
    const { writeFileSync } = await import("node:fs");
    const out = join(process.env.CLAUDE_JOB_DIR || "/tmp", "ward-drawer.png");
    writeFileSync(out, Buffer.from(shot.result.data, "base64"));
    console.log("screenshot:", out);
  }
  console.log(fails ? `\n${fails} check(s) failed` : "\nAll ward-drawer checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
