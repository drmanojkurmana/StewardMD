/* StewardMD — iOS-style large titles that collapse on scroll (large-title.js).
 *
 * On any scrolling screen that starts with a large title (an <h1>, a "*bigt*" / "*large-title*"
 * element, or home's greeting), scrolling:
 *   - shrinks and fades the large title as it slides under the top bar,
 *   - frosts the bar (blur + translucency) and draws its hairline once content is under it,
 *   - stretches the large title slightly on an over-pull at the top (iOS rubber band).
 *
 * Generic: one passive capture-phase scroll listener; each scroller's title and bar are found
 * on its first scroll and cached. transform/opacity only, one rAF per frame.
 * Kill switch: localStorage smd_large_title=0. */
(function () {
  "use strict";
  // p: 0 = title fully shown, 1 = fully collapsed under the bar.
  function progress(scrollTop, titleBottom) { return Math.max(0, Math.min(1, scrollTop / Math.max(24, titleBottom))); }
  function titleStyle(scrollTop, p) {
    if (scrollTop < 0) return { s: 1 + Math.min(0.08, -scrollTop / 600), o: 1 };   // over-pull: grow a touch
    return { s: 1 - 0.12 * p, o: 1 - Math.min(1, p * 1.25) };
  }
  var seam = { progress: progress, titleStyle: titleStyle };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_large_title") === "0") return; } catch (e) {}
  window.SMD_LT_SEAM = seam;

  var LT_SEL = "h1,[class*='bigt'],[class*='large-title'],.rnav-hi";
  var st = new WeakMap(), pending = [], raf = 0;
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  function setup(sc) {
    var sr = sc.getBoundingClientRect();
    if (sr.height < 300 || sr.width < innerWidth * 0.8) return null;
    // Large title: in the first 220px of the scroller's content, big and bold.
    var cands = sc.querySelectorAll(LT_SEL), lt = null;
    for (var i = 0; i < cands.length && i < 8; i++) {
      var c = cands[i], top = c.getBoundingClientRect().top - sr.top + sc.scrollTop;
      if (top > 220) break;
      if ((parseFloat(getComputedStyle(c).fontSize) || 0) >= 22 && c.textContent.trim().length <= 60) { lt = c; break; }
    }
    if (!lt) return null;
    // Bar: whatever sits just above the scroller's top edge (a sibling header), or a sticky first child.
    var bar = null, probe = document.elementFromPoint(sr.left + sr.width / 2, Math.max(0, sr.top - 3));
    if (probe && !sc.contains(probe)) {
      for (var n = probe; n && n !== document.body; n = n.parentElement) {
        if (n.parentElement && n.parentElement.contains(sc) && !n.contains(sc)) { bar = n; break; }
      }
    }
    if (!bar) {
      var f = sc.firstElementChild;
      if (f && /sticky|fixed/.test(getComputedStyle(f).position) && !f.contains(lt)) bar = f;
    }
    var bcs = bar ? getComputedStyle(bar) : null;
    var s = { lt: lt, bar: bar, bg: bcs ? bcs.backgroundColor : "", ltBottom: lt.getBoundingClientRect().bottom - sr.top + sc.scrollTop,
              frost: !!(bar && /sticky|fixed/.test(bcs.position)), on: false };
    lt.style.transformOrigin = "0 100%";
    lt.style.willChange = "transform,opacity";
    return s;
  }

  function apply(sc) {
    var s = st.get(sc);
    if (s === undefined || (s && !s.lt.isConnected)) { s = setup(sc); st.set(sc, s); }
    if (!s) return;
    var top = sc.scrollTop, p = progress(top, s.ltBottom), t = titleStyle(top, p);
    if (!reduced()) s.lt.style.transform = t.s === 1 ? "" : "scale(" + t.s.toFixed(4) + ")";
    s.lt.style.opacity = t.o >= 1 ? "" : t.o.toFixed(3);
    var on = top > 2;
    if (s.bar && on !== s.on) {
      s.on = on;
      s.bar.style.transition = "box-shadow .2s linear,background-color .2s linear";
      s.bar.style.boxShadow = on ? "0 .5px 0 rgba(0,0,0,.14)" : "";
      if (s.frost && s.bg && s.bg !== "rgba(0, 0, 0, 0)") {
        s.bar.style.backgroundColor = on ? "color-mix(in srgb, " + s.bg + " 78%, transparent)" : "";
        s.bar.style.webkitBackdropFilter = s.bar.style.backdropFilter = on ? "saturate(180%) blur(20px)" : "";
      }
    }
  }

  document.addEventListener("scroll", function (e) {
    var sc = e.target;
    if (!sc || sc.nodeType !== 1 || sc === document.documentElement) return;
    if (pending.indexOf(sc) < 0) pending.push(sc);
    if (!raf) raf = requestAnimationFrame(function () { raf = 0; var l = pending; pending = []; for (var i = 0; i < l.length; i++) { try { apply(l[i]); } catch (x) {} } });
  }, { capture: true, passive: true });
})();
