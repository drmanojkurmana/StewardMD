/* StewardMD — Discharge → GHIS bridge (discharge-ghis.js)  ->  window.SMD_DISCHARGE_GHIS
 *
 * SPEC-INDEPENDENT half of the "save discharge summary into GHIS" feature. It contains the two
 * pieces that do NOT depend on GHIS's (still-to-be-captured) endpoints:
 *
 *   1. toGhisHTML(fields)  — maps StewardMD's Discharge Creator fields (icu.js DISCHARGE_FIELDS)
 *      into the HTML body GHIS's rich-text discharge-summary editor expects, using GHIS's own six
 *      section headings: Final Diagnosis · Case History · Investigations · Summary of Treatment ·
 *      Condition of Discharge · Discharge Advice.
 *   2. armSignOff(btn, onConfirm) — the DOUBLE-PRESS Sign Off gate: first tap arms a red
 *      "confirm — this is final" state (auto-reverts), second tap fires. Sign Off finalises the
 *      discharge in the hospital record and is irreversible from StewardMD, so it is never a
 *      single tap.
 *
 * The actual network calls (Fetch existing / Save / Update / Sign Off) will be added to
 * functions/api/ghis/[[path]].js once the GHIS request specs (URLs, form fields, CSRF) are
 * captured. This module is pure + testable and has no side effects on load.
 */
