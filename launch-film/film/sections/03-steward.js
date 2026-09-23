/* 03 · Capability 2: Antimicrobial stewardship (7.6-12.2s).
   Real flow continues from 02: the stewardship page for the same case (QUICK DECISION card:
   Acute Bacterial Meningitis, Ceftriaxone, ICU/HDU), then the ICMR AMRSN 2024 resistance rates on
   the phone and the full antibiotic-coverage grid on an iPad in landscape. */
FILM.section({
  id: "s03-steward", start: FILM.T.steward, duration: FILM.T.maik - FILM.T.steward, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.maik - F.T.steward;

    // Tablet first so the phone sits in front of it.
    var TW = 920, TH = 640;
    var tab = F.tablet(root, TW, TH);
    var gridImg = document.createElement("img");
    gridImg.src = F.A.abgGrid; gridImg.style.cssText = "position:absolute;left:0;top:0;width:100%";
    tab.screen.appendChild(gridImg);
    gsap.set(tab.wrap, { x: 2100, y: 360, rotationY: -26, opacity: 1 });

    var ph = F.phone(root);
    gsap.set(ph.wrap, { x: F.PL.x, y: F.PL.y });
    var dxr = F.layer(ph.screen, F.A.dxr, { bar: "#ffffff" });
    gsap.set(dxr.img, { y: -330 * F.PS });
    var stew = F.layer(ph.screen, F.A.stew, { bar: "#e7e8ea" });
    var rates = F.layer(ph.screen, F.A.abgRates, { bar: "#ffffff" });
    gsap.set([stew, rates], { xPercent: 100 });

    var c = F.copy(root, "02", "Steward",
      "Antimicrobial stewardship <em>at the point of prescribing.</em>",
      "ICMR AMRSN 2024 guidance, regional antibiograms and patient-specific safety checks, for the case in front of you.",
      "left:1060px;top:318px");
    F.copyIn(tl, c, 0.2);

    F.push(tl, dxr, stew, 0.02, 0.5);

    // Lift the QUICK DECISION card (FILM.RECTS.stew.quick).
    var qd = F.cropR(root, F.A.stew, F.RECTS.stew.quick, [0, 0], 1.08, 1010, 250);
    tl.fromTo(qd, { opacity: 0, x: -150, z: -220, rotationY: -22, scale: 0.92 },
      { opacity: 1, x: 0, z: 90, rotationY: -9, scale: 1, duration: 0.65, ease: "power3.out" }, 0.75);
    tl.to(qd, { opacity: 0, x: 80, filter: "blur(8px)", duration: 0.4, ease: "power2.in" }, 1.95);

    // Make room: copy rises and tightens, phone steps back, the iPad slides in.
    tl.to(c.root, { y: -228, x: -40, scale: 0.78, transformOrigin: "0% 0%", duration: 0.7, ease: "power3.inOut" }, 1.95);
    tl.to(c.sub, { opacity: 0, duration: 0.3 }, 1.95);
    tl.to(ph.wrap, { x: F.PL.x - 150, scale: 0.9, duration: 0.8, ease: "power3.inOut" }, 2.0);
    tl.to(tab.wrap, { x: 900, y: 350, rotationY: -10, duration: 0.95, ease: "power3.out" }, 2.05);
    tl.fromTo(tab.wrap.querySelector(".phone-glare"), { backgroundPosition: "110% 0" }, { backgroundPosition: "-40% 0", duration: 1.3, ease: "power2.inOut" }, 2.2);
    tl.to(gridImg, { y: -320, duration: 2.2, ease: "power1.inOut" }, 2.4);

    // Phone: stewardship page -> Antibiogram resistance rates.
    F.push(tl, stew, rates, 2.75, 0.5);
    F.scrollTo(tl, rates, 60, 3.3, 1.0, "power1.inOut");

    // Handoff to MaiK: iPad exits right, copy clears, phone swings across to the right.
    tl.to(tab.wrap, { x: 2150, rotationY: -30, duration: 0.6, ease: "power3.in" }, D - 0.62);
    tl.to(c.root, { opacity: 0, y: "-=30", filter: "blur(8px)", duration: 0.35, ease: "power2.in" }, D - 0.5);
    tl.to(ph.wrap, { x: 760, scale: 0.96, rotationY: 16, duration: 0.55, ease: "power2.in" }, D - 0.55);
  }
});
