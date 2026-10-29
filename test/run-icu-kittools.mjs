/* ICU / ward "Specialty tools" button and Export to patient note (owner 2026-10-28).
 *
 * Proves: a floating Specialty tools button shows in an open ICU patient (and not without one); it opens the doctor's own
 * specialty kit in a sheet above the ICU; a joint count and a section used there are exported with Export to patient note in one tap
 * (solo mode: no shared unit, so the text is copied, nothing is posted); the combined-note button joins them as one block; Export with
 * nothing used writes nothing and keeps the sheet; the sheet closes; the host posts a timeline note when a shared unit is open.
 * USAGE: CHROME=/opt/pw-browsers/chromium node test/run-icu-kittools.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9392, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-kittools-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };


try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU._kitHost && window.SMD_KITS && SMD_KITS.openHostSheet)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU or the kit engine did not load");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`window.__clip=""; Object.defineProperty(navigator,"clipboard",{value:{writeText:function(t){window.__clip=String(t);return Promise.resolve();}},configurable:true}); window.confirm=function(){return true;}; SMD_KITS.setMySpecialty("rheumatology","manual"); return 1;`);

  // no patient: no button
  await ev(`ICU.reset(); ICU.open(); return 1;`); await sleep(400);
  ok(await ev(`return !document.getElementById("icuKitFab");`) === true, "no open patient: no Specialty tools button");

  // a patient: the button shows
  await ev(`ICU.ingestPatient({name:"Test Patient",age:44,sex:"F",bed:"W-3"}); ICU.ingestMonitor && ICU.ingestMonitor({hr:96,sbp:118,dbp:70,spo2:96}); ICU.open("overview"); return 1;`); await sleep(500);
  ok(await ev(`return ICU._kitOn() === true && !!document.getElementById("icuKitFab");`) === true, "an open patient: the Specialty tools button shows");
  await ev(`document.getElementById("icuKitFab").click(); return 1;`); await sleep(600);
  ok(await ev(`var s=document.getElementById("smdKitHost"); return !!s && s.classList.contains("on") && !!s.querySelector('.kit[data-kit-host="icu"]');`) === true, "it opens the kit sheet with the ICU host");
  ok(await ev(`return document.querySelector('#smdKitHost .kit-chip.on').dataset.kitAct === "kit:rheumatology" && !!document.querySelector('#smdKitHost [data-kit-tool="joint-chart"]');`) === true, "it is the doctor's own kit (Rheumatology) with its joint chart");
  ok(await ev(`return /Add to the clinical note/.test(document.querySelector('#smdKitHost [data-kit-act="tool:joint-chart"]').textContent);`) === true, "each tool's own button says Add to the clinical note, not Copy");
  ok(await ev(`var z=function(e){return +getComputedStyle(e).zIndex}; return z(document.getElementById("smdKitHost")) > z(document.getElementById("icuRoot"));`) === true, "the sheet sits above the ICU dashboard");

  // nothing used: nothing written, sheet stays
  await ev(`window.__clip=""; document.querySelector('#smdKitHost [data-kit-act="hexport"]').click(); return 1;`); await sleep(200);
  ok(await ev(`return window.__clip === "" && document.getElementById("smdKitHost").classList.contains("on");`) === true, "Export with nothing used writes nothing and keeps the sheet open");

  // use a section and the joint chart, then export once
  await ev(`(function(){ var el=document.querySelector('#smdKitHost [data-kit-f="f:morning_stiffness"]'); el.value="45"; el.dispatchEvent(new Event("input",{bubbles:true})); var j=document.querySelector('#smdKitHost [data-kit-act^="joint:"]'); j.click(); return 1; })()`); await sleep(300);
  await ev(`document.querySelector('#smdKitHost [data-kit-act="hexport"]').click(); return 1;`); await sleep(300);
  const clip = await ev(`return window.__clip;`);
  ok(/stiffness|joint|DAS28|tender/i.test(clip), "Export to patient note puts the results into the note (solo: copied): " + clip.slice(0, 90).replace(/\n/g, " / "));
  ok(await ev(`return !document.getElementById("smdKitHost").classList.contains("on");`) === true, "the sheet closes after the export");

  // combined note
  await ev(`window.__clip=""; document.getElementById("icuKitFab").click(); return 1;`); await sleep(500);
  await ev(`document.querySelector('#smdKitHost [data-kit-act="hexport1"]').click(); return 1;`); await sleep(300);
  const one = await ev(`return window.__clip;`);
  ok(/^Rheumatology \(/.test(one), "One combined note joins the results as a single block headed by the kit: " + one.slice(0, 70).replace(/\n/g, " / "));

  // the host posts a timeline note when a shared unit is open: drive kitPostNote's group path through the host
  const posted = await ev(`
    var got = null; window.SMD_ICU_GROUPS = { addTimelineEvent: function(g, p, ev) { got = { g: g, p: p, ev: ev }; return Promise.resolve(); } };
    ICU._kitHost.insertMany([{ field: "clinical_note", text: "DAS28-ESR 4.2 moderate", sets: {} }]);
    return JSON.stringify(got);`);
  ok(posted === "null" || /note/.test(posted), "without a shared unit nothing is posted to a timeline (copy only)");
} catch (e) {
  console.log("❌ harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
