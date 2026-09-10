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
  var LS = { tok: "smd_opd_staff_tok", tt: "smd_opd_toktype", hosp: "smd_opd_hospital", wp: "smd_opd_workplace" };
  var st = { tokType: "", tok: "", orgId: "", who: null, org: null, orgs: null, page: "", arg: "", fbUser: null, fbReady: false };
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
  function signOut() {
    var wasAccount = st.tokType === "account";
    st.tokType = ""; st.tok = ""; st.orgId = ""; st.who = null; st.org = null; st.orgs = null;
    lsSet(LS.tt, ""); lsSet(LS.tok, ""); lsSet(LS.hosp, ""); lsSet(LS.wp, "");
    try { if (G.WARD) G.WARD.close(); } catch (e) {}
    var p = Promise.resolve();
    if (wasAccount) { try { p = firebase.auth().signOut(); } catch (e) {} }
    p.then(function () { go("login"); }, function () { go("login"); });
  }

  // ---- router ---------------------------------------------------------------------------------
  function go(page, arg) { location.hash = "#/" + page + (arg ? "/" + encodeURIComponent(arg) : ""); }
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
    if (r.page === "hospitals") return render("hospitals");
    if (!st.orgId) return render("hospitals");
    if (!st.org) return loadOrg().then(function () { return st.org ? route() : render("hospitals"); });
    if (r.page === "landing") { if (isWardsynq() && st.org.connectTenantId) { location.replace(workstationUrl()); return; } return go("home"); }
    if (!r.page || r.page === "home") return render("home");
    if (r.page === "ward") return openWard(r.arg);
    if (r.page === "opd") { location.href = "/opd.html"; return; }
    if (r.page === "workstation") { location.href = workstationUrl(); return; }
    if (PAGES[r.page]) return render(r.page);
    return render("home");
  }
  function workstationUrl() { return "/wardsynq/ui/wardsynq.html?record=" + encodeURIComponent(st.org.connectTenantId || "") + "&site=1"; }
  function whoami() {
    return api("/whoami" + (st.orgId ? "?orgId=" + encodeURIComponent(st.orgId) : "")).then(function (r) {
      if (!r || !r.ok) {
        if (r && (r.error === "unauthorized" || r.status === 401)) { st.tokType = ""; st.tok = ""; lsSet(LS.tt, ""); lsSet(LS.tok, ""); }
        else toast("Could not reach WardSynQ: " + (r && (r.error || r.detail) || "no answer"));
        st.who = null; return;
      }
      st.who = r;
      if (st.tokType === "staff" && r.orgId && !st.orgId) selectOrg(r.orgId, true);
    });
  }
  function loadOrg() {
    return api("/org?orgId=" + encodeURIComponent(st.orgId)).then(function (r) {
      if (!r || !r.ok || !r.org) { toast(r && r.error === "forbidden" ? "You are not a member of that hospital." : "That hospital could not be opened."); st.orgId = ""; lsSet(LS.hosp, ""); lsSet(LS.wp, ""); st.org = null; return; }
      st.org = r.org; st.org._wards = r.wards || []; st.org._departments = r.departments || []; st.org._rooms = r.rooms || [];
      // The role is org-scoped: ask again now that the hospital is known.
      return api("/whoami?orgId=" + encodeURIComponent(st.orgId)).then(function (w) { if (w && w.ok) st.who = w; });
    });
  }

  // ---- chrome --------------------------------------------------------------------------------
  function bar() {
    var who = st.who, org = st.org;
    var tools = st.tokType ? '<div class="tools">' +
      (org ? '<button class="btn" type="button" data-go="home">Map</button>' : "") +
      '<button class="btn" type="button" data-go="hospitals">Hospital</button>' +
      '<button class="btn" type="button" data-go="logout">Sign out</button></div>' : "";
    var h = '<div class="brandbar"><img class="brand-mark" src="/wardsynq/ui/brand/wardsynq-lockup.png" alt="" aria-hidden="true" width="261" height="61" decoding="async"><span class="spring"></span>' + tools + "</div>";
    if (org) h += '<div class="hospbar"><span class="name">' + esc(org.name || org.id) + '</span><span class="facts">' + esc(org.code || org.id) +
      '<span class="sep">/</span>' + (org.mode === "wardsynq" ? "WardSynQ record" : esc(org.mode || "native") + " mode") + "</span><span class=\"spring\"></span>" +
      (isDemo(org) ? '<span class="demo-tag" title="Fabricated patients, for demonstration. Nothing here is a real person or a real clinical record.">DEMO</span>' : "") +
      (who ? '<span class="who">' + esc(who.name || who.smdId || "") + (who.role ? ", " + esc(who.role) : "") + "</span>" : "") + "</div>";
    return h;
  }
  /* The rail: the map of surfaces, the same list the home page states in full. */
  function rail(page) {
    if (!st.org) return "";
    var native = isWardsynq();
    var item = function (go, label) { return '<a href="#/' + go.replace(/^ward:/, "ward/") + '"' + (page === go ? ' aria-current="page"' : "") + ">" + esc(label) + "</a>"; };
    var h = '<div class="rail"><div class="heading">WardSynQ</div>' + item("home", "Map");
    if (native) h += item("workstation", "Workstation") + item("ward:", "Ward") + item("ward:board", "Bed board") + item("ward:edboard", "Emergency") + item("ward:critsboard", "Critical results");
    h += item("opd", "OPD desk") + item("patients", "Patients");
    if (native) h += '<div class="heading">Command</div>' + item("ward:flowcommand", "Command center") + item("ward:twin", "Digital twin") + item("ward:reports", "Reports") + item("ward:cashier", "Billing") + item("ward:integration", "Integration") + item("maik", "MaiK");
    h += '<div class="heading">Administration</div>' + item("admin", "Admin Center") + item("audit", "Audit and security") + "</div>";
    return h;
  }
  function render(page, extra) {
    var app = $("app"); if (!app) return;
    var def = PAGES[page]; if (!def) return;
    st.page = page;
    app.className = "shell";
    if (page === "login") app.innerHTML = bar() + '<div id="page"></div>';
    else app.innerHTML = bar() + '<div class="wrap">' + rail(page) + '<main class="work" id="page"></main></div>';
    var el = $("page");
    var ctx = { el: el, api: api, esc: esc, ms: ms, go: go, can: can, toast: toast, state: st, isWardsynq: isWardsynq, selectOrg: selectOrg, setSession: setSession, when: when };
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
    if (!G.WARD || !G.WARD.open) { toast("The ward is still loading. Try again in a moment."); return; }
    if (!isWardsynq()) { toast("This hospital does not keep a WardSynQ record, so the ward is not available. The OPD desk is."); return; }
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
      return "Google sign-in is not enabled for this address yet. Sign in with your email and password above, which works now. To turn Google on, an administrator adds " + location.hostname + " to the authorised domains of the StewardMD Firebase project.";
    if (code === "auth/popup-blocked") return "Your browser blocked the Google sign-in window. Allow pop-ups for this site, or sign in with your email and password above.";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "The Google sign-in window closed before it finished.";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-email") return "Wrong email or password.";
    if (code === "auth/too-many-requests") return "Too many attempts. Wait a few minutes and try again.";
    if (code === "auth/network-request-failed") return "Could not reach the sign-in service. Check the network and try again.";
    if (code === "auth/user-disabled") return "This account has been disabled. Ask your hospital administrator.";
    return (e && e.message) || "Sign-in failed.";
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
      return "Google sign-in is not enabled for this address yet. Sign in with your email and password above, which works now. To turn Google on, an administrator adds " + location.hostname + " to the authorised domains of the StewardMD Firebase project.";
    if (code === "auth/popup-blocked") return "Your browser blocked the Google sign-in window. Allow pop-ups for this site, or sign in with your email and password above.";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "The Google sign-in window closed before it finished.";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-email") return "Wrong email or password.";
    if (code === "auth/too-many-requests") return "Too many attempts. Wait a few minutes and try again.";
    if (code === "auth/network-request-failed") return "Could not reach the sign-in service. Check the network and try again.";
    if (code === "auth/user-disabled") return "This account has been disabled. Ask your hospital administrator.";
    return (e && e.message) || "Sign-in failed.";
  }

  // ---- sign in ----------------------------------------------------------------------------------
  PAGES.login = { render: function (c) {
    var el = c.el, method = st._loginTab || "account";
    var tabs = [["account", "Owner / Doctor"], ["staff", "Hospital staff"]];
    var form;
    if (method === "account") form =
      '<p class="lead">Sign in with your StewardMD account.</p>' +
      '<label class="f"><span>Email</span><input id="fe" type="email" autocomplete="username" inputmode="email" autocapitalize="none"></label>' +
      '<label class="f"><span>Password</span><input id="fp" type="password" autocomplete="current-password"></label>' +
      '<button class="btn" id="goAccount" type="button">Sign in</button>' +
      '<div class="or">or</div><button class="btn ghost" id="goGoogle" type="button">Continue with Google</button>';
    else form =
      '<p class="lead">Front desk, nursing, pharmacy, lab and billing staff.</p>' +
      '<label class="f"><span>Hospital code</span><input id="sorg" placeholder="SMD-XXXXXX" value="' + esc(st._lastCode || "") + '" autocapitalize="characters"></label>' +
      '<label class="f"><span>Staff ID or email</span><input id="sid" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>' +
      '<label class="f"><span>PIN or password</span><input id="spw" type="password" autocomplete="current-password"></label>' +
      '<button class="btn" id="goStaff" type="button">Unlock</button>' +
      '<p class="quiet" style="margin-top:10px">Hospital code + staff ID + PIN, or just your email + password. Your hospital admin sets these in the Admin Center.</p>';
    el.innerHTML = '<div class="door"><div class="card">' +

      '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === method) + '">' + esc(t[1]) + "</button>"; }).join("") + "</div>" +
      '<div id="loginForm">' + form + '</div><div id="loginMsg"></div>' +
      '<p class="foot">Clinical operating system and EMR. Clinical content in this build is not yet signed off by a hospital committee.</p>' +
      "</div></div>";
    var msg = function (t, cls) { $("loginMsg").innerHTML = t ? '<div class="msg ' + (cls || "err") + '">' + esc(t) + "</div>" : ""; };
    el.querySelectorAll("[data-tab]").forEach(function (b) { b.onclick = function () { st._loginTab = b.getAttribute("data-tab"); render("login"); }; });
    var onEnter = function (id, fn) { var i = $(id); if (i) i.addEventListener("keydown", function (e) { if (e.key === "Enter") fn(); }); };
    if (method === "account") {
      var acct = function (mode) {
        var a; try { a = firebase.auth(); } catch (e) { msg("Account sign-in is unavailable here. Use the staff sign-in."); return; }
        var p;
        if (mode === "google") p = a.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        else { var em = $("fe").value.trim(), pw = $("fp").value; if (!em || !pw) { msg("Enter email and password."); return; } p = a.signInWithEmailAndPassword(em, pw); }
        msg("Signing in.", "note");
        p.then(function () { setSession("account", "", ""); st.who = null; st.orgs = null; go("hospitals"); })
         .catch(function (e) { msg(signInError(e), (e && e.code) === "auth/unauthorized-domain" ? "note" : "err"); });
      };
      $("goAccount").onclick = function () { acct("password"); }; $("goGoogle").onclick = function () { acct("google"); };
      onEnter("fp", function () { acct("password"); });
    } else if (method === "staff") {
      var staff = function () {
        var id = ($("sid").value || "").trim().toLowerCase(), pw = $("spw").value, code = ($("sorg").value || "").trim().toUpperCase();
        if (!id || !pw) { msg("Enter your staff ID (or email) and PIN (or password)."); return; }
        var isEmail = id.indexOf("@") > 0;
        if (!isEmail && !code) { msg("Enter the hospital code, or sign in with your email."); return; }
        st._lastCode = code; msg("Checking.", "note");
        fetch(API + (isEmail ? "/auth/email" : "/auth/pin"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEmail ? { email: id, password: pw } : { clinicCode: code, identity: id, pin: pw }) })
          .then(function (r) { return r.json(); }).then(function (r) {
            if (!r || !r.ok || !r.token) { msg(r && r.error === "locked" ? "Too many attempts. Try again later." : r && r.error === "staff_disabled" ? "Staff access is not enabled on this server." : isEmail ? "Wrong email or password." : "Wrong hospital code, staff ID or PIN."); return; }
            setSession("staff", r.token, r.orgId || ""); st.who = null; go(r.orgId ? "landing" : "hospitals");
          }).catch(function () { msg("Could not reach the server."); });
      };
      $("goStaff").onclick = staff; onEnter("spw", staff);
    }
  } };

  // ---- hospitals -----------------------------------------------------------------------------------
  PAGES.hospitals = { render: function (c) {
    var el = c.el;
    el.innerHTML = '<div class="title"><h1>Choose a hospital</h1><span class="sub">' + esc(st.who && st.who.name || "") + '</span></div><div id="hospList"><span class="spin"></span></div>';
    return api("/orgs").then(function (r) {
      var orgs = (r && r.ok && r.orgs) || [];
      // A staff session is minted for one hospital; the server names it on whoami.
      if (!orgs.length && st.who && (st.who.orgId || st.who.hospitalId)) orgs = [{ id: st.who.orgId || st.who.hospitalId, name: st.who.orgCode || st.who.orgId || st.who.hospitalId, code: st.who.orgCode, memberRole: st.who.role }];
      st.orgs = orgs;
      var html = orgs.length ? '<div class="hosp-list">' + orgs.map(function (o) {
        return '<button type="button" class="hosp-row" data-org="' + esc(o.id) + '">' + ms(o.mode === "wardsynq" ? "local_hospital" : "medical_services") +
          "<div><b>" + esc(o.name || o.id) + "</b><span>" + esc(o.code || o.id) + (o.memberRole ? " · " + esc(o.memberRole) : "") + (o.mode === "wardsynq" ? " · WardSynQ record" : o.mode ? " · " + esc(o.mode) + " mode (OPD only)" : "") + "</span></div></button>";
      }).join("") + "</div>" : '<div class="msg note">No hospital is linked to this sign-in yet.' + (st.who && st.who.kind === "firebase" ? " Create one below, or ask a hospital admin to add you as a member." : " Ask your hospital admin to add you as a member.") + "</div>";
      if (st.who && st.who.kind === "firebase") html +=
        '<div class="card" style="margin-top:18px"><h2>Create a WardSynQ hospital</h2><p class="quiet">Creates the hospital, its clinical record and makes you its owner. Wards, beds, departments and staff are set up next in the Admin Center.</p>' +
        '<div class="row"><label class="f"><span>Hospital name</span><input id="newHosp" maxlength="120" placeholder="e.g. City General Hospital"></label><button class="btn" id="mkHosp" type="button">' + ms("add_business") + "Create</button></div><div id=\"mkMsg\"></div></div>";
      $("hospList").innerHTML = html;
      el.querySelectorAll("[data-org]").forEach(function (b) { b.onclick = function () { selectOrg(b.getAttribute("data-org")); }; });
      var mk = $("mkHosp"); if (mk) mk.onclick = function () {
        var name = ($("newHosp").value || "").trim(); if (!name) { $("mkMsg").innerHTML = '<div class="msg err">Give the hospital a name.</div>'; return; }
        mk.disabled = true; $("mkMsg").innerHTML = '<div class="msg note">Creating the hospital and its record.</div>';
        api("/onboard/wardsynq", { name: name }).then(function (r) {
          if (!r || !r.ok || !r.org) { mk.disabled = false; $("mkMsg").innerHTML = '<div class="msg err">' + esc(r && (r.error === "account_required" ? "A StewardMD account is needed to create a hospital." : r.error || "failed")) + "</div>"; return; }
          toast("Hospital created."); selectOrg(r.org.id);
        });
      };
    });
  } };

  // ---- home: the role-aware map -----------------------------------------------------------------------
  function tile(opts) {
    var dis = opts.need && !can(opts.need);
    return '<button type="button" class="tile" data-go="' + esc(opts.go) + '"' + (dis ? ' disabled title="Your role (' + esc(st.who && st.who.role || "") + ') does not include ' + esc(opts.need) + '"' : "") + ">" +
      "<div><b>" + esc(opts.title) + "</b><span>" + esc(opts.sub) + "</span>" + (opts.liveId ? '<span class="live" id="' + opts.liveId + '"></span>' : "") + "</div></button>";
  }
  PAGES.home = { render: function (c) {
    var el = c.el, o = st.org, w = st.who, native = isWardsynq();
    var head = '<div class="title"><h1>' + esc(o.name || o.id) + '</h1><span class="sub">' + esc(w.name || "") + (w.role ? " · " + esc(w.role) : "") + " · " + esc(o.code || o.id) + "</span></div>";
    if (!native) head += '<div class="msg note">This hospital runs in ' + esc(o.mode || "native") + " mode: the OPD desk and its EMR are available, the inpatient ward, command center and Digital Twin need a WardSynQ record. An owner can create a WardSynQ hospital from the hospital list.</div>";
    var sec = function (t, tiles, note) { return '<div class="sec"><div class="signal"></div><div class="said"><h2>' + t + (note ? '<span class="n">' + note + "</span>" : "") + '</h2><div class="grid">' + tiles.join("") + "</div></div></div>"; };
    var wardTiles = native ? [
      tile({ go: "ward:", icon: "bed", title: "Inpatient ward", sub: "Ward list, charts, vitals, eMAR round, notes, discharge", need: "queue.view", liveId: "lvWard" }),
      tile({ go: "ward:board", icon: "hotel", title: "Admission and bed board", sub: "Admit by MRN, place in a bed, transfer", need: "queue.view", liveId: "lvBeds" }),
      tile({ go: "ward:edboard", icon: "emergency", title: "Emergency department", sub: "Arrivals, triage, resuscitation, disposition", need: "queue.view", liveId: "lvEd" }),
      tile({ go: "ward:critsboard", icon: "priority_high", title: "Critical results", sub: "Every open critical result, hospital-wide", need: "emr.view", liveId: "lvCrit" }),
      tile({ go: "ward:surgeryboard", icon: "surgical", title: "Theatre", sub: "Cases, WHO checklist, anaesthesia, implants", need: "emr.view" }),
      tile({ go: "ward:inventoryboard", icon: "inventory_2", title: "Pharmacy stock", sub: "Receive, move, waste, reconcile", need: "emr.view" }),
      tile({ go: "ward:scheduling", icon: "event", title: "Scheduling", sub: "Appointments, resources, blackout periods", need: "queue.view" }),
      tile({ go: "opd", icon: "medical_services", title: "OPD desk", sub: "Queue, check-in, consult, prescriptions, results", need: "queue.view" }),
      tile({ go: "workstation", icon: "verified", title: "Order safety workstation", sub: "Medication order with allergy and interaction checks", need: "emr.treat" }),
    ] : [tile({ go: "opd", icon: "medical_services", title: "OPD desk", sub: "Queue, check-in, consult, prescriptions, results", need: "queue.view" })];
    var cmdTiles = native ? [
      tile({ go: "ward:flowcommand", icon: "monitoring", title: "Hospital command center", sub: "Patient flow, bottlenecks, emergency status", need: "queue.view", liveId: "lvEmerg" }),
      tile({ go: "ward:twin", icon: "hub", title: "Digital Twin", sub: "Fused hospital state, freshness, predictions, simulation", need: "queue.view" }),
      tile({ go: "ward:reports", icon: "summarize", title: "Reports", sub: "Patient flow, clinical operations, pharmacy, imaging, billing, claims", need: "queue.view" }),
      tile({ go: "ward:cashier", icon: "payments", title: "Billing and cashier", sub: "Invoices, collections, claims and TPA pre-authorisation", need: "billing.view" }),
      tile({ go: "ward:integration", icon: "sync_alt", title: "Integration console", sub: "FHIR, HL7, SCCM: exceptions, outbound, replay", need: "queue.view" }),
      tile({ go: "ward:emergencyadmin", icon: "gpp_maybe", title: "Emergency access", sub: "Declarations, break-glass log, reconciliation", need: "queue.view" }),
      tile({ go: "ward:downtime", icon: "cloud_off", title: "Downtime pack", sub: "Printable ward state for a network outage", need: "queue.view" }),
    ] : [];
    var peopleTiles = [
      tile({ go: "patients", icon: "person_search", title: "Patients", sub: "Find by MRN, register a new patient, open the chart", need: "queue.view" }),
    ];
    if (native) peopleTiles.push(tile({ go: "maik", icon: "psychology", title: "MaiK clinical AI", sub: "Governed summaries and draft notes, always reviewed by you", need: "emr.view" }));
    var adminTiles = [
      tile({ go: "admin", icon: "admin_panel_settings", title: "Admin Center", sub: "Wards, beds, departments, rooms, staff and roles", need: "staff.admin" }),
      tile({ go: "audit", icon: "policy", title: "Audit and security", sub: "Record changes, emergency access, source grants, service health", need: "emr.view" }),
    ];
    if (native) adminTiles.push(tile({ go: "ward:bedmgmt", icon: "dashboard_customize", title: "Bed management", sub: "Bed master: block, release, housekeeping", need: "staff.admin" }));
    el.innerHTML = head + sec("Clinical", wardTiles) + (cmdTiles.length ? sec("Command and operations", cmdTiles) : "") + sec("Patients and AI", peopleTiles) + sec("Administration", adminTiles);
    if (!native) return;
    // Live counts, each from the same route its tile opens. A count that cannot be read says so.
    var q = "?orgId=" + encodeURIComponent(st.orgId);
    var live = function (id, p, f) { var s = $(id); if (!s) return; s.innerHTML = '<span class="spin"></span>'; api(p).then(function (r) { var v = f(r); s.textContent = v.text; s.className = "live" + (v.stop ? " stop" : ""); }); };
    if (can("queue.view")) live("lvWard", "/ward/list" + q, function (r) { return r && r.ok ? { text: (r.patients || []).length + " admitted" } : { text: "unavailable", stop: true }; });
    if (can("queue.view")) live("lvBeds", "/ward/beds" + q, function (r) { if (!r || !r.ok) return { text: "unavailable", stop: true }; var free = 0, known = false; (r.wards || []).forEach(function (w) { if (w.bedsKnown !== false && w.free) { known = true; free += w.free.length; } }); return { text: known ? free + " free beds" : (r.wards || []).length + " wards, beds not configured" }; });
    if (can("queue.view")) live("lvEd", "/ward/ed-list" + q, function (r) { return r && r.ok ? { text: (r.patients || []).length + " in ED" } : { text: "unavailable", stop: true }; });
    if (can("emr.view")) live("lvCrit", "/ward/criticals" + q + "&state=open", function (r) { var n = r && r.ok ? (r.loops || []).length : -1; return n < 0 ? { text: "unavailable", stop: true } : { text: n + " open", stop: n > 0 }; });
    if (can("queue.view")) live("lvEmerg", "/ward/emergency-status" + q, function (r) { if (!r || !r.ok) return { text: "unavailable", stop: true }; var a = r.active || r.declarations || []; return a.length ? { text: a.length + " emergency active", stop: true } : { text: "no emergency declared" }; });
  } };

  // ---- registry + boot ------------------------------------------------------------------------------------
  G.WSQ = { page: function (name, def) { PAGES[name] = def; }, api: api, esc: esc, ms: ms, go: go, can: can, state: st, toast: toast, render: render, _signInError: signInError };

  function boot() {
    st.tokType = lsGet(LS.tt); st.tok = lsGet(LS.tok); st.orgId = lsGet(LS.hosp);
    if (st.tokType === "account" && !st.tok) {
      // Wait for the Firebase session to restore before deciding the account is gone.
      var settled = false;
      var done = function (u) { if (settled) return; settled = true; st.fbReady = true; st.fbUser = u || null; if (!u) { st.tokType = ""; lsSet(LS.tt, ""); } route(); };
      try { firebase.auth().onAuthStateChanged(done); setTimeout(function () { done(firebase.auth().currentUser); }, 4000); } catch (e) { done(null); }
    } else if (st.tokType === "staff" && !st.tok) { st.tokType = ""; route(); }
    else route();
    window.addEventListener("hashchange", route);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
