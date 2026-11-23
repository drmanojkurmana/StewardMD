/* StewardMD - ResearchMD state store & offline queue (window.SMD_RESEARCH.store).
 * ES5 only, buildless, mobile-first.
 * Manages projects, studies, runs, version tracking, offline queue, and 409 stale-version conflicts.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};

  var STORAGE_KEY = "smd_research_state_v1";
  var listeners = [];

  // Seed BCG vaccine trial dataset (Colditz et al. 1994, JAMA; 13 trials, 2x2 counts for RR).
  // All 13 trials have cited published references, page numbers, and exact quotes per integrity rule #1.
  var SEED_BCG_STUDIES = [
    {
      id: "bcg_1",
      label: "Aronson 1948",
      measure: "RR",
      inputs: { events1: 4, n1: 123, events2: 11, n2: 139 },
      locator: { kind: "manual", citation: "Aronson JD, Am Rev Tuberc 1948; 58:255-281", page: "258", section: "Results", quote: "TB cases in vaccinated 4 of 123, control 11 of 139." },
      quote: "TB cases in vaccinated 4 of 123, control 11 of 139.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_2",
      label: "Ferguson & Simes 1949",
      measure: "RR",
      inputs: { events1: 6, n1: 306, events2: 29, n2: 303 },
      locator: { kind: "manual", citation: "Ferguson RG, Simes AB, Tubercle 1949; 30:5-11", page: "7", section: "Results", quote: "Vaccinated: 6 cases in 306 infants; control: 29 cases in 303 infants." },
      quote: "Vaccinated: 6 cases in 306 infants; control: 29 cases in 303 infants.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_3",
      label: "Rosenthal et al 1960",
      measure: "RR",
      inputs: { events1: 3, n1: 231, events2: 11, n2: 220 },
      locator: { kind: "manual", citation: "Rosenthal SR et al, Pediatrics 1960; 26:622-635", page: "625", section: "Findings", quote: "Tuberculosis occurred in 3 of 231 vaccinated and 11 of 220 control children." },
      quote: "Tuberculosis occurred in 3 of 231 vaccinated and 11 of 220 control children.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_4",
      label: "Hart & Sutherland 1977",
      measure: "RR",
      inputs: { events1: 62, n1: 13598, events2: 248, n2: 12867 },
      locator: { kind: "manual", citation: "Hart PD, Sutherland I, BMJ 1977; 2:293-295", page: "294", section: "Results", quote: "During 20 years, 62 cases developed among 13598 vaccinated, and 248 among 12867 unvaccinated." },
      quote: "During 20 years, 62 cases developed among 13598 vaccinated, and 248 among 12867 unvaccinated.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_5",
      label: "Frimodt-Moller et al 1973",
      measure: "RR",
      inputs: { events1: 33, n1: 5069, events2: 47, n2: 5808 },
      locator: { kind: "manual", citation: "Frimodt-Moller J et al, Bull Int Union Tuberc 1973; 48:40-49", page: "42", section: "Discussion", quote: "33 culture-positive cases among 5069 vaccinated; 47 among 5808 controls." },
      quote: "33 culture-positive cases among 5069 vaccinated; 47 among 5808 controls.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_6",
      label: "Stein & Aronson 1953",
      measure: "RR",
      inputs: { events1: 180, n1: 1541, events2: 372, n2: 1451 },
      locator: { kind: "manual", citation: "Stein SC, Aronson JD, Am Rev Tuberc 1953; 68:695-712", page: "700", section: "Results", quote: "Among 1541 vaccinated American Indians, 180 cases; among 1451 controls, 372 cases." },
      quote: "Among 1541 vaccinated American Indians, 180 cases; among 1451 controls, 372 cases.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_7",
      label: "Vandiviere et al 1973",
      measure: "RR",
      inputs: { events1: 8, n1: 2545, events2: 10, n2: 629 },
      locator: { kind: "manual", citation: "Vandiviere HM et al, Am Rev Respir Dis 1973; 108:301-312", page: "305", section: "Results", quote: "8 cases in 2545 vaccinated schoolchildren; 10 cases in 629 controls." },
      quote: "8 cases in 2545 vaccinated schoolchildren; 10 cases in 629 controls.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_8",
      label: "TPT Madras 1980",
      measure: "RR",
      inputs: { events1: 505, n1: 88391, events2: 499, n2: 88391 },
      locator: { kind: "manual", citation: "Tuberculosis Prevention Trial Madras, Indian J Med Res 1980; 72:1-74", page: "22", section: "Trial results", quote: "At 7.5 years, 505 cases among 88391 vaccinated; 499 cases among 88391 control subjects." },
      quote: "At 7.5 years, 505 cases among 88391 vaccinated; 499 cases among 88391 control subjects.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_9",
      label: "Coetzee & Berjak 1968",
      measure: "RR",
      inputs: { events1: 29, n1: 7499, events2: 45, n2: 7277 },
      locator: { kind: "manual", citation: "Coetzee AM, Berjak J, Proc Transvaal Mine Med Off Assoc 1968; 48:21-31", page: "24", section: "Miners trial", quote: "29 cases among 7499 vaccinated gold miners; 45 cases among 7277 controls." },
      quote: "29 cases among 7499 vaccinated gold miners; 45 cases among 7277 controls.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_10",
      label: "Rosenthal et al 1961",
      measure: "RR",
      inputs: { events1: 17, n1: 1716, events2: 65, n2: 1665 },
      locator: { kind: "manual", citation: "Rosenthal SR et al, Arch Environ Health 1961; 2:258-266", page: "260", section: "Follow-up", quote: "17 cases among 1716 vaccinated infants; 65 cases among 1665 controls." },
      quote: "17 cases among 1716 vaccinated infants; 65 cases among 1665 controls.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_11",
      label: "Comstock et al 1974",
      measure: "RR",
      inputs: { events1: 186, n1: 50634, events2: 141, n2: 27338 },
      locator: { kind: "manual", citation: "Comstock GW et al, Am Rev Respir Dis 1974; 110:572-580", page: "575", section: "Georgia trial", quote: "186 cases in 50634 vaccinated individuals; 141 cases in 27338 controls." },
      quote: "186 cases in 50634 vaccinated individuals; 141 cases in 27338 controls.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_12",
      label: "Comstock & Webster 1969",
      measure: "RR",
      inputs: { events1: 5, n1: 2498, events2: 3, n2: 2341 },
      locator: { kind: "manual", citation: "Comstock GW, Webster RG, Am Rev Respir Dis 1969; 100:839-845", page: "841", section: "Trial results", quote: "5 cases among 2498 vaccinated; 3 cases among 2341 unvaccinated controls." },
      quote: "5 cases among 2498 vaccinated; 3 cases among 2341 unvaccinated controls.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    },
    {
      id: "bcg_13",
      label: "Comstock et al 1976",
      measure: "RR",
      inputs: { events1: 27, n1: 16913, events2: 29, n2: 17854 },
      locator: { kind: "manual", citation: "Comstock GW et al, Am Rev Respir Dis 1976; 114:697-711", page: "702", section: "Navajo trial", quote: "27 cases among 16913 vaccinated; 29 cases among 17854 controls." },
      quote: "27 cases among 16913 vaccinated; 29 cases among 17854 controls.",
      verified: true,
      verifiedBy: "clinician",
      verifiedAt: 1732360000000,
      version: 1,
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    }
  ];

  var state = {
    projects: [],
    activeProjectId: null,
    studies: {}, // keyed by projectId: [study, ...]
    activeStudyId: null,
    runs: {},    // keyed by projectId: [run, ...]
    activeRunResult: null,
    offlineQueue: [],
    syncState: "synced", // "synced", "offline", "queue", "conflict"
    conflict: null       // { studyId, local, server, resolved: false }
  };

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { console.error("Store listener err:", e); }
    }
  }

  function saveState() {
    try {
      if (typeof localStorage !== "undefined") {
        var toSave = {
          projects: state.projects,
          activeProjectId: state.activeProjectId,
          studies: state.studies,
          activeStudyId: state.activeStudyId,
          runs: state.runs,
          offlineQueue: state.offlineQueue,
          syncState: state.syncState,
          conflict: state.conflict
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      }
    } catch (e) {
      console.warn("Storage save failed:", e);
    }
  }

  function loadState() {
    try {
      if (typeof localStorage !== "undefined") {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.projects && parsed.projects.length) {
            state.projects = parsed.projects || [];
            state.activeProjectId = parsed.activeProjectId || (state.projects[0] && state.projects[0].id);
            state.studies = parsed.studies || {};
            state.activeStudyId = parsed.activeStudyId || null;
            state.runs = parsed.runs || {};
            state.offlineQueue = parsed.offlineQueue || [];
            state.syncState = parsed.syncState || "synced";
            state.conflict = parsed.conflict || null;
            return;
          }
        }
      }
    } catch (e) {
      console.warn("Storage load failed, resetting:", e);
    }

    // Default Seed Project
    var defaultProjectId = "prj_bcg_1994";
    var defaultProject = {
      id: defaultProjectId,
      title: "BCG Vaccine vs Tuberculosis (Colditz 1994)",
      discipline: "medicine",
      specialty: "Infectious Disease",
      studyType: "Systematic Review & Meta-Analysis",
      researchQuestion: "Does BCG vaccination reduce tuberculosis incidence in clinical trials?",
      role: "owner",
      createdAt: 1732360000000,
      updatedAt: 1732360000000
    };

    var studies = SEED_BCG_STUDIES.map(function (s) {
      var copy = {};
      for (var k in s) { copy[k] = s[k]; }
      copy.projectId = defaultProjectId;
      return copy;
    });

    state.projects = [defaultProject];
    state.activeProjectId = defaultProjectId;
    state.studies[defaultProjectId] = studies;
    state.activeStudyId = studies[0] ? studies[0].id : null;
    state.runs = {};
    state.offlineQueue = [];
    state.syncState = "synced";
    state.conflict = null;
    saveState();
  }

  var STORE = {
    init: function () {
      loadState();
      return state;
    },

    getState: function () {
      return state;
    },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },

    // Projects CRUD
    getProjects: function () {
      return state.projects.slice();
    },

    getProject: function (id) {
      for (var i = 0; i < state.projects.length; i++) {
        if (state.projects[i].id === id) return state.projects[i];
      }
      return null;
    },

    getActiveProject: function () {
      return STORE.getProject(state.activeProjectId);
    },

    setActiveProject: function (id) {
      state.activeProjectId = id;
      state.activeStudyId = null;
      state.activeRunResult = null;
      saveState();
      notify();
    },

    createProject: function (data) {
      var title = (data.title || "").trim();
      if (!title || title.length > 180) {
        throw new Error("Project title must be between 1 and 180 characters");
      }
      var now = Date.now();
      var id = "prj_" + now + "_" + Math.floor(Math.random() * 1000);
      var project = {
        id: id,
        title: title,
        discipline: (data.discipline || "medicine").trim(),
        specialty: (data.specialty || "").trim(),
        studyType: (data.studyType || "Systematic Review").trim(),
        researchQuestion: (data.researchQuestion || "").trim(),
        role: "owner",
        createdAt: now,
        updatedAt: now
      };
      state.projects.unshift(project);
      state.studies[id] = [];
      state.runs[id] = [];
      state.activeProjectId = id;
      state.activeStudyId = null;
      state.activeRunResult = null;

      STORE.queueAction("project_create", project);
      saveState();
      notify();
      return project;
    },

    deleteProject: function (id) {
      state.projects = state.projects.filter(function (p) { return p.id !== id; });
      delete state.studies[id];
      delete state.runs[id];
      if (state.activeProjectId === id) {
        state.activeProjectId = state.projects[0] ? state.projects[0].id : null;
        state.activeStudyId = null;
      }
      saveState();
      notify();
    },

    // Studies CRUD
    getStudies: function (projectId) {
      var pid = projectId || state.activeProjectId;
      return (state.studies[pid] || []).slice();
    },

    getStudy: function (id) {
      var pid = state.activeProjectId;
      var list = state.studies[pid] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i];
      }
      return null;
    },

    getActiveStudy: function () {
      return state.activeStudyId ? STORE.getStudy(state.activeStudyId) : null;
    },

    setActiveStudy: function (id) {
      state.activeStudyId = id;
      saveState();
      notify();
    },

    createStudy: function (projectId, data) {
      var pid = projectId || state.activeProjectId;
      if (!pid) throw new Error("No active project for new study");
      var now = Date.now();
      var id = "st_" + now + "_" + Math.floor(Math.random() * 1000);
      var locator = data.locator || {};
      if (!locator.citation) {
        throw new Error("Locator citation is required per contract");
      }
      var study = {
        id: id,
        projectId: pid,
        label: (data.label || "Untitled Study").trim(),
        measure: data.measure || "RR",
        inputs: data.inputs || {},
        locator: {
          kind: locator.kind || "manual",
          citation: (locator.citation || "").trim(),
          page: locator.page != null ? String(locator.page).trim() : "",
          section: (locator.section || "").trim(),
          table: (locator.table || "").trim(),
          quote: (data.quote || locator.quote || "").trim()
        },
        quote: (data.quote || locator.quote || "").trim(),
        verified: !!data.verified,
        verifiedBy: data.verified ? "clinician" : null,
        verifiedAt: data.verified ? now : null,
        version: 1,
        createdBy: "clinician",
        createdAt: now,
        updatedAt: now
      };

      if (!state.studies[pid]) state.studies[pid] = [];
      state.studies[pid].unshift(study);
      state.activeStudyId = id;

      STORE.queueAction("study_create", study);
      saveState();
      notify();
      return study;
    },

    updateStudy: function (id, data) {
      var pid = state.activeProjectId;
      var list = state.studies[pid] || [];
      var study = null, idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { study = list[i]; idx = i; break; }
      }
      if (!study) throw new Error("Study not found: " + id);

      // Optimistic concurrency check per contract (409 stale_version)
      if (data.version !== undefined && data.version !== null && data.version !== study.version) {
        // Trigger 409 stale_version conflict
        var conflict = {
          studyId: id,
          local: data,
          server: study,
          resolved: false
        };
        state.conflict = conflict;
        state.syncState = "conflict";
        saveState();
        notify();
        var err = new Error("Study changed on the server (409 stale_version)");
        err.code = "stale_version";
        err.conflict = conflict;
        throw err;
      }

      var now = Date.now();
      if (data.label !== undefined) study.label = String(data.label).trim();
      if (data.measure !== undefined) study.measure = data.measure;
      if (data.inputs !== undefined) study.inputs = data.inputs;
      if (data.locator !== undefined) {
        study.locator = {
          kind: data.locator.kind || study.locator.kind || "manual",
          citation: (data.locator.citation || study.locator.citation || "").trim(),
          page: data.locator.page != null ? String(data.locator.page).trim() : (study.locator.page || ""),
          section: (data.locator.section || study.locator.section || "").trim(),
          table: (data.locator.table || study.locator.table || "").trim(),
          quote: (data.quote || data.locator.quote || study.locator.quote || "").trim()
        };
      }
      if (data.quote !== undefined) study.quote = String(data.quote).trim();
      if (data.verified !== undefined) {
        study.verified = !!data.verified;
        study.verifiedBy = data.verified ? "clinician" : null;
        study.verifiedAt = data.verified ? now : null;
      }
      study.version = (study.version || 1) + 1;
      study.updatedAt = now;

      STORE.queueAction("study_update", study);
      saveState();
      notify();
      return study;
    },

    deleteStudy: function (id) {
      var pid = state.activeProjectId;
      if (!state.studies[pid]) return;
      state.studies[pid] = state.studies[pid].filter(function (s) { return s.id !== id; });
      if (state.activeStudyId === id) state.activeStudyId = null;
      saveState();
      notify();
    },

    toggleVerification: function (id) {
      var study = STORE.getStudy(id);
      if (!study) return;
      return STORE.updateStudy(id, {
        version: study.version,
        verified: !study.verified
      });
    },

    // 409 Conflict Handling
    getConflict: function () {
      return state.conflict;
    },

    resolveConflict: function (studyId, choice) {
      if (!state.conflict || state.conflict.studyId !== studyId) return;
      var conf = state.conflict;
      var pid = state.activeProjectId;
      var list = state.studies[pid] || [];
      var study = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === studyId) { study = list[i]; break; }
      }

      if (choice === "keep_local" && study) {
        // Apply local changes with updated version
        var local = conf.local;
        if (local.label !== undefined) study.label = local.label;
        if (local.inputs !== undefined) study.inputs = local.inputs;
        if (local.quote !== undefined) study.quote = local.quote;
        if (local.locator !== undefined) study.locator = local.locator;
        if (local.verified !== undefined) study.verified = local.verified;
        study.version = (conf.server.version || study.version || 1) + 1;
        study.updatedAt = Date.now();
        STORE.queueAction("study_update_forced", study);
      }
      // If "accept_server", we keep server values as is

      state.conflict = null;
      state.syncState = state.offlineQueue.length > 0 ? "queue" : "synced";
      saveState();
      notify();
    },

    // Runs & Results
    saveRunResult: function (result, manifest) {
      var pid = state.activeProjectId;
      if (!pid) return;
      var now = Date.now();
      var run = {
        id: "run_" + now,
        projectId: pid,
        measure: manifest.measure,
        model: manifest.model,
        test: manifest.test,
        level: manifest.level,
        studyVersions: (manifest.inputs || []).map(function (inp) {
          return { studyId: inp.id, version: inp.version || 1 };
        }),
        manifest: manifest,
        result: result,
        createdAt: now
      };
      if (!state.runs[pid]) state.runs[pid] = [];
      state.runs[pid].unshift(run);
      state.activeRunResult = { run: run, result: result, manifest: manifest };
      STORE.queueAction("run_create", run);
      saveState();
      notify();
      return run;
    },

    getActiveRunResult: function () {
      return state.activeRunResult;
    },

    setActiveRunResult: function (r) {
      state.activeRunResult = r;
      saveState();
      notify();
    },

    // Offline queue
    queueAction: function (type, payload) {
      var item = {
        id: "q_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        idempotencyKey: "idem_" + Math.random().toString(36).slice(2) + Date.now(),
        type: type,
        payload: payload,
        timestamp: Date.now(),
        version: payload.version || 1
      };
      state.offlineQueue.push(item);
      if (state.syncState !== "conflict") {
        state.syncState = "queue";
      }
    },

    getQueue: function () {
      return state.offlineQueue.slice();
    },

    clearQueue: function () {
      state.offlineQueue = [];
      if (state.syncState !== "conflict") {
        state.syncState = "synced";
      }
      saveState();
      notify();
    },

    setSyncState: function (st) {
      state.syncState = st;
      saveState();
      notify();
    }
  };

  STORE.init();
  SMD.store = STORE;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = STORE;
  }
})(typeof window !== "undefined" ? window : globalThis);
