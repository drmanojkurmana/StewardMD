/* wardsynq/adapters/wardsynq-sms-channel.js — TASK 5.4: SMS as an escalation channel.
 *
 * wardsynq-transport.js's ladder and functions/_followcare_sms.js's sendSms() both already exist and
 * do not know about each other. This file is the seam, in the exact channel shape wardsynq-transport.js
 * defines ({name, send(payload) -> {delivered, sent?, receipt?, detail?}}) - it introduces no new SMS
 * integration, credential, or retry logic of its own.
 *
 * THE ONE THING THIS FILE IS CAREFUL ABOUT, THAT wardsynq-mobile-channel.js's sibling file is not:
 * sendSms()'s Indian providers (2Factor, MSG91) are DLT-registered TEMPLATE senders, not free-text
 * senders. Their template is FollowCare's own patient check-in message (name + link) - reusing it to
 * carry a clinical escalation ("Critical potassium 6.8, Ward 4B, Bed 12") would either send the WRONG
 * words to a real recipient or be rejected outright by the telecom DLT filter, and Indian DLT
 * regulation does not allow substituting arbitrary text into an approved template. So this channel is
 * usable ONLY when the configured provider composes free text directly (Twilio, Gupshup); for a
 * template-locked provider it fails cleanly and NAMES why, rather than silently sending the wrong
 * message or fabricating an escalation SMS template that has not gone through DLT approval.
 *
 * As with wardsynq-mobile-channel.js: a provider accepting the request is SENT, not delivered. SMS
 * carriers do not hand back a receipt on this build's request/response cycle, so this channel never
 * reports `delivered: true` - the ladder continues past it exactly as it does past the webhook.
 *
 * STATUS: IMPLEMENTED and TESTED against an injected sendSms(). NOT proven against a live SMS gateway
 * (no provider is configured in this environment) and NOT proven on a real handset.
 *
 * node --test test/wardsynq-sms-channel.test.mjs
 */

import { sendSms, smsProvider } from "../../functions/_followcare_sms.js";

/** Providers whose API takes the message body directly. The DLT-template providers are NOT here. */
const FREE_TEXT_PROVIDERS = Object.freeze(["twilio", "gupshup"]);

/**
 * A channel that delivers to a resolved phone number via the existing FollowCare SMS gateway.
 *
 * @param {{env: object, resolvePhone: (notice: object) => Promise<string|null>|string|null,
 *   sendSmsFn?: Function}} deps
 *   resolvePhone names WHO this notice pages, in E.164/dialable form - rota/recipient lookup is a
 *   site policy this file does not make; a channel with no way to resolve a number carries nothing.
 */
function stewardmdSmsChannel({ env, resolvePhone, sendSmsFn } = {}) {
  const send = sendSmsFn || sendSms;
  if (typeof resolvePhone !== "function") {
    throw new Error("an SMS channel needs resolvePhone(notice) to name who is being paged");
  }

  return async function sendToSms(notice) {
    const provider = smsProvider(env);
    if (!provider) return { delivered: false, detail: "no SMS provider is configured (FOLLOWCARE_SMS_PROVIDER unset)" };
    if (!FREE_TEXT_PROVIDERS.includes(provider)) {
      return {
        delivered: false,
        detail: `the configured SMS provider (${provider}) sends only a DLT-approved template message, and the ` +
          `approved template is FollowCare's patient check-in text - it cannot carry a clinical escalation body. ` +
          `A separate DLT-approved escalation template would need to be registered before this channel can be used`,
      };
    }

    let to;
    try { to = await resolvePhone(notice); }
    catch (err) { return { delivered: false, detail: `could not resolve a phone number: ${String((err && err.message) || err)}` }; }
    if (!to) return { delivered: false, detail: "no phone number is on file for the intended recipient" };

    const body = notice.title + (notice.body ? " - " + notice.body : "");
    let result;
    try { result = await send(env, { toE164: to, body }); }
    catch (err) { return { delivered: false, detail: String((err && err.message) || err) }; }

    if (result && result.skipped) return { delivered: false, detail: "SMS provider is not configured" };
    if (!result || !result.ok) return { delivered: false, detail: (result && result.detail) || "the SMS provider refused the message" };

    return {
      // NOT delivered. A carrier accepting a message for submission is not a phone buzzing.
      delivered: false,
      sent: true,
      receipt: result.providerId ? `sms:${result.providerId}` : `sms:${notice.id}`,
      detail: "the SMS gateway accepted the message. That is SENT: nothing here confirms the handset received it",
    };
  };
}

export { stewardmdSmsChannel, FREE_TEXT_PROVIDERS };
