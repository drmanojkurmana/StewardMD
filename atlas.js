/* StewardMD — RadioAnatome.
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

  // Returns [] when valid, else one human-readable string per problem.
  // Every rule here exists because breaking it renders something invisible or wrong.
  // This is the ONLY schema authority: the offline pipeline validates its output by
  // calling this function through node, so the two cannot drift apart.
  function validateAtlas(a) {
    var errs = [];
    function bad(m) { errs.push(m); }
    if (!a || typeof a !== "object") { bad("atlas is not an object"); return errs; }
    if (!a.id || !/^[a-z0-9-]+$/.test(String(a.id))) bad("id missing or not kebab-case");

    var cats = a.categories || {}, strs = a.structures || {}, k;
    if (!Object.keys(cats).length) bad("no categories defined");

    for (k in strs) {
      if (!Object.prototype.hasOwnProperty.call(strs, k)) continue;
      var s = strs[k] || {};
      if (!s.name) bad("structure " + k + ": missing name");
      if (!s.category || !cats[s.category]) bad("structure " + k + ": unknown category " + s.category);
      if (s.parent && !strs[s.parent]) bad("structure " + k + ": unknown parent " + s.parent);
    }
    // Parent cycles would hang the hierarchy tab.
    for (k in strs) {
      if (!Object.prototype.hasOwnProperty.call(strs, k)) continue;
      var seen = {}, cur = k, hops = 0;
      while (cur && strs[cur] && strs[cur].parent) {
        if (seen[cur] || ++hops > 64) { bad("structure " + k + ": parent cycle"); break; }
        seen[cur] = 1; cur = strs[cur].parent;
      }
    }

    var sl = a.slices;
    if (!sl || !sl.length) { bad("no slices"); return errs; }
    for (var n = 0; n < sl.length; n++) {
      var q = sl[n] || {};
      if (q.i !== n + 1) bad("slice " + n + ": i should be " + (n + 1) + ", got " + q.i);
      if (!q.img) bad("slice " + (n + 1) + ": missing img");
      if (!(q.aspect > 0)) bad("slice " + (n + 1) + ": aspect must be a positive number");
      var pins = q.pins || [];
      for (var j = 0; j < pins.length; j++) {
        var p = pins[j] || {};
        if (!strs[p.s]) bad("slice " + (n + 1) + " pin " + j + ": unknown structure " + p.s);
        if (!(p.x >= 0 && p.x <= 100)) bad("slice " + (n + 1) + " pin " + j + ": x out of 0-100");
        if (!(p.y >= 0 && p.y <= 100)) bad("slice " + (n + 1) + " pin " + j + ": y out of 0-100");
      }
    }
    return errs;
  }

  function filterModules(mods, region, modality) {
    return (mods || []).filter(function (m) {
      if (region && m.region !== region) return false;
      if (modality && m.modality !== modality) return false;
      return true;
    });
  }

  // First-appearance order, so the catalog's section order is controlled by
  // modules.json alone — no second registry to keep in sync.
  function groupByRegion(mods) {
    var order = [], by = {};
    (mods || []).forEach(function (m) {
      if (!by[m.region]) { by[m.region] = []; order.push(m.region); }
      by[m.region].push(m);
    });
    return order.map(function (r) { return { region: r, modules: by[r] }; });
  }

  // Letterbox the slice inside the stage, reserving gutterPx each side for labels.
  function imageBox(stageW, stageH, aspect, gutterPx) {
    var a = aspect > 0 ? aspect : 1;
    var avail = Math.max(0, stageW - 2 * gutterPx);
    var w = avail, h = w / a;
    if (h > stageH) { h = stageH; w = h * a; }
    if (!isFinite(w) || w < 0) w = 0;
    if (!isFinite(h) || h < 0) h = 0;
    return { x: (stageW - w) / 2, y: (stageH - h) / 2, w: w, h: h };
  }

  // One gutter label per structure per slice. Bilateral structures and multi-pin organs share one
  // structure id on a slice, and a label per PIN printed "Pancreas" four times with four leaders.
  // Groups keep first-appearance order; x/y are the mean of the group's points.
  function groupPins(pts) {
    var by = {}, out = [];
    (pts || []).forEach(function (p) {
      var g = by[p.s];
      if (!g) { g = by[p.s] = { s: p.s, pts: [], x: 0, y: 0 }; out.push(g); }
      g.pts.push(p);
    });
    out.forEach(function (g) {
      var sx = 0, sy = 0;
      g.pts.forEach(function (p) { sx += p.x; sy += p.y; });
      g.x = sx / g.pts.length; g.y = sy / g.pts.length;
    });
    return out;
  }

  // Zoom state z = { s, px, py }: scale about the base box centre, then pan by (px, py) stage px.
  // The image, the pins and every overlay mark are all placed from this one box, so pins cannot
  // drift off their structure at any zoom.
  function zoomBox(base, z) {
    var s = z && z.s > 1 ? z.s : 1, w = base.w * s, h = base.h * s;
    return {
      x: base.x + (base.w - w) / 2 + ((z && z.px) || 0),
      y: base.y + (base.h - h) / 2 + ((z && z.py) || 0),
      w: w, h: h
    };
  }

  // Scale into [1, maxS]. On an axis where the zoomed image is bigger than the view it must cover
  // the view (no empty band past an edge); where it is smaller it stays where the base box put it.
  function clampZoom(base, z, viewW, viewH, maxS) {
    var s = Math.min(Math.max((z && z.s) || 1, 1), maxS || ZOOM_MAX);
    function axis(c, len, view, p) {
      if (len <= view + 0.01) return 0;
      var x0 = c - len / 2;
      return Math.min(Math.max(p || 0, view - len - x0), -x0);
    }
    return {
      s: s,
      px: axis(base.x + base.w / 2, base.w * s, viewW, z && z.px),
      py: axis(base.y + base.h / 2, base.h * s, viewH, z && z.py)
    };
  }

  // Zoom to scale s1 keeping the image point under (fx0, fy0) under (fx1, fy1) — a pinch whose
  // midpoint also moved. Omit fx1/fy1 for a plain zoom about a point. Not clamped.
  function zoomAt(base, z, s1, fx0, fy0, fx1, fy1) {
    var d = zoomBox(base, z);
    var u = d.w ? (fx0 - d.x) / d.w : 0.5, v = d.h ? (fy0 - d.y) / d.h : 0.5;
    var w1 = base.w * s1, h1 = base.h * s1;
    var x1 = (fx1 == null ? fx0 : fx1) - u * w1, y1 = (fy1 == null ? fy0 : fy1) - v * h1;
    return { s: s1, px: x1 - (base.x + (base.w - w1) / 2), py: y1 - (base.y + (base.h - h1) / 2) };
  }

  // Data files are never flipped (the 3D cut planes texture the same images), so a flipX module is
  // mirrored at display time only: here, and in the image's CSS transform.
  function toScreen(box, flip, xPct, yPct) {
    var a = xPct / 100;
    if (flip) a = 1 - a;
    return { x: box.x + a * box.w, y: box.y + (yPct / 100) * box.h };
  }
  // Inverse of toScreen: a stage point to IMAGE percentages in data orientation.
  function toImage(box, flip, sx, sy) {
    var a = box.w ? (sx - box.x) / box.w : 0, b = box.h ? (sy - box.y) / box.h : 0;
    if (flip) a = 1 - a;
    return { x: a * 100, y: b * 100 };
  }

  // Distance between two image-percentage points given the image's physical size [wMm, hMm].
  function rulerMm(p, q, mm) {
    if (!p || !q || !mm || !(mm[0] > 0) || !(mm[1] > 0)) return null;
    var dx = ((q.x - p.x) / 100) * mm[0], dy = ((q.y - p.y) / 100) * mm[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  // "Find it" marking. Pins are points, not masks, so a tap belongs to its NEAREST pin (a Voronoi
  // cell per pin); it is right when that pin is the target's and within maxR px of the tap.
  function judgeFind(pts, x, y, target, maxR) {
    var best = null, bd = Infinity;
    (pts || []).forEach(function (p) {
      var d = Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y));
      if (d < bd) { bd = d; best = p; }
    });
    var near = !!best && bd <= maxR;
    return { ok: near && best.s === target, s: near ? best.s : null, d: bd };
  }

  // Windowed variants live beside the slice: /atlas/<m>/NNN.webp -> /atlas/<m>/w/<id>/NNN.webp.
  // A null window is the first entry, i.e. the existing image.
  function windowUrl(img, win) {
    return win ? String(img == null ? "" : img).replace(/\/([^/]+)$/, "/w/" + win + "/$1") : img;
  }

  // Pins on a narrow or short screen, where two 90 px label gutters would shrink the slice to a
  // fraction of the width; the gutter layout where there is room for it.
  function defaultLabelMode(w, h) { return (w >= 600 && h >= 480) ? "labels" : "pins"; }

  // Map a slice's pins to stage px. vis = inside the visible view (stage minus any sheet).
  function placePins(slice, strs, box, flip, hidden, viewW, viewH) {
    hidden = hidden || {};
    return ((slice && slice.pins) || []).filter(function (p) {
      return strs[p.s] && !hidden[p.s];
    }).map(function (p) {
      var q = toScreen(box, flip, p.x, p.y);
      return { s: p.s, x: q.x, y: q.y, px: p.x, py: p.y,
        vis: q.x >= 0 && q.x <= viewW && q.y >= 0 && q.y <= viewH };
    });
  }

  // One SVG in stage PIXEL coordinates holding every dot, leader line, tick and label.
  // Pixels rather than a percentage viewBox so circles stay circular and text stays
  // upright at any stage aspect; the caller repaints on resize.
  // opts: sel, hidden, mode ("labels" default | "pins" | "off"), flip, visH (visible height, the
  // stage minus a peeking sheet), gutter, quiz, orient, ruler. Exactly ONE focusable element per
  // structure: the label in labels mode, the structure's first dot in pins mode.
  function overlaySvg(slice, atlas, box, stageW, stageH, opts) {
    opts = opts || {};
    var mode = opts.mode || "labels", sel = opts.sel, quiz = opts.quiz || null;
    var visH = opts.visH > 0 ? Math.min(opts.visH, stageH) : stageH;
    var gut = opts.gutter || GUTTER_PX;
    var cats = (atlas && atlas.categories) || {}, strs = (atlas && atlas.structures) || {};
    var pts = placePins(slice, strs, box, opts.flip, opts.hidden, stageW, visH)
      .filter(function (p) { return p.vis; });
    var anySel = !!sel && pts.some(function (p) { return p.s === sel; });
    var parts = [];

    function f(n) { return n.toFixed(1); }
    function col(s) { var c = cats[(strs[s] || {}).category]; return (c && c.color) || "#ffffff"; }
    function state(s) { return sel === s ? " on" : (anySel ? " dim" : ""); }
    function act(s, label, focus) {
      return ' data-atlas-act="pin" data-atlas-s="' + esc(s) + '"' +
        (focus ? ' role="button" tabindex="0" aria-label="' + esc(label) + '"' : ' aria-hidden="true"');
    }
    function ring(p, qc) {
      parts.push('<circle class="atlas-ring' + (qc || "") + '" cx="' + f(p.x) + '" cy="' + f(p.y) + '" r="11" stroke="' +
        esc(col(p.s)) + '" aria-hidden="true"/>');
    }

    if (mode === "labels") {
      // Label y in % of the VISIBLE height, so a peeking sheet never has labels under it.
      var groups = groupPins(pts), L = [], R = [], mid = [], cx = stageW / 2;
      groups.forEach(function (g) {
        var w = { s: g.s, pts: g.pts, x: g.x, y: (g.y / visH) * 100 };
        if (Math.abs(g.x - cx) < stageW * 0.05) mid.push(w); else (g.x < cx ? L : R).push(w);
      });
      // Midline structures (and bilateral pairs, whose mean is central) balance the columns.
      mid.forEach(function (w) { (L.length <= R.length ? L : R).push(w); });
      var pad = Math.max(PAD_PCT, (100 * LABEL_PAD_PX) / visH);
      [["l", L], ["r", R]].forEach(function (side) {
        var n = side[1].length, gap = (100 * LABEL_GAP_PX) / visH;
        if (n > 1) gap = Math.min(gap, (100 - 2 * pad) / (n - 1));
        layoutGutter(side[1], gap, pad).forEach(function (o) { emitLabel(side[0], o.pin, o.labelY); });
      });
    } else {
      var stop = {};
      pts.forEach(function (p) {
        var s = strs[p.s], cls = state(p.s), fill = col(p.s), label = s.name, focus = !stop[p.s], qc = "";
        if (mode === "off" && !quiz) { if (sel !== p.s) return; focus = false; }
        if (quiz && quiz.kind === "name") {
          var mk = quiz.marks ? quiz.marks[p.s] : undefined;
          qc = mk === true ? " qok" : mk === false ? " qbad" : "";
          cls = qc + (quiz.reveal === p.s ? " on" : "");
          label = "Unnamed structure. Reveal its name";
        } else if (quiz && quiz.kind === "find") {
          if (quiz.show !== p.s) return;
          qc = quiz.ok ? " qok" : " qbad"; cls = " on"; focus = false;
        }
        stop[p.s] = 1;
        if (/ on\b/.test(cls)) ring(p, qc);
        parts.push('<circle class="atlas-dot big' + cls + '" cx="' + f(p.x) + '" cy="' + f(p.y) + '" r="' +
          (/ on\b/.test(cls) ? 6.5 : 5) + '" fill="' + (/ on\b/.test(cls) ? "#ffffff" : esc(fill)) + '"' +
          act(p.s, label, focus) + "/>");
      });
    }

    function emitLabel(side, g, labelY) {
      var s = strs[g.s], c = col(g.s), cls = state(g.s);
      // The label column hugs the image when the slice is narrower than the space between the
      // gutters (a height-limited slice on a wide screen), so leaders stay short; it never
      // moves further in than leaves `gut` px for the text.
      var tx = side === "l" ? Math.max(gut - 6, box.x - 10) : Math.min(stageW - gut + 6, box.x + box.w + 10);
      var ty = (labelY / 100) * visH;
      g.pts.forEach(function (p) {
        parts.push('<line class="atlas-lead' + cls + '" x1="' + f(tx) + '" y1="' + f(ty) +
          '" x2="' + f(p.x) + '" y2="' + f(p.y) + '" stroke="' + esc(c) + '"/>');
      });
      parts.push('<line class="atlas-tick' + cls + '" x1="' + f(tx) + '" y1="' + f(ty - 11) +
        '" x2="' + f(tx) + '" y2="' + f(ty + 11) + '" stroke="' + esc(c) + '"/>');
      var lines = wrapLabel(s.name, LABEL_CHARS, LABEL_LINES);
      var anchor = side === "l" ? "end" : "start", lx = side === "l" ? tx - 7 : tx + 7;
      var y0 = ty - (lines.length - 1) * 6.5;
      parts.push('<text class="atlas-lab ' + side + cls + '" x="' + f(lx) + '" y="' + f(y0) +
        '" text-anchor="' + anchor + '" fill="' + esc(c) + '"' + act(g.s, s.name, true) + ">" +
        lines.map(function (t, k) {
          return '<tspan x="' + f(lx) + '" dy="' + (k ? 13 : 0) + '">' + esc(t) + "</tspan>";
        }).join("") + "</text>");
      g.pts.forEach(function (p) {
        var on = sel === g.s;
        parts.push('<circle class="atlas-dot' + cls + '" cx="' + f(p.x) + '" cy="' + f(p.y) +
          '" r="' + (on ? 5 : 3.2) + '" fill="' + (on ? "#ffffff" : esc(c)) + '"' + act(g.s, s.name, false) + "/>");
      });
    }

    // "Find it" feedback: where the user tapped.
    if (quiz && quiz.tap) {
      var t = toScreen(box, opts.flip, quiz.tap.x, quiz.tap.y);
      parts.push('<circle class="atlas-tapmark' + (quiz.ok ? " qok" : " qbad") + '" cx="' + f(t.x) + '" cy="' +
        f(t.y) + '" r="9" aria-hidden="true"/>');
    }

    // Two-point ruler, stored in image percentages so it follows zoom and flip.
    var ru = opts.ruler;
    if (ru && ru.pts && ru.pts.length) {
      var a = toScreen(box, opts.flip, ru.pts[0].x, ru.pts[0].y), b = ru.pts[1] ? toScreen(box, opts.flip, ru.pts[1].x, ru.pts[1].y) : null;
      var g2 = '<g class="atlas-ruler" aria-hidden="true">';
      if (b) {
        var mm = rulerMm(ru.pts[0], ru.pts[1], ru.mm);
        g2 += '<line x1="' + f(a.x) + '" y1="' + f(a.y) + '" x2="' + f(b.x) + '" y2="' + f(b.y) + '"/>';
        if (mm != null) g2 += '<text x="' + f((a.x + b.x) / 2) + '" y="' + f(Math.min(a.y, b.y) - 10) +
          '" text-anchor="middle">' + fmtMm(mm) + "</text>";
      }
      g2 += '<circle cx="' + f(a.x) + '" cy="' + f(a.y) + '" r="4.5"/>' +
        (b ? '<circle cx="' + f(b.x) + '" cy="' + f(b.y) + '" r="4.5"/>' : "") + "</g>";
      parts.push(g2);
    }

    // Edge letters, supplied by the data AFTER any flipX. Placed on the visible part of the image.
    var or = opts.orient;
    if (or) {
      var x0 = Math.max(box.x, 0), x1 = Math.min(box.x + box.w, stageW);
      var y0b = Math.max(box.y, 0), y1b = Math.min(box.y + box.h, visH);
      var mx = (x0 + x1) / 2, my = (y0b + y1b) / 2;
      var ol = [[or.left, x0 + 12, my + 5, "start"], [or.right, x1 - 12, my + 5, "end"],
        [or.top, mx, y0b + 18, "middle"], [or.bottom, mx, y1b - 8, "middle"]];
      ol.forEach(function (o) {
        if (o[0] && /^[RLAPSI]$/.test(o[0])) parts.push('<text class="atlas-orient" x="' + f(o[1]) + '" y="' + f(o[2]) +
          '" text-anchor="' + o[3] + '" aria-hidden="true">' + o[0] + "</text>");
      });
    }

    return '<svg class="atlas-svg" viewBox="0 0 ' + stageW + " " + stageH +
      '" width="' + stageW + '" height="' + stageH + '">' + parts.join("") + "</svg>";
  }

  function fmtMm(mm) { return (mm >= 100 ? Math.round(mm) : mm.toFixed(1)) + " mm"; }


  // n evenly-spaced thumbnails across the stack, used as the scrub track background.
  // The reference shows 5 fixed thumbs with a moving playhead, not a scrolling
  // filmstrip — so this is a slider track, not a list.
  function trackThumbs(atlas, n) {
    var sl = (atlas && atlas.slices) || [];
    if (!sl.length) return [];
    var k = Math.min(n, sl.length), out = [], i;
    for (i = 0; i < k; i++) {
      var idx = k === 1 ? 0 : Math.round((i / (k - 1)) * (sl.length - 1));
      out.push(String(sl[idx].img || "").replace(/\/([^/]+)$/, "/t/$1"));
    }
    return out;
  }

  // Root-first ancestor chain including id. Hop-capped so a bad parent cycle degrades
  // instead of hanging — validateAtlas rejects cycles, but data can be hand-edited in
  // atlas-author.html between validations.
  function hierarchyOf(atlas, id) {
    var strs = (atlas && atlas.structures) || {};
    if (!strs[id]) return [];
    var chain = [], cur = id, hops = 0, seen = {};
    while (cur && strs[cur] && hops++ < 64 && !seen[cur]) {
      seen[cur] = 1;
      chain.unshift({ id: cur, name: strs[cur].name });
      cur = strs[cur].parent;
    }
    return chain;
  }

  /* ---------- layout constants ---------- */
  // Declared once, in the pure block, so the Node tests see them too.
  var GAP_PCT = 6.5, PAD_PCT = 2, LABEL_CHARS = 13, LABEL_LINES = 2, GUTTER_PX = 90;
  // ZOOM_MAX 4: the slices are ~1000 px wide, so beyond 4x a phone only magnifies pixels.
  var LABEL_GAP_PX = 30, LABEL_PAD_PX = 18, ZOOM_MAX = 4, ZOOM_DOUBLE = 2.5;

  /* ---------- state ---------- */

  var st = {
    view: "catalog",   // "catalog" | "viewer"
    moduleId: null,
    slice: 1,
    sel: null,         // selected structure id
    locked: null,      // structure id kept highlighted across slices
    hidden: {},        // { structureId: true }
    catalog: null,     // modules.json
    atlas: null,       // current module's atlas.json
    region: "",
    modality: "",
    req: 0,            // bumped on every module entry/exit; a fetch from an older req is stale
    mode: null,        // label mode the user picked this session (null = stored or default)
    anchor: null,      // tapped pin {x,y} (image %) the callout sits beside
    z: { s: 1, px: 0, py: 0 },
    quiz: null, ruler: null, panel: false, win: null, adj: { b: 100, c: 100 }, loadErr: false
  };

  // Hardened beyond the house esc(): quotes are escaped too, because this output goes
  // into attribute values as well as text. Without that, a hostile thumb path escapes
  // its style="..." attribute. Harmless in text context — browsers render &quot; as ".
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // CSS url() has its own escaping rules — a bare ")" closes the function regardless
  // of HTML escaping — so percent-encode the characters that can break out.
  function cssUrl(u) {
    return esc(String(u == null ? "" : u).replace(/[()"'\s\\]/g, function (ch) {
      return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
    }));
  }

  // Guarded because home.js (which owns the icon catalog) loads after this file.
  // ICONS.get returns a truthy EMPTY <svg> for an unknown name, so callers using
  // `ico(x) || "fallback"` would render an invisible button. Check has() first.
  function ico(n, c) {
    try {
      if (!G.ICONS || !G.ICONS.get) return "";
      if (G.ICONS.has && !G.ICONS.has(n)) return "";
      return G.ICONS.get(n, c);
    } catch (e) { return ""; }
  }

  function $(id) { return G.document ? G.document.getElementById(id) : null; }

  function rootEl() {
    if (!G.document) return null;
    var el = G.document.getElementById("smdAtlas");
    if (!el) {
      el = G.document.createElement("div");
      el.id = "smdAtlas";
      el.className = "atlas-overlay";
      G.document.body.appendChild(el);
    }
    return el;
  }

  function reducedMotion() {
    try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }

  /* ---------- data ---------- */

  function loadCatalog() {
    if (st.catalog) return Promise.resolve(st.catalog);
    if (!G.fetch) return Promise.resolve({ modules: [] });
    return G.fetch("/atlas/modules.json")
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { st.catalog = j || { modules: [] }; return st.catalog; })
      .catch(function () { st.catalog = { modules: [] }; return st.catalog; });
  }

  // Unlike the house fire-and-forget idiom, the viewer must not paint before its
  // module JSON resolves, or the first slice renders with no labels.
  // Staleness: a slow fetch for a module the user has already left must never overwrite the
  // current one. The request is tied to st.req at call time AND to the module id, so it is
  // discarded if either moved on; callers skip their repaint on STALE.
  var STALE = { stale: true };
  function loadModule(id) {
    if (!G.fetch) return Promise.resolve(null);
    var req = st.req;
    function cur() { return req === st.req && st.moduleId === id && st.view === "viewer"; }
    return G.fetch("/atlas/" + id + "/atlas.json")
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) {
        if (!cur()) return STALE;
        st.atlas = j; st.loadErr = !j; return j;
      })
      .catch(function () {
        if (!cur()) return STALE;
        st.atlas = null; st.loadErr = true; return null;
      });
  }

  /* ---------- render ---------- */

  function paint() {
    var el = rootEl();
    if (!el) return;
    el.innerHTML = st.view === "viewer" ? viewerHtml() : catalogHtml();
    if (st.view === "viewer") afterViewerPaint();
  }

  // Native builds do not bundle the .webp slices (~2 MB/module), so point them at
  // the live origin — mirroring kardiox-screens.js kxImg() for kardiox-learn.
  function imgUrl(u) {
    try {
      if (u && u.charAt(0) === "/" && u.indexOf("/atlas/") === 0 && G.SMD_IS_NATIVE)
        return "https://stewardmd.in" + u;
    } catch (e) {}
    return u;
  }
  // The image for a slice under the current window (module.windows), else the slice itself.
  function imgFor(s) { return imgUrl(windowUrl(s.img, st.win)); }

  function chipRow() {
    var mods = (st.catalog && st.catalog.modules) || [];
    var regions = [], modalities = [], seenR = {}, seenM = {};
    mods.forEach(function (m) {
      if (m.hidden) return;
      if (m.region && !seenR[m.region]) { seenR[m.region] = 1; regions.push(m.region); }
      if (m.modality && !seenM[m.modality]) { seenM[m.modality] = 1; modalities.push(m.modality); }
    });
    function chips(kind, vals, active) {
      if (vals.length < 2) return "";        // a single value is not a filter
      return '<div class="atlas-chips">' +
        '<button class="atlas-chip' + (active ? "" : " on") + '" data-atlas-act="filter" data-kind="' + kind + '" data-val="">All</button>' +
        vals.map(function (v) {
          return '<button class="atlas-chip' + (active === v ? " on" : "") + '" data-atlas-act="filter" data-kind="' +
            kind + '" data-val="' + esc(v) + '">' + esc(v) + "</button>";
        }).join("") + "</div>";
    }
    return chips("region", regions, st.region) + chips("modality", modalities, st.modality);
  }

  // The 3D layer (atlas3d.js, flag smd_atlas3d) is a peer of the slice modules, not a
  // module: one card above the catalog, hidden entirely when the flag is off.
  function threeD() { return !!(G.ATLAS3D && G.ATLAS3D.enabled && G.ATLAS3D.enabled()); }
  function threeDCard() {
    if (!threeD()) return "";
    return '<button class="atlas-3d-card" data-atlas-act="3d"><i>3D</i>' +
      '<span><b>3D Anatomy</b><span>Reference body · 2,200+ structures · linked to CT and MRI</span></span></button>';
  }

  function moduleRow(m) {
    return '<button class="atlas-row" data-atlas-act="mod" data-atlas-mod="' + esc(m.id) + '">' +
      '<span class="atlas-row-th"' + (m.thumb ? ' style="background-image:url(' + cssUrl(imgUrl(m.thumb)) + ')"' : "") + "></span>" +
      '<span class="atlas-row-txt"><span class="atlas-row-ttl">' + esc(m.title) + "</span>" +
      '<span class="atlas-row-sub">' + esc(m.subtitle || m.modality) + "</span></span>" +
      '<span class="atlas-row-n">' + (m.slices || 0) + "</span></button>";
  }

  function catalogHtml() {
    var mods = ((st.catalog && st.catalog.modules) || []).filter(function (m) { return !m.hidden; });
    var shown = filterModules(mods, st.region, st.modality);
    var groups = groupByRegion(shown);
    var body = groups.length
      ? groups.map(function (g) {
          return '<div class="atlas-grp"><div class="atlas-grp-h">' + esc(g.region) + "</div>" +
            g.modules.map(moduleRow).join("") + "</div>";
        }).join("")
      : '<div class="atlas-empty">' + (mods.length ? "No modules match these filters." : "RadioAnatome loading…") + "</div>";

    return '<div class="atlas-top">' +
        '<button class="atlas-back" data-atlas-act="close" aria-label="Close">‹</button>' +
        '<span class="atlas-hd"><span class="atlas-ttl">RadioAnatome</span></span>' +
        '<button class="atlas-info" data-atlas-act="info" aria-label="About this atlas">' + (ico("info") || "i") + "</button></div>" +
      '<div class="atlas-scroll">' + threeDCard() + chipRow() + body + "</div>" +
      '<div class="atlas-foot">Educational reference only — not for diagnosis.</div>';
  }

  // The ONE place a source credit may appear (product decision, spec section 9).
  // It renders catalog.credits — a curated, render-safe list — and deliberately NOT
  // atlas.provenance, which holds licence notes and internal tooling paths.
  function infoHtml() {
    // Prefer the CREDIT OF THE MODULE BEING VIEWED. The global list is the union of every
    // source in the catalog, so showing it wholesale credited the U.S. National Library of
    // Medicine on the brain modules, whose images are CC0 OpenNeuro data and are not NLM's
    // at all. A module that needs no credit (CC0) must show none.
    var mod = moduleMeta();
    var credits = (st.catalog && st.catalog.credits) || [];
    if (mod && Object.prototype.hasOwnProperty.call(mod, "credit")) {
      credits = mod.credit ? [mod.credit] : [];
    }
    var notice = (mod && mod.notice) || "";
    return '<div class="atlas-info-screen" id="atlasInfo">' +
      '<div class="atlas-top">' +
        '<button class="atlas-back" data-atlas-act="infoclose" aria-label="Close">‹</button>' +
        '<span class="atlas-hd"><span class="atlas-ttl">About RadioAnatome</span></span></div>' +
      '<div class="atlas-scroll"><p class="atlas-prose">' +
        "RadioAnatome is an educational cross-sectional anatomy reference. It is not a " +
        "diagnostic tool and must not be used to interpret a patient's imaging." +
      "</p>" +
      (notice
        ? '<p class="atlas-prose atlas-notice">' + esc(notice) + "</p>"
        : "") +
      (credits.length
        ? '<p class="atlas-prose atlas-credit">' + credits.map(esc).join("<br>") + "</p>"
        : "") +
      "</div></div>";
  }

  // Everything that belongs to ONE module visit. Entering a module (open, openAt, catalog row)
  // and leaving the viewer both come through here, so no gesture, timer, preload map or fetch
  // from the previous module survives into the next.
  function resetViewState() {
    stopCine(); stopCoast();
    st.req++;
    st.sel = null; st.locked = null; st.hidden = {}; st.anchor = null;
    st.z = { s: 1, px: 0, py: 0 }; st.quiz = null; st.ruler = null; st.panel = false;
    st.win = null; st.adj = { b: 100, c: 100 }; st.loadErr = false;
    _pre = {}; _view = null; _hud = null; _sheetRet = null;
  }
  function enterViewer(id) {
    resetViewState();
    st.view = "viewer"; st.moduleId = id; st.slice = 1; st.atlas = null;
  }
  function leaveViewer() {
    resetViewState();
    if (_ro) { try { _ro.disconnect(); } catch (e) {} _ro = null; }
  }

  function openModule(id) {
    enterViewer(id);
    paint();
    loadModule(id).then(function (a) { if (a !== STALE) paint(); });
  }

  // Overlays (info, and later the slice grid) are appended on top of the current
  // view rather than replacing it, so dismissing them needs no repaint.
  function pushOverlay(html) {
    var host = G.document.createElement("div");
    host.innerHTML = html;
    var node = host.firstChild;
    if (node) rootEl().appendChild(node);
    return node;
  }

  function dropOverlay(id) {
    var el = $(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function curSlice() {
    var sl = (st.atlas && st.atlas.slices) || [];
    if (!sl.length) return null;
    return sl[Math.min(Math.max(st.slice, 1), sl.length) - 1] || null;
  }

  function moduleMeta() {
    var mods = (st.catalog && st.catalog.modules) || [];
    for (var i = 0; i < mods.length; i++) if (mods[i].id === st.moduleId) return mods[i];
    return {};
  }
  function moduleMm() {
    var mm = moduleMeta().mm;
    return (mm && mm[0] > 0 && mm[1] > 0) ? mm : null;
  }
  function moduleWindows() {
    var w = moduleMeta().windows;
    return (w && w.length > 1) ? w : null;
  }

  // Label mode: what the user picked (this session, else stored), else the viewport default.
  // Quiz modes draw pins regardless.
  var MODE_KEY = "smd_atlas_labels";
  function labelMode() {
    var m = st.mode;
    if (!m) { try { m = G.localStorage && G.localStorage.getItem(MODE_KEY); } catch (e) { m = null; } }
    if (m === "pins" || m === "labels" || m === "off") return m;
    return defaultLabelMode(G.innerWidth || 0, G.innerHeight || 0);
  }
  function effMode() { return st.quiz ? "pins" : labelMode(); }
  function setMode(m) {
    st.mode = m;
    try { if (G.localStorage) G.localStorage.setItem(MODE_KEY, m); } catch (e) {}
    renderTools(); drawOverlay();
  }

  function segHtml(act, opts, cur, label) {
    return '<div class="atlas-seg" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button data-atlas-act="' + act + '" data-v="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' +
        esc(o[1]) + "</button>";
    }).join("") + "</div>";
  }

  // The tool row. Quiz replaces it with its own bar, so the two never compete for the width.
  function toolsInner() {
    var q = st.quiz;
    if (q) {
      return '<div class="atlas-tools-in">' +
        segHtml("qkind", [["name", "Name it"], ["find", "Find it"]], q.kind, "Quiz type") +
        '<span class="atlas-score" aria-label="Score ' + q.score + " of " + q.asked + '">' + q.score + "/" + q.asked + "</span>" +
        '<span class="atlas-sp"></span>' +
        (q.kind === "find" && q.answered ? '<button class="atlas-tool wide" data-atlas-act="qnext">Next</button>' : "") +
        '<button class="atlas-tool" data-atlas-act="qexit" aria-label="Exit quiz">' + (ico("close") || "Exit") + "</button>" +
        "</div>";
    }
    var mm = moduleMm(), wins = moduleWindows();
    return '<div class="atlas-tools-in">' +
      segHtml("mode", [["pins", "Pins"], ["labels", "Labels"], ["off", "Off"]], labelMode(), "Label display") +
      '<span class="atlas-sp"></span>' +
      '<button class="atlas-tool" data-atlas-act="quiz" aria-label="Quiz">' + (ico("help") || "Quiz") + "</button>" +
      (mm ? '<button class="atlas-tool" data-atlas-act="ruler" aria-label="Measure distance" aria-pressed="' + !!st.ruler + '">' +
        (ico("target") || "mm") + "</button>" : "") +
      '<button class="atlas-tool" data-atlas-act="panel" aria-label="' + (wins ? "Window" : "Adjust brightness and contrast") +
        '" aria-expanded="' + !!st.panel + '">' + (ico("sliders") || "Adjust") + "</button>" +
      "</div>" + (st.panel ? panelHtml(wins) : "");
  }

  // Windows are named CT windows only when the module ships them; otherwise this is an honestly
  // named brightness/contrast control (a CSS filter on an 8-bit image, not a CT window).
  function panelHtml(wins) {
    if (wins) {
      var cur = st.win || wins[0].id;
      return '<div class="atlas-panel" id="atlasPanel" role="group" aria-label="Window">' +
        '<div class="atlas-panel-h">Window</div><div class="atlas-wins">' + wins.map(function (w) {
          return '<button class="atlas-chip' + (cur === w.id ? " on" : "") + '" data-atlas-act="win" data-v="' + esc(w.id) +
            '" aria-pressed="' + (cur === w.id) + '">' + esc(w.label || w.id) + "</button>";
        }).join("") + "</div></div>";
    }
    return '<div class="atlas-panel" id="atlasPanel" role="group" aria-label="Adjust image">' +
      '<div class="atlas-panel-h">Adjust image</div>' +
      '<label>Brightness<input type="range" min="40" max="200" step="5" value="' + st.adj.b + '" data-adj="b"></label>' +
      '<label>Contrast<input type="range" min="40" max="250" step="5" value="' + st.adj.c + '" data-adj="c"></label>' +
      '<button class="atlas-chip" data-atlas-act="adjreset">Reset</button></div>';
  }

  function renderTools() {
    var t = $("atlasTools");
    if (!t) return;
    var a = G.document.activeElement, key = null;
    try { if (a && t.contains(a)) key = focusKey(a); } catch (e) {}
    t.innerHTML = toolsInner();
    refocus(t, key);
  }

  // Re-rendering a region destroys the focused control; put focus back on its replacement.
  function focusKey(a) {
    if (!a || !a.getAttribute) return null;
    return { act: a.getAttribute("data-atlas-act"), v: a.getAttribute("data-v") || a.getAttribute("data-tab"), adj: a.getAttribute("data-adj") };
  }
  // Matched by comparing attributes, not by building a selector from data values.
  function refocus(host, key) {
    if (!key || !host || !host.querySelectorAll) return false;
    var els = host.querySelectorAll("[data-atlas-act],[data-adj]"), i;
    for (i = 0; i < els.length; i++) {
      var k2 = focusKey(els[i]);
      if (k2.act === key.act && k2.v === key.v && k2.adj === key.adj) {
        try { els[i].focus({ preventScroll: true }); return true; } catch (e) { return false; }
      }
    }
    return false;
  }

  function viewerHtml() {
    var m = moduleMeta();
    var s = curSlice();
    var stageCls = s ? "" : (st.loadErr ? " is-error" : " is-loading");
    return '<div class="atlas-top">' +
        '<button class="atlas-back" data-atlas-act="close" aria-label="Back">‹</button>' +
        '<span class="atlas-hd"><span class="atlas-ttl">' + esc(m.title || "") + "</span>" +
        '<span class="atlas-sub">' + esc(m.subtitle || "") + "</span></span>" +
        (s ? '<button class="atlas-info" data-atlas-act="list" aria-label="Structures on this slice">' + (ico("list") || "List") + "</button>" : "") +
        '<button class="atlas-info" data-atlas-act="info" aria-label="About this atlas">' + (ico("info") || "i") + "</button></div>" +
      (s ? '<div class="atlas-tools" id="atlasTools">' + toolsInner() + "</div>" : "") +
      '<div class="atlas-stage' + stageCls + '" id="atlasStage">' +
        (s ? '<img class="atlas-img" id="atlasImg" alt="" draggable="false" src="' + esc(imgFor(s)) + '">' : "") +
        '<div class="atlas-ov" id="atlasOv"></div><div class="atlas-hud" id="atlasHud"></div>' +
      "</div>" +
      scrubHtml() +
      '<div class="atlas-foot">Educational reference only — not for diagnosis.</div>' +
      '<div class="atlas-sr" id="atlasLive" aria-live="polite" aria-atomic="true"></div>';
  }

  function total() { return (((st.atlas && st.atlas.slices) || []).length) || 0; }

  function scrubHtml() {
    var n = total();
    if (!n) return "";
    return '<div class="atlas-bar">' +
        '<button class="atlas-gridbtn" data-atlas-act="grid" aria-label="All slices">' + (ico("grid") || "▦") + "</button>" +
        (reducedMotion() || n < 2 ? "" : '<button class="atlas-step" id="atlasCine" data-atlas-act="cine" aria-label="Play slices" aria-pressed="false">' +
          (ico("play") || "Play") + "</button>") +
        '<div class="atlas-track" id="atlasTrack">' +
          trackThumbs(st.atlas, 5).map(function (u) {
            return '<span class="atlas-tth" style="background-image:url(' + cssUrl(imgUrl(u)) + ')"></span>';
          }).join("") +
          '<span class="atlas-play" id="atlasPlay" style="left:' + playheadPct(st.slice, n).toFixed(2) + '%"></span>' +
          '<input class="atlas-range" id="atlasRange" type="range" min="1" step="1" max="' + n +
            '" value="' + st.slice + '" aria-label="Slice">' +
          '<span class="atlas-count" id="atlasCount" aria-live="polite" aria-atomic="true">' + st.slice + "/" + n + "</span>" +
        "</div>" +
        '<button class="atlas-step" data-atlas-act="prev" aria-label="Previous slice">←</button>' +
        '<button class="atlas-step" data-atlas-act="next" aria-label="Next slice">→</button>' +
      "</div>";
  }

  function setSlice(i) {
    var n = total();
    if (!n) return;
    i = Math.min(Math.max(Math.round(i), 1), n);
    if (i === st.slice) return;
    st.slice = i;
    st.sel = null;                      // selection is per-slice; Lock survives instead
    st.anchor = null;
    var s = curSlice();
    var img = $("atlasImg");
    if (img && s) gateImg(img, imgFor(s));
    var c = $("atlasCount");
    if (c) c.textContent = i + "/" + n;
    var r = $("atlasRange");
    if (r && +r.value !== i) r.value = i;
    var p = $("atlasPlay");
    if (p) p.style.left = playheadPct(i, n).toFixed(2) + "%";
    if (st.quiz) {
      st.quiz.reveal = null;
      if (st.quiz.kind === "find") nextFind(true);
      renderTools();
    }
    closeSheet();
    drawOverlay();
    preloadAround(i);
  }

  // After the visible slice is up, warm the rest of the module in the background (once), one
  // every 120 ms so the frame the user is looking at always wins the connection. Scrubbing
  // through a warmed module is then instant regardless of the origin's cold latency.
  var _warmed = {};
  function warmModule() {
    var a = st.atlas, id = st.moduleId;
    if (!a || !id || _warmed[id]) return;
    _warmed[id] = 1;
    var sl = a.slices || [], k = 0;
    (function next() {
      if (k >= sl.length || st.moduleId !== id) return;
      var s = sl[k++], u = s && imgUrl(s.img);
      if (u && !_pre[u]) { _pre[u] = 1; try { var im = new G.Image(); im.src = u; } catch (e) {} }
      G.setTimeout(next, 120);
    })();
  }

  // Keep i±1 and i±2 warm so dragging never shows a white frame. Keyed by URL, so a window
  // switch warms its own images. Reset per module in resetViewState().
  var _pre = {};
  function preloadAround(i) {
    var sl = (st.atlas && st.atlas.slices) || [];
    [i - 2, i - 1, i + 1, i + 2].forEach(function (k) {
      var s = sl[k - 1], u = s && imgFor(s);
      if (!u || _pre[u]) return;
      _pre[u] = 1;
      try { var im = new G.Image(); im.src = u; } catch (e) {}
    });
  }

  function gridHtml() {
    var sl = (st.atlas && st.atlas.slices) || [];
    return '<div class="atlas-grid" id="atlasGrid">' +
      '<div class="atlas-top"><button class="atlas-back" data-atlas-act="gridclose" aria-label="Close">‹</button>' +
      '<span class="atlas-hd"><span class="atlas-ttl">All slices</span></span></div>' +
      '<div class="atlas-scroll"><div class="atlas-grid-in">' + sl.map(function (s) {
        return '<button class="atlas-gth' + (s.i === st.slice ? " on" : "") + '" data-atlas-act="goto" data-i="' + s.i +
          '" style="background-image:url(' + cssUrl(imgUrl(String(s.img).replace(/\/([^/]+)$/, "/t/$1"))) +
          ')" aria-label="Slice ' + s.i + '"><span>' + s.i + "</span></button>";
      }).join("") + "</div></div></div>";
  }

  // Same rule as atlas-pipeline/ontology.py canonical(): the slice-module structure id
  // "kidney" and the 3D layer's KIDNEY are one structure.
  function canonicalId(sid) { return String(sid == null ? "" : sid).replace(/-/g, "_").toUpperCase(); }

  // anchor: the tapped pin ({px,py} image %) so the callout sits beside the pin the user touched,
  // not the first pin of a bilateral pair.
  function selectStructure(id, anchor) {
    var strs = (st.atlas && st.atlas.structures) || {};
    if (id && !strs[id]) return;      // unknown id: ignore rather than render a blank sheet
    st.sel = id || null;
    st.anchor = (id && anchor) ? { x: anchor.px, y: anchor.py } : null;
    if (st.sel) openSheet(st.sel); else closeSheet();
    drawOverlay();
  }

  // A pin was activated (tap, click on a label, Enter/Space on a focused pin).
  function activatePin(id, anchor) {
    var q = st.quiz;
    if (q && q.kind === "name") {
      q.reveal = { s: id, x: anchor ? anchor.px : null, y: anchor ? anchor.py : null };
      var strs = (st.atlas && st.atlas.structures) || {};
      announce((strs[id] && strs[id].name) || "");
      return drawOverlay();
    }
    if (q) return;
    selectStructure(id, anchor);
  }

  function toggleLock() {
    if (!st.sel && !st.locked) return;
    st.locked = (st.locked && st.locked === st.sel) ? null : st.sel;
    drawOverlay();
    if (st.sel) openSheet(st.sel);
  }

  function hideSelected() {
    if (!st.sel) return;
    st.hidden[st.sel] = true;
    if (st.locked === st.sel) st.locked = null;
    st.sel = null; st.anchor = null;
    closeSheet();
    drawOverlay();
  }

  var SHEET_PEEK = 170, _tab = "definition";

  function sheetHtml(id, tab) {
    var strs = (st.atlas && st.atlas.structures) || {}, cats = (st.atlas && st.atlas.categories) || {};
    var s = strs[id];
    if (!s) return "";
    var cat = cats[s.category] || {};

    function tb(k, label) {
      return '<button class="atlas-tab' + (tab === k ? " on" : "") +
        '" data-atlas-act="tab" data-tab="' + k + '" aria-pressed="' + (tab === k) + '">' + esc(label) + "</button>";
    }

    var body;
    if (tab === "hierarchy") {
      var chain = hierarchyOf(st.atlas, id);
      body = '<ul class="atlas-tree">' + chain.map(function (n, i) {
        return '<li style="padding-left:' + (i * 14) + 'px"' + (n.id === id ? ' class="on"' : "") +
          ">" + esc(n.name) + "</li>";
      }).join("") + "</ul>";
    } else if (tab === "gallery") {
      var sl = (st.atlas && st.atlas.slices) || [];
      var hits = sl.filter(function (q) {
        return (q.pins || []).some(function (p) { return p.s === id; });
      });
      body = hits.length
        ? '<div class="atlas-grid-in">' + hits.map(function (q) {
            return '<button class="atlas-gth' + (q.i === st.slice ? " on" : "") +
              '" data-atlas-act="goto" data-i="' + q.i + '" style="background-image:url(' +
              cssUrl(imgUrl(String(q.img).replace(/\/([^/]+)$/, "/t/$1"))) +
              ')" aria-label="Slice ' + q.i + '"><span>' + q.i + "</span></button>";
          }).join("") + "</div>"
        : '<div class="atlas-empty">Not labelled on any slice in this module.</div>';
    } else {
      body = '<p class="atlas-def">' +
        (s.definition ? esc(s.definition) : "No definition available for this structure.") + "</p>";
    }

    return '<div class="atlas-grab"></div>' +
      '<div class="atlas-sheet-hd">' +
        '<h2 class="atlas-sheet-ttl" id="atlasSheetTtl" tabindex="-1">' + esc(s.name) + "</h2>" +
        '<button class="atlas-sheet-x" data-atlas-act="sheetclose" aria-label="Close">' + (ico("close") || "×") + "</button>" +
      "</div>" +
      '<div class="atlas-pills">' +
        '<button class="atlas-pill' + (st.locked === id ? " on" : "") + '" data-atlas-act="lock" aria-pressed="' +
          (st.locked === id ? "true" : "false") + '">' + (ico("lock") || "") + " Lock</button>" +
        '<button class="atlas-pill" data-atlas-act="hide">' + (ico("eye_off") || ico("visibility") || "") + " Hide</button>" +
        (threeD() && G.ATLAS3D.hasCanon(canonicalId(id))
          ? '<button class="atlas-pill" data-atlas-act="3d" data-canon="' + esc(canonicalId(id)) + '">3D</button>' : "") +
        '<span class="atlas-pill cat"><i style="background:' + esc(cat.color || "#fff") + '"></i>' +
          esc(cat.label || "") + "</span>" +
      "</div>" +
      '<div class="atlas-tabs">' + tb("definition", "Definition") + tb("gallery", "Gallery") +
        tb("hierarchy", "Anatomical hierarchy") + "</div>" +
      '<div class="atlas-sheet-body">' + body + "</div>";
  }

  // "Structures on this slice": one row per structure (hidden ones included, so they can be
  // brought back). Seam for phase B search: this is the per-slice index a search box filters.
  function sliceStructures() {
    var s = curSlice(), strs = (st.atlas && st.atlas.structures) || {}, seen = {}, out = [];
    ((s && s.pins) || []).forEach(function (p) {
      if (!strs[p.s]) return;
      if (!seen[p.s]) { seen[p.s] = { id: p.s, name: strs[p.s].name, category: strs[p.s].category, n: 0 }; out.push(seen[p.s]); }
      seen[p.s].n++;
    });
    return out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }

  function listHtml() {
    var cats = (st.atlas && st.atlas.categories) || {}, rows = sliceStructures();
    var anyHidden = rows.some(function (r) { return st.hidden[r.id]; });
    return '<div class="atlas-grab"></div>' +
      '<div class="atlas-sheet-hd">' +
        '<h2 class="atlas-sheet-ttl" id="atlasSheetTtl" tabindex="-1">On this slice <span class="atlas-sheet-n">' +
          rows.length + "</span></h2>" +
        '<button class="atlas-sheet-x" data-atlas-act="sheetclose" aria-label="Close">' + (ico("close") || "×") + "</button>" +
      "</div>" +
      '<div class="atlas-sheet-body">' +
        (rows.length ? '<ul class="atlas-list">' + rows.map(function (r) {
          var c = cats[r.category] || {};
          return '<li><button class="atlas-li' + (st.hidden[r.id] ? " off" : "") + '" data-atlas-act="pick" data-atlas-s="' + esc(r.id) + '">' +
            '<i style="background:' + esc(c.color || "#fff") + '"></i><span>' + esc(r.name) + "</span>" +
            (st.hidden[r.id] ? '<em>Hidden</em>' : (r.n > 1 ? "<em>" + r.n + " pins</em>" : "")) + "</button></li>";
        }).join("") + "</ul>" : '<div class="atlas-empty">No labelled structures on this slice.</div>') +
        (anyHidden ? '<button class="atlas-pill" data-atlas-act="showall">Show all</button>' : "") +
      "</div>";
  }

  function sheetEl() {
    var el = $("atlasSheet");
    if (el) return el;
    el = G.document.createElement("div");
    el.id = "atlasSheet";
    // The literal class "sheet" opts this element into dialog-motion.js's spring for
    // free; that file is a passive MutationObserver with no open API of its own.
    el.className = "atlas-sheet sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", "atlasSheetTtl");
    rootEl().appendChild(el);
    bindSheetDrag(el);
    return el;
  }

  // Focus contract: opening the sheet moves focus to its title; closing it returns focus to
  // where it came from (or, when a repaint replaced that element, to the same structure's pin).
  var _sheetRet = null;
  // inv: what opened the sheet, for when the tap did not focus anything (iOS never focuses a
  // tapped button, and pins are hit-tested by distance, not focused).
  function showSheet(html, full, inv) {
    var el = sheetEl(), wasOn = el.classList.contains("on");
    var a = G.document.activeElement, key = null;
    if (!wasOn) {
      _sheetRet = (a && a !== G.document.body && a.getAttribute)
        ? { el: a, s: a.getAttribute("data-atlas-s"), act: a.getAttribute("data-atlas-act") } : (inv || null);
    } else {
      try { if (a && el.contains(a)) key = focusKey(a); } catch (e) {}
    }
    el.innerHTML = html;
    el.classList.toggle("full", !!full);
    el.classList.add("on");
    if (key && refocus(el, key)) return;
    var t = el.querySelector && el.querySelector("#atlasSheetTtl");
    try { if (t && t.focus) t.focus({ preventScroll: true }); } catch (e) {}
  }
  function openSheet(id) { showSheet(sheetHtml(id, _tab), false, { s: id }); }
  function openList() { showSheet(listHtml(), true, { act: "list" }); drawOverlay(); }

  function closeSheet() {
    var el = G.document && $("atlasSheet");
    if (!el || !el.classList.contains("on")) return;
    var had = false;
    try { had = el.contains(G.document.activeElement); } catch (e) {}
    el.classList.remove("on", "full");
    drawOverlay();
    var r = _sheetRet; _sheetRet = null;
    if (!had || !r) return;
    try {
      if (r.el && r.el.isConnected) return r.el.focus({ preventScroll: true });
      if (r.s && focusPin(r.s)) return;
      var tgt = r.act === "list" ? G.document.querySelector('#smdAtlas [data-atlas-act="list"]') : null;
      if (tgt) tgt.focus({ preventScroll: true });
    } catch (e) {}
  }

  // Peek <-> full snapping plus swipe-to-dismiss. No multi-height sheet exists
  // anywhere in the repo, so this is net-new; the drag maths follows the pattern at
  // home.js:1704 (readable there, not exported).
  function bindSheetDrag(el) {
    bindSheetDragGeneric(el, SHEET_PEEK, function () { closeSheet(); selectStructure(null); }, function () { drawOverlay(); });
  }
  // Generic form, shared with the 3D layer (atlas3d.js) so both sheets swipe the same way.
  // onSnap (optional) runs after a peek/full snap so the caller can re-lay out around it.
  function bindSheetDragGeneric(el, peek, onDismiss, onSnap) {
    var y0 = 0, dy = 0, drag = false, wasFull = false;
    el.addEventListener("touchstart", function (e) {
      if (!e.touches || !e.touches.length) { drag = false; return; }
      var body = el.querySelector(".atlas-sheet-body");
      if (el.classList.contains("full") && body && body.scrollTop > 0) { drag = false; return; }
      y0 = e.touches[0].clientY; dy = 0; drag = true;
      wasFull = el.classList.contains("full");
      el.style.transition = "none";
    }, { passive: true });
    el.addEventListener("touchmove", function (e) {
      if (!drag || !e.touches || !e.touches.length) return;
      dy = e.touches[0].clientY - y0;
      var lim = -(G.innerHeight - peek);
      if (!wasFull && dy < 0) el.style.transform = "translateY(" + Math.max(dy, lim) + "px)";
      else if (dy > 0) el.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    function end() {
      if (!drag) return;
      drag = false;
      el.style.transition = ""; el.style.transform = "";
      if (!wasFull && dy < -60) el.classList.add("full");
      else if (wasFull && dy > 60) el.classList.remove("full");
      else if (dy > 90) { if (onDismiss) onDismiss(); return; }
      if (onSnap) onSnap();
    }
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
  }

  /* ---------- stage gestures ---------- */
  // One finger, unzoomed: vertical drag scrubs slices (flick carries on with momentum).
  // One finger, zoomed: pan. Two fingers: pinch-zoom about the midpoint (and pan with it).
  // Double-tap: zoom in / reset. Wheel: slices; ctrl+wheel (trackpad pinch): zoom.
  // An 8 px dead zone separates a drag from a tap, so tapping a pin never nudges the slice.
  var SCRUB_MIN_PX = 8, SCRUB_PX_PER_SLICE = 14, WHEEL_PX = 40, TAP_R = 24;
  var COAST_START = 0.012, COAST_MAX = 0.05, COAST_MIN = 0.004, COAST_FRICTION = 0.9;   // slices per ms

  // Pointer (viewport) coordinates -> stage-internal px. The app's Display setting zooms the
  // whole document (home.js applyD sets documentElement.style.zoom), so clientX/Y and
  // getBoundingClientRect are scaled while the stage's own layout px (clientWidth) are not.
  // Every tap, pinch midpoint, pan delta and ruler point goes through this one factor.
  function stageScale(stage, r) {
    r = r || stage.getBoundingClientRect();
    return (stage.clientWidth && r.width) ? r.width / stage.clientWidth : 1;
  }
  function stagePt(stage, cx, cy) {
    var r = stage.getBoundingClientRect(), k = stageScale(stage, r);
    return { x: (cx - r.left) / k, y: (cy - r.top) / k };
  }

  function bindStage(stage) {
    if (stage._atlasBound) return;
    stage._atlasBound = true;
    var P = {}, g = null, lastTap = null, k = 1, quietUntil = 0, wheelAcc = 0;
    function list() { var a = [], i; for (i in P) if (Object.prototype.hasOwnProperty.call(P, i)) a.push(P[i]); return a; }
    function mid(a) { return stagePt(stage, (a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2); }

    stage.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      stopCoast();
      k = stageScale(stage);
      // A primary pointer starts a new gesture. Clearing here drops any pointer whose up was
      // never delivered (dragged off-screen, a system gesture took over), which would otherwise
      // turn every later one-finger drag into a phantom pinch.
      if (e.isPrimary) { P = {}; g = null; }
      P[e.pointerId] = { x: e.clientX, y: e.clientY };
      var a = list();
      if (a.length === 2 && _view) {
        g = { kind: "pinch", d0: Math.max(1, dist(a[0], a[1])), m0: mid(a), z0: copyZ(st.z), moved: true };
      } else if (a.length === 1) {
        g = { kind: null, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, base: st.slice, z0: copyZ(st.z), samples: [] };
      }
    });
    stage.addEventListener("pointermove", function (e) {
      var p = P[e.pointerId];
      if (!p || !g) return;
      p.x = e.clientX; p.y = e.clientY;
      if (g.kind === "pinch") {
        var a = list();
        if (a.length < 2 || !_view) return;
        var m = mid(a), s1 = Math.min(Math.max(g.z0.s * dist(a[0], a[1]) / g.d0, 1), ZOOM_MAX);
        st.z = zoomAt(_view.base, g.z0, s1, g.m0.x, g.m0.y, m.x, m.y);
        return schedule();
      }
      var dx = (p.x - g.x0) / k, dy = (p.y - g.y0) / k;
      if (!g.kind) {
        if (Math.abs(dx) < SCRUB_MIN_PX && Math.abs(dy) < SCRUB_MIN_PX) return;
        g.kind = st.z.s > 1.01 ? "pan" : (Math.abs(dy) >= Math.abs(dx) ? "scrub" : "none");
        g.moved = true;
        try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      }
      if (g.kind === "pan") { st.z = { s: g.z0.s, px: g.z0.px + dx, py: g.z0.py + dy }; schedule(); }
      else if (g.kind === "scrub") {
        var pos = g.base - dy / SCRUB_PX_PER_SLICE;
        g.samples.push({ t: e.timeStamp, p: pos });
        if (g.samples.length > 8) g.samples.shift();
        setSlice(pos);
      }
    });
    function up(e) {
      if (!P[e.pointerId]) return;
      delete P[e.pointerId];
      var a = list();
      // A drag, pan or pinch must not also land as a tap. Only a MOUSE drag produces a click
      // (a moved touch is never a tap), and it arrives right after pointerup, so the window is
      // short: a deliberate tap a moment later (Reset zoom after a pan) must still work.
      if (g && g.moved) quietUntil = e.timeStamp + 80;
      if (g && g.kind === "pinch") {
        // One finger left on the glass carries on as a pan from where it is.
        g = a.length === 1 ? { kind: "pan", x0: a[0].x, y0: a[0].y, z0: copyZ(st.z), samples: [], moved: true } : null;
        return;
      }
      if (a.length) return;
      if (g && g.kind === "scrub" && e.type === "pointerup") flick(g.samples, e.timeStamp);
      else if (g && !g.kind && e.type === "pointerup" && !st.ruler && e.timeStamp - g.t0 < 350) {
        var t = stagePt(stage, e.clientX, e.clientY);
        if (lastTap && e.timeStamp - lastTap.t < 320 && dist(t, lastTap) < 30) {
          lastTap = null;
          if (_view) {
            st.z = st.z.s > 1.01 ? { s: 1, px: 0, py: 0 } : zoomAt(_view.base, st.z, ZOOM_DOUBLE, t.x, t.y);
            drawOverlay();
          }
        } else lastTap = { t: e.timeStamp, x: t.x, y: t.y };
      }
      g = null;
    }
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("lostpointercapture", up);
    stage.addEventListener("click", function (e) {
      if (e.timeStamp < quietUntil) { quietUntil = 0; e.stopPropagation(); e.preventDefault(); }
    }, true);
    stage.addEventListener("click", function (e) { onStageTap(e, stage); });
    stage.addEventListener("wheel", function (e) {
      if (!_view) return;
      e.preventDefault(); stopCine(); stopCoast();
      if (e.ctrlKey) {
        var q = stagePt(stage, e.clientX, e.clientY);
        var s1 = Math.min(Math.max(st.z.s * Math.exp(-e.deltaY * 0.01), 1), ZOOM_MAX);
        st.z = zoomAt(_view.base, st.z, s1, q.x, q.y);
        return schedule();
      }
      wheelAcc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      while (Math.abs(wheelAcc) >= WHEEL_PX) {
        var dir = wheelAcc > 0 ? 1 : -1;
        wheelAcc -= dir * WHEEL_PX;
        setSlice(st.slice + dir);
      }
    }, { passive: false });
  }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  function copyZ(z) { return { s: z.s, px: z.px, py: z.py }; }

  // A tap on the stage that did not land on a control: measure, answer "Find it", or pick the
  // nearest pin (pins are points; hit-testing by distance beats 10 px circles for a thumb).
  function onStageTap(e, stage) {
    var t = e.target;
    if (t && t.closest && t.closest("[data-atlas-act],.atlas-call,.atlas-zoom")) return;
    if (!_view) return;
    var q = stagePt(stage, e.clientX, e.clientY), x = q.x, y = q.y;
    if (st.ruler) return addRulerPoint(x, y);
    if (st.quiz && st.quiz.kind === "find") return answerFind(x, y);
    if (effMode() === "off" && !st.quiz) return;
    var best = null, bd = TAP_R;
    _placed.forEach(function (p) {
      if (!p.vis) return;
      var d = dist(p, { x: x, y: y });
      if (d <= bd) { bd = d; best = p; }
    });
    if (best) activatePin(best.s, best);
  }

  // Momentum: the flick's velocity over its last ~100 ms carries on through slices with decay.
  var _coast = 0;
  function flick(samples, now) {
    var last = samples[samples.length - 1], first = null, k;
    for (k = samples.length - 1; k >= 0; k--) { if (now - samples[k].t > 100) break; first = samples[k]; }
    if (!last || !first || first === last || now - last.t > 60) return;
    var v = (last.p - first.p) / Math.max(1, last.t - first.t);
    // Capped so a hard flick carries a few slices, not the whole stack.
    if (Math.abs(v) >= COAST_START) coast(last.p, Math.max(-COAST_MAX, Math.min(COAST_MAX, v)));
  }
  function coast(pos, v) {
    stopCoast();
    if (reducedMotion() || !G.requestAnimationFrame) return;
    var prev = null;
    function step(t) {
      _coast = 0;
      if (prev != null) {
        var dt = Math.min(48, t - prev);
        pos += v * dt;
        v *= Math.pow(COAST_FRICTION, dt / 16.7);
        var n = total();
        setSlice(pos);
        if (pos <= 1 || pos >= n || Math.abs(v) < COAST_MIN) return;
      }
      prev = t;
      _coast = G.requestAnimationFrame(step);
    }
    _coast = G.requestAnimationFrame(step);
  }
  function stopCoast() {
    if (_coast && G.cancelAnimationFrame) { try { G.cancelAnimationFrame(_coast); } catch (e) {} }
    _coast = 0;
  }

  // Cine: about 6 fps, loops, stops on any interaction; not offered under reduced motion.
  var CINE_FPS = 6, _cine = null;
  function toggleCine() {
    if (_cine) return stopCine();
    if (reducedMotion() || total() < 2) return;
    _cine = G.setInterval(function () {
      if (!isOpen() || st.view !== "viewer" || !total()) return stopCine();
      setSlice(st.slice >= total() ? 1 : st.slice + 1);
    }, Math.round(1000 / CINE_FPS));
    cineUi(true);
  }
  function stopCine() {
    if (!_cine) return;
    try { G.clearInterval(_cine); } catch (e) {}
    _cine = null;
    cineUi(false);
  }
  function cineUi(on) {
    var b = $("atlasCine");
    if (b) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.setAttribute("aria-label", on ? "Pause" : "Play slices");
      b.innerHTML = on ? (ico("stop") || "Pause") : (ico("play") || "Play");
    }
    // Six announcements a second is noise; the counter goes quiet while playing.
    var c = $("atlasCount");
    if (c) c.setAttribute("aria-live", on ? "off" : "polite");
  }

  /* ---------- quiz ---------- */
  // Name it: pins shown, names hidden; tap to reveal, then self-mark.
  // Find it: a structure on this slice is named; the user taps the image; nearest pin decides.
  function startQuiz(kind) {
    stopCine();
    st.ruler = null; st.panel = false;
    if (st.sel) { st.sel = null; st.anchor = null; closeSheet(); }
    st.quiz = { kind: kind === "find" ? "find" : "name", score: 0, asked: 0, marks: {}, seen: {},
      reveal: null, target: null, answered: null };
    if (st.quiz.kind === "find") nextFind(true);
    else announce("Name it. Tap a pin to reveal its name.");
    renderTools(); drawOverlay();
  }
  function exitQuiz() { st.quiz = null; renderTools(); drawOverlay(); }

  function nextFind(silent) {
    var q = st.quiz;
    if (!q) return;
    var ids = sliceStructures().filter(function (r) { return !st.hidden[r.id]; }).map(function (r) { return r.id; });
    var seen = q.seen[st.slice] || (q.seen[st.slice] = {});
    var fresh = ids.filter(function (id) { return !seen[id]; });
    if (!fresh.length) { q.seen[st.slice] = seen = {}; fresh = ids; }
    q.target = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null;
    q.answered = null;
    if (q.target) seen[q.target] = 1;
    var strs = (st.atlas && st.atlas.structures) || {};
    announce(q.target ? "Find: " + strs[q.target].name : "No labelled structures on this slice.");
    if (!silent) { renderTools(); drawOverlay(); }
  }

  function answerFind(x, y) {
    var q = st.quiz, v = _view;
    if (!q || !q.target || q.answered || !v) return;
    var res = judgeFind(_placed, x, y, q.target, Math.max(36, 0.15 * v.D.w));
    q.asked++;
    if (res.ok) q.score++;
    q.answered = { ok: res.ok, tap: toImage(v.D, v.flip, x, y) };
    var strs = (st.atlas && st.atlas.structures) || {}, nm = strs[q.target].name;
    announce(res.ok ? "Correct. " + nm + ". Score " + q.score + " of " + q.asked
      : "Not quite. " + nm + " is highlighted. Score " + q.score + " of " + q.asked);
    renderTools(); drawOverlay();
  }

  function markName(ok) {
    var q = st.quiz;
    if (!q || !q.reveal) return;
    var marks = q.marks[st.slice] || (q.marks[st.slice] = {});
    if (marks[q.reveal.s] !== undefined) return;
    marks[q.reveal.s] = !!ok;
    q.asked++;
    if (ok) q.score++;
    announce("Score " + q.score + " of " + q.asked);
    renderTools(); drawOverlay();
  }

  /* ---------- ruler ---------- */
  function addRulerPoint(x, y) {
    var v = _view, R = st.ruler;
    if (!v || !R) return;
    var p = toImage(v.D, v.flip, x, y);
    if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) return;   // off the image
    if (R.pts.length >= 2) R.pts = [];
    R.pts.push(p);
    if (R.pts.length === 2) announce(fmtMm(rulerMm(R.pts[0], R.pts[1], moduleMm())));
    drawOverlay();
  }

  function announce(t) { var el = $("atlasLive"); if (el) el.textContent = t; }

  /* ---------- overlay ---------- */

  var _ro = null;
  function afterViewerPaint() {
    var stage = $("atlasStage");
    if (!stage) return;
    _hud = null;                         // paint() replaced the HUD element
    gateImg($("atlasImg"));
    drawOverlay();

    var r = $("atlasRange");
    if (r && !r._atlasBound) {
      r._atlasBound = true;
      r.addEventListener("input", function () { stopCine(); stopCoast(); setSlice(+r.value); });
    }
    bindStage(stage);
    preloadAround(st.slice);

    // SVG elements get no native Enter/Space activation, so wire it explicitly —
    // otherwise the pins are focusable but unusable by keyboard.
    var ovEl = $("atlasOv");
    if (ovEl && !ovEl._atlasKeys) {
      ovEl._atlasKeys = true;
      ovEl.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var t = e.target && e.target.closest && e.target.closest('[data-atlas-act="pin"]');
        if (!t) return;
        e.preventDefault();
        var id = t.getAttribute("data-atlas-s"), hit = null;
        _placed.forEach(function (p) { if (!hit && p.s === id && p.vis) hit = p; });
        activatePin(id, hit);
      });
    }
    // The SVG is in stage pixels, so it must be rebuilt whenever the stage resizes
    // (rotation, split view, desktop window drag). One observer, reattached per paint,
    // disconnected when the viewer is left (leaveViewer).
    if (G.ResizeObserver) {
      if (_ro) { try { _ro.disconnect(); } catch (e) {} }
      _ro = new G.ResizeObserver(function () { drawOverlay(); });
      _ro.observe(stage);
    }
  }

  // The pin overlay is built from local slice metadata, so it paints instantly; the slice
  // image is a network load from the live origin. Without gating, the pins render "ahead"
  // of the image and point at black until it arrives (or forever, if it 404s). Tie the pins
  // to the image: hide them (is-loading) until the image's load event, reveal on load, and
  // show an error state on failure. Cached/preloaded frames (img.complete) reveal at once.
  function gateImg(img, url) {
    if (!img) return;
    var stage = $("atlasStage");
    function cls(add, name) { if (stage) stage.classList[add ? "add" : "remove"](name); }
    function show() { cls(false, "is-loading"); cls(false, "is-error"); drawOverlay(); warmModule(); }
    function fail() { cls(false, "is-loading"); cls(true, "is-error"); }
    img.onload = show; img.onerror = fail;
    if (url != null) { cls(false, "is-error"); cls(true, "is-loading"); img.src = url; }
    if (img.complete && img.naturalWidth > 0) show();
    else cls(true, "is-loading");
  }

  // How much of the stage's bottom a PEEKING sheet covers (a full sheet covers everything and
  // is read, not looked past). Uses the peek constant, not the animating height, so the layout
  // is decided once, the moment the sheet opens.
  function sheetOcclusion(stage) {
    var sh = $("atlasSheet");
    if (!sh || !sh.classList.contains("on") || sh.classList.contains("full")) return 0;
    try {
      // Rects are in (document-zoomed) viewport px; the answer is in stage px, like SHEET_PEEK.
      var r = stage.getBoundingClientRect(), root = rootEl().getBoundingClientRect(), k = stageScale(stage, r);
      return Math.max(0, Math.min(stage.clientHeight, SHEET_PEEK - (root.bottom - r.bottom) / k));
    } catch (e) { return 0; }
  }

  // Coalesce gesture repaints to one per frame.
  var _raf = 0;
  function schedule() {
    if (_raf) return;
    var raf = G.requestAnimationFrame || function (cb) { return G.setTimeout(cb, 16); };
    _raf = raf(function () { _raf = 0; drawOverlay(); });
  }

  var _view = null, _placed = [], _hud = null;
  function drawOverlay() {
    var stage = $("atlasStage");
    var ov = $("atlasOv");
    var s = curSlice();
    if (!stage || !ov || !s) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    var mode = effMode(), m = moduleMeta(), flip = !!m.flipX;
    var visH = Math.max(40, h - sheetOcclusion(stage));
    var gut = mode === "labels" ? GUTTER_PX : 0;
    // Centre the slice in the full stage; only when a peeking sheet would cover it, fit it to
    // the part the sheet leaves visible (so opening the sheet does not jolt a slice that fits).
    var base = imageBox(w, h, s.aspect, gut);
    if (visH < h && base.y + base.h > visH + 0.5) base = imageBox(w, visH, s.aspect, gut);
    st.z = clampZoom(base, st.z, w, visH);
    var D = zoomBox(base, st.z);
    _view = { base: base, D: D, w: w, h: h, visH: visH, flip: flip };
    _placed = placePins(s, (st.atlas && st.atlas.structures) || {}, D, flip, st.hidden, w, visH);

    var img = $("atlasImg");
    if (img) {
      img.style.left = base.x + "px"; img.style.top = base.y + "px";
      img.style.width = base.w + "px"; img.style.height = base.h + "px";
      var sc = st.z.s;
      img.style.transform = (sc > 1 || flip)
        ? "translate(" + (D.x - base.x + (flip ? D.w : 0)).toFixed(2) + "px," + (D.y - base.y).toFixed(2) + "px) scale(" +
          (flip ? -sc : sc) + "," + sc + ")"
        : "";
      img.style.filter = (st.adj.b !== 100 || st.adj.c !== 100) ? "brightness(" + st.adj.b + "%) contrast(" + st.adj.c + "%)" : "";
    }

    var q = st.quiz, qo = null;
    if (q) {
      qo = { kind: q.kind, marks: q.marks[st.slice] || {}, reveal: q.reveal && q.reveal.s,
        show: q.answered ? q.target : null, ok: q.answered && q.answered.ok, tap: q.answered ? q.answered.tap : null };
    }
    // Rebuilding the SVG destroys a focused pin; carry keyboard focus to its replacement.
    var fa = G.document.activeElement, fs = null;
    try { if (fa && ov.contains(fa)) fs = fa.getAttribute("data-atlas-s"); } catch (e) {}
    ov.innerHTML = overlaySvg(s, st.atlas, D, w, h, {
      sel: q ? null : (st.sel || st.locked), hidden: st.hidden, mode: mode, flip: flip, visH: visH,
      gutter: GUTTER_PX, quiz: qo, orient: m.orient || null,
      ruler: st.ruler ? { pts: st.ruler.pts, mm: moduleMm() } : null
    }) + calloutHtml(mode, w, visH);
    if (fs) focusPin(fs);

    var hud = $("atlasHud"), hh = hudHtml();
    if (hud && hh !== _hud) { _hud = hh; hud.innerHTML = hh; }
  }

  function focusPin(s) {
    var ov = $("atlasOv"), els = ov ? ov.querySelectorAll('[tabindex="0"]') : [], i;
    for (i = 0; i < els.length; i++) {
      if (els[i].getAttribute("data-atlas-s") === s) {
        try { els[i].focus({ preventScroll: true }); } catch (e) {}
        return true;
      }
    }
    return false;
  }

  // The pill beside a pin in pins/off modes (the label itself carries this in labels mode).
  var _callKey = "";
  function calloutHtml(mode, w, visH) {
    var strs = (st.atlas && st.atlas.structures) || {}, q = st.quiz;
    var id = null, anchor = st.anchor, cls = "", extra = "", name;
    if (q && q.kind === "name" && q.reveal) {
      id = q.reveal.s; anchor = q.reveal.x == null ? null : q.reveal;
      var mk = (q.marks[st.slice] || {})[id];
      if (mk === undefined) {
        cls = " card";
        extra = '<span class="atlas-call-q">Did you know it?</span><span class="atlas-call-btns">' +
          '<button class="atlas-chip" data-atlas-act="qmark" data-v="1">' + (ico("check") ? ico("check") + " " : "") + "Knew it</button>" +
          '<button class="atlas-chip" data-atlas-act="qmark" data-v="0">Missed it</button></span>';
      } else cls = mk ? " ok" : " bad";
    } else if (q && q.kind === "find" && q.answered) {
      id = q.target; anchor = null; cls = q.answered.ok ? " ok" : " bad";
    } else if (!q && mode !== "labels") {
      id = st.sel || st.locked;
    }
    if (!id || !strs[id]) { _callKey = ""; return ""; }
    var cand = _placed.filter(function (p) { return p.s === id && p.vis; });
    if (!cand.length) { _callKey = ""; return ""; }
    var p = cand[0];
    if (anchor) cand.forEach(function (c) {
      if (Math.abs(c.px - anchor.x) + Math.abs(c.py - anchor.y) < Math.abs(p.px - anchor.x) + Math.abs(p.py - anchor.y)) p = c;
    });
    var cats = (st.atlas && st.atlas.categories) || {}, cat = cats[strs[id].category] || {};
    name = strs[id].name;
    var right = p.x < w * 0.6;
    var top = Math.min(Math.max(p.y, 28), visH - 28);
    var room = Math.max(120, (right ? w - p.x : p.x) - 26);
    // Pop in only when the callout itself changes, not on every pan/pinch repaint.
    var key = id + "|" + p.px + "," + p.py, pop = key !== _callKey ? " pop" : "";
    _callKey = key;
    return '<div class="atlas-call' + (right ? " r" : " l") + cls + pop + '" style="' +
      (right ? "left:" + (p.x + 16).toFixed(1) : "right:" + (w - p.x + 16).toFixed(1)) + "px;top:" + top.toFixed(1) +
      "px;max-width:" + Math.min(room, 260).toFixed(0) + 'px"><span class="atlas-call-t"><i style="background:' +
      esc(cat.color || "#fff") + '"></i>' + esc(name) + "</span>" + extra + "</div>";
  }

  function hudHtml() {
    var q = st.quiz, strs = (st.atlas && st.atlas.structures) || {}, b = "";
    if (q && q.kind === "find") {
      var nm = q.target && strs[q.target] ? esc(strs[q.target].name) : "";
      b = !q.target ? "No labelled structures on this slice"
        : !q.answered ? "Find: <b>" + nm + "</b>"
        : q.answered.ok ? "Correct: <b>" + nm + "</b>" : "Not quite. This is <b>" + nm + "</b>";
    } else if (q) b = "Tap a pin to reveal its name";
    else if (st.ruler) {
      var n = st.ruler.pts.length;
      b = n === 0 ? "Tap two points to measure" : n === 1 ? "Tap the second point"
        : "<b>" + fmtMm(rulerMm(st.ruler.pts[0], st.ruler.pts[1], moduleMm())) + "</b>";
    }
    return (b ? '<div class="atlas-banner">' + b + "</div>" : "") +
      (st.z.s > 1.01 ? '<button class="atlas-zoom" data-atlas-act="zoomreset" aria-label="Reset zoom">' +
        st.z.s.toFixed(1) + "x <span>Reset</span></button>" : "");
  }

  function setWindow(id) {
    var wins = moduleWindows();
    if (!wins) return;
    st.win = (!id || id === wins[0].id) ? null : id;
    var s = curSlice(), img = $("atlasImg");
    if (img && s) gateImg(img, imgFor(s));
    renderTools();
    preloadAround(st.slice);
  }

  // One delegated handler for the whole overlay. Extended by later tasks.
  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-atlas-act]");
    if (!b) return;
    var a = b.getAttribute("data-atlas-act"), v = b.getAttribute("data-v");
    if (a !== "cine") stopCine();
    if (a === "close") return back();
    if (a === "mod") return openModule(b.getAttribute("data-atlas-mod"));
    if (a === "info") { dropOverlay("atlasInfo"); return void pushOverlay(infoHtml()); }
    if (a === "infoclose") return dropOverlay("atlasInfo");
    if (a === "prev") return setSlice(st.slice - 1);
    if (a === "next") return setSlice(st.slice + 1);
    if (a === "grid") { dropOverlay("atlasGrid"); return void pushOverlay(gridHtml()); }
    if (a === "gridclose") return dropOverlay("atlasGrid");
    if (a === "goto") { setSlice(+b.getAttribute("data-i")); return dropOverlay("atlasGrid"); }
    if (a === "pin") return activatePin(b.getAttribute("data-atlas-s"), null);
    if (a === "lock") return toggleLock();
    if (a === "hide") return hideSelected();
    if (a === "sheetclose") return selectStructure(null);
    if (a === "list") { if (st.quiz) exitQuiz(); return openList(); }   // the list names everything
    if (a === "pick") {
      var ps = b.getAttribute("data-atlas-s");
      if (st.hidden[ps]) delete st.hidden[ps];
      return selectStructure(ps);
    }
    if (a === "showall") { st.hidden = {}; drawOverlay(); return openList(); }
    if (a === "mode") return setMode(v);
    if (a === "quiz") return startQuiz("name");
    if (a === "qkind") return startQuiz(v);
    if (a === "qexit") return exitQuiz();
    if (a === "qnext") return nextFind(false);
    if (a === "qmark") return markName(v === "1");
    if (a === "ruler") {
      st.ruler = st.ruler ? null : { pts: [] };
      if (st.ruler && st.sel) selectStructure(null);
      renderTools(); return drawOverlay();
    }
    if (a === "panel") { st.panel = !st.panel; return renderTools(); }
    if (a === "win") return setWindow(v);
    if (a === "adjreset") { st.adj = { b: 100, c: 100 }; renderTools(); return drawOverlay(); }
    if (a === "zoomreset") { st.z = { s: 1, px: 0, py: 0 }; return drawOverlay(); }
    if (a === "cine") return toggleCine();
    if (a === "3d") {
      if (!threeD()) return;
      var canon = b.getAttribute("data-canon");
      return void G.ATLAS3D.open(canon ? { canon: canon, from: { m: st.moduleId, i: st.slice } } : {});
    }
    if (a === "tab") { _tab = b.getAttribute("data-tab"); return st.sel ? openSheet(st.sel) : void 0; }
    if (a === "filter") {
      var kind = b.getAttribute("data-kind");
      st[kind === "region" ? "region" : "modality"] = b.getAttribute("data-val") || "";
      return paint();
    }
  }

  // Brightness/contrast sliders (the honest "Adjust" control).
  function onInput(e) {
    var t = e.target, k = t && t.getAttribute && t.getAttribute("data-adj");
    if (!k) return;
    stopCine();
    st.adj[k] = +t.value;
    drawOverlay();
  }
  // Cine and momentum stop on ANY interaction, not just clicks: a touch anywhere, or a key.
  function onAnyDown(e) {
    var t = e.target;
    stopCoast();
    if (t && t.closest && t.closest('[data-atlas-act="cine"]')) return;
    stopCine();
  }

  /* ---------- lifecycle ---------- */

  function open(moduleId) {
    var el = rootEl();
    if (!el) return;
    st.sel = null; st.locked = null; st.hidden = {};
    try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; }
    try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
    el.removeEventListener("click", onClick);
    el.addEventListener("click", onClick);
    el.removeEventListener("input", onInput);
    el.addEventListener("input", onInput);
    el.removeEventListener("pointerdown", onAnyDown, true);
    el.addEventListener("pointerdown", onAnyDown, true);
    el.removeEventListener("keydown", onAnyDown, true);
    el.addEventListener("keydown", onAnyDown, true);
    el.classList.add("on");
    G.document.body.classList.add("atlas-lock");
    try { if (threeD() && G.ATLAS3D.prime) G.ATLAS3D.prime(); } catch (e) {}
    if (moduleId) {
      enterViewer(moduleId);
      paint();
      // Deep links land here without a catalog, and the viewer header needs the
      // module's title/subtitle from it — so load both.
      loadCatalog().then(function () { return loadModule(moduleId); }).then(function (a) { if (a !== STALE) paint(); });
    } else {
      st.view = "catalog";
      paint();
      loadCatalog().then(function () { if (st.view === "catalog") paint(); });
    }
  }

  // Deep-link a structure: used by the 3D layer's "CT / MRI" rows. Opens the module (and the
  // atlas itself if needed), jumps to the first slice that pins the structure, and LOCKS it so
  // it stays highlighted while the user scrolls.
  function openAt(moduleId, structureId, slice) {
    if (!isOpen()) open(moduleId);
    else { enterViewer(moduleId); paint(); }
    var req = st.req;
    return loadCatalog().then(function () { return loadModule(moduleId); }).then(function (a) {
      if (!a || a === STALE || st.moduleId !== moduleId || req !== st.req) return;
      st.slice = Math.min(Math.max(+slice || 1, 1), total() || 1);
      paint();
      if (structureId && a.structures && a.structures[structureId]) {
        st.locked = structureId;
        selectStructure(structureId);
      }
    });
  }

  function close() {
    var el = G.document && G.document.getElementById("smdAtlas");
    if (el) el.classList.remove("on");
    if (G.document) G.document.body.classList.remove("atlas-lock");
    leaveViewer();
    // open() hid the home layer, so close() MUST bring it back or the user is
    // stranded on a blank page (same reason Ward Sync calls this on its back
    // button — see the SMD_showHome comment in home.js). showV2 only re-adds the
    // home layer underneath, so anything legitimately on top is unaffected.
    try { if (G.SMD_showHome) G.SMD_showHome(); } catch (e) {}
    // Return focus where the user left it, or a keyboard user is dumped at the
    // top of the document with no idea where they are.
    try { if (st._prevFocus && st._prevFocus.focus) st._prevFocus.focus(); } catch (e) {}
    st._prevFocus = null;
    st.view = "catalog"; st.sel = null;
  }

  function isOpen() {
    var el = G.document && G.document.getElementById("smdAtlas");
    return !!(el && el.classList.contains("on"));
  }

  // Layered back: 3D -> info -> grid -> panel -> sheet -> ruler -> quiz -> viewer -> catalog
  // -> close. swipe-back.js consults this, so each swipe steps one level in instead of dumping
  // the user to Home.
  function back() {
    if (!isOpen()) return false;
    // The 3D layer stacks above the atlas; unwind it first so swipe-back and Escape step
    // through its panels before touching the slice viewer underneath.
    try { if (G.ATLAS3D && G.ATLAS3D.isOpen && G.ATLAS3D.isOpen()) return G.ATLAS3D.back(); } catch (e) {}
    if ($("atlasInfo")) { dropOverlay("atlasInfo"); return true; }
    if ($("atlasGrid")) { dropOverlay("atlasGrid"); return true; }
    if (st.view === "viewer" && st.panel) { st.panel = false; renderTools(); return true; }
    var sh = $("atlasSheet");
    if (sh && sh.classList.contains("on")) { selectStructure(null); return true; }
    if (st.view === "viewer" && st.ruler) { st.ruler = null; renderTools(); drawOverlay(); return true; }
    if (st.view === "viewer" && st.quiz) { exitQuiz(); return true; }
    if (st.view === "viewer") { leaveViewer(); st.view = "catalog"; st.atlas = null; paint(); return true; }
    close();
    return true;
  }

  // Escape unwinds one layer at a time, matching back() exactly so keyboard and
  // gesture users get identical behaviour.
  if (G.document && G.document.addEventListener)
    G.document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !isOpen()) return;
      e.preventDefault();
      back();
    });

  // Two repaint triggers, deliberately. ResizeObserver catches element-level changes
  // (iPad split view, desktop window drag) but does not fire at all in headless/CDP
  // panes, so it cannot be verified in CI; a window resize listener catches rotation
  // and viewport changes and is verifiable everywhere. Both funnel into one repaint.
  // The label-mode default follows the viewport, so the tool row repaints too.
  if (G.addEventListener)
    G.addEventListener("resize", function () {
      if (isOpen() && st.view === "viewer") { renderTools(); drawOverlay(); }
    });

  /* ---------- exports ---------- */

  var PURE = {
    layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct,
    validateAtlas: validateAtlas, filterModules: filterModules, groupByRegion: groupByRegion,
    imageBox: imageBox, overlaySvg: overlaySvg, trackThumbs: trackThumbs,
    hierarchyOf: hierarchyOf, groupPins: groupPins, zoomBox: zoomBox, clampZoom: clampZoom,
    zoomAt: zoomAt, toScreen: toScreen, toImage: toImage, rulerMm: rulerMm, judgeFind: judgeFind,
    windowUrl: windowUrl, defaultLabelMode: defaultLabelMode, placePins: placePins
  };

  G.ATLAS = G.ATLAS || {};
  G.ATLAS.open = open;
  G.ATLAS.close = close;
  G.ATLAS.isOpen = isOpen;
  G.ATLAS.back = back;
  G.ATLAS.openAt = openAt;
  G.ATLAS._bindSheetDrag = bindSheetDragGeneric;
  G.ATLAS._state = st;
  G.ATLAS._catalogHtml = catalogHtml;
  G.ATLAS._infoHtml = infoHtml;
  G.ATLAS._viewerHtml = viewerHtml;
  G.ATLAS._setSlice = function (i) { stopCoast(); setSlice(i); };   // an external jump ends momentum
  G.ATLAS._select = selectStructure;
  G.ATLAS._lock = toggleLock;
  G.ATLAS._hide = hideSelected;
  G.ATLAS._sheetHtml = sheetHtml;
  G.ATLAS._openModule = openModule;
  G.ATLAS._draw = drawOverlay;
  G.ATLAS._view = function () { return _view; };
  G.ATLAS._placed = function () { return _placed; };
  G.ATLAS._pure = PURE;
  G.ATLAS._version = "2.0";

  if (typeof module !== "undefined" && module.exports) module.exports = PURE;
})(typeof window !== "undefined" ? window : this);
