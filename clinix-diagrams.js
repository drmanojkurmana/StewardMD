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
    "diagram.stemi":         { title: "STEMI evolution on serial ECGs", render: stemiEvolution }
  };

  function has(id) { return Object.prototype.hasOwnProperty.call(DIAGRAMS, id); }
  function render(id, opts) {
    if (!has(id)) return "";
    try { return DIAGRAMS[id].render(opts || {}); } catch (e) { return ""; }
  }
  function titleOf(id) { return has(id) ? DIAGRAMS[id].title : ""; }
  function soundFor(zoneId) {
    for (var i = 0; i < AUSC.length; i++) if (AUSC[i].id === zoneId) return AUSC[i].sound;
    return null;
  }

  var API = { DIAGRAMS: DIAGRAMS, ZONES: ZONES, AUSC: AUSC, has: has, render: render, titleOf: titleOf, soundFor: soundFor };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_DIAGRAMS = API;
})();
