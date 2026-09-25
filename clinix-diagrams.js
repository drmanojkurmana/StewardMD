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
    { id: "a1", cx: 120, cy: 44, n: 1, label: "Right apex", sound: "vesicular", note: "Vesicular. Compare immediately with the left apex." },
    { id: "a2", cx: 200, cy: 44, n: 2, label: "Left apex", sound: "vesicular", note: "Vesicular, and equal to the right." },
    { id: "a3", cx: 112, cy: 92, n: 3, label: "Right upper", sound: "reduced", note: "In COPD, symmetrically REDUCED with a prolonged expiratory phase." },
    { id: "a4", cx: 208, cy: 92, n: 4, label: "Left upper", sound: "reduced", note: "Reduced, matching the right. Symmetry is the point." },
    { id: "a5", cx: 108, cy: 136, n: 5, label: "Right mid", sound: "wheeze", note: "Polyphonic expiratory wheeze: many notes at once, diffuse airflow obstruction." },
    { id: "a6", cx: 212, cy: 136, n: 6, label: "Left mid", sound: "wheeze", note: "Wheeze here too. Diffuse, not localised." },
    { id: "a7", cx: 114, cy: 176, n: 7, label: "Right base", sound: "coarse", note: "Early COARSE crackles from secretions. Ask for a cough and listen again." },
    { id: "a8", cx: 206, cy: 176, n: 8, label: "Left base", sound: "coarse", note: "Coarse crackles, shifting after a cough. That shift is what makes them secretions." }
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

    html += '<path class="cx-dia-cardiac" d="M156 80 C190 75 220 100 226 140 C230 165 240 180 236 186 C215 198 175 190 156 168 Z" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="1.5" stroke-dasharray="4 3"/>';

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

  function facialPalsy(o) {
    var mode = (o && o.mode) || "umn"; // normal | umn | lmn
    var html = '<svg class="cx-dia" viewBox="0 0 340 240" role="img" aria-label="UMN vs LMN facial palsy mechanism and forehead sparing">';

    html += '<rect class="cx-dia-skin" x="10" y="10" width="320" height="220" rx="10"/>';

    html += '<rect class="cx-dia-organ" x="60" y="24" width="80" height="34" rx="6"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="100" y="44" text-anchor="middle">R Cortex</text>';
    html += '<rect class="cx-dia-organ" x="200" y="24" width="80" height="34" rx="6"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="240" y="44" text-anchor="middle">L Cortex</text>';

    html += '<path d="M100 58 L150 110 M240 58 L190 110" stroke="var(--cx-primary)" stroke-width="2" fill="none"/>';
    html += '<path d="M100 58 L190 125 M240 58 L150 125" stroke="var(--cx-teach)" stroke-width="2" fill="none"/>';

    html += '<rect class="cx-dia-organ" x="135" y="102" width="70" height="36" rx="6"/>';
    html += '<text class="cx-dia-lbl cx-dia-lbl--mute" x="170" y="124" text-anchor="middle">Pons (VII Nucleus)</text>';

    if (mode === "umn") {
      html += '<path d="M90 64 L110 84 M110 64 L90 84" stroke="var(--cx-bad)" stroke-width="3"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="35" y="76">UMN Lesion (Stroke)</text>';
    } else if (mode === "lmn") {
      html += '<path d="M195 136 L215 156 M215 136 L195 156" stroke="var(--cx-bad)" stroke-width="3"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="235" y="146">LMN Lesion (Bell\'s)</text>';
    }

    html += '<path d="M150 138 L90 168 M190 138 L250 168" stroke="var(--cx-ink)" stroke-width="2" fill="none"/>';

    html += '<circle cx="170" cy="192" r="34" fill="var(--cx-surface)" stroke="var(--cx-line)" stroke-width="1.5"/>';

    if (mode === "lmn") {
      html += '<line x1="150" y1="172" x2="162" y2="172" stroke="var(--cx-line)" stroke-width="1.5"/>';
      html += '<line x1="150" y1="176" x2="162" y2="176" stroke="var(--cx-line)" stroke-width="1.5"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="215" y="174">Wrinkles LOST</text>';
    } else {
      html += '<line x1="150" y1="172" x2="162" y2="172" stroke="var(--cx-line)" stroke-width="1.5"/>';
      html += '<line x1="178" y1="172" x2="190" y2="172" stroke="var(--cx-line)" stroke-width="1.5"/>';
      html += '<line x1="150" y1="176" x2="162" y2="176" stroke="var(--cx-line)" stroke-width="1.5"/>';
      html += '<line x1="178" y1="176" x2="190" y2="176" stroke="var(--cx-line)" stroke-width="1.5"/>';
      if (mode === "umn") {
        html += '<text class="cx-dia-lbl cx-dia-lbl--normal" x="170" y="165" text-anchor="middle">FOREHEAD SPARED</text>';
      }
    }

    if (mode === "lmn") {
      html += '<circle cx="156" cy="186" r="3" class="cx-dia-pupil"/>';
      html += '<ellipse cx="184" cy="186" rx="5" ry="3" fill="none" stroke="var(--cx-teach)" stroke-width="1.5"/>';
      html += '<circle cx="184" cy="184" r="2" fill="var(--cx-muted)"/>';
    } else {
      html += '<circle cx="156" cy="186" r="3" class="cx-dia-pupil"/>';
      html += '<circle cx="184" cy="186" r="3" class="cx-dia-pupil"/>';
    }

    if (mode === "normal") {
      html += '<path d="M158 210 Q170 218 182 210" stroke="var(--cx-primary)" stroke-width="2" fill="none"/>';
    } else {
      html += '<path d="M158 208 Q170 212 184 218" stroke="var(--cx-bad)" stroke-width="2" fill="none"/>';
      html += '<text class="cx-dia-lbl cx-dia-lbl--bad" x="215" y="215">Mouth droop</text>';
    }

    html += '</svg>';

    html += '<div class="cx-dia-toggle">' +
      btn("cx-dia-mode", "normal", "Normal", mode === "normal") +
      btn("cx-dia-mode", "umn", "UMN (Stroke: Forehead Spared)", mode === "umn") +
      btn("cx-dia-mode", "lmn", "LMN (Bell\'s: Forehead Lost)", mode === "lmn") +
      '</div>';

    html += '<div class="cx-dia-note">' + (mode === "umn"
      ? '<b>Upper Motor Neuron Lesion (e.g. Stroke):</b> The upper facial nucleus receives <b>bilateral</b> cortical innervation. The uninjured hemisphere still drives the forehead, so forehead wrinkling and eye closure are <b>SPARED</b>. Weakness is confined to the contralateral lower face.'
      : (mode === "lmn"
        ? '<b>Lower Motor Neuron Lesion (e.g. Bell\'s Palsy):</b> The final common peripheral pathway is transected or inflamed. The <b>ENTIRE ipsilateral hemiface is paralyzed</b>: forehead wrinkles are wiped out, the eye cannot close (Bell\'s phenomenon), and the corner of the mouth droops.'
        : 'Compare the wiring: bilateral supranuclear supply to the forehead vs strictly contralateral supranuclear supply to the mouth.')) + '</div>';

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

  var DERMATOMES = [
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

    for (var i = 0; i < DERMATOMES.length; i++) {
      var d = DERMATOMES[i], on = sel === d.id;
      html += '<g class="cx-dia-zone cx-dia-zone--derm' + (on ? " cx-dia-zone--on" : "") + '" data-act="cx-dia-zone" data-id="' + d.id + '" role="button" tabindex="0" aria-label="' + esc(d.label) + '">' +
        '<circle cx="' + d.cx + '" cy="' + d.cy + '" r="12"/>' +
        '<text x="' + d.cx + '" y="' + (d.cy + 3.5) + '" text-anchor="middle" font-size="9" font-weight="700">' + d.label + '</text></g>';
    }

    html += '</svg>';

    var chosen = null;
    for (i = 0; i < DERMATOMES.length; i++) if (DERMATOMES[i].id === sel) chosen = DERMATOMES[i];
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
    "diagram.jvpwave":       { title: "JVP waveform and mechanical events", render: jvpWave, interactive: true },
    "diagram.auscultareas":  { title: "Cardiac auscultation areas and murmur radiation", render: auscultAreas, interactive: true, audio: true },
    "diagram.cngaze":        { title: "Cranial nerves III, IV, VI cardinal gazes", render: cnGaze, interactive: true },
    "diagram.facialpalsy":   { title: "UMN vs LMN facial palsy (forehead sparing)", render: facialPalsy, interactive: true },
    "diagram.shiftingdullness": { title: "Ascites: shifting dullness and fluid thrill", render: shiftingDullness, interactive: true },
    "diagram.sensorylevel":  { title: "Spinal cord sensory levels & dermatomes", render: sensoryLevel, interactive: true }
  };

  function has(id) { return Object.prototype.hasOwnProperty.call(DIAGRAMS, id); }
  function render(id, opts) {
    if (!has(id)) return "";
    try { return DIAGRAMS[id].render(opts || {}); } catch (e) { return ""; }
  }
  function titleOf(id) { return has(id) ? DIAGRAMS[id].title : ""; }
  function soundFor(zoneId) {
    for (var i = 0; i < AUSC.length; i++) if (AUSC[i].id === zoneId) return AUSC[i].sound;
    for (var j = 0; j < CARDIAC_AREAS.length; j++) if (CARDIAC_AREAS[j].id === zoneId) return CARDIAC_AREAS[j].sound;
    return null;
  }

  var API = {
    DIAGRAMS: DIAGRAMS,
    ZONES: ZONES,
    AUSC: AUSC,
    CARDIAC_AREAS: CARDIAC_AREAS,
    JVP_POINTS: JVP_POINTS,
    GAZE_POSITIONS: GAZE_POSITIONS,
    DERMATOMES: DERMATOMES,
    has: has,
    render: render,
    titleOf: titleOf,
    soundFor: soundFor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_DIAGRAMS = API;
})();
