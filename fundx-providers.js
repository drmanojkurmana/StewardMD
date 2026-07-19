/* fundx-providers.js — FundX AI · retinal-inference provider abstraction (AI Router).
 *
 * The single, stable seam that makes retinal inference provider-agnostic. The Vision UI
 * and data contracts only ever see analyzeFindings() → a versioned RetinalFindings object;
 * they never know or care which provider produced it. Swapping the mock for a real model
 * (Vertex AI / Gemini, Cerebras, on-device ONNX or TensorFlow Lite, or a custom model)
 * requires ZERO change to the UI, workflows, or persisted schema.
 *
 * Responsibilities (AI-orchestration layer): register / list / select providers, route a
 * request to the active provider, validate its response against the schema, fall back to a
 * safe provider (mock) on error/invalid output, report health + versions. Cloud adapters
 * make a real HTTP call once an endpoint is configured; local ONNX/TFLite adapters lazy-load
 * a runtime + model once a model path is configured. Unconfigured adapters report
 * available()===false and are isolated — the router never runs an unconfigured provider.
 *
 * Exposed as window.SMD_FUNDX_PROVIDERS. Depends only on window.SMD_FUNDX_VISION.
 */
(function () {
  "use strict";

  function V() { return (typeof window !== "undefined" && window.SMD_FUNDX_VISION) || (typeof SMD_FUNDX_VISION !== "undefined" ? SMD_FUNDX_VISION : null); }

  function NotConfiguredError(id) { var e = new Error("Provider '" + id + "' is not configured (missing endpoint/model/credentials)."); e.code = "not_configured"; return e; }

  // Validate a raw findings object returned by a provider before we trust it.
  function validRaw(raw) {
    if (!raw || typeof raw !== "object") return false;
    if (raw.provider == null || raw.model_version == null) return false;
    // must carry at least a confidence and one structural finding
    if (raw.confidence == null && !raw.optic_disc && raw.quality == null) return false;
    return true;
  }

  // ---- provider implementations ------------------------------------------
  // Local mock (always available) — the default. Delegates to the engine's MockRetinaModel.
  function mockProvider() {
    return {
      id: "mock", provider: "mock", modelVersion: "mock-0.1", kind: "local",
      available: function () { return !!(V() && V().MockRetinaModel); },
      analyze: function (input, ctx) { return V().MockRetinaModel.analyze(input || {}, ctx || {}); }
    };
  }

  // Gather the Experimental Access headers: the signed FundX activation token (X-XA-Token, proves a
  // live one-device beta activation server-side) + the Firebase ID token (uid, for owner bypass +
  // per-identity metering). Both best-effort — absent when not signed in / not activated.
  function xaAuthHeaders() {
    var h = {};
    try { var t = window.SMD_XACCESS && SMD_XACCESS.token && SMD_XACCESS.token("fundx"); if (t) h["X-XA-Token"] = t; } catch (e) {}
    var idp = Promise.resolve(null);
    try { var u = window.firebase && firebase.auth && firebase.auth().currentUser; if (u && u.getIdToken) idp = u.getIdToken().catch(function () { return null; }); } catch (e) {}
    return idp.then(function (tok) { if (tok) h["Authorization"] = "Bearer " + tok; return h; }, function () { return h; });
  }

  // Cloud vision provider — POSTs the image to a configurable FundX backend endpoint that
  // proxies the real model (e.g. Vertex/Gemini multimodal, Cerebras-hosted, custom). Real
  // production call; unavailable until configure({endpoint}) is set.
  function cloudProvider(id, provider, cfg0) {
    var cfg = cfg0 || {};
    return {
      id: id, provider: provider, kind: "cloud",
      get modelVersion() { return cfg.model || (provider + "-unset"); },
      configure: function (c) { cfg = Object.assign({}, cfg, c || {}); return this; },
      available: function () { return !!cfg.endpoint; },
      analyze: function (input, ctx) {
        if (!cfg.endpoint) throw NotConfiguredError(id);
        var body = { image: (input && input.imageDataUrl) || null, metrics: (input && input.metrics) || null, model: cfg.model, ctx: ctx || {} };
        // Experimental Access: attach the signed FundX activation token (X-XA-Token) + the Firebase
        // ID token so the server can enforce the one-device beta gate on the compute path itself.
        return xaAuthHeaders().then(function (auth) {
          var headers = Object.assign({ "content-type": "application/json" }, cfg.headers || {}, auth);
          return fetch(cfg.endpoint, { method: "POST", headers: headers, body: JSON.stringify(body) });
        })
          .then(function (r) { if (!r.ok) throw new Error(id + " HTTP " + r.status); return r.json(); })
          .then(function (j) {
            var f = (j && j.findings) || j || {};
            if (f.provider == null) f.provider = provider;
            if (f.model_version == null) f.model_version = cfg.model || provider;
            return f;
          });
      }
    };
  }

  // On-device runtime provider (ONNX Runtime Web / TFLite). Lazy-loads a runtime + model
  // from a configured path; isolated until configured. Structure is production-ready; the
  // actual runtime/model bytes are supplied by configure({runtimeUrl, modelUrl}).
  function localModelProvider(id, provider, kind) {
    var cfg = {}, session = null;
    return {
      id: id, provider: provider, kind: kind || "local",
      get modelVersion() { return cfg.modelVersion || (provider + "-unset"); },
      configure: function (c) { cfg = Object.assign({}, cfg, c || {}); return this; },
      available: function () { return !!cfg.modelUrl; },
      load: function () {
        if (session) return Promise.resolve(session);
        if (!cfg.modelUrl || !cfg.loader) return Promise.reject(NotConfiguredError(id));
        return Promise.resolve(cfg.loader(cfg)).then(function (s) { session = s; return s; });
      },
      analyze: function (input, ctx) {
        if (!cfg.modelUrl || !cfg.loader || !cfg.infer) throw NotConfiguredError(id);
        return this.load().then(function (s) { return cfg.infer(s, input, ctx); }).then(function (f) {
          f = f || {}; if (f.provider == null) f.provider = provider; if (f.model_version == null) f.model_version = cfg.modelVersion || provider; return f;
        });
      }
    };
  }

  // ---- registry / router --------------------------------------------------
  var providers = {};
  var activeId = "mock";
  function register(p) { if (p && p.id) providers[p.id] = p; return p; }
  // seed defaults. The cloud vision provider is PRE-WIRED to the FundX backend
  // (/api/fundx/vision) so connecting it is just setActive("vertex-gemini") once the
  // backend has credentials; mock stays active by default. The backend reports real
  // readiness at GET /api/fundx/health.
  register(mockProvider());
  register(cloudProvider("vertex-gemini", "vertex", { endpoint: "/api/fundx/vision", model: "gemini-2.5-flash" }));
  register(cloudProvider("cerebras", "cerebras"));   // vision N/A for Cerebras; kept for symmetry
  register(localModelProvider("onnx", "onnx", "local"));
  register(localModelProvider("tflite", "tflite", "local"));

  var API = {
    NotConfiguredError: NotConfiguredError,
    register: register,
    list: function () { return Object.keys(providers); },
    get: function (id) { return providers[id] || null; },
    getActive: function () { return providers[activeId] || providers.mock; },
    setActive: function (id) { if (providers[id]) { activeId = id; return true; } return false; },
    configure: function (id, cfg) { var p = providers[id]; if (p && p.configure) p.configure(cfg); return p; },
    health: function () {
      return Object.keys(providers).map(function (id) { var p = providers[id]; return { id: id, provider: p.provider, kind: p.kind, modelVersion: p.modelVersion, available: !!(p.available && p.available()), active: id === activeId }; });
    },
    // Route a request → active provider → validate → build versioned findings; fall back
    // to mock on error / invalid output. Always resolves with a valid RetinalFindings.
    analyzeFindings: function (input, ctx) {
      var Ve = V(); if (!Ve) return Promise.reject(new Error("Vision engine not loaded"));
      var active = API.getActive();
      function build(raw, fallbackInfo) {
        var built = Ve.Findings.build({ findings: raw, ctx: ctx || {}, quality: input && input.quality });
        if (fallbackInfo) built.fallback = fallbackInfo;
        return built;
      }
      function toMock(reason) {
        var raw = Ve.MockRetinaModel.analyze(input || {}, ctx || {});
        return build(raw, activeId === "mock" ? null : { from: activeId, reason: reason });
      }
      try {
        if (activeId === "mock" || !active.available || !active.available()) return Promise.resolve(toMock(active.available && !active.available() ? "unavailable" : null));
        return Promise.resolve(active.analyze(input, ctx)).then(function (raw) {
          if (!validRaw(raw)) return toMock("invalid_response");
          return build(raw, null);
        }).catch(function (e) { return toMock(e && e.message || "error"); });
      } catch (e) { return Promise.resolve(toMock(e && e.message || "error")); }
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_FUNDX_PROVIDERS = API;
})();
