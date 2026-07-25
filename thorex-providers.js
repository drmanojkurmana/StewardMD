/* thorex-providers.js — ThoreX CXR AI · provider seam + deterministic mock (SMD_THOREX_PROVIDERS).
 *
 * Cloned from kardiox-providers.js. Screens talk ONLY to providers; providers are the only layer
 * touching network/disk. Two assemblies:
 *   mockProviders() — deterministic, offline; drives previews + the test suite.
 *   liveProviders() — health-gated: RemoteAnalyzer (thorex-net.js → /api/thorex) when the backend is
 *                      reachable, else the honest "unavailable" analyzer. Mock is NEVER a silent
 *                      fallback — it only runs in explicit demo mode (smd_thorex_demo).
 *
 * Entitlement shaping (mirrors backend/thorex/README.md "Entitlement → engines returned"):
 *   free   -> hosted HF engine only (hf_vit), educational:false
 *   v1     -> primary detector only (torchxrayvision), educational:false
 *   v2beta -> torchxrayvision (clinical) + xraydar (educational:true, disclaimer educational_not_clinical)
 * The mock never elevates/fabricates beyond what the entitlement is allowed — same rule as the real
 * backend and thorex-net.js's RemoteAnalyzer (client sends entitlement verbatim; never self-elevates).
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
    checkBackend: checkBackend, backendActive: useRemote
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_PROVIDERS = API;
})();
