/* test/run-connect-agent-onboarding-ui.mjs - Headless Chrome CDP test for
 * connect-agent-onboarding.js (the doctor-facing Connect Hospital onboarding UI).
 *
 * Same pattern as test/run-connect-emr-ui.mjs and test/run-connect-agent-boot-ui.mjs:
 * spawn test/serve.mjs, launch headless Chrome with --remote-debugging-port,
 * attach via CDP, walk the flow through window.SMD_CONNECT_AGENT.__setApi (the
 * broker seam) plus a fake window.Capacitor.Plugins.ConnectBrowser (the native
 * plugin seam) and window.__SMD_PHONE_ENGINE_TEST__ (the phone discovery engine
 * seam), asserting zero console errors/exceptions.
 *
 * Covers (narrow 390px viewport, mobile-first):
 * 1. Flag on -> boot module publishes its opener; the sheet opens with the
 *    connections list, empty-state copy for a first-time doctor.
 * 2. "Connect a hospital" -> hospital URL screen; non-HTTPS is rejected;
 *    a valid https address continues to consent.
 * 3. Consent: no pre-checked box, Agree stays disabled until checked ->
 *    POST /sessions {emrUrl, consent:{agreed:true}, runner:"phone"} (phone
 *    runner because the fake ConnectBrowser plugin is present).
 * 4. Login: the fake plugin's open() is called with the https EMR URL, the
 *    deployment origins, and the deployment id as storeId.
 * 5. loggedIn (fired by the test) -> POST handoff with visitedOrigins ->
 *    pendingOrigins confirm sheet -> Allow -> POST origins approve ->
 *    plugin.setMode({mode:"agent", ...}).
 * 6. Progress: runPhoneDiscovery is invoked with plugin/api/session/deployment;
 *    onProgress updates the live counters; resolving lands on the result
 *    screen with proven/unproven capabilities.
 * 7. Approve button appears (an admin fake permits it) and activating reaches
 *    the Connected screen.
 * 8. Reuse shortcut: reuse:true skips discovery and goes straight to Connected
 *    after loggedIn + handoff.
 * 9. Errors: 403 on approve hides the button; NEEDS_REAUTH from discovery
 *    reopens the login screen.
 * 10. Escape closes the sheet and focus returns to the launcher; reduced
 *     motion fades instead of sliding; no em-dash anywhere in sheet copy.
 *
 * Usage: node test/run-connect-agent-onboarding-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8796;
const DBG = 9388;
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

/* Fake native ConnectBrowser plugin (see local-plugins/capacitor-connect-browser/README.md).
 * Records every call so assertions can inspect them, and lets the test fire
 * `loggedIn`/`stopped` events the way the real WKWebView/WebView would after
 * the doctor taps the native "Done, I'm signed in" / "Stop" buttons. */
const FAKE_PLUGIN = `
window.__pluginCalls = [];
window.__pluginListeners = {};
window.Capacitor = window.Capacitor || {};
window.Capacitor.Plugins = window.Capacitor.Plugins || {};
window.Capacitor.Plugins.ConnectBrowser = {
  open: function (args) { window.__pluginCalls.push({ m: "open", a: args }); return Promise.resolve({ ok: true }); },
  navigate: function (args) { window.__pluginCalls.push({ m: "navigate", a: args }); return Promise.resolve({ ok: true }); },
  evaluate: function (args) { window.__pluginCalls.push({ m: "evaluate", a: args }); return Promise.resolve({ result: "" }); },
  currentUrl: function () { return Promise.resolve({ url: "", title: "" }); },
  setMode: function (args) { window.__pluginCalls.push({ m: "setMode", a: args }); return Promise.resolve({ ok: true }); },
  drainRequests: function () { return Promise.resolve({ requests: [] }); },
  close: function () { window.__pluginCalls.push({ m: "close" }); return Promise.resolve({ ok: true }); },
  addListener: function (name, fn) {
    window.__pluginListeners[name] = window.__pluginListeners[name] || [];
    window.__pluginListeners[name].push(fn);
    return { remove: function () {} };
  },
  __fire: function (name, payload) {
    (window.__pluginListeners[name] || []).forEach(function (fn) { fn(payload); });
  }
};
return 1;
`;

/* Fake phone discovery engine (connect-agent/phone/index.mjs, not yet built by
 * the sibling agent owning it - stubbed at the documented seam per CLAUDE.md /
 * the task brief, so this suite needs no real .mjs file). Records the call and
 * lets the test decide the outcome per scenario. */
