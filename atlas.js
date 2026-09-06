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

  // One SVG in stage PIXEL coordinates holding every dot, leader line, tick and label.
  // Pixels rather than a percentage viewBox so circles stay circular and text stays
  // upright at any stage aspect; the caller repaints on resize.
  function overlaySvg(slice, atlas, box, stageW, stageH, opts) {
    opts = opts || {};
    var sel = opts.sel, hidden = opts.hidden || {};
    var cats = (atlas && atlas.categories) || {}, strs = (atlas && atlas.structures) || {};
    var pins = ((slice && slice.pins) || []).filter(function (p) {
      return strs[p.s] && !hidden[p.s];
    });

    // Pin coordinates are percentages of the IMAGE box, but labels are placed down the
    // full-height STAGE gutter. Convert to stage space BEFORE laying out, or every
    // label drifts away from its structure by the letterbox offset and the leader
    // lines fan out diagonally instead of running almost straight across.
    function stageY(p) { return stageH ? ((box.y + (p.y / 100) * box.h) / stageH) * 100 : p.y; }

    var L = [], R = [];
    pins.forEach(function (p) {
      var w = { s: p.s, x: p.x, y: stageY(p), px: p.x, py: p.y };
      (p.x < 50 ? L : R).push(w);
    });

    var anySel = !!sel && pins.some(function (p) { return p.s === sel; });
    var parts = [];

    function emit(side, laid) {
      laid.forEach(function (o) {
        var p = o.pin, s = strs[p.s];
        var col = (cats[s.category] && cats[s.category].color) || "#ffffff";
        var on = sel === p.s, dim = anySel && !on;
        var cls = on ? " on" : (dim ? " dim" : "");

        var dx = box.x + (p.px / 100) * box.w;         // dot, in stage px
        var dy = box.y + (p.py / 100) * box.h;
        var tx = side === "l" ? GUTTER_PX - 6 : stageW - GUTTER_PX + 6;   // label tick
        var ty = (o.labelY / 100) * stageH;

        parts.push('<line class="atlas-lead' + cls + '" x1="' + tx.toFixed(1) + '" y1="' + ty.toFixed(1) +
          '" x2="' + dx.toFixed(1) + '" y2="' + dy.toFixed(1) + '" stroke="' + esc(col) + '"/>');
        parts.push('<line class="atlas-tick' + cls + '" x1="' + tx.toFixed(1) + '" y1="' + (ty - 11).toFixed(1) +
          '" x2="' + tx.toFixed(1) + '" y2="' + (ty + 11).toFixed(1) + '" stroke="' + esc(col) + '"/>');

        var lines = wrapLabel(s.name, LABEL_CHARS, LABEL_LINES);
        var anchor = side === "l" ? "end" : "start";
        var lx = side === "l" ? tx - 7 : tx + 7;
        var y0 = ty - (lines.length - 1) * 6.5;
        parts.push('<text class="atlas-lab ' + side + cls + '" x="' + lx.toFixed(1) + '" y="' + y0.toFixed(1) +
          '" text-anchor="' + anchor + '" fill="' + esc(col) + '" data-atlas-act="pin" data-atlas-s="' + esc(p.s) +
          '" role="button" tabindex="0" aria-label="' + esc(s.name) + '">' +
          lines.map(function (t, k) {
            return '<tspan x="' + lx.toFixed(1) + '" dy="' + (k ? 13 : 0) + '">' + esc(t) + "</tspan>";
          }).join("") + "</text>");

        parts.push('<circle class="atlas-dot' + cls + '" cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) +
          '" r="' + (on ? 5 : 3.2) + '" fill="' + (on ? "#ffffff" : esc(col)) +
          '" data-atlas-act="pin" data-atlas-s="' + esc(p.s) +
          '" role="button" tabindex="0" aria-label="' + esc(s.name) + '"/>');
      });
    }

    emit("l", layoutGutter(L, GAP_PCT, PAD_PCT));
    emit("r", layoutGutter(R, GAP_PCT, PAD_PCT));

    return '<svg class="atlas-svg" viewBox="0 0 ' + stageW + " " + stageH +
      '" width="' + stageW + '" height="' + stageH + '">' + parts.join("") + "</svg>";
  }

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
    modality: ""
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
  function loadModule(id) {
    if (!G.fetch) return Promise.resolve(null);
    return G.fetch("/atlas/" + id + "/atlas.json")
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { st.atlas = j; return j; })
      .catch(function () { st.atlas = null; return null; });
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

  function chipRow() {
    var mods = (st.catalog && st.catalog.modules) || [];
    var regions = [], modalities = [], seenR = {}, seenM = {};
    mods.forEach(function (m) {
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
    var mods = (st.catalog && st.catalog.modules) || [];
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

  function openModule(id) {
    st.view = "viewer"; st.moduleId = id; st.slice = 1;
    st.sel = null; st.locked = null; st.hidden = {}; st.atlas = null;
    paint();
    loadModule(id).then(paint);
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
    var el = G.document.getElementById(id);
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

  function viewerHtml() {
    var m = moduleMeta();
    var s = curSlice();
    return '<div class="atlas-top">' +
        '<button class="atlas-back" data-atlas-act="close" aria-label="Back">‹</button>' +
        '<span class="atlas-hd"><span class="atlas-ttl">' + esc(m.title || "") + "</span>" +
        '<span class="atlas-sub">' + esc(m.subtitle || "") + "</span></span>" +
        '<button class="atlas-info" data-atlas-act="info" aria-label="About this atlas">' + (ico("info") || "i") + "</button></div>" +
      '<div class="atlas-stage" id="atlasStage">' +
        (s ? '<img class="atlas-img" id="atlasImg" alt="" src="' + esc(imgUrl(s.img)) + '">' : "") +
        '<div class="atlas-ov" id="atlasOv"></div>' +
      "</div>" +
      scrubHtml() +
      '<div class="atlas-foot">Educational reference only — not for diagnosis.</div>';
  }

  function total() { return (((st.atlas && st.atlas.slices) || []).length) || 0; }

  function scrubHtml() {
    var n = total();
    if (!n) return "";
    return '<div class="atlas-bar">' +
        '<button class="atlas-gridbtn" data-atlas-act="grid" aria-label="All slices">' + (ico("grid") || "▦") + "</button>" +
        '<div class="atlas-track" id="atlasTrack">' +
          trackThumbs(st.atlas, 5).map(function (u) {
            return '<span class="atlas-tth" style="background-image:url(' + cssUrl(imgUrl(u)) + ')"></span>';
          }).join("") +
          '<span class="atlas-play" id="atlasPlay" style="left:' + playheadPct(st.slice, n).toFixed(2) + '%"></span>' +
          '<input class="atlas-range" id="atlasRange" type="range" min="1" step="1" max="' + n +
            '" value="' + st.slice + '" aria-label="Slice">' +
        "</div>" +
        '<button class="atlas-step" data-atlas-act="prev" aria-label="Previous slice">←</button>' +
        '<span class="atlas-count" id="atlasCount" aria-live="polite" aria-atomic="true">' + st.slice + "/" + n + "</span>" +
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
    var s = curSlice();
    var img = G.document.getElementById("atlasImg");
    if (img && s) gateImg(img, imgUrl(s.img));
    var c = G.document.getElementById("atlasCount");
    if (c) c.textContent = i + "/" + n;
    var r = G.document.getElementById("atlasRange");
    if (r && +r.value !== i) r.value = i;
    var p = G.document.getElementById("atlasPlay");
    if (p) p.style.left = playheadPct(i, n).toFixed(2) + "%";
    drawOverlay();
    closeSheet();
    preloadAround(i);
  }

  // Keep i±1 and i±2 warm so dragging never shows a white frame.
  var _pre = {};
  function preloadAround(i) {
    var sl = (st.atlas && st.atlas.slices) || [];
    [i - 2, i - 1, i + 1, i + 2].forEach(function (k) {
      var s = sl[k - 1];
      if (!s || _pre[s.img]) return;
      _pre[s.img] = 1;
      try { var im = new G.Image(); im.src = imgUrl(s.img); } catch (e) {}
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

  function selectStructure(id) {
    var strs = (st.atlas && st.atlas.structures) || {};
    if (id && !strs[id]) return;      // unknown id: ignore rather than render a blank sheet
    st.sel = id || null;
    drawOverlay();
    if (st.sel) openSheet(st.sel); else closeSheet();
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
    st.sel = null;
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
        '" data-atlas-act="tab" data-tab="' + k + '">' + esc(label) + "</button>";
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
        '<button class="atlas-sheet-x" data-atlas-act="sheetclose" aria-label="Close">' + (ico("close") || "\u00d7") + "</button>" +
      "</div>" +
      '<h2 class="atlas-sheet-ttl">' + esc(s.name) + "</h2>" +
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

  function sheetEl() {
    var el = G.document.getElementById("atlasSheet");
    if (el) return el;
    el = G.document.createElement("div");
    el.id = "atlasSheet";
    // The literal class "sheet" opts this element into dialog-motion.js's spring for
    // free; that file is a passive MutationObserver with no open API of its own.
    el.className = "atlas-sheet sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    rootEl().appendChild(el);
    bindSheetDrag(el);
    return el;
  }

  function openSheet(id) {
    var el = sheetEl();
    el.innerHTML = sheetHtml(id, _tab);
    el.classList.remove("full");
    el.classList.add("on");
  }

  function closeSheet() {
    var el = G.document && G.document.getElementById("atlasSheet");
    if (el) el.classList.remove("on", "full");
  }

  // Peek <-> full snapping plus swipe-to-dismiss. No multi-height sheet exists
  // anywhere in the repo, so this is net-new; the drag maths follows the pattern at
  // home.js:1704 (readable there, not exported).
  function bindSheetDrag(el) { bindSheetDragGeneric(el, SHEET_PEEK, function () { closeSheet(); selectStructure(null); }); }
  // Generic form, shared with the 3D layer (atlas3d.js) so both sheets swipe the same way.
  function bindSheetDragGeneric(el, peek, onDismiss) {
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
      else if (dy > 90) { if (onDismiss) onDismiss(); }
    }
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
  }

  // One 8px threshold does two jobs: it decides scrub-vs-tap, and it sets the dead
  // zone so tapping a pin never nudges the slice.
  var SCRUB_MIN_PX = 8, SCRUB_PX_PER_SLICE = 14;
  function bindStageScrub(stage) {
    if (stage._atlasBound) return;
    stage._atlasBound = true;
    var x0 = 0, base = 0, moved = false, down = false;
    stage.addEventListener("pointerdown", function (e) {
      down = true; moved = false; x0 = e.clientX; base = st.slice;
    });
    stage.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < SCRUB_MIN_PX) return;
      moved = true;
      setSlice(base + Math.round(dx / SCRUB_PX_PER_SLICE));
    });
    function up() { down = false; }
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    // A completed scrub must not also select a pin.
    stage.addEventListener("click", function (e) {
      if (moved) { e.stopPropagation(); moved = false; }
    }, true);
  }

  var _ro = null;
  function afterViewerPaint() {
    var stage = G.document.getElementById("atlasStage");
    if (!stage) return;
    gateImg(G.document.getElementById("atlasImg"));
    drawOverlay();

    var r = G.document.getElementById("atlasRange");
    if (r && !r._atlasBound) {
      r._atlasBound = true;
      r.addEventListener("input", function () { setSlice(+r.value); });
    }
    bindStageScrub(stage);
    preloadAround(st.slice);

    // SVG elements get no native Enter/Space activation, so wire it explicitly —
    // otherwise the pins are focusable but unusable by keyboard.
    var ovEl = G.document.getElementById("atlasOv");
    if (ovEl && !ovEl._atlasKeys) {
      ovEl._atlasKeys = true;
      ovEl.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var t = e.target && e.target.closest && e.target.closest('[data-atlas-act="pin"]');
        if (!t) return;
        e.preventDefault();
        selectStructure(t.getAttribute("data-atlas-s"));
      });
    }
    // The SVG is in stage pixels, so it must be rebuilt whenever the stage resizes
    // (rotation, split view, desktop window drag). One observer, reattached per paint.
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
    var stage = G.document.getElementById("atlasStage");
    function cls(add, name) { if (stage) stage.classList[add ? "add" : "remove"](name); }
    function show() { cls(false, "is-loading"); cls(false, "is-error"); drawOverlay(); }
    function fail() { cls(false, "is-loading"); cls(true, "is-error"); }
    img.onload = show; img.onerror = fail;
    if (url != null) { cls(false, "is-error"); cls(true, "is-loading"); img.src = url; }
    if (img.complete && img.naturalWidth > 0) show();
    else cls(true, "is-loading");
  }

  function drawOverlay() {
    var stage = G.document.getElementById("atlasStage");
    var ov = G.document.getElementById("atlasOv");
    var s = curSlice();
    if (!stage || !ov || !s) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    var box = imageBox(w, h, s.aspect, GUTTER_PX);
    var img = G.document.getElementById("atlasImg");
    if (img) {
      img.style.left = box.x + "px"; img.style.top = box.y + "px";
      img.style.width = box.w + "px"; img.style.height = box.h + "px";
    }
    ov.innerHTML = overlaySvg(s, st.atlas, box, w, h, {
      sel: st.sel || st.locked, hidden: st.hidden
    });
  }

  // One delegated handler for the whole overlay. Extended by later tasks.
  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-atlas-act]");
    if (!b) return;
    var a = b.getAttribute("data-atlas-act");
    if (a === "close") return back();
    if (a === "mod") return openModule(b.getAttribute("data-atlas-mod"));
    if (a === "info") { dropOverlay("atlasInfo"); return void pushOverlay(infoHtml()); }
    if (a === "infoclose") return dropOverlay("atlasInfo");
    if (a === "prev") return setSlice(st.slice - 1);
    if (a === "next") return setSlice(st.slice + 1);
    if (a === "grid") { dropOverlay("atlasGrid"); return void pushOverlay(gridHtml()); }
    if (a === "gridclose") return dropOverlay("atlasGrid");
    if (a === "goto") { setSlice(+b.getAttribute("data-i")); return dropOverlay("atlasGrid"); }
    if (a === "pin") return selectStructure(b.getAttribute("data-atlas-s"));
    if (a === "lock") return toggleLock();
    if (a === "hide") return hideSelected();
    if (a === "sheetclose") return selectStructure(null);
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

  /* ---------- lifecycle ---------- */

  function open(moduleId) {
    var el = rootEl();
    if (!el) return;
    st.sel = null; st.locked = null; st.hidden = {};
    try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; }
    try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
    el.removeEventListener("click", onClick);
    el.addEventListener("click", onClick);
    el.classList.add("on");
    G.document.body.classList.add("atlas-lock");
    try { if (threeD() && G.ATLAS3D.prime) G.ATLAS3D.prime(); } catch (e) {}
    if (moduleId) {
      st.view = "viewer"; st.moduleId = moduleId; st.slice = 1; st.atlas = null;
      paint();
      // Deep links land here without a catalog, and the viewer header needs the
      // module's title/subtitle from it — so load both.
      loadCatalog().then(function () { return loadModule(moduleId); }).then(paint);
    } else {
      st.view = "catalog";
      paint();
      loadCatalog().then(paint);
    }
  }

  // Deep-link a structure: used by the 3D layer's "CT / MRI" rows. Opens the module (and the
  // atlas itself if needed), jumps to the first slice that pins the structure, and LOCKS it so
  // it stays highlighted while the user scrolls.
  function openAt(moduleId, structureId, slice) {
    if (!isOpen()) open(moduleId);
    else {
      st.view = "viewer"; st.moduleId = moduleId; st.slice = 1; st.atlas = null;
      st.sel = null; st.locked = null; st.hidden = {};
      paint();
    }
    return loadCatalog().then(function () { return loadModule(moduleId); }).then(function (a) {
      if (!a || st.moduleId !== moduleId) return;
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

  // Layered back: info overlay -> viewer -> catalog -> close. swipe-back.js consults
  // this, so each swipe steps one level in instead of dumping the user to Home.
  function back() {
    if (!isOpen()) return false;
    // The 3D layer stacks above the atlas; unwind it first so swipe-back and Escape step
    // through its panels before touching the slice viewer underneath.
    try { if (G.ATLAS3D && G.ATLAS3D.isOpen && G.ATLAS3D.isOpen()) return G.ATLAS3D.back(); } catch (e) {}
    if (G.document.getElementById("atlasInfo")) { dropOverlay("atlasInfo"); return true; }
    if (G.document.getElementById("atlasGrid")) { dropOverlay("atlasGrid"); return true; }
    var sh = G.document.getElementById("atlasSheet");
    if (sh && sh.classList.contains("on")) { selectStructure(null); return true; }
    if (st.view === "viewer") { st.view = "catalog"; st.atlas = null; paint(); return true; }
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
  if (G.addEventListener)
    G.addEventListener("resize", function () {
      if (isOpen() && st.view === "viewer") drawOverlay();
    });

  /* ---------- exports ---------- */

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
  G.ATLAS._setSlice = setSlice;
  G.ATLAS._select = selectStructure;
  G.ATLAS._lock = toggleLock;
  G.ATLAS._hide = hideSelected;
  G.ATLAS._sheetHtml = sheetHtml;
  G.ATLAS._pure = {
    layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct,
    validateAtlas: validateAtlas, filterModules: filterModules, groupByRegion: groupByRegion,
    imageBox: imageBox, overlaySvg: overlaySvg, trackThumbs: trackThumbs,
    hierarchyOf: hierarchyOf
  };
  G.ATLAS._version = "1.0";

  if (typeof module !== "undefined" && module.exports)
    module.exports = {
      layoutGutter: layoutGutter, wrapLabel: wrapLabel, playheadPct: playheadPct,
      validateAtlas: validateAtlas, filterModules: filterModules, groupByRegion: groupByRegion,
      imageBox: imageBox, overlaySvg: overlaySvg, trackThumbs: trackThumbs,
      hierarchyOf: hierarchyOf
    };
})(typeof window !== "undefined" ? window : this);
