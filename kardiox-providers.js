/* kardiox-providers.js — KardioX AI · provider seam + deterministic mock (SMD_KARDIOX_PROVIDERS).
 *
 * Mirrors FundX's injectable-global pattern. Screens/controllers talk ONLY to providers; providers are
 * the only layer touching network/disk/image processing. Two assemblies:
 *   mockProviders()   — deterministic, offline; drives previews + the whole test suite + M2 build.
 *   liveProviders(s)  — wraps StewardMD networking + secure storage + real backend (built in M3/M5).
 * Default active assembly is the mock (real backend does not exist yet — see README M5).
 *
 * SM-2 flashcard scheduling uses the design's exact fresh-card intervals: Again <1m · Hard 6m · Good
 * 1d · Easy 4d. Pure enough to test (grade() takes an optional `nowMs`). node + browser.
 */
(function () {
  "use strict";

  function M() { return (typeof window !== "undefined" && window.SMD_KARDIOX_MODELS) || (typeof require !== "undefined" ? require("./kardiox-models.js") : null); }
  var DAY = 86400000, MIN = 1 / 1440;

  // ── Mock analyzer: stream the 13 stages, then resolve the canonical AF-with-RVR analysis. ──
  function mockAnalyzer() {
    var models = M();
    return {
      kind: "mock",
      analyze: function (image, onStage) {
        var stages = (models && models.ANALYSIS_STAGES) || [];
        return new Promise(function (resolve) {
          var i = 0;
          function step() {
            if (i < stages.length) {
              var pct = Math.round(((i + 1) / stages.length) * 100);
              try { if (typeof onStage === "function") onStage(stages[i], pct); } catch (e) {}
              i++;
              // Fast but visible staging; deterministic order. setTimeout keeps the UI responsive.
              (typeof setTimeout === "function" ? setTimeout(step, 8) : step());
            } else {
              var a = models.makeAnalysis(models.samples.afWithRvr);
              if (image && image.id) a.image = image;
              resolve(a);
            }
          }
          step();
        });
      }
    };
  }

  // ── Mock image processor: no-op enhance/digitize (real work is backend; client is preview/fallback). ──
  function mockImageProcessor() {
    return {
      enhance: function (img) { return Promise.resolve(img); },
      digitize: function (img) { return Promise.resolve({ leads: 12, calibration: { mmPerS: 25, mmPerMv: 10 }, traces: [] }); }
    };
  }

  // ── Mock ECG store: in-memory (the ENCRYPTED on-device store is M3). CRUD + search + timeline. ──
  function mockEcgStore(seed) {
    var mem = {};
    (seed || []).forEach(function (a) { if (a && a.id) mem[a.id] = a; });
    function list() { return Object.keys(mem).map(function (k) { return mem[k]; }); }
    return {
      save: function (a) { if (a && a.id) mem[a.id] = a; return Promise.resolve(); },
      all: function () { return Promise.resolve(list()); },
      timeline: function () { return Promise.resolve(list().slice().sort(function (x, y) { return String(x.createdAt).localeCompare(String(y.createdAt)); })); },
      get: function (id) { return Promise.resolve(mem[id] || null); },
      delete: function (id) { delete mem[id]; return Promise.resolve(); },
      deleteAll: function () { mem = {}; return Promise.resolve(); },
      search: function (q) { q = String(q || "").toLowerCase(); return Promise.resolve(list().filter(function (a) { return (a.verdict || "").toLowerCase().indexOf(q) >= 0 || String(a.createdAt || "").toLowerCase().indexOf(q) >= 0; })); }
    };
  }

  // ── Mock library: categories + sample lessons (the full 100 ECGs are authored in M4). ──
  function mockLibrary(content) {
    var ecgs = content || [];
    var byId = {}; ecgs.forEach(function (e) { byId[e.id] = e; });
    function cats() { var m = {}; ecgs.forEach(function (e) { m[e.category] = (m[e.category] || 0) + 1; }); return Object.keys(m).map(function (c) { return { name: c, count: m[c] }; }); }
    return {
      categories: function () { return Promise.resolve(cats()); },
      ecgs: function (cat) { return Promise.resolve(ecgs.filter(function (e) { return !cat || e.category === (cat && cat.name || cat); })); },
      ecg: function (id) { return Promise.resolve(byId[id] || null); },
      search: function (q) { q = String(q || "").toLowerCase(); return Promise.resolve(ecgs.filter(function (e) { return (e.title || "").toLowerCase().indexOf(q) >= 0 || (e.category || "").toLowerCase().indexOf(q) >= 0 || (e.ecgFindingTags || []).join(" ").toLowerCase().indexOf(q) >= 0; })); },
      bookmarks: function () { return Promise.resolve(ecgs.filter(function (e) { return e.bookmarked; }).map(function (e) { return e.id; })); },
      toggleBookmark: function (id) { if (byId[id]) byId[id].bookmarked = !byId[id].bookmarked; return Promise.resolve(); }
    };
  }

  // ── SM-2 scheduling (pure). Fresh-card intervals match the design. ──
  function sm2(card, grade, nowMs) {
    card = card || {}; nowMs = nowMs || (typeof Date !== "undefined" ? Date.now() : 0);
    var ef = card.easeFactor || 2.5, reps = card.repetitions || 0, ivl = card.intervalDays || 0;
    if (grade === "again") { reps = 0; ivl = MIN; ef = Math.max(1.3, ef - 0.2); }
    else if (grade === "hard") { reps += 1; ivl = reps <= 1 ? MIN * 6 : Math.max(ivl * 1.2, 1); ef = Math.max(1.3, ef - 0.15); }
    else if (grade === "good") { reps += 1; ivl = reps <= 1 ? 1 : Math.round(ivl * ef); }
    else if (grade === "easy") { reps += 1; ivl = reps <= 1 ? 4 : Math.round(ivl * ef * 1.3); ef = ef + 0.15; }
    else { return card; }
    return { id: card.id, front: card.front, back: card.back, easeFactor: Math.round(ef * 100) / 100, intervalDays: ivl, repetitions: reps, dueDate: new Date(nowMs + ivl * DAY).toISOString() };
  }

  // ── Mock learning engine: SM-2 + daily challenge + progress + achievements. ──
  function mockLearning(deps) {
    deps = deps || {}; var cards = deps.cards || [], lib = deps.library || [];
    return {
      dueFlashcards: function (nowMs) { nowMs = nowMs || Date.now(); return Promise.resolve(cards.filter(function (c) { return !c.dueDate || Date.parse(c.dueDate) <= nowMs; })); },
      grade: function (cardId, grade, nowMs) { var c = cards.filter(function (x) { return x.id === cardId; })[0]; if (c) { var u = sm2(c, grade, nowMs); Object.keys(u).forEach(function (k) { c[k] = u[k]; }); } return Promise.resolve(); },
      dailyChallenge: function (date) { if (!lib.length) return Promise.resolve(null); var d = date ? new Date(date) : new Date(); var key = d.getUTCFullYear() * 372 + (d.getUTCMonth() + 1) * 31 + d.getUTCDate(); return Promise.resolve(lib[key % lib.length]); },
      progress: function () { var mastered = lib.filter(function (e) { return e.status === "mastered"; }).length; return Promise.resolve({ mastered: mastered, total: 100, streakDays: 12, weeklyDone: [true, true, true, false, false, false, false], weakestTopic: { name: "AV blocks", accuracyPct: 40, recommendedCards: 6 } }); },
      achievements: function () { return Promise.resolve([{ id: "first10", title: "First 10", icon: "trophy", unlocked: true }, { id: "streak10", title: "10-day streak", icon: "local_fire_department", unlocked: true }, { id: "stemi20", title: "STEMI x20", icon: "bolt", unlocked: false }]); }
    };
  }

  function mockProviders(opts) {
    opts = opts || {};
    return {
      kind: "mock",
      analyzer: mockAnalyzer(),
      imageProcessor: mockImageProcessor(),
      ecgStore: mockEcgStore(opts.seedAnalyses),
      library: mockLibrary(opts.content),
      learning: mockLearning({ cards: opts.cards, library: opts.content })
    };
  }

  // ── Backend activation (health-gated). When smd_kardiox_backend is on AND the pipeline health check
  //    passed, the analyzer is the RemoteAnalyzer (kardiox-net.js → /api/kardiox); otherwise the
  //    on-device mock. Everything else (store/library/learning) stays local + offline regardless. ──
  var _backendHealthy = false;
  function backendFlag() { try { return !!(typeof window !== "undefined" && window.SMD_KARDIOX_FLAGS && window.SMD_KARDIOX_FLAGS.bool("smd_kardiox_backend")); } catch (e) { return false; } }
  // The native (Capacitor) app calls the deployed KardioX backend DIRECTLY — its local www has no
  // same-origin /api proxy — via the zero-storage direct-upload endpoint. The web build keeps the
  // same-origin Cloudflare edge proxy (which holds any server-side auth).
  function isNative() { try { return !!(typeof window !== "undefined" && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } }
  var KX_BACKEND_URL = "https://kardiox-pipeline-yislqrddsq-uc.a.run.app";
  var KX_BACKEND_TOKEN = "fa63300e91a3d835de701a006b997e17a10f26da9c8390f2";  // beta device-test secret; rotate / move to the edge before any public release
  var KX_IMAGE_URL = "https://kardiox-image-911280405587.asia-south1.run.app";  // end-to-end IMAGE model — INDIA (Mumbai/asia-south1) for DPDP data residency
  function backendBase() { return isNative() ? KX_BACKEND_URL : "/api/kardiox"; }
  // ── Model Lab (beta): allowed users (server-side admin allow-list) get the candidate 19-class model
  // shown ALONGSIDE production (variant=compare) as a labelled experimental second opinion — production
  // stays the authoritative reading. Access is checked once on open; never a full swap. ──
  var _modelLabAllowed = false;
  function modelLabFlag() { try { return !!(window.SMD_KARDIOX_FLAGS && SMD_KARDIOX_FLAGS.bool("smd_kardiox_modellab")); } catch (e) { return false; } }
  function modelLabOn() { return isNative() && _modelLabAllowed && modelLabFlag(); }
  function checkModelLab() {
    if (!isNative() || typeof fetch !== "function") { _modelLabAllowed = false; return Promise.resolve(false); }
    var uid = "", email = "";
    try { uid = localStorage.getItem("smd_device_id") || ""; } catch (e) {}
    try { email = (window.SMD_ME && window.SMD_ME.email) || (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.email) || ""; } catch (e) {}
    var q = "?uid=" + encodeURIComponent(uid) + "&email=" + encodeURIComponent(email);
    return fetch(KX_IMAGE_URL + "/v1/model-lab/status" + q).then(function (r) { return r.json(); })
      .then(function (j) { _modelLabAllowed = !!(j && j.allowed); _active = null; return _modelLabAllowed; })
      .catch(function () { _modelLabAllowed = false; return false; });
  }
  // END-TO-END IMAGE analyzer: POST the photo straight to the kardiox-image Cloud Run service (ResNet-18
  // reads the ECG image, no digitiser). Native-only (direct HTTPS + no CORS). Flag smd_kardiox_image.
  function imageFlag() { try { return !!(typeof window !== "undefined" && window.SMD_KARDIOX_FLAGS && window.SMD_KARDIOX_FLAGS.bool("smd_kardiox_image")); } catch (e) { return false; } }
  function imageAnalyzer() {
    try {
      if (!isNative() || typeof window === "undefined" || !window.SMD_KARDIOX_NET || !window.SMD_KARDIOX_NET.remoteAnalyzer) return null;
      var r = window.SMD_KARDIOX_NET.remoteAnalyzer({ baseUrl: KX_IMAGE_URL, path: "/v1/ecg/analyze-image" + (modelLabOn() ? "?variant=compare" : "") });
      // Stash the analysed image so the data-flywheel (kardiox-feedback.js) can attach it to a label.
      return { kind: "image", analyze: function (image, onStage) {
        try { if (image && image.data instanceof Blob) window.SMD_KARDIOX_LASTIMAGE = image.data; } catch (e) {}
        return r.analyze(image, onStage);
      } };
    } catch (e) { return null; }
  }
  // ── ON-DEVICE image model (ONNX Runtime Web): runs the 19-class + MI-any ENTIRELY on the phone —
  // the ECG photo NEVER leaves the device (DPDP: no PHI upload). Same fusion/verdict as the cloud
  // (kardiox-ort-image.js, validated). Flag smd_kardiox_ondevice_image (default OFF until device-tested);
  // the cloud image analyzer stays the fallback. ──
  function ondeviceImageFlag() { try { return !!(window.SMD_KARDIOX_FLAGS && SMD_KARDIOX_FLAGS.bool("smd_kardiox_ondevice_image")); } catch (e) { return false; } }
  function ondeviceImageAnalyzer() {
    try {
      if (!isNative() || typeof window === "undefined" || !window.SMD_KARDIOX_ORT_IMAGE) return null;
      return { kind: "ondevice-image", analyze: function (image, onStage) {
        try { if (image && image.data instanceof Blob) window.SMD_KARDIOX_LASTIMAGE = image.data; } catch (e) {}
        return window.SMD_KARDIOX_ORT_IMAGE.analyzeImage(image, onStage);
      } };
    } catch (e) { return null; }
  }
  function remoteAnalyzer() {
    try {
      if (typeof window !== "undefined" && window.SMD_KARDIOX_NET && window.SMD_KARDIOX_NET.remoteAnalyzer) {
        var cfg = isNative()
          ? { baseUrl: KX_BACKEND_URL, path: "/v1/ecg/analyze-upload", token: KX_BACKEND_TOKEN }
          : { baseUrl: "/api/kardiox", path: "/v1/ecg/analyze" };
        var r = window.SMD_KARDIOX_NET.remoteAnalyzer(cfg);
        return { kind: "remote", analyze: r.analyze };
      }
    } catch (e) {}
    return null;
  }
  // On-device REAL inference: the EcgLib 7-head ONNX ensemble via ONNX Runtime Web (kardiox-ort.js),
  // feeding the Evidence Fusion Engine (kardiox-fusion.js). Two entry points:
  //   • native + the model pack downloaded (checkModels() → _ondeviceReady): sessions load from the
  //     model-manager's cached bytes, ort-web is lazy-loaded — no server, no PHI upload.
  //   • dev/verification: a global `window.ort` already present → load from the local kardiox-models dir.
  // NOTE: the ensemble needs a 12-lead SIGNAL. The image→signal digitiser is still server-side, so a
  // PHOTO still routes to the backend until the on-device digitiser ships (then this handles photos too).
  var _ondeviceReady = false;
  function modelMgr() { return (typeof window !== "undefined" && window.SMD_KARDIOX_MODELMGR) || null; }
  function digitizer() { return (typeof window !== "undefined" && window.SMD_KARDIOX_DIGITIZE) || null; }
  function ortAnalyzer() {
    try {
      if (typeof window === "undefined" || !window.SMD_KARDIOX_ORT) return null;
      var mgr = modelMgr(), base = null;
      if (mgr && _ondeviceReady) base = window.SMD_KARDIOX_ORT.makeOrtAnalyzer({ modelManager: mgr, ortBase: "/vendor/onnxruntime-web" });
      else if (window.ort) base = window.SMD_KARDIOX_ORT.makeOrtAnalyzer({ baseUrl: "kardiox-models" });
      if (!base) return null;
      var DIG = digitizer();
      // Photos are digitised ON-DEVICE (kardiox-digitize.js) → reconstruction layer → analyzePaper
      // (full 12x1 → ensemble; partial → honest deferral). A pre-digitised signal skips straight to the
      // ensemble. Without a digitiser or blob, base.analyze() raises needs_signal (never fabricates).
      // Never let on-device inference hang the UI: race every run against a timeout (ort-web WASM on a
      // true 12x1 can be slow; a stall must surface as a typed error, not a frozen "100%" screen).
      function withTimeout(p, ms) {
        return new Promise(function (resolve, reject) {
          var done = false, t = setTimeout(function () { if (!done) { var e = new Error("On-device analysis timed out — the model may be too slow on this device."); e.code = "ondevice_timeout"; e.stage = "analysis"; reject(e); } }, ms);
          Promise.resolve(p).then(function (v) { done = true; clearTimeout(t); resolve(v); }, function (er) { done = true; clearTimeout(t); reject(er); });
        });
      }
      return {
        kind: "ondevice",
        analyze: function (image, onStage) {
          var run;
          if (image && image.signal) run = base.analyze(image, onStage);
          else {
            var blob = image && (image.data || ((typeof Blob !== "undefined" && image instanceof Blob) ? image : null));
            run = (DIG && blob) ? Promise.resolve(DIG.digitize(blob)).then(function (dig) { return base.analyzePaper(Object.assign({ id: image && image.id }, dig), onStage); })
              : base.analyze(image, onStage);
          }
          return withTimeout(run, 60000);
        }
      };
    } catch (e) {}
    return null;
  }
  function ortActive() { return !!ortAnalyzer(); }
  function ondeviceInstalled() { return _ondeviceReady; }
  function ondeviceFlag() { try { return !!(typeof window !== "undefined" && window.SMD_KARDIOX_FLAGS && window.SMD_KARDIOX_FLAGS.bool("smd_kardiox_ondevice")); } catch (e) { return false; } }
  // Prefer on-device (offline, no PHI upload) ONLY when the user opted in (flag) AND the full offline path
  // exists: pack installed + the on-device digitiser loaded. Else the backend stays the photo path.
  function ondevicePreferred() { return ondeviceFlag() && _ondeviceReady && !!digitizer() && !!ortAnalyzer(); }

  // Build the on-device ORT analyzer purely to reach analyzePaper() (reconstruction → ensemble/deferral).
  // Constructed whenever the model manager exists (native) or a global `ort` is present; the ONNX ensemble
  // loads lazily only on the full-12x1 path, so the 3x4 rhythm+axis path works WITHOUT the analysis pack.
  function ortPaperBase() {
    try {
      var O = (typeof window !== "undefined") && window.SMD_KARDIOX_ORT;
      if (!O || !O.makeOrtAnalyzer) return null;
      var mgr = modelMgr();
      if (mgr) return O.makeOrtAnalyzer({ modelManager: mgr, ortBase: "/vendor/onnxruntime-web" });
      if (window.ort) return O.makeOrtAnalyzer({ baseUrl: "kardiox-models" });
    } catch (e) {}
    return null;
  }
  function paperTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var done = false, t = setTimeout(function () { if (!done) { var e = new Error("On-device analysis timed out."); e.code = "ondevice_timeout"; e.stage = "analysis"; reject(e); } }, ms);
      Promise.resolve(p).then(function (v) { done = true; clearTimeout(t); resolve(v); }, function (er) { done = true; clearTimeout(t); reject(er); });
    });
  }

  // LEARNED on-device digitiser (nnU-Net via Core ML native plugin) → full offline photo → diagnosis.
  // Downloads the .mlpackage on first use, segments on the Neural Engine, RECONSTRUCTS per-lead signals
  // (kardiox-digitize-learned.segmentToDigitized) and feeds the SAME reconstruction→analyzePaper path:
  //   • 12x1 full-disclosure → the real 12-lead ensemble (rate/rhythm/conduction/…);
  //   • 3x4 (+rhythm strip)  → clean rate/rhythm from the continuous lead-II strip + gain-independent axis
  //                            (ensemble deferred — 2.5s cells can't feed a 10s-trained model; honest).
  // If a diagnosable signal can't be reconstructed (too few leads / no strip / ensemble pack absent for a
  // 12x1) it falls back to the honest segmentation card. Flag smd_kardiox_learned.
  function learnedFlag() { try { return !!(typeof window !== "undefined" && window.SMD_KARDIOX_FLAGS && window.SMD_KARDIOX_FLAGS.bool("smd_kardiox_learned")); } catch (e) { return false; } }
  function learnedAnalyzer() {
    if (typeof window === "undefined") return null;
    var LEARNED = window.SMD_KARDIOX_DIGITIZE_LEARNED;
    if (!isNative() || !LEARNED || !LEARNED.available()) return null;
    return {
      kind: "learned",
      analyze: function (image, onStage) {
        var stage = function (n, p) { try { if (onStage) onStage(n, p); } catch (e) {} };
        var blob = image && (image.data || ((typeof Blob !== "undefined" && image instanceof Blob) ? image : null));
        if (!blob) { var e = new Error("no image for on-device digitiser"); e.code = "needs_signal"; return Promise.reject(e); }
        stage("digitization", 15);
        // download the model to Documents on first use (118 MB, one time), then segment
        try { console.log("KXDBG learned.analyze start; blob?", !!blob); } catch (_) {}
        return LEARNED.prepare().then(function (prep) {
          try { console.log("KXDBG prepared:", prep && prep.ready, prep && prep.path); } catch (_) {}
          stage("digitization", 45);
          return LEARNED.segmentBlob(blob, prep && prep.path);
        }).then(function (seg) {
          try { console.log("KXDBG segmented: W", seg && seg.W, "H", seg && seg.H, "len", seg && seg.labelMap && seg.labelMap.length); } catch (_) {}
          stage("signalExtraction", 65);
          var sum = LEARNED.summarize(LEARNED.labelMapToLeadTraces(seg.labelMap, seg.W, seg.H));
          try { console.log("KXDBG summarize:", sum.leadsDetected, "leads; strip?", sum.hasRhythmStrip); } catch (_) {}
          // honest fallback: the model segmented leads but a diagnosable signal couldn't be rebuilt.
          function segCard() {
            stage("report", 100);
            var models = M(), raw = {
              id: (image && image.id) ? String(image.id) : "",
              reportMode: "segmentation",
              segmentation: { detected: sum.leadsDetected, total: 12, leads: sum.leads, hasRhythmStrip: sum.hasRhythmStrip },
              verdict: "On-device digitiser: " + sum.leadsDetected + "/12 leads segmented",
              severity: "info", confidence: 0, engine: "ecg-digitiser-coreml",
              measurements: { ventRateBpm: null, rhythm: "-", prMs: null, qrsMs: null, qtcMs: null, axisDeg: null },
              findings: [], differentials: [],
              clinicalInterpretation: "The LEARNED on-device digitiser (nnU-Net ECG-Digitiser via Core ML, Neural Engine) segmented " +
                sum.leadsDetected + " of 12 leads" + (sum.hasRhythmStrip ? " including a full-width rhythm strip" : "") +
                (sum.leads.length ? " (" + sum.leads.join(", ") + ")" : "") + ", but a diagnosable signal could not be reconstructed from this image (too few clean leads / no continuous rhythm strip). Retake with all leads flat and fully in frame.",
              whatToVerify: "Confirm the model found the leads present in this ECG's layout. Not a diagnosis.",
              schemaVersion: "1.0"
            };
            return models ? models.makeAnalysis(raw) : raw;
          }
          var digitized = null;
          try { digitized = LEARNED.segmentToDigitized(seg.labelMap, seg.W, seg.H); } catch (e2) { try { console.log("KXDBG segmentToDigitized threw:", e2 && e2.message); } catch (_) {} }
          var base = ortPaperBase();
          try { console.log("KXDBG digitized:", digitized ? (digitized.layout + " / " + Object.keys(digitized.leads).length + " leads / rhythm=" + digitized.rhythmLead) : "null", "| base?", !!base); } catch (_) {}
          if (digitized && base && base.analyzePaper) {
            digitized.id = (image && image.id) ? String(image.id) : "";
            return paperTimeout(base.analyzePaper(digitized, onStage), 60000).then(function (a) {
              try { console.log("KXDBG analyzePaper OK:", a && a.verdict); } catch (_) {}
              try { a.segmentation = { detected: sum.leadsDetected, total: 12, leads: sum.leads, hasRhythmStrip: sum.hasRhythmStrip }; } catch (e3) {}
              return a;
            }).catch(function (ap) { try { console.log("KXDBG analyzePaper FAILED → segCard:", ap && ap.code, "|", ap && ap.stage, "|", ap && ap.message); } catch (_) {} return segCard(); });
          }
          try { console.log("KXDBG → segCard (no digitized or no base)"); } catch (_) {}
          return segCard();
        });
      }
    };
  }
  // Async: is the analysis pack cached on-device? Sets _ondeviceReady + forces the assembly to rebuild.
  function checkModels() {
    var mgr = modelMgr();
    if (!mgr) { _ondeviceReady = false; return Promise.resolve(false); }
    return Promise.resolve(mgr.installed("diagnosis")).then(function (yes) {
      _ondeviceReady = !!yes; _active = null; return _ondeviceReady;
    }).catch(function () { _ondeviceReady = false; return false; });
  }

  function useRemote() { return backendFlag() && _backendHealthy && !!remoteAnalyzer(); }
  function demoFlag() { try { return !!(typeof window !== "undefined" && window.SMD_KARDIOX_FLAGS && window.SMD_KARDIOX_FLAGS.bool("smd_kardiox_demo")); } catch (e) { return false; } }

  // Honest "no real engine configured" analyzer. The mock used to be a SILENT fallback that fabricated a
  // fixed "Atrial fibrillation" on every ECG; instead, when neither the backend nor the on-device ONNX
  // runtime is available, surface a typed error the report screen renders as "AI inference unavailable".
  function unavailableAnalyzer() {
    return {
      kind: "unavailable",
      analyze: function (image, onStage) {
        try { if (typeof onStage === "function") onStage("upload", 100); } catch (e) {}
        var err = new Error("Real ECG inference is not available on this build: no on-device ONNX runtime/weights are bundled and the analysis backend is unreachable. Deploy the backend (smd_kardiox_backend) or bundle the on-device runtime, or enable demo mode (smd_kardiox_demo) to preview the UI with a sample.");
        err.code = "inference_unavailable"; err.stage = "analysis";
        return Promise.reject(err);
      }
    };
  }

  // Analyzer selection for the Analyze button. DEMO flag -> deterministic mock (explicit demo ONLY).
  // Otherwise the REAL pipeline: RemoteAnalyzer when the backend is healthy, else the on-device ONNX
  // ensemble (ortAnalyzer) when the runtime+weights are present. If no real engine is available, the
  // honest "unavailable" analyzer — the mock is NEVER a silent fallback (it faked a fixed AFib).
  function chooseAnalyzer(opts) {
    if (demoFlag()) return mockAnalyzer();
    if (ondeviceImageFlag()) { var od = ondeviceImageAnalyzer(); if (od) return od; }   // ON-DEVICE image model — no PHI leaves the phone (DPDP)
    if (imageFlag()) { var ima = imageAnalyzer(); if (ima) return ima; }    // end-to-end image model (PoC photo→dx)
    if (learnedFlag()) { var la = learnedAnalyzer(); if (la) return la; }   // learned-digitiser validation stage
    if (ondevicePreferred()) return ortAnalyzer();     // full offline photo→dx (opt-in + pack installed)
    var real = ((opts.remote || useRemote()) && remoteAnalyzer()) || ortAnalyzer();
    return real || unavailableAnalyzer();
  }
  // Ping /api/kardiox/v1/health; on success flip to the remote analyzer (rebuild the active assembly).
  function checkBackend() {
    if (!backendFlag() || typeof fetch !== "function") { _backendHealthy = false; return Promise.resolve(false); }
    return fetch(backendBase() + "/v1/health").then(function (r) { return r && r.ok; }).then(function (ok) {
      _backendHealthy = !!ok; _active = null; return _backendHealthy;    // force rebuild with the chosen analyzer
    }).catch(function () { _backendHealthy = false; return false; });
  }

  // Live assembly: ENCRYPTED on-device store (M3) + bundled 100-ECG content (M4) + a health-gated analyzer
  // (RemoteAnalyzer when the backend is live, else the deterministic on-device mock). Always functional.
  function liveProviders(opts) {
    opts = opts || {};
    var C = (typeof window !== "undefined") ? window.SMD_KARDIOX_CONTENT : null;
    var content = opts.content || (C && C.ecgs) || [];
    var cards = opts.cards || (C && C.flashcards ? C.flashcards() : []);
    var store = (typeof window !== "undefined" && window.SMD_KARDIOX_STORE && window.SMD_KARDIOX_STORE.create)
      ? window.SMD_KARDIOX_STORE.create() : mockEcgStore(opts.seedAnalyses);
    var analyzer = chooseAnalyzer(opts);   // REAL pipeline (remote/on-device); mock ONLY in explicit demo mode
    return {
      kind: "live",
      analyzer: analyzer,
      imageProcessor: mockImageProcessor(),
      ecgStore: store,                          // encrypted, on-device
      library: mockLibrary(content),            // bundled 100-ECG content (M4)
      learning: mockLearning({ cards: cards, library: content })
    };
  }

  var _active = null;
  function current() { if (!_active) _active = liveProviders(); return _active; }
  function use(assembly) { _active = assembly; return _active; }

  var API = { mockProviders: mockProviders, liveProviders: liveProviders, current: current, use: use, sm2: sm2,
              checkBackend: checkBackend, backendActive: useRemote, ortActive: ortActive,
              checkModels: checkModels, ondeviceInstalled: ondeviceInstalled,
              checkModelLab: checkModelLab, modelLabOn: modelLabOn };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_PROVIDERS = API;
})();
