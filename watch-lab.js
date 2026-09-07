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
  function toast(m) { try { (window.SMD_toast || window.toast || function () {})(m); } catch (e) {} }
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

  /* Resolve a push-notification's opaque `ref` back to the real patientId, entirely client-side
   * after the doctor is signed in. The server deliberately never puts patientId in a push (see
   * functions/api/watch/[[path]].js) — it puts this `ref` instead, which means nothing outside an
   * authenticated GET /api/watch/status for this doctor's own account. Retries because the tap can
   * land before Firebase auth has hydrated (idToken() throws until then) or, just after `add`,
   * before the write has settled. Resolves null, never throws, so a caller can always no-op safely. */
  function resolveRef(ref, opts) {
    opts = opts || {};
    var maxTries = opts.maxTries || 20, delay = opts.delay || 500, tries = 0;
    return new Promise(function (resolve) {
      (function attempt() {
        tries++;
        call("status").then(function (j) {
          var hit = (j.watching || []).filter(function (w) { return w && w.ref === ref; })[0];
          if (hit) return resolve(hit.patientId);
          if (tries >= maxTries) return resolve(null);
          setTimeout(attempt, delay);
        }).catch(function () {
          if (tries >= maxTries) return resolve(null);
          setTimeout(attempt, delay);
        });
      })();
    });
  }

  var SMD_WATCH = {
    status: function () { return call("status"); },
    resolveRef: resolveRef,
    add: function (patient) { return call("add", "POST", { patient: patient }); },
    remove: function (patientId) { return call("remove", "POST", { patientId: patientId }); },
    forget: function () { return call("forget", "POST", {}); },
    // Low-level: send consent + GHIS creds. Prefer enableWithConsent() which collects them.
    enable: function (ghisUserId, ghisPassword, patient) {
      return call("enable", "POST", { ghisUserId: ghisUserId, ghisPassword: ghisPassword, patient: patient, consent: true });
    },
    enableWithConsent: function (patient) { return openConsent(patient); },
    openManager: function () { return openManager(); },
    count: function () { return call("status").then(function (s) { return ((s && s.watching) || []).length; }).catch(function () { return 0; }); },
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
        '<div role="dialog" aria-label="Lab Watch 24/7" style="background:var(--panel,#fff);color:var(--ink,#0f172a);width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui);box-shadow:0 -10px 40px rgba(0,0,0,.25)">'
        + '<div style="font:800 17px/1.2 var(--serif,Georgia,serif);margin-bottom:6px">Lab Watch 24/7</div>'
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
        + '<button id="smdWatchCancel" aria-label="Close" style="flex:1;padding:12px;border:1px solid var(--line,#e4eae8);border-radius:11px;background:var(--panel,#fff);color:var(--ink,#16232e);font:700 14px var(--sans,system-ui);cursor:pointer">Cancel</button>'
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
          .then(function (r) { toast("Lab Watch 24/7 on ✅"); close({ ok: true, watching: r.watching }); })
          .catch(function (e) {
            go.disabled = false; go.textContent = "Enable alerts";
            if (e && /needs-pro/.test(e.message || "")) {
              close({ ok: false, needsPro: true });
              // e.body carries the server's reason when SMD_WATCH could attach it; the explainer
              // falls back to this account's cached entitlement when it could not.
              try { if (window.SMD_PRO_NOTICE) { SMD_PRO_NOTICE.show("lab-watch", (e && e.body) || null); return; } } catch (x) {}
              try { if (window.SMD_PRO && SMD_PRO.openPaywall) { SMD_PRO.openPaywall("labwatch"); return; } } catch (x) {}
              toast("Lab Watch 24/7 is a StewardMD Pro feature.");
              return;
            }
            toast("Couldn't enable: " + (e.message || "try again"));
          });
      });
    });
  }
  // ── watched-patients manager (view / remove; adding a patient happens from Ward Sync
  //    or the ICU Lab Watch sheet, both of which open the consent flow above). ───────────
  function sinceLabel(ts) {
    try {
      var d = Date.now() - ts; if (!(d >= 0)) return "";
      if (d < 36e5) return Math.max(1, Math.round(d / 6e4)) + "m ago";
      if (d < 864e5) return Math.round(d / 36e5) + "h ago";
      return Math.round(d / 864e5) + "d ago";
    } catch (e) { return ""; }
  }
  // Lab Watch 24/7 runs on the server (so it can alert when the app is closed) and therefore
  // needs a Google/Apple account — SEPARATE from the GHIS / Ward Sync login. When the caller is
  // not signed in we show this actionable sheet (with a real Sign in button) instead of a toast
  // that used to vanish silently, so the button never looks dead again.
  function openSignInSheet(msg) {
    if (document.getElementById("smdWatchSignin")) return;
    var hasG = typeof window.SMD_signInWithGoogle === "function";
    var hasA = typeof window.SMD_signInWithApple === "function";
    var wrap = document.createElement("div");
    wrap.id = "smdWatchSignin";
    wrap.setAttribute("style", "position:fixed;inset:0;z-index:20002;background:rgba(8,18,26,.55);display:flex;align-items:flex-end;justify-content:center");
    wrap.innerHTML =
      '<div role="dialog" aria-label="Sign in for Lab Watch 24/7" style="background:var(--panel,#fff);color:var(--ink,#0f172a);width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui);box-shadow:0 -10px 40px rgba(0,0,0,.25)">'
      + '<div style="font:800 17px/1.2 var(--serif,Georgia,serif);margin-bottom:6px">🔔 Lab Watch 24/7</div>'
      + '<div style="font:500 12.5px/1.55 var(--sans,system-ui);color:var(--slate,#5a7184);margin-bottom:14px">' + esc(msg || "Sign in with your Google or Apple account to watch patients for new labs — even when the app is closed. This is separate from your GHIS / Ward Sync login.") + '</div>'
      + (hasG ? '<button id="smdSiGoogle" style="width:100%;box-sizing:border-box;margin-bottom:9px;padding:12px;border:1px solid var(--line,#e4eae8);border-radius:11px;background:var(--panel,#fff);color:var(--ink,#16232e);font:700 14px var(--sans,system-ui);cursor:pointer">Sign in with Google</button>' : '')
      + (hasA ? '<button id="smdSiApple" style="width:100%;box-sizing:border-box;margin-bottom:9px;padding:12px;border:none;border-radius:11px;background:#000;color:#fff;font:700 14px var(--sans,system-ui);cursor:pointer">Sign in with Apple</button>' : '')
      + (!hasG && !hasA ? '<div style="font:600 12.5px/1.5 var(--sans,system-ui);color:var(--slate,#5a7184);margin-bottom:9px">Open <b>More → Account &amp; sign-in</b> to sign in with Google or Apple, then tap Lab Watch 24/7 again.</div>' : '')
      + '<button id="smdSiClose" aria-label="Close" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid var(--line,#e4eae8);border-radius:11px;background:var(--paper,#f6f8f6);color:var(--ink,#16232e);font:700 14px var(--sans,system-ui);cursor:pointer">Close</button>'
      + '</div>';
    document.body.appendChild(wrap);
    var close = function () { try { wrap.remove(); } catch (e) {} };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    wrap.querySelector("#smdSiClose").addEventListener("click", close);
    var g = wrap.querySelector("#smdSiGoogle"); if (g) g.addEventListener("click", function () { close(); try { window.SMD_signInWithGoogle(); } catch (e) {} });
    var a = wrap.querySelector("#smdSiApple"); if (a) a.addEventListener("click", function () { close(); try { window.SMD_signInWithApple(); } catch (e) {} });
  }
  function openManager() {
    return new Promise(function (resolve) {
      if (!(window.SMD_AUTH && window.SMD_AUTH.currentUser)) { openSignInSheet("Sign in with your Google or Apple account to see and manage the patients you're watching. This is separate from your GHIS / Ward Sync login."); resolve({ ok: false }); return; }
      if (document.getElementById("smdWatchMgr")) { resolve({ ok: false }); return; }
      var wrap = document.createElement("div");
      wrap.id = "smdWatchMgr";
      wrap.setAttribute("style", "position:fixed;inset:0;z-index:20001;background:rgba(8,18,26,.55);display:flex;align-items:flex-end;justify-content:center");
      wrap.innerHTML =
        '<div role="dialog" aria-label="Lab Watch 24/7" style="background:var(--panel,#fff);color:var(--ink,#0f172a);width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui);box-shadow:0 -10px 40px rgba(0,0,0,.25);max-height:82vh;display:flex;flex-direction:column">'
        + '<div style="font:800 17px/1.2 var(--serif,Georgia,serif);margin-bottom:4px">🔔 Lab Watch 24/7</div>'
        + '<div style="font:500 12px/1.5 var(--sans,system-ui);color:var(--slate,#5a7184);margin-bottom:12px">You’ll be notified when a new lab is reported — <b>even when StewardMD is closed</b>. Add a patient from <b>Ward Sync</b> → open the patient → <b>Lab Watch 24/7</b>.</div>'
        + '<div id="smdWatchMgrBody" style="overflow-y:auto;flex:1;min-height:44px;font:500 13px var(--sans,system-ui);color:var(--slate,#5a7184);text-align:center;padding:22px 4px">Loading…</div>'
        + '<button id="smdWatchMgrDone" aria-label="Close" style="margin-top:14px;padding:12px;border:none;border-radius:11px;background:var(--teal,#0e6e63);color:#fff;font:800 14px var(--sans,system-ui);cursor:pointer">Done</button>'
        + '</div>';
      document.body.appendChild(wrap);
      var close = function () { try { wrap.remove(); } catch (e) {} resolve({ ok: true }); };
      wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
      wrap.querySelector("#smdWatchMgrDone").addEventListener("click", close);
      var bodyEl = wrap.querySelector("#smdWatchMgrBody");
      function render(list) {
        if (!bodyEl) return;
        if (!list || !list.length) {
          bodyEl.setAttribute("style", "overflow-y:auto;flex:1;min-height:44px;font:500 12.5px/1.6 var(--sans,system-ui);color:var(--slate,#5a7184);text-align:center;padding:22px 8px");
          bodyEl.innerHTML = 'No patients are under background watch yet.<br>Open a patient in <b>Ward Sync</b> → tap <b>🔔 Lab Watch 24/7</b>.';
          return;
        }
        bodyEl.setAttribute("style", "overflow-y:auto;flex:1;min-height:44px;text-align:left");
        bodyEl.innerHTML = list.map(function (p) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:11px 2px;border-bottom:1px solid var(--line,#e4eae8)">'
            + '<div style="flex:1;min-width:0"><div style="font:700 14px var(--sans,system-ui);color:var(--ink,#0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name || p.patientId) + '</div>'
            + '<div style="font:500 11.5px var(--sans,system-ui);color:var(--slate,#5a7184)">' + esc(p.patientId) + (p.since ? ' · added ' + esc(sinceLabel(p.since)) : '') + '</div></div>'
            + '<button class="smdw-rm" data-pid="' + esc(p.patientId) + '" style="flex:0 0 auto;padding:7px 12px;border:1px solid var(--line,#e4eae8);border-radius:9px;background:var(--panel,#fff);color:#c0392b;font:700 12.5px var(--sans,system-ui);cursor:pointer">Remove</button>'
            + '</div>';
        }).join("");
        Array.prototype.forEach.call(bodyEl.querySelectorAll(".smdw-rm"), function (btn) {
          btn.addEventListener("click", function () {
            var pid = btn.getAttribute("data-pid"); btn.disabled = true; btn.textContent = "…";
            SMD_WATCH.remove(pid)
              .then(function (r) { render((r && r.watching) || []); })
              .catch(function () { btn.disabled = false; btn.textContent = "Remove"; toast("Couldn’t remove — try again."); });
          });
        });
      }
      SMD_WATCH.status()
        .then(function (s) { render((s && s.watching) || []); })
        .catch(function (e) { if (bodyEl) bodyEl.innerHTML = 'Couldn’t load: ' + esc((e && e.message) || "error"); });
    });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
})();
