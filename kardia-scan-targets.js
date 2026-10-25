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
    t("plax", "tte_plax", "parasternal", "PLAX", [-55, 95, 55], 112, -18, -6, 16, TOL_TIGHT,
      ["FJ2422", "FJ2425", "FJ2420"], ["Slide toward the feet and the patient's right", "Rotate clockwise"]),
    t("rv_inflow", "tte_rv_inflow", "parasternal", "RV inflow", [-52, 95, 40], 109, -25, 16, 16, TOL_STD,
      ["FJ2424", "FJ2423", "FJ2421"], ["Fan toward the patient's right hip", "Rock gently toward the sternum"]),
    t("rv_outflow", "tte_rvot_long", "parasternal", "RV outflow", [-55, 95, 72], 114, 2, 5, 14, TOL_STD,
      ["FJ2423", "FJ2966"], ["Rotate anticlockwise a little from PLAX", "Slide toward the head"]),
    t("psax_av", "tte_psax_av", "parasternal", "PSAX aortic valve", [-55, 95, 68], -148, 2, 11, 12, TOL_TIGHT,
      ["FJ2426", "FJ2435", "FJ2424"], ["Rotate clockwise until the valve is round", "Make a smaller grip movement; the contact point is not aligned yet"]),
    t("psax_mv", "tte_psax_mv", "parasternal", "PSAX mitral valve", [-55, 95, 52], -148, 2, 11, 14, TOL_TIGHT,
      ["FJ2422", "FJ2420", "FJ2432"], ["Slide toward the feet from the aortic valve level", "Fan slowly until both leaflets open like a fish mouth"]),
    t("psax_pm", "tte_psax_papillary", "parasternal", "PSAX papillary", [-55, 95, 34], -148, 2, 11, 16, TOL_TIGHT,
      ["FJ2422", "FJ2429"], ["Slide toward the feet a little more", "Keep the cavity round; an oval means the cut is oblique"]),
    t("psax_apex", "tte_psax_apex", "parasternal", "PSAX apex", [-48, 92, 14], -148, 2, 11, 16, TOL_STD,
      ["FJ2422", "lv_apex"], ["Slide toward the apex until no papillary muscle is seen", "Reduce depth so the apex fills the sector"]),
    t("a4c", "tte_a4c", "apical", "A4C", [-95, 88, -18], -171, -8, -7, 18, TOL_TIGHT,
      ["FJ2422", "FJ2425", "FJ2423", "FJ2424"], ["Slide to the apex and point the beam toward the right shoulder", "Open the apex; do not foreshorten"]),
    t("a5c", "tte_a5c", "apical", "A5C", [-95, 88, -18], 147, 5, 1, 18, TOL_TIGHT,
      ["FJ2422", "lvot", "FJ2420"], ["Fan anteriorly from A4C until the aortic valve appears", "Rotate clockwise a fraction"]),
    t("a2c", "tte_a2c", "apical", "A2C", [-95, 88, -18], -124, 8, 19, 18, TOL_TIGHT,
      ["FJ2422", "FJ2425", "FJ2420"], ["Rotate anticlockwise about sixty degrees from A4C", "Keep the apex in the centre of the sector"]),
    t("a3c", "tte_a3c", "apical", "A3C", [-95, 88, -18], 112, 12, 6, 18, TOL_TIGHT,
      ["FJ2422", "FJ2425", "aortic_root"], ["Rotate further until the aortic root appears", "Fan until the outflow tract is straight"]),
    t("subcostal_4c", "tte_subcostal_4c", "subcostal", "Subcostal 4C", [-18, 82, -72], 146, -14, 18, 18, TOL_STD,
      ["FJ2422", "FJ2424", "LIVE_liver"], ["Press flat under the costal margin and aim toward the left shoulder", "Use the liver as your window"]),
    t("ivc", "tte_subcostal_ivc", "subcostal", "IVC", [12, 84, -70], -74, 1, 0, 16, TOL_STD,
      ["FJ3441", "FJ2424", "hepatic_vein"], ["Turn the marker toward the head", "Follow the cava into the right atrium before measuring"]),
    t("abdominal_aorta", "tte_subcostal_aorta", "subcostal", "Abdominal aorta", [0, 86, -78], -163, -19, 6, 14, TOL_STD,
      ["FJ1932"], ["Stay in the midline and follow the pulsation", "The aorta does not collapse with a sniff; the cava does"]),
    t("suprasternal_arch", "tte_suprasternal_arch_lax", "suprasternal", "Suprasternal arch", [0, 72, 118], 148, -11, -2, 12, TOL_STD,
      ["FJ3411", "FJ3413", "FJ3427"], ["Rest the probe in the notch with the neck extended", "Rotate until the arch curves like a walking stick"])
  ];
  var FAMILIES = [
    { id: "parasternal", label: "Parasternal" }, { id: "apical", label: "Apical" },
    { id: "subcostal", label: "Subcostal" }, { id: "suprasternal", label: "Suprasternal" }
  ];
  function byId(id) { for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].id === id) return VIEWS[i]; return null; }
  function byView(viewId) { for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].viewId === viewId) return VIEWS[i]; return null; }
  var API = { VIEWS: VIEWS, FAMILIES: FAMILIES, byId: byId, byView: byView, version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_SCAN_TARGETS = API;
})(typeof window !== "undefined" ? window : this);
