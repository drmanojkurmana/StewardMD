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

import { verifyFirebaseToken } from "../_fbauth.js";
import { setUserClaims } from "../_fbadmin.js";

const NMC_SEARCH  = "https://www.nmc.org.in/MCIRest/open/getDataFromService?service=searchDoctor";
const NMC_REFERER = "https://www.nmc.org.in/information-desk/indian-medical-register/";
// Match the app's working AI setup: gemini-2.5-flash (NOT 2.0), model via env.
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }
function doctorKey(uid) { return "icu:doctor:" + uid; }
function regKey(reg)    { return "icu:reg:" + reg.replace(/[^A-Za-z0-9]/g, "_").toUpperCase(); }

// Decode a JWT payload (token already verified by verifyFirebaseToken) to read email.
function decodePayload(token) {
  try {
    const b = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0))));
  } catch (e) { return {}; }
}

// Set the verified custom claim (via the shared Firebase-admin helper).
async function setVerifiedClaim(env, uid, regNo) {
  await setUserClaims(env, uid, { verified: true, regNo });
}

// ── Gemini — read the certificate ─────────────────────────────────────────────
async function geminiExtract(env, imageB64, mime) {
  const prompt =
    "This is an Indian medical registration certificate (National Medical Commission, a " +
    "State Medical Council, or erstwhile MCI). It may be a scan, a phone photo, or a PDF, " +
    "and the quality may be poor — read it as carefully as you can (OCR).\n" +
    "Return STRICT JSON only, no prose:\n" +
    '{"registration_number": string, "full_name": string, "state_medical_council": string, ' +
    '"year": string, "looks_valid": boolean, "confidence": number}\n' +
    "- registration_number: the medical registration / enrolment number EXACTLY as printed " +
    "(it may contain letters and slashes, e.g. APMC/FMR/112487 or a plain number).\n" +
    "- full_name: the doctor's name as printed.\n" +
    "- looks_valid: set false ONLY if this is clearly NOT a medical registration document " +
    "(e.g. a random photo, a blank page). If it looks like a registration certificate, true.\n" +
    "- confidence: 0..1 for your overall reading. Use \"\" for any field you cannot read.";
  const model = env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  let res, data = {}, text = "", httpOk = false;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [ { text: prompt }, { inline_data: { mime_type: mime || "image/jpeg", data: imageB64 } } ] }],
        // thinkingBudget:0 is REQUIRED for gemini-2.5-flash — otherwise it spends the whole
        // output budget on hidden "thinking" and returns empty text (→ blank extraction).
        generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    httpOk = res.ok;
    data = await res.json().catch(() => ({}));
    if (!res.ok) console.warn("[verify] gemini HTTP", res.status, JSON.stringify(data).slice(0, 400));
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) console.warn("[verify] gemini empty text; finishReason:", data?.candidates?.[0]?.finishReason, "promptFeedback:", JSON.stringify(data?.promptFeedback || {}).slice(0, 200));
  } catch (e) {
    console.warn("[verify] gemini fetch threw:", String(e && e.message || e));
  }
  console.log("[verify] gemini raw text:", String(text).slice(0, 400));
  let p; try { p = JSON.parse(text); } catch (e) { const m = text.match(/\{[\s\S]*\}/); p = m ? (function(){ try { return JSON.parse(m[0]); } catch (_) { return {}; } })() : {}; }
  return {
    regNo: String(p.registration_number || "").trim(),
    name: String(p.full_name || "").trim(),
    council: String(p.state_medical_council || "").trim(),
    year: String(p.year || "").trim(),
    looksValid: p.looks_valid !== false,
    confidence: typeof p.confidence === "number" ? p.confidence : 0,
    httpOk: httpOk,
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
// HMAC-sign an email action link so the owner can approve/block from the inbox with a
// single click, without exposing the admin token. Verified by /api/verifications/action.
async function signAction(secret, uid, action) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(uid + "|" + action)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function emailSupport(env, { uid, email, extracted, reason, imageB64, mime }) {
  if (!env.RESEND_API_KEY) return;
  const support = env.SUPPORT_EMAIL || "support@stewardmd.in";
  const from = env.FROM_EMAIL || "StewardMD Verify <verify@stewardmd.in>";
  const origin = env.APP_ORIGIN || "https://stewardmd.in";
  const ext = (mime && mime.includes("png")) ? "png" : (mime && mime.includes("pdf")) ? "pdf" : "jpg";

  // One-click action buttons (signed). Absent if no admin secret configured.
  let buttons = "<p>Certificate attached. To approve: set custom claim verified:true for this UID.</p>";
  if (env.VERIFY_ADMIN_TOKEN) {
    const reg = encodeURIComponent(extracted.regNo || "");
    const approveSig = await signAction(env.VERIFY_ADMIN_TOKEN, uid, "approve");
    const rejectSig  = await signAction(env.VERIFY_ADMIN_TOKEN, uid, "reject");
    const approveUrl = `${origin}/api/verifications/action?uid=${encodeURIComponent(uid)}&do=approve&reg=${reg}&sig=${approveSig}`;
    const rejectUrl  = `${origin}/api/verifications/action?uid=${encodeURIComponent(uid)}&do=reject&sig=${rejectSig}`;
    buttons =
      `<p style="margin:18px 0">` +
      `<a href="${approveUrl}" style="background:#15803d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font:700 14px system-ui;margin-right:10px">✓ Verify &amp; grant access</a>` +
      `<a href="${rejectUrl}" style="background:#dc2626;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font:700 14px system-ui">✕ Block until re-upload</a>` +
      `</p><p style="font:400 12px system-ui;color:#64748b">Approve → sets the doctor verified (full access incl. prescriptions). Block → revokes access until they upload a valid certificate again.</p>`;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [support],
      subject: `[StewardMD] Manual verification — ${extracted.regNo || email || "unknown"} (${reason})`,
      html:
        `<h2>Doctor verification needs manual review</h2><p><b>Reason:</b> ${reason}</p>` +
        `<table cellpadding="6"><tr><td><b>UID</b></td><td>${uid}</td></tr>` +
        `<tr><td><b>Google email</b></td><td>${email}</td></tr>` +
        `<tr><td><b>Extracted reg</b></td><td>${extracted.regNo || "—"}</td></tr>` +
        `<tr><td><b>Extracted name</b></td><td>${extracted.name || "—"}</td></tr>` +
        `<tr><td><b>Council</b></td><td>${extracted.council || "—"}</td></tr>` +
        `<tr><td><b>Confidence</b></td><td>${extracted.confidence}</td></tr></table>` +
        buttons,
      attachments: [{ filename: `cert-${uid}.${ext}`, content: imageB64 }],
    }),
  });
  if (!res.ok) console.warn("[verify] resend(support) failed:", await res.text());
}

