/* wardsynq/site/shell.js - wardsynq.com: sign in, choose the hospital, and open WardSynQ.
 *
 * Buildless ES5, same transport contract as ward.js and the OPD console: a staff session lives in
 * localStorage "smd_opd_staff_tok" and travels as X-Staff-Token; a StewardMD account travels as a
 * Firebase bearer through window.SMD_AUTH.token(). The hospital is "smd_opd_hospital" and, for the
 * ward, "smd_opd_workplace" = "wardsynq:<orgId>" - the SAME keys those files already read, so the
 * door, the ward and the OPD desk can never disagree about who is signed in where.
 *
 * This file owns only the door and the map. Clinical surfaces are ward.js (window.WARD), the OPD
 * console (/opd.html) and the order-safety workstation (/wardsynq/ui/wardsynq.html). Pages that are
 * new to this site (patients, admin, audit, MaiK) register through WSQ.page() from pages/*.js and
 * talk to the same server routes those surfaces already use.
 */
(function () {
  "use strict";
  var G = window;
  var API = "/api/queue";
  var LS = { tok: "smd_opd_staff_tok", tt: "smd_opd_toktype", hosp: "smd_opd_hospital", wp: "smd_opd_workplace", navLang: "wsqStaffNavLang" };
  var st = { tokType: "", tok: "", orgId: "", who: null, org: null, orgs: null, page: "", arg: "", fbUser: null, fbReady: false, navLang: "en" };
  var PAGES = {};

  // ---- small helpers -----------------------------------------------------------------------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ms(name) { return '<span class="ms" aria-hidden="true">' + name + "</span>"; }
  function $(id) { return document.getElementById(id); }
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function toast(msg) {
    var t = $("wsqToast"); if (!t) { t = document.createElement("div"); t.id = "wsqToast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }
  G.toast = G.toast || toast;
  function when(ms_) { return new Promise(function (r) { setTimeout(r, ms_); }); }

  /* ---- staff language (owner decisions 2026-09-15) -------------------------------------------------
   * Picking a staff language translates the WHOLE staff interface: the rail, the toolbar, the sign-in
   * screens and dialogs here, and every page in pages/*.js through ctx.t. It replaces the earlier
   * nav-labels-only rule. What is NEVER translated is anything recorded or sent by the server - patient
   * and staff names, codes, drug names, doses, results, hospital and ward names, audit values - and
   * such values carry lang="en" (ctx.en) so a screen reader does not read English in another voice.
   * document.documentElement.lang follows the chosen language.
   *
   * T(c, key, en, vars): the key's text in the staff language, English when the language lacks it,
   * and `en` itself when i18n.js is not on the page (the tests that render a page without it). Plain
   * text: the caller escapes. Keys and their English live in i18n.js; `en` must equal EN[key] byte
   * for byte (test/wsq-site-i18n-catalog.test.mjs).
   * TS(c, key, en, vars): the same, as escaped HTML, with the English original underneath in smaller
   * text when the language is not English. For refusals and failures a clinician must not misread.
   * Loading: reuses print-lang.js's ensureLoaded() and its wardsynq/site/i18n/<code>.js cache token. */
  function fill(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function curLang() { return G.WSQI18n ? G.WSQI18n.normalize(st.navLang) : "en"; }
  function T(_c, key, en, vars) {
    var s = G.WSQI18n ? G.WSQI18n.t(key, vars, st.navLang) : key;
    return s === key && en != null ? fill(en, vars) : s;
  }
  function TS(_c, key, en, vars) {
    var shown = T(null, key, en, vars);
    if (curLang() === "en") return esc(shown);
    var english = G.WSQI18n ? G.WSQI18n.t(key, vars, "en") : key;
    if (english === key && en != null) english = fill(en, vars);
    return esc(shown) + (english !== shown ? '<span class="en-orig" lang="en">' + esc(english) + "</span>" : "");
  }
  function EN(_c, html) { return curLang() === "en" ? html : '<span lang="en">' + html + "</span>"; }
  function navTr(key) { return G.WSQI18n ? G.WSQI18n.t(key, null, st.navLang) : key; }
  function setDocLang() { try { document.documentElement.lang = curLang(); } catch (e) {} }
  function setNavLang(code) {
    var apply = function () {
      st.navLang = (G.WSQI18n && G.WSQI18n.offered(code)) ? code : "en";
      lsSet(LS.navLang, st.navLang === "en" ? "" : st.navLang);
      setDocLang();
      render(st.page);
    };
    if (code !== "en" && G.WSQPrint && G.WSQPrint.ensureLoaded) G.WSQPrint.ensureLoaded(code, apply); else apply();
  }
  function langPicker() {
    var langs = G.WSQI18n ? G.WSQI18n.languages() : [{ code: "en", name: "English" }];
    var opts = langs.map(function (l) { return '<option value="' + esc(l.code) + '"' + (l.code === st.navLang ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("");
    return '<label class="nav-lang"><span class="sr-only">' + esc(navTr("lang.label")) + '</span><select id="navLangPick">' + opts + "</select></label>";
  }
  document.addEventListener("change", function (e) { if (e.target && e.target.id === "navLangPick") setNavLang(e.target.value); });

  // ---- identity: the SAME two credentials ward.js and the OPD console accept ----------------
  G.SMD_AUTH = {
    token: function () {
      try { if (st.tokType === "account" && G.firebase && firebase.auth().currentUser) return firebase.auth().currentUser.getIdToken(); } catch (e) {}
      return null;
    }
  };
  function headers() {
    if (st.tokType === "staff" && st.tok) return Promise.resolve({ "Content-Type": "application/json", "X-Staff-Token": st.tok });
    return Promise.resolve(G.SMD_AUTH.token()).then(function (t) { var h = { "Content-Type": "application/json" }; if (t) h.Authorization = "Bearer " + t; return h; });
  }
  function fetchRetry(url, opts, tries) {
    tries = tries || 3;
    return fetch(url, opts).catch(function (e) { if (tries <= 1) throw e; return when(700).then(function () { return fetchRetry(url, opts, tries - 1); }); });
  }
  /** api("/whoami") or api("/onboard/wardsynq", {name}) -> parsed JSON (never throws on HTTP errors). */
  function api(path, body, base) {
    var url = (base || API) + path;
    return headers().then(function (h) {
      return fetchRetry(url, body === undefined ? { headers: h, credentials: "include" } : { method: "POST", headers: h, credentials: "include", body: JSON.stringify(body || {}) });
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: "bad_response", status: r.status }; }); })
      .catch(function (e) { return { ok: false, error: "network", detail: String(e && e.message || e) }; });
  }
  /** download("/ward/fhir/$export-file/j/Patient-1.ndjson?orgId=o", "Patient-1.ndjson") -> {ok} or {ok:false, message}.
   *  The bytes are fetched with this session's credentials and saved from a local object URL, so the page
   *  never holds a link that works without them. A refusal comes back as the server's own words. */
  function download(path, name, base) {
    return headers().then(function (h) { return fetch((base || API) + path, { headers: h, credentials: "include" }); }).then(function (res) {
      var type = res.headers.get("Content-Type") || "";
      if (res.ok && type.indexOf("json") < 0) {
        return res.blob().then(function (blob) {
          var url = URL.createObjectURL(blob), a = document.createElement("a");
          a.href = url; a.download = name || "download";
          document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
          return { ok: true };
        });
      }
      return res.json().then(null, function () { return {}; }).then(function (j) {
        var why = (j.issue && j.issue[0] && j.issue[0].diagnostics) || j.message || j.error || ("the server answered " + res.status);
        return { ok: false, status: res.status, message: why };
      });
    }).catch(function (e) { return { ok: false, error: "network", message: "The download could not reach the server." }; });
  }
  function can(cap) { return !!(st.who && st.who.caps && st.who.caps.indexOf(cap) >= 0); }
  /* A demonstration hospital says so, on every screen, permanently. Demo and real tenant data are
   * separate records, but that separation is invisible to somebody looking at a chart over a
   * shoulder - and a fabricated patient that reads as a real one is the whole hazard. The signal is
   * the hospital's own name, which the seeder refuses to write without it. */
  function isDemo(org) { return /\bdemo\b/i.test(String((org && (org.name || "")) || "")); }
  function isWardsynq() { return !!(st.org && st.org.mode === "wardsynq"); }

  // ---- session ------------------------------------------------------------------------------
  function setSession(tokType, tok, orgId) {
    st.tokType = tokType; st.tok = tok || "";
    lsSet(LS.tt, tokType); lsSet(LS.tok, tok || "");
    if (orgId) selectOrg(orgId, true);
  }
  function selectOrg(orgId, quiet) {
    st.orgId = orgId; st.org = null;
    lsSet(LS.hosp, orgId); lsSet(LS.wp, orgId ? "wardsynq:" + orgId : "");
    if (!quiet) go("landing");
  }
  /* BUG-MU2PHANW: REMOVING A HOSPITAL, the owner's act, in two deliberate steps. First what happens
   * (it leaves the lists; the clinical record, documents and audit trail are kept, as the law requires),
   * then the word DELETE typed exactly. The server checks the owner and the word again; nothing here
   * says removed until the server has written it. Offered from #/hospitals and Admin > Hospital. */
  function removeHospital(org, done) {
    var d = document.createElement("dialog");
    d.className = "wsq-dialog"; d.setAttribute("aria-labelledby", "rmHospTitle");
    var name = String(org.name || org.id || "");
    function close() { try { d.close(); } catch (e) {} if (d.parentNode) d.parentNode.removeChild(d); }
    function stepOne() {
      d.innerHTML = '<h2 id="rmHospTitle">' + TS(null, "site.shell.removeHosp.titleQ", "Remove {name}?", { name: name }) + "</h2>" +
        "<p>" + TS(null, "site.shell.removeHosp.willDisappear", "{name} will disappear from the hospital list for everyone, and nobody will be able to choose it.", { name: name }) + "</p>" +
        "<p><b>" + TS(null, "site.shell.removeHosp.noRecordDeleted", "No clinical record is deleted.") + "</b> " + TS(null, "site.shell.removeHosp.recordsKept", "Patient records, documents and the audit trail are kept, because medical records must be retained by law. The removal itself is written to the audit trail.") + "</p>" +
        '<div class="acts"><button class="btn" type="button" data-rm="cancel" autofocus>' + esc(T(null, "site.shell.cancel", "Cancel")) + '</button><button class="btn danger" type="button" data-rm="next">' + esc(T(null, "site.shell.removeHosp.continue", "Continue")) + '</button></div>';
      d.querySelector('[data-rm="cancel"]').onclick = close;
      d.querySelector('[data-rm="next"]').onclick = stepTwo;
    }
    function stepTwo() {
      d.innerHTML = '<h2 id="rmHospTitle">' + TS(null, "site.shell.removeHosp.typeDelete", "Type DELETE to remove {name}", { name: name }) + "</h2>" +
        '<label class="f"><span>' + esc(T(null, "site.shell.removeHosp.typeDeleteCaps", "Type DELETE in capitals")) + '</span><input id="rmHospWord" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
        '<div id="rmHospMsg"></div>' +
        '<div class="acts"><button class="btn" type="button" data-rm="cancel">' + esc(T(null, "site.shell.cancel", "Cancel")) + '</button><button class="btn danger" type="button" data-rm="go" disabled>' + esc(T(null, "site.shell.removeHosp.removeBtn", "Remove hospital")) + '</button></div>';
      var word = d.querySelector("#rmHospWord"), go_ = d.querySelector('[data-rm="go"]');
      d.querySelector('[data-rm="cancel"]').onclick = close;
      word.oninput = function () { go_.disabled = word.value !== "DELETE"; };
      word.focus();
      go_.onclick = function () {
        if (word.value !== "DELETE") return;
        go_.disabled = true; word.disabled = true;
        api("/org/delete", { orgId: org.id, confirm: word.value }).then(function (r) {
          if (r && r.ok) {
            close(); toast(T(null, "site.shell.removeHosp.removed", "Hospital removed. Its records are kept."));
            if (st.orgId === org.id) { st.org = null; selectOrg("", true); }
            if (done) done();
            return;
          }
          word.disabled = false; go_.disabled = word.value !== "DELETE";
          var whyHtml = r && r.error === "owner_only" ? TS(null, "site.shell.removeHosp.ownerOnly", "Only the hospital's owner can remove it.") :
            r && r.error === "confirm_required" ? TS(null, "site.shell.removeHosp.confirmRequired", "Type DELETE exactly, in capitals.") :
            r && r.error === "network" ? TS(null, "site.shell.removeHosp.networkFailed", "Could not reach the server. Nothing was removed.") :
            TS(null, "site.shell.removeHosp.notRemoved", "The hospital was not removed ({reason}).", { reason: (r && r.error) || "failed" });
          d.querySelector("#rmHospMsg").innerHTML = '<div class="msg err">' + whyHtml + "</div>";
        });
      };
    }
    d.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    document.body.appendChild(d);
    stepOne();
    d.showModal();
  }
  function signOut() {
    /* G2: bedside entries kept on this device while offline leave with the person who charted them. Signing
     * out with some still unsent deletes them from this device, so it is said first and can be refused. */
    var off = G.WARD_OFFLINE && G.WARD_OFFLINE.device() ? G.WARD_OFFLINE.device().state() : null;
    var held = off ? (off.waiting || 0) + (off.conflicts || 0) + (off.refused || 0) : 0;
    if (held) {
      var sure = true;
      try {
        sure = G.confirm(held === 1
          ? T(null, "site.shell.signOut.confirmOne", "{n} bedside entry is saved on this device and not in the record. Signing out deletes it from this device.\n\nSign out anyway? Cancel stays signed in, so you can send or review them in the ward.", { n: held })
          : T(null, "site.shell.signOut.confirmMany", "{n} bedside entries are saved on this device and not in the record. Signing out deletes them from this device.\n\nSign out anyway? Cancel stays signed in, so you can send or review them in the ward.", { n: held }));
      } catch (e) {}
      if (!sure) return;
    }
    try { if (G.WARD_OFFLINE) G.WARD_OFFLINE.clearDevice(); } catch (e) {}
    var wasAccount = st.tokType === "account";
    st.tokType = ""; st.tok = ""; st.orgId = ""; st.who = null; st.org = null; st.orgs = null;
    lsSet(LS.tt, ""); lsSet(LS.tok, ""); lsSet(LS.hosp, ""); lsSet(LS.wp, "");
    try { if (G.WARD) G.WARD.close(); } catch (e) {}
    var p = Promise.resolve();
    if (wasAccount) { try { p = firebase.auth().signOut(); } catch (e) {} }
    p.then(function () { go("login"); }, function () { go("login"); });
  }

  // ---- router ---------------------------------------------------------------------------------
  function go(page, arg) {
    var target = "#/" + page + (arg ? "/" + encodeURIComponent(arg) : "");
    if (location.hash === target) {
      route();
    } else {
      location.hash = target;
    }
  }
  /* Two-step sign-in: the PIN or password was right, and the account wants a code from the phone. The
   * server's answer is passed through untouched, so a wrong code reads as a wrong code, not a PIN. */
  function secondStep(r) {
    var code = "";
    var lead = r.message || T(null, "site.shell.mfa.defaultPrompt", "Enter the 6-digit code from your authenticator app.");
    try { code = G.prompt(lead + "\n\n" + String(T(null, "site.shell.mfa.backupHint", "Lost your phone? Enter a backup code instead.")).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; })) || ""; } catch (e) {}
    if (!code.trim()) return { cancelled: true };
    return fetch(API + "/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge: r.challenge, code: code.trim() }) })
      .then(function (x) { return x.json(); });
  }
  function parseHash() {
    var h = (location.hash || "").replace(/^#\/?/, "").split("/");
    return { page: h[0] || "", arg: h.length > 1 ? decodeURIComponent(h.slice(1).join("/")) : "" };
  }
  function route() {
    var r = parseHash();
    if (r.page !== "ward" && G.WARD && st.page === "ward") { try { G.WARD.onClose = null; G.WARD.close(); } catch (e) {} }
    st.page = r.page; st.arg = r.arg;
    if (!st.tokType) return render("login");
    if (r.page === "login") return render("login");
    if (r.page === "logout") return signOut();
    if (!st.who) return whoami().then(route);
    /* The hospital requires two-step sign-in for this role and it is not set up. The server refuses
     * everything else anyway; this just takes the person to the one page that will work, before any
     * hospital data is asked for (which would only be refused). */
    if (st.who.twoStepRequired) return r.page === "security" ? render("security") : go("security");
    if (r.page === "hospitals") return render("hospitals");
    // A group administrator need not work in any one hospital, so the group overview needs none chosen.
    if (r.page === "group" && PAGES.group) return render("group");
    /* The demonstration-hospital builder runs BEFORE a hospital is chosen, because its whole job is
     * to create one. Every other page below needs st.org loaded; this one would be bounced straight
     * back to the hospital list by the next line and could never run. */
    if (!st.orgId) return render("hospitals");
    if (!st.org) return loadOrg().then(function () { return st.org ? route() : render("hospitals"); });
    /* LAND ON THE MAP, not the order-safety workstation.
     *
     * The workstation is a separate page that does NOT initialise Firebase, so an account sign-in
     * reaches it with no bearer at all and the record service answers 401: "record service refused
     * to open (401). Safety checking is unavailable, so ordering is disabled." That is the first
     * thing a new user saw after signing in. The map works for every sign-in, and the workstation is
     * still one click away from it once its own auth is wired. */
    if (r.page === "landing") return go("home");
    if (!r.page || r.page === "home") return render("home");
    if (r.page === "ward") return openWard(r.arg);
    if (r.page === "opd") { location.href = "/opd.html"; return; }
    if (r.page === "workstation") { location.href = workstationUrl(); return; }
    if (PAGES[r.page]) return render(r.page);
    return render("home");
  }
  function workstationUrl() {
    var t = st.org && st.org.connectTenantId;
    if (isDemo(st.org) || !t || t === "none" || t === "undefined" || t === "null") {
      return "/wardsynq/ui/wardsynq.html?site=1" + (isDemo(st.org) ? "&demo=1" : "");
    }
    return "/wardsynq/ui/wardsynq.html?record=" + encodeURIComponent(t) + "&site=1";
  }
  function whoami() {
    return api("/whoami" + (st.orgId ? "?orgId=" + encodeURIComponent(st.orgId) : "")).then(function (r) {
      if (!r || !r.ok) {
        if (r && (r.error === "unauthorized" || r.status === 401)) { st.tokType = ""; st.tok = ""; lsSet(LS.tt, ""); lsSet(LS.tok, ""); }
        else toast(T(null, "site.shell.whoami.unreachable", "Could not reach WardSynQ: {reason}", { reason: (r && (r.error || r.detail)) || "no answer" }));
        st.who = null; return;
      }
      st.who = r;
      if (st.tokType === "staff" && r.orgId && !st.orgId) selectOrg(r.orgId, true);
    });
  }
  function loadOrg() {
    return api("/org?orgId=" + encodeURIComponent(st.orgId)).then(function (r) {
      if (!r || !r.ok || !r.org) { toast(r && r.error === "forbidden" ? T(null, "site.shell.loadOrg.notMember", "You are not a member of that hospital.") : T(null, "site.shell.loadOrg.couldNotOpen", "That hospital could not be opened.")); st.orgId = ""; lsSet(LS.hosp, ""); lsSet(LS.wp, ""); st.org = null; return; }
      st.org = r.org; st.org._wards = r.wards || []; st.org._departments = r.departments || []; st.org._rooms = r.rooms || [];
      // The role is org-scoped: ask again now that the hospital is known.
      return api("/whoami?orgId=" + encodeURIComponent(st.orgId)).then(function (w) { if (w && w.ok) st.who = w; });
    });
  }

  // ---- chrome --------------------------------------------------------------------------------
  function bar() {
    var who = st.who, org = st.org;
    var tools = st.tokType ? '<div class="tools">' +
      (org ? '<button class="btn" type="button" data-go="home">' + esc(T(null, "site.shell.bar.map", "Map")) + '</button>' : "") +
      '<button class="btn" type="button" data-go="hospitals">' + esc(T(null, "site.shell.bar.hospital", "Hospital")) + '</button>' +
      langPicker() +
      '<button class="btn" type="button" data-go="logout">' + esc(T(null, "site.shell.bar.signOut", "Sign out")) + '</button></div>' : "";
    var h = '<div class="brandbar"><img class="brand-mark" src="/wardsynq/ui/brand/wardsynq-lockup.png" alt="" aria-hidden="true" width="261" height="61" decoding="async"><span class="spring"></span>' + tools + "</div>";
    if (org) h += '<div class="hospbar"><span class="name">' + EN(null, esc(org.name || org.id)) + '</span><span class="facts">' + EN(null, esc(org.code || org.id)) +
      ' <span class="sep">/</span> ' + (org.mode === "wardsynq" ? esc(T(null, "site.shell.bar.wardsynqRecord", "WardSynQ record")) : EN(null, esc(org.mode || "native")) + " " + esc(T(null, "site.shell.bar.mode", "mode"))) + "</span><span class=\"spring\"></span>" +
      (isDemo(org) ? '<span class="demo-tag" title="' + esc(T(null, "site.shell.bar.demoTitle", "Fabricated patients, for demonstration. Nothing here is a real person or a real clinical record.")) + '">' + esc(T(null, "site.shell.bar.demoTag", "DEMO")) + '</span>' : "") +
      (who ? '<span class="who">' + EN(null, esc(personName(who))) + (who.role ? ", " + EN(null, esc(String(who.role).replace(/_/g, " "))) : "") + "</span>" : "") + "</div>";
    return h;
  }
  /* THE PERSON, NOT THEIR LOGIN. The header greeted a staff member with the whole of
   * "nurse.01@demo.wardsynq.test, nurse" - a login, printed at them, on every screen. A staff sign-in
   * has no display name yet, so the local part is the closest thing the session honestly holds; a
   * real name wins whenever one exists, and nothing is invented when neither does. Role underscores
   * become spaces here too, so "blood_bank" reads as "blood bank". */
  function personName(who) {
    var n = (who && (who.name || who.displayName)) || "";
    if (n && n.indexOf("@") < 0) return n;
    var id = String(n || (who && who.smdId) || "");
    var at = id.indexOf("@");
    return at > 0 ? id.slice(0, at) : id;
  }
  /* The rail: the map of surfaces, the same list the home page states in full. */
  function rail(page) {
    if (!st.org) return "";
    var native = isWardsynq();
    // WardSynQ is the product's own name, unchanged in every language - not a nav.* key.
    var item = function (go, key) { return '<a href="#/' + go.replace(/^ward:/, "ward/") + '"' + (page === go ? ' aria-current="page"' : "") + ">" + esc(navTr(key)) + "</a>"; };
    var heading = function (key) { return '<div class="heading">' + esc(navTr(key)) + "</div>"; };
    var h = '<div class="rail" lang="' + esc(G.WSQI18n ? G.WSQI18n.normalize(st.navLang) : "en") + '"><div class="heading">WardSynQ</div>' + item("home", "nav.map");
    if (native) h += item("workstation", "nav.workstation") + item("ward:", "nav.ward") + item("ward:board", "nav.beds") + item("ward:edboard", "nav.emergency") + item("ward:critsboard", "nav.criticals") + item("ward:labboard", "nav.lab") + item("ward:radboard", "nav.radiology");
    h += item("opd", "nav.opd") + item("patients", "nav.patients");
    if (native) h += heading("nav.command") + item("ward:flowcommand", "nav.commandCenter") + item("ward:twin", "nav.twin") + item("ward:reports", "nav.reports") + item("ward:cashier", "nav.billing") + item("ward:integration", "nav.integration") + item("maik", "nav.maik");
    h += heading("nav.administration") + item("admin", "nav.adminCenter") + item("audit", "nav.audit") + item("security", "nav.security") + item("rota", "nav.rota") + item("accounts", "nav.accounts") + item("group", "nav.group") + "</div>";
    return h;
  }
  function render(page, extra) {
    var app = $("app"); if (!app) return;
    var def = PAGES[page]; if (!def) return;
    st.page = page;
    setDocLang();
    app.className = "shell";
    if (page === "login") app.innerHTML = bar() + '<div id="page"></div>';
    else {
      /* No rail means no rail COLUMN either. .wrap is a two-column grid, so with an empty rail the
       * only child landed in the 178px first column and every page shown before a hospital is
       * chosen - the hospital list, and the demonstration builder - was squeezed into a strip a
       * third the width of its own text. */
      var railHtml = rail(page);
      app.innerHTML = bar() + '<div class="wrap' + (railHtml ? "" : " norail") + '">' + railHtml + '<main class="work" id="page"></main></div>';
    }
    var el = $("page");
    var ctx = { el: el, api: api, download: download, esc: esc, ms: ms, go: go, can: can, toast: toast, state: st, isWardsynq: isWardsynq, selectOrg: selectOrg, setSession: setSession, when: when, removeHospital: removeHospital,
      navTr: navTr, navLang: curLang(), lang: curLang(),
      t: function (key, vars, en) { return T(null, key, en, vars); }, tSafe: function (key, vars, en) { return TS(null, key, en, vars); }, en: function (html) { return EN(null, html); } };
    try { var out = def.render(ctx, extra); if (out && typeof out.then === "function") out.catch(function (e) { el.innerHTML += '<div class="msg err">' + esc(String(e && e.message || e)) + "</div>"; }); }
    catch (e) { el.innerHTML = '<div class="msg err">' + esc(String(e && e.message || e)) + "</div>"; }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-go]"); if (!b) return;
    var g = b.getAttribute("data-go"); if (!g) return;
    e.preventDefault();
    if (g.indexOf("ward:") === 0) { go("ward", g.slice(5)); return; }
    go(g);
  });

  // ---- the ward overlay (ward.js) --------------------------------------------------------------
  function openWard(act) {
    render("home");
    if (!G.WARD || !G.WARD.open) { toast(T(null, "site.shell.ward.stillLoading", "The ward is still loading. Try again in a moment.")); return; }
    if (!isWardsynq()) { toast(T(null, "site.shell.ward.notWardsynq", "This hospital does not keep a WardSynQ record, so the ward is not available. The OPD desk is.")); return; }
    G.WARD.onClose = function () { if (parseHash().page === "ward") go("home"); };
    G.WARD.open({ orgId: st.orgId, act: act || "", demo: isDemo(st.org) });
  }

  /* What a Firebase sign-in failure MEANS, in a sentence the person reading it can act on.
   *
   * Firebase's own message was being shown verbatim, so a clinician met "This domain is not
   * authorized for OAuth operations for your Firebase project. Edit the list of authorized domains
   * from the Firebase console" - which is an instruction to somebody else entirely, on a console
   * they cannot open, and it did not mention that email and password works on this very screen. An
   * unmapped code still falls back to Firebase's text rather than to a shrug: a message nobody
   * wrote is better than "Sign-in failed" with the reason thrown away.
   */
  function signInError(e) {
    var code = (e && e.code) || "";
    if (code === "auth/unauthorized-domain")
      return T(null, "site.shell.signInError.unauthorizedDomain", "Google sign-in is not enabled for this address yet. Sign in with your email and password above, which works now. To turn Google on, an administrator adds {host} to the authorised domains of the StewardMD Firebase project.", { host: location.hostname });
    if (code === "auth/popup-blocked") return T(null, "site.shell.signInError.popupBlocked", "Your browser blocked the Google sign-in window. Allow pop-ups for this site, or sign in with your email and password above.");
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return T(null, "site.shell.signInError.popupClosed", "The Google sign-in window closed before it finished.");
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-email") return T(null, "site.shell.signInError.wrongCredentials", "Wrong email or password.");
    if (code === "auth/too-many-requests") return T(null, "site.shell.signInError.tooMany", "Too many attempts. Wait a few minutes and try again.");
    if (code === "auth/network-request-failed") return T(null, "site.shell.signInError.networkFailed", "Could not reach the sign-in service. Check the network and try again.");
    if (code === "auth/user-disabled") return T(null, "site.shell.signInError.userDisabled", "This account has been disabled. Ask your hospital administrator.");
    return (e && e.message) || T(null, "site.shell.signInError.generic", "Sign-in failed.");
  }

  /* What a Firebase sign-in failure MEANS, in a sentence the person reading it can act on.
   *
   * Firebase's own message was being shown verbatim, so a clinician met "This domain is not
   * authorized for OAuth operations for your Firebase project. Edit the list of authorized domains
   * from the Firebase console" - which is an instruction to somebody else entirely, on a console
   * they cannot open, and it did not mention that email and password works on this very screen. An
   * unmapped code still falls back to Firebase's text rather than to a shrug: a message nobody
   * wrote is better than "Sign-in failed" with the reason thrown away.
   */
  function signInError(e) {
    var code = (e && e.code) || "";
    if (code === "auth/unauthorized-domain")
      return T(null, "site.shell.signInError.unauthorizedDomain", "Google sign-in is not enabled for this address yet. Sign in with your email and password above, which works now. To turn Google on, an administrator adds {host} to the authorised domains of the StewardMD Firebase project.", { host: location.hostname });
    if (code === "auth/popup-blocked") return T(null, "site.shell.signInError.popupBlocked", "Your browser blocked the Google sign-in window. Allow pop-ups for this site, or sign in with your email and password above.");
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return T(null, "site.shell.signInError.popupClosed", "The Google sign-in window closed before it finished.");
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-email") return T(null, "site.shell.signInError.wrongCredentials", "Wrong email or password.");
    if (code === "auth/too-many-requests") return T(null, "site.shell.signInError.tooMany", "Too many attempts. Wait a few minutes and try again.");
    if (code === "auth/network-request-failed") return T(null, "site.shell.signInError.networkFailed", "Could not reach the sign-in service. Check the network and try again.");
    if (code === "auth/user-disabled") return T(null, "site.shell.signInError.userDisabled", "This account has been disabled. Ask your hospital administrator.");
    return (e && e.message) || T(null, "site.shell.signInError.generic", "Sign-in failed.");
  }

  // ---- sign in ----------------------------------------------------------------------------------
  PAGES.login = { render: function (c) {
    var el = c.el, method = st._loginTab || "account";
    var tabs = [["account", T(null, "site.shell.login.tabAccount", "Owner / Doctor")], ["staff", T(null, "site.shell.login.tabStaff", "Hospital staff")]];
    var form;
    if (method === "account") form =
      '<p class="lead">' + esc(T(null, "site.shell.login.accountLead", "Sign in with your StewardMD account.")) + '</p>' +
      '<label class="f"><span>' + esc(T(null, "site.shell.login.emailLabel", "Email")) + '</span><input id="fe" type="email" autocomplete="username" inputmode="email" autocapitalize="none"></label>' +
      '<label class="f"><span>' + esc(T(null, "site.shell.login.passwordLabel", "Password")) + '</span><input id="fp" type="password" autocomplete="current-password"></label>' +
      '<button class="btn" id="goAccount" type="button">' + esc(T(null, "site.shell.login.signInBtn", "Sign in")) + '</button>' +
      '<div class="or">' + esc(T(null, "site.shell.login.or", "or")) + '</div><button class="btn ghost" id="goGoogle" type="button">' + esc(T(null, "site.shell.login.continueGoogle", "Continue with Google")) + '</button>';
    else form =
      '<p class="lead">' + esc(T(null, "site.shell.login.staffLead", "Front desk, nursing, pharmacy, lab and billing staff.")) + '</p>' +
      '<label class="f"><span>' + esc(T(null, "site.shell.login.hospitalCodeLabel", "Hospital code")) + '</span><input id="sorg" placeholder="SMD-XXXXXX" value="' + esc(st._lastCode || "") + '" autocapitalize="characters"></label>' +
      '<label class="f"><span>' + esc(T(null, "site.shell.login.staffIdLabel", "Staff ID or email")) + '</span><input id="sid" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>' +
      '<label class="f"><span>' + esc(T(null, "site.shell.login.pinLabel", "PIN or password")) + '</span><input id="spw" type="password" autocomplete="current-password"></label>' +
      '<button class="btn" id="goStaff" type="button">' + esc(T(null, "site.shell.login.unlockBtn", "Unlock")) + '</button>' +
      '<p class="quiet" style="margin-top:10px">' + esc(T(null, "site.shell.login.staffNote", "Hospital code + staff ID + PIN, or just your email + password. Your hospital admin sets these in the Admin Center.")) + '</p>';
    el.innerHTML = '<div class="door"><div class="card">' +

      '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === method) + '">' + esc(t[1]) + "</button>"; }).join("") + "</div>" +
      '<div id="loginForm">' + form + '</div><div id="loginMsg"></div>' +
      '<p class="foot">' + esc(T(null, "site.shell.login.footer", "Clinical operating system and EMR. Clinical content in this build is not yet signed off by a hospital committee.")) + '</p>' +
      "</div></div>";
    var msg = function (t, cls) { $("loginMsg").innerHTML = t ? '<div class="msg ' + (cls || "err") + '">' + esc(t) + "</div>" : ""; };
    el.querySelectorAll("[data-tab]").forEach(function (b) { b.onclick = function () { st._loginTab = b.getAttribute("data-tab"); render("login"); }; });
    var onEnter = function (id, fn) { var i = $(id); if (i) i.addEventListener("keydown", function (e) { if (e.key === "Enter") fn(); }); };
    if (method === "account") {
      var acct = function (mode) {
        var a; try { a = firebase.auth(); } catch (e) { msg(T(null, "site.shell.login.accountUnavailable", "Account sign-in is unavailable here. Use the staff sign-in.")); return; }
        var p;
        if (mode === "google") p = a.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        else { var em = $("fe").value.trim(), pw = $("fp").value; if (!em || !pw) { msg(T(null, "site.shell.login.enterEmailPassword", "Enter email and password.")); return; } p = a.signInWithEmailAndPassword(em, pw); }
        msg(T(null, "site.shell.login.signingIn", "Signing in."), "note");
        p.then(function () { setSession("account", "", ""); st.who = null; st.orgs = null; go("hospitals"); })
         .catch(function (e) { msg(signInError(e), (e && e.code) === "auth/unauthorized-domain" ? "note" : "err"); });
      };
      $("goAccount").onclick = function () { acct("password"); }; $("goGoogle").onclick = function () { acct("google"); };
      onEnter("fp", function () { acct("password"); });
    } else if (method === "staff") {
      var staff = function () {
        var id = ($("sid").value || "").trim().toLowerCase(), pw = $("spw").value, code = ($("sorg").value || "").trim().toUpperCase();
        if (!id || !pw) { msg(T(null, "site.shell.login.enterStaffCreds", "Enter your staff ID (or email) and PIN (or password).")); return; }
        /* THE HOSPITAL CODE DECIDES, NOT THE SHAPE OF THE ID.
         *
         * This read `id.indexOf("@") > 0` and sent anything containing an "@" down the
         * email + password door, silently ignoring the hospital code the person had just typed and
         * offering their PIN as a password. A staff ID IS an email address at every hospital seeded
         * so far - all 159 here - so the staff door rejected every one of them with "Wrong email or
         * password" while the very same code, ID and PIN worked perfectly against the server. The
         * form's own caption promises both routes: "Hospital code + staff ID + PIN, or just your
         * email + password". Filling in all three has to mean the first one.
         *
         * So: a hospital code present means the PIN route, whatever the ID looks like. No code means
         * the email route, which still needs an "@" to be a sensible attempt. */
        var hasAt = id.indexOf("@") > 0;
        var isEmail = !code && hasAt;
        if (!hasAt && !code) { msg(T(null, "site.shell.login.enterHospitalCode", "Enter the hospital code, or sign in with your email.")); return; }
        st._lastCode = code; msg(T(null, "site.shell.login.checking", "Checking."), "note");
        fetch(API + (isEmail ? "/auth/email" : "/auth/pin"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEmail ? { email: id, password: pw } : { clinicCode: code, identity: id, pin: pw }) })
          .then(function (r) { return r.json(); }).then(function (r) { return r && r.error === "mfa_required" ? secondStep(r) : r; }).then(function (r) {
            if (r && r.cancelled) { msg(T(null, "site.shell.login.cancelled", "Sign-in cancelled.")); return; }
            if (r && (r.error === "wrong_code" || r.error === "challenge_expired")) { msg(r.error === "wrong_code" ? T(null, "site.shell.login.wrongCode", "That code did not match. Sign in again and use the newest code.") : T(null, "site.shell.login.challengeExpired", "That took too long. Sign in again.")); return; }
            if (!r || !r.ok || !r.token) { msg(r && r.error === "locked" ? T(null, "site.shell.login.locked", "Too many attempts. Try again later.") : r && r.error === "staff_disabled" ? T(null, "site.shell.login.staffDisabled", "Staff access is not enabled on this server.") : isEmail ? T(null, "site.shell.signInError.wrongCredentials", "Wrong email or password.") : T(null, "site.shell.login.wrongPin", "Wrong hospital code, staff ID or PIN.")); return; }
            setSession("staff", r.token, r.orgId || ""); st.who = null; go(r.orgId ? "landing" : "hospitals");
          }).catch(function () { msg(T(null, "site.shell.login.networkFailed", "Could not reach the server.")); });
      };
      $("goStaff").onclick = staff; onEnter("spw", staff);
    }
  } };

  // ---- hospitals -----------------------------------------------------------------------------------
  PAGES.hospitals = { render: function (c) {
    var el = c.el;
    el.innerHTML = '<div class="hosp-page"><div class="title"><h1>' + esc(T(null, "site.shell.hospitals.title", "Choose a hospital")) + '</h1><span class="sub">' + EN(null, esc(st.who && st.who.name || "")) + '</span></div><div id="hospList"><span class="spin"></span></div></div>';
    return api("/orgs").then(function (r) {
      var orgs = (r && r.ok && r.orgs) || [];
      // A staff session is minted for one hospital; the server names it on whoami.
      if (!orgs.length && st.who && (st.who.orgId || st.who.hospitalId)) orgs = [{ id: st.who.orgId || st.who.hospitalId, name: st.who.orgCode || st.who.orgId || st.who.hospitalId, code: st.who.orgCode, memberRole: st.who.role }];
      st.orgs = orgs;
      var html = orgs.length ? '<div class="hosp-list">' + orgs.map(function (o) {
        var canRemove = o.memberRole === "owner" || !!(st.who && st.who.platformOwner);
        return '<div class="hosp-item"><button type="button" class="hosp-row" data-org="' + esc(o.id) + '">' + ms(o.mode === "wardsynq" ? "local_hospital" : "medical_services") +
          "<div><b>" + EN(null, esc(o.name || o.id)) + "</b><span>" + EN(null, esc(o.code || o.id)) + (o.memberRole ? " · " + EN(null, esc(o.memberRole)) : "") + (o.mode === "wardsynq" ? " · " + esc(T(null, "site.shell.bar.wardsynqRecord", "WardSynQ record")) : o.mode ? " · " + EN(null, esc(o.mode)) + " " + esc(T(null, "site.shell.hospitals.modeOpdOnly", "mode (OPD only)")) : "") + "</span></div></button>" +
          (canRemove ? '<button type="button" class="btn quiet hosp-rm" data-rmorg="' + esc(o.id) + '" aria-label="' + esc(T(null, "site.shell.hospitals.removeAria", "Remove {name}", { name: o.name || o.id })) + '">' + ms("delete") + esc(T(null, "site.shell.hospitals.removeBtn", "Remove")) + "</button>" : "") + "</div>";
      }).join("") + "</div>" : '<div class="msg note">' + esc(T(null, "site.shell.hospitals.noneLinked", "No hospital is linked to this sign-in yet.")) + " " + (st.who && st.who.kind === "firebase" ? esc(T(null, "site.shell.hospitals.createOrAsk", "Create one below, or ask a hospital admin to add you as a member.")) : esc(T(null, "site.shell.hospitals.askAdmin", "Ask your hospital admin to add you as a member."))) + "</div>";
      if (st.who && st.who.kind === "firebase") html +=
        '<div class="card" style="margin-top:18px"><h2>' + esc(T(null, "site.shell.hospitals.createHeading", "Create a WardSynQ hospital")) + '</h2><p class="quiet">' + esc(T(null, "site.shell.hospitals.createIntro", "Creates the hospital, its clinical record and makes you its owner. Wards, beds, departments and staff are set up next in the Admin Center.")) + '</p>' +
        '<div class="row"><label class="f"><span>' + esc(T(null, "site.shell.hospitals.nameLabel", "Hospital name")) + '</span><input id="newHosp" maxlength="120" placeholder="' + esc(T(null, "site.shell.hospitals.namePlaceholder", "e.g. City General Hospital")) + '"></label>' +
        '<label class="f" style="flex:0 1 160px"><span>' + esc(T(null, "site.shell.hospitals.countryLabel", "Country")) + '</span><select id="newHospRegion"><option value="IN">' + esc(T(null, "site.shell.hospitals.countryIndia", "India")) + '</option><option value="US">' + esc(T(null, "site.shell.hospitals.countryUS", "United States")) + '</option></select></label>' +
        '<button class="btn" id="mkHosp" type="button">' + ms("add_business") + esc(T(null, "site.shell.hospitals.createBtn", "Create")) + "</button></div>" +
        '<p class="quiet">' + esc(T(null, "site.shell.hospitals.countryNote", "The country decides what counts as a valid phone number and which unit a temperature is charted in. It can be changed later in the Admin Center.")) + '</p><div id="mkMsg"></div></div>';
      $("hospList").innerHTML = html;
      el.querySelectorAll("[data-org]").forEach(function (b) { b.onclick = function () { selectOrg(b.getAttribute("data-org")); }; });
      el.querySelectorAll("[data-rmorg]").forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-rmorg"), o = orgs.filter(function (x) { return x.id === id; })[0];
          if (o) removeHospital(o, function () { render("hospitals"); });
        };
      });
      var mk = $("mkHosp"); if (mk) mk.onclick = function () {
        var name = ($("newHosp").value || "").trim(); if (!name) { $("mkMsg").innerHTML = '<div class="msg err">' + esc(T(null, "site.shell.hospitals.giveNameErr", "Give the hospital a name.")) + '</div>'; return; }
        mk.disabled = true; $("mkMsg").innerHTML = '<div class="msg note">' + esc(T(null, "site.shell.hospitals.creating", "Creating the hospital and its record.")) + '</div>';
        api("/onboard/wardsynq", { name: name, region: document.getElementById("newHospRegion").value }).then(function (r) {
          if (!r || !r.ok || !r.org) {
            mk.disabled = false;
            var why = r && r.error;
            var whyHtml = why === "account_required" ? esc(T(null, "site.shell.hospitals.accountRequired", "A StewardMD account is needed to create a hospital.")) : why ? EN(null, esc(why)) : esc(T(null, "site.shell.hospitals.createFailed", "failed"));
            $("mkMsg").innerHTML = '<div class="msg err">' + whyHtml + "</div>"; return;
          }
          toast(T(null, "site.shell.hospitals.created", "Hospital created.")); selectOrg(r.org.id);
        });
      };
    });
  } };

  // ---- home: the role-aware map -----------------------------------------------------------------------
  /* `need` may be a LIST, because some screens have more than one honest way in. The laboratory
   * board is the case that forced it: a ward opens it with emr.view, and the bench itself opens it
   * with lab.result, which is the same pair of authorities the server accepts for those reads. A
   * single capability would have had to pick one of the two departments to lock out. */
  /* READING THE WARD NEEDS THE RECORD, NOT JUST THE QUEUE. These three tiles asked for queue.view,
   * which almost every role holds - so a billing clerk, a pharmacist and a lab technician all saw
   * Inpatient ward, Admission and bed board and Emergency department offered to them as their FIRST
   * three tiles, and every one of those screens then refused them. The reads behind them need a
   * record scope on Encounter, which is granted by emr.view, and separately by transfusion.issue so
   * the blood bank can identify whose episode it is holding (actor.js). Naming both is what keeps
   * this honest in either direction: nothing is offered that the server will refuse, and nothing is
   * hidden from a role that genuinely gets in. */
  var WARD_NEED = ["emr.view", "transfusion.issue"];
  function tile(opts) {
    var needs = opts.need ? (Object.prototype.toString.call(opts.need) === "[object Array]" ? opts.need : [opts.need]) : [];
    var ok = !needs.length || needs.some(function (n) { return can(n); });
    var dis = !ok;
    return '<button type="button" class="tile" data-go="' + esc(opts.go) + '"' + (dis ? ' disabled title="' + esc(T(null, "site.shell.home.tile.disabledTitle", "Your role ({role}) does not include {caps}", { role: st.who && st.who.role || "", caps: needs.join(" or ") })) + '"' : "") + ">" +
      "<div><b>" + esc(opts.title) + "</b><span>" + esc(opts.sub) + "</span>" + (opts.liveId ? '<span class="live" id="' + opts.liveId + '"></span>' : "") + "</div></button>";
  }
  PAGES.home = { render: function (c) {
    var el = c.el, o = st.org, w = st.who, native = isWardsynq();
    var head = '<div class="title"><h1>' + EN(null, esc(o.name || o.id)) + '</h1><span class="sub">' + EN(null, esc(personName(w))) + (w.role ? " · " + EN(null, esc(String(w.role).replace(/_/g, " "))) : "") + " · " + EN(null, esc(o.code || o.id)) + "</span></div>";
    if (!native) head += '<div class="msg note">' + esc(T(null, "site.shell.home.otherModeNote", "This hospital runs in {mode} mode: the OPD desk and its EMR are available, the inpatient ward, command center and Digital Twin need a WardSynQ record. An owner can create a WardSynQ hospital from the hospital list.", { mode: o.mode || "native" })) + '</div>';
    /* WHAT YOU CAN ACTUALLY DO COMES FIRST.
     *
     * Every role opened the identical map in the identical order, which is the doctor's order. A
     * billing clerk's first screen was eleven clinical tiles she cannot use - ward, emergency,
     * critical results, laboratory, radiology, theatre, pharmacy - with Billing below the fold. The
     * pharmacist's was the same, and the lab technician's. The product knew perfectly well which
     * tiles it had just greyed out and still led with them.
     *
     * Within a section the tiles a person can open now sort above the ones they cannot. Nothing is
     * hidden: a locked tile still appears, still says which role would open it, so the map stays a
     * complete map of the hospital rather than quietly shrinking to fit whoever is signed in. The
     * order inside each group is untouched, so a doctor - who can open everything - sees exactly
     * what they saw before. */
    var sec = function (t, tiles, note) {
      var open = [], shut = [];
      for (var i = 0; i < tiles.length; i++) (tiles[i].indexOf(" disabled") >= 0 ? shut : open).push(tiles[i]);
      return '<div class="sec"><div class="signal"></div><div class="said"><h2>' + t + (note ? '<span class="n">' + note + "</span>" : "") + '</h2><div class="grid">' + open.concat(shut).join("") + "</div></div></div>";
    };
    var wardTiles = native ? [
      tile({ go: "ward:", icon: "bed", title: T(null, "site.shell.home.tile.ward.title", "Inpatient ward"), sub: T(null, "site.shell.home.tile.ward.sub", "Ward list, charts, vitals, eMAR round, notes, discharge"), need: WARD_NEED, liveId: "lvWard" }),
      tile({ go: "ward:board", icon: "hotel", title: T(null, "site.shell.home.tile.board.title", "Admission and bed board"), sub: T(null, "site.shell.home.tile.board.sub", "Admit by MRN, place in a bed, transfer"), need: WARD_NEED, liveId: "lvBeds" }),
      tile({ go: "ward:edboard", icon: "emergency", title: T(null, "site.shell.home.tile.edboard.title", "Emergency department"), sub: T(null, "site.shell.home.tile.edboard.sub", "Arrivals, triage, resuscitation, disposition"), need: WARD_NEED, liveId: "lvEd" }),
      tile({ go: "ward:critsboard", icon: "priority_high", title: T(null, "site.shell.home.tile.critsboard.title", "Critical results"), sub: T(null, "site.shell.home.tile.critsboard.sub", "Every open critical result, hospital-wide"), need: "emr.view", liveId: "lvCrit" }),
      /* THE LABORATORY AND RADIOLOGY HAD NO FRONT DOOR. Every other department on this map has one:
       * theatre, pharmacy stock, the ED, critical results. Labs and imaging existed only as buttons
       * buried inside a single patient's chart, so a lab technician or a radiographer signing in
       * landed on a map with nothing on it they could do, and no way to see their own department's
       * workload. The backends were already there (collections, pending-tests, release-result,
       * imaging-worklist, report-imaging); only the way in was missing.
       * BOTH are emr.view, and the laboratory one is emr.view for the SAME reason the imaging
       * worklist already is (see the cap table in functions/api/queue/[[path]].js): a board is
       * patient demographics beside a requested procedure, and emr.view is the capability that reads
       * those. lab.result would have looked stricter and been broken - the laboratory grant
       * deliberately cannot read Patient at all, and a worklist with no identity on it is worse than
       * no worklist. Widening lab.result to make this tile work would overturn a considered boundary
       * for the convenience of one screen, so it is not done here either.
       * CONSEQUENCE, and it needs an owner's decision rather than a guess: the `lab` role holds only
       * [queue.view, lab.result], so a lab technician still does not see this tile. Staffing the
       * bench properly needs either emr.view on that role or a role designed for it. Flagged, not
       * invented. */
      tile({ go: "ward:labboard", icon: "science", title: T(null, "site.shell.home.tile.labboard.title", "Laboratory"), sub: T(null, "site.shell.home.tile.labboard.sub", "Specimens, bench worklist, results and release"), need: ["emr.view", "lab.result"], liveId: "lvLab" }),
      tile({ go: "ward:radboard", icon: "radiology", title: T(null, "site.shell.home.tile.radboard.title", "Radiology"), sub: T(null, "site.shell.home.tile.radboard.sub", "Imaging worklist, acquisition, reporting"), need: ["emr.view", "lab.result"], liveId: "lvRad" }),
      tile({ go: "ward:surgeryboard", icon: "surgical", title: T(null, "site.shell.home.tile.surgeryboard.title", "Theatre"), sub: T(null, "site.shell.home.tile.surgeryboard.sub", "Cases, WHO checklist, anaesthesia, implants"), need: "emr.view" }),
      /* order.dispense, NOT emr.view, and this one locked the pharmacist out of pharmacy.
       * The stock reads and writes behind this tile are gated ORDER_DISPENSE server-side
       * (functions/api/queue/[[path]].js: "stock-move", "stock", "stock-reconcile"), which is
       * exactly what the pharmacy role holds. The tile asked for emr.view instead - a capability
       * the pharmacy role deliberately does NOT have, because dispensing needs the order and not
       * the consultation notes - so a pharmacist signing in found the one screen her job runs on
       * greyed out, with a tooltip explaining she lacked a capability the screen never needed.
       * Found 2026-09-12 by signing in as the pharmacist. */
      tile({ go: "ward:inventoryboard", icon: "inventory_2", title: T(null, "site.shell.home.tile.inventoryboard.title", "Pharmacy stock"), sub: T(null, "site.shell.home.tile.inventoryboard.sub", "Receive, move, waste, reconcile"), need: "order.dispense" }),
      tile({ go: "ward:scheduling", icon: "event", title: T(null, "site.shell.home.tile.scheduling.title", "Scheduling"), sub: T(null, "site.shell.home.tile.scheduling.sub", "Appointments, resources, blackout periods"), need: "queue.view" }),
      tile({ go: "opd", icon: "medical_services", title: T(null, "site.shell.home.tile.opd.title", "OPD desk"), sub: T(null, "site.shell.home.tile.opd.sub", "Queue, check-in, consult, prescriptions, results"), need: "queue.view" }),
      tile({ go: "workstation", icon: "verified", title: T(null, "site.shell.home.tile.workstation.title", "Order safety workstation"), sub: T(null, "site.shell.home.tile.workstation.sub", "Medication order with allergy and interaction checks"), need: "emr.treat" }),
    ] : [tile({ go: "opd", icon: "medical_services", title: T(null, "site.shell.home.tile.opd.title", "OPD desk"), sub: T(null, "site.shell.home.tile.opd.sub", "Queue, check-in, consult, prescriptions, results"), need: "queue.view" })];
    /* Every one of these six opens a route the server gates at emr.view (patient-flow, twin,
     * report-patient-flow, fhir-exceptions, emergency-log, downtime - see the capability table in
     * functions/api/queue/[[path]].js), not queue.view. queue.view is held by nearly every role,
     * including four with no clinical read at all - pharmacy, billing, cashier, blood_bank, viewer -
     * so each of them was offered all six of these as their first live tiles and refused by every
     * one the moment they opened it. The exact bug WARD_NEED already exists to fix for the three
     * Clinical-section tiles above; it was simply never applied down here too. */
    var cmdTiles = native ? [
      tile({ go: "ward:flowcommand", icon: "monitoring", title: T(null, "site.shell.home.tile.flowcommand.title", "Hospital command center"), sub: T(null, "site.shell.home.tile.flowcommand.sub", "Patient flow, bottlenecks, emergency status"), need: "emr.view", liveId: "lvEmerg" }),
      tile({ go: "ward:twin", icon: "hub", title: T(null, "site.shell.home.tile.twin.title", "Digital Twin"), sub: T(null, "site.shell.home.tile.twin.sub", "Fused hospital state, freshness, predictions, simulation"), need: "emr.view" }),
      tile({ go: "ward:reports", icon: "summarize", title: T(null, "site.shell.home.tile.reports.title", "Reports"), sub: T(null, "site.shell.home.tile.reports.sub", "Patient flow, clinical operations, pharmacy, imaging, billing, claims"), need: "emr.view" }),
      tile({ go: "ward:cashier", icon: "payments", title: T(null, "site.shell.home.tile.cashier.title", "Billing and cashier"), sub: T(null, "site.shell.home.tile.cashier.sub", "Invoices, collections, claims and TPA pre-authorisation"), need: "billing.view" }),
      tile({ go: "ward:integration", icon: "sync_alt", title: T(null, "site.shell.home.tile.integration.title", "Integration console"), sub: T(null, "site.shell.home.tile.integration.sub", "FHIR, HL7, SCCM: exceptions, outbound, replay"), need: "emr.view" }),
      tile({ go: "ward:emergencyadmin", icon: "gpp_maybe", title: T(null, "site.shell.home.tile.emergencyadmin.title", "Emergency access"), sub: T(null, "site.shell.home.tile.emergencyadmin.sub", "Declarations, break-glass log, reconciliation"), need: "emr.view" }),
      /* incident.report OR incident.investigate: filing is broad (nearly every clinical role),
       * investigating is not (safety_officer/admin). The engine (wardsynq-incidents.js) has held a
       * full report -> triage -> RCA -> CAPA -> close lifecycle since it was written, gated at the
       * route (functions/_wardsynq/incidents.js) - and had NO tile anywhere, so nobody, including
       * safety_officer whose whole job this is, could reach it. */
      tile({ go: "ward:incidents", icon: "report", title: T(null, "site.shell.home.tile.incidents.title", "Safety and incidents"), sub: T(null, "site.shell.home.tile.incidents.sub", "File a report; triage, RCA and CAPA for safety officers"), need: ["incident.report", "incident.investigate"] }),
      /* Approvals. Reachable by anyone with clinical business, because the prescriber who was just
       * blocked by stewardship is the person who needs to ask, and the consultant who grants it
       * needs the same door. Who may actually grant is decided on the route, and who may not grant
       * their OWN request is decided beneath that, in verification.js. */
      /* The safety inbox is the first thing somebody coming on shift should open, so it sits at the
       * clinical-view bar: anyone who may read a chart may read what on it needs a person. Which
       * items are THEIRS is decided inside, and is an ordering, never a permission. */
      tile({ go: "ward:safetyinbox", icon: "priority_high", title: T(null, "site.shell.home.tile.safetyinbox.title", "Safety inbox"), sub: T(null, "site.shell.home.tile.safetyinbox.sub", "Everything on the ward that needs a person, most urgent first"), need: "emr.view" }),
      /* Emergency access sits at emr.vitals - the lowest capability meaning "clinical business with
       * patients", the same bar actor.js uses for BreakGlassGrant. A cashier or HR cannot reach it,
       * and the module refuses them independently of this tile. */
      tile({ go: "ward:breakglass", icon: "warning", title: T(null, "site.shell.home.tile.breakglass.title", "Emergency access"), sub: T(null, "site.shell.home.tile.breakglass.sub", "Break glass for a patient in an emergency, and review every time it was used"), need: "emr.vitals" }),
      /* Handover is nursing work and sits on the capability a nurse already holds for recording
       * what she observes. A handover is her own account of a shift, not a clinical document -
       * which is exactly why actor.js grants ShiftHandover under emr.vitals and not under the
       * authority that writes a discharge summary. */
      tile({ go: "ward:handovers", icon: "swap_horiz", title: T(null, "site.shell.home.tile.handovers.title", "Shift handover"), sub: T(null, "site.shell.home.tile.handovers.sub", "Hand a patient to the next shift, and take the ones waiting for you"), need: "emr.vitals" }),
      /* The bed waiting list sits at the capability that registers a patient - asking for a bed and
       * closing a request are front-desk and bed-management acts, and the module gates them itself. */
      tile({ go: "ward:admreqs", icon: "bed", title: T(null, "site.shell.home.tile.admreqs.title", "Waiting for a bed"), sub: T(null, "site.shell.home.tile.admreqs.sub", "Ask for a bed, see who is waiting and for how long"), need: "queue.add" }),
      tile({ go: "ward:nurseworklist", icon: "checklist", title: T(null, "site.shell.home.tile.nurseworklist.title", "Nurse worklist"), sub: T(null, "site.shell.home.tile.nurseworklist.sub", "Every patient: overdue doses, what is due next, early-warning score"), need: "emr.view" }),
      tile({ go: "ward:surveillance", icon: "monitor_heart", title: T(null, "site.shell.home.tile.surveillance.title", "Surveillance"), sub: T(null, "site.shell.home.tile.surveillance.sub", "Rising NEWS2, sepsis screens, worsening labs, overdue care, with the evidence"), need: "emr.view" }),
      tile({ go: "ward:referralinbox", icon: "send", title: T(null, "site.shell.home.tile.referralinbox.title", "Referral inbox"), sub: T(null, "site.shell.home.tile.referralinbox.sub", "Referrals waiting for your specialty, and the ones you sent"), need: "emr.view" }),
      /* Finding and joining duplicate records is the front desk's and medical records' work, on the
       * capability that registers a patient; identity-merge.js gates the merge itself. */
      tile({ go: "ward:mpi", icon: "search", title: T(null, "site.shell.home.tile.mpi.title", "Duplicate records"), sub: T(null, "site.shell.home.tile.mpi.sub", "Find a patient who may have two records, and join them with a reason"), need: "queue.add" }),
      tile({ go: "ward:approvals", icon: "verified", title: T(null, "site.shell.home.tile.approvals.title", "Approvals"), sub: T(null, "site.shell.home.tile.approvals.sub", "Ask for an approval for a restricted medicine, and grant the ones waiting"), need: ["emr.vitals", "emr.treat"] }),
      /* Purchasing sits behind the pharmacy's own capability, not a clinical one: ordering stock is
       * the storekeeper's job and has never been the ward's. */
      tile({ go: "ward:purchasing", icon: "inventory", title: T(null, "site.shell.home.tile.purchasing.title", "Purchasing"), sub: T(null, "site.shell.home.tile.purchasing.sub", "Raise a supplier order, get it approved, and book the stock in when it arrives"), need: "order.dispense" }),
      tile({ go: "ward:downtime", icon: "cloud_off", title: T(null, "site.shell.home.tile.downtime.title", "Downtime pack"), sub: T(null, "site.shell.home.tile.downtime.sub", "Printable ward state for a network outage"), need: "emr.view" }),
    ] : [];
    var peopleTiles = [
      tile({ go: "patients", icon: "person_search", title: T(null, "site.shell.home.tile.patients.title", "Patients"), sub: T(null, "site.shell.home.tile.patients.sub", "Find by MRN, register a new patient, open the chart"), need: "queue.view" }),
    ];
    if (native) peopleTiles.push(tile({ go: "portal-access", icon: "forum", title: T(null, "site.shell.home.tile.portalAccess.title", "Patient portal"), sub: T(null, "site.shell.home.tile.portalAccess.sub", "Patient messages, and record access for patients and family"), need: "emr.view" }));
    if (native) peopleTiles.push(tile({ go: "maik", icon: "psychology", title: T(null, "site.shell.home.tile.maik.title", "MaiK clinical AI"), sub: T(null, "site.shell.home.tile.maik.sub", "Governed summaries and draft notes, always reviewed by you"), need: "emr.view" }));
    var adminTiles = [
      tile({ go: "admin", icon: "admin_panel_settings", title: T(null, "site.shell.home.tile.admin.title", "Admin Center"), sub: T(null, "site.shell.home.tile.admin.sub", "Wards, beds, departments, rooms, staff and roles"), need: "staff.admin" }),
      tile({ go: "audit", icon: "policy", title: T(null, "site.shell.home.tile.audit.title", "Audit and security"), sub: T(null, "site.shell.home.tile.audit.sub", "Record changes, emergency access, source grants, service health"), need: "emr.view" }),
    ];
    if (native) adminTiles.push(tile({ go: "ward:bedmgmt", icon: "dashboard_customize", title: T(null, "site.shell.home.tile.bedmgmt.title", "Bed management"), sub: T(null, "site.shell.home.tile.bedmgmt.sub", "Bed master: block, release, housekeeping"), need: "staff.admin" }));
    el.innerHTML = head + sec(esc(T(null, "site.shell.home.sec.clinical", "Clinical")), wardTiles) + (cmdTiles.length ? sec(esc(T(null, "site.shell.home.sec.command", "Command and operations")), cmdTiles) : "") + sec(esc(T(null, "site.shell.home.sec.patientsAI", "Patients and AI")), peopleTiles) + sec(esc(T(null, "site.shell.home.sec.admin", "Administration")), adminTiles);
    if (!native) return;
    // Live counts, each from the same route its tile opens. A count that cannot be read says so.
    var q = "?orgId=" + encodeURIComponent(st.orgId);
    /* A COUNT YOU ARE NOT ENTITLED TO IS NOT "UNAVAILABLE" - IT IS SIMPLY NOT YOURS.
     *
     * These badges are gated on queue.view, but the reads behind them need more than that, so a
     * pharmacist (queue.view, no emr.view) opened her home screen to find the first three tiles -
     * ward, bed board, emergency - all reporting "unavailable". Three words that say the system is
     * broken, on the screen somebody sees first, about counts she was never meant to see. The
     * pharmacy work she actually came for was further down and perfectly fine.
     *
     * A refusal now renders as nothing at all: the tile is still there, still openable if her role
     * allows, just without a number beside it. A REAL failure still says so, because "the ward list
     * is down" is worth knowing and must not be hidden by this. */
    var refused = function (r) {
      var e = r && r.error;
      return e === "forbidden" || e === "permission" || e === "out_of_scope" || e === "not_a_member" || e === "unauthorized";
    };
    var live = function (id, p, f) {
      var s = $(id); if (!s) return;
      s.innerHTML = '<span class="spin"></span>';
      api(p).then(function (r) {
        if (refused(r)) { s.textContent = ""; s.className = "live"; return; }
        var v = f(r); s.textContent = v.text; s.className = "live" + (v.stop ? " stop" : "");
      });
    };
    var unavailable = function () { return T(null, "site.shell.home.live.unavailable", "unavailable"); };
    if (can("queue.view")) live("lvWard", "/ward/list" + q, function (r) { return r && r.ok ? { text: T(null, "site.shell.home.live.admitted", "{n} admitted", { n: (r.patients || []).length }) } : { text: unavailable(), stop: true }; });
    if (can("queue.view")) live("lvBeds", "/ward/beds" + q, function (r) { if (!r || !r.ok) return { text: unavailable(), stop: true }; var free = 0, known = false; (r.wards || []).forEach(function (w) { if (w.bedsKnown !== false && w.free) { known = true; free += w.free.length; } }); return { text: known ? T(null, "site.shell.home.live.freeBeds", "{n} free beds", { n: free }) : T(null, "site.shell.home.live.bedsNotConfigured", "{n} wards, beds not configured", { n: (r.wards || []).length }) }; });
    if (can("queue.view")) live("lvEd", "/ward/ed-list" + q, function (r) { return r && r.ok ? { text: T(null, "site.shell.home.live.inEd", "{n} in ED", { n: (r.patients || []).length }) } : { text: unavailable(), stop: true }; });
    if (can("emr.view")) live("lvCrit", "/ward/criticals" + q + "&state=open", function (r) { var n = r && r.ok ? (r.loops || []).length : -1; return n < 0 ? { text: unavailable(), stop: true } : { text: T(null, "site.shell.home.live.open", "{n} open", { n: n }), stop: n > 0 }; });
    if (can("queue.view")) live("lvEmerg", "/ward/emergency-status" + q, function (r) { if (!r || !r.ok) return { text: unavailable(), stop: true }; var a = r.active || r.declarations || []; return a.length ? { text: T(null, "site.shell.home.live.emergencyActive", "{n} emergency active", { n: a.length }), stop: true } : { text: T(null, "site.shell.home.live.noEmergency", "no emergency declared") }; });
  } };

  // ---- registry + boot ------------------------------------------------------------------------------------
  G.WSQ = { page: function (name, def) { PAGES[name] = def; }, t: function (key, vars, en) { return T(null, key, en, vars); }, tSafe: function (key, vars, en) { return TS(null, key, en, vars); }, en: function (html) { return EN(null, html); }, api: api, download: download, esc: esc, ms: ms, go: go, can: can, state: st, toast: toast, render: render, _signInError: signInError };

  function boot() {
    st.tokType = lsGet(LS.tt); st.tok = lsGet(LS.tok); st.orgId = lsGet(LS.hosp);
    var savedNavLang = lsGet(LS.navLang);
    st.navLang = (G.WSQI18n && G.WSQI18n.offered(savedNavLang)) ? savedNavLang : "en";
    var afterLang = function () {
      setDocLang();
      if (st.tokType === "account" && !st.tok) {
        // Wait for the Firebase session to restore before deciding the account is gone.
        var settled = false;
        var done = function (u) { if (settled) return; settled = true; st.fbReady = true; st.fbUser = u || null; if (!u) { st.tokType = ""; lsSet(LS.tt, ""); } route(); };
        try { firebase.auth().onAuthStateChanged(done); setTimeout(function () { done(firebase.auth().currentUser); }, 4000); } catch (e) { done(null); }
      } else if (st.tokType === "staff" && !st.tok) { st.tokType = ""; route(); }
      else route();
      window.addEventListener("hashchange", route);
    };
    // Load the remembered nav language's file BEFORE the first paint, so a returning visitor never
    // sees an English flash while it loads (there is no re-render once it arrives).
    if (st.navLang !== "en" && G.WSQPrint && G.WSQPrint.ensureLoaded) G.WSQPrint.ensureLoaded(st.navLang, afterLang); else afterLang();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
