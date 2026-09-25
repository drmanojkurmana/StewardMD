/* 03 · Capability 2: Antimicrobial stewardship (11.5-18.5 s). The stewardship page for the same
   case (QUICK DECISION: Acute Bacterial Meningitis, Ceftriaxone, ICU/HDU), then the phone turns to
   landscape, as the app itself prompts ("Rotate for a wider view"), for the ICMR antibiogram
   coverage grid. Ends in landscape; 04 turns it upright into MaiK. */
FILM.section({
  id: "r03-steward", start: FILM.T.steward, duration: FILM.T.maik - FILM.T.steward, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.maik - F.T.steward;

    var ph = F.phone(root); F.placeHero(ph.wrap);
    var dxr = F.layer(ph.screen, F.A.dxr, { bar: "#ffffff" });
    gsap.set(dxr.img, { y: -330 * F.PS });
    var stew = F.layer(ph.screen, F.A.stew, { bar: "#e7e8ea" });
    gsap.set(stew, { xPercent: 100 });
    var land = F.landLayer(ph.screen, F.A.abgLand, 844);
    gsap.set(land, { opacity: 0 });
    ph.status.style.zIndex = 8;

    var c = F.rcopy(root, "02", "Steward", "Antimicrobial stewardship <em>at the point of prescribing.</em>",
      "ICMR AMRSN 2024 guidance and regional antibiograms.");
    F.rcopyIn(tl, c, 0.3);

    F.push(tl, dxr, stew, 0.02, 0.62);

    var q = F.RECTS.stew.quick, qd = F.rlift(root, F.A.stew, 390, q[0], q[1], q[2], q[3], 1.95, 990);
    F.liftIn(tl, qd, 1.0); F.liftOut(tl, qd, 2.5);

    // Turn to landscape: body -90deg, content already laid out for landscape inside the screen.
    tl.to(ph.wrap, { rotation: -90, scale: 1.1, duration: 1.0, ease: "power3.inOut" }, 2.8);
    tl.to(ph.status, { opacity: 0, duration: 0.25 }, 2.85);   // iOS hides the status bar in landscape
    tl.to(land, { opacity: 1, duration: 0.35, ease: "power1.inOut" }, 3.1);
    tl.set(stew, { opacity: 0 }, 3.5);
    // Pan down the coverage grid (table starts at app y ~374).
    tl.fromTo(land.img, { y: -300 * land.k }, { y: -930 * land.k, duration: 2.6, ease: "power1.inOut" }, 3.7);
    F.rcopyOut(tl, c, D - 0.6);
  }
});
