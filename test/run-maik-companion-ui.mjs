/* MaiK companion v2 inside the real MaiK sheet — real headless browser (2026-09-25).
 *
 * Classic stays the default; the side-panel chooser swaps in Attending / On-Call / MaiK Bot and back;
 * he reacts to typing, thinking, the answer streaming in, the answer landing, errors, Stop and the
 * doctor's rating; press-and-hold on him opens the chooser; his loop parks when idle or hidden;
 * reduced motion keeps him in place. SMD_AI's cloud calls are stubbed: no network.
 *
 * USAGE: BASE=http://localhost:8986/ node test/run-maik-companion-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8986/").replace(/\/?$/, "/");
const PORT = 9402, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-companion-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8986"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId; const exceptions = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const st = async () => JSON.parse(await ev(`return JSON.stringify(__MAIK_TEST.companion())`) || "null");
const waitFor = async (js, ms) => { for (let i = 0; i < (ms || 5000) / 150; i++) { if (await ev(js) === true) return true; await sleep(150); } return false; };
const HOLD = `window.__settle = null; window.__delta = null;
  var st = function (pkg, opts, onDelta) { window.__delta = onDelta || null; return new Promise(function (res) { window.__settle = res; }); };
  window.SMD_AI.explainGrounded = function (pkg, opts) { return st(pkg, opts, null); }; window.SMD_AI.explainGroundedStream = st;
  window.SMD_AI.figures = function () { return Promise.resolve({ figures: [] }); }; return 1;`;
const ask = (q) => ev(`var e = document.getElementById("maikQ"); e.value = ${JSON.stringify(q)}; e.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("maikSend").click(); return 1;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails); };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_AI && window.MaiKCompanion)`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK and the companion engine load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); localStorage.setItem("smd_device_id","mkc"); localStorage.removeItem("smd_maik_doc_style"); localStorage.removeItem("smd_maik_doc_off"); localStorage.removeItem("smd_maik_live_doc"); localStorage.setItem("smd_maik_llm_first","1"); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1400);
  exceptions.length = 0;

  // 1. Classic stays the default until the owner picks.
  ok(await ev(`return !!document.querySelector("#maikSheet .mkdoc") && !document.querySelector("#maikSheet .mkc")`) === true, "by default the classic pixel doctor is on duty");

  // 2. The chooser in the side panel.
  await ev(`document.getElementById("maikMenu").click(); return 1;`); await sleep(400);
  await ev(`document.getElementById("maikSideBuddy").click(); return 1;`); await sleep(250);
  const pick = JSON.parse(await ev(`var p = document.getElementById("maikBuddyPick"); return JSON.stringify({ shown: !p.hidden, n: p.querySelectorAll(".maik-bd-opt").length, radios: p.querySelectorAll('[role="radio"]').length, on: (p.querySelector(".maik-bd-opt.on") || {}).getAttribute ? p.querySelector(".maik-bd-opt.on").getAttribute("data-bd") : "", thumbs: p.querySelectorAll(".maik-bd-th svg").length });`));
  ok(pick.shown && pick.n === 5 && pick.radios === 5 && pick.on === "classic" && pick.thumbs === 5, `the MaiK buddy chooser lists 5 buddies with previews, classic selected (${JSON.stringify(pick)})`);
  await ev(`document.querySelector('.maik-bd-opt[data-bd="attending"]').click(); return 1;`); await sleep(700);
  const s1 = await st();
  ok(s1 && s1.style === "attending" && await ev(`return !!document.querySelector("#maikSheet .mkc-attending") && !document.querySelector("#maikSheet .mkdoc")`) === true, `choosing Attending swaps him in (${s1 && s1.act})`);
  ok(await ev(`return localStorage.getItem("smd_maik_doc_style")`) === "attending", "the choice is remembered on this device");
  ok(await ev(`return document.getElementById("maikSideBuddyState").textContent`) === "Attending", "the side panel shows the current buddy");

  // 3. Understanding: typing, thinking, reading, landing.
  await waitFor(`var s = __MAIK_TEST.companion(); return !!s && s.act === "idle"`, 6000);
  await ev(`var e = document.getElementById("maikQ"); e.value = "chest pa"; e.dispatchEvent(new Event("input", { bubbles: true })); return 1;`); await sleep(250);
  ok((await st()).act === "listen", "typing a question: he listens");
  await ev(`document.getElementById("maikQ").value = ""; return 1;`);
  await ev(HOLD); await ask("chest pain with ST elevation workup");
  await sleep(500);
  let s = await st();
  ok(s.busy && s.act !== "idle", `sending: he gets to work (${s.act}, busy ${s.busy})`);
  ok(await waitFor(`var s = __MAIK_TEST.companion(); return s.act === "think" && s.propF === "bell"`, 3000), "a cardiac question gets the stethoscope");
  await ev(`window.__delta && window.__delta("Streaming the answer"); return 1;`); await sleep(250);
  ok((await st()).act === "read", "the first words arrive: he reads along");
  await ev(`window.__settle({ text: "Final answer about chest pain.", mode: "grounded" }); return 1;`); await sleep(500);
  s = await st();
  ok(!s.busy && s.gesture === "thumbs", `the answer lands: thumbs up (${s.gesture})`);

  // 4. Rating, error, stop.
  await sleep(1500);
  await ev(`var b = document.querySelectorAll("#maikBody .maik-fb-b"); for (var i = 0; i < b.length; i++) if (/^Yes$/.test(b[i].textContent)) { b[i].click(); break; } return 1;`); await sleep(200);
  ok((await st()).gesture === "heart", "the doctor taps Yes: he sends love");
  await sleep(1600);
  await ev(`__MAIK_TEST.clearCache && __MAIK_TEST.clearCache(); return 1;`);
  await ev(HOLD); await ask("approach to a patient with fever and rash"); await sleep(600);
  await ev(`window.__settle({ error: "server 500" }); return 1;`); await sleep(350);
  ok((await st()).gesture === "shrug", "an error: a worried shrug, not a thumbs up");
  await sleep(1800);
  await ev(HOLD); await ask("management of diabetic ketoacidosis in adults"); await sleep(600);
  await ev(`document.getElementById("maikSend").click(); return 1;`); await sleep(250);
  ok((await st()).gesture === "palm", "Stop: an open palm, okay");
  await ev(`window.__settle && window.__settle({ text: "late", mode: "grounded" }); return 1;`); await sleep(400);

  // 5. Energy: parks when idle; parks when the app is hidden.
  ok(await waitFor(`var s = __MAIK_TEST.companion(); return s.act === "idle" && s.parked === true`, 6000), "idle and still: his frame loop parks");
  await ev(`Object.defineProperty(document, "hidden", { configurable: true, get: function () { return true; } }); document.dispatchEvent(new Event("visibilitychange")); __MAIK_TEST.companion(); return 1;`);
  await ev(`document.getElementById("maikQ").dispatchEvent(new Event("input", { bubbles: true })); return 1;`); await sleep(300);
  ok((await st()).parked === true, "with the app hidden he stays parked even when poked");
  await ev(`Object.defineProperty(document, "hidden", { configurable: true, get: function () { return false; } }); document.dispatchEvent(new Event("visibilitychange")); return 1;`);

  // 6. Press and hold him: the chooser opens.
  const r = JSON.parse(await ev(`var a = document.querySelector("#maikSheet .mkc-a").getBoundingClientRect(); return JSON.stringify({ x: a.left + a.width / 2, y: a.top + a.height / 2 });`));
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(750);
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(400);
  ok(await ev(`var p = document.getElementById("maikBuddyPick"); return !!p && !p.hidden && !document.getElementById("maikSideWrap").hidden`) === true, "press and hold on him opens the buddy chooser");
  await ev(`document.querySelector('.maik-bd-opt[data-bd="bot"]').click(); return 1;`); await sleep(800);
  ok(await ev(`return !!document.querySelector("#maikSheet .mkc-bot")`) === true && (await st()).style === "bot", "switching to MaiK Bot works from there");
  ok(await waitFor(`var s = __MAIK_TEST.companion(); return s.landed === true && s.parked === true`, 9000), "the bot lands and parks when nothing is happening");

  // 7. Classic and Standing come back cleanly.
  await ev(`__MAIK_TEST.buddySet("classic"); return 1;`); await sleep(500);
  ok(await ev(`return !!document.querySelector("#maikSheet .mkdoc") && !document.querySelector("#maikSheet .mkc") && __MAIK_TEST.companion() === null`) === true, "back to classic: the companion is gone, the pixel doctor returns");
  await ev(`__MAIK_TEST.buddySet("off"); return 1;`); await sleep(400);
  ok(await ev(`return !!document.querySelector("#maikSheet .mkw") && !document.querySelector("#maikSheet .mkdoc") && !document.querySelector("#maikSheet .mkc")`) === true, "Standing buddy: the quiet resident only");

  // 8. Reduced motion: he stays put.
  await ev(`__MAIK_TEST.buddySet("oncall"); return 1;`);
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await ev(`document.getElementById("maikClose").click(); return 1;`); await sleep(500);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(900);
  const r0 = await st();
  await ev(HOLD); await ask("code blue in the ward"); await sleep(900);
  const r1 = await st();
  ok(r0 && r0.reduce && r1.x === r0.x, `reduced motion: no walking or running, even for an emergency (x ${r0 && r0.x} -> ${r1 && r1.x})`);
  await ev(`window.__settle && window.__settle({ text: "ok", mode: "grounded" }); return 1;`);
  await call("Emulation.setEmulatedMedia", { features: [] });

  ok(exceptions.length === 0, `no uncaught exceptions (${exceptions.length}${exceptions.length ? ": " + JSON.stringify(exceptions[0]).slice(0, 200) : ""})`);
  console.log(fails === 0 ? "\nALL GREEN: the companion lives in MaiK and understands what is going on" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); await sleep(300); try { rmSync(userDir, { recursive: true, force: true }); } catch {} process.exit(fails === 0 ? 0 : 1); }
