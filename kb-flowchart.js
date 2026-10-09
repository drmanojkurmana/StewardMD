/* Textbook-style flowchart renderer for KB schema v2 (flowcharts[]).
 * Top-down layered layout: decisions are diamonds, actions and outcomes are boxes,
 * edges are orthogonal elbows with arrowheads and Yes/No labels.
 * Usage: KBFlowchart.render(flowchartObj) -> SVG markup string.
 * No dependencies. Text is escaped. Works in browser (window) and Node (module.exports).
 */
(function (root) {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // High-yield markup {{hy:...}} becomes bold + underlined tspans; everything else is escaped.
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

  // Greedy word wrap to roughly maxChars per line. Measures plain text, keeps the markup.
  // A highlight span stays one token even if it contains spaces, so it is never split across lines.
  function wrap(text, maxChars) {
    var words = String(text || "").match(/\{\{hy:[^{}]+?\}\}|\S+/g) || [];
    var lines = [];
    var cur = "";
    var len = function (s) { return s.replace(/\{\{hy:([^{}]+?)\}\}/g, "$1").length; };
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

  var BOX_W = 230, DIA_W = 250, LINE_H = 17, PAD_Y = 16, GAP_X = 60, GAP_Y = 64, MARGIN = 24;

  function sizeOf(node) {
    var maxChars = node.type === "decision" ? 26 : 32;
    var lines = wrap(node.text, maxChars);
    var h = lines.length * LINE_H + PAD_Y * 2;
    if (node.type === "decision") {
      // Diamond needs height that scales with its text so the label fits inside.
      return { lines: lines, w: DIA_W, h: Math.max(78, h + 30) };
    }
    return { lines: lines, w: BOX_W, h: Math.max(44, h) };
  }

  function layout(fc) {
    var nodes = {};
    (fc.nodes || []).forEach(function (n) { nodes[n.id] = n; });
    var out = {};
    (fc.edges || []).forEach(function (e) {
      (out[e.from] = out[e.from] || []).push(e);
    });

    // Layer = shortest distance from start (BFS). Back/merge edges keep their depth.
    var depth = {};
    var queue = [fc.start];
    depth[fc.start] = 0;
    while (queue.length) {
      var id = queue.shift();
      (out[id] || []).forEach(function (e) {
        if (depth[e.to] === undefined) {
          depth[e.to] = depth[id] + 1;
          queue.push(e.to);
        }
      });
    }
    // Unreachable nodes are placed after the deepest layer so nothing is dropped.
    var maxD = 0;
    Object.keys(depth).forEach(function (k) { maxD = Math.max(maxD, depth[k]); });
    Object.keys(nodes).forEach(function (k) { if (depth[k] === undefined) depth[k] = ++maxD; });

    var layers = [];
    Object.keys(nodes).forEach(function (k) {
      (layers[depth[k]] = layers[depth[k]] || []).push(k);
    });

    // Horizontal order: each child sits under the mean x of its parents, then spaced apart.
    var pos = {};
    var parentsOf = {};
    (fc.edges || []).forEach(function (e) { (parentsOf[e.to] = parentsOf[e.to] || []).push(e.from); });
    var sized = {};
    Object.keys(nodes).forEach(function (k) { sized[k] = sizeOf(nodes[k]); });

    layers.forEach(function (layer, d) {
      if (!layer) return;
      // All values here are pixel x-centres. Roots without parents fall back to their slot index.
      var desired = layer.map(function (k, i) {
        var ps = (parentsOf[k] || []).filter(function (p) { return pos[p] !== undefined && depth[p] < d; });
        if (!ps.length) return i * (BOX_W + GAP_X);
        return ps.reduce(function (s, p) { return s + pos[p].cx; }, 0) / ps.length;
      });
      var order = layer.map(function (k, i) { return { k: k, want: desired[i], i: i }; });
      order.sort(function (a, b) { return a.want - b.want || a.i - b.i; });
      var cursor = null;
      order.forEach(function (o) {
        var w = sized[o.k].w;
        var cx = o.want;
        if (cursor !== null) cx = Math.max(cx, cursor + w / 2);
        pos[o.k] = { cx: cx, d: d };
        cursor = cx + w / 2 + GAP_X;
      });
    });

    // Vertical: each layer starts below the tallest node of the layer above.
    var yTop = {};
    var y = MARGIN;
    layers.forEach(function (layer, d) {
      if (!layer) return;
      var rowH = 0;
      layer.forEach(function (k) { rowH = Math.max(rowH, sized[k].h); });
      layer.forEach(function (k) { yTop[k] = y + (rowH - sized[k].h) / 2; });
      y += rowH + GAP_Y;
    });

    // Shift so the leftmost box starts at MARGIN.
    var minLeft = Infinity, maxRight = -Infinity;
    Object.keys(pos).forEach(function (k) {
      var w = sized[k].w;
      minLeft = Math.min(minLeft, pos[k].cx - w / 2);
      maxRight = Math.max(maxRight, pos[k].cx + w / 2);
    });
    var shift = MARGIN - minLeft;
    Object.keys(pos).forEach(function (k) { pos[k].cx += shift; });

    return {
      nodes: nodes, sized: sized, pos: pos, yTop: yTop, depth: depth, out: out,
      width: maxRight - minLeft + MARGIN * 2,
      height: y - GAP_Y + MARGIN
    };
  }

  function nodeShape(node, s, cx, top) {
    var cy = top + s.h / 2;
    var fill, stroke, dash = "";
    if (node.type === "decision") {
      fill = "#fff6ea"; stroke = "#b35400";
    } else if (node.type === "outcome") {
      fill = "#eefaee"; stroke = "#1d6b1d";
    } else if (node.type === "start") {
      fill = "#eef4fa"; stroke = "#1f4e79";
    } else {
      fill = "#ffffff"; stroke = "#333333";
    }
    if (node.needsSource) dash = ' stroke-dasharray="5 4"';
    var shape;
    if (node.type === "decision") {
      var hw = s.w / 2, hh = s.h / 2;
      var pts = [[cx, top], [cx + hw, cy], [cx, top + s.h], [cx - hw, cy]]
        .map(function (p) { return p[0] + "," + p[1]; }).join(" ");
      shape = '<polygon points="' + pts + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"' + dash + "/>";
    } else {
      var rx = node.type === "outcome" || node.type === "start" ? 14 : 4;
      shape = '<rect x="' + (cx - s.w / 2) + '" y="' + top + '" width="' + s.w + '" height="' + s.h +
        '" rx="' + rx + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"' + dash + "/>";
    }
    var lh = LINE_H;
    var startY = cy - ((s.lines.length - 1) * lh) / 2 + 5;
    var texts = s.lines.map(function (ln, i) {
      return '<text x="' + cx + '" y="' + (startY + i * lh) + '" text-anchor="middle" font-size="13" fill="#111">' + svgLine(ln) + "</text>";
    }).join("");
    return shape + texts;
  }

  function render(fc) {
    if (!fc || !fc.nodes || !fc.nodes.length) return "";
    var L = layout(fc);
    var parts = [];
    var edgeParts = [];
    var labelParts = [];

    (fc.edges || []).forEach(function (e) {
      var a = L.pos[e.from], b = L.pos[e.to];
      if (!a || !b) return;
      var sa = L.sized[e.from], sb = L.sized[e.to];
      var x1 = a.cx, y1 = L.yTop[e.from] + sa.h;
      var x2 = b.cx, y2 = L.yTop[e.to];
      var d;
      if (L.depth[e.to] > L.depth[e.from]) {
        // Forward edge: down, across at mid-gap, down.
        var my = (y1 + y2) / 2;
        d = "M " + x1 + " " + y1 + " L " + x1 + " " + my + " L " + x2 + " " + my + " L " + x2 + " " + y2;
      } else {
        // Back or merge edge: loop out to the right of both nodes.
        var rx = Math.max(x1, x2) + BOX_W / 2 + 22;
        d = "M " + x1 + " " + y1 + " L " + x1 + " " + (y1 + 14) + " L " + rx + " " + (y1 + 14) +
          " L " + rx + " " + (y2 - 14) + " L " + x2 + " " + (y2 - 14) + " L " + x2 + " " + y2;
      }
      var dash = e.dashed ? ' stroke-dasharray="5 4"' : "";
      edgeParts.push('<path d="' + d + '" fill="none" stroke="#444" stroke-width="1.4"' + dash + ' marker-end="url(#kbfc-arrow)"/>');
      if (e.label) {
        var lx = x1 + 8, ly = y1 + 16;
        var tw = Math.max(24, e.label.length * 7 + 10);
        labelParts.push('<rect x="' + (lx - 4) + '" y="' + (ly - 12) + '" width="' + tw + '" height="16" fill="#ffffff" opacity="0.9"/>' +
          '<text x="' + lx + '" y="' + ly + '" font-size="12" font-weight="600" fill="#222">' + esc(e.label) + "</text>");
      }
    });

    Object.keys(L.nodes).forEach(function (k) {
      if (!L.pos[k]) return;
      parts.push(nodeShape(L.nodes[k], L.sized[k], L.pos[k].cx, L.yTop[k]));
    });

    var defs = '<defs><marker id="kbfc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#444"/></marker></defs>';
    // Chart keeps its natural size; the wrapper scrolls it so the page never scrolls sideways.
    var svg = '<svg class="kbfc-svg" role="img" aria-label="' + esc(fc.title || "Flowchart") + '" viewBox="0 0 ' +
      Math.ceil(L.width) + " " + Math.ceil(L.height) + '" width="' + Math.ceil(L.width) + '" height="' + Math.ceil(L.height) +
      '" font-family="-apple-system, system-ui, sans-serif">' + defs + edgeParts.join("") + parts.join("") + labelParts.join("") + "</svg>";
    return '<div class="kbfc-wrap" style="overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch">' + svg + "</div>";
  }

  var api = { render: render, layout: layout, wrap: wrap };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KBFlowchart = api;
})(typeof window !== "undefined" ? window : globalThis);
