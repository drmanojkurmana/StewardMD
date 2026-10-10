/* The profile sheet, driven in a real headless browser against the real app.
 *
 * Two bugs reported from the owner's iPhone, both of which only exist in a live layout with a
 * keyboard and a lazy SDK, so neither is reachable by a unit test:
 *
 *  1. The city/district picker, keyboard up: "cant scroll and cant see option". A fixed,
 *     bottom-anchored sheet is laid out against the layout viewport, which iOS does not shrink for
 *     the keyboard, so the search field sat under the keyboard's accessory bar and the results had
 *     nowhere to go.
 *  2. Save, on a phone with full signal: "not able to save after being online". Save read
 *     window.SMD_DB once and, finding it empty, said "You are offline".
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-profile-setup-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9401, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pfs-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

/* A signed-in doctor with NO Firebase yet - the state the reported bug happens in. The lazy loader
 * is stubbed so the test controls whether it succeeds, which is the difference between "sign in"
 * and "could not reach your account". */
const STUB = `
  window.__toasts = []; window.__saved = null; window.__loads = 0; window.__loadWorks = true; window.__signedIn = true;
  window.toast = function (m) { window.__toasts.push(String(m)); };
  window.SMD_DB = null; window.SMD_AUTH = null;
  window.__mkDb = function () { return { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return {
    get: function () { return Promise.resolve({ exists: false, data: function () { return {}; } }); },
    set: function (o) { window.__saved = o; return Promise.resolve(); }
  }; } }; } }; } }; } }; };
  window.SMD_loadFirebase = function (cb) {
    window.__loads++;
    setTimeout(function () {
      if (window.__loadWorks) {
        window.SMD_DB = window.__mkDb();
        window.SMD_AUTH = { currentUser: window.__signedIn ? { uid: "u-doc-1" } : null,
                            onAuthStateChanged: function (f) { setTimeout(function () { f(window.SMD_AUTH.currentUser); }, 10); return function () {}; } };
      }
      cb && cb();
    }, 30);
  };
  return 1;`;

const root = () => ev(`var r=document.getElementById("pfSetupRoot"); return !!(r && r.classList.contains("on"));`);
const toasts = () => ev(`return JSON.stringify(window.__toasts);`);
/* Fill the three picker-backed required fields the way a doctor does: open the picker, choose a
 * row. The hospital picker is driven through its "Use what I typed" path, which is the one that
 * needs no directory download and is worth covering anyway. */
