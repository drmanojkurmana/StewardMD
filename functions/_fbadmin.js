/* StewardMD — Firebase Admin (service-account) helpers (shared).
 * Mints an OAuth2 access token from FIREBASE_SERVICE_ACCOUNT via Web Crypto and sets
 * Firebase custom claims through the Identity Toolkit REST API. Used by
 * functions/api/verify-doctor.js and functions/api/verifications to grant verified:true.
 */
const FB_PROJECT_DEFAULT = "stewardmd-498ec";

const b64ToBytes    = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const bytesToB64Url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const strToB64Url   = (s) => bytesToB64Url(new TextEncoder().encode(s));

let _saTok = { token: null, exp: 0 };
export async function serviceAccountToken(env, scope) {
  const now = Math.floor(Date.now() / 1000);
  if (_saTok.token && now < _saTok.exp - 60) return _saTok.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: scope || "https://www.googleapis.com/auth/identitytoolkit",
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

// Set custom claims for a user (REPLACES the whole claim object — pass everything you want kept).
export async function setUserClaims(env, uid, claimsObj) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const saToken = await serviceAccountToken(env);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${saToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claimsObj) }),
  });
  if (!res.ok) throw new Error("set_claim_failed: " + (await res.text()));
}

// Set a user's password (admin). Used by the forgot-password flow (OTP reset + temp password).
export async function setUserPassword(env, uid, password) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const saToken = await serviceAccountToken(env);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${saToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: uid, password: password }),
  });
  if (!res.ok) throw new Error("set_password_failed: " + (await res.text()));
}

// Read a user's current custom claims ({} if none / on error).
export async function getUserClaims(env, uid) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const saToken = await serviceAccountToken(env);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${saToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: [uid] }),
  });
  if (!res.ok) return {};
  const d = await res.json();
  const u = (d.users || [])[0];
  if (!u || !u.customAttributes) return {};
  try { return JSON.parse(u.customAttributes) || {}; } catch (e) { return {}; }
}

// Resolve a Firebase uid from an email (for the admin "grant Pro by email" control). null if none.
export async function lookupUidByEmail(env, email) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const saToken = await serviceAccountToken(env);
  const norm = String(email || "").trim().toLowerCase();
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${saToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: [norm] }),
  });
  if (!res.ok) { try { console.warn("[lookupEmail] http", res.status, (await res.text()).slice(0, 200)); } catch (e) {} return null; }
  const d = await res.json();
  const u = (d.users || [])[0];
  if (!u) { try { console.warn("[lookupEmail] no-match for", norm, "· users:", (d.users || []).length); } catch (e) {} }
  return u ? { uid: u.localId, email: (u.email || norm).toLowerCase(), name: u.displayName || "" } : null;
}

// Resolve a user's email/displayName from their uid (accounts:lookup by localId — the SAME query
// getUserClaims uses, which is known-good). Lets the admin grant by uid and still email the user.
export async function lookupUserByUid(env, uid) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const saToken = await serviceAccountToken(env);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${saToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: [String(uid || "").trim()] }),
  });
  if (!res.ok) { try { console.warn("[lookupUid] http", res.status); } catch (e) {} return null; }
  const d = await res.json();
  const u = (d.users || [])[0];
  return u ? { uid: u.localId, email: (u.email || "").toLowerCase(), name: u.displayName || "" } : null;
}

// CLOBBER-SAFE: merge a patch into the user's existing claims (so granting `pro` never wipes
// `verified`, and vice-versa). Set a patch key to null to delete it.
export async function mergeUserClaims(env, uid, patch) {
  const cur = await getUserClaims(env, uid);
  const next = Object.assign({}, cur, patch);
  Object.keys(next).forEach((k) => { if (next[k] == null) delete next[k]; });
  await setUserClaims(env, uid, next);
  return next;
}
