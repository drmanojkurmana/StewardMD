/* Shared branded email for StewardMD (Resend).
 *
 * One template engine for every message the app sends: sign-up codes, verification, Pro, alerts and
 * the promotional series. The layout follows the way a premium hardware brand mails its customers:
 * a single white column on a soft grey page, the logo alone at the top, one large headline, one line
 * of explanation, one obvious action, then feature tiles that each make ONE point. No sidebars, no
 * teal banner, no walls of bullets.
 *
 *   sendBranded(env, { to, subject, title, subtitle?, bodyHtml, preheader?, replyTo?, kind?, uid? })
 *     kind: "transactional" (default) or "marketing". A marketing email MUST carry uid: it then gets a
 *     footer Unsubscribe link plus RFC 8058 List-Unsubscribe / List-Unsubscribe-Post headers, all
 *     signed (functions/_unsub.js). The caller decides suppression (functions/_lifecycle.js
 *     isUnsubscribed); this module only renders and sends.
 *
 *   renderEmail(opts) returns the HTML without sending, for previews and tests.
 *
 * From noreply@stewardmd.in by default (set FROM_EMAIL to override). Sending from a @stewardmd.in
 * address requires the domain to be verified in Resend (DNS records).
 *
 * Copy rule: no em-dash anywhere in these strings (CLAUDE.md); use a colon, a comma or a full stop.
 */

import { fetchWithTimeout } from "./_fetch.js";
import { unsubToken, unsubUrl } from "./_unsub.js";
import { dayPrices, inr } from "./_pricing.js";

const APP = "https://stewardmd.in";
const MARK = APP + "/logo.png";               // the SD mark, 368 square, transparent (mark-teal.png is not served live)
const TEAL = "#0e6e63";
const INK = "#1d1d1f", GREY = "#6e6e73", LIGHT = "#86868b", TILE = "#f5f5f7", PAGE = "#fbfbfd";
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif";
const COMPANY = "MAIKNOWLEDGE LLP";

export function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export function fromAddr(env) { return env.FROM_EMAIL || "StewardMD <noreply@stewardmd.in>"; }

/* ── components ──────────────────────────────────────────────────────────────────────────────── */

