/* StewardMD — ICU collaboration at-rest encryption: per-group key derivation (server side).
 *
 * The ICU shared patient doc (patient name + full clinical ICU_STATE = PHI) is written straight to
 * Firestore from the browser via the client SDK, so encryption happens ON THE DEVICE. The doctors
 * in one ICU group need the SAME symmetric key; we don't ship it in the bundle. Instead the client
 * fetches it from a membership-gated endpoint (see functions/api/icu/[[path]].js), and the server
 * DERIVES it deterministically from one server secret + the group id:
 *
 *     groupKey = HMAC-SHA256( ICU_GROUP_KEY_SECRET , "icu-group:" + gid )   → 32 bytes → AES-256
 *
 * This is encryption-AT-REST (a Firestore/DB dump reveals only ciphertext), not zero-knowledge:
 * the server can derive the key, so it is defence-in-depth ON TOP of the Firestore membership
 * rules, matching how FollowCare encrypts identifiers at rest. The secret lives only in the
 * server env; the derivation is deterministic so every member of a group gets the identical key
 * and no per-group key material has to be stored anywhere.
 *
 * Pure + unit-tested: deriveGroupKey has no I/O.
 */

// 32-byte AES-256 key for `gid`, base64. Deterministic: same secret + gid → same key for every member.
export async function deriveGroupKey(secret, gid) {
  if (!secret) throw new Error("no_secret");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("icu-group:" + String(gid)));
  const bytes = new Uint8Array(mac);            // 32 bytes
  let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
