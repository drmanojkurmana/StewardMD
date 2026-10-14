/* POST /api/prep/session - mint a short-lived HMAC session key for PrepNucleus bank requests.
 *
 * Requirements:
 * 1. Strict Origin check: only StewardMD web and native schemes are allowed.
 * 2. Authenticated user: verified Firebase ID token or verified Cf-Access JWT (identify()).
 * 3. Returns a 10-minute HMAC session key, bound to user id, device id, and app version.
 * 4. The key is held in memory by the client and used to sign subsequent bank requests.
 */

import { identify } from "../../_usage.js";
import { isAllowedOrigin, withCors, mintBankSession } from "../../_prep_bank_gate.js";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function onRequestOptions({ request }) {
  const o = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(o)) {
    return new Response(null, { status: 403 });
  }
  return withCors(request, new Response(null, { status: 204 }));
}

export async function onRequestPost({ request, env }) {
  let o = request.headers.get("Origin") || "";
  if (!o && request.headers.get("Referer")) {
    try { o = new URL(request.headers.get("Referer")).origin; } catch (e) {}
  }
  if (!o || !isAllowedOrigin(o)) {
    return json({ error: "forbidden", code: !o ? "origin-required" : "foreign-origin", message: "Requests must originate from the StewardMD application" }, 403);
  }

  // User auth check: caller must be signed in
  const user = await identify(request, env);
  if (!user || user.guest) {
    return withCors(request, json({ error: "unauthorized", code: "login-required", message: "Sign-in required" }, 401));
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }

  const session = await mintBankSession(user, env, {
    deviceId: body.deviceId || request.headers.get("X-SMD-Device") || "unknown",
    appVersion: body.appVersion || request.headers.get("X-SMD-App-Ver") || "1.0.0",
    attestation: body.attestation || null,
  });

  return withCors(request, json(session, 200));
}
