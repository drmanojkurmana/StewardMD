/* 02 · Capability 1: Dx My Patient (4.5-11.5 s). Same real flow as the film, slower:
   Home -> Dx Patient -> four findings in, the guided consult asks "Altered sensorium?" ->
   Present · add -> Review differential (the engine's own "What changed" line) -> Open full
   stewardship page (handoff to 03). */
FILM.section({
  id: "r02-reason", start: FILM.T.reason, duration: FILM.T.steward - FILM.T.reason, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.steward - F.T.reason, R = F.RECTS;

    var ph = F.phone(root); F.placeHero(ph.wrap);
    var home = F.layer(ph.screen, F.A.home, { bar: "#ebebeb" });
    var dx4 = F.layer(ph.screen, F.A.dx4, { bar: "#ffffff" });
    var dx5 = F.layer(ph.screen, F.A.dx5, { bar: "#ffffff" });
    var dxr = F.layer(ph.screen, F.A.dxr, { bar: "#ffffff" });
    gsap.set([dx4, dx5, dxr], { xPercent: 100 });

    var c = F.rcopy(root, "01", "Reason", "A differential that updates <em>with every finding.</em>",
      "Dx My Patient asks one useful question at a time.");
    F.rcopyIn(tl, c, 0.3);

    var t = R.home.dxTile; F.tap(tl, ph.screen, t[0] + t[2] / 2, t[1] + t[3] / 2, 0.4);
    F.push(tl, home, dx4, 0.62, 0.65);

    var cf = R.dx4.confirm; F.tap(tl, ph.screen, cf[0] + cf[2] / 2, cf[1] + cf[3] / 2, 1.8);
    tl.set(dx5, { xPercent: 0, opacity: 0 }, 0);
    tl.to(dx5, { opacity: 1, duration: 0.35, ease: "power1.inOut" }, 1.98);
    tl.set(dx4, { opacity: 0 }, 2.35);

    // "Added to this case" chips, lifted large across the phone.
    var ch = R.dx5.chips, chips = F.rlift(root, F.A.dx5, 390, ch[0], ch[1], ch[2], ch[3], 2.25, 1200);
    F.liftIn(tl, chips, 2.2); F.liftOut(tl, chips, 3.35);

    var rv = R.dx5.review; F.tap(tl, ph.screen, rv[0] + rv[2] / 2, rv[1] + rv[3] / 2, 3.3);
    tl.set(dxr, { xPercent: 100, opacity: 1 }, 0);
    tl.to(dxr, { xPercent: 0, duration: 0.6, ease: "power3.inOut" }, 3.45);
    tl.to(dx5, { xPercent: -28, duration: 0.6, ease: "power3.inOut" }, 3.45);

    F.scrollTo(tl, dxr, 470, 4.15, 1.3, "power2.inOut");
    var w = R.dxr.changed, changed = F.rlift(root, F.A.dxr, 390, w[0] - 4, w[1] - 4, w[2] + 8, w[3] + 8, 2.3, 1245);
    F.liftIn(tl, changed, 4.3); F.liftOut(tl, changed, 5.85);

    F.scrollTo(tl, dxr, 330, 5.8, 0.6, "power2.inOut");
    var sb = R.dxr.stewBtn; F.tap(tl, ph.screen, sb[0] + sb[2] / 2, sb[1] + sb[3] / 2 - 330, 6.45);
    F.rcopyOut(tl, c, D - 0.55);
  }
});
