/* StewardMD — Watch-Lab client helper + consent UI (A2, opt-in).
 * Lets a signed-in doctor consent to background lab watching for a patient. Because
 * background polling runs on the server (only a server runs 24/7), the doctor's GHIS
 * login is stored server-side — so we collect it here behind an explicit consent tick
 * with a clear privacy note. Nothing is stored unless the doctor ticks consent.
 *
 * Public API (all Promise-based; require the doctor to be signed in with Google/Apple):
 *   window.SMD_WATCH.status()                         -> { consented, watching:[...] }
 *   window.SMD_WATCH.enableWithConsent(patient)       -> opens the consent sheet; resolves {ok}
 *   window.SMD_WATCH.add(patient) / remove(patientId) / forget()
 * `patient` = { patientId, episodeId?, name? }.
 */
(function () {
  "use strict";

  function apiBase() { return window.SMD_API_BASE || ""; }
  function toast(m) { try { (window.SMD_toast || function () {})(m); } catch (e) {} }
  async function idToken() {
    var u = window.SMD_AUTH && window.SMD_AUTH.currentUser;
    if (!u || !u.getIdToken) throw new Error("Sign in to use background lab alerts.");
    return u.getIdToken();
  }
  async function call(path, method, body) {
    var jwt = await idToken();
    var res = await fetch(apiBase() + "/api/watch/" + path, {
      method: method || "GET",
      headers: Object.assign({ "Authorization": "Bearer " + jwt }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    var j = {}; try { j = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(j.error || ("http_" + res.status));
    return j;
  }

  var SMD_WATCH = {
    status: function () { return call("status"); },
    add: function (patient) { return call("add", "POST", { patient: patient }); },
    remove: function (patientId) { return call("remove", "POST", { patientId: patientId }); },
    forget: function () { return call("forget", "POST", {}); },
    // Low-level: send consent + GHIS creds. Prefer enableWithConsent() which collects them.
    enable: function (ghisUserId, ghisPassword, patient) {
      return call("enable", "POST", { ghisUserId: ghisUserId, ghisPassword: ghisPassword, patient: patient, consent: true });
    },
    enableWithConsent: function (patient) { return openConsent(patient); },
  };
  window.SMD_WATCH = SMD_WATCH;

  // ── consent sheet (self-contained DOM + inline styles) ───────────────────────
  function openConsent(patient) {
    return new Promise(function (resolve) {
      if (document.getElementById("smdWatchSheet")) { resolve({ ok: false, cancelled: true }); return; }
      var wrap = document.createElement("div");
      wrap.id = "smdWatchSheet";
      wrap.setAttribute("style", "position:fixed;inset:0;z-index:20000;background:rgba(8,18,26,.55);display:flex;align-items:flex-end;justify-content:center");
      var prefillUser = "";
      try { prefillUser = (window.GHIS && GHIS.getUserId && GHIS.getUserId()) || ""; } catch (e) {}
      wrap.innerHTML =
        '<div role="dialog" aria-label="Background lab alerts" style="background:var(--panel,#fff);color:var(--ink,#0f172a);width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui);box-shadow:0 -10px 40px rgba(0,0,0,.25)">'
        + '<div style="font:800 17px/1.2 var(--serif,Georgia,serif);margin-bottom:6px">Background lab alerts</div>'
        + '<div style="font:500 12.5px/1.55 var(--sans,system-ui);color:var(--slate,#5a7184)">'
        + 'Get a notification when a <b>new lab is reported</b> for <b>' + esc(patient && patient.name || "this patient") + '</b> — even when the app is closed.'
        + '</div>'
        + '<div style="margin:12px 0;padding:11px 12px;border:1px solid var(--line,#e4eae8);border-radius:10px;background:var(--paper,#f6f8f6);font:500 11.5px/1.5 var(--sans,system-ui);color:var(--slate,#5a7184)">'
        + '🔒 To check in the background, StewardMD stores your <b>GHIS login</b> on our server, <b>encrypted</b> and <b>auto-deleted after 30 days</b>. You can turn this off anytime. '
        + 'Because our server can read it to sign in for you, this is optional and only happens if you consent below.'
        + '</div>'
        + '<input id="smdWatchUser" autocomplete="username" placeholder="GHIS User ID" value="' + esc(prefillUser) + '" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:11px;border:1px solid var(--line,#e4eae8);border-radius:9px;font:600 14px var(--sans,system-ui);background:var(--paper,#f6f8f6);color:var(--ink,#0f172a)">'
        + '<input id="smdWatchPass" type="password" autocomplete="current-password" placeholder="GHIS Password" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:11px;border:1px solid var(--line,#e4eae8);border-radius:9px;font:600 14px var(--sans,system-ui);background:var(--paper,#f6f8f6);color:var(--ink,#0f172a)">'
        + '<label style="display:flex;gap:9px;align-items:flex-start;font:500 12.5px/1.45 var(--sans,system-ui);color:var(--ink,#16232e);cursor:pointer;margin-bottom:14px">'
        + '<input id="smdWatchConsent" type="checkbox" style="width:17px;height:17px;margin-top:1px;flex:0 0 auto">'
        + '<span>I consent to StewardMD securely storing my GHIS login to check for new labs in the background (encrypted, auto-deleted in 30 days).</span></label>'
        + '<div style="display:flex;gap:10px">'
        + '<button id="smdWatchCancel" style="flex:1;padding:12px;border:1px solid var(--line,#e4eae8);border-radius:11px;background:var(--panel,#fff);color:var(--ink,#16232e);font:700 14px var(--sans,system-ui);cursor:pointer">Cancel</button>'
        + '<button id="smdWatchGo" style="flex:1;padding:12px;border:none;border-radius:11px;background:var(--teal,#0e6e63);color:#fff;font:800 14px var(--sans,system-ui);cursor:pointer">Enable alerts</button>'
        + '</div></div>';
      document.body.appendChild(wrap);
      var close = function (r) { try { wrap.remove(); } catch (e) {} resolve(r); };
      wrap.querySelector("#smdWatchCancel").addEventListener("click", function () { close({ ok: false, cancelled: true }); });
      wrap.addEventListener("click", function (e) { if (e.target === wrap) close({ ok: false, cancelled: true }); });
      wrap.querySelector("#smdWatchGo").addEventListener("click", function () {
        var user = wrap.querySelector("#smdWatchUser").value.trim();
        var pass = wrap.querySelector("#smdWatchPass").value;
        var consent = wrap.querySelector("#smdWatchConsent").checked;
        if (!consent) { toast("Please tick consent to continue."); return; }
        if (!user || !pass) { toast("Enter your GHIS User ID and password."); return; }
        var go = wrap.querySelector("#smdWatchGo"); go.disabled = true; go.textContent = "Enabling…";
        SMD_WATCH.enable(user, pass, patient)
          .then(function (r) { toast("Background lab alerts on ✅"); close({ ok: true, watching: r.watching }); })
          .catch(function (e) { go.disabled = false; go.textContent = "Enable alerts"; toast("Couldn't enable: " + (e.message || "try again")); });
      });
    });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
})();
