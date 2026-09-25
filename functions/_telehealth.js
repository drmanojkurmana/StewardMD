/* functions/_telehealth.js - video consultations for the OPD (pure rules; the router and the queue engine do the I/O).
 *
 * OFF BY DEFAULT. A hospital turns video on by naming a Jitsi-compatible server on its settings
 * (org.wardsynq.telehealth.baseUrl). No server named = no teleconsult option anywhere, and every route refuses.
 *
 * THE ROOM NAME CARRIES NOTHING ABOUT THE PATIENT. It is "wsq-" + 128 random bits in hex, minted once per visit and
 * kept on the ticket. A Jitsi room is open to anyone who knows its name, so the name is the lock: unguessable, and
 * never built from a name, MR number, token or date that someone could reconstruct.
 *
 * THE PATIENT NEVER SEES THE ROOM UNTIL THE DOCTOR HAS STARTED. The patient's link is the ticket's own signed token
 * (functions/_queue.js) on OUR domain: /tele?t=... shows a waiting page, and the room address is handed out only
 * while the visit is in consultation. The token dies with the visit (setStatus bumps tokenVer on completed and
 * cancelled), so a forwarded link opens nothing afterwards.
 *
 * A PUBLIC SERVER IS ALLOWED AND SAID. meet.jit.si works, but the video then passes through a server the hospital
 * does not run; the settings answer carries publicServer so the screen says so. Self-hosted is recommended.
 */

export const PUBLIC_HOSTS = Object.freeze(["meet.jit.si", "8x8.vc"]);
/* Who agreed to the video consultation. The same people consent.js records as givers; a clinician's emergency
 * override is not among them, because a video visit is never the emergency. */
export const TELE_GIVERS = Object.freeze(["patient", "parent", "legal-guardian", "next-of-kin", "power-of-attorney"]);
/* The statuses in which a video visit is still live. Anything else (done, cancelled, no-show, sent for tests,
 * booked back) and the patient's page says the visit has ended. */
const LIVE = Object.freeze(["registered", "waiting", "called", "in_consultation"]);

/** PURE. Validate the server a hospital typed. "" turns video off. Returns { ok, baseUrl, publicServer } or { ok:false, error }. */
export function providerFrom(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { ok: true, baseUrl: "", publicServer: false };
  let u;
  try { u = new URL(s); } catch (e) { return { ok: false, error: "invalid_url" }; }
  if (u.protocol !== "https:") return { ok: false, error: "https_required" };
  if (u.username || u.password || u.search || u.hash) return { ok: false, error: "plain_address_required" };
  const baseUrl = (u.origin + u.pathname).replace(/\/+$/, "");
  return { ok: true, baseUrl, publicServer: PUBLIC_HOSTS.includes(u.hostname.toLowerCase()) };
}

/** COMING SOON (owner, 2026-09-25). Video visits ship switched off for every hospital until the deployment sets
 * TELEHEALTH_READY=1: no screen offers them, every route refuses, and Admin shows "coming soon" instead of the form. */
export function telehealthReady(env) { return !!env && String(env.TELEHEALTH_READY || "") === "1"; }

/** PURE. The hospital's video settings as the screens read them. A saved value that no longer validates reads as off. */
export function telehealthSettings(org, env) {
  if (!telehealthReady(env)) return { on: false, baseUrl: "", publicServer: false, comingSoon: true };
  const saved = org && org.wardsynq && org.wardsynq.telehealth;
  const p = providerFrom(saved && saved.baseUrl);
  if (!p.ok || !p.baseUrl) return { on: false, baseUrl: "", publicServer: false };
  return { on: true, baseUrl: p.baseUrl, publicServer: p.publicServer };
}

/** 128 random bits, hex. No patient data can be in it because nothing but the random bytes goes in. */
export function newRoomName() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let h = "";
  for (let i = 0; i < b.length; i++) h += b[i].toString(16).padStart(2, "0");
  return "wsq-" + h;
}
export function isRoomName(s) { return /^wsq-[0-9a-f]{32}$/.test(String(s || "")); }
export function roomUrl(baseUrl, room) {
  if (!baseUrl || !isRoomName(room)) return "";
  return String(baseUrl).replace(/\/+$/, "") + "/" + room;
}

/** PURE. Is this ticket's video visit open, and may the patient enter the room now? */
export function joinState(ticket) {
  const t = ticket || {};
  if (!t.teleconsult || !isRoomName(t.teleRoom)) return { live: false, ready: false, reason: "not_teleconsult" };
  if (!LIVE.includes(t.status)) return { live: false, ready: false, reason: "visit_closed" };
  return { live: true, ready: t.status === "in_consultation", reason: "" };
}

/** PURE. The consent the desk recorded, or why it cannot be taken. body.teleConsent = { givenBy, agreed: true }. */
export function consentFrom(c) {
  if (!c || c.agreed !== true) return { ok: false, error: "consent_required" };
  // Who agreed is part of the consent: never assumed to be the patient.
  if (!c.givenBy) return { ok: false, error: "giver_required" };
  const givenBy = String(c.givenBy);
  if (!TELE_GIVERS.includes(givenBy)) return { ok: false, error: "unknown_giver" };
  return { ok: true, givenBy };
}

/** The patient's address for the waiting page: our domain, the signed ticket token, nothing else. */
export function patientLink(base, token) { return String(base || "https://stewardmd.in").replace(/\/+$/, "") + "/tele?t=" + token; }
/** The message that carries it. No name, no MR number, no diagnosis: only that there is a video visit and where. */
export function inviteText(url) {
  return "Your video consultation link (private, for today only): " + url + " Open it at your appointment time and keep the page open until the doctor starts the call. Do not share this link.";
}
