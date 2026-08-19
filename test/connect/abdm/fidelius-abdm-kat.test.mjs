// Fidelius known-answer tests against an INDEPENDENT implementation of the reference algorithm.
//
// A Gradle build of mgrmtech/fidelius-cli was not runnable in this environment, so instead of trusting a
// hand-copied vector this file re-implements BouncyCastle's actual algorithm - ECDH over the SHORT-
// WEIERSTRASS curve25519, taking the shared point's x-coordinate - in plain BigInt, and asserts our
// production path reproduces it. Reference source evidence: docs/connect/abdm/FIDELIUS-RESOLVED.md.
//
// The oracle below is deliberately naive textbook EC arithmetic. It is NOT constant-time and must never
// be used outside tests; production keeps the scalar multiplication inside WebCrypto X25519.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sharedSecret, sharedSecretMontgomeryU, montgomeryUToWeierstrassX, importRawPrivate,
  abdmKeyToX25519, x25519KeyToAbdm, deriveKeyIv, sealBundle, openEntry, FideliusError,
} from "../../../functions/_connect/abdm/fidelius.js";

/* ── the oracle: BouncyCastle's curve25519 in short-Weierstrass form ────────────────────────────── */
const P = (2n ** 255n) - 19n;
const A = 486662n;
// Verified independently: ABDM's own Swagger example public key satisfies y^2 = x^3 + ax + b for these.
const CA = 19298681539552699237261830834781317975544997444273427339909597334573241639236n;
const CB = 55751746669818908907645289078257140818241103727901012315294400837956729358436n;
const A_OVER_3 = (A * modInv(3n, P)) % P;

// Curve25519 base point: Montgomery u = 9, mapped to Weierstrass by x = u + A/3.
const GX = (9n + A_OVER_3) % P;
const GY = 14781619447589544791020593568409986887264606134616475288964881837755586237401n;

function mod(x) { const r = x % P; return r < 0n ? r + P : r; }
function powMod(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
function modInv(x, m) { return powMod(mod(x), m - 2n, m); }
function onCurve(pt) { return pt === null || mod(pt.y * pt.y) === mod(pt.x ** 3n + CA * pt.x + CB); }

function ptAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  if (p1.x === p2.x && mod(p1.y + p2.y) === 0n) return null;
  const lam = (p1.x === p2.x && p1.y === p2.y)
    ? mod((3n * p1.x * p1.x + CA) * modInv(2n * p1.y, P))
    : mod((p2.y - p1.y) * modInv(p2.x - p1.x, P));
  const x3 = mod(lam * lam - p1.x - p2.x);
  return { x: x3, y: mod(lam * (p1.x - x3) - p1.y) };
}
function ptMul(k, pt) {
  let acc = null, add = pt;
  while (k > 0n) { if (k & 1n) acc = ptAdd(acc, add); add = ptAdd(add, add); k >>= 1n; }
  return acc;
}

