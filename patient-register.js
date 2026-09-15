/* patient-register.js — window.SMD_PATIENTREG. ONE patient check-in sheet, used by BOTH the phone app
 * (queue.js) and the staff web console (opd.html), so the two can never drift apart again.
 *
 * Replaces: four sequential prompt() boxes in the app, and a three-field sheet in the console.
 *
 * DESIGN
 *  • Essentials first — name, mobile, gender, age, visit type — so the desk stays fast. ABHA, address
 *    and referral live behind a disclosure, so a complete record is possible without slowing a queue.
 *  • The client does NOT re-implement the validation rules. The server (_opd_patient.js) is the
 *    authority and returns errors keyed by field; this renders them inline under the right input.
 *    Local checks here are UX hints only (required, digit counts) so typing feels responsive.
 *  • The assigned MR number is shown LARGE on success — the desk writes it on the patient's slip.
 *  • Touch-first: 48px targets, numeric keypads (inputmode), one-tap gender and visit type.
 *
 * The caller supplies submit(): the app and the console authenticate differently, so the transport
 * stays with them and this component stays pure UI.
 */
(function (root) {
  "use strict";
  if (!root || !root.document) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  /* THE STAFF LANGUAGE, as ward.js and discharge.js (owner decision 2026-09-15). This sheet is also the phone app's
   * check-in, where there is no staff shell and no i18n.js: then wT returns the English it always did. Keys are
   * "ward.reg-*" in the ward.js block of wardsynq/site/i18n.js. What is typed is recorded as typed and never
   * translated; a message the server sent is shown as the server wrote it. */
  var G = root;
  var HAS = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function wLang() { var I = G.WSQI18n, s = G.WSQ && G.WSQ.state; return I && s && s.navLang ? I.normalize(s.navLang) : "en"; }
  function wTr(key) { var I = G.WSQI18n, L = wLang(), c = L !== "en" && I && I._catalogs[L]; return c && HAS(c, key) ? String(c[key]) : null; }
  function wFill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return HAS(vars, k) ? "" + vars[k] : m; }) : s; }
  function wT(key, en, vars) { var tr = wTr(key); return wFill(tr == null ? en : tr, vars); }
  function wTH(key, en, vars) { var tr = wTr(key); return tr == null ? wFill(en, vars) : wFill(esc(tr), vars); }
  function genders() { return [["female", wT("ward.reg-female", "Female")], ["male", wT("ward.reg-male", "Male")], ["other", wT("ward.reg-other", "Other")]]; }
  function visits() { return [["new", wT("ward.reg-visit-new", "New")], ["followup", wT("ward.reg-visit-followup", "Follow-up")]]; }

  function el() {
    var d = root.document.getElementById("smdPatReg");
    if (!d) { d = root.document.createElement("div"); d.id = "smdPatReg"; root.document.body.appendChild(d); }
    return d;
  }

  // ---- markup ---------------------------------------------------------------------------------
  function field(id, label, opts) {
    opts = opts || {};
    return '<div class="pr-f" data-f="' + id + '">' +
      '<label for="pr_' + id + '">' + esc(label) + (opts.req ? '<i aria-hidden="true">*</i>' : "") + "</label>" +
      '<input id="pr_' + id + '" type="' + (opts.type || "text") + '"' +
      (opts.mode ? ' inputmode="' + opts.mode + '"' : "") +
      (opts.max ? ' maxlength="' + opts.max + '"' : "") +
      (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : "") +
      (opts.auto ? ' autocomplete="' + opts.auto + '"' : ' autocomplete="off"') +
      ' spellcheck="false">' +
      (opts.hint ? '<small class="pr-hint">' + esc(opts.hint) + "</small>" : "") +
      '<small class="pr-err" role="alert"></small></div>';
  }
  function seg(name, items, sel) {
    return '<div class="pr-seg" role="radiogroup" aria-label="' + esc(name) + '" data-seg="' + name + '">' +
      items.map(function (i) {
        return '<button type="button" role="radio" aria-checked="' + (i[0] === sel) + '"' +
          ' class="pr-segb' + (i[0] === sel ? " on" : "") + '" data-v="' + i[0] + '">' + esc(i[1]) + "</button>";
      }).join("") + "</div>";
  }

  /* region-aware copy. functions/_region.js is the one place country rules LIVE (validation stays
   * server-side there), but this plain <script> tag is not a module and cannot import it - so this
   * is label/placeholder/maxlength text only, never a rule the server could disagree with. Region
   * joined 2026-09-11: was hardcoded to India (a 6-digit PIN, a "98765 43210" mobile), so a US
   * hospital could not even TYPE the field it needed. Unset means IN - no existing caller changes. */
  function isUS(o) { return String(o && o.region).toUpperCase() === "US"; }

  /* D7: WHICH DEPARTMENT the patient is queued in, when the hospital has departments. The department
   * decides the token sequence (and its prefix) when each department numbers separately, so the server
   * resolves and checks it; this only offers the hospital's own active departments. opts.departments:
   * undefined = not a queue registration (no picker), null = the list could not be loaded (said so, never
   * drawn as "no departments"), [] = the hospital has none. opts.departmentRequired: each department
   * numbers separately, so a choice is needed. */
  function deptHtml(o) {
    if (o.departments === undefined) return "";
    if (o.departments === null) {
      return '<p class="pr-warn" data-f="departmentId">' + wTH("ward.reg-departments-not-loaded", "The hospital's departments could not be loaded.") + " " +
        (o.departmentRequired ? wTH("ward.reg-departments-token-blocked", "A token cannot be given without one: close this and try again.") : wTH("ward.reg-departments-queued-without", "The patient is queued without a department.")) + "</p>";
    }
    var act = o.departments.filter(function (d) { return d && d.id && d.active !== false; });
    if (!act.length) return o.departmentRequired ? '<p class="pr-warn" data-f="departmentId">' + wTH("ward.reg-no-active-department", "This hospital numbers tokens per department but has no active department. An administrator adds one under Admin Center, Departments.") + "</p>" : "";
    return '<div class="pr-f" data-f="departmentId"><label for="pr_departmentId">' + wTH("ward.reg-department", "Department") + (o.departmentRequired ? '<i aria-hidden="true">*</i>' : "") + "</label>" +
      '<select id="pr_departmentId"><option value="">' + (o.departmentRequired ? wTH("ward.reg-choose-a-department", "Choose a department") : wTH("ward.reg-no-department", "No department")) + "</option>" +
      act.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === o.departmentId ? " selected" : "") + ">" + (d.name || d.code ? esc(d.name || d.code) : wTH("ward.reg-department", "Department")) + "</option>"; }).join("") +
      "</select>" + (o.departmentRequired ? '<small class="pr-hint">' + wTH("ward.reg-each-department-calls-its-own", "Each department calls its own token numbers.") + "</small>" : "") +
      '<small class="pr-err" role="alert"></small></div>';
  }

  function sheetHtml(o) {
    var us = isUS(o);
    var mrLine = o.mode === "native"
      ? wT("ward.reg-mr-assigned-automatically", "A StewardMD MR number is assigned automatically.")
      : wT("ward.reg-mr-issued-by-emr", "The hospital EMR issues the MR number. Leave it blank if it has not been issued yet.");
    return '<div class="pr-wrap" role="dialog" aria-modal="true" aria-labelledby="prTitle">' +
      '<div class="pr-card">' +
        '<header class="pr-head">' +
          '<div><h2 id="prTitle">' + wTH("ward.reg-new-patient", "New patient") + "</h2><p>" + (o.clinicName ? esc(o.clinicName) : wTH("ward.reg-check-in", "Check-in")) + "</p></div>" +
          '<button type="button" class="pr-x" data-a="cancel" aria-label="' + wTH("ward.reg-close", "Close") + '">&times;</button>' +
        "</header>" +

        '<div class="pr-body">' +
          '<div class="pr-dup" id="prDup" hidden></div>' +

          '<h3 class="pr-sec">' + wTH("ward.reg-patient", "Patient") + "</h3>" +
          field("name", wT("ward.reg-full-name", "Full name"), { req: true, ph: wT("ward.reg-name-example", "e.g. Asha Kumar"), max: 80, auto: "name" }) +
          '<div class="pr-f" data-f="gender"><label>' + wTH("ward.reg-gender", "Gender") + '<i aria-hidden="true">*</i></label>' +
            seg("gender", genders(), "") + '<small class="pr-err" role="alert"></small></div>' +
          '<div class="pr-row">' +
            field("ageYears", wT("ward.reg-age-years", "Age (years)"), { req: true, mode: "numeric", max: 3, ph: "34" }) +
            field("ageMonths", wT("ward.reg-months", "Months"), { mode: "numeric", max: 2, ph: "0", hint: wT("ward.reg-for-infants", "For infants") }) +
          "</div>" +

          '<h3 class="pr-sec">' + wTH("ward.reg-contact", "Contact") + "</h3>" +
          field("mobile", us ? wT("ward.reg-mobile-us", "Mobile number (US)") : wT("ward.reg-mobile", "Mobile number"), { req: true, mode: "tel", max: 15, ph: us ? "(415) 555-0142" : "98765 43210", auto: "tel", hint: wT("ward.reg-queue-updates-sent-here", "Queue updates are sent here") }) +

          '<h3 class="pr-sec">' + wTH("ward.reg-visit", "Visit") + "</h3>" +
          '<div class="pr-f" data-f="visitType"><label>' + wTH("ward.reg-visit-type", "Visit type") + "</label>" + seg("visitType", visits(), "new") + "</div>" +
          deptHtml(o) +
          (o.mode === "native" ? "" : field("mrn", wT("ward.reg-hospital-mr-number", "Hospital MR number"), { ph: wT("ward.reg-leave-blank-if-not-issued", "Leave blank if not issued"), max: 40 })) +
          '<p class="pr-note">' + esc(mrLine) + "</p>" +

          '<button type="button" class="pr-more" data-a="more" aria-expanded="false">' +
            "<span>" + wTH("ward.reg-abha-address-referral", "ABHA, address &amp; referral") + "</span><span class=\"pr-chev\" aria-hidden=\"true\">&#9662;</span></button>" +
          '<div class="pr-opt" id="prOpt" hidden>' +
            '<h3 class="pr-sec">ABHA <small>' + wTH("ward.reg-ayushman-bharat-health-account", "Ayushman Bharat Health Account") + "</small></h3>" +
            field("abhaNumber", wT("ward.reg-abha-number", "ABHA number"), { mode: "numeric", max: 17, ph: "12-3456-7890-1234", hint: wT("ward.reg-14-digits", "14 digits") }) +
            field("abhaAddress", wT("ward.reg-abha-address", "ABHA address"), { ph: "name@abdm" }) +
            '<label class="pr-check" data-f="abhaConsent"><input type="checkbox" id="pr_abhaConsent">' +
              "<span>" + wTH("ward.reg-abha-consent", "The patient consents to linking these records to their ABHA.") + "</span></label>" +
            '<h3 class="pr-sec">' + wTH("ward.reg-address", "Address") + "</h3>" +
            field("address", wT("ward.reg-address", "Address"), { max: 200, ph: wT("ward.reg-address-example", "House, street, area") }) +
            '<div class="pr-row">' +
              field("district", wT("ward.reg-district", "District"), { max: 60 }) +
              // "tel" (not "numeric") for a US ZIP so the keypad offers "-" for the optional +4.
              field("pincode", us ? wT("ward.reg-zip-code", "ZIP code") : wT("ward.reg-pin-code", "PIN code"), { mode: us ? "tel" : "numeric", max: us ? 10 : 6, ph: us ? "90210 or 90210-1234" : "530045" }) +
            "</div>" +
            field("state", wT("ward.reg-state", "State"), { max: 60 }) +
            '<h3 class="pr-sec">' + wTH("ward.reg-referral", "Referral") + "</h3>" +
            field("referredBy", wT("ward.reg-referred-by", "Referred by"), { max: 80, ph: wT("ward.reg-referred-by-example", "Doctor or clinic") }) +
          "</div>" +
        "</div>" +

        '<footer class="pr-foot">' +
          '<div class="pr-ferr" id="prFerr" role="alert"></div>' +
          '<div class="pr-actions">' +
            '<button type="button" class="pr-btn ghost" data-a="cancel">' + wTH("ward.reg-cancel", "Cancel") + "</button>" +
            '<button type="button" class="pr-btn primary" data-a="save" id="prSave">' + esc(SUBMIT_LABEL) + "</button>" +
          "</div>" +
        "</footer>" +
      "</div></div>";
  }

  function doneHtml(res) {
    var pending = !!res.pending;
    return '<div class="pr-wrap" role="dialog" aria-modal="true" aria-labelledby="prTitle">' +
      '<div class="pr-card pr-done">' +
        '<div class="pr-tick" aria-hidden="true">&#10003;</div>' +
        '<h2 id="prTitle">' + wTH("ward.reg-name-added", "{name} added", { name: res.name ? esc(res.name) : wTH("ward.reg-patient", "Patient") }) + "</h2>" +
        '<p class="pr-mrlabel">' + (pending ? wTH("ward.reg-temporary-id", "Temporary ID") : wTH("ward.reg-mr-number", "MR number")) + "</p>" +
        '<p class="pr-mr">' + esc(res.mrn) + "</p>" +
        (pending
          ? '<p class="pr-warn">' + wTH("ward.reg-temporary-id-warning", "The hospital has not issued an MR number yet. This temporary ID is for the queue only - do not write it on hospital records. It is replaced automatically when the EMR issues the real number.") + "</p>"
          : '<p class="pr-note">' + wTH("ward.reg-write-on-slip", "Write this on the patient's slip.") + "</p>") +
        '<div class="pr-actions">' +
          '<button type="button" class="pr-btn ghost" data-a="another">' + wTH("ward.reg-add-another", "Add another") + "</button>" +
          '<button type="button" class="pr-btn primary" data-a="close">' + wTH("ward.reg-done", "Done") + "</button>" +
        "</div>" +
      "</div></div>";
  }

  // ---- controller -----------------------------------------------------------------------------
  // opts: { mode:"native"|"ghis"|"connect", clinicName, submit(payload)->Promise, onAdded(res) }
  /* What the submit button says. The OPD front desk queues a patient; a ward admits one to a bed.
   * Same sheet, same fields, two different acts - and until 2026-09-12 both read "Add to queue",
   * which told a doctor admitting to bed CAR-08 that they were queueing an outpatient. */
  var SUBMIT_LABEL = "Add to queue";
  function open(opts) {
    SUBMIT_LABEL = (opts && opts.submitLabel) || wT("ward.reg-add-to-queue", "Add to queue");
    opts = opts || {};
    var host = el(), state = { gender: "", visitType: "new", confirmDuplicate: false };
    host.className = "on";
    host.innerHTML = sheetHtml(opts);

    var q = function (id) { return host.querySelector("#pr_" + id); };
    function setErr(f, msg) {
      var w = host.querySelector('[data-f="' + f + '"]');
      if (!w) return;
      var e = w.querySelector(".pr-err");
      w.classList.toggle("bad", !!msg);
      if (e) e.textContent = msg || "";
    }
    function clearErrs() {
      Array.prototype.forEach.call(host.querySelectorAll(".pr-f, .pr-check"), function (w) {
        w.classList.remove("bad"); var e = w.querySelector(".pr-err"); if (e) e.textContent = "";
      });
      host.querySelector("#prFerr").textContent = "";
      var d = host.querySelector("#prDup"); d.hidden = true; d.innerHTML = "";
    }
    function val(id) { var n = q(id); return n ? n.value.trim() : ""; }

    function payload() {
      return {
        name: val("name"), mobile: val("mobile"), gender: state.gender,
        ageYears: val("ageYears"), ageMonths: val("ageMonths"),
        visitType: state.visitType, mrn: val("mrn"),
        abhaNumber: val("abhaNumber"), abhaAddress: val("abhaAddress"),
        abhaConsent: !!(q("abhaConsent") && q("abhaConsent").checked),
        address: val("address"), district: val("district"), state: val("state"), pincode: val("pincode"),
        referredBy: val("referredBy"),
        departmentId: q("departmentId") ? q("departmentId").value : "",
        confirmDuplicate: state.confirmDuplicate
      };
    }

    // Local hints only — the server is the authority. This just avoids a round trip for the obvious.
    function localCheck() {
      var ok = true;
      if (val("name").length < 2) { setErr("name", wT("ward.reg-enter-full-name", "Enter the patient's full name.")); ok = false; }
      if (!state.gender) { setErr("gender", wT("ward.reg-select-gender", "Select the patient's gender.")); ok = false; }
      /* Digit-count check DROPPED (not region-swapped): it hardcoded India's "strip a leading 91/0,
       * want 10 digits" shape, so a correct "+14155550132" (US, 11 digits, no 91/0 to strip) failed
       * here even though the server now accepts it. functions/_region.js is the one place country
       * phone rules live, and this plain script can't import it - duplicating the US rule here in a
       * second, ES5 copy is exactly the drift this file's own header warns about. Required-ness is
       * still worth catching locally; the shape is the server's answer, per the comment up top. */
      if (!val("mobile")) { setErr("mobile", wT("ward.reg-mobile-required", "Mobile number is required.")); ok = false; }
      if (!val("ageYears") && !val("ageMonths")) { setErr("ageYears", wT("ward.reg-enter-age", "Enter the patient's age.")); ok = false; }
      if (opts.departmentRequired && q("departmentId") && !q("departmentId").value) { setErr("departmentId", wT("ward.reg-choose-department-for-token", "Choose a department to give a token.")); ok = false; }
      return ok;
    }

    function showDuplicate(dup) {
      var d = host.querySelector("#prDup");
      d.hidden = false;
      d.innerHTML = "<b>" + wTH("ward.reg-mobile-already-registered", "This mobile is already registered") + "</b>" +
        "<span>" + wTH("ward.reg-duplicate-explain", "{mrn} is using this number. If this is the same person, open their record instead. If it is a different patient sharing the phone, continue.", { mrn: esc(dup.mrn) }) + "</span>" +
        '<button type="button" class="pr-btn ghost" data-a="dup-continue">' + wTH("ward.reg-different-patient", "This is a different patient") + "</button>";
      d.scrollIntoView({ block: "nearest" });
    }

    function save() {
      clearErrs();
      if (!localCheck()) return;
      var btn = host.querySelector("#prSave");
      btn.disabled = true; btn.textContent = wT("ward.reg-adding", "Adding…");
      var reset = function () { btn.disabled = false; btn.textContent = SUBMIT_LABEL; };
      var sent = payload();
      Promise.resolve(opts.submit(sent)).then(function (r) {
        if (r && r.ok) {
          host.innerHTML = doneHtml({ mrn: r.mrn, pending: r.pending, name: val("name") });
          // The answers travel with the result so the caller queues the patient in the department chosen.
          try { if (opts.onAdded) opts.onAdded(r, sent); } catch (e) {}
          return;
        }
        reset();
        if (r && r.error === "duplicate" && r.duplicateOf) { showDuplicate(r.duplicateOf); return; }
        if (r && r.errors) {
          Object.keys(r.errors).forEach(function (k) { setErr(k === "age" ? "ageYears" : k, r.errors[k]); });
          // A refusal about the queue (D14) may name a field the sheet is not showing: say it at the foot too.
          if (r.errors.departmentId && r.message) host.querySelector("#prFerr").textContent = r.message;
          var first = host.querySelector(".pr-f.bad input");
          if (first) first.focus();
          return;
        }
        /* Prefer the server's own sentence. It knows WHICH refusal this is - no role granted, not
         * on this clinic's staff list, wrong clinic, outside your departments - and each has a
         * different fix. This flattened all of them to "You do not have permission", which tells
         * the person at the desk nothing they can act on and sends them to the owner with no idea
         * what to ask for. The message carries a clinic id and a role name, never patient data. */
        host.querySelector("#prFerr").textContent =
          (r && r.message) ? r.message
            : (r && r.error === "forbidden") ? wT("ward.reg-no-permission", "You do not have permission to add patients.")
              : wT("ward.reg-could-not-add", "Could not add the patient. Check your connection and try again.");
      }).catch(function () {
        reset();
        host.querySelector("#prFerr").textContent = wT("ward.reg-could-not-reach-server", "Could not reach the server. Try again.");
      });
    }

    function close() { host.className = ""; host.innerHTML = ""; }

    host.onclick = function (ev) {
      var t = ev.target;
      var segb = t.closest && t.closest(".pr-segb");
      if (segb) {
        var g = segb.parentNode.getAttribute("data-seg");
        state[g] = segb.getAttribute("data-v");
        Array.prototype.forEach.call(segb.parentNode.querySelectorAll(".pr-segb"), function (b) {
          var on = b === segb; b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
        });
        setErr(g, "");
        return;
      }
      var b = t.closest && t.closest("[data-a]");
      if (!b) return;
      var a = b.getAttribute("data-a");
      if (a === "cancel" || a === "close") return close();
      if (a === "save") return save();
      if (a === "another") { open(opts); return; }
      if (a === "dup-continue") { state.confirmDuplicate = true; host.querySelector("#prDup").hidden = true; return save(); }
      if (a === "more") {
        var panel = host.querySelector("#prOpt"), on = panel.hidden;
        panel.hidden = !on; b.setAttribute("aria-expanded", on);
        b.classList.toggle("open", on);
        return;
      }
    };
    host.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
      if (ev.key === "Enter" && ev.target && ev.target.tagName === "INPUT") { ev.preventDefault(); save(); }
    });
    var n = q("name"); if (n) n.focus();
    return { close: close };
  }

  root.SMD_PATIENTREG = { open: open, _sheetHtml: sheetHtml, _doneHtml: doneHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SMD_PATIENTREG;
})(typeof window !== "undefined" ? window : null);
