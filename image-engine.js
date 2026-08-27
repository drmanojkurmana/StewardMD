/* StewardMD — Image Engine chooser for ICU Snapshot image processing.
 * ===========================================================================
 * Two clinician-controlled engines, one central router (no duplicated branching):
 *   • Private Device OCR · Free — native Apple Vision (iOS) / ML Kit bridge (Android where
 *     available), else local OCR fallback. Image NEVER leaves the device. Best for labelled
 *     documents (labs, ABG, medication lists, flowsheets); labels + reading order preserved.
 *   • AI Vision · Pro — sends the ORIGINAL image { image, kind } to the existing StewardMD AI
 *     vision endpoint (server understands spatial layout — best for monitor/ventilator). May
 *     process PHI → explicit consent required before the first upload / whenever unsaved.
 *
 * Preference: localStorage "stewardmd.imageEngine" ∈ {device, ai} (default device).
 * Consent:    localStorage "stewardmd.aiVisionPhiConsent" = "true".
 * Central API: window.SMD_IMAGE_ENGINE.process({ image, kind, engineOverride })
 *   resolves { mode:"fields", fields, lines, engine } | { mode:"lines", lines, engine }
 *            | { cancelled:true }  — the ingest shape the ICU review already consumes.
 * Server code is NOT changed; both { image, kind } and { text, kind } already supported.
 * ======================================================================== */
