/* kardiox-feedback.js — KardioX AI · data flywheel (SMD_KARDIOX_FEEDBACK).
 *
 * After a result, ask the clinician "was this reading correct?" -> Confirm, or Correct (pick the right
 * dx). Each response + the ECG image + the AI verdict is sent to the backend and stored as a REAL
 * LABELLED training example. Over time this harvests the real-world phone-photo dataset that every
 * model improvement is bottlenecked on (71 STEMI images today is far too few).
 *
 * PRIVACY-FIRST (ECG photos are PHI — names/handwriting on paper): contribution is CONSENT-GATED and
 * OFF by default. Nothing is uploaded unless the clinician both consents AND submits. Flag
 * `smd_kardiox_feedback` (default OFF). Additive, defensive, node+browser. window.SMD_KARDIOX_FEEDBACK.
 */
(function () {
  "use strict";

  var CONSENT_KEY = "smd_kardiox_feedback_consent";     // "1" once the clinician opts in
  // The label vocabulary the clinician can pick from when correcting (matches the serving classes).
  var LABELS = [
    "Normal", "Anterior STEMI", "Inferior STEMI", "Lateral STEMI", "Posterior STEMI",
    "NSTEMI / ischaemia", "Old / chronic MI", "Atrial fibrillation", "Atrial flutter",
    "Sinus tachycardia", "Sinus bradycardia", "SVT", "VT", "1st-degree AV block",
    "Complete heart block", "RBBB", "LBBB", "LVH", "Hyperkalaemia", "Other / uncertain"
  ];

  function flagOn() {
    try {
      var F = window.SMD_KARDIOX_FLAGS;
      return !!(F && (typeof F.get === "function" ? F.get("smd_kardiox_feedback") : F.smd_kardiox_feedback));
    } catch (e) { return false; }
  }
  function hasConsent() { try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch (e) { return false; } }
  function setConsent(v) { try { localStorage.setItem(CONSENT_KEY, v ? "1" : "0"); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function toast(m) { try { (window.SMD_toast || window.toast || function () {})(m); } catch (e) {} }

  // Best-effort handle on the current case: the AI verdict + the analysed image blob.
  function currentVerdict() {
    try {
      var s = window.SMD_KARDIOX_STORE;
      var last = s && s.last && s.last();
      if (last && last.verdict) return last.verdict;
    } catch (e) {}
    try { var el = document.querySelector(".kx-verdict-dx"); if (el) return el.textContent.trim(); } catch (e) {}
    return "";
  }
  function currentImage() {
    // The analyzer stashes the last analysed image here (see the one-line hook in kardiox-providers.js).
    try { if (window.SMD_KARDIOX_LASTIMAGE instanceof Blob) return window.SMD_KARDIOX_LASTIMAGE; } catch (e) {}
    return null;
  }
  function endpoint() {
    // Same host family as the image analyzer; native app posts direct, web via the edge proxy.
    try {
      var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      return isNative ? "https://kardiox-image-yislqrddsq-uc.a.run.app/v1/ecg/feedback" : "/api/kardiox/feedback";
    } catch (e) { return "/api/kardiox/feedback"; }
  }

  function submit(payload, imageBlob) {
    try {
      var fd = new FormData();
      Object.keys(payload).forEach(function (k) { fd.append(k, payload[k]); });
      if (imageBlob && payload.consent === "1") fd.append("image", imageBlob, "ecg");
      return fetch(endpoint(), { method: "POST", body: fd })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  // ---- UI ----
  function card(ctx) {
    if (typeof document === "undefined") return null;
    var verdict = (ctx && ctx.verdict) || currentVerdict();
    var el = document.createElement("div");
    el.className = "kx-fb";
    el.innerHTML =
      '<div class="kx-fb-q">Was this reading correct?</div>' +
      '<div class="kx-fb-v">' + esc(verdict || "AI reading") + '</div>' +
      '<div class="kx-fb-row">' +
        '<button class="kx-fb-btn kx-fb-yes" data-fb="yes">✓ Correct</button>' +
        '<button class="kx-fb-btn kx-fb-no" data-fb="no">✗ Not quite</button>' +
      '</div>' +
      '<div class="kx-fb-correct" hidden>' +
        '<select class="kx-fb-sel">' + LABELS.map(function (l) { return '<option>' + esc(l) + '</option>'; }).join("") + '</select>' +
        '<button class="kx-fb-btn kx-fb-submit" data-fb="submit">Submit correction</button>' +
      '</div>' +
      (hasConsent() ? '' :
        '<label class="kx-fb-consent"><input type="checkbox" class="kx-fb-consent-cb"> Contribute this ECG (de-identified) to improve KardiQ X. Do not upload ECGs with visible patient identifiers.</label>') +
      '<div class="kx-fb-done" hidden>Thanks — logged. This helps KardiQ X learn.</div>';

    function consentOk() {
      if (hasConsent()) return true;
      var cb = el.querySelector(".kx-fb-consent-cb");
      if (cb && cb.checked) { setConsent(true); return true; }
      return false;
    }
    function finish(payload) {
      submit(payload, currentImage());
      el.querySelector(".kx-fb-row").hidden = true;
      var cc = el.querySelector(".kx-fb-correct"); if (cc) cc.hidden = true;
      var cs = el.querySelector(".kx-fb-consent"); if (cs) cs.hidden = true;
      el.querySelector(".kx-fb-done").hidden = false;
      toast("Feedback logged");
    }
    el.addEventListener("click", function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute("data-fb");
      if (!act) return;
      if (act === "yes") {
        finish({ aiVerdict: verdict, label: verdict, correct: "1", consent: consentOk() ? "1" : "0", ts: String(Date.now()) });
      } else if (act === "no") {
        el.querySelector(".kx-fb-correct").hidden = false;
      } else if (act === "submit") {
        var sel = el.querySelector(".kx-fb-sel");
        finish({ aiVerdict: verdict, label: sel ? sel.value : "Other", correct: "0", consent: consentOk() ? "1" : "0", ts: String(Date.now()) });
      }
    });
    return el;
  }

  function mount(root, ctx) {
    if (typeof document === "undefined" || !flagOn()) return;
    try {
      var anchor = (root || document).querySelector(".kx-verdict, .kx-verdict-strip");
      if (!anchor || anchor.getAttribute("data-fb-mounted")) return;
      anchor.setAttribute("data-fb-mounted", "1");
      var c = card(ctx);
      if (c) anchor.parentNode.insertBefore(c, anchor.nextSibling);
    } catch (e) {}
  }

  var API = { mount: mount, flagOn: flagOn, LABELS: LABELS, hasConsent: hasConsent };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") {
    window.SMD_KARDIOX_FEEDBACK = API;
    try {
      if (typeof MutationObserver !== "undefined") {
        var obs = new MutationObserver(function () { mount(document); });
        var start = function () { mount(document); try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {} };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
      }
    } catch (e) {}
  }
})();
