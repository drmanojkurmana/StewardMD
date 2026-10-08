/* StewardMD — doctor verification gate + account panel (additive; NEVER edits app.js).
 * ---------------------------------------------------------------------------
 * StewardMD is for registered doctors only. After a real (Google/Apple/phone) sign-in we
 * require a one-time certificate check: the user uploads their medical registration
 * certificate, /api/verify-doctor reads it (Gemini) and cross-checks the LIVE NMC register,
 * then sets the Firebase custom claim verified:true (mirrors the `pro` claim in account.js).
 *
 * Two surfaces, one overlay (#verifyGate):
 *   • FORCED gate — unverified signed-in users are asked to verify. Skipping drops them to the
 *     FREE tier (no Pro), and the account is removed after 7 days if it is never verified
 *     (owner decision 2026-08-27; enforced server-side in _entitlement.js + the lifecycle sweep).
 *   • ACCOUNT PANEL — opened from the sidebar menu ("Account & Verification"); shows the
 *     linked account (provider + email) ↔ registration number ↔ status, with an upload
 *     option when not yet verified. Closable.
 *
 * Pattern mirrors account.js / home.js: read-only over app.js, wrap public window.* seams,
 * steer DOM via listeners/observers. Loaded AFTER account.js in index.html.
 */
(function () {
  "use strict";

  // Shared inline-SVG icon catalog (window.ICONS) → self-styled line icons replacing OS emoji.
  function vfIco(n){ return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }

  /* Team bypass during rollout (mirrors account.js TEST_PRO_EMAILS). Leave BETA_VERIFY_ALL
   * false; trim the allowlist before public launch and rely on the claim. */
  // Gate ON: unverified signed-in doctors must verify their NMC registration (or take the one-time
  // 7-day "Skip for now" trial). Reversible without a rebuild — set localStorage smd_verify_bypass=1
  // on a device to restore the old beta free-for-all there (team testing escape hatch).
  var BETA_VERIFY_ALL = false;
  try { if (window.localStorage && localStorage.getItem("smd_verify_bypass") === "1") BETA_VERIFY_ALL = true; } catch (e) {}
  var VERIFY_ALLOWLIST = [];    // removed the hardcoded 3-email allowlist

  function auth() { try { return window.SMD_AUTH || (window.firebase && window.firebase.auth && window.firebase.auth()); } catch (e) { return null; } }
  function fbUser() { try { var a = auth(); return a && a.currentUser; } catch (e) { return null; } }
  function curEmail() { var u = fbUser(); return String((u && u.email) || "").toLowerCase(); }
  function allowlisted() { return BETA_VERIFY_ALL || VERIFY_ALLOWLIST.indexOf(curEmail()) > -1; }
  function providerLabel() {
    try { if (window.SMD_ACCOUNT && window.SMD_ACCOUNT.provider) {
      var p = window.SMD_ACCOUNT.provider();
      return ({ google: "Google", apple: "Apple", email: "Email", phone: "Mobile", tester: "Tester" })[p] || (p || "Unknown");
    } } catch (e) {}
    return "Unknown";
  }

  /* isVerified() is the ONE answer the whole app uses for "is this doctor verified?", so it must not
   * hand back a stale one. A custom claim set by the owner's approval does NOT appear in the client's
   * ID token until that token refreshes, which Firebase does about hourly. That lag was the reported
   * bug: a genuinely verified doctor was told to verify by Ward Sync and the Rx pad, and then the
   * verify panel - which does consult the server - showed "verified" and let them straight through.
   * The panel already knew how to resolve the disagreement (see evaluate() below); the gates did not,
   * because they read the cached claim and stopped there.
   *
   * The resolution now lives HERE, so every caller gets it:
   *   cached claim true   -> true immediately, no network
   *   cached claim false  -> refresh the token once; a fresh claim settles it
   *   still false         -> ask the server, which is authoritative, then refresh so the claim agrees
   *
   * A TRUE answer is remembered for the session. A FALSE answer is remembered only briefly, so a
   * doctor approved while the app is open is not locked out until they relaunch. force=true skips
   * the cache entirely.
   *
   * NOTE: this deliberately does NOT call fetchStatus(). fetchStatus() falls back to isVerifiedClaim()
   * when the network fails, so calling it from here would be mutual recursion. */
  var _vCache = { val: null, at: 0 };
  var VERIFY_FALSE_TTL = 60000;   // re-check a "no" at most once a minute, not on every gate render
  /* VERIFIED ONCE, VERIFIED EVERYWHERE (owner, 2026-09-27: "after using a verified NMC register
   * number it still asks at some point to verify my registration. once reg is verified it should
   * be universal all over the app").
   *
   * A "yes" used to live only in memory, so every launch started from nothing, and every failure on
   * the way to an answer - an expired token on a slow network, a fetch that timed out, the app
   * opening offline - was scored as "no". evaluate() then ended in showForced(): the forced
   * verification screen, shown to a doctor the server had already verified.
   *
   * So a yes from an AUTHORITATIVE source (the verified claim, or /api/verify-doctor saying
   * "verified") is kept per account on this device, and is only ever withdrawn by an equally
   * authoritative NO - the server answering with some other status. A network failure is not an
   * answer and can never downgrade it. Server-side gates (Pro, billing) still read the token claim
   * and are unaffected; this governs what the app ASKS the doctor. */
  function _vKey(u) { var id = (u && u.uid) || ""; return id ? "smd_verified_ok:" + id : ""; }
  function _persistedYes(u) { try { var k = _vKey(u); return !!(k && localStorage.getItem(k) === "1"); } catch (e) { return false; } }
  function _persist(u, v) { try { var k = _vKey(u); if (!k) return; if (v) localStorage.setItem(k, "1"); else localStorage.removeItem(k); } catch (e) {} }
  function _rememberVerified(v) { _vCache = { val: v, at: Date.now() }; if (v) _persist(fbUser(), true); return v; }
  function _claimOf(u, force) {
    return u.getIdTokenResult(!!force)
      .then(function (r) { return !!(r && r.claims && r.claims.verified === true); })
      .catch(function () { return false; });
  }
  // Minimal, self-contained server check — no claim fallback, so it can never recurse into us.
  // "verified" here means MAY PRESCRIBE: the server's canPrescribe when it sends one (a student or
  // intern is never a prescriber), else the doctor-only "verified" status of older servers.
  function _serverSaysVerified(u) {
    return u.getIdToken().then(function (tok) {
      return fetch("/api/verify-doctor", { headers: { "Authorization": "Bearer " + tok } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) return null;                                   // no answer, not a no
          if (d.status !== "verified") { _persist(u, false); return false; }   // an authoritative no
          return typeof d.canPrescribe === "boolean" ? d.canPrescribe : true;
        });
    }).catch(function () { return null; });                     // network: no answer at all
  }

  /* TRAINEES (audit 2026-09-26, finding 3). An owner-approved medical student or intern holds the
   * claim traineeVerified, NOT verified: a reviewed, real account (no forced gate, free week, never
   * swept) that must never prescribe. isVerified() above stays "registered doctor / may prescribe";
   * isTrainee() is the separate "reviewed student or intern" answer, from the claim first and the
   * server's status second (the claim lags an approval by up to an hour, as for doctors). */
  var _tCache = { val: null, at: 0, role: "" };
  function isTrainee(force) {
    if (allowlisted()) return Promise.resolve(false);
    var u = fbUser(); if (!u) return Promise.resolve(false);
    if (!force && _tCache.val === true) return Promise.resolve(true);
    if (!force && _tCache.val === false && (Date.now() - _tCache.at) < VERIFY_FALSE_TTL) return Promise.resolve(false);
    return u.getIdTokenResult(!!force).then(function (r) {
      var c = (r && r.claims) || {};
      if (c.verified === true) return (_tCache = { val: false, at: Date.now(), role: "" }).val;
      if (c.traineeVerified === true) return (_tCache = { val: true, at: Date.now(), role: _tCache.role }).val;
      return u.getIdToken().then(function (tok) {
        return fetch("/api/verify-doctor", { headers: { "Authorization": "Bearer " + tok } })
          .then(function (x) { return x.ok ? x.json() : null; })
          .then(function (d) {
            var t = !!(d && d.status === "trainee_verified");
            _tCache = { val: t, at: Date.now(), role: (d && d.role) || "" };
            return t;
          });
      });
    }).catch(function () { return false; });
  }
  function traineeRole() { return _tCache.role || ""; }
  // "A real, reviewed account": a registered doctor OR an approved student/intern.
  function isReviewed() {
    return isVerifiedClaim().then(function (v) { return v ? true : isTrainee(); }, function () { return false; });
  }
  function isVerifiedClaim(force) {
    if (allowlisted()) return Promise.resolve(true);
    var u = fbUser(); if (!u) return Promise.resolve(false);
    if (!force && _vCache.val === true) return Promise.resolve(true);
    // Verified on this device before: say so now, with no network. Re-checked in evaluate(), where
    // only an authoritative server answer can withdraw it.
    if (!force && _persistedYes(u)) {
      _vCache = { val: true, at: Date.now() };
      // Once per session, confirm with the server in the background. Only its explicit "no" (a
      // revoked or rejected registration) withdraws this; silence or an error changes nothing.
      if (!isVerifiedClaim._rechecked) { isVerifiedClaim._rechecked = true; try { _serverSaysVerified(u).then(function (sv) { if (sv === false) _vCache = { val: false, at: Date.now() }; }); } catch (e) {} }
      return Promise.resolve(true);
    }
    if (!force && _vCache.val === false && (Date.now() - _vCache.at) < VERIFY_FALSE_TTL) return Promise.resolve(false);
    return _claimOf(u, !!force).then(function (ok) {
      if (ok) return _rememberVerified(true);
      return u.getIdTokenResult(true).then(function (r) {       // the token may simply be stale
        var c = (r && r.claims) || {};
        if (c.verified === true) return _rememberVerified(true);
        // A fresh token that says "reviewed trainee" is a settled NO: no server round trip needed.
        if (c.traineeVerified === true) { _tCache = { val: true, at: Date.now(), role: _tCache.role }; return _rememberVerified(false); }
        return _serverSaysVerified(u).then(function (sv) {       // the server is authoritative
          if (sv === null) return _persistedYes(u);              // could not ask: keep what we knew
          if (!sv) return _rememberVerified(false);
          // Approved, but the claim has not propagated. Refresh so everything else agrees, and let
          // them in either way - the server already said yes.
          return _claimOf(u, true).then(function () { return _rememberVerified(true); },
                                        function () { return _rememberVerified(true); });
        });
      });
    }).catch(function () { return _persistedYes(u); });
  }
  // Full status (incl. pending) from the server; falls back to the claim.
  function fetchStatus() {
    var u = fbUser();
    if (allowlisted()) return Promise.resolve({ status: "verified", regNo: "(team access)" });
    if (!u) return Promise.resolve({ status: "unverified" });
    return u.getIdToken().then(function (tok) {
      return fetch("/api/verify-doctor", { headers: { "Authorization": "Bearer " + tok } })
        .then(function (r) { return r.json(); })
        .then(function (d) { return d && d.status ? d : { status: "unverified" }; });
    }).catch(function () {
      // Not the server's answer: marked, so evaluate() never forces the gate on the strength of it.
      return isVerifiedClaim().then(function (ok) { return { status: ok ? "verified" : "unverified", _offline: true }; });
    });
  }
  /* account.js caches the last /api/billing/status verdict, and every Pro gate - the Subscription
   * row, SMD_PRO_NOTICE, the paywall's own verify-bounce - reads that cache. It is refreshed at
   * sign-in and on app open, NOT at the moment a verification lands, so a doctor who had just been
   * verified tapped Subscription and was told to verify again (reported 2026-09-02). Push a refresh
   * at the moment the answer changes. Best-effort: sync() never rejects; a failure keeps the last
   * verdict, which is what would have been shown anyway. Called AFTER the forced token refresh so
   * the request carries the new claim. */
  // Device id header for the once-per-doctor free week (device-id.js). Never blocks a verification.
  function hwHeaders() {
    try { if (window.SMD_DEVICE && SMD_DEVICE.hwHeaders) return SMD_DEVICE.hwHeaders(); } catch (e) {}
    return Promise.resolve({});
  }
  function resyncPro() { try { if (window.SMD_PRO && typeof window.SMD_PRO.sync === "function") window.SMD_PRO.sync(); } catch (e) {} }
  // isVerified = registered doctor, may prescribe. isTrainee = approved student/intern (never
  // prescribes). isReviewed = either. prescription.js reads isVerified + isTrainee.
  window.SMD_VERIFY = { isVerified: isVerifiedClaim, isTrainee: isTrainee, isReviewed: isReviewed, traineeRole: traineeRole,
    openPanel: openPanel, VERIFY_ALLOWLIST: VERIFY_ALLOWLIST,
    // Test seam: run the startup gate on demand (test/run-verify-universal-ui.mjs).
    _evaluate: function () { return evaluate(); } };

  // ---- Overlay refs ----
  function $(id) { return document.getElementById(id); }
  function gate() { return $("verifyGate"); }

  function setStatusMsg(kind, html) { var s = $("verifyStatus"); if (!s) return; s.className = "verify-status show " + kind; s.innerHTML = html; }
  function clearStatusMsg() { var s = $("verifyStatus"); if (s) { s.className = "verify-status"; s.innerHTML = ""; } }
  function progressHtml(msg) { return '<div class="verify-bar"><span></span></div><div style="margin-top:8px">' + msg + '</div>'; }
  function provisionalActive(iso) { if (!iso) return false; var t = Date.parse(iso); return !isNaN(t) && Date.now() < t; }
  function daysLeft(iso) { var t = Date.parse(iso); return isNaN(t) ? 0 : Math.max(0, Math.ceil((t - Date.now()) / 86400000)); }

  // ---- Role chooser: who is verifying → what proof they upload -----------------------------
  // Doctors and PG residents hold FULL NMC/SMC registration, so both auto-verify against the
  // register (cert, or reg-no + govt photo ID) and may prescribe. Interns (provisional registration
  // only) and students (none) upload an internship or college ID for MANUAL review; approval makes
  // them a reviewed trainee (full access, prescription generator locked). Order = career ladder.
  var REG_SUB = "Upload your <b>registration certificate</b>. We read it and check the national medical register, usually in under a minute.";
  var ROLES = {
    student: { icon: "book", label: "Medical student",
      sub: "Upload your <b>medical college ID card</b>. Our team checks it, usually within a day, and you get the learning tools straight away.",
      fileLabel: "Choose your college ID card", dropSub: "Photo, scan or PDF of your college ID", reg: false },
    intern:  { icon: "idcard", label: "Intern",
      sub: "Upload your <b>internship or hospital ID card</b>. Our team checks it, usually within a day. Interns hold provisional registration, so the prescription generator stays locked until you hold full registration.",
      fileLabel: "Choose your internship or hospital ID", dropSub: "Photo, scan or PDF of your ID card", reg: false },
    resident: { icon: "steth", label: "PG Resident", sub: REG_SUB,
      fileLabel: "Choose your registration certificate", dropSub: "Photo, scan or PDF · NMC or State Medical Council",
      idFileLabel: "Choose a government photo ID", idDropSub: "Aadhaar, PAN, driving licence or voter ID · we read only your name", reg: true },
    doctor:  { icon: "shield", label: "Doctor", sub: REG_SUB,
      fileLabel: "Choose your registration certificate", dropSub: "Photo, scan or PDF · NMC or State Medical Council",
      idFileLabel: "Choose a government photo ID", idDropSub: "Aadhaar, PAN, driving licence or voter ID · we read only your name", reg: true }
  };
  // A reviewed trainee may still upgrade (an intern who now holds full registration), so the
  // chooser stays, but only with the roles that can change anything for them.
  var _hideRoles = {};
  var _role = "doctor";
  var _method = "cert";   // registered roles: "cert" (certificate) | "id" (registration number + photo ID)
  var _vstatus = null;   // last-rendered verification status (verify.js has no _state; that's email-auth.js)
  function curRoleCfg() { return ROLES[_role] || ROLES.doctor; }
  function ensureRoles() {
    var host = $("verifyRoles"); if (!host) return;
    if (!host.childNodes.length) {
      // Four roles: a 2 x 2 grid (index.html's .verify-roles is 3 columns, which strands the 4th).
      host.style.gridTemplateColumns = "repeat(2,1fr)";
      host.innerHTML = Object.keys(ROLES).map(function (k) {
        return '<button type="button" class="verify-role' + (k === _role ? " is-on" : "") + '" data-role="' + k + '" role="tab" aria-selected="' + (k === _role) + '"><span class="vr-ic">' + vfIco(ROLES[k].icon) + '</span><span class="vr-l">' + ROLES[k].label + '</span></button>';
      }).join("");
      host.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-role]"); if (b) applyRole(b.getAttribute("data-role")); });
    }
    Array.prototype.forEach.call(host.querySelectorAll("[data-role]"), function (b) { b.style.display = _hideRoles[b.getAttribute("data-role")] ? "none" : ""; });
  }
  function applyRole(r) {
    if (!ROLES[r] || _hideRoles[r]) r = "doctor";
    _role = r;
    var host = $("verifyRoles");
    if (host) Array.prototype.forEach.call(host.querySelectorAll("[data-role]"), function (b) { var on = b.getAttribute("data-role") === r; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on); });
    if (!curRoleCfg().reg) _method = "cert";                                                   // students/interns: their ID card only
    // The promise has to be true for the role: a person reviews students and interns, the register doctors.
    var pk = $("verifyPerks");
    if (pk) {
      var P = curRoleCfg().reg
        ? [["clock", "About a minute"], ["star", "Pro free for 7 days"], ["shield", "Checked on the NMC register"]]
        : [["clock", "Reviewed within a day"], ["star", "Pro free for 7 days meanwhile"], ["book", "Learning tools right away"]];
      pk.innerHTML = P.map(function (x) { return '<li><span class="vfx-perk-ic" data-ic="' + x[0] + '">' + vfIco(x[0]) + '</span>' + x[1] + '</li>'; }).join("");
    }
    setMethod(_method, true);
    // Only retitle the forced/unverified gate; leave the pending/trial/verified copy render() set.
    if (_vstatus === "unverified" || _vstatus == null) { var sub = $("verifySubtitle"); if (sub) sub.innerHTML = curRoleCfg().sub; }
    syncMode();
  }

  // Render the overlay for a given mode. forced=true → hard block (no close).
  function render(mode, data) {
    var g = gate(); if (!g) return;
    wire();   // idempotent — ensures ✕/buttons are wired on EVERY show path (incl. guest/panel,
              // where evaluate()'s sign-in-gated wire() never ran → ✕ did nothing).
    g.dataset.mode = mode;
    var verified = data && data.status === "verified";
    var trainee  = data && data.status === "trainee_verified";   // reviewed student/intern: access yes, Rx no
    var trial    = data && data.status === "trial";
    var pending  = data && (data.status === "pending" || trial);   // both = provisional, upload still offered
    var st = (data && data.status) || "unverified";
    _vstatus = st;
    var tRole = trainee ? ((data && data.role) === "student" ? "student" : "intern") : "";
    // A trainee can only move UP (intern with full registration); a student/intern re-upload is moot.
    _hideRoles = trainee ? { student: true, intern: true } : {};
    if (trainee && (_role === "student" || _role === "intern")) _role = "resident";
    if (trainee) _tCache = { val: true, at: Date.now(), role: (data && data.role) || "" };   // the server said so

    var acc = $("verifyAccount");
    // A first visit (forced, unverified) does not need an account table of blanks; the menu panel does.
    if (acc) acc.style.display = (st === "loading" || (mode === "forced" && st === "unverified")) ? "none" : "";
    if (acc && st !== "loading") {
      var u = fbUser();
      $("verifyAccEmail").textContent = (u && (u.email || u.displayName)) || "This device";
      $("verifyAccProvider").textContent = providerLabel();
      $("verifyAccReg").textContent = (data && data.regNo) || (verified ? "Not on file" : (trainee ? "None (prescription locked)" : "Not linked yet"));
      var badge = $("verifyBadge");
      badge.className = "verify-badge " + (st === "trial" ? "pending" : (trainee ? "verified" : st));   // reuse pending styling for trial
      badge.innerHTML = trainee ? (vfIco("check") + (tRole === "student" ? " Verified student" : " Verified intern"))
        : (({ verified: vfIco("check") + " Verified", pending: "Under review", trial: "Free plan", rejected: "Rejected", unverified: "Not verified" })[st] || st);
    }

    $("verifyTitle").textContent = verified ? "You're verified"
      : (trainee ? (tRole === "student" ? "Student account verified" : "Intern account verified")
      : (trial ? "You're on the free plan" : (pending ? "We're checking your document" : "Verify your registration")));
    var perks = $("verifyPerks"); if (perks) perks.style.display = (verified || trainee || pending) ? "none" : "";
    var sub = $("verifySubtitle");
    if (sub) sub.innerHTML = verified
      ? "Your registration is linked to this account. Pro is free for your first 7 days."
      : (trainee
        ? "Your account is active. The prescription generator stays locked until you hold full registration; then verify it below as a PG Resident or Doctor."
      : (trial
        ? "You're using the free tools. Verify your registration to unlock Pro free for 7 days and the prescription generator. Unverified accounts are removed after 7 days."
        : (pending
          ? "A person is checking it, usually within a day, and we'll email you. Pro stays on meanwhile. A clearer copy below can still verify you instantly."
          : curRoleCfg().sub)));

    // Upload box stays available unless FULLY verified, so a doctor under review can re-submit a
    // clearer certificate and a reviewed trainee can later verify full registration.
    var up = $("verifyUploadBlock");
    if (up) up.style.display = verified ? "none" : "";
    var rw = $("verifyRoleWrap"); if (rw) rw.style.display = verified ? "none" : "";   // role chooser only while not fully verified
    if (!verified) {
      var sub2 = $("verifySubmit"); if (sub2) { sub2.disabled = false; sub2.style.display = ""; }
      var dr0 = $("verifyDrop"); if (dr0) dr0.style.display = "";   // settle() hides these after a success
      ensureRoles(); applyRole(_role);   // build/refresh the role chooser + role-specific labels
      syncMode();   // sets labels/button for cert-vs-ID mode + file state
      if (pending) { clearStatusMsg(); var sb2 = $("verifySubmit"); if (sb2) sb2.textContent = "Upload a clearer copy"; }
      else { clearStatusMsg(); }
    }

    var closable = mode !== "forced";
    var x = $("verifyClose"); if (x) x.style.display = "";   // always shown; on the forced gate ✕ continues on the free plan
    var skip = $("verifySkipBtn"); if (skip) skip.style.display = (mode === "forced" && !verified && !trainee) ? "" : "none";
    var done = $("verifyDoneBtn"); if (done) done.style.display = (closable && (verified || trainee || pending)) ? "" : "none";

    // Offline: certificate upload + the trial/register checks all need the network, so the normal
    // "Not verified → verify now" flow is a dead-end. Show an offline-aware state whose primary action
    // is a LOCAL "Continue in offline mode" dismiss (see startTrial's offline guard), never a hang.
    var offline = (typeof navigator !== "undefined" && navigator.onLine === false);
    var skipBtn = $("verifySkipBtn");
    if (offline && !verified) {
      $("verifyTitle").textContent = "You're offline";
      if (sub) sub.textContent = "Doctor verification needs an internet connection. Certificate upload and register checks can't run offline. Keep using StewardMD's offline tools now; reconnect and reopen this screen to verify and unlock the prescription generator.";
      if (up) up.style.display = "none";
      setStatusMsg("info", "Offline mode. Verification resumes automatically when you're back online.");
      if (skipBtn) { skipBtn.textContent = "Continue in offline mode"; skipBtn.style.display = ""; }
    } else if (skipBtn) {
      skipBtn.textContent = "Not now, continue on the free plan";   // restore default when online
    }

    g.classList.remove("hidden"); g.style.display = "flex";
  }

  function showForced() { render("forced", { status: "unverified" }); }
  function hideGate() { var g = gate(); if (g) { g.classList.add("hidden"); g.style.display = "none"; g.dataset.mode = ""; } }

  // Open the account/verification panel from the menu (always closable).
  function openPanel() {
    render("panel", { status: "loading" });
    $("verifyTitle").textContent = "Account & Verification";
    setStatusMsg("info", '<span class="verify-spinner"></span>Checking your verification status…');
    fetchStatus().then(function (d) { clearStatusMsg(); render("panel", d); });
  }

  // ---- Upload flow ----
  function fileToB64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ""); var c = s.indexOf(","); resolve({ b64: c >= 0 ? s.slice(c + 1) : s, mime: file.type || "image/jpeg" }); };
      r.onerror = reject; r.readAsDataURL(file);
    });
  }
  var submitting = false;
  async function submit() {
    if (submitting) return;
    var input = $("verifyFile"); var file = input && input.files && input.files[0];
    // No file yet → the button acts as "Choose certificate": open the picker.
    if (!file) { if (input) input.click(); return; }
    var u = fbUser(); if (!u) { setStatusMsg("error", "Session expired. Please sign in again."); return; }
    var regEl = $("verifyRegNo"); var typedReg = (_method === "id" && regEl) ? regEl.value.trim() : "";
    if (_method === "id" && curRoleCfg().reg && !typedReg) {
      setStatusMsg("error", "Enter your registration number first. We match it with the name on your photo ID.");
      if (regEl) try { regEl.focus(); } catch (e) {}
      return;
    }
    submitting = true;
    var btn = $("verifySubmit"); if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    runSteps(!curRoleCfg().reg
      ? ["Uploading your ID card", "Sending it to our review team"]
      : typedReg
        ? ["Reading the name on your ID", "Looking up " + typedReg.replace(/[<>&"]/g, "") + " on the national register", "Matching the two"]
        : ["Reading your certificate", "Looking you up on the national medical register", "Matching your name and number"]);
    try {
      var parts = await Promise.all([fileToB64(file), u.getIdToken(), hwHeaders()]);
      var payloadBody = { idToken: parts[1], image: parts[0].b64, mime: parts[0].mime, role: _role };
      if (typedReg) payloadBody.regNo = typedReg;   // ID-mode: name-match against this reg no
      var res = await fetch("/api/verify-doctor", {
        method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, parts[2]),
        body: JSON.stringify(payloadBody)
      });
      var data = await res.json().catch(function () { return {}; });
      var mode = (gate() && gate().dataset.mode) || "forced";

      // 1) Auto-verified against NMC → big tick + full access (confirmation email sent server-side).
      if (data.status === "verified") {
        stopSteps();
        setStatusMsg("success", resultHtml(vfIco("check") + " You're verified", [
          "Dr. " + String(data.name || "").replace(/[<>&"]/g, "") + (data.regNo ? ", " + String(data.regNo).replace(/[<>&"]/g, "") : ""),
          "Pro is free for your first 7 days, including the prescription generator.",
          "A confirmation email is on its way."]));
        settle(true); showStatus();
        try { await u.getIdToken(true); } catch (e) {}
        _rememberVerified(true);
        _tCache = { val: false, at: Date.now(), role: "" };   // a trainee who verified full registration is a doctor now
        resyncPro();   // the cached entitlement verdict predates this verification
        setTimeout(hideGate, 2600);
        return;
      }
      // 2) AI unsure / not matched → cert emailed to support; grant PROVISIONAL access.
      if (data.status === "pending_review" && data.trialUsed) {
        // Once per doctor: the free week was already used with this registration, number or device.
        if (mode === "panel") { render("panel", { status: "pending", provisionalUntil: "" }); submitting = false; return; }
        stopSteps();
        setStatusMsg("pending", resultHtml("Sent for a quick manual check", [
          "Our team will check it and email you, usually within a day.",
          "The free Pro week was already used with this registration, mobile number or device, so the free plan stays on while we review."]));
        settle(false); showStatus();
        setTimeout(hideGate, 3200);
        submitting = false; return;
      }
      if (data.status === "pending_review") {
        var d = data.provisionalDays || 7;
        // The free week is a claim the server just wrote (provUntil). The verified path above refreshed the
        // token and the cached Pro verdict; this one did not, so the app kept saying Free until the token
        // renewed itself, up to an hour later (owner, 2026-10-08: "7 day pro not activated").
        try { await u.getIdToken(true); } catch (e) {}
        try { resyncPro(); } catch (e) {}
        if (mode === "panel") { render("panel", { status: "pending", provisionalUntil: data.provisionalUntil }); submitting = false; return; }
        var tr = (_role === "student" || _role === "intern");
        stopSteps();
        setStatusMsg("pending", resultHtml(tr ? "ID received" : "Sent for a quick manual check", [
          tr ? "Our team checks it, usually within a day, and emails you."
             : "We couldn't confirm it on the national register automatically, so a person will check it, usually within a day. We'll email you.",
          "<b>Pro is on for the next " + d + " days</b> while we review.",
          tr ? "The prescription generator stays locked for " + (_role === "student" ? "students" : "interns") + "."
             : "The prescription generator unlocks as soon as you're approved."]));
        settle(false); showStatus();
        // the next tap picks a NEW file (a clearer copy can still verify instantly), not the same one again
        if (input) input.value = ""; paintPreview(null);
        var dr = $("verifyDrop"); if (dr) dr.classList.remove("has-file");
        if (btn) btn.disabled = false;
        submitting = false; syncMode();
        if (btn) btn.textContent = "Upload a clearer copy";
        return;
      }
      if (data.status === "rejected" && data.reason === "registration_already_claimed") {
        stopSteps();
        setStatusMsg("error", "This registration number is already linked to another StewardMD account. If that's you, sign in with that account, or write to support@stewardmd.in.");
        showStatus();
        submitting = false; if (btn) { btn.disabled = false; btn.textContent = "Verify now"; } return;
      }
      stopSteps();
      setStatusMsg("error", "We couldn't read that file. Try a clearer photo or a PDF of the full certificate, or write to support@stewardmd.in.");
      showStatus();
      submitting = false; if (btn) { btn.disabled = false; btn.textContent = "Verify now"; }
    } catch (e) {
      stopSteps();
      setStatusMsg("error", "No connection. Check your internet and tap Verify again.");
      showStatus();
      submitting = false; if (btn) { btn.disabled = false; btn.textContent = "Verify now"; }
    }
  }

  // "Skip for now" — start the one-time 7-day trial (server-side, per account). Grants
  // provisional access (prescription stays locked); dismisses the gate. Used by BOTH the
  // skip button and the ✕ on the forced gate (a bare close would just re-force otherwise).
  var trialing = false;
  function startTrial() {
    if (trialing) return;
    // Offline: the trial is server-granted, so there's nothing to call — dismiss locally so the
    // screen is never stuck (this path also backs the ✕ on the forced gate and "Continue offline").
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      hideGate();
      try { (window.toast || window.SMD_toast || function () {})("Offline. You can verify when you're back online."); } catch (e) {}
      return;
    }
    var u = fbUser(); if (!u) { setStatusMsg("error", "Session expired. Please sign in again."); return; }
    trialing = true;
    var skip = $("verifySkipBtn"); if (skip) skip.disabled = true;
    setStatusMsg("info", progressHtml("Starting your 7-day trial…"));
    u.getIdToken().then(function (tok) {
      return fetch("/api/verify-doctor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: tok, trial: true })
      });
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
      trialing = false; if (skip) skip.disabled = false;
      if (d && d.status === "trial") {
        var n = daysLeft(d.provisionalUntil) || d.provisionalDays || 7;
        hideGate();
        try { (window.toast || window.SMD_toast || function () {})("Free plan · verify within " + n + "d to keep this account and unlock Pro"); } catch (e) {}
        return;
      }
      if (d && d.status === "verified") {   // already verified (or a reviewed trainee): just let them in
        (u.getIdToken ? u.getIdToken(true) : Promise.resolve()).catch(function () {}).then(hideGate);
        return;
      }
      if (d && d.status === "trial_expired") {
        setStatusMsg("error", "This account has been unverified for 7 days and is due for removal. Verify your registration now to keep it.");
        return;
      }
      setStatusMsg("error", "Couldn't continue. Please try again, or verify your certificate.");
    }).catch(function () {
      trialing = false; if (skip) skip.disabled = false;
      setStatusMsg("error", "Network error. Please try again.");
    });
  }

  // Reflect ID-mode (a reg number typed) vs certificate-mode in the labels.
  // Certificate vs registration number + photo ID: one visible path at a time.
  function setMethod(m, quiet) {
    _method = (m === "id" && curRoleCfg().reg) ? "id" : "cert";
    var ms = $("verifyMethod"); if (ms) {
      ms.style.display = curRoleCfg().reg ? "" : "none";
      Array.prototype.forEach.call(ms.querySelectorAll("[data-method]"), function (b) { var on = b.getAttribute("data-method") === _method; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on); });
    }
    var rr = $("verifyRegRow"); if (rr) rr.style.display = _method === "id" ? "" : "none";
    var dr = $("verifyDrop"); if (dr) dr.style.display = "";            // settle() hid these after a success
    var sb = $("verifySubmit"); if (sb) sb.style.display = "";
    if (_method !== "id") { var reg = $("verifyRegNo"); if (reg) reg.value = ""; }             // never send a number in certificate mode
    if (!quiet) {
      // a certificate is not the photo ID the other method needs (and vice versa): start that path clean
      var fi = $("verifyFile"); if (fi && fi.files && fi.files.length) { fi.value = ""; paintPreview(null); var d0 = $("verifyDrop"); if (d0) d0.classList.remove("has-file"); }
      clearStatusMsg(); if (_method === "id") { var r2 = $("verifyRegNo"); if (r2) try { r2.focus(); } catch (e) {} } }
    syncMode();
  }
  // What was chosen, at a glance: a thumbnail for a photo, a document mark for a PDF.
  function paintPreview(f) {
    var pv = $("verifyPreview"); if (!pv) return;
    try { if (pv._url) URL.revokeObjectURL(pv._url); } catch (e) {}
    pv._url = ""; pv.innerHTML = "";
    if (!f) return;
    if (/^image\//.test(f.type || "")) { try { pv._url = URL.createObjectURL(f); var im = document.createElement("img"); im.alt = ""; im.src = pv._url; pv.appendChild(im); return; } catch (e) {} }
    pv.innerHTML = vfIco("note");
  }
  // Live steps while the upload is checked, so a minute of waiting never looks like nothing happening.
  var _stepT = [];
  function stepsHtml(labels, now) {
    return '<ol class="vfx-steps">' + labels.map(function (l, i) {
      return '<li class="' + (i < now ? "is-done" : i === now ? "is-now" : "") + '"><span class="vfx-dot" aria-hidden="true"></span>' + l + '</li>';
    }).join("") + '</ol>';
  }
  function runSteps(labels) {
    _stepT.forEach(clearTimeout); _stepT = [];
    setStatusMsg("info", stepsHtml(labels, 0));
    labels.forEach(function (l, i) { if (i) _stepT.push(setTimeout(function () { setStatusMsg("info", stepsHtml(labels, i)); }, i * 2600)); });
    showStatus();
  }
  function stopSteps() { _stepT.forEach(clearTimeout); _stepT = []; }
  function showStatus() { var s = $("verifyStatus"); if (s && s.scrollIntoView) try { s.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} }
  // Once there is an answer, the only next step is to continue: no "skip" beside a result.
  function settle(ok) {
    var sk = $("verifySkipBtn"); if (sk) sk.style.display = "none";
    var dn = $("verifyDoneBtn"); if (dn) dn.style.display = "";
    if (ok) { var b = $("verifySubmit"); if (b) b.style.display = "none"; var m = $("verifyMethod"); if (m) m.style.display = "none"; var dr = $("verifyDrop"); if (dr) dr.style.display = "none"; }
  }
  function resultHtml(title, points) {
    return '<div class="vfx-res"><div class="vfx-res-t">' + title + '</div><ul>' + points.map(function (p) { return "<li>" + p + "</li>"; }).join("") + '</ul></div>';
  }
  function syncMode() {
    var reg = $("verifyRegNo"), label = $("verifyFileLabel"), sub = $("verifyDropSub"),
        btn = $("verifySubmit"), input = $("verifyFile"), drop = $("verifyDrop");
    var R = curRoleCfg();
    var idMode = R.reg && _method === "id";                      // ID-mode (reg-no + photo ID) is doctors-only
    var hasFile = !!(input && input.files && input.files[0]);
    if (label && !hasFile) label.textContent = idMode ? (R.idFileLabel || "Choose a photo ID") : R.fileLabel;
    if (sub) sub.textContent = hasFile ? "Tap to choose a different file" : (idMode ? (R.idDropSub || "Any government photo ID · we read only your name") : R.dropSub);
    if (btn && !btn.disabled) btn.textContent = hasFile
      ? (idMode ? "Verify with photo ID" : (R.reg ? "Verify now" : "Send for review"))
      : (idMode ? "Choose photo ID" : ("Choose " + (R.reg ? "certificate" : "ID card")));
    if (drop) drop.classList.toggle("has-file", hasFile);
  }

  function wire() {
    var input = $("verifyFile"), drop = $("verifyDrop"), btn = $("verifySubmit"),
        signout = $("verifySignOut"), label = $("verifyFileLabel"), x = $("verifyClose"), done = $("verifyDoneBtn"), reg = $("verifyRegNo"), skip = $("verifySkipBtn");
    if (input && !input._smdWired) {
      input._smdWired = true;
      input.addEventListener("change", function () {
        var f = input.files && input.files[0];
        if (f) { if (label) label.textContent = f.name; if (drop) drop.classList.add("has-file"); if (btn) btn.disabled = false; clearStatusMsg(); }
        else { if (drop) drop.classList.remove("has-file"); if (btn) btn.disabled = false; }
        paintPreview(f);
        syncMode();
      });
    }
    if (reg && !reg._smdWired) { reg._smdWired = true; reg.addEventListener("input", syncMode); }
    var ms = $("verifyMethod");
    if (ms && !ms._smdWired) { ms._smdWired = true; ms.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-method]"); if (b) setMethod(b.getAttribute("data-method")); }); }
    // the icon set (home.js) can arrive after the first render: fill any still-empty perk icon each time
    var pk = $("verifyPerks");
    if (pk) Array.prototype.forEach.call(pk.querySelectorAll("[data-ic]"), function (n) { if (!n.firstChild) n.innerHTML = vfIco(n.getAttribute("data-ic")); });
    if (btn && !btn._smdWired) { btn._smdWired = true; btn.addEventListener("click", submit); }
    if (x && !x._smdWired) {
      x._smdWired = true;
      x.addEventListener("click", function () {
        // On the FORCED gate the ✕ records the free-plan choice (a plain close just re-forces);
        // elsewhere (panel / already provisional) it simply dismisses.
        var g = gate();
        if (g && g.dataset.mode === "forced") startTrial(); else hideGate();
      });
    }
    if (skip && !skip._smdWired) { skip._smdWired = true; skip.addEventListener("click", startTrial); }
    if (done && !done._smdWired) { done._smdWired = true; done.addEventListener("click", hideGate); }
    if (signout && !signout._smdWired) {
      signout._smdWired = true;
      signout.addEventListener("click", function () {
        // "Use a different account" — full teardown so it works for GUESTS too
        // (guest session lives in stewardmd_account; a bare Firebase signOut left it
        // intact → reload just resumed guest → button appeared dead). Clear the
        // account, stop Google auto-select, end any Firebase session, THEN reload to
        // the sign-in gate. (Don't reload before signOut resolves — that was the race.)
        hideGate();
        try {
          var g = window.google;
          if (g && g.accounts && g.accounts.id && g.accounts.id.disableAutoSelect) g.accounts.id.disableAutoSelect();
        } catch (e) {}
        /* Drop the cached logbook FIRST. pglog's storage key is derived from the signed-in uid, so
         * once stewardmd_account is gone the store can no longer find the record to delete - and
         * store.clearAccount() had no callers anywhere, leaving a full cached dashboard (case
         * references, diagnoses, entry titles) in device storage after sign-out. */
        try { if (window.SMD_PGLOG_STORE && SMD_PGLOG_STORE.clearAccount) SMD_PGLOG_STORE.clearAccount(); } catch (e) {}
        try { localStorage.removeItem("stewardmd_account"); } catch (e) {}
        var a = auth();
        // Reload once signOut settles — but never let a slow/hanging signOut block it.
        var reloaded = false;
        function go() { if (reloaded) return; reloaded = true; try { location.reload(); } catch (e) {} }
        // S3: off the hospital's critical-result alerts first, while the account still works (native-push.js,
        // bounded wait; a failure is recorded there and told on the next launch).
        var P = window.SMD_WSQ_PUSH, rel = Promise.resolve();
        try { if (P && P.accountSignOut) rel = Promise.resolve(P.accountSignOut()).catch(function () {}); } catch (e) {}
        rel.then(function () {
          var p = (a && a.signOut) ? a.signOut() : Promise.resolve();
          Promise.resolve(p).catch(function () {}).then(go);
          setTimeout(go, 700);
        });
      });
    }
  }

  // A reviewed student/intern: a real account, never nagged, never a prescriber. Refresh the token so
  // the traineeVerified claim reaches the server gates, then the cached Pro verdict, then let them in.
  function admitTrainee(d) {
    _tCache = { val: true, at: Date.now(), role: (d && d.role) || "" };
    var u3 = fbUser();
    (u3 && u3.getIdToken ? u3.getIdToken(true) : Promise.resolve()).catch(function () {}).then(function () {
      resyncPro();
      if (gate() && gate().dataset.mode !== "panel") hideGate();
    });
  }

  // ---- Forced gate: signed-in real accounts must be verified ----
  var _promptedThisOpen = false;   // re-ask once per app open, not once per evaluate() call
  function evaluate() {
    var u = fbUser();
    if (!u) { hideGate(); return; }            // not signed in → app.js's account gate handles it
    wire();
    isVerifiedClaim().then(function (ok) {
      var g = gate();
      if (ok) { if (g && g.dataset.mode !== "panel") hideGate(); return; }   // fully verified
      // Cached claim says not-verified — but the server is authoritative. Consult it.
      fetchStatus().then(function (d) {
        // We could not reach the server. Nothing here is a verdict, so nothing is forced: a doctor
        // opening the app on a poor network is not told to verify again.
        if (d && d._offline && d.status !== "verified") { if (gate() && gate().dataset.mode !== "panel") hideGate(); return; }
        if (d && d.status === "trainee_verified") { admitTrainee(d); return; }   // reviewed student/intern
        // Owner just approved us (email/admin)? The cached ID token doesn't carry the fresh
        // verified:true claim yet — force a token refresh so the claim catches up, then let
        // the doctor straight in. No re-upload, no re-login, no manual admin step.
        if (d && d.status === "verified") {
          // Tell isVerified() too, or every feature gate keeps saying "not verified" from the cached
          // negative until its TTL lapses - which is the bug this whole path exists to work around.
          _rememberVerified(true);
          var u2 = fbUser();
          (u2 && u2.getIdToken ? u2.getIdToken(true) : Promise.resolve()).catch(function () {}).then(function () {
            resyncPro();   // owner approval landed while the app was open: refresh the cached verdict too
            if (gate() && gate().dataset.mode !== "panel") hideGate();
          });
          return;
        }
        // Otherwise allow PROVISIONAL access — a manual review pending OR an active 7-day
        // "skip" trial — while inside the window; else force verification.
        var provisional = d && (d.status === "pending" || d.status === "trial") && provisionalActive(d.provisionalUntil);
        if (provisional) {
          /* ASK ON EVERY APP OPEN until verified (owner decision, 2026-08-27). Before this, one tap
           * on "Not now" silenced the prompt for the whole 7 days, so an account could reach the
           * deletion sweep having been asked exactly once. Still dismissible - an unverified doctor
           * keeps the free tier - but they are asked again next time they open the app.
           *
           * PENDING REVIEW IS EXEMT: they have already sent us their proof and are waiting on us.
           * Nagging someone for something they have already done is how an app loses a real doctor.
           * Once per app OPEN, not per evaluate(): this runs on every auth/account change too. */
          if (d.status !== "pending" && !_promptedThisOpen) {
            _promptedThisOpen = true;
            if (!gate() || gate().dataset.mode !== "panel") { render("forced", d); return; }
          }
          if (gate() && gate().dataset.mode !== "panel") hideGate();
          try { (window.toast || window.SMD_toast || function () {})((d.status === "trial" ? "Trial access · " : "Provisional access · ") + daysLeft(d.provisionalUntil) + "d left to verify · prescription locked"); } catch (e) {}
        } else {
          showForced();
        }
      }).catch(function () {
        // A failure to ASK is not an answer. Only force the screen for an account never verified here.
        if (_persistedYes(fbUser())) { if (gate() && gate().dataset.mode !== "panel") hideGate(); return; }
        showForced();
      });
    });
  }

  // ---- Inject "Account & Verification" into the sidebar (mirrors home.js SB.open wrap) ----
  /* The drawer's first row is PROFILE (owner, 2026-09-27, screenshot: "want profile button here").
   * It used to be "Account & Verification", a second door into what is now one Profile page; that
   * page holds verification, so this row opens Profile. Permanent, not behind a flag. */
  function injectMenu() {
    var menu = $("sbMenu"); if (!menu || menu.querySelector("[data-smd-verify]")) return;
    var b = document.createElement("button");
    b.className = "sb-main sb-main-link"; b.setAttribute("data-smd-verify", "1"); b.setAttribute("data-smd-profile", "1");
    b.innerHTML = '<span class="ic">' + (vfIco("user") || vfIco("shield")) + '</span><span>Profile</span>';
    b.addEventListener("click", function () {
      try { if (window.SB && SB.close) SB.close(); } catch (e) {}
      setTimeout(function () { try { if (window.SMD_openProfile) window.SMD_openProfile(); else openPanel(); } catch (e) {} }, 80);
    });
    menu.insertBefore(b, menu.firstChild);
  }
  function wrapSBOpen() {
    try {
      if (window.SB && typeof SB.open === "function" && !SB.open._smdVerifyWrapped) {
        var orig = SB.open;
        SB.open = function () { var r = orig.apply(this, arguments); setTimeout(injectMenu, 90); return r; };
        SB.open._smdVerifyWrapped = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ---- Boot ----
  (function boot(n) {
    var a = auth();
    if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { evaluate(); }); }
    else if (n < 80) { setTimeout(function () { boot(n + 1); }, 250); return; }
    try { if (window.SMD_ACCOUNT && window.SMD_ACCOUNT.onChange) window.SMD_ACCOUNT.onChange(function () { evaluate(); }); } catch (e) {}
    // #verifyGate's fields are static markup, already parsed (scripts load `defer`) — this only
    // waits for Firebase Auth to resolve async and give us a user. wire()'s listeners are bound
    // once per element (_smdWired) and keep working for every later sign-in, so once we've wired
    // them the observer's job is done — disconnect instead of rescanning the whole DOM forever.
    try {
      var wireObs = new MutationObserver(function () { if (fbUser()) { wire(); wireObs.disconnect(); } });
      wireObs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    evaluate();
  })(0);
  (function hookMenu(n) { if (wrapSBOpen()) { injectMenu(); return; } if (n < 120) setTimeout(function () { hookMenu(n + 1); }, 250); })(0);
})();
