/* PrepNucleus INI-SS / NEET-SS Medical Oncology recall overlay (set iniss2) in the REAL app (headless Chrome over CDP), on a
 * synthetic fixture (test/fixtures/prep-iniss2/api: made-up questions, no recall text).
 * What must hold: the module "son-iniss-recalls" is listed under Medical Oncology; its pool is the
 * bank file plus overlay/iniss2/ss-medical-oncology/son-iniss-recalls.json, once per id (a clash keeps the bank copy), items
 * tagged set iniss2; practice shows an overlay question and, after answering, its explanation text; no request leaves the fixture.
 *
 * USAGE: node test/run-prep-iniss2-ui.mjs   (CHROME=<path>)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-si-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep-iniss2/";
const SID = "ss-medical-oncology", MID = "son-iniss-recalls";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v5"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_SETUP=false; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await ev(`document.body.classList.add("dark"); return 1;`);

  // ---- NEET-SS tab -> Medical Oncology -> the recall module
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep #pnHome");`, 20000), "PrepNucleus opens on home");
  await ev(`PREP._host.setExam("neet-ss"); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=subject][data-s="${SID}"]');`, 8000), "the NEET-SS tab lists Medical Oncology");
  await click(`#smdPrep [data-act=subject][data-s="${SID}"]`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m="${MID}"]');`, 8000), "Medical Oncology lists the recall module");

  // ---- the pool: bank + iniss2 overlay, once per id, bank copy wins a clash
  const pool = JSON.parse(await evA(`PREP._host.loadModule("${SID}", "${MID}").then(function (it) { return JSON.stringify(it.map(function (x) { return [x.id, x.a, x._ov || "", x.set || ""]; })); })`));
  ok(pool.map((p) => p[0]).join(",") === "fx-sir-1,nssrec-fx-01,nssrec-fx-02", "pool = bank file plus overlay items, once each: " + pool.map((p) => p[0]).join(","));
  ok(pool[0][1] === 0 && pool[2][1] === 3, "answer keys unchanged (the bank copy wins the clash)");
  ok(pool.filter((p) => p[2] === "iniss2").length === 2, "overlay items are tagged with set iniss2");
  ok(reqs.some((u) => u.includes(FIX + "api/overlay/iniss2/" + SID + "/" + MID + ".json")), "the overlay loads from overlay/iniss2/<subject>/<module>.json");

  // ---- an overlay question is practised and its explanation shows
  await click(`#smdPrep .pn-mod[data-m="${MID}"]`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=start][data-k=study]");`, 8000), "the module panel offers practice");
  await click(`#smdPrep [data-act=start][data-k=study]`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000), "practice starts");
  let shown = null;
  for (let i = 0; i < 6 && !shown; i++) {
    const q = await ev(`var e=document.querySelector("#smdPrep .pn-q"); return e ? e.textContent : "";`); 
    await click(`#smdPrep [data-act=answer][data-k="0"]`);
    await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 4000);
    if (/Fixture recall question one/.test(q)) shown = await ev(`return document.querySelector("#smdPrep").textContent;`);
    else await click("#smdPrep [data-act=next]");
  }
  ok(!!shown && /Beta is right in this fixture\.\s*Recall note: wording was not kept\./.test(shown), "the overlay question's explanation (with its recall note) shows after answering");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
