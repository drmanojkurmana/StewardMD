/* StewardMD · FollowCare AI — SMS provider layer (server).
 *
 * One narrow interface — sendSms(env, { toE164, body, templateId, vars }) — with real implementations for
 * MSG91 (India, DLT flow API), Twilio, and Gupshup, selected by env FOLLOWCARE_SMS_PROVIDER. When no
 * provider is configured it returns { ok:false, skipped:true, reason:"not_configured" } and logs a warning
 * — it NEVER pretends a message was sent. The caller (dispatcher) records every attempt in the delivery log.
 *
 * India DLT note: MSG91's flow API requires a DLT-registered template_id and sender header; the message body
 * is defined by that approved template and filled from `vars` (var1=name, var2=link, …). Twilio/Gupshup send
 * the composed `body` directly. FollowCare and the OPD queue never pass a patient name: their DLT slots greet
 * "Patient" (owner 2026-09-27: a name is PHI).
 *
 * sendDlt() is the path for OUR approved DLT templates (DLT below): it fills the registered text itself and
 * sends it through 2Factor's R1 Transactional-SMS API with our DLT entity id and the content-template id, so
 * nothing has to be registered by name on 2Factor's dashboard. Without peid R1 answered "Missing templatename
 * value", and a 2Factor template name reached the operator but came back DLT-CNT-REJECT; msg + peid + ctid was
 * DELIVERED (live test 2026-09-27). Needs FOLLOWCARE_SMS_PROVIDER=twofactor, TWOFACTOR_API_KEY and
 * TWOFACTOR_SENDER=MAIK (the only approved header).
 *
 * Env (owner provisions ONE provider):
 *   FOLLOWCARE_SMS_PROVIDER = "twofactor" | "msg91" | "twilio" | "gupshup" | "" (off)
 *   twofactor: TWOFACTOR_API_KEY, TWOFACTOR_SENDER (DLT header), TWOFACTOR_TEMPLATE_CHECKIN (DLT template name)
 *   msg91:   MSG91_AUTHKEY, MSG91_SENDER (6-char header), MSG91_TEMPLATE_CHECKIN (DLT flow/template id)
 *   twilio:  TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (E.164)
 *   gupshup: GUPSHUP_API_KEY, GUPSHUP_SOURCE
 */

