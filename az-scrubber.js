/* StewardMD — A–Z scrubber for alphabetical lists (az-scrubber.js).
 *
 * A thin letter strip on the right edge, like iOS Contacts: slide a thumb down it and the list jumps
 * letter by letter, with a haptic tick for each letter and a large letter bubble beside the thumb.
 *
 * Generic: it appears when a screen shows a row of single-letter A–Z buttons (the Drug Database's
 * "A-Z" chips, `.db-az`) and presses THOSE buttons, so the list behaves exactly as if each chip were
 * tapped. Letters the screen does not offer are dimmed and skipped. Gone when the chip row is gone.
 * Kill switch: localStorage smd_az_scrub=0. */
(function () {
  "use strict";
  var ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  // y within the strip -> letter index, clamped.
  function indexAt(y, top, h, n) {
    if (h <= 0) return 0;
    return Math.max(0, Math.min(n - 1, Math.floor((y - top) / h * n)));
  }
  // The nearest available letter to a wanted index (so sliding over an absent letter lands somewhere real).
  function nearest(i, have) {
    if (have[i]) return i;
    for (var d = 1; d < have.length; d++) { if (have[i - d]) return i - d; if (have[i + d]) return i + d; }
    return -1;
  }
  var seam = { indexAt: indexAt, nearest: nearest };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_az_scrub") === "0") return; } catch (e) {}
  window.SMD_AZ_SEAM = seam;

  var strip = null, bubble = null, curIdx = -1, timer = 0;

  // The chip row on screen: a container whose visible children are >=20 single-letter A-Z buttons.
  function findChips() {
    var rows = document.querySelectorAll(".db-az, [data-az-row]");   // cheap selectors only: this runs on DOM changes
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], b = r.querySelectorAll("button");
      if (b.length >= 20 && r.getClientRects().length) {
        var map = {}, n = 0;
        [].forEach.call(b, function (x) { var t = x.textContent.trim().toUpperCase(); if (/^[A-Z]$/.test(t) && !map[t]) { map[t] = x; n++; } });
        if (n >= 20) return { row: r, map: map };
      }
    }
    return null;
  }
  function overlayVisible(row) {
    for (var n = row; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1) return false;
    }
    return true;
  }

  function build() {
    strip = document.createElement("div");
    strip.setAttribute("aria-hidden", "true");
    strip.style.cssText = "position:fixed;right:max(2px,env(safe-area-inset-right,0px));top:50%;transform:translate(8px,-50%);opacity:0;transition:opacity .2s linear,transform .28s cubic-bezier(.32,.72,0,1);z-index:2147482200;" +
      "display:flex;flex-direction:column;align-items:center;padding:6px 0;width:22px;touch-action:none;-webkit-user-select:none;user-select:none;border-radius:11px;" +
      "background:rgba(120,130,140,.14);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);pointer-events:none";
    ABC.forEach(function (L) {
      var s = document.createElement("div"); s.textContent = L; s.dataset.l = L;
      s.style.cssText = "font:700 9.5px/13px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:var(--v3-primary,#0F766E);height:13px;width:22px;text-align:center";
      strip.appendChild(s);
    });
    bubble = document.createElement("div");
    bubble.style.cssText = "position:fixed;z-index:2147482201;width:64px;height:64px;border-radius:32px;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;" +
      "background:rgba(15,23,42,.88);color:#fff;font:700 32px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;transition:opacity .12s linear;" +
      "-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)";
    document.body.appendChild(strip); document.body.appendChild(bubble);
    var id = null;
    strip.addEventListener("pointerdown", function (e) {
      id = e.pointerId; try { strip.setPointerCapture(id); } catch (x) {}
      strip.style.background = "rgba(120,130,140,.26)"; pick(e.clientY, true);
    });
    strip.addEventListener("pointermove", function (e) { if (e.pointerId === id) pick(e.clientY, false); });
    var end = function (e) {
      if (e.pointerId !== id) return; id = null;
      strip.style.background = "rgba(120,130,140,.14)"; bubble.style.opacity = "0";
      clearTimeout(dwell); if (curIdx >= 0) commit(ABC[curIdx]);
      curIdx = -1;
    };
    strip.addEventListener("pointerup", end); strip.addEventListener("pointercancel", end);
  }

  // Sliding ticks and shows the bubble immediately; the chip is pressed when the thumb rests (220ms) or
  // lifts. The Drug Database ignores a chip press while it is still loading the previous letter, so the
  // press is retried until that letter is shown (or ~4s), and a newer letter cancels an older retry.
  var tok = 0, dwell = 0;
  function commit(L) {
    var mine = ++tok, n = 0;
    (function attempt() {
      if (mine !== tok) return;
      var ch = findChips(); if (!ch || !ch.map[L]) return;
      if (/(^|\s)on(\s|$)/.test(ch.map[L].className)) {
        try { if (ch.row.getBoundingClientRect().top < 0) ch.row.scrollIntoView({ block: "start" }); } catch (x) {}
        return;
      }
      ch.map[L].click();
      if (++n < 26) setTimeout(attempt, 160);
    })();
  }
  function pick(y, first) {
    var ch = findChips(); if (!ch) return;
    var r = strip.getBoundingClientRect(), have = ABC.map(function (L) { return !!ch.map[L]; });
    var i = nearest(indexAt(y, r.top + 6, r.height - 12, ABC.length), have);
    if (i < 0 || (i === curIdx && !first)) return;
    curIdx = i;
    var L = ABC[i];
    try { window.SMD_HAPTICS && SMD_HAPTICS.selection(); } catch (e) {}
    bubble.textContent = L; bubble.style.opacity = "1";
    bubble.style.left = Math.max(8, r.left - 80) + "px";
    bubble.style.top = Math.max(60, Math.min(innerHeight - 140, 6 + y - 32)) + "px";
    clearTimeout(dwell); dwell = setTimeout(function () { commit(L); }, 220);
  }

  function sync() {
    timer = 0;
    var ch = findChips(), show = !!(ch && overlayVisible(ch.row));
    if (!show) { if (strip) { strip.style.opacity = "0"; strip.style.pointerEvents = "none"; strip.style.transform = "translate(8px,-50%)"; } return; }
    if (!strip || !strip.isConnected) build();
    ABC.forEach(function (L, i) { strip.children[i].style.opacity = ch.map[L] ? "1" : ".28"; });
    strip.style.opacity = "1"; strip.style.pointerEvents = "auto"; strip.style.transform = "translate(0,-50%)";
  }
  function schedule() { if (!timer) timer = setTimeout(sync, 120); }
  // childList only (not class changes: those are constant in this app). While the strip is up, a slow
  // check notices the screen closing by a class toggle that adds/removes no nodes.
  var mo = new MutationObserver(schedule), watch = 0;
  function start() {
    mo.observe(document.body, { childList: true, subtree: true });
    watch = setInterval(function () { if (strip && strip.style.opacity === "1") sync(); }, 800);
    sync();
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
