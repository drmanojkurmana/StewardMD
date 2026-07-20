/* kardiox-net.js — KardioX AI · KardioXApiClient + RemoteAnalyzer (SMD_KARDIOX_NET).
 *
 * Codes against the v1 API contract (README §API Specification). Multipart upload → JSON that maps
 * 1:1 to ECGAnalysis. Retry with exponential backoff (0.5/2/8 s, max 3) on 5xx/timeout/429; 90 s
 * timeout; version-pinned + forward-compatible decode (unknown fields ignored via makeAnalysis).
 * Typed errors { code, message, stage }. NO PII in logs/URLs — correlate by ephemeral sessionId only.
 *
 * There is no live backend yet; liveProviders() keeps the mock analyzer until one is configured. When
 * it is, RemoteAnalyzer drops in with ZERO view changes. 🔧 RECONCILE: wrap StewardMD's api.js base
 * networking (auth/TLS/interceptors) instead of bare fetch. Testable via an injected fetchImpl.
 * node + browser.
 */
(function () {
  "use strict";

  function MODELS() { return (typeof window !== "undefined" && window.SMD_KARDIOX_MODELS) || (typeof require !== "undefined" ? require("./kardiox-models.js") : null); }

  var ERROR_MAP = {
    400: { code: "bad_image", stage: "quality" },
    422: { code: "layout_undetected", stage: "digitization" },
    429: { code: "rate_limited", stage: "upload" },
    503: { code: "pipeline_unavailable", stage: "report" },
    504: { code: "timeout", stage: "report" }
  };
  function apiError(status, body) {
    var m = ERROR_MAP[status] || { code: "http_" + status, stage: "report" };
    var msg = (body && body.error && body.error.message) || (body && body.message) || ("HTTP " + status);
    var e = new Error(msg); e.code = (body && body.error && body.error.code) || m.code; e.stage = (body && body.error && body.error.stage) || m.stage; e.status = status; return e;
  }
  function shouldRetry(status) { return status === 429 || status === 504 || (status >= 500 && status <= 599); }
  function sleep(ms, timer) { timer = timer || (typeof setTimeout !== "undefined" ? setTimeout : null); return new Promise(function (r) { if (timer) timer(r, ms); else r(); }); }

  function makeApiClient(opts) {
    opts = opts || {};
    var fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    var base = opts.baseUrl || "/api/kardiox";
    var path = opts.path || "/v1/ecg/analyze";
    var backoff = opts.backoffMs || [500, 2000, 8000];
    var maxRetries = opts.maxRetries != null ? opts.maxRetries : 3;
    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 90000;
    var timerFn = opts.timerFn;                       // injectable for tests

    function buildBody(image) {
      // Browser: real FormData; tests/node: a plain descriptor the fake fetch can read.
      if (typeof FormData !== "undefined" && typeof Blob !== "undefined") {
        var fd = new FormData();
        try { fd.append("image", image && image.data instanceof Blob ? image.data : new Blob([String(image && image.data || "")]), "ecg"); } catch (e) {}
        if (image && image.leadLayout) fd.append("layoutHint", image.leadLayout);
        if (image && image.pages) fd.append("pages", String(image.pages));
        return fd;
      }
      return { image: "<binary>", layoutHint: (image && image.leadLayout) || null, pages: (image && image.pages) || null };
    }

    // One attempt with a timeout. Resolves { status, json } or throws (network/timeout).
    function attempt(sessionId, body) {
      if (!fetchImpl) return Promise.reject(apiError(503, { message: "no network" }));
      var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var timedOut = false;
      var to = sleep(timeoutMs, timerFn).then(function () { timedOut = true; if (ctrl) ctrl.abort(); });
      var req = Promise.resolve(fetchImpl(base + path, {
        method: "POST", body: body, signal: ctrl ? ctrl.signal : undefined,
        headers: { "Accept": "application/vnd.kardiox.v1+json", "X-Session-ID": sessionId }
      })).then(function (res) {
        return Promise.resolve(res.json ? res.json().catch(function () { return null; }) : null).then(function (j) { return { status: res.status, json: j }; });
      }, function (err) { if (timedOut) { var e = apiError(504, {}); throw e; } throw err; });
      return Promise.race([req, to.then(function () { throw apiError(504, {}); })]);
    }

    function analyze(image, onStage) {
      var models = MODELS();
      var sessionId = (opts.sessionId) || ("kx-" + (Math.floor((typeof performance !== "undefined" ? performance.now() : 0)) || "sess"));
      var body = buildBody(image);
      try { if (typeof onStage === "function") onStage("upload", 5); } catch (e) {}
      var tries = 0;
      function run() {
        return attempt(sessionId, body).then(function (r) {
          if (r.status === 200 && r.json) {
            // version guard: pin the MAJOR; forward-compatible decode handles unknown fields.
            var v = String(r.json.schemaVersion || "1.0"), major = v.split(".")[0];
            if (major !== "1") throw apiError(400, { error: { code: "version_mismatch", message: "Unsupported schemaVersion " + v, stage: "report" } });
            try { if (typeof onStage === "function") onStage("report", 100); } catch (e) {}
            return models ? models.makeAnalysis(r.json) : r.json;
          }
          var e = apiError(r.status, r.json);
          if (shouldRetry(r.status) && tries < maxRetries) { tries++; return sleep(backoff[Math.min(tries - 1, backoff.length - 1)], timerFn).then(run); }
          throw e;
        }, function (err) {
          // network/timeout: retry up to maxRetries
          var status = err && err.status;
          if ((status == null || shouldRetry(status)) && tries < maxRetries) { tries++; return sleep(backoff[Math.min(tries - 1, backoff.length - 1)], timerFn).then(run); }
          if (!err.code) { err = apiError(status || 503, {}); }
          throw err;
        });
      }
      return run();
    }

    return { analyze: analyze, sessionId: opts.sessionId };
  }

  // RemoteAnalyzer implements the ECGAnalyzer interface via the client.
  function remoteAnalyzer(opts) { var c = makeApiClient(opts); return { analyze: function (image, onStage) { return c.analyze(image, onStage); } }; }

  var API = { makeApiClient: makeApiClient, remoteAnalyzer: remoteAnalyzer, ERROR_MAP: ERROR_MAP, shouldRetry: shouldRetry };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_NET = API;
})();
