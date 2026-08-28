/* BUG (2026-08-23, user report: "update settings ... checkupdate or automatic updates" not
 * findable in Settings). Root cause: the OTA Settings UI (Automatic updates toggle, Check for
 * updates, Download & install) has existed in home.js since before the 1 Aug OTA teardown, but
 * home.js's whole Settings-group builder stands down the moment sidebar-redesign.js sets
 * window.SMD_SBR - which it always does (unconditionally loaded in index.html). So that UI has
 * never actually rendered anywhere a doctor could reach it. Rebuilt in sidebar-redesign.js's real,
 * live Settings page (window.SMD_openSettings) instead.
 * USAGE: node test/run-settings-ota.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8924/").replace(/\/?$/, "/");
const PORT = 9459, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/settings-ota-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8924"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return document.body.classList.contains("ui-v2") && !!window.SMD_openSettings;`) === true) { ready = true; break; } }
  ok(ready, "app boots (sidebar-redesign.js loaded, window.SMD_openSettings present)");
  ok(await ev(`return window.SMD_SBR === true;`) === true, "confirms the actual failure mode: SMD_SBR is set, so home.js's Settings builder stands down");

  // ---- Case 1: no OTA plugin at all (plain web / native-without-plugin-yet) — section absent, no crash ----
  const noPlugin = await J(`
    window.SMD_openSettings();
    var ov = document.getElementById("sbrSettings");
    var sec = Array.prototype.map.call(ov.querySelectorAll(".sbr-sec"), function(e){return e.textContent;});
    return JSON.stringify({ hasSettingsPage: !!ov, sections: sec, hasOtaCheck: !!ov.querySelector("#otaCheck") });
  `);
  ok(noPlugin.hasSettingsPage === true, "Settings page opens via window.SMD_openSettings()");
  ok(!noPlugin.sections.includes("Software Update") && noPlugin.hasOtaCheck === false, "with no OTA plugin, the section is absent entirely (not shown broken)");

  // ---- Case 2: OTA available — the section renders where a doctor can actually find it ----
  await ev(`
    window.SMD_OTA = {
      available: function(){ return true; },
      isAuto: function(){ return false; },
      setAuto: function(v){ window.__autoSet = v; },
      currentVersion: function(){ return "12"; },
      check: function(){ return Promise.resolve({ status: "available", version: 13 }); },
      install: function(pending, onProgress){ onProgress(50); return Promise.resolve({ ok: true }); }
    };
    return 1;
  `);
  const withPlugin = await J(`
    window.SMD_openSettings();
    var ov = document.getElementById("sbrSettings");
    var sec = Array.prototype.map.call(ov.querySelectorAll(".sbr-sec"), function(e){return e.textContent;});
    return JSON.stringify({ sections: sec, statusText: ov.querySelector("#otaStatus").textContent, hasCheck: !!ov.querySelector("#otaCheck"), hasInstall: !!ov.querySelector("#otaInstall"), installHidden: ov.querySelector("#otaInstall").style.display === "none" });
  `);
  ok(withPlugin.sections.includes("Software Update"), `a "Software Update" section appears in the real Settings page (${JSON.stringify(withPlugin.sections)})`);
  ok(withPlugin.statusText === "Version 12", `shows the current version (got "${withPlugin.statusText}")`);
  ok(withPlugin.hasCheck && withPlugin.hasInstall, "Check for updates and Download & install controls are both present");
  ok(withPlugin.installHidden === true, "Download & install starts hidden until a check finds something");

  // ---- Automatic-updates toggle actually calls SMD_OTA.setAuto ----
  const toggled = await J(`
    var sw = document.querySelector("[data-ota-auto]"); sw.click();
    return JSON.stringify({ autoSet: window.__autoSet, on: sw.classList.contains("on") });
  `);
  ok(toggled.autoSet === true && toggled.on === true, `tapping Automatic updates calls SMD_OTA.setAuto(true) and flips the switch visually (${JSON.stringify(toggled)})`);

  // ---- Check for updates → finds one → reveals Download & install with the right status ----
  await ev(`document.getElementById("otaCheck").click(); return 1;`);
  await sleep(200);
  const afterCheck = await J(`
    return JSON.stringify({ status: document.getElementById("otaStatus").textContent, installShown: document.getElementById("otaInstall").style.display !== "none" });
  `);
  ok(/available.*13/i.test(afterCheck.status), `Check for updates surfaces the found version (got "${afterCheck.status}")`);
  ok(afterCheck.installShown === true, "...and reveals Download & install");

  // ---- Download & install → progress text → success ----
  await ev(`document.getElementById("otaInstall").click(); return 1;`);
  await sleep(200);
  const afterInstall = await J(`return JSON.stringify({ status: document.getElementById("otaStatus").textContent });`);
  ok(/ready/i.test(afterInstall.status), `Download & install reaches "ready" (got "${afterInstall.status}")`);

  console.log(fails === 0 ? "\nALL GREEN — Software Update settings actually reachable in the live sidebar Settings page" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
