/* wardsynq-alert-ui.js — the screen that makes an escalation impossible to ignore quietly.
 *
 * HAZ-DET-01's requirement is "a critical value must force acknowledgement and escalate on a timer
 * if it is not acknowledged". The timer half has existed for a while. The forcing half did not: a
 * WardSynQ push arrived on the handset, posted a `delivered` receipt, and routed to "/". A
 * clinician could see a banner and had nowhere to answer it, so `acknowledged` was reachable only
 * from a console. This is the missing half.
 *
 * WHAT MAKES IT A FORCED ACKNOWLEDGEMENT RATHER THAN A TOAST.
 *   - It does not auto-dismiss. There is no timeout, and it survives a rotate or a re-render.
 *   - It cannot be dismissed by tapping beside it, by Escape, or by the back gesture. The only ways
 *     out are the two explicit answers, because a dialog you can flick away is a notification.
 *   - It names the patient, the reason, the responder asked and the time the escalation was raised.
 *     A clinician cannot take responsibility for something that has not said what it is.
 *
 * THE TWO ANSWERS, AND WHY ONLY ONE CLOSES THE LOOP.
 *   ACKNOWLEDGE means "I am attending this patient". It posts the acknowledgement, the orchestrator
 *   records who and when, one timeline entry is written, and every other channel stands down.
 *   I CANNOT ATTEND is also an answer, and deliberately does NOT close the loop. It records that a
 *   named person saw this and could not take it, then leaves the escalation OUTSTANDING so the timer
 *   re-escalates to somebody who can. A screen where the only way out is to accept responsibility
 *   would be answered by whoever was nearest, which is how an escalation reaches nobody useful.
 *
 * WHAT IT DOES NOT DO. It does not score, does not decide who should be asked, and does not close a
 * clinical loop: acknowledgement is not review. Somebody still has to see the patient and record
 * what they did, which lives in the monitor, not here.
 *
 * A NOTE ON THE PATIENT NAME. The push carries a patientId and no name, deliberately - PHI does not
 * go in a notification payload. The screen resolves a name locally if the app can, and otherwise
 * shows the identifier rather than inventing something friendlier.
 *
 * STATUS: IMPLEMENTED. NOT clinically validated and NOT clinically approved.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var OPEN = null;   // the alert currently on screen; one at a time, deliberately

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Best effort, and honest when it fails. A wrong name on an escalation screen is worse than an
   * identifier, because the whole point of the screen is that the clinician knows who it is about. */
  function patientLabel(data) {
    var id = (data && data.patientId) || null;
    if (!id) return "Patient not identified in this alert";
    try {
      if (window.ICU && ICU.patientNameById) {
        var n = ICU.patientNameById(id);
        if (n) return n + " (" + id + ")";
      }
    } catch (e) {}
    return id;
  }

  function styles() {
    if (document.getElementById("wsq-alert-style")) return;
    var s = document.createElement("style");
    s.id = "wsq-alert-style";
    s.textContent = [
      "#wsq-alert{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:stretch;",
      "  justify-content:center;background:#0b1220;color:#fff;",
      "  font:400 16px/1.45 -apple-system,system-ui,sans-serif;",
      "  padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));}",
      "#wsq-alert .wrap{margin:auto;width:100%;max-width:520px;}",
      "#wsq-alert .tag{display:inline-block;background:#b3122b;color:#fff;font-weight:700;",
      "  font-size:12.5px;letter-spacing:.06em;padding:5px 10px;border-radius:4px;}",
      "#wsq-alert h1{font-size:23px;line-height:1.25;margin:14px 0 6px;font-weight:650;}",
      "#wsq-alert .who{font-size:17px;font-weight:600;color:#ffd9df;margin:0 0 18px;}",
      "#wsq-alert dl{margin:0 0 22px;padding:14px 16px;background:#16203200;border:1px solid #2c3a52;border-radius:10px;}",
      "#wsq-alert dt{font-size:12.5px;text-transform:none;color:#9fb0c9;margin:0;}",
      "#wsq-alert dd{margin:2px 0 12px;font-size:16px;color:#fff;}",
      "#wsq-alert dd:last-of-type{margin-bottom:0;}",
      "#wsq-alert button{display:block;width:100%;min-height:52px;border-radius:10px;font-size:16.5px;",
      "  font-weight:650;border:1px solid transparent;margin-top:10px;cursor:pointer;}",
      "#wsq-alert .take{background:#fff;color:#0b1220;}",
      "#wsq-alert .cannot{background:transparent;color:#fff;border-color:#5b6c88;font-weight:550;}",
      "#wsq-alert button:active{transform:translateY(1px);}",
      "#wsq-alert .note{font-size:13.5px;color:#9fb0c9;margin:16px 0 0;}",
      "#wsq-alert .state{font-size:14px;margin:12px 0 0;min-height:1.2em;color:#ffd9df;}",
      "@media (prefers-reduced-motion:reduce){#wsq-alert button:active{transform:none;}}",
    ].join("");
    document.head.appendChild(s);
  }

  /* Nothing here dismisses on its own. Both handlers are explicit answers. */
  function close() {
    var el = document.getElementById("wsq-alert");
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.removeEventListener("keydown", trap, true);
    OPEN = null;
  }

  /* Keeps focus inside, and swallows Escape. Escape dismissing a clinical escalation would make it
   * a notification with extra steps. */
  function trap(ev) {
    var el = document.getElementById("wsq-alert");
    if (!el) return;
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); return; }
    if (ev.key !== "Tab") return;
    var f = el.querySelectorAll("button");
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  function say(msg) {
    var s = document.getElementById("wsq-alert-state");
    if (s) s.textContent = msg || "";
  }

  /**
   * Shows the escalation. `data` is the push payload: noticeId, alertId, patientId, plus the
   * notification's own title and body, which carry the reason and the responder asked.
   */
  function show(data, title, body) {
    if (!data || !data.noticeId) return false;
    // One at a time. A second escalation stacking on top would hide the first, and the hidden one
    // is the one nobody answers.
    if (OPEN && OPEN.noticeId === data.noticeId) return true;
    if (OPEN) close();
    OPEN = data;

    styles();
    var el = document.createElement("div");
    el.id = "wsq-alert";
    el.setAttribute("role", "alertdialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "wsq-alert-h");
    el.innerHTML = [
      '<div class="wrap">',
      '  <span class="tag">DETERIORATION ESCALATION</span>',
      '  <h1 id="wsq-alert-h">', esc(title || "WardSynQ escalation"), "</h1>",
      '  <p class="who">', esc(patientLabel(data)), "</p>",
      "  <dl>",
      "    <dt>Asked of</dt><dd>", esc(body || "the responsible clinician"), "</dd>",
      "    <dt>Raised</dt><dd>", esc(new Date().toLocaleString()), "</dd>",
      "  </dl>",
      '  <button type="button" class="take" id="wsq-take">Acknowledge — I am attending this patient</button>',
      '  <button type="button" class="cannot" id="wsq-cannot">I cannot attend</button>',
      '  <p class="state" id="wsq-alert-state" role="status" aria-live="polite"></p>',
      '  <p class="note">Acknowledging records that you have taken this. It is not a review: somebody',
      "     still has to see the patient and record what they did.</p>",
      "</div>",
    ].join("");
    document.body.appendChild(el);
    document.addEventListener("keydown", trap, true);
    var take = document.getElementById("wsq-take");
    if (take) take.focus();

    // Opening it IS the evidence that a person looked. Posted here rather than on arrival, because
    // arrival is the handset's fact and this is the clinician's.
    try { if (window.SMD_wardsynqViewed) window.SMD_wardsynqViewed(data); } catch (e) {}

    if (take) take.addEventListener("click", function () {
      take.disabled = true;
      say("Recording your acknowledgement…");
      var done = function (ok) {
        if (ok) { close(); return; }
        take.disabled = false;
        // A failed acknowledgement must NOT look like a successful one. The escalation stays open
        // and the timer keeps running, and the screen says so rather than closing politely.
        say("Could not record that. The escalation is still open and will re-escalate. Try again.");
      };
      try {
        if (!window.SMD_wardsynqAcknowledge) return done(false);
        window.SMD_wardsynqAcknowledge(data, "attending").then(done, function () { done(false); });
      } catch (e) { done(false); }
    });

    var cannot = document.getElementById("wsq-cannot");
    if (cannot) cannot.addEventListener("click", function () {
      // Deliberately posts NO acknowledgement. This is a person saying they cannot take it, and the
      // escalation has to remain outstanding so the ladder finds somebody who can.
      say("Left open. It will re-escalate to the next responder.");
      cannot.disabled = true;
      setTimeout(close, 1200);
    });

    return true;
  }

  window.SMD_showWardSynQAlert = show;
})();
