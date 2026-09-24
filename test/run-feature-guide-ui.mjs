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
  ok(guides.length === 9, "nine feature guides are registered, the hands-on demo first (" + guides.map((g) => g.id).join(", ") + ")");
  ok(guides[0].id === "demo", "the demo is listed first");

  // ── the chooser lists them ──
  await ev(`SMD_TOUR.replay(); return 1;`); await sleep(300);
  ok(await ev(`return document.querySelectorAll('.smdt-replay .smdt-rp-go[data-rp^="guide:"]').length;`) === 9, "About & Help lists all nine guides with a Start button");
  ok(/Feature guides/.test(String(await ev(`return document.querySelector(".smdt-replay").innerText;`))), "under a Feature guides heading");
  await ev(`document.querySelector('.smdt-replay .smdt-rp-go[data-rp="guide:home"]').click(); return 1;`); await sleep(900);
  ok(await ev(`var c=document.querySelector(".smdt-card"); return !!(c && c.style.display==="block" && /Start a case/.test(c.innerText));`) === true, "Start from the chooser opens the Home guide on its first step");
  await ev(`document.querySelector('.smdt-card [data-t="skip"]').click(); return 1;`); await sleep(400);

  // ── drive every guide ──
  let shot = false;
  const only = (process.env.ONLY || "").split(",").filter(Boolean);
  for (const g of guides) {
    if (g.id === "demo") continue;   // hands-on: driven below with real taps and typing
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

  // ── the hands-on demo: real taps, real typing, the real engine ────────────────────────────
  // Owner, 2026-09-21: "make him use a start a case and see diagnosis of meningitis ... step by
  // step by the user so he learns after one learn. All should be interactive and correctly
  // pointing and fitting the screen."
  const cardState = () => ev(`var c=document.querySelector(".smdt-card"); if(!c||c.style.display!=="block"||c.style.visibility==="hidden") return JSON.stringify(null); var r=c.getBoundingClientRect(); var sp=document.querySelector(".smdt-spot"); var t=c.querySelector(".smdt-title"); return JSON.stringify({title:t?t.innerText:"", tap:!!c.querySelector(".smdt-tap"), top:r.top, bottom:r.bottom, left:r.left, right:r.right, ih:window.innerHeight, iw:window.innerWidth, spot:sp&&sp.style.display!=="none"?{top:parseFloat(sp.style.top),left:parseFloat(sp.style.left),w:parseFloat(sp.style.width),h:parseFloat(sp.style.height)}:null});`);
  const waitTitle = async (re, tries = 25) => { for (let i = 0; i < tries; i++) { const st = JSON.parse(await cardState()); if (st && re.test(st.title)) return st; await sleep(250); } return null; };
  const fits = (st) => st && st.top >= -1 && st.bottom <= st.ih + 1 && st.left >= -1 && st.right <= st.iw + 1;
  const pointsAt = async (sel) => ev(`var sp=document.querySelector(".smdt-spot"); var el=document.querySelector(${JSON.stringify(sel)}); if(!el||!sp) return false; var t=el.getBoundingClientRect(); return Math.abs(parseFloat(sp.style.top)+8-t.top)<8 && Math.abs(parseFloat(sp.style.left)+8-t.left)<8;`);
  let demoBad = [];
  const check = async (re, sel, hands) => {
    let st = await waitTitle(re);
    if (!st) { demoBad.push("step " + re + " never painted"); return null; }
    await sleep(450); st = JSON.parse(await cardState()) || st;   // let a sheet's entrance settle; the engine re-syncs every 120 ms
    if (!fits(st)) demoBad.push(st.title + " (card off screen: " + JSON.stringify([st.top, st.bottom, st.ih]) + ")");
    if (hands && !st.tap) demoBad.push(st.title + " is not a hands-on step");
    if (sel && !(await pointsAt(sel))) demoBad.push(st.title + " does not point at " + sel);
    return st;
  };
  // A finding the student had open must survive the demo: seed one, and expect it back at the end.
  await ev(`DX.reset(); DX.addFindings(["cough"]); DX.close(); return 1;`); await sleep(200);
  await ev(`SMD_TOUR.guide("demo"); return 1;`);
  await check(/A patient walks in/, '[data-act="reasoning"]', true);
  ok(await ev(`return Object.keys(DX._state.f).length;`) === 0, "the demo starts from a clean workspace (the student's own finding is parked)");
  await ev(`document.querySelector('[data-act="reasoning"]').click(); return 1;`);
  await check(/Start a new patient/, "#dxAddNew", true);
  await ev(`document.getElementById("dxAddNew").click(); return 1;`);
  for (const [key, typed, re] of [["fever", "fever", /first finding/], ["headache", "headache", /Now the headache/], ["neckStiffness", "neck", /Neck stiffness/], ["photophobia", "photo", /Photophobia/]]) {
    const st = await check(re, "#dxSearch", true);
    await ev(`var i=document.getElementById("dxSearch"); i.focus(); i.value=${JSON.stringify(typed)}; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`); await sleep(350);
    // the card is pinned to the foot of the screen, so the search box AND the result to tap stay clear of it
    const clear = await ev(`var c=document.querySelector(".smdt-card").getBoundingClientRect(); var s=document.getElementById("dxSearch").getBoundingClientRect(); var b=document.querySelector('#dxSearchDrop .dx-search-row[data-f="${key}"]'); if(!b) return "norow"; var r=b.getBoundingClientRect(); return JSON.stringify({ok: c.top >= s.bottom - 1 && c.top >= r.bottom - 1, card: c.top, search: s.bottom, row: r.bottom});`);
    if (clear === "norow") demoBad.push("no search result for " + key);
    else if (st && JSON.parse(clear).ok !== true) demoBad.push(st.title + ": the card covers the search results " + clear);
    await ev(`var b=document.querySelector('#dxSearchDrop .dx-search-row[data-f="${key}"]'); if(b) b.click(); return 1;`);
    await sleep(300);
  }
  await check(/review the differential/, '[data-dx-jump="dxReview"]', true);
  await ev(`document.querySelector('[data-dx-jump="dxReview"]').click(); return 1;`);
  ok(await ev(`return ["fever","headache","neckStiffness","photophobia"].every(function(k){ return DX._state.f[k]; });`) === true, "the four findings went into the real reasoning engine");
  await check(/antibiotic gate/, "#dxGate .dx-gate-card", false);
  ok(/very likely|likely/i.test(String(await ev(`return document.querySelector("#dxGate").innerText;`))), "the gate reads infection likely for fever with neck stiffness");
  await ev(`document.querySelector('.smdt-card [data-t="next"]').click(); return 1;`);
  await check(/meningitis leads/, "#dxCols .dx-card.inf .dx-row-head", true);
  ok(/meningitis/i.test(String(await ev(`return document.querySelector("#dxCols .dx-card.inf").innerText;`))), "the top infectious card is bacterial meningitis");
  await ev(`document.querySelector("#dxCols .dx-card.inf .dx-row-head").click(); return 1;`);
  await check(/like a consultant/, ".dx-card.open .dx-detail", false);
  await ev(`document.querySelector('.smdt-card [data-t="next"]').click(); return 1;`);
  await check(/Commit to the diagnosis/, ".dx-card.open .dx-select", true);
  await ev(`document.querySelector(".dx-card.open .dx-select").click(); return 1;`);
  for (const [re, num] of [[/Probable pathogens/, "04"], [/empiric antibiotics/, "05"], [/stewardship comment/, "07"], [/Investigations/, "08"], [/De-escalation/, "09"], [/The evidence/, "10"]]) {
    const st = await check(re, null, false);
    const on = await ev(`var cards=[...document.querySelectorAll("#outputArea .card")]; var c=cards.find(function(x){var n=x.querySelector("h2 .num"); return n&&n.textContent.trim()==="${num}";}); if(!c) return "missing"; var sp=document.querySelector(".smdt-spot"); var r=c.getBoundingClientRect(); var card=document.querySelector(".smdt-card").getBoundingClientRect(); var p=c.parentElement, sc=null; while(p&&p!==document.body){var cs=getComputedStyle(p); if(/(auto|scroll)/.test(cs.overflowY)&&p.scrollHeight>p.clientHeight+2){sc=(p.id||p.className||p.tagName)+":"+p.scrollTop; break;} p=p.parentElement;} var headBand={top:r.top, bottom:r.top+44}; var headCovered = card.top < headBand.bottom && card.bottom > headBand.top; return JSON.stringify({pointed: Math.abs(parseFloat(sp.style.top)+8-r.top)<8, headOn: r.top>=-1 && r.top+44 <= window.innerHeight && !headCovered, overlap: !(card.top >= r.bottom || card.bottom <= r.top), geo:{t:Math.round(r.top),b:Math.round(r.bottom),ct:Math.round(card.top),cb:Math.round(card.bottom),spot:sp.style.top,sy:window.scrollY,ih:window.innerHeight,sc:sc}});`);
    if (on === "missing") demoBad.push("stewardship card " + num + " is not on the page");
    else { const o = JSON.parse(on); if (!o.pointed) demoBad.push((st ? st.title : num) + " does not point at card " + num + " " + JSON.stringify(o.geo)); if (!o.headOn) demoBad.push((st ? st.title : num) + ": the card heading is hidden under the coach-mark " + JSON.stringify(o.geo)); }
    await ev(`document.querySelector('.smdt-card [data-t="next"]').click(); return 1;`);
  }
  await check(/whole loop/, null, false);
  await ev(`document.querySelector('.smdt-card [data-t="next"]').click(); return 1;`); await sleep(600);
  ok(demoBad.length === 0, "the demo walks the real case end to end, every card on screen and pointing at its control" + (demoBad.length ? " BAD: " + demoBad.join("; ") : ""));
  const after = JSON.parse(await ev(`var sh=document.querySelector(".shell"); var oa=document.getElementById("outputArea"); var o=document.getElementById("dxOverlay"); return JSON.stringify({shell: !!(sh && sh.offsetParent), out: !!(oa && oa.innerHTML.trim()), dx: !!(o && o.classList.contains("on")), f: Object.keys(DX._state.f), home: !!(document.getElementById("homeV2") && document.getElementById("homeV2").classList.contains("on"))});`));
  ok(!after.shell && !after.out && !after.dx && after.home, "Done clears the demo case, closes the stewardship page and the workspace, and returns home " + JSON.stringify(after));
  ok(after.f.length === 1 && after.f[0] === "cough", "the student's own finding is back in the workspace");
  await ev(`DX.reset(); return 1;`);

  // ── every phone size: the coach-mark never leaves the screen ─────────────────────────────
  for (const [w, h] of [[320, 568], [360, 640], [430, 932]]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(300);
    await ev(`SMD_TOUR.guide("home"); return 1;`);
    let off = [], n = 0;
    for (let i = 0; i < 12; i++) {
      let st = null; for (let k = 0; k < 8; k++) { await sleep(k ? 250 : 700); st = JSON.parse(await cardState()); if (st) break; }
      if (!st) break; n++;
      if (!fits(st)) off.push(st.title);
      if (st.spot && (st.spot.top < 0 || st.spot.top + st.spot.h > st.ih + 1)) off.push(st.title + " (target off screen)");
      const nb = await ev(`var b=document.querySelector('.smdt-card [data-t="next"]'); if(!b) return false; b.click(); return true;`);
      if (nb !== true) break;
    }
    ok(n >= 6 && off.length === 0, w + "x" + h + ": " + n + " steps, every card and target on screen" + (off.length ? " BAD: " + off.join("; ") : ""));
    await ev(`var b=document.querySelector('.smdt-card [data-t="skip"]'); if(b) b.click(); return 1;`); await sleep(300);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(300);

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
