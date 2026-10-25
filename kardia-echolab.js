/* kardia-echolab.js - Kardia Echo Lab live image (WP10a).
 *
 * Design contract (Operate mode, existing Kardia tokens only, no new palette):
 * purpose: run the live sector, change mode and knobs, freeze and measure.
 * First view: target name, live sector full width, mode row, then the
 * spectrum or M-mode strip when a Doppler mode is on. Composition: one
 * scroll column at 390px; at 820px and above the sector and the controls
 * sit in two panes (image left, knobs and pathology right) using the
 * .kel-wrap grid in kardia-echolab.css. States: loading (real anatomy
 * chunks, progress bar with percent and a plain line), ready (live),
 * offline fallback (parametric geometry, short note under the sector),
 * error (chunk or view load failed, Retry button), empty (no views at
 * this level, handled by kardia.js), frozen (cine bar enabled, Live off),
 * measuring (measure panel open, Done gated by the tool), long text
 * (pathology names and hints wrap, never truncate). Motion: only the
 * cardiac cycle itself and 140ms ease on button press and sheet
 * transform, from --kd-ease; off under prefers-reduced-motion. Every
 * control is a real button, select or labelled range input, at least
 * 44px tall, focus ring from the Kardia tokens. No glow, no gradient.
 * The sector canvas stays dark in both themes, as an ultrasound screen
 * is dark at the bedside. Reduced motion stops the sheet transition,
 * not the cardiac cycle (content, not decoration).
 *
 * ES5 IIFE, window.KARDIA_ECHOLAB. No allocation per frame: the rAF
 * loop reuses one US renderer, one Doppler instance and preallocated
 * cine slot objects; per frame it only steps the heart, sets the probe
 * and knobs, and draws overlays.
 */