export function smsProvider(env) { return String((env && env.FOLLOWCARE_SMS_PROVIDER) || "").toLowerCase().trim(); }
export function smsConfigured(env) {
  var p = smsProvider(env);
  if (p === "twofactor") return !!(env.TWOFACTOR_API_KEY && env.TWOFACTOR_SENDER && env.TWOFACTOR_TEMPLATE_CHECKIN);
  if (p === "msg91") return !!(env.MSG91_AUTHKEY && env.MSG91_TEMPLATE_CHECKIN);
  if (p === "twilio") return !!(env.TWILIO_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
  if (p === "gupshup") return !!(env.GUPSHUP_API_KEY && env.GUPSHUP_SOURCE);
  return false;
}

// Normalise to bare digits with a country code. India-first: a bare 10-digit number gets 91 prepended.
export function toDialable(phone, defaultCc) {
  var d = String(phone || "").replace(/[^\d]/g, "");
  if (d.length === 10) d = String(defaultCc || "91") + d;   // add default country code to a local number
  return d;
}

// The single entry point. Returns { ok, providerId?, skipped?, reason?, status?, detail? }.
export async function sendSms(env, msg) {
  var p = smsProvider(env);
  if (!p || !smsConfigured(env)) {
    try { console.warn("[followcare/sms] provider not configured (" + (p || "none") + ") — message not sent"); } catch (e) {}
    return { ok: false, skipped: true, reason: "not_configured" };
  }
  var to = toDialable(msg.toE164, env.FOLLOWCARE_DEFAULT_CC);
  if (!to || to.length < 10) return { ok: false, reason: "bad_number" };
  try {
    if (p === "twofactor") return await sendTwoFactor(env, to, msg);
    if (p === "msg91") return await sendMsg91(env, to, msg);
    if (p === "twilio") return await sendTwilio(env, to, msg);
    if (p === "gupshup") return await sendGupshup(env, to, msg);
  } catch (e) {
    try { console.warn("[followcare/sms] send exception", String(e && e.message || e)); } catch (x) {}
    return { ok: false, reason: "exception" };
  }
  return { ok: false, reason: "unknown_provider" };
}

// ---- 2Factor.in (India DLT Transactional-SMS API) --------------------------------------
// Sends via 2Factor's ADDON_SERVICES Transactional SMS: the message text comes from the DLT-approved
// TemplateName, filled from VAR1/VAR2 (VAR1=patient first name, VAR2=the opaque link). To = 10-digit
// Indian mobile. Response { Status:"Success"|... }. The API key lives only in the TWOFACTOR_API_KEY secret.
// sender and templateName may be passed per message (WardSynQ critical-result SMS, S3 P0: each hospital
// names its own DLT header and template); without them the FollowCare env values are used, as before.
export async function sendTwoFactor(env, to, msg) {
  var vars = msg.vars || {};
  var to10 = String(to).length > 10 ? String(to).slice(-10) : String(to);   // 2Factor TSMS uses the 10-digit number
  var form = new URLSearchParams();
  form.set("From", msg.sender || env.TWOFACTOR_SENDER);
  form.set("To", to10);
  form.set("TemplateName", msg.templateName || env.TWOFACTOR_TEMPLATE_CHECKIN);
  form.set("VAR1", String(vars.var1 != null ? vars.var1 : (vars.name || "")));
  form.set("VAR2", String(vars.var2 != null ? vars.var2 : (vars.link || "")));
  var url = "https://2factor.in/API/V1/" + encodeURIComponent(env.TWOFACTOR_API_KEY) + "/ADDON_SERVICES/SEND/TSMS";
  var r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  var text = await r.text(); var j = {}; try { j = JSON.parse(text); } catch (e) {}
  var ok = r.ok && (j.Status ? String(j.Status).toLowerCase() === "success" : false);
  return { ok: !!ok, providerId: (j.Details || null), status: r.status, detail: ok ? null : text.slice(0, 200) };
}

// ---- Our DLT content templates (Vodafone Idea DLT, header MAIK, approved 2026-09-08) ----
// The operator drops an SMS whose text does not match the registered template, so each text below is the
// approved text verbatim and every {#..#} slot must be filled, in order. Only the templates a sender uses are
// listed. {#cbn#} is the clinic's own phone (org.phone), never a StewardMD number.
export var DLT_PEID = "1101720950000098192";   // MAIKNOWLEDGE LLP's DLT entity id (Vilpower); public, not a secret
export var DLT = {
  care_plan: { ctid: "1177178791481113659", text: "Dear {#alp#}, please continue your prescribed care plan from Dr. {#alp#} at {#alp#}. For any questions, contact us at {#cbn#}. Details: {#uro#} -StewardMD" },
  otp: { ctid: "1177178791267832947", text: "Your OTP for login to StewardMD is {#num#}. Valid for {#num#} minutes. Do not share this OTP with anyone. -StewardMD" },
  appt_confirm: { ctid: "1177178791454063563", text: "Dear {#alp#}, your appointment with Dr. {#alp#} at {#alp#} is confirmed for {#alp#} at {#alp#}. View details: {#uro#} -StewardMD" },
  checkin_alert: { ctid: "1177178791462158338", text: "Dear {#alp#}, reminder: your appointment with Dr. {#alp#} at {#alp#} is today at {#alp#}. Please check-in at reception 10 mins prior. Details: {#uro#} -StewardMD" },
};
// PURE: the template text with its slots filled in order. "" when the template is unknown, the slot count is
// wrong, or a slot is blank: a message that cannot match its registered text is never sent.
export function dltText(key, slots) {
  var t = DLT[key];
  if (!t || !Array.isArray(slots)) return "";
  var parts = t.text.split(/\{#\w+#\}/);
  if (slots.length !== parts.length - 1) return "";
  var out = parts[0];
  for (var i = 0; i < slots.length; i++) {
    var v = String(slots[i] == null ? "" : slots[i]).replace(/\s+/g, " ").trim();
    if (!v) return "";
    out += v + parts[i + 1];
  }
  return out;
}
export function dltConfigured(env) { return smsProvider(env) === "twofactor" && !!(env.TWOFACTOR_API_KEY && env.TWOFACTOR_SENDER); }
// -> { ok, providerId?, skipped?, reason?, status?, detail? }. Never throws.
export async function sendDlt(env, toE164, key, slots) {
  if (!dltConfigured(env)) return { ok: false, skipped: true, reason: "not_configured" };
  var msg = dltText(key, slots);
  if (!msg) return { ok: false, reason: "template_mismatch" };
  var to = toDialable(toE164, env.FOLLOWCARE_DEFAULT_CC);
  if (!to || to.length < 10) return { ok: false, reason: "bad_number" };
  // R1 takes "91XXXXXXXXXX" (2Factor's API docs), unlike the TSMS endpoint above, which wants 10 digits.
  var form = new URLSearchParams({ module: "TRANS_SMS", apikey: env.TWOFACTOR_API_KEY, to: to, from: env.TWOFACTOR_SENDER, msg: msg, peid: DLT_PEID, ctid: DLT[key].ctid });
  try {
    var r = await fetch("https://2factor.in/API/R1/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    var text = await r.text(); var j = {}; try { j = JSON.parse(text); } catch (e) {}
    var ok = r.ok && String(j.Status || "").toLowerCase() === "success";
    return { ok: ok, providerId: j.Details || null, status: r.status, detail: ok ? null : text.slice(0, 200) };
  } catch (e) {
    try { console.warn("[sms/dlt] send exception", String(e && e.message || e)); } catch (x) {}
    return { ok: false, reason: "exception" };
  }
}

// ---- MSG91 (India DLT flow API) ---------------------------------------------------------
async function sendMsg91(env, to, msg) {
  var recipient = { mobiles: to };
  var vars = msg.vars || {};
  Object.keys(vars).forEach(function (k) { recipient[k] = String(vars[k]); });
  var payload = { template_id: env.MSG91_TEMPLATE_CHECKIN, short_url: "0", recipients: [recipient] };
  if (env.MSG91_SENDER) payload.sender = env.MSG91_SENDER;
  var r = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: { "authkey": env.MSG91_AUTHKEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload),
  });
  var text = await r.text(); var j = {}; try { j = JSON.parse(text); } catch (e) {}
  var ok = r.ok && (j.type ? j.type === "success" : true);
  return { ok: !!ok, providerId: (j.request_id || j.data || null), status: r.status, detail: ok ? null : text.slice(0, 200) };
}

// ---- Twilio -----------------------------------------------------------------------------
async function sendTwilio(env, to, msg) {
  var url = "https://api.twilio.com/2010-04-01/Accounts/" + env.TWILIO_SID + "/Messages.json";
  var form = new URLSearchParams();
  form.set("To", "+" + to); form.set("From", env.TWILIO_FROM); form.set("Body", msg.body || "");
  var auth = btoa(env.TWILIO_SID + ":" + env.TWILIO_AUTH_TOKEN);
  var r = await fetch(url, { method: "POST", headers: { "Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  var text = await r.text(); var j = {}; try { j = JSON.parse(text); } catch (e) {}
  return { ok: r.ok, providerId: (j.sid || null), status: r.status, detail: r.ok ? null : text.slice(0, 200) };
}

// ---- Gupshup ----------------------------------------------------------------------------
async function sendGupshup(env, to, msg) {
  var form = new URLSearchParams();
  form.set("channel", "sms"); form.set("source", env.GUPSHUP_SOURCE); form.set("destination", to); form.set("message", msg.body || "");
  var r = await fetch("https://api.gupshup.io/sm/api/v1/msg", { method: "POST", headers: { "apikey": env.GUPSHUP_API_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  var text = await r.text(); var j = {}; try { j = JSON.parse(text); } catch (e) {}
  return { ok: r.ok, providerId: (j.messageId || null), status: r.status, detail: r.ok ? null : text.slice(0, 200) };
}
