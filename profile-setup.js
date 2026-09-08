/* profile-setup.js — first-run professional details (phone · college/hospital · degree · speciality).
 * ============================================================================================
 * WHY: the Profile card already stores these under users/{uid}/profile/self, and the curated
 * institution directory already exists (window.SMD_HOSPITALS, hospitals-in.js). What was missing is
 * anything that ASKS. So the fields sat empty, the directory looked "gone", and nothing in the app
 * knew the clinician's degree or speciality.
 *
 * Behaviour: on every app start, once auth has resolved, if a signed-in user is missing any of the
 * four fields we open this form. It can be postponed ("Later") but returns on the next start, which
 * is what the owner asked for. It never blocks a guest and never blocks the app.
 *
 * SELF-CONTAINED overlay on purpose: it must be able to run at boot, before/independently of
 * home.js's sheet system, and it must not fight the Profile sheet for the same DOM node.
 *
 * Writes the SAME Firestore doc the Profile card reads, so the two are never out of sync:
 *   users/{uid}/profile/self  ->  { phone, hospital, degree, speciality }
 * Exposes window.SMD_PROFILE_SETUP = { open, needed, missing, DEGREES, SPECIALITIES }.
 * ============================================================================================ */
(function () {
  "use strict";

  var ROOT_ID = "pfSetupRoot";
  var SNOOZE_KEY = "smd_profile_setup_snoozed_at";   // per-app-open postponement only

  /* Postgraduate qualifications as they are actually written in India. MBBS is included even though
   * the request listed only the PG degrees: this form is mandatory-ish, and an intern, house officer
   * or medical officer holding only MBBS must be able to complete it truthfully rather than pick a
   * degree they do not hold. */
  var DEGREES = ["MBBS", "MD", "MS", "DM", "MCh", "DNB", "DrNB", "Diploma", "Other"];

  /* Broad but finite. Covers the MD/MS/DNB, DM/MCh/DrNB and the common diploma tracks. */
  var SPECIALITIES = [
    "Internal Medicine", "General Surgery", "Paediatrics", "Obstetrics & Gynaecology",
    "Anaesthesiology", "Orthopaedics", "Radiodiagnosis", "Pathology", "Microbiology",
    "Pharmacology", "Physiology", "Anatomy", "Biochemistry", "Forensic Medicine",
    "Community Medicine", "Dermatology, Venereology & Leprosy", "Psychiatry",
    "Otorhinolaryngology (ENT)", "Ophthalmology", "Respiratory Medicine", "Emergency Medicine",
    "Family Medicine", "Geriatric Medicine", "Hospital Administration", "Nuclear Medicine",
    "Radiation Oncology", "Transfusion Medicine", "Sports Medicine", "Palliative Medicine",
    "Cardiology", "Neurology", "Nephrology", "Gastroenterology", "Hepatology", "Endocrinology",
    "Medical Oncology", "Clinical Haematology", "Rheumatology", "Clinical Immunology",
    "Infectious Diseases", "Critical Care Medicine", "Neonatology", "Paediatric Cardiology",
    "Cardiothoracic & Vascular Surgery", "Neurosurgery", "Urology", "Surgical Oncology",
    "Plastic & Reconstructive Surgery", "Paediatric Surgery", "Surgical Gastroenterology",
    "Vascular Surgery", "Endocrine Surgery", "Trauma Surgery", "Dentistry / OMFS",
    "Physical Medicine & Rehabilitation", "Other"
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function uid() { try { return (window.SMD_AUTH && SMD_AUTH.currentUser && SMD_AUTH.currentUser.uid) || null; } catch (e) { return null; } }
  function db() { try { return window.SMD_DB || null; } catch (e) { return null; } }
  function docRef() { var u = uid(), d = db(); return (u && d) ? d.collection("users").doc(u).collection("profile").doc("self") : null; }

  var FIELDS = [
    { key: "phone", label: "Phone number", kind: "tel", ph: "10-digit mobile number" },
    { key: "hospital", label: "College / hospital", kind: "hospital", ph: "Search the directory" },
    { key: "degree", label: "Degree", kind: "choice", opts: DEGREES, ph: "Choose your qualification" },
    { key: "speciality", label: "Speciality", kind: "choice", opts: SPECIALITIES, ph: "Choose your speciality" }
  ];

  function missing(d) {
    d = d || {};
    var out = [];
    for (var i = 0; i < FIELDS.length; i++) {
      var v = d[FIELDS[i].key];
      if (v == null || String(v).trim() === "") out.push(FIELDS[i].key);
    }
    return out;
  }

  /* ── the overlay ──────────────────────────────────────────────────────────────────────────── */
  function styleOnce() {
    if (document.getElementById("pfSetupCss")) return;
    var st = document.createElement("style");
    st.id = "pfSetupCss";
    st.textContent = [
      "#" + ROOT_ID + "{position:fixed;inset:0;z-index:17000;display:none;align-items:flex-end;justify-content:center;background:rgba(15,23,42,.46);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}",
      "#" + ROOT_ID + ".on{display:flex}",
      "#" + ROOT_ID + " .pfs-card{width:100%;max-width:560px;max-height:92vh;overflow:auto;-webkit-overflow-scrolling:touch;background:var(--hpanel,#fff);color:var(--hink,#0f172a);border-radius:20px 20px 0 0;padding:18px 16px calc(env(safe-area-inset-bottom,0px) + 18px);box-shadow:0 -8px 40px -8px rgba(15,23,42,.4);font-family:var(--hfont,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif)}",
      "#" + ROOT_ID + " .pfs-t{font:800 18px/1.25 var(--hfont,system-ui);margin:2px 0 4px}",
      "#" + ROOT_ID + " .pfs-s{font:500 13px/1.45 var(--hfont,system-ui);color:var(--hmut,#64748b);margin:0 0 14px}",
      "#" + ROOT_ID + " .pfs-f{margin:0 0 12px}",
      "#" + ROOT_ID + " .pfs-l{display:block;font:700 11.5px/1 var(--hfont,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--hmut,#64748b);margin:0 0 6px}",
      "#" + ROOT_ID + " .pfs-in,#" + ROOT_ID + " .pfs-pick{width:100%;box-sizing:border-box;padding:12px;border:1px solid var(--hbd,#e2e8f0);border-radius:12px;font:600 14px var(--hfont,system-ui);background:var(--hpanel,#fff);color:var(--hink,#0f172a);text-align:left;min-height:46px}",
      "#" + ROOT_ID + " .pfs-pick{cursor:pointer}",
      "#" + ROOT_ID + " .pfs-pick.unset{color:var(--hmut,#94a3b8);font-weight:500}",
      "#" + ROOT_ID + " .pfs-err{font:600 11.5px var(--hfont,system-ui);color:#b91c1c;margin-top:5px;display:none}",
      "#" + ROOT_ID + " .pfs-f.bad .pfs-in,#" + ROOT_ID + " .pfs-f.bad .pfs-pick{border-color:#b91c1c}",
      "#" + ROOT_ID + " .pfs-f.bad .pfs-err{display:block}",
      "#" + ROOT_ID + " .pfs-acts{display:flex;gap:10px;margin-top:16px}",
      "#" + ROOT_ID + " .pfs-btn{flex:1;border:0;border-radius:12px;padding:13px;font:700 14px var(--hfont,system-ui);cursor:pointer;min-height:48px}",
      "#" + ROOT_ID + " .pfs-save{background:var(--hp,#0f766e);color:#fff}",
      "#" + ROOT_ID + " .pfs-later{background:none;border:1px solid var(--hbd,#e2e8f0);color:var(--hmut,#64748b);flex:0 0 34%}",
      "#" + ROOT_ID + " .pfs-list{max-height:52vh;overflow:auto;-webkit-overflow-scrolling:touch;margin-top:8px}",
      "#" + ROOT_ID + " .pfs-opt{display:block;width:100%;text-align:left;border:0;border-top:1px solid var(--hbd,#e2e8f0);background:none;padding:12px 4px;cursor:pointer;min-height:46px}",
      "#" + ROOT_ID + " .pfs-opt b{display:block;font:600 13.5px var(--hfont,system-ui);color:var(--hink,#0f172a)}",
      "#" + ROOT_ID + " .pfs-opt span{display:block;font:500 11px var(--hfont,system-ui);color:var(--hmut,#64748b)}",
      "body.dark #" + ROOT_ID + " .pfs-card{background:#111b2e;color:#e7edf5}",
      "body.dark #" + ROOT_ID + " .pfs-in,body.dark #" + ROOT_ID + " .pfs-pick{background:#0b1220;color:#e7edf5;border-color:#1e2b43}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }
  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    styleOnce();
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Complete your professional details");
    document.body.appendChild(el);
    return el;
  }
  function close() { var el = document.getElementById(ROOT_ID); if (el) { el.classList.remove("on"); el.innerHTML = ""; } }

  /* A searchable chooser rendered INSIDE our own overlay, so it never fights the app's sheet. */
  function chooser(title, items, current, onPick, onCancel) {
    var el = root(); el.classList.add("on");
    /* An option is EITHER a plain string ("MBBS") or an object ({name, sub}). Reading it.sub off a
     * string is the legacy String.prototype.sub trap: that native method is TRUTHY, so `it.sub || ""`
     * never fell back and every row rendered the subtitle "function sub() { [native code] }" under
     * its label - reported from a real device on both the degree and speciality pickers. `it.name`
     * escaped only by luck, since strings have no .name. Read properties from OBJECTS only.
     * (Same family as .big/.blink/.bold/.link/.sup - never probe them on an unknown value.) */
    function optName(it) { return (it && typeof it === "object") ? (it.name || "") : String(it == null ? "" : it); }
    function optSub(it) { return (it && typeof it === "object") ? (it.sub || "") : ""; }
    function rows(q) {
      q = String(q || "").toLowerCase().trim();
      var hits = [], i;
      for (i = 0; i < items.length; i++) {
        var it = items[i], name = optName(it), sub = optSub(it);
        if (!q || (name + " " + sub).toLowerCase().indexOf(q) >= 0) hits.push(it);
        if (hits.length >= 80) break;
      }
      if (!hits.length) {
        return '<div style="padding:14px 4px;color:var(--hmut,#64748b);font:500 12.5px var(--hfont,system-ui)">No match.' +
          (q ? '<div style="margin-top:10px"><button class="pfs-btn pfs-save" data-custom="1">Use &ldquo;' + esc(q) + '&rdquo;</button></div>' : "") + "</div>";
      }
      return hits.map(function (it) {
        var name = optName(it), sub = optSub(it);
        return '<button type="button" class="pfs-opt" data-v="' + esc(name) + '"><b>' + esc(name) + "</b>" +
          (sub ? "<span>" + esc(sub) + "</span>" : "") + "</button>";
      }).join("");
    }
    el.innerHTML = '<div class="pfs-card">' +
      '<div class="pfs-t">' + esc(title) + "</div>" +
      '<input class="pfs-in" id="pfsQ" type="search" autocomplete="off" placeholder="Search" value="">' +
      '<div class="pfs-list" id="pfsL">' + rows("") + "</div>" +
      '<div class="pfs-acts"><button type="button" class="pfs-btn pfs-later" id="pfsBack">Back</button></div></div>';
    var q = el.querySelector("#pfsQ"), list = el.querySelector("#pfsL");
    if (q) q.addEventListener("input", function () { list.innerHTML = rows(q.value); });
    el.querySelector("#pfsBack").addEventListener("click", function () { onCancel(); });
    list.addEventListener("click", function (e) {
      var c = e.target.closest && e.target.closest("[data-custom]");
      if (c) { onPick(String((q && q.value) || "").trim()); return; }
      var b = e.target.closest && e.target.closest(".pfs-opt");
      if (b) onPick(b.getAttribute("data-v"));
    });
  }

  function hospitalItems() {
    try {
      var api = window.SMD_HOSPITALS;
      var all = (api && api.all) ? api.all() : [];
      return all.map(function (h) {
        return { name: h.name, sub: (h.city || "") + (h.state ? ", " + h.state : "") + (h.type === "medical_college" ? " · Medical college" : "") };
      });
    } catch (e) { return []; }
  }

  var draft = {};

  function form(force) {
    var el = root(); el.classList.add("on");
    var need = missing(draft);
    el.innerHTML = '<div class="pfs-card">' +
      '<div class="pfs-t">Complete your profile</div>' +
      '<p class="pfs-s">StewardMD uses these to personalise your workspace and to show colleagues who you are. They are stored on your account, never shared publicly.</p>' +
      FIELDS.map(function (f) {
        var v = draft[f.key] || "";
        var ctl = (f.kind === "tel")
          ? '<input class="pfs-in" data-k="' + f.key + '" type="tel" inputmode="numeric" autocomplete="tel" placeholder="' + esc(f.ph) + '" value="' + esc(v) + '">'
          : '<button type="button" class="pfs-pick' + (v ? "" : " unset") + '" data-pick="' + f.key + '">' + esc(v || f.ph) + "</button>";
        return '<div class="pfs-f" data-f="' + f.key + '"><label class="pfs-l">' + esc(f.label) + "</label>" + ctl +
          '<div class="pfs-err">' + (f.key === "phone" ? "Enter a valid phone number." : "Please choose one.") + "</div></div>";
      }).join("") +
      '<div class="pfs-acts">' +
        '<button type="button" class="pfs-btn pfs-later" id="pfsLater">Later</button>' +
        '<button type="button" class="pfs-btn pfs-save" id="pfsSave">Save</button>' +
      "</div></div>";

    el.querySelectorAll("[data-k]").forEach(function (i) {
      i.addEventListener("input", function () { draft[i.getAttribute("data-k")] = i.value; });
    });
    el.querySelectorAll("[data-pick]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-pick");
        var f = FIELDS.filter(function (x) { return x.key === k; })[0];
        var p = (f.kind === "hospital") ? smdLazy('/hospitals-in.js?v=1') : Promise.resolve();
        p.then(function() {
          var items = (f.kind === "hospital") ? hospitalItems() : f.opts;
          var title = (f.kind === "hospital") ? "Choose your college or hospital" : ("Choose your " + f.label.toLowerCase());
          chooser(title, items, draft[k], function (v) { if (v) draft[k] = v; form(force); }, function () { form(force); });
        });
      });
    });
    el.querySelector("#pfsLater").addEventListener("click", function () {
      try { sessionStorage.setItem(SNOOZE_KEY, "1"); } catch (e) {}
      close();
    });
    el.querySelector("#pfsSave").addEventListener("click", function () {
      // Read the live inputs first: a typed phone may not have fired input on some keyboards.
      el.querySelectorAll("[data-k]").forEach(function (i) { draft[i.getAttribute("data-k")] = String(i.value || "").trim(); });
      var bad = missing(draft);
      if (String(draft.phone || "").replace(/\D/g, "").length < 7 && bad.indexOf("phone") < 0) bad.push("phone");
      el.querySelectorAll(".pfs-f").forEach(function (f) { f.classList.toggle("bad", bad.indexOf(f.getAttribute("data-f")) >= 0); });
      if (bad.length) return;
      var ref = docRef();
      if (!ref) { toast("You are offline. Try again once you are connected."); return; }
      var btn = el.querySelector("#pfsSave"); btn.disabled = true; btn.textContent = "Saving…";
      ref.set({ phone: draft.phone, hospital: draft.hospital, degree: draft.degree, speciality: draft.speciality }, { merge: true })
        .then(function () { close(); toast("Profile saved"); })
        .catch(function () { btn.disabled = false; btn.textContent = "Save"; toast("Couldn't save. Check your connection."); });
    });
    return el;
  }

  /* Open the form, pre-filled with whatever is already stored. */
  function open() {
    var ref = docRef();
    if (!ref) { draft = {}; form(true); return; }
    ref.get().then(function (snap) {
      draft = (snap && snap.exists && snap.data()) || {};
      form(true);
    }).catch(function () { draft = {}; form(true); });
  }

  /* Should we ask? Signed in, not snoozed this app-open, and something is genuinely missing. */
  function needed(cb) {
    var ref = docRef();
    if (!ref) { cb(false); return; }
    try { if (sessionStorage.getItem(SNOOZE_KEY)) { cb(false); return; } } catch (e) {}
    ref.get().then(function (snap) {
      var d = (snap && snap.exists && snap.data()) || {};
      cb(missing(d).length > 0, d);
    }).catch(function () { cb(false); });
  }

  /* ── auto-prompt on app start ─────────────────────────────────────────────────────────────────
   * Waits for auth to resolve rather than guessing a timeout, then asks once. The delay lets the
   * home screen paint first, so the form appears over a real app rather than a boot splash. */
  var _asked = false;
  function maybeAsk() {
    if (_asked) return;
    var ref = docRef(); if (!ref) return;      // not signed in yet; the auth listener will call back
    _asked = true;
    needed(function (yes, d) {
      if (!yes) return;
      draft = d || {};
      setTimeout(function () { form(true); }, 400);
    });
  }
  function start() {
    try {
      if (window.SMD_AUTH && SMD_AUTH.onAuthStateChanged) {
        SMD_AUTH.onAuthStateChanged(function (u) { if (u) setTimeout(maybeAsk, 1200); });
        return;
      }
    } catch (e) {}
    // Firebase not booted yet — poll briefly, then give up quietly (a guest never sees this).
    var n = 0;
    var t = setInterval(function () {
      n++;
      try { if (window.SMD_AUTH && SMD_AUTH.onAuthStateChanged) { clearInterval(t); start(); return; } } catch (e) {}
      if (n > 40) clearInterval(t);
    }, 500);
  }
  if (document.readyState !== "loading") setTimeout(start, 800);
  else document.addEventListener("DOMContentLoaded", function () { setTimeout(start, 800); });

  window.SMD_PROFILE_SETUP = {
    open: open, needed: needed, missing: missing, close: close,
    DEGREES: DEGREES, SPECIALITIES: SPECIALITIES, FIELDS: FIELDS
  };
})();