(function (G) {
  "use strict";

  /* ---------------- pure helpers (node tested) ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  var DEFAULT_UI_KNOBS = {
    gain: 55, depth: 160, focus: 55,
    tgc: [50, 50, 50, 50, 50, 50, 50, 50],
    frequencyMHz: 3.0, sectorDeg: 80, dynamicRange: 55,
    colourGain: 70, colourNyquistMs: 0.6
  };
  function cloneKnobs(k) {
    var o = {}, key;
    for (key in DEFAULT_UI_KNOBS) o[key] = DEFAULT_UI_KNOBS[key];
    if (k) for (key in k) if (k[key] !== undefined) o[key] = k[key];
    o.tgc = (o.tgc || DEFAULT_UI_KNOBS.tgc).slice(0, 8);
    while (o.tgc.length < 8) o.tgc.push(50);
    return o;
  }
  /* UI sliders (0 to 100) to the KARDIA_US knob set. Gain centre 55 is
   * 0 dB; each UI step is 0.6 dB. TGC centre 50 is 0 dB, range -12 to
   * +12 dB. Focus 0 to 100 maps over the displayed depth. */
  function mapKnobs(ui, resolutionScale) {
    var k = cloneKnobs(ui);
    return {
      gain: (k.gain - 55) * 0.6,
      depth: k.depth,
      focusMm: k.depth * clamp(k.focus, 0, 100) / 100,
      tgc: k.tgc.map(function (v) { return (clamp(v, 0, 100) - 50) * 0.24; }),
      frequencyMHz: k.frequencyMHz, sectorDeg: k.sectorDeg,
      dynamicRange: k.dynamicRange,
      resolutionScale: resolutionScale || 1, showEcg: false
    };
  }
  /* Resolution scale by device: full DPR on fast frames, stepped down
   * when the frame time is over budget. Pure so it is unit tested. */
  function pickResolutionScale(dpr, emaMs) {
    var base = clamp(dpr || 1, 1, 2);
    if (emaMs > 34) return 0.5;
    if (emaMs > 24) return Math.min(base, 0.75);
    if (emaMs > 18) return Math.min(base, 1);
    return base;
  }
  /* Render rate cap: 30 fps normally, 15 fps once the renderer's own
   * frame time passes 25 ms, so a slow (headless CPU) renderer can never
   * starve message handling on the main thread. */
  function targetFps(emaMs) { return emaMs > 25 ? 15 : 30; }
  function frameIntervalMs(emaMs) { return 1000 / targetFps(emaMs); }
  var DILATION = { normal: 1, small: 0.8, mild: 1.15, moderate: 1.35, severe: 1.6 };
  var MOTION = { normal: 1, hypo: 0.4, hypokinetic: 0.4, akinetic: 0.05, dyskinetic: -0.2 };
  /* kardia/pathology geom block to the KARDIA_GEOM pathology shape.
   * Unknown words fall back to normal (factor 1, motion 1) so a new
   * severity word never breaks the image. */
  function pathologyGeom(g) {
    g = g || {};
    var out = {
      wallThicknessScale: g.wallThicknessScale || 1, chamberDilation: {},
      wallMotion: null, effusionMm: g.effusionMm || 0,
      leafletThickeningMm: 0, leafletRestriction: 0,
      vegetation: null, thrombus: null, septalDefect: null
    };
    var cd = g.chamberDilation || {}, key;
    for (key in cd) {
      var up = key.toUpperCase();
      if (up === "LV" || up === "RV" || up === "LA" || up === "RA")
        out.chamberDilation[up] = DILATION[cd[key]] != null ? DILATION[cd[key]] : 1;
    }
    if (g.wallMotion) {
      out.wallMotion = {};
      for (key in g.wallMotion) {
        var w = String(g.wallMotion[key]).toLowerCase();
        out.wallMotion[key] = MOTION[w] != null ? MOTION[w] : 1;
      }
    }
    var leaf = g.leaflet || {};
    for (key in leaf) {
      if (leaf[key].thickening) out.leafletThickeningMm = Math.max(out.leafletThickeningMm, 1.2);
      if (leaf[key].restriction || leaf[key].calcification) out.leafletRestriction = Math.max(out.leafletRestriction, 0.6);
    }
    var def = g.defect || g.septalDefect;
    if (def && def.type) out.septalDefect = { type: String(def.type).toUpperCase(), sizeMm: def.sizeMm || 10 };
    var mass = g.mass;
    if (mass && mass.type === "vegetation") out.vegetation = { valve: "mitral", sizeMm: mass.sizeMm || 10 };
    if (mass && mass.type === "thrombus") out.thrombus = { chamber: "LV", sizeMm: mass.sizeMm || 14 };
    return out;
  }
  /* The clinix-audio kind for a pathology sound block. Falls back to
   * the normal heart sound, never silence by accident. */
  function soundKindFor(condId, sound) {
    var byId = {
      aortic_stenosis: "as_murmur", mitral_regurgitation: "mr_murmur",
      mitral_stenosis: "ms_murmur", aortic_regurgitation: "ar_murmur",
      pericardial_effusion: "pericardial_rub", cardiac_tamponade: "s1s2_normal"
    };
    if (sound && sound.s3) return "s3_gallop";
    if (sound && sound.s4) return "s4_gallop";
    return byId[condId] || "s1s2_normal";
  }
  /* Probe plane -> KARDIA_US probe, mirroring setProbe({viewId}):
   * the plane origin is a point in the heart, not the transducer.
   * The apex (transducer) sits depth*0.42 along +up from that origin;
   * the renderer beams along -up from the apex, so the fan opens
   * straight down from the apex dot and `up` (the display top, with
   * right = normal x up carrying the marker side) is passed through
   * unchanged. Passing pl.origin as the apex put the fan origin in
   * the middle of the heart: only the -up half was ever sampled, so
   * the visible tissue wedge looked rotated and truncated and was
   * never an apical four chamber. */
  /* Backing store for a canvas whose CSS box is (cssW, cssH): both
   * axes scaled by the SAME devicePixelRatio, so the backing aspect
   * always equals the CSS box aspect. Sizing one axis from a fixed
   * constant (the old fixed 640x480) while CSS lays the element out
   * at another aspect stretches the fan non-uniformly: left and
   * right sector edges then make different angles with vertical. */
  function backingSizeForCssBox(cssW, cssH, dpr) {
    var s = (dpr && isFinite(dpr) && dpr > 0) ? dpr : 1;
    if (!(cssW > 0) || !(cssH > 0)) return null;
    return { width: Math.max(1, Math.round(cssW * s)), height: Math.max(1, Math.round(cssH * s)), scale: s };
  }
  /* Resize one canvas to its CSS box times DPR (uniformly). Returns
   * the backing size, or null when the element has no CSS box yet
   * (hidden or detached: the caller retries on mount/resize). A
   * no-op when the backing already matches, so live frames are not
   * cleared by redundant resizes. Layout and drawing both read
   * canvas.width/height afterwards, i.e. one pixel space. */
  function fitCanvasToCssBox(canvas, dpr) {
    if (!canvas) return null;
    var cw = canvas.clientWidth || 0, ch = canvas.clientHeight || 0;
    if ((!cw || !ch) && canvas.getBoundingClientRect) {
      var r = canvas.getBoundingClientRect();
      if (!cw) cw = r.width || 0;
      if (!ch) ch = r.height || 0;
    }
    var size = backingSizeForCssBox(cw, ch, dpr);
    if (!size) return null;
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    return size;
  }
  function probeForPlane(pl, depthMm, viewId) {
    var depth = depthMm || 160;
    var up = pl.up || [0, 0, -1];
    var l = Math.sqrt(up[0] * up[0] + up[1] * up[1] + up[2] * up[2]) || 1;
    var ux = up[0] / l, uy = up[1] / l, uz = up[2] / l, d = depth * 0.42;
    var out = {
      origin: [pl.origin[0] + ux * d, pl.origin[1] + uy * d, pl.origin[2] + uz * d],
      normal: pl.normal ? pl.normal.slice() : [1, 0, 0],
      up: [ux, uy, uz],
      viewOrigin: pl.origin ? pl.origin.slice() : [0, 0, 0]
    };
    /* viewId is filter-only in KARDIA_US when an explicit origin is
     * present: it switches on the renderer's TTE cardiac-window
     * filter (tteAllowed), so atlas meshes outside the window (the
     * arterial/venous/respiratory/digestive chunks Echo Lab loads
     * for context) never paint into the sector the way they do when
     * no viewId was ever passed, as in the standalone renderer. */
    if (viewId) out.viewId = viewId;
    return out;
  }
  function severityHeart(cond, severity) {
    if (!cond || !cond.severities || !cond.severities[severity]) return {};
    return cond.severities[severity].heart || {};
  }
  function severityGeom(cond, severity) {
    if (!cond || !cond.severities || !cond.severities[severity]) return {};
    return cond.severities[severity].geom || {};
  }
  function severitySound(cond, severity) {
    if (!cond || !cond.severities || !cond.severities[severity]) return null;
    return cond.severities[severity].sound || null;
  }
  /* Cine ring buffer: fixed slots, no allocation after create. */
  function createCine(capacity) {
    var slots = [], i;
    for (i = 0; i < capacity; i++) slots.push({ timeMs: 0, cycleTimeMs: 0, used: false });
    var head = 0, count = 0;
    return {
      capacity: capacity,
      push: function (timeMs, cycleTimeMs) {
        var s = slots[head]; s.timeMs = timeMs; s.cycleTimeMs = cycleTimeMs; s.used = true;
        head = (head + 1) % capacity; if (count < capacity) count++;
        return s;
      },
      count: function () { return count; },
      at: function (back) { /* back 0 is the newest frame */
        if (!count) return null;
        var idx = ((head - 1 - back) % capacity + capacity) % capacity;
        return slots[idx];
      },
      clear: function () { head = 0; count = 0; for (var j = 0; j < slots.length; j++) slots[j].used = false; }
    };
  }
  /* Spectrum source adapter for KARDIA_MEASURE (velocityAt takes a
   * pixel row, timeAt a pixel column, per the measure contract). */
  function spectrumSource(spec, widthPx, heightPx) {
    var W = widthPx || 640, H = heightPx || 260;
    var axis = spec.velocityAxisMs || [0, 1], lo = axis[0], hi = axis[axis.length - 1];
    var times = spec.timesMs || [0, 1], dur = (times[times.length - 1] || 1000) / 1000;
    return {
      setSize: function (w, h) { W = w; H = h; return this; },
      velocityAt: function (yPx) { return hi - (yPx / Math.max(1, H)) * (hi - lo); },
      timeAt: function (xPx) { return (xPx / Math.max(1, W)) * dur; },
      velocityToPx: function (v) { return (hi - v) / Math.max(1e-9, hi - lo) * H; },
      timeToPx: function (tSec) { return tSec / Math.max(1e-9, dur) * W; },
      draw: function (ctx, w, h) { if (w) { W = w; H = h; } ctx.fillStyle = "#06090b"; ctx.fillRect(0, 0, W, H); return this; }
    };
  }
  /* Image source adapter for KARDIA_MEASURE on the frozen sector.
   * Draws nothing itself (the frozen canvas sits underneath in the
   * measure stage); it supplies scale and phase frames. */
  function imageSource(opts) {
    opts = opts || {};
    var depthMm = opts.depthMm || 160;
    var src = {
      mmPerPx: depthMm / 400,
      sectorGeometry: { apexX: 320, apexY: 12, depthMm: depthMm, widthMm: depthMm * 1.4 },
      frameAt: function (phase) {
        return { phase: phase, event: phase === "endSystole" ? "AVC" : "QRS",
          cycleTimeMs: opts.cycleTimeMs || 0, timeMs: opts.timeMs || 0, polygons: opts.polygons || [] };
      },
      draw: function (ctx, w, h) {
        src.mmPerPx = depthMm / Math.max(1, h);
        src.sectorGeometry = { apexX: w / 2, apexY: 12, depthMm: depthMm, widthMm: depthMm * 1.4 };
        if (opts.drawFrozen) opts.drawFrozen(ctx, w, h);
        return src;
      }
    };
    return src;
  }

  /* ---------------- controller ----------------
   * ctx: {doc, heart, geom, probe, doppler, views, getView(), knobs,
   * onKnobs(ui), isResidentPlus(), isPractice(), pathologyBase}
   * The host (kardia.js) owns probe, score and chest controls. This
   * controller owns the canvases it is given: sector, overlay, spectrum.
   */
  function create(ctx) {
    var doc = ctx.doc || G.document;
    var heart = ctx.heart, geom = ctx.geom, probe = ctx.probe;
    var us = null, doppler = null, raf = 0, running = false, destroyed = false;
    var suspended = false, lastRenderAt = 0;
    var lastNow = 0, emaMs = 16, scale = 1, frameLog = [];
    var mode = "2d"; /* 2d | colour | pw | cw | mmode */
    var frozen = false, cine = createCine(90), cineBack = 0;
    var colourBox = { x: 0.30, y: 0.18, w: 0.40, h: 0.42 }; /* fractions */
    var gateMm = { x: 0, y: 55 }; /* sample volume in plane mm */
    var mmodeX = 0; /* M-mode cursor, fraction across sector */
    var spec = null, specDirty = true, mStrip = [], pathology = null;
    var realAnatomy = false, loadNote = "";
    var usCanvas = null, lastError = "", lastFrameAt = 0, chunksLoaded = 0;
    var lastUsProbe = null, resizeObs = null, onWinResize = null;
    var els = {};

    function uiKnobs() { return ctx.knobs; }
    var knobCache = { key: "", val: null };
    function usKnobs() {
      var k = uiKnobs();
      var key = k.gain + "|" + k.depth + "|" + k.focus + "|" + k.tgc.join(",") + "|" + k.frequencyMHz + "|" + k.sectorDeg + "|" + k.dynamicRange + "|" + scale;
      if (knobCache.key !== key) { knobCache = { key: key, val: mapKnobs(k, scale) }; }
      return knobCache.val;
    }

    function ensureUS(canvas) {
      /* KARDIA_US.create binds its canvas for life. The host keeps one
       * persistent sector element and re-attaches it after every
       * repaint, so this normally sees the same node for the session.
       * Defence in depth: never create (or keep) a renderer for a
       * detached or zero-size element, and recreate the renderer if
       * the element identity ever does change, so frames can never be
       * drawn off-screen while snapshot() reads that other instance. */
      if (canvas && canvas.isConnected === false) return null;
      if (canvas && (!canvas.width || !canvas.height)) return null;
      if (us && canvas && usCanvas !== canvas) {
        try { if (us.destroy) us.destroy(); } catch (e) {}
        us = null; usCanvas = null;
      }
      if (us || !canvas || !G.KARDIA_US || !geom) return us;
      try { us = G.KARDIA_US.create(canvas, geom, heart); usCanvas = canvas; }
      catch (e) { us = null; usCanvas = null; lastError = "renderer: " + String(e && e.message || e); }
      return us;
    }
    function ensureDoppler() {
      if (doppler || !G.KARDIA_DOPPLER || !heart) return doppler;
      try { doppler = G.KARDIA_DOPPLER.create(heart, {}); } catch (e) { doppler = null; }
      return doppler;
    }

    /* Real anatomy through the same chunk path atlas3d uses: same
     * origin on the web build, R2 natively, Cache API when the model
     * cache is present. Progress is chunks done of total. Any failure
     * keeps the parametric geometry and sets a short note. */
    function loadRealAnatomy(onProgress) {
      if (!geom || !geom.ingestManifest || !G.fetch) { loadNote = "Offline. Showing the model heart."; return Promise.resolve(false); }
      var native = !!(G.Capacitor && G.Capacitor.isNativePlatform && G.Capacitor.isNativePlatform());
      var bases = native ? ["https://models.stewardmd.in/atlas3d"] : ["", "https://models.stewardmd.in/atlas3d"];
      function inflate(buf, rawBytes) {
        if (buf.byteLength === rawBytes) return Promise.resolve(buf);
        var stream = new G.Blob([buf]).stream().pipeThrough(new G.DecompressionStream("gzip"));
        return new G.Response(stream).arrayBuffer();
      }
      function fetchBytes(url) {
        var mc = G.SMD_MODEL_CACHE;
        if (mc && mc.loadModelBytes) return mc.loadModelBytes(url);
        return G.fetch(url).then(function (r) { if (!r.ok) throw new Error("chunk " + r.status); return r.arrayBuffer(); });
      }
      function tryBase(bi) {
        if (bi >= bases.length) throw new Error("anatomy unavailable");
        var base = bases[bi];
        return G.fetch(base + "/atlas/3d/manifest.json").then(function (r) { if (!r.ok) throw new Error("manifest"); return r.json(); }).then(function (m) {
          geom.ingestManifest(m);
          var d = (m.lod && m.lod.chunks && m.lod.chunks.length) ? m.lod : m;
          var wantSys = { cardiac: 1, arterial: 1, venous: 1, skeletal: 1, respiratory: 1, digestive: 1 };
          var chunks = (d.chunks || []).filter(function (c) { return wantSys[c.system] && !c.src; });
          var done = 0;
          if (onProgress) onProgress(0, Math.max(1, chunks.length));
          return chunks.reduce(function (chain, c) {
            return chain.then(function () {
              return fetchBytes(base + c.url).then(function (buf) { return inflate(buf, c.bytes); })
                .then(function (raw) { geom.ingestChunk(c, raw); chunksLoaded++; })
                .catch(function (e) { lastError = "chunk " + (c.id || c.url || "") + ": " + String(e && e.message || e); })
                .then(function () { done++; if (onProgress) onProgress(done, Math.max(1, chunks.length)); });
            });
          }, Promise.resolve()).then(function () { return geom.loadedParts ? geom.loadedParts().length : 0; });
        }).catch(function (e) { return tryBase(bi + 1); });
      }
      return tryBase(0).then(function (n) {
        realAnatomy = n > 0;
        loadNote = realAnatomy ? "" : "Offline. Showing the model heart.";
        /* geom.viewPlane changes once real meshes are in (fitted
         * normal, mesh landmark ranges), so any probe target/window
         * frame cached against the parametric geometry is stale:
         * drop it so the next stateForView re-solves against the
         * same viewPlane the standalone renderer uses. */
        if (realAnatomy && probe) {
          try { if (probe.setGeom) probe.setGeom(geom); else if (probe.setViews && ctx.views) probe.setViews(ctx.views); } catch (e) {}
        }
        return realAnatomy;
      }, function (e) { lastError = "anatomy: " + String(e && e.message || e); loadNote = "Offline. Showing the model heart."; return false; });
    }

    function planeNow() { return probe && probe.plane ? probe.plane() : null; }
    function currentViewId() {
      try { var v = ctx.getView ? ctx.getView() : null; if (v && v.id) return v.id; } catch (e) {}
      return null;
    }

    function drawOverlay() {
      var ov = els.overlay; if (!ov || ov.isConnected === false) return;
      var c = ov.getContext("2d"); if (!c) return;
      var W = ov.width, H = ov.height;
      c.clearRect(0, 0, W, H);
      if (mode === "colour") {
        var bx = colourBox.x * W, by = colourBox.y * H, bw = colourBox.w * W, bh = colourBox.h * H;
        /* Colour field inside the box, sampled on a coarse grid. */
        var d = ensureDoppler(), pl = planeNow();
        if (d && pl) {
          try {
            var nowC = (G.performance && G.performance.now) ? G.performance.now() : 0;
            if (!drawOverlay._field || nowC - (drawOverlay._fieldAt || 0) > 120) {
              drawOverlay._field = d.colourField({ planeOrigin: pl.origin, planeNormal: pl.normal, planeUp: pl.up,
              probePosition: pl.origin, nyquistMs: uiKnobs().colourNyquistMs, nx: 18, ny: 14, widthMm: uiKnobs().depth * 1.2, depthMm: uiKnobs().depth });
              drawOverlay._fieldAt = nowC;
            }
            var field = drawOverlay._field;
            var gainA = clamp(uiKnobs().colourGain / 100, 0, 1);
            field.points.forEach(function (p) {
              if (!p.flow) return;
              var px = bx + (p.xMm / field.widthMm + 0.5) * bw;
              var py = by + (p.yMm / field.depthMm + 0.5) * bh;
              if (px < bx || px > bx + bw || py < by || py > by + bh) return;
              c.fillStyle = "rgba(" + p.colour.r + "," + p.colour.g + "," + p.colour.b + "," + (0.25 + 0.65 * gainA) + ")";
              c.fillRect(px - 5, py - 5, 10, 10);
            });
          } catch (e) {}
        }
        c.strokeStyle = "rgba(238,243,241,0.9)"; c.lineWidth = 1.5;
        c.strokeRect(bx, by, bw, bh);
      }
      if (mode === "pw") {
        var gx = W / 2 + gateMm.x * (W / Math.max(1, uiKnobs().depth * 1.4));
        var gy = 12 + gateMm.y * (H / Math.max(1, uiKnobs().depth));
        c.strokeStyle = "#3ee07a"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(gx - 10, gy); c.lineTo(gx + 10, gy); c.stroke();
        c.beginPath(); c.arc(gx, gy, 4, 0, 6.2832); c.stroke();
      }
      if (mode === "cw") {
        c.strokeStyle = "#3ee07a"; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(W / 2, 8); c.lineTo(W / 2 + mmodeX * W * 0.3, H - 8); c.stroke();
      }
      if (mode === "mmode") {
        var mx = W * (0.5 + mmodeX * 0.6);
        c.strokeStyle = "rgba(238,243,241,0.9)"; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(mx, 8); c.lineTo(mx, H - 8); c.stroke();
      }
      if (frozen) {
        c.fillStyle = "rgba(238,243,241,0.95)"; c.font = "600 13px sans-serif";
        c.fillText("Frozen", 10, 20);
      }
    }

    function refreshSpectrum() {
      var cv = els.spectrum; if (!cv || cv.isConnected === false) return;
      var d = ensureDoppler(); if (!d) return;
      var m = mode === "cw" ? "CW" : "PW";
      var flow = (mode === "cw") ? "aorticJet" : "mitralInflow";
      try {
        spec = d.spectrum({ mode: m, flow: flow, durationMs: 2400, dtMs: 4,
          nyquistMs: mode === "pw" ? uiKnobs().colourNyquistMs * 2 : 0 });
      } catch (e) { spec = null; }
      specDirty = false;
      if (spec && G.KARDIA_DOPPLER) {
        /* drawSpectrum is on the instance, not the module. */
        try { d.drawSpectrum(cv, spec, {}); } catch (e) {}
      }
      if (els.specReadout) {
        if (spec) {
          var peak = 0; (spec.envelopeMs || []).forEach(function (v) { if (Math.abs(v) > peak) peak = Math.abs(v); });
          els.specReadout.textContent = m + " peak " + peak.toFixed(2) + " m/s. Gradient " +
            (4 * peak * peak).toFixed(0) + " mmHg." + (spec.anyAliased ? " Aliasing present." : "");
          api.lastPeakMs = peak;
        } else els.specReadout.textContent = "Spectrum unavailable.";
      }
    }

    function drawMMode() {
      var cv = els.spectrum; if (!cv || cv.isConnected === false) return;
      var c = cv.getContext("2d"); if (!c) return;
      var W = cv.width, H = cv.height;
      c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
      /* Scrolling strip: each column is the brightness along the cursor
       * depth at one time step, approximated from the heart volumes. */
      var st = heart && heart.state ? heart.state() : null;
      var bright = st ? clamp(0.25 + (st.volumes.LV || 100) / 220, 0, 1) : 0.5;
      mStrip.push(bright); if (mStrip.length > W) mStrip.shift();
      for (var x = 0; x < mStrip.length; x++) {
        var g = Math.round(mStrip[x] * 200);
        c.fillStyle = "rgb(" + g + "," + g + "," + g + ")";
        c.fillRect(x, H * 0.25, 1, H * 0.5);
      }
      if (els.specReadout) els.specReadout.textContent = "M-mode. Drag the cursor line on the image.";
    }

    /* Size every owned canvas from its CSS box times DPR, uniformly
     * on both axes, on mount and on resize. KARDIA_US layout and
     * drawing both use canvas.width/height, and the overlay uses its
     * own width/height, so after this all three share one pixel
     * space with the CSS box (no non-uniform stretch of the fan). */
    function resizeCanvases() {
      var dpr = G.devicePixelRatio || 1, out = {};
      ["sector", "overlay", "spectrum"].forEach(function (k) {
        if (els[k]) out[k] = fitCanvasToCssBox(els[k], dpr);
      });
      return out;
    }
    function observeResize() {
      if (onWinResize || resizeObs) return;
      onWinResize = function () { resizeCanvases(); };
      if (G.addEventListener) { try { G.addEventListener("resize", onWinResize); } catch (e) {} }
      if (typeof G.ResizeObserver === "function") {
        try {
          resizeObs = new G.ResizeObserver(function () { resizeCanvases(); });
          ["sector", "overlay", "spectrum"].forEach(function (k) { if (els[k] && resizeObs.observe) resizeObs.observe(els[k]); });
        } catch (e) { resizeObs = null; }
      }
    }

    function frame(now) {
      if (!running || destroyed || suspended) return;
      raf = G.requestAnimationFrame(frame);
      if (doc.hidden) return;
      if (lastRenderAt && now - lastRenderAt < frameIntervalMs(emaMs)) return;
      lastRenderAt = now;
      /* Newest synced pose first: the display message callback only
       * stores the latest pose, so applying it here (not on a timer)
       * bounds rotation-to-display by one capped frame. */
      if (ctx.onFrameStart) { try { ctx.onFrameStart(now); } catch (e) {} }
      var dt = lastNow ? Math.min(50, now - lastNow) : 16;
      lastNow = now;
      var t0 = (G.performance && G.performance.now) ? G.performance.now() : now;
      if (!frozen) {
        if (heart && heart.step) heart.step(dt);
        cine.push(heart && heart.state ? heart.state().timeMs : now, heart && heart.state ? heart.state().cycleTimeMs : 0);
        if (cineBack) cineBack = 0;
      }
      var cv = els.sector;
      if (cv && cv.isConnected === false) cv = null; /* repaint in flight: never draw into a detached canvas */
      if (cv) {
        var r = ensureUS(cv);
        if (r) {
          /* One renderer per canvas: while a KARDIA_US renderer exists
           * it is the sole painter (its own CPU path is the WebGL
           * fallback, already masked to the sector). The schematic
           * fallbackDraw below runs only when no renderer could be
           * created at all, never over or under a live frame. */
          var pl = planeNow();
          if (pl) { lastUsProbe = probeForPlane(pl, uiKnobs().depth, currentViewId()); r.setProbe(lastUsProbe); }
          r.setKnobs(usKnobs());
          var drew = false;
          try { drew = r.frame(now) !== false; } catch (e) { lastError = "frame: " + String(e && e.message || e); }
          if (drew) lastFrameAt = now;
          if (r.stats) { emaMs = emaMs * 0.9 + (r.stats.ms || dt) * 0.1; }
          var want = pickResolutionScale(G.devicePixelRatio || 1, emaMs);
          if (Math.abs(want - scale) > 0.01) scale = want;
        } else if (ctx.fallbackDraw) ctx.fallbackDraw(cv);
      }
      drawOverlay();
      if ((mode === "pw" || mode === "cw") && specDirty) refreshSpectrum();
      if (mode === "mmode" && !frozen) drawMMode();
      if (els.fps) els.fps.textContent = "Frame " + emaMs.toFixed(1) + " ms. Target 30 fps.";
      frameLog.push(emaMs); if (frameLog.length > 120) frameLog.shift();
    }

    function start() {
      if (running || destroyed || suspended) return;
      running = true; lastNow = 0; lastRenderAt = 0;
      raf = G.requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf) { try { G.cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
    }
    /* Probe mode: no ultrasound at all. Stop the rAF loop and release
     * the renderer (including its WebGL context) so the main thread is
     * free for DeviceOrientation, sends and PONG replies. The renderer
     * is recreated on the same canvas by resume(). */
    function suspend() {
      suspended = true; stop();
      if (us) {
        try { if (us._loseContext) us._loseContext(); } catch (e) {}
        try { if (us.destroy) us.destroy(); } catch (e) {}
        us = null; usCanvas = null;
      }
      return api;
    }
    function resume() {
      if (!suspended) return api;
      suspended = false; lastRenderAt = 0; lastNow = 0;
      if (!destroyed && els.sector) start();
      return api;
    }
    function onVis() { if (doc.hidden) stop(); else if (!destroyed && !suspended && els.sector) start(); }
    if (doc.addEventListener) doc.addEventListener("visibilitychange", onVis);

    /* Drag handling for the colour box, PW gate and M cursor. The
     * overlay canvas is pointer-events:none (so the sector canvas is
     * the hit-tested element at the sector centre), so drags are heard
     * on the sector canvas itself; its rect is the overlay's rect. */
    function bindOverlay() {
      var ov = els.sector || els.overlay; if (!ov || ov._kelBound || !ov.addEventListener) return;
      ov._kelBound = true;
      var drag = null;
      function pt(e) { var r = ov.getBoundingClientRect(); return { x: (e.clientX - r.left) / Math.max(1, r.width), y: (e.clientY - r.top) / Math.max(1, r.height) }; }
      ov.addEventListener("pointerdown", function (e) {
        var p = pt(e); drag = p;
        try { ov.setPointerCapture(e.pointerId); } catch (err) {}
        move(p);
      });
      ov.addEventListener("pointermove", function (e) { if (drag) move(pt(e)); });
      ov.addEventListener("pointerup", function () { drag = null; });
      ov.addEventListener("pointercancel", function () { drag = null; });
      function move(p) {
        if (mode === "colour") {
          colourBox.x = clamp(p.x - colourBox.w / 2, 0, 1 - colourBox.w);
          colourBox.y = clamp(p.y - colourBox.h / 2, 0, 1 - colourBox.h);
        } else if (mode === "pw") {
          gateMm.x = (p.x - 0.5) * uiKnobs().depth * 1.4;
          gateMm.y = clamp(p.y, 0, 1) * uiKnobs().depth;
          specDirty = true;
        } else if (mode === "cw") { mmodeX = clamp((p.x - 0.5) * 2, -1, 1); specDirty = true; }
        else if (mode === "mmode") mmodeX = clamp((p.x - 0.5) / 0.6, -0.8, 0.8);
        drawOverlay();
      }
    }

    var api = {
      lastPeakMs: 0,
      mount: function (sector, overlay, spectrum, extra) {
        els.sector = sector; els.overlay = overlay || null; els.spectrum = spectrum || null;
        extra = extra || {};
        els.specReadout = extra.specReadout || null; els.fps = extra.fps || null;
        resizeCanvases(); observeResize();
        if (!suspended) ensureUS(sector);
        bindOverlay(); if (!suspended) start();
        return api;
      },
      setMode: function (m) {
        mode = m; specDirty = true; mStrip = [];
        if (els.spectrum) els.spectrum.hidden = !(m === "pw" || m === "cw" || m === "mmode");
        resizeCanvases();
        if (m === "pw" || m === "cw") refreshSpectrum();
        drawOverlay(); return api;
      },
      getMode: function () { return mode; },
      setFrozen: function (f) {
        frozen = !!f;
        if (!frozen) cineBack = 0;
        drawOverlay(); return api;
      },
      isFrozen: function () { return frozen; },
      setCineBack: function (n) { cineBack = clamp(n, 0, Math.max(0, cine.count() - 1)); return cine.at(cineBack); },
      cineCount: function () { return cine.count(); },
      getSpectrum: function () { if (specDirty) refreshSpectrum(); return spec; },
      spectrumSource: function () {
        if (!spec) refreshSpectrum();
        return spec ? spectrumSource(spec, els.spectrum ? els.spectrum.width : 640, els.spectrum ? els.spectrum.height : 260) : null;
      },
      imageSource: function () {
        return imageSource({ depthMm: uiKnobs().depth,
          cycleTimeMs: heart && heart.state ? heart.state().cycleTimeMs : 0,
          timeMs: heart && heart.state ? heart.state().timeMs : 0,
          drawFrozen: function (c, w, h) { c.fillStyle = "#06090b"; c.fillRect(0, 0, w, h); } });
      },
      applyPathology: function (cond, severity) {
        pathology = { id: cond ? cond.id : null, severity: severity };
        if (heart && heart.setParams && cond) heart.setParams(severityHeart(cond, severity));
        if (geom && geom.setPathology && cond) geom.setPathology(pathologyGeom(severityGeom(cond, severity)));
        specDirty = true;
        return api;
      },
      getPathology: function () { return pathology; },
      soundKind: function (cond) {
        if (!cond || !pathology) return "s1s2_normal";
        var sev = pathology.severity;
        var s = severitySound(cond, sev);
        return soundKindFor(cond.id, s);
      },
      loadRealAnatomy: loadRealAnatomy,
      isRealAnatomy: function () { return realAnatomy; },
      loadNote: function () { return loadNote; },
      resizeCanvases: resizeCanvases,
      /* One-call diagnostic bundle for the browser runner: canvas
       * backing vs CSS box, DPR, the sector layout Echo Lab computed,
       * the probe state, the plane passed to KARDIA_US, the target
       * viewPlane and the A4C cut polygons (for projected anatomy
       * sampling in the runner). */
      diagnostics: function (viewId) {
        var cv = els.sector, pl = null, usProbe = null, vp = null, cut = null, targetVp = null;
        try { pl = planeNow(); } catch (e) {}
        var vid = viewId || (ctx.getView ? (ctx.getView() || {}).id : null) || "tte_a4c";
        try { usProbe = pl ? probeForPlane(pl, uiKnobs().depth, vid) : lastUsProbe; } catch (e) {}
        /* The cut and viewPlane must describe the plane actually
         * rendered (the current probe plane), not a fresh
         * geom.viewPlane(vid): viewPlane re-solves its offset from
         * the beating geometry on every call, so a bundle fetched
         * after the canvas was saved cuts a different slice from
         * the one in the pixels and projected cavity points land on
         * walls. The re-solved target is kept as targetViewPlane
         * for comparison only. */
        try { targetVp = geom && geom.viewPlane ? geom.viewPlane(vid) : null; } catch (e) {}
        if (pl && pl.origin && pl.normal && pl.up) vp = { origin: pl.origin.slice(), normal: pl.normal.slice(), up: pl.up.slice(), viewId: vid };
        else vp = targetVp;
        try {
          if (vp && geom && geom.cut) {
            var nn = vp.normal, ll = Math.sqrt(nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]) || 1;
            cut = geom.cut(vp.origin, [nn[0] / ll, nn[1] / ll, nn[2] / ll], vp.up, 272, 272);
          }
        } catch (e) {}
        var lay = null;
        try { lay = (G.KARDIA_US && G.KARDIA_US._pure && cv) ? G.KARDIA_US._pure.layoutFor(cv.width, cv.height, usKnobs()) : null; } catch (e) {}
        return {
          canvasWidth: cv ? cv.width : null, canvasHeight: cv ? cv.height : null,
          clientWidth: cv ? (cv.clientWidth || 0) : null, clientHeight: cv ? (cv.clientHeight || 0) : null,
          devicePixelRatio: G.devicePixelRatio || 1,
          layout: lay, knobs: usKnobs(),
          probeState: probe && probe.getState ? probe.getState() : null,
          plane: pl, usProbe: usProbe, lastUsProbe: lastUsProbe,
          viewId: vid, viewPlane: vp, targetViewPlane: targetVp, cut: cut,
          rendererMode: us && us.stats ? us.stats.mode : null
        };
      },
      frameMs: function () { return emaMs; },
      stats: function () { return us ? us.stats : null; },
      debug: function () {
        var parts = 0;
        try { parts = geom && geom.loadedParts ? geom.loadedParts().length : 0; } catch (e) {}
        return {
          rendererCreated: !!us,
          rendererMode: us && us.stats ? us.stats.mode : null,
          rendererOnCurrentCanvas: !!us && !!els.sector && usCanvas === els.sector,
          sectorConnected: !!els.sector && els.sector.isConnected !== false,
          sectorSize: els.sector ? [els.sector.width || 0, els.sector.height || 0] : null,
          canvasWidth: els.sector ? els.sector.width : null, canvasHeight: els.sector ? els.sector.height : null,
          clientWidth: els.sector ? (els.sector.clientWidth || 0) : null, clientHeight: els.sector ? (els.sector.clientHeight || 0) : null,
          devicePixelRatio: G.devicePixelRatio || 1,
          rendererErrors: us && us.errors ? us.errors.slice(0, 3) : [],
          geometryMode: realAnatomy || parts > 0 ? "real" : "parametric",
          chunksLoaded: chunksLoaded,
          loadedParts: parts,
          lastFrameAt: lastFrameAt,
          lastFrameMs: emaMs,
          frames: us && us.stats ? us.stats.frames : 0,
          running: running, suspended: suspended, targetFps: targetFps(emaMs), frozen: frozen, mode: mode,
          lastError: lastError || (us && us.errors && us.errors.length ? String(us.errors[us.errors.length - 1]) : "")
        };
      },
      snapshot: function () {
        if (!us && els.sector) ensureUS(els.sector);
        return us && us.snapshot ? us.snapshot() : null;
      },
      start: start, stop: stop, suspend: suspend, resume: resume,
      isSuspended: function () { return suspended; },
      destroy: function () {
        destroyed = true; suspended = false; stop();
        if (resizeObs) { try { resizeObs.disconnect(); } catch (e) {} resizeObs = null; }
        if (onWinResize && G.removeEventListener) { try { G.removeEventListener("resize", onWinResize); } catch (e) {} onWinResize = null; }
        if (doc.removeEventListener) doc.removeEventListener("visibilitychange", onVis);
        if (us && us.destroy) { try { us.destroy(); } catch (e) {} }
        us = null; usCanvas = null;
      }
    };
    return api;
  }

  var API = {
    create: create, DEFAULT_UI_KNOBS: cloneKnobs(null),
    _pure: {
      clamp: clamp, cloneKnobs: cloneKnobs, mapKnobs: mapKnobs,
      pickResolutionScale: pickResolutionScale, targetFps: targetFps, frameIntervalMs: frameIntervalMs, pathologyGeom: pathologyGeom,
      soundKindFor: soundKindFor, severityHeart: severityHeart,
      severityGeom: severityGeom, severitySound: severitySound,
      createCine: createCine, spectrumSource: spectrumSource, imageSource: imageSource,
      probeForPlane: probeForPlane, backingSizeForCssBox: backingSizeForCssBox, fitCanvasToCssBox: fitCanvasToCssBox
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_ECHOLAB = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

