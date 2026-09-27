/* The Profile page (one page, permanent since 2026-09-27), in a real headless browser as the iOS app.
 *
 * Owner, 2026-09-27, with three screenshots: the sidebar's "Account & Verification", More >
 * "Profile" and Settings > "Profile & StewardMD ID" were three doors into overlapping pages. "Mix all
 * three into one Profile section ... all profile settings, everything at one place."
 *
 * Checks: one page carries identity, ID, verification, professional details, plan, usage, security
 * and sign-in; status is shown once; each drill-in reaches its screen; every entry point opens it;
 * the duplicate doors are gone; and smd_profile_hub="0" brings the old layout back.
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-profile-hub-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9421, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/hub-chrome-" + Date.now();
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



const IOS = `window.Capacitor = { isNativePlatform: function () { return true; }, getPlatform: function () { return "ios"; }, platform: "ios", Plugins: {} };`;
const STUB = `
  ["introPoster","splash","accountGate","introOverlay","smdBootSplash","pfSetupRoot","phvRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();});
  var vg=document.getElementById("verifyGate"); if (vg) { vg.classList.add("hidden"); vg.style.display="none"; }
  SMD_ACCOUNT.profile = function () { return { signedIn: true, name: "Dr Manoj Kumar Kurmana", email: "m@x.in", picture: "" }; };
  window.SMD_loadFirebase = function (cb) { cb && cb(); };
  window.SMD_AUTH = { currentUser: { uid: "u1", getIdToken: function () { return Promise.resolve("t"); } } };
  window.SMD_DB = { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return {
    get: function () { return Promise.resolve({ exists: true, data: function () { return Object.assign({ hospital: "King George Hospital", degree: "MD", speciality: "Internal Medicine", regNo: "APMC 84213" }, window.__pd || {}); } }); },
    set: function () { return Promise.resolve(); } }; } }; } }; } }; } };
  window.__calls = [];
  window.__ver = false;
  SMD_VERIFY.isVerified = function () { return Promise.resolve(window.__ver); };
  SMD_VERIFY.isTrainee = function () { return Promise.resolve(false); };
  SMD_VERIFY.openPanel = function () { window.__calls.push("verify"); };
  window.SMD_PHONE_VERIFY = window.SMD_PHONE_VERIFY || {};
  SMD_PHONE_VERIFY.open = function (n, o) { window.__calls.push("phone:" + (n || "") + (o && o.verified ? ":verified" : "")); };
  return 1;`;
const open = async () => { await ev(`document.getElementById("hvScrim") && document.getElementById("hvScrim").click(); return 1;`); await sleep(200); await ev(`SMD_openProfile(); return 1;`); await sleep(700); };
const q = (sel) => ev(`return !!document.querySelector(${JSON.stringify(sel)});`);
const txt = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.addScriptToEvaluateOnNewDocument", { source: IOS });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return typeof SMD_openProfile==="function" && typeof SMD_openSettings==="function" && !!window.SMD_VERIFY && !!document.getElementById("hvSheet")`) === true) break; }
  await sleep(1500);
  await ev(`localStorage.removeItem("smd_profile_hub"); return 1;`);
  await ev(STUB);

  // ── one page, everything on it ────────────────────────────────────────────────────────────────
  await open();
  ok(await q("#hvSheet.on .hv-pf.hub"), "Profile opens as the hub");
  const secs = await ev(`return [].map.call(document.querySelectorAll("#hvSheet .hv-pf-sec"), function(e){return e.textContent.trim()}).join("|");`);
  for (const s of ["StewardMD ID", "Verification", "Professional details", "Plan & usage", "Sign-in"]) ok(secs.indexOf(s) >= 0, `has the "${s}" section`);
  ok(await q('#hvSheet [data-hub="subscription"]') && await q('#hvSheet [data-hub="aiusage"]'), "subscription and AI usage are rows on it");
  ok(await q('#hvSheet [data-acct="signout"]') && await q('#hvSheet [data-acct="delete"]'), "sign out and delete are on it");
  ok(await txt("#hvSheet .hv-pf-pic") === "M", "the avatar initial is M for 'Dr Manoj', not D");
  await sleep(500);
  ok(/King George Hospital/.test(await txt('#hvSheet [data-row="hospital"] [data-val]') || ""), "professional details load into it");

  // ── status shown once; the call to action only when unverified ────────────────────────────────
  ok(await txt("#pfVerifyVal") === "Not verified", "unverified: the row says so");
  ok(await ev(`return !document.getElementById("pfVerifyCta").hidden;`) === true, "and the verify call to action is shown");
  ok(await ev(`return !document.querySelector("#pfBadges [data-verifbadge]");`) === true, "no second copy of the status as a hero badge");
  await ev(`window.__ver = true; return 1;`); await open();
  ok(await txt("#pfVerifyVal") === "Verified", "verified: the row says Verified");
  ok(await ev(`return document.getElementById("pfVerifyCta").hidden;`) === true, "and the call to action is gone");

  // ── drill-ins ─────────────────────────────────────────────────────────────────────────────────
  await ev(`document.querySelector('#hvSheet [data-hub="verify"]:not(#pfVerifyCta)').click(); return 1;`); await sleep(300);
  ok(await ev(`return window.__calls.indexOf("verify") >= 0;`) === true, "the Registration row opens the verification flow");
  ok(await ev(`var s=document.getElementById("hvSheet"); return !s.classList.contains("on");`) === true, "and Profile steps aside for it rather than stacking");
  await open();
  // Subscription goes to the full Pro paywall when it is present (its own overlay), else to a sheet.
  await ev(`window.__pw = 0; if (window.SMD_PRO) { SMD_PRO.openPaywall = function () { window.__pw++; }; } return 1;`);
  await ev(`document.querySelector('#hvSheet [data-hub="subscription"]').click(); return 1;`); await sleep(500);
  ok(await ev(`var s=document.getElementById("hvSheet"); return window.__pw > 0 || (s.classList.contains("on") && !s.querySelector(".hv-pf.hub"));`) === true, "Subscription opens plans & billing");

  // ── the mobile number: shown with its status, and changed only through the code ───────────────
  await ev(`window.__ver = false; window.__pd = { phone: "8897298117", phoneVerifiedAt: 1, phoneVerifiedNumber: "8897298117" }; return 1;`); await open(); await sleep(400);
  ok(await txt("#pfPhoneNum") === "8897298117" && await txt("#pfPhoneVal") === "Verified", "a verified number shows the number and Verified");
  ok(await ev(`return document.getElementById("pfVerifyCta").hidden;`) === true, "a verified phone alone clears the call to action (either one counts)");
  ok(await ev(`return !document.querySelector('#pfPro [data-row="phone"]');`) === true, "the phone is not duplicated under Professional details");
  await ev(`window.__pd = { phone: "9000000001", phoneVerifiedAt: 1, phoneVerifiedNumber: "8897298117" }; return 1;`); await open(); await sleep(400);
  ok(await txt("#pfPhoneVal") === "Not verified", "a number changed after verification reads Not verified");
  ok(await ev(`return !document.getElementById("pfVerifyCta").hidden;`) === true, "and, with no registration either, the call to action returns");
  await ev(`window.__pd = {}; return 1;`); await open(); await sleep(400);
  ok(await txt("#pfPhoneNum") === "Not added" && await txt("#pfPhoneVal") === "Add", "no number: Not added / Add");
  await ev(`window.__pd = { phone: "8897298117", phoneVerifiedNumber: "8897298117", phoneVerifiedAt: 1 }; window.__calls = []; return 1;`); await open(); await sleep(400);
  await ev(`document.querySelector('#hvSheet [data-hub="phone"]').click(); return 1;`); await sleep(300);
  ok(await ev(`return window.__calls.indexOf("phone:8897298117:verified") >= 0;`) === true, "tapping a verified number opens it as verified, not on Send code (2026-09-28)");
  await ev(`window.__pd = { phone: "9000000001", phoneVerifiedAt: 1, phoneVerifiedNumber: "8897298117" }; window.__calls = []; return 1;`); await open(); await sleep(400);
  await ev(`document.querySelector('#hvSheet [data-hub="phone"]').click(); return 1;`); await sleep(300);
  ok(await ev(`return window.__calls.indexOf("phone:9000000001") >= 0;`) === true, "an unverified number opens the code flow for it (edit = re-verify)");
  await ev(`window.__pd = null; return 1;`);

  // ── 2026-09-28: verified, and Profile still said Checking. Both reads fail or hang on the iOS WebView. ──
  // Both reads FAIL, nothing cached: the row answers from the account's claim instead of Checking for good.
  await ev(`window.__realGet = window.__realGet || null; window.__rf = window.__rf || window.fetch;
    window.SMD_DB = { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return { get: function () { return Promise.reject({ code: "unavailable" }); }, set: function () { return Promise.resolve(); } }; } }; } }; } }; } };
    window.fetch = function (u, o) { return /my-profile/.test(String(u)) ? Promise.reject(new Error("offline")) : window.__rf(u, o); };
    SMD_AUTH.currentUser.getIdTokenResult = function () { return Promise.resolve({ claims: { phoneVerified: true } }); };
    localStorage.removeItem("smd_profile_cache:u1"); return 1;`);
  await open(); await sleep(900);
  ok(await txt("#pfPhoneNum") === "Number not loaded" && await txt("#pfPhoneVal") === "Verified", "both reads failed: the row says Verified from the claim, not Checking (" + await txt("#pfPhoneNum") + " / " + await txt("#pfPhoneVal") + ")");
  // Both reads HANG: a code just verified still paints Verified, from this device's copy.
  await ev(`window.SMD_DB = { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return { get: function () { return new Promise(function () {}); }, set: function () { return Promise.resolve(); } }; } }; } }; } }; } };
    window.fetch = function (u, o) { return /my-profile/.test(String(u)) ? new Promise(function () {}) : window.__rf(u, o); };
    localStorage.removeItem("smd_profile_cache:u1");
    document.dispatchEvent(new CustomEvent("smd:phone-verified", { detail: { phone: "+91 88972 98117" } })); return 1;`);
  await open(); await sleep(400);
  ok(await txt("#pfPhoneNum") === "+91 88972 98117" && await txt("#pfPhoneVal") === "Verified", "just verified, both reads hanging: Profile paints the number as Verified at once");
  await ev(`window.fetch = window.__rf; localStorage.removeItem("smd_profile_cache:u1"); delete SMD_AUTH.currentUser.getIdTokenResult;
    window.SMD_DB = { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return {
      get: function () { return Promise.resolve({ exists: true, data: function () { return Object.assign({ hospital: "King George Hospital", degree: "MD", speciality: "Internal Medicine", regNo: "APMC 84213" }, window.__pd || {}); } }); },
      set: function () { return Promise.resolve(); } }; } }; } }; } }; } }; return 1;`);

  // ── every door leads here, and the duplicate doors are gone ───────────────────────────────────
  await ev(`document.getElementById("hvScrim").click(); SMD_openSettings(); return 1;`); await sleep(300);
  const rows = await ev(`return [].map.call(document.querySelectorAll("#sbrSettings .sbr-row"), function(e){return e.textContent.trim()}).filter(function(t){return /profile|verification/i.test(t)}).join("|");`);
  ok(rows === "Profile, ID & verification", "Settings has ONE account row, not two (" + rows + ")");
  await ev(`document.querySelector('#sbrSettings [data-sbr-act="profile"]').click(); return 1;`); await sleep(600);
  ok(await q("#hvSheet.on .hv-pf.hub"), "and it opens the hub");
  // The drawer's first row is PROFILE (owner, 2026-09-27: "want profile button here").
  await ev(`document.getElementById("hvScrim").click(); try { SB.open(); } catch (e) {} return 1;`); await sleep(600);
  const drow = await ev(`var b=document.querySelector('#sbMenu [data-smd-profile]'); return b ? b.textContent.trim() : null;`);
  ok(drow === "Profile", "the drawer has a Profile row where Account & Verification was (" + drow + ")");
  ok(await ev(`return !/Account\s*&\s*Verification/.test(document.getElementById("sbMenu").textContent);`) === true, "and no Account & Verification row");
  await ev(`document.querySelector('#sbMenu [data-smd-profile]').click(); return 1;`); await sleep(700);
  ok(await q("#hvSheet.on .hv-pf.hub"), "tapping it opens the Profile page");

  // ── hardcoded: the retired switch changes nothing ─────────────────────────────────────────────
  await ev(`localStorage.setItem("smd_profile_hub", "0"); return 1;`);
  await open();
  ok(await q("#hvSheet.on .hv-pf.hub"), 'the one Profile page is permanent: smd_profile_hub="0" no longer reverts it');
  await ev(`document.getElementById("hvScrim").click(); SMD_openSettings(); return 1;`); await sleep(300);
  ok(!(await q('#sbrSettings [data-sbr-act="account"]')), "and Settings keeps its single Profile row");
  await ev(`localStorage.removeItem("smd_profile_hub"); var o=document.getElementById("sbrSettings"); if(o) o.remove(); return 1;`);

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
