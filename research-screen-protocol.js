/* StewardMD - ResearchMD Protocol Screen (window.SMD_RESEARCH.screens.protocol).
 * ES5 only, buildless, mobile-first. Phase 2.1: PICO/PECO builder, eligibility,
 * outcomes, time points, subgroups, version list, one-way lock with hash,
 * PROSPERO-field export. Contracts: docs/research/contracts/phase-2/schemas/protocol-*.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  var st = {
    projectId: null,
    loaded: false,
    loading: false,
    error: null,
    protocol: null,
    versions: [],
    viewedVersion: null,
    viewedProtocol: null,
    framework: "PICO",
    draft: null,
    editing: false,
    startingNew: false,
    showLockConfirm: false,
    busy: false,
    announce: ""
  };
  var seq = 0;

  function p2() { return SMD.p2 || {}; }

  function emptyDraft() {
    return {
      title: "",
      population: "",
      intervention: "",
      comparison: "",
      outcome: "",
      eligibility: [""],
      primary: "",
      secondary: [],
      timePoints: [],
      subgroups: []
    };
  }

  function draftFromContent(title, content) {
    var c = content || {};
    var pico = c.pico || {};
    var out = c.outcomes || {};
    return {
      title: title || (c.prospero && c.prospero.reviewTitle) || "",
      population: pico.population || "",
      intervention: pico.intervention || "",
      comparison: pico.comparison || "",
      outcome: pico.outcome || "",
      eligibility: (c.eligibility && c.eligibility.length) ? c.eligibility.slice() : [""],
      primary: out.primary || "",
      secondary: (out.secondary || []).slice(),
      timePoints: (out.timePoints || []).slice(),
      subgroups: (c.subgroups || []).slice()
    };
  }

  function cleanList(arr) {
    var out = [];
    for (var i = 0; i < (arr || []).length; i++) {
      var v = String(arr[i] == null ? "" : arr[i]).trim();
      if (v) out.push(v);
    }
    return out;
  }

  function buildContent(draft, existing) {
    var prospero = {};
    var old = (existing && existing.prospero) || {};
    for (var k in old) {
      if (k !== "framework" && Object.prototype.hasOwnProperty.call(old, k)) prospero[k] = old[k];
    }
    prospero.framework = st.framework;
    if (draft.title.trim()) prospero.reviewTitle = draft.title.trim();
    var content = {
      pico: {
        population: draft.population.trim(),
        intervention: draft.intervention.trim(),
        comparison: draft.comparison.trim(),
        outcome: draft.outcome.trim()
      },
      eligibility: cleanList(draft.eligibility),
      outcomes: {
        primary: draft.primary.trim(),
        secondary: cleanList(draft.secondary),
        timePoints: cleanList(draft.timePoints)
      },
      subgroups: cleanList(draft.subgroups),
      prospero: prospero
    };
    return content;
  }

  function validateDraft(draft) {
    var missing = [];
    if (!draft.population.trim()) missing.push("Population");
    if (!draft.intervention.trim()) missing.push(st.framework === "PECO" ? "Exposure" : "Intervention");
    if (!draft.outcome.trim()) missing.push("Outcome");
    if (!draft.primary.trim()) missing.push("Primary outcome");
    if (!cleanList(draft.eligibility).length) missing.push("At least one eligibility criterion");
    return missing;
  }

  function load(container) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var pid = st.projectId;
    SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(pid) + "/protocols?limit=100").then(function (data) {
      if (mySeq !== seq) return;
      var list = (data && data.protocols) || [];
      // Group versions by protocol id; work on the most recently created
      // protocol (a locked one is replaced by "Start New Protocol").
      var byId = {};
      var i;
      for (i = 0; i < list.length; i++) {
        var row = list[i];
        if (!byId[row.id]) byId[row.id] = [];
        byId[row.id].push(row);
      }
      var newestId = null;
      var newestTs = -1;
      for (var pidKey in byId) {
        if (!Object.prototype.hasOwnProperty.call(byId, pidKey)) continue;
        for (i = 0; i < byId[pidKey].length; i++) {
          if ((byId[pidKey][i].createdTs || 0) > newestTs) {
            newestTs = byId[pidKey][i].createdTs || 0;
            newestId = pidKey;
          }
        }
      }
      var group = newestId ? byId[newestId] : [];
      group.sort(function (a, b) { return (b.version || 0) - (a.version || 0); });
      st.versions = group;
      if (!group.length) {
        st.protocol = null;
        st.loaded = true;
        st.loading = false;
        render(container);
        return;
      }
      return SMD.api.request("GET", "/v1/protocols/" + encodeURIComponent(newestId)).then(function (one) {
        if (mySeq !== seq) return;
        st.protocol = (one && one.protocol) || group[0];
        st.framework = (st.protocol.content && st.protocol.content.prospero && st.protocol.content.prospero.framework) === "PECO" ? "PECO" : "PICO";
        st.loaded = true;
        st.loading = false;
        render(container);
      });
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.loaded = true;
      st.error = err;
      render(container);
    });
  }

  function reload(container) {
    st.loaded = false;
    st.viewedVersion = null;
    st.viewedProtocol = null;
    render(container);
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to build its protocol.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var toP = container.querySelector('[data-rmd="to-projects"]');
      if (toP) toP.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.loaded = false;
      st.loading = false;
      st.error = null;
      st.protocol = null;
      st.versions = [];
      st.viewedVersion = null;
      st.viewedProtocol = null;
      st.draft = null;
      st.editing = false;
      st.startingNew = false;
      st.showLockConfirm = false;
      st.busy = false;
      st.announce = "";
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading protocol") + '</div>';
      load(container);
      return;
    }

    var role = project.role || "owner";
    var canEdit = role === "owner" || role === "editor";
    var canLock = role === "owner";
    var proto = st.viewedProtocol || st.protocol;
    var isLocked = proto && proto.status === "locked";
    var h = [];

    h.push('<div class="rmd-p2-screen">');
    h.push('<div class="rmd-screen-header">');
    h.push('<div><h2 class="rmd-screen-title">Protocol</h2>');
    h.push('<p class="rmd-screen-subtitle">' + esc(project.title) + '</p></div>');
    if (proto) {
      h.push('<div class="rmd-card-badges">');
      h.push('<span class="rmd-version-tag">v' + (proto.version || 1) + '</span>');
      h.push(isLocked
        ? '<span class="rmd-badge rmd-badge-pill">Locked</span>'
        : '<span class="rmd-badge rmd-badge-soft">Draft</span>');
      h.push('</div>');
    }
    h.push('</div>');

    if (st.announce) {
      h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');
    }
    if (st.error) h.push(p2().errHtml(st.error, "proto-retry"));
    if (st.loading) h.push(p2().loadingHtml("Loading protocol"));

    if (st.viewedVersion != null && st.viewedProtocol) {
      h.push('<div class="rmd-banner rmd-banner-warn">Viewing version ' + st.viewedVersion + ' (read-only).');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="proto-back-latest">Back to Latest Version</button></div>');
    }

    if (!proto && !st.editing && st.loaded) {
      h.push('<div class="rmd-empty-state">');
      h.push('<h3>No protocol yet</h3>');
      h.push('<p>Define the question, eligibility and outcomes before any screening. The protocol is locked with a timestamped hash once it is final.</p>');
      if (canEdit) h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="proto-create">Create Protocol</button>');
      else h.push('<p class="rmd-muted">Only an owner or editor can create the protocol.</p>');
      h.push('</div>');
    }

    if (st.editing && st.draft) {
      h.push(renderForm(canEdit));
    } else if (proto) {
      h.push(renderView(proto, canEdit, canLock));
    }

    if (st.versions.length) {
      h.push(renderVersions(proto));
    }

    if (st.showLockConfirm && proto) {
      h.push(renderLockConfirm(proto));
    }

    h.push('</div>');
    container.innerHTML = h.join("\n");
    bindEvents(container, project);
  }

  function fieldListHtml(label, key, items, placeholder, max) {
    var h = [];
    h.push('<div class="rmd-field">');
    h.push('<label>' + esc(label) + '</label>');
    h.push('<div class="rmd-field-list">');
    for (var i = 0; i < items.length; i++) {
      h.push('<div class="rmd-field-list-row">');
      h.push('<input type="text" data-rmd-list="' + key + '" data-rmd-idx="' + i + '" maxlength="' + max + '" value="' + esc(items[i]) + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(label) + ' ' + (i + 1) + '" autocomplete="off">');
      h.push('<button type="button" class="rmd-icon-btn rmd-icon-danger" data-rmd-remove="' + key + '" data-rmd-idx="' + i + '" aria-label="Remove ' + esc(label) + ' ' + (i + 1) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>');
      h.push('</div>');
    }
    h.push('</div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-add="' + key + '">Add</button>');
    h.push('</div>');
    return h.join("\n");
  }

  function renderForm(canEdit) {
    var d = st.draft;
    var peco = st.framework === "PECO";
    var h = [];
    h.push('<div class="rmd-form-card">');
    h.push('<div class="rmd-detail-header"><h3 class="rmd-detail-title">' + (st.protocol && !st.startingNew ? "Edit Protocol (saves as v" + ((st.protocol.version || 1) + 1) + ")" : "New Protocol") + '</h3>');
    h.push('<button type="button" class="rmd-btn-close" data-rmd="proto-cancel" aria-label="Cancel editing">&times;</button></div>');
    h.push('<form id="rmdProtoForm" class="rmd-form">');

    h.push('<div class="rmd-field"><label for="rmd_proto_title">Review Title</label>');
    h.push('<input type="text" id="rmd_proto_title" maxlength="240" value="' + esc(d.title) + '" placeholder="e.g. BCG vaccination for tuberculosis prevention…" autocomplete="off"></div>');

    h.push('<div class="rmd-field"><span class="rmd-section-label">Question Framework</span>');
    h.push('<div class="rmd-filter-tabs" role="group" aria-label="Question framework">');
    h.push('<button type="button" class="rmd-chip' + (!peco ? " rmd-chip-active" : "") + '" data-rmd-framework="PICO">PICO (intervention)</button>');
    h.push('<button type="button" class="rmd-chip' + (peco ? " rmd-chip-active" : "") + '" data-rmd-framework="PECO">PECO (exposure)</button>');
    h.push('</div></div>');

    h.push('<div class="rmd-field"><label for="rmd_proto_pop">Population <span class="rmd-req">*</span></label>');
    h.push('<textarea id="rmd_proto_pop" data-rmd-pico="population" rows="2" maxlength="2000" placeholder="e.g. Adults with latent tuberculosis infection…">' + esc(d.population) + '</textarea></div>');
    h.push('<div class="rmd-field"><label for="rmd_proto_int">' + (peco ? "Exposure" : "Intervention") + ' <span class="rmd-req">*</span></label>');
    h.push('<textarea id="rmd_proto_int" data-rmd-pico="intervention" rows="2" maxlength="2000" placeholder="' + (peco ? "e.g. Occupational silica dust exposure…" : "e.g. BCG vaccination at birth…") + '">' + esc(d.intervention) + '</textarea></div>');
    h.push('<div class="rmd-field"><label for="rmd_proto_cmp">' + (peco ? "Comparator (unexposed)" : "Comparison") + '</label>');
    h.push('<textarea id="rmd_proto_cmp" data-rmd-pico="comparison" rows="2" maxlength="2000" placeholder="e.g. No vaccination or placebo…">' + esc(d.comparison) + '</textarea></div>');
    h.push('<div class="rmd-field"><label for="rmd_proto_out">Outcome <span class="rmd-req">*</span></label>');
    h.push('<textarea id="rmd_proto_out" data-rmd-pico="outcome" rows="2" maxlength="2000" placeholder="e.g. Incidence of active tuberculosis…">' + esc(d.outcome) + '</textarea></div>');

    h.push(fieldListHtml("Eligibility Criteria *", "eligibility", d.eligibility, "e.g. Randomized or quasi-randomized trials…", 500));

    h.push('<div class="rmd-field"><label for="rmd_proto_primary">Primary Outcome <span class="rmd-req">*</span></label>');
    h.push('<input type="text" id="rmd_proto_primary" data-rmd-out="primary" maxlength="500" value="' + esc(d.primary) + '" placeholder="e.g. Confirmed tuberculosis at any follow-up…" autocomplete="off"></div>');
    h.push(fieldListHtml("Secondary Outcomes", "secondary", d.secondary, "e.g. All-cause mortality…", 500));
    h.push(fieldListHtml("Time Points", "timePoints", d.timePoints, "e.g. 12 months…", 200));
    h.push(fieldListHtml("Planned Subgroups", "subgroups", d.subgroups, "e.g. Age under 5 years…", 500));

    h.push('<div class="rmd-modal-footer">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="proto-cancel">Cancel</button>');
    if (canEdit) {
      h.push('<button type="submit" class="rmd-btn rmd-btn-primary" data-rmd="proto-save"' + (st.busy ? " disabled" : "") + '>' + (st.busy ? "Saving…" : (st.protocol && !st.startingNew ? "Save as Version " + ((st.protocol.version || 1) + 1) : "Create Draft Protocol")) + '</button>');
    }
    h.push('</div>');
    h.push('</form></div>');
    return h.join("\n");
  }

  function renderView(proto, canEdit, canLock) {
    var c = proto.content || {};
    var pico = c.pico || {};
    var out = c.outcomes || {};
    var peco = c.prospero && c.prospero.framework === "PECO";
    var locked = proto.status === "locked";
    var h = [];

    if (locked) {
      h.push('<div class="rmd-lock-box">');
      h.push('<strong>Locked ' + esc(p2().fmtTs(proto.lockedAt)) + '</strong>');
      h.push('<span>This version cannot be edited. Screening uses this exact content. To change anything, create a new protocol.</span>');
      h.push('<span class="rmd-lock-hash" translate="no">Hash: ' + esc(proto.lockHash || "") + '</span>');
      h.push('</div>');
    }

    h.push('<div class="rmd-card">');
    var reviewTitle = (c.prospero && c.prospero.reviewTitle) || "";
    if (reviewTitle) h.push('<h3 class="rmd-card-heading">' + esc(reviewTitle) + '</h3>');
    h.push('<dl class="rmd-proto-view">');
    h.push('<dt>Framework</dt><dd>' + (peco ? "PECO (exposure)" : "PICO (intervention)") + '</dd>');
    h.push('<dt>Population</dt><dd>' + esc(pico.population || "") + '</dd>');
    h.push('<dt>' + (peco ? "Exposure" : "Intervention") + '</dt><dd>' + esc(pico.intervention || "") + '</dd>');
    h.push('<dt>' + (peco ? "Comparator" : "Comparison") + '</dt><dd>' + esc(pico.comparison || "Not specified") + '</dd>');
    h.push('<dt>Outcome</dt><dd>' + esc(pico.outcome || "") + '</dd>');
    h.push('<dt>Eligibility</dt><dd><ul>');
    var elig = c.eligibility || [];
    for (var i = 0; i < elig.length; i++) h.push('<li>' + esc(elig[i]) + '</li>');
    h.push('</ul></dd>');
    h.push('<dt>Primary Outcome</dt><dd>' + esc(out.primary || "") + '</dd>');
    if (out.secondary && out.secondary.length) {
      h.push('<dt>Secondary Outcomes</dt><dd><ul>');
      for (var s = 0; s < out.secondary.length; s++) h.push('<li>' + esc(out.secondary[s]) + '</li>');
      h.push('</ul></dd>');
    }
    if (out.timePoints && out.timePoints.length) {
      h.push('<dt>Time Points</dt><dd>' + esc(out.timePoints.join("; ")) + '</dd>');
    }
    if (c.subgroups && c.subgroups.length) {
      h.push('<dt>Planned Subgroups</dt><dd><ul>');
      for (var g = 0; g < c.subgroups.length; g++) h.push('<li>' + esc(c.subgroups[g]) + '</li>');
      h.push('</ul></dd>');
    }
    h.push('</dl>');

    if (st.viewedVersion == null) {
      h.push('<div class="rmd-card-actions">');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="proto-prospero">Export PROSPERO Fields</button>');
      if (!locked && canEdit) {
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="proto-edit">Edit &amp; Save New Version</button>');
      }
      if (!locked && canLock) {
        h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="proto-lock">Lock Protocol</button>');
      }
      if (locked && canEdit) {
        h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="proto-create">Start New Protocol</button>');
      }
      h.push('</div>');
      if (!locked && !canEdit) {
        h.push('<p class="rmd-muted">Only an owner or editor can edit or lock the protocol.</p>');
      }
    }
    h.push('</div>');
    return h.join("\n");
  }

  function renderVersions(proto) {
    var h = [];
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Version History</h3>');
    h.push('<div role="list">');
    for (var i = 0; i < st.versions.length; i++) {
      var v = st.versions[i];
      var current = proto && v.version === proto.version && st.viewedVersion == null;
      h.push('<button type="button" class="rmd-row-btn' + (current ? " rmd-row-selected" : "") + '" data-rmd-version="' + v.version + '" role="listitem">');
      h.push('<span class="rmd-row-title">Version ' + v.version + (v.status === "locked" ? " (locked)" : " (draft)") + '</span>');
      h.push('<span class="rmd-row-meta">' + esc(p2().fmtTs(v.createdTs)) + (v.lockHash ? ' <span class="rmd-mono-sm" translate="no">' + esc(String(v.lockHash).slice(0, 12)) + '…</span>' : "") + '</span>');
      h.push('</button>');
    }
    h.push('</div></div>');
    return h.join("\n");
  }

  function renderLockConfirm(proto) {
    var h = [];
    h.push('<div class="rmd-modal-backdrop" id="rmdLockModal">');
    h.push('<div class="rmd-modal-card" role="dialog" aria-modal="true" aria-labelledby="rmdLockTitle">');
    h.push('<div class="rmd-modal-header rmd-modal-warn"><h3 id="rmdLockTitle">Lock Protocol Version ' + (proto.version || 1) + '?</h3>');
    h.push('<button type="button" class="rmd-btn-close" data-rmd="proto-lock-cancel" aria-label="Close dialog">&times;</button></div>');
    h.push('<p><strong>The protocol cannot be edited after locking.</strong> Screening will use this exact version. A timestamped hash of the content is stored for audit, and any later write to this version is rejected.</p>');
    h.push('<p class="rmd-muted">To change the question, eligibility or outcomes later, create a new protocol. Locking is one-way.</p>');
    h.push('<div class="rmd-modal-footer">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="proto-lock-cancel">Cancel</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="proto-lock-confirm"' + (st.busy ? " disabled" : "") + '>' + (st.busy ? "Locking…" : "Lock Version " + (proto.version || 1)) + '</button>');
    h.push('</div></div></div>');
    return h.join("\n");
  }

  function exportProspero(proto, project) {
    var c = proto.content || {};
    var pico = c.pico || {};
    var out = c.outcomes || {};
    var peco = c.prospero && c.prospero.framework === "PECO";
    var lines = [];
    lines.push("PROSPERO registration fields (exported from ResearchMD)");
    lines.push("Project: " + (project ? project.title : proto.projectId));
    lines.push("Protocol version: " + (proto.version || 1) + " (" + proto.status + ")");
    if (proto.lockHash) lines.push("Lock hash: " + proto.lockHash);
    if (proto.lockedAt) lines.push("Locked at: " + new Date(proto.lockedAt).toISOString());
    lines.push("Review title: " + ((c.prospero && c.prospero.reviewTitle) || ""));
    lines.push("Framework: " + (peco ? "PECO" : "PICO"));
    lines.push("Review question: In " + (pico.population || "[population]") + ", does " + (pico.intervention || "[intervention/exposure]") +
      (pico.comparison ? " compared with " + pico.comparison : "") + " affect " + (pico.outcome || "[outcome]") + "?");
    lines.push("Participants/population: " + (pico.population || ""));
    lines.push(peco ? "Exposure(s): " + (pico.intervention || "") : "Intervention(s): " + (pico.intervention || ""));
    lines.push("Comparator/control: " + (pico.comparison || "Not specified"));
    lines.push("Main outcome(s): " + (out.primary || ""));
    lines.push("Additional outcomes: " + ((out.secondary || []).join("; ") || "None"));
    lines.push("Timing/time points: " + ((out.timePoints || []).join("; ") || "Not specified"));
    lines.push("Eligibility criteria:");
    var elig = c.eligibility || [];
    for (var i = 0; i < elig.length; i++) lines.push("  " + (i + 1) + ". " + elig[i]);
    lines.push("Planned subgroups: " + ((c.subgroups || []).join("; ") || "None"));
    var text = lines.join("\n") + "\n";
    p2().downloadText("prospero-" + proto.projectId + "-v" + (proto.version || 1) + ".txt", text, "text/plain");
    return text;
  }

  function saveDraft(container, project) {
    var d = st.draft;
    var missing = validateDraft(d);
    if (missing.length) {
      st.error = { message: "Required before saving: " + missing.join(", ") + ".", code: "invalid_protocol" };
      render(container);
      return;
    }
    st.busy = true;
    st.error = null;
    render(container);
    var mySeq = ++seq;
    var content = buildContent(d, st.protocol ? st.protocol.content : null);
    var req;
    if (st.protocol && !st.startingNew) {
      req = SMD.api.request("POST", "/v1/protocols/" + encodeURIComponent(st.protocol.id) + "/versions", {
        content: content,
        baseVersion: st.protocol.version || 1
      });
    } else {
      req = SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(project.id) + "/protocols", {
        title: d.title.trim() || undefined,
        content: content
      });
    }
    req.then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.protocol = data.protocol;
      st.editing = false;
      st.startingNew = false;
      st.draft = null;
      st.announce = "Saved protocol version " + (data.protocol.version || 1) + " as a draft.";
      st.loaded = false;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.error = err;
      if (err.code === "stale_version" || err.code === "protocol_locked") {
        st.editing = false;
        st.startingNew = false;
        st.draft = null;
        st.loaded = false;
      }
      render(container);
    });
  }

  function lockProtocol(container, project) {
    if (!st.protocol) return;
    st.busy = true;
    render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/protocols/" + encodeURIComponent(st.protocol.id) + "/lock", {}).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.protocol = data.protocol;
      st.showLockConfirm = false;
      st.announce = "Protocol locked. Hash and timestamp are stored; this version can no longer be edited.";
      st.loaded = false;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.error = err;
      st.showLockConfirm = false;
      render(container);
    });
  }

  function bindEvents(container, project) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="proto-retry"]', function () { reload(container); });
    on('[data-rmd="proto-create"]', function () {
      st.draft = emptyDraft();
      st.editing = true;
      st.startingNew = true;
      st.announce = "";
      st.viewedVersion = null;
      st.viewedProtocol = null;
      render(container);
    });
    on('[data-rmd="proto-edit"]', function () {
      st.draft = draftFromContent(st.protocol.content && st.protocol.content.title, st.protocol.content);
      st.editing = true;
      st.startingNew = false;
      st.announce = "";
      render(container);
    });
    on('[data-rmd="proto-cancel"]', function () {
      st.editing = false;
      st.startingNew = false;
      st.draft = null;
      st.error = null;
      render(container);
    });
    on('[data-rmd="proto-lock"]', function () {
      st.showLockConfirm = true;
      render(container);
    });
    on('[data-rmd="proto-lock-cancel"]', function () {
      st.showLockConfirm = false;
      render(container);
    });
    on('[data-rmd="proto-lock-confirm"]', function () { lockProtocol(container, project); });
    on('[data-rmd="proto-prospero"]', function () {
      var proto = st.viewedProtocol || st.protocol;
      if (proto) exportProspero(proto, project);
    });
    on('[data-rmd="proto-back-latest"]', function () {
      st.viewedVersion = null;
      st.viewedProtocol = null;
      render(container);
    });

    var versionBtns = container.querySelectorAll("[data-rmd-version]");
    for (var v = 0; v < versionBtns.length; v++) {
      versionBtns[v].onclick = function () {
        var ver = parseInt(this.getAttribute("data-rmd-version"), 10);
        if (!st.protocol || ver === st.protocol.version) {
          st.viewedVersion = null;
          st.viewedProtocol = null;
          render(container);
          return;
        }
        var mySeq = ++seq;
        SMD.api.request("GET", "/v1/protocols/" + encodeURIComponent(st.protocol.id) + "?version=" + ver).then(function (data) {
          if (mySeq !== seq) return;
          st.viewedVersion = ver;
          st.viewedProtocol = data.protocol;
          st.editing = false;
          render(container);
        }).catch(function (err) {
          if (mySeq !== seq) return;
          st.error = err;
          render(container);
        });
      };
    }

    var fwBtns = container.querySelectorAll("[data-rmd-framework]");
    for (var f = 0; f < fwBtns.length; f++) {
      fwBtns[f].onclick = function () {
        st.framework = this.getAttribute("data-rmd-framework");
        render(container);
      };
    }

    var form = container.querySelector("#rmdProtoForm");
    if (form) {
      form.onsubmit = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        saveDraft(container, project);
        return false;
      };
      var titleInput = form.querySelector("#rmd_proto_title");
      if (titleInput) titleInput.oninput = function () { st.draft.title = this.value; };
      var picoFields = form.querySelectorAll("[data-rmd-pico]");
      for (var p = 0; p < picoFields.length; p++) {
        picoFields[p].oninput = function () { st.draft[this.getAttribute("data-rmd-pico")] = this.value; };
      }
      var primary = form.querySelector("[data-rmd-out='primary']");
      if (primary) primary.oninput = function () { st.draft.primary = this.value; };
      var listInputs = form.querySelectorAll("[data-rmd-list]");
      for (var l = 0; l < listInputs.length; l++) {
        listInputs[l].oninput = function () {
          var key = this.getAttribute("data-rmd-list");
          var idx = parseInt(this.getAttribute("data-rmd-idx"), 10);
          st.draft[key][idx] = this.value;
        };
      }
    }

    var addBtns = container.querySelectorAll("[data-rmd-add]");
    for (var a = 0; a < addBtns.length; a++) {
      addBtns[a].onclick = function () {
        var key = this.getAttribute("data-rmd-add");
        if (st.draft[key].length >= 50) return;
        st.draft[key].push("");
        render(container);
        var inputs = container.querySelectorAll('[data-rmd-list="' + key + '"]');
        if (inputs.length) inputs[inputs.length - 1].focus();
      };
    }
    var removeBtns = container.querySelectorAll("[data-rmd-remove]");
    for (var r = 0; r < removeBtns.length; r++) {
      removeBtns[r].onclick = function () {
        var key = this.getAttribute("data-rmd-remove");
        var idx = parseInt(this.getAttribute("data-rmd-idx"), 10);
        st.draft[key].splice(idx, 1);
        if (key === "eligibility" && !st.draft.eligibility.length) st.draft.eligibility.push("");
        render(container);
      };
    }
  }

  SMD.screens.protocol = {
    render: render,
    exportProspero: exportProspero
  };

})(typeof window !== "undefined" ? window : globalThis);