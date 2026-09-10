/* test/run-connect-agent-onboarding-ui.mjs - Headless Chrome CDP test for
 * connect-agent-onboarding.js (the doctor-facing Connect Agent onboarding UI).
 *
 * Same pattern as test/run-connect-emr-ui.mjs and test/run-connect-agent-boot-ui.mjs:
 * spawn test/serve.mjs, launch headless Chrome with --remote-debugging-port,
 * attach via CDP, walk the flow through the window.SMD_CONNECT_AGENT.__setApi
 * test seam (no backend needed), assert zero console errors/exceptions.
 *
 * Covers (narrow 390px viewport, mobile-first):
 * 1. Flag on -> launcher appears; clicking it opens the sheet (role=dialog).
 * 2. Hospital picker renders mocked hospitals; transform-origin anchors to launcher.
 * 3. New-hospital path: pick -> consent (continue disabled until the unchecked
 *    box is checked; no pre-checked boxes) -> session create -> login viewport
 *    iframe pointed at the same-origin fixture page.
 * 4. Pause/resume posts the right paths and flips control text.
 * 5. "I have signed in" -> progress walks every job state in sequence with its
 *    specific status text (no generic spinner), ending at the success screen
 *    with the worklist placeholder button.
 * 6. Error state (FAILED + reason) with Try again retry -> success.
 * 7. NEEDS_REAUTH shows Sign in again and returns to the login screen.
 * 8. Returning-doctor path: existing hospital shows reconnect screen with no
 *    discovery stage list; reconnect reaches Active.
 * 9. Escape closes the sheet and focus returns to the launcher.
 * 10. prefers-reduced-motion removes the transform animation (fade instead).
 * 11. No em-dash anywhere in sheet copy.
 *
 * Usage: node test/run-connect-agent-onboarding-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8795;
const DBG = 9387;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/connect-agent-onboarding-chrome";
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
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });
  await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    const ready = await ev(`return document.readyState === "complete";`);
    if (ready === true) return true;
  }
  return false;
}

async function waitFor(expr, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 6000)) {
    const v = await ev(expr);
    if (v === true) return true;
    await sleep(200);
  }
  return false;
}

const MOCK = `
window.__calls = [];
window.__states = [];
window.SMD_CONNECT_AGENT.__setApi(function (path, opts) {
  var body = {};
  try { body = opts && opts.body ? JSON.parse(opts.body) : {}; } catch (x) {}
  window.__calls.push({ path: path, method: (opts && opts.method) || "GET", body: body });
  if (path === "/hospitals/resolve") {
    if (body.emrUrl) return Promise.resolve({ s: 200, d: { ok: true, hospitals: [] } });
    return Promise.resolve({ s: 200, d: { ok: true, hospitals: [
      { hospitalId: "h-gimsr", name: "GIMSR Hospital", emrUrl: "https://emr.gimsr.example", hasActiveAdapter: true, adapterVersion: "3" },
      { hospitalId: "h-newcity", name: "New City Hospital", emrUrl: "https://emr.newcity.example", hasActiveAdapter: false }
    ] } });
  }
  if (path === "/sessions" && (!opts || !opts.method || opts.method === "POST") && !body.consent) {
    return Promise.resolve({ s: 200, d: { ok: true, hospitals: [] } });
  }
  if (path === "/sessions") {
    return Promise.resolve({ s: 200, d: { ok: true, sessionId: "sess-1", jobId: "job-1", state: "AWAITING_LOGIN" } });
  }
  if (path === "/sessions/sess-1/viewer-token") {
    return Promise.resolve({ s: 200, d: { ok: true, viewerUrl: "${BASE}test/connect-agent/viewer-fixture.html", expiresInSec: 120 } });
  }
  if (path === "/sessions/sess-1/handoff") {
    return Promise.resolve({ s: 200, d: { ok: true, state: "AUTHENTICATED" } });
  }
  if (path === "/sessions/sess-1/pause") {
    return Promise.resolve({ s: 200, d: { ok: true, controlOwner: "clinician" } });
  }
  if (path === "/sessions/sess-1/resume") {
    return Promise.resolve({ s: 200, d: { ok: true, controlOwner: "agent" } });
  }
  if (path === "/sessions/sess-1") {
    if (!opts || !opts.method || opts.method === "GET") {
      var next = window.__states.length ? window.__states.shift() : { state: "ACTIVE", hospitalName: "New City Hospital", adapterVersion: "1" };
      return Promise.resolve({ s: 200, d: Object.assign({ ok: true }, next) });
    }
    return Promise.resolve({ s: 200, d: { ok: true } });
  }
  return Promise.resolve({ s: 404, d: { ok: false, error: "not_found" } });
});
return 1;
`;

const noDash = `return (function(){ var ov=document.getElementById("smd-connect-ov"); if(!ov) return false; return ov.innerText.indexOf("\\u2014")<0; })();`;

try {
  let ver, t = 0;
  while (t++ < 120) {
    try {
      ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json();
      break;
    } catch {
      await sleep(1000);
    }
  }
  if (!ver) throw new Error("Chrome remote debugging port never came up");

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

  // Flag on, load at a narrow mobile viewport.
  const loaded = await attach(BASE + "index.html");
  ok(loaded, "index.html loaded successfully");
  await ev(`localStorage.setItem("smd_connect_agent", "1"); return 1;`);
  await call("Page.navigate", { url: BASE + "index.html" });

  let launcherAppeared = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const btn = await ev(`var b=document.getElementById("smd-connect-agent-launch"); return !!(b && b.textContent.indexOf("Connect Hospital")>=0);`);
    if (btn === true) { launcherAppeared = true; break; }
  }
  ok(launcherAppeared, "with the flag ON the launcher appears");

  // Open the sheet via the launcher.
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`, 8000), "clicking the launcher opens the sheet");
  ok(await ev(`var s=document.querySelector("#smd-connect-ov .smd-connect-sheet"); return !!(s && s.getAttribute("role")==="dialog" && s.getAttribute("aria-modal")==="true");`) === true, "sheet has dialog role with aria-modal");
  await ev(MOCK);
  await ev(`document.getElementById("smd-connect-search").click(); return 1;`);

  // Hospital picker renders the mocked list.
  ok(await waitFor(`return document.querySelectorAll(".smd-connect-hosp").length===2;`, 8000), "hospital picker renders the two mocked hospitals");
  ok(await ev(`var t=document.getElementById("smd-connect-ov").innerText; return t.indexOf("GIMSR Hospital")>=0 && t.indexOf("New City Hospital")>=0;`) === true, "both hospital names render");

  // transform-origin anchors to the launcher element.
  ok(await ev(`
    var sh=document.querySelector("#smd-connect-ov .smd-connect-sheet");
    var o=getComputedStyle(sh).transformOrigin;
    var ox=parseFloat(o);
    var b=document.getElementById("smd-connect-agent-launch").getBoundingClientRect();
    var s=sh.getBoundingClientRect();
    return Math.abs(ox-((b.left+b.width/2)-s.left))<2;
  `) === true, "sheet transform-origin anchors horizontally to the launcher element");

  // Narrow viewport: the sheet fits inside 390px.
  ok(await ev(`
    var s=document.querySelector("#smd-connect-ov .smd-connect-sheet").getBoundingClientRect();
    return s.width<=391 && s.left>=-1;
  `) === true, "sheet fits the 390px viewport");

  // Open spring settles at rest (no stuck offset).
  await sleep(1200);
  ok(await ev(`
    var t=getComputedStyle(document.querySelector("#smd-connect-ov .smd-connect-sheet")).transform;
    return t==="none" || t.indexOf("matrix(1, 0, 0, 1, 0, 0)")===0;
  `) === true, "open animation settles at rest");
  ok(await ev(noDash) === true, "picker copy has no em-dash");

  // New-hospital path: pick New City Hospital -> consent screen.
  await ev(`
    var nodes=document.querySelectorAll(".smd-connect-hosp");
    for(var i=0;i<nodes.length;i++){ if(nodes[i].textContent.indexOf("New City Hospital")>=0){ nodes[i].click(); break; } }
    return 1;
  `);
  await sleep(300);
  ok(await ev(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="consent";`) === true, "picking a new hospital shows the consent screen");
  ok(await ev(`var b=document.getElementById("smd-connect-consentgo"); var c=document.getElementById("smd-connect-agree"); return !!b && b.disabled===true && !!c && c.checked===false;`) === true, "consent checkbox starts unchecked and Agree stays disabled (no pre-checked boxes)");
  ok(await ev(noDash) === true, "consent copy has no em-dash");
  await ev(`document.getElementById("smd-connect-agree").click(); return 1;`);
  await sleep(200);
  ok(await ev(`return document.getElementById("smd-connect-consentgo").disabled===false;`) === true, "checking the box enables Agree and continue");
  await ev(`document.getElementById("smd-connect-consentgo").click(); return 1;`);

  // Login viewport: session created, iframe points at the same-origin fixture.
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login" && d.sessionId==="sess-1";`, 8000), "consent creates the session and shows the login viewport");
  ok(await ev(`var f=document.getElementById("smd-connect-frame"); return !!f && f.src.indexOf("test/connect-agent/viewer-fixture.html")>=0;`) === true, "login iframe points at the same-origin test viewport page");
  ok(await ev(`var f=document.getElementById("smd-connect-frame"); try{ return f.contentDocument.getElementById("viewer-marker")!==null; }catch(x){ return false; }`) === true, "login iframe content is same-origin and readable");
  ok(await ev(noDash) === true, "login copy has no em-dash");

  // Pause/resume posts the right paths and flips control text.
  await ev(`document.getElementById("smd-connect-pause").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.controlOwner==="clinician";`, 6000), "Pause agent posts /pause and yields control to the clinician");
  ok(await ev(`var t=document.getElementById("smd-connect-ov").innerText; return t.indexOf("Agent paused. You control the session.")>=0 && document.getElementById("smd-connect-pause").textContent.indexOf("Resume agent")>=0;`) === true, "paused state names who controls the session");
  ok(await ev(`var c=window.__calls.filter(function(x){return x.path==="/sessions/sess-1/pause";}); return c.length===1;`) === true, "pause posted exactly one POST /sessions/sess-1/pause");
  await ev(`document.getElementById("smd-connect-pause").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.controlOwner==="agent";`, 6000), "Resume agent posts /resume and returns control");
  ok(await ev(`var c=window.__calls.filter(function(x){return x.path==="/sessions/sess-1/resume";}); return c.length===1;`) === true, "resume posted exactly one POST /sessions/sess-1/resume");

  // Progress: walk every job state in sequence with its specific copy.
  await ev(`window.__states=[{state:"AUTHENTICATED"},{state:"DISCOVERING"},{state:"COMPILING"},{state:"VALIDATING"},{state:"AWAITING_APPROVAL",stageDetail:"2 approvals pending."},{state:"ACTIVE",hospitalName:"New City Hospital",adapterVersion:"1"}]; document.getElementById("smd-connect-signedin").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="progress";`, 8000), "'I have signed in' starts discovery and shows progress");
  ok(await waitFor(`return document.getElementById("smd-connect-status").textContent.indexOf("Sign in confirmed")>=0;`, 8000), "AUTHENTICATED shows its specific status text");
  ok(await waitFor(`return document.getElementById("smd-connect-status").textContent.indexOf("makes no changes")>=0;`, 8000), "DISCOVERING shows its specific status text");
  ok(await waitFor(`return document.getElementById("smd-connect-status").textContent.indexOf("Building the connection draft")>=0;`, 8000), "COMPILING shows its specific status text");
  ok(await waitFor(`return document.getElementById("smd-connect-status").textContent.indexOf("Checking the draft")>=0;`, 8000), "VALIDATING shows its specific status text");
  ok(await waitFor(`return document.getElementById("smd-connect-status").textContent.indexOf("Waiting for hospital approval")>=0;`, 10000), "AWAITING_APPROVAL shows its specific status text");
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="done";`, 10000), "ACTIVE reaches the success screen");
  ok(await ev(`var t=document.getElementById("smd-connect-ov").innerText; return t.indexOf("Connection active")>=0 && t.indexOf("New City Hospital")>=0 && !!document.getElementById("smd-connect-open");`) === true, "success names the hospital and offers the worklist placeholder");
  ok(await ev(noDash) === true, "success copy has no em-dash");
  await ev(`document.getElementById("smd-connect-open").click(); return 1;`);
  await sleep(200);
  ok(await ev(`return document.getElementById("smd-connect-status").textContent.indexOf("lands separately")>=0;`) === true, "worklist button is an honest placeholder, not a dead end");

  // Second session: NEEDS_REAUTH, then FAILED with retry.
  await ev(`document.getElementById("smd-connect-done").click(); return 1;`);
  await sleep(800);
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`, 8000), "sheet reopens for a second session");
  await ev(MOCK);
  await ev(`document.getElementById("smd-connect-search").click(); return 1;`);
  ok(await waitFor(`return document.querySelectorAll(".smd-connect-hosp").length===2;`, 8000), "hospital list reloads on reopen");
  // Canonical URL entry: a non-HTTPS value is rejected, an unknown HTTPS
  // address continues straight to consent as a new deployment.
  await ev(`document.getElementById("smd-connect-url").value="not-a-url"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  await sleep(200);
  ok(await ev(`return document.getElementById("smd-connect-status").textContent.indexOf("Enter an HTTPS EMR address")>=0;`) === true, "non-HTTPS address is rejected with a specific message");
  await ev(`document.getElementById("smd-connect-url").value="https://emr.newcity.example"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="consent";`, 8000), "unknown HTTPS address continues to consent as a new deployment");
  await ev(`document.getElementById("smd-connect-agree").click(); document.getElementById("smd-connect-consentgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login";`, 8000), "second session reaches login");
  await ev(`window.__states=[{state:"NEEDS_REAUTH"}]; document.getElementById("smd-connect-signedin").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="progress" && d.jobState==="NEEDS_REAUTH";`, 10000), "NEEDS_REAUTH lands on progress with reauth state");
  ok(await ev(`var t=document.getElementById("smd-connect-status").textContent; var b=document.getElementById("smd-connect-reauth"); return t.indexOf("session expired")>=0 && !!b && b.style.display!=="none";`) === true, "NEEDS_REAUTH shows its specific text plus a Sign in again action");
  ok(await ev(noDash) === true, "reauth copy has no em-dash");
  await ev(`document.getElementById("smd-connect-reauth").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login";`, 8000), "Sign in again returns to the login viewport");
  await ev(`window.__states=[{state:"FAILED",errorCode:"discovery-timeout",errorDetail:"Discovery timed out after 120 seconds."}]; document.getElementById("smd-connect-signedin").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="progress" && d.jobState==="FAILED";`, 10000), "FAILED lands on progress with failed state");
  ok(await ev(`var t=document.getElementById("smd-connect-status").textContent; var b=document.getElementById("smd-connect-retry"); return t.indexOf("Connection failed")>=0 && t.indexOf("Discovery timed out after 120 seconds.")>=0 && !!b && b.style.display!=="none";`) === true, "FAILED shows its specific text with the safe reason plus a Try again action");
  ok(await ev(noDash) === true, "error copy has no em-dash");
  await ev(`window.__states=[{state:"ACTIVE",hospitalName:"New City Hospital",adapterVersion:"1"}]; document.getElementById("smd-connect-retry").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="done";`, 10000), "Try again retries and reaches success");
  ok(await ev(`var c=window.__calls.filter(function(x){return x.path==="/sessions/sess-1/handoff";}); return c.length>=2;`) === true, "retry re-issues the idempotent handoff call");

  // Returning-doctor path: existing hospital re-authenticates, no discovery UI.
  await ev(`document.getElementById("smd-connect-done").click(); return 1;`);
  await sleep(800);
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`, 8000), "sheet reopens for the returning-doctor path");
  await ev(MOCK);
  await ev(`document.getElementById("smd-connect-search").click(); return 1;`);
  ok(await waitFor(`return document.querySelectorAll(".smd-connect-hosp").length===2;`, 8000), "hospital list reloads for the returning doctor");
  await ev(`
    var nodes=document.querySelectorAll(".smd-connect-hosp");
    for(var i=0;i<nodes.length;i++){ if(nodes[i].textContent.indexOf("GIMSR Hospital")>=0){ nodes[i].click(); break; } }
    return 1;
  `);
  await sleep(300);
  ok(await ev(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="reconnect";`) === true, "existing hospital shows the reconnect screen, not consent");
  ok(await ev(`var t=document.getElementById("smd-connect-ov").innerText; return t.indexOf("Welcome back")>=0 && t.indexOf("Discovery is skipped")>=0;`) === true, "reconnect screen names the existing connection and skips discovery");
  await ev(`document.getElementById("smd-connect-rego").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login" && d.reuse===true;`, 8000), "reconnect creates a reuse session at the login viewport");
  await ev(`window.__states=[{state:"ACTIVE",hospitalName:"GIMSR Hospital",adapterVersion:"3"}]; document.getElementById("smd-connect-signedin").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="progress";`, 8000), "reconnect handoff shows progress");
  ok(await ev(`return document.querySelector("#smd-connect-ov .smd-connect-stages")===null;`) === true, "reconnect progress shows no rediscovery stage list");
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="done";`, 10000), "reconnect reaches Active without rediscovery");
  ok(await ev(`var t=document.getElementById("smd-connect-ov").innerText; return t.indexOf("GIMSR Hospital")>=0 && t.indexOf("version 3")>=0;`) === true, "reconnect success names the hospital and adapter version");

  // Escape closes the sheet and focus returns to the launcher.
  await ev(`document.getElementById("smd-connect-agent-launch").focus(); document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(document.getElementById("smd-connect-ov"));`, 8000), "sheet opens before the Escape check");
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true, cancelable:true})); return 1;`);
  ok(await waitFor(`return document.getElementById("smd-connect-ov")===null;`, 8000), "Escape closes the sheet");
  await sleep(300);
  ok(await ev(`return document.activeElement===document.getElementById("smd-connect-agent-launch");`) === true, "focus returns to the launcher after close");

  // Reduced motion: the sheet fades instead of sliding.
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(document.getElementById("smd-connect-ov"));`, 8000), "sheet opens under reduced motion");
  ok(await ev(`return document.getElementById("smd-connect-ov").getAttribute("data-motion")==="fade";`) === true, "sheet reports fade motion under reduced motion");
  ok(await ev(`return getComputedStyle(document.querySelector("#smd-connect-ov .smd-connect-sheet")).transform==="none";`) === true, "reduced motion removes the transform animation");
  await call("Emulation.setEmulatedMedia", {});
  await ev(`if(window.SMD_CONNECT_AGENT) window.SMD_CONNECT_AGENT.close(); localStorage.removeItem("smd_connect_agent"); return 1;`);
  await sleep(800);

  ok(consoleErrors.length === 0, "zero console errors and zero uncaught exceptions" + (consoleErrors.length ? " -> " + JSON.stringify(consoleErrors.slice(0, 5)) : ""));

  console.log(fails === 0 ? "\nALL GREEN - connect-agent-onboarding UI test passed" : `\n${fails} FAILED`);
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

