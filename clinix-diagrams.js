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

  /* ORIENTATION. Every body diagram in this file is drawn in the EXAMINER'S view: you are standing
   * at the foot of the bed looking at the patient, so the PATIENT'S RIGHT is on the VIEWER'S LEFT.
   * That is the radiograph convention and the one a student has to hold in their head at the
   * bedside. A mirrored diagram teaches them to reach for the wrong side, and it is the kind of
   * error that reads as correct until you name the sides out loud - so `side` is stated on every
   * zone and asserted by test/clinix-diagrams.test.mjs in BOTH directions.
   *
   * ORDER. Percussion and auscultation both start on the PATIENT'S RIGHT and alternate across at
   * matched levels, because that is where the examiner stands. They used to start on opposite
   * sides, which taught two different sweeps for the same chest. */
  var ZONES = [
    { id: "apexR", side: "right", cx: 118, cy: 46, n: 1, label: "Right apex", finding: "Hyperresonant. Percuss the clavicle directly here." },
    { id: "apexL", side: "left", cx: 202, cy: 46, n: 2, label: "Left apex", finding: "Hyperresonant, and equal to the right. It is the COMPARISON that matters, not the note alone." },
    { id: "upperR", side: "right", cx: 112, cy: 88, n: 3, label: "Right upper zone", finding: "Hyperresonant." },
    { id: "upperL", side: "left", cx: 208, cy: 88, n: 4, label: "Left upper zone", finding: "Hyperresonant and symmetrical." },
    { id: "midR", side: "right", cx: 108, cy: 128, n: 5, label: "Right mid zone", finding: "Hyperresonant." },
    { id: "midL", side: "left", cx: 212, cy: 128, n: 6, label: "Left mid zone", finding: "In COPD the cardiac dullness that should be here is LOST, because hyperinflated lung has expanded over the heart." },
    { id: "lowerR", side: "right", cx: 112, cy: 170, n: 7, label: "Right base", finding: "Hyperresonant, and the liver dullness is pushed DOWN to about the seventh space." },
    { id: "lowerL", side: "left", cx: 208, cy: 170, n: 8, label: "Left base", finding: "Hyperresonant. STONY dullness here would mean an effusion, not COPD." }
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
        // The 17px stand-off must follow the direction of the pair. Fixed +17/-17 draws the line
        // back out across both circles as soon as a pair runs right to left on screen.
        var dp = ZONES[i + 1].cx > z.cx ? 17 : -17;
        html += '<path class="cx-dia-cmp" d="M' + (z.cx + dp) + " " + z.cy + " L" + (ZONES[i + 1].cx - dp) + " " + ZONES[i + 1].cy + '"/>';
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
   * in prose. Toggling between anchored and floating shows exactly what is lost. */
  function expansion(o) {
    var mode = (o && o.mode) || "float";           // float | anchored
    var anchored = mode === "anchored";
    return '<svg class="cx-dia cx-dia--anim ' + (anchored ? "cx-dia--anchored" : "cx-dia--float") +
        '" viewBox="0 0 340 210" role="img" aria-label="Chest expansion with thumbs floating compared with anchored">' +
      // chest, animated widening on inspiration
      '<ellipse class="cx-dia-chest" cx="170" cy="105" rx="86" ry="66"/>' +
      // hands gripping the sides
      '<path class="cx-dia-hand" d="M52 78 C68 92 68 118 52 132 L28 132 L28 78 Z"/>' +
      '<path class="cx-dia-hand" d="M288 78 C272 92 272 118 288 132 L312 132 L312 78 Z"/>' +
      // thumbs meeting at the midline
      '<g class="cx-dia-thumbL"><path class="cx-dia-thumb" d="M96 104 L166 104 L166 114 L96 114 Z"/></g>' +
      '<g class="cx-dia-thumbR"><path class="cx-dia-thumb" d="M244 104 L174 104 L174 114 L244 114 Z"/></g>' +
      '<line class="cx-dia-mid" x1="170" y1="40" x2="170" y2="176"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="150" y="34">midline</text>' +
      (anchored
        ? '<text class="cx-dia-lbl cx-dia-lbl--bad" x="90" y="196">Thumbs ANCHORED: they travel with the skin. The gap never opens. The sign is invisible.</text>'
        : '<text class="cx-dia-lbl cx-dia-lbl--normal" x="86" y="196">Thumbs FLOATING: free of the wall, so they separate and you can measure the movement.</text>') +
      "</svg>" +
      '<div class="cx-dia-toggle">' + btn("cx-dia-mode", "float", "Thumbs floating", !anchored) +
        btn("cx-dia-mode", "anchored", "Thumbs anchored", anchored) + "</div>" +
      '<div class="cx-dia-note">' + (anchored
        ? "This is the commonest technical error in the whole respiratory examination. Anchored thumbs move with the chest wall, so asymmetry cannot appear no matter how badly one side is lagging."
        : "Lift the thumbs clear of the chest wall before you ask for a deep breath. Watch how far each travels from the midline, and compare the two sides.") + "</div>";
  }

  /* ── 6. Auscultation sites (interactive, and it plays the sound) ─────────── */

  var AUSC = [
    { id: "a1", side: "right", cx: 120, cy: 44, n: 1, label: "Right apex", sound: "vesicular", note: "Vesicular. Compare immediately with the left apex." },
    { id: "a2", side: "left", cx: 200, cy: 44, n: 2, label: "Left apex", sound: "vesicular", note: "Vesicular, and equal to the right." },
    { id: "a3", side: "right", cx: 112, cy: 92, n: 3, label: "Right upper", sound: "reduced", note: "In COPD, symmetrically REDUCED with a prolonged expiratory phase." },
    { id: "a4", side: "left", cx: 208, cy: 92, n: 4, label: "Left upper", sound: "reduced", note: "Reduced, matching the right. Symmetry is the point." },
    { id: "a5", side: "right", cx: 108, cy: 136, n: 5, label: "Right mid", sound: "wheeze", note: "Polyphonic expiratory wheeze: many notes at once, diffuse airflow obstruction." },
    { id: "a6", side: "left", cx: 212, cy: 136, n: 6, label: "Left mid", sound: "wheeze", note: "Wheeze here too. Diffuse, not localised." },
    { id: "a7", side: "right", cx: 114, cy: 176, n: 7, label: "Right base", sound: "coarse", note: "Early COARSE crackles from secretions. Ask for a cough and listen again." },
    { id: "a8", side: "left", cx: 206, cy: 176, n: 8, label: "Left base", sound: "coarse", note: "Coarse crackles, shifting after a cough. That shift is what makes them secretions." }
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
        var da = AUSC[i + 1].cx > z.cx ? 17 : -17;
        html += '<path class="cx-dia-cmp" d="M' + (z.cx + da) + " " + z.cy + " L" + (AUSC[i + 1].cx - da) + " " + AUSC[i + 1].cy + '"/>';
      }
    }
    html += "</svg>";
    var chosen = null;
    for (i = 0; i < AUSC.length; i++) if (AUSC[i].id === sel) chosen = AUSC[i];
    html += '<div class="cx-dia-note">' + (chosen
      ? "<b>" + esc(chosen.label) + "</b> " + esc(chosen.note) + '<span class="cx-dia-playing">playing: ' + esc(chosen.sound) + "</span>"
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

  function clubbing(o) {
    var view = (o && o.view) || "both";
    var dn = view === "clubbed" ? ' class="cx-dia-dim"' : "";
    var dc = view === "normal" ? ' class="cx-dia-dim"' : "";
    return '<svg class="cx-dia" viewBox="0 0 340 210" role="img" aria-label="Nail fold angle and the Schamroth window">' +
      '<g' + dn + '><text class="cx-dia-lbl cx-dia-lbl--normal" x="16" y="18">Normal</text>' +
        '<path class="cx-dia-finger-s" d="M16 84 L96 84 C112 84 122 92 122 102 C122 112 112 118 96 118 L16 118 Z"/>' +
        '<path class="cx-dia-nail" d="M52 84 C74 82 96 84 108 90"/>' +
        '<path class="cx-dia-angle" d="M40 84 L52 84"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--mute" x="16" y="140">Angle about 160 degrees.</text>' +
        '<path class="cx-dia-window" d="M150 60 L162 46 L174 60 L162 74 Z"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--normal" x="140" y="94">diamond present</text></g>' +
      '<line class="cx-dia-div" x1="176" y1="130" x2="176" y2="130"/>' +
      '<g' + dc + '><text class="cx-dia-lbl cx-dia-lbl--copd" x="16" y="168">Clubbed</text>' +
        '<path class="cx-dia-finger-s" d="M16 176 L88 176 C112 172 128 182 128 194 C128 206 108 210 88 208 L16 208 Z"/>' +
        '<path class="cx-dia-nail cx-dia-nail--club" d="M48 174 C74 166 104 172 120 186"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--copd" x="140" y="182">Angle lost or reversed,</text>' +
        '<text class="cx-dia-lbl cx-dia-lbl--copd" x="140" y="196">nail bed boggy,</text>' +
        '<text class="cx-dia-lbl cx-dia-lbl--copd" x="140" y="210">diamond obliterated.</text></g>' +
      "</svg>" +
      '<div class="cx-dia-toggle">' + btn("cx-dia-view", "normal", "Normal", view === "normal") +
        btn("cx-dia-view", "clubbed", "Clubbed", view === "clubbed") +
        btn("cx-dia-view", "both", "Compare", view === "both") + "</div>" +
      '<div class="cx-dia-note">Look from the SIDE at eye level, not from above. Clubbing is <b>not</b> a feature of COPD: finding it means you have found a second diagnosis.</div>';
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
    { id: "rhyp", side: "right", cx: 84, cy: 60, label: "Right hypochondrium", organs: "Liver, gallbladder, right kidney" },
    { id: "epig", side: "mid", cx: 170, cy: 60, label: "Epigastrium", organs: "Stomach, pancreas, duodenum, aorta" },
    { id: "lhyp", side: "left", cx: 256, cy: 60, label: "Left hypochondrium", organs: "Spleen, splenic flexure, left kidney" },
    { id: "rlum", side: "right", cx: 84, cy: 140, label: "Right lumbar", organs: "Ascending colon, right kidney" },
    { id: "umb", side: "mid", cx: 170, cy: 140, label: "Umbilical", organs: "Small bowel, aorta, para-aortic nodes" },
    { id: "llum", side: "left", cx: 256, cy: 140, label: "Left lumbar", organs: "Descending colon, left kidney" },
    { id: "riif", side: "right", cx: 84, cy: 220, label: "Right iliac fossa", organs: "Caecum, appendix" },
    { id: "hyp", side: "mid", cx: 170, cy: 220, label: "Hypogastrium", organs: "Bladder, uterus (if enlarged)" },
    { id: "liif", side: "left", cx: 256, cy: 220, label: "Left iliac fossa", organs: "Sigmoid colon" }
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
      // EXAMINER'S VIEW (see the ORIENTATION note above ZONES): the patient's right upper quadrant,
      // and so the liver, sits on the VIEWER'S LEFT - the same side it has in abdRegions().
      '<path class="cx-dia-liver" d="M160 76 C110 70 60 78 44 96 L44 130 C80 118 130 116 158 126 Z"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="86" y="100">liver</text>' +
      '<g class="cx-dia-liverhands">' +
        '<path class="cx-dia-hand" d="M180 150 L44 150 L38 162 L186 162 Z"/>' +
        '<text class="cx-dia-lbl cx-dia-lbl--normal" x="20" y="192">both hands flat, fingers towards the ribs</text>' +
      "</g>" +
      '<path class="cx-dia-press" d="M112 178 L112 168" marker-end="url(#cxArrow)"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="320" y="200" text-anchor="end">ask for a deep breath;</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="320" y="212" text-anchor="end">the edge meets the fingertips</text>' +
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
      // EXAMINER'S VIEW: the spleen lies in the patient's LEFT upper quadrant, which is the VIEWER'S
      // RIGHT, and it enlarges across the midline towards the right iliac fossa on the VIEWER'S LEFT.
      '<circle class="cx-dia-alv" cx="220" cy="60" r="16"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="196" y="40" text-anchor="end">normal spleen,</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="196" y="54" text-anchor="end">tucked under the ribs</text>' +
      '<path class="cx-dia-spleenpath" d="M220 60 C190 100 150 140 110 172"/>' +
      '<circle class="cx-dia-air cx-dia-air--trapped" cx="110" cy="172" r="10"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="26" y="190">enlarges towards</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--copd" x="26" y="202">the right iliac fossa</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="180" y="146">sweep the palpating hand</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="180" y="160">diagonally along this line</text>' +
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
      '<path class="cx-dia-heart-bg" d="M152 64 C132 64 126 96 136 126 C146 156 186 172 212 160 C232 148 228 112 216 88 C204 68 174 64 152 64 Z" fill="var(--cx-primary-2)" opacity="0.14" stroke="var(--cx-line)" stroke-dasharray="3 3"/>' +
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

  var CRANIAL_NERVES = [
    { id: "cn1", num: "I", name: "Olfactory", type: "Sensory", exit: "Cribriform plate", test: "Smell identification (coffee, vanilla) one nostril at a time with eyes closed", lesion: "Anosmia (head trauma, Kallmann, Parkinson's, frontal meningioma)" },
    { id: "cn2", num: "II", name: "Optic", type: "Sensory", exit: "Optic canal", test: "Visual acuity (Snellen), visual fields (confrontation), fundoscopy, pupillary light reflex (afferent)", lesion: "Monocular vision loss, bitemporal hemianopia (chiasm), homonymous hemianopia (tract/radiations)" },
    { id: "cn3", num: "III", name: "Oculomotor", type: "Motor", exit: "Superior orbital fissure", test: "Eye movements (SR, IR, MR, IO), eyelid elevation (levator), pupil constriction (efferent)", lesion: "Ptosis, 'down-and-out' eye position, fixed dilated pupil (blown pupil in uncal herniation)" },
    { id: "cn4", num: "IV", name: "Trochlear", type: "Motor", exit: "Superior orbital fissure", test: "Superior oblique: moves eye downwards and inwards", lesion: "Vertical diplopia, head tilt away from lesion side, difficulty walking downstairs" },
    { id: "cn5", num: "V", name: "Trigeminal", type: "Both", exit: "Superior orbital fissure (V1), Rotundum (V2), Ovale (V3)", test: "Facial pinprick/cotton (V1 ophthalmic, V2 maxillary, V3 mandibular), corneal reflex (afferent), jaw clench (masseters)", lesion: "Facial numbness, absent corneal reflex, jaw deviates TOWARDS weak pterygoid side" },
    { id: "cn6", num: "VI", name: "Abducens", type: "Motor", exit: "Superior orbital fissure", test: "Lateral rectus: abducts the eye laterally", lesion: "Inability to abduct eye past midline, horizontal diplopia looking towards lesion side. Long intracranial course makes it a false localising sign in raised ICP!" },
    { id: "cn7", num: "VII", name: "Facial", type: "Both", exit: "Internal acoustic meatus -> Stylomastoid foramen", test: "Facial expression: raise eyebrows, squeeze eyes shut, puff cheeks, show teeth; taste anterior 2/3 tongue", lesion: "Bell's palsy (LMN: entire ipsilateral face paralyzed including forehead) vs Stroke (UMN: forehead spared due to bilateral cortical innervation!)" },
    { id: "cn8", num: "VIII", name: "Vestibulocochlear", type: "Sensory", exit: "Internal acoustic meatus", test: "Whisper voice test, Rinne tuning fork test (air > bone normal), Weber test (lateralization)", lesion: "Sensorineural hearing loss, tinnitus, vertigo, horizontal-torsional nystagmus" },
    { id: "cn9", num: "IX", name: "Glossopharyngeal", type: "Both", exit: "Jugular foramen", test: "Gag reflex (afferent sensory limb with cotton tip on posterior pharynx), taste posterior 1/3 tongue", lesion: "Loss of gag reflex sensation, dysphagia, glossopharyngeal neuralgia" },
    { id: "cn10", num: "X", name: "Vagus", type: "Both", exit: "Jugular foramen", test: "Inspect uvula on phonation ('say ahh'), gag reflex (efferent motor limb), swallow test, voice quality", lesion: "Uvula deviates to the NORMAL (contralateral) side; hoarse voice (recurrent laryngeal nerve palsy), bovine cough" },
    { id: "cn11", num: "XI", name: "Spinal Accessory", type: "Motor", exit: "Jugular foramen", test: "Turn head against resistance (sternocleidomastoid), shrug shoulders against resistance (trapezius)", lesion: "Weakness turning head to OPPOSITE side (SCM turns head contralaterally!), shoulder droop" },
    { id: "cn12", num: "XII", name: "Hypoglossal", type: "Motor", exit: "Hypoglossal canal", test: "Inspect tongue on floor of mouth (atrophy, fasciculations), protrude tongue straight out", lesion: "Tongue deviates TOWARDS the side of the lesion ('lick the wound' due to unopposed action of normal genioglossus)" }
  ];

  function cranialMap(o) {
    var sel = (o && o.selected) || "cn7";
    var chosen = CRANIAL_NERVES[6];
    for (var i = 0; i < CRANIAL_NERVES.length; i++) if (CRANIAL_NERVES[i].id === sel) chosen = CRANIAL_NERVES[i];

    var html = '<div class="cx-dia-toggle" style="flex-wrap:wrap; margin-bottom:8px;">';
    for (var j = 0; j < CRANIAL_NERVES.length; j++) {
      var n = CRANIAL_NERVES[j];
      html += btn("cx-dia-zone", n.id, n.num, sel === n.id);
    }
    html += '</div>';

    html += '<svg class="cx-dia cx-dia--cranial" viewBox="0 0 340 160" role="img" aria-label="Cranial Nerve Functional Map">' +
      '<rect x="20" y="20" width="300" height="120" rx="10" fill="var(--cx-surface)" stroke="var(--cx-line)"/>' +
      '<circle cx="65" cy="80" r="30" fill="var(--cx-primary-soft)" stroke="var(--cx-primary)" stroke-width="2"/>' +
      '<text class="cx-dia-lbl" x="65" y="86" text-anchor="middle" font-size="20" font-weight="700" fill="var(--cx-primary)">' + esc(chosen.num) + '</text>' +
      '<text class="cx-dia-lbl" x="110" y="52" font-size="15" font-weight="700" fill="var(--cx-ink)">CN ' + esc(chosen.num) + ': ' + esc(chosen.name) + '</text>' +
      '<text class="cx-dia-lbl" x="110" y="74" font-size="12" fill="var(--cx-teach)">Functional Type: ' + esc(chosen.type) + '</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="110" y="94" font-size="11.5">Exit: ' + esc(chosen.exit) + '</text>' +
      '<path d="M65 50 C65 25 150 25 240 25" fill="none" stroke="var(--cx-primary)" stroke-width="1.5" stroke-dasharray="3 3"/>' +
      '</svg>';

    html += '<div class="cx-dia-note">' +
      '<b>Bedside Examination Test:</b><br>' + esc(chosen.test) + '<br><br>' +
      '<b>Pathognomonic Clinical Lesion:</b><br>' + esc(chosen.lesion) +
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

  var CEREBELLAR_ITEMS = [
    { id: "v", letter: "V", title: "Vertigo", test: "Hallpike maneuver, visual fixation suppression", pearl: "Vestibulocerebellar lesion. Vertigo worsens with head movement, associated with nausea." },
    { id: "a", letter: "A", title: "Ataxia", test: "Tandem walking (heel-to-toe), broad-based gait", pearl: "Truncal ataxia points to midline VERMIS lesion; appendicular limb ataxia points to ipsilateral HEMISPHERE." },
    { id: "n", letter: "N", title: "Nystagmus", test: "Follow finger horizontally and vertically", pearl: "Gaze-evoked horizontal nystagmus with fast component beating TOWARDS the side of the lesion." },
    { id: "i", letter: "I", title: "Intention Tremor", test: "Finger-to-nose test: touch doctor's finger, then own nose", pearl: "Tremor amplitude INCREASES dramatically as the finger reaches its target (kinetic/terminal tremor)." },
    { id: "s", letter: "S", title: "Slurred Speech", test: "Repeat 'Baby hippopotamus' or 'British constitution'", pearl: "Scanning / staccato dysarthria: words are broken into individual syllables with explosive, irregular emphasis." },
    { id: "h", letter: "H", title: "Hypotonia", test: "Pendular knee jerk: tap patellar tendon with legs hanging", pearl: "Normally leg swings 1-2 times; in cerebellar hypotonia, the lower leg swings back and forth like a pendulum 4+ times!" },
    { id: "e", letter: "E", title: "Extremity Dysmetria", test: "Heel-to-shin test: run heel smoothly down the opposite shin", pearl: "Past-pointing and overshoot: patient's heel repeatedly slips off the shin due to lack of distance calibration." },
    { id: "d", letter: "D", title: "Dysdiadochokinesia", test: "Rapid alternating pronation and supination of hands on thigh", pearl: "Inability to perform rapid alternating movements smoothly; clumsy, slow, arrhythmic slap-and-turn." }
  ];

  function cerebellumMap(o) {
    var sel = (o && o.selected) || "i";
    var chosen = CEREBELLAR_ITEMS[3];
    for (var i = 0; i < CEREBELLAR_ITEMS.length; i++) if (CEREBELLAR_ITEMS[i].id === sel) chosen = CEREBELLAR_ITEMS[i];

    var html = '<svg class="cx-dia cx-dia--cerebellum" viewBox="0 0 340 150" role="img" aria-label="Cerebellar Signs VANISHED Map">' +
      '<text class="cx-dia-lbl cx-dia-lbl--normal" x="14" y="20">Cerebellar Examination Mnemonic: VANISHED</text>' +
      '<path d="M40 50 Q170 20 300 50 Q310 110 240 135 Q170 145 100 135 Q30 110 40 50 Z" fill="rgba(14, 165, 233, 0.08)" stroke="#0ea5e9" stroke-width="2"/>' +
      '<line x1="170" y1="35" x2="170" y2="140" stroke="#0ea5e9" stroke-dasharray="3 3"/>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="170" y="80" text-anchor="middle" font-size="10">Vermis (Trunk/Gait)</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="100" y="90" text-anchor="middle" font-size="9.5">Left Hemisphere (Limb)</text>' +
      '<text class="cx-dia-lbl cx-dia-lbl--mute" x="240" y="90" text-anchor="middle" font-size="9.5">Right Hemisphere (Limb)</text>' +
      '</svg>';

    html += '<div class="cx-dia-toggle" style="flex-wrap:wrap; margin:8px 0;">';
    for (var j = 0; j < CEREBELLAR_ITEMS.length; j++) {
      var item = CEREBELLAR_ITEMS[j];
      html += btn("cx-dia-zone", item.id, item.letter + ": " + item.title, sel === item.id);
    }
    html += '</div>';

    html += '<div class="cx-dia-note">' +
      '<b>' + esc(chosen.letter) + ' — ' + esc(chosen.title) + '</b><br>' +
      '<b>How to Test at Bedside:</b> ' + esc(chosen.test) + '<br>' +
      '<b>Clinical Pearl:</b> ' + esc(chosen.pearl) + '<br><br>' +
      '<i>Golden Rule: Unlike cerebral lesions which are contralateral, cerebellar hemisphere lesions are always <b>IPSILATERAL</b> (same side as the signs)!</i>' +
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

  /* ── diagram: shifting dullness in ascites ───────────────────────────────── */
  function shiftingDullness(opts) {
    opts = opts || {};
    var mode = opts.mode || "supine";
    var html = '<svg viewBox="0 0 340 200" class="cx-dia-svg" role="img" aria-label="Shifting dullness and ascites mechanics">' +
      '<defs><linearGradient id="fluid-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35"/><stop offset="100%" stop-color="#1d4ed8" stop-opacity="0.6"/></linearGradient></defs>';

    if (mode === "supine") {
      html += '<path d="M50 110 C50 60 290 60 290 110 C290 150 50 150 50 110 Z" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="2.5"/>' +
        '<path d="M52 110 C60 145 100 148 100 148 L100 115 C80 115 52 112 52 110 Z" fill="url(#fluid-grad)" stroke="#2563eb" stroke-width="1.5"/>' +
        '<path d="M288 110 C280 145 240 148 240 148 L240 115 C260 115 288 112 288 110 Z" fill="url(#fluid-grad)" stroke="#2563eb" stroke-width="1.5"/>' +
        '<circle cx="170" cy="90" r="18" fill="rgba(245,158,11,0.25)" stroke="#f59e0b" stroke-width="2"/>' +
        '<circle cx="150" cy="102" r="13" fill="rgba(245,158,11,0.25)" stroke="#f59e0b" stroke-width="1.8"/>' +
        '<circle cx="190" cy="102" r="13" fill="rgba(245,158,11,0.25)" stroke="#f59e0b" stroke-width="1.8"/>' +
        '<text class="cx-dia-lbl" x="170" y="52" text-anchor="middle" font-size="10" font-weight="700" fill="#d97706">Umbilicus (Air-Filled Bowel Floats)</text>' +
        '<text class="cx-dia-lbl" x="170" y="65" text-anchor="middle" font-size="8.5" fill="#10b981">RESONANT</text>' +
        '<text class="cx-dia-lbl" x="65" y="165" text-anchor="middle" font-size="8.5" font-weight="700" fill="#2563eb">Left Flank DULL</text>' +
        '<text class="cx-dia-lbl" x="275" y="165" text-anchor="middle" font-size="8.5" font-weight="700" fill="#2563eb">Right Flank DULL</text>';
    } else {
      html += '<path d="M50 110 C50 60 290 60 290 110 C290 150 50 150 50 110 Z" transform="rotate(35 170 110)" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="2.5"/>' +
        '<path d="M120 160 C150 178 260 165 270 120 C250 125 180 135 120 160 Z" fill="url(#fluid-grad)" stroke="#2563eb" stroke-width="1.8"/>' +
        '<circle cx="115" cy="80" r="16" fill="rgba(245,158,11,0.25)" stroke="#f59e0b" stroke-width="2"/>' +
        '<circle cx="95" cy="92" r="12" fill="rgba(245,158,11,0.25)" stroke="#f59e0b" stroke-width="1.8"/>' +
        '<text class="cx-dia-lbl" x="90" y="55" text-anchor="middle" font-size="9.5" font-weight="700" fill="#10b981">Left Flank SHIFTED to RESONANT</text>' +
        '<text class="cx-dia-lbl" x="210" y="185" text-anchor="middle" font-size="9.5" font-weight="700" fill="#2563eb">Dependent Flank SHIFTED to DULL</text>';
    }

    html += '</svg>' +
      '<div class="cx-dia-toggle">' +
        btn("cx-dia-mode", "supine", "1. Patient Supine", mode === "supine") +
        btn("cx-dia-mode", "lateral", "2. Rolled onto Side (Wait 30s)", mode === "lateral") +
      '</div>' +
      '<div class="cx-dia-note">' +
      (mode === "supine"
        ? "<b>Patient Supine</b>: Gravity pulls heavy ascitic fluid down into the flanks (producing dull percussion bilaterally), while air-filled gas loops in bowel float to the highest point in the center (producing resonant percussion around umbilicus)."
        : "<b>Patient Rolled on Side</b>: When the patient rolls onto their side, gravity shifts all peritoneal fluid down to the dependent flank within 30 seconds. The previously dull upper flank is now occupied by floating bowel and becomes <b>resonant</b>! Percussing from the new resonant zone down to the new dullness proves shifting dullness (>500 mL fluid).") +
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
    "diagram.shiftingdullness": { title: "Ascites Mechanics: Shifting Dullness", render: shiftingDullness, interactive: true },
    "diagram.murphysign":    { title: "Murphy Sign & Gallbladder Anatomy", render: murphySign, interactive: true }
  };

  function has(id) { return Object.prototype.hasOwnProperty.call(DIAGRAMS, id); }
  function render(id, opts) {
    if (!has(id)) return "";
    try { return DIAGRAMS[id].render(opts || {}); } catch (e) { return ""; }
  }
  function titleOf(id) { return has(id) ? DIAGRAMS[id].title : ""; }
  function soundFor(zoneId) {
    for (var i = 0; i < AUSC.length; i++) if (AUSC[i].id === zoneId) return AUSC[i].sound;
    for (var j = 0; j < PRECORDIAL.length; j++) if (PRECORDIAL[j].id === zoneId) return PRECORDIAL[j].sound;
    return null;
  }

  var API = { DIAGRAMS: DIAGRAMS, ZONES: ZONES, AUSC: AUSC, ABD_REGIONS: ABD_REGIONS, PRECORDIAL: PRECORDIAL, DERMATOMES: DERMATOMES, has: has, render: render, titleOf: titleOf, soundFor: soundFor };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_DIAGRAMS = API;
})();
