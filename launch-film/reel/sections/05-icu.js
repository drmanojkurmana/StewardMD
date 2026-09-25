/* 05 · Capability 4: ICU workstation (25.5-32.5 s). The phone tumbles back in on the real ICU
   dashboard, synthetic septic-shock patient ("Demo Patient", charted through the ICU module's own
   ingest APIs): header vitals, live status, and the engine's computed Current status (NEWS2 10)
   and qSOFA 2/3 critical alert. Ends with the phone stepping back for the watch (06). */
FILM.section({
  id: "r05-icu", start: FILM.T.icu, duration: FILM.T.watch - FILM.T.icu, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.watch - F.T.icu, R = F.RECTS.icu;

    var ph = F.phone(root); F.placeHero(ph.wrap);
    var icu = F.layer(ph.screen, F.A.icu, { bar: "#b42332" });
    ph.status.className = "status light";
    tl.fromTo(ph.wrap, { rotationX: 88, y: F.RP.y + 60 }, { rotationX: 0, y: F.RP.y, duration: 0.8, ease: "power3.out" }, 0);

    var c = F.rcopy(root, "04", "Monitor", "An ICU workstation <em>that scores as you chart.</em>",
      "qSOFA, NEWS2 and SOFA, computed as you chart.");
    F.rcopyIn(tl, c, 0.35);

    var v = R.vitals, strip = F.rlift(root, F.A.icu, 390, v[0] - 6, v[1] - 6, v[2] + 12, v[3] + 12, 2.25, 1265, 540, "border-radius:18px");
    F.liftIn(tl, strip, 0.9); F.liftOut(tl, strip, 2.4);

    F.scrollTo(tl, icu, 470, 1.4, 1.1, "power2.inOut");
    F.scrollTo(tl, icu, R.qsofa[1] - 640, 2.7, 1.2, "power3.inOut");

    var st = R.status, status = F.rlift(root, F.A.icu, 390, st[0], st[1], st[2], 88, 2.2, 1185);
    F.liftIn(tl, status, 2.9); F.liftOut(tl, status, 4.3);
    var q = R.qsofa, qs = F.rlift(root, F.A.icu, 390, 11, q[1] - 13, 368, q[3] + 26, 2.2, 1205);
    F.liftIn(tl, qs, 3.9); F.liftOut(tl, qs, 5.7);

    F.rcopyOut(tl, c, D - 0.75);
    // Step back: small, up-left, turned slightly, out of focus: the watch takes the front.
    tl.to(ph.wrap, { x: 96, y: 520, scale: 0.72, rotationY: 16, filter: "blur(2px)", duration: 0.9, ease: "power3.inOut" }, D - 0.9);
  }
});
