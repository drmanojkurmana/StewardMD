/* clinix-diagrams.js — CliniX · self-authored inline SVG demonstrations.
 *
 * WHY THESE ARE INLINE SVG AND NOT IMAGES OR VIDEO:
 *   1. Licence. We drew them, so they clear without sourcing anything. Given that external
 *      teaching media is almost all copyrighted, an original diagram is the visual we can always
 *      ship - and for a MECHANISM or a TECHNIQUE it usually beats a photograph anyway.
 *   2. Theme. Inline SVG inherits #clinixRoot's --cx-* variables, so light, dark and every accent
 *      theme work with no duplicate palette. An <img> cannot see the app's theme.
 *   3. Interaction. "Tap where you would auscultate" is in the spec by name. An image cannot do it.
 *
 * Every diagram here exists because the thing it shows is hard to convey in prose. The test applied
 * to each one: would a student who has read the text still get this wrong? If no, it is decoration
 * and it does not belong.
 *
 * Motion is CSS in clinix.css and respects prefers-reduced-motion.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function btn(act, id, label, on) {
    return '<button type="button" class="cx-dia-btn' + (on ? " cx-dia-btn--on" : "") +
      '" data-act="' + act + '" data-id="' + esc(id) + '">' + esc(label) + "</button>";
  }

  /* ── 1. Flow-volume loop ─────────────────────────────────────────────────── */

  function flowVolume(o) {
    var focus = (o && o.focus) || "both";
    var dimN = focus === "copd" ? ' class="cx-dia-dim"' : "";
    var dimC = focus === "normal" ? ' class="cx-dia-dim"' : "";
    return '<svg class="cx-dia" viewBox="0 0 340 240" role="img" aria-label="Flow volume loop, normal compared with obstruction">' +
      '<line class="cx-dia-axis" x1="44" y1="120" x2="320" y2="120"/>' +
      '<line class="cx-dia-axis" x1="44" y1="20" x2="44" y2="210"/>' +
      '<text class="cx-dia-lbl" x="326" y="116" text-anchor="end">Volume</text>' +
      '<text class="cx-dia-lbl" x="48" y="16">Flow</text>' +
      '<g' + dimN + '><path class="cx-dia-normal" d="M60 120 L74 46 L300 118"/>' +
        '<path class="cx-dia-normal cx-dia-insp" d="M300 118 C250 196 120 196 60 120"/>' +
        '<circle class="cx-dia-dot" cx="74" cy="46" r="3.5"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--normal" x="80" y="42">Normal: sharp peak, straight descent</text></g>' +
      '<g' + dimC + '><path class="cx-dia-copd" d="M60 120 L80 78 C130 104 210 116 288 119"/>' +
        '<path class="cx-dia-copd cx-dia-insp" d="M288 119 C246 168 130 170 60 120"/>' +
        '<circle class="cx-dia-dot cx-dia-dot--copd" cx="80" cy="78" r="3.5"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--copd" x="140" y="152">Obstruction: low peak, scooped</text>' +
        '<path class="cx-dia-arrow" d="M162 145 L150 124"/></g>' +
      "</svg>" +
      '<div class="cx-dia-toggle">' + btn("cx-dia-focus", "normal", "Normal", focus === "normal") +
        btn("cx-dia-focus", "copd", "Obstruction", focus === "copd") +
        btn("cx-dia-focus", "both", "Both", focus === "both") + "</div>";
  }

  /* ── 2. Air trapping ─────────────────────────────────────────────────────── */

  function airTrapping() {
    return '<svg class="cx-dia cx-dia--anim" viewBox="0 0 340 200" role="img" aria-label="Small airway collapse on expiration causing gas trapping">' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="12" y="18">Normal</text>' +
      '<path class="cx-dia-airway" d="M12 70 L96 70 M12 96 L96 96"/>' +
      '<circle class="cx-dia-alv" cx="126" cy="83" r="26"/>' +
      '<g class="cx-dia-traction"><line x1="96" y1="70" x2="112" y2="58"/><line x1="96" y1="96" x2="112" y2="108"/>' +
        '<line x1="88" y1="70" x2="88" y2="54"/><line x1="88" y1="96" x2="88" y2="112"/></g>' +
      '<circle class="cx-dia-air cx-dia-air--out" cx="90" cy="83" r="5"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="12" y="132">Traction holds the airway open,</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="12" y="146">so the alveolus empties.</text>' +
      '<line class="cx-dia-div" x1="170" y1="10" x2="170" y2="190"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="184" y="18">Emphysema</text>' +
      '<path class="cx-dia-airway cx-dia-airway--collapse" d="M184 70 C232 70 244 80 268 83 M184 96 C232 96 244 86 268 83"/>' +
      '<circle class="cx-dia-alv cx-dia-alv--big" cx="300" cy="83" r="30"/>' +
      '<circle class="cx-dia-air cx-dia-air--trapped" cx="300" cy="83" r="5"/>' +
      '<circle class="cx-dia-air cx-dia-air--trapped2" cx="292" cy="74" r="4"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="184" y="132">Traction is destroyed, the airway</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="184" y="146">closes, and gas is trapped.</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="184" y="174">Hyperinflation, barrel chest,</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="184" y="188">hyperresonance.</text>' +
      "</svg>";
  }

  /* ── 3. Percussion zones (interactive) ───────────────────────────────────── */

  var ZONES = [
    { id: "apexL", cx: 118, cy: 46, n: 1, label: "Left apex", finding: "Hyperresonant. Percuss the clavicle directly here." },
    { id: "apexR", cx: 202, cy: 46, n: 2, label: "Right apex", finding: "Hyperresonant, and equal to the left. It is the COMPARISON that matters, not the note alone." },
    { id: "upperL", cx: 112, cy: 88, n: 3, label: "Left upper zone", finding: "Hyperresonant." },
    { id: "upperR", cx: 208, cy: 88, n: 4, label: "Right upper zone", finding: "Hyperresonant and symmetrical." },
    { id: "midL", cx: 108, cy: 128, n: 5, label: "Left mid zone", finding: "In COPD the cardiac dullness that should be here is LOST, because hyperinflated lung has expanded over the heart." },
    { id: "midR", cx: 212, cy: 128, n: 6, label: "Right mid zone", finding: "Hyperresonant." },
    { id: "lowerL", cx: 112, cy: 170, n: 7, label: "Left base", finding: "Hyperresonant. STONY dullness here would mean an effusion, not COPD." },
    { id: "lowerR", cx: 208, cy: 170, n: 8, label: "Right base", finding: "Hyperresonant, and the liver dullness is pushed DOWN to about the seventh space." }
  ];

  function chestOutline() {
    return '<path class="cx-dia-body" d="M160 16 C126 16 96 28 90 44 C82 66 84 150 92 178 C98 196 122 200 160 200 C198 200 222 196 228 178 C236 150 238 66 230 44 C224 28 194 16 160 16 Z"/>' +
      '<line class="cx-dia-mid" x1="160" y1="22" x2="160" y2="196"/>';
  }

  function percussionMap(o) {
    var sel = (o && o.selected) || null, html = "", i;
    html += '<svg class="cx-dia cx-dia--chest" viewBox="0 0 320 210" role="img" aria-label="Chest percussion zones in comparative order">' + chestOutline();
    for (i = 0; i < ZONES.length; i++) {
      var z = ZONES[i], on = sel === z.id;
      html += '<g class="cx-dia-zone' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-zone" data-id="' + z.id + '" role="button" tabindex="0" aria-label="' + esc(z.label) + '">' +
        '<circle cx="' + z.cx + '" cy="' + z.cy + '" r="15"/>' +
        '<text x="' + z.cx + '" y="' + (z.cy + 4) + '" text-anchor="middle">' + z.n + "</text></g>";
      if (z.n % 2 === 1 && ZONES[i + 1]) {
        html += '<path class="cx-dia-cmp" d="M' + (z.cx + 17) + " " + z.cy + " L" + (ZONES[i + 1].cx - 17) + " " + ZONES[i + 1].cy + '"/>';
      }
    }
    html += "</svg>";
    var chosen = null;
    for (i = 0; i < ZONES.length; i++) if (ZONES[i].id === sel) chosen = ZONES[i];
    html += '<div class="cx-dia-note">' + (chosen ? "<b>" + esc(chosen.label) + "</b> " + esc(chosen.finding)
      : "Tap a numbered zone. The numbers are the ORDER: side to side at matched levels, never down one side then the other.") + "</div>";
    return html;
  }

  /* ── 4. Percussion TECHNIQUE (animated) ──────────────────────────────────── */

  /* The map above teaches WHERE. This teaches HOW, and it is the part students do badly: a stiff
   * arm instead of a loose wrist, and a pleximeter finger that is not pressed flat. */
  function percussionTechnique() {
    return '<svg class="cx-dia cx-dia--anim" viewBox="0 0 340 200" role="img" aria-label="Percussion technique, pleximeter finger and a loose wrist">' +
      '<rect class="cx-dia-skin" x="20" y="120" width="300" height="60" rx="8"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="24" y="174">chest wall</text>' +
      // pleximeter finger: pressed FLAT into an intercostal space
      '<path class="cx-dia-hand" d="M70 118 L170 118 L176 128 L64 128 Z"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="70" y="110">pleximeter finger, pressed flat</text>' +
      '<path class="cx-dia-press" d="M120 96 L120 114" marker-end="url(#cxArrow)"/>' +
      // striking finger, pivoting from the wrist
      '<g class="cx-dia-strike">' +
        '<path class="cx-dia-hand" d="M150 40 L206 40 L212 52 L156 52 Z"/>' +
        '<path class="cx-dia-finger" d="M150 46 L134 106"/>' +
        '<circle class="cx-dia-tip" cx="133" cy="110" r="5"/>' +
      "</g>" +
      '<path class="cx-dia-arc" d="M186 44 A 52 52 0 0 0 150 92"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="196" y="78">loose WRIST,</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="196" y="92">not a stiff arm</text>' +
      '<defs><marker id="cxArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">' +
        '<path d="M0 0 L10 5 L0 10 z" class="cx-dia-arrowhead"/></marker></defs>' +
      "</svg>" +
      '<div class="cx-dia-note">Strike the middle phalanx <b>twice</b>, then lift the finger away and move on. ' +
      'The movement comes from the wrist. A stiff arm damps the note and tires you out over a full examination.</div>';
  }

  /* ── 5. Chest expansion: the floating thumb (interactive + animated) ─────── */

  /* THE single highest-value diagram in the respiratory set. The floating-thumb detail is what
   * students get wrong, it makes the sign vanish entirely, and it is nearly impossible to convey
   * in prose. Toggling between anchored, floating, and pathological lag shows exactly what is lost. */
  function expansion(o) {
    var mode = (o && o.mode) || "float"; // float | unilateral | bilateral | anchored
    var isFloat = mode === "float";
    var isUnilateral = mode === "unilateral";
    var isBilateral = mode === "bilateral";
    var isAnchored = mode === "anchored";

    var animClass = isAnchored ? "cx-dia--anchored"
      : isUnilateral ? "cx-dia--unilateral"
      : isBilateral ? "cx-dia--bilateral"
      : "cx-dia--float";

    var measurementText = isFloat ? "Symmetric Normal Excursion: ≥ 5.0 cm (2.5 cm lateral per side)"
      : isUnilateral ? "Unilateral Lag: Right lags (0.5 cm) vs Left (3.5 cm) — Effusion / Collapse"
      : isBilateral ? "Bilateral Limitation: Symmetrical < 3.0 cm excursion — Emphysema / Ankylosing Spondylitis"
      : "Technical Error: Thumbs anchored to skin travel with ribs (0 cm gap) — Asymmetry masked!";

    var html = '<svg class="cx-dia cx-dia--anim ' + animClass + '" viewBox="0 0 360 250" role="img" aria-label="Thoracic chest expansion with floating thumbs vs anchored technical error">';

    // Chest cage outline
    html += '<path class="cx-dia-chest" d="M180 30 C110 30 50 65 42 120 C34 175 60 215 110 230 C140 238 220 238 250 230 C300 215 326 175 318 120 C310 65 250 30 180 30 Z"/>';

    // Rib contours (5th to 7th ribs)
    html += '<path d="M180 65 Q115 80 55 125 M180 65 Q245 80 305 125" stroke="var(--cx-line)" stroke-width="1.8" fill="none" opacity="0.6"/>';
    html += '<path d="M180 95 Q115 112 52 155 M180 95 Q245 112 308 155" stroke="var(--cx-line)" stroke-width="1.8" fill="none" opacity="0.6"/>';
    html += '<path d="M180 128 Q120 148 58 190 M180 128 Q240 148 302 190" stroke="var(--cx-line)" stroke-width="1.8" fill="none" opacity="0.6"/>';

    // Midline vertebral/sternal axis
    html += '<line class="cx-dia-mid" x1="180" y1="20" x2="180" y2="240" stroke="var(--cx-muted)" stroke-width="1.5" stroke-dasharray="4 3"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="180" y="22" text-anchor="middle" font-size="9">MIDLINE AXIS</text>';

    // Metric Excursion Ruler (scale in centimeters)
    html += '<g class="cx-dia-ruler" transform="translate(0, 150)">';
    html += '<rect x="120" y="-8" width="120" height="16" rx="4" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="1"/>';
    html += '<line x1="180" y1="-8" x2="180" y2="8" stroke="var(--cx-primary)" stroke-width="2"/>';
    html += '<line x1="155" y1="-4" x2="155" y2="4" stroke="var(--cx-muted)" stroke-width="1.2"/>';
    html += '<line x1="205" y1="-4" x2="205" y2="4" stroke="var(--cx-muted)" stroke-width="1.2"/>';
    html += '<line x1="130" y1="-4" x2="130" y2="4" stroke="var(--cx-muted)" stroke-width="1.2"/>';
    html += '<line x1="230" y1="-4" x2="230" y2="4" stroke="var(--cx-muted)" stroke-width="1.2"/>';
    html += '<text x="180" y="5" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--cx-ink)">0 cm</text>';
    html += '<text x="155" y="5" text-anchor="middle" font-size="7.5" fill="var(--cx-muted)">-2.5</text>';
    html += '<text x="205" y="5" text-anchor="middle" font-size="7.5" fill="var(--cx-muted)">+2.5</text>';
    html += '</g>';

    // Examiner hands gripping lateral chest wall
    html += '<g class="cx-dia-hand-wrap-L">' +
      '<path class="cx-dia-hand" d="M35 110 C50 110 65 115 78 128 L78 165 C65 178 50 180 35 180 L20 180 L20 110 Z"/>' +
      '<path class="cx-dia-finger" d="M78 132 C95 132 110 136 125 142"/>' +
      '<path class="cx-dia-finger" d="M78 145 C98 145 115 150 130 156"/>' +
      '<path class="cx-dia-finger" d="M78 158 C96 158 112 163 125 170"/>' +
      '</g>';

    html += '<g class="cx-dia-hand-wrap-R">' +
      '<path class="cx-dia-hand" d="M325 110 C310 110 295 115 282 128 L282 165 C295 178 310 180 325 180 L340 180 L340 110 Z"/>' +
      '<path class="cx-dia-finger" d="M282 132 C265 132 250 136 235 142"/>' +
      '<path class="cx-dia-finger" d="M282 145 C262 145 245 150 230 156"/>' +
      '<path class="cx-dia-finger" d="M282 158 C264 158 248 163 235 170"/>' +
      '</g>';

    // Thumbs meeting at midline (animated)
    html += '<g class="cx-dia-thumbL">' +
      '<path class="cx-dia-thumb" d="M80 125 C105 125 140 135 174 135 L174 145 C140 145 105 135 80 135 Z"/>' +
      '<circle cx="174" cy="140" r="3.5" fill="#f59e0b"/>' +
      '</g>';

    html += '<g class="cx-dia-thumbR">' +
      '<path class="cx-dia-thumb" d="M280 125 C255 125 220 135 186 135 L186 145 C220 145 255 135 280 135 Z"/>' +
      '<circle cx="186" cy="140" r="3.5" fill="#f59e0b"/>' +
      '</g>';

    // Live Excursion Banner
    var bannerColor = isAnchored ? "var(--cx-bad)" : isUnilateral ? "var(--cx-teach)" : isBilateral ? "var(--cx-warn)" : "var(--cx-ok)";
    html += '<rect x="15" y="195" width="330" height="38" rx="6" fill="var(--cx-surface)" stroke="' + bannerColor + '" stroke-width="1.5"/>';
    html += '<text class="cx-dia-lbl" x="180" y="212" text-anchor="middle" font-size="11.5" font-weight="700" fill="' + bannerColor + '">' + esc(measurementText) + '</text>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="180" y="226" text-anchor="middle" font-size="9.5">Hands anchored firmly to lateral ribs; thumbs lifted FREE of skin fold.</text>';

    html += '</svg>';

    html += '<div class="cx-dia-toggle">' +
      btn("cx-dia-mode", "float", "Normal Floating (≥ 5 cm)", isFloat) +
      btn("cx-dia-mode", "unilateral", "Unilateral Lag (Effusion)", isUnilateral) +
      btn("cx-dia-mode", "bilateral", "Bilateral Reduced (< 3 cm)", isBilateral) +
      btn("cx-dia-mode", "anchored", "Anchored Error (0 cm)", isAnchored) +
      '</div>';

    html += '<div class="cx-dia-note">' + (isAnchored
      ? '<b>Commonest Examination Trap:</b> When thumbs are pressed down firmly against the ribcage skin, they travel passively with the chest wall. The gap between them <b>never opens</b>, making even a massive unilateral effusion or pneumothorax appear falsely normal! Thumbs must be lifted slightly free of the wall.'
      : isUnilateral
        ? '<b>Unilateral Expansion Lag:</b> Hallmark of unilateral pathology on the lagging side: <b>Pleural Effusion</b> (stony dull), <b>Lobar Consolidation</b> (dull + bronchial breathing), <b>Pneumothorax</b> (hyper-resonant), or <b>Bronchial Obstruction / Collapse</b> (dull + trachea pulled towards).'
        : isBilateral
          ? '<b>Bilateral Symmetrical Reduction:</b> Total excursion < 3 cm indicates diffuse restrictive chest wall pathology (<b>Ankylosing Spondylitis</b>) or severe chronic hyperinflation with flattened diaphragms (<b>Emphysema / Severe COPD</b>).'
          : '<b>Standard Clinical Technique:</b> Firmly anchor fingers into the lateral chest wall (anteriorly at 5th/6th ribs or posteriorly at 10th ribs). Pull skin medially to form a small midline fold. <b>Lift thumbs clear of the chest wall</b> so they float free. Instruct patient to inspire deeply from residual volume: normal excursion is <b>≥ 5.0 cm</b>.') + '</div>';

    return html;
  }

  /* ── 6. Auscultation sites (interactive, and it plays the sound) ─────────── */

  var AUSC = [
    { id: "a1", cx: 120, cy: 44, n: 1, label: "Right apex", sound: "vesicular", note: "Vesicular. Compare immediately with the left apex.", ytVid: "xddT24a5XYc", ytStart: 31 },
    { id: "a2", cx: 200, cy: 44, n: 2, label: "Left apex", sound: "vesicular", note: "Vesicular, and equal to the right.", ytVid: "xddT24a5XYc", ytStart: 31 },
    { id: "a3", cx: 112, cy: 92, n: 3, label: "Right upper", sound: "reduced", note: "In COPD, symmetrically REDUCED with a prolonged expiratory phase.", ytVid: "xddT24a5XYc", ytStart: 31 },
    { id: "a4", cx: 208, cy: 92, n: 4, label: "Left upper", sound: "reduced", note: "Reduced, matching the right. Symmetry is the point.", ytVid: "xddT24a5XYc", ytStart: 31 },
    { id: "a5", cx: 108, cy: 136, n: 5, label: "Right mid", sound: "wheeze", note: "Polyphonic expiratory wheeze: many notes at once, diffuse airflow obstruction.", ytVid: "xddT24a5XYc", ytStart: 40 },
    { id: "a6", cx: 212, cy: 136, n: 6, label: "Left mid", sound: "wheeze", note: "Wheeze here too. Diffuse, not localised.", ytVid: "xddT24a5XYc", ytStart: 40 },
    { id: "a7", cx: 114, cy: 176, n: 7, label: "Right base", sound: "coarse", note: "Early COARSE crackles from secretions. Ask for a cough and listen again.", ytVid: "xddT24a5XYc", ytStart: 51 },
    { id: "a8", cx: 206, cy: 176, n: 8, label: "Left base", sound: "coarse", note: "Coarse crackles, shifting after a cough. That shift is what makes them secretions.", ytVid: "xddT24a5XYc", ytStart: 51 }
  ];

  function auscultationMap(o) {
    var sel = (o && o.selected) || null, html = "", i;
    html += '<svg class="cx-dia cx-dia--chest" viewBox="0 0 320 215" role="img" aria-label="Auscultation sites, tap to listen">' + chestOutline();
    for (i = 0; i < AUSC.length; i++) {
      var z = AUSC[i], on = sel === z.id;
      html += '<g class="cx-dia-zone cx-dia-zone--ausc' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-ausc" data-id="' + z.id + '" role="button" tabindex="0" aria-label="' + esc(z.label) + '">' +
        '<circle cx="' + z.cx + '" cy="' + z.cy + '" r="15"/>' +
        '<text x="' + z.cx + '" y="' + (z.cy + 4) + '" text-anchor="middle">' + z.n + "</text></g>";
      if (z.n % 2 === 1 && AUSC[i + 1]) {
        html += '<path class="cx-dia-cmp" d="M' + (z.cx + 17) + " " + z.cy + " L" + (AUSC[i + 1].cx - 17) + " " + AUSC[i + 1].cy + '"/>';
      }
    }
    html += "</svg>";
    var chosen = null;
    for (i = 0; i < AUSC.length; i++) if (AUSC[i].id === sel) chosen = AUSC[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? "<b>" + esc(chosen.label) + "</b> " + esc(chosen.note) + '<span class="cx-dia-playing">playing: ' + esc(chosen.sound) + "</span>" +
        (chosen.ytVid ? '<button type="button" class="cx-btn cx-btn--ghost" style="margin-left:8px;padding:3px 8px;font-size:11.5px;color:#c00;border-color:rgba(204,0,0,0.3);display:inline-flex;align-items:center;gap:4px;" data-act="cx-watch-sound" data-vid="' + esc(chosen.ytVid) + '" data-start="' + (chosen.ytStart || 0) + '">' + ic("smart_display") + ' Real (YouTube)</button>' : '')
      : "Tap a site to HEAR what you would find in this patient. Work side to side at matched levels, exactly as with percussion.") + "</div>";
    return html;
  }

  /* ── 7. Hoover sign (animated) ───────────────────────────────────────────── */

  function hoover() {
    return '<svg class="cx-dia cx-dia--anim" viewBox="0 0 340 190" role="img" aria-label="Hoover sign, lower costal margin moving inward on inspiration">' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="14" y="18">Normal diaphragm</text>' +
      '<path class="cx-dia-ribs cx-dia-ribs--out" d="M30 46 C30 46 62 40 92 46"/>' +
      '<path class="cx-dia-ribs cx-dia-ribs--out" d="M26 66 C26 66 62 58 96 66"/>' +
      '<path class="cx-dia-dome" d="M24 100 C56 74 68 74 100 100"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="14" y="124">Domed. Contracting, it lifts</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="14" y="138">the ribs OUT.</text>' +
      '<path class="cx-dia-arrow-out" d="M104 56 L128 50"/>' +
      '<line class="cx-dia-div" x1="170" y1="8" x2="170" y2="182"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="186" y="18">Flattened by hyperinflation</text>' +
      '<path class="cx-dia-ribs cx-dia-ribs--in" d="M200 46 C200 46 232 40 262 46"/>' +
      '<path class="cx-dia-ribs cx-dia-ribs--in" d="M196 66 C196 66 232 58 266 66"/>' +
      '<path class="cx-dia-dome cx-dia-dome--flat" d="M194 96 C226 92 238 92 270 96"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="186" y="124">Flat. Contracting, it pulls</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="186" y="138">the ribs IN.</text>' +
      '<path class="cx-dia-arrow-in" d="M280 56 L256 50"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="186" y="164">That paradoxical indrawing on</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="186" y="178">inspiration IS Hoover sign.</text>' +
      "</svg>";
  }

  /* ── 8. Barrel chest (comparison) ────────────────────────────────────────── */

  function barrelChest(o) {
    var view = (o && o.view) || "both";
    var dn = view === "barrel" ? ' class="cx-dia-dim"' : "";
    var db = view === "normal" ? ' class="cx-dia-dim"' : "";
    return '<svg class="cx-dia" viewBox="0 0 340 200" role="img" aria-label="Normal chest compared with barrel chest, seen from the side">' +
      '<g' + dn + '><text class="cx-dia-lbl cx-dia-lbl--normal" x="20" y="18">Normal, from the side</text>' +
        '<ellipse class="cx-dia-chest-s" cx="80" cy="100" rx="34" ry="58"/>' +
        '<path class="cx-dia-dim-line" d="M46 168 L114 168"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="52" y="184">AP diameter</text>' +
        '<path class="cx-dia-dim-line" d="M126 42 L126 158"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="132" y="104">transverse</text></g>' +
      '<line class="cx-dia-div" x1="176" y1="8" x2="176" y2="192"/>' +
      '<g' + db + '><text class="cx-dia-lbl cx-dia-lbl--copd" x="196" y="18">Barrel chest</text>' +
        '<ellipse class="cx-dia-chest-s cx-dia-chest-s--barrel" cx="256" cy="100" rx="54" ry="58"/>' +
        '<path class="cx-dia-dim-line cx-dia-dim-line--em" d="M202 168 L310 168"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--copd" x="206" y="184">AP diameter increased</text></g>' +
      "</svg>" +
      '<div class="cx-dia-toggle">' + btn("cx-dia-view", "normal", "Normal", view === "normal") +
        btn("cx-dia-view", "barrel", "Barrel", view === "barrel") +
        btn("cx-dia-view", "both", "Compare", view === "both") + "</div>" +
      '<div class="cx-dia-note">Judge this from the SIDE, not the front. "Barrel" means the anteroposterior diameter approaches the transverse; it is a ratio, not an impression.</div>';
  }

  /* ── 9. Trachea and cricosternal distance ────────────────────────────────── */

  function trachea() {
    return '<svg class="cx-dia" viewBox="0 0 340 200" role="img" aria-label="Assessing tracheal position with one finger">' +
      '<path class="cx-dia-neck" d="M120 16 L220 16 L232 120 L108 120 Z"/>' +
      '<rect class="cx-dia-trachea" x="160" y="24" width="20" height="92" rx="8"/>' +
      '<path class="cx-dia-clav" d="M96 116 C130 132 210 132 244 116"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="60" y="132">suprasternal notch</text>' +
      '<path class="cx-dia-hand" d="M150 140 L162 140 L166 122 L152 118 Z"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="176" y="146">ONE finger, gently</text>' +
      '<path class="cx-dia-dim-line" d="M196 30 L196 112"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="202" y="60">cricosternal</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="202" y="74">distance</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="202" y="90">3 to 4 fingers normal</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="14" y="176">Warn the patient first. Two or three fingers pressed hard is painful</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="14" y="190">and no more accurate. Two finger-breadths or less means hyperinflation.</text>' +
      "</svg>";
  }

  /* ── 10. Clubbing: profile angle + Schamroth ─────────────────────────────── */

  /* ── 10. Clubbing and the Schamroth Sign (Authentic Bedside Biomechanics) ── */

  function clubbing(o) {
    var view = (o && o.view) || "normal"; // normal | clubbed | both | grades | fluctuation
    var isNormal = view === "normal";
    var isClubbed = view === "clubbed";
    var isBoth = view === "both";
    var isGrades = view === "grades";
    var isFluct = view === "fluctuation";

    var html = '<svg class="cx-dia" viewBox="0 0 360 250" role="img" aria-label="Schamroth sign: nail-to-nail opposition and Lovibond angle">';

    if (isGrades) {
      // 5 Clinical Grades View
      html += '<rect x="10" y="10" width="340" height="230" rx="8" fill="var(--cx-surface)" stroke="var(--cx-line)"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="180" y="32" text-anchor="middle" font-size="13" font-weight="700">Five Clinical Grades of Finger Clubbing</text>';

      var grades = [
        { g: "Grade 1", title: "Softening & Fluctuation", desc: "Boggy nail bed with positive bimanual fluctuation test.", y: 52, color: "#0ea5e9" },
        { g: "Grade 2", title: "Loss of Lovibond Angle", desc: "Angle >180°; Schamroth diamond window obliterated.", y: 89, color: "#3b82f6" },
        { g: "Grade 3", title: "Accentuated Curvature", desc: "Nail becomes convex in both axes ('parrot-beak' / watch-glass).", y: 126, color: "#8b5cf6" },
        { g: "Grade 4", title: "Bulbous Drumsticking", desc: "Gross hypertrophy of distal phalanx soft tissue with dusky erythema.", y: 163, color: "#ec4899" },
        { g: "Grade 5", title: "Hypertrophic Osteoarthropathy", desc: "HPOA / Pierre Marie-Bamberger: painful wrist/ankle periostitis.", y: 200, color: "#ef4444" }
      ];

      for (var k = 0; k < grades.length; k++) {
        var gr = grades[k];
        html += '<rect x="20" y="' + gr.y + '" width="60" height="26" rx="4" fill="' + gr.color + '" opacity="0.15"/>';
        html += '<text x="50" y="' + (gr.y + 17) + '" text-anchor="middle" font-size="10.5" font-weight="800" fill="' + gr.color + '">' + gr.g + '</text>';
        html += '<text x="90" y="' + (gr.y + 12) + '" font-size="11.5" font-weight="700" fill="var(--cx-ink)">' + gr.title + '</text>';
        html += '<text x="90" y="' + (gr.y + 24) + '" font-size="10" fill="var(--cx-muted)">' + gr.desc + '</text>';
      }

    } else if (isFluct) {
      // Bimanual Fluctuation Test
      html += '<rect x="10" y="10" width="340" height="230" rx="8" fill="var(--cx-surface)" stroke="var(--cx-line)"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="180" y="30" text-anchor="middle" font-size="13" font-weight="700">Bimanual Fluctuation Test (Grade 1 Clubbing)</text>';

      // Patient finger horizontal in profile
      html += '<path d="M60 110 L190 110 C220 110 240 120 240 135 C240 150 220 160 190 160 L60 160 Z" fill="var(--cx-surface-2)" stroke="var(--cx-ink)" stroke-width="2"/>';
      // Boggy nail plate
      html += '<path d="M140 110 C170 102 210 108 230 124" stroke="var(--cx-teach)" stroke-width="3.5" fill="none"/>';
      // Examiner index fingers supporting pulp from beneath
      html += '<rect x="150" y="165" width="22" height="35" rx="5" fill="var(--cx-primary-soft)" stroke="var(--cx-primary)" stroke-width="1.5"/>';
      html += '<rect x="200" y="165" width="22" height="35" rx="5" fill="var(--cx-primary-soft)" stroke="var(--cx-primary)" stroke-width="1.5"/>';
      html += '<text x="186" y="215" text-anchor="middle" font-size="10" fill="var(--cx-primary)" font-weight="600">Examiner index fingers support pulp</text>';

      // Examiner thumbs pressing down alternately on nail base
      html += '<rect x="150" y="65" width="22" height="35" rx="5" fill="#f59e0b" opacity="0.25" stroke="#f59e0b" stroke-width="1.5"/>';
      html += '<path d="M161 75 L161 100" stroke="#f59e0b" stroke-width="2.5" marker-end="url(#cxClubArr)"/>';
      html += '<rect x="200" y="65" width="22" height="35" rx="5" fill="#f59e0b" opacity="0.25" stroke="#f59e0b" stroke-width="1.5"/>';
      html += '<path d="M211 75 L211 100" stroke="#f59e0b" stroke-width="2.5" marker-end="url(#cxClubArr)"/>';

      html += '<defs><marker id="cxClubArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#f59e0b"/></marker></defs>';
      html += '<text x="186" y="55" text-anchor="middle" font-size="10.5" fill="#d97706" font-weight="700">Alternate downward pressure: floating / spongy sensation</text>';

    } else {
      // Direct nail-to-nail opposition (Schamroth sign)
      var clubMode = isClubbed;

      // Draw Left Finger
      if (clubMode) {
        html += '<path class="cx-dia-finger-s" d="M30 90 L110 90 C135 90 155 78 174 95 L178 126 C178 145 145 168 110 168 L30 168 Z"/>';
        html += '<path class="cx-dia-nail cx-dia-nail--club" d="M135 84 C158 76 174 88 178 124"/>';
      } else {
        html += '<path class="cx-dia-finger-s" d="M30 90 L110 90 C135 90 152 100 168 104 L178 128 C176 142 145 156 110 156 L30 156 Z"/>';
        html += '<path class="cx-dia-nail" d="M142 102 C160 104 172 112 178 126"/>';
        html += '<path d="M128 92 L142 102 L162 104" fill="none" stroke="var(--cx-muted)" stroke-width="1.5" stroke-dasharray="2 2"/>';
        html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="120" y="82" font-size="9.5">Lovibond ~160°</text>';
      }

      // Draw Right Finger (mirror across x=180)
      if (clubMode) {
        html += '<path class="cx-dia-finger-s" d="M330 90 L250 90 C225 90 205 78 186 95 L182 126 C182 145 215 168 250 168 L330 168 Z"/>';
        html += '<path class="cx-dia-nail cx-dia-nail--club" d="M225 84 C202 76 186 88 182 124"/>';
      } else {
        html += '<path class="cx-dia-finger-s" d="M330 90 L250 90 C225 90 208 100 192 104 L182 128 C184 142 215 156 250 156 L330 156 Z"/>';
        html += '<path class="cx-dia-nail" d="M218 102 C200 104 188 112 182 126"/>';
        html += '<path d="M232 92 L218 102 L198 104" fill="none" stroke="var(--cx-muted)" stroke-width="1.5" stroke-dasharray="2 2"/>';
        html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="240" y="82" font-size="9.5">Lovibond ~160°</text>';
      }

      // Opposition Midline & Schamroth Window
      if (!clubMode) {
        // Normal: Diamond Window is OPEN
        html += '<polygon points="180,104 188,118 180,130 172,118" class="cx-dia-window-light"/>';
        html += '<line x1="180" y1="92" x2="180" y2="104" stroke="#f59e0b" stroke-width="2.5"/>';
        html += '<line x1="180" y1="130" x2="180" y2="142" stroke="#f59e0b" stroke-width="2.5"/>';
        html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="180" y="156" text-anchor="middle" font-size="11" font-weight="700">DIAMOND WINDOW OPEN</text>';
        html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="180" y="170" text-anchor="middle" font-size="9.5">Light passes through aperture (Schamroth Negative)</text>';
      } else {
        // Clubbed: Diamond Window is OBLITERATED
        html += '<circle cx="180" cy="118" r="14" fill="rgba(239, 68, 68, 0.15)" stroke="#ef4444" stroke-width="2"/>';
        html += '<line x1="170" y1="108" x2="190" y2="128" stroke="#ef4444" stroke-width="2.5"/>';
        html += '<line x1="190" y1="108" x2="170" y2="128" stroke="#ef4444" stroke-width="2.5"/>';
        html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="180" y="156" text-anchor="middle" font-size="11" font-weight="700">SCHAMROTH SIGN POSITIVE</text>';
        html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="180" y="170" text-anchor="middle" font-size="9.5">Window Obliterated (Lovibond angle &gt;180°)</text>';
      }

      html += '<text class="cx-dia-lbl cx-dia-lbl--faint" x="180" y="24" text-anchor="middle">Opposition of Distal Phalanges (Dorsal-to-Dorsal Surface)</text>';

      // Bottom Status Banner
      html += '<rect x="15" y="196" width="330" height="38" rx="6" fill="var(--cx-surface)" stroke="' + (clubMode ? 'var(--cx-bad)' : 'var(--cx-ok)') + '" stroke-width="1.5"/>';
      html += '<text class="cx-dia-lbl" x="180" y="213" text-anchor="middle" font-size="11.5" font-weight="700" fill="' + (clubMode ? 'var(--cx-bad)' : 'var(--cx-ok)') + '">' +
        (clubMode ? 'Positive Schamroth Sign: Window obliterated by hyponychial swelling' : 'Normal: Diamond-shaped aperture of light visible at base of nail folds') + '</text>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="180" y="227" text-anchor="middle" font-size="9.5">' +
        (clubMode ? 'Angle >180°. Look for bronchiectasis, lung abscess, TB, or cyanotic CHD.' : 'Angle ~160°. Clubbing is NOT a feature of uncomplicated COPD.') + '</text>';
    }

    html += '</svg>';

    html += '<div class="cx-dia-toggle">' +
      btn("cx-dia-view", "normal", "Normal (Window Open)", isNormal) +
      btn("cx-dia-view", "clubbed", "Clubbed (Window Closed)", isClubbed) +
      btn("cx-dia-view", "grades", "5 Clinical Grades", isGrades) +
      btn("cx-dia-view", "fluctuation", "Fluctuation Test", isFluct) +
      '</div>';

    html += '<div class="cx-dia-note">' + (isGrades
      ? '<b>The Five Grades of Clubbing:</b> In exams, examiners frequently ask: <i>"What grade of clubbing does this patient have?"</i>. Grade 1 begins with softening of the nail bed, Grade 2 obliterates the Schamroth window, Grade 3 develops the classic parrot-beak curve, Grade 4 expands the digit into a bulbous drumstick, and Grade 5 develops painful HPOA periostitis.'
      : isFluct
        ? '<b>Bimanual Fluctuation Technique:</b> Fix the patient\'s distal interphalangeal joint with both of your index fingers supporting the palmar pulp from beneath. Place your two thumbs on the proximal nail fold and press alternately. In active clubbing, the nail plate feels like a floating sponge (positive ballotability).'
        : isClubbed
          ? '<b>Pathophysiology of Schamroth\'s Sign:</b> Described by Leo Schamroth on himself when he developed infective endocarditis. Platelet-derived growth factor (PDGF) and VEGF released by impacted megakaryocytes in the peripheral microvasculature cause soft tissue hyperplasia at the nail root, obliterating the window.'
          : '<b>Bedside Diagnostic Rule:</b> Always inspect the profile of the nail at eye level. Finding clubbing in a smoker suspected of COPD indicates that a <b>second pathology</b> (e.g. Bronchogenic Carcinoma or Bronchiectasis) is present, as uncomplicated COPD NEVER causes clubbing.') + '</div>';

    return html;
  }

  /* ── 11. Effusion vs collapse: which way the trachea moves ───────────────── */

  function effusionShift(o) {
    var mode = (o && o.mode) || "effusion";
    var eff = mode === "effusion";
    return '<svg class="cx-dia" viewBox="0 0 340 210" role="img" aria-label="Mediastinal shift, effusion pushes away and collapse pulls towards">' +
      '<path class="cx-dia-body" d="M170 14 C120 14 78 30 70 52 C60 82 62 158 74 186 C82 202 120 206 170 206 C220 206 258 202 266 186 C278 158 280 82 270 52 C262 30 220 14 170 14 Z"/>' +
      (eff
        ? '<path class="cx-dia-fluid" d="M80 132 C110 122 140 122 164 132 L164 196 C120 200 90 194 78 184 Z"/>' +
          '<text class="cx-dia-lbl cx-dia-lbl--copd" x="86" y="166">fluid</text>' +
          '<path class="cx-dia-lung" d="M92 46 C124 40 152 46 160 60 L160 120 C132 112 106 114 86 122 Z"/>'
        : '<path class="cx-dia-lung cx-dia-lung--collapsed" d="M116 60 C138 54 154 60 160 70 L160 128 C142 124 128 126 116 130 Z"/>' +
          '<text class="cx-dia-lbl cx-dia-lbl--copd" x="86" y="110">collapsed</text>') +
      '<path class="cx-dia-lung" d="M180 46 C212 40 240 46 250 60 L250 190 C216 196 192 192 180 184 Z"/>' +
      // trachea, shifted according to mode
      '<rect class="cx-dia-trachea" x="' + (eff ? 186 : 150) + '" y="20" width="16" height="46" rx="7"/>' +
      '<path class="cx-dia-arrow-shift" d="M' + (eff ? "172 30 L196 30" : "180 30 L156 30") + '" marker-end="url(#cxArrow2)"/>' +
      '<defs><marker id="cxArrow2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">' +
        '<path d="M0 0 L10 5 L0 10 z" class="cx-dia-arrowhead"/></marker></defs>' +
      "</svg>" +
      '<div class="cx-dia-toggle">' + btn("cx-dia-mode", "effusion", "Large effusion", eff) +
        btn("cx-dia-mode", "collapse", "Collapse", !eff) + "</div>" +
      '<div class="cx-dia-note">' + (eff
        ? "A large effusion <b>PUSHES</b> the mediastinum AWAY from the dull side. Stony dull, absent breath sounds, reduced vocal resonance."
        : "Collapse <b>PULLS</b> the mediastinum TOWARDS the dull side. Same dull note, opposite shift, and it usually means an obstructing lesion. Always corroborate the trachea with the apex beat.") + "</div>";
  }

  /* ── 12. Breathing patterns (animated comparison) ────────────────────────── */

  function breathingPatterns() {
    function row(cls, y, name, sub) {
      return '<g><text class="cx-dia-lbl cx-dia-lbl--mute" x="10" y="' + (y - 16) + '">' + esc(name) + "</text>" +
        '<text class="cx-dia-lbl cx-dia-lbl--faint" x="10" y="' + (y - 4) + '">' + esc(sub) + "</text>" +
        '<rect class="cx-dia-breathbar ' + cls + '" x="120" y="' + (y - 22) + '" width="26" height="22" rx="5"/>' +
        '<line class="cx-dia-axis" x1="160" y1="' + (y - 11) + '" x2="330" y2="' + (y - 11) + '"/></g>';
    }
    return '<svg class="cx-dia cx-dia--anim" viewBox="0 0 340 180" role="img" aria-label="Breathing patterns compared">' +
      row("cx-dia-b-normal", 40, "Normal", "12 to 20 a minute, quiet") +
      row("cx-dia-b-tachy", 84, "Tachypnoea", "fast and shallow") +
      row("cx-dia-b-pursed", 128, "Pursed lip", "long, splinted expiration") +
      row("cx-dia-b-exhaust", 172, "Exhaustion", "SLOWING, and ominous") +
      "</svg>" +
      '<div class="cx-dia-note">The bars breathe at their real relative rates. A <b>falling</b> rate in an exhausted, distressed patient is not improvement, it is impending respiratory arrest.</div>';
  }

  function stemiEvolution() {
    var STAGES = [
      { name: "Hyperacute T", time: "first minutes", q: 0, st: 0, off: 42, bad: false },
      { name: "ST elevation", time: "first hours", q: 0, st: 16, off: 12, bad: true },
      { name: "Q wave forms", time: "hours to days", q: 7, st: 8, off: 6, bad: false },
      { name: "T inversion", time: "days", q: 7, st: 0, off: -20, bad: false },
      { name: "Resolution", time: "weeks onward", q: 6, st: 0, off: 8, bad: false }
    ];
    var b = 100; // baseline y, local to each 150-wide panel
    function trace(s) {
      var stY = b - s.st, apexY = stY - s.off;
      var d = "M0," + b + " L20," + b + " Q26," + (b - 8) + " 32," + b + " L42," + b;
      if (s.q) d += " L46," + (b + s.q);
      d += " L58," + (b - 50) + " L66," + (b + 16) + " L70," + stY + " L100," + stY;
      d += " Q120," + apexY + " 150," + b;
      return d;
    }
    var w = 158, panels = "";
    for (var i = 0; i < STAGES.length; i++) {
      var s = STAGES[i], x = i * w + 8;
      panels += '<g transform="translate(' + x + ',0)">' +
        '<text class="cx-dia-lbl ' + (s.bad ? "cx-dia-lbl--bad" : "cx-dia-lbl--normal") + '" x="75" y="14" text-anchor="middle">' + esc(s.name) + "</text>" +
        '<text class="cx-dia-lbl--faint" x="75" y="26" text-anchor="middle">' + esc(s.time) + "</text>" +
        '<line class="cx-dia-div" x1="0" y1="' + b + '" x2="150" y2="' + b + '"/>' +
        '<path class="cx-dia-normal" d="' + trace(s) + '"/>' +
        "</g>";
    }
    return '<svg class="cx-dia" viewBox="0 0 ' + (STAGES.length * w + 6) + ' 150" role="img" aria-label="STEMI evolution on serial ECGs">' + panels + "</svg>" +
      '<div class="cx-dia-note">Same lead, same territory, followed over time. The <b>ST elevation</b> stage is the one that changes management: it is what triggers urgent reperfusion, not the T wave or the Q wave. A pathological Q wave, once formed, usually never leaves.</div>';
  }

  /* ── 13. Nine regions of the abdomen (interactive) ───────────────────────── */

  var ABD_REGIONS = [
    { id: "rhyp", cx: 84, cy: 60, label: "Right hypochondrium", organs: "Liver, gallbladder, right kidney" },
    { id: "epig", cx: 170, cy: 60, label: "Epigastrium", organs: "Stomach, pancreas, duodenum, aorta" },
    { id: "lhyp", cx: 256, cy: 60, label: "Left hypochondrium", organs: "Spleen, splenic flexure, left kidney" },
    { id: "rlum", cx: 84, cy: 140, label: "Right lumbar", organs: "Ascending colon, right kidney" },
    { id: "umb", cx: 170, cy: 140, label: "Umbilical", organs: "Small bowel, aorta, para-aortic nodes" },
    { id: "llum", cx: 256, cy: 140, label: "Left lumbar", organs: "Descending colon, left kidney" },
    { id: "riif", cx: 84, cy: 220, label: "Right iliac fossa", organs: "Caecum, appendix" },
    { id: "hyp", cx: 170, cy: 220, label: "Hypogastrium", organs: "Bladder, uterus (if enlarged)" },
    { id: "liif", cx: 256, cy: 220, label: "Left iliac fossa", organs: "Sigmoid colon" }
  ];

  function abdRegions(o) {
    var sel = (o && o.selected) || null, html = "", i;
    html += '<svg class="cx-dia cx-dia--chest" viewBox="0 0 340 280" role="img" aria-label="Nine regions of the abdomen, tap to identify">' +
      '<rect class="cx-dia-body" x="14" y="16" width="312" height="248" rx="24"/>' +
      '<line class="cx-dia-mid" x1="127" y1="16" x2="127" y2="264"/>' +
      '<line class="cx-dia-mid" x1="213" y1="16" x2="213" y2="264"/>' +
      '<line class="cx-dia-mid" x1="14" y1="100" x2="326" y2="100"/>' +
      '<line class="cx-dia-mid" x1="14" y1="180" x2="326" y2="180"/>';
    for (i = 0; i < ABD_REGIONS.length; i++) {
      var r = ABD_REGIONS[i], on = sel === r.id;
      html += '<g class="cx-dia-zone cx-dia-zone--region' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-region" data-id="' + r.id + '" role="button" tabindex="0" aria-label="' + esc(r.label) + '">' +
        '<rect x="' + (r.cx - 40) + '" y="' + (r.cy - 34) + '" width="80" height="68" rx="8"/>' +
        '<text x="' + r.cx + '" y="' + (r.cy + 4) + '" text-anchor="middle">' + esc(r.label.split(" ")[0]) + "</text></g>";
    }
    html += "</svg>";
    var chosen = null;
    for (i = 0; i < ABD_REGIONS.length; i++) if (ABD_REGIONS[i].id === sel) chosen = ABD_REGIONS[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? "<b>" + esc(chosen.label) + "</b> " + esc(chosen.organs)
      : "Tap a region to see what normally lies beneath it. Localised distension or tenderness is read against this map.") + "</div>";
    return html;
  }

  /* ── 14. Liver palpation: the preferred (bimanual) method, animated ──────── */

  function liverPalp() {
    return '<svg class="cx-dia cx-dia--anim" viewBox="0 0 340 222" role="img" aria-label="Preferred method of liver palpation, hands rising to meet the descending edge on inspiration">' +
      '<rect class="cx-dia-skin" x="20" y="70" width="300" height="110" rx="14"/>' +
      '<path class="cx-dia-liver" d="M180 76 C230 70 280 78 296 96 L296 130 C260 118 210 116 182 126 Z"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="216" y="100">liver</text>' +
      '<g class="cx-dia-liverhands">' +
        '<path class="cx-dia-hand" d="M160 150 L296 150 L302 162 L154 162 Z"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--normal" x="160" y="178">both hands flat, fingers towards the ribs</text>' +
      "</g>" +
      '<path class="cx-dia-press" d="M228 190 L228 168" marker-end="url(#cxArrow)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="20" y="200">ask for a deep breath;</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="20" y="212">the edge meets the fingertips</text>' +
      '<defs><marker id="cxArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">' +
        '<path d="M0 0 L10 5 L0 10 z" class="cx-dia-arrowhead"/></marker></defs>' +
      "</svg>" +
      '<div class="cx-dia-note">The hand stays still. The DIAPHRAGM pushes the liver edge down onto your fingers on inspiration, rather than you chasing it down with repeated presses.</div>';
  }

  /* ── 15. Spleen: the diagonal sweep and where it enlarges towards ────────── */

  function spleenPalp() {
    return '<svg class="cx-dia cx-dia--anim" viewBox="0 0 340 210" role="img" aria-label="Splenic enlargement travels diagonally from the left upper quadrant towards the right iliac fossa">' +
      '<rect class="cx-dia-skin" x="20" y="16" width="300" height="178" rx="16"/>' +
      '<line class="cx-dia-mid" x1="170" y1="16" x2="170" y2="194"/>' +
      '<line class="cx-dia-mid" x1="20" y1="105" x2="320" y2="105"/>' +
      '<circle class="cx-dia-alv" cx="120" cy="60" r="16"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="60" y="40">normal spleen,</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="60" y="54">tucked under the ribs</text>' +
      '<path class="cx-dia-spleenpath" d="M120 60 C150 100 190 140 230 172"/>' +
      '<circle class="cx-dia-air cx-dia-air--trapped" cx="230" cy="172" r="10"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="150" y="190">enlarges towards</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="150" y="202">the right iliac fossa</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="26" y="150">sweep the palpating hand</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="26" y="164">diagonally along this line</text>' +
      "</svg>" +
      '<div class="cx-dia-note">A spleen you can feel has already doubled or tripled in size, and it enlarges along this one diagonal, from the left costal margin towards the umbilicus and the right iliac fossa, never in a random direction.</div>';
  }

  /* ── 16. Precordial auscultation and murmur radiation map ───────────────── */

  var PRECORDIAL = [
    { id: "aortic", cx: 136, cy: 74, tag: "A", label: "Aortic area (2nd R ICS)", sound: "as_murmur", radiation: "Carotids",
      note: "2nd right intercostal space, sternal edge. Harsh ejection systolic murmur of aortic stenosis radiates upwards to the carotids. Have the patient sit up and lean forward in full expiration." },
    { id: "pulm", cx: 184, cy: 74, tag: "P", label: "Pulmonary area (2nd L ICS)", sound: "s1s2_split", radiation: "Left clavicle",
      note: "2nd left intercostal space, sternal edge. Physiological splitting of S2 (A2 preceding P2 on inspiration). Widely fixed split indicates an ASD; loud P2 indicates pulmonary arterial hypertension." },
    { id: "erbs", cx: 180, cy: 100, tag: "E", label: "Erb's Point (3rd L ICS)", sound: "ar_murmur", radiation: "Apex / Left lower sternum",
      note: "3rd left intercostal space, sternal edge. High-pitched early diastolic blowing decrescendo murmur of aortic regurgitation is loudest here using the diaphragm with the patient leaning forward in expiration." },
    { id: "tricuspid", cx: 174, cy: 126, tag: "T", label: "Tricuspid area (4th L ICS)", sound: "s1s2_normal", radiation: "Right sternal edge",
      note: "4th/5th left intercostal space, lower sternal border. Pansystolic murmur of tricuspid regurgitation is accentuated during inspiration (Carvallo's sign), distinguishing it from mitral regurgitation." },
    { id: "mitral", cx: 212, cy: 152, tag: "M", label: "Mitral / Apex (5th L ICS MCL)", sound: "mr_murmur", radiation: "Left axilla",
      note: "5th left intercostal space, midclavicular line (apex beat). Holosystolic murmur of mitral regurgitation radiates into the left axilla. Mid-diastolic low-frequency rumble of mitral stenosis is best heard here with the bell in the left lateral decubitus position." }
  ];

  function precordiumMap(o) {
    var sel = (o && o.selected) || null, html = "", i;
    html += '<svg class="cx-dia cx-dia--precordium" viewBox="0 0 320 230" role="img" aria-label="Precordial auscultation sites and murmur radiation paths">' +
      '<defs>' +
        '<marker id="cxAuscArr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">' +
          '<path d="M0 0 L10 5 L0 10 z" class="cx-dia-arrowhead"/>' +
        '</marker>' +
      '</defs>' +
      chestOutline() +
      '<path class="cx-dia-heart-bg" d="M142 85 C138 115 142 148 160 162 C185 174 212 178 224 162 C230 145 224 110 210 82 C190 66 158 66 142 85 Z" fill="var(--cx-primary-2)" opacity="0.14" stroke="var(--cx-line)" stroke-dasharray="3 3"/>' +
      '<path class="cx-dia-clav" d="M96 46 C128 58 192 58 224 46" stroke="var(--cx-line)" stroke-width="1.5" fill="none"/>' +
      '<rect x="154" y="58" width="12" height="96" rx="4" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="1.2"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--faint" x="160" y="106" text-anchor="middle" transform="rotate(-90 160 106)">STERNUM</text>' +
      '<path class="cx-dia-rad cx-dia-rad--carotid' + (sel === "aortic" ? " cx-dia-rad--active" : "") + '" d="M136 60 L142 34 M136 60 L176 34" marker-end="url(#cxAuscArr)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="160" y="24" text-anchor="middle">Carotid Radiation (AS)</text>' +
      '<path class="cx-dia-rad cx-dia-rad--axilla' + (sel === "mitral" ? " cx-dia-rad--active" : "") + '" d="M224 154 L262 134" marker-end="url(#cxAuscArr)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="272" y="132" text-anchor="start">Axilla (MR)</text>';

    for (i = 0; i < PRECORDIAL.length; i++) {
      var p = PRECORDIAL[i], on = sel === p.id;
      html += '<g class="cx-dia-zone cx-dia-zone--ausc' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-ausc" data-id="' + p.id + '" role="button" tabindex="0" aria-label="' + esc(p.label) + '">' +
        '<circle cx="' + p.cx + '" cy="' + p.cy + '" r="14"/>' +
        '<text x="' + p.cx + '" y="' + (p.cy + 4) + '" text-anchor="middle">' + p.tag + '</text></g>';
    }
    html += "</svg>";
    var chosen = null;
    for (i = 0; i < PRECORDIAL.length; i++) if (PRECORDIAL[i].id === sel) chosen = PRECORDIAL[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? '<b>' + esc(chosen.label) + '</b> (' + esc(chosen.radiation) + '): ' + esc(chosen.note) + '<span class="cx-dia-playing">playing: ' + esc(chosen.sound) + '</span>'
      : "Tap an auscultation valve site (Aortic, Pulmonary, Erb's, Tricuspid, Mitral) to hear its murmur model and inspect characteristic radiation paths.") + "</div>";
    return html;
  }

  /* ── 17. Jugular venous pulse (JVP) waveform simulator ──────────────────── */

  function jvpWaveform(o) {
    var mode = (o && o.mode) || "normal";
    var pathD = "";
    var noteText = "";
    var titleTag = "";

    if (mode === "cannon") {
      titleTag = "Cannon 'a' Wave";
      pathD = "M20 130 L40 130 C48 130 52 26 64 26 C76 26 80 118 96 118 L114 96 L134 116 C150 116 164 78 184 78 C204 78 214 122 234 122 L310 122";
      noteText = "<b>Cannon 'a' Wave</b>: Giant presystolic venous surge. Right atrium contracts against a CLOSED tricuspid valve during ventricular systole. Characteristic of complete heart block (AV dissociation - variable cannon waves) or junctional rhythm (regular cannon waves).";
    } else if (mode === "absent_a") {
      titleTag = "Absent 'a' Wave (Atrial Fibrillation)";
      pathD = "M20 130 L64 130 C76 130 88 126 100 126 L118 108 L136 122 C152 122 168 66 190 66 C212 66 224 122 246 122 L310 122";
      noteText = "<b>Absent 'a' Wave</b>: In <b>Atrial Fibrillation</b>, the absence of organized atrial contraction completely abolishes the 'a' wave. The pulse shows only an exaggerated systolic 'v' wave and irregular diastolic intervals.";
    } else if (mode === "giant_v") {
      titleTag = "Giant 'v' / Lancisi's Sign (Tricuspid Regurgitation)";
      pathD = "M20 130 L44 130 C52 130 58 74 68 74 C78 74 86 112 98 112 C120 106 142 36 178 36 C210 36 226 126 248 126 L310 126";
      noteText = "<b>Giant 'v' (cv) Wave / Lancisi's Sign</b>: In severe <b>Tricuspid Regurgitation</b>, retrograde systolic flow jets directly from the right ventricle into the right atrium, obliterating the normal 'x' descent and creating a massive fused 'cv' wave with earlobe pulsation.";
    } else if (mode === "friedreich") {
      titleTag = "Friedreich's Sign (Constrictive Pericarditis)";
      pathD = "M20 130 L44 130 C52 130 58 68 68 68 C78 68 86 112 98 112 L114 90 L132 114 C150 114 164 68 184 68 C192 68 196 142 206 142 L224 142 C240 142 254 122 274 122 L310 122";
      noteText = "<b>Friedreich's Sign (Rapid 'y' Descent)</b>: In <b>Constrictive Pericarditis</b>, elevated systemic venous pressure produces a very steep, rapid early diastolic collapse ('y' descent) as blood rushes into the ventricle before abruptly encountering the rigid non-compliant pericardium. Blunted in cardiac tamponade.";
    } else {
      titleTag = "Normal JVP Waveform";
      pathD = "M20 130 L44 130 C52 130 58 66 68 66 C78 66 84 108 98 108 L114 88 L132 114 C150 114 164 74 184 74 C204 74 214 120 234 120 L310 120";
      noteText = "<b>Normal JVP</b>: Two positive waves (<b>a</b> = atrial contraction, <b>v</b> = venous filling) and two descents (<b>x</b> = atrial relaxation + ventricular descent, <b>y</b> = ventricular filling). S1/carotid pulse coincides with the peak of the 'c' wave.";
    }

    var html = '<svg class="cx-dia cx-dia--jvp" viewBox="0 0 340 220" role="img" aria-label="' + esc(titleTag) + '">' +
      '<line class="cx-dia-axis" x1="20" y1="130" x2="320" y2="130"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="24" y="22">' + esc(titleTag) + '</text>' +
      '<line x1="68" y1="28" x2="68" y2="200" stroke="var(--cx-line)" stroke-dasharray="2 2"/>' +
      '<line x1="114" y1="28" x2="114" y2="200" stroke="var(--cx-line)" stroke-dasharray="2 2"/>' +
      '<line x1="184" y1="28" x2="184" y2="200" stroke="var(--cx-line)" stroke-dasharray="2 2"/>' +
      '<path d="' + pathD + '" fill="none" stroke="var(--cx-primary)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>';

    if (mode !== "absent_a") {
      html += '<circle cx="68" cy="' + (mode === "cannon" ? 26 : 66) + '" r="3.5" fill="var(--cx-primary)"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--normal" x="68" y="' + (mode === "cannon" ? 20 : 58) + '" text-anchor="middle">a</text>';
    } else {
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="68" y="118" text-anchor="middle">no a</text>';
    }

    if (mode !== "giant_v") {
      html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="98" y="122" text-anchor="middle">x</text>' +
        '<circle cx="114" cy="88" r="3" fill="var(--cx-muted)"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="114" y="80" text-anchor="middle">c</text>';
    } else {
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="140" y="60" text-anchor="middle">giant cv fusion</text>';
    }

    html += '<circle cx="184" cy="' + (mode === "giant_v" ? 36 : 74) + '" r="3.5" fill="var(--cx-teach)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="184" y="' + (mode === "giant_v" ? 30 : 64) + '" text-anchor="middle">v</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="234" y="' + (mode === "friedreich" ? 154 : 132) + '" text-anchor="middle">y' + (mode === "friedreich" ? " (steep)" : "") + '</text>' +
      '<line class="cx-dia-axis" x1="20" y1="184" x2="320" y2="184" stroke="var(--cx-line)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--faint" x="24" y="176">ECG (timing reference)</text>' +
      '<path d="M20 184 L40 184 Q48 174 56 184 L104 184 L108 190 L112 156 L118 194 L122 184 L162 184 Q178 168 194 184 L310 184" fill="none" stroke="var(--cx-muted)" stroke-width="1.5"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--faint" x="48" y="196">P</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--faint" x="112" y="152">QRS (S1)</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--faint" x="178" y="196">T</text>' +
      '</svg>' +
      '<div class="cx-dia-toggle" style="flex-wrap:wrap">' +
        btn("cx-dia-mode", "normal", "Normal", mode === "normal") +
        btn("cx-dia-mode", "cannon", "Cannon 'a'", mode === "cannon") +
        btn("cx-dia-mode", "absent_a", "AF (No 'a')", mode === "absent_a") +
        btn("cx-dia-mode", "giant_v", "Giant 'v' (TR)", mode === "giant_v") +
        btn("cx-dia-mode", "friedreich", "Friedreich 'y'", mode === "friedreich") +
      '</div>' +
      '<div class="cx-dia-note">' + noteText + '</div>';
    return html;
  }

  /* ── 18. Dermatomes & deep tendon reflex landmarks ───────────────────────── */

  var DERMATOMES = [
    { id: "c5", cy: 68, cx: 80, label: "C5 Dermatome", root: "C5", landmark: "Lateral shoulder / deltoid", reflex: "Biceps reflex (C5, C6) — Musculocutaneous nerve", pearl: "Test pinprick over the lateral deltoid. Motor check: shoulder abduction (deltoid)." },
    { id: "c6", cy: 96, cx: 70, label: "C6 Dermatome", root: "C6", landmark: "Lateral forearm, thumb and index finger", reflex: "Supinator / Brachioradialis reflex (C5, C6) — Radial nerve", pearl: "Sensory check on the volar tip of the thumb. Motor check: elbow flexion and wrist extension." },
    { id: "c7", cy: 122, cx: 62, label: "C7 Dermatome", root: "C7", landmark: "Middle finger (dorsal and palmar)", reflex: "Triceps reflex (C7, C8) — Radial nerve", pearl: "Sensory check on the middle finger. Motor check: elbow extension and wrist flexion." },
    { id: "c8", cy: 146, cx: 66, label: "C8 Dermatome", root: "C8", landmark: "Little finger, medial border of hand", reflex: "Finger flexors (C8, T1) — Median / Ulnar nerves", pearl: "Sensory check over hypothenar eminence. Motor check: finger flexion (grip strength)." },
    { id: "t4", cy: 92, cx: 160, label: "T4 Sensory Level", root: "T4", landmark: "Nipple line (4th intercostal space)", reflex: "No peripheral tendon reflex (Cord level landmark)", pearl: "Crucial landmark for acute spinal cord lesions (e.g. transverse myelitis, epidural compression)." },
    { id: "t10", cy: 136, cx: 160, label: "T10 Sensory Level", root: "T10", landmark: "Umbilicus", reflex: "Superficial abdominal reflex (T9-T11)", pearl: "Umbilical level. Visceral referred pain of acute appendicitis starts at T10 before somatic localization." },
    { id: "l4", cy: 198, cx: 142, label: "L4 Dermatome", root: "L4", landmark: "Anterior knee, medial shin & malleolus", reflex: "Knee jerk / Patellar reflex (L3, L4) — Femoral nerve", pearl: "Sensory check over medial malleolus. Motor check: knee extension (quadriceps) and ankle dorsiflexion." },
    { id: "l5", cy: 236, cx: 138, label: "L5 Dermatome", root: "L5", landmark: "Dorsum of foot, first webspace, great toe", reflex: "No distinct tendon reflex (Hamstrings medial L5/S1)", pearl: "Sensory check in webspace between great and 2nd toe. Motor check: great toe dorsiflexion (EHL) — look for foot drop!" },
    { id: "s1", cy: 264, cx: 132, label: "S1 Dermatome", root: "S1", landmark: "Lateral border of foot, sole, Achilles", reflex: "Ankle jerk / Achilles reflex (S1, S2) — Tibial nerve", pearl: "Sensory check over lateral heel. Motor check: plantarflexion (gastrocnemius/soleus) and eversion." }
  ];

  function dermatomeMap(o) {
    var sel = (o && o.selected) || null, html = "", i;
    html += '<svg class="cx-dia cx-dia--dermatomes" viewBox="0 0 320 290" role="img" aria-label="Key dermatomes and deep tendon reflex landmarks">' +
      '<path class="cx-dia-body" d="M160 14 C150 14 144 22 144 32 C144 42 150 48 156 50 L126 58 C108 62 82 72 74 88 L60 148 C56 160 64 164 70 156 L86 112 L96 112 L96 172 L116 172 L120 274 C122 284 136 284 138 274 L146 196 L174 196 L182 274 C184 284 198 284 200 274 L204 172 L224 172 L224 112 L234 112 L250 156 C256 164 264 160 260 148 L246 88 C238 72 212 62 194 58 L164 50 C170 48 176 42 176 32 C176 22 170 14 160 14 Z"/>' +
      '<line x1="126" y1="92" x2="194" y2="92" stroke="var(--cx-line)" stroke-dasharray="2 2"/>' +
      '<line x1="126" y1="136" x2="194" y2="136" stroke="var(--cx-line)" stroke-dasharray="2 2"/>';

    for (i = 0; i < DERMATOMES.length; i++) {
      var d = DERMATOMES[i], on = sel === d.id;
      html += '<g class="cx-dia-zone' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-zone" data-id="' + d.id + '" role="button" tabindex="0" aria-label="' + esc(d.label) + '">' +
        '<circle cx="' + d.cx + '" cy="' + d.cy + '" r="12"/>' +
        '<text x="' + d.cx + '" y="' + (d.cy + 4) + '" text-anchor="middle" font-size="9.5">' + esc(d.root) + '</text></g>';
    }
    html += "</svg>";
    var chosen = null;
    for (i = 0; i < DERMATOMES.length; i++) if (DERMATOMES[i].id === sel) chosen = DERMATOMES[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? '<b>' + esc(chosen.label) + '</b> (' + esc(chosen.landmark) + ')<br>' +
        '<b>Reflex Arc:</b> ' + esc(chosen.reflex) + '<br>' +
        '<b>Clinical Pearl:</b> ' + esc(chosen.pearl)
      : "Tap a spinal root landmark (C5-C8 upper limb, T4/T10 trunk milestones, L4-S1 lower limb) to inspect its sensory test point and corresponding deep tendon reflex arc.") + '</div>';
    return html;
  }

  /* ── 19. Cranial Nerves I-XII Interactive Pathway Map ───────────────────── */

  /* ── 19. Cranial Nerves I-XII Interactive Ventral Brainstem Atlas ─────────── */

  var CRANIAL_NERVES = [
    {
      id: "cn1", num: "I", name: "Olfactory", type: "Sensory (SVA)",
      origin: "Olfactory mucosa -> cribriform foramina -> Olfactory bulb & tract (inferior frontal surface)",
      exit: "Cribriform plate of ethmoid bone",
      supplies: "Special visceral afferent (SVA) sense of smell from olfactory neuroepithelium in roof of nasal cavity.",
      test: "Check nasal airway patency. Test each nostril separately with eyes closed using familiar, non-irritating odors (coffee powder, vanilla, peppermint, soap). Avoid ammonia (stimulates CN V pain fibers).",
      lesion: "Anosmia / Hyposmia. Causes: Head trauma with cribriform plate fracture (look for CSF rhinorrhea), olfactory groove meningioma (Foster Kennedy syndrome: ipsilateral anosmia + optic atrophy, contralateral papilledema), early Parkinson's disease, Kallmann syndrome."
    },
    {
      id: "cn2", num: "II", name: "Optic", type: "Sensory (SSA)",
      origin: "Retinal ganglion cell axons -> Optic nerve -> Optic chiasm -> Optic tract -> Lateral Geniculate Nucleus",
      exit: "Optic canal (with ophthalmic artery)",
      supplies: "Special somatic afferent (SSA) vision; afferent limb of pupillary light reflex and accommodation reflex.",
      test: "1. Visual Acuity (Snellen chart / near card); 2. Visual Fields (confrontation perimetry); 3. Pupillary Light Reflex (direct and consensual swing-light test for RAPD / Marcus Gunn pupil); 4. Fundoscopy (optic disc swelling/papilledema vs optic atrophy).",
      lesion: "Monocular blindness (optic nerve lesion); Bitemporal hemianopia (chiasm compression by pituitary adenoma / craniopharyngioma); Contralateral homonymous hemianopia (optic tract or radiation stroke); Afferent Pupillary Defect (RAPD / Marcus Gunn pupil in optic neuritis)."
    },
    {
      id: "cn3", num: "III", name: "Oculomotor", type: "Motor (GSE + GVE Parasympathetic)",
      origin: "Interpeduncular fossa of Midbrain (medial sulcus of cerebral peduncles)",
      exit: "Superior orbital fissure",
      supplies: "Somatic motor (GSE): Superior Rectus, Inferior Rectus, Medial Rectus, Inferior Oblique, Levator Palpebrae Superioris. Parasympathetic (GVE from Edinger-Westphal): Sphincter pupillae (constriction) and Ciliary muscle (accommodation).",
      test: "Inspect resting eye position and eyelids (check for ptosis). Test extraocular movements in 'H' pattern (SR, IR, MR, IO). Check pupil size, symmetry, direct/consensual light reflexes, and near accommodation response.",
      lesion: "Complete CN III Palsy: Severe ptosis, 'Down-and-Out' eye position (unopposed SO4 & LR6). Pupil-sparing palsy = Microvascular ischemia (diabetes/hypertension - fibers inside spared). Pupil-involving dilated fixed pupil = Surgical emergency (PCOM aneurysm compression or uncal herniation compressing superficial parasympathetic fibers!)."
    },
    {
      id: "cn4", num: "IV", name: "Trochlear", type: "Motor (GSE)",
      origin: "Dorsal Midbrain below inferior colliculi (only cranial nerve exiting dorsally; decussates and winds ventrally around cerebral peduncle)",
      exit: "Superior orbital fissure",
      supplies: "Superior Oblique muscle (depresses eye in adduction, intorts eye in abduction).",
      test: "Have patient look down and inwards (toward the tip of the nose). Ask about vertical diplopia when walking downstairs or reading a book. Observe head posture.",
      lesion: "Vertical / torsional diplopia. Patient tilts head TOWARDS OPPOSITE shoulder to compensate for loss of intorsion (Bielschowsky head tilt test). Longest intracranial course of any cranial nerve makes it vulnerable to traumatic head injury."
    },
    {
      id: "cn5", num: "V", name: "Trigeminal", type: "Both (GSA Sensory + SVE Branchial Motor)",
      origin: "Anterolateral surface of mid-Pons (large sensory root + smaller medial motor root)",
      exit: "V1: Superior orbital fissure; V2: Foramen rotundum; V3: Foramen ovale",
      supplies: "Sensory (V1, V2, V3): Face skin, anterior scalp to vertex, cornea, conjunctiva, paranasal sinuses, oral mucosa, anterior 2/3 tongue general sensation, teeth, dura. Motor (V3): Muscles of mastication (masseter, temporalis, medial & lateral pterygoids), mylohyoid, anterior belly of digastric, tensor tympani, tensor veli palatini.",
      test: "Sensory: Light touch (cotton) and pinprick across V1 (forehead), V2 (cheek), V3 (jaw). Corneal Reflex: Touch limbus with sterile cotton wisp (V1 afferent, VII efferent bilateral blink). Motor: Palpate temporalis & masseter while clenching jaw; open mouth against resistance (pterygoids). Jaw Jerk reflex.",
      lesion: "Facial numbness; loss of corneal sensation (absent corneal reflex); jaw deviates TOWARDS THE SIDE OF LESION on opening (due to unopposed contralateral lateral pterygoid). Trigeminal neuralgia (tic douloureux: lancinating electric shock pain in V2/V3)."
    },
    {
      id: "cn6", num: "VI", name: "Abducens", type: "Motor (GSE)",
      origin: "Pontomedullary sulcus medially, just above the medullary pyramid",
      exit: "Superior orbital fissure (traversing Dorello's canal and cavernous sinus)",
      supplies: "Lateral Rectus muscle (pure abduction of the globe).",
      test: "Test horizontal lateral eye excursion. Watch for failure of lateral rectus to abduct globe past the midline. Ask about horizontal uncrossed diplopia on lateral gaze toward the affected side.",
      lesion: "Inability to abduct the eye past midline; horizontal diplopia worse on looking toward lesion side; convergent strabismus (esotropia) at rest. Long intracranial course over petrous apex makes it a classic 'False Localising Sign' in raised intracranial pressure!"
    },
    {
      id: "cn7", num: "VII", name: "Facial", type: "Both (SVE, GVE Parasympathetic, SVA Taste, GSA)",
      origin: "Cerebellopontine angle (CPA) at pontomedullary junction (lateral to CN VI, medial to CN VIII)",
      exit: "Internal acoustic meatus -> Facial canal -> Stylomastoid foramen",
      supplies: "Motor (SVE): All muscles of facial expression (frontalis, orbicularis oculi, orbicularis oris, buccinator), platysma, stapedius, stylohyoid, posterior belly of digastric. Parasympathetic (GVE): Lacrimal, submandibular, sublingual glands. Special sensory (SVA): Taste from anterior 2/3 of tongue via chorda tympani. Sensory (GSA): Concha of auricle.",
      test: "Inspect resting face for asymmetry, nasolabial flattening, or widened palpebral fissure. Instruct: 1. Raise eyebrows / wrinkle forehead; 2. Close eyes tight against resistance; 3. Puff out cheeks; 4. Show teeth / smile. Test taste on anterior tongue with sweet/salty solutions.",
      lesion: "Bell's Palsy (LMN): ENTIRE ipsilateral hemiface paralyzed (forehead wrinkles lost, inability to close eye with Bell's phenomenon, mouth droop, hyperacusis from stapedius paralysis). Stroke (UMN): Contralateral lower face weakness only; FOREHEAD SPARED due to bilateral cortical innervation of upper facial subnucleus!"
    },
    {
      id: "cn8", num: "VIII", name: "Vestibulocochlear", type: "Sensory (SSA)",
      origin: "Cerebellopontine angle (CPA) most laterally, adjacent to the flocculus of cerebellum",
      exit: "Internal acoustic meatus (with CN VII and labyrinthine artery)",
      supplies: "Cochlear division: Organ of Corti in cochlea (hearing). Vestibular division: Semicircular canals, utricle, saccule (angular/linear acceleration, balance, vestibulo-ocular reflex).",
      test: "Cochlear: Whispered voice test at 60 cm while occluding opposite ear. Rinne Tuning Fork Test (512 Hz on mastoid vs air: normal is Air > Bone). Weber Tuning Fork Test (midline vertex: normal is central, lateralizes to unaffected ear in sensorineural loss). Vestibular: Head impulse test, Hallpike maneuver, Romberg test.",
      lesion: "Sensorineural hearing loss, tinnitus, true spinning vertigo, horizontal-torsional nystagmus. Vestibular schwannoma (acoustic neuroma at cerebellopontine angle: progressive hearing loss + tinnitus + loss of corneal reflex from adjacent CN V compression)."
    },
    {
      id: "cn9", num: "IX", name: "Glossopharyngeal", type: "Both (SVE, GVE, GVA, SVA, GSA)",
      origin: "Post-olivary (retro-olivary) sulcus of Medulla Oblongata (rostral rootlets)",
      exit: "Jugular foramen (with CN X, XI, and internal jugular vein)",
      supplies: "Motor: Stylopharyngeus muscle (elevates pharynx during swallowing). Parasympathetic: Parotid gland via otic ganglion. Sensory: Posterior 1/3 of tongue (taste and general sensation), mucosa of pharynx, tonsillar bed, middle ear/Eustachian tube, carotid body chemoreceptors and carotid sinus baroreceptors.",
      test: "Gag Reflex: Touch posterior pharyngeal wall on each side with tongue depressor / cotton tip. Sensory afferent limb is CN IX; motor efferent contraction is CN X. Test taste on posterior 1/3 tongue with bitter substances.",
      lesion: "Loss of gag reflex sensory limb; mild dysphagia; loss of taste on posterior 1/3 of tongue; loss of carotid sinus reflex. Glossopharyngeal neuralgia: severe paroxysmal lancinating pain in throat, ear, and tonsillar fossa triggered by swallowing."
    },
    {
      id: "cn10", num: "X", name: "Vagus", type: "Both (SVE, GVE, GVA, SVA, GSA)",
      origin: "Post-olivary (retro-olivary) sulcus of Medulla Oblongata (intermediate rootlets)",
      exit: "Jugular foramen",
      supplies: "Motor (SVE): Pharyngeal constrictors, intrinsic laryngeal muscles (via recurrent laryngeal & superior laryngeal nerves), levator veli palatini, palatoglossus. Parasympathetic (GVE): Smooth muscle and glands of respiratory tract, heart (bradycardia), esophagus, stomach, and intestines to splenic flexure. Sensory: Dura, external acoustic meatus, larynx, viscera.",
      test: "1. Inspect uvula and palate at rest and during phonation ('say ahh'); 2. Check swallow of water (listen for choking or wet voice); 3. Evaluate voice quality (hoarseness, bovine cough without explosive start). Gag reflex efferent limb.",
      lesion: "Unilateral Vagus Lesion: Uvula DEVIATES TO THE NORMAL (contralateral) side on phonation; soft palate droops on lesion side. Recurrent Laryngeal Nerve Palsy: Hoarse voice, bovine cough (aortic arch aneurysm or Pancoast tumor on left; thyroid surgery on either side)."
    },
    {
      id: "cn11", num: "XI", name: "Spinal Accessory", type: "Motor (GSE / SVE)",
      origin: "Caudal rootlets in post-olivary sulcus of medulla + Spinal rootlets from C1-C5 anterior horn (ascends through foramen magnum, joins cranial roots, exits skull)",
      exit: "Jugular foramen",
      supplies: "Sternocleidomastoid (SCM) muscle and Trapezius muscle.",
      test: "Sternocleidomastoid: Have patient turn head forcefully to the OPPOSITE side against examiner's hand on their jaw (Left SCM turns head to the RIGHT!). Trapezius: Have patient shrug shoulders upwards against downward resistance; inspect for shoulder droop and scapular winging.",
      lesion: "Ipsilateral shoulder droop, weakness shrugging shoulder (trapezius), and weakness turning head to the OPPOSITE side (SCM). Common cause: Iatrogenic injury during posterior cervical lymph node biopsy or radical neck dissection."
    },
    {
      id: "cn12", num: "XII", name: "Hypoglossal", type: "Motor (GSE)",
      origin: "Pre-olivary sulcus of Medulla Oblongata (series of rootlets between pyramid and inferior olive)",
      exit: "Hypoglossal canal",
      supplies: "All intrinsic and extrinsic muscles of the tongue (genioglossus, hyoglossus, styloglossus), EXCEPT palatoglossus (innervated by CN X).",
      test: "1. Inspect tongue resting inside floor of mouth: check for atrophy, wasting, and fasciculations ('bag of worms'); 2. Ask patient to protrude tongue straight out; 3. Push tongue into each cheek against examiner's finger.",
      lesion: "Lower Motor Neuron (LMN): Tongue DEVIATES TOWARDS THE SIDE OF LESION on protrusion ('lick the wound' due to unopposed action of normal contralateral genioglossus) with ipsilateral tongue hemi-atrophy and fasciculations. Upper Motor Neuron (UMN): Tongue deviates AWAY from cortex lesion (contralateral) without atrophy."
    }
  ];

  function cranialMap(o) {
    var sel = (o && o.selected) || "cn7";
    var chosen = CRANIAL_NERVES[6];
    for (var i = 0; i < CRANIAL_NERVES.length; i++) if (CRANIAL_NERVES[i].id === sel) chosen = CRANIAL_NERVES[i];

    var html = '<div class="cx-dia-toggle" style="flex-wrap:wrap; margin-bottom:8px;">';
    for (var j = 0; j < CRANIAL_NERVES.length; j++) {
      var n = CRANIAL_NERVES[j];
      html += btn("cx-dia-zone", n.id, "CN " + n.num, sel === n.id);
    }
    html += '</div>';

    // SVG Brainstem Ventral View (viewBox 0 0 380 430)
    html += '<svg class="cx-dia cx-dia--cranial" viewBox="0 0 380 430" role="img" aria-label="Cranial Nerves I to XII Ventral Brainstem Anatomy Map">';

    // Background skull base / brain silhouette
    html += '<rect width="380" height="430" rx="10" fill="var(--cx-surface)" stroke="var(--cx-line)"/>';

    // Cerebral hemisphere base / inferior frontal contours
    html += '<path d="M70 70 C70 30 140 18 190 18 C240 18 310 30 310 70 C310 95 280 110 260 115 C240 118 215 110 190 110 C165 110 140 118 120 115 C100 110 70 95 70 70 Z" fill="var(--cx-surface-2)" stroke="var(--cx-line)" stroke-width="1.5"/>';

    // Cerebellar hemispheres lateral contours
    html += '<path d="M50 200 C30 220 30 290 60 320 C85 345 115 340 130 325 L130 215 C100 205 70 195 50 200 Z" fill="var(--cx-surface-2)" opacity="0.7" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<path d="M330 200 C350 220 350 290 320 320 C295 345 265 340 250 325 L250 215 C280 205 310 195 330 200 Z" fill="var(--cx-surface-2)" opacity="0.7" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<text x="75" y="270" font-size="9" fill="var(--cx-muted)" text-anchor="middle" transform="rotate(-90 75 270)">Cerebellum (L)</text>';
    html += '<text x="305" y="270" font-size="9" fill="var(--cx-muted)" text-anchor="middle" transform="rotate(90 305 270)">Cerebellum (R)</text>';

    // Midbrain: Cerebral Peduncles (Crura Cerebri) & Interpeduncular Fossa
    html += '<path d="M145 115 L140 165 C155 170 170 162 175 145 L175 120 Z" fill="var(--cx-primary-soft)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<path d="M235 115 L240 165 C225 170 210 162 205 145 L205 120 Z" fill="var(--cx-primary-soft)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    // Interpeduncular fossa
    html += '<polygon points="175,120 205,120 198,155 182,155" fill="var(--cx-surface-2)" stroke="var(--cx-line)" stroke-width="1"/>';
    html += '<circle cx="185" cy="130" r="3" fill="var(--cx-muted)"/>';
    html += '<circle cx="195" cy="130" r="3" fill="var(--cx-muted)"/>';

    // Pons: Bulbous Bridge with transverse striations
    html += '<path d="M125 168 C120 210 120 240 135 248 L245 248 C260 240 260 210 255 168 Z" fill="var(--cx-primary-soft)" stroke="var(--cx-primary)" stroke-width="1.8"/>';
    html += '<line x1="190" y1="168" x2="190" y2="248" stroke="var(--cx-line)" stroke-width="2"/>';
    html += '<path d="M135 185 Q190 190 245 185 M132 205 Q190 210 248 205 M135 225 Q190 230 245 225" stroke="var(--cx-line)" stroke-width="1" fill="none" opacity="0.4"/>';
    html += '<text x="190" y="210" text-anchor="middle" font-size="11" font-weight="700" fill="var(--cx-ink)" opacity="0.75">PONS</text>';

    // Medulla Oblongata: Pyramids, Pre-olivary sulci, Olives, Post-olivary sulci
    html += '<path d="M174 248 L170 330 C180 338 190 338 190 330 L190 248 Z" fill="var(--cx-surface-2)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<path d="M206 248 L210 330 C200 338 190 338 190 330 L190 248 Z" fill="var(--cx-surface-2)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<line x1="190" y1="248" x2="190" y2="330" stroke="var(--cx-ink)" stroke-width="1.5"/>';
    html += '<path d="M184 322 L196 332 M196 322 L184 332" stroke="var(--cx-teach)" stroke-width="1.5"/>';
    html += '<text x="190" y="342" text-anchor="middle" font-size="8.5" fill="var(--cx-teach)" font-weight="600">Pyramidal Decussation</text>';

    // Olives (Inferior Olivary Nucleus)
    html += '<ellipse cx="152" cy="285" rx="9" ry="18" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<ellipse cx="228" cy="285" rx="9" ry="18" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<text x="152" y="288" text-anchor="middle" font-size="7.5" fill="var(--cx-muted)">Olive</text>';
    html += '<text x="228" y="288" text-anchor="middle" font-size="7.5" fill="var(--cx-muted)">Olive</text>';

    // Spinal Cord (Cervical)
    html += '<rect x="165" y="345" width="50" height="65" fill="var(--cx-surface-2)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<line x1="190" y1="345" x2="190" y2="410" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<text x="190" y="380" text-anchor="middle" font-size="8" fill="var(--cx-muted)">Cervical Cord</text>';

    // Helper for interactive cranial nerve pairs
    function cnG(id, num, leftContent, rightContent, lblX, lblY) {
      var active = sel === id;
      var cls = "cx-dia-cn" + (active ? " cx-dia-cn--on" : "");
      var col = active ? "#f59e0b" : "var(--cx-primary)";
      return '<g class="' + cls + '" data-act="cx-dia-zone" data-id="' + id + '" role="button" tabindex="0" aria-label="CN ' + num + '">' +
        leftContent + rightContent +
        '<rect x="' + (lblX - 16) + '" y="' + (lblY - 9) + '" width="32" height="18" rx="4" fill="' + (active ? "#f59e0b" : "var(--cx-surface)") + '" stroke="' + col + '" stroke-width="1.5"/>' +
        '<text x="' + lblX + '" y="' + (lblY + 4) + '" text-anchor="middle" font-size="10" font-weight="800" fill="' + (active ? "#fff" : col) + '">' + num + '</text>' +
        '</g>';
    }

    // CN I: Olfactory Bulbs and Tracts
    var c1L = '<rect x="145" y="35" width="10" height="35" rx="5" fill="var(--cx-primary-soft)" stroke="var(--cx-primary)" stroke-width="2"/>';
    var c1R = '<rect x="225" y="35" width="10" height="35" rx="5" fill="var(--cx-primary-soft)" stroke="var(--cx-primary)" stroke-width="2"/>';
    html += cnG("cn1", "I", c1L, c1R, 190, 48);

    // CN II: Optic Nerves & Chiasm
    var c2L = '<path d="M140 75 L180 95 L190 95" stroke="var(--cx-primary)" stroke-width="3" fill="none"/>';
    var c2R = '<path d="M240 75 L200 95 L190 95" stroke="var(--cx-primary)" stroke-width="3" fill="none"/>';
    html += cnG("cn2", "II", c2L, c2R, 190, 95);

    // CN III: Oculomotor (Interpeduncular Fossa)
    var c3L = '<path d="M182 142 L168 152" stroke="var(--cx-primary)" stroke-width="3" stroke-linecap="round"/>';
    var c3R = '<path d="M198 142 L212 152" stroke="var(--cx-primary)" stroke-width="3" stroke-linecap="round"/>';
    html += cnG("cn3", "III", c3L, c3R, 190, 155);

    // CN IV: Trochlear (Winding around cerebral peduncles)
    var c4L = '<path d="M130 135 C130 152 145 160 155 162" stroke="var(--cx-primary)" stroke-width="2" fill="none" stroke-linecap="round"/>';
    var c4R = '<path d="M250 135 C250 152 235 160 225 162" stroke="var(--cx-primary)" stroke-width="2" fill="none" stroke-linecap="round"/>';
    html += cnG("cn4", "IV", c4L, c4R, 95, 145);

    // CN V: Trigeminal (Anterolateral Pons)
    var c5L = '<g><path d="M125 198 L95 192" stroke="var(--cx-primary)" stroke-width="4" stroke-linecap="round"/><circle cx="95" cy="192" r="5" fill="var(--cx-primary)"/><path d="M125 192 L102 186" stroke="var(--cx-teach)" stroke-width="2" stroke-linecap="round"/></g>';
    var c5R = '<g><path d="M255 198 L285 192" stroke="var(--cx-primary)" stroke-width="4" stroke-linecap="round"/><circle cx="285" cy="192" r="5" fill="var(--cx-primary)"/><path d="M255 192 L278 186" stroke="var(--cx-teach)" stroke-width="2" stroke-linecap="round"/></g>';
    html += cnG("cn5", "V", c5L, c5R, 65, 192);

    // CN VI: Abducens (Pontomedullary Sulcus above Pyramids)
    var c6L = '<path d="M178 248 L175 264" stroke="var(--cx-primary)" stroke-width="2.5" stroke-linecap="round"/>';
    var c6R = '<path d="M202 248 L205 264" stroke="var(--cx-primary)" stroke-width="2.5" stroke-linecap="round"/>';
    html += cnG("cn6", "VI", c6L, c6R, 190, 260);

    // CN VII: Facial (Cerebellopontine Angle medial to CN VIII)
    var c7L = '<path d="M136 248 L122 258" stroke="var(--cx-primary)" stroke-width="2.8" stroke-linecap="round"/>';
    var c7R = '<path d="M244 248 L258 258" stroke="var(--cx-primary)" stroke-width="2.8" stroke-linecap="round"/>';
    html += cnG("cn7", "VII", c7L, c7R, 100, 248);

    // CN VIII: Vestibulocochlear (Cerebellopontine Angle Lateral)
    var c8L = '<path d="M120 248 L102 258" stroke="var(--cx-primary)" stroke-width="3.2" stroke-linecap="round"/>';
    var c8R = '<path d="M260 248 L278 258" stroke="var(--cx-primary)" stroke-width="3.2" stroke-linecap="round"/>';
    html += cnG("cn8", "VIII", c8L, c8R, 70, 248);

    // CN IX: Glossopharyngeal (Post-olivary sulcus rostral)
    var c9L = '<path d="M142 272 L120 274" stroke="var(--cx-primary)" stroke-width="2.2" stroke-linecap="round"/>';
    var c9R = '<path d="M238 272 L260 274" stroke="var(--cx-primary)" stroke-width="2.2" stroke-linecap="round"/>';
    html += cnG("cn9", "IX", c9L, c9R, 100, 276);

    // CN X: Vagus (Post-olivary sulcus intermediate)
    var c10L = '<g><path d="M142 284 L120 287" stroke="var(--cx-primary)" stroke-width="2"/><path d="M142 292 L120 295" stroke="var(--cx-primary)" stroke-width="2"/></g>';
    var c10R = '<g><path d="M238 284 L260 287" stroke="var(--cx-primary)" stroke-width="2"/><path d="M238 292 L260 295" stroke="var(--cx-primary)" stroke-width="2"/></g>';
    html += cnG("cn10", "X", c10L, c10R, 100, 298);

    // CN XI: Spinal Accessory (Post-olivary caudal rootlets + C1-C5 spinal rootlets)
    var c11L = '<path d="M142 308 L115 315 L115 375 L165 375" stroke="var(--cx-primary)" stroke-width="2" fill="none"/>';
    var c11R = '<path d="M238 308 L265 315 L265 375 L215 375" stroke="var(--cx-primary)" stroke-width="2" fill="none"/>';
    html += cnG("cn11", "XI", c11L, c11R, 100, 325);

    // CN XII: Hypoglossal (Pre-olivary sulcus between Pyramid & Olive)
    var c12L = '<g><line x1="166" y1="274" x2="160" y2="274" stroke="var(--cx-primary)" stroke-width="2"/><line x1="166" y1="282" x2="160" y2="282" stroke="var(--cx-primary)" stroke-width="2"/><line x1="166" y1="290" x2="160" y2="290" stroke="var(--cx-primary)" stroke-width="2"/></g>';
    var c12R = '<g><line x1="214" y1="274" x2="220" y2="274" stroke="var(--cx-primary)" stroke-width="2"/><line x1="214" y1="282" x2="220" y2="282" stroke="var(--cx-primary)" stroke-width="2"/><line x1="214" y1="290" x2="220" y2="290" stroke="var(--cx-primary)" stroke-width="2"/></g>';
    html += cnG("cn12", "XII", c12L, c12R, 160, 305);

    html += '</svg>';

    // Selected Nerve Detailed Clinical Card
    html += '<div class="cx-dia-note" style="margin-top:10px;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">' +
        '<span style="font-size:16px; font-weight:800; color:var(--cx-ink);">CN ' + esc(chosen.num) + ': ' + esc(chosen.name) + ' Nerve</span>' +
        '<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; background:var(--cx-primary-soft); color:var(--cx-primary);">' + esc(chosen.type) + '</span>' +
      '</div>' +
      '<b>Brainstem Origin:</b> ' + esc(chosen.origin) + '<br>' +
      '<b>Skull Exit Foramen:</b> ' + esc(chosen.exit) + '<br><br>' +
      '<b>Structures Supplied:</b><br>' + esc(chosen.supplies) + '<br><br>' +
      '<b>Bedside Clinical Examination:</b><br>' + esc(chosen.test) + '<br><br>' +
      '<b style="color:var(--cx-bad);">What Happens When Damaged (Lesion Deficit):</b><br>' + esc(chosen.lesion) +
      '</div>';

    return html;
  }

  /* ── 20. Deep Tendon Reflex Arc ─────────────────────────────────────────── */

  function reflexArc(o) {
    var mode = (o && o.mode) || "normal"; // normal | umn | lmn
    var arcTitle = mode === "umn" ? "Upper Motor Neuron (Brisk Reflex 4+ / Hyperreflexia)"
      : mode === "lmn" ? "Lower Motor Neuron (Absent / Diminished Reflex 0-1+)"
      : "Normal Monosynaptic Stretch Reflex Arc (2+)";

    var html = '<svg class="cx-dia cx-dia--reflex" viewBox="0 0 340 210" role="img" aria-label="' + esc(arcTitle) + '">' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="14" y="20">' + esc(arcTitle) + '</text>' +
      // Muscle
      '<path d="M40 70 C55 45 75 45 90 70 L90 140 C75 165 55 165 40 140 Z" fill="rgba(239, 68, 68, 0.15)" stroke="#ef4444" stroke-width="1.8"/>' +
      '<text class="cx-dia-lbl" x="65" y="105" text-anchor="middle" font-size="11" fill="#ef4444">Muscle</text>' +
      // Spindle
      '<ellipse cx="65" cy="115" rx="10" ry="5" fill="#ef4444"/>' +
      // Spinal cord
      '<path d="M220 50 C200 70 200 130 220 150 C240 170 290 170 310 150 C330 130 330 70 310 50 C290 30 240 30 220 50 Z" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="2"/>' +
      // Butterfly grey matter
      '<path d="M245 80 Q255 100 245 120 Q265 100 285 120 Q275 100 285 80 Q265 100 245 80 Z" fill="var(--cx-line)"/>' +
      // Afferent Ia sensory neuron (blue)
      '<path d="M75 115 C130 115 160 70 240 85" fill="none" stroke="#2563eb" stroke-width="2.2"/>' +
      '<circle cx="160" cy="80" r="5" fill="#2563eb"/>' +
      '<text class="cx-dia-lbl" x="160" y="70" text-anchor="middle" font-size="10" fill="#2563eb">Dorsal Root Ganglion</text>' +
      // Efferent alpha motor neuron (red)
      '<path d="M245 115 C170 145 120 135 75 130" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-dasharray="' + (mode === "lmn" ? "3 3" : "none") + '"/>' +
      '<text class="cx-dia-lbl" x="140" y="160" text-anchor="middle" font-size="10" fill="#dc2626">Alpha Motor Axon</text>' +
      // Descending corticospinal tract (purple)
      '<path d="M260 20 L260 95" fill="none" stroke="#9333ea" stroke-width="' + (mode === "umn" ? "1" : "2.5") + '" stroke-dasharray="' + (mode === "umn" ? "2 2" : "none") + '"/>' +
      '<text class="cx-dia-lbl" x="260" y="16" text-anchor="middle" font-size="9.5" fill="#9333ea">' + (mode === "umn" ? "CUT (Loss of Brakes!)" : "Descending UMN Inhibitory Brakes") + '</text>' +
      // Hammer
      '<path d="M15 110 L30 110 L25 120 L10 120 Z" fill="var(--cx-muted)"/>' +
      '<text class="cx-dia-lbl" x="20" y="138" font-size="9">Tap</text>' +
      '</svg>' +
      '<div class="cx-dia-toggle">' +
        btn("cx-dia-mode", "normal", "Normal (2+)", mode === "normal") +
        btn("cx-dia-mode", "umn", "UMN Lesion (4+)", mode === "umn") +
        btn("cx-dia-mode", "lmn", "LMN Lesion (0)", mode === "lmn") +
      '</div>' +
      '<div class="cx-dia-note">' +
      (mode === "umn"
        ? "<b>Upper Motor Neuron Lesion</b>: The brain and descending corticospinal tract normally send constant <i>inhibitory dampening signals</i> ('brakes') to the spinal reflex arc. When an UMN lesion (stroke, MS, cord compression) cuts this pathway, the spinal loop fires unchecked $\\rightarrow$ <b>hyperreflexia, clonus, and spasticity</b>."
        : mode === "lmn"
          ? "<b>Lower Motor Neuron Lesion</b>: Destruction of the anterior horn cell, spinal root, or peripheral motor axon (e.g. polio, Guillain-Barré, peripheral neuropathy) breaks the physical electrical cable to the muscle $\\rightarrow$ <b>hyporeflexia or completely absent reflex (0)</b>, flaccidity, and rapid neurogenic atrophy."
          : "<b>Normal Reflex Arc</b>: A swift tap stretches muscle spindles $\\rightarrow$ fires Ia sensory fibers through dorsal root ganglion $\\rightarrow$ monosynaptic excitation in ventral horn $\\rightarrow$ alpha motor neuron fires back $\\rightarrow$ brisk muscle contraction. Balanced by descending corticospinal tone.") +
      '</div>';
    return html;
  }

  /* ── 21. Corticospinal Decussation (UMN vs LMN) ─────────────────────────── */

  function corticospinal(o) {
    var mode = (o && o.mode) || "compare"; // compare | pathway

    var html = '<svg class="cx-dia cx-dia--corticospinal" viewBox="0 0 340 180" role="img" aria-label="Corticospinal Tract Decussation">' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="14" y="20">Corticospinal Decussation (Motor Pathway)</text>' +
      // Motor cortex
      '<path d="M60 30 C90 10 130 10 160 30" fill="none" stroke="var(--cx-primary)" stroke-width="3"/>' +
      '<text class="cx-dia-lbl" x="110" y="24" text-anchor="middle" font-size="10" fill="var(--cx-primary)">Primary Motor Cortex (Precentral Gyrus)</text>' +
      // Corona radiata & internal capsule
      '<path d="M110 30 L110 70" fill="none" stroke="var(--cx-primary)" stroke-width="2.5"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="150" y="55" font-size="10">Internal Capsule (Post Limb)</text>' +
      // Brainstem / Medulla
      '<rect x="80" y="70" width="60" height="40" rx="4" fill="var(--cx-surface)" stroke="var(--cx-line)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="110" y="90" text-anchor="middle" font-size="9.5">Medullary Pyramids</text>' +
      // DECUSSATION X
      '<path d="M100 105 L180 145" fill="none" stroke="#ef4444" stroke-width="2.5"/>' +
      '<path d="M120 105 L40 145" fill="none" stroke="#2563eb" stroke-width="2.5"/>' +
      '<text class="cx-dia-lbl" x="170" y="118" font-size="11" font-weight="700" fill="#ef4444">Decussation (85% Cross!)</text>' +
      // Spinal cord
      '<line x1="180" y1="145" x2="180" y2="175" stroke="#ef4444" stroke-width="2.5"/>' +
      '<circle cx="180" cy="175" r="4" fill="#ef4444"/>' +
      '<text class="cx-dia-lbl" x="195" y="178" font-size="10" fill="#ef4444">Contralateral Anterior Horn</text>' +
      '</svg>' +
      '<div class="cx-dia-toggle">' +
        btn("cx-dia-mode", "compare", "Bedside Signs Comparison", mode === "compare") +
        btn("cx-dia-mode", "pathway", "Clinical Rule", mode === "pathway") +
      '</div>' +
      '<div class="cx-dia-note">' +
      (mode === "compare"
        ? '<div class="cx-tablewrap"><table class="cx-table" style="font-size:12px;">' +
          '<thead><tr><th>Feature</th><th>Upper Motor Neuron (UMN)</th><th>Lower Motor Neuron (LMN)</th></tr></thead>' +
          '<tbody>' +
          '<tr><td><b>Tone</b></td><td>Spastic (clasp-knife, velocity-dependent)</td><td>Flaccid (hypotonic, floppy)</td></tr>' +
          '<tr><td><b>Reflexes</b></td><td>Brisk (hyperreflexia, clonus)</td><td>Diminished or absent (0-1+)</td></tr>' +
          '<tr><td><b>Plantar (Babinski)</b></td><td>Extensor (dorsiflexion of big toe + fan)</td><td>Flexor (normal downgoing)</td></tr>' +
          '<tr><td><b>Wasting</b></td><td>Minimal (disuse only, late)</td><td>Severe, rapid neurogenic atrophy</td></tr>' +
          '<tr><td><b>Fasciculations</b></td><td>Absent</td><td>Present (visible muscle twitching)</td></tr>' +
          '</tbody></table></div>'
        : "<b>The Anatomical Rule of Hemiplegia</b>: Because the motor fibers decussate (cross over) in the lower medulla:<br>• A lesion <b>ABOVE the medulla</b> (cortex, internal capsule, brainstem) produces <b>CONTRALATERAL UMN weakness</b>.<br>• A lesion <b>IN the spinal cord</b> produces <b>IPSILATERAL UMN weakness</b> below the lesion level, and <b>LMN weakness AT the level</b> of the damaged root!") +
      '</div>';
    return html;
  }

  /* ── 22. Cerebellar Signs (VANISHED Mnemonic) ───────────────────────────── */

  /* ── 22. Cerebellar Signs (VANISHED Mnemonic) ───────────────────────────── */

  var CEREBELLAR_ITEMS = [
    { id: "v", letter: "V", title: "Vertigo & Vestibular Nystagmus", test: "Inspect resting eye alignment and vestibular balance; Hallpike maneuver.", pearl: "Cerebellar vertigo is characteristically accompanied by coarse horizontal gaze-evoked nystagmus (fast phase towards lesion side)." },
    { id: "a", letter: "A", title: "Ataxia (Gait & Truncal)", test: "Tandem walking (heel-to-toe), broad-based stance, and Romberg test.", pearl: "Truncal ataxia points to midline VERMIS lesion (drunken sailor gait, falling even with eyes open); limb ataxia points to ipsilateral HEMISPHERE." },
    { id: "n", letter: "N", title: "Nystagmus", test: "Six cardinal gaze positions; hold lateral gaze for 5 seconds.", pearl: "Direction-fixed, gaze-evoked horizontal nystagmus. The fast component beats in the direction of gaze, loudest looking TOWARDS the lesion side." },
    { id: "i", letter: "I", title: "Intention Tremor & Dysmetria", test: "Finger-to-nose test: touch doctor's finger, then own nose; Heel-to-shin test.", pearl: "Tremor amplitude INCREASES dramatically as the finger nears its target (terminal kinetic tremor), combined with past-pointing (dysmetria)." },
    { id: "s", letter: "S", title: "Slurred / Scanning Staccato Speech", test: "Ask patient to repeat: 'British Constitution' or 'Baby Hippopotamus'.", pearl: "Scanning / staccato dysarthria: words are broken into disjointed syllables with explosive, irregular emphasis." },
    { id: "h", letter: "H", title: "Hypotonia & Pendular Reflex", test: "Pendular knee jerk: tap patellar tendon with legs hanging freely off the bed edge.", pearl: "Due to loss of cerebellar gamma-efferent spindle tone, the knee jerk is 'pendular', oscillating back and forth like a pendulum (>4 swings) without damping." },
    { id: "e", letter: "E", title: "Extremity Saccadic Dysmetria", test: "Rapid saccadic eye movements between two distant targets & Heel-shin test.", pearl: "Ocular and extremity dysmetria: the limb or eye overshoots (hypermetria) or undershoots (hypometria) the visual target." },
    { id: "d", letter: "D", title: "Dysdiadochokinesia & Rebound", test: "Rapid alternating pronation and supination of hands & Holmes Rebound Test.", pearl: "Inability to perform rapid alternating movements smoothly; Holmes rebound: flexed forearm against resistance hits patient's chest when released due to delayed antagonist braking." }
  ];

  function cerebellumMap(o) {
    var sel = (o && o.selected) || "i";
    var chosen = CEREBELLAR_ITEMS[3];
    for (var i = 0; i < CEREBELLAR_ITEMS.length; i++) if (CEREBELLAR_ITEMS[i].id === sel) chosen = CEREBELLAR_ITEMS[i];

    var html = '<svg class="cx-dia cx-dia--cerebellum" viewBox="0 0 360 215" role="img" aria-label="Cerebellar functional anatomy and VANISHED test demonstration">';

    // Background
    html += '<rect width="360" height="215" rx="8" fill="var(--cx-surface)" stroke="var(--cx-line)"/>';

    // Anatomical Cerebellum Overview
    // Midline Vermis
    html += '<path d="M165 20 C160 55 160 100 165 125 C175 130 185 130 195 125 C200 100 200 55 195 20 Z" fill="rgba(14, 165, 233, 0.2)" stroke="#0ea5e9" stroke-width="2"/>';
    html += '<text class="cx-dia-lbl" x="180" y="70" text-anchor="middle" font-size="9" font-weight="700" fill="#0ea5e9">VERMIS (Trunk/Gait)</text>';

    // Left Cerebellar Hemisphere
    html += '<path d="M165 25 C120 15 60 45 50 82 C40 120 90 135 165 120 Z" fill="rgba(37, 99, 235, 0.1)" stroke="#2563eb" stroke-width="1.8"/>';
    html += '<text class="cx-dia-lbl" x="105" y="75" text-anchor="middle" font-size="8.5" fill="#2563eb">Left Hemisphere</text>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="105" y="88" text-anchor="middle" font-size="7.5">(Ipsilateral Limbs)</text>';

    // Right Cerebellar Hemisphere
    html += '<path d="M195 25 C240 15 300 45 310 82 C320 120 270 135 195 120 Z" fill="rgba(37, 99, 235, 0.1)" stroke="#2563eb" stroke-width="1.8"/>';
    html += '<text class="cx-dia-lbl" x="255" y="75" text-anchor="middle" font-size="8.5" fill="#2563eb">Right Hemisphere</text>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="255" y="88" text-anchor="middle" font-size="7.5">(Ipsilateral Limbs)</text>';

    // Dynamic Test Demonstration inside the SVG
    if (sel === "i") {
      // Intention Tremor Finger-Nose Test Demonstration
      html += '<rect x="25" y="138" width="310" height="65" rx="6" fill="var(--cx-surface-2)" stroke="#f59e0b" stroke-width="1.5"/>';
      html += '<circle cx="55" cy="168" r="10" fill="#2563eb" opacity="0.3"/>';
      html += '<text x="55" y="172" text-anchor="middle" font-size="9" font-weight="700" fill="#2563eb">Nose</text>';
      // Oscillating kinetic tremor trajectory that widens at endpoint
      html += '<path class="cx-dia-tremor-line" d="M68 168 Q110 166 150 168 Q190 162 220 174 Q240 156 265 178 Q285 158 295 168" stroke="#f59e0b" stroke-width="2.5" fill="none"/>';
      html += '<circle cx="295" cy="168" r="10" fill="#ef4444" opacity="0.3"/>';
      html += '<text x="295" y="172" text-anchor="middle" font-size="9" font-weight="700" fill="#ef4444">Target</text>';
      html += '<text x="180" y="195" text-anchor="middle" font-size="8.5" fill="#d97706" font-weight="600">Terminal Kinetic Tremor: Amplitude widens as target is neared + Past-Pointing</text>';
    } else if (sel === "d") {
      // Dysdiadochokinesia
      html += '<rect x="25" y="138" width="310" height="65" rx="6" fill="var(--cx-surface-2)" stroke="#8b5cf6" stroke-width="1.5"/>';
      html += '<text x="180" y="162" text-anchor="middle" font-size="10.5" font-weight="700" fill="#8b5cf6">Rapid Alternating Movements (Pronation / Supination)</text>';
      html += '<text x="180" y="180" text-anchor="middle" font-size="9" fill="var(--cx-ink)">Arrhythmic, slow, clumsy slapping of dorsal/palmar hand surfaces</text>';
      html += '<text x="180" y="194" text-anchor="middle" font-size="8" fill="var(--cx-muted)">Holmes Rebound Test: failure of antagonist braking causes hand to hit chest</text>';
    } else if (sel === "h") {
      // Pendular Knee Jerk
      html += '<rect x="25" y="138" width="310" height="65" rx="6" fill="var(--cx-surface-2)" stroke="#10b981" stroke-width="1.5"/>';
      html += '<text x="180" y="162" text-anchor="middle" font-size="10.5" font-weight="700" fill="#10b981">Pendular Knee Jerk (>4 Uninhibited Swings)</text>';
      html += '<text x="180" y="180" text-anchor="middle" font-size="9" fill="var(--cx-ink)">Loss of cerebellar spindle damping: lower leg oscillates like a clock pendulum</text>';
    } else if (sel === "n" || sel === "v") {
      // Nystagmus
      html += '<rect x="25" y="138" width="310" height="65" rx="6" fill="var(--cx-surface-2)" stroke="#ec4899" stroke-width="1.5"/>';
      html += '<text x="180" y="162" text-anchor="middle" font-size="10.5" font-weight="700" fill="#ec4899">Gaze-Evoked Horizontal Nystagmus</text>';
      html += '<text x="180" y="180" text-anchor="middle" font-size="9" fill="var(--cx-ink)">Slow drift back towards midline, interrupted by rapid corrective saccade to lesion</text>';
    } else {
      // General Ataxia
      html += '<rect x="25" y="138" width="310" height="65" rx="6" fill="var(--cx-surface-2)" stroke="#0ea5e9" stroke-width="1.5"/>';
      html += '<text x="180" y="162" text-anchor="middle" font-size="10.5" font-weight="700" fill="#0ea5e9">Tandem Heel-to-Toe Walking Test</text>';
      html += '<text x="180" y="180" text-anchor="middle" font-size="9" fill="var(--cx-ink)">Wide-based unsteady gait; veering/falling towards the side of the lesion</text>';
    }

    html += '</svg>';

    // Segmented toggle pills for VANISHED
    html += '<div class="cx-dia-toggle" style="flex-wrap:wrap; margin:8px 0;">';
    for (var j = 0; j < CEREBELLAR_ITEMS.length; j++) {
      var item = CEREBELLAR_ITEMS[j];
      html += btn("cx-dia-zone", item.id, item.letter + ": " + item.title.split(" ")[0], sel === item.id);
    }
    html += '</div>';

    html += '<div class="cx-dia-note">' +
      '<div style="font-size:14px; font-weight:800; color:var(--cx-primary); margin-bottom:4px;">' + esc(chosen.letter) + ' — ' + esc(chosen.title) + '</div>' +
      '<b>Bedside Examination Test:</b> ' + esc(chosen.test) + '<br><br>' +
      '<b>Pathophysiology & Clinical Pearl:</b> ' + esc(chosen.pearl) + '<br><br>' +
      '<i style="color:var(--cx-teach); font-weight:600;">The Golden Rule of Cerebellar Signs: Unlike cerebral lesions which are contralateral, cerebellar hemisphere lesions are ALWAYS <b>IPSILATERAL</b> (signs appear on the same side as the lesion due to double decussation)!</i>' +
      '</div>';

    return html;
  }

  /* ── 23. Wiggers Cardiac Cycle & Auscultation Timing ─────────────────────── */

  function wiggers(o) {
    var mode = (o && o.mode) || "normal"; // normal | s3 | s4
    var title = mode === "s3" ? "Wiggers Diagram: S3 Ventricular Gallop in Early Diastole"
      : mode === "s4" ? "Wiggers Diagram: S4 Atrial Gallop in Late Diastole (Presystole)"
      : "Wiggers Cardiac Cycle: Pressures, Valves & Heart Sounds";

    var html = '<svg class="cx-dia cx-dia--wiggers" viewBox="0 0 340 220" role="img" aria-label="' + esc(title) + '">' +
      '<line class="cx-dia-axis" x1="20" y1="160" x2="320" y2="160"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="14" y="20">' + esc(title) + '</text>' +
      // Systole vs Diastole shading
      '<rect x="70" y="30" width="100" height="130" fill="rgba(239, 68, 68, 0.05)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--faint" x="120" y="42" text-anchor="middle">SYSTOLE</text>' +
      '<rect x="170" y="30" width="130" height="130" fill="rgba(37, 99, 235, 0.05)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--faint" x="235" y="42" text-anchor="middle">DIASTOLE</text>' +
      // Left Ventricle Pressure (red)
      '<path d="M30 155 L70 155 C72 70 85 45 120 45 C155 45 168 70 170 155 L300 155" fill="none" stroke="#dc2626" stroke-width="2.5"/>' +
      '<text class="cx-dia-lbl" x="120" y="60" text-anchor="middle" font-size="10" fill="#dc2626">LV Pressure (120 mmHg)</text>' +
      // Aortic Pressure (amber)
      '<path d="M30 90 L70 90 L85 75 C110 50 140 50 170 80 L174 74 L180 82 C210 86 260 88 300 90" fill="none" stroke="#d97706" stroke-width="2"/>' +
      '<text class="cx-dia-lbl" x="240" y="80" font-size="9" fill="#d97706">Aortic Pressure</text>' +
      // S1 line
      '<line x1="70" y1="30" x2="70" y2="200" stroke="var(--cx-primary)" stroke-width="2" stroke-dasharray="2 2"/>' +
      '<circle cx="70" cy="180" r="10" fill="var(--cx-primary)"/>' +
      '<text class="cx-dia-lbl" x="70" y="184" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">S1</text>' +
      '<text class="cx-dia-lbl" x="70" y="202" text-anchor="middle" font-size="8.5">Mitral Closes</text>' +
      // S2 line
      '<line x1="170" y1="30" x2="170" y2="200" stroke="var(--cx-teach)" stroke-width="2" stroke-dasharray="2 2"/>' +
      '<circle cx="170" cy="180" r="10" fill="var(--cx-teach)"/>' +
      '<text class="cx-dia-lbl" x="170" y="184" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">S2</text>' +
      '<text class="cx-dia-lbl" x="170" y="202" text-anchor="middle" font-size="8.5">Aortic Closes</text>';

    if (mode === "s3") {
      html += '<line x1="210" y1="30" x2="210" y2="200" stroke="#059669" stroke-width="2"/>' +
        '<circle cx="210" cy="180" r="10" fill="#059669"/>' +
        '<text class="cx-dia-lbl" x="210" y="184" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">S3</text>' +
        '<text class="cx-dia-lbl" x="210" y="202" text-anchor="middle" font-size="8.5">Rapid Filling (Ken-tuc-ky)</text>';
    } else if (mode === "s4") {
      html += '<line x1="50" y1="30" x2="50" y2="200" stroke="#7c3aed" stroke-width="2"/>' +
        '<circle cx="50" cy="180" r="10" fill="#7c3aed"/>' +
        '<text class="cx-dia-lbl" x="50" y="184" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">S4</text>' +
        '<text class="cx-dia-lbl" x="50" y="202" text-anchor="middle" font-size="8.5">Atrial Kick (Ten-nes-see)</text>';
    }

    html += '</svg>' +
      '<div class="cx-dia-toggle">' +
        btn("cx-dia-mode", "normal", "Normal S1/S2", mode === "normal") +
        btn("cx-dia-mode", "s3", "S3 Ventricular Gallop", mode === "s3") +
        btn("cx-dia-mode", "s4", "S4 Atrial Gallop", mode === "s4") +
      '</div>' +
      '<div class="cx-dia-note">' +
      (mode === "s3"
        ? "<b>S3 Ventricular Gallop ('Ken-tuc-ky')</b>: Occurs in early diastole during the rapid ventricular filling phase (~120-170 ms after S2). Caused by large volume of blood crashing into a dilated, non-compliant ventricle. Hallmarked in <b>heart failure with reduced ejection fraction (HFrEF)</b> and severe mitral regurgitation."
        : mode === "s4"
          ? "<b>S4 Atrial Gallop ('Ten-nes-see')</b>: Occurs in late diastole immediately before S1. Caused by active atrial contraction pushing blood against a stiff, hypertrophied, non-compliant ventricular wall. Classically heard in <b>chronic hypertension, aortic stenosis, and hypertrophic cardiomyopathy</b>. NEVER heard in AFib!"
          : "<b>The Mechanical Rule of Heart Sounds</b>: Heart sounds are not murmurs; they are the crisp closure of valves like slamming doors! S1 = Mitral & Tricuspid closing (start of systole). S2 = Aortic & Pulmonary closing (end of systole / start of diastole).") +
      '</div>';
    return html;
  }

  /* ── 24. Cardiac Murmur Timing Strip ────────────────────────────────────── */

  function murmurTiming(o) {
    var mode = (o && o.mode) || "as"; // as | mr | ar | ms

    var desc = mode === "as" ? "Aortic Stenosis: Ejection Systolic (Crescendo-Decrescendo Diamond)"
      : mode === "mr" ? "Mitral Regurgitation: Pansystolic / Holosystolic (Plateau Band)"
      : mode === "ar" ? "Aortic Regurgitation: Early Diastolic (High-Pitched Decrescendo Blow)"
      : "Mitral Stenosis: Mid-Diastolic Rumbling Murmur with Opening Snap";

    var html = '<svg class="cx-dia cx-dia--murmurtiming" viewBox="0 0 340 180" role="img" aria-label="' + esc(desc) + '">' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="14" y="20">' + esc(desc) + '</text>' +
      // Baseline timeline
      '<line class="cx-dia-axis" x1="20" y1="110" x2="320" y2="110"/>' +
      // S1
      '<rect x="50" y="60" width="16" height="100" fill="var(--cx-primary)" rx="4"/>' +
      '<text class="cx-dia-lbl" x="58" y="115" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">S1</text>' +
      '<text class="cx-dia-lbl" x="58" y="52" text-anchor="middle" font-size="9.5">Systole Starts</text>' +
      // S2
      '<rect x="180" y="60" width="16" height="100" fill="var(--cx-teach)" rx="4"/>' +
      '<text class="cx-dia-lbl" x="188" y="115" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">S2</text>' +
      '<text class="cx-dia-lbl" x="188" y="52" text-anchor="middle" font-size="9.5">Diastole Starts</text>' +
      // Next S1
      '<rect x="300" y="60" width="16" height="100" fill="var(--cx-primary)" rx="4"/>' +
      '<text class="cx-dia-lbl" x="308" y="115" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">S1</text>';

    if (mode === "as") {
      // Diamond shape between S1 and S2
      html += '<path d="M72 110 L125 72 L174 110 L125 148 Z" fill="rgba(217, 119, 6, 0.25)" stroke="#d97706" stroke-width="2"/>' +
        '<text class="cx-dia-lbl" x="125" y="115" text-anchor="middle" font-size="10" font-weight="700" fill="#d97706">Ejection Systolic</text>';
    } else if (mode === "mr") {
      // Continuous plateau rectangle from S1 through S2
      html += '<rect x="66" y="80" width="114" height="60" fill="rgba(220, 38, 38, 0.22)" stroke="#dc2626" stroke-width="2"/>' +
        '<text class="cx-dia-lbl" x="123" y="115" text-anchor="middle" font-size="10" font-weight="700" fill="#dc2626">Pansystolic (Holosystolic)</text>';
    } else if (mode === "ar") {
      // Early diastolic decrescendo wedge
      html += '<path d="M196 75 L300 110 L196 145 Z" fill="rgba(37, 99, 235, 0.22)" stroke="#2563eb" stroke-width="2"/>' +
        '<text class="cx-dia-lbl" x="235" y="115" text-anchor="middle" font-size="9.5" font-weight="700" fill="#2563eb">Early Diastolic Decrescendo</text>';
    } else if (mode === "ms") {
      // Opening snap line + mid-diastolic rumble
      html += '<line x1="208" y1="70" x2="208" y2="150" stroke="#7c3aed" stroke-width="2.5"/>' +
        '<text class="cx-dia-lbl" x="208" y="65" text-anchor="middle" font-size="9" font-weight="700" fill="#7c3aed">OS</text>' +
        '<path d="M214 110 Q240 92 260 110 Q280 128 298 102 L298 118 Z" fill="rgba(124, 58, 237, 0.25)" stroke="#7c3aed" stroke-width="2"/>' +
        '<text class="cx-dia-lbl" x="255" y="115" text-anchor="middle" font-size="9.5" font-weight="700" fill="#7c3aed">Diastolic Rumble</text>';
    }

    html += '</svg>' +
      '<div class="cx-dia-toggle">' +
        btn("cx-dia-mode", "as", "Aortic Stenosis (Systolic)", mode === "as") +
        btn("cx-dia-mode", "mr", "Mitral Regurg (Systolic)", mode === "mr") +
        btn("cx-dia-mode", "ar", "Aortic Regurg (Diastolic)", mode === "ar") +
        btn("cx-dia-mode", "ms", "Mitral Stenosis (Diastolic)", mode === "ms") +
      '</div>' +
      '<div class="cx-dia-note">' +
      (mode === "as"
        ? "<b>Aortic Stenosis (AS)</b>: Harsh, diamond-shaped crescendo-decrescendo ejection systolic murmur. Starts shortly after S1 (after isovolumetric contraction opens aortic valve), peaks mid-systole, and fades before S2. Radiates directly to the right carotid artery."
        : mode === "mr"
          ? "<b>Mitral Regurgitation (MR)</b>: High-pitched blowing holosystolic/pansystolic murmur. Runs continuously from S1 to S2 with no gap, because the left ventricle pressure immediately exceeds left atrial pressure. Loudest at apex, radiates to left axilla."
          : mode === "ar"
            ? "<b>Aortic Regurgitation (AR)</b>: High-pitched, early diastolic blowing decrescendo murmur. Starts immediately at S2 when aortic pressure is highest, fading throughout diastole. Heard best sitting forward in full expiration at Erb's point (3rd left ICS)."
            : "<b>Mitral Stenosis (MS)</b>: Mid-diastolic low-pitched rumbling murmur preceded by a sharp Opening Snap (OS). Features presystolic accentuation if in sinus rhythm (disappears in AFib!). Best heard at the apex with the bell in the left lateral position.") +
      '</div>';
    return html;
  }

  /* ── diagram: spirometry curves ─────────────────────────────────────────── */
  function spirometryCurves(opts) {
    opts = opts || {};
    var mode = opts.mode || "normal";
    var html = '<svg viewBox="0 0 340 210" class="cx-dia-svg" role="img" aria-label="Spirometry loops and curves">' +
      '<defs><pattern id="spiro-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" stroke-opacity="0.06"/></pattern></defs>' +
      '<rect width="340" height="210" fill="url(#spiro-grid)"/>' +
      '<line x1="30" y1="20" x2="30" y2="175" class="cx-dia-axis"/>' +
      '<line x1="30" y1="125" x2="160" y2="125" class="cx-dia-axis"/>' +
      '<text class="cx-dia-lbl" x="35" y="28" font-size="8.5">Flow (L/s)</text>' +
      '<text class="cx-dia-lbl" x="135" y="120" font-size="8">Vol (L)</text>' +
      '<text class="cx-dia-lbl" x="95" y="195" text-anchor="middle" font-size="9" font-weight="700">Flow-Volume Loop</text>' +
      '<line x1="190" y1="20" x2="190" y2="175" class="cx-dia-axis"/>' +
      '<line x1="190" y1="175" x2="325" y2="175" class="cx-dia-axis"/>' +
      '<text class="cx-dia-lbl" x="195" y="28" font-size="8.5">Vol (L)</text>' +
      '<text class="cx-dia-lbl" x="305" y="170" font-size="8">Time (s)</text>' +
      '<text class="cx-dia-lbl" x="255" y="195" text-anchor="middle" font-size="9" font-weight="700">Volume-Time Curve</text>';

    if (mode === "normal") {
      html += '<path d="M40 125 L65 35 L145 125 C125 155 60 155 40 125 Z" fill="rgba(16,185,129,0.18)" stroke="#10b981" stroke-width="2.2"/>' +
        '<text class="cx-dia-lbl" x="65" y="30" font-size="8" fill="#10b981" text-anchor="middle">PEF ~8L/s</text>' +
        '<path d="M190 175 Q215 70 250 50 L320 48" fill="none" stroke="#10b981" stroke-width="2.2"/>' +
        '<line x1="225" y1="175" x2="225" y2="75" stroke="#10b981" stroke-dasharray="2,2"/>' +
        '<circle cx="225" cy="75" r="3" fill="#10b981"/>' +
        '<text class="cx-dia-lbl" x="232" y="80" font-size="8" fill="#10b981">FEV1 3.2L</text>' +
        '<text class="cx-dia-lbl" x="315" y="42" font-size="8" fill="#10b981" text-anchor="end">FVC 4.0L</text>';
    } else if (mode === "obstructive") {
      html += '<path d="M40 125 L60 65 Q85 118 145 125 C125 155 60 155 40 125 Z" fill="rgba(239,68,68,0.2)" stroke="#ef4444" stroke-width="2.2"/>' +
        '<text class="cx-dia-lbl" x="90" y="105" font-size="8.5" font-weight="700" fill="#ef4444">Scooping (Obstruction)</text>' +
        '<path d="M190 175 Q240 140 320 85" fill="none" stroke="#ef4444" stroke-width="2.2"/>' +
        '<line x1="225" y1="175" x2="225" y2="150" stroke="#ef4444" stroke-dasharray="2,2"/>' +
        '<circle cx="225" cy="150" r="3" fill="#ef4444"/>' +
        '<text class="cx-dia-lbl" x="232" y="148" font-size="8" fill="#ef4444">FEV1 1.5L</text>' +
        '<text class="cx-dia-lbl" x="315" y="78" font-size="8" fill="#ef4444" text-anchor="end">Slow Rise (Ratio 43%)</text>';
    } else if (mode === "restrictive") {
      html += '<path d="M40 125 L55 50 L95 125 C85 145 50 145 40 125 Z" fill="rgba(59,130,246,0.2)" stroke="#3b82f6" stroke-width="2.2"/>' +
        '<text class="cx-dia-lbl" x="70" y="44" font-size="8" fill="#3b82f6" text-anchor="middle">Miniature Witch\'s Hat</text>' +
        '<path d="M190 175 Q210 100 235 90 L320 90" fill="none" stroke="#3b82f6" stroke-width="2.2"/>' +
        '<line x1="225" y1="175" x2="225" y2="95" stroke="#3b82f6" stroke-dasharray="2,2"/>' +
        '<circle cx="225" cy="95" r="3" fill="#3b82f6"/>' +
        '<text class="cx-dia-lbl" x="232" y="105" font-size="8" fill="#3b82f6">FEV1 2.1L / FVC 2.4L</text>' +
        '<text class="cx-dia-lbl" x="315" y="82" font-size="8" fill="#3b82f6" text-anchor="end">Ratio 88% (Normal/High)</text>';
    }

    html += '</svg>' +
      '<div class="cx-dia-toggle">' +
        btn("cx-dia-mode", "normal", "Normal", mode === "normal") +
        btn("cx-dia-mode", "obstructive", "Obstructive (Asthma/COPD)", mode === "obstructive") +
        btn("cx-dia-mode", "restrictive", "Restrictive (Fibrosis)", mode === "restrictive") +
      '</div>' +
      '<div class="cx-dia-note">' +
      (mode === "normal"
        ? "<b>Normal Pattern</b>: FEV1/FVC ≥ 0.70 (70–80%). Rapid emptying of >75% lung volume in the very first second, with linear expiratory descent."
        : mode === "obstructive"
          ? "<b>Obstructive Defect (COPD / Asthma)</b>: FEV1/FVC < 0.70. Airway collapse on forced expiration creates the hallmark <i>concave scooping</i>. Volume-time curve shows prolonged slow exhalation."
          : "<b>Restrictive Defect (Pulmonary Fibrosis, Kyphoscoliosis)</b>: FEV1/FVC normal or increased (≥ 0.70), but both FEV1 and FVC are proportionally reduced (<80% predicted). Produces a shrunken 'miniature' loop.") +
      '</div>';
    return html;
  }

  /* ── diagram: pleural signs matrix ──────────────────────────────────────── */
  function pleuralSigns(opts) {
    opts = opts || {};
    var mode = opts.mode || "consolidation";
    var html = '<svg viewBox="0 0 340 200" class="cx-dia-svg" role="img" aria-label="Pleural and pulmonary physical signs">' +
      '<path d="M120 20 C120 15 220 15 220 20 L240 60 C280 90 280 160 250 180 C210 195 130 195 90 180 C60 160 60 90 100 60 Z" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2"/>' +
      (mode === "effusion"
        ? '<line x1="170" y1="20" x2="152" y2="70" stroke="#ef4444" stroke-width="3.5" stroke-linecap="round"/><text class="cx-dia-lbl" x="140" y="35" font-size="8" fill="#ef4444">Pushed away</text>'
        : mode === "pneumothorax"
          ? '<line x1="170" y1="20" x2="148" y2="70" stroke="#ef4444" stroke-width="3.5" stroke-linecap="round"/><text class="cx-dia-lbl" x="135" y="35" font-size="8" fill="#ef4444">Pushed (Tension)</text>'
          : '<line x1="170" y1="20" x2="170" y2="70" stroke="#10b981" stroke-width="3.5" stroke-linecap="round"/><text class="cx-dia-lbl" x="175" y="35" font-size="8" fill="#10b981">Central</text>') +
      '<path d="M110 65 C85 85 85 140 105 165 C130 170 160 160 160 140 L160 65 Z" fill="rgba(16,185,129,0.12)" stroke="#10b981" stroke-width="1"/>' +
      '<text class="cx-dia-lbl" x="130" y="115" text-anchor="middle" font-size="8.5" fill="#10b981">Normal Lung</text>';

    if (mode === "consolidation") {
      html += '<path d="M230 65 C255 85 255 140 235 165 C210 170 180 160 180 140 L180 65 Z" fill="rgba(245,158,11,0.3)" stroke="#f59e0b" stroke-width="2"/>' +
        '<circle cx="218" cy="130" r="22" fill="#f59e0b" fill-opacity="0.45"/>' +
        '<text class="cx-dia-lbl" x="218" y="126" text-anchor="middle" font-size="9" font-weight="700" fill="#d97706">Consolidation</text>' +
        '<text class="cx-dia-lbl" x="218" y="139" text-anchor="middle" font-size="7.5" fill="#b45309">Dull / Bronchial BS / ↑TVF</text>';
    } else if (mode === "effusion") {
      html += '<path d="M230 65 C255 85 255 140 235 165 C210 170 180 160 180 140 L180 65 Z" fill="rgba(59,130,246,0.1)" stroke="#3b82f6" stroke-width="1.5"/>' +
        '<path d="M180 120 Q215 130 250 110 L242 160 C220 170 185 165 180 140 Z" fill="rgba(37,99,235,0.4)" stroke="#2563eb" stroke-width="2"/>' +
        '<text class="cx-dia-lbl" x="215" y="145" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">Pleural Fluid</text>' +
        '<text class="cx-dia-lbl" x="215" y="157" text-anchor="middle" font-size="7.5" fill="#1e40af">Stony Dull / Absent BS / ↓TVF</text>';
    } else if (mode === "pneumothorax") {
      html += '<path d="M230 65 C255 85 255 140 235 165 C210 170 180 160 180 140 L180 65 Z" fill="rgba(239,68,68,0.12)" stroke="#ef4444" stroke-width="2" stroke-dasharray="3,3"/>' +
        '<circle cx="192" cy="100" r="14" fill="rgba(107,114,128,0.6)" stroke="#4b5563" stroke-width="1.5"/>' +
        '<text class="cx-dia-lbl" x="192" y="103" text-anchor="middle" font-size="7" fill="#fff">Collapsed</text>' +
        '<text class="cx-dia-lbl" x="228" y="135" text-anchor="middle" font-size="9" font-weight="700" fill="#dc2626">Pleural Air</text>' +
        '<text class="cx-dia-lbl" x="228" y="148" text-anchor="middle" font-size="7.5" fill="#b91c1c">Hyperresonant / Silent BS</text>';
    }

    html += '</svg>' +
      '<div class="cx-dia-toggle">' +
        btn("cx-dia-mode", "consolidation", "Consolidation", mode === "consolidation") +
        btn("cx-dia-mode", "effusion", "Pleural Effusion", mode === "effusion") +
        btn("cx-dia-mode", "pneumothorax", "Pneumothorax", mode === "pneumothorax") +
      '</div>' +
      '<div class="cx-dia-note">' +
      (mode === "consolidation"
        ? "<b>Lobar Consolidation (Pneumonia)</b>: Alveoli filled with solid exudate with patent bronchus. Sound travels <i>faster and clearer</i> through solid: Percussion is <b>dull</b>, breath sounds are <b>bronchial</b> (tubular with high pitch), Vocal Fremitus/Resonance is <b>increased</b>, with whispered pectoriloquy and aegophony (E-to-A change)."
        : mode === "effusion"
          ? "<b>Pleural Effusion</b>: Fluid occupies the pleural space between chest wall and lung, acting as an acoustic barrier. Percussion is hallmark <b>stony dull</b> (like tapping a brick wall), breath sounds are <b>greatly reduced or absent</b>, and vocal resonance is <b>diminished</b>. Large effusions push trachea away."
          : "<b>Pneumothorax</b>: Air in the pleural space breaks lung contact. Percussion is <b>hyperresonant</b> (like an inflated drum), breath sounds are <b>silent/absent</b>, and vocal resonance is <b>diminished</b>. In a tension pneumothorax, mediastinum and trachea are actively pushed away with hemodynamic collapse.") +
      '</div>';
    return html;
  }

  /* ── diagram: Murphy sign ────────────────────────────────────────────────── */
  function murphySign(opts) {
    opts = opts || {};
    var mode = opts.mode || "rest";
    var html = '<svg viewBox="0 0 340 200" class="cx-dia-svg" role="img" aria-label="Murphy sign inspiratory catch mechanics">' +
      '<path d="M50 40 Q170 30 290 40 L290 170 Q170 180 50 170 Z" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2"/>' +
      '<path d="M70 45 Q120 70 170 85" fill="none" stroke="#6b7280" stroke-width="3"/>' +
      '<text class="cx-dia-lbl" x="110" y="62" font-size="8" fill="#6b7280">Right Costal Margin</text>' +
      '<line x1="130" y1="35" x2="130" y2="175" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="3,3"/>' +
      '<text class="cx-dia-lbl" x="130" y="32" font-size="7.5" fill="#9ca3af" text-anchor="middle">Midclavicular line</text>' +
      '<path d="M75 55 Q130 85 170 95 L170 60 Z" fill="rgba(180,83,9,0.2)" stroke="#b45309" stroke-width="1.5"/>';

    if (mode === "rest") {
      html += '<ellipse cx="130" cy="82" rx="14" ry="18" fill="rgba(239,68,68,0.3)" stroke="#ef4444" stroke-width="2"/>' +
        '<text class="cx-dia-lbl" x="155" y="86" font-size="8" fill="#ef4444">Inflamed Gallbladder</text>' +
        '<path d="M122 130 L122 105 Q125 100 130 100 Q135 100 138 105 L138 130 Z" fill="rgba(59,130,246,0.3)" stroke="#2563eb" stroke-width="2"/>' +
        '<text class="cx-dia-lbl" x="130" y="145" text-anchor="middle" font-size="8" fill="#2563eb">Examiner fingers gentle pressure</text>' +
        '<text class="cx-dia-lbl" x="240" y="90" font-size="8.5" fill="#10b981">Diaphragm relaxed</text>' +
        '<text class="cx-dia-lbl" x="240" y="105" font-size="8.5" fill="#10b981">Patient breathing quietly</text>';
    } else {
      html += '<path d="M70 30 Q170 50 270 30" fill="none" stroke="#10b981" stroke-width="2"/>' +
        '<text class="cx-dia-lbl" x="240" y="60" font-size="8" fill="#10b981">Diaphragm descends 4-5cm ↓</text>' +
        '<ellipse cx="130" cy="106" rx="14" ry="18" fill="rgba(239,68,68,0.6)" stroke="#b91c1c" stroke-width="2.5"/>' +
        '<path d="M122 140 L122 110 Q125 105 130 105 Q135 105 138 110 L138 140 Z" fill="rgba(59,130,246,0.5)" stroke="#1d4ed8" stroke-width="2"/>' +
        '<path d="M130 105 L118 95 M130 105 L142 95 M130 105 L130 88 M130 105 L145 108 M130 105 L115 108" stroke="#ef4444" stroke-width="2.5"/>' +
        '<text class="cx-dia-lbl" x="240" y="105" font-size="9" font-weight="700" fill="#dc2626">INSPIRATORY CATCH!</text>' +
        '<text class="cx-dia-lbl" x="240" y="120" font-size="8" fill="#dc2626">Sudden arrest in breathing</text>' +
        '<text class="cx-dia-lbl" x="240" y="132" font-size="8" fill="#dc2626">due to acute peritoneal pain</text>';
    }

    html += '</svg>' +
      '<div class="cx-dia-toggle">' +
        btn("cx-dia-mode", "rest", "1. Gentle Subcostal Palpation at Rest", mode === "rest") +
        btn("cx-dia-mode", "inspiration", "2. Deep Inspiration (Diaphragm Descends)", mode === "inspiration") +
      '</div>' +
      '<div class="cx-dia-note">' +
      (mode === "rest"
        ? "<b>Step 1</b>: Gently press the palpating hand under the right costal margin at the lateral border of the rectus muscle (mid-clavicular line) while the patient relaxes."
        : "<b>Step 2 (Positive Murphy Sign)</b>: Ask the patient to take a deep breath. As the diaphragm contracts and descends, it pushes the acutely inflamed gallbladder directly down onto the examiner's palpating fingertips. The sudden, intense peritoneal pain forces an involuntary sharp arrest in breathing ('inspiratory catch'). Must repeat on the left side to confirm specificity for acute cholecystitis.") +
      '</div>';
    return html;
  }

  /* ── 16. JVP Waveform & Mechanical Cycle (interactive) ───────────────────── */

  var JVP_POINTS = [
    { id: "a", cx: 62, cy: 50, label: "a wave", time: "Presystole", mech: "Right atrial contraction", clin: "Precedes S1 and carotid upstroke. GIANT in pulmonary hypertension and tricuspid stenosis. CANNON waves in complete heart block (atrium contracting against shut tricuspid valve). ABSENT in atrial fibrillation." },
    { id: "c", cx: 108, cy: 78, label: "c wave", time: "Early systole", mech: "Tricuspid valve bulging during isovolumetric RV contraction + transmitted carotid pulsation", clin: "Marks the onset of ventricular systole. Usually small and hidden in clinical examination; coincides with S1." },
    { id: "x", cx: 154, cy: 124, label: "x descent", time: "Mid systole", mech: "Atrial relaxation & downward displacement of tricuspid ring during RV ejection", clin: "The predominant descent in normal JVP. OBLITERATED and replaced by systolic surge in tricuspid regurgitation. Exaggerated in cardiac tamponade." },
    { id: "v", cx: 215, cy: 62, label: "v wave", time: "Late systole", mech: "Passive venous filling of right atrium against closed tricuspid valve", clin: "Peaks just after S2. GIANT and fused with c wave in tricuspid regurgitation (Lancisi sign), causing systolic neck vein pulsation." },
    { id: "y", cx: 268, cy: 122, label: "y descent", time: "Early diastole", mech: "Rapid passive emptying of right atrium into RV immediately following tricuspid valve opening", clin: "Precipitous, sharp & deep in constrictive pericarditis (Friedreich's sign). SLOW / BLUNTED in cardiac tamponade and tricuspid stenosis." }
  ];

  function jvpWave(o) {
    var mode = (o && o.focus) || "normal"; // normal | tr | constriction | chb
    var sel = (o && o.selected) || null;
    var html = '<svg class="cx-dia" viewBox="0 0 340 240" role="img" aria-label="Jugular venous pulse waveform correlated with cardiac cycle">';
    html += '<rect class="cx-dia-skin" x="10" y="10" width="320" height="220" rx="10"/>';
    html += '<line class="cx-dia-axis" x1="20" y1="135" x2="320" y2="135"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="22" y="130">Venous zero</text>';

    html += '<line class="cx-dia-soundmark" x1="108" y1="18" x2="108" y2="215"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="108" y="28" text-anchor="middle">S1</text>';
    html += '<line class="cx-dia-soundmark" x1="215" y1="18" x2="215" y2="215"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="215" y="28" text-anchor="middle">S2</text>';

    if (mode === "tr") {
      html += '<path class="cx-dia-wave cx-dia-wave--bad" d="M24 100 C38 98 48 85 62 82 C74 80 84 92 98 88 C115 82 135 30 175 30 C205 30 225 65 240 85 C252 102 260 130 272 130 C288 130 300 115 320 110"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--copd" x="175" y="24" text-anchor="middle">Giant c-v wave (Lancisi sign)</text>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="130" y="92">x descent lost</text>';
    } else if (mode === "constriction") {
      html += '<path class="cx-dia-wave cx-dia-wave--bad" d="M24 100 C40 95 50 50 62 50 C74 50 88 95 98 90 C104 88 108 80 112 80 C120 80 135 136 150 136 C165 136 195 55 215 55 C230 55 242 142 260 142 C275 142 295 105 320 100"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="260" y="155" text-anchor="middle">Friedreich sign (steep y descent)</text>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--copd" x="175" y="44" text-anchor="middle">"M" / "W" contour</text>';
    } else if (mode === "chb") {
      html += '<path class="cx-dia-wave cx-dia-wave--alert" d="M24 105 C35 100 45 75 55 75 C65 75 75 105 85 100 C92 98 100 90 108 90 C116 90 125 15 140 15 C155 15 168 125 180 125 C195 125 208 70 218 70 C232 70 248 120 262 120 C280 120 300 105 320 105"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="140" y="10" text-anchor="middle">CANNON a wave (Atrium vs shut valve)</text>';
    } else {
      html += '<path class="cx-dia-wave" d="M24 105 C40 102 52 50 62 50 C72 50 84 94 96 94 C102 94 105 78 110 78 C118 78 135 124 154 124 C175 124 198 62 215 62 C232 62 250 122 268 122 C285 122 300 100 320 100"/>';
    }

    for (var i = 0; i < JVP_POINTS.length; i++) {
      var p = JVP_POINTS[i], on = sel === p.id;
      html += '<g class="cx-dia-zone' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-zone" data-id="' + p.id + '" role="button" tabindex="0" aria-label="' + esc(p.label) + '">' +
        '<circle cx="' + p.cx + '" cy="' + p.cy + '" r="13"/>' +
        '<text x="' + p.cx + '" y="' + (p.cy + 4) + '" text-anchor="middle">' + p.id + '</text></g>';
    }

    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="22" y="170">Synchronous ECG</text>';
    html += '<line class="cx-dia-div" x1="20" y1="195" x2="320" y2="195"/>';
    html += '<path class="cx-dia-ecg" d="M24 195 L40 195 C46 195 50 183 56 183 C62 183 66 195 72 195 L98 195 L102 202 L108 165 L114 205 L118 195 L180 195 C190 195 198 180 208 180 C218 180 224 195 234 195 L320 195"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--faint" x="56" y="178" text-anchor="middle">P</text>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--faint" x="108" y="160" text-anchor="middle">QRS</text>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--faint" x="208" y="175" text-anchor="middle">T</text>';

    html += '</svg>';

    html += '<div class="cx-dia-toggle">' +
      btn("cx-dia-focus", "normal", "Normal", mode === "normal") +
      btn("cx-dia-focus", "tr", "TR (Lancisi)", mode === "tr") +
      btn("cx-dia-focus", "constriction", "Constriction", mode === "constriction") +
      btn("cx-dia-focus", "chb", "Cannon waves", mode === "chb") +
      '</div>';

    var chosen = null;
    for (i = 0; i < JVP_POINTS.length; i++) if (JVP_POINTS[i].id === sel) chosen = JVP_POINTS[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? '<b>' + esc(chosen.label) + ' (' + esc(chosen.time) + '):</b> ' + esc(chosen.mech) + '. <span class="cx-dia-lbl--copd">Clinical:</span> ' + esc(chosen.clin)
      : 'Tap any letter (<b>a, c, x, v, y</b>) or switch pathological modes above. The JVP reflects right atrial pressure changes, synchronized with the carotid upstroke and ECG.') + '</div>';

    return html;
  }

  /* ── 17. Cardiac Auscultation Areas & Murmur Radiation ──────────────────── */

  var CARDIAC_AREAS = [
    { id: "aortic", cx: 132, cy: 76, label: "Aortic", ic: "2nd RICS", bell: "Diaphragm firmly", posture: "Sitting up, leaning forward in end-expiration", rad: "Radiates up into RIGHT CAROTID ARTERY", murmur: "Aortic Stenosis: harsh crescendo-decrescendo ejection systolic murmur. Slow-rising pulse (pulsus parvus et tardus).", sound: "as" },
    { id: "pulmonary", cx: 196, cy: 76, label: "Pulmonary", ic: "2nd LICS", bell: "Diaphragm", posture: "Supine 45 deg", rad: "Radiates toward left shoulder / back", murmur: "Pulmonary Stenosis ejection murmur; wide fixed split S2 in ASD; continuous machinery murmur of PDA.", sound: "normal" },
    { id: "erbs", cx: 190, cy: 112, label: "Erb's Point", ic: "3rd LICS", bell: "Diaphragm firmly pressed", posture: "Sitting up, leaning forward in full expiration", rad: "Localized along left sternal border", murmur: "Aortic Regurgitation: high-pitched early diastolic decrescendo murmur. Also HOCM systolic murmur (loudest between Erb's and apex).", sound: "ar" },
    { id: "tricuspid", cx: 178, cy: 154, label: "Tricuspid", ic: "4th-5th LICS", bell: "Diaphragm / Bell", posture: "Supine, note respiratory changes", rad: "Lower sternum / xiphisternum", murmur: "Tricuspid Regurgitation: pansystolic murmur. Carvallo sign: LOUDER on inspiration (increased RV venous return).", sound: "normal" },
    { id: "mitral", cx: 236, cy: 184, label: "Mitral (Apex)", ic: "5th LICS MCL", bell: "Bell for MS, Diaphragm for MR", posture: "LEFT LATERAL DECUBITUS position", rad: "MR radiates directly into LEFT AXILLA", murmur: "Mitral Regurgitation: pansystolic blowing murmur radiating to axilla. Mitral Stenosis: localized low-pitched mid-diastolic rumble with opening snap (best heard with light bell pressure).", sound: "mr" }
  ];

  function auscultAreas(o) {
    var sel = (o && o.selected) || null;
    var html = '<svg class="cx-dia cx-dia--chest" viewBox="0 0 340 250" role="img" aria-label="Cardiac auscultation areas on chest wall with murmur radiation vectors">';
    html += '<path class="cx-dia-body" d="M170 14 C120 14 78 30 70 52 C60 82 62 178 74 206 C82 222 120 226 170 226 C220 226 258 222 266 206 C278 178 280 82 270 52 C262 30 220 14 170 14 Z"/>';
    html += '<path class="cx-dia-clav" d="M90 44 C130 52 160 52 170 54 C180 52 210 52 250 44"/>';
    html += '<rect class="cx-dia-skin" x="162" y="52" width="16" height="120" rx="4"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="170" y="105" text-anchor="middle">Sternum</text>';
    html += '<line class="cx-dia-div" x1="100" y1="76" x2="240" y2="76"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--faint" x="84" y="80">2nd ICS</text>';
    html += '<line class="cx-dia-div" x1="100" y1="112" x2="240" y2="112"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--faint" x="84" y="116">3rd ICS</text>';
    html += '<line class="cx-dia-div" x1="100" y1="154" x2="240" y2="154"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--faint" x="84" y="158">4th/5th</text>';

    // Retrosternal cardiac silhouette: Right Atrium forms right border (x=144 to 150),
    // Right Ventricle sits directly retrosternal behind the body of the sternum,
    // Left Ventricle sweeps to 5th left ICS midclavicular line (apex beat at x=236, y=184).
    html += '<path class="cx-dia-cardiac" d="M146 100 C144 130 148 165 170 178 C195 186 225 192 236 184 C242 170 236 130 220 95 C200 75 165 75 146 100 Z" fill="var(--cx-surface)" stroke="var(--cx-primary)" stroke-width="1.8" stroke-dasharray="4 3"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--faint" x="170" y="196" text-anchor="middle" font-size="8">Retrosternal Heart: 1/3 Right (RA), 2/3 Left (RV retrosternal, LV apex)</text>';

    html += '<path class="cx-dia-rad-arrow" d="M132 64 L122 28" marker-end="url(#cxRadArrow)"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--copd" x="110" y="24" text-anchor="end">To carotids (AS)</text>';
    html += '<path class="cx-dia-rad-arrow" d="M246 180 L292 144" marker-end="url(#cxRadArrow)"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--copd" x="296" y="140">To axilla (MR)</text>';

    html += '<defs><marker id="cxRadArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">' +
      '<path d="M0 0 L10 5 L0 10 z" class="cx-dia-rad-arrowhead"/></marker></defs>';

    for (var i = 0; i < CARDIAC_AREAS.length; i++) {
      var a = CARDIAC_AREAS[i], on = sel === a.id;
      html += '<g class="cx-dia-zone cx-dia-zone--ausc cx-dia-zone--cardiac' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-ausc" data-id="' + a.id + '" role="button" tabindex="0" aria-label="' + esc(a.label) + '">' +
        '<circle cx="' + a.cx + '" cy="' + a.cy + '" r="16"/>' +
        '<text x="' + a.cx + '" y="' + (a.cy + 4) + '" text-anchor="middle">' + a.label.charAt(0) + '</text></g>';
    }

    html += '</svg>';

    var chosen = null;
    for (i = 0; i < CARDIAC_AREAS.length; i++) if (CARDIAC_AREAS[i].id === sel) chosen = CARDIAC_AREAS[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? '<b>' + esc(chosen.label) + ' (' + esc(chosen.ic) + '):</b> ' + esc(chosen.murmur) +
        '<br><b>Position & Maneuver:</b> ' + esc(chosen.posture) + ' (' + esc(chosen.bell) + ').' +
        '<br><b>Radiation:</b> <span class="cx-dia-lbl--copd">' + esc(chosen.rad) + '</span>'
      : 'Tap an area (<b>A</b>ortic, <b>P</b>ulmonary, <b>E</b>rb\'s, <b>T</b>ricuspid, <b>M</b>itral) to hear the classic murmur and see position, bell vs diaphragm, and radiation vectors.') + '</div>';

    return html;
  }

  /* ── 18. Cranial Nerves III, IV, VI & Cardinal Gaze Positions ────────────── */

  var GAZE_POSITIONS = [
    { id: "up_r", cx: 65, cy: 45, label: "Up & Right", muscles: "R Superior Rectus (CN III) + L Inferior Oblique (CN III)", clin: "Tests elevation in abduction for right eye, elevation in adduction for left eye." },
    { id: "lat_r", cx: 45, cy: 110, label: "Right Lateral", muscles: "R Lateral Rectus (CN VI) + L Medial Rectus (CN III)", clin: "Pure horizontal abduction (VI) vs adduction (III). Horizontal uncrossed diplopia in right CN VI palsy." },
    { id: "dn_r", cx: 65, cy: 175, label: "Down & Right", muscles: "R Inferior Rectus (CN III) + L Superior Oblique (CN IV)", clin: "Tests depression in abduction for right eye, depression in adduction for left eye (SO4)." },
    { id: "up_l", cx: 275, cy: 45, label: "Up & Left", muscles: "L Superior Rectus (CN III) + R Inferior Oblique (CN III)", clin: "Tests elevation in abduction for left eye, elevation in adduction for right eye." },
    { id: "lat_l", cx: 295, cy: 110, label: "Left Lateral", muscles: "L Lateral Rectus (CN VI) + R Medial Rectus (CN III)", clin: "Horizontal gaze to the left. In left CN VI palsy, left eye fails to abduct beyond midline." },
    { id: "dn_l", cx: 275, cy: 175, label: "Down & Left", muscles: "L Inferior Rectus (CN III) + R Superior Oblique (CN IV)", clin: "Crucial for CN IV (trochlear): tests right Superior Oblique in adduction (reading, walking down stairs)." }
  ];

  function cnGaze(o) {
    var mode = (o && o.mode) || "hpattern"; // hpattern | cn3palsy | cn4palsy | cn6palsy | horner
    var sel = (o && o.selected) || null;
    var html = '<svg class="cx-dia" viewBox="0 0 340 230" role="img" aria-label="Cranial nerves 3, 4 and 6 six cardinal gaze positions">';

    html += '<rect class="cx-dia-skin" x="10" y="10" width="320" height="210" rx="10"/>';
    html += '<path class="cx-dia-div" d="M65 45 L65 175 M275 45 L275 175 M65 110 L275 110" stroke-width="2"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="170" y="24" text-anchor="middle">"H" in space: isolator of ocular muscles</text>';

    var rPupilX = 135, rPupilY = 110, rPupilR = 6, rPtosis = false;
    var lPupilX = 205, lPupilY = 110, lPupilR = 6;

    if (mode === "cn3palsy") {
      rPupilX = 125; rPupilY = 118; rPupilR = 10; rPtosis = true;
    } else if (mode === "cn6palsy") {
      rPupilX = 142; rPupilY = 110;
    } else if (mode === "cn4palsy") {
      rPupilX = 135; rPupilY = 103;
    } else if (mode === "horner") {
      rPtosis = true; rPupilR = 3.5;
    }

    html += '<ellipse cx="135" cy="110" rx="22" ry="16" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<circle cx="' + rPupilX + '" cy="' + rPupilY + '" r="' + rPupilR + '" class="' + (rPupilR > 7 ? "cx-dia-pupil--dilated" : "cx-dia-pupil") + '"/>';
    if (rPtosis) {
      html += '<path d="M113 104 C125 114 145 114 157 104" stroke="var(--cx-teach)" stroke-width="2.5" fill="none"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--copd" x="135" y="94" text-anchor="middle">Ptosis</text>';
    }
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="135" y="136" text-anchor="middle">R Eye</text>';

    html += '<ellipse cx="205" cy="110" rx="22" ry="16" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<circle cx="' + lPupilX + '" cy="' + lPupilY + '" r="' + lPupilR + '" class="cx-dia-pupil"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="205" y="136" text-anchor="middle">L Eye</text>';

    for (var i = 0; i < GAZE_POSITIONS.length; i++) {
      var g = GAZE_POSITIONS[i], on = sel === g.id;
      html += '<g class="cx-dia-gaze-box' + (on ? " cx-dia-gaze-box--on" : "") + '" data-act="cx-dia-zone" data-id="' + g.id + '" role="button" tabindex="0">' +
        '<rect x="' + (g.cx - 38) + '" y="' + (g.cy - 18) + '" width="76" height="36" rx="6"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--normal" x="' + g.cx + '" y="' + (g.cy - 2) + '" text-anchor="middle">' + esc(g.label) + '</text>' +
        '<text class="cx-dia-lbl--faint" x="' + g.cx + '" y="' + (g.cy + 10) + '" text-anchor="middle">Tap to check</text></g>';
    }

    html += '</svg>';

    html += '<div class="cx-dia-toggle">' +
      btn("cx-dia-mode", "hpattern", "H-Pattern", mode === "hpattern") +
      btn("cx-dia-mode", "cn3palsy", "CN III Palsy", mode === "cn3palsy") +
      btn("cx-dia-mode", "cn4palsy", "CN IV Palsy", mode === "cn4palsy") +
      btn("cx-dia-mode", "cn6palsy", "CN VI Palsy", mode === "cn6palsy") +
      btn("cx-dia-mode", "horner", "Horner Syn.", mode === "horner") +
      '</div>';

    var chosen = null;
    for (i = 0; i < GAZE_POSITIONS.length; i++) if (GAZE_POSITIONS[i].id === sel) chosen = GAZE_POSITIONS[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? '<b>' + esc(chosen.label) + ':</b> ' + esc(chosen.muscles) + '. <br><span class="cx-dia-lbl--copd">Exam Pearl:</span> ' + esc(chosen.clin)
      : (mode === "cn3palsy"
        ? '<b>CN III (Oculomotor) Palsy:</b> Resting "Down and Out" eye position (due to unopposed LR6 and SO4). Complete ptosis (levator palpebrae paralysis) and dilated, fixed pupil (loss of parasympathetic pupilloconstrictor fibers).'
        : (mode === "cn4palsy"
          ? '<b>CN IV (Trochlear) Palsy:</b> Superior oblique paralysis. Vertical/torsional diplopia, worst when looking down and inward (reading, walking downstairs). Patient tilts head to opposite shoulder (Bielschowsky test).'
          : (mode === "cn6palsy"
            ? '<b>CN VI (Abducens) Palsy:</b> Inability to abduct the affected eye. Horizontal uncrossed diplopia on lateral gaze. Most sensitive to raised intracranial pressure (false localizing sign).'
            : (mode === "horner"
              ? '<b>Horner Syndrome (Sympathetic tract lesion):</b> Mild partial ptosis (Müller\'s muscle), miosis (pupillodilator loss), facial anhidrosis, and apparent enophthalmos.'
              : 'Hold your finger 30-40 cm from the patient\'s face. Trace a broad "H" in the air. Pause at the 6 cardinal endpoints to look for paresis or nystagmus.'))))) + '</div>';

    return html;
  }

  /* ── 19. UMN vs LMN Facial Nerve Palsy (Forehead Sparing) ────────────────── */

  /* ── 19. Facial Palsy: UMN vs LMN Mechanism & Forehead Sparing ───────────── */

  function facialPalsy(o) {
    var mode = (o && o.mode) || "umn"; // normal | umn | lmn
    var isNormal = mode === "normal";
    var isUmn = mode === "umn";
    var isLmn = mode === "lmn";

    var html = '<svg class="cx-dia" viewBox="0 0 360 290" role="img" aria-label="UMN vs LMN facial palsy neuroanatomical wiring and forehead sparing">';

    html += '<rect width="360" height="290" rx="8" fill="var(--cx-surface)" stroke="var(--cx-line)"/>';

    // Cerebral Motor Cortices (Precentral Gyrus)
    html += '<g class="cx-dia-cortex">' +
      '<rect x="40" y="18" width="105" height="34" rx="6" fill="var(--cx-surface-2)" stroke="var(--cx-line)" stroke-width="1.5"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="92" y="38" text-anchor="middle" font-weight="700">Right Cortex</text>' +
      '<rect x="215" y="18" width="105" height="34" rx="6" fill="var(--cx-surface-2)" stroke="var(--cx-line)" stroke-width="1.5"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="267" y="38" text-anchor="middle" font-weight="700">Left Cortex</text>' +
      '</g>';

    // Corticobulbar pathways:
    // Left Cortex projections:
    html += '<path d="M260 52 L198 108" stroke="#10b981" stroke-width="2" stroke-dasharray="3 2" fill="none"/>';
    html += '<path d="M250 52 L152 108" stroke="#10b981" stroke-width="2" stroke-dasharray="3 2" fill="none"/>';
    html += '<path d="M240 52 L142 122" stroke="#f59e0b" stroke-width="2.5" fill="none"/>';

    // Right Cortex projections:
    if (!isUmn) {
      html += '<path d="M100 52 L162 108" stroke="#10b981" stroke-width="2" stroke-dasharray="3 2" fill="none"/>';
      html += '<path d="M110 52 L208 108" stroke="#10b981" stroke-width="2" stroke-dasharray="3 2" fill="none"/>';
      html += '<path d="M120 52 L218 122" stroke="#f59e0b" stroke-width="2.5" fill="none"/>';
    } else {
      // UMN Lesion on Right Corticobulbar Tract
      html += '<path d="M100 52 L120 75" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="2 2" fill="none"/>';
      html += '<path d="M110 52 L125 75" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="2 2" fill="none"/>';
      html += '<path d="M120 52 L130 75" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="2 2" fill="none"/>';
      html += '<g><circle cx="125" cy="75" r="11" fill="rgba(239, 68, 68, 0.2)" stroke="#ef4444" stroke-width="2"/>' +
        '<line x1="117" y1="67" x2="133" y2="83" stroke="#ef4444" stroke-width="2.5"/>' +
        '<line x1="133" y1="67" x2="117" y2="83" stroke="#ef4444" stroke-width="2.5"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--bad" x="25" y="80" font-weight="700">UMN STROKE</text></g>';
    }

    // Pons with Facial Motor Nucleus (VII)
    html += '<rect x="120" y="98" width="120" height="42" rx="6" fill="var(--cx-surface-2)" stroke="var(--cx-line)" stroke-width="1.5"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="180" y="112" text-anchor="middle" font-size="9.5">PONS: VII MOTOR NUCLEUS</text>';
    html += '<circle cx="150" cy="125" r="7" fill="' + (isUmn ? '#10b981' : 'var(--cx-primary)') + '"/>';
    html += '<circle cx="210" cy="125" r="7" fill="' + (isUmn ? '#10b981' : 'var(--cx-primary)') + '"/>';
    html += '<text x="180" y="132" text-anchor="middle" font-size="8" fill="var(--cx-muted)">Upper Subnucleus (Dual Supply)</text>';

    // Peripheral CN VII Nerve Trunks
    if (!isLmn) {
      html += '<path d="M210 140 L260 170" stroke="var(--cx-primary)" stroke-width="2.5" fill="none"/>';
      html += '<path d="M150 140 L100 170" stroke="var(--cx-primary)" stroke-width="2.5" fill="none"/>';
    } else {
      // LMN Lesion on Left Facial Nerve (Bell's Palsy)
      html += '<path d="M150 140 L100 170" stroke="var(--cx-primary)" stroke-width="2.5" fill="none"/>';
      html += '<path d="M210 140 L235 155" stroke="var(--cx-primary)" stroke-width="2.5" fill="none"/>';
      html += '<g><circle cx="240" cy="158" r="11" fill="rgba(239, 68, 68, 0.2)" stroke="#ef4444" stroke-width="2"/>' +
        '<line x1="232" y1="150" x2="248" y2="166" stroke="#ef4444" stroke-width="2.5"/>' +
        '<line x1="248" y1="150" x2="232" y2="166" stroke="#ef4444" stroke-width="2.5"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--bad" x="260" y="162" font-weight="700">BELL\'S PALSY (LMN)</text></g>';
    }

    // Patient Face Representation
    html += '<g transform="translate(180, 225)">';
    html += '<ellipse cx="0" cy="0" rx="42" ry="48" fill="var(--cx-surface-2)" stroke="var(--cx-ink)" stroke-width="2"/>';

    // Forehead Wrinkles
    if (isLmn) {
      html += '<line x1="-30" y1="-28" x2="-8" y2="-28" stroke="var(--cx-ink)" stroke-width="1.8"/>';
      html += '<line x1="-32" y1="-22" x2="-6" y2="-22" stroke="var(--cx-ink)" stroke-width="1.8"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="12" y="-24" font-size="8.5" font-weight="700">LOST</text>';
    } else {
      html += '<line x1="-30" y1="-28" x2="-8" y2="-28" stroke="var(--cx-ink)" stroke-width="1.8"/>';
      html += '<line x1="-32" y1="-22" x2="-6" y2="-22" stroke="var(--cx-ink)" stroke-width="1.8"/>';
      html += '<line x1="8" y1="-28" x2="30" y2="-28" stroke="var(--cx-ink)" stroke-width="1.8"/>';
      html += '<line x1="6" y1="-22" x2="32" y2="-22" stroke="var(--cx-ink)" stroke-width="1.8"/>';
      if (isUmn) {
        html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="0" y="-35" text-anchor="middle" font-size="8" font-weight="700">FOREHEAD SPARED (Bilateral Supply)</text>';
      }
    }

    // Eyes
    if (isLmn) {
      html += '<ellipse cx="-18" cy="-5" rx="7" ry="4" fill="var(--cx-surface)" stroke="var(--cx-ink)" stroke-width="1.5"/>';
      html += '<circle cx="-18" cy="-5" r="2.5" fill="var(--cx-ink)"/>';
      html += '<ellipse cx="18" cy="-5" rx="8" ry="7" fill="var(--cx-surface)" stroke="#ef4444" stroke-width="2"/>';
      html += '<circle cx="18" cy="-8" r="2.5" fill="var(--cx-muted)"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="52" y="-4" font-size="8">Bell\'s sign</text>';
    } else {
      html += '<ellipse cx="-18" cy="-5" rx="7" ry="4" fill="var(--cx-surface)" stroke="var(--cx-ink)" stroke-width="1.5"/>';
      html += '<circle cx="-18" cy="-5" r="2.5" fill="var(--cx-ink)"/>';
      html += '<ellipse cx="18" cy="-5" rx="7" ry="4" fill="var(--cx-surface)" stroke="var(--cx-ink)" stroke-width="1.5"/>';
      html += '<circle cx="18" cy="-5" r="2.5" fill="var(--cx-ink)"/>';
    }

    // Nose
    html += '<path d="M0 -12 L0 10 L-4 12" stroke="var(--cx-muted)" stroke-width="1.5" fill="none"/>';

    // Mouth / Smile
    if (isNormal) {
      html += '<path d="M-18 25 Q0 34 18 25" stroke="var(--cx-primary)" stroke-width="2.5" fill="none"/>';
    } else {
      html += '<path d="M-18 22 Q-6 32 18 36" stroke="#ef4444" stroke-width="2.5" fill="none"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="52" y="32" font-size="8">Mouth droop</text>';
    }

    html += '</g>';

    html += '</svg>';

    html += '<div class="cx-dia-toggle">' +
      btn("cx-dia-mode", "normal", "Normal", isNormal) +
      btn("cx-dia-mode", "umn", "UMN (Stroke: Forehead Spared)", isUmn) +
      btn("cx-dia-mode", "lmn", "LMN (Bell\'s: Forehead Lost)", isLmn) +
      '</div>';

    html += '<div class="cx-dia-note">' + (isUmn
      ? '<b>Upper Motor Neuron Lesion (Stroke):</b> Corticobulbar input to the upper facial nucleus is <b>BILATERAL</b>. The intact ipsilateral motor cortex continues to innervate the frontalis and orbicularis oculi, so <b>forehead wrinkling and eye closure are SPARED</b>. Weakness is strictly confined to the contralateral lower face (drooping mouth, flat nasolabial fold).'
      : isLmn
        ? '<b>Lower Motor Neuron Lesion (Bell\'s Palsy):</b> The final common peripheral pathway is damaged. The <b>ENTIRE ipsilateral hemiface is paralyzed</b>: forehead wrinkles are completely wiped out, the eye cannot close (Bell\'s phenomenon: globe rotates upward and outward on attempted closure), and the mouth angle droops with saliva pooling.'
        : '<b>The Bedside Diagnostic Rule:</b> When examining a patient with facial weakness, always look at the <b>forehead</b>. Forehead spared = Stroke (admit to acute stroke unit!). Forehead involved = Peripheral Bell\'s palsy / facial nerve lesion.') + '</div>';

    return html;
  }

  /* ── 20. Ascites: Shifting Dullness & Fluid Thrill ────────────────────────── */

  function shiftingDullness(o) {
    var mode = (o && o.mode) || "supine"; // supine | shift | thrill
    var html = '<svg class="cx-dia" viewBox="0 0 340 220" role="img" aria-label="Shifting dullness and fluid thrill physical diagnosis in ascites">';

    html += '<rect class="cx-dia-skin" x="10" y="10" width="320" height="200" rx="10"/>';

    if (mode === "supine") {
      html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="170" y="28" text-anchor="middle">Patient SUPINE: Gas floats, fluid sinks</text>';
      html += '<path d="M40 140 C50 65 290 65 300 140 C280 175 60 175 40 140 Z" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="2"/>';
      html += '<path class="cx-dia-fluid--ascites" d="M40 140 C45 95 90 120 100 140 C105 160 55 165 40 140 Z"/>';
      html += '<path class="cx-dia-fluid--ascites" d="M300 140 C295 95 250 120 240 140 C235 160 285 165 300 140 Z"/>';
      html += '<circle class="cx-dia-bowel" cx="150" cy="105" r="16"/>';
      html += '<circle class="cx-dia-bowel" cx="185" cy="105" r="16"/>';
      html += '<circle class="cx-dia-bowel" cx="168" cy="130" r="15"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="65" y="130">DULL</text>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="170" y="110" text-anchor="middle">TYMPANITIC (Air)</text>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="275" y="130">DULL</text>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="170" y="188" text-anchor="middle">Percuss from midline outwards until note turns dull. Keep finger there!</text>';
    } else if (mode === "shift") {
      html += '<text class="cx-dia-lbl cx-dia-lbl--copd" x="170" y="28" text-anchor="middle">Patient ROLLED into lateral decubitus</text>';
      html += '<path d="M50 160 C30 90 230 40 280 110 C300 170 110 195 50 160 Z" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="2"/>';
      html += '<path class="cx-dia-fluid--ascites" d="M50 160 C38 120 120 140 160 160 C180 175 80 195 50 160 Z"/>';
      html += '<circle class="cx-dia-bowel" cx="215" cy="85" r="16"/>';
      html += '<circle class="cx-dia-bowel" cx="245" cy="100" r="16"/>';
      html += '<circle class="cx-dia-bowel" cx="210" cy="115" r="15"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="90" y="165">DULL (Fluid shifted down)</text>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="235" y="70">TURNS TYMPANITIC!</text>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="170" y="195" text-anchor="middle">Wait 30-60s for viscous fluid to settle before re-percussing.</text>';
    } else if (mode === "thrill") {
      html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="170" y="28" text-anchor="middle">Fluid Thrill (Fluid Wave): 3-hand technique</text>';
      html += '<path d="M40 135 C50 70 290 70 300 135 C280 175 60 175 40 135 Z" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="2"/>';
      html += '<path class="cx-dia-fluid--ascites" d="M40 135 C55 85 285 85 300 135 C275 165 65 165 40 135 Z"/>';
      html += '<rect class="cx-dia-hand" x="25" y="105" width="22" height="46" rx="4"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="22" y="98">Receiving palm</text>';
      html += '<path d="M305 125 L285 120" stroke="var(--cx-teach)" stroke-width="2.5" marker-end="url(#cxThrillArrow)"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--copd" x="310" y="98">Flicking finger</text>';
      html += '<rect class="cx-dia-damphand" x="164" y="60" width="12" height="65" rx="3"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="170" y="52" text-anchor="middle">Assistant ulnar hand (Damps fat wave)</text>';
      html += '<defs><marker id="cxThrillArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="cx-dia-rad-arrowhead"/></marker></defs>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="170" y="190" text-anchor="middle">Without the midline hand, an impulse easily travels through subcutaneous fat alone!</text>';
    }

    html += '</svg>';

    html += '<div class="cx-dia-toggle">' +
      btn("cx-dia-mode", "supine", "1. Supine Percussion", mode === "supine") +
      btn("cx-dia-mode", "shift", "2. Roll (Shifted)", mode === "shift") +
      btn("cx-dia-mode", "thrill", "3. Fluid Thrill", mode === "thrill") +
      '</div>';

    html += '<div class="cx-dia-note">' + (mode === "supine"
      ? '<b>Supine:</b> Intraperitoneal fluid is governed by gravity. Free fluid fills the paracolic gutters in both flanks, giving a <b>dull note</b>, while gas-filled loops of bowel float to the surface around the umbilicus, giving a <b>tympanitic note</b>.'
      : (mode === "shift"
        ? '<b>Shifting Dullness:</b> Roll the patient towards you. Gravity moves the fluid column to the bottom (now duller), while buoyant bowel floats to the top flank—which switches from <b>dull to resonant</b>! Wait 30 seconds before percussing.'
        : '<b>Fluid Thrill:</b> Detects tense, massive ascites (> 1.5 - 2 Litres). The assistant\'s ulnar border firmly dampens fat ripples across the abdominal wall. An impulse reaching the opposite palm confirms a true fluid wave.')) + '</div>';

    return html;
  }

  /* ── 21. Spinal Cord Sensory Levels & Dermatome Landmarks ────────────────── */

  var SENSORY_LEVELS = [
    { id: "c2", cx: 170, cy: 30, label: "C2", desc: "Occipital protuberance", motor: "Neck flexion / extension", reflex: "None", clin: "Upper cervical landmark." },
    { id: "c4", cx: 170, cy: 62, label: "C4", desc: "Acromioclavicular joint & clavicle", motor: "Diaphragm (C3, C4, C5 keep diaphragm alive)", reflex: "None", clin: "Lesions at or above C4 cause respiratory arrest." },
    { id: "c6", cx: 95, cy: 110, label: "C6", desc: "Thumb & lateral forearm", motor: "Wrist extensors (extensor carpi radialis)", reflex: "Biceps & Supinator (C5, C6)", clin: "C6 radiculopathy: weak wrist extension, sensory loss in thumb." },
    { id: "c7", cx: 80, cy: 135, label: "C7", desc: "Middle finger", motor: "Elbow extension (Triceps), wrist flexors", reflex: "Triceps reflex (C7, C8)", clin: "Commonest cervical disc herniation." },
    { id: "c8", cx: 90, cy: 160, label: "C8", desc: "Little finger & hypothenar border", motor: "Finger flexors (flexor digitorum profundus)", reflex: "Finger jerk", clin: "Klumpke palsy; Horner syndrome if T1 white rami involved." },
    { id: "t4", cx: 170, cy: 98, label: "T4", desc: "Nipple line / 4th intercostal space", motor: "Intercostal muscles", reflex: "Superficial abdominal (upper: T7-T9)", clin: "Classic thoracic sensory level in transverse myelitis / cord compression." },
    { id: "t10", cx: 170, cy: 140, label: "T10", desc: "Umbilicus", motor: "Lower abdominal wall", reflex: "Superficial abdominal (lower: T10-T12)", clin: "Beevor sign: umbilicus pulled UPWARD on neck flexion if lower cord (T10-T12) weak." },
    { id: "l1", cx: 170, cy: 170, label: "L1", desc: "Inguinal ligament crease", motor: "Hip flexion (L1, L2 psoas)", reflex: "Cremasteric reflex (L1, L2)", clin: "Marks the junction between thoracic cord and lumbar enlargement." },
    { id: "l4", cx: 148, cy: 215, label: "L4", desc: "Medial malleolus & knee", motor: "Ankle dorsiflexion (tibialis anterior), knee extension (quadriceps)", reflex: "Knee jerk (L3, L4)", clin: "Foot drop with loss of knee jerk." },
    { id: "l5", cx: 192, cy: 215, label: "L5", desc: "Dorsum of foot & great toe", motor: "Great toe extension (extensor hallucis longus)", reflex: "None (internal hamstring)", clin: "L5 radiculopathy: foot drop with intact knee and ankle reflexes." },
    { id: "s1", cx: 215, cy: 232, label: "S1", desc: "Lateral malleolus & sole of foot", motor: "Ankle plantarflexion (gastrocnemius / soleus)", reflex: "Ankle jerk (S1, S2)", clin: "Sciatica; lost ankle jerk with sole numbness." }
  ];

  function sensoryLevel(o) {
    var sel = (o && o.selected) || "t10";
    var html = '<svg class="cx-dia" viewBox="0 0 340 260" role="img" aria-label="Spinal cord sensory levels and landmark dermatomes">';

    html += '<rect class="cx-dia-skin" x="10" y="8" width="320" height="244" rx="10"/>';
    html += '<path class="cx-dia-body" d="M170 14 C158 14 150 24 150 36 C150 48 135 55 125 58 L100 85 L76 135 L68 175 L80 178 L92 145 L115 105 L125 105 L125 175 L145 178 L140 245 L160 245 L165 185 L175 185 L180 245 L200 245 L195 178 L215 175 L215 105 L225 105 L248 145 L260 178 L272 175 L264 135 L240 85 L215 58 C205 55 190 48 190 36 C190 24 182 14 170 14 Z"/>';

    html += '<line class="cx-dia-div" x1="120" y1="98" x2="220" y2="98"/>';
    html += '<line class="cx-dia-div" x1="125" y1="140" x2="215" y2="140"/>';
    html += '<line class="cx-dia-div" x1="130" y1="170" x2="210" y2="170"/>';

    for (var i = 0; i < SENSORY_LEVELS.length; i++) {
      var d = SENSORY_LEVELS[i], on = sel === d.id;
      html += '<g class="cx-dia-zone cx-dia-zone--derm' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-zone" data-id="' + d.id + '" role="button" tabindex="0" aria-label="' + esc(d.label) + '">' +
        '<circle cx="' + d.cx + '" cy="' + d.cy + '" r="12"/>' +
        '<text x="' + d.cx + '" y="' + (d.cy + 3.5) + '" text-anchor="middle" font-size="9" font-weight="700">' + d.label + '</text></g>';
    }

    html += '</svg>';

    var chosen = null;
    for (i = 0; i < SENSORY_LEVELS.length; i++) if (SENSORY_LEVELS[i].id === sel) chosen = SENSORY_LEVELS[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? '<b>Level ' + esc(chosen.label) + ' (' + esc(chosen.desc) + '):</b> ' +
        '<br><b>Motor Root:</b> ' + esc(chosen.motor) + '.' +
        '<br><b>Reflex Arc:</b> ' + esc(chosen.reflex) + '.' +
        '<br><b>Exam Pearl:</b> <span class="cx-dia-lbl--copd">' + esc(chosen.clin) + '</span>'
      : 'Tap any landmark circle (C6, T4, T10, L4, etc.) to view cord segment, motor testing, reflex arcs, and classic clinical signs.') + '</div>';

    return html;
  }

  /* ── registry ────────────────────────────────────────────────────────────── */

  var DIAGRAMS = {
    "diagram.flowvolume":   { title: "Flow-volume loop", render: flowVolume, interactive: true },
    "diagram.airtrapping":  { title: "Air trapping in emphysema", render: airTrapping },
    "diagram.percussion":   { title: "Percussion zones", render: percussionMap, interactive: true },
    "diagram.percussion.technique": { title: "Percussion technique", render: percussionTechnique },
    "diagram.expansion":    { title: "Chest expansion: the floating thumb", render: expansion, interactive: true },
    "diagram.auscultation": { title: "Auscultation sites", render: auscultationMap, interactive: true, audio: true },
    "diagram.hoover":       { title: "Hoover sign", render: hoover },
    "diagram.barrel":       { title: "Barrel chest", render: barrelChest, interactive: true },
    "diagram.trachea":      { title: "Tracheal position", render: trachea },
    "diagram.clubbing":     { title: "Clubbing and the Schamroth window", render: clubbing, interactive: true },
    "diagram.effusionshift":{ title: "Which way the mediastinum moves", render: effusionShift, interactive: true },
    "diagram.breathing":    { title: "Breathing patterns", render: breathingPatterns },
    "diagram.abdregions":    { title: "Nine regions of the abdomen", render: abdRegions, interactive: true },
    "diagram.liverpalp":     { title: "Liver palpation, preferred method", render: liverPalp },
    "diagram.spleenpalp":    { title: "Splenic enlargement, direction of spread", render: spleenPalp },
    "diagram.stemi":         { title: "STEMI evolution on serial ECGs", render: stemiEvolution },
    "diagram.precordium":    { title: "Precordium Auscultation & Radiation Map", render: precordiumMap, interactive: true, audio: true },
    "diagram.jvp":           { title: "JVP Waveform & Pathologies", render: jvpWaveform, interactive: true },
    "diagram.dermatomes":    { title: "Dermatome & Reflex Landmarks", render: dermatomeMap, interactive: true },
    "diagram.cranial":       { title: "Cranial Nerves I-XII Map", render: cranialMap, interactive: true },
    "diagram.reflexarc":     { title: "Deep Tendon Reflex Arc Circuit", render: reflexArc, interactive: true },
    "diagram.corticospinal": { title: "Corticospinal Decussation & Motor Signs", render: corticospinal, interactive: true },
    "diagram.cerebellum":    { title: "Cerebellar Signs & Coordination", render: cerebellumMap, interactive: true },
    "diagram.wiggers":       { title: "Wiggers Cardiac Cycle & Auscultation", render: wiggers, interactive: true },
    "diagram.murmurtiming":  { title: "Murmur Timing Strip", render: murmurTiming, interactive: true },
    "diagram.spirocurves":   { title: "Spirometry Loops & Curves (Obstructive vs Restrictive)", render: spirometryCurves, interactive: true },
    "diagram.pleuralsigns":  { title: "Pleural & Pulmonary Signs (Consolidation, Effusion, PTX)", render: pleuralSigns, interactive: true },
    "diagram.shiftingdullness": { title: "Ascites: shifting dullness and fluid thrill", render: shiftingDullness, interactive: true },
    "diagram.murphysign":    { title: "Murphy Sign & Gallbladder Anatomy", render: murphySign, interactive: true },
    "diagram.jvpwave":       { title: "JVP waveform and mechanical events", render: jvpWave, interactive: true },
    "diagram.auscultareas":  { title: "Cardiac auscultation areas and murmur radiation", render: auscultAreas, interactive: true, audio: true },
    "diagram.cngaze":        { title: "Cranial nerves III, IV, VI cardinal gazes", render: cnGaze, interactive: true },
    "diagram.facialpalsy":   { title: "UMN vs LMN facial palsy (forehead sparing)", render: facialPalsy, interactive: true },
    "diagram.sensorylevel":  { title: "Spinal cord sensory levels & dermatomes", render: sensoryLevel, interactive: true }
  };

  var ATLAS_IMAGES = {
    "diagram.cranial": {
      src: "clinix-cranial-nerves-brainstem.jpg",
      title: "Cranial Nerves: Ventral Brainstem Anatomy (CN I-XII)",
      desc: "Authentic anatomical map (OpenStax / NCBI StatPearls) showing superficial origins of all 12 pairs of cranial nerves on the ventral surface of the brainstem and skull base."
    },
    "diagram.liverpalp": {
      src: "clinix-liver-palpation.jpg",
      title: "Liver Palpation: Authentic Bedside Technique",
      desc: "Left hand lifting right posterior 10th-11th ribs forward; right hand placed flat in RIF advancing toward costal margin on expiration."
    },
    "diagram.facialpalsy": {
      src: "clinix-facialpalsy1.jpg",
      title: "Facial Palsy: Clinical Bedside Verification",
      desc: "Authentic clinical photos: Complete unilateral hemifacial paralysis in LMN Bell's palsy vs forehead wrinkling preserved in UMN stroke."
    },
    "diagram.cngaze": {
      src: "clinix-gazepositions.jpg",
      title: "Six Cardinal Gaze Positions: Clinical Motility",
      desc: "Authentic patient motility series isolating extraocular recti and obliques (CN III, IV, VI)."
    },
    "diagram.barrel": {
      src: "clinix-barrelchest.jpg",
      title: "Barrel Chest in Emphysematous COPD",
      desc: "Authentic clinical photograph demonstrating increased anteroposterior thoracic diameter (AP ratio 1:1)."
    },
    "diagram.percussion.technique": {
      src: "clinix-resp-technique-panel.jpg",
      title: "Bedside Percussion & Palpation Technique",
      desc: "Authentic clinical panel showing pleximeter finger placement in intercostal space and loose-wrist percussion stroke."
    },
    "diagram.clubbing": {
      src: "clinix-schamroth-sign.jpg",
      title: "Schamroth Sign: Authentic Clinical Photograph",
      desc: "Authentic clinical photograph (NCBI PMC / ResearchGate): Panel A shows complete obliteration of the diamond window in clubbed fingers. Panel B shows the normal diamond-shaped window (arrowhead) in healthy fingers."
    },
    "diagram.shiftingdullness": {
      src: "clinix-ascites2.jpg",
      title: "Ascites: Shifting Dullness Technique",
      desc: "Authentic clinical photo: Flank dullness shifting gravitationally when patient turns 45° to lateral decubitus."
    },
    "diagram.precordium": {
      src: "clinix-precordium-inspection.jpg",
      title: "Precordial Surface Anatomy & Inspection",
      desc: "Authentic clinical photograph of anterior thoracic landmarks and cardiac auscultation areas."
    },
    "diagram.auscultareas": {
      src: "clinix-apexbeat1.jpg",
      title: "Locating Apex Beat & Auscultation Areas",
      desc: "Authentic clinical palpation locating the 5th intercostal space midclavicular line."
    },
    "diagram.cn5": {
      src: "clinix-cn5-motor-corneal.jpg",
      title: "Trigeminal Nerve (CN V): Motor & Corneal Reflex",
      desc: "Authentic bedside examination of temporalis/masseter clench and afferent corneal reflex."
    },
    "diagram.kidney": {
      src: "clinix-kidney-ballottement.jpg",
      title: "Renal Ballottement Technique",
      desc: "Authentic bimanual examination of the renal angle: posterior hand flicking kidney anteriorly onto resting anterior hand."
    },
    "diagram.abdausc": {
      src: "clinix-abdomen-auscultation.jpg",
      title: "Abdominal Auscultation & Bowel Sounds",
      desc: "Authentic clinical stethoscope placement for peristaltic bowel sounds and renal artery bruits."
    },
    "diagram.heartfailure": {
      src: "clinix-heartfailure-signs.jpg",
      title: "Congestive Heart Failure Bedside Triad",
      desc: "Authentic clinical signs: Elevated jugular venous pulse (JVP), bilateral pitting pedal edema, and hepatomegaly."
    },
    "diagram.consolidation": {
      src: "clinix-consolidation-triad.jpg",
      title: "Lobar Consolidation Physical Signs",
      desc: "Authentic clinical signs: Dull percussion note, bronchial breath sounds, increased tactile fremitus and whispered pectoriloquy."
    },
    "diagram.pallor": {
      src: "clinix-pallor.jpg",
      title: "General Examination: Conjunctival Pallor",
      desc: "Authentic clinical photo showing severe paleness of lower palpebral conjunctiva in anemia (Hb < 7 g/dL)."
    },
    "diagram.bpcuff": {
      src: "clinix-bpcuff.jpg",
      title: "Blood Pressure Measurement & Cuff Placement",
      desc: "Authentic clinical method: Bladder center over brachial artery, lower edge 2.5 cm above antecubital fossa."
    },
    "diagram.handhygiene": {
      src: "clinix-handhygiene.jpg",
      title: "WHO 6-Step Hand Hygiene Technique",
      desc: "Authentic bedside infection control: Palm to palm, interlaced fingers, back of fingers, thumb rotation, and fingertips."
    }
  };

  function has(id) { return Object.prototype.hasOwnProperty.call(DIAGRAMS, id); }
  function hasAtlas(id) { return Object.prototype.hasOwnProperty.call(ATLAS_IMAGES, id); }
  function getAtlas(id) { return ATLAS_IMAGES[id] || null; }
  function render(id, opts) {
    if (!has(id)) return "";
    try { return DIAGRAMS[id].render(opts || {}); } catch (e) { return ""; }
  }
  function titleOf(id) { return has(id) ? DIAGRAMS[id].title : ""; }
  function soundFor(zoneId) {
    for (var i = 0; i < AUSC.length; i++) if (AUSC[i].id === zoneId) return AUSC[i].sound;
    for (var j = 0; j < PRECORDIAL.length; j++) if (PRECORDIAL[j].id === zoneId) return PRECORDIAL[j].sound;
    for (var k = 0; k < CARDIAC_AREAS.length; k++) if (CARDIAC_AREAS[k].id === zoneId) return CARDIAC_AREAS[k].sound;
    return null;
  }

  var API = {
    DIAGRAMS: DIAGRAMS,
    ATLAS_IMAGES: ATLAS_IMAGES,
    ZONES: ZONES,
    AUSC: AUSC,
    PRECORDIAL: PRECORDIAL,
    CARDIAC_AREAS: CARDIAC_AREAS,
    JVP_POINTS: JVP_POINTS,
    GAZE_POSITIONS: GAZE_POSITIONS,
    DERMATOMES: DERMATOMES,
    SENSORY_LEVELS: SENSORY_LEVELS,
    has: has,
    hasAtlas: hasAtlas,
    getAtlas: getAtlas,
    render: render,
    titleOf: titleOf,
    soundFor: soundFor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_DIAGRAMS = API;
})();
