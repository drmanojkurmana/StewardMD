/* StewardMD - ResearchMD Projects Screen (window.SMD_RESEARCH.screens.projects).
 * ES5 only, buildless, mobile-first.
 * Handles project listing, creation, selection, and deletion.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = (SMD.esc) || function (s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  var showCreateModal = false;

  function formatDate(ts) {
    if (!ts) return "";
    try {
      var d = new Date(ts);
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function renderProjects(container) {
    var store = SMD.store;
    if (!store) return;
    var projects = store.getProjects();
    var activeProj = store.getActiveProject();

    var h = [];
    h.push('<div class="rmd-projects-screen">');

    // Header & Action Bar
    h.push('  <div class="rmd-screen-header">');
    h.push('    <div class="rmd-header-titles">');
    h.push('      <h2 class="rmd-screen-title">Research Projects</h2>');
    h.push('      <p class="rmd-screen-subtitle">Systematic reviews, meta-analyses, and evidence syntheses</p>');
    h.push('    </div>');
    h.push('    <div class="rmd-header-actions">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="new-project">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>');
    h.push('        <span>New Project</span>');
    h.push('      </button>');
    h.push('    </div>');
    h.push('  </div>');

    // Project Cards Grid
    if (!projects.length) {
      h.push('  <div class="rmd-empty-state">');
      h.push('    <div class="rmd-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg></div>');
      h.push('    <h3>No research projects yet</h3>');
      h.push('    <p>Create your first project to start synthesizing clinical evidence and running meta-analyses.</p>');
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="new-project">Create a Project</button>');
      h.push('  </div>');
    } else {
      h.push('  <div class="rmd-project-grid">');
      for (var i = 0; i < projects.length; i++) {
        var p = projects[i];
        var studies = store.getStudies(p.id);
        var isActive = activeProj && activeProj.id === p.id;
        var verifiedCount = 0;
        for (var j = 0; j < studies.length; j++) {
          if (studies[j].verified) verifiedCount++;
        }

        h.push('    <div class="rmd-card rmd-project-card' + (isActive ? ' rmd-card-active' : '') + '" data-rmd-project-id="' + esc(p.id) + '">');
        h.push('      <div class="rmd-card-top">');
        h.push('        <div class="rmd-card-badges">');
        if (p.discipline) {
          h.push('          <span class="rmd-badge rmd-badge-pill">' + esc(p.discipline) + '</span>');
        }
        if (p.specialty) {
          h.push('          <span class="rmd-badge rmd-badge-soft">' + esc(p.specialty) + '</span>');
        }
        if (p.studyType) {
          h.push('          <span class="rmd-badge rmd-badge-neutral">' + esc(p.studyType) + '</span>');
        }
        h.push('        </div>');
        h.push('        <span class="rmd-role-tag">' + esc(p.role || "owner") + '</span>');
        h.push('      </div>');

        h.push('      <h3 class="rmd-project-title">' + esc(p.title) + '</h3>');
        if (p.researchQuestion) {
          h.push('      <p class="rmd-project-q">' + esc(p.researchQuestion) + '</p>');
        }

        h.push('      <div class="rmd-project-meta">');
        h.push('        <div class="rmd-meta-item">');
        h.push('          <span class="rmd-meta-val">' + studies.length + '</span>');
        h.push('          <span class="rmd-meta-lbl">studies (' + verifiedCount + ' verified)</span>');
        h.push('        </div>');
        if (p.updatedAt) {
          h.push('        <div class="rmd-meta-date">Updated ' + esc(formatDate(p.updatedAt)) + '</div>');
        }
        h.push('      </div>');

        h.push('      <div class="rmd-card-actions">');
        h.push('        <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-open-project="' + esc(p.id) + '">Open Workspace</button>');
        h.push('        <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-delete-project="' + esc(p.id) + '">Delete</button>');
        h.push('      </div>');
        h.push('    </div>');
      }
      h.push('  </div>');
    }

    // Create Project Modal
    if (showCreateModal) {
      h.push('  <div class="rmd-modal-backdrop" id="rmdProjModal">');
      h.push('    <div class="rmd-modal-card" role="dialog" aria-modal="true" aria-labelledby="rmdNewProjTitle">');
      h.push('      <div class="rmd-modal-header">');
      h.push('        <h3 id="rmdNewProjTitle">Create New Research Project</h3>');
      h.push('        <button type="button" class="rmd-btn-close" data-rmd="create-project-cancel" aria-label="Close dialog">&times;</button>');
      h.push('      </div>');
      h.push('      <form id="rmdNewProjForm" class="rmd-form">');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_proj_title">Project Title <span class="rmd-req">*</span></label>');
      h.push('          <input type="text" id="rmd_proj_title" name="title" maxlength="180" placeholder="e.g. SGLT2 Inhibitors in Heart Failure" required autofocus autocomplete="off">');
      h.push('          <span class="rmd-field-hint">Max 180 characters. Clear, clinical title.</span>');
      h.push('        </div>');
      h.push('        <div class="rmd-form-row">');
      h.push('          <div class="rmd-field">');
      h.push('            <label for="rmd_proj_disc">Discipline</label>');
      h.push('            <select id="rmd_proj_disc" name="discipline">');
      h.push('              <option value="medicine" selected>Medicine</option>');
      h.push('              <option value="surgery">Surgery</option>');
      h.push('              <option value="pediatrics">Pediatrics</option>');
      h.push('              <option value="public_health">Public Health</option>');
      h.push('              <option value="cardiology">Cardiology</option>');
      h.push('              <option value="infectious_disease">Infectious Disease</option>');
      h.push('              <option value="other">Other</option>');
      h.push('            </select>');
      h.push('          </div>');
      h.push('          <div class="rmd-field">');
      h.push('            <label for="rmd_proj_spec">Specialty / Subspecialty</label>');
      h.push('            <input type="text" id="rmd_proj_spec" name="specialty" placeholder="e.g. Cardiology" maxlength="80">');
      h.push('          </div>');
      h.push('        </div>');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_proj_type">Study Design</label>');
      h.push('          <select id="rmd_proj_type" name="studyType">');
      h.push('            <option value="Systematic Review & Meta-Analysis" selected>Systematic Review &amp; Meta-Analysis</option>');
      h.push('            <option value="Randomized Controlled Trials">Randomized Controlled Trials</option>');
      h.push('            <option value="Observational Cohort Synthesis">Observational Cohort Synthesis</option>');
      h.push('            <option value="Diagnostic Accuracy Review">Diagnostic Accuracy Review</option>');
      h.push('          </select>');
      h.push('        </div>');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_proj_q">Research Question (PICO)</label>');
      h.push('          <textarea id="rmd_proj_q" name="researchQuestion" rows="3" maxlength="2000" placeholder="P: Patients with heart failure; I: SGLT2i; C: Placebo or standard care; O: Cardiovascular mortality or hospitalization"></textarea>');
      h.push('        </div>');
      h.push('        <div class="rmd-modal-footer">');
      h.push('          <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="create-project-cancel">Cancel</button>');
      h.push('          <button type="submit" class="rmd-btn rmd-btn-primary" data-rmd="create-project-submit">Create Project</button>');
      h.push('        </div>');
      h.push('      </form>');
      h.push('    </div>');
      h.push('  </div>');
    }

    h.push('</div>');

    container.innerHTML = h.join("\n");
    bindEvents(container);
  }

  function bindEvents(container) {
    var store = SMD.store;
    if (!store) return;

    // Open "New Project" modal
    var newBtns = container.querySelectorAll('[data-rmd="new-project"]');
    for (var i = 0; i < newBtns.length; i++) {
      newBtns[i].onclick = function () {
        showCreateModal = true;
        renderProjects(container);
      };
    }

    // Cancel modal
    var cancelBtns = container.querySelectorAll('[data-rmd="create-project-cancel"]');
    for (var j = 0; j < cancelBtns.length; j++) {
      cancelBtns[j].onclick = function () {
        showCreateModal = false;
        renderProjects(container);
      };
    }

    // Submit new project form
    var form = container.querySelector("#rmdNewProjForm");
    if (form) {
      form.onsubmit = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        var titleInput = form.querySelector("#rmd_proj_title");
        var discInput = form.querySelector("#rmd_proj_disc");
        var specInput = form.querySelector("#rmd_proj_spec");
        var typeInput = form.querySelector("#rmd_proj_type");
        var qInput = form.querySelector("#rmd_proj_q");

        var title = (titleInput ? titleInput.value : "").trim();
        if (!title) {
          if (titleInput) titleInput.focus();
          return false;
        }

        try {
          var proj = store.createProject({
            title: title,
            discipline: discInput ? discInput.value : "medicine",
            specialty: specInput ? specInput.value : "",
            studyType: typeInput ? typeInput.value : "",
            researchQuestion: qInput ? qInput.value : ""
          });
          showCreateModal = false;
          if (SMD.navigate) {
            SMD.navigate("studies", { projectId: proj.id });
          } else {
            renderProjects(container);
          }
        } catch (err) {
          alert(err.message || "Failed to create project");
        }
        return false;
      };
    }

    // Open project
    var openBtns = container.querySelectorAll("[data-rmd-open-project]");
    for (var k = 0; k < openBtns.length; k++) {
      openBtns[k].onclick = function () {
        var pid = this.getAttribute("data-rmd-open-project");
        if (pid) {
          store.setActiveProject(pid);
          if (SMD.navigate) SMD.navigate("studies", { projectId: pid });
        }
      };
    }

    // Delete project
    var delBtns = container.querySelectorAll("[data-rmd-delete-project]");
    for (var m = 0; m < delBtns.length; m++) {
      delBtns[m].onclick = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var pid = this.getAttribute("data-rmd-delete-project");
        if (pid) {
          var proj = store.getProject(pid);
          var confirmText = "Delete project '" + (proj ? proj.title : pid) + "' and all its extracted study data?";
          if (confirm(confirmText)) {
            store.deleteProject(pid);
            renderProjects(container);
          }
        }
      };
    }
  }

  SMD.screens.projects = {
    render: renderProjects
  };

})(typeof window !== "undefined" ? window : globalThis);
