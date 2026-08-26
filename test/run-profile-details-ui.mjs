/* Profile professional details + first-run setup form (real headless browser).
 *
 * Reported: every row of "Professional details" read "Offline" and the card carried TWO
 * "Couldn't load your details. Retry" notices. Two separate faults:
 *   1. Firestore is loaded LAZILY (window.SMD_loadFirebase), so window.SMD_DB does not exist on a
 *      cold start. The card treated that first look as "Offline" and never came back.
 *   2. offline() appended its notice unconditionally, so a second call stacked a second copy.
 * And the curated institution directory (window.SMD_HOSPITALS) had nothing that ever ASKED for it,
 * so hospital/degree/speciality stayed empty forever.
 *
 * Firebase is stubbed with an in-memory doc of the same shape, so this exercises the real UI code
 * without a network or a real account.
 *
 * USAGE: node test/run-profile-details-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8998/").replace(/\/?$/, "/");
const PORT = 9399, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/profile-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

/* An in-memory stand-in for the exact Firestore surface the profile code uses:
 * db.collection("users").doc(uid).collection("profile").doc("self").get()/.set(obj,{merge:true}) */
const FAKE_FB = `
window.__fakeDoc = ${JSON.stringify({ regNo: "TSMC-12345", hospital: "Gandhi Medical College", city: "Hyderabad", phone: "9876543210" })};
window.__setCalls = 0;
window.__lazyBoots = 0;
function mkRef(){
  return {
    get: function(){ return Promise.resolve({ exists: true, data: function(){ return JSON.parse(JSON.stringify(window.__fakeDoc)); } }); },
    set: function(obj, opts){ window.__setCalls++; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj,k)) window.__fakeDoc[k]=obj[k]; return Promise.resolve(); }
  };
}
window.__mkDb = function(){ return { collection: function(){ return { doc: function(){ return { collection: function(){ return { doc: function(){ return mkRef(); } }; } }; } }; } }; };
window.SMD_AUTH = { currentUser: { uid: "test-uid" }, onAuthStateChanged: function(){} };
return 1;`;

