/* test/fbadmin-token-scope.test.mjs - owner screenshot 2026-10-10: User control showed "fs_get 403" and
 * "Failed: fs_commit (403) Request had insufficient authentication scopes". serviceAccountToken cached ONE
 * token for every scope, so an identitytoolkit token minted first (the account lookup) was reused for the
 * Firestore profile read and the budget write. Each scope must get its own token.
 * node --test test/fbadmin-token-scope.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceAccountToken } from "../functions/_fbadmin.js";

const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pk = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
const env = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\n" + pk + "\n-----END PRIVATE KEY-----\n", token_uri: "https://oauth2.googleapis.com/token" }) };
const ID = "https://www.googleapis.com/auth/identitytoolkit", DS = "https://www.googleapis.com/auth/datastore";

test("each scope gets its own token, and each is cached", async () => {
  const minted = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const a = new URLSearchParams(opts.body).get("assertion");
    const scope = JSON.parse(Buffer.from(a.split(".")[1], "base64url").toString()).scope;
    minted.push(scope);
    return new Response(JSON.stringify({ access_token: "tok:" + scope, expires_in: 3600 }));
  };
  try {
    assert.equal(await serviceAccountToken(env), "tok:" + ID, "default scope is identitytoolkit");
    assert.equal(await serviceAccountToken(env, DS), "tok:" + DS, "a datastore caller after it gets a DATASTORE token");
    assert.equal(await serviceAccountToken(env, DS), "tok:" + DS);
    assert.equal(await serviceAccountToken(env, ID), "tok:" + ID);
    assert.deepEqual(minted, [ID, DS], "minted once per scope, then cached");
  } finally { globalThis.fetch = real; }
});
