/* 07 · Finale (25.4-30.0s). The five capabilities converge as one platform: the public site
   (stewardmd.in hero, as served from _site/) on a desktop display, the antibiogram on iPad, the
   home screen on iPhone and Code Blue on Apple Watch. Then the identity: the site's own line,
   "When the clinical decision matters, open StewardMD." */
FILM.section({
  id: "s07-finale", start: FILM.T.finale, duration: FILM.T.end - FILM.T.finale, z: 3,
  build: function (root, tl) {
    var F = FILM;

    var rig = F.el(root, "", "position:absolute;inset:0;transform-style:preserve-3d");

    // iPad, back left.
    var tab = F.tablet(rig, 700, 488);
    var g = document.createElement("img"); g.src = F.A.abgGrid; g.style.cssText = "position:absolute;left:0;top:0;width:100%";
    tab.screen.appendChild(g);
    // Desktop, centre.
    var DW = 980, DH = 612;
    var desk = F.desktop(rig, DW, DH);
    var s = document.createElement("img"); s.src = F.A.site; s.style.cssText = "position:absolute;left:0;top:0;width:100%";
    desk.screen.appendChild(s);
    // iPhone, front right.
    var ph = F.phone(rig);
    F.layer(ph.screen, F.A.home, { bar: "#ebebeb" });
    // Apple Watch, front right (continues exactly from section 06).
    var H = 860, W = H * 720 / 1172;
    var w = F.watch(rig, F.A.watchCode, H);

    // Arrival.
    tl.fromTo(desk.wrap, { x: (1920 - DW - 24) / 2, y: 700, opacity: 0, rotationX: 18 },
      { x: (1920 - DW - 24) / 2, y: 96, opacity: 1, rotationX: 0, duration: 1.1, ease: "expo.out" }, 0);
    tl.fromTo(tab.wrap, { x: -700, y: 330, rotationY: 40, opacity: 0 },
      { x: 150, y: 300, rotationY: 20, opacity: 1, duration: 1.15, ease: "expo.out" }, 0.08);
    tl.fromTo(ph.wrap, { x: 2200, y: 200, scale: 0.72, rotationY: -40 },
      { x: 1290, y: 150, scale: 0.72, rotationY: -16, duration: 1.15, ease: "expo.out" }, 0.12);
    tl.fromTo(w, { x: 1336, y: 330, scale: 0.36 }, { x: 1440, y: 390, scale: 0.34, rotationZ: -4, duration: 1.1, ease: "expo.out" }, 0);
    tl.to(s, { y: -40, duration: 2.2, ease: "power1.inOut" }, 0.4);

    // Hold: gentle camera drift.
    tl.fromTo(rig, { scale: 1, rotationY: 0 }, { scale: 1.035, rotationY: -2, duration: 2.4, ease: "sine.inOut" }, 0);

    // The five, named once, as one row.
    var row = F.el(root, "", "position:absolute;left:0;right:0;top:968px;display:flex;justify-content:center;gap:14px");
    ["Reason", "Steward", "Ask MaiK", "Monitor", "On the wrist"].forEach(function (t) { F.el(row, "chip", "", '<span class="dot"></span>' + t); });
    tl.from(row.children, { y: 24, opacity: 0, duration: 0.45, stagger: 0.08, ease: "power3.out" }, 0.55);

    // Identity: devices recede into the light, the line lands.
    tl.to(rig, { scale: 0.8, opacity: 0, filter: "blur(14px)", duration: 0.75, ease: "power3.in" }, 2.2);
    tl.to(row, { opacity: 0, y: 16, duration: 0.45, ease: "power2.in" }, 2.3);

    var end = F.el(root, "", "position:absolute;left:0;right:0;top:0;height:1080px;text-align:center");
    var mk = document.createElement("img"); mk.src = F.A.markWhite;
    mk.style.cssText = "position:absolute;left:50%;top:232px;width:112px;height:112px;margin-left:-56px;filter:drop-shadow(0 0 30px rgba(95,212,194,.6))";
    end.appendChild(mk);
    var line = F.el(end, "headline", "position:absolute;left:0;right:0;top:384px;font-size:84px;line-height:1.04",
      "When the clinical decision matters,<br><em>open StewardMD.</em>");
    var url = F.el(end, "", "position:absolute;left:0;right:0;top:624px;font:600 26px Inter;letter-spacing:.18em;color:#dff5f0", "STEWARDMD.IN");
    var fine = F.el(end, "fine", "position:absolute;left:0;right:0;top:980px", "Clinical decision support for registered medical practitioners.");

    tl.fromTo(mk, { scale: 0.5, opacity: 0, filter: "blur(12px) drop-shadow(0 0 30px rgba(95,212,194,.6))" },
      { scale: 1, opacity: 1, filter: "blur(0px) drop-shadow(0 0 30px rgba(95,212,194,.6))", duration: 0.8, ease: "expo.out" }, 2.55);
    tl.from(line, { y: 40, opacity: 0, filter: "blur(12px)", duration: 0.9, ease: "power3.out" }, 2.72);
    tl.from(url, { y: 16, opacity: 0, letterSpacing: ".4em", duration: 0.7, ease: "power3.out" }, 3.15);
    tl.from(fine, { opacity: 0, duration: 0.6 }, 3.3);
    tl.fromTo(end, { scale: 1 }, { scale: 1.025, duration: 2.1, ease: "none" }, 2.5);
  }
});
