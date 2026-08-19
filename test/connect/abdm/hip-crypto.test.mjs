// test/connect/abdm/hip-crypto.test.mjs — the R1 HARD GATE suite for the HIP "seal for HIU" path.
//
// INVARIANT UNDER TEST (R1): the derived AES-GCM (key,iv) is NEVER reused across two distinct plaintexts.
// A fresh ephemeral X25519 keypair + a fresh 32-byte nonce PER entry ⇒ pairwise-distinct nonces ⇒
// pairwise-distinct xorNonce ⇒ pairwise-distinct iv AND pairwise-distinct key ⇒ distinct (key,iv). The
// encrypt path is STRUCTURALLY incapable of emitting >1 plaintext under one keyMaterial (mirrors fidelius's
// intentional no-batch contract). These tests BLOCK the branch merge until they prove pairwise-distinct
// (key,iv) for a multi-entry seal.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPair, sharedSecret, nonce, deriveKeyIv, openEntry, FideliusError,
} from "../../../functions/_connect/abdm/fidelius.js";
import { sealForHiu, sealEntries } from "../../../functions/_connect/abdm/hip-crypto.js";
import { KAT } from "./vectors/hip-seal-kat.mjs";

const subtle = globalThis.crypto.subtle;
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const bytesToHex = (u8) => [...u8].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256hex(str) {
  const h = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(str)));
  return [...h].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Build a synthetic HIU peer (the party we seal FOR). Returns its private key + public keyMaterial.
async function makeHiu() {
  const kp = await generateKeyPair();
  const n = nonce();
  return { privateKey: kp.privateKey, keyMaterial: { dhPublicKey: b64(kp.publicKeyRaw), nonce: b64(n) }, nonce: n };
}
// Re-derive the (key,iv) + secret a sealed page uses, from the HIU's side (proves what the HIP produced).
async function rederive(hiu, page) {
  const secret = await sharedSecret(hiu.privateKey, unb64(page.keyMaterial.dhPublicKey));
  const { iv } = await deriveKeyIv(secret, hiu.nonce, unb64(page.keyMaterial.nonce));
  return { secret, iv };
}
const allPairwiseDistinct = (arr) => new Set(arr).size === arr.length;

// ─────────────────────────────────────────────────────────────────────────────
// THE MERGE GATE: multi-entry seal ⇒ pairwise-distinct (key,iv) + per-entry round-trip.
// ─────────────────────────────────────────────────────────────────────────────
test("MULTI-ENTRY KAT (R1 HARD GATE): N=3 distinct plaintexts ⇒ pairwise-distinct dhPublicKey, nonce, iv, secret + per-entry round-trip", async () => {
  const hiu = await makeHiu();
  const plaintexts = [
    JSON.stringify({ resourceType: "Bundle", id: "entry-A", n: 1 }),
    JSON.stringify({ resourceType: "Bundle", id: "entry-B", n: 2 }),
    JSON.stringify({ resourceType: "Bundle", id: "entry-C", n: 3 }),
  ];
  const pages = await sealEntries(hiu.keyMaterial, plaintexts);
  assert.equal(pages.length, 3, "one transfer page per plaintext");

  // Pairwise-distinct PUBLIC keyMaterial (fresh ephemeral keypair + fresh nonce per entry).
  assert.ok(allPairwiseDistinct(pages.map((p) => p.keyMaterial.dhPublicKey)), "dhPublicKey must be pairwise-distinct");
  assert.ok(allPairwiseDistinct(pages.map((p) => p.keyMaterial.nonce)), "nonce must be pairwise-distinct");

  // Pairwise-distinct DERIVED iv AND secret (re-derived from the HIU side) ⇒ no two pages share (key,iv).
  const ivs = [], secrets = [];
  for (const page of pages) {
    const { iv, secret } = await rederive(hiu, page);
    ivs.push(b64(iv));
    secrets.push(b64(secret));
  }
  assert.ok(allPairwiseDistinct(ivs), "derived iv must be pairwise-distinct — the HARD GATE");
  assert.ok(allPairwiseDistinct(secrets), "derived ECDH secret must be pairwise-distinct (distinct secret ⇒ distinct HKDF key)");

  // Each page decrypts back to ITS OWN plaintext (order preserved) + checksum == sha256hex(plaintext) post-decrypt.
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { secret } = await rederive(hiu, page);
    const out = await openEntry(secret, hiu.nonce, unb64(page.keyMaterial.nonce), page.content, page.checksum);
    assert.equal(out, plaintexts[i], "page i must round-trip to plaintext i");
    assert.equal(page.checksum, await sha256hex(out), "checksum must equal sha256hex(plaintext), verified post-decrypt");
  }
});

