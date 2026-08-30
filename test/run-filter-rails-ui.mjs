/* StewardMD - filter chips are ONE swipeable row, not a wall (headless, real widths).
 *
 * Two screens were reported for the same thing. Clinical Calculators: 22 category chips wrapped
 * into roughly eleven rows and filled the whole phone, pushing the calculators below the fold -
 * "Occupying full screen do something redesign this". Knowledge Library: TYPE / SOURCE / SYSTEM
 * wrapped the same way, with 13 chips in SYSTEM alone, burying 4,804 entries - "very old generic
 * looking ui/ux".
 *
 * Both are horizontal rails now. Measured, not eyeballed: chip widths depend on the font, so the
 * only honest check is to render it and read the geometry. A rail is proved by every chip sharing
 * one row WHILE the row's scrollWidth exceeds its clientWidth - i.e. it really does scroll, rather
 * than the chips having been silently truncated.
 *
 * USAGE: node test/run-filter-rails-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8805/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9379;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/filter-rails-" + Date.now();

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/);
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), m ? m[1] : "8805"], { stdio: "ignore" });
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

const MEASURE = (sel, container) => `
  var els=[].slice.call(document.querySelectorAll(${JSON.stringify(sel)}));
  if(!els.length) return JSON.stringify({n:0});
  var tops={}; els.forEach(function(e){ tops[Math.round(e.getBoundingClientRect().top)]=1; });
  var box=document.querySelector(${JSON.stringify(container)});
  return JSON.stringify({n:els.length,rows:Object.keys(tops).length,
    h:box?Math.round(box.getBoundingClientRect().height):0,vh:window.innerHeight,
    scrollW:box?box.scrollWidth:0,clientW:box?box.clientWidth:0});`;

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.MEDCALC && MEDCALC.openList);`)) { ready = true; break; } }
  if (!ready) throw new Error("MEDCALC not reachable");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","disclaimerModal"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // ---- Clinical Calculators ----
  await ev(`MEDCALC.openList(); return 1;`); await sleep(900);
  const c = JSON.parse(await ev(MEASURE(".mc-cats .mc-cat", ".mc-cats")) || "{}");
  ok(c.n >= 10, `calculators: the category chips render (${c.n} chips)`);
  ok(c.rows === 1, `calculators: they occupy ONE row (measured ${c.rows})`);
  ok(c.h > 0 && c.h < c.vh * 0.12, `calculators: the row is a sliver, not a wall (${c.h}px of ${c.vh}px)`);
  ok(c.scrollW > c.clientW, `calculators: the row genuinely scrolls, nothing was truncated (${c.scrollW} > ${c.clientW})`);

  // The chosen category must not be left scrolled out of sight after a re-render.
  await ev(`var b=[].filter.call(document.querySelectorAll(".mc-cat[data-cat]"),function(x){return /Toxicology|Ophthalmology|Obstetrics/.test(x.textContent);})[0]; if(b) b.click(); return 1;`);
  await sleep(500);
  const onView = await ev(`
    var on=document.querySelector(".mc-cat.on"), box=document.querySelector(".mc-cats");
    if(!on||!box) return "missing";
    var a=on.getBoundingClientRect(), b=box.getBoundingClientRect();
    var vis=(a.left >= b.left - 2 && a.right <= b.right + 2);
    return JSON.stringify({v:vis?"visible":"offscreen",chip:on.textContent.trim().slice(0,18),
      sl:Math.round(box.scrollLeft),aL:Math.round(a.left),aR:Math.round(a.right),
      bL:Math.round(b.left),bR:Math.round(b.right)});`);
  const ov = JSON.parse(onView || "{}");
  ok(ov.v === "visible",
    `calculators: the selected far-right category is scrolled into view (${ov.v}; chip="${ov.chip}" scrollLeft=${ov.sl} chip ${ov.aL}..${ov.aR} vs row ${ov.bL}..${ov.bR})`);

  // ---- Knowledge Library ----
  await ev(`try{ if(window.MEDCALC && MEDCALC.close) MEDCALC.close(); }catch(e){} return 1;`); await sleep(300);
  const opened = await ev(`try{ if(window.SB && SB.openRef){ SB.openRef("syndromes"); return 1; } }catch(e){} return 0;`);
  if (!opened) { ok(false, "knowledge library: SB.openRef is reachable"); }
  else {
    await sleep(1400);
    const k = JSON.parse(await ev(`
      var grps=[].slice.call(document.querySelectorAll(".kblib-grp"));
      if(!grps.length) return JSON.stringify({g:0});
      var worst=1;
      grps.forEach(function(g){
        var tops={}; [].slice.call(g.querySelectorAll(".kblib-f")).forEach(function(e){tops[Math.round(e.getBoundingClientRect().top)]=1;});
        worst=Math.max(worst,Object.keys(tops).length);
      });
      var box=document.querySelector(".kblib-filters");
      return JSON.stringify({g:grps.length,worstRows:worst,
        filtersH:box?Math.round(box.getBoundingClientRect().height):0,vh:window.innerHeight});`) || "{}");
    ok(k.g >= 2, `knowledge library: the filter groups render (${k.g} groups)`);
    ok(k.worstRows === 1, `knowledge library: no group wraps - each is one rail (worst group used ${k.worstRows} row(s))`);
    ok(k.filtersH > 0 && k.filtersH < k.vh * 0.30, `knowledge library: all filters together stay under a third of the screen (${k.filtersH}px of ${k.vh}px)`);
  }

} catch (e) {
  fail++; console.log("FAIL harness: " + (e && e.message || e));
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { ws && ws.close(); } catch {}
  chrome.kill(); if (serveProc) serveProc.kill();
  process.exit(fail ? 1 : 0);
}
