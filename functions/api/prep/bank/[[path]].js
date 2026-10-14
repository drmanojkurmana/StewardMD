/* GET /api/prep/bank/<version>/<subject>/<file> - the PrepNucleus question bank.
 *
 * Security architecture:
 * 1. Auth required: Every request to MCQ content paths (module files, overlay files,
 *    search files, PYQ items/images, quality sidecar, tests papers, links data, share IDs)
 *    requires a valid signed-in user + active app proof.
 * 2. App binding: strict Origin allowlist, per-session HMAC proof (10 min key, 60s window,
 *    nonce cache in KV), and attestation hook.
 * 3. Images: short-lived HMAC-signed URLs (5 min TTL) for <img> tags.
 * 4. Cache-Control: gated responses are strictly private, no-store (or private, max-age=300
 *    for images), never public or immutable.
 * 5. Rate limits: 120/min burst, 2,000/h, 10,000/day, with 24h account flagging on
 *    sequential enumeration / bulk download.
 * 6. Public paths: lessons and cards (v<n>/lessons/..., v<n>/cards/...), image-credits.json,
 *    and health probe stay public.
 * 7. Rollout safety: PREP_BANK_ENFORCE env var (default OFF = shadow logging; 1 = enforce).
 */

import { identify, sha256hex } from "../../../_usage.js";
import {
  isAllowedOrigin,
  corsHeaders,
  withCors,
  classifyBankPath,
  isGatedBankPath,
  isImagePath,
  verifyBankProof,
  verifyImageQuery,
  checkBankRateLimits,
  mintBankSession,
  signImagePath,
  resetBankGateMemory,
} from "../../../_prep_bank_gate.js";

// Re-export helpers for consumers and tests
export {
  classifyBankPath,
  isGatedBankPath,
  isAllowedOrigin,
  corsHeaders,
  mintBankSession,
  verifyBankProof,
  signImagePath,
  resetBankGateMemory,
};

// search-<8 hex>.json: a rebuilt subject search index under a new immutable name (the subject index.json names it).
const PATH_RE = /^v\d{1,3}\/(?:manifest\.json|[a-z0-9-]{2,60}\/(?:index|search|search-[0-9a-f]{8})\.json|[a-z0-9-]{2,60}\/mcq\/[a-z0-9-]{2,80}\.json)$/;
// PYQ (tools/prep-pyq.mjs): v<n>/pyq/index.json, items-<8 hex>.json and img/<name>.webp
const PYQ_RE = /^v\d{1,3}\/pyq\/(?:index\.json|items-[0-9a-f]{8}\.json|img\/[a-z0-9-]{2,80}\.webp)$/;
// Lessons and Flashcards (tools/prep-lessons.mjs, tools/prep-cards.mjs)
const STUDY_RE = /^v\d{1,3}\/(?:(?:lessons|cards)\/(?:index|[a-z0-9-]{2,80})\.json|lessons\/media\/[a-z0-9-]{2,80}\.(?:svg|webp))$/;
// Radiology media (tools/prep-rad.mjs): img/<name>.webp and scroll stacks stack/<id>/<window>/<NNN>.webp
const RAD_RE = /^v\d{1,3}\/(?!pyq\/|lessons\/|cards\/)[a-z0-9-]{2,60}\/(?:img\/[a-z0-9-]{2,100}\.webp|stack\/[a-z0-9-]{2,60}\/(?:stack\.json|[a-z]{2,12}\/\d{3}\.webp))$/;
// Images a bank item carries: v<n>/img/<name>.webp
const IMG_RE = /^v\d{1,3}\/img\/[a-z0-9-]{2,80}\.webp$/;
// Radiology notes & figures
const RADNOTES_RE = /^(?:img\/(?:radnotes\/rn|radmax\/rm)-[a-z0-9-]{2,80}\.webp|overlay\/(?:radnotes|radmax)(?:[2-9]|[1-9]\d)?\/[a-z0-9-]{2,60}\/[a-z0-9-]{2,80}\.json)$/;
// Medicine coverage MCQs
const MEDCOV_RE = /^overlay\/medcov(?:[2-9]|[1-9]\d)?\/[a-z0-9-]{2,60}\/[a-z0-9-]{2,80}\.json$/;
// Owner-reviewed MaiK questions
const MAIK_RE = /^overlay\/(?:maikfill\d|maik(?:img)?[1-9]\d{0,2}|(?!(?:radnotes|radmax|medcov)\d)[a-z]{2,12}[1-9]\d{0,2}[a-z]?)\/[a-z0-9-]{2,60}\/[a-z0-9-]{2,80}\.json$/;
// Openly licensed images for image MCQs: img/maikimg/i-<hash>.webp
const MAIK_IMG_RE = /^img\/maikimg\/i-[a-z0-9-]{8,40}\.webp$/;
// MaiK overlay manifest
const MAIK_MANIFEST_RE = /^overlay\/maik\/(?:index\.json|manifest-[0-9a-f]{8,16}\.json)$/;
// Share IDs (tools/prep-ids.mjs, prep-ids.js)
const IDS_RE = /^v\d{1,3}\/ids\/(?:index|[0-9a-z]{2}-[0-9a-f]{6})\.json$/;
// Knowledge links (tools/prep-links.mjs, prep-reason.js)
const LINKS_RE = /^v\d{1,3}\/links\/(?:index\.json|m\/[a-z0-9-]{2,80}-[0-9a-f]{8}\.json|c\/[a-z0-9-]{2,60}-[0-9a-f]{8}\.json)$/;
// Item-quality sidecar
const QUALITY_RE = /^quality\/(?:index\.json|v\d{1,3}\/[a-z0-9-]{2,60}\.json)$/;
// Pre-built common tests
const TESTS_RE = /^v\d{1,3}\/tests\/(?:index\.json|[a-z0-9-]{2,60}\/[a-z0-9_-]{2,60}\/[a-z0-9-]{2,120}\.json)$/;
// Attribution credits for freely licensed images: image-credits.json
const CREDITS_RE = /^image-credits\.json$/;