const FAKE_ENGINE = `
window.__engineCalls = [];
window.__SMD_PHONE_ENGINE_TEST__ = {
  runPhoneDiscovery: function (opts) {
    window.__engineCalls.push(opts);
    window.__lastOnProgress = opts.onProgress;
    return window.__engineOutcome();
  },
  createPluginClient: function (opts) {
    window.__engineCalls.push({ createPluginClient: opts });
    return null; // exercise the documented one-line hook (plugin.open fallback)
  }
};
window.__engineOutcome = function () { return new Promise(function () {}); };
return 1;
`;

const MOCK = `
window.__calls = [];
window.SMD_CONNECT_AGENT.__setApi(function (path, opts) {
  var body = {};
  try { body = opts && opts.body ? JSON.parse(opts.body) : {}; } catch (x) {}
  window.__calls.push({ path: path, method: (opts && opts.method) || "GET", body: body });
  if (path === "/connections" && (!opts || !opts.method || opts.method === "GET")) {
    return Promise.resolve({ s: 200, d: window.__connections || [] });
  }
  if (path === "/sessions" && opts && opts.method === "POST") {
    // The REAL server shape (store.js sessionView): flat sessionId, never a nested session object.
    // Stubbing the nested shape is how a 200 that the client read as a failure passed this test.
    if (window.__reuse) {
      return Promise.resolve({ s: 200, d: { ok: true, sessionId: "sess-1", deploymentId: "dep-1", state: "CREATED", controlOwner: "clinician", revision: 1, job: null,
        deployment: { id: "dep-1", origins: ["https://emr.newcity.example"], activeVersionId: "v-old" }, reuse: true } });
    }
    return Promise.resolve({ s: 200, d: { ok: true, sessionId: "sess-1", deploymentId: "dep-1", state: "CREATED", controlOwner: "clinician", revision: 1, job: { jobId: "job-1", state: "PENDING" },
      deployment: { id: "dep-1", origins: ["https://emr.newcity.example"], activeVersionId: null }, reuse: false } });
  }
  if (path === "/sessions/sess-1/handoff") {
    // A job that already produced a candidate is finished; the sheet must review, not re-crawl.
    return Promise.resolve({ s: 200, d: { ok: true, origins: ["https://emr.newcity.example"],
      pendingOrigins: window.__pendingOrigins || [],
      job: window.__finishedJob ? { jobId: "job-1", state: "AWAITING_APPROVAL", candidateVersionId: "ver-1" } : null } });
  }
  if (path === "/sessions/sess-1" && (!opts || !opts.method || opts.method === "GET")) {
    return Promise.resolve({ s: 200, d: { ok: true, sessionId: "sess-1", state: "AUTHENTICATED",
      job: window.__finishedJob ? { jobId: "job-1", state: "AWAITING_APPROVAL", candidateVersionId: "ver-1" } : { jobId: "job-1", state: "DISCOVERING", candidateVersionId: null } } });
  }
  if (path === "/sessions/sess-1/origins") {
    return Promise.resolve({ s: 200, d: { ok: true, origins: ["https://emr.newcity.example", "https://sso.newcity.example"] } });
  }
  if (path === "/sessions/sess-1") {
    return Promise.resolve({ s: 200, d: { ok: true } });
  }
  if (path === "/versions/ver-1") {
    return Promise.resolve({ s: 200, d: { ok: true, id: "ver-1", state: "AWAITING_APPROVAL",
      capabilities: window.__capabilities || [] } });
  }
  if (path === "/versions/ver-1/approve") {
    return Promise.resolve(window.__approveResponse || { s: 200, d: { ok: true, state: "ACTIVE", activationId: "act-1" } });
  }
  if (path === "/versions/ver-1/reject") {
    return Promise.resolve({ s: 200, d: { ok: true, state: "REVOKED" } });
  }
  if (path === "/tenants") {
    return Promise.resolve(window.__tenants ? { s: 200, d: { ok: true, tenants: window.__tenants } } : { s: 404, d: { ok: false, error: "not_found" } });
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
      const d = (m.params || {}).exceptionDetails || {};
      consoleErrors.push("EXCEPTION: " + (d.text || "thrown") + " " + ((d.exception || {}).description || "") + " @" + (d.url || "") + ":" + (d.lineNumber != null ? d.lineNumber + 1 : "?"));
    }
  };

  const loaded = await attach(BASE + "index.html");
  ok(loaded, "index.html loaded successfully");
  await ev(`localStorage.setItem("smd_connect_agent", "1"); return 1;`);
  await call("Page.navigate", { url: BASE + "index.html" });

  // Install the fake plugin and engine BEFORE the boot module loads the UI, so
  // hasPlugin()/loadPhoneEngine() see them from the first open().
  let launcherAppeared = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const ready = await ev(`return !!(window.SMD_CONNECT_AGENT_BOOT && window.SMD_CONNECT_AGENT_BOOT.enabled);`);
    if (ready === true) { launcherAppeared = true; break; }
  }
  ok(launcherAppeared, "with the flag ON the boot module publishes its opener");
  await ev(FAKE_PLUGIN);
  await ev(FAKE_ENGINE);
  await ev(`
    var b = document.createElement("button");
    b.id = "smd-connect-agent-launch";
    b.type = "button";
    b.textContent = "Connect Hospital";
    b.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:49";
    b.addEventListener("click", function () { window.SMD_CONNECT_AGENT_BOOT.open(); });
    document.body.appendChild(b);
    return 1;
  `);

  // 1. Open the sheet: empty-state connections list for a first-time doctor.
  await ev(`window.__connections = []; return 1;`);
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`, 8000), "clicking the launcher opens the sheet");
  ok(await ev(`var s=document.querySelector("#smd-connect-ov .smd-connect-sheet"); return !!(s && s.getAttribute("role")==="dialog" && s.getAttribute("aria-modal")==="true");`) === true, "sheet has dialog role with aria-modal");
  await ev(MOCK);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="connections";`, 8000), "sheet opens on the connections list");
  ok(await waitFor(`var t=document.getElementById("smd-connect-ov").innerText; return t.indexOf("have not connected a hospital yet")>=0;`, 8000), "first-time doctor sees empty-state copy");
  ok(await ev(noDash) === true, "connections copy has no em-dash");

  // transform-origin anchors to the launcher, and the sheet fits the viewport.
  ok(await ev(`
    var sh=document.querySelector("#smd-connect-ov .smd-connect-sheet");
    var o=getComputedStyle(sh).transformOrigin;
    var ox=parseFloat(o);
    var b=document.getElementById("smd-connect-agent-launch").getBoundingClientRect();
    var s=sh.getBoundingClientRect();
    return Math.abs(ox-((b.left+b.width/2)-s.left))<2;
  `) === true, "sheet transform-origin anchors horizontally to the launcher element");
  ok(await ev(`
    var s=document.querySelector("#smd-connect-ov .smd-connect-sheet").getBoundingClientRect();
    return s.width<=391 && s.left>=-1;
  `) === true, "sheet fits the 390px viewport");
  await sleep(1200);
  ok(await ev(`
    var t=getComputedStyle(document.querySelector("#smd-connect-ov .smd-connect-sheet")).transform;
    return t==="none" || t.indexOf("matrix(1, 0, 0, 1, 0, 0)")===0;
  `) === true, "open animation settles at rest");

  // 2. Connect a hospital -> URL screen; https enforced.
  await ev(`document.getElementById("smd-connect-add").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="url";`, 6000), "Connect a hospital opens the URL screen");
  await ev(`document.getElementById("smd-connect-url").value="not-a-url"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  ok(await waitFor(`return document.getElementById("smd-connect-status").textContent.indexOf("Enter an HTTPS hospital address")>=0;`, 4000), "non-HTTPS address is rejected with a specific message");
  await ev(`document.getElementById("smd-connect-url").value="https://emr.newcity.example"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="consent";`, 6000), "a valid https address continues to consent");
  ok(await ev(noDash) === true, "URL screen copy has no em-dash");

  // 3. Consent: no pre-checked box; Agree posts /sessions with runner:"phone".
  ok(await ev(`var b=document.getElementById("smd-connect-consentgo"); var c=document.getElementById("smd-connect-agree"); return !!b && b.disabled===true && !!c && c.checked===false;`) === true, "consent checkbox starts unchecked and Agree stays disabled (no pre-checked boxes)");
  ok(await ev(noDash) === true, "consent copy has no em-dash");
  await ev(`document.getElementById("smd-connect-agree").click(); return 1;`);
  ok(await waitFor(`return document.getElementById("smd-connect-consentgo").disabled===false;`, 4000), "checking the box enables Agree and continue");
  await ev(`window.__reuse = false; document.getElementById("smd-connect-consentgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login" && d.sessionId==="sess-1" && d.runner==="phone";`, 8000), "consent creates the session (phone runner) and shows the login screen");
  ok(await ev(`
    var c=window.__calls.filter(function(x){return x.path==="/sessions" && x.method==="POST";})[0];
    return !!c && c.body.emrUrl==="https://emr.newcity.example" && c.body.consent.agreed===true && c.body.runner==="phone";
  `) === true, "POST /sessions carries emrUrl, consent.agreed and runner:phone");

  // 4. Login: the fake plugin's open() was called with the https URL, deployment origins and storeId.
  ok(await waitFor(`return window.__pluginCalls.filter(function(c){return c.m==="open";}).length>=1;`, 6000), "the native plugin open() is invoked to start sign in");
  ok(await ev(`
    var c=window.__pluginCalls.filter(function(c){return c.m==="open";})[0];
    return c.a.url==="https://emr.newcity.example" && c.a.origins.indexOf("https://emr.newcity.example")>=0 && c.a.storeId==="dep-1";
  `) === true, "plugin.open receives the https EMR URL, deployment origins, and deployment id as storeId");
  ok(await ev(noDash) === true, "login copy has no em-dash");

  // 5. loggedIn -> handoff -> pendingOrigins confirm -> Allow -> origins approve -> agent mode.
  await ev(`window.__pendingOrigins = ["https://sso.newcity.example"]; window.Capacitor.Plugins.ConnectBrowser.__fire("navigated", {url:"https://emr.newcity.example/login", mainFrame:true}); window.Capacitor.Plugins.ConnectBrowser.__fire("loggedIn", {url:"https://emr.newcity.example/home"}); return 1;`);
  ok(await waitFor(`var c=window.__calls.filter(function(x){return x.path==="/sessions/sess-1/handoff";}); return c.length===1 && c[0].body.visitedOrigins.indexOf("https://emr.newcity.example")>=0;`, 8000), "loggedIn posts handoff with the visited origins");
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="origins";`, 8000), "a pending origin from sign in shows the confirm sheet");
  ok(await waitFor(`return document.getElementById("smd-connect-ov").innerText.indexOf("https://sso.newcity.example")>=0;`, 4000), "confirm sheet names the extra website");
  ok(await ev(noDash) === true, "origins confirm copy has no em-dash");
  await ev(`window.__engineOutcome = function () { return new Promise(function () {}); }; document.getElementById("smd-connect-originsyes").click(); return 1;`);
  ok(await waitFor(`var c=window.__calls.filter(function(x){return x.path==="/sessions/sess-1/origins";}); return c.length===1 && c[0].body.approve.indexOf("https://sso.newcity.example")>=0;`, 8000), "Allow posts POST origins approve with the pending origin");
  ok(await waitFor(`return window.__pluginCalls.filter(function(c){return c.m==="setMode" && c.a.mode==="agent";}).length>=1;`, 8000), "agent mode is set on the plugin once origins are settled");

  // 6. Progress: runPhoneDiscovery invoked with plugin/api/session/deployment; onProgress updates counters.
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="progress";`, 8000), "discovery starts and shows the progress screen");
  ok(await ev(`
    var c=window.__engineCalls.filter(function(c){return c.plugin;})[0];
    return !!c && !!c.plugin && typeof c.api.plan==="function" && typeof c.api.progress==="function" &&
      typeof c.api.discovery==="function" && typeof c.api.evidence==="function" &&
      c.session.id==="sess-1" && c.deployment.id==="dep-1" && c.startUrl==="https://emr.newcity.example";
  `) === true, "runPhoneDiscovery is called with plugin, a four-method api, session, deployment and startUrl");
  await ev(`window.__lastOnProgress({pages:3,requests:12,phase:"DISCOVERING"}); return 1;`);
  ok(await waitFor(`return document.getElementById("smd-connect-pages").textContent==="3" && document.getElementById("smd-connect-reqs").textContent==="12";`, 4000), "onProgress updates the live page/request counters");
  ok(await ev(noDash) === true, "progress copy has no em-dash");
  ok(await ev(`return document.getElementById("smd-connect-body").textContent.indexOf("Keep your phone unlocked")>=0;`) === true, "progress screen tells the doctor to keep the phone unlocked and the app open");

  // 6b. Crawl progress: what the agent is opening, what it found, what it is still looking for.
  await ev(`window.__lastOnProgress({phase:"CRAWLING", steps:3, events:12, opening:"Lab reports", found:["worklist"], looking:["labs","radiology"]}); return 1;`);
  ok(await waitFor(`var t=document.getElementById("smd-connect-detail").textContent; return t.indexOf("Opening")>=0 && t.indexOf("Lab reports")>=0 && t.indexOf("Worklist")>=0 && t.indexOf("Radiology reports")>=0;`, 3000), "crawl progress shows the control being opened, the views found and the views still missing");
  ok(await ev(`return document.getElementById("smd-connect-phase").textContent.indexOf("read-only")>=0;`) === true, "crawl phase copy says read-only");

  // 6c. Guided step: the engine asks the doctor for a missing view. The sheet shows the instruction
  // and a Skip button; Skip resolves {done:false}; the plugin's Done (loggedIn) resolves {done:true}.
  await ev(`
    var call = window.__engineCalls[window.__engineCalls.length - 1];
    window.__ask1 = null; window.__ask2 = null;
    call.askDoctor({gap:"radiology", text:"I could not find your radiology reports. Tap where they live, then tap Done."}).then(function (r) { window.__ask1 = r; });
    return typeof call.askDoctor === "function" && typeof call.stopSignal === "function";
  `).then((v) => ok(v === true, "runPhoneDiscovery receives askDoctor and stopSignal"));
  ok(await waitFor(`var t=document.getElementById("smd-connect-detail").textContent; return t.indexOf("radiology reports")>=0 && !!document.getElementById("smd-connect-guideskip");`, 3000), "guided step renders the question and a Skip button");
  ok(await ev(`return document.getElementById("smd-connect-phase").textContent.indexOf("needs your help")>=0;`) === true, "guided step phase copy asks for help");
  await ev(`document.getElementById("smd-connect-guideskip").click(); return 1;`);
  ok(await waitFor(`return window.__ask1 && window.__ask1.done === false && !document.getElementById("smd-connect-guideskip");`, 3000), "Skip resolves the ask with done:false and removes the instruction");
  await ev(`
    var call = window.__engineCalls[window.__engineCalls.length - 1];
    call.askDoctor({gap:"discharge", text:"I could not find the discharge summary. Tap where it lives, then tap Done."}).then(function (r) { window.__ask2 = r; });
    return 1;
  `);
  ok(await waitFor(`return !!document.getElementById("smd-connect-guideskip");`, 3000), "second ask renders");
  await ev(`window.Capacitor.Plugins.ConnectBrowser.__fire("loggedIn", {url:"https://emr.newcity.example/home"}); return 1;`);
  ok(await waitFor(`return window.__ask2 && window.__ask2.done === true;`, 3000), "the plugin's Done (loggedIn) during a guided step resolves the ask with done:true, not a second handoff");
  ok(await ev(`return window.__calls.filter(function(x){return x.path==="/sessions/sess-1/handoff";}).length === 1;`) === true, "no extra handoff was posted by the guided Done");
  ok(await ev(noDash) === true, "guided-step copy has no em-dash");

  // Resolve discovery: result screen with proven/unproven capabilities. The first run above left
  // runPhoneDiscovery's promise deliberately unresolved (__engineOutcome's default), so this next
  // scenario opens a fresh session with __engineOutcome pre-armed to resolve immediately - matching
  // how a real discovery run terminates.
  await ev(`
    window.__capabilities = [
      {operation:"read", resource:"worklist", proven:true},
      {operation:"read", resource:"medications", proven:true},
      {operation:"read", resource:"allergies", proven:false}
    ];
  `);
  await ev(`if(window.SMD_CONNECT_AGENT) window.SMD_CONNECT_AGENT.close(); return 1;`);
  await sleep(800);
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`, 8000), "sheet reopens for the discovery-result scenario");
  await ev(MOCK);
  await ev(`document.getElementById("smd-connect-add").click(); return 1;`);
  await ev(`document.getElementById("smd-connect-url").value="https://emr.newcity.example"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="consent";`, 6000), "second run reaches consent");
  await ev(`document.getElementById("smd-connect-agree").click(); window.__reuse=false; document.getElementById("smd-connect-consentgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login";`, 8000), "second run reaches login");
  await ev(`
    window.__engineOutcome = function () {
      return Promise.resolve({candidateVersionId:"ver-1", capabilities: window.__capabilities, evidenceHash:"h1", state:"AWAITING_APPROVAL"});
    };
    window.__pendingOrigins = [];
    window.Capacitor.Plugins.ConnectBrowser.__fire("loggedIn", {url:"https://emr.newcity.example/home"});
    return 1;
  `);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="result";`, 8000), "resolved discovery lands on the result screen");
  ok(await waitFor(`var t=document.getElementById("smd-connect-ov").innerText; return t.indexOf("Worklist")>=0 && t.indexOf("Medications")>=0;`, 4000), "proven capabilities are listed");
  ok(await ev(`var t=document.getElementById("smd-connect-ov").innerText; return t.indexOf("Allergies")>=0 && t.indexOf("not found at this hospital")>=0;`) === true, "unproven capabilities are shown greyed with a not-found note");
  ok(await ev(`return document.getElementById("smd-connect-ov").innerText.indexOf("Awaiting approval")>=0;`) === true, "result names the awaiting-approval state");
  // The crawl is over, so the hospital browser must be gone: left open it covers this very screen,
  // still wearing the "StewardMD is reading" banner, and a finished run reads as a hung one.
  ok(await ev(`return window.__pluginCalls.some(function(c){return c.m==="close";});`) === true,
    "the hospital browser is closed when discovery finishes, so the approval screen is what the doctor sees");
  ok(await ev(noDash) === true, "result copy has no em-dash");

  // 7. Approve button appears for an admin fake and activating reaches Connected.
  ok(await waitFor(`return document.getElementById("smd-connect-approverow").style.display!=="none";`, 4000), "Approve/Reject appear for an actor the server permits");
  await ev(`document.getElementById("smd-connect-approve").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="done";`, 6000), "Approve activates the version and reaches Connected");
  ok(await ev(`return document.getElementById("smd-connect-ov").innerText.indexOf("Connected")>=0;`) === true, "Connected screen confirms the activation");
  ok(await ev(noDash) === true, "connected copy has no em-dash");

  // 9a. 403 on approve hides the button instead of leaving a dead control.
  await ev(`if(window.SMD_CONNECT_AGENT) window.SMD_CONNECT_AGENT.close(); return 1;`);
  await sleep(800);
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`, 8000), "sheet reopens for the 403 scenario");
  await ev(MOCK);
  await ev(`document.getElementById("smd-connect-add").click(); document.getElementById("smd-connect-url").value="https://emr.newcity.example"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  await ev(`document.getElementById("smd-connect-agree").click(); window.__reuse=false; document.getElementById("smd-connect-consentgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login";`, 8000), "third run reaches login");
  await ev(`
    window.__engineOutcome = function () {
      return Promise.resolve({candidateVersionId:"ver-1", capabilities: window.__capabilities, evidenceHash:"h1", state:"AWAITING_APPROVAL"});
    };
    window.__pendingOrigins = [];
    window.Capacitor.Plugins.ConnectBrowser.__fire("loggedIn", {url:"https://emr.newcity.example/home"});
    return 1;
  `);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="result";`, 8000), "third run reaches result");
  await ev(`window.__approveResponse = { s: 403, d: { ok: false, error: "forbidden" } }; document.getElementById("smd-connect-approve").click(); return 1;`);
  ok(await waitFor(`return document.getElementById("smd-connect-approverow").style.display==="none";`, 6000), "a 403 on approve hides the Approve/Reject controls");

  // 9b. NEEDS_REAUTH surfaced by the discovery engine reopens the login screen.
  await ev(`if(window.SMD_CONNECT_AGENT) window.SMD_CONNECT_AGENT.close(); return 1;`);
  await sleep(800);
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`, 8000), "sheet reopens for the reauth scenario");
  await ev(MOCK);
  await ev(`document.getElementById("smd-connect-add").click(); document.getElementById("smd-connect-url").value="https://emr.newcity.example"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  await ev(`document.getElementById("smd-connect-agree").click(); window.__reuse=false; document.getElementById("smd-connect-consentgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login";`, 8000), "fourth run reaches login");
  await ev(`
    window.__engineOutcome = function () { var e=new Error("reauth"); e.reauth=true; return Promise.reject(e); };
    window.__pendingOrigins = [];
    window.Capacitor.Plugins.ConnectBrowser.__fire("loggedIn", {url:"https://emr.newcity.example/home"});
    return 1;
  `);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login";`, 8000), "NEEDS_REAUTH from discovery reopens the login screen");
  ok(await waitFor(`return document.getElementById("smd-connect-status").textContent.indexOf("session expired")>=0;`, 4000), "reauth shows its specific status text");
  ok(await ev(noDash) === true, "reauth copy has no em-dash");

  // 8. Reuse shortcut: reuse:true skips discovery entirely.
  await ev(`if(window.SMD_CONNECT_AGENT) window.SMD_CONNECT_AGENT.close(); return 1;`);
  await sleep(800);
  await ev(`document.getElementById("smd-connect-agent-launch").click(); return 1;`);
  ok(await waitFor(`return !!(window.SMD_CONNECT_AGENT && document.getElementById("smd-connect-ov"));`, 8000), "sheet reopens for the reuse scenario");
  await ev(`window.__engineCalls = []; return 1;`);
  await ev(MOCK);
  await ev(`document.getElementById("smd-connect-add").click(); document.getElementById("smd-connect-url").value="https://emr.newcity.example"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  await ev(`document.getElementById("smd-connect-agree").click(); window.__reuse=true; document.getElementById("smd-connect-consentgo").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="reuse";`, 8000), "reuse:true shows the already-connected shortcut, not consent-again");
  ok(await ev(`return document.getElementById("smd-connect-ov").innerText.indexOf("already connected")>=0;`) === true, "reuse screen names the existing adapter");
  ok(await ev(noDash) === true, "reuse copy has no em-dash");
  await ev(`document.getElementById("smd-connect-reusego").click(); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login" && d.reuse===true;`, 8000), "Sign in to use it opens login for the reuse session");
  await ev(`
    window.__pendingOrigins = [];
    window.Capacitor.Plugins.ConnectBrowser.__fire("loggedIn", {url:"https://emr.newcity.example/home"});
    return 1;
  `);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="done";`, 8000), "reuse handoff skips discovery and reaches Connected directly");
  ok(await ev(`
    var c=window.__engineCalls.filter(function(c){return c.plugin;});
    return c.length===0;
  `) === true, "no discovery run was started for the reuse path");

  // Escape closes the sheet and focus returns to the launcher.
  await ev(`document.getElementById("smd-connect-agent-launch").focus(); if(window.SMD_CONNECT_AGENT) window.SMD_CONNECT_AGENT.close(); document.getElementById("smd-connect-agent-launch").click(); return 1;`);
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

  // A doctor whose account spans several hospitals is asked which one, and the choice sticks.
  await ev(`window.__tenants = [{ tenantId: "t-a", name: "Alpha Hospital", role: "owner" }, { tenantId: "t-b", name: "Beta Hospital", role: "owner" }]; localStorage.removeItem("smd_connect_agent_tenant"); window.__calls = []; window.SMD_CONNECT_AGENT.open(); return 1;`);
  ok(await waitFor(`return document.getElementById("smd-connect-ov").innerText.indexOf("Which hospital?")>=0;`, 6000), "an account with several hospitals is asked which one before anything loads");
  await ev(`document.querySelector('[data-tenant="t-b"]').click(); return 1;`);
  ok(await waitFor(`return localStorage.getItem("smd_connect_agent_tenant")==="t-b" && window.__calls.some(function(c){return c.path==="/connections";});`, 6000), "picking a hospital stores the choice and loads its connections");
  ok(await waitFor(`return document.getElementById("smd-connect-ov").innerText.indexOf("Switch hospital")>=0;`, 4000), "the list offers Switch hospital");
  await ev(`window.__tenants = null; localStorage.removeItem("smd_connect_agent_tenant"); return 1;`);

  // What the doctor watches while the agent works: a bar that moves, a sentence in their own
  // vocabulary, and a time. A screen that only counted pages read as frozen.
  await ev(`
    var A = window.SMD_CONNECT_AGENT;
    A.__setState({ screen: "progress", runner: "phone",
      selected: { emrUrl: "https://emr.newcity.example" },
      progressStartedAt: Date.now() - 60000,
      progressCounts: { pages: 6, requests: 12, phase: "CRAWLING", opening: "", found: ["worklist", "patient"], looking: ["labs", "medications"] } });
    A.__paintProgress();
    return 1;
  `);
  ok(await waitFor(`return !!document.querySelector('.smd-connect-prog > i');`, 4000), "the progress screen shows a progress bar");
  const pct = Number(await ev(`var b=document.querySelector('.smd-connect-prog'); return b ? b.getAttribute('aria-valuenow') : '';`));
  ok(pct > 10 && pct < 90, "the bar reports a real percentage, not 0 or 100: " + pct);
  ok(await ev(`return document.getElementById('smd-connect-activity').textContent.indexOf('Looking for where your lab results sit') >= 0;`) === true,
    "it says what it is doing in the doctor's words, naming the view it is hunting for");
  ok(await ev(`return /minute/.test(document.getElementById('smd-connect-eta').textContent);`) === true, "it estimates the time left");

  // Further along, the bar must be further along, and the wording follows the phase.
  await ev(`
    var A = window.SMD_CONNECT_AGENT;
    A.__setState({ progressCounts: { pages: 20, requests: 48, phase: "COMPILING", opening: "", found: ["worklist","patient","labs","medications","radiology"], looking: [] } });
    A.__paintProgress();
    return 1;
  `);
  const pct2 = Number(await ev(`var b=document.querySelector('.smd-connect-prog'); return b ? b.getAttribute('aria-valuenow') : '';`));
  ok(pct2 > pct, "the bar advances as views are captured: " + pct + " -> " + pct2);
  ok(await ev(`return document.getElementById('smd-connect-activity').textContent.indexOf('Writing the connection') >= 0;`) === true,
    "the compile step says it is writing the connection, not a phase code");
  ok(await ev(noDash) === true, "the progress copy has no em-dash");

  // The sheet is BEHIND the full-screen hospital browser during a crawl, so the same three facts
  // have to reach the one surface the doctor can see: the native banner.
  await ev(`
    var A = window.SMD_CONNECT_AGENT;
    A.__setState({ bannerLine: "", deployment: { id: "dep-1", origins: ["https://emr.newcity.example"] },
      progressCounts: { pages: 9, requests: 20, phase: "CRAWLING", opening: "", found: ["worklist","patient","labs"], looking: ["medications"] } });
    window.__pluginCalls = [];
    A.__publishBanner();
    return 1;
  `);
  const banner = await ev(`var c = window.__pluginCalls.filter(function(x){return x.m==="setMode";}).pop(); return c && c.a ? String(c.a.banner) : "";`);
  ok(/^\d+%/.test(banner), "the banner leads with a percentage: " + banner);
  ok(/medication/i.test(banner), "the banner names what the agent is hunting for");
  ok(banner.indexOf("\u2014") < 0, "banner copy has no em-dash");

  // Reopening a connection whose crawl ALREADY finished must review it, never crawl it again:
  // the server refuses a second discovery ("job is not in discovery") and the doctor sat watching
  // a 21-page re-crawl end in "you can try again" while their adapter waited for approval.
  await ev(`
    window.__finishedJob = true;
    window.__reuse = false;          // an earlier scenario left the reuse shortcut on
    var A = window.SMD_CONNECT_AGENT;
    A.close(); A.open();
    return 1;
  `);
  await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="connections";`, 6000);
  await ev(`document.getElementById("smd-connect-add").click(); return 1;`);
  await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="url";`, 4000);
  await ev(`document.getElementById("smd-connect-url").value="https://emr.newcity.example"; document.getElementById("smd-connect-urlgo").click(); return 1;`);
  await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="consent";`, 4000);
  await ev(`var b=document.getElementById("smd-connect-agree"); b.checked=true; b.onchange(); document.getElementById("smd-connect-consentgo").click(); return 1;`);
  await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="login";`, 6000);
  await ev(`window.__pendingOrigins = []; window.Capacitor.Plugins.ConnectBrowser.__fire("loggedIn", {url:"https://emr.newcity.example/home"}); return 1;`);
  ok(await waitFor(`var d=window.SMD_CONNECT_AGENT.__debug(); return d.screen==="result";`, 8000),
    "a connection whose crawl already finished goes straight to the review, not back through discovery");
  ok(await ev(`return document.getElementById("smd-connect-ov").innerText.indexOf("Awaiting approval")>=0;`) === true,
    "and it shows the approval the doctor owes a decision on");
  await ev(`window.__finishedJob = false; return 1;`);

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
