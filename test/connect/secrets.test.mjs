// test/connect/secrets.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSecrets, SecretsUnavailable } from "../../functions/_connect/secrets.js";

const b64key = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

test("seal/open round-trips", async () => {
  const s = makeSecrets({ CONNECT_MASTER_KEY: b64key });
  const ct = await s.seal("hunter2");
  assert.notEqual(ct, "hunter2");
  assert.equal(await s.open(ct), "hunter2");
});

test("fail-closed when master key is missing", async () => {
  const s = makeSecrets({});
  await assert.rejects(() => s.seal("x"), SecretsUnavailable);
  await assert.rejects(() => s.open("x"), SecretsUnavailable);
});

test("get reads a Workers secret by name", async () => {
  const s = makeSecrets({ CONNECT_MASTER_KEY: b64key, MY_TOKEN: "abc" });
  assert.equal(await s.get("MY_TOKEN"), "abc");
});
