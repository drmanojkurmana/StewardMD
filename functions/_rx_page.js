/* functions/_rx_page.js — the page a pharmacist actually lands on.
 * ===========================================================================
 * The QR printed on a prescription encodes https://stewardmd.in/verify/<code>. This renders the
 * human answer to it. /verify (with no code, or ?code=) renders the same thing behind a small form,
 * for someone typing the code off the paper because the QR will not scan. The JSON form of the same
 * answer is /api/rx/v/<code>; all three resolve through _rx_public.resolve(), so there is exactly
 * one definition of what a verification discloses.
 *
 * WHY SERVER-RENDERED, WITH NO SCRIPT AT ALL. The reader is a stranger on an unknown device — a
 * pharmacist, a drug inspector, a hospital clerk — often on a bad connection at a counter. A page
 * that needs JavaScript to say "valid" is a page that says nothing when the script does not load.
 * So: one request, complete HTML, no fetch, no font, no image, no analytics. That also lets it
 * carry a genuinely strict CSP (no script permitted at all), which the main app cannot.
 *
 * NOINDEX. A verification result should never be searchable — not because it is secret (it is
 * PHI-free by construction) but because an indexed code is a code someone can find without holding
 * the paper it was printed on.
 *
 * NOTE: /verify must be listed in functions/_middleware.js. Without it the site gate treats an
 * extensionless path as a page view by an anonymous browser and serves the marketing page instead,
 * which is exactly what every scanned QR would otherwise show.
 */
import { resolve } from "./_rx_public.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* The status is the one thing a reader must not misread, so each gets its own colour, its own word,
 * and its own plain-English sentence. No icon-only states, and never colour alone. */
const TONE = {
  ACTIVE:       { bg: "#0f7a4a", label: "Valid prescription",
                  say: "This prescription was issued by the prescriber named below and is still within its validity period." },
  EXPIRED:      { bg: "#8a5a00", label: "Expired",
                  say: "This prescription is genuine but has passed its validity date. It should not be dispensed against." },
  REVOKED:      { bg: "#9b1c1c", label: "Withdrawn by the prescriber",
                  say: "The prescriber withdrew this prescription. Do not dispense against it." },
  ARCHIVED:     { bg: "#4a5568", label: "Archived",
                  say: "This prescription is beyond its retention window and is no longer active." },
  not_found:    { bg: "#4a5568", label: "Not found",
                  say: "No prescription carries that code. Check the code on the paper, or treat the document as unverified." },
  malformed:    { bg: "#4a5568", label: "Not a valid code",
                  say: "That is not a StewardMD prescription code." },
  rate_limited: { bg: "#4a5568", label: "Too many lookups",
                  say: "Too many lookups from this connection. Try again in a minute." },
};

function row(k, v) {
  if (!v && v !== 0) return "";
  return '<div class="r"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>";
}
function dt(ms) {
  const n = Number(ms);
  if (!n) return "";
  try {
    return new Date(n).toLocaleString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  } catch (e) { return new Date(n).toISOString().slice(0, 10); }
}

const CSS = `
:root{color-scheme:light dark;--bg:#f5f6f8;--card:#fff;--ink:#16181d;--mut:#5b6270;--line:#e3e6ec}
@media (prefers-color-scheme:dark){:root{--bg:#101216;--card:#181b21;--ink:#eceef2;--mut:#99a1b0;--line:#282c35}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px 16px 56px}
.w{max-width:560px;margin:0 auto}
.badge{display:block;border-radius:14px;padding:18px 20px;color:#fff;margin-bottom:16px}
.badge b{display:block;font-size:21px;letter-spacing:-.01em;line-height:1.25}
.badge p{margin:8px 0 0;font-size:14.5px;opacity:.95}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 18px;margin-bottom:14px}
.r{display:flex;gap:14px;padding:11px 0;border-bottom:1px solid var(--line)}
.r:last-child{border-bottom:0}
.k{flex:0 0 40%;color:var(--mut);font-size:14px}
.v{flex:1;font-weight:600;word-break:break-word}
h2{font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:20px 0 8px}
ul{list-style:none;margin:0;padding:0}
li{padding:11px 0;border-bottom:1px solid var(--line)}
li:last-child{border-bottom:0}
li b{display:block;font-size:16px}
li span{color:var(--mut);font-size:14px}
.vok{color:#0f7a4a;font-weight:700}.vno{color:#9b1c1c;font-weight:700}
.note{color:var(--mut);font-size:13px;margin-top:18px}
form{display:flex;gap:8px;margin:6px 0 2px}
input{flex:1;min-width:0;padding:13px 14px;font-size:16px;border:1px solid var(--line);border-radius:11px;background:var(--card);color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
button{padding:13px 20px;font-size:16px;font-weight:700;border:0;border-radius:11px;background:#0f7a4a;color:#fff}
`;

