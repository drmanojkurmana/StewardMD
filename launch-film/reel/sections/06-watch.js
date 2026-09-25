/* 06 · Capability 5: on the wrist (32.5-38.5 s). The repo's own Apple Watch Ultra renders of the
   native watchOS app (ios/StewardMDWatch: CriticalLabsView, CodeBlueView): a Lab Watch critical-lab
   alert, then the Code Blue timer, with the ICU phone behind. Wear OS ships the same companion
   (android/wear: labs, Code Blue); it is named in the copy, as on the site, not drawn. */
FILM.section({
  id: "r06-watch", start: FILM.T.watch, duration: FILM.T.finale - FILM.T.watch, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.finale - F.T.watch, R = F.RECTS.icu;
    var H = 980, W = H * 720 / 1172;

    var halo = F.el(root, "", "position:absolute;left:280px;top:620px;width:760px;height:760px;border-radius:50%;filter:blur(90px);background:#ff5a4f;opacity:0");
    var ph = F.phone(root);
    gsap.set(ph.wrap, { x: 96, y: 520, scale: 0.72, rotationY: 16, filter: "blur(2px)", transformPerspective: 2600 });
    var icu = F.layer(ph.screen, F.A.icu, { bar: "#b42332" });
    gsap.set(icu.img, { y: -(R.qsofa[1] - 640) * F.PS });
    ph.status.className = "status light";
    tl.to(ph.wrap, { y: 490, duration: D, ease: "sine.inOut" }, 0);

    var w = F.watch(root, F.A.watchLabs, H);
    var code = document.createElement("img"); code.src = F.A.watchCode;
    code.style.cssText = "position:absolute;inset:0;width:100%;height:100%;opacity:0";
    w.appendChild(code);

    var WX = 640 - W / 2, WY = 640;
    tl.fromTo(w, { x: WX, y: 2000, rotationX: 38, rotationZ: -10, scale: 0.8, transformPerspective: 2000 },
      { x: WX, y: WY, rotationX: 0, rotationZ: -3, scale: 1, duration: 1.3, ease: "expo.out" }, 0.1);
    tl.to(halo, { opacity: 0.22, duration: 1.0 }, 0.6);
    tl.to(w, { rotationZ: 2, rotationY: -7, y: WY - 16, duration: 3.6, ease: "sine.inOut" }, 1.4);

    tl.to(w, { scale: 0.97, duration: 0.16, yoyo: true, repeat: 1, ease: "power1.inOut" }, 2.9);
    tl.to(code, { opacity: 1, duration: 0.3, ease: "power1.inOut" }, 2.98);

    var c = F.rcopy(root, "05", "On the wrist", "Critical labs and Code Blue, <em>on your wrist.</em>",
      "The same critical alert reaches your phone and your Apple Watch or Wear OS.");
    F.rcopyIn(tl, c, 0.45);

    F.rcopyOut(tl, c, D - 0.8);
    tl.to(w, { x: 790 - W / 2, y: 1000, scale: 0.34, rotationZ: -4, rotationY: 0, duration: 0.75, ease: "power3.inOut" }, D - 0.75);
    tl.to(halo, { opacity: 0, duration: 0.6 }, D - 0.75);
  }
});