test("sealForHiu: a single seal round-trips + emits well-formed keyMaterial (ECDH/Curve25519, 65-byte pub, 32-byte nonce)", async () => {
  const hiu = await makeHiu();
  const pt = JSON.stringify({ resourceType: "Bundle", id: "solo" });
  const page = await sealForHiu(hiu.keyMaterial, pt);
  assert.equal(page.keyMaterial.cryptoAlg, "ECDH");
  assert.equal(page.keyMaterial.curve, "Curve25519");
  // 65-byte uncompressed point (88 base64 chars) - the only form Fidelius routes to decodePoint().
  assert.equal(unb64(page.keyMaterial.dhPublicKey).length, 65);
  assert.equal(unb64(page.keyMaterial.dhPublicKey)[0], 0x04);
  assert.equal(page.keyMaterial.dhPublicKey.length, 88);
  assert.equal(unb64(page.keyMaterial.nonce).length, 32);
  const { secret } = await rederive(hiu, page);
  assert.equal(await openEntry(secret, hiu.nonce, unb64(page.keyMaterial.nonce), page.content, page.checksum), pt);
});

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC KAT: fixed HIU keyMaterial + injected ephemeral ⇒ exact known ciphertext + checksum bytes.
// ─────────────────────────────────────────────────────────────────────────────
test("deterministic KAT: fixed HIU keyMaterial + io-injected ephemeral reproduce exact content/checksum/keyMaterial", async () => {
  const io = { testOnly: true, scalar: hexToBytes(KAT.ephScalarHex), nonce: hexToBytes(KAT.ephNonceHex) };
  const page = await sealForHiu(KAT.hiuKeyMaterial, KAT.plaintext, io);
  assert.equal(page.content, KAT.content, "content must match the recorded KAT bytes");
  assert.equal(page.checksum, KAT.checksum, "checksum must match the recorded KAT bytes");
  assert.deepEqual(page.keyMaterial, KAT.keyMaterial, "returned public keyMaterial must be exact");
  // And it decrypts back with the HIU's private scalar (self-consistency of the KAT).
  const hiuPriv = (await import("../../../functions/_connect/abdm/fidelius.js")).importRawPrivate;
  const hiu = await hiuPriv(hexToBytes(KAT.hiuScalarHex));
  const secret = await sharedSecret(hiu.privateKey, unb64(page.keyMaterial.dhPublicKey));
  const out = await openEntry(secret, unb64(KAT.hiuKeyMaterial.nonce), unb64(page.keyMaterial.nonce), page.content, page.checksum);
  assert.equal(out, KAT.plaintext);
  assert.equal(page.checksum, await sha256hex(out));
});

test("deterministic KAT is cross-anchored to fidelius-kat (same content/checksum for the same inputs)", async () => {
  const { KAT: FID } = await import("./vectors/fidelius-kat.mjs");
  assert.equal(KAT.content, FID.content, "hip-seal-kat.content must equal the independent fidelius-kat.content");
  assert.equal(KAT.checksum, FID.checksum, "hip-seal-kat.checksum must equal the independent fidelius-kat.checksum");
});

