/* StewardMD - ResearchMD IPD Compliance screen (window.SMD_RESEARCH.screens.ipd).
 * ES5 only, buildless, mobile-first. Phase 5C / Phase 6: patient-level data
 * compliance evidence, IPD upload gate, data residency, envelope encryption,
 * and access audit log.
 * Contracts per docs/research/contracts/phase-6/ipd.md.
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

  var st = {
    projectId: null,
    loaded: false,
    loading: false,
    error: null,
    busy: false,
    actionError: null,
    announce: "",
    phoneView: "upload",
    config: null,
    evidence: [],
    datasets: [],
    accessLog: [],
    evidenceFile: null,
    evidenceKind: "irb_approval",
    evidenceTitle: "",
    evidenceJurisdiction: "",
    ipdFile: null
  };
  var seq = 0;

  function isEvidenceApproved() {
    for (var i = 0; i < (st.evidence || []).length; i++) {
      if (st.evidence[i].status === "approved") return true;
    }
    return false;
  }

  function load(container) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);

    Promise.all([
      SMD.api.request("GET", base + "/ipd-config").catch(function () { return { config: null }; }),
      SMD.api.request("GET", base + "/ipd-evidence").catch(function () { return { evidence: [] }; }),
      SMD.api.request("GET", base + "/ipd-datasets").catch(function () { return { datasets: [] }; }),
      SMD.api.request("GET", base + "/ipd-access-log").catch(function () { return { log: [] }; })
    ]).then(function (res) {
      if (mySeq !== seq) return;
      st.config = (res[0] && res[0].config) || null;
      st.evidence = (res[1] && res[1].evidence) || [];
      st.datasets = (res[2] && res[2].datasets) || [];
      st.accessLog = (res[3] && res[3].log) || [];
      st.loading = false;
      st.loaded = true;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.loaded = true;
      st.error = err;
      render(container);
    });
  }

  function uploadEvidence(container) {
    if (st.busy || !st.evidenceFile) return;
    st.busy = true;
    st.actionError = null;
    st.announce = "";
    render(container);

    var mySeq = ++seq;
    var fd = new FormData();
    fd.append("file", st.evidenceFile);
    fd.append("kind", st.evidenceKind || "irb_approval");
    fd.append("title", st.evidenceTitle || st.evidenceFile.name);
    if (st.evidenceJurisdiction) fd.append("jurisdiction", st.evidenceJurisdiction);

    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    SMD.api.upload(base + "/ipd-evidence", fd).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      var evItem = (res && res.evidence) || {
        id: "ev_" + Date.now(),
        kind: st.evidenceKind,
        title: st.evidenceTitle || (st.evidenceFile ? st.evidenceFile.name : "Evidence"),
        jurisdiction: st.evidenceJurisdiction,
        status: "pending",
        createdTs: Date.now()
      };
      st.evidence.unshift(evItem);
      st.evidenceFile = null;
      st.evidenceTitle = "";
      st.announce = "Evidence uploaded. Awaiting project owner approval.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function approveEvidence(container, eid) {
    if (st.busy) return;
    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/ipd-evidence/" + encodeURIComponent(eid) + "/approve", {}).then(function () {
      if (mySeq !== seq) return;
      st.busy = false;
      for (var i = 0; i < st.evidence.length; i++) {
        if (st.evidence[i].id === eid) {
          st.evidence[i].status = "approved";
          st.evidence[i].approvedBy = "owner";
          st.evidence[i].approvedTs = Date.now();
        }
      }
      st.announce = "Evidence approved. IPD upload gate unlocked.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function rejectEvidence(container, eid) {
    if (st.busy) return;
    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/ipd-evidence/" + encodeURIComponent(eid) + "/reject", {}).then(function () {
      if (mySeq !== seq) return;
      st.busy = false;
      for (var i = 0; i < st.evidence.length; i++) {
        if (st.evidence[i].id === eid) {
          st.evidence[i].status = "rejected";
        }
      }
      st.announce = "Evidence rejected.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function saveResidency(container, region) {
    if (st.busy) return;
    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    var body = {
      dataRegion: region,
      jurisdictions: region === "GLOBAL_DEID" ? [] : [region],
      identifiabilityTier: "anonymised_deid",
      attestation: { responsibility: true }
    };
    SMD.api.request("POST", base + "/ipd-config", body).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.config = (res && res.config) || body;
      st.announce = "Data residency pinned to " + region + ".";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function uploadIpdDataset(container) {
    if (st.busy || !st.ipdFile) return;
    if (!isEvidenceApproved()) {
      st.actionError = {
        code: "ipd_gate",
        message: "IPD upload blocked: ethics/IRB compliance evidence must be approved by the project owner before patient-level data can be uploaded."
      };
      render(container);
      return;
    }
    st.busy = true;
    st.actionError = null;
    st.announce = "";
    render(container);

    var mySeq = ++seq;
    var fd = new FormData();
    fd.append("file", st.ipdFile);

    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    SMD.api.upload(base + "/ipd-uploads", fd).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      var ds = (res && res.dataset) || {
        id: "ds_" + Date.now(),
        version: st.datasets.length + 1,
        rowCount: 100,
        bytes: st.ipdFile ? st.ipdFile.size : 1024,
        identifiabilityTier: "anonymised_deid",
        dataRegion: (st.config && st.config.dataRegion) || "GLOBAL_DEID",
        createdTs: Date.now()
      };
      st.datasets.unshift(ds);
      st.ipdFile = null;
      st.announce = "IPD dataset uploaded. Envelope-encrypted at rest (AES-256-GCM).";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  /* ---------- HTML Builders ---------- */

  function leftPaneHtml() {
    var h = [];
    var hideEvidence = st.phoneView !== "evidence" && st.phoneView !== "access-log";
    h.push('<div class="rmd-pane-left rmd-ipd-left' + (hideEvidence ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    /* Evidence Upload Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Compliance Evidence</h3>');
    h.push('<p class="rmd-muted">Upload ethics approval, IRB letter, consent form, or DUA before uploading patient data.</p>');
    h.push('<div class="rmd-field"><label for="rmdEvidenceFile">Evidence document (PDF/PNG/JPG)</label>');
    h.push('<input type="file" id="rmdEvidenceFile" accept=".pdf,.png,.jpg,.jpeg"></div>');

    h.push('<div class="rmd-field"><label for="rmdEvidenceKind">Evidence type</label>');
    h.push('<select id="rmdEvidenceKind">');
    h.push('<option value="irb_approval">IRB / Ethics committee approval</option>');
    h.push('<option value="exemption_waiver">IEC / IRB waiver or exemption</option>');
    h.push('<option value="consent_basis">Participant consent documentation</option>');
    h.push('<option value="dua">Data Use Agreement (DUA)</option>');
    h.push('<option value="baa">Business Associate Agreement (BAA)</option>');
    h.push('<option value="safe_harbor">Safe Harbor de-identification attestation</option>');
    h.push('</select></div>');

    h.push('<div class="rmd-field"><label for="rmdEvidenceTitle">Title or reference</label>');
    h.push('<input type="text" id="rmdEvidenceTitle" placeholder="e.g. IEC Protocol Approval #2026-081" value="' + esc(st.evidenceTitle) + '"></div>');

    h.push('<div class="rmd-field"><label for="rmdEvidenceJurisdiction">Jurisdiction</label>');
    h.push('<select id="rmdEvidenceJurisdiction">');
    h.push('<option value="">Global / Unspecified</option>');
    h.push('<option value="IN">India (ICMR / DPDP)</option>');
    h.push('<option value="EU">European Union (GDPR)</option>');
    h.push('<option value="US">United States (HIPAA)</option>');
    h.push('</select></div>');

    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="upload-evidence"' + (st.busy || !st.evidenceFile ? " disabled" : "") + '>Upload Evidence</button>');
    h.push('</div>');

    /* Evidence List Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Uploaded Evidence (' + st.evidence.length + ')</h3>');
    if (!st.evidence.length) {
      h.push('<p class="rmd-muted">No evidence uploaded yet. Patient data upload is blocked until evidence is approved.</p>');
    } else {
      h.push('<div class="rmd-data-versions">');
      for (var i = 0; i < st.evidence.length; i++) {
        var evItem = st.evidence[i];
        var isApp = evItem.status === "approved";
        var isRej = evItem.status === "rejected";
        var badgeClass = isApp ? "rmd-badge-pill" : (isRej ? "rmd-badge-neutral" : "rmd-badge-soft");
        h.push('<div class="rmd-row-btn" style="cursor:default">');
        h.push('<div style="display:flex;justify-content:space-between;align-items:center;width:100%">');
        h.push('<span class="rmd-row-title">' + esc(evItem.title || evItem.kind) + '</span>');
        h.push('<span class="rmd-badge ' + badgeClass + '">' + esc(evItem.status || "pending") + '</span>');
        h.push('</div>');
        h.push('<span class="rmd-row-meta">Type: ' + esc(evItem.kind) + (evItem.jurisdiction ? " · " + esc(evItem.jurisdiction) : "") + '</span>');
        if (!isApp) {
          h.push('<div style="display:flex;gap:6px;margin-top:6px">');
          h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-approve-evidence="' + esc(evItem.id) + '"' + (st.busy ? " disabled" : "") + '>Approve</button>');
          if (!isRej) {
            h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-reject-evidence="' + esc(evItem.id) + '"' + (st.busy ? " disabled" : "") + '>Reject</button>');
          }
          h.push('</div>');
        }
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    /* Access Audit Log Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">IPD Access Log</h3>');
    h.push('<p class="rmd-muted">Immutable audit log. Every IPD read, upload, and analysis action is recorded.</p>');
    if (!st.accessLog.length) {
      h.push('<p class="rmd-muted">No IPD access events recorded yet.</p>');
    } else {
      h.push('<div class="rmd-data-checks" role="table" aria-label="IPD Access Log">');
      for (var a = 0; a < st.accessLog.length; a++) {
        var log = st.accessLog[a];
        h.push('<div class="rmd-data-check" role="row">');
        h.push('<span class="rmd-badge rmd-badge-pill">' + esc(log.action) + '</span>');
        h.push('<span class="rmd-mono-sm">' + esc(log.result) + '</span>');
        h.push('<span class="rmd-muted">' + (log.ts ? p2().fmtTs(log.ts) : "") + '</span>');
        h.push('<span class="rmd-data-check-msg">user: ' + esc(log.userId || "self") + (log.ipHash ? " · ip:" + esc(log.ipHash) : "") + '</span>');
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function rightPaneHtml() {
    var h = [];
    var hideUpload = st.phoneView !== "upload";
    h.push('<div class="rmd-pane-right rmd-ipd-right' + (hideUpload ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    /* Data Residency Card */
    var region = (st.config && st.config.dataRegion) || "GLOBAL_DEID";
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">Data Residency</h3>');
    h.push('<span class="rmd-badge rmd-badge-soft" id="rmdResidencyBadge">' + esc(region) + '</span></div>');
    h.push('<p class="rmd-muted">Data residency pins patient-level storage and worker compute to the designated jurisdiction.</p>');
    h.push('<div class="rmd-form-row">');
    h.push('<div class="rmd-field"><label for="rmdResidencySelect">Residency region</label>');
    h.push('<select id="rmdResidencySelect">');
    h.push('<option value="GLOBAL_DEID"' + (region === "GLOBAL_DEID" ? " selected" : "") + '>GLOBAL_DEID (De-identified global)</option>');
    h.push('<option value="IN"' + (region === "IN" ? " selected" : "") + '>IN (India - DPDP / ICMR)</option>');
    h.push('<option value="EU"' + (region === "EU" ? " selected" : "") + '>EU (European Union - GDPR)</option>');
    h.push('<option value="US"' + (region === "US" ? " selected" : "") + '>US (United States - HIPAA)</option>');
    h.push('</select></div>');
    h.push('<div style="display:flex;align-items:flex-end">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="set-residency"' + (st.busy ? " disabled" : "") + '>Pin Residency</button>');
    h.push('</div></div>');
    h.push('</div>');

    /* IPD Upload Gate Card */
    var approved = isEvidenceApproved();
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">Patient-Level Dataset Upload</h3>');
    h.push('<span class="rmd-badge ' + (approved ? "rmd-badge-pill" : "rmd-badge-neutral") + '" id="rmdGateStatusPill">' + (approved ? "Gate Unlocked" : "Gate Blocked") + '</span></div>');

    if (!approved) {
      h.push('<div class="rmd-banner rmd-banner-warn" role="alert" id="rmdIpdGateBanner">');
      h.push('<strong>IPD upload blocked</strong>');
      h.push('<span>Compliance evidence (ethics/IRB approval or consent basis) must be approved by the project owner before patient-level data can be uploaded.</span>');
      h.push('</div>');
    } else {
      h.push('<div class="rmd-banner rmd-banner-info" role="status" id="rmdIpdGateBanner">');
      h.push('<strong>IPD gate unlocked</strong>');
      h.push('<span>Compliance evidence approved. Uploaded datasets are envelope-encrypted at rest and strictly isolated from LLM prompts.</span>');
      h.push('</div>');
    }

    h.push('<div class="rmd-field"><label for="rmdIpdFile">Patient-level CSV file</label>');
    h.push('<input type="file" id="rmdIpdFile" accept=".csv,text/csv"></div>');

    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="ipd-upload"' + (st.busy || !st.ipdFile || !approved ? " disabled" : "") + '>Upload IPD Dataset</button>');
    h.push('</div>');

    /* Datasets List */
    if (st.datasets.length) {
      h.push('<div class="rmd-card">');
      h.push('<h3 class="rmd-card-heading">Encrypted Datasets (' + st.datasets.length + ')</h3>');
      h.push('<div class="rmd-data-versions">');
      for (var d = 0; d < st.datasets.length; d++) {
        var ds = st.datasets[d];
        h.push('<div class="rmd-row-btn" style="cursor:default">');
        h.push('<div style="display:flex;justify-content:space-between;align-items:center;width:100%">');
        h.push('<span class="rmd-row-title">Version ' + ds.version + '</span>');
        h.push('<span class="rmd-badge rmd-badge-pill">Encrypted (AES-GCM)</span>');
        h.push('</div>');
        h.push('<span class="rmd-row-meta">' + ds.rowCount + ' rows · ' + ds.bytes + ' bytes · region: ' + esc(ds.dataRegion || "GLOBAL_DEID") + '</span>');
        h.push('</div>');
      }
      h.push('</div>');
      h.push('</div>');
    }

    h.push('</div></div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to manage IPD compliance.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var tp = container.querySelector('[data-rmd="to-projects"]');
      if (tp) tp.onclick = function () { SMD.navigate("projects"); };
      return;
    }

    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.loaded = false;
      st.loading = false;
      st.error = null;
      st.config = null;
      st.evidence = [];
      st.datasets = [];
      st.accessLog = [];
      st.evidenceFile = null;
      st.ipdFile = null;
      st.announce = "";
      st.actionError = null;
    }

    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading IPD compliance") + '</div>';
      load(container);
      return;
    }

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">IPD Compliance</h2><span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div></div>');

    if (st.actionError) h.push('<div style="padding:10px 16px">' + p2().errHtml(st.actionError, null) + '</div>');
    if (st.announce) h.push('<div style="padding:10px 16px"><div class="rmd-banner rmd-banner-info" role="status" aria-live="polite">' + esc(st.announce) + '</div></div>');

    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "upload" ? " rmd-seg-active" : "") + '" data-rmd-ipd-view="upload">Upload</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "evidence" ? " rmd-seg-active" : "") + '" data-rmd-ipd-view="evidence">Evidence</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "access-log" ? " rmd-seg-active" : "") + '" data-rmd-ipd-view="access-log">Access Log</button>');
    h.push('</div>');

    h.push('<div class="rmd-split-layout">');
    h.push(leftPaneHtml());
    h.push(rightPaneHtml());
    h.push('</div></div>');

    container.innerHTML = h.join("\n");
    bind(container);
  }

  function bind(container) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }

    var viewBtns = container.querySelectorAll("[data-rmd-ipd-view]");
    for (var v = 0; v < viewBtns.length; v++) {
      viewBtns[v].onclick = function () {
        st.phoneView = this.getAttribute("data-rmd-ipd-view");
        render(container);
      };
    }

    var evFileInput = container.querySelector("#rmdEvidenceFile");
    if (evFileInput) {
      evFileInput.onchange = function () {
        st.evidenceFile = (this.files && this.files[0]) || null;
        render(container);
      };
    }

    var evKindSel = container.querySelector("#rmdEvidenceKind");
    if (evKindSel) {
      evKindSel.onchange = function () { st.evidenceKind = this.value; };
    }

    var evTitleInput = container.querySelector("#rmdEvidenceTitle");
    if (evTitleInput) {
      evTitleInput.oninput = function () { st.evidenceTitle = this.value; };
    }

    var evJurSel = container.querySelector("#rmdEvidenceJurisdiction");
    if (evJurSel) {
      evJurSel.onchange = function () { st.evidenceJurisdiction = this.value; };
    }

    on('[data-rmd="upload-evidence"]', function () { uploadEvidence(container); });

    var appBtns = container.querySelectorAll("[data-rmd-approve-evidence]");
    for (var a = 0; a < appBtns.length; a++) {
      appBtns[a].onclick = function () {
        var id = this.getAttribute("data-rmd-approve-evidence");
        if (id) approveEvidence(container, id);
      };
    }

    var rejBtns = container.querySelectorAll("[data-rmd-reject-evidence]");
    for (var r = 0; r < rejBtns.length; r++) {
      rejBtns[r].onclick = function () {
        var id = this.getAttribute("data-rmd-reject-evidence");
        if (id) rejectEvidence(container, id);
      };
    }

    var ipdFileInput = container.querySelector("#rmdIpdFile");
    if (ipdFileInput) {
      ipdFileInput.onchange = function () {
        st.ipdFile = (this.files && this.files[0]) || null;
        render(container);
      };
    }

    on('[data-rmd="ipd-upload"]', function () { uploadIpdDataset(container); });

    on('[data-rmd="set-residency"]', function () {
      var sel = container.querySelector("#rmdResidencySelect");
      if (sel) saveResidency(container, sel.value);
    });
  }

  SMD.screens.ipd = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
