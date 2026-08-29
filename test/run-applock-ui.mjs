/* App Lock UI test (flag-gated: smd_applock, off by default). Verifies:
 *   - the flag is OFF by default (window.SMD_APPLOCK.required() is false, no gate) and
 *     ?applock=1 turns it on for the session,
 *   - promptSetup() renders exactly 3 options for a personal account (no hospital on file),
 *     and only 2 (PIN + biometric-if-available, no "no lock") for an institutional one,
 *   - choosing PIN round-trips: setting "1234" then reading it back with verifyPin succeeds,
 *     a wrong PIN fails, and 5 wrong attempts trips the lockout window,
 *   - choosing "no lock" only requires the risk checkbox before it can be confirmed,
 *   - biometric is correctly reported unavailable (no plugin installed on this build) and so
 *     never renders as an option,
 *   - once a PIN is configured and the flag is on, the boot splash's finish() hook actually
 *     HOLDS behind the unlock screen instead of revealing the app, and a correct PIN releases
 *     it (mirrors the fail-open contract test/run-splash-ui.mjs already holds the gate to),
 *   - no uncaught JS errors on any path.
 * USAGE: CHROME=/path/to/chrome node test/run-applock-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PORT = 9385;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/applock-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8993"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-sandbox", "--disable-gpu", "--mute-audio", "--hide-scrollbars"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0;
const ok = (c, m, got) => { console.log((c ? "PASS " : "FAIL ") + m + (c || got === undefined ? "" : "  [got: " + JSON.stringify(got) + "]")); if (!c) fails++; };
const okv = (v, want, m) => ok(v === want, m, v);

async function newTab() {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
}
async function fresh(url) {
  await ev(`localStorage.clear(); return 1;`);
  await call("Page.navigate", { url });
  await sleep(1500);
}

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params && m.params.exceptionDetails;
      errors.push((d && d.exception && d.exception.description) || (d && d.text) || "unknown");
    }
  };
  await newTab();

  /* ---------- 1. flag off by default, module loaded, fully inert ---------- */
  await fresh(BASE);
  ok(await ev(`return !!window.SMD_APPLOCK;`) === true, "window.SMD_APPLOCK is defined");
  okv(await ev(`return window.SMD_APPLOCK.isOn();`), false, "smd_applock is OFF by default");
  okv(await ev(`return window.SMD_APPLOCK.required();`), false, "required() is false when the flag is off");

  /* ---------- 2. ?applock=1 turns it on for the session ---------- */
  await fresh(BASE + "?applock=1");
  okv(await ev(`return window.SMD_APPLOCK.isOn();`), true, "?applock=1 turns the flag on");
  okv(await ev(`return window.SMD_APPLOCK.configured();`), false, "not configured until a method is chosen");
  okv(await ev(`return window.SMD_APPLOCK.method();`), "none", "method() defaults to \"none\" unconfigured");

  /* ---------- 3. setup chooser: personal account gets all 3 (minus biometric, unavailable) ---------- */
  await ev(`window.SMD_APPLOCK.promptSetup({hospital:""}); return 1;`);
  await sleep(150);
  okv(await ev(`return document.querySelectorAll("#smdApplock [data-m]").length;`), 2,
    "personal account: 2 options render (PIN + no-lock; biometric absent, no plugin installed)");
  ok(await ev(`return !!document.querySelector('#smdApplock [data-m="none"]');`) === true,
    "\"No lock\" option is offered for a personal account");
  ok(await ev(`return !document.querySelector('#smdApplock [data-m="biometric"]');`) === true,
    "biometric is correctly absent — canBiometric() reports false with no plugin installed");

  /* ---------- 4. institutional account: "no lock" must not even render ---------- */
  await fresh(BASE + "?applock=1");
  await ev(`window.SMD_APPLOCK.promptSetup({hospital:"AIIMS Delhi"}); return 1;`);
  await sleep(150);
  okv(await ev(`return document.querySelectorAll("#smdApplock [data-m]").length;`), 1,
    "institutional account: only PIN is offered (no biometric plugin, no lock hidden)");
  ok(await ev(`return !document.querySelector('#smdApplock [data-m="none"]');`) === true,
    "\"No lock\" is never offered once a hospital is on file — the whole point of the gate");

  /* ---------- 5. PIN set/verify round-trip + lockout ---------- */
  await fresh(BASE + "?applock=1");
  okv(await ev(`return window.SMD_APPLOCK.method();`), "none", "clean slate before PIN setup");
  const pinOk = await ev(`
    return new Promise(function(res){
      window.SMD_APPLOCK.promptSetup({hospital:""});
      setTimeout(function(){
        document.querySelector('[data-m="pin"]').click();
        setTimeout(function(){
          var i=document.getElementById("salSetupPin"); i.value="1234";
          document.getElementById("salSetupGo").click();
          setTimeout(function(){
            var i2=document.getElementById("salSetupPin"); i2.value="1234";
            document.getElementById("salSetupGo").click();
            setTimeout(function(){ res(window.SMD_APPLOCK.method()); }, 300);
          }, 150);
        }, 150);
      }, 150);
    });
  `);
  okv(pinOk, "pin", "PIN setup flow (enter 1234, confirm 1234) sets method to \"pin\"");
  okv(await ev(`return window.SMD_APPLOCK.required();`), true, "required() is true once a PIN is configured and the flag is on");

  // reload (fresh page = fresh _unlockedThisBoot) then verify wrong vs right PIN via the unlock screen
  await call("Page.navigate", { url: BASE + "?applock=1" });
  await sleep(1500);
  okv(await ev(`return window.SMD_APPLOCK.method();`), "pin", "PIN survives a reload (persisted to localStorage)");
  const wrongThenRight = await ev(`
    return new Promise(function(res){
      var unlockedAt = null;
      window.SMD_APPLOCK.unlock(function(){ unlockedAt = Date.now(); });
      var t0 = Date.now();
      setTimeout(function(){
        var i=document.getElementById("salUnlockPin"); i.value="0000";
        document.getElementById("salUnlockGo").click();
        setTimeout(function(){
          var stillUpAfterWrong = !!document.getElementById("salUnlockPin");
          var wrongUnlockedTooSoon = unlockedAt !== null;
          var i2=document.getElementById("salUnlockPin"); i2.value="1234";
          document.getElementById("salUnlockGo").click();
          setTimeout(function(){
            res(JSON.stringify({ stillUpAfterWrong: stillUpAfterWrong, wrongUnlockedTooSoon: wrongUnlockedTooSoon, unlockedByRight: unlockedAt !== null }));
          }, 250);
        }, 200);
      }, 150);
    });
  `);
  okv(wrongThenRight, JSON.stringify({ stillUpAfterWrong: true, wrongUnlockedTooSoon: false, unlockedByRight: true }),
    "wrong PIN is rejected (screen stays up, done() not called), correct PIN then unlocks");

  await call("Page.navigate", { url: BASE + "?applock=1" });
  await sleep(1500);
  const lockout = await ev(`
    return new Promise(function(res){
      window.SMD_APPLOCK.unlock(function(){});
      function fail(n){
        if(n>=5){ res(document.getElementById("salUnlockGo") ? document.getElementById("salUnlockGo").disabled : "no-btn"); return; }
        setTimeout(function(){
          var i=document.getElementById("salUnlockPin"); if(!i){res("input-gone");return;}
          i.value="0000"; document.getElementById("salUnlockGo").click();
          setTimeout(function(){ fail(n+1); }, 120);
        }, 120);
      }
      fail(0);
    });
  `);
  okv(lockout, true, "5 wrong PINs trip the lockout window (Unlock button disabled)");

  /* ---------- 6. "no lock" requires the risk checkbox ---------- */
  await fresh(BASE + "?applock=1");
  const riskGate = await ev(`
    return new Promise(function(res){
      window.SMD_APPLOCK.promptSetup({hospital:""});
      setTimeout(function(){
        document.querySelector('[data-m="none"]').click();
        setTimeout(function(){
          var before = document.getElementById("salRiskGo").disabled;
          document.getElementById("salRiskChk").click();
          document.getElementById("salRiskChk").dispatchEvent(new Event("change"));
          var after = document.getElementById("salRiskGo").disabled;
          res(JSON.stringify({before: before, after: after}));
        }, 150);
      }, 150);
    });
  `);
  okv(riskGate, JSON.stringify({ before: true, after: false }),
    "\"no lock\" Confirm is disabled until the risk checkbox is ticked");

  /* ---------- 7. no-lock actually clears the requirement ---------- */
  await ev(`document.getElementById("salRiskGo").click(); return 1;`);
  okv(await ev(`return window.SMD_APPLOCK.method();`), "none", "no-lock path sets method to \"none\"");
  okv(await ev(`return window.SMD_APPLOCK.required();`), false, "required() is false again once method is \"none\"");

  /* ---------- 8. end-to-end: the REAL boot splash finish() hook holds behind the lock ---------- */
  await ev(`localStorage.clear(); return 1;`);
  const setupForGate = await ev(`
    return new Promise(function(res){
      window.SMD_APPLOCK.promptSetup({hospital:""});
      setTimeout(function(){
        document.querySelector('[data-m="pin"]').click();
        setTimeout(function(){
          document.getElementById("salSetupPin").value="9999";
          document.getElementById("salSetupGo").click();
          setTimeout(function(){
            document.getElementById("salSetupPin").value="9999";
            document.getElementById("salSetupGo").click();
            setTimeout(function(){ res(window.SMD_APPLOCK.method()); }, 300);
          }, 150);
        }, 150);
      }, 150);
    });
  `);
  okv(setupForGate, "pin", "PIN configured ahead of the real boot-splash gate check");
  await call("Page.navigate", { url: BASE + "?applock=1" });
  await sleep(1300); // > MIN(900ms) so finish() has definitely been tried at least once
  ok(await ev(`var s=document.getElementById("smdBootSplash"); return !!s && !s.classList.contains("sbs-hide");`) === true,
    "the real boot splash HOLDS (not hidden) past MIN when a PIN is configured");
  ok(await ev(`return !!document.getElementById("smdApplock");`) === true,
    "the unlock screen is showing on top of the held boot splash");
  await ev(`document.getElementById("salUnlockPin").value="9999"; document.getElementById("salUnlockGo").click(); return 1;`);
  await sleep(700); // finish()'s own 480ms removal timeout
  ok(await ev(`return !document.getElementById("smdApplock");`) === true,
    "the unlock screen is gone after the correct PIN");
  ok(await ev(`var s=document.getElementById("smdBootSplash"); return !s || s.classList.contains("sbs-hide");`) === true,
    "the boot splash actually completes (hidden/removed) once unlocked");

  ok(errors.length === 0, "no uncaught JS errors (" + (errors.length ? errors.join(" | ") : "none") + ")");
} catch (e) {
  console.log("HARNESS ERROR: " + (e && e.stack || e));
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
console.log(fails === 0 ? "ALL PASS" : fails + " FAILED");
process.exit(fails === 0 ? 0 : 1);
