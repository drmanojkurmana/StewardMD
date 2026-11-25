/* Cross-language IPD encryption vector for the worker decryption seam.
 *
 * Uses functions/api/research/_ipd.js's OWN encryptSnapshot, so the
 * committed vector.json is byte-exact what the API writes to R2 (HKDF
 * KEK, AES-KW wrapped data key, AES-256-GCM ciphertext || 128-bit tag).
 * The KEK below is a fixed TEST key, not a secret; production KEKs live
 * in wrangler secrets only and never in the repo.
 *
 * Run from the repo root: node test/fixtures/research/ipd/make-vector.mjs
 * Consumed by backend/research/tests/test_stats_ipd_crypto.py.
 */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { encryptSnapshot, decryptSnapshot } from "../../../../functions/api/research/_ipd.js";

const TEST_KEK = "test-kek-0123456789abcdef"; // fixed fixture key, >= 16 chars
const env = { RESEARCH_IPD_KEK: TEST_KEK };

/* Synthetic rows only (no real patient data). The note column carries
 * non-ASCII bytes so the Python test proves byte-exact decryption, not
 * just an ASCII round-trip. Fits stats_model linear "y ~ x". */
const plaintextCsv =
  "y,x,note\n" +
  "3.1,1,café\n" +
  "4.9,2,naïve\n" +
  "7.2,3,zürich\n" +
  "8.9,4,São Paulo\n" +
  "11.1,5,Malmö\n" +
  "12.8,6,Kraków\n" +
  "15.2,7,Genève\n" +
  "16.9,8,Tōkyō\n";

const plaintext = new TextEncoder().encode(plaintextCsv);
const { ciphertext, envelope } = await encryptSnapshot(env, plaintext);

/* Self-check with the module's own decrypt before committing anything. */
const back = await decryptSnapshot(env, envelope, ciphertext);
if (Buffer.from(back).compare(Buffer.from(plaintext)) !== 0) {
  throw new Error("encrypt/decrypt round-trip mismatch");
}

const vector = {
  generator: "test/fixtures/research/ipd/make-vector.mjs",
  note: "Fixed TEST KEK fixture; not a production secret.",
  kek: TEST_KEK,
  plaintextCsv,
  plaintextSha256: createHash("sha256").update(plaintext).digest("hex"),
  ciphertextB64: Buffer.from(ciphertext).toString("base64"),
  envelope,
};
const out = new URL("./vector.json", import.meta.url);
writeFileSync(out, JSON.stringify(vector, null, 2) + "\n");
console.log("wrote " + out.pathname);
