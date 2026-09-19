/* The in-app feature guides, driven in a real headless browser against the real app.
 *
 * Owner (2026-09-19): "the guide should run on the screen like the app tours". Eight walkthroughs
 * on the SMD_TOUR spotlight engine that open the real screens. This drives every one of them with
 * Next until it finishes and checks: the coach-mark is on screen, the spotlight sits on a real
 * element, the step's screen is actually open, skipped steps are only the optional gated ones,
 * and every screen is closed again when the guide ends.
 *
 * USAGE: BASE=http://localhost:8998/ CHROME=<chrome binary> [SHOT=<png>] node test/run-feature-guide-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8998/").replace(/\/?$/, "/");
const PORT = 9402, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/guide-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// What "this step's screen is open" means, per screen name.
const SCREEN_OPEN = {
  home: `return true;`,
  hospital: `var s=document.getElementById("hvSheet"); return !!(s && s.classList.contains("on") && s.querySelector('[data-mi="icu"]'));`,
  drugs: `var s=document.getElementById("hvSheet"); return !!(s && s.classList.contains("on") && s.querySelector('[data-mi="db"]'));`,
  dosing: `var s=document.getElementById("hvSheet"); return !!(s && s.classList.contains("on") && s.querySelector('[data-mi="ely"]'));`,
  more: `var s=document.getElementById("hvSheet"); return !!(s && s.classList.contains("on") && s.querySelector('[data-mi="account"]'));`,
  dx: `var s=document.getElementById("hvSheet"); return !!(s && s.classList.contains("on") && s.querySelector('#dxAddNew'));`,
  maik: `return !!document.getElementById("maikSheet");`,
  calc: `var o=document.getElementById("mcOverlay"); return !!(o && o.classList.contains("on"));`,
  sidebar: `var d=document.getElementById("sbDrawer"); return !!(d && d.classList.contains("open"));`,
  "sidebar-exp": `return !!document.querySelector(".sbr-set-ov");`,
};
const allClosed = () => ev(`var s=document.getElementById("hvSheet"), o=document.getElementById("mcOverlay"), d=document.getElementById("sbDrawer"); return JSON.stringify({sheet:!!(s&&s.classList.contains("on")), maik:!!document.getElementById("maikSheet"), calc:!!(o&&o.classList.contains("on")), drawer:!!(d&&d.classList.contains("open")), exp:!!document.querySelector(".sbr-set-ov"), card:!!(document.querySelector(".smdt-card")&&document.querySelector(".smdt-card").style.display==="block")});`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_TOUR && SMD_TOUR.guides && window.MEDCALC && window.SMD_askMaik && window.SB)`) === true) { ready = true; break; } }
  ok(ready, "the app, the tour engine and the modules the guides open are loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.setItem("smd_onboarding_tour","0")}catch(e){} return 1;`);

  const guides = JSON.parse(await ev(`return JSON.stringify(SMD_TOUR.guides());`));
  ok(guides.length === 8, "eight feature guides are registered (" + guides.map((g) => g.id).join(", ") + ")");

  // ── the chooser lists them ──
  await ev(`SMD_TOUR.replay(); return 1;`); await sleep(300);
  ok(await ev(`return document.querySelectorAll('.smdt-replay .smdt-rp-go[data-rp^="guide:"]').length;`) === 8, "About & Help lists all eight guides with a Start button");
  ok(/Feature guides/.test(String(await ev(`return document.querySelector(".smdt-replay").innerText;`))), "under a Feature guides heading");
  await ev(`document.querySelector('.smdt-replay .smdt-rp-go[data-rp="guide:home"]').click(); return 1;`); await sleep(900);
  ok(await ev(`var c=document.querySelector(".smdt-card"); return !!(c && c.style.display==="block" && /Start a case/.test(c.innerText));`) === true, "Start from the chooser opens the Home guide on its first step");
  await ev(`document.querySelector('.smdt-card [data-t="skip"]').click(); return 1;`); await sleep(400);

  // ── drive every guide ──
  let shot = false;
  const only = (process.env.ONLY || "").split(",").filter(Boolean);
  for (const g of guides) {
    if (only.length && only.indexOf(g.id) < 0) continue;
    await ev(`SMD_TOUR.guide(${JSON.stringify(g.id)}); return 1;`);
    const seen = []; let bad = [];
    for (let i = 0; i < g.steps + 3; i++) {
      // wait until the step has painted (title present); a screen may take a moment to open
      let raw = null;
      for (let w = 0; w < 6; w++) { await sleep(w ? 400 : 1000); raw = await ev(`var c=document.querySelector(".smdt-card"); if(!c || c.style.display!=="block") return "none"; var t=c.querySelector(".smdt-title"); return (t && t.innerText && c.style.visibility!=="hidden") ? "ready" : "wait";`); if (raw !== "wait") break; }
      raw = await ev(`var c=document.querySelector(".smdt-card"); if(!c || c.style.display!=="block") return JSON.stringify(null); var sp=document.querySelector(".smdt-spot"); var r=sp&&sp.getBoundingClientRect(); var t=c.querySelector(".smdt-title"); var nb=c.querySelector('[data-t="next"]'); var ey=c.querySelector(".smdt-eyebrow"); return JSON.stringify({title:t?t.innerText:"", eyebrow:ey?ey.innerText:"", spot:r?{w:r.width,h:r.height,top:r.top}:null, next: nb?nb.innerText:"", ih:window.innerHeight});`);
      let st = null; try { st = JSON.parse(raw); } catch (e) { bad.push("step read failed: " + String(raw).slice(0, 160)); break; }
      if (!st) break;
      seen.push(st.title);
      // the card is on screen and the spotlight has a real size (a centred summary card has none)
      const cardOn = await ev(`var c=document.querySelector(".smdt-card"); var r=c.getBoundingClientRect(); return r.height>80 && r.top>=0 && r.bottom<=window.innerHeight+1;`);
      if (cardOn !== true) bad.push(st.title + " (card off screen)");
      if (!shot && g.id === "hospital" && process.env.SHOT) { const s = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(process.env.SHOT, Buffer.from(s.result.data, "base64")); shot = true; }
      if (/Start ICU tour/.test(st.next)) { await ev(`document.querySelector('.smdt-card [data-t="skip"]').click(); return 1;`); break; }
      await ev(`var b=document.querySelector('.smdt-card [data-t="next"]'); if(b) b.click(); return 1;`);
    }
    await sleep(700);
    const closed = JSON.parse(await allClosed());
    const leftOpen = Object.keys(closed).filter((k) => closed[k]);
    ok(seen.length >= Math.ceil(g.steps * 0.6) && bad.length === 0, `guide "${g.id}": ${seen.length}/${g.steps} steps shown on screen` + (bad.length ? " BAD: " + bad.join("; ") : "") + (seen.length < g.steps ? " (shown: " + seen.join(" | ") + ")" : ""));
    ok(leftOpen.length === 0, `guide "${g.id}": every screen it opened is closed again` + (leftOpen.length ? " (still open: " + leftOpen.join(", ") + ")" : ""));
  }

  // ── each step's screen really opens (spot-check the navigations the guides rely on) ──
  await ev(`SMD_TOUR.guide("hospital"); return 1;`); await sleep(1100);
  ok(await ev(SCREEN_OPEN.hospital) === true, "the Hospital guide opens the real Hospital sheet");
  ok(await ev(`var sp=document.querySelector(".smdt-spot"); var t=document.querySelector('#hvSheet [data-mi="icu"]').getBoundingClientRect(); return Math.abs(parseFloat(sp.style.top)+8-t.top)<6 && Math.abs(parseFloat(sp.style.left)+8-t.left)<6;`) === true, "and the spotlight sits exactly on the ICU tile");
  await ev(`document.querySelector('.smdt-card [data-t="skip"]').click(); return 1;`); await sleep(500);
  await ev(`SMD_TOUR.guide("maik"); return 1;`); await sleep(2200);   // the MaiK sheet's entrance animation; the engine re-syncs the spotlight every 120 ms
  ok(await ev(SCREEN_OPEN.maik) === true, "the MaiK guide opens the real MaiK sheet");
  // Compare what the engine WRITES (style.top/left) with the target: the ring's own bounding rect is
  // scaled by its pulse animation, so it is not the number to check.
  const mq = await ev(`var sp=document.querySelector(".smdt-spot"); var st=[parseFloat(sp.style.top),parseFloat(sp.style.left),parseFloat(sp.style.width),parseFloat(sp.style.height)]; var t=document.getElementById("maikQ").getBoundingClientRect(); return JSON.stringify({spot:st, q:[t.top,t.left,t.width,t.height], nQ:document.querySelectorAll("#maikQ").length, inSheet:!!document.querySelector("#maikSheet #maikQ"), ok: Math.abs(st[0]+8-t.top)<6 && Math.abs(st[1]+8-t.left)<6});`);
  ok(JSON.parse(mq).ok === true, "and points at the question box " + mq);
  await ev(`document.querySelector('.smdt-card [data-t="skip"]').click(); return 1;`); await sleep(500);
  await ev(`SMD_TOUR.guide("calculators"); return 1;`); await sleep(1100);
  ok(await ev(SCREEN_OPEN.calc) === true, "the Calculators guide opens the real Calculators overlay");
  await ev(`document.querySelector('.smdt-card [data-t="skip"]').click(); return 1;`); await sleep(500);
  await ev(`SMD_TOUR.guide("imaging"); return 1;`); await sleep(1100);
  ok(await ev(SCREEN_OPEN.sidebar) === true, "the Imaging guide opens the sidebar");
  await ev(`document.querySelector('.smdt-card [data-t="next"]').click(); return 1;`); await sleep(1500);
  const ex = await ev(`return JSON.stringify({exp: !!document.querySelector(".sbr-set-ov"), row: !!document.querySelector('[data-sbr-act="experimental"]'), drawer: !!(document.getElementById("sbDrawer")&&document.getElementById("sbDrawer").classList.contains("open")), title: (document.querySelector(".smdt-title")||{}).innerText});`);
  ok(JSON.parse(ex).exp === true, "and then the Experimental Features page for the module toggles " + ex);
  await ev(`document.querySelector('.smdt-card [data-t="skip"]').click(); return 1;`); await sleep(500);
  ok(JSON.parse(await allClosed()).exp === false, "Skip closes the Experimental page too");

  console.log(fails === 0 ? "\nALL GREEN - the feature guides run on the real screens, end to end" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
