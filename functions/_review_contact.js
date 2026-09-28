/* functions/_review_contact.js - "who is this, and how do I reach them?" for the manual-review email.
 *
 * Owner 2026-09-28, screenshot of a student review: signed in with Apple Hide My Email, no reg number,
 * nothing read off the card, so the email to support named nobody and gave no way to reach them. The
 * account usually knows more than the token: the profile form (name is required), a mobile number
 * (OTP-verified, or at least typed), a real email the user anchored. This gathers those.
 *
 * Owner-only: the result goes into the email to SUPPORT_EMAIL, never back to a client. Doctor contact
 * details, not patient data. Best effort throughout: a slow or failed read leaves a field empty and the
 * review email still goes out.
 */
import { fsGet } from "./_fbfirestore.js";
import { getLifecycle } from "./_lifecycle.js";
import { normalizePhone } from "./_phone_otp.js";

const READ_TIMEOUT_MS = 2500;

// Same test as anchor-email.js PROXY_RE: exactly appleid.com or *.appleid.com.
export function isAppleRelay(email) {
  return /@(?:[^@]*\.)?appleid\.com$/i.test(String(email || "").trim());
}

const str = (v) => (v == null ? "" : String(v).trim());

// Pure: merge what the token, the profile doc and the lifecycle record say into one contact card.
// Phone priority: the OTP-verified number (lifecycle, server truth) > the profile's verified number >
// whatever was typed into the profile form (shown as not verified).
export function contactFrom({ email, token, profile, lifecycle, defaultCc } = {}) {
  const p = profile || {}, lc = lifecycle || {}, t = token || {};
  const provider = str(t.firebase && t.firebase.sign_in_provider);
  let phone = "", phoneVerified = false;
  if (lc.phoneVerifiedAt && lc.phone) { phone = normalizePhone(lc.phone, defaultCc); phoneVerified = !!phone; }
  if (!phone && p.phoneVerifiedNumber) { phone = normalizePhone(p.phoneVerifiedNumber, defaultCc); phoneVerified = !!phone; }
  if (!phone && p.phone) phone = normalizePhone(p.phone, defaultCc);
  const profileName = str(p.name);
  const signInName = str(t.name) || str(lc.name);
  const anchor = str(p.anchorEmail).toLowerCase();
  const account = str(email).toLowerCase();
  const realEmail = anchor && !isAppleRelay(anchor) ? anchor : (account && !isAppleRelay(account) ? account : "");
  return {
    name: profileName || signInName,
    nameSource: profileName ? "profile" : (signInName ? "sign-in" : ""),
    phone,
    phoneVerified,
    whatsapp: phone ? "https://wa.me/" + phone : "",
    realEmail,
    realEmailVerified: realEmail ? (realEmail === anchor ? p.anchorEmailVerified === true : true) : false,
    relay: isAppleRelay(account),
    provider,
    college: str(p.hospital),
    degree: str(p.degree),
    place: [str(p.city), str(p.state)].filter(Boolean).join(", "),
    smdId: str(p.smdId),
  };
}

// True when the card gives the owner nothing to go on beyond the uid.
export function isAnonymous(c) {
  return !c || (!c.name && !c.phone && !c.realEmail);
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// deps (tests): { fsGet(env, path), getLifecycle(env, uid) }
export async function gatherReviewContact(env, uid, { email, token } = {}, deps = {}) {
  const readDoc = deps.fsGet || fsGet;
  const readLc = deps.getLifecycle || getLifecycle;
  const [doc, lifecycle] = await Promise.all([
    withTimeout(readDoc(env, "users/" + uid + "/profile/self"), READ_TIMEOUT_MS),
    withTimeout(readLc(env, uid), READ_TIMEOUT_MS),
  ]);
  return contactFrom({
    email, token, lifecycle,
    profile: (doc && doc.fields) || null,
    defaultCc: env && env.FOLLOWCARE_DEFAULT_CC,
  });
}

export function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Pure: the "Who is this" block for the review email. Every value is escaped: the name and college
// are typed by the user, so they must not be able to inject markup (or a fake button) into the owner's
// inbox.
export function contactHtml(c) {
  c = c || {};
  const row = (k, v) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`;
  const rows = [];
  rows.push(row("Name", c.name
    ? escHtml(c.name) + (c.nameSource === "sign-in" ? " <i>(from sign-in)</i>" : "")
    : "<i>not given</i>"));
  if (c.phone) {
    rows.push(row("Mobile", "+" + escHtml(c.phone) + (c.phoneVerified ? " (OTP verified)" : " <i>(typed, not verified)</i>") +
      ` &nbsp;<a href="${escHtml(c.whatsapp)}">WhatsApp</a> &nbsp;<a href="tel:+${escHtml(c.phone)}">Call</a>`));
  } else {
    rows.push(row("Mobile", "<i>not given</i>"));
  }
  if (c.realEmail) {
    rows.push(row("Email", `<a href="mailto:${escHtml(c.realEmail)}">${escHtml(c.realEmail)}</a>` +
      (c.realEmailVerified ? "" : " <i>(not verified)</i>")));
  }
  if (c.college) rows.push(row("College / hospital", escHtml(c.college)));
  if (c.degree) rows.push(row("Degree", escHtml(c.degree)));
  if (c.place) rows.push(row("Place", escHtml(c.place)));
  if (c.smdId) rows.push(row("StewardMD ID", escHtml(c.smdId)));
  if (c.provider) rows.push(row("Signed in with", escHtml(c.provider)));

  let notes = "";
  if (c.relay) {
    notes += `<p style="font:400 12px system-ui;color:#b45309">Apple Hide My Email account. Mail to the ` +
      `privaterelay address reaches the user only if the sending domain is registered in Apple Developer ` +
      `(Sign in with Apple for Email Communication); otherwise Apple rejects it.</p>`;
  }
  if (isAnonymous(c)) {
    notes += `<p style="font:400 12px system-ui;color:#b45309">No name, mobile or real email on this account yet. ` +
      `The uploaded card below is the only identification.</p>`;
  }
  return `<h3 style="margin:18px 0 6px">Who is this</h3><table cellpadding="6">${rows.join("")}</table>${notes}`;
}
