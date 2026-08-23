/* surgx-diagrams.js — SURGX · self-authored inline SVG diagrams.
 * ===========================================================================
 * The licence gate means externally sourced media cannot ship until it is verified, so this is the
 * one kind of media SURGX can honestly clear on day one: we drew it, so `cleared: true` with
 * licence "StewardMD original work" is true rather than three fields somebody typed.
 *
 * Inline rather than <img> for three reasons, all of which matter here:
 *   - they inherit #surgxRoot's --sgx-* custom properties, so light, dark and every accent theme
 *     work with no extra asset and no second file;
 *   - they carry no bytes in the app download, which matters when assets/kardiox-learn/ is already
 *     176 MB of the install;
 *   - each one is a MECHANISM that prose conveys badly. A sentence can say the taeniae converge on
 *     the appendix base; a picture shows you how to use that at the table.
 *
 * Every diagram is drawn on a 0 0 400 260 viewBox, uses currentColor and the --sgx-* tokens, and
 * carries a <title> for screen readers. No animation: this is a surgical reference, not a toy.
 *
 * window.SMD_SURGX_DIAGRAMS.get(id) -> svg string, or "" for an unknown id.
 */
(function () {
  "use strict";

  var VB = 'viewBox="0 0 400 260" role="img" preserveAspectRatio="xMidYMid meet"';
  var S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  function wrap(title, body) {
    return '<svg ' + VB + ' aria-label="' + title + '" style="color:var(--sgx-ink)">' +
      "<title>" + title + "</title>" +
      '<g ' + S + ">" + body + "</g></svg>";
  }
  function label(x, y, t, opts) {
    opts = opts || {};
    return '<text x="' + x + '" y="' + y + '" fill="' + (opts.fill || "currentColor") +
      '" stroke="none" font-size="' + (opts.size || 11) + '" font-weight="' + (opts.weight || 600) +
      '" font-family="var(--sgx-sans, system-ui)"' + (opts.anchor ? ' text-anchor="' + opts.anchor + '"' : "") +
      ">" + t + "</text>";
  }
  function num(cx, cy, n) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="10" fill="var(--sgx-steel)" stroke="none"/>' +
      '<text x="' + cx + '" y="' + (cy + 4) + '" fill="#fff" stroke="none" font-size="11" font-weight="700" ' +
      'text-anchor="middle" font-family="var(--sgx-mono, monospace)">' + n + "</text>";
  }
  var STEEL = "var(--sgx-steel)";
  var BAD = "var(--sgx-bad)";
  var MUTED = "var(--sgx-muted)";

  var D = {};

  /* ── Finding the appendix: the taeniae converge on the base ───────────────── */
  D.appendixAnatomy = function () {
    return wrap("Finding the appendix by following a taenia coli to the convergence at its base",
      // caecum
      '<path d="M120 60 C 90 70, 78 110, 88 150 C 96 186, 130 200, 165 194 C 196 189, 210 160, 208 130 L 208 70"/>' +
      // ascending colon continuation
      '<path d="M208 70 C 208 52, 224 44, 244 44 L 300 44"/>' +
      // terminal ileum
      '<path d="M208 130 C 240 120, 268 128, 296 148"/>' +
      // three taeniae converging
      '<path d="M300 50 C 250 56, 200 72, 150 118" stroke="' + STEEL + '" stroke-width="2.4"/>' +
      '<path d="M112 78 C 118 100, 128 112, 150 118" stroke="' + STEEL + '" stroke-width="2.4"/>' +
      '<path d="M100 152 C 116 142, 134 128, 150 118" stroke="' + STEEL + '" stroke-width="2.4"/>' +
      // the appendix itself
      '<path d="M150 118 C 146 148, 138 176, 118 200" stroke="' + BAD + '" stroke-width="3"/>' +
      '<circle cx="150" cy="118" r="5" fill="' + BAD + '" stroke="none"/>' +
      label(304, 42, "Taenia coli", { fill: STEEL }) +
      label(300, 165, "Terminal ileum", { fill: MUTED }) +
      label(60, 200, "Caecum", { fill: MUTED }) +
      label(96, 224, "Appendix", { fill: BAD }) +
      label(158, 108, "BASE - the convergence", { fill: BAD, size: 10, weight: 700 }) +
      label(16, 246, "Follow any one taenia distally. Where all three meet is the base, whatever the tip is doing.", { fill: MUTED, size: 9.5, weight: 500 })
    );
  };

  /* ── The hepatocystic (Calot) triangle, and why traction direction matters ── */
  D.calotTriangle = function () {
    return wrap("The hepatocystic triangle and the effect of traction direction on the cystic duct",
      // liver edge
      '<path d="M40 44 C 140 30, 260 34, 360 52" stroke="' + MUTED + '"/>' +
      label(44, 34, "Inferior border of liver", { fill: MUTED, size: 9.5, weight: 500 }) +
      // gallbladder
      '<path d="M96 78 C 70 96, 66 140, 88 166 C 110 190, 148 184, 158 154 C 166 130, 158 104, 146 90 Z"/>' +
      label(84, 132, "GB", { size: 11, weight: 700 }) +
      // cystic duct (correct, lateral traction)
      '<path d="M158 118 C 196 116, 218 128, 236 146" stroke="' + STEEL + '" stroke-width="2.6"/>' +
      label(180, 108, "Cystic duct", { fill: STEEL, size: 10 }) +
      // common hepatic / common bile duct
      '<path d="M236 60 L 236 146 L 236 216" stroke="currentColor" stroke-width="3"/>' +
      label(244, 74, "Common hepatic duct", { size: 10 }) +
      label(244, 212, "Common bile duct", { size: 10 }) +
      // cystic artery
      '<path d="M164 100 C 196 96, 214 106, 226 120" stroke="' + BAD + '" stroke-width="2"/>' +
      label(170, 88, "Cystic artery", { fill: BAD, size: 9.5 }) +
      // the triangle, shaded by outline
      '<path d="M158 118 L 236 146 L 236 62 Z" stroke="' + STEEL + '" stroke-dasharray="4 4" stroke-width="1.6"/>' +
      // traction arrows
      '<path d="M112 74 L 104 50" stroke="' + MUTED + '"/><path d="M104 50 l -5 8 M104 50 l 7 6" stroke="' + MUTED + '"/>' +
      label(58, 46, "Fundus: cephalad", { fill: MUTED, size: 9.5, weight: 500 }) +
      '<path d="M158 152 L 196 170" stroke="' + STEEL + '"/><path d="M196 170 l -9 0 M196 170 l -4 -8" stroke="' + STEEL + '"/>' +
      label(196, 186, "Infundibulum: LATERAL, never up", { fill: STEEL, size: 9.5, weight: 700 }) +
      label(16, 246, "Cephalad traction on the infundibulum aligns the cystic duct with the common bile duct. That is the injury.", { fill: BAD, size: 9.5, weight: 500 })
    );
  };

  /* ── The Critical View of Safety: three criteria, all required ────────────── */
  D.criticalView = function () {
    return wrap("The three criteria of the Critical View of Safety",
      num(34, 54, "1") + label(54, 58, "Hepatocystic triangle cleared of fat and fibrous tissue", { size: 11 }) +
      '<path d="M56 74 L 372 74" stroke="var(--sgx-line)" stroke-width="1"/>' +
      num(34, 110, "2") + label(54, 114, "Lower third of gallbladder separated from the cystic plate", { size: 11 }) +
      '<path d="M56 130 L 372 130" stroke="var(--sgx-line)" stroke-width="1"/>' +
      num(34, 166, "3") + label(54, 170, "EXACTLY two structures seen entering the gallbladder", { size: 11 }) +
      // the two structures, drawn
      '<path d="M300 190 C 322 190, 336 198, 348 208" stroke="' + STEEL + '" stroke-width="2.6"/>' +
      '<path d="M300 174 C 324 174, 338 180, 348 188" stroke="' + BAD + '" stroke-width="2.2"/>' +
      '<path d="M254 166 C 236 180, 234 208, 252 224 C 272 240, 300 232, 302 208 C 303 192, 298 180, 292 172 Z"/>' +
      label(56, 200, "Two, and only two.", { fill: STEEL, size: 10, weight: 700 }) +
      label(56, 216, "Not 'nearly'. If it cannot be", { fill: BAD, size: 10, weight: 600 }) +
      label(56, 230, "achieved, take a bail-out.", { fill: BAD, size: 10, weight: 600 }) +
      label(16, 250, "The Critical View is a VIEW you confirm, not a manoeuvre you perform.", { fill: MUTED, size: 9.5, weight: 500 })
    );
  };

  /* ── Direct, indirect and femoral, defined by one landmark ────────────────── */
  D.inguinalCanal = function () {
    return wrap("Direct, indirect and femoral hernias defined by their relation to the inferior epigastric vessels",
      // inguinal ligament
      '<path d="M40 168 L 330 128" stroke="currentColor" stroke-width="3"/>' +
      label(40, 186, "Inguinal ligament", { size: 10 }) +
      // pubic tubercle
      '<circle cx="52" cy="166" r="6" fill="currentColor" stroke="none"/>' +
      label(20, 152, "Pubic tubercle", { size: 9.5, fill: MUTED, weight: 500 }) +
      // inferior epigastric vessels - THE landmark
      '<path d="M196 32 C 196 76, 190 112, 184 142" stroke="' + BAD + '" stroke-width="3"/>' +
      label(202, 40, "Inferior epigastric vessels", { fill: BAD, size: 10, weight: 700 }) +
      label(202, 54, "the dividing landmark", { fill: BAD, size: 9.5, weight: 500 }) +
      // deep ring - indirect, LATERAL
      '<circle cx="252" cy="112" r="15" stroke="' + STEEL + '" stroke-width="2.4" stroke-dasharray="3 3"/>' +
      label(238, 90, "Deep ring", { fill: STEEL, size: 9.5 }) +
      label(228, 148, "INDIRECT", { fill: STEEL, size: 10.5, weight: 700 }) +
      label(228, 162, "lateral, in the cord", { fill: MUTED, size: 9.5, weight: 500 }) +
      // Hesselbach - direct, MEDIAL
      '<path d="M64 162 L 176 146 L 128 96 Z" stroke="' + STEEL + '" stroke-width="2" stroke-dasharray="3 3"/>' +
      label(84, 130, "DIRECT", { fill: STEEL, size: 10.5, weight: 700 }) +
      label(70, 144, "medial, through the floor", { fill: MUTED, size: 9.5, weight: 500 }) +
      // femoral - BELOW the ligament
      '<path d="M118 176 C 108 196, 116 216, 136 218 C 156 220, 164 202, 156 184" stroke="' + BAD + '" stroke-width="2.4"/>' +
      '<circle cx="176" cy="182" r="9" stroke="' + MUTED + '" stroke-width="1.6"/>' +
      label(190, 186, "Femoral vein", { fill: MUTED, size: 9.5, weight: 500 }) +
      label(100, 238, "FEMORAL - below the ligament, medial to the vein. The one that strangulates.", { fill: BAD, size: 9.5, weight: 700 })
    );
  };

  /* ── The exploration sequence: the numbering IS the teaching ──────────────── */
  D.explorationSequence = function () {
    return wrap("The systematic laparotomy exploration sequence, numbered in order",
      // abdominal outline
      '<path d="M96 26 C 56 60, 44 130, 60 186 C 74 232, 130 246, 200 246 C 270 246, 326 232, 340 186 C 356 130, 344 60, 304 26 Z" stroke="var(--sgx-line)" stroke-width="2"/>' +
      // midline incision
      '<path d="M200 34 L 200 238" stroke="' + BAD + '" stroke-width="2" stroke-dasharray="6 5"/>' +
      num(140, 62, "1") + label(154, 66, "Liver, gallbladder", { size: 10 }) +
      num(268, 62, "2") + label(200, 90, "Stomach, duodenum, spleen, lesser sac", { size: 10 }) +
      num(200, 122, "3") + label(214, 126, "Small bowel, DJ flexure to caecum", { size: 10 }) +
      num(112, 162, "4") + label(126, 166, "Colon", { size: 10 }) +
      num(288, 162, "5") + label(224, 190, "Both paracolic gutters", { size: 10, anchor: "end" }) +
      num(200, 208, "6") + label(214, 212, "Pelvis, hernial orifices from inside", { size: 10 }) +
      label(16, 20, "Same sequence, every time.", { size: 10.5, weight: 700, fill: STEEL }) +
      label(16, 256, "Finish the survey even after you find the pathology. Second diagnoses are missed by stopping early.", { fill: MUTED, size: 9.5, weight: 500 })
    );
  };

  function get(id) {
    var fn = D[id];
    if (typeof fn !== "function") return "";
    try { return fn(); } catch (e) { return ""; }
  }
  function ids() {
    var out = [];
    for (var k in D) if (Object.prototype.hasOwnProperty.call(D, k)) out.push(k);
    return out;
  }

  var API = { get: get, ids: ids };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SURGX_DIAGRAMS = API;
})();
