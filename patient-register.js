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
  var GENDERS = [["female", "Female"], ["male", "Male"], ["other", "Other"]];
  var VISITS = [["new", "New"], ["followup", "Follow-up"]];

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

  function sheetHtml(o) {
    var mrLine = o.mode === "native"
      ? "A StewardMD MR number is assigned automatically."
      : "The hospital EMR issues the MR number. Leave it blank if it has not been issued yet.";
    return '<div class="pr-wrap" role="dialog" aria-modal="true" aria-labelledby="prTitle">' +
      '<div class="pr-card">' +
        '<header class="pr-head">' +
          '<div><h2 id="prTitle">New patient</h2><p>' + esc(o.clinicName || "Check-in") + "</p></div>" +
          '<button type="button" class="pr-x" data-a="cancel" aria-label="Close">&times;</button>' +
        "</header>" +

        '<div class="pr-body">' +
          '<div class="pr-dup" id="prDup" hidden></div>' +

          '<h3 class="pr-sec">Patient</h3>' +
          field("name", "Full name", { req: true, ph: "e.g. Asha Kumar", max: 80, auto: "name" }) +
          '<div class="pr-f" data-f="gender"><label>Gender<i aria-hidden="true">*</i></label>' +
            seg("gender", GENDERS, "") + '<small class="pr-err" role="alert"></small></div>' +
          '<div class="pr-row">' +
            field("ageYears", "Age (years)", { req: true, mode: "numeric", max: 3, ph: "34" }) +
            field("ageMonths", "Months", { mode: "numeric", max: 2, ph: "0", hint: "For infants" }) +
          "</div>" +

          '<h3 class="pr-sec">Contact</h3>' +
          field("mobile", "Mobile number", { req: true, mode: "tel", max: 15, ph: "98765 43210", auto: "tel", hint: "Queue updates are sent here" }) +

          '<h3 class="pr-sec">Visit</h3>' +
          '<div class="pr-f" data-f="visitType"><label>Visit type</label>' + seg("visitType", VISITS, "new") + "</div>" +
          (o.mode === "native" ? "" : field("mrn", "Hospital MR number", { ph: "Leave blank if not issued", max: 40 })) +
          '<p class="pr-note">' + esc(mrLine) + "</p>" +

          '<button type="button" class="pr-more" data-a="more" aria-expanded="false">' +
            "<span>ABHA, address &amp; referral</span><span class=\"pr-chev\" aria-hidden=\"true\">&#9662;</span></button>" +
          '<div class="pr-opt" id="prOpt" hidden>' +
            '<h3 class="pr-sec">ABHA <small>Ayushman Bharat Health Account</small></h3>' +
            field("abhaNumber", "ABHA number", { mode: "numeric", max: 17, ph: "12-3456-7890-1234", hint: "14 digits" }) +
            field("abhaAddress", "ABHA address", { ph: "name@abdm" }) +
            '<label class="pr-check" data-f="abhaConsent"><input type="checkbox" id="pr_abhaConsent">' +
              "<span>The patient consents to linking these records to their ABHA.</span></label>" +
            '<h3 class="pr-sec">Address</h3>' +
            field("address", "Address", { max: 200, ph: "House, street, area" }) +
            '<div class="pr-row">' +
              field("district", "District", { max: 60 }) +
              field("pincode", "PIN code", { mode: "numeric", max: 6, ph: "530045" }) +
            "</div>" +
            field("state", "State", { max: 60 }) +
            '<h3 class="pr-sec">Referral</h3>' +
            field("referredBy", "Referred by", { max: 80, ph: "Doctor or clinic" }) +
          "</div>" +
        "</div>" +

        '<footer class="pr-foot">' +
          '<div class="pr-ferr" id="prFerr" role="alert"></div>' +
          '<div class="pr-actions">' +
            '<button type="button" class="pr-btn ghost" data-a="cancel">Cancel</button>' +
            '<button type="button" class="pr-btn primary" data-a="save" id="prSave">Add to queue</button>' +
          "</div>" +
        "</footer>" +
      "</div></div>";
  }

  function doneHtml(res) {
    var pending = !!res.pending;
    return '<div class="pr-wrap" role="dialog" aria-modal="true" aria-labelledby="prTitle">' +
      '<div class="pr-card pr-done">' +
        '<div class="pr-tick" aria-hidden="true">&#10003;</div>' +
        '<h2 id="prTitle">' + esc(res.name || "Patient") + " added</h2>" +
        '<p class="pr-mrlabel">' + (pending ? "Temporary ID" : "MR number") + "</p>" +
        '<p class="pr-mr">' + esc(res.mrn) + "</p>" +
        (pending
          ? '<p class="pr-warn">The hospital has not issued an MR number yet. This temporary ID is for the queue only - do not write it on hospital records. It is replaced automatically when the EMR issues the real number.</p>'
          : '<p class="pr-note">Write this on the patient\'s slip.</p>') +
        '<div class="pr-actions">' +
          '<button type="button" class="pr-btn ghost" data-a="another">Add another</button>' +
          '<button type="button" class="pr-btn primary" data-a="close">Done</button>' +
        "</div>" +
      "</div></div>";
  }

  // ---- controller -----------------------------------------------------------------------------
  // opts: { mode:"native"|"ghis"|"connect", clinicName, submit(payload)->Promise, onAdded(res) }
  function open(opts) {
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
        confirmDuplicate: state.confirmDuplicate
      };
    }

    // Local hints only — the server is the authority. This just avoids a round trip for the obvious.
    function localCheck() {
      var ok = true;
      if (val("name").length < 2) { setErr("name", "Enter the patient's full name."); ok = false; }
      if (!state.gender) { setErr("gender", "Select the patient's gender."); ok = false; }
      var d = val("mobile").replace(/\D/g, "");
      if (!d) { setErr("mobile", "Mobile number is required."); ok = false; }
      else if (d.replace(/^(91|0)/, "").length !== 10) { setErr("mobile", "Enter a 10-digit mobile number."); ok = false; }
      if (!val("ageYears") && !val("ageMonths")) { setErr("ageYears", "Enter the patient's age."); ok = false; }
      return ok;
    }

    function showDuplicate(dup) {
      var d = host.querySelector("#prDup");
      d.hidden = false;
      d.innerHTML = "<b>This mobile is already registered</b>" +
        "<span>" + esc(dup.mrn) + " is using this number. If this is the same person, open their record instead. " +
        "If it is a different patient sharing the phone, continue.</span>" +
        '<button type="button" class="pr-btn ghost" data-a="dup-continue">This is a different patient</button>';
      d.scrollIntoView({ block: "nearest" });
    }

    function save() {
      clearErrs();
      if (!localCheck()) return;
      var btn = host.querySelector("#prSave");
      btn.disabled = true; btn.textContent = "Adding…";
      var reset = function () { btn.disabled = false; btn.textContent = "Add to queue"; };
      Promise.resolve(opts.submit(payload())).then(function (r) {
        if (r && r.ok) {
          host.innerHTML = doneHtml({ mrn: r.mrn, pending: r.pending, name: val("name") });
          try { if (opts.onAdded) opts.onAdded(r); } catch (e) {}
          return;
        }
        reset();
        if (r && r.error === "duplicate" && r.duplicateOf) { showDuplicate(r.duplicateOf); return; }
        if (r && r.errors) {
          Object.keys(r.errors).forEach(function (k) { setErr(k === "age" ? "ageYears" : k, r.errors[k]); });
          var first = host.querySelector(".pr-f.bad input");
          if (first) first.focus();
          return;
        }
        host.querySelector("#prFerr").textContent =
          (r && r.error === "forbidden") ? "You do not have permission to add patients."
            : "Could not add the patient. Check your connection and try again.";
      }).catch(function () {
        reset();
        host.querySelector("#prFerr").textContent = "Could not reach the server. Try again.";
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
