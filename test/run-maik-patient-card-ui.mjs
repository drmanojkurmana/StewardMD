/* A patient case in MaiK gets a choice card, and each choice works. Real headless browser, real app.
 *
 * Owner transcript 2026-09-27: "35year old male patient ... non-healing ulcer on leg with 450 RBS and
 * 72K platelets" got the same canned "Start Dx My Patient or Clinical Reasoning" text three times,
 * "Give me dd" and "???" included, and never an answer. Checked here, through the real send path:
 *   - the case alone gets the card (Start Case / Dx My Patient / Answer here / Answer, don't ask
 *     again) and costs no model call;
 *   - "Answer here" answers it; a second patient message in the same chat is answered directly;
 *   - "Give me dd" in a fresh chat is answered at once, no card;
 *   - a UHID never reaches the model; "don't ask again" sticks;
 *   - Start Case and Dx My Patient open their tools.
 * Model calls are counted and failed on purpose (no server here): the test checks that an answer was
 * ASKED FOR, with what text, not the answer itself.
 *
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> node test/run-maik-patient-card-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9394, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-ptcard-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const CASE = "35year old male patient with and a non-healing ulcer on leg with 450 RBS and 72K platelets";
const idle = async () => { for (let i = 0; i < 60; i++) { if (await ev(`var s=document.getElementById("maikSend"); return !!s && !s.classList.contains("stopping");`) === true) return; await sleep(250); } };
const ask = async (q) => { await idle(); await ev(`var q=document.getElementById("maikQ"); q.value=${JSON.stringify(q)}; q.dispatchEvent(new Event("input",{bubbles:true})); document.getElementById("maikSend").click(); return 1;`); await sleep(700); await idle(); };
const cards = () => ev(`return document.querySelectorAll("#maikBody .maik-ptask").length;`);
const calls = () => ev(`return window.__aiCalls;`);
const lastBody = () => ev(`return window.__aiBodies[window.__aiBodies.length - 1] || "";`);
const tap = async (sel) => { await ev(`var b=document.querySelector(${JSON.stringify(sel)}); if (b) b.click(); return !!b;`); await sleep(700); await idle(); };
const openMaik = async () => { await ev(`SMD_askMaik(""); return 1;`); await sleep(900); };
const newChat = async () => { await ev(`var n=document.getElementById("maikNew"); if (n) n.click(); return 1;`); await sleep(500); };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_askMaik`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try { localStorage.removeItem("smd_maik_ptask"); } catch (e) {} try { localStorage.setItem("smd_ai", "1"); if (window.SMD_AI && SMD_AI.setFlag) SMD_AI.setFlag(true); } catch (e) {} return 1;`);   // a fresh profile starts with MaiK switched off (same as the "Turn on MaiK" chip)
  await openMaik();
  ok(await ev(`return !!document.getElementById("maikBody");`) === true, "the MaiK sheet opens");
  ok(await ev(`return __MAIK_TEST.route(${JSON.stringify(CASE)}, null).kind;`) === "patient", "THE REPORTED MESSAGE routes as a patient case");
  // Count model calls and fail them on purpose: this test checks what was asked, not the answer.
  await ev(`window.__aiCalls = 0; window.__aiBodies = []; var _f = window.fetch; window.fetch = function (u, o) { if (String(u).indexOf("/api/ai") > -1) { window.__aiCalls++; window.__aiBodies.push(String(o && o.body || "")); return Promise.reject(new Error("offline in test")); } return _f.apply(this, arguments); }; return 1;`);
  // On a plain localhost page aiBase() is "" and every AI call stops as "ai-off"; point it at /api/ai (stubbed above).
  await ev(`window.AI_PROXY = "/api/ai"; try { localStorage.setItem("smd_ai", "1"); } catch (e) {} return 1;`);
  await newChat();

  // 1. The case on its own: the card, no model call, no canned redirect.
  await ask(CASE);
  ok(await cards() === 1, "the case gets the choice card");
  const labels = await ev(`return Array.prototype.map.call(document.querySelectorAll("#maikBody .maik-ptask button"), function (b) { return b.textContent.trim(); }).join(" | ");`);
  console.log("   buttons: " + labels);
  ok(labels === "Start Case | Dx My Patient | Answer here | Answer, don't ask again", "with Start Case, Dx My Patient, Answer here and Answer, don't ask again");
  ok(await calls() === 0, "showing the card costs no model call");
  ok(await ev(`return document.getElementById("maikBody").innerText.indexOf("I can help you assess this") < 0;`) === true, "the canned redirect text is gone");

  // 2. Answer here: the question goes to the model and the card's buttons go away.
  await tap('#maikBody .maik-ptask [data-maik-anyway]:not([data-maik-ptnoask])');
  ok(await calls() >= 1, `"Answer here" asks the model (${await calls()} call)`);
  ok((await lastBody()).includes("non-healing ulcer"), "with the doctor's case in the request");
  ok(await ev(`return !document.querySelector("#maikBody .maik-ptask .maik-dose-acts");`) === true, "and the card's buttons are cleared");

  // 3. Same chat, another patient message: answered directly, no second card.
  let before = await calls();
  await ask(CASE + "???");
  ok(await cards() === 1 && await calls() > before, "a second patient message in the same chat is answered, not carded again");

  // 4. Fresh chat, the case with "Give me dd": answered at once.
  await newChat(); before = await calls();
  await ask(CASE + " Give me dd");
  ok(await cards() === 0 && await calls() > before, '"Give me dd" is answered at once, no card');

  // 5. A UHID never reaches the model; "Answer, don't ask again" sticks.
  await newChat();
  await ask("UHID 4481123 " + CASE);
  ok(await cards() === 1, "a case with a UHID gets the card too");
  await tap('#maikBody .maik-ptask [data-maik-ptnoask]');
  const sent = await lastBody();
  ok(sent.includes("non-healing ulcer") && !sent.includes("4481123"), "the case is answered with the UHID stripped");
  ok(await ev(`return localStorage.getItem("smd_maik_ptask");`) === "0", "\"don't ask again\" is remembered");
  await newChat(); before = await calls();
  await ask(CASE);
  ok(await cards() === 0 && await calls() > before, "after that, a patient case is answered directly");

  // 6. The tool buttons open the real tools.
  await ev(`localStorage.removeItem("smd_maik_ptask"); return 1;`);
  await newChat(); await ask(CASE);
  await tap('#maikBody .maik-ptask [data-maik-tool="reasoning"]');
  ok(await ev(`return Array.prototype.some.call(document.querySelectorAll(".hv-sh-t"), function (t) { return t.textContent.trim() === "Dx My Patient" && t.getBoundingClientRect().height > 0; });`) === true, "Dx My Patient opens the Dx My Patient chooser");
  await ev(`var c=document.querySelector("[data-close]"); if (c) c.click(); return 1;`); await sleep(400);
  await openMaik(); await newChat(); await ask(CASE);
  await ev(`window.__caseOpened = false; var a=document.getElementById("modeAdvancedCard"); if (a) a.addEventListener("click", function () { window.__caseOpened = true; }, { once: true }); return 1;`);
  await tap('#maikBody .maik-ptask [data-maik-tool="startcase"]');
  ok(await ev(`var ms=document.getElementById("modeSelect"); return window.__caseOpened === true || !!(ms && !ms.classList.contains("hidden"));`) === true, "Start Case opens the case chooser");
} catch (e) {
  console.log("❌ harness error: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill("SIGKILL"); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS: a patient case in MaiK offers the tools and answers on request");
process.exit(fails ? 1 : 0);
