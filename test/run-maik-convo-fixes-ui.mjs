/* MaiK fixes from the owner's 2026-10-01 conversations, in the real app in headless Chrome.
 *
 * The model call is replaced by a canned answer (SMD_AI.explainGrounded*), so the REAL send path, the
 * REAL answer renderer and the REAL action row run. Checks:
 *   - a finished answer that says "does not contain" stays on screen (was replaced by the
 *     "I found limited StewardMD material" card),
 *   - a time + Copy / Edit icons sit under the clinician's prompt, and Edit puts the prompt back,
 *   - Save stores the answer under a topic and it is listed in the sidebar's "Saved answers",
 *   - an error answer gets "Try again" and no Copy/Regenerate row,
 *   - the AI Usage sheet leads with tokens left and has Refresh.
 *
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> node test/run-maik-convo-fixes-ui.mjs
 * Screenshots: $CLAUDE_JOB_DIR/tmp (or /tmp) maik-fixes-*.png
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const OUT = (process.env.CLAUDE_JOB_DIR ? process.env.CLAUDE_JOB_DIR + "/tmp" : "/tmp");
const PORT = 9394, userDir = OUT + "/maik-fixes-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore", detached: true });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/maik-fixes-${name}.png`, Buffer.from(r.result.data, "base64")); };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const ANSWER = "AJCC 8th does not contain a separate grade-only rule; staging uses T, N, M plus biomarkers.\n\n" +
  "| Profile | Grade 2 |\n|---|---|\n| Triple negative | IIB \\rightarrow IIIB |\n\n- **T2** is over 2 cm and up to 5 cm\n- N1 is 1 to 3 mobile nodes";
const STUB = (text, err) => `
  var r = ${err ? `{ error: "server_error" }` : `{ text: ${JSON.stringify(text)}, engine: "cloud" }`};
  SMD_AI.explainGrounded = function () { return Promise.resolve(r); };
  SMD_AI.explainGroundedStream = function (p, o, onDelta) { return Promise.resolve(r); };
  return 1;`;

try {
  let ver, tries = 0; while (tries++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_AI && window.SMD_MaiK)`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.setItem("smd_druglink_ask","0")}catch(e){} return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);
  await ev(STUB(ANSWER));
  await ev(`window.__calls=[]; var g=SMD_AI.explainGrounded, s=SMD_AI.explainGroundedStream; SMD_AI.explainGrounded=function(){__calls.push("g");return g.apply(this,arguments)}; SMD_AI.explainGroundedStream=function(){__calls.push("s");return s.apply(this,arguments)}; return 1;`);
  await ev(`document.getElementById("maikQ").value="What is the AJCC 8th prognostic stage of T2N1 grade 2 triple negative?"; document.getElementById("maikSend").click(); return 1;`);
  let answered = false;
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(`var a=document.querySelectorAll("#maikBody .maik-b.ai"); return a.length && /IIIB/.test(a[a.length-1].textContent) && !!a[a.length-1].querySelector(".maik-fb");`) === true) { answered = true; break; } }
  ok(answered, "the canned answer renders with its action row");
  console.log("   model calls seen: " + JSON.stringify(await ev(`return window.__calls;`)) + " | engine: " + await ev(`try{return SMD_MAIK_ENGINE.effective()}catch(e){return "?"}`));
  ok(await ev(`return !/limited StewardMD material/.test(document.getElementById("maikBody").textContent);`) === true, "an answer saying 'does not contain' is NOT replaced by the limited-material card");
  ok(await ev(`return !/\\\\rightarrow|\\*\\*/.test(document.getElementById("maikBody").textContent);`) === true, "no \\rightarrow or ** in the rendered answer");
  ok(await ev(`var r=document.querySelector("#maikBody .maik-you-acts"); return !!(r && r.querySelector(".maik-you-ts").textContent.trim() && r.querySelectorAll("button").length===2);`) === true, "time + Copy + Edit under the prompt");
  ok(await ev(`var b=document.querySelector("#maikBody .maik-b.you"); return !/Copy|Edit/.test(b.textContent);`) === true, "the prompt bubble's own text stays clean");
  await ev(`document.getElementById("maikQ").value=""; document.querySelector("#maikBody [data-maik-uedit]").click(); return 1;`); await sleep(200);
  ok(await ev(`return document.getElementById("maikQ").value;`) === "What is the AJCC 8th prognostic stage of T2N1 grade 2 triple negative?", "Edit puts the prompt back in the composer");
  await ev(`document.getElementById("maikQ").value=""; return 1;`);
  await shot("answer");
  await call("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 2, mobile: true }); await sleep(300);
  ok(await ev(`var a=[].slice.call(document.querySelectorAll("#maikBody .maik-acts .maik-act")); return a.length===4 && a.every(function(b){var r=document.createRange(); r.selectNodeContents(b); return b.scrollWidth<=b.clientWidth+1 && r.getClientRects().length===1;});`) === true, "320px: all four actions show their label on one line (2 x 2), none broken mid-word");
  console.log("   320px actions: " + await ev(`return JSON.stringify([].slice.call(document.querySelectorAll("#maikBody .maik-acts .maik-act")).map(function(b){var r=document.createRange(); r.selectNodeContents(b); return [b.textContent,b.clientWidth,b.scrollWidth,r.getClientRects().length,b.offsetTop];}));`));
  await ev(`var f=document.querySelector("#maikBody .maik-fb"); f.scrollIntoView({block:"center"}); return 1;`); await sleep(200);
  await shot("answer-320");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(300);

  // Save -> topic -> sidebar
  ok(await ev(`var b=[].slice.call(document.querySelectorAll("#maikBody .maik-fb-b")).filter(function(x){return x.textContent==="Save"})[0]; if(!b) return false; b.click(); return true;`) === true, "Save sits in the answer's action row");
  await sleep(200);
  await ev(`var i=document.querySelector("#maikBody .maik-save-in"); i.value="Breast staging"; document.querySelector("#maikBody .maik-save-ok").click(); return 1;`);
  await sleep(200);
  ok(await ev(`var k=Object.keys(localStorage).filter(function(k){return k.indexOf("smd_maik_saved_")===0})[0]; var a=JSON.parse(localStorage.getItem(k)||"[]"); return a.length===1 && a[0].topic==="Breast staging" && /IIIB/.test(a[0].html) && !/maik-fb/.test(a[0].html);`) === true, "the answer is stored under its topic, without its buttons");
  await shot("saved");
  await ev(`document.getElementById("maikMenu").click(); return 1;`); await sleep(500);
  ok(await ev(`return document.getElementById("maikSideSavedN").textContent;`) === "1", "the sidebar shows 1 saved answer");
  await ev(`document.getElementById("maikSideSaved").click(); return 1;`); await sleep(300);
  ok(await ev(`var p=document.getElementById("maikSaved"); return !p.hidden && /Breast staging/.test(p.textContent);`) === true, "Saved answers lists the topic");
  await ev(`var d=document.querySelector("#maikSaved .maik-sv-item"); d.open=true; return 1;`); await sleep(150);
  await shot("sidebar-saved");
  await ev(`document.querySelector("#maikSaved [data-sv-back]").click(); document.getElementById("maikSideClose").click(); return 1;`); await sleep(400);

  // Regenerate REPLACES the answer (2026-10-02: it used to stack a second bubble)
  await ev(STUB(ANSWER.replace("IIIB", "IIIB (regenerated)")));
  const nAns = await ev(`return document.querySelectorAll("#maikBody .maik-b.ai").length;`);
  await ev(`var a=document.querySelectorAll("#maikBody .maik-b.ai"), l=a[a.length-1]; [].slice.call(l.querySelectorAll(".maik-fb-b")).filter(function(b){return b.textContent==="Regenerate"})[0].click(); return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(400); if (await ev(`return /regenerated/.test(document.getElementById("maikBody").textContent);`) === true) break; }
  ok(await ev(`return /regenerated/.test(document.getElementById("maikBody").textContent);`) === true && await ev(`return document.querySelectorAll("#maikBody .maik-b.ai").length;`) === nAns, "Regenerate replaces the answer in place (no extra bubble)");

  // Error -> one bubble with Try again, no action row
  await ev(STUB("", true));
  await ev(`document.getElementById("maikQ").value="Now make ajcc 8th breast cancer staging easy"; document.getElementById("maikSend").click(); return 1;`);
  let errSeen = false;
  for (let i = 0; i < 30; i++) { await sleep(500); if (await ev(`var a=document.querySelectorAll("#maikBody .maik-b.ai"); var l=a[a.length-1]; return !!(l && /unavailable/i.test(l.textContent));`) === true) { errSeen = true; break; } }
  ok(errSeen, "the server error shows");
  ok(await ev(`var a=document.querySelectorAll("#maikBody .maik-b.ai"), l=a[a.length-1]; return !l.querySelector(".maik-fb") && [].slice.call(l.querySelectorAll("button")).some(function(b){return b.textContent==="Try again"});`) === true, "error bubble: Try again, no Copy/Regenerate/rating row");
  await ev(STUB("Recovered answer."));
  const nBefore = await ev(`return document.querySelectorAll("#maikBody .maik-b.ai").length;`);
  await ev(`var a=document.querySelectorAll("#maikBody .maik-b.ai"), l=a[a.length-1]; [].slice.call(l.querySelectorAll("button")).filter(function(b){return b.textContent==="Try again"})[0].click(); return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(400); if (await ev(`return /Recovered answer/.test(document.getElementById("maikBody").textContent);`) === true) break; }
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-b.ai").length;`) === nBefore && await ev(`return !/unavailable/i.test(document.getElementById("maikBody").textContent);`) === true, "Try again REPLACES the error bubble (no stacked errors)");
  await shot("retry");

  // AI Usage sheet
  await ev(`(function(){var f=window.fetch; window.fetch=function(u,o){ if(String(u).indexOf("/usage")>=0) return Promise.resolve(new Response(JSON.stringify({balanceMt:248000,tokensUsedMt:3400,req:12,tokens:41000,avgLatencyMs:6400,byModule:{maik:9,ocr:2,stt:1},limits:{maik:0,ocr:0,stt:0,ecg:0,tts:0},capsEnforced:false,costCapOn:true,dailyFreeMt:20000,updatedAt:new Date().toISOString(),resetsAt:new Date(Date.now()+3600e3).toISOString(),rates:{model:"gemini-2.5-flash",inPer1k:14,outPer1k:50,perImage:700,perAudioSec:40},packs:[{mt:50000,inr:49}]}),{status:200,headers:{"Content-Type":"application/json"}})); return f.apply(this,arguments);};})(); return 1;`);
  await ev(`try{document.querySelector(".maik-close,#maikClose").click()}catch(e){} return 1;`); await sleep(400);
  await ev(`var b=document.querySelector('[data-act="more"]'); if(b) b.click(); return !!b;`); await sleep(600);
  await ev(`var m=document.querySelector('[data-mi="aiusage"]'); if(m) m.click(); return !!m;`); await sleep(1200);
  ok(await ev(`var h=document.getElementById("aiUsageBody"); return !!h && /MaiK Tokens left/.test(h.textContent) && /248k/.test(h.textContent) && !!document.getElementById("aiuRefresh");`) === true, "AI Usage leads with tokens left and has Refresh");
  ok(await ev(`return /17k of 20k MT left/.test(document.getElementById("aiUsageBody").textContent);`) === true, "the free allowance says what is LEFT");
  await shot("usage");
} catch (e) {
  console.log("❌ harness error: " + (e && e.stack || e)); fails++;
} finally {
  try { process.kill(-chrome.pid, "SIGKILL"); } catch { try { chrome.kill("SIGKILL"); } catch {} }
  try { if (serveProc) serveProc.kill("SIGKILL"); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