async function pick(key, value) {
  await ev(`document.querySelector('#pfSetupRoot [data-pick="${key}"]').click(); return 1;`);
  for (let i = 0; i < 25; i++) { await sleep(120); if (await ev(`return !!document.getElementById("pfsL");`) === true) break; }
  const hit = await ev(`var l=document.getElementById("pfsL"); if(!l) return "no-list";
    var b=[].slice.call(l.querySelectorAll(".pfs-opt")).filter(function(x){return x.getAttribute("data-v")===${JSON.stringify(value)};})[0];
    if(b){ b.click(); return "row"; } return "none";`);
  if (hit !== "row") {
    await ev(`var q=document.getElementById("pfsQ"); q.value=${JSON.stringify(value)}; q.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
    await sleep(200);
    await ev(`var c=document.querySelector("#pfsL [data-custom]"); if(c) c.click(); return 1;`);
  }
  await sleep(350);
  return hit;
}
async function fillRequired() {
  await ev(`var el=document.getElementById("pfSetupRoot");
    el.querySelector('[data-k="name"]').value="Dr Manoj"; el.querySelector('[data-k="name"]').dispatchEvent(new Event("input",{bubbles:true}));
    el.querySelector('[data-k="phone"]').value="8897298117"; el.querySelector('[data-k="phone"]').dispatchEvent(new Event("input",{bubbles:true}));
    return 1;`);
  // "I am a" became a required field (81ee04837, Role box). A practising doctor still answers
  // degree and speciality; the trainee roles skip them.
  await pick("role", "Doctor (practising)");
  await pick("degree", "MD");
  await pick("speciality", "Internal Medicine");
  await pick("hospital", "King George Hospital");
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_PROFILE_SETUP`) === true) { ready = true; break; } }
  ok(ready, "profile-setup.js loads with the app");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{sessionStorage.clear();localStorage.setItem("smd_onboarding_tour","0");}catch(e){} var w=document.querySelector(".smdt-wel"); if(w) w.style.display="none"; return 1;`);
  await ev(STUB);

  // ── 1. the picker with the keyboard up ────────────────────────────────────────────────────────
  await ev(`SMD_PROFILE_SETUP.open(); return 1;`); await sleep(500);
  ok(await root() === true, "the form opens");
  await ev(`var b=document.querySelector('#pfSetupRoot [data-pick="speciality"]'); b.click(); return 1;`); await sleep(400);
  ok(await ev(`return !!document.getElementById("pfsQ") && !!document.getElementById("pfsL");`) === true, "the picker opens with a search box and a list");
  ok(await ev(`return document.querySelector("#pfSetupRoot .pfs-card").classList.contains("pfs-choose");`) === true, "the picker card opts into the flex layout");

  // Headless Chrome has no soft keyboard, so the visual-viewport change it causes is fed in
  // directly: a 390x844 phone with ~420px of keys leaves a 424px visual viewport.
  await ev(`document.getElementById("pfsQ").focus(); SMD_PROFILE_SETUP._fit({ height: 424, offsetTop: 0, width: 390 }); return 1;`); await sleep(350);
  const kb = JSON.parse(await ev(`
    var r=document.getElementById("pfSetupRoot"), c=r.querySelector(".pfs-card"), q=document.getElementById("pfsQ"), l=document.getElementById("pfsL"), a=r.querySelector(".pfs-acts");
    var rc=c.getBoundingClientRect(), qc=q.getBoundingClientRect(), lc=l.getBoundingClientRect(), ac=a.getBoundingClientRect();
    return JSON.stringify({kb:r.classList.contains("kb"), pad:r.style.getPropertyValue("--pfs-kb"), ih:window.innerHeight,
      cardTop:rc.top, cardBottom:rc.bottom, qTop:qc.top, qBottom:qc.bottom, lTop:lc.top, lBottom:lc.bottom, lH:lc.height,
      actsBottom:ac.bottom, scrollable:l.scrollHeight > l.clientHeight + 4});`));
  ok(kb.kb === true && kb.pad === "420px", "the keyboard height becomes the sheet's bottom inset " + JSON.stringify(kb));
  ok(kb.ih - kb.cardBottom >= 380, "the card is lifted clear of the keyboard, not left behind it " + JSON.stringify(kb));
  ok(kb.qTop >= kb.cardTop - 1 && kb.qBottom <= kb.cardBottom + 1, "the search box is ON SCREEN, not under the keyboard accessory bar " + JSON.stringify(kb));
  ok(kb.lH > 60, "the results list still has usable height with the keyboard up " + JSON.stringify(kb));
  ok(kb.lBottom <= kb.cardBottom + 1, "the list ends inside the card, so its last row is reachable " + JSON.stringify(kb));
  ok(kb.scrollable === true, "and the list itself scrolls, rather than the whole card " + JSON.stringify(kb));
  ok(kb.actsBottom <= kb.cardBottom + 1, "Back stays pinned inside the card " + JSON.stringify(kb));
  // Scrolling the list must actually move it - this is the "cant scroll" half of the report.
  const scrolled = await ev(`var l=document.getElementById("pfsL"); l.scrollTop = 200; return l.scrollTop;`);
  ok(scrolled > 0, "the list responds to scrolling (was " + scrolled + ")");
  await ev(`SMD_PROFILE_SETUP._fit(null); return 1;`); await sleep(200);
  ok(await ev(`var r=document.getElementById("pfSetupRoot"); return !r.classList.contains("kb");`) === true, "and the inset clears when the keyboard closes");

  // ── 2. Save with Firebase not yet loaded ──────────────────────────────────────────────────────
  await ev(`document.getElementById("pfsBack").click(); return 1;`); await sleep(300);
  await ev(`window.__toasts=[]; window.SMD_DB=null; window.SMD_AUTH=null; window.__loads=0; window.__loadWorks=true; window.__signedIn=true; return 1;`);
  await ev(`
    var d=SMD_PROFILE_SETUP; SMD_PROFILE_SETUP.close(); d.open(); return 1;`); await sleep(500);
  await fillRequired();
  await ev(`document.getElementById("pfsSave").click(); return 1;`); await sleep(900);
  ok(await ev(`return window.__loads > 0;`) === true, "Save loads Firebase on demand instead of giving up");
  ok(!/offline/i.test(await toasts()), "and never claims the phone is offline " + await toasts());
  ok(await ev(`return !!(window.__saved && window.__saved.profileComplete);`) === true, "the profile is written once the SDK arrives " + await toasts());

  // ── 3. genuinely signed out, and genuinely unreachable, say so differently ─────────────────────
  await ev(`window.__toasts=[]; window.__saved=null; window.SMD_DB=null; window.SMD_AUTH=null; window.__loadWorks=true; window.__signedIn=false; SMD_PROFILE_SETUP.close(); SMD_PROFILE_SETUP.open(); return 1;`); await sleep(500);
  await fillRequired();
  await ev(`document.getElementById("pfsSave").click(); return 1;`); await sleep(900);
  ok(/Sign in to save/i.test(await toasts()), "signed out says to sign in, not that the network is down " + await toasts());
  ok(await ev(`return document.getElementById("pfsSave") && document.getElementById("pfsSave").disabled === false;`) === true, "and Save is usable again, with the form still filled in");

  await ev(`window.__toasts=[]; window.SMD_DB=null; window.SMD_AUTH=null; window.__loadWorks=false; SMD_PROFILE_SETUP.close(); SMD_PROFILE_SETUP.open(); return 1;`); await sleep(500);
  await fillRequired();
  await ev(`document.getElementById("pfsSave").click(); return 1;`); await sleep(1200);
  ok(/Couldn.t reach your account/i.test(await toasts()), "a real failure to reach the account says so plainly " + await toasts());
  ok(await ev(`return !!document.querySelector('#pfSetupRoot [data-k="name"]') && document.querySelector('#pfSetupRoot [data-k="name"]').value === "Dr Manoj";`) === true, "the sheet stays open with everything typed still there");

  // ── 4. The Firebase SDK never arrives, but the doctor is signed in: the server writes the profile ──
  //     (owner, 2026-10-10, iPhone: "Couldn't reach your account" with full signal)
  await ev(`window.__toasts=[]; window.__saved=null; window.SMD_DB=null; window.__loadWorks=false; window.__srv=[];
    window.SMD_AUTH={ currentUser:{ uid:"u-doc-1", getIdToken:function(){ return Promise.resolve("tok-1"); } } };
    var rf=window.fetch; window.fetch=function(u,o){ if(String(u).indexOf("/api/auth/save-profile")>=0){ window.__srv.push({u:String(u),h:o&&o.headers,b:o&&o.body}); return Promise.resolve(new Response('{"ok":true}',{status:200})); } return rf.apply(this,arguments); };
    SMD_PROFILE_SETUP.close(); SMD_PROFILE_SETUP.open(); return 1;`); await sleep(500);
  await fillRequired();
  await ev(`document.getElementById("pfsSave").click(); return 1;`); await sleep(1500);
  const srv = JSON.parse(await ev(`return JSON.stringify(window.__srv);`) || "[]");
  ok(srv.length === 1 && srv[0].h.Authorization === "Bearer tok-1", "no SDK: Save posts to /api/auth/save-profile with the sign-in token " + JSON.stringify(srv.map((x) => x.u)));
  const sb = srv[0] ? JSON.parse(srv[0].b) : {};
  ok(sb.name === "Dr Manoj" && sb.phone === "8897298117" && sb.hospital === "King George Hospital" && sb.degree === "MD" && sb.role === "doctor", "with the form's fields " + JSON.stringify(sb));
  ok(/Profile saved/.test(await toasts()) && !/Couldn.t/.test(await toasts()), "and says Profile saved, not a network error " + await toasts());
  ok(await root() === false, "and the sheet closes");

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
