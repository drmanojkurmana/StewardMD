/* 01 · Opening (0-3.0s). The StewardMD mark resolves on two heartbeat pulses, the wordmark
   (app header styling: "Steward" + teal "MD") wipes in, the site's kicker line lands, then
   the identity lifts away as the phone rises into the first capability. */
FILM.section({
  id: "s01-open", start: FILM.T.open, duration: FILM.T.reason - FILM.T.open, z: 2,
  build: function (root, tl) {
    var F = FILM, D = F.T.reason - F.T.open;

    var group = F.el(root, "", "position:absolute;left:0;right:0;top:370px;height:340px;text-align:center");
    var markWrap = F.el(group, "", "position:absolute;left:50%;top:-20px;width:170px;height:170px;margin-left:-85px");
    var ring1 = F.el(markWrap, "", "position:absolute;inset:-10px;border-radius:50%;box-shadow:0 0 0 2px rgba(95,212,194,.8)");
    var ring2 = F.el(markWrap, "", "position:absolute;inset:-10px;border-radius:50%;box-shadow:0 0 0 2px rgba(95,212,194,.6)");
    var mark = document.createElement("img"); mark.src = F.A.markWhite;
    mark.style.cssText = "position:absolute;inset:0;width:170px;height:170px;filter:drop-shadow(0 0 24px rgba(95,212,194,.55))";
    markWrap.appendChild(mark);

    var word = F.el(group, "", "position:absolute;left:0;right:0;top:178px;font:700 104px/1 Inter;letter-spacing:-.035em;color:#F4F8F7;white-space:nowrap",
      'Steward<span style="color:#5fd4c2">MD</span>');
    // Sheen: a copy of the wordmark filled with a moving highlight, clipped to the letterforms.
    var sheen = F.el(group, "", "position:absolute;left:0;right:0;top:178px;font:700 104px/1 Inter;letter-spacing:-.035em;white-space:nowrap;color:transparent;" +
      "background:linear-gradient(100deg,transparent 40%,rgba(255,255,255,.85) 50%,transparent 60%);background-size:300% 100%;background-position:100% 0;" +
      "-webkit-background-clip:text;background-clip:text", "Steward<span>MD</span>");
    var kick = F.el(group, "", "position:absolute;left:0;right:0;top:318px;font:600 17px Inter;letter-spacing:.34em;color:#5fd4c2",
      '<span style="display:inline-block;width:46px;height:1px;background:#5fd4c2;vertical-align:middle;margin-right:22px;opacity:.7"></span>CLINICAL INTELLIGENCE WORKSPACE<span style="display:inline-block;width:46px;height:1px;background:#5fd4c2;vertical-align:middle;margin-left:22px;opacity:.7"></span>');

    // Mark: two pulses, like a heartbeat, then settle.
    tl.fromTo(mark, { scale: 0.55, opacity: 0, filter: "blur(18px) drop-shadow(0 0 24px rgba(95,212,194,.55))" },
      { scale: 1, opacity: 1, filter: "blur(0px) drop-shadow(0 0 24px rgba(95,212,194,.55))", duration: 0.9, ease: "expo.out" }, 0.15);
    tl.fromTo(ring1, { scale: 0.7, opacity: 0.9 }, { scale: 2.3, opacity: 0, duration: 0.9, ease: "power2.out" }, 0.28);
    tl.fromTo(ring2, { scale: 0.7, opacity: 0.7 }, { scale: 2.8, opacity: 0, duration: 1.0, ease: "power2.out" }, 0.62);
    tl.fromTo(markWrap, { scale: 1 }, { scale: 1.07, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.inOut" }, 0.62);

    // Wordmark wipes in from the left, then a sheen crosses it.
    tl.fromTo(word, { clipPath: "inset(0 100% 0 0)", y: 10 }, { clipPath: "inset(0 0% 0 0)", y: 0, duration: 0.7, ease: "power3.inOut" }, 0.55);
    tl.fromTo(sheen, { backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0", duration: 0.8, ease: "power2.inOut" }, 1.3);
    tl.from(kick, { y: 16, opacity: 0, letterSpacing: ".6em", duration: 0.7, ease: "power3.out" }, 0.95);

    // Slow push-in over the hold, then lift away.
    tl.fromTo(group, { scale: 0.97 }, { scale: 1.02, duration: 2.3, ease: "none" }, 0);
    tl.to(group, { y: -170, scale: 0.9, opacity: 0, filter: "blur(10px)", duration: 0.55, ease: "power3.in" }, 1.95);

    // Phone rises into the first capability's position, showing the real home screen.
    var ph = F.phone(root);
    var home = F.layer(ph.screen, F.A.home, { bg: "#F5F8F9", bar: "#ebebeb" });
    tl.fromTo(ph.wrap, { x: F.PL.x + 90, y: 1180, rotationX: 28, rotationY: 14, scale: 0.9 },
      { x: F.PL.x, y: F.PL.y, rotationX: 0, rotationY: 0, scale: 1, duration: 0.85, ease: "power3.out" }, D - 0.85);
    tl.fromTo(ph.wrap.querySelector(".phone-glare"), { backgroundPosition: "110% 0" }, { backgroundPosition: "-40% 0", duration: 1.2, ease: "power2.inOut" }, D - 0.9);
  }
});
