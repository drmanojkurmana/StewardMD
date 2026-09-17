/* wardsynq/site/pages/support.js - the hospital support services: "Diet and kitchen", "CSSD", "Housekeeping",
 * "Ambulance" and "Mortuary". Buildless ES5, registers five pages onto WSQ.
 *
 * Every list loads on its own and says when it failed: a meal round that failed to load must never read as
 * "no patients", a mortuary register that failed must never read as "nobody held". The server decides who may
 * do what; this page offers only the buttons a role could use, and shows the server's refusal when it refuses.
 * Recorded values (names, MRNs, set and load numbers, registrations, reasons) are shown as recorded.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function E(c, v) { return c.esc(v == null ? "" : String(v)); }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function checked(id) { var e = document.getElementById(id); return !!(e && e.checked); }
  function set(id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; }
  function at(c, iso) { return iso ? EN(c, E(c, String(iso).slice(0, 16).replace("T", " "))) : ""; }
  function ask(c, text) { try { return String(window.prompt(text) || "").trim(); } catch (e) { return ""; } }
  function field(c, label, input) { return '<label class="f"><span>' + label + "</span>" + input + "</label>"; }
  function pill(kind, html) { return '<span class="pill' + (kind ? " " + kind : "") + '">' + html + "</span>"; }
  function opts(pairs, cur) { return pairs.map(function (p) { return '<option value="' + p[0] + '"' + (String(cur) === String(p[0]) ? " selected" : "") + ">" + p[1] + "</option>"; }).join(""); }
  function loading(c, what) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.support.loadingWhat", "Loading {what}...", { what: what })) + "</p>"; }
  function failed(c, what) { return '<div class="msg err">' + TS(c, "site.support.failedWhat", "Could not load {what}. Do not read this as none.", { what: what }) + "</div>"; }
  function table(heads, rows) { return '<div class="tbl"><table><tr>' + heads.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr>" + rows.join("") + "</table></div>"; }
  var PERSON_HIDDEN = /^\+?[\d\s().-]{7,}$|^(fb|cfa|ghis|uid):/i;
  function person(c, id) { var s = String(id == null ? "" : id).trim(); return !s || PERSON_HIDDEN.test(s) ? c.esc(T(c, "site.support.nameNotSet", "Name not set")) : EN(c, E(c, s)); }

  /* A refusal: translated lead, the server's own sentence under it as sent, and any named missing items translated. */
  function missingText(c, code) {
    switch (code) {
      case "released_to": return T(c, "site.support.miss.to", "who the body is released to");
      case "receiver_name": return T(c, "site.support.miss.receiver", "the receiver's name");
      case "relationship": return T(c, "site.support.miss.relationship", "the relationship");
      case "identity_proof": return T(c, "site.support.miss.idProof", "the receiver's identity proof");
      case "body_identified_by_receiver": return T(c, "site.support.miss.identified", "the receiver identifying the body");
      case "death_certificate": return T(c, "site.support.miss.deathCert", "the death certificate");
      case "police_noc": return T(c, "site.support.miss.policeNoc", "the police no-objection certificate");
      case "mlc_status_confirmed": return T(c, "site.support.miss.mlc", "who confirmed this is not a medico-legal case");
      case "post_mortem_report": return T(c, "site.support.miss.pmReport", "the post-mortem report");
      case "post_mortem_decision": return T(c, "site.support.miss.pmDecision", "the post-mortem decision");
      case "belongings_handed_over": return T(c, "site.support.miss.belongings", "the belongings handed over");
      case "inquest_papers": return T(c, "site.support.miss.inquest", "the inquest or Magistrate inquiry papers recorded on the medico-legal case (BNSS ss.194, 196)");
      default: return code;
    }
  }
  function refusalHtml(c, r) {
    var h = '<div class="msg err">' + TS(c, "site.support.notSaved", "Not saved.");
    if (r && r.detail) h += " " + EN(c, E(c, r.detail));
    else if (r && r.message) h += " " + EN(c, E(c, r.message));
    if (r && r.missing && r.missing.length) h += "<br>" + c.esc(T(c, "site.support.stillNeeded", "Still needed: {list}", { list: r.missing.map(function (m) { return missingText(c, m); }).join(", ") }));
    return h + "</div>";
  }
  /* Runs a write; on success toasts and re-renders the page, on refusal shows why in msgId and keeps what was typed. */
  function write(c, page, msgId, path, body, okText, then) {
    return c.api(path, Object.assign({ orgId: c.state.orgId }, body)).then(function (r) {
      if (!r || !r.ok) { set(msgId, refusalHtml(c, r)); return; }
      if (then) then(r);
      c.toast(okText); WSQ.render(page);
    });
  }
  /* Hospital settings for these services live in wardsynq.supportServices; a save sends the whole object. */
  function saveSettings(c, page, msgId, patch) {
    var o = c.state.org || {}, cur = (o.wardsynq && o.wardsynq.supportServices) || {};
    var next = Object.assign({}, cur, patch);
    return c.api("/org/update", { orgId: c.state.orgId, wardsynq: { supportServices: next } }).then(function (r) {
      if (!r || !r.ok) { set(msgId, refusalHtml(c, r)); return; }
      o.wardsynq = Object.assign({}, o.wardsynq || {}, { supportServices: next });
      c.toast(T(c, "site.support.settingsSaved", "Settings saved.")); WSQ.render(page);
    });
  }
  function settings(c) { var o = c.state.org || {}; return (o.wardsynq && o.wardsynq.supportServices) || {}; }
  function noRole(c) { return '<div class="msg note">' + TS(c, "site.support.noRole", "Your role does not include this service. Ask an administrator if it should.") + "</div>"; }

  /* ================================================================ Diet and kitchen */
  var DIET = ["normal", "soft", "liquid", "nbm", "diabetic", "renal", "low-salt", "high-protein", "tube-feed"];
  function dietWord(c, t) {
    return { normal: T(c, "site.support.diet.normal", "Normal"), soft: T(c, "site.support.diet.soft", "Soft"), liquid: T(c, "site.support.diet.liquid", "Liquid"),
      nbm: T(c, "site.support.diet.nbm", "Nil by mouth"), diabetic: T(c, "site.support.diet.diabetic", "Diabetic"), renal: T(c, "site.support.diet.renal", "Renal"),
      "low-salt": T(c, "site.support.diet.lowSalt", "Low salt"), "high-protein": T(c, "site.support.diet.highProtein", "High protein"), "tube-feed": T(c, "site.support.diet.tubeFeed", "Tube feed") }[t] || t;
  }
  function textureWord(c, t) { return { regular: T(c, "site.support.texture.regular", "Regular"), minced: T(c, "site.support.texture.minced", "Minced"), pureed: T(c, "site.support.texture.pureed", "Pureed"), liquidised: T(c, "site.support.texture.liquidised", "Liquidised") }[t] || t; }
  function mealWord(c, m) { return { breakfast: T(c, "site.support.meal.breakfast", "Breakfast"), lunch: T(c, "site.support.meal.lunch", "Lunch"), tea: T(c, "site.support.meal.tea", "Tea"), dinner: T(c, "site.support.meal.dinner", "Dinner") }[m] || m; }
  var MEALS = ["breakfast", "lunch", "tea", "dinner"];
  function orderText(c, o) {
    if (!o) return "";
    var s = (o.types || []).map(function (t) { return E(c, dietWord(c, t)); }).join(", ");
    if (o.texture) s += ", " + E(c, textureWord(c, o.texture));
    if (o.tubeFeed) s += " (" + EN(c, E(c, o.tubeFeed.route + ": " + o.tubeFeed.regimen)) + ")";
    if (o.nbm) s += "<br>" + pill("stop", c.esc(T(c, "site.support.nbmWindow", "Nil by mouth from {from}", { from: String(o.nbm.from).slice(0, 16).replace("T", " ") }))) + (o.nbm.until ? " " + c.esc(T(c, "site.support.untilLead", "until")) + " " + at(c, o.nbm.until) : "") + " " + EN(c, E(c, o.nbm.reason));
    if (o.note) s += "<br>" + EN(c, E(c, o.note));
    return s;
  }
  function serveHtml(c, row) {
    var s = row.serve || {};
    if (s.state === "nbm") return pill("stop", c.esc(T(c, "site.support.nbmNow", "NIL BY MOUTH"))) + " " + EN(c, E(c, s.reason)) + (s.until ? " " + c.esc(T(c, "site.support.untilLead", "until")) + " " + at(c, s.until) : "");
    if (s.state === "no-diet") return pill("warn", c.esc(T(c, "site.support.noDietOrder", "No diet order: ask the ward")));
    if (s.state === "stopped") return pill("warn", c.esc(T(c, "site.support.dietStopped", "Diet order stopped: no tray")));
    return orderText(c, { types: s.types, texture: s.texture, tubeFeed: s.tubeFeed, note: row.note });
  }
  function allergyHtml(c, a) {
    if (a == null) return pill("warn", c.esc(T(c, "site.support.allergiesUnread", "Allergies could not be read")));
    if (!a.length) return c.esc(T(c, "site.support.noAllergies", "None recorded"));
    return a.map(function (x) { return pill("stop", EN(c, E(c, x.substance + (x.reaction ? " (" + x.reaction + ")" : "")))); }).join(" ");
  }
  function mealBoardHtml(c, r) {
    if (r == null) return loading(c, T(c, "site.support.mealRound", "the meal round"));
    if (!r.ok) return failed(c, T(c, "site.support.mealRound", "the meal round")) + refusalHtml(c, r);
    var warn = (r.mealTimeWarning ? '<div class="msg note">' + TS(c, "site.support.noMealTime", "This hospital has not set a time for this meal, so diets and nil by mouth are shown as they stand now.") + "</div>" : "") +
      (r.partial ? '<div class="msg note">' + TS(c, "site.support.partialWard", "Not every stay could be read; a patient may be missing from this list.") + "</div>" : "");
    if (!r.rows.length) return warn + "<p>" + c.esc(T(c, "site.support.noAdmitted", "No admitted patients.")) + "</p>";
    var rows = r.rows.map(function (x) {
      var hot = x.nbmNow || (x.serve && x.serve.state !== "diet");
      var changes = (x.firstRound ? pill("warn", c.esc(T(c, "site.support.newOrder", "New order"))) : x.changedSinceLastRound ? pill("warn", c.esc(T(c, "site.support.changed", "Changed since the last round"))) : "") +
        (x.nbmUpcoming ? " " + pill("warn", c.esc(T(c, "site.support.nbmFrom", "NBM from {from}", { from: String(x.nbmUpcoming.from).slice(0, 16).replace("T", " ") }))) : "");
      var tray = (x.prepared ? pill(x.preparedAgainstOldOrder ? "stop" : "ok", x.preparedAgainstOldOrder ? c.esc(T(c, "site.support.preparedOld", "Prepared against an older order: prepare again")) : c.esc(T(c, "site.support.prepared", "Prepared"))) : "") +
        (x.delivered ? " " + pill("ok", c.esc(T(c, "site.support.delivered", "Delivered"))) : "");
      var canServe = x.serve && x.serve.state === "diet" && !x.nbmNow;
      var acts = (canServe && (!x.prepared || x.preparedAgainstOldOrder) ? ' <button class="btn quiet" type="button" data-sup="meal" data-mark="prepared" data-id="' + E(c, x.encounterId) + '">' + c.esc(T(c, "site.support.markPrepared", "Mark prepared")) + "</button>" : "") +
        (canServe && x.prepared && !x.delivered && !x.preparedAgainstOldOrder ? ' <button class="btn quiet" type="button" data-sup="meal" data-mark="delivered" data-id="' + E(c, x.encounterId) + '">' + c.esc(T(c, "site.support.markDelivered", "Mark delivered")) + "</button>" : "");
      return "<tr" + (hot ? ' class="warn"' : "") + "><td>" + EN(c, E(c, (x.ward || "") + " " + (x.bed || ""))) + "</td><td>" + EN(c, E(c, x.name || "")) + "<br>" + EN(c, E(c, x.mrn || "")) + "</td><td>" + serveHtml(c, x) + "</td><td>" + allergyHtml(c, x.allergies) + "</td><td>" + changes + "</td><td>" + tray + acts + "</td></tr>";
    });
    return warn + table([c.esc(T(c, "site.support.colBed", "Ward and bed")), c.esc(T(c, "site.support.colPatient", "Patient")), c.esc(T(c, "site.support.colDiet", "Diet")), c.esc(T(c, "site.support.colAllergies", "Allergies")), c.esc(T(c, "site.support.colChanges", "Changes")), c.esc(T(c, "site.support.colTray", "Tray"))], rows);
  }
  function dietHistoryHtml(c, r) {
    if (r == null) return loading(c, T(c, "site.support.dietOrder", "the diet order"));
    if (!r.ok) return failed(c, T(c, "site.support.dietOrder", "the diet order")) + refusalHtml(c, r);
    var cur = r.current;
    var h = "<p>" + (cur ? (cur.status === "stopped" ? pill("warn", c.esc(T(c, "site.support.stoppedWord", "Stopped"))) + " " : "") + orderText(c, cur) : c.esc(T(c, "site.support.noDietYet", "No diet ordered for this stay."))) + "</p>";
    h += "<p>" + c.esc(T(c, "site.support.allergiesLead", "Allergies:")) + " " + allergyHtml(c, r.allergies) + "</p>";
    if (r.versions.length) h += "<h3>" + c.esc(T(c, "site.support.versions", "Every version")) + "</h3>" + table([c.esc(T(c, "site.support.colVersion", "Version")), c.esc(T(c, "site.support.colWhen", "When")), c.esc(T(c, "site.support.colDiet", "Diet")), c.esc(T(c, "site.support.colReason", "Reason for the change"))],
      r.versions.map(function (v) { return "<tr><td>" + E(c, v.version) + "</td><td>" + at(c, v.orderedAt) + "</td><td>" + (v.status === "stopped" ? c.esc(T(c, "site.support.stoppedWord", "Stopped")) : orderText(c, v)) + "</td><td>" + EN(c, E(c, v.changeReason || "")) + "</td></tr>"; }));
    return h;
  }
  function dietFormHtml(c) {
    var types = DIET.map(function (t) { return '<label><input type="checkbox" id="dtT_' + t + '"> ' + E(c, dietWord(c, t)) + "</label>"; }).join(" ");
    return '<div class="row">' + types + "</div>" +
      '<div class="row">' + field(c, c.esc(T(c, "site.support.texture", "Texture")), '<select id="dtTexture">' + opts([["", c.esc(T(c, "site.support.notStated", "Not stated"))], ["regular", E(c, textureWord(c, "regular"))], ["minced", E(c, textureWord(c, "minced"))], ["pureed", E(c, textureWord(c, "pureed"))], ["liquidised", E(c, textureWord(c, "liquidised"))]], "") + "</select>") +
      field(c, c.esc(T(c, "site.support.nbmStarts", "Nil by mouth from")), '<input id="dtNbmFrom" type="datetime-local">') + field(c, c.esc(T(c, "site.support.nbmEnds", "Nil by mouth until")), '<input id="dtNbmUntil" type="datetime-local">') +
      field(c, c.esc(T(c, "site.support.nbmReason", "Why nil by mouth (for example the procedure)")), '<input id="dtNbmReason">') + "</div>" +
      '<div class="row">' + field(c, c.esc(T(c, "site.support.tubeRegimen", "Tube feed regimen")), '<input id="dtRegimen">') +
      field(c, c.esc(T(c, "site.support.tubeRoute", "Tube")), '<select id="dtRoute">' + opts([["", ""], ["NG", "NG"], ["OG", "OG"], ["NJ", "NJ"], ["PEG", "PEG"], ["PEJ", "PEJ"], ["other", c.esc(T(c, "site.support.other", "Other"))]], "") + "</select>") +
      field(c, c.esc(T(c, "site.support.note", "Note for the kitchen")), '<input id="dtNote">') + field(c, c.esc(T(c, "site.support.changeReason", "Reason for a change")), '<input id="dtReason">') + "</div>" +
      '<p class="quiet">' + c.esc(T(c, "site.support.nbmHint", "Nil by mouth on its own lasts until further orders. To keep meals until a procedure, choose the diet and give the NBM window with its end.")) + "</p>" +
      '<div class="row"><button class="btn" type="button" data-sup="dietsave">' + c.esc(T(c, "site.support.saveDiet", "Save diet order")) + '</button><button class="btn quiet" type="button" data-sup="dietstop">' + c.esc(T(c, "site.support.stopDiet", "Stop the diet order")) + '</button></div><div id="dtMsg"></div>';
  }
  function dietOrderBody() {
    var types = DIET.filter(function (t) { return checked("dtT_" + t); });
    var iso = function (v) { return v ? new Date(v).toISOString() : ""; };
    var o = { types: types, texture: val("dtTexture"), note: val("dtNote") };
    if (val("dtNbmFrom") || val("dtNbmUntil")) o.nbm = { from: iso(val("dtNbmFrom")), until: iso(val("dtNbmUntil")), reason: val("dtNbmReason") };
    if (types.indexOf("tube-feed") >= 0) o.tubeFeed = { regimen: val("dtRegimen"), route: val("dtRoute") };
    return o;
  }
  function guessMeal() { var h = new Date().getHours(); return h < 10 ? "breakfast" : h < 15 ? "lunch" : h < 18 ? "tea" : "dinner"; }

  WSQ.page("diet", { render: function (c) {
    var el = c.el, canOrder = c.can("emr.treat") || c.can("diet.order"), canKitchen = c.can("diet.kitchen"), admin = c.can("staff.admin");
    var S = c.state._diet = c.state._diet || { date: new Date().toISOString().slice(0, 10), meal: guessMeal(), ward: "" };
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    var mt = settings(c).mealTimes || {};
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.dietTitle", "Diet and kitchen")) + "</h1></div>" + (!canOrder && !canKitchen ? noRole(c) : "") +
      (canOrder ? '<div class="card"><h2>' + c.esc(T(c, "site.support.orderCard", "Diet order")) + '</h2><div class="row">' + field(c, c.esc(T(c, "site.support.patient", "Patient")), '<select id="dtPatient"><option value="">' + c.esc(T(c, "site.support.loadingPatients", "Loading patients...")) + "</option></select>") + '</div><div id="dtCurrent"></div><div id="dtForm"></div></div>' : "") +
      (canKitchen ? '<div class="card"><h2>' + c.esc(T(c, "site.support.roundCard", "Meal round")) + '</h2><div class="row">' + field(c, c.esc(T(c, "site.support.date", "Date")), '<input id="mbDate" type="date" value="' + E(c, S.date) + '">') +
        field(c, c.esc(T(c, "site.support.meal", "Meal")), '<select id="mbMeal">' + opts(MEALS.map(function (m) { return [m, E(c, mealWord(c, m)) + (mt[m] ? " " + E(c, mt[m]) : "")]; }), S.meal) + "</select>") +
        field(c, c.esc(T(c, "site.support.ward", "Ward (blank for all)")), '<input id="mbWard" value="' + E(c, S.ward) + '">') + '<button class="btn quiet" type="button" data-sup="mbshow">' + c.esc(T(c, "site.support.show", "Show")) + '</button></div><div id="mbMsg"></div><div id="mbBoard"></div></div>' : "") +
      (admin ? '<div class="card"><h2>' + c.esc(T(c, "site.support.mealTimesCard", "Meal times")) + '</h2><div class="row">' + MEALS.map(function (m) { return field(c, E(c, mealWord(c, m)), '<input id="mt_' + m + '" type="time" value="' + E(c, mt[m] || "") + '">'); }).join("") +
        '<button class="btn" type="button" data-sup="mtsave">' + c.esc(T(c, "site.support.save", "Save")) + '</button></div><div id="mtMsg"></div></div>' : "");

    if (canOrder) {
      c.api("/ward/list" + q).then(function (r) {
        var sel = document.getElementById("dtPatient"); if (!sel) return;
        if (!r || !r.ok) { sel.innerHTML = '<option value="">' + c.esc(WSQ.tooManyOpen(r) || T(c, "site.support.patientsFailed", "Patients could not be loaded")) + "</option>"; return; }
        var cur = c.state.dietFor && c.state.dietFor.encounterId;
        sel.innerHTML = '<option value="">' + c.esc(T(c, "site.support.choosePatient", "Choose a patient")) + "</option>" + (r.patients || []).map(function (p) {
          return '<option value="' + E(c, p.encounterId) + '"' + (p.encounterId === cur ? " selected" : "") + ">" + EN(c, E(c, (p.ward || "") + " " + (p.bed || "") + ", " + (p.name || "") + " " + (p.mrn || ""))) + "</option>";
        }).join("");
        sel.onchange = function () { var p = (r.patients || []).filter(function (x) { return x.encounterId === sel.value; })[0] || null; c.state.dietFor = p; WSQ.render("diet"); };
      });
      if (c.state.dietFor) {
        set("dtCurrent", dietHistoryHtml(c, null)); set("dtForm", dietFormHtml(c));
        c.api("/ward/diet-order-history" + q + "&encounterId=" + encodeURIComponent(c.state.dietFor.encounterId)).then(function (r) { S.history = r; set("dtCurrent", dietHistoryHtml(c, r || { ok: false })); });
      }
    }
    var loadBoard = function () {
      set("mbBoard", mealBoardHtml(c, null));
      c.api("/ward/meal-board" + q + "&date=" + encodeURIComponent(S.date) + "&meal=" + encodeURIComponent(S.meal) + "&ward=" + encodeURIComponent(S.ward)).then(function (r) { set("mbBoard", mealBoardHtml(c, r || { ok: false })); });
    };
    if (canKitchen) loadBoard();

    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-sup]"); if (!b) return;
      var act = b.getAttribute("data-sup");
      if (act === "mbshow") { S.date = val("mbDate"); S.meal = val("mbMeal"); S.ward = val("mbWard"); return loadBoard(); }
      if (act === "meal") return c.api("/ward/meal-mark", { orgId: c.state.orgId, date: S.date, meal: S.meal, encounterId: b.getAttribute("data-id"), mark: b.getAttribute("data-mark") }).then(function (r) { if (!r || !r.ok) set("mbMsg", refusalHtml(c, r)); else { set("mbMsg", ""); loadBoard(); } });
      if (act === "dietsave") {
        var cur = S.history && S.history.ok && S.history.current;
        return write(c, "diet", "dtMsg", "/ward/diet-order", { encounterId: c.state.dietFor.encounterId, patientId: c.state.dietFor.patientId, order: dietOrderBody(), reason: val("dtReason"), expectedVersion: cur ? cur.version : 0 }, T(c, "site.support.dietSaved", "Diet order saved."));
      }
      if (act === "dietstop") { var why = ask(c, T(c, "site.support.stopWhy", "Why is the diet order stopped?")); if (!why) return; return write(c, "diet", "dtMsg", "/ward/diet-order-stop", { encounterId: c.state.dietFor.encounterId, reason: why }, T(c, "site.support.dietStoppedToast", "Diet order stopped.")); }
      if (act === "mtsave") { var times = {}; MEALS.forEach(function (m) { if (val("mt_" + m)) times[m] = val("mt_" + m); }); return saveSettings(c, "diet", "mtMsg", { mealTimes: times }); }
    };
  } });

  /* ================================================================ CSSD */
  function stateWord(c, s) {
    return { received: T(c, "site.support.cssd.received", "Received"), washed: T(c, "site.support.cssd.washed", "Washed"), packed: T(c, "site.support.cssd.packed", "Packed"),
      sterilised: T(c, "site.support.cssd.sterilised", "Sterilised"), stored: T(c, "site.support.cssd.stored", "Stored"), issued: T(c, "site.support.cssd.issued", "Issued"), recalled: T(c, "site.support.cssd.recalled", "Recalled") }[s] || s;
  }
  function indicatorWord(c, s) { return { pass: T(c, "site.support.ind.pass", "Pass"), fail: T(c, "site.support.ind.fail", "Fail"), pending: T(c, "site.support.ind.pending", "Pending"), "not-used": T(c, "site.support.ind.notUsed", "Not used") }[s] || s; }
  function casePairs(c, cases) { return [["", c.esc(T(c, "site.support.noCase", "Not for a theatre case"))]].concat((cases || []).map(function (k) { return [E(c, k.caseId), EN(c, E(c, k.procedure + " " + (k.laterality || "") + ", " + String(k.bookedAt || "").slice(0, 10)))]; })); }
  function cycleRow(c, x, i, b) {
    var st = x.recalled && x.state !== "issued" ? "recalled" : x.state;
    var act = "";
    if (x.recalled) act = pill("stop", c.esc(T(c, "site.support.recalledLoad", "Recalled with its load"))) + (x.issued ? " " + c.esc(T(c, "site.support.issuedTo", "Issued to {to}", { to: x.issued.to })) : "");
    else if (x.state === "received") act = '<button class="btn quiet" type="button" data-sup="cstep" data-step="wash" data-id="' + E(c, x.id) + '">' + c.esc(T(c, "site.support.markWashed", "Washed")) + "</button>";
    else if (x.state === "washed") act = '<button class="btn quiet" type="button" data-sup="cpack" data-id="' + E(c, x.id) + '">' + c.esc(T(c, "site.support.markPacked", "Packed, every item checked")) + "</button>";
    else if (x.state === "packed") act = '<select id="cLoad' + i + '">' + opts((b.loads || []).filter(function (l) { return l.state !== "failed"; }).map(function (l) { return [E(c, l.id), EN(c, E(c, l.sterilizer + " " + l.loadNumber))]; }), "") + '</select> <button class="btn quiet" type="button" data-sup="cstep" data-step="sterilise" data-i="' + i + '" data-id="' + E(c, x.id) + '">' + c.esc(T(c, "site.support.sterilisedIn", "Sterilised in this load")) + "</button>";
    else if (x.state === "sterilised") act = '<input id="cExp' + i + '" type="date" aria-label="' + c.esc(T(c, "site.support.expiry", "Sterile until")) + '"> <input id="cLoc' + i + '" aria-label="' + c.esc(T(c, "site.support.shelf", "Shelf")) + '"> <button class="btn quiet" type="button" data-sup="cstep" data-step="store" data-i="' + i + '" data-id="' + E(c, x.id) + '">' + c.esc(T(c, "site.support.store", "Store")) + "</button>";
    else if (x.state === "stored") act = c.esc(T(c, "site.support.sterileUntil", "Sterile until {date}", { date: String(x.stored.expiresAt).slice(0, 10) })) + ' <input id="cTo' + i + '" aria-label="' + c.esc(T(c, "site.support.issueTo", "Issue to (theatre or ward)")) + '"> <select id="cCase' + i + '">' + opts(casePairs(c, b.cases), "") + '</select> <button class="btn quiet" type="button" data-sup="cstep" data-step="issue" data-i="' + i + '" data-id="' + E(c, x.id) + '">' + c.esc(T(c, "site.support.issue", "Issue")) + "</button>";
    var missing = x.packed && x.packed.missing && x.packed.missing.length ? " " + pill("warn", c.esc(T(c, "site.support.missingItems", "Missing: {items}", { items: x.packed.missing.join(", ") }))) : "";
    return "<tr" + (x.recalled ? ' class="warn"' : "") + "><td>" + EN(c, E(c, x.setName)) + missing + "</td><td>" + pill(x.recalled ? "stop" : "", E(c, stateWord(c, st))) + "</td><td>" + EN(c, E(c, x.received && x.received.from)) + " " + at(c, x.received && x.received.at) + "</td><td>" + act + "</td></tr>";
  }
  function cssdHtml(c, b) {
    if (b == null) return loading(c, T(c, "site.support.cssdBoard", "the CSSD board"));
    if (!b.ok) return failed(c, T(c, "site.support.cssdBoard", "the CSSD board")) + refusalHtml(c, b);
    var sets = b.sets || [];
    var h = "<h3>" + c.esc(T(c, "site.support.receiveCard", "Receive a used set")) + '</h3><div class="row">' +
      field(c, c.esc(T(c, "site.support.set", "Set")), '<select id="cRecSet">' + opts(sets.filter(function (s) { return s.active !== false; }).map(function (s) { return [E(c, s.id), EN(c, E(c, s.name + (s.code ? " (" + s.code + ")" : "")))]; }), "") + "</select>") +
      field(c, c.esc(T(c, "site.support.from", "From (theatre or ward)")), '<input id="cRecFrom">') + field(c, c.esc(T(c, "site.support.usedInCase", "Used in theatre case")), '<select id="cRecCase">' + opts(casePairs(c, b.cases), "") + "</select>") +
      '<button class="btn" type="button" data-sup="creceive">' + c.esc(T(c, "site.support.receive", "Receive")) + "</button></div>";
    h += "<h3>" + c.esc(T(c, "site.support.inDept", "In the department")) + "</h3>" + (b.cycles.length ? table([c.esc(T(c, "site.support.set", "Set")), c.esc(T(c, "site.support.colState", "State")), c.esc(T(c, "site.support.colReceived", "Received")), c.esc(T(c, "site.support.colNext", "Next step"))], b.cycles.map(function (x, i) { return cycleRow(c, x, i, b); })) : "<p>" + c.esc(T(c, "site.support.nothingInDept", "No sets in the department.")) + "</p>");
    if (b.expiring.length) h += "<h3>" + c.esc(T(c, "site.support.expiring", "Expired or expiring within three days")) + "</h3><ul>" + b.expiring.map(function (x) { return "<li>" + pill(x.expired ? "stop" : "warn", x.expired ? c.esc(T(c, "site.support.expired", "Expired")) : c.esc(T(c, "site.support.expiringSoon", "Expiring"))) + " " + EN(c, E(c, x.setName)) + " " + at(c, x.expiresAt) + "</li>"; }).join("") + "</ul>";
    h += "<h3>" + c.esc(T(c, "site.support.loadsCard", "Steriliser loads")) + '</h3><div class="row">' + field(c, c.esc(T(c, "site.support.sterilizer", "Steriliser")), '<input id="clSter">') + field(c, c.esc(T(c, "site.support.loadNumber", "Load number")), '<input id="clNum">') +
      field(c, c.esc(T(c, "site.support.programme", "Programme")), '<input id="clProg">') + field(c, c.esc(T(c, "site.support.tempC", "Temperature (C)")), '<input id="clTemp" inputmode="decimal">') +
      field(c, c.esc(T(c, "site.support.holdMin", "Holding time (minutes)")), '<input id="clHold" inputmode="decimal">') + field(c, c.esc(T(c, "site.support.pressure", "Pressure (kPa)")), '<input id="clPres" inputmode="decimal">') +
      '<button class="btn" type="button" data-sup="cload">' + c.esc(T(c, "site.support.startLoad", "Start load")) + "</button></div>";
    if (b.loads.length) h += table([c.esc(T(c, "site.support.loadNumber", "Load number")), c.esc(T(c, "site.support.cycleParams", "Cycle")), c.esc(T(c, "site.support.ci", "Chemical indicator")), c.esc(T(c, "site.support.bi", "Biological indicator")), c.esc(T(c, "site.support.colState", "State")), ""], b.loads.map(function (l) {
      var btn = function (k, v, label) { return '<button class="btn quiet" type="button" data-sup="cresult" data-k="' + k + '" data-v="' + v + '" data-id="' + E(c, l.id) + '">' + label + "</button>"; };
      var acts = l.state === "failed" ? "" : (l.chemicalIndicator === "pending" ? btn("ci", "pass", c.esc(T(c, "site.support.ciPass", "CI pass"))) + btn("ci", "fail", c.esc(T(c, "site.support.ciFail", "CI fail"))) : "") +
        (l.biologicalIndicator === "pending" ? btn("bi", "pass", c.esc(T(c, "site.support.biPass", "BI pass"))) + btn("bi", "fail", c.esc(T(c, "site.support.biFail", "BI fail"))) + btn("bi", "not-used", c.esc(T(c, "site.support.noBi", "Released without BI"))) : "");
      return "<tr" + (l.state === "failed" ? ' class="warn"' : "") + "><td>" + EN(c, E(c, l.sterilizer + " " + l.loadNumber)) + "</td><td>" + EN(c, E(c, l.programme + ", " + l.temperatureC + " C, " + l.holdMinutes + " min" + (l.pressureKpa != null ? ", " + l.pressureKpa + " kPa" : ""))) + "</td><td>" + E(c, indicatorWord(c, l.chemicalIndicator)) + "</td><td>" + E(c, indicatorWord(c, l.biologicalIndicator)) + "</td><td>" +
        pill(l.state === "released" ? "ok" : l.state === "failed" ? "stop" : "warn", l.state === "released" ? c.esc(T(c, "site.support.loadReleased", "Released")) : l.state === "failed" ? c.esc(T(c, "site.support.loadFailed", "Failed, recalled")) : c.esc(T(c, "site.support.loadRunning", "Not released"))) + "</td><td>" + acts + "</td></tr>";
    }));
    h += "<h3>" + c.esc(T(c, "site.support.setsCard", "Instrument sets")) + "</h3>" + (sets.length ? "<ul>" + sets.map(function (s) { return "<li><b>" + EN(c, E(c, s.name)) + "</b> " + EN(c, E(c, (s.items || []).map(function (it) { return it.name + " x " + it.count; }).join(", "))) + "</li>"; }).join("") + "</ul>" : "<p>" + c.esc(T(c, "site.support.noSets", "No sets defined yet.")) + "</p>") +
      '<div class="row">' + field(c, c.esc(T(c, "site.support.setName", "Set name")), '<input id="csName">') + field(c, c.esc(T(c, "site.support.setCode", "Code")), '<input id="csCode">') +
      field(c, c.esc(T(c, "site.support.setItems", "Items, one per line as name x count")), '<textarea id="csItems" rows="4"></textarea>') + '<button class="btn" type="button" data-sup="cset">' + c.esc(T(c, "site.support.saveSet", "Save set")) + "</button></div>";
    h += "<h3>" + c.esc(T(c, "site.support.traceCard", "Trace a theatre case")) + '</h3><div class="row"><select id="ctCase">' + opts(casePairs(c, b.cases).slice(1), "") + '</select><button class="btn quiet" type="button" data-sup="ctrace">' + c.esc(T(c, "site.support.show", "Show")) + '</button></div><div id="ctOut"></div>';
    return h;
  }
  function recallHtml(c, r) {
    var reached = (r.recall && r.recall.reached) || [];
    return '<div class="msg err">' + TS(c, "site.support.loadFailedMsg", "The load failed. Its sets are recalled.") +
      (reached.length ? "<br>" + c.esc(T(c, "site.support.reachedCases", "Sets from it reached these theatre cases; tell the teams:")) + "<ul>" + reached.map(function (x) { return "<li>" + EN(c, E(c, x.setName + ": " + (x.issuedTo || "") + (x.caseId ? ", " + x.caseId : ""))) + "</li>"; }).join("") + "</ul>" : "") + "</div>";
  }
  function traceHtml(c, r) {
    if (!r || !r.ok) return failed(c, T(c, "site.support.caseSets", "the sets for this case"));
    if (!r.sets.length) return "<p>" + c.esc(T(c, "site.support.noCaseSets", "No set is recorded against this case.")) + "</p>";
    return "<ul>" + r.sets.map(function (s) { return "<li>" + EN(c, E(c, s.setName + ", " + (s.sterilizer || "") + " " + (s.loadNumber || ""))) + (s.recalled || s.loadState === "failed" ? " " + pill("stop", c.esc(T(c, "site.support.recalledLoad", "Recalled with its load"))) : "") + "</li>"; }).join("") + "</ul>";
  }
  WSQ.page("cssd", { render: function (c) {
    var el = c.el, q = "?orgId=" + encodeURIComponent(c.state.orgId);
    if (!c.can("cssd.process")) { el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.cssdTitle", "CSSD")) + "</h1></div>" + noRole(c); return; }
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.cssdTitle", "CSSD")) + '</h1></div><div class="card"><div id="cMsg"></div><div id="cBoard"></div></div>';
    var board = null;
    set("cBoard", cssdHtml(c, null));
    c.api("/ward/cssd-board" + q).then(function (r) { board = r || { ok: false }; set("cBoard", cssdHtml(c, board)); });
    var step = function (body) { return write(c, "cssd", "cMsg", "/ward/cssd-step", body, T(c, "site.support.stepSaved", "Recorded.")); };
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-sup]"); if (!b) return;
      var act = b.getAttribute("data-sup"), id = b.getAttribute("data-id"), i = b.getAttribute("data-i");
      if (act === "creceive") return step({ step: "receive", setId: val("cRecSet"), from: val("cRecFrom"), caseId: val("cRecCase") });
      if (act === "cpack") {
        var ok = false; try { ok = window.confirm(T(c, "site.support.packConfirm", "Has every item been checked against the set list?")); } catch (e) {}
        if (!ok) return;
        var miss = ask(c, T(c, "site.support.missingPrompt", "Missing items, separated by commas. Leave empty if nothing is missing."));
        return step({ step: "pack", cycleId: id, itemsChecked: true, missing: miss ? miss.split(",") : [] });
      }
      if (act === "cstep") {
        var s = b.getAttribute("data-step");
        return step({ step: s, cycleId: id, loadId: val("cLoad" + i), expiresAt: val("cExp" + i), location: val("cLoc" + i), to: val("cTo" + i), caseId: val("cCase" + i) });
      }
      if (act === "cload") return write(c, "cssd", "cMsg", "/ward/cssd-load", { load: { sterilizer: val("clSter"), loadNumber: val("clNum"), programme: val("clProg"), temperatureC: val("clTemp"), holdMinutes: val("clHold"), pressureKpa: val("clPres") } }, T(c, "site.support.loadStarted", "Load started."));
      if (act === "cresult") {
        var k = b.getAttribute("data-k"), v = b.getAttribute("data-v"), body = { orgId: c.state.orgId, loadId: id };
        if (v === "not-used") { var sure = false; try { sure = window.confirm(T(c, "site.support.noBiConfirm", "Release this load with no biological indicator? Your name is recorded against it.")); } catch (e) {} if (!sure) return; body.releaseWithoutBi = true; }
        body[k === "ci" ? "chemicalIndicator" : "biologicalIndicator"] = v;
        return c.api("/ward/cssd-load-result", body).then(function (r) {
          if (r && r.state === "failed") { set("cMsg", recallHtml(c, r) + (r.ok ? "" : refusalHtml(c, r))); c.api("/ward/cssd-board" + q).then(function (x) { set("cBoard", cssdHtml(c, x || { ok: false })); }); return; }
          if (!r || !r.ok) { set("cMsg", refusalHtml(c, r)); return; }
          c.toast(T(c, "site.support.stepSaved", "Recorded.")); WSQ.render("cssd");
        });
      }
      if (act === "cset") {
        var items = val("csItems").split("\n").map(function (line) { var m = /^(.*?)\s*x\s*(\d+)\s*$/i.exec(line.trim()); return m ? { name: m[1], count: Number(m[2]) } : { name: line.trim(), count: 0 }; }).filter(function (x) { return x.name; });
        return write(c, "cssd", "cMsg", "/ward/cssd-set", { set: { name: val("csName"), code: val("csCode"), items: items } }, T(c, "site.support.setSaved", "Set saved."));
      }
      if (act === "ctrace") { set("ctOut", loading(c, T(c, "site.support.caseSets", "the sets for this case"))); return c.api("/ward/cssd-case-sets" + q + "&caseId=" + encodeURIComponent(val("ctCase"))).then(function (r) { set("ctOut", traceHtml(c, r)); }); }
    };
  } });

  /* ================================================================ Housekeeping */
  function kindWord(c, k) { return { "bed-clean": T(c, "site.support.hk.bedClean", "Bed clean"), "terminal-clean": T(c, "site.support.hk.terminal", "Terminal clean"), spill: T(c, "site.support.hk.spill", "Spill"), "room-clean": T(c, "site.support.hk.room", "Room clean") }[k] || k; }
  function isoWord(c, k) { return { none: T(c, "site.support.iso.none", "No isolation"), contact: T(c, "site.support.iso.contact", "Contact"), droplet: T(c, "site.support.iso.droplet", "Droplet"), airborne: T(c, "site.support.iso.airborne", "Airborne"), "contact-enteric": T(c, "site.support.iso.enteric", "Contact enteric"), other: T(c, "site.support.iso.other", "Other") }[k] || k; }
  var ISO = ["none", "contact", "droplet", "airborne", "contact-enteric", "other"];
  function hkStateWord(c, s) { return { open: T(c, "site.support.hk.open", "Waiting"), assigned: T(c, "site.support.hk.assigned", "Assigned"), "in-progress": T(c, "site.support.hk.inProgress", "Cleaning"), finished: T(c, "site.support.hk.finished", "Waiting for inspection"), rework: T(c, "site.support.hk.rework", "Failed inspection: clean again") }[s] || s; }
  function hkBoardHtml(c, r) {
    if (r == null) return loading(c, T(c, "site.support.hkBoard", "the housekeeping work"));
    if (!r.ok) return failed(c, T(c, "site.support.hkBoard", "the housekeeping work")) + refusalHtml(c, r);
    if (!r.tasks.length) return "<p>" + c.esc(T(c, "site.support.hkNone", "Nothing waiting to be cleaned.")) + "</p>";
    return table([c.esc(T(c, "site.support.colTask", "Task")), c.esc(T(c, "site.support.colWhere", "Where")), c.esc(T(c, "site.support.colRequested", "Since")), c.esc(T(c, "site.support.colState", "State")), ""], r.tasks.map(function (t, i) {
      var id = E(c, t.id), btn = function (step, label) { return ' <button class="btn quiet" type="button" data-sup="hk" data-step="' + step + '" data-i="' + i + '" data-id="' + id + '">' + label + "</button>"; };
      var acts = "";
      if (t.state === "open" || t.state === "rework") {
        if (t.origin === "bed") acts += '<select id="hkKind' + i + '" aria-label="' + c.esc(T(c, "site.support.colTask", "Task")) + '">' + opts([["bed-clean", E(c, kindWord(c, "bed-clean"))], ["terminal-clean", E(c, kindWord(c, "terminal-clean"))]], t.kind) + "</select> ";
        if (t.origin === "bed" || t.kind === "terminal-clean") acts += '<select id="hkIso' + i + '" aria-label="' + c.esc(T(c, "site.support.isolation", "Isolation type")) + '">' + opts(ISO.map(function (k) { return [k, E(c, isoWord(c, k))]; }), t.isolationType || "none") + "</select>";
        acts += btn("assign", c.esc(T(c, "site.support.take", "Take this task")));
      }
      if (t.state === "assigned" && t.mine) acts += btn("start", c.esc(T(c, "site.support.start", "Start")));
      if (t.state === "in-progress" && t.mine) acts += btn("finish", c.esc(T(c, "site.support.finish", "Finished")));
      if (t.state === "finished" && r.canInspect && !t.mine) acts += btn("pass", c.esc(T(c, "site.support.inspectPass", "Inspected: pass"))) + btn("fail", c.esc(T(c, "site.support.inspectFail", "Inspected: fail")));
      if (r.canInspect && t.origin === "manual") acts += btn("cancel", c.esc(T(c, "site.support.cancelTask", "Cancel")));
      var where = t.origin === "bed" ? EN(c, E(c, (t.wardName || "") + " " + (t.bedName || ""))) : EN(c, E(c, (t.wardName ? t.wardName + ", " : "") + (t.location || "")));
      return "<tr" + (t.kind === "spill" || t.state === "rework" ? ' class="warn"' : "") + "><td>" + E(c, kindWord(c, t.kind)) + (t.isolationType && t.isolationType !== "none" ? " " + pill("warn", E(c, isoWord(c, t.isolationType))) : "") + "</td><td>" + where +
        (t.bedNoLongerCleaning ? " " + pill("warn", c.esc(T(c, "site.support.bedReleasedByHand", "Bed released without inspection"))) : "") + "</td><td>" + at(c, t.requestedAt) + "</td><td>" + pill(t.state === "finished" ? "warn" : "", E(c, hkStateWord(c, t.state))) + (t.mine ? " " + c.esc(T(c, "site.support.yours", "(yours)")) : "") + "</td><td>" + acts + "</td></tr>";
    }));
  }
  function spreadText(c, s) { return s ? c.esc(T(c, "site.support.spread", "median {m} min, 90th percentile {p} min ({n})", { m: s.medianMinutes, p: s.p90Minutes, n: s.count })) : c.esc(T(c, "site.support.noFigure", "no timed tasks")); }
  function hkReportHtml(c, r) {
    if (r == null) return loading(c, T(c, "site.support.turnaround", "turnaround"));
    if (!r.ok) return failed(c, T(c, "site.support.turnaround", "turnaround"));
    var rows = function (list, word) { return list.map(function (g) { return "<tr><td>" + word(g.key) + "</td><td>" + E(c, g.tasks) + "</td><td>" + spreadText(c, g.toFinished) + "</td><td>" + spreadText(c, g.toInspected) + "</td><td>" + E(c, g.untimed) + "</td></tr>"; }); };
    var heads = [c.esc(T(c, "site.support.colGroup", "Group")), c.esc(T(c, "site.support.colTasks", "Inspected")), c.esc(T(c, "site.support.toFinished", "To finished")), c.esc(T(c, "site.support.toInspected", "To inspected and released")), c.esc(T(c, "site.support.untimed", "Left out (a time missing)"))];
    if (!r.inspected) return "<p>" + c.esc(T(c, "site.support.noInspected", "No inspected cleans in this period. No figure is shown.")) + "</p>";
    return table(heads, rows(r.byKind, function (k) { return E(c, kindWord(c, k)); }).concat(rows(r.byWard, function (k) { return EN(c, E(c, k)); })));
  }
  WSQ.page("housekeeping", { render: function (c) {
    var el = c.el, q = "?orgId=" + encodeURIComponent(c.state.orgId), admin = c.can("staff.admin");
    var S = c.state._hk = c.state._hk || { days: "7" };
    if (!c.can("housekeeping.task") && !c.can("housekeeping.inspect")) { el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.hkTitle", "Housekeeping")) + "</h1></div>" + noRole(c); return; }
    var wards = (c.state.org && c.state.org._wards) || [];
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.hkTitle", "Housekeeping")) + "</h1></div>" +
      '<div class="card"><h2>' + c.esc(T(c, "site.support.openWork", "Open work")) + '</h2><div id="hkMsg"></div><div id="hkBoard"></div></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.support.raiseCard", "Raise a task")) + '</h2><div class="row">' +
      field(c, c.esc(T(c, "site.support.colTask", "Task")), '<select id="hkNewKind">' + opts([["spill", E(c, kindWord(c, "spill"))], ["room-clean", E(c, kindWord(c, "room-clean"))], ["terminal-clean", E(c, kindWord(c, "terminal-clean"))]], "spill") + "</select>") +
      field(c, c.esc(T(c, "site.support.colWhere", "Where")), '<input id="hkNewWhere">') +
      field(c, c.esc(T(c, "site.support.ward", "Ward (blank for all)")), '<select id="hkNewWard">' + opts([["", ""]].concat(wards.map(function (w) { return [E(c, w.id), EN(c, E(c, w.name))]; })), "") + "</select>") +
      field(c, c.esc(T(c, "site.support.isolation", "Isolation type")), '<select id="hkNewIso">' + opts(ISO.map(function (k) { return [k, E(c, isoWord(c, k))]; }), "none") + "</select>") +
      field(c, c.esc(T(c, "site.support.hkNote", "Note")), '<input id="hkNewNote">') +
      '<button class="btn" type="button" data-sup="hkraise">' + c.esc(T(c, "site.support.raise", "Raise")) + '</button></div><div id="hkRaiseMsg"></div></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.support.turnaroundCard", "Turnaround")) + '</h2><div class="row">' + field(c, c.esc(T(c, "site.support.period", "Period")), '<select id="hkDays">' + opts([["7", c.esc(T(c, "site.support.last7", "Last 7 days"))], ["30", c.esc(T(c, "site.support.last30", "Last 30 days"))]], S.days) + "</select>") +
      '<button class="btn quiet" type="button" data-sup="hkreport">' + c.esc(T(c, "site.support.show", "Show")) + '</button></div><div id="hkReport"></div></div>' +
      (admin ? '<div class="card"><h2>' + c.esc(T(c, "site.support.bedReleaseCard", "Releasing a cleaned bed")) + '</h2><label><input type="checkbox" id="hkInspect"' + (settings(c).housekeepingInspection === true ? " checked" : "") + "> " +
        c.esc(T(c, "site.support.inspectSetting", "A discharged or transferred patient's bed goes to cleaning, and returns to available only after the clean is inspected")) + '</label> <button class="btn" type="button" data-sup="hksetting">' + c.esc(T(c, "site.support.save", "Save")) + '</button><div id="hkSetMsg"></div></div>' : "");
    var board = null;
    set("hkBoard", hkBoardHtml(c, null));
    c.api("/ward/housekeeping-board" + q).then(function (r) { board = r || { ok: false }; set("hkBoard", hkBoardHtml(c, board)); });
    var report = function () { set("hkReport", hkReportHtml(c, null)); c.api("/ward/housekeeping-report" + q + "&days=" + encodeURIComponent(S.days)).then(function (r) { set("hkReport", hkReportHtml(c, r || { ok: false })); }); };
    report();
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-sup]"); if (!b) return;
      var act = b.getAttribute("data-sup");
      if (act === "hkreport") { S.days = val("hkDays"); return report(); }
      if (act === "hkraise") return write(c, "housekeeping", "hkRaiseMsg", "/ward/housekeeping-task", { kind: val("hkNewKind"), location: val("hkNewWhere"), wardId: val("hkNewWard"), isolationType: val("hkNewIso"), note: val("hkNewNote") }, T(c, "site.support.taskRaised", "Task raised."));
      if (act === "hksetting") return saveSettings(c, "housekeeping", "hkSetMsg", { housekeepingInspection: checked("hkInspect") });
      if (act === "hk") {
        var step = b.getAttribute("data-step"), i = b.getAttribute("data-i"), body = { taskId: b.getAttribute("data-id") };
        if (step === "assign") { body.step = "assign"; if (val("hkKind" + i)) body.kind = val("hkKind" + i); if (val("hkIso" + i)) body.isolationType = val("hkIso" + i); }
        else if (step === "pass" || step === "fail") { body.step = "inspect"; body.result = step; if (step === "fail") { body.note = ask(c, T(c, "site.support.failWhat", "What has to be cleaned again?")); if (!body.note) return; } }
        else if (step === "cancel") { body.step = "cancel"; body.reason = ask(c, T(c, "site.support.cancelWhy", "Why is this task cancelled?")); if (!body.reason) return; }
        else body.step = step;
        return c.api("/ward/housekeeping-step", Object.assign({ orgId: c.state.orgId }, body)).then(function (r) {
          if (!r || (!r.ok && !r.written)) { set("hkMsg", refusalHtml(c, r)); return; }
          if (!r.ok) { set("hkMsg", '<div class="msg err">' + TS(c, "site.support.bedNotReleased", "The inspection is recorded, but the bed was not released. Release it on the bed board.") + "</div>"); }
          else c.toast(r.bedReleased ? T(c, "site.support.bedReleased", "Inspected. The bed is available.") : T(c, "site.support.stepSaved", "Recorded."));
          c.api("/ward/housekeeping-board" + q).then(function (x) { set("hkBoard", hkBoardHtml(c, x || { ok: false })); });
        });
      }
    };
  } });

  /* ================================================================ Ambulance */
  function tripKindWord(c, k) { return { "emergency-call": T(c, "site.support.trip.emergency", "Emergency call"), "inter-facility": T(c, "site.support.trip.transfer", "Transfer to another facility"), discharge: T(c, "site.support.trip.discharge", "Discharge journey"), pickup: T(c, "site.support.trip.pickup", "Pickup") }[k] || k; }
  function tripStateWord(c, s) { return { requested: T(c, "site.support.trip.requested", "Requested"), dispatched: T(c, "site.support.trip.dispatched", "Dispatched"), arrived: T(c, "site.support.trip.arrived", "At pickup"), departed: T(c, "site.support.trip.departed", "On the way"), completed: T(c, "site.support.trip.completed", "Handed over"), cancelled: T(c, "site.support.trip.cancelled", "Cancelled") }[s] || s; }
  function fitnessHtml(c, v) {
    var f = v.fitness || {};
    if (v.active === false) return pill("warn", c.esc(T(c, "site.support.outOfService", "Out of service")));
    if (f.expired && f.expired.length) return pill("stop", c.esc(T(c, "site.support.docsExpired", "Expired: {what}", { what: f.expired.map(function (k) { return k === "fitnessExpiry" ? T(c, "site.support.fitness", "fitness certificate") : T(c, "site.support.insurance", "insurance"); }).join(", ") })));
    if (f.dueSoon && f.dueSoon.length) return pill("warn", c.esc(T(c, "site.support.docsDue", "Due within 30 days: {what}", { what: f.dueSoon.map(function (k) { return k === "fitnessExpiry" ? T(c, "site.support.fitness", "fitness certificate") : T(c, "site.support.insurance", "insurance"); }).join(", ") })));
    return pill("ok", c.esc(T(c, "site.support.fit", "Fit")));
  }
  function tripTimes(c, t) {
    var x = t.times || {};
    return [["call", T(c, "site.support.t.call", "Call")], ["dispatch", T(c, "site.support.t.dispatch", "Dispatch")], ["arrival", T(c, "site.support.t.arrival", "Arrival")], ["departure", T(c, "site.support.t.departure", "Departure")], ["handover", T(c, "site.support.t.handover", "Handover")]]
      .filter(function (p) { return x[p[0]]; }).map(function (p) { return E(c, p[1]) + " " + at(c, x[p[0]]); }).join("<br>");
  }
  function transportHtml(c, b, duty) {
    if (b == null) return loading(c, T(c, "site.support.transportBoard", "the fleet and trips"));
    if (!b.ok) return failed(c, T(c, "site.support.transportBoard", "the fleet and trips")) + refusalHtml(c, b);
    var fit = b.vehicles.filter(function (v) { return v.fitness && v.fitness.ok; });
    var who = function (t) { var p = t.patientId && b.patients[t.patientId]; return p ? EN(c, E(c, (p.name || "") + " " + (p.mrn || ""))) : t.patientId ? c.esc(T(c, "site.support.nameUnread", "Name could not be read")) : ""; };
    var dutyList = duty == null ? loading(c, T(c, "site.support.onDuty", "who is on duty")) : !duty.ok ? '<div class="msg note">' + TS(c, "site.support.dutyUnread", "The rota could not be read; type the crew's staff ids.") + "</div>" : "";
    var h = "<h3>" + c.esc(T(c, "site.support.openTrips", "Open trips")) + "</h3>" + (b.open.length ? table([c.esc(T(c, "site.support.colTrip", "Trip")), c.esc(T(c, "site.support.colPatient", "Patient")), c.esc(T(c, "site.support.colRoute", "From and to")), c.esc(T(c, "site.support.colState", "State")), c.esc(T(c, "site.support.colTimes", "Times")), ""], b.open.map(function (t, i) {
      var id = E(c, t.id), btn = function (step, label) { return ' <button class="btn quiet" type="button" data-sup="trip" data-step="' + step + '" data-i="' + i + '" data-id="' + id + '">' + label + "</button>"; };
      var acts = "";
      if (t.state === "requested") {
        acts = '<select id="trVeh' + i + '" aria-label="' + c.esc(T(c, "site.support.vehicle", "Ambulance")) + '">' + opts(fit.map(function (v) { return [E(c, v.id), EN(c, E(c, v.registration + " " + v.vehicleClass + (v.callSign ? " " + v.callSign : "")))]; }), "") + "</select> " +
          ((duty && duty.ok ? duty.onDuty : []).map(function (d, j) { return '<label><input type="checkbox" data-crew="' + i + '" value="' + E(c, d.identity) + '"> ' + person(c, d.identity) + " " + EN(c, E(c, d.unit || "")) + "</label>"; }).join(" ")) +
          ' <input id="trCrew' + i + '" aria-label="' + c.esc(T(c, "site.support.crewIds", "Other crew staff ids, separated by commas")) + '" placeholder="' + c.esc(T(c, "site.support.crewIds", "Other crew staff ids, separated by commas")) + '">' + btn("dispatch", c.esc(T(c, "site.support.dispatch", "Dispatch")));
      }
      if (t.state === "dispatched") acts = btn("arrive", c.esc(T(c, "site.support.arrived", "Arrived at pickup")));
      if (t.state === "arrived") acts = btn("depart", c.esc(T(c, "site.support.departed", "Left pickup")));
      if (t.state === "departed") acts = '<input id="trKm' + i + '" inputmode="decimal" aria-label="' + c.esc(T(c, "site.support.km", "Distance (km)")) + '" placeholder="' + c.esc(T(c, "site.support.km", "Distance (km)")) + '">' + btn("handover", c.esc(T(c, "site.support.handedOver", "Handed over")));
      acts += btn("cancel", c.esc(T(c, "site.support.cancelTrip", "Cancel trip")));
      return "<tr" + (t.priority === "emergency" ? ' class="warn"' : "") + "><td>" + E(c, tripKindWord(c, t.kind)) + (t.registration ? "<br>" + EN(c, E(c, t.registration)) : "") + "</td><td>" + who(t) + "</td><td>" + EN(c, E(c, t.pickup + " / " + t.drop)) + "</td><td>" + E(c, tripStateWord(c, t.state)) +
        (t.crew ? "<br>" + t.crew.map(function (m) { return person(c, m.identity) + " " + (m.onRota === true ? pill("ok", c.esc(T(c, "site.support.onRota", "on the rota"))) : m.onRota === false ? pill("warn", c.esc(T(c, "site.support.notOnRota", "not on the rota"))) : pill("", c.esc(T(c, "site.support.rotaUnknown", "rota not read")))); }).join("<br>") : "") + "</td><td>" + tripTimes(c, t) + "</td><td>" + acts + "</td></tr>";
    })) : "<p>" + c.esc(T(c, "site.support.noOpenTrips", "No open trips.")) + "</p>") + dutyList;
    h += "<h3>" + c.esc(T(c, "site.support.fleet", "Fleet")) + "</h3>" + (b.vehicles.length ? table([c.esc(T(c, "site.support.registration", "Registration")), c.esc(T(c, "site.support.vehicleClass", "Type")), c.esc(T(c, "site.support.fitnessExpiry", "Fitness certificate expires")), c.esc(T(c, "site.support.insuranceExpiry", "Insurance expires")), c.esc(T(c, "site.support.colState", "State"))],
      b.vehicles.map(function (v) { return "<tr><td>" + EN(c, E(c, v.registration + (v.callSign ? " " + v.callSign : ""))) + "</td><td>" + E(c, v.vehicleClass) + "</td><td>" + at(c, v.fitnessExpiry) + "</td><td>" + at(c, v.insuranceExpiry) + "</td><td>" + fitnessHtml(c, v) + "</td></tr>"; })) : "<p>" + c.esc(T(c, "site.support.noVehicles", "No ambulances recorded.")) + "</p>");
    h += "<h3>" + c.esc(T(c, "site.support.recentTrips", "Recent trips")) + "</h3>" + (b.closed.length ? table([c.esc(T(c, "site.support.colTrip", "Trip")), c.esc(T(c, "site.support.colPatient", "Patient")), c.esc(T(c, "site.support.colRoute", "From and to")), c.esc(T(c, "site.support.colState", "State")), c.esc(T(c, "site.support.colTimes", "Times"))],
      b.closed.map(function (t) { return "<tr><td>" + E(c, tripKindWord(c, t.kind)) + "</td><td>" + who(t) + "</td><td>" + EN(c, E(c, t.pickup + " / " + t.drop)) + "</td><td>" + E(c, tripStateWord(c, t.state)) + (t.distanceKm != null ? " " + EN(c, E(c, t.distanceKm + " km")) : "") + "</td><td>" + tripTimes(c, t) + "</td></tr>"; })) : "<p>" + c.esc(T(c, "site.support.noRecentTrips", "No finished trips yet.")) + "</p>");
    return h;
  }
  WSQ.page("transport", { render: function (c) {
    var el = c.el, q = "?orgId=" + encodeURIComponent(c.state.orgId);
    if (!c.can("transport.dispatch")) { el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.transportTitle", "Ambulance")) + "</h1></div>" + noRole(c); return; }
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.transportTitle", "Ambulance")) + "</h1></div>" +
      '<div class="card"><h2>' + c.esc(T(c, "site.support.requestTrip", "Request a trip")) + '</h2><div class="row">' +
      field(c, c.esc(T(c, "site.support.colTrip", "Trip")), '<select id="trKind">' + opts(["emergency-call", "inter-facility", "discharge", "pickup"].map(function (k) { return [k, E(c, tripKindWord(c, k))]; }), "emergency-call") + "</select>") +
      field(c, c.esc(T(c, "site.support.pickupAt", "Pick up from")), '<input id="trPickup">') + field(c, c.esc(T(c, "site.support.dropAt", "Take to")), '<input id="trDrop">') +
      field(c, c.esc(T(c, "site.support.stayLink", "Admitted patient (needed for a transfer or discharge)")), '<select id="trStay"><option value="">' + c.esc(T(c, "site.support.loadingPatients", "Loading patients...")) + "</option></select>") +
      field(c, c.esc(T(c, "site.support.hkNote", "Note")), '<input id="trNote">') + '<button class="btn" type="button" data-sup="tripnew">' + c.esc(T(c, "site.support.request", "Request")) + '</button></div><div id="trNewMsg"></div></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.support.tripsCard", "Trips and fleet")) + '</h2><div id="trMsg"></div><div id="trBoard"></div>' +
      "<h3>" + c.esc(T(c, "site.support.addVehicle", "Add or update an ambulance")) + '</h3><div class="row">' + field(c, c.esc(T(c, "site.support.registration", "Registration")), '<input id="avReg">') +
      field(c, c.esc(T(c, "site.support.vehicleClass", "Type")), '<select id="avClass"><option value="BLS">BLS</option><option value="ALS">ALS</option></select>') + field(c, c.esc(T(c, "site.support.callSign", "Call sign")), '<input id="avCall">') +
      field(c, c.esc(T(c, "site.support.fitnessExpiry", "Fitness certificate expires")), '<input id="avFit" type="date">') + field(c, c.esc(T(c, "site.support.insuranceExpiry", "Insurance expires")), '<input id="avIns" type="date">') +
      '<label><input type="checkbox" id="avOut"> ' + c.esc(T(c, "site.support.outOfService", "Out of service")) + '</label><button class="btn" type="button" data-sup="vehicle">' + c.esc(T(c, "site.support.save", "Save")) + '</button></div><div id="avMsg"></div></div>';
    var board = null, duty = null, paint = function () { set("trBoard", transportHtml(c, board, duty)); };
    paint();
    c.api("/ward/transport-board" + q).then(function (r) { board = r || { ok: false }; paint(); });
    c.api("/roster/on-duty" + q).then(function (r) { duty = r && r.ok ? r : { ok: false }; paint(); });
    c.api("/ward/list" + q).then(function (r) {
      var sel = document.getElementById("trStay"); if (!sel) return;
      sel.innerHTML = !r || !r.ok ? '<option value="">' + c.esc(WSQ.tooManyOpen(r) || T(c, "site.support.patientsFailed", "Patients could not be loaded")) + "</option>" : '<option value="">' + c.esc(T(c, "site.support.noStay", "No admitted patient")) + "</option>" + (r.patients || []).map(function (p) { return '<option value="' + E(c, p.encounterId) + '">' + EN(c, E(c, (p.ward || "") + " " + (p.bed || "") + ", " + (p.name || "") + " " + (p.mrn || ""))) + "</option>"; }).join("");
    });
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-sup]"); if (!b) return;
      var act = b.getAttribute("data-sup");
      if (act === "tripnew") return write(c, "transport", "trNewMsg", "/ward/ambulance-trip", { trip: { kind: val("trKind"), pickup: val("trPickup"), drop: val("trDrop"), encounterId: val("trStay"), note: val("trNote") } }, T(c, "site.support.tripRequested", "Trip requested."));
      if (act === "vehicle") return write(c, "transport", "avMsg", "/ward/ambulance-vehicle", { vehicle: { registration: val("avReg"), vehicleClass: val("avClass"), callSign: val("avCall"), fitnessExpiry: val("avFit"), insuranceExpiry: val("avIns"), active: !checked("avOut") } }, T(c, "site.support.vehicleSaved", "Ambulance saved."));
      if (act === "trip") {
        var step = b.getAttribute("data-step"), i = b.getAttribute("data-i"), body = { tripId: b.getAttribute("data-id"), step: step };
        if (step === "dispatch") {
          var crew = []; var boxes = el.querySelectorAll ? el.querySelectorAll('[data-crew="' + i + '"]') : [];
          for (var k = 0; k < boxes.length; k++) if (boxes[k].checked) crew.push(boxes[k].value);
          body.vehicleId = val("trVeh" + i); body.crew = crew.concat(val("trCrew" + i).split(",").map(function (s) { return s.trim(); }).filter(Boolean));
        }
        if (step === "handover") body.distanceKm = val("trKm" + i);
        if (step === "cancel") { body.reason = ask(c, T(c, "site.support.cancelTripWhy", "Why is this trip cancelled?")); if (!body.reason) return; }
        return write(c, "transport", "trMsg", "/ward/ambulance-trip-step", body, T(c, "site.support.stepSaved", "Recorded."));
      }
    };
  } });

  /* ================================================================ Mortuary */
  function mlcHtml(c, m) {
    var f = m && m.flag;
    return f === true ? pill("stop", c.esc(T(c, "site.support.mlcYes", "Medico-legal case"))) : f === false ? pill("ok", c.esc(T(c, "site.support.mlcNo", "Not medico-legal"))) : pill("warn", c.esc(T(c, "site.support.mlcUnknown", "Medico-legal status not recorded")));
  }
  function pmWord(c, p) { var r = p && p.required; return r === "yes" ? T(c, "site.support.pmYes", "Post-mortem required") : r === "no" ? T(c, "site.support.pmNo", "No post-mortem") : T(c, "site.support.pmUndecided", "Post-mortem not decided"); }
  function belongingsList(text) { return String(text || "").split("\n").map(function (line) { var m = /^(.*?)\s*x\s*(\d+)\s*$/i.exec(line.trim()); return m ? { item: m[1], quantity: Number(m[2]) } : { item: line.trim(), quantity: 1 }; }).filter(function (x) { return x.item; }); }
  function mortuaryHtml(c, b, S) {
    if (b == null) return loading(c, T(c, "site.support.mortuaryRegister", "the mortuary register"));
    if (!b.ok) return failed(c, T(c, "site.support.mortuaryRegister", "the mortuary register")) + refusalHtml(c, b);
    var warn = (b.warnings || []).map(function (w) { return '<div class="msg err">' + EN(c, c.esc(w)) + "</div>"; }).join("");
    var free = b.chambers.filter(function (x) { return !x.caseId; }).map(function (x) { return [E(c, x.chamber), EN(c, E(c, x.chamber))]; });
    var chamberOpts = [["", c.esc(T(c, "site.support.noChamber", "No chamber yet"))]].concat(free);
    var h = warn + "<h3>" + c.esc(T(c, "site.support.chambers", "Cold chambers")) + "</h3>" + (b.chambers.length ? "<p>" + b.chambers.map(function (x) { return pill(x.caseId ? "warn" : "ok", EN(c, E(c, x.chamber)) + " " + (x.caseId ? c.esc(T(c, "site.support.occupied", "occupied")) : c.esc(T(c, "site.support.free", "free")))); }).join(" ") + "</p>" : '<div class="msg note">' + TS(c, "site.support.noChambers", "This hospital has not listed its cold chambers. An administrator lists them below.") + "</div>");
    h += "<h3>" + c.esc(T(c, "site.support.awaiting", "Deaths recorded, body not yet received")) + "</h3>" + (b.awaiting.length ? '<div class="row">' +
      field(c, c.esc(T(c, "site.support.patient", "Patient")), '<select id="moPat">' + opts(b.awaiting.map(function (p) { return [E(c, p.patientId), EN(c, E(c, (p.name || "") + " " + (p.mrn || "") + ", " + String(p.deceasedAt || "").slice(0, 16).replace("T", " ")))]; }), "") + "</select>") +
      field(c, c.esc(T(c, "site.support.broughtBy", "Brought by")), '<input id="moBrought">') + field(c, c.esc(T(c, "site.support.identifiedBy", "Identified against the wristband by")), '<input id="moIdent">') +
      field(c, c.esc(T(c, "site.support.chamber", "Chamber")), '<select id="moCh">' + opts(chamberOpts, "") + "</select>") +
      field(c, c.esc(T(c, "site.support.belongings", "Belongings, one per line as item x quantity")), '<textarea id="moBel" rows="3"></textarea>') +
      '<button class="btn" type="button" data-sup="moreceive">' + c.esc(T(c, "site.support.receiveBody", "Receive body")) + "</button></div>" : "<p>" + c.esc(T(c, "site.support.noneAwaiting", "None.")) + "</p>");
    h += "<h3>" + c.esc(T(c, "site.support.held", "Bodies held")) + "</h3>" + (b.held.length ? table([c.esc(T(c, "site.support.colPatient", "Patient")), c.esc(T(c, "site.support.colReceived", "Received")), c.esc(T(c, "site.support.chamber", "Chamber")), c.esc(T(c, "site.support.colStatus", "Medico-legal and post-mortem")), c.esc(T(c, "site.support.belongingsShort", "Belongings")), ""], b.held.map(function (x, i) {
      var needs = (x.releaseNeeds || []).map(function (m) { return missingText(c, m); }).join(", ");
      return "<tr><td>" + EN(c, E(c, (x.name || "") + " " + (x.mrn || ""))) + "<br>" + c.esc(T(c, "site.support.died", "Died {at}", { at: String(x.deceasedAt || "").slice(0, 16).replace("T", " ") })) + "</td><td>" + at(c, x.receivedAt) + "<br>" + EN(c, E(c, x.broughtBy)) + "</td>" +
        "<td>" + (x.chamber ? EN(c, E(c, x.chamber)) : pill("warn", c.esc(T(c, "site.support.noChamber", "No chamber yet")))) + '<br><select id="moMove' + i + '" aria-label="' + c.esc(T(c, "site.support.chamber", "Chamber")) + '">' + opts(free, "") + '</select> <button class="btn quiet" type="button" data-sup="momove" data-i="' + i + '" data-id="' + E(c, x.id) + '">' + c.esc(T(c, "site.support.move", "Move")) + "</button></td>" +
        "<td>" + mlcHtml(c, x.mlc) + "<br>" + E(c, pmWord(c, x.postMortem)) + '<br><select id="moPm' + i + '" aria-label="' + c.esc(T(c, "site.support.pm", "Post-mortem")) + '">' + opts([["undecided", E(c, pmWord(c, {}))], ["yes", E(c, pmWord(c, { required: "yes" }))], ["no", E(c, pmWord(c, { required: "no" }))]], x.postMortem && x.postMortem.required) + "</select>" +
        ' <input id="moPmBy' + i + '" aria-label="' + c.esc(T(c, "site.support.pmBy", "Decided by (police, magistrate or treating doctor)")) + '" placeholder="' + c.esc(T(c, "site.support.pmBy", "Decided by (police, magistrate or treating doctor)")) + '"> <input id="moPmWhy' + i + '" aria-label="' + c.esc(T(c, "site.support.reason", "Reason")) + '" placeholder="' + c.esc(T(c, "site.support.reason", "Reason")) + '"> <button class="btn quiet" type="button" data-sup="mopm" data-i="' + i + '" data-id="' + E(c, x.id) + '">' + c.esc(T(c, "site.support.save", "Save")) + "</button></td>" +
        "<td>" + EN(c, E(c, (x.belongings || []).map(function (it) { return it.item + " x " + it.quantity; }).join(", "))) + "</td><td>" + (needs ? c.esc(T(c, "site.support.releaseNeeds", "Release will need: {list}", { list: needs })) + "<br>" : "") + '<button class="btn quiet" type="button" data-sup="moreleaseopen" data-id="' + E(c, x.id) + '">' + c.esc(T(c, "site.support.release", "Release")) + "</button></td></tr>";
    })) : "<p>" + c.esc(T(c, "site.support.noneHeld", "No body is held.")) + "</p>");
    var rel = S.release && b.held.filter(function (x) { return x.id === S.release; })[0];
    if (rel) {
      var box = function (id, label) { return '<label><input type="checkbox" id="' + id + '"> ' + label + "</label>"; };
      h += '<h3 id="moRelHead">' + c.esc(T(c, "site.support.releaseOf", "Release {name}", { name: rel.name || "" })) + "</h3>" + mlcHtml(c, rel.mlc) + '<div class="row">' +
        field(c, c.esc(T(c, "site.support.releasedTo", "Released to")), '<select id="mrTo">' + opts([["relatives", c.esc(T(c, "site.support.relatives", "Relatives"))], ["police", c.esc(T(c, "site.support.police", "Police"))]], "relatives") + "</select>") +
        field(c, c.esc(T(c, "site.support.receiverName", "Receiver's name")), '<input id="mrName">') + field(c, c.esc(T(c, "site.support.relationship", "Relationship")), '<input id="mrRel">') +
        field(c, c.esc(T(c, "site.support.idProof", "Identity proof")), '<select id="mrIdType">' + opts([["aadhaar", c.esc(T(c, "site.support.aadhaar", "Aadhaar"))], ["voter-id", c.esc(T(c, "site.support.voterId", "Voter ID"))], ["passport", c.esc(T(c, "site.support.passport", "Passport"))], ["driving-licence", c.esc(T(c, "site.support.drivingLicence", "Driving licence"))], ["police-id", c.esc(T(c, "site.support.policeId", "Police ID"))], ["other", c.esc(T(c, "site.support.other", "Other"))]], "aadhaar") + "</select>") +
        field(c, c.esc(T(c, "site.support.idNumber", "Identity proof number")), '<input id="mrIdNo" autocomplete="off">') +
        (rel.mlc && rel.mlc.flag === null ? field(c, c.esc(T(c, "site.support.mlcConfirmedBy", "Confirmed not medico-legal with (name)")), '<input id="mrMlcBy">') : "") + "</div><p>" +
        box("mrIdentified", c.esc(T(c, "site.support.receiverIdentified", "The receiver identified the body"))) + " " + box("mrDc", c.esc(T(c, "site.support.docDeathCert", "Death certificate handed over"))) + " " +
        box("mrNoc", c.esc(T(c, "site.support.docNoc", "Police no-objection certificate received"))) + " " + box("mrPm", c.esc(T(c, "site.support.docPm", "Post-mortem report received"))) + " " + box("mrBel", c.esc(T(c, "site.support.docBelongings", "Belongings handed over and signed for"))) +
        '</p><button class="btn" type="button" data-sup="morelease" data-id="' + E(c, rel.id) + '">' + c.esc(T(c, "site.support.confirmRelease", "Release body")) + "</button>";
    }
    h += "<h3>" + c.esc(T(c, "site.support.released", "Released")) + "</h3>" + (b.released.length ? "<ul>" + b.released.map(function (x) { return "<li>" + EN(c, E(c, (x.name || "") + " " + (x.mrn || "") + ", " + (x.release && x.release.receiverName || ""))) + " " + at(c, x.release && x.release.at) + "</li>"; }).join("") + "</ul>" : "<p>" + c.esc(T(c, "site.support.noneReleased", "None yet.")) + "</p>");
    return h;
  }
  WSQ.page("mortuary", { render: function (c) {
    var el = c.el, q = "?orgId=" + encodeURIComponent(c.state.orgId), admin = c.can("staff.admin");
    var S = c.state._mort = c.state._mort || {};
    if (!c.can("mortuary.manage")) { el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.mortuaryTitle", "Mortuary")) + "</h1></div>" + noRole(c); return; }
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.support.mortuaryTitle", "Mortuary")) + '</h1></div><div class="card"><div id="moMsg"></div><div id="moBoard"></div></div>' +
      (admin ? '<div class="card"><h2>' + c.esc(T(c, "site.support.chambers", "Cold chambers")) + "</h2>" + field(c, c.esc(T(c, "site.support.chambersList", "Chambers, one per line")), '<textarea id="moChambers" rows="4">' + E(c, (settings(c).mortuaryChambers || []).join("\n")) + "</textarea>") +
        '<button class="btn" type="button" data-sup="mochambers">' + c.esc(T(c, "site.support.save", "Save")) + '</button><div id="moSetMsg"></div></div>' : "");
    var board = null, paint = function () { set("moBoard", mortuaryHtml(c, board, S)); };
    paint();
    c.api("/ward/mortuary-board" + q).then(function (r) { board = r || { ok: false }; paint(); });
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-sup]"); if (!b) return;
      var act = b.getAttribute("data-sup"), id = b.getAttribute("data-id"), i = b.getAttribute("data-i");
      if (act === "moreceive") return write(c, "mortuary", "moMsg", "/ward/mortuary-receive", { patientId: val("moPat"), broughtBy: val("moBrought"), identifiedBy: val("moIdent"), chamber: val("moCh"), belongings: belongingsList(val("moBel")) }, T(c, "site.support.bodyReceived", "Body received."));
      if (act === "momove") return write(c, "mortuary", "moMsg", "/ward/mortuary-update", { caseId: id, chamber: val("moMove" + i) }, T(c, "site.support.stepSaved", "Recorded."));
      if (act === "mopm") return write(c, "mortuary", "moMsg", "/ward/mortuary-update", { caseId: id, postMortem: { required: val("moPm" + i), orderedBy: val("moPmBy" + i), reason: val("moPmWhy" + i) } }, T(c, "site.support.stepSaved", "Recorded."));
      if (act === "moreleaseopen") { S.release = id; paint(); return; }
      if (act === "morelease") return write(c, "mortuary", "moMsg", "/ward/mortuary-release", { caseId: id, release: { to: val("mrTo"), receiverName: val("mrName"), relationship: val("mrRel"), idProofType: val("mrIdType"), idProofNumber: val("mrIdNo"), bodyIdentified: checked("mrIdentified"), mlcConfirmedNotBy: val("mrMlcBy"),
        documents: { deathCertificate: checked("mrDc"), policeNoc: checked("mrNoc"), postMortemReport: checked("mrPm"), belongingsHandedOver: checked("mrBel") } } }, T(c, "site.support.bodyReleased", "Body released."), function () { S.release = null; });
      if (act === "mochambers") return saveSettings(c, "mortuary", "moSetMsg", { mortuaryChambers: val("moChambers").split("\n").map(function (s) { return s.trim(); }).filter(Boolean) });
    };
  } });

  WSQ._support = { mealBoardHtml: mealBoardHtml, dietHistoryHtml: dietHistoryHtml, cssdHtml: cssdHtml, hkBoardHtml: hkBoardHtml, hkReportHtml: hkReportHtml, transportHtml: transportHtml, mortuaryHtml: mortuaryHtml, refusalHtml: refusalHtml };
})();