(function () {
  "use strict";
  var KEY_ENGINE = "stewardmd.imageEngine";
  var KEY_CONSENT = "stewardmd.aiVisionPhiConsent";
  var DEV = (function () { try { return location.hostname === "localhost" || location.hostname === "127.0.0.1" || localStorage.getItem("smd_debug") === "1"; } catch (e) { return false; } })();

  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lrem(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function getPref() { return lget(KEY_ENGINE) === "ai" ? "ai" : "device"; }   // default: device (privacy-first)
  function setPref(v) { lset(KEY_ENGINE, v === "ai" ? "ai" : "device"); }
  function getConsent() { return lget(KEY_CONSENT) === "true"; }
  function setConsent(on) { if (on) lset(KEY_CONSENT, "true"); else lrem(KEY_CONSENT); }
  // AI Vision availability (matches reasoning.js visionAiOn; default on = current beta behavior).
  function aiAvailable() { try { return lget("smd_ai_vision") !== "0"; } catch (e) { return true; } }
  function deviceOcrAvailable() { return !!(window.SMD_NATIVE && window.SMD_NATIVE.ocr); }
  // Pro entitlement — delegates to the app's single source of truth (SMD_PRO). For LABELLING
  // only here (AI Vision never hard-blocks; consent is the real gate). Beta/test allowed.
  function isPro() {
    try { if (window.SMD_PRO && window.SMD_PRO.isPro) return window.SMD_PRO.isPro(); } catch (e) {}
    return Promise.resolve(true);   // no entitlement system present → allow (per spec)
  }

  var SCREEN_KINDS = { monitor: 1, ventilator: 1 };                 // layout-dependent → AI especially important
  // AI Vision is the recommended engine for best accuracy on ANY clinical image whenever it can
  // run (enabled + online). On-device OCR is the private fallback but can be less accurate — so it
  // is only recommended when AI Vision isn't available (offline / disabled).
  function recommendFor(kind) { return (aiAvailable() && online()) ? "ai" : "device"; }
  function online() { return typeof navigator === "undefined" || navigator.onLine !== false; }
  function log() { if (!DEV) return; try { console.log.apply(console, ["[ImageEngine]"].concat([].slice.call(arguments))); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------------- shared theme-aware styles ---------------- */
  function injectCSS() {
    if (document.getElementById("smd-ie-css")) return;
    var s = document.createElement("style"); s.id = "smd-ie-css";
    s.textContent = [
      ".ie-ov{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:flex-end;justify-content:center;background:rgba(15,23,42,.55);animation:ieFade .15s ease}",
      "@keyframes ieFade{from{opacity:0}to{opacity:1}}@keyframes ieUp{from{transform:translateY(14px);opacity:.6}to{transform:none;opacity:1}}",
      ".ie-sheet{width:100%;max-width:460px;background:var(--ie-bg,#fff);color:var(--ie-ink,#0f172a);border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,.25);animation:ieUp .2s cubic-bezier(.2,.7,.2,1);max-height:88vh;overflow-y:auto}",
      "@media(min-width:520px){.ie-ov{align-items:center}.ie-sheet{border-radius:20px}}",
      ".ie-h{font:800 18px var(--ie-sans,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif);margin:2px 0 4px}",
      ".ie-sub{font:500 13px var(--ie-sans,system-ui);color:var(--ie-mut,#64748b);line-height:1.5;margin-bottom:14px}",
      ".ie-card{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;border:1.5px solid var(--ie-line,#e2e8f0);background:var(--ie-card,#f8fafc);border-radius:14px;padding:14px;margin-bottom:10px;cursor:pointer;transition:border-color .12s,background .12s}",
      ".ie-card.sel{border-color:var(--ie-teal,#0e6e63);background:var(--ie-tealsoft,#e6f4f1)}",
      ".ie-radio{flex:0 0 auto;width:20px;height:20px;border-radius:50%;border:2px solid var(--ie-line,#cbd5e1);margin-top:2px;position:relative}",
      ".ie-card.sel .ie-radio{border-color:var(--ie-teal,#0e6e63)}",
      ".ie-card.sel .ie-radio:after{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--ie-teal,#0e6e63)}",
      ".ie-cmain{flex:1;min-width:0}",
      ".ie-ct{font:700 15px var(--ie-sans,system-ui);display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".ie-pill{font:700 10px var(--ie-sans,system-ui);text-transform:uppercase;letter-spacing:.03em;padding:2px 7px;border-radius:999px}",
      ".ie-pill.free{background:#dcfce7;color:#166534}.ie-pill.pro{background:#fef3c7;color:#92400e}.ie-pill.rec{background:var(--ie-teal,#0e6e63);color:#fff}",
      ".ie-cs{font:500 12.5px var(--ie-sans,system-ui);color:var(--ie-mut,#64748b);margin-top:4px;line-height:1.5}",
      ".ie-warn{font:600 12px var(--ie-sans,system-ui);color:#92400e;background:#fef3c7;border-radius:9px;padding:9px 11px;margin:-2px 0 10px}",
      ".ie-chk{display:flex;align-items:center;gap:9px;font:600 13px var(--ie-sans,system-ui);color:var(--ie-ink,#0f172a);padding:10px 2px;cursor:pointer}",
      ".ie-chk input{width:19px;height:19px;accent-color:var(--ie-teal,#0e6e63);flex:0 0 auto}",
      ".ie-row{display:flex;gap:10px;margin-top:6px}",
      ".ie-btn{flex:1;padding:14px;border-radius:12px;border:0;font:700 15px var(--ie-sans,system-ui);cursor:pointer;background:var(--ie-teal,#0e6e63);color:#fff}",
      ".ie-btn[disabled]{opacity:.45;cursor:default}",
      ".ie-btn.sec{background:transparent;border:1.5px solid var(--ie-line,#e2e8f0);color:var(--ie-ink,#0f172a)}",
      ".ie-link{background:none;border:0;color:var(--ie-teal,#0e6e63);font:600 13px var(--ie-sans,system-ui);cursor:pointer;padding:8px 2px;text-decoration:underline;text-underline-offset:2px}",
      // dark mode (app toggles body.dark; also honour system)
      "body.dark .ie-sheet,:root[data-theme=dark] .ie-sheet{--ie-bg:#0f1a2b;--ie-ink:#e7edf5;--ie-mut:#93a4bd;--ie-line:#24314a;--ie-card:#152238;--ie-tealsoft:#0f2e2a}",
      "@media(prefers-color-scheme:dark){.ie-sheet{--ie-bg:#0f1a2b;--ie-ink:#e7edf5;--ie-mut:#93a4bd;--ie-line:#24314a;--ie-card:#152238;--ie-tealsoft:#0f2e2a}}",
      // settings segmented control (matches .smd-nav-* system)
      ".ie-seg{display:flex;flex-direction:column;gap:8px;padding:4px 0}",
      // iOS-Settings grouped list (inset card, hairline separators, trailing checkmark)
      ".ie-list{border-radius:14px;overflow:hidden;border:1px solid var(--ie-line,#e2e8f0);background:var(--ie-card,#fff);margin-bottom:12px}",
      ".ie-lrow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--ie-line,#e2e8f0);padding:13px 14px;cursor:pointer;color:var(--ie-ink,#0f172a);-webkit-tap-highlight-color:transparent}",
      ".ie-lrow:first-child{border-top:0}",
      ".ie-lrow.sel{background:var(--ie-tealsoft,#e6f4f1)}",
      ".ie-lmain{flex:1;min-width:0}",
      ".ie-lt{font:600 15px var(--ie-sans,system-ui);display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".ie-ls{font:500 12.5px var(--ie-sans,system-ui);color:var(--ie-mut,#64748b);margin-top:3px;line-height:1.45}",
      ".ie-check{flex:0 0 auto;width:20px;text-align:center;color:var(--ie-teal,#0e6e63);font-size:16px;font-weight:800;opacity:0;transition:opacity .12s}",
      ".ie-lrow.sel .ie-check{opacity:1}"
    ].join("");
    document.head.appendChild(s);
  }

  /* ---------------- overlay primitive ---------------- */
  function overlay(innerHTML) {
    injectCSS();
    var ov = document.createElement("div"); ov.className = "ie-ov";
    ov.innerHTML = '<div class="ie-sheet" role="dialog" aria-modal="true">' + innerHTML + "</div>";
    document.body.appendChild(ov);
    return { el: ov, sheet: ov.querySelector(".ie-sheet"), close: function () { try { ov.remove(); } catch (e) {} } };
  }
  // brief non-blocking "processing" indicator during the actual engine call
  function busy(msg) {
    injectCSS();
    var ov = document.createElement("div"); ov.className = "ie-ov"; ov.setAttribute("data-ie-busy", "1");
    ov.innerHTML = '<div class="ie-sheet" style="text-align:center"><div class="ie-h">' + esc(msg) + '</div><div class="ie-sub">One moment…</div></div>';
    document.body.appendChild(ov);
    return function () { try { ov.remove(); } catch (e) {} };
  }

  /* Is the OFFLINE model able to read images right now?
   *
   * Three things must hold: the on-device engine exists, the selected pack can see (Apex is Qwen3
   * text-only), and its projector is downloaded. Offered as a third engine only then, because an
   * option that can only fail is worse than no option.
   */
  function localVisionReady() {
    try {
      var L = window.SMD_MAIK_LOCAL;
      return !!(L && L.visionReady && L.visionReady(L.currentPack()));
    } catch (e) { return false; }
  }

  function engineCard(engine, selected, kind) {
    var isAi = engine === "ai";
    var isLocal = engine === "local";
    var rec = recommendFor(kind) === engine;
    var title = isAi ? "AI Vision" : isLocal ? "On-device AI" : "Private Device OCR";
    var pill = isAi ? '<span class="ie-pill pro">Pro</span>' : '<span class="ie-pill free">Free</span>';
    var recPill = rec ? '<span class="ie-pill rec">Recommended</span>' : "";
    var desc = isAi
      ? "Secure cloud AI — the most accurate reading of any clinical image (labs, ABG, medication lists, monitor & ventilator screens). The image is sent for processing."
      : isLocal
      ? "The downloaded model reads the image on this phone. Nothing is sent anywhere and no AI tokens are used. It understands what it is looking at rather than only extracting text, but it is a small model and can be wrong, so check it against the original."
      : "Runs privately on this device (Apple Vision / ML Kit) — the image never leaves it, but it can be less accurate, especially for screens, handwriting or complex layouts.";
    return '<button type="button" class="ie-lrow' + (selected ? " sel" : "") + '" data-engine="' + engine + '" role="radio" aria-checked="' + selected + '">' +
      '<span class="ie-lmain"><span class="ie-lt">' + esc(title) + " " + pill + recPill + "</span>" +
      '<span class="ie-ls">' + esc(desc) + '</span></span><span class="ie-check" aria-hidden="true">✓</span></button>';
  }

  /* ---------------- A/B: Choose Image Engine sheet ---------------- */
  // resolves { engine, remember } | null (cancel)
  function chooseEngine(kind) {
    return new Promise(function (resolve) {
      var sel = getPref();                                   // default from Settings…
      // …but nudge toward the recommendation for this kind if the user has no explicit pref set.
      if (lget(KEY_ENGINE) == null) sel = recommendFor(kind);
      function body() {
        var rec = recommendFor(kind);
        var helper = rec === "ai"
          ? "AI Vision is recommended for the most accurate reading. Your image is sent securely for processing; on-device OCR stays private but can be less accurate."
          : "Image stays on this device. (AI Vision is unavailable right now.)";
        var warn = (rec === "ai" && sel === "device")
          ? '<div class="ie-warn">⚠️ On-device OCR can be less accurate. AI Vision is recommended for the best accuracy.</div>' : "";
        return '<div class="ie-h">Choose Image Engine</div>' +
          '<div class="ie-sub">' + esc(helper) + "</div>" +
          '<div class="ie-list" role="radiogroup" aria-label="Image engine">' +
          engineCard("device", sel === "device", kind) +
          engineCard("ai", sel === "ai", kind) +
          (localVisionReady() ? engineCard("local", sel === "local", kind) : "") +
          '</div>' +
          warn +
          '<label class="ie-chk"><input type="checkbox" id="ieRemember"><span>Remember my choice</span></label>' +
          '<div class="ie-row"><button class="ie-btn sec" id="ieCancel">Cancel</button><button class="ie-btn" id="ieGo">Continue</button></div>';
      }
      var o = overlay(body());
      function rerender() { o.sheet.innerHTML = body(); wire(); }
      function wire() {
        o.sheet.querySelectorAll(".ie-lrow").forEach(function (c) { c.addEventListener("click", function () { sel = c.getAttribute("data-engine"); var rem = o.sheet.querySelector("#ieRemember"); var remembered = rem && rem.checked; rerender(); var r2 = o.sheet.querySelector("#ieRemember"); if (r2) r2.checked = remembered; }); });
        o.sheet.querySelector("#ieCancel").addEventListener("click", function () { o.close(); resolve(null); });
        o.sheet.querySelector("#ieGo").addEventListener("click", function () { var rem = o.sheet.querySelector("#ieRemember"); o.close(); resolve({ engine: sel, remember: !!(rem && rem.checked) }); });
      }
      wire();
    });
  }

  /* ---------------- C: PHI consent ---------------- */
  // resolves "ai" (confirmed) | "device" | null (dismiss)
  function phiConsent() {
    return new Promise(function (resolve) {
      var o = overlay(
        '<div class="ie-h">Cloud AI processing</div>' +
        '<div class="ie-sub">AI Vision sends the selected clinical image to StewardMD’s secure AI processing service for interpretation. The image may contain patient information. Confirm that you are authorized to process this image and that cloud AI use is permitted by your institution’s privacy policy.</div>' +
        '<label class="ie-chk"><input type="checkbox" id="iePhi"><span>I confirm I am authorized to process this image.</span></label>' +
        // REMEMBER IS A CHOICE NOW, not a side effect. Consent used to be persisted forever the
        // moment it was first granted, without saying so, and the only way back was a Revoke button
        // in Settings. Default OFF: continuing to send patient images to a cloud service should be
        // decided deliberately, not inherited from one tap made in a hurry.
        '<label class="ie-chk"><input type="checkbox" id="ieRemember"><span>Remember my choice (change it in Settings, Image Engine)</span></label>' +
        '<div class="ie-row"><button class="ie-btn sec" id="ieDevice">Use Private Device OCR</button><button class="ie-btn" id="ieAi" disabled>Continue with AI Vision</button></div>'
      );
      var chk = o.sheet.querySelector("#iePhi"), go = o.sheet.querySelector("#ieAi");
      var rem = function () { var r = o.sheet.querySelector("#ieRemember"); return !!(r && r.checked); };
      chk.addEventListener("change", function () { go.disabled = !chk.checked; });
      // The PHI confirmation gates the CLOUD button only: choosing the private path needs no
      // authorisation, because nothing leaves the phone.
      o.sheet.querySelector("#ieDevice").addEventListener("click", function () { o.close(); resolve({ engine: "device", remember: rem() }); });
      go.addEventListener("click", function () { if (!chk.checked) return; o.close(); resolve({ engine: "ai", remember: rem() }); });
    });
  }

  /* Public gate for surfaces that make their OWN cloud image call and so never pass through
   * process() - Scan-Meds cloudFromImage() is one, and it was uploading a photo of a medication
   * list with no consent step at all. Resolves true when the upload may proceed. */
  function ensureCloudConsent() {
    if (getConsent()) return Promise.resolve(true);
    return phiConsent().then(function (c) {
      if (!c || c.engine !== "ai") {
        if (c && c.engine === "device" && c.remember) setPref("device");
        return false;
      }
      if (c.remember) setConsent(true);
      return true;
    }, function () { return false; });
  }

  /* ---------------- F: fallback dialog ---------------- */
  // opts { ai, device, retryLabel }  → resolves "ai" | "device" | "manual" | null
  function fallbackDialog(msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var btns = "";
      if (opts.ai) btns += '<button class="ie-btn" id="ieRetry">' + esc(opts.retryLabel || "Try AI Vision again") + "</button>";
      if (opts.device) btns += '<button class="ie-btn sec" id="ieUseDev">Use Private Device OCR</button>';
      btns += '<button class="ie-btn sec" id="ieManual">Fill manually</button>';
      var o = overlay('<div class="ie-h">Couldn’t read the image</div><div class="ie-sub">' + esc(msg) + '</div><div class="ie-row" style="flex-direction:column">' + btns + "</div>");
      var r = o.sheet.querySelector("#ieRetry"); if (r) r.addEventListener("click", function () { o.close(); resolve("ai"); });
      var d = o.sheet.querySelector("#ieUseDev"); if (d) d.addEventListener("click", function () { o.close(); resolve("device"); });
      o.sheet.querySelector("#ieManual").addEventListener("click", function () { o.close(); resolve("manual"); });
    });
  }

  /* ---------------- D: central router ---------------- */
  function process(opts) {
    opts = opts || {};
    var image = opts.image, kind = opts.kind || "labs";
    var picked = opts.engineOverride ? Promise.resolve({ engine: opts.engineOverride, remember: false }) : chooseEngine(kind);
    return picked.then(function (choice) {
      if (!choice) { log("cancelled at chooser"); return { cancelled: true }; }
      if (choice.remember) setPref(choice.engine);
      return route(choice.engine, image, kind);
    });
  }
  function route(engine, image, kind) {
    if (engine === "local") return routeLocal(image, kind);
    return engine === "ai" ? routeAI(image, kind) : routeDevice(image, kind);
  }

  /* THIRD ENGINE: the downloaded on-device model reads the image itself.
   *
   * Different in kind from the other two, not just in accuracy: OCR extracts text and cloud AI reads
   * a clinical image, while this one is a multimodal model UNDERSTANDING the picture offline. It
   * returns prose, so it is surfaced as { mode:"lines" } - the shape the callers already handle for a
   * reading with no structured fields.
   */
  /* The SAME field schema the cloud engine is asked for.
   *
   * Deliberately copied from VISION_SYS in functions/api/ai/[[path]].js rather than invented here. ICU
   * autofill maps the cloud engine's keys already, so emitting the same keys means the on-device
   * engine feeds the identical review screen with no translation layer - and a translation layer is
   * exactly where a value silently lands in the wrong field.
   */
  var LOCAL_SCHEMA = {
    monitor: '{"hr":num,"sbp":num,"dbp":num,"map":num,"rr":num,"spo2":num,"temp":num,"cvp":num,"etco2":num}',
    ventilator: '{"mode":str,"fio2":num,"peep":num,"tv":num,"rr":num,"peak":num,"plateau":num}',
    abg: '{"ph":num,"paco2":num,"pao2":num,"hco3":num,"be":num,"lactate":num,"fio2":num}',
    labs: '{"na":num,"k":num,"cl":num,"hco3":num,"ca":num,"mg":num,"glu":num,"creat":num,"urea":num,"wbc":num,"hb":num,"plt":num,"inr":num,"crp":num,"bili":num,"ast":num,"alt":num,"lactate":num}',
    all: '{"labs":{...},"abg":{"ph":num,"paco2":num,"pao2":num,"hco3":num,"be":num,"lactate":num,"fio2":num},"vitals":{"hr":num,"sbp":num,"dbp":num,"map":num,"rr":num,"spo2":num,"temp":num},"ventilator":{"mode":str,"fio2":num,"peep":num,"tv":num,"rr":num,"peak":num,"plateau":num}}'
  };

  /* On-device reading. Two shapes, because the callers want different things.
   *
   * ICU snapshot AUTOFILLS fields, so for those kinds the model is asked for JSON in the cloud
   * engine's own schema and the result is parsed. Returning prose there would have meant the doctor
   * re-typing every value, which defeats the point of photographing the monitor.
   *
   * Scan Meds and a plain look at a document want prose, so those still get a reading.
   */
  function routeLocal(image, kind) {
    var L = window.SMD_MAIK_LOCAL;
    if (!L || !L.answer || !localVisionReady()) {
      return Promise.reject(new Error("the on-device model cannot read images yet"));
    }
    var schema = LOCAL_SCHEMA[kind] || (kind === "icu" || kind === "handover" ? LOCAL_SCHEMA.all : null);
    log("kind:", kind, "engine: local", schema ? "shape: json fields" : "shape: prose lines");
    var done = busy("Reading on this device…");

    var ask = schema
      ? "Read this clinical image and return ONLY JSON matching " + schema +
        ". Omit any field you cannot read with confidence. No prose, no explanation, no code fence."
      : (kind === "meds"
          ? "Read this medicine package. Give the drug name, strength and form exactly as printed."
          : "Read this clinical image and say what it shows.");

    // Structured extraction needs a bare EXTRACTOR prompt. The default image prompt asks for findings
    // plus an Interpretation section, which would return prose and break autofill.
    var sysOverride = schema
      ? "You read clinical images and return ONLY the JSON asked for. No prose, no explanation, no " +
        "code fence, no commentary. Omit any field you cannot read with confidence. Never invent a value."
      : null;
    return Promise.resolve(L.answer({ question: ask },
        { images: [stripFileScheme(image)], systemOverride: sysOverride }, null))
      .then(function (r) {
        done();
        if (!r || r.error) throw new Error((r && r.error) || "on-device reading failed");
        var text = String(r.text || "");
        if (schema) {
          var f = parseLooseJson(text);
          // Fall through to lines rather than failing: a partial reading the doctor can see beats an
          // error, and the review screen accepts lines.
          if (f && Object.keys(f).length) { log("local success: fields"); return { mode: "fields", fields: f, lines: [], engine: "local" }; }
          log("local: no parseable fields, falling back to lines");
        }
        var lines = text.split(/\n+/).map(function (t) { return t.trim(); }).filter(Boolean);
        return { mode: "lines", lines: lines, engine: "local" };
      })
      .catch(function (e) { done(); throw e; });
  }

  /* A 4B asked for JSON will wrap it in a code fence, add a sentence before it, or trail a comma.
   * Pull the outermost object out and repair the cheap mistakes rather than discarding a good reading
   * over punctuation. Anything still unparseable returns null and the caller shows prose instead.
   */
  function parseLooseJson(t) {
    var s = String(t || "").replace(/```[a-z]*/gi, "").trim();
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    var body = s.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1");
    try {
      var o = JSON.parse(body);
      return (o && typeof o === "object") ? o : null;
    } catch (e) { return null; }
  }

  /** mtmd wants a filesystem path; a file:// URI would be read as a literal filename. */
  function stripFileScheme(p) { return String(p || "").replace(/^file:\/\//, ""); }

  function routeDevice(image, kind) {
    log("kind:", kind, "engine: device", "shape: none (on-device, no upload)");
    if (!deviceOcrAvailable()) {
      return fallbackDialog("Private Device OCR is unavailable on this device.", { ai: aiAvailable(), device: false }).then(function (f) {
        if (f === "ai") return routeAI(image, kind);
        if (f === "manual") return { mode: "lines", lines: [], engine: "manual" };
        return { cancelled: true };
      });
    }
    var done = busy("Reading on device…");
    return window.SMD_AI.readImageLocal(image, kind).then(function (r) {
      done();
      if (r && r.error) {
        log("device fail:", r.error);
        return fallbackDialog("Private Device OCR is unavailable on this device.", { ai: aiAvailable(), device: false }).then(function (f) {
          if (f === "ai") return routeAI(image, kind);
          if (f === "manual") return { mode: "lines", lines: [], engine: "manual" };
          return { cancelled: true };
        });
      }
      log("device ok:", r.mode);
      r.engine = "device"; return r;
    });
  }

  function routeAI(image, kind) {
    if (!aiAvailable()) return aiFallback("ai-off", image, kind);
    var consentP = getConsent() ? Promise.resolve({ engine: "ai", remember: true }) : phiConsent();
    return consentP.then(function (c) {
      var eng = c && c.engine;
      // "Remember" on the private path means stop routing here at all, not just this once.
      if (eng === "device") { if (c.remember) setPref("device"); return routeDevice(image, kind); }
      if (eng !== "ai") { log("cancelled at consent"); return { cancelled: true }; }
      if (c.remember && !getConsent()) setConsent(true);
      log("kind:", kind, "engine: ai", "shape: image  (POST { image, kind })");
      var done = busy("Reading with AI Vision…");
      // ROOT CAUSE of the account-specific Vision hang: a signed-in session's Firestore sync hogs the
      // single WebView JS thread. MaiK PAUSES Firestore for its call (#568) so it runs clean — Vision
      // did NOT, so it stalled while Firestore synced. Guest (no Firestore) and the fully-cached owner
      // account never stall; a fresh/less-synced account does. Give Vision the SAME pause so every
      // account runs it on a clear thread. Native-only (matches MaiK); auto-resume after 60s safety.
      var _fsR = false, _fsResume = function () { if (_fsR) return; _fsR = true; try { if (window.SMD_DB && SMD_DB.enableNetwork) SMD_DB.enableNetwork(); } catch (e) {} };
      try { if (window.SMD_IS_NATIVE && window.SMD_DB && SMD_DB.disableNetwork) { SMD_DB.disableNetwork(); setTimeout(_fsResume, 60000); } } catch (e) {}
      return window.SMD_AI.vision(image, kind).then(function (r) {
        _fsResume(); done();
        if (r && !r.error) {
          var f = (r.fields && typeof r.fields === "object") ? r.fields : r;
          if (f && (Object.keys(f).length || f.medications)) { log("ai success: fields"); return { mode: "fields", fields: f, lines: [], engine: "ai" }; }
        }
        log("ai failure:", (r && r.error) || "no-fields");
        return aiFallback((r && r.error) || "no-fields", image, kind);
      }).catch(function () { _fsResume(); done(); log("ai failure: error"); return aiFallback("error", image, kind); });
    });
  }

  function aiFallback(reason, image, kind) {
    var msg = reason === "quota" ? "AI Vision is temporarily over its usage limit. Please try again shortly."
      : reason === "entitlement" ? "AI Vision requires StewardMD Pro."
      : reason === "ai-off" ? "AI Vision is turned off. You can use Private Device OCR instead."
      : !online() ? "You appear to be offline — AI Vision needs a connection. Private Device OCR works offline."
      : "AI Vision couldn’t process this image right now.";
    var canRetry = reason !== "entitlement" && reason !== "ai-off" && online();
    return fallbackDialog(msg, { ai: canRetry, device: deviceOcrAvailable(), retryLabel: "Try AI Vision again" }).then(function (f) {
      log("fallback selected:", f || "cancel");
      if (f === "ai") return routeAI(image, kind);
      if (f === "device") return routeDevice(image, kind);
      if (f === "manual") return { mode: "lines", lines: [], engine: "manual" };
      return { cancelled: true };
    });
  }

  /* ---------------- A: Settings section (matches .smd-nav-* system) ---------------- */
  function settingsHTML() {
    var pref = getPref();
    // iOS-Settings grouped list: one inset card, hairline separators, trailing teal ✓ on the active row.
    // Uses the app's theme-aware CSS vars (so it recolours in dark mode inside the sidebar).
    function opt(engine, label, pill, desc, first) {
      var on = pref === engine;
      return '<button type="button" data-ie-opt="' + engine + '" role="radio" aria-checked="' + on + '" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;background:' + (on ? "var(--teal-soft,#e6f4f1)" : "transparent") + ';border:0;' + (first ? "" : "border-top:1px solid var(--line,#e2e8f0);") + 'padding:13px 14px;color:var(--ink,#14202b);-webkit-tap-highlight-color:transparent">' +
        '<span style="flex:1;min-width:0"><span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:600 14px/1.3 var(--sans,system-ui)">' + label + " " + pill + '</span><span style="display:block;font:500 12px/1.45 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:3px">' + desc + '</span></span>' +
        '<span aria-hidden="true" style="flex:0 0 auto;width:20px;text-align:center;color:var(--teal,#0e6e63);font-size:16px;font-weight:800;opacity:' + (on ? "1" : "0") + '">✓</span></button>';
    }
    return '<div class="ie-seg">' +
      '<div role="radiogroup" aria-label="Image engine" style="border:1px solid var(--line,#e2e8f0);border-radius:14px;overflow:hidden;background:var(--card,#fff);margin-bottom:8px">' +
      opt("device", "Private Device OCR", '<span style="font:700 9px/1 var(--sans,system-ui);background:#dcfce7;color:#166534;border-radius:5px;padding:2px 5px;vertical-align:middle">Free</span>', "Uses Apple Vision on iPhone/iPad and ML Kit on Android. Image stays on this device.", true) +
      opt("ai", "AI Vision", '<span style="font:700 9px/1 var(--sans,system-ui);background:#fef3c7;color:#92400e;border-radius:5px;padding:2px 5px;vertical-align:middle">Pro</span>', "Uses secure cloud AI for better monitor and ventilator screen interpretation.", false) +
      '</div>' +
      '<button class="smd-nav-btn" data-ie-privacy="1" style="text-align:left">🔒 Privacy &amp; processing</button>' +
      '</div>';
  }
  function wireSettings(container) {
    var root = container || document;
    root.querySelectorAll("[data-ie-opt]").forEach(function (b) {
      b.addEventListener("click", function () {
        setPref(b.getAttribute("data-ie-opt"));
        // re-render just this section
        var host = b.closest(".ie-seg"); if (host) { host.outerHTML = settingsHTML(); var newHost = root.querySelector(".ie-seg") || document.querySelector(".ie-seg"); wireSettings(newHost && newHost.parentNode ? newHost.parentNode : root); }
      });
    });
    root.querySelectorAll("[data-ie-privacy]").forEach(function (b) { b.addEventListener("click", openPrivacyModal); });
  }

  function openPrivacyModal() {
    var consented = getConsent();
    var o = overlay(
      '<div class="ie-h">Privacy &amp; processing</div>' +
      '<div class="ie-sub"><b>Private Device OCR</b> reads the image entirely on your device (Apple Vision / ML Kit). The image and its text never leave the device.<br><br>' +
      '<b>AI Vision</b> sends the original clinical image to StewardMD’s secure AI processing service so it can interpret screen layouts. The image may contain patient information — only use it where your institution’s privacy policy permits.</div>' +
      '<div class="ie-sub">AI Vision consent: <b>' + (consented ? "granted" : "not granted") + "</b>.</div>" +
      '<div class="ie-row" style="flex-direction:column">' +
      (consented ? '<button class="ie-btn sec" id="ieRevoke">Revoke AI Vision consent</button>' : "") +
      '<button class="ie-btn" id="ieCloseP">Close</button></div>'
    );
    var rv = o.sheet.querySelector("#ieRevoke"); if (rv) rv.addEventListener("click", function () { setConsent(false); o.close(); try { (window.toast || function () {})("AI Vision consent revoked"); } catch (e) {} });
    o.sheet.querySelector("#ieCloseP").addEventListener("click", o.close);
  }

  window.SMD_IMAGE_ENGINE = {
    getPref: getPref, setPref: setPref, getConsent: getConsent, setConsent: setConsent,
    isPro: isPro, recommendFor: recommendFor, aiAvailable: aiAvailable, deviceOcrAvailable: deviceOcrAvailable,
    ensureCloudConsent: ensureCloudConsent, getConsent: getConsent, setConsent: setConsent,
    process: process, settingsHTML: settingsHTML, wireSettings: wireSettings, openPrivacyModal: openPrivacyModal,
    KEY_ENGINE: KEY_ENGINE, KEY_CONSENT: KEY_CONSENT
  };
})();
