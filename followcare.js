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
    ready: function () { return req("GET", "/ready"); }
  };

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

  var PUB = {
    open: open, openEnroll: openEnroll, close: close, enabled: enabled,
    // pure, testable:
    validateEnroll: validateEnroll, escalationMeta: escalationMeta, statusMeta: statusMeta,
    sortEpisodes: sortEpisodes, fmtWhen: fmtWhen, counts: counts, enrollError: enrollError,
    _api: API, _version: 1
  };
  if (typeof module !== "undefined" && module.exports) module.exports = PUB;
  G.FollowCare = PUB;
})();
