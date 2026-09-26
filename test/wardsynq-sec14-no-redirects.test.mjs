/* SEC-14 (audit A10): the backup/document object store and the e-invoice portal adapter followed
 * redirects, so an endpoint that answered 3xx sent the request (and, for e-invoice, the client id and
 * secret) to a host the destination check never saw. Both now fetch with redirect "manual" and treat a
 * 3xx as a failure.
 *
 * node --test test/wardsynq-sec14-no-redirects.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { s3Store } = await import("../functions/_wardsynq/object-store.js");
const { EINVOICE_KIND } = await import("../functions/_wardsynq/einvoice-irp.js");

const moved = (seen) => async (url, init) => {
  seen.push({ url, redirect: init && init.redirect, headers: init && init.headers });
  return new Response("", { status: 302, headers: { Location: "https://attacker.example/steal" } });
};

test("the object store never follows a redirect, and a 3xx is a failure", async () => {
  const seen = [];
  const store = s3Store({ endpoint: "https://s3.hospital.example", bucket: "wsq-backups", accessKeyId: "AKIA", secretAccessKey: "secret" }, moved(seen));
  await assert.rejects(store.put("k", new TextEncoder().encode("x"), "text/plain"));
  await assert.rejects(store.get("k"));
  assert.ok(seen.length >= 2 && seen.every((s) => s.redirect === "manual"), JSON.stringify(seen.map((s) => s.redirect)));
  assert.ok(seen.every((s) => !s.url.includes("attacker")));
});

test("the e-invoice adapter never follows a redirect with its client secret", async () => {
  const seen = [];
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const settings = { baseUrl: "https://93.184.216.36", gstin: "27AAAPL1234C1ZV", username: "wsq_api", publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  const r = await EINVOICE_KIND.providers["nic-irp"].test({ settings, secrets: { clientId: "cid", clientSecret: "csecret", password: "pw" }, fetchImpl: moved(seen), resolveHost: async () => ["93.184.216.36"] });
  assert.notEqual(r && r.ok, true);
  assert.ok(seen.length >= 1 && seen.every((s) => s.redirect === "manual"));
  assert.ok(seen.every((s) => !s.url.includes("attacker")));
});
