/* PrepReels (MediGram) in the REAL app (headless Chrome over CDP), flag smd_prep_medigram ON.
 * What must hold: prep-loader fetches the PrepReels files only with the flag; home shows PrepReels;
 * the feed answers an MCQ (FSRS row written), save/skip/report and the lesson card work, Finish
 * session always shows and returns home; Smart Break (sub-flag) runs a 3-minute timer that only
 * offers a return; no YouTube iframe while the policy flag is off; nothing wider than 390 px.
 * USAGE: node test/run-prep-medigram-ui.mjs   (CHROME=<path>) */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = "/tmp/prep-mg-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = []; const reqs = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-500));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url); if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP|medigram/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_API="/test/fixtures/prep/api/"; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep_medigram","1");}catch(e){}` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.setItem("smd_prep_medigram","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1&medigram=1&medigram_break=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  ok(reqs.some((u) => /prep-medigram\.js/.test(u)), "prep-loader fetched prep-medigram.js with the flag on");
  ok(await ev(`return !!window.PREP_MEDIGRAM && !!window.PREP_MG_DATA;`) === true, "PREP_MEDIGRAM and PREP_MG_DATA loaded");
  await evA(`return window.PREP.open({});`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=mg-open]');`, 20000), "home shows the PrepReels row");
  await click("#smdPrep [data-act=mg-open]");
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mg-card');`, 8000), "PrepReels feed opens on a card");
  ok(await ev(`return !!document.querySelector('#smdPrep [data-act=mg-finish]');`) === true, "Finish session is present from the first item");
  ok(await ev(`return document.querySelectorAll('#smdPrep iframe').length;`) === 0, "no YouTube iframe while the policy flag is off");
  ok(await ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1) o.push(1);}); return o.length;`) === 0, "nothing wider than the 390 px screen");
  // answer the first MCQ correctly (option A is correct in every fixture MCQ)
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=mg-answer]');`, 8000), "first feed item is an MCQ with options");
  await click("#smdPrep [data-act=mg-answer][data-k='0']");
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mg-exp');`, 8000), "answering shows the explanation at once");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")||"{}"); return Object.keys(s.cards||{}).some(function(k){return k.indexOf("q-")>=0;});`) === true, "the valid answer wrote an FSRS card row");
  await click("#smdPrep [data-act=mg-save]"); await click("#smdPrep [data-act=mg-report]");
  await click("#smdPrep [data-act=mg-next]");
  ok(await until(`return /Item 2 of/.test(document.querySelector("#smdPrep .pn-t p").textContent);`, 8000), "Next moves to item 2");
  await click("#smdPrep [data-act=mg-skip]");
  ok(await until(`return /Item 3 of/.test(document.querySelector("#smdPrep .pn-t p").textContent);`, 8000), "Skip moves to item 3 without answering");
  // finish from mid-feed: always available, summary, Done returns home
  await click("#smdPrep [data-act=mg-finish]");
  ok(await until(`return /Session finished|Mission complete/.test(document.querySelector("#smdPrep .pn-mg-h").textContent);`, 8000), "Finish session shows the summary");
  await click("#smdPrep [data-act=mg-done]");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=mg-open]');`, 8000), "Done returns to the PrepNucleus home");
  // Smart Break: sub-flag on, 3-minute timer, return offers study (never locks)
  await click("#smdPrep [data-act=mg-open]");
  await until(`return !!document.querySelector('#smdPrep [data-act=mg-mode][data-v=break]');`, 8000);
  await click("#smdPrep [data-act=mg-mode][data-v=break]");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=mg-break-start][data-v="3"]');`, 8000), "Break offers a 3-minute choice");
  await click("#smdPrep [data-act=mg-break-start][data-v='3']");
  ok(await until(`return /left|Break/.test(document.querySelector("#smdPrep .pn-mg-h").textContent);`, 8000), "break timer is running");
  await click("#smdPrep [data-act=mg-break-return]");
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mg-card');`, 8000), "Return to study goes back to the feed");
  ok(!errors.length, "no uncaught PrepReels error" + (errors.length ? ": " + errors[0] : ""));
  ok(!reqs.some((u) => /googleapis|youtube\.com\/embed/.test(u)), "no YouTube or paid API request was made");
} catch (e) { console.log("FAIL harness: " + (e && e.message || e)); fails++; }
finally { try { chrome.kill(); } catch {} if (serveProc) try { serveProc.kill(); } catch {} }
console.log(fails ? `MEDIGRAM UI: ${fails} FAIL` : "MEDIGRAM UI: ALL PASS");
process.exit(fails ? 1 : 0);