// The primary pill. One per email, centred, never two side by side.
export function button(label, href, opts) {
  opts = opts || {};
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:' + (opts.margin || "28px auto 0") + '"><tr><td style="border-radius:980px;background:' + (opts.color || TEAL) + '">' +
    '<a href="' + esc(href || APP) + '" style="display:inline-block;padding:13px 26px;border-radius:980px;font-family:' + FONT + ';font-size:16px;font-weight:600;color:#fff;text-decoration:none;letter-spacing:-.01em">' + label + '</a>' +
    '</td></tr></table>';
}
// The quiet second action: a text link with a chevron.
export function link(label, href) {
  return '<a href="' + esc(href || APP) + '" style="font-family:' + FONT + ';font-size:16px;color:' + TEAL + ';text-decoration:none;font-weight:500">' + label + ' &#8250;</a>';
}
export function ctaRow(primaryLabel, primaryHref, secondaryLabel, secondaryHref) {
  return button(primaryLabel, primaryHref) +
    (secondaryLabel ? '<p style="margin:14px 0 0;text-align:center">' + link(secondaryLabel, secondaryHref) + '</p>' : "");
}
// Headline block: the one big statement, then one line of grey explanation.
export function headline(h, sub, opts) {
  opts = opts || {};
  return '<h1 style="margin:0;font-family:' + FONT + ';font-size:' + (opts.size || 36) + 'px;line-height:1.08;font-weight:700;letter-spacing:-.025em;color:' + INK + ';text-align:center">' + h + '</h1>' +
    (sub ? '<p style="margin:14px auto 0;max-width:440px;font-family:' + FONT + ';font-size:18px;line-height:1.45;color:' + GREY + ';text-align:center;font-weight:400">' + sub + '</p>' : "");
}
// The price line under the CTA: "From ₹20 a day."
export function priceLine(text) {
  return '<p style="margin:16px 0 0;font-family:' + FONT + ';font-size:14px;line-height:1.5;color:' + GREY + ';text-align:center">' + text + '</p>';
}
// A full-bleed dark panel with one huge figure or phrase. This is the "product shot" when there is
// no photograph: the number IS the picture.
export function hero(o) {
  o = o || {};
  var bg = o.tone === "light" ? "background:#e9f4f2;" : "background:#0b1b19;background-image:linear-gradient(160deg,#0b1b19 0%,#0e3a35 55%,#0e6e63 130%);";
  var fg = o.tone === "light" ? INK : "#ffffff", fg2 = o.tone === "light" ? GREY : "#a7d8d0";
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:36px 0 0"><tr><td style="' + bg + 'border-radius:22px;padding:44px 28px;text-align:center">' +
    (o.eyebrow ? '<div style="font-family:' + FONT + ';font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:' + fg2 + ';margin-bottom:14px">' + o.eyebrow + '</div>' : "") +
    '<div style="font-family:' + FONT + ';font-size:' + (o.size || 54) + 'px;line-height:1;font-weight:700;letter-spacing:-.03em;color:' + fg + '">' + (o.big || "") + '</div>' +
    (o.small ? '<div style="font-family:' + FONT + ';font-size:16px;line-height:1.45;color:' + fg2 + ';margin-top:14px;max-width:380px;margin-left:auto;margin-right:auto">' + o.small + '</div>' : "") +
    '</td></tr></table>';
}
// A feature tile: soft grey card, a glyph, a title, two lines, a link. One point per tile.
export function tile(o) {
  o = o || {};
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0"><tr><td style="background:' + (o.bg || TILE) + ';border-radius:22px;padding:30px 28px;text-align:center">' +
    (o.glyph ? '<div style="font-size:34px;line-height:1;margin-bottom:14px">' + o.glyph + '</div>' : "") +
    (o.eyebrow ? '<div style="font-family:' + FONT + ';font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:' + TEAL + ';margin-bottom:8px">' + o.eyebrow + '</div>' : "") +
    '<div style="font-family:' + FONT + ';font-size:24px;line-height:1.15;font-weight:700;letter-spacing:-.02em;color:' + INK + '">' + (o.title || "") + '</div>' +
    (o.text ? '<div style="font-family:' + FONT + ';font-size:15px;line-height:1.5;color:' + GREY + ';margin:10px auto 0;max-width:400px">' + o.text + '</div>' : "") +
    (o.link ? '<div style="margin-top:14px">' + link(o.link, o.href) + '</div>' : "") +
    '</td></tr></table>';
}
// A big one-time code, copy-friendly, centred.
export function codeBox(code) {
  return '<p style="margin:28px 0 0;text-align:center"><span style="display:inline-block;font-family:\'SF Mono\',Menlo,Consolas,\'IBM Plex Mono\',monospace;font-size:34px;line-height:1;font-weight:700;letter-spacing:10px;color:' + INK + ';background:' + TILE + ';border-radius:16px;padding:22px 26px 22px 36px">' + esc(code) + '</span></p>';
}
export function para(html, opts) {
  opts = opts || {};
  return '<p style="margin:' + (opts.margin || "22px 0 0") + ';font-family:' + FONT + ';font-size:' + (opts.size || 16) + 'px;line-height:1.55;color:' + (opts.color || INK) + ';text-align:' + (opts.align || "center") + '">' + html + '</p>';
}
export function note(html) { return para(html, { size: 13, color: LIGHT }); }
// Two facts side by side (label over value), e.g. registration number and council.
export function facts(rows) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;background:' + TILE + ';border-radius:22px"><tr>' +
    rows.map(function (r) {
      return '<td style="padding:22px 12px;text-align:center;width:' + Math.floor(100 / rows.length) + '%"><div style="font-family:' + FONT + ';font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + LIGHT + ';font-weight:700">' + esc(r[0]) + '</div>' +
        '<div style="font-family:' + FONT + ';font-size:18px;font-weight:700;color:' + INK + ';margin-top:6px;letter-spacing:-.01em">' + esc(r[1]) + '</div></td>';
    }).join("") + '</tr></table>';
}