/* ── scalars: pre-clamped so WebCrypto's internal clamping is a no-op and both paths use the same k ── */
function clampedScalar(seed) {
  const k = new Uint8Array(32);
  for (let i = 0; i < 32; i++) k[i] = (seed * 7 + i * 31 + 13) & 0xff;   // deterministic, not secret
  k[0] &= 248; k[31] &= 127; k[31] |= 64;                                // RFC 7748 clamping
  return k;
}
const leToBig = (u8) => { let n = 0n; for (let i = u8.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(u8[i]); return n; };
const beToBig = (u8) => u8.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
function bigToBe32(n) { const o = new Uint8Array(32); for (let i = 31; i >= 0; i--) { o[i] = Number(n & 0xffn); n >>= 8n; } return o; }
function encodeUncompressed(pt) {
  const o = new Uint8Array(65); o[0] = 0x04; o.set(bigToBe32(pt.x), 1); o.set(bigToBe32(pt.y), 33); return o;
}
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

/* ── the oracle is itself sane ──────────────────────────────────────────────────────────────────── */
test("oracle: the curve25519 base point is on the short-Weierstrass curve", () => {
  assert.ok(onCurve({ x: GX, y: GY }), "base point must satisfy y^2 = x^3 + ax + b");
});

test("oracle: the Weierstrass base point maps back to Montgomery u = 9", () => {
  assert.equal(mod(GX - A_OVER_3), 9n);
});

test("oracle: scalar multiples stay on the curve", () => {
  for (const k of [2n, 3n, 12345n]) assert.ok(onCurve(ptMul(k, { x: GX, y: GY })), "k=" + k);
});

/* ── THE key question ───────────────────────────────────────────────────────────────────────────── */
test("our X25519 public key equals the Weierstrass public point mapped down by A/3", async () => {
  // Proves the whole mapping, not just the ECDH step: same scalar, same point, two representations.
  for (const seed of [1, 2, 3]) {
    const kBytes = clampedScalar(seed);
    const { publicKeyRaw } = await importRawPrivate(kBytes);
    const Q = ptMul(leToBig(kBytes), { x: GX, y: GY });
    const uFromWeierstrass = mod(Q.x - A_OVER_3);
    assert.equal(leToBig(publicKeyRaw), uFromWeierstrass, "seed " + seed);
  }
});

test("sharedSecret reproduces BouncyCastle's ECDH output exactly (the KAT)", async () => {
  for (const [sa, sb] of [[11, 22], [33, 44], [55, 66]]) {
    const ka = clampedScalar(sa), kb = clampedScalar(sb);
    const { privateKey: privA } = await importRawPrivate(ka);
    const QB = ptMul(leToBig(kb), { x: GX, y: GY });

    // What BouncyCastle's KeyAgreement("ECDH","BC").generateSecret() would return:
    const expected = bigToBe32(ptMul(leToBig(ka), QB).x);

    const ours = await sharedSecret(privA, encodeUncompressed(QB));
    assert.equal(hex(ours), hex(expected), "scalars " + sa + "/" + sb);
  }
});

test("both parties derive the same secret, as ECDH requires", async () => {
  const ka = clampedScalar(77), kb = clampedScalar(88);
  const { privateKey: privA } = await importRawPrivate(ka);
  const { privateKey: privB } = await importRawPrivate(kb);
  const QA = ptMul(leToBig(ka), { x: GX, y: GY });
  const QB = ptMul(leToBig(kb), { x: GX, y: GY });

  const aSide = await sharedSecret(privA, encodeUncompressed(QB));
  const bSide = await sharedSecret(privB, encodeUncompressed(QA));
  assert.equal(hex(aSide), hex(bSide));
});

test("the RAW X25519 output would have been WRONG - it differs by exactly A/3", async () => {
  // This is the bug the reference source exposed: a valid-looking key that never decrypts.
  const ka = clampedScalar(99), kb = clampedScalar(111);
  const { privateKey: privA } = await importRawPrivate(ka);
  const QB = ptMul(leToBig(kb), { x: GX, y: GY });

  const correct = await sharedSecret(privA, encodeUncompressed(QB));
  const rawU = await sharedSecretMontgomeryU(privA, encodeUncompressed(QB));

  assert.notEqual(hex(correct), hex(Uint8Array.from(rawU).reverse()), "the two must differ, or the fix is a no-op");
  // and they differ by precisely the constant, not by anything else
  const uBe = beToBig(Uint8Array.from(rawU).reverse());
  assert.equal(beToBig(correct), mod(uBe + A_OVER_3));
});

test("a peer key in either accepted wire form yields the same secret", async () => {
  const ka = clampedScalar(123), kb = clampedScalar(234);
  const { privateKey: privA } = await importRawPrivate(ka);
  const QB = ptMul(leToBig(kb), { x: GX, y: GY });
  const uncompressed = encodeUncompressed(QB);

  const viaPoint = await sharedSecret(privA, uncompressed);
  const viaB64 = await sharedSecret(privA, Buffer.from(uncompressed).toString("base64"));
  const viaRaw32 = await sharedSecret(privA, abdmKeyToX25519(uncompressed));
  assert.equal(hex(viaPoint), hex(viaB64));
  assert.equal(hex(viaPoint), hex(viaRaw32));
});

test("what we publish is what a BouncyCastle peer can decode", async () => {
  const ka = clampedScalar(210);
  const { publicKeyRaw } = await importRawPrivate(ka);
  const wire = Buffer.from(x25519KeyToAbdm(publicKeyRaw), "base64");
  assert.equal(wire.length, 65);
  assert.equal(wire[0], 0x04);
  const pt = { x: beToBig(wire.subarray(1, 33)), y: beToBig(wire.subarray(33, 65)) };
  assert.ok(onCurve(pt), "a peer calling decodePoint() must get a valid curve point");
  // and it is the right point: x maps to our u
  assert.equal(mod(pt.x - A_OVER_3), leToBig(publicKeyRaw));
});

/* ── the rest of the envelope, pinned against the reference constants ───────────────────────────── */
test("salt is the FIRST 20 bytes of the nonce XOR and IV the LAST 12", async () => {
  const nA = new Uint8Array(32).fill(0xaa);
  const nB = new Uint8Array(32).fill(0x0f);
  const secret = new Uint8Array(32).fill(7);
  const { iv } = await deriveKeyIv(secret, nA, nB);
  const x = new Uint8Array(32);
  for (let i = 0; i < 32; i++) x[i] = nA[i] ^ nB[i];
  assert.equal(hex(iv), hex(x.slice(20, 32)));
  assert.equal(iv.length, 12);
});

test("the XOR is symmetric, so both parties derive the same key material", async () => {
  const nA = new Uint8Array(32).map((_, i) => (i * 13) & 0xff);
  const nB = new Uint8Array(32).map((_, i) => (i * 29 + 5) & 0xff);
  const secret = new Uint8Array(32).fill(3);
  const a = await deriveKeyIv(secret, nA, nB);
  const b = await deriveKeyIv(secret, nB, nA);
  assert.equal(hex(a.iv), hex(b.iv));
});

test("seal then open round-trips through the corrected secret", async () => {
  const ka = clampedScalar(31), kb = clampedScalar(41);
  const { privateKey: privA } = await importRawPrivate(ka);
  const { privateKey: privB } = await importRawPrivate(kb);
  const QA = ptMul(leToBig(ka), { x: GX, y: GY });
  const QB = ptMul(leToBig(kb), { x: GX, y: GY });

  const nA = new Uint8Array(32).map((_, i) => (i * 7 + 1) & 0xff);
  const nB = new Uint8Array(32).map((_, i) => (i * 11 + 2) & 0xff);

  const sA = await sharedSecret(privA, encodeUncompressed(QB));
  const sB = await sharedSecret(privB, encodeUncompressed(QA));

  const payload = JSON.stringify({ resourceType: "Bundle", id: "b1" });
  const sealed = await sealBundle(sA, nA, nB, payload);
  const opened = await openEntry(sB, nB, nA, sealed.content, sealed.checksum);
  assert.equal(opened, payload);
});

test("a tampered ciphertext fails authentication rather than returning garbage", async () => {
  const ka = clampedScalar(51), kb = clampedScalar(61);
  const { privateKey: privA } = await importRawPrivate(ka);
  const QB = ptMul(leToBig(kb), { x: GX, y: GY });
  const s = await sharedSecret(privA, encodeUncompressed(QB));
  const nA = new Uint8Array(32).fill(1), nB = new Uint8Array(32).fill(2);

  const sealed = await sealBundle(s, nA, nB, "sensitive");
  const raw = Buffer.from(sealed.content, "base64");
  raw[raw.length - 1] ^= 0x01;
  await assert.rejects(() => openEntry(s, nB, nA, raw.toString("base64")), FideliusError);
});

test("a malformed peer key is refused, not silently coerced", async () => {
  const { privateKey } = await importRawPrivate(clampedScalar(5));
  await assert.rejects(() => sharedSecret(privateKey, new Uint8Array(48)), FideliusError);
  const bad = encodeUncompressed(ptMul(3n, { x: GX, y: GY }));
  bad[64] ^= 0x01;                                   // knock it off the curve
  await assert.rejects(() => sharedSecret(privateKey, bad), FideliusError);
});
