/* onco-recist.js — RECIST 1.1 response calculator + overlay (window.SMD_ONCORECIST). Phase 8 P2.
 * Buildless ES5 IIFE. Flag: smd_onco_recist (queue-flags.js), default OFF.
 *
 * RECIST 1.1 is a published, public methodology. This implements the REAL target-lesion computation:
 * sum of target-lesion diameters at baseline vs the current assessment -> percent change -> response
 * category, using the nadir (smallest sum on study) as the reference for progression and treating any
 * new lesion as progression.
 *   CR  = all target lesions resolved (sum = 0)
 *   PR  = >=30% decrease in the sum vs BASELINE
 *   PD  = >=20% increase in the sum vs NADIR and an absolute increase of >=5 mm, OR any new lesion
 *   SD  = neither PR nor PD
 * Evaluation order puts new-lesion and progression checks before PR so progression is never masked.
 * NOTE (marked, not computed): non-target-lesion assessment, the lymph-node short-axis rule (target
 * nodes measured by short axis; CR additionally requires all nodes <10 mm short axis) and measurable-
 * lesion selection are the clinician's; this tool computes the target-lesion sum arithmetic only.
 * Pure recist() is exported for node --test with worked examples; the browser half renders an overlay
 * reusing onco-home.css. No writes, no network, no LLM. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function num(x) { var n = (typeof x === "number") ? x : parseFloat(x); return isFinite(n) ? n : NaN; }
  function round1(n) { return Math.round(n * 10) / 10; }

  var CAT_LABEL = { CR: "Complete Response (CR)", PR: "Partial Response (PR)", SD: "Stable Disease (SD)", PD: "Progressive Disease (PD)" };

  /* ===================== PURE ENGINE (testable in Node, no DOM) ===================== */

  // recist({ baseline, current, nadir, newLesions }) — all sums in mm (target lesions).
  // nadir defaults to baseline (and falls back to baseline if given <=0). Returns:
  // { status:"ok"|"invalid", category, pctFromBaseline, pctFromNadir, absFromNadir, reason }.
  function recist(input) {
    input = input || {};
    var baseline = num(input.baseline), current = num(input.current), nadir = num(input.nadir);
    var newLesions = !!input.newLesions;
    if (!(baseline > 0)) return { status: "invalid", reason: "Baseline sum of target-lesion diameters must be greater than 0 mm." };
    if (!(current >= 0)) return { status: "invalid", reason: "Current sum of target-lesion diameters must be 0 mm or greater." };
    var nadirRef = (nadir > 0) ? nadir : baseline;

    var pctFromBaseline = (current - baseline) / baseline * 100;
    var absFromNadir = current - nadirRef;
    var pctFromNadir = (current - nadirRef) / nadirRef * 100;

    var category, reason;
    if (newLesions) { category = "PD"; reason = "New lesion(s) present -> Progressive Disease regardless of the target-lesion sum."; }
    else if (current === 0) { category = "CR"; reason = "All target lesions resolved (sum = 0 mm). CR also requires any target lymph nodes to be <10 mm short axis (verify)."; }
    else if (pctFromNadir >= 20 && absFromNadir >= 5) { category = "PD"; reason = "Sum increased " + round1(pctFromNadir) + "% (>=20%) and " + round1(absFromNadir) + " mm (>=5 mm) from the nadir."; }
    else if (pctFromBaseline <= -30) { category = "PR"; reason = "Sum decreased " + round1(Math.abs(pctFromBaseline)) + "% (>=30%) from baseline."; }
    else { category = "SD"; reason = "Neither PR (>=30% decrease from baseline) nor PD (>=20% increase and >=5 mm from nadir) criteria met."; }

    return {
      status: "ok", category: category, reason: reason,
      pctFromBaseline: round1(pctFromBaseline), pctFromNadir: round1(pctFromNadir), absFromNadir: round1(absFromNadir)
    };
  }

  // A tiny built-in self-check (the worked examples from the spec). Returns true if all pass.
  function selfTest() {
    var a = recist({ baseline: 100, current: 65, nadir: 100 });
    var b = recist({ baseline: 100, current: 130, nadir: 100 });
    var c = recist({ baseline: 100, current: 100, nadir: 100, newLesions: true });
    var d = recist({ baseline: 100, current: 0, nadir: 40 });
    var e = recist({ baseline: 100, current: 90, nadir: 100 });
    return a.category === "PR" && b.category === "PD" && c.category === "PD" && d.category === "CR" && e.category === "SD";
  }

  /* ===================== BROWSER: overlay ===================== */

  var rc = { baseline: "", current: "", nadir: "", newLesions: false };

  function flagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_recist")); } catch (e) { return false; } }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }
  function ev(entries) { try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.build) ? G.SMD_ONCOEV.build(entries) : ""; } catch (e) { return ""; } }
  function rootEl() { var el = document.getElementById("smdOncoRecist"); if (!el) { el = document.createElement("div"); el.id = "smdOncoRecist"; el.className = "oh-overlay"; document.body.appendChild(el); } return el; }

  function resultHtml() {
    // Nothing entered yet -> a prompt, not a fabricated result.
    if (String(rc.baseline).trim() === "" && String(rc.current).trim() === "" && !rc.newLesions) {
      return '<div class="oh-empty">Enter the baseline and current sum of target-lesion diameters (mm) to compute the RECIST 1.1 category.</div>';
    }
    var r = recist({ baseline: rc.baseline, current: rc.current, nadir: rc.nadir, newLesions: rc.newLesions });
    if (r.status !== "ok") return '<div class="stg-gap"><div class="stg-gap-h">Cannot compute</div><div class="stg-gap-t">' + esc(r.reason) + "</div></div>";
    return '<div class="rec-out rec-' + esc(r.category) + '"><div class="rec-cat">' + esc(CAT_LABEL[r.category] || r.category) + '</div>' +
      '<div class="rec-reason">' + esc(r.reason) + "</div>" +
      '<div class="rec-nums"><span>Change from baseline: ' + esc(r.pctFromBaseline) + '%</span><span>Change from nadir: ' + esc(r.pctFromNadir) + '% (' + esc(r.absFromNadir) + ' mm)</span></div></div>' +
      ev([{ kind: "calc", why: "RECIST 1.1 target-lesion arithmetic. Non-target lesions, the lymph-node short-axis rule and lesion selection are the clinician's, not computed here.", source: { name: "RECIST 1.1", section: "Target-lesion response" } }]);
  }

  function paintShell() {
    var el = rootEl();
    el.innerHTML =
      '<div class="oh-top"><button class="oh-back" data-rec-act="close" aria-label="Close">&lsaquo; Close</button>' +
      '<div class="oh-title">RECIST 1.1</div><span style="width:64px"></span></div>' +
      '<div class="oh-body">' +
        '<div class="stg-intro">RECIST 1.1 target-lesion response. Enter the sum of target-lesion diameters (mm). Nadir defaults to baseline; set it to the smallest sum recorded on study for the progression check. New lesions always score as progression.</div>' +
        '<div class="rec-form">' +
          '<label class="rec-field"><span>Baseline sum (mm)</span><input id="recBase" class="oh-search" type="number" inputmode="decimal" min="0" step="0.1" value="' + esc(rc.baseline) + '"></label>' +
          '<label class="rec-field"><span>Current sum (mm)</span><input id="recCur" class="oh-search" type="number" inputmode="decimal" min="0" step="0.1" value="' + esc(rc.current) + '"></label>' +
          '<label class="rec-field"><span>Nadir sum (mm, optional)</span><input id="recNadir" class="oh-search" type="number" inputmode="decimal" min="0" step="0.1" value="' + esc(rc.nadir) + '"></label>' +
          '<label class="rec-check"><input id="recNew" type="checkbox"' + (rc.newLesions ? " checked" : "") + '> New lesion(s) present</label>' +
        '</div>' +
        '<div id="recResult">' + resultHtml() + '</div>' +
        '<div class="oh-ctx-note">Reference calculation only (RECIST 1.1). Confirm target-lesion selection, measurability and node rules against the source. Not an order or a diagnosis.</div>' +
      '</div>';
    var base = el.querySelector("#recBase"), cur = el.querySelector("#recCur"), nad = el.querySelector("#recNadir"), nw = el.querySelector("#recNew");
    function repaint() { var box = el.querySelector("#recResult"); if (box) box.innerHTML = resultHtml(); }
    if (base) base.addEventListener("input", function () { rc.baseline = base.value; repaint(); });
    if (cur) cur.addEventListener("input", function () { rc.current = cur.value; repaint(); });
    if (nad) nad.addEventListener("input", function () { rc.nadir = nad.value; repaint(); });
    if (nw) nw.addEventListener("change", function () { rc.newLesions = !!nw.checked; repaint(); });
  }

  function onClick(e) {
    var t = e.target, b = (t && t.closest) ? t.closest("[data-rec-act]") : null;
    if (!b) return;
    if ((b.getAttribute("data-rec-act") || "") === "close") close();
  }

  function open() {
    if (!flagOn()) { toast("RECIST is off"); return; }
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    paintShell();
    el.classList.add("on"); document.body.classList.add("oh-lock");
  }
  function close() { var el = document.getElementById("smdOncoRecist"); if (el) el.classList.remove("on"); if (!document.getElementById("smdOncoHome") || !document.getElementById("smdOncoHome").classList.contains("on")) document.body.classList.remove("oh-lock"); }

  try { document.addEventListener("keydown", function (e) { if (e.key === "Escape") { var el = document.getElementById("smdOncoRecist"); if (el && el.classList.contains("on")) close(); } }); } catch (e) {}

  G.SMD_ONCORECIST = { open: open, openList: open, close: close, recist: recist, selfTest: selfTest, CAT_LABEL: CAT_LABEL, _rc: rc, _version: "1.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = { recist: recist, selfTest: selfTest, CAT_LABEL: CAT_LABEL };
})();
