/* StewardMD — Doctor Verification (Cloudflare Pages Function)
 * ---------------------------------------------------------------------------
 * DEPLOY PATH:  functions/api/verify-doctor.js  ->  https://stewardmd.in/api/verify-doctor
 *
 * Restricts StewardMD to VERIFIED DOCTORS. A signed-in user uploads their medical
 * registration certificate; Gemini reads it; the reg no is cross-checked against the
 * LIVE NMC register. On pass we set the Firebase custom claim verified:true (mirrors
 * the existing `pro` claim) and record the doctor in KV. On fail the certificate is
 * emailed to support for manual review.
 *
 * Reuses functions/_fbauth.js (verifyFirebaseToken) and the CASES_KV/GHIS_KV binding,
 * exactly like functions/api/cases, push, watch.
 *
 * REQUIRED secrets (wrangler pages secret put ...):
 *   GEMINI_API_KEY            Google AI Studio key
 *   FIREBASE_SERVICE_ACCOUNT  service-account JSON (one line) — to set custom claims
 *   RESEND_API_KEY            Resend key (manual-review emails)
 * OPTIONAL: SUPPORT_EMAIL (default support@stewardmd.in), FROM_EMAIL, FIREBASE_PROJECT_ID
 * ---------------------------------------------------------------------------
 */

import { verifyFirebaseToken } from "../../_fbauth.js";

const FB_PROJECT_DEFAULT = "stewardmd-498ec";
const NMC_SEARCH  = "https://www.nmc.org.in/MCIRest/open/getDataFromService?service=searchDoctor";
const NMC_REFERER = "https://www.nmc.org.in/information-desk/indian-medical-register/";
const GEMINI_MODEL = "gemini-2.0-flash";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
function doctorKey(uid) { return "icu:doctor:" + uid; }
function regKey(reg)    { return "icu:reg:" + reg.replace(/[^A-Za-z0-9]/g, "_").toUpperCase(); }

// ── base64 / bytes ────────────────────────────────────────────────────────────
const b64ToBytes   = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const bytesToB64Url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const strToB64Url   = (s) => bytesToB64Url(new TextEncoder().encode(s));

// Decode a JWT payload (token already verified by verifyFirebaseToken) to read email.
function decodePayload(token) {
  try { return JSON.parse(new TextDecoder().decode(b64ToBytes(String(token).split(".")[1]))); }
  catch (e) { return {}; }
}

