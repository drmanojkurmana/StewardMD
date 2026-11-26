/* StewardMD - ResearchMD Shell (window.SMD_RESEARCH).
 * ES5 only, buildless, mobile-first.
 * Shell overlay (#researchMD with [hidden]{display:none!important}),
 * navigation, house dark green palette, and screen mounting.
 */
(function (G) {
  "use strict";

  var D = G.document;
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};

  var FLAG = "smd_research";
  var root = null;
  var currentScreen = "projects";
  var navStack = [];

  /* Escaping helper: one shared helper for all ResearchMD screens per contract. */
  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  SMD.esc = esc;

  /* Native CapacitorHttp plugin reference when available. */
  function capHttp() {
    return (G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.CapacitorHttp) || G.CapacitorHttp || null;
  }

  var PHI_OVERRIDE_TERMS_VERSION = "rmd-phi-override-v0";
  /* DRAFT terms, needs legal review */
  var PHI_OVERRIDE_TERMS_TEXT = "By continuing, you confirm that you have the right to share this text, that it is needed for this draft, and that you accept responsibility under the DPDP Act 2023 and your institution's rules. StewardMD logs this override (user, time, and identifier type, never the text itself). Always check AI output before use.";

  var PHI_CATEGORY_LABELS = {
    phone: "Phone number",
    date: "Date",
    dates: "Date",
    dob: "Date of birth",
    admission_date: "Admission or discharge date",
    uhid: "Hospital or registration ID number",
    mrn: "Medical record or hospital ID number",
    aadhaar: "Aadhaar ID number",
    abha: "ABHA health ID or address",
    ssn: "National ID number",
    nhs: "NHS ID number",
    pin: "PIN or postal code (address)",
    address: "Address",
    email: "Email address",
    patient_name: "Name",
    name: "Name",
    id: "ID number"
  };

  function phiCategoryLabel(cat) {
    var key = String(cat || "").toLowerCase();
    if (key && Object.prototype.hasOwnProperty.call(PHI_CATEGORY_LABELS, key)) {
      return PHI_CATEGORY_LABELS[key];
    }
    var cleaned = String(cat || "").replace(/[_-]+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!cleaned) return "Personal or patient identifier";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function phiBlockedError(categories) {
    var err = new Error("Remove patient identifiers (names, IDs, phone numbers, dates) before drafting.");
    err.code = "phi_blocked";
    err.status = 0;
    err.categories = Array.isArray(categories) ? categories.slice() : [];
    return err;
  }

  function hasPhiModules() {
    return typeof G.SMD_redactPHI === "function" &&
      G.SMD_PHI_INDIA && typeof G.SMD_PHI_INDIA.apply === "function" &&
      G.RMDPhi && typeof G.RMDPhi.scan === "function";
  }

  function scrubPhiInput(val, state) {
    if (typeof val === "string") {
      var s = G.SMD_redactPHI(val);
      s = G.SMD_PHI_INDIA.apply(s);
      var hits = G.RMDPhi.scan(s);
      if (hits && hits.length) {
        state.blocked = true;
        for (var hi = 0; hi < hits.length; hi++) {
          var hit = hits[hi];
          var cat = hit && (hit.category || hit.type || hit.kind);
          if (cat && !state.catMap[cat]) {
            state.catMap[cat] = true;
            state.categories.push(cat);
          }
        }
      }
      return s;
    }
    if (Array.isArray(val)) {
      var arr = new Array(val.length);
      for (var i = 0; i < val.length; i++) {
        arr[i] = scrubPhiInput(val[i], state);
      }
      return arr;
    }
    if (val && typeof val === "object") {
      var out = {};
      var keys = Object.keys(val);
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        out[k] = scrubPhiInput(val[k], state);
      }
      return out;
    }
    return val;
  }

  function copyWithRedactedInput(body) {
    var copy = {};
    var keys = Object.keys(body);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      copy[k] = body[k];
    }
    var state = { blocked: false, categories: [], catMap: {} };
    copy.input = scrubPhiInput(body.input, state);
    return { body: copy, blocked: state.blocked, categories: state.categories };
  }

  function withPhiOverride(body) {
    var next = {};
    if (body && typeof body === "object") {
      var keys = Object.keys(body);
      for (var i = 0; i < keys.length; i++) {
        next[keys[i]] = body[keys[i]];
      }
    }
    next.phiOverride = {
      accepted: true,
      termsVersion: PHI_OVERRIDE_TERMS_VERSION
    };
    return next;
  }

  function phiOverrideHost() {
    var host = root;
    if (!host && D && typeof D.querySelector === "function") {
      host = D.querySelector("#researchMD");
    }
    if (host && typeof host.appendChild === "function" && D && typeof D.createElement === "function") {
      return host;
    }
    return null;
  }

  var activePhiOverrideCancel = null;

  function openPhiOverrideDialog(categories, originalErr) {
    var host = phiOverrideHost();
    if (!host) return Promise.reject(originalErr);

    if (typeof activePhiOverrideCancel === "function") {
      activePhiOverrideCancel();
    }

    try { injectCSS(); } catch (e) {}

    var back = D.createElement("div");
    if (!back || typeof back.querySelector !== "function") {
      return Promise.reject(originalErr);
    }

    var catList = [];
    var seenLabel = {};
    var rawCats = Array.isArray(categories) ? categories : [];
    for (var i = 0; i < rawCats.length; i++) {
      var lbl = phiCategoryLabel(rawCats[i]);
      if (!seenLabel[lbl]) {
        seenLabel[lbl] = true;
        catList.push(lbl);
      }
    }
    if (!catList.length) {
      catList.push("Personal or patient identifier");
    }

    var itemsHtml = "";
    for (var j = 0; j < catList.length; j++) {
      itemsHtml += "<li>" + esc(catList[j]) + "</li>";
    }

    back.className = "rmd-modal-backdrop";
    back.id = "rmdPhiOverrideModal";
    back.innerHTML =
      '<div class="rmd-modal-card rmd-phi-ovr-card" role="dialog" aria-modal="true" aria-labelledby="rmdPhiOverrideTitle" aria-describedby="rmdPhiOverrideTerms" tabindex="-1">' +
        '<div class="rmd-modal-header rmd-modal-warn">' +
          '<h3 id="rmdPhiOverrideTitle">Possible patient identifiers</h3>' +
        '</div>' +
        '<p class="rmd-phi-ovr-lead">Before sending this draft, check your text for the following identifier types:</p>' +
        '<ul class="rmd-phi-ovr-cats">' + itemsHtml + '</ul>' +
        '<div class="rmd-phi-ovr-terms" id="rmdPhiOverrideTerms">' +
          '<p>' + esc(PHI_OVERRIDE_TERMS_TEXT) + '</p>' +
        '</div>' +
        '<label class="rmd-phi-ovr-check" for="rmdPhiOverrideAccept">' +
          '<input type="checkbox" id="rmdPhiOverrideAccept" data-rmd-phi-accept="1" />' +
          '<span>I accept these terms</span>' +
        '</label>' +
        '<div class="rmd-modal-footer rmd-phi-ovr-footer">' +
          '<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-phi-edit="1">Edit my text</button>' +
          '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-phi-send="1" disabled>I take responsibility, send anyway</button>' +
        '</div>' +
      '</div>';

    var card = back.querySelector('[role="dialog"]');
    var checkbox = back.querySelector('[data-rmd-phi-accept="1"]');
    var editBtn = back.querySelector('[data-rmd-phi-edit="1"]');
    var sendBtn = back.querySelector('[data-rmd-phi-send="1"]');

    if (!card || !checkbox || !editBtn || !sendBtn) {
      return Promise.reject(originalErr);
    }

    host.appendChild(back);

    var prevFocused = null;
    try { prevFocused = D.activeElement || null; } catch (fe) { prevFocused = null; }

    return new Promise(function (resolve, reject) {
      var settled = false;
      var keyHandler = null;

      function cleanup() {
        if (back.parentNode) back.parentNode.removeChild(back);
        if (keyHandler && D && typeof D.removeEventListener === "function") {
          D.removeEventListener("keydown", keyHandler);
        }
        if (activePhiOverrideCancel === cancel) {
          activePhiOverrideCancel = null;
        }
        if (prevFocused && typeof prevFocused.focus === "function") {
          try { prevFocused.focus(); } catch (re) {}
        }
      }

      function cancel() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(originalErr);
      }

      function confirm() {
        if (settled || !checkbox.checked) return;
        settled = true;
        cleanup();
        resolve(true);
      }

      activePhiOverrideCancel = cancel;

      checkbox.addEventListener("change", function () {
        sendBtn.disabled = !checkbox.checked;
      });
      editBtn.addEventListener("click", cancel);
      sendBtn.addEventListener("click", confirm);
      back.addEventListener("click", function (e) {
        if (e && e.target === back) cancel();
      });

      keyHandler = function (e) {
        if (!e) return;
        if (e.key === "Escape" || e.keyCode === 27) {
          if (typeof e.preventDefault === "function") e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();
          cancel();
          return;
        }
        if (e.key === "Tab") {
          var focusables = [checkbox, editBtn];
          if (!sendBtn.disabled) focusables.push(sendBtn);
          var active = null;
          try { active = D.activeElement; } catch (ae) {}
          var idx = focusables.indexOf(active);
          if (e.shiftKey) {
            if (idx <= 0) {
              if (typeof e.preventDefault === "function") e.preventDefault();
              if (typeof focusables[focusables.length - 1].focus === "function") {
                focusables[focusables.length - 1].focus();
              }
            }
          } else if (idx === focusables.length - 1 || idx === -1) {
            if (typeof e.preventDefault === "function") e.preventDefault();
            if (typeof focusables[0].focus === "function") {
              focusables[0].focus();
            }
          }
        }
      };

      if (D && typeof D.addEventListener === "function") {
        D.addEventListener("keydown", keyHandler);
      }

      if (typeof editBtn.focus === "function") {
        try { editBtn.focus(); } catch (f1) {}
      } else if (typeof card.focus === "function") {
        try { card.focus(); } catch (f2) {}
      }
    });
  }

  function dispatchRequest(method, path, body, options) {
    var headers = { "Accept": "application/json" };
    var opts = { method: method, headers: headers };
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    var isLongAiRoute = path && /\/(?:ai-draft|paper-card\/explain|extraction\/suggestions|screening-suggestions|grade-suggestions|studies\/auto-add|find-studies)(?:[/?#]|$)/.test(path);
    var timeoutMs = (options && options.timeout) || (isLongAiRoute ? 90000 : 30000);
    opts.timeout = timeoutMs;
    opts.readTimeout = timeoutMs;

    var tokenP;
    try {
      var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
      tokenP = (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null);
    } catch (e) { tokenP = Promise.resolve(null); }
    return Promise.resolve(tokenP).then(function (token) {
      if (token) headers["Authorization"] = "Bearer " + token;
      var Http = capHttp();
      if (Http && typeof Http.request === "function") {
        headers["X-SMD-App"] = "smdapp_ddc578ad04b399a332e53e04706433d96803e91c2d373b7d";
        var baseOrigin = G.SMD_API_BASE || (G.location && G.location.origin) || "";
        var reqOpts = {
          url: baseOrigin + "/api/research" + path,
          method: (method || "GET").toUpperCase(),
          headers: headers,
          data: (body !== undefined && body !== null) ? body : undefined,
          connectTimeout: 30000,
          readTimeout: timeoutMs
        };
        return Http.request(reqOpts).then(function (res) {
          var data = res && res.data;
          if (typeof data === "string") {
            try { data = JSON.parse(data); } catch (ex) {}
          }
          var statusCode = (res && res.status) || 200;
          if (statusCode >= 400 || statusCode === 0) {
            var env = (data && data.error) || {};
            var err = new Error(env.message || ("Request failed (HTTP " + statusCode + "). Retry, or check the project role."));
            err.status = statusCode;
            err.code = env.code || ("http_" + statusCode);
            err.current = data && data.current;
            err.body = data;
            if (data && Array.isArray(data.categories)) err.categories = data.categories.slice();
            err.requestId = env.requestId;
            throw err;
          }
          return data || {};
        });
      }
      return G.fetch("/api/research" + path, opts).then(function (res) {
        return res.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
          if (!res.ok) {
            var env = (data && data.error) || {};
            var err = new Error(env.message || ("Request failed (HTTP " + res.status + "). Retry, or check the project role."));
            err.status = res.status;
            err.code = env.code || ("http_" + res.status);
            err.current = data && data.current;
            err.body = data;
            if (data && Array.isArray(data.categories)) err.categories = data.categories.slice();
            err.requestId = env.requestId;
            throw err;
          }
          return data || {};
        });
      });
    }).catch(function (e) {
      var msg = String((e && (e.message || e.errorMessage || e.code)) || "");
      var isTout = (e && (e.code === "timeout" || e.code === "SocketTimeoutException" || e.code === "http_504" || e.code === "http_408" || e.status === 504 || e.status === 408)) ||
        /SocketTimeoutException|timed?\s*out|ETIMEDOUT/i.test(msg) || (e && (e.name === "TimeoutError" || e.name === "AbortError"));
      if (isTout) {
        var tout = new Error("MaiK is taking longer than usual. Try again.");
        tout.code = "timeout";
        tout.status = 408;
        throw tout;
      }
      if (e && e.code) throw e;
      var net = new Error("Cannot reach the research service. Check the connection and retry.");
      net.code = "network";
      net.status = 0;
      throw net;
    });
  }

  /* Phase 2 API client: calls stewardmd.in/api/research/v1 per the frozen
   * contracts (docs/research/contracts/phase-2). Firebase ID token from
   * SMD_AUTH when present; errors normalize to {code, status, current}. */
  function apiRequest(method, path, body, options) {
    var isAiDraft = String(method || "").toUpperCase() === "POST" && path && /\/ai-draft(\?|$)/.test(path);
    var sendBody = body;
    var clientBlockedErr = null;

    if (isAiDraft && body && body.input !== undefined && body.input !== null) {
      if (!hasPhiModules()) {
        return Promise.reject(phiBlockedError([]));
      }
      try {
        var phiRes = copyWithRedactedInput(body);
        sendBody = phiRes.body;
        if (phiRes.blocked) {
          clientBlockedErr = phiBlockedError(phiRes.categories);
        }
      } catch (phiEx) {
        return Promise.reject(phiBlockedError([]));
      }
    }

    if (clientBlockedErr) {
      return openPhiOverrideDialog(clientBlockedErr.categories, clientBlockedErr).then(function () {
        return dispatchRequest(method, path, withPhiOverride(sendBody), options);
      });
    }

    return dispatchRequest(method, path, sendBody, options).catch(function (err) {
      if (isAiDraft && err && err.status === 422 && err.code === "phi_blocked" &&
          err.body && err.body.overridable === true) {
        var cats = err.categories || (Array.isArray(err.body.categories) ? err.body.categories : []);
        return openPhiOverrideDialog(cats, err).then(function () {
          return dispatchRequest(method, path, withPhiOverride(sendBody), options);
        });
      }
      throw err;
    });
  }

  function apiUpload(path, formData) {
    var headers = { "Accept": "application/json" };
    var tokenP;
    try {
      var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
      tokenP = (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null);
    } catch (e) { tokenP = Promise.resolve(null); }
    return Promise.resolve(tokenP).then(function (token) {
      if (token) headers["Authorization"] = "Bearer " + token;
      return G.fetch("/api/research" + path, { method: "POST", headers: headers, body: formData });
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!res.ok) {
          var env = (data && data.error) || {};
          var err = new Error(env.message || ("Upload failed (HTTP " + res.status + "). Retry with a smaller file."));
          err.status = res.status;
          err.code = env.code || ("http_" + res.status);
          throw err;
        }
        return data || {};
      });
    }).catch(function (e) {
      if (e && e.code) throw e;
      var net = new Error("Cannot reach the research service. Check the connection and retry.");
      net.code = "network";
      net.status = 0;
      throw net;
    });
  }

  SMD.api = { request: apiRequest, upload: apiUpload };

  /* Shared Phase 2 screen helpers (one escaping helper above, one date
   * formatter, one error banner, one download path). */
  function fmtTs(ts) {
    if (!ts) return "";
    try {
      var d = new Date(ts);
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function friendlyError(err) {
    var e = err || {};
    var code = e.code || "";
    var status = e.status || 0;
    if (!status && String(code).indexOf("http_") === 0) {
      status = parseInt(String(code).slice(5), 10) || 0;
    }
    if (!code && !status) {
      if (/SocketTimeoutException|timed?\s*out|ETIMEDOUT/i.test(String(e.message || ""))) {
        return { message: "MaiK is taking longer than usual. Try again.", action: "retry", actionLabel: "Try again" };
      }
      return { message: e.message || "Something went wrong on our side.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "link_unrecognised") {
      return { message: e.message || "We could not recognise this link. Check the link and try again.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "paper_not_found") {
      return { message: "We could not find this study. Check the link.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "not_needed") {
      return { message: e.message || "An explanation is not needed for this study.", action: "retry", actionLabel: "Close" };
    }
    if (code === "unauthorized" || status === 401) {
      return { message: "Please sign in to use ResearchMD.", action: "signin", actionLabel: "Sign in" };
    }
    if (code === "project_not_found") {
      return { message: "We could not open this project on your account.", action: "save-or-back", actionLabel: "" };
    }
    if (code === "not_member" || code === "forbidden" || status === 403) {
      return {
        message: "We could not open this project on your account.",
        sub: "Only the project owner can fix this. Ask them to add you as an editor.",
        action: "back", actionLabel: "Back to projects"
      };
    }
    if (code === "invalid_search") {
      var msg = String(e.message || "");
      if (/semantic scholar/i.test(msg)) {
        return { message: "Semantic Scholar is not available yet. Please search PubMed, Europe PMC, or Crossref instead.", action: "retry", actionLabel: "Try again" };
      }
      if (/filter/i.test(msg)) {
        return { message: "One of the search filters is not supported for this database. Clear extra filters and try again.", action: "retry", actionLabel: "Try again" };
      }
      if (/date/i.test(msg)) {
        return { message: "Please enter a valid date upper bound (YYYY-MM-DD) and try again.", action: "retry", actionLabel: "Try again" };
      }
      if (/query/i.test(msg)) {
        return { message: "Search query must be between 1 and 4,000 characters.", action: "retry", actionLabel: "Try again" };
      }
      if (/contact_email|not configured/i.test(msg)) {
        return { message: "Literature search needs server contact setup before connecting. Please try again later.", action: "retry", actionLabel: "Try again" };
      }
      return { message: "Check your search query, filters, or database selection and try again.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "search_rate_limited" || status === 429) {
      if (/100 requests|off-peak/i.test(String(e.message || ""))) {
        return { message: "This search matched too many articles for daytime PubMed limits. Narrow your query (e.g. add trial or a date range) or use Europe PMC.", action: "retry", actionLabel: "Try again" };
      }
      return { message: "Database rate limit reached. Wait a moment and try again, or try Europe PMC.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "search_unconfigured") {
      return { message: "Literature search is temporarily unavailable on the server. Please try again later.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "search_failed") {
      return { message: "The database search could not finish. Narrow your query or try another database.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "insufficient_credits" || status === 402) {
      return { message: "You need more MaiK tokens for this step.", action: "credits", actionLabel: "Add tokens" };
    }
    if (code === "token_mismatch" || code === "token_missing") {
      return { message: e.message || "Token preservation failure (values changed or missing)", action: "retry", actionLabel: "Try again" };
    }
    if (code === "no_project") {
      return { message: e.message || "Save or create a synced project first to use MaiK summaries.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "phi_blocked") {
      return { message: e.message || "Patient identifiers were detected. Remove names, hospital numbers, phone numbers, addresses or emails and try again.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "consent_needed") {
      return { message: e.message || "Please confirm there are no patient names left in your thesis before continuing.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "ceiling_bytes" || status === 413) {
      return { message: "This file is too large for server upload (limit 25 MB). Upload a smaller file or a Word (.docx) document.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "ceiling_input_tokens") {
      return { message: "This text is too large for a single AI call. Try trimming appendices or drafting section by section.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "docx_needs_pdf") {
      return { message: e.message || "Please upload a valid .docx or PDF file.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "storage_unavailable" || code === "queue_unavailable") {
      return { message: "Server document OCR is unavailable right now. Export as selectable-text PDF or .docx and upload again.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "invalid_multipart" || code === "missing_file" || code === "file_type") {
      return { message: e.message || "The uploaded file could not be processed. Try a selectable-text PDF or Word (.docx) file.", action: "retry", actionLabel: "Try again" };
    }
    var isTimeout = code === "timeout" || code === "timed_out" || code === "SocketTimeoutException" ||
      code === "http_504" || code === "http_408" || status === 504 || status === 408 ||
      /SocketTimeoutException|timed?\s*out|ETIMEDOUT/i.test(String(code + " " + (e.message || "")));
    if (isTimeout) {
      return { message: "MaiK is taking longer than usual. Try again.", action: "retry", actionLabel: "Try again" };
    }
    if (code === "network" || status === 0 || status >= 500) {
      return { message: "No connection right now. Your work is saved; try again in a moment.", action: "retry", actionLabel: "Try again" };
    }
    return { message: "Something went wrong on our side.", action: "retry", actionLabel: "Try again" };
  }

  function errHtml(err, retryAttr) {
    var e = err || {};
    var f = friendlyError(e);
    var h = '<div class="rmd-banner rmd-banner-error" role="alert">';
    h += '<strong>' + esc(f.message) + '</strong>';
    if (f.sub) h += '<span class="rmd-banner-sub">' + esc(f.sub) + '</span>';
    if (f.action === "signin") {
      h += '<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-action="signin">' + esc(f.actionLabel) + '</button>';
    } else if (f.action === "credits") {
      h += '<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-action="credits">' + esc(f.actionLabel) + '</button>';
    } else if (f.action === "save-or-back") {
      var p = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
      if (p && !p.serverId) h += '<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-action="save">Save it to my account</button>';
      h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-action="projects">Back to projects</button>';
    } else if (f.action === "back") {
      h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-action="projects">' + esc(f.actionLabel) + '</button>';
    } else if (retryAttr) {
      h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="' + esc(retryAttr) + '">Try again</button>';
    } else {
      h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-action="retry">Try again</button>';
    }
    if ((e.code || e.status) && e.code !== "link_unrecognised") {
      h += '<details class="rmd-banner-details"><summary>Details for support</summary>';
      h += '<span class="rmd-banner-code">Code: ' + esc(e.code || "unknown") + (e.status ? " (HTTP " + e.status + ")" : "") + '</span>';
      h += '</details>';
    }
    h += '</div>';
    return h;
  }

  function loadingHtml(label) {
    return '<div class="rmd-loading" aria-live="polite">' + esc(label || "Loading") + '&#8230;</div>';
  }

  function reasonLabel(code, reasons) {
    if (!code) return "";
    for (var i = 0; i < (reasons || []).length; i++) {
      if (reasons[i].code === code) return reasons[i].label || code;
    }
    return code;
  }

  /* One save/share path for every ResearchMD export. In the native app an
   * <a download> click does nothing, so files go through Filesystem + Share
   * (same pattern as share-card.js). The blob path stays for the test harness. */
  function isNativeApp() {
    var C = typeof window !== "undefined" ? window.Capacitor : null;
    if (!C) return false;
    if (typeof C.isNativePlatform === "function") return !!C.isNativePlatform();
    return !!(C.platform && C.platform !== "web");
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = function () { reject(r.error || new Error("read_failed")); };
      r.readAsDataURL(blob);
    });
  }

  function isShareCancel(err) {
    if (!err) return false;
    if (err.name === "AbortError") return true;
    return /cancel/i.test(String(err.message || err));
  }

  function saveFile(filename, blob, title) {
    return new Promise(function (resolve, reject) {
      if (isNativeApp() && window.Capacitor.Plugins &&
          window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {
        blobToBase64(blob).then(function (b64) {
          return window.Capacitor.Plugins.Filesystem.writeFile({
            path: filename, data: b64, directory: "CACHE"
          });
        }).then(function (w) {
          return window.Capacitor.Plugins.Share.share({
            title: title || filename,
            url: w.uri,
            dialogTitle: "Save or send your file"
          });
        }).then(function (res) {
          resolve(res || {});
        }, function (err) {
          if (isShareCancel(err)) {
            resolve({ cancelled: true });
            return;
          }
          reject(err);
        });
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = D.createElement("a");
      a.href = url;
      a.download = filename;
      D.body.appendChild(a);
      a.click();
      D.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      resolve({});
    });
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8;" });
    return saveFile(filename, blob, filename);
  }

  function downloadBytes(filename, bytes, mime, title) {
    var blob = new Blob([bytes], { type: mime || "application/octet-stream" });
    return saveFile(filename, blob, title || filename);
  }

  /* Readable ASCII filename stem from a project or paper title. */
  function fileSlug(title, fallback) {
    var s = String(title || "").replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
    if (s.length > 60) s = s.slice(0, 60).replace(/-+$/, "");
    return s || fallback || "researchmd";
  }

  /* Brief in-screen confirmation/error banner for exports (auto-clears info). */
  function flashNotice(container, message, kind) {
    if (!container) return;
    var old = container.querySelector(".rmd-flash-notice");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = D.createElement("div");
    el.className = "rmd-flash-notice rmd-banner " + (kind === "error" ? "rmd-banner-error" : "rmd-banner-info");
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.textContent = message;
    container.insertBefore(el, container.firstChild);
    if (kind !== "error") {
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4000);
    }
  }

  SMD.p2 = {
    fmtTs: fmtTs,
    errHtml: errHtml,
    friendlyError: friendlyError,
    loadingHtml: loadingHtml,
    reasonLabel: reasonLabel,
    downloadText: downloadText,
    downloadBytes: downloadBytes,
    saveFile: saveFile,
    fileSlug: fileSlug,
    flashNotice: flashNotice,
    saveProjectToAccount: saveActiveProjectToAccount
  };

  /* Shared "Ask MaiK to draft it" bar. One helper for every step: the draft
   * only fills local form state (marked "Drafted by MaiK, check it"); each
   * screen's own Save button is the only write. opts: { pid, task, label,
   * cost, input(), apply(draft, res) -> [fieldKeys], render(), request() }. */
  function aiState() {
    return { busy: false, error: null, drafted: {} };
  }

  function aiBarHtml(st, opts) {
    var o = opts || {};
    var cost = typeof o.cost === "number" ? o.cost : 2;
    var h = '<div class="rmd-ai-bar">';
    h += '<div class="rmd-ai-actions">';
    h += '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-ai="ask"' + (st.busy ? " disabled" : "") + '><span class="rmd-ai-mark" aria-hidden="true">R</span>Ask MaiK to draft it</button>';
    h += '<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-ai="manual">Do it myself</button>';
    h += '</div>';
    h += '<p class="rmd-ai-cost">' + (cost > 0 ? "Costs about " + cost + " MaiK token" + (cost === 1 ? "" : "s") : "No MaiK tokens needed") + '</p>';
    if (st.busy) h += '<p class="rmd-ai-progress" role="status">MaiK is drafting your ' + esc(o.label || "draft") + '&#8230;</p>';
    if (st.error) h += errHtml(st.error);
    h += '</div>';
    return h;
  }

  function aiBind(container, st, opts) {
    var o = opts || {};
    var manual = container.querySelector('[data-rmd-ai="manual"]');
    if (manual) {
      manual.onclick = function () {
        var f = container.querySelector("input, textarea, select");
        if (f && f.focus) f.focus();
      };
    }
    var ask = container.querySelector('[data-rmd-ai="ask"]');
    if (ask) {
      ask.onclick = function () {
        if (st.busy) return;
        st.busy = true;
        st.error = null;
        if (o.render) o.render();
        var run;
        if (o.request) {
          run = o.request();
        } else {
          var body = { task: o.task };
          if (o.input) body.input = o.input();
          run = SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(o.pid) + "/ai-draft", body, { timeout: 90000 });
        }
        Promise.resolve(run).then(function (res) {
          st.busy = false;
          var draft = res && res.draft !== undefined ? res.draft : res;
          var keys = o.apply ? o.apply(draft, res) : [];
          for (var i = 0; i < (keys || []).length; i++) st.drafted[keys[i]] = 1;
          if (o.render) o.render();
        }).catch(function (err) {
          st.busy = false;
          if (err && err._handledByConsent) {
            st.error = null;
            if (o.render) o.render();
            if (o.onConsentNeeded) o.onConsentNeeded(err);
            return;
          }
          st.error = err || { message: "MaiK could not draft this step." };
          if (o.render) o.render();
        });
      };
    }
  }

  function aiNoteHtml(st, key) {
    if (!st || !st.drafted || !st.drafted[key]) return "";
    return '<span class="rmd-ai-note" data-rmd-ai-note="' + esc(key) + '">Drafted by MaiK, check it</span>';
  }

  function aiClearNote(st, key) {
    if (st && st.drafted) delete st.drafted[key];
    var el = D.querySelector('[data-rmd-ai-note="' + key + '"]');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  SMD.ai = {
    state: aiState,
    barHtml: aiBarHtml,
    bind: aiBind,
    noteHtml: aiNoteHtml,
    clearNote: aiClearNote
  };

  /* Feature flag: DEFAULT ON (owner 2026-11-24). Off per device with ?research=0 or localStorage.smd_research = "0" */
  function on() {
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]research=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(FLAG) !== "0";
      }
    } catch (e) {}
    return true;
  }

  function injectCSS() {
    if (!D || !D.head || (D.getElementById && D.getElementById("rmdCss"))) return;
    var s = D.createElement("style");
    s.id = "rmdCss";
    s.textContent = [
      "/* ResearchMD Shell & Overlay */",
      "#researchMD {",
      "  /* Owner palette 2026-11-24: Deep Navy #111C44, Dark Ocean #002B4C, Cobalt #2457FF, Pale Sky #D8E3FF, Ice #C0EBFF, Cream #F8F1E4, Sand #B7AD9E, Summer Orange #F59E71 */",
      "  --rmd-bg: #f8f1e4;",
      "  --rmd-panel: #fffdf9;",
      "  --rmd-ink: #111c44;",
      "  --rmd-mut: #5b607a;",
      "  --rmd-line: #e5ddce;",
      "  --rmd-acc: #1b41bf;",
      "  --rmd-acc-soft: #e4e9f8;",
      "  --rmd-acc-dark: #142f8c;",
      "  --rmd-warn: #a34e1c;",
      "  --rmd-warn-soft: #fdebdf;",
      "  --rmd-bad: #b42318;",
      "  --rmd-bad-soft: #fdecea;",
      "  --rmd-fill: rgba(17, 28, 68, 0.06);",
      "  --rmd-acc-grad: linear-gradient(180deg, #2349c9 0%, #1b41bf 50%, #17379f 100%);",
      "  --rmd-wash: radial-gradient(85% 60% at 0 0, rgba(216, 227, 255, 0.95) 0, rgba(216, 227, 255, 0) 72%), radial-gradient(70% 55% at 100% 0, rgba(192, 235, 255, 0.9) 0, rgba(192, 235, 255, 0) 70%), radial-gradient(45% 38% at 92% 4%, rgba(245, 158, 113, 0.22) 0, rgba(245, 158, 113, 0) 100%), linear-gradient(180deg, #dde5fa 0, #e8ecf4 40%, rgba(248, 241, 228, 0) 100%);",
      "  --rmd-logo-a: #2457ff;",
      "  --rmd-logo-b: #111c44;",
      "  --rmd-lift: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px rgba(17, 28, 68, 0.22), 0 3px 8px -3px rgba(17, 28, 68, 0.28);",
      "  --rmd-f: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;",
      "  --rmd-mono: ui-monospace, 'SF Mono', Menlo, monospace;",
      "  position: fixed;",
      "  inset: 0;",
      "  z-index: 10050;",
      "  background: var(--rmd-wash), var(--rmd-bg);",
      "  background-size: 100% 440px, 100% 440px, 100% 440px, 100% 440px, auto;",
      "  background-repeat: no-repeat;",
      "  color: var(--rmd-ink);",
      "  font: 14.5px/1.45 var(--rmd-f);",
      "  display: flex;",
      "  flex-direction: column;",
      "  -webkit-font-smoothing: antialiased;",
      "  box-sizing: border-box;",
      "}",
      "/* Crucial house overlay rule: [hidden] MUST beat display:flex */",
      "#researchMD[hidden] {",
      "  display: none !important;",
      "}",
      "body.dark #researchMD, body.v3-dark #researchMD {",
      "  --rmd-bg: #0a1230;",
      "  --rmd-panel: #111c44;",
      "  --rmd-ink: #f8f1e4;",
      "  --rmd-mut: #a7b0cc;",
      "  --rmd-line: #243266;",
      "  --rmd-acc: #8aa6ff;",
      "  --rmd-acc-soft: #1b2a66;",
      "  --rmd-acc-dark: #5c7fff;",
      "  --rmd-warn: #f59e71;",
      "  --rmd-warn-soft: #3a2418;",
      "  --rmd-bad: #ff7b6e;",
      "  --rmd-bad-soft: #3a1714;",
      "  --rmd-fill: rgba(216, 227, 255, 0.08);",
      "  --rmd-wash: radial-gradient(85% 60% at 0 0, rgba(36, 87, 255, 0.32) 0, rgba(36, 87, 255, 0) 72%), radial-gradient(70% 55% at 100% 0, rgba(0, 43, 76, 0.95) 0, rgba(0, 43, 76, 0) 70%), radial-gradient(45% 38% at 92% 4%, rgba(245, 158, 113, 0.1) 0, rgba(245, 158, 113, 0) 100%), linear-gradient(180deg, #121d4a 0, #0d1739 42%, rgba(10, 18, 48, 0) 100%);",
      "  --rmd-logo-b: #f8f1e4;",
      "  --rmd-lift: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 2px rgba(0, 0, 0, 0.45), 0 3px 8px -3px rgba(0, 0, 0, 0.5);",
      "}",
      "#researchMD * { box-sizing: border-box; }",
      "#researchMD { accent-color: var(--rmd-acc); caret-color: var(--rmd-acc); }",
      "#researchMD ::selection { background: rgba(27, 65, 191, 0.2); }",
      "#researchMD :focus-visible { outline: 2px solid var(--rmd-acc); outline-offset: 2px; }",
      "/* Top Shell Bar */",
      "#researchMD .rmd-shell-top {",
      "  display: grid;",
      "  grid-template-columns: auto 1fr auto;",
      "  align-items: center;",
      "  gap: 12px;",
      "  padding: calc(env(safe-area-inset-top, 0px) + 6px) 14px 8px;",
      "  background: transparent;",
      "  color: var(--rmd-ink);",
      "  position: relative;",
      "  z-index: 10;",
      "}",
      "#researchMD .rmd-shell-nav { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-nav-back {",
      "  border: 0; background: none; color: var(--rmd-acc); font: 600 15px var(--rmd-f);",
      "  display: inline-flex; align-items: center; gap: 4px; padding: 8px 6px; cursor: pointer;",
      "  min-height: 44px; min-width: 44px; touch-action: manipulation;",
      "}",
      "#researchMD .rmd-shell-brand { display: flex; align-items: center; gap: 8px; min-width: 0; white-space: nowrap; }",
      "#researchMD .rmd-logo { width: auto; height: 30px; flex: none; display: block; }",
      "#researchMD .rmd-shell-brand strong { font: 700 24px var(--rmd-f); letter-spacing: -0.02em; color: var(--rmd-ink); }",
      "#researchMD .rmd-logo-a { fill: var(--rmd-logo-a); }",
      "#researchMD .rmd-logo-b { fill: var(--rmd-logo-b); }",
      "#researchMD .rmd-shell-brand strong b { font-weight: 800; color: var(--rmd-acc); }",
      "#researchMD .rmd-shell-brand span { font: 500 15.5px var(--rmd-f); color: var(--rmd-mut); padding-left: 2px; }",
      "@media (max-width: 960px) { #researchMD .rmd-shell-brand span { display: none; } }",
      "#researchMD .rmd-shell-center { display: flex; align-items: center; justify-content: center; min-width: 0; }",
      "#researchMD .rmd-head-read-bar { display: flex; align-items: center; gap: 6px; width: 100%; max-width: 440px; min-width: 0; }",
      "#researchMD .rmd-head-read-bar .rmd-head-read-input { flex: 1 1 0; width: auto; min-width: 0; height: 36px; min-height: 36px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--rmd-line); background: var(--rmd-panel); font: 400 13px var(--rmd-f); color: var(--rmd-ink); box-sizing: border-box; }",
      "#researchMD .rmd-head-read-bar .rmd-head-read-btn { min-height: 36px; height: 36px; padding: 0 12px; border-radius: 999px; font-size: 12.5px; white-space: nowrap; flex: 0 0 auto; }",
      "#researchMD .rmd-shell-right { display: flex; align-items: center; gap: 8px; justify-content: flex-end; flex: 0 0 auto; }",
      "#researchMD .rmd-shell-right .rmd-head-rstu-btn { display: none; min-height: 34px; height: 34px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; flex: 0 0 auto; }",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-shell-top { grid-template-columns: minmax(0, 1fr) auto; gap: 6px; padding-left: 10px; padding-right: 10px; }",
      "  #researchMD .rmd-shell-brand { gap: 6px; }",
      "  #researchMD .rmd-shell-right { gap: 5px; }",
      "  #researchMD .rmd-sync-pill { padding: 4px 10px; font-size: 11px; min-height: 48px; min-width: 48px; }",
      "  #researchMD .rmd-shell-close { width: 34px; height: 34px; }",
      "  #researchMD .rmd-shell-center { display: none; }",
      "  #researchMD .rmd-shell-right .rmd-head-rstu-btn { display: inline-flex; height: 32px; min-height: 32px; padding: 0 9px; font-size: 11.5px; }",
      "}",
      "#researchMD .rmd-sync-pill {",
      "  font: 500 12px/1.3 var(--rmd-f); border-radius: 999px; padding: 6px 12px;",
      "  min-height: 48px; min-width: 48px; border: 0; cursor: pointer; box-sizing: border-box;",
      "  display: inline-flex; align-items: center; justify-content: center; gap: 6px;",
      "  letter-spacing: normal; text-transform: none; touch-action: manipulation;",
      "}",
      "#researchMD .rmd-sync-pill:focus-visible { outline: 2px solid var(--rmd-acc); outline-offset: 2px; }",
      "#researchMD .rmd-sync-synced { color: var(--rmd-acc); background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-sync-queue { color: var(--rmd-warn); background: var(--rmd-warn-soft); }",
      "#researchMD .rmd-sync-saving { color: var(--rmd-acc); background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-sync-conflict { color: var(--rmd-bad); background: var(--rmd-bad-soft); }",
      "#researchMD .rmd-sync-hidden { display: none !important; }",
      "#researchMD .rmd-sync-sheet-card { max-width: 440px; width: calc(100% - 24px); padding: 20px; gap: 16px; }",
      "#researchMD .rmd-sync-sheet-inner { display: flex; flex-direction: column; gap: 14px; }",
      "#researchMD .rmd-sync-explain { margin: 0; font: 400 13.5px/1.5 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-sync-meta-box { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-sync-meta-row { display: flex; align-items: center; justify-content: space-between; font: 400 13px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-sync-meta-value { font-weight: 600; color: var(--rmd-ink); }",
      "#researchMD .rmd-sync-failed-box { background: var(--rmd-bad-soft); border: 1px solid var(--rmd-bad); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-sync-failed-line { font: 400 13px/1.4 var(--rmd-f); color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-sync-confirm-box { border-top: 1px solid var(--rmd-line); padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-sync-confirm-msg { margin: 0; font: 500 12.5px/1.4 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-sync-confirm-actions { display: flex; gap: 8px; }",
      "#researchMD .rmd-sync-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--rmd-line); padding-top: 14px; margin-top: 4px; }",
      "#researchMD .rmd-sync-actions button, #researchMD .rmd-sync-confirm-actions button, #researchMD .rmd-sync-discard-wrap button { min-height: 44px; min-width: 44px; }",
      "#researchMD .rmd-shell-close {",
      "  border: 0; width: 40px; height: 40px; border-radius: 999px; padding: 0; cursor: pointer;",
      "  display: inline-flex; align-items: center; justify-content: center; flex: none;",
      "  color: var(--rmd-ink); background: color-mix(in srgb, var(--rmd-panel) 72%, transparent);",
      "  box-shadow: 0 1px 2px rgba(17, 28, 68, 0.12); transition: transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1);",
      "}",
      "#researchMD .rmd-shell-close:active { transform: scale(0.92); }",
      "/* Body Screen Mount */",
      "#researchMD { overflow-x: hidden; }",
      "#researchMD .rmd-shell-body {",
      "  flex: 1; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;",
      "  display: flex; flex-direction: column; width: 100%; max-width: 100%; min-width: 0;",
      "}",
      "/* Common Components: Buttons, Badges, Cards */",
      "#researchMD .rmd-btn {",
      "  display: inline-flex; align-items: center; justify-content: center; gap: 6px;",
      "  border: 0; border-radius: 8px; padding: 8px 14px; font: 600 14px var(--rmd-f); cursor: pointer;",
      "  transition: transform 0.12s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.15s ease, background 0.15s ease; touch-action: manipulation;",
      "}",
      "#researchMD .rmd-btn:active { transform: scale(0.97); }",
      "#researchMD .rmd-btn:disabled { opacity: 0.45; cursor: default; transform: none; }",
      "#researchMD .rmd-btn-primary { background: var(--rmd-acc-grad); color: #fff; box-shadow: var(--rmd-lift); }",
      "@media (hover: hover) { #researchMD .rmd-btn-primary:hover { filter: brightness(1.07); } }",
      "#researchMD .rmd-btn-subtle { background: var(--rmd-fill); color: var(--rmd-ink); }",
      "#researchMD .rmd-btn-sm { padding: 5px 10px; font-size: 13px; border-radius: 6px; }",
      "#researchMD .rmd-btn-block { width: 100%; }",
      "#researchMD .rmd-btn-close { border: 0; background: none; color: var(--rmd-mut); font: 400 24px/1 var(--rmd-f); cursor: pointer; padding: 4px 8px; }",
      "#researchMD .rmd-badge { font: 600 11.5px var(--rmd-f); border-radius: 6px; padding: 2px 7px; display: inline-block; }",
      "#researchMD .rmd-badge-pill { border-radius: 999px; background: var(--rmd-acc-soft); color: var(--rmd-acc); }",
      "#researchMD .rmd-card-badges .rmd-badge, #researchMD .rmd-cap { text-transform: capitalize; }",
      "#researchMD .rmd-btn-quiet { background: none; color: var(--rmd-mut); box-shadow: none; }",
      "@media (hover: hover) { #researchMD .rmd-btn-quiet:hover { color: var(--rmd-bad); background: var(--rmd-bad-soft); } }",
      "#researchMD .rmd-badge-soft { background: var(--rmd-fill); color: var(--rmd-mut); }",
      "#researchMD .rmd-badge-neutral { background: var(--rmd-line); color: var(--rmd-ink); }",
      "#researchMD .rmd-role-tag { font: 600 11px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.05em; color: var(--rmd-mut); }",
      "#researchMD .rmd-version-tag { font: 600 11px var(--rmd-mono); color: var(--rmd-mut); background: var(--rmd-fill); padding: 2px 6px; border-radius: 4px; }",
      "#researchMD .rmd-status-pill { border: 0; border-radius: 999px; padding: 3px 9px; font: 600 11.5px var(--rmd-f); cursor: pointer; }",
      "#researchMD .rmd-status-verified { background: var(--rmd-acc-soft); color: var(--rmd-acc); }",
      "#researchMD .rmd-status-unverified { background: var(--rmd-warn-soft); color: var(--rmd-warn); }",
      "#researchMD .rmd-card { background: var(--rmd-panel); border-radius: 12px; border: 1px solid var(--rmd-line); padding: 16px; display: flex; flex-direction: column; gap: 12px; }",
      "#researchMD .rmd-card-heading { margin: 0; font: 600 15px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-form { display: flex; flex-direction: column; gap: 12px; }",
      "#researchMD .rmd-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }",
      "#researchMD .rmd-ai-bar { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--rmd-line); border-radius: 10px; padding: 12px; background: var(--rmd-fill); }",
      "#researchMD .rmd-ai-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
      "#researchMD .rmd-ai-mark { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 5px; background: var(--rmd-acc-grad); color: #fff; font: 700 11px var(--rmd-f); }",
      "#researchMD .rmd-ai-cost { margin: 0; font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-ai-progress { margin: 0; font: 500 13px var(--rmd-f); color: var(--rmd-acc); }",
      "#researchMD .rmd-ai-note { display: inline-block; font: 500 11.5px var(--rmd-f); color: var(--rmd-acc); background: var(--rmd-acc-soft); border-radius: 999px; padding: 2px 8px; margin-top: 4px; }",
      "#researchMD .rmd-fillin-note { display: inline-block; font: 500 11.5px var(--rmd-f); color: var(--rmd-warn); background: var(--rmd-warn-soft); border-radius: 999px; padding: 2px 8px; margin-top: 4px; }",
      "#researchMD .rmd-consent-preview { font-size: 13.5px; color: var(--rmd-ink); background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 8px 12px; white-space: pre-wrap; }",
      "#researchMD .rmd-field { display: flex; flex-direction: column; gap: 5px; }",
      "#researchMD .rmd-field label { font: 600 12.5px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-req { color: var(--rmd-bad); }",
      "#researchMD .rmd-field-hint { font: 400 12px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD input[type=text], #researchMD input[type=number], #researchMD select, #researchMD textarea {",
      "  width: 100%; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 9px 12px; font: 400 14.5px var(--rmd-f);",
      "  color: var(--rmd-ink); background: var(--rmd-panel); outline: none;",
      "}",
      "#researchMD input:focus, #researchMD select:focus, #researchMD textarea:focus { border-color: var(--rmd-acc); box-shadow: 0 0 0 2px var(--rmd-acc-soft); }",
      "#researchMD .rmd-icon-btn { border: 0; background: none; color: var(--rmd-mut); cursor: pointer; padding: 6px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; }",
      "#researchMD .rmd-icon-btn:hover { background: var(--rmd-fill); color: var(--rmd-ink); }",
      "#researchMD .rmd-icon-danger:hover { color: var(--rmd-bad); }",
      "/* Empty states */",
      "#researchMD .rmd-empty-state { text-align: center; padding: 48px 20px; display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--rmd-mut); }",
      "#researchMD .rmd-empty-icon { color: var(--rmd-acc); opacity: 0.8; }",
      "#researchMD .rmd-empty-state h3 { margin: 0; font: 600 17px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-empty-state p { margin: 0; max-width: 400px; font-size: 13.5px; }",
      "/* Projects Screen */",
      "#researchMD .rmd-projects-screen { padding: 16px 20px 40px; display: flex; flex-direction: column; gap: 20px; max-width: 1080px; margin: 0 auto; width: 100%; }",
      "#researchMD .rmd-screen-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }",
      "#researchMD .rmd-screen-title { margin: 0; font: 700 21px var(--rmd-f); letter-spacing: -0.02em; text-wrap: balance; }",
      "#researchMD .rmd-screen-subtitle { margin: 2px 0 0; font: 400 13.5px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-project-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }",
      "#researchMD .rmd-project-card { cursor: pointer; transition: transform 0.1s ease, box-shadow 0.15s ease; }",
      "#researchMD .rmd-project-card:hover { border-color: var(--rmd-acc); }",
      "#researchMD .rmd-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-card-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
      "#researchMD .rmd-project-title { margin: 0; font: 600 16px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-project-q { margin: 0; font: 400 13px var(--rmd-f); color: var(--rmd-mut); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
      "#researchMD .rmd-project-meta { display: flex; align-items: center; justify-content: space-between; font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); border-top: 1px solid var(--rmd-line); padding-top: 10px; margin-top: 2px; }",
      "#researchMD .rmd-meta-val { font-weight: 700; color: var(--rmd-ink); }",
      "#researchMD .rmd-card-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px; }",
      "/* Studies Screen & Two-Pane Layout */",
      "#researchMD .rmd-studies-screen { display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; width: 100%; max-width: 100%; min-width: 0; }",
      "#researchMD .rmd-studies-paste-wrap { width: 100%; max-width: 100%; min-width: 0; padding: 10px 14px 4px; }",
      "#researchMD .rmd-studies-topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px 12px; padding: 12px 14px; border-bottom: 1px solid var(--rmd-line); background: transparent; width: 100%; max-width: 100%; min-width: 0; flex-wrap: wrap; }",
      "#researchMD .rmd-topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 260px; max-width: 100%; }",
      "#researchMD .rmd-topbar-left [data-rmd='to-projects'] { flex: 0 0 auto; }",
      "#researchMD .rmd-topbar-proj-info { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 0; flex-wrap: wrap; }",
      "#researchMD .rmd-topbar-proj-title { margin: 0; font: 600 16px var(--rmd-f); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      "#researchMD .rmd-topbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 0 1 auto; min-width: 0; max-width: 100%; }",
      "#researchMD .rmd-phone-seg { display: none; background: var(--rmd-fill); padding: 3px; border-bottom: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-seg-btn { flex: 1; border: 0; background: none; font: 500 13px var(--rmd-f); color: var(--rmd-mut); padding: 7px; border-radius: 6px; cursor: pointer; }",
      "#researchMD .rmd-seg-btn.rmd-seg-active { background: var(--rmd-panel); color: var(--rmd-ink); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }",
      "#researchMD .rmd-split-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }",
      "#researchMD .rmd-pane-left { flex: 0 0 42%; border-right: 1px solid var(--rmd-line); display: flex; flex-direction: column; overflow-y: auto; background: var(--rmd-panel); min-width: 320px; }",
      "#researchMD .rmd-pane-right { flex: 1; overflow-y: auto; padding: 18px 22px 40px; background: var(--rmd-bg); }",
      "#researchMD .rmd-pane-header { padding: 12px 16px; border-bottom: 1px solid var(--rmd-line); background: var(--rmd-panel); }",
      "#researchMD .rmd-filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }",
      "#researchMD .rmd-chip { border: 0; background: var(--rmd-fill); color: var(--rmd-mut); font: 500 12.5px var(--rmd-f); border-radius: 999px; padding: 4px 10px; cursor: pointer; }",
      "#researchMD .rmd-chip.rmd-chip-active { background: var(--rmd-acc-grad); color: #fff; font-weight: 600; }",
      "#researchMD .rmd-studies-list { display: flex; flex-direction: column; min-width: 0; }",
      "#researchMD .rmd-study-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--rmd-line); cursor: pointer; transition: background 0.1s ease; min-width: 0; max-width: 100%; }",
      "#researchMD .rmd-study-row:hover { background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-study-row-selected { background: var(--rmd-acc-soft); outline: 2px solid var(--rmd-acc); outline-offset: -2px; }",
      "#researchMD .rmd-study-row-main { flex: 1 1 160px; min-width: 0; display: flex; flex-direction: column; gap: 3px; }",
      "#researchMD .rmd-study-row-title-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }",
      "#researchMD .rmd-study-label { font-size: 14.5px; color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-study-data-str { font: 500 12.5px var(--rmd-mono); color: var(--rmd-mut); overflow-wrap: anywhere; }",
      "#researchMD .rmd-study-loc-str { font: 400 12px var(--rmd-f); color: var(--rmd-mut); display: flex; align-items: flex-start; gap: 4px; overflow-wrap: anywhere; }",
      "#researchMD .rmd-study-row-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }",
      "/* Detail & Form Cards */",
      "#researchMD .rmd-detail-card, #researchMD .rmd-form-card { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 720px; margin: 0 auto; }",
      "#researchMD .rmd-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--rmd-line); padding-bottom: 14px; }",
      "#researchMD .rmd-detail-title { margin: 4px 0 0; font: 700 19px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-detail-header-actions { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-section-block { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-section-label { margin: 0; font: 600 12px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.05em; color: var(--rmd-mut); }",
      "#researchMD .rmd-data-box { background: var(--rmd-fill); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-data-box-row { display: flex; gap: 8px; font-size: 13.5px; }",
      "#researchMD .rmd-data-box-lbl { color: var(--rmd-mut); min-width: 110px; }",
      "#researchMD .rmd-2x2-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13.5px; }",
      "#researchMD .rmd-grid-cell { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 6px; padding: 8px 10px; }",
      "#researchMD .rmd-grid-cell span { display: block; font-size: 11.5px; color: var(--rmd-mut); margin-bottom: 2px; }",
      "#researchMD .rmd-provenance-box { background: var(--rmd-fill); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }",
      "#researchMD .rmd-prov-row { display: flex; gap: 8px; }",
      "#researchMD .rmd-prov-lbl { color: var(--rmd-mut); min-width: 70px; font-weight: 500; }",
      "#researchMD .rmd-quote-block { background: var(--rmd-fill); border: 1px solid var(--rmd-line); padding: 10px 12px; margin-top: 6px; border-radius: 6px; }",
      "#researchMD .rmd-quote-tag { font: 600 11px var(--rmd-f); text-transform: uppercase; color: var(--rmd-acc); margin-bottom: 4px; }",
      "#researchMD .rmd-quote-block blockquote { margin: 0; font-style: italic; color: var(--rmd-ink); font-size: 13px; line-height: 1.45; }",
      "#researchMD .rmd-verify-block { border-top: 1px solid var(--rmd-line); padding-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }",
      "#researchMD .rmd-verify-status-box { display: flex; align-items: center; gap: 10px; }",
      "#researchMD .rmd-verify-status-box strong { font-size: 13.5px; }",
      "#researchMD .rmd-verify-status-box p { margin: 0; font-size: 12px; color: var(--rmd-mut); }",
      "#researchMD .rmd-verify-ok { color: var(--rmd-acc); }",
      "#researchMD .rmd-verify-warn { color: var(--rmd-warn); }",
      "#researchMD .rmd-sub-card { background: var(--rmd-fill); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-locator-section { border-top: 1px solid var(--rmd-line); padding-top: 12px; display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-checkbox-field { border-top: 1px solid var(--rmd-line); padding-top: 12px; }",
      "#researchMD .rmd-check-label { display: flex; align-items: center; gap: 8px; font: 500 13.5px var(--rmd-f); color: var(--rmd-ink); cursor: pointer; }",
      "#researchMD .rmd-check-note { margin: 3px 0 0 24px; font-size: 11.5px; color: var(--rmd-mut); }",
      "/* Run Meta-Analysis Screen */",
      "#researchMD .rmd-run-screen { display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; overflow-y: auto; }",
      "#researchMD .rmd-run-layout { display: grid; grid-template-columns: 310px 1fr; gap: 18px; padding: 18px 22px 40px; max-width: 1280px; margin: 0 auto; width: 100%; }",
      "#researchMD .rmd-run-settings-panel { display: flex; flex-direction: column; gap: 14px; }",
      "#researchMD .rmd-eligibility-box { background: var(--rmd-fill); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }",
      "#researchMD .rmd-elig-stat { font-weight: 500; }",
      "#researchMD .rmd-elig-warn { font-size: 12px; color: var(--rmd-warn); display: flex; align-items: center; gap: 5px; }",
      "#researchMD .rmd-results-wrap { display: flex; flex-direction: column; gap: 16px; }",
      "#researchMD .rmd-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }",
      "#researchMD .rmd-kpi-card { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 4px; }",
      "#researchMD .rmd-kpi-highlight { border-color: var(--rmd-acc); background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-kpi-lbl { font: 600 11.5px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); }",
      "#researchMD .rmd-kpi-highlight .rmd-kpi-lbl { color: var(--rmd-acc); }",
      "#researchMD .rmd-kpi-val { font: 700 22px/1.2 var(--rmd-f); color: var(--rmd-ink); font-variant-numeric: tabular-nums; }",
      "#researchMD .rmd-kpi-sub { font: 500 12px var(--rmd-mono); color: var(--rmd-mut); }",
      "#researchMD .rmd-notices-box { background: var(--rmd-warn-soft); border: 1px solid var(--rmd-warn); border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }",
      "#researchMD .rmd-notice-item { display: flex; align-items: center; gap: 8px; font: 500 12.5px var(--rmd-f); color: var(--rmd-warn); }",
      "#researchMD .rmd-forest-card { overflow: hidden; padding: 18px 20px; }",
      "#researchMD .rmd-forest-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }",
      "#researchMD .rmd-forest-legend { display: flex; align-items: center; gap: 16px; font-size: 12px; color: var(--rmd-mut); }",
      "#researchMD .rmd-legend-item { display: flex; align-items: center; gap: 6px; }",
      "#researchMD .rmd-leg-box { width: 10px; height: 10px; background: var(--rmd-acc); border-radius: 1px; display: inline-block; }",
      "#researchMD .rmd-leg-diamond { width: 10px; height: 10px; background: var(--rmd-acc); transform: rotate(45deg); display: inline-block; }",
      "#researchMD .rmd-svg-scroll-container { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }",
      "#researchMD .rmd-plain-chooser { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }",
      "#researchMD .rmd-plain-q { margin: 0 0 8px; font: 600 13px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-plain-opts { display: flex; flex-wrap: wrap; gap: 6px; }",
      "#researchMD .rmd-plain-opts .rmd-btn[aria-pressed=\"true\"] { border-color: var(--rmd-acc); color: var(--rmd-acc); background: var(--rmd-panel); }",
      "#researchMD .rmd-plain-why { margin: 8px 0 0; font: 400 12.5px/1.45 var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-what-mean-box { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 10px 12px; margin: 0 0 14px; }",
      "#researchMD .rmd-what-mean-title { margin: 0 0 6px; font: 600 12px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); }",
      "#researchMD .rmd-what-mean { margin: 0 0 6px; font: 400 13px/1.5 var(--rmd-f); color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-what-mean:last-child { margin-bottom: 0; }",
      "#researchMD .rmd-forest-caption { margin: 10px 0 0; }",
      "#researchMD .rmd-run-export-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px; }",
      "#researchMD .rmd-run-export-title { margin: 0; font: 600 13.5px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-run-export-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
      "#researchMD .rmd-mobile-back-studies { display: none; margin-bottom: 10px; }",
      "/* Modals */",
      "#researchMD .rmd-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 10060; display: flex; align-items: center; justify-content: center; padding: 16px; }",
      "#researchMD .rmd-modal-card { background: var(--rmd-panel); border-radius: 14px; width: 100%; max-width: 500px; padding: 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); max-height: 90vh; overflow-y: auto; }",
      "#researchMD .rmd-modal-wide { max-width: 680px; }",
      "#researchMD .rmd-modal-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--rmd-line); padding-bottom: 10px; }",
      "#researchMD .rmd-modal-header h3 { margin: 0; font: 700 17px var(--rmd-f); }",
      "#researchMD .rmd-modal-warn { border-bottom-color: var(--rmd-warn); }",
      "#researchMD .rmd-warn-hdr-icon { color: var(--rmd-warn); flex-shrink: 0; margin-right: 8px; }",
      "#researchMD .rmd-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--rmd-line); padding-top: 12px; margin-top: 6px; }",
      "/* Glossary sheet */",
      "#researchMD .rmd-glossary-card { max-width: 560px; }",
      "#researchMD .rmd-glossary-search { width: 100%; box-sizing: border-box; font: 400 15px var(--rmd-f); padding: 10px 12px; border: 1px solid var(--rmd-line); border-radius: 10px; background: var(--rmd-fill); color: var(--rmd-ink); }",
      "#researchMD .rmd-glossary-list { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }",
      "#researchMD .rmd-glossary-item { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 10px 12px; }",
      "#researchMD .rmd-glossary-item strong { font: 600 14px var(--rmd-f); color: var(--rmd-ink); display: block; margin-bottom: 4px; }",
      "#researchMD .rmd-glossary-item p { margin: 0; font: 400 13px/1.45 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-glossary-eg { margin-top: 4px !important; color: var(--rmd-mut) !important; font-size: 12.5px !important; }",
      "/* 409 Conflict Dialog */",
      "#researchMD .rmd-conflict-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }",
      "#researchMD .rmd-conflict-col { background: var(--rmd-fill); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-conflict-tag { font: 600 11px var(--rmd-f); text-transform: uppercase; color: var(--rmd-mut); }",
      "#researchMD .rmd-conflict-col h4 { margin: 0; font: 600 15px var(--rmd-f); }",
      "#researchMD .rmd-conflict-values { font: 500 12.5px var(--rmd-mono); color: var(--rmd-ink); }",
      "#researchMD .rmd-conflict-quote { font-style: italic; font-size: 12px; color: var(--rmd-mut); background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 6px; padding: 8px 10px; }",
      "#researchMD .rmd-conflict-ver { font-size: 12px; color: var(--rmd-mut); }",
      "/* Responsive Breakpoints: Tablet (>= 768px) vs Phone (< 768px) */",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-studies-screen { height: auto; min-height: 0; overflow-x: hidden; }",
      "  #researchMD .rmd-topbar-actions { width: 100%; }",
      "  #researchMD .rmd-topbar-actions .rmd-btn { flex: 1 1 auto; min-height: 44px; min-width: 0; max-width: 100%; }",
      "  #researchMD .rmd-study-row { flex-wrap: wrap; }",
      "  #researchMD .rmd-split-layout { flex-direction: column; min-width: 0; width: 100%; }",
      "  #researchMD .rmd-pane-left { flex: 1; border-right: 0; min-width: 0; width: 100%; }",
      "  #researchMD .rmd-pane-right { flex: 1; padding: 14px; min-width: 0; width: 100%; }",
      "  #researchMD .rmd-phone-seg { display: flex; }",
      "  #researchMD .rmd-phone-hidden { display: none !important; }",
      "  #researchMD .rmd-mobile-back-studies { display: inline-flex; }",
      "  #researchMD .rmd-run-export-actions { width: 100%; }",
      "  #researchMD .rmd-run-export-actions .rmd-btn { flex: 1 1 auto; min-height: 44px; justify-content: center; }",
      "  #researchMD .rmd-run-layout { grid-template-columns: 1fr; padding: 12px 14px; }",
      "  #researchMD .rmd-conflict-grid { grid-template-columns: 1fr; }",
      "}",
      "@media (max-width: 1023px) {",
      "  #researchMD .rmd-studies-topbar { flex-wrap: wrap; padding: 10px 14px; }",
      "  #researchMD .rmd-topbar-left { flex: 1 1 100%; }",
      "  #researchMD .rmd-topbar-proj-info { flex-wrap: wrap; row-gap: 4px; }",
      "}",
      "#researchMD .rmd-topbar-proj-info .rmd-badge { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-project-grid { grid-template-columns: 1fr 1fr; }",
      "}",
      "@media (min-width: 1024px) {",
      "  #researchMD .rmd-project-grid { grid-template-columns: 1fr 1fr 1fr; }",
      "}",
      "/* Phase 2: shell screen tabs */",
      "#researchMD .rmd-shell-tabs { display: flex; gap: 6px; padding: 4px 14px 10px; overflow-x: auto; background: transparent; scrollbar-width: none; }",
      "#researchMD .rmd-shell-tabs::-webkit-scrollbar { display: none; }",
      "#researchMD .rmd-tab { flex: 0 0 auto; border: 0; background: none; font: 500 13px var(--rmd-f); color: var(--rmd-mut); padding: 7px 12px; border-radius: 999px; cursor: pointer; min-height: 34px; touch-action: manipulation; }",
      "#researchMD .rmd-tab:hover { background: var(--rmd-fill); color: var(--rmd-ink); }",
      "#researchMD .rmd-tab-active { background: var(--rmd-acc-grad); color: #fff; font-weight: 600; box-shadow: var(--rmd-lift); }",
      "#researchMD button:focus-visible, #researchMD a:focus-visible { outline: 2px solid var(--rmd-acc); outline-offset: 2px; }",
      "/* Phase 2: shared screen scaffolding */",
      "#researchMD .rmd-p2-screen { padding: 16px 16px 48px; display: flex; flex-direction: column; gap: 16px; max-width: 1080px; margin: 0 auto; width: 100%; }",
      "#researchMD .rmd-p2-cols { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }",
      "#researchMD .rmd-banner { border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; align-items: flex-start; }",
      "#researchMD .rmd-banner-error { background: var(--rmd-bad-soft); border: 1px solid var(--rmd-bad); color: var(--rmd-bad); }",
      "#researchMD .rmd-banner-warn { background: var(--rmd-warn-soft); border: 1px solid var(--rmd-warn); color: var(--rmd-warn); }",
      "#researchMD .rmd-banner-info { background: var(--rmd-acc-soft); border: 1px solid var(--rmd-acc); color: var(--rmd-acc); }",
      "#researchMD .rmd-banner-code { font: 500 11.5px var(--rmd-mono); opacity: 0.85; }",
      "#researchMD .rmd-loading { padding: 32px 16px; text-align: center; color: var(--rmd-mut); font-size: 13.5px; }",
      "#researchMD .rmd-muted { color: var(--rmd-mut); }",
      "#researchMD .rmd-mono-sm { font: 500 12px var(--rmd-mono); overflow-wrap: anywhere; }",
      "#researchMD .rmd-row-btn { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--rmd-line); background: none; padding: 12px 16px; cursor: pointer; font: 400 14px var(--rmd-f); color: var(--rmd-ink); touch-action: manipulation; }",
      "#researchMD .rmd-row-btn:hover { background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-row-selected { background: var(--rmd-acc-soft); outline: 2px solid var(--rmd-acc); outline-offset: -2px; }",
      "#researchMD .rmd-row-title { font-weight: 600; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }",
      "#researchMD .rmd-row-meta { font-size: 12px; color: var(--rmd-mut); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
      "#researchMD .rmd-item-title { margin: 0; font: 600 16px/1.4 var(--rmd-f); overflow-wrap: anywhere; }",
      "#researchMD .rmd-item-meta { font-size: 12.5px; color: var(--rmd-mut); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }",
      "#researchMD .rmd-abstract-box { background: var(--rmd-fill); border-radius: 8px; padding: 12px 14px; max-height: 240px; overflow-y: auto; overscroll-behavior: contain; font-size: 13.5px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }",
      "/* Phase 2: protocol */",
      "#researchMD .rmd-field-list { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-field-list-row { display: flex; gap: 8px; align-items: center; }",
      "#researchMD .rmd-field-list-row input { flex: 1; min-width: 0; }",
      "#researchMD .rmd-lock-box { background: var(--rmd-acc-soft); border: 1px solid var(--rmd-acc); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }",
      "#researchMD .rmd-lock-hash { font: 500 12px var(--rmd-mono); overflow-wrap: anywhere; color: var(--rmd-ink); }",
      "#researchMD .rmd-proto-view { display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; }",
      "#researchMD .rmd-proto-view dt { font: 600 12px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); margin-top: 6px; }",
      "#researchMD .rmd-proto-view dd { margin: 2px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }",
      "#researchMD .rmd-proto-view ul { margin: 2px 0 0; padding-left: 18px; }",
      "/* Phase 2: screening votes */",
      "#researchMD .rmd-vote-bar { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }",
      "#researchMD .rmd-vote-btn { border: 1px solid var(--rmd-line); border-radius: 10px; min-height: 54px; font: 600 15px var(--rmd-f); cursor: pointer; touch-action: manipulation; background: var(--rmd-panel); color: var(--rmd-ink); }",
      "#researchMD .rmd-vote-btn:active { opacity: 0.7; }",
      "#researchMD .rmd-vote-include { background: var(--rmd-acc-soft); border-color: var(--rmd-acc); color: var(--rmd-acc); }",
      "#researchMD .rmd-vote-exclude { background: var(--rmd-bad-soft); border-color: var(--rmd-bad); color: var(--rmd-bad); }",
      "#researchMD .rmd-vote-uncertain { background: var(--rmd-warn-soft); border-color: var(--rmd-warn); color: var(--rmd-warn); }",
      "#researchMD .rmd-vote-btn[disabled] { opacity: 0.45; cursor: default; }",
      "#researchMD .rmd-reason-grid { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-reason-chip { border: 1px solid var(--rmd-line); background: var(--rmd-panel); color: var(--rmd-ink); border-radius: 999px; padding: 8px 14px; font: 500 13px var(--rmd-f); cursor: pointer; min-height: 38px; touch-action: manipulation; }",
      "#researchMD .rmd-reason-chip:hover { border-color: var(--rmd-bad); color: var(--rmd-bad); }",
      "#researchMD .rmd-votes-box { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-vote-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; background: var(--rmd-fill); border-radius: 8px; padding: 8px 12px; }",
      "#researchMD .rmd-vote-who { font: 600 11.5px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); min-width: 52px; }",
      "#researchMD .rmd-peer-hidden { color: var(--rmd-mut); font-style: italic; }",
      "#researchMD .rmd-decision-include { color: var(--rmd-acc); font-weight: 600; }",
      "#researchMD .rmd-decision-exclude { color: var(--rmd-bad); font-weight: 600; }",
      "#researchMD .rmd-decision-uncertain { color: var(--rmd-warn); font-weight: 600; }",
      "#researchMD .rmd-progress-line { font: 500 12.5px var(--rmd-f); color: var(--rmd-mut); display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }",
      "/* Phase 2: PRISMA */",
      "#researchMD .rmd-prisma-svg { width: 100%; min-width: 560px; height: auto; display: block; }",
      "#researchMD .rmd-count-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }",
      "#researchMD .rmd-count-table td { padding: 8px 10px; border-bottom: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-count-table td:last-child { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }",
      "/* Phase 2: responsive */",
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-p2-cols { grid-template-columns: minmax(300px, 380px) 1fr; }",
      "  #researchMD .rmd-p2-screen { padding: 20px 22px 56px; }",
      "}",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-vote-btn { min-height: 58px; }",
      "  #researchMD .rmd-form-row { grid-template-columns: 1fr; }",
      "  #researchMD .rmd-step-banner { padding: 4px 8px; font-size: 12px; }",
      "  #researchMD .rmd-step-next { padding: 4px 9px; font-size: 11.5px; min-height: 32px; }",
      "  #researchMD .rmd-step-how { font-size: 11.5px; min-height: 32px; }",
      "  #researchMD .rmd-step-dismiss { min-height: 32px; }",
      "}",
      "/* iPad and wider: full-width forms, two-column short fields, roomy gutters */",
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-p2-screen { max-width: 1120px; padding: 24px 24px 64px; }",
      "  #researchMD .rmd-projects-screen { max-width: 1120px; padding: 24px 24px 56px; }",
      "  #researchMD .rmd-detail-card, #researchMD .rmd-form-card { max-width: 880px; padding: 24px; }",
      "  #researchMD .rmd-pane-left { flex: 0 0 280px; min-width: 240px; }",
      "  #researchMD .rmd-pane-right { padding: 18px 16px 40px; }",
      "  #researchMD .rmd-modal-card { max-width: 880px; }",
      "  #researchMD .rmd-modal-wide { max-width: 880px; }",
      "  #researchMD .rmd-shell-tabs { flex-wrap: wrap; overflow-x: visible; padding-left: 24px; padding-right: 24px; }",
      "  #researchMD #rmdHelpWrap { padding: 0 24px; }",
      "  #researchMD .rmd-btn { min-height: 44px; }",
      "  #researchMD .rmd-tab { min-height: 44px; }",
      "  #researchMD .rmd-chip { min-height: 44px; }",
      "  #researchMD .rmd-step-next, #researchMD .rmd-step-how, #researchMD .rmd-step-dismiss { min-height: 44px; }",
      "}",
      "/* Phase 3: PDF viewer (offline word-box render) */",
      "#researchMD .rmd-pdf-layout { display: grid; grid-template-columns: 1fr; gap: 16px; padding: 16px; flex: 1; min-height: 0; overflow-y: auto; }",
      "#researchMD .rmd-pdf-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }",
      "#researchMD .rmd-pdf-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }",
      "#researchMD .rmd-pdf-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
      "#researchMD .rmd-pdf-pageind { font: 500 13px var(--rmd-f); color: var(--rmd-mut); display: inline-flex; align-items: center; gap: 6px; }",
      "#researchMD .rmd-pdf-pageind input { width: 64px; padding: 5px 8px; }",
      "#researchMD .rmd-pdf-scroll { overflow: auto; max-width: 100%; max-height: 72vh; background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 0; -webkit-overflow-scrolling: touch; }",
      "#researchMD .rmd-pdf-page { position: relative; overflow: hidden; background: #fbfaf7; margin: 0 auto; box-shadow: 0 1px 4px rgba(0,0,0,0.18); }",
      "#researchMD .rmd-pdf-word { position: absolute; white-space: nowrap; color: #16202a; font-family: Georgia, 'Times New Roman', serif; line-height: 1; cursor: text; }",
      "#researchMD .rmd-pdf-highlight { position: absolute; border: 2px solid #1b41bf; background: rgba(27,65,191,0.16); border-radius: 2px; pointer-events: none; }",
      "#researchMD .rmd-pdf-ocr { margin: 0; }",
      "#researchMD .rmd-pdf-hint { font-size: 12px; margin: 0; }",
      "/* Phase 3: extraction form */",
      "#researchMD .rmd-extract-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }",
      "#researchMD .rmd-extract-form-body { padding: 14px 16px 40px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }",
      "#researchMD .rmd-extract-field { display: flex; flex-direction: column; gap: 7px; border: 1px solid var(--rmd-line); border-radius: 10px; padding: 12px; background: var(--rmd-panel); }",
      "#researchMD .rmd-extract-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-extract-field-head label { font: 600 13px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-extract-field-actions { display: flex; flex-wrap: wrap; gap: 6px; }",
      "#researchMD .rmd-extract-noquote { font-size: 12px; margin: 0; }",
      "#researchMD .rmd-extract-save-row { border-top: 1px solid var(--rmd-line); padding-top: 12px; }",
      "#researchMD .rmd-suggestion { border: 1px solid var(--rmd-line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--rmd-fill); }",
      "#researchMD .rmd-suggestion-head { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-suggestion-val { font: 600 15px var(--rmd-mono); color: var(--rmd-ink); }",
      "#researchMD .rmd-audit-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12.5px; border-bottom: 1px solid var(--rmd-line); padding: 7px 0; }",
      "/* Phase 3: risk of bias */",
      "#researchMD .rmd-rob-tools { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--rmd-line); background: var(--rmd-panel); }",
      "#researchMD .rmd-rob-domain { border: 1px solid var(--rmd-line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 9px; background: var(--rmd-panel); }",
      "#researchMD .rmd-rob-domain-label { margin: 0; font: 600 13.5px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-rob-sq { display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-rob-sq-row { display: grid; grid-template-columns: 1fr 84px; gap: 8px; align-items: center; }",
      "#researchMD .rmd-rob-sq-text { font-size: 12px; color: var(--rmd-mut); line-height: 1.35; }",
      "#researchMD .rmd-rob-stars { display: flex; gap: 6px; flex-wrap: wrap; }",
      "#researchMD .rmd-rob-summary { display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-rob-summary-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }",
      "#researchMD .rmd-rob-summary-label { font-size: 12.5px; color: var(--rmd-ink); }",
      "#researchMD .rmd-light { font: 600 11.5px var(--rmd-f); border-radius: 999px; padding: 3px 10px; border: 1px solid transparent; white-space: nowrap; }",
      "#researchMD .rmd-light-low { background: var(--rmd-acc-soft); color: var(--rmd-acc); border-color: var(--rmd-acc); }",
      "#researchMD .rmd-light-mid { background: var(--rmd-warn-soft); color: var(--rmd-warn); border-color: var(--rmd-warn); }",
      "#researchMD .rmd-light-high { background: var(--rmd-bad-soft); color: var(--rmd-bad); border-color: var(--rmd-bad); }",
      "#researchMD .rmd-light-none { background: var(--rmd-fill); color: var(--rmd-mut); border-color: var(--rmd-line); }",
      "#researchMD .rmd-rob-overall { font-size: 13.5px; display: flex; align-items: center; gap: 8px; margin: 8px 0 0; }",
      "#researchMD .rmd-rob-source { font-size: 11.5px; margin: 6px 0 0; }",
      "#researchMD .rmd-rob-consensus { border-top: 1px solid var(--rmd-line); padding-top: 12px; }",
      "#researchMD .rmd-rob-summary-pane { display: flex; flex-direction: column; gap: 16px; }",
      "/* Phase 3: data import */",
      "#researchMD .rmd-data-checks { display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-data-check { display: grid; grid-template-columns: auto auto auto 1fr; gap: 8px; align-items: center; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; }",
      "#researchMD .rmd-data-check-error { background: var(--rmd-bad-soft); }",
      "#researchMD .rmd-data-check-warning { background: var(--rmd-warn-soft); }",
      "#researchMD .rmd-data-check-msg { color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-data-versions { display: flex; flex-direction: column; }",
      "#researchMD .rmd-data-dict-cols { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-data-dict-col { display: grid; grid-template-columns: 1fr 110px auto; gap: 8px; align-items: center; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 8px 10px; }",
      "#researchMD .rmd-data-dict-name { color: var(--rmd-ink); }",
      "#researchMD .rmd-data-req { font-size: 12px; white-space: nowrap; }",
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-pdf-layout { grid-template-columns: minmax(0, 1fr) 300px; padding: 18px 22px 40px; }",
      "}",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-extract-selects { grid-template-columns: 1fr; }",
      "  #researchMD .rmd-data-check { grid-template-columns: auto auto 1fr; }",
      "  #researchMD .rmd-data-check-msg { grid-column: 1 / -1; }",
      "  #researchMD .rmd-data-dict-col { grid-template-columns: 1fr auto; }",
      "  #researchMD .rmd-data-dict-col select { grid-column: 1 / -1; }",
      "}",
      "#researchMD .rmd-banner-sub { display: block; font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); margin-top: 2px; }",
      "#researchMD .rmd-banner-details { margin-top: 6px; font: 400 12px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-banner-details summary { cursor: pointer; }",
      "#researchMD .rmd-step-banner { background: var(--rmd-acc-soft); border: 1px solid var(--rmd-line); border-radius: 10px; margin: 8px 0; padding: 6px 10px; font: 500 13px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-step-line { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }",
      "#researchMD .rmd-step-text { flex: 1 1 auto; min-width: 0; line-height: 1.35; }",
      "#researchMD .rmd-step-text strong { color: var(--rmd-acc); font-weight: 700; }",
      "#researchMD .rmd-step-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }",
      "#researchMD .rmd-step-next { border: 0; background: var(--rmd-acc); color: #fff; border-radius: 999px; padding: 6px 12px; font: 600 12.5px var(--rmd-f); cursor: pointer; min-height: 36px; touch-action: manipulation; white-space: nowrap; }",
      "#researchMD .rmd-step-how { border: 0; background: none; color: var(--rmd-acc); font: 600 12.5px var(--rmd-f); cursor: pointer; padding: 6px 4px; min-height: 36px; text-decoration: underline; touch-action: manipulation; }",
      "#researchMD .rmd-step-dismiss { border: 0; background: none; color: var(--rmd-mut); font: 600 16px var(--rmd-f); cursor: pointer; padding: 4px 6px; min-height: 36px; line-height: 1; touch-action: manipulation; }",
      "#researchMD .rmd-step-tip { margin-top: 6px; font: 400 12.5px/1.45 var(--rmd-f); color: var(--rmd-mut); border-top: 1px solid var(--rmd-line); padding-top: 6px; }",
      "#researchMD .rmd-step-tip p { margin: 3px 0; }",
      "#researchMD .rmd-tab-done { color: var(--rmd-acc); opacity: 0.85; }",
      "#researchMD .rmd-tab-later { opacity: 0.6; }",
      "#researchMD .rmd-tab-more { font-weight: 600; }",
      "#researchMD .rmd-shell-tabs-more { padding-top: 0; }",
      "#researchMD #rmdHelpWrap { padding: 0 16px; }",
      "#researchMD #rmdHelpWrap:empty { padding: 0; }",
      "#researchMD .rmd-help-card { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 8px 12px; margin: 8px 0; font: 400 13px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-help-card summary { font-weight: 600; cursor: pointer; color: var(--rmd-acc); }",
      "#researchMD .rmd-help-card p { margin: 6px 0; }",
      "#researchMD .rmd-help-eg { color: var(--rmd-mut); }",
      "#researchMD .rmd-help-gloss { color: var(--rmd-mut); font-size: 12.5px; }",
      "#researchMD .rmd-practice-card { padding: 18px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }",
      "#researchMD .rmd-practice-card h3 { margin: 0; font: 700 16px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-practice-card p { margin: 0; color: var(--rmd-mut); }",
      "#researchMD .rmd-practice-actions { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-start-screen { padding: 16px; display: flex; flex-direction: column; gap: 12px; max-width: 640px; margin: 0 auto; width: 100%; }",
      "#researchMD .rmd-start-screen h2 { margin: 0; font: 700 20px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-start-choice { text-align: left; background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; padding: 14px 16px; cursor: pointer; font: 600 15px var(--rmd-f); color: var(--rmd-ink); display: flex; flex-direction: column; gap: 4px; }",
      "#researchMD .rmd-start-choice span { font: 400 13px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-start-choice:hover { border-color: var(--rmd-acc); }",
      "#researchMD .rmd-ready-list { list-style: none; margin: 10px 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-ready-list li { display: flex; align-items: center; gap: 8px; font: 400 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-format-check-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-format-check-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--rmd-line); border-radius: 8px; background: var(--rmd-fill); }",
      "#researchMD .rmd-format-check-left { display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0; }",
      "#researchMD .rmd-format-check-icon { flex-shrink: 0; margin-top: 2px; display: inline-flex; }",
      "#researchMD .rmd-format-check-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }",
      "#researchMD .rmd-format-check-label { font: 600 13.5px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-format-check-detail { font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); line-height: 1.4; }",
      "#researchMD .rmd-shell-footer { display: flex; justify-content: center; padding: 10px 16px 14px; }",
      "#researchMD .rmd-footer-feedback { background: none; border: none; padding: 6px 10px; font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); text-decoration: underline; cursor: pointer; }",
      "#researchMD .rmd-feedback-card { max-width: 480px; }",
      "#researchMD .rmd-feedback-note { font: 400 13px var(--rmd-f); color: var(--rmd-mut); margin: 8px 0; }",
      "#researchMD .rmd-feedback-text { width: 100%; box-sizing: border-box; font: 400 14px var(--rmd-f); color: var(--rmd-ink); background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 10px; resize: vertical; }",
      "#researchMD .rmd-feedback-status { font: 400 13px var(--rmd-f); color: var(--rmd-mut); margin: 8px 0; min-height: 18px; }",
      "#researchMD .rmd-feedback-actions { display: flex; gap: 8px; margin-top: 4px; }",
      "#researchMD .rmd-tut-bar { margin: 8px 16px 0; padding: 12px 14px; border: 1.5px solid var(--rmd-acc); border-radius: 12px; background: var(--rmd-panel); box-sizing: border-box; }",
      "#researchMD .rmd-tut-compact { display: flex; align-items: center; gap: 8px; justify-content: space-between; min-width: 0; }",
      "#researchMD .rmd-tut-compact-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }",
      "#researchMD .rmd-tut-compact-line { margin: 0; font: 600 13px/1.35 var(--rmd-f); color: var(--rmd-ink); display: flex; align-items: center; gap: 6px; min-width: 0; }",
      "#researchMD .rmd-tut-step-tag { color: var(--rmd-acc); font-weight: 700; flex: 0 0 auto; white-space: nowrap; }",
      "#researchMD .rmd-tut-short { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }",
      "#researchMD .rmd-tut-meta { margin: 0; font: 500 11.5px/1.3 var(--rmd-f); color: var(--rmd-mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      "#researchMD .rmd-tut-compact-btns { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }",
      "#researchMD .rmd-tut-compact-btns .rmd-btn { min-height: 44px; min-width: 44px; white-space: nowrap; }",
      "#researchMD .rmd-tut-toggle { display: inline-flex; align-items: center; gap: 4px; }",
      "#researchMD .rmd-tut-toggle svg { transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }",
      "#researchMD .rmd-tut-toggle[aria-expanded=\"true\"] svg { transform: rotate(180deg); }",
      "#researchMD .rmd-tut-details { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-tut-details[hidden] { display: none; }",
      "#researchMD .rmd-tut-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }",
      "#researchMD .rmd-tut-prog { font: 600 12px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-tut-ask { margin: 4px 0; font: 600 13.5px var(--rmd-f); color: var(--rmd-ink); line-height: 1.45; }",
      "#researchMD .rmd-tut-why { margin: 0 0 8px; font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); line-height: 1.4; }",
      "#researchMD .rmd-tut-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
      "#researchMD .rmd-tut-actions .rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-tut-def { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font: 400 12px var(--rmd-f); color: var(--rmd-mut); margin-left: auto; cursor: pointer; }",
      "#researchMD .rmd-tut-how-tip { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--rmd-fill); border: 1px solid var(--rmd-line); font: 400 12.5px/1.45 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-tut-how-tip[hidden] { display: none; }",
      "#researchMD .rmd-tut-how-tip p { margin: 3px 0; }",
      "@media (max-width: 600px) {",
      "  #researchMD .rmd-tut-bar { margin: 6px 10px 0; padding: 8px 10px; border-radius: 10px; }",
      "  #researchMD .rmd-tut-compact { gap: 6px; }",
      "  #researchMD .rmd-tut-compact-btns .rmd-btn { padding: 6px 10px; font-size: 12.5px; }",
      "  #researchMD .rmd-tut-def { margin-left: 0; }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  #researchMD .rmd-tut-toggle svg { transition: none; }",
      "}",
      "#researchMD .rmd-tut-spot { outline: 3px solid var(--rmd-acc) !important; outline-offset: 2px; box-shadow: 0 0 0 5px rgba(21,128,61,0.22); transition: box-shadow 0.2s ease; }",
      "#researchMD .rmd-tut-hub { margin-bottom: 18px; padding: 14px; border: 1px solid var(--rmd-line); border-radius: 12px; background: var(--rmd-panel); }",
      "#researchMD .rmd-tut-hub-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 12px; }",
      "#researchMD .rmd-tut-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }",
      "#researchMD .rmd-tut-card { display: flex; flex-direction: column; justify-content: space-between; gap: 8px; padding: 12px; border: 1px solid var(--rmd-line); border-radius: 10px; background: var(--rmd-bg); }",
      "#researchMD .rmd-tut-card-title { margin: 0; font: 700 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-tut-card-eg { margin: 0; font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); line-height: 1.4; }",
      "#researchMD .rmd-start-tut-box { padding: 12px 14px; border: 1.5px solid var(--rmd-acc); border-radius: 10px; background: var(--rmd-fill); margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-pub-card { margin-top: 14px; }",
      "#researchMD .rmd-cele-backdrop { overflow: hidden; }",
      "#researchMD .rmd-cele-confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }",
      "#researchMD .rmd-confetti-bit { position: absolute; top: -12px; width: 9px; height: 14px; border-radius: 2px; opacity: 0.9; animation: rmdConfettiFall 2.8s linear infinite; }",
      "@keyframes rmdConfettiFall { 0% { transform: translateY(-10px) rotate(0deg); opacity: 1; } 100% { transform: translateY(105vh) rotate(540deg); opacity: 0.2; } }",
      "#researchMD .rmd-cele-card { position: relative; max-width: 480px; width: calc(100% - 24px); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 22px 18px; z-index: 2; }",
      "#researchMD .rmd-cele-medal { width: 68px; height: 68px; border-radius: 999px; background: var(--rmd-acc-soft); color: var(--rmd-acc-dark); display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }",
      "#researchMD .rmd-cele-heading { margin: 0; font: 700 21px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-cele-sub { margin: 0; font: 400 13.5px var(--rmd-f); color: var(--rmd-mut); line-height: 1.45; }",
      "#researchMD .rmd-cele-cite { width: 100%; text-align: left; border: 1px solid var(--rmd-line); border-radius: 10px; padding: 10px 12px; background: var(--rmd-fill); box-sizing: border-box; }",
      "#researchMD .rmd-cele-meta { font: 600 12px var(--rmd-f); color: var(--rmd-acc-dark); margin-bottom: 4px; }",
      "#researchMD .rmd-cele-citestr { font: 400 12.5px var(--rmd-f); color: var(--rmd-ink); line-height: 1.4; overflow-wrap: anywhere; }",
      "#researchMD .rmd-cele-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 8px; }",
      "/* PHI override modal (/ai-draft only) */",
      "#researchMD .rmd-phi-ovr-card { max-width: 500px; width: calc(100% - 24px); }",
      "#researchMD .rmd-phi-ovr-lead { margin: 0; font: 400 13.5px/1.5 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-phi-ovr-cats { margin: 0; padding: 10px 12px 10px 28px; background: var(--rmd-warn-soft); border: 1px solid var(--rmd-warn); border-radius: 10px; display: flex; flex-direction: column; gap: 4px; font: 500 13px/1.4 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-phi-ovr-terms { margin: 0; padding: 10px 12px; background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 10px; font: 400 12.5px/1.5 var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-phi-ovr-terms p { margin: 0; }",
      "#researchMD .rmd-phi-ovr-check { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 0; cursor: pointer; font: 500 13.5px/1.4 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-phi-ovr-check input[type=\"checkbox\"] { width: 20px; height: 20px; flex: 0 0 auto; margin: 0; accent-color: var(--rmd-acc); cursor: pointer; }",
      "#researchMD .rmd-phi-ovr-footer { flex-wrap: wrap; }",
      "#researchMD .rmd-phi-ovr-footer .rmd-btn { min-height: 44px; }"
    ].join("\n");
    D.head.appendChild(s);
  }

  var lastSendAttempt = null;
  var failedItemMap = {};
  var confirmingDiscard = false;
  var syncSheetKeyHandler = null;
  var lastFocusedSyncEl = null;
  var syncTimer = null;

  function scheduleSyncCheck(queue) {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    var store = SMD.store;
    var q = queue || (store && store.getQueue ? store.getQueue() : []);
    if (!q || !q.length) return;
    var isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (isOffline) return;
    var now = Date.now();
    var minWait = Infinity;
    for (var i = 0; i < q.length; i++) {
      var ts = q[i] && q[i].timestamp;
      if (ts) {
        var age = now - ts;
        if (age < 30000) {
          var remain = 30000 - age;
          if (remain < minWait) minWait = remain;
        }
      }
    }
    if (minWait !== Infinity) {
      syncTimer = setTimeout(function () {
        updateSyncBadge();
      }, Math.max(100, minWait + 200));
    }
  }

  function formatLastSend(ts) {
    if (!ts) return "Not tried yet";
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return "Just now";
    if (diff < 60) return diff + " seconds ago";
    var mins = Math.floor(diff / 60);
    if (mins === 1) return "1 minute ago";
    if (mins < 60) return mins + " minutes ago";
    var hrs = Math.floor(mins / 60);
    if (hrs === 1) return "1 hour ago";
    return hrs + " hours ago";
  }

  function getItemName(it) {
    if (!it) return "Unknown change";
    if (it.name) return it.name;
    if (it.label) return it.label;
    if (it.payload) {
      if (it.payload.label) return it.payload.label;
      if (it.payload.title) return it.payload.title;
      if (it.payload.name) return it.payload.name;
    }
    if (it.type) {
      if (it.type === "project_create") return "Project";
      if (it.type === "study_create") return "Study";
      if (it.type === "study_update" || it.type === "study_update_forced") return "Study update";
      if (it.type === "run_create") return "Analysis run";
      return it.type.replace(/_/g, " ");
    }
    return "Change (" + it.id + ")";
  }

  function getFailedItems(queue) {
    var store = SMD.store;
    var q = queue || (store && store.getQueue ? store.getQueue() : []);
    var failed = [];
    for (var i = 0; i < q.length; i++) {
      var it = q[i];
      if (it && (it.error || it.lastError || failedItemMap[it.id])) {
        failed.push(it);
      }
    }
    return failed;
  }

  function getFailedNames(items) {
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var n = getItemName(items[i]);
      if (list.indexOf(n) === -1) list.push(n);
    }
    return list.join(", ");
  }

  function getSyncBadgeHtml(syncState, queueCount, queue) {
    var store = SMD.store;
    var q = queue || (store && store.getQueue ? store.getQueue() : []);
    var count = typeof queueCount === "number" ? queueCount : (q ? q.length : 0);

    var isOffline = false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      isOffline = true;
    }

    var now = Date.now();
    var hasOldItem = false;
    for (var i = 0; i < q.length; i++) {
      var ts = q[i] && q[i].timestamp;
      if (ts && (now - ts) > 30000) {
        hasOldItem = true;
        break;
      }
    }

    var show = count > 0 && (isOffline || hasOldItem);

    if (!show) {
      return '<button type="button" class="rmd-sync-pill rmd-sync-hidden" id="rmdSyncBadge" style="display:none;" aria-label="Sync status" data-rmd="sync-badge"></button>';
    }

    var label;
    var cls;
    if (isOffline) {
      label = "Offline: " + count + " " + (count === 1 ? "change" : "changes") + " waiting";
      cls = "rmd-sync-pill rmd-sync-queue rmd-sync-offline";
    } else {
      label = "Saving " + count + " " + (count === 1 ? "change" : "changes");
      cls = "rmd-sync-pill rmd-sync-queue rmd-sync-saving";
    }

    var dotSvg = '<svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg>';
    return '<button type="button" class="' + cls + '" id="rmdSyncBadge" data-rmd="sync-badge" aria-label="' + esc(label) + '. Tap to view details.">' + dotSvg + '<span>' + esc(label) + '</span></button>';
  }

  function syncSheetContentHtml() {
    var store = SMD.store;
    var q = store && store.getQueue ? store.getQueue() : [];
    var count = q.length;
    var failed = getFailedItems(q);
    var isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    var lastStr = formatLastSend(lastSendAttempt);

    var h = [];
    h.push('<div class="rmd-sync-sheet-inner">');
    h.push('  <p class="rmd-sync-explain">These changes are saved on this phone and will be sent to your account automatically when you are back online. Nothing is lost if you close the app.</p>');
    h.push('  <div class="rmd-sync-meta-box">');
    h.push('    <div class="rmd-sync-meta-row">');
    h.push('      <span class="rmd-sync-meta-label">Waiting to send:</span>');
    h.push('      <span class="rmd-sync-meta-value" id="rmdSyncWaitingCount">' + count + ' ' + (count === 1 ? 'change' : 'changes') + '</span>');
    h.push('    </div>');
    h.push('    <div class="rmd-sync-meta-row">');
    h.push('      <span class="rmd-sync-meta-label">Connection:</span>');
    h.push('      <span class="rmd-sync-meta-value">' + (isOffline ? 'Offline' : 'Online') + '</span>');
    h.push('    </div>');
    h.push('    <div class="rmd-sync-meta-row">');
    h.push('      <span class="rmd-sync-meta-label">Last time a send was tried:</span>');
    h.push('      <span class="rmd-sync-meta-value" id="rmdSyncLastSendTime">' + esc(lastStr) + '</span>');
    h.push('    </div>');
    h.push('  </div>');

    if (failed.length > 0) {
      h.push('  <div class="rmd-sync-failed-box">');
      h.push('    <div class="rmd-sync-failed-line"><strong>Failed:</strong> ' + esc(getFailedNames(failed)) + '</div>');
      if (confirmingDiscard) {
        h.push('    <div class="rmd-sync-confirm-box" role="alert">');
        h.push('      <p class="rmd-sync-confirm-msg">Discard these ' + failed.length + ' failed ' + (failed.length === 1 ? 'change' : 'changes') + ' from this phone? They will not be sent to your account.</p>');
        h.push('      <div class="rmd-sync-confirm-actions">');
        h.push('        <button type="button" class="rmd-btn rmd-btn-bad rmd-btn-sm" data-rmd-sync-action="confirm-discard">Yes, discard</button>');
        h.push('        <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-sync-action="cancel-discard">Cancel</button>');
        h.push('      </div>');
        h.push('    </div>');
      } else {
        h.push('    <div class="rmd-sync-discard-wrap">');
        h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm rmd-sync-discard-btn" data-rmd-sync-action="discard" id="rmdSyncDiscardBtn">Discard these</button>');
        h.push('    </div>');
      }
      h.push('  </div>');
    }

    h.push('  <div class="rmd-sync-actions">');
    h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-sync-btn-send" data-rmd-sync-action="drain" id="rmdSyncSendNow">Send now</button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-sync-action="close">Done</button>');
    h.push('  </div>');
    h.push('</div>');
    return h.join('\n');
  }

  function refreshSyncSheet() {
    if (!root) return;
    var body = root.querySelector("#rmdSyncSheetBody");
    if (body) {
      body.innerHTML = syncSheetContentHtml();
      var modal = root.querySelector("#rmdSyncSheetModal");
      if (modal) bindSyncSheetActions(modal);
    }
  }

  function executeDiscard() {
    var store = SMD.store;
    var q = store && store.getQueue ? store.getQueue() : [];
    var failed = getFailedItems(q);
    for (var f = 0; f < failed.length; f++) {
      var fid = failed[f].id;
      delete failedItemMap[fid];
      if (store && store.removeQueueItem) {
        store.removeQueueItem(fid);
      }
    }
    confirmingDiscard = false;
    refreshSyncSheet();
    updateSyncBadge();
  }

  function bindSyncSheetActions(container) {
    if (!container) return;
    var sendBtn = container.querySelector("#rmdSyncSendNow");
    if (sendBtn) {
      sendBtn.onclick = function () {
        if (sendBtn.disabled) return;
        sendBtn.disabled = true;
        sendBtn.textContent = "Sending...";
        lastSendAttempt = Date.now();
        drainQueue().then(function () {
          updateSyncBadge();
          refreshSyncSheet();
        }).catch(function () {
          updateSyncBadge();
          refreshSyncSheet();
        });
      };
    }

    var closeBtns = container.querySelectorAll("[data-rmd-sync-action='close']");
    for (var c = 0; c < closeBtns.length; c++) {
      closeBtns[c].onclick = closeSyncSheet;
    }

    var discardBtn = container.querySelector("#rmdSyncDiscardBtn");
    if (discardBtn) {
      discardBtn.onclick = function () {
        confirmingDiscard = true;
        refreshSyncSheet();
      };
    }

    var confirmDiscardBtn = container.querySelector("[data-rmd-sync-action='confirm-discard']");
    if (confirmDiscardBtn) {
      confirmDiscardBtn.onclick = executeDiscard;
    }

    var cancelDiscardBtn = container.querySelector("[data-rmd-sync-action='cancel-discard']");
    if (cancelDiscardBtn) {
      cancelDiscardBtn.onclick = function () {
        confirmingDiscard = false;
        refreshSyncSheet();
      };
    }
  }

  function closeSyncSheet() {
    var modal = root ? root.querySelector("#rmdSyncSheetModal") : null;
    if (modal && modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
    if (syncSheetKeyHandler) {
      document.removeEventListener("keydown", syncSheetKeyHandler);
      syncSheetKeyHandler = null;
    }
    confirmingDiscard = false;
    var chip = root ? root.querySelector("#rmdSyncBadge") : null;
    if (chip && chip.style.display !== "none" && chip.focus) {
      try { chip.focus(); } catch (e) {}
    } else if (lastFocusedSyncEl && lastFocusedSyncEl.focus) {
      try { lastFocusedSyncEl.focus(); } catch (e) {}
    }
  }

  function openSyncSheet() {
    if (!root) return;
    closeSyncSheet();
    lastFocusedSyncEl = document.activeElement;

    var back = document.createElement("div");
    back.className = "rmd-modal-backdrop";
    back.id = "rmdSyncSheetModal";

    back.innerHTML = '<div class="rmd-modal-card rmd-sync-sheet-card" role="dialog" aria-modal="true" aria-labelledby="rmdSyncSheetTitle">' +
      '<div class="rmd-modal-header">' +
        '<h3 id="rmdSyncSheetTitle">Changes waiting to save</h3>' +
        '<button type="button" class="rmd-btn-close" data-rmd-sync-close="1" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="rmd-sync-sheet-body" id="rmdSyncSheetBody">' +
        syncSheetContentHtml() +
      '</div>' +
    '</div>';

    root.appendChild(back);
    back.addEventListener("click", function (e) {
      if (e.target === back) closeSyncSheet();
    });
    var closeBtn = back.querySelector("[data-rmd-sync-close]");
    if (closeBtn) closeBtn.onclick = closeSyncSheet;

    bindSyncSheetActions(back);

    syncSheetKeyHandler = function (e) {
      if (e.key === "Escape") closeSyncSheet();
    };
    document.addEventListener("keydown", syncSheetKeyHandler);
  }

  function bindSyncBadgeEvent() {
    if (!root) return;
    var b = root.querySelector("#rmdSyncBadge");
    if (b) {
      b.onclick = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        openSyncSheet();
      };
    }
  }

  function updateSyncBadge() {
    if (!root) return;
    var store = SMD.store;
    var state = store && store.getState ? store.getState() : { syncState: "synced", offlineQueue: [] };
    var q = (state && state.offlineQueue) || (store && store.getQueue ? store.getQueue() : []);
    var badge = root.querySelector("#rmdSyncBadge");
    if (badge && badge.parentNode) {
      badge.outerHTML = getSyncBadgeHtml(state.syncState, q.length, q);
      bindSyncBadgeEvent();
    }
    scheduleSyncCheck(q);
  }

  function renderShell() {
    if (!root) {
      root = D.createElement("div");
      root.id = "researchMD";
      root.setAttribute("hidden", "true");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "ResearchMD");
      D.body.appendChild(root);
      root.addEventListener("click", onShellAction);
    }

    var store = SMD.store;
    var syncState = store ? store.getState().syncState : "synced";
    var queue = store ? store.getQueue() : [];
    var queueCount = queue.length;
    var showBack = currentScreen !== "projects";

    var h = [];
    h.push('<div class="rmd-shell-top">');
    h.push('  <div class="rmd-shell-nav">');
    if (showBack) {
      h.push('    <button type="button" class="rmd-nav-back" data-rmd="back">');
      h.push('      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>');
      h.push('      <span>ResearchMD</span>');
      h.push('    </button>');
    } else {
      var brandProj = store ? store.getActiveProject() : null;
      var brandTag = (currentScreen !== "projects" && currentScreen !== "start" && brandProj && brandProj.studyType)
        ? brandProj.studyType
        : "Research Workspace";
      h.push('    <div class="rmd-shell-brand">');
      h.push('      <svg class="rmd-logo" viewBox="0 0 470 589" aria-hidden="true" focusable="false"><path class="rmd-logo-a" d="M0 0h110v589H0z"/><path class="rmd-logo-b" d="M135 0h122a175 175 0 0 1 0 350H135v-85h122a90 90 0 0 0 0-180H135z"/><path class="rmd-logo-a" d="M135 372h60l140 217h-60z"/><path class="rmd-logo-b" d="M250 372h80l140 217h-80z"/></svg>');
      h.push('      <strong>Research<b>MD</b></strong>');
      h.push('      <span>' + esc(brandTag) + '</span>');
      h.push('    </div>');
    }
    h.push('  </div>');

    h.push('  <div class="rmd-shell-center">');
    h.push('    <form class="rmd-head-read-bar" data-rmd="header-read-form">');
    h.push('      <input type="text" class="rmd-head-read-input" data-rmd="header-paste-link" placeholder="Paste study link or DOI (10.xxxx)" aria-label="Paste study link or DOI" autocomplete="off" />');
    h.push('      <button type="submit" class="rmd-btn rmd-btn-primary rmd-btn-sm rmd-head-read-btn" data-rmd="header-read-study">Read study</button>');
    h.push('    </form>');
    h.push('  </div>');

    h.push('  <div class="rmd-shell-right">');
    h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm rmd-head-rstu-btn" data-rmd="open-read-study" aria-label="Open Read Study page">RStudy</button>');
    h.push(getSyncBadgeHtml(syncState, queueCount, queue));
    h.push('    <button type="button" class="rmd-shell-close" data-rmd="close" aria-label="Close ResearchMD"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>');
    h.push('  </div>');
    h.push('</div>');

    if (currentScreen !== "projects" && currentScreen !== "start" && currentScreen !== "read-study") {
      var proj = store ? store.getActiveProject() : null;
      var journey = journeyFor(proj);
      var curIdx = -1;
      for (var ji = 0; ji < journey.length; ji++) {
        if (journey[ji] === currentScreen) curIdx = ji;
      }
      h.push('<nav class="rmd-shell-tabs" aria-label="Research screens">');
      for (var t = 0; t < journey.length; t++) {
        var name = journey[t];
        var active = currentScreen === name;
        var stateCls = active ? " rmd-tab-active" : (curIdx >= 0 && t < curIdx ? " rmd-tab-done" : " rmd-tab-later");
        h.push('<button type="button" class="rmd-tab' + stateCls + '" data-rmd-tab="' + name + '"' + (active ? ' aria-current="page"' : '') + '>' + esc(TAB_LABELS[name] || name) + '</button>');
      }
      h.push('<button type="button" class="rmd-tab rmd-tab-more" data-rmd-action="toggle-more" aria-expanded="' + (moreOpen ? "true" : "false") + '">More</button>');
      h.push('</nav>');
      if (moreOpen) {
        h.push('<nav class="rmd-shell-tabs rmd-shell-tabs-more" aria-label="More tools">');
        for (var a = 0; a < ADVANCED_TABS.length; a++) {
          var aActive = currentScreen === ADVANCED_TABS[a];
          h.push('<button type="button" class="rmd-tab' + (aActive ? ' rmd-tab-active' : '') + '" data-rmd-tab="' + ADVANCED_TABS[a] + '"' + (aActive ? ' aria-current="page"' : '') + '>' + esc(TAB_LABELS[ADVANCED_TABS[a]]) + '</button>');
        }
        h.push('</nav>');
      }
    }

    h.push('<div id="rmdHelpWrap"></div>');
    h.push('<div id="rmdTutWrap"></div>');
    h.push('<div class="rmd-shell-body" id="rmdScreenBody"></div>');
    h.push('<div class="rmd-shell-footer"><button type="button" class="rmd-footer-feedback" data-rmd-action="feedback">Tell us what went wrong</button></div>');

    root.innerHTML = h.join("\n");
    bindShellEvents();
  }

  function bindShellEvents() {
    if (!root) return;
    bindSyncBadgeEvent();

    var closeBtn = root.querySelector('[data-rmd="close"]');
    if (closeBtn) {
      closeBtn.onclick = function () {
        close();
      };
    }

    var backBtn = root.querySelector('[data-rmd="back"]');
    if (backBtn) {
      backBtn.onclick = function () {
        navStack = [];
        moreOpen = false;
        navigate("projects", {}, true);
      };
    }

    var tabBtns = root.querySelectorAll("[data-rmd-tab]");
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].onclick = function () {
        var name = this.getAttribute("data-rmd-tab");
        if (name && name !== currentScreen) navigate(name, {});
      };
    }

    var rstuBtn = root.querySelector('[data-rmd="open-read-study"]');
    if (rstuBtn) {
      rstuBtn.onclick = function () {
        if (currentScreen === "read-study") {
          var pageInp = root.querySelector('#rmdReadStudyWrap [data-rmd="paste-link-input"]');
          if (pageInp && pageInp.focus) pageInp.focus();
          return;
        }
        navigate("read-study", {});
      };
    }

    var headForm = root.querySelector('[data-rmd="header-read-form"]');
    var headInput = root.querySelector('[data-rmd="header-paste-link"]');
    function cleanHeadVal(v) {
      if (SMD.paperCard && SMD.paperCard.normalizeLink) return SMD.paperCard.normalizeLink(v);
      return String(v || "").trim();
    }
    if (headForm) {
      headForm.onsubmit = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        var val = cleanHeadVal(headInput ? headInput.value : "");
        if (headInput && val) headInput.value = val;
        navigate("read-study", val ? { link: val } : {});
      };
    }
    if (headInput) {
      headInput.addEventListener("paste", function (ev) {
        var pastedText = "";
        if (ev && ev.clipboardData && ev.clipboardData.getData) {
          try { pastedText = ev.clipboardData.getData("text"); } catch (e) {}
        }
        if (pastedText) {
          if (ev.preventDefault) ev.preventDefault();
          var cleaned = cleanHeadVal(pastedText);
          headInput.value = cleaned;
          if (cleaned) navigate("read-study", { link: cleaned });
          return;
        }
        setTimeout(function () {
          var val = cleanHeadVal(headInput.value || "");
          if (val) {
            headInput.value = val;
            navigate("read-study", { link: val });
          }
        }, 0);
      });
    }
  }

  var ADVANCED_SCREENS = { ipd: 1, institution: 1, credits: 1, templates: 1, journals: 1 };
  var ADVANCED_TABS = ["ipd", "credits", "institution", "templates", "journals"];
  var SERVER_SCREENS = {
    protocol: 1, search: 1, screening: 1, conflicts: 1, prisma: 1, pdf: 1,
    extract: 1, rob: 1, data: 1, grade: 1, manuscript: 1, checklist: 1, ipd: 1, ready: 1,
    thesis: 1, "thesis-type": 1, "thesis-journal": 1, "thesis-draft": 1, "thesis-tables": 1, "thesis-refs": 1
  };
  var moreOpen = false;
  var accountSaveNotice = "";

  var TAB_LABELS = {
    plan: "Plan",
    studies: "Studies", "read-study": "Read study", protocol: "Protocol", search: "Search", screening: "Screening",
    conflicts: "Conflicts", prisma: "PRISMA", pdf: "PDF", extract: "Extract",
    rob: "Risk of Bias", data: "Data", run: "Run", grade: "GRADE",
    manuscript: "Manuscript", checklist: "Checklist", ready: "Submit",
    ipd: "IPD", credits: "Credits", institution: "Institution",
    templates: "Templates", journals: "Journals",
    thesis: "Thesis", "thesis-type": "Paper type", "thesis-journal": "Journal",
    "thesis-draft": "Draft", "thesis-tables": "Tables", "thesis-refs": "References",
    masterchart: "Master chart",
    casefile: "Case file", novelty: "Novelty", iec: "Ethics committee",
    pubconsent: "Consent for publication", images: "Images", ctri: "CTRI",
    randomise: "Randomise", consort: "CONSORT flow", backup: "Backup"
  };

  var HELP = {
    plan: {
      name: "Plan your study",
      do: "Calculate sample size, draft ethics committee application, consent form, and CTRI registration.",
      eg: "118 patients per group needed for 80% power.",
      gloss: "New words: Sample size (how many patients you need), IEC (Institutional Ethics Committee), CTRI (Clinical Trials Registry - India).",
      action: { label: "Next: write protocol", fallback: "protocol" }
    },
    projects: {
      name: "Your projects",
      do: "Open a project to continue, or start a new one with a guide.",
      eg: "",
      gloss: "",
      action: { label: "Start guided", fallback: "start" }
    },
    masterchart: {
      name: "Analyse my master chart",
      do: "Upload your Excel master chart. We check for patient identifiers, pick the right tests and write Table 1 and the results. Your chart stays on this phone.",
      eg: "Compare HbA1c at 12 weeks between Drug A and Drug B.",
      gloss: "New words: master chart (the spreadsheet with one row per patient), p value (how likely a difference this big is due to chance).",
      action: { label: "Next: write the paper", fallback: "manuscript" }
    },
    thesis: {
      name: "Upload your thesis",
      do: "Upload your MD/MS/DNB thesis as a PDF or Word (.docx) file. Text is read directly on your device and checked for patient identifiers before any AI step.",
      eg: "Upload your thesis PDF or .docx directly.",
      gloss: "New words: patient identifiers (names, dates of birth, hospital numbers or contact details that could reveal who a patient is).",
      action: { label: "Next: pick the paper type", fallback: "thesis-type" }
    },
    "thesis-type": {
      name: "Pick the paper type",
      do: "Choose the kind of journal paper your thesis becomes. We suggest one and match the reporting checklist.",
      eg: "An observational study uses STROBE (the reporting checklist for observational studies).",
      gloss: "New words: reporting checklist (a list of items journals ask you to report, like STROBE, CONSORT, CARE or PRISMA).",
      action: { label: "Next: pick the journal", fallback: "thesis-journal" }
    },
    "thesis-journal": {
      name: "Pick the target journal",
      do: "Choose a journal. We shape the draft to its word limit, abstract format and reference style.",
      eg: "Default: general Indian medical journal format, 3,000 words, structured abstract.",
      gloss: "New words: structured abstract (an abstract split into Background, Methods, Results and Conclusion).",
      action: { label: "Next: shape the draft", fallback: "thesis-draft" }
    },
    "thesis-draft": {
      name: "Shape the draft",
      do: "Ask MaiK to map your thesis chapters to IMRaD and shorten to the word limit, or write it yourself. Every number is checked against your thesis.",
      eg: "Tap a number to see where it came from, like page 54, Table 7.",
      gloss: "New words: IMRaD (Introduction, Methods, Results and Discussion, the standard shape of a journal article).",
      action: { label: "Next: pick the tables", fallback: "thesis-tables" }
    },
    "thesis-tables": {
      name: "Keep the important tables",
      do: "Keep up to 3 tables. MaiK suggests three and says why; you tick the ones to keep.",
      eg: "Keep the main results table and drop the appendix tables.",
      gloss: "",
      action: { label: "Next: check the references", fallback: "thesis-refs" }
    },
    "thesis-refs": {
      name: "Check the references",
      do: "We reformat references to the journal style. A reference without a DOI or PMID is marked for you to check.",
      eg: "Add a DOI (digital object identifier) so the journal can locate the paper.",
      gloss: "New words: DOI (digital object identifier, a permanent link to a paper) and PMID (PubMed identifier, the number PubMed gives a paper).",
      action: { label: "Next: tick the checklist", fallback: "checklist" }
    },
    "read-study": {
      name: "Read a study",
      do: "Paste a PubMed URL, doi.org link, bare DOI (10.xxxx/...), PMID or PMC ID to read a structured study summary for free.",
      eg: "pubmed.ncbi.nlm.nih.gov/40959673 or 10.1056/NEJMoa1911303",
      gloss: "",
      action: { label: "Back to studies", fallback: "studies" }
    },
    studies: {
      name: "Add your studies",
      do: "Search for papers, tick the ones that fit, and we fill in the numbers. You just check each one matches the paper.",
      eg: "One trial: 4 cases out of 123 vaccinated, 11 out of 139 unvaccinated.",
      gloss: "New words: Risk ratio (RR) and odds ratio (OR) compare how often an outcome happens in two groups. Confidence interval (CI) is the range the true value likely falls in.",
      action: { label: "Find and add studies", sel: '[data-rmd="find-studies"]', fallback: "add-study" }
    },
    protocol: {
      name: "Write your plan",
      do: "Write the plan for your work before you start, so others can follow it.",
      eg: "We will search PubMed for trials of BCG and combine their results.",
      gloss: "",
      action: { label: "Create the protocol", sel: '[data-rmd="proto-create"]', fallback: "search" }
    },
    search: {
      name: "Find studies",
      do: "Search the databases for studies that answer your question.",
      eg: "Search terms: BCG AND tuberculosis AND trial.",
      gloss: "",
      action: { label: "Run the search", sel: '[data-rmd="search-run"]', fallback: "screening" }
    },
    screening: {
      name: "Pick the studies",
      do: "Read each title and abstract, then keep or drop the study.",
      eg: "Keep a trial of BCG in children. Drop a study about cows.",
      gloss: "New words: PRISMA (a standard that asks reviews to report every study found, kept or dropped).",
      action: { label: "Next: resolve disagreements", fallback: "conflicts" }
    },
    conflicts: {
      name: "Resolve disagreements",
      do: "When two reviewers disagree about a study, decide together and record why.",
      eg: "One kept a study, one dropped it. Read the abstract again and agree.",
      gloss: "",
      action: { label: "Next: count your studies", fallback: "prisma" }
    },
    prisma: {
      name: "Count your studies",
      do: "Fill in how many studies you found, screened and kept at each stage.",
      eg: "Found 120 records, kept 12 studies.",
      gloss: "New words: PRISMA (the reporting standard for reviews; this flow diagram shows where each study went).",
      action: { label: "Next: read the papers", fallback: "pdf" }
    },
    pdf: {
      name: "Read the papers",
      do: "Open the full paper for each kept study and check it fits your question.",
      eg: "Read the methods section to confirm it is a trial.",
      gloss: "",
      action: { label: "Next: take out the numbers", fallback: "extract" }
    },
    extract: {
      name: "Take out the numbers",
      do: "Copy the outcome numbers from each paper into your extraction sheet.",
      eg: "From Table 2: 4 cases in 123 vaccinated, 11 in 139 unvaccinated.",
      gloss: "",
      action: { label: "Next: judge study quality", fallback: "rob" }
    },
    rob: {
      name: "Judge study quality",
      do: "Rate how likely each study is to be biased, domain by domain.",
      eg: "Was the allocation hidden? If not, rate that domain high risk.",
      gloss: "New words: Risk of Bias (how likely a study's design or conduct pushed its result away from the truth).",
      action: { label: "Next: check your data", fallback: "data" }
    },
    data: {
      name: "Check your data",
      do: "Check every extracted number for mistakes before you combine them.",
      eg: "Events cannot be larger than the group total.",
      gloss: "",
      action: { label: "Next: combine the results", fallback: "run" }
    },
    run: {
      name: "Combine the results",
      do: "Run the meta-analysis to pool the studies into one overall answer.",
      eg: "Pool 13 trials to get one risk ratio with a confidence interval.",
      gloss: "New words: forest plot (a chart of every study's result and the pooled result), heterogeneity (how much studies differ), I2 (the percent of that difference not due to chance).",
      action: { label: "Combine the results", sel: '[data-rmd="calculate"]', fallback: "grade" }
    },
    grade: {
      name: "Rate the evidence",
      do: "Rate how sure you are about each pooled result.",
      eg: "Start high for trials, drop a level for serious risk of bias.",
      gloss: "New words: GRADE (a system that rates certainty in the evidence from high to very low).",
      action: { label: "Next: write the paper", fallback: "manuscript" }
    },
    manuscript: {
      name: "Write the paper",
      do: "Draft each section, then ask a clinician to review and approve it.",
      eg: "Results: BCG reduced tuberculosis, risk ratio 0.49.",
      gloss: "",
      action: { label: "Next: tick the checklist", fallback: "checklist" }
    },
    checklist: {
      name: "Tick the reporting checklist",
      do: "Point each reporting item to where your paper covers it, or type a short note.",
      eg: "Item 1 (title): the title says systematic review.",
      gloss: "New words: reporting checklist (a list journals ask you to fill in, like PRISMA for reviews or CARE for case reports).",
      action: { label: "Next: get ready to submit", fallback: "ready" }
    },
    ipd: {
      name: "Individual patient data",
      do: "Work with raw patient-level data instead of published totals, if you have it.",
      eg: "One row per patient with age, group and outcome.",
      gloss: "New words: IPD (individual participant data: the raw rows behind each study, not just its published totals).",
      action: { label: "Back to my project", fallback: "studies" }
    },
    credits: {
      name: "MaiK tokens",
      do: "See your MaiK token balance and add tokens for AI steps.",
      eg: "",
      gloss: "",
      action: { label: "Back to my project", fallback: "studies" }
    },
    institution: {
      name: "Your institution",
      do: "Set your institution details for the paper's affiliations.",
      eg: "",
      gloss: "",
      action: { label: "Back to my project", fallback: "studies" }
    },
    templates: {
      name: "Templates",
      do: "Browse starting templates for protocols and papers.",
      eg: "",
      gloss: "",
      action: { label: "Back to my project", fallback: "studies" }
    },
    journals: {
      name: "Find a journal",
      do: "Look for journals that publish your kind of paper.",
      eg: "",
      gloss: "",
      action: { label: "Back to my project", fallback: "studies" }
    },
    casefile: {
      name: "Case file",
      do: "Record the case in CARE order (the case report checklist): what brought the patient in, the history, examination, tests, diagnosis, treatment and what happened next.",
      eg: "Zinc phosphide poisoning presenting as a heart attack.",
      gloss: "New words: CARE (the checklist journals use for a case report).",
      action: { label: "Next: check novelty", fallback: "novelty" }
    },
    novelty: {
      name: "Novelty",
      do: "See whether similar cases are already published (novelty means the case adds something new).",
      eg: "Search the diagnosis plus the unusual finding.",
      gloss: "",
      action: { label: "Next: ethics committee", fallback: "iec" }
    },
    iec: {
      name: "Ethics committee",
      do: "Record the ethics committee (IEC) decision before you publish patient information.",
      eg: "A waiver, or the approval number from your hospital committee.",
      gloss: "New words: IEC (Institutional Ethics Committee, the hospital group that approves research).",
      action: { label: "Next: consent for publication", fallback: "pubconsent" }
    },
    pubconsent: {
      name: "Consent for publication",
      do: "Get consent to publish the case (permission to print the story, which is separate from treatment consent).",
      eg: "The patient, or a relative if the patient cannot consent, signs in their language.",
      gloss: "",
      action: { label: "Next: images", fallback: "images" }
    },
    images: {
      name: "Images",
      do: "Add photos only after you hide anything that could identify the patient.",
      eg: "Cover the eyes and remove names from the scan.",
      gloss: "",
      action: { label: "Next: write the paper", fallback: "manuscript" }
    },
    ctri: {
      name: "CTRI",
      do: "Register the trial on CTRI (Clinical Trials Registry - India) before the first patient.",
      eg: "A CTRI number looks like CTRI/2026/01/123456.",
      gloss: "New words: CTRI (Clinical Trials Registry - India, where a trial is registered before it starts).",
      action: { label: "Next: randomise", fallback: "randomise" }
    },
    randomise: {
      name: "Randomise",
      do: "Make the allocation list (who gets which treatment) and keep it hidden.",
      eg: "Blocks of 4 or 6, two arms, one list per centre.",
      gloss: "New words: randomise (assign each patient to a treatment by chance, not by choice).",
      action: { label: "Next: master chart", fallback: "masterchart" }
    },
    consort: {
      name: "CONSORT flow diagram",
      do: "Record how many participants were assessed, randomised, followed up and analysed in your trial.",
      eg: "120 assessed, 100 randomised (50 intervention, 50 control).",
      gloss: "New words: CONSORT (the standard reporting flow diagram for randomised controlled trials).",
      action: { label: "Next: master chart", fallback: "masterchart" }
    },
    backup: {
      name: "Back up your data",
      do: "Export an encrypted backup file or restore an earlier backup so your study records stay safe.",
      eg: "Download a backup JSON file after entering participant records.",
      gloss: "",
      action: { label: "Back to projects", fallback: "projects" }
    },
    ready: {
      name: "Submit to a journal",
      do: "Check that your reporting checklist, journal format rules and Word manuscript pass every check before submission.",
      eg: "Checklist 100% done, abstract under the journal word limit, clean DOCX exported.",
      gloss: "",
      action: { label: "Back to projects", fallback: "projects" }
    }
  };

  var STEP_TIPS = {
    plan: "calculate sample size, draft ethics, consent and CTRI.",
    studies: "add the studies to combine.",
    protocol: "write your question first.",
    search: "find papers for your question.",
    screening: "keep or drop each study.",
    conflicts: "settle reviewer disagreements.",
    prisma: "count studies at each stage.",
    pdf: "read each kept paper.",
    extract: "copy the outcome numbers.",
    rob: "rate each study for bias.",
    data: "check the numbers for errors.",
    run: "pool the studies into one answer.",
    grade: "rate how sure you are.",
    manuscript: "draft and approve the paper.",
    checklist: "point items to your paper.",
    ready: "check what is left to submit.",
    thesis: "upload your thesis PDF or Word (.docx).",
    "thesis-type": "pick the paper type.",
    "thesis-journal": "pick the target journal.",
    "thesis-draft": "shape the draft, checking every number.",
    "thesis-tables": "keep up to 3 tables.",
    "thesis-refs": "check the references.",
    masterchart: "upload your chart and pick the tests.",
    casefile: "record the case without a name or hospital number.",
    novelty: "see whether similar cases are already published.",
    iec: "record the ethics committee decision.",
    pubconsent: "get consent to publish the case.",
    images: "hide anything that could identify the patient.",
    ctri: "register the trial before the first patient.",
    randomise: "make the allocation list and keep it hidden."
  };

  var FALLBACK_JOURNEYS = {
    "case-report": ["casefile", "novelty", "iec", "pubconsent", "images", "manuscript", "checklist", "ready"],
    "case-series": ["casefile", "novelty", "iec", "pubconsent", "images", "masterchart", "manuscript", "checklist", "ready"],
    "case-control": ["plan", "protocol", "iec", "masterchart", "manuscript", "checklist", "ready"],
    "cohort": ["plan", "protocol", "iec", "masterchart", "manuscript", "checklist", "ready"],
    "rct": ["plan", "protocol", "iec", "ctri", "randomise", "masterchart", "manuscript", "checklist", "ready"]
  };

  var FALLBACK_CHECKLISTS = {
    "case-report": { protocol: "none", publication: "care" },
    "case-series": { protocol: "none", publication: "care" },
    "case-control": { protocol: "none", publication: "strobe" },
    "cohort": { protocol: "none", publication: "strobe" },
    "rct": { protocol: "spirit", publication: "consort" }
  };

  function copySteps(list) {
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  /* Match case-control and case-series before case-report. Never test the bare word case. */
  function studyKey(project) {
    var t = ((project && project.studyType) || "").toLowerCase();
    if (t.indexOf("case-control") >= 0 || t.indexOf("case control") >= 0) return "case-control";
    if (t.indexOf("case-series") >= 0 || t.indexOf("case series") >= 0) return "case-series";
    if (t.indexOf("case-report") >= 0 || t.indexOf("case report") >= 0) return "case-report";
    if (t.indexOf("rct") >= 0 || t.indexOf("randomized") >= 0 || t.indexOf("randomised") >= 0 || t.indexOf("trial") >= 0) return "rct";
    if (t.indexOf("cohort") >= 0 && t.indexOf("synthesis") < 0) return "cohort";
    return "";
  }

  function journeyFor(project) {
    var key = studyKey(project);
    var C = G.SMD_RESEARCH_CONTRACTS;
    var journeys = C && C.JOURNEYS;
    var steps = (journeys && journeys[key]) || FALLBACK_JOURNEYS[key];
    var t;
    if (steps) return copySteps(steps);
    t = ((project && project.studyType) || "").toLowerCase();
    if (t.indexOf("master chart") >= 0 || t.indexOf("masterchart") >= 0 ||
        t.indexOf("cross-sectional") >= 0 || t.indexOf("cross sectional") >= 0) {
      return ["plan", "protocol", "masterchart", "manuscript", "checklist", "ready"];
    }
    if (t.indexOf("thesis") >= 0) return ["thesis", "thesis-type", "thesis-journal", "thesis-draft", "thesis-tables", "thesis-refs", "checklist", "ready"];
    if (t.indexOf("observational") >= 0 || t.indexOf("cohort") >= 0 || t.indexOf("survey") >= 0 || t.indexOf("diagnostic") >= 0) {
      return ["plan", "protocol", "masterchart", "manuscript", "checklist", "ready"];
    }
    return ["studies", "protocol", "search", "screening", "conflicts", "prisma", "pdf", "extract", "rob", "data", "run", "grade", "manuscript", "checklist", "ready"];
  }

  function checklistFor(project, step) {
    var key = studyKey(project);
    var C = G.SMD_RESEARCH_CONTRACTS;
    var tables = C && C.CHECKLISTS;
    var row = (tables && tables[key]) || FALLBACK_CHECKLISTS[key];
    var t, which;
    if (row) {
      which = step === "protocol" ? row.protocol : row.publication;
      return which || "none";
    }
    t = ((project && project.studyType) || "").toLowerCase();
    if (t.indexOf("thesis") >= 0) return preferredChecklist(project && (project.serverId || project.id)) || "strobe";
    if (t.indexOf("observational") >= 0 || t.indexOf("cohort") >= 0 || t.indexOf("survey") >= 0 || t.indexOf("diagnostic") >= 0) return "strobe";
    return "prisma2020";
  }

  function localOnly(p) {
    return !!p && !p.serverId;
  }

  function helpPrefs() {
    try { return JSON.parse(localStorage.getItem("smd_rmd_help") || "{}") || {}; } catch (e) { return {}; }
  }

  function preferredChecklist(pid) {
    try {
      var all = JSON.parse(localStorage.getItem("smd_rmd_checklist_guide_v1") || "{}") || {};
      return all[pid] || "";
    } catch (e) { return ""; }
  }

  function setPreferredChecklist(pid, gid) {
    try {
      var all = JSON.parse(localStorage.getItem("smd_rmd_checklist_guide_v1") || "{}") || {};
      all[pid] = gid;
      localStorage.setItem("smd_rmd_checklist_guide_v1", JSON.stringify(all));
    } catch (e) {}
  }
  SMD.preferredChecklist = preferredChecklist;
  SMD.setPreferredChecklist = setPreferredChecklist;
  SMD.journeyFor = journeyFor;
  SMD.checklistFor = checklistFor;

  function seenPrefs() {
    try { return JSON.parse(localStorage.getItem("smd_rmd_seen") || "{}") || {}; } catch (e) { return {}; }
  }

  function glossaryListHtml(filter) {
    var terms = G.SMD_RESEARCH_GLOSSARY || [];
    var q = (filter || "").toLowerCase();
    var h = [];
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (q && (t.term + " " + t.plain + " " + t.example).toLowerCase().indexOf(q) < 0) continue;
      h.push('<div class="rmd-glossary-item"><strong>' + esc(t.term) + '</strong>');
      h.push('<p>' + esc(t.plain) + '</p>');
      h.push('<p class="rmd-glossary-eg">Example: ' + esc(t.example) + '</p></div>');
    }
    if (!h.length) h.push('<p class="rmd-muted">No matching word. Try a shorter search.</p>');
    return h.join("");
  }

  var glossaryKeyHandler = null;
  function closeGlossary() {
    var m = root ? root.querySelector("#rmdGlossaryModal") : null;
    if (m && m.parentNode) m.parentNode.removeChild(m);
    if (glossaryKeyHandler) {
      document.removeEventListener("keydown", glossaryKeyHandler);
      glossaryKeyHandler = null;
    }
  }

  function openGlossary() {
    if (!root) return;
    closeGlossary();
    var back = document.createElement("div");
    back.className = "rmd-modal-backdrop";
    back.id = "rmdGlossaryModal";
    back.innerHTML = '<div class="rmd-modal-card rmd-glossary-card" role="dialog" aria-modal="true" aria-labelledby="rmdGlossaryTitle">' +
      '<div class="rmd-modal-header"><h3 id="rmdGlossaryTitle">What does this word mean?</h3>' +
      '<button type="button" class="rmd-btn-close" data-rmd-glossary-close="1" aria-label="Close glossary">&times;</button></div>' +
      '<input type="search" class="rmd-glossary-search" id="rmdGlossarySearch" placeholder="Search the words" autocomplete="off">' +
      '<div class="rmd-glossary-list" id="rmdGlossaryList">' + glossaryListHtml("") + '</div></div>';
    root.appendChild(back);
    back.addEventListener("click", function (e) { if (e.target === back) closeGlossary(); });
    var closeBtn = back.querySelector("[data-rmd-glossary-close]");
    if (closeBtn) closeBtn.onclick = closeGlossary;
    var search = back.querySelector("#rmdGlossarySearch");
    var list = back.querySelector("#rmdGlossaryList");
    if (search && list) search.oninput = function () { list.innerHTML = glossaryListHtml(search.value); };
    glossaryKeyHandler = function (e) { if (e.key === "Escape") closeGlossary(); };
    document.addEventListener("keydown", glossaryKeyHandler);
  }
  SMD.openGlossary = openGlossary;

  var feedbackKeyHandler = null;
  function closeFeedback() {
    var m = root ? root.querySelector("#rmdFeedbackModal") : null;
    if (m && m.parentNode) m.parentNode.removeChild(m);
    if (feedbackKeyHandler) {
      document.removeEventListener("keydown", feedbackKeyHandler);
      feedbackKeyHandler = null;
    }
  }

  function openFeedback() {
    if (!root) return;
    closeFeedback();
    var back = document.createElement("div");
    back.className = "rmd-modal-backdrop";
    back.id = "rmdFeedbackModal";
    back.innerHTML = '<div class="rmd-modal-card rmd-feedback-card" role="dialog" aria-modal="true" aria-labelledby="rmdFeedbackTitle">' +
      '<div class="rmd-modal-header"><h3 id="rmdFeedbackTitle">Tell us what went wrong</h3>' +
      '<button type="button" class="rmd-btn-close" data-rmd-feedback-close="1" aria-label="Close feedback">&times;</button></div>' +
      '<p class="rmd-feedback-note">Please do not include patient details or your master chart. We only receive what you type here.</p>' +
      '<textarea id="rmdFeedbackText" class="rmd-feedback-text" rows="4" maxlength="2000" placeholder="What happened? What did you expect?"></textarea>' +
      '<div class="rmd-feedback-status" id="rmdFeedbackStatus" role="status"></div>' +
      '<div class="rmd-feedback-actions"><button type="button" class="rmd-btn rmd-btn-primary" id="rmdFeedbackSend">Send</button></div></div>';
    root.appendChild(back);
    back.addEventListener("click", function (e) { if (e.target === back) closeFeedback(); });
    var closeBtn = back.querySelector("[data-rmd-feedback-close]");
    if (closeBtn) closeBtn.onclick = closeFeedback;
    var textarea = back.querySelector("#rmdFeedbackText");
    var status = back.querySelector("#rmdFeedbackStatus");
    var send = back.querySelector("#rmdFeedbackSend");
    if (send && textarea && status) {
      send.onclick = function () {
        var text = (textarea.value || "").replace(/^\s+|\s+$/g, "");
        if (!text) {
          status.textContent = "Please type a few words first.";
          return;
        }
        var u = null;
        try { u = G.SMD_AUTH && G.SMD_AUTH.currentUser; } catch (e) { u = null; }
        if (!u || !u.getIdToken) {
          status.innerHTML = 'Sign in to send feedback. <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-action="signin">Sign in</button>';
          return;
        }
        send.disabled = true;
        status.textContent = "Sending...";
        var tokenP;
        try { tokenP = u.getIdToken(); } catch (e) { tokenP = Promise.resolve(null); }
        Promise.resolve(tokenP).then(function (token) {
          if (!token) throw { status: 401 };
          return fetch("/api/support", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({
              action: "create",
              kind: "feedback",
              subject: "ResearchMD: " + (TAB_LABELS[currentScreen] || currentScreen),
              text: text
            })
          });
        }).then(function (resp) {
          if (!resp) return;
          if (resp.status === 401) {
            status.innerHTML = 'Sign in to send feedback. <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-action="signin">Sign in</button>';
            send.disabled = false;
            return;
          }
          if (!resp.ok) throw new Error("support " + resp.status);
          status.textContent = "Sent. We read every message.";
          textarea.value = "";
          send.disabled = false;
        }).catch(function () {
          status.textContent = "Could not send just now. Check your connection and try again.";
          send.disabled = false;
        });
      };
    }
    feedbackKeyHandler = function (e) { if (e.key === "Escape") closeFeedback(); };
    document.addEventListener("keydown", feedbackKeyHandler);
  }

  function renderHelp(screenName, proj) {
    var wrap = root ? root.querySelector("#rmdHelpWrap") : null;
    if (!wrap) return;
    var h = "";
    if (accountSaveNotice) {
      h += '<div class="rmd-banner rmd-banner-warn" role="status"><span>' + esc(accountSaveNotice) + '</span></div>';
      accountSaveNotice = "";
    }
    if (screenName === "studies" && localOnly(proj)) {
      h += '<div class="rmd-banner rmd-banner-info" role="status">';
      h += '<span>' + (proj.practice ? "Practice project (on this phone only). The numbers work offline." : "This project is saved on this phone only.") + '</span>';
      h += '<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-action="save">' + (proj.practice ? "Make a copy for me" : "Save this project to your account") + '</button>';
      h += '</div>';
    }
    var info = HELP[screenName];
    var journey = journeyFor(proj);
    var idx = -1;
    for (var i = 0; i < journey.length; i++) {
      if (journey[i] === screenName) idx = i;
    }
    if (info && idx >= 0 && !(proj && proj.tutorial) && helpPrefs()[screenName] !== "closed") {
      var seen = seenPrefs();
      var tip = STEP_TIPS[screenName] || "";
      var label = TAB_LABELS[screenName] || info.name;
      var nextName = idx + 1 < journey.length ? journey[idx + 1] : "";
      h += '<div class="rmd-step-banner" id="rmdStepBanner">';
      h += '<div class="rmd-step-line">';
      h += '<span class="rmd-step-text"><strong>Step ' + (idx + 1) + ' of ' + journey.length + '</strong> &middot; ' + esc(label) + (tip ? ": " + esc(tip) : "") + '</span>';
      h += '<span class="rmd-step-actions">';
      if (nextName) {
        h += '<button type="button" class="rmd-step-next" data-rmd-action="help-next" data-help-sel="" data-help-fallback="' + esc(nextName) + '">Next: ' + esc(TAB_LABELS[nextName] || nextName) + '</button>';
      }
      h += '<button type="button" class="rmd-step-how" data-rmd-step-how="1" aria-expanded="false">How?</button>';
      h += '<button type="button" class="rmd-step-dismiss" data-rmd-step-dismiss="1" aria-label="Hide this step tip">&times;</button>';
      h += '</span>';
      h += '</div>';
      h += '<div class="rmd-step-tip" hidden>';
      h += '<p>' + esc(info.do) + '</p>';
      if (info.eg) h += '<p>Example: ' + esc(info.eg) + '</p>';
      if (info.gloss && !seen[screenName]) h += '<p>' + esc(info.gloss) + '</p>';
      h += '<p><button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd-action="glossary">What does this word mean?</button></p>';
      h += '</div>';
      h += '</div>';
      if (!seen[screenName]) {
        seen[screenName] = 1;
        try { localStorage.setItem("smd_rmd_seen", JSON.stringify(seen)); } catch (e) {}
      }
    }
    wrap.innerHTML = h;
    var howBtn = wrap.querySelector("[data-rmd-step-how]");
    var tipEl = wrap.querySelector(".rmd-step-tip");
    if (howBtn && tipEl) {
      howBtn.onclick = function () {
        var nowOpen = tipEl.hidden;
        tipEl.hidden = !nowOpen;
        howBtn.setAttribute("aria-expanded", nowOpen ? "true" : "false");
      };
    }
    var dismissBtn = wrap.querySelector("[data-rmd-step-dismiss]");
    if (dismissBtn) {
      dismissBtn.onclick = function () {
        var p = helpPrefs();
        p[screenName] = "closed";
        try { localStorage.setItem("smd_rmd_help", JSON.stringify(p)); } catch (e) {}
        renderHelp(screenName, proj);
      };
    }
  }

  function practiceCardHtml(proj) {
    var h = '<div class="rmd-p2-screen"><div class="rmd-card rmd-practice-card">';
    if (proj.practice) {
      h += '<h3>This is a practice project.</h3>';
      h += '<p>Start your own project to search, screen and write.</p>';
      h += '<div class="rmd-practice-actions">';
      h += '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-action="practice-start">Start my own project</button>';
      h += '<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-action="save">Make a copy for me</button>';
      h += '</div>';
    } else {
      h += '<h3>This project is saved on this phone only.</h3>';
      h += '<p>Save it to your account to search, screen and write.</p>';
      h += '<div class="rmd-practice-actions">';
      h += '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-action="save">Save this project to your account</button>';
      h += '</div>';
    }
    h += '<button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd-action="projects">Back to projects</button>';
    h += '</div></div>';
    return h;
  }

  function saveActiveProjectToAccount() {
    var store = SMD.store;
    var p = store && store.getActiveProject ? store.getActiveProject() : null;
    if (!p) { navigate("projects", {}); return; }
    if (p.serverId) { navigate("studies", {}); return; }
    if (!SMD.api) return;
    var body = root ? root.querySelector("#rmdScreenBody") : null;
    if (body) body.innerHTML = '<div class="rmd-p2-screen">' + loadingHtml("Saving your project to your account") + '</div>';
    var payload = {
      title: p.title,
      discipline: p.discipline || "medicine",
      specialty: p.specialty || "",
      studyType: p.studyType || "",
      researchQuestion: p.researchQuestion || ""
    };
    SMD.api.request("POST", "/v1/projects", payload).then(function (res) {
      var sp = res && res.project;
      if (!sp || !sp.id) throw new Error("The server did not return a project.");
      var studies = store.getStudies(p.id) || [];
      var copied = [];
      var failed = 0;
      function copyNext(i) {
        if (i >= studies.length) return Promise.resolve();
        var s = studies[i];
        return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(sp.id) + "/studies", {
          label: s.label || "",
          measure: s.measure,
          inputs: s.inputs,
          locator: s.locator,
          quote: s.quote || ""
        }).then(function (r) {
          if (r && r.study) copied.push(r.study);
        }).catch(function () { failed++; }).then(function () { return copyNext(i + 1); });
      }
      return copyNext(0).then(function () {
        store.migrateLocalProject(p.id, sp, copied);
        if (failed > 0) accountSaveNotice = "Saved your project. " + failed + " studies could not be copied; add them again from the Studies screen.";
        var migrated = store.getActiveProject ? store.getActiveProject() : p;
        navigate(journeyFor(migrated)[0] || "studies", {});
      });
    }).catch(function (err) {
      if (body) body.innerHTML = '<div class="rmd-p2-screen">' + errHtml(err) + '</div>';
    });
  }

  function onShellAction(ev) {
    var syncBtn = ev.target && ev.target.closest ? ev.target.closest("#rmdSyncBadge, [data-rmd='sync-badge']") : null;
    if (syncBtn) {
      openSyncSheet();
      return;
    }
    var el = ev.target;
    while (el && el !== root) {
      if (el.getAttribute && el.getAttribute("data-rmd-action")) break;
      el = el.parentNode;
    }
    if (!el || el === root || !el.getAttribute) return;
    var act = el.getAttribute("data-rmd-action");
    if (!act) return;
    if (act === "signin") {
      if (G.SMD_EMAIL_AUTH && G.SMD_EMAIL_AUTH.openEmail) G.SMD_EMAIL_AUTH.openEmail();
      else if (G.SMD_openProfile) G.SMD_openProfile();
    } else if (act === "credits") {
      navigate("credits", {});
    } else if (act === "projects") {
      navigate("projects", {});
    } else if (act === "save") {
      saveActiveProjectToAccount();
    } else if (act === "practice-start") {
      navigate("start", {});
    } else if (act === "glossary") {
      openGlossary();
    } else if (act === "feedback") {
      openFeedback();
    } else if (act === "retry") {
      navigate(currentScreen, {}, true);
    } else if (act === "toggle-more") {
      moreOpen = !moreOpen;
      navigate(currentScreen, {}, true);
    } else if (act === "help-next") {
      var sel = el.getAttribute("data-help-sel");
      var fb = el.getAttribute("data-help-fallback");
      var target = sel && root ? root.querySelector(sel) : null;
      if (target && !target.disabled) {
        target.click();
      } else if (fb) {
        navigate(fb, {});
      } else {
        var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
        var j = journeyFor(proj);
        for (var i = 0; i < j.length; i++) {
          if (j[i] === currentScreen && i + 1 < j.length) { navigate(j[i + 1], {}); break; }
        }
      }
    }
  }

  function renderReady(container) {
    var store = SMD.store;
    var proj = store && store.getActiveProject ? store.getActiveProject() : null;
    if (!proj) {
      container.innerHTML = '<div class="rmd-p2-screen"><div class="rmd-card"><p>No project selected.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd-action="projects">Back to projects</button></div></div>';
      return;
    }
    if (!SMD.api) {
      container.innerHTML = '<div class="rmd-p2-screen">' + errHtml({ message: "The research API is not available." }) + '</div>';
      return;
    }
    container.innerHTML = '<div class="rmd-p2-screen">' + loadingHtml("Checking what is ready") + '</div>';
    var base = "/v1/projects/" + encodeURIComponent(proj.serverId || proj.id);
    var t = (proj.studyType || "").toLowerCase();
    var gid = checklistFor(proj, "publication");
    if (G.SMD_RESEARCH_CHECKLIST && typeof G.SMD_RESEARCH_CHECKLIST.chooseChecklistId === "function") {
      var prefGid = preferredChecklist(proj.serverId || proj.id) || preferredChecklist(proj.id);
      var tutGid = "";
      if (proj.tutorial && SMD.tutorial && SMD.tutorial.exampleByKey) {
        var tutEx = SMD.tutorial.exampleByKey(proj.tutorialKey || (SMD.tutorial.keyForStudyType && SMD.tutorial.keyForStudyType(proj.studyType)));
        if (tutEx && tutEx.checklistId) tutGid = tutEx.checklistId;
      }
      gid = G.SMD_RESEARCH_CHECKLIST.chooseChecklistId(null, proj, prefGid, tutGid, checklistFor) || gid;
    }
    function softFail(err) {
      var f = friendlyError(err);
      if (f.action === "signin" || f.action === "save-or-back" || f.action === "back" || (err && (err.code === "network" || (err.status || 0) >= 500))) throw err;
      return null;
    }
    var targetJournal = proj.targetJournal || proj.journalId || proj.journal || "jama";
    Promise.all([
      SMD.api.request("GET", base + "/manuscript").catch(softFail),
      SMD.api.request("GET", base + "/checklist-snapshot").catch(softFail),
      SMD.api.request("GET", "/v1/checklists/" + gid).catch(function () { return null; }),
      SMD.api.request("GET", base + "/format-check?journal=" + encodeURIComponent(targetJournal)).catch(function () { return null; })
    ]).then(function (res) {
      var man = res[0] && res[0].manuscript;
      var snap = res[1] && (res[1].snapshot || res[1]);
      var checklist = res[2] && (res[2].checklist || res[2]);
      var formatCheck = res[3];
      var approved = !!man && (man.status === "approved" || man.status === "locked" || (man.approval && man.approval.status === "approved"));
      var counts = null;
      if (G.SMD_RESEARCH_CHECKLIST && checklist && snap) {
        try { counts = G.SMD_RESEARCH_CHECKLIST.fill(checklist, snap).counts; } catch (e) { counts = null; }
      }
      var checklistDone = counts ? (counts.missing === 0 && counts.partial === 0) : !!snap;
      var typeKey = studyKey(proj);
      var isReview = t.indexOf("thesis") >= 0 ? gid === "prisma2020" : (typeKey !== "case-report" && typeKey !== "case-series" && typeKey !== "case-control" && typeKey !== "rct" && typeKey !== "cohort");
      var flowDone = !isReview || !!(snap && snap.prisma && snap.prisma.studiesIncluded > 0);
      var items = [
        { done: approved, yes: "The manuscript is approved by a clinician.", no: "The manuscript still needs clinician approval.", screen: "manuscript" },
        { done: checklistDone, yes: "The reporting checklist is complete.", no: "Some reporting checklist items are still missing.", screen: "checklist" }
      ];
      if (isReview) items.push({ done: flowDone, yes: "The study flow counts are filled in.", no: "The study flow counts are still empty.", screen: "prisma" });
      var allDone = true;
      var firstMissing = "";
      var h = '<div class="rmd-p2-screen rmd-ready-screen"><div class="rmd-card">';
      h += '<h3>Ready to submit</h3>';
      h += '<ul class="rmd-ready-list">';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.done) { allDone = false; if (!firstMissing) firstMissing = it.screen; }
        h += '<li><span class="rmd-badge ' + (it.done ? 'rmd-badge-soft' : 'rmd-badge-pill') + '">' + (it.done ? "Done" : "Missing") + '</span><span>' + esc(it.done ? it.yes : it.no) + '</span></li>';
      }
      h += '</ul>';
      h += '<p class="rmd-help-eg">ResearchMD prepares your files. You upload them on the journal site.</p>';
      if (allDone) {
        h += '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-ready="manuscript">Open the submission pack</button>';
      } else {
        var nextLabel = firstMissing === "manuscript" ? "Get the manuscript approved" : (firstMissing === "checklist" ? "Finish the checklist" : "Fill in the study counts");
        h += '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-ready="' + esc(firstMissing) + '">' + esc(nextLabel) + '</button>';
      }
      h += '</div>';

      /* Feature B: Journal format check card */
      function journalTitle(jid) {
        var id = String(jid || "").toLowerCase();
        if (id === "jama") return "JAMA";
        if (id === "lancet") return "The Lancet";
        if (id === "bmj") return "The BMJ";
        if (id === "nejm") return "NEJM";
        if (id === "plos_one" || id === "plosone") return "PLOS ONE";
        return jid ? jid.toUpperCase() : "Target Journal";
      }

      var FORMAT_CHECK_LABELS = {
        word_count: "Manuscript word count (total length of article body text)",
        total_word_count: "Manuscript word count (total length of article body text)",
        abstract_word_count: "Abstract word count (summary length)",
        abstract_structure: "Abstract structure (standard IMRaD headings in summary)",
        title_length: "Title length (character and word count of the headline)",
        tables_figures: "Tables and figures limit (number of displays and illustrations)",
        tables_figures_count: "Tables and figures limit (number of displays and illustrations)",
        reference_count: "Reference count (number of cited sources)",
        reference_style: "Reference style consistency (Vancouver numbered vs author-year citation format)",
        run_tokens: "Analysis token resolution (all computed statistical figures verified)",
        tokens_resolved: "Analysis token resolution (all computed statistical figures verified)",
        citation_matching: "Citation matching (all in-text citations appear in reference list)",
        citation_bidirectional: "Citation matching (all in-text citations appear in reference list)",
        keywords: "Keywords (3 to 6 index terms for medical databases)",
        keywords_count: "Keywords (3 to 6 index terms for medical databases)",
        required_sections: "Required sections (IMRaD and ethical declarations present)",
        declarations: "Declarations (ethics, funding, conflicts, data availability statements)",
        checklist_completion: "Reporting checklist completion (adherence to publication guideline)",
        reporting_checklist: "Reporting checklist completion (adherence to publication guideline)",
        reporting_checklist_completion: "Reporting checklist completion (adherence to publication guideline)"
      };

      function formatCheckLabel(checkKey) {
        if (FORMAT_CHECK_LABELS[checkKey]) return FORMAT_CHECK_LABELS[checkKey];
        var words = String(checkKey || "").replace(/[_-]+/g, " ");
        var cap = words.charAt(0).toUpperCase() + words.slice(1);
        return cap + " (journal requirement verification)";
      }

      var checks = (formatCheck && formatCheck.checks) || [];
      if (formatCheck && checks) {
        h += '<div class="rmd-card rmd-format-check-card" style="margin-top:14px;" data-rmd="format-check-card">';
        h += '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">';
        h += '<h3 style="margin:0;">Journal format check (is it ready for ' + esc(journalTitle(targetJournal)) + '?)</h3>';
        h += '<span class="rmd-badge rmd-badge-pill">' + checks.length + ' checks</span>';
        h += '</div>';
        h += '<p class="rmd-muted" style="margin:4px 0 0;font-size:13px;">Deterministic checks against author guidelines, limits, and declarations. No tokens spent.</p>';

        if (!checks.length) {
          h += '<p class="rmd-muted" style="margin-top:8px;">No checks returned for this journal.</p>';
        } else {
          h += '<ul class="rmd-format-check-list">';
          for (var c = 0; c < checks.length; c++) {
            var item = checks[c];
            var stVal = item.status || "warn";
            var iconSvg = "";
            if (stVal === "pass") {
              iconSvg = '<span class="rmd-format-check-icon rmd-format-check-icon-pass" aria-label="Pass"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#42CDB5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>';
            } else if (stVal === "fail") {
              iconSvg = '<span class="rmd-format-check-icon rmd-format-check-icon-fail" aria-label="Fail"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></span>';
            } else {
              iconSvg = '<span class="rmd-format-check-icon rmd-format-check-icon-warn" aria-label="Warning"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></span>';
            }
            h += '<li class="rmd-format-check-item">';
            h += '  <div class="rmd-format-check-left">';
            h += '    ' + iconSvg;
            h += '    <div class="rmd-format-check-text">';
            h += '      <span class="rmd-format-check-label">' + esc(item.label || formatCheckLabel(item.check)) + '</span>';
            h += '      <span class="rmd-format-check-detail">' + esc(item.detail || "") + '</span>';
            h += '    </div>';
            h += '  </div>';
            h += '  <div class="rmd-format-check-action">';
            h += '    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm rmd-format-fix-btn" data-rmd-fix-sec="' + esc(item.sectionId || item.section || '') + '" data-rmd-format-fix="' + esc(item.sectionId || item.section || '') + '" data-rmd-check="' + esc(item.check || '') + '">Fix</button>';
            h += '  </div>';
            h += '</li>';
          }
          h += '</ul>';
        }
        h += '</div>';
      }

      /* Submission & Publication milestone card (real projects & tutorials) */
      var pubRec = (SMD.tutorial && SMD.tutorial.getPubStatus) ? SMD.tutorial.getPubStatus(proj.id) : null;
      var pubStage = (pubRec && pubRec.status) || "draft";
      var selJournal = (pubRec && pubRec.journal) || journalTitle(targetJournal);
      h += '<div class="rmd-card rmd-pub-card" data-rmd="submission-tracker">';
      h += '  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">';
      h += '    <h3 style="margin:0;">Submission &amp; Publication</h3>';
      h += '    <span class="rmd-badge ' + (pubStage === "published" ? "rmd-badge-soft" : "rmd-badge-pill") + '">' + (pubStage === "published" ? "Published" : (pubStage === "submitted" ? "Submitted · Under Review" : "Ready to Submit")) + '</span>';
      h += '  </div>';
      if (pubStage === "published") {
        h += '  <div class="rmd-banner rmd-banner-info" style="margin-top:10px;" role="status"><strong>Published in ' + esc(selJournal) + '!</strong> DOI: ' + esc(pubRec.doi || "10.1000/rmd.2026") + '</div>';
        h += '  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">';
        h += '    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="celebrate-again">View Publication Celebration</button>';
        h += '    <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="to-start-own">Start my own real paper</button>';
        h += '  </div>';
      } else if (pubStage === "submitted") {
        h += '  <p class="rmd-muted" style="margin-top:8px;">Submitted to <strong>' + esc(selJournal) + '</strong> (Ref: ' + esc(pubRec.subId || "MS-2026-RMD") + '). Waiting for peer review decision.</p>';
        h += '  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">';
        h += '    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="publish-paper">' + (proj.tutorial ? "Simulate Peer Review Acceptance &amp; Publish" : "Record Acceptance &amp; Celebrate Publication") + '</button>';
        h += '  </div>';
      } else {
        h += '  <p class="rmd-muted" style="margin-top:6px;">Confirm your target journal and submit your verified manuscript pack.</p>';
        h += '  <div class="rmd-field" style="margin-top:8px;">';
        h += '    <label for="rmd_sub_journal">Target Journal</label>';
        h += '    <select id="rmd_sub_journal">';
        var jOpts = ["JAMA", "The Lancet", "BMJ", "NEJM", "PLOS ONE", "Indian Journal of Medical Research"];
        for (var ji = 0; ji < jOpts.length; ji++) {
          h += '<option value="' + esc(jOpts[ji]) + '"' + (selJournal === jOpts[ji] ? ' selected' : '') + '>' + esc(jOpts[ji]) + '</option>';
        }
        h += '    </select>';
        h += '  </div>';
        h += '  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
        h += '    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="submit-paper"' + (!allDone ? ' disabled' : '') + '>Confirm &amp; Submit Paper</button>';
        if (!allDone) h += '<span class="rmd-field-hint" style="margin:0;">Complete approval and checklist items above to unlock submit.</span>';
        h += '  </div>';
      }
      h += '</div>';

      h += '</div>';
      container.innerHTML = h;
      var btn = container.querySelector("[data-rmd-ready]");
      if (btn) {
        btn.onclick = function () { navigate(this.getAttribute("data-rmd-ready"), {}); };
      }
      var subBtn = container.querySelector('[data-rmd="submit-paper"]');
      if (subBtn) {
        subBtn.onclick = function () {
          var jEl = container.querySelector("#rmd_sub_journal");
          var jName = (jEl && jEl.value) || selJournal || "JAMA";
          var rec = {
            status: "submitted",
            journal: jName,
            subId: "MS-2026-" + String(Date.now()).slice(-5),
            submittedAt: Date.now()
          };
          if (SMD.tutorial && SMD.tutorial.setPubStatus) SMD.tutorial.setPubStatus(proj.id, rec);
          renderReady(container);
        };
      }
      var pubBtn = container.querySelector('[data-rmd="publish-paper"]');
      if (pubBtn) {
        pubBtn.onclick = function () {
          var curRec = (SMD.tutorial && SMD.tutorial.getPubStatus && SMD.tutorial.getPubStatus(proj.id)) || {};
          var keySlug = proj.tutorialKey || studyKey(proj) || "study";
          var nextRec = {
            status: "published",
            journal: curRec.journal || selJournal || "JAMA",
            subId: curRec.subId || ("MS-2026-" + String(Date.now()).slice(-5)),
            submittedAt: curRec.submittedAt || Date.now(),
            publishedAt: Date.now(),
            doi: "10.1000/rmd." + keySlug + ".2026"
          };
          if (SMD.tutorial && SMD.tutorial.setPubStatus) SMD.tutorial.setPubStatus(proj.id, nextRec);
          renderReady(container);
          if (SMD.tutorial && SMD.tutorial.showCelebration) SMD.tutorial.showCelebration(proj, nextRec);
        };
      }
      var celeBtn = container.querySelector('[data-rmd="celebrate-again"]');
      if (celeBtn) {
        celeBtn.onclick = function () {
          if (SMD.tutorial && SMD.tutorial.showCelebration) SMD.tutorial.showCelebration(proj, pubRec);
        };
      }
      var ownBtn = container.querySelector('[data-rmd="to-start-own"]');
      if (ownBtn) {
        ownBtn.onclick = function () {
          navigate("start", { studyKey: proj.tutorialKey || "" });
        };
      }
      var fixBtns = container.querySelectorAll("[data-rmd-format-fix]");
      for (var fb = 0; fb < fixBtns.length; fb++) {
        fixBtns[fb].onclick = function () {
          var sec = this.getAttribute("data-rmd-format-fix");
          var chk = this.getAttribute("data-rmd-check");
          if (sec === "checklist" || chk === "checklist_completion") {
            navigate("checklist", {});
          } else if (sec === "prisma") {
            navigate("prisma", {});
          } else if (chk === "tables_figures") {
            var activeP = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
            var sKey = studyKey(activeP);
            if (sKey === "rct") {
              navigate("consort", {});
            } else if (!sKey && ((activeP && activeP.studyType) || "").toLowerCase().indexOf("master") < 0 && ((activeP && activeP.studyType) || "").toLowerCase().indexOf("thesis") < 0) {
              navigate("prisma", {});
            } else {
              navigate("manuscript", {});
            }
          } else {
            var targetSec = sec || (chk === "abstract_word_count" || chk === "abstract_structure" ? "abstract" : (chk === "run_tokens" ? "results" : "introduction"));
            navigate("manuscript", { sectionId: targetSec });
          }
        };
      }
    }).catch(function (err) {
      container.innerHTML = '<div class="rmd-p2-screen">' + errHtml(err) + '</div>';
    });
  }

  SMD.screens = SMD.screens || {};
  SMD.screens.ready = { render: renderReady };

  function navigate(screenName, params, isBack) {
    if (screenName === "projects") {
      navStack = [];
      moreOpen = false;
    } else if (!isBack && currentScreen && currentScreen !== screenName) {
      navStack.push({ screen: currentScreen, params: {} });
    }
    currentScreen = screenName;
    if (ADVANCED_SCREENS[screenName]) moreOpen = true;
    renderShell();

    var body = root.querySelector("#rmdScreenBody");
    if (!body) return;

    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    renderHelp(screenName, proj);
    if (SERVER_SCREENS[screenName] && localOnly(proj)) {
      body.innerHTML = practiceCardHtml(proj);
      return;
    }

    var screen = SMD.screens && SMD.screens[screenName];
    if (screen && screen.render) {
      screen.render(body, params);
    } else if (SMD.screens && SMD.screens.projects) {
      SMD.screens.projects.render(body, params);
    }
    if (SMD.tutorial && SMD.tutorial.renderBar) {
      SMD.tutorial.renderBar(root, screenName, proj);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape" || e.keyCode === 27) {
      if (root && root.querySelector("dialog[open], .rmd-modal-backdrop")) return;
      close();
    }
  }

  var isDraining = false;
  function drainQueue() {
    if (isDraining) return Promise.resolve(0);
    var store = SMD.store;
    if (!store) return Promise.resolve(0);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return Promise.resolve(0);
    }
    var queue = store.cleanQueue ? store.cleanQueue() : store.getQueue();
    if (!queue || !queue.length) {
      if (store.setSyncState && store.getState().syncState !== "conflict") {
        store.setSyncState("synced");
      }
      return Promise.resolve(0);
    }
    if (!SMD.api || !SMD.api.request) {
      return Promise.resolve(0);
    }

    lastSendAttempt = Date.now();
    isDraining = true;
    var drainedCount = 0;

    function processNext(index) {
      if (index >= queue.length) {
        isDraining = false;
        var remaining = store.getQueue();
        if (remaining.length === 0 && store.getState().syncState !== "conflict") {
          store.setSyncState("synced");
        }
        updateSyncBadge();
        if (root && root.querySelector("#rmdSyncSheetModal")) refreshSyncSheet();
        return Promise.resolve(drainedCount);
      }

      var item = queue[index];
      if (!item || !item.type) {
        if (item && item.id) store.removeQueueItem(item.id);
        return processNext(index + 1);
      }

      var sendPromise;
      if (item.type === "project_create") {
        sendPromise = SMD.api.request("POST", "/v1/projects", item.payload);
      } else if (item.type === "study_create") {
        var pid = item.payload && (item.payload.projectId || item.payload.pid);
        if (!pid || pid === "prj_bcg_1994") {
          store.removeQueueItem(item.id);
          return processNext(index + 1);
        }
        sendPromise = SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(pid) + "/studies", {
          label: item.payload.label || "",
          measure: item.payload.measure,
          inputs: item.payload.inputs,
          locator: item.payload.locator,
          quote: item.payload.quote || "",
          verified: !!item.payload.verified
        });
      } else if (item.type === "study_update" || item.type === "study_update_forced") {
        var spid = item.payload && (item.payload.projectId || item.payload.pid);
        var sid = item.payload && item.payload.id;
        if (!spid || !sid || spid === "prj_bcg_1994") {
          store.removeQueueItem(item.id);
          return processNext(index + 1);
        }
        sendPromise = SMD.api.request("PUT", "/v1/projects/" + encodeURIComponent(spid) + "/studies/" + encodeURIComponent(sid), item.payload);
      } else if (item.type === "run_create") {
        var rpid = item.payload && (item.payload.projectId || item.payload.pid);
        if (!rpid || rpid === "prj_bcg_1994") {
          store.removeQueueItem(item.id);
          return processNext(index + 1);
        }
        sendPromise = SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(rpid) + "/runs", item.payload);
      } else {
        store.removeQueueItem(item.id);
        return processNext(index + 1);
      }

      return sendPromise.then(function () {
        store.removeQueueItem(item.id);
        delete failedItemMap[item.id];
        drainedCount++;
        return processNext(index + 1);
      }).catch(function (err) {
        var st = (err && err.status) || 0;
        if (!st && err && err.code && String(err.code).indexOf("http_") === 0) {
          st = parseInt(String(err.code).slice(5), 10) || 0;
        }
        // Drop items that fail with 4xx client errors (report them once)
        if (st >= 400 && st < 500) {
          console.warn("Dropping queued item after 4xx client rejection:", item.type, st);
          store.removeQueueItem(item.id);
          delete failedItemMap[item.id];
          return processNext(index + 1);
        }
        // Network or 5xx error: record error on item and stop drain for now
        var errMsg = (err && (err.message || err.code || (st ? "Server error " + st : ""))) || "Could not send";
        item.error = errMsg;
        failedItemMap[item.id] = errMsg;
        isDraining = false;
        updateSyncBadge();
        if (root && root.querySelector("#rmdSyncSheetModal")) refreshSyncSheet();
        return drainedCount;
      });
    }

    return processNext(0).catch(function () {
      isDraining = false;
      updateSyncBadge();
      if (root && root.querySelector("#rmdSyncSheetModal")) refreshSyncSheet();
      return drainedCount;
    });
  }

  SMD.drainQueue = drainQueue;
  if (SMD.store) SMD.store.drainQueue = drainQueue;

  if (typeof G !== "undefined" && G.addEventListener) {
    G.addEventListener("online", function () {
      drainQueue();
    });
  }

  var storeUnsub = null;

  function open(opts) {
    injectCSS();
    if (SMD.store) SMD.store.init();
    drainQueue();
    if (G.RMDStore && G.RMDStore.available) {
      G.RMDStore.available().then(function () {}, function () {});
    }

    if (opts && opts.projectId && SMD.store) {
      SMD.store.setActiveProject(opts.projectId);
      var actProj = SMD.store.getActiveProject ? SMD.store.getActiveProject() : SMD.store.getProject(opts.projectId);
      currentScreen = journeyFor(actProj)[0] || "studies";
    } else if (opts && opts.screen) {
      currentScreen = opts.screen;
    } else {
      var curProj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
      currentScreen = curProj ? (journeyFor(curProj)[0] || "studies") : "projects";
    }
    navStack = [];

    renderShell();
    if (root) {
      root.removeAttribute("hidden");
    }
    if (D.body) {
      D.body.classList.add("smd-research-open");
    }

    navigate(currentScreen, opts || {});
    if (D) D.addEventListener("keydown", onKeyDown);

    // Subscribe to store updates to keep sync badge and screen updated
    if (SMD.store && SMD.store.subscribe) {
      if (typeof storeUnsub === "function") storeUnsub();
      storeUnsub = SMD.store.subscribe(function (state) {
        var badge = root ? root.querySelector("#rmdSyncBadge") : null;
        var q = state.offlineQueue || [];
        if (badge && badge.parentNode) {
          badge.outerHTML = getSyncBadgeHtml(state.syncState, q.length, q);
          bindSyncBadgeEvent();
        }
        scheduleSyncCheck(q);
        if (root && root.querySelector("#rmdSyncSheetModal")) {
          refreshSyncSheet();
        }
        if (currentScreen === "studies" && root) {
          var body = root.querySelector("#rmdScreenBody");
          if (body && SMD.screens && SMD.screens.studies) {
            SMD.screens.studies.render(body);
          }
        }
      });
    }
  }

  function close() {
    if (root) {
      root.setAttribute("hidden", "true");
    }
    if (D.body) {
      D.body.classList.remove("smd-research-open");
    }
    if (D) D.removeEventListener("keydown", onKeyDown);
  }

  var SHELL = {
    version: "rmd1",
    on: on,
    open: open,
    close: close,
    navigate: navigate,
    refreshScreen: function () { navigate(currentScreen, {}, true); },
    esc: esc,
    HELP: HELP,
    STEP_TIPS: STEP_TIPS,
    TAB_LABELS: TAB_LABELS,
    drainQueue: drainQueue,
    openSyncSheet: openSyncSheet,
    closeSyncSheet: closeSyncSheet,
    getSyncBadgeHtml: getSyncBadgeHtml,
    updateSyncBadge: updateSyncBadge
  };

  for (var k in SHELL) {
    SMD[k] = SHELL[k];
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SMD;
  }

})(typeof window !== "undefined" ? window : globalThis);
