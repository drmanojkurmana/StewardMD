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

  // Data files are never flipped (the 3D cut planes texture the same images), so a flipX/flipY
  // module is mirrored at display time only: here, and in the image's CSS transform. flipX+flipY
  // together is a 180-degree turn (knee, foot and hand sources are stored upside down).
  // `flip` is {x, y}, or a boolean meaning x only (the phase A signature).
  function flipOf(f) { return (f && typeof f === "object") ? { x: !!f.x, y: !!f.y } : { x: !!f, y: false }; }
  function modFlip(m) { return { x: !!(m && m.flipX), y: !!(m && m.flipY) }; }
  function toScreen(box, flip, xPct, yPct) {
    var F = flipOf(flip), a = xPct / 100, b = yPct / 100;
    if (F.x) a = 1 - a;
    if (F.y) b = 1 - b;
    return { x: box.x + a * box.w, y: box.y + b * box.h };
  }
  // Inverse of toScreen: a stage point to IMAGE percentages in data orientation.
  function toImage(box, flip, sx, sy) {
    var F = flipOf(flip), a = box.w ? (sx - box.x) / box.w : 0, b = box.h ? (sy - box.y) / box.h : 0;
    if (F.x) a = 1 - a;
    if (F.y) b = 1 - b;
    return { x: a * 100, y: b * 100 };
  }
  // The CSS transform that puts the image, laid out in `base`, where zoom box D and the flips say.
  function imgTransform(base, D, flip) {
    var F = flipOf(flip), s = base.w ? D.w / base.w : 1;
    if (s <= 1 && !F.x && !F.y) return "";
    return "translate(" + (D.x - base.x + (F.x ? D.w : 0)).toFixed(2) + "px," + (D.y - base.y + (F.y ? D.h : 0)).toFixed(2) +
      "px) scale(" + (F.x ? -s : s) + "," + (F.y ? -s : s) + ")";
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

  /* ---- search ---- */

  // Case- and accent-insensitive: "Hépatique" and "hepatique" are the same query.
  function normText(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { if (s.normalize) s = s.normalize("NFD"); } catch (e) {}
    return s.replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  // 0 exact, 1 prefix, 2 a word starts with the query, 3 substring; -1 no match.
  function matchScore(text, q) {
    var t = normText(text);
    if (!q || !t) return -1;
    if (t === q) return 0;
    if (t.indexOf(q) === 0) return 1;
    if ((" " + t).indexOf(" " + q) >= 0) return 2;
    return t.indexOf(q) >= 0 ? 3 : -1;
  }
  // index: atlas/index.json; modules: modules.json modules. Hidden modules never appear, neither
  // as a module result nor as a place a structure can be opened.
  function searchAtlas(query, index, modules, limit) {
    var q = normText(query), out = { structures: [], modules: [] };
    if (!q) return out;
    var shown = {};
    (modules || []).forEach(function (m) { if (!m.hidden) shown[m.id] = m; });
    ((index && index.structures) || []).forEach(function (r) {
      var sc = matchScore(r.n, q);
      if (sc < 0) return;
      var m = (r.m || []).filter(function (row) { return shown[row[0]]; });
      if (m.length) out.structures.push({ s: r.s, n: r.n, c: r.c, m: m, score: sc });
    });
    (modules || []).forEach(function (m) {
      if (m.hidden) return;
      var sc = Math.min.apply(null, [m.title, m.subtitle, m.region, m.modality].map(function (t) {
        var v = matchScore(t, q); return v < 0 ? 9 : v;
      }));
      if (sc < 9) out.modules.push({ id: m.id, score: sc });
    });
    function by(a, b) { return a.score - b.score || String(a.n || a.id).localeCompare(String(b.n || b.id)); }
    out.structures.sort(by); out.modules.sort(by);
    if (limit) { out.structures = out.structures.slice(0, limit); out.modules = out.modules.slice(0, limit); }
    return out;
  }

  // Recents: newest first, one entry per module (its latest slice), capped.
  function pushRecent(list, e, max) {
    return [e].concat((list || []).filter(function (x) { return x && x.m !== e.m; })).slice(0, max || 8);
  }

  /* ---- plane localizer ---- */
  // A slice's q = [tx,ty,tz, ux,uy,uz, vx,vy,vz] places its image in the group's shared 3D frame:
  // the point at image fraction (a,b) is t + a*u + b*v. Fractions are in DATA orientation (flipX
  // is display-only), exactly like pin x/y.
  function qPoint(q, a, b) {
    return [q[0] + a * q[3] + b * q[6], q[1] + a * q[4] + b * q[7], q[2] + a * q[5] + b * q[8]];
  }
  function qNormal(q) {
    var n = [q[4] * q[8] - q[5] * q[7], q[5] * q[6] - q[3] * q[8], q[3] * q[7] - q[4] * q[6]];
    var l = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  }
  function planeDist(q, p) {
    var n = qNormal(q);
    return n[0] * (p[0] - q[0]) + n[1] * (p[1] - q[1]) + n[2] * (p[2] - q[2]);
  }
  // 1-based index of the slice whose plane passes closest to point p (slices without q skipped).
  function nearestSlice(slices, p) {
    var best = 0, bd = Infinity;
    (slices || []).forEach(function (s, k) {
      if (!s || !s.q) return;
      var d = Math.abs(planeDist(s.q, p));
      if (d < bd) { bd = d; best = k + 1; }
    });
    return best;
  }
  // Where the plane of slice qCut crosses the scout image qScout, as a segment in scout image
  // fractions [[a0,b0],[a1,b1]]; null when the planes are parallel or miss the image.
  function planeLine(qCut, qScout) {
    var n = qNormal(qCut), t = qCut;
    function dot3(x, y, z) { return n[0] * x + n[1] * y + n[2] * z; }
    var A = dot3(qScout[3], qScout[4], qScout[5]), B = dot3(qScout[6], qScout[7], qScout[8]);
    var C = dot3(qScout[0] - t[0], qScout[1] - t[1], qScout[2] - t[2]);
    var pts = [], eps = 1e-9;
    // A*a + B*b + C = 0 clipped to the unit square: intersect with its four edges.
    if (Math.abs(B) > eps) [0, 1].forEach(function (a) { var b = -(A * a + C) / B; if (b >= -eps && b <= 1 + eps) pts.push([a, Math.min(1, Math.max(0, b))]); });
    if (Math.abs(A) > eps) [0, 1].forEach(function (b) { var a = -(B * b + C) / A; if (a >= -eps && a <= 1 + eps) pts.push([Math.min(1, Math.max(0, a)), b]); });
    var uniq = [];
    pts.forEach(function (p) { if (!uniq.some(function (u) { return Math.abs(u[0] - p[0]) < 1e-6 && Math.abs(u[1] - p[1]) < 1e-6; })) uniq.push(p); });
    return uniq.length >= 2 ? [uniq[0], uniq[1]] : null;
  }

  // The scout line in DISPLAY px on a W x H scout drawn with the scout module's flips.
  function scoutSegment(qCut, qScout, flip, W, H) {
    var ln = planeLine(qCut, qScout), box = { x: 0, y: 0, w: W, h: H };
    return ln ? [toScreen(box, flip, ln[0][0] * 100, ln[0][1] * 100), toScreen(box, flip, ln[1][0] * 100, ln[1][1] * 100)] : null;
  }

  // Every file a module needs to run with no network: its JSON, every slice, every extra window
  // (the first window IS the slice), every thumbnail (grid, track, gallery, recents) and its card.
  function offlineFiles(atlas, mod) {
    var seen = {}, out = [];
    function add(u) { if (u && !seen[u]) { seen[u] = 1; out.push(u); } }
    if (mod && mod.id) add("/atlas/" + mod.id + "/atlas.json");
    if (mod && mod.thumb) add(mod.thumb);
    var wins = (mod && mod.windows) || [];
    ((atlas && atlas.slices) || []).forEach(function (s) {
      add(s.img);
      add(String(s.img).replace(/\/([^/]+)$/, "/t/$1"));
      wins.slice(1).forEach(function (w) { add(windowUrl(s.img, w.id)); });
    });
    return out;
  }

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
    // visW: the width a side panel leaves visible; the right label column moves in with it.
    var visW = opts.visW > 0 ? Math.min(opts.visW, stageW) : stageW;
    var gut = opts.gutter || GUTTER_PX;
    var cats = (atlas && atlas.categories) || {}, strs = (atlas && atlas.structures) || {};
    var pts = placePins(slice, strs, box, opts.flip, opts.hidden, visW, visH)
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
      var groups = groupPins(pts), L = [], R = [], mid = [], cx = visW / 2;
      groups.forEach(function (g) {
        var w = { s: g.s, pts: g.pts, x: g.x, y: (g.y / visH) * 100 };
        if (Math.abs(g.x - cx) < visW * 0.05) mid.push(w); else (g.x < cx ? L : R).push(w);
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
      var tx = side === "l" ? Math.max(gut - 6, box.x - 10) : Math.min(visW - gut + 6, box.x + box.w + 10);
      var ty = (labelY / 100) * visH;
      g.pts.forEach(function (p) {
        parts.push('<line class="atlas-lead' + cls + '" x1="' + f(tx) + '" y1="' + f(ty) +
          '" x2="' + f(p.x) + '" y2="' + f(p.y) + '" stroke="' + esc(c) + '"/>');
      });
      parts.push('<line class="atlas-tick' + cls + '" x1="' + f(tx) + '" y1="' + f(ty - 11) +
        '" x2="' + f(tx) + '" y2="' + f(ty + 11) + '" stroke="' + esc(c) + '"/>');
      var lines = wrapLabel(s.name, LABEL_CHARS, LABEL_LINES);
      var anchor = side === "l" ? "end" : "start", lx = side === "l" ? tx - 7 : tx + 7;
      var y0 = ty - (lines.length - 1) * 7;             // half the 14 px line pitch
      parts.push('<text class="atlas-lab ' + side + cls + '" x="' + f(lx) + '" y="' + f(y0) +
        '" text-anchor="' + anchor + '" fill="' + esc(c) + '"' + act(g.s, s.name, true) + ">" +
        lines.map(function (t, k) {
          return '<tspan x="' + f(lx) + '" dy="' + (k ? 14 : 0) + '">' + esc(t) + "</tspan>";
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
      var x0 = Math.max(box.x, 0), x1 = Math.min(box.x + box.w, visW);
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
  var GAP_PCT = 6.5, PAD_PCT = 2, LABEL_CHARS = 13, LABEL_LINES = 2, GUTTER_PX = 96;   // 96: room for 13 chars at 12 px
  // ZOOM_MAX 4: the slices are ~1000 px wide, so beyond 4x a phone only magnifies pixels.
  var LABEL_GAP_PX = 32, LABEL_PAD_PX = 18, ZOOM_MAX = 4, ZOOM_DOUBLE = 2.5;

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

  // Network JSON, falling back to a downloaded module's offline cache (airplane mode). Resolves
  // null when neither has it.
  function fetchJson(url) {
    if (!G.fetch) return Promise.resolve(null);
    return G.fetch(url)
      .then(function (r) { if (!r || !r.ok) throw new Error("http"); return r.json(); })
      .catch(function () { return cachedJson(url); });
  }
  function cachedJson(url) {
    if (!offCaps()) return Promise.resolve(null);
    var ids = Object.keys(lsGet(OFF_KEY, {}));
    // modules.json is stored with every downloaded module; a module's own JSON with that module.
    var own = url.match(/^\/atlas\/([^/]+)\/atlas\.json$/);
    if (own) ids = ids.indexOf(own[1]) >= 0 ? [own[1]] : [];
    return ids.reduce(function (p, id) {
      return p.then(function (hit) {
        if (hit) return hit;
        return G.caches.open(offCacheName(id)).then(function (c) { return c.match(url); })
          .then(function (r) { return r ? r.json() : null; }).catch(function () { return null; });
      });
    }, Promise.resolve(null));
  }

  function loadCatalog() {
    if (st.catalog) return Promise.resolve(st.catalog);
    if (!G.fetch) return Promise.resolve({ modules: [] });
    return fetchJson("/atlas/modules.json")
      .then(function (j) { st.catalog = j || { modules: [] }; return st.catalog; });
  }

  // Unlike the house fire-and-forget idiom, the viewer must not paint before its
  // module JSON resolves, or the first slice renders with no labels.
  // Staleness: a slow fetch for a module the user has already left must never overwrite the
  // current one. The request is tied to st.req at call time AND to the module id, so it is
  // discarded if either moved on; callers skip their repaint on STALE.
  // Module JSON is static, so it is memoised for the session (plane switching and the scout
  // reuse it; going back to a module is instant).
  var STALE = { stale: true }, _json = {};
  function loadModule(id) {
    if (!G.fetch) return Promise.resolve(null);
    var req = st.req;
    function cur() { return req === st.req && st.moduleId === id && st.view === "viewer"; }
    return atlasJson(id).then(function (j) {
      if (!cur()) return STALE;
      st.atlas = j; st.loadErr = !j; return j;
    });
  }
  function atlasJson(id) {
    if (_json[id]) return Promise.resolve(_json[id]);
    return fetchJson("/atlas/" + id + "/atlas.json").then(function (j) { if (j) _json[id] = j; return j; });
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
  function netUrl(u) {
    try {
      if (u && u.charAt(0) === "/" && u.indexOf("/atlas/") === 0 && !/\.json$/.test(u) && G.SMD_IS_NATIVE)
        return "https://stewardmd.in" + u;
    } catch (e) {}
    return u;
  }
  // A downloaded module's images come from object URLs over its offline cache (see prepareBlobs),
  // so the viewer runs in airplane mode; everything else from the network.
  function imgUrl(u) { return (u && _blob[u]) || netUrl(u); }
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

  // A module is Beta until a radiologist marks it verified on /validation; only then does
  // modules.json carry `verified: true`. New modules are Beta by default.
  function isBeta(m) { return !!m && !m.verified; }
  var BETA_PILL = '<span class="atlas-beta">Beta<span class="atlas-sr">, unverified, may contain mistakes.</span></span>';

  function moduleRow(m) {
    if (!m) return "";
    return '<button class="atlas-row" data-atlas-act="mod" data-atlas-mod="' + esc(m.id) + '">' +
      '<span' + flipCls(m, "atlas-row-th") + (m.thumb ? ' style="background-image:url(' + cssUrl(imgUrl(m.thumb)) + ')"' : "") + "></span>" +
      '<span class="atlas-row-txt"><span class="atlas-row-ttl">' + esc(m.title) + (isBeta(m) ? " " + BETA_PILL : "") + "</span>" +
      '<span class="atlas-row-sub">' + esc(m.subtitle || m.modality) + "</span>" +
      '<span class="atlas-row-off" data-off="' + esc(m.id) + '">' + offBadge(m.id) + "</span></span>" +
      '<span class="atlas-row-n">' + (m.slices || 0) + "</span></button>";
  }

  // The search box stays in the DOM while results change under it, so typing never loses focus.
  function searchBoxHtml() {
    return '<div class="atlas-search" role="search">' + (ico("search") || "") +
      '<input id="atlasQ" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" ' +
        'placeholder="Search structures and modules" aria-label="Search structures and modules" aria-controls="atlasResults">' +
      "</div>" +
      '<div class="atlas-sr" id="atlasQStatus" role="status" aria-live="polite"></div>' +
      '<div class="atlas-results" id="atlasResults" hidden></div>';
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
      '<div class="atlas-scroll">' + (mods.length ? searchBoxHtml() : "") +
        '<div id="atlasBrowse">' + recentsHtml() + bookmarksHtml() + threeDCard() + chipRow() + body + "</div></div>" +
      '<div class="atlas-foot">Educational reference only, not for diagnosis.</div>';
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
      (st.view === "viewer" && isBeta(mod)
        ? '<p class="atlas-prose atlas-notice">Beta: this module has not yet been verified by a radiologist ' +
          "and may contain mistakes in its images or labels.</p>"
        : "") +
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
    flushRecent();                     // the visit being left, with its last slice
    st.req++;
    st.sel = null; st.locked = null; st.hidden = {}; st.anchor = null;
    st.z = { s: 1, px: 0, py: 0 }; st.quiz = null; st.ruler = null; st.panel = false; st.pop = null;
    st.win = null; st.adj = { b: 100, c: 100 }; st.loadErr = false;
    _pre = {}; _view = null; _hud = null; _sheetRet = null;
    revokeBlobs();
  }
  function enterViewer(id) {
    resetViewState();
    st.view = "viewer"; st.moduleId = id; st.slice = 1; st.atlas = null;
  }
  function leaveViewer() {
    resetViewState();
    if (_ro) { try { _ro.disconnect(); } catch (e) {} _ro = null; }
  }

  // Load the module (and, when it is downloaded, its offline images) for the CURRENT visit, then
  // paint. `before(atlas)` runs on the fresh data before the paint (openAt sets the slice there).
  // Resolves the atlas, or STALE/null so callers can stop.
  function boot(id, before) {
    var req = st.req;
    return loadCatalog().then(function () { return loadModule(id); }).then(function (a) {
      if (a === STALE || req !== st.req) return STALE;
      return prepareBlobs(id).then(function () {
        if (req !== st.req) return STALE;
        if (a && before) before(a);
        paint();
        if (a) noteRecent();
        return a;
      });
    });
  }

  function openModule(id) {
    enterViewer(id);
    paint();
    boot(id);
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
      '<button class="atlas-tool" data-atlas-act="list" aria-label="Structures on this slice">' + (ico("list") || "List") + "</button>" +
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
    t.innerHTML = toolsInner() + locHtml();
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
    // Header: search and bookmark are one tap away; About and offline live under More.
    return '<div class="atlas-top">' +
        '<button class="atlas-back" data-atlas-act="close" aria-label="Back">‹</button>' +
        '<span class="atlas-hd"><span class="atlas-ttl">' + esc(m.title || "") + "</span>" +
        '<span class="atlas-sub">' + (isBeta(m) ? BETA_PILL + " " : "") + esc(m.subtitle || "") + "</span></span>" +
        '<button class="atlas-info" data-atlas-act="search" aria-label="Search">' + (ico("search") || "Find") + "</button>" +
        (s ? '<button class="atlas-info" id="atlasStar" data-atlas-act="star" aria-label="Bookmark this view" aria-pressed="' +
          !!bmFind() + '"' + (bmFind() ? ' data-on="1"' : "") + ">" + (ico("star") || "Save") + "</button>" : "") +
        '<button class="atlas-info" id="atlasMore" data-atlas-act="more" aria-label="More" aria-expanded="' + (st.pop === "more") + '">' +
          (ico("more") || "More") + "</button></div>" +
      '<div class="atlas-pop" id="atlasPop"' + (st.pop ? "" : " hidden") + ">" + popHtml() + "</div>" +
      (s ? '<div class="atlas-tools" id="atlasTools">' + toolsInner() + locHtml() + "</div>" : "") +
      '<div class="atlas-stage' + stageCls + '" id="atlasStage">' +
        (s ? '<img class="atlas-img" id="atlasImg" alt="" draggable="false" src="' + esc(imgFor(s)) + '">' : "") +
        '<div class="atlas-ov" id="atlasOv"></div><div class="atlas-hud" id="atlasHud"></div>' +
      "</div>" +
      scrubHtml() +
      (isBeta(m)
        ? '<div class="atlas-foot is-beta">Beta · Unverified, may contain mistakes. Not for diagnosis.</div>'
        : '<div class="atlas-foot">Educational reference only, not for diagnosis.</div>') +
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
            return '<span' + flipCls(null, "atlas-tth") + ' style="background-image:url(' + cssUrl(imgUrl(u)) + ')"></span>';
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
    updateScout();
    starUi();
    noteRecentSoon();
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
      '<div class="atlas-scroll"><div class="atlas-grid-in">' + sl.map(thumbBtn).join("") + "</div></div></div>";
  }
  // One slice thumbnail button (grid and gallery). The picture sits in an inner <i> so a flipX
  // module can mirror it, like the main slice, without mirroring the slice number.
  function thumbBtn(q) {
    return '<button class="atlas-gth' + (q.i === st.slice ? " on" : "") + '" data-atlas-act="goto" data-i="' + q.i +
      '" aria-label="Slice ' + q.i + '"><i' + flipCls() + ' style="background-image:url(' + cssUrl(imgUrl(thumbOf(q.img))) +
      ')"></i><span>' + q.i + "</span></button>";
  }
  function flipCls(m, extra) {
    var F = modFlip(m || moduleMeta()), c = [extra, F.x ? "flip" : "", F.y ? "flipy" : ""].filter(Boolean).join(" ");
    return c ? ' class="' + c + '"' : "";
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
    starUi();                          // a bookmark is module + slice + structure
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
    if (tab === "clinical" && notesOn()) {
      body = notesBody(id);
    } else if (tab === "hierarchy") {
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
        ? '<div class="atlas-grid-in">' + hits.map(thumbBtn).join("") + "</div>"
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
        tb("hierarchy", "Anatomical hierarchy") + (notesOn() ? tb("clinical", "Clinical") : "") + "</div>" +
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
    // 900 px and up: a right-side panel. dialog-motion.js slides a ".sheet" up from the bottom,
    // which is right for the bottom sheet only, so the side panel drops that opt-in.
    var side = sideMode();
    el.classList.toggle("side", side);
    el.classList.toggle("sheet", !side);
    el.classList.add("on");
    placeSide();
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
      if (!e.touches || !e.touches.length || el.classList.contains("side")) { drag = false; return; }   // a side panel does not swipe
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

  // How much of the stage the open sheet covers, in stage px: {y} from the bottom for a PEEKING
  // bottom sheet (a full one covers everything and is read, not looked past), {x} from the right
  // for the side panel. Uses the constants, not the animating size, so the layout is decided
  // once, the moment the sheet opens.
  function sheetOcclusion(stage) {
    var sh = $("atlasSheet"), none = { x: 0, y: 0 };
    if (!sh || !sh.classList.contains("on")) return none;
    var side = sh.classList.contains("side");
    if (!side && sh.classList.contains("full")) return none;
    try {
      // Rects are in (document-zoomed) viewport px; the answer is in stage px, like SHEET_PEEK.
      var r = stage.getBoundingClientRect(), root = rootEl().getBoundingClientRect(), k = stageScale(stage, r);
      if (side) return { x: Math.max(0, Math.min(stage.clientWidth, SIDE_W - (root.right - r.right) / k)), y: 0 };
      return { x: 0, y: Math.max(0, Math.min(stage.clientHeight, SHEET_PEEK - (root.bottom - r.bottom) / k)) };
    } catch (e) { return none; }
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
    var mode = effMode(), m = moduleMeta(), flip = modFlip(m), oc = sheetOcclusion(stage);
    var visH = Math.max(40, h - oc.y), visW = Math.max(80, w - oc.x);
    var gut = mode === "labels" ? GUTTER_PX : 0;
    placeSide();
    // Centre the slice in the full stage; only when an open sheet or side panel would cover it,
    // fit it to the part left visible (so opening the sheet does not jolt a slice that fits).
    var base = imageBox(w, h, s.aspect, gut);
    if ((visH < h && base.y + base.h > visH + 0.5) || (visW < w && base.x + base.w > visW + 0.5))
      base = imageBox(visW, visH, s.aspect, gut);
    st.z = clampZoom(base, st.z, visW, visH);
    var D = zoomBox(base, st.z);
    _view = { base: base, D: D, w: w, h: h, visH: visH, visW: visW, flip: flip };
    _placed = placePins(s, (st.atlas && st.atlas.structures) || {}, D, flip, st.hidden, visW, visH);

    var img = $("atlasImg");
    if (img) {
      img.style.left = base.x + "px"; img.style.top = base.y + "px";
      img.style.width = base.w + "px"; img.style.height = base.h + "px";
      img.style.transform = imgTransform(base, D, flip);
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
      sel: q ? null : (st.sel || st.locked), hidden: st.hidden, mode: mode, flip: flip, visH: visH, visW: visW,
      gutter: GUTTER_PX, quiz: qo, orient: m.orient || null,
      ruler: st.ruler ? { pts: st.ruler.pts, mm: moduleMm() } : null
    }) + calloutHtml(mode, w, visH, visW);
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
  function calloutHtml(mode, w, visH, visW) {
    visW = visW || w;
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
    var right = p.x < visW * 0.6;
    var top = Math.min(Math.max(p.y, 28), visH - 28);
    var room = Math.max(120, (right ? visW - p.x : p.x) - 26);
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
      (st.z.s > 1.01 ? '<button class="atlas-zoom" data-atlas-act="zoomreset" aria-label="Reset zoom"' +
        (_view && _view.visW < _view.w ? ' style="right:' + (_view.w - _view.visW + 8).toFixed(0) + 'px"' : "") + ">" +
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
    // A tap anywhere outside an open header popover closes it (the tap still does its own job).
    if (st.pop && !(e.target && e.target.closest && e.target.closest("#atlasPop,#atlasStar,#atlasMore"))) closePop();
    var b = e.target && e.target.closest && e.target.closest("[data-atlas-act]");
    if (!b) return;
    var a = b.getAttribute("data-atlas-act"), v = b.getAttribute("data-v");
    if (a !== "cine") stopCine();
    if (a === "close") return back();
    if (a === "mod") { dropOverlay("atlasSearch"); return openModule(b.getAttribute("data-atlas-mod")); }
    if (a === "open") {
      // Search results, recents and bookmarks: straight to the module and slice, structure locked.
      dropOverlay("atlasSearch"); closePop();
      return void openAt(b.getAttribute("data-m"), b.getAttribute("data-s"), +b.getAttribute("data-i") || 1);
    }
    if (a === "search") return openSearch();
    if (a === "searchclose") return dropOverlay("atlasSearch");
    if (a === "star") return openPop("bm", b);
    if (a === "more") return openPop("more", b);
    if (a === "popx") return closePop();
    if (a === "bmsave") { var nm = $("atlasBmName"); bmSave(nm ? nm.value : ""); closePop(); return starUi(); }
    if (a === "bmremove") { bmDelete(v); closePop(); return starUi(); }
    if (a === "bmdel") {
      bmDelete(v); paint();
      var h = $("atlasBmH") || $("atlasQ");       // the list re-rendered; keep focus in the catalog
      try { if (h) h.focus({ preventScroll: true }); } catch (x) {}
      return;
    }
    if (a === "offline") return startDownload(st.moduleId);
    if (a === "offstop") { if (_dl) _dl.stop = true; return; }
    if (a === "offremove") return void removeOffline(st.moduleId);
    if (a === "plane") return switchPlane(v);
    if (a === "scout") return scoutJump(b, e);
    if (a === "info") { closePop(); dropOverlay("atlasInfo"); return void pushOverlay(infoHtml()); }
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
    if (t && t.id === "atlasQ") return runSearchSoon();
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

  /* ---------- storage ---------- */

  function lsGet(k, d) {
    try { var v = G.localStorage && G.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function lsSet(k, v) { try { if (G.localStorage) G.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function modById(id) {
    var mods = (st.catalog && st.catalog.modules) || [];
    for (var i = 0; i < mods.length; i++) if (mods[i].id === id) return mods[i];
    return null;
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  // "Axial" from plane, else the first word of the subtitle ("Axial - living patient").
  function planeOf(m) { return m ? cap(m.plane || String(m.subtitle || "").split(/\s+-\s+|,/)[0]) : ""; }
  function thumbOf(img) { return String(img).replace(/\/([^/]+)$/, "/t/$1"); }
  function sliceImg(id, i) { return "/atlas/" + id + "/" + ("00" + i).slice(-3) + ".webp"; }

  /* ---------- recents ---------- */

  var RECENT_KEY = "smd_atlas_recent", _recT = null;
  function noteRecent() {
    if (_recT) { try { G.clearTimeout(_recT); } catch (e) {} _recT = null; }
    if (!st.moduleId || !total()) return;
    lsSet(RECENT_KEY, pushRecent(lsGet(RECENT_KEY, []), { m: st.moduleId, i: st.slice, t: Date.now() }, 8));
  }
  // Scrubbing and cine change the slice many times a second; write once it settles.
  function noteRecentSoon() {
    if (!G.setTimeout) return noteRecent();
    if (_recT) G.clearTimeout(_recT);
    _recT = G.setTimeout(noteRecent, 800);
  }
  function flushRecent() { if (_recT) noteRecent(); }

  function recentsHtml() {
    var list = lsGet(RECENT_KEY, []).filter(function (r) { var m = modById(r.m); return m && !m.hidden; });
    if (!list.length) return "";
    return '<div class="atlas-grp-h sm">Recent</div><div class="atlas-recents">' + list.map(function (r) {
      var m = modById(r.m);
      return '<button class="atlas-rcard" data-atlas-act="open" data-m="' + esc(r.m) + '" data-i="' + (+r.i || 1) + '" ' +
        'aria-label="' + esc(m.title + ", " + planeOf(m) + ", slice " + r.i) + '">' +
        '<span class="atlas-rcard-t">' + esc(m.title) + "</span>" +
        '<span class="atlas-rcard-s">' + esc(planeOf(m)) + " · slice " + (+r.i || 1) + "</span>" +
        '<span' + flipCls(m, "atlas-rcard-th") + ' style="background-image:url(' + cssUrl(imgUrl(thumbOf(sliceImg(r.m, r.i)))) + ')"></span></button>';
    }).join("") + "</div>";
  }

  /* ---------- bookmarks ---------- */

  var BM_KEY = "smd_atlas_bookmarks";
  function bmList() { return lsGet(BM_KEY, []).filter(function (b) { return b && b.m && modById(b.m); }); }
  function bmFind() {
    var s = st.sel || st.locked || null;
    return lsGet(BM_KEY, []).filter(function (b) { return b && b.m === st.moduleId && b.i === st.slice && (b.s || null) === s; })[0] || null;
  }
  function bmDefaultName() {
    var strs = (st.atlas && st.atlas.structures) || {}, s = st.sel || st.locked, m = moduleMeta();
    return (s && strs[s] ? strs[s].name + ", " : "") + planeOf(m) + " slice " + st.slice;
  }
  function bmSave(name) {
    var list = lsGet(BM_KEY, []);
    list.unshift({ id: "b" + Date.now().toString(36) + Math.floor(Math.random() * 1e4), m: st.moduleId, i: st.slice,
      s: st.sel || st.locked || null, n: String(name || "").trim().slice(0, 80) || bmDefaultName(), t: Date.now() });
    lsSet(BM_KEY, list.slice(0, 200));
  }
  function bmDelete(id) { lsSet(BM_KEY, lsGet(BM_KEY, []).filter(function (b) { return b && b.id !== id; })); }
  function starUi() {
    var b = $("atlasStar"), on = !!bmFind();
    if (!b) return;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) b.setAttribute("data-on", "1"); else b.removeAttribute("data-on");
  }

  function bookmarksHtml() {
    var list = bmList();
    if (!list.length) return "";
    return '<div class="atlas-grp-h sm" id="atlasBmH" tabindex="-1">Bookmarks</div><ul class="atlas-bms">' + list.map(function (b) {
      var m = modById(b.m);
      return '<li><button class="atlas-bm-open" data-atlas-act="open" data-m="' + esc(b.m) + '" data-i="' + (+b.i || 1) + '"' +
        (b.s ? ' data-s="' + esc(b.s) + '"' : "") + ">" + (ico("star") || "") +
        '<span><b>' + esc(b.n) + "</b><em>" + esc(m.title + ", " + planeOf(m) + " · slice " + b.i) + "</em></span></button>" +
        '<button class="atlas-bm-del" data-atlas-act="bmdel" data-v="' + esc(b.id) + '" aria-label="' + esc("Delete bookmark " + b.n) + '">' +
        (ico("trash") || "Delete") + "</button></li>";
    }).join("") + "</ul>";
  }

  /* ---------- header popovers (bookmark, more) ---------- */

  var _popRet = null;
  function popHtml() {
    if (st.pop === "bm") {
      var b = bmFind();
      if (b) return '<div class="atlas-pop-h">Bookmarked</div><p class="atlas-pop-note">' + esc(b.n) + "</p>" +
        '<div class="atlas-pop-row"><button class="atlas-chip" data-atlas-act="bmremove" data-v="' + esc(b.id) + '">Remove bookmark</button>' +
        '<button class="atlas-chip on" data-atlas-act="popx">Done</button></div>';
      return '<div class="atlas-pop-h">Bookmark this view</div>' +
        '<label class="atlas-field"><span>Name (optional)</span><input id="atlasBmName" type="text" maxlength="80" autocomplete="off" placeholder="' +
          esc(bmDefaultName()) + '"></label>' +
        '<div class="atlas-pop-row"><button class="atlas-chip" data-atlas-act="popx">Cancel</button>' +
        '<button class="atlas-chip on" data-atlas-act="bmsave">Save</button></div>';
    }
    if (st.pop === "more") return offlineHtml() +
      '<button class="atlas-menu-item" data-atlas-act="info">' + (ico("info") || "") + "<span>About this atlas</span></button>";
    return "";
  }
  function openPop(kind, invoker) {
    st.pop = st.pop === kind ? null : kind;
    _popRet = st.pop ? invoker : null;
    renderPop();
    if (!st.pop) { try { if (invoker) invoker.focus({ preventScroll: true }); } catch (e) {} return; }
    var p = $("atlasPop"), f = p && (p.querySelector("#atlasBmName") || p.querySelector("button"));
    try { if (f) f.focus({ preventScroll: true }); } catch (e) {}
  }
  function closePop() {
    if (!st.pop) return false;
    st.pop = null; renderPop();
    try { if (_popRet && _popRet.isConnected) _popRet.focus({ preventScroll: true }); } catch (e) {}
    _popRet = null;
    return true;
  }
  function renderPop() {
    var p = $("atlasPop"), more = $("atlasMore");
    if (more) more.setAttribute("aria-expanded", st.pop === "more" ? "true" : "false");
    if (!p) return;
    var a = G.document.activeElement, key = null;
    try { if (a && p.contains(a)) key = focusKey(a); } catch (e) {}
    p.innerHTML = popHtml();
    p.hidden = !st.pop;
    refocus(p, key);
  }

  /* ---------- offline download ---------- */
  // Every slice, window and thumbnail of a module goes into its own Cache API cache
  // ("atlas2d-<id>"), fetched through the shared model cache (SMD_THOREX_MODEL_CACHE) when
  // present. Removal deletes ONLY that named cache: the shared clearModels() also deletes the
  // model IndexedDB database, which would wipe ThoreX's models.
  var OFF_KEY = "smd_atlas_offline", _dl = null, _dlErr = null, _blob = {};
  function offCaps() { try { return !!(G.caches && G.caches.open && G.caches["delete"] && G.URL && G.URL.createObjectURL); } catch (e) { return false; } }
  function offCacheName(id) { return "atlas2d-" + id; }
  function offRec(id) { return lsGet(OFF_KEY, {})[id] || null; }
  function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  function offBadge(id) {
    if (_dl && _dl.id === id) return "Downloading " + (_dl.total ? Math.floor(100 * _dl.done / _dl.total) : 0) + "%";
    return offRec(id) ? "Available offline" : "";
  }
  function offlineHtml() {
    var id = st.moduleId, rec = offRec(id);
    if (!offCaps()) return '<p class="atlas-pop-note">Offline download is not available on this device.</p>';
    if (_dl && _dl.id === id) {
      var pct = _dl.total ? Math.floor(100 * _dl.done / _dl.total) : 0;
      return '<div class="atlas-pop-h">Downloading for offline</div>' +
        '<div class="atlas-prog" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
          pct + '"><i style="width:' + pct + '%"></i></div>' +
        '<p class="atlas-pop-note">' + pct + "% · " + _dl.done + " of " + (_dl.total || "?") + " files · " + fmtBytes(_dl.bytes) + "</p>" +
        '<button class="atlas-menu-item" data-atlas-act="offstop">' + (ico("x") || "") + "<span>Stop download</span></button>";
    }
    if (_dl) return '<p class="atlas-pop-note">Another module is downloading. Try again when it finishes.</p>';
    if (rec) return '<div class="atlas-pop-note ok">' + (ico("check") || "") + " Available offline · " + fmtBytes(rec.bytes || 0) + "</div>" +
      '<button class="atlas-menu-item" data-atlas-act="offremove">' + (ico("trash") || "") + "<span>Remove offline copy</span></button>";
    return (_dlErr === id ? '<p class="atlas-pop-note bad">The download did not finish. Check your connection and try again.</p>' : "") +
      '<button class="atlas-menu-item" data-atlas-act="offline">' + (ico("download") || "") +
      "<span>Download for offline</span><em>" + offlineFiles(st.atlas, moduleMeta()).length + " files</em></button>";
  }
  function offUi() {
    if (st.pop === "more") renderPop();
    [].slice.call((G.document && G.document.querySelectorAll("[data-off]")) || []).forEach(function (el) {
      el.textContent = offBadge(el.getAttribute("data-off"));
    });
  }

  function startDownload(id) {
    if (_dl || !offCaps()) return;
    var mod = modById(id) || {}, d = _dl = { id: id, done: 0, total: 0, bytes: 0, stop: false, err: null };
    _dlErr = null; offUi();
    var name = offCacheName(id), mc = G.SMD_THOREX_MODEL_CACHE;
    function one(path) {
      var url = netUrl(path);
      var p = (mc && mc.loadModelBytes) ? mc.loadModelBytes(url, { cacheName: name })
        : G.fetch(url).then(function (r) {
            if (!r || !r.ok) throw new Error("http " + (r && r.status));
            return G.caches.open(name).then(function (c) { return c.put(url, r.clone()); }).then(function () { return r.arrayBuffer(); });
          });
      return p.then(function (buf) { d.bytes += (buf && buf.byteLength) || 0; d.done++; offUi(); })
        .catch(function (e) { d.err = e || true; throw e; });
    }
    atlasJson(id).then(function (atlas) {
      if (!atlas) throw new Error("no module data");
      var files = offlineFiles(atlas, mod).concat(["/atlas/modules.json"]), k = 0;
      d.total = files.length; offUi();
      function worker() {
        if (d.stop || d.err || k >= files.length) return Promise.resolve();
        return one(files[k++]).then(worker);
      }
      return Promise.all([worker(), worker(), worker(), worker()]);
    }).then(function () {
      if (d.stop) throw new Error("stopped");
      var all = lsGet(OFF_KEY, {});
      all[id] = { n: d.total, bytes: d.bytes, t: Date.now() };
      lsSet(OFF_KEY, all);
      _dl = null;
      if (st.moduleId === id && st.view === "viewer") return prepareBlobs(id).then(function () {
        var s = curSlice(), img = $("atlasImg");
        if (img && s) gateImg(img, imgFor(s));          // switch the visible slice to the cache now
      });
    }).then(function () { offUi(); }, function () {
      var stopped = d.stop;
      _dl = null;
      if (!stopped) _dlErr = id;
      try { G.caches["delete"](name); } catch (e) {}
      offUi();
    });
  }
  function removeOffline(id) {
    var all = lsGet(OFF_KEY, {});
    delete all[id]; lsSet(OFF_KEY, all);
    if (st.moduleId === id) revokeBlobs();
    var done = function () { offUi(); };
    try { return Promise.resolve(G.caches["delete"](offCacheName(id))).then(done, done); } catch (e) { done(); }
  }

  // Object URLs over a downloaded module's cached images, so every <img> and thumbnail in the
  // viewer resolves without the network. Revoked when the visit ends (resetViewState).
  function prepareBlobs(id) {
    if (!offRec(id) || !offCaps() || !st.atlas) return Promise.resolve();
    var files = offlineFiles(st.atlas, moduleMeta()).filter(function (f) { return !/\.json$/.test(f); });
    return G.caches.open(offCacheName(id)).then(function (c) {
      return Promise.all(files.map(function (f) {
        return c.match(netUrl(f)).then(function (r) { return r ? r.blob() : null; }).then(function (b) {
          if (!b || st.moduleId !== id) return;
          _blob[f] = G.URL.createObjectURL(b.type ? b : new G.Blob([b], { type: "image/webp" }));
        }).catch(function () {});
      }));
    }).catch(function () {});
  }
  function revokeBlobs() {
    Object.keys(_blob).forEach(function (k) { try { G.URL.revokeObjectURL(_blob[k]); } catch (e) {} });
    _blob = {};
  }

  /* ---------- plane localizer ---------- */
  // Modules cut from one volume share a `group` and carry a `plane`; each slice's q places it in
  // the shared frame. Chips switch plane at the same anatomical point; the scout shows where the
  // current slice cuts a sibling plane, and tapping it moves there.
  var PLANES = ["axial", "coronal", "sagittal"], SCOUT_H = 60;
  function siblings() {
    var m = moduleMeta();
    if (!m.group || !m.plane) return [];
    return ((st.catalog && st.catalog.modules) || []).filter(function (x) {
      return x.group === m.group && x.plane && !x.hidden;
    }).sort(function (a, b) { return PLANES.indexOf(a.plane) - PLANES.indexOf(b.plane); });
  }
  function scoutModule() {
    var m = moduleMeta(), pref = { axial: "coronal", sagittal: "coronal", coronal: "axial" }[m.plane];
    var sib = siblings().filter(function (x) { return x.id !== m.id; });
    return sib.filter(function (x) { return x.plane === pref; })[0] || sib[0] || null;
  }
  function locHtml() {
    var sib = siblings(), s = curSlice();
    if (sib.length < 2 || !s || !s.q) return "";
    return '<div class="atlas-loc" id="atlasLoc">' +
      segHtml("plane", sib.map(function (x) { return [x.id, cap(x.plane)]; }), st.moduleId, "Plane") +
      '<span class="atlas-sp"></span><span class="atlas-scout-host" id="atlasScout">' + scoutHtml() + "</span></div>";
  }
  function scoutHtml() {
    var t = scoutModule(), s = curSlice();
    if (!t || !s || !s.q) return "";
    var a = _json[t.id];
    if (!a) {
      atlasJson(t.id).then(function () { updateScout(); });
      return '<span class="atlas-scout ph" style="width:' + SCOUT_H + "px;height:" + SCOUT_H + 'px"></span>';
    }
    var mid = a.slices[Math.ceil(a.slices.length / 2) - 1];
    if (!mid || !mid.q) return "";
    var H = SCOUT_H, W = Math.round(H * (mid.aspect || 1)), seg = scoutSegment(s.q, mid.q, modFlip(t), W, H);
    return '<span class="atlas-scout" data-atlas-act="scout" data-v="' + esc(t.id) + '" role="img" aria-label="' +
      esc(cap(t.plane) + " scout: the line marks this slice. Tap it to move to another level.") +
      '" style="width:' + W + "px;height:" + H + 'px">' +
      '<img alt="" draggable="false" src="' + esc(imgUrl(thumbOf(mid.img))) + '"' + flipCls(t) + ">" +
      (seg ? '<svg viewBox="0 0 ' + W + " " + H + '" aria-hidden="true"><line x1="' + seg[0].x.toFixed(1) + '" y1="' + seg[0].y.toFixed(1) +
        '" x2="' + seg[1].x.toFixed(1) + '" y2="' + seg[1].y.toFixed(1) + '"/></svg>' : "") + "</span>";
  }
  function updateScout() { var h = $("atlasScout"); if (h) h.innerHTML = scoutHtml(); }

  // The 3D point to keep when switching plane: the selected structure's pin on this slice (the
  // tapped one if any), else the image centre.
  function anchorPoint() {
    var s = curSlice();
    if (!s || !s.q) return null;
    var id = st.sel || st.locked, pin = null;
    ((s.pins || [])).forEach(function (p) {
      if (p.s !== id) return;
      if (!pin || (st.anchor && Math.abs(p.x - st.anchor.x) + Math.abs(p.y - st.anchor.y) < Math.abs(pin.x - st.anchor.x) + Math.abs(pin.y - st.anchor.y))) pin = p;
    });
    return qPoint(s.q, pin ? pin.x / 100 : 0.5, pin ? pin.y / 100 : 0.5);
  }
  // A sibling's atlas.json may still be downloading: drop the answer if the user left the viewer
  // (st.req moves on every navigation) or tapped another plane chip since (the latest tap wins).
  var _planeTap = 0;
  function switchPlane(id) {
    if (!id || id === st.moduleId) return;
    var p = anchorPoint(), keep = st.sel || st.locked, req = st.req, tap = ++_planeTap;
    atlasJson(id).then(function (a) {
      if (req !== st.req || tap !== _planeTap) return;
      var i = (p && a) ? nearestSlice(a.slices, p) || 1 : 1;
      openAt(id, keep && a && a.structures && a.structures[keep] ? keep : null, i);
    });
  }
  function scoutJump(el, e) {
    var t = modById(el.getAttribute("data-v")), a = t && _json[t.id];
    if (!a || !st.atlas || e.detail === 0) return;
    var mid = a.slices[Math.ceil(a.slices.length / 2) - 1], r = el.getBoundingClientRect();
    var f = toImage({ x: 0, y: 0, w: r.width, h: r.height }, modFlip(t), e.clientX - r.left, e.clientY - r.top);
    var i = nearestSlice(st.atlas.slices, qPoint(mid.q, f.x / 100, f.y / 100));
    if (i) { stopCoast(); setSlice(i); }
  }

  /* ---------- clinical notes (flag smd_atlas_notes, default OFF) ---------- */
  // Same flag shape as atlas3d.js enabled(): ?atlasnotes=1|0 wins, else localStorage, else OFF.
  var NOTES_KEY = "smd_atlas_notes", NOTES_Q = "atlasnotes";
  function notesOn() {
    try {
      var m = (G.location && G.location.search || "").match(new RegExp("[?&]" + NOTES_Q + "=([^&]+)"));
      if (m) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      var v = G.localStorage && G.localStorage.getItem(NOTES_KEY);
      return v === "1" || v === "on" || v === "true";
    } catch (e) { return false; }
  }
  var _notesP = null;
  function loadNotes() {
    if (!notesOn()) return Promise.resolve(null);
    if (!_notesP) _notesP = fetchJson("/atlas/notes.json").then(function (j) { st.notes = j || { notes: {} }; return st.notes; });
    return _notesP;
  }
  function notesBody(id) {
    if (!st.notes) {
      loadNotes().then(function () { if (_tab === "clinical" && (st.sel === id) && sheetOpen()) openSheet(id); });
      return '<p class="atlas-def">Loading…</p>';
    }
    var n = (st.notes.notes || {})[id];
    if (!n || (!n.clinical && !n.imaging)) return '<p class="atlas-def">No clinical note for this structure yet.</p>';
    var rv = n.review || st.notes.review;
    return (rv !== "reviewed" ? '<p class="atlas-badge" role="note">Draft, pending clinical review</p>' : "") +
      (n.clinical ? '<h3 class="atlas-note-h">Clinical</h3><p class="atlas-def">' + esc(n.clinical) + "</p>" : "") +
      (n.imaging ? '<h3 class="atlas-note-h">Imaging</h3><p class="atlas-def">' + esc(n.imaging) + "</p>" : "");
  }
  function sheetOpen() { var el = $("atlasSheet"); return !!(el && el.classList.contains("on")); }

  /* ---------- side panel (900 px and up) ---------- */
  var SIDE_W = 360;
  function sideMode() {
    try { return !!(G.matchMedia && G.matchMedia("(min-width: 900px)").matches); } catch (e) { return false; }
  }
  // The side panel spans exactly the stage's height, so the tool row and the slice bar stay usable.
  function placeSide() {
    var el = $("atlasSheet"), stage = $("atlasStage"), root = rootEl();
    if (!el) return;
    if (!el.classList.contains("side") || !stage) { el.style.top = ""; el.style.bottom = ""; return; }
    try {
      var r = stage.getBoundingClientRect(), rr = root.getBoundingClientRect(), k = stageScale(stage, r);
      el.style.top = ((r.top - rr.top) / k).toFixed(1) + "px";
      el.style.bottom = ((rr.bottom - r.bottom) / k).toFixed(1) + "px";
    } catch (e) {}
  }

  /* ---------- search runtime ---------- */

  var _qT = null;
  function runSearch() {
    var inp = $("atlasQ"), res = $("atlasResults"), browse = $("atlasBrowse"), stat = $("atlasQStatus");
    if (!inp || !res) return;
    var q = inp.value;
    if (!normText(q)) {
      res.hidden = true; res.innerHTML = ""; if (browse) browse.hidden = false; if (stat) stat.textContent = "";
      return;
    }
    loadIndex().then(function () {
      if (inp.value !== q) return;                         // a newer keystroke owns the results
      var mods = (st.catalog && st.catalog.modules) || [], r = searchAtlas(q, st.index, mods, 40);
      res.innerHTML = resultsHtml(q, r);
      res.hidden = false; if (browse) browse.hidden = true;
      var n = r.structures.length + r.modules.length;
      if (stat) stat.textContent = n ? n + (n === 1 ? " result" : " results") : "No results";
    });
  }
  function runSearchSoon() {
    if (!G.setTimeout) return runSearch();
    if (_qT) G.clearTimeout(_qT);
    _qT = G.setTimeout(function () { _qT = null; runSearch(); }, 140);
  }
  function loadIndex() {
    if (st.index) return Promise.resolve(st.index);
    return fetchJson("/atlas/index.json").then(function (j) { st.index = j || { structures: [] }; return st.index; });
  }

  // ponytail: category colours copied from the module JSON, because index.json carries only the
  // category id. An index.json `cats` map ({id: {label, color}}) wins as soon as the data ships it.
  var CATS = { viscus: ["Viscus", "#ffd479"], "gi-tract": ["GI tract", "#c9a06a"], "vessel-artery": ["Artery", "#ff8080"],
    "vessel-vein": ["Vein", "#8fb8ff"], urinary: ["Urinary", "#7fd9e8"], airway: ["Airway", "#7ee081"], muscle: ["Muscle", "#e0a0c0"],
    csf: ["CSF", "#7fd9e8"], bone: ["Bone", "#ffffff"], "deep-grey": ["Deep grey", "#9370db"], grey: ["Grey matter", "#c8a2c8"],
    "grey-matter": ["Grey matter", "#7ee081"], white: ["White matter", "#f0ead6"], "white-matter": ["White matter", "#ffffff"],
    mixed: ["Mixed grey and white", "#b9a8c9"] };
  function catOf(c) {
    var x = st.index && st.index.cats && st.index.cats[c];
    if (x) return [x.label || x.l || c, x.color || x.c || "#ffffff"];
    return CATS[c] || [c, "#ffffff"];
  }

  function resultsHtml(q, r) {
    if (!r.structures.length && !r.modules.length)
      return '<p class="atlas-empty">Nothing matches "' + esc(q.trim()) + '". Check the spelling, or try a broader word such as liver, kidney or brain.</p>';
    var h = "";
    if (r.structures.length) h += '<div class="atlas-grp-h sm">Structures</div><ul class="atlas-res-list">' + r.structures.map(function (s) {
      var c = catOf(s.c), best = s.m.slice().sort(function (a, b) { return b[2] - a[2]; })[0];
      return '<li class="atlas-res"><button class="atlas-res-main" data-atlas-act="open" data-m="' + esc(best[0]) + '" data-s="' + esc(s.s) +
        '" data-i="' + best[1] + '"><i style="background:' + esc(c[1]) + '"></i><span class="atlas-res-n">' + esc(s.n) +
        '</span><span class="atlas-res-c">' + esc(c[0]) + "</span></button>" +
        '<span class="atlas-res-mods">' + s.m.map(function (row) {
          var m = modById(row[0]) || { title: row[0] };
          return '<button class="atlas-chip" data-atlas-act="open" data-m="' + esc(row[0]) + '" data-s="' + esc(s.s) + '" data-i="' + row[1] +
            '" aria-label="' + esc(s.n + " in " + m.title + ", " + planeOf(m)) + '">' + esc(m.title + " · " + planeOf(m)) + "</button>";
        }).join("") + "</span></li>";
    }).join("") + "</ul>";
    if (r.modules.length) h += '<div class="atlas-grp-h sm">Modules</div>' + r.modules.map(function (x) { return moduleRow(modById(x.id)); }).join("");
    return h;
  }

  function searchScreenHtml() {
    return '<div class="atlas-info-screen" id="atlasSearch">' +
      '<div class="atlas-top"><button class="atlas-back" data-atlas-act="searchclose" aria-label="Close search">‹</button>' +
      '<span class="atlas-hd"><span class="atlas-ttl">Search</span></span></div>' +
      '<div class="atlas-scroll">' + searchBoxHtml() + "</div></div>";
  }
  function openSearch() {
    dropOverlay("atlasSearch");
    pushOverlay(searchScreenHtml());
    var q = $("atlasQ");
    try { if (q) q.focus(); } catch (e) {}
    loadIndex();
  }

  // Arrow keys move between the search box and its results; Enter opens the first result;
  // Escape clears a non-empty query before it closes anything.
  function onKeys(e) {
    var t = e.target, id = t && t.id, res = $("atlasResults");
    if (id === "atlasBmName" && e.key === "Enter") { e.preventDefault(); bmSave(t.value); closePop(); return starUi(); }
    if (!res) return;
    var btns = [].slice.call(res.querySelectorAll("button")), k = btns.indexOf(t);
    if (id === "atlasQ") {
      if (e.key === "Escape" && t.value) { e.preventDefault(); e.stopPropagation(); t.value = ""; return runSearch(); }
      if (e.key === "ArrowDown" && btns.length && !res.hidden) { e.preventDefault(); return btns[0].focus(); }
      if (e.key === "Enter") {
        e.preventDefault();
        if (_qT) { G.clearTimeout(_qT); _qT = null; runSearch(); }
        if (btns.length && !res.hidden) btns[0].click();
      }
      return;
    }
    if (k < 0) return;
    if (e.key === "ArrowDown" && k < btns.length - 1) { e.preventDefault(); btns[k + 1].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (k > 0 ? btns[k - 1] : $("atlasQ")).focus(); }
  }

  /* ---------- lifecycle ---------- */

  // Show the overlay and wire its listeners (idempotent).
  function openShell() {
    var el = rootEl();
    if (!el) return null;
    st.sel = null; st.locked = null; st.hidden = {};
    if (!isOpen()) {
      try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; }
    }
    try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
    el.removeEventListener("click", onClick);
    el.addEventListener("click", onClick);
    el.removeEventListener("input", onInput);
    el.addEventListener("input", onInput);
    el.removeEventListener("pointerdown", onAnyDown, true);
    el.addEventListener("pointerdown", onAnyDown, true);
    el.removeEventListener("keydown", onAnyDown, true);
    el.addEventListener("keydown", onAnyDown, true);
    el.removeEventListener("keydown", onKeys);
    el.addEventListener("keydown", onKeys);
    el.classList.add("on");
    G.document.body.classList.add("atlas-lock");
    try { if (threeD() && G.ATLAS3D.prime) G.ATLAS3D.prime(); } catch (e) {}
    return el;
  }

  function open(moduleId) {
    if (!openShell()) return;
    if (moduleId) {
      enterViewer(moduleId);
      paint();
      // Deep links land here without a catalog, and the viewer header needs the
      // module's title/subtitle from it — so boot() loads both.
      boot(moduleId);
    } else {
      st.view = "catalog";
      paint();
      loadCatalog().then(function () { if (st.view === "catalog") paint(); });
    }
  }

  // Deep-link a structure: used by the 3D layer's "CT / MRI" rows, search, recents, bookmarks and
  // the plane chips. Opens the module (and the atlas itself if needed), jumps to the slice, and
  // LOCKS the structure so it stays highlighted while the user scrolls.
  function openAt(moduleId, structureId, slice) {
    if (!openShell()) return Promise.resolve();
    enterViewer(moduleId);
    paint();
    return boot(moduleId, function () {
      st.slice = Math.min(Math.max(+slice || 1, 1), total() || 1);
    }).then(function (a) {
      if (!a || a === STALE || st.moduleId !== moduleId) return;
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
    if ($("atlasSearch")) { dropOverlay("atlasSearch"); return true; }
    if (closePop()) return true;
    var q = st.view === "catalog" && $("atlasQ");
    if (q && q.value) { q.value = ""; runSearch(); return true; }   // clear a search before leaving
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
    windowUrl: windowUrl, defaultLabelMode: defaultLabelMode, placePins: placePins,
    normText: normText, searchAtlas: searchAtlas, pushRecent: pushRecent, qPoint: qPoint,
    qNormal: qNormal, planeDist: planeDist, nearestSlice: nearestSlice, planeLine: planeLine,
    offlineFiles: offlineFiles, flipOf: flipOf, imgTransform: imgTransform, scoutSegment: scoutSegment
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
