// scripts/encrypt-kb.mjs — AES-256-GCM encrypt the KB (+ any crown-jewel) files into .enc blobs for the
// native-only lock (Phase 2b). Build-time (Node crypto) counterpart to the runtime WebCrypto decrypt in
// kb-loader.js — the wire format MUST match: bytes = IV(12) || ciphertext || GCM-tag(16), which is exactly
// what WebCrypto AES-GCM decrypt expects (iv separate, ciphertext-with-tag-appended as the body).
//
// The key is a 32-byte AES-256 key, base64. Provide a STABLE per-release key via --key / env KB_KEY so it
// matches the server's APP_KB_KEY secret (which /api/license hands to Pro users); if none is given, one is
// generated and printed for you to save. The key is NEVER written to disk or committed.
//
// Usage:  node scripts/encrypt-kb.mjs --key <base64-32B> --out www <file...>
//         KB_KEY=<base64> node scripts/encrypt-kb.mjs --out www <file...>
import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Encrypt one buffer. Returns IV(12) || ciphertext || tag(16). keyBytes must be 32 bytes (AES-256).
export function encryptBuffer(plaintext, keyBytes) {
  if (!(keyBytes && keyBytes.length === 32)) throw new Error("key must be 32 bytes (AES-256)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();               // 16 bytes
  return Buffer.concat([iv, ct, tag]);
}

// --- CLI (skipped when imported by a test) --------------------------------------------------------------
const isMain = import.meta.url === ("file://" + process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined; };
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--key" && args[i - 1] !== "--out");
  const outDir = opt("--out") || "www";
  let keyB64 = opt("--key") || process.env.KB_KEY || "";
  let generated = false;
  let keyBytes;
  if (keyB64) {
    keyBytes = Buffer.from(keyB64, "base64");
    if (keyBytes.length !== 32) { console.error("KB_KEY must be a base64 32-byte (AES-256) key"); process.exit(1); }
  } else {
    keyBytes = randomBytes(32); keyB64 = keyBytes.toString("base64"); generated = true;
  }
  if (!files.length) { console.error("no input files given"); process.exit(1); }
  for (const f of files) {
    const plain = readFileSync(f);
    const enc = encryptBuffer(plain, keyBytes);
    const out = join(outDir, f) + ".enc";
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, enc);
    console.error("encrypted " + f + " -> " + out + " (" + enc.length + " bytes)");
  }
  if (generated) {
    console.error("\nGENERATED KEY (save as the APP_KB_KEY Pages secret; do NOT commit):");
    console.log(keyB64);   // stdout = the key only, so `... > /dev/null` hides it or it can be piped
  }
}
