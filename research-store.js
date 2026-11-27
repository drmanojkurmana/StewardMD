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
    conflict: null,      // { studyId, local, server, resolved: false }
    idMap: {},           // local study id -> server study id (session cross-check)
    serverVersions: {},  // projectId|serverStudyId -> last version the server confirmed
    lastServerError: null // last write the server rejected with a 4xx (shown by screens)
  };
  var pendingOps = [];
  var creationWait = {};

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { console.error("Store listener err:", e); }
    }
  }

  function isDeviceOffline(err) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    if (err) {
      if (err.code === "network" || err.status === 0) return true;
      var msg = String(err.message || err.errorMessage || "");
      if (/network|offline|failed to fetch|cannot reach/i.test(msg)) return true;
    }
    return false;
  }

  /* ---- Server-backed projects ------------------------------------------- *
   * A project is server-backed only when it carries a serverId. Practice
   * projects (the seed BCG data) and tutorial sandboxes stay on the device. */
  function serverProjectId(pid) {
    var p = STORE.getProject(pid);
    if (!p) return null;
    if (p.practice || p.tutorial) return null;
    return p.serverId || null;
  }

  function enc(v) {
    return encodeURIComponent(String(v == null ? "" : v));
  }

  function apiRequest(method, path, body) {
    if (!SMD.api || typeof SMD.api.request !== "function") {
      var e = new Error("The research API is not available.");
      e.code = "api_unavailable";
      return Promise.reject(e);
    }
    return SMD.api.request(method, path, body);
  }

  function studyKey(pid, sid) {
    return pid + "|" + sid;
  }

  function track(promise) {
    pendingOps.push(promise);
    promise.then(function () {}, function () {});
    var drop = function () {
      var idx = pendingOps.indexOf(promise);
      if (idx >= 0) pendingOps.splice(idx, 1);
    };
    promise.then(drop, drop);
    return promise;
  }

  /* Resolves when every write started in this session has settled. The
   * manuscript screen awaits this before starting a PaperOrchestra job so the
   * server already holds the studies and the run. */
  function pendingSync() {
    return Promise.all(pendingOps.slice()).then(function () { return true; }, function () { return false; });
  }

  function rememberServerVersion(pid, sid, version) {
    if (!pid || !sid || !version) return;
    state.serverVersions[studyKey(pid, sid)] = version;
  }

  function serverVersionFor(pid, sid) {
    return state.serverVersions[studyKey(pid, sid)] || 0;
  }

  function findStudy(pid, id) {
    var list = state.studies[pid] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    var mapped = state.idMap[id];
    if (mapped) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === mapped) return list[j];
      }
    }
    return null;
  }

  function studyFromServer(pid, sp) {
    var locator = sp.locator || {};
    return {
      id: sp.id,
      projectId: pid,
      label: (sp.label || "Untitled Study").trim(),
      measure: sp.measure || "RR",
      inputs: sp.inputs || {},
      locator: {
        kind: locator.kind || "manual",
        citation: (locator.citation || "").trim(),
        page: locator.page != null ? String(locator.page).trim() : "",
        section: (locator.section || "").trim(),
        table: (locator.table || "").trim(),
        quote: (sp.quote || locator.quote || "").trim()
      },
      quote: (sp.quote || locator.quote || "").trim(),
      verified: !!sp.verified,
      verifiedBy: sp.verifiedBy || null,
      verifiedAt: sp.verifiedAt || null,
      version: sp.version || 1,
      createdBy: sp.createdBy || "clinician",
      createdAt: sp.createdAt || Date.now(),
      updatedAt: sp.updatedAt || Date.now(),
      serverKnown: true,
      serverVerified: !!sp.verified
    };
  }

  /* Give the local optimistic row the server identity, keeping the values the
   * clinician just typed. The server is the source for the id and version. */
  function adoptServerIdentity(pid, localId, sp) {
    var study = findStudy(pid, localId);
    if (!study || !sp || !sp.id) return study;
    study.id = sp.id;
    study.projectId = pid;
    study.version = sp.version || 1;
    if (sp.createdAt) study.createdAt = sp.createdAt;
    if (sp.updatedAt) study.updatedAt = sp.updatedAt;
    if (sp.createdBy) study.createdBy = sp.createdBy;
    if (localId !== sp.id) state.idMap[localId] = sp.id;
    if (state.activeStudyId === localId) state.activeStudyId = sp.id;
    study.serverKnown = true;
    study.serverVerified = !!sp.verified;
    rememberServerVersion(pid, sp.id, study.version);
    return study;
  }

  function reportWriteError(type, err) {
    var status = (err && err.status) || 0;
    if (!status && err && err.code && String(err.code).indexOf("http_") === 0) {
      status = parseInt(String(err.code).slice(5), 10) || 0;
    }
    state.lastServerError = {
      type: type,
      status: status,
      message: String((err && (err.message || (err.error && err.error.message))) || "The server rejected this change.")
    };
    saveState();
    notify();
  }

  function studyBody(study) {
    return {
      label: study.label || "",
      measure: study.measure,
      inputs: study.inputs || {},
      locator: study.locator || {},
      quote: study.quote || "",
      verified: !!study.verified
    };
  }

  /* Send now when online; queue only when the network actually failed. A 4xx
   * is a real answer from the server, so it is reported and never retried. */
  function persistOrQueue(type, payload, onError) {
    return function (err) {
      if (isDeviceOffline(err)) {
        STORE.queueAction(type, payload, err);
        return null;
      }
      reportWriteError(type, err);
      if (onError) onError(err);
      return null;
    };
  }

  /* ---- Run upload -------------------------------------------------------- *
   * Local engine ids are not server ids until the study create returns. The
   * manifest is remapped before upload, and studies created offline are
   * matched to their server rows by citation when the queue drains. */
  function runPins(pid, manifest) {
    var pins = [];
    var inputs = (manifest && manifest.inputs) || [];
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i] || {};
      var localId = inp.id;
      var sid = state.idMap[localId] || localId;
      var study = findStudy(pid, localId) || findStudy(pid, sid);
      pins.push({
        localId: localId,
        studyId: sid,
        study: study,
        version: (study && study.version) || inp.version || 1
      });
    }
    return pins;
  }

  function sameStudy(a, b) {
    if (!a || !b) return false;
    var ca = a.locator && a.locator.citation ? String(a.locator.citation).trim() : "";
    var cb = b.locator && b.locator.citation ? String(b.locator.citation).trim() : "";
    if (!ca || ca !== cb) return false;
    var la = String(a.label || "").trim().toLowerCase();
    var lb = String(b.label || "").trim().toLowerCase();
    return !la || !lb || la === lb;
  }

  function matchServerStudy(pin, studies) {
    var i;
    for (i = 0; i < studies.length; i++) {
      if (studies[i] && studies[i].id === pin.studyId) return studies[i];
    }
    if (!pin.study) return null;
    for (i = 0; i < studies.length; i++) {
      if (sameStudy(pin.study, studies[i])) return studies[i];
    }
    return null;
  }

  function reconcileRunStudies(pid, serverPid, pins, studies) {
    var chain = Promise.resolve();
    for (var i = 0; i < pins.length; i++) {
      (function (pin) {
        chain = chain.then(function () {
          var match = matchServerStudy(pin, studies);
          if (!match) return null;
          if (pin.study && pin.study.id !== match.id) {
            adoptServerIdentity(pid, pin.study.id, match);
          }
          pin.studyId = match.id;
          pin.study = findStudy(pid, match.id) || pin.study;
          rememberServerVersion(pid, match.id, match.version);
          if (pin.study && pin.study.verified && match.verified !== true) {
            var base = match.version || 1;
            return apiRequest("PUT", "/v1/projects/" + enc(serverPid) + "/studies/" + enc(match.id), {
              version: base,
              verified: true
            }).then(function (res) {
              var sp = res && res.study;
              if (sp) {
                pin.study.version = sp.version || pin.study.version;
                pin.study.verified = !!sp.verified;
                pin.study.serverVerified = !!sp.verified;
                rememberServerVersion(pid, match.id, pin.study.version);
              }
              return sp || null;
            }, function (err) {
              if (isDeviceOffline(err)) {
                STORE.queueAction("study_update", { id: match.id, projectId: serverPid, version: base, verified: true }, err);
              } else {
                reportWriteError("study_update", err);
              }
              return null;
            });
          }
          return null;
        });
      })(pins[i]);
    }
    return chain;
  }

  function prepareRunPayload(pid, serverPid, run, manifest) {
    var pins = runPins(pid, manifest);
    var needLookup = false;
    for (var i = 0; i < pins.length; i++) {
      if (!pins[i].study || !pins[i].study.serverKnown) needLookup = true;
    }
    var flush = pendingSync().then(function () {
      return (SMD.drainQueue ? SMD.drainQueue() : 0);
    });
    return Promise.resolve(flush).then(function () {
      if (!needLookup) return null;
      return apiRequest("GET", "/v1/projects/" + enc(serverPid) + "/studies?limit=200").then(function (res) {
        return (res && res.studies) || [];
      }, function (err) {
        if (!isDeviceOffline(err)) reportWriteError("studies_list", err);
        return null;
      });
    }).then(function (studies) {
      var work = studies ? reconcileRunStudies(pid, serverPid, pins, studies) : Promise.resolve();
      return work.then(function () {
        var payload = [];
        for (var j = 0; j < pins.length; j++) {
          var pin = pins[j];
          var ver = serverVersionFor(pid, pin.studyId) || (pin.study && pin.study.version) || pin.version || 1;
          payload.push({ studyId: pin.studyId, version: ver });
          if (manifest && manifest.inputs && manifest.inputs[j]) manifest.inputs[j].id = pin.studyId;
        }
        return {
          measure: run.measure,
          model: run.model,
          test: run.test,
          level: run.level,
          studyVersions: payload
        };
      });
    });
  }

  function cleanQueue(queue) {
    if (!queue || !Array.isArray(queue)) return [];
    var validTypes = {
      "project_create": 1,
      "study_create": 1,
      "study_update": 1,
      "study_update_forced": 1,
      "run_create": 1
    };
    var cleaned = [];
    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      if (!item || typeof item !== "object") continue;
      if (!item.type || !validTypes[item.type]) continue;
      if (typeof item.type === "string" && (item.type.indexOf("ai") !== -1 || item.type.indexOf("draft") !== -1 || item.type.indexOf("search") !== -1)) continue;
      var st = item.status || (item.error && item.error.status) || 0;
      if (st >= 400 && st < 500) continue;
      if (!item.payload || typeof item.payload !== "object") continue;
      var pl = item.payload;
      if (pl.id === "prj_bcg_1994" || pl.projectId === "prj_bcg_1994") continue;
      cleaned.push(item);
    }
    return cleaned;
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
          conflict: state.conflict,
          idMap: state.idMap,
          serverVersions: state.serverVersions
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
            state.offlineQueue = cleanQueue(parsed.offlineQueue || []);
            state.syncState = parsed.syncState || "synced";
            if (state.offlineQueue.length === 0 && state.syncState === "queue") {
              state.syncState = "synced";
            }
            state.conflict = parsed.conflict || null;
            state.idMap = parsed.idMap || {};
            state.serverVersions = parsed.serverVersions || {};
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
      practice: true,
      serverId: null,
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
    state.idMap = {};
    state.serverVersions = {};
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

    adoptServerProject: function (sp) {
      var now = Date.now();
      var prev = null;
      for (var pi = 0; pi < state.projects.length; pi++) {
        if (state.projects[pi].id === sp.id) { prev = state.projects[pi]; break; }
      }
      var project = {
        id: sp.id,
        serverId: sp.id,
        practice: false,
        title: sp.title || "Untitled project",
        discipline: sp.discipline || "medicine",
        specialty: sp.specialty || "",
        studyType: sp.studyType || "Systematic Review",
        researchQuestion: sp.researchQuestion || "",
        targetJournal: sp.targetJournal || (prev && prev.targetJournal) || "",
        targetJournalName: sp.targetJournalName || (prev && prev.targetJournalName) || "",
        role: sp.role || "owner",
        createdAt: sp.createdAt || now,
        updatedAt: now
      };
      var replaced = false;
      for (var i = 0; i < state.projects.length; i++) {
        if (state.projects[i].id === project.id) { state.projects[i] = project; replaced = true; break; }
      }
      if (!replaced) state.projects.unshift(project);
      if (!state.studies[project.id]) state.studies[project.id] = [];
      if (!state.runs[project.id]) state.runs[project.id] = [];
      state.activeProjectId = project.id;
      state.activeStudyId = state.studies[project.id][0] ? state.studies[project.id][0].id : null;
      state.activeRunResult = null;
      saveState();
      notify();
      return project;
    },

    migrateLocalProject: function (oldId, sp, serverStudies) {
      var project = STORE.adoptServerProject(sp);
      var oldRuns = state.runs[oldId] || [];
      state.studies[project.id] = (serverStudies || []).slice();
      var runs = [];
      for (var i = 0; i < oldRuns.length; i++) {
        var r = {};
        for (var k in oldRuns[i]) { r[k] = oldRuns[i][k]; }
        r.projectId = project.id;
        runs.push(r);
      }
      state.runs[project.id] = runs;
      if (oldId !== project.id) {
        state.projects = state.projects.filter(function (p) { return p.id !== oldId; });
        delete state.studies[oldId];
        delete state.runs[oldId];
      }
      state.offlineQueue = state.offlineQueue.filter(function (q) {
        var pl = q.payload || {};
        if (pl.projectId === oldId) return false;
        if (q.type === "project_create" && pl.id === oldId) return false;
        return true;
      });
      state.activeProjectId = project.id;
      state.activeStudyId = state.studies[project.id][0] ? state.studies[project.id][0].id : null;
      state.activeRunResult = null;
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

    updateProject: function (id, patch) {
      if (!id || !patch) return null;
      var target = null;
      for (var i = 0; i < state.projects.length; i++) {
        if (state.projects[i].id === id || state.projects[i].serverId === id) {
          target = state.projects[i];
          break;
        }
      }
      if (!target) return null;
      var fields = ["title", "discipline", "specialty", "studyType", "researchQuestion", "targetJournal", "targetJournalName"];
      for (var f = 0; f < fields.length; f++) {
        var key = fields[f];
        if (patch[key] !== undefined) target[key] = patch[key];
      }
      target.updatedAt = Date.now();
      saveState();
      notify();
      return target;
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
      saveState();
      notify();

      var serverPid = serverProjectId(pid);
      /* A reference with no outcome numbers (e.g. a published case added from Novelty) is not an
       * analysable study: the server refuses it (400 invalid_study), so it stays on the phone as before. */
      var hasInputs = !!(study.inputs && typeof study.inputs === "object" && Object.keys(study.inputs).length);
      if (!serverPid || !hasInputs) {
        STORE.queueAction("study_create", study);
        return study;
      }

      /* Send now. The server assigns the study id; the local row keeps it so a
       * later run pins real server ids. Verification is a second PUT because
       * the create route always inserts an unverified row. */
      var localId = id;
      var body = studyBody(study);
      var chain = apiRequest("POST", "/v1/projects/" + enc(serverPid) + "/studies", body).then(function (res) {
        var sp = res && res.study;
        if (!sp || !sp.id) return null;
        adoptServerIdentity(pid, localId, sp);
        if (!study.verified) {
          saveState();
          notify();
          return sp;
        }
        var base = sp.version || 1;
        return apiRequest("PUT", "/v1/projects/" + enc(serverPid) + "/studies/" + enc(sp.id), {
          version: base,
          verified: true
        }).then(function (r2) {
          var s2 = r2 && r2.study;
          if (s2) {
            study.verified = !!s2.verified;
            study.verifiedAt = s2.verifiedAt || study.verifiedAt;
            study.version = s2.version || study.version;
            study.serverVerified = !!s2.verified;
            rememberServerVersion(pid, s2.id, study.version);
          }
          saveState();
          notify();
          return s2 || sp;
        }, function (err) {
          if (isDeviceOffline(err)) {
            STORE.queueAction("study_update", { id: sp.id, projectId: serverPid, version: base, verified: true }, err);
          } else {
            reportWriteError("study_update", err);
          }
          return sp;
        });
      }, function (err) {
        if (isDeviceOffline(err)) {
          var qp = studyBody(study);
          qp.id = localId;
          qp.projectId = serverPid;
          STORE.queueAction("study_create", qp, err);
        } else {
          reportWriteError("study_create", err);
        }
        return null;
      });
      creationWait[localId] = track(chain);
      return study;
    },

    // Adopt a study already persisted on the server (auto-add, verification).
    // Keeps the server id/version; no offline queue entry because the server
    // already holds this exact row.
    adoptServerStudy: function (projectId, sp) {
      var pid = projectId || state.activeProjectId;
      if (!pid || !sp || !sp.id) return null;
      var study = studyFromServer(pid, sp);
      if (!state.studies[pid]) state.studies[pid] = [];
      var replaced = false;
      for (var i = 0; i < state.studies[pid].length; i++) {
        if (state.studies[pid][i].id === study.id) { state.studies[pid][i] = study; replaced = true; break; }
      }
      if (!replaced) state.studies[pid].unshift(study);
      rememberServerVersion(pid, study.id, study.version);
      state.activeStudyId = study.id;
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
      saveState();
      notify();

      var serverPid = serverProjectId(pid);
      if (!serverPid) {
        STORE.queueAction("study_update", study);
        return study;
      }

      var localId = id;
      var wait = creationWait[localId] || Promise.resolve(null);
      var chain = wait.then(function () {
        var current = findStudy(pid, localId);
        if (!current) return null;
        var sid = current.id;
        /* The server checks the version the edit was based on. The local row
         * is already incremented optimistically, so send the previous one. */
        var base = serverVersionFor(pid, sid) || Math.max(1, (current.version || 2) - 1);
        var body = studyBody(current);
        body.version = base;
        return apiRequest("PUT", "/v1/projects/" + enc(serverPid) + "/studies/" + enc(sid), body).then(function (res) {
          var sp = res && res.study;
          if (sp) {
            current.version = sp.version || current.version;
            current.verified = !!sp.verified;
            current.serverVerified = !!sp.verified;
            current.verifiedBy = sp.verifiedBy || current.verifiedBy;
            current.verifiedAt = sp.verifiedAt || current.verifiedAt;
            current.updatedAt = sp.updatedAt || current.updatedAt;
            rememberServerVersion(pid, sid, current.version);
            saveState();
            notify();
          }
          return sp || null;
        }, function (err) {
          var qp = studyBody(current);
          qp.id = sid;
          qp.projectId = serverPid;
          qp.version = base;
          return persistOrQueue("study_update", qp, null)(err);
        });
      });
      track(chain);
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
        var serverPid = serverProjectId(pid);
        if (serverPid) {
          var sid = study.id;
          var base = (conf.server && conf.server.version) || Math.max(1, study.version - 1);
          var body = studyBody(study);
          body.version = base;
          track(apiRequest("PUT", "/v1/projects/" + enc(serverPid) + "/studies/" + enc(sid), body).then(function (res) {
            var sp = res && res.study;
            if (sp) {
              study.version = sp.version || study.version;
              study.verified = !!sp.verified;
              study.serverVerified = !!sp.verified;
              rememberServerVersion(pid, sid, study.version);
              saveState();
              notify();
            }
            return sp || null;
          }, function (err) {
            var qp = studyBody(study);
            qp.id = sid;
            qp.projectId = serverPid;
            qp.version = base;
            return persistOrQueue("study_update_forced", qp, null)(err);
          }));
        } else {
          STORE.queueAction("study_update_forced", study);
        }
      }
      // If "accept_server", we keep server values as is

      state.conflict = null;
      state.syncState = state.offlineQueue.length > 0 ? "queue" : "synced";
      saveState();
      notify();
    },

    // Runs & Results
    saveRunResult: function (result, manifest, onDone) {
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
      saveState();
      notify();

      var serverPid = serverProjectId(pid);
      if (!serverPid) {
        STORE.queueAction("run_create", run);
        if (onDone) onDone(null, null);
        return run;
      }

      /* PaperOrchestra needs this run on the server. Wait for study creates
       * and verification PUTs, remap local ids, then upload. */
      var chain = prepareRunPayload(pid, serverPid, run, manifest).then(function (payload) {
        run.studyVersions = payload.studyVersions;
        saveState();
        return apiRequest("POST", "/v1/projects/" + enc(serverPid) + "/runs", payload).then(function (res) {
          var sr = res && res.run;
          if (sr && sr.id) {
            run.serverId = sr.id;
            run.serverVersion = sr.version;
            saveState();
          }
          if (onDone) onDone(null, sr || null);
          return sr || null;
        }, function (err) {
          /* Offline: keep the mapped payload so the queue drain can send it
           * without the local ids. 4xx: the server said no, show its words. */
          if (isDeviceOffline(err)) {
            var queued = { projectId: serverPid, measure: payload.measure, model: payload.model,
              test: payload.test, level: payload.level, studyVersions: payload.studyVersions };
            STORE.queueAction("run_create", queued, err);
            if (onDone) onDone(null, null);
          } else {
            reportWriteError("run_create", err);
            if (onDone) onDone(err, null);
          }
          return null;
        });
      }, function (err) {
        reportWriteError("run_create", err);
        if (onDone) onDone(err, null);
        return null;
      });
      track(chain);
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

    // Offline queue: only queue writes that failed because the phone is offline.
    // Never queue AI draft calls or requests that got a 4xx client error.
    queueAction: function (type, payload, err) {
      if (!type || typeof type !== "string") return;
      if (type.indexOf("ai") !== -1 || type.indexOf("draft") !== -1 || type.indexOf("search") !== -1) return;
      if (type !== "project_create" && type !== "study_create" && type !== "study_update" && type !== "study_update_forced" && type !== "run_create") {
        return;
      }
      if (err) {
        var status = err.status || 0;
        if (!status && err.code && String(err.code).indexOf("http_") === 0) {
          status = parseInt(String(err.code).slice(5), 10) || 0;
        }
        if (status >= 400 && status < 500) {
          return;
        }
      }
      if (payload && (payload.id === "prj_bcg_1994" || payload.projectId === "prj_bcg_1994")) {
        return;
      }
      if (!isDeviceOffline(err)) {
        return;
      }
      var item = {
        id: "q_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        idempotencyKey: "idem_" + Math.random().toString(36).slice(2) + Date.now(),
        type: type,
        payload: payload,
        timestamp: Date.now(),
        version: (payload && payload.version) || 1
      };
      state.offlineQueue.push(item);
      if (state.syncState !== "conflict") {
        state.syncState = "queue";
      }
      saveState();
      notify();
    },

    getQueue: function () {
      return state.offlineQueue.slice();
    },

    setQueue: function (q) {
      state.offlineQueue = cleanQueue(q || []);
      if (state.offlineQueue.length === 0 && state.syncState !== "conflict") {
        state.syncState = "synced";
      }
      saveState();
      notify();
    },

    cleanQueue: function () {
      state.offlineQueue = cleanQueue(state.offlineQueue);
      if (state.offlineQueue.length === 0 && state.syncState !== "conflict") {
        state.syncState = "synced";
      }
      saveState();
      notify();
      return state.offlineQueue.slice();
    },

    removeQueueItem: function (id) {
      state.offlineQueue = state.offlineQueue.filter(function (it) {
        return it.id !== id;
      });
      if (state.offlineQueue.length === 0 && state.syncState !== "conflict") {
        state.syncState = "synced";
      }
      saveState();
      notify();
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
    },

    /* Resolves when every server write started here has settled. */
    pendingSync: pendingSync,

    serverProjectId: function (pid) {
      return serverProjectId(pid || state.activeProjectId);
    },

    getLastServerError: function () {
      return state.lastServerError || null;
    },

    clearLastServerError: function () {
      state.lastServerError = null;
      saveState();
    }
  };

  STORE.init();
  SMD.store = STORE;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = STORE;
  }
})(typeof window !== "undefined" ? window : globalThis);