(function () {
  "use strict";

  // GIMSR standard discharge footer (from the GHIS template). OFF by default: GHIS's own template
  // likely injects this, so we don't want to duplicate it — flip opts.boilerplate=true only if the
  // captured Submit shows Save replaces the whole body (then we must supply it ourselves).
  var BOILERPLATE = "Report Immediately to the hospital in case of Fever / Diarrhea / Excessive Vomiting / Breathlessness. In case of Emergency contact Ph: 0891 2780333/444. Emergency Room (Ext - 3398).";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // Plain text (our fields use "\n" and "- "/"• " bullet lines) -> safe inline HTML for the editor:
  // bullet runs become <ul><li>…</li></ul>, other lines join with <br>.
  function textToHtml(s) {
    var lines = String(s == null ? "" : s).replace(/\r/g, "").split("\n"), html = "", ul = null;
    function flush() { if (ul) { html += "<ul>" + ul.join("") + "</ul>"; ul = null; } }
    lines.forEach(function (ln) {
      var t = ln.trim(), m = t.match(/^[-•]\s+(.*)$/);
      if (m) { (ul = ul || []).push("<li>" + esc(m[1]) + "</li>"); }
      else { flush(); if (t) html += esc(t) + "<br>"; }
    });
    flush();
    return html.replace(/(<br>)+$/, "");
  }

  // GHIS's six discharge-summary sections, each built from our Creator fields. Order matches the
  // GHIS editor. `inline` keeps a short value on the heading line (Final Diagnosis).
  var SECTIONS = [
    { title: "Final Diagnosis", inline: true, build: function (f) {
        var s = esc((f.finalDx || "").trim());
        if (f.secondaryDx && f.secondaryDx.trim()) s += (s ? "<br>" : "") + "<em>Secondary diagnoses / comorbidities:</em> " + esc(f.secondaryDx.trim());
        return s;
      } },
    { title: "Case History", build: function (f) { return textToHtml(f.complaints); } },
    { title: "Investigations", build: function (f) { return textToHtml(f.investigations); } },
    { title: "Summary of Treatment", build: function (f) {
        var p = [];
        if (f.course && f.course.trim()) p.push(textToHtml(f.course));
        if (f.procedures && f.procedures.trim()) p.push("<em>Procedures / interventions:</em><br>" + textToHtml(f.procedures));
        return p.join("<br>");
      } },
    { title: "Condition of Discharge", build: function (f) { return textToHtml(f.condition); } },
    { title: "Discharge Advice", build: function (f) {
        var p = [];
        if (f.meds && f.meds.trim()) p.push("<em>Discharge medications:</em><br>" + textToHtml(f.meds));
        if (f.followup && f.followup.trim()) p.push("<em>Follow-up:</em> " + esc(f.followup.trim()));
        if (f.advice && f.advice.trim()) p.push(textToHtml(f.advice));
        return p.join("<br>");
      } }
  ];

  // Build the GHIS rich-text body from Discharge Creator field values. Empty sections still emit
  // their heading (matching GHIS's blank template), so the doctor sees every section in the editor.
  function toGhisHTML(fields, opts) {
    var f = fields || {}; opts = opts || {};
    var out = SECTIONS.map(function (sec) {
      var body = sec.build(f) || "";
      return "<p><strong>" + esc(sec.title) + ":</strong>" + (body ? ((sec.inline ? " " : "<br>") + body) : "") + "</p>";
    }).join("");
    if (opts.boilerplate === true) out += "<p><strong>" + esc(BOILERPLATE) + "</strong></p>";
    return out;
  }

  // GHIS date field format is DD-Mon-YYYY (e.g. "22-Jul-2026"). Best-effort normaliser; exact
  // accepted format is confirmed from the captured Submit request.
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtGhisDate(s) {
    if (!s) return "";
    var t = Date.parse(s);
    if (isNaN(t)) { var m = String(s).match(/(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})/); if (m) return ("0" + m[1]).slice(-2) + "-" + m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase() + "-" + m[3]; return String(s); }
    var d = new Date(t);
    return ("0" + d.getDate()).slice(-2) + "-" + MON[d.getMonth()] + "-" + d.getFullYear();
  }

  // Metadata for GHIS's non-body fields. NOTE: GHIS requires a "Followup date" (mandatory *) that
  // our Creator doesn't capture discretely yet — surfaced here as a gap to fill (add a date field
  // to the Creator, or default). Speciality + Primary doctor stay GHIS-owned dropdowns.
  function toGhisMeta(fields) {
    var f = fields || {};
    return { dischargeDate: fmtGhisDate(f.dischargeDate || ""), followupDate: "", _followupDateNeeded: true };
  }

  // ── Double-press confirm gate (used for Sign Off) ────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById("smd-dc-css")) return;
    var st = document.createElement("style"); st.id = "smd-dc-css";
    st.textContent =
      ".smd-dc-armed{background:#dc2626 !important;border-color:#dc2626 !important;color:#fff !important;font-weight:800 !important}" +
      ".smd-dc-armed *{color:#fff !important}";
    (document.head || document.documentElement).appendChild(st);
  }

  // Turn a button into a two-tap confirm: 1st tap arms (red "confirm" state, auto-reverts after
  // `timeout` ms), 2nd tap within the window fires onConfirm(). Idempotent per element. Returns a
  // handle with reset(). Generic — armSignOff() wires it with sign-off-specific copy.
  function doubleConfirm(btn, opts) {
    if (!btn) return null;
    opts = opts || {};
    injectCSS();
    if (btn._smdDC) { btn._smdDC.onConfirm = opts.onConfirm || function () {}; return btn._smdDC; }  // re-bind callback only
    var idleHTML = opts.idleHTML != null ? opts.idleHTML : btn.innerHTML;
    var armHTML = opts.armHTML || "⚠️ Confirm — tap again";
    var timeout = opts.timeout || 4000;
    var armClass = opts.armClass || "smd-dc-armed";
    var handle = { armed: false, onConfirm: opts.onConfirm || function () {}, timer: null };
    function reset() { handle.armed = false; btn.classList.remove(armClass); btn.innerHTML = idleHTML; if (handle.timer) { clearTimeout(handle.timer); handle.timer = null; } }
    handle.reset = reset;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (!handle.armed) {
        handle.armed = true; btn.classList.add(armClass); btn.innerHTML = armHTML;
        if (typeof opts.onArm === "function") { try { opts.onArm(); } catch (x) {} }
        handle.timer = setTimeout(reset, timeout);
      } else {
        reset();
        try { handle.onConfirm(); } catch (x) {}
      }
    });
    btn._smdDC = handle;
    return handle;
  }

  // Sign Off = irreversible finalisation of the discharge in GHIS. Two taps, explicit warning copy.
  function armSignOff(btn, onConfirm, opts) {
    opts = opts || {};
    return doubleConfirm(btn, {
      idleHTML: opts.idleHTML || "✅ Sign Off in GHIS",
      armHTML: opts.armHTML || "⚠️ Tap again to Sign Off — final, can’t be undone",
      timeout: opts.timeout || 5000,
      onArm: opts.onArm,
      onConfirm: onConfirm || function () {}
    });
  }

  window.SMD_DISCHARGE_GHIS = {
    toGhisHTML: toGhisHTML,
    toGhisMeta: toGhisMeta,
    fmtGhisDate: fmtGhisDate,
    sections: function () { return SECTIONS.map(function (s) { return s.title; }); },
    doubleConfirm: doubleConfirm,
    armSignOff: armSignOff
  };
})();
