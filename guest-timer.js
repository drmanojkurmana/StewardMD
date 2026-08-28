/* StewardMD — guest session bar (window.SMD_GUEST_BAR).
 * ---------------------------------------------------------------------------
 * A guest gets 300 seconds to look around, twice a day. app.js already owns that policy: it writes
 * { type:"guest", expiresAt } into `stewardmd_account`, ticks a "Guest · M:SS" label inside the
 * small account chip, and wipes + reloads at zero. account.js caps it at 2 sessions per day.
 *
 * What was missing is that the countdown lived in a chip most people never look at, so an unsigned
 * visitor got dropped back to the sign-in screen mid-sentence with no warning. This renders the SAME
 * clock as a bar across the top of the app, which is where a deadline belongs.
 *
 * ADDITIVE — it never edits app.js (same rule verify.js follows). It reads the account from
 * localStorage and writes nothing until the clock actually runs out.
 *
 * BACKSTOP: at zero it performs the same teardown app.js does (mark the trial used, drop the guest
 * account, reload). app.js's timer only runs if its chip rendered; this one runs regardless, so
 * "auto sign-out at 300 s" is a guarantee rather than a side effect of a piece of UI existing.
 * Both paths are idempotent - whichever fires first clears the account and the other finds nothing.
 */
(function () {
  "use strict";

  var ACCOUNT_KEY = "stewardmd_account";     // app.js's account record
  var USED_KEY = "stewardmd_guest_used";     // app.js's "trial consumed" marker
  var DAY_KEY = "smd_guest_day";             // account.js's per-day counter
  var USES_KEY = "smd_guest_uses";
  var MAX_PER_DAY = 2;                       // keep in step with account.js GUEST_MAX_PER_DAY
  var WARN_MS = 60000;                       // turn urgent in the last minute
  var BAR_ID = "smdGuestBar";

  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lrem(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function account() {
    try { return JSON.parse(lget(ACCOUNT_KEY) || "null"); } catch (e) { return null; }
  }
  /** Milliseconds left in this guest session, or null when this is not a live guest session. */
  function msLeft() {
    var a = account();
    if (!a || a.type !== "guest") return null;
    var exp = +a.expiresAt || 0;
    if (!exp) return null;
    return exp - Date.now();
  }
  function today() { try { return new Date().toISOString().slice(0, 10); } catch (e) { return "0"; } }
  function usesToday() {
    if (lget(DAY_KEY) !== today()) return 0;
    return parseInt(lget(USES_KEY) || "0", 10) || 0;
  }
  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }

  // ---- the bar -------------------------------------------------------------
  function styleOnce() {
    if (document.getElementById(BAR_ID + "Css")) return;
    var st = document.createElement("style");
    st.id = BAR_ID + "Css";
    st.textContent =
      "#" + BAR_ID + "{position:fixed;top:0;left:0;right:0;z-index:2147483000;" +
      "display:flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;" +
      "padding:calc(env(safe-area-inset-top,0px) + 6px) 12px 6px;" +
      "font:600 12.5px/1.25 var(--sans,system-ui,-apple-system,'Segoe UI',sans-serif);" +
      "background:#0e6e63;color:#fff;text-align:center;letter-spacing:.01em;" +
      "box-shadow:0 1px 6px rgba(0,0,0,.18)}" +
      "#" + BAR_ID + ".urgent{background:#b42318}" +
      "#" + BAR_ID + " b{font-variant-numeric:tabular-nums;font-weight:800}" +
      "#" + BAR_ID + " .gb-sub{opacity:.85;font-weight:600}" +
      "@media (max-width:380px){#" + BAR_ID + " .gb-sub{display:none}}";
    (document.head || document.documentElement).appendChild(st);
  }

  function bar() { return document.getElementById(BAR_ID); }

  function mount() {
    var el = bar();
    if (el) return el;
    styleOnce();
    el = document.createElement("div");
    el.id = BAR_ID;
    // The seconds are hidden from assistive tech: a per-second live region is noise, not help.
    // The polite region below announces only at the two thresholds that matter.
    el.innerHTML =
      '<span aria-hidden="true">Guest preview &middot; signing out in <b data-gb-clock>5:00</b></span>' +
      '<span class="gb-sub" aria-hidden="true" data-gb-sessions></span>' +
      '<span data-gb-a11y role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;' +
      'overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"></span>';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function unmount() {
    var el = bar();
    if (el && el.parentNode) el.parentNode.removeChild(el);
    setBodyPad(0);
  }

  // Push the app down by exactly the bar's height so the bar never covers the header. Measured
  // rather than hard-coded: the safe-area inset differs per device and notch state.
  function setBodyPad(px) {
    /* Padding the BODY does not move a position:fixed overlay, and the app's full-screen surfaces
     * (the eLOGBook module, the FollowCare sheet) are exactly that - so the bar sat on top of their
     * headers and covered the close button. Publish the measured height as a custom property too, so
     * a fixed overlay can offset itself by the same value. */
    try {
      var root = document.documentElement;
      if (root) root.style.setProperty("--smd-guestbar-h", (px ? px : 0) + "px");
    } catch (e) {}
    try {
      var b = document.body; if (!b) return;
      if (!px) { if (b.hasAttribute("data-gb-pad")) { b.style.paddingTop = b.getAttribute("data-gb-pad") || ""; b.removeAttribute("data-gb-pad"); } return; }
      if (!b.hasAttribute("data-gb-pad")) b.setAttribute("data-gb-pad", b.style.paddingTop || "");
      b.style.paddingTop = px + "px";
    } catch (e) {}
  }

  // ---- expiry --------------------------------------------------------------
  // Same teardown as app.js: mark the session consumed, drop the account, reload to the gate.
  var ending = false;
  function endSession() {
    if (ending) return;
    ending = true;
    if (!lget(USED_KEY)) lset(USED_KEY, String(Date.now()));
    lrem(ACCOUNT_KEY);
    unmount();
    try { location.reload(); } catch (e) {}
  }

  var lastAnnounced = null;
  function announce(el, ms) {
    var region = el.querySelector("[data-gb-a11y]");
    if (!region) return;
    var mark = ms <= 10000 ? 10 : (ms <= WARN_MS ? 60 : null);
    if (mark === lastAnnounced) return;
    lastAnnounced = mark;
    if (mark === 60) region.textContent = "One minute left in your guest preview. Sign in to keep working.";
    else if (mark === 10) region.textContent = "Ten seconds left in your guest preview.";
    else region.textContent = "";
  }

  function tick() {
    var ms = msLeft();
    if (ms === null) { if (bar()) { unmount(); lastAnnounced = null; } return; }
    if (ms <= 0) { endSession(); return; }

    var el = mount();
    var clock = el.querySelector("[data-gb-clock]");
    if (clock) clock.textContent = mmss(ms);
    var sub = el.querySelector("[data-gb-sessions]");
    if (sub) {
      // usesToday() is bumped by account.js when the guest button is tapped, so the CURRENT session
      // is already counted. Never render "0 of 2" or a negative remainder.
      var used = Math.min(MAX_PER_DAY, Math.max(1, usesToday()));
      sub.textContent = "· session " + used + " of " + MAX_PER_DAY + " today";
    }
    el.classList.toggle("urgent", ms <= WARN_MS);
    announce(el, ms);
    setBodyPad(el.offsetHeight || 0);
  }

  var timer = null;
  function start() {
    if (timer) return;
    tick();
    timer = setInterval(tick, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  // A guest session can begin long after load (the sign-in gate is in-page), and the tab can be
  // backgrounded across the whole 300 s, so re-check on wake instead of trusting the interval.
  try { document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); }); } catch (e) {}

  window.SMD_GUEST_BAR = { msLeft: msLeft, tick: tick, mmss: mmss, usesToday: usesToday, MAX_PER_DAY: MAX_PER_DAY };
})();
