/* 01 · Opening (0-4.5 s). On white: the StewardMD mark resolves on two heartbeat pulses, the
   wordmark (app header style, "Steward" + teal "MD") wipes in with a letter-clipped sheen, the
   site's kicker lands; the identity lifts away as the iPhone rises with the real home screen. */
FILM.section({
  id: "r01-open", start: FILM.T.open, duration: FILM.T.reason - FILM.T.open, z: 2,
  build: function (root, tl) {
    var F = FILM, D = F.T.reason - F.T.open;

    var group = F.el(root, "", "position:absolute;left:0;right:0;top:640px;height:600px;text-align:center");
    var markWrap = F.el(group, "", "position:absolute;left:50%;top:0;width:210px;height:210px;margin-left:-105px");
    var ring1 = F.el(markWrap, "", "position:absolute;inset:-14px;border-radius:50%;box-shadow:0 0 0 2px rgba(15,118,110,.55)");
    var ring2 = F.el(markWrap, "", "position:absolute;inset:-14px;border-radius:50%;box-shadow:0 0 0 2px rgba(15,118,110,.4)");
    var mark = document.createElement("img"); mark.src = F.A.markTeal;
    mark.style.cssText = "position:absolute;inset:0;width:210px;height:210px";
    markWrap.appendChild(mark);

    var WM = "position:absolute;left:0;right:0;top:268px;font:700 128px/1 Inter;letter-spacing:-.035em;white-space:nowrap;";
    var word = F.el(group, "", WM + "color:#0D1B24", 'Steward<span style="color:#0F766E">MD</span>');
    var sheen = F.el(group, "", WM + "color:transparent;background:linear-gradient(100deg,transparent 40%,rgba(255,255,255,.9) 50%,transparent 60%);" +
      "background-size:300% 100%;background-position:100% 0;-webkit-background-clip:text;background-clip:text", "Steward<span>MD</span>");
    var kick = F.el(group, "", "position:absolute;left:0;right:0;top:440px;font:600 21px Inter;letter-spacing:.34em;color:#0F766E",
      '<span style="display:inline-block;width:52px;height:1px;background:#0F766E;vertical-align:middle;margin-right:24px;opacity:.6"></span>CLINICAL INTELLIGENCE WORKSPACE<span style="display:inline-block;width:52px;height:1px;background:#0F766E;vertical-align:middle;margin-left:24px;opacity:.6"></span>');

    tl.fromTo(mark, { scale: 0.5, opacity: 0, filter: "blur(20px)" }, { scale: 1, opacity: 1, filter: "blur(0px)", duration: 1.1, ease: "expo.out" }, 0.2);
    tl.fromTo(ring1, { scale: 0.7, opacity: 0.9 }, { scale: 2.4, opacity: 0, duration: 1.1, ease: "power2.out" }, 0.35);
    tl.fromTo(ring2, { scale: 0.7, opacity: 0.7 }, { scale: 2.9, opacity: 0, duration: 1.25, ease: "power2.out" }, 0.78);
    tl.fromTo(markWrap, { scale: 1 }, { scale: 1.07, duration: 0.15, yoyo: true, repeat: 1, ease: "power1.inOut" }, 0.78);

    tl.fromTo(word, { clipPath: "inset(0 100% 0 0)", y: 12 }, { clipPath: "inset(0 0% 0 0)", y: 0, duration: 0.85, ease: "power3.inOut" }, 0.7);
    tl.fromTo(sheen, { backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0", duration: 1.0, ease: "power2.inOut" }, 1.75);
    tl.from(kick, { y: 18, opacity: 0, letterSpacing: ".6em", duration: 0.9, ease: "power3.out" }, 1.2);

    tl.fromTo(group, { scale: 0.97 }, { scale: 1.02, duration: 3.2, ease: "none" }, 0);
    tl.to(group, { y: -260, scale: 0.9, opacity: 0, filter: "blur(12px)", duration: 0.7, ease: "power3.in" }, 2.9);

    var ph = F.phone(root);
    F.layer(ph.screen, F.A.home, { bg: "#F5F8F9", bar: "#ebebeb" });
    F.placeHero(ph.wrap);
    tl.fromTo(ph.wrap, { y: 2250, rotationX: 32, scale: 1.1 }, { y: F.RP.y, rotationX: 0, scale: F.RP.s, duration: 1.15, ease: "power3.out" }, D - 1.15);
    tl.fromTo(ph.wrap.querySelector(".phone-glare"), { backgroundPosition: "110% 0" }, { backgroundPosition: "-40% 0", duration: 1.5, ease: "power2.inOut" }, D - 1.1);
  }
});
