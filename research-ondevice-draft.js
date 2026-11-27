/* StewardMD - ResearchMD on-device manuscript draft step runner (window.SMD_RMD_ONDEVICE_DRAFT).
 * ES5 IIFE. Dual export: module.exports and browser global.
 * Mirrors backend/research/paperorchestra/adapter/po_adapter/{pipeline,llm}.py on device.
 * Only AI calls leave the device (POST /v1/internal/llm with per-job bearer token).
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  var TIER_CEILINGS = {
    T1: { maxInputTokens: 8000, maxOutputTokens: 2000, maxRetries: 2, maxRefinementRounds: 1 },
    T2: { maxInputTokens: 16000, maxOutputTokens: 4000, maxRetries: 2, maxRefinementRounds: 2 },
    T3: { maxInputTokens: 24000, maxOutputTokens: 4000, maxRetries: 1, maxRefinementRounds: 1 }
  };
  var PO_MAX_CALLS = 64;
  var PO_MAX_SECONDS = 600;
  var GATEWAY_FRAMING_TOKENS = 1000;
  var DEFAULT_GATEWAY_PATH = "/api/research/v1/internal/llm";
  var APP_MARKER = "smdapp_ddc578ad04b399a332e53e04706433d96803e91c2d373b7d";
  var DEVICE_FAIL_CODES = {
    gate_failed: 1,
    phi_blocked: 1,
    ceiling_calls: 1,
    ceiling_seconds: 1,
    invalid_snapshot: 1,
    device_failed: 1
  };
  var LOADER_INVALID_CODES = {
    invalid_manifest: 1,
    protocol_unlocked: 1,
    unverified_value: 1,
    missing_provenance: 1,
    unverified_rob: 1,
    invalid_grade: 1,
    invalid_reference: 1,
    invalid_run: 1
  };

  function getPrompts() {
    if (G && G.SMD_RMD_PO_PROMPTS) return G.SMD_RMD_PO_PROMPTS;
    if (typeof require === "function") return require("./research-po-prompts.js");
    throw makeErr("device_failed", "validate", "Prompt templates not loaded");
  }

  function getGates() {
    if (G && G.SMD_RMD_PO_GATES) return G.SMD_RMD_PO_GATES;
    if (typeof require === "function") return require("./research-po-gates.js");
    throw makeErr("device_failed", "validate", "Manuscript gates not loaded");
  }

  function getCheckpoint(opts) {
    if (opts && opts.checkpoint) return opts.checkpoint;
    if (G && G.SMD_RMD_CHECKPOINT) return G.SMD_RMD_CHECKPOINT;
    if (typeof require === "function") return require("./research-ondevice-checkpoint.js");
    return null;
  }

  function makeErr(code, step, message, extra) {
    var err = new Error(message || code);
    err.code = code;
    err.step = step || "";
    if (extra) {
      var ks = Object.keys(extra);
      for (var i = 0; i < ks.length; i++) err[ks[i]] = extra[ks[i]];
    }
    return err;
  }

  function mapToDeviceFailCode(code) {
    if (DEVICE_FAIL_CODES[code]) return code;
    if (LOADER_INVALID_CODES[code]) return "invalid_snapshot";
    return "device_failed";
  }

  function estimateTokens(text) {
    return Math.floor(String(text == null ? "" : text).length / 4) + 1;
  }

  function defaultCutoffDate(nowMs) {
    var d = new Date(nowMs);
    var m = d.getUTCMonth() + 1;
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" + m : String(m));
  }

  function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function sanitizeStepId(raw) {
    return String(raw || "").toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function defaultSleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function buildSectionOrder(outline) {
    var plan = outline && Array.isArray(outline.section_plan) ? outline.section_plan : null;
    if (!plan || !plan.length) {
      return [
        { id: "abstract", title: "Abstract", stepId: "section:abstract", plan: null },
        { id: "introduction", title: "Introduction", stepId: "section:introduction", plan: null },
        { id: "methods", title: "Methods", stepId: "section:methods", plan: null },
        { id: "results", title: "Results", stepId: "section:results", plan: null },
        { id: "discussion", title: "Discussion", stepId: "section:discussion", plan: null }
      ];
    }
    var used = {};
    var out = [];
    for (var i = 0; i < plan.length; i++) {
      var item = plan[i] || {};
      var title = typeof item.section_title === "string" && item.section_title.trim()
        ? item.section_title.trim()
        : ("Section " + (i + 1));
      var baseId = slugify(title) || ("section-" + (i + 1));
      var id = baseId;
      var suffix = 2;
      while (used[id]) {
        id = baseId + "-" + suffix;
        suffix++;
      }
      used[id] = true;
      var stepId = sanitizeStepId("section:" + id);
      out.push({ id: id, title: title, stepId: stepId, plan: item });
    }
    return out;
  }

  function normalizeSectionLatex(gates, latex, secItem) {
    var raw = String(latex || "").trim();
    if (!raw) return "";
    var parsed = gates.parseLatexSections(raw);
    if (!parsed.length) {
      var cmd = secItem.id === "abstract" ? "\\section*{Abstract}" : ("\\section{" + secItem.title + "}");
      return cmd + "\n" + raw;
    }
    if (parsed.length === 1) {
      return raw;
    }
    /* If the model returned a full document, extract the matching top-level section
     * (and any immediate subsections) for this step. */
    var targetIdx = -1;
    for (var i = 0; i < parsed.length; i++) {
      var sid = String(parsed[i].id || "");
      if (sid === secItem.id || sid.indexOf(secItem.id) >= 0 || secItem.id.indexOf(sid) >= 0) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx < 0) return raw;
    var chunks = [];
    for (var j = targetIdx; j < parsed.length; j++) {
      var p = parsed[j];
      if (j > targetIdx && p.level <= 1) break;
      var tag = p.level === 1 ? (p.id === "abstract" ? "\\section*{" : "\\section{")
        : (p.level === 2 ? "\\subsection{" : "\\subsubsection{");
      chunks.push(tag + p.heading + "}\n" + p.text);
    }
    return chunks.join("\n\n");
  }

  function extractScores(review) {
    var axes = [
      "Originality", "Quality", "Clarity", "Significance",
      "Soundness", "Presentation", "Contribution", "Overall", "Confidence"
    ];
    var scores = {};
    var r = review && typeof review === "object" ? review : {};
    for (var i = 0; i < axes.length; i++) {
      var k = axes[i];
      var v = parseFloat(r[k]);
      scores[k] = isFinite(v) ? v : 0;
    }
    return scores;
  }

  function createGatewayTransport(opts) {
    if (opts && typeof opts.gatewayRequest === "function") {
      return opts.gatewayRequest;
    }
    return function defaultGatewayTransport(url, payload, token) {
      var Http = G && G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.CapacitorHttp;
      if (Http && typeof Http.request === "function") {
        return Http.request({
          url: url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": "Bearer " + token,
            "X-SMD-App": APP_MARKER
          },
          data: payload,
          connectTimeout: 30000,
          readTimeout: 150000
        }).then(function (res) {
          var data = res && res.data;
          if (typeof data === "string") {
            try { data = JSON.parse(data); } catch (e) {}
          }
          return { status: (res && res.status) || 200, data: data || {} };
        });
      }
      var fetchFn = (opts && opts.fetch) || (G && G.fetch);
      if (typeof fetchFn !== "function") {
        return Promise.reject(new Error("fetch is unavailable"));
      }
      return fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
          return { status: res.status, data: data || {} };
        });
      });
    };
  }

  function createApiCaller(opts) {
    if (opts && typeof opts.apiRequest === "function") return opts.apiRequest;
    if (G && G.SMD_RESEARCH && G.SMD_RESEARCH.api && typeof G.SMD_RESEARCH.api.request === "function") {
      return function (method, path, body) {
        return G.SMD_RESEARCH.api.request(method, path, body);
      };
    }
    return null;
  }

  function run(jobBundle, opts) {
    opts = opts || {};
    var PROMPTS = getPrompts();
    var GATES = getGates();
    var cpStore = getCheckpoint(opts);
    var nowFn = typeof opts.now === "function" ? opts.now : Date.now;
    var sleepFn = typeof opts.sleep === "function" ? opts.sleep : defaultSleep;
    var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
    var isCancelled = typeof opts.isCancelled === "function" ? opts.isCancelled : function () { return false; };
    var beginAiWait = typeof opts.beginAiWait === "function" ? opts.beginAiWait : function () {};
    var endAiWait = typeof opts.endAiWait === "function" ? opts.endAiWait : function () {};

    var job = (jobBundle && jobBundle.job) ? jobBundle.job : (jobBundle || {});
    var jobId = job.id || job.jobId || "";
    var projectId = job.projectId || (jobBundle && jobBundle.manifest && jobBundle.manifest.projectId) || "";
    var userId = job.createdBy || job.userId || "";
    var manifest = (jobBundle && jobBundle.manifest) || opts.manifest || null;
    var currentToken = (jobBundle && jobBundle.token) || opts.token || "";

    var tier = opts.tier && TIER_CEILINGS[opts.tier] ? opts.tier : "T2";
    var ceiling = TIER_CEILINGS[tier];
    var ceilingsObj = job.ceilings || {};
    var maxCalls = Math.min(Number(opts.maxCalls || ceilingsObj.maxCalls || PO_MAX_CALLS), PO_MAX_CALLS);
    var maxSeconds = Math.min(Number(opts.maxSeconds || ceilingsObj.maxSeconds || PO_MAX_SECONDS), PO_MAX_SECONDS);
    var maxRounds = opts.maxRefinementRounds != null
      ? Math.min(Number(opts.maxRefinementRounds), ceiling.maxRefinementRounds)
      : ceiling.maxRefinementRounds;
    if (maxRounds < 0 || !isFinite(maxRounds)) maxRounds = 0;

    var baseOrigin = (opts.baseUrl != null ? opts.baseUrl : (G && G.SMD_API_BASE)) || "";
    var gatewayUrl = opts.gatewayUrl || (baseOrigin + DEFAULT_GATEWAY_PATH);
    var gatewayTransport = createGatewayTransport(opts);
    var apiRequest = createApiCaller(opts);
    var cpKey = "draft:" + jobId;
    var cutoffDate = opts.cutoffDate || job.cutoffDate || defaultCutoffDate(nowFn());

    var state = {
      jobId: jobId,
      projectId: projectId,
      status: "running",
      manifest: manifest,
      lastCompletedStep: "",
      completedSteps: {},
      sectionOrder: null,
      outline: null,
      sections: {},
      currentTex: "",
      refinements: [],
      worklogs: {},
      currentReview: null,
      currentScore: 0,
      gateHits: [],
      callCount: 0,
      refinementRounds: 0,
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, records: [] },
      stepElapsedMs: 0,
      updatedAt: ""
    };

    var activeStep = "validate";
    var activeTimerStart = nowFn();

    function pauseTimer() {
      if (activeTimerStart != null) {
        var delta = nowFn() - activeTimerStart;
        if (delta > 0) state.stepElapsedMs += delta;
        activeTimerStart = null;
      }
    }

    function resumeTimer() {
      if (activeTimerStart == null) {
        activeTimerStart = nowFn();
      }
    }

    function elapsedMs() {
      return state.stepElapsedMs + (activeTimerStart != null ? Math.max(0, nowFn() - activeTimerStart) : 0);
    }

    function saveCheckpoint() {
      state.stepElapsedMs = elapsedMs();
      activeTimerStart = nowFn();
      state.updatedAt = new Date(nowFn()).toISOString();
      if (!cpStore || typeof cpStore.put !== "function" || !jobId) return Promise.resolve();
      function writeMerged(cur) {
        var next = {};
        var runnerKeys = ["running", "finished", "failCount", "reasons", "jobKey"];
        if (cur && typeof cur === "object") {
          for (var ri = 0; ri < runnerKeys.length; ri++) {
            var rk = runnerKeys[ri];
            if (Object.prototype.hasOwnProperty.call(cur, rk)) next[rk] = cur[rk];
          }
        }
        for (var k in state) {
          if (Object.prototype.hasOwnProperty.call(state, k)) next[k] = state[k];
        }
        return cpStore.put(cpKey, next);
      }
      if (typeof cpStore.get === "function") {
        return Promise.resolve().then(function () { return cpStore.get(cpKey); }).then(writeMerged, function () { return writeMerged(null); });
      }
      return writeMerged(null);
    }

    function checkPreCallGuards(stepId) {
      if (isCancelled() || (opts.signal && opts.signal.aborted)) {
        var reason = opts.signal && opts.signal.reason;
        if (reason && reason.code === "ceiling_seconds") {
          return makeErr("ceiling_seconds", stepId, reason.message || "Draft exceeded time ceiling", reason.rule ? { rule: reason.rule } : null);
        }
        return makeErr("cancelled", stepId, "Draft cancelled");
      }
      if (elapsedMs() / 1000 > maxSeconds) {
        return makeErr("ceiling_seconds", stepId, "Draft exceeded time ceiling");
      }
      return null;
    }

    function refreshTokenOnce() {
      if (!apiRequest || !jobId) {
        return Promise.reject(makeErr("device_failed", activeStep, "Cannot refresh job token"));
      }
      pauseTimer();
      beginAiWait();
      return apiRequest("POST", "/v1/jobs/" + encodeURIComponent(jobId) + "/token").then(function (res) {
        endAiWait();
        resumeTimer();
        var tok = res && res.token;
        if (!tok) throw makeErr("device_failed", activeStep, "Empty refreshed job token");
        currentToken = tok;
        return tok;
      }, function (err) {
        endAiWait();
        resumeTimer();
        throw makeErr("device_failed", activeStep, (err && err.message) || "Token refresh failed");
      });
    }

    function sendGatewayCall(stepId, purpose, system, prompt) {
      activeStep = stepId;
      var guardErr = checkPreCallGuards(stepId);
      if (guardErr) return Promise.reject(guardErr);

      var assembled = (system ? system + "\n\n" : "") + prompt;
      var phiReport = GATES.scanPhi(assembled);
      if (phiReport.blocked) {
        return Promise.reject(makeErr("phi_blocked", stepId, "Patient identifiers detected in prompt", {
          categories: GATES.phiCategories(phiReport.hits)
        }));
      }

      if (purpose === "refinement") {
        if (state.refinementRounds >= ceiling.maxRefinementRounds) {
          return Promise.reject(makeErr("ceiling_refinement_rounds", stepId, "Refinement round ceiling reached"));
        }
      }
      if (state.callCount >= maxCalls) {
        return Promise.reject(makeErr("ceiling_calls", stepId, "Max " + maxCalls + " calls per job reached"));
      }
      var estIn = estimateTokens(assembled) + GATEWAY_FRAMING_TOKENS;
      if (estIn > ceiling.maxInputTokens) {
        return Promise.reject(makeErr("ceiling_input_tokens", stepId, "Input exceeds tier token ceiling"));
      }
      if (!currentToken) {
        return Promise.reject(makeErr("device_failed", stepId, "Missing job token"));
      }

      var payload = {
        jobId: jobId,
        projectId: projectId,
        userId: userId,
        tier: tier,
        model: purpose === "refinement" || purpose === "review" ? "researchmd-reflection" : "researchmd-writer",
        prompt: prompt,
        maxOutputTokens: ceiling.maxOutputTokens,
        purpose: purpose,
        stepId: sanitizeStepId(stepId)
      };
      if (typeof system === "string" && system) {
        payload.system = system;
      }

      var attempts = 1 + ceiling.maxRetries;
      var refreshed401 = false;

      function attemptCall(attemptIdx) {
        var preErr = checkPreCallGuards(stepId);
        if (preErr) return Promise.reject(preErr);
        pauseTimer();
        beginAiWait();
        return gatewayTransport(gatewayUrl, payload, currentToken).then(function (res) {
          endAiWait();
          resumeTimer();
          var status = (res && res.status) || 200;
          var data = (res && res.data) || {};
          if (status >= 200 && status < 300) {
            if (typeof data.text !== "string") {
              throw makeErr("device_failed", stepId, "Gateway response missing text");
            }
            var u = data.usage || {};
            var inTok = Number(u.inputTokens || u.input_tokens || 0) || 0;
            var outTok = Number(u.outputTokens || u.output_tokens || 0) || 0;
            if (outTok > ceiling.maxOutputTokens) {
              throw makeErr("ceiling_output_tokens", stepId, "Output exceeded tier token ceiling");
            }
            state.callCount += 1;
            if (purpose === "refinement") state.refinementRounds += 1;
            state.usage.calls = state.callCount;
            state.usage.inputTokens += inTok;
            state.usage.outputTokens += outTok;
            state.usage.records.push({
              jobId: jobId,
              projectId: projectId,
              stepId: payload.stepId,
              purpose: purpose,
              tier: tier,
              model: data.model || payload.model,
              inputTokens: inTok,
              outputTokens: outTok,
              cached: !!data.cached,
              ts: Math.floor(nowFn() / 1000)
            });
            return data;
          }
          if (status === 401 && !refreshed401) {
            refreshed401 = true;
            return refreshTokenOnce().then(function () {
              return attemptCall(attemptIdx);
            });
          }
          var errCode = (data && data.error && data.error.code) || "";
          if (status === 422 && (errCode === "phi_blocked" || errCode === "ipd_blocked")) {
            throw makeErr(errCode, stepId, (data.error && data.error.message) || errCode, {
              categories: data.categories || []
            });
          }
          if ((status === 429 || status >= 500) && attemptIdx < attempts - 1) {
            return sleepFn(Math.pow(2, attemptIdx) * 1000).then(function () {
              return attemptCall(attemptIdx + 1);
            });
          }
          throw makeErr(errCode === "ceiling_input_tokens" ? "ceiling_input_tokens" : "device_failed",
            stepId, (data.error && data.error.message) || ("Gateway HTTP " + status));
        }, function (netErr) {
          endAiWait();
          resumeTimer();
          if (netErr && netErr.code) throw netErr;
          if (attemptIdx < attempts - 1) {
            return sleepFn(Math.pow(2, attemptIdx) * 1000).then(function () {
              return attemptCall(attemptIdx + 1);
            });
          }
          throw makeErr("device_failed", stepId, (netErr && netErr.message) || "Gateway transport error");
        });
      }

      return attemptCall(0);
    }

    var inputs = null;
    var citationMap = {};

    function failAndReport(err) {
      pauseTimer();
      var code = (err && err.code) || "device_failed";
      var step = (err && err.step) || activeStep || "validate";
      var normalizedErr = (err instanceof Error && err.code) ? err : makeErr(code, step, err && err.message);
      if (!normalizedErr.step) normalizedErr.step = step;

      if (code === "cancelled") {
        return Promise.reject(normalizedErr);
      }

      state.status = "failed";
      state.errorCode = code;
      state.failedStep = step;
      var failCode = mapToDeviceFailCode(code);

      var cpP = saveCheckpoint().catch(function () {});
      var failP = (apiRequest && jobId)
        ? apiRequest("POST", "/v1/jobs/" + encodeURIComponent(jobId) + "/device-fail", {
          code: failCode,
          step: sanitizeStepId(step) || "validate"
        }).catch(function () {})
        : Promise.resolve();

      return Promise.all([cpP, failP]).then(function () {
        throw normalizedErr;
      });
    }

    /* Step 1: validate (and optionally load checkpoint for resume) */
    var initP = (opts.resume && cpStore && typeof cpStore.get === "function" && jobId)
      ? cpStore.get(cpKey).then(function (saved) {
        if (saved && typeof saved === "object") {
          if (!manifest && saved.manifest) manifest = saved.manifest;
          state.manifest = manifest;
          state.lastCompletedStep = saved.lastCompletedStep || "";
          state.completedSteps = saved.completedSteps || {};
          state.sectionOrder = saved.sectionOrder || null;
          state.outline = saved.outline || null;
          state.sections = saved.sections || {};
          state.currentTex = saved.currentTex || "";
          state.refinements = saved.refinements || [];
          state.worklogs = saved.worklogs || {};
          state.currentReview = saved.currentReview || null;
          state.currentScore = saved.currentScore || 0;
          state.gateHits = saved.gateHits || [];
          state.callCount = saved.callCount || 0;
          state.refinementRounds = saved.refinementRounds || 0;
          state.usage = saved.usage || { calls: 0, inputTokens: 0, outputTokens: 0, records: [] };
          state.stepElapsedMs = saved.stepElapsedMs || 0;
        }
      })
      : Promise.resolve();

    return initP.then(function () {
      activeStep = "validate";
      onProgress({ step: "validate", phase: "validate", label: "Drafting on this device: validating" });
      try {
        inputs = GATES.buildInputs(manifest);
      } catch (e) {
        throw makeErr(e.code || "invalid_snapshot", "validate", e.message);
      }
      state.manifest = manifest;
      citationMap = {};
      var refs = inputs.references || [];
      for (var ri = 0; ri < refs.length; ri++) {
        if (refs[ri] && refs[ri].key && !citationMap[refs[ri].key]) {
          citationMap[refs[ri].key] = refs[ri];
        }
      }
      if (!state.completedSteps["validate"]) {
        state.completedSteps["validate"] = true;
        state.lastCompletedStep = "validate";
        return saveCheckpoint();
      }
    }).then(function () {
      /* Step 2: outline */
      activeStep = "outline";
      if (opts.resume && state.completedSteps["outline"] && state.outline) {
        if (!state.sectionOrder) state.sectionOrder = buildSectionOrder(state.outline);
        return;
      }
      onProgress({ step: "outline", phase: "outline", label: "Drafting on this device: outline" });
      var outReq = PROMPTS.buildOutlinePrompt({
        ideaMd: inputs.ideaMd,
        experimentalLogMd: inputs.experimentalLogMd,
        templateTex: inputs.templateTex,
        guidelinesMd: inputs.guidelinesMd,
        cutoffDate: cutoffDate
      });

      function attemptOutline(retryIdx) {
        var sid = retryIdx === 0 ? "outline" : ("outline:r" + retryIdx);
        return sendGatewayCall(sid, "write", outReq.system, outReq.prompt).then(function (resp) {
          var parsed = GATES.parseGeminiJsonResults(resp.text);
          if (parsed && typeof parsed === "object") return parsed;
          if (retryIdx < ceiling.maxRetries) return attemptOutline(retryIdx + 1);
          throw makeErr("device_failed", "outline", "Outline response was not valid JSON");
        });
      }

      return attemptOutline(0).then(function (parsedOutline) {
        state.outline = parsedOutline;
        state.sectionOrder = buildSectionOrder(parsedOutline);
        state.completedSteps["outline"] = true;
        state.lastCompletedStep = "outline";
        return saveCheckpoint();
      });
    }).then(function () {
      /* Step 3: section:<name> for each section the outline lists */
      var order = state.sectionOrder || buildSectionOrder(state.outline);
      state.sectionOrder = order;
      var outlineJsonStr = JSON.stringify(state.outline, null, 2);

      var chain = Promise.resolve();
      order.forEach(function (secItem, idx) {
        chain = chain.then(function () {
          activeStep = secItem.stepId;
          var resumeKeyDone = !!(state.completedSteps[secItem.stepId] ||
            state.completedSteps["section:" + (idx + 1)] ||
            state.completedSteps["section:" + secItem.id]);
          if (opts.resume && resumeKeyDone && typeof state.sections[secItem.id] === "string") {
            return;
          }
          onProgress({
            step: secItem.stepId,
            phase: "section",
            index: idx + 1,
            total: order.length,
            label: "Drafting on this device: section " + (idx + 1) + " of " + order.length
          });

          function attemptSection(retryIdx, retryReason) {
            var sid = retryIdx === 0 ? secItem.stepId : (secItem.stepId + ":r" + retryIdx);
            var req = PROMPTS.buildSectionPrompt({
              outlineJsonStr: outlineJsonStr,
              citationMap: citationMap,
              ideaMd: inputs.ideaMd,
              experimentalLogMd: inputs.experimentalLogMd,
              guidelinesMd: inputs.guidelinesMd,
              templateTex: inputs.templateTex,
              sectionTitle: secItem.title,
              retryReason: retryReason
            });
            return sendGatewayCall(sid, "write", req.system, req.prompt).then(function (resp) {
              var latexRaw = GATES.parseGeminiLatexResults(resp.text);
              var sectionTex = normalizeSectionLatex(GATES, latexRaw, secItem);
              if (!sectionTex) {
                if (retryIdx < ceiling.maxRetries) {
                  return attemptSection(retryIdx + 1, "Empty LaTeX output; return the section inside a ```latex``` block.");
                }
                throw makeErr("device_failed", secItem.stepId, "Empty section draft");
              }
              var parsedSecs = GATES.parseLatexSections(sectionTex);
              var violations = GATES.runGates(parsedSecs, inputs.tokenTable, citationMap, manifest);
              if (violations.length && retryIdx < ceiling.maxRetries) {
                var reasons = [];
                for (var vi = 0; vi < violations.length; vi++) {
                  reasons.push("- " + violations[vi].gate + (violations[vi].number ? " (" + violations[vi].number + ")" : "") +
                    (violations[vi].token ? " (" + violations[vi].token + ")" : "") +
                    (violations[vi].key ? " (" + violations[vi].key + ")" : ""));
                }
                return attemptSection(retryIdx + 1, reasons.join("\n"));
              }
              return sectionTex;
            });
          }

          return attemptSection(0, "").then(function (sectionTex) {
            state.sections[secItem.id] = sectionTex;
            state.completedSteps[secItem.stepId] = true;
            state.lastCompletedStep = secItem.stepId;
            return saveCheckpoint();
          });
        });
      });

      return chain.then(function () {
        if (!state.currentTex) {
          var parts = [];
          for (var i = 0; i < order.length; i++) {
            if (state.sections[order[i].id]) parts.push(state.sections[order[i].id]);
          }
          state.currentTex = parts.join("\n\n");
        }
      });
    }).then(function () {
      /* Step 4: refine:<round> (gated autorater review + score-gain acceptance) */
      if (maxRounds <= 0) return;

      function gatedReview(tex, stepPrefix) {
        var violations = GATES.checkPaper(tex, inputs.tokenTable, citationMap, manifest);
        if (violations.length) {
          for (var vi = 0; vi < violations.length; vi++) state.gateHits.push(violations[vi]);
          return Promise.resolve({
            review: { Error: "gate_failed", Overall: 0, Weaknesses: violations.map(function (v) { return v.gate; }) },
            score: 0
          });
        }
        var parsedReviews = [];
        var revChain = Promise.resolve();
        [1, 2, 3].forEach(function (idx) {
          revChain = revChain.then(function () {
            var revReq = PROMPTS.buildReviewPrompt(tex);
            return sendGatewayCall(stepPrefix + ":rev" + idx, "review", revReq.system, revReq.prompt).then(function (resp) {
              var parsed = GATES.parseGeminiJsonResults(resp.text);
              if (!parsed || typeof parsed !== "object") {
                parsed = { Overall: 5, Weaknesses: [], Questions: [] };
              }
              parsedReviews.push(parsed);
            });
          });
        });
        return revChain.then(function () {
          var metaReq = PROMPTS.buildMetaReviewPrompt(parsedReviews);
          return sendGatewayCall(stepPrefix + ":meta", "review", metaReq.system, metaReq.prompt).then(function (resp) {
            var review = GATES.parseGeminiJsonResults(resp.text) || parsedReviews[0] || { Overall: 0 };
            var score = extractScores(review).Overall || 0;
            return { review: review, score: score };
          });
        });
      }

      var baseP = (opts.resume && state.completedSteps["refine:0:review"] && state.currentReview)
        ? Promise.resolve()
        : gatedReview(state.currentTex, "refine:0").then(function (res) {
          state.currentReview = res.review;
          state.currentScore = res.score;
          state.completedSteps["refine:0:review"] = true;
          return saveCheckpoint();
        });

      var stopped = false;
      var rChain = baseP;

      for (var r = 1; r <= maxRounds; r++) {
        (function (roundNum) {
          rChain = rChain.then(function () {
            if (stopped) return;
            var roundStepId = "refine:" + roundNum;
            activeStep = roundStepId;
            if (opts.resume && state.completedSteps[roundStepId]) {
              return;
            }
            onProgress({
              step: roundStepId,
              phase: "refine",
              index: roundNum,
              total: maxRounds,
              label: "Drafting on this device: review round " + roundNum + " of " + maxRounds
            });

            var prevLogStr = Object.keys(state.worklogs).length ? JSON.stringify(state.worklogs, null, 2) : "None";
            var refReq = PROMPTS.buildRefinementPrompt({
              round: roundNum,
              previousLogStr: prevLogStr,
              currentScore: state.currentScore,
              currentReview: state.currentReview,
              guidelinesMd: inputs.guidelinesMd,
              experimentalLogMd: inputs.experimentalLogMd,
              citationMapJsonStr: JSON.stringify(citationMap, null, 2),
              currentTex: state.currentTex
            });

            return sendGatewayCall(roundStepId, "refinement", refReq.system, refReq.prompt).then(function (resp) {
              var parsed = GATES.parseGeminiJsonLatexResponse(resp.text);
              var newTex = parsed && parsed.latex;
              if (!newTex) {
                stopped = true;
                return;
              }
              return gatedReview(newTex, roundStepId).then(function (revOut) {
                var oldMetrics = extractScores(state.currentReview);
                var newMetrics = extractScores(revOut.review);
                var excluded = { Overall: 1, Confidence: 1 };
                var totalGain = 0;
                var totalDrop = 0;
                var mKeys = Object.keys(newMetrics);
                for (var mi = 0; mi < mKeys.length; mi++) {
                  var ax = mKeys[mi];
                  if (excluded[ax]) continue;
                  var d = (newMetrics[ax] || 0) - (oldMetrics[ax] || 0);
                  if (d > 0) totalGain += d;
                  else if (d < 0) totalDrop += Math.abs(d);
                }
                var outcome;
                if (newMetrics.Overall > oldMetrics.Overall) {
                  outcome = "ACCEPTED_SCORE_INCREASE";
                  state.currentTex = newTex;
                  state.currentScore = revOut.score;
                  state.currentReview = revOut.review;
                } else if (newMetrics.Overall < oldMetrics.Overall) {
                  outcome = "REJECTED_SCORE_DECREASE";
                  stopped = true;
                } else if (totalDrop > totalGain) {
                  outcome = "REJECTED_DEGRADATION";
                  stopped = true;
                } else {
                  outcome = "ACCEPTED_NEUTRAL_IMPROVEMENT";
                  state.currentTex = newTex;
                  state.currentScore = revOut.score;
                  state.currentReview = revOut.review;
                }
                var entry = {
                  round: roundNum,
                  agent_plan: parsed.json,
                  scores_before: oldMetrics,
                  scores_after: newMetrics,
                  total_gain: totalGain,
                  total_drop: totalDrop,
                  outcome: outcome
                };
                state.worklogs["v" + roundNum] = entry;
                state.refinements.push(entry);
                state.completedSteps[roundStepId] = true;
                state.lastCompletedStep = roundStepId;
                return saveCheckpoint();
              });
            });
          });
        })(r);
      }

      return rChain;
    }).then(function () {
      /* Step 5: final gates + assemble + POST /v1/jobs/:id/device-result */
      activeStep = "final";
      onProgress({ step: "final", phase: "final", label: "Drafting on this device: finalising" });
      var guardErr = checkPreCallGuards("final");
      if (guardErr) throw guardErr;

      var parsedSections = GATES.parseLatexSections(state.currentTex);
      if (!parsedSections.length) {
        throw makeErr("gate_failed", "final", "No manuscript sections produced");
      }
      try {
        GATES.enforce(parsedSections, inputs.tokenTable, citationMap, manifest);
      } catch (ge) {
        throw makeErr("gate_failed", "final", ge.message, { violations: ge.violations || [] });
      }

      var manuscript = GATES.buildManuscript({
        title: (manifest.protocol && manifest.protocol.title) || "",
        sections: parsedSections,
        tokenTable: inputs.tokenTable,
        references: inputs.references,
        citationMap: citationMap,
        manifest: manifest,
        outline: state.outline
      });
      manuscript.provenance.gateHits = state.gateHits.slice();
      manuscript.provenance.usage = {
        calls: state.usage.calls,
        inputTokens: state.usage.inputTokens,
        outputTokens: state.usage.outputTokens
      };

      var submitUsage = {
        calls: state.usage.calls,
        inputTokens: state.usage.inputTokens,
        outputTokens: state.usage.outputTokens,
        seconds: round1(elapsedMs() / 1000)
      };

      if (!apiRequest || !jobId) {
        state.status = "succeeded";
        state.completedSteps["final"] = true;
        state.lastCompletedStep = "final";
        return saveCheckpoint().then(function () { return manuscript; });
      }

      return apiRequest("POST", "/v1/jobs/" + encodeURIComponent(jobId) + "/device-result", {
        manuscript: manuscript,
        usage: submitUsage
      }).then(function () {
        state.status = "succeeded";
        state.completedSteps["final"] = true;
        state.lastCompletedStep = "final";
        return saveCheckpoint().then(function () { return manuscript; });
      }, function (err) {
        var code = (err && err.code) || "device_failed";
        throw makeErr(code, "final", (err && err.message) || "Failed to submit device draft", {
          gateFailures: err && err.body && err.body.gateFailures
        });
      });
    }).catch(failAndReport);
  }

  var API = {
    TIER_CEILINGS: TIER_CEILINGS,
    PO_MAX_CALLS: PO_MAX_CALLS,
    PO_MAX_SECONDS: PO_MAX_SECONDS,
    estimateTokens: estimateTokens,
    run: run
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RMD_ONDEVICE_DRAFT = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
