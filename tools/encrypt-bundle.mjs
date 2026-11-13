#!/usr/bin/env node
/**
 * tools/encrypt-bundle.mjs — AES-256-GCM encrypt bundled content JSON for the native app.
 *
 * Wire format (must match content-crypt.js):
 *   magic "SMDE1" (5) | keyIdLen u8 (1) | keyId utf8 (N) | iv (12) | ciphertext||tag(16)
 *
 * Encrypts every .json / .jsonl under the chosen dirs IN PLACE (plaintext is overwritten).
 * Default dirs relative to --root (usually www/): kb, data, prep/lessons, prep/bank, prep/nucleus360.
 *
 * Env / flags:
 *   SMD_CONTENT_KEY      base64 32-byte AES key (required to encrypt)
 *   SMD_CONTENT_KEY_ID   short key id written into each file header (required)
 *   --root <dir>         bundle root (default: www)
 *   --force              encrypt even if already SMDE1 (re-encrypt)
 *   --dry-run            count only
 *
 * Exit codes: 0 ok / skipped; 1 missing key when required; 2 encrypt failure.
 *
 * Usage:
 *   SMD_CONTENT_KEY=... SMD_CONTENT_KEY_ID=v1 node tools/encrypt-bundle.mjs --root www
 *   CONTENT_ENCRYPT=1  (from build-www.sh) requires the env vars above.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const MAGIC = Buffer.from("SMDE1", "ascii");
export const IV_LEN = 12;
export const TAG_LEN = 16;
export const DEFAULT_DIRS = ["kb", "data", "prep/lessons", "prep/bank", "prep/nucleus360"];

/** Build one SMDE1 envelope. keyBytes must be 32 bytes; keyId 1–64 chars. */
export function encryptBuffer(plaintext, keyBytes, keyId) {
  if (!(keyBytes && keyBytes.length === 32)) throw new Error("key must be 32 bytes (AES-256)");
  const id = Buffer.from(String(keyId || ""), "utf8");
  if (id.length < 1 || id.length > 64) throw new Error("keyId length must be 1–64 bytes");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([id.length]), id, iv, ct, tag]);
}

/** True when buf starts with SMDE1 magic. */
export function isSmde1(buf) {
  if (!buf || buf.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (buf[i] !== MAGIC[i]) return false;
  return true;
}

/** Decrypt SMDE1 → { keyId, plaintext: Buffer }. Throws on tamper / wrong key / bad header. */
export function decryptBuffer(buf, keyForId) {
  if (!isSmde1(buf)) throw new Error("not SMDE1");
  const idLen = buf[5];
  if (!(idLen >= 1 && idLen <= 64)) throw new Error("bad keyIdLen");
  const keyId = Buffer.from(buf.subarray(6, 6 + idLen)).toString("utf8");
  const ivOff = 6 + idLen;
  const iv = buf.subarray(ivOff, ivOff + IV_LEN);
  const body = buf.subarray(ivOff + IV_LEN);
  if (body.length < TAG_LEN) throw new Error("truncated");
  const keyBytes = typeof keyForId === "function" ? keyForId(keyId) : keyForId;
  if (!(keyBytes && keyBytes.length === 32)) throw new Error("missing key for id " + keyId);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes, iv);
  const tag = body.subarray(body.length - TAG_LEN);
  const ct = body.subarray(0, body.length - TAG_LEN);
  decipher.setAuthTag(tag);
  return { keyId, plaintext: Buffer.concat([decipher.update(ct), decipher.final()]) };
}

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && /\.(json|jsonl)$/i.test(name)) out.push(p);
  }
}

export function collectTargets(root, dirs) {
  const files = [];
  for (const d of dirs) walk(join(root, d), files);
  return files.sort();
}

// --- CLI -------------------------------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined; };
  const has = (name) => args.includes(name);
  const root = opt("--root") || "www";
  const dry = has("--dry-run");
  const force = has("--force");
  const keyB64 = opt("--key") || process.env.SMD_CONTENT_KEY || "";
  const keyId = opt("--key-id") || process.env.SMD_CONTENT_KEY_ID || "";
  const required = process.env.CONTENT_ENCRYPT === "1" || has("--require");

  if (!keyB64 || !keyId) {
    if (required) {
      console.error("CONTENT_ENCRYPT=1 requires SMD_CONTENT_KEY (base64 32B) and SMD_CONTENT_KEY_ID");
      process.exit(1);
    }
    console.error("encrypt-bundle: skip (no SMD_CONTENT_KEY / SMD_CONTENT_KEY_ID; local plain OK)");
    process.exit(0);
  }
  const keyBytes = Buffer.from(keyB64, "base64");
  if (keyBytes.length !== 32) {
    console.error("SMD_CONTENT_KEY must decode to exactly 32 bytes");
    process.exit(1);
  }

  const files = collectTargets(root, DEFAULT_DIRS);
  let n = 0, bytesIn = 0, bytesOut = 0, skipped = 0;
  for (const f of files) {
    const plain = readFileSync(f);
    if (isSmde1(plain) && !force) { skipped++; continue; }
    bytesIn += plain.length;
    const enc = encryptBuffer(plain, keyBytes, keyId);
    bytesOut += enc.length;
    if (!dry) writeFileSync(f, enc);
    n++;
    if (n <= 5 || n % 500 === 0) {
      console.error("  encrypted " + relative(root, f) + " (" + plain.length + " → " + enc.length + ")");
    }
  }
  console.error("encrypt-bundle: " + n + " files encrypted under " + root +
    " (skipped already-SMDE1: " + skipped + "; in " + bytesIn + " B → out " + bytesOut + " B; keyId=" + keyId +
    (dry ? "; dry-run" : "") + ")");
}
