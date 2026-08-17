/* StewardMD — Anatomy Atlas.
   Educational cross-sectional atlas. Pure helpers first (exported for tests),
   DOM below. ES5 style to match the rest of the app.
   Spec:  docs/superpowers/specs/2026-08-17-anatomy-atlas-spec.md
   Plan:  docs/superpowers/plans/2026-08-17-anatomy-atlas-viewer.md */
(function (G) {
  "use strict";

  /* ---------- pure helpers ---------- */

  // Distribute labels down one gutter so none overlap and none leave the column.
  // Greedy: sort by pin.y, push down to enforce the gap, shift the column up if it
  // overflows, then clamp the top and re-enforce downward.
  // ponytail: single-column greedy. A ~28-label slice can saturate one gutter;
  // add cross-gutter balancing only if that shows up visually.
  function layoutGutter(pins, gapPct, padPct) {
    var out = (pins || [])
      .map(function (p) { return { pin: p, labelY: p.y }; })
      .sort(function (a, b) { return a.labelY - b.labelY; });
    if (!out.length) return out;

    var i;
    for (i = 1; i < out.length; i++) {
      var min = out[i - 1].labelY + gapPct;
      if (out[i].labelY < min) out[i].labelY = min;
    }
    var overflow = out[out.length - 1].labelY - (100 - padPct);
    if (overflow > 0) for (i = 0; i < out.length; i++) out[i].labelY -= overflow;
    if (out[0].labelY < padPct) {
      out[0].labelY = padPct;
      for (i = 1; i < out.length; i++)
        out[i].labelY = Math.max(out[i].labelY, out[i - 1].labelY + gapPct);
    }
    return out;
  }

  // Wrap a structure name to at most maxLines lines of at most maxChars, marking
  // dropped text with a trailing ellipsis. The full name always reaches the user
  // via the sheet title and the pin's aria-label, so truncating here is cosmetic.
  function wrapLabel(name, maxChars, maxLines) {
    var s = String(name == null ? "" : name).trim();
    if (!s) return [];
    var words = s.split(/\s+/), lines = [], cur = "", i;
    for (i = 0; i < words.length; i++) {
      var t = cur ? cur + " " + words[i] : words[i];
      if (t.length <= maxChars) { cur = t; continue; }
      if (cur) { lines.push(cur); cur = words[i]; } else { cur = words[i]; }
      if (lines.length >= maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    lines = lines.slice(0, maxLines);

    for (i = 0; i < lines.length; i++)
      if (lines[i].length > maxChars) lines[i] = lines[i].slice(0, maxChars - 1) + "…";

    // Did we drop anything? If so, make the last line say so.
    if (lines.join(" ").replace(/…/g, "").replace(/\s+/g, " ").trim().length < s.length) {
      var last = lines[lines.length - 1];
      if (last.slice(-1) !== "…")
        lines[lines.length - 1] = last.slice(0, Math.max(1, maxChars - 1)) + "…";
    }
    return lines;
  }

  // Scrub playhead position. Measured against the reference recording:
  // slice 10 of 24 sits at ~39%, slice 20 at ~83%.
  function playheadPct(i, total) {
    if (!(total > 1)) return 0;
    return ((i - 1) / (total - 1)) * 100;
  }

  /* ---------- exports ---------- */

  G.ATLAS = G.ATLAS || {};
  G.ATLAS._pure = { layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct };
  G.ATLAS._version = "1.0";

  if (typeof module !== "undefined" && module.exports)
    module.exports = { layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct };
})(typeof window !== "undefined" ? window : this);
