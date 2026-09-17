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
    "diagram.dermatomes":    { title: "Dermatome & Reflex Landmarks", render: dermatomeMap, interactive: true }
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

  var API = { DIAGRAMS: DIAGRAMS, ZONES: ZONES, AUSC: AUSC, PRECORDIAL: PRECORDIAL, DERMATOMES: DERMATOMES, has: has, render: render, titleOf: titleOf, soundFor: soundFor };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_DIAGRAMS = API;
})();
