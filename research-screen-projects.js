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
      key: "masterchart",
      title: "Analyse my thesis data (master chart)",
      eg: "Upload your Excel master chart; we pick the right tests and write Table 1 and the results",
      studyType: "Original Study (Master Chart)",
      defaultTitle: "My master chart study",
      firstScreen: "masterchart"
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
      firstScreen: "casefile"
    },
    {
      key: "case-series",
      title: "Case series (a few patients with the same condition)",
      eg: "A few patients with the same condition. Example: five cases of zinc phosphide poisoning.",
      studyType: "Case series",
      defaultTitle: "My case series",
      firstScreen: "casefile"
    },
    {
      key: "case-control",
      title: "Compare people with a condition and people without it",
      eg: "A case-control study. Example: diet in people who had a heart attack and people who did not.",
      studyType: "Case-control study",
      defaultTitle: "My case-control study",
      firstScreen: "plan"
    },
    {
      key: "cohort",
      title: "Follow a group of patients over time",
      eg: "A cohort study. Example: kidney function a year after a new clinic pathway.",
      studyType: "Cohort study",
      defaultTitle: "My cohort study",
      firstScreen: "plan"
    },
    {
      key: "trial",
      title: "Plan a clinical trial",
      eg: "A trial protocol. Example: testing a new dressing for burns.",
      studyType: "Randomized Controlled Trial",
      defaultTitle: "My trial protocol",
      firstScreen: "plan"
    },
    {
      key: "obs",
      title: "Study patient records or a survey",
      eg: "An observational study. Example: outcomes after a new clinic pathway.",
      studyType: "Observational Study",
      defaultTitle: "My observational study",
      firstScreen: "plan"
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
    h.push('      <p class="rmd-screen-subtitle">Case reports, clinical trials, cohorts, master charts, theses, and systematic reviews</p>');
    h.push('    </div>');
    h.push('    <div class="rmd-header-actions">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="start-guided">New here? Start guided</button>');
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="new-project">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>');
    h.push('        <span>New Project</span>');
    h.push('      </button>');
    h.push('    </div>');
    h.push('  </div>');

    // Interactive Tutorials Hub across every study design
    var tut = SMD.tutorial;
    if (tut && tut.EXAMPLES && tut.EXAMPLES.length) {
      h.push('  <div class="rmd-tut-hub" data-rmd="tut-hub">');
      h.push('    <div class="rmd-tut-hub-head">');
      h.push('      <div>');
      h.push('        <h3 style="margin:0;font:700 16px var(--rmd-f);color:var(--rmd-ink);">Interactive Tutorials: Learn Any Study Scratch to Published</h3>');
      h.push('        <p class="rmd-muted" style="margin:3px 0 0;font-size:13px;">Try a real worked example first (0 MaiK tokens). Practice by clicking and entering yourself or tap Enter &amp; Show Me.</p>');
      h.push('      </div>');
      var globalDef = tut.isTutorialDefault ? tut.isTutorialDefault("") : true;
      h.push('      <label class="rmd-tut-def"><input type="checkbox" data-rmd-tut-global-def="1"' + (globalDef ? ' checked' : '') + '> Recommend tutorials by default</label>');
      h.push('    </div>');
      h.push('    <div class="rmd-tut-grid">');
      for (var ti = 0; ti < tut.EXAMPLES.length; ti++) {
        var ex = tut.EXAMPLES[ti];
        var done = tut.isCompleted && tut.isCompleted(ex.key);
        h.push('      <div class="rmd-tut-card">');
        h.push('        <div>');
        h.push('          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px;">');
        h.push('            <span class="rmd-badge rmd-badge-soft">' + esc(ex.checklistLabel) + '</span>');
        if (done) h.push('            <span class="rmd-badge rmd-badge-pill" style="background:var(--rmd-acc);color:#fff;">Published</span>');
        else if (tut.isTutorialDefault && tut.isTutorialDefault(ex.key)) h.push('            <span class="rmd-badge rmd-badge-pill">Default Tutorial</span>');
        h.push('          </div>');
        h.push('          <h4 class="rmd-tut-card-title">' + esc(ex.label) + '</h4>');
        h.push('          <p class="rmd-tut-card-eg">' + esc(ex.exampleBlurb) + '</p>');
        h.push('        </div>');
        h.push('        <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-tut-launch="' + esc(ex.key) + '">' + (done ? 'Replay Example' : 'Try Example Tutorial') + '</button>');
        h.push('      </div>');
      }
      h.push('    </div>');
      h.push('  </div>');
    }

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
        } else if (p.tutorial) {
          h.push('          <span class="rmd-badge rmd-badge-pill" style="background:var(--rmd-acc);color:#fff;">Interactive Tutorial · 0 tokens</span>');
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
      h.push('            <option value="Systematic Review & Meta-Analysis" selected>Systematic Review &amp; Meta-Analysis (PRISMA)</option>');
      h.push('            <option value="Case Report">Case Report (CARE)</option>');
      h.push('            <option value="Case Series">Case Series (CARE)</option>');
      h.push('            <option value="Cohort study">Cohort Study (STROBE)</option>');
      h.push('            <option value="Case-Control study">Case-Control Study (STROBE)</option>');
      h.push('            <option value="Randomized Controlled Trial">Randomized Controlled Trial (CONSORT)</option>');
      h.push('            <option value="Cross-Sectional / Master Chart Study">Original Study / Master Chart (STROBE)</option>');
      h.push('            <option value="Thesis to Journal Article">Thesis to Journal Article</option>');
      h.push('            <option value="Randomized Controlled Trials">Randomized Controlled Trials Review</option>');
      h.push('            <option value="Observational Cohort Synthesis">Observational Cohort Synthesis</option>');
      h.push('            <option value="Diagnostic Accuracy Review">Diagnostic Accuracy Review (STARD)</option>');
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
          var first = (SMD.journeyFor ? SMD.journeyFor(proj)[0] : "studies") || "studies";
          if (SMD.navigate) {
            SMD.navigate(first, { projectId: proj.id });
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

    var tutLaunchBtns = container.querySelectorAll("[data-rmd-tut-launch]");
    for (var tl = 0; tl < tutLaunchBtns.length; tl++) {
      tutLaunchBtns[tl].onclick = function () {
        var key = this.getAttribute("data-rmd-tut-launch");
        if (key && SMD.tutorial && SMD.tutorial.startTutorial) {
          SMD.tutorial.startTutorial(key, { reset: true });
        }
      };
    }
    var tutGlobalChk = container.querySelector('[data-rmd-tut-global-def]');
    if (tutGlobalChk && SMD.tutorial && SMD.tutorial.setTutorialDefault) {
      tutGlobalChk.onchange = function () {
        SMD.tutorial.setTutorialDefault("", !!this.checked);
        renderProjects(container);
      };
    }

    // Open project
    var openBtns = container.querySelectorAll("[data-rmd-open-project]");
    for (var k = 0; k < openBtns.length; k++) {
      openBtns[k].onclick = function () {
        var pid = this.getAttribute("data-rmd-open-project");
        if (pid) {
          store.setActiveProject(pid);
          var openProj = store.getProject ? store.getProject(pid) : null;
          var firstScreen = (SMD.journeyFor ? SMD.journeyFor(openProj)[0] : "studies") || "studies";
          if (SMD.navigate) SMD.navigate(firstScreen, { projectId: pid });
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

  function renderStart(container, params) {
    if (params && params.studyKey) {
      for (var sk = 0; sk < START_CHOICES.length; sk++) {
        if (START_CHOICES[sk].key === params.studyKey) { startChoice = START_CHOICES[sk]; break; }
      }
    }
    var tut = SMD.tutorial;
    var h = [];
    h.push('<div class="rmd-start-screen">');
    if (!startChoice) {
      h.push('<h2>What do you want to publish?</h2>');
      h.push('<p class="rmd-screen-subtitle">Pick one. Every design includes an interactive scratch-to-published example tutorial by default, or you can skip straight to a blank project.</p>');
      for (var i = 0; i < START_CHOICES.length; i++) {
        var c = START_CHOICES[i];
        var defOn = tut && tut.isTutorialDefault ? tut.isTutorialDefault(c.key) : true;
        h.push('<button type="button" class="rmd-start-choice" data-rmd-start-choice="' + esc(c.key) + '">' + esc(c.title) + '<span>' + esc(c.eg) + (defOn ? ' (Example tutorial included)' : '') + '</span></button>');
      }
      h.push('<button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd="start-back">Back to projects</button>');
    } else {
      h.push('<h2>Name your project</h2>');
      h.push('<p class="rmd-screen-subtitle">' + esc(startChoice.title) + '</p>');
      if (tut && tut.exampleByKey) {
        var ex = tut.exampleByKey(startChoice.key);
        var isDef = tut.isTutorialDefault ? tut.isTutorialDefault(startChoice.key) : true;
        if (ex) {
          h.push('<div class="rmd-start-tut-box" data-rmd="start-tut-box">');
          h.push('  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">');
          h.push('    <strong style="font-size:14px;color:var(--rmd-ink);">Try Worked Example Tutorial First' + (isDef ? ' (Default)' : '') + '</strong>');
          h.push('    <span class="rmd-badge rmd-badge-soft">0 MaiK tokens · Scratch to Published</span>');
          h.push('  </div>');
          h.push('  <p class="rmd-muted" style="margin:0;font-size:12.5px;">Practice with our real example (' + esc(ex.shortTitle) + ') where we ask you to click, enter, or tap Enter &amp; Show Me all the way to Published.</p>');
          h.push('  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">');
          h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="start-tut-launch">Try Example Tutorial</button>');
          h.push('    <label class="rmd-tut-def"><input type="checkbox" data-rmd="start-tut-def"' + (isDef ? ' checked' : '') + '> Default for ' + esc(ex.label) + '</label>');
          h.push('  </div>');
          h.push('</div>');
        }
      }
      h.push('<form id="rmdStartForm" class="rmd-form">');
      h.push('  <div class="rmd-field">');
      h.push('    <label for="rmd_start_title">Or skip tutorial and name your own project</label>');
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
    var tutLaunch = container.querySelector('[data-rmd="start-tut-launch"]');
    if (tutLaunch && startChoice) {
      tutLaunch.onclick = function () {
        var key = startChoice.key;
        startChoice = null;
        if (SMD.tutorial && SMD.tutorial.startTutorial) {
          SMD.tutorial.startTutorial(key, { reset: true });
        }
      };
    }
    var tutDefChk = container.querySelector('[data-rmd="start-tut-def"]');
    if (tutDefChk && startChoice && SMD.tutorial && SMD.tutorial.setTutorialDefault) {
      tutDefChk.onchange = function () {
        SMD.tutorial.setTutorialDefault(startChoice.key, !!this.checked);
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
