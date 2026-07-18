/* Shared branded transactional email for StewardMD (Resend).
   From noreply@stewardmd.in by default (set FROM_EMAIL to override). Sending from a
   @stewardmd.in address requires the domain to be verified in Resend (DNS records);
   until then set FROM_EMAIL to a verified sender or Resend will reject the send. */

const LOGO = "https://stewardmd.in/android-chrome-192x192.png";
const TEAL = "#0e6e63";
const APP = "https://stewardmd.in";

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export function fromAddr(env) { return env.FROM_EMAIL || "StewardMD <noreply@stewardmd.in>"; }
function btnTo(label, href) { return '<p style="margin:22px 0 6px"><a href="' + (href || APP) + '" style="background:' + TEAL + ';color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;display:inline-block">' + label + '</a></p>'; }
function btn(label) { return btnTo(label, APP); }
// A titled feature group: a small teal heading + a tight bullet list. Keeps the tour scannable.
function featureGroup(title, items) {
  return '<div style="margin:14px 0 4px">' +
    '<div style="font-weight:800;font-size:12.5px;color:' + TEAL + ';letter-spacing:.02em;text-transform:uppercase;margin-bottom:3px">' + esc(title) + '</div>' +
    '<ul style="font-size:13.5px;line-height:1.75;color:#2d4356;padding-left:18px;margin:2px 0">' +
    items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul></div>';
}

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
  const verifyBox =
    '<div style="margin:20px 0 6px;padding:14px 16px;border:1px solid #cfe8e2;border-radius:12px;background:#f0f8f6">' +
      '<div style="font-weight:800;font-size:14px;color:#0b5a51;margin-bottom:4px">One step to unlock everything: verify your registration</div>' +
      '<div style="font-size:13px;line-height:1.6;color:#2d4356">Verified doctors get the <b>prescription (℞) generator</b>, a <b>verified badge</b>, and full trust across shared units. It takes a minute — upload a registration certificate <i>or</i> enter your reg-no + a photo ID, and we check it against the medical register.</div>' +
      btnTo("Verify my registration", APP) +
    '</div>';
  return sendBranded(env, {
    to: email,
    subject: "Welcome to StewardMD — here's everything you can do 🩺",
    title: "Welcome to StewardMD",
    preheader: "Your clinical co-pilot: reasoning, ward tools, AI, and offline reference — built for doctors.",
    bodyHtml:
      '<p style="font-size:14px;line-height:1.6">Hi ' + (name ? esc(name) : "Doctor") + ', welcome aboard. StewardMD is a clinical co-pilot built for practising doctors — it works <b>offline</b>, thinks <b>with you</b>, and follows you to the <b>bedside</b>. Here\'s what you now have:</p>' +
      featureGroup("Reason & decide — instantly, offline", [
        "Structured differentials from the presenting picture",
        "Risk scores &amp; clinical calculators at your fingertips",
        "Drug&#8211;drug interaction checks before you prescribe",
        "Antimicrobial stewardship &amp; antibiogram guidance",
      ]) +
      featureGroup("MaiK — your AI clinical assistant", [
        "Deep, grounded clinical reasoning on a full case",
        "Reads imaging &amp; lab reports you snap a photo of",
        "Voice scribe that turns dictation into structured notes",
        "Evidence-cited answers, not black-box guesses",
      ]) +
      featureGroup("At the bedside", [
        "Ward Sync — pull your live ward list in seconds",
        "Lab Watch 24/7 — get alerted the moment a new result lands, even when the app is closed",
        "ICU &amp; Ward dashboards you can share with your team",
      ]) +
      featureGroup("Prescribe & reference", [
        "℞ generator with database-driven dosing (verified doctors)",
        "Offline knowledge base &amp; live medical updates",
      ]) +
      verifyBox +
      '<p style="font-size:12px;color:#7690a6;margin-top:14px">StewardMD is an educational aid — always verify every recommendation and dose against the primary source and your own clinical judgment.</p>',
  });
}

// Pro upsell — sold on the real feature set + the launch promo (Pro free until promoUntilStr).
// promoActive frames it as "keep your free Pro"; otherwise a straight upgrade. Never invents stats.
export function emailProUpsell(env, { email, name, promoActive, promoUntilStr }) {
  const promoBanner = promoActive
    ? '<div style="margin:6px 0 14px;padding:12px 14px;border-radius:12px;background:#0b5a51;color:#eafaf6;font-weight:600;font-size:13px;line-height:1.5">' +
        '🎁 You\'re on <b>StewardMD Pro — free</b>' + (promoUntilStr ? ' until <b>' + esc(promoUntilStr) + '</b>' : ' during launch') +
        '. Everything below is switched on for you right now. Here\'s what you\'d be keeping.</div>'
    : '';
  return sendBranded(env, {
    to: email,
    subject: promoActive ? "Your StewardMD Pro is on — here's what it unlocks" : "Unlock the full StewardMD with Pro",
    title: promoActive ? "You're on StewardMD Pro" : "Get more done with StewardMD Pro",
    preheader: "MaiK AI, Ward Sync, Lab Watch 24/7, team collaboration, and cross-device sync.",
    bodyHtml:
      '<p style="font-size:14px;line-height:1.6">' + (name ? "Dr. " + esc(name) : "Doctor") + ', the clinical engine — reasoning, calculators, drug checks, stewardship, offline reference — is <b>always free</b>. <b>Pro</b> turns on the layer that saves you time on every shift:</p>' +
      promoBanner +
      '<ul style="font-size:13.5px;line-height:1.85;color:#2d4356;padding-left:18px">' +
        '<li><b>MaiK AI, unlimited</b> — deep case review, imaging, scribe &amp; evidence without the free monthly cap</li>' +
        '<li><b>Ward Sync</b> — your live ward list, one tap</li>' +
        '<li><b>Lab Watch 24/7</b> — background alerts when a critical result lands</li>' +
        '<li><b>Team collaboration</b> — shared ICU/Ward units, tasks &amp; a live timeline</li>' +
        '<li><b>Cross-device sync &amp; case sharing</b> — your patients follow you across devices; share a case by link</li>' +
        '<li><b>Full drug database</b> — no lookup limits</li>' +
      '</ul>' +
      btnTo(promoActive ? "See Pro &amp; keep it after launch" : "Upgrade to Pro", APP + "/?pro=1") +
      '<p style="font-size:12px;color:#7690a6;margin-top:10px">Not ready? No problem — the free clinical tools stay exactly as they are. StewardMD is an educational aid; verify against the primary source.</p>',
  });
}