function page(body, title) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>" + esc(title) + " · StewardMD</title>" +
    "<style>" + CSS + '</style></head><body><div class="w">' + body + "</div></body></html>";
}

const FORM =
  '<h2>Verify a prescription</h2>' +
  '<form method="GET" action="/verify">' +
    '<input name="code" inputmode="latin" autocapitalize="characters" spellcheck="false" ' +
      'placeholder="XXXX-XXXX-XXXX-XXXX" aria-label="Prescription code">' +
    '<button type="submit">Check</button>' +
  "</form>";

function html(status, body, extra) {
  return new Response(body, {
    status,
    headers: Object.assign({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      // No script runs on this page at all, so say so and mean it.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    }, extra || {}),
  });
}

/* The landing page: no code given yet. */
export function renderForm() {
  return html(200, page(
    '<div class="card" style="padding:18px">' +
      '<b style="font-size:19px">StewardMD prescription check</b>' +
      '<p style="color:var(--mut);margin:8px 0 0;font-size:14.5px">Scan the QR on the prescription, or type the code printed beside it.</p>' +
    "</div>" + FORM +
    '<p class="note">This check confirms who wrote a prescription, whether it is still valid, and the ' +
      'patient\'s initials so you can compare them with the ID in front of you. It shows nothing else ' +
      'about the patient - no name, age, contact or diagnosis, because none of that is in the record.</p>',
    "Verify a prescription"));
}

export async function renderPage(env, request, rawCode) {
  const out = await resolve(env, request, rawCode);
  const b = out.body || {};
  const tone = TONE[b.status] || TONE.not_found;

  let body = '<div class="badge" style="background:' + tone.bg + '">' +
    "<b>" + esc(tone.label) + "</b><p>" +
    esc(b.revokedReason ? tone.say + " Reason given: " + b.revokedReason : tone.say) + "</p></div>";

  if (b.ok) {
    const d = b.doctor || {};
    body += '<div class="card">' +
      row("Prescription code", b.code) +
      row("Issued", dt(b.issuedAt)) +
      row("Valid until", dt(b.validUntil)) +
      (b.schedule ? row("Schedule", b.schedule) : "") +
      (b.refillsAllowed != null ? row("Refills allowed", String(b.refillsAllowed)) : "") +
      "</div>";

    /* Masked initials, with the instruction that makes them useful. Without this the page verifies
     * the DOCUMENT and says nothing about who is holding it, so a stolen PDF for a sleeping pill is
     * dispensed to whoever presents it. Worded as a check to perform, not a fact to read: initials
     * collide constantly, so this is a prompt to look at the ID, never proof of identity by itself. */
    if (b.patientMask) {
      body += '<h2>Patient</h2><div class="card">' +
        row("Initials", b.patientMask) +
        '</div><p class="note">Check these initials against the patient\'s ID. They are not proof of ' +
        'identity - many people share initials - but they should not contradict the person in front of you.</p>';
    }

    body += '<h2>Prescriber</h2><div class="card">' +
      row("Name", d.name || "(not recorded)") +
      row("Registration no.", d.regNo || "(not recorded)") +
      '<div class="r"><div class="k">Registration verified</div><div class="v ' + (d.verified ? "vok" : "vno") + '">' +
        (d.verified ? "Verified by StewardMD" : "NOT verified") + "</div></div>" +
      "</div>";
    if (!d.verified) {
      body += '<p class="note">This prescriber’s registration number has not been verified against a council register. ' +
        "The prescription is genuine to this account, but the registration itself is unconfirmed.</p>";
    }

    const drugs = [].concat(b.drugs || []);
    body += "<h2>" + drugs.length + " drug" + (drugs.length === 1 ? "" : "s") + " on this prescription</h2>" +
      '<div class="card"><ul>' +
      drugs.map(function (x) {
        const sub = [x.dose, x.freq, x.duration].filter(Boolean).join(" · ");
        return "<li><b>" + esc(x.name) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</li>";
      }).join("") + "</ul></div>";
    body += '<p class="note">Compare this list against the paper in your hand. If they differ, the document has been altered.</p>';
  } else {
    body += FORM;
  }

  // Was "shows no patient information", which stopped being true the moment initials were added.
  body += '<p class="note">StewardMD · this page shows the patient\'s initials only - no name, age, ' +
    'contact or diagnosis.</p>';
  const extra = out.retryAfter ? { "retry-after": String(out.retryAfter) } : null;
  return html(out.status, page(body, b.ok ? "Prescription " + (b.code || "") : tone.label), extra);
}