test("EXTERNAL ANCHOR: the KAT's raw X25519 output equals the published RFC 7748 §6.1 value K", async () => {
  const { importRawPrivate, sharedSecretMontgomeryU, montgomeryUToWeierstrassX } =
    await import("../../../functions/_connect/abdm/fidelius.js");
  const eph = await importRawPrivate(hexToBytes(KAT.ephScalarHex));           // RFC 7748 "Alice"
  // The standards-body anchor is on the MONTGOMERY u, which is what RFC 7748 publishes. sharedSecret()
  // deliberately returns the Weierstrass x instead (that is what Fidelius feeds HKDF), so the anchor is
  // taken on the pre-conversion value and the conversion is then asserted on top of it.
  const u = await sharedSecretMontgomeryU(eph.privateKey, unb64(KAT.hiuKeyMaterial.dhPublicKey));
  assert.equal(bytesToHex(u), KAT.sharedSecretHex, "raw X25519 output must match the pinned RFC value");
  assert.equal(KAT.sharedSecretHex, "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
    "the pinned value must be RFC 7748 §6.1 K (external, standards-body anchor — not fidelius-derived)");

  // …and what we actually hand to HKDF is that value mapped up by A/3 (docs/connect/abdm/FIDELIUS-RESOLVED.md).
  const secret = await sharedSecret(eph.privateKey, unb64(KAT.hiuKeyMaterial.dhPublicKey));
  assert.equal(bytesToHex(secret), bytesToHex(montgomeryUToWeierstrassX(Uint8Array.from(u).reverse())),
    "sharedSecret() must be the Weierstrass x of the RFC anchor, not the anchor itself");
  assert.notEqual(bytesToHex(secret), KAT.sharedSecretHex, "the two must differ - else the shim is a no-op");
});

// ─────────────────────────────────────────────────────────────────────────────
// FAIL-CLOSED: a bad HIU pubkey must throw FideliusError BEFORE anything seals.
// ─────────────────────────────────────────────────────────────────────────────
test("low-order (all-zero) HIU pubkey ⇒ FideliusError before any seal", async () => {
  const km = { dhPublicKey: b64(new Uint8Array(32)), nonce: b64(nonce()) };
  await assert.rejects(() => sealForHiu(km, "phi"), FideliusError);
});

test("wrong-length HIU pubkey ⇒ FideliusError (fail-closed)", async () => {
  const km = { dhPublicKey: b64(new Uint8Array(31)), nonce: b64(nonce()) };
  await assert.rejects(() => sealForHiu(km, "phi"), FideliusError);
});

test("malformed / missing HIU keyMaterial fields ⇒ FideliusError (fail-closed)", async () => {
  await assert.rejects(() => sealForHiu(null, "phi"), FideliusError);
  await assert.rejects(() => sealForHiu({}, "phi"), FideliusError);
  await assert.rejects(() => sealForHiu({ dhPublicKey: b64(nonce()) }, "phi"), FideliusError); // no nonce
  await assert.rejects(() => sealForHiu({ dhPublicKey: "!!not-base64!!", nonce: b64(nonce()) }, "phi"), FideliusError);
});

// ─────────────────────────────────────────────────────────────────────────────
// PROVABLY NO API that reuses a keyMaterial (mirror fidelius's intentional no-batch contract).
// ─────────────────────────────────────────────────────────────────────────────
test("sealEntries: N plaintexts ⇒ N pages, EACH its own keyMaterial (no shared-key form)", async () => {
  const hiu = await makeHiu();
  const pts = ["a", "b", "c", "d", "e"];
  const pages = await sealEntries(hiu.keyMaterial, pts);
  assert.equal(pages.length, pts.length);
  assert.ok(allPairwiseDistinct(pages.map((p) => p.keyMaterial.dhPublicKey)));
  assert.ok(allPairwiseDistinct(pages.map((p) => p.keyMaterial.nonce)));
  for (let i = 0; i < pages.length; i++) {
    const { secret } = await rederive(hiu, pages[i]);
    assert.equal(await openEntry(secret, hiu.nonce, unb64(pages[i].keyMaterial.nonce), pages[i].content, pages[i].checksum), pts[i]);
  }
});

test("the module exposes NO batch/multi-plaintext-per-key form (surface audit)", async () => {
  const mod = await import("../../../functions/_connect/abdm/hip-crypto.js");
  assert.equal(typeof mod.sealForHiu, "function");
  assert.equal(typeof mod.sealEntries, "function");
  for (const banned of ["sealBundles", "sealMany", "sealBatch", "sealForHiuBatch"]) {
    assert.equal(banned in mod, false, `no batch export "${banned}" may exist`);
  }
  // sealForHiu returns exactly ONE page object (never an array of plaintexts under one key).
  const hiu = await makeHiu();
  const one = await sealForHiu(hiu.keyMaterial, "solo");
  assert.equal(Array.isArray(one), false);
  assert.equal(typeof one.content, "string");
  assert.ok(one.keyMaterial && typeof one.keyMaterial.dhPublicKey === "string");
});

