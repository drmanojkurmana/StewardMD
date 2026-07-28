/* StewardMD · FollowCare AI — WhatsApp channel (server). Provider-agnostic, like _followcare_sms.js.
 *
 * Sends the recovery-check-in link over WhatsApp instead of SMS. Two providers:
 *   • callmebot  — FREE, TEST-ONLY. Sends WhatsApp to a number that has opted in to the CallMeBot bot.
 *                  Great for a quick end-to-end test to your OWN number; NOT for real patient PHI (it relays
 *                  through a third-party bot and is rate-limited/unofficial).
 *   • custom     — any real Business Solution Provider (Gupshup / Interakt / AiSensy / 2Factor-WhatsApp / …)
 *                  via a CONFIGURABLE POST: FOLLOWCARE_WA_URL + FOLLOWCARE_WA_HEADERS (JSON) +
 *                  FOLLOWCARE_WA_BODY (a template string with {{to}} {{name}} {{link}} {{text}}). No code
 *                  change to switch BSP — this is the production path (compliant WhatsApp Business via a BSP).
 *
 * Selected by FOLLOWCARE_WA_PROVIDER; the dispatcher routes to WhatsApp when FOLLOWCARE_MSG_CHANNEL=whatsapp.
 * Fails SAFE (skipped + logged) when unconfigured — never throws. window/module exports for tests.
 */

export function waProvider(env) { return String((env && env.FOLLOWCARE_WA_PROVIDER) || "").toLowerCase().trim(); }
export function waConfigured(env) {
  var p = waProvider(env);
  if (p === "callmebot") return !!(env.CALLMEBOT_APIKEY);
  if (p === "custom") return !!(env.FOLLOWCARE_WA_URL && env.FOLLOWCARE_WA_BODY);
  return false;
}
// WhatsApp needs the full international number, digits only, no '+'. India-first: a bare 10-digit gets 91.
export function toWaNumber(phone, defaultCc) {
  var d = String(phone || "").replace(/[^\d]/g, "");
  if (d.length === 10) d = String(defaultCc || "91") + d;
  return d;
}
// Fill a {{token}} template from a values map (used by the `custom` BSP body). Deterministic + testable.
export function fillTemplate(tpl, vals) {
  return String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, k) { return vals[k] != null ? String(vals[k]) : ""; });
}

export async function sendWhatsApp(env, msg) {
  var p = waProvider(env);
  if (!p || !waConfigured(env)) { try { console.warn("[followcare/wa] provider not configured (" + (p || "none") + ")"); } catch (e) {} return { ok: false, skipped: true, reason: "not_configured" }; }
  var to = toWaNumber(msg.toE164, env.FOLLOWCARE_DEFAULT_CC);
  if (!to || to.length < 10) return { ok: false, reason: "bad_number" };
  try {
    if (p === "callmebot") return await sendCallMeBot(env, to, msg);
    if (p === "custom") return await sendCustom(env, to, msg);
  } catch (e) { try { console.warn("[followcare/wa] exception", String(e && e.message || e)); } catch (x) {} return { ok: false, reason: "exception" }; }
  return { ok: false, reason: "unknown_provider" };
}

// ---- CallMeBot (TEST ONLY) --------------------------------------------------------------
async function sendCallMeBot(env, to, msg) {
  var url = "https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(to) +
    "&text=" + encodeURIComponent(msg.body || "") + "&apikey=" + encodeURIComponent(env.CALLMEBOT_APIKEY);
  var r = await fetch(url, { method: "GET" });
  var text = await r.text();
  var ok = r.ok && /queued|message sent|success/i.test(text);
  return { ok: !!ok, providerId: null, status: r.status, detail: ok ? null : String(text).replace(/<[^>]+>/g, " ").slice(0, 200) };
}

// ---- Custom BSP (production, config-only) -----------------------------------------------
async function sendCustom(env, to, msg) {
  var vars = msg.vars || {};
  var vals = { to: to, name: vars.name != null ? vars.name : (vars.var1 || ""), link: vars.link != null ? vars.link : (vars.var2 || ""), text: msg.body || "" };
  var body = fillTemplate(env.FOLLOWCARE_WA_BODY, vals);
  var headers = { "Content-Type": "application/json" };
  try { if (env.FOLLOWCARE_WA_HEADERS) Object.assign(headers, JSON.parse(env.FOLLOWCARE_WA_HEADERS)); } catch (e) {}
  var r = await fetch(env.FOLLOWCARE_WA_URL, { method: "POST", headers: headers, body: body });
  var text = await r.text();
  return { ok: r.ok, providerId: null, status: r.status, detail: r.ok ? null : String(text).slice(0, 200) };
}