// ── Resend — "your account is verified" email to the doctor ───────────────────
async function emailVerified(env, { email, name, regNo, council }) {
  if (!env.RESEND_API_KEY || !email) return;
  const from = env.FROM_EMAIL || "StewardMD Verify <verify@stewardmd.in>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [email],
      subject: "✓ Your StewardMD account is verified",
      html:
        `<h2>You're verified ✓</h2>` +
        `<p>Dr. ${name || ""}, your medical registration has been verified and linked to your StewardMD account.</p>` +
        `<table cellpadding="6"><tr><td><b>Registration No</b></td><td>${regNo || ""}</td></tr>` +
        `<tr><td><b>Council</b></td><td>${council || ""}</td></tr></table>` +
        `<p>You now have full access, including the prescription generator. Welcome to StewardMD.</p>`,
    }),
  });
  if (!res.ok) console.warn("[verify] resend(verified) failed:", await res.text());
}

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  // GET ?debug=models → list the Gemini models this key can use (temporary diagnostic).
  if (request.method === "GET" && new URL(request.url).searchParams.get("debug") === "models") {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`);
      const d = await r.json();
      const models = (d.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).indexOf("generateContent") > -1)
        .map((m) => m.name.replace("models/", ""));
      return json({ ok: true, current: env.GEMINI_MODEL || "(unset)", models });
    } catch (e) { return json({ error: String((e && e.message) || e) }); }
  }

  // GET → the caller's own verification status (for the account panel).
  if (request.method === "GET") {
    const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const uid = await verifyFirebaseToken(tok, env);
    if (!uid) return json({ error: "auth_failed" }, 401);
    const store = kv(env);
    let rec = null;
    try { if (store) rec = await store.get(doctorKey(uid), "json"); } catch (e) {}
    if (rec) return json({
      status: rec.status || (rec.verified ? "verified" : "unverified"),
      regNo: rec.regNo || rec.extractedRegNo || "", name: rec.name || "",
      council: rec.council || "", verifiedAt: rec.verifiedAt || "", reason: rec.reason || "",
      provisionalUntil: rec.provisionalUntil || "",
    });
    return json({ status: "unverified" });
  }

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
  catch (e) { ex = { regNo: "", name: "", council: "", year: "", looksValid: false, confidence: 0, httpOk: false }; }
  console.log("[verify] uid", uid, "extracted:", JSON.stringify({ regNo: ex.regNo, name: ex.name, looksValid: ex.looksValid, confidence: ex.confidence, httpOk: ex.httpOk }));

  // Provisional access: on manual review the doctor still gets in for 7 days, but the
  // prescription generator stays locked (no verified claim) until approved.
  const PROVISIONAL_DAYS = 7;
  const toManual = async (reason) => {
    console.log("[verify] uid", uid, "→ MANUAL:", reason);
    const provisionalUntil = new Date(Date.now() + PROVISIONAL_DAYS * 86400000).toISOString();
    try { if (store) await store.put(doctorKey(uid), JSON.stringify({
      uid, email, status: "pending", reason,
      extractedRegNo: ex.regNo, extractedName: ex.name,
      provisionalUntil, updatedAt: new Date().toISOString(),
    })); } catch (e) {}
    try { await emailSupport(env, { uid, email, extracted: ex, reason, imageB64, mime }); } catch (e) {}
    return json({ status: "pending_review", reason, provisionalUntil, provisionalDays: PROVISIONAL_DAYS });
  };

  // 3. decide — the NMC register is authoritative. We do NOT gate on Gemini's self-reported
  // confidence; if it read a reg number and NMC confirms it (with a matching name), verify.
  if (ex.looksValid === false) return toManual("not_a_certificate");
  if (!ex.regNo) return toManual("no_reg_number_read");

  let records; try { records = await nmcLookup(ex.regNo); } catch (e) { console.warn("[verify] nmc error", String(e)); return toManual("nmc_unreachable"); }
  const core = regCore(ex.regNo);
  const match = records.find(r =>
    (regCore(r.registrationNo) === core || String(r.registrationNo).includes(ex.regNo)) &&
    nameAgrees(ex.name, r.firstName)
  );
  console.log("[verify] uid", uid, "nmc records:", records.length, "core:", core, "match:", match ? match.registrationNo + " / " + match.firstName : "NONE");
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
  console.log("[verify] uid", uid, "→ VERIFIED", match.registrationNo);

  // Confirmation email to the doctor (best-effort).
  try { await emailVerified(env, { email, name: match.firstName, regNo: match.registrationNo, council: match.smcName }); } catch (e) {}

  return json({ status: "verified", regNo: match.registrationNo, name: match.firstName, council: match.smcName });
}
