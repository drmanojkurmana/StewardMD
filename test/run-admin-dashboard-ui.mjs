import { mkdir, writeFile } from 'node:fs/promises';
/* Admin console · App updates (OTA) pane — real headless Chrome against the actual admin/index.html.
 *
 * functions/_ota.js is covered by test/ota.test.mjs (pure logic, no HTTP). This test covers the OTHER
 * way the feature can break: the console calling the wrong endpoint, sending the wrong payload, or
 * rendering the wrong thing — none of which a server-side unit test would ever catch.
 *
 * admin/index.html wraps its ENTIRE script in `(function(){ ... })()` — deliberately, so nothing it
 * declares (auth, PANES, goPane, ...) leaks onto window for a stray global to collide with. That
 * means this test cannot reach in and call goPane()/inspect `auth` directly; it drives the page the
 * only way a real admin would — real clicks — and gets Firebase auth into the closure by replacing
 * `window.firebase` BEFORE the script runs (via Page.addScriptToEvaluateOnNewDocument), which the
 * script's own `auth = firebase.auth()` then picks up as normal. fetch is intercepted the same way,
 * for /api/ota/* only, to serve canned responses and record what the console actually sent.
 * USAGE: node test/run-ota-admin-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8919/").replace(/\/?$/, "/");
const PORT = 9451, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/dashboard-chrome-"+process.pid;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8919"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
// This test environment DOES have outbound internet: the real Firebase SDK loads from gstatic.com and
// would overwrite our fake `window.firebase` the instant it does. Fail those two requests at the
// network layer so the fake stub (injected at document-start, before either script tag) survives —
// a CI run must never depend on Google's CDN being reachable, or on it NOT being reachable either.
function wireFetchBlock() {
  const orig = ws.onmessage;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Fetch.requestPaused") { call("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "ConnectionRefused" }); return; }
    orig(e);
  };
}

const CANDIDATE = { commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", message: "fix ICU acuity", manifestKey: "ota/manifests/a1b2.json", builtAt: "2026-08-22T10:00:00Z", totalFiles: 814, totalBytes: 93000000 };
const CHANNEL = { version: 3, commit: "9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f", message: "prior release", publishedAt: "2026-08-21T09:00:00Z", publishedBy: "owner@stewardmd.in", minNativeBuild: 0 };
const HISTORY = [
  { version: 3, action: "publish", commit: CHANNEL.commit, message: "prior release", at: CHANNEL.publishedAt, by: "owner@stewardmd.in", manifestKey: "ota/manifests/9f9f.json" },
  { version: 2, action: "kill", at: "2026-08-20T09:00:00Z", by: "owner@stewardmd.in" },
];

// Runs at document-start, BEFORE the page's own script — so its closure-local `auth = firebase.auth()`
// picks up this fake implementation, and its unqualified `fetch(...)`/`confirm(...)` calls resolve to
// these overrides via the normal global scope chain (an IIFE closure doesn't insulate against that).
const BOOT = `
  window.__sent = [];
  window.__killOn = false;
  window.__alerts = [];
  var CANDIDATE = ${JSON.stringify(CANDIDATE)};
  var CHANNEL = ${JSON.stringify(CHANNEL)};
  var HISTORY = ${JSON.stringify(HISTORY)};
  var FAKE_USER = { email: "owner@stewardmd.in", getIdToken: function () { return Promise.resolve("faketoken"); } };
  window.firebase = {
    initializeApp: function () {},
    auth: function () { window.__auth = { currentUser: FAKE_USER, onAuthStateChanged: function (cb) { window.__authChanged=cb; cb(FAKE_USER); }, signOut: function () {} }; return window.__auth; }
  };
  window.firebase.auth.GoogleAuthProvider = function () {};
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    if (String(url).indexOf("/api/") === 0 && String(url).indexOf("/api/ota/") !== 0) {
      window.__sent.push({url:String(url),method:opts.method||"GET",body:opts.body||null});
      var d={audit:[{action:"budget",detail:"<img src=x onerror=alert(1)>",by:"owner",ts:123456789}],daily:{requests:127,estCostInr:18},doctors:[],items:[],tickets:[],errors:[],config:{minBuild:10,maintenance:{on:false,message:""},flags:{keep:true},banners:[{id:"keep",text:"Keep me"}]}};
      if(opts.method==="POST"&&String(url).endsWith("/config"))d={ok:true,config:JSON.parse(opts.body)};
      return Promise.resolve(new Response(JSON.stringify(d),{status:window.__failAdmin&&String(url).indexOf("/api/ai/admin")===0?403:200}));
    }
    if (String(url).indexOf("/api/ota/") !== 0) return realFetch(url, opts);
    window.__sent.push({ url: String(url), method: opts.method || "GET", body: opts.body || null });
    var body;
    if (url === "/api/ota/candidate") body = { ok: true, candidate: CANDIDATE };
    else if (url === "/api/ota/channel") body = { ok: true, channel: CHANNEL, kill: { on: window.__killOn } };
    else if (url === "/api/ota/history") body = { ok: true, history: HISTORY };
    else if (url === "/api/ota/publish") body = { ok: true, channel: Object.assign({}, CHANNEL, { version: 4, commit: CANDIDATE.commit }) };
    else if (url === "/api/ota/kill") { window.__killOn = JSON.parse(opts.body).on; body = { ok: true, kill: { on: window.__killOn } }; }
    else if (url === "/api/ota/rollback") body = { ok: true, channel: Object.assign({}, CHANNEL, { version: 5 }) };
    else body = { error: "unhandled-in-test:" + url };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
  window.confirm = function () { return true; };
  window.alert = function (m) { window.__alerts.push(m); };
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "https://www.gstatic.com/firebasejs/*" }] });
  wireFetchBlock();
  await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT });   // must exist before the page's own IIFE runs
  await call("Page.navigate", { url: BASE + "admin/index.html" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(300); if (await ev(`return !!document.getElementById("nav")`) === true) { ready = true; break; } }
  if (!ready) throw new Error("admin console did not load");
  await sleep(400);   // let the fake onAuthStateChanged callback + showActivePane() settle


  await sleep(300);
  ok(await ev('return !!document.getElementById("adminSearch")'),'dashboard shell loads');
  ok(await ev('return document.getElementById("ovAiReq").textContent==="127"'),'overview uses actual API metrics');
  await ev('document.getElementById("adminSearch").click();document.getElementById("adminCommandInput").value="budget";document.getElementById("adminCommandInput").dispatchEvent(new Event("input"));');
  ok(await ev('return document.querySelectorAll("#adminResults .dash-result").length===1'),'search finds a specific budget control');
  await ev('document.querySelector("#adminResults a").click();');
  ok(await ev('return document.querySelector("#pane-aictl").classList.contains("on")'),'result opens correct workspace');
  ok(await ev('return document.activeElement.textContent.indexOf("Daily budget cap")>=0'),'result focuses the exact control');
  await ev('document.querySelector("[data-p=overview]").click();document.getElementById("adminSearch").click();document.getElementById("adminCommandInput").value="overview";document.getElementById("adminCommandInput").dispatchEvent(new Event("input"));document.querySelector("#adminResults button").click();');
  ok(await ev('return document.getElementById("adminPins").textContent.indexOf("Overview")>=0'),'pinning adds a shortcut');
  await ev('document.getElementById("adminCommandClose").click();document.querySelector("[data-p=config]").click();');
  await sleep(200);
  await ev('document.getElementById("cfgMaintenance").checked=true;document.getElementById("cfgMaintenance").dispatchEvent(new Event("input"));document.getElementById("cfgSave").click();');
  await sleep(200);
  ok(await ev('var x=window.__sent.filter(x=>x.url.endsWith("/config")&&x.method==="POST").pop();var b=JSON.parse(x.body);return b.maintenance.on&&b.flags.keep&&b.banners[0].id==="keep";'),'guided configuration saves through existing API and preserves banners and flags');
  await ev('window.__sent=[];document.querySelector("[data-go=sources]").click();');
  await sleep(300);
  ok(await ev('return !window.__sent.some(x=>x.method==="POST")'),'workspace navigation never launches a crawl');
  await ev('window.__failAdmin=true;document.querySelector("[data-p=overview]").click();');
  await sleep(200);
  ok(await ev('return document.getElementById("ovAiReq").textContent==="Unavailable"&&document.getElementById("ovMsg").textContent.indexOf("could not")>=0'),'permission failure is visible, never a fake zero');
  await ev('window.__failAdmin=false;document.getElementById("ovRefresh").click();');
  await sleep(200);
  ok(await ev('return document.getElementById("ovAiReq").textContent==="127"'),'dashboard refresh recovers from error');
  await ev('document.querySelector("[data-p=audit]").click();');
  await sleep(200);
  ok(await ev('return document.getElementById("auditList").textContent.indexOf("<img")>=0&&!document.querySelector("#auditList img")'),'activity log renders API records as safe text');
  await ev('document.getElementById("auditFilter").value="no-match";document.getElementById("auditFilter").dispatchEvent(new Event("input"));');
  ok(await ev('return document.getElementById("auditList").textContent.indexOf("No activity matches")>=0'),'activity filter provides an empty state');
  await ev('document.querySelector("[data-p=overview]").click();');
  await sleep(200);
  await mkdir('/tmp/stewardmd-admin-dashboard',{recursive:true});
  for (var width of [1440,768,390,320]) {
    await call("Emulation.setDeviceMetricsOverride",{width,height:960,deviceScaleFactor:1,mobile:width<761});
    await sleep(100);
    ok(await ev('return document.documentElement.scrollWidth<=innerWidth+1;'),'dashboard fits '+width+'px');
    var shot=await call("Page.captureScreenshot",{format:"png"});
    await writeFile('/tmp/stewardmd-admin-dashboard/'+width+'.png',Buffer.from(shot.result.data,'base64'));
  }
  await ev('document.getElementById("adminMenu").click();');
  ok(await ev('return document.getElementById("adminMenu").getAttribute("aria-expanded")==="true"&&!document.querySelector(".side").inert'),'mobile menu opens and is accessible');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  ok(await ev('return document.getElementById("adminMenu").getAttribute("aria-expanded")==="false"&&document.querySelector(".side").inert'),'Escape closes mobile menu and removes hidden links from focus');
  await call("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]});
  ok(await ev('return getComputedStyle(document.body).backgroundColor==="rgb(0, 0, 0)"'),'dark mode uses black');
  var dark=await call("Page.captureScreenshot",{format:"png"});
  await writeFile('/tmp/stewardmd-admin-dashboard/dark.png',Buffer.from(dark.result.data,'base64'));

  await call("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"light"}]});
  await call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  ok(await ev('return getComputedStyle(document.body).backgroundColor==="rgb(245, 246, 248)"'),'light appearance remains available');
  var light=await call("Page.captureScreenshot",{format:"png"});
  await writeFile('/tmp/stewardmd-admin-dashboard/light.png',Buffer.from(light.result.data,'base64'));
  await ev('window.__auth.currentUser=null;window.__authChanged(null);');
  ok(await ev('return !document.querySelector(".pane.on")&&document.getElementById("gate").style.display!=="none"'),'sign-out hides every admin pane');
  await ev('document.getElementById("adminSearch").click();document.querySelector("#adminResults a").click();');
  ok(await ev('return !document.querySelector(".pane.on")'),'search cannot bypass the sign-in gate');
  console.log(fails ? fails+' failures' : 'All dashboard checks pass');
} catch(e){console.error(e);fails++;}
finally {ws?.close();chrome.kill();serveProc?.kill();process.exitCode=fails?1:0;}
