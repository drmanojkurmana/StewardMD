// sknx-cloudvision.js — SknX cloud classifier provider (Google Derm Foundation + SCIN head, 59
// conditions) served from Cloud Run. Same shape as the on-device providers ({available, analyze,
// warmup}) so sknx-providers.js can select it. This is the ONLY engine that spans general dermatology
// (59 conditions) rather than the 7 HAM cancer classes - it is the model the clinician validates.
//
// PHI / ARCHITECTURE NOTE: unlike the on-device WASM/Core ML engines, this SENDS the captured image to
// a StewardMD-owned endpoint for embedding+classification (Derm Foundation is ~1.5GB, cannot run in the
// WebView). It is therefore EXPERIMENTAL and OPT-IN ONLY: gated behind smd_sknx_cloud (def:false) and
// used only by clinicians who have knowingly enabled it for validation. Nothing is stored server-side.
// Before any non-validation/production use this needs an explicit consent gate + a signed data path
// (R1/R3 review). Every raw it emits is tagged engine:"derm-foundation-cloud" so the UI can badge it.
(function () {
  "use strict";

  // Filled at deploy time with the live Cloud Run URL; overridable at runtime (window/localStorage).
  var DEFAULT_ENDPOINT = "__SKNX_CLOUD_ENDPOINT__";

  // The two true cutaneous malignancies among the 59 SCIN conditions -> a label sknx-engines.js's
  // guardrail recognizes (normalizeMalignantLabel). These are pushed into lesionProbs so the malignancy
  // guardrail fires (refer, do not prescribe). Actinic Keratosis is pre-malignant and primary-care
  // treatable, so it stays in the differential and is NOT force-referred here.
  var MALIGNANT_MAP = {
    "basal cell carcinoma": "basal cell carcinoma",
    "scc/sccis": "squamous cell carcinoma"
  };

  function endpoint() {
    try {
      if (typeof window !== "undefined") {
        if (window.SMD_SKNX_CLOUD_ENDPOINT) return window.SMD_SKNX_CLOUD_ENDPOINT;
        var ls = null; try { ls = localStorage.getItem("sknx_cloud_endpoint"); } catch (e) {}
        if (ls) return ls;
      }
    } catch (e) {}
    return DEFAULT_ENDPOINT;
  }
  // available(): opt-in flag ON + a real endpoint configured + fetch present. No DOM needed (works in
  // the native WebView). endpoint must not still be the unfilled placeholder.
  function available(win) {
    try {
      var w = win || (typeof window !== "undefined" ? window : null);
      if (!w) return false;
      var on = w.SMD_SKNX_FLAGS && w.SMD_SKNX_FLAGS.bool("smd_sknx_cloud");
      var ep = (w.SMD_SKNX_CLOUD_ENDPOINT) || endpoint();
      return !!on && !!ep && ep.indexOf("__SKNX_CLOUD") !== 0 && typeof fetch === "function";
    } catch (e) { return false; }
  }

  // image (dataURL string | Blob/File | <img>) -> base64 dataURL string for the JSON body.
  function toDataURL(image) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof image === "string") return resolve(image); // already a dataURL/base64
        if (typeof Blob !== "undefined" && image instanceof Blob) {
          var r = new FileReader();
          r.onload = function () { resolve(r.result); };
          r.onerror = function () { reject(new Error("read_failed")); };
          r.readAsDataURL(image);
          return;
        }
        if (image && image.nodeName === "IMG" && typeof document !== "undefined") {
          var c = document.createElement("canvas");
          c.width = image.naturalWidth || image.width; c.height = image.naturalHeight || image.height;
          c.getContext("2d").drawImage(image, 0, 0);
          return resolve(c.toDataURL("image/jpeg", 0.9));
        }
        reject(new Error("unsupported_image"));
      } catch (e) { reject(e); }
    });
  }

  // Cloud differential [{label,prob}] -> SknX raw. generalProbs = the full differential (clinician-
  // facing). lesionProbs = only the malignant-mapped conditions, so the guardrail can fire.
  function mapDiffToRaw(differential) {
    var general = [], lesion = [];
    (differential || []).forEach(function (x) {
      general.push({ label: x.label, prob: x.prob });
      var m = MALIGNANT_MAP[String(x.label || "").toLowerCase().trim()];
      if (m) lesion.push({ label: m, prob: x.prob });
    });
    return { generalProbs: general, lesionProbs: lesion, features: {}, engine: "derm-foundation-cloud" };
  }

  function classify(dataURL, ep, fetchImpl) {
    var f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return Promise.reject(new Error("no_fetch"));
    return f(ep.replace(/\/$/, "") + "/classify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataURL })
    }).then(function (r) {
      if (!r.ok) throw new Error("cloud_http_" + r.status);
      return r.json();
    });
  }

  // ensureConsent(): explicit per-user consent before ANY image leaves the device (PHI egress). Stored
  // once in localStorage. In a DOM it prompts on first use; in node (tests) there is no window, so it is
  // a no-op. Returns true if consent is granted. opts.skipConsent bypasses (already consented upstream).
  function ensureConsent(opts) {
    if (opts && opts.skipConsent) return true;
    if (typeof window === "undefined") return true; // node/tests - not applicable
    try {
      var ls = window.localStorage;
      if (ls && ls.getItem("sknx_cloud_consent") === "1") return true;
      if (typeof window.confirm === "function") {
        var ok = window.confirm("SknX cloud analysis sends this photo to StewardMD's server for analysis. Nothing is stored. Continue?");
        if (ok && ls) { try { ls.setItem("sknx_cloud_consent", "1"); } catch (e) {} }
        return !!ok;
      }
    } catch (e) {}
    return false; // no way to obtain consent -> do not send
  }

  // analyze(image, opts) -> Promise<raw>. Rejects on any failure so sknx-providers surfaces an honest
  // error (never masks with the mock). opts.{endpoint, fetchImpl, skipConsent} injectable for tests.
  function analyze(image, opts) {
    opts = opts || {};
    var ep = opts.endpoint || endpoint();
    if (!ep || ep.indexOf("__SKNX_CLOUD") === 0) return Promise.reject(new Error("cloud_endpoint_unset"));
    if (!ensureConsent(opts)) return Promise.reject(new Error("cloud_consent_declined"));
    return toDataURL(image).then(function (dataURL) {
      return classify(dataURL, ep, opts.fetchImpl);
    }).then(function (res) {
      if (!res || !res.differential) throw new Error("cloud_bad_response");
      return mapDiffToRaw(res.differential);
    });
  }

  // warmup(): wake the (scale-to-zero) Cloud Run instance when SknX opens so the first real analysis
  // isn't a ~60-120s cold start. Fire-and-forget, never rejects. Hits /health (starts the instance);
  // the model itself loads lazily on the first /classify.
  function warmup(opts) {
    opts = opts || {};
    var ep = opts.endpoint || endpoint();
    if (!ep || ep.indexOf("__SKNX_CLOUD") === 0 || typeof fetch !== "function") return Promise.resolve(false);
    return fetch(ep.replace(/\/$/, "") + "/health", { method: "GET" })
      .then(function () { return true; }).catch(function () { return false; });
  }

  var API = {
    available: available, analyze: analyze, warmup: warmup, ensureConsent: ensureConsent,
    mapDiffToRaw: mapDiffToRaw, toDataURL: toDataURL, endpoint: endpoint, MALIGNANT_MAP: MALIGNANT_MAP
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_CLOUDVISION = API;
})();
