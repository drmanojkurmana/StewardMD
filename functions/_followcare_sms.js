/* StewardMD · FollowCare AI — SMS provider layer (server).
 *
 * One narrow interface — sendSms(env, { toE164, body, templateId, vars }) — with real implementations for
 * MSG91 (India, DLT flow API), Twilio, and Gupshup, selected by env FOLLOWCARE_SMS_PROVIDER. When no
 * provider is configured it returns { ok:false, skipped:true, reason:"not_configured" } and logs a warning
 * — it NEVER pretends a message was sent. The caller (dispatcher) records every attempt in the delivery log.
 *
 * India DLT note: MSG91's flow API requires a DLT-registered template_id and sender header; the message body
 * is defined by that approved template and filled from `vars` (var1=name, var2=link, …). Twilio/Gupshup send
 * the composed `body` directly. No PHI beyond the patient's first name + the opaque link ever leaves here.
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
async function sendTwoFactor(env, to, msg) {
  var vars = msg.vars || {};
  var to10 = String(to).length > 10 ? String(to).slice(-10) : String(to);   // 2Factor TSMS uses the 10-digit number
  var form = new URLSearchParams();
  form.set("From", env.TWOFACTOR_SENDER);
  form.set("To", to10);
  form.set("TemplateName", env.TWOFACTOR_TEMPLATE_CHECKIN);
  form.set("VAR1", String(vars.var1 != null ? vars.var1 : (vars.name || "")));
  form.set("VAR2", String(vars.var2 != null ? vars.var2 : (vars.link || "")));
  var url = "https://2factor.in/API/V1/" + encodeURIComponent(env.TWOFACTOR_API_KEY) + "/ADDON_SERVICES/SEND/TSMS";
  var r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  var text = await r.text(); var j = {}; try { j = JSON.parse(text); } catch (e) {}
  var ok = r.ok && (j.Status ? String(j.Status).toLowerCase() === "success" : false);
  return { ok: !!ok, providerId: (j.Details || null), status: r.status, detail: ok ? null : text.slice(0, 200) };
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
