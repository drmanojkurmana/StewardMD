/* Shared branded transactional email for StewardMD (Resend).
   From noreply@stewardmd.in by default (set FROM_EMAIL to override). Sending from a
   @stewardmd.in address requires the domain to be verified in Resend (DNS records);
   until then set FROM_EMAIL to a verified sender or Resend will reject the send. */

const LOGO = "https://stewardmd.in/android-chrome-192x192.png";
const TEAL = "#0e6e63";
const APP = "https://stewardmd.in";

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export function fromAddr(env) { return env.FROM_EMAIL || "StewardMD <noreply@stewardmd.in>"; }
function btn(label) { return '<p style="margin:22px 0 6px"><a href="' + APP + '" style="background:' + TEAL + ';color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;display:inline-block">' + label + '</a></p>'; }

function shell(title, bodyHtml, preheader) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
    '<body style="margin:0;background:#f6f7f5;font-family:-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#14202b">' +
    (preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc(preheader) + '</div>' : "") +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f5;padding:24px 12px"><tr><td align="center">' +
      '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">' +
        '<tr><td style="background:' + TEAL + ';padding:24px 28px;text-align:center">' +
          '<img src="' + LOGO + '" width="46" height="46" alt="StewardMD" style="border-radius:11px">' +
          '<div style="color:#fff;font-size:21px;font-weight:800;margin-top:8px;letter-spacing:-.01em">Steward<span style="color:#8fe3d6">MD</span></div>' +
        '</td></tr>' +
        '<tr><td style="padding:28px 28px 8px">' +
          '<h1 style="font-size:19px;margin:0 0 14px;color:#14202b">' + esc(title) + '</h1>' + bodyHtml +
        '</td></tr>' +
        '<tr><td style="padding:18px 28px 24px;border-top:1px solid #eef2f4;color:#7690a6;font-size:11.5px;line-height:1.6">' +
          'StewardMD · clinical decision support for qualified clinicians.<br>' +
          'An educational aid — verify every recommendation and dose against the primary source.<br>' +
          '<a href="' + APP + '" style="color:' + TEAL + '">stewardmd.in</a> · © StewardMD · All rights reserved' +
        '</td></tr>' +
      '</table>' +
    '</td></tr></table></body></html>';
}

export async function sendBranded(env, { to, subject, title, bodyHtml, preheader, replyTo }) {
  if (!env.RESEND_API_KEY || !to) return { ok: false, skipped: true };
  let r;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddr(env), to: [to], reply_to: replyTo || undefined, subject: subject, html: shell(title, bodyHtml, preheader) }),
    });
  } catch (e) { try { console.warn("[email] exception:", String(e)); } catch (x) {} return { ok: false }; }
  if (!r.ok) { try { console.warn("[email] send failed:", await r.text()); } catch (x) {} return { ok: false }; }
  return { ok: true };
}

export function emailVerified(env, { email, name, regNo, council }) {
  return sendBranded(env, {
    to: email,
    subject: "✓ Your StewardMD account is verified",
    title: "You're verified ✓",
    preheader: "Your medical registration is verified — full access is now unlocked.",
    bodyHtml:
      '<p style="font-size:14px;line-height:1.6">' + (name ? "Dr. " + esc(name) : "Doctor") + ', your medical registration has been verified and linked to your StewardMD account.</p>' +
      '<table cellpadding="6" style="font-size:14px;margin:6px 0"><tr><td style="color:#7690a6">Registration No</td><td><b>' + esc(regNo || "—") + '</b></td></tr>' +
      '<tr><td style="color:#7690a6">Council</td><td><b>' + esc(council || "—") + '</b></td></tr></table>' +
      '<p style="font-size:14px;line-height:1.6">You now have full access, including the prescription generator. Welcome aboard.</p>' + btn("Open StewardMD"),
  });
}

export function emailProConfirmation(env, { email, name, until, forever, trial }) {
  var dur = forever ? "lifetime access" : (trial ? "a 7-day free trial" : (until ? "access until " + until : "Pro access"));
  return sendBranded(env, {
    to: email,
    subject: trial ? "Your StewardMD Pro trial is active 🎉" : "StewardMD Pro is active 🎉",
    title: "You're on StewardMD Pro",
    preheader: "Pro is active on your account — everything unlocked.",
    bodyHtml:
      '<p style="font-size:14px;line-height:1.6">' + (name ? "Dr. " + esc(name) : "Doctor") + ', your StewardMD <b>Pro</b> ' + (trial ? "trial" : "subscription") + ' is now active — ' + esc(dur) + '.</p>' +
      '<p style="font-size:14px;line-height:1.6;color:#2d4356">You now have the full intelligence layer:</p>' +
      '<ul style="font-size:14px;line-height:1.8;color:#2d4356;padding-left:18px">' +
        '<li>MaiK AI — deep review, imaging, scribe, evidence</li>' +
        '<li>Ward Sync &amp; Lab Watch 24/7</li>' +
        '<li>Team collaboration, cross-device sync &amp; case sharing</li>' +
        '<li>Full drug database</li>' +
      '</ul>' + btn("Open StewardMD"),
  });
}

export function emailFailed(env, { email, name, reason }) {
  return sendBranded(env, {
    to: email,
    subject: "StewardMD verification — action needed",
    title: "We couldn't verify your registration yet",
    preheader: "Your StewardMD verification needs another look.",
    replyTo: env.SUPPORT_EMAIL || "support@stewardmd.in",
    bodyHtml:
      '<p style="font-size:14px;line-height:1.6">' + (name ? "Dr. " + esc(name) : "Doctor") + ", we couldn't verify your medical registration against the council register, so full access (including the prescription generator) is on hold.</p>" +
      (reason ? '<p style="font-size:13px;color:#7690a6">Reason: ' + esc(reason) + '</p>' : "") +
      '<p style="font-size:14px;line-height:1.6">Please double-check your registration number and re-upload a clear certificate or ID in the app. If you think this is a mistake, just reply to this email and we\'ll take a look.</p>' + btn("Re-verify in StewardMD"),
  });
}

export function emailWelcome(env, { email, name }) {
  return sendBranded(env, {
    to: email,
    subject: "Welcome to StewardMD 🩺",
    title: "Welcome to StewardMD",
    preheader: "Clinical decision support, built for doctors.",
    bodyHtml:
      '<p style="font-size:14px;line-height:1.6">Hi ' + (name ? esc(name) : "there") + ', thanks for joining StewardMD — clinical decision support built for doctors.</p>' +
      '<ul style="font-size:14px;line-height:1.8;color:#2d4356;padding-left:18px">' +
        '<li>Structured clinical reasoning &amp; live differentials</li>' +
        '<li>Antibiotic stewardship &amp; drug-interaction checks</li>' +
        '<li>Calculators, Ward Sync, and ICU tools</li>' +
      '</ul>' +
      '<p style="font-size:14px;line-height:1.6">To unlock the prescription generator, verify your medical registration in the app.</p>' + btn("Open StewardMD") +
      '<p style="font-size:12px;color:#7690a6;margin-top:14px">A reminder: StewardMD is an educational aid — always verify against the primary source and your own clinical judgment.</p>',
  });
}
