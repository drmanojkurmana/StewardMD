/* StewardMD · FollowCare AI — doctor-facing in-app module (Phase 1).
 *
 * The clinician surface: enroll a discharged patient onto a recovery pathway (generates the patient's
 * login-free portal link), then watch the recovery board — episodes sorted by escalation, each with its
 * check-in timeline. It NEVER diagnoses, NEVER changes therapy; it only surfaces the deterministic engine's
 * signal so the doctor decides. Talks only to /api/followcare/* (server owns every clinical decision).
 *
 * Buildless IIFE: exposes window.FollowCare (+ module.exports for node tests). The pure view-model layer
 * (validation, escalation metadata, sorting, relative time) is unit-tested; the render layer mounts a
 * self-contained scoped overlay so it never depends on home.js internals. Gated by smd_followcare (OFF).
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var BASE = "/api/followcare";

  // ---- flags ----
  function enabled() { try { return !!(G.SMD_FOLLOWCARE_FLAGS && G.SMD_FOLLOWCARE_FLAGS.on()); } catch (e) { return false; } }

  // ---- pure view-model layer (testable) ----------------------------------------------------
  var ESC = {
    red:    { label: "Urgent", rank: 3, color: "#b3261e", bg: "#fdeceb", icon: "⚠" },
    orange: { label: "Review", rank: 2, color: "#8a5a00", bg: "#fdf1dc", icon: "●" },
    yellow: { label: "Watch",  rank: 1, color: "#8a6d00", bg: "#fbf6e0", icon: "○" },
    green:  { label: "On track", rank: 0, color: "#127a52", bg: "#e7f6ee", icon: "✓" },
    "":     { label: "Pending", rank: -1, color: "#5a7184", bg: "#eef2f4", icon: "…" }
  };
  function escalationMeta(level) { return ESC[level] || ESC[""]; }

  var STATUS = {
    active: "Active", escalated: "Needs review", recovered: "Recovered", closed: "Closed"
  };
  function statusMeta(s) { return STATUS[s] || s || "Active"; }

  // Validate the enroll form. Returns { ok, errors:{field:msg}, value } — pure, no I/O.
  function validateEnroll(input, pathwaysApi) {
    input = input || {};
    var errors = {};
    var PW = pathwaysApi || G.FollowCarePathways;
    if (!input.pathwayId || !(PW && PW.get(input.pathwayId))) errors.pathwayId = "Choose a recovery pathway.";
    var digits = String(input.phone || "").replace(/[^\d]/g, "");
    if (digits.length < 10) errors.phone = "Enter a valid mobile number.";
    if (input.name != null && String(input.name).length > 120) errors.name = "Name is too long.";
    var dischargeMs = input.dischargeMs != null ? Number(input.dischargeMs) : NaN;
    if (input.dischargeMs != null && !isFinite(dischargeMs)) errors.dischargeMs = "Invalid discharge date.";
    var ok = Object.keys(errors).length === 0;
    return {
      ok: ok, errors: errors,
      value: ok ? {
        pathwayId: input.pathwayId, phone: digits, name: (input.name || "").trim() || undefined,
        mrn: (input.mrn || "").trim() || undefined,
        dischargeMs: isFinite(dischargeMs) ? dischargeMs : undefined,
        lang: input.lang || "en", tz: input.tz || undefined
      } : null
    };
  }

  // Sort episodes: worst escalation first, then soonest due, then most recent discharge.
  function sortEpisodes(list) {
    return (list || []).slice().sort(function (a, b) {
      var ra = escalationMeta(a.escalation).rank, rb = escalationMeta(b.escalation).rank;
      if (rb !== ra) return rb - ra;
      var na = a.nextDueMs || Infinity, nb = b.nextDueMs || Infinity;
      if (na !== nb) return na - nb;
      return (b.dischargeMs || 0) - (a.dischargeMs || 0);
    });
  }

  // Compact relative time ("in 2d", "3h ago", "today"). nowMs injectable for tests.
  function fmtWhen(ms, nowMs) {
    if (!ms) return "—";
    nowMs = nowMs || (G.Date && Date.now ? Date.now() : 0);
    var diff = ms - nowMs, day = 86400000, ad = Math.abs(diff);
    if (ad < 3600000) return "now";
    if (ad < day) { var h = Math.round(ad / 3600000); return diff >= 0 ? "in " + h + "h" : h + "h ago"; }
    var d = Math.round(ad / day);
    if (d === 0) return "today";
    return diff >= 0 ? "in " + d + "d" : d + "d ago";
  }

  function counts(list) {
    var c = { red: 0, orange: 0, yellow: 0, green: 0, total: 0 };
    (list || []).forEach(function (e) { c.total++; if (c[e.escalation] != null) c[e.escalation]++; });
    return c;
  }

  // ---- API client -------------------------------------------------------------------------
  function idToken() {
    try { var u = G.firebase && firebase.auth && firebase.auth().currentUser; if (u && u.getIdToken) return u.getIdToken().catch(function () { return null; }); } catch (e) {}
    return Promise.resolve(null);
  }
  function hdr(tok) { var h = { "Content-Type": "application/json" }; if (tok) h.Authorization = "Bearer " + tok; return h; }
  function req(method, path, body) {
    return idToken().then(function (tok) {
      var opts = { method: method, headers: hdr(tok) };
      if (body) opts.body = JSON.stringify(body);
      return (G.fetch)(BASE + path, opts).then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: {} }; });
      });
    });
  }
  var API = {
    pathways: function () { return req("GET", "/pathways"); },
    hospitalGet: function () { return req("GET", "/hospital"); },
    hospitalSet: function (info) { return req("POST", "/hospital", info); },
    enroll: function (payload) { return req("POST", "/enroll", payload); },
    episodes: function () { return req("GET", "/episodes"); },
    episode: function (id) { return req("GET", "/episode?id=" + encodeURIComponent(id)); },
    revoke: function (episodeId) { return req("POST", "/revoke", { episodeId: episodeId }); },
    ack: function (episodeId) { return req("POST", "/ack", { episodeId: episodeId }); },
    erase: function (episodeId) { return req("POST", "/erase", { episodeId: episodeId }); },
    ready: function () { return req("GET", "/ready"); },
    // Doctor Action Center
    action: function (payload) { return req("POST", "/action", payload); },
    comms: function (episodeId) { return req("GET", "/comms?id=" + encodeURIComponent(episodeId)); },
    draft: function (episodeId, kind) { return req("POST", "/draft", { episodeId: episodeId, kind: kind }); }
  };
  var CM = (function () { try { return G.FollowCareComms || null; } catch (e) { return null; } })();
  function actionsEnabled() { try { return !!(G.SMD_FOLLOWCARE_FLAGS && G.SMD_FOLLOWCARE_FLAGS.bool("smd_followcare_actions")); } catch (e) { return true; } }

  // ---- render layer (self-contained scoped overlay) ---------------------------------------
  var mounted = false;
  function css() {
    return [
      ".fc-ov{position:fixed;inset:0;z-index:9600;background:rgba(8,18,24,.5);backdrop-filter:blur(3px);display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:0}",
      ".fc-sheet{background:var(--panel,#fff);color:var(--ink,#14202b);width:100%;max-width:620px;min-height:100%;box-shadow:0 20px 60px -20px rgba(0,0,0,.5);display:flex;flex-direction:column}",
      ".fc-hd{position:sticky;top:0;background:#0e6e63;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;z-index:2}",
      ".fc-hd b{font-size:16px;font-weight:800}.fc-hd .fc-x{margin-left:auto;background:rgba(255,255,255,.16);border:none;color:#fff;width:34px;height:34px;border-radius:9px;font-size:18px;cursor:pointer}",
      ".fc-bd{padding:16px;flex:1}",
      ".fc-sum{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}",
      ".fc-pill{border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:700}",
      ".fc-btn{background:#0e6e63;color:#fff;border:none;border-radius:12px;padding:12px 16px;font-weight:750;font-size:14px;cursor:pointer;min-height:46px}",
      ".fc-btn.sec{background:transparent;color:#0e6e63;border:1.5px solid #0e6e63}",
      ".fc-row{border:1px solid var(--line,#dbe4e2);border-radius:14px;padding:13px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px;cursor:pointer;background:var(--panel,#fff)}",
      ".fc-row .fc-badge{flex:0 0 auto;border-radius:10px;padding:5px 9px;font-size:12px;font-weight:800}",
      ".fc-row .fc-meta{flex:1;min-width:0}.fc-row .fc-meta .fc-t{font-weight:700;font-size:14.5px}.fc-row .fc-meta .fc-s{color:var(--slate,#5a7184);font-size:12.5px}",
      ".fc-field{margin-bottom:14px}.fc-field label{display:block;font-weight:650;font-size:13.5px;margin-bottom:6px}",
      ".fc-field input,.fc-field select{width:100%;padding:11px 12px;border:1.5px solid var(--line,#dbe4e2);border-radius:11px;font-size:15px;background:var(--panel,#fff);color:var(--ink,#14202b);min-height:46px}",
      ".fc-err{color:#b3261e;font-size:12.5px;margin-top:4px}",
      ".fc-link{background:#e7f6ee;border:1px solid #bfe3cf;border-radius:12px;padding:12px;margin-top:12px;word-break:break-all;font-size:13px}",
      ".fc-empty{text-align:center;color:var(--slate,#5a7184);padding:40px 10px}",
      ".fc-tl{border-left:2px solid var(--line,#dbe4e2);padding-left:14px;margin:8px 0 0}",
      ".fc-tl .fc-ev{margin-bottom:12px}.fc-tl .fc-ev .fc-d{font-weight:700;font-size:13.5px}.fc-tl .fc-ev .fc-r{color:var(--slate,#5a7184);font-size:12.5px}",
      // Doctor Action Center
      ".fc-actgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".fc-act{display:flex;flex-direction:column;gap:6px;align-items:flex-start;text-align:left;border:1px solid var(--line,#dbe4e2);border-radius:14px;padding:14px;background:var(--panel,#fff);color:var(--ink,#14202b);cursor:pointer;min-height:84px}",
      ".fc-act .fc-ai{font-size:22px}.fc-act .fc-al{font-weight:750;font-size:13.5px;line-height:1.25}",
      ".fc-act.high{border-color:#e6a23c;background:color-mix(in srgb,#e6a23c 8%,transparent)}",
      ".fc-act.soon{opacity:.55;cursor:default}.fc-act .fc-soon{font-size:10.5px;font-weight:800;color:#b06a00;background:#ffe9c7;border-radius:999px;padding:2px 7px}",
      ".fc-ta{width:100%;min-height:110px;padding:11px 12px;border:1.5px solid var(--line,#dbe4e2);border-radius:11px;font:inherit;font-size:15px;background:var(--panel,#fff);color:var(--ink,#14202b);resize:vertical}",
      ".fc-chk{display:flex;align-items:center;gap:9px;padding:9px 4px;font-size:14px}.fc-chk input{width:20px;height:20px}",
      ".fc-tmpl{display:inline-block;border:1px solid var(--line,#dbe4e2);border-radius:999px;padding:6px 11px;margin:0 6px 6px 0;font-size:12.5px;cursor:pointer;background:var(--panel,#fff);color:var(--ink,#14202b)}",
      ".fc-ai-draft{border:1px dashed #0e6e63;border-radius:11px;padding:9px 11px;margin:8px 0;font-size:12.5px;color:#0e6e63;background:color-mix(in srgb,#0e6e63 6%,transparent)}",
      ".fc-cm{border:1px solid var(--line,#dbe4e2);border-radius:12px;padding:11px 13px;margin-bottom:10px}",
      ".fc-cm.in{background:color-mix(in srgb,#0e6e63 6%,transparent)}.fc-cm.high{border-color:#d33;background:color-mix(in srgb,#d33 7%,transparent)}",
      ".fc-cm .fc-cm-h{font-weight:750;font-size:12.5px;color:var(--slate,#5a7184);display:flex;gap:8px;align-items:center}",
      ".fc-cm .fc-cm-b{font-size:14px;margin-top:4px;white-space:pre-wrap}",
      ".fc-cm .fc-cm-st{margin-left:auto;font-size:11px;font-weight:700}",
      "@media(prefers-color-scheme:dark){.fc-sheet{--panel:#132030;--ink:#e8edf2;--slate:#9bb0c2;--line:#294050}.fc-link{background:#0f2b22;border-color:#245}}"
    ].join("");
  }
  function ensureStyle() { if (mounted) return; var s = document.createElement("style"); s.id = "fc-style"; s.textContent = css(); document.head.appendChild(s); mounted = true; }

  var root = null, PATHWAYS = null;
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else if (k === "html") e.innerHTML = attrs[k]; else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function toast(m) { try { (G.toast || G.SMD_toast || function () {})(m); } catch (e) {} }
  function isoDate(ms) { try { return new Date(ms).toISOString().slice(0, 10); } catch (e) { return ""; } }

  function close() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; }
  function shell(title, bodyEl) {
    ensureStyle();
    close();
    var body = h("div", { "class": "fc-bd" }, [bodyEl]);
    var sheet = h("div", { "class": "fc-sheet" }, [
      h("div", { "class": "fc-hd" }, [
        h("b", { text: "FollowCare" }),
        h("button", { "class": "fc-x", "aria-label": "Close", onclick: close, text: "×" })
      ]),
      body
    ]);
    root = h("div", { "class": "fc-ov", onclick: function (e) { if (e.target === root) close(); } }, [sheet]);
    document.body.appendChild(root);
    return body;
  }

  function notReadyView() {
    return h("div", { "class": "fc-empty" }, [
      h("div", { style: "font-size:34px;margin-bottom:8px", text: "🛠" }),
      h("div", { style: "font-weight:700;margin-bottom:6px", text: "FollowCare is being set up" }),
      h("div", { style: "font-size:13.5px", text: "This recovery-follow-up module will be available once your administrator finishes configuration." })
    ]);
  }
  // Readiness-gate a view: shows a clean "being set up" screen if the server secrets aren't provisioned yet
  // (instead of letting the doctor hit a failed enroll), else runs cb(body).
  function withReady(body, cb) {
    body.appendChild(h("div", { "class": "fc-empty", text: "Loading…" }));
    API.ready().then(function (res) {
      if (res && res.body && res.body.ready === false) { body.innerHTML = ""; body.appendChild(notReadyView()); return; }
      cb(body);
    }).catch(function () { cb(body); });
  }
  function open() { if (!enabled()) { toast("FollowCare is not enabled."); return; } withReady(shell(), renderDashboard); }
  // Open STRAIGHT into the enroll form, pre-filled — used by the ICU/Ward Discharge Creator's FollowCare button.
  function openEnroll(prefill) { if (!enabled()) { toast("FollowCare is not enabled."); return; } var b = shell(); withReady(b, function (x) { renderEnroll(x, prefill || {}); }); }

  function renderDashboard(body) {
    body.innerHTML = "";
    body.appendChild(h("div", { "class": "fc-empty", text: "Loading recovery board…" }));
    API.episodes().then(function (res) {
      body.innerHTML = "";
      if (res.status === 401) { body.appendChild(h("div", { "class": "fc-empty", text: "Please sign in to use FollowCare." })); return; }
      var list = sortEpisodes((res.body && res.body.episodes) || []);
      var c = counts(list);
      // Phase 3 — command-center strip (MODULE 1): the doctor's at-a-glance counts.
      try {
        if (G.FollowCareAnalytics) {
          var cc = FollowCareAnalytics.commandCenter(list, (G.Date && Date.now) ? Date.now() : 0);
          body.appendChild(h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" }, [
            ccBox(cc.active, "Active"), ccBox(cc.needReview, "Need review"), ccBox(cc.highRisk, "High risk"), ccBox(cc.recoveredToday, "Recovered today")
          ]));
        }
      } catch (e) {}
      body.appendChild(h("div", { "class": "fc-sum" }, [
        pill(c.red + " urgent", ESC.red), pill(c.orange + " review", ESC.orange), pill(c.green + " on track", ESC.green)
      ]));
      body.appendChild(h("button", { "class": "fc-btn", onclick: function () { renderEnroll(body); }, text: "+ Enroll a patient" }));
      if (!list.length) { body.appendChild(h("div", { "class": "fc-empty", text: "No active recovery episodes yet. Enroll a discharged patient to begin." })); return; }
      list.forEach(function (ep) { body.appendChild(episodeRow(ep)); });
    }).catch(function () { body.innerHTML = ""; body.appendChild(h("div", { "class": "fc-empty", text: "Could not load the recovery board. Check your connection." })); });
  }
  function pill(text, meta) { return h("span", { "class": "fc-pill", style: "background:" + meta.bg + ";color:" + meta.color, text: text }); }
  function ccBox(n, label) { return h("div", { style: "flex:1 1 auto;min-width:72px;text-align:center;background:var(--panel,#fff);border:1px solid var(--line,#dbe4e2);border-radius:12px;padding:10px 8px" }, [h("div", { style: "font-size:20px;font-weight:800;color:#0e6e63", text: String(n) }), h("div", { style: "font-size:11.5px;color:var(--slate,#5a7184)", text: label })]); }
  function episodeRow(ep) {
    var m = escalationMeta(ep.escalation);
    return h("div", { "class": "fc-row", onclick: function () { renderDetail(ep.episodeId); } }, [
      h("span", { "class": "fc-badge", style: "background:" + m.bg + ";color:" + m.color, text: m.icon + " " + m.label }),
      h("div", { "class": "fc-meta" }, [
        h("div", { "class": "fc-t", text: (ep.disease || "Recovery") + (ep.score != null && ep.score >= 0 ? "  ·  " + ep.score + "/100" : "") }),
        h("div", { "class": "fc-s", text: statusMeta(ep.status) + "  ·  next " + fmtWhen(ep.nextDueMs) + (ep.riskPercent ? "  ·  " + ep.riskPercent + "% readmit risk" : "") + (ep.needsReview ? "  ·  ⚑ needs review" : "") })
      ])
    ]);
  }

  // Enroll requires the doctor's hospital to be set first (server binds enrollment to it — tenant authority).
  function renderEnroll(body, prefill) {
    body.innerHTML = "";
    body.appendChild(h("div", { "class": "fc-empty", text: "Loading…" }));
    API.hospitalGet().then(function (res) {
      var hosp = res.body && res.body.hospital;
      if (hosp && hosp.hospitalId) { renderEnrollForm(body, hosp, prefill); }
      else { renderHospitalSetup(body, prefill); }
    }).catch(function () { renderHospitalSetup(body, prefill); });
  }
  function renderHospitalSetup(body, prefill) {
    body.innerHTML = "";
    body.appendChild(h("button", { "class": "fc-btn sec", onclick: function () { renderDashboard(body); }, text: "‹ Back" }));
    body.appendChild(h("div", { style: "margin:12px 0;color:var(--slate,#5a7184);font-size:14px", text: "Set your hospital once — every patient you enroll is recorded under it." }));
    var hid = h("input", { type: "text", placeholder: "Hospital ID (e.g. GIMSR)" });
    var hnm = h("input", { type: "text", placeholder: "Hospital name (optional)" });
    var err = h("div");
    var save = h("button", { "class": "fc-btn", text: "Save hospital" });
    save.addEventListener("click", function () {
      err.innerHTML = "";
      var id = String(hid.value || "").trim();
      if (!id) { err.appendChild(h("div", { "class": "fc-err", text: "Enter a hospital ID." })); return; }
      save.disabled = true; save.textContent = "Saving…";
      API.hospitalSet({ hospitalId: id, hospitalName: hnm.value }).then(function (r) {
        save.disabled = false; save.textContent = "Save hospital";
        if (r.body && r.body.ok) renderEnrollForm(body, { hospitalId: id, hospitalName: hnm.value }, prefill);
        else err.appendChild(h("div", { "class": "fc-err", text: "Could not save hospital." }));
      }).catch(function () { save.disabled = false; save.textContent = "Save hospital"; err.appendChild(h("div", { "class": "fc-err", text: "Connection problem." })); });
    });
    [field("Hospital ID", hid), field("Hospital name", hnm)].forEach(function (f) { body.appendChild(f); });
    body.appendChild(err); body.appendChild(save);
  }
  function renderEnrollForm(body, hosp, prefill) {
    prefill = prefill || {};
    // Map a discharge diagnosis to a pathway (reuses the integration mapper) unless one is given directly.
    var pfPathway = prefill.pathwayId || "";
    if (!pfPathway && prefill.diagnosisText) { try { pfPathway = (G.FollowCareIntegration && FollowCareIntegration.diagnosisToPathway(prefill.diagnosisText, prefill.icd)) || ""; } catch (e) {} }
    // Auto-detect the patient's regional language from the GHIS state/address (deterministic) unless one was
    // passed explicitly. Falls back to English. The doctor can still change it before creating the link.
    var detectedLang = "";
    try { var addr = prefill.addressText || prefill.state || prefill.city || ""; if (addr && G.FollowCareI18n) detectedLang = FollowCareI18n.detectLanguage(addr).lang; } catch (e) {}
    var form = { pathwayId: pfPathway, phone: prefill.phone || "", name: prefill.name || "", dischargeMs: (typeof prefill.dischargeMs === "number" ? prefill.dischargeMs : ""), lang: prefill.lang || detectedLang || "en", consentAttested: false, isMinor: false, guardianPhone: "" };
    body.innerHTML = "";
    body.appendChild(h("button", { "class": "fc-btn sec", onclick: function () { renderDashboard(body); }, text: "‹ Back" }));
    body.appendChild(h("div", { style: "margin:8px 0 4px;color:var(--slate,#5a7184);font-size:12.5px", text: "Hospital: " + (hosp.hospitalName || hosp.hospitalId) }));
    if (prefill.name || pfPathway) body.appendChild(h("div", { style: "margin:0 0 8px;color:#0e6e63;font-size:12.5px;font-weight:600", text: "Pre-filled from discharge" + (form.phone ? "" : " — add the patient's mobile number") }));
    var errBox = h("div");
    function loadPathwaysThen(render) { if (PATHWAYS) return render(PATHWAYS); API.pathways().then(function (r) { PATHWAYS = (r.body && r.body.pathways) || []; render(PATHWAYS); }); }
    loadPathwaysThen(function (pw) {
      var sel = h("select", { onchange: function (e) { form.pathwayId = e.target.value; } }, [h("option", { value: "", text: "Select a recovery pathway…" })].concat(pw.map(function (p) { return h("option", { value: p.id, text: p.name }); })));
      if (form.pathwayId) sel.value = form.pathwayId;                                  // preselect mapped pathway
      var phone = h("input", { type: "tel", inputmode: "numeric", placeholder: "Patient mobile number", value: form.phone, oninput: function (e) { form.phone = e.target.value; } });
      var name = h("input", { type: "text", placeholder: "Patient name (optional)", value: form.name, oninput: function (e) { form.name = e.target.value; } });
      var disc = h("input", { type: "date", value: (form.dischargeMs ? isoDate(form.dischargeMs) : ""), oninput: function (e) { form.dischargeMs = e.target.value ? new Date(e.target.value).getTime() : ""; } });
      var langOpts = null; try { langOpts = (G.FollowCareI18n && FollowCareI18n.languages()) || null; } catch (e) {}
      var lang = h("select", { onchange: function (e) { form.lang = e.target.value; } },
        (langOpts ? langOpts.map(function (l) { return h("option", { value: l.code, text: l.code === "en" ? "English" : (l.native + " (" + l.name + ")") + (l.reviewed ? "" : " · English until reviewed") }); })
                  : [h("option", { value: "en", text: "English" }), h("option", { value: "hi", text: "हिन्दी (Hindi)" })]));
      lang.value = form.lang;
      // DPDP §9: enrolling a minor routes ALL messaging to a guardian's phone.
      var guardianField = h("div", { "class": "fc-field", style: "display:none" }, [h("label", { text: "Guardian's mobile number" }), h("input", { type: "tel", inputmode: "numeric", placeholder: "Guardian mobile (required for a minor)", oninput: function (e) { form.guardianPhone = e.target.value; } })]);
      var minor = h("label", { style: "display:flex;align-items:center;gap:8px;font-size:13.5px;margin-bottom:12px" }, [
        h("input", { type: "checkbox", onchange: function (e) { form.isMinor = e.target.checked; guardianField.style.display = e.target.checked ? "block" : "none"; } }),
        document.createTextNode("Patient is a minor (guardian consent)")
      ]);
      // DPDP §5/§6: the doctor attests notice was given + the patient consented before we message them.
      var consent = h("label", { style: "display:flex;align-items:flex-start;gap:8px;font-size:13px;margin:6px 0 14px;color:var(--slate,#5a7184)" }, [
        h("input", { type: "checkbox", onchange: function (e) { form.consentAttested = e.target.checked; } }),
        document.createTextNode("I confirm the patient (or guardian) was informed about these recovery check-in messages and consented.")
      ]);
      var out = h("div");
      var submit = h("button", { "class": "fc-btn", text: "Create recovery link" });
      submit.addEventListener("click", function () {
        errBox.innerHTML = "";
        var v = validateEnroll(form, PATHWAYS ? { get: function (id) { return PATHWAYS.filter(function (p) { return p.id === id; })[0]; } } : null);
        if (!v.ok) { Object.keys(v.errors).forEach(function (k) { errBox.appendChild(h("div", { "class": "fc-err", text: v.errors[k] })); }); return; }
        if (!form.consentAttested) { errBox.appendChild(h("div", { "class": "fc-err", text: enrollError("consent_required") })); return; }
        if (form.isMinor && String(form.guardianPhone).replace(/[^\d]/g, "").length < 10) { errBox.appendChild(h("div", { "class": "fc-err", text: enrollError("guardian_required") })); return; }
        var payload = Object.assign({}, v.value, { consentAttested: true, isMinor: form.isMinor, guardianPhone: form.guardianPhone });
        submit.disabled = true; submit.textContent = "Creating…";
        API.enroll(payload).then(function (res) {
          submit.disabled = false; submit.textContent = "Create recovery link";
          if (res.body && res.body.ok && res.body.link) {
            out.innerHTML = "";
            out.appendChild(h("div", { "class": "fc-link", text: res.body.link }));
            out.appendChild(h("button", { "class": "fc-btn sec", style: "margin-top:8px", onclick: function () { shareLink(res.body.link); }, text: "Copy / share link" }));
          } else {
            errBox.appendChild(h("div", { "class": "fc-err", text: enrollError(res.body && res.body.error) }));
          }
        }).catch(function () { submit.disabled = false; submit.textContent = "Create recovery link"; errBox.appendChild(h("div", { "class": "fc-err", text: "Could not create the link. Check your connection." })); });
      });
      var langLabel = "Patient's language";
      try { if (detectedLang && detectedLang !== "en" && G.FollowCareI18n) langLabel += " (auto-detected: " + FollowCareI18n.langNative(detectedLang) + ")"; } catch (e) {}
      [field("Recovery pathway", sel), field("Mobile number", phone), field("Patient name", name), field("Discharge date", disc), field(langLabel, lang)].forEach(function (f) { body.appendChild(f); });
      body.appendChild(minor); body.appendChild(guardianField); body.appendChild(consent);
      body.appendChild(errBox); body.appendChild(submit); body.appendChild(out);
    });
  }
  function field(label, input) { return h("div", { "class": "fc-field" }, [h("label", { text: label }), input]); }
  function enrollError(code) {
    var M = { bad_pathway: "Please choose a valid recovery pathway.", bad_phone: "Please enter a valid mobile number.", missing_tenant: "Missing hospital. Please set your hospital first.", missing_hospitalId: "Missing hospital. Please set your hospital first.", hospital_not_set: "Please set your hospital before enrolling patients.", hospital_mismatch: "That hospital does not match your account.", consent_required: "Please confirm the patient was informed and consented.", guardian_required: "Enter the guardian's mobile number for a minor.", not_configured: "FollowCare isn't fully set up yet — please try again later.", signin_required: "Please sign in to enroll a patient." };
    return M[code] || "Could not create the recovery link.";
  }
  function shareLink(link) {
    try { if (G.navigator && navigator.share) { navigator.share({ title: "Your recovery check-in", text: "Open your StewardMD recovery check-in:", url: link }); return; } } catch (e) {}
    try { if (G.navigator && navigator.clipboard) { navigator.clipboard.writeText(link); toast("Link copied"); return; } } catch (e) {}
    toast("Copy this link: " + link);
  }

  function renderDetail(episodeId) {
    var body = shell();
    body.innerHTML = "";
    body.appendChild(h("button", { "class": "fc-btn sec", onclick: open, text: "‹ Board" }));
    body.appendChild(h("div", { "class": "fc-empty", text: "Loading…" }));
    API.episode(episodeId).then(function (res) {
      body.innerHTML = "";
      body.appendChild(h("button", { "class": "fc-btn sec", onclick: open, text: "‹ Board" }));
      var ep = res.body && res.body.episode; if (!ep) { body.appendChild(h("div", { "class": "fc-empty", text: "Episode not found." })); return; }
      var m = escalationMeta(ep.escalation);
      var rec = "";
      try { if (G.FollowCareAI) rec = FollowCareAI.recommendation({ escalation: ep.currentEscalation || ep.escalation, trend: ep.trend, needsReview: ep.needsReview, recoveryScore: ep.score }); } catch (e) {}
      body.appendChild(h("div", { style: "margin:12px 0" }, [
        h("div", { style: "font-size:18px;font-weight:800", text: ep.disease || "Recovery" }),
        h("div", { "class": "fc-pill", style: "display:inline-block;margin-top:6px;background:" + m.bg + ";color:" + m.color, text: m.icon + " " + m.label + (ep.score != null && ep.score >= 0 ? "  ·  " + ep.score + "/100" : "") + (ep.riskPercent ? "  ·  " + ep.riskPercent + "% risk" : "") }),
        h("div", { style: "color:var(--slate,#5a7184);font-size:13px;margin-top:6px", text: statusMeta(ep.status) + "  ·  next check-in " + fmtWhen(ep.nextDueMs) + (ep.trend ? "  ·  trend " + ep.trend : "") }),
        rec ? h("div", { style: "margin-top:8px;padding:10px 12px;background:color-mix(in srgb,var(--teal,#0e6e63) 10%,transparent);border-radius:10px;font-size:13.5px;font-weight:600;color:var(--ink,#14202b)", text: "AI recommendation: " + rec }) : null
      ]));
      // Phase 5 — recovery intelligence: twin (expected vs actual), deterioration prediction, prevention plan.
      var intel = res.body && res.body.intel;
      if (intel) {
        var tw = intel.twin || {}, pr = intel.prediction || {}, pv = intel.prevention || {};
        var twTxt = (tw.expected != null && tw.actual != null) ? ("Recovery twin: actual " + tw.actual + " vs expected " + tw.expected + " (" + (tw.gap >= 0 ? "+" : "") + tw.gap + ", " + String(tw.status).replace(/_/g, " ") + ")") : "";
        var prTxt = pr.likelihood ? ("Deterioration risk: " + pr.likelihood + (pr.windowHours ? " (~" + pr.windowHours + "h window)" : "")) : "";
        var box = h("div", { style: "margin:12px 0;padding:12px 14px;border:1px solid var(--line,#dbe4e2);border-radius:12px;background:var(--panel,#fff)" }, [
          h("div", { style: "font-weight:800;font-size:13px;color:#0e6e63;margin-bottom:6px", text: "Recovery Intelligence" }),
          twTxt ? h("div", { style: "font-size:13px;margin-bottom:3px", text: twTxt }) : null,
          prTxt ? h("div", { style: "font-size:13px;margin-bottom:3px", text: prTxt + (pr.reasons && pr.reasons.length ? " — " + pr.reasons.slice(0, 2).join("; ") : "") }) : null,
          (pv.actions && pv.actions.length) ? h("div", { style: "font-size:12.5px;color:var(--slate,#5a7184);margin-top:4px", text: "Suggested (doctor decides): " + pv.actions.join(" · ") }) : null
        ]);
        body.appendChild(box);
      }
      var tl = h("div", { "class": "fc-tl" });
      ((res.body && res.body.timeline) || []).forEach(function (ev) {
        var em = escalationMeta(ev.escalation);
        tl.appendChild(h("div", { "class": "fc-ev" }, [
          h("div", { "class": "fc-d", text: "Day " + ev.dayOffset + "  ·  " + em.label + (ev.score != null ? "  ·  " + ev.score + "/100" : "") }),
          (ev.redFlags && ev.redFlags.length) ? h("div", { "class": "fc-r", text: ev.redFlags.map(function (f) { return f.reason || f.id; }).join("; ") }) : (ev.reasons && ev.reasons.length ? h("div", { "class": "fc-r", text: ev.reasons.join("; ") }) : null)
        ]));
      });
      body.appendChild(tl);
      // Doctor Action Center — the prominent way to communicate with this patient (flag smd_followcare_actions).
      if (actionsEnabled() && CM) {
        var dac = h("button", { "class": "fc-btn", style: "margin-top:16px;width:100%", text: "🩺 Doctor Actions" });
        dac.addEventListener("click", function () { openActions(episodeId, ep); });
        body.appendChild(dac);
        var hist = h("button", { "class": "fc-btn sec", style: "margin-top:10px;width:100%", text: "🗂 Communication history" });
        hist.addEventListener("click", function () { renderCommHistory(episodeId, ep); });
        body.appendChild(hist);
      }
      // Acknowledge clears the "needs review" flag (an escalated episode leaves the list only by clinician action).
      if (ep.escalation === "red" || ep.escalation === "orange") {
        var ack = h("button", { "class": "fc-btn", style: "margin-top:14px", text: "Mark reviewed" });
        ack.addEventListener("click", function () { ack.disabled = true; API.ack(episodeId).then(function () { toast("Marked reviewed"); renderDetail(episodeId); }); });
        body.appendChild(ack);
      }
      var rev = h("button", { "class": "fc-btn sec", style: "margin-top:10px", text: "Revoke patient link" });
      rev.addEventListener("click", function () { API.revoke(episodeId).then(function () { toast("Link revoked"); }); });
      body.appendChild(rev);
      // Right-to-erasure: permanently delete this patient's episode + all check-in data.
      var er = h("button", { "class": "fc-btn sec", style: "margin-top:10px;color:#b3261e;border-color:#b3261e", text: "Delete patient data" });
      er.addEventListener("click", function () {
        if (!(G.confirm && confirm("Permanently delete this patient's recovery episode and all check-ins? This cannot be undone."))) return;
        er.disabled = true; API.erase(episodeId).then(function () { toast("Patient data deleted"); open(); });
      });
      body.appendChild(er);
    }).catch(function () { body.innerHTML = ""; body.appendChild(h("div", { "class": "fc-empty", text: "Could not load the episode." })); });
  }

  // ---- Doctor Action Center (flag smd_followcare_actions) ---------------------------------
  var TMPL_KEY = "smd_fc_instr_templates";
  var BUILTIN_TMPL = [
    "Continue your medicines exactly as prescribed.", "Reduce your salt intake.", "Restrict fluids to 1.5 L per day.",
    "Continue your breathing exercises.", "Walk for 20 minutes daily.", "Please avoid alcohol.", "Continue insulin as advised."
  ];
  function savedTemplates() { try { return JSON.parse(G.localStorage.getItem(TMPL_KEY) || "[]") || []; } catch (e) { return []; } }
  function saveTemplate(t) { try { var a = savedTemplates(); if (t && a.indexOf(t) === -1) { a.unshift(t); G.localStorage.setItem(TMPL_KEY, JSON.stringify(a.slice(0, 20))); } } catch (e) {} }

  function actionSheet(episodeId, ep, backFn) {
    var body = shell(); body.innerHTML = "";
    body.appendChild(h("button", { "class": "fc-btn sec", onclick: backFn, text: "‹ Back" }));
    return body;
  }
  function openActions(episodeId, ep) {
    if (!CM) { toast("Doctor Actions loading…"); return; }
    var body = actionSheet(episodeId, ep, function () { renderDetail(episodeId); });
    body.appendChild(h("div", { style: "font-size:17px;font-weight:800;margin:12px 0 3px", text: "Doctor Actions" }));
    body.appendChild(h("div", { style: "color:var(--slate,#5a7184);font-size:12.5px;margin-bottom:14px", text: (ep && ep.disease ? ep.disease + " · " : "") + "Communicate with your patient. Everything is logged and auditable." }));
    var grid = h("div", { "class": "fc-actgrid" });
    CM.types().forEach(function (t) {
      var tile = h("button", { "class": "fc-act" + (t.priority === "high" ? " high" : "") + (t.comingSoon ? " soon" : ""), "aria-label": t.label }, [
        h("span", { "class": "fc-ai", "aria-hidden": "true", text: t.icon }),
        h("span", { "class": "fc-al", text: t.label }),
        t.comingSoon ? h("span", { "class": "fc-soon", text: "Coming soon" }) : null
      ]);
      if (!t.comingSoon) tile.addEventListener("click", function () { renderActionForm(episodeId, ep, t.id); });
      grid.appendChild(tile);
    });
    body.appendChild(grid);
    var hist = h("button", { "class": "fc-act", style: "grid-column:1/-1;flex-direction:row;align-items:center", onclick: function () { renderCommHistory(episodeId, ep); } }, [
      h("span", { "class": "fc-ai", "aria-hidden": "true", text: "🗂" }), h("span", { "class": "fc-al", text: "Communication History" })
    ]);
    body.appendChild(hist);
  }

  function renderActionForm(episodeId, ep, type) {
    var def = CM.typeDef(type); if (!def || def.comingSoon) return;
    var body = actionSheet(episodeId, ep, function () { openActions(episodeId, ep); });
    body.appendChild(h("div", { style: "font-size:17px;font-weight:800;margin:12px 0 12px", text: def.icon + "  " + def.label }));
    var errBox = h("div"), form = { type: type, fields: [] };
    var wrap = h("div");

    function textareaField(placeholder, aiKind) {
      var ta = h("textarea", { "class": "fc-ta", placeholder: placeholder || "" });
      ta.addEventListener("input", function () { form.body = ta.value; });
      if (aiKind) {
        var ai = h("button", { "class": "fc-btn sec", style: "margin:8px 0;font-size:13px;padding:9px 12px;min-height:auto", text: "✨ Suggest a draft (you approve)" });
        ai.addEventListener("click", function () {
          ai.disabled = true; ai.textContent = "Drafting…";
          API.draft(episodeId, aiKind).then(function (r) {
            ai.disabled = false; ai.textContent = "✨ Suggest a draft (you approve)";
            var d = r.body && r.body.draft; if (d) { ta.value = d; form.body = d; }
          }, function () { ai.disabled = false; ai.textContent = "✨ Suggest a draft (you approve)"; });
        });
        wrap.appendChild(h("div", { "class": "fc-ai-draft", text: "AI can suggest a draft. You must review and approve before it is sent — nothing is sent automatically." }));
        wrap.appendChild(ai);
      }
      wrap.appendChild(ta);
      return ta;
    }

    if (type === "instruction") {
      var ta = textareaField("Type an instruction for the patient…", "instruction");
      var chips = h("div", { style: "margin:10px 0" });
      BUILTIN_TMPL.concat(savedTemplates()).forEach(function (t) {
        chips.appendChild(h("span", { "class": "fc-tmpl", onclick: function () { ta.value = t; form.body = t; }, text: t }));
      });
      wrap.appendChild(chips);
      var save = h("button", { "class": "fc-btn sec", style: "font-size:12.5px;padding:8px 11px;min-height:auto", text: "☆ Save current as template" });
      save.addEventListener("click", function () { if (form.body) { saveTemplate(form.body); toast("Template saved"); renderActionForm(episodeId, ep, type); } });
      wrap.appendChild(save);
    } else if (type === "question") {
      textareaField("Ask the patient a question…", "question");
    } else if (type === "emergency") {
      wrap.appendChild(h("div", { style: "background:color-mix(in srgb,#d33 9%,transparent);border:1px solid #d33;border-radius:11px;padding:10px 12px;font-size:12.5px;margin-bottom:8px", text: "This sends a high-priority emergency advisory. It does not replace calling emergency services." }));
      textareaField("Emergency advice…", "emergency");
    } else if (type === "photo_request") {
      wrap.appendChild(h("div", { "class": "fc-field" }, [h("label", { text: "What should the patient photograph? (optional)" }), (function () { var i = h("input", { type: "text", placeholder: "e.g. surgical wound, rash, diabetic foot" }); i.addEventListener("input", function () { form.examples = i.value; }); return i; })()]));
      wrap.appendChild(h("div", { style: "font-size:12.5px;color:var(--slate,#5a7184)", text: "The patient uploads securely from their phone; you'll see it in the timeline. Photos are encrypted and auto-deleted after a short period (data-minimisation)." }));
    } else if (type === "vitals_request") {
      wrap.appendChild(h("div", { style: "font-weight:650;font-size:13.5px;margin-bottom:6px", text: "Which measurements should the patient send?" }));
      CM.vitalsCatalogue().forEach(function (v) {
        var cb = h("input", { type: "checkbox" });
        cb.addEventListener("change", function () { if (cb.checked) form.fields.push(v.key); else form.fields = form.fields.filter(function (x) { return x !== v.key; }); });
        wrap.appendChild(h("label", { "class": "fc-chk" }, [cb, document.createTextNode(v.label + " (" + v.unit + ")")]));
      });
    } else if (type === "earlier_review") {
      var sel = h("select", {}, [
        h("option", { value: "", text: "Choose when…" }),
        h("option", { value: "today", text: "Today" }), h("option", { value: "tomorrow", text: "Tomorrow" }),
        h("option", { value: "within_3_days", text: "Within 3 days" }), h("option", { value: "next_available", text: "Next available" })
      ]);
      sel.addEventListener("change", function () { form.when = sel.value; });
      wrap.appendChild(h("div", { "class": "fc-field" }, [h("label", { text: "Requested review" }), sel]));
      var ta2 = h("textarea", { "class": "fc-ta", placeholder: "Optional message (e.g. why to come earlier)…" }); ta2.addEventListener("input", function () { form.body = ta2.value; });
      wrap.appendChild(ta2);
    } else if (type === "education") {
      var esel = h("select", {}, [h("option", { value: "", text: "Choose material…" })].concat(CM.educationCatalogue().map(function (e) { return h("option", { value: e.ref, text: e.title }); })));
      esel.addEventListener("change", function () { form.ref = esel.value; });
      wrap.appendChild(h("div", { "class": "fc-field" }, [h("label", { text: "Educational material" }), esel]));
    } else if (type === "close_episode") {
      var rsel = h("select", {}, [
        h("option", { value: "", text: "Reason…" }),
        h("option", { value: "recovered", text: "Recovered" }), h("option", { value: "transferred", text: "Transferred" }),
        h("option", { value: "lost_to_followup", text: "Lost to follow-up" }), h("option", { value: "expired", text: "Expired" }), h("option", { value: "other", text: "Other" })
      ]);
      rsel.addEventListener("change", function () { form.reason = rsel.value; });
      wrap.appendChild(h("div", { "class": "fc-field" }, [h("label", { text: "Close reason" }), rsel]));
      var nta = h("textarea", { "class": "fc-ta", placeholder: "Optional notes…" }); nta.addEventListener("input", function () { form.notes = nta.value; });
      wrap.appendChild(nta);
    }
    body.appendChild(wrap);
    body.appendChild(errBox);

    var submitLabel = type === "emergency" ? "Review & send emergency advice" : (type === "close_episode" ? "Close episode" : "Send");
    var submit = h("button", { "class": "fc-btn", style: "margin-top:14px;width:100%", text: submitLabel });
    submit.addEventListener("click", function () {
      errBox.innerHTML = "";
      var v = CM.validateAction(type, form);
      if (!v.ok) { Object.keys(v.errors).forEach(function (k) { errBox.appendChild(h("div", { "class": "fc-err", text: v.errors[k] })); }); return; }
      if (def.confirm) {
        var q = type === "emergency" ? "Send this emergency advisory to the patient now?" : "Close this FollowCare episode? The patient will be told their follow-up is complete.";
        if (!(G.confirm && confirm(q))) return;
      }
      submit.disabled = true; submit.textContent = "Sending…";
      var payload = Object.assign({ episodeId: episodeId, doctorName: (G.SMD_DOCTOR_NAME || "") }, form);
      API.action(payload).then(function (res) {
        if (res.body && res.body.ok) { toast(type === "close_episode" ? "Episode closed" : "Sent to patient"); renderDetail(episodeId); }
        else {
          submit.disabled = false; submit.textContent = submitLabel;
          var f = res.body && res.body.fields;
          errBox.appendChild(h("div", { "class": "fc-err", text: f ? Object.keys(f).map(function (k) { return f[k]; }).join(" ") : "Could not send. Please try again." }));
        }
      }, function () { submit.disabled = false; submit.textContent = submitLabel; errBox.appendChild(h("div", { "class": "fc-err", text: "Connection problem. Please try again." })); });
    });
    body.appendChild(submit);
  }

  // Photos are behind the app-gate + Firebase auth, so fetch WITH the Bearer header → blob → open (a plain
  // <a> would 401). Object URL is opened in a new tab; no PHI in the key.
  function viewMedia(key) {
    idToken().then(function (tok) {
      G.fetch(BASE + "/media?key=" + encodeURIComponent(key), { headers: hdr(tok) }).then(function (r) {
        if (!r.ok) { toast("Could not load photo"); return; }
        r.blob().then(function (b) { try { G.open(URL.createObjectURL(b), "_blank"); } catch (e) { toast("Could not open photo"); } });
      }, function () { toast("Could not load photo"); });
    });
  }
  function fmtCommTime(ms) { try { return new Date(ms).toLocaleString(); } catch (e) { return ""; } }
  function renderCommHistory(episodeId, ep) {
    var body = actionSheet(episodeId, ep, function () { renderDetail(episodeId); });
    body.appendChild(h("div", { style: "font-size:17px;font-weight:800;margin:12px 0 12px", text: "Communication History" }));
    var list = h("div"); body.appendChild(list);
    list.appendChild(h("div", { "class": "fc-empty", text: "Loading…" }));
    API.comms(episodeId).then(function (res) {
      list.innerHTML = "";
      var items = (res.body && res.body.items) || [];
      if (!items.length) { list.appendChild(h("div", { "class": "fc-empty", text: "No communication yet." })); return; }
      items.forEach(function (c) {
        var inbound = c.dir === "in";
        var label = CM.entryLabel(c);
        var card = h("div", { "class": "fc-cm" + (inbound ? " in" : "") + (c.priority === "high" ? " high" : "") }, [
          h("div", { "class": "fc-cm-h" }, [
            document.createTextNode((inbound ? "⬅ " : "➡ ") + label),
            h("span", { "class": "fc-cm-st", text: inbound ? "" : (c.status || "sent") })
          ]),
          c.body ? h("div", { "class": "fc-cm-b", text: c.body }) : null,
          commPayloadEl(c),
          h("div", { style: "font-size:11px;color:var(--slate,#5a7184);margin-top:5px", text: fmtCommTime(c.createdMs) })
        ]);
        list.appendChild(card);
      });
    }).catch(function () { list.innerHTML = ""; list.appendChild(h("div", { "class": "fc-empty", text: "Could not load history." })); });
  }
  // Render the structured payload of a comm entry (vitals values, requested fields, photos, review date, etc.).
  function commPayloadEl(c) {
    var p = c.payload || {};
    if (c.type === "vitals" && p.vitals) {
      var parts = Object.keys(p.vitals).map(function (k) { var vd = CM.VITALS[k]; var val = p.vitals[k]; if (val && typeof val === "object") val = val.sys + "/" + val.dia; return (vd ? vd.label : k) + ": " + val + (vd ? " " + vd.unit : ""); });
      return h("div", { "class": "fc-cm-b", text: parts.join("  ·  ") });
    }
    if (c.type === "vitals_request" && p.fields) return h("div", { style: "font-size:12.5px;color:var(--slate,#5a7184)", text: "Requested: " + p.fields.map(function (k) { return (CM.VITALS[k] || {}).label || k; }).join(", ") });
    if ((c.type === "photo" || p.mediaKeys) && p.mediaKeys && p.mediaKeys.length) {
      return h("div", {}, p.mediaKeys.map(function (k) { return h("button", { "class": "fc-btn sec", style: "margin:4px 6px 0 0;font-size:12.5px;padding:7px 11px;min-height:auto", onclick: function () { viewMedia(k); }, text: "📷 View photo" }); }));
    }
    if (c.type === "earlier_review" && p.when) return h("div", { style: "font-size:12.5px;color:var(--slate,#5a7184)", text: "Review: " + String(p.when).replace(/_/g, " ") });
    if (c.type === "education" && p.ref) return h("div", { style: "font-size:12.5px;color:var(--slate,#5a7184)", text: "Material: " + p.ref });
    if (c.type === "close_episode" && p.reason) return h("div", { style: "font-size:12.5px;color:var(--slate,#5a7184)", text: "Closed: " + String(p.reason).replace(/_/g, " ") + (p.notes ? " — " + p.notes : "") });
    return null;
  }

  var PUB = {
    open: open, openEnroll: openEnroll, close: close, enabled: enabled,
    openActions: openActions, actionsEnabled: actionsEnabled,
    // pure, testable:
    validateEnroll: validateEnroll, escalationMeta: escalationMeta, statusMeta: statusMeta,
    sortEpisodes: sortEpisodes, fmtWhen: fmtWhen, counts: counts, enrollError: enrollError,
    _api: API, _version: 1
  };
  if (typeof module !== "undefined" && module.exports) module.exports = PUB;
  G.FollowCare = PUB;
})();
