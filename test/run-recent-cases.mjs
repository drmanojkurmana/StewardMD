/* StewardMD — Recent Cases (rolling last-5 activity trail) test.
 *
 * Verifies the device-local Recent-Cases feature (recent.js + reasoning.js DX.restore +
 * the My Cases button injection in home.js):
 *  1) window.SMD_RECENT + DX.restore + SMD_openRecentCases are present.
 *  2) Working reasoning cases are recorded (title/summary/findings snapshot).
 *  3) Rolling cap of 5 — the oldest is auto-erased as new cases arrive.
 *  4) Upsert by caseId — one evolving case stays a single entry (no duplicates).
 *  5) The overlay renders the cards; tapping a reasoning card restores its findings.
 *  6) A "Recent Cases" button is injected into the My Cases panel.
 *
 * USAGE: node test/run-recent-cases.mjs      (exit 0 = pass, 1 = fail)
 * Requires the local static server (auto-spawned) + Chromium/Chrome.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8808/";
const CHROME = process.env.CHROME_BIN
  || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => existsSync(p))
  || "google-chrome";
const PORT = 9378;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/recent-chrome-prof";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8808";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(150); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--mute-audio", "--no-sandbox"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };

let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log("✅ " + n); } else { FAIL++; console.log("❌ " + n + (x ? " — " + x : "")); } };

try {
  let ver;
  for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("Network.enable", {});
  await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 50; i++) { await sleep(400); if (await ev(`return !!(window.DX&&window.DX.open&&window.SMD_RECENT&&window.SMD_openRecentCases)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("app / SMD_RECENT not loaded");

  ok("SMD_RECENT + DX.restore + overlay API present", await ev(`return !!(window.SMD_RECENT && window.SMD_RECENT.record && window.DX.restore && window.SMD_openRecentCases)`));

  await ev(`window.SMD_RECENT.clear(); DX.openWorkspace(); return 1;`); await sleep(300);
  await ev(`DX.restore({findings:{fever:1,neckStiffness:1,alteredSensorium:1,headache:1}}); return 1;`); await sleep(300);
  await ev(`DX.restore({findings:{chestPain:1,dyspnea:1,tachycardia:1}}); return 1;`); await sleep(300);
  await ev(`DX.restore({findings:{alteredSensorium:1,hypertensionHx:1,visualDisturbance:1,headache:1}}); return 1;`); await sleep(300);

  const list = JSON.parse(await ev(`return JSON.stringify(window.SMD_RECENT.get());`));
  ok("reasoning cases recorded with snapshot", list.length === 3 && list[0].feature === "reasoning" && list[0].title && list[0].snapshot && list[0].snapshot.findings, "got " + list.length);

  for (let i = 0; i < 4; i++) await ev(`window.SMD_RECENT.record({caseId:"x${i}",feature:"decision",title:"Case ${i}",summary:"t",snapshot:{findings:{fever:1}}}); return 1;`);
  const capped = JSON.parse(await ev(`return JSON.stringify(window.SMD_RECENT.get());`));
  ok("rolling cap of 5 — oldest auto-erased", capped.length === 5, "got " + capped.length);
  ok("newest floats to top", capped[0].caseId === "x3", capped.map(c => c.caseId).join(","));

  await ev(`window.SMD_RECENT.record({caseId:"x3",feature:"decision",title:"Case 3 UPDATED",summary:"t2",snapshot:{findings:{fever:1}}}); return 1;`);
  const up = JSON.parse(await ev(`return JSON.stringify(window.SMD_RECENT.get());`));
  ok("upsert by caseId — one entry, not duplicated", up.length === 5 && up.filter(c => c.caseId === "x3").length === 1 && up[0].title === "Case 3 UPDATED");

  await ev(`window.SMD_openRecentCases(); return 1;`); await sleep(300);
  const ui = JSON.parse(await ev(`var ov=document.getElementById("smdRecentOv"); return JSON.stringify({open:ov&&ov.classList.contains("on"),cards:document.querySelectorAll("#rcList .rc-card").length});`));
  ok("overlay opens and lists 5 cards", ui.open && ui.cards === 5, JSON.stringify(ui));

  await ev(`document.getElementById("smdRecentOv").classList.remove("on"); return 1;`);
  const rid = (up.find(c => c.feature === "reasoning") || {}).caseId;
  if (rid) {
    await ev(`window.SMD_RECENT.open(${JSON.stringify(rid)}); return 1;`); await sleep(400);
    const restored = JSON.parse(await ev(`return JSON.stringify(Object.keys(DX._state.f));`));
    ok("tapping a reasoning card restores its findings", restored.length >= 3, restored.join(","));
  }

  if (typeof await ev(`return typeof window.openMyCases;`) === "string") {
    await ev(`try{window.openMyCases();}catch(e){} return 1;`); await sleep(500);
    ok("'Recent Cases' button injected into My Cases", await ev(`return !!document.getElementById("smdRecentCasesBtn");`) === true);
  } else {
    console.log("ℹ️  openMyCases unavailable in this build — button-injection check skipped");
  }

  console.log("\n" + (FAIL === 0 ? "ALL GREEN — Recent Cases (" + PASS + " checks)" : FAIL + " FAILED, " + PASS + " passed"));
  if (FAIL > 0) process.exitCode = 1;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