const PRO_ROWS = `return [].slice.call(document.querySelectorAll('#pfPro [data-row]')).map(function(r){ return r.getAttribute("data-row")+"="+r.querySelector("[data-val]").textContent.trim(); }).join(" | ");`;

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_openProfile && window.SMD_PROFILE_SETUP && window.SMD_HOSPITALS)`) === true) { ready = true; break; } }
  ok(ready, "app, profile page, setup module and hospital directory all load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_showHome(); return 1;`); await sleep(700);
  ok(await ev(`return SMD_HOSPITALS.all().length > 500;`) === true, "the curated hospital/college directory is populated");

  // ── 1. the lazy-Firestore case: DB missing at first look, SMD_loadFirebase can supply it ──
  await ev(FAKE_FB);
  await ev(`window.SMD_DB = null; window.SMD_loadFirebase = function(cb){ window.__lazyBoots++; setTimeout(function(){ window.SMD_DB = window.__mkDb(); cb && cb(); }, 250); }; return 1;`);
  await ev(`SMD_openProfile(); return 1;`); await sleep(2000);
  ok(await ev(`return window.__lazyBoots;`) === 1, "a missing SMD_DB now BOOTS Firebase instead of declaring Offline");
  const rows = await ev(PRO_ROWS);
  ok(rows.indexOf("Offline") === -1, "no row reads Offline once Firestore arrives");
  ok(rows.indexOf("regno=TSMC-12345") >= 0 && rows.indexOf("hospital=Gandhi Medical College") >= 0, "the stored details actually render");
  ok(await ev(`return document.querySelectorAll('#pfPro [data-offnote]').length;`) === 0, "no error notice when the load succeeds");

  // ── 2. Degree and Speciality are first-class rows ──
  ok(rows.indexOf("degree=") >= 0 && rows.indexOf("speciality=") >= 0, "Degree and Speciality rows exist on the Profile card");
  ok(await ev(`var r=document.querySelector('#pfPro [data-row="degree"] .hv-pf-edit'); return r?r.textContent.trim():"";`) === "Choose",
    "an unset Degree offers Choose");
  await ev(`var b=document.querySelector('#pfPro [data-row="degree"] .hv-pf-edit'); if(b) b.click(); return 1;`); await sleep(700);
  ok(await ev(`return document.querySelectorAll('#choiceList [data-c]').length >= 6;`) === true, "the degree picker lists the qualifications");
  const degOpts = await ev(`return [].slice.call(document.querySelectorAll('#choiceList [data-c]')).map(function(b){return b.getAttribute("data-c");}).join(",");`);
  ok(["MD", "MS", "DM", "MCh", "DNB", "DrNB"].every(d => degOpts.split(",").indexOf(d) >= 0), "every requested degree is offered (MS/MD/DM/MCh/DNB/DrNB)");
  await ev(`var b=document.querySelector('#choiceList [data-c="DNB"]'); if(b) b.click(); return 1;`); await sleep(1600);
  ok(await ev(`return window.__fakeDoc.degree;`) === "DNB", "picking a degree saves it to the profile document");

  // ── 3. the duplicate "Couldn't load your details" notice ──
  await ev(`window.SMD_DB = null; delete window.SMD_loadFirebase; return 1;`);
  await ev(`SMD_openProfile(); return 1;`); await sleep(900);
  await ev(`SMD_openProfile(); return 1;`); await sleep(900);
  ok(await ev(`return document.querySelectorAll('#pfPro [data-offnote]').length;`) === 1,
    "a genuinely offline card shows exactly ONE error notice, never a stack of them");

  // ── 4. the first-run form ──
  await ev(`window.SMD_DB = window.__mkDb(); window.__fakeDoc = { regNo: "TSMC-12345" }; return 1;`);
  ok(JSON.stringify(await ev(`return SMD_PROFILE_SETUP.missing({});`)) === JSON.stringify(["phone", "hospital", "degree", "speciality"]),
    "an empty profile is reported as missing all four required fields");
  ok(JSON.stringify(await ev(`return SMD_PROFILE_SETUP.missing({phone:"9",hospital:"h",degree:"MD",speciality:"Internal Medicine"});`)) === "[]",
    "a complete profile is not asked again");
  await ev(`SMD_PROFILE_SETUP.open(); return 1;`); await sleep(1200);
  ok(await ev(`return document.querySelectorAll('#pfSetupRoot .pfs-f').length;`) === 4, "the form asks for phone, college, degree and speciality");
  // Save with nothing filled must refuse and mark the offending fields.
  await ev(`document.querySelector('#pfSetupRoot #pfsSave').click(); return 1;`); await sleep(500);
  ok(await ev(`return document.querySelectorAll('#pfSetupRoot .pfs-f.bad').length;`) >= 4, "saving an empty form is refused and the fields are flagged");
  ok(await ev(`return !!document.getElementById("pfSetupRoot").classList.contains("on");`) === true, "the form stays open when invalid");
  // Fill it the way a user would, through the pickers.
  await ev(`var i=document.querySelector('#pfSetupRoot [data-k="phone"]'); i.value="9876543210"; i.dispatchEvent(new Event("input")); return 1;`);
  await ev(`document.querySelector('#pfSetupRoot [data-pick="hospital"]').click(); return 1;`); await sleep(700);
  ok(await ev(`return document.querySelectorAll('#pfSetupRoot .pfs-opt').length > 10;`) === true, "the college/hospital chooser searches the real directory");
  await ev(`var q=document.querySelector('#pfSetupRoot #pfsQ'); q.value="Gandhi"; q.dispatchEvent(new Event("input")); return 1;`); await sleep(400);
  await ev(`var b=document.querySelector('#pfSetupRoot .pfs-opt'); if(b) b.click(); return 1;`); await sleep(600);
  await ev(`document.querySelector('#pfSetupRoot [data-pick="degree"]').click(); return 1;`); await sleep(600);
  await ev(`var b=document.querySelector('#pfSetupRoot .pfs-opt[data-v="MD"]'); if(b) b.click(); return 1;`); await sleep(600);
  await ev(`document.querySelector('#pfSetupRoot [data-pick="speciality"]').click(); return 1;`); await sleep(600);
  ok(await ev(`return document.querySelectorAll('#pfSetupRoot .pfs-opt').length > 20;`) === true, "the speciality chooser offers the full list");
  await ev(`var b=document.querySelector('#pfSetupRoot .pfs-opt[data-v="Internal Medicine"]'); if(b) b.click(); return 1;`); await sleep(600);
  await ev(`document.querySelector('#pfSetupRoot #pfsSave').click(); return 1;`); await sleep(900);
  const saved = await ev(`return JSON.stringify(window.__fakeDoc);`);
  ok(saved.indexOf('"phone":"9876543210"') >= 0 && saved.indexOf('"degree":"MD"') >= 0 && saved.indexOf('"speciality":"Internal Medicine"') >= 0 && saved.indexOf("Gandhi") >= 0,
    "a completed form writes all four fields to the same profile document the card reads");
  ok(await ev(`return document.getElementById("pfSetupRoot").classList.contains("on");`) === false, "the form closes once saved");

  console.log(fails === 0 ? "\nALL GREEN — professional details load, and the first-run form collects them" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
