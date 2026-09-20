/* wardsynq/site/pages/abdm.js - Admin Center > Integrations > ABDM (owner S6, phase A1). Buildless ES5.
 *
 * The hospital's own ABDM profile: its HFR facility ID (the one on the hospital record), the HIP and HIU
 * IDs ABDM issued it on Software Linkage, which bridge it uses, its status, and the per-hospital
 * certification checklist. GET /ward/abdm-profile draws it; the save is the connector save
 * (POST /ward/connector-save, kind "abdm"); a doctor's HPR ID is the existing POST /member.
 *
 * Nothing here calls ABDM, and nothing is shown as verified: the server's checklist says "entered" for
 * what the hospital typed and "not built" for what this build cannot check. null = loading,
 * {failed} = not loaded, which is never the same as "not set up".
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  var STATUS_CLASS = { entered: "note", missing: "err", mismatch: "err", "not-built": "note", blocked: "note", verified: "ok", "not-found": "err", unverified: "err", "not-checked": "note", available: "note" };
  function statusWord(c, status) {
    if (status === "entered") return T(c, "site.abdm.status.entered", "Entered, not verified");
    if (status === "missing") return T(c, "site.abdm.status.missing", "Missing");
    if (status === "mismatch") return T(c, "site.abdm.status.mismatch", "Does not match");
    if (status === "not-built") return T(c, "site.abdm.status.notBuilt", "Not built yet");
    if (status === "blocked") return T(c, "site.abdm.status.blocked", "Blocked");
    /* What ABDM's registries answered (abdm-registry.js). */
    if (status === "verified") return T(c, "site.abdm.status.verified", "Verified with ABDM");
    if (status === "not-found") return T(c, "site.abdm.status.notFound", "Not in the ABDM registry");
    if (status === "unverified") return T(c, "site.abdm.status.unverified", "Could not be verified");
    if (status === "not-checked") return T(c, "site.abdm.status.notChecked", "Not checked yet");
    if (status === "available") return T(c, "site.abdm.status.available", "Available");
    return status;
  }

  function refusal(c, r) {
    if (!r) return T(c, "site.abdm.noResponse", "No response from the server.");
    if (r.errors) return Object.keys(r.errors).map(function (k) { return r.errors[k]; }).join(" ");
    return r.message || r.error || T(c, "site.abdm.refusalFailed", "failed");
  }
  function idOnly(v) { return String(v || "").replace(/[\s-]+/g, "").toUpperCase(); }

  function abdmHtml(c, r) {
    var esc = c.esc;
    var head = '<div class="card"><h2>' + esc(T(c, "site.abdm.title", "ABDM (Ayushman Bharat Digital Mission)")) + '</h2>';
    if (r == null) return head + '<span class="spin"></span> ' + esc(T(c, "site.abdm.loading", "Loading the ABDM profile...")) + '</div>';
    if (r.failed) return head + '<div class="msg err">' + TS(c, "site.abdm.loadFailedLead", "The ABDM profile could not be loaded:") + " " + (r.message ? EN(c, esc(r.message)) : esc(T(c, "site.abdm.refusalFailed", "failed"))) + TS(c, "site.abdm.loadFailedTrail", ". This is not the same as it not being set up.") + "</div></div>";
    var p = r.profile, s = (p && p.settings) || {};
    var h = head + '<p class="quiet">' + esc(T(c, "site.abdm.intro1", "This hospital registers itself in the Health Facility Registry and presses Software Linkage for the StewardMD bridge; ABDM then shows its HIP ID. Nothing on this card contacts ABDM yet.")) + '</p>' +
      '<p class="quiet">' + esc(T(c, "site.abdm.intro2", "Records this hospital later receives from ABDM stay in the chart, marked as received under that consent, even if the patient withdraws the consent afterwards.")) + '</p>';
    if (r.region && r.region !== "IN") h += '<div class="msg note">' + esc(T(c, "site.abdm.regionNote", "ABDM applies to a hospital in India. This hospital's country is not India.")) + '</div>';
    h += '<div class="kv"><dt>' + esc(T(c, "site.abdm.hfrLabel", "HFR ID on the hospital record")) + '</dt><dd class="mono">' + (r.hfrOnOrg ? esc(r.hfrOnOrg) : '<span class="quiet">' + esc(T(c, "site.abdm.hfrNone", "none; enter it on the Hospital tab")) + '</span>') + "</dd>" +
      "<dt>" + esc(T(c, "site.abdm.profileLabel", "Profile")) + "</dt><dd>" + (p ? "<b>" + EN(c, esc((r.statusOptions.filter(function (o) { return o.status === s.status; })[0] || {}).label || s.status)) + "</b> " + esc(T(c, "site.abdm.profileVersion", "(version {version}, saved ", { version: p.version })) + EN(c, esc(p.updatedAt || "")) + ")" : '<span class="quiet">' + esc(T(c, "site.abdm.profileNotSetUp", "Not set up for this hospital.")) + '</span>') + "</dd></div>";

    h += '<h3>' + esc(p ? T(c, "site.abdm.changeProfile", "Change the profile") : T(c, "site.abdm.setUp", "Set up")) + '</h3><div class="row">' +
      '<label class="f"><span>' + esc(T(c, "site.abdm.hfrFieldLabel", "HFR facility ID *")) + '</span><input id="abdmHfr" class="mono" maxlength="20" value="' + esc(s.hfrFacilityId || r.hfrOnOrg || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.abdm.hipFieldLabel", "HIP ID (shown by ABDM after Software Linkage)")) + '</span><input id="abdmHip" class="mono" maxlength="50" value="' + esc(s.hipId || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.abdm.hiuFieldLabel", "HIU ID (if this hospital requests records)")) + '</span><input id="abdmHiu" class="mono" maxlength="50" value="' + esc(s.hiuId || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.abdm.statusFieldLabel", "Status")) + '</span><select id="abdmStatus">' + r.statusOptions.map(function (o) {
        return '<option value="' + esc(o.status) + '"' + (o.status === (s.status || "draft") ? " selected" : "") + (o.allowed ? "" : " disabled") + ">" + EN(c, esc(o.label)) + (o.allowed ? "" : " " + esc(T(c, "site.abdm.notAvailable", "(not available)"))) + "</option>";
      }).join("") + "</select></label></div>";
    var blocked = r.statusOptions.filter(function (o) { return !o.allowed && o.reason; });
    if (blocked.length) h += blocked.map(function (o) { return '<p class="quiet">' + EN(c, esc(o.label)) + ": " + EN(c, esc(o.reason)) + "</p>"; }).join("");

    /* Owner A1: one shared StewardMD bridge; each hospital links its own facility to it. No bridge credential here. */
    h += '<p class="quiet">' + esc(T(c, "site.abdm.bridgeNote", "Bridge: shared StewardMD bridge. This hospital holds no ABDM bridge credentials.")) + '</p>' +
      '<button type="button" class="btn" id="abdmSave">' + esc(T(c, "site.abdm.saveButton", "Save profile")) + '</button><div id="abdmMsg"></div>';

    h += '<h3>' + esc(T(c, "site.abdm.checklistTitle", "Certification checklist for this hospital")) + '</h3><div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.abdm.colStep", "Step")) + '</th><th>' + esc(T(c, "site.abdm.colStatus", "Status")) + '</th><th>' + esc(T(c, "site.abdm.colWhatKnown", "What is known")) + '</th></tr></thead><tbody>' +
      r.checklist.map(function (it) {
        return "<tr><td>" + EN(c, esc(it.label)) + '</td><td><span class="msg ' + (STATUS_CLASS[it.status] || "note") + '">' + esc(statusWord(c, it.status)) + "</span></td><td>" + EN(c, esc(it.detail)) +
          (it.key === "hfr" && it.status !== "missing" && it.status !== "mismatch" ? ' <button type="button" class="btn ghost" data-abdm-check="facility">' + esc(T(c, "site.abdm.checkFacility", "Check with the Health Facility Registry")) + "</button>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";

    /* Owner decision 2026-09-14, read-only: what an invoice received from another facility becomes here. */
    var ih = r.invoiceHandling;
    if (ih) h += "<h3>" + esc(T(c, "site.abdm.invoiceTitle", "Invoices received from other facilities")) + "</h3>" +
      '<div class="kv"><dt>' + esc(T(c, "site.abdm.policyLabel", "Policy")) + '</dt><dd class="mono">' + EN(c, esc(ih.policy)) + "</dd><dt>" + esc(T(c, "site.abdm.valueLabel", "Value")) + "</dt><dd><b>" + EN(c, esc(ih.value)) + "</b>" +
      (ih.source === "default" ? ' <span class="quiet">' + esc(T(c, "site.abdm.defaultNote", "(default)")) + '</span>' : ih.source === "unrecognised" ? ' <span class="msg err">' + String(T(c, "site.abdm.unrecognisedLead", "the saved value \"")).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; }) + EN(c, esc(ih.configured)) + T(c, "site.abdm.unrecognisedTrail", "\" is not one this build has, so the default is applied") + '</span>' : "") + "</dd></div>" +
      '<p class="quiet">' + EN(c, esc(ih.reason)) + " " + esc(T(c, "site.abdm.invoiceCannotChange", "This cannot be changed on this screen.")) + "</p>";

    h += "<h3>" + esc(T(c, "site.abdm.doctorsTitle", "Doctors")) + "</h3>";
    if (!r.doctors.length) h += '<p class="quiet">' + esc(T(c, "site.abdm.noDoctors", "No active prescriber at this hospital.")) + '</p>';
    else h += '<p class="quiet">' + esc(T(c, "site.abdm.doctorsHelp", "A registration number is needed to request records (set it on Staff and roles). The HPR ID is optional.")) + '</p><div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.abdm.colStaff", "Staff")) + '</th><th>' + esc(T(c, "site.abdm.colRole", "Role")) + '</th><th>' + esc(T(c, "site.abdm.colRegNo", "Registration number")) + '</th><th>' + esc(T(c, "site.abdm.colHpr", "HPR ID")) + '</th><th></th><th>' + esc(T(c, "site.abdm.colRegistry", "Health Professional Registry")) + '</th></tr></thead><tbody>' +
      r.doctors.map(function (d) {
        return "<tr><td>" + EN(c, esc(d.email || d.identity)) + "</td><td>" + EN(c, esc(d.role)) + "</td><td>" + (d.regNoSet ? esc(T(c, "site.abdm.regSet", "Set")) : '<b>' + esc(T(c, "site.abdm.regMissing", "Missing")) + '</b>') + "</td>" +
          '<td><input class="abdmHpr mono" data-identity="' + esc(d.identity) + '" maxlength="20" inputmode="numeric" value="' + esc(d.hprId || "") + '">' + (d.hprValid === false ? ' <span class="msg err">' + esc(T(c, "site.abdm.hprInvalid", "not 14 digits")) + '</span>' : "") + "</td>" +
          '<td><button type="button" class="btn ghost" data-abdm-hpr="' + esc(d.identity) + '">' + esc(T(c, "site.abdm.saveHpr", "Save HPR ID")) + '</button></td>' +
          "<td>" + (d.hprRegistry ? '<span class="msg ' + (STATUS_CLASS[d.hprRegistry.status] || "note") + '">' + esc(statusWord(c, d.hprRegistry.status)) + "</span>" : '<span class="quiet">' + esc(statusWord(c, "not-checked")) + "</span>") +
          (d.hprValid ? ' <button type="button" class="btn ghost" data-abdm-check-hpr="' + esc(d.identity) + '">' + esc(T(c, "site.abdm.checkHpr", "Check")) + "</button>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    return h + "</div>";
  }
  WSQ._abdmHtml = abdmHtml;

  function loadAbdm(c) {
    var card = document.getElementById("abdmCard");
    if (!card) return;
    card.innerHTML = abdmHtml(c, null);
    c.api("/ward/abdm-profile?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      var ok = r && r.ok && r.statusOptions && r.checklist && r.doctors;
      card.innerHTML = abdmHtml(c, ok ? r : { failed: true, message: refusal(c, r) });
      if (ok) bindAbdm(c, card);
    }, function () { card.innerHTML = abdmHtml(c, { failed: true, message: T(c, "site.abdm.noResponse", "No response from the server.") }); });
  }
  WSQ._abdmLoad = loadAbdm;

  function bindAbdm(c, card) {
    var say = function (t, ok) { var m = document.getElementById("abdmMsg"); if (m) m.innerHTML = '<div class="msg ' + (ok ? "ok" : "err") + '">' + c.esc(t) + "</div>"; };
    var val = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
    var save = document.getElementById("abdmSave");
    if (save) save.onclick = function () {
      var hfr = idOnly(val("abdmHfr"));
      if (!hfr) { say(T(c, "site.abdm.enterHfr", "Enter the HFR facility ID.")); return; }
      save.disabled = true;
      c.api("/ward/connector-save", { orgId: c.state.orgId, kind: "abdm", provider: "shared-bridge",
        settings: { hfrFacilityId: hfr, hipId: val("abdmHip"), hiuId: val("abdmHiu"), status: val("abdmStatus") } }).then(function (x) {
        if (!x || !x.ok) { save.disabled = false; say(refusal(c, x)); return; }
        c.toast(x.unchanged ? T(c, "site.abdm.nothingChanged", "Nothing changed.") : T(c, "site.abdm.profileSaved", "ABDM profile saved."));
        loadAbdm(c);
      }, function () { save.disabled = false; say(T(c, "site.abdm.saveNoResponse", "No response from the server. The profile may not have been saved; reload to check.")); });
    };
    /* HFR and HPR checks with ABDM's registries. What came back is stored on the profile and drawn on reload. */
    function registryCheck(b, body) {
      b.disabled = true;
      c.api("/ward/abdm-registry-check", Object.assign({ orgId: c.state.orgId }, body)).then(function (x) {
        if (!x || !x.ok) { b.disabled = false; say(refusal(c, x)); return; }
        c.toast(T(c, "site.abdm.checkDone", "The registry answered: {status}.", { status: statusWord(c, x.result && x.result.status) }));
        loadAbdm(c);
      }, function () { b.disabled = false; say(T(c, "site.abdm.checkNoResponse", "No response from the server. Nothing was checked; try again.")); });
    }
    card.querySelectorAll("[data-abdm-check]").forEach(function (b) { b.onclick = function () { registryCheck(b, { target: "facility" }); }; });
    card.querySelectorAll("[data-abdm-check-hpr]").forEach(function (b) { b.onclick = function () { registryCheck(b, { target: "professional", identity: b.getAttribute("data-abdm-check-hpr") }); }; });
    card.querySelectorAll("[data-abdm-hpr]").forEach(function (b) {
      b.onclick = function () {
        var identity = b.getAttribute("data-abdm-hpr"), input = null;
        card.querySelectorAll(".abdmHpr").forEach(function (i) { if (i.getAttribute("data-identity") === identity) input = i; });
        var hpr = String((input && input.value) || "").replace(/[\s-]+/g, "");
        if (hpr && !/^\d{14}$/.test(hpr)) { say(T(c, "site.abdm.hprMustBe14", "An HPR ID is 14 digits.")); return; }
        b.disabled = true;
        c.api("/member", { orgId: c.state.orgId, identity: identity, regionProfile: { hprId: hpr } }).then(function (x) {
          if (!x || !x.ok) { b.disabled = false; say(refusal(c, x)); return; }
          c.toast(hpr ? T(c, "site.abdm.hprSaved", "HPR ID saved.") : T(c, "site.abdm.hprRemoved", "HPR ID removed."));
          loadAbdm(c);
        }, function () { b.disabled = false; say(T(c, "site.abdm.hprNoResponse", "No response from the server. The HPR ID may not have been saved; reload to check.")); });
      };
    });
  }
})();