/* ── the shell ───────────────────────────────────────────────────────────────────────────────── */

function footer(o) {
  var links = [];
  if (o.marketing && o.unsub) links.push('<a href="' + esc(o.unsub) + '" style="color:' + LIGHT + ';text-decoration:underline">Unsubscribe</a>');
  links.push('<a href="' + APP + '/privacy.html" style="color:' + LIGHT + ';text-decoration:underline">Privacy</a>');
  links.push('<a href="' + APP + '/terms.html" style="color:' + LIGHT + ';text-decoration:underline">Terms</a>');
  links.push('<a href="' + APP + '/support.html" style="color:' + LIGHT + ';text-decoration:underline">Support</a>');
  var why = o.marketing
    ? 'You are receiving this because you created a StewardMD account with this address. '
    : '';
  return '<tr><td style="padding:36px 32px 40px;text-align:center;font-family:' + FONT + ';font-size:12px;line-height:1.6;color:' + LIGHT + '">' +
    (o.marketing && o.unsub ? button("Unsubscribe", o.unsub, { color: "#e8e8ed", margin: "0 auto 22px" }).replace('color:#fff', 'color:' + INK).replace('font-size:16px', 'font-size:13px').replace('padding:13px 26px', 'padding:9px 18px') : "") +
    '<div>' + why + 'StewardMD is clinical decision support for registered clinicians. It is an educational aid: verify every recommendation and dose against the primary source and your own judgement.</div>' +
    '<div style="margin-top:14px">' + links.join(' &nbsp;&middot;&nbsp; ') + '</div>' +
    '<div style="margin-top:14px">' + COMPANY + ' &nbsp;&middot;&nbsp; <a href="' + APP + '" style="color:' + LIGHT + ';text-decoration:none">stewardmd.in</a><br>Copyright &copy; ' + new Date().getFullYear() + ' ' + COMPANY + '. All rights reserved.</div>' +
    '</td></tr>';
}

/* Assemble the page. bodyHtml is anything built from the components above; `title` renders as the
 * headline unless opts.noHeadline. Width 600 like every major brand mail; single column so it reads
 * identically on a phone. */