test("sealEntries REJECTS a broadcast io.scalar/io.nonce (would reuse one (key,iv) across entries)", async () => {
  const hiu = await makeHiu();
  await assert.rejects(
    () => sealEntries(hiu.keyMaterial, ["a", "b"], { testOnly: true, scalar: hexToBytes(KAT.ephScalarHex) }),
    FideliusError,
    "a single shared scalar across entries must be refused (R1)");
  await assert.rejects(
    () => sealEntries(hiu.keyMaterial, ["a", "b"], { testOnly: true, nonce: hexToBytes(KAT.ephNonceHex) }),
    FideliusError,
    "a single shared nonce across entries must be refused (R1)");
});

test("sealEntries rejects a per-entry io.entries[] whose length ≠ plaintexts.length (fail-closed)", async () => {
  const hiu = await makeHiu();
  await assert.rejects(
    () => sealEntries(hiu.keyMaterial, ["a", "b", "c"], { testOnly: true, entries: [{}, {}] }),
    FideliusError);
});

// ── Hardening (dual-adversarial): io is TEST-ONLY-gated, and duplicate entries are refused. ──
test("HARDENING #2: sealEntries REJECTS duplicate io.entries[] (same (scalar,nonce) ⇒ reused (key,iv))", async () => {
  const hiu = await makeHiu();
  const dup = { scalar: hexToBytes(KAT.ephScalarHex), nonce: hexToBytes(KAT.ephNonceHex) };
  await assert.rejects(
    () => sealEntries(hiu.keyMaterial, ["a", "b"], { testOnly: true, entries: [dup, { ...dup }] }),
    FideliusError,
    "two entries pinning the identical (scalar,nonce) must be refused");
});

test("HARDENING #1: a PROD call passing scalar/nonce WITHOUT testOnly IGNORES them and uses the CSPRNG path", async () => {
  const hiu = await makeHiu();
  const attacker = { scalar: hexToBytes(KAT.ephScalarHex), nonce: hexToBytes(KAT.ephNonceHex) }; // no testOnly
  const p1 = await sealForHiu(hiu.keyMaterial, "phi", attacker);
  const p2 = await sealForHiu(hiu.keyMaterial, "phi", attacker);
  // If injection were honored both would equal the KAT ephemeral; instead each is a fresh CSPRNG keypair.
  assert.notEqual(p1.keyMaterial.dhPublicKey, p2.keyMaterial.dhPublicKey, "two prod calls must yield DISTINCT dhPublicKey");
  assert.notEqual(p1.keyMaterial.dhPublicKey, KAT.keyMaterial.dhPublicKey, "the injected scalar must have been ignored");
  assert.notEqual(p1.keyMaterial.nonce, KAT.keyMaterial.nonce, "the injected nonce must have been ignored");
  // sealEntries: same guarantee — an attacker object without testOnly cannot pin any entry's material.
  const pages = await sealEntries(hiu.keyMaterial, ["x", "y"], attacker);
  assert.notEqual(pages[0].keyMaterial.dhPublicKey, pages[1].keyMaterial.dhPublicKey);
  assert.notEqual(pages[0].keyMaterial.dhPublicKey, KAT.keyMaterial.dhPublicKey);
});

test("R1 negation proof: two DIFFERENT plaintexts sealed independently never collide on (key,iv)", async () => {
  const hiu = await makeHiu();
  const p1 = await sealForHiu(hiu.keyMaterial, "plaintext-ONE");
  const p2 = await sealForHiu(hiu.keyMaterial, "plaintext-TWO");
  assert.notEqual(p1.keyMaterial.dhPublicKey, p2.keyMaterial.dhPublicKey);
  assert.notEqual(p1.keyMaterial.nonce, p2.keyMaterial.nonce);
  const { iv: iv1, secret: s1 } = await rederive(hiu, p1);
  const { iv: iv2, secret: s2 } = await rederive(hiu, p2);
  assert.notDeepEqual([...iv1], [...iv2], "ivs must differ");
  assert.notDeepEqual([...s1], [...s2], "secrets must differ (⇒ keys differ)");
});
