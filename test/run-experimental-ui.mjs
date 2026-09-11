import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8925/").replace(/\/?$/, "/");
const PORT = 9460, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/settings-exp-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8925"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
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
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return document.body.classList.contains("ui-v2") && !!window.SMD_openSettings && !!window.SMD_openExperimental;`) === true) { ready = true; break; } }
  ok(ready, "app boots with window.SMD_openSettings and window.SMD_openExperimental");

  // Step 1: Open Settings and check sections
  const settingsCheck = await J(`
    window.SMD_openSettings();
    var ov = document.getElementById("sbrSettings");
    var sec = Array.prototype.map.call(ov.querySelectorAll(".sbr-sec"), function(e){return e.textContent;});
    var expBtn = ov.querySelector('[data-sbr-act="experimental"]');
    return JSON.stringify({
      hasSettings: !!ov,
      sections: sec,
      hasExpBtn: !!expBtn,
      expBtnLabel: expBtn ? expBtn.querySelector(".sbr-lbl").textContent : null
    });
  `);
  ok(settingsCheck.hasSettings, "Settings screen opens");
  ok(settingsCheck.sections.includes("Advanced"), "Settings includes 'Advanced' section");
  ok(settingsCheck.sections.includes("Experimental"), "Settings includes dedicated 'Experimental' section");
  ok(settingsCheck.hasExpBtn, "Settings has an 'Experimental Features' row button");
  ok(settingsCheck.expBtnLabel === "Experimental Features", `Experimental row label is correct (got "${settingsCheck.expBtnLabel}")`);

  // Step 2: Tap the Experimental row -> opens the dedicated Experimental screen
  const navToExp = await J(`
    var btn = document.querySelector('[data-sbr-act="experimental"]');
    btn.click();
    var exp = document.getElementById("sbrExperimental");
    var sec = exp ? Array.prototype.map.call(exp.querySelectorAll(".sbr-sec"), function(e){return e.textContent;}) : [];
    var callout = exp ? exp.querySelector(".sbr-callout") : null;
    var xaRows = exp ? exp.querySelectorAll(".sbr-xa-row").length : 0;
    var toggles = exp ? exp.querySelectorAll("[data-sbr-tg]").length : 0;
    return JSON.stringify({
      hasExpScreen: !!exp,
      sections: sec,
      hasCallout: !!callout,
      calloutText: callout ? callout.textContent : "",
      xaRowCount: xaRows,
      toggleCount: toggles,
      title: exp ? exp.querySelector("h2").textContent : ""
    });
  `);
  ok(navToExp.hasExpScreen, "Tapping Experimental opens dedicated #sbrExperimental overlay");
  ok(navToExp.title === "Experimental", `Page title is "Experimental" (got "${navToExp.title}")`);
  ok(navToExp.hasCallout, "Clinical disclaimer callout banner is present");
  ok(/Beta & Research Features/i.test(navToExp.calloutText), "Callout text highlights beta & research status");
  ok(navToExp.xaRowCount === 4, `4 Private Beta Access Code rows present (got ${navToExp.xaRowCount})`);
  ok(navToExp.toggleCount >= 10, `All experimental switches present (got ${navToExp.toggleCount})`);
  ok(navToExp.sections.includes("Private Beta Access Codes"), "Has Private Beta Access Codes section");
  ok(navToExp.sections.includes("AI Diagnostic Modules"), "Has AI Diagnostic Modules section");
  ok(navToExp.sections.includes("Clinical Intelligence & Skills"), "Has Clinical Intelligence & Skills section");
  ok(navToExp.sections.includes("Voice & Protocols"), "Has Voice & Protocols section");
  ok(navToExp.sections.includes("Diagnostics"), "Has Diagnostics section");

  // Step 3: Back button in Experimental returns to Settings
  const backNav = await J(`
    var exp = document.getElementById("sbrExperimental");
    var backBtn = exp.querySelector("[data-sexp=close]");
    backBtn.click();
    var expGone = !document.getElementById("sbrExperimental");
    var setStillThere = !!document.getElementById("sbrSettings");
    return JSON.stringify({ expGone: expGone, setStillThere: setStillThere });
  `);
  ok(backNav.expGone, "Back button closes #sbrExperimental");
  ok(backNav.setStillThere, "Settings overlay remains underneath");

  // Step 4: Test standalone open via window.SMD_openExperimental()
  await ev(`document.querySelector("[data-sset=close]").click();`);
  const directExp = await J(`
    window.SMD_openExperimental();
    var exp = document.getElementById("sbrExperimental");
    return JSON.stringify({ hasExp: !!exp });
  `);
  ok(directExp.hasExp, "window.SMD_openExperimental() works directly");

  // Step 5: Test toggling an experimental switch inside Experimental
  const toggleTest = await J(`
    var exp = document.getElementById("sbrExperimental");
    var clinixSw = exp.querySelector('[data-sbr-tg="clinix"]');
    var initOn = clinixSw.classList.contains("on");
    clinixSw.click();
    var afterOn = clinixSw.classList.contains("on");
    var storageVal = localStorage.getItem("smd_clinix");
    return JSON.stringify({ initOn: initOn, afterOn: afterOn, storageVal: storageVal });
  `);
  ok(toggleTest.afterOn !== toggleTest.initOn, "Toggling CliniX flips the switch");
  ok(toggleTest.storageVal === (toggleTest.afterOn ? "1" : "0"), `Updates localStorage correctly (got "${toggleTest.storageVal}")`);

  // Step 6: Test Access Code Gate button invokes SMD_XACCESS
  const xaGateTest = await J(`
    window.__openedGateFeat = null;
    window.SMD_XACCESS = window.SMD_XACCESS || {};
    window.SMD_XACCESS.openGate = function(feat) { window.__openedGateFeat = feat; };
    var exp = document.getElementById("sbrExperimental");
    var btn = exp.querySelector('[data-xa-open="fundx"]');
    btn.click();
    return JSON.stringify({ gateOpened: window.__openedGateFeat });
  `);
  ok(xaGateTest.gateOpened === "fundx", `Clicking Enter Code for FundX invokes SMD_XACCESS.openGate("fundx") (got "${xaGateTest.gateOpened}")`);

  console.log(fails === 0 ? "\nALL GREEN — Experimental Settings UI and contents verified in headless Chrome!" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
