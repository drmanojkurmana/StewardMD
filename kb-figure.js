/* Drawn pathway figure for KB schema v2 (figures[] with type "svg-spec").
 * Columns run left to right: each column is a labelled lane of boxes, flows are curved arrows
 * between boxes in different columns. Colour per lane is a tint only; every box carries its text.
 * Usage: KBFigure.render(figureObj) -> SVG markup string (wrapped in a scroll box).
 * No dependencies. Text is escaped. Browser (window) and Node (module.exports).
 */
(function (root) {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function plain(s) {
    return String(s).replace(/\{\{hy:([^{}]+?)\}\}/g, "$1");
  }

  // A highlight span stays one token even if it contains spaces, so it is never split across lines.
  function wrap(text, maxChars) {
    var words = String(text || "").match(/\{\{hy:[^{}]+?\}\}|\S+/g) || [];
    var lines = [];
    var cur = "";
    var len = function (s) { return plain(s).length; };
    words.forEach(function (w) {
      if (cur && len(cur + " " + w) > maxChars) {
        lines.push(cur);
        cur = w;
      } else {
        cur = cur ? cur + " " + w : w;
      }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  // Highlights in SVG text: a tspan per segment, bold and underlined for {{hy:...}} spans.
  function svgLine(line) {
    var out = "";
    var last = 0;
    var re = /\{\{hy:([^{}]+?)\}\}/g;
    var m;
    while ((m = re.exec(line)) !== null) {
      out += esc(line.slice(last, m.index));
      out += '<tspan font-weight="700" text-decoration="underline">' + esc(m[1]) + "</tspan>";
      last = m.index + m[0].length;
    }
    return out + esc(line.slice(last));
  }

  var TINTS = ["#eef1f5", "#e8f0fb", "#fdf3e1", "#f1ebfa", "#fbe9e7", "#e6f4f1", "#f4f4f4"];
  var STROKES = ["#5b6573", "#2f5f98", "#a0660c", "#6a45a3", "#a33a2c", "#1f7a68", "#666"];
  var W = 200, GX = 64, HDR = 58, BOX_H = 52, GY = 16, PAD = 20, LINE = 15, MAX_CH = 26;

  function render(fig) {
    var cols = (fig && fig.spec && fig.spec.columns) || [];
    if (!cols.length) return "";
    var maxN = 0;
    cols.forEach(function (c) { maxN = Math.max(maxN, (c.items || []).length); });
    var bodyH = maxN * (BOX_H + GY) - GY;
    var H = HDR + bodyH + PAD * 2;
    var W_TOTAL = PAD * 2 + cols.length * W + (cols.length - 1) * GX;

    var boxes = {};
    var byName = {};
    var parts = [];
    var labels = [];

    cols.forEach(function (col, ci) {
      var x = PAD + ci * (W + GX);
      var tint = TINTS[ci % TINTS.length];
      var stroke = STROKES[ci % STROKES.length];
      var headLines = wrap(col.header || "", 28);
      headLines.forEach(function (ln, i) {
        labels.push('<text x="' + (x + W / 2) + '" y="' + (PAD + 14 + i * LINE) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#1a1a18">' +
          svgLine(ln) + "</text>");
      });
      var items = col.items || [];
      var n = items.length;
      var totalH = n * BOX_H + Math.max(0, n - 1) * GY;
      var top0 = HDR + (bodyH - totalH) / 2;
      items.forEach(function (name, i) {
        var y = top0 + i * (BOX_H + GY);
        var lines = wrap(name, MAX_CH);
        var h = Math.max(BOX_H, lines.length * LINE + 14);
        boxes[ci + "|" + i] = { x: x, y: y, h: h, col: ci };
        if (byName[plain(name)] === undefined) byName[plain(name)] = ci + "|" + i;
        parts.push('<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + h + '" rx="8" fill="' + tint +
          '" stroke="' + stroke + '" stroke-width="1.3"/>');
        var startY = y + h / 2 - ((lines.length - 1) * LINE) / 2 + 5;
        lines.forEach(function (ln, li) {
          labels.push('<text x="' + (x + W / 2) + '" y="' + (startY + li * LINE) + '" text-anchor="middle" font-size="13" fill="#1a1a18">' +
            svgLine(ln) + "</text>");
        });
      });
    });

    var edges = [];
    ((fig.spec && fig.spec.flows) || []).forEach(function (f) {
      var a = byName[plain(f[0])], b = byName[plain(f[1])];
      if (!a || !b) return;
      var A = boxes[a], B = boxes[b];
      if (A.col === B.col) {
        // Same lane: a vertical arrow from the box above to the box below (chains read top to bottom).
        var top = A.y <= B.y ? A : B, bot = top === A ? B : A;
        if (top === B) return; // upward same-lane flows are not drawn
        var cx = A.x + W / 2;
        edges.push('<path d="M ' + cx + " " + (top.y + top.h) + " L " + cx + " " + bot.y +
          '" fill="none" stroke="#55534d" stroke-width="1.3" marker-end="url(#kbfig-arrow)"/>');
        return;
      }
      if (A.col > B.col) return; // backward flows are listed in the caption, not drawn
      var x1 = A.x + W, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2;
      var mx = (x1 + x2) / 2;
      edges.push('<path d="M ' + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2 +
        '" fill="none" stroke="#55534d" stroke-width="1.3" marker-end="url(#kbfig-arrow)"/>');
    });

    var defs = '<defs><marker id="kbfig-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#55534d"/></marker></defs>';
    var label = esc(plain(fig.title || "Pathway figure"));
    return '<div class="kbfig-wrap" style="overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch">' +
      '<svg class="kbfig-svg" role="img" aria-label="' + label + '" viewBox="0 0 ' + Math.ceil(W_TOTAL) + " " + Math.ceil(H) +
      '" width="' + Math.ceil(W_TOTAL) + '" height="' + Math.ceil(H) + '" font-family="-apple-system, system-ui, sans-serif">' +
      defs + edges.join("") + parts.join("") + labels.join("") + "</svg></div>";
  }

  var api = { render: render, wrap: wrap };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KBFigure = api;
})(typeof window !== "undefined" ? window : globalThis);
