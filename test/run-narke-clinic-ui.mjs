/* Narkē reading clinics (narke-clinic.js) in headless Chrome at phone width (390 x 844): both clinics on the hub,
 * the capnograph and monitor screens draw from the seeded model, the "teaching signal" label and the screen-reader
 * description are present, keys 1 to 4 answer, the reveal shows the answer, teaching points and next review and is
 * saved to spaced repetition, Next moves on, Hindi works, light and dark plates differ, reduced motion skips the sweep,
 * Resident adds the Resident patterns, no horizontal scroll, targets of 44 px, no dashes, no uncaught errors.
 * USAGE: PORT=<free port> CHROME_PORT=<free port> node test/run-narke-clinic-ui.mjs   (SHOTS=<dir> saves screenshots)
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8987) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9389), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/narke-clinic-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8987"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const key = async (k, code, vk, text) => { await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
if (process.env.SHOTS) mkdirSync(process.env.SHOTS, { recursive: true });
const shot = async (name) => { if (!process.env.SHOTS) return; const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(join(process.env.SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const R = `var R=document.getElementById("smdNarke");`;

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
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
  await until(`return !!window.NARKE_LOADER;`, 20000); await ev(`NARKE_LOADER.load(); return 1;`);
  ok(await until(`return !!(window.NARKE && NARKE._internal && window.NARKE_MODELS && NARKE_MODELS.signals && NARKE._clinics.length === 2);`, 20000), "loader brings the engine, narke-clinic.js and the signals model; two clinics registered");

  await ev(`try{localStorage.removeItem("smd_narke_v1");localStorage.setItem("smd_narke_prefs",JSON.stringify({level:"mbbs",lang:"en",tab:"test"}));}catch(e){} document.body.className="dark"; document.body.innerHTML='<div id="smdNarke"></div>'; NARKE.open(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act=clinic][data-t=capno]') && !!document.querySelector('[data-act=clinic][data-t=monitor]');`, 15000), "the Test hub lists the Capnography and Monitor reading clinics");
  ok(await ev(`return NARKE._internal.clinicItems(NARKE._internal.clinic("capno")).length;`) === 18, "MBBS sees the 18 MBBS capnography cases");

  await ev(`document.querySelector('[data-act=clinic][data-t=capno]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke .nkc-mon .nkc-line.co2');`), "capnography case draws a CO2 trace");
  ok(await ev(`${R} var d=R.querySelector('.nkc-line').getAttribute('d'); return d.split('L').length;`) === 600, "the trace has every one of the 600 model samples");
  ok(await ev(`${R} return R.querySelectorAll('.sp-ans').length === 4 && !!R.querySelector('.nkc-scene').textContent.trim();`) === true, "a scene line and four answer options");
  ok(await ev(`${R} return /Teaching signal, not patient data/.test(R.querySelector('.nkc-label').textContent);`) === true, "labelled: teaching signal, not patient data");
  ok(await ev(`${R} var f=R.querySelector('.nkc-mon'); return f.getAttribute('role')==='img' && document.getElementById(f.getAttribute('aria-describedby')).textContent.length > 60;`) === true, "the screen is an image with a measured screen-reader description");
  ok(await ev(`${R} return R.querySelectorAll('.nkc-tick').length >= 3 && /mmHg/.test(R.querySelector('.nkc-tag').textContent);`) === true, "the CO2 channel has a mmHg scale");
  await shot("capno-dark-question");

  // phone width: no horizontal scroll, 44 px targets
  ok(await ev(`${R} var s=R.querySelector('.sp-scroll'); return s.scrollWidth <= s.clientWidth + 1 && document.documentElement.scrollWidth <= 390;`) === true, "no horizontal scroll at 390 px");
  ok(await ev(`${R} var bad=[].filter.call(R.querySelectorAll(".sp-ans"), function(b){ var r=b.getBoundingClientRect(); return !(r.height>=43.5 && r.width>=43.5); }).map(function(b){var r=b.getBoundingClientRect(); return b.className+" "+r.width+"x"+r.height;}); return bad.length ? bad.join(";") : true;`) === true, "answer targets are at least 44 px tall (the top bar is the engine's)");

  // keyboard: 1 answers
  await ev(`${R} R.querySelector('.sp-ans').focus(); return 1;`); await key("1", "Digit1", 49, "1");
  ok(await until(`return !!document.querySelector('#smdNarke .nkc-verdict');`), "key 1 answers and the reveal appears");
  ok(await ev(`return document.activeElement && document.activeElement.classList.contains('nkc-verdict');`) === true, "focus moves to the verdict");
  ok(await ev(`${R} return R.querySelectorAll('.nkc-points li').length >= 3 && !!R.querySelector('.nkc-key b') && !!R.querySelector('.nkc-src summary') && /Next review in/.test(R.textContent);`) === true, "reveal: answer, teaching points, sources and next review");
  ok(await ev(`${R} return R.querySelectorAll('.sp-ans[data-state=right]').length === 1 && [].every.call(R.querySelectorAll('.sp-ans'), function(b){return b.getAttribute('aria-disabled')==='true';});`) === true, "the right answer is marked and the options lock");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_narke_v1")); return Object.keys(s.cards).some(function(k){return k.indexOf("capno.mbbs")===0;});`) === true, "the answer is saved to spaced repetition (capno.mbbs)");
  await shot("capno-dark-reveal");
  await ev(`document.querySelector('[data-act=nkc-next]').click(); return 1;`);
  ok(await until(`return /Case 2 of/.test(document.querySelector('#smdNarke .sp-title').textContent) && !document.querySelector('#smdNarke .nkc-verdict');`), "Next case moves on");
  ok(await ev(`var a=document.activeElement; return !!a && a !== document.body && !!a.closest('#smdNarke') && a.classList.contains('nkc-scene');`) === true, "after Next, focus is on the new case's scene inside the clinic");
  await key("2", "Digit2", 50, "2");
  ok(await until(`return !!document.querySelector('#smdNarke .nkc-verdict') && document.querySelectorAll('#smdNarke .sp-ans')[1].getAttribute('data-state') !== null;`), "key 2 answers the second case without clicking first");
  await ev(`document.querySelector('[data-act=nkc-next]').click(); return 1;`);
  ok(await until(`return /Case 3 of/.test(document.querySelector('#smdNarke .sp-title').textContent) && !document.querySelector('#smdNarke .nkc-verdict');`), "Next again moves to case 3");

  // the correct option gives Correct
  await ev(`var c=NARKE._st.session.list[NARKE._st.session.i].c; document.querySelector('#smdNarke [data-act=nkc-ans][data-o="'+c.pattern+'"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke .nkc-verdict.ok');`), "choosing the true pattern shows Correct");

  // Hindi
  await ev(`document.querySelector('#smdNarke [data-act=lang]').click(); return 1;`);
  ok(await until(`${R} return R.getAttribute('lang')==='hi' && /[\\u0900-\\u097F]/.test(R.querySelector('.nkc-scene').textContent) && /[\\u0900-\\u097F]/.test(document.getElementById('nkcDesc').textContent);`), "Hindi: scene, reveal and screen-reader text switch");
  ok(await ev(`return !/[\\u0966-\\u096F]/.test(document.getElementById('smdNarke').innerText);`) === true, "Hindi uses ASCII digits");
  await ev(`document.querySelector('#smdNarke [data-act=lang]').click(); return 1;`);

  // light plate differs from the dark plate
  const darkBg = await ev(`return getComputedStyle(document.querySelector('#smdNarke .nkc-mon')).backgroundColor;`);
  await ev(`document.body.className=""; return 1;`); await sleep(100);
  const lightBg = await ev(`return getComputedStyle(document.querySelector('#smdNarke .nkc-mon')).backgroundColor;`);
  ok(darkBg === "rgb(0, 0, 0)" && lightBg !== darkBg, "dark: black monitor plate; light: paper plate (" + lightBg + ")");
  await shot("capno-light-reveal");

  // monitor clinic, light theme
  await ev(`NARKE.back(); return 1;`);
  await until(`return !!document.querySelector('[data-act=clinic][data-t=monitor]');`);
  await ev(`document.querySelector('[data-act=clinic][data-t=monitor]').click(); return 1;`);
  ok(await until(`${R} return !!(R.querySelector('.nkc-line.ecg') && R.querySelector('.nkc-line.spo2') && R.querySelector('.nkc-nibp'));`), "monitor case draws ECG and pleth with NIBP");
  ok(await ev(`${R} var t=R.querySelector('.nkc-mon > .nkc-trend'), m=R.querySelector('.nkc-mon'); if(!t) return "no trend row"; var a=t.getBoundingClientRect(), b=m.getBoundingClientRect(); return a.width >= b.width - 2 && !t.closest('.nkc-nibp');`) === true, "monitor: the EtCO2 trend is its own full-width row, apart from NIBP");
  ok(await ev(`${R} return /HR/.test(R.querySelector('.nkc-ecg .nkc-num').textContent) && /most likely problem/.test(R.textContent);`) === true, "monitor numerics and question");
  ok(await ev(`${R} var s=R.querySelector('.sp-scroll'); return s.scrollWidth <= s.clientWidth + 1;`) === true, "monitor: no horizontal scroll at 390 px");
  await shot("monitor-light-question");
  await ev(`document.body.className="dark"; return 1;`); await sleep(100); await shot("monitor-dark-question");
  await ev(`document.querySelector('#smdNarke [data-act=nkc-ans]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke .nkc-verdict');`), "monitor answer reveals");

  // reduced motion: no sweep on the next case
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await ev(`document.querySelector('[data-act=nkc-next]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdNarke .nkc-new .nkc-svg');`) && await ev(`return getComputedStyle(document.querySelector('#smdNarke .nkc-new .nkc-svg')).animationName;`) === "none", "reduced motion: the trace appears without the sweep");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

  const txt = await ev(`return document.getElementById("smdNarke").innerText;`), dm = /[\s\S]{0,60}[\u2013\u2014][\s\S]{0,60}/.exec(txt);
  ok(!dm, "no em or en dash on the clinic screens" + (dm ? ": " + dm[0] : ""));

  // Resident: all 30 cases including Resident-only patterns
  await ev(`localStorage.setItem("smd_narke_prefs",JSON.stringify({level:"resident",lang:"en",tab:"test"})); NARKE.close(); NARKE.open(); return 1;`);
  await until(`return !!document.querySelector('[data-act=clinic][data-t=capno]');`);
  ok(await ev(`var I=NARKE._internal; var a=I.clinicItems(I.clinic("capno")), b=I.clinicItems(I.clinic("monitor")); return a.length===30 && b.length===30 && a.some(function(x){return x.a==="curare";}) && b.some(function(x){return x.a==="mh";});`) === true, "Resident sees all 30 cases per clinic, including curare cleft and MH");

  ok(errors.length === 0, "no uncaught errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Narkē reading clinics" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
