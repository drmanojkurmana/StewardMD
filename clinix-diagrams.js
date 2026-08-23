/* clinix-diagrams.js — CliniX · self-authored inline SVG diagrams.
 *
 * WHY THESE ARE INLINE AND NOT IMAGES:
 *   1. Licence. We drew them, so they are cleared without sourcing anything. Given the media
 *      constraint (openly-licensed or permitted embeds only), an original diagram is the one kind of
 *      visual we can always ship, and for a mechanism it is usually better than a photograph anyway.
 *   2. Theme. Inline SVG inherits #clinixRoot's --cx-* variables, so it follows light/dark and every
 *      accent theme with no extra work. An <img> cannot see the app's theme class.
 *   3. Interaction. The spec asks for interactive diagrams ("where would you auscultate?"), which an
 *      image cannot do. Tap targets here are ordinary data-act buttons.
 *
 * Every diagram is a MECHANISM, not decoration. Each one exists because the thing it shows is hard
 * to convey in prose: a scooped expiratory limb, an airway collapsing on expiration, the pattern of
 * a side-to-side comparison.
 *
 * Motion respects prefers-reduced-motion via clinix.css.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ── 1. Flow-volume loop: normal vs obstructive ──────────────────────────── */

  /* The single most useful diagram in COPD teaching. The number (FEV1/FVC below 0.7) is abstract;
   * the SCOOP is not. A student who has seen the concave expiratory limb recognises obstruction on
   * a report they have never been taught to read. `focus` lets the lesson highlight one curve. */
  function flowVolume(opts) {
    opts = opts || {};
    var focus = opts.focus || "both";   // normal | copd | both
    var dimN = focus === "copd" ? ' class="cx-dia-dim"' : "";
    var dimC = focus === "normal" ? ' class="cx-dia-dim"' : "";

    return '' +
      '<svg class="cx-dia" viewBox="0 0 340 240" role="img" aria-label="Flow volume loop: normal compared with obstructive">' +
        '<title>Flow-volume loop, normal compared with obstruction</title>' +
        // axes
        '<line class="cx-dia-axis" x1="44" y1="120" x2="320" y2="120"/>' +
        '<line class="cx-dia-axis" x1="44" y1="20" x2="44" y2="210"/>' +
        '<text class="cx-dia-lbl" x="326" y="116" text-anchor="end">Volume</text>' +
        '<text class="cx-dia-lbl" x="48" y="16">Flow</text>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="48" y="134">expiration below, inspiration above</text>' +

        // NORMAL: brisk rise to a sharp peak, then a straight decline to RV.
        '<g' + dimN + '>' +
          '<path class="cx-dia-normal" d="M60 120 L74 46 L300 118"/>' +
          '<path class="cx-dia-normal cx-dia-insp" d="M300 118 C250 196 120 196 60 120"/>' +
          '<circle class="cx-dia-dot" cx="74" cy="46" r="3.5"/>' +
          '<text class="cx-dia-lbl cx-dia-lbl--normal" x="80" y="42">Normal: sharp peak, straight descent</text>' +
        "</g>" +

        // OBSTRUCTIVE: lower peak and, crucially, a CONCAVE (scooped) descent - airways collapsing
        // during forced expiration, so flow falls away faster than volume.
        '<g' + dimC + '>' +
          '<path class="cx-dia-copd" d="M60 120 L80 78 C130 104 210 116 288 119"/>' +
          '<path class="cx-dia-copd cx-dia-insp" d="M288 119 C246 168 130 170 60 120"/>' +
          '<circle class="cx-dia-dot cx-dia-dot--copd" cx="80" cy="78" r="3.5"/>' +
          '<text class="cx-dia-lbl cx-dia-lbl--copd" x="150" y="150">Obstruction: low peak, scooped descent</text>' +
          '<path class="cx-dia-arrow" d="M168 143 L150 122"/>' +
        "</g>" +
      "</svg>" +
      '<div class="cx-dia-toggle">' +
        diaBtn("normal", "Normal", focus) + diaBtn("copd", "Obstruction", focus) + diaBtn("both", "Both", focus) +
      "</div>";
  }

  function diaBtn(key, label, focus) {
    return '<button type="button" class="cx-dia-btn' + (focus === key ? " cx-dia-btn--on" : "") +
      '" data-act="cx-dia-focus" data-id="' + esc(key) + '">' + esc(label) + "</button>";
  }

  /* ── 2. Air trapping: why the chest is hyperinflated ─────────────────────── */

  /* Nearly every physical sign in COPD derives from this one mechanism, so it earns a real
   * animation. The point is the EXPIRATORY phase: the normal airway is held open by the elastic
   * pull of surrounding alveoli, and when that traction is destroyed the airway closes before the
   * alveolus has emptied. */
  function airTrapping() {
    return '' +
      '<svg class="cx-dia cx-dia--anim" viewBox="0 0 340 200" role="img" aria-label="Small airway collapse on expiration causing gas trapping">' +
        '<title>Small airway on expiration: normal compared with emphysema</title>' +

        // ---- normal side ----
        '<text class="cx-dia-lbl cx-dia-lbl--normal" x="12" y="18">Normal</text>' +
        '<path class="cx-dia-airway" d="M12 70 L96 70 M12 96 L96 96"/>' +
        '<circle class="cx-dia-alv" cx="126" cy="83" r="26"/>' +
        // radial traction: the springs that hold the airway open
        '<g class="cx-dia-traction">' +
          '<line x1="96" y1="70" x2="112" y2="58"/><line x1="96" y1="96" x2="112" y2="108"/>' +
          '<line x1="88" y1="70" x2="88" y2="54"/><line x1="88" y1="96" x2="88" y2="112"/>' +
        "</g>" +
        '<circle class="cx-dia-air cx-dia-air--out" cx="90" cy="83" r="5"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="12" y="132">Traction holds the airway open,</text>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="12" y="146">so the alveolus empties.</text>' +

        '<line class="cx-dia-div" x1="170" y1="10" x2="170" y2="190"/>' +

        // ---- emphysema side ----
        '<text class="cx-dia-lbl cx-dia-lbl--copd" x="184" y="18">Emphysema</text>' +
        // collapsed airway: the walls pinch together mid-expiration
        '<path class="cx-dia-airway cx-dia-airway--collapse" d="M184 70 C232 70 244 80 268 83 M184 96 C232 96 244 86 268 83"/>' +
        '<circle class="cx-dia-alv cx-dia-alv--big" cx="300" cy="83" r="30"/>' +
        '<circle class="cx-dia-air cx-dia-air--trapped" cx="300" cy="83" r="5"/>' +
        '<circle class="cx-dia-air cx-dia-air--trapped2" cx="292" cy="74" r="4"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="184" y="132">Traction is destroyed, the airway</text>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="184" y="146">closes, and gas is trapped.</text>' +
        '<text class="cx-dia-lbl cx-dia-lbl--copd" x="184" y="172">Hyperinflation follows, and with it the</text>' +
        '<text class="cx-dia-lbl cx-dia-lbl--copd" x="184" y="186">barrel chest and hyperresonance.</text>' +
      "</svg>";
  }

  /* ── 3. Percussion map: an interactive chest ─────────────────────────────── */

  /* The spec asks for "student taps the chest". More usefully than a naming drill, this teaches the
   * ORDER: percussion is comparative, so the zones are numbered left-right-left-right rather than
   * down one side. Tapping a zone shows what you would expect in COPD at that point. */
  var ZONES = [
    { id: "apexL", cx: 118, cy: 46, n: 1, side: "left", label: "Left apex", finding: "Hyperresonant. Percuss the clavicle directly here." },
    { id: "apexR", cx: 202, cy: 46, n: 2, side: "right", label: "Right apex", finding: "Hyperresonant, and equal to the left. It is the comparison that matters." },
    { id: "upperL", cx: 112, cy: 88, n: 3, side: "left", label: "Left upper zone", finding: "Hyperresonant. Normal cardiac dullness would begin to appear below this." },
    { id: "upperR", cx: 208, cy: 88, n: 4, side: "right", label: "Right upper zone", finding: "Hyperresonant and symmetrical." },
    { id: "midL", cx: 108, cy: 128, n: 5, side: "left", label: "Left mid zone", finding: "Hyperresonant. In COPD the cardiac dullness that should be here is LOST, because hyperinflated lung has expanded over the heart." },
    { id: "midR", cx: 212, cy: 128, n: 6, side: "right", label: "Right mid zone", finding: "Hyperresonant." },
    { id: "lowerL", cx: 112, cy: 170, n: 7, side: "left", label: "Left base", finding: "Hyperresonant. Stony dullness here would mean an effusion, not COPD." },
    { id: "lowerR", cx: 208, cy: 170, n: 8, side: "right", label: "Right base", finding: "Hyperresonant, and the liver dullness is pushed DOWN to about the seventh space." }
  ];

  function percussionMap(opts) {
    opts = opts || {};
    var sel = opts.selected || null;
    var html = '<svg class="cx-dia cx-dia--chest" viewBox="0 0 320 210" role="img" aria-label="Chest percussion zones, in comparative order">' +
      '<title>Percussion zones, numbered in comparative order</title>' +
      // simple anterior chest outline
      '<path class="cx-dia-body" d="M160 16 C126 16 96 28 90 44 C82 66 84 150 92 178 C98 196 122 200 160 200 C198 200 222 196 228 178 C236 150 238 66 230 44 C224 28 194 16 160 16 Z"/>' +
      '<line class="cx-dia-mid" x1="160" y1="22" x2="160" y2="196"/>';

    for (var i = 0; i < ZONES.length; i++) {
      var z = ZONES[i];
      var on = sel === z.id;
      html += '<g class="cx-dia-zone' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-zone" data-id="' + esc(z.id) + '" role="button" tabindex="0" aria-label="' + esc(z.label) + '">' +
        '<circle cx="' + z.cx + '" cy="' + z.cy + '" r="15"/>' +
        '<text x="' + z.cx + '" y="' + (z.cy + 4) + '" text-anchor="middle">' + z.n + "</text></g>";
      // the comparison arrow: 1->2, 3->4, ... so the ORDER is visible, not just the sites
      if (z.n % 2 === 1 && ZONES[i + 1]) {
        html += '<path class="cx-dia-cmp" d="M' + (z.cx + 17) + " " + z.cy + " L" + (ZONES[i + 1].cx - 17) + " " + ZONES[i + 1].cy + '"/>';
      }
    }
    html += "</svg>";

    var chosen = null;
    for (var k = 0; k < ZONES.length; k++) if (ZONES[k].id === sel) chosen = ZONES[k];
    html += '<div class="cx-dia-note">' +
      (chosen
        ? "<b>" + esc(chosen.label) + "</b> " + esc(chosen.finding)
        : "Tap a numbered zone. The numbers are the ORDER: side to side at matched levels, never down one side and then the other.") +
      "</div>";
    return html;
  }

  /* ── registry ────────────────────────────────────────────────────────────── */

  var DIAGRAMS = {
    "diagram.flowvolume": { title: "Flow-volume loop", render: flowVolume, interactive: true },
    "diagram.airtrapping": { title: "Air trapping in emphysema", render: airTrapping, interactive: false },
    "diagram.percussion": { title: "Percussion zones", render: percussionMap, interactive: true }
  };

  function has(id) { return Object.prototype.hasOwnProperty.call(DIAGRAMS, id); }
  function render(id, opts) {
    if (!has(id)) return "";
    try { return DIAGRAMS[id].render(opts || {}); }
    catch (e) { return ""; }
  }
  function titleOf(id) { return has(id) ? DIAGRAMS[id].title : ""; }

  var API = { DIAGRAMS: DIAGRAMS, ZONES: ZONES, has: has, render: render, titleOf: titleOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_DIAGRAMS = API;
})();
