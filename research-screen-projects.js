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
  var createBusy = false;
  var startChoice = null;
  var startBusy = false;

  var START_CHOICES = [
    {
      key: "thesis",
      title: "Turn my thesis into a journal paper",
      eg: "Upload your MD/MS/DNB thesis; we shape it into a journal article.",
      studyType: "Thesis to Journal Article",
      defaultTitle: "My journal article",
      firstScreen: "thesis"
    },
    {
      key: "sr",
      title: "Combine many studies into one answer",
      eg: "A systematic review and meta-analysis. Example: does BCG prevent tuberculosis?",
      studyType: "Systematic Review & Meta-Analysis",
      defaultTitle: "My systematic review",
      firstScreen: "studies"
    },
    {
      key: "case",
      title: "Write up an interesting patient",
      eg: "A case report. Example: a rare reaction to a common drug.",
      studyType: "Case Report",
      defaultTitle: "My case report",
      firstScreen: "manuscript"
    },
    {
      key: "trial",
      title: "Plan a clinical trial",
      eg: "A trial protocol. Example: testing a new dressing for burns.",
      studyType: "Randomized Controlled Trial",
      defaultTitle: "My trial protocol",
      firstScreen: "protocol"
    },
    {
      key: "obs",
      title: "Study patient records or a survey",
      eg: "An observational study. Example: outcomes after a new clinic pathway.",
      studyType: "Observational Study",
      defaultTitle: "My observational study",
      firstScreen: "protocol"
    }
  ];

  function createOnServer(payload, onDone, onErr) {
    if (!SMD.api) {
      onErr({ message: "The research API is not available." });
      return;
    }
    SMD.api.request("POST", "/v1/projects", payload).then(function (res) {
      var sp = res && res.project;
      if (!sp || !sp.id) {
        onErr({ message: "The server did not return a project." });
        return;
      }
      var store = SMD.store;
      var proj = store.adoptServerProject ? store.adoptServerProject(sp) : sp;
      onDone(proj);
    }).catch(onErr);
  }

  function bannerHtml(err) {
    if (SMD.p2 && SMD.p2.errHtml) return SMD.p2.errHtml(err);
    var msg = (err && err.message) || "Something went wrong.";
    return '<div class="rmd-banner rmd-banner-error" role="alert"><strong>' + esc(msg) + '</strong></div>';
  }

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
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="start-guided">New here? Start guided</button>');
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
      h.push('    <p>Pick what you want to publish and we will set up the project for you.</p>');
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="start-guided">Start my first project</button>');
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
          h.push('          <span class="rmd-badge rmd-badge-soft">' + esc(p.studyType) + '</span>');
        }
        if (p.practice) {
          h.push('          <span class="rmd-badge rmd-badge-pill">Practice project (on this phone only)</span>');
        } else if (!p.serverId) {
          h.push('          <span class="rmd-badge rmd-badge-pill">On this phone only</span>');
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
        h.push('        <button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd-delete-project="' + esc(p.id) + '">Delete</button>');
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
      h.push('        <div id="rmdProjCreateErr"></div>');
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

        if (createBusy) return false;
        createBusy = true;
        var submitBtn = form.querySelector('[data-rmd="create-project-submit"]');
        var errBox = form.querySelector("#rmdProjCreateErr");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Creating"; }
        if (errBox) errBox.innerHTML = "";
        createOnServer({
          title: title,
          discipline: discInput ? discInput.value : "medicine",
          specialty: specInput ? specInput.value : "",
          studyType: typeInput ? typeInput.value : "",
          researchQuestion: qInput ? qInput.value : ""
        }, function (proj) {
          createBusy = false;
          showCreateModal = false;
          if (SMD.navigate) {
            SMD.navigate("studies", { projectId: proj.id });
          } else {
            renderProjects(container);
          }
        }, function (err) {
          createBusy = false;
          if (errBox) errBox.innerHTML = bannerHtml(err);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Create Project"; }
        });
        return false;
      };
    }

    var guidedBtns = container.querySelectorAll('[data-rmd="start-guided"]');
    for (var g = 0; g < guidedBtns.length; g++) {
      guidedBtns[g].onclick = function () {
        startChoice = null;
        if (SMD.navigate) SMD.navigate("start", {});
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

  function renderStart(container) {
    var h = [];
    h.push('<div class="rmd-start-screen">');
    if (!startChoice) {
      h.push('<h2>What do you want to publish?</h2>');
      h.push('<p class="rmd-screen-subtitle">Pick one. We will set up the project and walk you through it.</p>');
      for (var i = 0; i < START_CHOICES.length; i++) {
        var c = START_CHOICES[i];
        h.push('<button type="button" class="rmd-start-choice" data-rmd-start-choice="' + esc(c.key) + '">' + esc(c.title) + '<span>' + esc(c.eg) + '</span></button>');
      }
      h.push('<button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd="start-back">Back to projects</button>');
    } else {
      h.push('<h2>Name your project</h2>');
      h.push('<p class="rmd-screen-subtitle">' + esc(startChoice.title) + '</p>');
      h.push('<form id="rmdStartForm" class="rmd-form">');
      h.push('  <div class="rmd-field">');
      h.push('    <label for="rmd_start_title">Project title</label>');
      h.push('    <input type="text" id="rmd_start_title" maxlength="180" required autocomplete="off" value="' + esc(startChoice.defaultTitle) + '">');
      h.push('  </div>');
      h.push('  <div id="rmdStartErr"></div>');
      h.push('  <div class="rmd-modal-footer">');
      h.push('    <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="start-back">Back</button>');
      h.push('    <button type="submit" class="rmd-btn rmd-btn-primary" data-rmd="start-create">Create project and start</button>');
      h.push('  </div>');
      h.push('</form>');
    }
    h.push('</div>');
    container.innerHTML = h.join("\n");
    bindStart(container);
  }

  function bindStart(container) {
    var choices = container.querySelectorAll("[data-rmd-start-choice]");
    for (var i = 0; i < choices.length; i++) {
      choices[i].onclick = function () {
        var key = this.getAttribute("data-rmd-start-choice");
        for (var j = 0; j < START_CHOICES.length; j++) {
          if (START_CHOICES[j].key === key) { startChoice = START_CHOICES[j]; break; }
        }
        renderStart(container);
      };
    }
    var backs = container.querySelectorAll('[data-rmd="start-back"]');
    for (var b = 0; b < backs.length; b++) {
      backs[b].onclick = function () {
        if (startChoice) {
          startChoice = null;
          renderStart(container);
        } else if (SMD.navigate) {
          SMD.navigate("projects", {});
        }
      };
    }
    var form = container.querySelector("#rmdStartForm");
    if (form) {
      form.onsubmit = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (startBusy || !startChoice) return false;
        var input = form.querySelector("#rmd_start_title");
        var title = (input ? input.value : "").trim();
        if (!title) {
          if (input) input.focus();
          return false;
        }
        startBusy = true;
        var submitBtn = form.querySelector('[data-rmd="start-create"]');
        var errBox = form.querySelector("#rmdStartErr");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Creating"; }
        if (errBox) errBox.innerHTML = "";
        var choice = startChoice;
        createOnServer({
          title: title,
          discipline: "medicine",
          specialty: "",
          studyType: choice.studyType,
          researchQuestion: ""
        }, function (proj) {
          startBusy = false;
          startChoice = null;
          if (SMD.navigate) SMD.navigate(choice.firstScreen, { projectId: proj.id });
          else renderStart(container);
        }, function (err) {
          startBusy = false;
          if (errBox) errBox.innerHTML = bannerHtml(err);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Create project and start"; }
        });
        return false;
      };
    }
  }

  SMD.screens.projects = {
    render: renderProjects
  };
  SMD.screens.start = {
    render: renderStart
  };

})(typeof window !== "undefined" ? window : globalThis);
