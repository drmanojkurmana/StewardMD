/* kardia-scan-targets.js - Scan Lab view targets (Kardia 2.0).
 * ES5 IIFE, window.KARDIA_SCAN_TARGETS, module.exports under node.
 * Design contract: data only, no DOM. Every target is derived from
 * kardia/views.json via KARDIA_PROBE.stateForView() so the plane cuts
 * the same heart KARDIA_GEOM renders; the unit test re-derives each
 * pose and checks KARDIA_GEOM.cut() shows the expected structures.
 * Contact points are skin surface points in the patient frame
 * (x left, y anterior, z cranial, mm, origin at LV centroid).
 * status: ai_drafted until owner clinical review. British spelling. */
(function (G) {
  "use strict";
  function t(id, view, family, label, contact, rot, fan, rock, depthCm, tol, expected, hints) {
    return { id: id, viewId: view, family: family, label: label, status: "ai_drafted",
      contact: contact, rotationDeg: rot, fanDeg: fan, rockDeg: rock, depthCm: depthCm,
      tolerance: tol, expected: expected, hints: hints, icon: id };
  }
  var TOL_TIGHT = { rotationDeg: 8, fanDeg: 8, rockDeg: 8, slideMm: 6, depthCm: 2 };
  var TOL_STD = { rotationDeg: 10, fanDeg: 10, rockDeg: 10, slideMm: 8, depthCm: 2 };
  var VIEWS = [
    t("plax", "tte_plax", "parasternal", "PLAX", [27.5, 60.6, 53.1], 112, -18, -6, 16, TOL_TIGHT,
      ["FJ2422", "FJ2425", "FJ2420"], ["Slide toward the feet and the patient's right", "Rotate clockwise"]),
    t("rv_inflow", "tte_rv_inflow", "parasternal", "RV inflow", [28.3, 64.8, 45.4], 109, -25, 16, 16, TOL_STD,
      ["FJ2424", "FJ2423", "FJ2421"], ["Fan toward the patient's right hip", "Rock gently toward the sternum"]),
    t("rv_outflow", "tte_rvot_long", "parasternal", "RV outflow", [30.6, 49.1, 73.7], 114, 2, 5, 14, TOL_STD,
      ["FJ2423", "FJ2966"], ["Rotate anticlockwise a little from PLAX", "Slide toward the head"]),
    t("psax_av", "tte_psax_av", "parasternal", "PSAX aortic valve", [26.2, 55.6, 62.4], -148, 2, 11, 12, TOL_TIGHT,
      ["FJ2426", "FJ2435", "FJ2424"], ["Rotate clockwise until the valve is round", "Make a smaller grip movement; the contact point is not aligned yet"]),
    t("psax_mv", "tte_psax_mv", "parasternal", "PSAX mitral valve", [28.3, 64.8, 45.4], -148, 2, 11, 14, TOL_TIGHT,
      ["FJ2422", "FJ2420", "FJ2432"], ["Slide toward the feet from the aortic valve level", "Fan slowly until both leaflets open like a fish mouth"]),
    t("psax_pm", "tte_psax_papillary", "parasternal", "PSAX papillary", [28.6, 71.1, 33.5], -148, 2, 11, 16, TOL_TIGHT,
      ["FJ2422", "FJ2429"], ["Slide toward the feet a little more", "Keep the cavity round; an oval means the cut is oblique"]),
    t("psax_apex", "tte_psax_apex", "parasternal", "PSAX apex", [44.8, 84.9, 6.6], -148, 2, 11, 16, TOL_STD,
      ["FJ2422", "lv_apex"], ["Slide toward the apex until no papillary muscle is seen", "Reduce depth so the apex fills the sector"]),
    t("a4c", "tte_a4c", "apical", "A4C", [91.5, 90.7, -17.1], -171, -8, -7, 18, TOL_TIGHT,
      ["FJ2422", "FJ2425", "FJ2423", "FJ2424"], ["Slide to the apex and point the beam toward the right shoulder", "Open the apex; do not foreshorten"]),
    t("a5c", "tte_a5c", "apical", "A5C", [91.5, 90.7, -17.1], 147, 5, 1, 18, TOL_TIGHT,
      ["FJ2422", "lvot", "FJ2420"], ["Fan anteriorly from A4C until the aortic valve appears", "Rotate clockwise a fraction"]),
    t("a2c", "tte_a2c", "apical", "A2C", [91.5, 90.7, -17.1], -124, 8, 19, 18, TOL_TIGHT,
      ["FJ2422", "FJ2425", "FJ2420"], ["Rotate anticlockwise about sixty degrees from A4C", "Keep the apex in the centre of the sector"]),
    t("a3c", "tte_a3c", "apical", "A3C", [91.5, 90.7, -17.1], 112, 12, 6, 18, TOL_TIGHT,
      ["FJ2422", "FJ2425", "aortic_root"], ["Rotate further until the aortic root appears", "Fan until the outflow tract is straight"]),
    t("subcostal_4c", "tte_subcostal_4c", "subcostal", "Subcostal 4C", [0.3, 100.8, -68], 146, -14, 18, 18, TOL_STD,
      ["FJ2422", "FJ2424", "LIVE_liver"], ["Press flat under the costal margin and aim toward the left shoulder", "Use the liver as your window"]),
    t("ivc", "tte_subcostal_ivc", "subcostal", "IVC", [12.6, 102.6, -67.1], -74, 1, 0, 16, TOL_STD,
      ["FJ3441", "FJ2424", "hepatic_vein"], ["Turn the marker toward the head", "Follow the cava into the right atrium before measuring"]),
    t("abdominal_aorta", "tte_subcostal_aorta", "subcostal", "Abdominal aorta", [-14.1, 99, -66.3], -163, -19, 6, 14, TOL_STD,
      ["FJ1932"], ["Stay in the midline and follow the pulsation", "The aorta does not collapse with a sniff; the cava does"]),
    t("suprasternal_arch", "tte_suprasternal_arch_lax", "suprasternal", "Suprasternal arch", [-1.1, 27.8, 121.2], 148, -11, -2, 12, TOL_STD,
      ["FJ3411", "FJ3413", "FJ3427"], ["Rest the probe in the notch with the neck extended", "Rotate until the arch curves like a walking stick"])
  ];
  /* Landmark regions in the patient frame (x left, z cranial, mm).
   * Contacts above are exact vertices of the decimated HuBMAP skin
   * mesh, so each lies on the skin by construction; the test also
   * checks the point to triangle distance stays under 3 mm. */
  var LANDMARKS = {
    parasternal: { x: [8, 52], z: [0, 82], label: "Left parasternal 3rd or 4th intercostal space beside the sternum" },
    apical: { x: [72, 112], z: [-38, 2], label: "Apex beat, 5th intercostal space toward the anterior axillary line" },
    subcostal: { x: [-24, 28], z: [-86, -52], label: "Under the xiphoid and costal margin" },
    suprasternal: { x: [-16, 16], z: [104, 138], label: "Jugular notch" }
  };
  var FAMILIES = [
    { id: "parasternal", label: "Parasternal" }, { id: "apical", label: "Apical" },
    { id: "subcostal", label: "Subcostal" }, { id: "suprasternal", label: "Suprasternal" }
  ];
  var ALIASES = { sc4c: "subcostal_4c", s4c: "subcostal_4c", subcostal: "subcostal_4c", suprasternal: "suprasternal_arch", arch: "suprasternal_arch" };
  function byId(id) { var want = ALIASES[id] || id; for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].id === want) return VIEWS[i]; return null; }
  function byView(viewId) { for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].viewId === viewId) return VIEWS[i]; return null; }
  var API = { VIEWS: VIEWS, FAMILIES: FAMILIES, LANDMARKS: LANDMARKS, ALIASES: ALIASES, byId: byId, byView: byView, version: 2 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_SCAN_TARGETS = API;
})(typeof window !== "undefined" ? window : this);
