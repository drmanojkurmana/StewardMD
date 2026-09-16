/* wardsynq/site/pages/bloodbank.js - "Blood bank": the unit inventory by group and component, expiry and reactive
 * alerts, donors with screening and deferral, donations, the mandatory tests, component separation and discard.
 * Buildless ES5.
 *
 * One read (GET /ward/blood-bank). null is loading and a failed read says so: an inventory that did not load must
 * never read as "no units". Unit status comes from the server (functions/_wardsynq/blood-bank.js) and is never
 * decided here. Crossmatch and issue stay on the patient's transfusion screen, which now checks this inventory.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function when(iso) { return String(iso || "").slice(0, 16).replace("T", " "); }
  var HAS = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  function statusWord(c, s) {
    var w = { quarantine: T(c, "site.blood.status.quarantine", "Quarantine, not all tests done"), available: T(c, "site.blood.status.available", "Available"),
      reserved: T(c, "site.blood.status.reserved", "Reserved for a patient"), issued: T(c, "site.blood.status.issued", "Issued"), expired: T(c, "site.blood.status.expired", "Expired, discard"),
      reactive: T(c, "site.blood.status.reactive", "Reactive, discard"), discarded: T(c, "site.blood.status.discarded", "Discarded") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function componentWord(c, s) {
    var w = { "whole-blood": T(c, "site.blood.comp.wholeBlood", "Whole blood"), prbc: T(c, "site.blood.comp.prbc", "Packed red cells"), ffp: T(c, "site.blood.comp.ffp", "Fresh frozen plasma"),
      platelets: T(c, "site.blood.comp.platelets", "Platelets"), cryo: T(c, "site.blood.comp.cryo", "Cryoprecipitate") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function ttiWord(c, s) {
    var w = { hiv: T(c, "site.blood.tti.hiv", "HIV 1 and 2"), hbv: T(c, "site.blood.tti.hbv", "Hepatitis B (HBsAg)"), hcv: T(c, "site.blood.tti.hcv", "Hepatitis C"), syphilis: T(c, "site.blood.tti.syphilis", "Syphilis"), malaria: T(c, "site.blood.tti.malaria", "Malaria") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function questionWord(c, s) {
    var w = { illness: T(c, "site.blood.q.illness", "Fever, infection or feeling unwell in the last 2 weeks"), malaria: T(c, "site.blood.q.malaria", "Malaria in the last 3 months"),
      jaundice: T(c, "site.blood.q.jaundice", "Jaundice or hepatitis in the last 12 months"), tattoo: T(c, "site.blood.q.tattoo", "Tattoo, piercing or acupuncture in the last 12 months"),
      transfusion: T(c, "site.blood.q.transfusion", "Received blood in the last 12 months"), surgery: T(c, "site.blood.q.surgery", "Major surgery in the last 12 months"),
      pregnancy: T(c, "site.blood.q.pregnancy", "Pregnant, recently delivered or breastfeeding"), "high-risk": T(c, "site.blood.q.highRisk", "Any risk of HIV or hepatitis exposure"),
      "chronic-disease": T(c, "site.blood.q.chronic", "Heart disease, cancer, bleeding disorder, epilepsy or insulin for diabetes") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function failedHtml(c) { return '<div class="msg err">' + TS(c, "site.blood.failed", "The blood bank could not be loaded. Do not read this as no units: check the shelf.") + "</div>"; }
  function loading(c) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.blood.loading", "Loading...")) + "</p>"; }

  function inventoryHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failedHtml(c);
    var esc = c.esc;
    var inv = d.inventory.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.blood.component", "Component")) + "</th><th>" + esc(T(c, "site.blood.group", "Group")) + "</th><th>" + esc(T(c, "site.blood.available", "Available")) + "</th><th>" + esc(T(c, "site.blood.soonestExpiry", "Soonest expiry")) + "</th></tr>" + d.inventory.map(function (r) {
      return "<tr><td>" + componentWord(c, r.component) + "</td><td>" + EN(c, esc(r.group)) + "</td><td>" + esc(r.available) + "</td><td>" + esc(when(r.soonestExpiry)) + "</td></tr>";
    }).join("") + "</table></div>" : '<div class="msg note">' + esc(T(c, "site.blood.noneAvailable", "No unit is available: nothing tested, grouped and in date is on the shelf.")) + "</div>";
    var alerts = d.expiryAlerts.length ? "<h3>" + esc(T(c, "site.blood.alerts", "Expiring within 3 days, expired or reactive")) + "</h3><ul>" + d.expiryAlerts.map(function (u) {
      return "<li>" + EN(c, esc(u.unitNumber)) + " · " + componentWord(c, u.component) + " · " + statusWord(c, u.status) + " · " + esc(when(u.expiresAt)) + "</li>";
    }).join("") + "</ul>" : "";
    return (d.truncatedWarning ? '<div class="msg note">' + EN(c, esc(d.truncatedWarning)) + "</div>" : "") + inv + alerts;
  }

  function unitsHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failedHtml(c);
    var esc = c.esc;
    var live = d.units.filter(function (u) { return u.status !== "issued" && u.status !== "discarded"; });
    if (!live.length) return "<p>" + esc(T(c, "site.blood.noUnits", "No units on the shelf.")) + "</p>";
    return '<div class="tbl"><table><tr><th>' + esc(T(c, "site.blood.unit", "Unit")) + "</th><th>" + esc(T(c, "site.blood.component", "Component")) + "</th><th>" + esc(T(c, "site.blood.group", "Group")) + "</th><th>" + esc(T(c, "site.blood.expires", "Expires")) + "</th><th>" + esc(T(c, "site.blood.storage", "Storage")) + "</th><th>" + esc(T(c, "site.blood.statusCol", "Status")) + "</th><th></th></tr>" + live.map(function (u) {
      var id = esc(u.unitId);
      var act = u.status === "reserved"
        ? '<input id="bbWhy-' + id + '" aria-label="' + esc(T(c, "site.blood.reason", "Reason")) + '"> <button class="btn quiet" type="button" data-bb="release" data-id="' + id + '">' + esc(T(c, "site.blood.release", "Release reservation")) + "</button>"
        : '<input id="bbWhy-' + id + '" aria-label="' + esc(T(c, "site.blood.reason", "Reason")) + '"> <button class="btn quiet" type="button" data-bb="discard" data-id="' + id + '">' + esc(T(c, "site.blood.discard", "Discard")) + "</button>";
      return "<tr" + (u.status === "reactive" || u.status === "expired" ? ' class="warn"' : "") + "><td>" + EN(c, esc(u.unitNumber)) + "</td><td>" + componentWord(c, u.component) + "</td><td>" + EN(c, esc(u.abo ? u.abo + (u.rhD === "positive" ? "+" : "-") : "")) + "</td><td>" + esc(when(u.expiresAt)) + "</td><td>" + EN(c, esc(u.storage || "")) + "</td><td>" + statusWord(c, u.status) + (u.reactive ? " (" + u.reactive.map(function (t) { return ttiWord(c, t); }).join(", ") + ")" : "") + "</td><td>" + act + "</td></tr>";
    }).join("") + "</table></div>";
  }

  function donorsHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failedHtml(c);
    var esc = c.esc;
    var yn = function (q) { return '<label class="f"><span>' + questionWord(c, q) + '</span><select id="bbQ-' + esc(q) + '"><option value=""></option><option value="no">' + esc(T(c, "site.blood.no", "No")) + '</option><option value="yes">' + esc(T(c, "site.blood.yes", "Yes")) + "</option></select></label>"; };
    var list = d.donors.length ? "<ul>" + d.donors.map(function (x) {
      return "<li>" + EN(c, esc(x.donorNumber + " · " + x.name + " · " + x.dateOfBirth)) + (x.deferral ? " · <b>" + (x.deferral.permanent ? esc(T(c, "site.blood.deferredPermanent", "Deferred permanently")) : esc(T(c, "site.blood.deferredUntil", "Deferred until {d}", { d: when(x.deferral.until) }))) + "</b>: " + EN(c, esc(x.deferral.reason)) : "") + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.blood.noDonors", "No donors registered yet.")) + "</p>";
    return list +
      "<h3>" + esc(T(c, "site.blood.registerDonor", "Register a donor")) + '</h3><div class="row"><label class="f"><span>' + esc(T(c, "site.blood.name", "Name")) + '</span><input id="bbDnName"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.sex", "Sex")) + '</span><select id="bbDnSex"><option value="male">' + esc(T(c, "site.blood.male", "Male")) + '</option><option value="female">' + esc(T(c, "site.blood.female", "Female")) + '</option><option value="other">' + esc(T(c, "site.blood.other", "Other")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.dob", "Date of birth")) + '</span><input id="bbDnDob" type="date"></label><label class="f"><span>' + esc(T(c, "site.blood.phone", "Phone")) + '</span><input id="bbDnPhone"></label>' +
      '<button class="btn" type="button" data-bb="donor">' + esc(T(c, "site.blood.register", "Register")) + "</button></div>" +
      "<h3>" + esc(T(c, "site.blood.screenHeading", "Screen a donor")) + '</h3><p>' + esc(T(c, "site.blood.criteria", "Accepted only at age {a} to {b}, weight {w} kg or more ({w450} kg for a {big} bag), haemoglobin {hb} g/dL or more, and {m} days since the last donation for men, {f} for women. Any yes needs a deferral.", { a: d.criteria.minAge, b: d.criteria.maxAge, w: d.criteria.minWeightKg, w450: d.criteria.minWeightKg450, big: "450 mL", hb: d.criteria.minHb, m: d.criteria.intervalDaysMale, f: d.criteria.intervalDaysFemale })) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.donor", "Donor")) + '</span><select id="bbScDonor">' + d.donors.map(function (x) { return '<option value="' + esc(x.donorId) + '">' + EN(c, esc(x.donorNumber + " · " + x.name)) + "</option>"; }).join("") + "</select></label>" +
      d.questions.map(yn).join("") +
      '<label class="f"><span>' + esc(T(c, "site.blood.weight", "Weight (kg)")) + '</span><input id="bbScWt" type="number" step="0.1"></label><label class="f"><span>' + esc(T(c, "site.blood.hb", "Haemoglobin (g/dL)")) + '</span><input id="bbScHb" type="number" step="0.1"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.bp", "Blood pressure")) + '</span><input id="bbScBp"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.outcome", "Outcome")) + '</span><select id="bbScOut"><option value="eligible">' + esc(T(c, "site.blood.eligible", "Eligible")) + '</option><option value="deferred">' + esc(T(c, "site.blood.deferred", "Deferred")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.deferralReason", "Deferral reason")) + '</span><input id="bbScWhy"></label><label class="f"><span>' + esc(T(c, "site.blood.deferralDays", "Deferral days")) + '</span><input id="bbScDays" type="number" min="1"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.permanent", "Permanent deferral")) + '</span><select id="bbScPerm"><option value="no">' + esc(T(c, "site.blood.no", "No")) + '</option><option value="yes">' + esc(T(c, "site.blood.yes", "Yes")) + "</option></select></label>" +
      '<button class="btn" type="button" data-bb="screen">' + esc(T(c, "site.blood.saveScreening", "Save screening")) + "</button></div>";
  }

  function donationsHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failedHtml(c);
    var esc = c.esc;
    var dayAgo = Date.parse(d.now) - 86400000;
    var open = d.screenings.filter(function (s) { return s.outcome === "eligible" && !s.used && Date.parse(s.at) > dayAgo; });
    var donorName = {}; d.donors.forEach(function (x) { donorName[x.donorId] = x.donorNumber + " · " + x.name; });
    var testState = function (t) { return t.state === "untested" ? esc(T(c, "site.blood.untested", "Not tested")) : t.state === "reactive" ? "<b>" + esc(T(c, "site.blood.reactive", "Reactive")) + "</b>" : esc(T(c, "site.blood.cleared", "All non-reactive")) + (t.group ? " · " + EN(c, esc(t.group.abo + (t.group.rhD === "positive" ? "+" : "-"))) : ""); };
    var list = d.donations.length ? "<ul>" + d.donations.map(function (x) {
      return "<li>" + EN(c, esc(x.bagNumber + " · " + (donorName[x.donorId] || "") + " · " + x.volumeMl + " mL")) + " · " + esc(when(x.collectedAt)) + " · " + testState(x.tests) + " · " + esc(T(c, "site.blood.unitsCount", "{n} unit(s)", { n: x.units })) + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.blood.noDonations", "No donations recorded yet.")) + "</p>";
    var donationOpts = d.donations.map(function (x) { return '<option value="' + esc(x.donationId) + '">' + EN(c, esc(x.bagNumber)) + "</option>"; }).join("");
    var tti = d.tti.map(function (t) { return '<label class="f"><span>' + ttiWord(c, t) + '</span><select id="bbTt-' + esc(t) + '"><option value=""></option><option value="non-reactive">' + esc(T(c, "site.blood.nonReactive", "Non-reactive")) + '</option><option value="reactive">' + esc(T(c, "site.blood.reactive", "Reactive")) + "</option></select></label>"; }).join("");
    var comps = d.components.map(function (k) {
      return '<label class="f"><span>' + componentWord(c, k.component) + " (" + esc(T(c, "site.blood.defaultShelf", "default {n} days, {s}", { n: k.shelfDays, s: k.storage })) + ')</span><input id="bbCpVol-' + esc(k.component) + '" type="number" min="1" placeholder="' + esc(T(c, "site.blood.volumeMl", "Volume (mL)")) + '"><input id="bbCpExp-' + esc(k.component) + '" type="datetime-local" aria-label="' + esc(T(c, "site.blood.expires", "Expires")) + '"></label>';
    }).join("");
    return list +
      "<h3>" + esc(T(c, "site.blood.collectHeading", "Record a donation")) + "</h3>" + (open.length ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.screening", "Eligible screening (last 24 hours)")) + '</span><select id="bbDoScr">' + open.map(function (s) { return '<option value="' + esc(s.screeningId) + '">' + EN(c, esc((donorName[s.donorId] || "") + " · " + when(s.at))) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.bagNumber", "Bag number")) + '</span><input id="bbDoBag"></label><label class="f"><span>' + esc(T(c, "site.blood.volume", "Bag volume")) + '</span><select id="bbDoVol"><option value="350">350 mL</option><option value="450">450 mL</option></select></label>' +
        '<label class="f"><span>' + esc(T(c, "site.blood.bagType", "Bag type")) + '</span><input id="bbDoType"></label><button class="btn" type="button" data-bb="donate">' + esc(T(c, "site.blood.recordDonation", "Record donation")) + "</button></div>"
        : "<p>" + esc(T(c, "site.blood.noEligible", "No eligible screening from the last 24 hours is waiting for a donation.")) + "</p>") +
      "<h3>" + esc(T(c, "site.blood.testsHeading", "Mandatory tests and grouping")) + "</h3><p>" + esc(T(c, "site.blood.testsNote", "Every unit stays in quarantine until all five tests are recorded non-reactive and the group is recorded. A reactive result holds every unit from that donation for discard.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.donation", "Donation")) + '</span><select id="bbTtDon">' + donationOpts + "</select></label>" + tti +
      '<label class="f"><span>' + esc(T(c, "site.blood.abo", "ABO")) + '</span><select id="bbTtAbo"><option value=""></option><option>O</option><option>A</option><option>B</option><option>AB</option></select></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.rhd", "RhD")) + '</span><select id="bbTtRh"><option value=""></option><option value="positive">' + esc(T(c, "site.blood.positive", "Positive")) + '</option><option value="negative">' + esc(T(c, "site.blood.negative", "Negative")) + "</option></select></label>" +
      '<button class="btn" type="button" data-bb="tests">' + esc(T(c, "site.blood.saveTests", "Save results")) + "</button></div>" +
      "<h3>" + esc(T(c, "site.blood.separateHeading", "Separate components")) + "</h3><p>" + esc(T(c, "site.blood.shelfNote", "Enter the expiry printed on each label. The default shelf lives shown are a guide only and are not confirmed against the Drugs and Cosmetics Rules text: check them against your licence conditions.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.donation", "Donation")) + '</span><select id="bbCpDon">' + donationOpts + "</select></label>" + comps +
      '<button class="btn" type="button" data-bb="components">' + esc(T(c, "site.blood.saveComponents", "Save components")) + "</button></div>";
  }

  WSQ.page("bloodbank", { render: function (c) {
    var el = c.el, org = c.state.orgId, esc = c.esc;
    var q = "?orgId=" + encodeURIComponent(org);
    el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.blood.heading", "Blood bank")) + '</h1></div><div id="bbMsg"></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.inventoryCard", "Inventory")) + '</h2><div id="bbInv"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.unitsCard", "Units on the shelf")) + '</h2><div id="bbUnits"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.donationsCard", "Donations, tests and components")) + '</h2><div id="bbDon"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.donorsCard", "Donors")) + '</h2><div id="bbDonors"></div></div>';
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };
    var data = null;
    var paint = function () { set("bbInv", inventoryHtml(c, data)); set("bbUnits", unitsHtml(c, data)); set("bbDon", donationsHtml(c, data)); set("bbDonors", donorsHtml(c, data)); };
    var load = function () { data = null; paint(); c.api("/ward/blood-bank" + q).then(function (r) { data = r && r.ok ? r : { ok: false }; paint(); }, function () { data = { ok: false }; paint(); }); };
    load();
    var msg = function (r) { set("bbMsg", '<div class="msg err">' + TS(c, "site.blood.notSaved", "Not saved.") + " " + EN(c, esc((r && (r.detail || r.message || r.error)) || T(c, "site.blood.noResponse", "No response from the server."))) + (r && r.failures ? " " + EN(c, esc(r.failures.join(", "))) : "") + "</div>"); };
    var after = function (okText) { return function (r) { if (!r || !r.ok) { msg(r); return; } set("bbMsg", r.detail ? '<div class="msg note">' + EN(c, esc(r.detail)) + "</div>" : ""); c.toast(okText); load(); }; };
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-bb]"); if (!b) return;
      var act = b.getAttribute("data-bb"), id = b.getAttribute("data-id");
      if (act === "discard" || act === "release") return c.api("/ward/blood-unit-event", { orgId: org, unitId: id, kind: act, reason: val("bbWhy-" + id) }).then(after(act === "discard" ? T(c, "site.blood.discarded", "Discarded.") : T(c, "site.blood.released", "Reservation released.")));
      if (act === "donor") return c.api("/ward/blood-donor", { orgId: org, name: val("bbDnName"), sex: val("bbDnSex"), dateOfBirth: val("bbDnDob"), phone: val("bbDnPhone") }).then(after(T(c, "site.blood.donorRegistered", "Donor registered.")));
      if (act === "screen") {
        var answers = {};
        (data && data.questions || []).forEach(function (qq) { var v = val("bbQ-" + qq); answers[qq] = v === "yes" ? true : v === "no" ? false : null; });
        return c.api("/ward/donor-screening", { orgId: org, donorId: val("bbScDonor"), answers: answers, weightKg: val("bbScWt"), hbGdl: val("bbScHb"), bp: val("bbScBp"), outcome: val("bbScOut"), deferralReason: val("bbScWhy"), deferralDays: Number(val("bbScDays")), permanent: val("bbScPerm") === "yes" }).then(after(T(c, "site.blood.screened", "Screening saved.")));
      }
      if (act === "donate") return c.api("/ward/blood-donation", { orgId: org, screeningId: val("bbDoScr"), bagNumber: val("bbDoBag"), volumeMl: Number(val("bbDoVol")), bagType: val("bbDoType") }).then(after(T(c, "site.blood.donationRecorded", "Donation recorded.")));
      if (act === "tests") {
        var tti = {}; (data && data.tti || []).forEach(function (t) { tti[t] = val("bbTt-" + t); });
        return c.api("/ward/blood-test-result", { orgId: org, donationId: val("bbTtDon"), tti: tti, abo: val("bbTtAbo"), rhD: val("bbTtRh") }).then(after(T(c, "site.blood.testsSaved", "Results saved.")));
      }
      if (act === "components") {
        var list = [];
        (data && data.components || []).forEach(function (k) {
          var vol = val("bbCpVol-" + k.component), exp = val("bbCpExp-" + k.component);
          if (vol || exp) list.push({ component: k.component, volumeMl: Number(vol), expiresAt: exp ? new Date(exp).toISOString() : "" });
        });
        return c.api("/ward/blood-components", { orgId: org, donationId: val("bbCpDon"), components: list }).then(after(T(c, "site.blood.componentsSaved", "Components saved.")));
      }
    };
  } });

  WSQ._bloodbank = { inventoryHtml: inventoryHtml, unitsHtml: unitsHtml, donorsHtml: donorsHtml, donationsHtml: donationsHtml };
})();
