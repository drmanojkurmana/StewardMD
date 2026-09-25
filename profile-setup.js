/* profile-setup.js — THE profile form. Name, phone, place of work, degree, speciality.
 * ============================================================================================
 * WHY: the Profile card already stores these under users/{uid}/profile/self, and the curated
 * institution directory already exists. What was missing is anything that ASKS. So the fields sat
 * empty, the directory looked "gone", and nothing in the app knew the clinician's degree or
 * speciality.
 *
 * ONE FORM, ONE DIRECTORY (2026-09-25). There used to be two. email-auth.js asked a new doctor for
 * their state, city and hospital at sign-up, against one list; this file then asked the SAME doctor
 * on the next app start for their "college / hospital", against a different list. Two questions,
 * two answers, two lists that disagreed. Reported from a real device: "why two times institution is
 * asked, I need one unified institution/hospital directory". email-auth.js now calls
 * SMD_PROFILE_SETUP.open() instead of rendering its own, and both read SMD_INSTITUTIONS
 * (institutions-in.js), which merges every curated list plus what doctors have typed here.
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

  /* The whole profile, asked once. `req` marks what Save insists on; state and city are helpers for
   * finding the institution, so they are offered but never block a doctor whose hospital is already
   * named. */
  var FIELDS = [
    { key: "name", label: "Full name", kind: "text", ph: "Dr Jane Doe", req: true },
    { key: "phone", label: "Phone number", kind: "tel", ph: "10-digit mobile number", req: true },
    { key: "state", label: "State / UT", kind: "state", ph: "Choose your state" },
    { key: "city", label: "City / district", kind: "city", ph: "Search your city" },
    { key: "hospital", label: "Hospital / institution", kind: "hospital", ph: "Search the directory", req: true },
    { key: "degree", label: "Degree", kind: "choice", opts: DEGREES, ph: "Choose your qualification", req: true },
    { key: "speciality", label: "Speciality", kind: "choice", opts: SPECIALITIES, ph: "Choose your speciality", req: true }
  ];

  function missing(d) {
    d = d || {};
    var out = [];
    for (var i = 0; i < FIELDS.length; i++) {
      if (!FIELDS[i].req) continue;                 // state/city help the search; they never block
      var v = d[FIELDS[i].key];
      if (v == null || String(v).trim() === "") out.push(FIELDS[i].key);
    }
    return out;
  }
  function INST() { try { return window.SMD_INSTITUTIONS || null; } catch (e) { return null; } }

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
      "#" + ROOT_ID + " .pfs-opt:active{background:rgba(15,23,42,.05)}",
      "#" + ROOT_ID + " .pfs-none{padding:14px 4px;font:500 12.5px/1.5 var(--hfont,system-ui);color:var(--hmut,#64748b)}",
      "#" + ROOT_ID + " .pfs-hint{font:500 11.5px/1.5 var(--hfont,system-ui);color:var(--hmut,#64748b);margin:8px 2px 0}",
      "#" + ROOT_ID + " .pfs-use{margin-top:10px;width:100%}",
      /* DARK MODE. Reported from a device: the degree and speciality pickers showed bright
       * separator lines and NO TEXT. The rows set their colour from --hink / --hmut, which are the
       * LIGHT theme's near-black on a card this block had already repainted #111b2e, so every label
       * was black on black while the --hbd borders stayed light. Every colour inside the sheet is
       * restated here; none of them may be left to inherit a light-theme token. */
      "body.dark #" + ROOT_ID + " .pfs-card{background:#111b2e;color:#e7edf5}",
      "body.dark #" + ROOT_ID + " .pfs-in,body.dark #" + ROOT_ID + " .pfs-pick{background:#0b1220;color:#e7edf5;border-color:#1e2b43}",
      "body.dark #" + ROOT_ID + " .pfs-in::placeholder{color:#8797ad}",
      "body.dark #" + ROOT_ID + " .pfs-pick.unset{color:#8797ad}",
      "body.dark #" + ROOT_ID + " .pfs-t{color:#f2f6fb}",
      "body.dark #" + ROOT_ID + " .pfs-s,body.dark #" + ROOT_ID + " .pfs-l{color:#9fb0c6}",
      "body.dark #" + ROOT_ID + " .pfs-opt{border-top-color:#1e2b43}",
      "body.dark #" + ROOT_ID + " .pfs-opt b{color:#e7edf5}",
      "body.dark #" + ROOT_ID + " .pfs-opt span{color:#9fb0c6}",
      "body.dark #" + ROOT_ID + " .pfs-opt:active{background:#16223a}",
      "body.dark #" + ROOT_ID + " .pfs-later{border-color:#1e2b43;color:#9fb0c6}",
      "body.dark #" + ROOT_ID + " .pfs-none{color:#9fb0c6}",
      "body.dark #" + ROOT_ID + " .pfs-hint{color:#8797ad}"
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
  function chooser(title, items, current, onPick, onCancel, sub) {
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
      var out = hits.map(function (it) {
        var name = optName(it), sub = optSub(it);
        return '<button type="button" class="pfs-opt" data-v="' + esc(name) + '"><b>' + esc(name) + "</b>" +
          (sub ? "<span>" + esc(sub) + "</span>" : "") + "</button>";
      }).join("");
      /* NOBODY IS BLOCKED BY A LIST SOMEBODY ELSE WROTE. No bundled directory holds every hospital
       * in India, so whatever was typed is always offered as an answer — under the hits when there
       * are some, on its own when there are none. What is typed here is remembered (see onPick), so
       * the next colleague at that hospital finds it. */
      if (!hits.length) {
        out = '<div class="pfs-none">' + (q ? "Nothing in the directory matches that." : "Start typing to search.") + "</div>";
      }
      if (q) {
        out += '<button type="button" class="pfs-btn pfs-save pfs-use" data-custom="1">Use &ldquo;' + esc(q) + '&rdquo;</button>' +
          '<div class="pfs-hint">Your hospital is added to the directory on this device, so you only type it once.</div>';
      }
      return out;
    }
    el.innerHTML = '<div class="pfs-card">' +
      '<div class="pfs-t">' + esc(title) + "</div>" +
      (sub ? '<p class="pfs-s">' + esc(sub) + "</p>" : "") +
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

  /* The ONE directory. Institutions in the doctor's own state (and city, when they gave one) come
   * first, because a doctor in Visakhapatnam should not scroll past Delhi to reach KGH. Everything
   * else follows, so the list is still complete. */
  function hospitalItems() {
    var I = INST();
    if (!I) {
      // institutions-in.js not loaded (it is lazy): fall back to the raw curated list.
      try {
        var api = window.SMD_HOSPITALS, raw = (api && api.all) ? api.all() : [];
        return raw.map(function (h) { return { name: h.name, sub: subFor(h) }; });
      } catch (e) { return []; }
    }
    var st = String(draft.state || ""), ct = String(draft.city || "");
    var near = [], rest = [], seen = {};
    function push(list, h) {
      var k = I._norm(h.name) + "|" + I._norm(h.city);
      if (seen[k]) return;
      seen[k] = 1;
      list.push({ name: h.name, sub: subFor(h) });
    }
    if (st || ct) I.search("", { state: st, city: ct, limit: 4000 }).forEach(function (h) { push(near, h); });
    I.all().forEach(function (h) { push(rest, h); });
    return near.concat(rest);
  }
  function subFor(h) {
    return (h.city || "") + (h.state ? ", " + h.state : "") + (h.type === "medical_college" ? " · Medical college" : "");
  }
  function cityItems() {
    var I = INST(); if (!I) return [];
    var st = String(draft.state || "");
    return (st ? I.cities(st) : I.allCities()).map(function (c) {
      return st ? { name: c, sub: st } : { name: c, sub: I.stateOf(c) || "" };
    });
  }

  var draft = {};

  /* institutions-in.js merges the curated lists; both it and hospitals-in.js are lazy, so a doctor
   * who never opens this form never downloads them.
   *
   * THIS IS THE "can't see and can't search college" BUG. The old code called the bare global
   * `smdLazy(...)`, but lazy-load.js is not among the scripts index.html loads — so the call threw
   * ReferenceError inside the click handler and the picker simply never opened. The field looked
   * focused and did nothing, on every device, for every doctor. Never reach for a global the page
   * does not definitely define: this loads the script itself when the helper is absent. */
  var _loaded = {};
  function loadScript(src) {
    if (_loaded[src]) return _loaded[src];
    _loaded[src] = new Promise(function (resolve) {
      try {
        if (typeof window.smdLazy === "function") {
          Promise.resolve(window.smdLazy(src)).then(function () { resolve(true); }, function () { resolve(false); });
          return;
        }
        var el = document.createElement("script");
        el.src = src;
        el.onload = function () { resolve(true); };
        el.onerror = function () { resolve(false); };
        (document.head || document.documentElement).appendChild(el);
      } catch (e) { resolve(false); }
    });
    return _loaded[src];
  }
  function loadDirectory() {
    if (INST()) return Promise.resolve(true);
    return loadScript("/hospitals-in.js?v=1")
      .then(function () { return loadScript("/smd-geo.js?v=gold472"); })
      .then(function () { return loadScript("/institutions-in.js?v=inst1"); })
      .then(function () { return !!INST(); });
  }

  function form(force) {
    var el = root(); el.classList.add("on");
    var need = missing(draft);
    el.innerHTML = '<div class="pfs-card">' +
      '<div class="pfs-t">Complete your profile</div>' +
      '<p class="pfs-s">StewardMD uses these to personalise your workspace and to show colleagues who you are. They are stored on your account, never shared publicly.</p>' +
      FIELDS.map(function (f) {
        var v = draft[f.key] || "";
        var ctl;
        if (f.kind === "tel") {
          ctl = '<input class="pfs-in" data-k="' + f.key + '" type="tel" inputmode="numeric" autocomplete="tel" placeholder="' + esc(f.ph) + '" value="' + esc(v) + '">';
        } else if (f.kind === "text") {
          ctl = '<input class="pfs-in" data-k="' + f.key + '" type="text" autocomplete="name" placeholder="' + esc(f.ph) + '" value="' + esc(v) + '">';
        } else {
          ctl = '<button type="button" class="pfs-pick' + (v ? "" : " unset") + '" data-pick="' + f.key + '">' + esc(v || f.ph) + "</button>";
        }
        return '<div class="pfs-f" data-f="' + f.key + '"><label class="pfs-l">' + esc(f.label) + "</label>" + ctl +
          '<div class="pfs-err">' + (f.key === "phone" ? "Enter a valid phone number."
            : f.key === "name" ? "Enter your name."
            : f.key === "hospital" ? "Choose your hospital, or type its name."
            : "Please choose one.") + "</div></div>";
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
        var needsDir = (f.kind === "hospital" || f.kind === "city" || f.kind === "state");
        var p = needsDir ? loadDirectory() : Promise.resolve();
        p.then(function () {
          var I = INST();
          var items, title, sub = "";
          if (f.kind === "hospital") {
            items = hospitalItems();
            title = "Choose your hospital or college";
            sub = (draft.city || draft.state)
              ? ("Showing " + [draft.city, draft.state].filter(Boolean).join(", ") + " first. Search anywhere in India, or type your own.")
              : "Search any hospital or medical college in India, or type your own.";
          } else if (f.kind === "city") {
            items = cityItems();
            title = "Choose your city or district";
            sub = draft.state ? ("Districts and towns of " + draft.state + ".") : "Type to search anywhere in India.";
          } else if (f.kind === "state") {
            items = (I ? I.states() : []);
            title = "Choose your state or union territory";
          } else {
            items = f.opts;
            title = "Choose your " + f.label.toLowerCase();
          }
          chooser(title, items, draft[k], function (v) {
            if (v) {
              draft[k] = v;
              /* Picking a state invalidates a city from a different one; picking a city fills the
               * state in, so the doctor never has to answer the same geography twice. */
              if (k === "state") { if (draft.city && I && I.stateOf(draft.city) !== v) draft.city = ""; }
              if (k === "city" && I && !draft.state) { var g = I.stateOf(v); if (g) draft.state = g; }
              /* A hospital the doctor typed is added to THIS DEVICE's directory, so the next
               * colleague at the same hospital finds it instead of typing it again. */
              if (k === "hospital" && I && I.remember) {
                var known = I.search(v, { limit: 3 }).some(function (h) { return I._norm(h.name) === I._norm(v); });
                if (!known) I.remember(v, draft.city, draft.state);
              }
            }
            form(force);
          }, function () { form(force); }, sub);
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
      /* The SAME doc email-auth.js used to write, with the same keys, so a profile created by
       * either path is one profile. profileComplete is what email-auth's own prompt checks. */
      ref.set({
        name: draft.name || "", phone: draft.phone || "",
        state: draft.state || "", city: draft.city || "",
        hospital: draft.hospital || "", degree: draft.degree || "", speciality: draft.speciality || "",
        profileComplete: true, updatedAt: Date.now()
      }, { merge: true })
        .then(function () {
          close(); toast("Profile saved");
          // phone-verify.js waits for this to ask for the code, so the two sheets never stack.
          try { document.dispatchEvent(new CustomEvent("smd:profile-saved", { detail: { phone: draft.phone } })); } catch (e) {}
        })
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
