/* test/run-connect-agent-boot-ui.mjs - Headless Chrome CDP test for connect-agent-boot.js
 *
 * Verifies:
 * 1. Page loads with zero console errors and zero uncaught exceptions.
 * 2. With the flag OFF, the boot module publishes no entry point, the More sheet has no Connect Hospital
 *    row, and the onboarding UI is not loaded.
 * 3. With the flag ON (set via localStorage), the boot module publishes its opener, the More sheet
 *    offers a "Connect Hospital" row, and clicking it lazily loads the onboarding UI and opens it.
 * 4. Error reporting from client-errors.js still functions (trigger a caught test error
 *    and assert its existing handler ran).
 *
 * Usage: node test/run-connect-agent-boot-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8794;
const DBG = 9386;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/connect-agent-boot-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) {
  try {
    await fetch(BASE);
    break;
  } catch {
    await sleep(200);
  }
}

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${DBG}`,
  `--user-data-dir=${userDir}`,
  "--no-first-run",
  "--disable-gpu",
  "--mute-audio"
], { stdio: "ignore" });

let msgId = 1;
const pending = new Map();
let ws, sessionId;
const consoleErrors = [];

const call = (m, p) => {
  const i = msgId++;
  return new Promise(r => {
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId }));
  });
};

const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true,
    awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fails++;
};

async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    const ready = await ev(`return document.readyState === "complete";`);
    if (ready === true) return true;
  }
  return false;
}

try {
  let ver, t = 0;
  while (t++ < 60) {
    try {
      ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }

  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params && m.params.type === "error") {
      consoleErrors.push((m.params.args || []).map(a => a.value || a.description || "").join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push("EXCEPTION: " + (((m.params || {}).exceptionDetails || {}).text || "thrown"));
    }
  };

  // 1. Load page with flag OFF (clean state)
  const loaded = await attach(BASE + "index.html");
  ok(loaded, "index.html loaded successfully");

  // Ensure clean slate (no flag set)
  await ev(`localStorage.removeItem("smd_connect_agent"); localStorage.removeItem("CONNECT_AGENT_FLAG"); return 1;`);
  await sleep(1500); // let any delayed timer (1200ms) fire

  // Check 1: zero console errors and zero uncaught exceptions
  ok(consoleErrors.length === 0, "page loads with zero console errors and zero uncaught exceptions" + (consoleErrors.length ? " -> " + JSON.stringify(consoleErrors) : ""));

  // Check 2: with flag OFF the boot module publishes nothing, so no entry point can exist anywhere
  // and the onboarding UI is not loaded. (There is no floating launcher pill any more - the entry
  // point is the "Connect Hospital" row in the More sheet, rendered by home.js only when the boot
  // module has published SMD_CONNECT_AGENT_BOOT. The pill was a test-console leftover that
  // duplicated the real control and read as debug UI to a doctor.)
  const bootAbsent = await ev(`return typeof window.SMD_CONNECT_AGENT_BOOT === "undefined";`);
  const uiScriptAbsent = await ev(`return document.querySelector('script[src*="connect-agent-onboarding.js"]') === null && typeof window.SMD_CONNECT_AGENT === "undefined";`);
  ok(bootAbsent === true && uiScriptAbsent === true, "with the flag OFF the boot module publishes no entry point and the onboarding UI is not loaded");

  const rowAbsentOff = await ev(`
    var more = [].slice.call(document.querySelectorAll("button,a,[role=button]")).filter(function (b) {
      // Match the aria-label, not the text: the nav tab renders an icon ligature plus the label, so
      // its textContent is "more_horizMore", which an exact text match never hits.
      return (b.getAttribute("aria-label") || "").trim().toLowerCase() === "more";
    })[0];
    if (more) more.click();
    return document.querySelector('[data-mi="agentconnect"]') === null;
  `);
  ok(rowAbsentOff === true, "with the flag OFF the More sheet has no Connect Hospital row");

  // Check 3: with the flag ON, the boot module publishes its opener and the More sheet offers the row
  await ev(`localStorage.setItem("smd_connect_agent", "1"); return 1;`);
  await call("Page.navigate", { url: BASE + "index.html" });

  let bootReady = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await ev(`return !!(window.SMD_CONNECT_AGENT_BOOT && window.SMD_CONNECT_AGENT_BOOT.enabled);`) === true) { bootReady = true; break; }
  }
  ok(bootReady, "with the flag ON (localStorage smd_connect_agent=1) the boot module publishes its opener");

  // Open the More sheet ONCE - clicking it again toggles it shut, so polling must not re-click.
  await ev(`
    var more = [].slice.call(document.querySelectorAll("button,a,[role=button]")).filter(function (b) {
      // Match the aria-label, not the text: the nav tab renders an icon ligature plus the label, so
      // its textContent is "more_horizMore", which an exact text match never hits.
      return (b.getAttribute("aria-label") || "").trim().toLowerCase() === "more";
    })[0];
    if (more) more.click();
    return !!more;
  `);
  let rowAppeared = false;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const found = await ev(`
      var row = document.querySelector('[data-mi="agentconnect"]');
      return !!(row && row.innerText.indexOf("Connect Hospital") >= 0);
    `);
    if (found === true) { rowAppeared = true; break; }
  }
  ok(rowAppeared, "the More sheet offers a Connect Hospital row a doctor can find");

  // Clicking the row lazily loads the onboarding UI and opens the sheet - the real doctor path.
  const clickOk = await ev(`
    var row = document.querySelector('[data-mi="agentconnect"]');
    if (!row) return false;
    row.click();
    return true;
  `);
  let uiLoaded = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const ui = await ev(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`);
    if (ui === true) {
      uiLoaded = true;
      break;
    }
  }
  ok(clickOk && uiLoaded, "clicking Connect Hospital loads connect-agent-onboarding.js and opens the sheet");

  // Close the sheet
  await ev(`if (window.SMD_CONNECT_AGENT && window.SMD_CONNECT_AGENT.close) window.SMD_CONNECT_AGENT.close(); return 1;`);

  // Check 4: error reporting from client-errors.js still functions
  // Install an interceptor on fetch for /api/clientlog to capture posted telemetry
  await ev(`
    window.__clientLogs = [];
    var origFetch = window.fetch;
    window.fetch = function (url, opts) {
      if (typeof url === "string" && url.indexOf("/api/clientlog") !== -1) {
        try { window.__clientLogs.push(JSON.parse(opts.body)); } catch (x) { window.__clientLogs.push(opts.body); }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return origFetch.apply(this, arguments);
    };
    return 1;
  `);

  // Trigger caught error reporting via SMD_logError
  await ev(`
    window.SMD_logError("test caught error from harness", "Error: test stack\\n    at test.js:1:1");
    return 1;
  `);
  await sleep(300);

  const loggedWarn = await ev(`
    var logs = window.__clientLogs || [];
    return logs.length > 0 && logs[0].message === "test caught error from harness" && logs[0].level === "warn";
  `);
  ok(loggedWarn === true, "error reporting from client-errors.js still functions (SMD_logError posted telemetry)");

  // Trigger error event and assert global error handler ran
  await ev(`
    window.dispatchEvent(new ErrorEvent("error", {
      message: "global test error caught",
      filename: "test-file.js",
      lineno: 99,
      colno: 3
    }));
    return 1;
  `);
  await sleep(300);

  const loggedError = await ev(`
    var logs = window.__clientLogs || [];
    return logs.some(function (r) { return r && r.message === "global test error caught" && r.level === "error"; });
  `);
  ok(loggedError === true, "error reporting from client-errors.js still functions (global error listener caught error)");

  // Clean up localStorage flag so we leave clean state
  await ev(`localStorage.removeItem("smd_connect_agent"); return 1;`);

  console.log(fails === 0 ? "\nALL GREEN - connect-agent-boot UI test passed" : `\n${fails} FAILED`);
} catch (e) {
  console.error("HARNESS ERROR:", e && e.message);
  fails++;
} finally {
  try {
    ws && ws.close();
  } catch {}
  chrome.kill();
  serveProc.kill();
  process.exit(fails === 0 ? 0 : 1);
}
