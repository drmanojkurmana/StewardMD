/* wardsynq/site/pages/engage.js - patient engagement in the Admin Center: Patient communication (settings, what is
 * missing before each message can go, consent recorded at the desk, the delivery log), Online booking (the sessions
 * the hospital publishes to the portal) and Patient feedback (survey questions, results by department, the
 * service-recovery queue). Buildless ES5; exposes WSQ._engage for admin.js.
 *
 * Every save goes to a real route: /org/update for settings (merged one level into wardsynq), and
 * /api/queue/ward/comm-* and feedback-* (functions/_wardsynq/patient-messaging.js, patient-feedback.js).
 * "Sent" on this screen means the provider accepted the message; delivery to the phone is not confirmed and it says so.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  function q(c) { return "?orgId=" + encodeURIComponent(c.state.orgId); }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function checked(id) { var e = document.getElementById(id); return !!(e && e.checked); }
  function set(id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; }
  function loading(c) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.engage.loading", "Loading...")) + "</p>"; }
  function failed(c, r) { return '<div class="msg err">' + TS(c, "site.engage.loadFailed", "Could not load this. Do not read it as none.") + (r && r.message ? " " + EN(c, c.esc(r.message)) : "") + "</div>"; }
  function refusal(c, r) { return !r ? T(c, "site.engage.noResponse", "No response from the server.") : (r.message || r.detail || r.error || T(c, "site.engage.failed", "failed")); }
  function say(c, id, r, okText) { set(id, '<div class="msg ' + (r && r.ok ? "ok" : "err") + '">' + (r && r.ok ? c.esc(okText) : EN(c, c.esc(refusal(c, r)))) + "</div>"); }
  function wsq(c) { return (c.state.org && c.state.org.wardsynq) || {}; }
  function saveSetting(c, key, value, msgId, then) {
    var patch = {}; patch[key] = value;
    return c.api("/org/update", { orgId: c.state.orgId, wardsynq: patch }).then(function (r) {
      if (r && r.ok && r.org) c.state.org = r.org;
      say(c, msgId, r, T(c, "site.engage.saved", "Saved."));
      if (r && r.ok && then) then();
    });
  }
  function when(iso) { return iso ? String(new Date(Date.parse(iso) + 330 * 60000).toISOString()).slice(0, 16).replace("T", " ") : ""; }

  /* ---- Patient communication --------------------------------------------------------------------------------- */

  function typeLabel(c, k) {
    return { appointment: T(c, "site.engage.type.appointment", "Appointment reminder"), labReady: T(c, "site.engage.type.labReady", "Lab result ready"),
      followUp: T(c, "site.engage.type.followUp", "Follow-up due"), refill: T(c, "site.engage.type.refill", "Medicine running out"), feedback: T(c, "site.engage.type.feedback", "Feedback survey") }[k] || k;
  }
  function statusLabel(c, s) {
    return { queued: T(c, "site.engage.st.queued", "Waiting to send"), sent: T(c, "site.engage.st.sent", "Accepted by the provider"), failed: T(c, "site.engage.st.failed", "Failed"),
      retrying: T(c, "site.engage.st.retrying", "Failed, will try again"), skipped: T(c, "site.engage.st.skipped", "Not sent"), expired: T(c, "site.engage.st.expired", "Expired, not sent late"),
      held_quiet_hours: T(c, "site.engage.st.held", "Held for quiet hours") }[s] || s;
  }
  function reasonLabel(c, s) {
    return { NO_CONSENT: T(c, "site.engage.why.noConsent", "The patient has not opted in"), OPTED_OUT: T(c, "site.engage.why.optedOut", "The patient opted out"),
      SMS_NOT_CONFIGURED: T(c, "site.engage.why.smsOff", "SMS is not set up"), WHATSAPP_NOT_CONFIGURED: T(c, "site.engage.why.waOff", "WhatsApp is not connected"),
      TEMPLATE_NOT_SET: T(c, "site.engage.why.noTemplate", "No template for this message type"), PROVIDER_REFUSED: T(c, "site.engage.why.refused", "The provider refused it"),
      PROVIDER_UNREACHABLE: T(c, "site.engage.why.unreachable", "The provider could not be reached"), PROVIDER_HELD: T(c, "site.engage.why.held", "WhatsApp held it for quality review"),
      PROVIDER_PAUSED: T(c, "site.engage.why.paused", "WhatsApp paused this template"), QUIET_HOURS: T(c, "site.engage.why.quiet", "Quiet hours"), EXPIRED: T(c, "site.engage.why.expired", "Its moment passed"),
      TYPE_TURNED_OFF: T(c, "site.engage.why.typeOff", "This message type was turned off"), SEND_ERROR: T(c, "site.engage.why.error", "The send could not run") }[s] || s;
  }
  var TYPES = ["appointment", "labReady", "followUp", "refill", "feedback"];
  var COMMS = { log: null, filter: "", pref: null, run: null };

  function settingsHtml(c) {
    var esc = c.esc, pc = wsq(c).patientComms || {}, types = pc.types || {}, quiet = pc.quietHours || {};
    var channels = (pc.channels || ["whatsapp", "sms"]).join(",");
    var chOpt = function (v, label) { return '<option value="' + v + '"' + (channels === v ? " selected" : "") + ">" + esc(label) + "</option>"; };
    return '<div class="card"><h2>' + c.ms("sms") + " " + esc(T(c, "site.engage.comms.title", "Messages to patients")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.engage.comms.intro", "Reminders go only to patients who opted in to a channel, never during quiet hours, and carry no diagnosis, test, medicine or name. Each message type needs its own DLT template name (SMS) or approved WhatsApp template.")) + "</p>" +
      '<label class="f"><input id="pcOn" type="checkbox"' + (pc.enabled === true ? " checked" : "") + "> " + esc(T(c, "site.engage.comms.enabled", "Send patient messages")) + "</label>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.engage.comms.quietFrom", "Quiet hours from")) + '</span><input id="pcQs" type="time" value="' + esc(quiet.start || "21:00") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.engage.comms.quietTo", "until")) + '</span><input id="pcQe" type="time" value="' + esc(quiet.end || "08:00") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.engage.comms.channels", "Channel")) + '</span><select id="pcCh">' + chOpt("whatsapp,sms", T(c, "site.engage.comms.waFirst", "WhatsApp, else SMS")) + chOpt("sms,whatsapp", T(c, "site.engage.comms.smsFirst", "SMS, else WhatsApp")) +
      chOpt("sms", T(c, "site.engage.comms.smsOnly", "SMS only")) + chOpt("whatsapp", T(c, "site.engage.comms.waOnly", "WhatsApp only")) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.engage.comms.portalUrl", "Patient portal address (for links)")) + '</span><input id="pcUrl" value="' + esc(pc.portalUrl || (location.origin + "/wardsynq/site/portal.html")) + '"></label></div>' +
      '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.engage.comms.colType", "Message")) + "</th><th>" + esc(T(c, "site.engage.comms.colOn", "On")) + "</th><th>" + esc(T(c, "site.engage.comms.colSms", "SMS DLT template name")) + "</th><th>" +
      esc(T(c, "site.engage.comms.colWa", "WhatsApp template")) + "</th><th>" + esc(T(c, "site.engage.comms.colLang", "Template language")) + "</th><th>" + esc(T(c, "site.engage.comms.colWhen", "When")) + "</th></tr></thead><tbody>" +
      TYPES.map(function (k) {
        var t = types[k] || {};
        var whenCell = k === "appointment" ? '<input id="pcW_' + k + '" style="max-width:8em" value="' + esc((t.offsetsHours || [24, 2]).join(", ")) + '"> ' + esc(T(c, "site.engage.comms.hoursBefore", "hours before"))
          : k === "followUp" || k === "refill" ? '<input id="pcW_' + k + '" type="number" min="0" max="30" style="max-width:5em" value="' + esc(t.daysBefore != null ? t.daysBefore : (k === "refill" ? 3 : 2)) + '"> ' + esc(T(c, "site.engage.comms.daysBefore", "days before"))
          : "";
        return "<tr><td>" + esc(typeLabel(c, k)) + '</td><td><input id="pcE_' + k + '" type="checkbox"' + (t.enabled === true ? " checked" : "") + '></td><td><input id="pcS_' + k + '" value="' + esc(t.smsTemplate || "") + '"></td>' +
          '<td><input id="pcA_' + k + '" value="' + esc(t.whatsappTemplate || "") + '"></td><td><input id="pcL_' + k + '" style="max-width:5em" value="' + esc(t.whatsappLanguage || "en") + '"></td><td>' + whenCell + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<button class="btn primary" type="button" data-pc="save">' + esc(T(c, "site.engage.save", "Save")) + '</button><div id="pcSaveMsg" aria-live="polite"></div></div>';
  }

  function readinessHtml(c, r) {
    var esc = c.esc;
    if (r === null) return '<div class="card">' + loading(c) + "</div>";
    if (!r || !r.ok) return '<div class="card">' + failed(c, r) + "</div>";
    var h = '<div class="card"><h2>' + esc(T(c, "site.engage.ready.title", "What is connected")) + "</h2>" +
      "<p><b>" + esc(T(c, "site.engage.ready.sms", "SMS")) + ":</b> " + (r.smsMissing.length ? EN(c, esc(r.smsMissing.join(" "))) : esc(T(c, "site.engage.ready.smsOk", "Set up (2Factor DLT, with the sender ID from the critical-result alert settings)."))) + "</p>" +
      "<p><b>" + esc(T(c, "site.engage.ready.wa", "WhatsApp")) + ":</b> " + esc(r.whatsappConnected ? T(c, "site.engage.ready.waOk", "Connected.") : T(c, "site.engage.ready.waOff", "Not connected. Add it on Admin Center > Integrations (WhatsApp Business); the access token is stored encrypted and never shown again.")) + "</p>" +
      "<ul>" + TYPES.map(function (k) {
        var x = r.readiness[k];
        if (!x.enabled) return "<li>" + esc(typeLabel(c, k)) + ": " + esc(T(c, "site.engage.ready.off", "off")) + "</li>";
        return "<li>" + esc(typeLabel(c, k)) + ": " + esc(T(c, "site.engage.ready.smsLabel", "SMS")) + " " + (x.sms.length ? EN(c, esc(x.sms.join(" "))) : esc(T(c, "site.engage.ready.okShort", "ready"))) + "; " +
          esc(T(c, "site.engage.ready.waLabel", "WhatsApp")) + " " + (x.whatsapp.length ? EN(c, esc(x.whatsapp.join(" "))) : esc(T(c, "site.engage.ready.okShort", "ready"))) + "</li>";
      }).join("") + "</ul></div>";
    return h;
  }

  function consentHtml(c, s) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + esc(T(c, "site.engage.consent.title", "Consent to be messaged")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.engage.consent.intro", "Record what the patient agreed to, the number they gave and how (for example the signed consent form). Patients can also change this themselves in the portal.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.engage.consent.patientId", "Patient ID")) + '</span><input id="pcPid" value="' + esc(s.pid || "") + '"></label><button class="btn" type="button" data-pc="pref-load">' + esc(T(c, "site.engage.show", "Show")) + "</button></div>";
    if (s.pref === null) return h + loading(c) + "</div>";
    if (s.pref === undefined) return h + "</div>";
    if (!s.pref.ok) return h + failed(c, s.pref) + "</div>";
    var p = s.pref.preference;
    ["sms", "whatsapp"].forEach(function (ch) {
      var x = p.channels[ch];
      h += "<h3>" + esc(ch === "sms" ? T(c, "site.engage.ready.sms", "SMS") : T(c, "site.engage.ready.wa", "WhatsApp")) + "</h3><p>" +
        esc(x.optedIn ? T(c, "site.engage.consent.in", "Opted in on {number}, {when}.", { number: x.mobile, when: when(x.at) }) : x.at ? T(c, "site.engage.consent.out", "Opted out, {when}.", { when: when(x.at) }) : T(c, "site.engage.consent.never", "Never asked.")) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.engage.consent.mobile", "Mobile number")) + '</span><input id="pcM_' + ch + '" inputmode="tel"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.engage.consent.how", "How consent was given or withdrawn")) + '</span><input id="pcN_' + ch + '" maxlength="200"></label>' +
        '<button class="btn" type="button" data-pc="pref-in" data-ch="' + ch + '">' + esc(T(c, "site.engage.consent.optIn", "Record opt-in")) + '</button> <button class="btn ghost" type="button" data-pc="pref-out" data-ch="' + ch + '">' + esc(T(c, "site.engage.consent.optOut", "Record opt-out")) + "</button></div>";
    });
    return h + '<div id="pcPrefMsg" aria-live="polite"></div></div>';
  }

  function logHtml(c, s) {
    var esc = c.esc, r = s.log;
    var filters = [["", T(c, "site.engage.log.all", "All")], ["problems", T(c, "site.engage.log.problems", "Not sent or failed")], ["sent", T(c, "site.engage.st.sent", "Accepted by the provider")], ["queued", T(c, "site.engage.st.queued", "Waiting to send")], ["held_quiet_hours", T(c, "site.engage.st.held", "Held for quiet hours")]];
    var h = '<div class="card"><h2>' + esc(T(c, "site.engage.log.title", "Delivery log")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.engage.log.note", "Accepted by the provider means the SMS or WhatsApp service took the message. Delivery to the phone is not confirmed by WardSynQ.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.engage.log.show", "Show")) + '</span><select id="pcFilter">' + filters.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === s.filter ? " selected" : "") + ">" + esc(f[1]) + "</option>"; }).join("") + "</select></label>" +
      '<button class="btn primary" type="button" data-pc="run">' + esc(T(c, "site.engage.log.runNow", "Send what is due now")) + '</button></div><div id="pcRunMsg" aria-live="polite"></div>';
    if (r === null) return h + loading(c) + "</div>";
    if (!r || !r.ok) return h + failed(c, r) + "</div>";
    if (r.partial) h += '<div class="msg note">' + esc(T(c, "site.engage.log.partial", "Only the newest messages are listed.")) + "</div>";
    if (!r.messages.length) return h + "<p>" + esc(T(c, "site.engage.log.none", "No messages match.")) + "</p></div>";
    return h + '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.engage.log.colDue", "Due")) + "</th><th>" + esc(T(c, "site.engage.comms.colType", "Message")) + "</th><th>" + esc(T(c, "site.engage.consent.patientId", "Patient ID")) + "</th><th>" +
      esc(T(c, "site.engage.comms.channels", "Channel")) + "</th><th>" + esc(T(c, "site.engage.log.colStatus", "Status")) + "</th><th>" + esc(T(c, "site.engage.log.colAttempts", "Attempts")) + "</th><th></th></tr></thead><tbody>" +
      r.messages.map(function (m) {
        var bad = m.status === "failed" || m.status === "retrying" || m.status === "skipped";
        return "<tr" + (bad ? ' class="warn"' : "") + "><td>" + esc(when(m.dueAt)) + "</td><td>" + esc(typeLabel(c, m.type)) + '</td><td class="mono">' + EN(c, esc(m.patientId)) + "</td><td>" + esc(m.channel === "sms" ? T(c, "site.engage.ready.sms", "SMS") : m.channel === "whatsapp" ? T(c, "site.engage.ready.wa", "WhatsApp") : "") + (m.to ? " " + EN(c, esc(m.to)) : "") + "</td><td>" +
          esc(statusLabel(c, m.status)) + (m.sentAt ? '<br><span class="quiet">' + esc(when(m.sentAt)) + "</span>" : "") + (m.reason ? "<br>" + esc(reasonLabel(c, m.reason)) : "") + (m.detail ? '<br><span class="quiet">' + EN(c, esc(m.detail)) + "</span>" : "") + "</td><td>" + m.attempts + "</td><td>" +
          (bad ? '<button class="btn ghost" type="button" data-pc="retry" data-id="' + esc(m.id) + '">' + esc(T(c, "site.engage.log.retry", "Try again")) + "</button>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
  }

  function renderComms(c, body) {
    var s = COMMS;
    var draw = function () { body.innerHTML = settingsHtml(c) + readinessHtml(c, s.log) + consentHtml(c, s) + logHtml(c, s); };
    var load = function () { s.log = null; draw(); c.api("/ward/comm-log" + q(c) + (s.filter ? "&status=" + encodeURIComponent(s.filter) : "")).then(function (r) { s.log = r || { ok: false }; draw(); }); };
    body.onchange = function (ev) { if (ev.target && ev.target.id === "pcFilter") { s.filter = ev.target.value; load(); } };
    body.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-pc]"); if (!b) return;
      var act = b.getAttribute("data-pc");
      if (act === "save") {
        var types = {};
        TYPES.forEach(function (k) {
          types[k] = { enabled: checked("pcE_" + k), smsTemplate: val("pcS_" + k), whatsappTemplate: val("pcA_" + k), whatsappLanguage: val("pcL_" + k) || "en" };
          if (k === "appointment") types[k].offsetsHours = val("pcW_" + k).split(/[ ,]+/).map(Number).filter(function (n) { return n > 0; });
          if (k === "followUp" || k === "refill") types[k].daysBefore = Number(val("pcW_" + k));
        });
        return saveSetting(c, "patientComms", { enabled: checked("pcOn"), quietHours: { start: val("pcQs"), end: val("pcQe") }, channels: val("pcCh").split(","), portalUrl: val("pcUrl"), types: types }, "pcSaveMsg", load);
      }
      if (act === "run") {
        b.disabled = true;
        return c.api("/ward/comm-run", { orgId: c.state.orgId }).then(function (r) {
          b.disabled = false;
          say(c, "pcRunMsg", r, r && r.skipped === "off" ? T(c, "site.engage.log.off", "Patient messages and feedback are both off.")
            : T(c, "site.engage.log.ran", "New: {created}. Accepted by the provider: {sent}. Failed: {failed}. Held for quiet hours: {held}. Not sent: {skipped}.", { created: r && r.created, sent: r && r.sent, failed: r && r.failed, held: r && r.held, skipped: r && r.skipped }));
          if (r && r.ok) c.api("/ward/comm-log" + q(c) + (s.filter ? "&status=" + encodeURIComponent(s.filter) : "")).then(function (x) { s.log = x || { ok: false }; var keep = document.getElementById("pcRunMsg").innerHTML; draw(); set("pcRunMsg", keep); });
        });
      }
      if (act === "retry") return c.api("/ward/comm-retry", { orgId: c.state.orgId, id: b.getAttribute("data-id") }).then(function (r) { if (r && r.ok) load(); else c.toast(refusal(c, r)); });
      if (act === "pref-load") {
        s.pid = val("pcPid"); if (!s.pid) return;
        s.pref = null; draw();
        return c.api("/ward/comm-preference" + q(c) + "&patientId=" + encodeURIComponent(s.pid)).then(function (r) { s.pref = r || { ok: false }; draw(); });
      }
      if (act === "pref-in" || act === "pref-out") {
        var ch = b.getAttribute("data-ch");
        return c.api("/ward/comm-preference", { orgId: c.state.orgId, patientId: s.pid, channel: ch, optedIn: act === "pref-in", mobile: val("pcM_" + ch), note: val("pcN_" + ch) }).then(function (r) {
          if (!r || !r.ok) return say(c, "pcPrefMsg", r);
          s.pref = { ok: true, preference: r.preference }; draw(); say(c, "pcPrefMsg", r, T(c, "site.engage.saved", "Saved."));
        });
      }
    };
    load();
  }

  /* ---- Online booking ---------------------------------------------------------------------------------------- */

  var DAYS = [1, 2, 3, 4, 5, 6, 0];
  function dayLabel(c, d) {
    return [T(c, "site.engage.day.sun", "Sun"), T(c, "site.engage.day.mon", "Mon"), T(c, "site.engage.day.tue", "Tue"), T(c, "site.engage.day.wed", "Wed"), T(c, "site.engage.day.thu", "Thu"), T(c, "site.engage.day.fri", "Fri"), T(c, "site.engage.day.sat", "Sat")][d];
  }
  var BOOK = { members: null, rows: null };

  function bookingHtml(c, s) {
    var esc = c.esc, ob = wsq(c).onlineBooking || {};
    if (s.members === null) return '<div class="card">' + loading(c) + "</div>";
    var clinicians = (s.members || []).filter(function (m) { return m.active !== false && /doctor|consultant|faculty|hod|radiologist/.test(m.role || ""); });
    var num = function (id, v, d) { return '<input id="' + id + '" type="number" min="0" style="max-width:6em" value="' + esc(v != null ? v : d) + '">'; };
    var h = '<div class="card"><h2>' + c.ms("event_available") + " " + esc(T(c, "site.engage.book.title", "Online booking in the patient portal")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.engage.book.intro", "Patients can book only the sessions published here, only slots that are free in the diary and not blacked out, and change only bookings they made online. A slot two patients pick at once goes to one of them.")) + "</p>" +
      '<label class="f"><input id="obOn" type="checkbox"' + (ob.enabled === true ? " checked" : "") + "> " + esc(T(c, "site.engage.book.enabled", "Let patients book online")) + "</label>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.engage.book.daysAhead", "Days ahead that can be booked")) + "</span>" + num("obDays", ob.maxDaysAhead, 14) + "</label>" +
      '<label class="f"><span>' + esc(T(c, "site.engage.book.minNotice", "Hours of notice to book")) + "</span>" + num("obMin", ob.minHoursBefore, 2) + "</label>" +
      '<label class="f"><span>' + esc(T(c, "site.engage.book.cancelNotice", "Hours of notice to cancel")) + "</span>" + num("obCancel", ob.cancelHoursBefore, 4) + "</label>" +
      '<label class="f"><span>' + esc(T(c, "site.engage.book.moveNotice", "Hours of notice to move")) + "</span>" + num("obMove", ob.rescheduleHoursBefore, 4) + "</label>" +
      '<label class="f"><span>' + esc(T(c, "site.engage.book.maxUpcoming", "Upcoming online bookings per patient")) + "</span>" + num("obMax", ob.maxUpcoming, 2) + "</label></div>" +
      "<h3>" + esc(T(c, "site.engage.book.sessions", "Published sessions")) + "</h3>" +
      s.rows.map(function (r, i) {
        return '<div class="row"><label class="f"><span>' + esc(T(c, "site.engage.book.clinician", "Clinician")) + '</span><select id="obC_' + i + '">' + clinicians.map(function (m) {
          return '<option value="' + esc(m.identity) + '"' + (m.identity === r.clinicianId ? " selected" : "") + ">" + EN(c, esc(m.displayName || m.employeeId || m.role)) + "</option>"; }).join("") + "</select></label>" +
          '<label class="f"><span>' + esc(T(c, "site.engage.book.name", "Name shown to patients")) + '</span><input id="obN_' + i + '" value="' + esc(r.clinicianName || "") + '"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.engage.book.department", "Department")) + '</span><input id="obD_' + i + '" value="' + esc(r.department || "") + '"></label>' +
          '<span class="f">' + DAYS.map(function (d) { return '<label><input type="checkbox" id="obW_' + i + "_" + d + '"' + ((r.weekdays || []).indexOf(d) >= 0 ? " checked" : "") + "> " + esc(dayLabel(c, d)) + "</label> "; }).join("") + "</span>" +
          '<label class="f"><span>' + esc(T(c, "site.engage.book.from", "From")) + '</span><input id="obS_' + i + '" type="time" value="' + esc(r.start || "09:00") + '"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.engage.book.to", "To")) + '</span><input id="obE_' + i + '" type="time" value="' + esc(r.end || "12:00") + '"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.engage.book.slot", "Minutes per slot")) + "</span>" + num("obM_" + i, r.slotMinutes, 15) + "</label>" +
          '<button class="btn ghost" type="button" data-ob="remove" data-i="' + i + '">' + esc(T(c, "site.engage.remove", "Remove")) + "</button></div>";
      }).join("") +
      (clinicians.length ? '<button class="btn ghost" type="button" data-ob="add">' + esc(T(c, "site.engage.book.addSession", "Add a session")) + "</button> " : "<p>" + esc(T(c, "site.engage.book.noClinicians", "No doctor is on the staff list yet.")) + "</p>") +
      '<button class="btn primary" type="button" data-ob="save">' + esc(T(c, "site.engage.save", "Save")) + '</button><div id="obMsg" aria-live="polite"></div></div>';
    return h;
  }

  function renderBooking(c, body) {
    var s = BOOK;
    s.rows = ((wsq(c).onlineBooking || {}).sessions || []).slice();
    var draw = function () { body.innerHTML = bookingHtml(c, s); };
    var readRows = function () {
      return s.rows.map(function (r, i) {
        return { id: r.id || "", clinicianId: val("obC_" + i), clinicianName: val("obN_" + i), department: val("obD_" + i), weekdays: DAYS.filter(function (d) { return checked("obW_" + i + "_" + d); }), start: val("obS_" + i), end: val("obE_" + i), slotMinutes: Number(val("obM_" + i)) || 15 };
      });
    };
    body.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-ob]"); if (!b) return;
      var act = b.getAttribute("data-ob");
      if (act === "add") { s.rows = readRows(); s.rows.push({ weekdays: [1, 2, 3, 4, 5] }); return draw(); }
      if (act === "remove") { s.rows = readRows(); s.rows.splice(Number(b.getAttribute("data-i")), 1); return draw(); }
      if (act === "save") {
        s.rows = readRows();
        return saveSetting(c, "onlineBooking", { enabled: checked("obOn"), maxDaysAhead: Number(val("obDays")), minHoursBefore: Number(val("obMin")), cancelHoursBefore: Number(val("obCancel")), rescheduleHoursBefore: Number(val("obMove")), maxUpcoming: Number(val("obMax")), sessions: s.rows }, "obMsg");
      }
    };
    s.members = null; draw();
    c.api("/members" + q(c)).then(function (r) { s.members = (r && r.ok && r.members) || []; draw(); });
  }

  /* ---- Patient feedback -------------------------------------------------------------------------------------- */

  var FB = { data: null, from: "", to: "" };
  function kindLabel(c, k) { return k === "discharge" ? T(c, "site.engage.fb.discharge", "After discharge") : T(c, "site.engage.fb.opd", "After an OPD visit"); }
  function qKindLabel(c, k) { return { rating5: T(c, "site.engage.fb.rating", "Rating 1 to 5"), yesno: T(c, "site.engage.fb.yesno", "Yes or no"), text: T(c, "site.engage.fb.text", "Written answer") }[k] || k; }

  function feedbackHtml(c, s) {
    var esc = c.esc, f = wsq(c).feedback || {};
    var qEditor = function (kind) {
      var qs = ((f.surveys && f.surveys[kind] && f.surveys[kind].questions) || []).concat([{ text: "", kind: "rating5" }]);
      return "<h3>" + esc(kindLabel(c, kind)) + "</h3>" + qs.map(function (x, i) {
        return '<div class="row"><label class="f"><span>' + esc(T(c, "site.engage.fb.question", "Question {n}", { n: i + 1 })) + '</span><input id="fbQ_' + kind + "_" + i + '" value="' + esc(x.text || "") + '" maxlength="200"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.engage.fb.answerKind", "Answer")) + '</span><select id="fbK_' + kind + "_" + i + '">' + ["rating5", "yesno", "text"].map(function (k) { return '<option value="' + k + '"' + (x.kind === k ? " selected" : "") + ">" + esc(qKindLabel(c, k)) + "</option>"; }).join("") + "</select></label></div>";
      }).join("") + '<input type="hidden" id="fbCount_' + kind + '" value="' + qs.length + '">';
    };
    var h = '<div class="card"><h2>' + c.ms("reviews") + " " + esc(T(c, "site.engage.fb.title", "Patient feedback")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.engage.fb.intro", "Every survey asks how likely the patient is to recommend the hospital (0 to 10) and for a comment, then your questions. A score at or below the low mark, or any rating of 1 or 2, goes to the service-recovery queue. Leave a question blank to remove it.")) + "</p>" +
      '<label class="f"><input id="fbOn" type="checkbox"' + (f.enabled === true ? " checked" : "") + "> " + esc(T(c, "site.engage.fb.enabled", "Ask patients for feedback after discharge and after OPD visits")) + "</label>" +
      '<label class="f"><span>' + esc(T(c, "site.engage.fb.low", "Low score at or below")) + '</span><input id="fbLow" type="number" min="0" max="10" style="max-width:5em" value="' + esc(f.lowScoreAtOrBelow != null ? f.lowScoreAtOrBelow : 6) + '"></label>' +
      qEditor("discharge") + qEditor("opd") +
      '<button class="btn primary" type="button" data-fb="save">' + esc(T(c, "site.engage.save", "Save")) + '</button><div id="fbMsg" aria-live="polite"></div>' +
      '<p class="quiet">' + esc(T(c, "site.engage.fb.sendNote", "The survey link is sent by the Feedback survey message on the Patient communication tab, and is also shown in the patient portal.")) + "</p></div>";
    h += '<div class="card"><h2>' + esc(T(c, "site.engage.fb.results", "Results by department")) + '</h2><div class="row"><label class="f"><span>' + esc(T(c, "site.engage.book.from", "From")) + '</span><input id="fbFrom" type="date" value="' + esc(s.from) + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.engage.book.to", "To")) + '</span><input id="fbTo" type="date" value="' + esc(s.to) + '"></label><button class="btn" type="button" data-fb="show">' + esc(T(c, "site.engage.show", "Show")) + "</button></div>";
    if (s.data === null) return h + loading(c) + "</div>";
    if (!s.data || !s.data.ok) return h + failed(c, s.data) + "</div>";
    var d = s.data;
    h += (d.partial ? '<div class="msg note">' + esc(T(c, "site.engage.fb.partial", "Only the newest responses are counted.")) + "</div>" : "") +
      "<p>" + esc(T(c, "site.engage.fb.summary", "Responses: {n}. Net promoter score: {nps}.", { n: d.responses, nps: d.nps == null ? T(c, "site.engage.fb.none", "none yet") : d.nps })) + "</p>" +
      (d.byDepartment.length ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.engage.book.department", "Department")) + "</th><th>" + esc(T(c, "site.engage.fb.colKind", "Survey")) + "</th><th>" + esc(T(c, "site.engage.fb.colResponses", "Responses")) + "</th><th>" +
        esc(T(c, "site.engage.fb.colNps", "NPS")) + "</th><th>" + esc(T(c, "site.engage.fb.colAverage", "Average score")) + "</th><th>" + esc(T(c, "site.engage.fb.colLow", "Low scores")) + "</th></tr></thead><tbody>" +
        d.byDepartment.map(function (x) { return "<tr" + (x.nps != null && x.nps < 0 ? ' class="warn"' : "") + "><td>" + (x.department ? EN(c, esc(x.department)) : esc(T(c, "site.engage.fb.noDept", "Not recorded"))) + "</td><td>" + esc(kindLabel(c, x.kind)) + "</td><td>" + x.responses + "</td><td>" + x.nps + "</td><td>" + x.average + "</td><td>" + x.low + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : "") + "</div>";
    h += '<div class="card"><h2>' + esc(T(c, "site.engage.fb.recovery", "Service recovery queue ({n})", { n: d.recoveryQueue.length })) + "</h2>" + (d.recoveryQueue.length ? d.recoveryQueue.map(function (x) {
      return '<div class="card"><p><b>' + esc(T(c, "site.engage.fb.score", "Score {n}", { n: x.nps })) + "</b> " + esc(kindLabel(c, x.kind)) + (x.department ? ", " + EN(c, esc(x.department)) : "") + ", " + esc(when(x.submittedAt)) + ' <span class="mono">' + EN(c, esc(x.patientId)) + "</span></p>" +
        (x.comment ? '<p style="white-space:pre-wrap">' + EN(c, esc(x.comment)) + "</p>" : "") +
        (x.questions || []).filter(function (qq) { return x.answers[qq.id] !== undefined; }).map(function (qq) { return '<p class="quiet">' + EN(c, esc(qq.text + ": " + String(x.answers[qq.id]))) + "</p>"; }).join("") +
        ((x.recovery.notes || []).length ? "<ul>" + x.recovery.notes.map(function (n) { return "<li>" + esc(when(n.at)) + ": " + EN(c, esc(n.note)) + "</li>"; }).join("") + "</ul>" : "") +
        '<label class="f"><span>' + esc(T(c, "site.engage.fb.whatDone", "What was done")) + '</span><input id="fbNote_' + esc(x.id) + '" maxlength="1000"></label>' +
        '<button class="btn ghost" type="button" data-fb="progress" data-id="' + esc(x.id) + '">' + esc(T(c, "site.engage.fb.inProgress", "In progress")) + '</button> <button class="btn" type="button" data-fb="resolve" data-id="' + esc(x.id) + '">' + esc(T(c, "site.engage.fb.resolve", "Resolved")) + "</button></div>";
    }).join("") : "<p>" + esc(T(c, "site.engage.fb.queueEmpty", "Nothing waiting.")) + "</p>") + '<div id="fbRecMsg" aria-live="polite"></div></div>';
    h += '<div class="card"><h2>' + esc(T(c, "site.engage.fb.comments", "Recent comments")) + "</h2>" + (d.recentComments.length ? "<ul>" + d.recentComments.map(function (x) {
      return "<li>" + esc(T(c, "site.engage.fb.score", "Score {n}", { n: x.nps })) + (x.department ? ", " + EN(c, esc(x.department)) : "") + ": " + EN(c, esc(x.comment)) + "</li>"; }).join("") + "</ul>" : "<p>" + esc(T(c, "site.engage.fb.noComments", "No comments yet.")) + "</p>") + "</div>";
    return h;
  }

  function renderFeedback(c, body) {
    var s = FB;
    var draw = function () { body.innerHTML = feedbackHtml(c, s); };
    var load = function () {
      s.data = null; draw();
      c.api("/ward/feedback-dashboard" + q(c) + (s.from ? "&from=" + encodeURIComponent(s.from) : "") + (s.to ? "&to=" + encodeURIComponent(s.to) : "")).then(function (r) { s.data = r || { ok: false }; draw(); });
    };
    body.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-fb]"); if (!b) return;
      var act = b.getAttribute("data-fb"), id = b.getAttribute("data-id");
      if (act === "show") { s.from = val("fbFrom"); s.to = val("fbTo"); return load(); }
      if (act === "save") {
        var questions = function (kind) {
          var n = Number(val("fbCount_" + kind)) || 0, out = [];
          for (var i = 0; i < n; i++) if (val("fbQ_" + kind + "_" + i)) out.push({ id: "q" + (out.length + 1), text: val("fbQ_" + kind + "_" + i), kind: val("fbK_" + kind + "_" + i) });
          return out;
        };
        return saveSetting(c, "feedback", { enabled: checked("fbOn"), lowScoreAtOrBelow: Number(val("fbLow")), surveys: { discharge: { questions: questions("discharge") }, opd: { questions: questions("opd") } } }, "fbMsg", draw);
      }
      if (act === "progress" || act === "resolve") {
        b.disabled = true;
        return c.api("/ward/feedback-recovery", { orgId: c.state.orgId, id: id, status: act === "resolve" ? "resolved" : "in_progress", note: val("fbNote_" + id) }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) return say(c, "fbRecMsg", r);
          c.toast(T(c, "site.engage.saved", "Saved.")); load();
        });
      }
    };
    load();
  }

  WSQ._engage = { comms: renderComms, booking: renderBooking, feedback: renderFeedback, logHtml: logHtml, feedbackHtml: feedbackHtml, bookingHtml: bookingHtml };
})();
