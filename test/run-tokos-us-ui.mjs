// test/run-tokos-us-ui.mjs: the Tokós fetal ultrasound clinics (tokos-clinic-us.js) in headless Chrome at 390x844.
// Planes case answered right and wrong, an ellipse dragged by pointer then fitted by keyboard, zoom invariance, the HC
// result, the Resident trial and paywall, Hindi with ASCII numerals. Screenshots to SHOTS (default: the job's tmp dir).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
// BASE (a running server) or PORT (the server this harness starts) and CHROME_PORT override the defaults, so parallel sessions do not collide.
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8997) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9399), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tokos-us-ui-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
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
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const KC = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
const key = async (k, shift) => {
  const p = { key: k, code: k, windowsVirtualKeyCode: KC[k], nativeVirtualKeyCode: KC[k], modifiers: shift ? 8 : 0 };
  await call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...p }); await call("Input.dispatchKeyEvent", { type: "keyUp", ...p });
};
// n presses of an arrow: tens with Shift, then ones.
const press = async (plus, minus, n) => { const k = n >= 0 ? plus : minus; n = Math.abs(n); for (let i = 0; i < Math.floor(n / 10); i++) await key(k, true); for (let i = 0; i < n % 10; i++) await key(k, false); };
const shot = async (name) => { if (!SHOTS) return; await sleep(350); const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
const mouse = (type, x, y) => call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const DEVA_DIGIT = "/[\\u0966-\\u096F]/";

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  await until(`return !!window.TOKOS_LOADER;`, 15000); await ev(`TOKOS_LOADER.load(); return 1;`);
  ok(await until(`return !!(window.TOKOS_US && window.TOKOS && TOKOS._internal && TOKOS._clinics.length === 3);`, 15000), "the ultrasound clinics load with the engine (3 clinics registered)");

  const reset = (prefs) => ev(`try{localStorage.removeItem("smd_tokos_v1");}catch(e){} localStorage.setItem("smd_tokos_prefs", JSON.stringify(${JSON.stringify(prefs)})); TOKOS.close(); TOKOS.open(); return 1;`);
  await ev(`document.body.innerHTML='<div id="smdTokos"></div>'; document.body.classList.remove('dark','v3-dark'); return 1;`);
  await reset({ level: "mbbs", lang: "en", tab: "test" });
  ok(await until(`return !!document.querySelector('[data-act=clinic][data-t="fetal-planes"]') && !!document.querySelector('[data-act=clinic][data-t="hc-biometry"]');`), "hub lists the planes and head circumference clinics");
  await shot("01-hub-paper");

  // ---- fetal planes, MBBS: answer right ----
  await ev(`document.querySelector('[data-act=clinic][data-t="fetal-planes"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#tusSvg image') && TOKOS._st.view === 'us-planes';`), "planes case opens with the image on the stage");
  ok(await until(`var i=document.querySelector('#tusSvg image'); var r=i && i.getBoundingClientRect(); return !!r && r.width > 300;`), "image is fitted to the stage width");
  ok(await ev(`return document.querySelectorAll('[data-act=us-pick]').length;`) === 6, "MBBS chooses from the 6 grouped planes");
  ok(await ev(`return document.querySelector('[data-act=us-check]').disabled;`) === true, "Check is disabled until a plane is chosen");
  ok(await ev(`return [].every.call(document.querySelectorAll('[data-act=us-pick]'), function(b){ return b.getBoundingClientRect().height >= 44; });`) === true, "plane buttons are at least 44 px tall");
  await shot("02-planes-case-paper");
  await ev(`var c=TOKOS._st.session.list[0].c; document.querySelector('[data-act=us-pick][data-o="'+c.group+'"]').click(); return 1;`);
  await ev(`document.querySelector('[data-act=us-check]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tus-verdict.ok');`), "the right plane is marked Correct");
  ok(await ev(`return /FETAL_PLANES_DB/.test(document.querySelector('.tus-credit').textContent) && /CC BY 4\\.0/.test(document.querySelector('.tus-credit').textContent);`) === true, "the reveal credits the image (dataset and licence)");
  ok(await ev(`return document.querySelectorAll('.tok-why li').length >= 2 && !!document.querySelector('.tus-src a[href^="https://doi.org/"]');`) === true, "what defines the plane is listed with its sources");
  ok(await ev(`var s=JSON.parse(localStorage.getItem('smd_tokos_v1')); return Object.keys(s.cards).some(function(k){return k.indexOf('fetal-planes.mbbs:')===0;});`) === true, "spaced repetition card saved under fetal-planes.mbbs");
  await shot("03-planes-reveal-right-paper");

  // ---- next case: answer wrong ----
  await ev(`document.querySelector('[data-act=us-next]').click(); return 1;`);
  ok(await until(`return TOKOS._st.view === 'us-planes' && TOKOS._st.session.i === 1;`), "Next case moves on");
  await ev(`var c=TOKOS._st.session.list[1].c; var b=[].filter.call(document.querySelectorAll('[data-act=us-pick]'), function(x){return x.getAttribute('data-o')!==c.group;})[0]; b.click(); document.querySelector('[data-act=us-check]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tus-verdict.no') && !!document.querySelector('.tok-ans.mine') && !!document.querySelector('.tok-ans.key');`), "a wrong plane shows yours and the answer");
  await ev(`document.body.classList.add('dark'); return 1;`);
  await shot("04-planes-reveal-wrong-dark");
  await ev(`document.body.classList.remove('dark'); TOKOS.back(); return 1;`);
  await until(`return TOKOS._st.view === 'hub';`);

  // ---- head circumference ----
  await ev(`document.querySelector('[data-act=clinic][data-t="hc-biometry"]').click(); return 1;`);
  ok(await until(`return TOKOS._st.view === 'us-hc' && !!document.querySelector('.tus-h-a .tus-hit');`), "HC case opens with the ellipse and its handles");
  ok(await ev(`var r=document.querySelector('.tus-h-a .tus-hit').getBoundingClientRect(); return r.width >= 43 && r.height >= 43;`) === true, "handle touch targets are 44 px on screen");
  await shot("05-hc-case-paper");
  // Drag the long-axis handle with the mouse: a grows, nothing else moves.
  const e0 = await ev(`return TOKOS._us.e;`);
  const hp = await ev(`var r=document.querySelector('.tus-h-a .tus-hit').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};`);
  await mouse("mousePressed", hp.x, hp.y); await mouse("mouseMoved", hp.x + 20, hp.y); await mouse("mouseMoved", hp.x + 40, hp.y); await mouse("mouseReleased", hp.x + 40, hp.y);
  const e1 = await ev(`return TOKOS._us.e;`);
  ok(e1.a > e0.a + 30 && e1.cx === e0.cx && e1.b === e0.b, `dragging the long-axis handle lengthens it (a ${e0.a} -> ${Math.round(e1.a)})`);
  // Zoom in: the ellipse (image px) and live HC do not change.
  const live0 = await ev(`return document.getElementById('tusLive').textContent;`);
  await ev(`document.querySelector('[data-act=us-zoom]').click(); return 1;`);
  await sleep(300);
  ok(await ev(`return document.getElementById('tusStage').classList.contains('zoomed');`) === true && await ev(`return document.getElementById('tusLive').textContent;`) === live0 &&
    JSON.stringify(await ev(`return TOKOS._us.e;`)) === JSON.stringify(e1), "zooming changes neither the ellipse nor the HC");
  ok(await ev(`var r=document.querySelector('.tus-h-a .tus-hit').getBoundingClientRect(); return r.width >= 43 && r.width <= 46;`) === true, "handles keep their on-screen size when zoomed");
  await ev(`document.querySelector('[data-act=us-fit]').click(); return 1;`);

  // Fit by keyboard to the sonographer's ellipse: Move, Long axis, Short axis, Turn, each by arrow keys on the image.
  const c = await ev(`return TOKOS._st.session.list[0].c;`);
  const mode = async (m) => { await ev(`document.querySelector('[data-act=us-mode][data-m="${m}"]').click(); document.getElementById('tusStage').focus(); return 1;`); };
  let e = await ev(`return TOKOS._us.e;`);
  await mode("move");
  await press("ArrowRight", "ArrowLeft", Math.round(c.ellipse.cx - e.cx));
  await press("ArrowDown", "ArrowUp", Math.round(c.ellipse.cy - e.cy));
  await mode("long"); e = await ev(`return TOKOS._us.e;`); await press("ArrowRight", "ArrowLeft", Math.round(c.ellipse.a - e.a));
  await mode("short"); e = await ev(`return TOKOS._us.e;`); await press("ArrowRight", "ArrowLeft", Math.round(c.ellipse.b - e.b));
  await mode("turn"); e = await ev(`return TOKOS._us.e;`); await press("ArrowRight", "ArrowLeft", Math.round(c.ellipse.angleDeg - e.angleDeg));
  e = await ev(`return TOKOS._us.e;`);
  ok(Math.abs(e.cx - c.ellipse.cx) <= 1 && Math.abs(e.cy - c.ellipse.cy) <= 1 && Math.abs(e.a - c.ellipse.a) <= 1 && Math.abs(e.b - c.ellipse.b) <= 1 && Math.abs(e.angleDeg - c.ellipse.angleDeg) <= 1,
    "arrow keys fit the ellipse to the skull (within 1 px and 1 degree)");
  // Steppers too: one tap on Larger then Smaller leaves the short axis where it was.
  const b0 = e.b;
  await mode("short");
  await ev(`document.querySelector('[data-act=us-step][data-d="1"]').click(); return 1;`); const b1 = (await ev(`return TOKOS._us.e;`)).b;
  await ev(`document.querySelector('[data-act=us-step][data-d="-1"]').click(); return 1;`); const b2 = (await ev(`return TOKOS._us.e;`)).b;
  ok(b1 === b0 + 1 && b2 === b0, "stepper buttons adjust by 1 px");
  await shot("06-hc-fitted-paper");
  await ev(`document.querySelector('[data-act=us-measure]').click(); return 1;`);
  ok(await until(`return TOKOS._st.view === 'us-hc-reveal' && !!document.querySelector('.tus-verdict.on');`), "a fitted ellipse scores On target");
  const rv = await ev(`var r=TOKOS._st.session.result; return {pct:r.err.pct, mm:r.err.mm, txt:document.querySelector('.tok-reveal').textContent};`);
  ok(Math.abs(rv.pct) < 1, `HC error under 1% (${rv.pct.toFixed(2)}%, ${rv.mm.toFixed(2)} mm)`);
  ok(rv.txt.includes(c.hcMm.toFixed(1) + " mm") && rv.txt.includes(c.gaWeeks.toFixed(1)) && rv.txt.includes("+/-2 SD " + c.gaTol2SDWeeks), "the result shows the sonographer's HC, GA by Hadlock and its 2 SD band");
  ok(await ev(`return document.querySelectorAll('#tusSvg .tus-truth').length === 1 && document.querySelectorAll('#tusSvg .tus-mine').length === 1;`) === true, "both ellipses are drawn on the result image");
  ok(await ev(`var s=JSON.parse(localStorage.getItem('smd_tokos_v1')); return Object.keys(s.cards).some(function(k){return k.indexOf('hc-biometry.mbbs:')===0;});`) === true, "HC card saved under hc-biometry.mbbs");
  await shot("07-hc-result-paper");
  await ev(`document.body.classList.add('dark'); return 1;`);
  await shot("08-hc-result-dark");

  // ---- Hindi: ASCII numerals, Hindi text ----
  await ev(`document.querySelector('[data-act=lang]').click(); return 1;`);
  ok(await until(`return document.getElementById('smdTokos').getAttribute('lang') === 'hi' && TOKOS._st.view === 'us-hc-reveal';`), "the HC result repaints in Hindi");
  ok(await ev(`var t=document.getElementById('smdTokos').textContent; return /[\\u0900-\\u097F]/.test(t) && !${DEVA_DIGIT}.test(t) && /\\d+\\.\\d mm/.test(t);`) === true, "Hindi text with ASCII clinical numerals");
  await shot("09-hc-result-hindi-dark");
  await ev(`document.querySelector('[data-act=us-next]').click(); return 1;`);
  ok(await until(`return TOKOS._st.view === 'us-hc' && !!document.querySelector('.tus-h-c');`), "the next HC case starts in Hindi");
  ok(await ev(`return !${DEVA_DIGIT}.test(document.getElementById('smdTokos').textContent);`) === true, "no Devanagari digits on the HC case");
  await shot("10-hc-case-hindi-dark");
  await ev(`TOKOS.back(); document.body.classList.remove('dark'); return 1;`);

  // ---- Resident: one trial per clinic, then the paywall ----
  await ev(`window.__paywall = 0; window.SMD_PRO_NOTICE = { show: function(){ window.__paywall++; } }; return 1;`);
  await reset({ level: "resident", lang: "en", tab: "test" });
  await until(`return !!document.querySelector('[data-act=clinic][data-t="fetal-planes"]');`);
  ok(await ev(`return /1 free try/.test(document.querySelector('[data-act=clinic][data-t="fetal-planes"]').textContent);`) === true, "Resident planes shows its one free try");
  await ev(`document.querySelector('[data-act=clinic][data-t="fetal-planes"]').click(); return 1;`);
  ok(await until(`return TOKOS._st.view === 'us-planes';`), "the trial opens the Resident planes clinic");
  ok(await ev(`return document.querySelectorAll('[data-act=us-pick]').length;`) === 9, "Resident chooses from the 9 fine planes");
  ok(await ev(`return JSON.parse(localStorage.getItem('smd_tokos_v1')).trials['clinic.fetal-planes'] != null;`) === true, "the trial clinic.fetal-planes is spent");
  await ev(`var c=TOKOS._st.session.list[0].c; document.querySelector('[data-act=us-pick][data-o="'+c.label+'"]').click(); document.querySelector('[data-act=us-check]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tus-verdict.ok');`), "Resident answer on the fine plane is marked");
  await shot("11-planes-resident-reveal");
  await ev(`TOKOS.back(); return 1;`); await until(`return TOKOS._st.view === 'hub';`);
  ok(await ev(`return /Trial used/.test(document.querySelector('[data-act=clinic][data-t="fetal-planes"]').textContent);`) === true, "the hub marks the trial used");
  await ev(`document.querySelector('[data-act=clinic][data-t="fetal-planes"]').click(); return 1;`);
  ok(await ev(`return window.__paywall === 1 && TOKOS._st.view === 'hub';`) === true, "a spent trial opens the paywall, not the clinic");

  ok(errors.length === 0, "no uncaught errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.stack || e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
