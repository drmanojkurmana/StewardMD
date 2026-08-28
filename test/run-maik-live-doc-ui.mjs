/* MaiK Live Doctor — real headless browser.
 *
 * The Live Doctor (flag smd_maik_live_doc, default ON) replaces the stationary resident:
 * a 12x16 pixel physician who walks the composer's top edge right to left, freelances
 * stunts (hop/backflip/sprint/auscultate with a bpm bubble), reacts to a tap on himself
 * (startle/wave/hearts), and never intercepts taps anywhere else. Pinned because the
 * whole thing is a hand-rolled rAF state machine: a stuck state, a walker that stops
 * travelling, a reaction that no longer fires, or a doctor that survives close are all
 * invisible to unit tests.
 *
 * USAGE: node test/run-maik-live-doc-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/livedoc-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serve = spawn("node", ["test/serve.mjs", ".", "8991"], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_askMaik`) === true) break; }
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); document.body.classList.add("dark"); return 1;`);
  await ev(`localStorage.removeItem("smd_maik_live_doc"); return 1;`); // default = ON
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1400);

  // ── he is there by default, and the old resident is not ──
  ok(await ev(`return !!document.querySelector(".maik-cmp .mkdoc");`) === true, "Live Doctor mounts by default");
  ok(await ev(`return !document.querySelector(".maik-cmp .mkw");`) === true, "the stationary resident stands down");
  const fills = await ev(`return [].slice.call(document.querySelectorAll(".mkdoc-svg rect")).map(function(r){return r.getAttribute("fill");}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort().join(",");`);
  ok(fills.indexOf("#F2F6F7") >= 0 && fills.indexOf("#E9B48C") >= 0 && fills.indexOf("#2DD4BF") >= 0,
    "he is a doctor: coat, skin and stethoscope teal in the palette — got " + fills);
  ok(await ev(`return document.querySelectorAll(".mkdoc-svg > g").length;`) === 10, "ten frames mounted");

  // ── he TRAVELS right to left ──
  const s1 = await ev(`return __MAIK_TEST.docState();`);
  await sleep(1500);
  const s2 = await ev(`return __MAIK_TEST.docState();`);
  ok(s1 && s2 && typeof s1.x === "number", "engine state is live (" + JSON.stringify(s2) + ")");
  ok(s2.x !== s1.x, "he moves on his own (" + Math.round(s1.x) + " -> " + Math.round(s2.x) + ")");
  ok(s1.dir === -1, "his round runs right to left");

  // ── he does stunts without being asked (state leaves plain walk within a stunt window) ──
  const states = {};
  for (let i = 0; i < 70; i++) { const s = await ev(`var d=__MAIK_TEST.docState(); return d&&d.state;`); if (s) states[s] = 1; await sleep(120); }
  ok(Object.keys(states).length >= 2, "he freelances stunts — states seen: " + Object.keys(states).sort().join(","));

  // ── tapping HIM reacts; the strip around him takes no taps ──
  ok(await ev(`return getComputedStyle(document.querySelector(".mkdoc")).pointerEvents;`) === "none", "his strip never intercepts taps");
  ok(await ev(`return getComputedStyle(document.querySelector(".mkdoc-a")).pointerEvents;`) === "auto", "but he himself is tappable");
  const reacted = await ev(`
    var a=document.querySelector(".mkdoc-a");
    a.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true}));
    var d=__MAIK_TEST.docState(); return d&&d.state;`);
  ok(["startle", "wave"].indexOf(reacted) >= 0, "a tap on him gets a reaction — " + reacted);

  // ── he ACTS OUT the question ──
  const cls = await ev(`return [__MAIK_TEST.docClassify("patient in cardiac arrest now"),__MAIK_TEST.docClassify("chest pain with palpitations and ecg changes"),__MAIK_TEST.docClassify("dose of amoxicillin in renal failure"),__MAIK_TEST.docClassify("how do we treat dka")].join(",");`);
  ok(cls === "urgent,cardiac,rx,think", "questions classify urgent/cardiac/rx/think — got " + cls);
  ok(await ev(`__MAIK_TEST.docCue("cardiac"); var d=__MAIK_TEST.docState(); return d&&d.state;`) === "listen", "a cardiac question gets the stethoscope");
  ok(await ev(`__MAIK_TEST.docCue("urgent"); var d=__MAIK_TEST.docState(); return d&&d.state;`) === "startle", "an emergency startles him");
  await sleep(700);
  ok(await ev(`var d=__MAIK_TEST.docState(); return d&&d.state;`) === "run", "then he sprints");
  ok(await ev(`__MAIK_TEST.docCue("done"); var d=__MAIK_TEST.docState(); return d&&d.state;`) === "wave", "the answer landing gets a wave");

  // ── busy: a question in flight quickens him ──
  await ev(`__MAIK_TEST.buddyBusy(true); return 1;`); await sleep(100);
  ok(await ev(`return document.querySelector(".mkdoc").classList.contains("busy");`) === true, "a question in flight perks him up");
  await ev(`__MAIK_TEST.buddyBusy(false); return 1;`);

  // ── the kill switch restores the old resident ──
  await ev(`var c=document.getElementById("maikClose"); if(c) c.click(); return 1;`); await sleep(500);
  ok(await ev(`return !document.querySelector(".mkdoc");`) === true, "he leaves when MaiK closes");
  ok(await ev(`return __MAIK_TEST.docState();`) === null, "and his engine stops with him");
  await ev(`localStorage.setItem("smd_maik_live_doc","0"); SMD_askMaik(""); return 1;`); await sleep(1200);
  ok(await ev(`return !document.querySelector(".mkdoc") && !!document.querySelector(".maik-cmp .mkw");`) === true,
    "flag \"0\" restores the stationary Stetho Buddy");
  await ev(`localStorage.removeItem("smd_maik_live_doc"); return 1;`);

} catch (e) { console.log("ERR", e); fails++; }
finally { chrome.kill(); serve.kill(); }
console.log(fails ? "FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
