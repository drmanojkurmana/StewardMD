/* 04 · Capability 3: MaiK, the grounded clinical AI assistant (12.2-16.8s).
   Real MaiK screen from the StewardMD site (_site/assets/s/maik-2.png): "Grounded · AI-generated,
   verify independently", the clinician's question, and a MaiK Evidence Review answer with
   numbered citations. The answer is revealed top-down (MaiK streams its answers). */
FILM.section({
  id: "s04-maik", start: FILM.T.maik, duration: FILM.T.icu - FILM.T.maik, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.icu - F.T.maik;
    var MW = 369; // maik-2.png native width, crop coordinates are in its pixels

    var ph = F.phone(root);
    gsap.set(ph.wrap, { x: 760, y: F.PL.y, scale: 0.96, rotationY: 16 });
    var rates = F.layer(ph.screen, F.A.abgRates, { bar: "#ffffff" });
    gsap.set(rates.img, { y: -60 * F.PS });
    var maik = F.layer(ph.screen, F.A.maik, { bar: "#7c8b93", bg: "#c9d0d4" });
    ph.status.style.zIndex = 8;
    tl.set(maik, { opacity: 0 }, 0);
    tl.to(maik, { opacity: 1, duration: 0.3, ease: "power1.inOut" }, 0.08);
    tl.set(ph.status, { className: "status light" }, 0.2);
    tl.set(ph.status, { className: "status" }, 0);

    // Continue the swing and settle on the right.
    tl.to(ph.wrap, { x: F.PR.x, scale: 1, rotationY: 0, duration: 0.75, ease: "power3.out" }, 0);

    // Streamed answer: a cover over the answer body (native y 300-665) rolls down.
    var cover = F.el(maik.view, "", "position:absolute;left:0;right:0;background:linear-gradient(180deg,rgba(242,244,246,0) 0,#f2f4f6 40px);top:" + (300 * 380 / MW) + "px;height:" + (365 * 380 / MW) + "px");
    tl.set(cover, { opacity: 1 }, 0);
    tl.fromTo(cover, { y: 0 }, { y: 365 * 380 / MW + 40, duration: 1.2, ease: "power1.inOut" }, 0.4);

    // Copy on the left, with the MaiK wordmark.
    var c = F.copy(root, "03", "Ask MaiK",
      "Clinical questions. <em>Grounded, cited answers.</em>",
      "MaiK answers from the StewardMD knowledge base with numbered citations. Advisory by design: the clinician verifies.",
      "left:130px;top:318px;width:700px");
    var wm = document.createElement("img"); wm.src = F.A.maikWord;
    wm.style.cssText = "display:block;height:54px;margin:0 0 30px -2px;opacity:.95";
    c.root.insertBefore(wm, c.kicker);
    tl.from(wm, { y: 20, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.3);
    F.copyIn(tl, c, 0.4);

    // Lifted crops, between copy and phone: the question, then the evidence-review answer.
    var q = F.crop(root, F.A.maik, MW, 75, 199, 282, 50, 1.45, "left:870px;top:300px;border-radius:22px");
    tl.fromTo(q, { opacity: 0, x: 140, z: -200, rotationY: 20 }, { opacity: 1, x: 0, z: 80, rotationY: 8, duration: 0.6, ease: "power3.out" }, 0.75);
    tl.to(q, { opacity: 0, y: -20, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, 2.2);

    var ev = F.crop(root, F.A.maik, MW, 13, 258, 318, 150, 1.3, "left:880px;top:520px");
    tl.fromTo(ev, { opacity: 0, x: 160, z: -220, rotationY: 22 }, { opacity: 1, x: 0, z: 90, rotationY: 8, duration: 0.65, ease: "power3.out" }, 2.05);
    tl.to(ev, { opacity: 0, x: 60, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, 3.7);


    // Handoff to ICU: copy clears, phone swings back to the left.
    F.copyOut(tl, c, D - 0.45);
    tl.to(wm, { opacity: 0, duration: 0.3 }, D - 0.45);
    tl.to(ph.wrap, { x: 760, scale: 0.96, rotationY: -16, duration: 0.55, ease: "power2.in" }, D - 0.55);
  }
});
