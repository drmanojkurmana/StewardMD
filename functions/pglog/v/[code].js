/* functions/pglog/v/[code].js — the page an examiner actually lands on.
 * ===========================================================================
 * The QR printed on a logbook page encodes https://stewardmd.in/pglog/v/<code>. This renders the
 * human answer to it. The JSON form of the same answer is /api/pglog/v/<code>; both resolve through
 * `_pglog_public.resolve()`, so there is one definition of what a verification discloses.
 *
 * WHY SERVER-RENDERED, WITH NO SCRIPT AT ALL. The reader is a stranger on an unknown device — an
 * examiner, a University clerk, an employer — often on a bad connection, quite possibly printing the
 * result. A page that needs JavaScript to say "valid" is a page that says nothing when the script
 * does not load. So: one request, complete HTML, no fetch, no font, no image, no analytics. That
 * also lets it carry a genuinely strict CSP (`script-src 'none'`), which the main app cannot.
 *
 * NOINDEX. A verification result should never be searchable — not because it is secret (it is
 * PHI-free by construction) but because a training record is not the public's business, and an
 * indexed code is a code someone can find without holding the paper it was printed on.
 *
 * NOTE: this path must be listed in functions/_middleware.js. Without it the site gate treats an
 * extensionless path as a page view by an anonymous browser and serves the marketing page instead,
 * which is exactly what every scanned QR would have shown.
 */
import { resolve } from "../../_pglog_public.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A signature status is the one thing on this page a reader must not misread, so each gets its own
// colour, its own word, and its own plain-English sentence. No icon-only states.
const TONE = {
  valid:        { bg: "#0f7a4a", label: "Signature valid" },
  superseded:   { bg: "#8a5a00", label: "Superseded" },
  tampered:     { bg: "#9b1c1c", label: "Does not match what was signed" },
  not_found:    { bg: "#4a5568", label: "Not found" },
  malformed:    { bg: "#4a5568", label: "Not a valid code" },
  rate_limited: { bg: "#4a5568", label: "Too many lookups" },
  unavailable:  { bg: "#4a5568", label: "Temporarily unavailable" }
};

function row(k, v) {
  if (!v && v !== 0) return "";
  return '<div class="r"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>";
}
function dt(ms) {
  const n = Number(ms);
  if (!n) return "";
  try {
    return new Date(n).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST";
  } catch (e) { return new Date(n).toISOString(); }
}
function day(s) {
  const t = String(s || "");
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return t;
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return Number(m[3]) + " " + MON[Number(m[2]) - 1] + " " + m[1];
}

function page(body, code) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>Verify logbook signature" + (code ? " " + esc(code) : "") + " · StewardMD</title>" +
    "<style>" + CSS + "</style></head><body>" + body + "</body></html>";
}

