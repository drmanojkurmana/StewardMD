/* MaiK "About me" (the doctor's preferences memory) — real headless browser.
 *
 * Owner, 2026-09-25: "build the doctor preferences memory". Opens the panel from the sidebar, fills
 * it, checks a patient identifier is refused, saves, reopens, and checks the next clinical question
 * carries the preferences (SMD_AI is stubbed to capture the package, so no network is needed).
 *
 * USAGE: node test/run-maik-about-me-ui.mjs [--shot <dir>]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8999/").replace(/\/?$/, "/");
const PORT = 9396, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-me-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT = (process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : "");
if (SHOT) mkdirSync(SHOT, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8999"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var e = document.querySelector(${JSON.stringify(sel)}); if (!e) return "missing"; e.click(); return 1;`);
async function shot(name) {
  if (!SHOT) return;
  const { result: { data } } = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOT, name + ".png"), Buffer.from(data, "base64")); console.log("   screenshot " + join(SHOT, name + ".png"));
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_AI)`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); localStorage.setItem("smd_device_id", "metest"); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);
  ok(await click("#maikMenu") === 1, "the sidebar opens"); await sleep(400);
  ok(await click("#maikSideMe") === 1, "the sidebar has an About me row"); await sleep(250);
  ok(await ev(`return !document.getElementById("maikMe").hidden && document.getElementById("maikSide").classList.contains("me-open");`) === true, "About me opens in the sidebar");
  const small = await ev(`return [].slice.call(document.querySelectorAll("#maikMe button")).filter(function (b) { return b.offsetHeight < 44; }).map(function (b) { return b.textContent; }).join(",");`);
  ok(small === "", `every control is at least 44px tall (${small || "all"})`);
  await shot("about-me-empty");

  await ev(`document.getElementById("maikMeSpec").value = "Internal Medicine"; return 1;`);
  await click('#maikMe [data-me="work"][data-v="ICU"]'); await click('#maikMe [data-me="work"][data-v="Ward"]');
  await click('#maikMe [data-me="guide"][data-v="Indian"]');
  await ev(`document.getElementById("maikMeNotes").value = "MRN 4455667 on bed 3"; return 1;`);
  await click("#maikMeSave"); await sleep(200);
  ok(/could identify a patient/.test(await ev(`return document.getElementById("maikMeErr").textContent;`)), "a patient identifier is refused, with the reason beside the field");
  ok(!(await ev(`return localStorage.getItem("smd_maik_me_d_metest");`)), "nothing is saved while it is refused");
  await ev(`document.getElementById("maikMeNotes").value = "District hospital; prefer NLEM drugs"; return 1;`);
  await shot("about-me-filled");
  await click("#maikMeSave"); await sleep(300);
  const saved = JSON.parse(await ev(`return localStorage.getItem("smd_maik_me_d_metest");`) || "{}");
  ok(saved.spec === "Internal Medicine" && saved.work.join() === "ICU,Ward" && saved.guide === "Indian" && /NLEM/.test(saved.notes), "Save stores it on this device, per account");
  ok(await ev(`return document.getElementById("maikMe").hidden;`) === true, "Save returns to the conversations");
  ok(await ev(`return document.getElementById("maikSideMeState").textContent;`) === "On", "the row shows it is on");
  await click("#maikSideMe"); await sleep(200);
  ok(await ev(`return document.getElementById("maikMeSpec").value + "|" + document.querySelector('#maikMe .maik-me-chip.on[data-me="guide"]').textContent;`) === "Internal Medicine|Indian", "reopening shows what was saved");
  await ev(`document.body.classList.add("dark"); return 1;`); await sleep(150); await shot("about-me-dark");
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await click("#maikMeBack"); await sleep(150);
  await click("#maikSideClose"); await sleep(400);

  // The next clinical question carries it.
  await ev(`window.__pkgs = []; var cap = function (pkg) { window.__pkgs.push(pkg); return Promise.resolve({ text: "Amlodipine is first line. Verify against local protocol." }); };
    window.SMD_AI.explainGrounded = cap; window.SMD_AI.explainGroundedStream = function (pkg, o, onDelta) { return cap(pkg); }; return 1;`);
  await ev(`var q = document.getElementById("maikQ"); q.value = "treatment of hypertension"; q.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("maikSend").click(); return 1;`);
  let doc = "";
  for (let i = 0; i < 40; i++) { await sleep(300); doc = await ev(`return (window.__pkgs[0] && window.__pkgs[0].doctor) || "";`); if (doc) break; }
  ok(/Speciality: Internal Medicine\. Works in: ICU, Ward\. Prefers Indian/.test(doc), `the next question carries the preferences ("${doc.slice(0, 70)}...")`);

  console.log(fails === 0 ? "\nALL GREEN: About me saves on the device and rides with every answer" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
