#!/usr/bin/env node
/**
 * Grant/revoke the paid ("pro") entitlement on Firebase accounts.
 * Sets the custom claim { pro: true } that the Cloudflare worker checks
 * before serving the offline-database download.
 *
 * Auth (any one of):
 *   - GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json, or
 *   - Application Default Credentials (gcloud auth application-default login)
 *     for project stewardmd-498ec.
 *
 * Usage:
 *   node scripts/set-pro-claim.mjs grant northstar201b@gmail.com mkkmanojkumar0@gmail.com
 *   node scripts/set-pro-claim.mjs revoke someone@example.com
 *
 * Requires: npm i firebase-admin  (dev-only; not shipped in the app)
 */
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import fs from "node:fs";

const PROJECT_ID = "stewardmd-498ec";
const [, , action, ...emails] = process.argv;

if (!["grant", "revoke"].includes(action) || emails.length === 0) {
  console.error("usage: set-pro-claim.mjs <grant|revoke> <email> [email...]");
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credential =
  keyPath && fs.existsSync(keyPath)
    ? cert(JSON.parse(fs.readFileSync(keyPath, "utf8")))
    : applicationDefault();

initializeApp({ credential, projectId: PROJECT_ID });
const auth = getAuth();
const pro = action === "grant";

for (const email of emails) {
  try {
    const user = await auth.getUserByEmail(email);
    const claims = { ...(user.customClaims || {}), pro };
    if (!pro) delete claims.pro;
    await auth.setCustomUserClaims(user.uid, claims);
    console.log(`✓ ${action}ed pro for ${email} (uid ${user.uid})`);
  } catch (e) {
    console.error(`✗ ${email}: ${e.message}`);
  }
}
console.log("\nNote: users must refresh their ID token (re-login or getIdToken(true)) for the change to take effect.");
