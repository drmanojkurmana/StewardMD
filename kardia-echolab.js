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
 * Real cine (with kardia-clips.js): when the probe holds quality at
 * least 85 inside tolerance for 0.5 s and a clip exists for the view
 * (and the active pathology and severity, falling back to the view),
 * the sector crossfades (300 ms, opacity only, instant under reduced
 * motion) to the real patient clip, masked to the same sector fan and
 * depth, looping muted. Leaving the target crossfades back. States:
 * loading (clip preloading, simulation stays, no note), ready (clip
 * can show at target), empty (no clip for this view, simulation only
 * and no extra chrome), offline or error (simulation stays, one plain
 * line says the real clip needs a connection, shown once), Doppler or
 * frozen (simulation stays, one line says why when Real is chosen).
 * The Simulated and Real switch and the Real patient attribution
 * label are real buttons, 44 px tall; long attributions wrap.
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
  /* M-mode column: brightness by depth (0 near, 1 far) for one instant.
   * The septum and posterior wall are bright lines either side of a
   * dark cavity; their separation follows the LV volume, so the strip
   * opens in diastole and closes in systole. Speckle is deterministic
   * per depth and seed (the time column), never a flat band. */
  function mmodeColumn(lvMl, seed) {
    var lv = typeof lvMl === "number" && isFinite(lvMl) ? lvMl : 100;
    var half = clamp(0.10 + lv / 900, 0.16, 0.30);
    var centre = 0.52, sept = centre - half, post = centre + half;
    var col = [], j;
    for (j = 0; j < 56; j++) {
      var y = j / 55, v;
      var dS = Math.abs(y - sept), dP = Math.abs(y - post);
      var sp = Math.sin((j + 1) * 12.9898 + (seed || 0) * 0.37) * 43758.5453; sp -= Math.floor(sp);
      if (y > sept + 0.015 && y < post - 0.015) v = 0.04 + 0.05 * sp;
      else if (dS < 0.02 || dP < 0.02) v = 0.92;
      else if (Math.abs(y - (post + 0.07)) < 0.015) v = 0.98;
      else v = 0.30 + 0.22 * sp;
      if (y < 0.08) v = 0.18 + 0.15 * sp;
      col.push(Math.round(clamp(v, 0, 1) * 255));
    }
    return col;
  }
  function mmodeLabels(depthMm) {
    var d = depthMm || 160;
    return { title: "M-mode", depthText: "Depth " + d + " mm",
      ticks: [0, 0.25, 0.5, 0.75, 1].map(function (f) {
        return { fraction: f, label: Math.round(d * f / 10) + " cm" };
      }),
      sweepText: "Sweep 25 mm/s" };
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

  /* At-target state machine for real cine. Enter needs quality at
   * least enterScore, inside tolerance, held for dwellMs; exit needs
   * quality below exitScore (or leaving tolerance). The gap between
   * the two scores is the hysteresis band: hovering at the tolerance
   * edge changes nothing, so the image cannot flicker. Pure and
   * clock-injected so it is unit tested without a browser. */
  function createRealCine(opts) {
    opts = opts || {};
    var enterScore = opts.enterScore != null ? opts.enterScore : 85;
    var exitScore = opts.exitScore != null ? opts.exitScore : 80;
    var dwellMs = opts.dwellMs != null ? opts.dwellMs : 500;
    var state = "sim", since = null;
    return {
      enterScore: enterScore, exitScore: exitScore, dwellMs: dwellMs,
      state: function () { return state; },
      reset: function () { state = "sim"; since = null; return state; },
      update: function (input, nowMs) {
        input = input || {};
        var score = typeof input.score === "number" ? input.score : -1;
        var inside = input.withinTolerance !== false;
        var now = typeof nowMs === "number" ? nowMs : 0;
        if (state === "real") {
          if (!inside || score < exitScore) { state = "sim"; since = null; }
          return state;
        }
        if (inside && score >= enterScore) {
          if (since == null) since = now;
          if (now - since >= dwellMs) { state = "real"; since = null; }
        } else since = null;
        return state;
      }
    };
  }
  /* CSS clip-path polygon for the sector fan over a (w, h) box, using
   * the KARDIA_US layout: apex centred near the top, radius filling
   * the height, half-angle sectorDeg/2 about the straight-down beam.
   * The real clip is fitted to the same box, so this mask gives it
   * the same sector shape and depth as the simulated sector. */
  /* Every real clip is zoomed by this factor inside the fixed sector
   * mask, so the clip's own fan edges, depth ticks and labels fall
   * outside the mask and never show. 1.45 pushes the widest shipped
   * fan (about 82 percent of frame width at the far arc) beyond the
   * fixed 80 degree sector at every depth below the near field. */
  var REAL_CLIP_ZOOM = 1.45;
  function sectorClipPolygon(w, h, sectorDeg) {
    if (!(w > 0) || !(h > 0)) return "";
    /* Fixed sector, same geometry as the simulated and degraded
     * images: sector occupies the top 87 percent of the box (the ECG
     * strip takes the rest), apex centred near the top, radius to
     * the sector bottom. Never the clip's own fan. */
    var sectorH = Math.round(h * 0.87);
    var apexX = w / 2, apexY = Math.min(sectorH - 8, Math.round(sectorH * 0.02) + 4);
    if (apexY < 0) apexY = 0;
    var radius = sectorH - apexY, half = ((sectorDeg || 80) / 2) * Math.PI / 180;
    function pt(x, y) { return (Math.round(x / w * 1000) / 10) + "% " + (Math.round(y / h * 1000) / 10) + "%"; }
    var pts = [pt(apexX, apexY)], steps = 16, i, a;
    for (i = 0; i <= steps; i++) {
      a = -half + (2 * half * i) / steps;
      pts.push(pt(apexX + Math.sin(a) * radius, apexY + Math.cos(a) * radius));
    }
    return "polygon(" + pts.join(", ") + ")";
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
    /* Real cine: preference defaults to Real (the controller only
     * ever shows it at target with a clip); the state machine, the
     * chosen clip and its playable src are per view and pathology. */
    var realCine = createRealCine({}), realPref = "real", realKey = null, realClip = null,
      realSrc = "", realStatus = "idle", realShowing = false, realScoreAt = 0,
      realOfflineSaid = false, realEls = null;

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

    /* ---------- real cine ---------- */
    function isProbeDevice() {
      if (suspended) return true;
      try {
        var s = G.KARDIA_SYNC;
        if (s && s.core && s.core.role === "probe") return true;
        var sp = G.KARDIA_SYNCPROBE;
        if (sp && sp.isProbeRenderSuspended && sp.isProbeRenderSuspended()) return true;
      } catch (e) {}
      return false;
    }
    function reducedMotion() {
      try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
    }
    var REAL_CSS =
      ".krd-root .kel-real-mask{position:absolute;inset:0;overflow:hidden;pointer-events:none;}" +
      ".krd-root .kel-real-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;opacity:0;pointer-events:none;transform:scale(1.45);transform-origin:50% 46%;transition:opacity 300ms var(--kd-ease);}" +
      ".krd-root .kel-real-video.kel-real-on{opacity:1;}" +
      ".krd-root .kel-real-bar{margin-top:8px;}" +
      ".krd-root .kel-real-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}" +
      ".krd-root .kel-real-switch{display:flex;gap:6px;}" +
      ".krd-root .kel-real-btn,.krd-root .kel-real-label{min-height:44px;padding:10px 14px;border:1px solid var(--sp-line);border-radius:10px;background:var(--sp-s1);color:var(--sp-text);font-size:14px;font-weight:650;touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;transition:transform 120ms var(--kd-ease),background-color 140ms var(--kd-ease);}" +
      ".krd-root .kel-real-btn:active,.krd-root .kel-real-label:active{transform:scale(0.97);}" +
      ".krd-root .kel-real-btn[aria-pressed=\"true\"]{background:var(--sp-acc);color:var(--sp-on-pri);border-color:var(--sp-acc);}" +
      ".krd-root .kel-real-btn:focus-visible,.krd-root .kel-real-label:focus-visible{outline:2px solid var(--sp-acc);outline-offset:2px;}" +
      ".krd-root .kel-real-credit{margin:8px 0 0;font-size:12px;line-height:1.55;color:var(--sp-mut);overflow-wrap:break-word;}" +
      ".krd-root .kel-real-credit a{color:var(--sp-link);}" +
      ".krd-root .kel-real-note{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--sp-mut);overflow-wrap:break-word;}" +
      "@media (prefers-reduced-motion: reduce){.krd-root .kel-real-video{transition:none;}.krd-root .kel-real-btn:active,.krd-root .kel-real-label:active{transform:none;}}";
    function ensureRealEls() {
      if (realEls || !doc || !doc.createElement) return realEls;
      if (!doc.getElementById || !doc.getElementById("kelRealStyle")) {
        var st = doc.createElement("style"); st.id = "kelRealStyle"; st.textContent = REAL_CSS;
        (doc.head || doc.documentElement || doc.body).appendChild(st);
      }
      var mask = doc.createElement("div");
      mask.id = "krdRealMask"; mask.className = "kel-real-mask";
      var video = doc.createElement("video");
      video.id = "krdRealVideo"; video.className = "kel-real-video";
      video.muted = true; video.loop = true; video.setAttribute("playsinline", "");
      video.setAttribute("preload", "auto"); video.setAttribute("aria-label", "Real patient cine");
      mask.appendChild(video);
      var bar = doc.createElement("div"); bar.id = "krdRealBar"; bar.className = "kel-real-bar"; bar.hidden = true;
      bar.innerHTML =
        '<div class="kel-real-row"><div class="kel-real-switch" role="group" aria-label="Image source">' +
        '<button type="button" class="kel-real-btn" id="krdRealSim" data-kel-real="simulated" aria-pressed="false">Simulated</button>' +
        '<button type="button" class="kel-real-btn" id="krdRealReal" data-kel-real="real" aria-pressed="true">Real</button></div>' +
        '<button type="button" class="kel-real-label" id="krdRealLabel" aria-expanded="false">Real patient</button></div>' +
        '<p class="kel-real-credit" id="krdRealCredit" hidden></p>' +
        '<p class="kel-real-note" id="krdRealNote" role="status"></p>';
      realEls = { video: video, mask: mask, bar: bar,
        simBtn: bar.querySelector("#krdRealSim"), realBtn: bar.querySelector("#krdRealReal"),
        label: bar.querySelector("#krdRealLabel"), credit: bar.querySelector("#krdRealCredit"),
        note: bar.querySelector("#krdRealNote") };
      realEls.simBtn.addEventListener("click", function () { setRealPref("simulated"); });
      realEls.realBtn.addEventListener("click", function () { setRealPref("real"); });
      realEls.label.addEventListener("click", function () {
        var open = realEls.credit.hidden;
        realEls.credit.hidden = !open;
        realEls.label.setAttribute("aria-expanded", String(open));
      });
      video.addEventListener("error", function () { onRealClipFailed(); });
      return realEls;
    }
    function attachRealEls() {
      var r = ensureRealEls(); if (!r || !els.sector) return;
      var slot = els.sector.parentNode; if (!slot) return;
      if (r.mask.parentNode !== slot) slot.appendChild(r.mask);
      var stack = slot, parent = stack.parentNode;
      if (parent && r.bar.parentNode !== parent) parent.insertBefore(r.bar, stack.nextSibling);
      fitRealVideo();
    }
    function fitRealVideo() {
      if (!realEls || !els.sector) return;
      var w = els.sector.clientWidth || els.sector.width || 0, h = els.sector.clientHeight || els.sector.height || 0;
      var poly = sectorClipPolygon(w, h, uiKnobs().sectorDeg);
      if (poly) {
        realEls.video.style.clipPath = poly; realEls.video.style.webkitClipPath = poly;
        if (realEls.mask) { realEls.mask.style.clipPath = poly; realEls.mask.style.webkitClipPath = poly; }
      }
      if (reducedMotion()) realEls.video.style.transition = "none";
    }
    function realQuery() {
      var vid = currentViewId();
      if (!vid) return null;
      return { view: vid, pathology: pathology ? pathology.id : null, severity: pathology ? pathology.severity : null };
    }
    function resolveRealClip(key, query) {
      realStatus = "loading"; realClip = null; realSrc = "";
      var api = null;
      try { api = G.KARDIA_CLIPS; } catch (e) {}
      if (!api || !api.preloadFor) { realStatus = "empty"; refreshRealUi(); return; }
      api.preloadFor(query).then(function (res) {
        if (destroyed || realKey !== key) return;
        if (!res || !res.clip) { realStatus = "empty"; realClip = null; refreshRealUi(); return; }
        realClip = res.clip; realSrc = res.src || "";
        realStatus = "ready"; realOfflineSaid = false;
        if (realEls && realSrc && realEls.video.getAttribute("src") !== realSrc) realEls.video.setAttribute("src", realSrc);
        refreshRealUi();
      }, function () {
        if (destroyed || realKey !== key) return;
        realStatus = "offline"; realClip = null;
        refreshRealUi();
      });
    }
    function onRealClipFailed() {
      if (!realSrc) return;
      realStatus = "offline"; setRealShowing(false); refreshRealUi();
    }
    function setRealPref(p) {
      realPref = p === "simulated" ? "simulated" : "real";
      refreshRealUi();
    }
    function setRealShowing(on) {
      if (!realEls) return;
      var want = !!on;
      if (want === realShowing && realEls.video.classList.contains("kel-real-on") === want) return;
      realShowing = want;
      if (want) {
        fitRealVideo();
        if (realSrc && realEls.video.getAttribute("src") !== realSrc) realEls.video.setAttribute("src", realSrc);
        realEls.video.classList.add("kel-real-on");
        var pr = realEls.video.play && realEls.video.play();
        if (pr && pr.catch) pr.catch(function () {});
      } else {
        realEls.video.classList.remove("kel-real-on");
        try { realEls.video.pause(); } catch (e) {}
      }
    }
    function refreshRealUi() {
      if (!realEls) return;
      var hasClip = realStatus === "ready" && !!realClip;
      realEls.bar.hidden = !(hasClip || realStatus === "offline");
      realEls.simBtn.setAttribute("aria-pressed", String(realPref === "simulated"));
      realEls.realBtn.setAttribute("aria-pressed", String(realPref === "real"));
      if (hasClip && refreshRealUi._clip !== realClip) {
        refreshRealUi._clip = realClip;
        var attr = "";
        try { attr = G.KARDIA_CLIPS._pure.attributionLine(realClip); } catch (e) {}
        realEls.label.textContent = "Real patient: " + (realClip.title || "clip");
        realEls.credit.innerHTML = "";
        realEls.credit.textContent = attr;
        if (realClip.licenceUrl) {
          realEls.credit.appendChild(doc.createTextNode(" "));
          var a = doc.createElement("a");
          a.href = realClip.licenceUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.textContent = realClip.licence || "licence";
          realEls.credit.appendChild(a);
        }
      }
      var note = "";
      if (realStatus === "offline" && !realOfflineSaid) {
        note = "The real patient clip needs a connection. Showing the simulated image.";
        realOfflineSaid = true;
      } else if (realStatus === "offline") {
        note = "The real patient clip needs a connection. Showing the simulated image.";
      } else if (hasClip && realPref === "real" && mode !== "2d") {
        note = "Doppler uses the simulated image. Switch to 2D at the target to see the real patient clip.";
      } else if (hasClip && realPref === "real" && frozen) {
        note = "Measurements use the simulated image.";
      }
      var noteText = hasClip || realStatus === "offline" ? note : "";
      if (refreshRealUi._note !== noteText) { refreshRealUi._note = noteText; realEls.note.textContent = noteText; }
      var show = hasClip && realPref === "real" && mode === "2d" && !frozen &&
        realCine.state() === "real" && !isProbeDevice();
      setRealShowing(show);
    }
    /* Called from the frame loop: detects a newly chosen view (the
     * preload trigger), scores the probe at a throttled rate, and
     * drives the state machine. Never runs on the probe device. */
    function updateRealCine(now) {
      if (!realEls || destroyed || suspended) return;
      if (isProbeDevice()) { setRealShowing(false); return; }
      var q = realQuery();
      var key = q ? (q.view + "|" + (q.pathology || "") + "|" + (q.severity || "")) : null;
      if (key !== realKey) {
        realKey = key; realCine.reset(); setRealShowing(false);
        if (q) resolveRealClip(key, q); else { realStatus = "idle"; }
        refreshRealUi();
      }
      if (!q || now - realScoreAt < 150) { refreshRealUi(); return; }
      realScoreAt = now;
      var score = null;
      try {
        var v = ctx.getView ? ctx.getView() : null;
        if (probe && probe.score && v) score = probe.score(v, { noCut: true });
      } catch (e) {}
      if (score) realCine.update({ score: score.score, withinTolerance: score.withinTolerance }, now);
      refreshRealUi();
    }
    function realCineDebug() {
      return { state: realCine.state(), pref: realPref, status: realStatus, showing: realShowing,
        clip: realClip ? (realClip.file || realClip.title || "") : null, key: realKey };
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
              probePosition: pl.origin, nyquistMs: uiKnobs().colourNyquistMs, nx: 36, ny: 28, widthMm: uiKnobs().depth * 1.2, depthMm: uiKnobs().depth });
              drawOverlay._fieldAt = nowC;
            }
            var field = drawOverlay._field;
            var gainA = clamp(uiKnobs().colourGain / 100, 0, 1);
            var cellW = bw / Math.max(1, field.nx - 1) + 1.5, cellH = bh / Math.max(1, field.ny - 1) + 1.5;
            field.points.forEach(function (p) {
              if (!p.flow) return;
              var px = bx + (p.xMm / field.widthMm + 0.5) * bw;
              var py = by + (p.yMm / field.depthMm + 0.5) * bh;
              if (px < bx || px > bx + bw || py < by || py > by + bh) return;
              c.fillStyle = "rgba(" + p.colour.r + "," + p.colour.g + "," + p.colour.b + "," + (0.25 + 0.65 * gainA) + ")";
              c.fillRect(px - cellW / 2, py - cellH / 2, cellW, cellH);
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
      if (mode === "colour") {
        /* Colour bar at the right edge of the sector: red toward at the
         * top, blue away at the bottom, with the Nyquist limits. */
        var nyqC = uiKnobs().colourNyquistMs || 0.6;
        var barX = W - 30, barY = 18, barH = Math.max(40, H - 56), barW = 10, seg;
        var stops = null;
        try { stops = G.KARDIA_DOPPLER && G.KARDIA_DOPPLER.colourBarStops ? G.KARDIA_DOPPLER.colourBarStops(nyqC) : null; } catch (e) {}
        if (stops) stops.stops.forEach(function (s) {
          c.fillStyle = "rgb(" + s.r + "," + s.g + "," + s.b + ")";
          c.fillRect(barX, barY + s.fraction * barH, barW, Math.ceil(barH / stops.stops.length) + 1);
        });
        else for (seg = 0; seg < 16; seg++) {
          var vv = nyqC - 2 * nyqC * seg / 16;
          var cc = G.KARDIA_DOPPLER && G.KARDIA_DOPPLER.velocityColour ? G.KARDIA_DOPPLER.velocityColour(vv, 0, nyqC) : { r: 180, g: 40, b: 40 };
          c.fillStyle = "rgb(" + cc.r + "," + cc.g + "," + cc.b + ")";
          c.fillRect(barX, barY + seg / 16 * barH, barW, Math.ceil(barH / 16) + 1);
        }
        c.strokeStyle = "rgba(238,243,241,0.8)"; c.lineWidth = 1; c.strokeRect(barX, barY, barW, barH);
        c.fillStyle = "#eef3f1"; c.font = "600 9px 'Inter Variable', system-ui, sans-serif";
        c.fillText("+" + nyqC.toFixed(2), Math.max(0, barX - 2), barY - 5);
        c.fillText("0", barX + 2, barY + barH / 2 + 3);
        c.fillText("-" + nyqC.toFixed(2), Math.max(0, barX - 2), barY + barH + 12);
        c.fillText("m/s", Math.max(0, barX - 2), barY + barH + 23);
      }
      if (frozen) {
        c.fillStyle = "rgba(6,9,11,0.85)"; c.fillRect(8, 8, 70, 22);
        c.strokeStyle = "#ffc05a"; c.lineWidth = 1.5; c.strokeRect(8, 8, 70, 22);
        c.fillStyle = "#ffc05a"; c.font = "600 12px 'Inter Variable', system-ui, sans-serif";
        c.fillText("Frozen", 16, 23);
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
          var lab2 = G.KARDIA_DOPPLER && G.KARDIA_DOPPLER.spectralLabels ? G.KARDIA_DOPPLER.spectralLabels(spec) : null;
          els.specReadout.textContent = (lab2 ? lab2.title + ", " + lab2.site + ". " : "") + "Peak " + peak.toFixed(2) + " m/s. Gradient " +
            (4 * peak * peak).toFixed(0) + " mmHg." + (spec.anyAliased ? " Aliasing present." : "");
          api.lastPeakMs = peak;
        } else els.specReadout.textContent = "Spectrum unavailable.";
      }
    }

    var mEcg = [];
    function drawMMode() {
      var cv = els.spectrum; if (!cv || cv.isConnected === false) return;
      var c = cv.getContext("2d"); if (!c) return;
      var W = cv.width, H = cv.height;
      c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
      var st = heart && heart.state ? heart.state() : null;
      var lv = st && st.volumes ? (st.volumes.LV || 100) : 100;
      if (!frozen) {
        mStrip.push(mmodeColumn(lv, mStrip.length + 1));
        var d2 = ensureDoppler();
        mEcg.push(d2 && d2.ecgSample && st ? d2.ecgSample(st.cycleTimeMs || 0) : 0);
        var maxCols = Math.max(40, W - 44);
        while (mStrip.length > maxCols) { mStrip.shift(); mEcg.shift(); }
      }
      var axisW = 36, topH = 22, ecgH = 26;
      var plotW = Math.max(10, W - axisW), plotH = Math.max(10, H - topH - ecgH - 6);
      var cols = mStrip.length, rows = cols ? mStrip[0].length : 56, x, y;
      if (cols && typeof c.createImageData === "function" && typeof c.putImageData === "function") {
        var img = c.createImageData(plotW, plotH), data = img.data, px, py;
        for (py = 0; py < plotH; py++) for (px = 0; px < plotW; px++) {
          var ci = clamp(Math.floor(px / Math.max(1, plotW) * cols), 0, cols - 1);
          var ri = clamp(Math.floor(py / Math.max(1, plotH) * rows), 0, rows - 1);
          var gv = mStrip[ci][ri], off = (py * plotW + px) * 4;
          data[off] = gv; data[off + 1] = gv; data[off + 2] = gv; data[off + 3] = 255;
        }
        c.putImageData(img, axisW, topH);
      } else if (cols) {
        var cw2 = plotW / cols, ch2 = plotH / rows;
        for (x = 0; x < cols; x++) for (y = 0; y < rows; y++) {
          var g3 = mStrip[x][y];
          c.fillStyle = "rgb(" + g3 + "," + g3 + "," + g3 + ")";
          c.fillRect(axisW + x * cw2, topH + y * ch2, Math.max(1, cw2), Math.max(1, ch2));
        }
      }
      var lab = mmodeLabels(uiKnobs().depth);
      c.fillStyle = "#eef3f1"; c.font = "600 11px 'Inter Variable', system-ui, sans-serif";
      c.fillText(lab.title + "  " + lab.sweepText, axisW + 4, 14);
      c.fillStyle = "#a3adb3"; c.font = "10px 'Inter Variable', system-ui, sans-serif";
      lab.ticks.forEach(function (t) {
        var ty = topH + t.fraction * plotH;
        c.fillText(t.label, 2, ty + 3);
        c.strokeStyle = "rgba(163,173,179,0.3)"; c.beginPath(); c.moveTo(axisW - 4, ty); c.lineTo(axisW, ty); c.stroke();
      });
      var ecgTop = topH + plotH + 4;
      c.strokeStyle = "#3ee07a"; c.beginPath();
      for (x = 0; x < mEcg.length; x++) {
        var ex = axisW + (cols > 1 ? x / (cols - 1) * plotW : 0);
        var ey = ecgTop + ecgH * 0.62 - mEcg[x] * ecgH * 0.5;
        if (x === 0) c.moveTo(ex, ey); else c.lineTo(ex, ey);
      }
      c.stroke();
      c.fillStyle = "#3ee07a"; c.fillText("ECG", 4, H - 4);
      if (frozen) {
        c.fillStyle = "rgba(6,9,11,0.85)"; c.fillRect(axisW + 6, topH + 6, 62, 20);
        c.strokeStyle = "#ffc05a"; c.strokeRect(axisW + 6, topH + 6, 62, 20);
        c.fillStyle = "#ffc05a"; c.font = "600 11px 'Inter Variable', system-ui, sans-serif"; c.fillText("Frozen", axisW + 14, topH + 20);
      }
      if (els.specReadout) els.specReadout.textContent = "M-mode through the mitral valve. Drag the cursor line on the 2D image above.";
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
      fitRealVideo();
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
      updateRealCine(now);
      if ((mode === "pw" || mode === "cw") && !frozen && now - (frame._specAt || 0) > 200) { specDirty = true; frame._specAt = now; }
      if ((mode === "pw" || mode === "cw") && specDirty) refreshSpectrum();
      if (mode === "mmode") drawMMode();
      if (els.fps) els.fps.textContent = "";
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
      setRealShowing(false);
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
        attachRealEls();
        bindOverlay(); if (!suspended) start();
        return api;
      },
      setMode: function (m) {
        mode = m; specDirty = true; mStrip = []; mEcg = [];
        if (els.spectrum) els.spectrum.hidden = !(m === "pw" || m === "cw" || m === "mmode");
        resizeCanvases();
        if (m === "pw" || m === "cw") refreshSpectrum();
        drawOverlay(); refreshRealUi(); return api;
      },
      getMode: function () { return mode; },
      setRealPref: function (p) { setRealPref(p); return api; },
      getRealPref: function () { return realPref; },
      realCine: realCineDebug,
      setFrozen: function (f) {
        frozen = !!f;
        if (!frozen) cineBack = 0;
        drawOverlay(); refreshRealUi(); return api;
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
        realKey = null;
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
        setRealShowing(false);
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
      createCine: createCine, createRealCine: createRealCine, sectorClipPolygon: sectorClipPolygon, realClipZoom: REAL_CLIP_ZOOM, spectrumSource: spectrumSource, imageSource: imageSource,
      mmodeColumn: mmodeColumn, mmodeLabels: mmodeLabels,
      probeForPlane: probeForPlane, backingSizeForCssBox: backingSizeForCssBox, fitCanvasToCssBox: fitCanvasToCssBox
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_ECHOLAB = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

