/* StewardMD - ResearchMD Extraction screen (window.SMD_RESEARCH.screens.extract).
 * ES5 only, buildless, mobile-first. Phase 3.4: structured form beside the
 * offline page view (SMD.pdf). One value per field with locator + verbatim
 * quote; verify / correct with reason and audit; AI suggestions labelled
 * "Suggestion" with Accept (never auto-applied, never auto-verified); promote
 * a verified extraction to a research_studies row for the engine.
 * Routes per docs/research/contracts/phase-3/extraction.md.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  function p2() { return SMD.p2 || {}; }
  function pdf() { return SMD.pdf || {}; }

  var pollCfg = { intervalMs: 600, timeoutMs: 60000 };

  var st = {
    projectId: null, loaded: false, loading: false, error: null,
    studies: [], studyId: null, templates: [], template: "rct_binary",
    extraction: null, extractionLoading: false,
    artifactId: null, result: null, page: 1, highlight: null,
    pdfJobId: null, pdfJobStatus: null, pdfUploading: false, pdfProgressText: "", pdfSeq: 0,
    form: {}, activeField: null, correctFor: null, invalidField: null,
    busy: false, actionError: null, announce: "",
    showAudit: false, audit: [], promoteMeasure: "RR",
    phoneView: "form", ai: null
  };
  var seq = 0;

  function makeAiState() {
    return { busy: false, statusText: "", error: null, guidance: null, drafted: {} };
  }

  function templateDef() {
    for (var i = 0; i < st.templates.length; i++) if (st.templates[i].id === st.template) return st.templates[i];
    return st.templates[0] || { id: st.template, fields: [], measures: ["RR"] };
  }
  function fieldDef(key) {
    var f = templateDef().fields || [];
    for (var i = 0; i < f.length; i++) if (f[i].key === key) return f[i];
    return { key: key, label: key, type: "text", required: false };
  }
  function formFor(key) {
    if (!st.form[key]) st.form[key] = { value: "", locator: null, quote: "" };
    return st.form[key];
  }
  function statusOf(key) {
    var f = st.extraction && st.extraction.fields && st.extraction.fields[key];
    return f ? f.status : "unverified";
  }

  function isFieldAttested(key) {
    var s = statusOf(key);
    if (s !== "verified" && s !== "corrected") return false;
    var srv = st.extraction && st.extraction.fields && st.extraction.fields[key];
    if (!srv || !srv.locator || !srv.quote) return false;
    var loc = formFor(key);
    if (String(loc.value) !== String(srv.value == null ? "" : srv.value)) return false;
    return true;
  }

  function firstUnverifiedRequired() {
    var tpl = templateDef();
    if (tpl.id === "generic_effect") {
      if (isFieldAttested("yi") && isFieldAttested("se")) return null;
      if (isFieldAttested("effect") && isFieldAttested("ciLower") && isFieldAttested("ciUpper")) return null;
      return "yi";
    }
    var fields = tpl.fields || [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].required && !isFieldAttested(fields[i].key)) return fields[i].key;
    }
    return null;
  }

  function formHasUnsavedChanges(keys) {
    var srvFields = (st.extraction && st.extraction.fields) || {};
    var checkKeys = keys || Object.keys(st.form);
    for (var i = 0; i < checkKeys.length; i++) {
      var k = checkKeys[i];
      var f = st.form[k];
      var s = srvFields[k];
      if (!f) continue;
      var fVal = f.value === "" || f.value == null ? "" : String(f.value);
      var sVal = s && s.value != null ? String(s.value) : "";
      var fQuote = f.quote || "";
      var sQuote = (s && s.quote) || "";
      if (fVal !== sVal || fQuote !== sQuote || (!!f.locator !== !!(s && s.locator))) return true;
    }
    return false;
  }

  function formatActionBanner(err) {
    if (!err) return "";
    if (err.kind === "guidance") {
      var cls = err.tone === "warn" ? "rmd-banner-warn" : "rmd-banner-info";
      var role = err.tone === "warn" ? "status" : "status";
      var h = '<div class="rmd-banner ' + cls + '" role="' + role + '">';
      h += '<strong>' + esc(err.message) + '</strong>';
      if (err.sub) h += '<span class="rmd-banner-sub">' + esc(err.sub) + '</span>';
      if (err.action === "goto-page") {
        h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="extract-goto-page" style="min-height:44px;flex:0 0 auto">' + esc(err.actionLabel || "Open Page tab") + '</button>';
      }
      h += '</div>';
      return h;
    }
    var code = err.code || "";
    var body = err.body || {};
    if (code === "extraction_unverified" || code === "locator_required" || code === "no_selection" ||
        code === "no_locator" || code === "invalid_correction" || code === "stale_version" ||
        code === "pdf_not_attached" || code === "job_failed" || code === "job_not_done" ||
        code === "extraction_not_found" || err.kind === "field") {
      var msg = err.message || "";
      var sub = err.sub || "";
      if (code === "extraction_unverified") {
        var lbl = body.fieldLabel || (err.fieldKey ? fieldDef(err.fieldKey).label : "");
        if (!msg || /Required field .* is unverified/i.test(msg) || /Something went wrong/i.test(msg)) {
          msg = lbl ? ("Verify " + lbl + " first: capture its quote or correct it.") : "Verify the required fields first: capture each quote or correct it.";
        }
        if (!sub) sub = "Required fields must stay unverified until you verify or correct them with a quote.";
      } else if (code === "locator_required") {
        var locLbl = body.fieldLabel || (err.fieldKey ? fieldDef(err.fieldKey).label : "");
        if (!msg || /A value needs a locator/i.test(msg)) {
          msg = locLbl ? ("Capture a quote for " + locLbl + " on the Page tab first, or use Correct.") : "Capture a quote on the Page tab first, or use Correct.";
        }
      } else if (code === "stale_version") {
        msg = "Another edit was saved first. Review the latest values and try again.";
      } else if (code === "pdf_not_attached") {
        msg = "Attach the study PDF on the Page tab first before asking MaiK to draft.";
      }
      var bh = '<div class="rmd-banner rmd-banner-error" role="alert" id="rmdExtractActionAlert">';
      bh += '<strong>' + esc(msg) + '</strong>';
      if (sub) bh += '<span class="rmd-banner-sub">' + esc(sub) + '</span>';
      if (err.action === "goto-page" || code === "locator_required" || code === "no_locator" || code === "pdf_not_attached") {
        bh += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="extract-goto-page" style="min-height:44px;flex:0 0 auto">' + esc(err.actionLabel || "Open Page tab") + '</button>';
      }
      bh += '</div>';
      return bh;
    }
    return p2().errHtml(err, null);
  }

  function load(container) {
    var mySeq = ++seq;
    st.loading = true; st.error = null;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    Promise.all([
      SMD.api.request("GET", base + "/studies?limit=100"),
      SMD.api.request("GET", "/v1/extraction-templates")
    ]).then(function (res) {
      if (mySeq !== seq) return;
      st.studies = (res[0] && res[0].studies) || [];
      st.templates = (res[1] && res[1].templates) || [];
      st.loading = false; st.loaded = true;
      if (!st.studyId && st.studies.length) st.studyId = st.studies[0].id;
      if (st.templates.length) st.template = st.templates[0].id;
      render(container);
      if (st.studyId) loadExtraction(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false; st.loaded = true; st.error = err; render(container);
    });
  }

  function loadExtraction(container, keepAi) {
    var mySeq = ++seq;
    st.extractionLoading = true; st.extraction = null; st.actionError = null; st.invalidField = null;
    st.pdfJobId = null; st.pdfJobStatus = null;
    render(container);
    var url = "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/extraction?template=" + encodeURIComponent(st.template);
    SMD.api.request("GET", url).then(function (data) {
      if (mySeq !== seq) return;
      st.extractionLoading = false;
      st.extraction = data.extraction;
      st.template = st.extraction.template || st.template;
      st.form = {};
      if (!keepAi) st.ai = makeAiState();
      var fields = st.extraction.fields || {};
      for (var k in fields) {
        st.form[k] = { value: fields[k].value == null ? "" : fields[k].value, locator: fields[k].locator || null, quote: fields[k].quote || "" };
      }
      var measures = templateDef().measures || ["RR"];
      st.promoteMeasure = measures[0];
      st.artifactId = st.extraction.artifactId || null;
      st.result = null; st.page = 1; st.highlight = null;
      render(container);
      if (st.artifactId) {
        loadResult(container, st.artifactId);
      } else {
        var proj = SMD.store ? SMD.store.getActiveProject() : null;
        var CP = G && G.SMD_RMD_CHECKPOINT;
        if ((!proj || !proj.serverId) && CP && typeof CP.list === "function") {
          var targetPid = st.projectId;
          var targetSid = st.studyId;
          CP.list("local-artifact:" + targetPid + ":").then(function (entries) {
            if (mySeq !== seq || st.projectId !== targetPid || st.studyId !== targetSid || st.artifactId) return;
            var best = null;
            for (var i = 0; i < (entries || []).length; i++) {
              var val = entries[i] && entries[i].value;
              if (val && val.studyId === targetSid && val.artifact && val.result) {
                if (!best || (val.artifact.createdTs || 0) >= (best.artifact.createdTs || 0)) best = val;
              }
            }
            if (best) {
              st.artifactId = best.artifact.id;
              st.result = best.result;
              st.page = 1;
              st.pdfJobStatus = "succeeded";
              render(container);
            }
          }).catch(function () {});
        }
      }
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.extractionLoading = false; st.actionError = err; render(container);
    });
  }

  function loadResult(container, artifactId) {
    var mySeq = seq;
    if (artifactId && String(artifactId).indexOf("local_") === 0) {
      var CP = G && G.SMD_RMD_CHECKPOINT;
      if (CP && typeof CP.list === "function") {
        CP.list("local-artifact:" + st.projectId + ":").then(function (entries) {
          if (mySeq !== seq) return;
          for (var i = 0; i < (entries || []).length; i++) {
            var val = entries[i] && entries[i].value;
            if (val && val.artifact && val.artifact.id === artifactId && val.result) {
              st.result = val.result; st.page = 1; st.pdfJobStatus = "succeeded";
              render(container);
              return;
            }
          }
        }).catch(function () {});
      }
      return;
    }
    SMD.api.request("GET", "/v1/artifacts/" + encodeURIComponent(artifactId) + "/result").then(function (data) {
      if (mySeq !== seq) return;
      st.result = data; st.page = 1; st.pdfJobStatus = "succeeded"; render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      if (err && (err.code === "job_not_done" || err.status === 409)) {
        var b = err.body || {};
        if (err.code === "job_failed" || b.jobStatus === "failed" || b.jobStatus === "cancelled") {
          st.pdfJobStatus = b.jobStatus || "failed";
        } else {
          st.pdfJobStatus = b.jobStatus || "running";
          st.pdfJobId = b.jobId || st.pdfJobId;
        }
        render(container);
        return;
      }
      st.actionError = err; render(container);
    });
  }

  function findJobIdForArtifact(projectId, artifactId) {
    if (st.pdfJobId) return Promise.resolve(st.pdfJobId);
    return SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(projectId) + "/artifacts").then(function (data) {
      var list = (data && data.artifacts) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === artifactId) {
          st.pdfJobId = list[i].jobId || null;
          return st.pdfJobId;
        }
      }
      return null;
    }).catch(function () { return null; });
  }

  function waitForPdfJob(container, mySeq, projectId, studyId, artifactId, initialJobId) {
    var startedAt = Date.now();
    var intervalMs = pollCfg.intervalMs > 0 ? pollCfg.intervalMs : 600;
    var timeoutMs = pollCfg.timeoutMs > 0 ? pollCfg.timeoutMs : 60000;
    var jobIdPromise = initialJobId ? Promise.resolve(initialJobId) : findJobIdForArtifact(projectId, artifactId);

    return jobIdPromise.then(function (jobId) {
      function step() {
        if (mySeq !== seq || st.projectId !== projectId || st.studyId !== studyId) {
          return Promise.resolve({ aborted: true });
        }
        if (Date.now() - startedAt >= timeoutMs) {
          return Promise.resolve({ timedOut: true });
        }
        var pollReq = jobId
          ? SMD.api.request("GET", "/v1/jobs/" + encodeURIComponent(jobId)).then(function (res) { return res && res.job; })
          : SMD.api.request("GET", "/v1/artifacts/" + encodeURIComponent(artifactId) + "/result").then(function (data) {
              st.result = data;
              return { status: "succeeded" };
            }).catch(function (err) {
              if (err && err.code === "job_failed") return { status: "failed" };
              if (err && (err.code === "job_not_done" || err.status === 409)) {
                var jb = (err.body && err.body.jobId) || null;
                if (jb) jobId = jb;
                return { status: (err.body && err.body.jobStatus) || "running" };
              }
              throw err;
            });

        return pollReq.then(function (job) {
          if (mySeq !== seq || st.projectId !== projectId || st.studyId !== studyId) {
            return { aborted: true };
          }
          var js = job && job.status ? job.status : "running";
          st.pdfJobStatus = js;
          if (js === "succeeded") return { succeeded: true };
          if (js === "failed" || js === "cancelled") return { failed: true, status: js };
          return new Promise(function (resolve) {
            G.setTimeout(function () { resolve(step()); }, intervalMs);
          });
        });
      }
      return step();
    });
  }

  function requestSuggestionsOnce() {
    return SMD.api.request(
      "POST",
      "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/extraction/suggestions",
      { template: st.template, artifactId: st.artifactId }
    );
  }

  function askMaikSuggestions(container) {
    if (!st.ai) st.ai = makeAiState();
    if (st.ai.busy || !st.extraction) return;
    st.actionError = null;
    st.ai.error = null;
    st.ai.guidance = null;

    if (!st.artifactId) {
      st.ai.guidance = {
        code: "pdf_not_attached",
        tone: "info",
        message: "Attach the study PDF on the Page tab first so MaiK can read the numbers and draft suggestions.",
        action: "goto-page",
        actionLabel: "Open Page tab"
      };
      render(container);
      return;
    }

    var mySeq = seq;
    var targetPid = st.projectId;
    var targetSid = st.studyId;
    var targetAid = st.artifactId;
    st.ai.busy = true;
    st.ai.statusText = "MaiK is reading the paper";
    render(container);

    function applySuggestionsRes(res) {
      if (mySeq !== seq || st.projectId !== targetPid || st.studyId !== targetSid) return;
      st.ai.busy = false;
      st.ai.statusText = "";
      if (res && res.extraction) {
        st.extraction = res.extraction;
        syncForm();
        st.ai.drafted.suggestions = 1;
        var count = (res.extraction.suggestions && res.extraction.suggestions.length) || 0;
        if (count === 0 && (res.added === 0 || res.added === undefined)) {
          st.ai.guidance = {
            code: "no_suggestions",
            tone: "info",
            message: "MaiK read the paper but did not find matching numbers for this form. Enter them from the Page tab."
          };
        } else {
          st.announce = "MaiK drafted " + count + " unverified suggestion" + (count === 1 ? "" : "s") + ". Review and verify each one before promoting.";
        }
        render(container);
        return;
      }
      st.ai.drafted.suggestions = 1;
      loadExtraction(container, true);
    }

    function handleSuggestError(err) {
      if (mySeq !== seq || st.projectId !== targetPid || st.studyId !== targetSid) return;
      var code = err && err.code;
      var body = (err && err.body) || {};
      if (code === "pdf_not_attached") {
        st.ai.busy = false;
        st.ai.statusText = "";
        st.ai.guidance = {
          code: "pdf_not_attached",
          tone: "info",
          message: "Attach the study PDF on the Page tab first so MaiK can read the numbers and draft suggestions.",
          action: "goto-page",
          actionLabel: "Open Page tab"
        };
        render(container);
        return;
      }
      if (code === "job_failed" || body.jobStatus === "failed" || body.jobStatus === "cancelled") {
        st.ai.busy = false;
        st.ai.statusText = "";
        st.pdfJobStatus = body.jobStatus || "failed";
        st.ai.guidance = {
          code: "job_failed",
          tone: "warn",
          message: "Reading that PDF did not finish. Re-attach the study PDF on the Page tab or enter the numbers yourself.",
          action: "goto-page",
          actionLabel: "Open Page tab"
        };
        render(container);
        return;
      }
      if (code === "job_not_done" || (err && err.status === 409)) {
        var jobId = body.jobId || st.pdfJobId;
        st.pdfJobId = jobId;
        st.pdfJobStatus = body.jobStatus || "running";
        st.ai.statusText = "MaiK is reading the paper";
        render(container);
        waitForPdfJob(container, mySeq, targetPid, targetSid, targetAid, jobId).then(function (outcome) {
          if (mySeq !== seq || st.projectId !== targetPid || st.studyId !== targetSid || outcome.aborted) return;
          if (outcome.timedOut) {
            st.ai.busy = false;
            st.ai.statusText = "";
            st.ai.guidance = {
              code: "job_timeout",
              tone: "warn",
              message: "MaiK is still reading the paper and it is taking longer than usual. Wait a moment and tap Ask MaiK to draft it again, or enter the numbers yourself."
            };
            render(container);
            return;
          }
          if (outcome.failed) {
            st.ai.busy = false;
            st.ai.statusText = "";
            st.ai.guidance = {
              code: "job_failed",
              tone: "warn",
              message: "Reading that PDF did not finish. Re-attach the study PDF on the Page tab or enter the numbers yourself.",
              action: "goto-page",
              actionLabel: "Open Page tab"
            };
            render(container);
            return;
          }
          if (!st.result) {
            SMD.api.request("GET", "/v1/artifacts/" + encodeURIComponent(targetAid) + "/result").then(function (resData) {
              if (mySeq === seq && st.studyId === targetSid) { st.result = resData; render(container); }
            }).catch(function () {});
          }
          st.ai.statusText = "MaiK is drafting suggestions";
          render(container);
          return requestSuggestionsOnce().then(applySuggestionsRes, function (err2) {
            if (mySeq !== seq || st.projectId !== targetPid || st.studyId !== targetSid) return;
            st.ai.busy = false;
            st.ai.statusText = "";
            if (err2 && (err2.code === "job_not_done" || err2.code === "job_failed" || err2.code === "pdf_not_attached")) {
              st.ai.guidance = {
                code: err2.code,
                tone: "warn",
                message: err2.message || "The PDF is not ready yet. Wait a moment and try again."
              };
            } else {
              st.ai.error = err2 || { message: "MaiK could not draft extraction suggestions." };
            }
            render(container);
          });
        }).catch(function (pollErr) {
          if (mySeq !== seq || st.projectId !== targetPid || st.studyId !== targetSid) return;
          st.ai.busy = false;
          st.ai.statusText = "";
          st.ai.error = pollErr;
          render(container);
        });
        return;
      }
      st.ai.busy = false;
      st.ai.statusText = "";
      if (code === "ai_provider_error") {
        st.ai.guidance = {
          code: "ai_provider_error",
          tone: "warn",
          message: "MaiK could not draft suggestions right now. Try again in a moment, or enter the numbers yourself."
        };
      } else {
        st.ai.error = err || { message: "MaiK could not draft extraction suggestions." };
      }
      render(container);
    }

    if (st.pdfJobStatus === "queued" || st.pdfJobStatus === "running") {
      handleSuggestError({ code: "job_not_done", status: 409, body: { jobId: st.pdfJobId, jobStatus: st.pdfJobStatus } });
      return;
    }
    requestSuggestionsOnce().then(applySuggestionsRes, handleSuggestError);
  }

  function onDeviceOcrOn() {
    var OD = G && G.SMD_RMD_ONDEVICE_PDF;
    if (OD && typeof OD.isEnabled === "function") return OD.isEnabled();
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]rmd_ondevice_ocr=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") return localStorage.getItem("smd_rmd_ondevice_ocr") !== "0";
    } catch (e) {}
    return true;
  }

  function isPdfStale(myPdfSeq, targetPid, targetSid) {
    return myPdfSeq !== st.pdfSeq || st.projectId !== targetPid || st.studyId !== targetSid;
  }

  function resetPdfUploadIfCurrent(myPdfSeq) {
    if (myPdfSeq === st.pdfSeq) {
      st.pdfUploading = false;
      st.pdfProgressText = "";
    }
  }

  function jobsRunner() {
    var j = G && G.SMD_RMD_JOBS;
    return (j && typeof j.runWithFallback === "function") ? j : null;
  }

  function devicePrivacyHtml() {
    if (!onDeviceOcrOn()) return "";
    var jr = jobsRunner();
    var line = (jr && jr.DEVICE_PRIVACY_LINE) || "Runs on this device. Your PDFs and patient data are read here and never uploaded. Works offline.";
    return '<p class="rmd-muted rmd-device-privacy" style="font-size:12px;margin-top:6px;">' + esc(line) + '</p>';
  }

  function uploadStudyPdfServer(container, file, fallbackMeta) {
    if (!file || st.pdfUploading || !st.projectId || !st.studyId) return Promise.resolve(null);
    var targetPid = st.projectId;
    var targetSid = st.studyId;
    var myPdfSeq = st.pdfSeq = (st.pdfSeq || 0) + 1;
    var mySeq = seq;
    st.pdfUploading = true;
    st.pdfProgressText = "";
    st.actionError = null;
    render(container);
    var fd = new G.FormData();
    fd.append("file", file, file.name || "study.pdf");
    if (fallbackMeta) {
      fd.append("fallback", JSON.stringify(fallbackMeta));
    }
    return SMD.api.upload("/v1/projects/" + encodeURIComponent(targetPid) + "/pdf-uploads", fd).then(function (res) {
      if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
      var art = res && res.artifact;
      if (!art || !art.id) throw { message: "Could not read the uploaded PDF.", code: "invalid_multipart" };
      st.artifactId = art.id;
      st.pdfJobId = art.jobId || null;
      st.pdfJobStatus = art.status || "queued";
      var fields = {};
      for (var k in st.form) {
        var f = st.form[k];
        fields[k] = { value: f.value === "" ? null : f.value, locator: f.locator, quote: f.quote };
      }
      var ver = st.extraction ? st.extraction.version : 0;
      return SMD.api.request("PUT", "/v1/projects/" + encodeURIComponent(targetPid) + "/studies/" + encodeURIComponent(targetSid) + "/extraction", {
        template: st.template, version: ver, fields: fields, artifactId: art.id
      }).then(function (saved) {
        if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
        st.pdfUploading = false;
        st.pdfProgressText = "";
        st.extraction = saved.extraction;
        if (st.ai) st.ai.guidance = null;
        st.announce = "PDF attached. MaiK is reading the paper.";
        render(container);
        if (st.pdfJobStatus === "succeeded") {
          loadResult(container, art.id);
        } else {
          waitForPdfJob(container, mySeq, targetPid, targetSid, art.id, art.jobId).then(function (out) {
            if (isPdfStale(myPdfSeq, targetPid, targetSid) || out.aborted) return;
            if (out.succeeded) loadResult(container, art.id);
            else render(container);
          });
        }
        return art;
      });
    }).catch(function (err) {
      if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
      st.pdfUploading = false;
      st.pdfProgressText = "";
      st.actionError = err;
      render(container);
    });
  }

  function handleDevicePdfResult(container, file, u8, result, myPdfSeq, targetPid, targetSid, CP) {
    if (!result) { resetPdfUploadIfCurrent(myPdfSeq); return Promise.resolve(); }
    if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return Promise.resolve(); }
    var proj = SMD.store ? SMD.store.getActiveProject() : null;
    var isLocalOnly = !proj || !proj.serverId;
    var clearKey = (result && result.sha256) ? ("pdf:" + targetPid + ":" + result.sha256) : "";
    if (isLocalOnly) {
      var clearP = (CP && clearKey) ? CP.remove(clearKey).catch(function () {}) : Promise.resolve();
      var artId = "local_" + (result.sha256 || Date.now());
      var localKey = "local-artifact:" + targetPid + ":" + (result.sha256 || Date.now());
      var storeP = CP ? CP.put(localKey, {
        studyId: targetSid,
        artifact: {
          id: artId, projectId: targetPid, filename: file.name || "study.pdf",
          sha256: result.sha256, bytes: file.size || u8.byteLength,
          pages: result.pages.length, status: "succeeded", createdTs: Date.now()
        },
        result: result
      }).catch(function () {}) : Promise.resolve();
      return Promise.all([clearP, storeP]).then(function () {
        if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
        st.pdfUploading = false;
        st.pdfProgressText = "";
        st.artifactId = artId;
        st.pdfJobStatus = "succeeded";
        st.result = result;
        st.page = 1;
        st.announce = "PDF read on your phone.";
        render(container);
      });
    }
    return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(targetPid) + "/extractions/device", {
      filename: file.name || "study.pdf",
      sha256: result.sha256,
      bytes: file.size || u8.byteLength,
      result: result
    }).then(function (res) {
      if (CP && clearKey) CP.remove(clearKey).catch(function () {});
      if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
      var art = res && res.artifact;
      if (!art || !art.id) {
        st.pdfUploading = false;
        st.pdfProgressText = "";
        st.actionError = { message: "Could not save the extracted PDF." };
        render(container);
        return;
      }
      st.artifactId = art.id;
      st.pdfJobId = art.jobId || null;
      st.pdfJobStatus = art.status || "succeeded";
      st.result = result;
      st.page = 1;
      var fields = {};
      for (var k in st.form) {
        var f = st.form[k];
        fields[k] = { value: f.value === "" ? null : f.value, locator: f.locator, quote: f.quote };
      }
      var ver = st.extraction ? st.extraction.version : 0;
      return SMD.api.request("PUT", "/v1/projects/" + encodeURIComponent(targetPid) + "/studies/" + encodeURIComponent(targetSid) + "/extraction", {
        template: st.template, version: ver, fields: fields, artifactId: art.id
      }).then(function (saved) {
        if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
        st.pdfUploading = false;
        st.pdfProgressText = "";
        st.extraction = saved.extraction;
        if (st.ai) st.ai.guidance = null;
        st.announce = "PDF read on your phone.";
        render(container);
        loadResult(container, art.id);
      }, function (putErr) {
        if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
        st.pdfUploading = false;
        st.pdfProgressText = "";
        if (putErr && putErr.code === "stale_version" && putErr.current && putErr.current.extraction) {
          st.extraction = putErr.current.extraction;
        }
        st.actionError = putErr;
        render(container);
      });
    }, function (postErr) {
      if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
      st.pdfUploading = false;
      st.pdfProgressText = "";
      st.actionError = postErr;
      render(container);
    });
  }

  function uploadStudyPdf(container, file) {
    if (!file || st.pdfUploading || !st.projectId || !st.studyId) return;
    var OD = G && G.SMD_RMD_ONDEVICE_PDF;
    var CP = G && G.SMD_RMD_CHECKPOINT;
    if (!onDeviceOcrOn() || !OD || typeof OD.extract !== "function" || typeof file.arrayBuffer !== "function") {
      uploadStudyPdfServer(container, file);
      return;
    }
    var targetPid = st.projectId;
    var targetSid = st.studyId;
    var myPdfSeq = st.pdfSeq = (st.pdfSeq || 0) + 1;
    st.pdfUploading = true;
    st.pdfProgressText = "Reading on your phone";
    st.actionError = null;
    render(container);

    file.arrayBuffer().then(function (ab) {
      if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
      var u8 = new Uint8Array(ab);
      return (typeof OD.sha256 === "function" ? OD.sha256(u8) : Promise.resolve(null)).then(function (hash) {
        if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
        var ckKey = hash ? ("pdf:" + targetPid + ":" + hash) : ("pdf:" + targetPid + ":" + targetSid);
        var jr = jobsRunner();
        function mergeCheckpoint(key, patch) {
          if (jr && typeof jr.updateCheckpoint === "function") {
            return jr.updateCheckpoint(CP, key, patch);
          }
          if (!CP || !key || typeof CP.get !== "function" || typeof CP.put !== "function") {
            return Promise.resolve();
          }
          return Promise.resolve().then(function () { return CP.get(key); }).then(function (cur) {
            var next = {};
            if (cur && typeof cur === "object") {
              for (var k in cur) {
                if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
              }
            }
            for (var p in patch) {
              if (Object.prototype.hasOwnProperty.call(patch, p)) next[p] = patch[p];
            }
            return CP.put(key, next);
          }).catch(function () {});
        }
        function runOneExtract(resumeCtx) {
          var resume = (resumeCtx && resumeCtx.checkpoint) || null;
          return OD.extract(u8, {
            sha256: hash,
            resume: resume,
            signal: resumeCtx && resumeCtx.signal,
            /* A background page job paused by the phone is not the phone being slow. */
            onNativeState: function (ns) {
              if (resumeCtx && resumeCtx.holdClock) resumeCtx.holdClock(!!ns && ns.state === "paused");
            },
            onProgress: function (cur, tot) {
              if (resumeCtx && resumeCtx.touchPage) resumeCtx.touchPage();
              if (isPdfStale(myPdfSeq, targetPid, targetSid)) return;
              st.pdfProgressText = "Reading on your phone, page " + cur + " of " + tot;
              var progEl = container.querySelector("#rmdExtractPdfProgress");
              if (progEl) progEl.textContent = st.pdfProgressText;
            },
            onPage: function (partial) {
              if (CP && partial && (partial.sha256 || ckKey)) {
                var key = partial.sha256 ? ("pdf:" + targetPid + ":" + partial.sha256) : ckKey;
                var patch = {
                  pages: partial.pages,
                  ocr: partial.ocr,
                  sha256: partial.sha256,
                  engine: partial.engine,
                  ocrEngine: partial.ocrEngine,
                  partial: partial.partial,
                  nextPage: partial.nextPage,
                  engineVersion: partial.engineVersion,
                  running: true,
                  finished: false
                };
                return mergeCheckpoint(key, patch);
              }
            }
          });
        }

        if (!jr) {
          var resumeP = (CP && ckKey) ? CP.get(ckKey).catch(function () { return null; }) : Promise.resolve(null);
          return resumeP.then(function (saved) {
            return runOneExtract({ checkpoint: saved });
          }).then(function (result) {
            return handleDevicePdfResult(container, file, u8, result, myPdfSeq, targetPid, targetSid, CP);
          });
        }

        return jr.runWithFallback("pdf", runOneExtract, function (cpIgnored, fallbackMeta) {
          st.pdfUploading = false;
          return uploadStudyPdfServer(container, file, fallbackMeta);
        }, {
          jobKey: ckKey,
          projectId: targetPid,
          targetId: targetSid,
          engine: "ondevice:pdf",
          onStatus: function (info) {
            if (isPdfStale(myPdfSeq, targetPid, targetSid)) return;
            if (info && info.state === "retrying" && info.message) {
              st.pdfProgressText = info.message;
              var progEl = container.querySelector("#rmdExtractPdfProgress");
              if (progEl) progEl.textContent = st.pdfProgressText;
            }
          }
        }).then(function (out) {
          if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
          if (out && out.ok && out.source === "device") {
            return handleDevicePdfResult(container, file, u8, out.result, myPdfSeq, targetPid, targetSid, CP);
          }
          if (!out || out.source !== "cloud") {
            st.pdfUploading = false;
            st.pdfProgressText = "";
            if (out && out.message) st.actionError = { message: out.message };
            render(container);
          }
        });
      }).catch(function (err) {
        if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
        st.pdfUploading = false;
        st.pdfProgressText = "";
        st.actionError = err;
        render(container);
      });
    }, function (readErr) {
      if (isPdfStale(myPdfSeq, targetPid, targetSid)) { resetPdfUploadIfCurrent(myPdfSeq); return; }
      st.pdfUploading = false;
      st.pdfProgressText = "";
      st.actionError = readErr || { message: "Could not read this PDF file." };
      render(container);
    });
  }

  function currentPage() { return st.result ? pdf().pageByN(st.result, st.page) : null; }
  function citation() {
    var s = currentStudy();
    return (s && s.label) || "PDF page " + st.page;
  }
  function currentStudy() {
    for (var i = 0; i < st.studies.length; i++) if (st.studies[i].id === st.studyId) return st.studies[i];
    return null;
  }

  /* Capture the page selection into a field as locator + verbatim quote. */
  function captureInto(container, key) {
    var wrap = container.querySelector("#rmdPdfScroll");
    var cap = wrap ? pdf().captureSelection(wrap) : null;
    if (!cap) {
      st.actionError = { kind: "field", code: "no_selection", fieldKey: key, message: "Select text on the Page tab first, then tap Capture quote for " + fieldDef(key).label + ".", action: "goto-page", actionLabel: "Open Page tab" };
      render(container);
      return;
    }
    var f = formFor(key);
    f.locator = pdf().locatorFromCapture(cap, st.artifactId, st.page, citation());
    f.quote = cap.quote;
    st.highlight = cap.box; st.activeField = key; st.actionError = null;
    if (st.invalidField === key) st.invalidField = null;
    st.announce = "Quote captured for " + fieldDef(key).label + " from page " + st.page + ".";
    render(container);
  }

  function saveDraftPayload() {
    var fields = {};
    for (var k in st.form) {
      var f = st.form[k];
      fields[k] = { value: f.value === "" ? null : f.value, locator: f.locator, quote: f.quote };
    }
    return { template: st.template, version: st.extraction.version, fields: fields, artifactId: st.artifactId };
  }

  function saveDraft(container) {
    if (st.busy || !st.extraction) return;
    st.busy = true; st.actionError = null; st.invalidField = null; render(container);
    var mySeq = ++seq;
    var url = "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/extraction";
    SMD.api.request("PUT", url, saveDraftPayload()).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction;
      st.announce = "Draft saved. Values stay unverified until you verify them.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      if (err && err.code === "stale_version" && err.current && err.current.extraction) {
        st.extraction = err.current.extraction;
      }
      st.actionError = err; render(container);
    });
  }

  function verifyField(container, key) {
    if (st.busy || !st.extraction) return;
    var f = formFor(key);
    if (f.value === "" || f.value == null) {
      st.invalidField = key;
      st.actionError = { kind: "field", code: "extraction_unverified", fieldKey: key, message: "Enter a value for " + fieldDef(key).label + " first, or use Correct." };
      render(container);
      focusField(container, key);
      return;
    }
    if (!f.locator || !f.quote) {
      st.invalidField = key;
      st.actionError = { kind: "field", code: "locator_required", fieldKey: key, message: "Verify " + fieldDef(key).label + " first: capture its quote on the Page tab or use Correct.", action: "goto-page", actionLabel: "Open Page tab" };
      render(container);
      focusField(container, key);
      return;
    }
    st.busy = true; st.actionError = null; st.invalidField = null; render(container);
    var mySeq = ++seq;
    var url = "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/extraction";
    var prep = (st.extraction.version === 0 || formHasUnsavedChanges([key]))
      ? SMD.api.request("PUT", url, saveDraftPayload()).then(function (d) { st.extraction = d.extraction; })
      : Promise.resolve();

    prep.then(function () {
      return SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/verify", { fieldKey: key, version: st.extraction.version });
    }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction; syncForm();
      st.announce = fieldDef(key).label + " verified.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function verifyAll(container) {
    if (st.busy || !st.extraction) return;
    var readyKeys = [];
    var fields = templateDef().fields || [];
    for (var i = 0; i < fields.length; i++) {
      var k = fields[i].key;
      var f = formFor(k);
      if (f.value !== "" && f.value != null && f.locator && f.quote) readyKeys.push(k);
    }
    if (!readyKeys.length) {
      var firstKey = firstUnverifiedRequired() || (fields[0] && fields[0].key);
      var lbl = firstKey ? fieldDef(firstKey).label : "a field";
      st.invalidField = firstKey || null;
      st.actionError = { kind: "field", code: "locator_required", fieldKey: firstKey, message: "Verify " + lbl + " first: capture its quote or correct it." };
      render(container);
      if (firstKey) focusField(container, firstKey);
      return;
    }
    st.busy = true; st.actionError = null; st.invalidField = null; render(container);
    var mySeq = ++seq;
    var url = "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/extraction";
    var prep = (st.extraction.version === 0 || formHasUnsavedChanges())
      ? SMD.api.request("PUT", url, saveDraftPayload()).then(function (d) { st.extraction = d.extraction; })
      : Promise.resolve();

    prep.then(function () {
      return SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/verify", { version: st.extraction.version });
    }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction; syncForm();
      st.announce = "All complete fields verified.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function syncForm() {
    var fields = (st.extraction && st.extraction.fields) || {};
    for (var k in fields) {
      st.form[k] = { value: fields[k].value == null ? "" : fields[k].value, locator: fields[k].locator || null, quote: fields[k].quote || "" };
    }
  }

  function focusField(container, key) {
    if (!container || !key) return;
    var inp = container.querySelector("#rmdField_" + key);
    if (inp && inp.focus) { try { inp.focus(); } catch (e) {} }
  }

  function confirmCorrect(container, key) {
    if (st.busy || !st.extraction) return;
    var valEl = container.querySelector("#rmdCorrectValue_" + key);
    var reasonEl = container.querySelector("#rmdCorrectReason_" + key);
    var value = valEl ? valEl.value : "";
    var reason = reasonEl ? reasonEl.value : "";
    if (value === "" || !reason.trim()) {
      st.invalidField = key;
      st.actionError = { kind: "field", code: "invalid_correction", fieldKey: key, message: "Enter a new value and a short reason to save a correction for " + fieldDef(key).label + "." };
      render(container);
      return;
    }
    st.busy = true; st.actionError = null; st.invalidField = null; render(container);
    var mySeq = ++seq;
    var f = formFor(key);
    var url = "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/extraction";
    var prep = st.extraction.version === 0
      ? SMD.api.request("PUT", url, saveDraftPayload()).then(function (d) { st.extraction = d.extraction; })
      : Promise.resolve();

    prep.then(function () {
      return SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/correct", {
        fieldKey: key, value: isNaN(Number(value)) ? value : Number(value), locator: f.locator, quote: f.quote, reason: reason, version: st.extraction.version
      });
    }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction; syncForm(); st.correctFor = null;
      st.announce = "Correction saved with its reason in the audit trail.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function acceptSuggestion(container, sid) {
    if (st.busy || !st.extraction) return;
    st.busy = true; st.actionError = null; st.invalidField = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/suggestions/" + encodeURIComponent(sid) + "/accept", {}).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction; syncForm();
      st.announce = "Suggestion accepted as an unverified value. Verify it before it can reach analysis.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function promote(container) {
    if (st.busy || !st.extraction) return;
    var missingKey = firstUnverifiedRequired();
    if (missingKey) {
      var lbl = fieldDef(missingKey).label;
      st.invalidField = missingKey;
      st.actionError = {
        kind: "field",
        code: "extraction_unverified",
        fieldKey: missingKey,
        message: "Verify " + lbl + " first: capture its quote or correct it.",
        sub: "This required field is unverified, so it cannot reach analysis yet."
      };
      render(container);
      var alertEl = container.querySelector("#rmdExtractActionAlert");
      if (alertEl && alertEl.scrollIntoView) { try { alertEl.scrollIntoView({ block: "nearest" }); } catch (e) {} }
      return;
    }
    st.busy = true; st.actionError = null; st.invalidField = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/promote", { measure: st.promoteMeasure }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.announce = "Verified extraction promoted to a study row (" + data.study.measure + "). It is now eligible for the Run screen.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      if (err && err.body && err.body.fieldKey) st.invalidField = err.body.fieldKey;
      st.actionError = err;
      render(container);
    });
  }

  function loadAudit(container) {
    if (!st.extraction || st.extraction.version === 0) {
      st.audit = []; st.showAudit = true; render(container);
      return;
    }
    var mySeq = ++seq;
    SMD.api.request("GET", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/audit").then(function (data) {
      if (mySeq !== seq) return;
      st.audit = (data && data.events) || []; st.showAudit = true; render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.actionError = err; render(container);
    });
  }

  function showSource(container, key) {
    var f = st.extraction && st.extraction.fields && st.extraction.fields[key];
    var loc = (f && f.locator) || formFor(key).locator;
    if (!loc || !loc.pdf) {
      st.actionError = { kind: "field", code: "no_locator", fieldKey: key, message: "No PDF quote is pinned for " + fieldDef(key).label + " yet. Open the Page tab, select text, and tap Capture quote.", action: "goto-page", actionLabel: "Open Page tab" };
      render(container);
      return;
    }
    st.page = loc.pdf.page; st.highlight = loc.pdf.box || null; st.phoneView = "page";
    render(container);
  }

  /* ---------- render ---------- */

  function statusBadge(status) {
    if (status === "verified") return '<span class="rmd-status-pill rmd-status-verified">Verified</span>';
    if (status === "corrected") return '<span class="rmd-status-pill rmd-status-verified">Corrected</span>';
    return '<span class="rmd-status-pill rmd-status-unverified">Unverified</span>';
  }

  function fieldHtml(key) {
    var def = fieldDef(key);
    var f = formFor(key);
    var status = statusOf(key);
    var isInvalid = st.invalidField === key;
    var errId = "rmdFieldErr_" + key;
    var h = [];
    h.push('<div class="rmd-extract-field" data-rmd-fieldrow="' + esc(key) + '">');
    h.push('<div class="rmd-extract-field-head"><label for="rmdField_' + esc(key) + '">' + esc(def.label) + (def.required ? ' <span class="rmd-req" aria-hidden="true">*</span>' : "") + '</label>' + statusBadge(status) + '</div>');
    h.push('<input type="text" id="rmdField_' + esc(key) + '" data-rmd-field="' + esc(key) + '" value="' + esc(f.value) + '" inputmode="' + (def.type === "text" ? "text" : "decimal") + '" autocomplete="off" aria-invalid="' + (isInvalid ? "true" : "false") + '"' + (isInvalid ? ' aria-describedby="' + esc(errId) + '"' : "") + '>');
    if (isInvalid && st.actionError && st.actionError.message) {
      h.push('<p class="rmd-muted" id="' + esc(errId) + '" style="margin:0;font-size:12.5px;color:var(--rmd-bad)">' + esc(st.actionError.message) + '</p>');
    }
    if (f.quote) {
      h.push('<div class="rmd-quote-block smd-books-keep"><div class="rmd-quote-tag">Quote</div><blockquote>' + esc(f.quote) + '</blockquote>');
      if (f.locator && f.locator.pdf) h.push('<p class="rmd-mono-sm rmd-muted">Page ' + esc(f.locator.pdf.page) + '</p>');
      h.push('</div>');
    } else {
      h.push('<p class="rmd-muted rmd-extract-noquote">No quote yet. Select text on the page and capture it.</p>');
    }
    h.push('<div class="rmd-extract-field-actions">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-capture="' + esc(key) + '">Capture quote</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-source="' + esc(key) + '">Show source</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-verify="' + esc(key) + '"' + (st.busy ? " disabled" : "") + '>Verify</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-correct="' + esc(key) + '">Correct</button>');
    h.push('</div>');
    if (st.correctFor === key) {
      h.push('<div class="rmd-sub-card">');
      h.push('<div class="rmd-field"><label for="rmdCorrectValue_' + esc(key) + '">New value</label><input type="text" id="rmdCorrectValue_' + esc(key) + '" value="' + esc(f.value) + '"></div>');
      h.push('<div class="rmd-field"><label for="rmdCorrectReason_' + esc(key) + '">Reason (required)</label><input type="text" id="rmdCorrectReason_' + esc(key) + '" placeholder="Why the value changes"></div>');
      h.push('<div class="rmd-extract-field-actions"><button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-correct-confirm="' + esc(key) + '">Save correction</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-correct-cancel="' + esc(key) + '">Cancel</button></div>');
      h.push('</div>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function aiBarHtml() {
    var ai = st.ai || makeAiState();
    var noPdf = !st.artifactId;
    var btnLabel = noPdf ? "Ask MaiK to draft it" : "Ask MaiK to draft it";
    var h = '<div class="rmd-ai-bar">';
    h += '<div class="rmd-ai-actions">';
    h += '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-ai="ask" style="min-height:44px"' + (ai.busy ? " disabled" : "") + '><span class="rmd-ai-mark" aria-hidden="true">' + (G.SMD_RMD_MARK ? G.SMD_RMD_MARK.svg(14) : "R") + '</span>' + esc(btnLabel) + '</button>';
    h += '<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-ai="manual" style="min-height:44px">Do it myself</button>';
    h += '</div>';
    if (noPdf) {
      h += '<p class="rmd-ai-cost">Attach the study PDF on the Page tab first to let MaiK draft from it.</p>';
    } else {
      h += '<p class="rmd-ai-cost">Costs about 2 MaiK tokens</p>';
    }
    if (ai.busy) {
      h += '<progress aria-label="' + esc(ai.statusText || "MaiK is reading the paper") + '" style="width:100%;height:6px"></progress>';
      h += '<p class="rmd-ai-progress" role="status" aria-live="polite">' + esc(ai.statusText || "MaiK is reading the paper") + '&#8230;</p>';
    }
    if (ai.guidance) {
      h += formatActionBanner({ kind: "guidance", code: ai.guidance.code, tone: ai.guidance.tone, message: ai.guidance.message, action: ai.guidance.action, actionLabel: ai.guidance.actionLabel });
    }
    if (ai.error) {
      h += formatActionBanner(ai.error);
    }
    h += '</div>';
    return h;
  }

  function suggestionsHtml() {
    var sugg = (st.extraction && st.extraction.suggestions) || [];
    if (!sugg.length) return "";
    var h = ['<div class="rmd-section-block"><h4 class="rmd-section-label">AI suggestions</h4>'];
    if (st.ai && SMD.ai && SMD.ai.noteHtml) h.push(SMD.ai.noteHtml(st.ai, "suggestions"));
    h.push('<p class="rmd-muted">Suggestions are unverified. Accepting one never verifies it; a human must verify before analysis.</p>');
    for (var i = 0; i < sugg.length; i++) {
      var s = sugg[i];
      h.push('<div class="rmd-suggestion" data-rmd-suggestion="' + esc(s.id) + '">');
      h.push('<div class="rmd-suggestion-head"><span class="rmd-badge rmd-badge-neutral">Suggestion</span><span class="rmd-muted">' + esc(fieldDef(s.fieldKey).label) + '</span></div>');
      h.push('<div class="rmd-suggestion-val">' + esc(s.value) + '</div>');
      if (s.quote) h.push('<div class="rmd-quote-block smd-books-keep"><blockquote>' + esc(s.quote) + '</blockquote></div>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-accept="' + esc(s.id) + '"' + (st.busy ? " disabled" : "") + '>Accept</button>');
      h.push('</div>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function auditHtml() {
    if (!st.showAudit) return "";
    var h = ['<div class="rmd-section-block"><h4 class="rmd-section-label">Correction audit</h4>'];
    if (!st.audit.length) h.push('<p class="rmd-muted">No audit events yet.</p>');
    for (var i = 0; i < st.audit.length; i++) {
      var e = st.audit[i];
      h.push('<div class="rmd-audit-row">');
      h.push('<span class="rmd-badge rmd-badge-soft">' + esc(e.kind) + '</span>');
      if (e.fieldKey) h.push('<span>' + esc(fieldDef(e.fieldKey).label) + '</span>');
      if (e.kind === "corrected") h.push('<span class="rmd-mono-sm">' + esc(e.old) + ' &rarr; ' + esc(e["new"]) + '</span>');
      if (e.reason) h.push('<span class="rmd-muted">' + esc(e.reason) + '</span>');
      h.push('<span class="rmd-muted">' + esc(e.by) + ' · ' + esc(p2().fmtTs(e.ts)) + '</span>');
      h.push('</div>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function renderFormPane() {
    var h = [];
    h.push('<div class="rmd-pane-left rmd-extract-form' + (st.phoneView !== "form" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-pane-header"><div class="rmd-extract-selects">');
    h.push('<div class="rmd-field"><label for="rmdExtractStudy">Study</label><select id="rmdExtractStudy">');
    for (var i = 0; i < st.studies.length; i++) h.push('<option value="' + esc(st.studies[i].id) + '"' + (st.studies[i].id === st.studyId ? " selected" : "") + '>' + esc(st.studies[i].label || st.studies[i].id) + '</option>');
    h.push('</select></div>');
    h.push('<div class="rmd-field"><label for="rmdExtractTemplate">Form</label><select id="rmdExtractTemplate">');
    for (var t = 0; t < st.templates.length; t++) h.push('<option value="' + esc(st.templates[t].id) + '"' + (st.templates[t].id === st.template ? " selected" : "") + '>' + esc(st.templates[t].label) + '</option>');
    h.push('</select></div></div></div>');

    h.push('<div class="rmd-extract-form-body">');
    if (st.extractionLoading) h.push(p2().loadingHtml("Loading extraction"));
    if (st.actionError) h.push(formatActionBanner(st.actionError));
    if (st.announce) h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');

    if (st.extraction) {
      var proj = SMD.store ? SMD.store.getActiveProject() : null;
      var role = (proj && proj.role) || "owner";
      var canEdit = role === "owner" || role === "editor" || role === "analyst";
      if (canEdit) {
        if (!st.ai) st.ai = makeAiState();
        h.push(aiBarHtml());
      }
      var fields = templateDef().fields || [];
      for (var f = 0; f < fields.length; f++) h.push(fieldHtml(fields[f].key));
      h.push(suggestionsHtml());
      h.push('<div class="rmd-extract-field-actions rmd-extract-save-row">');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="extract-save"' + (st.busy ? " disabled" : "") + '>Save draft</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="extract-verify-all"' + (st.busy ? " disabled" : "") + '>Verify all</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="extract-audit">Audit</button>');
      h.push('</div>');
      h.push(auditHtml());
      h.push('<div class="rmd-sub-card"><h4 class="rmd-section-label">Promote to study</h4>');
      h.push('<p class="rmd-muted">Only verified fields reach analysis. Promote writes the engine-ready study row.</p>');
      h.push('<div class="rmd-field"><label for="rmdPromoteMeasure">Measure</label><select id="rmdPromoteMeasure">');
      var measures = templateDef().measures || ["RR"];
      for (var m = 0; m < measures.length; m++) h.push('<option value="' + measures[m] + '"' + (st.promoteMeasure === measures[m] ? " selected" : "") + '>' + measures[m] + '</option>');
      h.push('</select></div>');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="extract-promote"' + (st.busy ? " disabled" : "") + '>Promote verified extraction</button>');
      h.push('</div>');
    }
    h.push('</div></div>');
    return h.join("\n");
  }

  function renderPagePane(canEdit) {
    var page = currentPage();
    var pageCount = st.result ? (st.result.pages || []).length : 0;
    var h = [];
    h.push('<div class="rmd-pane-right rmd-extract-page' + (st.phoneView !== "page" ? " rmd-phone-hidden" : "") + '">');
    if (!st.artifactId) {
      h.push('<div class="rmd-empty-state"><h3>No PDF attached</h3><p>This study has no full-text PDF yet. Attach one to extract values with a locator and ask MaiK to draft suggestions.</p>');
      if (canEdit) {
        h.push('<input type="file" id="rmdExtractPdfFile" accept="application/pdf,.pdf" aria-label="Choose study PDF" style="max-width:280px">');
        h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="extract-upload-pdf" style="min-height:44px"' + (st.pdfUploading ? " disabled" : "") + '>' + (st.pdfUploading ? "Attaching PDF..." : "Attach study PDF") + '</button>');
        if (st.pdfUploading && st.pdfProgressText) {
          h.push('<p class="rmd-muted" id="rmdExtractPdfProgress" role="status" aria-live="polite">' + esc(st.pdfProgressText) + '</p>');
        }
        h.push(devicePrivacyHtml());
      }
      h.push('</div>');
    } else if (st.pdfJobStatus === "queued" || st.pdfJobStatus === "running") {
      h.push('<div class="rmd-empty-state"><h3>MaiK is reading the paper</h3><p role="status" aria-live="polite">Extracting pages and text from the study PDF. This page updates automatically when reading finishes.</p><progress aria-label="MaiK is reading the paper" style="width:220px;max-width:100%"></progress></div>');
    } else if (st.pdfJobStatus === "failed" || st.pdfJobStatus === "cancelled") {
      h.push('<div class="rmd-empty-state"><h3>PDF reading did not finish</h3><p>Attach the study PDF again to extract its text and page locators.</p>');
      if (canEdit) {
        h.push('<input type="file" id="rmdExtractPdfFile" accept="application/pdf,.pdf" aria-label="Choose study PDF" style="max-width:280px">');
        h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="extract-upload-pdf" style="min-height:44px"' + (st.pdfUploading ? " disabled" : "") + '>' + (st.pdfUploading ? "Attaching PDF..." : "Attach study PDF") + '</button>');
        if (st.pdfUploading && st.pdfProgressText) {
          h.push('<p class="rmd-muted" id="rmdExtractPdfProgress" role="status" aria-live="polite">' + esc(st.pdfProgressText) + '</p>');
        }
        h.push(devicePrivacyHtml());
      }
      h.push('</div>');
    } else if (!st.result) {
      h.push(p2().loadingHtml("Loading page text"));
    } else if (page) {
      h.push('<div class="rmd-pdf-controls">');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pdf-prev"' + (st.page <= 1 ? " disabled" : "") + '>Prev</button>');
      h.push('<span class="rmd-pdf-pageind">Page <input type="number" id="rmdPdfPage" min="1" max="' + pageCount + '" value="' + st.page + '" aria-label="Page number"> of ' + pageCount + '</span>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pdf-next"' + (st.page >= pageCount ? " disabled" : "") + '>Next</button>');
      h.push('</div>');
      if (page.ocr) h.push('<div class="rmd-banner rmd-banner-warn rmd-pdf-ocr">OCR page. Check values against the original.</div>');
      h.push('<div class="rmd-pdf-scroll" id="rmdPdfScroll" tabindex="0" aria-label="PDF page ' + st.page + '"></div>');
      h.push('<p class="rmd-muted rmd-pdf-hint">Select text, then use Capture quote on a field to pin its locator and verbatim quote.</p>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to extract data.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var tp = container.querySelector('[data-rmd="to-projects"]');
      if (tp) tp.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (!container.querySelector(".rmd-studies-screen") && !container.querySelector(".rmd-p2-screen")) {
      st.actionError = null;
      st.announce = "";
      st.invalidField = null;
      if (st.ai) {
        st.ai.error = null;
        st.ai.guidance = null;
        st.ai.busy = false;
        st.ai.statusText = "";
      }
    }
    var activePid = project.serverId || project.id;
    if (st.projectId !== activePid) {
      st.projectId = activePid; st.loaded = false; st.loading = false; st.error = null;
      st.studies = []; st.studyId = null; st.extraction = null; st.form = {}; st.result = null;
      st.artifactId = null; st.pdfJobId = null; st.pdfJobStatus = null; st.pdfUploading = false; st.pdfProgressText = ""; st.pdfSeq = (st.pdfSeq || 0) + 1;
      st.page = 1; st.highlight = null; st.announce = ""; st.actionError = null; st.invalidField = null;
      st.showAudit = false; st.audit = []; st.ai = null;
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading extraction") + '</div>';
      load(container);
      return;
    }
    var role = project.role || "owner";
    var canEdit = role === "owner" || role === "editor" || role === "analyst";

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Extraction</h2><span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div></div>');
    if (st.error) h.push('<div style="padding:12px 16px">' + p2().errHtml(st.error, "extract-retry") + '</div>');
    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "form" ? " rmd-seg-active" : "") + '" data-rmd-extract-view="form">Form</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "page" ? " rmd-seg-active" : "") + '" data-rmd-extract-view="page">Page</button>');
    h.push('</div>');
    if (st.loaded && !st.studies.length && !st.loading) {
      h.push('<div class="rmd-empty-state"><h3>No studies to extract</h3><p>Include full-text reports on the Screening screen first.</p></div>');
    } else {
      h.push('<div class="rmd-split-layout">');
      h.push(renderFormPane());
      h.push(renderPagePane(canEdit));
      h.push('</div>');
    }
    h.push('</div>');
    container.innerHTML = h.join("\n");
    bind(container, canEdit);
  }

  function bind(container, canEdit) {
    function on(sel, fn) { var els = container.querySelectorAll(sel); for (var i = 0; i < els.length; i++) els[i].onclick = fn; }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="extract-retry"]', function () { st.loaded = false; render(container); });
    on('[data-rmd="extract-goto-page"]', function () { st.phoneView = "page"; render(container); });

    var viewBtns = container.querySelectorAll("[data-rmd-extract-view]");
    for (var v = 0; v < viewBtns.length; v++) viewBtns[v].onclick = function () { st.phoneView = this.getAttribute("data-rmd-extract-view"); render(container); };

    var studySel = container.querySelector("#rmdExtractStudy");
    if (studySel) studySel.onchange = function () { st.studyId = this.value; st.correctFor = null; st.showAudit = false; st.pdfUploading = false; st.pdfProgressText = ""; st.pdfSeq = (st.pdfSeq || 0) + 1; loadExtraction(container); };
    var tplSel = container.querySelector("#rmdExtractTemplate");
    if (tplSel) tplSel.onchange = function () { st.template = this.value; st.correctFor = null; loadExtraction(container); };

    var inputs = container.querySelectorAll("[data-rmd-field]");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].oninput = function () {
        var fk = this.getAttribute("data-rmd-field");
        formFor(fk).value = this.value;
        if (st.invalidField === fk) {
          st.invalidField = null;
          this.setAttribute("aria-invalid", "false");
        }
      };
    }
    var capBtns = container.querySelectorAll("[data-rmd-capture]");
    for (var c = 0; c < capBtns.length; c++) capBtns[c].onclick = function () { captureInto(container, this.getAttribute("data-rmd-capture")); };
    var srcBtns = container.querySelectorAll("[data-rmd-source]");
    for (var s = 0; s < srcBtns.length; s++) srcBtns[s].onclick = function () { showSource(container, this.getAttribute("data-rmd-source")); };
    var verBtns = container.querySelectorAll("[data-rmd-verify]");
    for (var b = 0; b < verBtns.length; b++) verBtns[b].onclick = function () { verifyField(container, this.getAttribute("data-rmd-verify")); };
    var corBtns = container.querySelectorAll("[data-rmd-correct]");
    for (var d = 0; d < corBtns.length; d++) corBtns[d].onclick = function () { st.correctFor = this.getAttribute("data-rmd-correct"); render(container); };
    var corOk = container.querySelectorAll("[data-rmd-correct-confirm]");
    for (var e = 0; e < corOk.length; e++) corOk[e].onclick = function () { confirmCorrect(container, this.getAttribute("data-rmd-correct-confirm")); };
    var corNo = container.querySelectorAll("[data-rmd-correct-cancel]");
    for (var f = 0; f < corNo.length; f++) corNo[f].onclick = function () { st.correctFor = null; render(container); };
    var accBtns = container.querySelectorAll("[data-rmd-accept]");
    for (var g = 0; g < accBtns.length; g++) accBtns[g].onclick = function () { acceptSuggestion(container, this.getAttribute("data-rmd-accept")); };

    on('[data-rmd="extract-save"]', function () { saveDraft(container); });
    on('[data-rmd="extract-verify-all"]', function () { verifyAll(container); });
    on('[data-rmd="extract-audit"]', function () { if (st.showAudit) { st.showAudit = false; render(container); } else loadAudit(container); });
    on('[data-rmd="extract-promote"]', function () { promote(container); });
    var pm = container.querySelector("#rmdPromoteMeasure");
    if (pm) pm.onchange = function () { st.promoteMeasure = this.value; };

    on('[data-rmd-ai="ask"]', function () { askMaikSuggestions(container); });
    on('[data-rmd-ai="manual"]', function () {
      var firstInp = container.querySelector("[data-rmd-field]");
      if (firstInp && firstInp.focus) firstInp.focus();
    });

    on('[data-rmd="extract-upload-pdf"]', function () {
      var fileInp = container.querySelector("#rmdExtractPdfFile");
      var file = fileInp && fileInp.files && fileInp.files[0];
      if (!file) {
        st.actionError = { kind: "guidance", tone: "info", message: "Choose a PDF file on the Page tab first." };
        render(container);
        return;
      }
      uploadStudyPdf(container, file);
    });

    var wrap = container.querySelector("#rmdPdfScroll");
    var page = currentPage();
    if (wrap && page) pdf().fitPage(wrap, page, st.highlight);
    var pageCount = st.result ? (st.result.pages || []).length : 0;
    function go(n) { if (n < 1 || n > pageCount || n === st.page) return; st.page = n; st.highlight = null; render(container); }
    on('[data-rmd="pdf-prev"]', function () { go(st.page - 1); });
    on('[data-rmd="pdf-next"]', function () { go(st.page + 1); });
    var pi = container.querySelector("#rmdPdfPage");
    if (pi) pi.onchange = function () { go(parseInt(this.value, 10) || 1); };
  }

  SMD.screens.extract = {
    render: render,
    _setPollOptions: function (opts) {
      if (opts && typeof opts.intervalMs === "number") pollCfg.intervalMs = opts.intervalMs;
      if (opts && typeof opts.timeoutMs === "number") pollCfg.timeoutMs = opts.timeoutMs;
    }
  };

})(typeof window !== "undefined" ? window : globalThis);
