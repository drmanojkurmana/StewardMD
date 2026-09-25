/* 07 · Finale (38.5-45 s). One workspace, pocket to wrist: iPad (antibiogram), iPhone (home), an
   Android phone (the same app, ranked differential) and Apple Watch (Code Blue) converge with the five capabilities
   named; then the end card on white with the site's own line, the real platforms (iPhone, iPad,
   Android, Apple Watch, Wear OS) and the one web surface, OPD. */
FILM.section({
  id: "r07-finale", start: FILM.T.finale, duration: FILM.T.end - FILM.T.finale, z: 3,
  build: function (root, tl) {
    var F = FILM, R = F.RECTS.icu;
    var rig = F.el(root, "", "position:absolute;inset:0;transform-style:flat");

    // iPad (back), Android, iPhone, Watch (front): flat rig, own perspective each, DOM stacking.
    var tab = F.tablet(rig, 720, 500);
    var g = document.createElement("img"); g.src = F.A.abgGrid; g.style.cssText = "position:absolute;left:0;top:0;width:100%";
    tab.screen.appendChild(g);
    var an = F.android(rig);
    var dxr = F.layer(an.screen, F.A.dxr, { bar: "#ffffff" });
    gsap.set(dxr.img, { y: -470 * F.PS });
    var ph = F.phone(rig);
    var icu = F.layer(ph.screen, F.A.icu, { bar: "#b42332" });
    gsap.set(icu.img, { y: -(R.qsofa[1] - 640) * F.PS });
    var home = F.layer(ph.screen, F.A.home, { bar: "#ebebeb" });
    ph.status.style.zIndex = 8;
    var H = 980, W = H * 720 / 1172;
    var w = F.watch(rig, F.A.watchCode, H);
    [tab.wrap, an.wrap, ph.wrap, w].forEach(function (d) { d.style.transformStyle = "flat"; });

    tl.fromTo(ph.wrap, { x: 96, y: 490, scale: 0.72, rotationY: 16, filter: "blur(2px)", transformPerspective: 2600 },
      { x: 176, y: 745, scale: 0.78, rotationY: 10, filter: "blur(0px)", duration: 1.2, ease: "expo.out" }, 0);
    tl.fromTo(tab.wrap, { x: 162, y: 1300, opacity: 0, rotationX: 24, transformPerspective: 2600 },
      { x: 162, y: 625, opacity: 1, rotationX: 0, duration: 1.3, ease: "expo.out" }, 0.05);
    tl.to(g, { y: -260, duration: 2.6, ease: "power1.inOut" }, 0.5);
    tl.fromTo(home, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.25);
    tl.fromTo(ph.status, { color: "#ffffff" }, { color: "#0D1B24", duration: 0.3 }, 0.3);
    tl.fromTo(an.wrap, { x: 1300, y: 560, scale: 0.74, rotationY: -40, transformPerspective: 2600 },
      { x: 516, y: 705, scale: 0.74, rotationY: -12, duration: 1.35, ease: "expo.out" }, 0.12);
    tl.fromTo(w, { x: 790 - W / 2, y: 1000, scale: 0.34, rotationZ: -4, transformPerspective: 2000 },
      { x: 870 - W / 2, y: 1000, scale: 0.36, rotationZ: -6, duration: 1.2, ease: "expo.out" }, 0);
    tl.fromTo(rig, { y: 0, scale: 1 }, { y: -18, scale: 1.03, duration: 3.1, ease: "sine.inOut" }, 0);

    // Top: the platforms and the five, named once.
    var top = F.el(root, "", "position:absolute;left:70px;right:70px;top:250px;text-align:center");
    var plat = F.el(top, "", "font:600 19px Inter;letter-spacing:.26em;color:#0F766E;margin-bottom:26px", "IPHONE · IPAD · ANDROID · APPLE WATCH · WEAR OS");
    var head = F.el(top, "headline", "font-size:74px", "One workspace, <em>pocket to wrist.</em>");
    var words = F.splitWords(head);
    var row = F.el(top, "", "margin:34px auto 0;max-width:640px;display:flex;flex-wrap:wrap;justify-content:center;gap:14px");
    ["Reason", "Steward", "Ask MaiK", "Monitor", "On the wrist"].forEach(function (t) { F.el(row, "chip", "", '<span class="dot"></span>' + t); });
    tl.from(plat, { y: 14, opacity: 0, duration: 0.7, ease: "power3.out" }, 0.35);
    tl.from(words, { yPercent: 115, duration: 1.0, stagger: 0.05, ease: "expo.out" }, 0.45);
    tl.from(row.children, { y: 22, opacity: 0, scale: 0.92, duration: 0.6, stagger: 0.08, ease: "back.out(1.6)" }, 0.95);

    // End card.
    tl.to(rig, { scale: 0.86, opacity: 0, filter: "blur(16px)", duration: 0.8, ease: "power3.in" }, 3.0);
    tl.to(top, { opacity: 0, y: -24, filter: "blur(8px)", duration: 0.55, ease: "power2.in" }, 2.95);

    var end = F.el(root, "", "position:absolute;left:0;right:0;top:0;height:1920px;text-align:center");
    var mkw = F.el(end, "", "position:absolute;left:50%;top:520px;width:170px;height:170px;margin-left:-85px");
    var ring = F.el(mkw, "", "position:absolute;inset:-12px;border-radius:50%;box-shadow:0 0 0 2px rgba(15,118,110,.45);opacity:0");
    var mk = document.createElement("img"); mk.src = F.A.markTeal; mk.style.cssText = "position:absolute;inset:0;width:170px;height:170px";
    mkw.appendChild(mk);
    var line = F.el(end, "headline", "position:absolute;left:40px;right:40px;top:760px;font-size:98px;line-height:1.03",
      "When the clinical<br>decision matters,<br><em>open StewardMD.</em>");
    var lw = F.splitWords(line);
    var p1 = F.el(end, "", "position:absolute;left:0;right:0;top:1112px;font:600 22px Inter;letter-spacing:.24em;color:#0D1B24;opacity:.8", "IPHONE · IPAD · ANDROID · APPLE WATCH · WEAR OS");
    var p2 = F.el(end, "", "position:absolute;left:0;right:0;top:1164px;font:600 22px Inter;letter-spacing:.24em;color:#0F766E", "OPD ON THE WEB · STEWARDMD.IN");
    var fine = F.el(end, "fine", "position:absolute;left:0;right:0;top:1395px", "Clinical decision support for registered medical practitioners.");

    tl.fromTo(mk, { scale: 0.5, opacity: 0, filter: "blur(14px)" }, { scale: 1, opacity: 1, filter: "blur(0px)", duration: 1.0, ease: "expo.out" }, 3.3);
    tl.fromTo(ring, { scale: 0.8, opacity: 0.9 }, { scale: 2.4, opacity: 0, duration: 1.3, ease: "power2.out", immediateRender: false }, 3.4);
    tl.from(lw, { yPercent: 115, duration: 1.15, stagger: 0.06, ease: "expo.out" }, 3.45);
    tl.from(p1, { y: 14, opacity: 0, duration: 0.8, ease: "power3.out" }, 4.05);
    tl.from(p2, { y: 14, opacity: 0, letterSpacing: ".4em", duration: 0.9, ease: "power3.out" }, 4.2);
    tl.from(fine, { opacity: 0, duration: 0.7 }, 4.45);
    tl.fromTo(end, { scale: 1 }, { scale: 1.02, duration: 3.2, ease: "none" }, 3.3);
  }
});
