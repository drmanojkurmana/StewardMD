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

// Merge-set custom claims for a user (preserves nothing — pass the full claim object).
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
