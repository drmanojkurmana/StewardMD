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

  // Live Cloud Run classifier (deployed 2026-08-05). Overridable at runtime (window/localStorage). For
  // the closed-endpoint production posture, set this to the Worker proxy "https://stewardmd.in/api/sknx"
  // + provision the secrets (see sknx-server/deploy.sh hardening notes).
  var DEFAULT_ENDPOINT = "https://sknx-derm-yislqrddsq-el.a.run.app";
  // Production egress posture (security H1): the authenticated Worker proxy. classify() appends "/classify",
  // hitting POST /api/sknx/classify — which enforces sign-in + feature gate + rate-limit, keeps the Cloud
  // Run URL + key server-side, and fails closed (503) until SKNX_CLASSIFY_URL is provisioned. Selected only
  // when the smd_sknx_secure_egress flag is ON (see endpoint()); default OFF keeps the direct validation path.
  var PROXY_ENDPOINT = "https://stewardmd.in/api/sknx";

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
        // An explicit override always wins (validation/QA can pin a specific endpoint).
        if (window.SMD_SKNX_CLOUD_ENDPOINT) return window.SMD_SKNX_CLOUD_ENDPOINT;
        var ls = null; try { ls = localStorage.getItem("sknx_cloud_endpoint"); } catch (e) {}
        if (ls) return ls;
        // Flag ON -> route through the authenticated Worker proxy (auth-enforced edge). Default OFF ->
        // the raw Cloud Run URL, so the active validation path is untouched (security H1).
        try { if (window.SMD_SKNX_FLAGS && window.SMD_SKNX_FLAGS.bool("smd_sknx_secure_egress")) return PROXY_ENDPOINT; } catch (e) {}
      }
    } catch (e) {}
    return DEFAULT_ENDPOINT;
  }
  // NATIVE-ONLY: the cloud classifier runs ONLY inside the iOS/Android app (Capacitor native), never in
  // a browser. There is no public web console. Enforced here so a web build can never invoke the model.
  function isNative(w) {
    try { return !!(w && w.Capacitor && typeof w.Capacitor.isNativePlatform === "function" && w.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  }
  // available(): NATIVE app + opt-in flag ON + a real endpoint configured + fetch present. endpoint must
  // not still be the unfilled placeholder.
  function available(win) {
    try {
      var w = win || (typeof window !== "undefined" ? window : null);
      if (!w) return false;
      if (!isNative(w)) return false; // app-only: no web execution
      var on = w.SMD_SKNX_FLAGS && w.SMD_SKNX_FLAGS.bool("smd_sknx_cloud");
      var ep = (w.SMD_SKNX_CLOUD_ENDPOINT) || endpoint();
      return !!on && !!ep && ep.indexOf("__SKNX_CLOUD") !== 0 && typeof fetch === "function";
    } catch (e) { return false; }
  }

  // image (dataURL string | Blob/File | <img>) -> base64 dataURL for the JSON body. Blobs/Files/dataURLs
  // are RE-ENCODED through a canvas (downscaled to <=1024px), which STRIPS EXIF/GPS/timestamp metadata
  // before the image leaves the device (de-identification - AI-safety I2). In node/tests (no DOM) a
  // string passes through unchanged.
  function toDataURL(image) {
    var MAX = 1024;
    // encode(src): draw an ImageBitmap or <img> to a downscaled canvas + JPEG re-encode (strips EXIF/GPS).
    function encode(src) {
      var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      var s = Math.min(1, MAX / Math.max(w || 1, h || 1));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      try { if (src.close) src.close(); } catch (e) {}
      return c.toDataURL("image/jpeg", 0.9);
    }
    return new Promise(function (resolve, reject) {
      try {
        if (typeof document === "undefined") { // node/tests - can't canvas
          if (typeof image === "string") return resolve(image);
          return reject(new Error("no_dom"));
        }
        if (image && image.nodeName === "IMG") return resolve(encode(image));
        if (typeof Blob !== "undefined" && image instanceof Blob) {
          // createImageBitmap is the reliable decode for multi-MB camera photos in a WebView (a plain
          // <img>+objectURL can OOM/stall). Fall back to <img> only if it's unavailable.
          if (typeof createImageBitmap === "function") {
            return createImageBitmap(image).then(function (b) { resolve(encode(b)); }).catch(function (e) { reject(e); });
          }
          var url = URL.createObjectURL(image), im = new Image();
          im.onload = function () { try { resolve(encode(im)); } finally { try { URL.revokeObjectURL(url); } catch (e) {} } };
          im.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} reject(new Error("img_load")); };
          im.src = url; return;
        }
        if (typeof image === "string") { // a dataURL - re-encode via <img> to strip metadata + downscale
          var im2 = new Image();
          im2.onload = function () { resolve(encode(im2)); };
          im2.onerror = function () { resolve(image); }; // fall back to the original if it won't decode
          im2.src = image; return;
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

  // Firebase ID token (same pattern as thorex-llm). Attached when present so the endpoint can be the
  // authenticated Worker proxy (/api/sknx). Null in a validation build hitting Cloud Run directly.
  function idToken() {
    try {
      var u = typeof window !== "undefined" && window.firebase && firebase.auth && firebase.auth().currentUser;
      if (u && u.getIdToken) return u.getIdToken().catch(function () { return null; });
    } catch (e) {}
    return Promise.resolve(null);
  }

  function doPost(f, url, headers, body) {
    return f(url, { method: "POST", headers: headers, body: body }).then(function (r) {
      if (!r.ok) { var e = new Error("cloud_http_" + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function classify(dataURL, ep, fetchImpl) {
    var f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return Promise.reject(new Error("no_fetch"));
    var url = ep.replace(/\/$/, "") + "/classify";
    return idToken().then(function (tok) {
      var headers = { "Content-Type": "application/json" };
      if (tok) headers.Authorization = "Bearer " + tok;
      var body = JSON.stringify({ image: dataURL });
      return doPost(f, url, headers, body).catch(function (err) {
        // Retry ONCE on a transient network/DNS blip (fetch rejects, no status) or a 5xx - the device's
        // resolver + a scale-to-zero instance occasionally miss the first attempt. Never retry a 4xx.
        if (err && err.status && err.status < 500) throw err;
        return new Promise(function (res) { setTimeout(res, 900); }).then(function () { return doPost(f, url, headers, body); });
      });
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
        // DPDP §5 notice content: Data Fiduciary (StewardMD), processor (Google Cloud, Mumbai region),
        // specific + experimental purpose, non-retention, and how to withdraw. Use only de-identified
        // images or with the patient's consent. (No em-dash in app-facing text.)
        var ok = window.confirm(
          "SknX cloud analysis (StewardMD) will send this photo to a StewardMD server, processed via " +
          "Google Cloud (Mumbai), for EXPERIMENTAL dermatology analysis. It is NOT a diagnosis. Nothing " +
          "is stored. Use only de-identified images or with the patient's consent. You can withdraw later " +
          "by clearing SknX data. Continue?");
        if (ok && ls) { try { ls.setItem("sknx_cloud_consent", "1"); } catch (e) {} }
        return !!ok;
      }
    } catch (e) {}
    return false; // no way to obtain consent -> do not send
  }

  // revokeConsent(): withdraw cloud-analysis consent (DPDP right to withdraw). Clears the stored flag so
  // the next analyze re-prompts; a settings toggle / the console's "revoke" link call this.
  function revokeConsent() {
    try { if (typeof window !== "undefined" && window.localStorage) window.localStorage.removeItem("sknx_cloud_consent"); } catch (e) {}
    return true;
  }
  // hasConsent(): current consent state (for a settings toggle to reflect).
  function hasConsent() {
    try { return typeof window !== "undefined" && window.localStorage && window.localStorage.getItem("sknx_cloud_consent") === "1"; } catch (e) { return false; }
  }

  // analyze(image, opts) -> Promise<raw>. Rejects on any failure so sknx-providers surfaces an honest
  // error (never masks with the mock). opts.{endpoint, fetchImpl, skipConsent} injectable for tests.
  function analyze(image, opts) {
    opts = opts || {};
    var ep = opts.endpoint || endpoint();
    if (!ep || ep.indexOf("__SKNX_CLOUD") === 0) return Promise.reject(new Error("cloud_endpoint_unset"));
    // Never send a patient image over a non-TLS endpoint (guards a localStorage/window override that
    // downgrades to http:// - security B4). https:// only.
    if (!/^https:\/\//i.test(ep)) return Promise.reject(new Error("cloud_insecure_endpoint"));
    if (!ensureConsent(opts)) return Promise.reject(new Error("cloud_consent_declined"));
    return toDataURL(image).then(function (dataURL) {
      return classify(dataURL, ep, opts.fetchImpl);
    }).then(function (res) {
      if (!res || !res.differential) throw new Error("cloud_bad_response");
      var raw = mapDiffToRaw(res.differential);
      // OOD/low-confidence: the server withheld the differential (off-domain / ungradable image). Carry
      // the flag so the screen shows a "no confident reading" state, not a benign-looking empty result.
      if (res.ood) { raw.ood = true; raw.oodReason = res.caveat || "No confident reading - re-take the photo (in focus, lesion centered) or assess clinically."; }
      return raw;
    });
  }

  // warmup(): warm-on-open. The endpoint scales to zero (free when idle), so the first real scan would
  // otherwise be a ~60-90s cold start (spin-up + model load). Called when SknX opens, this sends a tiny
  // THROWAWAY 16x16 image to /classify so the server loads the model WHILE the clinician is framing the
  // photo - by capture time it is usually warm. Fire-and-forget, never rejects; not a patient image so
  // no consent gate. A no-op off the native app (endpoint unset) or without a DOM.
  function warmup(opts) {
    opts = opts || {};
    var ep = opts.endpoint || endpoint();
    if (!ep || ep.indexOf("__SKNX_CLOUD") === 0 || typeof fetch !== "function" || typeof document === "undefined") return Promise.resolve(false);
    try {
      var c = document.createElement("canvas"); c.width = 16; c.height = 16;
      c.getContext("2d").fillRect(0, 0, 16, 16);
      var tiny = c.toDataURL("image/jpeg", 0.5);
      return classify(tiny, ep, opts.fetchImpl).then(function () { return true; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  var API = {
    available: available, analyze: analyze, warmup: warmup,
    ensureConsent: ensureConsent, revokeConsent: revokeConsent, hasConsent: hasConsent,
    mapDiffToRaw: mapDiffToRaw, toDataURL: toDataURL, endpoint: endpoint, MALIGNANT_MAP: MALIGNANT_MAP
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_CLOUDVISION = API;
})();