const PREFIX = "prep-bank/";

function notFound() {
  return new Response(JSON.stringify({ error: "not-found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function notAllowed(status, code, message) {
  return new Response(JSON.stringify({ error: status === 403 ? "forbidden" : "unauthorized", code, message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function rateLimited(rl) {
  return new Response(JSON.stringify({ error: "rate-limited", code: rl.code || "rate-limited", message: rl.message || "Rate limit exceeded" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "60" },
  });
}

export function bankPath(params) {
  const p = [].concat((params && params.path) || []).map(String).join("/");
  if (p === "health" || p === "status" || p === "session" || p === "sign-image") return p;
  return PATH_RE.test(p) ||
    PYQ_RE.test(p) ||
    STUDY_RE.test(p) ||
    IMG_RE.test(p) ||
    RADNOTES_RE.test(p) ||
    MEDCOV_RE.test(p) ||
    MAIK_RE.test(p) ||
    MAIK_MANIFEST_RE.test(p) ||
    MAIK_IMG_RE.test(p) ||
    RAD_RE.test(p) ||
    IDS_RE.test(p) ||
    LINKS_RE.test(p) ||
    QUALITY_RE.test(p) ||
    TESTS_RE.test(p) ||
    CREDITS_RE.test(p)
    ? p
    : null;
}

async function serveR2Object(env, p, request, cacheControl) {
  const bucket = env && env.PREP_BANK_R2;
  if (!bucket || !bucket.get) {
    return new Response(JSON.stringify({ error: "bank-not-configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  let obj = null;
  try {
    obj = await bucket.get(PREFIX + p);
  } catch (e) {
    return new Response(JSON.stringify({ error: "bank-unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "5" },
    });
  }
  if (!obj) return notFound();

  const headers = new Headers({
    "Content-Type": /\.webp$/.test(p)
      ? "image/webp"
      : /\.svg$/.test(p)
      ? "image/svg+xml"
      : "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  });

  if (/\.svg$/.test(p)) {
    headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  }
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  if (cacheControl.includes("private")) {
    headers.set("Vary", "Authorization, Origin");
  }

  return withCors(request, new Response(obj.body, { status: 200, headers }));
}

export async function onRequestGet(ctx) {
  const { env, params, request, waitUntil } = ctx;
  const p = bankPath(params);
  if (!p) return notFound();

  // Health and status probe
  if (p === "health" || p === "status") {
    return withCors(
      request,
      new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      })
    );
  }

  const classification = classifyBankPath(p);
  const enforced = String(env && env.PREP_BANK_ENFORCE) === "1";

  // Public paths: lessons, cards, credits
  if (classification === "public") {
    const isShortCache = /(?:manifest|(?:pyq|lessons|cards|ids|links|quality|maik|tests)\/index)\.json$/.test(p);
    const cc = isShortCache ? "public, max-age=300" : "public, max-age=31536000, immutable";
    return serveR2Object(env, p, request, cc);
  }

  // --- Gated paths: authentication, app proof & rate limits ---
  const reqObj = request || new Request("https://stewardmd.in/api/prep/bank/" + p);
  const origin = reqObj.headers.get("Origin") || "";

  // 1. Strict Origin check
  if (origin && !isAllowedOrigin(origin)) {
    if (enforced) {
      return notAllowed(403, "foreign-origin", "Cross-origin requests from foreign origins are not allowed");
    } else {
      console.warn("[bank-gate-shadow] would-deny: foreign origin", { origin, path: p });
    }
  }

  // 2. Missing Origin (e.g. curl) must have valid app proof or signature
  const url = new URL(reqObj.url || ("https://stewardmd.in/api/prep/bank/" + p));
  const hasAppSig = reqObj.headers.get("X-SMD-Signature") || url.searchParams.get("sig");
  if (!origin && !hasAppSig) {
    if (enforced) {
      return notAllowed(401, "app-binding-required", "Requests must originate from the StewardMD application");
    } else {
      console.warn("[bank-gate-shadow] would-deny: missing origin and no app signature", { path: p });
    }
  }

  // 3. Image URL signed exception (query params: ?s=...&exp=...&sig=...)
  const isImg = isImagePath(p);
  const hasSigQuery = url.searchParams.has("sig") && url.searchParams.has("s");
  if (isImg && hasSigQuery) {
    const imgAuth = await verifyImageQuery(env, p, url.searchParams);
    if (!imgAuth.ok) {
      if (enforced) {
        return notAllowed(401, imgAuth.code, "Invalid or expired image signature");
      } else {
        console.warn("[bank-gate-shadow] would-deny: invalid image signature", { path: p, code: imgAuth.code });
      }
    } else {
      // Authenticated image request
      const rl = await checkBankRateLimits(env, { id: imgAuth.uid }, p, waitUntil);
      if (!rl.ok) {
        if (enforced) return rateLimited(rl);
        console.warn("[bank-gate-shadow] would-deny: rate limit", { path: p, user: imgAuth.uid });
      }
      return serveR2Object(env, p, reqObj, "private, max-age=300");
    }
  }

  // 4. User identity check
  const user = await identify(reqObj, env);
  if (!user || user.guest) {
    if (enforced) {
      return notAllowed(401, "login-required", "Sign-in required to access question bank content");
    } else {
      console.warn("[bank-gate-shadow] would-deny: unauthenticated request", { path: p });
    }
  }

  // 5. App proof header verification
  const proof = await verifyBankProof(reqObj, env, p, user || { id: "anon" }, waitUntil);
  if (!proof.ok) {
    if (user && !user.guest) {
      const hashedUid = await sha256hex(user.id);
      console.warn("[bank-gate] signed-in user without app proof refused", {
        user: hashedUid,
        path: p,
        code: proof.code,
      });
    }
    if (enforced) {
      return notAllowed(401, proof.code || "app-proof-required", proof.message || "Valid app proof signature required");
    } else {
      console.warn("[bank-gate-shadow] would-deny: missing or invalid app proof", { path: p, code: proof.code });
    }
  }

  // 6. User rate limits & bulk-download enumeration check
  if (user && !user.guest) {
    const rl = await checkBankRateLimits(env, user, p, waitUntil);
    if (!rl.ok) {
      if (enforced) return rateLimited(rl);
      console.warn("[bank-gate-shadow] would-deny: rate limit", { path: p, user: user.id });
    }
  }

  // 7. Gated content delivery: strictly private, never public or immutable
  const cc = isImg ? "private, max-age=300" : "private, no-store";
  return serveR2Object(env, p, reqObj, cc);
}

export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  if (r.body && r.body.cancel) {
    try {
      await r.body.cancel();
    } catch (e) {}
  }
  return new Response(null, { status: r.status, headers: r.headers });
}

export async function onRequestOptions(ctx) {
  const req = ctx.request || new Request("https://stewardmd.in/api/prep/bank/");
  const o = req.headers.get("Origin") || "";
  if (!isAllowedOrigin(o)) {
    return new Response(null, { status: 403 });
  }
  return withCors(req, new Response(null, { status: 204 }));
}

export async function onRequestPost(ctx) {
  const { request, env, params } = ctx;
  const p = bankPath(params);

  // POST /api/prep/bank/session
  if (p === "session") {
    const { onRequestPost: handleSessionPost } = await import("../session.js");
    return handleSessionPost(ctx);
  }

  // POST /api/prep/bank/sign-image
  if (p === "sign-image") {
    const user = await identify(request, env);
    if (!user || user.guest) {
      return notAllowed(401, "login-required", "Sign-in required to sign image URLs");
    }
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return notAllowed(400, "invalid-body", "Invalid JSON body");
    }
    const sessionId = request.headers.get("X-SMD-Session") || body.sessionId;
    const session = await (await import("../../../_prep_bank_gate.js")).getBankSession(env, sessionId);
    if (!session || session.uid !== user.id) {
      return notAllowed(401, "invalid-session", "Session not found or expired");
    }
    const imgPath = body.path || "";
    const query = await signImagePath(session.key, session.sessionId || sessionId, imgPath, 300);
    return withCors(
      request,
      new Response(JSON.stringify({ ok: true, url: "/api/prep/bank/" + imgPath + "?" + query }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      })
    );
  }

  return notFound();
}
