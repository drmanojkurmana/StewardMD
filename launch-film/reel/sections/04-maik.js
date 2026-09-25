/* 04 · Capability 3: MaiK (18.5-25.5 s). The phone turns upright into MaiK: the StewardMD site's
   own MaiK capture (_site/assets/s/maik.png): "Grounded · AI-generated, verify independently",
   a clinician's question, and a MaiK Evidence Review with a Bottom Line and numbered citations,
   revealed top-down as MaiK streams. Ends tumbling away (rotationX) into 05. */
FILM.section({
  id: "r04-maik", start: FILM.T.maik, duration: FILM.T.icu - FILM.T.maik, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.icu - F.T.maik, MW = 640, k = 380 / MW;

    var ph = F.phone(root); F.placeHero(ph.wrap);
    gsap.set(ph.wrap, { rotation: -90, scale: 1.1 });
    var land = F.landLayer(ph.screen, F.A.abgLand, 844);
    gsap.set(land.img, { y: -930 * land.k });
    var maik = F.layer(ph.screen, F.A.maik1, { bar: "#aaadb3", bg: "#f4f5f6" });
    ph.status.className = "status light"; ph.status.style.zIndex = 8;
    tl.set([maik, ph.status], { opacity: 0 }, 0);

    tl.to(ph.wrap, { rotation: 0, scale: F.RP.s, duration: 0.95, ease: "power3.inOut" }, 0);
    tl.to(maik, { opacity: 1, duration: 0.3, ease: "power1.inOut" }, 0.32);
    tl.set(land, { opacity: 0 }, 0.65);
    tl.to(ph.status, { opacity: 1, duration: 0.3 }, 0.8);

    // Streamed answer: a cover over the answer body (native y 690-1195) rolls away.
    var cover = F.el(maik.view, "", "position:absolute;left:0;right:0;background:linear-gradient(180deg,rgba(244,245,246,0) 0,#f4f5f6 46px);top:" + (650 * k) + "px;height:" + (560 * k) + "px");
    tl.fromTo(cover, { y: 0 }, { y: 560 * k + 50, duration: 1.5, ease: "power1.inOut" }, 0.95);

    var c = F.rcopy(root, "03", "Ask MaiK", "Clinical questions. <em>Grounded, cited answers.</em>",
      "Answers from the StewardMD knowledge base. Advisory: the clinician verifies.");
    // MaiK's own wordmark in place of the label.
    var lab = c.kicker.querySelector(".lab"); lab.textContent = "";
    var wm = document.createElement("img"); wm.src = F.A.maikColor; wm.style.cssText = "height:40px;display:block;margin-top:-6px";
    lab.appendChild(wm);
    F.rcopyIn(tl, c, 0.45);

    var qb = F.rlift(root, F.A.maik1, MW, 129, 478, 489, 85, 1.68, 1225, 540, "border-radius:30px");
    F.liftIn(tl, qb, 1.0); F.liftOut(tl, qb, 2.5);
    var bl = F.rlift(root, F.A.maik1, MW, 22, 885, 548, 275, 1.5, 1065);
    F.liftIn(tl, bl, 2.6); F.liftOut(tl, bl, 4.55);
    var hd = F.rlift(root, F.A.maik1, MW, 22, 590, 548, 92, 1.5, 1265);
    F.liftIn(tl, hd, 4.6); F.liftOut(tl, hd, 6.0);

    F.rcopyOut(tl, c, D - 0.7);
    tl.to(ph.wrap, { rotationX: -88, y: F.RP.y - 60, duration: 0.6, ease: "power2.in" }, D - 0.6);
  }
});
