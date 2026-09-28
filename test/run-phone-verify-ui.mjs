/* The mobile-number verification sheet, driven in a real headless browser against the real app.
 *
 * Owner request 2026-09-19: after sign-in, every account is asked to verify its phone over WhatsApp
 * with SMS as backup. Stubs: a signed-in account (getIdToken / getIdTokenResult), a Firestore
 * double, and /api/auth/phone-* answered in-page. No network, no PHI.
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-phone-verify-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9399, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/phv-chrome-" + Date.now();
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
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// A signed-in doctor, a Firestore double, and an in-page /api/auth/phone-* server.
const STUB = `
  window.__claims = {}; window.__profile = { name: "Dr Asha Rao", phone: "98765 43210", hospital: "GIMSR", degree: "MD", speciality: "Internal Medicine", role: "doctor" };   // role is a required profile field (Role box), else profile-setup opens first
  window.__saved = {}; window.__calls = []; window.__code = "482913"; window.__wa = true; window.__tries = 0; window.__srvOff = false;
  window.__left = { whatsapp: 2, sms: 1 };   // server budget: 2 WhatsApp + 1 SMS per account per day
  window.SMD_AUTH = {
    currentUser: { uid: "u-doc-1", displayName: "Dr Asha Rao", email: "asha@hospital.org",
      getIdToken: function () { return Promise.resolve("tok"); },
      getIdTokenResult: function (force) { window.__forced = (window.__forced || 0) + (force ? 1 : 0); return Promise.resolve({ claims: force && window.__freshClaims ? window.__freshClaims : window.__claims }); } },
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(window.SMD_AUTH.currentUser); }, 0); }
  };
  window.SMD_DB = { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return {
    get: function () { if (window.__dbFail === "reject") return Promise.reject(new Error("unavailable")); if (window.__dbFail === "hang") return new Promise(function () {});
      return Promise.resolve({ exists: true, data: function () { return window.__profile; } }); },
    set: function (o) { Object.assign(window.__saved, o); Object.assign(window.__profile, o); return Promise.resolve(); }
  }; } }; } }; } }; } };
  // The app lazy-loads the real Firebase SDK, and when that finishes it assigns window.SMD_AUTH /
  // SMD_DB, replacing these stubs with a signed-out account (~1 run in 10 here). Pin the stubs.
  window.__smdFbBooted = true;
  ["SMD_AUTH", "SMD_DB"].forEach(function (k) { var v = window[k]; try { Object.defineProperty(window, k, { configurable: true, get: function () { return v; }, set: function () {} }); } catch (e) {} });
  var _f = window.fetch;
  window.fetch = function (u, o) {
    u = String(u);
    if (u.indexOf("/api/auth/phone-") < 0) return _f.apply(this, arguments);
    var body = {}; try { body = JSON.parse(o.body); } catch (e) {}
    window.__calls.push({ path: u.split("/").pop(), body: body, auth: o.headers && o.headers.Authorization });
    var reply = function (j, s) { return Promise.resolve({ ok: true, status: s || 200, json: function () { return Promise.resolve(j); } }); };
    if (window.__srvOff) return reply({ ok: false, error: "off" });
    if (u.indexOf("phone-start") > 0 && window.__inUse) return reply({ ok: false, error: "phone-in-use" }, 409);
    if (u.indexOf("phone-verify") > 0 && window.__inUseAtVerify) return reply({ ok: false, error: "phone-in-use" }, 409);
    if (u.indexOf("phone-start") > 0) {
      var digits = String(body.phone || "").replace(/\\D/g, ""); if (digits.length < 10) return reply({ ok: false, error: "bad-phone" }, 400);
      var L = window.__left;
      if (!L.whatsapp && !L.sms) return reply({ ok: false, error: "send-cap", left: L }, 429);
      if (body.channel === "sms" && !L.sms) return reply({ ok: false, error: "sms-used", left: L }, 429);
      var ch = body.channel === "sms" ? "sms" : ((window.__wa && L.whatsapp) ? "whatsapp" : (L.sms ? "sms" : null));
      if (!ch) return reply({ ok: false, error: "send-failed", left: L });
      L[ch]--;
      return reply({ ok: true, sent: true, channel: ch, fellBack: body.channel !== "sms" && ch === "sms" && !window.__wa, ttl: 600, to: "+91 ******" + digits.slice(-4), left: { whatsapp: L.whatsapp, sms: L.sms } });
    }
    if (String(body.code) === window.__code) return reply({ ok: true, verified: true });
    window.__tries++; return reply({ ok: false, error: "mismatch", triesLeft: 5 - window.__tries }, 400);
  };
  return 1;`;

const on = () => ev(`var r=document.getElementById("phvRoot"); return !!(r && r.classList.contains("on"));`);
// Poll rather than trust a fixed sleep: the sheet opens on a 1.5 s gate poll + 400 ms, which a
// slow runner can miss by a few ms.
const waitOn = async (want, ms = 4000) => { const t0 = Date.now(); let v; do { v = await on(); if (v === want) return v; await sleep(150); } while (Date.now() - t0 < ms); return v; };
const text = () => ev(`var r=document.getElementById("phvRoot"); return r ? r.innerText : "";`);
const click = (id) => ev(`var b=document.getElementById("${id}"); if(!b) return "missing"; b.click(); return "clicked";`);
const type = (id, v) => ev(`var i=document.getElementById("${id}"); i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event("input",{bubbles:true})); return i.value;`);

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_PHONE_VERIFY && window.SMD_PROFILE_SETUP)`) === true) { ready = true; break; } }
  ok(ready, "phone-verify.js and profile-setup.js load with the app");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{sessionStorage.clear();localStorage.removeItem("smd_phone_verified_u-doc-1");localStorage.removeItem("smd_phone_verify");localStorage.setItem("smd_onboarding_tour","0");}catch(e){} var w=document.querySelector(".smdt-wel"); if(w) w.style.display="none"; return 1;`);

  // ── the auto-prompt after sign-in ──
  // A real unverified account has the registration gate open at sign-in; the phone sheet must wait
  // for it, not stack on it.
  await ev(STUB);
  await ev(`var g=document.getElementById("verifyGate"); if(g){ g.classList.remove("hidden"); g.style.display="flex"; } return 1;`);
  await ev(`SMD_PHONE_VERIFY._start(); return 1;`);
  await sleep(3200);
  ok(await on() === false, "while the registration gate is open the phone sheet waits");
  await ev(`var g=document.getElementById("verifyGate"); if(g){ g.classList.add("hidden"); g.style.display="none"; } SMD_PHONE_VERIFY._reset(); return 1;`);
  ok(await waitOn(true) === true, "and opens once the gate closes");
  await ev(`SMD_PHONE_VERIFY.close(); SMD_PHONE_VERIFY._reset(); var w=document.createElement("div"); w.className="smdt-wel"; w.style.display="flex"; document.body.appendChild(w); SMD_PHONE_VERIFY.check(); return 1;`); await sleep(1400);
  ok(await on() === false, "while the first-launch guided tour is up the phone sheet waits");
  await ev(`document.querySelector(".smdt-wel").remove(); return 1;`);
  ok(await waitOn(true) === true, "and opens once the tour is dismissed");
  await sleep(800);   // let the entrance animation settle before measuring
  // verify.js re-evaluates the stubbed (unverified) account and may re-show its gate; hide it again
  // so the geometry check measures the phone sheet itself, not that unrelated overlay.
  await ev(`var g=document.getElementById("verifyGate"); if(g){ g.classList.add("hidden"); g.style.display="none"; } return 1;`);
  const geo = await ev(`var c=document.querySelector("#phvRoot .phv-card"); var r=c&&c.getBoundingClientRect(); var e=r&&document.elementFromPoint(r.left+20, r.top+20); return JSON.stringify({h:r&&r.height,top:r&&r.top,bottom:r&&r.bottom,ih:window.innerHeight,hit:e?(e.id||e.className||e.tagName):null,inside:!!(e&&c.contains(e))});`);
  const g = JSON.parse(geo);
  ok(g.h > 200 && g.top >= 0 && g.bottom <= g.ih + 2 && g.inside, "the sheet is on screen and on top (nothing covers it) " + geo);
  if (process.env.SHOT) { const shot = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-phone.png"), Buffer.from(shot.result.data, "base64")); }
  await ev(`SMD_PHONE_VERIFY.close(); SMD_PHONE_VERIFY._reset(); return 1;`);
  // The real SMD_AUTH existed before the stub, so re-run the bootstrap against the stub: the auth
  // listener fires, and check() runs 2 s later exactly as it does on a real sign-in.
  await ev(`SMD_PHONE_VERIFY._start(); return 1;`);
  ok(await waitOn(true, 6000) === true, "the sheet opens on its own after sign-in when the phone is not verified");
  ok(/Verify your mobile number/.test(await text()), "it asks to verify the mobile number");
  ok(await ev(`return document.getElementById("phvPhone").value;`) === "98765 43210", "the profile's phone is pre-filled");
  ok(/WhatsApp/.test(await text()) && /SMS instead/.test(await text()), "WhatsApp is the default, SMS is offered as the backup");

  // ── bad number is caught before any request ──
  await type("phvPhone", "123"); await click("phvSend"); await sleep(200);
  ok(/valid mobile number/.test(await text()), "a short number is refused in-sheet");
  ok(await ev(`return window.__calls.length;`) === 0, "and no request was made");

  // ── send on WhatsApp ──
  await type("phvPhone", "+91 98765 43210"); await click("phvSend"); await sleep(600);
  ok(await ev(`return window.__calls[0] && window.__calls[0].path;`) === "phone-start", "Send calls /api/auth/phone-start");
  ok(await ev(`return window.__calls[0].auth;`) === "Bearer tok", "with the account's ID token");
  ok(/Sent by WhatsApp/.test(await text()) && /\*\*\*\*\*\*3210/.test(await text()), "the code step names WhatsApp and the masked number");
  ok(/Resend code in \d+s/.test(await text()), "resend is on a countdown");
  ok(await ev(`var cd=document.querySelector("#phvResend .phv-cd"); return !!cd;`) === true, "with a countdown ring");
  ok(await ev(`var b=document.getElementById("phvSms2"); return !!(b && b.disabled);`) === true, "SMS instead waits out the same 30 s (the server would answer too-soon)");
  ok(/Codes left today: 1 on WhatsApp, 1 by SMS/.test(await text()), "the sheet shows the remaining send budget");
  if (process.env.SHOT) { await ev(`document.body.classList.add("dark"); return 1;`); await sleep(250); const shot = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-dark.png"), Buffer.from(shot.result.data, "base64")); await ev(`document.body.classList.remove("dark"); return 1;`); }
  if (process.env.SHOT) { const shot = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, "base64")); }

  // ── wrong code, then right code ──
  ok(await ev(`return document.querySelectorAll("#phvSlots .phv-slot").length;`) === 6 && await ev(`return document.querySelector("#phvSlots .phv-slot.on") && document.querySelector("#phvSlots .phv-slot.on").getAttribute("data-i");`) === "0", "six code slots, the first one waiting for a digit");
  ok(await ev(`return document.getElementById("phvCode").getAttribute("autocomplete");`) === "one-time-code", "the input is marked one-time-code so the keyboard offers the SMS code");
  await type("phvCode", "48"); await sleep(150);
  ok(await ev(`var f=document.querySelectorAll("#phvSlots .phv-slot.filled"); var on=document.querySelector("#phvSlots .phv-slot.on"); return f.length===2 && f[0].innerText.trim()==="4" && f[1].innerText.trim()==="8" && on && on.getAttribute("data-i")==="2";`) === true, "typed digits fill the slots and the ring moves to the next one");
  ok(await ev(`return !/[\u{1F300}-\u{1FAFF}]/u.test(document.getElementById("phvRoot").innerText) && document.querySelectorAll("#phvRoot svg").length >= 8;`) === true, "no emoji anywhere; icons are inline SVG");
  if (process.env.SHOT) { const shot = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-typing.png"), Buffer.from(shot.result.data, "base64")); }
  // ── the keyboard (owner, 2026-09-21: "when keyboard is opened the dialog box doesnt go up") ──
  // Headless Chrome has no soft keyboard, so the visual-viewport change it causes is fed in
  // directly: a 390x844 phone with ~420px of keys leaves a 424px visual viewport.
  await ev(`document.getElementById("phvCode").focus(); SMD_PHONE_VERIFY._fit({ height: 424, offsetTop: 0, width: 390 }); return 1;`); await sleep(300);
  // Another script scales open overlays for their entrance, so geometry is read RELATIVE to the
  // root's own box rather than in absolute pixels.
  const kb = JSON.parse(await ev(`var r=document.getElementById("phvRoot"); var rr=r.getBoundingClientRect(); var c=r.querySelector(".phv-card").getBoundingClientRect(); var sl=document.getElementById("phvSlots").getBoundingClientRect(); var ft=r.querySelector(".phv-foot").getBoundingClientRect(); return JSON.stringify({kb:r.classList.contains("kb"), pad:r.style.getPropertyValue("--pv-kb"), rootH:rr.height, ih:window.innerHeight, cardTop:c.top, cardBottom:c.bottom, footBottom:ft.bottom, slotsTop:sl.top, slotsBottom:sl.bottom});`));
  ok(kb.kb === true && kb.pad === "420px", "the keyboard height becomes the sheet's bottom inset " + JSON.stringify(kb));
  ok(kb.rootH >= kb.ih * 0.95, "the scrim still covers the whole screen, so no app chrome shows through under the sheet");
  ok(kb.ih - kb.cardBottom >= 380, "the card is lifted clear of the keyboard, not left behind it " + JSON.stringify(kb));
  ok(Math.abs(kb.footBottom - kb.cardBottom) < 2, "the action buttons are pinned to the bottom of the card " + JSON.stringify(kb));
  ok(kb.slotsTop >= kb.cardTop - 1 && kb.slotsBottom <= kb.cardBottom + 1, "the code slots are on screen while typing");
  await ev(`SMD_PHONE_VERIFY._fit(null); return 1;`); await sleep(150);
  ok(await ev(`var r=document.getElementById("phvRoot"); return !r.classList.contains("kb") && (r.style.getPropertyValue("--pv-kb")==="0px"||!r.style.getPropertyValue("--pv-kb"));`) === true, "and the inset clears when the keyboard closes");
  const sheet = JSON.parse(await ev(`var c=document.querySelector("#phvRoot .phv-card").getBoundingClientRect(); return JSON.stringify({top:c.top, bottom:c.bottom, ih:window.innerHeight});`));
  ok(sheet.top >= 40 && sheet.bottom >= sheet.ih - 14, "it reads as a bottom sheet: dimmed app visible above it, flush to the bottom " + JSON.stringify(sheet));

  await type("phvCode", "000000"); await sleep(600);
  ok(/not right/.test(await text()) && /4 tries left/.test(await text()), "a wrong code shows the tries left");
  ok(await ev(`var s=document.getElementById("phvSlots"); return s.classList.contains("bad") && document.getElementById("phvCode").value==="";`) === true, "the row shakes red and clears for another try");
  ok(await on() === true, "and the sheet stays open");
  await ev(`window.__pvEv = null; document.addEventListener("smd:phone-verified", function (e) { window.__pvEv = e.detail && e.detail.phone; }, { once: true }); return 1;`);
  await type("phvCode", "482913"); await sleep(300);
  ok(await ev(`var s=document.getElementById("phvSlots"); return !!(s && s.classList.contains("ok"));`) === true, "the six slots sweep green on the right code");
  ok(await ev(`return window.__pvEv;`) === "+91 98765 43210", "smd:phone-verified carries the verified number (Profile paints it without a read)");
  if (process.env.SHOT) { const shot = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-ok.png"), Buffer.from(shot.result.data, "base64")); }
  await sleep(1200);
  ok(await on() === false, "six correct digits verify automatically and close the sheet");
  ok(await ev(`return window.__calls[window.__calls.length-1].path;`) === "phone-verify", "via /api/auth/phone-verify");
  ok(await ev(`return !!window.__saved.phoneVerifiedAt && window.__saved.phone === "+91 98765 43210";`) === true, "the profile records the verified number and time");
  ok(await ev(`try{return localStorage.getItem("smd_phone_verified_u-doc-1")}catch(e){return null}`) === "1", "this device remembers it is done");

  // ── it does not ask again once verified (claim OR local memory) ──
  await ev(`SMD_PHONE_VERIFY._reset(); window.__claims = { phoneVerified: true }; return 1;`);
  await ev(`SMD_PHONE_VERIFY.check(); return 1;`); await sleep(900);
  ok(await on() === false, "a verified claim means it never asks");

  // ── owner 2026-09-28: Profile said Verified, the sheet still asked ──
  // The cached token predates the claim; a fresh token carries it. Refresh before asking.
  await ev(`try{localStorage.removeItem("smd_phone_verified_u-doc-1")}catch(e){} delete window.__profile.phoneVerifiedAt; window.__claims = {}; window.__freshClaims = { phoneVerified: true }; window.__forced = 0; window.__dbFail = "reject"; SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.check(); return 1;`); await sleep(900);
  ok(await on() === false, "a stale cached token is refreshed before asking; the fresh claim says verified, so it does not ask");
  ok(await ev(`return window.__forced`) >= 1, "(it forced one token refresh)");
  // No claim even on a fresh token, and the profile read FAILS: can't tell, so it does not nag.
  await ev(`try{localStorage.removeItem("smd_phone_verified_u-doc-1")}catch(e){} window.__freshClaims = null; window.__dbFail = "reject"; SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.check(); return 1;`); await sleep(900);
  ok(await on() === false, "a profile read that fails is not taken as unverified");
  await ev(`window.__dbFail = "hang"; SMD_PHONE_VERIFY._reset(); var r = null; SMD_PHONE_VERIFY.needed(function (y) { window.__hangAns = y; }); return 1;`); await sleep(9000);
  ok(await ev(`return window.__hangAns`) === false, "a profile read that hangs gives up after a few seconds and does not ask");
  // A readable profile with no verification still asks, as before.
  await ev(`window.__dbFail = null; SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.check(); return 1;`); await sleep(900);
  ok(await on() === true, "an account that really is unverified is still asked");
  await ev(`SMD_PHONE_VERIFY.close(); window.__claims = {}; return 1;`); await sleep(300);

  // ── the SMS-instead path and the server fallback flag ──
  await ev(`try{localStorage.removeItem("smd_phone_verified_u-doc-1")}catch(e){} window.__claims = {}; window.__calls = []; SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.open("9876543210"); return 1;`); await sleep(300);
  await click("phvSms"); await sleep(600);
  ok(await ev(`return window.__calls[0].body.channel;`) === "sms", "Send by SMS instead asks the server for SMS");
  ok(/Sent by SMS/.test(await text()), "and the code step says SMS");
  ok(await ev(`return !document.getElementById("phvSms2");`) === true, "no second SMS offer once it is already SMS");
  await click("phvBack"); await sleep(200);
  ok(/Verify your mobile number/.test(await text()), "Change number goes back to the number step");
  await ev(`window.__wa = false; window.__left = { whatsapp: 2, sms: 1 }; return 1;`);
  await click("phvSend"); await sleep(600);
  ok(/went by SMS/.test(await text()), "when WhatsApp fails server-side the sheet says the code went by SMS");
  await click("phvVerify"); await sleep(200);
  ok(/Enter the 6-digit code/.test(await text()), "Verify with an empty code is caught in-sheet");

  // ── max 3 codes per account: 2 on WhatsApp + 1 by SMS (owner 2026-09-26) ──
  await ev(`window.__wa = true; window.__left = { whatsapp: 2, sms: 1 }; window.__calls = []; SMD_PHONE_VERIFY.close(); SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.open("9876543210"); return 1;`); await sleep(300);
  await click("phvSend"); await sleep(500); await click("phvBack"); await sleep(150);
  await click("phvSend"); await sleep(500);
  ok(/Sent by WhatsApp/.test(await text()) && /Codes left today: 1 by SMS\./.test(await text()), "after 2 WhatsApp codes only the SMS one is left");
  ok(/Resend by SMS in \d+s/.test(await text()) && await ev(`return !document.getElementById("phvSms2");`) === true, "Resend switches to SMS and there is no duplicate SMS button");
  await click("phvBack"); await sleep(150);
  await click("phvSms"); await sleep(500);
  ok(/Sent by SMS/.test(await text()) && /No more codes today/.test(await text()), "the SMS code is the third and last");
  ok(await ev(`return !document.getElementById("phvResend") && !document.getElementById("phvSms2");`) === true, "no resend offered once the budget is spent");
  await click("phvBack"); await sleep(150);
  ok(await ev(`return !document.getElementById("phvSms");`) === true, "the number step drops Use SMS instead once SMS is used");
  await click("phvSend"); await sleep(500);
  ok(/used all 3 codes for today/.test(await text()), "a fourth send is refused with a clear message (send-cap)");
  ok(await ev(`return window.__calls.filter(function(c){return c.path==="phone-start"}).length;`) === 4, "3 sends went out, the 4th was refused server-side");
  await ev(`window.__left = { whatsapp: 2, sms: 1 }; return 1;`);

  // ── Later snoozes for this app-open ──
  await click("phvBack"); await sleep(150); await click("phvLater"); await sleep(200);
  ok(await on() === false, "Later closes the sheet");
  ok(await ev(`try{return sessionStorage.getItem("smd_phone_verify_snoozed")}catch(e){return null}`) === "1", "snoozed for this app-open only (sessionStorage)");
  await ev(`SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.check(); return 1;`); await sleep(900);
  ok(await on() === false, "and check() respects the snooze");

  // ── one number, one account (audit finding 14): the server refuses a number another live account holds ──
  await ev(`window.__calls = []; window.__inUse = true; SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.open("9876543210"); return 1;`); await sleep(300);
  await click("phvSend"); await sleep(600);
  const inUse = await text();
  ok(/This number is already verified on another StewardMD account\. Use a different number, or sign in to that account\./.test(inUse), "phone-in-use at Send shows the plain sentence");
  ok(!/\u2014/.test(inUse), "no em-dash in the sheet");
  ok(await on() === true && !!(await ev(`return !!document.getElementById("phvPhone");`)) && !(await ev(`return !!document.getElementById("phvCode");`)), "the sheet stays on the number step so another number can be entered");
  ok(await ev(`return window.__calls.length === 1 && window.__calls[0].path === "phone-start";`) === true, "one phone-start, no verify attempted");
  // Taken between Send and Verify: the code step says the same sentence.
  await ev(`window.__inUse = false; window.__inUseAtVerify = true; return 1;`);
  await type("phvPhone", "9876543210"); await click("phvSend"); await sleep(600);
  await type("phvCode", "482913"); await sleep(700);
  ok(/already verified on another StewardMD account/.test(await text()), "phone-in-use at Verify shows the same sentence");
  ok(await ev(`try{return localStorage.getItem("smd_phone_verified_u-doc-1")}catch(e){return null}`) !== "1", "and the device is not marked verified");
  await ev(`window.__inUseAtVerify = false; SMD_PHONE_VERIFY.close(); return 1;`);

  // ── a number already verified: Profile opens the sheet on that, not on Send code (owner, 2026-09-28:
  // "on pressing it again sends the code") ──
  await ev(`window.__calls = []; SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.open("+91 98765 43210", { verified: true }); return 1;`); await sleep(300);
  const done = await text();
  ok(/Number verified/.test(done) && /\+91 98765 43210 is verified on this account/.test(done), "a verified number opens on Number verified, naming it");
  ok(await ev(`return !document.getElementById("phvSend") && !document.getElementById("phvCode");`) === true && await ev(`return window.__calls.length;`) === 0, "no Send button, no code step, nothing sent");
  ok(!/—/.test(done), "no em-dash on it");
  if (process.env.SHOT) { const shot = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-verified.png"), Buffer.from(shot.result.data, "base64")); }
  await click("phvChange"); await sleep(300);
  ok(await ev(`var i=document.getElementById("phvPhone"); return i && i.value;`) === "+91 98765 43210" && await ev(`return window.__calls.length;`) === 0, "Change number goes to the number step, filled in, still nothing sent");
  await ev(`SMD_PHONE_VERIFY.open("+91 98765 43210", { verified: true }); return 1;`); await sleep(300);
  await click("phvDone"); await sleep(200);
  ok(await on() === false, "Done closes it");
  await ev(`SMD_PHONE_VERIFY.open("+91 98765 43210"); return 1;`); await sleep(300);
  ok(await ev(`return !!document.getElementById("phvSend");`) === true, "opened without verified (an unverified number): the Send code step, as before");
  await ev(`SMD_PHONE_VERIFY.close(); return 1;`);

  // ── kill switches ──
  await ev(`try{sessionStorage.clear(); localStorage.setItem("smd_phone_verify","0")}catch(e){} SMD_PHONE_VERIFY._reset(); SMD_PHONE_VERIFY.check(); return 1;`); await sleep(900);
  ok(await on() === false, "smd_phone_verify=0 disables the prompt on the client");
  await ev(`try{localStorage.removeItem("smd_phone_verify")}catch(e){} window.__srvOff = true; SMD_PHONE_VERIFY.open("9876543210"); return 1;`); await sleep(300);
  await click("phvSend"); await sleep(600);
  ok(await on() === false, "PHONE_VERIFY_ON=0 on the server ({error:off}) closes the sheet quietly");

  // ── waits for the first-run profile form instead of stacking on it ──
  await ev(`window.__srvOff = false; delete window.__profile.phoneVerifiedAt; try{sessionStorage.clear()}catch(e){} SMD_PHONE_VERIFY._reset(); var pf=document.createElement("div"); pf.id="pfSetupRoot"; pf.className="on"; document.body.appendChild(pf); SMD_PHONE_VERIFY.check(); return 1;`); await sleep(900);
  ok(await on() === false, "while the profile form is open the phone sheet waits");
  await ev(`document.getElementById("pfSetupRoot").classList.remove("on"); document.dispatchEvent(new CustomEvent("smd:profile-saved",{detail:{phone:"+91 91234 56789"}})); return 1;`); await sleep(900);
  ok(await on() === true && await ev(`return document.getElementById("phvPhone").value;`) === "+91 91234 56789", "after the profile saves it opens with the phone just entered");
  ok(await ev(`return document.querySelector("#phvRoot .phv-card") && getComputedStyle(document.querySelector("#phvRoot .phv-card")).fontFamily;`) !== "", "the sheet is styled");

  console.log(fails === 0 ? "\nALL GREEN - every signed-in account is asked to verify its mobile on WhatsApp, with SMS as the backup" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
