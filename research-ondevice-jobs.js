/* ResearchMD Phase 04: On-device job runner with two retries + cloud fallback notice (ES5 IIFE).
 *
 * Every heavy job (kind: "pdf" | "stats" | "draft") runs on the device first.
 * Counted failures retry automatically on-device twice (waiting 3 s between
 * tries) with the latest SMD_RMD_CHECKPOINT. After the third counted failure,
 * the job enters "needs_cloud" and shows a kind-specific privacy notice; only
 * after the user taps Continue (and GET /v1/me/research-cloud confirms
 * remaining > 0) does runCloud(checkpoint, meta) run.
 *
 * Kill switch: ON by default; off only if localStorage holds "0".
 */
(function (root) {
  "use strict";

  var KILL_FLAG_KEY = "smd_rmd_ondevice_fallback";

  /* Tunable foreground timeouts + retry pause (phase-1 device measurements tune these). */
  var TIMEOUTS = {
    pdfPageMs: 30 * 1000,
    pdfTotalMs: 10 * 60 * 1000,
    statsModelMs: 2 * 60 * 1000,
    draftStepMs: 5 * 60 * 1000,
    retryDelayMs: 3 * 1000
  };

  var DEVICE_PRIVACY_LINE =
    "Runs on this device. Your PDFs and patient data are read here and never uploaded. Works offline.";

  var NOTICES = {
    pdf:
      "This device couldn't finish reading this PDF. To finish it in StewardMD cloud, the PDF is uploaded to StewardMD's servers and read there. It is kept while the project exists and deleted within 30 days after you delete the project.",
    stats:
      "Privacy risk: this device couldn't run this analysis. Finishing it in StewardMD cloud uploads patient-level data to StewardMD's servers, where it is decrypted to run the analysis. Only the results are kept. Use this only if your ethics approval and patient consent allow data to leave this device.",
    draft:
      "Writing help sends your project text to StewardMD's AI service over the internet. Patient identifiers are blocked before anything is sent. Your PDFs and patient datasets stay on this device.",
    limitReached:
      "You've used this month's cloud fallbacks. The job stays on this device, saved where it stopped. Try again later or next month.",
    freePlan:
      "Cloud fallback comes with the paid plans. The job stays on this device, saved where it stopped."
  };

  var DATA_PROBLEM_CODES = {
    password: true,
    "too-many-pages": true,
    too_many_pages: true,
    invalid_formula: true,
    zero_cell: true,
    no_events: true,
    convergence_warning: true,
    logistic_not_converged: true,
    cox_not_converged: true,
    not_converged: true,
    convergence: true,
    invalid_spec: true,
    ipd_gate: true,
    gate_failed: true,
    phi_blocked: true,
    ceiling_calls: true,
    invalid_snapshot: true,
    dataset_invalid: true,
    too_few_rows: true,
    outcome_not_binary: true,
    outcome_constant: true,
    ceiling_rows: true,
    ceiling_pages: true,
    ceiling_bytes: true,
    ceiling_input_tokens: true,
    ceiling_output_tokens: true,
    ceiling_refinement_rounds: true,
    invalid_body: true,
    file_type: true,
    no_saved_run: true,
    protocol_not_locked: true
  };

  var COUNTED_ERROR_CODES = {
    "ocr-failed": "ocr-failed",
    ocr_failed: "ocr-failed",
    "pdf-open-failed": "pdf-open-failed",
    pdf_open_failed: "pdf-open-failed",
    ceiling_seconds: "ceiling_seconds",
    stats_failed: "stats_worker_crash",
    stats_worker_crash: "stats_worker_crash",
    worker_crash: "stats_worker_crash",
    device_failed: "device_failed",
    "ocr-unavailable": "ocr-unavailable",
    ocr_unavailable: "ocr-unavailable",
    stats_unavailable: "stats_unavailable",
    worker_unavailable: "worker_construct_failed",
    worker_construct_failed: "worker_construct_failed",
    crash_or_oom: "crash_or_oom"
  };

  var _customClock = null;
  function getClock(opts) {
    if (opts && opts.clock) return opts.clock;
    if (_customClock) return _customClock;
    return {
      now: function () { return Date.now(); },
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimeout: function (id) { return clearTimeout(id); }
    };
  }

  function isEnabled() {
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(KILL_FLAG_KEY) !== "0";
      }
    } catch (e) {}
    return true;
  }

  function cloneShallow(obj) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    }
    return out;
  }

  function getCheckpointStore(opts) {
    if (opts && opts.checkpointStore) return opts.checkpointStore;
    if (root && root.SMD_RMD_CHECKPOINT) return root.SMD_RMD_CHECKPOINT;
    return null;
  }

  function makeAbortSignal() {
    var listeners = [];
    var sig = {
      aborted: false,
      reason: null,
      addEventListener: function (ev, fn) {
        if (ev === "abort" && typeof fn === "function") listeners.push(fn);
      },
      removeEventListener: function (ev, fn) {
        if (ev !== "abort") return;
        for (var i = listeners.length - 1; i >= 0; i--) {
          if (listeners[i] === fn) listeners.splice(i, 1);
        }
      },
      _trigger: function (reason) {
        if (sig.aborted) return;
        sig.aborted = true;
        sig.reason = reason;
        var list = listeners.slice();
        for (var i = 0; i < list.length; i++) {
          try { list[i](reason); } catch (e) {}
        }
      }
    };
    return sig;
  }

  function defaultIsOnline(opts) {
    if (opts && typeof opts.isOnline === "function") return !!opts.isOnline();
    if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return false;
    return true;
  }

  function defaultIsForeground(opts) {
    if (opts && typeof opts.isForeground === "function") return !!opts.isForeground();
    if (typeof document !== "undefined" && document && document.hidden === true) return false;
    return true;
  }

  function classifyError(err, opts) {
    var code = (err && (err.code || err.name)) ? String(err.code || err.name).trim() : "";
    var lowerCode = code.toLowerCase();
    var msg = err && err.message ? String(err.message) : String(err || "");
    var lowerMsg = msg.toLowerCase();

    if (err && err.rule && COUNTED_ERROR_CODES[lowerCode]) {
      return { kind: "counted", counted: true, code: lowerCode, rule: String(err.rule) };
    }
    if (lowerCode === "aborted" || lowerCode === "cancelled" || lowerCode === "user_cancelled" || lowerCode === "aborterror") {
      return { kind: "cancel", counted: false, code: lowerCode };
    }
    if (lowerCode === "offline" || lowerCode === "network_error") {
      return { kind: "offline", counted: false, code: lowerCode };
    }
    if (!defaultIsOnline(opts) && (lowerMsg.indexOf("fetch") >= 0 || lowerMsg.indexOf("network") >= 0 || lowerMsg.indexOf("offline") >= 0 || err instanceof TypeError)) {
      return { kind: "offline", counted: false, code: "offline" };
    }
    if (lowerMsg.indexOf("failed to fetch") >= 0 || lowerMsg.indexOf("networkerror") >= 0 || lowerMsg.indexOf("network request failed") >= 0) {
      return { kind: "offline", counted: false, code: "network_error" };
    }
    if (DATA_PROBLEM_CODES[code] || DATA_PROBLEM_CODES[lowerCode]) {
      return { kind: "data_problem", counted: false, code: code || lowerCode };
    }
    if (lowerMsg.indexOf("convergence") >= 0 || lowerMsg.indexOf("did not converge") >= 0) {
      return { kind: "data_problem", counted: false, code: "convergence_warning" };
    }
    if (COUNTED_ERROR_CODES[code] || COUNTED_ERROR_CODES[lowerCode]) {
      return {
        kind: "counted",
        counted: true,
        code: code || lowerCode,
        rule: (err && err.rule) || COUNTED_ERROR_CODES[lowerCode] || COUNTED_ERROR_CODES[code]
      };
    }
    if (lowerMsg.indexOf("worker") >= 0 && (lowerMsg.indexOf("construct") >= 0 || lowerMsg.indexOf("init") >= 0 || lowerMsg.indexOf("load") >= 0 || lowerMsg.indexOf("unavailable") >= 0)) {
      return { kind: "counted", counted: true, code: "worker_construct_failed", rule: "worker_construct_failed" };
    }
    if (lowerMsg.indexOf("worker") >= 0 && (lowerMsg.indexOf("crash") >= 0 || lowerMsg.indexOf("terminated") >= 0 || lowerMsg.indexOf("died") >= 0)) {
      return { kind: "counted", counted: true, code: "stats_worker_crash", rule: "stats_worker_crash" };
    }
    if (lowerMsg.indexOf("out of memory") >= 0 || lowerMsg.indexOf("oom") >= 0) {
      return { kind: "counted", counted: true, code: "crash_or_oom", rule: "crash_or_oom" };
    }
    /* Unexpected local execution failures are counted so retries + notice work cleanly. */
    return { kind: "counted", counted: true, code: lowerCode || "device_failed", rule: lowerCode || "device_failed" };
  }

  function getDeviceMeta(opts) {
    var base = {
      model: "unknown",
      platform: "unknown",
      operatingSystem: "unknown",
      osVersion: "unknown",
      manufacturer: "",
      appVersion: (opts && opts.appVersion) || (root && root.SMD_APP_VERSION) || "1.0"
    };
    if (opts && opts.getDeviceInfo) {
      return Promise.resolve().then(function () { return opts.getDeviceInfo(); }).then(function (info) {
        if (info && typeof info === "object") {
          for (var k in info) {
            if (Object.prototype.hasOwnProperty.call(info, k) && info[k] != null) base[k] = info[k];
          }
        }
        return base;
      }).catch(function () { return base; });
    }
    var plugins = root && root.Capacitor && root.Capacitor.Plugins;
    var Dev = plugins && plugins.Device;
    var App = plugins && plugins.App;
    var p = (Dev && typeof Dev.getInfo === "function")
      ? Dev.getInfo().then(function (d) {
          if (d) {
            base.model = d.model || base.model;
            base.platform = d.platform || base.platform;
            base.operatingSystem = d.operatingSystem || d.platform || base.operatingSystem;
            base.osVersion = d.osVersion || base.osVersion;
            base.manufacturer = d.manufacturer || base.manufacturer;
          }
        }).catch(function () {})
      : Promise.resolve();
    return p.then(function () {
      if (App && typeof App.getInfo === "function") {
        return App.getInfo().then(function (a) {
          if (a && a.version) base.appVersion = String(a.version);
          return base;
        }).catch(function () { return base; });
      }
      return base;
    });
  }

  function defaultCheckQuota(opts) {
    if (opts && typeof opts.checkQuota === "function") {
      return Promise.resolve().then(function () { return opts.checkQuota(); });
    }
    if (root && root.SMD && root.SMD.api && typeof root.SMD.api.request === "function") {
      return root.SMD.api.request("GET", "/v1/me/research-cloud");
    }
    return Promise.resolve({ plan: "free", allowance: 0, used: 0, remaining: 0 });
  }

  function quotaErrorResult(quota, checkpoint) {
    var isFree = !quota || Number(quota.allowance || 0) === 0 || quota.plan === "free";
    return {
      ok: false,
      state: isFree ? "cloud_fallback_free" : "cloud_fallback_limit",
      code: isFree ? "cloud_fallback_free" : "cloud_fallback_limit",
      message: isFree ? NOTICES.freePlan : NOTICES.limitReached,
      quota: quota || null,
      checkpoint: checkpoint || null
    };
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Shared UI prompt used when caller does not supply opts.onNeedsCloud. */
  function defaultNeedsCloudPrompt(info) {
    if (typeof document === "undefined" || !document.body) {
      return Promise.resolve({ action: "cancel" });
    }
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.className = "rmd-cloud-notice-backdrop";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.6);" +
        "display:flex;align-items:center;justify-content:center;padding:16px;";

      var card = document.createElement("div");
      card.style.cssText =
        "max-width:460px;width:100%;background:var(--bg-card,#ffffff);color:var(--text,#0f172a);" +
        "border-radius:14px;padding:18px;box-shadow:0 16px 40px rgba(0,0,0,0.25);font-size:14px;line-height:1.5;";

      var disabledContinue = info.kind === "stats" && !info.hasEthicsApproval;
      var html =
        "<h3 style='margin:0 0 8px 0;font-size:16px;font-weight:700;'>" +
        (info.kind === "stats" ? "Privacy notice" : "Continue in StewardMD cloud?") +
        "</h3>" +
        "<p style='margin:0 0 12px 0;'>" + escapeHtml(info.notice) + "</p>";

      if (disabledContinue) {
        html += "<p style='margin:0 0 12px 0;font-size:12px;color:var(--amber,#b45309);'>" +
          "Ethics approval and IPD compliance must be on file for this project before patient-level data can leave this device.</p>";
      }
      html += "<div class='rmd-cloud-notice-err' style='display:none;margin:0 0 12px 0;font-size:13px;color:var(--red,#b91c1c);'></div>";
      html += "<div style='display:flex;gap:8px;justify-content:flex-end;'>" +
        "<button type='button' class='rmd-cn-cancel' style='padding:8px 14px;border-radius:8px;border:1px solid #cbd5e1;background:transparent;color:inherit;cursor:pointer;'>Cancel</button>" +
        "<button type='button' class='rmd-cn-continue'" + (disabledContinue ? " disabled" : "") +
        " style='padding:8px 14px;border-radius:8px;border:none;background:#0f766e;color:#ffffff;font-weight:600;cursor:pointer;" +
        (disabledContinue ? "opacity:0.45;cursor:not-allowed;" : "") + "'>Continue</button>" +
        "</div>";

      card.innerHTML = html;
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      var cancelBtn = card.querySelector(".rmd-cn-cancel");
      var contBtn = card.querySelector(".rmd-cn-continue");
      var errBox = card.querySelector(".rmd-cloud-notice-err");
      var done = false;

      function cleanup() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }

      cancelBtn.addEventListener("click", function () {
        if (done) return;
        done = true;
        cleanup();
        resolve({ action: "cancel" });
      });

      contBtn.addEventListener("click", function () {
        if (done || contBtn.disabled) return;
        contBtn.disabled = true;
        errBox.style.display = "none";
        Promise.resolve().then(info.checkQuota).then(function (quota) {
          if (quota && Number(quota.remaining || 0) <= 0) {
            var isFree = Number(quota.allowance || 0) === 0 || quota.plan === "free";
            errBox.textContent = isFree ? NOTICES.freePlan : NOTICES.limitReached;
            errBox.style.display = "block";
            done = true;
            cancelBtn.textContent = "Try again";
            cancelBtn.onclick = function () { cleanup(); };
            resolve({ action: "quota_blocked", quota: quota });
            return;
          }
          done = true;
          cleanup();
          resolve({ action: "continue", quota: quota });
        }).catch(function (qErr) {
          contBtn.disabled = false;
          errBox.textContent = (qErr && qErr.message) || "Could not check monthly allowance.";
          errBox.style.display = "block";
        });
      });
    });
  }

  function sleepWithClock(clock, ms, isCancelledFn, registerWaitAbort) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var timer = null;
      function cancelWait() {
        if (timer != null) { clock.clearTimeout(timer); timer = null; }
        var e = new Error("User cancelled");
        e.code = "cancelled";
        reject(e);
      }
      if (isCancelledFn && isCancelledFn()) { cancelWait(); return; }
      if (registerWaitAbort) registerWaitAbort(cancelWait);
      timer = clock.setTimeout(function () {
        timer = null;
        resolve();
      }, ms);
    });
  }

  function makeForegroundController(kind, clock, opts, onTimeout) {
    var fgActive = defaultIsForeground(opts);
    var aiWaitDepth = 0;
    var lastTickAt = clock.now();
    var totalFgMs = 0;
    var pageFgMs = 0;
    var stepFgMs = 0;
    var timerId = null;
    var disposed = false;
    var pauseListeners = [];
    var unsubs = [];
    /* Held while a native background job reports that the OS has paused it:
     * that time is not the device being slow, so it must not count. */
    var held = false;

    function flush() {
      var now = clock.now();
      var delta = Math.max(0, now - lastTickAt);
      lastTickAt = now;
      if (!fgActive || held) return;
      totalFgMs += delta;
      pageFgMs += delta;
      if (kind !== "draft" || aiWaitDepth === 0) {
        stepFgMs += delta;
      }
    }

    function clearTimer() {
      if (timerId != null) {
        clock.clearTimeout(timerId);
        timerId = null;
      }
    }

    function checkBreach() {
      if (kind === "pdf") {
        if (pageFgMs > TIMEOUTS.pdfPageMs) return "timeout_pdf_page";
        if (totalFgMs > TIMEOUTS.pdfTotalMs) return "timeout_pdf_total";
      } else if (kind === "stats") {
        if (totalFgMs > TIMEOUTS.statsModelMs) return "timeout_stats_model";
      } else if (kind === "draft") {
        if (stepFgMs > TIMEOUTS.draftStepMs) return "timeout_draft_step";
      }
      return null;
    }

    function schedule() {
      clearTimer();
      if (disposed || !fgActive || held) return;
      var breach = checkBreach();
      if (breach) {
        disposed = true;
        onTimeout(breach);
        return;
      }
      var nextWait = null;
      var rule = null;
      if (kind === "pdf") {
        var remPage = TIMEOUTS.pdfPageMs - pageFgMs;
        var remTot = TIMEOUTS.pdfTotalMs - totalFgMs;
        if (remPage <= remTot) { nextWait = remPage; rule = "timeout_pdf_page"; }
        else { nextWait = remTot; rule = "timeout_pdf_total"; }
      } else if (kind === "stats") {
        nextWait = TIMEOUTS.statsModelMs - totalFgMs;
        rule = "timeout_stats_model";
      } else if (kind === "draft" && aiWaitDepth === 0) {
        nextWait = TIMEOUTS.draftStepMs - stepFgMs;
        rule = "timeout_draft_step";
      }
      if (nextWait != null) {
        var capturedRule = rule;
        timerId = clock.setTimeout(function () {
          timerId = null;
          flush();
          var b = checkBreach();
          if (b || capturedRule) {
            disposed = true;
            onTimeout(b || capturedRule);
          }
        }, Math.max(1, nextWait + 1));
      }
    }

    function setForeground(active) {
      var next = !!active;
      if (next === fgActive || disposed) return;
      flush();
      fgActive = next;
      lastTickAt = clock.now();
      if (fgActive) {
        if (opts && typeof opts.onResume === "function") {
          try { opts.onResume(); } catch (e) {}
        }
        var copy = pauseListeners.slice();
        pauseListeners = [];
        for (var i = 0; i < copy.length; i++) {
          try { copy[i](); } catch (e) {}
        }
        schedule();
      } else {
        clearTimer();
        if (opts && typeof opts.onPause === "function") {
          try { opts.onPause(); } catch (e) {}
        }
      }
    }

    /* Wire Capacitor App appStateChange + document visibilitychange */
    try {
      var AppPlugin = (opts && opts.appPlugin) ||
        (root && root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.App);
      if (AppPlugin && typeof AppPlugin.addListener === "function") {
        var handle = AppPlugin.addListener("appStateChange", function (state) {
          setForeground(!!(state && state.isActive));
        });
        unsubs.push(function () {
          try {
            if (handle && typeof handle.remove === "function") handle.remove();
            else if (handle && typeof handle.then === "function") {
              handle.then(function (h) { if (h && h.remove) h.remove(); }).catch(function () {});
            }
          } catch (e) {}
        });
      }
    } catch (e) {}

    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      var visFn = function () { setForeground(!document.hidden); };
      document.addEventListener("visibilitychange", visFn);
      unsubs.push(function () { document.removeEventListener("visibilitychange", visFn); });
    }

    schedule();

    return {
      touchPage: function () {
        flush();
        pageFgMs = 0;
        schedule();
      },
      touchStep: function () {
        flush();
        stepFgMs = 0;
        schedule();
      },
      beginAiWait: function () {
        flush();
        aiWaitDepth += 1;
        schedule();
      },
      endAiWait: function () {
        flush();
        if (aiWaitDepth > 0) aiWaitDepth -= 1;
        lastTickAt = clock.now();
        schedule();
      },
      setForeground: setForeground,
      holdClock: function (on) {
        var next = !!on;
        if (next === held || disposed) return;
        flush();
        held = next;
        lastTickAt = clock.now();
        if (held) clearTimer();
        else schedule();
      },
      isPaused: function () { return !fgActive; },
      waitIfPaused: function () {
        if (fgActive) return Promise.resolve();
        return new Promise(function (resolve) { pauseListeners.push(resolve); });
      },
      dispose: function () {
        disposed = true;
        clearTimer();
        for (var i = 0; i < unsubs.length; i++) {
          try { unsubs[i](); } catch (e) {}
        }
        unsubs = [];
        pauseListeners = [];
      }
    };
  }

  function emitStatus(opts, statusObj) {
    if (opts && typeof opts.onStatus === "function") {
      try { opts.onStatus(statusObj); } catch (e) {}
    }
  }

  function updateCheckpoint(cp, jobKey, patch) {
    if (!cp || !jobKey || typeof cp.get !== "function" || typeof cp.put !== "function") {
      return Promise.resolve(patch);
    }
    return Promise.resolve().then(function () { return cp.get(jobKey); }).then(function (cur) {
      var next = cloneShallow(cur);
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
      }
      next.jobKey = jobKey;
      return Promise.resolve(cp.put(jobKey, next)).then(function () { return next; });
    }).catch(function () { return patch; });
  }

  function runWithFallback(kind, runDevice, runCloud, opts) {
    opts = opts || {};
    var cp = getCheckpointStore(opts);
    var jobKey = opts.jobKey || ("rmd:" + kind + ":" + (opts.projectId || "local") + ":" + (opts.targetId || "job"));
    var clock = getClock(opts);
    var engineName = opts.engine || ("ondevice:" + kind);

    if (!isEnabled()) {
      return Promise.resolve().then(function () {
        return runDevice({
          jobKey: jobKey,
          checkpoint: null,
          resume: !!opts.resume,
          tryNumber: 1,
          signal: makeAbortSignal(),
          touchPage: function () {},
          holdClock: function () {},
          touchStep: function () {},
          beginAiWait: function () {},
          endAiWait: function () {},
          isPaused: function () { return false; },
          waitIfPaused: function () { return Promise.resolve(); }
        });
      }).then(function (res) {
        return { ok: true, source: "device", state: "succeeded", result: res };
      });
    }

    var userCancelled = false;
    var activeSig = null;
    var cancelSleepFn = null;

    function triggerUserCancel() {
      userCancelled = true;
      var cancelErr = new Error("Cancelled");
      cancelErr.code = "cancelled";
      if (activeSig) activeSig._trigger(cancelErr);
      if (cancelSleepFn) cancelSleepFn();
    }

    emitStatus(opts, {
      state: "running",
      kind: kind,
      tryNumber: 1,
      privacyLine: DEVICE_PRIVACY_LINE,
      message: DEVICE_PRIVACY_LINE
    });

    function readLatestCheckpoint() {
      if (!cp || typeof cp.get !== "function") return Promise.resolve(null);
      return Promise.resolve().then(function () { return cp.get(jobKey); }).catch(function () { return null; });
    }

    return readLatestCheckpoint().then(function (initialCp) {
      var priorFailCount = 0;
      var reasons = [];

      if (initialCp && Array.isArray(initialCp.reasons)) {
        reasons = initialCp.reasons.slice();
      }
      /* Crash/OOM detection: running:true for an unfinished job counts as a failed try. */
      if (initialCp && initialCp.running === true && !initialCp.finished) {
        priorFailCount = Math.max(Number(initialCp.failCount || 0), 0) + 1;
        reasons.push({
          try: priorFailCount,
          rule: "crash_or_oom",
          code: "crash_or_oom",
          detail: "Previous run terminated unexpectedly"
        });
      } else if (initialCp && typeof initialCp.failCount === "number" && initialCp.failCount > 0 && !initialCp.finished) {
        priorFailCount = initialCp.failCount;
      }

      function proceedToCloud(latestCp) {
        var ethicsP = typeof opts.hasEthicsApproval === "function"
          ? Promise.resolve().then(function () { return opts.hasEthicsApproval(); }).then(function (v) { return !!v; }, function () { return false; })
          : Promise.resolve(!!opts.hasEthicsApproval);

        return ethicsP.then(function (ethicsOk) {
          emitStatus(opts, {
            state: "needs_cloud",
            kind: kind,
            notice: NOTICES[kind] || NOTICES.pdf,
            reasons: reasons.slice(),
            hasEthicsApproval: ethicsOk,
            privacyLine: DEVICE_PRIVACY_LINE
          });

          var checkQuotaFn = function () { return defaultCheckQuota(opts); };

          var decideP;
          if (typeof opts.onNeedsCloud === "function") {
            decideP = Promise.resolve().then(function () {
              return opts.onNeedsCloud({
                state: "needs_cloud",
                kind: kind,
                notice: NOTICES[kind] || NOTICES.pdf,
                reasons: reasons.slice(),
                hasEthicsApproval: ethicsOk,
                checkpoint: latestCp,
                checkQuota: checkQuotaFn
              });
            });
          } else {
            decideP = defaultNeedsCloudPrompt({
              kind: kind,
              notice: NOTICES[kind] || NOTICES.pdf,
              reasons: reasons.slice(),
              hasEthicsApproval: ethicsOk,
              checkpoint: latestCp,
              checkQuota: checkQuotaFn
            });
          }

          return decideP.then(function (decision) {
            var action = decision && decision.action;
            if (!action || action === "cancel") {
              return updateCheckpoint(cp, jobKey, { running: false, finished: false, failCount: 0, reasons: [] }).then(function (savedCp) {
                emitStatus(opts, {
                  state: "cancelled_to_device",
                  kind: kind,
                  message: "Saved on this device. Try again later.",
                  tryAgain: true
                });
                return {
                  ok: false,
                  state: "cancelled_to_device",
                  tryAgain: true,
                  checkpoint: savedCp,
                  reasons: reasons.slice()
                };
              });
            }
            if (action === "quota_blocked") {
              var resBlocked = quotaErrorResult(decision.quota, latestCp);
              emitStatus(opts, resBlocked);
              return resBlocked;
            }

            /* Patient-level stats never leave the device without ethics approval,
             * so this gate comes before the quota call (no network needed). */
            if (kind === "stats" && !ethicsOk) {
              return {
                ok: false,
                state: "ipd_gate",
                code: "ipd_gate",
                message: NOTICES.stats,
                checkpoint: latestCp
              };
            }

            /* Action === "continue": check GET /v1/me/research-cloud first unless already checked by dialog. */
            var quotaP = (decision && decision.quota)
              ? Promise.resolve(decision.quota)
              : checkQuotaFn();

            return quotaP.then(function (quota) {
              if (quota && Number(quota.remaining || 0) <= 0) {
                var blocked = quotaErrorResult(quota, latestCp);
                emitStatus(opts, blocked);
                return blocked;
              }
              return Promise.all([readLatestCheckpoint(), getDeviceMeta(opts)]).then(function (pair) {
                var freshestCp = pair[0] || latestCp;
                var devMeta = pair[1];
                var fallbackMeta = {
                  kind: kind,
                  engine: engineName,
                  appVersion: devMeta.appVersion,
                  device: devMeta,
                  reasons: reasons.slice()
                };
                emitStatus(opts, { state: "cloud", kind: kind, meta: fallbackMeta });
                if (typeof runCloud !== "function") {
                  return {
                    ok: false,
                    state: "cloud_unavailable",
                    code: "cloud_unavailable",
                    message: "Cloud fallback is not available for this job.",
                    checkpoint: freshestCp,
                    meta: fallbackMeta
                  };
                }
                return Promise.resolve().then(function () {
                  return runCloud(freshestCp, fallbackMeta);
                }).then(function (cloudRes) {
                  return updateCheckpoint(cp, jobKey, { running: false, finished: true, failCount: 0, reasons: [] }).then(function (finalCp) {
                    return {
                      ok: true,
                      source: "cloud",
                      state: "succeeded",
                      result: cloudRes,
                      checkpoint: finalCp,
                      meta: fallbackMeta
                    };
                  });
                });
              });
            });
          });
        });
      }

      function runAttempt(tryNumber, isCrashRetryDelay) {
        if (userCancelled) {
          var ce = new Error("Cancelled");
          ce.code = "cancelled";
          return Promise.reject(ce);
        }
        var waitBeforeP = Promise.resolve();
        if (isCrashRetryDelay) {
          var retryIdxCrash = tryNumber - 1;
          var msgCrash = "Retrying on this device (" + retryIdxCrash + " of 2)";
          emitStatus(opts, {
            state: "retrying",
            kind: kind,
            retryNumber: retryIdxCrash,
            maxRetries: 2,
            message: msgCrash,
            privacyLine: DEVICE_PRIVACY_LINE
          });
          waitBeforeP = sleepWithClock(clock, opts.retryDelayMs != null ? opts.retryDelayMs : TIMEOUTS.retryDelayMs,
            function () { return userCancelled; },
            function (fn) { cancelSleepFn = fn; });
        }

        return waitBeforeP.then(function () {
          cancelSleepFn = null;
          return readLatestCheckpoint();
        }).then(function (latestCp) {
          return updateCheckpoint(cp, jobKey, {
            running: true,
            finished: false,
            failCount: priorFailCount,
            reasons: reasons
          }).then(function (startedCp) {
            var sig = makeAbortSignal();
            activeSig = sig;
            var timedOutErr = null;
            var fg = null;

            return new Promise(function (resolveAttempt, rejectAttempt) {
              var settled = false;
              function finishResolve(val) {
                if (settled) return;
                settled = true;
                if (fg) fg.dispose();
                resolveAttempt(val);
              }
              function finishReject(err) {
                if (settled) return;
                settled = true;
                if (fg) fg.dispose();
                rejectAttempt(err);
              }

              fg = makeForegroundController(kind, clock, opts, function (ruleName) {
                var e = new Error("Foreground time limit exceeded (" + ruleName + ")");
                e.code = "ceiling_seconds";
                e.rule = ruleName;
                timedOutErr = e;
                sig._trigger(e);
                finishReject(e);
              });

              if (typeof opts.onController === "function") {
                try { opts.onController(fg); } catch (e) {}
              }

              var resumeCtx = {
                jobKey: jobKey,
                checkpoint: startedCp || latestCp,
                resume: !!(opts.resume || tryNumber > 1 || (startedCp && !startedCp.finished)),
                tryNumber: tryNumber,
                signal: sig,
                touchPage: fg.touchPage,
                holdClock: fg.holdClock,
                touchStep: fg.touchStep,
                beginAiWait: fg.beginAiWait,
                endAiWait: fg.endAiWait,
                isPaused: fg.isPaused,
                waitIfPaused: fg.waitIfPaused,
                cancel: triggerUserCancel
              };

              Promise.resolve().then(function () {
                return runDevice(resumeCtx);
              }).then(function (res) {
                if (timedOutErr) return;
                finishResolve(res);
              }, function (err) {
                finishReject(timedOutErr || err);
              });
            });
          }).then(function (deviceRes) {
            return updateCheckpoint(cp, jobKey, {
              running: false,
              finished: true,
              failCount: 0,
              reasons: []
            }).then(function (finalCp) {
              emitStatus(opts, { state: "succeeded", source: "device", kind: kind });
              return {
                ok: true,
                source: "device",
                state: "succeeded",
                result: deviceRes,
                checkpoint: finalCp,
                attempts: tryNumber
              };
            });
          }, function (err) {
            var cls = classifyError(err, opts);
            if (!cls.counted) {
              return updateCheckpoint(cp, jobKey, {
                running: false,
                finished: false,
                failCount: priorFailCount,
                reasons: reasons
              }).then(function () {
                if (err && typeof err === "object") {
                  err.rmdState = cls.kind;
                  err.counted = false;
                }
                emitStatus(opts, {
                  state: cls.kind,
                  kind: kind,
                  code: cls.code,
                  message: (err && err.message) || cls.code,
                  privacyLine: DEVICE_PRIVACY_LINE
                });
                throw err;
              });
            }

            priorFailCount += 1;
            reasons.push({
              try: priorFailCount,
              rule: cls.rule,
              code: cls.code,
              detail: (err && err.message) ? String(err.message).slice(0, 120) : ""
            });

            return updateCheckpoint(cp, jobKey, {
              running: false,
              finished: false,
              failCount: priorFailCount,
              reasons: reasons
            }).then(function (savedCp) {
              if (priorFailCount < 3) {
                var retryNum = priorFailCount; /* 1 of 2, then 2 of 2 */
                var retryMsg = "Retrying on this device (" + retryNum + " of 2)";
                emitStatus(opts, {
                  state: "retrying",
                  kind: kind,
                  retryNumber: retryNum,
                  maxRetries: 2,
                  message: retryMsg,
                  privacyLine: DEVICE_PRIVACY_LINE
                });
                return sleepWithClock(
                  clock,
                  opts.retryDelayMs != null ? opts.retryDelayMs : TIMEOUTS.retryDelayMs,
                  function () { return userCancelled; },
                  function (fn) { cancelSleepFn = fn; }
                ).then(function () {
                  cancelSleepFn = null;
                  return runAttempt(priorFailCount + 1, false);
                });
              }
              return proceedToCloud(savedCp);
            });
          });
        });
      }

      if (priorFailCount >= 3) {
        return updateCheckpoint(cp, jobKey, {
          running: false,
          finished: false,
          failCount: priorFailCount,
          reasons: reasons
        }).then(function (savedCp) {
          return proceedToCloud(savedCp);
        });
      }
      /* If startup crash pushed priorFailCount to 1 or 2, show retry notice + 3s wait before running next try. */
      return runAttempt(priorFailCount + 1, priorFailCount > 0);
    });
  }

  var api = {
    TIMEOUTS: TIMEOUTS,
    NOTICES: NOTICES,
    DEVICE_PRIVACY_LINE: DEVICE_PRIVACY_LINE,
    DATA_PROBLEM_CODES: DATA_PROBLEM_CODES,
    COUNTED_ERROR_CODES: COUNTED_ERROR_CODES,
    isEnabled: isEnabled,
    classifyError: classifyError,
    updateCheckpoint: updateCheckpoint,
    getDeviceMeta: getDeviceMeta,
    runWithFallback: runWithFallback,
    _setClock: function (clk) { _customClock = clk || null; }
  };

  if (root) root.SMD_RMD_JOBS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
