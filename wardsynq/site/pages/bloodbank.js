/* wardsynq/site/pages/bloodbank.js - "Blood bank": the unit inventory by group and component, expiry and reactive
 * alerts, donors with screening and deferral, donations, the mandatory tests with their methods, component separation
 * with the expiry and storage the Drugs and Cosmetics Rules set, pooling, the printed label, the pilot and recipient
 * sample register, the confidential notification of reactive donors, look-back, and discard. Buildless ES5.
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
      reactive: T(c, "site.blood.status.reactive", "Reactive, discard"), discarded: T(c, "site.blood.status.discarded", "Discarded"), pooled: T(c, "site.blood.status.pooled", "Pooled into another unit") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function componentWord(c, s) {
    var w = { "whole-blood": T(c, "site.blood.comp.wholeBlood", "Whole blood"), prbc: T(c, "site.blood.comp.prbc", "Packed red cells"), ffp: T(c, "site.blood.comp.ffp", "Fresh frozen plasma"),
      platelets: T(c, "site.blood.comp.platelets", "Platelets"), cryo: T(c, "site.blood.comp.cryo", "Cryoprecipitate"), granulocytes: T(c, "site.blood.comp.granulocytes", "Granulocytes") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function ttiWord(c, s) {
    var w = { hiv: T(c, "site.blood.tti.hiv", "HIV 1 and 2"), hbv: T(c, "site.blood.tti.hbv", "Hepatitis B (HBsAg)"), hcv: T(c, "site.blood.tti.hcv", "Hepatitis C"), syphilis: T(c, "site.blood.tti.syphilis", "Syphilis"), malaria: T(c, "site.blood.tti.malaria", "Malaria"),
      nat: T(c, "site.blood.tti.nat", "NAT (nucleic acid test)") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  /* Recorded codes, worded. A code the page does not know is shown as data. */
  function wordOf(c, map, s) { return HAS(map, s) ? c.esc(map[s]) : EN(c, c.esc(s == null ? "" : s)); }
  function methodWord(c, s) {
    return wordOf(c, { elisa: T(c, "site.blood.method.elisa", "ELISA"), clia: T(c, "site.blood.method.clia", "Chemiluminescence (CLIA)"), rapid: T(c, "site.blood.method.rapid", "Rapid card test"),
      vdrl: T(c, "site.blood.method.vdrl", "VDRL"), rpr: T(c, "site.blood.method.rpr", "RPR"), tpha: T(c, "site.blood.method.tpha", "TPHA"), smear: T(c, "site.blood.method.smear", "Blood smear"),
      "rapid-antigen": T(c, "site.blood.method.rapidAntigen", "Rapid antigen test"), "id-nat": T(c, "site.blood.method.idNat", "Individual donation NAT"), "minipool-nat": T(c, "site.blood.method.minipoolNat", "Minipool NAT"),
      "other-validated": T(c, "site.blood.method.other", "Other validated method") }, s);
  }
  function additiveWord(c, s) {
    return wordOf(c, { sagm: T(c, "site.blood.additive.sagm", "SAGM"), adsol: T(c, "site.blood.additive.adsol", "ADSOL"), nutricel: T(c, "site.blood.additive.nutricel", "NUTRICEL"),
      none: T(c, "site.blood.additive.none", "No additive solution"), cpda: T(c, "site.blood.anticoagulant.cpda", "CPDA-1"), acd: T(c, "site.blood.anticoagulant.acd", "ACD") }, s);
  }
  function resultWord(c, s) {
    return wordOf(c, { reactive: T(c, "site.blood.reactive", "Reactive"), "non-reactive": T(c, "site.blood.nonReactive", "Non-reactive"), negative: T(c, "site.blood.negative", "Negative"), positive: T(c, "site.blood.positive", "Positive") }, s);
  }
  /* Hours as the Rules say them: days from two days up. */
  function shelfWords(c, h) { return h >= 48 && h % 24 === 0 ? T(c, "site.blood.days", "{n} days", { n: h / 24 }) : T(c, "site.blood.hours", "{n} hours", { n: h }); }
  var COLOUR = { blue: "#1f5fd6", yellow: "#f3c300", pink: "#f06aa6", white: "#ffffff" };
  function colourWord(c, s) { return wordOf(c, { blue: T(c, "site.blood.colour.blue", "Blue"), yellow: T(c, "site.blood.colour.yellow", "Yellow"), pink: T(c, "site.blood.colour.pink", "Pink"), white: T(c, "site.blood.colour.white", "White") }, s); }

  /* DONOR CRITERIA (functions/_wardsynq/donor-criteria.js donorCriteriaFor): the stricter of WHO 2012 and the law of the
   * hospital's jurisdiction, with this hospital's stricter settings, and where each value comes from. The server decides
   * all of it; this only words it. Shared with Admin > Hospital, which edits the settings. */
  var CRITERIA_KEYS = ["minAge", "maxAge", "firstTimeMaxAge", "apheresisMaxAge", "minWeightKg350", "minWeightKg450", "apheresisMinWeightKg", "minHbFemale", "minHbMale",
    "intervalDaysMale", "intervalDaysFemale", "maxPerYearMale", "maxPerYearFemale", "apheresisIntervalDaysPlatelets", "apheresisIntervalDaysPlasma", "apheresisMaxPer7Days",
    "apheresisMaxPerYear", "apheresisAfterWholeBloodDays", "apheresisAfterIncompleteReinfusionDays", "wholeBloodAfterApheresisDays", "wholeBloodAfterIncompleteReinfusionDays",
    "minPlateletCount", "minTotalProteinGL", "maxTemperatureC", "systolicMin", "systolicMax", "diastolicMin", "diastolicMax", "pulseMin", "pulseMax"];
  /* The longest fixed deferral among a question's conditions: the window the question asks about. */
  function questionDays(d, q) {
    var n = null, defs = (d && d.criteria && d.criteria.deferrals) || {};
    Object.keys(defs).forEach(function (k) { if (defs[k].question === q && typeof defs[k].days === "number" && (n == null || defs[k].days > n)) n = defs[k].days; });
    return n;
  }
  function questionText(c, s, n) {
    var v = { n: n == null ? "" : n };
    var w = { illness: T(c, "site.blood.q2.illness", "Fever, infection or feeling unwell in the last {n} days", v),
      "infection-history": T(c, "site.blood.q2.infectionHistory", "Typhoid, dengue, chikungunya or tuberculosis in the last {n} days", v),
      malaria: T(c, "site.blood.q2.malaria", "Malaria in the last {n} days", v),
      jaundice: T(c, "site.blood.q2.jaundice", "Jaundice or hepatitis in the last {n} days, or hepatitis B, C or of unknown cause at any time", v),
      tattoo: T(c, "site.blood.q2.tattoo", "Tattoo, piercing, acupuncture or other skin-piercing procedure in the last {n} days", v),
      transfusion: T(c, "site.blood.q2.transfusion", "Received blood in the last {n} days", v), surgery: T(c, "site.blood.q2.surgery", "Major surgery in the last {n} days", v),
      pregnancy: T(c, "site.blood.q2.pregnancy", "Pregnant or breastfeeding, or a delivery or end of pregnancy in the last {n} days", v),
      "high-risk": T(c, "site.blood.q2.highRisk", "Any risk of HIV or hepatitis exposure (permanent for the donor's own high-risk behaviour, otherwise at least {n} days)", v),
      "chronic-disease": T(c, "site.blood.q2.chronic", "Heart disease, cancer, bleeding disorder, epilepsy, insulin for diabetes, or an organ or stem cell transplant, at any time"),
      vaccination: T(c, "site.blood.q2.vaccination", "A vaccine, anti-serum, anti-rabies treatment or immunoglobulin in the last {n} days", v),
      medication: T(c, "site.blood.q2.medication", "Antibiotics, aspirin or similar painkillers, acne or prostate medicines, or a change in blood pressure medicine, in the last {n} days", v),
      harvest: T(c, "site.blood.q2.harvest", "Bone marrow or stem cell harvest in the last {n} days", v),
      "pre-donation": T(c, "site.blood.q2.preDonation", "No meal in the last 4 hours, alcohol before donating, or a demanding duty shift within the next 24 hours"),
      "foreign-resident": T(c, "site.blood.q2.foreignResident", "A resident of another country who has lived in India for less than {n} days", v) };
    return HAS(w, s) ? w[s] : s;
  }
  function questionWord(c, s, n) { var t = questionText(c, s, n); return t === s ? EN(c, c.esc(s)) : c.esc(t); }
  function conditionText(c, k) {
    var w = { "minor-illness": T(c, "site.blood.cond.minorIllness", "Minor illness, cold, flu or fever"), typhoid: T(c, "site.blood.cond.typhoid", "Typhoid"),
      "dengue-chikungunya": T(c, "site.blood.cond.dengue", "Dengue or chikungunya"), tuberculosis: T(c, "site.blood.cond.tb", "Tuberculosis (from confirmation of cure)"),
      malaria: T(c, "site.blood.cond.malaria", "Malaria (from full recovery)"), "hepatitis-a-e": T(c, "site.blood.cond.hepAE", "Hepatitis A or E"),
      "hepatitis-b-c-unknown": T(c, "site.blood.cond.hepBC", "Hepatitis B, C or of unknown cause"), tattoo: T(c, "site.blood.cond.tattoo", "Tattoo, piercing, acupuncture or other skin-piercing procedure"),
      transfusion: T(c, "site.blood.cond.transfusion", "Blood transfusion received"), "major-surgery": T(c, "site.blood.cond.majorSurgery", "Major surgery (from recovery)"),
      delivery: T(c, "site.blood.cond.delivery", "Delivery"), abortion: T(c, "site.blood.cond.abortion", "Abortion or miscarriage"), breastfeeding: T(c, "site.blood.cond.breastfeeding", "Breastfeeding"),
      "high-risk-behaviour": T(c, "site.blood.cond.highRiskBehaviour", "The donor's own high-risk behaviour for HIV or hepatitis"),
      "high-risk-contact": T(c, "site.blood.cond.highRiskContact", "Partner or close contact with hepatitis, HIV risk or a transfusion"),
      "heart-disease": T(c, "site.blood.cond.heart", "Heart disease"), "insulin-diabetes": T(c, "site.blood.cond.insulin", "Diabetes treated with insulin"),
      malignancy: T(c, "site.blood.cond.malignancy", "Cancer"), "bleeding-disorder": T(c, "site.blood.cond.bleeding", "Bleeding disorder"), epilepsy: T(c, "site.blood.cond.epilepsy", "Epilepsy or convulsions"),
      "transplant-recipient": T(c, "site.blood.cond.transplant", "Organ or stem cell transplant received"),
      "vaccine-inactivated": T(c, "site.blood.cond.vaccineKilled", "Non-live vaccine or toxoid"), "vaccine-live": T(c, "site.blood.cond.vaccineLive", "Live vaccine or anti-serum"),
      "rabies-hbig": T(c, "site.blood.cond.rabies", "Anti-rabies treatment after a bite, or hepatitis B immunoglobulin"), antibiotics: T(c, "site.blood.cond.antibiotics", "Antibiotics (from the last dose)"),
      aspirin: T(c, "site.blood.cond.aspirin", "Aspirin or similar painkiller (from the last dose)"), isotretinoin: T(c, "site.blood.cond.isotretinoin", "Isotretinoin, etretinate or acitretin (from the last dose)"),
      finasteride: T(c, "site.blood.cond.finasteride", "Finasteride (from the last dose)"), dutasteride: T(c, "site.blood.cond.dutasteride", "Dutasteride (from the last dose)"),
      "bp-medication-change": T(c, "site.blood.cond.bpChange", "Blood pressure medicine or its dose changed"), "marrow-harvest": T(c, "site.blood.cond.marrow", "Bone marrow harvest"),
      "stem-cell-harvest": T(c, "site.blood.cond.stemCell", "Peripheral stem cell harvest"), "pre-donation": T(c, "site.blood.cond.preDonation", "Not fed, alcohol, or a duty shift soon"),
      "foreign-resident": T(c, "site.blood.cond.foreign", "Resident of another country (from arrival in India)"), other: T(c, "site.blood.cond.other", "Another reason") };
    return HAS(w, k) ? w[k] : k;
  }
  function criterionLabel(c, key) {
    if (key.indexOf("deferrals.") === 0) return conditionText(c, key.slice(10));
    var w = { minAge: T(c, "site.blood.crit.minAge", "Youngest donor (years)"), maxAge: T(c, "site.blood.crit.maxAge", "Oldest donor (years)"),
      firstTimeMaxAge: T(c, "site.blood.crit.firstTimeMaxAge", "Oldest first-time donor (years)"), apheresisMaxAge: T(c, "site.blood.crit.apheresisMaxAge", "Oldest apheresis donor (years)"),
      minWeightKg350: T(c, "site.blood.crit.minWeightKg350", "Lowest weight for a {bag} whole blood bag (kg)", { bag: "350 mL" }), minWeightKg450: T(c, "site.blood.crit.minWeightKg450", "Lowest weight for a {bag} whole blood bag (kg)", { bag: "450 mL" }),
      apheresisMinWeightKg: T(c, "site.blood.crit.apheresisMinWeightKg", "Lowest weight for apheresis (kg)"),
      minHbFemale: T(c, "site.blood.crit.minHbFemale", "Lowest haemoglobin, women (g/dL)"), minHbMale: T(c, "site.blood.crit.minHbMale", "Lowest haemoglobin, men (g/dL)"),
      intervalDaysMale: T(c, "site.blood.crit.intervalDaysMale", "Days between whole blood donations, men"), intervalDaysFemale: T(c, "site.blood.crit.intervalDaysFemale", "Days between whole blood donations, women"),
      maxPerYearMale: T(c, "site.blood.crit.maxPerYearMale", "Most whole blood donations in 365 days, men"), maxPerYearFemale: T(c, "site.blood.crit.maxPerYearFemale", "Most whole blood donations in 365 days, women"),
      apheresisIntervalDaysPlatelets: T(c, "site.blood.crit.apheresisIntervalPlatelets", "Days before a platelet apheresis after any apheresis"),
      apheresisIntervalDaysPlasma: T(c, "site.blood.crit.apheresisIntervalPlasma", "Days before a plasma apheresis after any apheresis"),
      apheresisMaxPer7Days: T(c, "site.blood.crit.apheresisMaxPer7Days", "Most apheresis donations in 7 days"), apheresisMaxPerYear: T(c, "site.blood.crit.apheresisMaxPerYear", "Most apheresis donations in 365 days"),
      apheresisAfterWholeBloodDays: T(c, "site.blood.crit.apheresisAfterWholeBlood", "Days before apheresis after a whole blood donation"),
      apheresisAfterIncompleteReinfusionDays: T(c, "site.blood.crit.apheresisAfterIncomplete", "Days before apheresis after red cells were not fully returned"),
      wholeBloodAfterApheresisDays: T(c, "site.blood.crit.wholeBloodAfterApheresis", "Days before whole blood after an apheresis"),
      wholeBloodAfterIncompleteReinfusionDays: T(c, "site.blood.crit.wholeBloodAfterIncomplete", "Days before whole blood after red cells were not fully returned"),
      minPlateletCount: T(c, "site.blood.crit.minPlateletCount", "Platelet count before platelet apheresis (x10^9/L)"), minTotalProteinGL: T(c, "site.blood.crit.minTotalProtein", "Total protein before plasma apheresis (g/L)"),
      maxTemperatureC: T(c, "site.blood.crit.maxTemperatureC", "Highest temperature (C)"),
      systolicMin: T(c, "site.blood.crit.systolicMin", "Lowest systolic blood pressure (mmHg)"), systolicMax: T(c, "site.blood.crit.systolicMax", "Highest systolic blood pressure (mmHg)"),
      diastolicMin: T(c, "site.blood.crit.diastolicMin", "Lowest diastolic blood pressure (mmHg)"), diastolicMax: T(c, "site.blood.crit.diastolicMax", "Highest diastolic blood pressure (mmHg)"),
      pulseMin: T(c, "site.blood.crit.pulseMin", "Lowest pulse (per minute)"), pulseMax: T(c, "site.blood.crit.pulseMax", "Highest pulse (per minute)") };
    return HAS(w, key) ? w[key] : key;
  }
  /* s: a criterion's or deferral's source from the server. The law named is India's, the only jurisdiction in legalMinimums. */
  function criterionSource(c, s) {
    if (!s) return "";
    var ref = s.who && s.who.ref, item = s.law && s.law.item;
    if (s.source === "hospital") return T(c, "site.blood.src.hospital", "This hospital's stricter setting");
    if (s.source === "law") return T(c, "site.blood.src.lawIN", "Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, item {item} (stricter than WHO)", { item: item });
    if (s.source === "both") return T(c, "site.blood.src.bothIN", "WHO 2012 section {ref}, and Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, item {item}", { ref: ref, item: item });
    if (s.source === "who") return T(c, "site.blood.src.who", "WHO blood donor selection guidelines (2012), section {ref}", { ref: ref });
    if (s.source === "coe") return T(c, "site.blood.src.coe", "Council of Europe blood components guide (22nd edition, 2025), standard {ref}", { ref: s.coe && s.coe.ref });
    return T(c, "site.blood.src.none", "Neither standard sets a value");
  }
  function inForceText(c, lim, stricter) {
    if (!lim) return T(c, "site.blood.notChecked", "not checked");
    if (!lim.exclusive) return String(lim.value);
    return stricter === "lower" ? T(c, "site.blood.lessThan", "less than {v}", { v: lim.value }) : T(c, "site.blood.moreThan", "more than {v}", { v: lim.value });
  }
  function daysText(c, days) {
    return days === "permanent" ? T(c, "site.blood.permanentWord", "permanent") : days == null ? T(c, "site.blood.untilResolved", "until it resolves (the blood bank sets the days)") : String(days);
  }
  var LOWER = { maxAge: 1, firstTimeMaxAge: 1, apheresisMaxAge: 1, maxPerYearMale: 1, maxPerYearFemale: 1, apheresisMaxPer7Days: 1, apheresisMaxPerYear: 1, maxTemperatureC: 1, systolicMax: 1, diastolicMax: 1, pulseMax: 1 };
  /* The criteria and the deferral table. editable: Admin's form, one input per value (data-crit), blank meaning the standard. */
  function criteriaTableHtml(c, criteria, editable, saved) {
    var esc = c.esc, cr = criteria || {}, limits = cr.limits || {}, src = cr.sources || {}, defs = cr.deferrals || {}, own = saved || {}, ownDef = own.deferrals || {};
    var head = function (first) { return '<div class="tbl"><table><tr><th>' + esc(first) + "</th><th>" + esc(T(c, "site.blood.inForce", "In force")) + "</th><th>" + esc(T(c, "site.blood.source", "Where it comes from")) + "</th>" +
      (editable ? "<th>" + esc(T(c, "site.blood.hospitalValue", "This hospital (blank for the standard)")) + "</th>" : "") + "</tr>"; };
    var input = function (k, mine, placeholder) { return '<td><input type="number" step="any" data-crit="' + esc(k) + '" value="' + (mine == null ? "" : esc(mine)) + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(criterionLabel(c, k)) + '"></td>'; };
    return head(T(c, "site.blood.critCol", "Criterion")) + CRITERIA_KEYS.filter(function (k) { return HAS(src, k); }).map(function (k) {
        var s = src[k], std = s.standard, placeholder = std ? inForceText(c, std, LOWER[k] ? "lower" : "higher") : s.suggested ? T(c, "site.blood.suggested", "WHO suggests {v}", { v: s.suggested.value }) : "";
        return "<tr><td>" + esc(criterionLabel(c, k)) + "</td><td>" + esc(inForceText(c, limits[k], LOWER[k] ? "lower" : "higher")) + "</td><td>" + esc(criterionSource(c, s)) + "</td>" + (editable ? input(k, own[k], placeholder) : "") + "</tr>";
      }).join("") + "</table></div>" +
      head(T(c, "site.blood.deferralCol", "Deferral after")) + Object.keys(defs).map(function (k) {
        var s = defs[k];
        return "<tr><td>" + esc(conditionText(c, k)) + "</td><td>" + esc(daysText(c, s.days)) + "</td><td>" + esc(criterionSource(c, s)) + "</td>" +
          (editable ? (s.standard === "permanent" ? "<td></td>" : input("deferrals." + k, ownDef[k], s.standard == null ? "" : String(s.standard))) : "") + "</tr>";
      }).join("") + "</table></div>";
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
    var live = d.units.filter(function (u) { return u.status !== "issued" && u.status !== "discarded" && u.status !== "pooled"; });
    if (!live.length) return "<p>" + esc(T(c, "site.blood.noUnits", "No units on the shelf.")) + "</p>";
    var poolable = live.filter(function (u) { return u.status === "available" && (u.component === "platelets" || u.component === "cryo"); });
    var opt = function (v, label) { return '<option value="' + esc(v) + '">' + esc(label) + "</option>"; };
    var pool = "<h3>" + esc(T(c, "site.blood.poolHeading", "Pool platelets or cryoprecipitate")) + '</h3><p class="quiet">' + esc(T(c, "site.blood.poolNote", "Units of one group only. A pool made in an open system keeps {n} hours; a closed-system pool keeps the soonest expiry of its units.", { n: (d.centre && d.centre.pooledOpenHours) || 6 })) + "</p>" +
      (poolable.length ? '<div class="row">' + poolable.map(function (u) {
        return '<label class="f"><span><input type="checkbox" data-pool="' + esc(u.unitId) + '"> ' + EN(c, esc(u.unitNumber + " · " + (u.abo || "") + (u.rhD === "positive" ? "+" : "-"))) + " · " + componentWord(c, u.component) + "</span></label>";
      }).join("") + '<label class="f"><span>' + esc(T(c, "site.blood.component", "Component")) + '</span><select id="bbPoolComp">' + opt("platelets", T(c, "site.blood.comp.platelets", "Platelets")) + opt("cryo", T(c, "site.blood.comp.cryo", "Cryoprecipitate")) + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.openSystem", "Made in an open system")) + '</span><select id="bbPoolOpen"><option value=""></option>' + opt("yes", T(c, "site.blood.yes", "Yes")) + opt("no", T(c, "site.blood.no", "No")) + "</select></label>" +
        '<button class="btn" type="button" data-bb="pool">' + esc(T(c, "site.blood.pool", "Pool")) + "</button></div>"
        : "<p>" + esc(T(c, "site.blood.noPoolable", "No available platelet or cryoprecipitate unit to pool.")) + "</p>");
    return '<div class="tbl"><table><tr><th>' + esc(T(c, "site.blood.unit", "Unit")) + "</th><th>" + esc(T(c, "site.blood.component", "Component")) + "</th><th>" + esc(T(c, "site.blood.group", "Group")) + "</th><th>" + esc(T(c, "site.blood.expires", "Expires")) + "</th><th>" + esc(T(c, "site.blood.storage", "Storage")) + "</th><th>" + esc(T(c, "site.blood.statusCol", "Status")) + "</th><th></th></tr>" + live.map(function (u) {
      var id = esc(u.unitId);
      var act = u.status === "reserved"
        ? '<input id="bbWhy-' + id + '" aria-label="' + esc(T(c, "site.blood.reason", "Reason")) + '"> <button class="btn quiet" type="button" data-bb="release" data-id="' + id + '">' + esc(T(c, "site.blood.release", "Release reservation")) + "</button>"
        : '<input id="bbWhy-' + id + '" aria-label="' + esc(T(c, "site.blood.reason", "Reason")) + '"> <button class="btn quiet" type="button" data-bb="discard" data-id="' + id + '">' + esc(T(c, "site.blood.discard", "Discard")) + "</button>";
      if (u.label) act += ' <button class="btn quiet" type="button" data-bb="label" data-id="' + id + '">' + esc(T(c, "site.blood.printLabel", "Print label")) + "</button>";
      return "<tr" + (u.status === "reactive" || u.status === "expired" ? ' class="warn"' : "") + "><td>" + EN(c, esc(u.unitNumber)) + "</td><td>" + componentWord(c, u.component) +
        (u.antibodyScreen === "positive" ? " · " + esc(T(c, "site.blood.antibodyPositive", "Irregular antibody screen positive")) : "") + "</td><td>" + EN(c, esc(u.abo ? u.abo + (u.rhD === "positive" ? "+" : "-") : "")) + "</td><td>" + esc(when(u.expiresAt)) + "</td><td>" + EN(c, esc(u.storage || "")) + "</td><td>" + statusWord(c, u.status) + (u.reactive ? " (" + u.reactive.map(function (t) { return ttiWord(c, t); }).join(", ") + ")" : "") + "</td><td>" + act + "</td></tr>";
    }).join("") + "</table></div>" + pool;
  }

  /* THE LABEL (Schedule F Part XII-B heading K(3): the results "recorded on the label"; colour coding by group). The server
   * sends it only for a unit that may be issued; this words it for printing. */
  function labelHtml(c, u) {
    var esc = c.esc, l = u && u.label;
    if (!l) return "";
    var bg = COLOUR[l.colour] || "#ffffff", red = u.component === "whole-blood" || u.component === "prbc";
    var line = function (label, value) { return "<div><b>" + esc(label) + ":</b> " + value + "</div>"; };
    return '<div class="bbLabel" style="font-family:sans-serif;border:2px solid #000;padding:12px;max-width:380px">' +
      '<div style="font-size:24px;font-weight:700">' + EN(c, esc(u.unitNumber)) + "</div>" +
      '<div style="background:' + bg + ';border:1px solid #000;padding:8px;margin:8px 0;font-size:32px;font-weight:700;color:' + (l.colour === "blue" ? "#fff" : "#000") + '">' + EN(c, esc(u.abo + " " + (u.rhD === "positive" ? "RhD+" : "RhD-"))) + " · " + colourWord(c, l.colour) + "</div>" +
      line(T(c, "site.blood.component", "Component"), componentWord(c, u.component) + (u.volumeMl ? EN(c, esc(" · " + u.volumeMl + " mL")) : "") + (u.additive ? " · " + additiveWord(c, u.additive) : u.anticoagulant ? " · " + additiveWord(c, u.anticoagulant) : "")) +
      (u.collectedAt ? line(T(c, "site.blood.collected", "Collected"), esc(when(u.collectedAt))) : "") +
      line(T(c, "site.blood.expires", "Expires"), esc(when(u.expiresAt))) +
      line(T(c, "site.blood.storage", "Storage"), EN(c, esc(u.storage || ""))) +
      (red ? "<div>" + esc(T(c, "site.blood.transportNote", "Transport to the ward at 2 to 10 C. Never freeze.")) + "</div>" : "") +
      l.tests.map(function (t) {
        return (l.tests.length > 1 ? "<div><b>" + EN(c, esc(t.donationId)) + "</b></div>" : "") + Object.keys(t.tti || {}).map(function (k) {
          return line(ttiWord(c, k), resultWord(c, t.tti[k]) + (t.methods && t.methods[k] ? " · " + methodWord(c, t.methods[k]) : ""));
        }).join("") + (t.nat ? line(ttiWord(c, "nat"), resultWord(c, t.nat) + (t.methods && t.methods.nat ? " · " + methodWord(c, t.methods.nat) : "")) : "") +
          line(T(c, "site.blood.antibodyScreen", "Irregular antibody screen"), resultWord(c, t.antibodyScreen) + (t.antibodyIdentified ? EN(c, esc(" · " + t.antibodyIdentified)) : ""));
      }).join("") + "</div>";
  }

  /* SAMPLES (heading K Note (a)): the register, when each may be discarded, and the discard log. */
  function samplesHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failedHtml(c);
    var esc = c.esc, days = (d.centre && d.centre.sampleRetentionDays) || 7;
    var bagOf = {}; d.donations.forEach(function (x) { bagOf[x.donationId] = x.bagNumber; });
    var unitOfEpisode = {}; d.units.forEach(function (u) { if (u.episodeId) unitOfEpisode[u.episodeId] = u.unitNumber; });
    var kind = function (k) { return wordOf(c, { "donor-pilot": T(c, "site.blood.sample.pilot", "Donor pilot sample"), recipient: T(c, "site.blood.sample.recipient", "Recipient sample") }, k); };
    var list = d.samples.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.blood.sample.kind", "Sample")) + "</th><th>" + esc(T(c, "site.blood.sample.for", "For")) + "</th><th>" + esc(T(c, "site.blood.sample.location", "Kept at")) + "</th><th>" + esc(T(c, "site.blood.sample.until", "Keep until")) + "</th><th></th></tr>" + d.samples.map(function (s) {
      var forWhat = s.donationId ? EN(c, esc(bagOf[s.donationId] || s.donationId)) : EN(c, esc(unitOfEpisode[s.episodeId] || s.episodeId || ""));
      var until = s.state === "discarded" ? esc(T(c, "site.blood.sample.discardedOn", "Discarded {d}", { d: when(s.discardedAt) }))
        : s.retainUntil ? esc(when(s.retainUntil)) : esc(T(c, "site.blood.sample.stillNeeded", "Keep: a unit it covers is still here or not yet issued"));
      var act = s.state === "may-discard" ? '<button class="btn quiet" type="button" data-bb="sampleDiscard" data-id="' + esc(s.sampleId) + '">' + esc(T(c, "site.blood.sample.discard", "Record discard")) + "</button>" : "";
      return "<tr><td>" + kind(s.kind) + "</td><td>" + forWhat + "</td><td>" + EN(c, esc(s.location)) + "</td><td>" + until + "</td><td>" + act + "</td></tr>";
    }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.blood.sample.none", "No samples registered yet.")) + "</p>";
    var episodes = d.units.filter(function (u) { return u.episodeId; });
    return '<p class="quiet">' + esc(T(c, "site.blood.sample.note", "Donor pilot samples and recipient samples are kept {n} days after the unit is issued (Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, heading K Note (a)). A discard is refused before then.", { n: days })) + "</p>" + list +
      "<h3>" + esc(T(c, "site.blood.sample.register", "Register a sample")) + '</h3><div class="row">' +
      '<label class="f"><span>' + esc(T(c, "site.blood.sample.kind", "Sample")) + '</span><select id="bbSmKind"><option value="donor-pilot">' + esc(T(c, "site.blood.sample.pilot", "Donor pilot sample")) + '</option><option value="recipient">' + esc(T(c, "site.blood.sample.recipient", "Recipient sample")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.donation", "Donation")) + '</span><select id="bbSmDon"><option value=""></option>' + d.donations.map(function (x) { return '<option value="' + esc(x.donationId) + '">' + EN(c, esc(x.bagNumber)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.sample.episode", "Recipient: the unit crossmatched for the patient")) + '</span><select id="bbSmEp"><option value=""></option>' + episodes.map(function (u) { return '<option value="' + esc(u.episodeId) + '">' + EN(c, esc(u.unitNumber)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.sample.location", "Kept at")) + '</span><input id="bbSmLoc"></label>' +
      '<button class="btn" type="button" data-bb="sample">' + esc(T(c, "site.blood.sample.save", "Register sample")) + "</button></div>";
  }

  /* REACTIVE DONORS (G.5.8): confidential, blood centre staff only. */
  function notificationsHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failedHtml(c);
    var esc = c.esc;
    var step = function (s) { return wordOf(c, { notified: T(c, "site.blood.notify.notified", "Donor told"), counselled: T(c, "site.blood.notify.counselled", "Donor counselled"), referred: T(c, "site.blood.notify.referred", "Donor referred") }, s); };
    var how = function (m) { return wordOf(c, { "in-person": T(c, "site.blood.notify.inPerson", "In person"), phone: T(c, "site.blood.notify.phone", "By phone"), letter: T(c, "site.blood.notify.letter", "By letter") }, m); };
    var head = '<p class="quiet">' + esc(T(c, "site.blood.notify.note", "Confidential. Only blood centre staff see this. A reactive result is never shown on a ward screen.")) + "</p>";
    if (!d.notifications.length) return head + "<p>" + esc(T(c, "site.blood.notify.none", "No reactive donation.")) + "</p>";
    return head + d.notifications.map(function (n) {
      var id = esc(n.donationId);
      return '<div class="card"><b>' + EN(c, esc(n.bagNumber)) + "</b> · " + n.reactive.map(function (t) { return ttiWord(c, t); }).join(", ") +
        (n.steps.length ? "<ul>" + n.steps.map(function (s) { return "<li>" + step(s.step) + " · " + esc(when(s.at)) + (s.method ? " · " + how(s.method) : "") + (s.referredTo ? EN(c, esc(" · " + s.referredTo)) : "") + (s.note ? EN(c, esc(" · " + s.note)) : "") + "</li>"; }).join("") + "</ul>"
          : "<p>" + esc(T(c, "site.blood.notify.pending", "The donor has not been told yet.")) + "</p>") +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.notify.step", "Step")) + '</span><select id="bbNtStep-' + id + '"><option value="notified">' + esc(T(c, "site.blood.notify.notified", "Donor told")) + '</option><option value="counselled">' + esc(T(c, "site.blood.notify.counselled", "Donor counselled")) + '</option><option value="referred">' + esc(T(c, "site.blood.notify.referred", "Donor referred")) + "</option></select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.notify.how", "How the donor was told")) + '</span><select id="bbNtHow-' + id + '"><option value=""></option><option value="in-person">' + esc(T(c, "site.blood.notify.inPerson", "In person")) + '</option><option value="phone">' + esc(T(c, "site.blood.notify.phone", "By phone")) + '</option><option value="letter">' + esc(T(c, "site.blood.notify.letter", "By letter")) + "</option></select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.notify.referredTo", "Referred to")) + '</span><input id="bbNtTo-' + id + '"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.blood.notify.noteField", "Note")) + '</span><input id="bbNtNote-' + id + '"></label>' +
        '<button class="btn" type="button" data-bb="notify" data-id="' + id + '">' + esc(T(c, "site.blood.notify.save", "Record step")) + "</button></div></div>";
    }).join("");
  }

  /* LOOK-BACK (G.5.6): a reaction traced to its donors; a reactive donor's earlier units and where they went. */
  function lookbackHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failedHtml(c);
    var esc = c.esc, lb = d.lookback || { reactions: [], recall: [] };
    var reactions = lb.reactions.length ? "<ul>" + lb.reactions.map(function (r) {
      return "<li>" + EN(c, esc(r.unitNumber)) + " · " + componentWord(c, r.component) + " · " + EN(c, esc(r.patientMrn || "")) + " · " + esc(when(r.at)) + (r.detail ? EN(c, esc(" · " + r.detail)) : "") + " · " +
        esc(T(c, "site.blood.lookback.from", "from")) + " " + EN(c, esc(r.donations.map(function (x) { return (x.bagNumber || "") + " " + (x.donorNumber || ""); }).join(", "))) + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.blood.lookback.noReactions", "No transfusion reaction on a unit from this blood centre.")) + "</p>";
    var recall = lb.recall.length ? "<ul>" + lb.recall.map(function (r) {
      return "<li><b>" + EN(c, esc((r.donorNumber || "") + " · " + r.bagNumber)) + "</b> · " + r.reactive.map(function (t) { return ttiWord(c, t); }).join(", ") +
        (r.earlier.length ? "<ul>" + r.earlier.map(function (e) {
          return "<li>" + EN(c, esc(e.bagNumber)) + " · " + esc(when(e.collectedAt)) + (e.units.length ? " · " + e.units.map(function (u) { return EN(c, esc(u.unitNumber)) + " " + statusWord(c, u.status) + (u.patientMrn ? EN(c, esc(" " + u.patientMrn)) : ""); }).join(", ") : "") + "</li>";
        }).join("") + "</ul>" : " · " + esc(T(c, "site.blood.lookback.noEarlier", "no earlier donation here"))) + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.blood.lookback.noRecall", "No reactive donation.")) + "</p>";
    return "<h3>" + esc(T(c, "site.blood.lookback.reactions", "Transfusion reactions, traced to the donors")) + "</h3>" + reactions +
      "<h3>" + esc(T(c, "site.blood.lookback.recall", "Reactive donors: earlier donations and where their units went")) + "</h3>" + recall;
  }

  function donorsHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failedHtml(c);
    var esc = c.esc;
    var defs = (d.criteria && d.criteria.deferrals) || {};
    var yn = function (q) { return '<label class="f"><span>' + questionWord(c, q, questionDays(d, q)) + '</span><select id="bbQ-' + esc(q) + '"><option value=""></option><option value="no">' + esc(T(c, "site.blood.no", "No")) + '</option><option value="yes">' + esc(T(c, "site.blood.yes", "Yes")) + "</option></select></label>"; };
    var opt = function (v, label) { return '<option value="' + esc(v) + '">' + esc(label) + "</option>"; };
    var condRow = function (n) {
      return '<label class="f"><span>' + esc(T(c, "site.blood.condition", "Condition in the deferral table")) + '</span><select id="bbScCond' + n + '"><option value=""></option>' +
        Object.keys(defs).map(function (k) { return opt(k, conditionText(c, k) + " (" + daysText(c, defs[k].days) + ")"); }).join("") + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.since", "Counted from (recovery, last dose, procedure, delivery or arrival)")) + '</span><input id="bbScSince' + n + '" type="date"></label>';
    };
    var list = d.donors.length ? "<ul>" + d.donors.map(function (x) {
      return "<li>" + EN(c, esc(x.donorNumber + " · " + x.name + " · " + x.dateOfBirth)) + (x.deferral ? " · <b>" + (x.deferral.permanent ? esc(T(c, "site.blood.deferredPermanent", "Deferred permanently")) : esc(T(c, "site.blood.deferredUntil", "Deferred until {d}", { d: when(x.deferral.until) }))) + "</b>: " + EN(c, esc(x.deferral.reason)) : "") + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.blood.noDonors", "No donors registered yet.")) + "</p>";
    return list +
      "<h3>" + esc(T(c, "site.blood.registerDonor", "Register a donor")) + '</h3><div class="row"><label class="f"><span>' + esc(T(c, "site.blood.name", "Name")) + '</span><input id="bbDnName"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.sex", "Sex")) + '</span><select id="bbDnSex"><option value="male">' + esc(T(c, "site.blood.male", "Male")) + '</option><option value="female">' + esc(T(c, "site.blood.female", "Female")) + '</option><option value="other">' + esc(T(c, "site.blood.other", "Other")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.dob", "Date of birth")) + '</span><input id="bbDnDob" type="date"></label><label class="f"><span>' + esc(T(c, "site.blood.phone", "Phone")) + '</span><input id="bbDnPhone"></label>' +
      '<button class="btn" type="button" data-bb="donor">' + esc(T(c, "site.blood.register", "Register")) + "</button></div>" +
      "<h3>" + esc(T(c, "site.blood.screenHeading", "Screen a donor")) + '</h3><p>' + esc(d.criteria && d.criteria.jurisdiction === "IN"
        ? T(c, "site.blood.standardNoteIN", "Each criterion is the stricter of the WHO blood donor selection guidelines (2012) and the Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, which bind a licensed blood centre in India. This hospital may only make them stricter, on Admin. Every yes is deferred against its condition in the deferral table.")
        : T(c, "site.blood.standardNote", "The criteria follow the WHO blood donor selection guidelines (2012), and the Council of Europe blood components guide (22nd edition, 2025) where WHO sets no value. This hospital may only make them stricter, on Admin. Every yes is deferred against its condition in the deferral table.")) + "</p>" +
      "<details><summary>" + esc(T(c, "site.blood.criteriaInForce", "Criteria in force")) + "</summary>" + criteriaTableHtml(c, d.criteria, false) + "</details>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.donor", "Donor")) + '</span><select id="bbScDonor">' + d.donors.map(function (x) { return '<option value="' + esc(x.donorId) + '">' + EN(c, esc(x.donorNumber + " · " + x.name)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.donationType", "Donation")) + '</span><select id="bbScType">' + opt("whole-blood", T(c, "site.blood.type.wholeBlood", "Whole blood")) +
        opt("apheresis-platelets", T(c, "site.blood.type.platelets", "Platelets by apheresis")) + opt("apheresis-plasma", T(c, "site.blood.type.plasma", "Plasma by apheresis")) + "</select></label>" +
      d.questions.map(yn).join("") +
      '<label class="f"><span>' + esc(T(c, "site.blood.weight", "Weight (kg)")) + '</span><input id="bbScWt" type="number" step="0.1"></label><label class="f"><span>' + esc(T(c, "site.blood.hb", "Haemoglobin (g/dL)")) + '</span><input id="bbScHb" type="number" step="0.1"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.hbMethod", "Haemoglobin method")) + '</span><select id="bbScHbM"><option value=""></option>' +
        opt("venous-analyser", T(c, "site.blood.hbm.venous", "Venous sample on a haematology analyser")) + opt("capillary-haemoglobinometer", T(c, "site.blood.hbm.capillary", "Capillary sample on a haemoglobinometer")) +
        opt("other-validated", T(c, "site.blood.hbm.other", "Other validated, quality-controlled method")) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.bp", "Blood pressure")) + '</span><input id="bbScBp" placeholder="120/80"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.pulse", "Pulse (per minute)")) + '</span><input id="bbScPulse" type="number" step="1"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.pulseRegular", "Pulse regular")) + '</span><select id="bbScPulseReg"><option value=""></option>' + opt("yes", T(c, "site.blood.yes", "Yes")) + opt("no", T(c, "site.blood.no", "No")) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.plateletCount", "Platelet count, platelet apheresis (x10^9/L)")) + '</span><input id="bbScPlt" type="number" step="1"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.totalProtein", "Total protein, plasma apheresis (g/L)")) + '</span><input id="bbScProt" type="number" step="0.1"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.temperature", "Temperature (C)")) + '</span><input id="bbScTemp" type="number" step="0.1"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.physicianName", "Physician accepting a donor past the age limit")) + '</span><input id="bbScDoc"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.physicianReason", "Physician's reason")) + '</span><input id="bbScDocWhy"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.outcome", "Outcome")) + '</span><select id="bbScOut"><option value="eligible">' + esc(T(c, "site.blood.eligible", "Eligible")) + '</option><option value="deferred">' + esc(T(c, "site.blood.deferred", "Deferred")) + "</option></select></label>" +
      '<p class="quiet">' + esc(T(c, "site.blood.deferralHint", "For a deferral, pick each condition and the date it counts from: the period comes from the table. Enter days only where the table sets no fixed period, or to defer for longer.")) + "</p>" +
      condRow(1) + condRow(2) +
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
    var ce = d.centre || {};
    var testState = function (t) {
      return t.state === "untested" ? esc(T(c, "site.blood.untested", "Not tested")) : t.state === "incomplete" ? esc(T(c, "site.blood.incomplete", "Tests incomplete, held in quarantine")) : t.state === "reactive" ? "<b>" + esc(T(c, "site.blood.reactive", "Reactive")) + "</b>"
        : esc(T(c, "site.blood.cleared", "All non-reactive")) + (t.group ? " · " + EN(c, esc(t.group.abo + (t.group.rhD === "positive" ? "+" : "-"))) : "");
    };
    var list = d.donations.length ? "<ul>" + d.donations.map(function (x) {
      return "<li>" + EN(c, esc(x.bagNumber + " · " + (donorName[x.donorId] || "") + " · " + x.volumeMl + " mL")) + " · " + esc(when(x.collectedAt)) + (x.anticoagulant ? " · " + additiveWord(c, x.anticoagulant) : "") +
        (x.donorKind ? " · " + wordOf(c, { voluntary: T(c, "site.blood.kind.voluntary", "Voluntary"), replacement: T(c, "site.blood.kind.replacement", "Replacement") }, x.donorKind) : "") +
        " · " + testState(x.tests) + " · " + esc(T(c, "site.blood.unitsCount", "{n} unit(s)", { n: x.units })) + (x.adverseReaction ? " · " + esc(T(c, "site.blood.donorReaction", "Donor reaction")) + EN(c, esc(": " + x.adverseReaction)) : "") + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.blood.noDonations", "No donations recorded yet.")) + "</p>";
    var donationOpts = d.donations.map(function (x) { return '<option value="' + esc(x.donationId) + '">' + EN(c, esc(x.bagNumber)) + "</option>"; }).join("");
    var methods = function (t) { return '<select id="bbTm-' + esc(t) + '" aria-label="' + esc(T(c, "site.blood.method", "Method")) + '"><option value=""></option>' + ((ce.testMethods || {})[t] || []).map(function (m) { return '<option value="' + esc(m) + '">' + methodWord(c, m) + "</option>"; }).join("") + "</select>"; };
    var tti = d.tti.map(function (t) { return '<label class="f"><span>' + ttiWord(c, t) + '</span><select id="bbTt-' + esc(t) + '"><option value=""></option><option value="non-reactive">' + esc(T(c, "site.blood.nonReactive", "Non-reactive")) + '</option><option value="reactive">' + esc(T(c, "site.blood.reactive", "Reactive")) + "</option></select>" + methods(t) + "</label>"; }).join("");
    var nat = '<label class="f"><span>' + ttiWord(c, "nat") + '</span><select id="bbTt-nat"><option value=""></option><option value="non-reactive">' + esc(T(c, "site.blood.nonReactive", "Non-reactive")) + '</option><option value="reactive">' + esc(T(c, "site.blood.reactive", "Reactive")) + "</option></select>" + methods("nat") + "</label>";
    var shelf = function (k) {
      return (k.variants || []).map(function (v) {
        return (v.additive ? additiveWord(c, v.additive) + (v.additive === "none" ? " " + additiveWord(c, v.anticoagulant) : "") + ": " : v.anticoagulant ? additiveWord(c, v.anticoagulant) + ": " : "") + esc(shelfWords(c, v.hours)) + (v.hospital ? " " + esc(T(c, "site.blood.hospitalShorter", "(this hospital's shorter setting)")) : "");
      }).join("; ");
    };
    var comps = d.components.map(function (k) {
      var id = esc(k.component);
      return '<div class="row"><label class="f"><span><b>' + componentWord(c, k.component) + "</b> · " + shelf(k) + " · " + EN(c, esc(k.storageText || "")) + '</span><input id="bbCpVol-' + id + '" type="number" min="1" placeholder="' + esc(T(c, "site.blood.volumeMl", "Volume (mL)")) + '"></label>' +
        (k.component === "prbc" ? '<label class="f"><span>' + esc(T(c, "site.blood.additive", "Additive solution")) + '</span><select id="bbCpAdd-prbc"><option value=""></option>' + (ce.additives || []).map(function (a) { return '<option value="' + esc(a) + '">' + additiveWord(c, a) + "</option>"; }).join("") + "</select></label>" : "") +
        '<label class="f"><span>' + esc(k.prepareWithinHours ? T(c, "site.blood.preparedWithin", "Separated or frozen at, if not now (within {n} hours of collection)", { n: k.prepareWithinHours }) : T(c, "site.blood.preparedAt", "Prepared at, if not now")) + '</span><input id="bbCpPrep-' + id + '" type="datetime-local"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.blood.earlierExpiry", "Earlier expiry, only to shorten")) + '</span><input id="bbCpExp-' + id + '" type="datetime-local"></label></div>';
    }).join("");
    return '<p class="quiet">' + esc(T(c, "site.blood.retentionNote", "Blood centre records are kept at least {n} years (Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, heading L; rule 122-P). Nothing on this screen deletes them.", { n: ce.recordRetentionYears || 5 })) + "</p>" + list +
      "<h3>" + esc(T(c, "site.blood.collectHeading", "Record a donation")) + "</h3>" + (open.length ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.screening", "Eligible screening (last 24 hours)")) + '</span><select id="bbDoScr">' + open.map(function (s) { return '<option value="' + esc(s.screeningId) + '">' + EN(c, esc((donorName[s.donorId] || "") + " · " + when(s.at))) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.bagNumber", "Bag number")) + '</span><input id="bbDoBag"></label><label class="f"><span>' + esc(T(c, "site.blood.volume", "Bag volume")) + '</span><select id="bbDoVol"><option value="350">350 mL</option><option value="450">450 mL</option></select></label>' +
        '<label class="f"><span>' + esc(T(c, "site.blood.apheresisVolume", "Apheresis volume (mL)")) + '</span><input id="bbDoApVol" type="number" min="1"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.blood.reinfusion", "Apheresis: red cells returned completely")) + '</span><select id="bbDoReinf"><option value=""></option><option value="yes">' + esc(T(c, "site.blood.yes", "Yes")) + '</option><option value="no">' + esc(T(c, "site.blood.no", "No")) + "</option></select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.bagType", "Bag type")) + '</span><input id="bbDoType"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.blood.anticoagulant", "Whole blood: anticoagulant in the bag")) + '</span><select id="bbDoAnti"><option value=""></option>' + (ce.anticoagulants || []).map(function (a) { return '<option value="' + esc(a) + '">' + additiveWord(c, a) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.donorKind", "Voluntary or replacement donation")) + '</span><select id="bbDoKind"><option value=""></option><option value="voluntary">' + esc(T(c, "site.blood.kind.voluntary", "Voluntary")) + '</option><option value="replacement">' + esc(T(c, "site.blood.kind.replacement", "Replacement")) + "</option></select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.blood.donorReactionField", "Donor reaction during or after collection, if any")) + '</span><input id="bbDoReact"></label>' +
        '<button class="btn" type="button" data-bb="donate">' + esc(T(c, "site.blood.recordDonation", "Record donation")) + "</button></div>"
        : "<p>" + esc(T(c, "site.blood.noEligible", "No eligible screening from the last 24 hours is waiting for a donation.")) + "</p>") +
      "<h3>" + esc(T(c, "site.blood.testsHeading", "Mandatory tests and grouping")) + "</h3><p>" + esc(T(c, "site.blood.testsNote", "Every unit stays in quarantine until all five tests are recorded non-reactive and the group is recorded. A reactive result holds every unit from that donation for discard.")) + " " +
        esc(T(c, "site.blood.testsLaw", "Each result records its method; the irregular antibody screen is recorded with them (Drugs and Cosmetics Rules 1945, Schedule F Part XII-B, headings K and L). A later retest never clears a reactive donation.")) + " " +
        esc(ce.natRequired ? T(c, "site.blood.natRequired", "This hospital requires NAT on every donation before release.") : T(c, "site.blood.natOptional", "NAT is optional here: the Rules do not require it, and this hospital has not made it required on Admin. A reactive NAT still holds the donation for discard.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.donation", "Donation")) + '</span><select id="bbTtDon">' + donationOpts + "</select></label>" + tti + nat +
      '<label class="f"><span>' + esc(T(c, "site.blood.abo", "ABO")) + '</span><select id="bbTtAbo"><option value=""></option><option>O</option><option>A</option><option>B</option><option>AB</option></select></label>' +
      '<label class="f"><span>' + esc(T(c, "site.blood.rhd", "RhD")) + '</span><select id="bbTtRh"><option value=""></option><option value="positive">' + esc(T(c, "site.blood.positive", "Positive")) + '</option><option value="negative">' + esc(T(c, "site.blood.negative", "Negative")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.antibodyScreen", "Irregular antibody screen")) + '</span><select id="bbTtAb"><option value=""></option><option value="negative">' + esc(T(c, "site.blood.negative", "Negative")) + '</option><option value="positive">' + esc(T(c, "site.blood.positive", "Positive")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.blood.antibodyIdentified", "Antibody found, or not yet identified")) + '</span><input id="bbTtAbId"></label>' +
      '<button class="btn" type="button" data-bb="tests">' + esc(T(c, "site.blood.saveTests", "Save results")) + "</button></div>" +
      "<h3>" + esc(T(c, "site.blood.separateHeading", "Separate components")) + "</h3><p>" + esc(T(c, "site.blood.shelfNoteLaw", "The expiry is worked out from the collection time, the bag's anticoagulant and the additive solution, as the Drugs and Cosmetics Rules 1945 set the shelf life of each component (Schedule P and Schedule F Part XII-B). Leave the expiry blank for the longest allowed, or enter an earlier one. Storage is recorded as the Rules set it.")) + "</p>" +
      '<p class="quiet">' + esc(T(c, "site.blood.shelfUnconfirmed", "Not confirmed in the Rules as read, so not allowed here: a longer shelf life for fresh frozen plasma kept at -40 C or colder (one year is kept), and a separate shelf life for red cells without an additive solution (they keep no longer than whole blood in the same anticoagulant).")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.blood.donation", "Donation")) + '</span><select id="bbCpDon">' + donationOpts + "</select></label></div>" + comps +
      '<button class="btn" type="button" data-bb="components">' + esc(T(c, "site.blood.saveComponents", "Save components")) + "</button>";
  }

  WSQ.page("bloodbank", { render: function (c) {
    var el = c.el, org = c.state.orgId, esc = c.esc;
    var q = "?orgId=" + encodeURIComponent(org);
    el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.blood.heading", "Blood bank")) + '</h1></div><div id="bbMsg"></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.inventoryCard", "Inventory")) + '</h2><div id="bbInv"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.unitsCard", "Units on the shelf")) + '</h2><div id="bbUnits"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.donationsCard", "Donations, tests and components")) + '</h2><div id="bbDon"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.samplesCard", "Pilot and recipient samples")) + '</h2><div id="bbSamples"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.notifyCard", "Reactive donors: notification and counselling")) + '</h2><div id="bbNotify"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.lookbackCard", "Look-back")) + '</h2><div id="bbLookback"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.blood.donorsCard", "Donors")) + '</h2><div id="bbDonors"></div></div>';
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };
    var data = null;
    var paint = function () {
      set("bbInv", inventoryHtml(c, data)); set("bbUnits", unitsHtml(c, data)); set("bbDon", donationsHtml(c, data)); set("bbSamples", samplesHtml(c, data));
      set("bbNotify", notificationsHtml(c, data)); set("bbLookback", lookbackHtml(c, data)); set("bbDonors", donorsHtml(c, data));
    };
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
        var conds = [1, 2].map(function (n) { return { condition: val("bbScCond" + n), since: val("bbScSince" + n) }; }).filter(function (x) { return x.condition; });
        var reg = val("bbScPulseReg");
        return c.api("/ward/donor-screening", { orgId: org, donorId: val("bbScDonor"), donationType: val("bbScType"), answers: answers, weightKg: val("bbScWt"), hbGdl: val("bbScHb"), hbMethod: val("bbScHbM"),
          bp: val("bbScBp"), pulse: val("bbScPulse"), pulseRegular: reg === "yes" ? true : reg === "no" ? false : null, temperature: val("bbScTemp"), plateletCount: val("bbScPlt"), totalProteinGL: val("bbScProt"),
          physicianName: val("bbScDoc"), physicianReason: val("bbScDocWhy"), outcome: val("bbScOut"), deferralConditions: conds, deferralReason: val("bbScWhy"), deferralDays: val("bbScDays"), permanent: val("bbScPerm") === "yes" }).then(after(T(c, "site.blood.screened", "Screening saved.")));
      }
      if (act === "donate") {
        var scr = (data && data.screenings || []).filter(function (s) { return s.screeningId === val("bbDoScr"); })[0], aph = !!(scr && scr.donationType !== "whole-blood"), ri = val("bbDoReinf");
        return c.api("/ward/blood-donation", { orgId: org, screeningId: val("bbDoScr"), bagNumber: val("bbDoBag"), volumeMl: Number(aph ? val("bbDoApVol") : val("bbDoVol")), bagType: val("bbDoType"),
          donorKind: val("bbDoKind"), anticoagulant: aph ? undefined : val("bbDoAnti"), adverseReaction: val("bbDoReact"),
          reinfusionComplete: aph ? (ri === "yes" ? true : ri === "no" ? false : null) : undefined }).then(after(T(c, "site.blood.donationRecorded", "Donation recorded.")));
      }
      if (act === "tests") {
        var tti = {}, methods = {}; (data && data.tti || []).forEach(function (t) { tti[t] = val("bbTt-" + t); methods[t] = val("bbTm-" + t); });
        if (val("bbTt-nat")) methods.nat = val("bbTm-nat");
        return c.api("/ward/blood-test-result", { orgId: org, donationId: val("bbTtDon"), tti: tti, methods: methods, nat: val("bbTt-nat"), abo: val("bbTtAbo"), rhD: val("bbTtRh"),
          antibodyScreen: val("bbTtAb"), antibodyIdentified: val("bbTtAbId") }).then(after(T(c, "site.blood.testsSaved", "Results saved.")));
      }
      if (act === "components") {
        var list = [];
        (data && data.components || []).forEach(function (k) {
          var vol = val("bbCpVol-" + k.component), exp = val("bbCpExp-" + k.component), prep = val("bbCpPrep-" + k.component);
          if (vol || exp || prep) list.push({ component: k.component, volumeMl: Number(vol), additive: k.component === "prbc" ? val("bbCpAdd-prbc") : undefined,
            preparedAt: prep ? new Date(prep).toISOString() : "", expiresAt: exp ? new Date(exp).toISOString() : "" });
        });
        return c.api("/ward/blood-components", { orgId: org, donationId: val("bbCpDon"), components: list }).then(after(T(c, "site.blood.componentsSaved", "Components saved.")));
      }
      if (act === "pool") {
        var ids = []; Array.prototype.forEach.call(el.querySelectorAll("[data-pool]"), function (x) { if (x.checked) ids.push(x.getAttribute("data-pool")); });
        var open = val("bbPoolOpen");
        return c.api("/ward/blood-pool", { orgId: org, unitIds: ids, component: val("bbPoolComp"), openSystem: open === "yes" ? true : open === "no" ? false : null }).then(after(T(c, "site.blood.pooled", "Pool recorded.")));
      }
      if (act === "label") {
        var u = (data && data.units || []).filter(function (x) { return x.unitId === id; })[0]; if (!u || !u.label) return;
        var w = window.open("", "_blank"); if (!w) return;
        w.document.write("<html><body>" + labelHtml(c, u) + "</body></html>"); w.document.close(); w.print(); return;
      }
      if (act === "sample") {
        var kind = val("bbSmKind");
        return c.api("/ward/blood-sample", { orgId: org, kind: kind, donationId: kind === "donor-pilot" ? val("bbSmDon") : undefined, episodeId: kind === "recipient" ? val("bbSmEp") : undefined, location: val("bbSmLoc") })
          .then(after(T(c, "site.blood.sample.registered", "Sample registered.")));
      }
      if (act === "sampleDiscard") return c.api("/ward/blood-sample-discard", { orgId: org, sampleId: id }).then(after(T(c, "site.blood.sample.discarded", "Sample discard recorded.")));
      if (act === "notify") {
        return c.api("/ward/donor-notification", { orgId: org, donationId: id, step: val("bbNtStep-" + id), method: val("bbNtHow-" + id), referredTo: val("bbNtTo-" + id), note: val("bbNtNote-" + id) })
          .then(after(T(c, "site.blood.notify.saved", "Step recorded.")));
      }
    };
  } });

  WSQ._bloodbank = { inventoryHtml: inventoryHtml, unitsHtml: unitsHtml, donorsHtml: donorsHtml, donationsHtml: donationsHtml, criteriaTableHtml: criteriaTableHtml,
    samplesHtml: samplesHtml, notificationsHtml: notificationsHtml, lookbackHtml: lookbackHtml, labelHtml: labelHtml, shelfWords: shelfWords, componentWord: componentWord };
})();
