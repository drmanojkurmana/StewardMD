/* 00 · Background (0-45 s). Clean white field with the site's faint grid near the centre and two
   soft glows: StewardMD teal, plus an accent that follows the capability on screen. */
FILM.section({
  id: "r00-background", start: 0, duration: 45, z: 0,
  build: function (root, tl) {
    var F = FILM, T = F.T;
    F.el(root, "bg-base");
    var grid = F.el(root, "bg-grid");
    var a = F.el(root, "glow", "width:1100px;height:1100px;left:-10px;top:420px;background:#5fd4c2");
    var b = F.el(root, "glow", "width:900px;height:900px;left:400px;top:900px;background:#8b7cf6");

    tl.to(grid, { opacity: 0.05, duration: 2.5, ease: "power1.out" }, 0.3);
    tl.fromTo(grid, { backgroundPosition: "0px 0px" }, { backgroundPosition: "60px 180px", duration: 45, ease: "none" }, 0);
    tl.fromTo(a, { opacity: 0, scale: 0.5 }, { opacity: 0.30, scale: 1, duration: 2.2, ease: "power2.out" }, 0.1);
    // slow breathing drift of the teal glow
    tl.to(a, { x: 60, y: -80, duration: 22, ease: "sine.inOut", yoyo: true, repeat: 1 }, 0);

    var cues = [
      [T.reason - 0.5, "#8b7cf6", 0.16],   // Dx violet (the workspace accent)
      [T.steward - 0.4, "#e0525c", 0.12],  // stewardship red
      [T.maik - 0.4, "#2dd4bf", 0.22],     // MaiK teal
      [T.icu - 0.4, "#e5484d", 0.14],      // ICU critical red
      [T.watch - 0.4, "#ff7a2f", 0.16],    // watch band orange
      [T.finale - 0.3, "#5fd4c2", 0.20]    // platform teal
    ];
    cues.forEach(function (c, i) {
      tl.to(b, { backgroundColor: c[1], opacity: c[2], x: (i % 2 ? -420 : 60), y: (i % 2 ? -520 : -120), duration: 1.4, ease: "power2.inOut" }, c[0]);
    });
  }
});
