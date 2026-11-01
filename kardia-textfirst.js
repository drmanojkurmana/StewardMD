/* Kardia text first path: the calm text pane shown when 3D cannot run
   (no WebGL, an old phone, low memory) or a lab frame fails or is slow.
   ES5 IIFE. Pure helpers plus window.KARDIA_TEXTFIRST; module.exports
   under node for tests. Content status ai_drafted: every pane carries
   the draft line until the owner reviews it. British spelling. */
(function (G) {
  "use strict";

  /* Detect WebGL once. Tries webgl2 then webgl on a throwaway canvas.
     The result is cached: a phone does not gain or lose WebGL mid
     session, and probing on every paint would waste battery. A test
     can pass a fake canvas maker or call resetForTest(). */
  var cached = null;
  function detectWebGL(makeCanvas) {
    if (cached !== null) return cached;
    var ok = false;
    try {
      var doc = G.document || (typeof document !== "undefined" ? document : null);
      var c = null;
      if (makeCanvas) c = makeCanvas();
      else if (doc && doc.createElement) c = doc.createElement("canvas");
      if (c && c.getContext) {
        var ctx = null;
        try { ctx = c.getContext("webgl2"); } catch (e) { ctx = null; }
        if (!ctx) { try { ctx = c.getContext("webgl"); } catch (e) { ctx = null; } }
        if (!ctx) { try { ctx = c.getContext("experimental-webgl"); } catch (e) { ctx = null; } }
        ok = !!ctx;
        /* Release the probe context where the platform allows it. */
        try { var ext = ctx && ctx.getExtension ? ctx.getExtension("WEBGL_lose_context") : null; if (ext) ext.loseContext(); } catch (e) {}
      }
    } catch (e) { ok = false; }
    cached = ok;
    return ok;
  }
  function resetForTest() { cached = null; }

  function isOffline(nav) {
    try {
      var n = nav || G.navigator || (typeof navigator !== "undefined" ? navigator : null);
      return !!(n && n.onLine === false);
    } catch (e) { return false; }
  }

  /* Standard coronary projections in AngioLAB, with gantry angles.
     Alpha is rotation (positive LAO, negative RAO), beta is
     angulation (positive cranial, negative caudal). ai_drafted. */
  var ANGIO_VIEWS = [
    { id: "lao-caudal", name: "LAO caudal (spider)", system: "Left coronary", angles: "LAO 45, caudal 35", range: "LAO 30 to 50, caudal 25 to 40" },
    { id: "rao-caudal", name: "RAO caudal", system: "Left coronary", angles: "RAO 30, caudal 30", range: "RAO 30 to 40, caudal 30 to 40" },
    { id: "ap-caudal", name: "AP caudal", system: "Left coronary", angles: "AP, caudal 30", range: "AP to RAO 15, caudal 30" },
    { id: "ap-cranial", name: "AP cranial", system: "Left coronary", angles: "AP, cranial 40", range: "AP to RAO 10, cranial 35 to 45" },
    { id: "lao-cranial", name: "LAO cranial", system: "Left coronary", angles: "LAO 40, cranial 35", range: "LAO 30 to 45, cranial 25 to 35" },
    { id: "rao-cranial", name: "RAO cranial", system: "Left coronary", angles: "RAO 30, cranial 30", range: "RAO 20 to 30, cranial 25 to 35" },
    { id: "left-lateral", name: "Left lateral", system: "Left coronary", angles: "LAO 90", range: "LAO 90, cranial or caudal 10 to 30" },
    { id: "rca-lao", name: "LAO straight (RCA)", system: "Right coronary", angles: "LAO 50", range: "LAO 40 to 60" },
    { id: "rca-rao", name: "RAO straight (RCA)", system: "Right coronary", angles: "RAO 30", range: "RAO 30 to 45" },
    { id: "rca-ap-cranial", name: "AP cranial (RCA)", system: "Right coronary", angles: "AP, cranial 30", range: "AP, cranial 25 to 35" },
    { id: "rca-lao-cranial", name: "LAO cranial (RCA)", system: "Right coronary", angles: "LAO 40, cranial 30", range: "LAO 30 to 45, cranial 25 to 35" },
    { id: "ap", name: "AP (PA)", system: "Both systems", angles: "AP, no angulation", range: "AP, no angulation" },
    { id: "lima-lateral", name: "Left lateral (LIMA)", system: "LIMA graft", angles: "LAO 90", range: "LAO 90" },
    { id: "lima-rao-cranial", name: "RAO cranial (LIMA)", system: "LIMA graft", angles: "RAO 30, cranial 30", range: "RAO 20 to 30, cranial 25 to 35" },
    { id: "lima-ap-cranial", name: "AP cranial (LIMA)", system: "LIMA graft", angles: "AP, cranial 40", range: "AP to RAO 10, cranial 35 to 45" },
    { id: "lima-lao-cranial", name: "LAO cranial (LIMA)", system: "LIMA graft", angles: "LAO 40, cranial 35", range: "LAO 30 to 45, cranial 25 to 35" },
    { id: "svg-om-rao-caudal", name: "RAO caudal (SVG to OM)", system: "Vein graft to OM", angles: "RAO 30, caudal 30", range: "RAO 30 to 40, caudal 30 to 40" },
    { id: "svg-om-spider", name: "LAO caudal spider (SVG to OM)", system: "Vein graft to OM", angles: "LAO 45, caudal 35", range: "LAO 30 to 50, caudal 25 to 40" },
    { id: "svg-pda-lao", name: "LAO (SVG to PDA)", system: "Vein graft to PDA", angles: "LAO 50", range: "LAO 40 to 60" },
    { id: "svg-pda-ap-cranial", name: "AP cranial (SVG to PDA)", system: "Vein graft to PDA", angles: "AP, cranial 30", range: "AP, cranial 25 to 35" },
    { id: "svg-pda-lao-cranial", name: "LAO cranial (SVG to PDA)", system: "Vein graft to PDA", angles: "LAO 40, cranial 30", range: "LAO 30 to 45, cranial 25 to 35" },
    { id: "svg-pda-rao", name: "RAO (SVG to PDA)", system: "Vein graft to PDA", angles: "RAO 30", range: "RAO 30 to 45" }
  ];

  /* The Learn lesson that teaches one echo view. Lessons carry a view
     field (the simulator view id); the view lesson itself has an id
     starting view_, tee_ or pocus_. Prefer that lesson, else the
     first lesson tied to the view, else null. */
  function lessonForView(viewId, lessons) {
    if (!viewId || !lessons) return null;
    var cands = [], id;
    for (id in lessons) {
      if (!Object.prototype.hasOwnProperty.call(lessons, id)) continue;
      var m = lessons[id];
      if (m && m.view === viewId) cands.push(id);
    }
    if (!cands.length) return null;
    var suffix = String(viewId).replace(/^(tte|tee|pocus)_/, "");
    var want = ["view_" + suffix, String(viewId)];
    for (var w = 0; w < want.length; w++) if (cands.indexOf(want[w]) >= 0) return want[w];
    for (var i = 0; i < cands.length; i++) if (/^(view_|tee_|pocus_)/.test(cands[i])) return cands[i];
    return cands[0];
  }

  function linkFor(kind, id, links) {
    try { if (links && links.link) return links.link(kind, id); } catch (e) {}
    return id ? "stewardmd://kardia/" + kind + "/" + id : "";
  }

  /* One text row per echo view: name, probe position and marker, and
     what you should see (the view landmarks, in plain words). */
  function echoRows(viewsData, lessons, links) {
    var views = viewsData && viewsData.views ? viewsData.views : [];
    return views.map(function (v) {
      var see = (v.landmarks || []).map(function (l) { return l.name; }).join(", ");
      var lessonId = lessonForView(v.id, lessons || null);
      return {
        id: v.id, name: v.name || v.id,
        position: v.probe && v.probe.position ? v.probe.position : "",
        marker: v.probe && v.probe.marker ? v.probe.marker : "",
        see: see,
        lessonId: lessonId,
        link: lessonId ? linkFor("lesson", lessonId, links) : ""
      };
    });
  }

  function angioRows(links) {
    return ANGIO_VIEWS.map(function (v) {
      return { id: v.id, name: v.name, system: v.system, angles: v.angles, range: v.range, lessonId: null, link: "" };
    });
  }

  var API = {
    ANGIO_VIEWS: ANGIO_VIEWS,
    detectWebGL: detectWebGL,
    detect3D: detectWebGL,
    resetForTest: resetForTest,
    isOffline: isOffline,
    lessonForView: lessonForView,
    echoRows: echoRows,
    angioRows: angioRows,
    linkFor: linkFor
  };
  if (G) G.KARDIA_TEXTFIRST = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
