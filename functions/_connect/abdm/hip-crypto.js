// functions/_connect/abdm/hip-crypto.js — ABDM HIP-side "seal for HIU" (Stage 5, Task 3).
//
// PONYTAIL: fidelius.js is UNTOUCHED — this module is only the CALLER that honors its no-batch,
// one-plaintext-per-(key,iv) caller-contract (see sealBundle's docstring). It adds NO crypto of its own.
//
// ⛔ R1 HARD GATE INVARIANT: the derived AES-GCM (key,iv) is NEVER reused across two distinct plaintexts.
// Each seal mints a FRESH ephemeral X25519 keypair + a FRESH 32-byte nonce ⇒ pairwise-distinct nonces ⇒
// distinct xorNonce ⇒ distinct iv AND distinct ECDH secret ⇒ distinct HKDF key ⇒ distinct (key,iv).
// The encrypt path is STRUCTURALLY incapable of emitting >1 plaintext under one keyMaterial: sealForHiu
// seals EXACTLY ONE plaintext per call, and sealEntries calls sealForHiu once per plaintext (one fresh
// keyMaterial per page). There is no batch/shared-key form — mirroring fidelius's intentional no-batch API.
// Fresh material comes ONLY from crypto.getRandomValues (via generateKeyPair/nonce), NEVER Math.random (R13).
import { generateKeyPair, importRawPrivate, sharedSecret, nonce, sealBundle, FideliusError } from "./fidelius.js";

// Local base64 helpers (no new deps). Only ever applied to 32-byte pubkeys/nonces — spread is safe here.
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function unb64OrThrow(s, label) {
  try { return unb64(s); } catch (e) { throw new FideliusError("malformed " + label + ": " + e.message); }
}

// Mint the per-entry ephemeral half. Production ALWAYS uses the CSPRNG path (generateKeyPair + nonce).
// io.scalar / io.nonce (raw Uint8Array(32)) inject a DETERMINISTIC ephemeral for the KAT ONLY, and are
// honored *only* behind the explicit io.testOnly === true sentinel. Without that sentinel every io field
// is IGNORED and the CSPRNG path is taken — so a production caller that passes an attacker-influenced object
// as the 3rd argument can NEVER pin deterministic ephemeral material (closes the deterministic-injection hatch).
async function mintEphemeral(io) {
  const testOnly = io && io.testOnly === true;
  const kp = (testOnly && io.scalar) ? await importRawPrivate(io.scalar) : await generateKeyPair();
  const ourNonce = (testOnly && io.nonce) ? io.nonce : nonce();
  if (!(ourNonce instanceof Uint8Array) || ourNonce.length !== 32) throw new FideliusError("ephemeral nonce must be 32 bytes");
  return { privateKey: kp.privateKey, publicKeyRaw: kp.publicKeyRaw, ourNonce };
}

// R1 belt-and-suspenders: a test-only io.entries[] must be pairwise-distinct on the (scalar,nonce) tuple.
// Two entries pinning the SAME (scalar,nonce) would derive an identical (key,iv) — reject before any seal.
// (Unpinned entries take the CSPRNG path and are inherently distinct, so they are not compared.)
function assertDistinctEntries(entries) {
  const seen = new Set();
  for (const e of entries) {
    if (!e || (!e.scalar && !e.nonce)) continue;            // unpinned → CSPRNG → inherently distinct
    const key = (e.scalar ? b64(e.scalar) : "-") + "|" + (e.nonce ? b64(e.nonce) : "-");
    if (seen.has(key)) throw new FideliusError("sealEntries: io.entries[] must be pairwise-distinct on (scalar,nonce) — a duplicate would reuse one (key,iv)");
    seen.add(key);
  }
}

/**
 * Seal EXACTLY ONE plaintext for an HIU, under a FRESH per-call ephemeral keyMaterial.
 * @param hiuKeyMaterial { dhPublicKey, nonce } — the HIU's PUBLIC half (both base64).
 * @param plaintextStr   the single record to encrypt.
 * @param io             KAT-ONLY deterministic injection { testOnly:true, scalar, nonce } (raw Uint8Array(32)).
 *                       Honored ONLY when io.testOnly === true; otherwise every field is ignored (CSPRNG path).
 * @returns { content, checksum, keyMaterial } — keyMaterial is OUR fresh public half for this one page.
 */
export async function sealForHiu(hiuKeyMaterial, plaintextStr, io = {}) {
  if (!hiuKeyMaterial || typeof hiuKeyMaterial.dhPublicKey !== "string" || typeof hiuKeyMaterial.nonce !== "string")
    throw new FideliusError("hiuKeyMaterial must carry base64 { dhPublicKey, nonce }");
  const hiuPubRaw = unb64OrThrow(hiuKeyMaterial.dhPublicKey, "HIU dhPublicKey");
  const hiuNonce = unb64OrThrow(hiuKeyMaterial.nonce, "HIU nonce");

  const { privateKey, publicKeyRaw, ourNonce } = await mintEphemeral(io);
  // Fail-closed: sharedSecret rejects a wrong-length / low-order (all-zero-secret) HIU pubkey with a
  // FideliusError BEFORE anything is sealed. Nothing below runs on a bad peer key.
  const secret = await sharedSecret(privateKey, hiuPubRaw);

  // EXACTLY ONE plaintext under this derived (key,iv). fidelius exposes no batch form — a second seal
  // needs a fresh keyMaterial, which only a fresh sealForHiu call provides.
  const { content, checksum } = await sealBundle(secret, ourNonce, hiuNonce, plaintextStr);
  return {
    content,
    checksum,
    keyMaterial: { cryptoAlg: "ECDH", curve: "Curve25519", dhPublicKey: b64(publicKeyRaw), nonce: b64(ourNonce) },
  };
}

/**
 * The R1-safe multi-record path: ONE transfer page per plaintext, EACH with its OWN fresh keyMaterial.
 * There is deliberately NO form that seals two plaintexts under one keyMaterial.
 * @param io  KAT-ONLY (honored only behind io.testOnly === true): { testOnly:true, entries:[{scalar,nonce},...] }
 *            injects a DISTINCT ephemeral per entry. A top-level { scalar } / { nonce } is REFUSED (broadcasting
 *            one across entries would reuse (key,iv)), and io.entries[] must be pairwise-distinct. Without
 *            io.testOnly the whole io is ignored → every entry takes the CSPRNG path.
 */
export async function sealEntries(hiuKeyMaterial, plaintexts, io = {}) {
  if (!Array.isArray(plaintexts)) throw new FideliusError("plaintexts must be an array");
  const testOnly = io && io.testOnly === true;
  let entriesIo = null;
  if (testOnly) {
    if (io.scalar || io.nonce)
      throw new FideliusError("sealEntries: use per-entry io.entries[]; a shared scalar/nonce would reuse one (key,iv) across entries");
    if (io.entries != null) {
      if (!Array.isArray(io.entries) || io.entries.length !== plaintexts.length)
        throw new FideliusError("io.entries must be a per-entry array matching plaintexts.length");
      assertDistinctEntries(io.entries);                     // reject duplicate (scalar,nonce) tuples (R1)
      entriesIo = io.entries;
    }
  }
  const pages = [];
  for (let i = 0; i < plaintexts.length; i++) {
    const perEntryIo = entriesIo ? { testOnly: true, ...entriesIo[i] } : {};   // propagate the sentinel per entry
    pages.push(await sealForHiu(hiuKeyMaterial, plaintexts[i], perEntryIo));    // ONE fresh keyMaterial per plaintext
  }
  return pages;
}
