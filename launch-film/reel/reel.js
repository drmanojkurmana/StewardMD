/* StewardMD 9:16 Instagram Reel (1080 x 1920, 45 s) on top of film/lib.js.
 *
 * Same HyperFrames contract and helpers as the 16:9 film; this file only swaps the canvas, the
 * cue sheet and adds the vertical-format pieces: an Android phone body, landscape screen layers,
 * word-masked headlines. StewardMD ships as a mobile app (iOS + Android) with an Apple Watch and a
 * Wear OS companion, so the reel shows phones and a watch only: no tablet, no desktop.
 *
 * Pacing is ~0.8x the film: every motion is ~1.25x longer and each capability holds ~7 s so the
 * copy and the real UI read comfortably on a phone.
 */
(function () {
  "use strict";
  var F = window.FILM;
  F.W = 1080; F.H = 1920; F.FPS = 30; F.DURATION = 45;
  F.T = { open: 0, reason: 4.5, steward: 11.5, maik: 18.5, icu: 25.5, watch: 32.5, finale: 38.5, end: 45 };

  // Hero phone: 408 x 850 body at scale 1.3, centred at (540, 1195). Visual 530 x 1105,
  // y 643-1748. Copy sits above it (y 230-600), inside Instagram's safe area.
  F.RP = { x: 336, y: 770, s: 1.3 };
  F.A.maik1 = "../../_site/assets/s/maik.png";           // 640 px native, sharper than maik-2 for 9:16
  F.A.abgLand = "../assets/screens/antibiogram-grid-phone-landscape-tall.jpg";
  F.A.maikColor = "../../maik-wordmark-color.png";

  F.placeHero = function (wrap) { gsap.set(wrap, { x: F.RP.x, y: F.RP.y, scale: F.RP.s, transformPerspective: 2600 }); };

  // Landscape layer inside a portrait screen: rotated +90deg so that when the phone body turns
  // -90deg the content reads upright. iOS landscape: no status bar, 44 px safe-area insets.
  F.landLayer = function (screen, src, cssW) {
    var LW = 822, LH = 380, INS = 44;
    var L = F.el(screen, "layer", "position:absolute;width:" + LW + "px;height:" + LH + "px;left:" + ((380 - LW) / 2) + "px;top:" + ((822 - LH) / 2) +
      "px;transform:rotate(90deg);overflow:hidden;background:#F5F8F9");
    var view = F.el(L, "", "position:absolute;left:" + INS + "px;right:" + INS + "px;top:0;bottom:0;overflow:hidden;background:#fff");
    var img = document.createElement("img"); img.src = src;
    img.style.cssText = "position:absolute;left:0;top:0;width:100%;display:block";
    view.appendChild(img);
    L.img = img; L.k = (LW - 2 * INS) / cssW;   // film px per app CSS px
    return L;
  };

  // Headline words wrapped for a masked rise (each word slides up inside its own clip).
  F.splitWords = function (el) {
    var words = [];
    function walk(node, into) {
      Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) {
          ch.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { into.appendChild(document.createTextNode(" ")); return; }
            var w = document.createElement("span"); w.className = "w";
            var i = document.createElement("span"); i.className = "wi"; i.textContent = part;
            w.appendChild(i); into.appendChild(w); words.push(i);
          });
        } else if (ch.nodeName === "BR") {
          into.appendChild(document.createElement("br"));
        } else {
          var clone = ch.cloneNode(false); into.appendChild(clone); walk(ch, clone);
        }
      });
    }
    var holder = document.createElement("div");
    walk(el, holder);
    el.innerHTML = ""; while (holder.firstChild) el.appendChild(holder.firstChild);
    return words;
  };

  // Reel copy block: centred, kicker "01 / 05 · REASON", masked headline, one-line sub.
  F.rcopy = function (parent, num, label, headline, sub, top) {
    var c = F.copy(parent, num + " / 05", label, headline, sub, "left:70px;right:70px;width:auto;top:" + (top || 236) + "px;text-align:center");
    c.words = F.splitWords(c.headline);
    return c;
  };
  F.rcopyIn = function (tl, c, at) {
    tl.from(c.kicker, { y: 16, opacity: 0, duration: 0.7, ease: "power3.out" }, at);
    tl.from(c.words, { yPercent: 115, duration: 1.1, stagger: 0.055, ease: "expo.out" }, at + 0.1);
    if (c.sub) tl.from(c.sub, { y: 18, opacity: 0, duration: 0.8, ease: "power3.out" }, at + 0.55);
  };
  F.rcopyOut = function (tl, c, at) {
    tl.to(c.words, { yPercent: -115, duration: 0.5, stagger: 0.02, ease: "power3.in" }, at);
    tl.to([c.kicker, c.sub].filter(Boolean), { opacity: 0, y: -12, duration: 0.4, ease: "power2.in" }, at);
  };

  // Lifted card for the reel: centred horizontally at `cx` (default frame centre), top at `top`.
  F.rlift = function (parent, src, imgCssW, x, y, w, h, scale, top, cx, css) {
    cx = cx == null ? 540 : cx;
    return F.crop(parent, src, imgCssW, x, y, w, h, scale, "left:" + (cx - w * scale / 2) + "px;top:" + top + "px;" + (css || ""));
  };
  F.liftIn = function (tl, el, at, from) {
    tl.fromTo(el, Object.assign({ opacity: 0, y: 70, scale: 0.9, rotationX: 22, transformPerspective: 1600, filter: "blur(10px)" }, from || {}),
      { opacity: 1, y: 0, scale: 1, rotationX: 0, filter: "blur(0px)", duration: 0.85, ease: "expo.out" }, at);
    tl.to(el, { y: -14, duration: 1.6, ease: "sine.inOut" }, at + 0.85);
  };
  F.liftOut = function (tl, el, at) {
    tl.to(el, { opacity: 0, y: "-=40", scale: 0.96, filter: "blur(8px)", duration: 0.5, ease: "power2.in" }, at);
  };
})();
