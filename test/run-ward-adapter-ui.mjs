/* test/run-ward-adapter-ui.mjs - Headless Chrome CDP test: an APPROVED Connect Agent adapter shows
 * up as a hospital in Ward Sync's "Select your hospital" picker (ghis-ward.js) and, once the doctor
 * signs in inside the (fake) ConnectBrowser, the REAL connect-agent/phone/runtime.mjs reads the
 * worklist rows the fake plugin returns and renderPatients() draws them.
 *
 * Seams: window.GHIS.__setAgentApi (the agent API), a fake window.Capacitor.Plugins.ConnectBrowser.
 * The runtime module is served as-is by test/serve.mjs.
 *
 * Usage: node test/run-ward-adapter-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8797;
const DBG = 9389;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-adapter-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1;
const pending = new Map();
let ws, sessionId;
const consoleErrors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function waitFor(expr, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 6000)) { if ((await ev(expr)) === true) return true; await sleep(200); }
  return false;
}

const FAKE_PLUGIN = `
window.__pluginCalls = [];
window.__pluginListeners = {};
window.__pages = {};
window.__url = "";
window.Capacitor = window.Capacitor || {};
window.Capacitor.Plugins = window.Capacitor.Plugins || {};
window.Capacitor.Plugins.ConnectBrowser = {
  open: function (a) { window.__pluginCalls.push({ m: "open", a: a }); window.__url = a.url; window.__open = true; return Promise.resolve({ ok: true }); },
  navigate: function (a) { window.__pluginCalls.push({ m: "navigate", a: a }); window.__url = a.url; return Promise.resolve({ ok: true }); },
  evaluate: function (a) { window.__pluginCalls.push({ m: "evaluate", url: window.__url }); return Promise.resolve({ result: JSON.stringify(window.__pages[window.__url] || []) }); },
  currentUrl: function () { return Promise.resolve({ url: window.__url, title: "" }); },
  setMode: function (a) { window.__pluginCalls.push({ m: "setMode", a: a }); return Promise.resolve({ ok: true }); },
  close: function () { window.__pluginCalls.push({ m: "close" }); window.__open = false; return Promise.resolve({ ok: true }); },
  addListener: function (name, fn) { (window.__pluginListeners[name] = window.__pluginListeners[name] || []).push(fn); return { remove: function () { var l = window.__pluginListeners[name]; var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }; },
  __fire: function (name, p) { (window.__pluginListeners[name] || []).slice().forEach(function (fn) { fn(p); }); }
};
return 1;`;

const MOCK = `
window.__calls = [];
window.GHIS.__setAgentApi(function (path, tid, opts) {
  var body = {}; try { body = opts && opts.body ? JSON.parse(opts.body) : {}; } catch (x) {}
  window.__calls.push({ path: path, tid: tid, method: (opts && opts.method) || "GET", body: body });
  if (path === "/tenants") return Promise.resolve({ s: 200, d: { ok: true, tenants: [{ tenantId: "t-kims", name: "KIMS Hospital", role: "owner" }, { tenantId: "t-gimsr", name: "GIMSR", role: "owner" }] } });
  if (path === "/connections" && tid === "t-kims") return Promise.resolve({ s: 200, d: { ok: true, connections: [
    { deploymentId: "dep-kims", origins: ["https://hims.kims.example"], activeVersionId: "ver-1", pendingVersionId: null },
    { deploymentId: "dep-draft", origins: ["https://draft.example"], activeVersionId: null, pendingVersionId: "ver-9" } ] } });
  if (path === "/connections" && tid === "t-gimsr") return Promise.resolve({ s: 200, d: { ok: true, connections: [ { deploymentId: "dep-g", origins: ["https://gimsrlogin.gitam.edu"], activeVersionId: "ver-g" } ] } });
  if (path === "/sessions" && opts.method === "POST") return Promise.resolve(window.__sessionResp || { s: 200, d: { ok: true, sessionId: "sess-1", deploymentId: "dep-kims", state: "CREATED", reuse: true, deployment: { id: "dep-kims", origins: ["https://hims.kims.example"], activeVersionId: "ver-1" } } });
  if (path === "/sessions/sess-1/handoff") return Promise.resolve({ s: 200, d: { ok: true, origins: ["https://hims.kims.example"], pendingOrigins: [] } });
  if (path === "/versions/ver-1") return Promise.resolve({ s: 200, d: { ok: true, id: "ver-1", state: "ACTIVE", replay: [
    { resourceHint: "worklist", pathTemplate: "/ip/worklist", method: "GET", rowsSelector: "#wl tbody tr", headers: ["S.No", "UHID", "Patient Name", "Age/Sex", "Bed No", "Ward", "Consultant"], singleRecord: false },
    { resourceHint: "medications", pathTemplate: "/ip/meds/{id}", method: "GET", rowsSelector: "#rx tr", headers: ["Drug", "Dose"], singleRecord: false } ] } });
  return Promise.resolve({ s: 404, d: { ok: false, error: "not_found" } });
});
window.__pages["https://hims.kims.example/ip/worklist"] = [
  { "S.No": "1", "UHID": "K001", "Patient Name": "Ravi Kumar", "Age/Sex": "45 / M", "Bed No": "12A", "Ward": "MICU", "Consultant": "Rao" },
  { "S.No": "2", "UHID": "K002", "Patient Name": "Sita Devi", "Age/Sex": "30 / F", "Bed No": "3", "Ward": "General", "Consultant": "Rao" } ];
window.__pages["https://hims.kims.example/ip/meds/K001"] = [ { "Drug": "Amoxicillin", "Dose": "500 mg TDS" } ];
return 1;`;

try {
  let ver, t = 0;
  while (t++ < 120) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(1000); } }
  if (!ver) throw new Error("Chrome remote debugging port never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && m.params && m.params.type === "error") consoleErrors.push((m.params.args || []).map((a) => a.value || a.description || "").join(" "));
    if (m.method === "Runtime.exceptionThrown") { const d = (m.params || {}).exceptionDetails || {}; consoleErrors.push("EXCEPTION: " + (d.text || "thrown") + " " + ((d.exception || {}).description || "") + " @" + (d.url || "") + ":" + (d.lineNumber != null ? d.lineNumber + 1 : "?")); }
  };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("smd_ghis_ward","1");}catch(e){}` });
  await call("Page.navigate", { url: BASE + "index.html" });
  ok(await waitFor(`return !!(window.GHIS && window.GHIS.__setAgentApi && window.openGHIS);`, 20000), "ghis-ward.js loaded with the agent API seam");
  await ev(FAKE_PLUGIN);
  await ev(MOCK);

  await ev(`window.openGHIS(); return 1;`);
  ok(await waitFor(`return !!document.querySelector('#ghisAdapterHosp [data-adapter-dep="dep-kims"]');`, 8000), "the approved KIMS adapter appears as a hospital button in the picker");
  const picker = await ev(`var b=[].slice.call(document.querySelectorAll('#ghisHospital .ghis-setup-card .ghis-connect-btn')).map(function(x){return x.textContent.trim();}); return JSON.stringify(b);`);
  ok(/^\["GIMSR","KIMS","StewardMD Hospital"/.test(picker), "order is GIMSR, KIMS, StewardMD Hospital -> " + picker);
  ok((await ev(`return document.getElementById("ghisAdapterHosp").innerText;`)).indexOf("KIMS Hospital · sign in with hims.kims.example") >= 0, "subtitle names the tenant and the host");
  ok(await ev(`return !document.querySelector('[data-adapter-dep="dep-draft"]') && !document.querySelector('[data-adapter-dep="dep-g"]');`) === true, "a draft (no active version) and the GIMSR origin are not listed");
  ok(await ev(`return document.getElementById("ghisAdapterHosp").innerText.indexOf("\\u2014")<0;`) === true, "no em-dash in the adapter entries (pre-existing GIMSR/demo copy is out of scope)");

  await ev(`document.querySelector('[data-adapter-dep="dep-kims"]').click(); return 1;`);
  ok(await waitFor(`return window.__pluginCalls.some(function(c){return c.m==="open"&&c.a.url==="https://hims.kims.example"&&c.a.storeId==="dep-kims";});`, 8000), "tapping it creates a session and opens the in-app browser at the hospital origin");
  const sess = await ev(`var c=window.__calls.filter(function(c){return c.path==="/sessions";})[0]; return JSON.stringify(c);`);
  ok(/"emrUrl":"https:\/\/hims.kims.example".*"runner":"phone"/.test(sess) && /"tid":"t-kims"/.test(sess), "POST /sessions carries emrUrl, runner phone, ?tenant= -> " + sess);
  ok((await ev(`return document.getElementById("ghisPatientList").innerText;`)).indexOf("Signing in to hims.kims.example") >= 0, "list shows the login gate");

  await ev(`window.Capacitor.Plugins.ConnectBrowser.__fire("loggedIn", {url:"https://hims.kims.example/home"}); return 1;`);
  ok(await waitFor(`return document.querySelectorAll("#ghisPatientList .ghis-pt-card").length===2;`, 8000), "after sign in, two real-looking patient rows render via renderPatients");
  ok(await ev(`return window.__calls.some(function(c){return c.path==="/sessions/sess-1/handoff"&&c.method==="POST";}) && window.__calls.some(function(c){return c.path==="/versions/ver-1";});`) === true, "handoff was posted and the active version detail fetched");
  const card = await ev(`return document.querySelector("#ghisPatientList .ghis-pt-card").innerText;`);
  ok(card.indexOf("Ravi Kumar") >= 0 && card.indexOf("K001") >= 0 && card.indexOf("45") >= 0 && card.indexOf("Bed 12A") >= 0 && card.indexOf("MICU") >= 0, "first card shows name, UHID, age, bed, ward -> " + card.replace(/\s+/g, " "));
  ok(await ev(`return window.__pluginCalls.some(function(c){return c.m==="setMode"&&c.a.mode==="agent"&&c.a.banner==="Reading hims.kims.example for your ward list";});`) === true, "browser was switched to agent mode with the reading banner");
  ok(await ev(`return window.__pluginCalls.some(function(c){return c.m==="navigate"&&c.a.url==="https://hims.kims.example/ip/worklist";});`) === true, "runtime navigated to the worklist path");
  ok(await ev(`return window.__open===false && window.__pluginCalls[window.__pluginCalls.length-1].m==="close";`) === true, "browser closed after the read");
  ok(await ev(`return document.getElementById("ghisFBranch").innerText.indexOf("MICU")>=0;`) === true, "branch filter populated from the adapter rows");

  await ev(`document.querySelector("#ghisPatientList .ghis-pt-card").click(); return 1;`);
  ok(await waitFor(`return document.getElementById("ghisLabBody").innerText.indexOf("Amoxicillin")>=0;`, 8000), "tapping a patient reads the adapter's medications view into the detail drawer");
  ok(await ev(`return document.getElementById("ghisLabTitle").textContent==="Ravi Kumar (K001)";`) === true, "drawer titled with the patient");
  ok(await ev(`return window.__pluginCalls.some(function(c){return c.m==="navigate"&&c.a.url==="https://hims.kims.example/ip/meds/K001";}) && window.__open===false;`) === true, "detail read navigated to the filled path and closed the browser");

  await ev(`window.closeLabDrawer(); window.ghisDisconnect(); return 1;`);
  ok(await ev(`return document.getElementById("ghisHospital").style.display!=="none";`) === true, "sign out returns to the hospital picker");

  await ev(`window.__sessionResp = { s: 403, d: { ok: false, error: "forbidden", detail: "not a member of this tenant" } }; document.querySelector('[data-adapter-dep="dep-kims"]').click(); return 1;`);
  ok(await waitFor(`return document.getElementById("ghisPatientList").innerText.indexOf("not a member of this tenant")>=0;`, 8000), "a server failure names its reason");
  await ev(`window.__sessionResp = null; document.querySelector('[data-adapter-dep="dep-kims"]').click(); return 1;`);
  await waitFor(`return (window.__pluginListeners.stopped||[]).length>0;`, 5000);
  await ev(`window.Capacitor.Plugins.ConnectBrowser.__fire("stopped", {}); return 1;`);
  ok(await waitFor(`return document.getElementById("ghisPatientList").innerText.indexOf("Sign in to hims.kims.example was cancelled")>=0;`, 8000), "cancelling the login names that reason");
  ok(consoleErrors.length === 0, "zero console errors and zero uncaught exceptions" + (consoleErrors.length ? " -> " + JSON.stringify(consoleErrors.slice(0, 5)) : ""));
  console.log(fails === 0 ? "\nALL GREEN - ward adapter UI test passed" : `\n${fails} FAILED`);
} catch (e) {
  console.error("HARNESS ERROR:", e && e.message);
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  serveProc.kill();
  process.exit(fails === 0 ? 0 : 1);
}
