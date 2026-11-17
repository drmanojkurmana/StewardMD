/* PrepNucleus Study Studio (phase A1 to A8): a PDF library, notebooks, a viewer, a pen and search. window.STUDY. ES5. Loaded by
   prep-loader.js only when flag smd_study is on; draws through PREP._host. prep.js forwards every data-act starting
   "st-" here and asks back() first. Plan: vault/plans/PrepNucleus-StudyStudio.md, note: vault/modules/Study Studio.md.
   Flag smd_study, default OFF, needs smd_prep: localStorage "1" or ?study=1 on, "0" or ?study=0 off.
   Data: IndexedDB "study": docs (metadata + thumbnail), files (original bytes, only when Filesystem is absent), folders,
   strokes (one record per stroke, page-relative 0..1 points [x, y, pressure]), undo (the stacks, per document),
   ptext (one record per page and source, "pdf" or "ocr": the search index), index (pages of each PDF indexed so far).
   A notebook is a docs record with kind "nb" and no PDF: ord lists its stable page ids in order, a stroke's page is that id.
   The original PDF is never modified: it is written once at import and only read afterwards.
   A scan or a set of photos becomes one jsPDF PDF stored like an import; on-device OCR text goes in through setPageText.
   Pure helpers (page-relative maths, eraser hit test, undo/redo stack) load under node. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  function enabled(search, get, prepOn) {
    try {
      if (!prepOn) return false;
      var q = (String(search || "").match(/[?&]study=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return get("smd_study") !== "0";   // default ON (owner 2026-11-15, app not public yet)
    } catch (e) { return false; }
  }
  // Pointer position in a box (CSS px rect) to 0..1, and back.
  function toRel(x, y, r) { return [(x - r.left) / r.width, (y - r.top) / r.height]; }
  function toAbs(rx, ry, w, h) { return [rx * w, ry * h]; }
  function dist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var cx = ax + t * dx - px, cy = ay + t * dy - py;
    return cx * cx + cy * cy;
  }
  // Does a circle of rad px at (rx, ry) (0..1) touch the stroke on a w x h px page? Half the stroke width counts.
  function hit(s, rx, ry, rad, w, h) {
    var p = s.pts, px = rx * w, py = ry * h, r = rad + (s.w * w) / 2, r2 = r * r, i;
    if (!p.length) return false;
    if (p.length === 1) return dist2(px, py, p[0][0] * w, p[0][1] * h, p[0][0] * w, p[0][1] * h) <= r2;
    for (i = 1; i < p.length; i++) if (dist2(px, py, p[i - 1][0] * w, p[i - 1][1] * h, p[i][0] * w, p[i][1] * h) <= r2) return true;
    return false;
  }
  // Point in polygon test (ray casting). poly: [[x, y], ...] in 0..1 coordinates.
  function pointInPoly(px, py, poly) {
    var inside = false, i, j = poly.length - 1;
    for (i = 0; i < poly.length; i++) {
      var xi = poly[i][0], yi = poly[i][1];
      var xj = poly[j][0], yj = poly[j][1];
      var intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
      j = i;
    }
    return inside;
  }
  // Does a lasso loop enclose the stroke?
  function lassoHit(s, poly) {
    if (!s || !s.pts || !s.pts.length || !poly || poly.length < 3) return false;
    var pts = s.pts, insideCount = 0;
    for (var i = 0; i < pts.length; i++) {
      if (pointInPoly(pts[i][0], pts[i][1], poly)) insideCount++;
    }
    return insideCount > pts.length * 0.45;
  }
  // Strict scribble detector (phase P0, ink-loss fix). Handwriting like m, n, w, z, e, s must never read as a
  // scribble: the stroke must clear every gate, any single miss keeps it as a normal stroke. Gates:
  // >=6 reversals on the main axis, drawn in under 800 ms, path length >=4x the bbox diagonal, box width
  // <25% of the page width, and >=30% of its points within 6 px of existing (not gone) ink.
  // pts: [[x, y, pressure?, tMs?]] page-relative 0..1; opts: { durationMs, pageW, pageH, ink } where ink is
  // an array of strokes { pts, gone } or raw pts arrays on the same page. Without page dimensions a 1000 px
  // page is assumed for the 6 px tests. Missing duration or ink fails closed (not a scribble).
  function ptDist2Seg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var cx = ax + t * dx - px, cy = ay + t * dy - py;
    return cx * cx + cy * cy;
  }
  function segCross(a1, a2, b1, b2) {
    function o(p, q, r) { var v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return v > 0 ? 1 : v < 0 ? -1 : 0; }
    function on(p, q, r) { return q[0] <= Math.max(p[0], r[0]) && q[0] >= Math.min(p[0], r[0]) && q[1] <= Math.max(p[1], r[1]) && q[1] >= Math.min(p[1], r[1]); }
    var o1 = o(a1, a2, b1), o2 = o(a1, a2, b2), o3 = o(b1, b2, a1), o4 = o(b1, b2, a2);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && on(a1, b1, a2)) return true;
    if (o2 === 0 && on(a1, b2, a2)) return true;
    if (o3 === 0 && on(b1, a1, b2)) return true;
    if (o4 === 0 && on(b1, a2, b2)) return true;
    return false;
  }
  function minDistToPoly(px, py, polyPx, W, H) {
    var best = Infinity, i;
    if (!polyPx || !polyPx.length) return best;
    if (polyPx.length === 1) { var dx = px - polyPx[0][0], dy = py - polyPx[0][1]; return dx * dx + dy * dy; }
    for (i = 1; i < polyPx.length; i++) {
      var d = ptDist2Seg(px, py, polyPx[i - 1][0], polyPx[i - 1][1], polyPx[i][0], polyPx[i][1]);
      if (d < best) best = d;
    }
    return best;
  }
  function toPx(pts, W, H) {
    var out = [], i;
    for (i = 0; i < pts.length; i++) out.push([pts[i][0] * W, pts[i][1] * H]);
    return out;
  }
  function isScribble(pts, opts) {
    if (!pts || pts.length < 8) return false;
    opts = opts || {};
    var W = opts.pageW || 1000, H = opts.pageH || 1000;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, pathLen = 0, i;
    for (i = 0; i < pts.length; i++) {
      var x = pts[i][0], y = pts[i][1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (i > 0) {
        var dx0 = (x - pts[i - 1][0]) * W, dy0 = (y - pts[i - 1][1]) * H;
        pathLen += Math.sqrt(dx0 * dx0 + dy0 * dy0);
      }
    }
    var bw = maxX - minX, bh = maxY - minY;
    if (bw >= 0.25) return false;
    var diag = Math.sqrt(bw * bw + bh * bh);
    if (diag < 0.005 || diag > 0.6) return false;
    var diagPx = Math.sqrt(Math.pow(bw * W, 2) + Math.pow(bh * H, 2));
    if (diagPx <= 0 || pathLen / diagPx < 4) return false;
    var dur = opts.durationMs;
    if (dur == null) {
      var t0 = pts[0] && pts[0][3], t1 = pts[pts.length - 1] && pts[pts.length - 1][3];
      if (t0 != null && t1 != null) dur = t1 - t0;
    }
    if (dur == null || !(dur >= 0) || dur >= 800) return false;
    var mainX = bw >= bh, revs = 0, lastSign = 0, acc = 0, stepThreshold = diag * 0.06;
    for (i = 1; i < pts.length; i++) {
      acc += mainX ? (pts[i][0] - pts[i - 1][0]) : (pts[i][1] - pts[i - 1][1]);
      if (Math.abs(acc) >= stepThreshold) {
        var s = acc > 0 ? 1 : -1;
        if (lastSign !== 0 && s !== lastSign) revs++;
        lastSign = s;
        acc = 0;
      }
    }
    if (revs < 6) return false;
    var ink = opts.ink;
    if (!ink || !ink.length) return false;
    var inkPx = [], onInk = 0;
    for (i = 0; i < ink.length; i++) {
      var ip = ink[i] && ink[i].pts ? ink[i].pts : ink[i];
      if (!ip || !ip.length || (ink[i] && ink[i].gone)) continue;
      inkPx.push(toPx(ip, W, H));
    }
    if (!inkPx.length) return false;
    var rad2 = 36;
    for (i = 0; i < pts.length; i++) {
      var px = pts[i][0] * W, py = pts[i][1] * H, best = Infinity, k;
      for (k = 0; k < inkPx.length; k++) {
        var d = minDistToPoly(px, py, inkPx[k], W, H);
        if (d < best) best = d;
        if (best <= rad2) break;
      }
      if (best <= rad2) onInk++;
    }
    return onInk / pts.length >= 0.3;
  }
  // Covered test for a scribble erase (phase P0): a stroke counts as covered only when it actually crosses
  // the scribble path. At least 2 of its points within 6 px of the scribble (a single-point dot needs its
  // one point within 6 px) or any of its segments crossing the scribble path. Never an 18 px neighbourhood.
  function coveredBy(scribblePts, s, W, H) {
    if (!scribblePts || !scribblePts.length || !s || !s.pts || !s.pts.length) return false;
    W = W || 1000; H = H || 1000;
    var sc = toPx(scribblePts, W, H), tg = toPx(s.pts, W, H), rad2 = 36, near = 0, i, j;
    for (i = 0; i < tg.length; i++) {
      if (minDistToPoly(tg[i][0], tg[i][1], sc, W, H) <= rad2) near++;
    }
    if (near >= 2 || (tg.length < 2 && near >= 1)) return true;
    for (i = 1; i < tg.length; i++) for (j = 1; j < sc.length; j++) {
      if (segCross(tg[i - 1], tg[i], sc[j - 1], sc[j])) return true;
    }
    return false;
  }
  // Undo/redo: ops are { t: "add", id } or { t: "del", ids: [id] }. Strokes are never deleted, only flagged gone, so
  // an op is just ids and the stacks stay small enough to persist.
  var CAP = 200;
  function newStack(o) { return { u: (o && o.u) || [], r: (o && o.r) || [] }; }
  function push(st, op) { st.u.push(op); if (st.u.length > CAP) st.u.shift(); st.r = []; return st; }
  // Phase 2 (study-select.js): addmulti = one undo step for many new strokes; xform = before/after snapshots.
  function opIds(op) { if (op.t === "add") return [op.id]; if (op.t === "addmulti") return op.ids || []; if (op.t === "xform") return (op.before || []).map(function (t) { return t.id; }); if (op.t === "split") return (op.orig || []).concat(op.pieces || []); return op.ids; }
  // gone value each id of op takes when the op is undone (undoing true) or applied again.
  function goneAfter(op, undoing) { if (op.t === "xform") return undefined; if (op.t === "add" || op.t === "addmulti") return !!undoing; return !undoing; }
  function undo(st) { var op = st.u.pop(); if (!op) return null; st.r.push(op); return { op: op, gone: goneAfter(op, true), undoing: true }; }
  function redo(st) { var op = st.r.pop(); if (!op) return null; st.u.push(op); return { op: op, gone: goneAfter(op, false), undoing: false }; }
  // Pressure: pens report 0..1; 0 or missing (mouse, finger, unsupported) is 0.5.
  function pressure(e) { return e && e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5; }
  function r4(n) { return Math.round(n * 10000) / 10000; }

  // Page order: move item i by dir (-1 up, +1 down); at an end the order is returned unchanged.
  function moveItem(a, i, dir) { var j = i + dir, b = a.slice(); if (i < 0 || i >= a.length || j < 0 || j >= a.length) return b; b[i] = a[j]; b[j] = a[i]; return b; }
  // Notebook page background as segments [x1, y1, x2, y2] in page-width units (page is 1 wide, ratio tall).
  function bgLines(style, ratio) {
    var base = String(style || "").replace(/-dark$/, ""), L = [], s = 0.05, y, x, end = base === "cornell" ? ratio * 0.8 : ratio;
    if (base === "ruled" || base === "cornell") for (y = s * 2; y < end; y += s) L.push([0, y, 1, y]);
    else if (base === "ruled-wide") { s = 0.10; for (y = s * 2; y < end; y += s) L.push([0, y, 1, y]); }
    if (base === "grid") { for (y = s; y < ratio; y += s) L.push([0, y, 1, y]); for (x = s; x < 1; x += s) L.push([x, 0, x, ratio]); }
    if (base === "dotgrid" || base === "dots") { for (y = s * 2; y < ratio; y += s) for (x = s; x < 1; x += s) L.push([x, y, x + 0.0001, y]); }
    if (base === "cornell") { L.push([0.3, s * 2, 0.3, end]); L.push([0, end, 1, end]); }
    if (base === "mcq") { var top = 8, rowH = 18, colW = 1 / 6; L.push([0.03, 0.03 * ratio, 0.97, 0.03 * ratio]); for (var r = 0; r < 20; r++) { var y0 = 44 / (ratio * 400) + r * 0.02; if (y0 + 0.02 > ratio - 0.02) break; L.push([0.03, y0, 0.13, y0]); for (var c = 0; c < 5; c++) { var cx = 0.15 + c * colW; L.push([cx, y0, cx + 0.01, y0]); } } }
    return L;
  }
  function tplForPid(pid) { try { var m = V && V.doc && V.doc.tplMap; if (m && m[pid]) return m[pid]; if (m && m[String(pid)]) return m[String(pid)]; } catch (e) {} try { if (V && V.nb && V.nb.tplMap && V.nb.tplMap[pid]) return V.nb.tplMap[pid]; } catch (e2) {} return (V && V.nb && V.nb.style) || "ruled"; }
  // Snippet around the first case-insensitive match of q in text: { pre, hit, post } or null.
  function snip(text, q, r) {
    var t = String(text || ""), k = String(q || ""), i = k ? t.toLowerCase().indexOf(k.toLowerCase()) : -1, a, b;
    if (i < 0) return null;
    a = Math.max(0, i - r); b = Math.min(t.length, i + k.length + r);
    return { pre: (a ? "..." : "") + t.slice(a, i), hit: t.slice(i, i + k.length), post: t.slice(i + k.length, b) + (b < t.length ? "..." : "") };
  }
  // Pages for Make deck: the typed range ("3-5, 9", Layer C's own parser and 60-page cap) or, left empty, the page on screen.
  function pageSel(spec, cur, total, SR) {
    if (!String(spec || "").trim()) return { pages: [cur] };
    var r = SR.selFromSpec(spec, total);
    return r.error ? { error: r.error } : { pages: r.sel };
  }
  // Backup file (A8): a zip, stored without compression. manifest.json { format, v, created, counts, files: [{ name, sha256, bytes }] },
  // folders.json, docs/<id>.json { doc, strokes, undo, ptext, index } and files/<id>.pdf (the original, byte for byte).
  var BK = "stewardmd-study-backup";
  // entries: { name: Uint8Array } from the unzip; sha(bytes) -> Promise(hex). Resolves { ok: true, man, folders, recs } or { ok: false, error }.
  // Nothing is written by this: restore calls it first and stops on the first problem.
  function verifyBackup(ent, sha) {
    var bad = function (m) { return { ok: false, error: m }; }, dec = function (n) { return JSON.parse(new TextDecoder().decode(ent[n])); }, man, names, listed = {};
    try { man = dec("manifest.json"); } catch (e) { return Promise.resolve(bad("This is not a Study Studio backup.")); }
    if (!man || man.format !== BK || man.v !== 1 || !Array.isArray(man.files) || !man.counts) return Promise.resolve(bad("This is not a Study Studio backup."));
    names = Object.keys(ent).filter(function (n) { return n !== "manifest.json"; });
    man.files.forEach(function (f) { listed[f.name] = f; });
    if (names.length !== man.files.length || names.some(function (n) { return !listed[n]; })) return Promise.resolve(bad("The backup's file list does not match what is inside it."));
    return man.files.reduce(function (p, f) {
      return p.then(function (err) {
        if (err) return err;
        var b = ent[f.name];
        if (b.length !== f.bytes) return "A file in the backup is damaged (wrong size).";
        return sha(b).then(function (h) { return h === f.sha256 ? null : "A file in the backup is damaged (checksum mismatch)."; });
      });
    }, Promise.resolve(null)).then(function (err) {
      if (err) return bad(err);
      var recs = [], folders, audio = [], c = { docs: 0, folders: 0, strokes: 0, ptext: 0, files: 0, items: 0, audio: 0 }, i, r, k;
      /* Phase 5b: audio.json + audio/<id>.bin (optional; old backups have none) */
      try {
        folders = dec("folders.json"); c.folders = folders.length;
        names.forEach(function (n) {
          if (/^docs\//.test(n)) {
            r = dec(n); recs.push(r); c.docs++; c.strokes += r.strokes.length; c.ptext += r.ptext.length;
            if (r.items) c.items += r.items.length;
            if (!/^[a-z0-9]+$/.test(r.doc.id) || n !== "docs/" + r.doc.id + ".json") throw new Error("id");
          }
          else if (/^files\//.test(n)) c.files++;
          else if (/^audio\/.+\.bin$/.test(n)) c.audio++;
        });
        if (ent["audio.json"]) { audio = dec("audio.json"); if (!Array.isArray(audio)) throw new Error("audio"); }
        if (audio.length !== c.audio) return bad("The backup's record counts do not match what is inside it.");
        for (i = 0; i < audio.length; i++) {
          r = audio[i];
          if (!r || !/^[a-z0-9]+$/i.test(String(r.id)) || !listed["audio/" + r.id + ".bin"]) return bad("The backup could not be read.");
        }
      } catch (e) { return bad("The backup could not be read."); }
      for (k in c) { if ((k === "audio" || k === "items") && man.counts[k] == null) continue; if (man.counts[k] !== c[k]) return bad("The backup's record counts do not match what is inside it."); }
      for (i = 0; i < recs.length; i++) {
        r = recs[i].doc;
        if (r.kind !== "nb" && !(listed["files/" + r.id + ".pdf"] && listed["files/" + r.id + ".pdf"].sha256 === r.sha256)) return bad("A document in the backup does not match its file.");
      }
      return { ok: true, man: man, folders: folders, recs: recs, audio: audio };
    });
  }
  // Restore never overwrites: a document is skipped when its id or its sha256 is already in the library.
  function restorePlan(docs, recs) {
    var ids = {}, shas = {}, add = [], skip = [];
    docs.forEach(function (d) { ids[d.id] = 1; if (d.sha256) shas[d.sha256] = 1; });
    recs.forEach(function (r) { (ids[r.doc.id] || (r.doc.sha256 && shas[r.doc.sha256]) ? skip : add).push(r); });
    return { add: add, skip: skip };
  }

  function ixLabel(done, total) { return done >= total ? "" : "Indexing, " + done + " of " + total + " pages"; }
  // Apple Pencil hardware -> which STUDY method to call (ios/App/App/PencilPlugin.swift).
  // Returns the STUDY method name, or null for "ignore".
  function pencilActionFor(action) {
    if (action === "switchEraser" || action === "squeeze") return "pencilDoubleTap";
    if (action === "switchPrevious") return "pencilSwitchPrevious";
    if (action === "showColorPalette" || action === "showInkAttributes") return "openPenSettings";
    return null;
  }

  var PURE = {
    BK: BK, verifyBackup: verifyBackup, restorePlan: restorePlan, pageSel: pageSel, moveItem: moveItem,
    bgLines: bgLines, snip: snip, ixLabel: ixLabel, enabled: enabled, toRel: toRel, toAbs: toAbs,
    hit: hit, newStack: newStack, push: push, undo: undo, redo: redo, opIds: opIds, pressure: pressure,
    r4: r4, pointInPoly: pointInPoly, lassoHit: lassoHit, isScribble: isScribble, coveredBy: coveredBy,
    pencilActionFor: pencilActionFor
  };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var D = G.document, host = null, V = null, penSeen = false, uidN = 0;
  var COLORS = ["#111111", "#1a56db", "#d11a2a", "#168038", "#7b1fa2", "#ea580c"];
  var HCOLORS = ["#ffe14d", "#6fdc6f", "#ff8fc8", "#60a5fa", "#c084fc", "#fb923c"];
  var WIDTHS = [0.0016, 0.0032, 0.0064], HMUL = 6;
  var lib = { filter: "all" };

  var ICO = {
    pen: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    hl: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h3l6-6"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
    er: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    lasso: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
    redo: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    photos: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    scan: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    arrowDown: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    palette: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.4-.4-.8-.4-1.3 0-1.1.9-2 2-2h2.3c3.9 0 7-3.1 7-7 0-5.5-5.4-9.1-10-9.1z"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    text: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    elements: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    laser: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/><circle cx="20" cy="20" r="1"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
  };

  function uid() { return Date.now().toString(36) + (++uidN).toString(36) + Math.random().toString(36).slice(2, 7); }
  function on() { try { return enabled(G.location.search, function (k) { return G.localStorage.getItem(k); }, !G.PREP_LOADER || G.PREP_LOADER.enabled()); } catch (e) { return false; } }

  /* ---- IndexedDB ---- */
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var r = G.indexedDB.open("study", 3);
      r.onupgradeneeded = function () {
        var d = r.result, mk = function (n, k) { return d.objectStoreNames.contains(n) ? null : d.createObjectStore(n, { keyPath: k }); }, s;
        mk("docs", "id"); mk("files", "id"); mk("folders", "id");
        s = mk("strokes", "id"); if (s && !s.indexNames.contains("doc")) s.createIndex("doc", "doc");
        mk("undo", "doc");
        s = mk("ptext", "id"); if (s && !s.indexNames.contains("doc")) s.createIndex("doc", "doc");
        mk("index", "doc");
        s = mk("audio", "id"); if (s && !s.indexNames.contains("doc")) s.createIndex("doc", "doc"); /* Phase 5b */
        s = mk("items", "id"); if (s && !s.indexNames.contains("doc")) s.createIndex("doc", "doc");
      };
      r.onsuccess = function () {
        var conn = r.result;
        /* Phase 5a hang fix: respond to versionchange (e.g. deleteDatabase in tests) so the
           pending request can complete and later opens are not blocked forever. */
        conn.onversionchange = function () { dbP = null; try { conn.close(); } catch (e) {} };
        res(conn);
      };
      r.onerror = function () { dbP = null; rej(r.error); };
    });
    return dbP;
  }
  function q(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), r = fn(t.objectStore(store));
        t.oncomplete = function () { res(r && r.result); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  var get = function (s, k) { return q(s, "readonly", function (o) { return o.get(k); }); };
  var all = function (s) { return q(s, "readonly", function (o) { return o.getAll(); }); };
  var put = function (s, v) { return q(s, "readwrite", function (o) { return o.put(v); }); };
  var del = function (s, k) { return q(s, "readwrite", function (o) { return o.delete(k); }); };
  var strokesOf = function (id) { return q("strokes", "readonly", function (o) { return o.index("doc").getAll(G.IDBKeyRange.only(id)); }); };
  var textOf = function (id) { return q("ptext", "readonly", function (o) { return o.index("doc").getAll(G.IDBKeyRange.only(id)); }); };
  var itemsOf = function (id) { return q("items", "readonly", function (o) { return o.index("doc").getAll(G.IDBKeyRange.only(id)); }); };

  /* ---- original bytes ---- */
  function fsPlugin() { try { var P = G.Capacitor && G.Capacitor.Plugins; return P && P.Filesystem && P.Filesystem.writeFile ? P.Filesystem : null; } catch (e) { return null; } }
  function b64(bytes) { var s = "", i, n = bytes.length; for (i = 0; i < n; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return G.btoa(s); }
  function unb64(s) { var bin = G.atob(s), n = bin.length, a = new Uint8Array(n), i; for (i = 0; i < n; i++) a[i] = bin.charCodeAt(i); return a; }
  function sha256(bytes) {
    return G.crypto.subtle.digest("SHA-256", bytes).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    });
  }
  function saveOriginal(id, bytes) {
    var fs = fsPlugin();
    if (fs) return fs.writeFile({ path: "study/" + id + ".pdf", data: b64(bytes), directory: "DATA", recursive: true }).then(function () { return "fs"; });
    return put("files", { id: id, blob: new Blob([bytes], { type: "application/pdf" }) }).then(function () { return "idb"; });
  }
  function loadOriginal(d) {
    if (d.store === "fs") return fsPlugin().readFile({ path: "study/" + d.id + ".pdf", directory: "DATA" }).then(function (r) { return unb64(r.data); });
    return get("files", d.id).then(function (f) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(new Uint8Array(fr.result)); }; fr.onerror = rej; fr.readAsArrayBuffer(f.blob); }); });
  }

  /* ---- pdf.js ---- */
  var libP = null;
  function pdfjs() {
    if (G.pdfjsLib) { G.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js"; return Promise.resolve(G.pdfjsLib); }
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = D.createElement("script");
      s.src = "/vendor/pdfjs/pdf.min.js";
      s.onload = function () { if (!G.pdfjsLib) { libP = null; return rej(new Error("pdf-load")); } G.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js"; res(G.pdfjsLib); };
      s.onerror = function () { libP = null; rej(new Error("pdf-load")); };
      D.head.appendChild(s);
    });
    return libP;
  }
  function openPdf(bytes) { return pdfjs().then(function (L) { return L.getDocument({ data: bytes.slice() }).promise; }); }

  /* ---- library ---- */
  function importBytes(bytes, name) {
    var id = uid(), meta = { id: id, title: String(name || "PDF").replace(/\.pdf$/i, "").slice(0, 120) || "PDF", created: Date.now(), lastOpened: 0, favourite: false, folderId: null, subject: null };
    return sha256(bytes).then(function (h) {
      meta.sha256 = h;
      return openPdf(bytes);
    }).then(function (pdf) {
      meta.pageCount = pdf.numPages;
      return pdf.getPage(1).then(function (p) {
        var v0 = p.getViewport({ scale: 1 }), sc = 160 / v0.width, v = p.getViewport({ scale: sc }), c = D.createElement("canvas");
        c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        return p.render({ canvasContext: ctx, viewport: v }).promise.then(function () { meta.thumb = c.toDataURL("image/jpeg", 0.7); pdf.destroy(); });
      });
    }).then(function () { return saveOriginal(id, bytes); }).then(function (where) { meta.store = where; return put("docs", meta); }).then(function () { return meta; });
  }
  function pickPdf() {
    var N = G.SMD_NATIVE;
    var viaInput = function () { var f = host.root() && host.root().querySelector("#stFile"); if (f) f.click(); };
    if (!(N && N.pickFile)) return viaInput();
    N.pickFile({ types: ["application/pdf"] }).then(function (blob) {
      return blob.arrayBuffer().then(function (ab) { return importFile(new Uint8Array(ab), blob.name); });
    }, viaInput);
  }
  function importFile(bytes, name) {
    host.toast("Importing...");
    return importBytes(bytes, name).then(function () { host.toast("PDF added."); if (onTop("#stLib")) fillLib(); kick(); }, function () { host.toast("That file could not be added."); });
  }
  function onTop(sel) { return !!(host && host.root() && host.root().querySelector(sel)); }

  /* ---- scan and photos (A5) ---- */
  var jsP = null;
  function jspdf() {
    var J = (G.jspdf && G.jspdf.jsPDF) || G.jsPDF;
    if (J) return Promise.resolve(J);
    if (jsP) return jsP;
    jsP = new Promise(function (res, rej) {
      var s = D.createElement("script"), bad = function () { jsP = null; rej(new Error("pdf-load")); };
      s.src = "/vendor-jspdf.js?v=1";
      s.onload = function () { var K = (G.jspdf && G.jspdf.jsPDF) || G.jsPDF; if (K) res(K); else bad(); };
      s.onerror = bad;
      D.head.appendChild(s);
    });
    return jsP;
  }
  function buildPdf(shots) {
    return jspdf().then(function (J) {
      var doc = null;
      shots.forEach(function (s) {
        var w = 595.28, h = w * s.h / s.w, o = h >= w ? "p" : "l";
        if (!doc) doc = new J({ unit: "pt", format: [w, h], orientation: o, compress: true }); else doc.addPage([w, h], o);
        doc.addImage(s.data, "JPEG", 0, 0, w, h);
      });
      return new Uint8Array(doc.output("arraybuffer"));
    });
  }
  function stamp() { var n = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; }; return n.getFullYear() + "-" + p(n.getMonth() + 1) + "-" + p(n.getDate()) + " " + p(n.getHours()) + ":" + p(n.getMinutes()); }
  function wait(ms) { return new Promise(function (r) { G.setTimeout(r, ms); }); }
  function ocrShots(id, shots) {
    var N = G.SMD_NATIVE, n = 0;
    if (!(N && N.ocr)) return;
    function batch() {
      if (n >= shots.length) return;
      return get("docs", id).then(function (cur) {
        if (!cur) return;
        var end = Math.min(n + 3, shots.length), t = [], i;
        for (i = n; i < end; i++) t.push((function (k) {
          return N.ocr(shots[k].data).then(function (r) { shots[k] = null; return setPageText(id, k + 1, r && r.text); }, function () { shots[k] = null; });
        })(i));
        return Promise.all(t).then(function () { n = end; return wait(30); }).then(batch);
      });
    }
    batch().then(function () {
      var root = host && host.root(), qi = root && root.querySelector("#stQ");
      if (qi && qi.value) runSearch(qi.value);
    }, function () {});
  }
  function shotsToDoc(shots, title) {
    host.toast("Building the PDF...");
    return buildPdf(shots).then(function (bytes) { return importBytes(bytes, title); }).then(function (meta) {
      host.toast("Added " + shots.length + (shots.length === 1 ? " page." : " pages."));
      if (onTop("#stLib")) fillLib();
      kick(); ocrShots(meta.id, shots);
    });
  }
  function readUrl(f) { return new Promise(function (res, rej) { var r = new G.FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(f); }); }
  function normPhoto(url) {
    return new Promise(function (res, rej) {
      var im = new G.Image();
      im.onload = function () {
        var k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)), c = D.createElement("canvas"), x;
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        var out = { data: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height }; c.width = 0; res(out);
      };
      im.onerror = function () { rej(new Error("image")); };
      im.src = url;
    });
  }
  function importPhotos(urls) {
    var shots = [];
    if (!urls.length) return Promise.resolve();
    return urls.reduce(function (p, u) { return p.then(function () { return normPhoto(u).then(function (s) { shots.push(s); }); }); }, Promise.resolve())
      .then(function () { return shotsToDoc(shots, "Photos " + stamp()); }).then(null, function () { host.toast("Those photos could not be added."); });
  }
  function pickPhotos() {
    var N = G.SMD_NATIVE, urls = [];
    if (!(N && N.pickImage)) { var f = host.root() && host.root().querySelector("#stPhotos"); if (f) f.click(); return; }
    (function more() {
      N.pickImage().then(function (u) { urls.push(u); return urls.length < 30 && G.confirm("Add another photo to this PDF?") ? more() : importPhotos(urls); }, function () { importPhotos(urls); });
    })();
  }
  function scanner() {
    try { var P = G.Capacitor && G.Capacitor.Plugins, S = P && P.DocScan; return S && S.scan && S.isAvailable && P.Filesystem && P.Filesystem.readFile ? S : null; } catch (e) { return null; }
  }
  function doScan() {
    var S = scanner(), fs = S && G.Capacitor.Plugins.Filesystem, got = [], uri = function (p) { return /^file:/.test(p) ? p : "file://" + p; };
    if (!S) return;
    S.scan({ maxPages: 30 }).then(function (r) {
      var shots = [];
      got = (r && r.pages) || [];
      return got.reduce(function (p, pg) {
        return p.then(function () { return fs.readFile({ path: uri(pg.path) }).then(function (f) { shots.push({ data: "data:image/jpeg;base64," + f.data, w: pg.width || 1, h: pg.height || 1.414 }); }); });
      }, Promise.resolve()).then(function () { if (shots.length) return shotsToDoc(shots, "Scan " + stamp()); });
    }).then(null, function (e) {
      var c = e && e.code;
      if (c !== "cancelled") host.toast(c === "unavailable" ? "Scanning is not available on this phone." : c === "busy" ? "A scan is already open." : "The scan could not be saved. Try again.");
    }).then(function () {
      got.forEach(function (pg) { try { fs.deleteFile({ path: uri(pg.path) }).then(null, function () {}); } catch (e) {} });
    });
  }

  function closeDocMenu() {
    var m = host && host.root() && host.root().querySelector("#stDocMenuSheet");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function closeFolderSheet() {
    var m = host && host.root() && host.root().querySelector("#stFolderSheet");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function showMoveFolderSheet(id) {
    closeDocMenu();
    closeFolderSheet();
    Promise.all([get("docs", id), all("folders")]).then(function (r) {
      var d = r[0], folders = r[1];
      if (!d) return;
      var esc = host.esc;
      var el = D.createElement("div");
      el.id = "stFolderSheet";
      el.className = "st-sheet";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.innerHTML = '<div class="st-sh st-doc-menu-sheet smd-books-keep smd-emo-keep">' +
        '<div class="st-doc-menu-head">' +
          '<div class="st-doc-menu-title">' +
            '<h3>Move to folder</h3>' +
            '<small>' + esc(d.title) + '</small>' +
          '</div>' +
          '<button type="button" class="pn-btn sm" data-act="st-close-foldersheet">Done</button>' +
        '</div>' +
        '<div class="st-doc-menu-items">' +
          '<button type="button" class="st-menu-item' + (!d.folderId ? ' on' : '') + '" data-act="st-set-folder" data-id="' + d.id + '" data-folder="">' +
            '<div class="st-menu-ico">' + ICO.folder + '</div>' +
            '<div class="st-menu-txt"><strong>(No folder)</strong></div>' +
          '</button>' +
          folders.map(function (f) {
            return '<button type="button" class="st-menu-item' + (d.folderId === f.id ? ' on' : '') + '" data-act="st-set-folder" data-id="' + d.id + '" data-folder="' + f.id + '">' +
              '<div class="st-menu-ico">' + ICO.folder + '</div>' +
              '<div class="st-menu-txt"><strong>' + esc(f.name) + '</strong></div>' +
            '</button>';
          }).join("") +
          '<button type="button" class="st-menu-item" data-act="st-newfolder">' +
            '<div class="st-menu-ico">' + ICO.plus + '</div>' +
            '<div class="st-menu-txt"><strong>Create new folder</strong></div>' +
          '</button>' +
        '</div>' +
      '</div>';
      el.addEventListener("click", function (e) { if (e.target === el) closeFolderSheet(); });
      host.root().appendChild(el);
    });
  }

  function showDocMenu(id) {
    closeDocMenu();
    Promise.all([get("docs", id), all("folders")]).then(function (r) {
      var d = r[0], folders = r[1];
      if (!d) return;
      var esc = host.esc, isNb = d.kind === "nb";
      var fName = d.folderId && folders.reduce(function (a, f) { return f.id === d.folderId ? f.name : a; }, null);
      var el = D.createElement("div");
      el.id = "stDocMenuSheet";
      el.className = "st-sheet";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.innerHTML = '<div class="st-sh st-doc-menu-sheet smd-books-keep smd-emo-keep">' +
        '<div class="st-doc-menu-head">' +
          '<div class="st-doc-menu-title">' +
            '<h3>' + esc(d.title) + '</h3>' +
            '<small>' + (isNb ? "Notebook" : "PDF") + ' • ' + d.pageCount + (d.pageCount === 1 ? " page" : " pages") + (fName ? ' • ' + esc(fName) : '') + '</small>' +
          '</div>' +
          '<button type="button" class="pn-btn sm" data-act="st-close-docmenu">Done</button>' +
        '</div>' +
        '<div class="st-doc-menu-items">' +
          '<button type="button" class="st-menu-item" data-act="st-fav" data-id="' + d.id + '">' +
            '<div class="st-menu-ico">' + (d.favourite ? ICO.starFill : ICO.star) + '</div>' +
            '<div class="st-menu-txt"><strong>' + (d.favourite ? "Remove from Favourites" : "Add to Favourites") + '</strong></div>' +
          '</button>' +
          '<button type="button" class="st-menu-item" data-act="st-rename" data-id="' + d.id + '">' +
            '<div class="st-menu-ico">' + ICO.edit + '</div>' +
            '<div class="st-menu-txt"><strong>Rename</strong></div>' +
          '</button>' +
          '<button type="button" class="st-menu-item" data-act="st-move-folder" data-id="' + d.id + '">' +
            '<div class="st-menu-ico">' + ICO.folder + '</div>' +
            '<div class="st-menu-txt"><strong>Move to folder</strong><small>' + (fName ? esc(fName) : "No folder") + '</small></div>' +
          '</button>' +
          '<button type="button" class="st-menu-item bad" data-act="st-delete" data-id="' + d.id + '">' +
            '<div class="st-menu-ico">' + ICO.trash + '</div>' +
            '<div class="st-menu-txt"><strong>Delete</strong><small>Permanently delete this document</small></div>' +
          '</button>' +
        '</div>' +
      '</div>';
      el.addEventListener("click", function (e) { if (e.target === el) closeDocMenu(); });
      host.root().appendChild(el);
    });
  }

  function renderLib() {
    closeViewer();
    var h = host;
    h.paint(h.bar("Study Studio", "Read and write on your PDFs", "back") + '<div class="pn-body st-lib" id="stLib">' +
      '<div class="st-action-grid" id="stActionGrid">' +
        '<button type="button" class="st-action-tile pri" data-act="st-newnb">' +
          '<div class="st-action-ico">' + ICO.book + '</div>' +
          '<div class="st-action-info"><strong>New notebook</strong></div>' +
        '</button>' +
        '<button type="button" class="st-action-tile" data-act="st-import">' +
          '<div class="st-action-ico">' + ICO.pdf + '</div>' +
          '<div class="st-action-info"><strong>Import PDF</strong></div>' +
        '</button>' +
        '<button type="button" class="st-action-tile" data-act="st-photos">' +
          '<div class="st-action-ico">' + ICO.photos + '</div>' +
          '<div class="st-action-info"><strong>Photos to PDF</strong></div>' +
        '</button>' +
      '</div>' +
      '<input type="file" id="stFile" accept="application/pdf" hidden>' +
      '<input type="file" id="stPhotos" accept="image/*" multiple hidden>' +
      '<div class="st-new" id="stNew" hidden>' +
        '<div class="st-new-row">' +
          '<input id="stNbT" maxlength="120" placeholder="Notebook title" aria-label="Notebook title">' +
          '<select id="stNbS" aria-label="Page style">' +
            '<option value="blank">Blank</option>' +
            '<option value="ruled" selected>Ruled</option>' +
            '<option value="grid">Grid</option>' +
            '<option value="cornell">Cornell</option>' +
            '<option value="dotgrid">Dot grid</option>' +
          '</select>' +
          '<select id="stNbZ" aria-label="Page size"><option value="a4">A4</option><option value="phone">Phone</option></select>' +
          '<button type="button" class="pn-btn pri" data-act="st-mknb">Create</button>' +
        '</div>' +
      '</div>' +
      '<div class="st-search-box">' +
        '<span class="st-search-ico">' + ICO.search + '</span>' +
        '<input type="search" id="stQ" class="st-q" placeholder="Search titles and text" aria-label="Search your library" autocomplete="off">' +
      '</div>' +
      '<div id="stRes" class="smd-books-keep smd-emo-keep" aria-live="polite" hidden></div>' +
      '<div class="st-chips" id="stChips"></div>' +
      '<div id="stList" aria-live="polite"></div>' +
      '<div class="st-backup-box">' +
        '<div class="st-acts">' +
          '<button type="button" class="pn-btn sm" data-act="st-backup">Back up library</button>' +
          '<button type="button" class="pn-btn sm" data-act="st-restore">Restore</button>' +
        '</div>' +
        '<p class="pn-note" id="stBk" role="status" style="margin:0"></p>' +
      '</div>' +
      '<input type="file" id="stRestoreF" accept=".zip,application/zip" hidden>' +
      '<p class="pn-note">PDFs stay on this phone. Your original file is never changed; pen strokes are saved beside it.</p>' +
    '</div>');
    var f = h.root().querySelector("#stFile");
    f.addEventListener("change", function () {
      var file = f.files && f.files[0]; if (!file) return;
      file.arrayBuffer().then(function (ab) { f.value = ""; return importFile(new Uint8Array(ab), file.name); });
    });
    var rf = h.root().querySelector("#stRestoreF");
    rf.addEventListener("change", function () {
      var file = rf.files && rf.files[0]; if (!file) return;
      file.arrayBuffer().then(function (ab) { rf.value = ""; return restoreBytes(new Uint8Array(ab)); });
    });
    var ph = h.root().querySelector("#stPhotos");
    ph.addEventListener("change", function () {
      var fl = Array.prototype.slice.call(ph.files || []); ph.value = "";
      Promise.all(fl.map(readUrl)).then(importPhotos, function () { host.toast("Those photos could not be added."); });
    });
    var sc = scanner();
    if (sc) sc.isAvailable().then(function (r) {
      var root = host.root(), at = root && root.querySelector('[data-act="st-photos"]'), grid = root && root.querySelector("#stActionGrid");
      if (r && r.available && at && !root.querySelector('[data-act="st-scan"]')) {
        if (grid) grid.classList.add("has-scan");
        at.insertAdjacentHTML("afterend",
          '<button type="button" class="st-action-tile" data-act="st-scan">' +
            '<div class="st-action-ico">' + ICO.scan + '</div>' +
            '<div class="st-action-info"><strong>Scan</strong></div>' +
          '</button>');
      }
    }, function () {});
    h.root().querySelector("#stList").addEventListener("change", function (e) {
      var s = e.target.closest && e.target.closest("select[data-id]"); if (!s) return;
      get("docs", s.getAttribute("data-id")).then(function (d) { d.folderId = s.value || null; return put("docs", d); }).then(fillLib);
    });
    var qi = h.root().querySelector("#stQ"), qt = 0;
    qi.addEventListener("input", function () { G.clearTimeout(qt); qt = G.setTimeout(function () { runSearch(qi.value); }, 250); });
    fillLib(); kick();
  }

  function fillLib() {
    if (G.STUDY_LIB && G.STUDY_LIB.renderBody) return G.STUDY_LIB.renderBody();
    closeDocMenu();
    Promise.all([all("docs"), all("folders"), all("index")]).then(function (r) {
      var ixd = {}; r[2].forEach(function (x) { ixd[x.doc] = x.done; });
      var root = host.root(), list = root && root.querySelector("#stList"); if (!list) return;
      var docs = r[0].sort(function (a, b) { return (b.lastOpened || b.created) - (a.lastOpened || a.created); }), folders = r[1], esc = host.esc, f = lib.filter;
      if (f !== "all" && f !== "fav" && !folders.some(function (x) { return x.id === f; })) f = lib.filter = "all";
      var chip = function (v, label) { return '<button type="button" class="st-chip' + (f === v ? " on" : "") + '" data-act="st-filter" data-v="' + esc(v) + '">' + esc(label) + "</button>"; };
      var ch = root.querySelector("#stChips");
      if (ch) ch.innerHTML = chip("all", "Recent") + chip("fav", "Favourites") + folders.map(function (x) { return chip(x.id, x.name); }).join("") +
        '<button type="button" class="st-chip" data-act="st-newfolder">' + ICO.plus + ' Folder</button>' + (f !== "all" && f !== "fav" ? '<button type="button" class="st-chip" data-act="st-delfolder" data-v="' + esc(f) + '">Delete folder</button>' : "");
      var shown = docs.filter(function (d) { return f === "all" || (f === "fav" ? d.favourite : d.folderId === f); });
      if (!shown.length) {
        list.innerHTML = '<div class="st-empty-box"><div class="st-empty-ico">' + ICO.book + '</div>' +
          '<h3>' + (docs.length ? "Nothing in this folder" : "No PDFs yet") + '</h3>' +
          '<p>' + (docs.length ? "Switch to Recent to view all your notes and files." : "Import a PDF, scan notes, or create a notebook to read and write on it.") + '</p>' +
          '<p class="pn-empty" style="display:none">' + (docs.length ? "Nothing here yet." : "No PDFs yet. Import one to read and write on it.") + '</p>' +
        '</div>';
        return;
      }
      list.innerHTML = shown.map(function (d) {
        var isNb = d.kind === "nb";
        var fName = d.folderId && folders.reduce(function (a, fl) { return fl.id === d.folderId ? fl.name : a; }, null);
        return '<div class="st-doc" data-id="' + d.id + '">' +
          '<button type="button" class="st-open" data-act="st-open" data-id="' + d.id + '">' +
            '<div class="st-th-wrap">' +
              (d.thumb ? '<img class="st-th" alt="" src="' + esc(d.thumb) + '" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'flex\';">' : '') +
              '<div class="st-th-placeholder" style="' + (d.thumb ? 'display:none;' : 'display:flex;') + '">' +
                (isNb ? ICO.book : ICO.pdf) +
              '</div>' +
            '</div>' +
            '<span class="st-tt">' +
              '<b>' + esc(d.title) + '</b>' +
              '<small>' + (isNb ? "Notebook, " : "") + d.pageCount + (d.pageCount === 1 ? " page" : " pages") + (fName ? ' • ' + esc(fName) : '') + '</small>' +
              (isNb ? '' : '<small class="st-ix" data-ix="' + d.id + '">' + ixLabel(ixd[d.id] || 0, d.pageCount) + '</small>') +
            '</span>' +
          '</button>' +
          '<div class="st-doc-actions">' +
            '<button type="button" class="st-fav-btn' + (d.favourite ? ' on' : '') + '" data-act="st-fav" data-id="' + d.id + '" aria-pressed="' + !!d.favourite + '" aria-label="' + (d.favourite ? 'Starred' : 'Star') + '">' +
              (d.favourite ? ICO.starFill : ICO.star) +
            '</button>' +
            '<button type="button" class="st-doc-menu-btn" data-act="st-doc-menu" data-id="' + d.id + '" title="More actions" aria-label="More actions">' +
              ICO.more +
            '</button>' +
          '</div>' +
        '</div>';
      }).join("");
    });
  }
  function removeDoc(id) {
    return strokesOf(id).then(function (ss) {
      return Promise.all(ss.map(function (s) { return del("strokes", s.id); }));
    }).then(function () {
      return itemsOf(id).then(function (its) {
        return Promise.all(its.map(function (it) { return del("items", it.id); }));
      });
    }).then(function () { return Promise.all([del("undo", id), del("files", id), del("docs", id)]); }).then(function () { return purge(id); }).then(function () { /* Phase 5b: audio */ try { return q("audio", "readonly", function (o) { try { return o.index("doc").getAll(G.IDBKeyRange.only(id)); } catch (e) { return o.getAll(); } }).then(function (aa) { return Promise.all((aa || []).filter(function (a) { return a.doc === id; }).map(function (a) { return del("audio", a.id); })); }).then(null, function () {}); } catch (e) { return null; } });
  }

  /* ---- notebooks (A4) ---- */
  function drawBg(ctx, style, ratio, W) {
    var dark = /-dark$/.test(style || ""), base = String(style || "").replace(/-dark$/, "");
    ctx.fillStyle = dark ? "#0D1D23" : "#fff"; ctx.fillRect(0, 0, W, W * ratio);
    ctx.strokeStyle = dark ? "rgba(66,205,181,0.28)" : "#b8c4d6"; ctx.lineWidth = Math.max(1, W / 400); ctx.beginPath();
    bgLines(base, ratio).forEach(function (l) { ctx.moveTo(l[0] * W, l[1] * W); ctx.lineTo(l[2] * W, l[3] * W); });
    /* dotgrid dots need filled points */
    if (base === "dotgrid" || base === "dots") { ctx.fillStyle = dark ? "rgba(66,205,181,0.5)" : "#7a8aa0"; ctx.stroke(); for (var i = 0; i < 0; i++) {} ctx.beginPath(); var dg = 0.06; for (var yy = dg * 1.5; yy < ratio; yy += dg) for (var xx = dg; xx < 1; xx += dg) { ctx.fillRect(xx * W, yy * W, Math.max(1, W / 400), Math.max(1, W / 400)); } return; }
    if (base === "mcq") { ctx.stroke(); return; }
    ctx.stroke();
  }
  function makeNotebook(title, style, size) {
    var ratio = size === "phone" ? 2 : 1.414, c = D.createElement("canvas");
    c.width = 160; c.height = Math.round(160 * ratio); drawBg(c.getContext("2d"), style, ratio, 160);
    var meta = { id: uid(), title: String(title || "").trim().slice(0, 120) || "Notebook", kind: "nb", style: style, size: size, ratio: ratio, ord: [1], next: 2, pageCount: 1, created: Date.now(), lastOpened: 0, favourite: false, folderId: null, subject: null, thumb: c.toDataURL("image/jpeg", 0.7) };
    return put("docs", meta).then(function () { return meta; });
  }
  function pid(n) { return V.nb ? V.nb.ord[n - 1] : n; }
  function posOf(id) { return V.nb ? V.nb.ord.indexOf(id) + 1 : id; }
  function reloadNb(goto) {
    var id = V.id, d = V.nb; d.pageCount = d.ord.length; carry = { tool: V.tool, ci: V.ci, wi: V.wi };
    return put("docs", d).then(function () { renderViewer(id, goto); });
  }
  function nbAct(a) {
    curPage(); var n = V.cur || 1, d = V.nb, ord = d.ord;
    if (a === "st-addpg") { var nid = d.next++; ord.splice(n, 0, nid); if (!d.tplMap) d.tplMap = {}; if (!d.tplMap[nid]) d.tplMap[nid] = d.style; return reloadNb(n + 1); }
    if (a === "st-up" || a === "st-dn") { var dir = a === "st-up" ? -1 : 1; d.ord = moveItem(ord, n - 1, dir); return reloadNb(Math.max(1, Math.min(d.ord.length, n + dir))); }
    if (ord.length < 2) return host.toast("A notebook needs at least one page.");
    if (!G.confirm("Delete this page and what you drew on it?")) return;
    var _gone = ord.splice(n - 1, 1)[0], _dead = V.strokes.filter(function (s) { return s.page === _gone; });
    _dead.forEach(function (s) { s.gone = true; put("strokes", s); });
    if (d.tplMap) delete d.tplMap[_gone];
    push(V.stack, { t: "del", ids: _dead.map(function (s) { return s.id; }) });
    return put("docs", d).then(saveStack).then(function () { return reloadNb(Math.min(n, ord.length)); });
  }

  /* ---- search (A6) ---- */
  var ix = { run: false, again: false }, searchTok = 0;
  function purge(id) {
    return textOf(id).then(function (rows) { return Promise.all(rows.map(function (x) { return del("ptext", x.id); })); }).then(function () { return del("index", id); });
  }
  function setPageText(doc, page, text) { return put("ptext", { id: doc + ":" + page + ":ocr", doc: doc, page: page, src: "ocr", text: String(text || "") }); }
  function setIx(id, done, total) {
    var root = host && host.root(), el = root && root.querySelector('[data-ix="' + id + '"]');
    if (el) el.textContent = ixLabel(done, total);
    var qi = root && root.querySelector("#stQ"); if (done >= total && qi && qi.value) runSearch(qi.value);
  }
  function pageText(pdf, p) {
    return pdf.getPage(p).then(function (page) {
      return page.getTextContent().then(function (tc) {
        page.cleanup();
        return tc.items.map(function (i) { return i.str; }).join(" ").replace(/\s+/g, " ").trim();
      });
    });
  }
  function indexDoc(d, from) {
    return loadOriginal(d).then(openPdf).then(function (pdf) {
      var n = from, fin = function () { try { pdf.destroy(); } catch (e) {} };
      function batch() {
        return get("docs", d.id).then(function (cur) {
          if (!cur) return purge(d.id);
          if (n >= pdf.numPages) return;
          var end = Math.min(n + 3, pdf.numPages), t = [], p;
          for (p = n + 1; p <= end; p++) t.push((function (pg) { return pageText(pdf, pg).then(function (txt) { return put("ptext", { id: d.id + ":" + pg + ":pdf", doc: d.id, page: pg, src: "pdf", text: txt }); }); })(p));
          return Promise.all(t).then(function () { n = end; return put("index", { doc: d.id, done: n }); }).then(function () {
            setIx(d.id, n, pdf.numPages);
            return new Promise(function (r) { G.setTimeout(r, 30); });
          }).then(batch);
        });
      }
      return batch().then(fin, fin);
    }).catch(function () {});
  }
  function kick() {
    if (ix.run) { ix.again = true; return; }
    ix.run = true; ix.again = false;
    Promise.all([all("docs"), all("index")]).then(function (r) {
      var done = {}; r[1].forEach(function (x) { done[x.doc] = x.done; });
      return r[0].filter(function (d) { return d.kind !== "nb" && (done[d.id] || 0) < d.pageCount; }).reduce(function (p, d) { return p.then(function () { return indexDoc(d, done[d.id] || 0); }); }, Promise.resolve());
    }).then(function () { return null; }, function () { return null; }).then(function () { ix.run = false; if (ix.again) kick(); });
  }
  function runSearch(raw) {
    var root = host && host.root(), res = root && root.querySelector("#stRes"), qs = String(raw || "").trim(), tok = ++searchTok;
    if (!res) return;
    var show = qs.length < 2;
    res.hidden = show; var lst = root.querySelector("#stList"); if (lst) lst.hidden = !show; var ch = root.querySelector("#stChips"); if (ch) ch.hidden = !show;
    if (show) return;
    Promise.all([all("docs"), all("ptext"), all("index")]).then(function (r) {
      if (tok !== searchTok || !host.root() || !host.root().querySelector("#stRes")) return;
      var by = {}, done = {}, hits = [], pend = [], esc = host.esc;
      r[0].forEach(function (d) { by[d.id] = d; });
      r[2].forEach(function (x) { done[x.doc] = x.done; });
      var mk = function (s) { return esc(s.pre) + "<mark>" + esc(s.hit) + "</mark>" + esc(s.post); };
      r[0].forEach(function (d) {
        var t = snip(d.title, qs, 40); if (t) hits.push({ d: d, page: 1, title: true, html: mk(t) });
        if (d.kind !== "nb" && (done[d.id] || 0) < d.pageCount) pend.push(d);
      });
      r[1].forEach(function (x) { var d = by[x.doc], t = d && snip(x.text, qs, 40); if (t) hits.push({ d: d, page: x.page, title: false, html: mk(t) }); });
      hits.sort(function (a, b) { return (b.title - a.title) || (a.d.title < b.d.title ? -1 : a.d.title > b.d.title ? 1 : 0) || a.page - b.page; });
      var out = hits.slice(0, 60).map(function (h) {
        return '<button type="button" class="st-hit" data-act="st-hit" data-id="' + h.d.id + '" data-page="' + h.page + '"><b>' + esc(h.d.title) + "</b><small>" + (h.title ? (h.d.kind === "nb" ? "Notebook title" : "Title") : "Page " + h.page) + '</small><span class="st-sn">' + h.html + "</span></button>";
      }).join("");
      res.innerHTML = (out || '<p class="pn-empty">Nothing found for "' + esc(qs) + '".</p>') +
        (pend.length ? '<p class="pn-note">Some pages are not yet indexed, so more matches may appear: ' + pend.map(function (d) { return esc(d.title) + " (" + ixLabel(done[d.id] || 0, d.pageCount) + ")"; }).join("; ") + ".</p>" : "");
    });
  }

  /* ---- viewer ---- */
  function closePageSheet() {
    var s = host && host.root() && host.root().querySelector("#stPageSheet");
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }
  function closeMoreMenu() {
    var m = host && host.root() && host.root().querySelector("#stMoreSheet");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }
  function removeLassoBar() {
    var b = host && host.root() && host.root().querySelector("#stLassoBar");
    if (b && b.parentNode) b.parentNode.removeChild(b);
    if (host && host.root() && host.root().classList) host.root().classList.remove("st-lasso-on");
    // Phase 2 hook: study-select.js sub-panels clear with the bar.
    if (G.STUDY_SELECT && G.STUDY_SELECT.removePanels) { try { G.STUDY_SELECT.removePanels(host && host.root()); } catch (e) {} }
  }
  function lassoChipsHtml() {
    return '<button type="button" class="st-ai-chip sm" data-act="st-lasso-ai-explain">' + ICO.sparkle + ' Explain</button>' +
      '<button type="button" class="st-ai-chip sm" data-act="st-lasso-ai-summary">' + ICO.sparkle + ' Key summary</button>' +
      '<button type="button" class="st-ai-chip sm" data-act="st-lasso-ai-make">' + ICO.book + ' Make deck</button>';
  }
  function showLassoBar() {
    // Phase 2 hook: extended menu lives in study-select.js; this keeps working without it (OPTIONAL skip).
    if (G.STUDY_SELECT && G.STUDY_SELECT.showLassoBar) {
      try {
        G.STUDY_SELECT.showLassoBar(inkApi(V && V.cur ? V.cur : 1, null));
        // Phase 4: AI on selection and Save Element ride on Phase 2's bar (actions handled by the dispatcher).
        var sbar = host && host.root() && host.root().querySelector("#stLassoBar");
        if (sbar && !sbar.querySelector('[data-act="st-lasso-ai-explain"]')) {
          var chips = D.createElement("div");
          chips.className = "st-lasso-chips";
          chips.innerHTML = lassoChipsHtml();
          sbar.appendChild(chips);
          if (host.root() && host.root().classList) host.root().classList.add("st-lasso-on");
          if (G.STUDY_SELECT.positionLassoBar) {
            G.STUDY_SELECT.positionLassoBar(inkApi(V && V.cur ? V.cur : 1, null), sbar);
          }
        }
        return;
      } catch (e) {}
    }
    removeLassoBar();
    if (!V || !V.lasso || !V.lasso.ids.length) return;
    var div = D.createElement("div");
    div.id = "stLassoBar";
    div.className = "st-lasso-bar";
    div.innerHTML =
      '<div class="st-lasso-actions">' +
        '<button type="button" class="pn-btn sm st-sel-btn" data-act="st-lasso-cut">' + ICO.copy + ' <span class="st-sel-lbl">Cut</span></button>' +
        '<button type="button" class="pn-btn sm st-sel-btn" data-act="st-lasso-clipcopy">' + ICO.copy + ' <span class="st-sel-lbl">Copy</span></button>' +
        '<button type="button" class="pn-btn sm st-sel-btn bad" data-act="st-lasso-del">' + ICO.trash + ' <span class="st-sel-lbl">Delete</span></button>' +
        '<button type="button" class="pn-btn sm st-sel-btn" data-act="st-lasso-copy">' + ICO.copy + ' <span class="st-sel-lbl">Duplicate</span></button>' +
        '<button type="button" class="pn-btn sm st-sel-btn" data-act="st-lasso-color">' + ICO.palette + ' <span class="st-sel-lbl">Color</span></button>' +
      '</div>' +
      '<div class="st-lasso-chips">' + lassoChipsHtml() + '</div>';
    host.root().appendChild(div);
  }

  function toggleZoomWindow() {
    var root = host && host.root && host.root();
    if (!root) return;
    var zw = root.querySelector("#stP3ZoomWindow");
    if (zw) {
      zw.hidden = !zw.hidden;
      var btn = root.querySelector('#stTb [data-act="st-zoom-window"]');
      if (btn) btn.classList.toggle("on", !zw.hidden);
      if (!zw.hidden && G.STUDY_PAGES && G.STUDY_PAGES._renderZoom) {
        G.STUDY_PAGES._renderZoom();
      }
    }
  }

  function showPageSheet() {
    closePageSheet();
    closeMoreMenu();
    if (!V) return;
    var el = D.createElement("div");
    el.id = "stPageSheet";
    el.className = "st-sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    var isNb = !!V.nb;
    var cardsHtml = "";
    for (var i = 1; i <= V.n; i++) {
      var isCur = i === (V.cur || 1);
      cardsHtml += '<div class="st-pg-card' + (isCur ? " cur" : "") + '" data-act="st-jump-page" data-page="' + i + '">' +
        '<div class="st-pg-thumb" data-page="' + i + '">' +
          '<canvas class="st-pg-cv" width="90" height="' + Math.round(90 * (V.ratio || 1.414)) + '"></canvas>' +
          '<span class="st-pg-num">' + i + '</span>' +
        '</div>' +
        '<span class="st-pg-label">Page ' + i + '</span>' +
      '</div>';
    }
    el.innerHTML = '<div class="st-sh smd-books-keep smd-emo-keep">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<h2>Pages (' + (V.cur || 1) + ' of ' + V.n + ')</h2>' +
        '<button type="button" class="pn-btn sm" data-act="st-close-pagesheet">Done</button>' +
      '</div>' +
      '<div class="st-pg-jump-row">' +
        '<label class="st-pj">Go to page: <input id="stPage" type="number" min="1" max="' + V.n + '" value="' + (V.cur || 1) + '" aria-label="Page number"></label>' +
        '<button type="button" class="pn-btn sm" data-act="st-go">Go</button>' +
      '</div>' +
      (isNb ?
        '<div class="st-acts">' +
          '<button type="button" class="pn-btn sm" data-act="st-addpg">' + ICO.plus + ' Add page</button>' +
          '<button type="button" class="pn-btn sm" data-act="st-up">' + ICO.arrowUp + ' Move up</button>' +
          '<button type="button" class="pn-btn sm" data-act="st-dn">' + ICO.arrowDown + ' Move down</button>' +
          '<button type="button" class="pn-btn sm bad" data-act="st-delpg">' + ICO.trash + ' Delete page</button>' +
        '</div>' : "") +
      '<div class="st-pg-grid">' + cardsHtml + '</div>' +
    '</div>';
    el.addEventListener("click", function (e) { if (e.target === el) closePageSheet(); });
    host.root().appendChild(el);
    renderSheetThumbnails(el);
  }

  function renderSheetThumbnails(root) {
    if (!V) return;
    var cards = root.querySelectorAll(".st-pg-card");
    Array.prototype.forEach.call(cards, function (card) {
      var n = +card.getAttribute("data-page");
      var cv = card.querySelector("canvas.st-pg-cv"), num = card.querySelector(".st-pg-num");
      if (!cv) return;
      var ctx = cv.getContext("2d"), cw = cv.width, ch = cv.height;
      if (V.nb) {
        var _pid0 = V.nb.ord[n - 1];
        drawBg(ctx, tplForPid(_pid0), V.ratio, cw);
        var pageId = _pid0;
        V.strokes.forEach(function (s) {
          if (s.page === pageId && !s.gone) drawStroke(ctx, s, cw, ch, 1);
        });
        if (num) num.style.display = "none";
      } else if (V.pdf) {
        if (V.pg[n] && V.pg[n].cv) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(V.pg[n].cv, 0, 0, cw, ch);
          V.strokes.forEach(function (s) {
            if (s.page === n && !s.gone) drawStroke(ctx, s, cw, ch, 1);
          });
          if (num) num.style.display = "none";
        } else {
          V.pdf.getPage(n).then(function (page) {
            var v0 = page.getViewport({ scale: 1 }), sc = cw / v0.width, vp = page.getViewport({ scale: sc });
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, cw, ch);
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              page.cleanup();
              V.strokes.forEach(function (s) {
                if (s.page === n && !s.gone) drawStroke(ctx, s, cw, ch, 1);
              });
              if (num) num.style.display = "none";
            });
          }).catch(function () {});
        }
      }
    });
  }

  function showMoreMenu() {
    closeMoreMenu();
    var p3m = host && host.root() && host.root().querySelector("#stP3MoreSheet");
    if (p3m && p3m.parentNode) p3m.parentNode.removeChild(p3m);
    if (!V) return;
    var d = V.doc, isNb = !!V.nb;
    var el = D.createElement("div");
    el.id = "stMoreSheet";
    el.className = "st-sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = '<div class="st-sh st-more-sheet smd-books-keep smd-emo-keep">' +
      '<div class="st-more-head">' +
        '<h3>Options</h3>' +
        '<button type="button" class="pn-btn sm" data-act="st-close-more">Done</button>' +
      '</div>' +
      '<div class="st-more-sec">' +
        '<div class="st-more-sec-title">Study AI</div>' +
          '<button type="button" class="st-menu-item" data-act="st-ai-explain-page">' +
            '<div class="st-menu-ico">' + ICO.sparkle + '</div>' +
            '<div class="st-menu-txt"><strong>Explain this page</strong><small>Explain the current page</small></div>' +
          '</button>' +
          '<button type="button" class="st-menu-item" data-act="st-ai-summary">' +
            '<div class="st-menu-ico">' + ICO.sparkle + '</div>' +
            '<div class="st-menu-txt"><strong>Key summary</strong><small>Summarize page notes</small></div>' +
          '</button>' +
        (isNb ?
          '<button type="button" class="st-menu-item" data-act="st-ai-make">' +
            '<div class="st-menu-ico">' + ICO.book + '</div>' +
            '<div class="st-menu-txt"><strong>Make deck</strong><small>Flashcards and questions from this notebook</small></div>' +
          '</button>' :
          '<div class="st-more-field">' +
            '<label class="st-more-label">Pages range: <input id="stRange" class="st-range-input" type="text" placeholder="this page (e.g. 1-3)" aria-label="Pages to use"></label>' +
          '</div>' +
          '<button type="button" class="st-menu-item" data-act="st-make">' +
            '<div class="st-menu-ico">' + ICO.sparkle + '</div>' +
            '<div class="st-menu-txt"><strong>Make deck</strong><small>Generate cards and questions from selected pages</small></div>' +
          '</button>' +
          '<button type="button" class="st-menu-item" data-act="st-explain">' +
            '<div class="st-menu-ico">' + ICO.sparkle + '</div>' +
            '<div class="st-menu-txt"><strong>Explain</strong><small>AI explanation of selected text</small></div>' +
          '</button>') +
      '</div>' +
      '<div class="st-more-sec">' +
        '<div class="st-more-sec-title">Share and export</div>' +
        (isNb ? "" :
          '<button type="button" class="st-menu-item" data-act="st-orig">' +
            '<div class="st-menu-ico">' + ICO.pdf + '</div>' +
            '<div class="st-menu-txt"><strong>Share original</strong><small>Unannotated PDF</small></div>' +
          '</button>') +
        '<button type="button" class="st-menu-item" data-act="st-flat">' +
          '<div class="st-menu-ico">' + ICO.share + '</div>' +
          '<div class="st-menu-txt"><strong>' + (isNb ? "Notebook to PDF" : "Share flattened") + '</strong><small>' + (isNb ? "Export all notebook pages" : "Includes all handwriting and annotations") + '</small></div>' +
        '</button>' +
      '</div>' +
      '<div class="st-more-sec">' +
        '<div class="st-more-sec-title">View</div>' +
        '<div class="st-more-row">' +
          '<span>Zoom (<b id="stZoomLabel">' + Math.round((V.z || 1) * 100) + '%</b>)</span>' +
          '<div class="st-zoom-group">' +
            '<button type="button" class="pn-btn sm" data-act="st-zoom" data-v="-" aria-label="Zoom out">' + ICO.minus + ' Zoom out</button>' +
            '<button type="button" class="pn-btn sm" data-act="st-zoom" data-v="+" aria-label="Zoom in">' + ICO.plus + ' Zoom in</button>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="st-menu-item" data-act="st-page-sheet">' +
          '<div class="st-menu-ico">' + ICO.grid + '</div>' +
          '<div class="st-menu-txt"><strong>Page overview</strong><small>Thumbnails and page management</small></div>' +
        '</button>' +
      '</div>' +
      '<div class="st-more-sec">' +
        '<div class="st-more-sec-title">Settings</div>' +
        '<div class="st-more-row">' +
          '<div><strong>Scribble erase</strong><small style="display:block;color:var(--pn-mut)">Fast back-and-forth stroke erases ink</small></div>' +
          '<button type="button" class="pn-btn sm" data-act="st-toggle-scribble"><b id="stScribbleSt">' + (V.scribble === false ? "OFF" : "ON") + '</b></button>' +
        '</div>' +
      '</div>' +
    '</div>';
    el.addEventListener("click", function (e) { if (e.target === el) closeMoreMenu(); });
    host.root().appendChild(el);
  }

  function updateDocThumb() {
    if (!V || !V.doc) return;
    try {
      var w = 160, h = Math.round(160 * V.ratio), c = D.createElement("canvas");
      c.width = w; c.height = h;
      var ctx = c.getContext("2d");
      if (V.nb) {
        var p1 = V.nb.ord[0];
        drawBg(ctx, tplForPid(p1), V.ratio, w);
        V.strokes.forEach(function (s) { if (s.page === p1 && !s.gone) drawStroke(ctx, s, w, h, 1); });
        V.doc.thumb = c.toDataURL("image/jpeg", 0.7);
        put("docs", V.doc);
      } else if (V.pg[1] && V.pg[1].cv) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(V.pg[1].cv, 0, 0, w, h);
        V.strokes.forEach(function (s) { if (s.page === 1 && !s.gone) drawStroke(ctx, s, w, h, 1); });
        V.doc.thumb = c.toDataURL("image/jpeg", 0.7);
        put("docs", V.doc);
      }
    } catch (e) {}
  }

  function closeViewer() {
    if (!V) return;
    updateDocThumb();
    removeEraseToast();
    removeLassoBar();
    closePageSheet();
    closeMoreMenu();
    closeDocMenu();
    closeFolderSheet();
    try { V.io.disconnect(); } catch (e) {}
    if (V.onSel) D.removeEventListener("selectionchange", onSel);
    Object.keys(V.pg).forEach(function (n) { freePage(+n); });
    try { V.pdf.destroy(); } catch (e) {}
    V = null;
  }
  var carry = null;
  function renderViewer(id, goto) {
    var h = host;
    get("docs", id).then(function (d) {
      if (!d) return h.back();
      d.lastOpened = Date.now(); put("docs", d);
      h.paint('<div class="pn-body st-body">' +
          toolbarHtml(d) +
          '<div class="st-sc" id="stSc">' +
            '<div class="st-pages" id="stPages"></div>' +
          '</div>' +
        '</div>');
      return Promise.all([d.kind === "nb" ? null : loadOriginal(d).then(openPdf), strokesOf(id), get("undo", id), itemsOf(id)]).then(function (r) { startViewer(d, r[0], r[1], r[2], goto, r[3]); });
    }).catch(function () { h.toast("That PDF could not be opened."); });
  }

  function toolbarHtml(d) {
    var b = function (act, label, v, extra) { return '<button type="button" class="st-b" data-act="' + act + '"' + (v != null ? ' data-v="' + v + '"' : "") + (extra || "") + ">" + label + "</button>"; };
    var cp = V ? (V.cur || 1) : 1;
    // Phase 1 toolbar order: zoom window, pen, eraser, highlighter, shapes, lasso, elements, image, camera, text, typing, laser.
    // Phase 2 hook: the Shapes slot ships as a real tool; the other later-phase slots stay hidden.
    var inkIco = (G.STUDY_INK && G.STUDY_INK.ICONS) || {};
    var hiddenSlot = function (label, ico) { return '<button type="button" class="st-b st-slot-future" hidden title="' + label + '" aria-label="' + label + '">' + (ico || ICO.more) + "</button>"; };
    return '<div class="st-tb" id="stTb" role="toolbar" aria-label="Pen tools">' +
      '<div class="st-tb-group">' +
        '<div class="st-tb-tools">' +
          b("st-zoom-window", inkIco.zoom || ICO.grid, null, ' title="Zoom window" aria-label="Zoom window"') +
          b("st-page-sheet", ICO.grid, null, ' title="Pages overview" aria-label="Pages overview"') +
          b("st-tool", ICO.pen, "pen", ' title="Pen" aria-label="Pen"') +
          b("st-tool", ICO.er, "er", ' title="Eraser" aria-label="Eraser"') +
          b("st-tool", ICO.hl, "hl", ' title="Highlighter" aria-label="Highlighter"') +
          b("st-tool", inkIco.shapes || ICO.more, "shapes", ' title="Shapes" aria-label="Shapes"') +
          b("st-tool", ICO.lasso, "lasso", ' title="Lasso select" aria-label="Lasso select"') +
          b("st-tool", ICO.elements, "elements", ' title="Stickers and elements" aria-label="Stickers and elements"') +
          b("st-tool", ICO.image, "image", ' title="Insert image" aria-label="Insert image"') +
          hiddenSlot("Camera", inkIco.camera) +
          b("st-tool", ICO.text, "text", ' title="Text box tool" aria-label="Text box tool"') +
          hiddenSlot("Typing", inkIco.typing) +
          b("st-tool", ICO.laser, "laser", ' title="Laser pointer" aria-label="Laser pointer"') +
        '</div>' +
      '</div>' +
      '<input id="stTbPage" type="hidden" value="' + cp + '">' +
      colorStripHtml() +
      '<div id="stInsertOptions"></div>' +
    '</div>';
  }

  function colorStripHtml() {
    if (G.STUDY_INK) return '<div id="stInkCtx" class="st-ink-ctx"></div>';
    var isHl = V && V.tool === "hl", pal = isHl ? HCOLORS : COLORS;
    var cIdx = V ? V.ci : 0;
    var custCol = (V && V.customColor) ? V.customColor : (isHl ? "#ffe14d" : "#111111");
    return '<div class="st-opt-strip" id="stToolOptions" ' + (V && (V.tool === "pen" || V.tool === "hl") ? "" : 'hidden') + '>' +
      '<div class="st-widths-row">' +
        [0, 1, 2].map(function (i) {
          return '<button type="button" class="st-b st-w' + (V && V.wi === i ? ' on' : '') + '" data-act="st-width" data-v="' + i + '" aria-label="Width ' + (i + 1) + '"><i style="height:' + ((i + 1) * 2 + 1) + 'px"></i></button>';
        }).join("") +
      '</div>' +
      '<span class="st-sep"></span>' +
      '<div class="st-colors-row">' +
        pal.map(function (c, i) {
          return '<button type="button" class="st-b st-c' + (cIdx === i ? ' on' : '') + '" data-act="st-color" data-v="' + i + '" aria-label="Colour ' + (i + 1) + '" style="--c:' + c + '"></button>';
        }).join("") +
        '<label class="st-c st-c-custom' + (cIdx === -1 ? ' on' : '') + '" title="Custom colour" aria-label="Custom colour" style="--c:' + custCol + '">' +
          '<input type="color" id="stColorPicker" value="' + custCol + '" aria-label="Choose colour">' +
        '</label>' +
      '</div>' +
    '</div>';
  }

  function startViewer(d, pdf, strokes, undoRec, goto, items) {
    var root = host.root(), sc = root && root.querySelector("#stSc"), box = root && root.querySelector("#stPages");
    if (!sc) { try { pdf.destroy(); } catch (e) {} return; }
    closeViewer();
    // Phase P0 (ink-loss fix): scribble erase defaults to OFF for everyone. The pre-P0 key
    // smd_study_scribble is ignored so old ONs are reset; only smd_study_scribble2 === "1" turns it on.
    var scrPref = false;
    try { scrPref = G.localStorage.getItem("smd_study_scribble2") === "1"; } catch (e) {}
    V = { id: d.id, doc: d, title: d.title, sel: null, n: pdf ? pdf.numPages : d.ord.length, pdf: pdf, nb: d.kind === "nb" ? d : null, sc: sc, box: box, z: 1, pg: {}, strokes: strokes, items: items || [], stack: newStack(undoRec), tool: null, ci: 0, wi: 1, ratio: d.ratio || 1.414, baseW: Math.max(200, (sc.clientWidth || 360) - 16), goto: goto, scribble: scrPref, lasso: null, prevTool: null, ink: null };
    V.onSel = onSel; D.addEventListener("selectionchange", onSel);
    if (carry) { V.tool = carry.tool; V.ci = carry.ci; V.wi = carry.wi; carry = null; }
    bindPencil();
    if (pdf) pdf.getPage(1).then(function (p) { var v = p.getViewport({ scale: 1 }); V.ratio = v.height / v.width; build(); }); else build();
    syncTb();
  }

  function build() {
    var i, f = D.createDocumentFragment(), cw = V.baseW * V.z;
    for (i = 1; i <= V.n; i++) {
      var el = D.createElement("div"); el.className = "st-pg"; el.setAttribute("data-n", i);
      el.style.width = cw + "px"; el.style.height = cw * V.ratio + "px";
      V.pg[i] = { el: el, ratio: V.ratio, on: false, gen: 0 };
      f.appendChild(el);
    }
    V.box.appendChild(f);

    // Study Assistant lives in the More menu (st-more / top-bar More), not over the page.
    V.io = new G.IntersectionObserver(function (es) {
      es.forEach(function (e) { var n = +e.target.getAttribute("data-n"); if (e.isIntersecting) renderPage(n); else freePage(n); });
    }, { root: V.sc, rootMargin: "150% 0px 150% 0px" });
    for (i = 1; i <= V.n; i++) V.io.observe(V.pg[i].el);
    V.sc.addEventListener("scroll", function () { if (V.raf) return; V.raf = G.requestAnimationFrame(function () { V.raf = 0; curPage(); }); });
    bindPinch();
    if (V.goto > 1 && V.pg[V.goto]) { V.sc.scrollTop = V.pg[V.goto].el.offsetTop; curPage(); }
    V.sc.addEventListener("pointermove", function (e) { if (e.pointerType === "pen") penSeen = true; }, true);
    V.sc.addEventListener("pointerdown", function (e) { if (e.pointerType === "pen") penSeen = true; }, true);
    V.sc.addEventListener("pointerup", function (e) { if (e.pointerType === "pen" && V) V._isPenDown = false; }, true);
    V.sc.addEventListener("pointercancel", function (e) { if (e.pointerType === "pen" && V) V._isPenDown = false; }, true);
  }

  function curPage() {
    if (!V) return;
    var y = V.sc.scrollTop + V.sc.clientHeight / 3, n = 1, i;
    for (i = 1; i <= V.n; i++) { if (V.pg[i] && V.pg[i].el.offsetTop > y) break; n = i; }
    V.cur = n;
    var inp = host.root() && host.root().querySelector("#stPage"); if (inp && D.activeElement !== inp) inp.value = n;
    var tbP = host.root() && host.root().querySelector("#stTbPage"); if (tbP) tbP.value = n;
    var curP = host.root() && host.root().querySelector("#stCurP"); if (curP) curP.textContent = n;
  }

  var CANVAS_MAX_PX = 8e6;
  function canvasScale(cw, ch, dpr) { return Math.max(0.25, Math.min(dpr, 4096 / cw, Math.sqrt(CANVAS_MAX_PX / Math.max(1, cw * ch)))); }
  function renderPage(n) {
    var p = V && V.pg[n]; if (!p || p.on) return;
    p.on = true; var gen = ++p.gen, pdf = V.pdf;
    (pdf ? pdf.getPage(n) : Promise.resolve(null)).then(function (page) {
      if (!V || V.pdf !== pdf || V.pg[n] !== p || p.gen !== gen) return;
      var v1 = page ? page.getViewport({ scale: 1 }) : { width: 1, height: V.ratio }, cw = V.baseW * V.z, ch = cw * v1.height / v1.width, dpr = Math.min(G.devicePixelRatio || 1, 2);
      /* iPad Safari blanks any canvas over ~16.7 M pixels (and total canvas memory is limited): when zoomed,
         a full-dpr page overlay was 30 M+ px, so ink vanished and the pen stopped drawing. Cap every page canvas
         at ~8 M px; at fit width this is still full retina. */
      var qf = canvasScale(cw, ch, dpr);
      p.ratio = v1.height / v1.width; p.el.style.height = ch + "px";
      var cv = D.createElement("canvas"), ov = D.createElement("canvas"), vp = page ? page.getViewport({ scale: (cw / v1.width) * qf }) : { width: cw * qf, height: ch * qf };
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height); cv.className = "st-cv";
      cv.style.zIndex = "1"; cv.style.pointerEvents = "none";
      ov.width = Math.floor(cw * qf); ov.height = Math.floor(ch * qf); ov.className = "st-ov"; ov.setAttribute("data-n", n);
      ov.style.touchAction = "none";
      ov.style.zIndex = "10";
      var itemLayer = D.createElement("div"); itemLayer.className = "st-items-layer"; itemLayer.setAttribute("data-n", n);
      p.cv = cv; p.ov = ov; p.itemLayer = itemLayer;
      p.el.appendChild(cv); p.el.appendChild(itemLayer); p.el.appendChild(ov);
      // Phase 1 live layer: predicted points + eraser cursor only; committed ink stays on ov.
      if (G.STUDY_INK) { var lv = D.createElement("canvas"); lv.width = ov.width; lv.height = ov.height; lv.className = "st-live"; lv.style.zIndex = "11"; lv.style.pointerEvents = "none"; p.live = lv; p.el.appendChild(lv); }
      bindInk(ov, n); redraw(n);
      if (G.STUDY_INSERT && G.STUDY_INSERT.renderPageItems) G.STUDY_INSERT.renderPageItems(n, p);
      if (!page) { var _pid = V.nb ? V.nb.ord[n - 1] : null; return drawBg(cv.getContext("2d"), _pid != null ? tplForPid(_pid) : V.nb.style, V.ratio, cv.width); }
      p.task = page.render({ canvasContext: cv.getContext("2d"), viewport: vp });
      p.task.promise.then(function () {
        return !V || V.pg[n] !== p || p.gen !== gen ? null : textLayer(page, p, cw / v1.width);
      }).then(function () { page.cleanup(); }, function () {});
    });
  }

  function freePage(n) {
    var p = V && V.pg[n]; if (!p || !p.on) return;
    p.on = false; p.gen++;
    try { if (p.task) p.task.cancel(); } catch (e) {}
    p.task = null;
    [p.cv, p.tl, p.ov, p.itemLayer, p.live].forEach(function (c) { if (c) { if (c.width !== undefined) c.width = 0; if (c.height !== undefined) c.height = 0; if (c.parentNode) c.parentNode.removeChild(c); } });
    p.cv = p.tl = p.ov = p.itemLayer = p.live = null;
    if (G.STUDY_INSERT && G.STUDY_INSERT.onPageFree) G.STUDY_INSERT.onPageFree(n);
  }

  function textLayer(page, p, k) {
    var L = G.pdfjsLib;
    if (!L || !L.renderTextLayer || !p.cv) return Promise.resolve();
    return page.getTextContent().then(function (tc) {
      if (!p.cv || !p.ov) return;
      var tl = D.createElement("div");
      tl.className = "st-tl smd-books-keep smd-emo-keep"; tl.style.setProperty("--scale-factor", String(k));
      tl.style.zIndex = "2";
      if (V && (V.tool === "pen" || V.tool === "hl" || V.tool === "er" || V.tool === "lasso" || V.tool === "shapes" || V.tool === "laser")) {
        tl.style.pointerEvents = "none";
      }
      p.el.insertBefore(tl, p.ov); p.tl = tl;
      return L.renderTextLayer({ textContentSource: tc, container: tl, viewport: page.getViewport({ scale: k }), textDivs: [] }).promise;
    }).then(null, function () {});
  }

  function onSel() {
    if (!V) return;
    var s = G.getSelection && G.getSelection(), t = s ? String(s).replace(/\s+/g, " ").trim() : "", el = s && s.anchorNode, pg;
    el = el && (el.nodeType === 1 ? el : el.parentNode);
    pg = t && el && el.closest && el.closest(".st-tl") && el.closest(".st-pg");
    if (pg) V.sel = { page: +pg.getAttribute("data-n"), text: t };
  }

  // Re-render a page at the new zoom WITHOUT a blank flash: the old (CSS-stretched) canvases stay until the new render lands.
  function rerenderPage(n) {
    var p = V && V.pg[n]; if (!p || !p.on) return;
    var old = [p.cv, p.tl, p.ov, p.itemLayer, p.live].filter(Boolean);
    old.forEach(function (c) { c.style.pointerEvents = "none"; });
    try { if (p.task) p.task.cancel(); } catch (e) {}
    p.on = false; p.gen++; p.task = null; p.cv = p.tl = p.ov = p.itemLayer = p.live = null;
    if (G.STUDY_INSERT && G.STUDY_INSERT.onPageFree) G.STUDY_INSERT.onPageFree(n);
    renderPage(n);
    var done = function () { old.forEach(function (c) { if (c.width !== undefined) { c.width = 0; c.height = 0; } if (c.parentNode) c.parentNode.removeChild(c); }); };
    var tries = 0, wait = function () { if (p.task && p.task.promise) { p.task.promise.then(done, done); return; } if (p.cv || ++tries > 40) { G.setTimeout(done, 30); return; } G.setTimeout(wait, 25); };
    G.setTimeout(wait, 0);
  }
  function layoutZoom(z) {
    var i, cw = V.baseW * z; V.z = z;
    for (i = 1; i <= V.n; i++) { var p = V.pg[i]; p.el.style.width = cw + "px"; p.el.style.height = cw * p.ratio + "px"; }
    G.clearTimeout(V.zt);
    V.zt = G.setTimeout(function () { if (!V) return; Object.keys(V.pg).forEach(function (n) { if (V.pg[n].on) rerenderPage(+n); }); }, 120);
    var zl = host.root() && host.root().querySelector("#stZoomLabel"); if (zl) zl.textContent = Math.round(z * 100) + "%";
  }
  function setZoom(z) {
    z = Math.max(1, Math.min(4, z)); if (!V || z === V.z) return;
    var k = z / V.z, cx = V.sc.scrollLeft + V.sc.clientWidth / 2, cy = V.sc.scrollTop + V.sc.clientHeight / 2;
    layoutZoom(z);
    V.sc.scrollLeft = cx * k - V.sc.clientWidth / 2; V.sc.scrollTop = cy * k - V.sc.clientHeight / 2;
  }

  /* Native-feeling pinch: while fingers move only a GPU transform (scale around the pinch point + pan) is applied;
     on release the pages are laid out once at the new zoom and the point under the fingers stays put.
     Zoom range: fit width (1) to 400%; pinching below fit springs back to fit, like GoodNotes. */
  function bindPinch() {
    var g = null;
    var span = function (t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); };
    var mid = function (t) { return [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2]; };
    var box = V.box;
    function commit() {
      if (!g) return;
      var gg = g; g = null; V._pinching = false;
      var z = Math.max(1, Math.min(4, gg.z0 * gg.s)), k = z / gg.z0;
      box.style.transition = ""; box.style.transform = ""; box.style.willChange = "";
      layoutZoom(z);
      // the spot on the page that was under the fingers at the start lands under the fingers' final midpoint
      // two passes: the second absorbs any layout offset that moves with the scroll position
      for (var pass = 0; gg.pe && pass < 2; pass++) {
        var r = gg.pe.getBoundingClientRect();
        V.sc.scrollLeft += r.left + gg.fx * r.width - gg.m[0];
        V.sc.scrollTop += r.top + gg.fy * r.height - gg.m[1];
      }
    }
    V.sc.addEventListener("touchstart", function (e) {
      if (V && V._isPenDown) return;
      if (e.touches.length === 2) {
        var m = mid(e.touches), br = box.getBoundingClientRect(), hit = D.elementFromPoint(m[0], m[1]), pe = hit && hit.closest ? hit.closest(".st-pg") : null;
        if (!pe && V.pg[V.cur || 1]) pe = V.pg[V.cur || 1].el;
        var pr = pe ? pe.getBoundingClientRect() : null;
        V._pinching = true;
        g = { d0: span(e.touches) || 1, z0: V.z, m0: m, m: m, ox: m[0] - br.left, oy: m[1] - br.top, s: 1, pe: pe, fx: pr ? (m[0] - pr.left) / (pr.width || 1) : 0, fy: pr ? (m[1] - pr.top) / (pr.height || 1) : 0 };
        box.style.transformOrigin = g.ox + "px " + g.oy + "px"; box.style.willChange = "transform";
      }
    }, { passive: true });
    V.sc.addEventListener("touchmove", function (e) {
      if (!g || (V && V._isPenDown)) return;
      if (e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      var m = mid(e.touches), z = g.z0 * span(e.touches) / g.d0;
      z = z < 1 ? 1 - (1 - z) * 0.35 : z > 4 ? 4 + (z - 4) * 0.2 : z; // rubber-band past the limits
      g.s = z / g.z0; g.m = m;
      box.style.transform = "translate(" + (m[0] - g.m0[0]) + "px," + (m[1] - g.m0[1]) + "px) scale(" + g.s + ")";
    }, { passive: false });
    var end = function (e) { if (g && (!e.touches || e.touches.length < 2)) commit(); };
    V.sc.addEventListener("touchend", end, { passive: true });
    V.sc.addEventListener("touchcancel", end, { passive: true });
  }

  /* ---- ink ---- */
  function penW(s, W, p) { return s.tool === "hl" ? s.w * W * HMUL : s.w * W * (0.5 + p); }
  function drawStroke(ctx, s, W, H, dpr, isSel) {
    // Phase 2 hooks: vector shapes and text boxes render via study-select.js (outline pts stay the fallback).
    if (G.STUDY_SELECT && s.shape && G.STUDY_SELECT.drawShape(ctx, s, W, H, dpr, isSel)) return;
    if (G.STUDY_SELECT && s.tool === "text" && G.STUDY_SELECT.drawText(ctx, s, W, H, dpr, isSel)) return;
    // Phase 1 hook: styled strokes render via study-ink.js; old strokes keep the legacy renderer below.
    if (G.STUDY_INK && G.STUDY_INK.drawStroke(ctx, s, W, H, dpr, isSel)) return;
    var p = s.pts, i;
    ctx.save(); ctx.scale(dpr, dpr); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = isSel ? "#c9a227" : s.color;
    if (isSel) { ctx.shadowColor = "#c9a227"; ctx.shadowBlur = 4; }
    if (s.tool === "hl") {
      ctx.globalAlpha = 0.35; ctx.lineWidth = penW(s, W, 0.5); ctx.beginPath();
      for (i = 0; i < p.length; i++) { if (i) ctx.lineTo(p[i][0] * W, p[i][1] * H); else ctx.moveTo(p[i][0] * W, p[i][1] * H); }
      if (p.length === 1) ctx.lineTo(p[0][0] * W + 0.01, p[0][1] * H);
      ctx.stroke();
    } else {
      for (i = p.length > 1 ? 1 : 0; i < p.length; i++) {
        var a = p[i ? i - 1 : 0];
        ctx.lineWidth = penW(s, W, p[i][2]); ctx.beginPath(); ctx.moveTo(a[0] * W, a[1] * H); ctx.lineTo(p[i][0] * W + (p.length === 1 ? 0.01 : 0), p[i][1] * H); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function redraw(n, live, lassoLoop) {
    var p = V && V.pg[n]; if (!p || !p.ov) return;
    var ctx = p.ov.getContext("2d"), dpr = p.ov.width / (p.el.clientWidth || 1), W = p.el.clientWidth, H = p.el.clientHeight;
    ctx.clearRect(0, 0, p.ov.width, p.ov.height);
    // Highlighter renders under pen ink and text-layer content visually (multiply on the overlay).
    var ordered = V.strokes.filter(function (s) { return s.page === pid(n) && !s.gone; });
    ordered.sort(function (a, b) { return (a.tool === "hl" ? 0 : 1) - (b.tool === "hl" ? 0 : 1); });
    var isSelS = function (s) { return V.lasso && V.lasso.page === pid(n) && V.lasso.ids.indexOf(s.id) !== -1; };
    // All styled highlighter strokes go down as ONE even layer (no darkened overlaps); everything else as before.
    var hlLayer = G.STUDY_INK && G.STUDY_INK.drawHlLayer ? ordered.filter(function (s) { return s.tool === "hl" && s.style && !s.shape && !isSelS(s); }) : [];
    if (hlLayer.length) G.STUDY_INK.drawHlLayer(ctx, hlLayer, W, H, dpr);
    ordered.forEach(function (s) {
      if (hlLayer.indexOf(s) !== -1) return;
      drawStroke(ctx, s, W, H, dpr, isSelS(s));
    });
    if (live) drawStroke(ctx, live, W, H, dpr);
    // Phase 2 hook: dashed selection box with resize handles.
    if (G.STUDY_SELECT && G.STUDY_SELECT.drawSel) { try { G.STUDY_SELECT.drawSel(ctx, V, W, H, dpr, n); } catch (e) {} }
    if (lassoLoop && lassoLoop.length > 1) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = "#c9a227";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      for (var k = 0; k < lassoLoop.length; k++) {
        var lx = lassoLoop[k][0] * W, ly = lassoLoop[k][1] * H;
        if (k === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function activeColor() {
    if (!V) return COLORS[0];
    if (V.ci === -1 && V.customColor) return V.customColor;
    var pal = V.tool === "hl" ? HCOLORS : COLORS;
    return pal[V.ci] || pal[0];
  }

  function syncTb() {
    var root = host && host.root(); if (!root || !V) return;
    var tbEl = root.querySelector("#stTb"); if (tbEl) tbEl.style.setProperty("--st-pen", activeColor());
    Array.prototype.forEach.call(root.querySelectorAll("#stTb [data-act], #stMoreSheet [data-act], #stToolOptions [data-act]"), function (b) {
      var a = b.getAttribute("data-act"), v = b.getAttribute("data-v");
      var onb = (a === "st-tool" && v === V.tool) || (a === "st-color" && +v === V.ci) || (a === "st-width" && +v === V.wi);
      b.classList.toggle("on", onb);
      if (a === "st-tool" || a === "st-color" || a === "st-width") b.setAttribute("aria-pressed", onb ? "true" : "false");
      if (a === "st-undo") b.disabled = !V.stack.u.length;
      if (a === "st-redo") b.disabled = !V.stack.r.length;
    });
    var optStrip = root.querySelector("#stToolOptions");
    if (optStrip) {
      optStrip.hidden = !(V.tool === "pen" || V.tool === "hl");
      var pal = V.tool === "hl" ? HCOLORS : COLORS;
      Array.prototype.forEach.call(optStrip.querySelectorAll(".st-c[data-act='st-color']"), function (cBtn) {
        var idx = +cBtn.getAttribute("data-v");
        if (pal[idx]) cBtn.style.setProperty("--c", pal[idx]);
      });
      var custLbl = optStrip.querySelector(".st-c-custom");
      if (custLbl) {
        custLbl.classList.toggle("on", V.ci === -1);
        if (V.customColor) custLbl.style.setProperty("--c", V.customColor);
      }
      var cp = optStrip.querySelector("#stColorPicker");
      if (cp && !cp._bound) {
        cp._bound = true;
        var onCol = function (e) {
          V.customColor = e.target.value;
          V.ci = -1;
          if (!V.tool) V.tool = "pen";
          syncTb();
        };
        cp.addEventListener("input", onCol);
        cp.addEventListener("change", onCol);
      }
    }
    var scSt = root.querySelector("#stScribbleSt");
    if (scSt) scSt.textContent = V.scribble === false ? "OFF" : "ON";
    var curP = root.querySelector("#stCurP");
    if (curP) curP.textContent = V.cur || 1;
    var tbP = root.querySelector("#stTbPage");
    if (tbP) tbP.value = V.cur || 1;
    var inp = root.querySelector("#stPage");
    if (inp && D.activeElement !== inp) inp.value = V.cur || 1;
    var zm = root.querySelector("#stZoomLabel");
    if (zm) zm.textContent = Math.round((V.z || 1) * 100) + "%";
    var isInk = V.tool === "pen" || V.tool === "hl" || V.tool === "shapes";
    var isLaser = V.tool === "laser";
    var hasInkTool = isInk || V.tool === "er" || V.tool === "lasso" || isLaser;
    V.box.classList.toggle("st-ink", hasInkTool);
    for (var pgi in V.pg) {
      if (V.pg[pgi] && V.pg[pgi].tl) {
        V.pg[pgi].tl.style.pointerEvents = hasInkTool ? "none" : "auto";
      }
    }
    if (G.STUDY_INSERT && G.STUDY_INSERT.syncTb) G.STUDY_INSERT.syncTb(V, root);
    // Phase 1 hook: refresh the ink context strip for the active tool.
    if (G.STUDY_INK) { try { G.STUDY_INK.syncStrip(inkApi(V.cur || 1, null)); } catch (e) {} }
    // Phase 2 hook: lasso settings and shapes strips share the same context host.
    if (G.STUDY_SELECT) { try { G.STUDY_SELECT.syncStrip(inkApi(V.cur || 1, null)); } catch (e) {} }
  }

  function saveStack() { return put("undo", { doc: V.id, u: V.stack.u, r: V.stack.r }); }

  /* ---- Phase 1 ink hooks (study-ink.js) ---- */
  function clearPageInk() {
    if (!V) return;
    var pageId = pid(V.cur || 1), ids = [];
    V.strokes.forEach(function (s) { if (s.page === pageId && !s.gone) { s.gone = true; ids.push(s.id); put("strokes", s); } });
    if (!ids.length) { if (host) host.toast("This page is already clear."); return; }
    push(V.stack, { t: "del", ids: ids }); syncTb(); saveStack(); redraw(V.cur || 1);
    if (host) host.toast("Page cleared. Undo brings it back.");
  }
  function inkApi(n, ov) {
    return {
      getV: function () { return V; }, root: function () { return host && host.root(); }, n: n, ov: ov,
      pid: pid, uid: uid, toRel: toRel, pressureOf: pressure,
      // Phase 2 hook: toast for study-select.js ops.
      toast: function (m) { try { if (host) host.toast(m); } catch (e) {} },
      putStroke: function (s) { return put("strokes", s); },
      pushOp: function (op) { push(V.stack, op); }, saveStack: saveStack, syncTb: syncTb,
      redraw: function (nn, live, loop) { redraw(nn == null ? n : nn, live, loop); },
      lassoHit: lassoHit, isScribble: isScribble, coveredBy: coveredBy,
      removeLassoBar: removeLassoBar, showLassoBar: showLassoBar, showEraseToast: showEraseToast,
      isPenSeen: function () { return penSeen; }, setPenSeen: function () { penSeen = true; },
      clearPage: clearPageInk
    };
  }
  // Apple Pencil hardware (study-pencil): no web hook exists for Apple Pencil double-tap; the native
  // UIPencilInteraction bridge (ios/App/App/PencilPlugin.swift) forwards hardware gestures as
  // "pencilTap" { action }. iPad-only: this stays a no-op on web and Android.
  function pencilSwitchPrevious() { if (!V) return; var cur = V.tool, prev = V.prevTool || "pen"; V.tool = prev; if (cur && cur !== prev) V.prevTool = cur; syncTb(); }
  function openPenSettings() { if (!V || !G.STUDY_INK || typeof G.STUDY_INK.popover !== "function") return; var t = (V.tool === "pen" || V.tool === "hl" || V.tool === "er") ? V.tool : "pen"; try { G.STUDY_INK.popover(inkApi(V.cur || 1, null), t); } catch (e) {} }
  var pencilBound = false;
  function handlePencilTap(d) {
    var m = pencilActionFor(d && d.action);
    if (!m) return;
    if (m === "pencilDoubleTap") { if (G.STUDY && typeof G.STUDY.pencilDoubleTap === "function") G.STUDY.pencilDoubleTap(); return; }
    if (m === "pencilSwitchPrevious") { if (G.STUDY && typeof G.STUDY.pencilSwitchPrevious === "function") G.STUDY.pencilSwitchPrevious(); else if (G.STUDY && typeof G.STUDY.pencilDoubleTap === "function") G.STUDY.pencilDoubleTap(); return; }
    if (m === "openPenSettings") { if (G.STUDY && typeof G.STUDY.openPenSettings === "function") G.STUDY.openPenSettings(); else openPenSettings(); }
  }
  function bindPencil() {
    if (pencilBound) return;
    try {
      var P = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Pencil;
      if (!P || typeof P.addListener !== "function") return;
      P.addListener("pencilTap", function (d) { handlePencilTap(d); });
      pencilBound = true;
    } catch (e) {}
  }
  function bindInk(ov, n) {
    // Phase 2 hook: selection and shape gestures bind first (capture); ink binds after.
    if (G.STUDY_SELECT && G.STUDY_SELECT.bindSel) { try { G.STUDY_SELECT.bindSel(inkApi(n, ov), ov, n); } catch (e) {} }
    // Laser (Phase 4) capture listeners run before the Phase 1 ink engine, so a laser
    // trail is never saved as a stroke or pushed to undo.
    bindLaser(ov, n);
    if (G.STUDY_INK && G.STUDY_INK.bindInk) { G.STUDY_INK.bindInk(inkApi(n, ov), ov, n); return; }
    bindInkLegacy(ov, n);
  }
  // Laser (Phase 4) must never reach the Phase 1 ink engine: capture listeners on the overlay run first and stop
  // the event, so a laser trail is never saved as a stroke or pushed to undo.
  function bindLaser(ov, n) {
    var on = false, pos = function (e) { var r = ov.getBoundingClientRect(); return toRel(e.clientX, e.clientY, r); };
    ov.addEventListener("pointerdown", function (e) {
      if (!V || V.tool !== "laser") return;
      on = true;
      try { ov.setPointerCapture(e.pointerId); } catch (x) {}
      if (G.STUDY_INSERT && G.STUDY_INSERT.laserDown) G.STUDY_INSERT.laserDown(e, n, ov, pos(e));
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    ov.addEventListener("pointermove", function (e) {
      if (!on || !V || V.tool !== "laser") return;
      if (G.STUDY_INSERT && G.STUDY_INSERT.laserMove) G.STUDY_INSERT.laserMove(e, n, ov, pos(e));
      e.stopImmediatePropagation();
    }, true);
    var end = function (e) {
      if (!on) return;
      on = false;
      if (G.STUDY_INSERT && G.STUDY_INSERT.laserUp) G.STUDY_INSERT.laserUp(e, n, ov);
      e.stopImmediatePropagation();
    };
    ov.addEventListener("pointerup", end, true); ov.addEventListener("pointercancel", end, true);
  }
  function bindInkLegacy(ov, n) {
    var cur = null, pan = null, erased = null, lassoPts = null;
    var pos = function (e) { var r = ov.getBoundingClientRect(); return toRel(e.clientX, e.clientY, r); };
    var sample = function (e) { var a = pos(e); return [r4(a[0]), r4(a[1]), r4(pressure(e))]; };
    ov.addEventListener("pointerdown", function (e) {
      if (!V || !V.tool) return;
      if (e.pointerType === "pen") penSeen = true;
      if (e.pointerType === "touch" && penSeen) { pan = { y: e.clientY, x: e.clientX }; return; }
      if (e.pointerType === "mouse" && e.button) return;
      if (V.tool === "laser") {
        try { ov.setPointerCapture(e.pointerId); } catch (x) {}
        if (G.STUDY_INSERT && G.STUDY_INSERT.laserDown) G.STUDY_INSERT.laserDown(e, n, ov, pos(e));
        e.preventDefault();
        return;
      }
      if (V.tool !== "pen" && V.tool !== "hl" && V.tool !== "er" && V.tool !== "lasso") return;
      try { ov.setPointerCapture(e.pointerId); } catch (x) {}
      if (V.tool === "er") { erased = []; eraseAt(e); return; }
      if (V.tool === "lasso") {
        lassoPts = [pos(e)];
        removeLassoBar();
        redraw(n, null, lassoPts);
        e.preventDefault();
        return;
      }
      var pt = sample(e);
      cur = { id: uid(), doc: V.id, page: pid(n), tool: V.tool, color: activeColor(), w: WIDTHS[V.wi], pts: [pt], gone: false, t: Date.now(), t0: Date.now(), t1: Date.now() };
      try { if (G.STUDY_MEDIA && G.STUDY_MEDIA.stampStroke) { var __a = G.STUDY_MEDIA.stampStroke(); if (__a != null) cur.a = __a; } } catch (x) {} /* Phase 5b: audio offset */
      redraw(n, cur);
      e.preventDefault();
    });
    ov.addEventListener("pointermove", function (e) {
      if (pan) { V.sc.scrollTop -= e.clientY - pan.y; V.sc.scrollLeft -= e.clientX - pan.x; pan.y = e.clientY; pan.x = e.clientX; return; }
      if (V.tool === "laser") {
        if (G.STUDY_INSERT && G.STUDY_INSERT.laserMove) G.STUDY_INSERT.laserMove(e, n, ov, pos(e));
        return;
      }
      if (erased) return eraseAt(e);
      if (lassoPts) {
        lassoPts.push(pos(e));
        redraw(n, null, lassoPts);
        return;
      }
      if (!cur) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      evs.forEach(function (c) { cur.pts.push(sample(c)); });
      redraw(n, cur);
    });
    var end = function (e) {
      if (pan) { pan = null; return; }
      if (V.tool === "laser") {
        if (G.STUDY_INSERT && G.STUDY_INSERT.laserUp) G.STUDY_INSERT.laserUp(e, n, ov);
        return;
      }
      if (erased) { var ids = erased; erased = null; if (ids.length) { push(V.stack, { t: "del", ids: ids }); syncTb(); saveStack(); } return; }
      if (lassoPts) {
        var loop = lassoPts; lassoPts = null;
        if (loop.length >= 3) {
          var sel = [];
          V.strokes.forEach(function (s) {
            if (s.page === pid(n) && !s.gone && lassoHit(s, loop)) sel.push(s.id);
          });
          if (sel.length) {
            V.lasso = { page: pid(n), ids: sel, n: n };
            showLassoBar();
          } else {
            V.lasso = null;
            removeLassoBar();
          }
        }
        redraw(n);
        return;
      }
      if (!cur) return;
      cur.t1 = Date.now();

      // Scribble-to-erase check (phase P0): only when scribble is ON (default OFF), the strict detector
      // fires, and the erase covers only strokes it actually crosses (6 px, not an 18 px neighbourhood).
      // Anything else saves the stroke like any other stroke (never lose ink).
      if (V.tool === "pen" && V.scribble !== false) {
        var scW = ov.clientWidth, scH = ov.clientHeight, scInk = [];
        V.strokes.forEach(function (s) { if (s.page === pid(n) && !s.gone) scInk.push(s); });
        if (isScribble(cur.pts, { durationMs: cur.t1 - cur.t0, pageW: scW, pageH: scH, ink: scInk })) {
          var scPts = cur.pts, scIds = [];
          V.strokes.forEach(function (s) {
            if (s.page === pid(n) && !s.gone && coveredBy(scPts, s, scW, scH)) {
              s.gone = true;
              scIds.push(s.id);
              put("strokes", s);
            }
          });
          if (scIds.length) {
            cur = null;
            var scOp = { t: "del", ids: scIds };
            push(V.stack, scOp);
            syncTb();
            saveStack();
            redraw(n);
            showEraseToast(scIds.length, scIds, n);
            return;
          }
        }
      }

      var s = cur; cur = null;
      V.strokes.push(s); push(V.stack, { t: "add", id: s.id }); syncTb();
      redraw(n);
      put("strokes", s).then(saveStack);
    };
    ov.addEventListener("pointerup", end); ov.addEventListener("pointercancel", end);
    function eraseAt(e) {
      var a = pos(e), W = ov.clientWidth, H = ov.clientHeight, hitAny = false;
      V.strokes.forEach(function (s) {
        if (s.page === pid(n) && !s.gone && hit(s, a[0], a[1], 12, W, H)) { s.gone = true; erased.push(s.id); hitAny = true; put("strokes", s); }
      });
      if (hitAny) redraw(n);
    }
  }

  // Phase 2 (study-select.js): move, resize, recolour, rotate restore snapshots; addmulti toggles every id at once.
  function applyXformSnap(strokes, snap) {
    (snap || []).forEach(function (t) {
      for (var i = 0; i < strokes.length; i++) {
        if (strokes[i].id === t.id) {
          strokes[i].pts = t.pts.map(function (p) { return [p[0], p[1], p[2]]; });
          strokes[i].w = t.w; strokes[i].color = t.color;
          strokes[i].shape = t.shape ? JSON.parse(JSON.stringify(t.shape)) : strokes[i].shape;
          if (t.fill != null) strokes[i].fill = t.fill;
          if (t.page != null) strokes[i].page = t.page;
          break;
        }
      }
    });
  }
  function flipOp(r) {
    var pages = {};
    // Phase 4: item move/resize/format ops flip the item snapshot via study-insert.js.
    if (r.op && r.op.t === "item_mod") {
      if (G.STUDY_INSERT && G.STUDY_INSERT.flipItemMod) {
        G.STUDY_INSERT.flipItemMod(r.op, flipOp._undoing === true || !!r.undoing);
      }
      syncTb(); saveStack();
      return;
    }
    if (r.op.t === "xform") {
      // Undo restores the before snapshot; redo reapplies the after snapshot. No gone flip.
      var isUndo2 = flipOp._undoing === true;
      var snap = isUndo2 ? r.op.before : r.op.after;
      applyXformSnap(V.strokes, snap);
      (snap || []).forEach(function (t) {
        V.strokes.forEach(function (s) { if (s.id === t.id) { pages[s.page || 1] = 1; put("strokes", s); } });
      });
      Object.keys(pages).forEach(function (k) { redraw(posOf(+k)); });
      syncTb(); saveStack(); return;
    }
    if (r.op.t === "split") {
      // Undo of a split/erase gesture: originals come back, pieces go. Redo reverses it.
      var isUndo = flipOp._undoing === true;
      (r.op.orig || []).forEach(function (id) { V.strokes.forEach(function (s) { if (s.id === id) { s.gone = isUndo ? false : true; pages[s.page] = 1; put("strokes", s); } }); });
      (r.op.pieces || []).forEach(function (id) { V.strokes.forEach(function (s) { if (s.id === id) { s.gone = isUndo ? true : false; pages[s.page] = 1; put("strokes", s); } }); });
      Object.keys(pages).forEach(function (k) { redraw(posOf(+k)); });
      syncTb(); saveStack(); return;
    }
    opIds(r.op).forEach(function (id) {
      V.strokes.forEach(function (s) { if (s.id === id) { s.gone = r.gone; pages[s.page] = 1; put("strokes", s); } });
      if (V.items) {
        V.items.forEach(function (it) {
          if (it.id === id) {
            it.gone = r.gone;
            pages[it.page] = 1;
            put("items", it);
            if (G.STUDY_INSERT && G.STUDY_INSERT.renderPageItems) G.STUDY_INSERT.renderPageItems(posOf(it.page));
          }
        });
      }
    });
    Object.keys(pages).forEach(function (k) { redraw(posOf(+k)); });
    syncTb(); saveStack();
  }

  // Erase toast with Undo (phase P0): one undo step, exactly the erased strokes come back. Follows the
  // undo toast pattern (auto-dismiss 4 s). One at a time; a new erase replaces the old toast.
  var eraseTimer = null;
  function removeEraseToast() {
    if (eraseTimer) { G.clearTimeout(eraseTimer); eraseTimer = null; }
    var b = host && host.root() && host.root().querySelector("#stEraseToast");
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }
  function undoErase(ids) {
    if (!V) return;
    var pages = {}, found = -1, i, op;
    for (i = V.stack.u.length - 1; i >= 0; i--) {
      op = V.stack.u[i];
      if (op && op.t === "del" && op.ids.length === ids.length) {
        var same = true, k;
        for (k = 0; k < ids.length; k++) if (op.ids.indexOf(ids[k]) === -1) { same = false; break; }
        if (same) { found = i; break; }
      }
    }
    if (found !== -1) {
      op = V.stack.u.splice(found, 1)[0];
      V.stack.r.push(op);
    }
    V.strokes.forEach(function (s) {
      if (ids.indexOf(s.id) !== -1 && s.gone) { s.gone = false; pages[s.page] = 1; put("strokes", s); }
    });
    Object.keys(pages).forEach(function (k) { redraw(posOf(+k)); });
    syncTb(); saveStack();
  }
  function showEraseToast(count, ids, n) {
    removeEraseToast();
    var root = host && host.root();
    if (!root) return;
    var div = D.createElement("div");
    div.id = "stEraseToast";
    div.className = "st-erase-toast";
    div.setAttribute("role", "status");
    div.innerHTML = "<span>" + (count === 1 ? "Erased 1 stroke" : "Erased " + count + " strokes") + "</span>" +
      '<button type="button" class="st-erase-undo" id="stEraseUndo" data-act="st-erase-undo">Undo</button>';
    div.addEventListener("click", function (e) {
      var b = e.target;
      while (b && b !== div) {
        if (b.getAttribute && b.getAttribute("data-act") === "st-erase-undo") {
          undoErase(ids);
          removeEraseToast();
          return;
        }
        b = b.parentNode;
      }
    });
    div._stEraseIds = ids;
    root.appendChild(div);
    eraseTimer = G.setTimeout(removeEraseToast, 4000);
  }

  /* ---- export and backup (A8) ---- */
  function safeName(t) { return String(t || "").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Study"; }
  function saveBlob(blob, name) {
    var a = D.createElement("a"), u = G.URL.createObjectURL(blob);
    a.href = u; a.download = name; D.body.appendChild(a); a.click(); D.body.removeChild(a);
    G.setTimeout(function () { G.URL.revokeObjectURL(u); }, 40000);
  }
  function shareReady() { var N = G.SMD_NATIVE; return G.SMD_IS_NATIVE && fsPlugin() && N && N.share ? N : null; }
  function shareErr(e) { if (!/cancel/i.test(String(e && (e.message || e)))) host.toast("Sharing did not work. Try again."); }
  function shareFile(name, bytes, mime) {
    var N = shareReady(), fs = fsPlugin();
    if (!N) { saveBlob(new Blob([bytes], { type: mime }), name); return Promise.resolve(); }
    return fs.writeFile({ path: "study-out/" + name, data: b64(bytes), directory: "CACHE", recursive: true }).then(function (r) { return N.share({ title: name, files: [r.uri], dialogTitle: "Share or print" }); }).then(null, shareErr);
  }
  function shareOriginal() {
    var d = V && V.doc; if (!d || V.nb) return;
    loadOriginal(d).then(function (bytes) { return shareFile(safeName(d.title) + ".pdf", bytes, "application/pdf"); }, function () { host.toast("The original could not be read."); });
  }
  function flatten() {
    closeMoreMenu();
    var d = V && V.doc; if (!d) return;
    var pdf = V.pdf, strokes = V.strokes.filter(function (s) { return !s.gone; }), n = V.n, name = safeName(d.title) + (V.nb ? "" : " (flattened)") + ".pdf";
    host.toast("Preparing the PDF...");
    jspdf().then(function (J) {
      var doc = null, i = 1;
      function next() {
        if (i > n) return;
        var k = i++;
        return (pdf ? pdf.getPage(k) : Promise.resolve(null)).then(function (pg) {
          var v1 = pg ? pg.getViewport({ scale: 1 }) : { width: 595.28, height: 595.28 * (d.ratio || 1.414) }, sc = Math.min(3, 1600 / v1.width), cw = Math.floor(v1.width * sc), ch = Math.floor(v1.height * sc), c = D.createElement("canvas"), x;
          c.width = cw; c.height = ch; x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cw, ch);
          return (pg ? pg.render({ canvasContext: x, viewport: pg.getViewport({ scale: sc }) }).promise.then(function () { pg.cleanup(); }) : Promise.resolve(drawBg(x, d.style, d.ratio, cw))).then(function () {
            var id = pdf ? k : d.ord[k - 1], o = v1.height >= v1.width ? "p" : "l";
            if (V.items) {
              V.items.forEach(function (it) {
                if (it.page === id && !it.gone) {
                  if (G.STUDY_INSERT && G.STUDY_INSERT.drawItemToCanvas) G.STUDY_INSERT.drawItemToCanvas(x, it, cw, ch);
                }
              });
            }
            strokes.forEach(function (s) { if (s.page === id) drawStroke(x, s, cw, ch, 1); });
            if (!doc) doc = new J({ unit: "pt", format: [v1.width, v1.height], orientation: o, compress: true }); else doc.addPage([v1.width, v1.height], o);
            doc.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, v1.width, v1.height); c.width = 0;
          }).then(next);
        });
      }
      return next().then(function () { return shareFile(name, new Uint8Array(doc.output("arraybuffer")), "application/pdf"); });
    }).then(null, function () { host.toast("The PDF could not be made."); });
  }

  function bk(msg) { var e = host && host.root() && host.root().querySelector("#stBk"); if (e) e.textContent = msg; else if (host) host.toast(msg); }
  function putAll(store, arr) {
    if (!arr.length) return Promise.resolve();
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, "readwrite"), o = t.objectStore(store);
        arr.forEach(function (v) { o.put(v); });
        t.oncomplete = function () { res(); }; t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function backup() {
    var F = G.fflate, name = "StewardMD Study backup " + stamp().slice(0, 10) + ".zip", nat = shareReady(), fs = nat && fsPlugin(), parts = [], n = 0, chain = Promise.resolve(), err = null, uri = null;
    var man = { format: BK, v: 1, created: Date.now(), counts: { docs: 0, folders: 0, strokes: 0, ptext: 0, files: 0, audio: 0 }, files: [] };
    if (!(F && F.Zip && F.ZipPassThrough)) return bk("Backup is not available in this build.");
    var z = new F.Zip(function (e, chunk) {
      if (e) { err = e; return; }
      if (!fs) { parts.push(chunk); return; }
      var i = n++, data = b64(chunk), p = "study-out/" + name;
      chain = chain.then(function () { return i ? fs.appendFile({ path: p, data: data, directory: "CACHE" }) : fs.writeFile({ path: p, data: data, directory: "CACHE", recursive: true }).then(function (r) { uri = r.uri; }); });
    });
    var add = function (fname, bytes, listed) {
      var f = new F.ZipPassThrough(fname); z.add(f); f.push(bytes, true);
      if (!listed) return chain;
      return sha256(bytes).then(function (h) { man.files.push({ name: fname, sha256: h, bytes: bytes.length }); return chain; });
    };
    var json = function (o) { return F.strToU8(JSON.stringify(o)); };
    bk("Backing up...");
    Promise.all([all("docs"), all("folders")]).then(function (r) {
      man.counts.folders = r[1].length;
      return add("folders.json", json(r[1]), true).then(function () {
        return r[0].reduce(function (p, d) {
          return p.then(function () {
            return Promise.all([strokesOf(d.id), get("undo", d.id), textOf(d.id), get("index", d.id), itemsOf(d.id)]).then(function (x) {
              man.counts.docs++; man.counts.strokes += x[0].length; man.counts.ptext += x[2].length;
              if (man.counts.items != null) man.counts.items += x[4].length;
              return add("docs/" + d.id + ".json", json({ doc: d, strokes: x[0], undo: x[1] || null, ptext: x[2], index: x[3] || null, items: x[4] || [] }), true);
            }).then(function () {
              if (d.kind === "nb") return;
              return loadOriginal(d).then(function (bytes) { man.counts.files++; return add("files/" + d.id + ".pdf", bytes, true); });
            });
          });
        }, Promise.resolve());
      });
    }).then(function () { /* Phase 5b: audio blobs + metadata */
      return all("audio").then(function (aa) { aa = aa || []; man.counts.audio = aa.length;
        var meta = aa.map(function (a) { return { id: a.id, doc: a.doc, mime: a.mime || "audio/webm", size: a.size || 0, started: a.started || 0, dur: a.dur || 0, bytes: a.size || 0 }; });
        return add("audio.json", json(meta), true).then(function () {
          return aa.reduce(function (p, a) {
            return p.then(function () {
              var blob = a.blob;
              var toBytes = blob && blob.arrayBuffer ? blob.arrayBuffer() : Promise.resolve(blob && blob.__bytes ? blob.__bytes : new ArrayBuffer(0));
              return toBytes.then(function (ab) { return add("audio/" + a.id + ".bin", new Uint8Array(ab), true); }, function () { return add("audio/" + a.id + ".bin", new Uint8Array(0), true); });
            });
          }, Promise.resolve());
        });
      }).then(null, function () { /* no audio store (old db): backup without audio */ });
    }).then(function () {
      return add("manifest.json", json(man), false);
    }).then(function () {
      z.end();
      return chain;
    }).then(function () {
      if (err) throw err;
      if (!fs) { saveBlob(new Blob(parts, { type: "application/zip" }), name); return; }
      return nat.share({ title: name, files: [uri], dialogTitle: "Save the backup" }).then(null, shareErr).then(function () { try { fs.deleteFile({ path: uri }).then(null, function () {}); } catch (e) {} });
    }).then(function () { bk("Backup made: " + man.counts.docs + (man.counts.docs === 1 ? " document, " : " documents, ") + man.counts.strokes + " strokes."); }, function () { bk("The backup could not be made."); });
  }
  function pickBackup() {
    var N = G.SMD_NATIVE, viaInput = function () { var f = host.root() && host.root().querySelector("#stRestoreF"); if (f) f.click(); };
    if (!(N && N.pickFile)) return viaInput();
    N.pickFile({ types: ["application/zip", "application/x-zip-compressed", "application/octet-stream"] }).then(function (blob) {
      return blob.arrayBuffer().then(function (ab) { return restoreBytes(new Uint8Array(ab)); });
    }, viaInput);
  }
  function restoreBytes(bytes) {
    var F = G.fflate, ent;
    try { ent = F.unzipSync(bytes); } catch (e) { return bk("Nothing was restored. That file is not a Study Studio backup."); }
    bk("Checking the backup...");
    return verifyBackup(ent, sha256).then(function (v) {
      if (!v.ok) return bk("Nothing was restored. " + v.error);
      return Promise.all([all("docs"), all("folders")]).then(function (h) {
        var plan = restorePlan(h[0], v.recs), have = {}, strokes = 0;
        h[1].forEach(function (f) { have[f.id] = 1; });
        return putAll("folders", v.folders.filter(function (f) { return !have[f.id]; })).then(function () {
          return plan.add.reduce(function (p, r) {
            return p.then(function () {
              var d = r.doc, w = d.kind === "nb" ? Promise.resolve(d.store) : saveOriginal(d.id, ent["files/" + d.id + ".pdf"]);
              return w.then(function (where) { if (d.kind !== "nb") d.store = where; return putAll("strokes", r.strokes); })
                .then(function () { return r.items && r.items.length ? putAll("items", r.items) : null; })
                .then(function () { return putAll("ptext", r.ptext); })
                .then(function () { return r.undo ? put("undo", r.undo) : null; })
                .then(function () { return r.index ? put("index", r.index) : null; })
                .then(function () { strokes += r.strokes.length; return put("docs", d); });
            });
          }, Promise.resolve());
        }).then(function () { /* Phase 5b: audio blobs (never overwrite) */
          var audio = (v.audio || []), inAdd = {}; plan.add.forEach(function (r) { inAdd[r.doc.id] = 1; });
          return all("audio").then(function (existing) { existing = existing || []; var has = {}; existing.forEach(function (a) { has[a.id] = 1; });
            var todo = audio.filter(function (a) { return !has[a.id] && inAdd[a.doc]; });
            return todo.reduce(function (p, a) {
              return p.then(function () {
                var bin = ent["audio/" + a.id + ".bin"] || new Uint8Array(0);
                var blob = new Blob([bin], { type: a.mime || "audio/webm" });
                return put("audio", { id: a.id, doc: a.doc, mime: a.mime || "audio/webm", size: bin.length, started: a.started || 0, dur: a.dur || 0, blob: blob });
              });
            }, Promise.resolve());
          }).then(null, function () {});
        }).then(function () {
          bk("Restored " + plan.add.length + (plan.add.length === 1 ? " document" : " documents") + " with " + strokes + " strokes. Skipped " + plan.skip.length + " already in the library. Nothing existing was changed.");
          if (onTop("#stLib")) fillLib();
          kick();
        });
      });
    }).then(null, function () { bk("The restore stopped part way. Run it again: documents already restored are skipped."); });
  }

  /* ---- study link (A7) ---- */
  var sheetOk = null;
  function closeSheet() { var r = host && host.root(), e = r && r.querySelector("#stSheet"); if (e) e.parentNode.removeChild(e); sheetOk = null; }
  function sheet(html, ok, label) {
    closeSheet();
    var e = D.createElement("div");
    e.id = "stSheet"; e.className = "st-sheet"; e.setAttribute("role", "dialog"); e.setAttribute("aria-modal", "true");
    e.innerHTML = '<div class="st-sh smd-books-keep smd-emo-keep">' + html + '<div class="st-acts">' + (ok ? '<button type="button" class="pn-btn pri" data-act="st-sok" id="stSheetOk">' + label + "</button>" : "") +
      '<button type="button" class="pn-btn" data-act="st-scancel">' + (ok ? "Cancel" : "Close") + "</button></div></div>";
    e.addEventListener("click", function (ev) { if (ev.target === e) closeSheet(); });
    host.root().appendChild(e); sheetOk = ok || null;
  }
  function signedIn() { var a = G.SMD_AUTH; return !!(a && a.currentUser); }
  function pagesText(pdf, id, pages) {
    var SR = G.PREP_SRC;
    return textOf(id).then(function (rows) {
      var ocr = {};
      rows.forEach(function (x) { if (x.src === "ocr" && x.text) ocr[x.page] = x.text; });
      return pages.reduce(function (pr, n) {
        return pr.then(function (out) {
          if (!pdf) {
            // Notebook: return stored OCR or text if present
            var lines = ocr[n] ? ocr[n].split(/\n+/).map(function (t) { return { tx: t.replace(/\s+/g, " ").trim(), size: 0 }; }).filter(function (l) { return l.tx; }) : [];
            if (lines.length) out.push({ p: n, ocr: true, lines: lines });
            return out;
          }
          return pdf.getPage(n).then(function (pg) {
            return pg.getTextContent().then(function (tc) {
              pg.cleanup();
              var lines = SR.itemsToLines(tc.items);
              if (!lines.length && ocr[n]) lines = ocr[n].split(/\n+/).map(function (t) { return { tx: t.replace(/\s+/g, " ").trim(), size: 0, ocr: true }; }).filter(function (l) { return l.tx; });
              if (lines.length) out.push({ p: n, ocr: !!lines[0].ocr, lines: lines });
              return out;
            });
          });
        });
      }, Promise.resolve([]));
    });
  }
  function makeDeck() {
    var SR = G.PREP_SRC, C = G.PREP_C;
    if (!V || V.nb) return;
    if (!(SR && C && C.fromStudy)) return host.toast("Cards and questions are not available here.");
    var inp = host.root().querySelector("#stRange"), r = pageSel(inp && inp.value, V.cur || 1, V.n, SR), pdf = V.pdf, id = V.id, title = V.title, esc = host.esc;
    if (r.error) return host.toast(r.error);
    if (!signedIn()) return sheet("<p>" + esc(C._pure.MSG["sign-in"]) + "</p>");
    sheet("<h2>Make flashcards and questions</h2><p>The text of pages " + esc(SR.selSpec(r.pages)) + " of " + esc(title) + " will be sent to our server to write them. The PDF file is never sent. " +
      "Names, phone numbers and ID numbers are looked for and removed first.</p><p>Use your own notes or material you may use for study. It uses MaiK Tokens from your account.</p>", function () {
      host.toast("Reading the pages...");
      pagesText(pdf, id, r.pages).then(function (pages) {
        if (!pages.length) return host.toast("No readable text on these pages yet. A scan is read in the background; try again in a moment.");
        C.fromStudy(host, { id: id, name: title, title: title, pages: pages });
      }, function () { host.toast("Those pages could not be read."); });
    }, "Send and make");
  }
  function askAi(text) {
    var u = G.SMD_AUTH && G.SMD_AUTH.currentUser, bad = function (t) { return { error: t }; };
    return Promise.resolve(u.getIdToken()).then(function (tok) {
      return G.fetch((G.SMD_API_BASE || "") + "/api/ai/prep-teach", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ kind: "chat", base: "step", ground: text, turn: 1, messages: [{ r: "u", t: "Explain this passage clearly, in plain words, for a medical exam student." }] }) });
    }).then(function (r) {
      return r.json().then(null, function () { return {}; }).then(function (j) {
        if (r.status === 200 && j && j.text) return { text: String(j.text) };
        return bad(r.status === 401 ? "Sign in to use Explain." : r.status === 429 ? "Your AI limit is reached for now. Try again later." : "Explain could not answer just now. Try again.");
      });
    }, function () { return bad("Explain could not reach the server. Check your connection."); });
  }
  function explain() {
    var s = V && V.sel, esc = host.esc, title = V && V.title;
    if (!s || !s.text) return host.toast("Select some text on a PDF page first.");
    var text = s.text.slice(0, 1500), pn = s.page;
    if (G.navigator.onLine === false) return sheet("<p>You are offline. Explain needs a connection, so nothing was sent.</p>");
    if (!signedIn()) return sheet("<p>Sign in to use Explain. It is answered on our server.</p>");
    sheet("<h2>Explain this text</h2><p>The selected text will be sent to the AI to be explained. The PDF file is not sent.</p><blockquote class=\"st-bq\">" + esc(text) + "</blockquote>" +
      (s.text.length > 1500 ? "<p>Only the first 1,500 characters are sent.</p>" : ""), function () {
      sheet('<p role="status">Explaining...</p>');
      askAi(text).then(function (r) {
        sheet('<p class="st-from">From <b>' + esc(title) + "</b>, page " + pn + "</p>" + (r.text ? '<p class="st-ans">' + esc(r.text) + "</p>" : "<p>" + esc(r.error) + "</p>"));
      });
    }, "Send and explain");
  }

  /* ---- actions ---- */
  function docIdOf(el) { return el.getAttribute("data-id"); }
  function act(a, el, h) {
    host = h;
    if (G.STUDY_INSERT && G.STUDY_INSERT.act && G.STUDY_INSERT.act(a, el, h, V)) return;
    if (a === "st-import") return pickPdf();
    if (a === "st-photos") return pickPhotos();
    if (a === "st-backup") return backup();
    if (a === "st-restore") return pickBackup();
    if (a === "st-sok") { var so = sheetOk; closeSheet(); return so && so(); }
    if (a === "st-scancel") return closeSheet();
    if (a === "st-src") {
      var sd = el.getAttribute("data-doc"), sp = parseInt(el.getAttribute("data-p"), 10) || 1;
      return get("docs", sd).then(function (d) { if (!d) return h.toast("That document is not in your Study Studio library any more."); h.push(function () { renderViewer(sd, sp); }); });
    }
    if (a === "st-scan") return doScan();
    if (a === "st-filter") { lib.filter = el.getAttribute("data-v"); return fillLib(); }
    if (a === "st-newfolder") { var nm = G.prompt("Folder name"); if (nm && nm.trim()) put("folders", { id: uid(), name: nm.trim().slice(0, 40) }).then(fillLib); return; }
    if (a === "st-delfolder") {
      if (!G.confirm("Delete this folder? Its PDFs stay in your library.")) return;
      var fid = el.getAttribute("data-v");
      return all("docs").then(function (ds) { return Promise.all(ds.filter(function (d) { return d.folderId === fid; }).map(function (d) { d.folderId = null; return put("docs", d); })); }).then(function () { return del("folders", fid); }).then(function () { lib.filter = "all"; fillLib(); });
    }
    if (a === "st-newnb") { var nf = h.root().querySelector("#stNew"); nf.hidden = !nf.hidden; return; }
    if (a === "st-mknb") { var rt = h.root(); return makeNotebook(rt.querySelector("#stNbT").value, rt.querySelector("#stNbS").value, rt.querySelector("#stNbZ").value).then(function (m) { return h.push(function () { renderViewer(m.id); }); }); }
    if (a === "st-hit") { var hid = docIdOf(el), hp = parseInt(el.getAttribute("data-page"), 10) || 1; return h.push(function () { renderViewer(hid, hp); }); }
    if (a === "st-open") { var id = docIdOf(el); return h.push(function () { renderViewer(id); }); }
    if (a === "st-fav") { closeDocMenu(); return get("docs", docIdOf(el)).then(function (d) { d.favourite = !d.favourite; return put("docs", d); }).then(fillLib); }
    if (a === "st-rename") { closeDocMenu(); return get("docs", docIdOf(el)).then(function (d) { var t = G.prompt("Rename", d.title); if (t && t.trim()) { d.title = t.trim().slice(0, 120); return put("docs", d).then(fillLib); } }); }
    if (a === "st-delete") { closeDocMenu(); if (G.confirm("Delete this PDF and your pen strokes on it? This cannot be undone.")) removeDoc(docIdOf(el)).then(fillLib); return; }
    if (a === "st-doc-menu") return showDocMenu(docIdOf(el));
    if (a === "st-close-docmenu") return closeDocMenu();
    if (a === "st-move-folder") return showMoveFolderSheet(docIdOf(el));
    if (a === "st-close-foldersheet") return closeFolderSheet();
    if (a === "st-set-folder") {
      var sId = docIdOf(el), sFid = el.getAttribute("data-folder") || null;
      closeFolderSheet();
      return get("docs", sId).then(function (d) {
        if (d) { d.folderId = sFid; return put("docs", d); }
      }).then(fillLib);
    }
    if (!V) return;
    // Phase 2 hook: selection menu actions (study-select.js) own the st-lasso-* actions.
    if (G.STUDY_SELECT && G.STUDY_SELECT.act && G.STUDY_SELECT.act(a, el, h, inkApi(V.cur || 1, null))) return;
    if (a === "st-more") return showMoreMenu();
    if (a === "st-close-more") return closeMoreMenu();
    if (a === "st-make") return makeDeck();
    if (a === "st-orig") return shareOriginal();
    if (a === "st-flat") return flatten();
    if (a === "st-explain") return explain();
    if (a === "st-zoom-window") return toggleZoomWindow();
    if (a === "st-page-sheet") return showPageSheet();
    if (a === "st-close-pagesheet") return closePageSheet();
    if (a === "st-jump-page") {
      var p = parseInt(el.getAttribute("data-page"), 10) || 1;
      closePageSheet();
      if (V && V.pg[p]) { V.sc.scrollTop = V.pg[p].el.offsetTop; curPage(); }
      return;
    }
    if (a === "st-toggle-scribble") {
      V.scribble = V.scribble === false;
      try { G.localStorage.setItem("smd_study_scribble2", V.scribble ? "1" : "0"); } catch (e) {}
      var scSt = host.root().querySelector("#stScribbleSt");
      if (scSt) scSt.textContent = V.scribble ? "ON" : "OFF";
      host.toast("Scribble to erase: " + (V.scribble ? "ON" : "OFF"));
      syncTb();
      return;
    }
    if (a === "st-lasso-del") {
      if (!V || !V.lasso) return;
      var deadIds = V.lasso.ids, pgN = V.lasso.n;
      V.strokes.forEach(function (s) {
        if (deadIds.indexOf(s.id) !== -1) { s.gone = true; put("strokes", s); }
      });
      push(V.stack, { t: "del", ids: deadIds });
      saveStack();
      V.lasso = null;
      removeLassoBar();
      redraw(pgN);
      syncTb();
      host.toast("Deleted selection.");
      return;
    }
    if (a === "st-lasso-color") {
      if (!V || !V.lasso) return;
      var cCol = (V.tool === "hl" ? HCOLORS : COLORS)[V.ci];
      V.strokes.forEach(function (s) {
        if (V.lasso.ids.indexOf(s.id) !== -1) { s.color = cCol; put("strokes", s); }
      });
      redraw(V.lasso.n);
      host.toast("Recoloured.");
      return;
    }
    if (a === "st-lasso-copy") {
      if (!V || !V.lasso) return;
      var newIds = [], copyPg = V.lasso.page, copyN = V.lasso.n;
      V.strokes.forEach(function (s) {
        if (V.lasso.ids.indexOf(s.id) !== -1) {
          var copy = {
            id: uid(), doc: V.id, page: s.page, tool: s.tool, color: s.color, w: s.w,
            pts: s.pts.map(function (pt) { return [r4(Math.min(0.99, pt[0] + 0.03)), r4(Math.min(0.99, pt[1] + 0.03)), pt[2]]; }),
            gone: false, t: Date.now()
          };
          V.strokes.push(copy);
          newIds.push(copy.id);
          put("strokes", copy);
        }
      });
      newIds.forEach(function (nid) { push(V.stack, { t: "add", id: nid }); });
      saveStack();
      V.lasso = { page: copyPg, ids: newIds, n: copyN };
      redraw(copyN);
      host.toast("Duplicated.");
      return;
    }
    if (a === "st-lasso-done") {
      if (V) { var oldN = V.lasso && V.lasso.n; V.lasso = null; removeLassoBar(); if (oldN) redraw(oldN); }
      return;
    }
    if (a === "st-ai-make") return makeDeck();
    if (a === "st-ai-explain-page" || a === "st-ai-summary") {
      if (!V) return;
      var cp = V.cur || 1;
      pagesText(V.pdf, V.id, [cp]).then(function (pgs) {
        var txt = pgs[0] && pgs[0].lines ? pgs[0].lines.map(function (l) { return l.tx; }).join(" ") : "";
        if (!txt.trim()) return host.toast("No readable text on this page yet.");
        sheet('<h2>' + (a === "st-ai-summary" ? 'Summary' : 'Explanation') + '</h2><p>Sending page ' + cp + ' text to explain...</p>', function () {
          sheet('<p role="status">Explaining...</p>');
          askAi(txt.slice(0, 1500)).then(function (r) {
            sheet('<p class="st-from">From <b>' + host.esc(V.title) + '</b>, page ' + cp + '</p>' + (r.text ? '<p class="st-ans">' + host.esc(r.text) + '</p>' : '<p>' + host.esc(r.error) + '</p>'));
          });
        }, "Send and explain");
      });
      return;
    }
    if (a === "st-tool") {
      var t = el.getAttribute("data-v");
      // Phase 1: tapping the active pen/highlighter/eraser again opens its settings popover.
      if (V.tool === t && G.STUDY_INK && (t === "pen" || t === "hl" || t === "er")) { G.STUDY_INK.popover(inkApi(V.cur || 1, null), t); return syncTb(); }
      if (V.tool && V.tool !== "er" && t === "er") V.prevTool = V.tool;
      if (t !== "er" && V.tool !== t) V.prevTool = V.tool;
      V.tool = V.tool === t ? null : t;
      if (G.STUDY_INK) G.STUDY_INK.closePopover(inkApi(V.cur || 1, null));
      if (V.lasso) { V.lasso = null; removeLassoBar(); }
      return syncTb();
    }
    if (a === "st-ink-clear") { if (G.STUDY_INK) G.STUDY_INK.closePopover(inkApi(V.cur || 1, null)); return clearPageInk(); }
    if (a === "st-color") { V.ci = +el.getAttribute("data-v"); if (!V.tool) V.tool = "pen"; return syncTb(); }
    if (a === "st-width") { V.wi = +el.getAttribute("data-v"); if (!V.tool) V.tool = "pen"; return syncTb(); }
    if (a === "st-undo") { var u = undo(V.stack); if (u) { flipOp._undoing = true; flipOp(u); flipOp._undoing = false; } return; }
    if (a === "st-redo") { var r = redo(V.stack); if (r) { flipOp._undoing = false; flipOp(r); } return; }
    if (a === "st-erase-undo") {
      var et = host.root().querySelector("#stEraseToast");
      if (et && et._stEraseIds) { undoErase(et._stEraseIds); removeEraseToast(); }
      return;
    }
    if (a === "st-go") {
      var inp = h.root().querySelector("#stPage"), n = Math.max(1, Math.min(V.n, parseInt(inp && inp.value, 10) || 1));
      closePageSheet();
      if (V.pg[n]) { V.sc.scrollTop = V.pg[n].el.offsetTop; curPage(); }
      return;
    }
    if (V.nb && (a === "st-addpg" || a === "st-delpg" || a === "st-up" || a === "st-dn")) {
      closePageSheet();
      return nbAct(a);
    }
    if (a === "st-zoom") {
      var nz = V.z * (el.getAttribute("data-v") === "+" ? 1.25 : 0.8);
      setZoom(nz);
      var zl = host.root().querySelector("#stZoomLabel");
      if (zl) zl.textContent = Math.round(V.z * 100) + "%";
      return;
    }
  }
  function back() {
    var root = host && host.root();
    if (root) {
      if (G.STUDY_INSERT && G.STUDY_INSERT.back && G.STUDY_INSERT.back(root)) return true;
      var s = root.querySelector("#stMoreSheet, #stPageSheet, #stDocMenuSheet, #stFolderSheet");
      if (s) {
        closeMoreMenu(); closePageSheet(); closeDocMenu(); closeFolderSheet();
        return true;
      }
    }
    return false;
  }
  function leave() { closeViewer(); }
  function homeRow(h) { host = h; return ""; }

  /* Phase 5a hook: the GoodNotes library (study-library.js) reuses the indexer so PDF text search keeps working. */
  /* Phase 5a hang fix: the library reuses STUDY.db (this connection) instead of opening its own
     IndexedDB connection, so the library never holds a second connection that can wedge opens. */
  function pencilDoubleTap() {
    if (!V) return;
    if (V.tool === "er") {
      V.tool = V.prevTool || "pen";
    } else {
      V.prevTool = V.tool || "pen";
      V.tool = "er";
    }
    syncTb();
  }
  function inkDblTap() { pencilDoubleTap(); }

  D.addEventListener("keydown", function (e) {
    if (!V) return;
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
    if (e.key === "d" || e.key === "D" || e.key === "e" || e.key === "E") {
      pencilDoubleTap();
    }
  });

  G.STUDY = {
    on: on, lib: renderLib, act: act, back: back, leave: leave, homeRow: homeRow, setPageText: setPageText,
    kick: kick, db: db,
    _pure: PURE, _state: function () { return V; },
    put: put, del: del, get: get, all: all, q: q, itemsOf: itemsOf,
    pushUndo: function (op) { push(V.stack, op); syncTb(); saveStack(); },
    syncTb: syncTb, saveStack: saveStack, reloadNb: reloadNb,
    askAi: askAi, makeDeck: makeDeck, sheet: sheet, closeSheet: closeSheet,
    scanner: scanner, normPhoto: normPhoto, shotsToDoc: shotsToDoc,
    pid: pid, posOf: posOf, redraw: redraw,
    pencilDoubleTap: pencilDoubleTap, toggleZoomWindow: toggleZoomWindow, showPageSheet: showPageSheet,
    host: function () { return host; },
    buildPdf: buildPdf,
    _v: function () { return V; }, _redraw: redraw, _pushUndo: function (op) { if (V) { push(V.stack, op); saveStack(); syncTb(); } },
    _saveStack: saveStack, _put: put, _get: get, _all: all, _strokesOf: strokesOf, _uid: uid, _drawBg: drawBg, _drawStroke: drawStroke, _del: del,
    _reloadNb: reloadNb, _host: function () { return host; }, _syncTb: syncTb, _setZoom: setZoom, _openPdf: openPdf, _pdfjs: pdfjs, _loadOriginal: loadOriginal,
    _doScan: doScan, _pickPhotos: pickPhotos, _pickPdf: pickPdf, _importPhotos: importPhotos,
    _inkDblTap: inkDblTap, _pencilDoubleTap: pencilDoubleTap, _showPageSheet: showPageSheet, _toggleZoomWindow: toggleZoomWindow,
    _inkApi: function () { return V ? inkApi(V.cur || 1, null) : null; },
    pencilDoubleTap: pencilDoubleTap, pencilSwitchPrevious: pencilSwitchPrevious, openPenSettings: openPenSettings
  };
})(typeof window !== "undefined" ? window : this);
