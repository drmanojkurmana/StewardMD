/* 06 · Capability 5: StewardMD on Apple Watch (21.4-25.4s).
   The repo's own Apple Watch Ultra renders (_site/assets/s/watch-frame-*.png) of the native
   watchOS app (ios/StewardMDWatch: CriticalLabsView, CodeBlueView): a Lab Watch critical-lab
   alert, then the Code Blue timer. */
FILM.section({
  id: "s06-watch", start: FILM.T.watch, duration: FILM.T.finale - FILM.T.watch, z: 3,
  build: function (root, tl) {
    var F = FILM, D = F.T.finale - F.T.watch;
    var H = 860, W = H * 720 / 1172;

    var w = F.watch(root, F.A.watchLabs, H);
    var code = document.createElement("img"); code.src = F.A.watchCode;
    code.style.cssText = "position:absolute;inset:0;width:100%;height:100%;opacity:0";
    w.appendChild(code);
    // A soft screen glow that picks up the alert colours.
    var halo = F.el(root, "", "position:absolute;left:" + (560 - 330) + "px;top:220px;width:660px;height:660px;border-radius:50%;filter:blur(80px);background:#ff3b30;opacity:0");

    root.insertBefore(halo, w);
    tl.fromTo(w, { x: 560 - W / 2, y: 900, rotationX: 34, rotationZ: -8, scale: 0.8 },
      { x: 560 - W / 2, y: 110, rotationX: 0, rotationZ: -3, scale: 1, duration: 1.0, ease: "power3.out" }, 0.05);
    tl.to(halo, { opacity: 0.32, duration: 0.8 }, 0.5);
    tl.to(w, { rotationZ: 2, rotationY: -6, duration: 2.9, ease: "sine.inOut" }, 1.05);

    // Wrist flick to Code Blue.
    tl.to(w, { scale: 0.97, duration: 0.14, yoyo: true, repeat: 1, ease: "power1.inOut" }, 2.0);
    tl.to(code, { opacity: 1, duration: 0.25, ease: "power1.inOut" }, 2.08);
    tl.to(halo, { backgroundColor: "#ff453a", opacity: 0.4, duration: 0.3 }, 2.08);

    var c = F.copy(root, "05", "On the wrist",
      "Critical labs and Code Blue, <em>on Apple Watch.</em>",
      "Lab Watch alerts for your patients, and a Code Blue timer with CPR compression feedback, synced from the phone.",
      "left:1060px;top:318px");
    F.copyIn(tl, c, 0.35);

    // Handoff to the finale: the watch pulls back and up into the converging platform.
    F.copyOut(tl, c, D - 0.45);
    tl.to(w, { x: 1336, y: 330, scale: 0.36, rotationZ: 0, rotationY: 0, duration: 0.6, ease: "power3.in" }, D - 0.6);
    tl.to(halo, { opacity: 0, duration: 0.5 }, D - 0.6);
  }
});
