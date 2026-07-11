// Firebase ID-token verification for the Cloudflare Worker, via `jose`.
// Verifies RS256 against Google's public x509 certs, checks issuer/audience/expiry,
// and returns the decoded user incl. the `pro` claim. Gates the paid offline-DB download.
// Dependency: jose (npm i jose) — wrangler bundles it automatically.

import { importX509, jwtVerify } from "jose";

const CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let _keys = null;
let _exp = 0;

async function getKeys() {
  const now = Date.now();
  if (_keys && now < _exp) return _keys;
  const res = await fetch(CERT_URL);
  const cc = res.headers.get("Cache-Control") || "";
  const m = /max-age=(\d+)/.exec(cc);
  _exp = now + (m ? parseInt(m[1], 10) * 1000 : 3600 * 1000);
  const certs = await res.json();
  const out = {};
  for (const kid of Object.keys(certs)) out[kid] = await importX509(certs[kid], "RS256");
  _keys = out;
  return _keys;
}

/** Verify a Firebase ID token from Authorization: Bearer. Returns {uid,email,pro} or throws (.status 401/403/500). */
export async function verifyFirebaseToken(request, env) {
  const authz = request.headers.get("Authorization") || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!token) { const e = new Error("no_token"); e.status = 401; throw e; }
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) { const e = new Error("misconfigured"); e.status = 500; throw e; }
  let kid;
  try { kid = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).kid; }
  catch (_) { const e = new Error("malformed"); e.status = 401; throw e; }
  const keys = await getKeys();
  const key = keys[kid];
  if (!key) { const e = new Error("unknown_kid"); e.status = 401; throw e; }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    }));
  } catch (_) { const e = new Error("invalid_token"); e.status = 401; throw e; }
  return { uid: payload.user_id || payload.sub, email: payload.email || null, pro: payload.pro === true };
}

/** Require a paid ("pro") user. Returns the user or throws with `.status`. */
export async function requirePro(request, env) {
  const user = await verifyFirebaseToken(request, env);
  if (!user.pro) { const e = new Error("upgrade_required"); e.status = 403; throw e; }
  return user;
}
