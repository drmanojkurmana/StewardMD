/* 02 · Capability 1: Dx My Patient, the live clinical-reasoning workspace (3.0-7.6s).
   Real flow: Home -> tap "Dx Patient" -> four findings in, the guided consult asks about
   altered sensorium -> tap "Present · add" -> tap "Review differential" -> ranked differential with the
   engine's own "What changed" line -> tap "Open full stewardship page" (handoff to 03). */
FILM.section({
  id: "s02-reason", start: FILM.T.reason, duration: FILM.T.steward - FILM.T.reason, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.steward - F.T.reason, R = F.RECTS;

    var ph = F.phone(root, "transform:translate(" + F.PL.x + "px," + F.PL.y + "px)");
    gsap.set(ph.wrap, { x: F.PL.x, y: F.PL.y });
    var home = F.layer(ph.screen, F.A.home, { bar: "#ebebeb" });
    var dx4 = F.layer(ph.screen, F.A.dx4, { bar: "#ffffff" });
    var dx5 = F.layer(ph.screen, F.A.dx5, { bar: "#ffffff" });
    var dxr = F.layer(ph.screen, F.A.dxr, { bar: "#ffffff" });
    gsap.set([dx4, dx5, dxr], { xPercent: 100 });

    var c = F.copy(root, "01", "Reason",
      "A differential that updates <em>with every finding.</em>",
      "Dx My Patient ranks infective and non-infective diagnoses as findings are added, and asks one useful question at a time.",
      "left:1060px;top:318px");
    F.copyIn(tl, c, 0.3);

    // Home -> Dx Patient tile (FILM.RECTS.home.dxTile).
    var t = R.home.dxTile; F.tap(tl, ph.screen, t[0] + t[2] / 2, t[1] + t[3] / 2, 0.2);
    F.push(tl, home, dx4, 0.42, 0.5);

    // Four findings in; the guided consult asks one question ("Altered sensorium?").
    // Tap "Present · add" (FILM.RECTS.dx4.confirm): the fifth finding joins the case.
    var cf = R.dx4.confirm; F.tap(tl, ph.screen, cf[0] + cf[2] / 2, cf[1] + cf[3] / 2, 1.2);
    tl.set(dx5, { xPercent: 0, opacity: 0 }, 0);
    tl.to(dx5, { opacity: 1, duration: 0.28, ease: "power1.inOut" }, 1.36);
    tl.set(dx4, { opacity: 0 }, 1.66);

    // Lift the "Added to this case" chips (measured rect, FILM.RECTS.dx5.chips).
    var chips = F.cropR(root, F.A.dx5, R.dx5.chips, [0, 0], 1.1, 1010, 668);
    tl.fromTo(chips, { opacity: 0, x: -120, z: -200, rotationY: -18, scale: 0.9 },
      { opacity: 1, x: 0, z: 60, rotationY: -8, scale: 1, duration: 0.55, ease: "power3.out" }, 1.5);
    tl.to(chips, { opacity: 0, x: 60, y: -20, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, 2.25);

    // Review differential (FILM.RECTS.dx5.review).
    var rv = R.dx5.review; F.tap(tl, ph.screen, rv[0] + rv[2] / 2, rv[1] + rv[3] / 2, 2.2);
    tl.set(dxr, { xPercent: 100, opacity: 1 }, 0);
    tl.to(dxr, { xPercent: 0, duration: 0.45, ease: "power3.inOut" }, 2.36);
    tl.to(dx5, { xPercent: -28, duration: 0.45, ease: "power3.inOut" }, 2.36);

    // Scroll to the ranked list; lift the engine's own "What changed" line (FILM.RECTS.dxr.changed).
    F.scrollTo(tl, dxr, 470, 2.95, 1.0, "power2.inOut");
    var changed = F.cropR(root, F.A.dxr, R.dxr.changed, [4, 4], 1.62, 1030, 470);
    tl.fromTo(changed, { opacity: 0, x: -140, z: -200, rotationY: -20 },
      { opacity: 1, x: 0, z: 80, rotationY: -8, duration: 0.6, ease: "power3.out" }, 2.95);
    tl.to(changed, { opacity: 0, y: -24, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, 4.0);

    // Back up to the stewardship button (FILM.RECTS.dxr.stewBtn) and tap it.
    F.scrollTo(tl, dxr, 330, 3.9, 0.45, "power2.inOut");
    var sb = R.dxr.stewBtn; F.tap(tl, ph.screen, sb[0] + sb[2] / 2, sb[1] + sb[3] / 2 - 330, 4.36);
    F.copyOut(tl, c, D - 0.35);
  }
});