// ── Service-account OAuth2 token (JWT bearer grant) — to set custom claims ─────
let _saTok = { token: null, exp: 0 };
async function serviceAccountToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_saTok.token && now < _saTok.exp - 60) return _saTok.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/identitytoolkit",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };
  const signingInput = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(JSON.stringify(claims))}`;
  const pkcs8 = b64ToBytes(sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)));
  const assertion = `${signingInput}.${bytesToB64Url(sig)}`;
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${assertion}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("sa_token_failed");
  _saTok = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function setVerifiedClaim(env, uid, regNo) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const saToken = await serviceAccountToken(env);
  // Preserve any existing claims (e.g. pro) by merging.
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${saToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ verified: true, regNo }) }),
  });
  if (!res.ok) throw new Error("set_claim_failed: " + (await res.text()));
}

// ── Gemini — read the certificate ─────────────────────────────────────────────
async function geminiExtract(env, imageB64, mime) {
  const prompt =
    "You are validating an Indian medical registration certificate (National Medical " +
    "Commission / a State Medical Council / erstwhile MCI). Extract EXACTLY these fields " +
    "and return STRICT JSON only, no prose:\n" +
    '{"registration_number": string, "full_name": string, "state_medical_council": string, ' +
    '"year": string, "looks_valid": boolean, "confidence": number}\n' +
    "looks_valid=false if this is NOT a genuine-looking medical registration certificate. " +
    "confidence is 0..1. Use \"\" for anything unreadable.";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: mime || "image/jpeg", data: imageB64 } } ] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  let p; try { p = JSON.parse(text); } catch (e) { const m = text.match(/\{[\s\S]*\}/); p = m ? JSON.parse(m[0]) : {}; }
  return {
    regNo: String(p.registration_number || "").trim(),
    name: String(p.full_name || "").trim(),
    council: String(p.state_medical_council || "").trim(),
    year: String(p.year || "").trim(),
    looksValid: p.looks_valid !== false,
    confidence: typeof p.confidence === "number" ? p.confidence : 0,
  };
}

// ── Live NMC cross-check ──────────────────────────────────────────────────────
function normName(s) {
  return String(s || "").toUpperCase()
    .replace(/\bDR\.?\b/g, " ")
    .replace(/\b(MR|MRS|MS|MISS|SHRI|SMT|PROF)\.?\b/g, " ")
    .replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
}
function regCore(s) { const m = String(s || "").match(/\d{2,}/g); return m ? m[m.length - 1] : ""; }
function nameAgrees(extracted, nmcName) {
  const a = new Set(normName(extracted).split(" ").filter(Boolean));
  const b = new Set(normName(nmcName).split(" ").filter(Boolean));
  if (!a.size || !b.size) return false;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter >= Math.max(1, Math.ceil(Math.min(a.size, b.size) * 0.6));
}
async function nmcLookup(regNo) {
  const res = await fetch(NMC_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Referer": NMC_REFERER, "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ registrationNo: regNo }),
  });
  if (!res.ok) throw new Error("nmc_http_" + res.status);
  const arr = await res.json();
  return Array.isArray(arr) ? arr : [];
}

// ── Resend — manual-review email ──────────────────────────────────────────────
async function emailSupport(env, { uid, email, extracted, reason, imageB64, mime }) {
  if (!env.RESEND_API_KEY) return;
  const support = env.SUPPORT_EMAIL || "support@stewardmd.in";
  const from = env.FROM_EMAIL || "StewardMD Verify <verify@stewardmd.in>";
  const ext = (mime && mime.includes("png")) ? "png" : (mime && mime.includes("pdf")) ? "pdf" : "jpg";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [support],
      subject: `[StewardMD] Manual verification — ${extracted.regNo || "unknown"} (${reason})`,
      html:
        `<h2>Doctor verification needs manual review</h2><p><b>Reason:</b> ${reason}</p>` +
        `<table cellpadding="6"><tr><td><b>UID</b></td><td>${uid}</td></tr>` +
        `<tr><td><b>Google email</b></td><td>${email}</td></tr>` +
        `<tr><td><b>Extracted reg</b></td><td>${extracted.regNo}</td></tr>` +
        `<tr><td><b>Extracted name</b></td><td>${extracted.name}</td></tr>` +
        `<tr><td><b>Council</b></td><td>${extracted.council}</td></tr>` +
        `<tr><td><b>Confidence</b></td><td>${extracted.confidence}</td></tr></table>` +
        `<p>Certificate attached. To approve: set custom claim verified:true for this UID.</p>`,
      attachments: [{ filename: `cert-${uid}.${ext}`, content: imageB64 }],
    }),
  });
  if (!res.ok) console.warn("[verify] resend failed:", await res.text());
}

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  for (const k of ["GEMINI_API_KEY", "FIREBASE_SERVICE_ACCOUNT"]) {
    if (!env[k]) return json({ error: "server_misconfigured", detail: `${k} missing` }, 500);
  }
  const store = kv(env);

  let body; try { body = await request.json(); } catch (e) { return json({ error: "bad_json" }, 400); }
  const idToken  = body.idToken || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const imageB64 = String(body.image || "").replace(/^data:[^;]+;base64,/, "");
  const mime     = body.mime || "image/jpeg";
  if (!idToken)  return json({ error: "missing_id_token" }, 401);
  if (!imageB64) return json({ error: "missing_image" }, 400);

  // 1. authenticate (reuse shared verifier)
  const uid = await verifyFirebaseToken(idToken, env);
  if (!uid) return json({ error: "auth_failed" }, 401);
  const email = decodePayload(idToken).email || "";

  // 2. Gemini extraction
  let ex; try { ex = await geminiExtract(env, imageB64, mime); }
  catch (e) { ex = { regNo: "", name: "", council: "", year: "", looksValid: false, confidence: 0 }; }

  const toManual = async (reason) => {
    try { if (store) await store.put(doctorKey(uid), JSON.stringify({
      uid, email, status: "pending", reason, extractedRegNo: ex.regNo, extractedName: ex.name,
      updatedAt: new Date().toISOString(),
    })); } catch (e) {}
    try { await emailSupport(env, { uid, email, extracted: ex, reason, imageB64, mime }); } catch (e) {}
    return json({ status: "pending_review", reason });
  };

  // 3. decide
  if (!ex.looksValid || ex.confidence < 0.4 || !ex.regNo) return toManual("low_confidence_or_unreadable");

  let records; try { records = await nmcLookup(ex.regNo); } catch (e) { return toManual("nmc_unreachable"); }
  const core = regCore(ex.regNo);
  const match = records.find(r =>
    (regCore(r.registrationNo) === core || String(r.registrationNo).includes(ex.regNo)) &&
    nameAgrees(ex.name, r.firstName)
  );
  if (!match) return toManual("no_nmc_match");

  // 4. one reg no = one account (KV read-then-write; verification is rare)
  if (store) {
    const existing = await store.get(regKey(match.registrationNo));
    if (existing && existing !== uid) {
      return json({ status: "rejected", reason: "registration_already_claimed" }, 409);
    }
  }

  // 5. set the verified claim + persist
  try { await setVerifiedClaim(env, uid, match.registrationNo); }
  catch (e) { return json({ error: "claim_write_failed", detail: String(e.message || e) }, 500); }

  if (store) {
    try { await store.put(regKey(match.registrationNo), uid); } catch (e) {}
    try { await store.put(doctorKey(uid), JSON.stringify({
      uid, email, status: "verified", verified: true,
      regNo: match.registrationNo, name: match.firstName, council: match.smcName,
      dob: match.birthDateStr || "", university: match.university || "",
      verifiedAt: new Date().toISOString(),
    })); } catch (e) {}
  }

  return json({ status: "verified", regNo: match.registrationNo, name: match.firstName, council: match.smcName });
}