const CSS = `
:root{color-scheme:light dark;--bg:#f5f6f8;--card:#fff;--ink:#16181d;--mut:#5b6270;--line:#e3e6ec}
@media (prefers-color-scheme:dark){:root{--bg:#101216;--card:#181b21;--ink:#eceef2;--mut:#99a1b0;--line:#282c35}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px 16px 56px}
.wrap{max-width:560px;margin:0 auto}
.brand{font-weight:700;letter-spacing:.02em;font-size:13px;color:var(--mut);text-transform:uppercase;margin:0 0 14px}
.banner{border-radius:14px;padding:18px 20px;color:#fff}
.banner h1{margin:0;font-size:22px;line-height:1.25}
.banner p{margin:8px 0 0;font-size:14px;opacity:.95}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:4px 18px;margin:14px 0}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:16px 0 10px}
.r{display:flex;gap:14px;padding:8px 0;border-top:1px solid var(--line)}
.r:first-of-type{border-top:0}
.sep{height:10px;margin:6px 0 0;border-top:2px solid var(--line)}
.sep+.r{border-top:0}
.k{flex:0 0 42%;color:var(--mut);font-size:14px}
.v{flex:1;font-size:15px;word-break:break-word}
.reg{font-variant-numeric:tabular-nums;font-weight:600}
.code{font:600 15px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.06em}
.note{color:var(--mut);font-size:13px;line-height:1.55;margin:16px 2px 0}
.note strong{color:var(--ink)}
@media print{body{background:#fff;padding:0}.card{border-color:#bbb}.banner{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

export async function onRequest(context) {
  const { request, env, params } = context;   // context.__deps is a TEST SEAM; production never sets it.
  const raw = decodeURIComponent(String((params && params.code) || ""));

  let r;
  try {
    r = await resolve(env, request, raw, context.__deps);
  } catch (e) {
    r = { status: 503, body: { status: "unavailable",
      message: "This code could not be checked just now. Nothing is implied about its validity." } };
  }
  const d = r.body || {};
  const tone = TONE[d.status] || TONE.unavailable;

  let html = '<div class="wrap"><p class="brand">StewardMD &middot; NMC Postgraduate Logbook</p>';
  html += '<div class="banner" style="background:' + tone.bg + '"><h1>' + esc(tone.label) + "</h1>";
  if (d.status === "valid" && d.signatures) {
    html += "<p>This certified logbook was signed by the practitioners named below, each of whose " +
      "medical registration was verified at the time of signing. Its contents have not changed since.</p>";
  } else if (d.status === "valid") {
    html += "<p>This record was signed in the StewardMD logbook by a practitioner whose medical " +
      "registration was verified at the time of signing, and it has not changed since.</p>";
  } else if (d.message) {
    html += "<p>" + esc(d.message) + "</p>";
  }
  html += "</div>";

  if (d.status === "valid") {
    if (d.resident || d.programme) {
      html += '<div class="card"><h2>Trainee</h2>';
      html += row("Name", d.resident && d.resident.name);
      html += row("StewardMD ID", d.resident && d.resident.smdId);
      html += row("Year of training", d.resident && d.resident.trainingYear);
      html += row("Programme", d.programme && (d.programme.name || d.programme.degree));
      html += "</div>";
    }
    if (d.record) {
      html += '<div class="card"><h2>What was signed</h2>';
      html += row("Record", d.record.type);
      html += row("Activity", d.record.activity);
      html += row("Setting", d.record.setting);
      html += row("Trainee's role", d.record.role);
      html += row("Date of activity", day(d.record.date));
      html += row("Assessment form", d.record.template);
      html += row("Outcome", d.record.outcome);
      html += row("Score", d.record.score);
      html += row("Period", d.record.period);
      html += row("Entries in period", d.record.entries);
      html += row("Verified in period", d.record.verifiedEntries);
      html += row("Scope", d.record.scope);
      html += row("Verified entries certified", d.record.entriesCertified);
      html += row("Months authenticated by the guide", d.record.monthsAuthenticated);
      html += row("Issued", dt(d.record.issuedAt));
      if (d.record.contentFingerprint) {
        html += '<div class="r"><div class="k">Content fingerprint</div><div class="v code">' +
          esc(d.record.contentFingerprint) + "</div></div>";
      }
      // What the certificate deliberately does NOT cover. A document that silently omitted 40
      // unverified entries would read as a complete logbook.
      const ex = d.record.excludedFromCertificate;
      if (ex && (ex.draft || ex.submitted || ex.returned)) {
        html += row("Not covered (unverified at issue)",
          [ex.submitted ? ex.submitted + " awaiting verification" : "",
           ex.returned ? ex.returned + " returned for correction" : "",
           ex.draft ? ex.draft + " draft" : ""].filter(Boolean).join(", "));
      }
      if (d.record.amendments) html += row("Amendments", d.record.amendments + " (each retained in the audit trail)");
      html += "</div>";
    }
    // A certificate carries a LIST of signatures, not one — that is the whole point of it, and the
    // reader's question is "did the right people sign", so each one gets its own block with the
    // registration number they can check against the register themselves.
    if (d.signatures && d.signatures.length) {
      html += '<div class="card"><h2>Signed by ' + esc(String(d.signatures.length)) + " registered practitioner" +
        (d.signatures.length > 1 ? "s" : "") + "</h2>";
      d.signatures.forEach((sig, i) => {
        if (i) html += '<div class="sep"></div>';
        html += row("Name", sig.name);
        html += sig.registrationNo
          ? '<div class="r"><div class="k">Medical registration</div><div class="v reg">' +
            esc(sig.registrationNo) + "</div></div>"
          : "";
        html += row("Council", sig.council);
        html += row("Capacity", sig.role);
        html += row("Signed at", dt(sig.at));
      });
      html += "</div>";
      if (d.quorum) {
        html += '<div class="card"><h2>What was required</h2>';
        html += row("Signatures required", d.quorum.required);
        html += "</div>";
        html += '<p class="note">' + esc(d.quorum.source) + "</p>";
      }
    }
    if (d.signedBy) {
      html += '<div class="card"><h2>Signed by</h2>';
      html += row("Name", d.signedBy.name);
      html += d.signedBy.registrationNo
        ? '<div class="r"><div class="k">Medical registration</div><div class="v reg">' +
          esc(d.signedBy.registrationNo) + "</div></div>"
        : "";
      html += row("Council", d.signedBy.council);
      html += row("Capacity", d.signedBy.role);
      html += row("Signed at", dt(d.signedBy.at));
      html += "</div>";
    }
  }

  html += '<div class="card"><h2>This code</h2>';
  html += '<div class="r"><div class="k">Verification code</div><div class="v code">' +
    esc(d.code || raw.slice(0, 24)) + "</div></div>";
  html += row("Issued", dt(d.issuedAt));
  html += row("Checked", dt(Date.now()));
  html += "</div>";

  // The honest limits of the claim, on the page making it. This wording is deliberate: it is not a
  // per-signer cryptographic signature, and it is not an NMC or University determination.
  html += '<p class="note"><strong>What this does and does not say.</strong> ' +
    esc(d.disclaimer || "StewardMD attests to what it recorded and to the signer's registration as " +
      "verified against the Indian Medical Register at the time of signing. It does not certify the " +
      "clinical content, and it is not a determination by the NMC or by any University.") +
    " The check is tamper-evident: the record is re-read and re-checked against what was signed each " +
    "time this page is opened.</p>";
  html += '<p class="note">Nothing clinical about any patient is shown here, and none is stored ' +
    "against this code.</p></div>";

  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    // This page is entirely self-contained, so it can carry the CSP the main app cannot.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
  if (r.retryAfter) headers["Retry-After"] = String(r.retryAfter);
  // The HTTP status matches the answer: an unknown code really is a 404.
  return new Response(page(html, d.code), { status: r.status || 200, headers });
}
