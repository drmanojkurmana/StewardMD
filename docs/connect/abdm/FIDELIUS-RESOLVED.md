# Fidelius: the shared-secret question, RESOLVED from the reference implementation

**Status: answered definitively, applied, and test-green as of 2026-08-19.**

Resolved 2026-08-19 by reading the authoritative Java reference, `github.com/mgrmtech/fidelius-cli`
(cloned at commit HEAD of `main`), rather than by inference. This closes defect **D4** in
`V3-SPEC-RECONCILIATION.md`, which had been the blocker on the whole HIP data-push path.

## The answer

**The value HKDF receives is the x-coordinate of the shared point on BouncyCastle's SHORT-WEIERSTRASS
`curve25519` — NOT the Montgomery u that WebCrypto's X25519 returns.** The two differ by exactly `A/3`
(A = 486662), so a straight X25519 `deriveBits` result fed to HKDF produces the wrong AES key and every
decryption fails with no useful error.

The earlier hypothesis was therefore correct, and `montgomeryUToWeierstrassX()` in `fidelius.js` is the
right shim. It is now **wired into `sharedSecret()`**.

## The evidence, file by file

### `Constants.java`
```java
public static final String ALGORITHM = "ECDH";
public static final String CURVE     = "curve25519";
public static final String PROVIDER  = BouncyCastleProvider.PROVIDER_NAME;   // "BC"
```

### `Utils.java` — the decisive file

Key construction uses **short-Weierstrass EC arithmetic**, not RFC 7748:
```java
X9ECParameters ecParams = CustomNamedCurves.getByName(Constants.CURVE);
ECParameterSpec ecParamSpec = new ECParameterSpec(ecParams.getCurve(), ecParams.getG(),
                                                  ecParams.getN(), ecParams.getH(), ecParams.getSeed());
ECPublicKeySpec  publicKeySpec  = new ECPublicKeySpec(ecParamSpec.getCurve().decodePoint(publicKeyBytes), ecParamSpec);
ECPrivateKeySpec privateKeySpec = new ECPrivateKeySpec(new BigInteger(privateKeyBytes), ecParamSpec);
```

The shared secret is a **plain ECDH agreement on that curve**, whose output for `KeyAgreement("ECDH")`
is the shared point's **x-coordinate**, fixed-length big-endian:
```java
KeyAgreement keyAgreement = KeyAgreement.getInstance(Constants.ALGORITHM, Constants.PROVIDER);
keyAgreement.init(privateKey);
keyAgreement.doPhase(publicKey, true);
byte[] sharedSecretBytes = keyAgreement.generateSecret();
return Utils.encodeBytesToBase64(sharedSecretBytes);
```

HKDF **base64-decodes** that string, so the IKM is the raw 32 bytes - not the ASCII of the base64, which
was a real risk worth ruling out:
```java
public static byte[] sha256Hkdf(byte[] salt, String initialKeyMaterial, Integer keyLengthInBytes) {
    HKDFBytesGenerator g = new HKDFBytesGenerator(new SHA256Digest());
    g.init(new HKDFParameters(decodeBase64ToBytes(initialKeyMaterial), salt, null));   // info = null
    ...
}
```

Public-key format is selected by length - which matches the two formats the ABDM spec names:
```java
PublicKey publicKey = base64PublicKey.length() == 88      // 65 raw bytes -> 88 base64 chars
    ? generateECPublicKeyFromBase64Str(base64PublicKey)   // uncompressed 04||X||Y
    : generateX509PublicKeyFromBase64Str(base64PublicKey);// X509/SPKI (412 chars)
```

### `EncryptionController.java` — salt/IV and cipher parameters

```java
byte[] xorOfNonces = Utils.calculateXorOfBytes(senderNonce, requesterNonce);
byte[] iv   = Arrays.copyOfRange(xorOfNonces, xorOfNonces.length - 12, xorOfNonces.length);  // LAST 12
byte[] salt = Arrays.copyOfRange(xorOfNonces, 0, 20);                                        // FIRST 20
byte[] aesEncryptionKey = Utils.sha256Hkdf(salt, sharedSecret, 32);
GCMBlockCipher cipher = new GCMBlockCipher(new AESEngine());
new AEADParameters(new KeyParameter(aesEncryptionKey), 128, iv, null);                       // 128-bit tag
```

Note `calculateXorOfBytes` wraps the second array modulo its length
(`byteArrayB[i % byteArrayB.length]`). With two 32-byte nonces that is a plain XOR, so it only matters if
a peer ever sends a short nonce.

### `KeyPairGenController.java` — wire encodings
```java
privateKey    = base64(ecPrivateKey.getD().toByteArray());        // signed big-endian BigInteger
publicKey     = base64(ecPublicKey.getQ().getEncoded(false));     // uncompressed 04||X||Y, 65 bytes
x509PublicKey = base64(ecPublicKey.getEncoded());                 // SPKI
nonce         = base64(32 random bytes);
```

