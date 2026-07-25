/* thorex-providers.js — ThoreX CXR AI · provider seam + deterministic mock (SMD_THOREX_PROVIDERS).
 *
 * Cloned from kardiox-providers.js. Screens talk ONLY to providers; providers are the only layer
 * touching network/disk. Assemblies:
 *   mockProviders() — deterministic, offline; drives previews + the test suite.
 *   liveProviders() — chooseAnalyzer() picks, in order: explicit demo (smd_thorex_demo) -> the
 *                      on-device ONNX engine (smd_thorex_ondevice + thorex-ort.js ready, OD-C; fully
 *                      offline, no upload) -> health-gated RemoteAnalyzer (thorex-net.js -> /api/thorex)
 *                      -> the honest "unavailable" analyzer. Mock is NEVER a silent fallback.
 *
 * Entitlement shaping (mirrors backend/thorex/README.md "Entitlement → engines returned"):
 *   free   -> hosted HF engine only (hf_vit), educational:false
 *   v1     -> primary detector only (torchxrayvision), educational:false
 *   v2beta -> torchxrayvision (clinical) + xraydar (educational:true, disclaimer educational_not_clinical)
 * The mock/remote never elevate/fabricate beyond what the entitlement is allowed — same rule as the
 * real backend and thorex-net.js's RemoteAnalyzer (client sends entitlement verbatim; never self-
 * elevates). OD-D: the on-device analyzer now follows the same rule symmetrically — v2beta runs BOTH
 * engines on-device (thorex-ort.js's analyzeImage(image, {includeEducational:true})), v1/free run the
 * clinical engine only. thorex-ort.js isolates an educational-engine failure (log + clinical-only
 * result); only a clinical-engine failure surfaces as an `inference_unavailable` rejection here.
 * node + browser.
 */