export function renderEmail(o) {
  o = o || {};
  var head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>' + esc(o.title || "StewardMD") + '</title>' +
    '<style>body{margin:0;padding:0;background:' + PAGE + '} img{border:0;outline:none;text-decoration:none} a{color:' + TEAL + '} @media (max-width:640px){.smd-h1{font-size:30px !important} .smd-pad{padding-left:20px !important;padding-right:20px !important}}</style></head>';
  return head +
    '<body style="margin:0;padding:0;background:' + PAGE + ';-webkit-text-size-adjust:100%">' +
    (o.preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">' + esc(o.preheader) + '&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>' : "") +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + PAGE + '"><tr><td align="center" style="padding:28px 12px 36px">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:28px">' +
        '<tr><td class="smd-pad" style="padding:44px 32px 0;text-align:center">' +
          '<img src="' + MARK + '" width="44" height="44" alt="StewardMD" style="display:inline-block;width:44px;height:44px">' +
          '<div style="font-family:' + FONT + ';font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:' + INK + ';margin-top:10px">StewardMD</div>' +
        '</td></tr>' +
        '<tr><td class="smd-pad" style="padding:34px 32px 8px">' +
          (o.noHeadline ? "" : headline(esc(o.title || ""), o.subtitle ? esc(o.subtitle) : "")) +
          (o.bodyHtml || "") +
        '</td></tr>' +
        footer({ marketing: o.kind === "marketing", unsub: o.unsub || "" }) +
      '</table>' +
    '</td></tr></table></body></html>';
}

export async function sendBranded(env, o) {
  // Preview/test hook: an env carrying __EMAIL_CAPTURE(opts) gets the assembled options and no send.
  if (env && typeof env.__EMAIL_CAPTURE === "function") { env.__EMAIL_CAPTURE(o); return { ok: true, captured: true }; }
  if (!env.RESEND_API_KEY || !o || !o.to) return { ok: false, skipped: true };
  var marketing = o.kind === "marketing";
  var headers = {};
  var unsub = "";
  if (marketing && o.uid) {
    var tok = await unsubToken(env, o.uid);
    unsub = unsubUrl(tok);
    if (unsub) {
      headers["List-Unsubscribe"] = "<" + unsub + ">";
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
  }
  var payload = {
    from: fromAddr(env), to: [o.to], reply_to: o.replyTo || undefined, subject: o.subject,
    html: renderEmail({ title: o.title, subtitle: o.subtitle, bodyHtml: o.bodyHtml, preheader: o.preheader, kind: o.kind, unsub: unsub, noHeadline: o.noHeadline }),
  };
  if (Object.keys(headers).length) payload.headers = headers;
  var r;
  try {
    r = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) { try { console.warn("[email] exception:", String(e)); } catch (x) {} return { ok: false }; }
  if (!r.ok) { try { console.warn("[email] send failed:", await r.text()); } catch (x) {} return { ok: false }; }
  return { ok: true, marketing: marketing, unsub: !!unsub };
}

function greet(name, fallback) { return name ? "Dr. " + esc(name) : (fallback || "Doctor"); }

/* ── transactional ───────────────────────────────────────────────────────────────────────────── */

// One-time passcode for email verification during sign-up.
export function emailOtp(env, { email, name, code, minutes }) {
  var m = minutes || 10;
  return sendBranded(env, {
    to: email,
    subject: code + " is your StewardMD verification code",
    title: "Verify your email",
    subtitle: "Enter this code in StewardMD to confirm this address and finish setting up your account.",
    preheader: "Your StewardMD verification code is " + code + " (valid " + m + " minutes).",
    bodyHtml: codeBox(code) + note("This code expires in " + m + " minutes. If you did not request it, you can ignore this email. Nothing was changed."),
  });
}

// Password-reset code: the doctor enters this and chooses a new password in-app.
export function emailResetCode(env, { email, name, code, minutes }) {
  var m = minutes || 10;
  return sendBranded(env, {
    to: email,
    subject: code + " is your StewardMD password reset code",
    title: "Reset your password",
    subtitle: "Use this code in StewardMD, then choose a new password.",
    preheader: "Your StewardMD password reset code is " + code + " (valid " + m + " minutes).",
    bodyHtml: codeBox(code) + note("This code expires in " + m + " minutes. If you did not request a reset, ignore this email. Your password is unchanged."),
  });
}

// Temporary password fallback.
export function emailTempPassword(env, { email, name, password }) {
  return sendBranded(env, {
    to: email,
    subject: "Your StewardMD temporary password",
    title: "Temporary password",
    subtitle: "Sign in with this password, then change it from Account.",
    preheader: "Sign in with this temporary password, then change it in Account.",
    bodyHtml: '<p style="margin:28px 0 0;text-align:center"><span style="display:inline-block;font-family:\'SF Mono\',Menlo,Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:2px;color:' + INK + ';background:' + TILE + ';border-radius:16px;padding:18px 22px">' + esc(password) + '</span></p>' +
      note("For your security, change this password as soon as you sign in. If you did not request this, write to <a href=\"mailto:support@stewardmd.in\" style=\"color:" + TEAL + "\">support@stewardmd.in</a>."),
  });
}

export function emailVerified(env, { email, name, regNo, council }) {
  return sendBranded(env, {
    to: email,
    subject: "You are verified. Everything is unlocked.",
    title: "You are verified.",
    subtitle: (name ? "Dr. " + name + ", your" : "Your") + " medical registration is now linked to your StewardMD account.",
    preheader: "Your medical registration is verified. Full access is now unlocked.",
    bodyHtml:
      facts([["Registration", regNo || "on file"], ["Council", council || "on file"]]) +
      tile({ glyph: "&#8478;", title: "Prescriptions, unlocked.", text: "The prescription generator, the verified badge and full trust across shared units are now yours." }) +
      ctaRow("Open StewardMD", APP),
  });
}

/* Day-5 warning before an unverified account is removed. Sent ONCE (guarded by purgeWarnedAt) and
 * always at least two days before the account is touched. This is an account notice, so it is NOT
 * suppressed by an unsubscribe: nobody may lose an account without having been told. */
export function emailVerifyReminder(env, { email, name, daysLeft }) {
  var d = (daysLeft && +daysLeft > 0) ? +daysLeft : 2;
  return sendBranded(env, {
    to: email,
    subject: "Verify your registration to keep your StewardMD account",
    title: "Verify to keep your account.",
    subtitle: "StewardMD is for registered doctors. Verify within " + d + " day" + (d === 1 ? "" : "s") + " or this account will be removed.",
    preheader: "Your StewardMD account is not verified yet. Verify within " + d + " days to keep it.",
    bodyHtml:
      hero({ eyebrow: "Time left", big: d + (d === 1 ? " day" : " days"), small: "It takes about a minute: Account &amp; Verification, then upload your NMC or State Medical Council certificate, or enter your registration number with a photo ID." }) +
      tile({ glyph: "&#10003;", title: "Verified doctors get Pro free for 7 days.", text: "MaiK AI, Ward Sync, Lab Watch and the prescription generator, on the house, once your registration is confirmed." }) +
      ctaRow("Verify now", APP) +
      note("Already verified? Then this email is not for you and you can ignore it."),
  });
}

export function emailProConfirmation(env, { email, name, until, forever, trial }) {
  var dur = forever ? "for life" : (trial ? "for a 7-day free trial" : (until ? "until " + esc(until) : ""));
  return sendBranded(env, {
    to: email,
    subject: trial ? "Your StewardMD Pro trial is on" : "StewardMD Pro is on",
    title: trial ? "Pro is on." : "Welcome to Pro.",
    subtitle: greet(name) + ", everything is switched on for you " + dur + ".",
    preheader: "Pro is active on your account. Everything is unlocked.",
    bodyHtml:
      tile({ eyebrow: "MaiK AI", title: "Ask anything about the case.", text: "Deep review, imaging reads, scribe and cited evidence, without the free monthly cap." }) +
      tile({ eyebrow: "Ward Sync and Lab Watch", title: "The ward comes to you.", text: "Your live ward list in one tap, and an alert the moment a critical result lands." }) +
      tile({ eyebrow: "Team", title: "Shared units, shared cases.", text: "ICU and ward units with tasks and a live timeline, synced across your devices." }) +
      ctaRow("Open StewardMD", APP),
  });
}

export function emailFailed(env, { email, name, reason }) {
  return sendBranded(env, {
    to: email,
    subject: "StewardMD verification: action needed",
    title: "We could not verify your registration yet.",
    subtitle: "Full access, including the prescription generator, is on hold until it matches the council register.",
    preheader: "Your StewardMD verification needs another look.",
    replyTo: env.SUPPORT_EMAIL || "support@stewardmd.in",
    bodyHtml:
      (reason ? facts([["What we saw", reason]]) : "") +
      tile({ glyph: "&#128269;", title: "Check the number, re-upload a clear image.", text: "Most failures are a mistyped registration number or a certificate photo the register cannot read. Fix either in the app and it is re-checked at once." }) +
      ctaRow("Re-verify in StewardMD", APP) +
      note("Think this is a mistake? Reply to this email and a person will look at it."),
  });
}

/* ── lifecycle (marketing: carries unsubscribe) ──────────────────────────────────────────────── */

export function emailWelcome(env, { email, name, uid }) {
  var p = dayPrices(env);
  return sendBranded(env, {
    to: email, uid: uid, kind: "marketing",
    subject: "Welcome to StewardMD.",
    title: "Welcome, " + (name ? "Dr. " + name : "Doctor") + ".",
    subtitle: "A clinical co-pilot that works offline, reasons with you and follows you to the bedside. Here is where to start.",
    preheader: "Reasoning, calculators, drug checks and MaiK AI, built for doctors. Start here.",
    bodyHtml:
      hero({ eyebrow: "Step one", big: "Verify.", small: "Upload your registration certificate or enter your registration number with a photo ID. About a minute, checked against the medical register." }) +
      tile({ eyebrow: "Always free", title: "Reason, score, check.", text: "Live differentials, every risk score and calculator, drug interaction checks and antimicrobial stewardship. Offline, on the ward, no signal needed." }) +
      tile({ eyebrow: "MaiK AI", title: "Ask the case.", text: "Grounded answers with citations, imaging reads from a photo, and a scribe that turns dictation into a structured note." }) +
      tile({ eyebrow: "Pro", title: "From " + inr(p.pro.day) + " a day.", text: "Less than a roadside chai. Verified doctors get it free for 7 days.", link: "See what Pro unlocks", href: APP + "/?pro=1" }) +
      ctaRow("Verify my registration", APP, "Open StewardMD", APP),
  });
}

// Pro upsell. promoActive frames it as "keep your free Pro"; otherwise a straight upgrade.
export function emailProUpsell(env, { email, name, uid, promoActive, promoUntilStr }) {
  var p = dayPrices(env);
  return sendBranded(env, {
    to: email, uid: uid, kind: "marketing",
    subject: promoActive ? "Your Pro is on. Here is what you would be keeping." : "Pro. " + inr(p.pro.day) + " a day.",
    title: promoActive ? "Pro is on. Keep it." : "Pro. " + inr(p.pro.day) + " a day.",
    subtitle: promoActive
      ? "You are on StewardMD Pro free" + (promoUntilStr ? " until " + promoUntilStr : " during launch") + ". Everything below is already switched on for you."
      : "The clinical engine is free forever. Pro is the layer that saves you time on every shift, for less than a roadside chai.",
    preheader: "MaiK AI, Ward Sync, Lab Watch 24/7, team collaboration and cross-device sync.",
    bodyHtml:
      hero({ eyebrow: "StewardMD Pro", big: inr(p.pro.day) + "/day", small: inr(p.pro.month) + " a month, or " + inr(p.annual.year) + " a year (" + inr(p.annual.day) + " a day). Cancel any time." }) +
      tile({ eyebrow: "MaiK AI, unlimited", title: "Deep case review. No cap.", text: "Imaging, scribe and evidence-cited answers without the free monthly limit." }) +
      tile({ eyebrow: "Ward Sync and Lab Watch 24/7", title: "Know before the phone rings.", text: "Your live ward list in one tap, and a background alert when a critical result lands." }) +
      tile({ eyebrow: "Team and sync", title: "Your patients follow you.", text: "Shared ICU and ward units, tasks, a live timeline, and cases that sync across devices." }) +
      ctaRow(promoActive ? "Keep Pro after launch" : "Upgrade to Pro", APP + "/?pro=1", "Compare plans", APP + "/?pro=1") +
      note("Not ready? The free clinical tools stay exactly as they are."),
  });
}

/* ── alerts ──────────────────────────────────────────────────────────────────────────────────── */

// A generic operational alert (a critical lab landed, a referral arrived, a unit invited you). Never
// carries PHI: the caller passes a headline and a neutral line; the detail lives behind the button.
export function emailAlert(env, { email, name, title, line, cta, href, preheader }) {
  return sendBranded(env, {
    to: email,
    subject: title,
    title: title,
    subtitle: line || "",
    preheader: preheader || line || title,
    bodyHtml: ctaRow(cta || "Open StewardMD", href || APP) + note("Alerts never contain patient details. Open the app to see the full record."),
  });
}
