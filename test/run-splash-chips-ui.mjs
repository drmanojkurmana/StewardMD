/* StewardMD - the splash module chips must fit on ONE line (headless, real widths).
 *
 * Reported from internal testing with a screenshot: "SCAN-MEDS" had wrapped onto a second line under
 * the other four chips. The ask was "remove scan meds here or make it fit in single line" - all five
 * are kept and the row is sized to fit instead.
 *
 * Measured rather than eyeballed: chip widths depend on the display font, letter-spacing and padding,
 * so arithmetic is guesswork. This asserts every chip shares one row and the row stays inside the
 * viewport, from the narrowest phone we support through to a large one.
 *
 * USAGE: node test/run-splash-chips-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8803/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9377;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/splash-chips-" + Date.now();

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/);
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), m ? m[1] : "8803"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS " + m); } else { fail++; console.log("FAIL " + m); } };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });

  // 320 = iPhone SE, 390 = iPhone 14/15, 430 = Pro Max.
  for (const w of [320, 360, 390, 430]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
    await call("Page.navigate", { url: BASE });
    let ready = false;
    for (let i = 0; i < 50; i++) { await sleep(300); if (await ev(`return !!document.querySelector("#splash .splash-module-pill");`)) { ready = true; break; } }
    if (!ready) { ok(false, `w=${w}: chips rendered`); continue; }

    const raw = await ev(`
      var pills=[].slice.call(document.querySelectorAll("#splash .splash-module-pill"));
      if(!pills.length) return JSON.stringify({n:0});
      var tops={}, maxRight=0, minLeft=1e9, labels=[];
      pills.forEach(function(p){
        var b=p.getBoundingClientRect();
        tops[Math.round(b.top)]=1; maxRight=Math.max(maxRight,b.right); minLeft=Math.min(minLeft,b.left);
        labels.push((p.textContent||"").trim());
      });
      return JSON.stringify({n:pills.length,rows:Object.keys(tops).length,left:Math.round(minLeft),
        right:Math.round(maxRight),vw:window.innerWidth,labels:labels});
    `);
    const o = JSON.parse(raw || "{}");
    ok(o.n === 5, `w=${w}: all five module chips present (${(o.labels || []).join(", ")})`);
    ok(o.rows === 1, `w=${w}: they sit on ONE line (measured ${o.rows} row(s))`);
    ok(o.right <= o.vw, `w=${w}: the row stays inside the viewport (ends at ${o.right} of ${o.vw}px)`);
  }

  // The emoji that used to stand in for icons are gone from the demo slides.
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 50; i++) { await sleep(300); if (await ev(`return !!document.querySelector(".demo-case-icon");`)) break; }
  const icons = await ev(`
    var els=[].slice.call(document.querySelectorAll(".demo-case-icon"));
    var withGlyph=els.filter(function(e){return e.querySelector(".material-symbols-rounded");}).length;
    var emoji=els.filter(function(e){return /[\\u{1F300}-\\u{1FAFF}\\u{2700}-\\u{27BF}\\u{2600}-\\u{26FF}]/u.test(e.textContent||"");}).length;
    return JSON.stringify({total:els.length,withGlyph:withGlyph,emoji:emoji});
  `);
  const ic = JSON.parse(icons || "{}");
  ok(ic.total > 0 && ic.withGlyph === ic.total, `every demo case icon is a real Material Symbol (${ic.withGlyph}/${ic.total})`);
  ok(ic.emoji === 0, `no emoji left standing in for an icon (${ic.emoji} found)`);

} catch (e) {
  fail++; console.log("FAIL harness: " + (e && e.message || e));
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { ws && ws.close(); } catch {}
  chrome.kill(); if (serveProc) serveProc.kill();
  process.exit(fail ? 1 : 0);
}
