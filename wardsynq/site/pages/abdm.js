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

  var STATUS_WORDS = { entered: "Entered, not verified", missing: "Missing", mismatch: "Does not match", "not-built": "Not built yet", blocked: "Blocked" };
  var STATUS_CLASS = { entered: "note", missing: "err", mismatch: "err", "not-built": "note", blocked: "note" };

  function refusal(r) {
    if (!r) return "No response from the server.";
    if (r.errors) return Object.keys(r.errors).map(function (k) { return r.errors[k]; }).join(" ");
    return r.message || r.error || "failed";
  }
  function idOnly(v) { return String(v || "").replace(/[\s-]+/g, "").toUpperCase(); }

  function abdmHtml(c, r) {
    var esc = c.esc;
    var head = '<div class="card"><h2>ABDM (Ayushman Bharat Digital Mission)</h2>';
    if (r == null) return head + '<span class="spin"></span> Loading the ABDM profile...</div>';
    if (r.failed) return head + '<div class="msg err">The ABDM profile could not be loaded: ' + esc(r.message || "failed") + ". This is not the same as it not being set up.</div></div>";
    var p = r.profile, s = (p && p.settings) || {};
    var h = head + '<p class="quiet">This hospital registers itself in the Health Facility Registry and presses Software Linkage for the StewardMD bridge; ABDM then shows its HIP ID. Nothing on this card contacts ABDM yet.</p>' +
      '<p class="quiet">Records this hospital later receives from ABDM stay in the chart, marked as received under that consent, even if the patient withdraws the consent afterwards.</p>';
    if (r.region && r.region !== "IN") h += '<div class="msg note">ABDM applies to a hospital in India. This hospital\'s country is not India.</div>';
    h += '<div class="kv"><dt>HFR ID on the hospital record</dt><dd class="mono">' + (r.hfrOnOrg ? esc(r.hfrOnOrg) : '<span class="quiet">none; enter it on the Hospital tab</span>') + "</dd>" +
      "<dt>Profile</dt><dd>" + (p ? "<b>" + esc((r.statusOptions.filter(function (o) { return o.status === s.status; })[0] || {}).label || s.status) + "</b> (version " + esc(p.version) + ", saved " + esc(p.updatedAt || "") + ")" : '<span class="quiet">Not set up for this hospital.</span>') + "</dd></div>";

    h += '<h3>' + (p ? "Change the profile" : "Set up") + '</h3><div class="row">' +
      '<label class="f"><span>HFR facility ID *</span><input id="abdmHfr" class="mono" maxlength="20" value="' + esc(s.hfrFacilityId || r.hfrOnOrg || "") + '"></label>' +
      '<label class="f"><span>HIP ID (shown by ABDM after Software Linkage)</span><input id="abdmHip" class="mono" maxlength="50" value="' + esc(s.hipId || "") + '"></label>' +
      '<label class="f"><span>HIU ID (if this hospital requests records)</span><input id="abdmHiu" class="mono" maxlength="50" value="' + esc(s.hiuId || "") + '"></label>' +
      '<label class="f"><span>Status</span><select id="abdmStatus">' + r.statusOptions.map(function (o) {
        return '<option value="' + esc(o.status) + '"' + (o.status === (s.status || "draft") ? " selected" : "") + (o.allowed ? "" : " disabled") + ">" + esc(o.label) + (o.allowed ? "" : " (not available)") + "</option>";
      }).join("") + "</select></label></div>";
    var blocked = r.statusOptions.filter(function (o) { return !o.allowed && o.reason; });
    if (blocked.length) h += blocked.map(function (o) { return '<p class="quiet">' + esc(o.label) + ": " + esc(o.reason) + "</p>"; }).join("");

    /* Owner A1: one shared StewardMD bridge; each hospital links its own facility to it. No bridge credential here. */
    h += '<p class="quiet">Bridge: shared StewardMD bridge. This hospital holds no ABDM bridge credentials.</p>' +
      '<button type="button" class="btn" id="abdmSave">Save profile</button><div id="abdmMsg"></div>';

    h += '<h3>Certification checklist for this hospital</h3><div class="tbl"><table><thead><tr><th>Step</th><th>Status</th><th>What is known</th></tr></thead><tbody>' +
      r.checklist.map(function (it) {
        return "<tr><td>" + esc(it.label) + '</td><td><span class="msg ' + (STATUS_CLASS[it.status] || "note") + '">' + esc(STATUS_WORDS[it.status] || it.status) + "</span></td><td>" + esc(it.detail) + "</td></tr>";
      }).join("") + "</tbody></table></div>";

    /* Owner decision 2026-09-14, read-only: what an invoice received from another facility becomes here. */
    var ih = r.invoiceHandling;
    if (ih) h += "<h3>Invoices received from other facilities</h3>" +
      '<div class="kv"><dt>Policy</dt><dd class="mono">' + esc(ih.policy) + "</dd><dt>Value</dt><dd><b>" + esc(ih.value) + "</b>" +
      (ih.source === "default" ? ' <span class="quiet">(default)</span>' : ih.source === "unrecognised" ? ' <span class="msg err">the saved value "' + esc(ih.configured) + '" is not one this build has, so the default is applied</span>' : "") + "</dd></div>" +
      '<p class="quiet">' + esc(ih.reason) + " This cannot be changed on this screen.</p>";

    h += "<h3>Doctors</h3>";
    if (!r.doctors.length) h += '<p class="quiet">No active prescriber at this hospital.</p>';
    else h += '<p class="quiet">A registration number is needed to request records (set it on Staff and roles). The HPR ID is optional.</p><div class="tbl"><table><thead><tr><th>Staff</th><th>Role</th><th>Registration number</th><th>HPR ID</th><th></th></tr></thead><tbody>' +
      r.doctors.map(function (d) {
        return "<tr><td>" + esc(d.email || d.identity) + "</td><td>" + esc(d.role) + "</td><td>" + (d.regNoSet ? "Set" : '<b>Missing</b>') + "</td>" +
          '<td><input class="abdmHpr mono" data-identity="' + esc(d.identity) + '" maxlength="20" inputmode="numeric" value="' + esc(d.hprId || "") + '">' + (d.hprValid === false ? ' <span class="msg err">not 14 digits</span>' : "") + "</td>" +
          '<td><button type="button" class="btn ghost" data-abdm-hpr="' + esc(d.identity) + '">Save HPR ID</button></td></tr>';
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
      card.innerHTML = abdmHtml(c, ok ? r : { failed: true, message: refusal(r) });
      if (ok) bindAbdm(c, card);
    }, function () { card.innerHTML = abdmHtml(c, { failed: true, message: "No response from the server." }); });
  }
  WSQ._abdmLoad = loadAbdm;

  function bindAbdm(c, card) {
    var say = function (t, ok) { var m = document.getElementById("abdmMsg"); if (m) m.innerHTML = '<div class="msg ' + (ok ? "ok" : "err") + '">' + c.esc(t) + "</div>"; };
    var val = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
    var save = document.getElementById("abdmSave");
    if (save) save.onclick = function () {
      var hfr = idOnly(val("abdmHfr"));
      if (!hfr) { say("Enter the HFR facility ID."); return; }
      save.disabled = true;
      c.api("/ward/connector-save", { orgId: c.state.orgId, kind: "abdm", provider: "shared-bridge",
        settings: { hfrFacilityId: hfr, hipId: val("abdmHip"), hiuId: val("abdmHiu"), status: val("abdmStatus") } }).then(function (x) {
        if (!x || !x.ok) { save.disabled = false; say(refusal(x)); return; }
        c.toast(x.unchanged ? "Nothing changed." : "ABDM profile saved.");
        loadAbdm(c);
      }, function () { save.disabled = false; say("No response from the server. The profile may not have been saved; reload to check."); });
    };
    card.querySelectorAll("[data-abdm-hpr]").forEach(function (b) {
      b.onclick = function () {
        var identity = b.getAttribute("data-abdm-hpr"), input = null;
        card.querySelectorAll(".abdmHpr").forEach(function (i) { if (i.getAttribute("data-identity") === identity) input = i; });
        var hpr = String((input && input.value) || "").replace(/[\s-]+/g, "");
        if (hpr && !/^\d{14}$/.test(hpr)) { say("An HPR ID is 14 digits."); return; }
        b.disabled = true;
        c.api("/member", { orgId: c.state.orgId, identity: identity, regionProfile: { hprId: hpr } }).then(function (x) {
          if (!x || !x.ok) { b.disabled = false; say(refusal(x)); return; }
          c.toast(hpr ? "HPR ID saved." : "HPR ID removed.");
          loadAbdm(c);
        }, function () { b.disabled = false; say("No response from the server. The HPR ID may not have been saved; reload to check."); });
      };
    });
  }
})();
