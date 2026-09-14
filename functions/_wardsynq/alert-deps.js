/* functions/_wardsynq/alert-deps.js — the production seams of the S3 P0 alert path, in one place.
 *
 * Like deps.js: the domain (alert-recipients.js, push-alerts.js, device-directory.js) takes its I/O as
 * ports, and this is the set a real request uses. The D12 move replaces this file, not those.
 *
 * OFF UNLESS THE HOSPITAL TURNED IT ON. org.wardsynq.alerts.push.enabled, default false: with it off
 * notifyDepsFor returns {} and every loop records NO_CHANNEL exactly as before. No env var: the
 * production text bindings are at their limit.
 */
import * as ORG from "../_opd_org_store.js";
import * as ROSTER from "../_roster_store.js";
import { pushKv } from "../_webpush.js";
import { nativeTokensById, sendNativeToTokens } from "../_nativepush.js";
import { deviceDirectory } from "./device-directory.js";
import { serverPushChannel, smsFallbackSender } from "./push-alerts.js";
import { sendTwoFactor } from "../_followcare_sms.js";

const alertsEnabled = (org) => !!(org && org.wardsynq && org.wardsynq.alerts && org.wardsynq.alerts.push && org.wardsynq.alerts.push.enabled === true);

const directoryFromEnv = (env) => deviceDirectory(pushKv(env));

/* SMS ADAPTERS, selected per hospital (alerts.sms.provider, default "twofactor"). Each names exactly what
 * is missing instead of failing quietly. 2Factor sends by a DLT-approved template: the hospital registers
 * one whose VAR1 is the ward and VAR2 the bed, and names it and its sender header here. The API key is
 * the existing TWOFACTOR_API_KEY secret; no new variable. */
const SMS_ADAPTERS = {
  twofactor: (env, c) => ({
    missing: [
      ...(env && env.TWOFACTOR_API_KEY ? [] : ["The 2Factor API key (TWOFACTOR_API_KEY) is not available to the server."]),
      ...(c.senderId ? [] : ["This hospital's DLT sender ID is not set."]),
      ...(c.templateName ? [] : ["This hospital's DLT template name for critical-result SMS is not set."]),
    ],
    send: (to, vars) => sendTwoFactor(env, String(to).replace(/\D/g, ""), { sender: c.senderId, templateName: c.templateName, vars }),
  }),
};
function smsSetup(env, org) {
  const c = (org && org.wardsynq && org.wardsynq.alerts && org.wardsynq.alerts.sms) || {};
  const provider = String(c.provider || "twofactor");
  const make = SMS_ADAPTERS[provider];
  return make ? make(env, c) : { missing: [`SMS provider "${provider}" is not supported. Supported: ${Object.keys(SMS_ADAPTERS).join(", ")}.`], send: null };
}

/** The hospital's staff, rota and self-marked duty, as the recipient and phone-coverage readers use them. Members are read once. */
function staffReaders(env, org) {
  const cfg = org.wardsynq || {};
  const offset = cfg.utcOffsetMinutes != null ? cfg.utcOffsetMinutes : 330;
  let members = null;
  return {
    members: async () => (members = members || await ORG.listMembers(env, org.id)),
    onDuty: (unit) => ROSTER.onDuty(env, org.id, unit || "", offset),
    dutyStatuses: () => ROSTER.dutyStatuses(env, org.id),
  };
}

/** { channels: { mobile } } for a hospital that turned alerts on, else {}. */
function notifyDepsFor(env, org, tenantId, repository) {
  if (!alertsEnabled(org)) return {};
  const directory = directoryFromEnv(env);
  // Turned on with no store to find a phone in: no channel is the honest answer, recorded as NO_CHANNEL.
  if (!directory) return {};
  const cfg = org.wardsynq || {};
  const readers = { ...staffReaders(env, org), latest: (type, id) => repository.latest(String(tenantId), type, id) };
  const sendToTokens = async (ids, msg) => sendNativeToTokens(env, await nativeTokensById(env, ids), msg);
  return {
    channels: { mobile: serverPushChannel({ orgId: org.id, tenantId: String(tenantId), policy: cfg.criticalEscalation || null, readers, directory, sendToTokens }) },
    smsFallback: smsFallbackSender({ readers, sms: smsSetup(env, org) }),
  };
}

export { alertsEnabled, directoryFromEnv, smsSetup, staffReaders, notifyDepsFor };