(function () {
  "use strict";

  function M() { return (typeof window !== "undefined" && window.SMD_THOREX_MODELS) || (typeof require !== "undefined" ? require("./thorex-models.js") : null); }

  // ── Canonical per-entitlement engine bodies (deterministic; used only by the mock analyzer). ──
  function hfVitEngine() {
    return {
      engine: "hf_vit", educational: false,
      findings: [{ label: "No acute cardiopulmonary abnormality", band: null, severity: "info", relevance: "screening" }],
      disclaimer_key: null
    };
  }
  function torchxrayvisionEngine() {
    return {
      engine: "torchxrayvision", educational: false,
      findings: [
        { label: "Right lower lobe consolidation", band: "High", severity: "urgent", relevance: "diagnostic" },
        { label: "Air bronchogram", band: "Medium", severity: "warn", relevance: "supportive" }
      ],
      disclaimer_key: null
    };
  }
  function xraydarEngine() {
    return {
      engine: "xraydar", educational: true,
      findings: [{ label: "Bilateral lower lobe interstitial opacities", band: "Medium", severity: "warn", relevance: "educational" }],
      disclaimer_key: "educational_not_clinical"
    };
  }
  // Entitlement -> ordered engine list (free -> 1 engine; v1 -> 1 engine; v2beta -> 2 engines).
  function enginesFor(entitlement) {
    if (entitlement === "v2beta") return [torchxrayvisionEngine(), xraydarEngine()];
    if (entitlement === "v1") return [torchxrayvisionEngine()];
    return [hfVitEngine()];   // "free" and any unrecognized value fall back to the free-tier engine
  }

  var ANALYSIS_STAGES = ["upload", "quality", "digitization", "signalExtraction", "analysis", "report"];

  // ── Mock analyzer: stream stages, then resolve makeAnalysis() shaped by entitlement. ──
  function mockAnalyzer() {
    return {
      kind: "mock",
      analyze: function (image, entitlement, onStage) {
        var models = M();
        return new Promise(function (resolve) {
          var i = 0;
          function step() {
            if (i < ANALYSIS_STAGES.length) {
              var pct = Math.round(((i + 1) / ANALYSIS_STAGES.length) * 100);
              try { if (typeof onStage === "function") onStage(ANALYSIS_STAGES[i], pct); } catch (e) {}
              i++;
              (typeof setTimeout === "function" ? setTimeout(step, 8) : step());
            } else {
              var raw = {
                id: (image && image.id) ? String(image.id) : undefined,
                quality: { view: "PA upright", adequate: true, issues: [] },
                engines: enginesFor(entitlement),
                disclaimer_key: "clinical_assist_disclaimer"
              };
              var a = models ? models.makeAnalysis(raw) : raw;
              resolve(a);
            }
          }
          step();
        });
      }
    };
  }

  // ── Mock image processor: no-op enhance (real work is backend/pipeline; client is preview/fallback). ──
  function mockImageProcessor() {
    return { enhance: function (img) { return Promise.resolve(img); } };
  }

  // ── Mock CXR store: in-memory stand-in for the ENCRYPTED on-device store (thorex-store.js). ──
  function mockCxrStore(seed) {
    var mem = {};
    (seed || []).forEach(function (a) { if (a && a.id) mem[a.id] = a; });
    function list() { return Object.keys(mem).map(function (k) { return mem[k]; }); }
    return {
      save: function (a) { if (a && a.id) mem[a.id] = a; return Promise.resolve(); },
      all: function () { return Promise.resolve(list()); },
      timeline: function () { return Promise.resolve(list().slice().sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); })); },
      get: function (id) { return Promise.resolve(mem[id] || null); },
      delete: function (id) { delete mem[id]; return Promise.resolve(); },
      deleteAll: function () { mem = {}; return Promise.resolve(); },
      search: function (q) { q = String(q || "").toLowerCase(); return Promise.resolve(list().filter(function (a) { return (a.verdict || "").toLowerCase().indexOf(q) >= 0 || String(a.createdAt || "").toLowerCase().indexOf(q) >= 0; })); }
    };
  }

  function mockProviders(opts) {
    opts = opts || {};
    return {
      kind: "mock",
      analyzer: mockAnalyzer(),
      imageProcessor: mockImageProcessor(),
      cxrStore: mockCxrStore(opts.seedAnalyses)
    };
  }

  // ── Backend activation (health-gated). smd_thorex_backend on AND /v1/health passed -> RemoteAnalyzer
  //    (thorex-net.js -> /api/thorex); else the honest "unavailable" analyzer. Mock only in demo mode. ──
  var _backendHealthy = false;
  function flagBool(name) { try { return !!(typeof window !== "undefined" && window.SMD_THOREX_FLAGS && window.SMD_THOREX_FLAGS.bool(name)); } catch (e) { return false; } }
  function backendFlag() { return flagBool("smd_thorex_backend"); }
  function demoFlag() { return flagBool("smd_thorex_demo"); }
  function isNative() { try { return !!(typeof window !== "undefined" && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } }
  // Placeholder direct-backend URL for the native app (mirrors kardiox-providers.js KX_BACKEND_URL);
  // matches the constant in thorex-net.js until the ThoreX Cloud Run service is provisioned.
  var TX_BACKEND_URL = "https://thorex-pipeline-yislqrddsq-uc.a.run.app";
  function backendBase() { return isNative() ? TX_BACKEND_URL : "/api/thorex"; }

  function remoteAnalyzer() {
    try {
      if (typeof window !== "undefined" && window.SMD_THOREX_NET && window.SMD_THOREX_NET.remoteAnalyzer) {
        var cfg = isNative() ? { baseUrl: TX_BACKEND_URL, path: "/v1/cxr/analyze" } : { baseUrl: "/api/thorex", path: "/v1/cxr/analyze" };
        return { kind: "remote", analyze: window.SMD_THOREX_NET.remoteAnalyzer(cfg).analyze };
      }
    } catch (e) {}
    return null;
  }
  function useRemote() { return backendFlag() && _backendHealthy && !!remoteAnalyzer(); }

  // ── On-device analyzer (OD-C/OD-D): REAL ONNX Runtime Web inference (thorex-ort.js), fully
  //    offline — no upload, no network. Mirrors kardiox-providers.js's ondevicePreferred()/ORT
  //    branch pattern.
  //
  //    Entitlement shaping (OD-D: BOTH engines now run on-device): v2beta asks thorex-ort.js's
  //    analyzeImage() to also run the educational (X-Raydar) engine (`includeEducational: true`),
  //    so v2beta gets the same two-engine (clinical + educational) shape on-device as it does from
  //    the remote/mock path. v1/free ask for the clinical engine only, unchanged. thorex-ort.js
  //    itself owns the asymmetric isolation (mirrors backend/thorex/app/pipeline/orchestrator.py):
  //    an educational-engine failure is logged there and the analysis still resolves clinical-only;
  //    a clinical-engine failure rejects the whole analyzeImage() call, which the catch handler
  //    below turns into the same typed `inference_unavailable` error regardless of cause — never a
  //    fabricated result.
  function ondeviceFlag() { return flagBool("smd_thorex_ondevice"); }
  function ortEngine() { return (typeof window !== "undefined" && window.SMD_THOREX_ORT) || null; }
  function ortAvailable() { try { var o = ortEngine(); return !!(o && o.available()); } catch (e) { return false; } }
  // "download-model" first: on the very first run (or after a cache clear) the on-device engine has to
  // fetch the ONNX model bytes before it can preprocess/infer — that download can take a while over a
  // slow connection, so it gets its own stage/progress rather than looking like a stalled "preprocess".
  // Every later run is served from the on-device cache (thorex-model-cache.js), so this stage completes
  // near-instantly (loadModelBytes reports progress 1.0 immediately on a cache hit — see thorex-ort.js).
  var ONDEVICE_STAGES = ["download-model", "preprocess", "infer"];
  function ondeviceAnalyzer() {
    return {
      kind: "ondevice",
      analyze: function (image, entitlement, onStage) {
        var o = ortEngine();
        if (!o) {
          var e0 = new Error("ThoreX on-device inference is not available: onnxruntime-web engine (thorex-ort.js) is not loaded.");
          e0.code = "inference_unavailable"; e0.stage = "analysis";
          return Promise.reject(e0);
        }
        var input = image && (image.blob || image.data);
        if (!input) {
          var e1 = new Error("ThoreX on-device inference needs an image blob/data.");
          e1.code = "inference_unavailable"; e1.stage = "analysis";
          return Promise.reject(e1);
        }
        try { if (typeof onStage === "function") onStage(ONDEVICE_STAGES[0], 0); } catch (e) {}
        // v2beta -> both engines on-device (clinical + educational); v1/free -> clinical only. Never
        // self-elevate beyond what the entitlement allows (same rule the remote/mock paths follow).
        var runOpts = {
          id: image && image.id,
          includeEducational: entitlement === "v2beta",
          // Model download progress (0..1, threaded from thorex-ort.js's loadModelBytes via
          // thorex-model-cache.js) surfaces as this same "download-model" stage — on a cache hit (every
          // run after the first) this fires ~immediately at 1.0; on a cold cache it ticks up as bytes
          // stream in. When no persistent-cache infrastructure is available at all, thorex-ort.js never
          // calls this and the stage simply stays at the 0% set above until analysis completes below.
          onProgress: function (frac) {
            try { if (typeof onStage === "function") onStage(ONDEVICE_STAGES[0], Math.round(Math.max(0, Math.min(1, frac || 0)) * 100)); } catch (e) {}
          }
        };
        // Always mark "preprocess" under way once the analyze call is in flight (unconditional, same
        // guarantee the pre-existing code made) — the model may still be mid-download at this point on a
        // cold cache, in which case later onProgress ticks continue to update the "download-model" stage
        // above even though "preprocess" already shows active; both are honest signals of real work.
        try { if (typeof onStage === "function") onStage(ONDEVICE_STAGES[1], 40); } catch (e) {}
        return Promise.resolve(o.analyzeImage(input, runOpts)).then(function (analysis) {
          try { if (typeof onStage === "function") onStage(ONDEVICE_STAGES[2], 100); } catch (e) {}
          return analysis;
        }, function (cause) {
          // Never fabricate on failure — surface a typed, honest error (same code/shape as
          // unavailableAnalyzer below) regardless of which internal error thorex-ort.js threw. Note:
          // this only fires for a CLINICAL-engine failure — an educational-engine failure is already
          // isolated inside analyzeImage() and resolves (clinical-only), never rejects here.
          var e2 = new Error((cause && cause.message) || "ThoreX on-device inference failed.");
          e2.code = "inference_unavailable"; e2.stage = (cause && cause.stage) || "analysis"; e2.cause = cause;
          throw e2;
        });
      }
    };
  }
  function ondevicePreferred() { return ondeviceFlag() && ortAvailable(); }

  // Honest "no real engine configured" analyzer — never silently fabricates a result.
  function unavailableAnalyzer() {
    return {
      kind: "unavailable",
      analyze: function (image, entitlement, onStage) {
        try { if (typeof onStage === "function") onStage("upload", 100); } catch (e) {}
        var err = new Error("ThoreX inference is not available on this build: the analysis backend is unreachable. Enable smd_thorex_backend once the pipeline is deployed, or enable demo mode (smd_thorex_demo) to preview the UI with a sample.");
        err.code = "inference_unavailable"; err.stage = "analysis";
        return Promise.reject(err);
      }
    };
  }

  // Analyzer selection: DEMO flag -> deterministic mock (explicit demo ONLY). Else the real pipeline:
  // RemoteAnalyzer when the backend is health-gated healthy, else the honest "unavailable" analyzer.
  function chooseAnalyzer(opts) {
    opts = opts || {};
    if (demoFlag()) return mockAnalyzer();
    if (ondevicePreferred()) return ondeviceAnalyzer();   // fully offline, opt-in (smd_thorex_ondevice) + ORT ready
    var real = (opts.remote || useRemote()) && remoteAnalyzer();
    return real || unavailableAnalyzer();
  }

  // Ping /api/thorex/v1/health; on success flip to the remote analyzer (rebuild the active assembly).
  function checkBackend() {
    if (!backendFlag() || typeof fetch !== "function") { _backendHealthy = false; return Promise.resolve(false); }
    return fetch(backendBase() + "/v1/health").then(function (r) { return r && r.ok; }).then(function (ok) {
      _backendHealthy = !!ok; _active = null; return _backendHealthy;   // force rebuild with the chosen analyzer
    }).catch(function () { _backendHealthy = false; return false; });
  }

  // Live assembly: encrypted on-device store (thorex-store.js when present) + a health-gated analyzer.
  function liveProviders(opts) {
    opts = opts || {};
    var store = (typeof window !== "undefined" && window.SMD_THOREX_STORE && window.SMD_THOREX_STORE.create)
      ? window.SMD_THOREX_STORE.create() : mockCxrStore(opts.seedAnalyses);
    return {
      kind: "live",
      analyzer: chooseAnalyzer(opts),   // REAL pipeline (remote); mock ONLY in explicit demo mode
      imageProcessor: mockImageProcessor(),
      cxrStore: store
    };
  }

  var _active = null;
  function current() { if (!_active) _active = liveProviders(); return _active; }
  function use(assembly) { _active = assembly; return _active; }

  var API = {
    mockProviders: mockProviders, liveProviders: liveProviders, current: current, use: use,
    checkBackend: checkBackend, backendActive: useRemote, ondeviceActive: ondevicePreferred
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_PROVIDERS = API;
})();
