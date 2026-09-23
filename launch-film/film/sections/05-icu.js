/* 05 · Capability 4: the ICU workstation (16.8-21.4s).
   Real ICU dashboard, synthetic septic-shock patient ("Demo Patient", charted through the ICU
   module's own ingest APIs): live status tiles with trends, electrolyte alerts, and the engine's
   auto-computed critical alerts (qSOFA 2/3, NEWS2 10). */
FILM.section({
  id: "s05-icu", start: FILM.T.icu, duration: FILM.T.watch - FILM.T.icu, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.watch - F.T.icu;

    var ph = F.phone(root);
    gsap.set(ph.wrap, { x: 760, y: F.PL.y, scale: 0.96, rotationY: -16 });
    var maik = F.layer(ph.screen, F.A.maik, { bar: "#7c8b93", bg: "#c9d0d4" });
    var icu = F.layer(ph.screen, F.A.icu, { bar: "#b42332" });
    ph.status.className = "status light";
    tl.set(icu, { opacity: 0 }, 0);
    tl.to(icu, { opacity: 1, duration: 0.3, ease: "power1.inOut" }, 0.08);
    tl.to(ph.wrap, { x: F.PL.x, scale: 1, rotationY: 0, duration: 0.75, ease: "power3.out" }, 0);

    var c = F.copy(root, "04", "Monitor",
      "An ICU workstation <em>that scores as you chart.</em>",
      "Live patient status, electrolyte alerts, and qSOFA, NEWS2 and SOFA computed from the values you chart.",
      "left:1060px;top:318px");
    F.copyIn(tl, c, 0.3);

    var R = F.RECTS.icu;
    // Header vitals strip (FILM.RECTS.icu.vitals): MAP 76 · HR 98 · SpO2 95% · LACT 2.6
    var strip = F.cropR(root, F.A.icu, R.vitals, [6, 6], 1.3, 1030, 250, "border-radius:14px");
    tl.fromTo(strip, { opacity: 0, x: -150, z: -220, rotationY: -20 }, { opacity: 1, x: 0, z: 90, rotationY: -8, duration: 0.6, ease: "power3.out" }, 0.7);
    tl.to(strip, { opacity: 0, y: -20, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, 1.9);

    // Scroll: live status tiles -> current status -> critical alerts.
    F.scrollTo(tl, icu, 470, 1.05, 0.9, "power2.inOut");
    F.scrollTo(tl, icu, R.qsofa[1] - 640, 2.05, 1.0, "power3.inOut");

    // Current status card, top half (FILM.RECTS.icu.status): "Critical — NEWS2 10 · Lactate 2.6 · K+ 5.6"
    var st = R.status, status = F.crop(root, F.A.icu, 390, st[0], st[1], st[2], 88, 1.12, "left:" + (1010 - st[2] * 1.12) + "px;top:430px");
    tl.fromTo(status, { opacity: 0, x: -150, z: -200, rotationY: -20 }, { opacity: 1, x: 0, z: 80, rotationY: -8, duration: 0.6, ease: "power3.out" }, 2.35);
    tl.to(status, { opacity: 0, x: 60, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, 3.65);

    // qSOFA alert card (FILM.RECTS.icu.qsofa is its text block; widen to the card edges).
    var q = R.qsofa, qs = F.crop(root, F.A.icu, 390, 11, q[1] - 13, 368, q[3] + 26, 1.12, "left:" + (1010 - 368 * 1.12) + "px;top:690px");
    tl.fromTo(qs, { opacity: 0, x: -150, z: -200, rotationY: -20 }, { opacity: 1, x: 0, z: 90, rotationY: -8, duration: 0.6, ease: "power3.out" }, 2.95);
    tl.to(qs, { opacity: 0, x: 60, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, 3.95);

    // Handoff to the watch: the phone drops away to the left, copy clears.
    F.copyOut(tl, c, D - 0.45);
    tl.to(ph.wrap, { x: -300, y: 260, rotationY: -30, rotationZ: -6, opacity: 0, duration: 0.6, ease: "power3.in" }, D - 0.6);
  }
});
