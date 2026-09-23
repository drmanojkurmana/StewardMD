/* 00 · Background track (0-30s). Deep StewardMD teal field, faint site grid, and two glows
   whose colour follows the capability on screen: dx violet, stewardship red, MaiK teal,
   ICU critical red, Watch band orange, finale teal. */
FILM.section({
  id: "s00-background", start: 0, duration: 30, z: 0,
  build: function (root, tl) {
    var F = FILM, T = F.T;
    F.el(root, "bg-base");
    var grid = F.el(root, "bg-grid");
    var a = F.el(root, "glow", "width:1300px;height:1300px;left:310px;top:-110px;background:#0f766e");
    var b = F.el(root, "glow", "width:900px;height:900px;left:-200px;top:300px;background:#5b4fd8");

    tl.fromTo(grid, { opacity: 0, backgroundPosition: "0px 0px" }, { opacity: 0.07, duration: 2.5, ease: "power1.out" }, 0.2);
    tl.to(grid, { backgroundPosition: "64px 128px", duration: 30, ease: "none" }, 0);

    // Opening bloom behind the mark.
    tl.fromTo(a, { opacity: 0, scale: 0.4 }, { opacity: 0.55, scale: 1, duration: 1.6, ease: "power2.out" }, 0.1);

    // Accent glow per capability: [time, colour, x, y, opacity]
    var cues = [
      [T.reason - 0.4, "#5b4fd8", -220, 260, 0.35],
      [T.steward - 0.3, "#b3262e", -120, 330, 0.30],
      [T.maik - 0.3, "#14b8a6", 1150, 140, 0.34],
      [T.icu - 0.3, "#c8283c", -160, 240, 0.34],
      [T.watch - 0.3, "#ff6a1a", 60, 180, 0.30],
      [T.finale - 0.2, "#0f766e", 510, 120, 0.45]
    ];
    cues.forEach(function (c) {
      tl.to(b, { backgroundColor: c[1], x: c[2], y: c[3] - 300, opacity: c[4], duration: 1.0, ease: "power2.inOut" }, c[0]);
    });
    // Main teal glow drifts to sit behind whichever side the device is on.
    tl.to(a, { x: -520, y: 60, opacity: 0.38, duration: 1.2, ease: "power2.inOut" }, T.reason - 0.6);
    tl.to(a, { x: 340, y: 40, opacity: 0.42, duration: 1.2, ease: "power2.inOut" }, T.maik - 0.5);
    tl.to(a, { x: -520, y: 60, opacity: 0.36, duration: 1.2, ease: "power2.inOut" }, T.icu - 0.5);
    tl.to(a, { x: -380, y: 80, opacity: 0.30, duration: 1.2, ease: "power2.inOut" }, T.watch - 0.4);
    tl.to(a, { x: 0, y: 0, scale: 1.15, opacity: 0.6, duration: 1.4, ease: "power2.inOut" }, T.finale - 0.2);
  }
});