## What our code already gets right

Verified line-by-line against the reference:

| Step | Ours | Reference | Match |
|---|---|---|---|
| XOR the two nonces | yes | yes | ✅ |
| salt = first 20 bytes | yes | yes | ✅ |
| IV = last 12 bytes | yes | yes | ✅ |
| HKDF | SHA-256, empty info | SHA-256, `info = null` | ✅ |
| AES key length | 256-bit | 32 bytes | ✅ |
| Cipher | AES-GCM | AES-GCM | ✅ |
| GCM tag | 128 (WebCrypto default) | 128 explicit | ✅ |
| Public key on the wire | 65-byte `04‖X‖Y` via `x25519KeyToAbdm` | same | ✅ |
| **HKDF input keying material** | **Montgomery u (X25519 raw)** | **Weierstrass x** | ❌ **the bug** |

So exactly one thing is wrong, and it is the one thing that cannot be detected without a real peer:
a wrong IKM yields a valid-looking AES key that simply never decrypts anything.

## The fix

In `fidelius.js`, `sharedSecret()` must return the Weierstrass x rather than the raw X25519 output:

```
u_le  = X25519 deriveBits(ourPrivate, peerPublic)      // 32 bytes, little-endian Montgomery u
u_be  = reverse(u_le)
x_W   = (u_be + A/3) mod p        // p = 2^255-19, A = 486662, A/3 taken mod p
ikm   = 32-byte big-endian x_W    // <- what HKDF must receive
```

`montgomeryUToWeierstrassX()` implements that transform. It is wired into `sharedSecret()`, which also
now accepts a 65-byte ABDM key directly via `abdmKeyToX25519()` so callers stop having to convert.

Keeping the scalar multiplication in WebCrypto X25519 is deliberate: it stays constant-time and audited,
and only a public field addition is hand-rolled. Clamping is not a problem - RFC 7748 clamps our scalar
consistently for both our published public key and our ECDH, so agreement with an unclamped BouncyCastle
peer still holds.

## How to verify it without Java

A Gradle build of `fidelius-cli` was blocked in this environment, so the plan is to generate the
known-answer vectors from an **independent implementation of the reference algorithm** instead:

1. In the test file only, implement Weierstrass ECDH on curve25519 with BigInt - decode `04‖X‖Y`,
   scalar-multiply, take the x-coordinate. This is BC's algorithm, written independently.
2. Use **pre-clamped** scalars (RFC 7748 clamping applied up front) so WebCrypto's internal clamping is a
   no-op and both paths use the identical numeric scalar.
3. Assert, over many random keypairs, that
   `x(d_A · Q_B)` from the BigInt oracle equals `montgomeryUToWeierstrassX(X25519(d_A, Q_B))`.
   That is the proof the shim reproduces BouncyCastle's output.
4. Assert an end-to-end seal → open round trip, and pin salt/IV/tag against the reference constants.
5. If a JDK becomes available, additionally run
   `./gradlew clean build jar` then `fidelius-cli gkm` / `e` and pin those outputs as fixtures. The curve
   parameters are already independently confirmed: the public key in ABDM's own Swagger satisfies
   `y² = x³ + ax + b` for BC's curve25519 and maps to a valid Montgomery u via `x - A/3`.

## What was done (2026-08-19)

1. ✅ Shim wired into `sharedSecret()`; `sharedSecretMontgomeryU()` kept so tests can prove the difference.
2. ✅ `test/connect/abdm/fidelius-abdm-kat.test.mjs` added - **14/14 green**, including the BigInt
   Weierstrass oracle, the "raw X25519 would have been wrong by exactly A/3" negative assertion, and a
   seal → open round trip.
3. ✅ Two wire-format defects fixed alongside: `hip-crypto.js` and `hiu.js` both published the bare
   32-byte X25519 key as `dhPublicKey`. Fidelius selects its decoder by base64 length (88 chars ->
   `decodePoint()`, anything else -> X509/SPKI), so a 44-char key is unparseable at the far end. Both
   now emit the 65-byte uncompressed point. The receive path (`consumeTransfer`) already decoded
   correctly and was untouched.
4. ✅ Whole ABDM suite green: **530/530**.

The two recorded KAT ciphertexts (`test/connect/abdm/vectors/*.mjs`) were re-recorded, because the
corrected IKM changes the AES key and therefore the ciphertext. The `checksum` values did not change -
they are sha256(plaintext), independent of the key.

Still open: build `fidelius-cli` (JDK 21) and pin real `gkm`/`e` outputs as fixtures beside the BigInt
oracle. Belt and braces, not a gate - the oracle already reproduces BouncyCastle's algorithm
independently.
